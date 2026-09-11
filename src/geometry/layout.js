// layout.js — анатомическая раскладка: где стоят кольца клапанов, куда идут
// сосуды, где лежат коронарные артерии. Всё в локальных координатах сердца:
// ось ЛЖ — Y, верхушка в начале координат, основание на высоте L;
// +X — влево по пациенту, +Z — вперёд. Размеры — из physiology.js.
import { GEOMETRY as G } from '../physiology.js';

export const L = G.lvLength;
const d2r = Math.PI / 180;
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };

// Кольцо АВ-клапана: центр, полуоси (a — межкомиссуральная, b — поперёк),
// psi — поворот оси a в плоскости XZ. e2 = поперечная ось (куда смотрит
// передняя/перегородочная створка).
function annulus(center, a, b, psiDeg) {
  const psi = psiDeg * d2r;
  return { center, a, b, e1: [Math.cos(psi), 0, Math.sin(psi)], e2: [-Math.sin(psi), 0, Math.cos(psi)], normal: [0, 1, 0] };
}

// Митральное кольцо: задне-левая часть основания ЛЖ, длинная ось по
// касательной к основанию; e2 смотрит вперёд, к аортальному клапану.
export const MITRAL = {
  ...annulus([0.4, L, -0.85], G.mitralA, G.mitralB, 20),
  leaflets: [
    // φ — угол в системе (e1, e2); передняя створка занимает ~1/3 окружности.
    { name: 'anterior', phi0: 30, phi1: 150, length: G.amlLength, closed: 22, open: 72 },
    { name: 'posterior', phi0: 150, phi1: 390, length: G.pmlLength, closed: 35, open: 80 },
  ],
  papillary: [
    // θ на стенке ЛЖ, u основания, u вершины, куда тянутся хорды: [створка, s...]
    { name: 'anterolateral', theta: 340, uBase: 0.42, uTip: 0.72, chords: [[0, [-0.9, -0.5, -0.1]], [1, [0.9, 0.55, 0.2]]] },
    { name: 'posteromedial', theta: 250, uBase: 0.38, uTip: 0.7, chords: [[0, [0.1, 0.5, 0.9]], [1, [-0.9, -0.55, -0.2]]] },
  ],
};

// Трикуспидальное кольцо: над притоком ПЖ (θ ≈ 195°), e2 смотрит к перегородке.
export const TRICUSPID = {
  ...annulus([-4.25, L, -1.14], G.tricuspidA, G.tricuspidB, -75),
  leaflets: [
    { name: 'septal', phi0: 30, phi1: 150, length: G.tvLeafletLength * 0.9, closed: 25, open: 72 },
    { name: 'anterior', phi0: 150, phi1: 270, length: G.tvLeafletLength * 1.1, closed: 25, open: 78 },
    { name: 'posterior', phi0: 270, phi1: 390, length: G.tvLeafletLength * 0.85, closed: 30, open: 78 },
  ],
  papillary: [
    { name: 'anterior', theta: 150, uBase: 0.5, uTip: 0.76, side: 'free', chords: [[1, [-0.8, -0.3, 0.3]], [2, [0.8, 0.3]]] },
    { name: 'posterior', theta: 212, uBase: 0.42, uTip: 0.74, side: 'free', chords: [[2, [-0.7, -0.2]], [0, [0.8, 0.3]]] },
    { name: 'septal', theta: 175, uBase: 0.6, uTip: 0.8, side: 'septum', chords: [[0, [-0.7, -0.2]], [1, [0.8]]] },
  ],
};

// Полулунные клапаны: центр кольца, ось потока, радиус кольца.
export const AORTIC = {
  center: [-0.45, L + 0.1, 1.1], axis: norm([-0.32, 0.86, 0.4]), r: G.aorticR, hComm: G.cuspHeight,
  cuspOffset: 30, // угол первой комиссуры, градусы
};
export const PULMONARY = {
  center: [1.2, L + 2.2, 3.4], axis: norm([0.45, 0.8, -0.4]), r: G.pulmonaryR, hComm: G.cuspHeight,
  cuspOffset: 0,
};

