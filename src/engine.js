/**
 * It takes a genius to read through and understand this code.
 *
 * Thankfully, it only takes an idiot to write it, so I'm making progress.
 */

import GUI from "lil-gui";
import * as THREE from "three";
import Stats from "stats-js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import newData from "./data.json";
import { uniform } from "three/examples/jsm/nodes/core/UniformNode";
/**
 * There are going to be a few components here.
 *
 * Infrastructure logic
 * - stuff like fetching data from external sources.
 * - Exists for the lifetime of the program.
 *
 *
 * Game Config
 * - data that is loaded to define the game itself
 * - HP values, enemy types, map looks like?
 *
 * Input Handler
 * - Tracks mouse/keyboard and keeps some more useful facts about what's active?
 *
 * Game State
 * - data that describes the current state of the game
 * - where is the player standing? what have they done, etc
 *
 * Renderer
 * - controls what goes on the screen, the camera, etc.
 *
 * Editor Mode
 * - Can mutate Game Config
 *
 * Game Mode
 * - Can mutate Game State
 */

/**
 * Helpers
 */

Math.clamp = (num, min, max) => Math.max(min, Math.min(num, max));

Math.randomRange = (min = 0, max = 1) => Math.random() * (max - min) + min;

export const DefaultUniqueUniform = 0;
export const DefaultLinkedUniform = 1;

export const partition = (array, filterFn) => {
  const pass = [];
  const fail = [];
  array.forEach((e, idx, arr) => (filterFn(e, idx, arr) ? pass : fail).push(e));
  return [pass, fail];
};

const defaultSyncToData = (obj, data) => {
  for (const fieldName in obj) {
    data[fieldName] = {};
    if ("syncToData" in obj[fieldName]) {
      obj[fieldName].syncToData(data[fieldName]);
    }
    if (Object.keys(data[fieldName]).length === 0) {
      delete data[fieldName];
    }
  }
};

const defaultSyncFromData = (obj, data) => {
  for (const fieldName in obj) {
    if ("syncFromData" in obj[fieldName]) {
      if (!data[fieldName]) {
        data[fieldName] = {};
      }
      obj[fieldName].syncFromData(data[fieldName]);
    }
  }
};

const addDefaultSync = (obj) => {
  obj.syncFromData = (data) => defaultSyncFromData(obj, data);
  obj.syncToData = (data) => defaultSyncToData(obj, data);
};

const markDebug = (obj, config = { debugType: null }) => {
  obj.debugConfig = config;
};

class FontManager {
  constructor(loadingManager) {
    this.fontLoader = new FontLoader(loadingManager);

    this.fonts = new Map();
    this.load = (path) => {
      this.fontLoader.load(path, (font) => {
        this.fonts.set(path, font);
      });
    };
    this.get = (path) => this.fonts.get(path);
  }
}

class TextureManager {
  static defaultTexturePath = "./texture/uvSubgrid.png";

  constructor(loadingManager) {
    this.textureLoader = new THREE.TextureLoader(loadingManager);

    this.load = (path, config = {}) => {
      const texture = this.textureLoader.load(path);
      for (const param in config) {
        texture[`${param}`] = config.param;
      }
      texture.path = path;
      texture.config = config;
      return texture;
    };
    this.defaultTexture = this.load(TextureManager.defaultTexturePath);
    console.log(this.defaultTexture);
  }
}

class AudioManager {
  constructor(loadingManager) {
    this.audioListener = new THREE.AudioListener();
    this.audioLoader = new THREE.AudioLoader(loadingManager);
    this.audioPool = [];
    this.buffers = new Map();

    this.load = (path) => {
      this.audioLoader.load(path, (buffer) => {
        this.buffers.set(path, buffer);
      });
    };

    this.play = (path) => {
      if (!this.buffers.has(path)) {
        return;
      }
      const buffer = this.buffers.get(path);
      const audio = this.audioPool.filter((audio) => !audio.isPlaying).pop();
      if (!audio) {
        audio = new THREE.Audio(this.audioListener);
      }
      audio.setBuffer(buffer);
      audio.play();
    };
  }
}

