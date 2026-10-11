// MIT. Merchant-owned source and publication definitions for retained event data.
import { createHash } from 'node:crypto';

export const SCHEMA = 'stellar-forge.webhook-feed.v1';
export const PAGE_SCHEMA = 'stellar-forge.webhook-feed-page.v1';
export const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const digest = value => createHash('sha256').update(value).digest('hex');
export class FeedError extends Error {
  constructor(code, status = 400, details = {}) { super(code); this.name = 'FeedError'; this.code = code; this.status = status; this.details = details; }
}
export function requireId(value, field = 'id') {
  if (typeof value !== 'string' || !ID.test(value)) throw new FeedError('INVALID_ID', 422, { field });
  return value;
}
export function integer(value, field, minimum, maximum, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  const number = typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new FeedError('INVALID_INTEGER', 422, { field, minimum, maximum });
  return number;
}
function text(value, field, max = 512) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new FeedError('INVALID_TEXT', 422, { field });
  return value;
}
function keys(value, allowed) {
  if (!isRecord(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new FeedError('INVALID_DEFINITION', 422);
}
function pointer(value, field) {
  if (typeof value !== 'string' || value.length > 1024 || !value.startsWith('/') || /~(?![01])/.test(value)) throw new FeedError('INVALID_JSON_POINTER', 422, { field });
  const segments = value.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (segments.some(part => ['__proto__', 'prototype', 'constructor'].includes(part))) throw new FeedError('INVALID_JSON_POINTER', 422, { field });
  return value;
}
export function atPointer(value, path) {
  for (const key of path.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}
export function sourceDefinition(value) {
  keys(value, ['id', 'label', 'secretEnv', 'typePointer', 'occurredAtPointer', 'enabled', 'maxEventBytes', 'toleranceSeconds']);
  if (typeof value.secretEnv !== 'string' || !/^[A-Z_][A-Z0-9_]{0,127}$/.test(value.secretEnv)) throw new FeedError('INVALID_SECRET_ENV', 422);
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw new FeedError('INVALID_ENABLED', 422);
  return { id: requireId(value.id), label: text(value.label ?? value.id, 'label', 128), secretEnv: value.secretEnv,
    typePointer: pointer(value.typePointer ?? '/type', 'typePointer'),
    occurredAtPointer: value.occurredAtPointer === undefined || value.occurredAtPointer === null ? null : pointer(value.occurredAtPointer, 'occurredAtPointer'),
    enabled: value.enabled ?? true, maxEventBytes: integer(value.maxEventBytes, 'maxEventBytes', 1024, 262144, 65536),
    toleranceSeconds: integer(value.toleranceSeconds, 'toleranceSeconds', 30, 600, 300) };
}
export function feedDefinition(value) {
  keys(value, ['id', 'label', 'description', 'sourceIds', 'types', 'projection', 'enabled', 'defaultPageSize', 'maxPageSize', 'maxPageBytes']);
  if (!Array.isArray(value.sourceIds) || value.sourceIds.length < 1 || value.sourceIds.length > 32 || new Set(value.sourceIds).size !== value.sourceIds.length) throw new FeedError('INVALID_FEED_SOURCES', 422);
  if (value.types !== undefined && (!Array.isArray(value.types) || value.types.length > 64 || new Set(value.types).size !== value.types.length)) throw new FeedError('INVALID_FEED_TYPES', 422);
  if (!Array.isArray(value.projection) || !value.projection.length || value.projection.length > 64) throw new FeedError('EXPLICIT_PROJECTION_REQUIRED', 422);
  const seen = new Set();
  const projection = value.projection.map(field => {
    keys(field, ['name', 'pointer']); requireId(field.name, 'projection.name');
    if (['__proto__', 'prototype', 'constructor'].includes(field.name) || seen.has(field.name)) throw new FeedError('INVALID_PROJECTION_NAME', 422);
    seen.add(field.name); return { name: field.name, pointer: pointer(field.pointer, 'projection.pointer') };
  });
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw new FeedError('INVALID_ENABLED', 422);
  const maxPageSize = integer(value.maxPageSize, 'maxPageSize', 1, 1000, 100);
  return { id: requireId(value.id), label: text(value.label ?? value.id, 'label', 128), description: text(value.description, 'description', 2048),
    sourceIds: value.sourceIds.map(id => requireId(id, 'sourceIds')).sort(), types: (value.types ?? []).map(type => text(type, 'types', 256)).sort(),
    projection, enabled: value.enabled ?? true, maxPageSize,
    defaultPageSize: integer(value.defaultPageSize, 'defaultPageSize', 1, maxPageSize, Math.min(50, maxPageSize)),
    maxPageBytes: integer(value.maxPageBytes, 'maxPageBytes', 524288, 8388608, 1048576) };
}
export function projectPayload(payload, projection) {
  const result = Object.create(null);
  for (const field of projection) { const value = atPointer(payload, field.pointer); if (value !== undefined) result[field.name] = value; }
  return result;
}
export function revision(definition) { return digest(JSON.stringify(definition)); }
let hasJsonSourceContext = false;
JSON.parse('1', (_key, value, context) => { hasJsonSourceContext = context?.source === '1'; return value; });
export function parseEventPayload(rawBody) {
  if (!hasJsonSourceContext) throw new FeedError('LOSSLESS_NUMBER_RUNTIME_REQUIRED', 503);
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody), (_key, value, context) => {
    // Keep unsafe integer literals in their original spelling using native JSON source context.
    if (typeof value === 'number' && (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value))) {
      if (typeof context?.source !== 'string') throw new FeedError('LOSSLESS_NUMBER_RUNTIME_REQUIRED', 503);
      return context.source;
    }
    return value;
  });
}
export function eventData(source, rawBody) {
  let payload;
  try { payload = parseEventPayload(rawBody); } catch (error) { if (error instanceof FeedError) throw error; throw new FeedError('INVALID_EVENT_JSON', 422); }
  if (!isRecord(payload)) throw new FeedError('EVENT_OBJECT_REQUIRED', 422);
  const type = text(atPointer(payload, source.typePointer), 'event.type', 256);
  const occurred = source.occurredAtPointer ? atPointer(payload, source.occurredAtPointer) : null;
  if (occurred !== null && occurred !== undefined && (typeof occurred !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(occurred) || !Number.isFinite(Date.parse(occurred)))) throw new FeedError('INVALID_EVENT_TIME', 422);
  return { payload, type, occurredAt: occurred == null ? null : new Date(occurred).toISOString() };
}
