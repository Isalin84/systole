// deform.js — деформация миокарда как поле в локальных координатах сердца.
// Чистый модуль без three.js: одна и та же формула записана на JS
// (deformPoint — для тестов и проверки объёма) и на GLSL (DEFORM_GLSL — для
// вершинного шейдера). Изменяя одну, менять и другую построчно.
//
// Вход: положение вершины p (см), глубина в стенке d (0 эндокард, 1 эпикард),
// регион (0 ЛЖ, 1 перегородка, 2 ПЖ, 3 ЛП, 4 ПП) и высота в предсердии va
// (0 у кольца, 1 у крыши). Состояние S — из цикла в момент t.
//
// Поле (ось ЛЖ — Y, верхушка в начале координат, основание на y = L):
//   продольное: y' = y·(1 − ℓ), верхушка неподвижна;
//   радиальное ЛЖ: ρ' = ρ·S(v) + d·w₀(v)·(1 + κc − S), S — масштаб полости,
//     у основания ослаблен (кольцо сужается меньше, чем полость);
//   радиальное ПЖ: + (ρ − ρ_endo − w₀)·(k − S) + d·rvWall·(1 + κ_rv·c − k);
//   скручивание: поворот вокруг Y на τ·(apexShare·(1 − v) − (1 − apexShare)·v);
//   над основанием всё затухает по высоте; предсердия дополнительно
//   масштабируются относительно своего центра.
import { GEOMETRY as G, VOLUMES, MECHANICS as M } from './physiology.js';
import { profile, vParam, lvWall, rvWidth, RV_MARGIN } from './geometry/lvshape.js';
import { LA, RA } from './geometry/layout.js';

const TAU = Math.PI * 2;
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const angDist = (a, b) => { const d = ((a - b) % TAU + TAU) % TAU; return Math.min(d, TAU - d); };

// Региональная механика: вес зоны w(θ, v) ∈ [0, 1] от угла (центр θc, полуширина,
// мягкость края) и высоты (до vTop; ниже vApex — вся окружность). Локальное
// состояние сокращения = mix(основное, второе, w): для гипокинеза второе —
// ослабленное, для несинхронности — запаздывающее. Нет зоны — w = 0.
export const NO_ZONE = { mode: 0, thetaC: 0, halfW: 0, soft: 0.01, vTop: 0, vApex: -1 };
export function zoneW(theta, v, Z) {
  if (Z.mode < 0.5) return 0;
  const ang = 1 - smoothstep(Z.halfW - Z.soft, Z.halfW + Z.soft, angDist(theta, Z.thetaC));
  const vert = 1 - smoothstep(Z.vTop - 0.1, Z.vTop + 0.1, v);
  const apex = 1 - smoothstep(Z.vApex, Z.vApex + 0.1, v);
  return Math.max(ang * vert, apex);
}

