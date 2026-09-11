// lvshape.js — параметрика желудочков без three.js: профиль эндокарда ЛЖ,
// толщина стенки, сектор и ширина серпа ПЖ, борозды, смещения. Используется
// геометрией (ventricles.js), деформацией (deform.js) и тестами под node.
// Ось ЛЖ — Y, верхушка в начале координат, основание на высоте L.
import { GEOMETRY as G } from '../physiology.js';

const TAU = Math.PI * 2;
export const REGION = { LV: 0, SEPTUM: 1, RV: 2, LA: 3, RA: 4 };

export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const wrap = (t) => ((t % TAU) + TAU) % TAU;
export const angDist = (a, b) => { const d = Math.abs(wrap(a - b)); return Math.min(d, TAU - d); };

// Профиль эндокарда ЛЖ в меридиональной плоскости: (ρ, y) и внешняя нормаль.
export function profile(u) {
  const R = G.lvRadius, L = G.lvLength, ua = G.lvApexFraction, La = L * ua, k = G.lvBaseTaper;
  let rho, y, drho, dy;
  if (u < ua) {
    const phi = (u / ua) * Math.PI / 2, c = Math.PI / (2 * ua);
    rho = R * Math.sin(phi); y = La * (1 - Math.cos(phi));
    drho = R * Math.cos(phi) * c; dy = La * Math.sin(phi) * c;
  } else {
    const s = (u - ua) / (1 - ua), ds = 1 / (1 - ua);
    rho = R * (1 - k * (3 * s * s - 2 * s * s * s)); y = La + s * (L - La);
    drho = -R * k * (6 * s - 6 * s * s) * ds; dy = (L - La) * ds;
  }
  const len = Math.hypot(dy, drho) || 1;
  return { rho, y, nr: dy / len, ny: -drho / len };
}

export function lvWall(u) {
  const y = profile(u).y;
  return G.lvWallApex + (G.lvWallBase - G.lvWallApex) * (y / G.lvLength);
}

// Доля положения в секторе ПЖ: 0..1 внутри, -1 снаружи.
export function sectorFrac(theta) {
  const span = G.rvTheta1 - G.rvTheta0;
  const a = wrap(theta - G.rvTheta0) / span;
  return a <= 1 ? a : -1;
}
export const inSector = (theta) => sectorFrac(theta) >= 0;

// Ширина полости ПЖ (перегородка → свободная стенка).
export function rvWidth(theta, u) {
  const a = sectorFrac(theta);
  if (a < 0 || u <= G.rvApexU) return 0;
  const hump = Math.pow(Math.sin(Math.PI * a), 0.8);
  const q = (u - G.rvApexU) / (1 - G.rvApexU), q1 = 0.45;
  const r = Math.min(q / q1, 1);
  const g = Math.sqrt(1 - (1 - r) * (1 - r));
  const base = G.rvWidthMax * hump * g * (1 + 0.1 * q);
  // Приток и выводной тракт расширяют полость у основания.
  const nearBase = smoothstep(0.5, 0.95, u);
  const inflow = G.rvInflowBump * Math.exp(-(((a - G.rvInflowA) / G.rvInflowW) ** 2));
  const outflow = G.rvOutflowBump * Math.exp(-(((a - G.rvOutflowA) / G.rvOutflowW) ** 2));
  return base * (1 + nearBase * (inflow + outflow));
}

// Точка на эпикарде, поднятая над поверхностью на lift (для коронарных артерий).
export function epiPoint(theta, u, lift = 0) {
  const [oN, oR] = epiOffset(theta, u);
  const p = offsetPoint(theta, u, oN + lift, oR);
  return p;
}

