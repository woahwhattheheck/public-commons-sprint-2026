// MIT. Typed projection of one actual Google Sheets range observation.
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { object, privateDirectory, fault } from '../postgres/publisher/files.mjs';
import { csvLine } from '../postgres/publisher/plan.mjs';
import { datasetExtractionOptions } from '../postgres/publisher/stream.mjs';
import { readSheetsSourceFile } from './declaration.mjs';
import { readSheetsCapture, bindSheetsCapture, fetchSheetsResource, retainSheetsCapture } from './capture.mjs';

export function checkSheetsColumnTypes(columns, types) {
  if (!Array.isArray(types)) throw fault('SHEETS_COLUMN_TYPES_MISSING');
  for (const [name, spec] of Object.entries(columns)) {
    const source = types.find(column => column.name === name);
    if (!source || source.type !== spec.type) throw fault('SHEETS_COLUMN_TYPE_MISMATCH', 'Use the source declaration type for ' + name + '.');
  }
}
function effectiveCell(cell, spec, address) {
  if (!object(cell)) throw fault('SHEETS_CELL_DATA_INVALID');
  const entered = cell.userEnteredValue, value = cell.effectiveValue;
  if (entered?.formulaValue !== undefined && spec.formula !== 'effective')
    throw fault('SHEETS_FORMULA_NOT_APPROVED', 'Explicitly approve the effective formula value at ' + address + '.');
  if (value?.errorValue !== undefined) throw fault('SHEETS_FORMULA_ERROR', 'The selected cell ' + address + ' has a provider error.');
  const keys = object(value) ? Object.keys(value) : [];
  if (!keys.length) {
    if (entered && Object.keys(entered).length) throw fault('SHEETS_EFFECTIVE_VALUE_MISSING', 'Re-read complete effective values for ' + address + '.');
    return null;
  }
  if (keys.length !== 1 || !['stringValue', 'numberValue', 'boolValue'].includes(keys[0])) throw fault('SHEETS_EFFECTIVE_VALUE_INVALID');
  const result = value[keys[0]];
  if (keys[0] === 'stringValue' && typeof result !== 'string' ||
      keys[0] === 'numberValue' && (typeof result !== 'number' || !Number.isFinite(result)) ||
      keys[0] === 'boolValue' && typeof result !== 'boolean') throw fault('SHEETS_EFFECTIVE_VALUE_INVALID');
  // A displayed date is a numeric serial in Sheets. It needs explicit source
  // transformation to a text column, not silent timezone/date formatting here.
  if (['DATE', 'TIME', 'DATE_TIME'].includes(cell.effectiveFormat?.numberFormat?.type))
    throw fault('SHEETS_DATE_PROJECTION_REQUIRED', 'Project an explicit text date or an explicitly separate numeric serial column for ' + address + '.');
  return result;
}
function scalarText(value, spec) {
  if (value === null) {
    if (!spec.nullable) throw fault('DATASET_NULL_NOT_ALLOWED');
    return '';
  }
  if (spec.type === 'string' && typeof value !== 'string') throw fault('SHEETS_TEXT_REQUIRES_STRING_CELL');
  if (spec.type === 'integer' && (typeof value !== 'number' || !Number.isSafeInteger(value)))
    throw fault('SHEETS_INTEGER_REQUIRES_SAFE_NUMBER', 'Store large identifiers as text cells and choose Text.');
  if (spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) throw fault('SHEETS_NUMBER_REQUIRED');
  if (spec.type === 'boolean' && typeof value !== 'boolean') throw fault('SHEETS_BOOLEAN_REQUIRED');
  if (!['string', 'integer', 'number', 'boolean'].includes(spec.type)) throw fault('INVALID_DATASET_COLUMN');
  const text = String(value);
  if (text === '' && spec.nullable) throw fault('DATASET_EMPTY_NULL_CONFLICT');
  return text;
}
export function encodeSheetsRow(row, dataset) {
  return csvLine(Object.entries(dataset.columns).map(([name, spec]) => {
    const text = scalarText(row[name], spec);
    if (text.length > dataset.maxCellChars) throw fault('DATASET_CELL_TOO_LARGE');
    return text;
  }));
}
const queryDescription = query => ({ sql: query.sql, columns: query.columns, parameters: {}, parameterOrder: [],
  columnTypes: Object.entries(query.projection).map(([name, spec]) => ({ name, type: spec.type, nullable: spec.nullable, formula: spec.formula })),
  source: { sheetId: query.sheetId, range: query.qualifiedRange, emptyRows: query.emptyRows } });

export async function inspectSheetsSource(filename) {
  const source = await readSheetsSourceFile(filename);
  let observation = null;
  if (source.captureFile) {
    const capture = await readSheetsCapture(source.captureFile, source.config.connection.sha256);
    for (const query of Object.values(source.queries)) bindSheetsCapture(capture, source.config, query);
    observation = { ...capture.manifest, manifestSha256: capture.manifestSha256 };
  }
  return { hash: source.hash, bytes: source.original.length, sourceName: 'Google Sheets',
    connectionKind: source.config.connection.kind, observation,
    queries: Object.fromEntries(Object.entries(source.queries).map(([name, query]) => [name, queryDescription(query)])) };
}

