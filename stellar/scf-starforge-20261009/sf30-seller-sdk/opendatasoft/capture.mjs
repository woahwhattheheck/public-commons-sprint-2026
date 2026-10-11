// MIT. Complete Huwise / Opendatasoft Explore v2.1 editions from original GET responses.
import { dirname, join, resolve } from 'node:path';
import { isIP } from 'node:net';
import { lstat } from 'node:fs/promises';
import { object, bytes, digest, identity, readPrivate, createFile,
  atomicJson, privateDirectory, acquireWorkspace, fault, stamp } from '../postgres/publisher/files.mjs';

export const CAPTURE_SCHEMA = 'stellar-forge.opendatasoft-capture.v1';
export const API_PREFIX = '/api/explore/v2.1';
const HASH = /^[a-f0-9]{64}$/;
const LANGUAGES = new Set(['en','fr','nl','pt','it','ar','de','es','ca','eu','sv']);
const own = (value, names, code) => {
  if (!object(value) || Object.keys(value).some(key => !names.includes(key))) throw fault(code);
  return value;
};
const integer = (value, low, high, code) => {
  if (!Number.isSafeInteger(value) || value < low || value > high) throw fault(code);
  return value;
};
function text(value, maximum, code) {
  if (typeof value !== 'string' || !value.length || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value))
    throw fault(code);
  return value;
}
export function catalogOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw fault('ODS_ORIGIN_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.pathname !== '/' || isIP(url.hostname.replace(/^\[|\]$/g, '')) ||
      !url.hostname.includes('.') || /(^|\.)localhost$|\.(local|internal|home\.arpa)$/i.test(url.hostname) ||
      value.replace(/\/$/, '') !== url.origin)
    throw fault('ODS_ORIGIN_INVALID', 'Use the canonical HTTPS origin of the Huwise / Opendatasoft portal.');
  return url.origin;
}
export function datasetIdentifier(value) {
  text(value, 512, 'ODS_DATASET_ID_INVALID');
  if (/[\/\\?#]/.test(value) || value === '.' || value === '..') throw fault('ODS_DATASET_ID_INVALID');
  return value;
}
// Keep ordinary typed numbers, but retain tokens that JavaScript would change.
// These values serialize as JSON numbers, including within structured fields.
export class ExactOpendatasoftNumber {
  constructor(source) { this.source = source; Object.freeze(this); }
  toString() { return this.source; }
  toJSON() {
    if (typeof JSON.rawJSON !== 'function') throw fault('ODS_EXACT_NUMBER_RUNTIME_REQUIRED');
    return JSON.rawJSON(this.source);
  }
}
function decimalIdentity(source) {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source);
  if (!match) throw fault('ODS_RESPONSE_JSON_INVALID');
  const fraction = match[3] ?? '';
  let digits = (match[2] + fraction).replace(/^0+/, '');
  if (!digits) return '0';
  const trailing = /0*$/.exec(digits)[0].length;
  if (trailing) digits = digits.slice(0, -trailing);
  return match[1] + digits + 'e' + (BigInt(match[4] ?? '0') - BigInt(fraction.length) + BigInt(trailing));
}
export function parseOpendatasoftJson(buffer) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { throw fault('ODS_RESPONSE_ENCODING'); }
  try {
    return JSON.parse(text, (_key, value, context) => {
      if (typeof value === 'number') {
        if (typeof context?.source !== 'string') throw fault('ODS_EXACT_NUMBER_RUNTIME_REQUIRED');
        if (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value) ||
            Object.is(value, -0) || decimalIdentity(context.source) !== decimalIdentity(String(value)))
          return new ExactOpendatasoftNumber(context.source);
      }
      return value;
    });
  } catch (error) {
    if (error.code) throw error;
    throw fault('ODS_RESPONSE_JSON_INVALID');
  }
}

/** Clause strings are sent unchanged to the provider's read-only ODSQL engine.
 * Repeated refinements/exclusions keep their original order and multiplicity. */
