// cycle.js — сердечный цикл как функции времени. Чистый модуль без three.js.
//
// Время t — миллисекунды от начала QRS, цикл периодичен с периодом RR.
// Границы фаз выводятся из RR (Weissler для PEP и LVET, IVRT ~ √RR, PQ ~ RR^¼),
// кривые давлений и объёма — монотонные кубические сплайны по ключевым
// точкам, привязанным к этим границам. Положение створок выводится из знака
// градиента давления, а сам знак обеспечен построением: в каждой фазе одна
// кривая первичная, вторая = первичная ± положительный «горб», равный нулю
// ровно на границе фазы. Поэтому изоволюмические фазы, S1/S2 и перестройка
// при смене ЧСС получаются сами.
import { VOLUMES, PRESSURES, TIMING, lvet, pep, ivrt, pq } from './physiology.js';
import { ecgAt } from './conduction.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Монотонный кубический сплайн (Fritsch–Carlson) по точкам [[x, y], ...].
// Не даёт выбросов между точками, поэтому пригоден для кривых давлений.
export function monotoneCubic(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  if (n === 1) return () => pts[0][1];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
    const h = xs[hi] - xs[lo], u = (x - xs[lo]) / h;
    const h00 = (1 + 2 * u) * (1 - u) * (1 - u), h10 = u * (1 - u) * (1 - u), h01 = u * u * (3 - 2 * u), h11 = u * u * (u - 1);
    return h00 * ys[lo] + h10 * h * m[lo] + h01 * ys[hi] + h11 * h * m[hi];
  };
}

// Периодический сплайн: точки могут лежать за пределами [0, rr) (например,
// RR + tMc); список расширяется копиями со сдвигом ±RR, аргумент сворачивается.
export function periodic(points, rr) {
  const ext = [];
  const seen = new Set();
  for (const k of [-1, 0, 1]) for (const [x, y] of points) {
    const xx = x + k * rr, key = Math.round(xx * 1e6);
    if (!seen.has(key)) { seen.add(key); ext.push([xx, y]); }
  }
  const f = monotoneCubic(ext);
  return (t) => f(((t % rr) + rr) % rr);
}

const wrapT = (t, rr) => ((t % rr) + rr) % rr;

