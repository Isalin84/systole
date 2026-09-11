// valves.js — четыре клапана с честным числом створок, кольца, папиллярные
// мышцы с хордами и пластины основания. У каждого клапана параметр
// open ∈ [0, 1]; cycle.js выводит его из знака градиента давления и потока.
// Створки и хорды считаются в недеформированном пространстве; поле
// деформации (deform.js) применяется к ним в шейдере, как и к миокарду.
import * as THREE from 'three';
import { GEOMETRY as G } from '../physiology.js';
import { openGrid, tubeSurface, strandBundle } from './loft.js';
import { profile, endoPoint, offsetPoint, lvWall, rvWidth, crescentLoop } from './ventricles.js';
import { MITRAL, TRICUSPID, AORTIC, PULMONARY, RVOT_BASE, RVOT_BASE_R, L } from './layout.js';

const d2r = Math.PI / 180;
const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const add3 = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const norm3 = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// --- АВ-клапаны -------------------------------------------------------------

// Точка створки: s ∈ [-1, 1] поперёк створки, t ∈ [0, 1] от кольца к краю.
export function avLeafletPoint(A, leaf, s, t, open) {
  const phi = (leaf.phi0 + (leaf.phi1 - leaf.phi0) * (s + 1) / 2) * d2r;
  const c = A.center, ct = Math.cos(phi), st = Math.sin(phi);
  const h = [c[0] + A.a * ct * A.e1[0] + A.b * st * A.e2[0], c[1], c[2] + A.a * ct * A.e1[2] + A.b * st * A.e2[2]];
  let ix = c[0] - h[0], iz = c[2] - h[2];
  const il = Math.hypot(ix, iz) || 1; ix /= il; iz /= il;
  const alpha = (leaf.closed + (leaf.open - leaf.closed) * open) * d2r;
  const len = leaf.length * (1 - 0.3 * s * s);
  const belly = (1 - open) * 0.22 * Math.sin(Math.PI * t) * (1 - s * s);
  const d = t * len;
  return [h[0] + ix * d * Math.cos(alpha), h[1] - d * Math.sin(alpha) + belly, h[2] + iz * d * Math.cos(alpha)];
}

function annulusRing(A, material) {
  const g = new THREE.TorusGeometry(1, G.annulusTube, 10, 96);
  g.scale(A.a, A.b, 1);
  g.rotateX(-Math.PI / 2);
  const psi = Math.atan2(A.e1[2], A.e1[0]);
  g.rotateY(-psi);
  g.translate(A.center[0], A.center[1], A.center[2]);
  const m = new THREE.Mesh(g, material);
  m.name = 'annulus';
  return m;
}

// Папиллярная мышца: конус от стенки к вершине.
function papillary(base, tip, r0, material) {
  const curve = new THREE.LineCurve3(new THREE.Vector3(...base), new THREE.Vector3(...tip));
  const rad = (t) => (r0 * (1 - 0.75 * t)) * (t > 0.85 ? Math.sqrt(1 - ((t - 0.85) / 0.15) ** 2) : 1);
  const surf = tubeSurface({ curve, radius: rad, segments: 24, radial: 18, closeStart: true, closeEnd: true });
  const m = new THREE.Mesh(surf.geometry, material);
  m.name = 'papillary';
  return m;
}

