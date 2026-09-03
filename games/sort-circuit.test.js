// @ts-check
'use strict';
/* Sort Circuit keeps its content in the HTML, per the house rule; these tests lift the content
   block out of the page and hold every deck, card and exam question to the AP Prep Checklist. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, 'sort-circuit.html'), 'utf8');

/** The first <script> block that declares DECKS, run in a bare sandbox. @returns {any} */
function content() {
  const blocks = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
  const block = blocks.map((b) => b.replace(/^<script>|<\/script>$/g, '')).find((b) => /const DECKS = /.test(b));
  assert.ok(block, 'the content block exists');
  const sandbox = { self: {}, top: {}, document: { documentElement: {} } };
  vm.runInNewContext(block + '\n;this.__out = { DECKS, TIMING, HOWTO, INTRO, JUICE };', sandbox);
  return sandbox.__out;
}

const { DECKS, TIMING, HOWTO, INTRO, JUICE } = content();

test('four decks, numbered in order, each with two bins and a CED tag', () => {
  assert.equal(DECKS.length, 4);
  DECKS.forEach((D, i) => {
    assert.equal(D.n, i + 1);
    assert.ok(D.name && D.blurb, 'deck ' + D.n + ' is named and described');
    assert.equal(D.bins.length, 2, 'deck ' + D.n + ' sorts into exactly two bins');
    assert.match(D.ced, /^\d\.\d$/, 'deck ' + D.n + ' names its CED topic');
  });
});

test('every card carries text, an emoji, a bin, a rubric WHY line, a ced and a skill', () => {
  const ids = new Set();
  for (const D of DECKS) {
    assert.ok(D.pool.length >= 12, 'deck ' + D.n + ' has at least 12 cards');
    for (const c of D.pool) {
      assert.ok(!ids.has(c.id), 'card ids are unique: ' + c.id);
      ids.add(c.id);
      assert.ok(c.text.length >= 8 && c.text.length <= 64, c.id + ' fits the card: ' + c.text.length + ' chars');
      assert.ok(c.emoji, c.id + ' has an emoji');
      assert.ok(c.bin === 0 || c.bin === 1, c.id + ' names a bin');
      assert.ok(c.why.length >= 40 && /[.!]$/.test(c.why), c.id + ' has a full-sentence WHY');
      assert.match(c.ced, /^\d\.\d$/, c.id + ' has a ced');
      assert.ok([1, 2, 3, 4].includes(c.skill), c.id + ' has a skill');
    }
  }
});

test('no deck is lopsided: each bin holds at least a third of the cards', () => {
  for (const D of DECKS) {
    const left = D.pool.filter((c) => c.bin === 0).length;
    const right = D.pool.length - left;
    assert.ok(left >= D.pool.length / 3 && right >= D.pool.length / 3, 'deck ' + D.n + ': ' + left + ' left, ' + right + ' right');
  }
});

test('every deck has a three-question Exam Sprint in the exam’s voice', () => {
  for (const D of DECKS) {
    assert.equal(D.exam.length, 3, 'deck ' + D.n);
    for (const q of D.exam) {
      assert.equal(q.choices.length, 4, 'four choices');
      assert.ok(q.answer >= 0 && q.answer < 4, 'the key points at a choice');
      assert.match(q.stem, /^(Which|Assume|A |An |The )/, 'exam stem phrasing: ' + q.stem.slice(0, 30));
      assert.ok(q.why.length >= 40, 'the exam WHY is a rubric sentence');
      assert.match(q.ced, /^\d\.\d$/);
      assert.ok([1, 2, 3, 4].includes(q.skill));
    }
  }
});

test('the clocks are generous and the lightning finish is the only fast one', () => {
  assert.ok(TIMING.cardSeconds >= 10, 'a card gets at least 10 seconds');
  assert.ok(TIMING.lightningSeconds >= 5 && TIMING.lightningSeconds < TIMING.cardSeconds);
  assert.ok(TIMING.warnSeconds < TIMING.lightningSeconds, 'the red zone fits inside a lightning card');
  assert.equal(TIMING.examSeconds, 70, 'the Exam Sprint keeps the exam’s pace');
  assert.ok(TIMING.whySeconds >= 1);
});

test('the how-to and the intro explain the game before it starts', () => {
  assert.ok(HOWTO.length >= 4);
  HOWTO.forEach((card) => assert.ok(card.emoji && card.head && card.body));
  assert.ok(INTRO.length === 3);
  INTRO.forEach((line) => assert.ok(line.emoji && line.text.length > 40));
});

test('the streak call-outs and the stamp are copy in JUICE, not buried in the code', () => {
  [3, 6, 9].forEach((n) => assert.ok(typeof JUICE.streak[n] === 'string' && JUICE.streak[n].length > 3, 'a call-out at ' + n));
  assert.ok(typeof JUICE.lightning === 'string' && JUICE.lightning.length > 2);
});
