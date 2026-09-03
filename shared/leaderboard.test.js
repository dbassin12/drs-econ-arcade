// @ts-check
'use strict';
/* Tests for the pure half of shared/leaderboard.js — the settings gate, the rows a board becomes,
   the player's own row, the offline queue, and the wire from Arcade.onBest to a post.
   Run: node --test shared/leaderboard.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const Arcade = require('./arcade.js');
const Leaderboard = require('./leaderboard.js');

const BOARD = {
  ok: true, className: 'AP Macro', players: 3, updated: '2026-09-03T12:00:00.000Z',
  games: {
    shift: [
      { initials: 'ABC', score: 1450, level: 3, when: '2026-09-01T10:00:00.000Z' },
      { initials: 'DSB', score: 1200, level: 2, when: '2026-09-01T10:05:00.000Z' },
      { initials: 'ZZZ', score: 900, level: 1, when: '2026-09-01T10:10:00.000Z' }
    ],
    fed: [{ initials: 'DSB', score: 4, level: 1975, when: '2026-09-01T10:20:00.000Z' }],
    investor: [{ initials: 'ZZZ', score: 10412, level: 2, when: '2026-09-01T10:20:00.000Z' }],
    crisis: []
  },
  overall: [
    { initials: 'ZZZ', points: 9, title: 'Analyst', when: '2026-09-01T10:20:00.000Z' },
    { initials: 'DSB', points: 5, title: 'Analyst', when: '2026-09-01T10:05:00.000Z' }
  ]
};

/** Stand in for fetch for one test. @param {(url:string, init:any) => any} fn a response body, or a throw
 *  @returns {() => void} restore */
function withFetch(fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'fetch');
  const before = globalThis.fetch;
  // @ts-ignore
  globalThis.fetch = (url, init) => Promise.resolve().then(() => {
    const body = fn(String(url), init);
    return { ok: true, json: () => Promise.resolve(body) };
  });
  return () => { if (had) globalThis.fetch = before; else delete globalThis.fetch; };
}

/** Point the module at a pretend class for one test. @param {{url?:string, classCode?:string, refreshSeconds?:number}} patch
 *  @returns {() => void} restore */
function withConfig(patch) {
  const before = Leaderboard.config();
  Leaderboard.configure(patch);
  return () => { Leaderboard.configure(before); };
}

test('with no URL the board is off and every call is a harmless no-op', async () => {
  assert.equal(Leaderboard.configured(), false);
  assert.equal(await Leaderboard.load(), null);
  assert.equal(await Leaderboard.send({ initials: 'DSB', game: 'shift', level: 1, score: 10 }), null);
  assert.equal(await Leaderboard.flush(), 0);
  assert.deepEqual(Leaderboard.config(), { url: '', classCode: '', refreshSeconds: 30 });
});

test('configure changes only the fields it is handed, and refuses a nonsense refresh', () => {
  const before = Leaderboard.config();
  assert.deepEqual(Leaderboard.configure({ refreshSeconds: -5 }), before);
  assert.deepEqual(Leaderboard.configure({ url: 'https://example.test/exec' }), { url: 'https://example.test/exec', classCode: '', refreshSeconds: 30 });
  assert.equal(Leaderboard.configured(), true);
  assert.deepEqual(Leaderboard.configure({ url: 'ftp://nope' }), { url: 'ftp://nope', classCode: '', refreshSeconds: 30 });
  assert.equal(Leaderboard.configured(), false, 'only http(s) counts as connected');
  Leaderboard.configure(before);
  assert.deepEqual(Leaderboard.config(), before);
});

test('the seven games each say how their row reads', () => {
  assert.deepEqual(Leaderboard.GAME_IDS, ['shift', 'fed', 'sort', 'calc', 'doctor', 'investor', 'crisis']);
  assert.deepEqual(Leaderboard.describe('shift', { score: 1450, level: 3 }), { value: '1,450', sub: 'L3' });
  assert.deepEqual(Leaderboard.describe('fed', { score: 4, level: 1975 }), { value: 'Stamp 4', sub: '1975' });
  assert.deepEqual(Leaderboard.describe('sort', { score: 700, level: 2 }), { value: '700', sub: 'Deck 2' });
  assert.deepEqual(Leaderboard.describe('calc', { score: 640, level: 1 }), { value: '640', sub: 'Ladder 1' });
  assert.deepEqual(Leaderboard.describe('doctor', { score: 900, level: 3 }), { value: '900', sub: 'Ward 3' });
  assert.deepEqual(Leaderboard.describe('investor', { score: 10412, level: 2 }), { value: 'Real $10,412', sub: 'Run 2' });
  assert.deepEqual(Leaderboard.describe('crisis', { score: 84, level: 5 }), { value: '84 pts', sub: 'Crisis 5' });
  assert.deepEqual(Leaderboard.describe('shift', { score: 10 }), { value: '10', sub: '' }, 'no level, no sub');
  Leaderboard.GAME_IDS.forEach((id) => assert.ok(Leaderboard.GAMES[id].short.length <= 8, id + ' fits a tab'));
});

