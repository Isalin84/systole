// controls.js — вид: слои, разрез, полоса Виггерса, подписи, правые давления.
export function mountControls(engine, ui, el) {
  const layers = [['ventricles', 'Миокард желудочков'], ['atria', 'Предсердия'], ['valves', 'Клапаны'], ['vessels', 'Сосуды'], ['coronaries', 'Коронарные артерии'], ['conduction', 'Проводящая система'], ['flow', 'Кровоток']];
  const cuts = [['none', 'Нет'], ['4ch', 'Четыре камеры'], ['lvot', 'Выносящий тракт'], ['sax', 'Короткая ось']];
  el.innerHTML = `
    <h2>Слои</h2>
    <div class="check-list">${layers.map(([k, n]) => `<label><input type="checkbox" data-layer="${k}" checked> ${n}</label>`).join('')}</div>
    <div class="check-list">
      <label><input type="checkbox" data-opt="labels" checked> Подписи структур</label>
      <label><input type="checkbox" data-opt="wiggers" checked> Диаграмма Виггерса</label>
      <label><input type="checkbox" data-opt="rightPressures"> Давления правых отделов</label>
    </div>
    <div class="row">
      <span>Электрика</span>
      <div class="seg" data-seg="ecg"><button type="button" data-v="0">нет</button><button type="button" data-v="1">волна</button><button type="button" data-v="2">с деревом</button></div>
    </div>
    <div class="row">
      <span>Кровоток</span>
      <div class="seg" data-seg="flow"><button type="button" data-v="0">нет</button><button type="button" data-v="1">частицы</button><button type="button" data-v="2">сквозь стенки</button></div>
    </div>
    <h2>Разрез</h2>
    <div class="seg seg-wrap" data-seg="cut">${cuts.map(([k, n]) => `<button type="button" data-v="${k}">${n}</button>`).join('')}</div>
    <div class="row cut-level" hidden><span>Уровень</span><input type="range" min="-1" max="12" step="0.25" aria-label="Уровень среза"></div>
    <div class="row"><button type="button" class="btn-flip">Другая сторона среза</button><button type="button" class="btn-reset">Сбросить вид</button></div>
  `;
  el.querySelectorAll('[data-layer]').forEach((cb) => cb.addEventListener('change', () => { engine.layers[cb.dataset.layer].visible = cb.checked; if (cb.dataset.layer === 'flow' && cb.checked && engine.modes.flow === 0) engine.setFlowMode(1); ui.emit('layers'); }));
  el.querySelectorAll('[data-opt]').forEach((cb) => cb.addEventListener('change', () => { ui.state[cb.dataset.opt] = cb.checked; ui.emit('options'); }));
  const segs = {};
  el.querySelectorAll('[data-seg]').forEach((seg) => {
    segs[seg.dataset.seg] = seg;
    seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      const v = b.dataset.v;
      if (seg.dataset.seg === 'ecg') engine.setEcgMode(Number(v));
      else if (seg.dataset.seg === 'flow') { engine.setFlowMode(Number(v)); engine.layers.flow.visible = Number(v) > 0; }
      else if (seg.dataset.seg === 'cut') engine.cut.setMode(v);
      sync();
    }));
  });
  const level = el.querySelector('.cut-level'), levelInput = level.querySelector('input');
  levelInput.addEventListener('input', () => { engine.cut.saxLevel = Number(levelInput.value); });
  el.querySelector('.btn-flip').addEventListener('click', () => { engine.cut.flip = !engine.cut.flip; });
  el.querySelector('.btn-reset').addEventListener('click', () => { engine.camera.position.set(0, 3, 40); engine.controls.target.set(0, 0, 0); });
  function sync() {
    for (const [k, seg] of Object.entries(segs)) {
      const v = k === 'ecg' ? String(engine.modes.ecg) : k === 'flow' ? String(engine.modes.flow) : engine.cut.mode;
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b.dataset.v === v));
    }
    el.querySelectorAll('[data-layer]').forEach((cb) => { cb.checked = engine.layers[cb.dataset.layer].visible; });
    el.querySelectorAll('[data-opt]').forEach((cb) => { cb.checked = !!ui.state[cb.dataset.opt]; });
    level.hidden = engine.cut.mode !== 'sax'; levelInput.value = String(engine.cut.saxLevel);
  }
  sync();
  return { sync };
}
