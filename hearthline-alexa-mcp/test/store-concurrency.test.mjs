import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../src/store.mjs';

async function withStore(t) {
  const dir = await mkdtemp(join(tmpdir(), 'hearthline-serial-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.json');
  return { path, store: new JsonStore(path) };
}

test('a failed overlapping mutation cannot erase a successful sibling or persist its uncommitted changes', async (t) => {
  const { path, store } = await withStore(t);
  await store.load();
  let release, signalEntered;
  const entered = new Promise((resolve) => { signalEntered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });

  const rejected = store.mutate(async (draft) => {
    draft.inventory.flashlight = 99;
    signalEntered();
    await gate;
    throw new Error('simulated failed inventory update');
  });
  await entered;
  const successful = store.mutate((draft) => {
    draft.inventory.water = 3;
    return draft.inventory.water;
  });
  // Give a concurrent caller time to enter the old implementation's callback.
  await new Promise((resolve) => setImmediate(resolve));
  release();

  await assert.rejects(rejected, /simulated failed inventory update/);
  assert.equal(await successful, 3);
  assert.deepEqual(store.snapshot().inventory, { water: 3 });
  const disk = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(disk.inventory, { water: 3 });

  const restarted = new JsonStore(path);
  await restarted.load();
  assert.deepEqual(restarted.snapshot().inventory, { water: 3 });
});

test('concurrent cold loads and first mutation use the same initialized durable state', async (t) => {
  const { path, store } = await withStore(t);
  await Promise.all([
    store.load(),
    store.load(),
    store.mutate((draft) => { draft.inventory.battery_pack = 1; return null; }),
  ]);
  const restarted = new JsonStore(path);
  await restarted.load();
  assert.deepEqual(restarted.snapshot().inventory, { battery_pack: 1 });
});
