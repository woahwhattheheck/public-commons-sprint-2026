// MIT. Retained official FRED v1 responses and same-operation acquisition.
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { privateDirectory, atomicJson, readPrivateJson, withPrivateLock } from '../routescan/quota.mjs';
import { CAPTURE, PUBLIC_CAPTURE, PUBLIC_SET_CAPTURE, readPublicTable, readPublicTableSet, MAX_CAPTURE_BYTES, MAX_PAGE_BYTES, canonical, clone, need, normalizeSelection,
  fredRequest, readSeriesMetadata, readObservationPage, inspectCapture } from './model.mjs';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const digest = value => hash(canonical(value));
export const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export async function optionalJson(path, limit = MAX_CAPTURE_BYTES * 2) {
  try { return await readPrivateJson(path, limit); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export function captureIdentity(capture) {
  return [PUBLIC_CAPTURE, PUBLIC_SET_CAPTURE].includes(capture.schema)
    ? { schema: capture.schema, selection: capture.selection, source: capture.source }
    : { schema: CAPTURE, selection: capture.selection, records: capture.records };
}
export function validateCapture(capture) {
  need(capture?.captureSha256 === digest(captureIdentity(capture)), 'The retained FRED capture identity changed.');
  if ([PUBLIC_CAPTURE, PUBLIC_SET_CAPTURE].includes(capture.schema)) {
    const tables = capture.schema === PUBLIC_SET_CAPTURE ? capture.source?.tables : [capture.source];
    need(Array.isArray(tables), 'Retained table inventory is missing.');
    for (const table of tables)
      need(hash(Buffer.from(table?.table_text ?? '', 'utf8')) === table?.sha256, 'The original public-table bytes changed.');
  }
  for (const record of capture.records ?? [])
    need(hash(Buffer.from(record.body ?? '', 'utf8')) === record.sha256, 'An original FRED response changed.');
  return inspectCapture(capture);
}
export async function readFredCapture(directory) {
  const capture = await readPrivateJson(join(resolve(directory), 'capture.json'), MAX_CAPTURE_BYTES * 2);
  validateCapture(capture);
  return capture;
}
export async function storeFredCapture(directory, capture) {
  directory = await privateDirectory(resolve(directory));
  validateCapture(capture);
  return withPrivateLock(directory, 'capture.lock', async () => {
    const retained = await optionalJson(join(directory, 'capture.json'));
    if (retained) need(canonical(retained) === canonical(capture), 'This directory contains another original capture.', 'FRED_CAPTURE_CONFLICT', 409);
    else await atomicJson(directory, 'capture.json', capture, { exclusive: true });
    return { directory, captureSha256: capture.captureSha256 };
  });
}
export function sealFredCapture(selection, records) {
  const capture = { schema: CAPTURE, selection: normalizeSelection(selection), records: clone(records) };
  capture.captureSha256 = digest(captureIdentity(capture));
  validateCapture(capture);
  return capture;
}

export function sealFredPublicTable(input) {
  const source = clone(input), model = readPublicTable(source);
  need(hash(Buffer.from(source.table_text, 'utf8')) === source.sha256, 'The original public-table digest changed.');
  const capture = { schema: PUBLIC_CAPTURE, selection: model.selection, source };
  capture.captureSha256 = digest(captureIdentity(capture));
  validateCapture(capture);
  return capture;
}


export function sealFredPublicTables(input) {
  const source = clone(input), model = readPublicTableSet(source);
  source.tables.sort((a, b) => a.series_id < b.series_id ? -1 : 1);
  const capture = { schema: PUBLIC_SET_CAPTURE, selection: model.selection, source };
  capture.captureSha256 = digest(captureIdentity(capture));
  validateCapture(capture);
  return capture;
}

async function responseBody(response, signal) {
  const length = response.headers.get('content-length');
  need(length === null || /^\d+$/.test(length) && Number(length) <= MAX_PAGE_BYTES,
    'FRED response exceeds the selected page capacity.', 'FRED_RESPONSE_TOO_LARGE', 413);
  need(response.body, 'FRED returned no response body.', 'FRED_RESPONSE_EMPTY', 502);
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      need(size <= MAX_PAGE_BYTES, 'FRED response exceeds 8 MiB.', 'FRED_RESPONSE_TOO_LARGE', 413);
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function retryAfter(response) {
  const raw = response.headers.get('retry-after');
  if (raw && /^\d+$/.test(raw)) return Math.max(1, Math.min(Number(raw), 86400));
  const when = Date.parse(raw ?? '');
  return Number.isFinite(when) && when > Date.now() ? Math.min(86400, Math.ceil((when - Date.now()) / 1000)) : 60;
}
export async function requestFred(request, { apiKey, signal, fetchImpl = globalThis.fetch } = {}) {
  need(typeof apiKey === 'string' && /^[a-z0-9]{32}$/.test(apiKey), 'Configure the operator’s existing FRED API key.', 'FRED_KEY_REQUIRED');
  const url = new URL(request.url);
  need(url.origin === 'https://api.stlouisfed.org' && url.pathname === '/fred/' + request.endpoint &&
    !url.username && !url.password && !url.hash && !url.searchParams.has('api_key'),
    'Use the original credential-free FRED request descriptor.');
  url.searchParams.set('api_key', apiKey);
  const abort = AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]);
  let response;
  try { response = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' },
    redirect: 'error', signal: abort }); }
  catch {
    if (signal?.aborted) throw Object.assign(new Error('Source acquisition was interrupted; resume this same capture.'), { code: 'FRED_CAPTURE_INTERRUPTED', status: 499 });
    throw Object.assign(new Error('The original FRED request did not complete; resume this same capture.'), { code: 'FRED_SOURCE_UNAVAILABLE', status: 502 });
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {});
    const seconds = response.status === 429 ? retryAfter(response) : null;
    throw Object.assign(new Error('FRED returned HTTP ' + response.status + '.'), {
      code: response.status === 429 ? 'FRED_RATE_LIMITED' : 'FRED_SOURCE_REJECTED', status: response.status,
      ...(seconds === null ? {} : { retryAfter: seconds, retryAt: new Date(Date.now() + seconds * 1000).toISOString() }) });
  }
  const bytes = await responseBody(response, abort);
  const body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  need(!body.includes(apiKey), 'The source response echoed credentials and was not retained.', 'FRED_RESPONSE_PRIVATE', 502);
  const headers = {};
  for (const key of ['content-type', 'date', 'etag', 'last-modified']) {
    const value = response.headers.get(key);
    if (value !== null && value.length <= 2048 && !value.includes(apiKey)) headers[key] = value;
  }
  return { request: clone(request), status: 200, receivedAt: new Date().toISOString(), headers, sha256: hash(bytes), body };
}

