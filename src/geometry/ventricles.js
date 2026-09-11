// ventricles.js — желудочки как три поверхности вокруг одной оси (ось ЛЖ = Y,
// верхушка в начале координат, основание на высоте L):
//   эндокард ЛЖ, эндокард ПЖ (серп), эпикард (одна оболочка на оба желудочка),
// плюс два плоских кольца основания. Перегородка — общая стенка: у неё нет
// собственной поверхности, это слой между эндокардом ЛЖ и внутренней дугой
// серпа ПЖ.
//
// Сетки строит ventricleGrids.js (без three.js), параметрика — lvshape.js.
// Каждая вершина несёт aDepth (0 эндокард, 1 эпикард) и aRegion — по ним
// работает деформация в вершинном шейдере (deform.js); карту активации
// (aAct) добавляет conduction.js.
import * as THREE from 'three';
import { geometryFromArrays, enclosedVolume } from './loft.js';
import { ventricleGrids, ventricleStats } from './ventricleGrids.js';
export * from './lvshape.js';

export function buildVentricles({ material, cols = 160, rows = 96 }) {
  const grids = ventricleGrids({ cols, rows });
  const group = new THREE.Group();
  group.name = 'ventricles';
  const meshes = {};
  for (const name of ['lvEndo', 'epi', 'rvEndo', 'ringA', 'ringB']) {
    const m = new THREE.Mesh(geometryFromArrays(grids[name]), material);
    m.name = name;
    meshes[name] = m;
    group.add(m);
  }
  const stats = {
    lvCavityMl: enclosedVolume(meshes.lvEndo.geometry, grids.lvEndo.ring(rows)),
    rvCavityMl: enclosedVolume(meshes.rvEndo.geometry, grids.rvEndo.ring(grids.rvRows)),
    ...ventricleStats(grids),
  };
  return { group, meshes, grids, stats };
}