// Начало инфундибулума на основании ПЖ (θ = 110°, r = 4.6): широкая воронка,
// сужающаяся к лёгочному клапану.
export const RVOT_BASE = [Math.cos(110 * d2r) * 4.6, L - 0.5, Math.sin(110 * d2r) * 4.6];
export const RVOT_BASE_R = 1.4;

// Сосуды: путь [x,y,z], профиль радиуса [[t, r]...], стенка, тип крови.
const ao = AORTIC.center, ax = AORTIC.axis;
const along = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];
const pv = PULMONARY.center, px = PULMONARY.axis;

export const VESSELS = [
  {
    name: 'aorta', kind: 'arterial', wall: G.vesselWall,
    points: [along(ao, ax, -0.7), along(ao, ax, 0.0), along(ao, ax, 0.9), along(ao, ax, 2.2), [-1.5, L + 4.6, 1.5], [-1.0, L + 6.7, 0.1],
      [0.6, L + 7.3, -1.7], [1.6, L + 6.3, -3.8], [1.6, L + 4.2, -5.6], [1.4, L + 1.0, -6.2], [1.2, -3.5, -6.4]],
    radius: [[0, G.aorticR], [0.03, G.aorticR], [0.085, 1.22], [0.15, 1.05], [0.35, 1.15], [0.6, 1.05], [1, 0.95]],
  },
  { name: 'brachiocephalic', kind: 'arterial', wall: 0.1, points: [[-0.9, L + 6.4, -0.4], [-1.2, L + 8.2, -0.6], [-2.0, L + 11.0, -0.9]], radius: [[0, 0.55], [1, 0.5]] },
  { name: 'leftCarotid', kind: 'arterial', wall: 0.1, points: [[0.3, L + 6.6, -1.2], [0.5, L + 8.5, -1.4], [0.7, L + 11.2, -1.5]], radius: [[0, 0.4], [1, 0.36]] },
  { name: 'leftSubclavian', kind: 'arterial', wall: 0.1, points: [[1.1, L + 6.3, -2.2], [1.7, L + 8.3, -2.7], [2.6, L + 11.0, -3.3]], radius: [[0, 0.45], [1, 0.4]] },
  {
    name: 'pulmonaryTrunk', kind: 'venous', wall: 0.12,
    points: [along(pv, px, -0.05), along(pv, px, 1.2), [1.9, L + 3.9, 2.2], [2.2, L + 5.3, 0.9]],
    radius: [[0, G.pulmonaryR], [0.15, 1.25], [0.3, 1.15], [1, 1.15]],
  },
  { name: 'rightPA', kind: 'venous', wall: 0.1, points: [[2.2, L + 5.3, 0.9], [0.2, L + 5.6, -0.4], [-2.5, L + 5.6, -1.3], [-5.8, L + 5.3, -1.9]], radius: [[0, 1.0], [1, 0.85]] },
  { name: 'leftPA', kind: 'venous', wall: 0.1, points: [[2.2, L + 5.3, 0.9], [4.0, L + 5.7, -0.3], [6.4, L + 5.5, -2.2]], radius: [[0, 1.0], [1, 0.85]] },
  { name: 'svc', kind: 'venous', wall: 0.1, points: [[-4.0, L + 9.5, -1.5], [-4.0, L + 6.2, -1.4], [-4.1, L + 3.2, -1.2]], radius: [[0, 1.0], [1, 1.0]] },
  { name: 'ivc', kind: 'venous', wall: 0.1, points: [[-4.0, -2.5, -4.6], [-4.0, L - 2.2, -4.3], [-4.1, L + 0.6, -2.7]], radius: [[0, 1.1], [1, 1.05]] },
  { name: 'rspv', kind: 'arterial', wall: 0.08, points: [[-1.0, L + 2.2, -3.5], [-2.6, L + 2.7, -4.5], [-4.8, L + 3.1, -5.2]], radius: [[0, 0.65], [1, 0.6]] },
  { name: 'ripv', kind: 'arterial', wall: 0.08, points: [[-1.0, L + 1.0, -3.5], [-2.6, L + 0.7, -4.6], [-4.8, L + 0.4, -5.4]], radius: [[0, 0.65], [1, 0.6]] },
  { name: 'lspv', kind: 'arterial', wall: 0.08, points: [[2.3, L + 2.2, -3.4], [3.9, L + 2.7, -4.4], [6.0, L + 3.1, -5.0]], radius: [[0, 0.65], [1, 0.6]] },
  { name: 'lipv', kind: 'arterial', wall: 0.08, points: [[2.3, L + 1.0, -3.4], [3.9, L + 0.6, -4.5], [6.0, L + 0.3, -5.2]], radius: [[0, 0.65], [1, 0.6]] },
];

