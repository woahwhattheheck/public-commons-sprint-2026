// MIT. An explicit private SFTP connection and reviewed file projections.
import { readFile, lstat } from 'node:fs/promises';
import { dirname, posix, resolve } from 'node:path';
import { createHash } from 'node:crypto';

export const SFTP_SOURCE_SCHEMA = 'stellar-forge.sftp-source.v1';
export class SftpError extends Error {
  constructor(code, message = code, details = undefined) {
    super(message); this.name = 'SftpError'; this.code = code;
    if (details !== undefined) this.details = details;
  }
}
export const fail = (code, message, details) => new SftpError(code, message, details);
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const hash = value => createHash('sha256').update(value).digest('hex');
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const ENV = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const TYPES = new Set(['string', 'integer', 'number', 'boolean']);
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
export function exact(value, allowed, code = 'SFTP_CONFIG_INVALID') {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw fail(code);
}
export function integer(value, low, high, code = 'SFTP_LIMIT_INVALID') {
  if (!Number.isSafeInteger(value) || value < low || value > high) throw fail(code);
  return value;
}
export function relativePath(value, allowRoot = false) {
  if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x1f\x7f\\]/.test(value) ||
      value.startsWith('/') || value.split('/').includes('..') || !allowRoot && !value)
    throw fail('SFTP_PATH_INVALID', 'Choose a file or folder within the configured remote root.');
  const normalized = posix.normalize(value || '.');
  if (normalized === '.' && !allowRoot) throw fail('SFTP_FILE_PATH_REQUIRED');
  return normalized === '.' ? '' : normalized.replace(/\/$/, '');
}
export function pointerParts(value) {
  if (typeof value !== 'string' || value.length > 2048 || value !== '' && !value.startsWith('/') || /~(?:[^01]|$)/.test(value))
    throw fail('SFTP_JSON_POINTER_INVALID', 'Use a JSON Pointer, with ~0 for tilde and ~1 for slash.');
  return value === '' ? [] : value.slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
}
export const escapePointer = value => '/' + value.replaceAll('~', '~0').replaceAll('/', '~1');
function name(value) {
  if (!NAME.test(value) || RESERVED.has(value)) throw fail('SFTP_NAME_INVALID');
  return value;
}
function fingerprint(value) {
  if (typeof value !== 'string' || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(value)) throw fail('SFTP_HOST_PIN_INVALID');
  const bytes = Buffer.from(value.slice(7), 'base64');
  if (bytes.length !== 32 || bytes.toString('base64').replace(/=+$/, '') !== value.slice(7)) throw fail('SFTP_HOST_PIN_INVALID');
  return value;
}
// Check mathematical integrality before floating-point conversion can round a
// fractional token into an integer. Integral exponent notation remains valid.
export function isIntegralDecimal(text) {
  const match = /^-?(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(text);
  if (!match) return false;
  const digits = match[1] + (match[2] ?? '');
  let end = digits.length;
  while (end && digits[end - 1] === '0') end--;
  if (!end) return true;
  return Number(match[3] ?? 0) >= (match[2]?.length ?? 0) - (digits.length - end);
}
export function parameterValue(raw, spec, label) {
  let value;
  if (spec.type === 'string' && typeof raw === 'string' && raw.length <= 65536) value = raw;
  else if (spec.type === 'boolean' && [true, false, 'true', 'false'].includes(raw)) value = raw === true || raw === 'true';
  else if (['integer', 'number'].includes(spec.type) && (typeof raw === 'number' || typeof raw === 'string' && /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(raw))) {
    value = Number(raw);
    if (!Number.isFinite(value) || spec.type === 'integer' && (!Number.isSafeInteger(value) || typeof raw === 'string' && !isIntegralDecimal(raw))) throw fail('SFTP_PARAMETER_INVALID', 'Review parameter ' + label + '. Use Text for large identifiers.');
  } else throw fail('SFTP_PARAMETER_INVALID', 'Review the type of parameter ' + label + '.');
  return value;
}
export function bindSftpParameters(query, input = {}) {
  if (!object(input) || Object.keys(input).some(key => !Object.hasOwn(query.parameters, key))) throw fail('SFTP_PARAMETERS_INVALID');
  const values = Object.create(null);
  for (const [key, spec] of Object.entries(query.parameters)) {
    const raw = Object.hasOwn(input, key) ? input[key] : spec.default;
    if (raw === undefined) { if (spec.required) throw fail('SFTP_PARAMETER_REQUIRED', 'Enter parameter ' + key + '.'); continue; }
    const value = parameterValue(raw, spec, key);
    if (spec.enum && !spec.enum.some(item => parameterValue(item, spec, key) === value)) throw fail('SFTP_PARAMETER_ENUM', 'Choose a declared value for ' + key + '.');
    values[key] = value;
  }
  return values;
}
export function validateSftpSource(input) {
  exact(input, ['schema', 'connection', 'root', 'limits', 'queries']);
  if (input.schema !== SFTP_SOURCE_SCHEMA) throw fail('SFTP_SOURCE_SCHEMA_INVALID');
  const c = input.connection;
  exact(c, ['host', 'port', 'username', 'hostKeyFingerprints', 'auth']);
  if (typeof c.host !== 'string' || !c.host || c.host.length > 253 || /[\s\x00-\x1f\x7f/@?#]/.test(c.host) ||
      typeof c.username !== 'string' || !c.username || c.username.length > 128 || /[\x00-\x1f\x7f]/.test(c.username)) throw fail('SFTP_CONNECTION_INVALID');
  const port = integer(c.port ?? 22, 1, 65535, 'SFTP_PORT_INVALID');
  if (!Array.isArray(c.hostKeyFingerprints) || !c.hostKeyFingerprints.length || c.hostKeyFingerprints.length > 8 ||
      new Set(c.hostKeyFingerprints).size !== c.hostKeyFingerprints.length) throw fail('SFTP_HOST_PIN_REQUIRED');
  const pins = c.hostKeyFingerprints.map(fingerprint);
  exact(c.auth, ['privateKeyEnv', 'privateKeyFileEnv', 'passwordEnv', 'passphraseEnv']);
  const methods = ['privateKeyEnv', 'privateKeyFileEnv', 'passwordEnv'].filter(key => c.auth[key] !== undefined);
  if (methods.length !== 1 || Object.values(c.auth).some(value => typeof value !== 'string' || !ENV.test(value)) ||
      c.auth.passwordEnv && c.auth.passphraseEnv) throw fail('SFTP_AUTH_REFERENCE_INVALID', 'Declare one authentication environment reference; key passphrases may use a separate reference.');
  if (typeof input.root !== 'string' || !input.root.startsWith('/') || input.root.length > 2048 ||
      /[\x00-\x1f\x7f\\]/.test(input.root) || input.root.split('/').includes('..')) throw fail('SFTP_ROOT_INVALID');
  const supplied = input.limits ?? {};
  exact(supplied, ['maxFileBytes', 'maxRowBytes', 'timeoutMs', 'maxDirectoryEntries']);
  const limits = {
    maxFileBytes: integer(supplied.maxFileBytes ?? 64 * 1024 * 1024, 1, 256 * 1024 * 1024),
    maxRowBytes: integer(supplied.maxRowBytes ?? 1024 * 1024, 128, 8 * 1024 * 1024),
    timeoutMs: integer(supplied.timeoutMs ?? 300000, 1000, 900000),
    maxDirectoryEntries: integer(supplied.maxDirectoryEntries ?? 10000, 1, 100000),
  };
  if (!object(input.queries) || Object.keys(input.queries).length > 128) throw fail('SFTP_QUERIES_INVALID');
  const queries = Object.create(null);
  for (const [key, raw] of Object.entries(input.queries)) {
    name(key); exact(raw, ['path', 'format', 'recordsPointer', 'expectedSha256', 'columns', 'parameters', 'where']);
    if (!['csv', 'json', 'ndjson'].includes(raw.format)) throw fail('SFTP_FORMAT_INVALID');
    const path = relativePath(raw.path), recordsPointer = raw.recordsPointer ?? '';
    pointerParts(recordsPointer);
    if (raw.format !== 'json' && recordsPointer !== '') throw fail('SFTP_RECORDS_POINTER_REQUIRES_JSON');
    if (raw.expectedSha256 !== undefined && !/^[a-f0-9]{64}$/.test(raw.expectedSha256)) throw fail('SFTP_EXPECTED_HASH_INVALID');
    if (!object(raw.columns) || !Object.keys(raw.columns).length || Object.keys(raw.columns).length > 64) throw fail('SFTP_COLUMNS_INVALID');
    const mapping = Object.create(null);
    for (const [column, spec] of Object.entries(raw.columns)) {
      name(column); exact(spec, ['pointer', 'type', 'nullable', 'missing']);
      if (!TYPES.has(spec.type) || spec.nullable !== undefined && typeof spec.nullable !== 'boolean' ||
          spec.missing !== undefined && !['error', 'null'].includes(spec.missing) || spec.missing === 'null' && spec.nullable !== true) throw fail('SFTP_COLUMN_INVALID');
      const pointer = spec.pointer ?? escapePointer(column); pointerParts(pointer);
      mapping[column] = { pointer, type: spec.type, nullable: spec.nullable ?? false, missing: spec.missing ?? 'error' };
    }
    const parameters = Object.create(null);
    if (raw.parameters !== undefined && !object(raw.parameters) || Object.keys(raw.parameters ?? {}).length > 32) throw fail('SFTP_PARAMETERS_INVALID');
    for (const [parameter, spec] of Object.entries(raw.parameters ?? {})) {
      name(parameter); exact(spec, ['type', 'required', 'default', 'enum']);
      if (!TYPES.has(spec.type) || spec.required !== undefined && typeof spec.required !== 'boolean' ||
          spec.enum !== undefined && (!Array.isArray(spec.enum) || !spec.enum.length || spec.enum.length > 100)) throw fail('SFTP_PARAMETER_DECLARATION_INVALID');
      const value = { ...spec, required: spec.required ?? true };
      if (Object.hasOwn(spec, 'default')) parameterValue(spec.default, value, parameter);
      for (const item of spec.enum ?? []) parameterValue(item, value, parameter);
      parameters[parameter] = value;
    }
    const where = raw.where ?? [];
    if (!Array.isArray(where) || where.length > 64) throw fail('SFTP_WHERE_INVALID');
    for (const condition of where) {
      exact(condition, ['column', 'op', 'parameter']);
      if (!Object.hasOwn(mapping, condition.column) || !['eq', 'ne', 'lt', 'lte', 'gt', 'gte'].includes(condition.op) ||
          !Object.hasOwn(parameters, condition.parameter) || mapping[condition.column].type !== parameters[condition.parameter].type ||
          mapping[condition.column].type === 'boolean' && !['eq', 'ne'].includes(condition.op)) throw fail('SFTP_WHERE_INVALID');
    }
    queries[key] = { path, format: raw.format, recordsPointer,
      ...(raw.expectedSha256 ? { expectedSha256: raw.expectedSha256 } : {}),
      columns: Object.keys(mapping), mapping, parameters, parameterOrder: Object.keys(parameters), where: structuredClone(where) };
  }
  return { schema: SFTP_SOURCE_SCHEMA, connection: { host: c.host, port, username: c.username, hostKeyFingerprints: pins, auth: { ...c.auth } },
    root: posix.normalize(input.root).replace(/\/$/, '') || '/', limits, queries };
}
export async function readSftpSourceFile(path) {
  const absolute = resolve(path), info = await lstat(absolute);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024 || process.platform !== 'win32' && info.mode & 0o077)
    throw fail('SFTP_PRIVATE_SOURCE_REQUIRED', 'Use a private regular source JSON file (0600).');
  const original = await readFile(absolute);
  let raw; try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(original)); } catch { throw fail('SFTP_SOURCE_JSON_INVALID'); }
  return { path: absolute, raw, config: validateSftpSource(raw), hash: hash(original), bytes: original.length, original };
}
export async function openSftpSourceFile(path, { env = process.env, captureDirectory } = {}) {
  const declaration = await readSftpSourceFile(path);
  const { createSftpSource } = await import('./source.mjs');
  return { ...declaration, source: createSftpSource(declaration.config, { env, validated: true, baseDirectory: dirname(declaration.path), captureDirectory }) };
}
