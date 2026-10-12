// MIT. Explicit Opendatasoft field aliases and original dataset scalar contracts.
import { dirname, resolve } from 'node:path';
import { object, digest, readPrivate, fault } from '../postgres/publisher/files.mjs';
import { catalogOrigin, parseOpendatasoftJson } from './capture.mjs';

export const HASH = /^[a-f0-9]{64}$/;
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
export function only(value, keys, code = 'ODS_DECLARATION_INVALID') {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) throw fault(code);
  return value;
}
export function integer(value, min, max, code = 'ODS_INTEGER_INVALID') {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw fault(code);
  return value;
}
export function compileQueries(declared) {
  if (!object(declared) || !Object.keys(declared).length || Object.keys(declared).length > 64)
    throw fault('ODS_QUERIES_REQUIRED');
  return Object.fromEntries(Object.entries(declared).map(([name, query]) => {
    if (!NAME.test(name) || ['constructor', 'prototype', '__proto__'].includes(name)) throw fault('ODS_QUERY_NAME_INVALID');
    only(query, ['projection'], 'ODS_QUERY_DECLARATION_INVALID');
    if (!object(query.projection) || !Object.keys(query.projection).length || Object.keys(query.projection).length > 64)
      throw fault('ODS_PROJECTION_REQUIRED');
    const projection = Object.fromEntries(Object.entries(query.projection).map(([alias, spec]) => {
      if (!NAME.test(alias) || ['constructor', 'prototype', '__proto__'].includes(alias)) throw fault('ODS_COLUMN_ALIAS_INVALID');
      only(spec, ['field', 'type', 'nullable', 'encoding'], 'ODS_COLUMN_DECLARATION_INVALID');
      if (typeof spec.field !== 'string' || !spec.field.length || spec.field.length > 512 || /[\u0000-\u001f]/.test(spec.field))
        throw fault('ODS_SOURCE_FIELD_INVALID');
      const type = spec.type, encoding = spec.encoding ?? 'native', nullable = spec.nullable ?? false;
      if (!['string', 'integer', 'number', 'boolean'].includes(type) || typeof nullable !== 'boolean' ||
          !['native', 'text', 'json'].includes(encoding) || encoding !== 'native' && type !== 'string')
        throw fault('ODS_COLUMN_TYPE_INVALID');
      return [alias, { field: spec.field, type, nullable, encoding }];
    }));
    return [name, { sql: 'Opendatasoft retained edition projection ' + name, columns: Object.keys(projection), projection,
      parameters: {}, parameterOrder: [] }];
  }));
}
export async function readOpendatasoftSourceFile(filename) {
  const original = await readPrivate(filename, 262144), config = parseOpendatasoftJson(original);
  only(config, ['schema', 'catalogOrigin', 'datasetId', 'datasetUid', 'connection', 'queries'], 'ODS_SOURCE_INVALID');
  if (config.schema !== 'stellar-forge.opendatasoft-source.v1' ||
      typeof config.datasetId !== 'string' || !config.datasetId || typeof config.datasetUid !== 'string' || !config.datasetUid)
    throw fault('ODS_SOURCE_INVALID');
  catalogOrigin(config.catalogOrigin);
  only(config.connection, ['kind', 'file', 'sha256'], 'ODS_CAPTURE_CONNECTION_REQUIRED');
  if (config.connection.kind !== 'capture' || typeof config.connection.file !== 'string' ||
      !config.connection.file || !HASH.test(config.connection.sha256 ?? '')) throw fault('ODS_CAPTURE_CONNECTION_REQUIRED');
  return { config, original, hash: digest(original), queries: compileQueries(config.queries),
    captureFile: resolve(dirname(filename), config.connection.file) };
}


