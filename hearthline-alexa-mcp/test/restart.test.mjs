import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../src/store.mjs';
import { HearthlineOrchestrator } from '../src/orchestrator.mjs';

test('mission planning loads persisted inventory before computing supply gaps', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hearthline-restart-'));
  const path = join(dir, 'state.json');

  const firstStore = new JsonStore(path);
  const first = new HearthlineOrchestrator({
    store: firstStore,
    alertProvider: async () => [],
    clock: () => Date.parse('2026-09-13T10:00:00Z'),
  });
  await first.seedInventory({
    flashlight: 1,
    water: 3,
    battery_pack: 1,
    first_aid_kit: 1,
  });

  const restartedStore = new JsonStore(path);
  const restarted = new HearthlineOrchestrator({
    store: restartedStore,
    alertProvider: async () => [],
    clock: () => Date.parse('2026-09-13T10:01:00Z'),
  });
  const mission = await restarted.prepareStormMission({ latitude: 38.2, longitude: -85.7 });

  const inventoryReview = mission.actions.find((action) => action.kind === 'inventory_review');
  assert.deepEqual(inventoryReview.result.missing, []);
  assert.equal(mission.actions.some((action) => action.kind === 'shopping_proposal'), false);
});
