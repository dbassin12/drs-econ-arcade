// @ts-check
/* DRS Econ Arcade — the class leaderboard's server: one Google Apps Script web app writing to
   one Google Sheet the teacher owns. Paste this whole file into the Sheet's script editor
   (Extensions → Apps Script), set CLASS_CODE and CLASS_NAME, and deploy it as a web app that
   runs as you and is open to anyone. leaderboard/SETUP.md walks through every click.

   The arcade pages post one line per new personal best — initials, game, level, score, the
   player's title points and title — and read the whole board back. Nothing else ever arrives:
   no names, no readiness data, no device ids. The Sheet is the moderation tool: delete a row
   and it is off the board on the next read.

   Sections: settings · rules · the check · the board · the sheet · the web app.
   Everything below the settings runs under `node --test` with Google's four services stubbed
   (leaderboard/apps-script.test.js), so the logic is proven before it is pasted anywhere. */

/* ===== SETTINGS — the lines a teacher edits ===== */
var CLASS_CODE = 'CHANGE-ME';      // every post carries this; keep it equal to classCode in shared/leaderboard.js
var CLASS_NAME = 'AP Macro';       // the board's title on the hub
var SHEET_NAME = 'board';          // the tab the posts land on; created on the first post
var CACHE_SECONDS = 15;            // how long a read is served from cache while a projector polls
var MAX_ROWS_PER_READ = 5000;      // a read never looks past this many of the newest posts

/* ===== RULES — what a post has to look like to land on the board ===== */
var GAMES = {
  shift: { levels: 7, max: 20000 },
  fed: { levels: [1975, 1980, 2008, 2021], min: 1, max: 5 },     // the Fed posts its AP stamp on an era
  sort: { levels: 4, max: 20000 },
  calc: { levels: 3, max: 20000 },
  doctor: { levels: 3, max: 20000 },
  investor: { levels: 3, max: 100000 },                          // real dollars
  crisis: { levels: 5, max: 100 }
};
var MAX_POINTS = 200;              // title points; every gold with a perfect sprint everywhere is well under this
/* Initials the board will not print. Three letters cannot spell much, and a student's real initials
   should never be here — extend the list if the class finds a gap, never shorten it in a hurry. */
var BLOCKED = ['ASS', 'FUK', 'FUC', 'FUQ', 'FCK', 'KKK', 'NIG', 'NGR', 'NGA', 'CUM', 'FAG', 'DIK', 'DCK', 'COK', 'COC', 'TIT', 'WTF', 'SUX', 'PIS', 'SHT', 'HOE'];
var COLUMNS = ['when', 'initials', 'game', 'level', 'score', 'points', 'title'];

/* ===== THE CHECK — a post is accepted whole or refused with one reason ===== */

/** @param {any} body the parsed post
 *  @returns {{ok:true, entry:{when:string, initials:string, game:string, level:number, score:number, points:number, title:string}}|{ok:false, error:string}} */
