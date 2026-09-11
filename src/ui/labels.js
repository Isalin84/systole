// labels.js — подписи структур: HTML-элементы у спроецированных 3D-якорей.
// Якорь деформируется тем же полем, что ткань. Размещение — по «липким»
// слотам: 6 кандидатов смещения, прежний слот сохраняется, пока свободен;
// перекрытие — следующий слот; нет свободного — подпись скрыта. Заслонение —
// по ID-буферу с гистерезисом в 2 выборки. Выноски — на одном 2D-канвасе.
import * as THREE from 'three';
import { deformPoint } from '../deform.js';

const R = 34; // отступ подписи от якоря, px
const SLOTS = [[1, -0.6], [-1, -0.6], [1, 0.6], [-1, 0.6], [0, -1], [0, 1]];

export function createLabels(engine, ui, picker, structures, { container, canvas }) {
  const { camera, heart, renderer } = engine;
  const ctx = canvas.getContext('2d');
  const items = structures.filter((s) => s.label).map((s) => {
    const el = document.createElement('div');
    el.className = 'label'; el.textContent = s.name; el.dataset.id = s.id;
    el.addEventListener('pointerenter', () => ui.hover(s.id));
    el.addEventListener('pointerleave', () => ui.hover(null));
    el.addEventListener('click', () => ui.select(s.id));
    container.appendChild(el);
    return { s, el, anchor: s.anchor(engine), slot: -1, seen: 0, shown: false, w: 0, h: 0, x: 0, y: 0, ax: 0, ay: 0 };
  });
  const measure = () => { for (const it of items) { it.el.hidden = false; it.w = it.el.offsetWidth; it.h = it.el.offsetHeight; it.el.hidden = true; } };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure); else measure();
  measure();

  const v = new THREE.Vector3(), center = new THREE.Vector3();
  const visibleMesh = (id) => (picker.targetsOf.get(id) || []).some((t) => { let o = t.mesh; while (o) { if (!o.visible) return false; o = o.parent; } return true; });
  const overlap = (a, b) => !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);

  function frame() {
    const size = renderer.getSize(new THREE.Vector2());
    const W = size.x, H = size.y;
    if (canvas.width !== Math.floor(W * devicePixelRatio) || canvas.height !== Math.floor(H * devicePixelRatio)) { canvas.width = Math.floor(W * devicePixelRatio); canvas.height = Math.floor(H * devicePixelRatio); }
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!ui.state.labels) { for (const it of items) { if (it.shown) { it.el.hidden = true; it.shown = false; } } return; }
    heart.getWorldPosition(center).project(camera);
    const cx = (center.x + 1) / 2 * W, cy = (1 - center.y) / 2 * H;
    const placed = [];
    const S = engine.current.S, U = engine.U;
    // Сначала проекция и заслонение.
    for (const it of items) {
      const a = it.anchor;
      const q = deformPoint(a.p, a.d ?? 0, a.region ?? 0, a.va ?? 0, U, S);
      v.set(q[0], q[1], q[2]).applyMatrix4(heart.matrixWorld);
      const viewDepth = v.clone().applyMatrix4(camera.matrixWorldInverse).z * -1;
      v.project(camera);
      it.ax = (v.x + 1) / 2 * W; it.ay = (1 - v.y) / 2 * H;
      let ok = v.z < 1 && it.ax > 0 && it.ax < W && it.ay > 0 && it.ay < H && visibleMesh(it.s.id);
      if (ok) {
        const smp = picker.sample(it.ax, it.ay);
        const myId = picker.ids.get(it.s.id);
        if (smp) ok = smp.id === myId || smp.depth >= viewDepth - 0.35;
      }
      it.seen = ok ? Math.min(2, it.seen + 1) : Math.max(-2, it.seen - 1);
      it.visible = it.seen > 0;
    }
    // Затем размещение по слотам.
    for (const it of items) {
      if (!it.visible) { if (it.shown) { it.el.hidden = true; it.shown = false; } it.slot = -1; continue; }
      const away = Math.atan2(it.ay - cy, it.ax - cx);
      const order = SLOTS.map((s, i) => ({ i, d: Math.abs(Math.atan2(Math.sin(Math.atan2(s[1], s[0]) - away), Math.cos(Math.atan2(s[1], s[0]) - away))) })).sort((p, q) => p.d - q.d).map((o) => o.i);
      if (it.slot >= 0) order.unshift(it.slot);
      let chosen = -1, rect = null;
      for (const si of order) {
        const [sx, sy] = SLOTS[si];
        const x = it.ax + sx * R - (sx < 0 ? it.w : sx > 0 ? 0 : it.w / 2), y = it.ay + sy * R - (sy < 0 ? it.h : sy > 0 ? 0 : it.h / 2);
        const r = { x, y, w: it.w, h: it.h };
        if (x < 4 || y < 4 || x + it.w > W - 4 || y + it.h > H - 4) continue;
        if (placed.some((p) => overlap(p, r))) continue;
        chosen = si; rect = r; break;
      }
      if (chosen < 0) { if (it.shown) { it.el.hidden = true; it.shown = false; } it.slot = -1; continue; }
      it.slot = chosen; it.x = rect.x; it.y = rect.y; placed.push(rect);
      it.el.style.transform = `translate3d(${Math.round(rect.x)}px, ${Math.round(rect.y)}px, 0)`;
      it.el.classList.toggle('is-active', ui.state.hover === it.s.id || ui.state.selected === it.s.id);
      if (!it.shown) { it.el.hidden = false; it.shown = true; }
      // Выноска: от ближайшей точки края подписи к якорю.
      const lx = Math.min(Math.max(it.ax, rect.x), rect.x + rect.w), ly = Math.min(Math.max(it.ay, rect.y), rect.y + rect.h);
      ctx.strokeStyle = 'rgba(232, 224, 220, 0.55)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(it.ax, it.ay); ctx.stroke();
      ctx.fillStyle = 'rgba(232, 224, 220, 0.9)'; ctx.beginPath(); ctx.arc(it.ax, it.ay, 2, 0, Math.PI * 2); ctx.fill();
    }
  }
  return { frame, items };
}
