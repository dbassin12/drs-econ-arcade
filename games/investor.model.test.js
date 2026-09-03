// @ts-check
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./investor.model.js');

const calm = { rate: 4, dRate: 0, inflation: 2, growth: 2, shock: null };

test('bond prices move inverse to rates, more than the coupon can cover on a real move', () => {
  const up = M.returns({ ...calm, dRate: 1 }, { cdRate: 0 });
  const down = M.returns({ ...calm, dRate: -1 }, { cdRate: 0 });
  const flat = M.returns(calm, { cdRate: 0 });
  assert.ok(up.bonds < 0, 'a one-point hike costs bondholders: ' + up.bonds);
  assert.ok(down.bonds > flat.bonds && flat.bonds > up.bonds);
  assert.equal(flat.bonds, M.RULES.bondCoupon, 'no move: the coupon alone');
});

test('cash earns the short rate and inflation eats it', () => {
  const r = M.returns({ ...calm, rate: 4, inflation: 8 }, { cdRate: 0 });
  assert.equal(r.cash, 1, 'a 4% rate pays 1% a quarter');
  assert.ok(M.realReturn(r.cash, 8) < 0, 'negative in real terms under 8% inflation');
  assert.ok(M.realReturn(1, 2) > 0);
  assert.equal(M.realReturn(0, 0), 0);
});

test('a CD locks the rate it was bought at', () => {
  const s0 = M.initial();
  const bought = M.step(s0, [0, 10, 0, 0, 0], { ...calm, rate: 4 });
  assert.equal(bought.cdRate, 4.5, 'locked at the short rate plus the spread');
  const later = M.step(bought, [0, 10, 0, 0, 0], { ...calm, rate: 8 });
  assert.ok(Math.abs(later.returns.cd - 4.5 / 4) < 0.01, 'still the old rate after rates rose: ' + later.returns.cd);
  const sold = M.step(later, [10, 0, 0, 0, 0], { ...calm, rate: 8 });
  assert.equal(sold.cdRate, 0, 'selling out of the CD forgets the lock');
});

test('stocks like growth and hate hikes; real estate hates rising mortgage rates', () => {
  const boom = M.returns({ ...calm, growth: 5 }, { cdRate: 0 });
  const bust = M.returns({ ...calm, growth: -2 }, { cdRate: 0 });
  assert.ok(boom.stocks > bust.stocks && boom.realestate > bust.realestate);
  const spike = M.returns({ ...calm, dRate: 0.75 }, { cdRate: 0 });
  assert.ok(spike.stocks < M.RULES.stockBase && spike.realestate < M.RULES.reBase);
  const cut = M.returns({ ...calm, dRate: -0.5 }, { cdRate: 0 });
  assert.equal(cut.stocks, M.RULES.stockBase, 'a cut is not a spike: no stock penalty');
  assert.ok(cut.realestate > M.RULES.reBase, 'a cut helps real estate');
});

test('shocks land on the asset they name', () => {
  const crash = M.returns({ ...calm, shock: 'crash' }, { cdRate: 0 });
  assert.ok(crash.stocks <= -10);
  assert.equal(crash.bonds, M.RULES.bondCoupon, 'bonds untouched by a stock crash');
  const flight = M.returns({ ...calm, shock: 'flight' }, { cdRate: 0 });
  assert.ok(flight.bonds > M.RULES.bondCoupon && flight.stocks < 0);
  const unknown = M.returns({ ...calm, shock: 'nothing-of-the-sort' }, { cdRate: 0 });
  assert.deepEqual(unknown, M.returns(calm, { cdRate: 0 }), 'an unknown shock is no shock');
});

test('a step keeps the accounting honest', () => {
  const s = M.step(M.initial(), [2, 2, 2, 2, 2], { ...calm, inflation: 4 });
  const gains = Object.values(s.gains).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(s.value - (10000 + gains)) < 0.05, 'value = start + the gains');
  assert.equal(s.priceLevel, 1.01, 'four percent a year is one percent a quarter');
  assert.ok(s.realValue < s.value, 'the real value is deflated');
  assert.ok(s.realPct < s.nominalPct);
  assert.throws(() => M.step(M.initial(), [5, 5, 5, 0, 0], calm), /ten coins/);
  assert.ok(M.validCoins([10, 0, 0, 0, 0]) && !M.validCoins([9, 0, 0, 0, 0]) && !M.validCoins([2.5, 2.5, 5, 0, 0]));
});

const scenario = {
  rate0: 5, highInflation: false,
  quarters: [
    { dRate: 0, inflation: 3, growth: 2 }, { dRate: 0, inflation: 3, growth: 2 }, { dRate: -0.5, inflation: 2.5, growth: 2 },
    { dRate: 0, inflation: 2.5, growth: 2, shock: 'crash' }, { dRate: -0.5, inflation: 2, growth: 1 }, { dRate: 0, inflation: 2, growth: 2, shock: 'rally' }
  ]
};

test('simulate walks the rate path and reports a real result', () => {
  const out = M.simulate(scenario, () => [2, 2, 2, 2, 2]);
  assert.equal(out.history.length, 6);
  assert.equal(out.history[3].q.rate, 4.5, 'the cut in Q3 lowers the rate for Q4');
  assert.ok(out.realValue < out.finalValue);
  assert.ok(M.benchmark(scenario) >= out.realPct, 'par is at least the balanced result');
  assert.ok(M.benchmark(scenario) >= M.simulate(scenario, () => [10, 0, 0, 0, 0]).realPct, 'and at least all cash');
});

test('the stamp is earned against the balanced-portfolio par', () => {
  assert.equal(M.stamp(10, 2), 5);
  assert.equal(M.stamp(5, 2), 4);
  assert.equal(M.stamp(1, 2), 3);
  assert.equal(M.stamp(-4, 2), 2);
  assert.equal(M.stamp(-10, 2), 1);
});

test('lessonFor names what mattered most in the quarter', () => {
  const rets = M.returns(calm, { cdRate: 0 });
  assert.equal(M.lessonFor({ ...calm, shock: 'crash' }, rets), 'crash');
  assert.equal(M.lessonFor({ ...calm, dRate: 0.5 }, rets), 'bondsDown');
  assert.equal(M.lessonFor({ ...calm, dRate: -0.25 }, rets), 'bondsUp');
  assert.equal(M.lessonFor({ ...calm, inflation: 7 }, rets), 'realVsNominal');
  assert.equal(M.lessonFor(calm, { cash: 1, cd: 1.5 }), 'cdLock');
  assert.equal(M.lessonFor(calm, rets), 'transmission');
});

test('badges: the bond whisperer, the inflation survivor, diamond hands', () => {
  const bonds = M.simulate(scenario, () => [0, 0, 5, 5, 0]);
  const b = M.badges(scenario, bonds.history, bonds.realPct);
  assert.ok(b.includes('bondWhisperer'), 'bonds through a cut');
  assert.ok(b.includes('diamondHands'), 'stocks held through the crash to the rally');
  assert.ok(!b.includes('inflationSurvivor'), 'not a high-inflation run');
  const cash = M.simulate(scenario, () => [10, 0, 0, 0, 0]);
  assert.deepEqual(M.badges(scenario, cash.history, cash.realPct), []);
  const hot = { ...scenario, highInflation: true };
  const hotRun = M.simulate(hot, () => [0, 0, 0, 5, 5]);
  assert.equal(M.badges(hot, hotRun.history, 1).includes('inflationSurvivor'), true);
  assert.equal(M.badges(hot, hotRun.history, -1).includes('inflationSurvivor'), false);
});
