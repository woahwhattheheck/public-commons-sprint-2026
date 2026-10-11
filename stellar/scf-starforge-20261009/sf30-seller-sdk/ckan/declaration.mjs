// MIT. Explicit CKAN field aliases and original dataset scalar contracts.
import { dirname, resolve } from 'node:path';
import { object, digest, readPrivate, fault } from '../postgres/publisher/files.mjs';
import { catalogOrigin, parseCkanJson } from './capture.mjs';

export const HASH = /^[a-f0-9]{64}$/;
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
export function only(value, keys, code = 'CKAN_DECLARATION_INVALID') {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) throw fault(code);
  return value;
}
export function integer(value, min, max, code = 'CKAN_INTEGER_INVALID') {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw fault(code);
  return value;
}
export function compileQueries(declared) {
  if (!object(declared) || !Object.keys(declared).length || Object.keys(declared).length > 64)
    throw fault('CKAN_QUERIES_REQUIRED');
  return Object.fromEntries(Object.entries(declared).map(([name, query]) => {
    if (!NAME.test(name) || ['constructor', 'prototype', '__proto__'].includes(name)) throw fault('CKAN_QUERY_NAME_INVALID');
    only(query, ['projection'], 'CKAN_QUERY_DECLARATION_INVALID');
    if (!object(query.projection) || !Object.keys(query.projection).length || Object.keys(query.projection).length > 64)
      throw fault('CKAN_PROJECTION_REQUIRED');
    const projection = Object.fromEntries(Object.entries(query.projection).map(([alias, spec]) => {
      if (!NAME.test(alias) || ['constructor', 'prototype', '__proto__'].includes(alias)) throw fault('CKAN_COLUMN_ALIAS_INVALID');
      only(spec, ['field', 'type', 'nullable', 'encoding'], 'CKAN_COLUMN_DECLARATION_INVALID');
      if (typeof spec.field !== 'string' || !spec.field.length || spec.field.length > 512 || /[\u0000-\u001f]/.test(spec.field))
        throw fault('CKAN_SOURCE_FIELD_INVALID');
      const type = spec.type, encoding = spec.encoding ?? 'native', nullable = spec.nullable ?? false;
      if (!['string', 'integer', 'number', 'boolean'].includes(type) || typeof nullable !== 'boolean' ||
          !['native', 'text', 'json'].includes(encoding) || encoding !== 'native' && type !== 'string')
        throw fault('CKAN_COLUMN_TYPE_INVALID');
      return [alias, { field: spec.field, type, nullable, encoding }];
    }));
    return [name, { sql: 'CKAN retained edition projection ' + name, columns: Object.keys(projection), projection,
      parameters: {}, parameterOrder: [] }];
  }));
}
export async function readCkanSourceFile(filename) {
  const original = await readPrivate(filename, 262144), config = parseCkanJson(original);
  only(config, ['schema', 'catalogOrigin', 'packageId', 'resourceId', 'connection', 'queries'], 'CKAN_SOURCE_INVALID');
  if (config.schema !== 'stellar-forge.ckan-source.v1' ||
      typeof config.packageId !== 'string' || !config.packageId || typeof config.resourceId !== 'string' || !config.resourceId)
    throw fault('CKAN_SOURCE_INVALID');
  catalogOrigin(config.catalogOrigin);
  only(config.connection, ['kind', 'file', 'sha256'], 'CKAN_CAPTURE_CONNECTION_REQUIRED');
  if (config.connection.kind !== 'capture' || typeof config.connection.file !== 'string' ||
      !config.connection.file || !HASH.test(config.connection.sha256 ?? '')) throw fault('CKAN_CAPTURE_CONNECTION_REQUIRED');
  return { config, original, hash: digest(original), queries: compileQueries(config.queries),
    captureFile: resolve(dirname(filename), config.connection.file) };
}

