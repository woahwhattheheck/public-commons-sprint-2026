// MIT. Project source-authorized delivery before original SF88 durable output.
import { createHash } from 'node:crypto';

export const VALYU_DELIVERY_SCHEMA = 'stellar-forge.valyu-search-delivery.v1';
export const VALYU_DELIVERY_PROFILE_SCHEMA = 'stellar-forge.valyu-delivery-profile.v1';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const need = (value, message) => { if (!value) throw new TypeError(message); };
const stamp = (value, name) => {
  need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value)), name + ' must be an ISO timestamp with a timezone');
  return new Date(value).toISOString();
};
const freeze = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};
export function normalizeValyuDeliveryProfile(input = {}) {
  need(plain(input) && Object.keys(input).every(key => ['schema', 'id', 'mode', 'agreementReference',
    'profileValidUntil', 'retentionMode', 'contentValidUntil', 'sources', 'sourceUrlPrefixes'].includes(key)), 'Unknown Valyu delivery profile field');
  need(input.schema === undefined || input.schema === VALYU_DELIVERY_PROFILE_SCHEMA, 'Invalid Valyu delivery profile schema');
  const id = input.id ?? 'references-only';
  need(typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id), 'Delivery profile requires a stable ID');
  const mode = input.mode ?? 'handles-only';
  need(['handles-only', 'licensed-sources'].includes(mode), 'Invalid Valyu delivery mode');
  const retentionMode = input.retentionMode ?? 'references';
  need(['references', 'durable', 'request', 'cache'].includes(retentionMode), 'Invalid source retention mode');
  const agreementReference = input.agreementReference ?? null;
  if (agreementReference !== null)
    need(typeof agreementReference === 'string' && agreementReference.trim() &&
      agreementReference.length <= 512 && !/[\u0000-\u001f\u007f]/.test(agreementReference),
      'Use a nonsecret reference to the actual provider agreement');
  const profileValidUntil = input.profileValidUntil == null ? null : stamp(input.profileValidUntil, 'profileValidUntil');
  const contentValidUntil = input.contentValidUntil == null ? null : stamp(input.contentValidUntil, 'contentValidUntil');
  const sources = input.sources ?? [];
  need(Array.isArray(sources) && sources.length <= 1000 && sources.every(value =>
    typeof value === 'string' && value.trim() && value === value.trim() && value.length <= 512 &&
    !/[\u0000-\u0020\u007f*?]/.test(value)) && new Set(sources).size === sources.length,
    'Delivery sources must be unique exact provider source names');
  const scopeInput = input.sourceUrlPrefixes ?? {};
  need(plain(scopeInput) && Object.keys(scopeInput).every(name => sources.includes(name)),
    'URL scopes must name a source in this exact-source profile');
  const sourceUrlPrefixes = Object.fromEntries(Object.entries(scopeInput).map(([name, prefixes]) => {
    need(Array.isArray(prefixes) && prefixes.length > 0 && prefixes.length <= 100,
      'Each source URL scope needs 1–100 absolute URL prefixes');
    const normalized = prefixes.map(prefix => {
      need(typeof prefix === 'string' && prefix.length <= 2048, 'Source URL prefix must be text up to 2048 characters');
      let url;
      try { url = new URL(prefix); } catch { throw new TypeError('Source URL prefix must be an absolute HTTP URL'); }
      need(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
        !url.search && !url.hash, 'Source URL scope requires a canonical origin/path without credentials, query or fragment');
      return url.href;
    });
    need(new Set(normalized).size === normalized.length, 'Duplicate source URL scope');
    return [name, normalized];
  }));
  if (mode === 'licensed-sources')
    need(agreementReference !== null && sources.length > 0, 'Licensed sources require their existing agreement reference and exact source names');
  if (mode === 'handles-only')
    need(sources.length === 0 && Object.keys(sourceUrlPrefixes).length === 0 && retentionMode === 'references' && contentValidUntil === null,
      'Handle-only profiles retain operational references only');
  return freeze({ schema: VALYU_DELIVERY_PROFILE_SCHEMA, id, mode, agreementReference,
    profileValidUntil, retentionMode, contentValidUntil, sources: [...sources], sourceUrlPrefixes });
}
function sourcePermitted(profile, row) {
  if (!plain(row) || !profile.sources.includes(row.source)) return false;
  const prefixes = profile.sourceUrlPrefixes[row.source];
  // A domain-specific web/news grant must match the returned document, since
  // native results use a broad source label such as "web".
  if (prefixes === undefined) return !['web', 'news'].includes(row.source.toLowerCase());
  let actual;
  try { actual = new URL(row.url); } catch { return false; }
  if (!['http:', 'https:'].includes(actual.protocol) || actual.username || actual.password) return false;
  return prefixes.some(prefix => {
    const scope = new URL(prefix), path = scope.pathname.replace(/\/$/, '');
    return actual.origin === scope.origin && (path === '' || actual.pathname === path ||
      actual.pathname.startsWith(path + '/'));
  });
}
export function valyuUpstreamSha256(bytes) {
  need(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array, 'Exact original upstream bytes required');
  return createHash('sha256').update(bytes).digest('hex');
}

