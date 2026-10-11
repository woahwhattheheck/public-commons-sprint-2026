// MIT. Typed ArcGIS capture projection into the original retained publisher.
import { dirname, join, resolve } from 'node:path';
import { readArcgisCapture, captureStatus } from './capture.mjs';
import { openSourceDatasetPublisher } from '../postgres/publisher/model.mjs';
import { loadCsvDataset } from '../dataset-handler.mjs';
import { csvLine } from '../postgres/publisher/plan.mjs';
import { datasetExtractionOptions } from '../postgres/publisher/stream.mjs';
import { object, bytes, digest, identity, readPrivate, createFile, fault } from '../postgres/publisher/files.mjs';

const HASH = /^[a-f0-9]{64}$/;
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const fail = (code, message = code) => { throw fault(code, message); };
const only = (value, names, code) => {
  if (!object(value) || Object.keys(value).some(key => !names.includes(key))) fail(code);
};
function fieldType(field) {
  if (['esriFieldTypeOID', 'esriFieldTypeObjectID', 'esriFieldTypeSmallInteger', 'esriFieldTypeInteger', 'esriFieldTypeBigInteger', 'esriFieldTypeBigInt', 'esriFieldTypeDate'].includes(field.type)) return 'integer';
  if (['esriFieldTypeSingle', 'esriFieldTypeDouble'].includes(field.type)) return 'number';
  if (['esriFieldTypeString', 'esriFieldTypeGUID', 'esriFieldTypeGlobalID', 'esriFieldTypeXML', 'esriFieldTypeDateOnly', 'esriFieldTypeTimeOnly', 'esriFieldTypeTimestampOffset'].includes(field.type)) return 'string';
  fail('ARCGIS_FIELD_TYPE_UNSUPPORTED', 'Use the explicit attributes JSON projection to retain this native field type.');
}
function compileQuery(value, capture) {
  only(value, ['columns'], 'ARCGIS_QUERY_DECLARATION_INVALID');
  if (!object(value.columns) || !Object.keys(value.columns).length || Object.keys(value.columns).length > 64)
    fail('ARCGIS_PROJECTION_COLUMNS_REQUIRED');
  const entries = [], sourceColumns = [], native = capture.metadata;
  for (const [name, raw] of Object.entries(value.columns)) {
    if (!NAME.test(name) || ['constructor', 'prototype', '__proto__'].includes(name)) fail('ARCGIS_PUBLIC_COLUMN_INVALID');
    only(raw, ['field', 'source'], 'ARCGIS_COLUMN_PROJECTION_INVALID');
    if ((raw.field === undefined) === (raw.source === undefined)) fail('ARCGIS_COLUMN_PROJECTION_INVALID');
    if (raw.field !== undefined) {
      if (typeof raw.field !== 'string' || !capture.state.query.outFields.includes(raw.field)) fail('ARCGIS_FIELD_NOT_CAPTURED');
      const field = native.fields.get(raw.field), type = fieldType(field);
      entries.push({ name, field: raw.field, type, nullable: field.nullable !== false && raw.field !== native.oid });
      sourceColumns.push({ name, field: raw.field, alias: field.alias ?? raw.field, nativeType: field.type, type,
        nullable: field.nullable !== false && raw.field !== native.oid });
    } else {
      if (!['attributes', 'geometry', 'spatialReference'].includes(raw.source) ||
          ['geometry', 'spatialReference'].includes(raw.source) && !capture.state.query.returnGeometry)
        fail('ARCGIS_JSON_SOURCE_INVALID');
      entries.push({ name, source: raw.source, type: 'string', nullable: false });
      sourceColumns.push({ name, source: raw.source, encoding: 'json', type: 'string', nullable: false });
    }
  }
  const idColumn = entries.find(item => item.field === native.oid)?.name;
  if (!idColumn || entries[0].name !== idColumn)
    fail('ARCGIS_OBJECT_ID_COLUMN_REQUIRED', 'Put an explicit native object-ID projection first to retain deterministic source ordering.');
  return { entries, columns: entries.map(item => item.name), columnTypes: sourceColumns,
    parameters: {}, idColumn,
    serviceQuery: { protocol: 'ArcGIS REST', layerUrl: capture.state.settings.layerUrl, ...capture.state.query,
      objectIdField: native.oid, geometryType: native.geometryType, spatialReference: capture.state.spatialReference,
      selectionKind: capture.state.mode, selectedRecords: capture.state.ids.length, captureSha256: capture.sha256 } };
}
async function sourceRecord(path) {
  const original = await readPrivate(path), value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(original));
  only(value, ['schema', 'captureDirectory', 'captureSha256', 'queries'], 'ARCGIS_SOURCE_INVALID');
  if (value.schema !== 'stellar-forge.arcgis-source.v1' || typeof value.captureDirectory !== 'string' || !HASH.test(value.captureSha256 ?? '') ||
      !object(value.queries) || !Object.keys(value.queries).length || Object.keys(value.queries).length > 32)
    fail('ARCGIS_SOURCE_INVALID');
  const captureDirectory = resolve(dirname(path), value.captureDirectory);
  const capture = await readArcgisCapture(captureDirectory, value.captureSha256);
  const queries = Object.fromEntries(Object.entries(value.queries).map(([name, query]) => {
    if (!NAME.test(name) || ['constructor', 'prototype', '__proto__'].includes(name)) fail('ARCGIS_QUERY_NAME_INVALID');
    return [name, compileQuery(query, capture)];
  }));
  return { original, value, capture, captureDirectory, queries };
}
const describeQuery = query => ({ columns: query.columns, columnTypes: query.columnTypes, parameters: {},
  serviceQuery: query.serviceQuery });
