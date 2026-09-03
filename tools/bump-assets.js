#!/usr/bin/env node
// Stamp every shared script and stylesheet reference in the pages with a version query, so a page
// GitHub Pages serves fresh never runs against a shared/arcade.js the browser still holds from before
// the deploy: Pages caches every file for ten minutes, and a reload refreshes the page but not the
// scripts it names. Run after any change under shared/ or to a games/*.model.js, before committing:
//   node tools/bump-assets.js            # stamps today's date, with a letter when today's is taken
//   node tools/bump-assets.js 20260903c  # or a stamp of your own
// shared/arcade.test.js checks that every page carries one and the same stamp.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const PAGES = ['index.html'].concat(fs.readdirSync(path.join(ROOT, 'games')).filter((f) => f.endsWith('.html')).map((f) => 'games/' + f));
const RE = /((?:src|href)=")((?:\.\.\/)?shared\/[a-z-]+\.(?:js|css)|[a-z-]+\.model\.js)(\?v=[A-Za-z0-9.-]+)?(")/g;

function current() {
  const m = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/shared\/arcade\.js\?v=([A-Za-z0-9.-]+)/);
  return m ? m[1] : null;
}
function next() {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const cur = current();
  if (!cur || !cur.startsWith(today)) return today;
  const letter = cur.slice(8);
  return today + (letter ? String.fromCharCode(letter.charCodeAt(0) + 1) : 'b');
}
const stamp = process.argv[2] || next();
let touched = 0;
PAGES.forEach((p) => {
  const file = path.join(ROOT, p);
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(RE, (m, a, name, v, q) => a + name + '?v=' + stamp + q);
  if (after !== before) { fs.writeFileSync(file, after); touched += 1; }
});
console.log('assets stamped ?v=' + stamp + ' on ' + touched + ' of ' + PAGES.length + ' pages');
