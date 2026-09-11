// loft.js — построение геометрий three.js из параметрических функций.
// Сами массивы сеток и объём считает grid.js (без three.js, чтобы тесты под
// node могли строить те же поверхности). Дескриптор вершины — см. grid.js.
import * as THREE from 'three';
import { gridArrays, volumeOfMesh } from './grid.js';

// Геометрия three.js из массивов сетки (grid.js).
export function geometryFromArrays(a) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.pos, 3));
  g.setAttribute('aParam', new THREE.BufferAttribute(a.param, 2));
  g.setAttribute('aDepth', new THREE.BufferAttribute(a.depth, 1));
  g.setAttribute('aRegion', new THREE.BufferAttribute(a.region, 1));
  g.setIndex(a.idx);
  g.computeVertexNormals();
  return g;
}

export function gridSurface(spec) {
  const a = gridArrays(spec);
  return { geometry: geometryFromArrays(a), arrays: a, ring: a.ring, poleStartIdx: a.poleStartIdx, poleEndIdx: a.poleEndIdx };
}

export { fdNormal } from './grid.js';

// Труба вдоль кривой с переменным радиусом. Концы по умолчанию открыты:
// при двусторонней отрисовке срез стенки виден как кольцо цвета среза.
export function tubeSurface({ curve, radius, segments = 48, radial = 24, inward = false, closeStart = false, closeEnd = false, param, depth = 0, region = 0 }) {
  const frames = curve.computeFrenetFrames(segments, false);
  const pts = [];
  for (let j = 0; j <= segments; j++) pts.push(curve.getPointAt(j / segments));
  const sgn = inward ? -1 : 1;
  const pole = (j) => {
    const c = pts[j], T = frames.tangents[j], dir = j === 0 ? -1 : 1;
    return { p: [c.x, c.y, c.z], n: [T.x * sgn * dir, T.y * sgn * dir, T.z * sgn * dir], param: param ? param(0, j / segments) : [0, j / segments], depth, region };
  };
  return gridSurface({
    cols: radial, rows: segments,
    vertex: (i, j) => {
      const t = j / segments, ang = (i / radial) * Math.PI * 2;
      const c = pts[j], N = frames.normals[j], B = frames.binormals[j];
      const r = radius(t);
      const dir = [Math.cos(ang) * N.x + Math.sin(ang) * B.x, Math.cos(ang) * N.y + Math.sin(ang) * B.y, Math.cos(ang) * N.z + Math.sin(ang) * B.z];
      return { p: [c.x + dir[0] * r, c.y + dir[1] * r, c.z + dir[2] * r], n: [dir[0] * sgn, dir[1] * sgn, dir[2] * sgn], param: param ? param(ang, t) : [ang, t], depth, region };
    },
    poleStart: closeStart ? () => pole(0) : null,
    poleEnd: closeEnd ? () => pole(segments) : null,
  });
}

// Сосуд как оболочка: наружная и внутренняя трубки, между ними стенка.
export function vesselShell({ curve, radius, wall = 0.15, segments = 48, radial = 24, closeStart = false, closeEnd = false, region = 0 }) {
  const outer = tubeSurface({ curve, radius, segments, radial, closeStart, closeEnd, depth: 1, region });
  const inner = tubeSurface({ curve, radius: (t) => Math.max(0.03, radius(t) - wall), segments, radial, inward: true, closeStart, closeEnd, depth: 0, region });
  return { outer: outer.geometry, inner: inner.geometry };
}

// Тонкий стержень между двумя точками (хорды).
export function strand(a, b, r = 0.035, radial = 6) {
  const curve = new THREE.LineCurve3(new THREE.Vector3(...a), new THREE.Vector3(...b));
  return tubeSurface({ curve, radius: () => r, segments: 3, radial, closeStart: true, closeEnd: true }).geometry;
}