/** Never place request-only or expiring publisher material in immutable buyer
 * artifacts. A current profile grants new delivery; durable retention is separate. */
export function projectValyuDelivery(response, { request, profile: input = {}, upstreamSha256,
  receivedAt = new Date().toISOString(), httpStatus = 200 } = {}) {
  need(plain(response) && response.success === true && Array.isArray(response.results) && plain(request),
    'Original successful Valyu response and exact request required');
  need(/^[0-9a-f]{64}$/.test(upstreamSha256 ?? ''), 'Original upstream SHA-256 required');
  need([200, 206].includes(httpStatus), 'Valyu delivery requires original HTTP 200 or 206');
  const capturedAt = stamp(receivedAt, 'receivedAt'), profile = normalizeValyuDeliveryProfile(input);
  const current = profile.profileValidUntil === null || Date.parse(profile.profileValidUntil) > Date.parse(capturedAt);
  const durable = current && profile.mode === 'licensed-sources' &&
    profile.retentionMode === 'durable' && profile.contentValidUntil === null;
  let retainedResultCount = 0;
  const results = response.results.map((row, index) => {
    const occurrenceId = createHash('sha256').update('valyu-occurrence-v1\0' + upstreamSha256 + '\0' + index).digest('hex');
    if (durable && sourcePermitted(profile, row)) {
      retainedResultCount++;
      return { occurrenceId, contentDisposition: 'durable', result: structuredClone(row) };
    }
    return { occurrenceId, contentDisposition: 'withheld' };
  });
  const warnings = [];
  if (response.error || response.warnings?.length) warnings.push('PROVIDER_WARNING_PRESENT');
  if (results.length > retainedResultCount) warnings.push('RESULT_CONTENT_WITHHELD');
  if (!current) warnings.push('DELIVERY_PROFILE_EXPIRED');
  if (profile.retentionMode === 'request' || profile.retentionMode === 'cache' || profile.contentValidUntil !== null)
    warnings.push('TIMED_CONTENT_EXCLUDED_FROM_DURABLE_OUTPUT');
  return { schema: VALYU_DELIVERY_SCHEMA, request: structuredClone(request), receivedAt: capturedAt,
    provider: { txId: response.tx_id, success: true, httpStatus, upstreamSha256,
      errorPresent: typeof response.error === 'string' && response.error.length > 0,
      warningCount: Array.isArray(response.warnings) ? response.warnings.length : 0,
      usage: { totalDeductionDollars: response.total_deduction_dollars,
        totalCharacters: response.total_characters, resultCount: response.results.length } },
    delivery: { profileId: profile.id, mode: profile.mode, agreementReference: profile.agreementReference,
      retentionMode: retainedResultCount > 0 ? 'durable' : 'references', validUntil: null,
      profileValidUntil: profile.profileValidUntil, retainedResultCount,
      withheldResultCount: results.length - retainedResultCount },
    results, warnings };
}