test('rows turns a board tab into ranked lines, and an unknown or missing tab into none', () => {
  assert.deepEqual(Leaderboard.rows(BOARD, 'shift').map((r) => r.initials + ' ' + r.value + ' ' + r.sub), ['ABC 1,450 L3', 'DSB 1,200 L2', 'ZZZ 900 L1']);
  assert.deepEqual(Leaderboard.rows(BOARD, 'overall').map((r) => r.initials + ' ' + r.value + ' ' + r.sub), ['ZZZ 9 pts Analyst', 'DSB 5 pts Analyst']);
  assert.deepEqual(Leaderboard.rows(BOARD, 'crisis'), []);
  assert.deepEqual(Leaderboard.rows(BOARD, 'sort'), []);
  assert.deepEqual(Leaderboard.rows(null, 'shift'), []);
  assert.deepEqual(Leaderboard.rows({ ok: true }, 'overall'), []);
});

test('withYou keeps the top of the list and the player’s own row wherever it is', () => {
  const list = Leaderboard.rows(BOARD, 'shift');
  assert.deepEqual(Leaderboard.withYou(list, 'ZZZ', 2).map((r) => r.rank + ':' + r.initials + (r.you ? '*' : '')), ['1:ABC', '2:DSB', '3:ZZZ*']);
  assert.deepEqual(Leaderboard.withYou(list, 'ABC', 2).map((r) => r.rank + ':' + r.initials + (r.you ? '*' : '')), ['1:ABC*', '2:DSB']);
  assert.deepEqual(Leaderboard.withYou(list, '???').length, 3, 'the default limit is ten');
  assert.deepEqual(Leaderboard.withYou([], 'DSB'), []);
});

test('deviceRows reads this device’s bests, newest first, in the words the hub uses', () => {
  ['shift', 'fed', 'sort'].forEach((id) => Arcade.store.remove('arcade.' + id + '.best'));
  Arcade.store.set('arcade.shift.best', { score: 1450, initials: 'DSB', level: 3, date: '2026-09-01T10:00:00.000Z' });
  Arcade.store.set('arcade.fed.best', { score: 4, initials: 'DSB', level: 2008, date: '2026-09-02T10:00:00.000Z' });
  Arcade.store.set('arcade.sort.best', { score: 700, initials: 'DSB', level: 1, date: '2026-08-30T10:00:00.000Z' });
  assert.deepEqual(Leaderboard.deviceRows().map((r) => r.value + ' · ' + r.sub), ['Stamp 4 · Fed Chair · 2008', '1,450 · Shift Happens · L3', '700 · Sort Circuit · Deck 1']);
  ['shift', 'fed', 'sort'].forEach((id) => Arcade.store.remove('arcade.' + id + '.best'));
  assert.deepEqual(Leaderboard.deviceRows(), []);
});

test('entryFor carries the record and the career it sits in', () => {
  const e = Leaderboard.entryFor('sort', { score: 700, initials: 'DSB', level: 2, date: 'x' });
  assert.equal(e.game, 'sort');
  assert.equal(e.initials, 'DSB');
  assert.equal(e.level, 2);
  assert.equal(e.score, 700);
  assert.equal(typeof e.points, 'number');
  assert.equal(typeof e.title, 'string');
  assert.equal(Leaderboard.entryFor('fed', { score: 3, initials: 'DSB', date: 'x' }).level, 1, 'no level reads as level 1');
});

test('validInitials wants three letters and refuses the unset chip', () => {
  assert.equal(Leaderboard.validInitials('DSB'), true);
  assert.equal(Leaderboard.validInitials('???'), false);
  assert.equal(Leaderboard.validInitials('D?B'), false);
  assert.equal(Leaderboard.validInitials('dsb'), false, 'the store already upper-cases; a lowercase value never reaches here');
  assert.equal(Leaderboard.validInitials(''), false);
});

test('verdict turns the server’s answer into the one line the student sees', () => {
  assert.equal(Leaderboard.verdict('shift', { ok: true, rank: 1, of: 1 }), '🏆 First on the class board · Shift Happens');
  assert.equal(Leaderboard.verdict('sort', { ok: true, rank: 3, of: 12 }), '🏆 #3 of 12 · Sort Circuit');
  assert.match(String(Leaderboard.verdict('calc', null)), /back online/);
  assert.match(String(Leaderboard.verdict('calc', { ok: false, error: 'initials' })), /initials/);
  assert.match(String(Leaderboard.verdict('calc', { ok: false, error: 'class code' })), /class code/);
  assert.equal(Leaderboard.verdict('calc', { ok: false, error: 'score' }), null, 'a refused shape is silent: it is not the student’s to fix');
});

