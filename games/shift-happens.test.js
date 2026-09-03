// @ts-check
'use strict';
/* Shift Happens keeps its content in the HTML, per the house rule; these tests lift the content block
   out of the page and hold every level, card, boss and exam question to the AP Prep Checklist and to
   the layout rules the phone taught us. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Arcade = require('../shared/arcade.js');
const ArcadeGraph = require('../shared/graph.js');

const html = fs.readFileSync(path.join(__dirname, 'shift-happens.html'), 'utf8');

/** The first <script> block that declares LEVELS, run in a bare sandbox. @returns {any} */
function content() {
  const blocks = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
  const block = blocks.map((b) => b.replace(/^<script>|<\/script>$/g, '')).find((b) => /const LEVELS = /.test(b));
  assert.ok(block, 'the content block exists');
  const sandbox = { self: {}, top: {}, document: { documentElement: {} } };
  vm.runInNewContext(block + '\n;this.__out = { LEVELS, TIMING, HOWTO, INTRO, TUTORIAL, JUICE };', sandbox);
  return sandbox.__out;
}

const { LEVELS, TIMING, HOWTO, INTRO, TUTORIAL, JUICE } = content();
const HEAD_MAX = 30;    // a headline longer than this pushes the play column past a 740 px phone
const SUB_MAX = 80;     // and a sub longer than this does the same over six draws

test('seven levels, numbered in order, each on a market the engine draws, each ready', () => {
  assert.equal(LEVELS.length, 7);
  LEVELS.forEach((L, i) => {
    assert.equal(L.n, i + 1);
    assert.equal(L.ready, true, 'level ' + L.n + ' is built');
    assert.ok(ArcadeGraph.MARKETS[L.market], 'level ' + L.n + ' names a market: ' + L.market);
    assert.ok(L.name && L.blurb, 'level ' + L.n + ' is named and described');
    L.draggable.forEach((c) => assert.ok(ArcadeGraph.MARKETS[L.market].curves[c], 'level ' + L.n + ' lets the student drag a curve the market has: ' + c));
  });
});

test('every card carries a headline, a sub, an emoji, a curve and direction, a rubric WHY, a CED tag and a skill', () => {
  LEVELS.forEach((L) => {
    assert.ok(L.pool.length >= 12, 'level ' + L.n + ' has a dozen cards to draw eight from');
    const ids = new Set();
    L.pool.forEach((c) => {
      assert.ok(!ids.has(c.id), 'unique id ' + c.id); ids.add(c.id);
      assert.ok(['shift', 'move'].includes(c.kind), c.id + ' kind');
      assert.ok(c.head && c.sub && c.emoji, c.id + ' has its words');
      assert.ok(c.head.length <= HEAD_MAX, c.id + ' headline fits: ' + c.head.length);
      assert.ok(c.sub.length <= SUB_MAX, c.id + ' sub fits: ' + c.sub.length);
      const curves = ArcadeGraph.MARKETS[L.market].curves;
      assert.ok(c.curve === 'any' || curves[c.curve], c.id + ' names a curve of its market: ' + c.curve);
      if (c.kind === 'shift') { assert.ok(['L', 'R'].includes(c.dir), c.id + ' shift direction'); assert.ok(L.draggable.includes(c.curve), c.id + ' shifts a curve the level lets you drag'); }
      else assert.ok(['up', 'down'].includes(c.dir), c.id + ' move direction');
      assert.ok(c.why.length >= 70 && /[.]$/.test(c.why), c.id + ' WHY is a full sentence');
      assert.ok(Arcade.CED_NAMES[c.ced], c.id + ' CED tag: ' + c.ced);
      assert.ok([1, 2, 3, 4].includes(c.skill), c.id + ' skill');
      assert.ok(typeof c.trick === 'boolean', c.id + ' says whether it is a trick');
      if (c.gap !== null) assert.ok(['recessionary', 'inflationary', 'none'].includes(c.gap), c.id + ' gap');
    });
  });
});

