// MIT. Focused acceptance of immutable first-party source identities; no protocol simulation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compareSourcePins } from '../snapshot-preflight.mjs';
const historic = new URL('../pins.json', import.meta.url);
const current = new URL('../snapshots/20261010-a84c5619.json', import.meta.url);

test('frozen public-main Git source snapshot keeps eight original facade contracts', async () => {
  const [a,b] = await Promise.all([historic,current].map(async u => JSON.parse(await readFile(u,'utf8'))));
  const delta = compareSourcePins(a,b);
  assert.equal(delta.frozenCommit, 'a84c561967056682eef810455227b7db18d1461b');
  assert.equal(delta.sourceCount, 8);
  assert.deepEqual(delta.changes.filter(x=>x.changed).map(x=>x.id),
    ['catalog','mcp_broker','buyer','seller_proof']);
  assert.equal(delta.changedCount, 4);
  assert.ok(delta.changes.every(x=>/^[a-f0-9]{40}$/.test(x.frozenGitBlob)));
});

test('source identity, API or duplicated ID cannot silently inherit earlier approval', async () => {
  const [a,b] = await Promise.all([historic,current].map(async u => JSON.parse(await readFile(u,'utf8'))));
  const altered = structuredClone(b);
  altered.sources[0].exports.push('notApproved');
  assert.throws(()=>compareSourcePins(a,altered),/identity, path, API or SHA/);
  const duplicate = structuredClone(b);
  duplicate.sources[1].id = duplicate.sources[0].id;
  assert.throws(()=>compareSourcePins(a,duplicate),/identity, path, API or SHA/);
});
