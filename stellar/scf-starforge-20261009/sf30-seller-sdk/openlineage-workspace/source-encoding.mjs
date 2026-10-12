import { gunzipSync } from "node:zlib";
import { parseSource, sha256 } from "./model.mjs";

export const MAX_SOURCE_BYTES = 256 * 1024 * 1024;
export class SourceEncodingError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function normalizeEncoding(value = "identity") {
  const encoding = String(value).trim().toLowerCase();
  if (!["identity", "gzip"].includes(encoding))
    throw new SourceEncodingError("Use an uncompressed or gzip OpenLineage body", 415);
  return encoding;
}
export function decodeSource(bytes, { contentEncoding = "identity", maxDecodedBytes = MAX_SOURCE_BYTES } = {}) {
  if (!Number.isSafeInteger(maxDecodedBytes) || maxDecodedBytes < 1 || maxDecodedBytes > MAX_SOURCE_BYTES)
    throw new SourceEncodingError("Decoded source limit must be between 1 and " + MAX_SOURCE_BYTES + " bytes");
  const wire = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (wire.length > MAX_SOURCE_BYTES) throw new SourceEncodingError("Original source exceeds " + MAX_SOURCE_BYTES + " bytes", 413);
  const encoding = normalizeEncoding(contentEncoding);
  if (encoding === "identity") {
    if (wire.length > maxDecodedBytes) throw new SourceEncodingError("Source exceeds the configured decoded-byte limit", 413);
    return { wire, decoded: wire, contentEncoding: encoding };
  }
  try {
    const decoded = gunzipSync(wire, { maxOutputLength: maxDecodedBytes });
    return { wire, decoded, contentEncoding: encoding };
  } catch (error) {
    if (error.code === "ERR_BUFFER_TOO_LARGE") throw new SourceEncodingError("Gzip source exceeds the configured decoded-byte limit", 413);
    throw new SourceEncodingError("Invalid or incomplete gzip source");
  }
}
export function parseRetainedSource(bytes, name, options = {}) {
  const decoded = decodeSource(bytes, options);
  let parsed;
  try { parsed = parseSource(decoded.decoded, name); }
  catch (error) { throw new SourceEncodingError(error.message); }
  return {
    ...parsed, id: sha256(decoded.wire), bytes: decoded.wire.length,
    ...(decoded.contentEncoding === "gzip" ? {
      contentEncoding: "gzip", decodedBytes: decoded.decoded.length, decodedSha256: sha256(decoded.decoded)
    } : {})
  };
}