function checkEntry(body) {
  var b = body && typeof body === 'object' ? body : {};
  if (CLASS_CODE && String(b.code || '') !== CLASS_CODE) return { ok: false, error: 'class code' };
  var initials = String(b.initials || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(initials) || BLOCKED.indexOf(initials) >= 0) return { ok: false, error: 'initials' };
  var game = String(b.game || '');
  var rule = Object.prototype.hasOwnProperty.call(GAMES, game) ? GAMES[game] : null;
  if (!rule) return { ok: false, error: 'game' };
  var level = Number(b.level);
  if (!isFinite(level) || level !== Math.floor(level)) return { ok: false, error: 'level' };
  if (Array.isArray(rule.levels) ? rule.levels.indexOf(level) < 0 : (level < 1 || level > rule.levels)) return { ok: false, error: 'level' };
  var score = Number(b.score);
  if (!isFinite(score) || score !== Math.floor(score) || score < (rule.min || 0) || score > rule.max) return { ok: false, error: 'score' };
  // Points and the title decorate the overall board; a bad value costs the post nothing but them.
  var points = Number(b.points);
  if (!isFinite(points) || points < 0 || points > MAX_POINTS) points = 0;
  var title = String(b.title || '').replace(/[^A-Za-z ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32);
  return { ok: true, entry: { when: new Date().toISOString(), initials: initials, game: game, level: level, score: score, points: Math.floor(points), title: title } };
}

/* ===== THE BOARD — every player's best per game, and best career points overall ===== */

/** @param {any} v a cell, which the Sheet may have turned into a Date @returns {string} an ISO string */
function whenOf(v) { return v && typeof v.toISOString === 'function' ? v.toISOString() : String(v || ''); }

/** @param {{when:string}} a @param {{when:string}} b @returns {number} earlier first */
function byWhen(a, b) { return a.when < b.when ? -1 : a.when > b.when ? 1 : 0; }

/** Rows arrive in the order they were posted, so a tie goes to whoever got there first.
 *  @param {any[][]} rows in COLUMNS order, header excluded
 *  @returns {{games:Record<string, {initials:string, score:number, level:number, when:string}[]>,
 *             overall:{initials:string, points:number, title:string, when:string}[], players:number}} */
function aggregate(rows) {
  /** @type {Record<string, Record<string, any>>} */ var bestByGame = {};
  /** @type {Record<string, any>} */ var bestOverall = {};
  /** @type {Record<string, boolean>} */ var players = {};
  Object.keys(GAMES).forEach(function (g) { bestByGame[g] = {}; });
  (rows || []).forEach(function (r) {
    if (!r) return;
    var when = whenOf(r[0]), initials = String(r[1] || '').toUpperCase(), game = String(r[2] || '');
    var level = Number(r[3]), score = Number(r[4]), points = Number(r[5]) || 0, title = String(r[6] || '');
    if (!/^[A-Z]{3}$/.test(initials) || !bestByGame[game] || !isFinite(score)) return;
    players[initials] = true;
    var cur = bestByGame[game][initials];
    if (!cur || score > cur.score) bestByGame[game][initials] = { initials: initials, score: score, level: level, when: when };
    var top = bestOverall[initials];
    if (!top || points > top.points) bestOverall[initials] = { initials: initials, points: points, title: title, when: when };
  });
  /** @type {Record<string, any[]>} */ var games = {};
  Object.keys(bestByGame).forEach(function (g) {
    games[g] = Object.keys(bestByGame[g]).map(function (k) { return bestByGame[g][k]; })
      .sort(function (a, b) { return b.score - a.score || byWhen(a, b); });
  });
  var overall = Object.keys(bestOverall).map(function (k) { return bestOverall[k]; })
    .sort(function (a, b) { return b.points - a.points || byWhen(a, b); });
  return { games: games, overall: overall, players: Object.keys(players).length };
}

/** @param {{initials:string}[]} list @param {string} initials @returns {number} 1-based, 0 when absent */
function rankOf(list, initials) {
  for (var i = 0; i < list.length; i += 1) if (list[i].initials === initials) return i + 1;
  return 0;
}

/* ===== THE SHEET ===== */

/** @returns {any} the board tab, created with its header on first use */
function sheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) { sh = ss.insertSheet(SHEET_NAME); sh.appendRow(COLUMNS); }
  return sh;
}

/** @returns {any[][]} every post, oldest first, capped at the newest MAX_ROWS_PER_READ */
function readRows() {
  var sh = sheet();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var from = Math.max(2, last - MAX_ROWS_PER_READ + 1);
  return sh.getRange(from, 1, last - from + 1, COLUMNS.length).getValues();
}

/** The board as the hub reads it, served from cache while a projector polls. @returns {any} */
function boardNow() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('board');
  if (hit) return JSON.parse(hit);
  var agg = aggregate(readRows());
  var out = { ok: true, className: CLASS_NAME, updated: new Date().toISOString(), players: agg.players, games: agg.games, overall: agg.overall };
  try { cache.put('board', JSON.stringify(out), CACHE_SECONDS); } catch (err) { /* past the cache's size: serve it uncached */ }
  return out;
}

/* ===== THE WEB APP — GET reads the board, POST lands one best ===== */

/** @param {any} obj @returns {any} a JSON text output */
function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** @param {any} e the request @returns {any} */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (CLASS_CODE && String(p.code || '') !== CLASS_CODE) return respond({ ok: false, error: 'class code' });
  return respond(boardNow());
}

/** @param {any} e the request; the body is JSON sent as text/plain, which needs no preflight @returns {any} */
function doPost(e) {
  var body;
  try { body = JSON.parse(e && e.postData && e.postData.contents ? e.postData.contents : '{}'); } catch (err) { return respond({ ok: false, error: 'json' }); }
  var check = checkEntry(body);
  if (!check.ok) return respond(check);
  var entry = check.entry;
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (err) { return respond({ ok: false, error: 'busy' }); }
  try {
    sheet().appendRow([entry.when, entry.initials, entry.game, entry.level, entry.score, entry.points, entry.title]);
    CacheService.getScriptCache().remove('board');
    var list = aggregate(readRows()).games[entry.game] || [];
    var rank = rankOf(list, entry.initials);
    return respond({ ok: true, rank: rank, of: list.length, best: rank ? list[rank - 1].score : entry.score });
  } finally {
    lock.releaseLock();
  }
}

if (typeof module !== 'undefined') {
  module.exports = { checkEntry: checkEntry, aggregate: aggregate, rankOf: rankOf, doGet: doGet, doPost: doPost, GAMES: GAMES, BLOCKED: BLOCKED, COLUMNS: COLUMNS };
}
