// MIT. Exact ArcGIS REST selections and retained feature-set captures.
import { constants } from 'node:fs';
import { open, realpath, lstat, readdir, unlink, link } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateDirectory, acquireWorkspace, createFile, atomicJson, syncDirectory, bytes, digest, identity, fault, object, stamp } from '../postgres/publisher/files.mjs';

const SCHEMA = 'stellar-forge.arcgis-capture.v1';
const HASH = /^[a-f0-9]{64}$/;
const MODES = new Set(['ARCGIS_OBJECT_ID_SELECTION', 'IMPORTED_FEATURE_SETS']);
const fail = (code, message = code) => { throw fault(code, message); };
const integer = (value, low, high, code) => {
  if (!Number.isSafeInteger(value) || value < low || value > high) fail(code);
  return value;
};
export function arcgisLayerUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('ARCGIS_LAYER_URL_INVALID'); }
  if (url.protocol !== 'https:' || url.href !== value || url.username || url.password || url.search || url.hash ||
      !/\/(FeatureServer|MapServer)\/(0|[1-9][0-9]*)$/.test(url.pathname))
    fail('ARCGIS_LAYER_URL_INVALID', 'Use the exact HTTPS FeatureServer or MapServer layer URL without credentials, query, or fragment.');
  return url.href;
}
export function arcgisMetadata(raw) {
  if (!object(raw) || raw.error || !Array.isArray(raw.fields) || !raw.fields.length || raw.fields.length > 4096)
    fail('ARCGIS_LAYER_METADATA_INVALID');
  const fields = new Map();
  for (const field of raw.fields) {
    if (!object(field) || typeof field.name !== 'string' || !field.name || fields.has(field.name) || typeof field.type !== 'string')
      fail('ARCGIS_FIELD_METADATA_INVALID');
    fields.set(field.name, field);
  }
  const oid = raw.objectIdField ?? raw.objectIdFieldName ?? [...fields.values()].find(x => x.type === 'esriFieldTypeOID')?.name;
  if (typeof oid !== 'string' || !fields.has(oid) || !['esriFieldTypeOID', 'esriFieldTypeInteger', 'esriFieldTypeBigInteger', 'esriFieldTypeBigInt', 'esriFieldTypeObjectID'].includes(fields.get(oid).type) ||
      raw.uniqueIdInfo?.OIDFieldContainsHashValue === true)
    fail('ARCGIS_STABLE_INTEGER_ID_REQUIRED', 'This connector requires a declared stable integer object-ID field.');
  if (raw.geometryType !== undefined && !['esriGeometryPoint', 'esriGeometryMultipoint', 'esriGeometryPolyline', 'esriGeometryPolygon', 'esriGeometryEnvelope'].includes(raw.geometryType))
    fail('ARCGIS_GEOMETRY_TYPE_UNSUPPORTED');
  return { raw, fields, oid, geometryType: raw.geometryType ?? null,
    maxRecordCount: Number.isSafeInteger(raw.maxRecordCount) && raw.maxRecordCount > 0 ? raw.maxRecordCount : 1000 };
}
function queryOptions(value = {}, metadata) {
  if (!object(value) || Object.keys(value).some(k => !['where', 'outFields', 'returnGeometry'].includes(k)))
    fail('ARCGIS_QUERY_OPTIONS_INVALID');
  const where = value.where ?? '1=1';
  if (typeof where !== 'string' || !where.trim() || where.length > 8192 || /[\u0000-\u001f]/.test(where))
    fail('ARCGIS_WHERE_INVALID');
  let outFields = value.outFields ?? [...metadata.fields.values()].filter(x => x.type !== 'esriFieldTypeGeometry').map(x => x.name);
  if (!Array.isArray(outFields) || !outFields.length || outFields.length > 4096 ||
      outFields.some(x => typeof x !== 'string' || !metadata.fields.has(x) || metadata.fields.get(x).type === 'esriFieldTypeGeometry') ||
      new Set(outFields).size !== outFields.length) fail('ARCGIS_OUT_FIELDS_INVALID');
  outFields = [metadata.oid, ...outFields.filter(x => x !== metadata.oid)];
  const returnGeometry = value.returnGeometry ?? Boolean(metadata.geometryType);
  if (typeof returnGeometry !== 'boolean' || returnGeometry && !metadata.geometryType) fail('ARCGIS_RETURN_GEOMETRY_INVALID');
  return { where, outFields, returnGeometry };
}
export async function readArcgisArtifact(filename, maximum = 67108864) {
  const path = resolve(filename);
  if (await realpath(path) !== path) fail('ARCGIS_SOURCE_SYMLINK');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximum) fail('ARCGIS_SOURCE_FILE_INVALID');
    const data = await handle.readFile();
    const after = await handle.stat();
    if (data.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
      fail('ARCGIS_SOURCE_CHANGED');
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); }
    catch { fail('ARCGIS_SOURCE_JSON_INVALID'); }
    return { value, data, path, sha256: digest(data), bytes: data.length };
  } finally { await handle.close(); }
}
async function referenced(base, entry) {
  if (!object(entry) || typeof entry.path !== 'string' || !HASH.test(entry.sha256 ?? '') ||
      !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > 67108864 ||
      !['wire-json', 'parsed-json'].includes(entry.representation)) fail('ARCGIS_CAPTURE_REFERENCE_INVALID');
  const file = await readArcgisArtifact(resolve(base, entry.path), entry.bytes);
  if (file.sha256 !== entry.sha256 || file.bytes !== entry.bytes) fail('ARCGIS_CAPTURE_BYTES_CHANGED');
  return file;
}
const fileEntry = (path, file, representation) => ({ path, sha256: file.sha256, bytes: file.bytes, representation });
function objectIds(value, oid) {
  if (!object(value) || value.error || value.objectIdFieldName !== oid || !Array.isArray(value.objectIds) || value.objectIds.length > 1000000 ||
      value.objectIds.some(x => !Number.isSafeInteger(x)) || new Set(value.objectIds).size !== value.objectIds.length)
    fail('ARCGIS_ID_SELECTION_INVALID');
  return [...value.objectIds].sort((a, b) => a - b);
}
function finiteJson(value, depth = 0) {
  if (depth > 32) fail('ARCGIS_GEOMETRY_TOO_DEEP');
  if (typeof value === 'number' && !Number.isFinite(value)) fail('ARCGIS_NUMBER_NOT_FINITE');
  if (Array.isArray(value)) for (const item of value) finiteJson(item, depth + 1);
  else if (object(value)) for (const item of Object.values(value)) finiteJson(item, depth + 1);
}
export function arcgisFeaturePage(value, metadata, query, expectedIds = null) {
  if (!object(value) || value.error || !Array.isArray(value.features) || value.features.length > 1000000 || value.transform ||
      value.exceededTransferLimit !== undefined && typeof value.exceededTransferLimit !== 'boolean')
    fail('ARCGIS_FEATURE_SET_INVALID');
  if (query.returnGeometry && value.geometryType !== metadata.geometryType) fail('ARCGIS_GEOMETRY_TYPE_CHANGED');
  if (query.returnGeometry && !object(value.spatialReference)) fail('ARCGIS_SPATIAL_REFERENCE_MISSING');
  if (Array.isArray(value.fields)) {
    for (const name of query.outFields) {
      const field = value.fields.find(x => x.name === name);
      if (!field || field.type !== metadata.fields.get(name).type) fail('ARCGIS_FIELD_TYPE_CHANGED');
    }
  }
  const expected = expectedIds === null ? null : new Set(expectedIds), ids = new Set(), features = [];
  for (const feature of value.features) {
    if (!object(feature) || !object(feature.attributes)) fail('ARCGIS_FEATURE_INVALID');
    const id = feature.attributes[metadata.oid];
    if (!Number.isSafeInteger(id) || ids.has(id) || expected && !expected.has(id)) fail('ARCGIS_FEATURE_ID_MISMATCH');
    for (const name of query.outFields) {
      if (!Object.hasOwn(feature.attributes, name)) fail('ARCGIS_ATTRIBUTE_MISSING');
      const item = feature.attributes[name], type = metadata.fields.get(name).type;
      if (item !== null && ['esriFieldTypeOID', 'esriFieldTypeObjectID', 'esriFieldTypeInteger', 'esriFieldTypeSmallInteger', 'esriFieldTypeBigInteger', 'esriFieldTypeBigInt', 'esriFieldTypeDate'].includes(type) && !Number.isSafeInteger(item))
        fail('ARCGIS_INTEGER_OUTSIDE_EXACT_RANGE', 'Preserve the original response; this dataset requires exact JavaScript-safe integer values.');
      if (item !== null && ['esriFieldTypeSingle', 'esriFieldTypeDouble'].includes(type) && (typeof item !== 'number' || !Number.isFinite(item)))
        fail('ARCGIS_NUMBER_INVALID');
      if (item !== null && ['esriFieldTypeString', 'esriFieldTypeGUID', 'esriFieldTypeGlobalID', 'esriFieldTypeXML', 'esriFieldTypeDateOnly', 'esriFieldTypeTimeOnly', 'esriFieldTypeTimestampOffset'].includes(type) && typeof item !== 'string')
        fail('ARCGIS_TEXT_INVALID');
    }
    if (query.returnGeometry) {
      if (!Object.hasOwn(feature, 'geometry') || feature.geometry !== null && !object(feature.geometry)) fail('ARCGIS_GEOMETRY_MISSING');
      finiteJson(feature.geometry);
      if (feature.geometry?.spatialReference && identity(feature.geometry.spatialReference) !== identity(value.spatialReference))
        fail('ARCGIS_SPATIAL_REFERENCE_CHANGED');
    }
    ids.add(id); features.push(feature);
  }
  return { features, ids: [...ids].sort((a, b) => a - b), spatialReference: query.returnGeometry ? value.spatialReference : null,
    exceeded: value.exceededTransferLimit === true,
    missing: expected ? expectedIds.filter(id => !ids.has(id)) : [] };
}
async function requestJson(url, { tokenEnv, environment, signal, maximum }) {
  const headers = { accept: 'application/json' };
  if (tokenEnv) {
    const token = environment[tokenEnv];
    if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) fail('ARCGIS_TOKEN_ENVIRONMENT_MISSING');
    headers['x-esri-authorization'] = 'Bearer ' + token;
  }
  let response;
  try { response = await fetch(url, { headers, redirect: 'error', credentials: 'omit', signal }); }
  catch { fail(signal.aborted ? 'ARCGIS_CAPTURE_INTERRUPTED' : 'ARCGIS_SOURCE_UNREACHABLE'); }
  if (response.status !== 200) { await response.body?.cancel(); fail('ARCGIS_HTTP_' + response.status); }
  const parts = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maximum) fail('ARCGIS_RESPONSE_TOO_LARGE');
    parts.push(chunk);
  }
  const data = Buffer.concat(parts), file = { data, sha256: digest(data), bytes: data.length };
  try { file.value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); }
  catch { fail('ARCGIS_RESPONSE_JSON_INVALID'); }
  if (!object(file.value) || file.value.error) fail('ARCGIS_SERVICE_ERROR');
  return file;
}
const requestUrl = (layer, parameters) => {
  const url = new URL(layer);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value));
  return url.href;
};
async function underLock(directory, action) {
  await privateDirectory(directory);
  const release = await acquireWorkspace(directory);
  try {
    for (const name of await readdir(directory)) {
      if (!/^arcgis-response-[a-f0-9-]{36}\.tmp$/.test(name)) continue;
      const path = join(directory, name), info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.mode & 0o077) fail('ARCGIS_STAGING_FILE_INVALID');
      await unlink(path);
    }
    return await action();
  } finally { await release(); }
}
function captureSettings(options) {
  const { layerUrl, tokenEnv, pageSize = 250, maxRows = 250000, maxSourceBytes = 67108864, maxPageBytes = 16777216, timeoutMs = 120000 } = options;
  if (tokenEnv !== undefined && (typeof tokenEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv))) fail('ARCGIS_TOKEN_REFERENCE_INVALID');
  return { layerUrl: arcgisLayerUrl(layerUrl), ...(tokenEnv ? { tokenEnv } : {}),
    pageSize: integer(pageSize, 1, 1000, 'ARCGIS_PAGE_SIZE_INVALID'),
    maxRows: integer(maxRows, 1, 1000000, 'ARCGIS_ROW_LIMIT_INVALID'),
    maxSourceBytes: integer(maxSourceBytes, 1024, 268435456, 'ARCGIS_BYTE_LIMIT_INVALID'),
    maxPageBytes: integer(maxPageBytes, 1024, 67108864, 'ARCGIS_PAGE_BYTES_INVALID'),
    timeoutMs: integer(timeoutMs, 100, 300000, 'ARCGIS_TIMEOUT_INVALID') };
}
async function initializeCapture(directory, state) {
  try { await lstat(join(directory, 'capture.json')); fail('ARCGIS_CAPTURE_EXISTS', 'Continue the existing capture or choose a new directory.'); }
  catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
  await atomicJson(directory, 'capture.json', state);
}
export async function createArcgisCapture(options) {
  if (!object(options) || Object.keys(options).some(key => !['directory', 'query', 'layerUrl', 'tokenEnv', 'pageSize', 'maxRows', 'maxSourceBytes', 'maxPageBytes', 'timeoutMs', 'environment'].includes(key))) fail('ARCGIS_CAPTURE_OPTIONS_INVALID');
  const { directory, query = {} } = options, settings = captureSettings(options);
  if (!object(query) || Object.keys(query).some(k => !['where', 'outFields', 'returnGeometry'].includes(k))) fail('ARCGIS_QUERY_OPTIONS_INVALID');
  await privateDirectory(directory, true);
  return underLock(directory, async () => {
    const state = { schema: SCHEMA, id: randomUUID(), state: 'COLLECTING', createdAt: stamp(), updatedAt: stamp(),
      mode: 'ARCGIS_OBJECT_ID_SELECTION', settings, query: structuredClone(query), metadata: null,
      selection: null, ids: [], pages: [], pending: [], spatialReference: null, sourceBytes: 0 };
    await initializeCapture(directory, state);
    return { id: state.id, state: state.state, selectedRecords: null, directory };
  });
}
export async function importArcgisCapture({ directory, layerUrl, metadataFile, pageFiles, query = {},
  representation = 'parsed-json', maxRows = 250000, maxSourceBytes = 67108864, geometryJoin = null } = {}) {
  if (!Array.isArray(pageFiles) || !pageFiles.length || pageFiles.length > 4096 || !['wire-json', 'parsed-json'].includes(representation))
    fail('ARCGIS_IMPORT_FILES_REQUIRED');
  const settings = captureSettings({ layerUrl, maxRows, maxSourceBytes });
  await privateDirectory(directory, true);
  return underLock(directory, async () => {
    try { await lstat(join(directory, 'capture.json')); fail('ARCGIS_CAPTURE_EXISTS', 'Continue the existing capture or choose a new directory.'); }
    catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
    const original = await readArcgisArtifact(metadataFile, 2097152), metadata = arcgisMetadata(original.value);
    const selected = queryOptions(query, metadata), pending = [];
    if (geometryJoin && (!object(geometryJoin) || Object.keys(geometryJoin).some(k => !['field', 'pageFiles'].includes(k)) ||
        !selected.returnGeometry || !selected.outFields.includes(geometryJoin.field) || !Array.isArray(geometryJoin.pageFiles) ||
        !geometryJoin.pageFiles.length || geometryJoin.pageFiles.length > 4096)) fail('ARCGIS_GEOMETRY_JOIN_INVALID');
    let sourceBytes = original.bytes;
    for (const path of pageFiles) {
      const file = await readArcgisArtifact(path, settings.maxPageBytes);
      sourceBytes += file.bytes;
      if (sourceBytes > settings.maxSourceBytes) fail('ARCGIS_CAPTURE_TOO_LARGE');
      const name = 'page-' + file.sha256 + '.json'; await retainResponse(directory, name, file);
      pending.push(fileEntry(name, file, representation));
    }
    const joined = geometryJoin ? { field: geometryJoin.field, pages: [] } : null;
    for (const path of geometryJoin?.pageFiles ?? []) {
      const file = await readArcgisArtifact(path, settings.maxPageBytes); sourceBytes += file.bytes;
      if (sourceBytes > settings.maxSourceBytes) fail('ARCGIS_CAPTURE_TOO_LARGE');
      const name = 'geometry-' + file.sha256 + '.json'; await retainResponse(directory, name, file);
      joined.pages.push(fileEntry(name, file, representation));
    }
    const metadataName = 'layer-' + original.sha256 + '.json'; await retainResponse(directory, metadataName, original);
    const state = { schema: SCHEMA, id: randomUUID(), state: 'COLLECTING', createdAt: stamp(), updatedAt: stamp(),
      mode: 'IMPORTED_FEATURE_SETS', settings, query: selected, geometryJoin: joined,
      metadata: fileEntry(metadataName, original, representation), selection: null, ids: [],
      pages: [], pending, spatialReference: null, sourceBytes };
    await initializeCapture(directory, state);
    return { id: state.id, state: state.state, pendingFiles: pending.length, directory };
  });
}
async function stateRecord(directory) {
  const record = await readArcgisArtifact(join(directory, 'capture.json'), 33554432), state = record.value;
  if (!object(state) || state.schema !== SCHEMA || !MODES.has(state.mode) || !['COLLECTING', 'COMPLETE'].includes(state.state) ||
      !Array.isArray(state.pages) || !Array.isArray(state.ids) || !Array.isArray(state.pending) || state.pages.length > 1000000)
    fail('ARCGIS_CAPTURE_STATE_INVALID');
  captureSettings(state.settings);
  if (state.metadata === null) {
    if (state.mode !== 'ARCGIS_OBJECT_ID_SELECTION' || state.state !== 'COLLECTING' || state.selection || state.ids.length || state.pages.length || state.pending.length || state.sourceBytes !== 0)
      fail('ARCGIS_CAPTURE_STATE_INVALID');
    return { ...record, state, metadata: null };
  }
  const metadata = arcgisMetadata((await referenced(directory, state.metadata)).value);
  if (identity(queryOptions(state.query, metadata)) !== identity(state.query)) fail('ARCGIS_CAPTURE_QUERY_CHANGED');
  if (state.mode === 'ARCGIS_OBJECT_ID_SELECTION' && !state.selection && (state.state === 'COMPLETE' || state.ids.length || state.pages.length || state.pending.length)) fail('ARCGIS_CAPTURE_SELECTION_MISSING');
  if (state.mode === 'ARCGIS_OBJECT_ID_SELECTION' && state.selection && identity(objectIds((await referenced(directory, state.selection)).value, metadata.oid)) !== identity(state.ids))
    fail('ARCGIS_CAPTURE_SELECTION_CHANGED');
  return { ...record, state, metadata };
}
async function retainResponse(directory, name, file) {
  const temporary = join(directory, 'arcgis-response-' + randomUUID() + '.tmp'), target = join(directory, name);
  await createFile(temporary, file.data);
  try {
    try { await link(temporary, target); }
    catch (issue) {
      if (issue.code !== 'EEXIST') throw issue;
      const prior = await readArcgisArtifact(target, file.bytes);
      if (prior.sha256 !== file.sha256 || prior.bytes !== file.bytes) fail('ARCGIS_PAGE_BYTES_CHANGED');
    }
    await syncDirectory(directory);
  } finally { await unlink(temporary); await syncDirectory(directory); }
}
const featureQuery = state => state.geometryJoin ? { ...state.query, returnGeometry: false } : state.query;
function joinIdentity(value) {
  if (typeof value === 'string' && value.length && value.length <= 4096 || Number.isSafeInteger(value))
    return typeof value + ':' + JSON.stringify(value);
  fail('ARCGIS_JOIN_ID_INVALID', 'The original join field must contain nonempty text or exact integers.');
}
async function attachGeometry(directory, state, metadata, records) {
  const join = state.geometryJoin;
  if (state.mode !== 'IMPORTED_FEATURE_SETS' || !object(join) || typeof join.field !== 'string' ||
      !state.query.outFields.includes(join.field) || !Array.isArray(join.pages) || !join.pages.length || join.pages.length > 4096)
    fail('ARCGIS_GEOMETRY_JOIN_INVALID');
  const targets = new Map(), seen = new Set(), pageHashes = [];
  for (const record of records.values()) {
    const key = joinIdentity(record.attributes[join.field]);
    if (targets.has(key)) fail('ARCGIS_DUPLICATE_JOIN_ID');
    targets.set(key, record);
  }
  let spatialReference = null, sourceBytes = 0;
  for (const entry of join.pages) {
    const file = await referenced(directory, entry), page = file.value;
    if (!object(page) || page.error || page.transform || page.exceededTransferLimit === true ||
        !Array.isArray(page.features) || page.geometryType !== metadata.geometryType || !object(page.spatialReference))
      fail('ARCGIS_JOIN_FEATURE_SET_INVALID');
    if (spatialReference && identity(spatialReference) !== identity(page.spatialReference)) fail('ARCGIS_SPATIAL_REFERENCE_CHANGED');
    spatialReference = page.spatialReference; sourceBytes += file.bytes; pageHashes.push(file.sha256);
    for (const feature of page.features) {
      if (!object(feature) || !object(feature.attributes) || !Object.hasOwn(feature, 'geometry') ||
          feature.geometry !== null && !object(feature.geometry)) fail('ARCGIS_JOIN_FEATURE_INVALID');
      const key = joinIdentity(feature.attributes[join.field]), target = targets.get(key);
      if (!target || seen.has(key)) fail('ARCGIS_GEOMETRY_JOIN_COVERAGE_MISMATCH');
      for (const [name, value] of Object.entries(feature.attributes))
        if (Object.hasOwn(target.attributes, name) && identity(value) !== identity(target.attributes[name]))
          fail('ARCGIS_GEOMETRY_ATTRIBUTE_CHANGED');
      finiteJson(feature.geometry);
      if (feature.geometry?.spatialReference && identity(feature.geometry.spatialReference) !== identity(spatialReference))
        fail('ARCGIS_SPATIAL_REFERENCE_CHANGED');
      target.geometry = feature.geometry; seen.add(key);
    }
  }
  if (seen.size !== records.size) fail('ARCGIS_GEOMETRY_JOIN_COVERAGE_MISMATCH');
  return { spatialReference, sourceBytes, pageHashes };
}
export async function continueArcgisCapture(directory, { environment = process.env, signal, maxPages = Infinity } = {}) {
  if (maxPages !== Infinity) integer(maxPages, 1, 1000000, 'ARCGIS_CONTINUE_LIMIT_INVALID');
  return underLock(directory, async () => {
    let { state, metadata } = await stateRecord(directory);
    if (state.state === 'COMPLETE') return captureStatus(directory);
    const deadline = AbortSignal.timeout(state.settings.timeoutMs), combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    if (!metadata) {
      const file = await requestJson(requestUrl(state.settings.layerUrl, { f: 'json' }),
        { ...state.settings, environment, signal: combined, maximum: 2097152 });
      metadata = arcgisMetadata(file.value);
      state.query = queryOptions(state.query, metadata);
      const name = 'layer-' + file.sha256 + '.json';
      await retainResponse(directory, name, file);
      state.metadata = fileEntry(name, file, 'wire-json'); state.sourceBytes = file.bytes; state.updatedAt = stamp();
      await atomicJson(directory, 'capture.json', state);
    }
    if (state.mode === 'ARCGIS_OBJECT_ID_SELECTION' && !state.selection) {
      const file = await requestJson(requestUrl(state.settings.layerUrl + '/query',
        { f: 'json', where: state.query.where, returnIdsOnly: true, returnGeometry: false }),
        { ...state.settings, environment, signal: combined, maximum: 16777216 });
      state.ids = objectIds(file.value, metadata.oid);
      if (state.ids.length > state.settings.maxRows) fail('ARCGIS_SELECTION_TOO_LARGE');
      if (state.sourceBytes + file.bytes > state.settings.maxSourceBytes) fail('ARCGIS_CAPTURE_TOO_LARGE');
      const name = 'selection-' + file.sha256 + '.json'; await retainResponse(directory, name, file);
      state.selection = fileEntry(name, file, 'wire-json'); state.sourceBytes += file.bytes;
      const size = Math.min(state.settings.pageSize, metadata.maxRecordCount);
      for (let i = 0; i < state.ids.length; i += size) state.pending.push(state.ids.slice(i, i + size));
      state.updatedAt = stamp(); await atomicJson(directory, 'capture.json', state);
    }
    const seen = new Set(), initialIds = new Set(state.ids), pageBudget = Math.min(maxPages, 1000000);
    let reference = null;
    for (const page of state.pages) {
      const parsed = arcgisFeaturePage((await referenced(directory, page.file)).value, metadata, featureQuery(state), page.ids);
      if (parsed.exceeded || parsed.missing.length || identity(parsed.ids) !== identity(page.ids)) fail('ARCGIS_RETAINED_PAGE_CHANGED');
      for (const id of parsed.ids) { if (seen.has(id)) fail('ARCGIS_DUPLICATE_FEATURE'); seen.add(id); }
      if (state.query.returnGeometry && !state.geometryJoin) {
        if (reference && identity(reference) !== identity(parsed.spatialReference)) fail('ARCGIS_SPATIAL_REFERENCE_CHANGED');
        reference = parsed.spatialReference;
      }
    }
    if (!state.geometryJoin && identity(reference) !== identity(state.spatialReference)) fail('ARCGIS_CAPTURE_SPATIAL_REFERENCE_CHANGED');
    let processed = 0;
    while (state.pending.length && processed < pageBudget) {
      if (combined.aborted) fail('ARCGIS_CAPTURE_INTERRUPTED');
      let file, requested, entry;
      if (state.mode === 'IMPORTED_FEATURE_SETS') {
        entry = state.pending[0]; file = await referenced(directory, entry); requested = null;
      } else {
        requested = state.pending[0];
        if (!Array.isArray(requested) || !requested.length || requested.some(id => !initialIds.has(id) || seen.has(id))) fail('ARCGIS_PENDING_IDS_INVALID');
        file = await requestJson(requestUrl(state.settings.layerUrl + '/query', { f: 'json', where: state.query.where,
          objectIds: requested.join(','), outFields: state.query.outFields.join(','), returnGeometry: state.query.returnGeometry,
          returnZ: true, returnM: true, returnTrueCurves: true }),
          { ...state.settings, environment, signal: combined, maximum: state.settings.maxPageBytes });
      }
      const parsed = arcgisFeaturePage(file.value, metadata, featureQuery(state), requested);
      if (parsed.exceeded) {
        if (state.mode === 'IMPORTED_FEATURE_SETS') fail('ARCGIS_IMPORTED_PAGE_INCOMPLETE', 'The retained page reports exceededTransferLimit; import complete original feature sets.');
        if (requested.length < 2) fail('ARCGIS_SINGLE_FEATURE_TRUNCATED');
        const middle = Math.ceil(requested.length / 2);
        state.pending.splice(0, 1, requested.slice(0, middle), requested.slice(middle));
        state.updatedAt = stamp(); await atomicJson(directory, 'capture.json', state); continue;
      }
      if (parsed.missing.length) fail('ARCGIS_SELECTED_FEATURES_CHANGED', 'The saved object-ID selection is no longer complete; retain this capture and start a new source selection.');
      if (state.query.returnGeometry && !state.geometryJoin && state.spatialReference && identity(state.spatialReference) !== identity(parsed.spatialReference))
        fail('ARCGIS_SPATIAL_REFERENCE_CHANGED');
      for (const id of parsed.ids) {
        if (seen.has(id)) fail('ARCGIS_DUPLICATE_FEATURE');
        seen.add(id);
      }
      if (seen.size > state.settings.maxRows) fail('ARCGIS_SELECTION_TOO_LARGE');
      if (state.mode !== 'IMPORTED_FEATURE_SETS') {
        if (state.sourceBytes + file.bytes > state.settings.maxSourceBytes) fail('ARCGIS_CAPTURE_TOO_LARGE');
        const name = 'page-' + file.sha256 + '.json';
        await retainResponse(directory, name, file);
        entry = fileEntry(name, file, 'wire-json'); state.sourceBytes += file.bytes;
      }
      state.pages.push({ file: entry, ids: parsed.ids });
      state.pending.shift(); state.spatialReference = parsed.spatialReference; state.updatedAt = stamp();
      if (state.mode === 'IMPORTED_FEATURE_SETS') state.ids = [...seen].sort((a, b) => a - b);
      await atomicJson(directory, 'capture.json', state); processed++;
    }
    if (!state.pending.length) {
      if (identity([...seen].sort((a, b) => a - b)) !== identity(state.ids)) fail('ARCGIS_CAPTURE_COVERAGE_MISMATCH');
      if (state.geometryJoin) {
        const records = new Map();
        for (const page of state.pages) {
          const parsed = arcgisFeaturePage((await referenced(directory, page.file)).value, metadata, featureQuery(state), page.ids);
          for (const feature of parsed.features) records.set(feature.attributes[metadata.oid], feature);
        }
        state.spatialReference = (await attachGeometry(directory, state, metadata, records)).spatialReference;
      }
      state.state = 'COMPLETE'; state.completedAt = stamp(); state.updatedAt = state.completedAt;
      await atomicJson(directory, 'capture.json', state);
    }
    return captureStatus(directory);
  });
}
export async function captureStatus(directory) {
  const { state, sha256 } = await stateRecord(directory);
  return { schema: SCHEMA, id: state.id, state: state.state, captureSha256: sha256, directory,
    layerUrl: state.settings.layerUrl, selectionKind: state.mode, selectedRecords: state.ids.length,
    retainedPages: state.pages.length, pendingPages: state.pending.length, sourceBytes: state.sourceBytes,
    query: state.query, spatialReference: state.spatialReference, completedAt: state.completedAt ?? null };
}
export async function readArcgisCapture(directory, expectedSha256) {
  const record = await stateRecord(directory), { state, metadata } = record;
  if (state.state !== 'COMPLETE' || state.pending.length) fail('ARCGIS_CAPTURE_NOT_COMPLETE');
  if (expectedSha256 && record.sha256 !== expectedSha256) fail('ARCGIS_CAPTURE_CHANGED');
  const records = new Map(), pageHashes = [];
  let sourceBytes = state.metadata.bytes + (state.selection?.bytes ?? 0), spatialReference = null;
  for (const page of state.pages) {
    const file = await referenced(directory, page.file), parsed = arcgisFeaturePage(file.value, metadata, featureQuery(state), page.ids);
    if (parsed.exceeded || parsed.missing.length || identity(parsed.ids) !== identity(page.ids)) fail('ARCGIS_RETAINED_PAGE_CHANGED');
    if (state.query.returnGeometry && !state.geometryJoin) {
      if (spatialReference && identity(spatialReference) !== identity(parsed.spatialReference)) fail('ARCGIS_SPATIAL_REFERENCE_CHANGED');
      spatialReference = parsed.spatialReference;
    }
    for (const feature of parsed.features) {
      const id = feature.attributes[metadata.oid];
      if (records.has(id)) fail('ARCGIS_DUPLICATE_FEATURE');
      records.set(id, feature);
    }
    sourceBytes += file.bytes; pageHashes.push(file.sha256);
    if (sourceBytes > state.settings.maxSourceBytes || records.size > state.settings.maxRows) fail('ARCGIS_CAPTURE_TOO_LARGE');
  }
  if (state.geometryJoin) {
    const joined = await attachGeometry(directory, state, metadata, records);
    sourceBytes += joined.sourceBytes; spatialReference = joined.spatialReference; pageHashes.push(...joined.pageHashes);
  }
  if (sourceBytes !== state.sourceBytes || identity(spatialReference) !== identity(state.spatialReference) ||
      identity([...records.keys()].sort((a,b) => a-b)) !== identity(state.ids)) fail('ARCGIS_CAPTURE_COVERAGE_MISMATCH');
  return { state, metadata, sha256: record.sha256, records, pageHashes, sourceBytes };
}

