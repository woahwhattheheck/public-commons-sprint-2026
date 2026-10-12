// MIT. Exact delimited-table decoding for lab receiving; source strings are never trimmed.
export const LAB_TABLE_LIMITS = Object.freeze({ rows: 100000, columns: 512, cellCharacters: 1048576 });
export function labError(code, message, detail) {
  throw Object.assign(new Error(message), { code: 'JOB_INPUT_LAB_' + code, detail });
}
export function headerKeys(headers) {
  const keys = headers.map((field, index) => (index === 0 ? field.replace(/^\uFEFF/, '').replace(/^#/, '') : field).trim().toLowerCase());
  if (keys.some(key => !key) || new Set(keys).size !== keys.length)
    labError('HEADERS', 'Every original header must have an unambiguous field name.', { headers });
  return keys;
}
export function parseDelimited(text, delimiter = ',') {
  if (typeof text !== 'string' || ![',', '\t'].includes(delimiter)) labError('TABLE', 'Select comma or tab delimited text.');
  const records = [];
  let fields = [], value = '', quoted = false, closed = false, fieldStart = true;
  let line = 1, recordLine = 1, index = 0, touched = false;
  const field = () => {
    if (value.length > LAB_TABLE_LIMITS.cellCharacters) labError('CELL_SIZE', 'A source cell exceeds the declared limit.');
    fields.push(value); value = ''; quoted = false; closed = false; fieldStart = true;
    if (fields.length > LAB_TABLE_LIMITS.columns) labError('COLUMN_COUNT', 'A source row exceeds the declared column limit.');
  };
  const row = () => {
    field();
    records.push({ fields, line: recordLine, rowNumber: records.length + 1 });
    if (records.length > LAB_TABLE_LIMITS.rows + 1) labError('ROW_COUNT', 'The source exceeds the declared row limit.');
    fields = []; touched = false; recordLine = line;
  };
  while (index < text.length) {
    const char = text[index++]; touched = true;
    if (quoted) {
      if (char === '"') {
        if (text[index] === '"') { value += '"'; index++; }
        else { quoted = false; closed = true; }
      } else {
        value += char;
        if (char === '\n') line++;
        else if (char === '\r' && text[index] !== '\n') line++;
      }
      continue;
    }
    if (char === delimiter) { field(); continue; }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index] === '\n') index++;
      line++; row(); recordLine = line; continue;
    }
    if (closed) labError('CSV_QUOTE', 'Unexpected source character after a closing quote.', { line, character: char });
    if (char === '"') {
      if (!fieldStart) labError('CSV_QUOTE', 'A quote inside an unquoted source cell is ambiguous.', { line });
      quoted = true; fieldStart = false;
    } else { value += char; fieldStart = false; }
  }
  if (quoted) labError('CSV_QUOTE', 'The source ends inside a quoted cell.', { line });
  if (touched || fields.length || value.length || closed) row();
  return records;
}
export function writeDelimited(rows, delimiter = ',', newline = '\r\n') {
  if (![',', '\t'].includes(delimiter) || !['\r\n', '\n', '\r'].includes(newline))
    labError('TABLE', 'Use an explicit supported delimiter and line ending.');
  return rows.map(row => row.map(value => {
    if (typeof value !== 'string') labError('CELL_TYPE', 'Every prepared source cell must remain an explicit string.');
    return value.includes(delimiter) || /["\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
  }).join(delimiter)).join(newline) + newline;
}
export function decodeText(bytes, encoding = 'utf-8') {
  if (!(bytes instanceof Uint8Array) || !['utf-8', 'windows-1252'].includes(encoding))
    labError('ENCODING', 'Select the original UTF-8 or Windows-1252 encoding explicitly.');
  try { return new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { labError('ENCODING', 'The original bytes do not match the selected text encoding.', { encoding }); }
}
export function encodeText(text, encoding = 'utf-8') {
  if (encoding === 'utf-8') return new TextEncoder().encode(text);
  if (encoding !== 'windows-1252') labError('ENCODING', 'Unsupported original text encoding.');
  const decoder = new TextDecoder('windows-1252'), alphabet = new Map();
  for (let byte = 0; byte < 256; byte++) alphabet.set(decoder.decode(Uint8Array.of(byte)), byte);
  const output = [];
  for (const char of text) {
    const byte = alphabet.get(char);
    if (byte === undefined) labError('ENCODING', 'The edited value cannot be represented in the original Windows-1252 encoding.', { character: char });
    output.push(byte);
  }
  return Uint8Array.from(output);
}
export function decodeCsvFiles(files, profile, { encoding = 'utf-8' } = {}) {
  const tables = [], unassigned = [];
  for (const file of files) {
    let text;
    try { text = decodeText(file.bytes, encoding); }
    catch (error) {
      if (/\.(?:csv|tsv|txt)$/i.test(file.filename)) throw error;
      unassigned.push({ filename: file.filename, reason: 'Non-text source member retained in original delivery.' }); continue;
    }
    const matches = [], failures = [];
    for (const delimiter of profile.delimiters ?? [',']) {
      try {
        const records = parseDelimited(text.startsWith('\uFEFF') ? text.slice(1) : text, delimiter);
        if (!records.length) continue;
        const headers = records[0].fields, keys = headerKeys(headers);
        const id = profile.match({ filename: file.filename, headers, keys });
        if (typeof id === 'string' && id.length) matches.push({ id, headers, keys, records, delimiter });
      } catch (error) { failures.push(error); }
    }
    if (matches.length > 1) labError('AMBIGUOUS_TABLE', 'The source matches more than one table interpretation.', { filename: file.filename });
    if (!matches.length) {
      if (failures.length && /\.(?:csv|tsv|txt)$/i.test(file.filename)) throw failures[0];
      unassigned.push({ filename: file.filename, reason: 'No table in the selected source format matches these original headers.' }); continue;
    }
    const selected = matches[0];
    const records = [], blankRows = [];
    for (const record of selected.records.slice(1)) {
      if (record.fields.every(value => value === '')) { blankRows.push(record.rowNumber); continue; }
      if (record.fields.length !== selected.headers.length)
        labError('ROW_WIDTH', 'A source row has a different number of cells from its original header.', {
          filename: file.filename, row: record.rowNumber, expected: selected.headers.length, observed: record.fields.length,
        });
      records.push(record);
    }
    tables.push({
      id: selected.id, filename: file.filename, headers: selected.headers, records,
      origin: { containerSha256: file.sha256, format: 'delimited', encoding, delimiter: selected.delimiter,
        newline: text.includes('\r\n') ? '\r\n' : text.includes('\n') ? '\n' : '\r',
        bom: text.charCodeAt(0) === 0xFEFF, blankRows },
    });
  }
  return { tables, unassigned };
}
