// Деформация: объём деформированного меша совпадает с кривой объёма,
// толщина стенки, укорочение, скручивание — в физиологических пределах.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCycle } from '../src/cycle.js';
import { deformStatics, deformState, deformPoint, REST_STATE } from '../src/deform.js';
import { gridArrays, volumeOfMesh } from '../src/geometry/grid.js';
import { endoPoint, endoNormal, offsetPoint, epiOffset, lvWall, rvWidth, profile, vParam, REGION, neg } from '../src/geometry/lvshape.js';
import { GEOMETRY as G, MECHANICS as M } from '../src/physiology.js';

const TAU = Math.PI * 2;
const U = deformStatics();
const cols = 160, rows = 96;

// Сетки как в ventricles.js, но без three.js.
const lvEndo = gridArrays({
  cols, rows,
  vertex: (i, j) => { const th = (i / cols) * TAU, u = j / rows; return { p: endoPoint(th, u), n: neg(endoNormal(th, u)), depth: 0, region: REGION.LV }; },
  poleStart: () => ({ p: [0, 0, 0], n: [0, 1, 0], depth: 0, region: REGION.LV }),
});
const rvRows = Math.round(rows * (1 - G.rvApexU)), span = G.rvTheta1 - G.rvTheta0, thMid = G.rvTheta0 + span / 2;
const rvEndo = gridArrays({
  cols, rows: rvRows,
  vertex: (i, j) => {
    const s = i / cols, u = G.rvApexU + (j / rvRows) * (1 - G.rvApexU);
    if (s < 0.5) { const th = G.rvTheta0 + (s / 0.5) * span; return { p: offsetPoint(th, u, lvWall(u), rvWidth(th, u)), n: neg(endoNormal(th, u)), depth: 0, region: REGION.RV }; }
    const th = G.rvTheta1 - ((s - 0.5) / 0.5) * span;
    return { p: offsetPoint(th, u, lvWall(u)), n: endoNormal(th, u), depth: 1, region: REGION.SEPTUM };
  },
  poleStart: () => ({ p: offsetPoint(thMid, G.rvApexU, lvWall(G.rvApexU)), n: [0, 1, 0], depth: 0.5, region: REGION.RV }),
});

function deformedVolume(grid, loop, S) {
  const P = new Float32Array(grid.pos.length);
  for (let k = 0; k < grid.pos.length / 3; k++) {
    const q = deformPoint([grid.pos[k * 3], grid.pos[k * 3 + 1], grid.pos[k * 3 + 2]], grid.depth[k], grid.region[k], 0, U, S);
    P[k * 3] = q[0]; P[k * 3 + 1] = q[1]; P[k * 3 + 2] = q[2];
  }
  return volumeOfMesh(P, grid.idx, loop);
}

test('в покое поле тождественно', () => {
  for (const p of [[2.3, 5, 0], [0, 0, 0], [-4, 8.4, 1], [1, 10, -2]]) {
    const q = deformPoint(p, 1, 0, 0, U, REST_STATE);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(q[i] - p[i]) < 1e-9);
  }
});

test('объём меша ЛЖ в покое равен объёму эндокарда из геометрии', () => {
  const v = deformedVolume(lvEndo, lvEndo.ring(rows), REST_STATE);
  assert.ok(Math.abs(v - 120) < 2, `V=${v}`);
});

for (const hr of [65, 150]) {
  const c = makeCycle({ hr });
  test(`ЧСС ${hr}: объём деформированного эндокарда ЛЖ совпадает с V(t) (< 2 %)`, () => {
    let worst = 0;
    for (let t = 0; t < c.rr; t += 20) {
      const S = deformState(c, t, U);
      const vm = deformedVolume(lvEndo, lvEndo.ring(rows), S), vc = c.lvVolume(t);
      worst = Math.max(worst, Math.abs(vm / vc - 1));
      assert.ok(Math.abs(vm / vc - 1) < 0.02, `t=${t}: меш ${vm.toFixed(1)} мл, кривая ${vc.toFixed(1)} мл`);
    }
  });
  test(`ЧСС ${hr}: объём деформированного ПЖ совпадает с V_rv(t) (< 10 %)`, () => {
    for (let t = 0; t < c.rr; t += 20) {
      const S = deformState(c, t, U);
      const vm = deformedVolume(rvEndo, rvEndo.ring(rvRows), S), vc = c.rvVolume(t) * (127 / 130);
      assert.ok(Math.abs(vm / vc - 1) < 0.10, `t=${t}: меш ${vm.toFixed(1)} мл, кривая ${vc.toFixed(1)} мл`);
    }
  });
}