test('a post the server cannot be reached for waits in the queue, one per player and game, and flushes later', async () => {
  Arcade.store.remove('arcade.board.queue');
  const restoreConfig = withConfig({ url: 'https://example.test/exec', classCode: 'QA' });
  assert.equal(Leaderboard.configured(), true);
  let restoreFetch = withFetch(() => { throw new Error('offline'); });
  assert.equal(await Leaderboard.post({ initials: 'DSB', game: 'sort', level: 1, score: 500, points: 0, title: '' }), null);
  assert.equal(await Leaderboard.post({ initials: 'DSB', game: 'sort', level: 2, score: 700, points: 0, title: '' }), null);
  assert.equal(await Leaderboard.post({ initials: 'DSB', game: 'sort', level: 1, score: 600, points: 0, title: '' }), null, 'lower than the 700 already waiting');
  assert.equal(await Leaderboard.post({ initials: 'ABC', game: 'sort', level: 1, score: 100, points: 0, title: '' }), null);
  assert.deepEqual(Leaderboard.queue().map((e) => e.initials + ':' + e.score), ['DSB:700', 'ABC:100']);
  restoreFetch();
  /** @type {any[]} */
  const sent = [];
  restoreFetch = withFetch((url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, rank: 1, of: 1 }; });
  assert.equal(await Leaderboard.flush(), 2);
  assert.deepEqual(sent.map((e) => e.code + ':' + e.initials + ':' + e.score), ['QA:DSB:700', 'QA:ABC:100']);
  assert.deepEqual(Leaderboard.queue(), []);
  assert.equal(await Leaderboard.flush(), 0, 'an empty queue flushes nothing');
  restoreFetch();
  restoreConfig();
  Arcade.store.remove('arcade.board.queue');
});

test('a flush that hits the wall keeps the rest of the queue for next time', async () => {
  Arcade.store.remove('arcade.board.queue');
  const restoreConfig = withConfig({ url: 'https://example.test/exec', classCode: 'QA' });
  Arcade.store.set('arcade.board.queue', [
    { initials: 'DSB', game: 'sort', level: 1, score: 1 }, { initials: 'DSB', game: 'calc', level: 1, score: 2 }, { initials: 'DSB', game: 'doctor', level: 1, score: 3 }
  ]);
  let calls = 0;
  const restoreFetch = withFetch(() => { calls += 1; if (calls === 2) throw new Error('offline'); return { ok: true, rank: 1, of: 1 }; });
  assert.equal(await Leaderboard.flush(), 1);
  assert.deepEqual(Leaderboard.queue().map((e) => e.game), ['calc', 'doctor']);
  restoreFetch();
  restoreConfig();
  Arcade.store.remove('arcade.board.queue');
});

test('load asks the endpoint with the class code and hands back only a board that says ok', async () => {
  const restoreConfig = withConfig({ url: 'https://example.test/exec', classCode: 'QA' });
  /** @type {string[]} */
  const urls = [];
  let restoreFetch = withFetch((url) => { urls.push(url); return BOARD; });
  const b = await Leaderboard.load();
  assert.equal(b && b.className, 'AP Macro');
  assert.match(urls[0], /^https:\/\/example\.test\/exec\?code=QA&t=\d+$/);
  restoreFetch();
  restoreFetch = withFetch(() => ({ ok: false, error: 'class code' }));
  assert.equal(await Leaderboard.load(), null);
  restoreFetch();
  restoreFetch = withFetch(() => { throw new Error('offline'); });
  assert.equal(await Leaderboard.load(), null);
  restoreFetch();
  restoreConfig();
});

test('the wire posts a new best with the code, and leaves the unset chip alone', async () => {
  Arcade.store.remove('arcade.spec-wire.best');
  Arcade.store.remove('arcade.board.queue');
  const restoreConfig = withConfig({ url: 'https://example.test/exec', classCode: 'QA' });
  /** @type {any[]} */
  const sent = [];
  const restoreFetch = withFetch((url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, rank: 2, of: 5 }; });
  Leaderboard.wire();
  // saveBest fires the hook synchronously; the post is a promise that settles on the microtask queue
  Arcade.saveBest('sort', { score: 700, initials: 'DSB', level: 2 });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].code, 'QA');
  assert.equal(sent[0].game, 'sort');
  assert.equal(sent[0].initials, 'DSB');
  assert.equal(sent[0].score, 700);
  Arcade.store.remove('arcade.sort.best');
  Arcade.saveBest('sort', { score: 800, initials: '???', level: 2 });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sent.length, 1, 'the unset chip never posts');
  Arcade.saveBest('spec-wire', { score: 1, initials: 'DSB' });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sent.length, 1, 'a game the board does not know never posts');
  restoreFetch();
  restoreConfig();
  Arcade.store.remove('arcade.sort.best');
  Arcade.store.remove('arcade.spec-wire.best');
});
