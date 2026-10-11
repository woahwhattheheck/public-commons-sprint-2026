#!/usr/bin/env node
/**
 * Offline translation of an operator-approved content inventory into the
 * EXISTING KZFR WordPress bridge's reviewed CSV draft-import contract.
 * No API credentials, web requests, publishing, or Creek calls.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const FIELDS = Object.freeze([
  'source_id', 'type', 'title', 'content', 'excerpt', 'genre',
  'creek_url', 'event_date', 'website',
]);
const TYPES = new Set(['program', 'event', 'underwriter']);
const MAX_SOURCE = 10 * 1024 * 1024;
const MAX_ROWS = 5000;
const MAX_DEST_ROWS = 500;
const MAX_DEST_BYTES = 1024 * 1024;
const HEADER = FIELDS.join(',') + '\n';
const HEADER_BYTES = Buffer.byteLength(HEADER);
const digest = value => createHash('sha256').update(value).digest('hex');
const owned = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const record = value => value && typeof value === 'object' && !Array.isArray(value);

function cliArgs(argv) {
  if (argv.length === 1 && argv[0] === '--help') return null;
  if (argv.length !== 6) throw new Error('Usage: node prepare-approved-inventory.mjs --input SOURCE.csv --map MAPPING.json --out-dir NEW_DIRECTORY');
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!['--input', '--map', '--out-dir'].includes(key) || owned(args, key) ||
        !argv[i + 1] || argv[i + 1].startsWith('--')) {
      throw new Error('Provide --input, --map, and --out-dir exactly once.');
    }
    args[key] = resolve(argv[i + 1]);
  }
  if (Object.keys(args).length !== 3 || args['--input'] === args['--map'] ||
      args['--out-dir'] === args['--input'] || args['--out-dir'] === args['--map']) {
    throw new Error('Distinct input, mapping, and new output directory required.');
  }
  return args;
}

function fileBytes(path, max) {
  const size = statSync(path).size;
  if (!Number.isSafeInteger(size) || size > max) throw new Error('Source or mapping exceeds approved size limit.');
  return readFileSync(path);
}

function utf8(bytes) {
  let value;
  try { value = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('Input must be valid UTF-8.'); }
  if (value.includes('\0')) throw new Error('NUL bytes are not permitted.');
  return value.replace(/^\uFEFF/, '');
}

/** Bounded RFC 4180 reader: escaped quotes, commas and multiline quoted values. */
function readCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  let started = false;
  const pushField = () => {
    row.push(field);
    field = '';
    started = false;
    afterQuote = false;
  };
  const pushRow = () => {
    pushField();
    if (row.length !== 1 || row[0] !== '') rows.push(row);
    row = [];
    if (rows.length > MAX_ROWS + 1) throw new Error('More than 5000 source records.');
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; afterQuote = true; }
      } else { field += c; }
      continue;
    }
    if (afterQuote && ![',', '\r', '\n'].includes(c)) {
      throw new Error('Unexpected character following a quoted CSV field.');
    }
    if (c === ',') { pushField(); continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      pushRow();
      continue;
    }
    if (c === '"') {
      if (started || field !== '') throw new Error('Unexpected quote in unquoted CSV field.');
      quoted = true;
      started = true;
      continue;
    }
    field += c;
    started = true;
  }
  if (quoted) throw new Error('Unclosed quoted CSV field.');
  if (row.length || field !== '' || started || afterQuote) pushRow();
  if (!rows.length) throw new Error('Source CSV is empty.');
  const header = rows.shift();
  if (!header.length || header.some(h => !h || h.includes('\n') || h.includes('\r')) ||
      new Set(header).size !== header.length) {
    throw new Error('Source CSV header must have unique, nonempty column names.');
  }
  return { header, rows };
}

function validateMapping(value, header) {
  if (!record(value) || value.version !== 1 || !record(value.columns) ||
      Object.keys(value).some(k => !['version', 'type', 'columns', 'type_values'].includes(k))) {
    throw new Error('Mapping must be version 1 with an explicit columns object.');
  }
  const names = Object.keys(value.columns);
  if (!names.includes('source_id') || !names.includes('title') ||
      names.some(k => !FIELDS.includes(k) && k !== 'type')) {
    throw new Error('Map source_id and title; unknown destination column.');
  }
  if (value.type && (names.includes('type') || !TYPES.has(value.type))) {
    throw new Error('Set either a fixed type or a source type column, never both.');
  }
  if (!value.type && !names.includes('type')) throw new Error('Map a type column or a fixed type.');
  for (const name of names) {
    if (typeof value.columns[name] !== 'string' || !header.includes(value.columns[name])) {
      throw new Error('Mapped input column is missing: ' + name);
    }
  }
  if (value.type_values !== undefined) {
    if (!names.includes('type') || !record(value.type_values) ||
        !Object.keys(value.type_values).length ||
        Object.values(value.type_values).some(x => !TYPES.has(x))) {
      throw new Error('type_values requires a mapped source type and explicit program/event/underwriter targets.');
    }
  }
  return value;
}

