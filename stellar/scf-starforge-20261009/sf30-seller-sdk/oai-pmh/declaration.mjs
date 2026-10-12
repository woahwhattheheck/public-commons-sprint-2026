// MIT. A retained, reviewed OAI-PMH edition; runtime paths never come from HTTP input.
import { posix } from 'node:path';
import { object, fault } from '../postgres/publisher/files.mjs';

export const OAI_SOURCE_SCHEMA = 'stellar-forge.oai-pmh-source.v1';
export const OAI_CAPTURE_SCHEMA = 'stellar-forge.oai-pmh-capture.v1';
export const OAI_QUERY = 'records';
export const OAI_LIMITS = Object.freeze({
  sourceBytes: 262144, manifestBytes: 4 * 1024 * 1024,
  memberBytes: 512 * 1024 * 1024, captureBytes: 2 * 1024 * 1024 * 1024,
  members: 20000, lineageBytes: 16 * 1024 * 1024,
});
export const HASH = /^[a-f0-9]{64}$/;

export function only(value, names, code = 'OAI_SOURCE_FIELDS') {
  if (!object(value) || Object.keys(value).some(key => !names.includes(key)))
    throw fault(code, 'The OAI-PMH declaration contains unsupported fields.');
}
export function member(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 ||
      /[\x00-\x1f\x7f\\]/.test(value) || posix.isAbsolute(value) ||
      posix.normalize(value) !== value || value.split('/').some(part => !part || part === '.' || part === '..'))
    throw fault('OAI_CAPTURE_MEMBER', 'Use a canonical relative file within the retained capture.');
  return value;
}
export function validateOaiSource(value) {
  only(value, ['schema', 'connection', 'queries']);
  if (value.schema !== OAI_SOURCE_SCHEMA) throw fault('OAI_SOURCE_SCHEMA');
  only(value.connection, ['kind', 'file', 'sha256']);
  if (value.connection.kind !== 'capture' || value.connection.file !== 'capture/capture.json' ||
      !HASH.test(value.connection.sha256 ?? '')) throw fault('OAI_CAPTURE_BINDING');
  only(value.queries, [OAI_QUERY]);
  if (!Object.hasOwn(value.queries, OAI_QUERY)) throw fault('OAI_RECORDS_QUERY_REQUIRED');
  only(value.queries.records, []);
  return structuredClone(value);
}
export function bindOaiInput(value = {}, description) {
  only(value, ['sort'], 'OAI_QUERY_INPUT');
  if (value.sort !== undefined) {
    if (typeof value.sort !== 'string' || !value.sort) throw fault('OAI_QUERY_ORDER');
    const name = value.sort.startsWith('-') ? value.sort.slice(1) : value.sort;
    if (!description.columns.some(column => column.name === name && column.sortable === true))
      throw fault('OAI_QUERY_ORDER', 'Choose one sort column enabled by the original dataset, with an optional - prefix.');
  }
  return structuredClone(value);
}
