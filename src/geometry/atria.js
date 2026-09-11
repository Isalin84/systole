// atria.js — предсердия: тонкостенные мешки над АВ-плоскостью. Верхняя
// половина — эллипсоид, нижняя — воронка к кольцу своего АВ-клапана, дно
// открыто в кольцо. Оболочка = наружная + внутренняя поверхность (смещение
// по нормали на толщину стенки). Ушки — изогнутые трубки с сужением.
// Сетки оболочек строит atriaShape.js (без three.js).
import * as THREE from 'three';
import { GEOMETRY as G } from '../physiology.js';
import { geometryFromArrays, tubeSurface, enclosedVolume, spline } from './loft.js';
import { REGION } from './lvshape.js';
import { atriumGrids } from './atriaShape.js';
import { LA, RA, LAA_PATH, RAA_PATH } from './layout.js';

function atriumShell({ A, wall, region, material }) {
  const grids = atriumGrids({ A, wall, region });
  const outer = geometryFromArrays(grids.outer), inner = geometryFromArrays(grids.inner);
  const group = new THREE.Group();
  const mo = new THREE.Mesh(outer, material), mi = new THREE.Mesh(inner, material);
  mo.name = 'outer'; mi.name = 'inner';
  group.add(mo, mi);
  return { group, grids, meshes: { outer: mo, inner: mi }, cavityMl: enclosedVolume(inner, grids.inner.ring(0)) };
}

function appendage({ path, r0, r1, wall, region, material }) {
  const curve = spline(path);
  const rad = (s) => (r0 + (r1 - r0) * s) * (s > 0.85 ? Math.sqrt(1 - ((s - 0.85) / 0.15) ** 2) : 1);
  const outer = tubeSurface({ curve, radius: rad, closeEnd: true, depth: 1, region });
  const inner = tubeSurface({ curve, radius: (s) => Math.max(0.05, rad(s) - wall * 0.8), inward: true, closeEnd: true, depth: 0, region });
  const g = new THREE.Group();
  const mo = new THREE.Mesh(outer.geometry, material), mi = new THREE.Mesh(inner.geometry, material);
  g.add(mo, mi);
  return { group: g, meshes: { outer: mo, inner: mi }, arrays: { outer: outer.arrays, inner: inner.arrays }, start: path[0], length: curve.getLength() };
}

export function buildAtria({ material }) {
  const t = G.atrialWall;
  const group = new THREE.Group();
  group.name = 'atria';

  const la = atriumShell({ A: LA, wall: t, region: REGION.LA, material });
  la.group.name = 'la';
  const ra = atriumShell({ A: RA, wall: t, region: REGION.RA, material });
  ra.group.name = 'ra';
  const laa = appendage({ path: LAA_PATH, r0: G.laaRadius0, r1: G.laaRadius1, wall: t, region: REGION.LA, material });
  laa.group.name = 'laa';
  const raa = appendage({ path: RAA_PATH, r0: G.raaRadius0, r1: G.raaRadius1, wall: t, region: REGION.RA, material });
  raa.group.name = 'raa';
  group.add(la.group, ra.group, laa.group, raa.group);

  return {
    group,
    parts: { la, ra, laa, raa },
    stats: { laCavityMl: la.cavityMl, raCavityMl: ra.cavityMl, atrialWallCm: t },
  };
}
