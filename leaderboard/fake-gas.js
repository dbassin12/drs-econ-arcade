// @ts-check
'use strict';
/* A stand-in for the four Google services leaderboard/apps-script.js touches — SpreadsheetApp,
   ContentService, LockService, CacheService — so the script runs under Node exactly as written.
   The test suite and the local QA mock server both build their sandbox here. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, 'apps-script.js'), 'utf8');

/** One in-memory tab: `rows` holds the header row first, then every post. @param {any[][]} rows */
function fakeSheet(rows) {
  return {
    rows,
    getLastRow() { return rows.length; },
    appendRow(row) { rows.push(row.slice()); },
    getRange(from, col, numRows, numCols) {
      return { getValues() { return rows.slice(from - 1, from - 1 + numRows).map((r) => r.slice(col - 1, col - 1 + numCols)); } };
    }
  };
}

/** Load the script into a fresh sandbox.
 *  @param {{classCode?:string, tabs?:Record<string, any[][]>, now?:() => number}} [opts]
 *    `tabs` seeds sheets by name (header row included); `classCode` overrides CLASS_CODE.
 *  @returns {{api:any, tabs:Record<string, any>, cache:Map<string, {v:string, exp:number}>, locks:number}} */
function load(opts) {
  const o = opts || {};
  /** @type {Record<string, any>} */
  const tabs = {};
  Object.keys(o.tabs || {}).forEach((name) => { tabs[name] = fakeSheet((o.tabs || {})[name].map((r) => r.slice())); });
  const cache = new Map();
  const now = o.now || Date.now;
  const state = { locks: 0 };
  const sandbox = {
    module: { exports: {} },
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        return {
          getSheetByName(name) { return tabs[name] || null; },
          insertSheet(name) { tabs[name] = fakeSheet([]); return tabs[name]; }
        };
      }
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(s) { return { _s: s, setMimeType() { return this; }, getContent() { return this._s; } }; }
    },
    LockService: { getScriptLock() { return { waitLock() { state.locks += 1; }, releaseLock() { state.locks -= 1; } }; } },
    CacheService: {
      getScriptCache() {
        return {
          get(k) { const hit = cache.get(k); if (!hit) return null; if (hit.exp <= now()) { cache.delete(k); return null; } return hit.v; },
          put(k, v, secs) { cache.set(k, { v, exp: now() + (secs || 600) * 1000 }); },
          remove(k) { cache.delete(k); }
        };
      }
    }
  };
  vm.runInNewContext(SOURCE, sandbox, { filename: 'apps-script.js' });
  if (o.classCode !== undefined) vm.runInContext('CLASS_CODE = ' + JSON.stringify(o.classCode), sandbox);
  return { api: sandbox.module.exports, tabs, cache, get locks() { return state.locks; } };
}

/** @param {any} out a ContentService output @returns {any} its JSON */
function json(out) { return JSON.parse(out.getContent()); }

module.exports = { load, json, fakeSheet };
