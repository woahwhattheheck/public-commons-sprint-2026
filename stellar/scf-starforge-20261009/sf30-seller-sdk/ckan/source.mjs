// MIT. A reviewed CKAN edition joins the original durable dataset publisher.
import { setImmediate } from 'node:timers/promises';
import { object, fault } from '../postgres/publisher/files.mjs';
import { csvLine } from '../postgres/publisher/plan.mjs';
import { datasetExtractionOptions } from '../postgres/publisher/stream.mjs';
import { readCkanSourceFile } from './declaration.mjs';
import { ExactCkanNumber, readCkanCapture } from './capture.mjs';

export function bindCkanCapture(capture, config, query) {
  if (capture.manifest.catalogOrigin !== config.catalogOrigin ||
      capture.manifest.packageId !== config.packageId || capture.manifest.resourceId !== config.resourceId)
    throw fault('CKAN_CAPTURE_SELECTION_MISMATCH');
  const names = new Set(capture.fields.map(field => field.id));
  if (Object.values(query.projection).some(spec => !names.has(spec.field))) throw fault('CKAN_SELECTED_FIELD_MISSING');
  return capture;
}
export function projectCkanValue(value, spec) {
  if (value === undefined) throw fault('CKAN_RECORD_FIELD_MISSING');
  if (value instanceof ExactCkanNumber && spec.encoding === 'native')
    throw fault('CKAN_EXACT_NUMBER_NEEDS_TEXT', 'Choose text or JSON text to preserve the exact source number for ' + spec.field + '.');
  if (spec.encoding === 'json') return JSON.stringify(value);
  if (value === null) {
    if (!spec.nullable) throw fault('CKAN_NULL_NOT_ALLOWED', 'Review nullability for source field ' + spec.field + '.');
    return null;
  }
  if (spec.encoding === 'text') {
    if (value instanceof ExactCkanNumber) return value.source;
    if (typeof value === 'object') throw fault('CKAN_STRUCTURED_VALUE_NEEDS_JSON', 'Choose JSON text for source field ' + spec.field + '.');
    value = String(value);
  }
  if (spec.type === 'string' && typeof value !== 'string' ||
      spec.type === 'integer' && (typeof value !== 'number' || !Number.isSafeInteger(value)) ||
      spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)) ||
      spec.type === 'boolean' && typeof value !== 'boolean')
    throw fault('CKAN_VALUE_TYPE_MISMATCH', 'The observed value does not match the reviewed type for ' + spec.field + '.');
  if (spec.nullable && value === '')
    throw fault('CKAN_EMPTY_NULL_CONFLICT', 'Use JSON text to preserve both empty strings and nulls for ' + spec.field + '.');
  return value;
}
export function checkCkanColumnTypes(columns, types) {
  if (!Array.isArray(types)) throw fault('CKAN_COLUMN_TYPES_MISSING');
  for (const [name, spec] of Object.entries(columns)) {
    const source = types.find(column => column.name === name);
    if (!source || source.type !== spec.type) throw fault('CKAN_COLUMN_TYPE_MISMATCH', 'Use the reviewed source type for ' + name + '.');
  }
}
export function encodeCkanRow(row, dataset) {
  return csvLine(Object.entries(dataset.columns).map(([name, spec]) => {
    const value = row[name];
    if (value === null) { if (!spec.nullable) throw fault('DATASET_NULL_NOT_ALLOWED'); return ''; }
    if (value === undefined || spec.type === 'string' && typeof value !== 'string' ||
        spec.type === 'integer' && (typeof value !== 'number' || !Number.isSafeInteger(value)) ||
        spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)) ||
        spec.type === 'boolean' && typeof value !== 'boolean') throw fault('CKAN_VALUE_TYPE_MISMATCH');
    const text = String(value);
    if (text === '' && spec.nullable) throw fault('CKAN_EMPTY_NULL_CONFLICT');
    if (text.length > dataset.maxCellChars) throw fault('DATASET_CELL_TOO_LARGE');
    return text;
  }));
}
const description = query => ({ sql: query.sql, columns: query.columns, parameters: {}, parameterOrder: [],
  columnTypes: Object.entries(query.projection).map(([name, spec]) => ({ name, type: spec.type,
    nullable: spec.nullable, sourceField: spec.field, encoding: spec.encoding })) });
