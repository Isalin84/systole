// materials.js — тканевые материалы. Один шейдер (MeshPhysicalMaterial +
// onBeforeCompile) на все ткани; варианты различаются униформами: цвета
// эндо/эпи и среза, шероховатость и влажность по глубине, сила рассеяния,
// волокна, трабекулы, жир, режим изнанки (uCapMode: 1 — оболочка, изнанка =
// срез; 0 — одиночная поверхность, изнанка = та же ткань).
//
// Вершинная часть — деформация из deform.js (проход 3), глубина в стенке
// берётся из атрибута aDepth или из униформы uDepth. Фрагментная часть —
// tissue.glsl.js. Униформы состояния цикла общие и обновляются раз в кадр.
import * as THREE from 'three';
import { DEFORM_GLSL, deformStatics, REST_STATE } from './deform.js';
import { TISSUE_VERT_PARS, TISSUE_VERT_MAIN, TISSUE_FRAG_PARS, TISSUE_FRAG_COLOR, TISSUE_FRAG_ROUGHNESS, TISSUE_FRAG_BUMP, TISSUE_FRAG_CLEARCOAT, TISSUE_FRAG_SSS, TISSUE_FRAG_CAP } from './shaders/tissue.glsl.js';

// Ось крови: венозная → артериальная. Те же цвета пойдут в кровоток (проход 5).
export const BLOOD = { venous: 0x252b45, arterial: 0x6e1a1c };

const MYO = {
  endo: 0x4a2226, epi: 0x7e463d, cutEndo: 0x5e2529, cutEpi: 0x7d3f3a,
  sss: 0xd94a36, fat: 0xa8845c, roughEndo: 0.42, roughEpi: 0.7, ccEndo: 0.35, ccEpi: 0.12,
  sssAmount: 0.16, fiber: 1, trabec: 1, fatAmount: 1, cap: 1, rim: 0.1, bump: 3.5,
};
export const PALETTE = {
  myocardium:    { ...MYO, depth: 'attr' },
  endocardium:   { ...MYO, depth: 0, trabec: 0.6, fatAmount: 0 },           // папиллярные мышцы
  annulus:       { ...MYO, depth: 0.6, cap: 0, fatAmount: 0, fiber: 0.5, trabec: 0 },
  plate:         { ...MYO, depth: 0.3, cap: 0, fatAmount: 0, trabec: 0.5 },
  arterialWall:  { endo: 0x7a2626, epi: 0x8e2f2c, cutEndo: 0x66201f, cutEpi: 0x742826, sss: 0xd9503c, fat: 0, roughEndo: 0.5, roughEpi: 0.55, ccEndo: 0.3, ccEpi: 0.22, sssAmount: 0.1, fiber: 0.3, trabec: 0, fatAmount: 0, cap: 1, rim: 0.08, bump: 1.5, depth: 1 },
  venousWall:    { endo: 0x3d4a6c, epi: 0x4a5878, cutEndo: 0x2c3652, cutEpi: 0x343f5c, sss: 0x7f90cc, fat: 0, roughEndo: 0.55, roughEpi: 0.6, ccEndo: 0.28, ccEpi: 0.2, sssAmount: 0.08, fiber: 0.25, trabec: 0, fatAmount: 0, cap: 1, rim: 0.08, bump: 1.5, depth: 1 },
  arterialLumen: { endo: BLOOD.arterial, epi: BLOOD.arterial, cutEndo: 0x66201f, cutEpi: 0x742826, sss: 0xd9503c, fat: 0, roughEndo: 0.3, roughEpi: 0.3, ccEndo: 0.4, ccEpi: 0.4, sssAmount: 0.03, fiber: 0, trabec: 0, fatAmount: 0, cap: 1, rim: 0.08, bump: 0, depth: 0 },
  venousLumen:   { endo: BLOOD.venous, epi: BLOOD.venous, cutEndo: 0x2c3652, cutEpi: 0x343f5c, sss: 0x7f90cc, fat: 0, roughEndo: 0.3, roughEpi: 0.3, ccEndo: 0.4, ccEpi: 0.4, sssAmount: 0.03, fiber: 0, trabec: 0, fatAmount: 0, cap: 1, rim: 0.08, bump: 0, depth: 0 },
  occlusion:     { endo: 0x241214, epi: 0x241214, cutEndo: 0x1a0d0e, cutEpi: 0x1a0d0e, sss: 0x000000, fat: 0, roughEndo: 0.75, roughEpi: 0.75, ccEndo: 0.1, ccEpi: 0.1, sssAmount: 0, fiber: 0, trabec: 0, fatAmount: 0, cap: 0, rim: 0, bump: 0, depth: 1 },
  coronary:      { endo: 0x9a2f2a, epi: 0x9a2f2a, cutEndo: 0x66201f, cutEpi: 0x66201f, sss: 0xd9503c, fat: 0, roughEndo: 0.42, roughEpi: 0.42, ccEndo: 0.45, ccEpi: 0.45, sssAmount: 0.12, fiber: 0, trabec: 0, fatAmount: 0, cap: 1, rim: 0.08, bump: 0, depth: 1 },
  valve:         { endo: 0xd8cab4, epi: 0xd8cab4, cutEndo: 0xbfae96, cutEpi: 0xbfae96, sss: 0xffd0a8, fat: 0, roughEndo: 0.48, roughEpi: 0.48, ccEndo: 0.55, ccEpi: 0.55, sssAmount: 0.22, fiber: 0.15, trabec: 0, fatAmount: 0, cap: 0, rim: 0.05, bump: 1.5, depth: 0, sheen: 0.3 },
  chordae:       { endo: 0xe6dfd0, epi: 0xe6dfd0, cutEndo: 0xb3a792, cutEpi: 0xb3a792, sss: 0xffd0a8, fat: 0, roughEndo: 0.5, roughEpi: 0.5, ccEndo: 0.3, ccEpi: 0.3, sssAmount: 0.15, fiber: 0, trabec: 0, fatAmount: 0, cap: 1, rim: 0.04, bump: 0, depth: 0 },
};

