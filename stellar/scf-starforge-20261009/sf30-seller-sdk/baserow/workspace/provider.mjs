// MIT. Host-selected Baserow references over the maintained native reader.
import { fault, object } from '../../postgres/publisher/files.mjs';
import { binding, restOptions, only } from '../declaration.mjs';

const KEYS = ['label', 'server', 'kind', 'tokenEnv', 'publicTokenEnv', 'allowHttp', 'pageSize',
  'maxPageBytes', 'maxCaptureBytes', 'maxPages', 'maxRows', 'timeoutMs', 'requestIntervalMs'];
export function normalizeConnections(value = {}) {
  if (!object(value) || Object.keys(value).length > 32) throw fault('BASEROW_CONNECTIONS_INVALID');
  return Object.fromEntries(Object.entries(value).map(([alias, input]) => {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(alias) || ['constructor', 'prototype', '__proto__'].includes(alias))
      throw fault('BASEROW_CONNECTION_ALIAS_INVALID');
    only(input, KEYS, 'BASEROW_HOST_CONNECTION_INVALID');
    const label = input.label ?? alias;
    if (typeof label !== 'string' || !label.trim() || label.length > 128 || /[\u0000-\u001f]/.test(label))
      throw fault('BASEROW_CONNECTION_LABEL_INVALID');
    const { label: ignored, server, kind, ...options } = input;
    const checked = { schema: 'stellar-forge.baserow-source.v1', server, kind,
      ...(kind === 'public-grid' ? { slug: 'connection' } : { tableId: 1 }),
      orderBy: [], connection: { kind: 'rest', ...options } };
    const selected = binding(checked); restOptions(checked);
    return [alias, { label: label.trim(), server: selected.server, kind: selected.kind, ...options }];
  }));
}
export function selectConnection(connections, alias) {
  if (typeof alias !== 'string' || !Object.hasOwn(connections, alias))
    throw fault('BASEROW_CONNECTION_NOT_DECLARED', 'Choose a read connection declared by this host.');
  const { label, server, kind, ...options } = connections[alias];
  return { server, kind, connection: { kind: 'rest', ...options } };
}
export function connectionViews(connections, environment) {
  return Object.entries(connections).map(([alias, input]) => {
    const variable = input.kind === 'table' ? input.tokenEnv : input.publicTokenEnv;
    return { alias, label: input.label, server: input.server, kind: input.kind,
      state: !variable ? 'public' : typeof environment[variable] === 'string' && environment[variable].length ? 'configured' : 'missing' };
  });
}
export function discoveryConfig(connections, input) {
  only(input, ['connectionAlias', 'slug', 'tableId', 'viewId', 'filters', 'search'], 'BASEROW_DISCOVERY_INPUT_INVALID');
  const selected = selectConnection(connections, input.connectionAlias);
  const config = { schema: 'stellar-forge.baserow-source.v1', ...selected,
    slug: input.slug ?? null, tableId: input.tableId ?? null, viewId: input.viewId ?? null,
    filters: input.filters ?? null, search: input.search ?? null, orderBy: [], queries: {} };
  binding(config); restOptions(config);
  return config;
}