const c65 = makeCycle({ hr: 65 });
const S_ES = deformState(c65, c65.times.tAc, U);
const S_ED = deformState(c65, c65.times.tMc, U);

test('стенка ЛЖ в конце систолы толще в 1,4–1,6 раза', () => {
  for (const u of [0.5, 0.7]) {
    const th = 0; // левая свободная стенка, вне сектора ПЖ
    const pe = offsetPoint(th, u, 0), pp = offsetPoint(th, u, ...epiOffset(th, u));
    const dist = (S) => { const a = deformPoint(pe, 0, 0, 0, U, S), b = deformPoint(pp, 1, 0, 0, U, S); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); };
    const ratio = dist(S_ES) / dist(S_ED);
    assert.ok(ratio > 1.4 && ratio < 1.6, `u=${u}: ${ratio.toFixed(2)}`);
  }
});

test('основание опускается на 12–15 мм, верхушка неподвижна', () => {
  const base = deformPoint([profile(1).rho, G.lvLength, 0], 0, 0, 0, U, S_ES);
  const drop = G.lvLength - base[1];
  assert.ok(drop >= 1.2 && drop <= 1.5, `опускание ${drop.toFixed(2)} см`);
  const apex = deformPoint([0, 0, 0], 0, 0, 0, U, S_ES);
  assert.ok(Math.hypot(...apex) < 0.1);
});

test('скручивание верхушка–основание 10–15° в конце изгнания, 0 в конце диастолы', () => {
  const ang = (S, u) => { const p = deformPoint(endoPoint(0, u), 0, 0, 0, U, S); return Math.atan2(p[2], p[0]); };
  const tw = (S) => ((ang(S, 0.08) - ang(S, 1)) * 180 / Math.PI);
  assert.ok(Math.abs(tw(S_ED)) < 0.5, `КД: ${tw(S_ED)}`);
  assert.ok(tw(S_ES) >= 10 && tw(S_ES) <= 15, `КС: ${tw(S_ES)}`);
  assert.ok(Math.abs(tw(S_ES) - M.twistDeg * (1 - vParam(0.08) * 0 - 0)) < 3);
});

test('эпикард всегда снаружи эндокарда, свободная стенка ПЖ снаружи перегородки', () => {
  for (const t of [c65.times.tMc, c65.times.tAo + 100, c65.times.tAc, c65.times.tMo, 700]) {
    const S = deformState(c65, t, U);
    for (let i = 0; i < 36; i++) for (let j = 1; j <= 10; j++) {
      const th = (i / 36) * TAU, u = j / 10;
      const e = deformPoint(endoPoint(th, u), 0, 0, 0, U, S), p = deformPoint(offsetPoint(th, u, ...epiOffset(th, u)), 1, 0, 0, U, S);
      const gap = Math.hypot(e[0] - p[0], e[1] - p[1], e[2] - p[2]);
      assert.ok(gap > 0.3, `t=${t} θ=${(th * 180 / Math.PI).toFixed(0)} u=${u}: стенка ${gap.toFixed(2)} см`);
      const w = rvWidth(th, u);
      if (w > 0.3) {
        const sep = deformPoint(offsetPoint(th, u, lvWall(u)), 1, 0, 0, U, S), fw = deformPoint(offsetPoint(th, u, lvWall(u), w), 0, 0, 0, U, S);
        assert.ok(Math.hypot(fw[0], fw[2]) > Math.hypot(sep[0], sep[2]), `t=${t} θ=${(th * 180 / Math.PI).toFixed(0)} u=${u}: ПЖ схлопнулся`);
      }
    }
  }
});

