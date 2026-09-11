// conduction.js — проводящая система и карта активации. Чистый модуль без three.js.
//
// Для каждой вершины сеток миокарда считается время активации (мс):
// желудочки — от начала QRS (t = 0 — прорыв на левой поверхности
// перегородки), предсердия и узлы — от начала зубца P (в шейдере сдвигаются
// на −PQ текущего цикла). Распространение — Дейкстра по рёбрам сетки:
// вес = длина / локальная скорость (Пуркинье на эндокарде до purkinjeCoverV,
// рабочий миокард выше и трансмурально). Из той же карты выводится
// псевдо-ЭКГ: сумма диполей фронтов деполяризации и реполяризации,
// спроецированных на ось II отведения. Волна и кривая не могут разойтись.
import { GEOMETRY as G, CONDUCTION as C, TIMING } from './physiology.js';
import { REGION, endoPoint, offsetPoint, lvWall, rvWidth } from './geometry/lvshape.js';
import { L, LA, RA } from './geometry/layout.js';

const d2r = Math.PI / 180;
const dist = (P, a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
const distP = (P, a, q) => Math.hypot(P[a * 3] - q[0], P[a * 3 + 1] - q[1], P[a * 3 + 2] - q[2]);

// Узлы и опорные точки дерева (координаты покоя).
export const NODES = {
  sa: [-3.6, L + 3.5, -0.4],          // синусовый узел: крыша ПП у устья SVC
  bachmann: [0.2, L + 3.7, -1.4],     // вход пучка Бахмана в ЛП (передняя крыша)
  av: [-3.0, L + 0.15, -0.5],         // АВ-узел: перегородочная часть трикуспидального кольца
  his: offsetPoint(140 * d2r, 0.95, lvWall(0.95) / 2),   // пучок Гиса в верхней части перегородки
  lvBreak: endoPoint(150 * d2r, 0.8), // первая активация миокарда: левая поверхность перегородки
  rvApexEntry: offsetPoint(150 * d2r, 0.42, lvWall(0.42), rvWidth(150 * d2r, 0.42)), // вход модераторного пучка в свободную стенку
  rvSeptEntry: offsetPoint(150 * d2r, 0.42, lvWall(0.42)), // выход ПНПГ на правую поверхность перегородки (начало модераторного пучка)
};

// --- Дейкстра по сетке ------------------------------------------------------------

class Heap {
  constructor() { this.a = []; }
  push(k, d) { const a = this.a; a.push([d, k]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
}

function neighbors(g, k) {
  const out = [];
  const { cols, ringStart, ringEnd, ringIdx } = g;
  if (k === g.poleStartIdx) { for (let i = 0; i < cols; i++) out.push(ringIdx(i, ringStart)); return out; }
  if (k === g.poleEndIdx) { for (let i = 0; i < cols; i++) out.push(ringIdx(i, ringEnd)); return out; }
  const j = Math.floor(k / cols) + ringStart, i = k % cols;
  for (const dj of [-1, 0, 1]) for (const di of [-1, 0, 1]) {
    if (!di && !dj) continue;
    const jj = j + dj;
    if (jj < ringStart) { if (g.poleStartIdx >= 0) out.push(g.poleStartIdx); continue; }
    if (jj > ringEnd) { if (g.poleEndIdx >= 0) out.push(g.poleEndIdx); continue; }
    out.push(ringIdx(i + di, jj));
  }
  return out;
}

// Многоисточниковый Дейкстра: init — [[индекс, t0], ...], speedAt(k) — см/мс.
export function dijkstra(g, init, speedAt) {
  const T = new Float64Array(g.n).fill(Infinity);
  const h = new Heap();
  for (const [k, t0] of init) if (t0 < T[k]) { T[k] = t0; h.push(k, t0); }
  while (h.size) {
    const [d, k] = h.pop();
    if (d > T[k]) continue;
    const vk = speedAt(k);
    for (const m of neighbors(g, k)) {
      const w = dist(g.pos, k, m) / (0.5 * (vk + speedAt(m)));
      const nd = d + w;
      if (nd < T[m]) { T[m] = nd; h.push(m, nd); }
    }
  }
  return T;
}

const nearest = (g, q) => { let best = 0, bd = Infinity; for (let k = 0; k < g.n; k++) { const d = distP(g.pos, k, q); if (d < bd) { bd = d; best = k; } } return best; };

// Билинейная выборка значения по сетке в параметрах (θ, u).
function sampleLV(g, T, theta, u) {
  const { cols, rows } = g;
  const fi = ((theta / (2 * Math.PI)) % 1 + 1) % 1 * cols, fj = Math.min(rows, Math.max(0, u * rows));
  const i0 = Math.floor(fi) % cols, i1 = (i0 + 1) % cols, j0 = Math.min(rows - 1, Math.floor(fj)), j1 = Math.min(rows, j0 + 1);
  const a = fi - Math.floor(fi), b = fj - j0;
  const at = (i, j) => (j < g.ringStart ? T[g.poleStartIdx] : T[g.ringIdx(i, j)]);
  return (1 - a) * (1 - b) * at(i0, j0) + a * (1 - b) * at(i1, j0) + (1 - a) * b * at(i0, j1) + a * b * at(i1, j1);
}
// Свободная стенка ПЖ: столбцы s < 0,5 соответствуют θ ∈ [θ0, θ1].
function sampleRVfree(g, T, theta, u) {
  const { cols, rows } = g, span = G.rvTheta1 - G.rvTheta0;
  const a = (((theta - G.rvTheta0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / span;
  const fi = Math.min(0.5, Math.max(0, a)) * cols, fj = Math.min(rows, Math.max(0, ((u - G.rvApexU) / (1 - G.rvApexU)) * rows));
  const i0 = Math.min(cols - 1, Math.floor(fi)), i1 = Math.min(cols - 1, i0 + 1), j0 = Math.min(rows - 1, Math.floor(fj)), j1 = Math.min(rows, j0 + 1);
  const aa = fi - i0, b = fj - j0;
  const at = (i, j) => (j < g.ringStart ? T[g.poleStartIdx] : T[g.ringIdx(i, j)]);
  return (1 - aa) * (1 - b) * at(i0, j0) + aa * (1 - b) * at(i1, j0) + (1 - aa) * b * at(i0, j1) + aa * b * at(i1, j1);
}

// --- Карта активации ----------------------------------------------------------------

// grids: { lvEndo, epi, rvEndo, ringA, ringB } из ventricleGrids; atria: { la:{outer,inner}, ra:{...} }
// (optional), appendages: [{ arrays:{outer,inner}, start, atrium:'la'|'ra' }].
// Возвращает { vent: {lvEndo, epi, rvEndo, ringA, ringB}, atr: {...}, qrsEnd, ... } — Float32Array времён.
export function activationMap({ grids, atria = null, appendages = [], params = {} }) {
  const { lvEndo, epi, rvEndo, cols, rows } = grids;
  const vMyo = C.vMyocardium, vP = C.vPurkinje;
  const purk = (g) => (k) => (g.param[k * 2 + 1] <= C.purkinjeCoverV ? vP : vMyo);
  const lbbb = !!params.lbbb, rbbb = !!params.rbbb;

  // ЛЖ: от точки прорыва на перегородке (если ЛНПГ не блокирована).
  let T_lv;
  if (!lbbb) T_lv = dijkstra(lvEndo, [[nearest(lvEndo, NODES.lvBreak), 0]], purk(lvEndo));

  // ПЖ: перегородочная сторона — от ЛЖ через толщину перегородки; свободная
  // стенка — от входа модераторного пучка (если ПНПГ не блокирована).
  const rvInit = [];
  if (!rbbb) rvInit.push([nearest(rvEndo, NODES.rvApexEntry), C.rbbDelay], [nearest(rvEndo, NODES.rvSeptEntry), C.rbbDelay - 3]);
  if (!lbbb) {
    for (let k = 0; k < rvEndo.n; k++) if (rvEndo.region[k] === REGION.SEPTUM) {
      const th = rvEndo.param[k * 2], u = uFromV(rvEndo.param[k * 2 + 1]);
      rvInit.push([k, sampleLV(lvEndo, T_lv, th, u) + lvWall(u) / vMyo]);
    }
  }
  let T_rv = dijkstra(rvEndo, rvInit, purk(rvEndo));

  // Блокада ЛНПГ: ЛЖ активируется от правой поверхности перегородки через
  // толщину и дальше по эндокарду рабочим миокардом (Пуркинье без входа).
  if (lbbb) {
    const init = [];
    for (let k = 0; k < lvEndo.n; k++) if (lvEndo.region[k] === REGION.SEPTUM) {
      const th = lvEndo.param[k * 2], u = uFromV(lvEndo.param[k * 2 + 1]);
      init.push([k, sampleRVsept(rvEndo, T_rv, th, u) + lvWall(u) / vMyo]);
    }
    T_lv = dijkstra(lvEndo, init, () => vMyo * C.lbbbEndoFactor);
  }
  if (rbbb) {
    // Свободная стенка ПЖ — от перегородки рабочим миокардом.
    T_rv = dijkstra(rvEndo, rvInit, (k) => (rvEndo.region[k] === REGION.SEPTUM ? vP : vMyo * 1.15));
  }

  // Эпикард: те же (i, j), что у эндокарда ЛЖ; над свободной стенкой ПЖ — от неё.
  const T_epi = new Float64Array(epi.n);
  for (let k = 0; k < epi.n; k++) {
    if (epi.region[k] === REGION.RV) {
      const th = epi.param[k * 2], u = uFromV(epi.param[k * 2 + 1]);
      T_epi[k] = sampleRVfree(rvEndo, T_rv, th, u) + G.rvWall / vMyo;
    } else {
      T_epi[k] = T_lv[k] + dist(epi.pos, k, k === epi.poleStartIdx ? lvEndo.poleStartIdx : k) / vMyo;
    }
  }
  const late = Math.max(...T_epi.filter(Number.isFinite));
  const constant = (g, v) => new Float64Array(g.n).fill(v);
  const vent = { lvEndo: T_lv, epi: T_epi, rvEndo: T_rv, ringA: constant(grids.ringA, late), ringB: constant(grids.ringB, late) };

  // Предсердия: ПП от синусового узла, ЛП от пучка Бахмана; внутренняя
  // оболочка — по индексам наружной; ушки — от ближайшей вершины тела.
  const atr = {};
  if (atria) {
    const vA = () => C.vAtrial;
    const raT = dijkstra(atria.ra.outer, [[nearest(atria.ra.outer, NODES.sa), 0]], vA);
    const tBB = Math.hypot(...NODES.sa.map((x, i) => x - NODES.bachmann[i])) / C.vInternodal;
    const laT = dijkstra(atria.la.outer, [[nearest(atria.la.outer, NODES.bachmann), tBB]], vA);
    atr.ra = { outer: raT, inner: raT }; atr.la = { outer: laT, inner: laT };
    for (const ap of appendages) {
      const body = atria[ap.atrium].outer, bodyT = atr[ap.atrium].outer;
      const k0 = nearest(body, ap.start), t0 = bodyT[k0];
      const along = (g) => { const T = new Float64Array(g.n); for (let k = 0; k < g.n; k++) T[k] = t0 + distP(g.pos, k, ap.start) / C.vAtrial; return T; };
      atr[ap.name] = { outer: along(ap.arrays.outer), inner: along(ap.arrays.inner) };
    }
  }

  // Длительности: QRS — от 5 % до 95 % активированной массы желудочков.
  const all = [...T_lv, ...T_rv, ...T_epi].filter(Number.isFinite).sort((a, b) => a - b);
  const q = (f) => all[Math.min(all.length - 1, Math.floor(f * all.length))];
  const stats = { qrsStart: q(0.01), qrsEnd: q(0.99), qrsDuration: q(0.99) - q(0.01), lastVent: all[all.length - 1] };
  // Механическая несинхронность: средняя активация боковой стенки ЛЖ минус
  // перегородки (средняя треть по высоте). В норме единицы мс, при БЛНПГ десятки.
  {
    const thLat = (G.rvTheta0 + G.rvTheta1) / 2 + Math.PI;
    const ad = (a, b) => { const d = Math.abs(((a - b) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)); return Math.min(d, 2 * Math.PI - d); };
    let sSep = 0, nSep = 0, sLat = 0, nLat = 0;
    for (let k = 0; k < lvEndo.n; k++) {
      const v = lvEndo.param[k * 2 + 1], th = lvEndo.param[k * 2];
      if (v < 0.3 || v > 0.85 || !Number.isFinite(T_lv[k])) continue;
      if (lvEndo.region[k] === REGION.SEPTUM) { sSep += T_lv[k]; nSep++; }
      else if (ad(th, thLat) < 0.7) { sLat += T_lv[k]; nLat++; }
    }
    stats.lateralDelay = nSep && nLat ? sLat / nLat - sSep / nSep : 0;
    stats.thetaLateral = thLat;
  }
  if (atria) { const a = [...atr.ra.outer, ...atr.la.outer].filter(Number.isFinite).sort((x, y) => x - y); stats.pDuration = a[Math.floor(0.98 * a.length)] - a[Math.floor(0.02 * a.length)]; }
  return { vent, atr, stats };
}

// v (высота от верхушки, доля L) → u параметра профиля. Обратная к vParam:
// подбором по монотонности профиля.
const uTable = (() => { const n = 400, ys = []; for (let i = 0; i <= n; i++) ys.push(endoPoint(0, i / n)[1] / G.lvLength); return ys; })();
export function uFromV(v) {
  const n = uTable.length - 1;
  if (v <= 0) return 0; if (v >= 1) return 1;
  let lo = 0, hi = n;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (uTable[m] <= v) lo = m; else hi = m; }
  const f = (v - uTable[lo]) / ((uTable[hi] - uTable[lo]) || 1);
  return (lo + f) / n;
}
// Перегородочная сторона серпа ПЖ: столбцы s ≥ 0,5, θ убывает от θ1 к θ0.
function sampleRVsept(g, T, theta, u) {
  const { cols, rows } = g, span = G.rvTheta1 - G.rvTheta0;
  const a = (((theta - G.rvTheta0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / span;
  if (a > 1) return Infinity;
  const fi = Math.min(cols - 1, (1 - a * 0.5) * cols), fj = Math.min(rows, Math.max(0, ((u - G.rvApexU) / (1 - G.rvApexU)) * rows));
  const i0 = Math.min(cols - 1, Math.floor(fi)), i1 = (i0 + 1) % cols, j0 = Math.min(rows - 1, Math.floor(fj)), j1 = Math.min(rows, j0 + 1);
  const aa = fi - i0, b = fj - j0;
  const at = (i, j) => (j < g.ringStart ? T[g.poleStartIdx] : T[g.ringIdx(i, j)]);
  return (1 - aa) * (1 - b) * at(i0, j0) + aa * (1 - b) * at(i1, j0) + (1 - aa) * b * at(i0, j1) + aa * b * at(i1, j1);
}

// --- Псевдо-ЭКГ ---------------------------------------------------------------------

// Гистограммы диполей на 1-мс сетке: желудочковая часть относительно QRS
// (окно [-100, 700)), предсердная относительно P (окно [-50, 450)).
const VENT_T0 = -100, VENT_N = 800, ATR_T0 = -50, ATR_N = 500;

function addGauss(arr, t0off, t, sigma, w) {
  const r = Math.ceil(3 * sigma);
  const c = Math.round(t) - t0off;
  for (let d = -r; d <= r; d++) { const i = c + d; if (i < 0 || i >= arr.length) continue; arr[i] += w * Math.exp(-0.5 * (d / sigma) ** 2); }
}

// Площадь и нормаль вокруг вершины сетки по соседям (i+1, j+1).
function cellGeom(g, k) {
  if (k === g.poleStartIdx || k === g.poleEndIdx) return null;
  const { cols, ringStart, ringEnd, ringIdx } = g;
  const j = Math.floor(k / cols) + ringStart, i = k % cols;
  if (j >= ringEnd) return null;
  const a = ringIdx(i + 1, j), b = ringIdx(i, j + 1), P = g.pos;
  const e1 = [P[a * 3] - P[k * 3], P[a * 3 + 1] - P[k * 3 + 1], P[a * 3 + 2] - P[k * 3 + 2]];
  const e2 = [P[b * 3] - P[k * 3], P[b * 3 + 1] - P[k * 3 + 1], P[b * 3 + 2] - P[k * 3 + 2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const area = Math.hypot(...n);
  return { a, b, e1, e2, area, n: n.map((x) => x / (area || 1)) };
}

// Таблицы ЭКГ из карты активации. Возвращает { vent: Float32Array, atr: Float32Array, ventT0, atrT0 }.
export function ecgTables({ grids, act, atria = null }) {
  const e = C.leadII, en = Math.hypot(...e), ex = e.map((x) => x / en);
  const vent = new Float64Array(VENT_N), atr = new Float64Array(ATR_N);
  const { lvEndo, epi, rvEndo } = grids;
  // Желудочки: пара эндокард–эпикард по (i, j) эпикарда: трансмуральный
  // диполь (эндо→эпи) при деполяризации и обратный при реполяризации,
  // плюс тангенциальный диполь фронта по эндокарду.
  for (let k = 0; k < epi.n; k++) {
    const cg = cellGeom(epi, k); if (!cg) continue;
    const Tepi = act.vent.epi[k]; if (!Number.isFinite(Tepi)) continue;
    let Tendo, n;
    if (epi.region[k] === REGION.RV) { Tendo = Tepi - G.rvWall / C.vMyocardium; n = cg.n; }
    else { Tendo = act.vent.lvEndo[k]; const P = epi.pos, Q = lvEndo.pos; const d = [P[k * 3] - Q[k * 3], P[k * 3 + 1] - Q[k * 3 + 1], P[k * 3 + 2] - Q[k * 3 + 2]]; const l = Math.hypot(...d) || 1; n = d.map((x) => x / l); }
    if (!Number.isFinite(Tendo)) continue;
    const proj = n[0] * ex[0] + n[1] * ex[1] + n[2] * ex[2];
    const w = cg.area * proj;
    const tMid = 0.5 * (Tendo + Tepi), sig = Math.max(4, 0.5 * Math.abs(Tepi - Tendo));
    addGauss(vent, VENT_T0, tMid, sig, w);
    // Реполяризация: эпикард раньше (короче ПД) → диполь эпи→эндо с обратным знаком = тот же знак.
    const rEndo = Tendo + C.apdEndo, rEpi = Tepi + C.apdEpi;
    addGauss(vent, VENT_T0, 0.5 * (rEndo + rEpi), Math.max(25, 0.5 * Math.abs(rEndo - rEpi)), w * Math.sign(rEndo - rEpi) * 1.2);
    // Тангенциальный диполь фронта на эндокарде (градиент T).
    const src = epi.region[k] === REGION.RV ? null : lvEndo;
    if (src) {
      const Ta = act.vent.lvEndo[cg.a], Tb = act.vent.lvEndo[cg.b];
      if (Number.isFinite(Ta) && Number.isFinite(Tb)) {
        const g1 = (Ta - Tendo), g2 = (Tb - Tendo);
        const dir = [cg.e1[0] * g1 + cg.e2[0] * g2, cg.e1[1] * g1 + cg.e2[1] * g2, cg.e1[2] * g1 + cg.e2[2] * g2];
        const l = Math.hypot(...dir); if (l > 1e-9) addGauss(vent, VENT_T0, Tendo, 4, cg.area * 0.5 * (dir[0] * ex[0] + dir[1] * ex[1] + dir[2] * ex[2]) / l);
      }
    }
  }
  // Свободная стенка ПЖ: тангенциальный диполь по серпу.
  for (let k = 0; k < rvEndo.n; k++) {
    if (rvEndo.region[k] !== REGION.RV) continue;
    const cg = cellGeom(rvEndo, k); if (!cg) continue;
    const T0 = act.vent.rvEndo[k], Ta = act.vent.rvEndo[cg.a], Tb = act.vent.rvEndo[cg.b];
    if (![T0, Ta, Tb].every(Number.isFinite)) continue;
    const g1 = Ta - T0, g2 = Tb - T0;
    const dir = [cg.e1[0] * g1 + cg.e2[0] * g2, cg.e1[1] * g1 + cg.e2[1] * g2, cg.e1[2] * g1 + cg.e2[2] * g2];
    const l = Math.hypot(...dir); if (l > 1e-9) addGauss(vent, VENT_T0, T0, 4, cg.area * 0.5 * (dir[0] * ex[0] + dir[1] * ex[1] + dir[2] * ex[2]) / l);
  }
  // Предсердия: тангенциальные диполи, тонкая стенка.
  if (atria) for (const name of ['ra', 'la']) {
    const g = atria[name].outer, T = act.atr[name].outer;
    for (let k = 0; k < g.n; k++) {
      const cg = cellGeom(g, k); if (!cg) continue;
      const T0 = T[k], Ta = T[cg.a], Tb = T[cg.b];
      if (![T0, Ta, Tb].every(Number.isFinite)) continue;
      const g1 = Ta - T0, g2 = Tb - T0;
      const dir = [cg.e1[0] * g1 + cg.e2[0] * g2, cg.e1[1] * g1 + cg.e2[1] * g2, cg.e1[2] * g1 + cg.e2[2] * g2];
      const l = Math.hypot(...dir); if (l < 1e-9) continue;
      const w = cg.area * (dir[0] * ex[0] + dir[1] * ex[1] + dir[2] * ex[2]) / l;
      addGauss(atr, ATR_T0, T0, 5, w);
      addGauss(atr, ATR_T0, T0 + C.apdAtrial, 20, -w * 0.25);
    }
  }
  // Нормировка: R = 1 мВ.
  let r = 0; for (let i = 0; i < VENT_N; i++) if (i + VENT_T0 >= -20 && i + VENT_T0 <= 160) r = Math.max(r, Math.abs(vent[i]));
  const kv = r > 0 ? 1 / r : 1;
  let pa = 0; for (let i = 0; i < ATR_N; i++) pa = Math.max(pa, Math.abs(atr[i]));
  const ka = pa > 0 ? C.atrialWeight / pa : 1;
  return { vent: Float32Array.from(vent, (x) => x * kv), atr: Float32Array.from(atr, (x) => x * ka), ventT0: VENT_T0, atrT0: ATR_T0 };
}

// Значение ЭКГ (мВ) в момент t цикла: желудочковая часть периодична по RR,
// предсердная — от начала P (pOnset), растянутая на pqScale.
export function ecgAt(tab, t, rr, pOnset, pqScale = 1) {
  const w = ((t % rr) + rr) % rr;
  const sample = (arr, t0, x) => { const f = x - t0; if (f < 0 || f >= arr.length - 1) return 0; const i = Math.floor(f), a = f - i; return arr[i] * (1 - a) + arr[i + 1] * a; };
  // Желудочки: вклад текущего и предыдущего цикла (хвост T через границу).
  let v = sample(tab.vent, tab.ventT0, w) + sample(tab.vent, tab.ventT0, w - rr) + sample(tab.vent, tab.ventT0, w + rr);
  for (const shift of [0, -rr, rr]) { const x = (w + shift - pOnset) / pqScale; v += sample(tab.atr, tab.atrT0, x); }
  return v;
}

// --- Дерево проводящей системы: полилинии с временем активации -------------------------
// Каждая ветвь: { name, clock: 'p'|'qrs', points: [[x,y,z]...], t0 (мс в начале), v (см/мс), radius }.
export function conductionTree() {
  const tAV = Math.hypot(...NODES.sa.map((x, i) => x - [-4.3, L + 2.6, 0.4][i])) / C.vInternodal + Math.hypot(...[-4.3, L + 2.6, 0.4].map((x, i) => x - [-3.9, L + 1.4, 0.3][i])) / C.vInternodal + Math.hypot(...[-3.9, L + 1.4, 0.3].map((x, i) => x - NODES.av[i])) / C.vInternodal;
  const tHis = tAV + C.avDelay;                 // выход из АВ-узла (часы P)
  const endo = (thDeg, u, o = -0.06) => offsetPoint(thDeg * d2r, u, o);
  const rvFree = (thDeg, u, k = 0.94) => offsetPoint(thDeg * d2r, u, lvWall(u), rvWidth(thDeg * d2r, u) * k);
  const rvSept = (thDeg, u) => offsetPoint(thDeg * d2r, u, lvWall(u) + 0.06);
  const branches = [
    { name: 'internodal', clock: 'p', t0: 0, v: C.vInternodal, radius: 0.07, points: [NODES.sa, [-4.3, L + 2.6, 0.4], [-3.9, L + 1.4, 0.3], NODES.av] },
    { name: 'his', clock: 'p', t0: tHis, v: C.vBundle, radius: 0.1, points: [NODES.av, NODES.his, endo(145, 0.86, 0.02)] },
    // Ножки — часы QRS: прорыв на перегородке в t = 0, Гис вышел на C.hisTransit раньше.
    { name: 'lbb', clock: 'qrs', t0: -C.hisTransit, v: C.vBundle, radius: 0.09, points: [NODES.his, endo(145, 0.86, 0.02), endo(150, 0.7), endo(150, 0.6)] },
    { name: 'lafb', clock: 'qrs', t0: 0, v: C.vPurkinje, radius: 0.06, points: [endo(150, 0.6), endo(90, 0.5), endo(30, 0.42), endo(340, 0.38)] },
    { name: 'lpfb', clock: 'qrs', t0: 0, v: C.vPurkinje, radius: 0.06, points: [endo(150, 0.6), endo(200, 0.48), endo(250, 0.38)] },
    { name: 'purkLa', clock: 'qrs', t0: 0, v: C.vPurkinje, radius: 0.04, points: [endo(340, 0.38), endo(320, 0.25), endo(300, 0.12)] },
    { name: 'purkLb', clock: 'qrs', t0: 0, v: C.vPurkinje, radius: 0.04, points: [endo(340, 0.38), endo(10, 0.25), endo(40, 0.14)] },
    { name: 'purkPa', clock: 'qrs', t0: 0, v: C.vPurkinje, radius: 0.04, points: [endo(250, 0.38), endo(230, 0.25), endo(210, 0.12)] },
    { name: 'purkPb', clock: 'qrs', t0: 0, v: C.vPurkinje, radius: 0.04, points: [endo(250, 0.38), endo(275, 0.24), endo(290, 0.12)] },
    { name: 'rbb', clock: 'qrs', t0: -C.hisTransit, v: C.vBundle, radius: 0.08, points: [NODES.his, rvSept(150, 0.88), rvSept(150, 0.65), rvSept(150, 0.42)] },
    { name: 'moderator', clock: 'qrs', t0: 0, v: C.vBundle, radius: 0.12, points: [rvSept(150, 0.42), rvFree(150, 0.42, 0.5), NODES.rvApexEntry] },
    { name: 'purkRa', clock: 'qrs', t0: 0, v: C.vPurkinje, radius: 0.04, points: [NODES.rvApexEntry, rvFree(120, 0.55), rvFree(105, 0.7)] },
    { name: 'purkRb', clock: 'qrs', t0: 0, v: C.vPurkinje, radius: 0.04, points: [NODES.rvApexEntry, rvFree(180, 0.55), rvFree(200, 0.7)] },
    { name: 'purkRc', clock: 'qrs', t0: 0, v: C.vPurkinje, radius: 0.04, points: [NODES.rvApexEntry, rvFree(150, 0.3)] },
  ];
  // Времена вдоль ветвей: t0 + накопленная длина / v; для ветвей с t0 = 0 —
  // продолжение от конца родителя (по совпадению первой точки).
  const endTime = new Map();
  for (const b of branches) {
    const key = b.points[0].map((x) => x.toFixed(3)).join(',');
    let t = b.t0;
    if (b.t0 === 0 && endTime.has(key)) t = endTime.get(key);
    b.times = [t];
    for (let i = 1; i < b.points.length; i++) { t += Math.hypot(...b.points[i].map((x, d) => x - b.points[i - 1][d])) / b.v; b.times.push(t); }
    endTime.set(b.points[b.points.length - 1].map((x) => x.toFixed(3)).join(','), t);
  }
  return { branches, tAV, tHis, nodes: { sa: { p: NODES.sa, t: 0, clock: 'p', r: 0.28 }, av: { p: NODES.av, t: tAV, clock: 'p', r: 0.22 } } };
}
