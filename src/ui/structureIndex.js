// structureIndex.js — указатель структур по отделам и описание выбранной.
// Наведение работает в обе стороны: строка ↔ структура в сцене.
import { GROUPS } from '../content/structures.js';

export function mountStructureIndex(engine, ui, structures, el, descEl) {
  el.innerHTML = `<h2>Структуры</h2>` + GROUPS.map((g, gi) => `
    <h3>${g}</h3>
    <ul class="index">${structures.filter((s) => s.group === gi).map((s) => `<li data-id="${s.id}">${s.name}</li>`).join('')}</ul>`).join('');
  const rows = new Map();
  el.querySelectorAll('li[data-id]').forEach((li) => {
    rows.set(li.dataset.id, li);
    li.addEventListener('pointerenter', () => ui.hover(li.dataset.id));
    li.addEventListener('pointerleave', () => ui.hover(null));
    li.addEventListener('click', () => ui.select(ui.state.selected === li.dataset.id ? null : li.dataset.id));
  });
  const hint = 'Наведите на структуру в сцене или в списке, кликните, чтобы прочитать о ней.';
  function sync() {
    for (const [id, li] of rows) { li.classList.toggle('is-hover', ui.state.hover === id); li.classList.toggle('is-selected', ui.state.selected === id); }
    const s = structures.find((x) => x.id === ui.state.selected);
    if (!s) { descEl.innerHTML = `<p class="hint">${hint}</p>`; return; }
    descEl.innerHTML = `<h2>${s.name}</h2><p class="latin">${s.latin}</p><p>${s.desc}</p>`;
    const li = rows.get(s.id); if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
  }
  ui.on('hover', sync); ui.on('select', sync);
  sync();
  return { sync };
}