test('предсердие: воронка остаётся на кольце, крыша сжимается', () => {
  const S = deformState(c65, c65.times.tMc, U); // конец систолы предсердий, sLa минимален
  assert.ok(S.sLa < 0.9);
  const ring = [1.9, G.lvLength + 0.05, -0.85], roof = [0.6, G.lvLength + 3.6, -2.1];
  const r0 = deformPoint(ring, 0, REGION.LA, 0, U, S), r1 = deformPoint(ring, 0, REGION.LA, 0, U, REST_STATE);
  assert.ok(Math.hypot(r0[0] - r1[0], r0[1] - r1[1], r0[2] - r1[2]) < 0.15, 'воронка сдвинулась');
  const q0 = deformPoint(roof, 0, REGION.LA, 1, U, S);
  assert.ok(q0[1] < roof[1] - 0.2, 'крыша не опустилась');
});

// --- Региональная механика (проход 7) ---------------------------------------------
import { zoneW } from '../src/deform.js';
const d2r = Math.PI / 180;
const wallAt = (th, u, U2, S) => { const pe = offsetPoint(th, u, 0), pp = offsetPoint(th, u, ...epiOffset(th, u)); const a = deformPoint(pe, 0, 0, 0, U2, S), b = deformPoint(pp, 1, 0, 0, U2, S); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); };
const deformedVolumeU = (grid, loop, S, U2) => {
  const P = new Float32Array(grid.pos.length);
  for (let k = 0; k < grid.pos.length / 3; k++) { const q = deformPoint([grid.pos[k * 3], grid.pos[k * 3 + 1], grid.pos[k * 3 + 2]], grid.depth[k], grid.region[k], 0, U2, S); P[k * 3] = q[0]; P[k * 3 + 1] = q[1]; P[k * 3 + 2] = q[2]; }
  return volumeOfMesh(P, grid.idx, loop);
};

test('без зоны интегралы объёма совпадают со старой формулой (< 0,1 %)', () => {
  // Старая: I0 = ∫a, I1 = ∫2ab, I2 = ∫4ab² → Jaa = I0 − I1 + ¼I2.
  let I0 = 0, I1 = 0, I2 = 0; const n = 2000;
  for (let i = 0; i < n; i++) { const p0 = profile(i / n), p1 = profile((i + 1) / n); const rho = (p0.rho + p1.rho) / 2, dy = p1.y - p0.y, v = (p0.y + p1.y) / 2 / G.lvLength; const b = M.baseRadialFraction * ((x) => { const t = Math.min(1, Math.max(0, (x - M.baseBlendV) / (1 - M.baseBlendV))); return t * t * (3 - 2 * t); })(v); const a = Math.PI * rho * rho * dy; I0 += a; I1 += a * 2 * b; I2 += a * 4 * b * b; }
  assert.ok(Math.abs(U.Jaa / (I0 - I1 + 0.25 * I2) - 1) < 1e-3);
  assert.ok(Math.abs(2 * U.Ja1 / (I1 - 0.5 * I2) - 1) < 1e-3);
  assert.ok(Math.abs(U.J11 / (0.25 * I2) - 1) < 1e-3);
});

test('вес зоны: 1 в центре и на верхушке, 0 вдали, гладкий край', () => {
  const Z = { mode: 1, thetaC: 75 * d2r, halfW: 45 * d2r, soft: 12 * d2r, vTop: 0.7, vApex: 0.25 };
  assert.equal(zoneW(75 * d2r, 0.5, Z), 1);
  assert.equal(zoneW(200 * d2r, 0.1, Z), 1);
  assert.equal(zoneW(255 * d2r, 0.5, Z), 0);
  assert.equal(zoneW(75 * d2r, 0.95, Z), 0);
  const w1 = zoneW(115 * d2r, 0.5, Z), w2 = zoneW(125 * d2r, 0.5, Z);
  assert.ok(w1 > 0.4 && w1 < 1 && w2 > 0 && w2 < 0.4 && w1 > w2);
});