class ModelManager {
  constructor(loadingManager) {
    const dracoLoader = new DRACOLoader(loadingManager);
    const gltfLoader = new GLTFLoader(loadingManager);
    gltfLoader.setDRACOLoader(dracoLoader);
    dracoLoader.setDecoderPath("./draco/gltf/");

    this.models = new Map();

    this.load = (path, material = null) => {
      gltfLoader.load(path, (data) => {
        const model = data.scene;
        if (material) {
          model.traverse(function (child) {
            if (child instanceof THREE.Mesh) {
              child.material = material;
            }
          });
        }
        model.animations = data.animations;
        models.set(path, model);
      });
    };

    this.get = (path) => {
      if (!this.models.has(path)) {
        return null;
      }
      const rawModel = this.models.get(path);

      const model = SkeletonUtils.clone(rawModel);
      if (rawModel.animations) {
        model.mixer = new THREE.AnimationMixer(model);
        model.mixer.clips = rawModel.animations;
        model.mixer.playAnimation = (name, loopMode = THREE.LoopOnce) => {
          model.mixer.stopAllAction();
          const action = model.mixer.clipAction(name);
          action.setLoop(loopMode);
          action.play();
        };
      }
      return model;
    };
  }
}

/**
 * Core objects
 */
const perspectiveConfig = {
  type: "perspective",
  fov: 75,
  zoom: 2,
};

const orthographicConfig = {
  type: "orthographic",
  zoom: 2,
};

const cameraConfig = {
  subtypeConfig: perspectiveConfig,
  aspectRatio: 16 / 9,
  near: 0.001,
  position: new THREE.Vector3(5, 7, 5)
    .normalize()
    .multiplyScalar(perspectiveConfig.zoom),
};

const generateCamera = ({ aspectRatio, subtypeConfig, near, position }) => {
  let camera;
  switch (subtypeConfig.type) {
    case "perspective":
      camera = new THREE.PerspectiveCamera(
        subtypeConfig.fov,
        cameraConfig.aspectRatio
      );
      camera.customZoom = subtypeConfig.zoom;
      break;
    case "orthographic":
      const height = subtypeConfig.zoom;
      const width = aspectRatio * height;

      camera = new THREE.OrthographicCamera(
        -width / 2,
        width / 2,
        height / 2,
        -height / 2,
        near
      );
      camera.customZoom = subtypeConfig.zoom;
      break;
    default:
      throw new Error("unknown camera type");
  }
  camera.position.x = position.x;
  camera.position.y = position.y;
  camera.position.z = position.z;

  camera.aspect = aspectRatio;
  camera.near = near;
  camera.lookAt(new THREE.Vector3());
  return camera;
};

class WindowManager {
  constructor(camera) {
    this.sizes = {
      width: window.innerWidth,
      height: window.innerHeight,
      verticalOffset: 0,
      horizontalOffset: 0,
    };
    this.listeners = [];

    const container = document.querySelector("div.container");
    const canvasContainer = document.querySelector("div.relative");

    this.update = () => {
      if (window.innerHeight * camera.aspect > window.innerWidth) {
        this.sizes.width = window.innerWidth;
        this.sizes.height = window.innerWidth / camera.aspect;
        this.sizes.verticalOffset =
          (window.innerHeight - this.sizes.height) / 2;
        this.sizes.horizontalOffset = 0;
      } else {
        this.sizes.width = window.innerHeight * camera.aspect;
        this.sizes.height = window.innerHeight;
        this.sizes.verticalOffset = 0;
        this.sizes.horizontalOffset =
          (window.innerWidth - this.sizes.width) / 2;
      }
      canvasContainer.style.top = this.sizes.verticalOffset.toString() + "px";
      canvasContainer.style.left =
        this.sizes.horizontalOffset.toString() + "px";

      this.listeners.forEach((l) => {
        l.updateSize(this.sizes);
      });
    };

    window.addEventListener("resize", this.update);
    window.addEventListener("orientationchange", this.update);
    window.addEventListener("dblclick", (event) => {
      if (event.target.className !== "webgl") {
        return;
      }
      const fullscreenElement =
        document.fullscreenElement || document.webkitFullscreenElement;

      if (fullscreenElement) {
        document.exitFullscreen();
      } else {
        container.requestFullscreen();
      }
    });
  }
}

class RenderManager {
  constructor(textureManager) {
    const canvas = document.querySelector("canvas.webgl");
    const scene = new THREE.Scene();
    const camera = generateCamera(cameraConfig);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enabled = true;
    renderer.setClearColor("#201919");
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    scene.add(camera);

    camera.updateZoom = () => {
      const { customZoom, aspect } = camera;
      if (camera.isOrthographicCamera) {
        const height = customZoom;
        const width = aspect * height;

        camera.left = -width / 2;
        camera.right = width / 2;
        camera.top = height / 2;
        camera.bottom = -height / 2;
      } else if (camera.isPerspectiveCamera) {
        camera.position.multiplyScalar(customZoom / camera.position.length());
      }
      camera.updateProjectionMatrix();
    };

    const materialManager = new MaterialManager(textureManager);

    this.scene = scene;
    this.renderer = renderer;
    this.composer = composer;
    this.camera = camera;
    this.materialManager = materialManager;
    addDefaultSync(this);
    markDebug(this);
  }

