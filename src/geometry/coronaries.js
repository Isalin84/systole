// coronaries.js — коронарные артерии по бороздам эпикарда. Пути заданы в
// параметрических координатах эпикарда (θ, u), поэтому в проходе 3 они
// смогут двигаться вместе с миокардом теми же формулами.
import * as THREE from 'three';
import { tubeSurface, spline } from './loft.js';
import { epiPoint } from './ventricles.js';
import { CORONARIES, AORTIC } from './layout.js';

const d2r = Math.PI / 180;

function ostium(which) {
  // Устья: левый и правый коронарные синусы, чуть выше кольца.
  const c = AORTIC.center, ax = AORTIC.axis;
  const up = [c[0] + ax[0] * 0.9, c[1] + ax[1] * 0.9, c[2] + ax[2] * 0.9];
  const side = which === 'aorticLeft' ? [0.9, 0.1, -0.3] : [-0.85, 0.05, 0.45];
  return [up[0] + side[0] * AORTIC.r, up[1] + side[1] * AORTIC.r, up[2] + side[2] * AORTIC.r];
}

export function buildCoronaries({ material, occlusionMaterial = material }) {
  const group = new THREE.Group();
  group.name = 'coronaries';
  // Маркер окклюзии: тёмная бусина на ПМЖВ ниже первой диагональной (сценарий 5).
  const occ = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), occlusionMaterial);
  occ.geometry.translate(...epiPoint(70 * d2r, 0.66, 0.06));
  occ.name = 'occlusion'; occ.visible = false;
  group.add(occ);
  for (const c of CORONARIES) {
    const pts = c.path.map(([th, u]) => epiPoint(th * d2r, u, 0.06));
    if (c.from) pts.unshift(ostium(c.from));
    const curve = spline(pts, 0.5);
    const [r0, r1] = c.radius;
    const surf = tubeSurface({ curve, radius: (t) => r0 + (r1 - r0) * t, segments: 48, radial: 10, closeStart: true, closeEnd: true });
    const m = new THREE.Mesh(surf.geometry, material);
    m.name = c.name;
    group.add(m);
  }
  return { group };
}
