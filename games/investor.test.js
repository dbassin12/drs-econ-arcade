// @ts-check
'use strict';
/* The Investor keeps its content in the HTML, per the house rule; these tests lift the content
   block out of the page and hold every scenario, whisper, lesson and exam item to the AP Prep
   Checklist and to the model: a whisper marked reliable must be right about the Fed, every
   shock must be one the model knows, and a 5 must be reachable in every run. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('./investor.model.js');

const html = fs.readFileSync(path.join(__dirname, 'investor.html'), 'utf8');

/** The first <script> block that declares SCENARIOS, run in a bare sandbox. @returns {any} */
function content() {
  const blocks = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
  const block = blocks.map((b) => b.replace(/^<script>|<\/script>$/g, '')).find((b) => /const SCENARIOS = /.test(b));
  assert.ok(block, 'the content block exists');
  const sandbox = { self: {}, top: {}, document: { documentElement: {} } };
  vm.runInNewContext(block + '\n;this.__out = { ASSETS, SCENARIOS, LESSONS, BADGES, EXAM_ITEMS, TIMING, HOWTO, INTRO, JUICE };', sandbox);
  return sandbox.__out;
}

const { ASSETS, SCENARIOS, LESSONS, BADGES, EXAM_ITEMS, TIMING, HOWTO, INTRO, JUICE } = content();

test('the five buckets are the model’s five assets, in order', () => {
  assert.deepEqual([...ASSETS.map((a) => a.id)], M.ASSET_IDS);   // spread: the sandbox's arrays are another realm's
  ASSETS.forEach((a) => assert.ok(a.name && a.emoji && a.rule.length >= 20, a.id));
});

test('three runs of twelve quarters; every whisper marked reliable is right about the Fed', () => {
  assert.equal(SCENARIOS.length, 3);
  SCENARIOS.forEach((S, i) => {
    assert.equal(S.n, i + 1);
    assert.ok(S.name && S.blurb && S.fed && S.fed.name && S.fed.style, 'run ' + S.n + ' is named');
    assert.ok(S.rate0 > 0 && typeof S.highInflation === 'boolean');
    assert.equal(S.quarters.length, 12, 'run ' + S.n + ' has twelve quarters');
    S.quarters.forEach((q, k) => {
      const tag = 'run ' + S.n + ' Q' + (k + 1);
      assert.ok(q.news && q.news.length <= 60, tag + ' has a short headline');
      assert.ok(['hike', 'cut', 'hold'].includes(q.signal.lean), tag + ' whisper leans somewhere');
      assert.ok(q.signal.text, tag + ' whisper has words');
      const did = q.dRate > 0 ? 'hike' : q.dRate < 0 ? 'cut' : 'hold';
      assert.equal(q.signal.reliable, did === q.signal.lean, tag + ': reliable means right (' + q.signal.lean + ' vs ' + did + ')');
      assert.ok(Math.abs(q.dRate) <= 1, tag + ' moves at most a point');
      assert.ok(q.inflation >= -1 && q.inflation <= 12, tag + ' inflation is plausible');
      assert.ok(q.growth >= -5 && q.growth <= 6, tag + ' growth is plausible');
      if (q.shock) assert.ok(M.SHOCKS[q.shock], tag + ' shock is one the model knows: ' + q.shock);
    });
    const wrong = S.quarters.filter((q) => !q.signal.reliable).length;
    assert.ok(wrong >= 2 && wrong <= 5, 'run ' + S.n + ' has some wrong whispers (' + wrong + ')');
    const path = M.simulate(S, () => [2, 2, 2, 2, 2]);
    assert.ok(path.history.every((h) => h.q.rate >= 0), 'run ' + S.n + ' never goes below zero');
  });
  assert.equal(SCENARIOS.filter((S) => S.highInflation).length, 1, 'one high-inflation run');
});

