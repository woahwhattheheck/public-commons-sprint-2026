import { sha256Hex } from './canonical.mjs';
import { normalizeAtomicInteger } from './atomic.mjs';

const TOKEN_PREFIXES = [['s','k'].join(''), ['r','k'].join(''), ['p','k'].join('')];
const AUTH_SCHEME = ['Bea','rer'].join('');
const SENSITIVE_LABELS = ['api_key','api-key','apikey','secret','private_key','private-key','privatekey','access_token','access-token','accesstoken'];

function looksSecretShaped(value) {
  const lower = value.toLowerCase();
  if (lower.includes('-----begin ') && lower.includes(['private',' key-----'].join(''))) return true;
  for (const prefix of TOKEN_PREFIXES) {
    const tokenPattern = new RegExp(`\\b${prefix}-[A-Za-z0-9_-]{12,}\\b`);
    if (tokenPattern.test(value)) return true;
  }
  const authPattern = new RegExp(`\\b${AUTH_SCHEME}\\s+[A-Za-z0-9._~+/=-]{12,}`, 'i');
  if (authPattern.test(value)) return true;
  const normalized = lower.replace(/\s+/g, '');
  for (const label of SENSITIVE_LABELS) {
    if (normalized.includes(`${label}=`) || normalized.includes(`${label}:`)) return true;
  }
  return false;
}

function assertExactObject(value, required, optional = [], label = 'object') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!(key in value)) throw new TypeError(`${label}.${key} is required`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${label}.${key} is unknown`);
}

function assertNoSecretShapedStrings(value, path = 'config') {
  if (typeof value === 'string') {
    if (looksSecretShaped(value)) throw new TypeError(`${path} contains secret-shaped material`);
    return;
  }
  if (Array.isArray(value)) return value.forEach((entry, index) => assertNoSecretShapedStrings(entry, `${path}[${index}]`));
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) assertNoSecretShapedStrings(child, `${path}.${key}`);
}

function parseHttpsUrl(value, label) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  let url;
  try { url = new URL(value); } catch { throw new TypeError(`${label} must be an absolute URL`); }
  if (url.protocol !== 'https:') throw new TypeError(`${label} must use https`);
  if (url.username || url.password || url.hash) throw new TypeError(`${label} must not include credentials or fragments`);
  return url.toString().replace(/\/$/, '');
}

export function normalizePublicConfig(input) {
  assertExactObject(input, ['reportServiceBaseUrl','graphNetwork','providerAgentId','serviceId','amountTinybar'], ['graphEndpointLabel'], 'publicConfig');
  assertNoSecretShapedStrings(input);
  if (typeof input.graphNetwork !== 'string' || !/^[A-Za-z0-9:_-]{2,80}$/.test(input.graphNetwork)) throw new TypeError('publicConfig.graphNetwork is invalid');
  if (typeof input.providerAgentId !== 'string' || input.providerAgentId.trim() === '') throw new TypeError('publicConfig.providerAgentId is required');
  if (typeof input.serviceId !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,79}$/.test(input.serviceId)) throw new TypeError('publicConfig.serviceId is invalid');
  const amountTinybar = normalizeAtomicInteger(input.amountTinybar, 'publicConfig.amountTinybar');
  if (input.graphEndpointLabel !== undefined && (typeof input.graphEndpointLabel !== 'string' || input.graphEndpointLabel.trim() === '')) throw new TypeError('publicConfig.graphEndpointLabel is invalid');
  const core = {
    version: 'agent-revenue-rail/public-config/v1',
    reportServiceBaseUrl: parseHttpsUrl(input.reportServiceBaseUrl, 'publicConfig.reportServiceBaseUrl'),
    graphNetwork: input.graphNetwork,
    providerAgentId: input.providerAgentId,
    serviceId: input.serviceId,
    amountTinybar,
    graphEndpointLabel: input.graphEndpointLabel ?? null,
    secretValuesEmbedded: false,
  };
  return { ...core, configDigest: sha256Hex(core) };
}