// Пучок стержней (все хорды клапана) одной геометрией: каждый стержень —
// две шапки-полюса и два кольца по radial вершин. update(pairs) переписывает
// позиции на месте; pairs — массив [[x,y,z], [x,y,z]].
export function strandBundle(pairs, r = 0.035, radial = 6) {
  const perStrand = 2 * radial + 2;
  const n = pairs.length * perStrand;
  const pos = new Float32Array(n * 3);
  const idx = [];
  for (let k = 0; k < pairs.length; k++) {
    const b = k * perStrand, pa = b + 2 * radial, pb = pa + 1;
    for (let i = 0; i < radial; i++) {
      const i1 = (i + 1) % radial;
      const a0 = b + i, a1 = b + i1, c0 = b + radial + i, c1 = b + radial + i1;
      idx.push(a0, c1, a1, a0, c0, c1);
      idx.push(pa, a1, a0);
      idx.push(pb, c0, c1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  const update = (pairs) => {
    for (let k = 0; k < pairs.length; k++) {
      const [a, c] = pairs[k];
      const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2];
      const l = Math.hypot(dx, dy, dz) || 1, tx = dx / l, ty = dy / l, tz = dz / l;
      // Ортонормальный базис поперёк стержня.
      const rx = Math.abs(ty) < 0.9 ? 0 : 1, ry = Math.abs(ty) < 0.9 ? 1 : 0;
      let nx = ry * tz, ny = -rx * tz, nz = rx * ty - ry * tx;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      const b = k * perStrand;
      for (let i = 0; i < radial; i++) {
        const ang = (i / radial) * Math.PI * 2, ca = Math.cos(ang) * r, sa = Math.sin(ang) * r;
        const ox = nx * ca + bx * sa, oy = ny * ca + by * sa, oz = nz * ca + bz * sa;
        const k0 = (b + i) * 3, k1 = (b + radial + i) * 3;
        pos[k0] = a[0] + ox; pos[k0 + 1] = a[1] + oy; pos[k0 + 2] = a[2] + oz;
        pos[k1] = c[0] + ox; pos[k1 + 1] = c[1] + oy; pos[k1 + 2] = c[2] + oz;
      }
      const ka = (b + 2 * radial) * 3, kc = ka + 3;
      pos[ka] = a[0]; pos[ka + 1] = a[1]; pos[ka + 2] = a[2];
      pos[kc] = c[0]; pos[kc + 1] = c[1]; pos[kc + 2] = c[2];
    }
    g.getAttribute('position').needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingSphere();
  };
  update(pairs);
  return { geometry: g, update };
}

// Кусочно-линейный профиль радиуса по параметру t: [[t, r], ...].
export function profileRadius(stops) {
  return (t) => {
    if (t <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [t0, r0] = stops[i - 1], [t1, r1] = stops[i];
        const k = (t - t0) / (t1 - t0);
        return r0 + (r1 - r0) * (k * k * (3 - 2 * k));
      }
    }
    return stops[stops.length - 1][1];
  };
}

// Кривая Catmull-Rom по массиву точек [x,y,z].
export function spline(points, tension = 0.5) {
  return new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', tension);
}

// Объём, ограниченный поверхностью (см. volumeOfMesh в grid.js).
export function enclosedVolume(geometry, loop = null) {
  return volumeOfMesh(geometry.getAttribute('position').array, geometry.getIndex().array, loop);
}

// Незамкнутая сетка (створки, карманы): (cols+1) × (rows+1) вершин.
// Возвращает геометрию и функцию обновления позиций той же функцией вершин.
export function openGrid({ cols, rows, vertex }) {
  const n = (cols + 1) * (rows + 1);
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const idx = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    idx.push(a, b, d, a, d, c);
  }
  g.setIndex(idx);
  const update = (fn) => {
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      const k = j * (cols + 1) + i, p = fn(i / cols, j / rows);
      pos[k * 3] = p[0]; pos[k * 3 + 1] = p[1]; pos[k * 3 + 2] = p[2];
    }
    g.getAttribute('position').needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingSphere();
  };
  update(vertex);
  return { geometry: g, update };
}
