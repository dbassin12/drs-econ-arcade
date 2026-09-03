// @ts-check
/* Tests for the pure half of shared/arcade.js — storage fallback, the skill tracker's
   readiness aggregation, the readiness code, medals/stamps, the title ladder and the streak
   multiplier.
   Run: node --test shared/arcade.test.js */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Arcade = require('./arcade.js');

/** Synthetic mastery: units 1-4 have data (unit 2 and 4 below the weakest threshold), 5-6 none. */
const MASTERY = {
  '1.4': { right: 8, total: 10, skills: { 2: { r: 8, t: 10 } }, last: '2026-09-01T00:00:00.000Z' },
  '2.3': { right: 0, total: 2, skills: { 1: { r: 0, t: 2 } }, last: '2026-09-01T00:00:00.000Z' },
  '3.3': { right: 3, total: 12, skills: { 3: { r: 3, t: 12 } }, last: '2026-09-01T00:00:00.000Z' },
  '3.5': { right: 9, total: 10, skills: { 4: { r: 9, t: 10 } }, last: '2026-09-01T00:00:00.000Z' },
  '4.6': { right: 2, total: 2, skills: { 1: { r: 2, t: 2 } }, last: '2026-09-01T00:00:00.000Z' }
};

/** @param {Record<string, {right:number,total:number}>} m */
function only(m) {
  /** @type {Record<string, object>} */
  const out = {};
  for (const ced of Object.keys(m)) {
    out[ced] = { right: m[ced].right, total: m[ced].total, skills: {}, last: '2026-09-01T00:00:00.000Z' };
  }
  return out;
}

/* ===== storage ===== */

test('store falls back to memory when localStorage is undefined', () => {
  assert.equal(typeof localStorage, 'undefined');
  assert.equal(Arcade.store.get('arcade.missing', 'fb'), 'fb');
  assert.equal(Arcade.store.set('arcade.spec', { a: 1, b: [2, 3] }), true);
  assert.deepEqual(Arcade.store.get('arcade.spec', null), { a: 1, b: [2, 3] });
  Arcade.store.remove('arcade.spec');
  assert.equal(Arcade.store.get('arcade.spec', 'gone'), 'gone');
});

test('store.set reports failure on an unserialisable value', () => {
  /** @type {any} */
  const loop = {};
  loop.self = loop;
  assert.equal(Arcade.store.set('arcade.spec.loop', loop), false);
});

test('initials are three A-Z characters padded with ?', () => {
  Arcade.store.remove('arcade.initials');
  assert.equal(Arcade.initials(), '???');
  Arcade.setInitials('dsb');
  assert.equal(Arcade.initials(), 'DSB');
  Arcade.setInitials('a1');
  assert.equal(Arcade.initials(), 'A??');
  Arcade.setInitials('abcdef');
  assert.equal(Arcade.initials(), 'ABC');
  Arcade.store.remove('arcade.initials');
});

test('saveBest only overwrites a higher score', () => {
  Arcade.store.remove('arcade.spec-game.best');
  assert.equal(Arcade.bests('spec-game'), null);
  assert.equal(Arcade.saveBest('spec-game', { score: 400, initials: 'DSB', level: 2 }), true);
  assert.equal(Arcade.saveBest('spec-game', { score: 300, initials: 'ZZZ' }), false);
  const best = Arcade.bests('spec-game');
  assert.equal(best.score, 400);
  assert.equal(best.initials, 'DSB');
  assert.equal(best.level, 2);
  assert.equal(typeof best.date, 'string');
  assert.equal(Arcade.saveBest('spec-game', { score: 401, initials: 'ZZZ' }), true);
  assert.equal(Arcade.bests('spec-game').score, 401);
  Arcade.store.remove('arcade.spec-game.best');
});

/* ===== tracker: readiness aggregation ===== */

test('readiness groups topics into the six CED units', () => {
  const r = Arcade.readiness(MASTERY);
  assert.equal(r.units.length, 6);
  assert.deepEqual(r.units.map((u) => u.unit), [1, 2, 3, 4, 5, 6]);
  assert.equal(r.units[0].name, 'Basic Economic Concepts');
  assert.equal(r.units[1].name, 'Economic Indicators & the Business Cycle');
  assert.equal(r.units[2].name, 'National Income & Price Determination');
  assert.equal(r.units[3].name, 'Financial Sector');
  assert.equal(r.units[4].name, 'Long-Run Consequences of Stabilization Policies');
  assert.equal(r.units[5].name, 'Open Economy');
  assert.deepEqual(r.units.map((u) => u.weight), [7.5, 14.5, 22, 20.5, 25, 11.5]);
});

test('readiness sums right/total per unit and leaves acc null without data', () => {
  const r = Arcade.readiness(MASTERY);
  assert.equal(r.answered, 36);
  assert.deepEqual(r.units.map((u) => [u.right, u.total]), [[8, 10], [0, 2], [12, 22], [2, 2], [0, 0], [0, 0]]);
  assert.equal(r.units[0].acc, 0.8);
  assert.equal(r.units[1].acc, 0);
  assert.equal(r.units[2].acc, 12 / 22);
  assert.equal(r.units[3].acc, 1);
  assert.equal(r.units[4].acc, null);
  assert.equal(r.units[5].acc, null);
});

test('readiness lists the tracked topics of each unit with their CED names', () => {
  const r = Arcade.readiness(MASTERY);
  assert.deepEqual(r.units[2].topics, [
    { ced: '3.3', name: 'Short-Run Aggregate Supply', right: 3, total: 12, acc: 0.25 },
    { ced: '3.5', name: 'Equilibrium in the AD–AS Model', right: 9, total: 10, acc: 0.9 }
  ]);
  assert.deepEqual(r.units[4].topics, []);
  assert.equal(r.units[0].topics[0].name, 'Demand');
});

test('band weights unit accuracy by CED midpoints over counted units only', () => {
  const r = Arcade.readiness(MASTERY);
  // units 1 (10 items) and 3 (22) are counted; 2 and 4 have two items each and are not.
  // (7.5*0.8 + 22*(12/22)) / (7.5+22)
  assert.equal(r.band.weightedAcc, 18 / 29.5);
  assert.equal(r.band.label, 'estimate');
  assert.equal(r.band.n, 36);
  assert.equal(r.band.score, 3);
});

/* ===== MIN_UNIT_ITEMS — a unit has to be measured before it may be projected ===== */

test('MIN_UNIT_ITEMS is exported and is eight', () => {
  assert.equal(Arcade.MIN_UNIT_ITEMS, 8);
});

