// transport.js — транспорт: пауза, скраббер по текущему удару, текущая
// миллисекунда и фаза, ЧСС, скорость, переход к соседнему событию.
const SPEEDS = [0.1, 0.25, 0.5, 1];
const fmt = (x) => String(Math.round(x));

export function mountTransport(engine, ui, el) {
  el.innerHTML = `
    <button class="tp-play" type="button">Пауза</button>
    <div class="tp-step">
      <button type="button" data-step="-10">−10 мс</button>
      <button type="button" data-step="10">+10 мс</button>
    </div>
    <div class="tp-scrub"><input type="range" min="0" max="923" step="1" value="0" aria-label="Время в цикле"></div>
    <div class="tp-read">
      <span class="tp-t"><b>0</b> мс</span>
      <span class="tp-phase"></span>
    </div>
    <div class="tp-meta"><span class="tp-hr"></span><span class="tp-rr"></span><span class="tp-beat"></span></div>
    <div class="tp-events">
      <button type="button" data-ev="-1">Событие назад</button>
      <button type="button" data-ev="1">Событие вперёд</button>
    </div>
    <div class="tp-speed">${SPEEDS.map((s) => `<button type="button" data-speed="${s}">×${String(s).replace('.', ',')}</button>`).join('')}</div>
  `;
  const play = el.querySelector('.tp-play'), range = el.querySelector('input'), tEl = el.querySelector('.tp-t b'), phaseEl = el.querySelector('.tp-phase');
  const hrEl = el.querySelector('.tp-hr'), rrEl = el.querySelector('.tp-rr'), beatEl = el.querySelector('.tp-beat');
  const speedBtns = [...el.querySelectorAll('[data-speed]')];
  let dragging = false;
  play.addEventListener('click', () => engine.setPaused(!engine.clock.paused));
  el.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => engine.setTime(engine.clock.T + Number(b.dataset.step))));
  range.addEventListener('pointerdown', () => { dragging = true; });
  range.addEventListener('pointerup', () => { dragging = false; });
  range.addEventListener('input', () => engine.setCycleTime(Number(range.value)));
  speedBtns.forEach((b) => b.addEventListener('click', () => engine.setSpeed(Number(b.dataset.speed))));
  const jump = (dir) => {
    const ev = engine.current.events, t = engine.current.cycle.wrap(engine.current.t);
    const next = dir > 0 ? ev.find((e) => e.t > t + 1) : [...ev].reverse().find((e) => e.t < t - 1);
    if (next) engine.setCycleTime(next.t);
    else engine.setTime(engine.clock.T + dir * engine.current.cycle.rr); // на соседний удар
  };
  el.querySelectorAll('[data-ev]').forEach((b) => b.addEventListener('click', () => jump(Number(b.dataset.ev))));

  let last = 0;
  function update() {
    const now = performance.now(); if (now - last < 40) return; last = now;
    const c = engine.current.cycle, t = c.wrap(engine.current.t);
    play.textContent = engine.clock.paused ? 'Пуск' : 'Пауза';
    if (!dragging) { range.max = String(Math.round(c.rr)); range.value = String(Math.round(t)); }
    tEl.textContent = fmt(t); phaseEl.textContent = c.phase(t);
    hrEl.textContent = `${fmt(c.hr)} уд/мин`; rrEl.textContent = `RR ${fmt(c.rr)} мс`; beatEl.textContent = `удар ${engine.current.beat.index + 1}`;
    speedBtns.forEach((b) => b.classList.toggle('is-active', Number(b.dataset.speed) === engine.clock.speed));
  }
  return { update };
}
