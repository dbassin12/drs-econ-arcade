// @ts-check
'use strict';
/* Graph Doctor keeps its content in the HTML, per the house rule; these tests lift the content
   block out of the page and hold every lesion, ward and exam question to the AP Prep Checklist —
   and to the graph engine: a lesion may only wound a part the market actually draws. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ArcadeGraph = require('../shared/graph.js');

const html = fs.readFileSync(path.join(__dirname, 'graph-doctor.html'), 'utf8');

/** The first <script> block that declares LESIONS, run in a bare sandbox. @returns {any} */
function content() {
  const blocks = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
  const block = blocks.map((b) => b.replace(/^<script>|<\/script>$/g, '')).find((b) => /const LESIONS = /.test(b));
  assert.ok(block, 'the content block exists');
  const sandbox = { self: {}, top: {}, document: { documentElement: {} } };
  vm.runInNewContext(block + '\n;this.__out = { LESIONS, WARDS, TIMING, HOWTO, INTRO, JUICE, MARKET_CED, MARKET_NAME };', sandbox);
  return sandbox.__out;
}

const { LESIONS, WARDS, TIMING, HOWTO, INTRO, JUICE, MARKET_CED, MARKET_NAME } = content();
const KINDS = ['axisY', 'axisX', 'tag', 'missingTag', 'slope', 'vertical', 'dot', 'tick'];

/** @param {any} l @returns {string} the svg piece a lesion occupies */
function slotOf(l) {
  if (l.kind === 'axisY' || l.kind === 'axisX' || l.kind === 'dot' || l.kind === 'tick') return l.kind;
  return 'curve:' + l.curve;
}

test('every market the engine draws has lesions, a CED tag and a name', () => {
  for (const market of Object.keys(ArcadeGraph.MARKETS)) {
    assert.ok(Array.isArray(LESIONS[market]) && LESIONS[market].length >= 7, market + ' has a lesion pool');
    assert.match(MARKET_CED[market], /^\d\.\d$/, market + ' has a ced');
    assert.ok(MARKET_NAME[market], market + ' has a name');
  }
  for (const market of Object.keys(LESIONS)) assert.ok(ArcadeGraph.MARKETS[market], 'lesions only for drawn markets: ' + market);
});

test('every lesion wounds a part its market really draws, with a rubric WHY', () => {
  const ids = new Set();
  for (const [market, pool] of Object.entries(LESIONS)) {
    const mk = ArcadeGraph.MARKETS[market];
    for (const l of pool) {
      assert.ok(!ids.has(l.id), 'lesion ids are unique: ' + l.id);
      ids.add(l.id);
      assert.ok(KINDS.includes(l.kind), l.id + ' has a known kind');
      assert.match(l.ced, /^\d\.\d$/, l.id + ' has a ced');
      assert.equal(l.skill, 4, l.id + ' is a graphing skill');
      assert.ok(l.why.length >= 40 && /[.!]$/.test(l.why), l.id + ' has a full-sentence WHY');
      if (l.kind === 'axisY' || l.kind === 'axisX' || l.kind === 'tag' || l.kind === 'tick') {
        assert.ok(l.wrong && l.wrong.length >= 1, l.id + ' names the wrong text');
      }
      if (l.kind === 'axisY') assert.notEqual(l.wrong, mk.yLabel, l.id + ' is actually wrong');
      if (l.kind === 'axisX') assert.notEqual(l.wrong, mk.xLabel, l.id + ' is actually wrong');
      if (l.curve !== undefined) {
        const c = mk.curves[l.curve];
        assert.ok(c, l.id + ' names a curve the market draws: ' + l.curve);
        if (l.kind === 'slope') assert.ok(!c.vertical, l.id + ' flips a sloped curve');
        if (l.kind === 'vertical') assert.ok(c.vertical, l.id + ' leans a vertical curve');
        if (l.kind === 'tag') assert.notEqual(l.wrong, c.label || l.curve, l.id + ' is actually wrong');
      } else {
        assert.ok(l.kind !== 'slope' && l.kind !== 'vertical' && l.kind !== 'tag' && l.kind !== 'missingTag', l.id + ' names its curve');
      }
      if (l.kind === 'tick') { assert.ok(mk.xTick, l.id + ': the market draws a reference tick'); assert.notEqual(l.wrong, mk.xTick.text); }
      if (l.kind === 'dot') assert.ok(mk.eq, l.id + ': the market draws an equilibrium dot');
    }
  }
});

test('every ward can seat its lesions without two on one part, and ends on rounds', () => {
  assert.equal(WARDS.length, 3);
  WARDS.forEach((W, i) => {
    assert.equal(W.n, i + 1);
    assert.ok(W.name && W.blurb, 'ward ' + W.n + ' is named and described');
    assert.match(W.ced, /^\d\.\d$/);
    assert.ok(W.charts >= 4 && W.lesionsPer >= 2, 'ward ' + W.n + ' has charts and lesions');
    for (const market of W.markets) {
      assert.ok(LESIONS[market], 'ward ' + W.n + ' plays a market with lesions: ' + market);
      const slots = new Set(LESIONS[market].map(slotOf));
      assert.ok(slots.size >= W.lesionsPer + 1, 'ward ' + W.n + ' ' + market + ': ' + slots.size + ' distinct parts for ' + (W.lesionsPer + 1) + ' lesions on rounds');
    }
  });
});

test('every ward has a three-question Exam Sprint in the exam’s voice', () => {
  for (const W of WARDS) {
    assert.equal(W.exam.length, 3, 'ward ' + W.n);
    for (const q of W.exam) {
      assert.equal(q.choices.length, 4);
      assert.ok(q.answer >= 0 && q.answer < 4);
      assert.match(q.stem, /^(Which|Assume|If|In |On |A |An |The )/, 'exam stem phrasing: ' + q.stem.slice(0, 30));
      assert.ok(q.why.length >= 40);
      assert.match(q.ced, /^\d\.\d$/);
      assert.equal(q.skill, 4);
    }
  }
});

test('the clocks are generous and rounds gets longer', () => {
  assert.ok(TIMING.chartSeconds >= 30);
  assert.ok(TIMING.bossSeconds > TIMING.chartSeconds);
  assert.ok(TIMING.warnSeconds < TIMING.chartSeconds / 2);
  assert.equal(TIMING.examSeconds, 70);
  assert.ok(TIMING.readGrace < TIMING.chartSeconds);
});

test('the how-to and the intro explain the game before it starts', () => {
  assert.ok(HOWTO.length >= 4);
  HOWTO.forEach((card) => assert.ok(card.emoji && card.head && card.body));
  assert.equal(INTRO.length, 3);
  INTRO.forEach((line) => assert.ok(line.emoji && line.text.length > 40));
});

test('the streak call-outs and the stamp are copy in JUICE, not buried in the code', () => {
  [3, 6, 9].forEach((n) => assert.ok(typeof JUICE.streak[n] === 'string' && JUICE.streak[n].length > 3, 'a call-out at ' + n));
  assert.ok(typeof JUICE.rounds === 'string' && JUICE.rounds.length > 2);
});
