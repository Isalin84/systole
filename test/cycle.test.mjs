// Инварианты сердечного цикла. Запуск: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCycle } from '../src/cycle.js';
import { PRESSURES, TIMING, lvet } from '../src/physiology.js';

const HRS = [50, 65, 100, 150];
const EPS_T = 1.5; // мс: точки на самих границах фаз не проверяем (там градиент = 0 по построению)

function nearEvent(c, t) {
  const w = c.wrap(t);
  return Object.values(c.times).some((x) => { const d = Math.abs(w - c.wrap(x)); return d < EPS_T || d > c.rr - EPS_T; });
}
const range = (a, b, step = 1) => { const out = []; for (let t = a; t < b; t += step) out.push(t); return out; };
const argext = (f, c, sign = 1) => { let best = -Infinity, tb = 0; for (let t = 0; t < c.rr; t += 0.5) { const v = sign * f(t); if (v > best) { best = v; tb = t; } } return tb; };

for (const hr of HRS) {
  const c = makeCycle({ hr });
  const T = c.times;

  test(`ЧСС ${hr}: изоволюмические фазы — объём постоянен, клапаны закрыты`, () => {
    for (const [a, b, vol, gA, gB] of [
      [T.tMc, T.tAo, c.lvVolume, 'mitral', 'aortic'], [T.tAc, T.tMo, c.lvVolume, 'mitral', 'aortic'],
      [T.tTc, T.tPo, c.rvVolume, 'tricuspid', 'pulmonary'], [T.tPc, T.tTo, c.rvVolume, 'tricuspid', 'pulmonary'],
    ]) {
      const v0 = vol(a + EPS_T);
      for (const t of range(a + EPS_T, b - EPS_T, 0.5)) {
        assert.ok(Math.abs(vol(t) - v0) < 0.01, `объём меняется в изоволюмической фазе t=${t}`);
        const g = c.gates(t);
        assert.equal(g[gA], false, `${gA} открыт в изоволюмической фазе t=${t}`);
        assert.equal(g[gB], false, `${gB} открыт в изоволюмической фазе t=${t}`);
      }
    }
  });

  test(`ЧСС ${hr}: поток ⇔ открытый клапан`, () => {
    for (const t of range(0, c.rr, 1)) {
      if (nearEvent(c, t)) continue;
      const g = c.gates(t);
      const dvL = c.lvVolume(t + 0.5) - c.lvVolume(t - 0.5), dvR = c.rvVolume(t + 0.5) - c.rvVolume(t - 0.5);
      if (dvL > 0.01) { assert.ok(g.mitral && !g.aortic, `наполнение ЛЖ при закрытом МК t=${t}`); }
      if (dvL < -0.01) { assert.ok(g.aortic && !g.mitral, `изгнание ЛЖ при закрытом АК t=${t}`); }
      if (dvR > 0.01) { assert.ok(g.tricuspid && !g.pulmonary, `наполнение ПЖ при закрытом ТК t=${t}`); }
      if (dvR < -0.01) { assert.ok(g.pulmonary && !g.tricuspid, `изгнание ПЖ при закрытом ЛК t=${t}`); }
      if (g.aortic) assert.ok(dvL < 0, `АК открыт без потока t=${t}`);
      if (g.pulmonary) assert.ok(dvR < 0, `ЛК открыт без потока t=${t}`);
    }
  });

  test(`ЧСС ${hr}: ворота клапанов совпадают со знаком градиента давления`, () => {
    for (const t of range(0, c.rr, 1)) {
      if (nearEvent(c, t)) continue;
      const g = c.gates(t);
      assert.equal(c.pLV(t) > c.pAo(t), g.aortic, `аортальный: градиент и ворота расходятся t=${t} pLV=${c.pLV(t).toFixed(1)} pAo=${c.pAo(t).toFixed(1)}`);
      assert.equal(c.pLA(t) > c.pLV(t), g.mitral, `митральный: градиент и ворота расходятся t=${t} pLA=${c.pLA(t).toFixed(1)} pLV=${c.pLV(t).toFixed(1)}`);
      assert.equal(c.pRV(t) > c.pPA(t), g.pulmonary, `лёгочный: градиент и ворота расходятся t=${t}`);
      assert.equal(c.pRA(t) > c.pRV(t), g.tricuspid, `трикуспидальный: градиент и ворота расходятся t=${t}`);
    }
  });

  test(`ЧСС ${hr}: тоны сердца`, () => {
    assert.ok(T.tMc >= 20 && T.tMc <= 60, 'S1 в 20–60 мс от QRS');
    assert.ok(Math.abs(T.tAc - (T.tAo + lvet(hr))) < 1e-6, 'S2 = открытие АК + LVET');
    assert.ok(T.tPc - T.tAc >= 20 && T.tPc - T.tAc <= 40, 'расщепление S2 20–40 мс');
    assert.ok(T.tTc > T.tMc, 'трикуспидальный закрывается после митрального');
    assert.ok(T.tPo < T.tAo, 'лёгочный открывается раньше аортального');
  });

  test(`ЧСС ${hr}: уровни давлений`, () => {
    let pLVmax = 0, pAomin = 1e9, pLAmin = 1e9, pLAmax = 0, pRVmax = 0, pPAmin = 1e9;
    for (const t of range(0, c.rr, 0.5)) {
      pLVmax = Math.max(pLVmax, c.pLV(t)); pAomin = Math.min(pAomin, c.pAo(t));
      pLAmin = Math.min(pLAmin, c.pLA(t)); pLAmax = Math.max(pLAmax, c.pLA(t));
      pRVmax = Math.max(pRVmax, c.pRV(t)); pPAmin = Math.min(pPAmin, c.pPA(t));
    }
    assert.ok(Math.abs(pLVmax - PRESSURES.lvSystolic) < 2, `pLV max ${pLVmax}`);
    assert.ok(Math.abs(pAomin - PRESSURES.aoDiastolic) < 2, `pAo min ${pAomin}`);
    assert.ok(pLAmin >= 4 && pLAmax <= 16, `pLA в [4, 16]: ${pLAmin}–${pLAmax}`);
    assert.ok(Math.abs(pRVmax - PRESSURES.rvSystolic) < 1, `pRV max ${pRVmax}`);
    assert.ok(Math.abs(pPAmin - PRESSURES.paDiastolic) < 1, `pPA min ${pPAmin}`);
  });

  test(`ЧСС ${hr}: периодичность и непрерывность кривых`, () => {
    const fns = { pLV: c.pLV, pAo: c.pAo, pLA: c.pLA, pRV: c.pRV, pPA: c.pPA, pRA: c.pRA, lvVolume: c.lvVolume, rvVolume: c.rvVolume, laVolume: c.laVolume, raVolume: c.raVolume, twist: c.twist };
    for (const [name, f] of Object.entries(fns)) {
      assert.ok(Math.abs(f(0) - f(c.rr)) < 1e-9, `${name}: f(0) ≠ f(RR)`);
      // Скачки не больше, чем ожидаемо от производной: проверяем шаг 1 мс по всему циклу.
      let maxJump = 0;
      for (const t of range(-2, c.rr + 2, 1)) maxJump = Math.max(maxJump, Math.abs(f(t + 1) - f(t)));
      const limit = name.includes('Volume') ? 2.5 : name === 'twist' ? 0.05 : 3.0;
      assert.ok(maxJump < limit, `${name}: скачок ${maxJump.toFixed(2)} за 1 мс`);
    }
  });

  test(`ЧСС ${hr}: степень раскрытия в [0, 1], S1 совпадает с закрытием ворот`, () => {
    for (const t of range(0, c.rr, 2)) {
      for (const [k, v] of Object.entries(c.valves(t))) assert.ok(v >= 0 && v <= 1, `${k} = ${v} при t=${t}`);
    }
    assert.equal(c.valves(T.tMc).mitral, 0);
    assert.equal(c.valves(T.tAc).aortic, 0);
  });
}