  updateSize({ width, height }) {
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  handleMouse({ mouseWheel: { deltaY } }) {
    if (!deltaY) {
      return;
    }
    this.camera.customZoom = Math.clamp(
      this.camera.customZoom + deltaY / 100,
      1,
      100
    );
    this.camera.updateZoom();
  }
}

class InputManager {
  updateTime({ userDeltaTime, gameDeltaTime }) {
    this.keyState.pressedKeys.forEach((v) => {
      v.heldUserTime += userDeltaTime;
      v.heldGameTime += gameDeltaTime;
    });
  }

  constructor() {
    this.mouseState = {
      pos: null,
      buttons: null,
      mouseWheel: {
        deltaY: null,
      },
    };
    this.keyState = {
      pressedKeys: new Map(),
    };
    this.sizes = { width: 1, height: 1 };
    this.listeners = [];

    window.addEventListener("keydown", (event) => {
      if (event.key === "F12") {
        return;
      }
      event.preventDefault();
      const { pressedKeys } = this.keyState;
      if (!pressedKeys.has(event.key)) {
        pressedKeys.set(event.key, { heldGameTime: 0, heldUserTime: 0 });
      }
    });
    window.addEventListener("keyup", (event) => {
      event.preventDefault();
      const { pressedKeys } = this.keyState;
      if (pressedKeys.has(event.key)) {
        pressedKeys.delete(event.key);
      }
    });

    const handleMouseEvent = (event) => {
      const { sizes } = this;
      if (event.target.className !== "webgl") {
        return;
      }
      this.mouseState.pos = new THREE.Vector2(
        ((event.clientX - sizes.horizontalOffset) / sizes.width) * 2 - 1,
        -((event.clientY - sizes.verticalOffset) / sizes.height) * 2 + 1
      );

      this.mouseState.buttons = event.buttons;
    };

    const handleScrollEvent = (event) => {
      this.mouseState.mouseWheel.deltaY = event.deltaY;
    };

    window.addEventListener("wheel", handleScrollEvent);
    window.addEventListener("pointerdown", handleMouseEvent);
    window.addEventListener("pointerup", handleMouseEvent);
    window.addEventListener("pointermove", handleMouseEvent);

    window.addEventListener(
      "contextmenu",
      (ev) => {
        ev.preventDefault();
        return false;
      },
      false
    );
  }

  updateSize(sizes) {
    this.sizes = sizes;
  }

  endLoop() {
    this.mouseState.mouseWheel.deltaY = null;
  }
}

const register = (provider, listener) => provider.listeners.push(listener);

class TimeManager {
  constructor() {
    const clock = new THREE.Clock();
    this.gameSpeed = 1;
    this.time = {
      userTime: 0,
      gameTime: 0,
      userDeltaTime: 0,
      gameDeltaTime: 0,
    };
    this.listeners = [];

    this.endLoop = () => {
      const deltaTime = clock.getDelta();
      this.time.userTime += deltaTime;
      this.time.gameTime += deltaTime * this.gameSpeed;
      this.time.userDeltaTime = deltaTime;
      this.time.gameDeltaTime = deltaTime * this.gameSpeed;
      this.listeners.forEach((v) => {
        v.updateTime(this.time);
      });
    };
  }
}

class Uniform {
  static deserializeValue = (data, textureManager) => {
    const { uniformType } = data;
    if (!data.value) {
      return Uniform.default(uniformType, textureManager);
    }
    switch (uniformType) {
      case "float":
      case "int":
      case "bool":
      case "vec2":
      case "vec3":
      case "vec4":
        return data.value;
      case "color":
        const { r, g, b } = data.value;
        return new THREE.Color(r, g, b);
      case "sampler2D":
        return textureManager.load(data.value);
      default:
        throw new Error(`Dunno what to do here, ${uniformType}`);
    }
  };

  static deserialize = (data, textureManager) => {
    const value = Uniform.deserializeValue(data, textureManager);
    const uniform = new THREE.Uniform(value);
    uniform.uniformType = data.uniformType;
    return uniform;
  };

