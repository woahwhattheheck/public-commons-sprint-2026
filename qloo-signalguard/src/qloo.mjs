/** Live hackathon provider. Keys never enter HTML, URLs, logs or the repo. */
const HOST = 'https://hackathon.api.qloo.com';
const ALLOWED = new Set(['urn:entity:movie', 'urn:entity:book', 'urn:entity:artist']);

export class QlooError extends Error {
  constructor(message, status) { super(message); this.name = 'QlooError'; this.status = status; }
}

async function getJson(path, params, apiKey, fetcher) {
  const u = new URL(path, HOST);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') u.searchParams.append(key, String(value));
  }
  const ctrl = new AbortController();
  const deadline = setTimeout(() => ctrl.abort(), 12000);
  let response;
  try {
    response = await fetcher(u, { headers: { 'X-Api-Key': apiKey, Accept: 'application/json' }, signal: ctrl.signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw new QlooError('Qloo request timed out', 504);
    throw new QlooError('Qloo could not be reached; check network and hackathon API access', 502);
  } finally { clearTimeout(deadline); }
  if (!response.ok) {
    if (response.status === 401) throw new QlooError('Hackathon API key not accepted (verify hackathon environment)', 401);
    if (response.status === 429) throw new QlooError(`Qloo rate-limited requests; pause and try later (Retry-After: ${String(response.headers.get('retry-after') ?? 'unspecified').slice(0,20)})`, 429);
    throw new QlooError(`Qloo upstream returned HTTP ${response.status}`, response.status);
  }
  try { return await response.json(); }
  catch { throw new QlooError('Qloo returned invalid JSON', 502); }
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
