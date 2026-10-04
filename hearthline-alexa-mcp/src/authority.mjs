import { createHash } from 'node:crypto';

export const AUTHORITY_VERSION = 1;
export const AUTHORITY_CEILING = deepFreeze({
  local_state_mutation: true,
  network_call: false,
  purchase: false,
  payment: false,
  message_delivery: false,
  booking: false,
  contract: false,
  account_mutation: false,
  provider_mutation: false,
});

const OPERATION_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const HEX64 = /^[a-f0-9]{64}$/;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalize(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new Error('authority material contains non-canonical number');
    return value;
  }
  if (typeof value !== 'object') throw new Error('authority material must be canonical JSON data');
  if (seen.has(value)) throw new Error('authority material must be acyclic');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error('authority arrays must use the built-in Array prototype');
      if (Object.getOwnPropertySymbols(value).length) throw new Error('authority arrays must not contain symbols');
      const ownNames = Object.getOwnPropertyNames(value);
      if (ownNames.length !== value.length + 1 || !ownNames.includes('length')) throw new Error('authority arrays must not have hidden or custom properties');
      const out = [];
      for (let i = 0; i < value.length; i += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor) throw new Error('authority arrays must not be sparse');
        if (!('value' in descriptor) || !descriptor.enumerable) throw new Error('authority arrays must contain enumerable data elements only');
        if (descriptor.value === undefined) throw new Error('authority arrays must not contain undefined');
        out.push(normalize(descriptor.value, seen));
      }
      return out;
    }
    if (!isPlainObject(value)) throw new Error('authority objects must be plain records');
    const keys = Object.keys(value).sort();
    const ownNames = Object.getOwnPropertyNames(value).sort();
    if (ownNames.length !== keys.length || ownNames.some((key, index) => key !== keys[index])) throw new Error('authority objects must not contain hidden properties');
    if (Object.getOwnPropertySymbols(value).length) throw new Error('authority objects must not contain symbols');
    const out = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new Error('authority objects must contain enumerable data properties only');
      if (descriptor.value === undefined) throw new Error('authority objects must not contain undefined');
      out[key] = normalize(descriptor.value, seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

export function digest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function assertOperationId(value) {
  if (typeof value !== 'string' || !OPERATION_ID.test(value)) throw new Error('operationId must be 8-128 safe characters');
  if (Object.prototype.hasOwnProperty.call(Object.prototype, value)) throw new Error('operationId is reserved');
  return value;
}

export function actionIntent({ missionId, action }) {
  if (typeof missionId !== 'string' || !missionId) throw new Error('missionId required');
  if (!action || typeof action !== 'object') throw new Error('action required');
  return {
    missionId,
    actionId: action.id,
    kind: action.kind,
    risk: action.risk,
    summary: action.summary,
    payload: Object.prototype.hasOwnProperty.call(action, 'payload') ? action.payload : null,
  };
}

export function actionIntentDigest(input) {
  return digest(actionIntent(input));
}

function approvalMaterial(record) {
  const { approvalDigest: _ignored, ...material } = record;
  return material;
}

export function createApprovalRecord({ missionId, action, operationId, approvedPlanHash, approvedAt }) {
  assertOperationId(operationId);
  if (typeof approvedPlanHash !== 'string' || !HEX64.test(approvedPlanHash)) throw new Error('approvedPlanHash must be sha256 hex');
  if (typeof approvedAt !== 'string' || !approvedAt) throw new Error('approvedAt required');
  const record = {
    version: AUTHORITY_VERSION,
    operationId,
    missionId,
    actionId: action.id,
    actionDigest: actionIntentDigest({ missionId, action }),
    approvedPlanHash,
    approvedAt,
    authorityCeiling: structuredClone(AUTHORITY_CEILING),
  };
  return { ...record, approvalDigest: digest(record) };
}

export function verifyApprovalRecord(record, { missionId, action, operationId } = {}) {
  if (!isPlainObject(record) || record.version !== AUTHORITY_VERSION) throw new Error('invalid approval record');
  assertOperationId(record.operationId);
  if (!HEX64.test(String(record.actionDigest ?? '')) || !HEX64.test(String(record.approvedPlanHash ?? '')) || !HEX64.test(String(record.approvalDigest ?? ''))) throw new Error('invalid approval digest fields');
  if (digest(approvalMaterial(record)) !== record.approvalDigest) throw new Error('approval receipt digest mismatch');
  if (canonicalJson(record.authorityCeiling) !== canonicalJson(AUTHORITY_CEILING)) throw new Error('approval authority ceiling mismatch');
  if (missionId !== undefined && record.missionId !== missionId) throw new Error('approval mission mismatch');
  if (operationId !== undefined && record.operationId !== operationId) throw new Error('approval operation mismatch');
  if (action !== undefined) {
    if (record.actionId !== action.id) throw new Error('approval action mismatch');
    if (record.actionDigest !== actionIntentDigest({ missionId: record.missionId, action })) throw new Error('approved action payload changed');
  }
  return record;
}

function executionMaterial(receipt) {
  const { receiptDigest: _ignored, ...material } = receipt;
  return material;
}

export function createExecutionReceipt({ approval, executedAt, output, semantics, previousReceiptDigest = null, receiptId = null }) {
  verifyApprovalRecord(approval);
  if (previousReceiptDigest !== null && !HEX64.test(String(previousReceiptDigest))) throw new Error('previousReceiptDigest must be sha256 hex or null');
  if (receiptId !== null && (typeof receiptId !== 'string' || !/^receipt_[A-Za-z0-9-]{8,128}$/.test(receiptId))) throw new Error('invalid receiptId');
  const receipt = {
    version: AUTHORITY_VERSION,
    ...(receiptId === null ? {} : { id: receiptId }),
    operationId: approval.operationId,
    missionId: approval.missionId,
    actionId: approval.actionId,
    approvalDigest: approval.approvalDigest,
    actionDigest: approval.actionDigest,
    executedAt,
    semantics,
    outputDigest: digest(output),
    authorityCeiling: structuredClone(AUTHORITY_CEILING),
    previousReceiptDigest,
  };
  return { ...receipt, receiptDigest: digest(receipt) };
}

export function verifyExecutionReceipt(receipt, { approval, output } = {}) {
  if (!isPlainObject(receipt) || receipt.version !== AUTHORITY_VERSION) throw new Error('invalid execution receipt');
  assertOperationId(receipt.operationId);
  for (const field of ['approvalDigest', 'actionDigest', 'outputDigest', 'receiptDigest']) if (!HEX64.test(String(receipt[field] ?? ''))) throw new Error(`invalid ${field}`);
  if (receipt.previousReceiptDigest !== null && !HEX64.test(String(receipt.previousReceiptDigest ?? ''))) throw new Error('invalid previousReceiptDigest');
  if (digest(executionMaterial(receipt)) !== receipt.receiptDigest) throw new Error('execution receipt digest mismatch');
  if (canonicalJson(receipt.authorityCeiling) !== canonicalJson(AUTHORITY_CEILING)) throw new Error('execution authority ceiling mismatch');
  if (approval) {
    verifyApprovalRecord(approval);
    if (receipt.operationId !== approval.operationId || receipt.missionId !== approval.missionId || receipt.actionId !== approval.actionId || receipt.approvalDigest !== approval.approvalDigest || receipt.actionDigest !== approval.actionDigest) throw new Error('execution receipt is not bound to approval');
  }
  if (output !== undefined && receipt.outputDigest !== digest(output)) throw new Error('execution output digest mismatch');
  return receipt;
}

export function emptyAuthorityState() {
  return { version: AUTHORITY_VERSION, operations: {}, receiptHead: null, receipts: [] };
}

export function ensureAuthorityState(state) {
  if (!state.authority) state.authority = emptyAuthorityState();
  const authority = state.authority;
  if (!isPlainObject(authority) || authority.version !== AUTHORITY_VERSION || !isPlainObject(authority.operations) || !Array.isArray(authority.receipts)) throw new Error('unsupported authority state');
  if (authority.receiptHead !== null && !HEX64.test(String(authority.receiptHead))) throw new Error('invalid authority receipt head');
  let previous = null;
  for (const receipt of authority.receipts) {
    verifyExecutionReceipt(receipt);
    if (receipt.previousReceiptDigest !== previous) throw new Error('authority receipt chain mismatch');
    previous = receipt.receiptDigest;
  }
  if (previous !== authority.receiptHead) throw new Error('authority receipt head mismatch');
  for (const [operationId, operation] of Object.entries(authority.operations)) {
    assertOperationId(operationId);
    if (!isPlainObject(operation) || !['approved', 'complete'].includes(operation.status)) throw new Error('invalid authority operation');
    verifyApprovalRecord(operation.approval, { operationId });
    if (operationId !== operation.approval.operationId) throw new Error('authority operation key mismatch');
    if (operation.status === 'complete') {
      if (!HEX64.test(String(operation.receiptDigest ?? ''))) throw new Error('completed authority operation lacks receipt');
      const receipt = authority.receipts.find((item) => item.receiptDigest === operation.receiptDigest);
      if (!receipt) throw new Error('completed authority operation receipt missing');
      verifyExecutionReceipt(receipt, { approval: operation.approval });
    } else if (operation.receiptDigest !== null && operation.receiptDigest !== undefined) {
      throw new Error('approved authority operation must not have receipt');
    }
  }
  return authority;
}