test('a unit is counted only once it has MIN_UNIT_ITEMS answered', () => {
  const at = (total) => Arcade.readiness(only({ '1.1': { right: total, total } })).units[0];
  assert.equal(at(7).counted, false);
  assert.equal(at(8).counted, true);
  assert.equal(Arcade.readiness({}).units[0].counted, false, 'an empty unit is not counted either');
  const r = Arcade.readiness(MASTERY);
  assert.deepEqual(r.units.map((u) => u.counted), [true, false, true, false, false, false]);
});

test('an uncounted unit still shows its accuracy in the heat map', () => {
  const u = Arcade.readiness(only({ '2.3': { right: 1, total: 4 } })).units[1];
  assert.equal(u.counted, false);
  assert.equal(u.acc, 0.25, 'the cell has a number to show; it just does not steer the estimate');
  assert.equal(u.total, 4);
});

test('band is null until at least one unit is counted', () => {
  assert.equal(Arcade.readiness(only({ '1.1': { right: 4, total: 7 } })).band, null);
  assert.equal(Arcade.readiness(only({ '1.1': { right: 4, total: 8 } })).band.n, 8);
  assert.equal(Arcade.readiness({}).band, null);
  // 12 items spread thin across three units is still nothing anyone should project a score from
  assert.equal(Arcade.readiness(only({
    '1.1': { right: 4, total: 4 }, '2.3': { right: 4, total: 4 }, '3.1': { right: 4, total: 4 }
  })).band, null);
});

test('weightedAcc leaves the thin units out', () => {
  // Unit 6 rides one net-export card. Before MIN_UNIT_ITEMS that single item carried 11.5 of the
  // 33.5 weight on a Shift-only player — about a third of the estimated band, off n = 1.
  const r = Arcade.readiness(only({ '3.1': { right: 6, total: 12 }, '6.5': { right: 1, total: 1 } }));
  assert.equal(r.units[5].acc, 1, 'the 1/1 still shows');
  assert.equal(r.units[5].counted, false);
  assert.equal(r.band.weightedAcc, 0.5, 'and contributes nothing to the estimate');
});

test('a tampered mastery record cannot push accuracy above 100 %', () => {
  const r = Arcade.readiness(only({ '3.1': { right: 50, total: 20 } }));
  assert.equal(r.units[2].acc, 1, 'unit accuracy clamps at 1');
  assert.equal(r.units[2].topics[0].acc, 1, 'and so does the topic row behind it');
  assert.equal(r.band.weightedAcc, 1, 'so the estimate cannot be built on 250 %');
  assert.equal(r.band.score, 5);
});

test('a negative count reads as zero, not as negative accuracy', () => {
  const r = Arcade.readiness(only({ '3.1': { right: -5, total: 3 } }));
  assert.equal(r.units[2].acc, 0, 'unit accuracy floors at 0');
  assert.equal(r.units[2].topics[0].acc, 0);
  assert.equal(r.units[2].right, 0, 'the negative count itself is dropped');
  assert.equal(r.units[2].total, 3);
});

test('band score uses the exact 0.85 / 0.72 / 0.58 / 0.45 thresholds', () => {
  const score = (right) => Arcade.readiness(only({ '1.1': { right, total: 100 } })).band.score;
  assert.equal(score(85), 5);
  assert.equal(score(84), 4);
  assert.equal(score(72), 4);
  assert.equal(score(71), 3);
  assert.equal(score(58), 3);
  assert.equal(score(57), 2);
  assert.equal(score(45), 2);
  assert.equal(score(44), 1);
  assert.equal(score(0), 1);
});

test('weakest is the lowest-accuracy topic with at least three answers', () => {
  const r = Arcade.readiness(MASTERY);
  assert.equal(r.weakest.ced, '3.3');
  assert.equal(r.weakest.acc, 0.25);
  assert.equal(r.weakest.name, 'Short-Run Aggregate Supply');
  // 2.3 is 0/2 — worse, but under the three-answer floor.
  assert.equal(Arcade.readiness(only({ '2.3': { right: 0, total: 2 } })).weakest, null);
  assert.equal(Arcade.readiness(only({ '2.3': { right: 0, total: 3 } })).weakest.ced, '2.3');
  assert.equal(Arcade.readiness({}).weakest, null);
});

test('playNext routes the weakest topic to the level that drills it', () => {
  const next = (ced) => Arcade.readiness(only({ [ced]: { right: 0, total: 3 } })).playNext;
  assert.deepEqual(next('3.3'), {
    game: 'shift', level: 2, url: 'games/shift-happens.html?level=2', label: 'Shift Happens · Level 2'
  });
  assert.deepEqual(next('4.6'), {
    game: 'fed', level: 1, url: 'games/fed-chair.html?era=1975', label: 'Fed Chair · 1975'
  });
  assert.equal(next('3.1').level, 1);
  assert.equal(next('3.8').level, 1);
  assert.equal(next('3.6').level, 2);
  for (const ced of ['3.4', '3.5', '3.7', '3.9']) assert.equal(next(ced).level, 3);
  assert.equal(next('4.5').level, 4, 'the money market');
  for (const ced of ['4.7', '5.4', '5.5', '6.6']) assert.equal(next(ced).level, 5, ced + ' is loanable funds');
  for (const ced of ['6.2', '6.3', '6.4', '6.5']) assert.equal(next(ced).level, 6, ced + ' is the dollar market');
  for (const ced of ['5.2', '5.3']) assert.equal(next(ced).level, 7, ced + ' is the Phillips curve');
  assert.equal(next('5.1').game, 'fed', 'policy in the short run is the Fed\'s game');
  // the sorting decks: GDP, money and the balance of payments are Sort Circuit's
  assert.deepEqual(next('2.1'), {
    game: 'sort', level: 1, url: 'games/sort-circuit.html?level=1', label: 'Sort Circuit · Deck 1'
  });
  assert.equal(next('2.2').level, 1, 'the limits of GDP sort with GDP');
  assert.deepEqual([next('4.3').game, next('4.3').level], ['sort', 2], '4.3 is what money is');
  assert.deepEqual([next('6.1').game, next('6.1').level], ['sort', 4], 'the balance of payments is a sorting deck');
  // the ladders: measurements, multipliers, and money arithmetic are Calc Blitz's
  assert.deepEqual(next('2.4'), {
    game: 'calc', level: 1, url: 'games/calc-blitz.html?level=1', label: 'Calc Blitz · Ladder 1'
  });
  for (const ced of ['2.3', '2.6']) assert.deepEqual([next(ced).game, next(ced).level], ['calc', 1], ced + ' is a measurement');
  assert.deepEqual([next('3.2').game, next('3.2').level], ['calc', 2], 'multipliers are arithmetic');
  for (const ced of ['4.2', '4.4']) assert.deepEqual([next(ced).game, next(ced).level], ['calc', 3], ced + ' is money arithmetic');
  assert.deepEqual(next('4.1'), {
    game: 'investor', level: 1, url: 'games/investor.html?level=1', label: 'The Investor · Run 1'
  });
  assert.deepEqual([next('2.5').game, next('2.5').level], ['investor', 2], 'the cost of inflation is the Inflation Scare');
  assert.deepEqual([next('3.9').game, next('3.9').level], ['sort', 3], 'automatic stabilizers are a sort');
  for (const ced of ['2.7', '5.6', '5.7']) assert.deepEqual([next(ced).game, next(ced).level], ['shift', 3], ced + ' is on the level that draws LRAS');
  // a still-unmapped topic (Unit 1 has no game yet) falls through to the hardest shift level
  assert.deepEqual(next('1.1'), {
    game: 'shift', level: 3, url: 'games/shift-happens.html?level=3', label: 'Shift Happens · Level 3'
  });
  // no data at all starts at level 1
  assert.deepEqual(Arcade.readiness({}).playNext, {
    game: 'shift', level: 1, url: 'games/shift-happens.html?level=1', label: 'Shift Happens · Level 1'
  });
});

