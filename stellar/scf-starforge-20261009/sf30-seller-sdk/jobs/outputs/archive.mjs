// MIT. Paid-job binding around the maintained native file-set ZIP implementation.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { readLabZip, writeLabZip } from '../../lab-edd/zip.mjs';
import { absolute } from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { digest, jobError } from '../config.mjs';
import {
  RESULT_PACKAGE_TYPE, RESULT_PACKAGE_MANIFEST, RESULT_PACKAGE_MAX_BYTES,
  RESULT_PACKAGE_MAX_FILES, RESULT_PACKAGE_MANIFEST_BYTES,
  prepareResultMembers, parseResultManifest
} from './contract.mjs';

const fail = code => { throw jobError(code, 409); };
const check = signal => signal?.throwIfAborted();
function zip(operation) {
  try { return operation(); }
  catch (error) {
    if (typeof error?.code !== 'string' || !error.code.startsWith('JOB_INPUT_LAB_')) throw error;
    throw Object.assign(jobError('JOB_OUTPUT_ARCHIVE_INVALID', 409), { cause: error });
  }
}
function expectedPackage(expected) {
  if (!expected || !Number.isSafeInteger(expected.bytes) || expected.bytes < 22 ||
      expected.bytes > RESULT_PACKAGE_MAX_BYTES || !/^[a-f0-9]{64}$/.test(expected.sha256 ?? '') ||
      expected.contentType !== RESULT_PACKAGE_TYPE || typeof expected.filename !== 'string')
    fail('JOB_OUTPUT_SOURCE_REQUIRED');
  return expected;
}

/** The original worker still returns one bounded immutable byte result. */
export function createResultPackage(result, options = {}) {
  const prepared = prepareResultMembers(result, options);
  check(options.signal);
  return zip(() => writeLabZip(prepared.members.map(member =>
    ({ filename: member.name, bytes: member.body })),
    { maxBytes: options.output.maxBytes, signal: options.signal }));
}

/** Verify the entire original archive before exposing a named member. */
export function inspectResultPackage(input, { expected, job = {}, signal } = {}) {
  expectedPackage(expected); check(signal);
  if (!(input instanceof Uint8Array) || input.byteLength !== expected.bytes)
    fail('JOB_OUTPUT_ARCHIVE_CHANGED');
  const body = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (digest(body) !== expected.sha256) fail('JOB_OUTPUT_ARCHIVE_CHANGED');
  const files = zip(() => readLabZip(body, {
    maxBytes: RESULT_PACKAGE_MAX_BYTES, maxMembers: RESULT_PACKAGE_MAX_FILES + 1, signal
  }));
  if (files[0]?.filename !== RESULT_PACKAGE_MANIFEST ||
      files[0].bytes.length > RESULT_PACKAGE_MANIFEST_BYTES) fail('JOB_OUTPUT_MANIFEST_REQUIRED');
  const manifestBytes = files[0].bytes, manifest = parseResultManifest(manifestBytes, job);
  if (body.length > manifest.policy.maxBytes || expected.filename !== manifest.policy.filename ||
      files.length !== manifest.files.length + 1) fail('JOB_OUTPUT_POLICY_CHANGED');
  const bySlot = new Map();
  for (let index = 0; index < manifest.files.length; index++) {
    check(signal);
    const selected = manifest.files[index], file = files[index + 1];
    if (file.filename !== selected.filename || file.bytes.length !== selected.bytes ||
        file.sha256 !== selected.sha256) fail('JOB_OUTPUT_MEMBER_CHANGED');
    bySlot.set(selected.slot, file.bytes);
  }
  // New result packages use the existing writer's exact stored format. Reusing
  // its round trip rejects omitted directories, extra aliases, trailing data,
  // comments or metadata not represented by the approved complete file set.
  if (!zip(() => writeLabZip(files, { maxBytes: manifest.policy.maxBytes, signal })).equals(body))
    fail('JOB_OUTPUT_ARCHIVE_CHANGED');
  check(signal);
  const identity = { bytes: expected.bytes, sha256: expected.sha256,
    contentType: RESULT_PACKAGE_TYPE, filename: expected.filename };
  const manifestSha256 = digest(manifestBytes);
  return Object.freeze({
    body, package: Object.freeze(identity), manifestBytes, manifestSha256, manifest,
    file(slot) {
      const bytes = bySlot.get(slot);
      if (!bytes) throw jobError('JOB_OUTPUT_FILE_NOT_FOUND', 404);
      return bytes;
    },
    describe() { return { package: { ...identity }, manifestSha256,
      manifest: structuredClone(manifest) }; },
  });
}

/** Read one stable local file with the original complete result size and digest. */
export async function readResultPackage(path, options = {}) {
  const expected = expectedPackage(options.expected), signal = options.signal;
  path = absolute(path); check(signal);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size !== expected.bytes) fail('JOB_OUTPUT_ARCHIVE_CHANGED');
    const bytes = Buffer.alloc(before.size);
    for (let offset = 0; offset < bytes.length;) {
      check(signal);
      const { bytesRead } = await file.read(bytes, offset, Math.min(65536, bytes.length - offset), offset);
      if (!bytesRead) fail('JOB_OUTPUT_ARCHIVE_CHANGED');
      offset += bytesRead;
    }
    const after = await file.stat();
    if (!['dev','ino','size','mtimeMs','ctimeMs'].every(key => before[key] === after[key]))
      fail('JOB_OUTPUT_ARCHIVE_CHANGED');
    return inspectResultPackage(bytes, options);
  } finally { await file.close(); }
}
