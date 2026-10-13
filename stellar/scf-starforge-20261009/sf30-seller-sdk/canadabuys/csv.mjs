// MIT. Complete UTF-8 RFC 4180 intake. Original bytes remain in the workspace.
import { failure } from './core.mjs';
export function decodeCsv(input) {
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  let rawText;
  try { rawText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw failure('INVALID_UTF8', 'CanadaBuys source must be complete UTF-8 CSV'); }
  return { bytes, rawText };
}
export function parseCsv(rawText) {
  if (typeof rawText !== 'string') throw failure('INVALID_CSV', 'CSV source must be text');
  const source = rawText.replace(/^\uFEFF/, '');
  if (!source.length) throw failure('CSV_HEADER_REQUIRED', 'Source needs the complete CanadaBuys header row', 422);
  const records = [], delimiter = /[",\r\n]/g;
  let index = 0;
  const location = position => ({ physicalLine: 1 + (source.slice(0, position).match(/\n/g) || []).length,
    recordNumber: records.length + 1 });
  while (index < source.length) {
    const record = [];
    for (;;) {
      let field;
      if (source[index] === '"') {
        let start = ++index, pieces = null;
        for (;;) {
          const quote = source.indexOf('"', index);
          if (quote < 0) throw failure('INCOMPLETE_CSV', 'Source ended inside a quoted field', 422, location(source.length));
          if (source[quote + 1] === '"') {
            if (!pieces) pieces = [];
            pieces.push(source.slice(start, quote), '"');
            index = quote + 2; start = index;
          } else {
            field = pieces ? pieces.concat(source.slice(start, quote)).join('') : source.slice(start, quote);
            index = quote + 1;
            if (index < source.length && ![',','\r','\n'].includes(source[index]))
              throw failure('INVALID_CSV', 'Unexpected text after a quoted field', 422, location(index));
            break;
          }
        }
      } else {
        delimiter.lastIndex = index;
        const match = delimiter.exec(source), end = match ? match.index : source.length;
        if (match?.[0] === '"') throw failure('INVALID_CSV', 'A quote inside an unquoted field must be escaped', 422, location(end));
        field = source.slice(index, end); index = end;
      }
      record.push(field);
      if (source[index] === ',') { index++; continue; }
      records.push(record);
      if (source[index] === '\r' && source[index + 1] === '\n') index += 2;
      else if (index < source.length) index++;
      break;
    }
  }
  const columns = records.shift();
  if (columns.some(column => !column) || new Set(columns).size !== columns.length)
    throw failure('INVALID_CSV_HEADER', 'CSV headers must be nonempty and unique', 422);
  const rows = records.map((values, index) => {
    if (values.length !== columns.length)
      throw failure('CSV_COLUMN_COUNT', 'Every record must retain all original columns', 422,
        { rowNumber: index + 2, expectedColumns: columns.length, actualColumns: values.length });
    return { rowNumber: index + 2, row: Object.fromEntries(columns.map((column, columnIndex) => [column, values[columnIndex]])) };
  });
  return { columns, rows };
}
export function encodeCsv(columns, records, { spreadsheetSafe = false } = {}) {
  const field = value => {
    let body = value === null || value === undefined ? '' : String(value);
    if (spreadsheetSafe && /^[\t\r\n ]*[=+\-@]/.test(body)) body = "'" + body;
    return /[",\r\n]/.test(body) ? '"' + body.replaceAll('"', '""') + '"' : body;
  };
  return [columns, ...records.map(record => columns.map(column => record[column]))]
    .map(row => row.map(field).join(',')).join('\r\n') + '\r\n';
}
