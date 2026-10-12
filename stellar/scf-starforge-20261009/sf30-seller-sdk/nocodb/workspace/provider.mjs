// MIT. Host-selected NocoDB references; provider reads use the original reader.
import { fault, object } from '../../postgres/publisher/files.mjs';
import { binding, restOptions, only, identifier } from '../declaration.mjs';

const KEYS = ['label', 'server', 'tokenEnv', 'allowHttp', 'pageSize', 'maxPageBytes',
  'maxCaptureBytes', 'maxPages', 'maxRows', 'timeoutMs', 'requestIntervalMs'];
export function normalizeConnections(value = {}) {
  if (!object(value) || Object.keys(value).length > 32) throw fault('NOCODB_CONNECTIONS_INVALID');
  return Object.fromEntries(Object.entries(value).map(([alias, input]) => {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(alias) || ['constructor','prototype','__proto__'].includes(alias))
      throw fault('NOCODB_CONNECTION_ALIAS_INVALID');
    only(input, KEYS, 'NOCODB_HOST_CONNECTION_INVALID');
    const label = input.label ?? alias;
    if (typeof label !== 'string' || !label.trim() || label.length > 128 || /[\u0000-\u001f]/.test(label))
      throw fault('NOCODB_CONNECTION_LABEL_INVALID');
    const { label: ignored, server, ...options } = input;
    const checked = { apiVersion: 'v3', server, baseId: 'connection', tableId: 'connection',
      sourceOrder: [], connection: { kind: 'rest', ...options } };
    const selected = binding(checked, { allowUnordered: true });
    restOptions(checked, { allowUnordered: true });
    return [alias, { label: label.trim(), server: selected.server, ...options }];
  }));
}
export function selectConnection(connections, alias) {
  if (typeof alias !== 'string' || !Object.hasOwn(connections, alias))
    throw fault('NOCODB_CONNECTION_NOT_DECLARED', 'Choose a read connection declared by this host.');
  const { label, server, ...options } = connections[alias];
  return { server, connection: { kind: 'rest', ...options } };
}
export function connectionViews(connections, environment) {
  return Object.entries(connections).map(([alias, input]) => ({
    alias, label: input.label, server: input.server,
    state: typeof environment[input.tokenEnv] === 'string' && environment[input.tokenEnv].length ? 'configured' : 'missing',
  }));
}
export function discoveryConfig(connections, input) {
  only(input, ['connectionAlias','baseId','tableId','viewId','where'], 'NOCODB_DISCOVERY_INPUT_INVALID');
  const selected = selectConnection(connections, input.connectionAlias);
  const config = { schema: 'stellar-forge.nocodb-source.v1', ...selected, apiVersion: 'v3',
    baseId: identifier(input.baseId, 'BASE_ID'), tableId: identifier(input.tableId, 'TABLE_ID'),
    viewId: input.viewId || null, where: input.where || null, sourceOrder: [], queries: {} };
  binding(config, { allowUnordered: true }); restOptions(config, { allowUnordered: true });
  return config;
}