// Постоянные поля (из геометрии и параметров сценария); считаются один раз.
// zone — зона; hypo — степень гипокинеза в ней (0…1); delay — задержка
// сокращения в ней, мс (несинхронность); wallThin — истончение стенки (доля w₀).
export function deformStatics({ zone = null, hypo = 0, delay = 0, wallThin = 0 } = {}) {
  const L = G.lvLength;
  const Z = zone ? { ...NO_ZONE, mode: 1, ...zone } : NO_ZONE;
  // Интегралы объёма ЛЖ. Масштаб полости в точке Sv = s·a + (1 − a), где
  // a = g(θ, v)·(1 − b(v)): b — базальное ослабление, g = 1 − hypo·w — зона.
  // V/(1 − ℓ) = s²·Jaa + 2s·Ja1 + J11 (квадратное уравнение на s в deformState).
  let Jaa = 0, Ja1 = 0, J11 = 0;
  // Для несинхронности (второе состояние со своим масштабом s₂ в доле w):
  // Sv = a·((1 − w)s + w·s₂) + (1 − a), a = 1 − b. Интегралы K по (1 − w) и w.
  let Kaa = 0, Kaw = 0, Kww = 0, Ka1 = 0, Kw1 = 0;
  const n = 1200, nz = Z.mode ? 120 : 1;
  for (let i = 0; i < n; i++) {
    const u0 = i / n, u1 = (i + 1) / n, p0 = profile(u0), p1 = profile(u1);
    const rho = (p0.rho + p1.rho) / 2, dy = p1.y - p0.y, v = (p0.y + p1.y) / 2 / L;
    const b = M.baseRadialFraction * smoothstep(M.baseBlendV, 1, v);
    const dA = Math.PI * rho * rho * dy / nz;
    for (let j = 0; j < nz; j++) {
      const w = zoneW(((j + 0.5) / nz) * TAU, v, Z);
      const a = (1 - hypo * w) * (1 - b);
      Jaa += dA * a * a; Ja1 += dA * a * (1 - a); J11 += dA * (1 - a) * (1 - a);
      const a0 = 1 - b;
      Kaa += dA * a0 * a0 * (1 - w) * (1 - w); Kaw += dA * a0 * a0 * (1 - w) * w; Kww += dA * a0 * a0 * w * w;
      Ka1 += dA * a0 * (1 - w) * (1 - a0); Kw1 += dA * a0 * w * (1 - a0);
    }
  }
  // Серп ПЖ: объём между перегородкой ρ_s' = ρ_e·S(v) + w₀(1 + κc) и свободной
  // стенкой ρ_s' + W·k равен (1 − ℓ)·∫∫(ρ_s'·W·k + ½W²k²) dθ dy. Константы:
  // A0 = ∫∫ρ_e W, A1 = ∫∫ρ_e h W (базальная часть S), B = ∫∫w₀ W, J2 = ½∫∫W².
  let A0 = 0, A1 = 0, B = 0, J2 = 0;
  const nth = 180, nu = 400, span = G.rvTheta1 - G.rvTheta0, dth = span / nth;
  for (let i = 0; i < nu; i++) {
    const u0 = G.rvApexU + (i / nu) * (1 - G.rvApexU), u1 = G.rvApexU + ((i + 1) / nu) * (1 - G.rvApexU);
    const p0 = profile(u0), p1 = profile(u1), um = (u0 + u1) / 2, dy = p1.y - p0.y;
    const rhoE = (p0.rho + p1.rho) / 2, v = (p0.y + p1.y) / 2 / L, w0 = lvWall(um);
    const h = M.baseRadialFraction * smoothstep(M.baseBlendV, 1, v);
    for (let j = 0; j < nth; j++) {
      const th = G.rvTheta0 + (j + 0.5) * dth, W = rvWidth(th, um), a = dth * dy;
      A0 += rhoE * W * a; A1 += rhoE * h * W * a; B += w0 * W * a; J2 += 0.5 * W * W * a;
    }
  }
  return {
    A0, A1, B, J2, rvRest: A0 + B + J2,
    L, R: G.lvRadius, apexFrac: G.lvApexFraction, taper: G.lvBaseTaper,
    wallApex: G.lvWallApex, wallBase: G.lvWallBase, rvWall: G.rvWall,
    theta0: G.rvTheta0, theta1: G.rvTheta1, margin: RV_MARGIN,
    vRvLo: vParam(G.rvApexU - 0.15), vRvHi: vParam(G.rvApexU + 0.05),
    fade: M.attachFadeCm, kappa: M.wallThickening, kappaRv: M.rvWallThickening,
    apexShare: M.apexShare, baseFrac: M.baseRadialFraction, baseBlendV: M.baseBlendV,
    funnelFade: M.atrialFunnelFade, apexCap: 1.2,
    laCenter: LA.center, raCenter: RA.center,
    Jaa, Ja1, J11, Kaa, Kaw, Kww, Ka1, Kw1,
    zone: Z, hypo, delay, wallThin,
  };
}

