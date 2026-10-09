import { CATEGORIES, normalizeEntities, TYPES } from './planner.mjs';

const DEFAULT_ENDPOINT = 'https://hackathon.api.qloo.com';
const APPROVED_ENDPOINTS = new Set([
  'https://hackathon.api.qloo.com',
  'https://staging.api.qloo.com',
  'https://api.qloo.com',
]);

const MAX_RESPONSE_BYTES = 1_500_000;

/** Bound actual streamed bytes *before* decoding. response.text() alone
 * can allocate an arbitrarily large upstream body before a length check.
 */
async function readBoundedJson(response) {
  const tooLarge = () => new Error('Qloo returned an unexpectedly large response.');
  const advertised = response.headers?.get?.('content-length');
  if (advertised != null && /^\\d+$/.test(advertised) && Number(advertised) > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel?.(); } catch { /* best-effort upstream cancel */ }
    throw tooLarge();
  }

  const reader = response.body?.getReader?.();
  let raw = '';
  if (reader) {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array)) throw new Error('Qloo response was not a byte stream.');
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) throw tooLarge();
        raw += decoder.decode(value, { stream: true });
      }
      raw += decoder.decode();
    } catch (error) {
      try { await reader.cancel(); } catch { /* preserve original failure */ }
      throw error;
    } finally {
      reader.releaseLock();
    }
  } else {
    // Compatibility for simple synthetic fetch adapters lacking ReadableStream.
    // Production fetch Response always uses the bounded streaming path above.
    raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_RESPONSE_BYTES) throw tooLarge();
  }
  try { return JSON.parse(raw); } catch { throw new Error('Qloo response was not valid JSON.'); }
}

/** Host allowlist ensures that an env typo cannot exfiltrate the API key. */
export function createQlooClient({ apiKey = process.env.QLOO_API_KEY,
  baseUrl = process.env.QLOO_BASE_URL || DEFAULT_ENDPOINT,
  fetchImpl = fetch, allowTestOrigin = false } = {}) {
  if (!apiKey || typeof apiKey !== 'string') throw new Error('QLOO_API_KEY is required for live Qloo requests.');
  const origin = new URL(baseUrl).origin;
  if (!allowTestOrigin && !APPROVED_ENDPOINTS.has(origin)) throw new Error('Unapproved Qloo API endpoint host.');
  if (new URL(baseUrl).pathname !== '/') throw new Error('Qloo API base must be an origin.');
  async function request(path, query = {}) {
    const url = new URL(path, origin);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const rsp = await fetchImpl(url, { method: 'GET',
      headers: { 'x-api-key': apiKey, accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(12000) });
    if (!rsp.ok) {
      // Avoid echoing response body or sending key/URL to browser/logs.
      throw new Error(`Qloo ${path} responded HTTP ${rsp.status}. Check input and API eligibility.`);
    }
    return readBoundedJson(rsp);
  }
  return {
    async resolve(name) {
      const raw = await request('/search', { query: name, limit: 8 });
      const candidates = [raw?.results, raw?.results?.entities, raw?.entities, raw?.data].find(Array.isArray) ?? [];
      const safe = candidates.flatMap(x => {
        const id = x?.id ?? x?.entity_id;
        const displayName = x?.name ?? x?.properties?.name ?? x?.title;
        if (!id || typeof displayName !== 'string') return [];
        return [{ id: String(id), name: displayName, type: x?.type ?? x?.entity_type ?? null }];
      });
      const exact = safe.find(x => x.name.toLocaleLowerCase() === name.toLocaleLowerCase());
      if (!(exact || safe[0])) throw new Error(`No Qloo entity matched “${name}”. Choose a more specific culture reference.`);
      return { query: name, ...(exact || safe[0]) };
    },
    async recommendations(category, { city, ids, excludedIds = [] }) {
      if (!CATEGORIES.includes(category)) throw new Error('Unsupported category.');
      const query = {
        'filter.type': TYPES[category],
        'signal.interests.entities': ids.join(','),
        'feature.explainability': 'true',
        take: 16,
      };
      if (category === 'place') query['filter.location.query'] = city;
      if (excludedIds.length) query['filter.exclude.entities'] = excludedIds.join(',');
      const raw = await request('/v2/insights', query);
      return raw;
    },
  };
}