  static serialize = ({ uniformType, value }) => {
    let data = { uniformType: uniformType };
    switch (uniformType) {
      case "float":
      case "int":
      case "bool":
      case "vec2":
      case "vec3":
      case "vec4":
        data.value = value;
        break;
      case "color":
        const { r, g, b } = value;
        data.value = { r, g, b };
        break;
      case "sampler2D":
        data.value = value.path;
        break;
      default:
        throw new Error(`Dunno what to do here, ${value}, ${uniformType}`);
    }
    return data;
  };

  static default = (uniformType, textureManager) => {
    switch (uniformType) {
      case "float":
        return 1;
      case "bool":
        return false;
      case "int":
        return 1;
      case "vec2":
        return new THREE.Vector2(1, 1);
      case "vec3":
        return new THREE.Vector3(1, 1, 1);
      case "vec4":
        return new THREE.Vector4(1, 1, 1, 1);
      case "color":
        return new THREE.Color(0xff69b4);
      case "sampler2D":
        return textureManager.defaultTexture;
      default:
        throw new Error(`Unknown unform type: ${uniformType}`);
    }
  };
}

class MaterialManager {
  constructor(textureManager) {
    this.textureManager = textureManager;
    this.materials = {};
    this.uniforms = {};
    markDebug(this);
    markDebug(this.uniforms);

    this.syncFromData = (data) => {
      for (const uniformName in data) {
        const uniformData = Uniform.deserialize(
          data[uniformName],
          textureManager
        );
        this.getUniform(uniformName, uniformData);
      }
    };
    this.syncToData = (data) => {
      for (const uniformName in this.uniforms) {
        if (!this.uniforms[uniformName].shouldSync) {
          continue;
        }
        data[uniformName] = Uniform.serialize(this.uniforms[uniformName]);
      }
    };
  }

  getUniform(name, data) {
    if (!this.uniforms[name]) {
      const { uniformType } = data;
      if (!data.value) {
        data.value = Uniform.default(uniformType, this.textureManager);
      }

      const uniform = new THREE.Uniform(data.value);
      uniform.uniformType = uniformType;

      // check debug criteria
      const splitName = name.split("_");
      const firstChar = splitName[splitName.length - 1][0];

      if (firstChar === "p") {
        markDebug(uniform, { debugType: uniformType });
      }

      // check persistent
      if (firstChar === "p") {
        uniform.shouldSync = true;
      }

      this.uniforms[name] = uniform;
    }
    return this.uniforms[name];
  }

  addMaterial(
    name,
    vertexShader,
    fragmentShader,
    config = { lights: false, unique: false }
  ) {
    const existingMaterial = this.materials[name];
    if (existingMaterial) {
      return existingMaterial;
    }

    const uniformRe = new RegExp(/uniform\s(\w+)\s([peu]\w+);/g);
    const colorRe = new RegExp(/color|colour|/i);

    // We don't care where the uniforms are declared, just that they are.
    const megaShader = vertexShader + fragmentShader;

    const uniforms = [...megaShader.matchAll(uniformRe)].map((match) => {
      const [_, shaderType, shaderName] = match;

      const uniformName = config.unique ? `${name}_${shaderName}` : shaderName;
      const uniformType =
        shaderType === "vec3" && shaderName.match(colorRe)
          ? "color"
          : shaderType;

      const uniform = this.getUniform(uniformName, { uniformType });
      return [shaderName, uniform];
    });

    const materialParams = {
      vertexShader,
      fragmentShader,
      uniforms: Object.fromEntries(uniforms),
    };

    for (const field in config) {
      materialParams[field] = config[field];
      switch (field) {
        case "lights":
          // Add lighting data
          materialParams.uniforms = {
            ...materialParams.uniforms,
            ...THREE.UniformsLib.lights,
          };
          break;
        default:
          break;
      }
    }
    const material = new THREE.ShaderMaterial(materialParams);
    this.materials[name] = material;
    return material;
  }
}

class StatsManager {
  constructor() {
    const stats = new Stats();
    stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
    document.body.appendChild(stats.dom);
    this.stats = stats;
  }
}

const loadData = (data, manager) => {
  // load data into manager
  if ("load" in manager && "data" in data) {
    manager.load(data.data);
  }

  // recurse on children
  for (const field in data) {
    if (field in manager) {
      loadData(data[field], manager[field]);
    }
  }
};

class DebugManager {
  constructor(engine) {
    const gui = new GUI();

    const debugObject = {
      timeSpeed: 1.0,
    };

    gui.add(engine, "importData").name("Load Data");

    gui.add(engine, "exportData").name("Save Data");
    gui.add(debugObject, "timeSpeed").min(0).max(3).step(0.1);
    this.gui = gui;
  }