test('покой: ФВ, ударный объём, диастазис', () => {
  const c = makeCycle({ hr: 65 });
  assert.ok(c.lv.ef >= 0.55 && c.lv.ef <= 0.7, `ФВ ${c.lv.ef}`);
  assert.ok(Math.abs(c.lv.sv - 70) < 3 && Math.abs(c.rv.sv - 70) < 3, 'УО обоих желудочков ≈ 70');
  assert.ok(c.times.eEnd < c.times.aStart, 'в покое есть диастазис');
  const tDia = (c.times.eEnd + c.times.aStart) / 2;
  assert.ok(Math.abs(c.valves(tDia).mitral - 0.3) < 0.05, 'в диастазис створки МК полуприкрыты');
  assert.equal(c.phase(tDia), 'Диастазис');
});

test('тахикардия 150: диастола укорачивается сильнее систолы, E и A сливаются', () => {
  const rest = makeCycle({ hr: 65 }), ex = makeCycle({ hr: 150 });
  const sysFrac = (c) => (c.times.tMo - c.times.tMc) / c.rr;
  assert.ok(sysFrac(ex) > sysFrac(rest), 'доля систолы в RR растёт при тахикардии');
  const diaMs = (c) => c.rr - (c.times.tMo - c.times.tMc);
  assert.ok(diaMs(ex) / diaMs(rest) < (ex.rr / rest.rr) * 0.8, 'диастола укорачивается непропорционально');
  assert.ok(ex.times.eEnd > ex.times.aStart, 'E и A перекрываются');
  assert.ok(ex.times.pq < rest.times.pq, 'PQ короче');
});

