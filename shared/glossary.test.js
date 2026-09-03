// @ts-check
'use strict';
/* The CED vocabulary in shared/glossary.js: every unit represented, every term unique with a full
   definition, the words the games grade against present. Run: node --test shared/glossary.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const Glossary = require('./glossary.js');

test('the glossary covers all six units with unique terms and full-sentence definitions', () => {
  const all = Glossary.all();
  assert.ok(all.length >= 50, 'at least fifty terms: ' + all.length);
  const units = new Set(all.map((g) => g.unit));
  assert.deepEqual([...units].sort(), [1, 2, 3, 4, 5, 6]);
  const names = new Set();
  all.forEach((g) => {
    assert.ok(!names.has(g.term.toLowerCase()), 'unique: ' + g.term);
    names.add(g.term.toLowerCase());
    assert.ok(g.def.length >= 40 && /[.]$/.test(g.def), g.term + ' has a full definition');
  });
});

test('the terms the games grade against are all here', () => {
  const text = Glossary.all().map((g) => g.term + ' ' + g.def).join(' ').toLowerCase();
  ['aggregate demand', 'short-run aggregate supply', 'long-run aggregate supply', 'price level', 'real gdp', 'nominal interest rate', 'real interest rate',
    'expected inflation', 'natural rate of unemployment', 'current account', 'financial account', 'appreciation', 'depreciation', 'expansionary', 'contractionary',
    'money multiplier', 'crowding out', 'recessionary gap', 'inflationary gap', 'iorb', 'federal funds rate', 'loanable funds', 'phillips curve', 'net exports', 'automatic stabilizers']
    .forEach((t) => assert.ok(text.includes(t), 'glossary mentions ' + t));
});

test('find is case-blind over the term and the definition, and byUnit groups', () => {
  assert.ok(Glossary.find('IORB').some((g) => /Ample reserves/.test(g.term)));
  assert.ok(Glossary.find('crowd').every((g) => /crowd/i.test(g.term + g.def)));
  assert.equal(Glossary.find('').length, Glossary.all().length);
  assert.equal(Glossary.find('zzzz').length, 0);
  const by = Glossary.byUnit();
  assert.deepEqual(Object.keys(by), ['1', '2', '3', '4', '5', '6']);
});
