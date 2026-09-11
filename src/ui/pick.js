// pick.js — ID-проход: сцена рендерится в маленький RenderTarget материалом,
// который пишет id структуры (R) и глубину (G, B) с той же деформацией, что
// у ткани. Один буфер даёт наведение мышью (id под курсором) и заслонение
// якорей подписей. Читается асинхронно, конвейер не останавливается.
import * as THREE from 'three';
import { DEFORM_GLSL } from '../deform.js';
import { DEFORM_UNIFORMS } from '../materials.js';

const PICK_LAYER = 1;
const FAR = 120; // см; глубина кодируется долей от FAR в 16 бит

export function createPicker(engine, structures) {
  const { renderer, scene, camera, heart } = engine;
  const idMat = new THREE.ShaderMaterial({
    uniforms: { ...DEFORM_UNIFORMS, uIds: { value: new THREE.Vector3() }, uDepth: { value: 0 }, uAttrMode: { value: 0 }, uRegionConst: { value: 0 }, uFar: { value: FAR } },
    vertexShader: /* glsl */`
      #include <common>
      #include <clipping_planes_pars_vertex>
      ${DEFORM_GLSL}
      attribute float aDepth; attribute float aRegion; attribute vec2 aParam;
      uniform float uDepth, uAttrMode, uRegionConst; uniform vec3 uIds;
      varying float vId, vZ;
      void main() {
        float d = uAttrMode > 0.5 ? aDepth : uDepth;
        float region = uAttrMode > 0.5 ? aRegion : uRegionConst;
        float va = uAttrMode > 0.5 ? aParam.y : 0.0;
        vec3 q = systoleDeform(position, d, region, va);
        vec4 mvPosition = modelViewMatrix * vec4(q, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        int r = int(clamp(region, 0.0, 2.0) + 0.5);
        vId = r == 0 ? uIds.x : (r == 1 ? uIds.y : uIds.z);
        vZ = -mvPosition.z;
        #include <clipping_planes_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      #include <clipping_planes_pars_fragment>
      uniform float uFar;
      varying float vId, vZ;
      void main() {
        #include <clipping_planes_fragment>
        float d = clamp(vZ / uFar, 0.0, 1.0) * 65535.0;
        float hi = floor(d / 256.0), lo = d - hi * 256.0;
        gl_FragColor = vec4(vId / 255.0, hi / 255.0, lo / 255.0, 1.0);
      }
    `,
    side: THREE.DoubleSide, clipping: true,
  });

  // Меши структур: id по регионам; остальные меши сердца — заслонители (id 0).
  const ids = new Map();
  structures.forEach((s, i) => ids.set(s.id, i + 1));
  const targetsOf = new Map();
  for (const s of structures) {
    const list = s.targets(engine).filter((t) => t.mesh);
    targetsOf.set(s.id, list);
    for (const { mesh, regions } of list) {
      const pk = (mesh.userData.pick ||= [0, 0, 0]);
      if (regions) for (const r of regions) pk[r] = ids.get(s.id); else pk.fill(ids.get(s.id));
    }
  }
  const beforeRender = function (renderer, scene, camera, geometry, material) {
    if (material !== idMat) return;
    const pk = this.userData.pick || [0, 0, 0];
    idMat.uniforms.uIds.value.set(pk[0], pk[1], pk[2]);
    const mu = this.material.userData && this.material.userData.uniforms;
    idMat.uniforms.uAttrMode.value = mu ? mu.uAttrMode.value : 0;
    idMat.uniforms.uDepth.value = mu ? mu.uDepth.value : 0;
    idMat.uniforms.uRegionConst.value = (this.material.uniforms && this.material.uniforms.uRegion) ? this.material.uniforms.uRegion.value : 0;
    idMat.uniformsNeedUpdate = true;
  };
  heart.traverse((o) => { if (o.isMesh) { o.layers.enable(PICK_LAYER); o.onBeforeRender = beforeRender; } });

  const rt = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true, stencilBuffer: false });
  let w = 0, h = 0, buf = null, pending = false, frame = 0, dirty = true;
  const clear = new THREE.Color(0, 1, 1); // id 0, глубина = FAR

  function render() {
    const size = renderer.getSize(new THREE.Vector2());
    const nw = Math.max(4, Math.floor(size.x / 2)), nh = Math.max(4, Math.floor(size.y / 2));
    if (nw !== w || nh !== h) { w = nw; h = nh; rt.setSize(w, h); buf = new Uint8Array(w * h * 4); }
    const prevMask = camera.layers.mask, prevBg = scene.background, prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    camera.layers.set(PICK_LAYER); scene.background = null;
    scene.overrideMaterial = idMat;
    renderer.setRenderTarget(rt); renderer.setClearColor(clear, 1); renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null); renderer.setClearColor(prevClear, prevAlpha);
    scene.overrideMaterial = null; scene.background = prevBg; camera.layers.mask = prevMask;
    if (renderer.readRenderTargetPixelsAsync) {
      pending = true;
      renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h, buf).then(() => { pending = false; }, () => { pending = false; });
    } else {
      renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    }
  }

  // Координаты CSS-пикселей холста → индекс в буфере (буфер снизу вверх).
  function sample(x, y) {
    if (!buf) return null;
    const size = renderer.getSize(new THREE.Vector2());
    const px = Math.min(w - 1, Math.max(0, Math.floor((x / size.x) * w)));
    const py = Math.min(h - 1, Math.max(0, Math.floor((1 - y / size.y) * h)));
    const o = (py * w + px) * 4;
    return { id: buf[o], depth: ((buf[o + 1] * 256 + buf[o + 2]) / 65535) * FAR };
  }
  // id под курсором. Тонкие структуры (коронарные, проводящая система, хорды)
  // ищутся в окрестности и имеют приоритет над крупными: иначе в них не попасть.
  const thin = new Set(structures.filter((s) => s.group >= 4 || s.id === 'chordae').map((s) => ids.get(s.id)));
  function idAt(x, y, radius = 3) {
    const c = sample(x, y);
    if (!c) return 0;
    if (thin.has(c.id)) return c.id;
    const size = renderer.getSize(new THREE.Vector2()), sx = size.x / w, sy = size.y / h;
    for (let r = 1; r <= radius; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const s = sample(x + dx * sx, y + dy * sy);
      if (s && thin.has(s.id)) return s.id;
    }
    if (c.id) return c.id;
    for (let r = 1; r <= radius; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const s = sample(x + dx * sx, y + dy * sy);
      if (s && s.id) return s.id;
    }
    return 0;
  }

  return {
    ids, targetsOf, FAR,
    structureOf: (id) => (id > 0 ? structures[id - 1] : null),
    markDirty() { dirty = true; },
    // Раз в 3 кадра при движении, иначе раз в ~150 мс.
    update(active) {
      frame++;
      const due = active || dirty ? frame % 3 === 0 : frame % 9 === 0;
      if (due && !pending) { render(); dirty = false; }
    },
    sample, idAt,
  };
}
