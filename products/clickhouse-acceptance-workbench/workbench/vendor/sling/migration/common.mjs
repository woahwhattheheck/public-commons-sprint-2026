// SPDX-License-Identifier: MIT
import { createHash } from 'node:crypto';

export class MigrationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MigrationError';
    this.code = code;
    this.details = details;
  }
}
export function requireValue(condition, code, message, details = {}) {
  if (!condition) throw new MigrationError(code, message, details);
}
export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function canonical(value) {
  if (Array.isArray(value)) return '[' + Array.from(value, canonical).join(',') + ']';
  if (isObject(value)) return '{' + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  requireValue(value !== undefined && (typeof value !== 'number' || Number.isFinite(value)),
    'invalid_json_value', 'Use finite, defined JSON values.');
  const rendered = JSON.stringify(value);
  requireValue(typeof rendered === 'string', 'invalid_json_value', 'Use JSON values, with exact large numbers stored as strings.');
  return rendered;
}
export const copy = value => JSON.parse(canonical(value));
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const objectDigest = value => sha256(canonical(value));
export function alias(value, camel, snake, fallback = null) {
  const a = value?.[camel], b = value?.[snake];
  if (a != null && b != null) requireValue(canonical(a) === canonical(b),
    'conflicting_field_aliases', 'The camel-case and snake-case fields disagree.', { fields: [camel, snake] });
  return a ?? b ?? fallback;
}
export function nonempty(value, field) {
  requireValue(typeof value === 'string' && value.length > 0 && !/[\u0000\r\n]/.test(value),
    'invalid_identifier', 'Supply a nonempty single-line string.', { field });
  return value;
}
export function fieldPath(value, field, allowEmpty = true) {
  requireValue(Array.isArray(value) && value.every(part => typeof part === 'string' && part.length > 0),
    'invalid_field_path', 'A field path must be an array of nonempty strings.', { field });
  requireValue(allowEmpty || value.length > 0, 'empty_field_path', 'Select a field path.', { field });
  return value.slice();
}
export function pointer(path) {
  return '/' + path.map(part => part.replaceAll('~', '~0').replaceAll('/', '~1')).join('/');
}
export function streamId(namespace, name) {
  return JSON.stringify([namespace || '', name]);
}
export function issue(code, message, stream = null, details = {}, severity = 'error') {
  return { code, severity, streamId: stream?.id ?? null, message, ...details };
}
export function quotedIdentifier(identifier, dialect = 'postgres') {
  nonempty(identifier, 'SQL identifier');
  if (dialect === 'mysql' || dialect === 'bigquery') {
    const tick = String.fromCharCode(96);
    return tick + identifier.replaceAll(tick, tick + tick) + tick;
  }
  if (dialect === 'sqlserver') return '[' + identifier.replaceAll(']', ']]') + ']';
  requireValue(['postgres', 'sqlite', 'snowflake', 'duckdb'].includes(dialect),
    'unsupported_sql_dialect', 'Select a supported SQL identifier dialect.', { dialect });
  return '"' + identifier.replaceAll('"', '""') + '"';
}
export function relation(parts, dialect = 'postgres') {
  requireValue(Array.isArray(parts) && parts.length > 0 && parts.length <= 3,
    'invalid_relation', 'A relation must contain one to three identifier components.');
  if (dialect === 'bigquery') {
    parts.forEach(part => nonempty(part, 'relation component'));
    const tick = String.fromCharCode(96);
    requireValue(parts.every(part => !part.includes(tick)), 'invalid_relation', 'BigQuery identifiers cannot contain a backtick.');
    return tick + parts.join('.') + tick;
  }
  return parts.map(part => quotedIdentifier(part, dialect)).join('.');
}
export function yamlDocument(value) {
  // JSON is an accepted YAML document in the original Sling YAML reader.
  // Quoting every key and scalar also prevents implicit booleans and timestamps.
  return JSON.stringify(value, null, 2) + '\n';
}
export function unique(values, code, message) {
  requireValue(new Set(values).size === values.length, code, message);
  return values;
}

export function verifyDocumentDigest(document, field) {
  requireValue(isObject(document) && typeof document[field] === 'string',
    'missing_document_digest', 'Select the retained document edition.', { field });
  const body = { ...document }; delete body[field];
  requireValue(objectDigest(body) === document[field], 'document_edition_changed',
    'The selected document contents no longer match its retained digest.', { field });
  return document;
}
