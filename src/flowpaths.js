// flowpaths.js — пути кровотока: сегменты сплайнов в координатах покоя
// сердца. Сосуды берут кривые из vessels.js, камеры — точки по layout.js и
// параметрике желудочков. У сегмента: side (0 венозная кровь, 1 артериальная),
// drive (что двигает частицы: накопленный объём через клапан или сглаженный
// поток), share (доля потока привода, идущая по этому сегменту), area (см²,
// эффективное сечение — скорость = поток/сечение), radius(t) — просвет для
// рассеивания частиц, region (ЛП/ПП — частицы сжимаются с предсердием).
import * as THREE from 'three';
import { GEOMETRY as G } from './physiology.js';
import { profileRadius, spline } from './geometry/loft.js';
import { offsetPoint, lvWall, rvWidth, endoPoint, REGION } from './geometry/lvshape.js';
import { MITRAL, TRICUSPID, AORTIC, PULMONARY, RVOT_BASE, RVOT_BASE_R, VESSELS, LA, RA, L, LAA_PATH } from './geometry/layout.js';

const d2r = Math.PI / 180;
export const DRIVES = ['mitral', 'aortic', 'tricuspid', 'pulmonary', 'venous', 'systemic', 'pulmArt', 'laa'];
export const SAMPLES = 64;

// Точка внутри полости: на доле k радиуса от оси до эндокарда.
const lvCavity = (thDeg, u, k = 0.6) => { const p = endoPoint(thDeg * d2r, u); return [p[0] * k, p[1], p[2] * k]; };
const rvCavity = (thDeg, u, k = 0.5) => offsetPoint(thDeg * d2r, u, lvWall(u), rvWidth(thDeg * d2r, u) * k);
const along = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];
const vesselRadius = (name) => { const v = VESSELS.find((s) => s.name === name); const r = profileRadius(v.radius); return (t) => Math.max(0.15, r(t) - v.wall); };