// Состояние деформации в момент t цикла: масштабы, укорочение, скручивание.
export function deformState(cycle, t, U, withSecond = true) {
  const V = cycle.lvVolume(t), edv0 = cycle.lv.edv, esv0 = cycle.lv.esv;
  const c = Math.min(1, Math.max(0, (edv0 - V) / (edv0 - esv0)));
  const ell = M.longShortening * c;
  // s из квадратного уравнения V/(1 − ℓ) = s²·Jaa + 2s·Ja1 + J11.
  const a = U.Jaa, b = 2 * U.Ja1, cc = U.J11 - V / (1 - ell);
  let s = (-b + Math.sqrt(b * b - 4 * a * cc)) / (2 * a);
  // Второе состояние (в зоне): ослабленное при гипокинезе, запаздывающее при несинхронности.
  let s2 = s, c2 = c;
  if (U.hypo > 0) { s2 = 1 - (1 - s) * (1 - U.hypo); c2 = c * (1 - U.hypo); }
  else if (U.delay > 0 && withSecond) {
    const late = deformState(cycle, t - U.delay, U, false);
    s2 = late.s; c2 = late.c;
    // s остальной части — из объёма с учётом того, что доля w уже имеет масштаб s₂.
    const A = U.Kaa, B = 2 * (s2 * U.Kaw + U.Ka1), C2 = s2 * s2 * U.Kww + 2 * s2 * U.Kw1 + U.J11 - V / (1 - ell);
    s = (-B + Math.sqrt(Math.max(B * B - 4 * A * C2, 0))) / (2 * A);
  }
  // k из квадратного уравнения на объём серпа (см. deformStatics); целевой
  // объём нормирован на объём серпа в покое, чтобы k = 1 в конце диастолы.
  const Vrv = cycle.rvVolume(t) * (U.rvRest / VOLUMES.rvEDV) / (1 - ell);
  const J1 = s * U.A0 + (1 - s) * U.A1 + (1 + M.wallThickening * c) * U.B;
  const k = (-J1 + Math.sqrt(J1 * J1 + 4 * U.J2 * Vrv)) / (2 * U.J2);
  const tau = M.twistDeg * Math.PI / 180 * cycle.twist(t);
  const sLa = Math.cbrt(cycle.laVolume(t) / VOLUMES.laMax);
  const sRa = Math.cbrt(cycle.raVolume(t) / VOLUMES.raMax);
  return { s, ell, c, k, tau, sLa, sRa, s2, c2 };
}

export const REST_STATE = { s: 1, ell: 0, c: 0, k: 1, tau: 0, sLa: 1, sRa: 1, s2: 1, c2: 0 };

// --- JS-версия поля ------------------------------------------------------------
function endoRadius(y, U) {
  const La = U.L * U.apexFrac;
  if (y <= La) { const c = Math.min(1, Math.max(-1, 1 - Math.max(y, 0) / La)); return U.R * Math.sqrt(1 - c * c); }
  const s = Math.min(1, (y - La) / (U.L - La));
  return U.R * (1 - U.taper * (3 * s * s - 2 * s * s * s));
}
function rvMask(theta, v, U) {
  const a = (((theta - U.theta0) % TAU) + TAU) % TAU / (U.theta1 - U.theta0);
  let mA = 1;
  if (a > 1) { const d = Math.min(angDist(theta, U.theta0), angDist(theta, U.theta1)); mA = 1 - smoothstep(0, U.margin, d); }
  return mA * smoothstep(U.vRvLo, U.vRvHi, v);
}

