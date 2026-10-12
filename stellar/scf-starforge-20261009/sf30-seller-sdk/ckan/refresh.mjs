// MIT. Complete retained CKAN change review under the original project lease.
import { constants } from 'node:fs';
import { open, lstat, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { bytes, digest, fault, privateDirectory, readPrivate, createFile,
  atomicJson, syncDirectory } from '../postgres/publisher/files.mjs';
import { CAPTURE_SCHEMA, ExactCkanNumber, parseCkanJson } from './capture.mjs';
import { compareCkanSemantics } from './semantics.mjs';

export const CKAN_REFRESH_COMPARISON_SCHEMA = 'stellar-forge.ckan-refresh-comparison.v1';
const INPUT_SCHEMA = 'stellar-forge.ckan-refresh-input.v1';
const PROGRESS_SCHEMA = 'stellar-forge.ckan-refresh-progress.v1';
const HASH = /^[a-f0-9]{64}$/;
const STRIDE = 128;
const CHUNK = 65536;
const MAX_ROWS = 10000000;
const MAX_DESCRIPTOR = 32 * 1024 * 1024;
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const MAX_PAGE_ROWS = 200;
const EMPTY_HASH = digest(Buffer.alloc(0));
const verified = new Map();

function requireValue(condition, code, message) {
  if (!condition) throw fault(code, message ?? code);
}
const ownObject = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && !(value instanceof ExactCkanNumber);
const exists = async file => {
  try { await lstat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
function stopped(signal) {
  if (signal?.aborted) throw fault('CKAN_REFRESH_CANCELLED', 'The same retained comparison can be resumed.', 409);
}
function natural(value, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}
function checkedKeys(keys) {
  requireValue(Array.isArray(keys) && keys.length >= 1 && keys.length <= 16 &&
    keys.every(key => typeof key === 'string' && key.length > 0 && key.length <= 512) &&
    new Set(keys).size === keys.length, 'CKAN_REFRESH_KEYS_INVALID',
    'Select one to sixteen distinct original scalar key fields.');
  return [...keys];
}

// Numeric identity is mathematical decimal identity, with signed zero retained.
// The wire number token is never replaced. Strings, booleans and objects have
// separate type tags, so neither "1" nor {source:"1"} can equal the number 1.
function decimalKey(token) {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  requireValue(Boolean(match), 'CKAN_REFRESH_NUMBER_INVALID');
  const fraction = match[3] ?? '';
  let digits = (match[2] + fraction).replace(/^0+/, '');
  if (!digits) return match[1] ? '-0' : '0';
  const trailing = /0*$/.exec(digits)[0].length;
  if (trailing) digits = digits.slice(0, -trailing);
  return match[1] + digits + 'e' +
    (BigInt(match[4] ?? '0') - BigInt(fraction.length) + BigInt(trailing)).toString();
}
function scalarType(value) {
  if (value instanceof ExactCkanNumber) return 'number';
  if (typeof value === 'number') {
    requireValue(Number.isFinite(value), 'CKAN_REFRESH_NUMBER_INVALID');
    return 'number';
  }
  if (typeof value === 'string' || typeof value === 'boolean') return typeof value;
  return null;
}
function typedHash(value) {
  const hash = createHash('sha256'), active = new Set();
  const visit = current => {
    if (current instanceof ExactCkanNumber || typeof current === 'number') {
      if (typeof current === 'number') requireValue(Number.isFinite(current), 'CKAN_REFRESH_NUMBER_INVALID');
      const token = current instanceof ExactCkanNumber ? current.source :
        Object.is(current, -0) ? '-0' : String(current);
      hash.update('n' + decimalKey(token) + ';');
    } else if (current === null) hash.update('z;');
    else if (typeof current === 'string') hash.update('s' + JSON.stringify(current) + ';');
    else if (typeof current === 'boolean') hash.update(current ? 'b1;' : 'b0;');
    else if (typeof current === 'object') {
      requireValue(!active.has(current), 'CKAN_REFRESH_VALUE_INVALID');
      active.add(current);
      if (Array.isArray(current)) {
        hash.update('a[');
        for (const item of current) visit(item);
        hash.update(']');
      } else {
        requireValue(Object.getPrototypeOf(current) === Object.prototype ||
          Object.getPrototypeOf(current) === null, 'CKAN_REFRESH_VALUE_INVALID');
        hash.update('o{');
        for (const key of Object.keys(current).sort()) {
          hash.update(JSON.stringify(key) + ':'); visit(current[key]);
        }
        hash.update('}');
      }
      active.delete(current);
    } else throw fault('CKAN_REFRESH_VALUE_INVALID', 'Use original retained JSON values.');
  };
  visit(value);
  return hash.digest('hex');
}
function rowKey(row, keys) {
  requireValue(ownObject(row), 'CKAN_REFRESH_ROW_INVALID');
  const values = keys.map(key => {
    requireValue(Object.hasOwn(row, key) && row[key] !== null, 'CKAN_REFRESH_KEY_MISSING',
      'Every selected key field must be present and non-null in both editions.');
    requireValue(scalarType(row[key]) !== null, 'CKAN_REFRESH_KEY_NOT_SCALAR',
      'Select original string, number or boolean key fields.');
    return row[key];
  });
  return { values, hash: typedHash(values) };
}
function publicSelection(capture) {
  const source = ownObject(capture.manifest.selection) ? capture.manifest.selection : null;
  return {
    catalogOrigin: capture.manifest.catalogOrigin,
    packageId: capture.manifest.packageId,
    resourceId: capture.manifest.resourceId,
    filters: source?.filters ?? null,
    q: source?.q ?? null,
    schemaUrl: source?.schemaUrl ?? null,
    pagination: source?.pagination ?? null,
    pageSize: source?.pageSize ?? null,
  };
}
function selectionScope(selection) {
  return { catalogOrigin: selection.catalogOrigin, packageId: selection.packageId,
    resourceId: selection.resourceId, filters: selection.filters, q: selection.q };
}
function captureDescription(capture) {
  const m = capture.manifest;
  return { manifestSha256: capture.manifestSha256, catalogOrigin: m.catalogOrigin,
    packageId: m.packageId, resourceId: m.resourceId, rowCount: m.rowCount,
    pageCount: m.pages.length, packageTitle: m.packageTitle ?? null,
    resourceTitle: m.resourceTitle ?? null, startedAt: m.startedAt ?? null,
    completedAt: m.completedAt ?? null, consistency: m.consistency ?? null,
    semanticConsistency: m.semanticConsistency ?? null,
    semanticSchemaSha256: m.semanticSchema?.sha256 ?? null,
    selection: publicSelection(capture) };
}
function validateCapture(capture, keys) {
  requireValue(capture && capture.manifest?.schema === CAPTURE_SCHEMA &&
    capture.manifest.provider === 'ckan' && capture.manifest.state === 'COMPLETE' &&
    capture.manifest.readOnly === true && HASH.test(capture.manifestSha256 ?? '') &&
    Buffer.isBuffer(capture.manifestBytes) &&
    digest(capture.manifestBytes) === capture.manifestSha256 &&
    Array.isArray(capture.rows) && capture.rows.length === capture.manifest.rowCount &&
    natural(capture.rows.length, MAX_ROWS / 2) &&
    Array.isArray(capture.fields) && Array.isArray(capture.manifest.pages) &&
    capture.rawFiles instanceof Map, 'CKAN_REFRESH_CAPTURE_REQUIRED',
    'Select complete original readCkanCapture results.');
  requireValue(typedHash(capture.manifest) === typedHash(parseCkanJson(capture.manifestBytes)) &&
    typedHash(capture.fields) === typedHash(capture.manifest.fields),
    'CKAN_REFRESH_CAPTURE_CHANGED');
  const fields = new Set(capture.fields.map(field => field.id));
  requireValue(keys.every(key => fields.has(key)), 'CKAN_REFRESH_KEY_FIELD_MISSING');
}
function metadataChanges(before, after) {
  before = ownObject(before) ? before : {};
  after = ownObject(after) ? after : {};
  const changed = [];
  for (const field of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const left = Object.hasOwn(before, field), right = Object.hasOwn(after, field);
    if (left !== right || typedHash(before[field]) !== typedHash(after[field])) {
      changed.push({ field, beforePresent: left, afterPresent: right,
        ...(left ? { before: before[field] } : {}), ...(right ? { after: after[field] } : {}) });
    }
  }
  return changed;
}
function packageMetadata(capture) {
  // Other resources belong to their own comparisons. The complete original
  // package response remains in the retained capture.
  return Object.fromEntries(Object.entries(capture.package ?? {}).filter(([key]) => key !== 'resources'));
}
function sourceTerms(capture) {
  const pkg = capture.package ?? {}, resource = capture.resource ?? {};
  return { license: { id: pkg.license_id ?? null, title: pkg.license_title ?? null,
      url: pkg.license_url ?? null, resource: resource.license ?? null },
    organization: pkg.organization ?? null, private: pkg.private ?? null,
    packageState: pkg.state ?? null, resourceState: resource.state ?? null,
    url: resource.url ?? null, urlType: resource.url_type ?? null,
    format: resource.format ?? null, mimeType: resource.mimetype ?? null,
    datastoreActive: resource.datastore_active ?? null };
}
function binding(before, after, keys) {
  return { schema: INPUT_SCHEMA, algorithm: 1, beforeManifestSha256: before.manifestSha256,
    afterManifestSha256: after.manifestSha256, keys };
}
function fileSignature(info) {
  return [info.dev, info.ino, info.size, info.mode, info.nlink, info.mtimeNs, info.ctimeNs].join(':');
}
function checkedFile(info) {
  requireValue(info.isFile() && info.nlink === 1n && (info.mode & 0o077n) === 0n &&
    info.size <= BigInt(Number.MAX_SAFE_INTEGER), 'CKAN_REFRESH_PRIVATE_FILE_REQUIRED');
  return info;
}
async function openPrivate(file, write = false, create = false) {
  const flags = (write ? constants.O_RDWR : constants.O_RDONLY) | constants.O_NOFOLLOW;
  let handle;
  try {
    if (create) {
      try { handle = await open(file, flags | constants.O_CREAT | constants.O_EXCL, 0o600); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    handle ??= await open(file, flags);
    const info = checkedFile(await handle.stat({ bigint: true }));
    return { handle, info };
  } catch (error) { await handle?.close(); throw error; }
}
async function stable(handle, original) {
  const after = checkedFile(await handle.stat({ bigint: true }));
  requireValue(fileSignature(after) === fileSignature(original), 'CKAN_REFRESH_FILE_CHANGED');
}
async function hashPrefix(handle, length, hash = createHash('sha256')) {
  const buffer = Buffer.allocUnsafe(CHUNK);
  let position = 0;
  while (position < length) {
    const part = await handle.read(buffer, 0, Math.min(buffer.length, length - position), position);
    requireValue(part.bytesRead > 0, 'CKAN_REFRESH_FILE_INCOMPLETE');
    hash.update(buffer.subarray(0, part.bytesRead)); position += part.bytesRead;
  }
  return hash;
}
async function writeAll(handle, raw, position) {
  let offset = 0;
  while (offset < raw.length) {
    const part = await handle.write(raw, offset, raw.length - offset, position + offset);
    requireValue(part.bytesWritten > 0, 'CKAN_REFRESH_WRITE_INCOMPLETE');
    offset += part.bytesWritten;
  }
}
async function readAll(handle, length) {
  const raw = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const part = await handle.read(raw, offset, length - offset, offset);
    requireValue(part.bytesRead > 0, 'CKAN_REFRESH_FILE_INCOMPLETE');
    offset += part.bytesRead;
  }
  return raw;
}
function descriptorFile(value, name) {
  requireValue(value && value.file === name && natural(value.bytes) && HASH.test(value.sha256 ?? ''),
    'CKAN_REFRESH_DESCRIPTOR_INVALID');
}
function validateComparison(value) {
  requireValue(value?.schema === CKAN_REFRESH_COMPARISON_SCHEMA && value.algorithm === 1 &&
    HASH.test(value.inputSha256 ?? '') && HASH.test(value.before?.manifestSha256 ?? '') &&
    HASH.test(value.after?.manifestSha256 ?? ''), 'CKAN_REFRESH_DESCRIPTOR_INVALID');
  checkedKeys(value.keys);
  for (const key of ['added', 'removed', 'changed', 'unchanged'])
    requireValue(natural(value[key], MAX_ROWS), 'CKAN_REFRESH_DESCRIPTOR_INVALID');
  requireValue(natural(value.before.rowCount, MAX_ROWS / 2) &&
    natural(value.after.rowCount, MAX_ROWS / 2) &&
    value.before.rowCount === value.removed + value.changed + value.unchanged &&
    value.after.rowCount === value.added + value.changed + value.unchanged &&
    typeof value.selectionChanged === 'boolean' && typeof value.fieldsChanged === 'boolean' &&
    typeof value.sourceTermsChanged === 'boolean', 'CKAN_REFRESH_DESCRIPTOR_INVALID');
  descriptorFile(value.changes, 'changes.jsonl');
  descriptorFile(value.index, 'changes.idx');
  requireValue(value.changes.rows === value.added + value.removed + value.changed &&
    value.index.stride === STRIDE && value.index.encoding === 'uint64-be' &&
    value.index.entries === Math.ceil(value.changes.rows / STRIDE) &&
    value.index.bytes === value.index.entries * 8, 'CKAN_REFRESH_DESCRIPTOR_INVALID');
  const expected = binding(value.before, value.after, value.keys);
  requireValue(typedHash(expected) === value.inputSha256, 'CKAN_REFRESH_INPUT_CHANGED');
  return expected;
}
async function openVerified(directory, expectedSha256) {
  requireValue(typeof directory === 'string' && resolve(directory) === directory,
    'CKAN_REFRESH_DIRECTORY_REQUIRED');
  await privateDirectory(directory);
  if (expectedSha256 !== undefined) requireValue(HASH.test(expectedSha256), 'CKAN_REFRESH_HASH_REQUIRED');
  const raw = await readPrivate(join(directory, 'comparison.json'), MAX_DESCRIPTOR), sha256 = digest(raw);
  requireValue(expectedSha256 === undefined || sha256 === expectedSha256, 'CKAN_REFRESH_COMPARISON_CHANGED');
  const comparison = parseCkanJson(raw), input = validateComparison(comparison);
  requireValue((await readPrivate(join(directory, 'input.json'), 16384)).equals(bytes(input)),
    'CKAN_REFRESH_INPUT_CHANGED');
  let changes, index;
  try {
    changes = await openPrivate(join(directory, 'changes.jsonl'));
    index = await openPrivate(join(directory, 'changes.idx'));
    requireValue(Number(changes.info.size) === comparison.changes.bytes &&
      Number(index.info.size) === comparison.index.bytes, 'CKAN_REFRESH_FILE_CHANGED');
    const cacheKey = directory + ':' + sha256;
    const signatures = fileSignature(changes.info) + '/' + fileSignature(index.info);
    let proof = verified.get(cacheKey);
    if (!proof || proof.signatures !== signatures) {
      const changeHash = await hashPrefix(changes.handle, comparison.changes.bytes);
      const indexHash = await hashPrefix(index.handle, comparison.index.bytes);
      requireValue(changeHash.digest('hex') === comparison.changes.sha256 &&
        indexHash.digest('hex') === comparison.index.sha256, 'CKAN_REFRESH_FILE_CHANGED');
      const indexRaw = await readAll(index.handle, comparison.index.bytes), offsets = [];
      for (let position = 0; position < indexRaw.length; position += 8) {
        const value = indexRaw.readBigUInt64BE(position);
        requireValue(value <= BigInt(Number.MAX_SAFE_INTEGER), 'CKAN_REFRESH_INDEX_INVALID');
        const offset = Number(value);
        requireValue(offset < comparison.changes.bytes &&
          (offsets.length ? offset > offsets[offsets.length - 1] : offset === 0),
          'CKAN_REFRESH_INDEX_INVALID');
        offsets.push(offset);
      }
      await stable(changes.handle, changes.info); await stable(index.handle, index.info);
      proof = { signatures, offsets };
      verified.delete(cacheKey); verified.set(cacheKey, proof);
      while (verified.size > 8) verified.delete(verified.keys().next().value);
    }
    return { directory, sha256, bytes: raw.length, comparison, changes, index, offsets: proof.offsets };
  } catch (error) {
    await changes?.handle.close(); await index?.handle.close(); throw error;
  }
}
async function closeVerified(value) {
  if (!value) return;
  try { await stable(value.changes.handle, value.changes.info); await stable(value.index.handle, value.index.info); }
  finally { await value.changes.handle.close(); await value.index.handle.close(); }
}
export async function readCkanRefreshComparison({ directory, expectedSha256 } = {}) {
  let value;
  try {
    value = await openVerified(directory, expectedSha256);
    return { sha256: value.sha256, bytes: value.bytes, comparison: value.comparison };
  } finally { await closeVerified(value); }
}
export async function ckanRefreshChangeFile({ directory, expectedSha256 } = {}) {
  let value;
  try {
    value = await openVerified(directory, expectedSha256);
    return { file: join(directory, 'changes.jsonl'), bytes: value.comparison.changes.bytes,
      sha256: value.comparison.changes.sha256, rows: value.comparison.changes.rows };
  } finally { await closeVerified(value); }
}
export async function readCkanRefreshChanges({ directory, expectedSha256, offset = 0, limit = 50 } = {}) {
  requireValue(natural(offset, MAX_ROWS) && natural(limit, MAX_PAGE_ROWS) && limit > 0,
    'CKAN_REFRESH_PAGE_INVALID', 'Select a non-negative row offset and one to 200 complete changes.');
  let value;
  try {
    value = await openVerified(directory, expectedSha256);
    const total = value.comparison.changes.rows;
    requireValue(offset <= total, 'CKAN_REFRESH_OFFSET_INVALID');
    const changes = [];
    let nextOffset = offset, resultBytes = 0;
    const result = () => ({ comparisonSha256: value.sha256, offset, limit, total,
      nextOffset: nextOffset < total ? nextOffset : null, changes });
    if (offset === total) return result();
    let row = Math.floor(offset / STRIDE) * STRIDE;
    let position = value.offsets[Math.floor(offset / STRIDE)];
    let parts = [], lineBytes = 0;
    while (position < value.comparison.changes.bytes) {
      const raw = Buffer.allocUnsafe(Math.min(CHUNK, value.comparison.changes.bytes - position));
      const part = await value.changes.handle.read(raw, 0, raw.length, position);
      requireValue(part.bytesRead > 0, 'CKAN_REFRESH_FILE_INCOMPLETE');
      position += part.bytesRead;
      let start = 0;
      while (start < part.bytesRead) {
        let end = raw.indexOf(10, start);
        if (end < 0 || end >= part.bytesRead) end = part.bytesRead;
        if (row >= offset) {
          const segment = raw.subarray(start, end);
          parts.push(segment); lineBytes += segment.length;
          if (lineBytes + resultBytes > MAX_PAGE_BYTES) {
            requireValue(changes.length > 0, 'CKAN_REFRESH_CHANGE_REQUIRES_DOWNLOAD',
              'This complete change exceeds the row-page limit. Download the original changes.jsonl file.');
            return result();
          }
        }
        if (end < part.bytesRead) {
          if (row >= offset) {
            requireValue(lineBytes > 0, 'CKAN_REFRESH_CHANGE_INVALID');
            const line = parts.length === 1 ? parts[0] : Buffer.concat(parts, lineBytes);
            const record = parseCkanJson(line);
            requireValue(record.index === row && ['added', 'removed', 'changed'].includes(record.kind) &&
              Array.isArray(record.key) && record.key.length === value.comparison.keys.length,
              'CKAN_REFRESH_CHANGE_INVALID');
            changes.push(record); resultBytes += lineBytes + 1; nextOffset = row + 1;
          }
          row++; parts = []; lineBytes = 0;
          if (changes.length === limit || nextOffset === total) return result();
        }
        start = end + 1;
      }
      await yieldTurn();
    }
    requireValue(parts.length === 0 && nextOffset === total, 'CKAN_REFRESH_FILE_INCOMPLETE');
    return result();
  } finally { await closeVerified(value); }
}
function initialProgress(inputSha256) {
  return { schema: PROGRESS_SCHEMA, inputSha256, left: 0, right: 0,
    added: 0, removed: 0, changed: 0, unchanged: 0, rows: 0,
    bytes: 0, indexBytes: 0, changesSha256: EMPTY_HASH, indexSha256: EMPTY_HASH };
}
function validateProgress(value, inputSha256, beforeRows, afterRows) {
  requireValue(value?.schema === PROGRESS_SCHEMA && value.inputSha256 === inputSha256,
    'CKAN_REFRESH_PROGRESS_CHANGED');
  for (const key of ['left', 'right', 'added', 'removed', 'changed', 'unchanged', 'rows', 'bytes', 'indexBytes'])
    requireValue(natural(value[key]), 'CKAN_REFRESH_PROGRESS_CHANGED');
  requireValue(value.left <= beforeRows && value.right <= afterRows &&
    (value.right === 0 || value.left === beforeRows) &&
    value.removed + value.changed + value.unchanged === value.left &&
    value.added <= value.right && value.rows === value.added + value.removed + value.changed &&
    value.indexBytes === Math.ceil(value.rows / STRIDE) * 8 &&
    HASH.test(value.changesSha256 ?? '') && HASH.test(value.indexSha256 ?? ''),
    'CKAN_REFRESH_PROGRESS_CHANGED');
}
async function ensureInput(directory, input) {
  const filename = join(directory, 'input.json'), expected = bytes(input);
  requireValue(expected.length <= 16384, 'CKAN_REFRESH_KEYS_INVALID');
  if (!await exists(filename)) {
    requireValue((await readdir(directory)).length === 0, 'CKAN_REFRESH_DIRECTORY_IN_USE',
      'Select the original comparison directory or a new empty private directory.');
    await createFile(filename, expected); await syncDirectory(directory); return;
  }
  const retained = await readPrivate(filename, expected.length);
  if (retained.equals(expected)) return;
  // A first input write may have ended before any data file was created. Its
  // deterministic prefix is recoverable only in that otherwise empty directory.
  requireValue(retained.length < expected.length && expected.subarray(0, retained.length).equals(retained) &&
    (await readdir(directory)).every(name => name === 'input.json'),
    'CKAN_REFRESH_INPUT_CHANGED', 'This directory belongs to a different retained comparison.');
  const file = await openPrivate(filename, true);
  try {
    await file.handle.truncate(0); await writeAll(file.handle, expected, 0); await file.handle.sync();
  } finally { await file.handle.close(); }
  await syncDirectory(directory);
}
async function indexedRows(capture, keys, signal, onProgress, phase) {
  const index = new Map();
  for (let row = 0; row < capture.rows.length; row++) {
    stopped(signal);
    const key = rowKey(capture.rows[row], keys);
    requireValue(!index.has(key.hash), 'CKAN_REFRESH_KEY_NOT_UNIQUE',
      'The selected composite key must be unique in each retained edition.');
    index.set(key.hash, row);
    if ((row + 1) % 2048 === 0) {
      await onProgress?.({ phase, rows: row + 1, total: capture.rows.length }); await yieldTurn();
    }
  }
  return index;
}
function changedFields(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().filter(key => {
    const left = Object.hasOwn(before, key), right = Object.hasOwn(after, key);
    return left !== right || typedHash(before[key]) !== typedHash(after[key]);
  });
}
export async function createCkanRefreshComparison({
  directory, before, after, keys = ['_id'], signal, onProgress,
} = {}) {
  keys = checkedKeys(keys);
  requireValue(typeof directory === 'string' && resolve(directory) === directory,
    'CKAN_REFRESH_DIRECTORY_REQUIRED');
  requireValue(onProgress === undefined || typeof onProgress === 'function', 'CKAN_REFRESH_PROGRESS_CALLBACK_INVALID');
  validateCapture(before, keys); validateCapture(after, keys);
  requireValue(before.manifest.catalogOrigin === after.manifest.catalogOrigin &&
    before.manifest.resourceId === after.manifest.resourceId, 'CKAN_COMPARE_RESOURCE_MISMATCH');
  const input = binding(before, after, keys), inputSha256 = typedHash(input);
  await privateDirectory(dirname(directory));
  await privateDirectory(directory, true);
  if (await exists(join(directory, 'comparison.json'))) {
    const complete = await readCkanRefreshComparison({ directory });
    requireValue(complete.comparison.inputSha256 === inputSha256, 'CKAN_REFRESH_INPUT_CHANGED');
    return complete;
  }
  stopped(signal);
  const leftIndex = await indexedRows(before, keys, signal, onProgress, 'index-before');
  const rightIndex = await indexedRows(after, keys, signal, onProgress, 'index-after');
  await ensureInput(directory, input);
  let progress = await exists(join(directory, 'progress.json'))
    ? parseCkanJson(await readPrivate(join(directory, 'progress.json'), 65536))
    : initialProgress(inputSha256);
  validateProgress(progress, inputSha256, before.rows.length, after.rows.length);
  let changes, index, changeHash, indexHash, checkpointReady = false;
  let checkpointRows = progress.left + progress.right, checkpointBytes = progress.bytes;
  const counts = () => ({ added: progress.added, removed: progress.removed,
    changed: progress.changed, unchanged: progress.unchanged });
  const checkpoint = async () => {
    await changes.handle.sync(); await index.handle.sync();
    progress.changesSha256 = changeHash.copy().digest('hex');
    progress.indexSha256 = indexHash.copy().digest('hex');
    await atomicJson(directory, 'progress.json', progress);
    checkpointRows = progress.left + progress.right; checkpointBytes = progress.bytes;
    await onProgress?.({ phase: 'compare', processed: checkpointRows,
      total: before.rows.length + after.rows.length, changes: progress.rows, ...counts() });
  };
  const emit = async (kind, beforeRow, afterRow) => {
    const key = rowKey(afterRow ?? beforeRow, keys).values;
    const record = { index: progress.rows, kind, key,
      ...(beforeRow ? { before: beforeRow } : {}), ...(afterRow ? { after: afterRow } : {}),
      ...(kind === 'changed' ? { changedFields: changedFields(beforeRow, afterRow) } : {}) };
    const raw = Buffer.from(JSON.stringify(record) + '\n');
    requireValue(natural(progress.bytes + raw.length), 'CKAN_REFRESH_FILE_TOO_LARGE');
    let seek = null;
    if (progress.rows % STRIDE === 0) {
      seek = Buffer.alloc(8); seek.writeBigUInt64BE(BigInt(progress.bytes));
      await writeAll(index.handle, seek, progress.indexBytes);
    }
    await writeAll(changes.handle, raw, progress.bytes);
    // Commit counters and incremental hashes only after both complete writes.
    if (seek) { indexHash.update(seek); progress.indexBytes += seek.length; }
    changeHash.update(raw); progress.bytes += raw.length; progress.rows++;
  };
  try {
    changes = await openPrivate(join(directory, 'changes.jsonl'), true, true);
    index = await openPrivate(join(directory, 'changes.idx'), true, true);
    requireValue(Number(changes.info.size) >= progress.bytes && Number(index.info.size) >= progress.indexBytes,
      'CKAN_REFRESH_FILE_INCOMPLETE');
    changeHash = await hashPrefix(changes.handle, progress.bytes);
    indexHash = await hashPrefix(index.handle, progress.indexBytes);
    requireValue(changeHash.copy().digest('hex') === progress.changesSha256 &&
      indexHash.copy().digest('hex') === progress.indexSha256, 'CKAN_REFRESH_CHECKPOINT_CHANGED');
    await stable(changes.handle, changes.info); await stable(index.handle, index.info);
    await changes.handle.truncate(progress.bytes); await index.handle.truncate(progress.indexBytes);
    checkpointReady = true;
    for (const [key, row] of leftIndex) {
      if (row < progress.left) { rightIndex.delete(key); continue; }
      stopped(signal);
      const beforeRow = before.rows[row], afterRow = rightIndex.has(key) ? after.rows[rightIndex.get(key)] : null;
      if (afterRow === null) { await emit('removed', beforeRow, null); progress.removed++; }
      else if (typedHash(beforeRow) !== typedHash(afterRow)) {
        await emit('changed', beforeRow, afterRow); progress.changed++;
      } else progress.unchanged++;
      rightIndex.delete(key); progress.left = row + 1;
      if (progress.left + progress.right - checkpointRows >= 4096 || progress.bytes - checkpointBytes >= 8 * 1024 * 1024)
        await checkpoint();
      if (progress.left % 256 === 0) await yieldTurn();
    }
    leftIndex.clear();
    for (let row = progress.right; row < after.rows.length; row++) {
      stopped(signal);
      const afterRow = after.rows[row], key = rowKey(afterRow, keys).hash;
      if (rightIndex.has(key)) { await emit('added', null, afterRow); progress.added++; }
      progress.right = row + 1;
      if (progress.left + progress.right - checkpointRows >= 4096 || progress.bytes - checkpointBytes >= 8 * 1024 * 1024)
        await checkpoint();
      if (progress.right % 256 === 0) await yieldTurn();
    }
    validateProgress(progress, inputSha256, before.rows.length, after.rows.length);
    requireValue(progress.left === before.rows.length && progress.right === after.rows.length &&
      after.rows.length === progress.added + progress.changed + progress.unchanged,
      'CKAN_REFRESH_COUNTS_INVALID');
    await checkpoint(); stopped(signal);
    const beforeDescription = captureDescription(before), afterDescription = captureDescription(after);
    const selectionKnown = beforeDescription.selection.filters !== null && afterDescription.selection.filters !== null &&
      beforeDescription.selection.q !== null && afterDescription.selection.q !== null;
    const selectionChanged = !selectionKnown ||
      typedHash(selectionScope(beforeDescription.selection)) !== typedHash(selectionScope(afterDescription.selection));
    const comparison = {
      schema: CKAN_REFRESH_COMPARISON_SCHEMA, algorithm: 1, inputSha256, keys,
      before: beforeDescription, after: afterDescription, ...counts(), selectionChanged,
      selectionStatus: !selectionKnown ? 'UNKNOWN' : selectionChanged ? 'CHANGED' : 'SAME',
      scope: 'retained-selections',
      interpretation: selectionChanged
        ? 'Added and removed records are differences between the two retained selections. Changed filters or query windows do not establish source-wide additions or deletions.'
        : 'Added and removed records describe the same retained query selection across two sequential captures.',
      requestConfigurationChanged: typedHash(beforeDescription.selection) !== typedHash(afterDescription.selection),
      fieldsChanged: typedHash(before.fields) !== typedHash(after.fields),
      fields: { before: before.fields, after: after.fields },
      semanticChanges: compareCkanSemantics(before, after),
      sourceTermsChanged: typedHash(sourceTerms(before)) !== typedHash(sourceTerms(after)),
      sourceTerms: { before: sourceTerms(before), after: sourceTerms(after) },
      sourceChanges: { package: metadataChanges(packageMetadata(before), packageMetadata(after)),
        resource: metadataChanges(before.resource, after.resource) },
      changes: { file: 'changes.jsonl', bytes: progress.bytes, sha256: progress.changesSha256, rows: progress.rows },
      index: { file: 'changes.idx', bytes: progress.indexBytes, sha256: progress.indexSha256,
        stride: STRIDE, entries: Math.ceil(progress.rows / STRIDE), encoding: 'uint64-be' },
    };
    validateComparison(comparison);
    requireValue(bytes(comparison).length <= MAX_DESCRIPTOR, 'CKAN_REFRESH_METADATA_TOO_LARGE',
      'The complete source-change descriptor exceeds 32 MiB.');
    await atomicJson(directory, 'comparison.json', comparison);
  } catch (error) {
    // A partial trailing write is beyond the saved byte/count prefix. The next
    // same-input call verifies that prefix before removing only its unfinished tail.
    if (checkpointReady) await checkpoint().catch(() => {});
    throw error;
  } finally {
    leftIndex.clear(); rightIndex.clear();
    await changes?.handle.close(); await index?.handle.close();
  }
  return readCkanRefreshComparison({ directory });
}
