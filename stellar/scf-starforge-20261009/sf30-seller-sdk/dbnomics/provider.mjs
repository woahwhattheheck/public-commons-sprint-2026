// MIT. Focused original v22 API acquisition with retained responses and same-operation recovery.
import { resolve, join } from 'node:path';
import { writeBytes, readBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { privateDirectory, atomicJson, readPrivateJson, withPrivateLock } from '../routescan/quota.mjs';
import { API_BASE, API_ORIGIN, CAPTURE_SCHEMA, MAX_RESPONSE_BYTES, MAX_CAPTURE_BYTES, normalizeSelection,
  normalizeRights, code, seriesId, operationId, need, text, isRecord, clone, hash, digest, canonical, jsonBytes,
  parseProviderJson, modelFromResponses } from './model.mjs';

export const now = () => new Date().toISOString();
export async function optionalJson(path, max = MAX_CAPTURE_BYTES) {
  try { return await readPrivateJson(path, max); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function exactFile(directory, name, bytes) {
  need(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/.test(name), 'Use a single retained member name.');
  directory = await privateDirectory(resolve(directory));
  const path = join(directory, name);
  try { await writeBytes(path, Buffer.from(bytes), { exclusive: true }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await readBytes(path, Math.max(bytes.length, 1));
    need(existing.equals(Buffer.from(bytes)), 'An immutable original member differs: ' + name, 'DBNOMICS_IMMUTABLE_CONFLICT', 409);
  }
  return { file: name, bytes: bytes.length, sha256: hash(bytes) };
}
function apiUrl(path, query = {}) {
  need(path.startsWith('/') && !path.includes('?') && !path.includes('#'), 'Use an original API path.');
  const url = new URL(API_BASE + path);
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  return url.href;
}
function count(value, fallback, maximum) {
  value ??= fallback;
  need(Number.isSafeInteger(value) && value >= 0 && value <= maximum, 'Use a supported nonnegative page value.');
  return value;
}
export function discoveryRequest(input = {}) {
  need(isRecord(input) && Object.keys(input).every(key=>['kind','limit','offset','provider','dataset','query','dimensions'].includes(key)), 'Use the documented discovery request fields.');
  const kind = input.kind ?? 'providers';
  const limit = count(input.limit, 20, 1000), offset = count(input.offset, 0, 10000000);
  need(limit > 0, 'A discovery page needs a positive limit.');
  if (kind === 'providers') return { kind, url: apiUrl('/providers', {}), offset: 0, limit };
  if (kind === 'provider') return { kind, url: apiUrl('/providers/' + encodeURIComponent(code(input.provider, 'provider code'))), offset: 0, limit };
  if (kind === 'dataset') return { kind, url: apiUrl('/datasets/' + encodeURIComponent(code(input.provider, 'provider code')) + '/' +
    encodeURIComponent(code(input.dataset, 'dataset code'))), offset: 0, limit };
  if (kind === 'datasets') return { kind, url: apiUrl('/datasets/' + encodeURIComponent(code(input.provider, 'provider code')), { limit, offset }), offset, limit };
  if (kind === 'search') return { kind, url: apiUrl('/search', { q: text(input.query, 'search query', 500), limit, offset }), offset, limit };
  if (kind === 'series') {
    const query = { observations: 0, limit, offset };
    if (input.query) query.q = text(input.query, 'series search query', 500);
    if (input.dimensions !== undefined) {
      need(isRecord(input.dimensions) && Object.keys(input.dimensions).length <= 40, 'Use a mapping of exact dimension codes to selected values.');
      const selected = {};
      for (const [key, values] of Object.entries(input.dimensions)) {
        code(key, 'dimension code');
        need(Array.isArray(values) && values.length > 0 && values.length <= 100 && values.every(value => typeof value === 'string'),
          'Select one to one hundred values per dimension.');
        Object.defineProperty(selected, key, { value: values.map(value => text(value, 'dimension value', 500)), enumerable: true });
      }
      query.dimensions = canonical(selected);
    }
    return { kind, url: apiUrl('/series/' + encodeURIComponent(code(input.provider, 'provider code')) + '/' +
      encodeURIComponent(code(input.dataset, 'dataset code')), query), offset, limit };
  }
  need(false, 'Choose providers, provider, datasets, dataset, search or series discovery.');
}
export function captureRequests(selection) {
  selection = normalizeSelection(selection);
  // Each exact series is a complete focused source. Release redirects retain the resolved original URL.
  return selection.seriesIds.map(id => {
    const [provider, dataset, series] = id.split('/');
    return { seriesIds: [id], url: apiUrl('/series/' + encodeURIComponent(provider) + '/' + encodeURIComponent(dataset) + '/' + encodeURIComponent(series),
      { observations: 1, align_periods: 0 }) };
  });
}
export function retryAfter(value, dateValue, observedAt) {
  if (!value) return null;
  const server = Date.parse(dateValue ?? ''), observed = Date.parse(observedAt);
  if (/^\d+$/.test(value.trim())) return new Date((Number.isFinite(server) ? server : observed) + Number(value.trim()) * 1000).toISOString();
  const absolute = Date.parse(value);
  return Number.isFinite(absolute) ? new Date(absolute).toISOString() : null;
}
export async function requestDbnomics(url, { fetchImpl = fetch, signal, timeoutMs = 45000, maxBytes = MAX_RESPONSE_BYTES } = {}) {
  need(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 300000, 'Use a provider timeout between one and 300 seconds.');
  const startUrl = new URL(url);
  need(startUrl.origin === API_ORIGIN && startUrl.pathname.startsWith('/v22/') && !startUrl.username && !startUrl.password,
    'Read the configured public DBnomics v22 API.');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const redirects = []; let selected = startUrl.href;
  try {
    for (let hop = 0; hop <= 4; hop++) {
      const startedAt = now();
      const response = await fetchImpl(selected, { method: 'GET', headers: { accept: 'application/json', 'user-agent': 'TokenJunkieLabs-DBnomics/1.0' },
        redirect: 'manual', signal: combined, cache: 'no-store' });
      const receivedAt = now();
      const headers = Object.fromEntries(['content-type', 'content-length', 'date', 'etag', 'last-modified', 'cache-control',
        'retry-after', 'location'].filter(key => response.headers.has(key)).map(key => [key, response.headers.get(key)]));
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        need(hop < 4 && response.headers.get('location'), 'Provider release redirect is incomplete.', 'DBNOMICS_REDIRECT_FAILED', 502);
        const next = new URL(response.headers.get('location'), selected);
        need(next.origin === API_ORIGIN && next.pathname.startsWith('/v22/') && !next.username && !next.password,
          'Provider redirected outside its original API.', 'DBNOMICS_REDIRECT_CHANGED', 502);
        redirects.push({ url: selected, status: response.status, location: next.href, receivedAt }); selected = next.href; continue;
      }
      const chunks = []; let bytes = 0;
      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const chunk = await reader.read(); if (chunk.done) break;
            bytes += chunk.value.byteLength;
            need(bytes <= maxBytes, 'Provider response exceeds the selected original response capacity.', 'DBNOMICS_RESPONSE_TOO_LARGE', 413);
            chunks.push(Buffer.from(chunk.value));
          }
        } catch (error) { await reader.cancel().catch(() => {}); throw error; }
        finally { reader.releaseLock(); }
      }
      const body = Buffer.concat(chunks, bytes);
      return { receipt: { method: 'GET', url: startUrl.href, finalUrl: selected, status: response.status, startedAt, receivedAt, completedAt: now(),
        headers, redirects, bytes: body.length, sha256: hash(body),
        retryAt: retryAfter(headers['retry-after'], headers.date, receivedAt) }, bytes: body };
    }
  } finally { clearTimeout(timer); }
}
function ensureSuccess(response) {
  if (response.receipt.status !== 200) {
    let message = 'DBnomics returned HTTP ' + response.receipt.status + '.';
    try {
      const parsed = parseProviderJson(response.bytes).value;
      const native = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message ?? parsed.message;
      if (typeof native === 'string') message += ' ' + native.slice(0, 2000);
    } catch {}
    throw Object.assign(new Error(message), { code: 'DBNOMICS_PROVIDER_HTTP', status: 502,
      providerStatus: response.receipt.status, retryAt: response.receipt.retryAt, receipt: response.receipt });
  }
  return response;
}
export async function discoverDbnomics(input, options = {}) {
  const request = discoveryRequest(input), response = ensureSuccess(await requestDbnomics(request.url, options));
  const data = parseProviderJson(response.bytes).value;
  need(isRecord(data), 'Provider discovery response is not an object.', 'DBNOMICS_PROVIDER_SCHEMA', 502);
  if (data.error) need(false, typeof data.error === 'string' ? data.error : canonical(data.error), 'DBNOMICS_PROVIDER_ERROR', 502);
  const collection = [data.providers, data.datasets, data.results, data.series].find(value => isRecord(value) && Array.isArray(value.docs));
  const items = collection?.docs ?? (data.provider ? [data.provider] : data.dataset ? [data.dataset] : []);
  const offset = collection?.offset ?? request.offset, limit = collection?.limit ?? request.limit, total = collection?.num_found ?? items.length;
  return { request, receipt: response.receipt, data, items, page: { offset, limit, total, returned: items.length,
    next: offset + items.length < total && items.length > 0 ? offset + items.length : null } };
}
function captureIdentity(capture) {
  return { schema: CAPTURE_SCHEMA, selection: capture.selection, sourceMode: capture.sourceMode, terms: capture.terms,
    responses: capture.responses.map(response => ({ receipt: response.receipt, contentBase64: response.contentBase64 })) };
}
export function sealDbnomicsCapture({ selection, responses, rights, sourceMode = 'IMPORTED_HTTP_RESPONSES' } = {}) {
  selection = normalizeSelection(selection);
  need(['NATIVE_HTTP', 'IMPORTED_HTTP_RESPONSES', 'IMPORTED_PUBLIC_ATTACHMENT'].includes(sourceMode), 'Retain the original source acquisition mode.');
  need(Array.isArray(responses) && responses.length === selection.seriesIds.length, 'Retain one complete response for every selected series.');
  const expected = captureRequests(selection);
  const normalized = responses.map((item, index) => {
    const bytes = item.bytes instanceof Uint8Array || Buffer.isBuffer(item.bytes) ? Buffer.from(item.bytes) :
      typeof item.contentBase64 === 'string' ? Buffer.from(item.contentBase64, 'base64') : null;
    need(bytes && bytes.length <= MAX_RESPONSE_BYTES, 'Each imported response needs its complete original bytes.');
    const receipt = clone(item.receipt);
    need(isRecord(receipt) && receipt.method === 'GET' && receipt.url === expected[index].url &&
      (sourceMode === 'IMPORTED_PUBLIC_ATTACHMENT' ? receipt.status === null && receipt.transport?.kind === 'notion-public-attachment' && receipt.transport.status === 'uploaded' && /^[a-f0-9-]{36}$/.test(receipt.transport.fileUploadId ?? '') && receipt.transport.contentLength === bytes.length : receipt.status === 200) && typeof receipt.completedAt === 'string' && Number.isFinite(Date.parse(receipt.completedAt)),
      'Import the selected successful GET receipt and actual source timestamp.');
    need(receipt.bytes === bytes.length && receipt.sha256 === hash(bytes), 'Original response bytes differ from their receipt.');
    const final = new URL(receipt.finalUrl);
    need(final.origin === API_ORIGIN && final.pathname.startsWith('/v22/') && !final.username && !final.password, 'Keep the original resolved API URL.');
    if (item.contentBase64 !== undefined) need(bytes.toString('base64') === item.contentBase64, 'Source body is not canonical complete base64.');
    return { receipt, contentBase64: bytes.toString('base64') };
  });
  const model = modelFromResponses(selection, normalized.map(row => ({ bytes: Buffer.from(row.contentBase64, 'base64') })));
  const terms = normalizeRights(rights, model.series.map(row => row.provider));
  const capture = { schema: CAPTURE_SCHEMA, selection, sourceMode, terms, responses: normalized };
  capture.captureId = digest(captureIdentity(capture));
  need(jsonBytes(capture).length <= MAX_CAPTURE_BYTES, 'The complete selected capture exceeds its retained capacity.');
  return capture;
}
export function inspectDbnomicsCapture(capture) {
  need(isRecord(capture) && capture.schema === CAPTURE_SCHEMA && typeof capture.captureId === 'string' &&
    capture.captureId === digest(captureIdentity(capture)), 'The retained DBnomics capture identity changed.');
  const sealed = sealDbnomicsCapture({ selection: capture.selection, sourceMode: capture.sourceMode, rights: {
    providers: capture.terms.providers, ...(capture.terms.note !== undefined ? { note: capture.terms.note } : {}) }, responses: capture.responses });
  need(sealed.captureId === capture.captureId, 'The retained source terms or response selection changed.');
  const model = modelFromResponses(capture.selection, capture.responses.map(row => ({ bytes: Buffer.from(row.contentBase64, 'base64') })), capture.captureId);
  return { ...model, terms: clone(capture.terms), sourceMode: capture.sourceMode,
    retrievedAt: capture.responses.map(row => row.receipt.completedAt).sort().at(-1),
    retrievalWindow: { from: capture.responses.map(row => row.receipt.startedAt ?? row.receipt.completedAt).sort()[0],
      to: capture.responses.map(row => row.receipt.completedAt).sort().at(-1) },
    receipts: capture.responses.map(row => clone(row.receipt)) };
}
export async function storeDbnomicsCapture(directory, capture) {
  const model = inspectDbnomicsCapture(capture);
  await exactFile(directory, 'capture.json', jsonBytes(capture));
  for (const [index, response] of capture.responses.entries()) {
    const stem = 'source-' + String(index + 1).padStart(4, '0');
    await exactFile(directory, stem + '.json', Buffer.from(response.contentBase64, 'base64'));
    await exactFile(directory, stem + '.receipt.json', jsonBytes(response.receipt));
  }
  return { captureId: capture.captureId, directory: resolve(directory), rowCount: model.rowCount, missing: model.missing, series: model.series };
}
export async function captureDbnomics({ directory, selection, rights, signal, fetchImpl = fetch, timeoutMs = 45000 } = {}) {
  directory = await privateDirectory(resolve(directory)); selection = normalizeSelection(selection);
  const requests = captureRequests(selection);
  const original = { schema: 'stellar-forge.dbnomics-acquisition.v1', selection, requests, rights: rights ?? null };
  return withPrivateLock(directory, 'acquisition.lock', async () => {
    const plan = await optionalJson(join(directory, 'plan.json'), 1024 * 1024);
    if (plan) need(canonical(plan) === canonical(original), 'This original acquisition belongs to another source selection.', 'DBNOMICS_ACQUISITION_CONFLICT', 409);
    else await atomicJson(directory, 'plan.json', original, { exclusive: true });
    const completed = await optionalJson(join(directory, 'capture.json'), MAX_CAPTURE_BYTES);
    if (completed) return { capture: completed, model: inspectDbnomicsCapture(completed), replayed: true };
    const responses = []; let total = 0;
    for (let index = 0; index < requests.length; index++) {
      const stem = 'request-' + String(index + 1).padStart(4, '0');
      let receipt = await optionalJson(join(directory, stem + '.receipt.json'), 262144);
      let response;
      if (receipt) {
        const bytes = await readBytes(join(directory, stem + '.body'), MAX_RESPONSE_BYTES);
        need(receipt.bytes === bytes.length && receipt.sha256 === hash(bytes) && receipt.url === requests[index].url,
          'Retained acquisition bytes or original request changed.');
        response = { receipt, bytes };
      } else {
        const retainedReturn = await optionalJson(join(directory, stem + '.returned.json'), MAX_RESPONSE_BYTES * 1.5);
        if (retainedReturn) {
          const bytes = Buffer.from(retainedReturn.contentBase64, 'base64');
          need(retainedReturn.receipt.url === requests[index].url && retainedReturn.receipt.bytes === bytes.length && retainedReturn.receipt.sha256 === hash(bytes), 'The original successful return changed.');
          response = { receipt: retainedReturn.receipt, bytes };
        }
        const error = await optionalJson(join(directory, stem + '.error.json'), 262144);
        if (!response && error?.retryAt) need(Date.now() >= Date.parse(error.retryAt), 'The original provider retry time is ' + error.retryAt + '.', 'DBNOMICS_PROVIDER_DEFERRED', 429);
        if (!response) {
          await atomicJson(directory, stem + '.attempt.json', { url: requests[index].url, startedAt: now() });
          response = await requestDbnomics(requests[index].url, { signal, fetchImpl, timeoutMs });
        }
        if (response.receipt.status !== 200) {
          const failed = { ...response.receipt, contentBase64: response.bytes.toString('base64') };
          const failureName = stem + '.returned-' + hash(jsonBytes(failed)) + '.json';
          await exactFile(directory, failureName, jsonBytes(failed));
          await atomicJson(directory, stem + '.error.json', { ...response.receipt, returnedFile: failureName });
          ensureSuccess(response);
        }
        if (!retainedReturn) await atomicJson(directory, stem + '.returned.json', { receipt: response.receipt, contentBase64: response.bytes.toString('base64') }, { exclusive: true });
        await exactFile(directory, stem + '.body', response.bytes);
        await atomicJson(directory, stem + '.receipt.json', response.receipt, { exclusive: true });
        receipt = response.receipt;
      }
      ensureSuccess(response); total += response.bytes.length;
      need(total <= MAX_CAPTURE_BYTES * 0.7, 'The selected originals exceed the complete capture capacity.');
      responses.push(response);
    }
    const capture = sealDbnomicsCapture({ selection, responses, rights, sourceMode: 'NATIVE_HTTP' });
    await exactFile(directory, 'capture.json', jsonBytes(capture));
    return { capture, model: inspectDbnomicsCapture(capture), replayed: false };
  });
}