/** A capture directory is its operation identity. Completed pages survive interruption. */
export async function captureFred({ directory, selection: supplied, apiKeyEnv = 'FRED_API_KEY',
  environment = process.env, signal, fetchImpl, onProgress } = {}) {
  directory = await privateDirectory(resolve(directory));
  const selection = normalizeSelection(supplied);
  need(typeof apiKeyEnv === 'string' && /^[A-Z_][A-Z0-9_]{0,127}$/.test(apiKeyEnv), 'Use an API key environment-variable name.');
  return withPrivateLock(directory, 'capture.lock', async () => {
    const complete = await optionalJson(join(directory, 'capture.json'));
    if (complete) {
      const model = validateCapture(complete);
      need(canonical(complete.selection) === canonical(selection), 'Retained capture uses another source selection.', 'FRED_CAPTURE_CONFLICT', 409);
      return { capture: complete, model, directory, reused: true };
    }
    const previous = await optionalJson(join(directory, 'progress.json'));
    need(previous === null || previous.schema === 'stellar-forge.fred-acquisition.v1' &&
      canonical(previous.selection) === canonical(selection), 'The capture operation belongs to another selection.', 'FRED_CAPTURE_CONFLICT', 409);
    const progress = previous ?? { schema: 'stellar-forge.fred-acquisition.v1', selection,
      startedAt: new Date().toISOString(), records: [], state: 'CAPTURING', lastError: null };
    need(Array.isArray(progress.records), 'Retained source progress is invalid.');
    for (const record of progress.records)
      need(hash(Buffer.from(record.body ?? '', 'utf8')) === record.sha256, 'Retained source page changed.');
    if (progress.lastError?.retryAt && Date.parse(progress.lastError.retryAt) > Date.now())
      throw Object.assign(new Error('Continue this operation after the provider’s retained retry time.'),
        { code: 'FRED_RATE_LIMITED', status: 429, retryAt: progress.lastError.retryAt,
          retryAfter: Math.ceil((Date.parse(progress.lastError.retryAt) - Date.now()) / 1000) });
    let cursor = 0, rows = 0;
    const take = async request => {
      signal?.throwIfAborted();
      if (cursor < progress.records.length) return progress.records[cursor++];
      const record = await requestFred(request, { apiKey: environment[apiKeyEnv], signal, fetchImpl });
      progress.records.push(record); cursor++;
      need(Buffer.byteLength(JSON.stringify(progress)) <= MAX_CAPTURE_BYTES, 'Combined source exceeds 64 MiB.', 'FRED_CAPTURE_TOO_LARGE', 413);
      progress.lastError = null; progress.state = 'CAPTURING';
      await atomicJson(directory, 'progress.json', progress);
      if (onProgress) await onProgress({ responses: progress.records.length, series: request.parameters.series_id, endpoint: request.endpoint });
      return record;
    };
    try {
      for (const id of selection.series) {
        readSeriesMetadata(await take(fredRequest(selection, id, 'series')), selection, id);
        let offset = 0, count = null, done = false, lastDate = null;
        while (!done) {
          const page = readObservationPage(await take(fredRequest(selection, id, 'series/observations', offset)), selection, id, offset, count);
          if (page.observations.length) need(lastDate === null || page.observations[0].date > lastDate, 'Source dates overlap across pages.');
          lastDate = page.observations.at(-1)?.date ?? lastDate;
          rows += page.returned;
          need(rows <= selection.maxRows, 'Combined series exceed row capacity.', 'FRED_CAPTURE_TOO_LARGE', 413);
          offset = page.nextOffset; count = page.count; done = page.complete;
        }
      }
      need(cursor === progress.records.length, 'Saved capture includes an unexpected original response.');
      const capture = sealFredCapture(selection, progress.records);
      await atomicJson(directory, 'capture.json', capture, { exclusive: true });
      progress.state = 'COMPLETE'; progress.completedAt = new Date().toISOString(); progress.lastError = null;
      await atomicJson(directory, 'progress.json', progress);
      return { directory, capture, model: inspectCapture(capture), reused: false };
    } catch (error) {
      progress.state = 'INTERRUPTED';
      progress.lastError = { code: typeof error.code === 'string' ? error.code : 'FRED_CAPTURE_INTERRUPTED',
        status: Number.isInteger(error.status) ? error.status : null, at: new Date().toISOString(),
        retryAt: typeof error.retryAt === 'string' ? error.retryAt : null };
      await atomicJson(directory, 'progress.json', progress);
      throw error;
    }
  });
}
