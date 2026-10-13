// MIT. Named result files remain one immutable result of the original paid job.
import { canonical, digest, plain, jobError, HASH, JOB_ID } from '../config.mjs';

export const RESULT_PACKAGE_SCHEMA = 'stellar-forge.job-result-package.v1';
export const RESULT_PACKAGE_TYPE = 'application/vnd.stellar-forge.job-result+zip';
export const RESULT_PACKAGE_MANIFEST = 'job-result.json';
export const RESULT_PACKAGE_MAX_BYTES = 67108864;
export const RESULT_PACKAGE_MAX_FILES = 16;
export const RESULT_PACKAGE_MANIFEST_BYTES = 65000;
export const RESULT_SLOT = /^[A-Za-z][A-Za-z0-9_]{0,55}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const fail = (code, status = 400) => { throw jobError(code, status); };
const need = (condition, code = 'JOB_OUTPUT_PACKAGE_INVALID') => { if (!condition) fail(code); };
export const packageBytes = value => Buffer.from(canonical(value) + '\n');
function exact(value, keys) {
  need(plain(value) && Object.keys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value, key)));
}
function filename(value) {
  need(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value) &&
    !value.endsWith('.') && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value) &&
    value.toLowerCase() !== RESULT_PACKAGE_MANIFEST,
    'JOB_OUTPUT_FILENAME_INVALID');
  return value;
}
function contentType(value) {
  need(typeof value === 'string' && value.length <= 160 &&
    /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:;[\x20-\x7e]+)?$/.test(value),
    'JOB_OUTPUT_CONTENT_TYPE_INVALID');
  return value;
}
function bounded(value, minimum, maximum) {
  need(Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    'JOB_OUTPUT_PACKAGE_LIMIT_INVALID');
  return value;
}
function policyCore(value) {
  exact(value, ['format', 'contentType', 'filename', 'maxBytes', 'files']);
  need(value.format === 'package' && value.contentType === RESULT_PACKAGE_TYPE,
    'JOB_OUTPUT_FORMAT_INVALID');
  filename(value.filename);
  const maximum = bounded(value.maxBytes, 1, RESULT_PACKAGE_MAX_BYTES);
  need(plain(value.files) && Object.keys(value.files).length > 0 &&
    Object.keys(value.files).length <= RESULT_PACKAGE_MAX_FILES, 'JOB_OUTPUT_FILES_REQUIRED');
  const names = new Set(); let required = 0;
  for (const [slot, file] of Object.entries(value.files)) {
    need(RESULT_SLOT.test(slot) && !RESERVED.has(slot), 'JOB_OUTPUT_SLOT_INVALID');
    exact(file, ['filename', 'contentType', 'required', 'maxBytes']);
    filename(file.filename); contentType(file.contentType);
    need(typeof file.required === 'boolean', 'JOB_OUTPUT_REQUIRED_INVALID');
    bounded(file.maxBytes, 1, maximum); required += Number(file.required);
    const key = file.filename.toLowerCase();
    need(!names.has(key), 'JOB_OUTPUT_FILENAME_DUPLICATE'); names.add(key);
  }
  need(required > 0, 'JOB_OUTPUT_REQUIRED_FILE_MISSING');
  return value;
}

