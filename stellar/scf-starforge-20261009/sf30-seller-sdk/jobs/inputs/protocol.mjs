// MIT. Declared inputs bind original files into the existing canonical job input.
import { createHash } from 'node:crypto';
import { canonical, object, need, originOf, HASH, JOB_ID, FUNCTION_ID } from '../intake/protocol.mjs';

export const INPUT_FILES_FIELD = '$files';
export const POLICY_SCHEMA = 'stellar-forge.job-input-policy.v1';
export const FILE_SCHEMA = 'stellar-forge.job-input-file.v1';
export const PLAN_SCHEMA = 'stellar-forge.job-input-upload.v1';
export const STATUS_SCHEMA = 'stellar-forge.job-input-upload-status.v1';
export const UPLOAD_PATH = '/jobs/intake/v1/files';
export const CHUNK_BYTES = 262144;
export const MAX_FILE_BYTES = 2147483648;
export const MAX_TOTAL_BYTES = 8589934592;
export const MAX_PLAN_BYTES = 1048576;
const slotName = /^[A-Za-z][A-Za-z0-9_]{0,55}$/;
const unsafe = new Set(['__proto__', 'constructor', 'prototype']);
const media = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;
const mediaRule = /^(?:\*\/\*|[a-z0-9!#$&^_.+-]+\/(?:[a-z0-9!#$&^_.+-]+|\*))$/;
const exactKeys = (value, allowed, code) => need(object(value) &&
  Object.keys(value).every(key => allowed.includes(key)), code);
const int = (value, low, high, code) => { need(Number.isSafeInteger(value) && value >= low && value <= high, code); return value; };
export const hash = value => createHash('sha256').update(value).digest('hex');
export const fileTokenHash = token => {
  need(typeof token === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(token), 'JOB_INPUT_CLAIM_REQUIRED', 404);
  return hash(token);
};
export function normalizeFilePolicy(raw) {
  if (raw === undefined) return null;
  exactKeys(raw, ['slots', 'maxTotalBytes'], 'JOB_INPUT_POLICY_INVALID');
  need(object(raw.slots) && Object.keys(raw.slots).length > 0 && Object.keys(raw.slots).length <= 16,
    'JOB_INPUT_SLOTS_INVALID');
  const slots = {};
  for (const name of Object.keys(raw.slots).sort()) {
    need(slotName.test(name) && !unsafe.has(name), 'JOB_INPUT_SLOT_INVALID');
    const value = raw.slots[name];
    exactKeys(value, ['required', 'mediaTypes', 'maxBytes', 'description'], 'JOB_INPUT_SLOT_POLICY_INVALID');
    const mediaTypes = value.mediaTypes ?? ['application/octet-stream'];
    need(Array.isArray(mediaTypes) && mediaTypes.length > 0 && mediaTypes.length <= 32 &&
      mediaTypes.every(item => typeof item === 'string' && item.length <= 160 && mediaRule.test(item)) &&
      new Set(mediaTypes).size === mediaTypes.length, 'JOB_INPUT_MEDIA_POLICY_INVALID');
    need(value.required === undefined || typeof value.required === 'boolean', 'JOB_INPUT_REQUIRED_INVALID');
    const description = value.description ?? '';
    need(typeof description === 'string' && description.length <= 1024 && !/[\x00-\x1f\x7f]/.test(description),
      'JOB_INPUT_DESCRIPTION_INVALID');
    slots[name] = { required: value.required ?? true, description, mediaTypes: [...mediaTypes].sort(),
      maxBytes: int(value.maxBytes ?? 67108864, 1, MAX_FILE_BYTES, 'JOB_INPUT_FILE_LIMIT_INVALID') };
  }
  const maximum = Math.min(MAX_TOTAL_BYTES, Object.values(slots).reduce((sum, slot) => sum + slot.maxBytes, 0));
  const policy = { schema: POLICY_SCHEMA, slots,
    maxTotalBytes: int(raw.maxTotalBytes ?? maximum, 1, maximum, 'JOB_INPUT_TOTAL_LIMIT_INVALID') };
  return { ...policy, policySha256: hash(canonical(policy)) };
}
export function validateFilePolicy(value) {
  exactKeys(value, ['schema', 'slots', 'maxTotalBytes', 'policySha256'], 'JOB_INPUT_POLICY_INVALID');
  const normalized = normalizeFilePolicy({ slots: value.slots, maxTotalBytes: value.maxTotalBytes });
  need(canonical(normalized) === canonical(value), 'JOB_INPUT_POLICY_CHANGED', 409);
  return structuredClone(normalized);
}
export function acceptsMedia(slot, value) {
  return slot.mediaTypes.some(rule => rule === '*/*' || rule === value ||
    rule.endsWith('/*') && value.startsWith(rule.slice(0, -1)));
}
export function validateFile(value, policy, slot) {
  exactKeys(value, ['schema', 'filename', 'contentType', 'bytes', 'sha256', 'policySha256'], 'JOB_INPUT_FILE_INVALID');
  need(value.schema === FILE_SCHEMA && typeof value.filename === 'string' &&
    value.filename.length > 0 && Buffer.byteLength(value.filename) <= 240 &&
    !/[\\/\x00-\x1f\x7f]/.test(value.filename) && !['.', '..'].includes(value.filename) &&
    typeof value.contentType === 'string' && value.contentType.length <= 160 && media.test(value.contentType) &&
    HASH.test(value.sha256 ?? '') && HASH.test(value.policySha256 ?? ''), 'JOB_INPUT_FILE_INVALID');
  int(value.bytes, 0, MAX_FILE_BYTES, 'JOB_INPUT_FILE_SIZE_INVALID');
  if (policy) {
    const definition = policy.slots[slot];
    need(definition && value.policySha256 === policy.policySha256, 'JOB_INPUT_FILE_POLICY_CHANGED', 409);
    need(value.bytes <= definition.maxBytes && acceptsMedia(definition, value.contentType),
      'JOB_INPUT_FILE_NOT_ALLOWED', 422);
  }
  return structuredClone(value);
}
export function inputManifest(policy, input, { complete = true } = {}) {
  if (!policy) return {};
  validateFilePolicy(policy);
  need(object(input) && object(input[INPUT_FILES_FIELD]), 'JOB_INPUT_FILES_REQUIRED', 422);
  const supplied = input[INPUT_FILES_FIELD], files = {};
  let total = 0;
  for (const [slot, value] of Object.entries(supplied)) {
    need(Object.hasOwn(policy.slots, slot), 'JOB_INPUT_SLOT_NOT_ALLOWED', 422);
    files[slot] = validateFile(value, policy, slot); total += value.bytes;
  }
  if (complete) for (const [slot, definition] of Object.entries(policy.slots))
    need(!definition.required || Object.hasOwn(files, slot), 'JOB_INPUT_REQUIRED_FILE_MISSING', 422);
  need(total <= policy.maxTotalBytes, 'JOB_INPUT_TOTAL_LIMIT_EXCEEDED', 413);
  return files;
}
export function augmentFileInput(schema, example, policy) {
  if (!policy) return { schema, example };
  need(!Object.hasOwn(schema.properties, INPUT_FILES_FIELD) && !Object.hasOwn(example, INPUT_FILES_FIELD),
    'JOB_INPUT_FILES_FIELD_COLLISION');
  need(Object.keys(schema.properties).length < 64, 'JOB_INPUT_SCHEMA_PROPERTY_LIMIT');
  const properties = {}, examples = {}, required = [];
  for (const [slot, rule] of Object.entries(policy.slots)) {
    properties[slot] = { type: 'object', additionalProperties: false,
      properties: {
        schema: { type: 'string', enum: [FILE_SCHEMA] },
        filename: { type: 'string', minLength: 1, maxLength: 240 },
        contentType: { type: 'string', minLength: 3, maxLength: 160 },
        bytes: { type: 'integer', minimum: 0, maximum: rule.maxBytes },
        sha256: { type: 'string', pattern: HASH.source, minLength: 64, maxLength: 64 },
        policySha256: { type: 'string', enum: [policy.policySha256] },
      }, required: ['schema', 'filename', 'contentType', 'bytes', 'sha256', 'policySha256'] };
    if (rule.required) {
      required.push(slot);
      const type = rule.mediaTypes.find(value => !value.includes('*')) ??
        (rule.mediaTypes[0] === '*/*' ? 'application/octet-stream' : rule.mediaTypes[0].replace('*', 'plain'));
      examples[slot] = { schema: FILE_SCHEMA, filename: slot + '.bin', contentType: type,
        bytes: 0, sha256: hash(Buffer.alloc(0)), policySha256: policy.policySha256 };
    }
  }
  const result = structuredClone(schema);
  result.properties[INPUT_FILES_FIELD] = { type: 'object', properties, required, additionalProperties: false };
  result.required = [...new Set([...(schema.required ?? []), INPUT_FILES_FIELD])];
  return { schema: result, example: { ...structuredClone(example), [INPUT_FILES_FIELD]: examples } };
}
export function validateUploadPlan(value) {
  exactKeys(value, ['schema', 'origin', 'reference', 'functionId', 'slot', 'file', 'chunkBytes', 'chunks'],
    'JOB_INPUT_UPLOAD_INVALID');
  need(value.schema === PLAN_SCHEMA && JOB_ID.test(value.reference ?? '') &&
    FUNCTION_ID.test(value.functionId ?? '') && slotName.test(value.slot ?? '') && !unsafe.has(value.slot),
    'JOB_INPUT_UPLOAD_INVALID');
  originOf(value.origin); validateFile(value.file);
  need(value.chunkBytes === CHUNK_BYTES && Array.isArray(value.chunks) &&
    value.chunks.length === Math.ceil(value.file.bytes / CHUNK_BYTES) &&
    value.chunks.every(sha => typeof sha === 'string' && HASH.test(sha)) &&
    Buffer.byteLength(canonical(value)) <= MAX_PLAN_BYTES, 'JOB_INPUT_CHUNK_MANIFEST_INVALID');
  if (value.file.bytes === 0) need(value.file.sha256 === hash(Buffer.alloc(0)), 'JOB_INPUT_WHOLE_DIGEST_MISMATCH', 409);
  return structuredClone(value);
}
export function uploadIdentity(plan) {
  const { origin, reference, functionId, slot, file } = validateUploadPlan(plan);
  return hash(canonical({ schema: PLAN_SCHEMA, origin, reference, functionId, slot, file }));
}
export function fileUploadIdentity({ origin, reference, functionId, slot, file }) {
  return hash(canonical({ schema: PLAN_SCHEMA, origin: originOf(origin), reference, functionId, slot, file }));
}
export function chunkLength(plan, index) {
  int(index, 0, Math.ceil(plan.file.bytes / CHUNK_BYTES) - 1, 'JOB_INPUT_CHUNK_INDEX_INVALID');
  return Math.min(CHUNK_BYTES, plan.file.bytes - index * CHUNK_BYTES);
}
export function storageLimits(raw = {}) {
  exactKeys(raw, ['maxBytes', 'maxUploads'], 'JOB_INPUT_STORAGE_CONFIG_INVALID');
  return { maxBytes: int(raw.maxBytes ?? 2147483648, 1, 1099511627776, 'JOB_INPUT_STORAGE_LIMIT_INVALID'),
    maxUploads: int(raw.maxUploads ?? 4096, 1, 100000, 'JOB_INPUT_STORAGE_COUNT_INVALID') };
}

export function validateUploadStatus(value, plan) {
  validateUploadPlan(plan);
  need(object(value) && value.schema === STATUS_SCHEMA && value.id === uploadIdentity(plan) &&
    value.planSha256 === hash(canonical(plan)) && ['UPLOADING', 'SEALED'].includes(value.state) &&
    Number.isSafeInteger(value.revision) && value.revision >= 1 &&
    canonical(value.file) === canonical(plan.file) && value.totalChunks === plan.chunks.length &&
    Array.isArray(value.missing) && new Set(value.missing).size === value.missing.length &&
    value.missing.every(index => Number.isSafeInteger(index) && index >= 0 && index < plan.chunks.length),
    'JOB_INPUT_REMOTE_BINDING_CHANGED', 502);
  const missingBytes = value.missing.reduce((sum, index) => sum + chunkLength(plan, index), 0);
  need(value.receivedChunks === plan.chunks.length - value.missing.length &&
    value.receivedBytes === plan.file.bytes - missingBytes &&
    (value.state !== 'SEALED' || value.missing.length === 0 && typeof value.sealedAt === 'string'),
    'JOB_INPUT_REMOTE_PROGRESS_INVALID', 502);
  return structuredClone(value);
}