export function normalizeOpendatasoftQuery(input = {}, { mode = 'records' } = {}) {
  const capture = mode === 'capture', metadata = mode === 'metadata', catalog = mode === 'catalog';
  const keys = metadata ? ['lang','timezone'] : catalog ? ['where','order_by','refine','exclude','lang','timezone','limit','offset'] : capture ?
    ['where','order_by','refine','exclude','lang','timezone'] :
    ['select','where','group_by','order_by','refine','exclude','lang','timezone','limit','offset'];
  own(input, keys, 'ODS_QUERY_PARAMETER_INVALID');
  const output = {};
  for (const key of ['select','where','group_by','order_by']) {
    if (input[key] !== undefined && input[key] !== '') output[key] = text(input[key], 16384, 'ODS_QUERY_CLAUSE_INVALID');
  }
  for (const key of ['refine','exclude']) {
    if (input[key] === undefined) continue;
    const values = typeof input[key] === 'string' ? [input[key]] : input[key];
    if (!Array.isArray(values) || values.length > 100) throw fault('ODS_FACET_SELECTION_INVALID');
    if (values.length) output[key] = values.map(value => text(value, 4096, 'ODS_FACET_SELECTION_INVALID'));
  }
  if (input.lang !== undefined) {
    if (!LANGUAGES.has(input.lang)) throw fault('ODS_LANGUAGE_INVALID');
    output.lang = input.lang;
  }
  if (input.timezone !== undefined) {
    text(input.timezone, 128, 'ODS_TIMEZONE_INVALID');
    try { new Intl.DateTimeFormat('en', { timeZone: input.timezone }); }
    catch { throw fault('ODS_TIMEZONE_INVALID'); }
    output.timezone = input.timezone;
  }
  if (!capture && !metadata) {
    // Non-aggregate records and catalog pages are limited; complete acquisition uses exports.
    const maximum = !catalog && output.group_by ? 20000 : 100;
    output.limit = integer(input.limit ?? (catalog ? 20 : 20), 0, maximum, 'ODS_PAGE_LIMIT_INVALID');
    output.offset = integer(input.offset ?? 0, 0, 19999, 'ODS_PAGE_OFFSET_INVALID');
    const window = !catalog && output.group_by ? 20000 : 10000;
    if (output.offset + output.limit >= window && output.limit > 0)
      throw fault('ODS_RECORD_WINDOW_EXCEEDED', 'Use the complete export capture for data outside the records window.');
  }
  return output;
}
function transportOptions(value = {}) {
  if (value.authTokenEnv !== undefined && !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value.authTokenEnv))
    throw fault('ODS_TOKEN_REFERENCE_INVALID');
  return { ...(value.authTokenEnv ? { authTokenEnv: value.authTokenEnv } : {}),
    timeoutMs: integer(value.timeoutMs ?? 60000, 100, 300000, 'ODS_TIMEOUT_INVALID'),
    maxResponseBytes: integer(value.maxResponseBytes ?? 67108864, 1024, 268435456, 'ODS_RESPONSE_LIMIT_INVALID') };
}
export function captureSelection(value) {
  own(value, ['catalogOrigin','datasetId','where','order_by','refine','exclude','lang','timezone','authTokenEnv','timeoutMs','maxResponseBytes','maxRows','maxBytes'], 'ODS_SELECTION_INVALID');
  const query = Object.fromEntries(['where','order_by','refine','exclude','lang','timezone']
    .filter(key => value[key] !== undefined).map(key => [key, value[key]]));
  return { catalogOrigin: catalogOrigin(value.catalogOrigin), datasetId: datasetIdentifier(value.datasetId),
    ...normalizeOpendatasoftQuery({ lang: 'en', timezone: 'UTC', ...query }, { mode: 'capture' }),
    ...transportOptions(value) };
}
function selectionQuery(selection) {
  return Object.fromEntries(['where','order_by','refine','exclude','lang','timezone']
    .filter(key => selection[key] !== undefined).map(key => [key, selection[key]]));
}
export function opendatasoftUrl(origin, action, datasetId, input = {}) {
  const base = catalogOrigin(origin);
  if (!['catalog','dataset','records','export'].includes(action)) throw fault('ODS_READ_ACTION_REQUIRED');
  const path = action === 'catalog' ? '/catalog/datasets' :
    '/catalog/datasets/' + encodeURIComponent(datasetIdentifier(datasetId)) +
      ({ dataset: '', records: '/records', export: '/exports/json' }[action]);
  const mode = ({ catalog: 'catalog', dataset: 'metadata', records: 'records', export: 'capture' })[action];
  const query = normalizeOpendatasoftQuery(input, { mode });
  const url = new URL(API_PREFIX + path, base);
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, item);
    else url.searchParams.set(key, String(value));
  }
  // No export limit/offset is sent: the documented default is the full export.
  return url;
}
function checkedResponse(raw) {
  const value = parseOpendatasoftJson(raw);
  if (!object(value) && !Array.isArray(value)) throw fault('ODS_RESPONSE_INVALID');
  if (object(value) && Object.hasOwn(value, 'error_code'))
    throw Object.assign(fault('ODS_PROVIDER_QUERY_FAILED', typeof value.message === 'string' ?
      value.message.slice(0, 2048) : 'The provider rejected this Explore query.', 502),
      { providerCode: String(value.error_code).slice(0, 128) });
  return value;
}
export async function requestOpendatasoft(origin, action, datasetId, query = {}, options = {}) {
  const url = opendatasoftUrl(origin, action, datasetId, query), config = transportOptions(options);
  const headers = { accept: 'application/json' };
  if (config.authTokenEnv) {
    const token = (options.env ?? process.env)[config.authTokenEnv];
    if (typeof token !== 'string' || !token.length || token.length > 16384 || /[^\x21-\x7e]/.test(token))
      throw fault('ODS_TOKEN_UNAVAILABLE', 'Provide the configured private portal API key environment reference.');
    headers.authorization = 'Apikey ' + token;
  }
  const timeout = AbortSignal.timeout(config.timeoutMs);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  let response;
  try { response = await (options.fetch ?? globalThis.fetch)(url, { method: 'GET', headers, signal, redirect: 'error' }); }
  catch { throw fault(signal.aborted ? 'ODS_REQUEST_CANCELLED' : 'ODS_PROVIDER_UNREACHABLE'); }
  const receipt = { url: url.href, method: 'GET', receivedAt: stamp(), status: response.status,
    headers: Object.fromEntries(['content-type','etag','last-modified','date','retry-after']
      .map(key => [key, response.headers.get(key)]).filter(([,value]) => value !== null)) };
  if (Number(response.headers.get('content-length') ?? 0) > config.maxResponseBytes) {
    await response.body?.cancel(); throw Object.assign(fault('ODS_RESPONSE_TOO_LARGE'), { receipt });
  }
  const chunks = []; let size = 0;
  if (!response.body) throw Object.assign(fault('ODS_RESPONSE_EMPTY'), { receipt });
  try {
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > config.maxResponseBytes) throw fault('ODS_RESPONSE_TOO_LARGE');
      chunks.push(chunk);
    }
  } catch (error) {
    if (error.code) throw Object.assign(error, { receipt });
    throw Object.assign(fault(signal.aborted ? 'ODS_REQUEST_CANCELLED' : 'ODS_RESPONSE_INTERRUPTED'), { receipt });
  }
  const raw = Buffer.concat(chunks), retained = { ...receipt, bytes: raw.length, sha256: digest(raw) };
  if (!response.ok) {
    let provider;
    try { provider = parseOpendatasoftJson(raw); } catch {}
    throw Object.assign(fault(response.status === 429 ? 'ODS_RATE_LIMITED' :
      response.status === 401 || response.status === 403 ? 'ODS_PROVIDER_AUTHORIZATION_REQUIRED' :
      'ODS_PROVIDER_HTTP_' + response.status,
      typeof provider?.message === 'string' ? provider.message.slice(0, 2048) :
        'The portal returned HTTP ' + response.status + '.', 502),
      { receipt: retained, providerCode: typeof provider?.error_code === 'string' ? provider.error_code : null });
  }
  return { raw, value: checkedResponse(raw), receipt: retained };
}
export function describeOpendatasoftDataset(value) {
  if (!object(value) || typeof value.dataset_id !== 'string' || !Array.isArray(value.fields))
    throw fault('ODS_METADATA_INVALID');
  const metadata = value.metas?.default ?? {};
  return { id: value.dataset_id, datasetId: value.dataset_id, datasetUid: value.dataset_uid ?? null,
    title: metadata.title ?? value.dataset_id, description: metadata.description ?? '',
    modified: metadata.modified ?? null, rowCount: metadata.records_count ?? null,
    license: { title: metadata.license ?? null, url: metadata.license_url ?? null },
    publisher: metadata.publisher ?? null, attributions: metadata.attributions ?? [],
    fields: value.fields.map(field => ({ ...field, id: field.name })) };
}
export async function searchOpendatasoft(origin, input = {}, options = {}) {
  const query = normalizeOpendatasoftQuery(input, { mode: 'catalog' });
  const received = await requestOpendatasoft(origin, 'catalog', null, query, options);
  if (!Array.isArray(received.value.results) || !Number.isSafeInteger(received.value.total_count))
    throw fault('ODS_CATALOG_RESPONSE_INVALID');
  const returned = received.value.results.length, total = received.value.total_count;
  return { ...received, datasets: received.value.results.map(describeOpendatasoftDataset),
    page: { offset: query.offset, limit: query.limit, returned, total,
      next: returned && query.offset + returned < total && query.offset + returned + query.limit < 10000 ? query.offset + returned : null } };
}
export async function previewOpendatasoftRecords(origin, datasetId, input = {}, options = {}) {
  const query = normalizeOpendatasoftQuery(input);
  const received = await requestOpendatasoft(origin, 'records', datasetId, query, options);
  if (!Array.isArray(received.value.results) || !Number.isSafeInteger(received.value.total_count) ||
      received.value.results.some(row => !object(row))) throw fault('ODS_RECORDS_RESPONSE_INVALID');
  const returned = received.value.results.length, total = received.value.total_count;
  if (returned > query.limit) throw fault('ODS_RECORDS_PAGE_OVERFLOW');
  const window = query.group_by ? 20000 : 10000;
  return { ...received, records: received.value.results, totalCount: total,
    page: { offset: query.offset, limit: query.limit, returned, total,
      next: returned && query.offset + returned < total && query.offset + returned + query.limit < window ? query.offset + returned : null } };
}
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const fileInfo = (file, raw) => ({ file, bytes: raw.length, sha256: digest(raw) });
const metadataVersion = value => ({ datasetId: value.dataset_id, datasetUid: value.dataset_uid,
  fields: value.fields, modified: value.metas?.default?.modified ?? null,
  processed: value.metas?.default?.data_processed ?? null,
  metadataProcessed: value.metas?.default?.metadata_processed ?? null, rights: sourceRights(value),
  recordsCount: value.metas?.default?.records_count ?? null });