test('readiness with no argument reads arcade.mastery from the store', () => {
  Arcade.store.set('arcade.mastery', MASTERY);
  assert.equal(Arcade.readiness().answered, 36);
  Arcade.store.remove('arcade.mastery');
  assert.equal(Arcade.readiness().answered, 0);
});

test('CED_NAMES covers all 42 topics and UNIT_NAMES all six units', () => {
  const keys = Object.keys(Arcade.CED_NAMES);
  assert.equal(keys.length, 42);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((u) => keys.filter((k) => k[0] === String(u)).length), [6, 7, 9, 7, 7, 6]);
  assert.equal(Arcade.CED_NAMES['1.1'], 'Scarcity');
  assert.equal(Arcade.CED_NAMES['4.6'], 'Monetary Policy');
  assert.equal(Arcade.CED_NAMES['6.6'], 'Real Interest Rates and International Capital Flows');
  assert.equal(Object.keys(Arcade.UNIT_NAMES).length, 6);
  assert.equal(Arcade.UNIT_NAMES[6], 'Open Economy');
});

/* ===== tracker: track ===== */

test('track upserts right/total and per-skill counters', () => {
  Arcade.store.remove('arcade.mastery');
  const first = Arcade.track('3.1', 4, true);
  assert.equal(first.right, 1);
  assert.equal(first.total, 1);
  assert.deepEqual(first.skills, { 4: { r: 1, t: 1 } });
  assert.match(first.last, /^\d{4}-\d{2}-\d{2}T/);
  Arcade.track('3.1', 4, false);
  const third = Arcade.track('3.1', 2, true);
  assert.equal(third.right, 2);
  assert.equal(third.total, 3);
  assert.deepEqual(third.skills, { 2: { r: 1, t: 1 }, 4: { r: 1, t: 2 } });
  assert.deepEqual(Arcade.store.get('arcade.mastery', null)['3.1'], third);
  Arcade.store.remove('arcade.mastery');
});

/* ===== readiness code ===== */

test('readinessCode is base64 of the pipe-delimited summary', () => {
  Arcade.setInitials('DSB');
  Arcade.store.set('arcade.mastery', MASTERY);
  const code = Arcade.readinessCode();
  assert.equal(atob(code).split('|').slice(0, 9).join('|'), 'DSB|2|8/10|0/2|12/22|2/2|0/0|0/0|36');
  Arcade.store.remove('arcade.mastery');
  Arcade.store.remove('arcade.initials');
});

test('decodeReadinessCode round-trips a code', () => {
  Arcade.setInitials('ZQX');
  Arcade.store.set('arcade.mastery', MASTERY);
  const decoded = Arcade.decodeReadinessCode(Arcade.readinessCode());
  assert.deepEqual(decoded, {
    initials: 'ZQX',
    version: 2,
    units: [[8, 10], [0, 2], [12, 22], [2, 2], [0, 0], [0, 0]],
    answered: 36
  });
  Arcade.store.remove('arcade.mastery');
  Arcade.store.remove('arcade.initials');
});

test('decodeReadinessCode normalises the initials it hands back', () => {
  const decoded = Arcade.decodeReadinessCode(signed('d b|2|8/10|0/0|0/0|0/0|0/0|0/0|10'));
  assert.equal(decoded.initials, 'DB?', 'three A-Z characters, padded, exactly as initials() gives them');
  assert.equal(Arcade.decodeReadinessCode(signed('|2|0/0|0/0|0/0|0/0|0/0|0/0|0')).initials, '???');
});

test('decodeReadinessCode returns null on anything malformed', () => {
  assert.equal(Arcade.decodeReadinessCode(''), null);
  assert.equal(Arcade.decodeReadinessCode('not base64 !!'), null);
  assert.equal(Arcade.decodeReadinessCode(signed('DSB|2|8/10|0/0|0/0')), null);
  assert.equal(Arcade.decodeReadinessCode(signed('DSB|2|a/b|0/0|0/0|0/0|0/0|0/0|7')), null);
  assert.equal(Arcade.decodeReadinessCode(null), null);
});

/* ===== the readiness code's tamper-evident digest =====
   Not a secret and not meant to be: the salt is in the source. The bar is that a student who
   edits a number in a decoded code cannot re-encode it without also recomputing the digest. */

/** FNV-1a over `payload + SALT`, six base36 characters — the reference implementation the
 *  production code has to agree with, written here first.
 *  @param {string} payload @returns {string} */
function digestOf(payload) {
  let h = 0x811c9dc5;
  const s = payload + 'drs-arcade-2026';
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('00000' + h.toString(36)).slice(-6);
}

/** @param {string} payload @returns {string} a code carrying a correct digest */
function signed(payload) { return btoa(payload + '|' + digestOf(payload)); }

test('readinessCode appends a six-character digest as a tenth field', () => {
  Arcade.setInitials('DSB');
  Arcade.store.set('arcade.mastery', MASTERY);
  const parts = atob(Arcade.readinessCode()).split('|');
  assert.equal(parts.length, 10, 'nine fields plus the digest');
  assert.match(parts[9], /^[0-9a-z]{6}$/);
  assert.equal(parts[9], digestOf(parts.slice(0, 9).join('|')));
  Arcade.store.remove('arcade.mastery');
  Arcade.store.remove('arcade.initials');
});

test('a code whose numerator has been edited no longer decodes', () => {
  const honest = 'DSB|2|8/10|0/2|12/22|2/2|0/0|0/0|36';
  assert.ok(Arcade.decodeReadinessCode(signed(honest)), 'the honest code decodes');
  const forged = honest.replace('8/10', '10/10');
  assert.equal(Arcade.decodeReadinessCode(btoa(forged + '|' + digestOf(honest))), null,
    'the old digest does not cover the new numbers');
  assert.deepEqual(Arcade.decodeReadinessCode(signed(forged)).units[0], [10, 10],
    're-signing is the only way through, and that is the whole bar');
});

