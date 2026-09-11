// keys.js — клавиши. Пробел — пауза; ← → — ±10 мс (с Shift ±1); - = —
// скорость; 1–6 — сценарий; B — кровоток; E — электрика; C — срез; [ ] —
// уровень; F — сторона; L — подписи; H — полоса Виггерса; W — каркас;
// A V K O M — слои; R — вид; Esc — снять выбор.
export function mountKeys(engine, ui, controls) {
  let wire = false;
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const { clock, layers, cut, materials, camera, controls: orbit } = engine;
    const speeds = [0.1, 0.25, 0.5, 1];
    switch (e.key) {
      case ' ': engine.setPaused(!clock.paused); e.preventDefault(); break;
      case 'ArrowLeft': engine.setTime(clock.T - (e.shiftKey ? 1 : 10)); break;
      case 'ArrowRight': engine.setTime(clock.T + (e.shiftKey ? 1 : 10)); break;
      case '-': engine.setSpeed(speeds[Math.max(0, speeds.indexOf(clock.speed) - 1)] ?? 0.1); break;
      case '=': case '+': engine.setSpeed(speeds[Math.min(speeds.length - 1, speeds.indexOf(clock.speed) + 1)] ?? 1); break;
      case '1': case '2': case '3': case '4': case '5': case '6': engine.applyScenario(engine.scenarios[Number(e.key) - 1].key); break;
      case 'b': case 'B': engine.setFlowMode((engine.modes.flow + 1) % 3); layers.flow.visible = engine.modes.flow > 0; break;
      case 'e': case 'E': engine.setEcgMode((engine.modes.ecg + 1) % 3); break;
      case 'c': case 'C': cut.cycleMode(); break;
      case '[': cut.moveLevel(-0.5); break;
      case ']': cut.moveLevel(0.5); break;
      case 'f': case 'F': cut.flip = !cut.flip; break;
      case 'l': case 'L': ui.state.labels = !ui.state.labels; ui.emit('options'); break;
      case 'h': case 'H': ui.state.wiggers = !ui.state.wiggers; ui.emit('options'); break;
      case 'w': case 'W': wire = !wire; Object.values(materials).forEach((m) => { m.wireframe = wire; }); break;
      case 'a': case 'A': layers.atria.visible = !layers.atria.visible; break;
      case 'v': case 'V': layers.vessels.visible = !layers.vessels.visible; break;
      case 'k': case 'K': layers.valves.visible = !layers.valves.visible; break;
      case 'o': case 'O': layers.coronaries.visible = !layers.coronaries.visible; break;
      case 'm': case 'M': layers.ventricles.visible = !layers.ventricles.visible; break;
      case 'r': case 'R': camera.position.set(0, 3, 40); orbit.target.set(0, 0, 0); break;
      case 'Escape': ui.select(null); break;
      case ',': engine.ORIENT.rollDeg -= 5; engine.applyOrientation(); break;
      case '.': engine.ORIENT.rollDeg += 5; engine.applyOrientation(); break;
      default: return;
    }
    controls.sync();
  });
}