export async function openSheetsSourceFile(filename, { env = process.env } = {}) {
  const selected = await readSheetsSourceFile(filename);
  const retained = selected.captureFile ? await readSheetsCapture(selected.captureFile, selected.config.connection.sha256) : null;
  if (retained) for (const query of Object.values(selected.queries)) bindSheetsCapture(retained, selected.config, query);
  let closed = false, active = false;
  const lifetime = new AbortController();
  const types = Object.fromEntries(Object.entries(selected.queries).map(([name, query]) =>
    [name, Object.entries(query.projection).map(([name, spec]) => ({ name, type: spec.type }))]));
  return { source: {
    inspect: () => ({ columnTypes: structuredClone(types) }),
    async exportDataset(name, input = {}, supplied = {}) {
      if (closed) throw fault('SHEETS_SOURCE_CLOSED');
      if (active) throw fault('SHEETS_SOURCE_BUSY');
      const query = selected.queries[name];
      if (!query) throw fault('QUERY_NOT_FOUND');
      if (!object(input) || Object.keys(input).length) throw fault('SHEETS_QUERY_INPUT_NOT_SUPPORTED');
      const { signal, onRow, ...declared } = supplied;
      const options = datasetExtractionOptions(query, declared);
      if (typeof onRow !== 'function') throw fault('SHEETS_ROW_CONSUMER_REQUIRED');
      const timeout = AbortSignal.timeout(options.timeoutMs);
      const abort = AbortSignal.any([lifetime.signal, timeout, ...(signal ? [signal] : [])]);
      const ensure = () => { if (abort.aborted) throw fault(timeout.aborted ? 'SHEETS_EXTRACTION_TIMEOUT' : 'SHEETS_EXTRACTION_CANCELLED'); };
      active = true;
      try {
        ensure(); let capture = retained;
        if (!capture) {
          const fetched = await fetchSheetsResource(selected.config, query, { env, signal: abort }); ensure();
          const root = join(dirname(filename), 'captures'); await privateDirectory(root, true);
          capture = await retainSheetsCapture(fetched.resourceBytes, join(root, randomUUID()),
            { range: query.qualifiedRange, transport: 'google-rest', receivedAt: fetched.receivedAt });
        }
        const grid = bindSheetsCapture(capture, selected.config, query);
        for (const spec of Object.values(query.projection)) {
          const cell = grid.cell(query.bounds.startRow, spec.index);
          if (cell.userEnteredValue?.formulaValue !== undefined || cell.effectiveValue?.stringValue !== spec.header)
            throw fault('SHEETS_HEADER_CHANGED', 'Reload and review the header at ' + spec.column + (query.bounds.startRow + 1) + '.');
        }
        const rows = []; let sourceTextBytes = 0, skippedEmptyRows = 0, formulaCells = 0;
        for (let index = query.bounds.startRow + 1; index < query.bounds.endRow; index++) {
          ensure();
          if ((index - query.bounds.startRow) % 256 === 0) { await setImmediate(); ensure(); }
          const row = Object.fromEntries(Object.entries(query.projection).map(([name, spec]) => {
            const cell = grid.cell(index, spec.index);
            if (cell.userEnteredValue?.formulaValue !== undefined) formulaCells++;
            return [name, effectiveCell(cell, spec, spec.column + (index + 1))];
          }));
          if (Object.values(row).every(value => value === null)) {
            if (query.emptyRows === 'reject') throw fault('SHEETS_EMPTY_ROW_NOT_APPROVED');
            skippedEmptyRows++; continue;
          }
          let rowBytes = 0;
          for (const [name, spec] of Object.entries(query.projection)) rowBytes += Buffer.byteLength(scalarText(row[name], spec));
          sourceTextBytes += rowBytes;
          if (rowBytes > options.maxRowBytes) throw fault('DATASET_EXTRACTION_ROW_TOO_LARGE');
          if (sourceTextBytes > options.maxBytes) throw fault('DATASET_EXTRACTION_TOO_MANY_BYTES');
          if (rows.length >= options.maxRows) throw fault('DATASET_EXTRACTION_TOO_MANY_ROWS');
          rows.push({ row, sheetRow: index + 1 });
        }
        // Stable native scalar order; ties retain physical Sheet order and nulls
        // remain last in both directions. No formatted-value coercion or locale.
        rows.sort((left, right) => {
          for (const item of options.order) {
            const a = left.row[item.column], b = right.row[item.column];
            if (a === b) continue;
            if (a === null || b === null) return a === null ? 1 : -1;
            return (a < b ? -1 : 1) * (item.direction === 'asc' ? 1 : -1);
          }
          return left.sheetRow - right.sheetRow;
        });
        ensure();
        for (let index = 0; index < rows.length; index++) {
          ensure(); await onRow(rows[index].row, types[name], { rowCount: index + 1, sourceTextBytes }); ensure();
        }
        return { schema: 'stellar-forge.sheets-dataset-extraction.v1', query: name, rowCount: rows.length,
          sourceTextBytes, columns: [...query.columns], columnTypes: types[name], order: options.order,
          valueEncoding: 'google-effective-value', nullEncoding: 'json-null',
          observation: { schema: 'stellar-forge.sheets-range-observation.v1', kind: 'SINGLE_SPREADSHEET_RESPONSE',
            readOnly: true, capture: { ...capture.manifest, manifestSha256: capture.manifestSha256, file: capture.manifestFile },
            selectedRange: query.qualifiedRange, sheetId: query.sheetId, rowsInRange: query.bounds.endRow - query.bounds.startRow - 1,
            skippedEmptyRows, formulaCells, emptyRows: query.emptyRows, locale: capture.resource.properties?.locale ?? null,
            timeZone: capture.resource.properties?.timeZone ?? null } };
      } finally { active = false; }
    },
    close() { closed = true; lifetime.abort(); },
  } };
}
