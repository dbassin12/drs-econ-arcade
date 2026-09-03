// @ts-check
/* Tests for games/fed-chair.model.js — the 1975 stagflation economy the Fed Chair game runs on.
   The model is pure: no DOM, no storage, no clock. Everything here is arithmetic on plain objects.
   Run: node --test games/fed-chair.model.test.js */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const FedModel = require('./fed-chair.model.js');

const PARAMS = FedModel.PARAMS_1975;
const INITIAL = FedModel.INITIAL_1975;

/** Floats carry noise, so equality is to a tolerance.
 *  @param {number} actual @param {number} expected @param {string} [what] */
function near(actual, expected, what) {
  assert.ok(Math.abs(actual - expected) < 1e-9, (what || 'value') + ': ' + actual + ' != ' + expected);
}

/** The fixture tolerance the brief sets for end values and peak u.
 *  @param {number} actual @param {number} expected @param {string} what */
function within(actual, expected, what) {
  assert.ok(Math.abs(actual - expected) <= 0.3,
    what + ': ' + actual.toFixed(3) + ' is more than 0.3 from ' + expected);
}

/** @param {number} n @param {number} v @returns {number[]} */
function rep(n, v) { const a = []; for (let i = 0; i < n; i++) a.push(v); return a; }

/** A seeded generator, so the random search below is the same run every time.
 *  @param {number} seed @returns {() => number} */