  // We make this static because it's recursive, and
  // we don't want to accidently include 'this'.
  static updateGui(engine, gui, name) {
    // Update existing folders
    const folderMap = new Map(gui.folders.map((f) => [f._title, f]));
    const folderNamesToDelete = [];
    for (const folder of gui.folders) {
      const folderName = folder._title;
      if (!(folderName in engine) || !engine[folderName].debugConfig) {
        // Remove irrelevant
        folderNamesToDelete.push(folderName);
        continue;
      }
      // Update matching
      DebugManager.updateGui(engine[folderName], folder, name);

      if (folder.controllersRecursive().length === 0) {
        folderNamesToDelete.push(folderName);
      }
    }

    folderNamesToDelete.forEach((folderName) => {
      folderMap.get(folderName).destroy();
      folderMap.delete(folderName);
    });

    // Add new folders
    for (const folderName in engine) {
      if (!engine[folderName].debugConfig) {
        continue;
      }

      const { debugType } = engine[folderName].debugConfig;

      let folder;
      if (debugType) {
        folder = gui;
      } else if (folderMap.has(folderName)) {
        folder = folderMap.get(folderName);
      } else {
        folder = gui.addFolder(`${folderName}`);
      }

      DebugManager.updateGui(engine[folderName], folder, folderName);

      if (folder.controllersRecursive().length === 0) {
        folder.destroy();
      }
    }

    // Check for a value
    if (engine.debugConfig.debugType) {
      const { debugType } = engine.debugConfig;
      const existingController = gui.controllers.find((c) => c._name === name);
      if (existingController) {
        if (existingController.value !== engine.value) {
          existingController.value = engine.value;
        }
      } else {
        switch (debugType) {
          case "color":
            gui.addColor(engine, "value").name(name);
            break;
          case "sampler2D":
            gui.add(engine.value, "path").name(name);
            break;
          case "int":
            gui.add(engine, "value").name(name).min(-3).max(3).step(1);
            break;
          default:
            gui.add(engine, "value").name(name).min(-1).max(1).step(0.05);
            break;
        }
      }
    }
  }
}

export class KubEngine {
  importData() {
    this.syncFromData(newData);
  }

  exportData() {
    const data = {};
    this.syncToData(data);
    var link = document.createElement("a");
    const fileName = "data.json";
    var myFile = new Blob([JSON.stringify(data)], {
      type: "application/json",
    });
    link.download = fileName;
    link.setAttribute("href", window.URL.createObjectURL(myFile));
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  constructor() {
    addDefaultSync(this);
    markDebug(this);

    THREE.Cache.enabled = true;
    const loadingManager = new THREE.LoadingManager();
    loadingManager.hasFiles = false;
    loadingManager.onStart = () => (loadingManager.hasFiles = true);
    const textureManager = new TextureManager(loadingManager);
    const fontManager = new FontManager(loadingManager);
    const audioManager = new AudioManager(loadingManager);
    const modelManager = new ModelManager(loadingManager);
    const renderManager = new RenderManager(textureManager);
    renderManager.camera.add(audioManager.audioListener);

    const inputManager = new InputManager();
    const windowManager = new WindowManager(renderManager.camera);

    register(windowManager, inputManager);
    register(windowManager, renderManager);
    windowManager.update();

    const timeManager = new TimeManager();
    register(timeManager, inputManager);

    const statsManager = new StatsManager();

    this.statsManager = statsManager;
    this.timeManager = timeManager;
    this.loadingManager = loadingManager;
    this.loadTexture = textureManager.load;
    this.loadFont = fontManager.load;
    this.getFont = fontManager.get;
    this.loadSound = audioManager.load;
    this.playSound = audioManager.play;
    this.loadModel = modelManager.load;
    this.getModel = modelManager.get;
    this.renderManager = renderManager;
    this.scene = renderManager.scene;
    this.renderer = renderManager.renderer;
    this.composer = renderManager.composer;
    this.camera = renderManager.camera;
    this.sizes = windowManager.sizes;
    this.renderManager = renderManager;
    this.inputManager = inputManager;

    const debugManager = new DebugManager(this);
    this.debugManager = debugManager;

    this.importData();
    DebugManager.updateGui(this, this.debugManager.gui, "engine");
  }

  update() {
    this.renderManager.handleMouse(this.inputManager.mouseState);
  }

  endLoop() {
    for (const field in this) {
      if ("endLoop" in this[field]) {
        this[field].endLoop();
      }
    }
  }
}
