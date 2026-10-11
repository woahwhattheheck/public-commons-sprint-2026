// MIT. Complete read-only Sheet Best responses and exact private retained bytes.
import { dirname, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { object, bytes, digest, readPrivate, createFile, privateDirectory, syncDirectory, fault, stamp } from '../postgres/publisher/files.mjs';
import { MAX_CAPTURE_BYTES, HASH, binding, integer, only } from './declaration.mjs';

const SAFE_HEADERS = ['content-type', 'date', 'etag', 'last-modified', 'x-sheet-rows', 'x-sheet-columns',
  'x-ratelimit-limit', 'x-ratelimit-plan', 'x-ratelimit-remaining'];
const decode = buffer => {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); }
  catch { throw fault('SHEETBEST_RECORDS_JSON_INVALID'); }
};
export function recordsFromBytes(buffer) {
  const records = decode(buffer);
  if (!Array.isArray(records) || records.length > 1000000) throw fault('SHEETBEST_RECORDS_ARRAY_REQUIRED');
  for (const row of records) {
    if (!object(row) || Object.keys(row).length > 10000) throw fault('SHEETBEST_RECORD_INVALID');
    if (Object.values(row).some(value => value !== null &&
        !['string', 'number', 'boolean'].includes(typeof value))) throw fault('SHEETBEST_SCALAR_RECORDS_REQUIRED');
  }
  return records;
}
function headers(value = {}) {
  only(value, SAFE_HEADERS, 'SHEETBEST_CAPTURE_HEADERS_INVALID');
  return Object.fromEntries(Object.entries(value).map(([name, text]) => {
    if (typeof text !== 'string' || text.length > 1024 || /[\r\n\0]/.test(text)) throw fault('SHEETBEST_CAPTURE_HEADER_INVALID');
    return [name, text];
  }));
}
export async function retainSheetBestCapture(resourceBytes, directory, supplied) {
  only(supplied, ['connectionId', 'tab', 'valueMode', 'transport', 'receivedAt', 'headers'], 'SHEETBEST_CAPTURE_INPUT_INVALID');
  const selected = binding(supplied), transport = supplied.transport ?? 'operator-import', receivedAt = supplied.receivedAt ?? stamp();
  if (!Buffer.isBuffer(resourceBytes) || !resourceBytes.length || resourceBytes.length > MAX_CAPTURE_BYTES ||
      !['sheetbest-rest', 'operator-import'].includes(transport) || typeof receivedAt !== 'string' || !Number.isFinite(Date.parse(receivedAt)))
    throw fault('SHEETBEST_CAPTURE_INPUT_INVALID');
  const records = recordsFromBytes(resourceBytes), safeHeaders = headers(supplied.headers);
  await privateDirectory(dirname(directory));
  await mkdir(directory, { mode: 0o700 });
  await privateDirectory(directory);
  const manifest = { schema: 'stellar-forge.sheetbest-capture.v1', provider: 'sheetbest',
    method: transport === 'sheetbest-rest' ? 'GET' : 'IMPORT',
    readOnly: true, responseKind: 'SINGLE_RECORDS_RESPONSE', format: 'records', ...selected, transport, receivedAt,
    headers: safeHeaders, resourceFile: 'records.json', rowCount: records.length,
    sourceSha256: digest(resourceBytes), sourceBytes: resourceBytes.length };
  await createFile(join(directory, 'records.json'), resourceBytes);
  const manifestBytes = bytes(manifest);
  await createFile(join(directory, 'capture.json'), manifestBytes);
  await syncDirectory(directory); await syncDirectory(dirname(directory));
  return { manifest, manifestBytes, manifestFile: join(directory, 'capture.json'), manifestSha256: digest(manifestBytes), resourceBytes, records };
}
export async function importSheetBestCapture(resourceFile, directory, selectedBinding) {
  return retainSheetBestCapture(await readPrivate(resourceFile, MAX_CAPTURE_BYTES), directory,
    { ...binding(selectedBinding), transport: 'operator-import' });
}
export async function readSheetBestCapture(filename, expectedHash) {
  const manifestBytes = await readPrivate(filename, 16384), manifest = decode(manifestBytes);
  if (expectedHash !== undefined && digest(manifestBytes) !== expectedHash) throw fault('SHEETBEST_CAPTURE_MANIFEST_CHANGED');
  only(manifest, ['schema', 'provider', 'method', 'readOnly', 'responseKind', 'format', 'connectionId', 'tab', 'valueMode',
    'transport', 'receivedAt', 'headers', 'resourceFile', 'rowCount', 'sourceSha256', 'sourceBytes'], 'SHEETBEST_CAPTURE_MANIFEST_INVALID');
  binding(manifest); headers(manifest.headers);
  if (manifest.schema !== 'stellar-forge.sheetbest-capture.v1' || manifest.provider !== 'sheetbest' ||
      manifest.method !== (manifest.transport === 'sheetbest-rest' ? 'GET' : 'IMPORT') ||
      manifest.readOnly !== true || manifest.responseKind !== 'SINGLE_RECORDS_RESPONSE' || manifest.format !== 'records' ||
      manifest.resourceFile !== 'records.json' || !['sheetbest-rest', 'operator-import'].includes(manifest.transport) ||
      !HASH.test(manifest.sourceSha256 ?? '') || typeof manifest.receivedAt !== 'string' || !Number.isFinite(Date.parse(manifest.receivedAt)))
    throw fault('SHEETBEST_CAPTURE_MANIFEST_INVALID');
  integer(manifest.sourceBytes, 1, MAX_CAPTURE_BYTES, 'SHEETBEST_CAPTURE_SIZE_INVALID');
  integer(manifest.rowCount, 0, 1000000, 'SHEETBEST_CAPTURE_ROW_COUNT_INVALID');
  const resourceBytes = await readPrivate(join(dirname(filename), 'records.json'), MAX_CAPTURE_BYTES);
  if (resourceBytes.length !== manifest.sourceBytes || digest(resourceBytes) !== manifest.sourceSha256)
    throw fault('SHEETBEST_CAPTURE_RECORDS_CHANGED');
  const records = recordsFromBytes(resourceBytes);
  if (records.length !== manifest.rowCount) throw fault('SHEETBEST_CAPTURE_ROW_COUNT_CHANGED');
  return { manifest, manifestBytes, manifestFile: filename, manifestSha256: digest(manifestBytes), resourceBytes, records };
}
export function bindSheetBestCapture(capture, config) {
  const selected = binding(config);
  if (Object.entries(selected).some(([key, value]) => capture.manifest[key] !== value))
    throw fault('SHEETBEST_CAPTURE_SELECTION_MISMATCH', 'Use the reviewed connection UUID, exact tab selection and value mode.');
  return capture.records;
}
export async function fetchSheetBestRecords(config, { env = process.env, signal } = {}) {
  const selected = binding(config), connection = config.connection;
  if (connection?.kind !== 'rest') throw fault('SHEETBEST_REST_CONNECTION_REQUIRED');
  only(connection, ['kind', 'apiKeyEnv', 'maxResponseBytes', 'timeoutMs'], 'SHEETBEST_REST_CONNECTION_INVALID');
  integer(connection.maxResponseBytes ?? MAX_CAPTURE_BYTES, 1024, MAX_CAPTURE_BYTES, 'SHEETBEST_RESPONSE_LIMIT_INVALID');
  integer(connection.timeoutMs ?? 30000, 100, 180000, 'SHEETBEST_TIMEOUT_INVALID');
  if (connection.apiKeyEnv !== undefined && (typeof connection.apiKeyEnv !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(connection.apiKeyEnv)))
    throw fault('SHEETBEST_API_KEY_REFERENCE_INVALID');
  const requestHeaders = { accept: 'application/json' };
  if (connection.apiKeyEnv !== undefined) {
    const key = env[connection.apiKeyEnv];
    if (typeof key !== 'string' || !key.length || key.length > 16384 || /[^\x21-\x7e]/.test(key))
      throw fault('SHEETBEST_API_KEY_MISSING', 'Supply the existing connection key through the configured environment reference.');
    requestHeaders['X-Api-Key'] = key;
  }
  const url = new URL('https://api.sheetbest.com/sheets/' + selected.connectionId +
    (selected.tab === null ? '' : '/tabs/' + encodeURIComponent(selected.tab)));
  url.searchParams.set('_format', 'records');
  if (selected.valueMode === 'raw') url.searchParams.set('_raw', '1');
  const timeout = AbortSignal.timeout(connection.timeoutMs ?? 30000);
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try { response = await fetch(url, { method: 'GET', headers: requestHeaders, redirect: 'error', signal: abort }); }
  catch { throw fault(signal?.aborted ? 'SHEETBEST_CAPTURE_CANCELLED' : timeout.aborted ? 'SHEETBEST_CAPTURE_TIMEOUT' : 'SHEETBEST_PROVIDER_UNREACHABLE'); }
  if (response.status !== 200) {
    const retryAfter = response.headers.get('retry-after');
    await response.body?.cancel();
    const codes = { 400: 'SHEETBEST_REQUEST_INVALID', 401: 'SHEETBEST_AUTH_REQUIRED', 402: 'SHEETBEST_PROVIDER_QUOTA_EXHAUSTED',
      403: 'SHEETBEST_ACCESS_DENIED', 404: 'SHEETBEST_CONNECTION_NOT_FOUND', 405: 'SHEETBEST_READ_NOT_ALLOWED',
      429: 'SHEETBEST_RATE_LIMITED' };
    const issue = fault(codes[response.status] ?? 'SHEETBEST_PROVIDER_FAILED');
    issue.providerStatus = response.status;
    if (retryAfter && retryAfter.length <= 128 && !/[\r\n\0]/.test(retryAfter)) issue.retryAfter = retryAfter;
    throw issue;
  }
  const maximum = connection.maxResponseBytes ?? MAX_CAPTURE_BYTES;
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel(); throw fault('SHEETBEST_JSON_RESPONSE_REQUIRED');
  }
  if (Number(response.headers.get('content-length') ?? 0) > maximum) {
    await response.body?.cancel(); throw fault('SHEETBEST_RESPONSE_TOO_LARGE');
  }
  const parts = []; let size = 0;
  try {
    if (!response.body) throw fault('SHEETBEST_RESPONSE_MISSING');
    for await (const part of response.body) {
      size += part.byteLength;
      if (size > maximum) throw fault('SHEETBEST_RESPONSE_TOO_LARGE');
      parts.push(part);
    }
  } catch (issue) {
    if (issue.code?.startsWith('SHEETBEST_')) throw issue;
    throw fault(signal?.aborted ? 'SHEETBEST_CAPTURE_CANCELLED' : timeout.aborted ? 'SHEETBEST_CAPTURE_TIMEOUT' : 'SHEETBEST_RESPONSE_INTERRUPTED');
  }
  const resourceBytes = Buffer.concat(parts);
  recordsFromBytes(resourceBytes);
  return { resourceBytes, ...selected, transport: 'sheetbest-rest', receivedAt: stamp(),
    headers: Object.fromEntries(SAFE_HEADERS.filter(name => response.headers.has(name)).map(name => [name, response.headers.get(name)])) };
}