test('a code with no digest at all is rejected', () => {
  assert.equal(Arcade.decodeReadinessCode(btoa('DSB|2|8/10|0/2|12/22|2/2|0/0|0/0|36')), null,
    'the old nine-field code no longer decodes');
  assert.equal(Arcade.decodeReadinessCode(btoa('DSB|2|8/10|0/2|12/22|2/2|0/0|0/0|36|')), null,
    'nor does an empty digest field');
  assert.equal(Arcade.decodeReadinessCode(btoa('DSB|2|8/10|0/2|12/22|2/2|0/0|0/0|36|zzzzzz')), null,
    'nor a wrong one');
});

test('the code is version 2, and a correctly signed version 1 is still refused', () => {
  Arcade.setInitials('DSB');
  Arcade.store.set('arcade.mastery', MASTERY);
  assert.equal(atob(Arcade.readinessCode()).split('|')[1], '2', 'the digest changed the payload shape');
  Arcade.store.remove('arcade.mastery');
  Arcade.store.remove('arcade.initials');
  // A wave-2 code carried a valid digest but still said version 1. The version is what tells a
  // reader which payload shape it is holding, so it has to move when the shape does.
  assert.equal(Arcade.decodeReadinessCode(signed('DSB|1|8/10|0/0|0/0|0/0|0/0|0/0|10')), null);
  assert.equal(Arcade.decodeReadinessCode(signed('DSB|3|8/10|0/0|0/0|0/0|0/0|0/0|10')), null);
  assert.ok(Arcade.decodeReadinessCode(signed('DSB|2|8/10|0/0|0/0|0/0|0/0|0/0|10')));
});

/* ===== medals and stamps ===== */

test('safeMedal passes the three real medals and rejects everything else', () => {
  assert.equal(Arcade.safeMedal('gold'), 'gold');
  assert.equal(Arcade.safeMedal('silver'), 'silver');
  assert.equal(Arcade.safeMedal('bronze'), 'bronze');
  // Anything else reaching a className is a stored string this device did not write.
  for (const junk of ['none', '', 'GOLD', 'gold silver', 'x" onload="alert(1)', null, undefined, 7, {}]) {
    assert.equal(Arcade.safeMedal(junk), 'none', JSON.stringify(junk));
  }
});

test('medalFor gates gold on the exit exam', () => {
  assert.equal(Arcade.medalFor(0.95, { examPassed: true }), 'gold');
  assert.equal(Arcade.medalFor(1, { examPassed: true }), 'gold');
  assert.equal(Arcade.medalFor(0.95, { examPassed: false }), 'silver');
  assert.equal(Arcade.medalFor(0.95), 'silver');
  assert.equal(Arcade.medalFor(0.9499, { examPassed: true }), 'silver');
  assert.equal(Arcade.medalFor(0.85), 'silver');
  assert.equal(Arcade.medalFor(0.8499), 'bronze');
  assert.equal(Arcade.medalFor(0.75), 'bronze');
  assert.equal(Arcade.medalFor(0.7499), null);
  assert.equal(Arcade.medalFor(0), null);
});

test('stampFor maps accuracy onto an AP score 1-5', () => {
  assert.equal(Arcade.stampFor(1), 5);
  assert.equal(Arcade.stampFor(0.95), 5);
  assert.equal(Arcade.stampFor(0.9499), 4);
  assert.equal(Arcade.stampFor(0.85), 4);
  assert.equal(Arcade.stampFor(0.8499), 3);
  assert.equal(Arcade.stampFor(0.75), 3);
  assert.equal(Arcade.stampFor(0.7499), 2);
  assert.equal(Arcade.stampFor(0.6), 2);
  assert.equal(Arcade.stampFor(0.5999), 1);
  assert.equal(Arcade.stampFor(0), 1);
});

/* ===== titles ===== */

/** A progress object for titleFor: `medals` fills Shift Levels 1..n, `perfect` marks that many of
 *  them examPerfect, `stamp` is the Fed best (0 for a player who has never run it), and `games`
 *  lists other games' progress the same way.
 *  @param {{medals?: (string|null)[], perfect?: number, stamp?: number, games?: {medals?: (string|null)[], perfect?: number}[]}} spec @returns {any} */
function progressOf(spec) {
  /** @param {{medals?: (string|null)[], perfect?: number}} g @returns {any} */
  const levelsOf = (g) => {
    /** @type {Record<string, any>} */
    const levels = {};
    (g.medals || []).forEach((medal, i) => {
      levels[String(i + 1)] = {
        cleared: true, acc: 1, best: 1000, medal: medal, exam: { right: 3, total: 3 },
        examPerfect: i < (g.perfect || 0)
      };
    });
    return { unlocked: 3, levels: levels };
  };
  return {
    shift: levelsOf(spec),
    fed: spec.stamp ? { score: spec.stamp, initials: 'DSB', date: '2026-09-01T00:00:00.000Z' } : null,
    games: (spec.games || []).map(levelsOf)
  };
}

const GOLD3 = ['gold', 'gold', 'gold'];
const GOLD7 = ['gold', 'gold', 'gold', 'gold', 'gold', 'gold', 'gold'];

test('titleFor promotes at 0 / 4 / 10 / 18 / 28 / 40 points', () => {
  /** @param {{medals?: (string|null)[], perfect?: number, stamp?: number, games?: any[]}} spec
   *  @returns {any[]} the rank and name at that many points */
  const rung = (spec) => {
    const t = Arcade.titleFor(progressOf(spec));
    return [t.rank, t.name];
  };
  // 3 points is one short of Analyst; 4 is the promotion.
  assert.deepEqual(rung({ medals: ['gold'] }), [0, 'Intern']);
  assert.deepEqual(rung({ medals: ['gold', 'bronze'] }), [1, 'Analyst']);
  // 9 = three golds; 10 adds a stamp of 1.
  assert.deepEqual(rung({ medals: GOLD3 }), [1, 'Analyst']);
  assert.deepEqual(rung({ medals: GOLD3, stamp: 1 }), [2, 'Branch Economist']);
  // 17 = nine medal points, three perfect exams and a stamp of 2; 18 takes the stamp to 3.
  assert.deepEqual(rung({ medals: GOLD3, perfect: 3, stamp: 2 }), [2, 'Branch Economist']);
  assert.deepEqual(rung({ medals: GOLD3, perfect: 3, stamp: 3 }), [3, 'Regional Fed President']);
  // 27 = seven golds, two perfect exams and a stamp of 2; 28 takes the stamp to 3.
  assert.deepEqual(rung({ medals: GOLD7, perfect: 2, stamp: 2 }), [3, 'Regional Fed President']);
  assert.deepEqual(rung({ medals: GOLD7, perfect: 2, stamp: 3 }), [4, 'Vice Chair']);
  // 39 = seven golds, seven perfect exams and a stamp of 4; 40 takes the stamp to 5.
  assert.deepEqual(rung({ medals: GOLD7, perfect: 7, stamp: 4 }), [4, 'Vice Chair']);
  assert.deepEqual(rung({ medals: GOLD7, perfect: 7, stamp: 5 }), [5, 'MAESTRO']);
});

