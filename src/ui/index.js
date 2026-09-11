// ui/index.js — сборка интерфейса поверх движка: состояние (наведение, выбор,
// опции), ID-проход и подсветка, подписи, диаграмма Виггерса, транспорт,
// сценарии, указатель, клавиши. Раз в кадр — ui.frame().
import { STRUCTURES } from '../content/structures.js';
import { createPicker } from './pick.js';
import { createHighlighter } from './highlight.js';
import { createLabels } from './labels.js';
import { Wiggers } from './wiggers.js';
import { mountTransport } from './transport.js';
import { mountControls } from './controls.js';
import { mountScenarioPanel } from './scenarioPanel.js';
import { mountStructureIndex } from './structureIndex.js';
import { mountKeys } from './keys.js';

export function mountUI(engine, root = document) {
  const $ = (id) => root.getElementById(id);
  const listeners = {};
  const ui = {
    state: { hover: null, selected: null, labels: true, wiggers: true, rightPressures: false },
    on(ev, fn) { (listeners[ev] ||= []).push(fn); },
    emit(ev, ...a) { for (const f of listeners[ev] || []) f(...a); },
    hover(id) { if (ui.state.hover === id) return; ui.state.hover = id; highlighter.setHover(id); ui.emit('hover', id); },
    select(id) { if (ui.state.selected === id) return; ui.state.selected = id; highlighter.setSelected(id); ui.emit('select', id); },
  };
  const picker = createPicker(engine, STRUCTURES);
  const highlighter = createHighlighter(engine, picker);
  const labels = createLabels(engine, ui, picker, STRUCTURES, { container: $('labels'), canvas: $('leaders') });
  const wiggers = new Wiggers($('wiggers'), engine, ui);
  const transport = mountTransport(engine, ui, $('transport'));
  const controls = mountControls(engine, ui, $('controls'));
  const scenarioPanel = mountScenarioPanel(engine, ui, $('scenarios'));
  mountStructureIndex(engine, ui, STRUCTURES, $('index'), $('description'));
  mountKeys(engine, ui, controls);
  engine.on('modes', () => controls.sync());
  engine.on('scenario', () => picker.markDirty());

  // Наведение и клик по сцене: id из ID-буфера; клик без протяжки — выбор.
  const canvas = engine.renderer.domElement;
  let pointer = null, down = null, active = 0;
  canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); pointer = [e.clientX - r.left, e.clientY - r.top]; active = 20; });
  canvas.addEventListener('pointerleave', () => { pointer = null; ui.hover(null); });
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 4 && pointer) {
      const s = picker.structureOf(picker.idAt(pointer[0], pointer[1]));
      ui.select(s ? (ui.state.selected === s.id ? null : s.id) : null);
    }
    down = null;
  });
  engine.controls.addEventListener('change', () => { active = 20; });
  ui.on('options', () => { $('wiggers').hidden = !ui.state.wiggers; wiggers.key = null; controls.sync(); });
  $('wiggers').hidden = !ui.state.wiggers;

  function frame() {
    picker.update(active > 0 || !engine.clock.paused);
    if (active > 0) active--;
    if (pointer && !down) { const s = picker.structureOf(picker.idAt(pointer[0], pointer[1])); ui.hover(s ? s.id : null); }
    labels.frame();
    if (ui.state.wiggers) wiggers.draw(engine.current.cycle, engine.current.t, engine.current.events);
    transport.update();
    scenarioPanel.tick();
  }
  return { ...ui, frame, picker, highlighter, labels, wiggers, controls };
}
