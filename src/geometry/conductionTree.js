// conductionTree.js — дерево проводящей системы как тонкие трубки с временем
// активации вдоль (aAct, aClock) и эмиссионным материалом: импульс бежит
// от синусового узла по тракту к АВ-узлу, после задержки — по Гису, ножкам и
// сети Пуркинье. Деформируется тем же полем, что ткань (d = 0).
import * as THREE from 'three';
import { conductionTree } from '../conduction.js';
import { spline, tubeSurface } from './loft.js';
import { DEFORM_UNIFORMS, GLOW_UNIFORMS } from '../materials.js';
import { DEFORM_GLSL } from '../deform.js';
import { REGION } from './lvshape.js';

function treeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...DEFORM_UNIFORMS, ...GLOW_UNIFORMS, uBase: { value: new THREE.Color(0x4a5566) }, uRegion: { value: 0 } },
    vertexShader: /* glsl */`
      #include <common>
      #include <clipping_planes_pars_vertex>
      ${DEFORM_GLSL}
      attribute float aAct; attribute float aClock;
      uniform float uRegion;
      varying float vAct, vClock, vShade;
      void main() {
        vec3 q = systoleDeform(position, 0.0, uRegion, 0.0);
        vec4 mvPosition = modelViewMatrix * vec4(q, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vAct = aAct; vClock = aClock;
        vec3 n = normalize(normalMatrix * normal);
        vShade = 0.55 + 0.45 * max(n.z, 0.0);
        #include <clipping_planes_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      #include <clipping_planes_pars_fragment>
      uniform float uT, uRR, uPOnset, uPqScale, uGlow, uApdEndo;
      uniform vec3 uGlowColor, uBase;
      varying float vAct, vClock, vShade;
      void main() {
        #include <clipping_planes_fragment>
        float act = vClock > 0.5 ? uPOnset + vAct * uPqScale : vAct;
        float ph = mod(uT - act + 2.0 * uRR, uRR);
        float front = exp(-ph / 18.0);
        float plateau = 1.0 - smoothstep(uApdEndo - 60.0, uApdEndo + 20.0, ph);
        float g = smoothstep(0.0, 2.0, ph) * plateau * (0.2 + 1.0 * front);
        vec3 c = uBase * vShade + uGlowColor * g * uGlow;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    clipping: true,
  });
}

export function buildConductionTree() {
  const tree = conductionTree();
  const group = new THREE.Group();
  group.name = 'conduction';
  const mats = { vent: treeMaterial(), la: treeMaterial(), ra: treeMaterial() };
  mats.la.uniforms.uRegion.value = REGION.LA; mats.ra.uniforms.uRegion.value = REGION.RA;
  const withAct = (geometry, actAt, clock) => {
    const n = geometry.getAttribute('position').count, param = geometry.getAttribute('aParam').array;
    const act = new Float32Array(n), clk = new Float32Array(n).fill(clock === 'p' ? 1 : 0);
    for (let k = 0; k < n; k++) act[k] = actAt(param[k * 2 + 1]);
    geometry.setAttribute('aAct', new THREE.BufferAttribute(act, 1));
    geometry.setAttribute('aClock', new THREE.BufferAttribute(clk, 1));
    return geometry;
  };
  for (const b of tree.branches) {
    const curve = spline(b.points, 0.5);
    const len = curve.getLength();
    // Время вдоль трубки — линейная интерполяция таблицы времён по доле длины.
    const cum = [0]; for (let i = 1; i < b.points.length; i++) cum.push(cum[i - 1] + Math.hypot(...b.points[i].map((x, d) => x - b.points[i - 1][d])));
    const total = cum[cum.length - 1];
    const timeAt = (f) => { const s = f * total; let i = 1; while (i < cum.length - 1 && cum[i] < s) i++; const a = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return b.times[i - 1] + (b.times[i] - b.times[i - 1]) * a; };
    const surf = tubeSurface({ curve, radius: () => b.radius, segments: Math.max(8, Math.round(len * 6)), radial: 8, closeStart: true, closeEnd: true });
    const mesh = new THREE.Mesh(withAct(surf.geometry, timeAt, b.clock), b.name === 'internodal' ? mats.ra : mats.vent);
    mesh.name = b.name;
    group.add(mesh);
  }
  for (const [name, nd] of Object.entries(tree.nodes)) {
    const g = new THREE.SphereGeometry(nd.r, 16, 12);
    g.translate(...nd.p);
    const n = g.getAttribute('position').count;
    g.setAttribute('aParam', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    g.setAttribute('aAct', new THREE.BufferAttribute(new Float32Array(n).fill(nd.t), 1));
    g.setAttribute('aClock', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
    const mesh = new THREE.Mesh(g, mats.ra);
    mesh.name = name;
    group.add(mesh);
  }
  return {
    group, tree,
    // Режим сквозь стенки: без теста глубины, поверх всего.
    setXray(on) { for (const m of Object.values(mats)) { m.depthTest = !on; m.transparent = on; } group.renderOrder = on ? 10 : 0; },
  };
}
