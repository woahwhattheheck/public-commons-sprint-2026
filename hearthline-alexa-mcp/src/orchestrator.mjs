import { createHash, randomUUID } from 'node:crypto';
import {
  actionIntentDigest,
  assertOperationId,
  createApprovalRecord,
  createExecutionReceipt,
  ensureAuthorityState,
  verifyApprovalRecord,
  verifyExecutionReceipt,
} from './authority.mjs';

const SUPPLY_BASELINE = [['flashlight', 1], ['water', 3], ['battery_pack', 1], ['first_aid_kit', 1]];
function nowIso(clock) { return new Date(clock()).toISOString(); }
function stableHash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function refreshPlanHash(mission) { const { planHash: _ignored, ...rest } = mission; mission.planHash = stableHash(rest); return mission.planHash; }

export class HearthlineOrchestrator {
  constructor({ store, alertProvider, clock = () => Date.now() }) { this.store = store; this.alertProvider = alertProvider; this.clock = clock; }
  async seedInventory(items) {
    if (!items || typeof items !== 'object' || Array.isArray(items)) throw new Error('items must be an object');
    return this.store.mutate((state) => { for (const [name, qty] of Object.entries(items)) { if (!/^[a-z0-9_-]{1,64}$/i.test(name)) throw new Error(`invalid inventory key: ${name}`); if (!Number.isInteger(qty) || qty < 0 || qty > 10000) throw new Error(`invalid quantity for ${name}`); state.inventory[name] = qty; } return { inventory: state.inventory }; });
  }
  async prepareStormMission({ title = 'Storm readiness', latitude, longitude, household = {} }) {
    const alerts = await this.alertProvider({ latitude, longitude });
    await this.store.load();
    const state = this.store.snapshot();
    const missing = SUPPLY_BASELINE.flatMap(([item, minimum]) => { const have = Number(state.inventory[item] ?? 0); return have < minimum ? [{ item, have, minimum, need: minimum - have }] : []; });
    const missionId = `mission_${randomUUID()}`; const createdAt = nowIso(this.clock); const severityRank = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };
    const highestSeverity = alerts.reduce((best, a) => (severityRank[a.severity] ?? 0) > (severityRank[best] ?? 0) ? a.severity : best, 'Unknown');
    const actions = [{ id: `action_${randomUUID()}`, kind: 'inventory_review', risk: 'read_only', status: 'complete', summary: missing.length ? `${missing.length} preparedness supply gaps found` : 'Preparedness baseline stocked', result: { missing } }];
    if (alerts.length) actions.push({ id: `action_${randomUUID()}`, kind: 'weather_review', risk: 'read_only', status: 'complete', summary: `${alerts.length} active NWS alert(s); highest severity ${highestSeverity}`, result: { alerts } });
    if (missing.length) actions.push({ id: `action_${randomUUID()}`, kind: 'shopping_proposal', risk: 'external_commit', status: 'awaiting_approval', summary: `Propose adding ${missing.reduce((n, x) => n + x.need, 0)} supply unit(s) to a shopping handoff`, payload: { items: missing.map(({ item, need }) => ({ item, quantity: need })) } });
    actions.push({ id: `action_${randomUUID()}`, kind: 'household_reminder', risk: 'external_commit', status: 'awaiting_approval', summary: alerts.length ? `Draft household reminder for ${highestSeverity.toLowerCase()} weather conditions` : 'Draft routine preparedness check-in', payload: { audience: 'household', message: alerts.length ? `Preparedness check: ${alerts[0].headline}. Review supplies and your local official guidance.` : 'Preparedness check: no active NWS alerts were found; verify supplies and household contacts.' } });
    const mission = { id: missionId, type: 'storm_readiness', title: String(title).slice(0, 120), status: actions.some((a) => a.status === 'awaiting_approval') ? 'awaiting_approval' : 'ready', createdAt, updatedAt: createdAt, location: { latitude, longitude }, household: sanitizeHousehold(household), alertsSummary: { count: alerts.length, highestSeverity }, actions };
    refreshPlanHash(mission);
    return this.store.mutate((draft) => { draft.missions[missionId] = mission; ensureAuthorityState(draft); return mission; });
  }
  async getMission(id) {
    await this.store.load();
    const state = this.store.snapshot(); const mission = state.missions[id]; if (!mission) throw new Error('mission not found');
    validateMissionAuthority(state, mission);
    return mission;
  }
  async listMissions() {
    await this.store.load(); const state = this.store.snapshot(); ensureAuthorityState(state);
    for (const mission of Object.values(state.missions)) validateMissionAuthority(state, mission);
    return Object.values(state.missions).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async getOperation(operationId) {
    assertOperationId(operationId);
    await this.store.load(); const state = this.store.snapshot(); const authority = ensureAuthorityState(state); const operation = authority.operations[operationId];
    if (!operation) throw new Error('operation not found');
    const mission = state.missions[operation.approval.missionId]; const action = mission?.actions.find((candidate) => candidate.id === operation.approval.actionId);
    if (!mission || !action) throw new Error('authority operation target missing');
    verifyApprovalRecord(operation.approval, { missionId: mission.id, action, operationId });
    if (operation.status === 'complete') {
      const receipt = authority.receipts.find((candidate) => candidate.receiptDigest === operation.receiptDigest); if (!receipt) throw new Error('authority execution receipt missing');
      verifyExecutionReceipt(receipt, { approval: operation.approval, output: action.output });
    }
    return operation;
  }
  async approveAction({ missionId, actionId, planHash, operationId }) {
    const requestedOperationId = operationId ?? `legacy:${stableHash({ missionId, actionId, planHash }).slice(0, 48)}`;
    assertOperationId(requestedOperationId);
    return this.store.mutate((state) => {
      const operationId = requestedOperationId; const authority = ensureAuthorityState(state); const mission = state.missions[missionId]; if (!mission) throw new Error('mission not found'); const action = mission.actions.find((x) => x.id === actionId); if (!action) throw new Error('action not found');
      if (action.risk !== 'external_commit') throw new Error('action does not require approval');
      const prior = authority.operations[operationId];
      if (prior) {
        verifyApprovalRecord(prior.approval, { missionId, action, operationId });
        if (prior.approval.approvedPlanHash !== planHash || prior.approval.actionId !== actionId) throw new Error('operationId already bound to different approval material');
        if (action.operationId !== operationId || action.approvalDigest !== prior.approval.approvalDigest) throw new Error('mission approval binding mismatch');
        return { mission, action, approval: prior.approval, replayed: true, alreadyComplete: prior.status === 'complete' };
      }
      if (planHash !== mission.planHash) throw new Error('plan hash mismatch; re-read mission before approving');
      if (action.status !== 'awaiting_approval') throw new Error(`action cannot be approved from status ${action.status}`);
      const approvedAt = nowIso(this.clock); const approval = createApprovalRecord({ missionId, action, operationId, approvedPlanHash: planHash, approvedAt });
      authority.operations[operationId] = { status: 'approved', approval, receiptDigest: null };
      action.status = 'approved'; action.approvedAt = approvedAt; action.operationId = operationId; action.approvalDigest = approval.approvalDigest; mission.updatedAt = approvedAt; refreshPlanHash(mission);
      return { mission, action, approval, replayed: false, alreadyComplete: false };
    });
  }
  async executeApproved({ missionId, actionId, operationId, idempotencyKey }) {
    if (operationId !== undefined) assertOperationId(operationId);
    if (idempotencyKey !== undefined && !/^[A-Za-z0-9._:-]{8,128}$/.test(String(idempotencyKey))) throw new Error('idempotencyKey must be 8-128 safe characters');
    if (operationId === undefined && idempotencyKey === undefined) throw new Error('operationId required');
    return this.store.mutate((state) => {
      const authority = ensureAuthorityState(state); const mission = state.missions[missionId]; if (!mission) throw new Error('mission not found'); const action = mission.actions.find((x) => x.id === actionId); if (!action) throw new Error('action not found');
      const effectiveOperationId = operationId ?? action.operationId; if (!effectiveOperationId) throw new Error('operation must be explicitly approved before execution'); assertOperationId(effectiveOperationId);
      const operation = authority.operations[effectiveOperationId]; if (!operation) throw new Error('operation must be explicitly approved before execution');
      verifyApprovalRecord(operation.approval, { missionId, action, operationId: effectiveOperationId });
      if (operation.approval.actionId !== actionId || action.operationId !== effectiveOperationId || action.approvalDigest !== operation.approval.approvalDigest) throw new Error('execution does not match approved operation');
      if (idempotencyKey !== undefined) {
        const collision = Object.entries(authority.operations).find(([candidateId, candidate]) => candidateId !== effectiveOperationId && candidate.legacyIdempotencyKey === idempotencyKey);
        if (collision) throw new Error('idempotency key already used for another action');
        if (operation.legacyIdempotencyKey !== undefined && operation.legacyIdempotencyKey !== idempotencyKey) throw new Error('idempotency key does not match approved operation');
        if (operation.legacyIdempotencyKey === undefined) operation.legacyIdempotencyKey = idempotencyKey;
      }
      if (operation.status === 'complete') {
        const receipt = authority.receipts.find((item) => item.receiptDigest === operation.receiptDigest); if (!receipt) throw new Error('authority execution receipt missing');
        verifyExecutionReceipt(receipt, { approval: operation.approval, output: action.output });
        return { receipt, approval: operation.approval, replayed: true, mission };
      }
      if (action.status !== 'approved') throw new Error('action must be explicitly approved before execution');
      if (operation.status !== 'approved') throw new Error(`operation cannot execute from status ${operation.status}`);
      const currentDigest = actionIntentDigest({ missionId, action }); if (currentDigest !== operation.approval.actionDigest) throw new Error('approved action payload changed');
      const executedAt = nowIso(this.clock); let output;
      if (action.kind === 'shopping_proposal') output = { type: 'shopping_handoff', status: 'prepared_not_purchased', items: action.payload.items, note: 'No purchase was placed; this is a handoff artifact for an authorized shopping provider.' };
      else if (action.kind === 'household_reminder') { const outboxItem = { id: `outbox_${randomUUID()}`, createdAt: executedAt, ...action.payload, delivery: 'local_demo_outbox' }; state.outbox.push(outboxItem); output = outboxItem; }
      else throw new Error(`unsupported executable action kind: ${action.kind}`);
      action.status = 'complete'; action.executedAt = executedAt; action.output = output; mission.updatedAt = executedAt; mission.status = mission.actions.some((x) => x.status === 'awaiting_approval' || x.status === 'approved') ? 'awaiting_approval' : 'complete'; refreshPlanHash(mission);
      const receipt = createExecutionReceipt({ approval: operation.approval, executedAt, output, semantics: action.kind === 'shopping_proposal' ? 'prepared_not_purchased' : 'local_demo_delivery', previousReceiptDigest: authority.receiptHead, receiptId: `receipt_${randomUUID()}` });
      authority.receipts.push(receipt); authority.receiptHead = receipt.receiptDigest; operation.status = 'complete'; operation.receiptDigest = receipt.receiptDigest;
      state.receipts.push(receipt);
      return { receipt, approval: operation.approval, replayed: false, mission };
    });
  }
}

function validateMissionAuthority(state, mission) {
  const authority = ensureAuthorityState(state);
  for (const action of mission.actions) {
    if (!action.operationId && !action.approvalDigest) continue;
    if (!action.operationId || !action.approvalDigest) throw new Error('partial mission approval binding');
    const operation = authority.operations[action.operationId]; if (!operation) throw new Error('mission approval operation missing');
    verifyApprovalRecord(operation.approval, { missionId: mission.id, action, operationId: action.operationId });
    if (operation.approval.approvalDigest !== action.approvalDigest) throw new Error('mission approval digest mismatch');
    if (operation.status === 'complete') {
      const receipt = authority.receipts.find((candidate) => candidate.receiptDigest === operation.receiptDigest); if (!receipt) throw new Error('mission execution receipt missing');
      verifyExecutionReceipt(receipt, { approval: operation.approval, output: action.output });
    }
  }
}

function sanitizeHousehold(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) return {}; const result = {}; if (Number.isInteger(value.people) && value.people >= 1 && value.people <= 30) result.people = value.people; if (Number.isInteger(value.pets) && value.pets >= 0 && value.pets <= 30) result.pets = value.pets; if (typeof value.notes === 'string') result.notes = value.notes.slice(0, 500); return result; }