test('titleFor carries the rung emoji', () => {
  /** @param {{medals?: (string|null)[], perfect?: number, stamp?: number}} spec */
  const emoji = (spec) => Arcade.titleFor(progressOf(spec)).emoji;
  assert.equal(emoji({}), '\u{1F9FE}');
  assert.equal(emoji({ medals: ['gold', 'bronze'] }), '\u{1F4C8}');
  assert.equal(emoji({ medals: GOLD3, stamp: 1 }), '\u{1F3E2}');
  assert.equal(emoji({ medals: GOLD3, perfect: 3, stamp: 3 }), '\u{1F3DB}\u{FE0F}');
  assert.equal(emoji({ medals: GOLD7, perfect: 2, stamp: 3 }), '\u{1F3A9}');
  assert.equal(emoji({ medals: GOLD7, perfect: 7, stamp: 5 }), '\u{1F3BC}');
});

test('next names the rung above and the points still owed', () => {
  assert.deepEqual(Arcade.titleFor(progressOf({})).next, { name: 'Analyst', need: 4 });
  assert.deepEqual(Arcade.titleFor(progressOf({ medals: ['silver'] })).next, { name: 'Analyst', need: 2 });
  // the hub's example line: 7 points is Analyst, 3 short of Branch Economist
  assert.deepEqual(
    Arcade.titleFor(progressOf({ medals: ['gold', 'gold', 'bronze'] })).next,
    { name: 'Branch Economist', need: 3 }
  );
  assert.deepEqual(Arcade.titleFor(progressOf({ medals: GOLD7, perfect: 7, stamp: 4 })).next, { name: 'MAESTRO', need: 1 });
  assert.equal(Arcade.titleFor(progressOf({ medals: GOLD7, perfect: 7, stamp: 5 })).next, null);
});

test('titlePoints counts every game’s medals, so MAESTRO asks for breadth', () => {
  // seven Shift golds alone: Regional Fed President
  assert.equal(Arcade.titleFor(progressOf({ medals: GOLD7 })).name, 'Regional Fed President');
  // four Sort Circuit golds and nothing else: Branch Economist
  assert.equal(Arcade.titleFor(progressOf({ games: [{ medals: ['gold', 'gold', 'gold', 'gold'] }] })).name, 'Branch Economist');
  // golds across Shift, Sort and Crisis Country: 21 + 12 + 15 = 48, MAESTRO
  const broad = progressOf({ medals: GOLD7, games: [{ medals: ['gold', 'gold', 'gold', 'gold'] }, { medals: ['gold', 'gold', 'gold', 'gold', 'gold'] }] });
  assert.equal(Arcade.titleFor(broad).name, 'MAESTRO');
  // a perfect Exam Sprint in another game is worth the same two points
  assert.equal(Arcade.titleFor(progressOf({ games: [{ medals: ['gold'], perfect: 1 }] })).next.need, 4 - 5 < 0 ? 5 : 0, 'gold + perfect = 5 points: Analyst, 5 short of Branch Economist');
  assert.deepEqual(Arcade.titleFor(progressOf({ games: [{ medals: ['gold'], perfect: 1 }] })).next, { name: 'Branch Economist', need: 5 });
  // a missing or malformed game record counts nothing
  assert.equal(Arcade.titleFor({ shift: null, fed: null, games: [null, 'junk', { levels: { toString: 1 } }] }).name, 'Intern');
});

test('a stored medal that names an Object.prototype method is worth nothing', () => {
  // A hand-edited arcade.shift.progress with `medal: "toString"` used to resolve through the
  // prototype chain to a truthy function, so `|| 0` never fired and the hub printed "NaN pts".
  const t = Arcade.titleFor({ shift: { levels: { 1: { medal: 'toString' } } }, fed: null });
  assert.deepEqual(t, { rank: 0, name: 'Intern', emoji: '\u{1F9FE}', next: { name: 'Analyst', need: 4 } });
  for (const key of ['constructor', 'valueOf', 'hasOwnProperty', '__proto__']) {
    assert.equal(Arcade.titleFor({ shift: { levels: { 1: { medal: key } } }, fed: null }).next.need, 4, key);
    assert.equal(Arcade.titleFor({ shift: null, fed: null, games: [{ levels: { 1: { medal: key } } }] }).next.need, 4, key + ' in another game');
  }
});

test('titleFor scores an empty progress object as Intern', () => {
  assert.deepEqual(Arcade.titleFor({}), { rank: 0, name: 'Intern', emoji: '\u{1F9FE}', next: { name: 'Analyst', need: 4 } });
  assert.equal(Arcade.titleFor({ shift: null, fed: null }).name, 'Intern');
  assert.equal(Arcade.titleFor({ shift: { levels: {} }, fed: null }).name, 'Intern');
});

test('points cap at the seven Shift levels and a 1-5 Fed stamp', () => {
  // Shift's ceiling is 21 medal points + 14 perfect-exam points; with a stamp of 5 that is MAESTRO
  assert.equal(Arcade.titleFor(progressOf({ medals: GOLD7, perfect: 7, stamp: 5 })).name, 'MAESTRO');
  const stray = progressOf({ medals: GOLD7, perfect: 7, stamp: 5 });
  stray.shift.levels['8'] = { cleared: true, acc: 1, best: 1, medal: 'gold', exam: null, examPerfect: true };
  stray.fed.score = 99;
  assert.deepEqual(Arcade.titleFor(stray).next, null);
  assert.deepEqual(Arcade.titleFor({ shift: null, fed: { score: 99 }, games: [] }).next, { name: 'Branch Economist', need: 5 }, 'a stamp is worth at most five: Analyst, five short of the next rung');
  // an unrecognised medal is worth nothing
  assert.equal(Arcade.titleFor(progressOf({ medals: ['platinum', 'platinum', 'platinum'] })).name, 'Intern');
  assert.equal(Arcade.titleFor(progressOf({ medals: [null, null, null] })).name, 'Intern');
});