test('окклюзия ПМЖВ: объём меша совпадает с V(t) (< 3 %), в зоне стенка не утолщается, вне зоны — да', () => {
  const Z = { thetaC: 75 * d2r, halfW: 45 * d2r, soft: 12 * d2r, vTop: 0.7, vApex: 0.25 };
  const Ul = deformStatics({ zone: Z, hypo: 0.85 });
  const c = makeCycle({ hr: 80, lvESV: 70 });
  for (let t = 0; t < c.rr; t += 25) {
    const S = deformState(c, t, Ul);
    const vm = deformedVolumeU(lvEndo, lvEndo.ring(rows), S, Ul), vc = c.lvVolume(t);
    assert.ok(Math.abs(vm / vc - 1) < 0.03, `t=${t}: меш ${vm.toFixed(1)}, кривая ${vc.toFixed(1)}`);
  }
  const Sed = deformState(c, c.times.tMc, Ul), Ses = deformState(c, c.times.tAc, Ul);
  const inZone = wallAt(45 * d2r, 0.5, Ul, Ses) / wallAt(45 * d2r, 0.5, Ul, Sed);
  const outZone = wallAt(340 * d2r, 0.5, Ul, Ses) / wallAt(340 * d2r, 0.5, Ul, Sed);
  assert.ok(inZone < 1.15, `в зоне ${inZone.toFixed(2)}`);
  assert.ok(outZone > 1.4, `вне зоны ${outZone.toFixed(2)}`);
});

test('дилатация: КДО 200 мл достигается (s > 1,2), стенка в покое тоньше на 25 %', () => {
  const Uh = deformStatics({ wallThin: 0.25 });
  const c = makeCycle({ hr: 85, lvEDV: 200, lvESV: 140 });
  const S = deformState(c, c.times.tMc, Uh);
  assert.ok(S.s > 1.2 && S.s < 1.5, `s ${S.s}`);
  const vm = deformedVolumeU(lvEndo, lvEndo.ring(rows), S, Uh);
  assert.ok(Math.abs(vm / 200 - 1) < 0.02, `V ${vm}`);
  const rest = wallAt(0, 0.6, U, REST_STATE), thin = wallAt(0, 0.6, Uh, { ...REST_STATE });
  assert.ok(Math.abs(thin / rest - 0.75) < 0.05, `стенка ${thin.toFixed(2)} / ${rest.toFixed(2)}`);
});

test('несинхронность: боковая стенка при открытии АК отстаёт от перегородки, объём в допуске 8 %', () => {
  const thLat = (G.rvTheta0 + G.rvTheta1) / 2 + Math.PI, thSep = (G.rvTheta0 + G.rvTheta1) / 2;
  const Ud = deformStatics({ zone: { thetaC: thLat, halfW: 90 * d2r, soft: 60 * d2r, vTop: 1.2, vApex: -1 }, delay: 70 });
  const c = makeCycle({ hr: 70, lvESV: 60 });
  const Sed = deformState(c, c.times.tMc, Ud), Sao = deformState(c, c.times.tAo + 20, Ud);
  assert.ok(Sao.c2 < Sao.c, `c₂ ${Sao.c2} ≥ c ${Sao.c}`);
  const sepWall = (S) => { const a = deformPoint(offsetPoint(thSep, 0.5, 0), 0, 1, 0, Ud, S), b = deformPoint(offsetPoint(thSep, 0.5, lvWall(0.5)), 1, 1, 0, Ud, S); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); };
  const sepRatio = sepWall(Sao) / sepWall(Sed), latRatio = wallAt(thLat, 0.5, Ud, Sao) / wallAt(thLat, 0.5, Ud, Sed);
  assert.ok(sepRatio > latRatio + 0.05, `перегородка ${sepRatio.toFixed(2)}, боковая ${latRatio.toFixed(2)}`);
  for (let t = 0; t < c.rr; t += 25) {
    const S = deformState(c, t, Ud);
    const vm = deformedVolumeU(lvEndo, lvEndo.ring(rows), S, Ud), vc = c.lvVolume(t);
    assert.ok(Math.abs(vm / vc - 1) < 0.08, `t=${t}: меш ${vm.toFixed(1)}, кривая ${vc.toFixed(1)}`);
  }
});
