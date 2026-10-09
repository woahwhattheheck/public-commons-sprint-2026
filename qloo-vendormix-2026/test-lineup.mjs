// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryKey, parseCategoryCap, rankLineup } from './lineup.mjs';

const rows = [
  { id: '1', name: 'Coffee One', category: 'Coffee', signal: .95, ordinal: 1, evidence: 'synthetic' },
  { id: '2', name: 'Coffee Two', category: '  COFFEE  ', signal: .92, ordinal: 2, evidence: 'synthetic' },
  { id: '3', name: 'Music One', category: 'Music', signal: .80, ordinal: 3, evidence: 'synthetic' },
  { id: '4', name: 'Art One', category: 'Arts', signal: .75, ordinal: 4, evidence: 'synthetic' },
  { id: '5', name: 'Mystery One', category: 'Unclassified', signal: .70, ordinal: 5, evidence: 'synthetic' },
  { id: '6', name: 'Mystery Two', category: 'UNCLASSIFIED', signal: .69, ordinal: 6, evidence: 'synthetic' },
];
function req(categoryCap, overrides={}) { return { exclusions: [], slots: 5, mode: 'balanced', categoryCap, ...overrides }; }

test('strict explicit cap and backward compatible absent cap', () => {
  assert.equal(parseCategoryCap(undefined, 5), null);
  assert.equal(parseCategoryCap(1, 5), 1);
  assert.equal(parseCategoryCap(5, 5), 5);
  for (const invalid of [null, '2', 0, 6, 2.5, NaN, Infinity, true]) {
    assert.throws(() => parseCategoryCap(invalid, 5), /Category cap/);
  }
});

test('category keys normalize case, width, and surrounding whitespace', () => {
  assert.equal(categoryKey(' ＣＯＦＦＥＥ  '), categoryKey('coffee'));
  assert.equal(categoryKey('  Unclassified '), 'unclassified');
});

test('hard cap includes repeated case-variant and unclassified labels, never invents slots', () => {
  const p=rankLineup(rows,req(1));
  assert.equal(p.selected.length,4);
  assert.equal(p.summary.filled,4);
  assert.equal(p.summary.observedCategories,3);
  assert.ok(p.summary.shortfallNote);
  assert.equal(new Set(p.selected.map(x=>categoryKey(x.category))).size,4);
  assert.ok(!p.selected.some(x=>x.id==='2'));
  assert.ok(!p.selected.some(x=>x.id==='6'));
});

test('omitted cap remains soft variety while excluding exact names', () => {
  const p=rankLineup(rows,req(null));
  assert.equal(p.selected.length,5);
  assert.equal(p.summary.categoryCap,null);
  assert.equal(p.summary.shortfallNote,null);
  const q=rankLineup(rows,req(1,{exclusions:['coffee one']}));
  assert.ok(!q.selected.some(x=>x.name==='Coffee One'));
  assert.ok(q.selected.some(x=>x.name==='Coffee Two'));
  assert.equal(q.selected.length,4);
});

test('same-key diversity cannot bypass per-category cap; deterministic plans', () => {
  const a=rankLineup(rows,req(2,{slots:3,mode:'discovery'}));
  const b=rankLineup(rows,req(2,{slots:3,mode:'discovery'}));
  assert.deepEqual(a,b);
  const counts=new Map();
  for(const c of a.selected) counts.set(categoryKey(c.category),(counts.get(categoryKey(c.category))||0)+1);
  assert.ok([...counts.values()].every(n=>n<=2));
});