class AVValve {
  constructor(A, name, materials, papillaryPoints) {
    this.A = A; this.name = name;
    this.group = new THREE.Group(); this.group.name = name;
    this.open = 0;
    this.leaflets = A.leaflets.map((leaf) => {
      const grid = openGrid({ cols: 24, rows: 12, vertex: (u, v) => avLeafletPoint(A, leaf, u * 2 - 1, v, this.open) });
      const m = new THREE.Mesh(grid.geometry, materials.valve);
      m.name = `${name}-${leaf.name}`;
      this.group.add(m);
      return { leaf, grid, mesh: m };
    });
    this.group.add(annulusRing(A, materials.annulus));
    this.papillary = papillaryPoints.map((pp) => {
      this.group.add(papillary(pp.base, pp.tip, pp.r, materials.endocardium));
      return pp;
    });
    // Все хорды клапана — один меш, позиции переписываются на месте.
    this.chords = strandBundle(this.chordPairs(), G.chordRadius);
    const cm = new THREE.Mesh(this.chords.geometry, materials.chordae);
    cm.name = 'chordae';
    this.group.add(cm);
  }
  // Пары точек (вершина папиллярной мышцы → край или тело створки).
  chordPairs() {
    const pairs = [];
    for (const pp of this.papillary) {
      for (const [li, sList] of pp.spec.chords) {
        const leaf = this.A.leaflets[li];
        for (const s of sList) {
          pairs.push([pp.tip, avLeafletPoint(this.A, leaf, s, 1, this.open)]);
          pairs.push([pp.tip, avLeafletPoint(this.A, leaf, s, 0.7, this.open)]);
        }
      }
    }
    return pairs;
  }
  setOpen(x) {
    const v = Math.min(1, Math.max(0, x));
    if (Math.abs(v - this.open) < 0.002) return;
    this.open = v;
    for (const { leaf, grid } of this.leaflets) grid.update((u, v) => avLeafletPoint(this.A, leaf, u * 2 - 1, v, this.open));
    this.chords.update(this.chordPairs());
  }
}

// --- Полулунные клапаны --------------------------------------------------------

function frameOf(n) {
  const ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = norm3(cross3(ref, n));
  const e2 = norm3(cross3(n, e1));
  return { e1, e2 };
}

// Точка кармана k: s ∈ [-1,1] от комиссуры до комиссуры, t ∈ [0,1] от
// линии прикрепления к свободному краю.
export function cuspPoint(V, k, s, t, open) {
  const c = V.center, n = V.axis, { e1, e2 } = frameOf(n);
  const radial = (ph) => [Math.cos(ph) * e1[0] + Math.sin(ph) * e2[0], Math.cos(ph) * e1[1] + Math.sin(ph) * e2[1], Math.cos(ph) * e1[2] + Math.sin(ph) * e2[2]];
  const phiC = (V.cuspOffset + 60 + k * 120) * d2r;
  const phi = phiC + s * 60 * d2r;
  const R = V.r * (1 + 0.12 * s * s);
  const att = add3(add3(c, radial(phi), R), n, V.hComm * s * s);
  const sg = s < 0 ? -1 : 1;
  const comm = add3(add3(c, radial(phiC + sg * 60 * d2r), V.r * 1.12), n, V.hComm);
  const centerPt = add3(c, n, V.hComm * 0.75);
  const feClosed = lerp3(centerPt, comm, Math.abs(s));
  const feOpen = add3(add3(c, radial(phi), V.r * 1.06), n, V.hComm * 0.95);
  const fe = lerp3(feClosed, feOpen, open);
  const p = lerp3(att, fe, t);
  const sag = (1 - open) * 0.5 * Math.sin(Math.PI * t) * (1 - 0.7 * s * s);
  return add3(p, n, -sag);
}

class SemilunarValve {
  constructor(V, name, materials) {
    this.V = V; this.name = name; this.open = 0;
    this.group = new THREE.Group(); this.group.name = name;
    this.cusps = [0, 1, 2].map((k) => {
      const grid = openGrid({ cols: 20, rows: 10, vertex: (u, v) => cuspPoint(V, k, u * 2 - 1, v, this.open) });
      const m = new THREE.Mesh(grid.geometry, materials.valve);
      m.name = `${name}-cusp${k}`;
      this.group.add(m);
      return { k, grid };
    });
  }
  setOpen(x) {
    const v = Math.min(1, Math.max(0, x));
    if (Math.abs(v - this.open) < 0.002) return;
    this.open = v;
    for (const { k, grid } of this.cusps) grid.update((u, v) => cuspPoint(this.V, k, u * 2 - 1, v, this.open));
  }
}

// --- Пластины основания ---------------------------------------------------------

function ellipseHole(cx, cz, a, b, e1) {
  const path = new THREE.Path();
  path.absellipse(cx, -cz, a, b, 0, Math.PI * 2, false, -Math.atan2(e1[2], e1[0]));
  return path;
}
function circleHole(cx, cz, r) {
  const path = new THREE.Path();
  path.absarc(cx, -cz, r, 0, Math.PI * 2, false);
  return path;
}
function plateMesh(shape, y, material, name) {
  const g = new THREE.ShapeGeometry(shape, 24);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  const m = new THREE.Mesh(g, material);
  m.name = name;
  return m;
}

