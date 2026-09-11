// wiggers.js — диаграмма Виггерса под сценой: фазы, ЭКГ, давления левых
// (и по флагу правых) отделов, объём ЛЖ, тоны, клапаны, ось времени в мс
// от начала QRS. Фон рисуется один раз на цикл (кэш по циклу и размеру),
// курсор и текущие значения — каждый кадр. Клик и протяжка — скраб.
const C = {
  ecg: '#a8e4ff', ao: '#e0574d', lv: '#f2c3b0', la: '#7f8fc9', rv: '#d9a08f', pa: '#9aa8dc', ra: '#b7c2ea',
  vol: '#e9e2d4', grid: 'rgba(255,255,255,0.07)', text: 'rgba(232,224,220,0.7)', dim: 'rgba(232,224,220,0.45)',
  valves: { mitral: '#d9c9b4', tricuspid: '#b8ae9c', aortic: '#e0574d', pulmonary: '#7f8fc9' },
};
const FONT = '11px "IBM Plex Sans", system-ui, sans-serif';
const GUTTER_L = 70, GUTTER_R = 56;

export class Wiggers {
  constructor(canvas, engine, ui) {
    this.canvas = canvas; this.engine = engine; this.ui = ui;
    this.ctx = canvas.getContext('2d');
    this.bg = document.createElement('canvas');
    this.key = null; this.w = 0; this.h = 0; this.dpr = 1;
    this.dragging = false;
    const scrub = (e) => { const r = canvas.getBoundingClientRect(); const x = (e.clientX - r.left - GUTTER_L) / (r.width - GUTTER_L - GUTTER_R); engine.setCycleTime(Math.min(1, Math.max(0, x)) * engine.current.cycle.rr); };
    canvas.addEventListener('pointerdown', (e) => { this.dragging = true; canvas.setPointerCapture(e.pointerId); scrub(e); });
    canvas.addEventListener('pointermove', (e) => { if (this.dragging) scrub(e); });
    canvas.addEventListener('pointerup', (e) => { this.dragging = false; canvas.releasePointerCapture(e.pointerId); });
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr), h = Math.floor(this.canvas.clientHeight * dpr);
    if (w !== this.w || h !== this.h || dpr !== this.dpr) {
      this.w = w; this.h = h; this.dpr = dpr;
      this.canvas.width = w; this.canvas.height = h; this.bg.width = w; this.bg.height = h;
      this.key = null;
    }
  }

  // Раскладка строк в CSS-пикселях.
  _layout(right) {
    const H = this.h / this.dpr, W = this.w / this.dpr;
    const rows = [['phase', 16], ['ecg', 0.18], ['pressure', 0.32], ...(right ? [['right', 0.16]] : []), ['volume', 0.14], ['sounds', 14], ['valves', 0.22], ['axis', 16]];
    const fixed = rows.filter((r) => r[1] > 1).reduce((a, r) => a + r[1], 0), flex = H - fixed - 6;
    const L = {}; let y = 2;
    for (const [name, size] of rows) { const hh = size > 1 ? size : size * flex / rows.filter((r) => r[1] <= 1).reduce((a, r) => a + r[1], 0); L[name] = [y, y + hh]; y += hh; }
    return { L, W, H, x0: GUTTER_L, x1: W - GUTTER_R };
  }

  _renderBg(c, right, events) {
    const g = this.bg.getContext('2d'); g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const { L, W, H, x0, x1 } = this._layout(right);
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(19, 10, 14, 0.92)'; g.fillRect(0, 0, W, H);
    const x = (t) => x0 + (c.wrap(t) / c.rr) * (x1 - x0);
    const band = (name, lo, hi) => { const [y0, y1] = L[name]; return (v) => y1 - 3 - ((v - lo) / (hi - lo)) * (y1 - y0 - 6); };
    g.font = FONT; g.textBaseline = 'middle';
    const label = (name, text, color = C.text) => { g.fillStyle = color; g.textAlign = 'left'; g.fillText(text, 8, (L[name][0] + L[name][1]) / 2); };
    const hline = (y) => { g.strokeStyle = C.grid; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); };
    const curve = (f, y, color, width = 1.4) => { g.strokeStyle = color; g.lineWidth = width; g.beginPath(); for (let i = 0; i <= x1 - x0; i += 1) { const t = (i / (x1 - x0)) * c.rr; const yy = y(f(t)); if (i === 0) g.moveTo(x0 + i, yy); else g.lineTo(x0 + i, yy); } g.stroke(); };
    const tickR = (name, v, y, text) => { g.fillStyle = C.dim; g.textAlign = 'left'; g.fillText(text, x1 + 6, y(v)); };
    // Легенда в одну строку разными цветами.
    const legend = (items, y) => { let xx = 8; g.textAlign = 'left'; for (const [color, text] of items) { g.fillStyle = color; g.fillText(text, xx, y); xx += g.measureText(text).width + 8; } };

    // Ось времени и линии событий.
    const [ya0, ya1] = L.axis;
    g.fillStyle = C.dim; g.textAlign = 'center';
    for (let t = 0; t <= c.rr; t += 100) { const xx = x(t); g.strokeStyle = C.grid; g.beginPath(); g.moveTo(xx, L.ecg[0]); g.lineTo(xx, ya0); g.stroke(); g.fillText(String(t), xx, (ya0 + ya1) / 2); }
    g.textAlign = 'left'; g.fillText('мс', x1 + 6, (ya0 + ya1) / 2);
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    for (const e of events) { const xx = x(e.t); g.beginPath(); g.moveTo(xx, L.phase[1]); g.lineTo(xx, ya0); g.stroke(); }

    // Фазы: подписи между границами.
    const bounds = [0, c.times.tMc, c.times.tAo, c.times.tAc, c.times.tMo, c.times.eEnd, c.times.aStart, c.rr].filter((t, i, a) => t >= 0 && t <= c.rr && a.indexOf(t) === i).sort((a, b) => a - b);
    g.fillStyle = C.text; g.textAlign = 'center';
    for (let i = 0; i + 1 < bounds.length; i++) {
      const t0 = bounds[i], t1 = bounds[i + 1]; if (t1 - t0 < 1) continue;
      const name = c.phase((t0 + t1) / 2), wpx = x(t1) - x(t0), tw = g.measureText(name).width;
      if (tw + 8 < wpx) g.fillText(name, (x(t0) + x(t1)) / 2, (L.phase[0] + L.phase[1]) / 2);
      else if (wpx > 14) { const short = { 'Изоволюмическое сокращение': 'ИВС', 'Изгнание': 'Изгн.', 'Изоволюмическое расслабление': 'ИВР', 'Быстрое наполнение': 'E', 'Диастазис': '', 'Систола предсердий': 'A', 'Наполнение (E и A слиты)': 'E+A' }[name] ?? ''; if (short) g.fillText(short, (x(t0) + x(t1)) / 2, (L.phase[0] + L.phase[1]) / 2); }
    }

    // ЭКГ.
    const yE = band('ecg', -0.5, 1.4);
    hline(yE(0)); curve(c.ecg, yE, C.ecg, 1.3); label('ecg', 'ЭКГ, II'); tickR('ecg', 1, yE, '1 мВ');

    // Давления левых отделов.
    const yP = band('pressure', 0, 130);
    for (const p of [0, 40, 80, 120]) { hline(yP(p)); tickR('pressure', p, yP, String(p)); }
    curve(c.pAo, yP, C.ao); curve(c.pLV, yP, C.lv); curve(c.pLA, yP, C.la);
    g.textAlign = 'left'; g.fillStyle = C.text; g.fillText('мм рт. ст.', 8, L.pressure[0] + 9);
    legend([[C.ao, 'аорта'], [C.lv, 'ЛЖ'], [C.la, 'ЛП']], L.pressure[0] + 23);

    // Правые отделы.
    if (right) {
      const yR = band('right', 0, 40);
      for (const p of [0, 20, 40]) { hline(yR(p)); tickR('right', p, yR, String(p)); }
      curve(c.pPA, yR, C.pa); curve(c.pRV, yR, C.rv); curve(c.pRA, yR, C.ra);
      legend([[C.pa, 'ЛА'], [C.rv, 'ПЖ'], [C.ra, 'ПП']], (L.right[0] + L.right[1]) / 2);
    }

    // Объём ЛЖ: диапазон по сценарию.
    const vLo = Math.floor((c.lv.esv - 15) / 10) * 10, vHi = Math.ceil((c.lv.edv + 15) / 10) * 10;
    const yV = band('volume', vLo, vHi);
    for (const v of [c.lv.esv, c.lv.edv]) { hline(yV(v)); tickR('volume', v, yV, `${Math.round(v)}`); }
    curve(c.lvVolume, yV, C.vol); label('volume', 'V ЛЖ, мл');

    // Тоны.
    const [ys0, ys1] = L.sounds; label('sounds', 'Тоны');
    g.fillStyle = C.text; g.textAlign = 'center';
    for (const [t, name] of [[c.times.tMc, 'S1'], [c.times.tAc, 'A2'], [c.times.tPc, 'P2']]) { const xx = x(t); g.fillRect(xx - 1, ys0 + 2, 2, ys1 - ys0 - 4); g.fillText(name, xx + (name === 'A2' ? -9 : name === 'P2' ? 9 : 0), (ys0 + ys1) / 2); }

    // Клапаны: высота полосы = степень раскрытия.
    const [yk0, yk1] = L.valves, names = ['mitral', 'tricuspid', 'aortic', 'pulmonary'], ru = ['МК', 'ТК', 'АК', 'ЛК'];
    const rowH = (yk1 - yk0) / 4;
    names.forEach((n, k) => {
      const y0 = yk0 + k * rowH;
      g.fillStyle = C.valves[n];
      for (let i = 0; i < x1 - x0; i += 1) { const t = (i / (x1 - x0)) * c.rr; const o = c.valves(t)[n]; if (o > 0.01) g.fillRect(x0 + i, y0 + (rowH - 1) * (1 - o), 1, (rowH - 1) * o); }
      g.fillStyle = C.dim; g.textAlign = 'left'; g.font = '9px "IBM Plex Sans", system-ui, sans-serif'; g.fillText(ru[k], 8, y0 + rowH / 2); g.font = FONT;
    });
    this._L = { L, x, yE, yP, yV, x0, x1, W, H };
  }

  draw(cycle, t, events) {
    this._resize();
    if (this.w < 8 || this.h < 8) return;
    const right = !!this.ui.state.rightPressures;
    const key = `${cycle.rr}|${cycle.hr}|${right}|${this.w}x${this.h}|${events.length}`;
    if (key !== this.key || this._cycle !== cycle) { this.key = key; this._cycle = cycle; this._renderBg(cycle, right, events); }
    const g = this.ctx; g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const { L, x, yE, yP, yV, x1, W, H } = this._L;
    g.clearRect(0, 0, W, H); g.drawImage(this.bg, 0, 0, this.bg.width, this.bg.height, 0, 0, W, H);
    const xx = x(t);
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1; g.beginPath(); g.moveTo(xx, L.phase[1]); g.lineTo(xx, L.axis[0]); g.stroke();
    // Текущие значения точками на кривых.
    const dot = (yy, color) => { g.fillStyle = color; g.beginPath(); g.arc(xx, yy, 2.5, 0, Math.PI * 2); g.fill(); };
    dot(yE(cycle.ecg(t)), C.ecg); dot(yP(cycle.pAo(t)), C.ao); dot(yP(cycle.pLV(t)), C.lv); dot(yP(cycle.pLA(t)), C.la); dot(yV(cycle.lvVolume(t)), C.vol);
    g.font = FONT; g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillStyle = 'rgba(232,224,220,0.95)';
    g.fillText(`${Math.round(cycle.wrap(t))} мс`, Math.min(Math.max(xx, 40), x1 - 20), L.axis[1] - 9);
  }
}
