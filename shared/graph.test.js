// @ts-check
/* Tests for the pure half of shared/graph.js — where two curves cross, what each market
   reads off that crossing, and what a finished drag meant.
   Run: node --test shared/graph.test.js */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ArcadeGraph = require('./graph.js');

const MARKETS = ArcadeGraph.MARKETS;
const intersect = ArcadeGraph.intersect;
const outputs = ArcadeGraph.outputs;
const classify = ArcadeGraph.classify;
const pickTarget = ArcadeGraph.pickTarget;
const GEOM = ArcadeGraph.GEOM;

/** Graph units carry float noise (0.8 * 6 !== 4.8), so equality is to a tolerance.
 *  @param {number} actual @param {number} expected @param {string} [what] */
function near(actual, expected, what) {
  assert.ok(Math.abs(actual - expected) < 1e-9, (what || 'value') + ': ' + actual + ' != ' + expected);
}

/** The drag deadzone the engine classifies against, in graph units. */
const DEAD = 8;

/** The graph svg's rendered width in css px in the phone column at 360 x 740. Its 360-unit
 *  viewBox holds a 290-unit plot, so one graph unit is (336/360) * 2.9 ≈ 2.71 css px. */
const RENDER_PX = 336;
const PX_PER_UNIT = (RENDER_PX / 360) * (290 / 100);

/* ===== the module itself ===== */

test('graph.js loads with no DOM and exposes its public surface', () => {
  assert.equal(typeof document, 'undefined');
  assert.equal(typeof ArcadeGraph.create, 'function');
  assert.equal(typeof ArcadeGraph.Gauge, 'function');
  assert.equal(typeof intersect, 'function');
  assert.equal(typeof outputs, 'function');
  assert.equal(typeof classify, 'function');
});

/* ===== markets as data ===== */

test('every market carries CED-exact axis labels and drawable curves', () => {
  assert.deepEqual(Object.keys(MARKETS), ['adas', 'money', 'lf', 'forex', 'phillips']);
  assert.equal(MARKETS.adas.xLabel, 'Real GDP');
  assert.equal(MARKETS.adas.yLabel, 'Price Level');
  assert.equal(MARKETS.money.xLabel, 'Quantity of money');
  assert.equal(MARKETS.money.yLabel, 'Nominal interest rate');
  assert.equal(MARKETS.lf.xLabel, 'Quantity of loanable funds');
  assert.equal(MARKETS.lf.yLabel, 'Real interest rate');
  assert.equal(MARKETS.forex.xLabel, 'Quantity of dollars');
  assert.equal(MARKETS.forex.yLabel, 'Price of $ (in foreign currency)');
  assert.equal(MARKETS.phillips.xLabel, 'Unemployment rate (u%)');
  assert.equal(MARKETS.phillips.yLabel, 'Inflation rate (π%)');

  for (const key of Object.keys(MARKETS)) {
    const m = MARKETS[key];
    const names = Object.keys(m.curves);
    assert.ok(names.length >= 2, key + ' needs at least two curves');
    for (const name of names) {
      const c = m.curves[name];
      if (c.vertical) assert.equal(typeof c.x0, 'number', key + '.' + name + ' needs x0');
      else assert.ok(typeof c.m === 'number' && typeof c.b === 'number', key + '.' + name + ' needs m and b');
    }
    assert.equal(typeof m.out, 'function', key + ' needs an out()');
    assert.ok(Array.isArray(m.gauges) && m.gauges.length >= 1, key + ' needs gauges');
    assert.ok(m.eq || m.point, key + ' needs an equilibrium or a point');
  }
});

/* ===== intersect ===== */

test('AD/SRAS rest at the middle of the plot', () => {
  const eq = intersect(MARKETS.adas, {});
  near(eq.x, 50, 'x');
  near(eq.y, 50, 'y');
});

test('AD right 12 raises both the price level and real GDP', () => {
  const eq = intersect(MARKETS.adas, { AD: 12, SRAS: 0 });
  near(eq.x, 56, 'x');
  near(eq.y, 56, 'y');

  const out = outputs(MARKETS.adas, eq);
  near(out.PL, 104.8, 'PL');
  near(out.Y, 104.8, 'Y');
  near(out.gap, 4.8, 'gap');
  near(out.u, 3.6, 'u');
});

test('SRAS left 12 is stagflation: prices up, output down, unemployment up', () => {
  const eq = intersect(MARKETS.adas, { AD: 0, SRAS: -12 });
  near(eq.x, 44, 'x');
  near(eq.y, 56, 'y');

  const out = outputs(MARKETS.adas, eq);
  near(out.u, 8.4, 'u');
  near(out.gap, -4.8, 'gap');
  assert.ok(out.PL > 100, 'price level rises');
  assert.ok(out.Y < 100, 'real GDP falls');
});

