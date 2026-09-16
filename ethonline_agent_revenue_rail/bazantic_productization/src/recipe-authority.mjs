import { canonicalJson, isGitSha, isSha256Hex, sha256Hex } from './canonical.mjs';

const RECIPE_AUTHORITIES = new WeakSet();

export function exact(value, required, optional = [], label = 'object') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!(key in value)) throw new TypeError(`${label}.${key} is required`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${label}.${key} is unknown`);
}

export function parseInstant(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new TypeError(`${label} must be canonical UTC milliseconds`);
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== value) throw new TypeError(`${label} is invalid`);
  return millis;
}

export function normalizeHttpsUrl(value, label) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  let url;
  try { url = new URL(value); } catch { throw new TypeError(`${label} must be an absolute URL`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || !url.hostname) throw new TypeError(`${label} must be credential-free https`);
  return url.toString();
}

export function sha(value, label) {
  if (!isSha256Hex(value)) throw new TypeError(`${label} must be sha256 hex`);
}

export function nullableSha(value, label) {
  if (value !== null) sha(value, label);
}

export function nullableString(value, label) {
  if (value !== null && (typeof value !== 'string' || value.trim() === '')) throw new TypeError(`${label} must be null or a non-empty string`);
}

export function validateBinding(binding, label) {
  exact(binding, ['expectedReceiptDigest', 'sourceHead', 'executionEvidenceDigest'], [], label);
  sha(binding.expectedReceiptDigest, `${label}.expectedReceiptDigest`);
  if (!isGitSha(binding.sourceHead)) throw new TypeError(`${label}.sourceHead must be a 40-char git SHA`);
  sha(binding.executionEvidenceDigest, `${label}.executionEvidenceDigest`);
  return binding;
}

export function validateReportBinding(binding) {
  exact(binding, ['expectedPayloadDigest', 'expectedServiceResponseDigest', 'sourceHead', 'executionEvidenceDigest'], [], 'authority.report');
  sha(binding.expectedPayloadDigest, 'authority.report.expectedPayloadDigest');
  sha(binding.expectedServiceResponseDigest, 'authority.report.expectedServiceResponseDigest');
  if (!isGitSha(binding.sourceHead)) throw new TypeError('authority.report.sourceHead must be a 40-char git SHA');
  sha(binding.executionEvidenceDigest, 'authority.report.executionEvidenceDigest');
  return binding;
}

function validateAuthorityShape(authority) {
  exact(authority, ['evaluatedAt', 'laneB'], ['laneA', 'report'], 'authority');
  const evaluatedAtMs = parseInstant(authority.evaluatedAt, 'authority.evaluatedAt');
  validateBinding(authority.laneB, 'authority.laneB');
  if (authority.laneA !== undefined) validateBinding(authority.laneA, 'authority.laneA');
  if (authority.report !== undefined) validateReportBinding(authority.report);
  return { evaluatedAtMs, authorityBindingDigest: sha256Hex(authority) };
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

/**
 * Host-only capability constructor. The returned object is frozen and branded in
 * this module's WeakSet, so serialized/caller-authored JSON cannot be replayed as
 * runtime authority. Provider adapters must verify/read back evidence before
 * invoking this constructor; untrusted request handlers must never call it.
 */
export function createRecipeAuthority(input) {
  const authority = JSON.parse(canonicalJson(input));
  validateAuthorityShape(authority);
  freezeDeep(authority);
  RECIPE_AUTHORITIES.add(authority);
  return authority;
}

export function validateAuthority(authority) {
  if (!RECIPE_AUTHORITIES.has(authority)) {
    throw new TypeError('authority must be a non-serializable capability created by createRecipeAuthority');
  }
  return validateAuthorityShape(authority);
}
