// @ts-check
'use strict';
/* Calc Blitz keeps its content in the HTML, per the house rule; these tests lift the content
   block out of the page, deal every rung kind hundreds of times with a seeded generator, and
   hold every problem and exam question to the AP Prep Checklist — above all that every
   answer lands on its dial's grid, since a number the knob cannot reach is a rung no one
   can climb. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, 'calc-blitz.html'), 'utf8');

/** The first <script> block that declares RUNG_KINDS, run in a bare sandbox. @returns {any} */
function content() {
  const blocks = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
  const block = blocks.map((b) => b.replace(/^<script>|<\/script>$/g, '')).find((b) => /const RUNG_KINDS = /.test(b));
  assert.ok(block, 'the content block exists');
  const sandbox = { self: {}, top: {}, document: { documentElement: {} } };
  vm.runInNewContext(block + '\n;this.__out = { RUNG_KINDS, LADDERS, TIMING, HOWTO, INTRO, JUICE };', sandbox);
  return sandbox.__out;
}

/** A tiny seeded generator so a failure is reproducible. @param {number} seed @returns {() => number} */
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

const { RUNG_KINDS, LADDERS, TIMING, HOWTO, INTRO, JUICE } = content();

/** @param {number} v @param {{min:number, max:number, step:number}} d @returns {boolean} */
function onGrid(v, d) {
  if (v < d.min - 1e-9 || v > d.max + 1e-9) return false;
  const k = (v - d.min) / d.step;
  return Math.abs(k - Math.round(k)) < 1e-6;
}

test('three ladders of eight rungs, each rung a known kind, the boss last', () => {
  assert.equal(LADDERS.length, 3);
  LADDERS.forEach((L, i) => {
    assert.equal(L.n, i + 1);
    assert.ok(L.name && L.blurb, 'ladder ' + L.n + ' is named and described');
    assert.match(L.ced, /^\d\.\d$/);
    assert.equal(L.rungs.length, 8, 'ladder ' + L.n + ' has eight rungs');
    L.rungs.forEach((id) => assert.ok(RUNG_KINDS[id], 'rung kind exists: ' + id));
    assert.match(L.rungs[7], /^boss/, 'the last rung is the boss');
    assert.equal(L.rungs.filter((id) => /^boss/.test(id)).length, 1, 'one boss per ladder');
  });
});

test('every rung kind carries a ced, a skill, a unit and a dial of at most 31 steps', () => {
  for (const [id, kind] of Object.entries(RUNG_KINDS)) {
    assert.match(kind.ced, /^\d\.\d$/, id + ' has a ced');
    assert.equal(kind.skill, 3, id + ' is a Manipulation skill');
    assert.ok(['', '%', '$', '$B', '$M', '×'].includes(kind.unit), id + ' has a known unit');
    const d = kind.dial;
    assert.ok(d.max > d.min && d.step > 0, id + ' has a dial');
    const n = (d.max - d.min) / d.step;
    assert.ok(Math.abs(n - Math.round(n)) < 1e-9 && n <= 31 && n >= 8, id + ' dial has 8–31 steps: ' + n);
  }
});

test('every dealt problem lands on its dial’s grid, inside the line, with a rubric WHY', () => {
  for (const [id, kind] of Object.entries(RUNG_KINDS)) {
    const seen = new Set();
    for (let i = 0; i < 400; i += 1) {
      const p = kind.make(lcg(i * 7919 + 17));
      const d = p.dial || kind.dial;
      assert.ok(onGrid(p.answer, d), id + ' seed ' + i + ': answer ' + p.answer + ' is off the dial ' + JSON.stringify(d));
      assert.ok(p.answer !== d.min, id + ' seed ' + i + ': the answer is never the knob’s resting place');
      assert.ok(p.text.length >= 40 && p.text.length <= 240, id + ' text fits the card: ' + p.text.length);
      assert.ok(/\?$/.test(p.text), id + ' asks a question');
      assert.ok(p.why.length >= 40 && /[.!]$/.test(p.why), id + ' has a full-sentence WHY');
      assert.ok(p.why.includes(String(Number.isInteger(p.answer) ? p.answer.toLocaleString('en-US') : p.answer)), id + ' the WHY shows the answer: ' + p.why);
      seen.add(p.answer);
    }
    assert.ok(seen.size >= 3, id + ' varies its numbers (' + seen.size + ' distinct answers)');
  }
});

test('boss rungs say so, and no other rung does', () => {
  for (const [id, kind] of Object.entries(RUNG_KINDS)) {
    const p = kind.make(lcg(1));
    assert.equal(/^BOSS · /.test(p.text), /^boss/.test(id), id);
  }
});

test('every ladder has a pool of Exam Sprint items in the exam’s voice, three drawn per sprint', () => {
  for (const L of LADDERS) {
    assert.ok(L.exam.length >= 5, 'a pool of at least five for the sprint to draw three from: ' + 'ladder ' + L.n);
    for (const q of L.exam) {
      assert.equal(q.choices.length, 4);
      assert.ok(q.answer >= 0 && q.answer < 4);
      assert.match(q.stem, /^(Which|Assume|If|A |An |In |The |Nominal)/, 'exam stem phrasing: ' + q.stem.slice(0, 30));
      assert.ok(q.why.length >= 40);
      assert.match(q.ced, /^\d\.\d$/);
      assert.ok([1, 2, 3, 4].includes(q.skill));
    }
  }
});

test('the clocks are generous and the boss gets longer', () => {
  assert.ok(TIMING.rungSeconds >= 20);
  assert.ok(TIMING.bossSeconds > TIMING.rungSeconds);
  assert.ok(TIMING.warnSeconds < TIMING.rungSeconds / 2);
  assert.equal(TIMING.examSeconds, 70);
  assert.ok(TIMING.readGrace < TIMING.rungSeconds);
});

test('the how-to and the intro explain the game before it starts', () => {
  assert.ok(HOWTO.length >= 4);
  HOWTO.forEach((card) => assert.ok(card.emoji && card.head && card.body));
  assert.equal(INTRO.length, 3);
  INTRO.forEach((line) => assert.ok(line.emoji && line.text.length > 40));
});

test('the streak call-outs and the stamp are copy in JUICE, not buried in the code', () => {
  [3, 6, 9].forEach((n) => assert.ok(typeof JUICE.streak[n] === 'string' && JUICE.streak[n].length > 3, 'a call-out at ' + n));
  assert.ok(typeof JUICE.boss === 'string' && JUICE.boss.length > 2);
});