const DELIVERY_WARNINGS = new Set(['PROVIDER_WARNING_PRESENT', 'RESULT_CONTENT_WITHHELD',
  'DELIVERY_PROFILE_EXPIRED', 'TIMED_CONTENT_EXCLUDED_FROM_DURABLE_OUTPUT']);
function exact(value, keys, label) {
  need(plain(value) && Object.keys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value, key)), label + ' has unexpected or missing fields');
}
function jsonValue(value, depth = 0) {
  need(depth <= 100, 'Valyu delivery JSON exceeds the supported nesting depth');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') { need(Number.isFinite(value), 'Valyu delivery numbers must be finite'); return; }
  need(Array.isArray(value) || plain(value), 'Valyu delivery must contain plain JSON values');
  for (const child of Object.values(value)) jsonValue(child, depth + 1);
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

/** Shared immutable-export boundary. A supplied trusted profile also verifies
 * the source grant; agreement references carried by a payload are bookkeeping,
 * not independent evidence of an agreement. Returns the original value. */
export function assertValyuDelivery(input, { profile: profileInput, request, upstreamSha256 } = {}) {
  jsonValue(input);
  need(Buffer.byteLength(JSON.stringify(input), 'utf8') <= 16777216, 'Valyu delivery exceeds the native 16 MiB ceiling');
  exact(input, ['schema', 'request', 'receivedAt', 'provider', 'delivery', 'results', 'warnings'], 'Valyu delivery');
  need(input.schema === VALYU_DELIVERY_SCHEMA, 'Original projected Valyu delivery required');
  need(plain(input.request) && typeof input.request.query === 'string' && input.request.query.trim(),
    'Valyu delivery requires its customer request');
  const requestFields = new Set(['query', 'search_type', 'max_num_results', 'is_tool_call',
    'relevance_threshold', 'max_price', 'included_sources', 'excluded_sources', 'country_code', 'response_length',
    'category', 'start_date', 'end_date', 'fast_mode', 'url_only', 'source_biases', 'instructions',
    'historical_cache', 'historical_cache_strict', 'include_abstracts']);
  need(Object.keys(input.request).every(key => requestFields.has(key)), 'Unexpected field in retained customer request');
  const receivedAt = stamp(input.receivedAt, 'receivedAt');
  need(receivedAt === input.receivedAt, 'Valyu delivery requires a canonical receivedAt timestamp');
  exact(input.provider, ['txId', 'success', 'httpStatus', 'upstreamSha256', 'errorPresent', 'warningCount', 'usage'], 'Valyu provider record');
  const provider = input.provider, delivery = input.delivery;
  need(provider.success === true && [200, 206].includes(provider.httpStatus) &&
    typeof provider.txId === 'string' && provider.txId.trim() && provider.txId.length <= 4096 &&
    /^[0-9a-f]{64}$/.test(provider.upstreamSha256) &&
    typeof provider.errorPresent === 'boolean' &&
    Number.isSafeInteger(provider.warningCount) && provider.warningCount >= 0,
    'Valyu provider transaction, status or original-byte hash is invalid');
  exact(provider.usage, ['totalDeductionDollars', 'totalCharacters', 'resultCount'], 'Valyu provider usage');
  need(typeof provider.usage.totalDeductionDollars === 'number' && Number.isFinite(provider.usage.totalDeductionDollars) &&
    provider.usage.totalDeductionDollars >= 0 &&
    Number.isSafeInteger(provider.usage.totalCharacters) && provider.usage.totalCharacters >= 0 &&
    Number.isSafeInteger(provider.usage.resultCount) && provider.usage.resultCount >= 0,
    'Valyu provider usage is invalid');
  exact(delivery, ['profileId', 'mode', 'agreementReference', 'retentionMode', 'validUntil', 'profileValidUntil',
    'retainedResultCount', 'withheldResultCount'], 'Valyu delivery policy');
  need(typeof delivery.profileId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(delivery.profileId) &&
    ['handles-only', 'licensed-sources'].includes(delivery.mode) &&
    ['references', 'durable'].includes(delivery.retentionMode) && delivery.validUntil === null,
    'Valyu immutable delivery requires references or durable content without content expiry');
  need(delivery.agreementReference === null || typeof delivery.agreementReference === 'string' &&
    delivery.agreementReference.trim() && delivery.agreementReference.length <= 512 &&
    !/[\u0000-\u001f\u007f]/.test(delivery.agreementReference), 'Invalid agreement reference');
  if (delivery.profileValidUntil !== null)
    need(stamp(delivery.profileValidUntil, 'profileValidUntil') === delivery.profileValidUntil,
      'Valyu delivery requires a canonical profileValidUntil timestamp');
  need(Array.isArray(input.results) && input.results.length === provider.usage.resultCount &&
    Number.isSafeInteger(delivery.retainedResultCount) && delivery.retainedResultCount >= 0 &&
    Number.isSafeInteger(delivery.withheldResultCount) && delivery.withheldResultCount >= 0 &&
    delivery.retainedResultCount + delivery.withheldResultCount === input.results.length,
    'Valyu delivery counts do not match the provider result count');
  need(Array.isArray(input.warnings) && new Set(input.warnings).size === input.warnings.length &&
    input.warnings.every(value => DELIVERY_WARNINGS.has(value)), 'Valyu delivery warnings must be local status codes');
  need(input.warnings.includes('PROVIDER_WARNING_PRESENT') === (provider.errorPresent || provider.warningCount > 0),
    'Valyu provider warning status must be preserved');
  need(input.warnings.includes('RESULT_CONTENT_WITHHELD') === (delivery.withheldResultCount > 0),
    'Valyu withheld status must match delivered rows');
  if (request !== undefined) {
    jsonValue(request);
    need(canonical(request) === canonical(input.request), 'Valyu delivery does not match the expected request');
  }
  if (upstreamSha256 !== undefined)
    need(upstreamSha256 === provider.upstreamSha256, 'Valyu delivery does not match the expected upstream hash');
  const profile = profileInput === undefined ? null : normalizeValyuDeliveryProfile(profileInput);
  if (profile) {
    need(profile.id === delivery.profileId && profile.mode === delivery.mode &&
      profile.agreementReference === delivery.agreementReference && profile.profileValidUntil === delivery.profileValidUntil,
      'Valyu delivery does not match the trusted server profile');
  }
  let retained = 0;
  for (const [index, row] of input.results.entries()) {
    need(plain(row), 'Invalid Valyu delivered row');
    const occurrenceId = createHash('sha256').update('valyu-occurrence-v1\0' + provider.upstreamSha256 + '\0' + index).digest('hex');
    need(row.occurrenceId === occurrenceId, 'Valyu occurrence must identify its original response position');
    if (row.contentDisposition === 'withheld') {
      exact(row, ['occurrenceId', 'contentDisposition'], 'Withheld Valyu occurrence');
      continue;
    }
    exact(row, ['occurrenceId', 'contentDisposition', 'result'], 'Durable Valyu occurrence');
    need(row.contentDisposition === 'durable' && plain(row.result) &&
      typeof row.result.source === 'string' && row.result.source.trim() &&
      delivery.mode === 'licensed-sources' && delivery.retentionMode === 'durable' &&
      typeof delivery.agreementReference === 'string' && delivery.agreementReference.trim(),
      'Durable Valyu content requires its declared exact-source agreement');
    need(delivery.profileValidUntil === null || Date.parse(delivery.profileValidUntil) > Date.parse(receivedAt),
      'The delivery profile was expired when content was captured');
    if (profile) need(profile.retentionMode === 'durable' && profile.contentValidUntil === null &&
      sourcePermitted(profile, row.result), 'This source or returned URL has no durable grant in the trusted server profile');
    retained++;
  }
  need(retained === delivery.retainedResultCount &&
    delivery.retentionMode === (retained > 0 ? 'durable' : 'references'),
    'Valyu retained count or retention mode differs from its rows');
  if (delivery.mode === 'licensed-sources')
    need(typeof delivery.agreementReference === 'string' && delivery.agreementReference.trim(), 'Licensed profile requires agreement reference');
  if (delivery.mode === 'handles-only') need(retained === 0, 'Handle-only delivery cannot contain publisher fields');
  return input;
}
