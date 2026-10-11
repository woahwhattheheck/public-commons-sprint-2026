// MIT. Explicit scalar projection of one complete Sheet Best records response.
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { object, privateDirectory, fault } from '../postgres/publisher/files.mjs';
import { csvLine } from '../postgres/publisher/plan.mjs';
import { datasetExtractionOptions } from '../postgres/publisher/stream.mjs';
import { readSheetBestSourceFile } from './declaration.mjs';
import { readSheetBestCapture, bindSheetBestCapture, fetchSheetBestRecords, retainSheetBestCapture } from './capture.mjs';

export function checkSheetBestColumnTypes(columns, types) {
  if (!Array.isArray(types)) throw fault('SHEETBEST_COLUMN_TYPES_MISSING');
  for (const [name, spec] of Object.entries(columns)) {
    const source = types.find(column => column.name === name);
    if (!source || source.type !== spec.type) throw fault('SHEETBEST_COLUMN_TYPE_MISMATCH', 'Use the reviewed source type for ' + name + '.');
  }
}
function projectedValue(row, spec, valueMode) {
  if (!Object.hasOwn(row, spec.source)) throw fault('SHEETBEST_SOURCE_COLUMN_MISSING', 'Review the missing source column: ' + spec.source);
  let value = row[spec.source];
  if (value === '' && spec.empty === 'null') value = null;
  if (value === null) {
    if (!spec.nullable) throw fault('DATASET_NULL_NOT_ALLOWED');
    return null;
  }
  if (valueMode === 'strings') {
    if (typeof value !== 'string') throw fault('SHEETBEST_STRING_MODE_CHANGED');
    if (spec.type === 'string') return value;
    if (spec.type === 'boolean') {
      if (value !== 'true' && value !== 'false') throw fault('SHEETBEST_BOOLEAN_TEXT_REQUIRED', 'Choose Text or supply exact true/false source values.');
      return value === 'true';
    }
    const grammar = spec.type === 'integer' ? /^-?(?:0|[1-9][0-9]*)$/ : /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
    if (!grammar.test(value)) throw fault('SHEETBEST_NUMERIC_TEXT_INVALID', 'Choose Text for leading-zero IDs, currency formatting or localized values.');
    value = Number(value);
  }
  if (spec.type === 'string' && typeof value !== 'string') throw fault('SHEETBEST_STRING_REQUIRED');
  if (spec.type === 'boolean' && typeof value !== 'boolean') throw fault('SHEETBEST_BOOLEAN_REQUIRED');
  if (spec.type === 'integer' && (typeof value !== 'number' || !Number.isSafeInteger(value))) throw fault('SHEETBEST_SAFE_INTEGER_REQUIRED');
  if (spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value)))
    throw fault('SHEETBEST_SAFE_NUMBER_REQUIRED', 'Keep large exact identifiers or decimal text as Text.');
  return value;
}
function scalarText(value, spec) {
  if (value === null) {
    if (!spec.nullable) throw fault('DATASET_NULL_NOT_ALLOWED');
    return '';
  }
  if (spec.type === 'string' && typeof value !== 'string' || spec.type === 'boolean' && typeof value !== 'boolean' ||
      spec.type === 'integer' && !Number.isSafeInteger(value) ||
      spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)))
    throw fault('SHEETBEST_PROJECTED_VALUE_INVALID');
  const text = String(value);
  if (!text.length && spec.nullable) throw fault('DATASET_EMPTY_NULL_CONFLICT', 'Choose explicit empty-to-null or a non-nullable Text column.');
  return text;
}
export function encodeSheetBestRow(row, dataset) {
  return csvLine(Object.entries(dataset.columns).map(([name, spec]) => {
    const text = scalarText(row[name], spec);
    if (text.length > dataset.maxCellChars) throw fault('DATASET_CELL_TOO_LARGE');
    return text;
  }));
}
const description = query => ({ sql: query.sql, columns: query.columns, parameters: {}, parameterOrder: [],
  columnTypes: Object.entries(query.projection).map(([name, spec]) => ({ name, type: spec.type, nullable: spec.nullable })),
  source: { projection: query.projection, responseKind: 'SINGLE_RECORDS_RESPONSE' } });