export async function inspectArcgisPublicationSource(path) {
  const source = await sourceRecord(path);
  return { hash: digest(source.original), bytes: source.original.length, queries: Object.fromEntries(
    Object.entries(source.queries).map(([name, query]) => [name, describeQuery(query)])) };
}
export async function createArcgisSource({ captureDirectory, output, query = 'records', columns } = {}) {
  const capture = await readArcgisCapture(resolve(captureDirectory));
  if (!columns) {
    columns = { object_id: { field: capture.metadata.oid } };
    for (const field of capture.state.query.outFields) {
      if (field === capture.metadata.oid || !NAME.test(field) || ['constructor', 'prototype', '__proto__', 'object_id', 'attributes_json', 'geometry_json', 'spatial_reference_json'].includes(field) || Object.keys(columns).length >= 60) continue;
      try { fieldType(capture.metadata.fields.get(field)); } catch { continue; }
      columns[field] = { field };
    }
    columns.attributes_json = { source: 'attributes' };
    if (capture.state.query.returnGeometry) {
      columns.geometry_json = { source: 'geometry' };
      columns.spatial_reference_json = { source: 'spatialReference' };
    }
  }
  compileQuery({ columns }, capture);
  if (!NAME.test(query) || ['constructor', 'prototype', '__proto__'].includes(query)) fail('ARCGIS_QUERY_NAME_INVALID');
  const value = { schema: 'stellar-forge.arcgis-source.v1', captureDirectory: resolve(captureDirectory),
    captureSha256: capture.sha256, queries: { [query]: { columns } } };
  const data = bytes(value); await createFile(resolve(output), data);
  return { path: resolve(output), sourceHash: digest(data), capture: await captureStatus(resolve(captureDirectory)),
    queries: { [query]: describeQuery(compileQuery({ columns }, capture)) } };
}
export async function captureArcgisPublicationPlan(sourceFile, directory, input) {
  only(input, ['title', 'query', 'input', 'dataset', 'extraction', 'sourceHash'], 'INVALID_PUBLICATION_PLAN');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 128) fail('PLAN_TITLE_REQUIRED');
  const source = await sourceRecord(sourceFile);
  if (digest(source.original) !== input.sourceHash) throw fault('SOURCE_REVIEW_CHANGED', 'Reload the source before saving this plan.', 409);
  const query = source.queries[input.query];
  if (!query) fail('QUERY_NOT_FOUND');
  if (!object(input.input ?? {}) || Object.keys(input.input ?? {}).length) fail('ARCGIS_CAPTURE_PARAMETERS_NOT_ALLOWED');
  const extraction = datasetExtractionOptions(query, input.extraction);
  if (extraction.order.length !== 1 || extraction.order[0].column !== query.idColumn || extraction.order[0].direction !== 'asc')
    fail('ARCGIS_SOURCE_ORDER_REQUIRED', 'Use the first object-ID column ascending; public dataset sorting remains independently selectable.');
  if (source.capture.records.size > extraction.maxRows) fail('DATASET_EXTRACTION_TOO_MANY_ROWS');
  only(input.dataset, ['name', 'columns', 'filters', 'ranges', 'sorts', 'maxCellChars', 'defaultLimit', 'maxLimit', 'maxPageBytes'], 'INVALID_DATASET_PLAN');
  if (!object(input.dataset.columns) || !Object.keys(input.dataset.columns).length ||
      Object.keys(input.dataset.columns).some(name => !query.columns.includes(name))) fail('DATASET_COLUMN_NOT_IN_QUERY');
  const columns = Object.fromEntries(Object.entries(input.dataset.columns).map(([name, raw]) => {
    const spec = typeof raw === 'string' ? { type: raw, nullable: false } : raw;
    only(spec, ['type', 'nullable'], 'INVALID_DATASET_COLUMN');
    return [name, { type: spec.type, nullable: spec.nullable ?? false }];
  }));
  checkColumnTypes(columns, query.columnTypes);
  const dataset = { schema: 'stellar-forge.csv-dataset.v1', file: 'data.csv', name: input.dataset.name,
    columns, filters: input.dataset.filters ?? [], ranges: input.dataset.ranges ?? [], sorts: input.dataset.sorts ?? [],
    maxBytes: extraction.maxBytes, maxRows: extraction.maxRows, maxCellChars: input.dataset.maxCellChars ?? 65536,
    defaultLimit: input.dataset.defaultLimit ?? 50, maxLimit: input.dataset.maxLimit ?? 250, maxPageBytes: input.dataset.maxPageBytes ?? 921600 };
  await createFile(join(directory, 'schema.csv'), csvLine(Object.keys(columns)));
  await loadCsvDataset({ ...dataset, file: join(directory, 'schema.csv') });
  const runtime = { ...source.value, captureDirectory: source.captureDirectory }, runtimeBytes = bytes(runtime);
  await createFile(join(directory, 'original-source.json'), source.original);
  await createFile(join(directory, 'source.json'), runtimeBytes);
  const plan = { schema: 'stellar-forge.arcgis-dataset-plan.v1', title: input.title.trim(), query: input.query, input: {},
    dataset, extraction, sourceHash: digest(source.original), sourceBytes: source.original.length,
    runtimeSourceHash: digest(runtimeBytes), queryHash: identity(query), sourceQuery: describeQuery(query),
    captureSha256: source.capture.sha256 };
  plan.digest = identity(plan); await createFile(join(directory, 'plan.json'), bytes(plan)); return plan;
}
function checkColumnTypes(columns, types) {
  if (!Array.isArray(types)) fail('DATASET_COLUMN_TYPE_MISMATCH');
  for (const [name, spec] of Object.entries(columns)) {
    const native = types.find(item => item.name === name);
    if (!native || spec.type !== native.type || typeof spec.nullable !== 'boolean') fail('DATASET_COLUMN_TYPE_MISMATCH');
  }
}
function encodeRow(row, dataset) {
  return csvLine(Object.entries(dataset.columns).map(([name, spec]) => {
    const value = row[name];
    if (value === null) { if (!spec.nullable) fail('DATASET_NULL_NOT_ALLOWED'); return ''; }
    if (spec.type === 'string' && typeof value !== 'string' ||
        spec.type === 'integer' && !Number.isSafeInteger(value) ||
        spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) fail('ARCGIS_COLUMN_VALUE_INVALID');
    const text = String(value);
    if (text.length > dataset.maxCellChars) fail('DATASET_CELL_TOO_LARGE');
    if (!text && spec.nullable) fail('DATASET_EMPTY_NULL_CONFLICT', 'The original CSV format distinguishes NULL using an empty nullable cell; retain this value in attributes_json or choose non-nullable text.');
    return text;
  }));
}
async function openSource(filename) {
  const source = await sourceRecord(filename);
  let closed = false;
  return { source: {
    inspect: () => ({ columnTypes: Object.fromEntries(Object.entries(source.queries).map(([name, query]) => [name, query.columnTypes])) }),
    async exportDataset(name, input, options) {
      if (closed) fail('ARCGIS_SOURCE_CLOSED');
      const query = source.queries[name];
      if (!query || !object(input ?? {}) || Object.keys(input ?? {}).length) fail('ARCGIS_QUERY_INVALID');
      const limits = datasetExtractionOptions(query, Object.fromEntries(['maxRows', 'maxBytes', 'maxRowBytes', 'timeoutMs', 'order'].map(key => [key, options[key]])));
      if (limits.order.length !== 1 || limits.order[0].column !== query.idColumn || limits.order[0].direction !== 'asc') fail('ARCGIS_SOURCE_ORDER_REQUIRED');
      const started = performance.now(); let rowCount = 0, sourceTextBytes = 0;
      for (const id of source.capture.state.ids) {
        if (closed || options.signal?.aborted) fail('ARCGIS_EXTRACTION_CANCELLED');
        if (performance.now() - started > limits.timeoutMs) fail('QUERY_TIMEOUT');
        if (rowCount >= limits.maxRows) fail('DATASET_EXTRACTION_TOO_MANY_ROWS');
        const feature = source.capture.records.get(id);
        const attributes = Object.fromEntries(source.capture.state.query.outFields.map(name => [name, feature.attributes[name]]));
        const row = Object.fromEntries(query.entries.map(item => {
          const value = item.field !== undefined ? feature.attributes[item.field] : JSON.stringify(
            item.source === 'attributes' ? attributes : item.source === 'geometry' ? feature.geometry : source.capture.state.spatialReference);
          return [item.name, value];
        }));
        const rowBytes = Buffer.byteLength(JSON.stringify(row));
        if (rowBytes > limits.maxRowBytes) fail('DATASET_EXTRACTION_ROW_TOO_LARGE');
        sourceTextBytes += rowBytes;
        if (sourceTextBytes > limits.maxBytes) fail('DATASET_EXTRACTION_TOO_MANY_BYTES');
        await options.onRow(row, query.columnTypes, { rowCount: rowCount + 1, sourceTextBytes });
        rowCount++;
      }
      return { schema: 'stellar-forge.arcgis-dataset-extraction.v1', query: name, rowCount, sourceTextBytes,
        columns: query.columns, columnTypes: query.columnTypes, order: limits.order, valueEncoding: 'native-json-scalars',
        nullEncoding: 'json-null', geometryEncoding: 'original-esri-json',
        observation: { kind: 'PINNED_ARCGIS_CAPTURE', captureSha256: source.capture.sha256,
          layerUrl: source.capture.state.settings.layerUrl, selectionKind: source.capture.state.mode,
          selectedRecords: source.capture.state.ids.length, sourceBytes: source.capture.sourceBytes,
          pageHashes: source.capture.pageHashes, spatialReference: source.capture.state.spatialReference, complete: true } };
    },
    close: async () => { closed = true; source.capture.records.clear(); },
  } };
}
export const arcgisPublisherDriver = Object.freeze({
  sourceName: 'ArcGIS',
  workspaceSchema: 'stellar-forge.arcgis-publisher-workspace.v1',
  statusSchema: 'stellar-forge.arcgis-publisher-status.v1',
  candidateSchema: 'stellar-forge.arcgis-dataset-candidate.v1',
  capturePlan: captureArcgisPublicationPlan, inspectSource: inspectArcgisPublicationSource,
  openSource, checkColumnTypes, encodeRow,
  validateExtraction: value => value?.schema === 'stellar-forge.arcgis-dataset-extraction.v1' &&
    value.observation?.kind === 'PINNED_ARCGIS_CAPTURE' && value.observation.complete === true &&
    HASH.test(value.observation.captureSha256 ?? '') && Number.isSafeInteger(value.rowCount) &&
    value.rowCount === value.observation.selectedRecords,
});
export function openArcgisPublisher(options = {}) { return openSourceDatasetPublisher(options, arcgisPublisherDriver); }