// Общие униформы деформации: постоянные из геометрии + состояние цикла.
export const DEFORM_UNIFORMS = (() => {
  const U = deformStatics();
  const f = (v) => ({ value: v });
  return {
    uL: f(U.L), uR: f(U.R), uApexFrac: f(U.apexFrac), uTaper: f(U.taper),
    uWallApex: f(U.wallApex), uWallBase: f(U.wallBase), uRvWall: f(U.rvWall),
    uTheta0: f(U.theta0), uTheta1: f(U.theta1), uMargin: f(U.margin), uVRvLo: f(U.vRvLo), uVRvHi: f(U.vRvHi),
    uFade: f(U.fade), uKappa: f(U.kappa), uKappaRv: f(U.kappaRv), uApexShare: f(U.apexShare),
    uBaseFrac: f(U.baseFrac), uBaseBlendV: f(U.baseBlendV), uFunnelFade: f(U.funnelFade), uApexCap: f(U.apexCap),
    uLaCenter: f(new THREE.Vector3(...U.laCenter)), uRaCenter: f(new THREE.Vector3(...U.raCenter)),
    uS: f(1), uEll: f(0), uC: f(0), uK: f(1), uTau: f(0), uSla: f(1), uSra: f(1),
    uS2: f(1), uC2: f(0), uWallThin: f(0), uHypo: f(0),
    uZoneMode: f(0), uZoneThetaC: f(0), uZoneHalfW: f(0), uZoneSoft: f(0.01), uZoneVTop: f(0), uZoneVApex: f(-1),
  };
})();
// Постоянные части сценария: зона, гипокинез, истончение (из deformStatics(...)).
export function setDeformStatics(U) {
  const D = DEFORM_UNIFORMS, Z = U.zone;
  D.uZoneMode.value = Z.mode; D.uZoneThetaC.value = Z.thetaC; D.uZoneHalfW.value = Z.halfW; D.uZoneSoft.value = Z.soft;
  D.uZoneVTop.value = Z.vTop; D.uZoneVApex.value = Z.vApex;
  D.uHypo.value = U.hypo; D.uWallThin.value = U.wallThin;
}

// Электрическая активность: время цикла и параметры свечения (общие).
export const GLOW_UNIFORMS = {
  uT: { value: 0 }, uRR: { value: 923 }, uPOnset: { value: -160 }, uPqScale: { value: 1 }, uGlow: { value: 1 },
  uApdEndo: { value: 300 }, uApdEpi: { value: 250 }, uApdAtr: { value: 160 },
  uGlowColor: { value: new THREE.Color(0xa8e4ff) },
};
export function setGlowState({ t, rr, pOnset, pqScale, glow }) {
  GLOW_UNIFORMS.uT.value = t; GLOW_UNIFORMS.uRR.value = rr; GLOW_UNIFORMS.uPOnset.value = pOnset;
  GLOW_UNIFORMS.uPqScale.value = pqScale; if (glow !== undefined) GLOW_UNIFORMS.uGlow.value = glow;
}

export function setDeformState(S = REST_STATE) {
  DEFORM_UNIFORMS.uS.value = S.s; DEFORM_UNIFORMS.uEll.value = S.ell; DEFORM_UNIFORMS.uC.value = S.c;
  DEFORM_UNIFORMS.uK.value = S.k; DEFORM_UNIFORMS.uTau.value = S.tau;
  DEFORM_UNIFORMS.uSla.value = S.sLa; DEFORM_UNIFORMS.uSra.value = S.sRa;
  DEFORM_UNIFORMS.uS2.value = S.s2; DEFORM_UNIFORMS.uC2.value = S.c2;
}

