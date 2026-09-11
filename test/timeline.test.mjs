import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timeline } from '../src/timeline.js';

test('синусовый ритм: постоянный RR, t = T mod RR', () => {
  const tl = new Timeline({ hr: 65 });
  const rr = Math.round(60000 / 65);
  for (const T of [0, 100, rr + 1, rr * 3.5, 60010]) {
    const { t, beat } = tl.at(T);
    assert.ok(Math.abs(t - (T % rr)) < 1e-6);
    assert.equal(beat.index, Math.floor(T / rr));
  }
});

test('ФП: воспроизводимость по seed, средний RR, разброс', () => {
  const a = new Timeline({ hr: 80, rhythm: 'af', seed: 7 }), b = new Timeline({ hr: 80, rhythm: 'af', seed: 7 }), c = new Timeline({ hr: 80, rhythm: 'af', seed: 8 });
  assert.deepEqual(a.rrList(200), b.rrList(200));
  assert.notDeepEqual(a.rrList(200), c.rrList(200));
  const list = a.rrList(400), mean = list.reduce((s, x) => s + x, 0) / list.length;
  assert.ok(Math.abs(mean / (60000 / 80) - 1) < 0.1, `средний RR ${mean}`);
  const sd = Math.sqrt(list.reduce((s, x) => s + (x - mean) ** 2, 0) / list.length);
  assert.ok(sd / mean > 0.1 && sd / mean < 0.3, `CV ${sd / mean}`);
  for (const rr of list) assert.ok(rr >= 375 && rr <= 1350);
});

test('ФП: скраб назад и вперёд даёт один и тот же удар', () => {
  const tl = new Timeline({ hr: 70, rhythm: 'af', seed: 3 });
  const fwd = [5000, 20000, 1000, 15000].map((T) => tl.at(T));
  const tl2 = new Timeline({ hr: 70, rhythm: 'af', seed: 3 });
  const back = [15000, 1000, 20000, 5000].map((T) => tl2.at(T)).reverse();
  for (let i = 0; i < 4; i++) {
    assert.equal(fwd[i].beat.index, back[i].beat.index);
    assert.ok(Math.abs(fwd[i].t - back[i].t) < 1e-9);
    assert.equal(fwd[i].cycle, tl.cycleFor(fwd[i].beat.rr));
  }
});

test('ФП: цикл без предсердной систолы', () => {
  const tl = new Timeline({ hr: 70, rhythm: 'af', seed: 3 });
  const { cycle } = tl.at(0);
  assert.equal(cycle.rhythm, 'af');
  assert.ok(!cycle.events.some((e) => e.key === 'atrialSystole'));
});

test('накопленный объём непрерывен на стыках ударов при ФП', () => {
  const tl = new Timeline({ hr: 70, rhythm: 'af', seed: 5 });
  tl.rrList(30);
  for (let i = 1; i < 30; i++) {
    const a = tl.beats[i - 1], b = tl.beats[i];
    assert.ok(Math.abs(b.svBefore - (a.svBefore + tl.cycleFor(a.rr).lv.sv)) < 1e-9);
    // Привод «митральный» у конца удара a и начала удара b совпадает.
    const ca = tl.cycleFor(a.rr), cb = tl.cycleFor(b.rr);
    const endA = a.svBefore + ca.cumFlow(a.rr).lvIn, startB = b.svBefore + cb.cumFlow(0).lvIn;
    assert.ok(Math.abs(endA - startB) < 0.5, `разрыв ${endA - startB}`);
  }
});
