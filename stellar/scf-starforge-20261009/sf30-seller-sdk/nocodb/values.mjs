// MIT. Retain provider JSON number lexemes before JavaScript can round them.
import { object, identity, fault } from '../postgres/publisher/files.mjs';
import { csvLine } from '../postgres/publisher/plan.mjs';

export class NocoDBNumber {
  constructor(text) { this.text = text; Object.freeze(this); }
}
export function parseNocoDBRecords(buffer) {
  let response;
  try {
    response = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer), (key, value, context) => {
      if (typeof value !== 'number') return value;
      if (typeof context?.source !== 'string') throw fault('NOCODB_LOSSLESS_JSON_RUNTIME_REQUIRED', 'Use the supported Node.js runtime with JSON.parse source context.');
      return new NocoDBNumber(context.source);
    });
  } catch (issue) { if (issue.code) throw issue; throw fault('NOCODB_RECORDS_JSON_INVALID'); }
  if (!object(response) || !Array.isArray(response.records) || response.records.length > 1000000 ||
      response.next !== undefined && response.next !== null && (typeof response.next !== 'string' || !response.next.length || response.next.length > 32768))
    throw fault('NOCODB_RECORDS_RESPONSE_INVALID');
  for (const row of response.records) {
    if (!object(row) || !object(row.fields) || Object.keys(row.fields).length > 10000 ||
        !(typeof row.id === 'string' && row.id.length <= 65536 || row.id instanceof NocoDBNumber) ||
        row.id_fields !== undefined && !object(row.id_fields))
      throw fault('NOCODB_RECORD_INVALID');
  }
  return response;
}
function canonicalNumber(text) {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) throw fault('NOCODB_JSON_NUMBER_INVALID');
  let digits = (match[2] + (match[3] ?? '')).replace(/^0+/, '');
  let exponent = BigInt(match[4] ?? '0') - BigInt((match[3] ?? '').length);
  if (!digits) return '0';
  const trailing = /0+$/.exec(digits)?.[0].length ?? 0;
  if (trailing) { digits = digits.slice(0, -trailing); exponent += BigInt(trailing); }
  return match[1] + digits + 'e' + exponent;
}
export const recordIdentity = row => row.id instanceof NocoDBNumber ? 'number:' + canonicalNumber(row.id.text) : 'string:' + row.id;
export function identityDigest(records) {
  return identity(records.map(recordIdentity));
}
export function projectedNocoDBValue(row, spec) {
  if (spec.source !== '$recordId' && !Object.hasOwn(row.fields, spec.source))
    throw fault('NOCODB_SELECTED_FIELD_MISSING', 'A selected field is absent, possibly hidden in the view. Review the actual field/view selection; absence is not null.');
  let value = spec.source === '$recordId' ? row.id : row.fields[spec.source];
  if (value === '' && spec.empty === 'null') value = null;
  if (value === null) {
    if (!spec.nullable) throw fault('DATASET_NULL_NOT_ALLOWED');
    return null;
  }
  if (spec.encoding === 'identity-text') {
    if (typeof value === 'string') return value;
    if (value instanceof NocoDBNumber) return value.text;
    throw fault('NOCODB_IDENTITY_VALUE_INVALID');
  }
  if (spec.encoding === 'number-text') {
    if (!(value instanceof NocoDBNumber)) throw fault('NOCODB_NUMBER_TOKEN_REQUIRED', 'The reviewed number-text encoding requires a provider JSON number, not a numeric-looking string.');
    return value.text;
  }
  if (value instanceof NocoDBNumber) {
    if (!['integer', 'number'].includes(spec.type)) throw fault('NOCODB_NATIVE_TYPE_CHANGED');
    const number = Number(value.text);
    if (!Number.isFinite(number) || Number.isInteger(number) && !Number.isSafeInteger(number) ||
        spec.type === 'integer' && !Number.isSafeInteger(number) ||
        canonicalNumber(value.text) !== canonicalNumber(String(number)))
      throw fault('NOCODB_NUMBER_PRECISION_LOSS', 'Choose explicit number-text encoding and a Text dataset column to preserve the exact provider JSON number.');
    return number;
  }
  if (spec.type === 'string' && typeof value === 'string' || spec.type === 'boolean' && typeof value === 'boolean') return value;
  throw fault('NOCODB_NATIVE_TYPE_CHANGED', 'The actual field value does not match its reviewed scalar type. Review the source without automatic string, date or number conversion.');
}
export function scalarText(value, spec) {
  if (value === null) { if (!spec.nullable) throw fault('DATASET_NULL_NOT_ALLOWED'); return ''; }
  if (spec.type === 'string' && typeof value !== 'string' || spec.type === 'boolean' && typeof value !== 'boolean' ||
      spec.type === 'integer' && !Number.isSafeInteger(value) ||
      spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)))
    throw fault('NOCODB_PROJECTED_VALUE_INVALID');
  const text = String(value);
  if (!text.length && spec.nullable)
    throw fault('DATASET_EMPTY_NULL_CONFLICT', 'Choose explicit empty-to-null or a non-nullable Text column.');
  return text;
}
export function encodeNocoDBRow(row, dataset) {
  return csvLine(Object.entries(dataset.columns).map(([name, spec]) => {
    const text = scalarText(row[name], spec);
    if (text.length > dataset.maxCellChars) throw fault('DATASET_CELL_TOO_LARGE');
    return text;
  }));
}
export function checkNocoDBColumnTypes(columns, types) {
  if (!Array.isArray(types)) throw fault('NOCODB_COLUMN_TYPES_MISSING');
  for (const [name, spec] of Object.entries(columns)) {
    const selected = types.find(column => column.name === name);
    if (!selected || selected.type !== spec.type) throw fault('NOCODB_COLUMN_TYPE_MISMATCH', 'Use the reviewed type for ' + name + '.');
  }
}