// Контур серпа ПЖ на уровне u: наружная дуга туда, внутренняя обратно ([x,z]).
export function crescentLoop(u, n = 48) {
  const span = G.rvTheta1 - G.rvTheta0, out = [];
  for (let i = 0; i <= n; i++) { const th = G.rvTheta0 + (i / n) * span; const p = offsetPoint(th, u, lvWall(u), rvWidth(th, u)); out.push([p[0], p[2]]); }
  for (let i = n; i >= 0; i--) { const th = G.rvTheta0 + (i / n) * span; const p = offsetPoint(th, u, lvWall(u)); out.push([p[0], p[2]]); }
  return out;
}

function groove(theta, u) {
  const d0 = angDist(theta, G.rvTheta0), d1 = angDist(theta, G.rvTheta1), s = G.grooveSigma;
  const fade = smoothstep(G.rvApexU, G.rvApexU + 0.2, u) * (1 - smoothstep(0.88, 1, u));
  return G.grooveDepth * (Math.exp(-(d0 * d0) / (s * s)) + Math.exp(-(d1 * d1) / (s * s))) * fade;
}

// Маска свободной стенки ПЖ: 1 внутри сектора, плавно 0 за его краями
// (запас по углу), и включается по высоте чуть ниже верхушки ПЖ. Благодаря
// запасу стенка ПЖ на остриях серпа не вырождается в ноль и полость ПЖ
// не протыкает эпикард в бороздах.
export const RV_MARGIN = 10 * Math.PI / 180;
export function rvMask(theta, u) {
  const a = sectorFrac(theta);
  let mA = 1;
  if (a < 0) {
    const d = Math.min(angDist(theta, G.rvTheta0), angDist(theta, G.rvTheta1));
    mA = 1 - smoothstep(0, RV_MARGIN, d);
  }
  return mA * smoothstep(G.rvApexU - 0.15, G.rvApexU + 0.05, u);
}

// Смещение эпикарда от эндокарда ЛЖ: [вдоль нормали, по радиусу].
export function epiOffset(theta, u) {
  return [lvWall(u) - groove(theta, u), rvWidth(theta, u) + G.rvWall * rvMask(theta, u)];
}

export function endoPoint(theta, u) {
  const p = profile(u);
  return [p.rho * Math.cos(theta), p.y, p.rho * Math.sin(theta)];
}
export function endoNormal(theta, u) {
  const p = profile(u);
  return [p.nr * Math.cos(theta), p.ny, p.nr * Math.sin(theta)];
}
// Смещение от эндокарда ЛЖ: oN — вдоль нормали (толщина стенки ЛЖ),
// oR — по горизонтальному радиусу (полость и стенка ПЖ). Второе нужно,
// чтобы у верхушки, где нормаль ЛЖ смотрит вниз, ПЖ не уходил под ЛЖ.
export function offsetPoint(theta, u, oN, oR = 0) {
  const p = endoPoint(theta, u), n = endoNormal(theta, u);
  const c = Math.cos(theta), sn = Math.sin(theta);
  return [p[0] + n[0] * oN + c * oR, p[1] + n[1] * oN, p[2] + n[2] * oN + sn * oR];
}
export const neg = (v) => [-v[0], -v[1], -v[2]];
export const vParam = (u) => profile(u).y / G.lvLength;

// Радиус эндокарда ЛЖ на высоте y (обратный профиль «пули»); то же самое
// считает вершинный шейдер деформации. Для y вне [0, L] — экстраполяция крайних.
export function endoRadiusAtY(y) {
  const R = G.lvRadius, L = G.lvLength, La = L * G.lvApexFraction, k = G.lvBaseTaper;
  if (y <= La) { const c = Math.max(-1, Math.min(1, 1 - Math.max(0, y) / La)); return R * Math.sqrt(1 - c * c); }
  const s = Math.min(1, (y - La) / (L - La));
  return R * (1 - k * (3 * s * s - 2 * s * s * s));
}
export function lvWallAtY(y) {
  return G.lvWallApex + (G.lvWallBase - G.lvWallApex) * Math.min(1, Math.max(0, y / G.lvLength));
}

