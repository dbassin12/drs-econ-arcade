// @ts-check
/* DRS Econ Arcade — the class leaderboard, client half. One small module every page loads after
   shared/arcade.js: it hears each new personal best through Arcade.onBest and posts it to the
   class endpoint, and the hub reads the whole board back through it. With no URL below, every
   call is a harmless no-op and the arcade is exactly as local as it was.
   Sections: settings · the games · posts · the queue · reads · rows · the wire.
   Nothing here touches the DOM except a toast, so the pure half runs under `node --test`. */

/* ===== SETTINGS — the two lines a teacher edits; leaderboard/SETUP.md says how ===== */
const LEADERBOARD_CONFIG = {
  url: '',               // the Apps Script web app URL, ending in /exec. Empty keeps the board off
  classCode: '',         // must equal CLASS_CODE in leaderboard/apps-script.js
  refreshSeconds: 30     // how often the hub re-reads the board in Arcade Night (big-type) mode
};

var Leaderboard = (function () {
  'use strict';
  var A = typeof Arcade !== 'undefined' ? Arcade : (typeof require === 'function' ? require('./arcade.js') : null);
  var CONFIG = LEADERBOARD_CONFIG;
  var QUEUE_KEY = 'arcade.board.queue';
  var QUEUE_MAX = 20;

  /* ===== THE GAMES — what a game's row says on a board ===== */

  /** @param {number} n @returns {string} 1450 -> "1,450" */
  function commas(n) { return Number(n).toLocaleString('en-US'); }

  /** name, the short tab label, the word before the level, and how the score reads. */
  var GAMES = {
    shift: { name: 'Shift Happens', short: 'Shift', level: 'L', value: function (r) { return commas(r.score); } },
    fed: { name: 'Fed Chair', short: 'Fed', level: '', value: function (r) { return 'Stamp ' + r.score; } },
    sort: { name: 'Sort Circuit', short: 'Sort', level: 'Deck ', value: function (r) { return commas(r.score); } },
    calc: { name: 'Calc Blitz', short: 'Calc', level: 'Ladder ', value: function (r) { return commas(r.score); } },
    doctor: { name: 'Graph Doctor', short: 'Doctor', level: 'Ward ', value: function (r) { return commas(r.score); } },
    investor: { name: 'The Investor', short: 'Investor', level: 'Run ', value: function (r) { return 'Real $' + commas(r.score); } },
    crisis: { name: 'Crisis Country', short: 'Crisis', level: 'Crisis ', value: function (r) { return r.score + ' pts'; } }
  };
  var GAME_IDS = Object.keys(GAMES);

  /** @returns {boolean} whether a class endpoint has been set */
  function configured() { return !!(CONFIG && typeof CONFIG.url === 'string' && /^https?:\/\//.test(CONFIG.url)); }

  /** @returns {{url:string, classCode:string, refreshSeconds:number}} a copy of the settings */
  function config() {
    var secs = Number(CONFIG && CONFIG.refreshSeconds);
    return { url: String(CONFIG && CONFIG.url || ''), classCode: String(CONFIG && CONFIG.classCode || ''), refreshSeconds: secs > 0 ? secs : 30 };
  }

  /** Point this device at a class endpoint at run time: the test suite and the QA harness use it,
   *  and so can a teacher trying a deployment from the console before committing it. It changes
   *  nothing but where this one device posts and reads.
   *  @param {{url?:string, classCode?:string, refreshSeconds?:number}} patch @returns {{url:string, classCode:string, refreshSeconds:number}} */
  function configure(patch) {
    var p = patch && typeof patch === 'object' ? patch : {};
    if (typeof p.url === 'string') CONFIG.url = p.url;
    if (typeof p.classCode === 'string') CONFIG.classCode = p.classCode;
    if (Number(p.refreshSeconds) > 0) CONFIG.refreshSeconds = Number(p.refreshSeconds);
    return config();
  }

  /** @param {*} s @returns {boolean} three letters, no ? left over from an unset chip */
  function validInitials(s) { return /^[A-Z]{3}$/.test(String(s || '')); }

  /** What one best becomes on the wire: the record plus the career it sits in.
   *  @param {string} game @param {{score:number, initials:string, level?:number}} rec @returns {any} */
  function entryFor(game, rec) {
    var c = A ? A.career() : { points: 0, name: '' };
    return { initials: rec.initials, game: game, level: rec.level === undefined || rec.level === null ? 1 : rec.level, score: rec.score, points: c.points, title: c.name };
  }

  /* ===== POSTS — one fetch, sent as text/plain so the browser never preflights it ===== */

  /** @param {any} entry @returns {Promise<any|null>} the server's answer, or null when it could not be reached */
  function send(entry) {
    if (!configured() || typeof fetch !== 'function') return Promise.resolve(null);
    var body = JSON.stringify(Object.assign({ code: config().classCode }, entry));
    try {
      return fetch(config().url, { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', credentials: 'omit' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (res) { return res && typeof res === 'object' ? res : null; })
        .catch(function () { return null; });
    } catch (err) { return Promise.resolve(null); }
  }

  /** Post a best; one the server cannot be reached for waits in the queue for the next visit.
   *  @param {any} entry @returns {Promise<any|null>} the answer, or null when it was queued */
  function post(entry) {
    return send(entry).then(function (res) {
      if (res === null) enqueue(entry);
      return res;
    });
  }

  /* ===== THE QUEUE — bests made offline, posted on the next visit to any page ===== */

  /** @returns {any[]} */
  function readQueue() {
    var q = A ? A.store.get(QUEUE_KEY, []) : [];
    return Array.isArray(q) ? q.filter(function (e) { return e && typeof e === 'object' && GAMES[e.game]; }) : [];
  }
  /** @param {any[]} list */
  function writeQueue(list) {
    if (!A) return;
    if (list.length) A.store.set(QUEUE_KEY, list.slice(-QUEUE_MAX));
    else A.store.remove(QUEUE_KEY);
  }
  /** Keep one entry per player and game: the highest score waiting. @param {any} entry */
  function enqueue(entry) {
    var q = readQueue().filter(function (e) { return !(e.game === entry.game && e.initials === entry.initials && Number(e.score) <= Number(entry.score)); });
    if (q.some(function (e) { return e.game === entry.game && e.initials === entry.initials; })) return;   // a higher one is already waiting
    q.push(entry);
    writeQueue(q);
  }
  /** Retry every queued post in order, stopping at the first the server still cannot be reached for.
   *  @returns {Promise<number>} how many landed */
  function flush() {
    var q = readQueue();
    if (!q.length || !configured()) return Promise.resolve(0);
    writeQueue([]);
    var landed = 0, i = 0;
    function next() {
      if (i >= q.length) return Promise.resolve(landed);
      var entry = q[i];
      i += 1;
      return send(entry).then(function (res) {
        if (res === null) { writeQueue(q.slice(i - 1).concat(readQueue())); return landed; }
        if (res.ok) landed += 1;
        return next();
      });
    }
    return next();
  }

  /* ===== READS ===== */

  /** @returns {Promise<any|null>} the board, or null when it could not be read */
  function load() {
    if (!configured() || typeof fetch !== 'function') return Promise.resolve(null);
    var c = config();
    var url = c.url + (c.url.indexOf('?') >= 0 ? '&' : '?') + 'code=' + encodeURIComponent(c.classCode) + '&t=' + Date.now();
    try {
      return fetch(url, { method: 'GET', redirect: 'follow', credentials: 'omit', cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (b) { return b && b.ok === true ? b : null; })
        .catch(function () { return null; });
    } catch (err) { return Promise.resolve(null); }
  }

  /* ===== ROWS — a board, or this device's bests, as lines the hub can paint ===== */

  /** @param {string} game @param {{score:number, level?:number}} row @returns {{value:string, sub:string}} */
  function describe(game, row) {
    var g = GAMES[game];
    if (!g) return { value: String(row.score), sub: '' };
    return { value: g.value(row), sub: row.level === undefined || row.level === null ? '' : g.level + row.level };
  }

  /** The rows of one tab of a board, ranked as the server ranked them.
   *  @param {any} board @param {string} tab 'overall' or a game id
   *  @returns {{initials:string, value:string, sub:string, when:string}[]} */
  function rows(board, tab) {
    if (!board || typeof board !== 'object') return [];
    if (tab === 'overall') {
      return (Array.isArray(board.overall) ? board.overall : []).map(function (r) {
        return { initials: String(r.initials || ''), value: (Number(r.points) || 0) + ' pts', sub: String(r.title || ''), when: String(r.when || '') };
      });
    }
    var list = board.games && Array.isArray(board.games[tab]) ? board.games[tab] : [];
    return list.map(function (r) {
      var d = describe(tab, r);
      return { initials: String(r.initials || ''), value: d.value, sub: d.sub, when: String(r.when || '') };
    });
  }

  /** The top of a list plus the player's own row wherever it sits, each with its rank.
   *  @param {{initials:string, value:string, sub:string}[]} list @param {string} initials @param {number} [limit] default 10
   *  @returns {{rank:number, initials:string, value:string, sub:string, you:boolean}[]} */
  function withYou(list, initials, limit) {
    var n = limit === undefined ? 10 : limit;
    var out = [];
    (list || []).forEach(function (r, i) {
      var you = r.initials === initials;
      if (i < n || you) out.push({ rank: i + 1, initials: r.initials, value: r.value, sub: r.sub, you: you });
    });
    return out;
  }

  /** This device's bests, newest first — the board when there is no class to read.
   *  @returns {{initials:string, value:string, sub:string, when:string, game:string}[]} */
  function deviceRows() {
    if (!A) return [];
    var out = [];
    GAME_IDS.forEach(function (id) {
      var b = A.bests(id);
      if (!b) return;
      var d = describe(id, b);
      out.push({ initials: b.initials, value: d.value, sub: GAMES[id].name + (d.sub ? ' · ' + d.sub : ''), when: String(b.date || ''), game: id });
    });
    out.sort(function (a, b) { return (Date.parse(b.when) || 0) - (Date.parse(a.when) || 0); });
    return out;
  }

  /* ===== THE WIRE — every new best posts itself, and says where it landed ===== */

  var wired = false;
  var toldToSetInitials = false;

  /** @param {string} game @param {any} res what the server said @returns {string|null} the toast, if any */
  function verdict(game, res) {
    var name = GAMES[game] ? GAMES[game].name : game;
    if (res === null) return 'Saved here — it posts to the class board when you are back online';
    if (res.ok) return res.of <= 1 ? '🏆 First on the class board · ' + name : '🏆 #' + res.rank + ' of ' + res.of + ' · ' + name;
    if (res.error === 'initials') return 'The class board will not print those initials — pick three others';
    if (res.error === 'class code') return 'The class code has changed — ask your teacher';
    return null;
  }

  function wire() {
    if (wired || !A) return;
    wired = true;
    A.onBest(function (game, rec) {
      if (!configured() || !GAMES[game]) return;
      if (!validInitials(rec.initials)) {
        if (!toldToSetInitials) { toldToSetInitials = true; A.toast('Set your initials (the ??? button) to post to the class board', 2600); }
        return;
      }
      post(entryFor(game, rec)).then(function (res) {
        var line = verdict(game, res);
        if (line) A.toast(line, 2600);
      });
    });
  }

  if (typeof document !== 'undefined') wire();

  return {
    GAMES: GAMES, GAME_IDS: GAME_IDS, configured: configured, config: config, configure: configure, validInitials: validInitials,
    entryFor: entryFor, post: post, send: send, flush: flush, queue: readQueue, load: load,
    describe: describe, rows: rows, withYou: withYou, deviceRows: deviceRows, verdict: verdict, wire: wire
  };
}());

if (typeof module !== 'undefined') module.exports = Leaderboard;
