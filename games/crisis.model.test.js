// @ts-check
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./crisis.model.js');

test('every card has a name, a kind, an emoji and an FRQ chain', () => {
  for (const [id, c] of Object.entries(M.CARDS)) {
    assert.ok(c.name && c.emoji, id);
    assert.ok(['fiscal', 'monetary', 'exchange', 'trade', 'imf', 'none'].includes(c.kind), id + ' kind');
    assert.ok(c.chain.length >= 60 && /[.;]$/.test(c.chain), id + ' has a chain');
  }
  assert.ok(M.CARD_IDS.includes('hold'));
});

test('the hand depends on the bank’s independence and the exchange regime', () => {
  const s = M.blank();
  let h = M.hand(s);
  assert.ok(h.includes('lean') && !h.includes('hike') && !h.includes('print'), 'an independent bank keeps the rate cards away');
  assert.ok(h.includes('controls') && h.includes('devalue') && !h.includes('defend'));
  h = M.hand({ ...s, independent: false, regime: 'peg' });
  assert.ok(h.includes('hike') && h.includes('cut') && h.includes('print') && !h.includes('lean'));
  assert.ok(h.includes('float') && h.includes('defend') && h.includes('devalue'));
  assert.equal(new Set(h).size, h.length, 'no duplicates');
});

test('public works: AD right — output up, inflation up, unemployment down, debt up', () => {
  const s = { ...M.blank(), gap: -3, u: 6.5, pi: 2 };
  const n = M.step(s, 'spend');
  assert.ok(n.gap > s.gap * (1 - M.DYN.gapDecay), 'the gap closes faster than on its own');
  assert.ok(n.u < s.u && n.debt > s.debt && n.pop > s.pop);
  const held = M.step(s, 'hold');
  assert.ok(n.pi > held.pi, 'and prices rise more than holding course');
});

test('a rate hike: AD left, the currency appreciates; a cut does the reverse', () => {
  const s = { ...M.blank(), independent: false, gap: 2, pi: 7 };
  const hike = M.step(s, 'hike');
  const cut = M.step(s, 'cut');
  assert.ok(hike.gap < cut.gap && hike.pi < cut.pi && hike.e > cut.e && hike.u > cut.u);
  assert.ok(hike.e > s.e && cut.e < s.e);
});

test('printing money is a trap: inflation and expectations jump, the currency falls', () => {
  const s = { ...M.blank(), independent: false, pi: 12, exp: 10 };
  const printed = M.step(s, 'print');
  const held = M.step(s, 'hold');
  assert.ok(printed.pi > held.pi + 2 && printed.exp > held.exp && printed.e < held.e);
  let t = s;
  for (let i = 0; i < 8; i += 1) t = M.step(t, 'print');
  assert.ok(t.pi >= 40, 'eight turns of printing is hyperinflation: ' + t.pi);
  assert.equal(M.ended(t), 'hyperinflation');
});

test('leaning on the bank ends its independence and unmoors expectations; a reform restores the anchor', () => {
  const s = M.blank();
  const n = M.step(s, 'lean');
  assert.equal(n.independent, false);
  assert.ok(n.exp > s.exp);
  assert.ok(M.hand(n).includes('print') && M.hand(n).includes('reform'));
  const hot = { ...n, pi: 18, exp: 16 };
  const fixed = M.step(hot, 'reform');
  assert.equal(fixed.independent, true, 'the bank is independent again');
  assert.ok(fixed.exp < hot.exp - 4 && fixed.pi < hot.pi - 3, 'expectations and prices drop on the new anchor');
  assert.ok(!M.hand(fixed).includes('print') && !M.hand(fixed).includes('reform'), 'and the printing press is gone');
});

test('a peg under pressure bleeds reserves; controls stop it; out of reserves it breaks', () => {
  const s = { ...M.blank(), regime: 'peg', reserves: 1.5, pressure: 2 };
  const bleed = M.step(s, 'hold', { pressure: 2 });
  assert.ok(bleed.reserves < s.reserves, 'reserves fall under pressure');
  const held = M.step(s, 'controls', { pressure: 2 });
  assert.ok(held.reserves > bleed.reserves, 'controls stop the drain');
  let t = s;
  for (let i = 0; i < 6 && t.regime === 'peg'; i += 1) t = M.step(t, 'defend', { pressure: 3 });
  assert.equal(t.regime, 'float', 'the peg breaks when reserves run out');
  assert.ok(t.broke && t.e < s.e - 10, 'and the currency drops');
});

