// tissue.glsl.js — вставки в шейдер MeshPhysicalMaterial для ткани.
// Всё процедурно от недеформированного положения вершины vRest (см) и
// глубины в стенке vDepth (0 эндокард, 1 эпикард):
//   цвет эндо→эпи + низкочастотный шум, волокна миокарда со спиральным
//   углом −60°…+60° по глубине, трабекулы на эндокарде, эпикардиальный жир
//   в бороздах, bump по волокнам, обратное рассеяние от ключевого света,
//   крышка среза (изнанка оболочки) с градиентом эндо→эпи и освещением по
//   нормали плоскости, влажная кромка у среза.
import { NOISE_GLSL } from './noise.glsl.js';

export const TISSUE_VERT_PARS = /* glsl */`
varying vec3 vRest;
varying float vDepth;
varying float vRegion;
varying float vAct;
varying float vClock;
varying float vZone;
attribute float aAct;
attribute float aClock;
`;

// После вычисления sysP0/sysD/sysRegion в вершинном шейдере.
export const TISSUE_VERT_MAIN = /* glsl */`
vRest = position;
vDepth = sysD;
vRegion = sysRegion;
vAct = aAct;
vClock = aClock;
vZone = sysZ;
`;

export const TISSUE_FRAG_PARS = /* glsl */`
uniform vec3 uEndoColor, uEpiColor, uCutEndo, uCutEpi, uSssColor, uFatColor;
uniform float uRoughEndo, uRoughEpi, uCcEndo, uCcEpi, uSss, uFiber, uTrabec, uFat, uCapMode, uRim, uBump, uNoiseScale;
uniform float uL, uTheta0, uTheta1;
uniform float uT, uRR, uPOnset, uPqScale, uGlow, uApdEndo, uApdEpi, uApdAtr, uAttrMode;
uniform vec3 uGlowColor, uZoneColor, uHighlightColor;
uniform float uHighlight, uHighlightRegion;
varying vec3 vRest;
varying float vDepth;
varying float vRegion;
varying float vAct;
varying float vClock;
varying float vZone;
${NOISE_GLSL}
// Потенциал действия в точке: фронт деполяризации ярко, плато тускло,
// реполяризация — угасание к концу APD (эпикард гаснет раньше эндокарда).
float sysGlow() {
  if (uGlow < 0.5) return 0.0;
  float act = vClock > 0.5 ? uPOnset + vAct * uPqScale : vAct;
  float ph = mod(uT - act + 2.0 * uRR, uRR);
  float apd = vClock > 0.5 ? uApdAtr : mix(uApdEndo, uApdEpi, vDepth);
  float front = exp(-ph / 22.0);
  float plateau = 1.0 - smoothstep(apd - 50.0, apd + 30.0, ph);
  return smoothstep(0.0, 3.0, ph) * plateau * (0.06 + 0.55 * front);
}
// Шум, растянутый вдоль волокна: волокно лежит в касательной плоскости
// под спиральным углом alpha к окружному направлению.
float sysFiberNoise(vec3 p, float d, float kAlong, float kAcross) {
  float theta = atan(p.z, p.x);
  vec3 t = vec3(-sin(theta), 0.0, cos(theta));
  vec3 r = vec3(cos(theta), 0.0, sin(theta));
  float a = radians(mix(-60.0, 60.0, d));
  vec3 f = cos(a) * t + sin(a) * vec3(0.0, 1.0, 0.0);
  vec3 b = normalize(cross(f, r));
  vec3 q = vec3(dot(p, f) * kAlong, dot(p, r) * kAcross, dot(p, b) * kAcross);
  return sysNoise(q);
}
float sysAngDist2(float a, float b) { float d = mod(a - b, 6.28318530718); return min(d, 6.28318530718 - d); }
// Маска жира: АВ-борозда и межжелудочковые борозды, только на желудочках.
float sysFatMask(vec3 p, float region) {
  if (region > 2.5) return 0.0;
  float theta = atan(p.z, p.x);
  float av = 1.0 - smoothstep(0.15, 0.55, abs(p.y - uL));
  float dg = min(sysAngDist2(theta, uTheta0), sysAngDist2(theta, uTheta1));
  float iv = (1.0 - smoothstep(0.04, 0.12, dg)) * smoothstep(0.15, 0.35, p.y / uL);
  return max(av, iv);
}
vec3 sysPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
  vec3 vSigmaX = normalize(dFdx(surf_pos));
  vec3 vSigmaY = normalize(dFdy(surf_pos));
  vec3 R1 = cross(vSigmaY, surf_norm);
  vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`;

