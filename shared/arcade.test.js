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

test('band weights unit accuracy by CED midpoints over units with data only', () => {
  const r = Arcade.readiness(MASTERY);
  // (7.5*0.8 + 14.5*0 + 22*(12/22) + 20.5*1) / (7.5+14.5+22+20.5)
  assert.equal(r.band.weightedAcc, 38.5 / 64.5);
  assert.equal(r.band.label, 'estimate');
  assert.equal(r.band.n, 36);
  assert.equal(r.band.score, 3);
});

test('band is null until ten questions are answered', () => {
  assert.equal(Arcade.readiness(only({ '1.1': { right: 4, total: 9 } })).band, null);
  assert.equal(Arcade.readiness(only({ '1.1': { right: 4, total: 10 } })).band.n, 10);
  assert.equal(Arcade.readiness({}).band, null);
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
  assert.equal(next('3.2').level, 1);
  assert.equal(next('3.8').level, 1);
  assert.equal(next('3.6').level, 2);
  for (const ced of ['3.4', '3.5', '3.7', '3.9']) assert.equal(next(ced).level, 3);
  for (const ced of ['4.5', '4.7', '5.1', '5.2', '5.3']) assert.equal(next(ced).game, 'fed');
  // Unit 6 rides Level 1's net-export cards until Level 6 exists
  for (const ced of ['6.1', '6.2', '6.3', '6.4', '6.5', '6.6']) assert.equal(next(ced).level, 1);
  // a still-unmapped topic falls through to the hardest shift level
  assert.deepEqual(next('2.3'), {
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
  assert.equal(atob(code), 'DSB|1|8/10|0/2|12/22|2/2|0/0|0/0|36');
  Arcade.store.remove('arcade.mastery');
  Arcade.store.remove('arcade.initials');
});

test('decodeReadinessCode round-trips a code', () => {
  Arcade.setInitials('ZQX');
  Arcade.store.set('arcade.mastery', MASTERY);
  const decoded = Arcade.decodeReadinessCode(Arcade.readinessCode());
  assert.deepEqual(decoded, {
    initials: 'ZQX',
    version: 1,
    units: [[8, 10], [0, 2], [12, 22], [2, 2], [0, 0], [0, 0]],
    answered: 36
  });
  Arcade.store.remove('arcade.mastery');
  Arcade.store.remove('arcade.initials');
});

test('decodeReadinessCode returns null on anything malformed', () => {
  assert.equal(Arcade.decodeReadinessCode(''), null);
  assert.equal(Arcade.decodeReadinessCode('not base64 !!'), null);
  assert.equal(Arcade.decodeReadinessCode(btoa('DSB|1|8/10|0/0|0/0')), null);
  assert.equal(Arcade.decodeReadinessCode(btoa('DSB|1|a/b|0/0|0/0|0/0|0/0|0/0|7')), null);
  assert.equal(Arcade.decodeReadinessCode(null), null);
});

/* ===== medals and stamps ===== */

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

/** A progress object for titleFor: `medals` fills Levels 1..n, `perfect` marks that many of them
 *  examPerfect, `stamp` is the Fed best (0 for a player who has never run it).
 *  @param {{medals?: (string|null)[], perfect?: number, stamp?: number}} spec @returns {any} */
function progressOf(spec) {
  /** @type {Record<string, any>} */
  const levels = {};
  (spec.medals || []).forEach((medal, i) => {
    levels[String(i + 1)] = {
      cleared: true, acc: 1, best: 1000, medal: medal, exam: { right: 3, total: 3 },
      examPerfect: i < (spec.perfect || 0)
    };
  });
  return {
    shift: { unlocked: 3, levels: levels },
    fed: spec.stamp ? { score: spec.stamp, initials: 'DSB', date: '2026-09-01T00:00:00.000Z' } : null
  };
}

const GOLD3 = ['gold', 'gold', 'gold'];

test('titleFor promotes at 0 / 3 / 7 / 11 / 15 / 19 points', () => {
  /** @param {{medals?: (string|null)[], perfect?: number, stamp?: number}} spec
   *  @returns {any[]} the rank and name at that many points */
  const rung = (spec) => {
    const t = Arcade.titleFor(progressOf(spec));
    return [t.rank, t.name];
  };
  // 2 points is one short of Analyst; 3 is the promotion.
  assert.deepEqual(rung({ medals: ['silver'] }), [0, 'Intern']);
  assert.deepEqual(rung({ medals: ['gold'] }), [1, 'Analyst']);
  // 6 = two golds; 7 adds a bronze.
  assert.deepEqual(rung({ medals: ['gold', 'gold'] }), [1, 'Analyst']);
  assert.deepEqual(rung({ medals: ['gold', 'gold', 'bronze'] }), [2, 'Branch Economist']);
  // 10 = nine medal points and a stamp of 1; 11 takes the stamp to 2.
  assert.deepEqual(rung({ medals: GOLD3, stamp: 1 }), [2, 'Branch Economist']);
  assert.deepEqual(rung({ medals: GOLD3, stamp: 2 }), [3, 'Regional Fed President']);
  // 14 = nine medal points, one perfect exam and a stamp of 3; 15 takes the stamp to 4.
  assert.deepEqual(rung({ medals: GOLD3, perfect: 1, stamp: 3 }), [3, 'Regional Fed President']);
  assert.deepEqual(rung({ medals: GOLD3, perfect: 1, stamp: 4 }), [4, 'Vice Chair']);
  // 18 = nine medal points, three perfect exams and a stamp of 3; 19 takes the stamp to 4.
  assert.deepEqual(rung({ medals: GOLD3, perfect: 3, stamp: 3 }), [4, 'Vice Chair']);
  assert.deepEqual(rung({ medals: GOLD3, perfect: 3, stamp: 4 }), [5, 'MAESTRO']);
});

test('titleFor carries the rung emoji', () => {
  /** @param {{medals?: (string|null)[], perfect?: number, stamp?: number}} spec */
  const emoji = (spec) => Arcade.titleFor(progressOf(spec)).emoji;
  assert.equal(emoji({}), '\u{1F9FE}');
  assert.equal(emoji({ medals: ['gold'] }), '\u{1F4C8}');
  assert.equal(emoji({ medals: ['gold', 'gold', 'bronze'] }), '\u{1F3E2}');
  assert.equal(emoji({ medals: GOLD3, stamp: 2 }), '\u{1F3DB}\u{FE0F}');
  assert.equal(emoji({ medals: GOLD3, perfect: 1, stamp: 4 }), '\u{1F3A9}');
  assert.equal(emoji({ medals: GOLD3, perfect: 3, stamp: 4 }), '\u{1F3BC}');
});

test('next names the rung above and the points still owed', () => {
  assert.deepEqual(Arcade.titleFor(progressOf({})).next, { name: 'Analyst', need: 3 });
  assert.deepEqual(Arcade.titleFor(progressOf({ medals: ['silver'] })).next, { name: 'Analyst', need: 1 });
  // the hub's example line: 7 points is Branch Economist, 4 short of Regional Fed President
  assert.deepEqual(
    Arcade.titleFor(progressOf({ medals: ['gold', 'gold', 'bronze'] })).next,
    { name: 'Regional Fed President', need: 4 }
  );
  assert.deepEqual(Arcade.titleFor(progressOf({ medals: GOLD3, perfect: 3, stamp: 3 })).next, { name: 'MAESTRO', need: 1 });
  assert.equal(Arcade.titleFor(progressOf({ medals: GOLD3, perfect: 3, stamp: 4 })).next, null);
  assert.equal(Arcade.titleFor(progressOf({ medals: GOLD3, perfect: 3, stamp: 5 })).next, null);
});

test('titleFor scores an empty progress object as Intern', () => {
  assert.deepEqual(Arcade.titleFor({}), { rank: 0, name: 'Intern', emoji: '\u{1F9FE}', next: { name: 'Analyst', need: 3 } });
  assert.equal(Arcade.titleFor({ shift: null, fed: null }).name, 'Intern');
  assert.equal(Arcade.titleFor({ shift: { levels: {} }, fed: null }).name, 'Intern');
});

test('points cap at the three Shift levels and a 1-5 Fed stamp', () => {
  // the ceiling is 9 medal points + 6 perfect-exam points + a stamp of 5
  assert.equal(Arcade.titleFor(progressOf({ medals: GOLD3, perfect: 3, stamp: 5 })).name, 'MAESTRO');
  const stray = progressOf({ medals: GOLD3, perfect: 3, stamp: 5 });
  stray.shift.levels['4'] = { cleared: true, acc: 1, best: 1, medal: 'gold', exam: null, examPerfect: true };
  stray.fed.score = 99;
  assert.deepEqual(Arcade.titleFor(stray).next, null);
  // an unrecognised medal is worth nothing
  assert.equal(Arcade.titleFor(progressOf({ medals: ['platinum', 'platinum', 'platinum'] })).name, 'Intern');
  assert.equal(Arcade.titleFor(progressOf({ medals: [null, null, null] })).name, 'Intern');
});

test('titleFor uses a passed progress object verbatim and the store otherwise', () => {
  Arcade.store.set('arcade.shift.progress', progressOf({ medals: GOLD3, perfect: 3, stamp: 0 }).shift);
  Arcade.store.set('arcade.fed.best', { score: 5, initials: 'DSB', date: '2026-09-01T00:00:00.000Z' });
  // the store holds a MAESTRO, but a passed object is the only progress that counts
  assert.equal(Arcade.titleFor({}).name, 'Intern');
  assert.equal(Arcade.titleFor(progressOf({ medals: ['gold'] })).name, 'Analyst');
  assert.equal(Arcade.titleFor().name, 'MAESTRO');
  Arcade.store.remove('arcade.fed.best');
  assert.equal(Arcade.titleFor().name, 'Vice Chair');
  Arcade.store.remove('arcade.shift.progress');
  assert.deepEqual(Arcade.titleFor().next, { name: 'Analyst', need: 3 });
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
