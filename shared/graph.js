// @ts-check
/* DRS Econ Arcade — the drag-graph engine. One SVG, one hit plane, five markets as data.
   Sections: constants · markets · pure math · svg helpers · Gauge · create().
   Nothing here touches the DOM at load: intersect/outputs/classify are pure, so the whole
   file loads under `node --test`, and create()/Gauge only run in a browser. */
var ArcadeGraph = (function () {
  'use strict';

  /* ===== CONSTANTS — both axes run 0-100 in graph units ===== */

  var SNAP = 12;      // where a recognised shift lands, measured from where the drag began
  var CLAMP = 25;     // how far a curve may travel from its market position
  var DEAD = 8;       // a drag shorter than this meant nothing
  var HIT = 8.3;      // how near a finger must pass a curve to grab it (24 px)
  var DOT_HIT = 7;    // how near a finger must land on the equilibrium dot to grab it
  var ZONE_BAND = 60;   // the "at full employment" tap band, in svg units, when `none` is the right
                        // answer: ~48 css px, so the intended target obeys the mobile tap rule.
  var ZONE_WITH_GAP = 0;// ...and nothing at all once a gap is on screen: `none` is never the right
                        // answer then, so left and right meet exactly at the line and a tap pressed
                        // against it still answers with the gap's own side instead of costing a
                        // heart. Only this invisible band changes; the LRAS line never moves.

  var VB = 360;                   // the graph svg is a 360-unit square
  var PLOT_X = 48, PLOT_Y = 16;   // the plot's top-left corner inside it
  var PLOT = 290;                 // the plot is 290 x 290
  var K = PLOT / 100;             // 2.9 svg units per graph unit
  var G_CX = 60, G_CY = 50, G_R = 34, G_A0 = -135, G_ARC = 270;  // one gauge dial
  var GAUGE_W = 120, GAUGE_H = 90;
  var NS = 'http://www.w3.org/2000/svg';
  var SEQ = 0;        // makes each mounted graph's clip-path id unique

  /* ===== MARKETS — every curve is `y = m(x - shift) + b`, or vertical at `x0 + shift`.
     `shift` is the only mutable field, and it lives in the engine, never in this table. ===== */

  var MARKETS = {
    adas: {
      xLabel: 'Real GDP', yLabel: 'Price Level', xTick: { at: 'LRAS', text: 'Yf' },
      curves: {
        AD: { m: -1, b: 100, draggable: true },
        SRAS: { m: 1, b: 0, draggable: true },
        LRAS: { vertical: true, x0: 50, draggable: false }
      },
      eq: ['AD', 'SRAS'], ref: 'LRAS',
      out: function (eq) {
        return { PL: 100 + 0.8 * (eq.y - 50), Y: 100 + 0.8 * (eq.x - 50), gap: 0.8 * (eq.x - 50), u: 6 - 0.5 * (0.8 * (eq.x - 50)) };
      },
      gauges: [
        { id: 'PL', label: 'Price Level', min: 88, max: 112, from: 'PL', decimals: 1 },
        { id: 'Y', label: 'Real GDP', min: 88, max: 112, from: 'Y', ref: 100, refLabel: 'Yf', decimals: 1 },
        { id: 'u', label: 'Unemployment', min: 0, max: 12, from: 'u', unit: '%', ref: 6, refLabel: 'u*', decimals: 1 }
      ]
    },
    money: {
      xLabel: 'Quantity of money', yLabel: 'Nominal interest rate',
      curves: { MS: { vertical: true, x0: 50, draggable: true }, MD: { m: -1, b: 100, draggable: true } },
      eq: ['MS', 'MD'],
      out: function (eq) { return { i: eq.y / 10, Qm: eq.x }; },
      gauges: [{ id: 'i', label: 'Nominal i', min: 0, max: 10, from: 'i', unit: '%', decimals: 1 }]
    },
    lf: {
      xLabel: 'Quantity of loanable funds', yLabel: 'Real interest rate',
      curves: { S: { m: 1, b: 0, draggable: true }, D: { m: -1, b: 100, draggable: true } },
      eq: ['S', 'D'],
      out: function (eq) { return { r: eq.y / 10, Q: eq.x }; },
      gauges: [{ id: 'r', label: 'Real r', min: 0, max: 10, from: 'r', unit: '%', decimals: 1 }]
    },
    forex: {
      xLabel: 'Quantity of dollars', yLabel: 'Price of $ (in foreign currency)',
      curves: { S: { m: 1, b: 0, draggable: true, label: 'S$' }, D: { m: -1, b: 100, draggable: true, label: 'D$' } },
      eq: ['S', 'D'],
      out: function (eq) { return { e: 100 + 0.8 * (eq.y - 50), Q: eq.x }; },
      gauges: [{ id: 'e', label: 'Price of $', min: 88, max: 112, from: 'e', decimals: 1 }]
    },
    phillips: {
      xLabel: 'Unemployment rate (u%)', yLabel: 'Inflation rate (π%)',
      curves: { SRPC: { m: -1, b: 100, draggable: true }, LRPC: { vertical: true, x0: 60, draggable: false } },
      eq: null, point: { curve: 'SRPC', x: 60 },
      out: function (p) { return { pi: p.y / 10, u: p.x / 10 }; },
      gauges: [
        { id: 'pi', label: 'Inflation', min: 0, max: 10, from: 'pi', unit: '%', decimals: 1 },
        { id: 'u', label: 'Unemployment', min: 0, max: 10, from: 'u', unit: '%', decimals: 1 }
      ]
    }
  };

  /* ===== PURE MATH — no DOM below this line until the svg helpers ===== */

  /** @param {number} v @param {number} lo @param {number} hi @returns {number} */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /** @param {any} market a MARKETS key or a market object @returns {any} */
  function marketOf(market) { return typeof market === 'string' ? MARKETS[market] : market; }

  /** @param {any} shifts @param {string} name @returns {number} a curve left out has not moved */
  function shiftOf(shifts, name) {
    return shifts && typeof shifts[name] === 'number' ? shifts[name] : 0;
  }

  /** @param {any} c a non-vertical curve @param {number} x @param {number} s @returns {number} */
  function lineY(c, x, s) { return c.m * (x - s) + c.b; }

  /** Where a market's two curves cross, given how far each has been dragged.
   *  @param {any} market a MARKETS key or object @param {Object<string, number>} shifts
   *  @returns {{x:number, y:number}|null} null for a market read at a point, not a crossing */
  function intersect(market, shifts) {
    var mk = marketOf(market);
    if (!mk || !mk.eq) return null;
    var n1 = mk.eq[0], n2 = mk.eq[1];
    var c1 = mk.curves[n1], c2 = mk.curves[n2];
    var s1 = shiftOf(shifts, n1), s2 = shiftOf(shifts, n2);
    if (c1.vertical || c2.vertical) {
      var vert = c1.vertical ? c1 : c2, sv = c1.vertical ? s1 : s2;
      var slope = c1.vertical ? c2 : c1, ss = c1.vertical ? s2 : s1;
      var xv = vert.x0 + sv;
      return { x: xv, y: lineY(slope, xv, ss) };
    }
    var x = (c1.m * s1 - c2.m * s2 + c2.b - c1.b) / (c1.m - c2.m);
    return { x: x, y: lineY(c1, x, s1) };
  }

  /** What the market reads off its dot: price level, rate, gap — whatever it defines.
   *  @param {any} market @param {{x:number, y:number}} eq @returns {Object<string, number>} */
  function outputs(market, eq) { return marketOf(market).out(eq); }

  /** What a finished drag meant. A curve drag reads as a shift left or right, a dot drag as a
   *  movement up or down along the curve, and anything inside the deadzone as nothing.
   *  @param {{kind?:string, curve?:string, startShift?:number, shift?:number,
   *           x0?:number, y0?:number, x?:number, y?:number}} drag
   *  @returns {{kind:string, curve:string|null, dir:string|null, magnitude:number}} */
  function classify(drag) {
    var d = drag || {};
    var curve = d.curve === undefined ? null : d.curve;
    if (d.kind === 'curve') {
      var moved = (d.shift || 0) - (d.startShift || 0);
      if (Math.abs(moved) < DEAD) return { kind: 'none', curve: curve, dir: null, magnitude: Math.abs(moved) };
      return { kind: 'shift', curve: curve, dir: moved > 0 ? 'R' : 'L', magnitude: Math.abs(moved) };
    }
    if (d.kind === 'dot') {
      var slid = (d.x || 0) - (d.x0 || 0);
      if (Math.abs(slid) < DEAD) return { kind: 'none', curve: curve, dir: null, magnitude: Math.abs(slid) };
      return { kind: 'move', curve: curve, dir: (d.y || 0) > (d.y0 || 0) ? 'up' : 'down', magnitude: Math.abs(slid) };
    }
    return { kind: 'none', curve: null, dir: null, magnitude: 0 };
  }

  /** Perpendicular distance from a point to a curve, in graph units — the whole hit test.
   *  @param {any} c @param {number} s @param {number} x @param {number} y @returns {number} */
  function distanceTo(c, s, x, y) {
    if (c.vertical) return Math.abs(x - (c.x0 + s));
    return Math.abs(c.m * x - y + c.b - c.m * s) / Math.sqrt(c.m * c.m + 1);
  }

  /** The stretch of a curve that is actually inside the 0-100 box.
   *  @param {any} c @param {number} s @returns {{lo:number, hi:number}|null} */
  function xRange(c, s) {
    if (c.vertical) {
      var xv = c.x0 + s;
      return xv < 0 || xv > 100 ? null : { lo: xv, hi: xv };
    }
    var atBottom = s - c.b / c.m, atTop = s + (100 - c.b) / c.m;
    var lo = Math.max(0, Math.min(atBottom, atTop));
    var hi = Math.min(100, Math.max(atBottom, atTop));
    return lo > hi ? null : { lo: lo, hi: hi };
  }

  /* ===== SVG HELPERS ===== */

  /** @param {number} v @returns {number} two decimals is plenty inside a 360-unit box */
  function n2(v) { return Math.round(v * 100) / 100; }
  /** @param {number} x @returns {number} graph units to svg x inside `g.plot` */
  function gx(x) { return x * K; }
  /** @param {number} y @returns {number} graph units to svg y inside `g.plot` */
  function gy(y) { return PLOT - y * K; }
  /** @param {any} node @param {string} name @param {any} value */
  function attr(node, name, value) { node.setAttribute(name, String(value)); }

  /** @param {any} node @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 */
  function line2(node, x1, y1, x2, y2) {
    attr(node, 'x1', n2(x1)); attr(node, 'y1', n2(y1));
    attr(node, 'x2', n2(x2)); attr(node, 'y2', n2(y2));
  }

  /** @param {string} tag @param {Object<string, any>} [attrs] @param {string} [cls] @returns {any} */
  function el(tag, attrs, cls) {
    var node = document.createElementNS(NS, tag);
    if (cls) node.setAttribute('class', cls);
    for (var k in attrs || {}) if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, String(attrs[k]));
    return node;
  }

  /** @param {number} x @param {number} y @param {string} str @param {string} cls @param {string} [anchor]
   *  @returns {any} */
  function textEl(x, y, str, cls, anchor) {
    var t = el('text', { x: n2(x), y: n2(y), 'text-anchor': anchor || 'middle' }, cls);
    t.textContent = str;
    return t;
  }

  /** @returns {any} shared/arcade.js, or null under `node --test` */
  function engine() { return typeof Arcade !== 'undefined' ? Arcade : null; }

  /** Every animation runs through here, so reduced motion is Arcade's problem, handled once.
   *  @param {number} from @param {number} to @param {(v:number) => void} onUpdate
   *  @param {string} preset an Arcade.SPRING name @param {() => void} [onDone]
   *  @returns {{cancel:() => void, finish:() => void}} */
  function spring(from, to, onUpdate, preset, onDone) {
    var A = engine();
    if (!A) {
      onUpdate(to);
      if (onDone) onDone();
      return { cancel: function () { }, finish: function () { } };
    }
    var p = A.SPRING[preset] || A.SPRING.snap;
    return A.spring(from, to, onUpdate, { stiffness: p.stiffness, ratio: p.ratio, onDone: onDone });
  }

  /* ===== GAUGE — a 270-degree dial in a 120x90 cell ===== */

  /** @param {number} deg 0 is twelve o'clock, positive is clockwise @param {number} r
   *  @returns {{x:number, y:number}} */
  function dial(deg, r) {
    var rad = deg * Math.PI / 180;
    return { x: G_CX + r * Math.sin(rad), y: G_CY - r * Math.cos(rad) };
  }

  /** @param {number} a1 @param {number} a2 @param {number} r @returns {string} */
  function arcPath(a1, a2, r) {
    var p1 = dial(a1, r), p2 = dial(a2, r);
    if (Math.abs(a2 - a1) < 0.01) return 'M ' + n2(p1.x) + ' ' + n2(p1.y);
    return 'M ' + n2(p1.x) + ' ' + n2(p1.y) + ' A ' + r + ' ' + r + ' 0 ' +
      (Math.abs(a2 - a1) > 180 ? 1 : 0) + ' ' + (a2 > a1 ? 1 : 0) + ' ' + n2(p2.x) + ' ' + n2(p2.y);
  }

  /** One dial. The ref tick crosses the arc but stops short of the gauge's name above it; the value
   *  sits under the dial, the one place in a 120x90 cell no needle can cross, and the reference's
   *  name sits smaller and gold on the cell's last line, clear of the value's digits.
   *  @param {any} gEl an `<g class="gauge">` to draw into
   *  @param {{id?:string, label?:string, min?:number, max?:number, value?:number, unit?:string,
   *           ref?:number, refLabel?:string, zones?:{from:number, to:number, color:string}[],
   *           decimals?:number}} [opts]
   *  @constructor */
  function Gauge(gEl, opts) {
    var o = opts || {};
    var self = this;
    this.el = gEl;
    this.id = o.id || '';
    this.min = o.min === undefined ? 0 : o.min;
    this.max = o.max === undefined ? 100 : o.max;
    this.unit = o.unit || '';
    this.decimals = o.decimals === undefined ? 0 : o.decimals;
    this.value = clamp(o.value === undefined ? this.min : o.value, this.min, this.max);
    /** @type {any} */ this.anim = null;

    gEl.appendChild(el('path', { d: arcPath(G_A0, G_A0 + G_ARC, G_R) }, 'gauge-arc'));
    (o.zones || []).forEach(function (z) {
      var band = el('path', { d: arcPath(self.angle(z.from), self.angle(z.to), G_R) }, 'gauge-arc');
      band.style.stroke = z.color;
      gEl.appendChild(band);
    });
    this.fill = el('path', {}, 'gauge-fill');
    gEl.appendChild(this.fill);
    if (typeof o.ref === 'number') {
      var inner = dial(this.angle(o.ref), 26), outer = dial(this.angle(o.ref), 36);
      var tick = el('line', {}, 'gauge-ref');
      line2(tick, inner.x, inner.y, outer.x, outer.y);
      gEl.appendChild(tick);
      gEl.appendChild(textEl(G_CX, GAUGE_H - 2, o.refLabel || String(o.ref), 'gauge-reflabel'));
    }
    this.needle = el('line', { x1: G_CX, y1: G_CY, x2: G_CX, y2: G_CY }, 'gauge-needle');
    gEl.appendChild(this.needle);
    this.valText = textEl(G_CX, 78, '', 'gauge-val');
    gEl.appendChild(this.valText);
    gEl.appendChild(textEl(G_CX, 10, o.label || '', 'gauge-label'));
    this.paint(this.value);
  }

  /** @param {number} v @returns {number} degrees on the dial */
  Gauge.prototype.angle = function (v) {
    var span = this.max - this.min;
    return G_A0 + G_ARC * (span === 0 ? 0 : (clamp(v, this.min, this.max) - this.min) / span);
  };

  /** @param {number} v */
  Gauge.prototype.paint = function (v) {
    var a = this.angle(v);
    attr(this.fill, 'd', arcPath(G_A0, a, G_R));
    var tip = dial(a, 24);
    attr(this.needle, 'x2', n2(tip.x));
    attr(this.needle, 'y2', n2(tip.y));
    this.valText.textContent = v.toFixed(this.decimals) + this.unit;
  };

  /** @param {number} v @param {{animate?:boolean, preset?:string}} [opts] */
  Gauge.prototype.set = function (v, opts) {
    var o = opts || {};
    var self = this;
    var to = clamp(v, this.min, this.max);
    if (this.anim) { this.anim.cancel(); this.anim = null; }
    if (o.animate === false) { this.value = to; this.paint(to); return; }
    var landed = false;
    var handle = spring(this.value, to, function (x) {
      self.value = clamp(x, self.min, self.max);
      self.paint(self.value);
    }, o.preset || 'consequence', function () { landed = true; self.anim = null; });
    this.anim = landed ? null : handle;   // a reduced-motion spring is already done by now
  };

  /** @param {string} [color] the flash-* suffix; 'red' is the only one the stylesheet paints */
  Gauge.prototype.flash = function (color) {
    var A = engine();
    if (A) A.flash(this.el, 'flash-' + (color || 'red'), 300);
  };

  /* ===== CREATE — the live graph ===== */

  /** Mount a draggable market graph.
   *  @param {any} mount the element the svg goes into, usually `.graph-wrap`
   *  @param {{market?:string, gauges?:any, show?:Object<string, boolean>}} [opts]
   *    `gauges`: the element to draw the gauge strip into, or true to append it to `mount`.
   *    `show`: preset curve visibility, e.g. `{LRAS:false}`.
   *  @returns {any} the graph API */
  function create(mount, opts) {
    if (typeof document === 'undefined') throw new Error('ArcadeGraph.create needs a browser');
    var o = opts || {};
    var market = marketOf(o.market || 'adas');
    var names = Object.keys(market.curves);
    var uid = 'arcade-plot-' + (SEQ += 1);

    /* --- state --- */
    /** @type {Object<string, number>} */ var shifts = {};
    /** @type {Object<string, number>} */ var cardStart = {};
    /** @type {Object<string, boolean>} */ var visible = {};
    /** @type {Object<string, boolean>} */ var accepted = {};
    /** @type {{curve:string, x:number}|null} */ var point = null;
    /** @type {string[]} */ var draggable = [];
    /** @type {Object<string, Function[]>} */ var listeners = {};
    /** @type {any} */ var drag = null;
    /** @type {any} */ var anim = null;
    /** @type {(() => void)|null} */ var animResolve = null;
    /** @type {any} */ var settle = null;
    var locked = false, gapMode = false, gapAnswered = false, shadeOn = false;

    names.forEach(function (n) {
      shifts[n] = 0;
      cardStart[n] = 0;
      accepted[n] = false;
      visible[n] = !(o.show && o.show[n] === false);
    });
    draggable = names.filter(function (n) { return !!market.curves[n].draggable; });
    point = market.point ? { curve: market.point.curve, x: market.point.x } : null;

    /* --- build the svg once; render() only ever changes attributes --- */
    var root = el('svg', {
      viewBox: '0 0 ' + VB + ' ' + VB,
      'aria-label': market.yLabel + ' against ' + market.xLabel
    }, 'graph');
    var defs = el('defs');
    var clip = el('clipPath', { id: uid });
    clip.appendChild(el('rect', { x: 0, y: 0, width: PLOT, height: PLOT }));
    defs.appendChild(clip);
    root.appendChild(defs);

    var plot = el('g', { transform: 'translate(' + PLOT_X + ',' + PLOT_Y + ')' }, 'plot');
    root.appendChild(plot);
    plot.appendChild(el('rect', { x: 0, y: 0, width: PLOT, height: PLOT }, 'plot-bg'));
    var shade = el('rect', { x: 0, y: 0, width: 0, height: PLOT }, 'gap-shade');
    plot.appendChild(shade);

    var curvesG = el('g', { 'clip-path': 'url(#' + uid + ')' }, 'curves');
    plot.appendChild(curvesG);
    /** @type {Object<string, any>} */ var parts = {};
    names.forEach(function (n) {
      var c = market.curves[n];
      var g = el('g', { 'data-curve': n }, 'curve');
      var ghost = el('path', {}, 'ghost');
      var halo = el('path', {}, 'halo');
      var line = el('path', {}, 'line');
      var tag = textEl(0, 0, c.label || n, 'tag', c.vertical ? 'middle' : 'end');
      g.appendChild(ghost); g.appendChild(halo); g.appendChild(line); g.appendChild(tag);
      curvesG.appendChild(g);
      parts[n] = { g: g, ghost: ghost, halo: halo, line: line, tag: tag };
    });

    var guides = el('g', {}, 'guides');
    plot.appendChild(guides);
    var guideV = el('line', {});
    var guideH = el('line', {});
    var guideXText = textEl(0, PLOT + 30, '', 'axis-label');   // under the reference tick's own line
    var guideYText = textEl(-6, 0, '', 'axis-label', 'end');
    guides.appendChild(guideV); guides.appendChild(guideH);
    guides.appendChild(guideXText); guides.appendChild(guideYText);

    var gapLabel = textEl(PLOT / 2, 34, '', 'axis-label');   // below the vertical curve's tag at y 13
    plot.appendChild(gapLabel);

    var dotG = el('g', {}, 'dot');
    plot.appendChild(dotG);
    var eqGhost = el('circle', { r: 6 }, 'eq-ghost');
    var eqDot = el('circle', { r: 7 }, 'eq');
    dotG.appendChild(eqGhost); dotG.appendChild(eqDot);

    var zonesG = el('g', {}, 'gap-zones');
    zonesG.style.pointerEvents = 'none';
    plot.appendChild(zonesG);
    var zoneL = el('rect', { x: 0, y: 0, width: 0, height: PLOT }, 'zone left');
    var zoneR = el('rect', { x: 0, y: 0, width: 0, height: PLOT }, 'zone right');
    var zoneM = el('rect', { x: 0, y: 0, width: ZONE_BAND, height: PLOT }, 'zone lras');
    zonesG.appendChild(zoneL); zonesG.appendChild(zoneR); zonesG.appendChild(zoneM);

    var hit = el('rect', { x: 0, y: 0, width: PLOT, height: PLOT }, 'hit-plane');
    plot.appendChild(hit);

    var axes = el('g', {}, 'axes');
    root.appendChild(axes);
    var base = PLOT_Y + PLOT;
    axes.appendChild(el('line', { x1: PLOT_X, y1: PLOT_Y, x2: PLOT_X, y2: base }, 'axis'));
    axes.appendChild(el('line', { x1: PLOT_X, y1: base, x2: PLOT_X + PLOT, y2: base }, 'axis'));
    axes.appendChild(textEl(PLOT_X + PLOT / 2, VB - 7, market.xLabel, 'axis-label'));
    var yLabel = textEl(14, PLOT_Y + PLOT / 2, market.yLabel, 'axis-label');
    attr(yLabel, 'transform', 'rotate(-90 14 ' + (PLOT_Y + PLOT / 2) + ')');
    axes.appendChild(yLabel);
    // The reference tick is a mark ON the axis with its name beside it: centred under the axis it
    // stacked straight on top of the x-axis label, and the two crowded each other at 360 px.
    var tickMark = market.xTick ? el('line', {}, 'axis-tickmark') : null;
    var tickText = market.xTick ? textEl(0, base + 16, market.xTick.text, 'axis-tick', 'start') : null;
    if (tickMark) axes.appendChild(tickMark);
    if (tickText) axes.appendChild(tickText);

    mount.appendChild(root);

    // arcade.css strokes .line and .halo per curve but leaves .ghost unpainted, so each ghost
    // borrows its own line's colour once the stylesheet has been applied.
    names.forEach(function (n) {
      var paint = getComputedStyle(parts[n].line).stroke;
      parts[n].ghost.style.stroke = paint && paint !== 'none' ? paint : 'currentColor';
    });

    /* --- the gauge strip --- */
    /** @type {Object<string, any>} */ var gauges = {};
    var strip = null;
    var gaugeHost = o.gauges === true ? mount : (o.gauges || null);
    if (gaugeHost) {
      strip = el('svg', { viewBox: '0 0 ' + (GAUGE_W * market.gauges.length) + ' ' + GAUGE_H });
      strip.style.width = '100%';
      strip.style.height = 'auto';
      strip.style.display = 'block';
      market.gauges.forEach(function (spec, i) {
        var cell = el('g', { transform: 'translate(' + (i * GAUGE_W) + ',0)' }, 'gauge');
        strip.appendChild(cell);
        gauges[spec.id] = new Gauge(cell, spec);
      });
      gaugeHost.appendChild(strip);
    }

    /* --- geometry the renderer needs --- */

    /** @returns {{x:number, y:number}} where the dot sits right now */
    function dotPos() {
      if (point) {
        return { x: point.x, y: lineY(market.curves[point.curve], point.x, shifts[point.curve]) };
      }
      return intersect(market, shifts) || { x: 50, y: 50 };
    }

    /** @returns {number} the full-employment line's x, in graph units */
    function refX() {
      var c = market.ref ? market.curves[market.ref] : null;
      return c ? c.x0 + shifts[market.ref] : 50;
    }

    /** The gap the graph is showing. Sizing the zones and grading the answer both read this, so the
     *  band a student aims at can never disagree with the answer they are marked against.
     *  @returns {string} 'recessionary' | 'inflationary' | 'none' */
    function gapTruth() {
      var d = dotPos().x, r = refX();
      return d < r - 0.01 ? 'recessionary' : d > r + 0.01 ? 'inflationary' : 'none';
    }

    /** @returns {number} how wide the "at full employment" band should be, in svg units: a real
     *  48 px target when `none` is the right answer, and none at all when a side is. */
    function gapBandWidth() { return gapTruth() === 'none' ? ZONE_BAND : ZONE_WITH_GAP; }

    /** @param {any} c @param {number} s @returns {string} the `d` of a curve trimmed to the plot */
    function pathFor(c, s) {
      var r = xRange(c, s);
      if (!r) return 'M 0 0';
      if (c.vertical) return 'M ' + n2(gx(r.lo)) + ' ' + gy(0) + ' L ' + n2(gx(r.lo)) + ' ' + gy(100);
      return 'M ' + n2(gx(r.lo)) + ' ' + n2(gy(lineY(c, r.lo, s))) +
        ' L ' + n2(gx(r.hi)) + ' ' + n2(gy(lineY(c, r.hi, s)));
    }

    /** Where the dot may slide on a curve: inside the plot, and off the very edges.
     *  @param {string} name @returns {{lo:number, hi:number}} */
    function slideRange(name) {
      var r = xRange(market.curves[name], shifts[name]) || { lo: 5, hi: 95 };
      var lo = Math.max(5, r.lo), hi = Math.min(95, r.hi);
      return hi < lo ? { lo: lo, hi: lo } : { lo: lo, hi: hi };
    }

    /* --- render: the only place the svg changes --- */

    function render() {
      names.forEach(function (n) {
        var c = market.curves[n], p = parts[n], s = shifts[n];
        p.g.style.display = visible[n] ? '' : 'none';
        if (!visible[n]) return;
        var d = pathFor(c, s);
        attr(p.line, 'd', d); attr(p.halo, 'd', d);
        var moved = Math.abs(s - cardStart[n]) > 0.01;
        p.ghost.style.display = moved ? '' : 'none';
        if (moved) attr(p.ghost, 'd', pathFor(c, cardStart[n]));
        var r = xRange(c, s);
        if (!r) { p.tag.style.display = 'none'; return; }
        p.tag.style.display = '';
        if (c.vertical) { attr(p.tag, 'x', n2(gx(r.lo))); attr(p.tag, 'y', 13); return; }
        var ty = gy(lineY(c, r.hi, s));
        attr(p.tag, 'x', n2(Math.min(gx(r.hi), PLOT) - 6));
        attr(p.tag, 'y', n2(ty < 24 ? ty + 16 : ty - 8));
      });

      var dot = dotPos();
      var dx = gx(dot.x), dy = gy(dot.y);
      attr(eqDot, 'cx', n2(dx)); attr(eqDot, 'cy', n2(dy));
      var eq = intersect(market, shifts);
      var displaced = !!eq && Math.abs(eq.x - dot.x) > 0.01;
      eqGhost.style.display = displaced ? '' : 'none';
      if (displaced && eq) { attr(eqGhost, 'cx', n2(gx(eq.x))); attr(eqGhost, 'cy', n2(gy(eq.y))); }

      line2(guideV, dx, dy, dx, PLOT);
      line2(guideH, 0, dy, dx, dy);
      attr(guideXText, 'x', n2(dx));
      attr(guideYText, 'y', n2(dy + 4));

      if (market.ref) {
        var rx = gx(refX());
        var bandW = gapBandWidth(), half = bandW / 2;
        attr(zoneL, 'width', n2(Math.max(0, rx - half)));
        attr(zoneR, 'x', n2(rx + half)); attr(zoneR, 'width', n2(Math.max(0, PLOT - rx - half)));
        attr(zoneM, 'x', n2(rx - half)); attr(zoneM, 'width', n2(bandW));
        zoneM.style.display = bandW > 0 ? '' : 'none';
        if (tickText && tickMark) {
          attr(tickText, 'x', n2(PLOT_X + rx + 6));
          line2(tickMark, PLOT_X + rx, base - 5, PLOT_X + rx, base + 5);
          // The tick belongs to its reference curve: an AD-only level that hides LRAS must not be
          // left with a lone "Yf" under the axis marking a line that is not on screen.
          var showTick = visible[market.xTick.at] ? '' : 'none';
          tickText.style.display = showTick;
          tickMark.style.display = showTick;
        }
        if (shadeOn) {
          attr(shade, 'x', n2(Math.min(dx, rx))); attr(shade, 'width', n2(Math.abs(dx - rx)));
          attr(gapLabel, 'x', n2(clamp((dx + rx) / 2, 46, PLOT - 46)));
        }
      }

      var out = outputs(market, dot);
      market.gauges.forEach(function (spec) {
        var g = gauges[spec.id];
        if (g && typeof out[spec.from] === 'number') g.set(out[spec.from], { animate: false });
      });
    }

    /* --- events --- */

    /** @param {string} name @param {Function} fn */
    function on(name, fn) { (listeners[name] || (listeners[name] = [])).push(fn); }

    /** @param {string} name @param {Function} fn */
    function off(name, fn) {
      var a = listeners[name], i = a ? a.indexOf(fn) : -1;
      if (i >= 0) a.splice(i, 1);
    }

    /** @param {string} name @returns {Promise<any>} resolves with the next payload */
    function once(name) {
      return new Promise(function (resolve) {
        function handler(payload) { off(name, handler); resolve(payload); }
        on(name, handler);
      });
    }

    /** @param {string} name @param {any} payload */
    function emit(name, payload) { (listeners[name] || []).slice().forEach(function (fn) { fn(payload); }); }

    /* --- dragging: one hit plane, distance-based targeting --- */

    /** @param {any} ev @returns {{x:number, y:number}} the pointer in graph units */
    function toUnits(ev) {
      var r = root.getBoundingClientRect();
      var s = r.width ? VB / r.width : 1;
      return {
        x: ((ev.clientX - r.left) * s - PLOT_X) / K,
        y: (PLOT_Y + PLOT - (ev.clientY - r.top) * s) / K
      };
    }

    /** Which curve a dot drag is running along, by how well it lines up with each unit tangent.
     *  @param {number} vx @param {number} vy @returns {string|null} */
    function alongCurve(vx, vy) {
      var best = null, score = 0;
      draggable.forEach(function (n) {
        var c = market.curves[n];
        if (c.vertical || !visible[n] || accepted[n]) return;
        var inv = 1 / Math.sqrt(1 + c.m * c.m);
        var s = Math.abs(vx * inv + vy * c.m * inv);
        if (s > score) { score = s; best = n; }
      });
      return best;
    }

    /** @param {{x:number, y:number}} p @returns {string|null} the nearest grabbable curve */
    function curveUnder(p) {
      var best = null, near = HIT;
      draggable.forEach(function (n) {
        if (!visible[n] || accepted[n]) return;
        var d = distanceTo(market.curves[n], shifts[n], p.x, p.y);
        if (d <= near) { near = d; best = n; }
      });
      return best;
    }

    function onDown(ev) {
      ev.preventDefault();
      if (anim) { anim.finish(); emit('skip', {}); return; }
      if (locked || drag) return;
      if (settle) { var last = settle; settle = null; last.finish(); }   // land the last verdict first
      var p = toUnits(ev);
      var dot = dotPos();
      // alongCurve() here only asks whether anything is slideable at all; the drag picks the curve.
      if (Math.hypot(p.x - dot.x, p.y - dot.y) <= DOT_HIT && alongCurve(1, 0)) {
        drag = { kind: 'dot', pointerId: ev.pointerId, curve: null, startX: p.x, startY: p.y, dotX: dot.x, dotY: dot.y, hadPoint: !!point };
      } else {
        var name = curveUnder(p);
        if (!name) return;
        drag = { kind: 'curve', pointerId: ev.pointerId, curve: name, startX: p.x, startShift: shifts[name] };
        parts[name].g.classList.add('grabbed');
      }
      try { hit.setPointerCapture(ev.pointerId); } catch (err) { /* capture is a nicety, not a need */ }
      var A = engine();
      if (A) A.sfx.play('grab');
      emit('dragstart', { kind: drag.kind, curve: drag.curve });
    }

    function onMove(ev) {
      if (locked) return;                                     // the round is over; the springs own the curve now
      if (!drag || ev.pointerId !== drag.pointerId) return;   // a second finger is not this drag
      ev.preventDefault();
      var p = toUnits(ev);
      if (drag.kind === 'curve') {
        shifts[drag.curve] = clamp(drag.startShift + (p.x - drag.startX), -CLAMP, CLAMP);
        render();
        emit('drag', { kind: 'curve', curve: drag.curve, shift: shifts[drag.curve] });
        return;
      }
      if (!drag.curve) {
        if (Math.hypot(p.x - drag.startX, p.y - drag.startY) < 2) return;
        drag.curve = alongCurve(p.x - drag.startX, p.y - drag.startY);
        if (!drag.curve) return;
        parts[drag.curve].g.classList.add('grabbed');
      }
      var range = slideRange(drag.curve);
      var xc = clamp(p.x, range.lo, range.hi);
      point = { curve: drag.curve, x: xc };
      render();
      emit('drag', { kind: 'dot', curve: drag.curve, x: xc, y: lineY(market.curves[drag.curve], xc, shifts[drag.curve]) });
    }

    /** @param {string} name @param {number} to @param {() => void} done */
    function springShift(name, to, done) {
      var landed = false;
      var handle = spring(shifts[name], to, function (v) { shifts[name] = v; render(); }, 'snap', function () {
        landed = true;
        settle = null;
        shifts[name] = to;
        render();
        done();
      });
      settle = landed ? null : handle;
    }

    /** @param {string} name @param {number} to @param {boolean} clearAfter @param {() => void} done */
    function springPoint(name, to, clearAfter, done) {
      var range = slideRange(name);
      var target = clamp(to, range.lo, range.hi);
      var landed = false;
      var handle = spring(point ? point.x : target, target, function (v) {
        point = { curve: name, x: v };
        render();
      }, 'snap', function () {
        landed = true;
        settle = null;
        point = clearAfter ? null : { curve: name, x: target };
        render();
        done();
      });
      settle = landed ? null : handle;
    }

    /** End an in-flight drag with no verdict. lock() and setCard() cut a round short while a finger
     *  is still down, and that finger must stop writing shifts the snapBack/animateTo springs are
     *  already animating — otherwise the eventual pointerup springs the curve to startShift ± SNAP
     *  under the WHY sheet. No `release` is emitted: nothing was answered. */
    function endDrag() {
      if (!drag) return;
      var d = drag;
      drag = null;
      try { hit.releasePointerCapture(d.pointerId); } catch (err) { /* already gone */ }
      if (d.curve && parts[d.curve]) parts[d.curve].g.classList.remove('grabbed');
    }

    function onUp(ev) {
      if (locked) return;                                     // the drag it would have ended is already over
      if (!drag || ev.pointerId !== drag.pointerId) return;   // only the finger that started it ends it
      var d = drag;
      drag = null;
      try { hit.releasePointerCapture(ev.pointerId); } catch (err) { /* already gone */ }
      if (d.curve && parts[d.curve]) parts[d.curve].g.classList.remove('grabbed');

      if (d.kind === 'curve') {
        var shifted = classify({ kind: 'curve', curve: d.curve, startShift: d.startShift, shift: shifts[d.curve] });
        var to = shifted.kind === 'shift'
          ? clamp(d.startShift + (shifted.dir === 'R' ? SNAP : -SNAP), -CLAMP, CLAMP)
          : d.startShift;
        springShift(d.curve, to, function () { emit('release', shifted); });
        return;
      }
      if (!d.curve) { emit('release', { kind: 'none', curve: null, dir: null, magnitude: 0 }); return; }
      var here = dotPos();
      var moved = classify({ kind: 'dot', curve: d.curve, x0: d.dotX, y0: d.dotY, x: here.x, y: here.y });
      var slope = market.curves[d.curve].m;
      var toX = moved.kind === 'move'
        ? d.dotX + 10 * (slope > 0 ? 1 : -1) * (moved.dir === 'up' ? 1 : -1)
        : d.dotX;
      springPoint(d.curve, toX, moved.kind === 'none' && !d.hadPoint, function () { emit('release', moved); });
    }

    hit.addEventListener('pointerdown', onDown); hit.addEventListener('pointermove', onMove);
    hit.addEventListener('pointerup', onUp); hit.addEventListener('pointercancel', onUp);

    /* --- gap mode --- */

    function clearGap() {
      shadeOn = false;
      gapMode = false;
      gapAnswered = false;
      shade.classList.remove('on', 'good', 'bad');
      gapLabel.textContent = '';
      zonesG.style.pointerEvents = 'none';
      hit.style.pointerEvents = '';
    }

    /** @param {string} answer @returns {(ev:any) => void} */
    function onZone(answer) {
      return function (ev) {
        ev.preventDefault();
        if (!gapMode || gapAnswered) return;
        gapAnswered = true;
        gapMode = false;
        zonesG.style.pointerEvents = 'none';
        emit('gap', { answer: answer });
      };
    }
    zoneL.addEventListener('pointerdown', onZone('recessionary'));
    zoneR.addEventListener('pointerdown', onZone('inflationary'));
    zoneM.addEventListener('pointerdown', onZone('none'));

    /** Shade the output gap and hand the three zones to the student. */
    function askGap() {
      if (!market.ref) return;
      shadeOn = true;
      gapMode = true;
      gapAnswered = false;
      shade.classList.remove('good', 'bad');
      shade.classList.add('on');
      gapLabel.textContent = '';
      zonesG.style.pointerEvents = 'auto';
      hit.style.pointerEvents = 'none';
      render();
    }

    /** @param {boolean} correct @returns {string} the gap the graph actually shows */
    function markGap(correct) {
      var truth = gapTruth();
      shade.classList.remove('on');
      shade.classList.add(correct ? 'good' : 'bad');
      gapLabel.textContent = truth === 'recessionary' ? 'Recessionary gap'
        : truth === 'inflationary' ? 'Inflationary gap' : 'At full employment';
      gapMode = false;
      zonesG.style.pointerEvents = 'none';
      hit.style.pointerEvents = '';
      render();
      return truth;
    }

    /* --- animation, cards and the rest of the API --- */

    /** Cutting motion short never swallows a result: an interrupted animateTo() still settles its
     *  promise, and an interrupted release spring still lands on its target and emits `release`, so
     *  a game awaiting either is never left hanging by the next setCard(). Both handles are cleared
     *  before they fire, because a `release` listener calling setCard() re-enters here. */
    function stopAnims() {
      if (anim) { anim.cancel(); anim = null; }
      if (animResolve) { var pending = animResolve; animResolve = null; pending(); }
      if (settle) { var landing = settle; settle = null; landing.finish(); }
    }

    /** Spring every shift, the point and the gauges to a new state in one phase.
     *  @param {{shifts?:Object<string, number>, point?:{curve:string, x:number}|null}} target
     *  @param {{preset?:string}} [opts] @returns {Promise<void>} */
    function animateTo(target, opts) {
      var t = target || {};
      stopAnims();
      /** @type {Object<string, number>} */ var from = {};
      /** @type {Object<string, number>} */ var to = {};
      names.forEach(function (n) {
        from[n] = shifts[n];
        to[n] = t.shifts && typeof t.shifts[n] === 'number' ? t.shifts[n] : shifts[n];
      });
      var toPoint = t.point || null;
      var fromX = dotPos().x;
      var endEq = intersect(market, to);
      var toX = toPoint ? toPoint.x : (endEq ? endEq.x : fromX);
      var pointCurve = toPoint ? toPoint.curve : (point ? point.curve : null);
      return new Promise(function (resolve) {
        var landed = false;
        animResolve = resolve;
        var handle = spring(0, 1, function (u) {
          names.forEach(function (n) { shifts[n] = from[n] + (to[n] - from[n]) * u; });
          if (pointCurve) point = { curve: pointCurve, x: fromX + (toX - fromX) * u };
          render();
        }, (opts && opts.preset) || 'consequence', function () {
          landed = true;
          anim = null;
          animResolve = null;
          names.forEach(function (n) { shifts[n] = to[n]; });
          point = toPoint ? { curve: toPoint.curve, x: toPoint.x } : null;
          render();
          resolve();
        });
        anim = landed ? null : handle;
      });
    }

    /** @param {{jolt?:boolean}} [opts] @returns {Promise<void>} back to where the card started */
    function snapBack(opts) {
      return animateTo({ shifts: cardStart }, { preset: opts && opts.jolt ? 'jolt' : 'snap' });
    }

    /** @param {{start?:Object<string, number>, draggable?:string[], moves?:number}} [card]
     *    `start`: shifts to open on, missing curves at 0. `draggable`: the curves this card lets
     *    the student touch. `moves`: the game's business — the graph keeps taking releases until
     *    it is told to lock(). */
    function setCard(card) {
      var c = card || {};
      stopAnims();
      endDrag();
      names.forEach(function (n) {
        shifts[n] = c.start && typeof c.start[n] === 'number' ? c.start[n] : 0;
        cardStart[n] = shifts[n];
        accepted[n] = false;
        parts[n].g.classList.remove('accepted', 'grabbed');
      });
      point = market.point ? { curve: market.point.curve, x: market.point.x } : null;
      draggable = Array.isArray(c.draggable)
        ? c.draggable.slice()
        : names.filter(function (n) { return !!market.curves[n].draggable; });
      locked = false;
      clearGap();
      render();
    }

    /** @param {string} curve freeze it where it stands and mark it right */
    function accept(curve) {
      if (!parts[curve]) return;
      accepted[curve] = true;
      parts[curve].g.classList.add('accepted');
    }

    /** @param {string} curve @param {boolean} shown */
    function setVisible(curve, shown) {
      if (!parts[curve]) return;
      visible[curve] = !!shown;
      render();
    }

    /** @param {{x?:string, y?:string}} labels the two guide ticks, e.g. `{x:'Y1', y:'PL1'}` */
    function setLabels(labels) {
      var l = labels || {};
      guideXText.textContent = l.x || '';
      guideYText.textContent = l.y || '';
    }

    /** @returns {{shifts:Object<string, number>, eq:{x:number, y:number}, out:Object<string, number>}}
     *    `eq` is where the dot sits — the crossing, or the point it has been slid to. */
    function state() {
      /** @type {Object<string, number>} */ var copy = {};
      names.forEach(function (n) { copy[n] = shifts[n]; });
      var dot = dotPos();
      return { shifts: copy, eq: dot, out: outputs(market, dot) };
    }

    function reset() {
      setLabels({ x: '', y: '' });
      names.forEach(function (n) { visible[n] = !(o.show && o.show[n] === false); });
      setCard({});
    }

    function destroy() {
      listeners = {};   // before stopAnims(), so a torn-down graph reports nothing to nobody
      stopAnims();
      hit.removeEventListener('pointerdown', onDown); hit.removeEventListener('pointermove', onMove);
      hit.removeEventListener('pointerup', onUp); hit.removeEventListener('pointercancel', onUp);
      if (root.parentNode) root.parentNode.removeChild(root);
      if (strip && strip.parentNode) strip.parentNode.removeChild(strip);
    }

    render();

    return {
      el: root, gauges: gauges,
      on: on, off: off, once: once,
      setCard: setCard, animateTo: animateTo, snapBack: snapBack,
      accept: accept,
      lock: function () { locked = true; endDrag(); },
      unlock: function () { locked = false; },
      askGap: askGap, markGap: markGap, setVisible: setVisible,
      state: state, setLabels: setLabels, reset: reset, destroy: destroy
    };
  }

  return {
    create: create, Gauge: Gauge, MARKETS: MARKETS,
    intersect: intersect, outputs: outputs, classify: classify
  };
}());

if (typeof module !== 'undefined') module.exports = ArcadeGraph;