// Одна сторона сердца (левая или правая): желудочек, его предсердие,
// его артерия и два клапана. cfg — тайминги и уровни давлений.
function sideCurves(cfg) {
  const { rr, tVc, tSo, tSc, tVo, edv, esv, fillE, fillA, pSys, pEdp, pArtDia, pAtrMean, eDur, aStart, atrMax, atrMin } = cfg;
  const aEnd = rr + tVc;                       // конец A-волны = закрытие АВ-клапана
  const eEnd = tVo + eDur;
  // Диастолическое время: непрерывно от tVo через RR до aEnd.
  const dia = (t) => { const w = wrapT(t, rr); return w >= tVo ? w : w + rr; };
  const inDiastole = (t) => { const w = wrapT(t, rr); return w > tVo || w < tVc; };

  // --- Объём -----------------------------------------------------------------
  const sv0 = edv - esv;
  // E-волна: ускорение ~50 мс, пик потока в первой трети, затем замедление.
  const eShape = monotoneCubic([[0, 0], [0.1, 0.06], [0.3, 0.5], [0.6, 0.86], [0.8, 0.97], [1, 1]]);
  const E = (tau) => eShape(clamp01((tau - tVo) / eDur));
  const A = (tau) => (fillA > 0 ? smoothstep(aStart, aEnd, tau) : 0);
  const vDia = (tau) => esv + sv0 * (fillE * E(tau) + fillA * A(tau));
  const edvEff = vDia(aEnd);                   // при ФП меньше номинала
  const svEff = edvEff - esv;
  // Изгнание: доля выброшенного объёма по нормированному времени — быстрое
  // начало, затухающий конец (поток → 0 к закрытию клапана).
  const eject = monotoneCubic([[0, 0], [0.25, 0.42], [0.5, 0.75], [0.75, 0.93], [1, 1]]);
  const volume = (t) => {
    const w = wrapT(t, rr);
    if (w >= tVc && w < tSo) return edvEff;
    if (w >= tSo && w < tSc) return edvEff - svEff * eject((w - tSo) / (tSc - tSo));
    if (w >= tSc && w <= tVo) return esv;
    return vDia(dia(w));
  };
  const flow = (t) => (volume(t + 0.5) - volume(t - 0.5));   // мл/мс, + наполнение
  // Накопленные объёмы с начала цикла (шаг 1 мс): вошедший через АВ-клапан и
  // вышедший через полулунный. За цикл каждый равен УО, поэтому суммы по
  // ударам непрерывны. Приводят частицы кровотока.
  const nT = Math.ceil(rr) + 1, cumIn = new Float64Array(nT), cumOut = new Float64Array(nT);
  for (let i = 1; i < nT; i++) {
    const dv = volume(Math.min(i, rr)) - volume(Math.min(i - 1, rr));
    cumIn[i] = cumIn[i - 1] + Math.max(dv, 0); cumOut[i] = cumOut[i - 1] + Math.max(-dv, 0);
  }
  // t = RR — конец цикла (полный УО), а не его начало.
  const cumAt = (arr, t) => { const w = Math.abs(t - rr) < 1e-9 ? rr : wrapT(t, rr); const i = Math.min(nT - 2, Math.floor(w)), f = w - i; return arr[i] + (arr[i + 1] - arr[i]) * f; };
  // Активное опорожнение предсердия (A-волна): накопленный объём, ушедший из
  // предсердия его сокращением. За цикл = fillA·УО; при ФП — 0. Приводит частицы в ушке.
  const cumA = new Float64Array(nT);
  const aVol = (t) => fillA * sv0 * A(dia(Math.min(t, rr)));
  for (let i = 1; i < nT; i++) cumA[i] = cumA[i - 1] + Math.max(aVol(i) - aVol(i - 1), 0);
  const cum = (t) => ({ in: cumAt(cumIn, t), out: cumAt(cumOut, t), atrial: cumAt(cumA, t) });

  // --- Давления --------------------------------------------------------------
  const pNotch = pArtDia + 0.4 * (pSys - pArtDia);
  const pAtrV = pAtrMean * 1.4, pAtrC = pAtrMean * 1.15, pAtrX = pAtrMean * 0.6, pAtrA = pAtrMean * 1.3;
  // Предсердие: систола желудочка (c, x, v) — первичная; диастола (y, диастазис, a) — первичная.
  const atrPts = [
    [tVc, pEdp], [tVc + 0.3 * (tSo - tVc), pAtrC], [tSo + 0.4 * (tSc - tSo), pAtrX], [tVo, pAtrV],
    [tVo + 0.5 * eDur, pAtrMean - 2], [eEnd, pAtrMean - 1],
  ];
  if (fillA > 0) atrPts.push([Math.max(aStart, eEnd + 1), pAtrMean - 1], [aStart + 0.55 * (aEnd - aStart), pAtrA], [aEnd, pEdp]);
  else atrPts.push([aEnd, pEdp]);
  const pAtr = periodic(atrPts, rr);
  // Желудочек в систоле — первичная кривая от закрытия до открытия АВ-клапана.
  const ventSys = periodic([
    [tVc, pEdp], [tVc + 0.3 * (tSo - tVc), pEdp + 0.35 * (pArtDia - pEdp)], [tSo, pArtDia],
    [tSo + 0.35 * (tSc - tSo), pSys], [tSo + 0.7 * (tSc - tSo), pSys - 0.1 * (pSys - pArtDia)], [tSc, pNotch],
    [tSc + 0.5 * (tVo - tSc), pAtrV + 0.3 * (pNotch - pAtrV)], [tVo, pAtrV],
    // Вне систолы значение не используется, но точки нужны для периодичности.
    [aEnd, pEdp],
  ], rr);
  // Градиент через АВ-клапан в диастолу: > 0 строго внутри (tVo, aEnd), 0 на краях.
  const gradAV = (tau) => {
    const w = smoothstep(tVo, tVo + 10, tau) * (1 - smoothstep(aEnd - 10, aEnd, tau));
    const hE = Math.sin(Math.PI * clamp01((tau - tVo) / eDur));
    const hA = fillA > 0 ? Math.sin(Math.PI * clamp01((tau - aStart) / (aEnd - aStart))) : 0;
    return w * (0.3 + 3 * hE + 1.5 * hA) * (pSys / PRESSURES.lvSystolic);
  };
  const pVent = (t) => (inDiastole(t) ? pAtr(t) - gradAV(dia(t)) : ventSys(t));
  // Артерия: в изгнание = желудочек − горб, в диастолу — своя кривая
  // от инцизуры до диастолического уровня к следующему открытию.
  const gradArt = (s) => 0.04 * pSys * Math.sin(Math.PI * s);
  const pDicr = pNotch + 0.02 * pSys;
  const artDia = monotoneCubic([
    [tSc, pNotch], [tSc + 15, pNotch - 0.06 * pSys], [tSc + 45, pDicr],
    [tSc + 45 + 0.4 * (rr + tSo - tSc - 45), pArtDia + 0.45 * (pDicr - pArtDia)], [rr + tSo, pArtDia],
  ]);
  const pArt = (t) => {
    const w = wrapT(t, rr);
    if (w > tSo && w < tSc) return pVent(w) - gradArt((w - tSo) / (tSc - tSo));
    return artDia(w <= tSo ? w + rr : w);
  };

  // --- Клапаны: ворота по знаку градиента × степень раскрытия по потоку -------
  const { valveOpenMs: to, valveCloseMs: tc } = TIMING;
  const gateAV = (t) => {
    const tau = dia(t);
    if (!inDiastole(t)) return 0;
    return smoothstep(tVo, tVo + to, tau) * (1 - smoothstep(aEnd - tc, aEnd, tau));
  };
  const gateSL = (t) => {
    const w = wrapT(t, rr);
    if (w <= tSo || w >= tSc) return 0;
    return smoothstep(tSo, tSo + to, w) * (1 - smoothstep(tSc - tc, tSc, w));
  };
  let qE = 0, qEj = 0;
  for (let t = 0; t < rr; t += 2) { const q = flow(t); if (q > qE) qE = q; if (-q > qEj) qEj = -q; }
  const qRefE = 0.6 * qE, qRefEj = 0.6 * qEj;
  const avOpen = (t) => gateAV(t) * (0.3 + 0.7 * clamp01(flow(t) / qRefE));
  const slOpen = (t) => gateSL(t) * (0.5 + 0.5 * clamp01(-flow(t) / qRefEj));

  // --- Объём предсердия: минимум после сокращения, максимум перед открытием АВ-клапана.
  const atrMid = atrMin + 0.5 * (atrMax - atrMin);
  const atrEndValue = fillA > 0 ? atrMin : atrMid;
  const atrPtsV = [[tVc, atrEndValue], [tVo, atrMax], [eEnd, atrMid]];
  if (fillA > 0) atrPtsV.push([Math.max(aStart, eEnd + 1), atrMid]);
  atrPtsV.push([aEnd, atrEndValue]);
  const atrVolume = periodic(atrPtsV, rr);

  return {
    times: { tVc, tSo, tSc, tVo, eEnd, aStart, aEnd },
    volume, flow, pVent, pAtr, pArt, avOpen, slOpen, gateAV, gateSL, atrVolume, cum,
    edv: edvEff, esv, sv: svEff, ef: svEff / edvEff, aVol: fillA * sv0,
  };
}