test('фибрилляция предсердий: нет предсердного вклада', () => {
  const s = makeCycle({ hr: 65 }), af = makeCycle({ hr: 65, rhythm: 'af' });
  assert.ok(af.lv.edv < s.lv.edv && af.lv.sv < s.lv.sv, 'КДО и УО меньше');
  assert.ok(af.lv.edv / s.lv.edv > 0.8, 'потеря вклада ~20 %');
  let vmin = 1e9, vmax = 0;
  for (let t = 0; t < af.rr; t++) { vmin = Math.min(vmin, af.laVolume(t)); vmax = Math.max(vmax, af.laVolume(t)); }
  assert.ok(vmin > 30, 'ЛП не опорожняется активно');
  assert.ok(!af.events.some((e) => e.key === 'atrialSystole'));
});

test('объём предсердий: минимум у закрытия МК, максимум перед его открытием', () => {
  const c = makeCycle({ hr: 65 });
  const tMin = argext(c.laVolume, c, -1), tMax = argext(c.laVolume, c, 1);
  assert.ok(Math.abs(c.wrap(tMin - c.times.tMc)) < 5 || Math.abs(c.wrap(tMin - c.times.tMc)) > c.rr - 5, `минимум ЛП при t=${tMin}`);
  assert.ok(Math.abs(tMax - c.times.tMo) < 5, `максимум ЛП при t=${tMax}`);
});

test('события отсортированы и покрывают оба клапана каждой стороны', () => {
  const c = makeCycle({ hr: 65 });
  for (let i = 1; i < c.events.length; i++) assert.ok(c.events[i].t >= c.events[i - 1].t);
  for (const k of ['mitralClose', 'aorticOpen', 'aorticClose', 'mitralOpen', 'tricuspidClose', 'pulmonaryOpen', 'pulmonaryClose', 'tricuspidOpen', 'pOnset', 'atrialSystole'])
    assert.ok(c.events.some((e) => e.key === k), k);
  assert.equal(TIMING.emd, c.times.tMc);
});

test('накопленные объёмы: монотонны, равны УО за цикл, постоянны в изоволюмические фазы', () => {
  for (const hr of [65, 150]) {
    const c = makeCycle({ hr }), T = c.times;
    let prev = c.cumFlow(0);
    for (const t of range(1, c.rr + 0.5, 1)) {
      const f = c.cumFlow(t);
      for (const k of ['lvIn', 'lvOut', 'rvIn', 'rvOut']) assert.ok(f[k] >= prev[k] - 1e-9, `${k} убывает при t=${t}`);
      prev = f;
    }
    const end = c.cumFlow(c.rr);
    for (const k of ['lvIn', 'lvOut', 'rvIn', 'rvOut']) assert.ok(Math.abs(end[k] - c.lv.sv) < 0.5, `${k} за цикл = ${end[k]}, УО ${c.lv.sv}`);
    assert.ok(Math.abs(c.cumFlow(T.tMc).lvIn - c.cumFlow(Math.floor(T.tMo)).lvIn) < 0.05, 'через МК между tMc и tMo ничего не проходит');
    assert.ok(Math.abs(c.cumFlow(c.rr).lvOut - c.cumFlow(T.tAc).lvOut) < 0.05 && c.cumFlow(T.tAo).lvOut < 0.05, 'через АК вне изгнания ничего не проходит');
    assert.ok(c.cumFlow(0).lvIn < 1e-9 && c.cumFlow(0).lvOut < 1e-9, 'в начале цикла ноль');
  }
});

test('пиковые скорости потока в физиологических пределах', () => {
  const c = makeCycle({ hr: 65 });
  let qE = 0, qAo = 0;
  for (const t of range(0, c.rr, 1)) { const f = c.flows(t); qE = Math.max(qE, f.mitral); qAo = Math.max(qAo, f.aortic); }
  const vE = (qE / 4) * 1000, vAo = (qAo / 3.5) * 1000;    // мл/мс ÷ см² = см/мс → ×1000 = см/с
  assert.ok(vE >= 60 && vE <= 150, `пик E ${vE.toFixed(0)} см/с`);
  assert.ok(vAo >= 80 && vAo <= 150, `пик аорты ${vAo.toFixed(0)} см/с`);
});
