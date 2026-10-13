// MIT. Original approved source identity and complete registered-file custody.
import { WORLDBANK_ALIAS, WORLDBANK_ID, WORLDBANK_SHA, WORLDBANK_NAME, encodeWorldBank, digest,
  worldBankNeed as need, worldBankDescriptor } from './worldbank-programme-contracts.mjs';
export const INTAKE_MAX_BYTES = 32 * 1024 * 1024;
export const INTAKE_CHUNK_BYTES = 256 * 1024;
export const INTAKE_SCHEMA = 'stellar-forge.worldbank-intake.v1';
export const INTAKE_DELIVERY_SCHEMA = 'stellar-forge.worldbank-intake-delivery.v1';
export const INTAKE_MANIFEST = 'worldbank-intake-delivery.json';
export const INTAKE_ORIGINAL = 'WorldBank_Approved_Handover.zip';
export const INTAKE_REGISTRATION = 'WorldBank_Source_Registration.json';
export const INTAKE_INTENT = 'WorldBank_Source_Intent.json';
export function intakeIdentity(value, { id, workspaceId, intent } = {}) {
  need(value?.id === id && value.workspace_id === workspaceId &&
    value.intent && Number.isSafeInteger(value.intent.bytes) && value.intent.bytes > 0 &&
    value.intent.bytes <= INTAKE_MAX_BYTES && WORLDBANK_SHA.test(value.intent.sha256) &&
    typeof value.intent.filename === 'string',
    'Read the exact original source intake identity.', 'WORLDBANK_INTAKE_CHANGED');
  if (intent) need(encodeWorldBank(value.intent).equals(encodeWorldBank(intent)),
    'The original intake ID is bound to different complete ZIP bytes or filename.', 'WORLDBANK_INTAKE_CHANGED');
  if (value.status === 'REGISTERED') {
    const result = value.result;
    need(result?.schema === INTAKE_SCHEMA && result.status === 'REGISTERED' &&
      result.id === id && result.workspace_id === workspaceId && WORLDBANK_NAME.test(result.source?.name) &&
      Number.isSafeInteger(result.source.revision) && result.source.revision > 0 &&
      WORLDBANK_SHA.test(result.source.document_id) && result.handover?.bytes === value.intent.bytes &&
      result.handover.sha256 === value.intent.sha256,
      'Retain the original registration, source revision and complete handover.', 'WORLDBANK_INTAKE_CHANGED');
  }
  return value;
}
export function parseIntakeDelivery(raw, exportId) {
  need(Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= 65000, 'Read the complete source delivery manifest.');
  const value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(raw));
  need(value?.schema === INTAKE_DELIVERY_SCHEMA && value.exportId === exportId && WORLDBANK_SHA.test(exportId) &&
    WORLDBANK_ALIAS.test(value.workspace) && WORLDBANK_ID.test(value.workspaceId) && WORLDBANK_ID.test(value.intakeId) &&
    WORLDBANK_SHA.test(value.originalSha256) && WORLDBANK_SHA.test(value.registrationSha256) &&
    WORLDBANK_NAME.test(value.source?.name) && Number.isSafeInteger(value.source.revision) && value.source.revision > 0 &&
    WORLDBANK_SHA.test(value.source.document_id) && Array.isArray(value.files) && value.files.length === 3,
    'Keep the complete registered source delivery identity.');
  const {exportId:identity,...body}=value;
  need(digest(encodeWorldBank(body)) === identity && encodeWorldBank(value).equals(raw),
    'The registered source delivery identity changed.', 'WORLDBANK_INTAKE_CHANGED');
  const names=new Set([INTAKE_ORIGINAL,INTAKE_REGISTRATION,INTAKE_INTENT]);
  for(const file of value.files) { worldBankDescriptor(file); need(names.delete(file.name), 'Retain each complete original source file once.'); }
  const original=value.files.find(f=>f.name===INTAKE_ORIGINAL), registration=value.files.find(f=>f.name===INTAKE_REGISTRATION);
  need(original.bytes>0 && original.bytes<=INTAKE_MAX_BYTES && original.sha256===value.originalSha256 &&
    registration.sha256===value.registrationSha256, 'Retain the exact original ZIP and registration hashes.');
  return value;
}