test('a card that starts AD left 12 comes back to rest when the student drags AD right 12', () => {
  const start = intersect(MARKETS.adas, { AD: -12 });
  near(start.x, 44, 'start x');
  near(start.y, 44, 'start y');
  near(outputs(MARKETS.adas, start).gap, -4.8, 'start gap');

  const after = intersect(MARKETS.adas, { AD: -12 + 12 });
  near(after.x, 50, 'x');
  near(after.y, 50, 'y');
  near(outputs(MARKETS.adas, after).gap, 0, 'gap closed');
});

test('shifts left out of the map count as zero', () => {
  assert.deepEqual(intersect(MARKETS.adas, { AD: 12 }), intersect(MARKETS.adas, { AD: 12, SRAS: 0 }));
  assert.deepEqual(intersect(MARKETS.adas, {}), intersect(MARKETS.adas, { AD: 0, SRAS: 0 }));
});

test('intersect accepts a market key as well as a market object', () => {
  assert.deepEqual(intersect('adas', { AD: 12 }), intersect(MARKETS.adas, { AD: 12 }));
});

test('the money market crosses a vertical MS: MS right 12 makes the nominal rate fall', () => {
  const rest = intersect(MARKETS.money, {});
  near(rest.x, 50, 'rest x');
  near(rest.y, 50, 'rest y');
  near(outputs(MARKETS.money, rest).i, 5, 'rest i');

  const eased = intersect(MARKETS.money, { MS: 12 });
  near(eased.x, 62, 'x');
  near(eased.y, 38, 'y');

  const out = outputs(MARKETS.money, eased);
  near(out.i, 3.8, 'i');
  near(out.Qm, 62, 'Qm');
  assert.ok(out.i < outputs(MARKETS.money, rest).i, 'the nominal rate falls');
});

test('a vertical curve shifted left raises the rate it sets', () => {
  const tight = intersect(MARKETS.money, { MS: -12 });
  near(tight.x, 38, 'x');
  near(outputs(MARKETS.money, tight).i, 6.2, 'i');
});

test('loanable funds and forex cross where their two sloped curves meet', () => {
  near(intersect(MARKETS.lf, {}).x, 50, 'lf rest x');
  near(outputs(MARKETS.lf, intersect(MARKETS.lf, { D: 10 })).r, 5.5, 'demand for funds up, real r up');
  near(intersect(MARKETS.forex, {}).y, 50, 'forex rest y');
  near(outputs(MARKETS.forex, intersect(MARKETS.forex, { D: 10 })).e, 104, 'dollar demand up, dollar appreciates');
});

test('the Phillips curve has no crossing — it is read at a point', () => {
  assert.equal(intersect(MARKETS.phillips, {}), null);
  const out = outputs(MARKETS.phillips, { x: 60, y: 40 });
  near(out.u, 6, 'u');
  near(out.pi, 4, 'pi');
});

/* ===== classify ===== */

test('dragging a curve well to the right is a rightward shift', () => {
  assert.deepEqual(classify({ kind: 'curve', curve: 'AD', startShift: 0, shift: 10 }),
    { kind: 'shift', curve: 'AD', dir: 'R', magnitude: 10 });
});

test('dragging a curve well to the left is a leftward shift', () => {
  assert.deepEqual(classify({ kind: 'curve', curve: 'AD', startShift: 0, shift: -10 }),
    { kind: 'shift', curve: 'AD', dir: 'L', magnitude: 10 });
});

test('a curve drag inside the deadzone is not a shift', () => {
  const r = classify({ kind: 'curve', curve: 'AD', startShift: 0, shift: 5 });
  assert.equal(r.kind, 'none');
  assert.deepEqual(r, { kind: 'none', curve: 'AD', dir: null, magnitude: 5 });
});

test('the deadzone measures the drag, not the finished position', () => {
  assert.equal(classify({ kind: 'curve', curve: 'SRAS', startShift: 12, shift: 15 }).kind, 'none');
  assert.deepEqual(classify({ kind: 'curve', curve: 'SRAS', startShift: 12, shift: 0 }),
    { kind: 'shift', curve: 'SRAS', dir: 'L', magnitude: 12 });
});

test('the deadzone edge counts as a shift', () => {
  assert.equal(classify({ kind: 'curve', curve: 'AD', startShift: 0, shift: DEAD }).kind, 'shift');
  assert.equal(classify({ kind: 'curve', curve: 'AD', startShift: 0, shift: DEAD - 0.01 }).kind, 'none');
});

test('sliding the dot up along AD is a movement along the curve', () => {
  assert.deepEqual(classify({ kind: 'dot', curve: 'AD', x0: 50, y0: 50, x: 41, y: 59 }),
    { kind: 'move', curve: 'AD', dir: 'up', magnitude: 9 });
});

test('sliding the dot down along SRAS is a downward movement', () => {
  assert.deepEqual(classify({ kind: 'dot', curve: 'SRAS', x0: 50, y0: 50, x: 40, y: 40 }),
    { kind: 'move', curve: 'SRAS', dir: 'down', magnitude: 10 });
});

