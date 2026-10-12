// MIT. Original UTF-8 catalog rows with string identifiers and streaming CSV/JSONL intake.
import { createReadStream, constants } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { WorkspaceError } from '../workspace/store.mjs';

const fail = (code, message) => { throw new WorkspaceError(code, message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const MAX_COLUMNS = 512;
const MAX_FIELD = 2 * 1024 * 1024;
const MAX_RECORD = 8 * 1024 * 1024;
const MAX_JSON = 256 * 1024 * 1024;

export function catalogInputFormat(value = {}) {
  if (!object(value)) fail('CATALOG_FORMAT_REQUIRED', 'Choose a catalog input format.');
  const kind = value.kind ?? 'csv';
  if (!['csv', 'tsv', 'jsonl', 'json'].includes(kind))
    fail('CATALOG_FORMAT_INVALID', 'Choose CSV, TSV, JSON Lines, or a JSON row array.');
  const result = { kind };
  if (kind === 'csv' || kind === 'tsv') {
    const delimiter = value.delimiter ?? (kind === 'tsv' ? '\t' : ',');
    if (typeof delimiter !== 'string' || delimiter.length !== 1 || ['"', '\r', '\n', '\0'].includes(delimiter))
      fail('CATALOG_DELIMITER_INVALID', 'Use one field separator other than a quote or line ending.');
    result.delimiter = delimiter;
    result.hasHeader = value.hasHeader !== false;
    if (value.columns !== undefined) {
      result.columns = columns(value.columns);
      if (value.hasHeader === undefined) result.hasHeader = false;
    }
    if (!result.hasHeader && !result.columns)
      fail('CATALOG_COLUMNS_REQUIRED', 'A file without a header needs its original ordered column names.');
  } else if (kind === 'json') {
    result.rowsPath = value.rowsPath ?? '';
    if (typeof result.rowsPath !== 'string' || result.rowsPath.length > 2048 ||
        result.rowsPath !== '' && !result.rowsPath.startsWith('/'))
      fail('CATALOG_ROWS_PATH_INVALID', 'Use an empty path or a JSON Pointer to the original row array.');
  }
  return result;
}

function columns(names) {
  if (!Array.isArray(names) || !names.length || names.length > MAX_COLUMNS ||
      names.some(name => typeof name !== 'string' || !name.length || name.length > 512 || /[\0\r\n]/.test(name)) ||
      new Set(names).size !== names.length)
    fail('CATALOG_COLUMNS_INVALID', 'Column names must be nonempty, distinct, and in their original order.');
  return [...names];
}

async function* utf8(filename) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const stream = createReadStream(filename, { flags: constants.O_RDONLY | constants.O_NOFOLLOW, highWaterMark: 262144 });
  let first = true;
  try {
    for await (const chunk of stream) {
      let text;
      try { text = decoder.decode(chunk, { stream: true }); }
      catch { fail('CATALOG_UTF8_REQUIRED', 'The original input must contain valid UTF-8 text.'); }
      if (first && text.length) { first = false; if (text[0] === '\uFEFF') text = text.slice(1); }
      if (text.includes('\0')) fail('CATALOG_NUL_INVALID', 'Catalog text contains a NUL character.');
      yield text;
    }
    try { const tail = decoder.decode(); if (tail) yield tail; }
    catch { fail('CATALOG_UTF8_REQUIRED', 'The original input ends with incomplete UTF-8.'); }
  } finally { stream.destroy(); }
}

async function* csvRecords(filename, format) {
  let cells = [], field = '', mode = 0, afterCR = false, recordCharacters = 0, row = 1;
  const push = () => {
    cells.push(field); field = '';
    if (cells.length > MAX_COLUMNS) fail('CATALOG_COLUMN_LIMIT', `Row ${row} exceeds ${MAX_COLUMNS} columns.`);
  };
  const finish = () => {
    push(); const record = cells; cells = []; recordCharacters = 0; row++;
    return record;
  };
  for await (const text of utf8(filename)) {
    for (const ch of text) {
      if (afterCR) { afterCR = false; if (ch === '\n') continue; }
      recordCharacters++;
      if (recordCharacters > MAX_RECORD) fail('CATALOG_ROW_LIMIT', `Row ${row} exceeds the catalog record limit.`);
      if (mode === 1) {
        if (ch === '"') mode = 2; else field += ch;
      } else if (mode === 2) {
        if (ch === '"') { field += '"'; mode = 1; }
        else if (ch === format.delimiter) { push(); mode = 0; }
        else if (ch === '\n' || ch === '\r') { mode = 0; yield finish(); afterCR = ch === '\r'; }
        else if (ch !== ' ' && ch !== '\t')
          fail('CATALOG_CSV_QUOTE_INVALID', `Row ${row} has text after its closing quote.`);
      } else if (ch === format.delimiter) push();
      else if (ch === '\n' || ch === '\r') { yield finish(); afterCR = ch === '\r'; }
      else if (ch === '"') {
        if (field.length) fail('CATALOG_CSV_QUOTE_INVALID', `Row ${row} has an unescaped quote.`);
        mode = 1;
      } else field += ch;
      if (field.length > MAX_FIELD) fail('CATALOG_FIELD_LIMIT', `Row ${row} contains an oversized field.`);
    }
  }
  if (mode === 1) fail('CATALOG_CSV_UNCLOSED_QUOTE', `Row ${row} ends inside a quoted field.`);
  if (field.length || cells.length || mode === 2) yield finish();
}

function originalJSON(text) {
  try {
    return JSON.parse(text, (_key, value, context) => {
      if (typeof value !== 'number') return value;
      if (typeof context?.source !== 'string')
        fail('CATALOG_LOSSLESS_JSON_REQUIRED', 'Use Node.js 22.16 or newer to retain original numeric tokens.');
      return context.source;
    });
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    fail('CATALOG_JSON_INVALID', 'The original catalog contains invalid JSON.');
  }
}

function rowObject(value, ordinal) {
  if (!object(value)) fail('CATALOG_ROW_OBJECT_REQUIRED', `Row ${ordinal} must be a JSON object.`);
  if (Object.keys(value).length > MAX_COLUMNS) fail('CATALOG_COLUMN_LIMIT', `Row ${ordinal} exceeds ${MAX_COLUMNS} fields.`);
  return value;
}

export function catalogField(row, path) {
  if (typeof path !== 'string' || !path) return undefined;
  if (Object.hasOwn(row, path)) return row[path];
  if (!path.startsWith('/')) return undefined;
  let current = row;
  for (const encoded of path.slice(1).split('/')) {
    if (/~(?:[^01]|$)/.test(encoded)) fail('CATALOG_FIELD_PATH_INVALID', 'The field path has an invalid JSON Pointer escape.');
    const key = encoded.replaceAll('~1', '/').replaceAll('~0', '~');
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

export async function* readCatalogRows(filename, rawFormat = {}) {
  const format = catalogInputFormat(rawFormat);
  let ordinal = 0;
  if (format.kind === 'csv' || format.kind === 'tsv') {
    let names = format.hasHeader ? null : format.columns;
    for await (const values of csvRecords(filename, format)) {
      if (values.length === 1 && values[0] === '') continue;
      if (!names) {
        names = columns(values);
        if (format.columns && JSON.stringify(names) !== JSON.stringify(format.columns))
          fail('CATALOG_HEADER_CHANGED', 'The original CSV header differs from the selected ordered columns.');
        continue;
      }
      ordinal++;
      if (values.length !== names.length)
        fail('CATALOG_ROW_WIDTH_CHANGED', `Row ${ordinal} has ${values.length} fields; the header declares ${names.length}.`);
      yield { ordinal, record: Object.fromEntries(names.map((name, index) => [name, values[index]])) };
    }
    if (!names) fail('CATALOG_HEADER_REQUIRED', 'The input contains no catalog header.');
    return;
  }
  if (format.kind === 'jsonl') {
    let pending = '';
    for await (const text of utf8(filename)) {
      pending += text;
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end).replace(/\r$/, ''); pending = pending.slice(end + 1);
        if (!line.trim()) continue;
        if (line.length > MAX_RECORD) fail('CATALOG_ROW_LIMIT', 'A JSON Lines record exceeds the catalog record limit.');
        ordinal++; yield { ordinal, record: rowObject(originalJSON(line), ordinal) };
      }
      if (pending.length > MAX_RECORD) fail('CATALOG_ROW_LIMIT', 'A JSON Lines record exceeds the catalog record limit.');
    }
    if (pending.trim()) { ordinal++; yield { ordinal, record: rowObject(originalJSON(pending), ordinal) }; }
    return;
  }
  if ((await stat(filename)).size > MAX_JSON)
    fail('CATALOG_JSON_ARRAY_LIMIT', 'Use streaming CSV or JSON Lines for a catalog larger than 256 MiB.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let raw;
  try { raw = decoder.decode(await readFile(filename)); }
  catch { fail('CATALOG_UTF8_REQUIRED', 'The original catalog must contain valid UTF-8 text.'); }
  const parsed = originalJSON(raw), values = format.rowsPath ? catalogField(parsed, format.rowsPath) : parsed;
  if (!Array.isArray(values)) fail('CATALOG_ROW_ARRAY_REQUIRED', 'Select the original JSON row array.');
  for (const value of values) { ordinal++; yield { ordinal, record: rowObject(value, ordinal) }; }
}