function lcg(seed) {
  let s = seed >>> 0;
  return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** The five policies the tuning simulation was scored on. */
const POLICIES = {
  hold: { rates: rep(10, 6.5), acceptedCall: false, pi: 6.0, u: 7.7, peakU: 9.0, stamp: 3 },
  aggressive: { rates: [7.5, 8.5, 9.5, 10.5].concat(rep(6, 10.5)), acceptedCall: false, pi: 3.6, u: 11.9, peakU: 11.9, stamp: 2 },
  cut: { rates: [5.5, 4.5, 4.0].concat(rep(7, 4.0)), acceptedCall: false, pi: 10.4, u: 4.2, peakU: 8.8, stamp: 1 },
  acceptedCall: { rates: rep(10, 6.5), acceptedCall: true, pi: 9.0, u: 5.8, peakU: 9.0, stamp: null },
  best: { rates: [7.25, 6.75, 7.0, 6.75, 5.75, 4.75, 3.75, 2.75, 2.0, 2.0], acceptedCall: false, pi: 6.8, u: 6.1, peakU: 9.1, stamp: 5 }
};

/** @param {{rates: number[], acceptedCall: boolean}} policy */
function run(policy) {
  return FedModel.simulate(policy.rates, { acceptedCall: policy.acceptedCall });
}

/* ===== the module itself ===== */

test('fed-chair.model.js loads with no DOM and exposes its public surface', () => {
  assert.equal(typeof document, 'undefined');
  assert.equal(typeof FedModel.step, 'function');
  assert.equal(typeof FedModel.shocksFor, 'function');
  assert.equal(typeof FedModel.simulate, 'function');
  assert.equal(typeof FedModel.judgeMove, 'function');
  assert.equal(typeof FedModel.score, 'function');
  assert.equal(typeof FedModel.clampRate, 'function');
  assert.equal(typeof FedModel.search, 'function');
});

test('the 1975 parameters and opening state are the ones the game is tuned to', () => {
  assert.deepEqual(PARAMS, { k: 0.20, rStar: 1.0, rho: 1.0, phi: 0.30, FLOOR: -6, a: 0.60, uStar: 6.0, piStar: 2, lambda: 0.05, okun: 0.5 });
  assert.deepEqual(INITIAL, { t: 1, pi: 11.0, u: 8.0, gap: -4.0, piExp: 11.0, rate: 6.50, cred: 0.1 });
  assert.equal(FedModel.RATE_MIN, 2);
  assert.equal(FedModel.RATE_MAX, 14);
  assert.equal(FedModel.RATE_STEP, 0.25);
  assert.equal(FedModel.MAX_MOVE, 1.00);
});

test('HISTORY_1975 is ten quarters of what actually happened', () => {
  const h = FedModel.HISTORY_1975;
  assert.deepEqual(Object.keys(h).sort(), ['pi', 'rate', 'u']);
  assert.deepEqual(h.pi, [11.0, 9.6, 8.7, 7.2, 6.4, 6.1, 5.5, 5.1, 5.8, 6.9]);
  assert.deepEqual(h.u, [8.3, 8.9, 8.5, 8.3, 7.7, 7.6, 7.7, 7.8, 7.5, 7.1]);
  assert.deepEqual(h.rate, [6.3, 5.4, 6.2, 5.4, 4.8, 5.2, 5.3, 4.9, 4.7, 5.2]);
  [['pi', h.pi], ['u', h.u], ['rate', h.rate]].forEach(([name, series]) => {
    assert.equal(series.length, 10, name + ' has ten quarters');
    series.forEach((v) => assert.equal(typeof v, 'number'));
  });
  assert.equal(h.pi[0], INITIAL.pi, 'the real history opens where the game opens');
});

/* ===== clampRate — a quarter point at a time, one point a turn, inside 2–14 ===== */

test('a rate more than a point away from last turn is clamped to a one-point move', () => {
  assert.equal(FedModel.clampRate(9.0, 6.5), 7.5);
  assert.equal(FedModel.clampRate(0.0, 6.5), 5.5);
  assert.equal(FedModel.clampRate(7.5, 6.5), 7.5, 'exactly a point is legal');
  assert.equal(FedModel.clampRate(5.5, 6.5), 5.5);
});

test('a rate inside the window passes through, snapped to a quarter point', () => {
  assert.equal(FedModel.clampRate(7.25, 6.5), 7.25);
  assert.equal(FedModel.clampRate(6.5, 6.5), 6.5, 'holding is legal');
  assert.equal(FedModel.clampRate(6.62, 6.5), 6.5, 'snaps down to the quarter');
  assert.equal(FedModel.clampRate(6.63, 6.5), 6.75, 'snaps up to the quarter');
});

test('the rate never leaves 2–14 even when a legal one-point move would take it out', () => {
  assert.equal(FedModel.clampRate(1.5, 2.5), 2);
  assert.equal(FedModel.clampRate(-40, 2.0), 2);
  assert.equal(FedModel.clampRate(20, 13.5), 14);
  assert.equal(FedModel.clampRate(20, 14), 14);
});

/* ===== step — one quarter of the economy ===== */

test('one quarter from the 1975 opening state is the hand-computed transition', () => {
  const next = FedModel.step(INITIAL, 6.5, { demand: -3, supply: 0 }, PARAMS);
  near(next.real, -4.5, 'real = 6.5 - 11');
  near(next.gap, -5.9, 'gap = -4 - 0.2*(-4.5 - 1) - 3');
  near(next.pi, 9.8, 'pi = 11 + 0.3*(-4)');
  near(next.piExp, 10.475, 'piExp = 0.6*11 + 0.4*9.8 - 0.1*0.05*9');
  near(next.u, 8.95, 'u = 6 - 0.5*(-5.9)');
  near(next.cred, 0.05, 'a deeply negative real rate costs credibility');
  assert.equal(next.t, 2);
  assert.equal(next.rate, 6.5, 'the state carries the rate that produced it');
});

test('inflation reads last turn\'s gap, so the rate cannot touch it this turn', () => {
  const zero = { demand: 0, supply: 0 };
  const tight = FedModel.step(INITIAL, 7.5, zero, PARAMS);
  const loose = FedModel.step(INITIAL, 5.5, zero, PARAMS);
  near(tight.pi, loose.pi, 'same pi whatever the rate');
  assert.ok(tight.gap < loose.gap, 'but a higher rate opens a wider gap');
});

test('a gap below the floor stops pulling inflation down any further', () => {
  const deep = Object.assign({}, INITIAL, { gap: -10 });
  const floored = Object.assign({}, INITIAL, { gap: PARAMS.FLOOR });
  const zero = { demand: 0, supply: 0 };
  near(FedModel.step(deep, 6.5, zero, PARAMS).pi, FedModel.step(floored, 6.5, zero, PARAMS).pi, 'pi at the floor');
  near(FedModel.step(deep, 6.5, zero, PARAMS).pi, 11 + 0.3 * -6, 'pi = piExp + phi*FLOOR');
});

test('a supply shock lands on inflation and a demand shock on the gap', () => {
  const base = FedModel.step(INITIAL, 6.5, { demand: 0, supply: 0 }, PARAMS);
  const shocked = FedModel.step(INITIAL, 6.5, { demand: -1, supply: 2 }, PARAMS);
  near(shocked.pi - base.pi, 2, 'supply shock adds to pi');
  near(shocked.gap - base.gap, -1, 'demand shock adds to the gap');
  near(shocked.u - base.u, 0.5, 'and Okun turns that gap into unemployment');
});

test('credibility is earned above r* + 1, lost below r* - 2, and stays inside 0-1', () => {
  const zero = { demand: 0, supply: 0 };
  const hawk = Object.assign({}, INITIAL, { pi: 2, cred: 0.5 });      // real = 4.5 at a 6.5 rate
  near(FedModel.step(hawk, 6.5, zero, PARAMS).cred, 0.55, 'a real rate over 2 earns credibility');
  near(FedModel.step(Object.assign({}, hawk, { cred: 0.98 }), 6.5, zero, PARAMS).cred, 1, 'capped at 1');
  const neutral = Object.assign({}, INITIAL, { pi: 5.5, cred: 0.5 }); // real = 1.0 at a 6.5 rate
  near(FedModel.step(neutral, 6.5, zero, PARAMS).cred, 0.5, 'a neutral real rate changes nothing');
  near(FedModel.step(Object.assign({}, INITIAL, { cred: 0.02 }), 6.5, zero, PARAMS).cred, 0, 'floored at 0');
});

test('step leaves the state it was given untouched', () => {
  const before = Object.assign({}, INITIAL);
  FedModel.step(INITIAL, 9, { demand: -3, supply: 1 }, PARAMS);
  assert.deepEqual(INITIAL, before);
});

/* ===== shocksFor — the 1975 shock schedule ===== */

test('the scheduled shocks arrive on their quarters and nowhere else', () => {
  assert.deepEqual(FedModel.shocksFor(1, {}), { demand: -3, supply: 0 });
  assert.deepEqual(FedModel.shocksFor(2, {}), { demand: -1, supply: 2 });
  assert.deepEqual(FedModel.shocksFor(8, {}), { demand: -1.5, supply: 0 });
  [3, 5, 7, 9, 10].forEach((t) => {
    assert.deepEqual(FedModel.shocksFor(t, {}), { demand: 0, supply: 0 }, 'quarter ' + t + ' is quiet');
  });
});

test('the White House call only stimulates the economy if the Chair takes it', () => {
  assert.deepEqual(FedModel.shocksFor(4, { acceptedCall: true }), { demand: 2, supply: 0 });
  assert.deepEqual(FedModel.shocksFor(4, { acceptedCall: false }), { demand: 0, supply: 0 });
  assert.deepEqual(FedModel.shocksFor(4, {}), { demand: 0, supply: 0 });
});

test('the wage-price spiral fires in quarter 6 only after three quarters above 8', () => {
  const hot = [{ pi: 0 }, { pi: 0 }, { pi: 0 }, { pi: 8.5 }, { pi: 8.2 }, { pi: 8.1 }];
  assert.deepEqual(FedModel.shocksFor(6, { history: hot }), { demand: 0, supply: 1.5 });
  const cooled = [{ pi: 0 }, { pi: 0 }, { pi: 0 }, { pi: 8.5 }, { pi: 8.2 }, { pi: 7.9 }];
  assert.deepEqual(FedModel.shocksFor(6, { history: cooled }), { demand: 0, supply: 0 });
  const edge = [{ pi: 0 }, { pi: 0 }, { pi: 0 }, { pi: 8.5 }, { pi: 8 }, { pi: 8.5 }];
  assert.deepEqual(FedModel.shocksFor(6, { history: edge }), { demand: 0, supply: 0 }, 'exactly 8 is not above 8');
  assert.deepEqual(FedModel.shocksFor(6, {}), { demand: 0, supply: 0 }, 'no history, no spiral');
});

test('holding at 6.5 escapes the spiral but taking the call walks into it', () => {
  const held = run(POLICIES.hold).history.slice(0, 6);
  assert.deepEqual(FedModel.shocksFor(6, { history: held }), { demand: 0, supply: 0 });
  const took = run(POLICIES.acceptedCall).history.slice(0, 6);
  assert.deepEqual(FedModel.shocksFor(6, { acceptedCall: true, history: took }), { demand: 0, supply: 1.5 });
});

/* ===== simulate — ten quarters ===== */

test('a run is the opening state plus ten quarters', () => {
  const r = run(POLICIES.hold);
  assert.equal(r.history.length, 11);
  assert.deepEqual(r.history[0], { t: 1, pi: 11.0, u: 8.0, gap: -4.0, piExp: 11.0, rate: 6.50, cred: 0.1 },
    'quarter 1 is observed before any move');
  assert.equal(r.final, r.history[10]);
  assert.deepEqual(r.history.map((s) => s.t), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  near(r.peakU, Math.max.apply(null, r.history.slice(1).map((s) => s.u)), 'peak u over the ten quarters');
});

test('simulate clamps every requested rate and leaves its inputs alone', () => {
  const rates = rep(10, 14);
  const copy = rates.slice();
  const r = FedModel.simulate(rates, {});
  assert.deepEqual(rates, copy, 'the requested path is not rewritten');
  assert.deepEqual(FedModel.INITIAL_1975, { t: 1, pi: 11.0, u: 8.0, gap: -4.0, piExp: 11.0, rate: 6.50, cred: 0.1 });
  assert.deepEqual(r.history.slice(1).map((s) => s.rate), [7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14, 14, 14],
    'a point a turn until the ceiling');
});

test('simulate opens on a copy, so a caller cannot rewrite INITIAL_1975', () => {
  const r = FedModel.simulate(rep(10, 6.5), {});
  assert.notEqual(r.history[0], FedModel.INITIAL_1975, 'the opening state is a copy, not the constant');
  assert.deepEqual(r.history[0], FedModel.INITIAL_1975, 'and it still holds the same numbers');
  r.history[0].pi = 999;
  assert.equal(FedModel.INITIAL_1975.pi, 11.0, 'poking the run leaves the module constant alone');
  assert.equal(FedModel.simulate(rep(10, 6.5), {}).history[0].pi, 11.0, 'so the next run opens clean');
});

test('simulate copies a caller-supplied opening state too', () => {
  const mine = { t: 1, pi: 5, u: 7, gap: -2, piExp: 5, rate: 6, cred: 0.5 };
  const r = FedModel.simulate(rep(10, 6), { initial: mine });
  assert.notEqual(r.history[0], mine, 'the run does not alias the object it was handed');
  r.history[0].u = 42;
  assert.equal(mine.u, 7, 'and the caller keeps their own state intact');
});

/* ===== the five policies from the tuning simulation ===== */

Object.keys(POLICIES).forEach((name) => {
  const policy = POLICIES[name];
  test('the ' + name + ' policy ends where the tuning simulation put it', () => {
    const r = run(policy);
    within(r.final.pi, policy.pi, name + ' end pi');
    within(r.final.u, policy.u, name + ' end u');
    within(r.peakU, policy.peakU, name + ' peak u');
    const stamp = FedModel.score(r, { integrity: !policy.acceptedCall }).stamp;
    if (policy.stamp === null) assert.ok(stamp <= 3, name + ' stamp ' + stamp + ' should be at most 3');
    else assert.equal(stamp, policy.stamp, name + ' stamp');
  });
});

test('holding through the stagflation leaves inflation and unemployment both stuck', () => {
  const f = run(POLICIES.hold).final;
  assert.ok(f.pi >= 5.5 && f.pi <= 6.5, 'end pi ' + f.pi + ' outside 5.5-6.5');
  assert.ok(f.u >= 7.2 && f.u <= 8.2, 'end u ' + f.u + ' outside 7.2-8.2');
});

test('slamming the rate up kills inflation and buys a recession for it', () => {
  const f = run(POLICIES.aggressive).final;
  assert.ok(f.pi < 4, 'end pi ' + f.pi + ' should be under 4');
  assert.ok(f.u > 11, 'end u ' + f.u + ' should be over 11');
});

test('cutting into a supply shock leaves inflation in double digits', () => {
  assert.ok(run(POLICIES.cut).final.pi > 10, 'end pi should stay above 10');
});

test('the tuned path is a five-stamp run', () => {
  const s = FedModel.score(run(POLICIES.best), { integrity: true });
  assert.ok(s.raw >= 70, 'raw ' + s.raw + ' should reach 70');
  assert.equal(s.stamp, 5);
});

test('taking the White House call scores worse than refusing it on the same rates', () => {
  const rates = POLICIES.hold.rates;
  const refused = FedModel.score(FedModel.simulate(rates, { acceptedCall: false }), { integrity: true });
  const taken = FedModel.score(FedModel.simulate(rates, { acceptedCall: true }), { integrity: false });
  assert.ok(taken.raw < refused.raw, 'taken ' + taken.raw + ' should be under refused ' + refused.raw);
});

/* ===== the lag — the rate moves output next quarter and inflation the quarter after ===== */

test('the rate shows up in unemployment a quarter later and in inflation two', () => {
  const paths = [POLICIES.hold, POLICIES.aggressive, POLICIES.cut].map((p) => run(p).history);
  const at = (h, t) => h[t - 1];                   // the state the Chair sees at the start of quarter t
  paths.forEach((h) => near(at(h, 2).pi, at(paths[0], 2).pi, 'pi at quarter 2 is untouched by quarter 1\'s rate'));
  const u2 = paths.map((h) => at(h, 2).u);
  assert.ok(u2[0] !== u2[1] && u2[1] !== u2[2] && u2[0] !== u2[2], 'u at quarter 2 already differs: ' + u2);
  const pi3 = paths.map((h) => at(h, 3).pi);
  assert.ok(pi3[0] !== pi3[1] && pi3[1] !== pi3[2] && pi3[0] !== pi3[2], 'pi first differs at quarter 3: ' + pi3);
  assert.ok(pi3[1] < pi3[0] && pi3[0] < pi3[2], 'and it differs the right way round: ' + pi3);
});

/* ===== judgeMove — was that the move the moment called for? ===== */

test('with inflation high and the gap nearly closed, the move to make is a hike', () => {
  const hot = { pi: 6, gap: -1 };
  assert.equal(FedModel.judgeMove(hot, 7.0, 6.5), true);
  assert.equal(FedModel.judgeMove(hot, 6.75, 6.5), true, 'a quarter point still counts');
  assert.equal(FedModel.judgeMove(hot, 6.5, 6.5), false, 'holding is not tightening');
  assert.equal(FedModel.judgeMove(hot, 6.0, 6.5), false);
  assert.equal(FedModel.judgeMove({ pi: 5, gap: -2 }, 6.0, 5.5), true, 'a gap of exactly -2 still calls for a hike');
});

test('with a deep gap and inflation down, the move to make is a cut', () => {
  const slack = { pi: 5, gap: -4 };
  assert.equal(FedModel.judgeMove(slack, 5.5, 6.5), true);
  assert.equal(FedModel.judgeMove(slack, 6.5, 6.5), false, 'holding is not easing');
  assert.equal(FedModel.judgeMove(slack, 7.0, 6.5), false);
});

test('when the two mandates disagree, no move is the wrong move', () => {
  assert.equal(FedModel.judgeMove({ pi: 6, gap: -4 }, 7.0, 6.5), null, 'high inflation and a deep gap');
  assert.equal(FedModel.judgeMove({ pi: 6, gap: -4 }, 5.5, 6.5), null);
  assert.equal(FedModel.judgeMove({ pi: 3, gap: -1 }, 7.0, 6.5), null, 'inflation already low, gap nearly closed');
  assert.equal(FedModel.judgeMove({ pi: 4, gap: 0 }, 7.0, 6.5), null, 'exactly 4 is not high inflation');
  assert.equal(FedModel.judgeMove({ pi: 5, gap: -3 }, 5.5, 6.5), null, 'exactly -3 is not a deep gap');
});

test('judgeMove reads the previous rate off the state when it is not told one', () => {
  assert.equal(FedModel.judgeMove({ pi: 6, gap: -1, rate: 6.5 }, 7.0), true);
  assert.equal(FedModel.judgeMove({ pi: 6, gap: -1, rate: 6.5 }, 6.0), false);
});

/* ===== score ===== */

/** @param {number} pi @param {number} u @param {number} piExp @param {number} peakU */
function fakeRun(pi, u, piExp, peakU) {
  return { history: [], peakU: peakU, final: { pi: pi, u: u, piExp: piExp } };
}

test('a perfect landing scores every point on the card', () => {
  const s = FedModel.score(fakeRun(2, 6, 2, 8), { integrity: true });
  near(s.raw, 105, 'raw');
  assert.equal(s.stamp, 5);
});

test('score treats a run with no peakU as a run that never wrecked the labour market', () => {
  const s = FedModel.score({ final: { pi: 2, u: 6, piExp: 2 } }, { integrity: true });
  assert.ok(Number.isFinite(s.raw), 'raw is a number, not NaN: ' + s.raw);
  near(s.raw, 105, 'raw');
  assert.equal(s.stamp, 5, 'a perfect landing is not stamped 1 for a missing field');
});

test('score guards a NaN peakU the same way', () => {
  const s = FedModel.score({ peakU: NaN, final: { pi: 2, u: 6, piExp: 2 } }, {});
  near(s.raw, 100, 'raw without the integrity point');
  assert.equal(s.stamp, 5);
});

test('every term of the score clamps at zero instead of going negative', () => {
  const s = FedModel.score(fakeRun(20, 20, 20, 20), { integrity: false });
  near(s.raw, 0, 'raw');
  assert.equal(s.stamp, 1);
});

test('a middling run scores each term at half credit', () => {
  const s = FedModel.score(fakeRun(6.5, 8, 6.5, 9), { integrity: true });
  near(s.raw, 60, '20 + 15 + 15 + 5 + 5');
  assert.equal(s.stamp, 3);
});

test('integrity is worth five points and can move the stamp', () => {
  const honest = FedModel.score(fakeRun(11, 6.5, 11, 9), { integrity: true });
  const bought = FedModel.score(fakeRun(11, 6.5, 11, 9), { integrity: false });
  near(honest.raw - bought.raw, 5, 'the integrity point');
  near(bought.raw, 41.25, 'raw without it');
  assert.equal(honest.stamp, 2);
  assert.equal(bought.stamp, 1);
  assert.equal(FedModel.score(fakeRun(11, 6.5, 11, 9), {}).stamp, 1, 'integrity defaults to unearned');
});

test('the stamp thresholds are inclusive at 70, 65 and 55', () => {
  const at = (pi) => FedModel.score(fakeRun(pi, 6, 11, 12), { integrity: false });
  near(at(2).raw, 70, 'raw at the 5 line');
  assert.equal(at(2).stamp, 5);
  near(at(3.125).raw, 65, 'raw at the 4 line');
  assert.equal(at(3.125).stamp, 4);
  near(at(5.375).raw, 55, 'raw at the 3 line');
  assert.equal(at(5.375).stamp, 3);
  assert.equal(FedModel.score(fakeRun(2, 6.01, 11, 12), { integrity: false }).stamp, 4, 'a hair under 70');
  assert.equal(FedModel.score(fakeRun(3.15, 6, 11, 12), { integrity: false }).stamp, 3, 'a hair under 65');
  assert.equal(FedModel.score(fakeRun(5.4, 6, 11, 12), { integrity: false }).stamp, 2, 'a hair under 55');
});

/* ===== search — is holding actually a good policy? (no) ===== */

test('a random sample of legal rate paths finds better than holding at 6.5', () => {
  const holdRaw = FedModel.score(run(POLICIES.hold), { integrity: true }).raw;
  const best = FedModel.search({ n: 1500, rng: lcg(1975) });
  assert.equal(best.path.length, 10);
  assert.ok(best.raw >= holdRaw, 'best found ' + best.raw.toFixed(2) + ' should beat hold ' + holdRaw.toFixed(2));
  near(best.raw, FedModel.score(FedModel.simulate(best.path, {}), { integrity: true }).raw, 'the path replays to its score');
});

test('every path the search samples is one a player could have played', () => {
  const best = FedModel.search({ n: 200, rng: lcg(7) });
  let prev = INITIAL.rate;
  best.path.forEach((rate, i) => {
    assert.ok(rate >= FedModel.RATE_MIN && rate <= FedModel.RATE_MAX, 'quarter ' + (i + 1) + ' rate ' + rate + ' in range');
    near(Math.round(rate / FedModel.RATE_STEP) * FedModel.RATE_STEP, rate, 'quarter ' + (i + 1) + ' on the quarter-point grid');
    assert.ok(Math.abs(rate - prev) <= FedModel.MAX_MOVE + 1e-9, 'quarter ' + (i + 1) + ' moved ' + (rate - prev));
    prev = rate;
  });
});

/* ===== politics — the street, Washington, and the events they fire ===== */

const P = FedModel.POLITICS_1975;
const POL0 = FedModel.INITIAL_POLITICS;

/** A politics record with every counter at rest. @param {number} street @param {number} washington */
function pol(street, washington) {
  return { street: street, washington: washington, hot: 0, negRealRun: 0, posRealRun: 0, peakStreet: street };
}

/** @param {Object<string, any>} [over] @returns {any} a politicsView of a calm economy in quarter 6 */
function view(over) {
  return Object.assign({ street: 0, washington: 0, hot: 0, negRealRun: 0, posRealRun: 0, peakStreet: 0,
    stage: 0, t: 6, pi: 5, u: 6, cred: 0.1, real: 1.5 }, over || {});
}

/** @param {string} id */
function rule(id) { return FedModel.POLITICAL_EVENTS.find((r) => r.id === id); }

/** @param {any} r a simulate() result @returns {string[]} its events as "Q5:hearing/hold" */
function events(r) { return r.events.map((e) => 'Q' + e.t + ':' + e.id + (e.choice ? '/' + e.choice : '')); }

test('the politics constants and opening meters are the ones the game is tuned to', () => {
  assert.deepEqual(POL0, { street: 0.55, washington: 0.2, hot: 0, negRealRun: 0, posRealRun: 0, peakStreet: 0.55 });
  assert.equal(FedModel.CALL_QUARTER, 4);
  assert.deepEqual(FedModel.POLITICAL_EVENTS.map((r) => r.id),
    ['bill', 'whitehouse', 'hearing', 'strike', 'editorial', 'march', 'boycott', 'savers', 'bondRally', 'relief']);
  assert.equal(P.volckerReal, 2);
  assert.equal(P.brokenPromise, 0.40);
  assert.equal(P.endedCap, 30);
});

test('the street moves halfway to a target that weighs inflation over unemployment', () => {
  const econ = { t: 2, pi: 11, u: 8, gap: 0, piExp: 11, rate: 6.5, cred: 0.1, real: -4.5 };
  const next = FedModel.stepPolitics(POL0, econ, { move: 0 });
  near(next.street, 0.775, 'target 0.11*(11-3) + 0.04*(8-5) clamps to 1; street = 0.55 + 0.5*(1 - 0.55)');
  const calm = FedModel.stepPolitics(POL0, Object.assign({}, econ, { pi: 3, u: 5 }), { move: 0 });
  near(calm.street, 0.275, 'a 3-and-5 economy pulls the street halfway to zero');
  near(next.peakStreet, 0.775, 'peakStreet follows a rise');
  near(calm.peakStreet, 0.55, 'and remembers the worst through a fall');
});

test('washington climbs with unemployment above 8, twice as fast in 1976', () => {
  const base = { t: 2, pi: 5, u: 9, gap: -6, piExp: 5, rate: 6.5, cred: 0.1, real: 1.5 };   // street lands at 0.465: no spill
  near(FedModel.stepPolitics(POL0, base, { move: 0 }).washington, 0.25, 'a point above 8 costs 0.05');
  near(FedModel.stepPolitics(POL0, Object.assign({}, base, { t: 5 }), { move: 0 }).washington, 0.30, 'and 0.10 in an election quarter');
  near(FedModel.stepPolitics(POL0, Object.assign({}, base, { u: 8 }), { move: 0 }).washington, 0.20, 'exactly 8 is not above 8');
});

test('cutting relieves washington, hiking costs it, jobs under 7 cool it, a broken promise burns it', () => {
  const quiet = { t: 2, pi: 5, u: 7.5, gap: -3, piExp: 5, rate: 6.5, cred: 0.1, real: 1.5 };
  near(FedModel.stepPolitics(POL0, quiet, { move: -0.25 }).washington, 0.10, 'a cut of any size');
  near(FedModel.stepPolitics(POL0, quiet, { move: 0.25 }).washington, 0.25, 'a hike of any size');
  near(FedModel.stepPolitics(POL0, Object.assign({}, quiet, { u: 6.9 }), { move: 0 }).washington, 0.14, 'jobs under 7');
  near(FedModel.stepPolitics(POL0, quiet, { move: 0, brokenPromise: true }).washington, 0.60, 'a broken promise');
});

test('an angry street spills into washington above 0.6', () => {
  const hot = { t: 2, pi: 11, u: 8, gap: -4, piExp: 11, rate: 6.5, cred: 0.1, real: -4.5 };   // street lands at 0.775
  near(FedModel.stepPolitics(POL0, hot, { move: 0 }).washington, 0.2 + 0.10 * (0.775 - 0.6), 'spill = 0.10 x (street - 0.6); u of 8 adds nothing');
});

test('the counters: a hot street, and runs of negative and positive real rates', () => {
  const hot = { t: 2, pi: 11, u: 8, gap: -4, piExp: 11, rate: 6.5, cred: 0.1, real: -4.5 };
  let p = FedModel.stepPolitics(POL0, hot, {});
  assert.equal(p.hot, 1); assert.equal(p.negRealRun, 1); assert.equal(p.posRealRun, 0);
  p = FedModel.stepPolitics(p, hot, {});
  assert.equal(p.hot, 2); assert.equal(p.negRealRun, 2);
  p = FedModel.stepPolitics(p, Object.assign({}, hot, { pi: 3, u: 5, real: 2.5 }), {});
  assert.equal(p.hot, 0, 'a cool quarter resets it'); assert.equal(p.negRealRun, 0); assert.equal(p.posRealRun, 1);
  assert.equal(FedModel.stepPolitics(POL0, { t: 2, pi: 11, u: 8, rate: 6.5, cred: 0.1 }, {}).negRealRun, 1,
    'the real rate is read off rate - pi when the state carries none');
});

test('the meters never leave 0-1, and bump treats a missing effect as zero', () => {
  const top = FedModel.stepPolitics(pol(1, 0.99), { t: 5, pi: 14, u: 14, rate: 6.5, cred: 0 }, { move: 1, brokenPromise: true });
  assert.equal(top.street, 1); assert.equal(top.washington, 1);
  const floor = FedModel.bump(pol(0.05, 0.05), { street: -1, washington: -1 });
  assert.equal(floor.street, 0); assert.equal(floor.washington, 0); assert.equal(floor.peakStreet, 0.05);
  const up = FedModel.bump(pol(0.5, 0.5), { street: 0.3 });
  near(up.street, 0.8); near(up.washington, 0.5); near(up.peakStreet, 0.8, 'a bump can set a new peak');
});

test('dueEvent takes the first rule in order that has not fired, on its rung, in its quarter', () => {
  assert.equal(FedModel.dueEvent(view(), {}), null, 'a calm economy fires nothing');
  assert.equal(FedModel.dueEvent(view({ washington: 0.5 }), {}).id, 'hearing');
  assert.equal(FedModel.dueEvent(view({ washington: 0.5, t: 4 }), {}), null, 'the hearing waits for quarter 5');
  assert.equal(FedModel.dueEvent(view({ washington: 0.5 }), { hearing: true }), null, 'and fires once');
  assert.equal(FedModel.dueEvent(view({ washington: 0.99 }), {}).id, 'hearing', 'the ladder is climbed a rung at a time');
  assert.equal(FedModel.dueEvent(view({ washington: 0.99, stage: 1 }), {}).id, 'whitehouse');
  assert.equal(FedModel.dueEvent(view({ washington: 0.99, stage: 2 }), {}).id, 'bill');
  assert.equal(FedModel.dueEvent(view({ washington: 0.94, stage: 2 }), {}), null, 'the bill needs 0.95');
  assert.equal(FedModel.dueEvent(view({ street: 0.8, pi: 8, t: 7 }), {}).id, 'strike');
  assert.equal(FedModel.dueEvent(view({ street: 0.8, pi: 8, t: 6 }), {}), null, 'the strike waits for quarter 7');
  assert.equal(FedModel.dueEvent(view({ street: 0.8, pi: 7.9, t: 7, u: 9 }), {}).id, 'march', 'inflation under 8 is a march, not a strike');
  assert.equal(FedModel.dueEvent(view({ hot: 2, t: 7 }), {}).id, 'editorial');
  assert.equal(FedModel.dueEvent(view({ street: 0.6, pi: 9.5 }), {}).id, 'boycott');
  assert.equal(FedModel.dueEvent(view({ negRealRun: 2 }), {}).id, 'savers');
  assert.equal(FedModel.dueEvent(view({ posRealRun: 2 }), {}).id, 'bondRally');
  assert.equal(FedModel.dueEvent(view({ street: 0.4, peakStreet: 0.7 }), {}).id, 'relief');
  assert.equal(FedModel.dueEvent(view({ street: 0.4, peakStreet: 0.5 }), {}), null, 'relief needs a street that was once angry');
});

test('a card is its own effects; the hearing is held or promised', () => {
  assert.deepEqual(FedModel.resolveEvent(rule('strike'), null, view()), { effects: { supply: 1.0 }, flags: {}, ending: null });
  assert.notEqual(FedModel.resolveEvent(rule('strike'), null, view()).effects, rule('strike').effects, 'a copy, never the rule\'s own object');
  const held = FedModel.resolveEvent(rule('hearing'), 'hold', view());
  assert.deepEqual(held, { effects: { washington: 0.10 }, flags: {}, ending: null });
  assert.deepEqual(FedModel.resolveEvent(rule('hearing'), 'whatever', view()), held, 'anything that is not a promise holds');
  assert.deepEqual(FedModel.resolveEvent(rule('hearing'), 'promise', view()),
    { effects: { washington: -0.25, cred: -0.10 }, flags: { promised: true }, ending: null });
});

test('the bill is eased into, or held - and held only by a Fed the markets believe', () => {
  assert.deepEqual(FedModel.resolveEvent(rule('bill'), 'ease', view({ cred: 0, real: -2 })),
    { effects: { washington: -0.40, cred: -0.10, demand: 2 }, flags: { capitulated: true }, ending: null });
  assert.deepEqual(FedModel.resolveEvent(rule('bill'), 'hold', view({ cred: 0.05, real: 2 })),
    { effects: { washington: -0.35 }, flags: { volcker: true }, ending: null }, 'a real rate of 2 holds it');
  assert.deepEqual(FedModel.resolveEvent(rule('bill'), 'hold', view({ cred: 0.3, real: -1 })),
    { effects: { washington: -0.35 }, flags: { volcker: true }, ending: null }, 'so does credibility of 0.3');
  assert.deepEqual(FedModel.resolveEvent(rule('bill'), 'hold', view({ cred: 0.29, real: 1.99 })),
    { effects: {}, flags: {}, ending: 'congress' }, 'with neither, the bill passes');
});

test('the verdict: the bill, the revolt, the reappointment, or nothing to add', () => {
  assert.equal(FedModel.politicalVerdict(pol(0.9, 0.9), { ending: 'congress' }), 'congress', 'an ended term is its own story');
  assert.equal(FedModel.politicalVerdict(pol(0.75, 0.9), {}), 'revolt', 'the street outranks the White House');
  assert.equal(FedModel.politicalVerdict(pol(0.74, 0.7), {}), 'notReappointed');
  assert.equal(FedModel.politicalVerdict(pol(0.74, 0.69), {}), null);
});

test('score caps a term Congress ended at 30, which is a 1', () => {
  const ended = FedModel.score(fakeRun(2, 6, 2, 8), { integrity: true, ended: 'congress' });
  near(ended.raw, 30, 'raw');
  assert.equal(ended.stamp, 1);
  near(FedModel.score(fakeRun(2, 6, 2, 8), { integrity: true, ended: null }).raw, 105, 'a null ending caps nothing');
});

/* ===== the whole run with politics on - the calibration the game is tuned to ===== */

test('simulate without politics is unchanged; with politics it adds the meters, the events and the verdict', () => {
  const plain = FedModel.simulate(POLICIES.hold.rates, {});
  assert.equal(plain.politics, undefined); assert.equal(plain.events, undefined); assert.equal(plain.ending, undefined);
  const r = FedModel.simulate(POLICIES.hold.rates, { politics: true });
  assert.equal(r.politics.length, r.history.length, 'one politics entry per state');
  assert.deepEqual(r.politics[0], POL0);
  assert.notEqual(r.politics[0], POL0, 'a copy, not the constant');
  assert.equal(r.ending, null);
});

test('holding at 6.5 and refusing everyone: the march, the hearing, the White House - and no reappointment', () => {
  const r = FedModel.simulate(POLICIES.hold.rates, { politics: true });
  assert.deepEqual(events(r), ['Q2:march', 'Q3:boycott', 'Q4:savers', 'Q5:hearing/hold', 'Q6:whitehouse']);
  assert.equal(r.ending, null);
  assert.equal(r.verdict, 'notReappointed');
  assert.equal(r.history.length, 11, 'the term runs its course');
  const w = r.politics[10].washington;
  assert.ok(w >= 0.7 && w < 0.95, 'ends leaned on, short of the bill: ' + w);
  assert.equal(FedModel.score(r, { integrity: true, ended: r.ending }).stamp, 3);
});

test('the tuned best path survives Washington with a 5, whether it holds the line or promises to ease', () => {
  const held = FedModel.simulate(POLICIES.best.rates, { politics: true });
  assert.deepEqual(events(held), ['Q2:march', 'Q3:boycott', 'Q4:savers', 'Q5:hearing/hold']);
  assert.equal(held.verdict, null);
  assert.equal(FedModel.score(held, { integrity: true, ended: held.ending }).stamp, 5);
  const promised = FedModel.simulate(POLICIES.best.rates, { politics: true, decide: (id) => (id === 'hearing' ? 'promise' : 'hold') });
  assert.deepEqual(events(promised), ['Q2:march', 'Q3:boycott', 'Q4:savers', 'Q5:hearing/promise']);
  assert.ok(promised.politics[10].washington < held.politics[10].washington, 'a promise the path keeps - it cuts next quarter - leaves less pressure');
  assert.equal(FedModel.score(promised, { integrity: true, ended: promised.ending }).stamp, 5);
});

test('hiking a point a quarter brings the bill by Q7; a real rate above 2 holds it, and the White House remembers', () => {
  const r = FedModel.simulate(POLICIES.aggressive.rates, { politics: true });
  assert.deepEqual(events(r), ['Q2:march', 'Q3:boycott', 'Q5:hearing/hold', 'Q6:whitehouse', 'Q7:bill/hold', 'Q8:bondRally']);
  assert.equal(r.volcker, true); assert.equal(r.ending, null); assert.equal(r.capitulated, false);
  assert.equal(r.verdict, 'notReappointed');
  const eased = FedModel.simulate(POLICIES.aggressive.rates, { politics: true, decide: (id) => (id === 'bill' ? 'ease' : 'hold') });
  assert.equal(eased.capitulated, true); assert.equal(eased.volcker, false);
  assert.ok(eased.history[7].gap > r.history[7].gap, 'the forced easing lands on demand the next quarter');
  assert.ok(FedModel.score(eased, { integrity: false, ended: null }).raw < FedModel.score(r, { integrity: true, ended: null }).raw,
    'and it costs the integrity point');
});

test('a hawk with a real rate under 2 loses the dial: the term ends on the bill', () => {
  const hawk = [7.5, 8.5, 9.0, 9.0, 8.5, 8.0, 7.5, 7.0, 6.5, 6.0];
  const r = FedModel.simulate(hawk, { politics: true });
  assert.deepEqual(events(r).slice(-1), ['Q7:bill/hold']);
  assert.equal(r.ending, 'congress'); assert.equal(r.verdict, 'congress');
  assert.equal(r.history.length, 7, 'six quarters played; the seventh opens on the bill and never runs');
  assert.equal(r.final, r.history[6]);
  assert.equal(r.politics.length, 7);
  assert.equal(FedModel.score(r, { integrity: true, ended: r.ending }).stamp, 1);
});

test('cutting into the shock keeps inflation in double digits: the strike, the editorial, the revolt', () => {
  const r = FedModel.simulate(POLICIES.cut.rates, { politics: true });
  assert.deepEqual(events(r), ['Q2:march', 'Q3:boycott', 'Q4:savers', 'Q7:strike', 'Q8:editorial']);
  const plain = FedModel.simulate(POLICIES.cut.rates, {});
  near(r.history[7].pi - plain.history[7].pi, 1.0, 'the strike is a one-point supply shock on the quarter after it');
  assert.equal(r.verdict, 'revolt');
  assert.ok(r.politics[10].washington < 0.45, 'Washington got the cuts it wanted: ' + r.politics[10].washington);
});

test('taking the call pleases Washington and enrages the street', () => {
  const refused = FedModel.simulate(POLICIES.hold.rates, { politics: true, acceptedCall: false });
  const taken = FedModel.simulate(POLICIES.hold.rates, { politics: true, acceptedCall: true });
  near(refused.politics[3].washington - taken.politics[3].washington, 0.40, 'the call opens quarter 4: +0.25 refused, -0.15 taken');
  assert.ok(events(taken).indexOf('Q5:hearing/hold') < 0, 'no hearing for a Chair who did as asked');
  assert.ok(events(taken).indexOf('Q7:strike') >= 0 && events(taken).indexOf('Q8:editorial') >= 0, 'but the inflation it buys brings the street out');
  assert.ok(taken.politics[10].street > refused.politics[10].street);
  assert.equal(FedModel.simulate(POLICIES.best.rates, { politics: true, acceptedCall: true }).verdict, 'revolt',
    'even the tuned path ends in the revolt once it takes the call');
});

test('a promise to ease that is not kept costs more than holding the line would have', () => {
  const stay = rep(10, 6.5);
  const kept = stay.slice(); kept[4] = 6.25;          // quarter 5: the first quarter after a hearing that opens it
  const promise = (id) => (id === 'hearing' ? 'promise' : 'hold');
  const broken = FedModel.simulate(stay, { politics: true, decide: promise });
  const honoured = FedModel.simulate(kept, { politics: true, decide: promise });
  const held = FedModel.simulate(stay, { politics: true });
  assert.equal(events(broken)[3], 'Q5:hearing/promise');
  const gap = broken.politics[5].washington - honoured.politics[5].washington;
  assert.ok(Math.abs(gap - 0.50) < 0.02, 'broken: +0.40, and no cut relief either: ' + gap.toFixed(3));
  assert.ok(broken.politics[5].washington > held.politics[5].washington, 'worse off than having held the line');
});

test('search with politics on still finds a 5 while holding the line at every choice', () => {
  const best = FedModel.search({ n: 3000, rng: lcg(1975), politics: true });
  assert.equal(best.stamp, 5, 'best raw ' + best.raw.toFixed(1));
  const replay = FedModel.simulate(best.path, { politics: true });
  assert.equal(replay.ending, null);
  near(best.raw, FedModel.score(replay, { integrity: !replay.capitulated, ended: replay.ending }).raw, 'the path replays to its score');
});

/* ===== the eras — four crises as data, and the model reading them ===== */

const ERAS = FedModel.ERAS;

test('the four eras are data the game can read, in the order it lists them', () => {
  assert.deepEqual(FedModel.ERA_IDS, ['1975', '1980', '2008', '2021']);
  FedModel.ERA_IDS.forEach((id) => {
    const e = ERAS[id];
    assert.equal(typeof e.chair, 'string');
    assert.equal(e.year, Number(id));
    ['k', 'rStar', 'rho', 'phi', 'FLOOR', 'a', 'uStar', 'piStar', 'lambda', 'okun'].forEach((key) => assert.equal(typeof e.params[key], 'number', id + ' params.' + key));
    assert.equal(e.initial.t, 1);
    assert.ok(e.initial.rate >= e.band.min && e.initial.rate <= e.band.max, id + ' opens inside its band');
    ['pi', 'u', 'rate'].forEach((s) => assert.equal(e.history[s].length, 10, id + ' history.' + s));
    assert.ok(Math.abs(e.history.pi[0] - e.initial.pi) <= 0.3, id + ' opens where its history opens');
    assert.ok(e.band.min < e.band.max && e.band.step > 0 && e.band.move >= e.band.step, id + ' band');
    assert.equal(typeof e.score.uStar, 'number'); assert.equal(typeof e.score.peakBar, 'number');
    assert.ok(e.call.t >= 2 && e.call.t <= 9, id + ' call quarter');
    assert.equal(typeof e.shocks, 'function');
    assert.deepEqual(e.shocks(99), { demand: 0, supply: 0 }, id + ' quiet quarters are zero');
  });
  assert.deepEqual(ERAS['1975'].band, FedModel.BAND_1975);
  assert.equal(ERAS['1975'].params, FedModel.PARAMS_1975);
  assert.equal(ERAS['1975'].history, FedModel.HISTORY_1975);
});

test('each era keeps the rate inside its own band and move limit', () => {
  assert.equal(FedModel.clampRate(0, 0.5, ERAS['2008'].band), 0.25, '2008 has a floor at a quarter point');
  assert.equal(FedModel.clampRate(20, 15, ERAS['1980'].band), 17, 'Volcker moves two points a quarter');
  assert.equal(FedModel.clampRate(3, 0.25, ERAS['2021'].band), 1.75, '2022 moves a point and a half');
  assert.equal(FedModel.clampRate(9, 6.5), 7.5, 'the two-argument form is still 1975');
});

test('eraShocks adds the pressure beat the Chair chose, and 1975 reads as it always did', () => {
  assert.deepEqual(FedModel.eraShocks('1975', 4, { acceptedCall: true }), FedModel.shocksFor(4, { acceptedCall: true }));
  assert.deepEqual(FedModel.eraShocks('1975', 4, {}), { demand: 0, supply: 0 });
  assert.deepEqual(FedModel.eraShocks('2008', 4, { acceptedCall: true }), { demand: -3, supply: -3 }, 'a backstopped Lehman on top of the oil crash');
  assert.deepEqual(FedModel.eraShocks('2008', 4, {}), { demand: -4, supply: -3 }, 'a failed Lehman');
  assert.deepEqual(FedModel.eraShocks('2008', 5, {}), { demand: -4.5, supply: -1.5 }, 'and its second instalment');
  assert.deepEqual(FedModel.eraShocks('2021', 3, { acceptedCall: true }), { demand: 1, supply: 1.5 }, 'bond buying kept going');
  assert.deepEqual(FedModel.eraShocks('2008', 7, { qeAt: 5 }), { demand: 0.5 + 0.6, supply: 1.5 }, 'QE is worth 0.6 a quarter once launched');
  assert.deepEqual(FedModel.eraShocks('2008', 4, { qeAt: 5 }), { demand: -4, supply: -3 }, 'and nothing before');
  assert.deepEqual(FedModel.eraShocks('1980', 4, { qeAt: 2 }), { demand: 0, supply: 0 }, 'no QE in an era without a floor');
});

test('simulate opens each era on a copy of its own state and never reads unemployment below the floor', () => {
  FedModel.ERA_IDS.forEach((id) => {
    const e = ERAS[id];
    const r = FedModel.simulate(rep(10, e.initial.rate), { era: id });
    assert.deepEqual(r.history[0], e.initial, id);
    assert.notEqual(r.history[0], e.initial, id + ' is a copy');
    assert.equal(r.history.length, 11);
  });
  const floor = FedModel.simulate(rep(10, 5), { era: '1980' });   // cutting into 14% inflation
  assert.ok(floor.history.every((s) => s.u >= FedModel.U_FLOOR), 'u never goes below ' + FedModel.U_FLOOR);
  assert.equal(floor.final.u, FedModel.U_FLOOR);
});

test('QE only counts when it is launched at the floor', () => {
  const path = [2, 1, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25];
  const plain = FedModel.simulate(path, { era: '2008' });
  const qe = FedModel.simulate(path, { era: '2008', qeAt: 4 });
  assert.ok(qe.final.u < plain.final.u - 1, 'QE from quarter 4 brings unemployment down: ' + qe.final.u + ' vs ' + plain.final.u);
  const tooEarly = FedModel.simulate(path, { era: '2008', qeAt: 2 });   // the rate that quarter is 1, not the floor
  assert.deepEqual(tooEarly.history.map((s) => s.u), plain.history.map((s) => s.u), 'a launch above the floor never happens');
});

test('judgeMove says nothing about a cut at the floor or a hike at the ceiling', () => {
  assert.equal(FedModel.judgeMove({ pi: 1, gap: -9 }, 0.25, 0.25, ERAS['2008'].band), null, 'no cut to make at 0.25');
  assert.equal(FedModel.judgeMove({ pi: 1, gap: -9 }, 0.5, 1.0, ERAS['2008'].band), true, 'a cut above the floor still counts');
  assert.equal(FedModel.judgeMove({ pi: 10, gap: 0 }, 20, 20, ERAS['1980'].band), null, 'no hike to make at 20');
  assert.equal(FedModel.judgeMove({ pi: 10, gap: 0 }, 19, 19, ERAS['1980'].band), false, 'holding a point below the ceiling is not tightening');
  assert.equal(FedModel.judgeMove({ pi: 5, gap: -4 }, 2, 2), null, '1975 at its own floor');
});

test('score grades against the era: its natural rate, its bloodbath bar, and 2021\'s tighter yardstick', () => {
  near(FedModel.score(fakeRun(2, 5, 2, 9.5), { integrity: true, era: '2008' }).raw, 105, '5% unemployment is the 2008 natural rate');
  near(FedModel.score(fakeRun(2, 6, 2, 9.5), { integrity: true, era: '2008' }).raw, 97.5, 'a point off it');
  near(FedModel.score(fakeRun(4.5, 4, 2, 4), { integrity: true, era: '2021' }).raw, 85, '2021: |4.5 - 2| / 5 leaves half the inflation points');
  near(FedModel.score(fakeRun(4.5, 6, 4.5, 8), { integrity: true }).raw, 40 * (1 - 2.5 / 9) + 30 + 20 + 10 * (1 - 2.5 / 9) + 5, '1975 keeps its span of 9');
});

test('the politics are the era\'s: election quarters, and a bailout that angers the street either way', () => {
  assert.deepEqual(FedModel.politicsFor('1975').electionQuarters, [5, 6, 7, 8]);
  assert.deepEqual(FedModel.politicsFor('1980').electionQuarters, [1, 2, 3, 4]);
  assert.deepEqual(FedModel.politicsFor('2008').electionQuarters, [1, 2, 3, 4]);
  assert.deepEqual(FedModel.politicsFor('2021').electionQuarters, [5, 6, 7, 8]);
  assert.equal(FedModel.politicsFor('2021').hikeCost, 0.10);
  assert.equal(FedModel.politicsFor('1980').hikeCost, 0.05, 'an override leaves the rest of 1975 in place');
  assert.deepEqual(FedModel.callBump(ERAS['1975'], false, FedModel.politicsFor('1975')), { washington: 0.25 });
  assert.deepEqual(FedModel.callBump(ERAS['1975'], true, FedModel.politicsFor('1975')), { washington: -0.15 });
  assert.deepEqual(FedModel.callBump(ERAS['2008'], true, FedModel.politicsFor('2008')), { street: 0.25, washington: 0.10 });
  assert.deepEqual(FedModel.callBump(ERAS['2008'], false, FedModel.politicsFor('2008')), { street: 0.10, washington: 0.20 });
});

/** @param {string} era @param {number[]} rates @param {any} [opts] */
function eraRun(era, rates, opts) {
  const o = Object.assign({ era, politics: true }, opts || {});
  const r = FedModel.simulate(rates, o);
  const call = ERAS[era].call;
  const integrity = call.integrityFor === null ? false : (call.integrityFor === 'refuse') !== !!o.acceptedCall;
  return Object.assign(r, { stamp: FedModel.score(r, { integrity: integrity && !r.capitulated, ended: r.ending, era }).stamp });
}

test('1980: Volcker\'s own path is a 3, a measured squeeze is a 5, and slamming 20% survives Congress but not the White House', () => {
  const actual = eraRun('1980', ERAS['1980'].history.rate);
  assert.equal(actual.stamp, 3, 'actual ' + actual.final.pi.toFixed(1) + '/' + actual.final.u.toFixed(1));
  assert.ok(Math.abs(actual.final.u - ERAS['1980'].history.u[9]) <= 1.5, 'the model lands near the real 1982 unemployment: ' + actual.final.u.toFixed(1) + ' vs ' + ERAS['1980'].history.u[9]);
  const slam = eraRun('1980', rep(10, 20));
  assert.equal(slam.volcker, true, 'the bill comes and a real rate over 2 holds it');
  assert.equal(slam.verdict, 'notReappointed');
  assert.ok(slam.peakU > 12, 'and the cost is a depression: ' + slam.peakU.toFixed(1));
  const cut = eraRun('1980', rep(10, 5));
  assert.equal(cut.verdict, 'revolt', 'cutting into 14% inflation ends in the revolt');
  assert.equal(FedModel.search({ era: '1980', n: 3000, rng: lcg(1980), politics: true }).stamp, 5);
});

test('2008: the real path is a 3, holding at 3% is worse, Lehman rescued is worth a stamp, QE at the floor is the 5', () => {
  const actual = eraRun('2008', ERAS['2008'].history.rate);
  assert.equal(actual.stamp, 3, 'actual ' + actual.final.pi.toFixed(1) + '/' + actual.final.u.toFixed(1));
  assert.ok(actual.peakU > 9.5 && actual.peakU < 11.5, 'unemployment peaks near ten: ' + actual.peakU.toFixed(1));
  assert.ok(actual.history.some((s) => s.pi < 0), 'a brush with deflation in 2009');
  assert.ok(eraRun('2008', rep(10, 3)).stamp <= 2, 'a Fed that never cuts');
  const rescued = eraRun('2008', ERAS['2008'].history.rate, { acceptedCall: true });
  assert.ok(rescued.stamp > actual.stamp, 'a backstopped Lehman is a milder crash');
  const floorFast = [2, 1, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25];
  assert.equal(eraRun('2008', floorFast, { qeAt: 3 }).stamp, 5);
  const best = FedModel.search({ era: '2008', n: 2000, rng: lcg(2008), politics: true });
  const bestQE = FedModel.search({ era: '2008', n: 2000, rng: lcg(2008), politics: true, qeAt: 3 });
  assert.ok(bestQE.raw > best.raw + 5, 'QE is the tool the floor leaves: ' + bestQE.raw.toFixed(1) + ' vs ' + best.raw.toFixed(1));
});

test('2021: the real path is a 4, sitting at zero is a 3 and the street, an early hiking cycle is the 5', () => {
  const actual = eraRun('2021', ERAS['2021'].history.rate);
  assert.equal(actual.stamp, 4, 'actual ' + actual.final.pi.toFixed(1) + '/' + actual.final.u.toFixed(1));
  assert.ok(Math.max.apply(null, actual.history.map((s) => s.pi)) > 7, 'inflation peaks above 7 on the real path');
  const zero = eraRun('2021', rep(10, 0.25));
  assert.equal(zero.stamp, 3);
  assert.equal(zero.verdict, 'revolt', 'two years of 6% inflation brings the street out');
  assert.equal(actual.verdict, null, 'a Fed the street can see hiking is neither run out of town nor denied a second term: street ' + actual.politics[10].street.toFixed(2) + ' washington ' + actual.politics[10].washington.toFixed(2));
  const early = eraRun('2021', [0.25, 1.0, 2.0, 3.0, 4.0, 4.5, 4.5, 4.5, 4.5, 4.5]);
  assert.equal(early.stamp, 5, 'hiking from quarter 2: ' + early.final.pi.toFixed(1) + '/' + early.final.u.toFixed(1));
  assert.ok(early.events.some((e) => e.id === 'hearing'), 'and the Senate notices');
  assert.ok(eraRun('2021', ERAS['2021'].history.rate, { acceptedCall: true }).stamp < actual.stamp, 'keeping the bond buying going costs a stamp');
  assert.equal(FedModel.search({ era: '2021', n: 2000, rng: lcg(2021), politics: true }).stamp, 5);
});
