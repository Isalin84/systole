// vessels.js — крупные сосуды и выводной тракт ПЖ: трубки по сплайнам с
// переменным радиусом, оболочки с толщиной стенки, открытые концы.
import * as THREE from 'three';
import { vesselShell, spline, profileRadius } from './loft.js';
import { VESSELS, RVOT } from './layout.js';

export function buildVessels({ materials }) {
  const group = new THREE.Group();
  group.name = 'vessels';
  const meshes = {};
  const add = (spec) => {
    const curve = spline(spec.points);
    const shell = vesselShell({ curve, radius: profileRadius(spec.radius), wall: spec.wall, segments: 64, radial: 28 });
    // Стенка и просвет — разные материалы (просвет — цвет крови); инфундибулум — миокард.
    const wall = materials[spec.kind + 'Wall'] || materials[spec.kind];
    const lumen = materials[spec.kind + 'Lumen'] || materials[spec.kind];
    const g = new THREE.Group();
    g.name = spec.name;
    g.add(new THREE.Mesh(shell.outer, wall), new THREE.Mesh(shell.inner, lumen));
    g.userData.curve = curve;
    group.add(g);
    meshes[spec.name] = g;
  };
  VESSELS.forEach(add);
  add(RVOT);
  return { group, meshes };
}
