// Сценарии: каждый строится, объёмы и ФВ в ожидаемых пределах, ударные
// объёмы сторон равны, события упорядочены; ФП нерегулярна и без A-волны;
// БЛНПГ — широкий QRS и задержка боковой стенки.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, scenarioByKey } from '../src/content/scenarios.js';
import { makeCycle } from '../src/cycle.js';
import { Timeline } from '../src/timeline.js';
import { ventricleGrids } from '../src/geometry/ventricleGrids.js';
import { atriumGrids } from '../src/geometry/atriaShape.js';
import { LA, RA } from '../src/geometry/layout.js';
import { REGION } from '../src/geometry/lvshape.js';
import { GEOMETRY as G } from '../src/physiology.js';
import { activationMap } from '../src/conduction.js';

const grids = ventricleGrids();
const atria = { la: atriumGrids({ A: LA, wall: G.atrialWall, region: REGION.LA }), ra: atriumGrids({ A: RA, wall: G.atrialWall, region: REGION.RA }) };
const acts = { norm: activationMap({ grids, atria }), lbbb: activationMap({ grids, atria, params: { lbbb: true } }) };

const EF = { rest: [55, 62], exercise: [63, 70], af: [50, 56], hfref: [28, 33], lad: [40, 45], lbbb: [48, 53] };

for (const sc of SCENARIOS) {
  test(`сценарий «${sc.title}»: цикл, ФВ ${EF[sc.key][0]}–${EF[sc.key][1]} %, равные УО, события по порядку, текст`, () => {
    const tl = new Timeline({ ...sc.timeline, params: sc.cycle });
    const c = tl.cycleFor(tl.beats[0].rr);
    const ef = c.lv.ef * 100;
    assert.ok(ef >= EF[sc.key][0] && ef <= EF[sc.key][1], `ФВ ${ef.toFixed(1)}`);
    assert.ok(Math.abs(c.lv.sv - c.rv.sv) < 0.5, `УО ЛЖ ${c.lv.sv} ≠ ПЖ ${c.rv.sv}`);
    const ev = [...c.events, ...sc.notes(c, acts[sc.conduction.lbbb ? 'lbbb' : 'norm'])];
    for (const e of ev) assert.ok(Number.isFinite(e.t) && e.t >= 0 && e.t <= c.rr, `событие ${e.key} t=${e.t}`);
    assert.ok(c.times.tMc < c.times.tAo && c.times.tAo < c.times.tAc && c.times.tAc < c.times.tMo && c.times.tMo < c.rr);
    const text = sc.text({ c, act: acts[sc.conduction.lbbb ? 'lbbb' : 'norm'], sc });
    const sentences = text.split(/[.!?]\s/).filter((s) => s.trim().length > 0).length;
    assert.ok(sentences >= 3 && sentences <= 6, `предложений ${sentences}`);
    assert.ok(!/undefined|NaN/.test(text), text);
  });
}

test('нагрузка: диастола втрое короче покоя, изгнание — вдвое', () => {
  const r = makeCycle({ hr: 65 }), e = makeCycle({ hr: 150, lvESV: 40 });
  const dia = (c) => c.rr + c.times.tMc - c.times.tMo, ej = (c) => c.times.tAc - c.times.tAo;
  assert.ok(dia(r) / dia(e) > 2.5 && dia(r) / dia(e) < 3.5, `диастола ${dia(r)} / ${dia(e)}`);
  assert.ok(ej(r) / ej(e) > 1.7 && ej(r) / ej(e) < 2.1, `изгнание ${ej(r)} / ${ej(e)}`);
});

test('ФП: интервалы нерегулярны, A-волны нет, привод ушка ЛП стоит', () => {
  const sc = scenarioByKey('af');
  const tl = new Timeline({ ...sc.timeline, params: sc.cycle });
  const rr = tl.rrList(40);
  const mean = rr.reduce((a, b) => a + b, 0) / rr.length, sd = Math.sqrt(rr.reduce((a, b) => a + (b - mean) ** 2, 0) / rr.length);
  assert.ok(sd / mean > 0.1, `CV ${sd / mean}`);
  const c = tl.cycleFor(rr[0]);
  assert.equal(c.lv.aVol, 0);
  assert.equal(c.cumFlow(c.rr).laA, 0);
  // Синус: за цикл через ушко проходит объём предсердной систолы.
  const s = makeCycle({ hr: 65, rr: 923 });
  assert.ok(Math.abs(s.cumFlow(s.rr).laA - s.lv.aVol) < 1e-6 && s.lv.aVol > 10, `A-объём ${s.lv.aVol}`);
  let prev = 0; for (let t = 0; t <= s.rr; t += 5) { const v = s.cumFlow(t).laA; assert.ok(v >= prev - 1e-9); prev = v; }
});

test('СНнФВ: КДО 200, УО ПЖ подстроен под ЛЖ', () => {
  const sc = scenarioByKey('hfref');
  const c = makeCycle({ hr: sc.timeline.hr, ...sc.cycle });
  assert.equal(Math.round(c.lv.edv), 200);
  assert.ok(Math.abs(c.rv.sv - 60) < 0.5);
});

test('БЛНПГ: QRS ≥ 120 мс, боковая стенка позже перегородки на 50–100 мс, в норме < 35', () => {
  assert.ok(acts.lbbb.stats.qrsDuration >= 110, `QRS ${acts.lbbb.stats.qrsDuration}`);
  assert.ok(acts.lbbb.stats.lateralDelay >= 50 && acts.lbbb.stats.lateralDelay <= 100, `задержка ${acts.lbbb.stats.lateralDelay}`);
  assert.ok(acts.norm.stats.lateralDelay < 35, `норма ${acts.norm.stats.lateralDelay}`);
});
