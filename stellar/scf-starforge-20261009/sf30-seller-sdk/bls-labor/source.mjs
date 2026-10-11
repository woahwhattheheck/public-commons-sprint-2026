// MIT. Retained BLS sources through the original source-dataset publisher.
import { constants } from 'node:fs';
import { readFileSync } from 'node:fs';
import { realpath, open } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { digest, identity, readPrivate, hashPrivate, fault, object } from '../postgres/publisher/files.mjs';

export const CONTRACT = JSON.parse(readFileSync(new URL('./contract.json', import.meta.url), 'utf8'));
export const CAPTURE_SCHEMA = CONTRACT.capture_schema;
export const SOURCE_SCHEMA = CONTRACT.source_schema;
export const MANIFEST_PATH = CONTRACT.manifest_path;
export const CHUNK_BYTES = CONTRACT.chunk_bytes;
export const BLS_COLUMNS = Object.freeze(Object.fromEntries(Object.entries(CONTRACT.projections).map(([key, value]) =>
  [key, Object.freeze(value.columns)])));
const HASH = /^[a-f0-9]{64}$/;
const MAX_TOTAL = CONTRACT.limits.max_capture_bytes;
const PROGRAM = fileURLToPath(new URL('./project.py', import.meta.url));
const fail = (code, message) => { throw fault(code, message); };
const same = (a, b) => identity(a) === identity(b);
const exact = (value, keys) => object(value) && same(Object.keys(value).sort(), [...keys].sort());
function json(data) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); }
  catch { fail('BLS_JSON_INVALID'); }
}
export function safeMember(value, allowManifest = false) {
  if (typeof value !== 'string' || !value || value.length > 600 || /[\\:\x00-\x1f\x7f]/.test(value) ||
      value.split('/').some(part => ['', '.', '..'].includes(part)) ||
      value.startsWith('_bls/') && !(allowManifest && value === MANIFEST_PATH)) fail('BLS_MEMBER_PATH_INVALID');
  return value;
}
function officialURL(value) {
  let url;
  try { url = new URL(value); } catch { fail('BLS_SOURCE_URL_INVALID'); }
  if (url.protocol !== 'https:' || !['download.bls.gov', 'data.bls.gov', 'www.bls.gov'].includes(url.hostname) ||
      url.username || url.password || url.port || url.hash || url.search) fail('BLS_SOURCE_URL_INVALID');
  return value;
}
function selected(values, pattern) {
  return Array.isArray(values) && values.length > 0 && values.length <= 10000 &&
    new Set(values).size === values.length && values.every(value => pattern(value));
}
function checkManifest(value) {
  if (!object(value) || value.schema !== CAPTURE_SCHEMA || typeof value.source_prefix !== 'string' ||
      value.source_prefix && !value.source_prefix.endsWith('/')) fail('BLS_CAPTURE_INVALID');
  if (value.source_prefix) safeMember(value.source_prefix.slice(0, -1));
  const selection = value.selection;
  if (!object(selection) || !selected(selection.counties, value => typeof value === 'string' && /^[0-9]{5}$/.test(value)) ||
      !object(selection.laus) || !object(selection.qcew)) fail('BLS_SELECTION_INVALID');
  const l = selection.laus, q = selection.qcew;
  if (!selected(l.years, value => Number.isSafeInteger(value) && value >= 1900 && value <= 2200) ||
      !selected(l.periods, value => typeof value === 'string' && /^M(0[1-9]|1[0-3])$/.test(value)) ||
      !selected(l.measures, value => ['03', '04', '05', '06'].includes(value)) ||
      !selected(l.seasonal, value => ['S', 'U'].includes(value)) ||
      !Array.isArray(q.periods) || !q.periods.length || new Set(q.periods.map(identity)).size !== q.periods.length ||
      q.periods.some(value => !exact(value, ['year', 'quarter']) || !Number.isSafeInteger(value.year) ||
        value.year < 1975 || value.year > 2200 || !Number.isSafeInteger(value.quarter) || value.quarter < 1 || value.quarter > 4) ||
      !selected(q.ownership_codes, value => typeof value === 'string' && /^[0-9]+$/.test(value)) ||
      !selected(q.industry_codes, value => typeof value === 'string' && /^[A-Za-z0-9-]+$/.test(value)) ||
      !selected(q.size_codes, value => typeof value === 'string' && /^[0-9]+$/.test(value)) ||
      !selected(q.metrics, value => CONTRACT.selection.qcew.metrics.includes(value))) fail('BLS_SELECTION_INVALID');
  if (!Array.isArray(value.files) || !value.files.length || value.files.length > CONTRACT.limits.max_files ||
      new Set(value.files.map(file => file.path)).size !== value.files.length) fail('BLS_FILE_INVENTORY_INVALID');
  let total = 0;
  const files = new Map();
  for (const file of value.files) {
    if (!exact(file, ['path', 'bytes', 'sha256']) || !HASH.test(file.sha256) ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > CONTRACT.limits.max_source_file_bytes)
      fail('BLS_FILE_INVENTORY_INVALID');
    safeMember(file.path); total += file.bytes; files.set(file.path, file);
  }
  if (total > MAX_TOTAL) fail('BLS_CAPTURE_TOO_LARGE');
  if (!Array.isArray(value.sources) || !value.sources.length) fail('BLS_SOURCES_REQUIRED');
  const roles = ['laus-data', 'laus-area', 'laus-series', 'laus-measure', 'laus-footnote', 'qcew-data'];
  if (new Set(value.sources.map(source => source.path)).size !== value.sources.length) fail('BLS_SOURCE_DUPLICATE');
  for (const source of value.sources) {
    if (!object(source) || !roles.includes(source.role) || !files.has(source.path) ||
        !files.has(source.receipt_path) || typeof source.retrieved_at !== 'string' || !source.retrieved_at)
      fail('BLS_SOURCE_MEMBER_MISSING');
    safeMember(source.path); safeMember(source.receipt_path); officialURL(source.url);
  }
  if (roles.some(role => !value.sources.some(source => source.role === role))) fail('BLS_SOURCE_ROLE_MISSING');
  if (value.catalog_keys !== undefined && !selected(value.catalog_keys, key => typeof key === 'string' && /^[a-z0-9-]+$/.test(key)))
    fail('BLS_CATALOG_KEYS_INVALID');
  return value;
}
async function memberPath(root, name) {
  safeMember(name, true);
  const path = join(root, name);
  if (await realpath(path) !== path) fail('BLS_MEMBER_SYMLINK');
  return path;
}