const VERTEX_DEFORM = /* glsl */`
  float sysD = uAttrMode > 0.5 ? aDepth : uDepth;
  float sysRegion = uAttrMode > 0.5 ? aRegion : 0.0;
  float sysVa = uAttrMode > 0.5 ? aParam.y : 0.0;
  vec3 sysP0 = systoleDeform(position, sysD, sysRegion, sysVa);
  // Вес зоны гипокинеза для подкраски (только желудочки).
  float sysZ = sysRegion < 1.5 ? uHypo * sysZoneW(atan(position.z, position.x), clamp(position.y / uL, 0.0, 1.0)) : 0.0;
  ${TISSUE_VERT_MAIN}
  // Нормаль — конечными разностями по полю в касательной плоскости.
  // Вырожденные вершины (нулевая нормаль) не должны давать NaN.
  vec3 sysN0 = dot(normal, normal) > 0.25 ? normal : vec3(0.0, 1.0, 0.0);
  vec3 sysT1 = normalize(cross(sysN0, abs(sysN0.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 sysT2 = cross(sysN0, sysT1);
  vec3 sysP1 = systoleDeform(position + sysT1 * 0.02, sysD, sysRegion, sysVa);
  vec3 sysP2 = systoleDeform(position + sysT2 * 0.02, sysD, sysRegion, sysVa);
  vec3 objectNormal = normalize(cross(sysP1 - sysP0, sysP2 - sysP0));
`;

const col = (c) => ({ value: new THREE.Color(c) });
export function makeTissueMaterial(p) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.5, metalness: 0, side: THREE.DoubleSide,
    clearcoat: 1, clearcoatRoughness: 0.4, envMapIntensity: 0.35,
    sheen: p.sheen || 0, sheenColor: new THREE.Color(0xffe8d0), sheenRoughness: 0.6,
  });
  const uniforms = {
    uDepth: { value: p.depth === 'attr' ? 0 : p.depth },
    uAttrMode: { value: p.depth === 'attr' ? 1 : 0 },
    uEndoColor: col(p.endo), uEpiColor: col(p.epi), uCutEndo: col(p.cutEndo), uCutEpi: col(p.cutEpi),
    uSssColor: col(p.sss), uFatColor: col(p.fat || 0), uZoneColor: col(0x9a9298),
    uRoughEndo: { value: p.roughEndo }, uRoughEpi: { value: p.roughEpi },
    uCcEndo: { value: p.ccEndo }, uCcEpi: { value: p.ccEpi },
    uSss: { value: p.sssAmount }, uFiber: { value: p.fiber }, uTrabec: { value: p.trabec }, uFat: { value: p.fatAmount },
    uCapMode: { value: p.cap }, uRim: { value: p.rim }, uBump: { value: p.bump }, uNoiseScale: { value: 1.6 },
    uHighlight: { value: 0 }, uHighlightRegion: { value: -1 }, uHighlightColor: col(0xd8ecff),
  };
  m.userData.uniforms = uniforms;
  m.userData.cap = p.cap;
  m.userData.palette = p;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, DEFORM_UNIFORMS, GLOW_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + DEFORM_GLSL + TISSUE_VERT_PARS + '\nattribute float aDepth;\nattribute float aRegion;\nattribute vec2 aParam;\nuniform float uDepth, uAttrMode;')
      .replace('#include <beginnormal_vertex>', VERTEX_DEFORM)
      .replace('#include <begin_vertex>', 'vec3 transformed = sysP0;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + TISSUE_FRAG_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + TISSUE_FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', TISSUE_FRAG_ROUGHNESS)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + TISSUE_FRAG_BUMP)
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n' + TISSUE_FRAG_CLEARCOAT)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + TISSUE_FRAG_SSS)
      .replace('#include <opaque_fragment>', TISSUE_FRAG_CAP + '\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'tissue-v4' + (p.sheen ? '-sheen' : '');
  return m;
}

// Режим «рентген»: полупрозрачная ткань без крышки среза, чтобы видеть
// кровоток сквозь стенки. Частицы рисуются раньше (renderOrder −1) с записью
// глубины, ткань поверх них с альфой.
export function setXray(materials, on) {
  for (const m of Object.values(materials)) {
    m.transparent = on; m.opacity = on ? 0.24 : 1; m.depthWrite = !on;
    m.userData.uniforms.uCapMode.value = on ? 0 : m.userData.cap;
    m.needsUpdate = true;
  }
}

export function makeMaterials() {
  const out = {};
  for (const [k, v] of Object.entries(PALETTE)) out[k] = makeTissueMaterial(v);
  return out;
}