// Параметры: hr — ЧСС; rhythm — 'sinus' | 'af' (при ФП предсердия не
// сокращаются: fillA = 0); остальное — переопределения физиологии для сценариев.
export function makeCycle(params = {}) {
  const hr = params.hr ?? TIMING.hrRest;
  const rhythm = params.rhythm ?? 'sinus';
  const rr = params.rr ?? 60000 / hr;
  const hrEff = 60000 / rr;
  const fillA = rhythm === 'af' ? 0 : (params.fillA ?? VOLUMES.fillA);
  const fillE = params.fillE ?? VOLUMES.fillE;

  // Левые отделы.
  const tMc = TIMING.emd;
  const tAo = pep(hrEff);
  const tAc = tAo + lvet(hrEff);
  const tMo = tAc + ivrt(hrEff);
  const pqEff = pq(hrEff);
  const pOnset = rr - pqEff;
  const diastole = rr + tMc - tMo;
  const eDur = Math.min(TIMING.eWaveMax, TIMING.eWaveFraction * diastole);
  const aStart = Math.max(tMo + 5, pOnset + TIMING.atrialDelay);

  const left = sideCurves({
    rr, tVc: tMc, tSo: tAo, tSc: tAc, tVo: tMo, eDur, aStart,
    edv: params.lvEDV ?? VOLUMES.lvEDV, esv: params.lvESV ?? VOLUMES.lvESV, fillE, fillA,
    pSys: params.aoSystolic ?? PRESSURES.lvSystolic, pEdp: PRESSURES.lvEDP,
    pArtDia: params.aoDiastolic ?? PRESSURES.aoDiastolic, pAtrMean: PRESSURES.laMean,
    atrMax: VOLUMES.laMax, atrMin: VOLUMES.laMin,
  });
  // Правые отделы: сдвиги клапанов относительно левых; IVRT ПЖ не короче 20 мс.
  const tTc = tMc + TIMING.tvCloseOffset;
  const tPo = tAo + TIMING.pvOpenOffset;
  const tPc = tAc + TIMING.pvCloseOffset;
  const tTo = Math.max(tPc + 20, tMo + TIMING.tvOpenOffset);
  // Ударные объёмы сторон равны: КСО ПЖ следует за УО ЛЖ (сценарии меняют левые объёмы).
  const rvEDV = params.rvEDV ?? VOLUMES.rvEDV;
  const rvESV = params.rvESV ?? (rvEDV - ((params.lvEDV ?? VOLUMES.lvEDV) - (params.lvESV ?? VOLUMES.lvESV)));
  const right = sideCurves({
    rr, tVc: tTc, tSo: tPo, tSc: tPc, tVo: tTo, eDur, aStart: Math.max(tTo + 5, aStart),
    edv: rvEDV, esv: rvESV, fillE, fillA,
    pSys: PRESSURES.rvSystolic, pEdp: PRESSURES.rvEDP, pArtDia: PRESSURES.paDiastolic, pAtrMean: PRESSURES.raMean,
    atrMax: VOLUMES.raMax, atrMin: VOLUMES.raMin,
  });

  // Скручивание ЛЖ: 0 при закрытии МК, часть к открытию АК, максимум в конце
  // изгнания, быстрое раскручивание в IVRT, остаток — за E-волну.
  const twistNorm = periodic([[tMc, 0], [tAo, 0.25], [tAc, 1], [tMo, 0.5], [left.times.eEnd, 0], [rr + tMc, 0]], rr);

  const times = {
    tMc, tAo, tAc, tMo, tTc, tPo, tPc, tTo,
    eEnd: left.times.eEnd, aStart, aEnd: rr + tMc, pOnset, qrs: 0, pq: pqEff,
  };
  const events = [
    { t: 0, key: 'qrs', label: 'Начало QRS' },
    { t: tMc, key: 'mitralClose', label: 'Закрытие митрального клапана (S1)' },
    { t: tTc, key: 'tricuspidClose', label: 'Закрытие трикуспидального клапана (S1)' },
    { t: tPo, key: 'pulmonaryOpen', label: 'Открытие клапана лёгочной артерии' },
    { t: tAo, key: 'aorticOpen', label: 'Открытие аортального клапана' },
    { t: tAc, key: 'aorticClose', label: 'Закрытие аортального клапана (A2)' },
    { t: tPc, key: 'pulmonaryClose', label: 'Закрытие клапана лёгочной артерии (P2)' },
    { t: tTo, key: 'tricuspidOpen', label: 'Открытие трикуспидального клапана' },
    { t: tMo, key: 'mitralOpen', label: 'Открытие митрального клапана' },
    { t: left.times.eEnd, key: 'eEnd', label: 'Конец быстрого наполнения' },
    { t: pOnset, key: 'pOnset', label: 'Зубец P' },
  ];
  if (fillA > 0) events.push({ t: aStart, key: 'atrialSystole', label: 'Систола предсердий' });
  events.sort((a, b) => a.t - b.t);

  const phase = (t) => {
    const w = wrapT(t, rr);
    if (w >= tMc && w < tAo) return 'Изоволюмическое сокращение';
    if (w >= tAo && w < tAc) return 'Изгнание';
    if (w >= tAc && w < tMo) return 'Изоволюмическое расслабление';
    const fused = left.times.eEnd > aStart;
    if (w >= tMo && w < left.times.eEnd) return fused && fillA > 0 && w >= aStart ? 'Наполнение (E и A слиты)' : 'Быстрое наполнение';
    if (fillA > 0 && (w >= aStart || w < tMc)) return 'Систола предсердий';
    return 'Диастазис';
  };

  const cycle = {
    hr: hrEff, rr, rhythm, times, events, phase,
    pqScale: pqEff / TIMING.pq,
    // ЭКГ из карты активации (таблицы conduction.ecgTables); до подключения — 0.
    ecg: () => 0,
    attachEcg(tab) { cycle.ecg = (t) => (fillA > 0 ? ecgAt(tab, t, rr, pOnset, pqEff / TIMING.pq) : ecgAt({ ...tab, atr: new Float32Array(tab.atr.length) }, t, rr, pOnset, 1)); },
    lvVolume: left.volume, rvVolume: right.volume, laVolume: left.atrVolume, raVolume: right.atrVolume,
    pLV: left.pVent, pAo: left.pArt, pLA: left.pAtr, pRV: right.pVent, pPA: right.pArt, pRA: right.pAtr,
    flows: (t) => ({ mitral: Math.max(0, left.flow(t)), aortic: Math.max(0, -left.flow(t)), tricuspid: Math.max(0, right.flow(t)), pulmonary: Math.max(0, -right.flow(t)) }),
    valves: (t) => ({ mitral: left.avOpen(t), aortic: left.slOpen(t), tricuspid: right.avOpen(t), pulmonary: right.slOpen(t) }),
    gates: (t) => ({ mitral: left.gateAV(t) > 0, aortic: left.gateSL(t) > 0, tricuspid: right.gateAV(t) > 0, pulmonary: right.gateSL(t) > 0 }),
    // Накопленные объёмы (мл) с начала цикла: через АВ-клапаны (in) и полулунные (out).
    cumFlow: (t) => { const l = left.cum(t), r = right.cum(t); return { lvIn: l.in, lvOut: l.out, rvIn: r.in, rvOut: r.out, laA: l.atrial, raA: r.atrial }; },
    twist: (t) => twistNorm(t),
    lv: { edv: left.edv, esv: left.esv, sv: left.sv, ef: left.ef, aVol: left.aVol },
    rv: { edv: right.edv, esv: right.esv, sv: right.sv, ef: right.ef, aVol: right.aVol },
    wrap: (t) => wrapT(t, rr),
  };
  return cycle;
}
