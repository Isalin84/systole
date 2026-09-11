// scenarioPanel.js — сценарии, текст активного и события текущего цикла с
// подсветкой текущей фазы; клик по событию — переход к нему.
export function mountScenarioPanel(engine, ui, el) {
  el.innerHTML = `
    <h2>Сценарии</h2>
    <div class="scenario-list">${engine.scenarios.map((s, i) => `<button type="button" data-key="${s.key}"><span class="num">${i + 1}</span>${s.title}</button>`).join('')}</div>
    <p class="scenario-text"></p>
    <h2>События цикла</h2>
    <ol class="events"></ol>
  `;
  const buttons = [...el.querySelectorAll('[data-key]')], text = el.querySelector('.scenario-text'), list = el.querySelector('.events');
  buttons.forEach((b) => b.addEventListener('click', () => engine.applyScenario(b.dataset.key)));
  let items = [], eventsRef = null;
  function rebuild() {
    const st = engine.state;
    buttons.forEach((b) => b.classList.toggle('is-active', b.dataset.key === st.scenario.key));
    text.textContent = st.text;
    eventsRef = engine.current.events;
    list.innerHTML = eventsRef.map((e) => `<li data-t="${e.t}"><span class="t">${Math.round(e.t)}</span><span class="l">${e.label}</span></li>`).join('');
    items = [...list.children];
    items.forEach((li) => li.addEventListener('click', () => engine.setCycleTime(Number(li.dataset.t))));
  }
  engine.on('scenario', rebuild);
  rebuild();
  let lastIdx = -1;
  function tick() {
    if (engine.current.events !== eventsRef) rebuild();
    const t = engine.current.cycle.wrap(engine.current.t);
    let idx = -1; eventsRef.forEach((e, i) => { if (e.t <= t + 0.5) idx = i; });
    if (idx === lastIdx) return; lastIdx = idx;
    items.forEach((li, i) => li.classList.toggle('is-current', i === idx));
  }
  return { tick, rebuild };
}