test('every lesson the model can name has words, a ced and a skill', () => {
  const rets = M.returns({ rate: 4, dRate: 0, inflation: 2, growth: 2 }, { cdRate: 0 });
  const named = new Set();
  for (const S of SCENARIOS) M.simulate(S, () => [2, 2, 2, 2, 2]).history.forEach((h) => named.add(M.lessonFor(h.q, h.result.returns)));
  for (const shock of Object.keys(M.SHOCKS)) named.add(M.lessonFor({ rate: 4, dRate: 0, inflation: 2, growth: 2, shock }, rets));
  ['bondsDown', 'bondsUp', 'realVsNominal', 'cdLock', 'transmission'].forEach((l) => named.add(l));
  for (const id of named) {
    assert.ok(LESSONS[id], 'lesson exists: ' + id);
    assert.match(LESSONS[id].ced, /^\d\.\d$/, id);
    assert.ok([1, 2, 3, 4].includes(LESSONS[id].skill), id);
    assert.ok(LESSONS[id].why.length >= 60 && /[.!]$/.test(LESSONS[id].why), id + ' has a rubric sentence');
  }
});

test('the exam items cover every lesson and read in the exam’s voice', () => {
  assert.ok(EXAM_ITEMS.length >= 6);
  const covered = new Set();
  for (const q of EXAM_ITEMS) {
    assert.ok(q.lessons.length >= 1);
    q.lessons.forEach((l) => { assert.ok(LESSONS[l], 'exam item names a lesson: ' + l); covered.add(l); });
    assert.equal(q.choices.length, 4);
    assert.ok(q.answer >= 0 && q.answer < 4);
    assert.match(q.stem, /^(Which|Assume|If|In |On |A |An |The |Interest)/, 'exam stem phrasing: ' + q.stem.slice(0, 30));
    assert.ok(q.why.length >= 40);
    assert.match(q.ced, /^\d\.\d$/);
    assert.ok([1, 2, 3, 4].includes(q.skill));
  }
  for (const id of Object.keys(LESSONS)) assert.ok(covered.has(id), 'a lesson with no exam item: ' + id);
  for (const id of Object.keys(LESSONS)) assert.ok(EXAM_ITEMS.filter((q) => q.lessons.includes(id)).length >= 1);
});

test('a 5 is reachable in every run, and all-cash is not a 5 anywhere', () => {
  for (const S of SCENARIOS) {
    const par = M.benchmark(S);
    assert.ok(par > -15 && par < 30, 'run ' + S.n + ' par is sane: ' + par);
    // perfect foresight: bonds into cuts, cash into hikes, stocks into rallies, out of crashes
    const seer = M.simulate(S, (q) => {
      if (q.shock === 'crash' || q.shock === 'flight') return [5, 0, 5, 0, 0];
      if (q.shock === 'rally') return [0, 0, 0, 10, 0];
      if (q.dRate > 0) return [10, 0, 0, 0, 0];
      if (q.dRate < 0) return [0, 0, 6, 2, 2];
      return q.growth >= 2 ? [0, 0, 2, 5, 3] : [3, 3, 2, 2, 0];
    });
    assert.equal(M.stamp(seer.realPct, par), 5, 'run ' + S.n + ': foresight earns a 5 (' + seer.realPct + ' vs par ' + par + ')');
    const cash = M.simulate(S, () => [10, 0, 0, 0, 0]);
    assert.ok(M.stamp(cash.realPct, par) <= 4, 'run ' + S.n + ': all cash is not a 5 (' + cash.realPct + ')');
  }
});

test('badges are named, and every badge the model can award has words', () => {
  ['bondWhisperer', 'inflationSurvivor', 'diamondHands'].forEach((b) => assert.ok(BADGES[b] && BADGES[b].name && BADGES[b].emoji && BADGES[b].blurb, b));
});

test('the clocks are generous', () => {
  assert.ok(TIMING.quarterSeconds >= 30);
  assert.ok(TIMING.warnSeconds < TIMING.quarterSeconds / 2);
  assert.ok(TIMING.revealSeconds >= 2);
  assert.equal(TIMING.examSeconds, 70);
});

test('the how-to and the intro explain the game before it starts', () => {
  assert.ok(HOWTO.length >= 4);
  HOWTO.forEach((card) => assert.ok(card.emoji && card.head && card.body));
  assert.equal(INTRO.length, 3);
  INTRO.forEach((line) => assert.ok(line.emoji && line.text.length > 40));
});

test('the streak call-outs and the stamp are copy in JUICE, not buried in the code', () => {
  [3, 6, 9].forEach((n) => assert.ok(typeof JUICE.streak[n] === 'string' && JUICE.streak[n].length > 3, 'a call-out at ' + n));
  ['hold', 'hike', 'cut'].forEach((k) => assert.ok(typeof JUICE.fomc[k] === 'string' && JUICE.fomc[k].length > 2, 'fomc ' + k));
});
