// MIT. Exact client-side contracts for the original WebDAV merchant API.
import { createHash } from 'node:crypto';
import { webDavWorkspaceTools, UUID, SHA256, SOURCE_KINDS, PUBLISHER_KINDS } from './catalog/webdav-tools.mjs';

export const WEBDAV_RECEIVING_SCHEMA = 'stellar-forge.webdav-client-receiving.v1';
export const WEBDAV_RECEIVING_MANIFEST = 'webdav-receiving.json';
export const WEBDAV_MAX_FILE_BYTES = 553648128;
export const WEBDAV_MAX_TOTAL_BYTES = 8 * 1024 * 1024 * 1024;
export const WEBDAV_MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
export const WEBDAV_MAX_RESULT_BYTES = 32 * 1024 * 1024;
export const WEBDAV_OPERATION_SCHEMA = 'stellar-forge.webdav-client-operation.v1';
export const WEBDAV_TOOL_CONTRACTS = Object.freeze(Object.fromEntries(webDavWorkspaceTools(
  (name, description, properties, required, annotations = {}) => [name, Object.freeze({
    name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, annotations
  })]
)));
export const WEBDAV_MUTATION_TOOLS = Object.freeze(Object.keys(WEBDAV_TOOL_CONTRACTS)
  .filter(name => WEBDAV_TOOL_CONTRACTS[name].inputSchema.required.includes('operationId')
    && WEBDAV_TOOL_CONTRACTS[name].inputSchema.required.includes('expectedRevision')));
