// engine.js — сцена и сердце без интерфейса. Строит геометрию, держит
// таймлайн, часы и текущее состояние, применяет сценарий (таймлайн, карта
// активации, зона гипокинеза, истончение) и обновляет униформы раз в кадр.
// Ничего не интегрируется: пауза и скраб в любую миллисекунду воспроизводимы.
import * as THREE from 'three';
import { createScene } from './scene.js';
import { makeMaterials, setDeformState, setDeformStatics, setXray, setGlowState } from './materials.js';
import { buildVentricles } from './geometry/ventricles.js';
import { buildAtria } from './geometry/atria.js';
import { buildVessels } from './geometry/vessels.js';
import { buildValves } from './geometry/valves.js';
import { buildCoronaries } from './geometry/coronaries.js';
import { CutController } from './cut.js';
import { GEOMETRY as G } from './physiology.js';
import { Timeline } from './timeline.js';
import { deformStatics, deformState } from './deform.js';
import { buildFlow } from './flow.js';
import { activationMap, ecgTables } from './conduction.js';
import { buildConductionTree } from './geometry/conductionTree.js';
import { SCENARIOS, scenarioByKey } from './content/scenarios.js';

export function createEngine({ canvas }) {
  const { renderer, scene, camera, controls, resize } = createScene(canvas);
  const listeners = {};
  const on = (ev, fn) => { (listeners[ev] ||= []).push(fn); return () => { listeners[ev] = listeners[ev].filter((f) => f !== fn); }; };
  const emit = (ev, ...a) => { for (const f of listeners[ev] || []) f(...a); };

  // --- Сердце ---------------------------------------------------------------
  const heart = new THREE.Group();
  heart.name = 'heart';
  scene.add(heart);
  const materials = makeMaterials();
  const t0 = performance.now();
  const ventricles = buildVentricles({ material: materials.myocardium });
  const atria = buildAtria({ material: materials.myocardium });
  const vessels = buildVessels({ materials });
  const valves = buildValves({ materials });
  const coronaries = buildCoronaries({ material: materials.coronary, occlusionMaterial: materials.occlusion });
  const flow = buildFlow({ vessels });
  const conductionTree = buildConductionTree();
  heart.add(ventricles.group, atria.group, vessels.group, valves.group, coronaries.group, flow.points, conductionTree.group);

  // Карта активации → атрибуты aAct/aClock; таблицы ЭКГ из той же карты. Кэш по параметрам.
  const atriaGrids = { la: atria.parts.la.grids, ra: atria.parts.ra.grids };
  const appendages = [{ name: 'laa', atrium: 'la', arrays: atria.parts.laa.arrays, start: atria.parts.laa.start }, { name: 'raa', atrium: 'ra', arrays: atria.parts.raa.arrays, start: atria.parts.raa.start }];
  const actCache = new Map();
  function activationFor(params) {
    const key = JSON.stringify(params);
    let a = actCache.get(key);
    if (!a) {
      const act = activationMap({ grids: ventricles.grids, atria: atriaGrids, appendages, params });
      a = { act, ecgTab: ecgTables({ grids: ventricles.grids, act, atria: atriaGrids }) };
      actCache.set(key, a);
    }
    return a;
  }
  function setAct(mesh, T, clock, constant) {
    const g = mesh.geometry, n = g.getAttribute('position').count;
    let act = g.getAttribute('aAct'), clk = g.getAttribute('aClock');
    if (!act) { act = new THREE.BufferAttribute(new Float32Array(n), 1); clk = new THREE.BufferAttribute(new Float32Array(n), 1); g.setAttribute('aAct', act); g.setAttribute('aClock', clk); }
    for (let k = 0; k < n; k++) { act.array[k] = constant !== undefined ? constant : (Number.isFinite(T[k]) ? T[k] : 1e4); clk.array[k] = clock; }
    act.needsUpdate = true; clk.needsUpdate = true;
  }
  function applyActivation(act) {
    for (const name of ['lvEndo', 'epi', 'rvEndo', 'ringA', 'ringB']) setAct(ventricles.meshes[name], act.vent[name], 0);
    for (const name of ['la', 'ra', 'laa', 'raa']) for (const side of ['outer', 'inner']) setAct(atria.parts[name].meshes[side], act.atr[name][side], 1);
    vessels.meshes.rvot.children.forEach((m) => setAct(m, null, 0, 70));
    setAct(valves.group.getObjectByName('rvDome'), null, 0, act.stats.lastVent);
  }
  const buildMs = performance.now() - t0;

  // Анатомическое положение: ось ЛЖ из основания (вверх-вправо-назад) к верхушке.
  const ORIENT = { apexDir: new THREE.Vector3(0.5, -0.78, 0.38).normalize(), rollDeg: 0 };
  function applyOrientation() {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), ORIENT.apexDir.clone().negate());
    const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(ORIENT.rollDeg));
    heart.quaternion.copy(q).multiply(roll);
    const c = new THREE.Vector3(0, G.lvLength * 0.7, 0).applyQuaternion(heart.quaternion);
    heart.position.copy(c).negate();
    heart.updateMatrixWorld(true);
  }
  applyOrientation();
  const cut = new CutController(renderer, heart, camera);
  const layers = { ventricles: ventricles.group, atria: atria.group, valves: valves.group, vessels: vessels.group, coronaries: coronaries.group, conduction: conductionTree.group, flow: flow.points };

  // --- Режимы слоёв ------------------------------------------------------------
  // Электрика: 0 — выкл, 1 — волна на миокарде, 2 — волна + дерево сквозь стенки.
  // Кровоток: 0 — выкл, 1 — частицы, 2 — рентген (ткань полупрозрачна).
  const modes = { ecg: 1, flow: 1 };
  function setEcgMode(m) { modes.ecg = m; conductionTree.group.visible = m > 0; conductionTree.setXray(m === 2); setGlowState({ t: 0, rr: 923, pOnset: 763, pqScale: 1, glow: m > 0 ? 1 : 0 }); emit('modes', modes); }
  function setFlowMode(m) { modes.flow = m; flow.points.visible = m > 0; setXray(materials, m === 2); emit('modes', modes); }

  // --- Сценарий, таймлайн, часы -------------------------------------------------
  const clock = { T: 0, speed: 1, paused: false, last: performance.now() };
  const current = { cycle: null, t: 0, beat: null, S: null, open: null, events: [] };
  const state = { scenario: null, timeline: null, U: null, activation: null, ecgTab: null, text: '' };

  function applyScenario(key, { hr, seed } = {}) {
    const sc = scenarioByKey(key);
    const { act, ecgTab } = activationFor(sc.conduction);
    applyActivation(act);
    const mech = sc.mech;
    const zone = mech.zone ? { ...mech.zone, thetaC: mech.zone.thetaC === 'lateral' ? act.stats.thetaLateral : mech.zone.thetaC } : null;
    const U = deformStatics({ zone, hypo: mech.hypo || 0, delay: mech.dyssync ? act.stats.lateralDelay : 0, wallThin: mech.wallThin || 0 });
    setDeformStatics(U);
    coronaries.group.getObjectByName('occlusion').visible = !!mech.occlusion;
    const timeline = new Timeline({ ...sc.timeline, hr: hr || sc.timeline.hr, seed: seed || sc.timeline.seed || 1, params: sc.cycle });
    timeline.onCycle = (c) => c.attachEcg(ecgTab);
    for (const c of timeline.cycles.values()) c.attachEcg(ecgTab);
    Object.assign(state, { scenario: sc, timeline, U, activation: act, ecgTab });
    const c0 = timeline.cycleFor(timeline.beats[0].rr);
    state.text = sc.text({ c: c0, act, sc });
    clock.T = 0;
    applyState();
    emit('scenario', state);
  }

  function applyState() {
    const { cycle, t, beat } = state.timeline.at(clock.T);
    const S = deformState(cycle, t, state.U);
    setDeformState(S);
    const open = cycle.valves(t);
    valves.valves.mitral.setOpen(open.mitral);
    valves.valves.tricuspid.setOpen(open.tricuspid);
    valves.valves.aortic.setOpen(open.aortic);
    valves.valves.pulmonary.setOpen(open.pulmonary);
    flow.update(cycle, t, beat);
    setGlowState({ t, rr: cycle.rr, pOnset: cycle.times.pOnset, pqScale: cycle.pqScale });
    if (cycle !== current.cycle) current.events = [...cycle.events, ...state.scenario.notes(cycle, state.activation)].sort((a, b) => a.t - b.t);
    Object.assign(current, { cycle, t, beat, S, open });
  }
  // Абсолютное время (мс) — скраб и снимки по фазам. Ставит на паузу.
  function setTime(T) { clock.T = Math.max(0, T); clock.paused = true; applyState(); }
  // Время внутри текущего удара.
  function setCycleTime(t) { setTime(current.beat.t0 + t); }
  function setPaused(p) { clock.paused = p; clock.last = performance.now(); }
  function setSpeed(s) { clock.speed = s; }

  // Кадр: продвинуть часы, применить состояние, отрисовать.
  function tick() {
    const now = performance.now();
    if (!clock.paused) clock.T += Math.min(100, now - clock.last) * clock.speed;
    clock.last = now;
    applyState();
    resize();
    controls.update();
    cut.update();
    renderer.render(scene, camera);
  }

  // Снимок в файл через dev-сервер: engine.shot('front', 1600, 1000) → POST /shot.
  async function shot(name = 'shot', w = 1600, h = 1000) {
    const size = renderer.getSize(new THREE.Vector2()), pr = renderer.getPixelRatio(), aspect = camera.aspect;
    renderer.setPixelRatio(1); renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    applyState(); cut.update(); renderer.render(scene, camera);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    renderer.setPixelRatio(pr); renderer.setSize(size.x, size.y, false);
    camera.aspect = aspect; camera.updateProjectionMatrix();
    const res = await fetch('shot?name=' + encodeURIComponent(name), { method: 'POST', body: blob });
    return res.text();
  }

  let tris = 0;
  scene.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.getAttribute('position').count) / 3; });

  return {
    renderer, scene, camera, controls, heart, materials, ventricles, atria, vessels, valves, coronaries, flow, conductionTree,
    cut, layers, modes, clock, current, state, ORIENT, applyOrientation, THREE,
    stats: { ...ventricles.stats, ...atria.stats, buildMs, tris },
    scenarios: SCENARIOS,
    on, applyScenario, applyState, setTime, setCycleTime, setPaused, setSpeed, setEcgMode, setFlowMode, tick, shot,
    get timeline() { return state.timeline; }, get activation() { return state.activation; }, get ecgTab() { return state.ecgTab; }, get U() { return state.U; },
  };
}
