// @ts-check
'use strict';
/* Crisis Country keeps its content in the HTML, per the house rule; these tests lift the content
   block out of the page and hold every crisis, turn, advisor line and exam item to the AP Prep
   Checklist and to the model: every shock is one the model understands, every exam item names
   real cards, and every crisis can be stabilized by some line of play. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('./crisis.model.js');

const html = fs.readFileSync(path.join(__dirname, 'crisis-country.html'), 'utf8');

/** The first <script> block that declares CRISES, run in a bare sandbox. @returns {any} */
function content() {
  const blocks = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
  const block = blocks.map((b) => b.replace(/^<script>|<\/script>$/g, '')).find((b) => /const CRISES = /.test(b));
  assert.ok(block, 'the content block exists');
  const sandbox = { self: {}, top: {}, document: { documentElement: {} } };
  vm.runInNewContext(block + '\n;this.__out = { KIND_CED, CRISES, ADVISORS, EXAM_ITEMS, TIMING, HOWTO, INTRO };', sandbox);
  return sandbox.__out;
}

const { KIND_CED, CRISES, ADVISORS, EXAM_ITEMS, TIMING, HOWTO, INTRO } = content();
const SHOCK_KEYS = ['gap', 'pi', 'exp', 'e', 'reserves', 'pop', 'pressure', 'bank'];
const STATE_KEYS = Object.keys(M.blank());

/** @param {any} C @returns {any} */
function opening(C) { const s = M.blank(); for (const k of Object.keys(C.start)) s[k] = C.start[k]; return s; }

test('five crises, numbered, each with twelve turns and an election inside them', () => {
  assert.equal(CRISES.length, 5);
  const ids = new Set();
  CRISES.forEach((C, i) => {
    assert.equal(C.n, i + 1);
    assert.ok(!ids.has(C.id), 'crisis ids are unique'); ids.add(C.id);
    assert.ok(C.name && C.country && C.blurb, 'crisis ' + C.n + ' is named');
    assert.match(C.ced, /^\d\.\d$/);
    assert.equal(C.turns.length, M.TURNS, 'crisis ' + C.n + ' has twelve turns');
    assert.ok(C.election >= 6 && C.election <= M.TURNS, 'crisis ' + C.n + ' elects in the second half');
    assert.match(C.turns[C.election - 1].headline, /ELECTION/, 'the election turn says so');
    for (const k of Object.keys(C.start)) assert.ok(STATE_KEYS.includes(k), 'crisis ' + C.n + ' start key the model knows: ' + k);
    C.turns.forEach((t, k) => {
      assert.ok(t.headline && t.headline.length <= 60, 'crisis ' + C.n + ' turn ' + (k + 1) + ' has a short headline');
      for (const key of Object.keys(t.shock)) assert.ok(SHOCK_KEYS.includes(key), 'shock key the model reads: ' + key);
      if (t.shock.bank) assert.ok(['hike', 'cut'].includes(t.shock.bank));
    });
  });
});

test('every crisis opens unstable and can be stabilized by some line of play', () => {
  // the lines a student who reads the advisors would find; played under the game's own rules
  // (two stable turns from turn four end the run; the election turn checks popularity)
  const lines = {
    recession: (s) => (s.gap < -1 ? 'spend' : 'hold'),
    hyperinflation: (s, i) => (i === 0 ? 'imf' : i === 1 ? 'reform' : s.pi > 5 ? 'austerity' : s.gap < -1 ? 'spend' : 'hold'),
    currency: (s, i) => (i === 0 ? 'imf' : i === 1 ? 'controls' : s.pi > 5 ? 'austerity' : s.gap < -1 ? 'spend' : 'hold'),
    oil: (s, i) => (i === 0 ? 'taxup' : s.pi > 5 ? 'hold' : s.gap < -1 ? 'spend' : 'hold'),
    tradewar: (s, i) => (i === 0 ? 'tradedeal' : s.reserves < 2 ? 'controls' : s.gap < -0.5 ? 'spend' : 'hold')
  };
  for (const C of CRISES) {
    let s = opening(C);
    assert.ok(!M.stable(s).ok, 'crisis ' + C.n + ' opens unstable');
    let stableAt = null, held = 0, ended = null;
    for (let i = 0; i < C.turns.length; i += 1) {
      s = M.step(s, lines[C.id](s, i), C.turns[i].shock);
      const ok = M.stable(s).ok; held = ok ? held + 1 : 0;
      if (stableAt === null && ok) stableAt = i + 1;
      if (!ok) stableAt = null;
      if (i + 1 === C.election && s.pop < 40) { ended = 'election'; break; }
      ended = M.ended(s); if (ended) break;
      if (held >= 2 && i + 1 >= 4) break;
    }
    assert.equal(ended, null, 'crisis ' + C.n + ' the sensible line survives (pop ' + s.pop + ', pi ' + s.pi + ')');
    assert.ok(stableAt !== null, 'crisis ' + C.n + ' stabilizes under a sensible line (final: pi ' + s.pi + ', u ' + s.u + ', reserves ' + s.reserves + ')');
    const result = M.score(s, { turnsToStable: stableAt, endedBy: ended });
    assert.ok(result.stamp >= 4, 'crisis ' + C.n + ' the sensible line earns at least a 4: ' + JSON.stringify(result) + ' stable at ' + stableAt);
  }
});

