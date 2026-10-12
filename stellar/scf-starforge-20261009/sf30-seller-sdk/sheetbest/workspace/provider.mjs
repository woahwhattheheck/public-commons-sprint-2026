// MIT. Host-declared Sheet Best connections; secrets remain in the host environment.
import { object, fault } from '../../postgres/publisher/files.mjs';
import { binding, only, integer, MAX_CAPTURE_BYTES } from '../declaration.mjs';
export function normalizeConnections(value = {}) {
  if (!object(value) || Object.keys(value).length > 32) throw fault('SHEETBEST_CONNECTIONS_INVALID');
  return Object.fromEntries(Object.entries(value).map(([alias, input]) => {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(alias) || ['constructor','prototype','__proto__'].includes(alias))
      throw fault('SHEETBEST_CONNECTION_ALIAS_INVALID');
    only(input, ['label','connectionId','tab','valueMode','apiKeyEnv','maxResponseBytes','timeoutMs'], 'SHEETBEST_HOST_CONNECTION_INVALID');
    const label = input.label ?? alias;
    if (typeof label !== 'string' || !label.trim() || label.length > 128 || /[\u0000-\u001f]/.test(label))
      throw fault('SHEETBEST_CONNECTION_LABEL_INVALID');
    if (input.apiKeyEnv !== undefined && !/^[A-Z_][A-Z0-9_]{0,127}$/.test(input.apiKeyEnv))
      throw fault('SHEETBEST_CREDENTIAL_REFERENCE_INVALID');
    return [alias, { label: label.trim(), ...binding(input),
      ...(input.apiKeyEnv === undefined ? {} : { apiKeyEnv: input.apiKeyEnv }),
      maxResponseBytes: integer(input.maxResponseBytes ?? MAX_CAPTURE_BYTES, 1024, MAX_CAPTURE_BYTES, 'SHEETBEST_RESPONSE_LIMIT_INVALID'),
      timeoutMs: integer(input.timeoutMs ?? 30000, 100, 180000, 'SHEETBEST_TIMEOUT_INVALID') }];
  }));
}
export function selectConnection(connections, alias) {
  if (typeof alias !== 'string' || !Object.hasOwn(connections, alias))
    throw fault('SHEETBEST_CONNECTION_NOT_DECLARED', 'Choose a read connection declared by this host.');
  const { label, connectionId, tab, valueMode, ...options } = connections[alias];
  return { schema: 'stellar-forge.sheetbest-source.v1', connectionId, tab, valueMode,
    connection: { kind: 'rest', ...options }, queries: {} };
}
export function connectionViews(connections, environment) {
  return Object.entries(connections).map(([alias, value]) => ({
    alias, label: value.label, connectionId: value.connectionId, tab: value.tab, valueMode: value.valueMode,
    state: !value.apiKeyEnv ? 'public' : typeof environment[value.apiKeyEnv] === 'string' && environment[value.apiKeyEnv].length
      ? 'configured' : 'missing',
  }));
}