// Инфундибулум (выводной тракт ПЖ): от основания ПЖ к лёгочному клапану.
export const RVOT = {
  name: 'rvot', kind: 'myocardium', wall: G.rvWall,
  points: [RVOT_BASE, [(RVOT_BASE[0] + pv[0]) / 2 - 0.2, (RVOT_BASE[1] + pv[1]) / 2, (RVOT_BASE[2] + pv[2]) / 2 + 0.3], along(pv, px, 0.05)],
  radius: [[0, RVOT_BASE_R], [0.5, 1.2], [1, G.pulmonaryR]],
};

// Коронарные артерии: путь по эпикарду в (θ°, u), радиусы у устья / на конце.
export const CORONARIES = [
  { name: 'leftMain', from: 'aorticLeft', path: [[62, 0.98], [64, 0.95]], radius: [0.22, 0.2] },
  { name: 'lad', path: [[64, 0.95], [69, 0.85], [70, 0.6], [70, 0.35], [71, 0.15], [74, 0.04]], radius: [0.2, 0.07] },
  { name: 'diagonal', path: [[69, 0.8], [55, 0.62], [42, 0.4]], radius: [0.1, 0.05] },
  { name: 'circumflex', path: [[64, 0.95], [40, 0.96], [10, 0.96], [340, 0.95], [310, 0.93]], radius: [0.18, 0.08] },
  { name: 'obtuseMarginal', path: [[350, 0.94], [345, 0.7], [338, 0.45]], radius: [0.1, 0.05] },
  { name: 'rca', from: 'aorticRight', path: [[118, 0.98], [140, 0.97], [170, 0.965], [200, 0.965], [222, 0.96]], radius: [0.2, 0.15] },
  { name: 'pda', path: [[222, 0.96], [224, 0.8], [225, 0.55], [225, 0.3], [226, 0.12]], radius: [0.14, 0.06] },
  { name: 'acuteMarginal', path: [[150, 0.95], [148, 0.7], [145, 0.45]], radius: [0.09, 0.05] },
];

// Предсердия: центр эллипсоида; дно — воронка к своему АВ-кольцу.
export const LA = { center: [0.6, L + 1.9, -2.1], axes: G.laAxes, annulus: MITRAL };
export const RA = { center: [-4.4, L + 1.9, -0.7], axes: G.raAxes, annulus: TRICUSPID };

// Ушки: пути от стенки предсердия.
export const LAA_PATH = [[1.4, L + 1.6, -0.5], [2.8, L + 1.5, 0.8], [3.8, L + 1.4, 1.9], [4.2, L + 1.1, 2.9]];
export const RAA_PATH = [[-3.8, L + 2.6, 0.6], [-2.9, L + 3.0, 1.8], [-1.9, L + 3.1, 2.8]];
