// MIT. Explicit Sheet Best connection, tab and public scalar projections.
import { dirname, resolve } from 'node:path';
import { object, readPrivate, digest, fault } from '../postgres/publisher/files.mjs';

export const MAX_CAPTURE_BYTES = 67108864;
export const HASH = /^[a-f0-9]{64}$/;
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const RESERVED = new Set(['constructor', 'prototype', '__proto__']);
export function only(value, keys, code) {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) throw fault(code);
}
export function integer(value, low, high, code) {
  if (!Number.isSafeInteger(value) || value < low || value > high) throw fault(code);
  return value;
}
export function binding(value) {
  if (typeof value.connectionId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value.connectionId))
    throw fault('SHEETBEST_CONNECTION_ID_INVALID', 'Use the connection UUID from its existing Sheet Best API URL.');
  const tab = value.tab ?? null, valueMode = value.valueMode ?? 'strings';
  if (tab !== null && (typeof tab !== 'string' || !tab.length || tab.length > 100 || /[\u0000-\u001f]/.test(tab)))
    throw fault('SHEETBEST_TAB_INVALID');
  if (!['strings', 'raw'].includes(valueMode)) throw fault('SHEETBEST_VALUE_MODE_INVALID');
  return { connectionId: value.connectionId, tab, valueMode };
}
export function compileQueries(value) {
  if (!object(value) || !Object.keys(value).length || Object.keys(value).length > 32) throw fault('SHEETBEST_QUERIES_REQUIRED');
  return Object.fromEntries(Object.entries(value).map(([name, query]) => {
    if (!NAME.test(name) || RESERVED.has(name)) throw fault('SHEETBEST_QUERY_NAME_INVALID');
    only(query, ['columns'], 'SHEETBEST_QUERY_INVALID');
    if (!object(query.columns) || !Object.keys(query.columns).length || Object.keys(query.columns).length > 64)
      throw fault('SHEETBEST_PUBLIC_COLUMNS_REQUIRED');
    const selected = new Set();
    const projection = Object.fromEntries(Object.entries(query.columns).map(([alias, spec]) => {
      if (!NAME.test(alias) || RESERVED.has(alias)) throw fault('SHEETBEST_COLUMN_NAME_INVALID');
      only(spec, ['source', 'type', 'nullable', 'empty'], 'SHEETBEST_COLUMN_INVALID');
      if (typeof spec.source !== 'string' || !spec.source.length || spec.source.length > 512 ||
          /[\u0000-\u001f]/.test(spec.source) || RESERVED.has(spec.source) || selected.has(spec.source) ||
          !['string', 'integer', 'number', 'boolean'].includes(spec.type) ||
          spec.nullable !== undefined && typeof spec.nullable !== 'boolean' ||
          spec.empty !== undefined && !['preserve', 'null'].includes(spec.empty))
        throw fault('SHEETBEST_COLUMN_INVALID');
      selected.add(spec.source);
      const normalized = { source: spec.source, type: spec.type, nullable: spec.nullable ?? false, empty: spec.empty ?? 'preserve' };
      if (normalized.empty === 'null' && !normalized.nullable) throw fault('SHEETBEST_EMPTY_NULL_REQUIRES_NULLABLE');
      return [alias, normalized];
    }));
    return [name, { columns: Object.keys(projection), projection, parameters: {}, parameterOrder: [],
      sql: 'Sheet Best: one complete records response; explicit source keys and scalar types; no source writes.' }];
  }));
}
export async function readSheetBestSourceFile(filename) {
  const original = await readPrivate(filename);
  let config;
  try { config = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(original)); }
  catch { throw fault('SHEETBEST_SOURCE_JSON_INVALID'); }
  only(config, ['schema', 'connectionId', 'tab', 'valueMode', 'connection', 'queries'], 'SHEETBEST_SOURCE_CONFIG_INVALID');
  if (config.schema !== 'stellar-forge.sheetbest-source.v1') throw fault('SHEETBEST_SOURCE_CONFIG_INVALID');
  const selectedBinding = binding(config), connection = config.connection;
  if (connection?.kind === 'capture') {
    only(connection, ['kind', 'file', 'sha256'], 'SHEETBEST_CAPTURE_CONNECTION_INVALID');
    if (typeof connection.file !== 'string' || !connection.file || connection.file.includes('\0') || !HASH.test(connection.sha256 ?? ''))
      throw fault('SHEETBEST_CAPTURE_CONNECTION_INVALID');
  } else if (connection?.kind === 'rest') {
    only(connection, ['kind', 'apiKeyEnv', 'maxResponseBytes', 'timeoutMs'], 'SHEETBEST_REST_CONNECTION_INVALID');
    if (connection.apiKeyEnv !== undefined && (typeof connection.apiKeyEnv !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(connection.apiKeyEnv)))
      throw fault('SHEETBEST_API_KEY_REFERENCE_INVALID');
    integer(connection.maxResponseBytes ?? MAX_CAPTURE_BYTES, 1024, MAX_CAPTURE_BYTES, 'SHEETBEST_RESPONSE_LIMIT_INVALID');
    integer(connection.timeoutMs ?? 30000, 100, 180000, 'SHEETBEST_TIMEOUT_INVALID');
  } else throw fault('SHEETBEST_CONNECTION_KIND_INVALID');
  return { config, binding: selectedBinding, original, hash: digest(original), queries: compileQueries(config.queries),
    captureFile: connection.kind === 'capture' ? resolve(dirname(filename), connection.file) : null };
}
