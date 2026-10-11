import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { createGzip, gzip as gzipCallback, gunzip as gunzipCallback } from 'node:zlib';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';

const gzip = promisify(gzipCallback), gunzip = promisify(gunzipCallback);

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export const now = () => new Date().toISOString();
export function fault(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const fingerprint = value => sha256(JSON.stringify(canonical(value)));
export function integer(value, name, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) {
    throw fault('INVALID_INTEGER', `${name} must be an integer from ${min} to ${max}`);
  }
  return Number(value);
}
export function sourceJson(bytes) {
  // Source numeric tokens remain text: Oracle NUMBER and ArcGIS 64-bit IDs must
  // not pass through an IEEE-754 round trip before CSV/JSONL projection.
  return JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString('utf8') : bytes, (key, value, context) => {
    if (typeof value !== 'number') return value;
    if (!context?.source) throw fault('JSON_SOURCE_CONTEXT_REQUIRED', 'Use Node 22+ with JSON.parse source context support');
    return context.source;
  });
}
export function fileInside(directory, relative) {
  const base = path.resolve(directory), result = path.resolve(base, relative);
  if (!relative || path.isAbsolute(relative) || result === base || !result.startsWith(base + path.sep)) {
    throw fault('INVALID_CAPTURE_PATH', 'Capture member must be a relative file path');
  }
  return result;
}
export async function atomicWrite(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomUUID()}.partial`;
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}
export const writeJson = (file, value) => atomicWrite(file, jsonBytes(value));
export async function readJson(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
export async function maybeJson(file) {
  try { return await readJson(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function withCaptureLock(directory, operation) {
  if (!path.isAbsolute(directory)) throw fault('ABSOLUTE_DIRECTORY_REQUIRED', 'Capture directory must be absolute');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, '.capture-lock.json');
  let handle;
  try { handle = await fs.open(lock, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw fault('CAPTURE_BUSY', 'Capture has an existing writer; use recoverCaptureLock after its process exits'); throw error; }
  await handle.writeFile(jsonBytes({ pid: process.pid, hostname: os.hostname(), startedAt: now() }));
  await handle.close();
  try { return await operation(); } finally { await fs.rm(lock, { force: true }); }
}
export async function recoverCaptureLock(directory) {
  const lock = path.join(directory, '.capture-lock.json'), owner = await maybeJson(lock);
  if (!owner) return { recovered: false };
  if (owner.hostname !== os.hostname()) throw fault('CAPTURE_OWNER_HOST', 'Recover this capture on its original host');
  try { process.kill(integer(owner.pid, 'writer PID', 1), 0); throw fault('CAPTURE_BUSY', 'The capture writer is still running'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
  await fs.rm(lock);
  return { recovered: true, previousOwner: owner };
}
export function sourceUrl(input, approvedOrigin) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw fault('INVALID_SOURCE_URL', 'Source URL must be HTTPS without credentials or fragment');
  if (approvedOrigin && url.origin !== new URL(approvedOrigin).origin) throw fault('SOURCE_ORIGIN_MISMATCH', 'Source does not match the configured approved origin');
  return url;
}
export async function fetchSource(url, { signal, fetchImpl = fetch, headers = {}, maxBytes = 32 * 1024 * 1024, timeoutMs = 30000 } = {}) {
  signal?.throwIfAborted();
  const startedAt = now();
  const response = await fetchImpl(url, {
    method: 'GET', redirect: 'error', headers,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
  });
  const chunks = []; let length = 0;
  for await (const chunk of response.body ?? []) {
    length += chunk.length;
    if (length > maxBytes) throw fault('SOURCE_RESPONSE_TOO_LARGE', `Source response exceeds ${maxBytes} bytes`, { status: response.status });
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const receipt = {
    url: String(url), status: response.status, startedAt, retrievedAt: now(), bytes: length,
    sha256: sha256(bytes), contentType: response.headers.get('content-type'),
    etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified')
  };
  return { bytes, receipt, ok: response.ok };
}
export async function retainSource(directory, name, response) {
  let stored = response.bytes, encoding;
  if (stored.length > 64 * 1024) { stored = await gzip(stored); name += '.gz'; encoding = 'gzip'; }
  await atomicWrite(fileInside(directory, name), stored);
  await writeJson(fileInside(directory, name + '.receipt.json'), { ...response.receipt, storageEncoding: encoding || 'identity', storedBytes: stored.length });
  if (!response.ok) throw fault('SOURCE_HTTP_ERROR', `Source returned HTTP ${response.receipt.status}`, { receiptFile: name + '.receipt.json' });
  const body = sourceJson(response.bytes);
  if (body.error) throw fault('SOURCE_APPLICATION_ERROR', body.error.message || 'Source reported an application error', { receiptFile: name + '.receipt.json', sourceCode: body.error.code });
  return { body, receipt: response.receipt, file: name, encoding };
}
export async function readVerifiedSource(directory, record) {
  let bytes = await fs.readFile(fileInside(directory, record.file));
  if (record.encoding === 'gzip' || record.file.endsWith('.gz')) bytes = await gunzip(bytes);
  if (sha256(bytes) !== record.sha256) throw fault('CAPTURE_HASH_MISMATCH', `Retained source changed: ${record.file}`);
  return sourceJson(bytes);
}
export function csvCell(value) {
  if (value === null || value === undefined) return '""';
  if (typeof value === 'object') throw fault('NON_SCALAR_CSV_VALUE', 'CSV projection requires scalar fields');
  return '"' + String(value).replaceAll('"', '""') + '"';
}
export async function writeProjection({ directory, columns, rows, csvFile = 'records.csv', jsonlFile = 'records.jsonl.gz' }) {
  if (!jsonlFile.endsWith('.gz')) throw fault('JSONL_GZIP_REQUIRED', 'The retained JSONL projection must use a .gz filename');
  const csvPath = fileInside(directory, csvFile), jsonlPath = fileInside(directory, jsonlFile);
  const suffix = `.${process.pid}.${randomUUID()}.partial`;
  const csvTemp = csvPath + suffix, jsonlTemp = jsonlPath + suffix;
  await fs.mkdir(path.dirname(csvPath), { recursive: true, mode: 0o700 });
  await fs.mkdir(path.dirname(jsonlPath), { recursive: true, mode: 0o700 });
  const csv = await fs.open(csvTemp, 'wx', 0o600), jsonl = createGzip();
  const csvHash = createHash('sha256'), jsonlHash = createHash('sha256'), storedHash = createHash('sha256');
  jsonl.on('data', chunk => storedHash.update(chunk));
  let jsonlError;
  const finished = pipeline(jsonl, createWriteStream(jsonlTemp, { flags: 'wx', mode: 0o600 })).catch(error => { jsonlError = error; });
  let count = 0;
  const write = async (handle, hash, value) => { const bytes = Buffer.from(value); hash.update(bytes); await handle.writeFile(bytes); };
  try {
    await write(csv, csvHash, columns.map(csvCell).join(',') + '\r\n');
    for await (const row of rows) {
      await write(csv, csvHash, columns.map(name => csvCell(row.record[name])).join(',') + '\r\n');
      const line = Buffer.from(JSON.stringify(row) + '\n'); jsonlHash.update(line);
      if (jsonlError) throw jsonlError;
      await new Promise((resolve, reject) => jsonl.write(line, error => error ? reject(error) : resolve()));
      count++;
    }
    await csv.sync(); await csv.close(); jsonl.end(); await finished;
    if (jsonlError) throw jsonlError;
    const jsonlHandle = await fs.open(jsonlTemp, 'r'); try { await jsonlHandle.sync(); } finally { await jsonlHandle.close(); }
    await fs.rename(csvTemp, csvPath); await fs.rename(jsonlTemp, jsonlPath);
  } catch (error) {
    await csv.close().catch(() => {}); jsonl.destroy(); await finished;
    await fs.rm(csvTemp, { force: true }); await fs.rm(jsonlTemp, { force: true }); throw error;
  }
  return {
    records: count, columns,
    csv: { file: csvFile, sha256: csvHash.digest('hex') },
    jsonl: { file: jsonlFile, sha256: storedHash.digest('hex'), uncompressedSha256: jsonlHash.digest('hex'), encoding: 'gzip' },
    numericRepresentation: 'Original JSON number lexemes are strings; no floating-point conversion.',
    nullRepresentation: 'JSONL retains null; CSV uses an empty field for null.'
  };
}
export async function reopenCapture(directory, { verify = true } = {}) {
  const manifest = await readJson(path.join(directory, 'capture.json'));
  if (verify) {
    for (const entry of [manifest.metadata, manifest.ids, ...manifest.pages, ...(manifest.finalSources || [])].filter(Boolean)) await readVerifiedSource(directory, entry);
    for (const entry of [manifest.projection?.csv, manifest.projection?.jsonl].filter(Boolean)) {
      if (sha256(await fs.readFile(fileInside(directory, entry.file))) !== entry.sha256) throw fault('CAPTURE_HASH_MISMATCH', `Projection changed: ${entry.file}`);
    }
  }
  return manifest;
}
