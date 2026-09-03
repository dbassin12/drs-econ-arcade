// @ts-check
'use strict';
/* Tests for leaderboard/apps-script.js, the class board's Google Apps Script, run under Node with
   the four Google services stubbed by fake-gas.js. Run: node --test leaderboard/apps-script.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, json } = require('./fake-gas.js');

const HEADER = ['when', 'initials', 'game', 'level', 'score', 'points', 'title'];

/** @param {any} api @param {any} body @returns {any} what doPost answered */
function post(api, body) { return json(api.doPost({ postData: { contents: JSON.stringify(body) } })); }
/** @param {any} api @param {string} [code] @returns {any} what doGet answered */
function get(api, code) { return json(api.doGet({ parameter: code === undefined ? {} : { code } })); }
/** @param {any} x @returns {any} the same value in this realm — a vm sandbox hands back arrays and
 *  objects whose prototypes belong to another realm, which strict deep equality rightly refuses */
function plain(x) { return JSON.parse(JSON.stringify(x)); }

test('checkEntry accepts a well-formed post and normalises it', () => {
  const { api } = load({ classCode: 'QA' });
  const r = api.checkEntry({ code: 'QA', initials: 'dsb', game: 'shift', level: '3', score: '1450', points: 7, title: 'Analyst' });
  assert.equal(r.ok, true);
  assert.equal(r.entry.initials, 'DSB');
  assert.equal(r.entry.game, 'shift');
  assert.equal(r.entry.level, 3);
  assert.equal(r.entry.score, 1450);
  assert.equal(r.entry.points, 7);
  assert.equal(r.entry.title, 'Analyst');
  assert.match(r.entry.when, /^\d{4}-\d{2}-\d{2}T/);
});

test('checkEntry refuses the wrong code, bad initials, a blocked word, an unknown game, a level off the map and a score past the cap', () => {
  const { api } = load({ classCode: 'QA' });
  const good = { code: 'QA', initials: 'DSB', game: 'shift', level: 1, score: 100, points: 0, title: '' };
  assert.deepEqual(plain(api.checkEntry(Object.assign({}, good, { code: 'nope' }))), { ok: false, error: 'class code' });
  assert.deepEqual(plain(api.checkEntry(Object.assign({}, good, { initials: 'D?B' }))), { ok: false, error: 'initials' });
  assert.deepEqual(plain(api.checkEntry(Object.assign({}, good, { initials: 'ab' }))), { ok: false, error: 'initials' });
  assert.deepEqual(plain(api.checkEntry(Object.assign({}, good, { initials: api.BLOCKED[0] }))), { ok: false, error: 'initials' });
  assert.deepEqual(plain(api.checkEntry(Object.assign({}, good, { game: 'blaster' }))), { ok: false, error: 'game' });
  assert.deepEqual(plain(api.checkEntry(Object.assign({}, good, { game: 'toString' }))), { ok: false, error: 'game' });
  assert.deepEqual(plain(api.checkEntry(Object.assign({}, good, { level: 8 }))), { ok: false, error: 'level' });
  assert.deepEqual(plain(api.checkEntry(Object.assign({}, good, { level: 1.5 }))), { ok: false, error: 'level' });
  assert.deepEqual(plain(api.checkEntry(Object.assign({}, good, { score: 20001 }))), { ok: false, error: 'score' });
  assert.deepEqual(plain(api.checkEntry(Object.assign({}, good, { score: -1 }))), { ok: false, error: 'score' });
  assert.deepEqual(plain(api.checkEntry(Object.assign({}, good, { score: 'lots' }))), { ok: false, error: 'score' });
  // points and the title only decorate: a silly value is zeroed or trimmed, never refused
  const decorated = plain(api.checkEntry(Object.assign({}, good, { points: 9999, title: '<b>MAESTRO</b> 🎼' })));
  assert.equal(decorated.ok, true);
  assert.equal(decorated.entry.points, 0);
  assert.equal(decorated.entry.title, 'bMAESTROb');
});

test('the Fed posts a stamp of 1-5 on an era year, and nothing else', () => {
  const { api } = load({ classCode: 'QA' });
  assert.equal(api.checkEntry({ code: 'QA', initials: 'DSB', game: 'fed', level: 2008, score: 5 }).ok, true);
  assert.equal(api.checkEntry({ code: 'QA', initials: 'DSB', game: 'fed', level: 1999, score: 5 }).error, 'level');
  assert.equal(api.checkEntry({ code: 'QA', initials: 'DSB', game: 'fed', level: 1975, score: 0 }).error, 'score');
  assert.equal(api.checkEntry({ code: 'QA', initials: 'DSB', game: 'fed', level: 1975, score: 6 }).error, 'score');
});