// Вместо #include <color_fragment>: базовый цвет и все шумы (локальные
// переменные остаются в области видимости main для следующих вставок).
export const TISSUE_FRAG_COLOR = /* glsl */`
float sysN = sysFbm(vRest * uNoiseScale);
// Два слоя волокон разного масштаба, чтобы не читалась регулярная сетка шума.
float sysFib = 0.6 * sysFiberNoise(vRest, vDepth, 0.5, 2.6) + 0.4 * sysFiberNoise(vRest + 3.1, vDepth, 1.1, 5.5);
// Детали затухают с расстоянием, чтобы не было муара.
float sysLod = 1.0 - smoothstep(0.02, 0.08, fwidth(vRest.x + vRest.y + vRest.z));
float sysEndoW = 1.0 - smoothstep(0.0, 0.35, vDepth);
float sysTrab = sysFbm(vRest * vec3(1.1, 0.5, 1.1) + 7.0);
float sysFatN = sysFbm(vRest * 3.0 + 11.0);
float sysFat = uFat * smoothstep(0.7, 1.0, vDepth) * sysFatMask(vRest, vRegion) * smoothstep(0.3, 0.65, sysFatN) * 0.3;
vec3 sysBase = mix(uEndoColor, uEpiColor, vDepth);
sysBase *= 1.0 + 0.1 * (sysN - 0.44) + sysLod * (uFiber * 0.07 * (sysFib - 0.5) + uTrabec * sysEndoW * 0.09 * (sysTrab - 0.44));
sysBase = mix(sysBase, uFatColor * (0.9 + 0.2 * sysN), sysFat);
// Зона гипокинеза: бледнее и холоднее — «этот участок не работает».
sysBase = mix(sysBase, uZoneColor, 0.45 * vZone);
diffuseColor.rgb *= sysBase;
`;

export const TISSUE_FRAG_ROUGHNESS = /* glsl */`
float roughnessFactor = mix(uRoughEndo, uRoughEpi, vDepth) + 0.3 * sysFat + 0.08 * (sysN - 0.44);
`;

// После #include <normal_fragment_maps>: bump по волокнам и трабекулам.
export const TISSUE_FRAG_BUMP = /* glsl */`
{
  float sysH = uFiber * 0.35 * sysFib + uTrabec * sysEndoW * 0.9 * sysTrab;
  vec2 sysDH = vec2(dFdx(sysH), dFdy(sysH)) * uBump * sysLod;
  normal = sysPerturb(-vViewPosition, normal, sysDH, faceDirection);
}
`;

// После #include <lights_physical_fragment>: влажность по глубине.
export const TISSUE_FRAG_CLEARCOAT = /* glsl */`
#ifdef USE_CLEARCOAT
material.clearcoat *= mix(uCcEndo, uCcEpi, vDepth) * (1.0 - 0.8 * sysFat);
#endif
`;

// После #include <lights_fragment_end>: обратное рассеяние от ключевого света.
export const TISSUE_FRAG_SSS = /* glsl */`
#if NUM_DIR_LIGHTS > 0
{
  vec3 sysLd = directionalLights[0].direction;
  float sysBack = pow(saturate(dot(geometryViewDir, -(sysLd + geometryNormal * 0.35))), 3.0);
  float sysThick = 1.0 - 0.5 * vDepth;
  float sysWrap = saturate(dot(geometryNormal, sysLd) * 0.5 + 0.5);
  reflectedLight.indirectDiffuse += directionalLights[0].color * uSssColor * uSss * (sysBack * sysThick + 0.1 * sysWrap);
}
#endif
`;

// Перед #include <opaque_fragment>: крышка среза и кромка.
export const TISSUE_FRAG_CAP = /* glsl */`
float sysG = uAttrMode > 0.5 ? sysGlow() : 0.0;
if (!gl_FrontFacing && uCapMode > 0.5) {
  vec3 sysCut = mix(uCutEndo, uCutEpi, vDepth) * (1.0 + 0.3 * (sysN - 0.44) + 0.16 * uFiber * (sysFib - 0.5));
  sysCut = mix(sysCut, uZoneColor * 0.75, 0.45 * vZone);
  float sysLam = 0.9;
  #if NUM_CLIPPING_PLANES > 0 && NUM_DIR_LIGHTS > 0
    vec3 sysPn = normalize(clippingPlanes[0].xyz);
    sysLam = 0.62 + 0.5 * max(dot(sysPn, directionalLights[0].direction), 0.0);
  #endif
  outgoingLight = sysCut * sysLam;
}
outgoingLight += uGlowColor * sysG * uGlow;
// Подсветка структуры при наведении/выборе: холодный ободок по Френелю, только в своём регионе.
if (uHighlight > 0.0 && (uHighlightRegion < -0.5 || abs(vRegion - uHighlightRegion) < 0.5)) {
  float sysFr = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 2.0);
  outgoingLight = mix(outgoingLight, outgoingLight * 1.2 + uHighlightColor * (0.04 + 0.35 * sysFr), uHighlight);
}
#if NUM_CLIPPING_PLANES > 0
if (gl_FrontFacing) {
  float sysDc = clippingPlanes[0].w - dot(vClipPosition, clippingPlanes[0].xyz);
  outgoingLight += uRim * exp(-max(sysDc, 0.0) / 0.07) * mix(uCutEndo, uCutEpi, vDepth) * 2.5;
}
#endif
`;
