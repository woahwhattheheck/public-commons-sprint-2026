// MIT. Shared original strict UTF-8 CSV/TSV parser, factored without changing Source Tables behavior.
export const DELIMITERS=Object.freeze({comma:',',tab:'\t',semicolon:';',pipe:'|'});
const LIMITS=Object.freeze({sourceBytes:16*1024*1024,rows:100000,columns:512});
const encoder=new TextEncoder();
const bytes=text=>encoder.encode(text).length;
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
export class SourceTableError extends Error {
  constructor(code, message, details = {}) {
    super(message); this.name = 'SourceTableError'; this.code = code; Object.assign(this, details);
  }
}
function fail(code, message, details) { throw new SourceTableError(code, message, details); }
function sourceText(value) {
  if (typeof value !== 'string') fail('SOURCE_TEXT', 'The source must be decoded UTF-8 text.');
  if (bytes(value) > LIMITS.sourceBytes) fail('SOURCE_SIZE', 'The source exceeds the 16 MiB table-authoring limit.');
  if (value.includes('\u0000')) fail('SOURCE_BINARY', 'The source contains a NUL character. Choose a UTF-8 delimited text file.');
  if (typeof value.isWellFormed === 'function' && !value.isWellFormed()) fail('SOURCE_UNICODE', 'The source contains an unpaired Unicode surrogate.');
  return value;
}
export function decodeSource(value) {
  try { return sourceText(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value)); }
  catch (error) { if (error instanceof SourceTableError) throw error; fail('SOURCE_ENCODING', 'The selected file is not valid UTF-8. Export the original table as UTF-8 CSV or TSV.'); }
}
function delimiter(value) {
  const d = own(DELIMITERS, value) ? DELIMITERS[value] : value;
  if (!Object.values(DELIMITERS).includes(d)) fail('DELIMITER', 'Select comma, tab, semicolon or pipe.');
  return d;
}

/** Strict delimited-text reader. Original text is retained separately, including BOM and line endings. */
export function parseTable(input, { delimiter: selected = ',', header = true, skipEmptyRecords = false } = {}) {
  sourceText(input);
  if (typeof header !== 'boolean' || typeof skipEmptyRecords !== 'boolean') fail('DIALECT', 'Header and empty-record options must be true or false.');
  const separator = delimiter(selected), s = input.replace(/^\uFEFF/, '');
  if (!s.length) fail('EMPTY_SOURCE', 'The selected source is empty.');
  const records = [];
  let cells = [], cell = '', quoted = false, closed = false, started = false;
  let line = 1, recordLine = 1, skipped = 0;
  const pushCell = () => {
    cells.push(cell); cell = ''; closed = false;
    if (cells.length > LIMITS.columns) fail('COLUMN_LIMIT', 'A table can contain at most ' + LIMITS.columns + ' columns.', { line });
  };
  const pushRecord = () => {
    pushCell(); records.push({ cells, line: recordLine, record: records.length + 1 });
    if (records.length > LIMITS.rows + 1) fail('ROW_LIMIT', 'A source can contain at most ' + LIMITS.rows + ' data records.');
    cells = []; started = false;
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else if (c === '\r') { cell += c; if (s[i + 1] === '\n') cell += s[++i]; line++; }
      else { cell += c; if (c === '\n') line++; }
      continue;
    }
    if (c === '\r' || c === '\n') {
      pushRecord(); if (c === '\r' && s[i + 1] === '\n') i++;
      line++; recordLine = line; continue;
    }
    if (c === separator) { pushCell(); started = true; continue; }
    if (closed) fail('CSV_AFTER_QUOTE', 'Unexpected character after a closing quote on source line ' + line + '.', { line });
    if (c === '"') {
      if (cell.length) fail('CSV_QUOTE', 'A quoted field must start with a quote on source line ' + line + '.', { line });
      quoted = true; started = true; continue;
    }
    cell += c; started = true;
  }
  if (quoted) fail('CSV_UNCLOSED_QUOTE', 'The quoted field beginning in record at line ' + recordLine + ' is not closed.', { line: recordLine });
  if (started || cells.length || cell.length || closed) pushRecord();
  const first = records[0], width = first.cells.length;
  const headings = header ? [...first.cells] : Array.from({ length: width }, (_, i) => 'Column ' + (i + 1));
  const body = header ? records.slice(1) : records;
  const rows = [];
  for (const record of body) {
    if (skipEmptyRecords && record.cells.every(value => value === '')) { skipped++; continue; }
    if (record.cells.length !== width)
      fail('ROW_WIDTH', 'Source record ' + record.record + ' (line ' + record.line + ') has ' + record.cells.length + ' fields; the table declares ' + width + '.', { line: record.line, record: record.record, expected: width, actual: record.cells.length });
    rows.push(record);
  }
  if (rows.length > LIMITS.rows) fail('ROW_LIMIT', 'A source can contain at most ' + LIMITS.rows + ' data records.');
  return { delimiter: separator, header, skipEmptyRecords, headings, width, rows, skippedEmptyRecords: skipped, sourceRecordCount: body.length };
}