export function deformPoint(p, d, region, va, U, S) {
  let [x, y, z] = p;
  if (region > 2.5) {
    const C = region > 3.5 ? U.raCenter : U.laCenter, sa = region > 3.5 ? S.sRa : S.sLa;
    const g = 1 + (sa - 1) * smoothstep(0, U.funnelFade, va);
    x = C[0] + (x - C[0]) * g; y = C[1] + (y - C[1]) * g; z = C[2] + (z - C[2]) * g;
    d = 0;
  }
  const rho = Math.hypot(x, z), theta = Math.atan2(z, x);
  const v = Math.min(1, Math.max(0, y / U.L));
  const f = 1 - smoothstep(0, U.fade, Math.max(y - U.L, 0));
  // Локальное состояние: смесь основного и второго по весу зоны.
  const zw = zoneW(theta, v, U.zone);
  const sL = S.s + (S.s2 - S.s) * zw, cL = S.c + (S.c2 - S.c) * zw;
  const Sv = sL + (1 - sL) * U.baseFrac * smoothstep(U.baseBlendV, 1, v);
  const rhoE = endoRadius(v * U.L, U), w0 = U.wallApex + (U.wallBase - U.wallApex) * v;
  const mask = rvMask(theta, v, U);
  // У верхушки утолщение направлено вниз, а не по радиусу (иначе полюс уходит с оси).
  const apexW = 1 - smoothstep(0, U.apexCap, rho);
  // Утолщение стенки ЛЖ/перегородки: для ЛЖ — по глубине d; в секторе ПЖ вся
  // полость и свободная стенка сидят на перегородке, поэтому там оно входит целиком.
  // Истончение (сценарий дилатации) — постоянное отрицательное утолщение.
  const T = w0 * (1 + U.kappa * cL - U.wallThin - Sv) * (1 - apexW);
  // Ширина полости ПЖ (за перегородкой) масштабируется k; стенка ПЖ — там,
  // где вершина отстоит от перегородки хотя бы на её толщину (эпикард ПЖ).
  const ex = Math.max(rho - rhoE - w0, 0);
  const wSep = smoothstep(0, w0, rho - rhoE);      // 0 на эндокарде ЛЖ, 1 на поверхности перегородки со стороны ПЖ
  const wRv = d * smoothstep(0, U.rvWall, ex);
  const rhoV = rho * Sv + T * (d + mask * (1 - d) * wSep)
    + mask * (ex * (S.k - Sv) + wRv * U.rvWall * (1 + U.kappaRv * S.c - S.k));
  const rho2 = rho + (rhoV - rho) * f;
  const y2 = y - S.ell * U.L * v * f - d * w0 * (U.kappa * cL - U.wallThin) * apexW;
  const ang = S.tau * (U.apexShare * (1 - v) - (1 - U.apexShare) * v) * f;
  const th2 = theta + ang;
  return [rho2 * Math.cos(th2), y2, rho2 * Math.sin(th2)];
}

// --- GLSL-версия: та же формула построчно ------------------------------------------
export const DEFORM_UNIFORM_NAMES = ['uL', 'uR', 'uApexFrac', 'uTaper', 'uWallApex', 'uWallBase', 'uRvWall', 'uTheta0', 'uTheta1', 'uMargin', 'uVRvLo', 'uVRvHi', 'uFade', 'uKappa', 'uKappaRv', 'uApexShare', 'uBaseFrac', 'uBaseBlendV', 'uFunnelFade', 'uApexCap', 'uLaCenter', 'uRaCenter', 'uS', 'uEll', 'uC', 'uK', 'uTau', 'uSla', 'uSra', 'uS2', 'uC2', 'uWallThin', 'uHypo', 'uZoneMode', 'uZoneThetaC', 'uZoneHalfW', 'uZoneSoft', 'uZoneVTop', 'uZoneVApex'];