function basePlates(materials) {
  const group = new THREE.Group();
  group.name = 'basePlates';
  // ЛЖ: диск эндокарда у основания минус митральное и аортальное кольца.
  const rb = profile(1).rho;
  const lv = new THREE.Shape();
  lv.absarc(0, 0, rb + 0.02, 0, Math.PI * 2, false);
  lv.holes.push(ellipseHole(MITRAL.center[0], MITRAL.center[2], MITRAL.a, MITRAL.b, MITRAL.e1));
  lv.holes.push(circleHole(AORTIC.center[0], AORTIC.center[2], AORTIC.r * 1.08));
  group.add(plateMesh(lv, L, materials.plate, 'lvPlate'));
  // ПЖ: серп минус трикуспидальное кольцо и инфундибулум.
  const loop = crescentLoop(1, 64);
  const rv = new THREE.Shape(loop.map(([x, z]) => new THREE.Vector2(x, -z)));
  rv.holes.push(ellipseHole(TRICUSPID.center[0], TRICUSPID.center[2], TRICUSPID.a, TRICUSPID.b, TRICUSPID.e1));
  rv.holes.push(circleHole(RVOT_BASE[0], RVOT_BASE[2], RVOT_BASE_R * 1.07));
  // Основание ПЖ — купол (мышечный конус между трикуспидальным кольцом и
  // инфундибулумом), а не плоская пластина; сетка купола доходит до контуров.
  const holes = [
    ellipsePts(TRICUSPID.center[0], TRICUSPID.center[2], TRICUSPID.a, TRICUSPID.b, TRICUSPID.e1),
    circlePts(RVOT_BASE[0], RVOT_BASE[2], RVOT_BASE_R * 1.07),
  ];
  const dome = new THREE.Mesh(domeField(loop, holes, L, 0.8), materials.myocardium);
  dome.name = 'rvDome';
  group.add(dome);
  return group;
}

// --- Купол основания ПЖ: heightfield над серпом ---------------------------------