export function buildSegments(vessels) {
  const vc = (name) => vessels.meshes[name].userData.curve;
  const segs = [];
  const add = (s) => segs.push({ range: [0, 1], reverse: false, region: 0, share: 1, ...s });

  // --- Правые отделы (венозная кровь) ---------------------------------------------
  add({ name: 'svc', curve: vc('svc'), side: 0, drive: 'venous', share: 0.35, area: 3.1, radius: vesselRadius('svc') });
  add({ name: 'ivc', curve: vc('ivc'), side: 0, drive: 'venous', share: 0.65, area: 3.8, radius: vesselRadius('ivc') });
  const tv = TRICUSPID.center, raC = RA.center;
  add({ name: 'raSvc', curve: spline([[-4.1, L + 3.1, -1.2], [raC[0], raC[1] + 0.3, raC[2]], [tv[0], tv[1] + 0.5, tv[2]]]), side: 0, drive: 'venous', share: 0.35, area: 4, radius: () => 0.9, region: REGION.RA });
  add({ name: 'raIvc', curve: spline([[-4.1, L + 0.7, -2.6], [raC[0] - 0.3, raC[1] - 0.6, raC[2] - 0.6], [tv[0], tv[1] + 0.5, tv[2]]]), side: 0, drive: 'venous', share: 0.65, area: 4, radius: () => 0.9, region: REGION.RA });
  add({ name: 'rvIn', curve: spline([[tv[0], tv[1] + 0.4, tv[2]], tv, rvCavity(195, 0.75), rvCavity(180, 0.5), rvCavity(160, 0.3)]), side: 0, drive: 'tricuspid', area: 4.5, radius: (t) => 0.7 + 0.3 * Math.sin(Math.PI * t) });
  add({ name: 'rvOut', curve: spline([rvCavity(160, 0.3), rvCavity(130, 0.55), rvCavity(115, 0.8), RVOT_BASE, along(PULMONARY.center, PULMONARY.axis, -0.8), along(PULMONARY.center, PULMONARY.axis, 0.2)]), side: 0, drive: 'pulmonary', area: 3.5, radius: (t) => 0.9 - 0.3 * t });
  add({ name: 'paTrunk', curve: vc('pulmonaryTrunk'), side: 0, drive: 'pulmonary', area: 4.5, radius: vesselRadius('pulmonaryTrunk') });
  add({ name: 'rightPA', curve: vc('rightPA'), side: 0, drive: 'pulmArt', share: 0.55, area: 2.8, radius: vesselRadius('rightPA') });
  add({ name: 'leftPA', curve: vc('leftPA'), side: 0, drive: 'pulmArt', share: 0.45, area: 2.5, radius: vesselRadius('leftPA') });

  // --- Левые отделы (артериальная кровь) ---------------------------------------------
  for (const n of ['rspv', 'ripv', 'lspv', 'lipv']) add({ name: n, curve: vc(n), reverse: true, side: 1, drive: 'venous', share: 0.25, area: 1.3, radius: vesselRadius(n) });
  const mv = MITRAL.center, laC = LA.center;
  add({ name: 'laRight', curve: spline([[-1.0, L + 1.6, -3.4], [laC[0] - 0.6, laC[1], laC[2]], [mv[0], mv[1] + 0.5, mv[2]]]), side: 1, drive: 'venous', share: 0.5, area: 4, radius: () => 0.9, region: REGION.LA });
  add({ name: 'laLeft', curve: spline([[2.3, L + 1.6, -3.3], [laC[0] + 0.7, laC[1], laC[2]], [mv[0], mv[1] + 0.5, mv[2]]]), side: 1, drive: 'venous', share: 0.5, area: 4, radius: () => 0.9, region: REGION.LA });
  // Ушко ЛП: петля туда и обратно внутри слепого мешка; привод — активное
  // опорожнение ЛП, поэтому при ФП частицы стоят (застой).
  const laaBack = [...LAA_PATH].reverse().map((p, i) => [p[0], p[1] - 0.25 + 0.1 * i, p[2] + 0.2]);
  // Просвет ушка сужается к кончику так же, как в atria.js (r0 → r1, скруглённый конец).
  const laaInner = (sv) => Math.max(0.05, (G.laaRadius0 + (G.laaRadius1 - G.laaRadius0) * sv) * (sv > 0.85 ? Math.sqrt(1 - ((sv - 0.85) / 0.15) ** 2) : 1) - G.atrialWall * 0.8);
  add({ name: 'laa', curve: spline([...LAA_PATH, ...laaBack.slice(1)]), side: 1, drive: 'laa', area: 2.2, radius: (t) => 0.6 * laaInner(1 - Math.abs(2 * t - 1)), region: REGION.LA });
  add({ name: 'lvIn', curve: spline([[mv[0], mv[1] + 0.4, mv[2]], mv, lvCavity(280, 0.75, 0.55), lvCavity(270, 0.45, 0.5), [0.1, 0.9, -0.2]]), side: 1, drive: 'mitral', area: 4, radius: (t) => 0.6 + 0.5 * Math.sin(Math.PI * t) });
  const ao = AORTIC.center, ax = AORTIC.axis;
  add({ name: 'lvOut', curve: spline([[0.1, 0.9, -0.2], lvCavity(90, 0.4, 0.5), lvCavity(80, 0.75, 0.6), along(ao, ax, -0.9), along(ao, ax, 0.3)]), side: 1, drive: 'aortic', area: 3.5, radius: (t) => 0.9 - 0.25 * t });
  add({ name: 'aortaAsc', curve: vc('aorta'), range: [0.05, 0.22], side: 1, drive: 'aortic', area: 3.8, radius: vesselRadius('aorta') });
  add({ name: 'aortaArch', curve: vc('aorta'), range: [0.22, 1], side: 1, drive: 'systemic', share: 0.7, area: 3.2, radius: vesselRadius('aorta') });
  for (const [n, sh] of [['brachiocephalic', 0.12], ['leftCarotid', 0.08], ['leftSubclavian', 0.1]]) add({ name: n, curve: vc(n), side: 1, drive: 'systemic', share: sh, area: 0.6, radius: vesselRadius(n) });

  // Длины и семплы по дуге с фреймом параллельного переноса.
  for (const s of segs) {
    const [t0, t1] = s.range;
    const tAt = (k) => { const f = k / (SAMPLES - 1); const t = t0 + (t1 - t0) * f; return s.reverse ? t1 - (t - t0) : t; };
    const pts = [], tans = [];
    for (let k = 0; k < SAMPLES; k++) { const t = tAt(k); pts.push(s.curve.getPointAt(t)); const tg = s.curve.getTangentAt(t); tans.push(s.reverse ? tg.negate() : tg); }
    let len = 0; for (let k = 1; k < SAMPLES; k++) len += pts[k].distanceTo(pts[k - 1]);
    s.length = len;
    // Параллельный перенос нормали вдоль кривой.
    const normals = [], binormals = [];
    let n = new THREE.Vector3().crossVectors(tans[0], Math.abs(tans[0].y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
    for (let k = 0; k < SAMPLES; k++) {
      if (k > 0) { const axis = new THREE.Vector3().crossVectors(tans[k - 1], tans[k]); const l = axis.length(); if (l > 1e-6) { axis.divideScalar(l); const ang = Math.acos(Math.min(1, Math.max(-1, tans[k - 1].dot(tans[k])))); n.applyAxisAngle(axis, ang); } }
      n.sub(tans[k].clone().multiplyScalar(n.dot(tans[k]))).normalize();
      normals.push(n.clone()); binormals.push(new THREE.Vector3().crossVectors(tans[k], n));
    }
    s.samples = { pts, normals, binormals, radii: pts.map((_, k) => { const f = k / (SAMPLES - 1); const t = s.reverse ? t1 - (t1 - t0) * f : t0 + (t1 - t0) * f; return s.radius(t); }) };
  }
  return segs;
}

// Текстура путей: строки 3k (позиция + радиус), 3k+1 (нормаль), 3k+2 (бинормаль).
export function pathsTexture(segs) {
  const h = segs.length * 3, data = new Float32Array(SAMPLES * h * 4);
  segs.forEach((s, k) => {
    for (let i = 0; i < SAMPLES; i++) {
      const p = s.samples.pts[i], n = s.samples.normals[i], b = s.samples.binormals[i];
      let o = ((3 * k) * SAMPLES + i) * 4; data[o] = p.x; data[o + 1] = p.y; data[o + 2] = p.z; data[o + 3] = s.samples.radii[i];
      o = ((3 * k + 1) * SAMPLES + i) * 4; data[o] = n.x; data[o + 1] = n.y; data[o + 2] = n.z;
      o = ((3 * k + 2) * SAMPLES + i) * 4; data[o] = b.x; data[o + 1] = b.y; data[o + 2] = b.z;
    }
  });
  const tex = new THREE.DataTexture(data, SAMPLES, h, THREE.RGBAFormat, THREE.FloatType);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.needsUpdate = true;
  return tex;
}
