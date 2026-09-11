// timeline.js — последовательность ударов. Чистый модуль без three.js.
//
// Абсолютное время T (мс от запуска) → удар и время t внутри его цикла.
// Синусовый ритм — постоянный RR; фибрилляция предсердий — RR с
// логнормальным разбросом от фиксированного seed, удары генерируются
// лениво по порядку и запоминаются, поэтому скраб в любую точку T
// воспроизводим. Кривые цикла кэшируются по RR (округление до 1 мс).
import { makeCycle } from './cycle.js';
import { TIMING } from './physiology.js';

// Детерминированный генератор (mulberry32).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Нормальное распределение (Бокс–Мюллер).
function gaussian(rand) {
  const u = Math.max(1e-12, rand()), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class Timeline {
  constructor({ hr = TIMING.hrRest, rhythm = 'sinus', seed = 1, rrJitter = 0.2, params = {} } = {}) {
    this.hr = hr; this.rhythm = rhythm; this.seed = seed; this.rrJitter = rrJitter; this.params = params;
    this.rr0 = 60000 / hr;
    this.rand = mulberry32(seed);
    this.beats = [];          // {t0, rr}
    this.cycles = new Map();  // rr (мс, округлённый) → cycle
    this.onCycle = null;      // хук на создание цикла (подключение ЭКГ)
    this._push();
  }

  // RR всегда целое число мс: удар и его цикл (кэш по RR) совпадают точно.
  _nextRR() {
    if (this.rhythm !== 'af') return Math.round(this.rr0);
    // При ФП интервалы RR разбросаны примерно логнормально (CV ≈ 20–25 %).
    const k = Math.exp(this.rrJitter * gaussian(this.rand));
    return Math.round(Math.min(1.8, Math.max(0.5, k)) * this.rr0);
  }

  _push() {
    const prev = this.beats[this.beats.length - 1];
    const t0 = prev ? prev.t0 + prev.rr : 0;
    // svBefore — сумма ударных объёмов предыдущих ударов (привод частиц кровотока).
    const svBefore = prev ? prev.svBefore + this.cycleFor(prev.rr).lv.sv : 0;
    // aBefore — то же для объёма активного опорожнения ЛП (привод частиц в ушке).
    const aBefore = prev ? prev.aBefore + this.cycleFor(prev.rr).lv.aVol : 0;
    this.beats.push({ t0, rr: this._nextRR(), index: this.beats.length, svBefore, aBefore });
  }

  cycleFor(rr) {
    const key = Math.round(rr);
    let c = this.cycles.get(key);
    if (!c) { c = makeCycle({ ...this.params, hr: this.hr, rhythm: this.rhythm, rr: key }); this.cycles.set(key, c); if (this.onCycle) this.onCycle(c); }
    return c;
  }

  // Удар, содержащий момент T (T < 0 → первый удар).
  at(T) {
    const t = Math.max(0, T);
    while (this.beats[this.beats.length - 1].t0 + this.beats[this.beats.length - 1].rr <= t) this._push();
    // Бинарный поиск по t0.
    let lo = 0, hi = this.beats.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.beats[mid].t0 <= t) lo = mid; else hi = mid; }
    const beat = this.beats[hi].t0 <= t ? this.beats[hi] : this.beats[lo];
    return { beat, t: t - beat.t0, cycle: this.cycleFor(beat.rr) };
  }

  // Список RR первых n ударов (для тестов и полосы Виггерса).
  rrList(n) {
    while (this.beats.length < n) this._push();
    return this.beats.slice(0, n).map((b) => b.rr);
  }
}