/** Every source is a retained local inventory. HTTP cannot choose an executable,
 * local path, credentials, or an uncaptured remote data response. */
export async function readBlsSource(sourceFile, { verifyFiles = true } = {}) {
  sourceFile = resolve(sourceFile);
  const original = await readPrivate(sourceFile, 262144), declaration = json(original);
  if (!exact(declaration, ['schema', 'capture', 'captureSha256']) || declaration.schema !== SOURCE_SCHEMA ||
      typeof declaration.capture !== 'string' || !declaration.capture.endsWith(MANIFEST_PATH) ||
      !HASH.test(declaration.captureSha256)) fail('BLS_SOURCE_INVALID');
  const prefix = declaration.capture.slice(0, -MANIFEST_PATH.length);
  if (prefix && !prefix.endsWith('/')) fail('BLS_CAPTURE_PATH_INVALID');
  if (prefix) safeMember(prefix.slice(0, -1));
  const root = resolve(dirname(sourceFile), prefix || '.');
  if (await realpath(root) !== root) fail('BLS_SOURCE_DIRECTORY_SYMLINK');
  const manifestBytes = await readPrivate(await memberPath(root, MANIFEST_PATH), CONTRACT.limits.max_manifest_bytes);
  if (digest(manifestBytes) !== declaration.captureSha256) fail('BLS_CAPTURE_MANIFEST_CHANGED');
  const manifest = checkManifest(json(manifestBytes)), files = new Map(manifest.files.map(file => [file.path, file]));
  async function read(path) {
    if (path === MANIFEST_PATH) return Buffer.from(manifestBytes);
    const expected = files.get(path);
    if (!expected) fail('BLS_UNDECLARED_SOURCE_MEMBER');
    const data = await readPrivate(await memberPath(root, path), CONTRACT.limits.max_source_file_bytes);
    if (data.length !== expected.bytes || digest(data) !== expected.sha256) fail('BLS_SOURCE_FILE_CHANGED');
    return data;
  }
  async function verify() {
    for (const expected of manifest.files) {
      const actual = await hashPrivate(await memberPath(root, expected.path), CONTRACT.limits.max_source_file_bytes);
      if (actual.hash !== expected.sha256 || actual.bytes !== expected.bytes) fail('BLS_SOURCE_FILE_CHANGED');
    }
  }
  if (verifyFiles) await verify();
  for (const source of manifest.sources) {
    const receipt = json(await read(source.receipt_path)), file = files.get(source.path);
    if (receipt.status !== 200 || receipt.url !== source.url || (receipt.final_url ?? receipt.url) !== source.url ||
        receipt.sha256 !== file.sha256 || receipt.bytes !== file.bytes ||
        receipt.retrieved_at !== source.retrieved_at) fail('BLS_SOURCE_RECEIPT_CHANGED');
  }
  async function copy(path, destination) {
    if (path === MANIFEST_PATH) {
      const target = await open(destination, 'wx', 0o600);
      try { await target.writeFile(manifestBytes); await target.sync(); } finally { await target.close(); }
      return;
    }
    const expected = files.get(path);
    if (!expected) fail('BLS_UNDECLARED_SOURCE_MEMBER');
    const source = await open(await memberPath(root, path), constants.O_RDONLY | constants.O_NOFOLLOW);
    let target;
    try {
      const before = await source.stat();
      if (!before.isFile() || before.nlink !== 1 || before.mode & 0o077 || before.size !== expected.bytes)
        fail('BLS_SOURCE_FILE_CHANGED');
      target = await open(destination, 'wx', 0o600);
      const hash = createHash('sha256'); let count = 0;
      for await (const chunk of source.createReadStream({ autoClose: false, highWaterMark: 65536 })) {
        count += chunk.length;
        if (count > expected.bytes) fail('BLS_SOURCE_FILE_CHANGED');
        hash.update(chunk); await target.writeFile(chunk);
      }
      const after = await source.stat();
      if (count !== expected.bytes || hash.digest('hex') !== expected.sha256 ||
          after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
        fail('BLS_SOURCE_FILE_CHANGED');
      await target.sync();
    } finally { await target?.close(); await source.close(); }
  }
  return { sourceFile, original, declaration, root, manifest, manifestBytes, files,
    hash: digest(original), captureHash: declaration.captureSha256, read, verify, copy };
}
export const columnTypes = query => {
  if (!Object.hasOwn(BLS_COLUMNS, query)) fail('BLS_QUERY_NOT_FOUND');
  return Object.entries(BLS_COLUMNS[query]).map(([name, spec]) => ({ name, ...spec }));
};
export function queryDefinitions(capture) {
  return Object.fromEntries(Object.keys(BLS_COLUMNS).map(query => [query, {
    serviceQuery: { protocol: 'BLS retained LAUS and QCEW', projection: query,
      selection: capture.manifest.selection, selectionHash: identity(capture.manifest.selection),
      sourceHash: capture.captureHash, contractHash: identity(CONTRACT) },
    columns: Object.keys(BLS_COLUMNS[query]), columnTypes: columnTypes(query), parameters: {},
  }]));
}
export async function inspectBlsPublicationSource(sourceFile) {
  const capture = await readBlsSource(sourceFile);
  return { hash: capture.hash, bytes: capture.original.length, captureHash: capture.captureHash,
    queries: queryDefinitions(capture) };
}
export function extractionOptions(query, supplied = {}) {
  if (!Object.hasOwn(BLS_COLUMNS, query) || !object(supplied) ||
      Object.keys(supplied).some(key => !['maxRows', 'maxBytes', 'maxRowBytes', 'timeoutMs', 'order'].includes(key)))
    fail('BLS_EXTRACTION_OPTIONS_INVALID');
  const limits = { maxRows: supplied.maxRows ?? 250000, maxBytes: supplied.maxBytes ?? 134217728,
    maxRowBytes: supplied.maxRowBytes ?? 1048576, timeoutMs: supplied.timeoutMs ?? 300000 };
  for (const [key, maximum] of [['maxRows', 1000000], ['maxBytes', 268435456],
    ['maxRowBytes', 4194304], ['timeoutMs', 3600000]])
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > maximum) fail('BLS_EXTRACTION_LIMIT_INVALID');
  const first = Object.keys(BLS_COLUMNS[query])[0], order = supplied.order ?? [{ column: first, direction: 'asc' }];
  if (!Array.isArray(order) || order.length !== 1 || order[0].column !== first || order[0].direction !== 'asc')
    fail('BLS_SOURCE_ORDER_REQUIRED', 'Keep the displayed source order and select published dataset sort columns for customer queries.');
  return { ...limits, order };
}
function validateRow(row, columns) {
  if (!exact(row, Object.keys(columns))) fail('BLS_PROJECTOR_ROW_INVALID');
  for (const [name, spec] of Object.entries(columns)) {
    const value = row[name];
    if (value === null) { if (!spec.nullable) fail('BLS_PROJECTOR_NULL_INVALID'); continue; }
    if (spec.type === 'string' && typeof value !== 'string' ||
        spec.type === 'integer' && !Number.isSafeInteger(value) ||
        spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) fail('BLS_PROJECTOR_TYPE_INVALID');
  }
}
export async function openBlsSourceFile(sourceFile, environment = process.env) {
  const capture = await readBlsSource(sourceFile);
  let closed = false, active = null;
  const source = Object.freeze({
    inspect: () => ({ columnTypes: Object.fromEntries(Object.keys(BLS_COLUMNS).map(query => [query, columnTypes(query)])) }),
    async exportDataset(query, input = {}, options = {}) {
      if (closed) fail('BLS_SOURCE_CLOSED');
      if (active) fail('BLS_EXTRACTION_ALREADY_ACTIVE');
      if (!exact(input, [])) fail('BLS_SELECTION_IS_CAPTURED');
      const limits = extractionOptions(query, Object.fromEntries(Object.entries(options).filter(([key]) => !['signal', 'onRow'].includes(key))));
      if (typeof options.onRow !== 'function') fail('BLS_ROW_CONSUMER_REQUIRED');
      if (options.signal?.aborted) fail('BLS_EXTRACTION_CANCELLED');
      const child = spawn('python3', [PROGRAM, '--source', capture.sourceFile, '--query', query], {
        shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { ...environment, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' },
      });
      active = child;
      let failure = null, stderr = '', done = null, rowCount = 0, sourceRowBytes = 0, pending = Buffer.alloc(0);
      const stop = code => { failure ??= fault(code); originalKill(); };
      const abort = () => stop('BLS_EXTRACTION_CANCELLED');
      const timer = setTimeout(() => stop('BLS_EXTRACTION_TIMEOUT'), limits.timeoutMs);
      let killTimer = null;
      child.once('exit', () => { if (killTimer) clearTimeout(killTimer); });
      const originalKill = () => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGTERM'); killTimer ??= setTimeout(() => child.kill('SIGKILL'), 2000);
        }
      };
      const exited = new Promise(resolveExit => {
        child.once('error', issue => { failure ??= fault('BLS_PROJECTOR_UNAVAILABLE', issue.code ?? 'Python 3 is required.'); resolveExit({ code: null }); });
        child.once('close', (code, signal) => resolveExit({ code, signal }));
      });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-8192); });
      options.signal?.addEventListener('abort', abort, { once: true });
      const consume = async line => {
        if (failure) throw failure;
        if (closed || options.signal?.aborted) fail('BLS_EXTRACTION_CANCELLED');
        if (!line.length || line.length > limits.maxRowBytes + 4096) fail('BLS_PROJECTOR_LINE_INVALID');
        const value = json(line);
        if (done) fail('BLS_PROJECTOR_OUTPUT_AFTER_COMPLETE');
        if (value.kind === 'complete') {
          if (!object(value.result)) fail('BLS_PROJECTOR_RESULT_INVALID');
          done = value.result; return;
        }
        if (value.kind !== 'row' || !exact(value, ['kind', 'row'])) fail('BLS_PROJECTOR_ROW_INVALID');
        validateRow(value.row, BLS_COLUMNS[query]);
        const size = Buffer.byteLength(JSON.stringify(value.row));
        sourceRowBytes += size;
        if (size > limits.maxRowBytes) fail('BLS_ROW_TOO_LARGE');
        if (sourceRowBytes > limits.maxBytes) fail('BLS_PROJECTED_SOURCE_TOO_LARGE');
        if (++rowCount > limits.maxRows) fail('DATASET_EXTRACTION_TOO_MANY_ROWS');
        await options.onRow(value.row, columnTypes(query), { rowCount });
      };
      try {
        for await (const chunk of child.stdout) {
          pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
          let index;
          while ((index = pending.indexOf(10)) >= 0) {
            const line = pending.subarray(0, index); pending = pending.subarray(index + 1);
            await consume(line);
          }
          if (pending.length > limits.maxRowBytes + 4096) fail('BLS_PROJECTOR_LINE_TOO_LARGE');
        }
        if (pending.length) fail('BLS_PROJECTOR_FINAL_NEWLINE_REQUIRED');
        const exit = await exited;
        if (failure) throw failure;
        if (exit.code !== 0) {
          const code = stderr.match(/\bBLS_[A-Z0-9_]{1,70}\b/)?.[0] ?? 'BLS_PROJECTOR_FAILED';
          fail(code);
        }
        if (done?.schema !== CONTRACT.extraction_schema || done.projection !== query || done.captureHash !== capture.captureHash ||
            done.sourceHash !== capture.hash || done.rowCount !== rowCount || done.completeSelection !== true ||
            done.sourceVerified !== true || done.rawValuesPreserved !== true) fail('BLS_PROJECTOR_RESULT_INVALID');
        const after = await readBlsSource(sourceFile);
        if (after.captureHash !== capture.captureHash || after.hash !== capture.hash) fail('BLS_SOURCE_CHANGED_DURING_EXTRACTION');
        return { ...done, sourceRowBytes, sourceFiles: capture.manifest.files.length, columnTypes: columnTypes(query) };
      } finally {
        clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
        originalKill(); await exited; if (killTimer) clearTimeout(killTimer); active = null;
      }
    },
    async close() { closed = true; active?.kill('SIGTERM'); },
  });
  return { source, config: capture.declaration };
}