function validHttps(value, creekOnly) {
  if (!value || /\s/.test(value)) return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.port) return false;
  const authority = value.match(/^https:\/\/([^/?#]+)/);
  if (!authority || authority[1].includes('@') || /:[0-9]+$/.test(authority[1])) return false;
  return !creekOnly || url.hostname.toLowerCase() === 'kzfr.studio.creek.org';
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return false;
  const dt = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(dt.valueOf()) && dt.toISOString().slice(0, 10) === value;
}

function mapRow(cells, index, columns, mapping, seen) {
  const failures = [];
  if (cells.length !== columns.length) return { rejection: { row: index, reasons: ['Column count differs from source header.'] } };
  const raw = Object.fromEntries(columns.map((name, i) => [name, cells[i]]));
  const output = Object.fromEntries(FIELDS.map(name => [
    name, mapping.columns[name] ? raw[mapping.columns[name]].trim() : '',
  ]));
  let kind = mapping.type || raw[mapping.columns.type].trim();
  if (mapping.type_values) {
    kind = owned(mapping.type_values, kind) ? mapping.type_values[kind] : '';
  }
  output.type = kind;
  if (!TYPES.has(kind)) failures.push('Unknown content type.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,159}$/.test(output.source_id)) {
    failures.push('Invalid stable source_id.');
  } else if (seen.has(output.source_id)) failures.push('Duplicate source_id in this export.');
  if (!output.title || Buffer.byteLength(output.title, 'utf8') > 250) failures.push('Title is empty or exceeds 250 UTF-8 bytes.');
  if (kind === 'program') {
    if (output.creek_url && !validHttps(output.creek_url, true)) failures.push('Program Creek URL must use the approved kzfr.studio.creek.org HTTPS host without credentials/port.');
    if (output.event_date || output.website) failures.push('Program contains another content type’s fields.');
  }
  if (kind === 'event') {
    if (!validDate(output.event_date)) failures.push('Event date must be a real YYYY-MM-DD calendar date.');
    if (output.creek_url || output.website || output.genre) failures.push('Event contains another content type’s fields.');
  }
  if (kind === 'underwriter') {
    if (output.website && !validHttps(output.website, false)) failures.push('Underwriter website must be an HTTPS URL without credentials/port.');
    if (output.creek_url || output.event_date || output.genre) failures.push('Underwriter contains another content type’s fields.');
  }
  if (failures.length) return { rejection: { row: index, reasons: failures } };
  seen.add(output.source_id);
  return { output };
}

function encodeCsv(fields) {
  return fields.map(value => {
    const text = String(value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }).join(',');
}

function writeExclusive(directory, name, content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  writeFileSync(join(directory, name), bytes, { flag: 'wx', mode: 0o600 });
  return { name, rows: null, bytes: bytes.length, sha256: digest(bytes) };
}

function prepare(args) {
  const source = fileBytes(args['--input'], MAX_SOURCE);
  const mapSource = fileBytes(args['--map'], 256 * 1024);
  const { header, rows } = readCsv(utf8(source));
  let mapping;
  try { mapping = JSON.parse(utf8(mapSource)); }
  catch { throw new Error('Mapping is not a valid JSON object.'); }
  mapping = validateMapping(mapping, header);
  const seen = new Set();
  const rejections = [];
  const accepted = [];
  for (let i = 0; i < rows.length; i++) {
    const result = mapRow(rows[i], i + 2, header, mapping, seen);
    if (result.rejection) { rejections.push(result.rejection); continue; }
    const serialized = encodeCsv(FIELDS.map(field => result.output[field])) + '\n';
    if (Buffer.byteLength(serialized, 'utf8') + HEADER_BYTES > MAX_DEST_BYTES) {
      rejections.push({ row: i + 2, reasons: ['Single record exceeds the 1 MiB WordPress CSV import limit.'] });
      continue;
    }
    accepted.push(serialized);
  }
  // Nothing is created until parsing, mapping and source review classification finish.
  const out = args['--out-dir'];
  mkdirSync(out, { mode: 0o700 });
  const chunks = [];
  let buffer = HEADER;
  let size = HEADER_BYTES;
  let count = 0;
  const flush = () => {
    if (!count) return;
    const name = 'approved-import-' + String(chunks.length + 1).padStart(3, '0') + '.csv';
    const detail = writeExclusive(out, name, buffer);
    detail.rows = count;
    chunks.push(detail);
    buffer = HEADER;
    size = HEADER_BYTES;
    count = 0;
  };
  for (const line of accepted) {
    const bytes = Buffer.byteLength(line, 'utf8');
    if (count === MAX_DEST_ROWS || size + bytes > MAX_DEST_BYTES) flush();
    buffer += line;
    size += bytes;
    count++;
  }
  flush();
  const manifest = {
    schema: 'kzfr-approved-inventory/v1',
    source_sha256: digest(source),
    mapping_sha256: digest(mapSource),
    source_records: rows.length,
    accepted_records: accepted.length,
    rejected_records: rejections.length,
    import_header: FIELDS,
    chunks,
    status: rejections.length ? 'REVIEW_REJECTIONS_BEFORE_IMPORT' : 'READY_FOR_WORDPRESS_ADMIN_REVIEW',
    note: 'Offline operator mapping, not Creek API data or publication permission. WordPress importer creates selected drafts only.',
  };
  writeExclusive(out, 'rejections.json', JSON.stringify(rejections, null, 2) + '\n');
  writeExclusive(out, 'manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  process.stdout.write(JSON.stringify({
    out_dir: out, source_records: rows.length, accepted_records: accepted.length,
    rejected_records: rejections.length, chunks: chunks.length, manifest: join(out, 'manifest.json'),
  }) + '\n');
  if (rejections.length) process.exitCode = 3;
}

try {
  const args = cliArgs(process.argv.slice(2));
  if (args === null) {
    process.stdout.write('Usage: node prepare-approved-inventory.mjs --input SOURCE.csv --map MAPPING.json --out-dir NEW_DIRECTORY\n');
  } else {
    prepare(args);
  }
} catch (error) {
  process.stderr.write('KZFR inventory preparation: ' + error.message + '\n');
  process.exitCode = 2;
}