test('aggregate keeps each player’s best per game and best points overall, ties to the first to post', () => {
  const { api } = load();
  const rows = [
    ['2026-09-01T10:00:00.000Z', 'ABC', 'shift', 1, 900, 3, 'Intern'],
    ['2026-09-01T10:05:00.000Z', 'DSB', 'shift', 2, 1200, 5, 'Analyst'],
    ['2026-09-01T10:10:00.000Z', 'ABC', 'shift', 3, 1200, 6, 'Analyst'],     // ties DSB but later
    ['2026-09-01T10:15:00.000Z', 'abc', 'shift', 1, 800, 6, 'Analyst'],      // lower: does not replace
    ['2026-09-01T10:20:00.000Z', 'ZZZ', 'sort', 1, 700, 1, 'Intern'],
    [new Date('2026-09-01T10:25:00.000Z'), 'ZZZ', 'fed', 1975, 4, 9, 'Analyst'],  // a Date cell reads the same
    ['2026-09-01T10:30:00.000Z', 'BAD?', 'shift', 1, 5000, 0, ''],           // junk initials are skipped
    ['2026-09-01T10:35:00.000Z', 'XYZ', 'blaster', 1, 5000, 0, '']           // an unknown game is skipped
  ];
  const b = plain(api.aggregate(rows));
  assert.deepEqual(b.games.shift.map((r) => r.initials + ':' + r.score + ':L' + r.level), ['DSB:1200:L2', 'ABC:1200:L3']);
  assert.deepEqual(b.games.sort.map((r) => r.initials), ['ZZZ']);
  assert.deepEqual(b.games.fed.map((r) => r.initials + ':' + r.score + ':' + r.level + ':' + r.when), ['ZZZ:4:1975:2026-09-01T10:25:00.000Z']);
  assert.deepEqual(b.games.crisis, []);
  assert.deepEqual(b.overall.map((r) => r.initials + ':' + r.points + ':' + r.title), ['ZZZ:9:Analyst', 'ABC:6:Analyst', 'DSB:5:Analyst']);
  assert.equal(b.players, 3);
  assert.equal(api.rankOf(b.games.shift, 'ABC'), 2);
  assert.equal(api.rankOf(b.games.shift, 'QQQ'), 0);
});

test('the first post creates the board tab with its header, appends the row and answers with the rank', () => {
  const box = load({ classCode: 'QA' });
  const r1 = post(box.api, { code: 'QA', initials: 'DSB', game: 'calc', level: 1, score: 640, points: 2, title: 'Intern' });
  assert.deepEqual(r1, { ok: true, rank: 1, of: 1, best: 640 });
  assert.deepEqual(plain(box.tabs.board.rows[0]), HEADER);
  assert.equal(box.tabs.board.rows.length, 2);
  assert.equal(box.tabs.board.rows[1][1], 'DSB');
  const r2 = post(box.api, { code: 'QA', initials: 'ABC', game: 'calc', level: 2, score: 900, points: 0, title: '' });
  assert.deepEqual(r2, { ok: true, rank: 1, of: 2, best: 900 });
  const r3 = post(box.api, { code: 'QA', initials: 'DSB', game: 'calc', level: 3, score: 500, points: 2, title: 'Intern' });
  assert.deepEqual(r3, { ok: true, rank: 2, of: 2, best: 640 }, 'a lower post lands in the log but the best stands');
  assert.equal(box.locks, 0, 'the lock is always released');
});

test('a refused post lands nowhere', () => {
  const box = load({ classCode: 'QA' });
  assert.deepEqual(post(box.api, { code: 'QA', initials: 'DSB', game: 'calc', level: 9, score: 640 }), { ok: false, error: 'level' });
  assert.deepEqual(post(box.api, { code: 'wrong', initials: 'DSB', game: 'calc', level: 1, score: 640 }), { ok: false, error: 'class code' });
  assert.equal(box.tabs.board, undefined, 'nothing was written, not even the header');
  assert.deepEqual(json(box.api.doPost({ postData: { contents: '{not json' } })), { ok: false, error: 'json' });
  assert.deepEqual(json(box.api.doPost({})), { ok: false, error: 'class code' });
});

test('doGet needs the class code and serves the board with the class name', () => {
  const box = load({ classCode: 'QA', tabs: { board: [HEADER, ['2026-09-01T10:00:00.000Z', 'DSB', 'shift', 2, 1200, 5, 'Analyst']] } });
  assert.deepEqual(get(box.api, 'nope'), { ok: false, error: 'class code' });
  assert.deepEqual(get(box.api), { ok: false, error: 'class code' });
  const b = get(box.api, 'QA');
  assert.equal(b.ok, true);
  assert.equal(b.className, 'AP Macro');
  assert.equal(b.players, 1);
  assert.deepEqual(b.games.shift, [{ initials: 'DSB', score: 1200, level: 2, when: '2026-09-01T10:00:00.000Z' }]);
  assert.deepEqual(b.overall, [{ initials: 'DSB', points: 5, title: 'Analyst', when: '2026-09-01T10:00:00.000Z' }]);
  assert.match(b.updated, /^\d{4}-/);
});

test('an empty class code turns the check off, for a teacher who wants an open board', () => {
  const box = load({ classCode: '' });
  assert.equal(get(box.api).ok, true);
  assert.equal(post(box.api, { initials: 'DSB', game: 'sort', level: 1, score: 10 }).ok, true);
});

test('a read is served from cache for CACHE_SECONDS, and a post refreshes it', () => {
  let clock = 1000000;
  const box = load({ classCode: 'QA', now: () => clock });
  assert.equal(get(box.api, 'QA').players, 0);
  post(box.api, { code: 'QA', initials: 'DSB', game: 'sort', level: 1, score: 10 });
  assert.equal(get(box.api, 'QA').players, 1, 'the post emptied the cache');
  box.tabs.board.rows.push(['2026-09-01T10:00:00.000Z', 'ABC', 'sort', 1, 20, 0, '']);   // a row typed straight into the Sheet
  assert.equal(get(box.api, 'QA').players, 1, 'inside the window the cached board is served');
  clock += 16000;
  assert.equal(get(box.api, 'QA').players, 2, 'after it, the Sheet is read again');
});

test('a read only looks at the newest MAX_ROWS_PER_READ posts', () => {
  const rows = [HEADER];
  for (let i = 0; i < 5010; i += 1) rows.push(['2026-09-01T10:00:00.000Z', 'OLD', 'sort', 1, 1, 0, '']);
  rows.push(['2026-09-02T10:00:00.000Z', 'NEW', 'sort', 1, 2, 0, '']);
  const box = load({ classCode: 'QA', tabs: { board: rows } });
  const b = get(box.api, 'QA');
  assert.deepEqual(b.games.sort.map((r) => r.initials), ['NEW', 'OLD']);
});
