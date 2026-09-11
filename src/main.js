// main.js — точка входа: движок (engine.js), интерфейс (ui/), кадр.
// ?scenario=rest|exercise|af|hfref|lad|lbbb; ?hr=, ?seed= — переопределения;
// ?ecg=, ?flow= — режимы слоёв; ?hide=valves,vessels — скрыть слои; ?dev=1 — панель цифр.
import { createEngine } from './engine.js';
import { mountUI } from './ui/index.js';

const query = new URLSearchParams(location.search);
const engine = createEngine({ canvas: document.getElementById('scene') });
const scenarioKey = query.get('scenario') || (query.get('rhythm') === 'af' ? 'af' : query.get('lbbb') === '1' ? 'lbbb' : 'rest');
engine.applyScenario(scenarioKey, { hr: Number(query.get('hr')) || undefined, seed: Number(query.get('seed')) || undefined });
engine.setEcgMode(Number(query.get('ecg') ?? 1));
engine.setFlowMode(Number(query.get('flow') ?? 1));
for (const k of (query.get('hide') || '').split(',')) if (engine.layers[k]) engine.layers[k].visible = false;
if (query.get('cut')) engine.cut.setMode(query.get('cut'));

const ui = mountUI(engine);
window.systole = Object.assign(engine, { ui });

// --- Dev-панель (?dev=1) -------------------------------------------------------
const panel = document.getElementById('dev');
const dev = query.get('dev') === '1';
panel.hidden = !dev;
const fmt = (x, d = 1) => Number(x).toFixed(d);
let frames = 0, fpsT = performance.now(), fps = 0;
function drawPanel() {
  const { cut, layers, clock, current, stats, state: st } = engine;
  const on = Object.entries(layers).filter(([, g]) => g.visible).map(([k]) => k).join(' ');
  const c = current.cycle, t = current.t, o = current.open;
  panel.innerHTML = [
    `<b>Systole · проход 7</b> · ${st.scenario.title}`,
    `${fps} fps · срез: ${cut.mode}${clock.paused ? ' · пауза' : ` · ×${clock.speed}`} · сборка ${fmt(stats.buildMs, 0)} мс · ${fmt(stats.tris / 1000, 0)} k треугольников · программ ${engine.renderer.info.programs.length} · вызовов ${engine.renderer.info.render.calls}`,
    `ЛЖ полость ${fmt(stats.lvCavityMl, 0)} мл · ПЖ ${fmt(stats.rvCavityMl, 0)} мл · ЛП ${fmt(stats.laCavityMl, 0)} · ПП ${fmt(stats.raCavityMl, 0)}`,
    `${fmt(c.hr, 0)} уд/мин · удар ${current.beat.index} · RR ${fmt(c.rr, 0)} · t ${fmt(t, 0)} мс · ${c.phase(t)}`,
    `ЛЖ ${fmt(c.pLV(t), 0)} · Ао ${fmt(c.pAo(t), 0)} · ЛП ${fmt(c.pLA(t), 0)} мм рт. ст. · V ЛЖ ${fmt(c.lvVolume(t), 0)} мл · КДО ${fmt(c.lv.edv, 0)} · КСО ${fmt(c.lv.esv, 0)} · ФВ ${fmt(c.lv.ef * 100, 0)} %`,
    `МК ${fmt(o.mitral, 2)} · ТК ${fmt(o.tricuspid, 2)} · АК ${fmt(o.aortic, 2)} · ЛК ${fmt(o.pulmonary, 2)} · τ ${fmt(current.S.tau * 180 / Math.PI, 1)}° · ℓ ${fmt(current.S.ell * 100, 0)} % · s ${fmt(current.S.s, 2)}/${fmt(current.S.s2, 2)} · c ${fmt(current.S.c, 2)}/${fmt(current.S.c2, 2)}`,
    `слои: ${on} · ЭКГ ${fmt(c.ecg(t), 2)} мВ · QRS ${fmt(st.activation.stats.qrsDuration, 0)} мс · задержка боковой ${fmt(st.activation.stats.lateralDelay, 0)} мс · наведение ${ui.state.hover || '—'} · выбор ${ui.state.selected || '—'}`,
  ].map((s) => `<div>${s}</div>`).join('');
}

// --- Кадр -------------------------------------------------------------------
function frame() {
  engine.tick();
  ui.frame();
  if (dev) { frames++; const now = performance.now(); if (now - fpsT > 500) { fps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now; drawPanel(); } }
  requestAnimationFrame(frame);
}
if (dev) drawPanel();
frame();