test('titleFor uses a passed progress object verbatim and the store otherwise', () => {
  Arcade.store.set('arcade.shift.progress', progressOf({ medals: GOLD3, perfect: 3, stamp: 0 }).shift);
  Arcade.store.set('arcade.fed.best', { score: 5, initials: 'DSB', date: '2026-09-01T00:00:00.000Z' });
  Arcade.store.set('arcade.crisis.progress', progressOf({ medals: ['gold', 'gold'] }).shift);
  // the store holds 26 points (a Regional Fed President), but a passed object is the only progress that counts
  assert.equal(Arcade.titleFor({}).name, 'Intern');
  assert.equal(Arcade.titleFor(progressOf({ medals: ['gold', 'bronze'] })).name, 'Analyst');
  assert.equal(Arcade.titleFor().name, 'Regional Fed President');
  Arcade.store.remove('arcade.crisis.progress');
  assert.equal(Arcade.titleFor().name, 'Regional Fed President', '20 points without Crisis Country');
  Arcade.store.remove('arcade.fed.best');
  assert.equal(Arcade.titleFor().name, 'Branch Economist');
  Arcade.store.remove('arcade.shift.progress');
  assert.deepEqual(Arcade.titleFor().next, { name: 'Analyst', need: 4 });
});

/* ===== streak ===== */

test('streak multiplier is 1 + min(4, floor(count/3))', () => {
  const s = Arcade.streak();
  const at = (n) => {
    s.reset();
    for (let i = 0; i < n; i += 1) s.hit();
    return [s.count, s.mult];
  };
  assert.deepEqual(at(0), [0, 1]);
  assert.deepEqual(at(2), [2, 1]);
  assert.deepEqual(at(3), [3, 2]);
  assert.deepEqual(at(6), [6, 3]);
  assert.deepEqual(at(12), [12, 5]);
  assert.deepEqual(at(20), [20, 5]);
});

test('streak miss resets the count', () => {
  const s = Arcade.streak();
  s.hit();
  s.hit();
  s.hit();
  assert.equal(s.mult, 2);
  s.miss();
  assert.equal(s.count, 0);
  assert.equal(s.mult, 1);
});

/* ===== motion presets ===== */

test('SPRING presets are the contract the graph engine consumes', () => {
  assert.deepEqual(Arcade.SPRING, {
    snap: { stiffness: 170, ratio: 0.8 },
    consequence: { stiffness: 80, ratio: 0.6 },
    jolt: { stiffness: 170, ratio: 0.35 }
  });
});

test('spring settles synchronously without requestAnimationFrame', () => {
  assert.equal(typeof requestAnimationFrame, 'undefined');
  const seen = [];
  let done = 0;
  const handle = Arcade.spring(0, 42, (v) => seen.push(v), { onDone: () => { done += 1; } });
  assert.deepEqual(seen, [42]);
  assert.equal(done, 1);
  handle.cancel();
  handle.finish();
});

test('browser-only members are safe no-ops in Node', () => {
  assert.equal(Arcade.prefersReducedMotion(), false);
  assert.equal(Arcade.say('hello'), false);
  assert.equal(Arcade.qs('level', '1'), '1');
  assert.equal(Arcade.bigType(), false);
  Arcade.confetti();
  Arcade.shake(null);
  Arcade.flash(null);
  Arcade.toast('hi');
  Arcade.voice.stop();
  Arcade.sfx.unlock();
  Arcade.sfx.play('correct');
});

/* ===== speech priming — the first gesture has to keep trying until the browser really speaks ===== */

/** A stand-in speechSynthesis. `mode` is what `speak()` does: 'refuse' swallows the utterance the way
 *  a phone does before a real user activation, 'throw' rejects it, 'accept' starts speaking.
 *  @param {string} mode @returns {any} the stub, with every utterance it was handed in `calls` */
function stubSpeech(mode) {
  /** @type {any[]} */ const calls = [];
  /** @type {any} */ const g = globalThis;
  g.SpeechSynthesisUtterance = function (/** @type {string} */ text) { this.text = text; };
  g.speechSynthesis = {
    speaking: false,
    pending: false,
    calls: calls,
    /** @param {any} u */
    speak(u) {
      calls.push(u);
      if (mode === 'throw') throw new Error('speech not allowed');
      if (mode === 'accept') this.speaking = true;
    },
    cancel() { },
    getVoices() { return []; },
    addEventListener() { }
  };
  return g.speechSynthesis;
}

function clearSpeech() {
  /** @type {any} */ const g = globalThis;
  delete g.speechSynthesis;
  delete g.SpeechSynthesisUtterance;
}

/** A fresh engine, so the sticky primed flag starts false in every test. @returns {any} */
function freshArcade() {
  delete require.cache[require.resolve('./arcade.js')];
  return require('./arcade.js');
}

test('a refused priming utterance leaves speech unprimed, so the next gesture tries again', () => {
  const s = stubSpeech('refuse');
  const A = freshArcade();
  assert.equal(A.voice.prime(), false);
  assert.equal(A.voice.prime(), false);
  assert.equal(s.calls.length, 2);
  clearSpeech();
});

test('a priming utterance the browser throws away leaves speech unprimed', () => {
  const s = stubSpeech('throw');
  const A = freshArcade();
  assert.equal(A.voice.prime(), false);
  assert.equal(A.voice.prime(), false);
  assert.equal(s.calls.length, 2);
  clearSpeech();
});

test('priming stops retrying once an utterance actually speaks', () => {
  const s = stubSpeech('accept');
  const A = freshArcade();
  assert.equal(A.voice.prime(), true);
  assert.equal(A.voice.prime(), true);
  assert.equal(s.calls.length, 1);
  clearSpeech();
});

test('an utterance that starts late still counts as primed', () => {
  const s = stubSpeech('refuse');
  const A = freshArcade();
  assert.equal(A.voice.prime(), false);
  s.calls[0].onstart();
  assert.equal(A.voice.prime(), true);
  assert.equal(s.calls.length, 1);
  clearSpeech();
});

test('priming is a no-op without a speech synthesiser', () => {
  const A = freshArcade();
  assert.equal(typeof speechSynthesis, 'undefined');
  assert.equal(A.voice.prime(), false);
});

/* ===== the round clock — a frame delta is capped, so a hidden tab cannot burn a round ===== */

/** A stand-in requestAnimationFrame whose frames only run when the test says so, with the
 *  timestamp the test chooses. @returns {{step:(now:number) => void}} */
function stubRaf() {
  /** @type {any} */ const g = globalThis;
  /** @type {((now:number) => void)[]} */ const queue = [];
  g.requestAnimationFrame = (/** @type {(now:number) => void} */ fn) => { queue.push(fn); return queue.length; };
  g.cancelAnimationFrame = () => { };
  return { step(now) { const fn = queue.shift(); if (fn) fn(now); } };
}

