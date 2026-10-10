const HOST = 'https://hackathon.api.qloo.com';
const MAX_RESPONSE_BYTES = 5_000_000;

export class ProviderError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function resultEntities(payload) {
  // Qloo Search and Insights use documented result envelopes, not always the same nesting.
  const rows = payload?.results?.entities ?? payload?.entities ?? payload?.results;
  if (!Array.isArray(rows)) throw new ProviderError('QLOO_ENVELOPE_UNKNOWN');
  return rows;
}

function identity(item) {
  if (!item || typeof item !== 'object') return null;
  const id = item.entity_id ?? item.id;
  if (typeof id !== 'string' || !id.trim()) return null;
  return id;
}

export function readArtistSearch(payload, seed) {
  const rows = resultEntities(payload).filter(x => identity(x) && (x.subtype ?? x.type) === 'urn:entity:artist');
  const exact = rows.filter(x => typeof x.name === 'string' && x.name.trim().toLocaleLowerCase() === seed.trim().toLocaleLowerCase());
  if (exact.length !== 1) throw new ProviderError(exact.length ? 'QLOO_ARTIST_AMBIGUOUS' : 'QLOO_ARTIST_NOT_EXACT');
  return {id: identity(exact[0]), name: exact[0].name};
}

export function readPlaceRanks(payload) {
  const rows = resultEntities(payload);
  const ids = [];
  const seen = new Set();
  for (const x of rows) {
    const type = x?.subtype ?? x?.type;
    if (type !== 'urn:entity:place') throw new ProviderError('QLOO_PLACE_TYPE_MISMATCH');
    const id = identity(x);
    if (!id) throw new ProviderError('QLOO_PLACE_ID_MISSING');
    if (!seen.has(id)) { ids.push(id); seen.add(id); }
  }
  return ids;
}

export class QlooClient {
  constructor({apiKey, fetchFn = fetch, maxCalls = 2} = {}) {
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw new ProviderError('QLOO_KEY_REQUIRED');
    this.key=apiKey; this.fetchFn=fetchFn; this.maxCalls=maxCalls; this.calls=0;
  }
  async get(path, params) {
    if (++this.calls > this.maxCalls) throw new ProviderError('QLOO_CALL_BUDGET');
    const url = new URL(HOST + path);
    for (const [k,v] of Object.entries(params)) url.searchParams.set(k, v);
    const response = await this.fetchFn(url, {headers:{'X-Api-Key':this.key,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(7500)}).catch(() => { throw new ProviderError('QLOO_NETWORK_UNAVAILABLE'); });
    if (!response.ok) throw new ProviderError(response.status === 429 ? 'QLOO_RATE_LIMITED' : 'QLOO_HTTP_'+response.status);
    const declared = Number(response.headers?.get('content-length') || 0);
    if (declared > MAX_RESPONSE_BYTES) throw new ProviderError('QLOO_RESPONSE_TOO_LARGE');
    let chunks=[],len=0;
    for await (const chunk of response.body) {
      len += chunk.byteLength;
      if (len>MAX_RESPONSE_BYTES) throw new ProviderError('QLOO_RESPONSE_TOO_LARGE');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks.map(x=>Buffer.from(x)),len).toString('utf8')); }
    catch { throw new ProviderError('QLOO_INVALID_JSON'); }
  }
  async placesFromArtist(seed) {
    const search = await this.get('/search',{query:seed,types:'urn:entity:artist',take:'12'});
    const artist = readArtistSearch(search, seed);
    const insights = await this.get('/v2/insights',{'filter.type':'urn:entity:place','signal.interests.entities':artist.id});
    return {artist, rankedPlaceIds:readPlaceRanks(insights), qlooRequests:this.calls};
  }
}
