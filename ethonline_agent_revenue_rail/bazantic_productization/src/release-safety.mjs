const PLACEHOLDER_PATTERNS = [/replace[-_ ]?me/i, /example\.invalid/i, /demo[-_ ]?user/i, /live[-_ ]?testnet[-_ ]?hash/i, /placeholder/i];
const TOKEN_PREFIXES = [['s', 'k'].join(''), ['r', 'k'].join('')];
const AUTH_SCHEME = ['Bea', 'rer'].join('');
const SENSITIVE_LABELS = ['api_key', 'api-key', 'apikey', 'secret', 'private_key', 'private-key', 'privatekey', 'access_token', 'access-token', 'accesstoken'];

function looksSecretShaped(value) {
  const lower = value.toLowerCase();
  if (lower.includes('-----begin ') && lower.includes(['private', ' key-----'].join(''))) return true;
  for (const prefix of TOKEN_PREFIXES) if (new RegExp(`\\b${prefix}-[A-Za-z0-9_-]{12,}\\b`).test(value)) return true;
  if (new RegExp(`\\b${AUTH_SCHEME}\\s+[A-Za-z0-9._~+/=-]{12,}`, 'i').test(value)) return true;
  const normalized = lower.replace(/\s+/g, '');
  return SENSITIVE_LABELS.some((label) => normalized.includes(`${label}=`) || normalized.includes(`${label}:`));
}

export function noSecrets(value, path = 'evidence') {
  if (typeof value === 'string') {
    if (looksSecretShaped(value)) throw new TypeError(`${path} contains secret-shaped material`);
    return;
  }
  if (Array.isArray(value)) return value.forEach((entry, index) => noSecrets(entry, `${path}[${index}]`));
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) noSecrets(child, `${path}.${key}`);
}

export function containsPlaceholder(value) {
  if (typeof value === 'string') return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
  if (Array.isArray(value)) return value.some(containsPlaceholder);
  if (value && typeof value === 'object') return Object.values(value).some(containsPlaceholder);
  return false;
}