function clearRaf() {
  /** @type {any} */ const g = globalThis;
  delete g.requestAnimationFrame;
  delete g.cancelAnimationFrame;
}

test('the round clock spends a real frame delta', () => {
  const raf = stubRaf();
  const clock = Arcade.timerBar(null, 20000, {});
  clock.start();
  raf.step(1000);                 // the first frame only sets the baseline
  raf.step(1100);
  assert.equal(clock.remaining(), 19900);
  clearRaf();
});

test('a backgrounded tab costs the round clock one capped frame, not the whole absence', () => {
  const raf = stubRaf();
  let ended = false;
  const clock = Arcade.timerBar(null, 20000, { onEnd() { ended = true; } });
  clock.start();
  raf.step(1000);
  raf.step(41000);                // forty seconds in Google Classroom, and no frames in between
  assert.equal(ended, false, 'the round expired while the tab was hidden');
  assert.equal(clock.remaining(), 19750);
  clearRaf();
});

test('a dropped frame on a slow Chromebook costs no more than the cap either', () => {
  const raf = stubRaf();
  const clock = Arcade.timerBar(null, 20000, {});
  clock.start();
  raf.step(500);
  raf.step(3500);                 // a 3 s main-thread stall
  assert.equal(clock.remaining(), 19750);
  clearRaf();
});

/* ===== the tap guard — one short deaf window per screen change ===== */

test('the tap guard opens for its window and closes again', () => {
  Arcade.guardTaps(0);
  assert.equal(Arcade.guarded(), false);
  Arcade.guardTaps(5000);
  assert.equal(Arcade.guarded(), true);
  let fired = 0;
  const wrapped = Arcade.ignoringSkipTap(() => { fired += 1; });
  wrapped();
  assert.equal(fired, 0, 'a spent tap fired an action while the guard was up');
  Arcade.guardTaps(0);
  wrapped();
  assert.equal(fired, 1);
});

test('focusScreen and trapFocus are safe no-ops without a document', () => {
  assert.equal(Arcade.focusScreen(null), null);
  assert.equal(typeof Arcade.trapFocus(null, null), 'function');
  Arcade.trapFocus(null, null)();
});

/* ===== the adaptive draw — cardWeight and weightedSample ===== */

/** A seeded generator, so a sampling test is the same run every time. @param {number} seed */
function lcgFor(seed) {
  let s = seed >>> 0;
  return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

test('cardWeight is neutral until a topic has three items, then rises with the misses', () => {
  const m = {
    '3.1': { right: 0, total: 2 },      // too thin to steer
    '3.3': { right: 0, total: 3 },      // always wrong
    '3.5': { right: 3, total: 3 },      // always right
    '3.8': { right: 2, total: 4 }       // half
  };
  assert.equal(Arcade.WEIGHT_MIN_ITEMS, 3);
  assert.equal(Arcade.cardWeight('6.5', m), 1, 'a topic never answered');
  assert.equal(Arcade.cardWeight('3.1', m), 1, 'two items are not data');
  assert.equal(Arcade.cardWeight('3.3', m), 2.5, 'every miss: the top weight');
  assert.equal(Arcade.cardWeight('3.5', m), 0.5, 'owned: half');
  assert.equal(Arcade.cardWeight('3.8', m), 1.5, 'half right: in the middle');
  assert.equal(Arcade.cardWeight('3.3', { '3.3': { right: 50, total: 20 } }), 0.5, 'a hand-edited count over 100% clamps to owned');
  assert.equal(Arcade.cardWeight('3.3', { '3.3': { right: 'x', total: 5 } }), 2.5, 'junk in right reads as zero right');
});

test('weightedSample draws in proportion, without replacement, and never a zero-weight item', () => {
  const items = ['a', 'b', 'c', 'd'];
  assert.deepEqual(Arcade.weightedSample(items, [1, 1, 1, 1], 4, () => 0), ['a', 'b', 'c', 'd'], 'rng at 0 walks the list in order');
  assert.deepEqual(Arcade.weightedSample(items, [0, 1, 0, 1], 4, () => 0.999), ['d', 'b'], 'zero weights are skipped even when asked for four');
  assert.deepEqual(Arcade.weightedSample(items, [1, 1, 1, 1], 2, () => 0.5), ['c', 'b'], 'two picks, no repeats');
  assert.deepEqual(Arcade.weightedSample([], [], 3), [], 'nothing from nothing');
  assert.deepEqual(Arcade.weightedSample(items, [0, 0, 0, 0], 2), [], 'nothing from all-zero weights');
  const rng = lcgFor(7);
  let firstIsA = 0;
  for (let i = 0; i < 4000; i += 1) if (Arcade.weightedSample(['a', 'b'], [3, 1], 1, rng)[0] === 'a') firstIsA += 1;
  assert.ok(firstIsA > 2850 && firstIsA < 3150, 'a 3:1 weight draws first about 75% of the time: ' + firstIsA);
});

test('titlePoints counts a medal on any of the seven levels', () => {
  const seven = progressOf({ medals: ['gold', 'gold', 'gold', 'gold', 'gold', 'gold', 'gold'] });
  assert.equal(Arcade.titleFor(seven).name, 'Regional Fed President', 'seven golds are 21 points');
  const late = progressOf({ medals: [null, null, null, 'bronze', 'silver', 'bronze'] });
  assert.equal(Arcade.titleFor(late).name, 'Analyst', 'a bronze, a silver and a bronze on Levels 4–6 are 4 points');
});

/* ===== the best hook and the career record — what the class board is built on ===== */

test('onBest fires once per new best with the stored record, never on a lower score', () => {
  Arcade.store.remove('arcade.spec-hook.best');
  /** @type {any[]} */
  const seen = [];
  const off = Arcade.onBest((game, rec) => seen.push({ game, score: rec.score, initials: rec.initials, level: rec.level }));
  assert.equal(Arcade.saveBest('spec-hook', { score: 100, initials: 'abc', level: 3 }), true);
  assert.equal(Arcade.saveBest('spec-hook', { score: 90, initials: 'abc', level: 3 }), false);
  assert.equal(Arcade.saveBest('spec-hook', { score: 120, initials: 'abc', level: 4 }), true);
  assert.deepEqual(seen, [
    { game: 'spec-hook', score: 100, initials: 'ABC', level: 3 },
    { game: 'spec-hook', score: 120, initials: 'ABC', level: 4 }
  ]);
  off();
  assert.equal(Arcade.saveBest('spec-hook', { score: 130, initials: 'abc' }), true);
  assert.equal(seen.length, 2, 'an unsubscribed listener hears nothing more');
  Arcade.store.remove('arcade.spec-hook.best');
});

test('a listener that throws does not cost the student the best', () => {
  Arcade.store.remove('arcade.spec-hook.best');
  const off = Arcade.onBest(() => { throw new Error('boom'); });
  assert.equal(Arcade.saveBest('spec-hook', { score: 5, initials: 'DSB' }), true);
  assert.equal(Arcade.bests('spec-hook').score, 5);
  off();
  Arcade.store.remove('arcade.spec-hook.best');
});

test('career sums the same points the title ladder reads and names the rung', () => {
  const c = Arcade.career({ shift: { levels: { 1: { medal: 'gold', examPerfect: true } } }, fed: { score: 3 }, games: [] });
  assert.equal(c.points, 8, 'gold 3 + a perfect sprint 2 + a Fed stamp of 3');
  assert.equal(c.name, 'Analyst');
  assert.equal(c.rank, 1);
  assert.equal(c.emoji, '📈');
  assert.deepEqual(Arcade.career({ shift: null, fed: null, games: [] }), { points: 0, rank: 0, name: 'Intern', emoji: '🧾' });
  assert.equal(Arcade.titlePoints({ shift: null, fed: { score: 5 }, games: [] }), 5, 'titlePoints is exported for the board');
});


/* ===== the game switcher's list ===== */

test('the switcher lists the seven games, each with a page that exists', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  assert.deepEqual(Arcade.GAME_LIST.map((g) => g.id), ['shift', 'fed', 'sort', 'calc', 'doctor', 'investor', 'crisis']);
  Arcade.GAME_LIST.forEach((g) => {
    assert.ok(g.name && g.emoji, g.id + ' has a name and an emoji');
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'games', g.page)), g.page + ' exists');
  });
  Arcade.mountSwitcher({ current: 'shift' });   // a no-op with no document
});

