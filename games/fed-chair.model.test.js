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
