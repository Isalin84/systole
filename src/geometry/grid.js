// grid.js — построение сеток и объём без three.js (используется loft.js и
// тестами под node). Сетка замкнута по первому параметру (i), необязательно
// имеет полюса в начале и/или конце второго (j).
//
// Дескриптор вершины: { p:[x,y,z], n:[x,y,z] (желаемая ориентация нормали —
// только для выбора обхода треугольников), param:[θ, v], depth, region }.

export function gridArrays({ cols, rows, vertex, poleStart = null, poleEnd = null }) {
  const ringStart = poleStart ? 1 : 0;
  const ringEnd = poleEnd ? rows - 1 : rows;
  const nRings = ringEnd - ringStart + 1;
  const ringIdx = (i, j) => (j - ringStart) * cols + (((i % cols) + cols) % cols);

  let n = nRings * cols;
  const poleStartIdx = poleStart ? n++ : -1;
  const poleEndIdx = poleEnd ? n++ : -1;

  const pos = new Float32Array(n * 3);
  const want = new Float32Array(n * 3);
  const param = new Float32Array(n * 2);
  const depth = new Float32Array(n);
  const region = new Float32Array(n);

  const put = (k, d) => {
    pos[k * 3] = d.p[0]; pos[k * 3 + 1] = d.p[1]; pos[k * 3 + 2] = d.p[2];
    if (d.n) { want[k * 3] = d.n[0]; want[k * 3 + 1] = d.n[1]; want[k * 3 + 2] = d.n[2]; }
    param[k * 2] = d.param ? d.param[0] : 0; param[k * 2 + 1] = d.param ? d.param[1] : 0;
    depth[k] = d.depth || 0; region[k] = d.region || 0;
  };

  for (let j = ringStart; j <= ringEnd; j++)
    for (let i = 0; i < cols; i++) put(ringIdx(i, j), vertex(i, j));
  if (poleStart) put(poleStartIdx, poleStart());
  if (poleEnd) put(poleEndIdx, poleEnd());

  const idx = [];
  for (let j = ringStart; j < ringEnd; j++) {
    for (let i = 0; i < cols; i++) {
      const a = ringIdx(i, j), b = ringIdx(i + 1, j), c = ringIdx(i, j + 1), d = ringIdx(i + 1, j + 1);
      idx.push(a, b, d, a, d, c);
    }
  }
  if (poleStart) for (let i = 0; i < cols; i++) idx.push(poleStartIdx, ringIdx(i + 1, ringStart), ringIdx(i, ringStart));
  if (poleEnd) for (let i = 0; i < cols; i++) idx.push(ringIdx(i, ringEnd), ringIdx(i + 1, ringEnd), poleEndIdx);

  // Выбор обхода: сравниваем нормали треугольников с желаемыми.
  let dot = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    dot += nx * (want[a * 3] + want[b * 3] + want[c * 3]) + ny * (want[a * 3 + 1] + want[b * 3 + 1] + want[c * 3 + 1]) + nz * (want[a * 3 + 2] + want[b * 3 + 2] + want[c * 3 + 2]);
  }
  if (dot < 0) for (let t = 0; t < idx.length; t += 3) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }

  return {
    pos, param, depth, region, idx, n,
    cols, rows, ringStart, ringEnd, ringIdx,
    ring: (j) => { const out = []; for (let i = 0; i < cols; i++) out.push(ringIdx(i, j)); return out; },
    poleStartIdx, poleEndIdx,
  };
}

// Нормаль поверхности f(a,b)→[x,y,z] конечными разностями.
export function fdNormal(f, a, b, da, db) {
  const p1 = f(a + da, b), p0 = f(a - da, b), q1 = f(a, b + db), q0 = f(a, b - db);
  const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const v = [q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

// Объём, ограниченный поверхностью (массив позиций + индексы). Если
// поверхность открыта по кольцу вершин `loop`, оно закрывается веером.
// Возвращает модуль объёма (мл при единицах в см).
export function volumeOfMesh(P, I, loop = null) {
  const tet = (a, b, c) => {
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2];
    const cx = P[c * 3], cy = P[c * 3 + 1], cz = P[c * 3 + 2];
    return (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  };
  let v = 0;
  for (let t = 0; t < I.length; t += 3) v += tet(I[t], I[t + 1], I[t + 2]);
  if (loop) {
    // Ориентация крышки продолжает ориентацию поверхности: граничное ребро
    // a→b встречается ровно в одном треугольнике; в крышке идёт обратно.
    const a0 = loop[0], b0 = loop[1];
    let forward = 0;
    for (let t = 0; t < I.length && !forward; t += 3) {
      const tri = [I[t], I[t + 1], I[t + 2]];
      for (let e = 0; e < 3; e++) {
        if (tri[e] === a0 && tri[(e + 1) % 3] === b0) forward = 1;
        if (tri[e] === b0 && tri[(e + 1) % 3] === a0) forward = -1;
      }
    }
    let cx = 0, cy = 0, cz = 0;
    for (const k of loop) { cx += P[k * 3]; cy += P[k * 3 + 1]; cz += P[k * 3 + 2]; }
    cx /= loop.length; cy /= loop.length; cz /= loop.length;
    for (let k = 0; k < loop.length; k++) {
      let a = loop[k], b = loop[(k + 1) % loop.length];
      if (forward >= 0) { const tmp = a; a = b; b = tmp; }
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
      const bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2];
      v += (cx * (ay * bz - az * by) - cy * (ax * bz - az * bx) + cz * (ax * by - ay * bx)) / 6;
    }
  }
  return Math.abs(v);
}
