// MIT. Original JSON number tokens, decimal strings and complete structured fields.
import { object, identity, fault } from '../postgres/publisher/files.mjs';
import { csvLine } from '../postgres/publisher/plan.mjs';

export class BaserowNumber {
  constructor(text) { this.text = text; Object.freeze(this); }
}
export function parseBaserowJson(buffer) {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer), (key, value, context) => {
      if (typeof value !== 'number') return value;
      if (typeof context?.source !== 'string') throw fault('BASEROW_LOSSLESS_JSON_RUNTIME_REQUIRED', 'Use the supported Node.js runtime with JSON.parse source context.');
      return new BaserowNumber(context.source);
    });
  } catch (issue) { if (issue.code) throw issue; throw fault('BASEROW_RESPONSE_JSON_INVALID'); }
}
export function exactJson(value) {
  if (value instanceof BaserowNumber) return value.text;
  if (Array.isArray(value)) return '[' + value.map(exactJson).join(',') + ']';
  if (object(value)) return '{' + Object.entries(value).map(([key, item]) => JSON.stringify(key) + ':' + exactJson(item)).join(',') + '}';
  if (value === null || ['string', 'boolean'].includes(typeof value)) return JSON.stringify(value);
  throw fault('BASEROW_ORIGINAL_JSON_VALUE_INVALID');
}
export function canonicalNumber(text) {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) throw fault('BASEROW_DECIMAL_INVALID');
  let digits = (match[2] + (match[3] ?? '')).replace(/^0+/, '');
  let exponent = BigInt(match[4] ?? '0') - BigInt((match[3] ?? '').length);
  if (!digits) return '0';
  const trailing = /0+$/.exec(digits)?.[0].length ?? 0;
  if (trailing) { digits = digits.slice(0, -trailing); exponent += BigInt(trailing); }
  return match[1] + digits + 'e' + exponent;
}
export function countValue(value) {
  if (!(value instanceof BaserowNumber) || !/^(0|[1-9][0-9]*)$/.test(value.text)) throw fault('BASEROW_COUNT_INVALID');
  const number = Number(value.text);
  if (!Number.isSafeInteger(number) || number < 0) throw fault('BASEROW_COUNT_INVALID');
  return number;
}
export function recordIdentity(row) {
  if (!(row.id instanceof BaserowNumber) || !/^[1-9][0-9]*$/.test(row.id.text)) throw fault('BASEROW_RECORD_ID_INVALID');
  return row.id.text;
}
export const identityDigest = rows => identity(rows.map(recordIdentity));
export function parseBaserowRecords(buffer) {
  const response = parseBaserowJson(buffer);
  if (!object(response) || !Array.isArray(response.results) || response.results.length > 1000000 ||
      !Object.hasOwn(response, 'next') || response.next !== null &&
      (typeof response.next !== 'string' || !response.next.length || response.next.length > 32768))
    throw fault('BASEROW_RECORDS_RESPONSE_INVALID');
  const count = countValue(response.count);
  for (const row of response.results) {
    if (!object(row) || Object.keys(row).length > 10000) throw fault('BASEROW_RECORD_INVALID');
    recordIdentity(row);
    if (typeof row.order !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(row.order)) throw fault('BASEROW_RECORD_ORDER_INVALID');
  }
  return { ...response, count };
}
function asNumber(text, type) {
  const number = Number(text);
  if (!Number.isFinite(number) || Number.isInteger(number) && !Number.isSafeInteger(number) ||
      type === 'integer' && !Number.isSafeInteger(number) ||
      canonicalNumber(text) !== canonicalNumber(String(number)))
    throw fault('BASEROW_NUMBER_PRECISION_LOSS', 'Use a Text column to preserve the original JSON number or decimal string exactly.');
  return number;
}
export function projectedBaserowValue(row, spec, attachments = new Map()) {
  const special = ['$recordId', '$order'].includes(spec.source);
  if (!special && !Object.hasOwn(row, spec.source)) throw fault('BASEROW_SELECTED_FIELD_MISSING', 'The selected original field is absent. Review visibility and source selection; absence is not null.');
  let value = spec.source === '$recordId' ? row.id : spec.source === '$order' ? row.order : row[spec.source];
  if (value === '' && spec.empty === 'null') value = null;
  if (value === null) { if (!spec.nullable) throw fault('DATASET_NULL_NOT_ALLOWED'); return null; }
  if (spec.encoding === 'identity-text') {
    if (typeof value === 'string') return value;
    if (value instanceof BaserowNumber) return value.text;
    throw fault('BASEROW_IDENTITY_VALUE_INVALID');
  }
  if (spec.encoding === 'number-text') {
    if (!(value instanceof BaserowNumber)) throw fault('BASEROW_NUMBER_TOKEN_REQUIRED');
    return value.text;
  }
  if (spec.encoding === 'json-text') return exactJson(value);
  if (spec.encoding === 'select-value') {
    if (!object(value) || typeof value.value !== 'string') throw fault('BASEROW_SELECT_VALUE_INVALID');
    return value.value;
  }
  if (spec.encoding === 'attachments') {
    if (!Array.isArray(value)) throw fault('BASEROW_FILE_FIELD_INVALID');
    return JSON.stringify(value.map((file, index) => {
      const item = attachments.get(recordIdentity(row) + ':' + spec.source + ':' + index);
      if (!item) throw fault('BASEROW_RETAINED_ATTACHMENT_MISSING');
      return { name: file.visible_name, storageName: file.name, mimeType: file.mime_type,
        bytes: item.bytes, sha256: item.sha256, sourceUrl: file.url };
    }));
  }
  if (spec.encoding === 'decimal-number') {
    if (typeof value !== 'string' || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value))
      throw fault('BASEROW_DECIMAL_STRING_REQUIRED');
    return asNumber(value, spec.type);
  }
  if (value instanceof BaserowNumber) {
    if (!['integer', 'number'].includes(spec.type)) throw fault('BASEROW_NATIVE_TYPE_CHANGED');
    return asNumber(value.text, spec.type);
  }
  if (spec.type === 'string' && typeof value === 'string' || spec.type === 'boolean' && typeof value === 'boolean') return value;
  throw fault('BASEROW_NATIVE_TYPE_CHANGED', 'Choose the original scalar type or explicit JSON text encoding for a structured field.');
}
export function scalarText(value, spec) {
  if (value === null) { if (!spec.nullable) throw fault('DATASET_NULL_NOT_ALLOWED'); return ''; }
  if (spec.type === 'string' && typeof value !== 'string' || spec.type === 'boolean' && typeof value !== 'boolean' ||
      spec.type === 'integer' && !Number.isSafeInteger(value) ||
      spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)))
    throw fault('BASEROW_PROJECTED_VALUE_INVALID');
  const text = String(value);
  if (!text.length && spec.nullable) throw fault('DATASET_EMPTY_NULL_CONFLICT', 'Choose explicit empty-to-null or a non-nullable Text column.');
  return text;
}
export function encodeBaserowRow(row, dataset) {
  return csvLine(Object.entries(dataset.columns).map(([name, spec]) => {
    const text = scalarText(row[name], spec);
    if (text.length > dataset.maxCellChars) throw fault('DATASET_CELL_TOO_LARGE');
    return text;
  }));
}
export function checkBaserowColumnTypes(columns, types) {
  if (!Array.isArray(types)) throw fault('BASEROW_COLUMN_TYPES_MISSING');
  for (const [name, spec] of Object.entries(columns)) {
    const selected = types.find(column => column.name === name);
    if (!selected || selected.type !== spec.type) throw fault('BASEROW_COLUMN_TYPE_MISMATCH', 'Use the reviewed type for ' + name + '.');
  }
}
