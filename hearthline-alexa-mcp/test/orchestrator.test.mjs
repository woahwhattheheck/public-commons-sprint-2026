import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../src/store.mjs';
import { HearthlineOrchestrator } from '../src/orchestrator.mjs';

async function fixture(alerts = []) {
  const dir = await mkdtemp(join(tmpdir(), 'hearthline-test-'));
  const store = new JsonStore(join(dir, 'state.json')); await store.load();
  const orchestrator = new HearthlineOrchestrator({ store, alertProvider: async () => alerts, clock: () => Date.parse('2026-09-13T10:00:00Z') });
  return { store, orchestrator };
}

test('storm mission persists across orchestrator instances and gates external actions', async () => {
  const { store, orchestrator } = await fixture([{ id: 'a1', event: 'Flood Warning', severity: 'Severe', urgency: 'Immediate', headline: 'Flood warning', onset: null, expires: null, instruction: null }]);
  await orchestrator.seedInventory({ flashlight: 1, water: 1, battery_pack: 0, first_aid_kit: 1 });
  const mission = await orchestrator.prepareStormMission({ latitude: 38.2, longitude: -85.7, household: { people: 2, pets: 1 } });
  assert.equal(mission.alertsSummary.highestSeverity, 'Severe'); assert.equal(mission.status, 'awaiting_approval'); assert.ok(mission.actions.some(a => a.kind === 'shopping_proposal'));
  const pending = mission.actions.find(a => a.kind === 'household_reminder');
  await assert.rejects(() => orchestrator.executeApproved({ missionId: mission.id, actionId: pending.id, idempotencyKey: 'demo-key-0001' }), /approved/);
  await orchestrator.approveAction({ missionId: mission.id, actionId: pending.id, planHash: mission.planHash });
  const first = await orchestrator.executeApproved({ missionId: mission.id, actionId: pending.id, idempotencyKey: 'demo-key-0001' });
  const replay = await orchestrator.executeApproved({ missionId: mission.id, actionId: pending.id, idempotencyKey: 'demo-key-0001' });
  assert.equal(first.replayed, false); assert.equal(replay.replayed, true); assert.equal(first.receipt.id, replay.receipt.id);
  const second = new HearthlineOrchestrator({ store, alertProvider: async () => [] }); assert.equal((await second.getMission(mission.id)).id, mission.id); assert.equal(store.snapshot().outbox.length, 1);
});

test('plan hash prevents stale approval after caller supplies wrong generation', async () => {
  const { orchestrator } = await fixture(); const mission = await orchestrator.prepareStormMission({ latitude: 40, longitude: -80 }); const action = mission.actions.find(a => a.status === 'awaiting_approval');
  await assert.rejects(() => orchestrator.approveAction({ missionId: mission.id, actionId: action.id, planHash: '0'.repeat(64) }), /plan hash mismatch/);
});

test('shopping execution prepares a handoff but never claims a purchase', async () => {
  const { orchestrator } = await fixture(); const mission = await orchestrator.prepareStormMission({ latitude: 40, longitude: -80 }); const action = mission.actions.find(a => a.kind === 'shopping_proposal');
  await orchestrator.approveAction({ missionId: mission.id, actionId: action.id, planHash: mission.planHash });
  const result = await orchestrator.executeApproved({ missionId: mission.id, actionId: action.id, idempotencyKey: 'shop-key-0001' });
  assert.equal(result.receipt.semantics, 'prepared_not_purchased'); assert.equal(result.mission.actions.find(x => x.id === action.id).output.status, 'prepared_not_purchased');
});

test('approving one action rotates the plan hash so a second approval must re-read state', async () => {
  const { orchestrator } = await fixture(); const mission = await orchestrator.prepareStormMission({ latitude: 40, longitude: -80 }); const pending = mission.actions.filter(a => a.status === 'awaiting_approval'); assert.ok(pending.length >= 2);
  const first = await orchestrator.approveAction({ missionId: mission.id, actionId: pending[0].id, planHash: mission.planHash }); assert.notEqual(first.mission.planHash, mission.planHash);
  await assert.rejects(() => orchestrator.approveAction({ missionId: mission.id, actionId: pending[1].id, planHash: mission.planHash }), /plan hash mismatch/);
});
