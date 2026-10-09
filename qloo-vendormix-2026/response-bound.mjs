// SPDX-License-Identifier: MIT
// Consume Qloo's untrusted byte stream with a hard 250,000-byte total cap.
// Do not buffer an unbounded upstream response before applying the limit.
const MAX_QLOO_RESPONSE_BYTES = 250_000;

export async function boundedQlooResponseBytes(response) {
  const declared = response.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared) && BigInt(declared) > BigInt(MAX_QLOO_RESPONSE_BYTES)) {
    try { await response.body?.cancel(); } catch { /* oversize is authoritative */ }
    throw new Error('Qloo response exceeded the bounded result limit');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Qloo response had no readable body');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error('Qloo returned an invalid byte stream');
      if (value.byteLength > MAX_QLOO_RESPONSE_BYTES - size) {
        try { await reader.cancel(); } catch { /* keep deterministic oversize error */ }
        throw new Error('Qloo response exceeded the bounded result limit');
      }
      size += value.byteLength;
      chunks.push(value);
    }
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