export async function inspectSheetBestSource(filename) {
  const selected = await readSheetBestSourceFile(filename);
  let observation = null;
  if (selected.captureFile) {
    const capture = await readSheetBestCapture(selected.captureFile, selected.config.connection.sha256);
    bindSheetBestCapture(capture, selected.config);
    observation = { ...capture.manifest, manifestSha256: capture.manifestSha256 };
  }
  return { hash: selected.hash, bytes: selected.original.length, sourceName: 'Sheet Best',
    connectionKind: selected.config.connection.kind, valueMode: selected.binding.valueMode, tab: selected.binding.tab,
    observation, queries: Object.fromEntries(Object.entries(selected.queries).map(([name, query]) => [name, description(query)])) };
}
export async function openSheetBestSourceFile(filename, { env = process.env } = {}) {
  const selected = await readSheetBestSourceFile(filename);
  const retained = selected.captureFile ? await readSheetBestCapture(selected.captureFile, selected.config.connection.sha256) : null;
  if (retained) bindSheetBestCapture(retained, selected.config);
  let closed = false, active = false;
  const lifetime = new AbortController();
  const types = Object.fromEntries(Object.entries(selected.queries).map(([name, query]) =>
    [name, Object.entries(query.projection).map(([name, spec]) => ({ name, type: spec.type }))]));
  return { source: {
    inspect: () => ({ columnTypes: structuredClone(types) }),
    async exportDataset(name, input = {}, supplied = {}) {
      if (closed) throw fault('SHEETBEST_SOURCE_CLOSED');
      if (active) throw fault('SHEETBEST_SOURCE_BUSY');
      const query = selected.queries[name];
      if (!query) throw fault('QUERY_NOT_FOUND');
      if (!object(input) || Object.keys(input).length) throw fault('SHEETBEST_QUERY_INPUT_NOT_SUPPORTED');
      const { signal, onRow, ...declared } = supplied;
      const options = datasetExtractionOptions(query, declared);
      if (typeof onRow !== 'function') throw fault('SHEETBEST_ROW_CONSUMER_REQUIRED');
      const timeout = AbortSignal.timeout(options.timeoutMs);
      const abort = AbortSignal.any([lifetime.signal, timeout, ...(signal ? [signal] : [])]);
      const ensure = () => { if (abort.aborted) throw fault(timeout.aborted ? 'SHEETBEST_EXTRACTION_TIMEOUT' : 'SHEETBEST_EXTRACTION_CANCELLED'); };
      active = true;
      try {
        ensure(); let capture = retained;
        if (!capture) {
          const root = join(dirname(filename), 'captures'); await privateDirectory(root, true);
          const fetched = await fetchSheetBestRecords(selected.config, { env, signal: abort }); ensure();
          const { resourceBytes, ...metadata } = fetched;
          capture = await retainSheetBestCapture(resourceBytes, join(root, randomUUID()), metadata);
        }
        const records = bindSheetBestCapture(capture, selected.config);
        if (records.length > options.maxRows) throw fault('DATASET_EXTRACTION_TOO_MANY_ROWS');
        const rows = []; let sourceTextBytes = 0;
        for (let index = 0; index < records.length; index++) {
          ensure();
          if (index % 256 === 0) { await setImmediate(); ensure(); }
          const row = Object.fromEntries(Object.entries(query.projection).map(([alias, spec]) =>
            [alias, projectedValue(records[index], spec, selected.binding.valueMode)]));
          let rowBytes = 0;
          for (const [alias, spec] of Object.entries(query.projection)) rowBytes += Buffer.byteLength(scalarText(row[alias], spec));
          sourceTextBytes += rowBytes;
          if (rowBytes > options.maxRowBytes) throw fault('DATASET_EXTRACTION_ROW_TOO_LARGE');
          if (sourceTextBytes > options.maxBytes) throw fault('DATASET_EXTRACTION_TOO_MANY_BYTES');
          rows.push({ row, ordinal: index });
        }
        rows.sort((left, right) => {
          for (const item of options.order) {
            const a = left.row[item.column], b = right.row[item.column];
            if (a === b) continue;
            if (a === null || b === null) return a === null ? 1 : -1;
            return (a < b ? -1 : 1) * (item.direction === 'asc' ? 1 : -1);
          }
          return left.ordinal - right.ordinal;
        });
        ensure();
        for (let index = 0; index < rows.length; index++) {
          ensure(); await onRow(rows[index].row, types[name], { rowCount: index + 1, sourceTextBytes }); ensure();
        }
        return { schema: 'stellar-forge.sheetbest-dataset-extraction.v1', query: name, rowCount: rows.length,
          sourceTextBytes, columns: [...query.columns], columnTypes: types[name], order: options.order,
          valueEncoding: 'sheetbest-' + selected.binding.valueMode, nullEncoding: 'json-null',
          observation: { schema: 'stellar-forge.sheetbest-records-observation.v1', kind: 'SINGLE_RECORDS_RESPONSE',
            readOnly: true, capture: { ...capture.manifest, manifestSha256: capture.manifestSha256, file: capture.manifestFile } } };
      } finally { active = false; }
    },
    close() { closed = true; lifetime.abort(); },
  } };
}
