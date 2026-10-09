// SPDX-License-Identifier: MIT
// Enforce the Qloo upstream byte ceiling during streaming, not after allocation.
export const MAX_QLOO_RESPONSE_BYTES = 250_000;

export async function readBoundedQlooBytes(response, limit = MAX_QLOO_RESPONSE_BYTES) {
  const body = response?.body;
  if (!body || typeof body.getReader !== 'function') {
    throw new Error('Qloo returned an unreadable response stream');
  }
  const header = response.headers?.get?.('content-length');
  if (typeof header === 'string' && /^\d+$/.test(header) && Number(header) > limit) {
    try { await body.cancel(); } catch { /* best-effort network stop */ }
    throw new Error('Qloo response exceeded the bounded result limit');
  }
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new Error('Qloo returned a malformed byte stream');
      }
      size += value.byteLength;
      if (size > limit) {
        throw new Error('Qloo response exceeded the bounded result limit');
      }
      chunks.push(value);
    }
  } catch (err) {
    try { await reader.cancel(); } catch { /* retain the original failure */ }
    throw err;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