export const webDavError = (code, message) => Object.assign(new Error(message), { code });
export const webDavHash = bytes => createHash('sha256').update(bytes).digest('hex');
export const webDavPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const webDavJsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export function webDavCanonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(webDavCanonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + webDavCanonical(value[key])).join(',') + '}';
}
export function webDavJson(value, maximum = WEBDAV_MAX_RESULT_BYTES) {
  let bytes;
  try { bytes = Buffer.from(JSON.stringify(value)); }
  catch { throw webDavError('WEBDAV_CLIENT_JSON', 'Supply a complete JSON value; keep exact amounts and identifiers as strings.'); }
  if (bytes.length > maximum) throw webDavError('WEBDAV_CLIENT_JSON_LIMIT', 'The selected original JSON exceeds this client operation limit.');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
export function webDavUuid(value, label = 'Original UUID') {
  if (typeof value !== 'string' || !UUID.test(value)) throw webDavError('WEBDAV_CLIENT_ID', label + ' must be the original lowercase UUID.');
  return value;
}
export function webDavSha(value) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw webDavError('WEBDAV_CLIENT_SHA256', 'Use the complete lowercase SHA256 of the selected original bytes.');
  return value;
}
export function webDavCount(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw webDavError('WEBDAV_CLIENT_COUNT', label + ' must be a nonnegative safe integer within its original limit.');
  return value;
}
function validate(value, schema, path) {
  const bad = () => { throw webDavError('WEBDAV_CLIENT_ARGUMENT', 'Invalid original WebDAV argument: ' + path + '.'); };
  if (schema.enum && !schema.enum.includes(value)) bad();
  if (schema.type === 'string') {
    if (typeof value !== 'string' || schema.minLength !== undefined && value.length < schema.minLength
        || schema.maxLength !== undefined && value.length > schema.maxLength
        || schema.pattern && !new RegExp(schema.pattern).test(value)) bad();
  } else if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || schema.minimum !== undefined && value < schema.minimum
        || schema.maximum !== undefined && value > schema.maximum) bad();
  } else if (schema.type === 'object') {
    if (!webDavPlain(value)) bad();
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) bad();
    for (const key of Object.keys(value)) {
      if (schema.properties?.[key]) validate(value[key], schema.properties[key], path + '.' + key);
      else if (schema.additionalProperties === false) bad();
    }
  }
}
export function validateWebDavRequest(name, args) {
  const contract = WEBDAV_TOOL_CONTRACTS[name];
  if (!contract) throw webDavError('WEBDAV_CLIENT_TOOL', 'Choose an original merchant_webdav_* tool from this client.');
  const selected = webDavJson(args, 1024 * 1024);
  validate(selected, contract.inputSchema, name);
  return selected;
}
export function webDavRelativeFile(name) {
  if (typeof name !== 'string' || !name || name.length > 256 || name.startsWith('/')
      || /[\\:\u0000-\u001f\u007f]/.test(name) || name.split('/').length > 32
      || name.split('/').some(part => !part || ['.', '..', '__proto__', 'prototype', 'constructor'].includes(part))
      || name === 'download-state' || name.startsWith('download-state/') || name === WEBDAV_RECEIVING_MANIFEST)
    throw webDavError('WEBDAV_CLIENT_FILE_NAME', 'Use a unique canonical relative receiving filename outside download-state.');
  return name;
}
export function validateWebDavFileSelector(value) {
  if (!webDavPlain(value) || Object.keys(value).some(key => !['kind','id','filename','sourceId','productId','publisherKind'].includes(key)))
    throw webDavError('WEBDAV_CLIENT_FILE_SELECTION', 'Select one original WebDAV file by its declared fields.');
  validateWebDavRequest('merchant_webdav_file', { workspace: 'selected', ...value });
  if (SOURCE_KINDS.includes(value.kind)) webDavUuid(value.id);
  if (value.kind === 'listing') {
    webDavUuid(value.sourceId);
    if (!['xml','json'].includes(value.filename)) throw webDavError('WEBDAV_CLIENT_FILE_SELECTION', 'Choose the retained listing XML or JSON.');
  }
  if (value.kind === 'publisher') {
    webDavUuid(value.productId);
    if (!PUBLISHER_KINDS.includes(value.publisherKind)) throw webDavError('WEBDAV_CLIENT_FILE_SELECTION', 'Select the original publisher file kind.');
  }
  return webDavJson(value);
}
export function validateWebDavFileMetadata(file) {
  if (!webDavPlain(file) || typeof file.name !== 'string' || !file.name || file.name.length > 1024)
    throw webDavError('WEBDAV_CLIENT_FILE_METADATA', 'The original file response must identify its complete filename, byte count and SHA256.');
  webDavCount(file.bytes, 'Original file bytes', WEBDAV_MAX_FILE_BYTES); webDavSha(file.sha256);
  return file;
}
export function webDavChunk(result, expected, offset, limit, readId) {
  validateWebDavFileMetadata(result?.file);
  const size = Math.min(limit, expected.bytes - offset);
  if (result.file.name !== expected.name || result.file.bytes !== expected.bytes || result.file.sha256 !== expected.sha256
      || !UUID.test(result.readId ?? '') || readId && result.readId !== readId || result.offset !== offset
      || result.bytesRead !== size || result.nextOffset !== (offset + size < expected.bytes ? offset + size : null)
      || result.encoding !== 'base64' || typeof result.data !== 'string')
    throw webDavError('WEBDAV_CLIENT_FILE_CHANGED', 'The original file chunk differs from its selected identity and byte position.');
  const bytes = Buffer.from(result.data, 'base64');
  if (bytes.length !== size || bytes.toString('base64') !== result.data)
    throw webDavError('WEBDAV_CLIENT_FILE_BYTES', 'The original file chunk has an invalid byte encoding.');
  return bytes;
}
export function webDavReceivingId(value) {
  const { exportId, ...body } = value;
  return webDavHash(Buffer.from(webDavCanonical(body)));
}
export function parseWebDavReceivingManifest(bytes, expectedId) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length > WEBDAV_MAX_MANIFEST_BYTES) throw webDavError('WEBDAV_RECEIVING_MANIFEST_LIMIT', 'The complete receiving manifest exceeds its native limit.');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw webDavError('WEBDAV_RECEIVING_MANIFEST_INVALID', 'Read the complete original receiving JSON.'); }
  if (!webDavPlain(value) || value.schema !== WEBDAV_RECEIVING_SCHEMA || typeof value.endpoint !== 'string' || !value.endpoint
      || value.endpoint.length > 4096 || /[\0\r\n]/.test(value.endpoint)
      || typeof value.workspace !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.workspace)
      || !webDavPlain(value.source) || !['export','files'].includes(value.source.mode)
      || !Array.isArray(value.files) || value.files.length < 1 || value.files.length > 8001)
    throw webDavError('WEBDAV_RECEIVING_MANIFEST_INVALID', 'Select the complete original WebDAV receiving manifest.');
  webDavUuid(value.workspaceId); webDavSha(value.exportId);
  if (value.exportId !== webDavReceivingId(value) || expectedId !== undefined && value.exportId !== expectedId)
    throw webDavError('WEBDAV_RECEIVING_ID_CHANGED', 'The selected source and file identities differ from this receiving ID.');
  const names = new Set(); let total = 0;
  for (const file of value.files) {
    webDavRelativeFile(file.name);
    if (names.has(file.name)) throw webDavError('WEBDAV_RECEIVING_FILE_DUPLICATE', 'Every original receiving path must be unique.');
    names.add(file.name); validateWebDavFileMetadata({ ...file, name: file.remoteName });
    validateWebDavFileSelector(file.selector); total += file.bytes;
  }
  for (const name of names) {
    const parts = name.split('/'); let parent = '';
    for (const part of parts.slice(0, -1)) {
      parent = parent ? parent + '/' + part : part;
      if (names.has(parent)) throw webDavError('WEBDAV_RECEIVING_FILE_CONFLICT', 'An original receiving file cannot also be a directory.');
    }
  }
  webDavCount(total, 'Complete receiving bytes', WEBDAV_MAX_TOTAL_BYTES);
  if (value.source.mode === 'export') {
    webDavUuid(value.source.id); webDavSha(value.source.manifestSha256);
    webDavUuid(value.source.editionId); webDavUuid(value.source.merchantId);
    if (typeof value.source.snapshot !== 'string' || !value.source.snapshot || value.source.snapshot.length > 256
        || /[\0\r\n]/.test(value.source.snapshot))
      throw webDavError('WEBDAV_RECEIVING_EXPORT_INVALID', 'Keep the original dataset snapshot with this complete merchant export.');
    for (const required of ['manifest.json','dataset.csv','dataset.json','source.json','seller.json'])
      if (!names.has(required)) throw webDavError('WEBDAV_RECEIVING_EXPORT_INCOMPLETE', 'The full original merchant export requires all entrypoints and its manifest.');
    const original = value.files.find(file => file.name === 'manifest.json');
    if (original.sha256 !== value.source.manifestSha256
        || value.files.some(file => file.selector.kind !== 'export' || file.selector.id !== value.source.id
          || file.selector.filename !== file.name || file.remoteName !== file.name))
      throw webDavError('WEBDAV_RECEIVING_EXPORT_CHANGED', 'The receiving export must retain the original manifest and exact member selectors.');
  }
  return value;
}
export function createWebDavReceivingManifest(body) {
  const value = { schema: WEBDAV_RECEIVING_SCHEMA, ...webDavJson(body) };
  value.exportId = webDavReceivingId(value);
  const bytes = webDavJsonBytes(value);
  parseWebDavReceivingManifest(bytes, value.exportId);
  return { manifest: value, bytes, sha256: webDavHash(bytes) };
}