export const DEFORM_GLSL = /* glsl */`
uniform float uL, uR, uApexFrac, uTaper, uWallApex, uWallBase, uRvWall, uTheta0, uTheta1, uMargin, uVRvLo, uVRvHi;
uniform float uFade, uKappa, uKappaRv, uApexShare, uBaseFrac, uBaseBlendV, uFunnelFade, uApexCap;
uniform vec3 uLaCenter, uRaCenter;
uniform float uS, uEll, uC, uK, uTau, uSla, uSra;
uniform float uS2, uC2, uWallThin, uHypo, uZoneMode, uZoneThetaC, uZoneHalfW, uZoneSoft, uZoneVTop, uZoneVApex;
const float SYS_TAU = 6.28318530718;

float sysEndoRadius(float y) {
  float La = uL * uApexFrac;
  if (y <= La) { float c = clamp(1.0 - max(y, 0.0) / La, -1.0, 1.0); return uR * sqrt(1.0 - c * c); }
  float s = min(1.0, (y - La) / (uL - La));
  return uR * (1.0 - uTaper * (3.0 * s * s - 2.0 * s * s * s));
}
float sysAngDist(float a, float b) { float d = mod(a - b, SYS_TAU); return min(d, SYS_TAU - d); }
float sysRvMask(float theta, float v) {
  float a = mod(theta - uTheta0, SYS_TAU) / (uTheta1 - uTheta0);
  float mA = 1.0;
  if (a > 1.0) { float d = min(sysAngDist(theta, uTheta0), sysAngDist(theta, uTheta1)); mA = 1.0 - smoothstep(0.0, uMargin, d); }
  return mA * smoothstep(uVRvLo, uVRvHi, v);
}
float sysZoneW(float theta, float v) {
  if (uZoneMode < 0.5) return 0.0;
  float ang = 1.0 - smoothstep(uZoneHalfW - uZoneSoft, uZoneHalfW + uZoneSoft, sysAngDist(theta, uZoneThetaC));
  float vert = 1.0 - smoothstep(uZoneVTop - 0.1, uZoneVTop + 0.1, v);
  float apex = 1.0 - smoothstep(uZoneVApex, uZoneVApex + 0.1, v);
  return max(ang * vert, apex);
}
vec3 systoleDeform(vec3 p, float d, float region, float va) {
  if (region > 2.5) {
    vec3 C = region > 3.5 ? uRaCenter : uLaCenter; float sa = region > 3.5 ? uSra : uSla;
    float g = 1.0 + (sa - 1.0) * smoothstep(0.0, uFunnelFade, va);
    p = C + (p - C) * g;
    d = 0.0;
  }
  float rho = length(p.xz); float theta = atan(p.z, p.x); float y = p.y;
  float v = clamp(y / uL, 0.0, 1.0);
  float f = 1.0 - smoothstep(0.0, uFade, max(y - uL, 0.0));
  float zw = sysZoneW(theta, v);
  float sL = uS + (uS2 - uS) * zw; float cL = uC + (uC2 - uC) * zw;
  float Sv = sL + (1.0 - sL) * uBaseFrac * smoothstep(uBaseBlendV, 1.0, v);
  float rhoE = sysEndoRadius(v * uL); float w0 = uWallApex + (uWallBase - uWallApex) * v;
  float mask = sysRvMask(theta, v);
  float apexW = 1.0 - smoothstep(0.0, uApexCap, rho);
  float T = w0 * (1.0 + uKappa * cL - uWallThin - Sv) * (1.0 - apexW);
  float ex = max(rho - rhoE - w0, 0.0);
  float wSep = smoothstep(0.0, w0, rho - rhoE);
  float wRv = d * smoothstep(0.0, uRvWall, ex);
  float rhoV = rho * Sv + T * (d + mask * (1.0 - d) * wSep)
    + mask * (ex * (uK - Sv) + wRv * uRvWall * (1.0 + uKappaRv * uC - uK));
  float rho2 = rho + (rhoV - rho) * f;
  float y2 = y - uEll * uL * v * f - d * w0 * (uKappa * cL - uWallThin) * apexW;
  float ang = uTau * (uApexShare * (1.0 - v) - (1.0 - uApexShare) * v) * f;
  float th2 = theta + ang;
  return vec3(rho2 * cos(th2), y2, rho2 * sin(th2));
}
`;
