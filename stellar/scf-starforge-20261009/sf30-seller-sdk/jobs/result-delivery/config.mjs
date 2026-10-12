// MIT. Destinations are operator configuration; only their secret environment names are retained.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateDestination } from '../../../sf98-merchant-delivery/deliver.mjs';
import { DESTINATION_ID, deliveryError, plain } from './wire.mjs';
export const CONFIG_SCHEMA = 'stellar-forge.job-result-destinations.v1';
const fail = code => { throw deliveryError(code); };
function integer(value, fallback, min, max, code) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max) fail(code);
  return result;
}
function keys(value, allowed) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('JRD_CONFIGURATION_INVALID');
}
export function compileDeliveryConfig(raw) {
  keys(raw, ['schema', 'destinations', 'concurrency', 'pollIntervalMs', 'attemptLimit', 'timeoutMs']);
  if (raw.schema !== CONFIG_SCHEMA || !Array.isArray(raw.destinations) || raw.destinations.length < 1 || raw.destinations.length > 32) fail('JRD_DESTINATIONS_REQUIRED');
  const ids = new Set();
  const destinations = raw.destinations.map(value => {
    keys(value, ['id', 'url', 'allowedHost', 'secretEnv', 'functionIds', 'enabled', 'completedAfter']);
    if (!DESTINATION_ID.test(value.id ?? '') || ids.has(value.id)) fail('JRD_DESTINATION_ID_INVALID');
    ids.add(value.id);
    let url; try { url = validateDestination(value.url, value.allowedHost); } catch { fail('JRD_DESTINATION_URL_INVALID'); }
    if (typeof value.secretEnv !== 'string' || !/^[A-Z][A-Z0-9_]{1,127}$/.test(value.secretEnv)) fail('JRD_SECRET_ENV_INVALID');
    if (value.enabled !== undefined && typeof value.enabled !== 'boolean') fail('JRD_DESTINATION_ENABLED_INVALID');
    let functionIds = null;
    if (value.functionIds !== undefined && value.functionIds !== null) {
      if (!Array.isArray(value.functionIds) || !value.functionIds.length || value.functionIds.length > 128 ||
          value.functionIds.some(id => typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,55}$/.test(id)) ||
          new Set(value.functionIds).size !== value.functionIds.length) fail('JRD_DESTINATION_FUNCTIONS_INVALID');
      functionIds = [...value.functionIds].sort();
    }
    if (value.completedAfter !== undefined && value.completedAfter !== null && (typeof value.completedAfter !== 'string' ||
        !Number.isFinite(Date.parse(value.completedAfter)) || new Date(value.completedAfter).toISOString() !== value.completedAfter)) fail('JRD_DESTINATION_SINCE_INVALID');
    return Object.freeze({ id: value.id, url: url.href, allowedHost: url.hostname, secretEnv: value.secretEnv,
      functionIds: functionIds && Object.freeze(functionIds), enabled: value.enabled !== false, completedAfter: value.completedAfter ?? null });
  });
  return Object.freeze({ schema: CONFIG_SCHEMA, destinations: Object.freeze(destinations),
    concurrency: integer(raw.concurrency, 2, 1, 16, 'JRD_CONCURRENCY_INVALID'),
    pollIntervalMs: integer(raw.pollIntervalMs, 30000, 250, 300000, 'JRD_POLL_INTERVAL_INVALID'),
    attemptLimit: integer(raw.attemptLimit, 8, 1, 100, 'JRD_ATTEMPT_LIMIT_INVALID'),
    timeoutMs: integer(raw.timeoutMs, 15000, 100, 60000, 'JRD_TIMEOUT_INVALID') });
}
export async function readDeliveryConfig(path) {
  const handle = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 262144) fail('JRD_CONFIGURATION_FILE_INVALID');
    const bytes = await handle.readFile();
    if (bytes.length > 262144) fail('JRD_CONFIGURATION_FILE_INVALID');
    let raw; try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('JRD_CONFIGURATION_JSON_INVALID'); }
    return compileDeliveryConfig(raw);
  } finally { await handle.close(); }
}
export function destinationMatches(destination, manifest) {
  return destination.enabled && destination.id === manifest.destination.id && destination.url === manifest.destination.url &&
    (!destination.functionIds || destination.functionIds.includes(manifest.job.functionId)) &&
    (!destination.completedAfter || manifest.job.completedAt >= destination.completedAfter);
}
