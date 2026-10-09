/** Live hackathon provider. Keys never enter HTML, URLs, logs or the repo. */
const HOST = 'https://hackathon.api.qloo.com';
const ALLOWED = new Set(['urn:entity:movie', 'urn:entity:book', 'urn:entity:artist']);
const MAX_RESPONSE_BYTES = 1024 * 1024;

export class QlooError extends Error {
  constructor(message, status) { super(message); this.name = 'QlooError'; this.status = status; }
}

async function readJsonBounded(response) {
  const length = response.headers?.get?.('content-length');
  if (length != null && length !== '') {
    const value = Number(length);
    if (Number.isFinite(value) && value > MAX_RESPONSE_BYTES)
      throw new QlooError('Qloo response exceeds the size limit', 502);
  }

  // The real Node fetch supplies a ReadableStream; enforce the bound as bytes arrive.
  // The fallback supports existing small, in-process mock fetchers used by offline tests.
  if (!response.body?.getReader) {
    if (typeof response.json !== 'function') throw new QlooError('Qloo response is not readable', 502);
    const json = await response.json();
    if (Buffer.byteLength(JSON.stringify(json)) > MAX_RESPONSE_BYTES)
      throw new QlooError('Qloo response exceeds the size limit', 502);
    return json;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch { /* aborting is best-effort */ }
        throw new QlooError('Qloo response exceeds the size limit', 502);
      }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks, received).toString('utf8'));
  } finally {
    try { reader.releaseLock(); } catch { /* reader already closed */ }
  }
}

async function getJson(path, params, apiKey, fetcher) {
  const u = new URL(path, HOST);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') u.searchParams.append(key, String(value));
  }
  const ctrl = new AbortController();
  const deadline = setTimeout(() => ctrl.abort(), 12000);
  try {
    const response = await fetcher(u, {
      headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
      signal: ctrl.signal,
      redirect: 'manual', // Never forward a server-only API key to a redirected origin.
    });
    if (response.status >= 300 && response.status < 400)
      throw new QlooError('Qloo redirect refused; credentials were not forwarded', 502);
    if (!response.ok) {
      if (response.status === 401) throw new QlooError('Hackathon API key not accepted (verify hackathon environment)', 401);
      if (response.status === 429) throw new QlooError(`Qloo rate-limited requests; pause and try later (Retry-After: ${String(response.headers?.get?.('retry-after') ?? 'unspecified').slice(0,20)})`, 429);
      throw new QlooError(`Qloo upstream returned HTTP ${response.status}`, 502);
    }
    try { return await readJsonBounded(response); }
    catch (e) {
      if (e instanceof QlooError) throw e;
      throw new QlooError('Qloo returned invalid or unreadable JSON', 502);
    }
  } catch (e) {
    if (ctrl.signal.aborted || e?.name === 'AbortError') throw new QlooError('Qloo request timed out', 504);
    if (e instanceof QlooError) throw e;
    throw new QlooError('Qloo could not be reached; check network and hackathon API access', 502);
  } finally {
    clearTimeout(deadline); // Covers both response headers AND body consumption.
  }
}

export function createQlooProvider(apiKey, fetcher = fetch) {
  if (!apiKey) throw new QlooError('QLOO_API_KEY is not configured on the server', 503);
  return {
    async search(query, types) {
      if (!ALLOWED.has(types)) throw new QlooError('Unsupported seed type', 400);
      // Qloo documents /search with the `query` and array-of-strings `types` fields.
      return getJson('/search', { query, types, take: 10 }, apiKey, fetcher);
    },
    async insights({ target, entityId, take = 15, maxPopularity, minPopularity }) {
      if (!ALLOWED.has(target)) throw new QlooError('Unsupported target type', 400);
      if (!entityId || entityId.length > 160) throw new QlooError('Missing or invalid entity ID', 400);
      const params = { 'filter.type': target, 'signal.interests.entities': entityId, take };
      if (maxPopularity !== undefined) params['filter.popularity.max'] = maxPopularity;
      if (minPopularity !== undefined) params['filter.popularity.min'] = minPopularity;
      return getJson('/v2/insights', params, apiKey, fetcher);
    },
  };
}
