// SPDX-License-Identifier: MIT
// VendorMix live Qloo transport. Never treat provider errors as bad user input.
const ORIGINS = new Set([
  'https://hackathon.api.qloo.com',
  'https://api.qloo.com',
  'https://staging.api.qloo.com',
]);

export class LiveProviderError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'LiveProviderError';
    this.status = status;
  }
}

/** Parse live responses only after the existing bounded streaming reader completes. */
export async function fetchLiveQlooResponse({ apiBase, apiKey, requestBody, readBytes, fetcher = globalThis.fetch }) {
  if (!ORIGINS.has(apiBase)) throw new LiveProviderError('Invalid Qloo endpoint configuration');
  if (typeof apiKey !== 'string' || !apiKey) throw new LiveProviderError('Qloo is not configured', 503);
  if (typeof readBytes !== 'function' || typeof fetcher !== 'function') {
    throw new LiveProviderError('Qloo transport unavailable');
  }
  let response;
  try {
    response = await fetcher(`${apiBase}/v2/insights`, {
      method: 'POST',
      redirect: 'error', // Never forward the server-only X-API-Key to a redirect target.
      signal: AbortSignal.timeout(12000),
      headers: {
        'x-api-key': apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
  } catch {
    throw new LiveProviderError('Qloo request failed or redirect rejected; no synthetic results substituted');
  }
  if (!response || !response.ok) {
    const code = Number.isInteger(response?.status) ? response.status : 502;
    throw new LiveProviderError(`Qloo returned HTTP ${code}; no synthetic results substituted`, code === 429 ? 429 : 502);
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