function checkedMetadata(value, selection) {
  describeOpendatasoftDataset(value);
  if (value.dataset_id !== selection.datasetId && value.dataset_uid !== selection.datasetId)
    throw fault('ODS_DATASET_CHANGED');
  const names = value.fields.map(field => field?.name);
  if (names.some(name => typeof name !== 'string' || !name.length) || new Set(names).size !== names.length)
    throw fault('ODS_FIELDS_INVALID');
  return value;
}
function checkedRows(value, fields) {
  if (!Array.isArray(value) || value.some(row => !object(row))) throw fault('ODS_EXPORT_RESPONSE_INVALID');
  const names = new Set(fields.map(field => field.name));
  for (const row of value) {
    if (Object.keys(row).some(name => !names.has(name))) throw fault('ODS_EXPORT_FIELD_NOT_IN_METADATA');
  }
  return value;
}
function filtered(selection) {
  return !!selection.where || !!selection.refine?.length || !!selection.exclude?.length;
}
function sourceRights(metadata) {
  const m = metadata.metas?.default ?? {};
  return { license: m.license ?? null, licenseUrl: m.license_url ?? null,
    publisher: m.publisher ?? null, attributions: m.attributions ?? [], language: m.language ?? null,
    metadataLanguages: m.metadata_languages ?? null };
}
function receiptBinding(receipt, raw, selection, action) {
  if (!object(receipt) || receipt.method !== 'GET' || receipt.status !== 200 ||
      typeof receipt.url !== 'string') throw fault('ODS_CAPTURE_RECEIPT_INVALID');
  const url = new URL(receipt.url), expected = opendatasoftUrl(selection.catalogOrigin, action, selection.datasetId,
    action === 'export' ? selectionQuery(selection) : {});
  if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.username || url.password || url.hash)
    throw fault('ODS_CAPTURE_REQUEST_CHANGED');
  if (action === 'export') {
    const pairs = {};
    for (const [key, value] of url.searchParams) {
      if (['limit','offset','use_labels','compressed'].includes(key)) {
        if ((key === 'limit' && value !== '-1') || (key === 'offset' && value !== '0') ||
            (['use_labels','compressed'].includes(key) && value !== 'false'))
          throw fault('ODS_CAPTURE_EXPORT_NOT_COMPLETE');
        continue;
      }
      if (['refine','exclude'].includes(key)) (pairs[key] ??= []).push(value);
      else { if (Object.hasOwn(pairs, key)) throw fault('ODS_CAPTURE_DUPLICATE_PARAMETER'); pairs[key] = value; }
    }
    const requested = normalizeOpendatasoftQuery({ lang: 'en', timezone: 'UTC', ...pairs }, { mode: 'capture' });
    if (identity(requested) !== identity(selectionQuery(selection))) throw fault('ODS_CAPTURE_REQUEST_CHANGED');
  } else {
    for (const [key] of url.searchParams) if (!['lang','timezone'].includes(key)) throw fault('ODS_CAPTURE_METADATA_PROJECTION');
  }
  if (receipt.bytes !== raw.length || receipt.sha256 !== digest(raw)) throw fault('ODS_CAPTURE_RECEIPT_CHANGED');
  return receipt;
}
function makeManifest(selection, files, receipts, originals, startedAt) {
  const before = checkedMetadata(checkedResponse(originals.get('dataset.json')), selection);
  const after = checkedMetadata(checkedResponse(originals.get('dataset-after.json')), selection);
  if (before.dataset_id !== after.dataset_id || before.dataset_uid !== after.dataset_uid)
    throw fault('ODS_DATASET_CHANGED_DURING_CAPTURE');
  if (identity(before.fields) !== identity(after.fields)) throw fault('ODS_FIELDS_CHANGED_DURING_CAPTURE');
  const rows = checkedRows(checkedResponse(originals.get('records.json')), before.fields);
  let expectedBefore = before.metas?.default?.records_count, expectedAfter = after.metas?.default?.records_count;
  if (filtered(selection)) {
    const count = file => {
      const result = checkedResponse(originals.get(file));
      if (!object(result) || !Number.isSafeInteger(result.total_count) || !Array.isArray(result.results) || result.results.length)
        throw fault('ODS_CAPTURE_COUNT_RESPONSE_INVALID');
      return result.total_count;
    };
    if (!originals.has('count-before.json') || !originals.has('count-after.json')) throw fault('ODS_SELECTED_COUNT_REQUIRED');
    expectedBefore = count('count-before.json'); expectedAfter = count('count-after.json');
  }
  const countStable = Number.isSafeInteger(expectedBefore) && expectedBefore === expectedAfter;
  if (countStable && rows.length !== expectedBefore)
    throw fault('ODS_EXPORT_COUNT_MISMATCH', 'The full export length does not match the provider result count.');
  const summary = describeOpendatasoftDataset(before), rights = sourceRights(before);
  const identityCandidates = before.fields.filter(field => field.annotations?.id === true).map(field => {
    const seen = new Set(); let missing = 0, duplicates = 0;
    for (const row of rows) {
      if (!Object.hasOwn(row, field.name) || row[field.name] === null) { missing++; continue; }
      const key = JSON.stringify(row[field.name]); if (seen.has(key)) duplicates++; seen.add(key);
    }
    return { field: field.name, providerDeclared: true, unique: seen.size, missing, duplicates };
  });
  return { schema: CAPTURE_SCHEMA, provider: 'opendatasoft', apiVersion: '2.1', readOnly: true, state: 'COMPLETE',
    catalogOrigin: selection.catalogOrigin, datasetId: before.dataset_id, datasetUid: before.dataset_uid ?? null,
    selection, selectionHash: identity(selection), startedAt, completedAt: stamp(),
    metadataFile: 'dataset.json', exportFile: 'records.json', metadataAfterFile: 'dataset-after.json',
    datasetTitle: summary.title, license: { title: rights.license, url: rights.licenseUrl },
    rights, fields: summary.fields, rowCount: rows.length, sourceBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    providerCountBefore: Number.isSafeInteger(expectedBefore) ? expectedBefore : null,
    providerCountAfter: Number.isSafeInteger(expectedAfter) ? expectedAfter : null,
    countMatched: countStable && rows.length === expectedBefore,
    consistency: identity(metadataVersion(before)) === identity(metadataVersion(after)) ? 'metadata-unchanged' : 'metadata-changed',
    observationKind: 'complete-json-export', identityCandidates,
    pages: [{ ...files.find(file => file.file === 'records.json'), returned: rows.length }],
    files, receipts };
}
function captureLimits(options) {
  return { maxRows: integer(options.maxRows ?? 250000, 1, 5000000, 'ODS_ROW_LIMIT_INVALID'),
    maxBytes: integer(options.maxBytes ?? 268435456, 1024, 2147483647, 'ODS_CAPTURE_LIMIT_INVALID') };
}
/** Resume only original response files in this directory; a new edition gets a new directory. */
export async function captureOpendatasoftDataset(selection, directory, options = {}) {
  const config = captureSelection(selection), selectionHash = identity(config), limits = captureLimits(options);
  await privateDirectory(dirname(directory)); await privateDirectory(directory, true);
  const release = await acquireWorkspace(directory);
  let state;
  try {
    if (await exists(join(directory, 'capture.json'))) {
      const completed = await readOpendatasoftCapture(join(directory, 'capture.json'));
      if (completed.manifest.selectionHash !== selectionHash) throw fault('ODS_CAPTURE_SELECTION_CHANGED');
      return completed;
    }
    const progressFile = join(directory, 'progress.json');
    if (await exists(progressFile)) {
      state = parseOpendatasoftJson(await readPrivate(progressFile, 16777216));
      if (state.schema !== 'stellar-forge.opendatasoft-capture-progress.v1' || state.selectionHash !== selectionHash)
        throw fault('ODS_CAPTURE_SELECTION_CHANGED');
    } else {
      state = { schema: 'stellar-forge.opendatasoft-capture-progress.v1', selection: config, selectionHash,
        startedAt: stamp(), state: 'CAPTURING', files: [], receipts: [], sourceBytes: 0 };
      await atomicJson(directory, 'progress.json', state);
    }
    const originals = new Map();
    const transport = { ...config, ...options };
    async function retain(file, action, query) {
      let received;
      const saved = state.files.find(entry => entry.file === file);
      if (saved) {
        const raw = await readPrivate(join(directory, file), config.maxResponseBytes);
        if (raw.length !== saved.bytes || digest(raw) !== saved.sha256) throw fault('ODS_RETAINED_RESPONSE_CHANGED');
        const receipt = state.receipts.find(entry => entry.file === file);
        if (!receipt) throw fault('ODS_CAPTURE_RECEIPT_MISSING');
        received = { raw, value: checkedResponse(raw), receipt };
      } else {
        // The response and request receipt are one create-only envelope, saved before the original raw file.
        const pendingFile = join(directory, file + '.received.json');
        if (await exists(pendingFile)) {
          const pending = parseOpendatasoftJson(await readPrivate(pendingFile, Math.min(config.maxResponseBytes * 2 + 8192, 536879104)));
          if (pending.requestUrl !== opendatasoftUrl(config.catalogOrigin, action, config.datasetId, query).href ||
              typeof pending.contentBase64 !== 'string') throw fault('ODS_CAPTURE_REQUEST_CHANGED');
          const raw = Buffer.from(pending.contentBase64, 'base64');
          if (pending.receipt?.sha256 !== digest(raw) || pending.receipt?.bytes !== raw.length)
            throw fault('ODS_CAPTURE_RECEIPT_CHANGED');
          received = { raw, value: checkedResponse(raw), receipt: pending.receipt };
        } else {
          received = await requestOpendatasoft(config.catalogOrigin, action, config.datasetId, query, transport);
          if (state.sourceBytes + received.raw.length > limits.maxBytes) throw fault('ODS_CAPTURE_BYTE_LIMIT');
          await createFile(pendingFile, bytes({ requestUrl: received.receipt.url,
            receipt: received.receipt, contentBase64: received.raw.toString('base64') }));
        }
        if (await exists(join(directory, file))) {
          const original = await readPrivate(join(directory, file), config.maxResponseBytes);
          if (!original.equals(received.raw)) throw fault('ODS_RETAINED_RESPONSE_CHANGED');
        } else await createFile(join(directory, file), received.raw);
        state.files.push(fileInfo(file, received.raw)); state.sourceBytes += received.raw.length;
        state.receipts.push({ file, ...received.receipt });
        await atomicJson(directory, 'progress.json', state);
      }
      originals.set(file, received.raw);
      await options.onProgress?.({ phase: file, bytes: state.sourceBytes, files: state.files.length });
      return received;
    }
    const before = await retain('dataset.json', 'dataset', { lang: config.lang, timezone: config.timezone });
    checkedMetadata(before.value, config);
    const query = selectionQuery(config), countQuery = { ...query, limit: 0, offset: 0 };
    delete countQuery.order_by;
    if (filtered(config)) await retain('count-before.json', 'records', countQuery);
    const exported = await retain('records.json', 'export', query);
    const rows = checkedRows(exported.value, before.value.fields);
    if (rows.length > limits.maxRows) throw fault('ODS_CAPTURE_ROW_LIMIT');
    await retain('dataset-after.json', 'dataset', { lang: config.lang, timezone: config.timezone });
    if (filtered(config)) await retain('count-after.json', 'records', countQuery);
    const manifest = makeManifest(config, state.files, state.receipts, originals, state.startedAt);
    await createFile(join(directory, 'capture.json'), bytes(manifest));
    state.state = 'COMPLETE'; state.rowCount = rows.length; state.error = null;
    await atomicJson(directory, 'progress.json', state);
    return await readOpendatasoftCapture(join(directory, 'capture.json'));
  } catch (error) {
    if (state) { state.error = { code: error.code ?? 'ODS_CAPTURE_INTERRUPTED', ...(error.receipt ? { receipt: error.receipt } : {}) };
      state.updatedAt = stamp(); await atomicJson(directory, 'progress.json', state).catch(() => {}); }
    throw error;
  } finally { await release(); }
}
/** Adopt an existing exact native capture, preserving its actual requests and responses. */
export async function importOpendatasoftResponses(input, directory, options = {}) {
  own(input, ['selection','metadataFile','exportFile','metadataAfterFile','countBeforeFile','countAfterFile','receipts'],
    'ODS_NATIVE_CAPTURE_INPUT_INVALID');
  const selection = captureSelection(input.selection), limits = captureLimits(options);
  const names = [['dataset.json',input.metadataFile,'dataset'],['records.json',input.exportFile,'export'],
    ['dataset-after.json',input.metadataAfterFile,'dataset'],
    ...(filtered(selection) ? [['count-before.json',input.countBeforeFile,'records'],['count-after.json',input.countAfterFile,'records']] : [])];
  if (!Array.isArray(input.receipts)) throw fault('ODS_CAPTURE_RECEIPTS_REQUIRED');
  const originals = new Map(), files = [], receipts = [];
  for (const [file, originalFile, action] of names) {
    if (typeof originalFile !== 'string') throw fault('ODS_NATIVE_CAPTURE_FILE_REQUIRED');
    const raw = await readPrivate(resolve(originalFile), selection.maxResponseBytes);
    const receipt = input.receipts.find(item => item.file === file || item.file === originalFile);
    if (action === 'records') {
      if (!receipt || receipt.method !== 'GET' || receipt.status !== 200 ||
          receipt.bytes !== raw.length || receipt.sha256 !== digest(raw))
        throw fault('ODS_CAPTURE_RECEIPT_INVALID');
      const url = new URL(receipt.url);
      const q = { ...selectionQuery(selection), limit: 0, offset: 0 }; delete q.order_by;
      if (url.href !== opendatasoftUrl(selection.catalogOrigin,'records',selection.datasetId,q).href)
        throw fault('ODS_CAPTURE_REQUEST_CHANGED');
    } else receiptBinding(receipt, raw, selection, action);
    originals.set(file, raw); files.push(fileInfo(file, raw)); receipts.push({ ...receipt, file });
  }
  const sourceBytes = files.reduce((sum,item) => sum + item.bytes, 0);
  if (sourceBytes > limits.maxBytes) throw fault('ODS_CAPTURE_BYTE_LIMIT');
  const manifest = makeManifest(selection, files, receipts, originals, receipts[0].receivedAt ?? receipts[0].retrievedAt ?? stamp());
  if (manifest.rowCount > limits.maxRows) throw fault('ODS_CAPTURE_ROW_LIMIT');
  await privateDirectory(dirname(directory)); await privateDirectory(directory, true);
  const release = await acquireWorkspace(directory);
  try {
    if (await exists(join(directory,'capture.json'))) {
      const prior = await readOpendatasoftCapture(join(directory,'capture.json'));
      if (prior.manifest.selectionHash !== manifest.selectionHash || identity(prior.manifest.files) !== identity(files))
        throw fault('ODS_CAPTURE_SELECTION_CHANGED');
      return prior;
    }
    for (const [file, raw] of originals) {
      if (await exists(join(directory,file))) {
        const previous = await readPrivate(join(directory,file), raw.length);
        if (!previous.equals(raw)) throw fault('ODS_RETAINED_RESPONSE_CHANGED');
      } else await createFile(join(directory,file), raw);
    }
    await createFile(join(directory,'capture.json'), bytes(manifest));
    return await readOpendatasoftCapture(join(directory,'capture.json'));
  } finally { await release(); }
}
export async function readOpendatasoftCapture(filename, expectedHash) {
  const manifestBytes = await readPrivate(filename, 16777216), manifestSha256 = digest(manifestBytes);
  if (expectedHash !== undefined && manifestSha256 !== expectedHash) throw fault('ODS_CAPTURE_MANIFEST_CHANGED');
  const manifest = parseOpendatasoftJson(manifestBytes);
  if (manifest?.schema !== CAPTURE_SCHEMA || manifest.provider !== 'opendatasoft' || manifest.apiVersion !== '2.1' ||
      manifest.readOnly !== true || manifest.state !== 'COMPLETE' || !Array.isArray(manifest.files) ||
      !Array.isArray(manifest.receipts) || !Array.isArray(manifest.fields) ||
      !Number.isSafeInteger(manifest.rowCount) || manifest.rowCount < 0)
    throw fault('ODS_CAPTURE_MANIFEST_INVALID');
  const selection = captureSelection(manifest.selection);
  if (identity(selection) !== manifest.selectionHash || selection.catalogOrigin !== manifest.catalogOrigin)
    throw fault('ODS_CAPTURE_SELECTION_CHANGED');
  const rawFiles = new Map();
  for (const item of manifest.files) {
    if (!/^(dataset|records|dataset-after|count-before|count-after)\.json$/.test(item.file ?? '') ||
        !HASH.test(item.sha256 ?? '') || !Number.isSafeInteger(item.bytes) || item.bytes < 1 ||
        item.bytes > 268435456 || rawFiles.has(item.file)) throw fault('ODS_CAPTURE_FILE_INVALID');
    const raw = await readPrivate(join(dirname(filename),item.file), item.bytes);
    if (raw.length !== item.bytes || digest(raw) !== item.sha256) throw fault('ODS_RETAINED_RESPONSE_CHANGED');
    rawFiles.set(item.file, raw);
    const receipt = manifest.receipts.find(receipt => receipt.file === item.file);
    if (item.file === 'records.json') receiptBinding(receipt,raw,selection,'export');
    else if (item.file.startsWith('dataset')) receiptBinding(receipt,raw,selection,'dataset');
    else {
      if (receipt?.method !== 'GET' || receipt?.status !== 200 || receipt?.sha256 !== item.sha256 ||
          receipt?.bytes !== item.bytes) throw fault('ODS_CAPTURE_RECEIPT_CHANGED');
      const q = { ...selectionQuery(selection), limit:0, offset:0 }; delete q.order_by;
      if (receipt.url !== opendatasoftUrl(selection.catalogOrigin,'records',selection.datasetId,q).href)
        throw fault('ODS_CAPTURE_REQUEST_CHANGED');
    }
  }
  for (const required of ['dataset.json','records.json','dataset-after.json'])
    if (!rawFiles.has(required)) throw fault('ODS_CAPTURE_FILE_MISSING');
  const rebuilt = makeManifest(selection, manifest.files, manifest.receipts, rawFiles, manifest.startedAt);
  for (const key of ['datasetId','datasetUid','datasetTitle','fields','license','rights','rowCount','sourceBytes',
    'providerCountBefore','providerCountAfter','countMatched','consistency','observationKind','identityCandidates','pages']) {
    if (identity(rebuilt[key]) !== identity(manifest[key])) throw fault('ODS_CAPTURE_METADATA_CHANGED');
  }
  const metadata = checkedResponse(rawFiles.get('dataset.json')), rows = checkedResponse(rawFiles.get('records.json'));
  return { manifest, manifestBytes, manifestFile: filename, manifestSha256, fields: manifest.fields,
    rows, records: rows, rawFiles, metadata, captureDirectory: dirname(filename), schema: manifest.fields, rights: manifest.rights };
}

