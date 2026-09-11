// atriaShape.js — предсердия без three.js: точка поверхности (верхняя половина —
// эллипсоид, нижняя — воронка к своему АВ-кольцу) и сетки оболочки
// (наружная + внутренняя). Используются atria.js и conduction.js.
import { gridArrays, fdNormal } from './grid.js';

const TAU = Math.PI * 2;
const smooth = (x) => x * x * (3 - 2 * x);

// Точка предсердия: θ вокруг вертикали (в осях кольца e1/e2), φ ∈ [-π/2, π/2].
export function atriumPoint(A, theta, phi) {
  const { center, axes, annulus } = A;
  const [ax, ay, az] = axes;
  const c = Math.cos(phi), s = Math.sin(phi);
  const ct = Math.cos(theta), st = Math.sin(theta);
  const e1 = annulus.e1, e2 = annulus.e2;
  const ex = ax * c * ct, ez = az * c * st;
  const ell = [center[0] + ex * e1[0] + ez * e2[0], center[1] + ay * s, center[2] + ex * e1[2] + ez * e2[2]];
  if (phi >= 0) return ell;
  const k = smooth(-phi / (Math.PI / 2));
  const ac = annulus.center, a = annulus.a, b = annulus.b;
  const ring = [ac[0] + a * ct * e1[0] + b * st * e2[0], ac[1] + 0.05, ac[2] + a * ct * e1[2] + b * st * e2[2]];
  return [ell[0] + (ring[0] - ell[0]) * k, ell[1] + (ring[1] - ell[1]) * k, ell[2] + (ring[2] - ell[2]) * k];
}

// Оболочка: наружная (offset 0) и внутренняя (offset −wall) сетки с одинаковой
// топологией; нормаль ориентируется наружу от центра предсердия.
export function atriumGrids({ A, wall, region, cols = 96, rows = 64 }) {
  const surf = (offset) => gridArrays({
    cols, rows,
    vertex: (i, j) => {
      const th = (i / cols) * TAU, ph = -Math.PI / 2 + (j / rows) * Math.PI;
      const f = (t, p) => atriumPoint(A, t, p);
      const p = f(th, ph);
      let n = fdNormal(f, th, ph, 1e-3, 1e-3);
      const c = A.center;
      if (n[0] * (p[0] - c[0]) + n[1] * (p[1] - c[1]) + n[2] * (p[2] - c[2]) < 0) n = [-n[0], -n[1], -n[2]];
      return { p: [p[0] + n[0] * offset, p[1] + n[1] * offset, p[2] + n[2] * offset], n: offset < 0 ? [-n[0], -n[1], -n[2]] : n, param: [th, (ph + Math.PI / 2) / Math.PI], depth: offset < 0 ? 0 : 1, region };
    },
    poleEnd: () => { const p = atriumPoint(A, 0, Math.PI / 2); return { p: [p[0], p[1] + offset, p[2]], n: [0, offset < 0 ? -1 : 1, 0], param: [0, 1], depth: offset < 0 ? 0 : 1, region }; },
  });
  return { outer: surf(0), inner: surf(-wall) };
}
