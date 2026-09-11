// scene.js — сцена, камера, свет, окружение, орбита.
// Свет: тёплый ключ сверху-справа-спереди, холодный заполняющий слева,
// тёплый контровой сзади-снизу, слабый полусферический. Окружение — PMREM от
// процедурной комнаты (environment.js), фон — сфера-градиент.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeEnvironment, makeBackground } from './environment.js';

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x130a0e);
  scene.environment = makeEnvironment(renderer);
  scene.environmentIntensity = 0.4;
  scene.add(makeBackground());

  const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 300);
  camera.position.set(0, 3, 40);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0, 0);
  controls.minDistance = 8;
  controls.maxDistance = 90;

  const hemi = new THREE.HemisphereLight(0x8a94a6, 0x3a1c20, 0.55);
  const key = new THREE.DirectionalLight(0xffe9d6, 2.0);
  key.position.set(6, 10, 8);
  const fill = new THREE.DirectionalLight(0x9fb0e6, 0.6);
  fill.position.set(-9, 2, -3);
  const rim = new THREE.DirectionalLight(0xffd2c4, 1.2);
  rim.position.set(-2, -6, -10);
  scene.add(hemi, key, fill, rim);

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  return { renderer, scene, camera, controls, resize };
}
