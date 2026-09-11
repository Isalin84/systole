// Проводящая система: порядок и длительности активации, псевдо-ЭКГ из карты.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ventricleGrids } from '../src/geometry/ventricleGrids.js';
import { atriumGrids } from '../src/geometry/atriaShape.js';
import { LA, RA } from '../src/geometry/layout.js';
import { REGION } from '../src/geometry/lvshape.js';
import { activationMap, ecgTables, ecgAt, conductionTree } from '../src/conduction.js';
import { makeCycle } from '../src/cycle.js';
import { GEOMETRY as G } from '../src/physiology.js';

const grids = ventricleGrids();
const atria = { la: atriumGrids({ A: LA, wall: G.atrialWall, region: REGION.LA }), ra: atriumGrids({ A: RA, wall: G.atrialWall, region: REGION.RA }) };
const normal = activationMap({ grids, atria });
const lbbb = activationMap({ grids, atria, params: { lbbb: true } });

test('норма: QRS 60–100 мс, последней активируется основание, эпикард позже эндокарда', () => {
  const s = normal.stats;
  assert.ok(s.qrsDuration >= 55 && s.qrsDuration <= 100, `QRS ${s.qrsDuration}`);
  assert.ok(s.lastVent >= 70 && s.lastVent <= 110, `последняя активация ${s.lastVent}`);
  const lv = normal.vent.lvEndo, epi = normal.vent.epi;
  for (let k = 0; k < lv.length; k++) if (grids.epi.region[k] !== REGION.RV) assert.ok(epi[k] >= lv[k] - 1e-6, `эпикард раньше эндокарда k=${k}`);
  // Первая активация — на перегородке ЛЖ, у основания позже, чем в середине.
  let tApexBand = 0, tBaseBand = 0, nA = 0, nB = 0;
  for (let k = 0; k < lv.length; k++) { const v = grids.lvEndo.param[k * 2 + 1]; if (v > 0.2 && v < 0.5) { tApexBand += lv[k]; nA++; } if (v > 0.9) { tBaseBand += lv[k]; nB++; } }
  assert.ok(tBaseBand / nB > tApexBand / nA, 'основание активируется позже верхушечной трети');
  assert.ok(Math.min(...lv) < 1e-6, 'начало QRS — t = 0');
});

test('предсердия: P 70–120 мс, ЛП после ПП', () => {
  assert.ok(normal.stats.pDuration >= 70 && normal.stats.pDuration <= 120, `P ${normal.stats.pDuration}`);
  assert.ok(Math.min(...normal.atr.la.outer) > Math.min(...normal.atr.ra.outer) + 15, 'ЛП начинает позже ПП');
});

test('блокада ЛНПГ: QRS ≥ 120 мс, ЛЖ активируется после ПЖ', () => {
  assert.ok(lbbb.stats.lastVent - lbbb.stats.qrsStart >= 120, `QRS при БЛНПГ ${lbbb.stats.lastVent - lbbb.stats.qrsStart}`);
  const lvMean = (act) => act.vent.lvEndo.reduce((a, b) => a + b, 0) / act.vent.lvEndo.length;
  assert.ok(lvMean(lbbb) > lvMean(normal) + 30, 'ЛЖ активируется заметно позже');
});

test('ЭКГ из карты: R > 0 в II, T согласный, P положительный, QT в норме, периодичность', () => {
  const tab = ecgTables({ grids, act: normal, atria });
  const c = makeCycle({ hr: 65 });
  c.attachEcg(tab);
  const rr = c.rr, pOnset = c.times.pOnset;
  let rMax = -1e9, rT = 0, tMax = -1e9, tMin = 1e9, tT = 0, pMax = -1e9, pT = 0, qtEnd = 0;
  for (let t = 0; t < rr; t++) {
    const v = c.ecg(t);
    if (t < 120 && v > rMax) { rMax = v; rT = t; }
    if (t > 150 && t < 500) { if (v > tMax) { tMax = v; tT = t; } tMin = Math.min(tMin, v); if (Math.abs(v) > 0.05) qtEnd = t; }
    if (t > pOnset - 10 && v > pMax) { pMax = v; pT = t; }
  }
  assert.ok(rMax > 0.85 && rMax < 1.05 && rT >= 15 && rT <= 60, `R ${rMax} при ${rT}`);
  assert.ok(tMax > 0.12 && tMax > -tMin, `T ${tMax} / ${tMin}`);
  assert.ok(pMax > 0.05 && pMax < 0.3 && pT - pOnset > 20 && pT - pOnset < 110, `P ${pMax} при ${pT - pOnset}`);
  assert.ok(qtEnd >= 340 && qtEnd <= 460, `QT ${qtEnd}`);
  assert.ok(Math.abs(c.ecg(0) - c.ecg(rr)) < 1e-6);
  // Между концом T и началом P — изолиния.
  for (let t = qtEnd + 40; t < pOnset - 10; t += 5) assert.ok(Math.abs(c.ecg(t)) < 0.05, `не изолиния при t=${t}`);
});

test('ЭКГ при БЛНПГ шире, чем в норме', () => {
  const width = (act) => { const tab = ecgTables({ grids, act, atria }); const c = makeCycle({ hr: 65 }); c.attachEcg(tab); let first = null, last = 0; for (let t = -30; t < 200; t++) { if (Math.abs(c.ecg(t)) > 0.08) { if (first === null) first = t; last = t; } } return last - first; };
  assert.ok(width(lbbb) > width(normal) + 30, `ширина ${width(lbbb)} против ${width(normal)}`);
});

test('дерево: импульс доходит до АВ-узла за 30–60 мс, ножки активируются до Пуркинье', () => {
  const tree = conductionTree();
  assert.ok(tree.tAV >= 30 && tree.tAV <= 60, `АВ ${tree.tAV}`);
  const by = Object.fromEntries(tree.branches.map((b) => [b.name, b]));
  assert.ok(by.lbb.times[0] < by.lafb.times[0] && by.lafb.times[0] < by.purkLa.times[0]);
  assert.ok(by.rbb.times[0] < by.moderator.times[0] && by.moderator.times[0] < by.purkRa.times[0]);
  for (const b of tree.branches) for (let i = 1; i < b.times.length; i++) assert.ok(b.times[i] > b.times[i - 1]);
});