export async function inspectCkanSource(filename) {
  const selected = await readCkanSourceFile(filename);
  const capture = await readCkanCapture(selected.captureFile, selected.config.connection.sha256);
  for (const query of Object.values(selected.queries)) bindCkanCapture(capture, selected.config, query);
  return { hash: selected.hash, bytes: selected.original.length, sourceName: 'CKAN',
    connectionKind: 'capture', observation: { ...capture.manifest, manifestSha256: capture.manifestSha256 },
    queries: Object.fromEntries(Object.entries(selected.queries).map(([name, query]) => [name, description(query)])) };
}
export async function openCkanSourceFile(filename) {
  const selected = await readCkanSourceFile(filename);
  const capture = await readCkanCapture(selected.captureFile, selected.config.connection.sha256);
  for (const query of Object.values(selected.queries)) bindCkanCapture(capture, selected.config, query);
  const types = Object.fromEntries(Object.entries(selected.queries).map(([name, query]) =>
    [name, Object.entries(query.projection).map(([name, spec]) => ({ name, type: spec.type }))]));
  const lifetime = new AbortController(); let closed = false, active = false;
  return { source: {
    inspect: () => ({ columnTypes: structuredClone(types) }),
    async exportDataset(name, input = {}, supplied = {}) {
      if (closed) throw fault('CKAN_SOURCE_CLOSED');
      if (active) throw fault('CKAN_SOURCE_BUSY');
      const query = selected.queries[name];
      if (!query) throw fault('QUERY_NOT_FOUND');
      if (!object(input) || Object.keys(input).length) throw fault('CKAN_QUERY_INPUT_NOT_SUPPORTED');
      const { signal, onRow, ...declared } = supplied;
      const options = datasetExtractionOptions(query, declared);
      if (typeof onRow !== 'function') throw fault('CKAN_ROW_CONSUMER_REQUIRED');
      const timeout = AbortSignal.timeout(options.timeoutMs);
      const abort = AbortSignal.any([lifetime.signal, timeout, ...(signal ? [signal] : [])]);
      const ensure = () => { if (abort.aborted) throw fault(timeout.aborted ? 'CKAN_EXTRACTION_TIMEOUT' : 'CKAN_EXTRACTION_CANCELLED'); };
      active = true;
      try {
        const rows = []; let sourceTextBytes = 0;
        for (let index = 0; index < capture.rows.length; index++) {
          ensure(); if (index % 256 === 0) { await setImmediate(); ensure(); }
          const original = capture.rows[index];
          const row = Object.fromEntries(Object.entries(query.projection).map(([alias, spec]) =>
            [alias, projectCkanValue(Object.hasOwn(original, spec.field) ? original[spec.field] : undefined, spec)]));
          let rowBytes = 0;
          for (const value of Object.values(row)) rowBytes += value === null ? 0 : Buffer.byteLength(String(value));
          sourceTextBytes += rowBytes;
          if (rowBytes > options.maxRowBytes) throw fault('DATASET_EXTRACTION_ROW_TOO_LARGE');
          if (sourceTextBytes > options.maxBytes) throw fault('DATASET_EXTRACTION_TOO_MANY_BYTES');
          if (rows.length >= options.maxRows) throw fault('DATASET_EXTRACTION_TOO_MANY_ROWS');
          rows.push({ row, originalIndex: index });
        }
        rows.sort((left, right) => {
          for (const item of options.order) {
            const a = left.row[item.column], b = right.row[item.column];
            if (a === b) continue;
            if (a === null || b === null) return a === null ? 1 : -1;
            return (a < b ? -1 : 1) * (item.direction === 'asc' ? 1 : -1);
          }
          return left.originalIndex - right.originalIndex;
        });
        for (let index = 0; index < rows.length; index++) {
          ensure(); await onRow(rows[index].row, types[name], { rowCount: index + 1, sourceTextBytes });
        }
        return { schema: 'stellar-forge.ckan-dataset-extraction.v1', query: name, rowCount: rows.length,
          sourceTextBytes, columns: [...query.columns], columnTypes: types[name], order: options.order,
          valueEncoding: 'ckan-reviewed-projection', nullEncoding: 'json-null',
          observation: { schema: 'stellar-forge.ckan-edition-observation.v1', kind: 'RETAINED_DATASTORE_PAGES',
            readOnly: true, capture: { ...capture.manifest, manifestSha256: capture.manifestSha256, file: capture.manifestFile },
            projection: query.projection } };
      } finally { active = false; }
    },
    close() { closed = true; lifetime.abort(); },
  } };
}

