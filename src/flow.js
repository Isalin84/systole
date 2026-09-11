// flow.js — слой кровотока: частицы на путях (flowpaths.js). Положение
// частицы — функция времени: s = (s₀ + C_k(T)/A_k) mod L_k, где C_k —
// накопленный объём через привод сегмента (клапан или сглаженный поток
// сосуда). Ничего не интегрируется: пауза и скраб воспроизводимы, через
// закрытый клапан частицы не проходят, потому что накопленный объём через
// него не растёт. В вершинном шейдере точка пути деформируется тем же полем,
// что и ткань.
import * as THREE from 'three';
import { buildSegments, pathsTexture, DRIVES, SAMPLES } from './flowpaths.js';
import { DEFORM_UNIFORMS } from './materials.js';
import { DEFORM_GLSL } from './deform.js';

export const FLOW_COLORS = { venous: 0x6f86c8, arterial: 0xe0574d };

// Накопленные объёмы приводов (мл) для удара и момента t в нём.
export function driveVolumes(cycle, t, beat) {
  const c = cycle.cumFlow(t), sv = cycle.lv.sv, base = beat.svBefore;
  const steady = base + sv * cycle.wrap(t) / cycle.rr;
  return {
    mitral: base + c.lvIn, aortic: base + c.lvOut, tricuspid: base + c.rvIn, pulmonary: base + c.rvOut,
    venous: steady,
    systemic: 0.6 * steady + 0.4 * (base + c.lvOut),
    pulmArt: 0.6 * steady + 0.4 * (base + c.rvOut),
    laa: beat.aBefore + c.laA,
  };
}

export function buildFlow({ vessels, total = 6000, seed = 7 }) {
  const segs = buildSegments(vessels);
  const NSEG = segs.length;
  const tex = pathsTexture(segs);
  // Число частиц на сегмент ∝ длина × сечение.
  const weights = segs.map((s) => s.length * s.area), wsum = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map((w) => Math.max(20, Math.round((total * w) / wsum)));
  const n = counts.reduce((a, b) => a + b, 0);
  let rs = seed >>> 0; const rand = () => { rs = (rs + 0x6D2B79F5) >>> 0; let t = rs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const aSeg = new Float32Array(n), aPhase = new Float32Array(n), aRadial = new Float32Array(n * 2), aSeed = new Float32Array(n), pos = new Float32Array(n * 3);
  let i = 0;
  segs.forEach((s, k) => {
    for (let j = 0; j < counts[k]; j++, i++) {
      aSeg[i] = k; aPhase[i] = rand() * s.length;
      aRadial[i * 2] = Math.sqrt(rand()) * 0.85; aRadial[i * 2 + 1] = rand() * Math.PI * 2;
      aSeed[i] = rand();
    }
  });
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('aSeg', new THREE.BufferAttribute(aSeg, 1));
  geom.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
  geom.setAttribute('aRadial', new THREE.BufferAttribute(aRadial, 2));
  geom.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
  geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 8, 0), 30);

  const uCum = new Float32Array(NSEG), uLen = new Float32Array(NSEG), uArea = new Float32Array(NSEG), uSide = new Float32Array(NSEG), uRegion = new Float32Array(NSEG);
  segs.forEach((s, k) => { uLen[k] = s.length; uArea[k] = s.area / s.share; uSide[k] = s.side; uRegion[k] = s.region; });

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...DEFORM_UNIFORMS,
      uPaths: { value: tex }, uTexH: { value: NSEG * 3 },
      uCum: { value: uCum }, uLen: { value: uLen }, uArea: { value: uArea }, uSide: { value: uSide }, uRegion: { value: uRegion },
      uPointScale: { value: 1 }, uVenous: { value: new THREE.Color(FLOW_COLORS.venous) }, uArterial: { value: new THREE.Color(FLOW_COLORS.arterial) },
    },
    defines: { NSEG, SAMPLES: SAMPLES.toFixed(1) },
    vertexShader: /* glsl */`
      #include <common>
      #include <clipping_planes_pars_vertex>
      ${DEFORM_GLSL}
      attribute float aSeg; attribute float aPhase; attribute vec2 aRadial; attribute float aSeed;
      uniform sampler2D uPaths; uniform float uTexH, uPointScale;
      uniform float uCum[NSEG]; uniform float uLen[NSEG]; uniform float uArea[NSEG]; uniform float uSide[NSEG]; uniform float uRegion[NSEG];
      varying float vSide; varying float vSeed;
      vec4 row(float r, float i) { return texture2D(uPaths, vec2((i + 0.5) / SAMPLES, (r + 0.5) / uTexH)); }
      void main() {
        int k = int(aSeg + 0.5);
        float s = mod(aPhase + uCum[k] / uArea[k], uLen[k]);
        float u = s / uLen[k] * (SAMPLES - 1.0);
        float i0 = floor(u), f = u - i0, i1 = min(i0 + 1.0, SAMPLES - 1.0), r = 3.0 * float(k);
        vec4 P = mix(row(r, i0), row(r, i1), f);
        vec3 N = mix(row(r + 1.0, i0), row(r + 1.0, i1), f).xyz;
        vec3 B = mix(row(r + 2.0, i0), row(r + 2.0, i1), f).xyz;
        vec3 p = P.xyz + (cos(aRadial.y) * N + sin(aRadial.y) * B) * aRadial.x * P.w;
        vec3 q = systoleDeform(p, 0.0, uRegion[k], 0.0);
        vec4 mvPosition = modelViewMatrix * vec4(q, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = uPointScale * (0.7 + 0.6 * aSeed) / max(-mvPosition.z, 1.0);
        gl_PointSize = clamp(gl_PointSize, 1.5, 12.0);
        vSide = uSide[k]; vSeed = aSeed;
        #include <clipping_planes_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      #include <clipping_planes_pars_fragment>
      uniform vec3 uVenous, uArterial;
      varying float vSide; varying float vSeed;
      void main() {
        #include <clipping_planes_fragment>
        float d = length(gl_PointCoord - 0.5);
        float a = 1.0 - smoothstep(0.3, 0.5, d);
        if (a < 0.25) discard;
        vec3 c = mix(uVenous, uArterial, vSide) * (1.1 + 0.5 * vSeed);
        gl_FragColor = vec4(c, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true, depthWrite: true, clipping: true,
  });
  const points = new THREE.Points(geom, material);
  points.name = 'flow';
  points.renderOrder = -1;
  points.frustumCulled = false;

  return {
    points, segs, count: n,
    // Обновить приводы для момента t удара beat.
    update(cycle, t, beat) {
      const dv = driveVolumes(cycle, t, beat);
      segs.forEach((s, k) => { uCum[k] = dv[s.drive]; });
      material.uniforms.uPointScale.value = 130 * (window.devicePixelRatio ? Math.min(window.devicePixelRatio, 2) : 1);
    },
  };
}