test('a devaluation lifts output and prices and rebuilds reserves', () => {
  const s = { ...M.blank(), gap: -2, reserves: 1.5, regime: 'peg' };
  const n = M.step(s, 'devalue');
  const h = M.step(s, 'hold');
  assert.ok(n.e < h.e - 10 && n.gap > h.gap && n.pi > h.pi && n.reserves > h.reserves);
});

test('tariffs help this turn and hurt the next; a trade deal does the reverse', () => {
  const s = { ...M.blank(), gap: -1 };
  const t1 = M.step(s, 'tariff');
  assert.ok(t1.gap > M.step(s, 'hold').gap && t1.pi > M.step(s, 'hold').pi);
  const t2 = M.step(t1, 'hold');
  const t2h = M.step({ ...t1, reply: 0 }, 'hold');
  assert.ok(t2.gap < t2h.gap, 'retaliation lands the turn after');
  const d1 = M.step(s, 'tradedeal');
  assert.ok(d1.reply > 0 && d1.pi < M.step(s, 'hold').pi);
});

test('an independent bank moves on its own when the shock says so', () => {
  const s = { ...M.blank(), gap: -3 };
  const n = M.step(s, 'hold', { bank: 'cut' });
  assert.equal(n.bank, 'cut');
  assert.ok(n.gap > M.step(s, 'hold').gap);
  const leaned = M.step({ ...s, independent: false }, 'hold', { bank: 'cut' });
  assert.equal(leaned.bank, null, 'a captured bank does nothing on its own');
});

test('the economy self-corrects, Phillips sets inflation, Okun sets unemployment', () => {
  const s = { ...M.blank(), gap: -4, pi: 1, exp: 2 };
  const n = M.step(s, 'hold');
  assert.ok(n.gap > s.gap && n.gap < 0, 'part of the gap closes on its own');
  assert.ok(Math.abs(n.u - (M.U_STAR - M.DYN.okun * n.gap)) < 0.11, 'Okun');
  assert.ok(n.pi < M.PI_TARGET, 'a negative gap keeps inflation low');
  const hot = M.step({ ...M.blank(), gap: 4 }, 'hold');
  assert.ok(hot.pi > M.PI_TARGET && hot.u < M.U_STAR);
});

test('the public: unemployment costs popularity, beating inflation earns it, and it drifts toward 50', () => {
  const calm = M.step({ ...M.blank(), pop: 30 }, 'hold');
  assert.ok(calm.pop > 30, 'drift up from 30');
  const jobless = M.step({ ...M.blank(), gap: -6, pop: 60 }, 'hold');
  assert.ok(jobless.pop < 60, 'a deep slump costs popularity');
  const hot = M.step({ ...M.blank(), gap: 3, pi: 12, exp: 12, pop: 60 }, 'hold');
  assert.ok(hot.pop < 60, 'inflation that does not fall costs popularity');
  const cured = M.step({ ...M.blank(), independent: false, pi: 20, exp: 8, pop: 40 }, 'hike');
  assert.ok(cured.pi < 20 && cured.pop > 40, 'inflation falling fast is the one popular medicine');
});

test('stability, endings and the score', () => {
  assert.ok(M.stable(M.blank()).ok);
  assert.ok(!M.stable({ ...M.blank(), pi: 9 }).inflation);
  assert.ok(!M.stable({ ...M.blank(), u: 8 }).jobs);
  assert.ok(!M.stable({ ...M.blank(), reserves: 1 }).reserves);
  assert.equal(M.ended(M.blank()), null);
  assert.equal(M.ended({ ...M.blank(), reserves: 0, debt: 130 }), 'default');
  const good = M.score(M.blank(), { turnsToStable: 5, endedBy: null });
  assert.equal(good.stamp, 5);
  const late = M.score(M.blank(), { turnsToStable: null, endedBy: null });
  assert.ok(late.score === 70 && late.stamp === 4, 'stable at the end without an early bonus is a 4');
  assert.equal(M.score(M.blank(), { turnsToStable: 12, endedBy: null }).stamp, 4, 'stable on the last turn is a 4');
  const thrown = M.score(M.blank(), { turnsToStable: null, endedBy: 'election' });
  assert.ok(thrown.score <= 45 && thrown.stamp <= 2);
  const mess = M.score({ ...M.blank(), pi: 15, u: 12, reserves: 0 }, { turnsToStable: null, endedBy: null });
  assert.equal(mess.stamp, 1);
});

test('a state steps with only known keys touched and a card recorded', () => {
  const n = M.step(M.blank(), 'taxcut', { pop: 1 });
  assert.equal(n.card, 'taxcut');
  assert.equal(n.turn, 1);
  assert.throws(() => M.step(M.blank(), 'bribe'), /no such card/);
});
