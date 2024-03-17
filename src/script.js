import "./style.css";
import * as THREE from "three";
import { gsap } from "gsap";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import loadingVertexShader from "./shaders/loading/vertex.glsl";
import loadingFragmentShader from "./shaders/loading/fragment.glsl";
import flagVertShader from "./shaders/basicTexture/vertex.glsl";
import flagFragShader from "./shaders/basicTexture/fragment.glsl";
import shaderGlobals from "./shaders/global.glsl";
import * as ENGINE from "./engine.js";

const exampleVert =
  shaderGlobals +
  `
  in  vec3 offset;
  in  float vertIndex;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float segments;
uniform float vertexCount;
uniform vec2 grassSize;


out  float vVertIndex;
void main() {

  float vertID = mod(float(vertIndex), vertexCount);
  vVertIndex = vertID;


  float xSide = mod(vertID, 2.0);
  float heightPercent = (vertID - xSide) / (segments * 2.0);
  float z = 0.0;
  float y = heightPercent * grassSize.y;
  float x = (xSide - 0.5) * (1.0 - heightPercent) * grassSize.x;

  vec3 vPosition = vec3(x,y,z) + offset;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( vPosition, 1.0 );
}
`;

const exampleFrag =
  shaderGlobals +
  `
  in float vVertIndex;

  out vec4 fragColor;
void main() {
  fragColor  = vec4(0.,1.,0., 1.);
}
`;

/**
 * Core objects
 */

const engine = new ENGINE.KubEngine();

class Grass {
  constructor(engine) {
    const instances = 100;

    const segments = 3;
    const VERTICES = (segments + 1) * 2;
    const indices = [];
    for (let i = 0; i < segments; ++i) {
      const vi = i * 2;
      indices[i * 12 + 0] = vi + 0;
      indices[i * 12 + 1] = vi + 1;
      indices[i * 12 + 2] = vi + 2;

      indices[i * 12 + 3] = vi + 2;
      indices[i * 12 + 4] = vi + 1;
      indices[i * 12 + 5] = vi + 3;

      const fi = VERTICES + vi;
      indices[i * 12 + 6] = fi + 2;
      indices[i * 12 + 7] = fi + 1;
      indices[i * 12 + 8] = fi + 0;

      indices[i * 12 + 9] = fi + 3;
      indices[i * 12 + 10] = fi + 1;
      indices[i * 12 + 11] = fi + 2;
    }

    const GRASS_PATCH_SIZE = 20;
    const vertID = new Uint8Array(VERTICES * 2);
    for (let i = 0; i < VERTICES * 2; ++i) {
      vertID[i] = i;
    }
    const offsets = [];
    const rotation = [];
    for (let i = 0; i < instances; ++i) {
      offsets.push(
        Math.randomRange(-GRASS_PATCH_SIZE * 0.5, GRASS_PATCH_SIZE * 0.5)
      );
      offsets.push(0);
      offsets.push(
        Math.randomRange(-GRASS_PATCH_SIZE * 0.5, GRASS_PATCH_SIZE * 0.5)
      );
      rotation.push(Math.randomRange(0, 2 * Math.PI));
    }

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.instanceCount = instances;

    geometry.setAttribute(
      "vertIndex",
      new THREE.Uint8BufferAttribute(vertID, 1)
    );
    geometry.setAttribute(
      "offset",
      new THREE.InstancedBufferAttribute(new Float32Array(offsets), 3)
    );
    geometry.setAttribute(
      "rotation",
      new THREE.InstancedBufferAttribute(new Float32Array(rotation), 1)
    );
    geometry.setIndex(indices);

    // material
    const material = new THREE.RawShaderMaterial({
      uniforms: {
        segments: { value: segments },
        vertexCount: { value: VERTICES },
        grassSize: { value: new THREE.Vector2(1, 5) },
      },
      vertexShader: exampleVert,
      fragmentShader: exampleFrag,
      glslVersion: THREE.GLSL3,
    });

    const mesh = new THREE.Mesh(geometry, material);
    engine.scene.add(mesh);
  }
}

class World {
  constructor(engine) {
    this.engine = engine;

    this.grass = new Grass(engine);

    const geo = new THREE.PlaneGeometry(1000, 1000);

    const material = engine.renderManager.materialManager.addMaterial(
      "flat",
      flagVertShader,
      flagFragShader
    );

    const planeMesh = new THREE.Mesh(geo, material);
    planeMesh.rotation.x = -Math.PI / 2;
    engine.scene.add(planeMesh);
  }

  update() {}
}
const world = new World(engine);
engine.world = world;

/**
 * Loading overlay
 */
const loadingShader = {
  uniforms: {
    tDiffuse: { value: null },
    uMinY: { value: 0.0 },
    uWidthY: { value: 0.005 },
    uMaxX: { value: 0.0 },
  },
  vertexShader: loadingVertexShader,
  fragmentShader: loadingFragmentShader,
};

const loadingScreen = new ShaderPass(loadingShader);
const loadingUniforms = loadingScreen.material.uniforms;
engine.composer.addPass(loadingScreen);

/**
 * Loading Animation
 */
let progressRatio = 0.0;
let currAnimation = null;
let timeTracker = { enabled: false, deltaTime: 0, elapsedTime: 0.0 };
const updateProgress = (progress) => {
  progressRatio = Math.max(progress, progressRatio);
  if (currAnimation) {
    currAnimation.kill();
  }
  currAnimation = gsap.to(loadingUniforms.uMaxX, {
    duration: 1,
    value: progressRatio,
  });
  if (progressRatio == 1) {
    currAnimation.kill();
    const timeline = gsap.timeline();
    currAnimation = timeline.to(loadingUniforms.uMaxX, {
      duration: 0.2,
      value: progressRatio,
    });
    timeline.set(timeTracker, { enabled: true });
    timeline.to(loadingUniforms.uWidthY, {
      duration: 0.1,
      delay: 0.0,
      value: 0.01,
      ease: "power1.inOut",
    });
    timeline.to(loadingUniforms.uWidthY, {
      duration: 0.1,
      value: 0.0,
      ease: "power1.in",
    });
    timeline.to(loadingUniforms.uMinY, {
      duration: 0.5,
      value: 0.5,
      ease: "power1.in",
    });
  }
};

const initLoadingAnimation = () => {
  engine.loadingManager.onProgress = (_, itemsLoaded, itemsTotal) => {
    updateProgress(itemsLoaded / itemsTotal);
  };
  if (!engine.loadingManager.hasFiles) {
    updateProgress(1);
  }
};

/**
 * Animation
 */
const tick = () => {
  engine.statsManager.stats.begin();
  for (const materialName in engine.renderManager.materialManager.materials) {
    const material =
      engine.renderManager.materialManager.materials[materialName];
    if (material.uniforms && material.uniforms.eTime) {
      material.uniforms.eTime.value = engine.timeManager.time.gameTime;
    }
  }
  engine.update();
  // update controls
  // Render engine.scene
  engine.composer.render();

  // Call tick again on the next frame
  window.requestAnimationFrame(tick);
  engine.endLoop();
  engine.statsManager.stats.end();
};

initLoadingAnimation();
tick();
