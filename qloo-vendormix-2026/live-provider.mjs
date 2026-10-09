// SPDX-License-Identifier: MIT
// VendorMix live hackathon transport. Never treat provider errors as user input.
// Source: https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide
// The hackathon /v2/insights endpoint accepts GET with query params, not POST.
const HACKATHON_ORIGIN = 'https://hackathon.api.qloo.com';
const ROUTES = new Set(['/search', '/v2/insights']);

export class LiveProviderError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'LiveProviderError';
    this.status = status;
  }
}

function queryUrl(apiBase, path, requestBody) {
  if (!ROUTES.has(path)) throw new LiveProviderError('Unsupported Qloo API path', 400);
  if (!requestBody || typeof requestBody !== 'object' || Array.isArray(requestBody)) {
    throw new LiveProviderError('Qloo GET query parameters must be an object', 400);
  }
  const url = new URL(path, apiBase);
  for (const [key, value] of Object.entries(requestBody)) {
    // The named-entity query array is POST-only in the general API docs,
    // and POST /v2/insights is unsupported for the hackathon key.
    if (key === 'signal.interests.entities.query' ||
        !/^[a-zA-Z][a-zA-Z0-9.]*$/.test(key) ||
        !(typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))) {
      throw new LiveProviderError('Qloo GET does not accept this request parameter', 400);
    }
    url.searchParams.set(key, String(value));
  }
  if (path === '/v2/insights' && !url.searchParams.has('filter.type')) {
    throw new LiveProviderError('Qloo Insights requires filter.type', 400);
  }
  return url.toString();
}

/** Parse original live responses only after the existing bounded reader completes. */
export async function fetchLiveQlooResponse({
  apiBase, apiKey, requestBody, path = '/v2/insights',
  readBytes, fetcher = globalThis.fetch
}) {
  // A Qloo hackathon credential is INVALID on staging and production.
  if (apiBase !== HACKATHON_ORIGIN) throw new LiveProviderError('Invalid hackathon Qloo origin');
  if (typeof apiKey !== 'string' || !apiKey) throw new LiveProviderError('Qloo is not configured', 503);
  if (typeof readBytes !== 'function' || typeof fetcher !== 'function') {
    throw new LiveProviderError('Qloo transport unavailable');
  }
  const url = queryUrl(apiBase, path, requestBody);
  let response;
  try {
    response = await fetcher(url, {
      method: 'GET',
      redirect: 'error', // Never forward the server-only X-API-Key to a redirect target.
      signal: AbortSignal.timeout(12000),
      headers: { 'x-api-key': apiKey, accept: 'application/json' },
    });
  } catch {
    throw new LiveProviderError('Qloo request failed or redirect rejected; no synthetic results substituted');
  }
  if (!response || !response.ok) {
    const code = Number.isInteger(response?.status) ? response.status : 502;
    throw new LiveProviderError('Qloo returned HTTP ' + code + '; no synthetic results substituted',
      code === 429 ? 429 : 502);
  }
  let bytes;
  try {
    bytes = await readBytes(response);
  } catch {
    throw new LiveProviderError('Qloo response exceeded limits or could not be read');
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new LiveProviderError('Qloo returned invalid JSON');
  }
}
