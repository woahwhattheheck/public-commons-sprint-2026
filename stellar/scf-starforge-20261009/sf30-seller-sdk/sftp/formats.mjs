// MIT. Original CSV records and lossless JSON numeric lexemes from retained bytes.
import { createReadStream, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { readPrivate } from '../postgres/publisher/files.mjs';
import { readFile } from 'node:fs/promises';
import { createCsvRecordParser } from '../dataset-handler.mjs';
import { fail, object, pointerParts, escapePointer, isIntegralDecimal } from './config.mjs';

export class SourceNumber {
  constructor(text) { this.text = text; Object.freeze(this); }
  toJSON() { return this.text; }
}
export const MISSING = Symbol('missing source field');
export function parseSourceJson(text) {
  try {
    return JSON.parse(text, (_key, value, context) => {
      if (typeof value !== 'number') return value;
      if (typeof context?.source !== 'string') throw fail('SFTP_EXACT_JSON_RUNTIME_REQUIRED', 'Use Node with JSON.parse source context to retain numeric tokens.');
      return new SourceNumber(context.source);
    });
  } catch (issue) { if (issue instanceof Error && issue.code) throw issue; throw fail('SFTP_JSON_INVALID'); }
}
export function pointerValue(value, pointer) {
  for (const part of pointerParts(pointer)) {
    if (value === null || typeof value !== 'object' || value instanceof SourceNumber ||
        Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(part) || !Object.hasOwn(value, part)) return MISSING;
    value = value[part];
  }
  return value;
}
export function sourceType(value) {
  return value === MISSING ? 'missing' : value === null ? 'null' : value instanceof SourceNumber ? 'json-number' : Array.isArray(value) ? 'array' : typeof value;
}
export function sourceString(value) {
  if (value instanceof SourceNumber) return value.text;
  if (value === null) return 'null';
  if (Array.isArray(value)) return '[' + value.map(sourceStringJson).join(',') + ']';
  if (typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + sourceStringJson(value[key])).join(',') + '}';
  return String(value);
}
function sourceStringJson(value) { return typeof value === 'string' ? JSON.stringify(value) : sourceString(value); }
function record(value, maxRowBytes) {
  if (!object(value) || value instanceof SourceNumber) throw fail('SFTP_RECORD_OBJECT_REQUIRED');
  if (Buffer.byteLength(sourceString(value)) > maxRowBytes) throw fail('SFTP_SOURCE_ROW_TOO_LARGE');
  return value;
}
export async function* readSourceRecords(file, format, { recordsPointer = '', maxRowBytes = 1024 * 1024, signal, expectedSha256, expectedBytes } = {}) {
  signal?.throwIfAborted();
  const capturedHash = createHash('sha256'); let receivedBytes = 0;
  const observeBytes = chunk => {
    receivedBytes += chunk.length;
    if (expectedBytes !== undefined && receivedBytes > expectedBytes) throw fail('SFTP_LOCAL_CAPTURE_CHANGED');
    capturedHash.update(chunk);
  };
  const completeCapture = () => {
    const observedHash = capturedHash.digest('hex');
    if (expectedBytes !== undefined && receivedBytes !== expectedBytes || expectedSha256 !== undefined && observedHash !== expectedSha256)
      throw fail('SFTP_LOCAL_CAPTURE_CHANGED', 'The retained file bytes differ from their completed capture receipt.');
  };
  if (format === 'json') {
    const raw = expectedBytes === undefined ? await readFile(file, { signal }) : await readPrivate(file, expectedBytes);
    observeBytes(raw); completeCapture();
    const value = parseSourceJson(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    const selected = pointerValue(value, recordsPointer);
    if (!Array.isArray(selected)) throw fail('SFTP_RECORD_ARRAY_REQUIRED', 'The selected JSON Pointer must contain an array of records.');
    for (const row of selected) { signal?.throwIfAborted(); yield record(row, maxRowBytes); }
    return;
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const stream = createReadStream(file, { highWaterMark: 32768, signal, flags: constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) });
  if (format === 'ndjson') {
    let pending = '', first = true;
    try {
      for await (const chunk of stream) {
        observeBytes(chunk);
        pending += decoder.decode(chunk, { stream: true });
        if (first) { first = false; pending = pending.replace(/^\uFEFF/, ''); }
        let end;
        while ((end = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, end).replace(/\r$/, ''); pending = pending.slice(end + 1);
          if (!line.trim()) continue;
          if (Buffer.byteLength(line) > maxRowBytes) throw fail('SFTP_SOURCE_ROW_TOO_LARGE');
          yield record(parseSourceJson(line), maxRowBytes);
        }
        if (Buffer.byteLength(pending) > maxRowBytes) throw fail('SFTP_SOURCE_ROW_TOO_LARGE');
      }
      pending += decoder.decode();
      if (pending.trim()) yield record(parseSourceJson(pending), maxRowBytes);
      completeCapture();
    } finally { stream.destroy(); }
    return;
  }
  if (format !== 'csv') throw fail('SFTP_FORMAT_INVALID');
  let headers, rows = [];
  const parser = createCsvRecordParser(cells => {
    if (!headers) {
      if (!cells.length || cells.some(value => !value) || new Set(cells).size !== cells.length) throw fail('SFTP_CSV_HEADERS_INVALID');
      headers = cells; return;
    }
    if (cells.length !== headers.length) throw fail('SFTP_CSV_COLUMNS_CHANGED');
    const row = Object.create(null); headers.forEach((header, index) => { row[header] = cells[index]; });
    rows.push(record(row, maxRowBytes));
  }, maxRowBytes);
  try {
    for await (const chunk of stream) {
        observeBytes(chunk);
      parser.feed(decoder.decode(chunk, { stream: true }));
      for (const row of rows) { signal?.throwIfAborted(); yield row; }
      rows = [];
    }
    parser.feed(decoder.decode()); parser.end();
    for (const row of rows) { signal?.throwIfAborted(); yield row; }
    if (!headers) throw fail('SFTP_CSV_HEADERS_REQUIRED');
    completeCapture();
  } catch (issue) { if (issue?.code) throw issue; throw fail('SFTP_CSV_INVALID'); }
  finally { stream.destroy(); }
}
export function projectRecord(raw, query) {
  const row = Object.create(null), observed = Object.create(null);
  for (const [name, spec] of Object.entries(query.mapping)) {
    let value = pointerValue(raw, spec.pointer); observed[name] = sourceType(value);
    if (value === MISSING) {
      if (spec.missing === 'null' && spec.nullable) value = null;
      else throw fail('SFTP_SOURCE_FIELD_MISSING', 'Review the pointer for ' + name + '.');
    }
    if (query.format === 'csv' && value === '' && spec.nullable) value = null;
    if (value === null) {
      if (!spec.nullable) throw fail('SFTP_SOURCE_NULL_NOT_ALLOWED', 'Review nullability for ' + name + '.');
      row[name] = null; continue;
    }
    if (spec.type === 'string') { row[name] = sourceString(value); continue; }
    if (spec.type === 'boolean') {
      if (typeof value === 'boolean') row[name] = value;
      else if (query.format === 'csv' && ['true', 'false'].includes(value)) row[name] = value === 'true';
      else throw fail('SFTP_SOURCE_BOOLEAN_INVALID', 'Use a native Boolean or CSV true/false for ' + name + '.');
      continue;
    }
    const text = value instanceof SourceNumber ? value.text : typeof value === 'string' ? value : null;
    if (text === null || !/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(text)) throw fail('SFTP_SOURCE_NUMBER_INVALID');
    const number = Number(text);
    if (!Number.isFinite(number)) throw fail('SFTP_SOURCE_NUMBER_NOT_FINITE');
    if (spec.type === 'integer' && (!isIntegralDecimal(text) || !Number.isSafeInteger(number))) throw fail('DATASET_INTEGER_REQUIRES_EXACT_STRING');
    row[name] = number;
  }
  return { row, observed };
}
export function matchesWhere(row, query, values) {
  return query.where.every(({ column, op, parameter }) => {
    if (!Object.hasOwn(values, parameter)) return true;
    const a = row[column], b = values[parameter];
    if (a === null) return op === 'ne';
    return op === 'eq' ? a === b : op === 'ne' ? a !== b : op === 'lt' ? a < b : op === 'lte' ? a <= b : op === 'gt' ? a > b : a >= b;
  });
}
export function sampleColumns(rows) {
  const columns = new Map();
  function visit(value, pointer, depth) {
    if (object(value) && !(value instanceof SourceNumber) && depth < 4) {
      for (const [key, child] of Object.entries(value)) {
        const path = pointer + escapePointer(key); const current = columns.get(path) ?? { name: key, pointer: path, types: {}, present: 0 };
        const type = sourceType(child); current.types[type] = (current.types[type] ?? 0) + 1; current.present++; columns.set(path, current);
        if (columns.size > 1024) throw fail('SFTP_SAMPLE_FIELDS_LIMIT');
        if (object(child) && !(child instanceof SourceNumber)) visit(child, path, depth + 1);
      }
    }
  }
  for (const row of rows) visit(row, '', 0);
  return [...columns.values()].map(column => ({ ...column, missing: rows.length - column.present,
    nullable: column.present < rows.length || Boolean(column.types.null) }));
}
export function suggestedColumns(columns) {
  const result = Object.create(null);
  for (const column of columns.filter(column => !column.types.object).slice(0, 64)) {
    let name = column.name.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40);
    if (!/^[A-Za-z]/.test(name) || ['constructor', 'prototype', '__proto__'].includes(name)) name = 'field_' + name;
    name = name.slice(0, 44); const stem = name || 'field'; let suffix = 1;
    while (Object.hasOwn(result, name)) name = stem + '_' + ++suffix;
    result[name] = { pointer: column.pointer, type: Object.keys(column.types).every(type => ['boolean', 'null'].includes(type)) && column.types.boolean ? 'boolean' : 'string',
      nullable: column.nullable, missing: column.missing ? 'null' : 'error' };
  }
  return result;
}