/** Compile only an explicit package declaration. Ordinary JSON/bytes are untouched. */
export function normalizePackageOutput(value, maxBytes) {
  need(plain(value) && Object.keys(value).every(key =>
    ['format', 'contentType', 'filename', 'files'].includes(key)), 'JOB_OUTPUT_PACKAGE_INVALID');
  need(value.format === 'package' && (value.contentType === undefined ||
    value.contentType === RESULT_PACKAGE_TYPE), 'JOB_OUTPUT_CONTENT_TYPE_INVALID');
  need(plain(value.files), 'JOB_OUTPUT_FILES_REQUIRED');
  const files = Object.create(null);
  for (const [slot, raw] of Object.entries(value.files)) {
    need(plain(raw) && Object.keys(raw).every(key =>
      ['filename', 'contentType', 'required', 'maxBytes'].includes(key)), 'JOB_OUTPUT_PACKAGE_INVALID');
    files[slot] = { filename: raw.filename, contentType: raw.contentType ?? 'application/octet-stream',
      required: raw.required ?? true, maxBytes: raw.maxBytes ?? maxBytes };
  }
  const policy = policyCore({ format: 'package', contentType: RESULT_PACKAGE_TYPE,
    filename: value.filename ?? 'result.zip', maxBytes, files });
  return { ...policy, policySha256: digest(canonical(policy)) };
}
export function validatePackagePolicy(value) {
  exact(value, ['format', 'contentType', 'filename', 'maxBytes', 'files', 'policySha256']);
  const { policySha256, ...core } = value;
  policyCore(core);
  need(HASH.test(policySha256 ?? '') && digest(canonical(core)) === policySha256,
    'JOB_OUTPUT_POLICY_CHANGED');
  return value;
}
export function validatePackageJob(value, expected = {}) {
  exact(value, ['id', 'functionId', 'inputSha256', 'configSha256', 'applicationSha256',
    'publicOrigin', 'attemptId', 'nativeSettlement']);
  need(typeof value.id === 'string' && JOB_ID.test(value.id) &&
    typeof value.functionId === 'string' && RESULT_SLOT.test(value.functionId) &&
    !RESERVED.has(value.functionId) && UUID.test(value.attemptId ?? ''),
    'JOB_OUTPUT_JOB_INVALID');
  for (const key of ['inputSha256', 'configSha256', 'applicationSha256'])
    need(typeof value[key] === 'string' && HASH.test(value[key]), 'JOB_OUTPUT_JOB_INVALID');
  let origin;
  try { origin = new URL(value.publicOrigin); } catch { fail('JOB_OUTPUT_JOB_INVALID'); }
  need(origin.protocol === 'https:' && origin.origin === value.publicOrigin &&
    !origin.username && !origin.password, 'JOB_OUTPUT_JOB_INVALID');
  exact(value.nativeSettlement, ['id', 'at']);
  need(typeof value.nativeSettlement.id === 'string' && HASH.test(value.nativeSettlement.id) &&
    typeof value.nativeSettlement.at === 'string' && Number.isFinite(Date.parse(value.nativeSettlement.at)),
    'JOB_OUTPUT_SETTLEMENT_INVALID');
  for (const key of ['id', 'functionId', 'inputSha256', 'configSha256', 'applicationSha256',
    'publicOrigin', 'attemptId', 'nativeSettlement']) {
    if (expected[key] !== undefined) need(canonical(value[key]) === canonical(expected[key]),
      key === 'nativeSettlement' ? 'JOB_OUTPUT_SETTLEMENT_CHANGED' : 'JOB_OUTPUT_JOB_CHANGED');
  }
  return value;
}
export function parseResultManifest(bytes, expected = {}) {
  need(bytes instanceof Uint8Array && bytes.length > 0 &&
    bytes.length <= RESULT_PACKAGE_MANIFEST_BYTES, 'JOB_OUTPUT_MANIFEST_TOO_LARGE');
  let manifest;
  try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('JOB_OUTPUT_PACKAGE_INVALID'); }
  exact(manifest, ['schema', 'job', 'policy', 'files']);
  need(manifest.schema === RESULT_PACKAGE_SCHEMA, 'JOB_OUTPUT_PACKAGE_INVALID');
  validatePackageJob(manifest.job, expected); validatePackagePolicy(manifest.policy);
  need(Array.isArray(manifest.files) && manifest.files.length > 0 &&
    manifest.files.length <= RESULT_PACKAGE_MAX_FILES, 'JOB_OUTPUT_FILES_REQUIRED');
  const slots = new Set(), names = new Set(); let total = 0;
  for (const file of manifest.files) {
    exact(file, ['slot', 'filename', 'contentType', 'bytes', 'sha256']);
    const declared = manifest.policy.files[file.slot];
    need(typeof file.slot === 'string' && RESULT_SLOT.test(file.slot) &&
      Object.hasOwn(manifest.policy.files, file.slot) && !slots.has(file.slot),
      'JOB_OUTPUT_SLOT_INVALID');
    need(file.filename === declared.filename && file.contentType === declared.contentType &&
      !names.has(file.filename.toLowerCase()), 'JOB_OUTPUT_POLICY_CHANGED');
    bounded(file.bytes, 0, declared.maxBytes);
    need(typeof file.sha256 === 'string' && HASH.test(file.sha256), 'JOB_OUTPUT_DIGEST_INVALID');
    total += file.bytes;
    need(Number.isSafeInteger(total) && total <= manifest.policy.maxBytes, 'JOB_OUTPUT_TOO_LARGE');
    slots.add(file.slot); names.add(file.filename.toLowerCase());
  }
  for (const [slot, file] of Object.entries(manifest.policy.files))
    need(!file.required || slots.has(slot), 'JOB_OUTPUT_REQUIRED_FILE_MISSING');
  // Our writer uses one canonical complete manifest. Reject duplicate JSON keys
  // and alternative spellings before interpreting any archive member.
  need(Buffer.from(bytes).equals(packageBytes(manifest)), 'JOB_OUTPUT_MANIFEST_CHANGED');
  return manifest;
}
export function prepareResultMembers(result, { output, job, signal } = {}) {
  validatePackagePolicy(output); validatePackageJob(job);
  need(plain(result) && Object.keys(result).every(slot => Object.hasOwn(output.files, slot)),
    'JOB_OUTPUT_SLOT_INVALID');
  const members = [], files = []; let total = 0;
  for (const slot of Object.keys(output.files).sort()) {
    signal?.throwIfAborted();
    const declared = output.files[slot];
    if (!Object.hasOwn(result, slot)) {
      need(!declared.required, 'JOB_OUTPUT_REQUIRED_FILE_MISSING'); continue;
    }
    const value = result[slot];
    need(typeof value === 'string' || value instanceof Uint8Array, 'JOB_OUTPUT_TYPE_INVALID');
    const size = typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : value.byteLength;
    need(size <= declared.maxBytes && (total += size) <= output.maxBytes, 'JOB_OUTPUT_TOO_LARGE');
    const body = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
    files.push({ slot, filename: declared.filename, contentType: declared.contentType,
      bytes: body.length, sha256: digest(body) });
    members.push({ name: declared.filename, body });
  }
  need(files.length > 0, 'JOB_OUTPUT_FILES_REQUIRED');
  const manifest = { schema: RESULT_PACKAGE_SCHEMA, job, policy: output, files };
  const encoded = packageBytes(manifest);
  parseResultManifest(encoded, job);
  need(total + encoded.length <= output.maxBytes, 'JOB_OUTPUT_TOO_LARGE');
  return { manifest, members: [{ name: RESULT_PACKAGE_MANIFEST, body: encoded }, ...members] };
}
