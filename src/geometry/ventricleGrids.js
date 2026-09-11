// ventricleGrids.js — сетки желудочков без three.js: эндокард ЛЖ, эпикард,
// эндокард ПЖ (серп) и два кольца основания. Используются ventricles.js
// (геометрия), conduction.js (карта активации) и тестами под node.
import { GEOMETRY as G } from '../physiology.js';
import { gridArrays } from './grid.js';
import { REGION, profile, lvWall, inSector, rvWidth, rvMask, epiOffset, endoPoint, endoNormal, offsetPoint, neg, vParam } from './lvshape.js';

const TAU = Math.PI * 2;

export function ventricleGrids({ cols = 160, rows = 96 } = {}) {
  const thetaAt = (i) => (i / cols) * TAU;

  // Эндокард ЛЖ: нормаль внутрь полости.
  const lvEndo = gridArrays({
    cols, rows,
    vertex: (i, j) => {
      const th = thetaAt(i), u = j / rows;
      return { p: endoPoint(th, u), n: neg(endoNormal(th, u)), param: [th, vParam(u)], depth: 0, region: inSector(th) ? REGION.SEPTUM : REGION.LV };
    },
    poleStart: () => ({ p: [0, 0, 0], n: [0, 1, 0], param: [0, 0], depth: 0, region: REGION.LV }),
  });

  // Эпикард: нормаль наружу; те же (i, j), что у эндокарда ЛЖ.
  const epi = gridArrays({
    cols, rows,
    vertex: (i, j) => {
      const th = thetaAt(i), u = j / rows;
      return { p: offsetPoint(th, u, ...epiOffset(th, u)), n: endoNormal(th, u), param: [th, vParam(u)], depth: 1, region: rvMask(th, u) > 0.5 ? REGION.RV : REGION.LV };
    },
    poleStart: () => ({ p: [0, -epiOffset(0, 0)[0], 0], n: [0, -1, 0], param: [0, 0], depth: 1, region: REGION.LV }),
  });

  // Эндокард ПЖ: замкнутая петля на каждом уровне — наружная дуга (свободная
  // стенка, s < 0,5) туда, внутренняя (перегородка) обратно. Полюс — верхушка ПЖ.
  const rvRows = Math.round(rows * (1 - G.rvApexU));
  const span = G.rvTheta1 - G.rvTheta0, thMid = G.rvTheta0 + span / 2;
  const rvEndo = gridArrays({
    cols, rows: rvRows,
    vertex: (i, j) => {
      const s = i / cols, u = G.rvApexU + (j / rvRows) * (1 - G.rvApexU);
      if (s < 0.5) {
        const th = G.rvTheta0 + (s / 0.5) * span;
        return { p: offsetPoint(th, u, lvWall(u), rvWidth(th, u)), n: neg(endoNormal(th, u)), param: [th, vParam(u)], depth: 0, region: REGION.RV };
      }
      const th = G.rvTheta1 - ((s - 0.5) / 0.5) * span;
      return { p: offsetPoint(th, u, lvWall(u)), n: endoNormal(th, u), param: [th, vParam(u)], depth: 1, region: REGION.SEPTUM };
    },
    poleStart: () => ({ p: offsetPoint(thMid, G.rvApexU, lvWall(G.rvApexU)), n: [0, 1, 0], param: [thMid, vParam(G.rvApexU)], depth: 0.5, region: REGION.RV }),
  });

  // Кольца основания (u = 1, нормаль вверх).
  const ringA = gridArrays({
    cols, rows: 1,
    vertex: (i, j) => {
      const th = thetaAt(i), o = j === 0 ? 0 : lvWall(1);
      return { p: offsetPoint(th, 1, o), n: [0, 1, 0], param: [th, 1], depth: j, region: inSector(th) ? REGION.SEPTUM : REGION.LV };
    },
  });
  // Внутренний край кольца ПЖ — эндокард свободной стенки (d = 0) только в
  // секторе; вне сектора он совпадает с эпикардом (d = 1).
  const ringB = gridArrays({
    cols, rows: 1,
    vertex: (i, j) => {
      const th = thetaAt(i), o = j === 0 ? [lvWall(1), rvWidth(th, 1)] : epiOffset(th, 1);
      return { p: offsetPoint(th, 1, ...o), n: [0, 1, 0], param: [th, 1], depth: j === 0 ? 1 - rvMask(th, 1) : 1, region: REGION.RV };
    },
  });

  return { lvEndo, epi, rvEndo, ringA, ringB, cols, rows, rvRows, thMid };
}

// Статистика геометрии (толщины, радиусы) — без объёмов.
export function ventricleStats(g) {
  const thMid = g.thMid;
  return {
    lvWallBaseCm: lvWall(1), lvWallMidCm: lvWall(0.6), lvWallApexCm: lvWall(0),
    rvWallCm: G.rvWall,
    rvWidthMidCm: rvWidth(thMid, 0.6),
    epiRadiusLeftCm: profile(1).rho + epiOffset(0, 1)[0],
    epiRadiusRvCm: profile(1).rho + epiOffset(thMid, 1)[0] + epiOffset(thMid, 1)[1],
    lengthCm: G.lvLength,
  };
}
