// MIT. Complete customer-file identity for the original World Bank programme.
import { createHash } from 'node:crypto';
export const WORLDBANK_DELIVERY_SCHEMA = 'stellar-forge.worldbank-programme-delivery.v1';
export const WORLDBANK_MANIFEST_NAME = 'worldbank-programme-delivery.json';
export const WORLDBANK_OPERATION_NAME = 'WorldBank_Programme_Operation.json';
export const WORLDBANK_FILE_BYTES = 1024 * 1024 * 1024;
export const WORLDBANK_MANIFEST_BYTES = 65000;
export const WORLDBANK_ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const WORLDBANK_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
export const WORLDBANK_ID = /^[a-f0-9]{32}$/;
export const WORLDBANK_SHA = /^[a-f0-9]{64}$/;
export const worldBankFailure = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
export function worldBankNeed(value, message, code = 'WORLDBANK_AGENT_INPUT') {
  if (!value) throw worldBankFailure(code, message);
}
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  const out = JSON.stringify(value); worldBankNeed(out !== undefined, 'Retain complete JSON values.'); return out;
}
export const digest = value => createHash('sha256').update(value).digest('hex');
export const encodeWorldBank = value => Buffer.from(canonical(value) + '\n');
export function worldBankFileName(name) {
  worldBankNeed(typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(name),
    'Select one exact original delivery filename.'); return name;
}
export function worldBankDescriptor(value) {
  worldBankNeed(plain(value) && Number.isSafeInteger(value.bytes) && value.bytes >= 0 &&
    value.bytes <= WORLDBANK_FILE_BYTES && WORLDBANK_SHA.test(value.sha256),
    'Retain the complete original file byte count and SHA256.');
  worldBankFileName(value.name); return value;
}
export function parseWorldBankDelivery(raw, exportId) {
  worldBankNeed(Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= WORLDBANK_MANIFEST_BYTES,
    'Read the complete original World Bank delivery manifest.');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw worldBankFailure('WORLDBANK_DELIVERY_INVALID', 'Read complete UTF-8 delivery JSON.'); }
  worldBankNeed(value?.schema === WORLDBANK_DELIVERY_SCHEMA && value.exportId === exportId &&
    WORLDBANK_SHA.test(exportId) && WORLDBANK_ALIAS.test(value.workspace) &&
    WORLDBANK_ID.test(value.workspaceId) && WORLDBANK_NAME.test(value.programme) &&
    WORLDBANK_ID.test(value.operationId) && WORLDBANK_SHA.test(value.resultSha256) &&
    Array.isArray(value.files) && value.files.length > 0 && value.files.length <= 128,
    'Retain the original workspace, programme, completed operation and complete file list.');
  const { exportId: identity, ...body } = value;
  worldBankNeed(digest(encodeWorldBank(body)) === identity && encodeWorldBank(value).equals(raw),
    'The complete original delivery identity changed.', 'WORLDBANK_DELIVERY_CHANGED');
  const names = new Set();
  for (const file of value.files) {
    worldBankDescriptor(file);
    worldBankNeed(!names.has(file.name) && file.name !== WORLDBANK_MANIFEST_NAME, 'Retain each original member once.');
    names.add(file.name);
  }
  worldBankNeed(names.has(WORLDBANK_OPERATION_NAME) && names.has('WorldBank_Analysis_Delivery.zip') &&
    names.has('WorldBank_Analysis_Workspace.zip') && names.has('WorldBank_Workbook_Handover.zip'),
    'Receive the complete native programme, report/workbook delivery and portable workspace.');
  return value;
}
