import "./style.css";
import * as THREE from "three";
import { gsap } from "gsap";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import loadingVertexShader from "./shaders/loading/vertex.glsl";
import loadingFragmentShader from "./shaders/loading/fragment.glsl";
import basicTextureVertexShader from "./shaders/basicTexture/vertex.glsl";
import basicTextureFragmentShader from "./shaders/basicTexture/fragment.glsl";
import * as ENGINE from "./engine.js";

/**
 * Core objects
 */

const engine = new ENGINE.KubEngine();

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

const textureShader = engine.renderManager.materialManager.addMaterial(
  "texture",
  basicTextureVertexShader,
  basicTextureFragmentShader,
  {
    unique: true,
  }
);
const boxG = new THREE.BoxGeometry(1, 1);
const boxMesh = new THREE.Mesh(boxG, textureShader);
engine.scene.add(boxMesh);
boxMesh.castShadow = true;
boxMesh.receiveShadow = true;
boxMesh.material.shading = THREE.SmoothShading;

/**
 *  Box
 */

const rotateBox = (time) => {
  boxMesh.setRotationFromEuler(new THREE.Euler(0, time, 0));
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
  rotateBox(engine.timeManager.time.gameTime);
  engine.composer.render();

  // Call tick again on the next frame
  window.requestAnimationFrame(tick);
  engine.endLoop();
  engine.statsManager.stats.end();
};

initLoadingAnimation();
tick();