test('from Level 2 on every level hides at least two trick cards, and Level 1 none', () => {
  LEVELS.forEach((L) => {
    const tricks = L.pool.filter((c) => c.trick).length;
    if (L.n === 1) assert.equal(tricks, 0, 'Level 1 is the rookie level');
    else assert.ok(tricks >= 2, 'level ' + L.n + ' has ' + tricks + ' trick cards');
  });
});

test('every boss has two moves with their own WHYs, a combined WHY, and says whether order matters', () => {
  LEVELS.forEach((L) => {
    const B = L.boss;
    assert.equal(B.kind, 'boss');
    assert.equal(B.moves.length, 2, 'level ' + L.n + ' boss takes two headlines');
    B.moves.forEach((m) => { assert.ok(m.head && m.why.length >= 60, 'boss move on level ' + L.n + ' has a headline and a WHY'); assert.ok(m.curve && m.dir, 'boss move names curve and direction'); });
    assert.ok(B.why.length >= 80 && /[.]$/.test(B.why), 'level ' + L.n + ' boss WHY reads the combined outcome');
    assert.ok(typeof B.anyOrder === 'boolean' || B.anyOrder === undefined);
    assert.ok(Arcade.CED_NAMES[B.ced], 'boss CED ' + B.ced);
  });
});

test('every level has an Exam Sprint of at least three College Board-voiced items, four choices each, tagged', () => {
  LEVELS.forEach((L) => {
    assert.ok(L.exam.length >= 3, 'level ' + L.n + ' sprint');
    L.exam.forEach((q, i) => {
      const w = 'level ' + L.n + ' item ' + (i + 1);
      assert.equal(q.choices.length, 4, w + ' has four choices');
      assert.equal(new Set(q.choices).size, 4, w + ' choices differ');
      assert.ok(q.answer >= 0 && q.answer < 4, w + ' answer index');
      assert.match(q.stem, /^(Assume|Which of the following|In a correctly labeled|If |A |An |The |On a correctly labeled|Suppose)/, w + ' stem in the exam voice');
      assert.ok(q.why.length >= 60 && /[.]$/.test(q.why), w + ' WHY is a rubric sentence');
      assert.ok(Arcade.CED_NAMES[q.ced], w + ' CED tag');
      assert.ok([1, 2, 3, 4].includes(q.skill), w + ' skill');
    });
  });
});

test('the clocks are generous, and every level has a card clock and a boss clock', () => {
  LEVELS.forEach((L) => {
    assert.ok(TIMING.cardSeconds[L.n] >= 20, 'level ' + L.n + ' card clock');
    assert.ok(TIMING.bossSeconds[L.n] >= TIMING.cardSeconds[L.n], 'level ' + L.n + ' boss clock is no shorter');
  });
  assert.equal(TIMING.examSeconds, 70, 'the sprint runs at Section I pace');
  assert.ok(TIMING.readGrace >= 3 && TIMING.warnSeconds >= 3);
});

test('the how-to, the intro, the tutorial and the juice explain and celebrate the game', () => {
  assert.ok(HOWTO.length >= 8);
  HOWTO.forEach((c) => { assert.ok(c.emoji && c.head && c.body, 'how-to card'); if (c.levels) c.levels.forEach((n) => assert.ok(n >= 1 && n <= 7)); });
  assert.ok(INTRO.length === 3);
  INTRO.forEach((l) => assert.ok(l.emoji && l.text.length > 40));
  assert.ok(LEVELS[0].pool.some((c) => c.id === TUTORIAL.cardId), 'the tutorial card is a Level 1 card');
  ['hint', 'miss', 'show', 'done'].forEach((k) => assert.ok(TUTORIAL[k].length > 20, 'tutorial ' + k));
  [3, 6, 9].forEach((n) => assert.ok(typeof JUICE.streak[n] === 'string'));
  assert.ok(typeof JUICE.boss === 'string');
});