function ellipsePts(cx, cz, a, b, e1, n = 48) {
  const psi = Math.atan2(e1[2], e1[0]), out = [];
  for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2, x = a * Math.cos(t), z = b * Math.sin(t); out.push([cx + x * Math.cos(psi) - z * Math.sin(psi), cz + x * Math.sin(psi) + z * Math.cos(psi)]); }
  return out;
}
function circlePts(cx, cz, r, n = 48) {
  const out = [];
  for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2; out.push([cx + r * Math.cos(t), cz + r * Math.sin(t)]); }
  return out;
}
function inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
// Ближайшая точка контура: { d, x, z }.
function nearestOnPoly(x, z, poly) {
  let best = Infinity, bx0 = x, bz0 = z;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const qx = ax + t * dx, qz = az + t * dz, d2 = (qx - x) ** 2 + (qz - z) ** 2;
    if (d2 < best) { best = d2; bx0 = qx; bz0 = qz; }
  }
  return { d: Math.sqrt(best), x: bx0, z: bz0 };
}
const distPoly = (x, z, poly) => nearestOnPoly(x, z, poly).d;
// Сетка XZ по ячейкам, целиком лежащим в контуре минус отверстия. Высота
// h·s(2 − s), s = min(dist/1, 1) до ближайшего контура: на контурах 0, так что
// кольца и инфундибулум остаются на месте. aDepth = dOut/(dOut + dHole):
// у наружного края — как эпикард, у колец — как кольца (деформация непрерывна).
function domeField(outer, holes, y0, h, step = 0.15) {
  const xs = outer.map((p) => p[0]), zs = outer.map((p) => p[1]);
  const x0 = Math.min(...xs) - step, z0 = Math.min(...zs) - step;
  const nx = Math.ceil((Math.max(...xs) - x0) / step) + 2, nz = Math.ceil((Math.max(...zs) - z0) / step) + 2;
  const inside = (x, z) => inPoly(x, z, outer) && !holes.some((hp) => inPoly(x, z, hp));
  const ok = new Uint8Array((nx + 1) * (nz + 1));
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) ok[i * (nz + 1) + j] = inside(x0 + i * step, z0 + j * step) ? 1 : 0;
  const index = new Map(), pos = [], depth = [], param = [], region = [], idx = [];
  const contours = [outer, ...holes];
  // Вершина сетки; узлы вне области проецируются на ближайший контур, чтобы
  // купол доходил до колец и наружного края без ступенек.
  const vert = (i, j) => {
    const key = i * (nz + 1) + j;
    if (index.has(key)) return index.get(key);
    let x = x0 + i * step, z = z0 + j * step;
    if (!ok[key]) {
      let best = null;
      for (const cp of contours) { const q = nearestOnPoly(x, z, cp); if (!best || q.d < best.d) best = q; }
      x = best.x; z = best.z;
    }
    const dOut = distPoly(x, z, outer), dHole = Math.min(...holes.map((hp) => distPoly(x, z, hp)));
    const s = Math.min(Math.min(dOut, dHole) / 1.0, 1);
    const k = pos.length / 3;
    pos.push(x, y0 + h * s * (2 - s), z);
    depth.push(dOut / (dOut + dHole + 1e-6)); param.push(Math.atan2(z, x), 1); region.push(2);
    index.set(key, k);
    return k;
  };
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const n = ok[i * (nz + 1) + j] + ok[(i + 1) * (nz + 1) + j] + ok[i * (nz + 1) + j + 1] + ok[(i + 1) * (nz + 1) + j + 1];
    if (n === 0) continue;
    const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), d = vert(i + 1, j + 1);
    // Нормаль вверх (+y): обход против часовой при взгляде сверху.
    idx.push(a, d, b, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aDepth', new THREE.BufferAttribute(new Float32Array(depth), 1));
  g.setAttribute('aParam', new THREE.BufferAttribute(new Float32Array(param), 2));
  g.setAttribute('aRegion', new THREE.BufferAttribute(new Float32Array(region), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Проверка ориентации: средняя нормаль должна смотреть вверх.
  const n = g.getAttribute('normal').array; let sy = 0; for (let k = 1; k < n.length; k += 3) sy += n[k];
  if (sy < 0) { for (let t = 0; t < idx.length; t += 3) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; } g.setIndex(idx); g.computeVertexNormals(); }
  return g;
}

// --- Сборка --------------------------------------------------------------------

export function buildValves({ materials }) {
  const group = new THREE.Group();
  group.name = 'valves';

  const mitralPM = MITRAL.papillary.map((pp) => {
    const th = pp.theta * d2r;
    return { spec: pp, base: offsetPoint(th, pp.uBase, 0.3), tip: offsetPoint(th, pp.uTip, -0.9), r: 0.6 };
  });
  const tricuspidPM = TRICUSPID.papillary.map((pp) => {
    const th = pp.theta * d2r;
    const wB = rvWidth(th, pp.uBase), wT = rvWidth(th, pp.uTip);
    return pp.side === 'septum'
      ? { spec: pp, base: offsetPoint(th, pp.uBase, lvWall(pp.uBase) - 0.3), tip: offsetPoint(th, pp.uTip, lvWall(pp.uTip) + 0.7), r: 0.35 }
      : { spec: pp, base: offsetPoint(th, pp.uBase, lvWall(pp.uBase), wB + 0.3), tip: offsetPoint(th, pp.uTip, lvWall(pp.uTip), wT * 0.5), r: 0.5 };
  });

  const mitral = new AVValve(MITRAL, 'mitral', materials, mitralPM);
  const tricuspid = new AVValve(TRICUSPID, 'tricuspid', materials, tricuspidPM);
  const aortic = new SemilunarValve(AORTIC, 'aortic', materials);
  const pulmonary = new SemilunarValve(PULMONARY, 'pulmonary', materials);
  group.add(mitral.group, tricuspid.group, aortic.group, pulmonary.group, basePlates(materials));

  return { group, valves: { mitral, tricuspid, aortic, pulmonary } };
}