/* ===== the double-tap guard on toggles ===== */

test('debounced runs the first tap and swallows the one inside the guard window', async () => {
  let n = 0;
  const f = Arcade.debounced(() => { n += 1; });
  f();
  f();
  assert.equal(n, 1);
  assert.equal(Arcade.guarded(), true, 'the page is deaf for the guard window');
  await new Promise((r) => setTimeout(r, 380));
  f();
  assert.equal(n, 2, 'and hears again after it');
  await new Promise((r) => setTimeout(r, 380));
});

test('a persona exists for every voice the games ask for', () => {
  ['hawk', 'dove', 'anchor', 'president', 'chair'].forEach((who) => assert.equal(Arcade.say('x', { who }), false, who + ' is a no-op without speech, not a throw'));
});

test('bests reads a hand-edited record back the way saveBest would have written it', () => {
  Arcade.store.set('arcade.spec-junk.best', { score: 1e9, initials: 'ok', level: 'x', date: 42 });
  assert.deepEqual(Arcade.bests('spec-junk'), { score: 1e9, initials: 'OK?', date: '' });
  Arcade.store.set('arcade.spec-junk.best', { score: 'five', initials: 'DSB' });
  assert.equal(Arcade.bests('spec-junk'), null);
  Arcade.store.set('arcade.spec-junk.best', { score: Infinity, initials: 'DSB' });
  assert.equal(Arcade.bests('spec-junk'), null);
  Arcade.store.set('arcade.spec-junk.best', { score: 7, initials: 'dsb', level: 3, date: '2026-09-03T00:00:00.000Z' });
  assert.deepEqual(Arcade.bests('spec-junk'), { score: 7, initials: 'DSB', level: 3, date: '2026-09-03T00:00:00.000Z' });
  Arcade.store.remove('arcade.spec-junk.best');
});

/* ===== the asset stamp every page carries ===== */

test('every page names the shared scripts and stylesheet with one and the same asset version', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const pages = ['index.html'].concat(fs.readdirSync(path.join(root, 'games')).filter((f) => f.endsWith('.html')).map((f) => 'games/' + f));
  const stamps = new Set();
  pages.forEach((p) => {
    const html = fs.readFileSync(path.join(root, p), 'utf8');
    const refs = html.match(/(?:src|href)="[^"]*(?:shared\/[a-z-]+\.(?:js|css)|[a-z-]+\.model\.js)(?:\?[^"]*)?"/g) || [];
    assert.ok(refs.length >= 3, p + ' loads the stylesheet, the engine and the board');
    refs.forEach((r) => {
      const m = r.match(/\?v=([A-Za-z0-9.-]+)"$/);
      assert.ok(m, p + ': ' + r + ' carries no ?v= stamp (run node tools/bump-assets.js)');
      stamps.add(m[1]);
    });
  });
  assert.equal(stamps.size, 1, 'one stamp everywhere, found: ' + [...stamps].join(', '));
});

/* ===== the exam shuffle and the slam ===== */

test('shuffledExam reorders the items and their choices and keeps every right answer', () => {
  const items = [
    { stem: 'a', choices: ['a0', 'a1', 'a2', 'a3'], answer: 2, why: 'w', ced: '3.1', skill: 1 },
    { stem: 'b', choices: ['b0', 'b1', 'b2', 'b3'], answer: 0, why: 'w', ced: '3.1', skill: 1 },
    { stem: 'c', choices: ['c0', 'c1', 'c2', 'c3'], answer: 3, why: 'w', ced: '3.1', skill: 1 }
  ];
  let seed = 7;
  const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const out = Arcade.shuffledExam(items, rng);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((q) => q.stem).sort(), ['a', 'b', 'c']);
  out.forEach((q) => {
    const src = items.find((i) => i.stem === q.stem);
    assert.equal(q.choices[q.answer], src.choices[src.answer], q.stem + ' keeps its right answer');
    assert.deepEqual(q.choices.slice().sort(), src.choices.slice().sort(), q.stem + ' keeps all four choices');
    assert.equal(q.why, 'w');
  });
  assert.deepEqual(items[0].choices, ['a0', 'a1', 'a2', 'a3'], 'the source is untouched');
  assert.equal(items[0].answer, 2);
  // over many shuffles every letter and every position comes up
  const seen = new Set();
  for (let k = 0; k < 60; k += 1) Arcade.shuffledExam(items, rng).forEach((q, i) => seen.add(q.stem + i + ':' + q.answer));
  assert.ok(seen.size > 20, 'the order really moves: ' + seen.size);
  assert.deepEqual(Arcade.shuffledExam([]), []);
  assert.deepEqual(Arcade.shuffled([1, 2, 3], () => 0), [2, 3, 1]);
});

test('slam is a safe no-op without a document', () => {
  Arcade.slam('BOSS');
  Arcade.slam('FOMC · HOLD', { sfx: null, ms: 10 });
});

test('mountGlossary is a safe no-op without a document', () => { Arcade.mountGlossary(); });
