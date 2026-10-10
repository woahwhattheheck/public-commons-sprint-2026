// MIT. Interpret only original SF41 recorded native GET URLs for legacy manifests.
// This does not rewrite captured bytes, claim seller authenticity, or authorize payment.
import { NATIVE_FILTER_KEYS, validateCaptureFilters, assertNativePageScope } from '../sf41-real-source-replay/capture_filters.mjs';

export function recoverLegacyCaptureFilters(manifest) {
  if (!manifest || !Array.isArray(manifest.sources) || !manifest.sources.length)
    throw Error('LEGACY_SOURCE_URLS_REQUIRED');
  // Explicit filters remain authoritative, including an explicit empty object.
  if (Object.hasOwn(manifest, 'filters'))
    return { effectiveManifest: manifest, filterEvidence: 'DECLARED_IN_ORIGINAL_MANIFEST' };

  let prior = null;
  for (const source of manifest.sources) {
    if (source?.method !== 'GET' || typeof source.url !== 'string')
      throw Error('LEGACY_ORIGINAL_GET_REQUIRED');
    let url;
    try { url = new URL(source.url); }
    catch { throw Error('LEGACY_INVALID_SOURCE_URL'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash)
      throw Error('LEGACY_HTTPS_SOURCE_REQUIRED');
    const candidates = {};
    for (const key of url.searchParams.keys()) {
      if (url.searchParams.getAll(key).length !== 1)
        throw Error('LEGACY_DUPLICATE_PAGE_QUERY: ' + key);
      if (NATIVE_FILTER_KEYS.includes(key)) candidates[key] = url.searchParams.get(key);
      else if (key !== 'limit' && key !== 'offset')
        throw Error('LEGACY_UNSUPPORTED_PAGE_QUERY: ' + key);
    }
    const filters = validateCaptureFilters(candidates);
    assertNativePageScope(url, filters);
    const signature = JSON.stringify(filters);
    if (prior !== null && prior.signature !== signature)
      throw Error('LEGACY_MIXED_PAGE_FILTERS');
    prior = { filters, signature };
  }
  return { effectiveManifest: { ...manifest, filters: prior.filters },
    filterEvidence: 'DERIVED_FROM_ORIGINAL_SOURCE_URLS' };
}
