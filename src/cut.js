// cut.js — режим разреза через глобальные clipping planes.
// Плоскости заданы в локальных координатах сердца и каждый кадр переводятся
// в мировые через matrixWorld группы. Режимы: none | 4ch | sax.
import * as THREE from 'three';
import { GEOMETRY as G } from './physiology.js';
import { MITRAL, TRICUSPID, AORTIC } from './geometry/layout.js';

const planeThrough = (a, b, c) => { const p = new THREE.Plane(); p.setFromCoplanarPoints(new THREE.Vector3(...a), new THREE.Vector3(...b), new THREE.Vector3(...c)); return p; };
// Четырёхкамерная: верхушка, центр митрального и трикуспидального колец.
const PLANE_4CH = planeThrough([0, 0, 0], MITRAL.center, TRICUSPID.center);
// Трёхкамерная (выносящий тракт): верхушка, митральное кольцо, аортальное кольцо.
const PLANE_LVOT = planeThrough([0, 0, 0], MITRAL.center, AORTIC.center);

export class CutController {
  constructor(renderer, heart, camera) {
    this.renderer = renderer; this.heart = heart; this.camera = camera;
    this.mode = 'none';
    this.saxLevel = G.lvLength * 0.55;   // высота по оси ЛЖ, см
    this.flip = false;
    this.autoFace = true;                // 4ch: срезать сторону, обращённую к камере
    this._plane = new THREE.Plane();
    this._local = new THREE.Plane();
    this._tmp = new THREE.Vector3();
  }

  setMode(mode) { this.mode = mode; }
  cycleMode() { this.mode = { none: '4ch', '4ch': 'lvot', lvot: 'sax', sax: 'none' }[this.mode]; }
  moveLevel(d) { this.saxLevel = Math.min(G.lvLength + 4, Math.max(-1, this.saxLevel + d)); }

  update() {
    if (this.mode === 'none') { this.renderer.clippingPlanes = []; return; }
    if (this.mode === '4ch') this._local.copy(PLANE_4CH);
    else if (this.mode === 'lvot') this._local.copy(PLANE_LVOT);
    else this._local.set(new THREE.Vector3(0, -1, 0), this.saxLevel);
    this._plane.copy(this._local).applyMatrix4(this.heart.matrixWorld);
    let flip = this.flip;
    if (this.mode !== 'sax' && this.autoFace) {
      this.heart.getWorldPosition(this._tmp);
      const toCam = this.camera.position.clone().sub(this._tmp);
      if (this._plane.normal.dot(toCam) > 0) flip = !flip;
    }
    if (flip) this._plane.negate();
    this.renderer.clippingPlanes = [this._plane];
  }
}
