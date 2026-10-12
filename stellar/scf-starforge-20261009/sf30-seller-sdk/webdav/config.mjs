// MIT. WebDAV declarations; original SFTP field projection and CSV parser are reused.
import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { pointerParts } from '../sftp/config.mjs';

export const SOURCE_SCHEMA = 'stellar-forge.webdav-source.v1';
export const HASH = /^[a-f0-9]{64}$/;
export const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ENV = /^[A-Z][A-Z0-9_]{1,127}$/;
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const TYPE = new Set(['string', 'integer', 'number', 'boolean']);
export class WebDavError extends Error {
  constructor(code, message = code, status = 400, details = {}) {
    super(message); this.name = 'WebDavError'; this.code = code; this.status = status; this.details = details;
  }
}
export function fail(code, message, status, details) { throw new WebDavError(code, message, status, details); }
export const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export function exact(value, fields, label) {
  if (!object(value) || Object.keys(value).some(key => !fields.includes(key)))
    fail('WEBDAV_FIELDS', 'Unsupported fields in ' + label + '.');
  return value;
}
export function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    fail('WEBDAV_INTEGER', 'Use an integer from ' + minimum + ' to ' + maximum + ' for ' + label + '.');
  return value;
}
export function text(value, maximum, label, empty = false) {
  if (typeof value !== 'string' || value.length > maximum || (!empty && !value.trim()) || value.includes('\0'))
    fail('WEBDAV_TEXT', 'Enter ' + label + ' within ' + maximum + ' characters.');
  return value;
}
export const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function canonical(value) {
  return Array.isArray(value) ? value.map(canonical) : object(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
}
export const identity = value => sha256(JSON.stringify(canonical(value)));
export const clone = value => structuredClone(value);
export const now = () => new Date().toISOString();
export function opaqueEtag(value, { nullable = true } = {}) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || value.length > 1024 || !/^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/.test(value))
    fail('WEBDAV_ETAG', 'Retain the complete quoted ETag from the original response.');
  return value;
}
export const strongEtag = value => typeof value === 'string' && !value.startsWith('W/') && opaqueEtag(value) !== null;
function cleanPath(pathname) {
  return pathname.split('/').map(part => {
    let value;
    try { value = decodeURIComponent(part); } catch { fail('WEBDAV_PATH_ENCODING', 'Use valid UTF-8 URL path escapes.'); }
    if (value === '.' || value === '..' || /[\\/\u0000-\u001f\u007f]/.test(value))
      fail('WEBDAV_PATH', 'A WebDAV path cannot escape its declared collection.');
    return encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  }).join('/');
}
export function rootUrl(value, allowLocalHttp = false) {
  text(value, 8192, 'the collection URL');
  let url;
  try { url = new URL(value); } catch { fail('WEBDAV_URL', 'Use an absolute WebDAV collection URL.'); }
  if (url.username || url.password || url.search || url.hash)
    fail('WEBDAV_URL', 'Keep credentials in environment references; the collection URL has no query or fragment.');
  const local = allowLocalHttp && url.protocol === 'http:' &&
    ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local)
    fail('WEBDAV_HTTPS', 'Use HTTPS; loopback HTTP requires the explicit local setting.');
  url.pathname = cleanPath(url.pathname);
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}
export function resourceUrl(root, href = '') {
  if (typeof href !== 'string' || href.length > 8192 || /[\\\u0000-\u001f\u007f]/.test(href))
    fail('WEBDAV_HREF', 'Use the original resource href within this collection.');
  let url;
  try { url = new URL(href, root); } catch { fail('WEBDAV_HREF', 'The resource href is not a valid URL.'); }
  const base = new URL(root);
  if (url.origin !== base.origin || url.username || url.password || url.search || url.hash)
    fail('WEBDAV_ORIGIN', 'The resource must stay within the declared origin and collection.');
  url.pathname = cleanPath(url.pathname);
  if (!(url.pathname === base.pathname.slice(0, -1) || url.pathname.startsWith(base.pathname)))
    fail('WEBDAV_COLLECTION', 'The resource is outside the declared WebDAV collection.');
  return url.href;
}
export function relativeHref(root, href) {
  const selected = new URL(resourceUrl(root, href)), base = new URL(root);
  return selected.pathname === base.pathname.slice(0, -1) ? '' : selected.pathname.slice(base.pathname.length);
}
function envName(value, label) {
  if (typeof value !== 'string' || !ENV.test(value)) fail('WEBDAV_ENV_REFERENCE', 'Use an environment variable name for ' + label + '.');
  return value;
}
export function validateSource(input) {
  exact(input, ['schema', 'connection', 'limits'], 'the source');
  if (input.schema !== SOURCE_SCHEMA) fail('WEBDAV_SCHEMA', 'Use ' + SOURCE_SCHEMA + '.');
  const c = exact(input.connection, ['rootUrl', 'auth', 'allowLocalHttp', 'caFileEnv'], 'the connection');
  if (c.allowLocalHttp !== undefined && typeof c.allowLocalHttp !== 'boolean') fail('WEBDAV_LOCAL_HTTP', 'allowLocalHttp must be a boolean.');
  const auth = exact(c.auth ?? { type: 'none' }, ['type', 'usernameEnv', 'passwordEnv', 'tokenEnv'], 'authentication');
  let selected;
  if (auth.type === 'none') {
    exact(auth, ['type'], 'anonymous authentication'); selected = { type: 'none' };
  } else if (auth.type === 'basic') {
    exact(auth, ['type', 'usernameEnv', 'passwordEnv'], 'Basic authentication');
    selected = { type: 'basic', usernameEnv: envName(auth.usernameEnv, 'the username'), passwordEnv: envName(auth.passwordEnv, 'the password') };
  } else if (auth.type === 'bearer') {
    exact(auth, ['type', 'tokenEnv'], 'Bearer authentication');
    selected = { type: 'bearer', tokenEnv: envName(auth.tokenEnv, 'the access token') };
  } else fail('WEBDAV_AUTH_TYPE', 'Select anonymous, Basic, or Bearer authentication.');
  const limits = exact(input.limits ?? {}, ['maxListingBytes', 'maxEntries', 'maxFileBytes', 'timeoutMs', 'maxCaptureMs'], 'limits');
  return { schema: SOURCE_SCHEMA, connection: { rootUrl: rootUrl(c.rootUrl, c.allowLocalHttp === true),
    auth: selected, allowLocalHttp: c.allowLocalHttp === true,
    ...(c.caFileEnv !== undefined ? { caFileEnv: envName(c.caFileEnv, 'the CA file') } : {}) },
    limits: {
      maxListingBytes: integer(limits.maxListingBytes ?? 4194304, 1024, 16777216, 'listing bytes'),
      maxEntries: integer(limits.maxEntries ?? 10000, 1, 20000, 'listing entries'),
      maxFileBytes: integer(limits.maxFileBytes ?? 67108864, 1, 268435456, 'file bytes'),
      timeoutMs: integer(limits.timeoutMs ?? 30000, 1000, 120000, 'request idle timeout'),
      maxCaptureMs: integer(limits.maxCaptureMs ?? 600000, 1000, 3600000, 'capture duration'),
    } };
}
export function requiredEnvironment(config) {
  const c = validateSource(config).connection;
  return [...new Set(Object.entries(c.auth).filter(([name]) => name.endsWith('Env')).map(([, value]) => value)
    .concat(c.caFileEnv ? [c.caFileEnv] : []))];
}
export function validateSelection(config, value) {
  exact(value, ['id', 'href', 'etag', 'contentLength', 'lastModified', 'expectedSha256', 'restarts'], 'the file selection');
  if (!ID.test(value.id ?? '')) fail('WEBDAV_CAPTURE_ID', 'Use a stable original UUID for this capture intent.');
  const length = value.contentLength === null || value.contentLength === undefined ? null
    : integer(value.contentLength, 0, config.limits.maxFileBytes, 'the selected file size');
  if (value.expectedSha256 !== undefined && !HASH.test(value.expectedSha256))
    fail('WEBDAV_FILE_HASH', 'Use a complete lower-case SHA-256 of the expected original bytes.');
  if (value.restarts !== undefined && !ID.test(value.restarts)) fail('WEBDAV_CAPTURE_ID', 'Select the original interrupted capture.');
  return { id: value.id, href: resourceUrl(config.connection.rootUrl, value.href), etag: opaqueEtag(value.etag),
    contentLength: length, lastModified: value.lastModified == null ? null : text(value.lastModified, 256, 'Last-Modified', true),
    ...(value.expectedSha256 ? { expectedSha256: value.expectedSha256 } : {}),
    ...(value.restarts ? { restarts: value.restarts } : {}) };
}
export function validateProjection(input) {
  exact(input, ['format', 'recordsPointer', 'columns'], 'the projection');
  if (!['csv', 'json', 'ndjson'].includes(input.format)) fail('WEBDAV_FORMAT', 'Choose CSV, JSON, or NDJSON.');
  const recordsPointer = input.recordsPointer ?? '';
  pointerParts(recordsPointer);
  if (input.format !== 'json' && recordsPointer !== '') fail('WEBDAV_RECORDS_POINTER', 'A records pointer applies only to a JSON array.');
  if (!object(input.columns) || !Object.keys(input.columns).length || Object.keys(input.columns).length > 64)
    fail('WEBDAV_COLUMNS', 'Select 1–64 explicitly typed public columns.');
  const mapping = {};
  for (const [name, declaration] of Object.entries(input.columns)) {
    if (!NAME.test(name) || ['__proto__', 'prototype', 'constructor'].includes(name))
      fail('WEBDAV_COLUMN_NAME', 'Use simple unique public column names.');
    exact(declaration, ['pointer', 'type', 'nullable', 'missing'], 'column ' + name);
    pointerParts(declaration.pointer);
    if (!TYPE.has(declaration.type)) fail('WEBDAV_COLUMN_TYPE', 'Choose string, integer, number, or boolean for ' + name + '.');
    if (declaration.nullable !== undefined && typeof declaration.nullable !== 'boolean') fail('WEBDAV_COLUMN_NULLABLE', 'nullable must be a boolean.');
    if (declaration.missing !== undefined && !['error', 'null'].includes(declaration.missing)) fail('WEBDAV_COLUMN_MISSING', 'Choose error or null for a missing field.');
    if (declaration.missing === 'null' && declaration.nullable !== true) fail('WEBDAV_COLUMN_MISSING', 'A missing field can become null only for a nullable column.');
    mapping[name] = { pointer: declaration.pointer, type: declaration.type, nullable: declaration.nullable === true, missing: declaration.missing ?? 'error' };
  }
  return { format: input.format, recordsPointer, columns: Object.keys(mapping), mapping };
}
export function projectionDocument(value) {
  return { format: value.format, recordsPointer: value.recordsPointer, columns: clone(value.mapping) };
}
export async function readSourceFile(path) {
  if (!isAbsolute(path) || resolve(path) !== path || await realpath(path) !== path)
    fail('WEBDAV_SOURCE_PATH', 'Use a canonical absolute source file.');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > 1048576n || (before.mode & 0o077n) !== 0n)
      fail('WEBDAV_SOURCE_FILE', 'Use a private regular source file of at most 1 MiB.');
    const raw = await handle.readFile(), after = await handle.stat({ bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || BigInt(raw.length) !== before.size)
      fail('WEBDAV_SOURCE_CHANGED', 'The source declaration changed while it was being read.', 409);
    const declaration = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    return { path, raw, hash: sha256(raw), config: validateSource(declaration), declaration };
  } finally { await handle.close(); }
}