test('a dot nudge inside the deadzone is not a movement', () => {
  const r = classify({ kind: 'dot', curve: 'AD', x0: 50, y0: 50, x: 45, y: 55 });
  assert.equal(r.kind, 'none');
  assert.deepEqual(r, { kind: 'none', curve: 'AD', dir: null, magnitude: 5 });
});

test('a drag with no target classifies as nothing at all', () => {
  assert.deepEqual(classify({}), { kind: 'none', curve: null, dir: null, magnitude: 0 });
});

/* ===== pickTarget — what a finger landing on the plot grabs =====
   The equilibrium dot used to be a 13 px target that fell through to a 24 px curve radius on a
   miss, so on a trick card — where the answer is "nothing shifts, the dot moves along" — a thumb
   15 px off the dot shifted AD instead: the single wrong answer the card exists to catch. */

test('the geometry the engine hit-tests with is exported', () => {
  assert.equal(GEOM.VB, 360);
  assert.equal(GEOM.PLOT, 290);
  assert.equal(GEOM.DEAD, DEAD);
  assert.equal(typeof GEOM.DOT_HIT_WIDE, 'number');
  assert.equal(typeof GEOM.DOT_HIT_NARROW, 'number');
  assert.equal(typeof GEOM.HIT, 'number');
});

test('the wide dot target is at least 48 px across at the 336 px render', () => {
  const across = GEOM.DOT_HIT_WIDE * 2 * PX_PER_UNIT;
  assert.ok(across >= 48, 'the dot is ' + across.toFixed(1) + ' px across, under the house 48 px rule');
});

test('the wide dot outranks the curves crossing under it; the narrow one deliberately does not', () => {
  assert.ok(GEOM.DOT_HIT_WIDE > GEOM.HIT,
    'inside the wide target the dot must beat the curve the finger is also near');
  assert.ok(GEOM.DOT_HIT_NARROW < GEOM.HIT,
    'the narrow radius stays inside the curve radius, so on a level whose pool has no move card '
    + 'a drag starting near the equilibrium is still read as the shift the student meant');
});

test('a 20 px near miss grabs the dot on a wide card', () => {
  // 20 css px out — comfortably inside the wide target, and squarely inside the curve radius.
  const off = 20 / PX_PER_UNIT;
  assert.deepEqual(
    pickTarget({ x: 50 + off, y: 50 }, { x: 50, y: 50 }, { slideable: true, curve: 'AD', radius: GEOM.DOT_HIT_WIDE }),
    { kind: 'dot', curve: null });
});

test('the same 20 px near miss grabs the curve on a narrow card', () => {
  const off = 20 / PX_PER_UNIT;
  assert.deepEqual(
    pickTarget({ x: 50 + off, y: 50 }, { x: 50, y: 50 }, { slideable: true, curve: 'AD', radius: GEOM.DOT_HIT_NARROW }),
    { kind: 'curve', curve: 'AD' });
});

test('a tap inside the dot target grabs nothing when there is nothing to slide along', () => {
  assert.deepEqual(
    pickTarget({ x: 52, y: 50 }, { x: 50, y: 50 }, { slideable: false, curve: 'AD', radius: GEOM.DOT_HIT_WIDE }),
    { kind: 'none', curve: null }, 'inside the target it is the dot or nothing — never a curve');
});

test('each dot target ends where it says it does', () => {
  const dot = { x: 50, y: 50 };
  const at = (d, radius) => pickTarget({ x: 50 + d, y: 50 }, dot, { slideable: true, curve: 'AD', radius: radius }).kind;
  for (const radius of [GEOM.DOT_HIT_WIDE, GEOM.DOT_HIT_NARROW]) {
    assert.equal(at(radius, radius), 'dot', 'the edge is inside at r=' + radius);
    assert.equal(at(radius + 0.01, radius), 'curve', 'a hair outside falls through at r=' + radius);
  }
});

test('an unspecified radius is the narrow one, the way the engine behaved before', () => {
  const dot = { x: 50, y: 50 };
  const at = (d) => pickTarget({ x: 50 + d, y: 50 }, dot, { slideable: true, curve: 'AD' }).kind;
  assert.equal(at(GEOM.DOT_HIT_NARROW), 'dot');
  assert.equal(at(GEOM.DOT_HIT_NARROW + 0.01), 'curve');
});

test('outside the dot target the nearest grabbable curve wins, and nothing wins nothing', () => {
  const far = { x: 90, y: 20 };
  const r = GEOM.DOT_HIT_WIDE;
  assert.deepEqual(pickTarget(far, { x: 50, y: 50 }, { slideable: true, curve: 'SRAS', radius: r }),
    { kind: 'curve', curve: 'SRAS' });
  assert.deepEqual(pickTarget(far, { x: 50, y: 50 }, { slideable: true, curve: null, radius: r }),
    { kind: 'none', curve: null });
});