test('holding course all the way is not a 5 in any crisis, and printing ruins Bassinia', () => {
  for (const C of CRISES) {
    let s = opening(C);
    let stableAt = null;
    let ended = null;
    for (let i = 0; i < C.turns.length; i += 1) {
      s = M.step(s, 'hold', C.turns[i].shock);
      if (stableAt === null && M.stable(s).ok) stableAt = i + 1;
      if (!M.stable(s).ok) stableAt = null;
      if (i + 1 === C.election && s.pop < 40) { ended = 'election'; break; }
    }
    const r = M.score(s, { turnsToStable: stableAt, endedBy: ended });
    assert.ok(r.stamp <= 3, 'crisis ' + C.n + ' hold-course stamp ' + r.stamp + ' (score ' + r.score + ')');
  }
  const B = CRISES.find((C) => C.id === 'hyperinflation');
  let s = opening(B);
  let end = null;
  for (let i = 0; i < B.turns.length && !end; i += 1) { s = M.step(s, 'print', B.turns[i].shock); end = M.ended(s); }
  assert.equal(end, 'hyperinflation', 'printing every turn ends in hyperinflation');
});

test('advisors have a line for every state, and each is a sentence', () => {
  const whos = new Set(ADVISORS.map((a) => a.who));
  assert.equal(whos.size, 2);
  for (const a of ADVISORS) {
    assert.ok(STATE_KEYS.includes(a.when[0]), a.who + ' watches a state key: ' + a.when[0]);
    assert.ok(['>', '>=', '<', '<='].includes(a.when[1]));
    assert.ok(a.line.length >= 30 && /[.!?]$/.test(a.line));
  }
  for (const who of whos) {
    const fallback = ADVISORS.filter((a) => a.who === who).pop();
    assert.ok(fallback.when[2] <= -99, who + ' always has something to say');
  }
});

test('the exam items name real cards, cover every card, and read in the exam’s voice', () => {
  assert.ok(EXAM_ITEMS.length >= 8);
  const covered = new Set();
  for (const q of EXAM_ITEMS) {
    q.cards.forEach((c) => { assert.ok(M.CARDS[c], 'exam item names a card: ' + c); covered.add(c); });
    assert.equal(q.choices.length, 4);
    assert.ok(q.answer >= 0 && q.answer < 4);
    assert.match(q.stem, /^(Which|Assume|If|In |On |A |An |The )/, 'exam stem phrasing: ' + q.stem.slice(0, 30));
    assert.ok(q.why.length >= 40);
    assert.match(q.ced, /^\d\.\d$/);
    assert.ok([1, 2, 3, 4].includes(q.skill));
  }
  for (const id of M.CARD_IDS) assert.ok(covered.has(id), 'a card with no exam item: ' + id);
  for (const kind of new Set(Object.values(M.CARDS).map((c) => c.kind))) assert.match(KIND_CED[kind], /^\d\.\d$/, 'a ced per card kind: ' + kind);
});

test('the clocks are generous', () => {
  assert.ok(TIMING.turnSeconds >= 45);
  assert.ok(TIMING.warnSeconds < TIMING.turnSeconds / 2);
  assert.ok(TIMING.resultSeconds >= 2);
  assert.equal(TIMING.examSeconds, 70);
});

test('the how-to and the intro explain the game before it starts', () => {
  assert.ok(HOWTO.length >= 4);
  HOWTO.forEach((card) => assert.ok(card.emoji && card.head && card.body));
  assert.equal(INTRO.length, 3);
  INTRO.forEach((line) => assert.ok(line.emoji && line.text.length > 40));
});
