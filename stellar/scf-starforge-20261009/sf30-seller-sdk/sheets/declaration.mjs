// MIT. Explicit Google Sheets range and public-column declarations.
import { dirname, resolve } from 'node:path';
import { object, readPrivate, digest, fault } from '../postgres/publisher/files.mjs';

export const MAX_CAPTURE_BYTES = 67108864;
export const HASH = /^[a-f0-9]{64}$/;
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const reserved = new Set(['constructor', 'prototype', '__proto__']);
export function only(value, keys, code) {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) throw fault(code);
}
export function integer(value, low, high, code) {
  if (!Number.isSafeInteger(value) || value < low || value > high) throw fault(code);
  return value;
}
export function columnIndex(value) {
  if (typeof value !== 'string' || !/^[A-Z]{1,3}$/.test(value)) throw fault('SHEETS_COLUMN_INVALID');
  return [...value].reduce((total, character) => total * 26 + character.charCodeAt(0) - 64, 0) - 1;
}
export function cellRange(value) {
  if (typeof value !== 'string') throw fault('SHEETS_RANGE_INVALID');
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6}):([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(value);
  if (!match) throw fault('SHEETS_RANGE_INVALID', 'Use a bounded A1 rectangle including its header, such as A1:G500.');
  const startColumn = columnIndex(match[1]), startRow = Number(match[2]) - 1;
  const endColumn = columnIndex(match[3]) + 1, endRow = Number(match[4]);
  if (endColumn <= startColumn || endRow <= startRow + 1 ||
      (endColumn - startColumn) * (endRow - startRow) > 1000000)
    throw fault('SHEETS_RANGE_SIZE_INVALID', 'Choose a header and data rectangle of at most 1,000,000 cells.');
  return { a1: value, startColumn, startRow, endColumn, endRow };
}
export function sheetTitle(value) {
  if (typeof value !== 'string' || !value.length || value.length > 100 || /[\u0000-\u001f]/.test(value))
    throw fault('SHEETS_TITLE_INVALID');
  return value;
}
export const qualifiedRange = (title, range) => "'" + sheetTitle(title).replaceAll("'", "''") + "'!" + cellRange(range).a1;
export function parseQualifiedRange(value) {
  const match = typeof value === 'string' && /^'((?:[^']|'')+)'!([A-Z0-9:]+)$/.exec(value);
  if (!match) throw fault('SHEETS_QUALIFIED_RANGE_REQUIRED', "Use the quoted tab title and rectangle, for example 'Catalog'!A1:G500.");
  const title = sheetTitle(match[1].replaceAll("''", "'"));
  return { title, ...cellRange(match[2]) };
}
export function spreadsheetId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(value)) throw fault('SHEETS_SPREADSHEET_ID_INVALID');
  return value;
}
export function compileQueries(value) {
  if (!object(value) || Object.keys(value).length < 1 || Object.keys(value).length > 32)
    throw fault('SHEETS_QUERIES_INVALID');
  return Object.fromEntries(Object.entries(value).map(([name, query]) => {
    if (!NAME.test(name) || reserved.has(name)) throw fault('SHEETS_QUERY_NAME_INVALID');
    only(query, ['sheetId', 'sheetTitle', 'range', 'columns', 'emptyRows'], 'SHEETS_QUERY_INVALID');
    const bounds = cellRange(query.range), title = sheetTitle(query.sheetTitle);
    integer(query.sheetId, 0, 2147483647, 'SHEETS_SHEET_ID_INVALID');
    if (!object(query.columns) || Object.keys(query.columns).length < 1 || Object.keys(query.columns).length > 64)
      throw fault('SHEETS_PUBLIC_COLUMNS_REQUIRED');
    const selected = new Set();
    const projection = Object.fromEntries(Object.entries(query.columns).map(([alias, spec]) => {
      if (!NAME.test(alias) || reserved.has(alias)) throw fault('SHEETS_PUBLIC_COLUMN_NAME_INVALID');
      only(spec, ['column', 'header', 'type', 'nullable', 'formula'], 'SHEETS_PUBLIC_COLUMN_INVALID');
      const index = columnIndex(spec.column);
      if (index < bounds.startColumn || index >= bounds.endColumn || selected.has(index))
        throw fault('SHEETS_PUBLIC_COLUMN_RANGE_INVALID');
      selected.add(index);
      if (typeof spec.header !== 'string' || !spec.header.length || spec.header.length > 512 ||
          !['string', 'integer', 'number', 'boolean'].includes(spec.type) ||
          spec.nullable !== undefined && typeof spec.nullable !== 'boolean' ||
          spec.formula !== undefined && !['reject', 'effective'].includes(spec.formula))
        throw fault('SHEETS_PUBLIC_COLUMN_INVALID');
      return [alias, { column: spec.column, index, header: spec.header, type: spec.type,
        nullable: spec.nullable ?? false, formula: spec.formula ?? 'reject' }];
    }));
    const emptyRows = query.emptyRows ?? 'reject';
    if (!['skip', 'reject'].includes(emptyRows)) throw fault('SHEETS_EMPTY_ROW_POLICY_INVALID');
    return [name, { sheetId: query.sheetId, sheetTitle: title, range: bounds.a1, bounds,
      qualifiedRange: qualifiedRange(title, bounds.a1), columns: Object.keys(projection), projection,
      emptyRows, parameters: {}, parameterOrder: [],
      sql: `Google Sheets: ${qualifiedRange(title, bounds.a1)}\nExact header and column bindings; effective cell values; empty rows: ${emptyRows}.` }];
  }));
}
export async function readSheetsSourceFile(filename) {
  const original = await readPrivate(filename);
  let config;
  try { config = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(original)); }
  catch { throw fault('SHEETS_SOURCE_JSON_INVALID'); }
  only(config, ['schema', 'spreadsheetId', 'connection', 'queries'], 'SHEETS_SOURCE_CONFIG_INVALID');
  if (config.schema !== 'stellar-forge.sheets-source.v1') throw fault('SHEETS_SOURCE_CONFIG_INVALID');
  spreadsheetId(config.spreadsheetId);
  const connection = config.connection;
  if (connection?.kind === 'capture') {
    only(connection, ['kind', 'file', 'sha256'], 'SHEETS_CAPTURE_CONNECTION_INVALID');
    if (typeof connection.file !== 'string' || !connection.file || connection.file.includes('\0') || !HASH.test(connection.sha256 ?? ''))
      throw fault('SHEETS_CAPTURE_CONNECTION_INVALID');
  } else if (connection?.kind === 'google') {
    only(connection, ['kind', 'accessTokenEnv', 'maxResponseBytes', 'timeoutMs'], 'SHEETS_GOOGLE_CONNECTION_INVALID');
    if (typeof connection.accessTokenEnv !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(connection.accessTokenEnv))
      throw fault('SHEETS_TOKEN_ENV_REQUIRED');
    integer(connection.maxResponseBytes ?? MAX_CAPTURE_BYTES, 1024, MAX_CAPTURE_BYTES, 'SHEETS_RESPONSE_LIMIT_INVALID');
    integer(connection.timeoutMs ?? 30000, 100, 180000, 'SHEETS_TIMEOUT_INVALID');
  } else throw fault('SHEETS_CONNECTION_KIND_INVALID');
  return { config, original, hash: digest(original), queries: compileQueries(config.queries),
    captureFile: connection.kind === 'capture' ? resolve(dirname(filename), connection.file) : null };
}
