/** Standalone comparison rendering. Compression is optional; complete original packets stay unchanged. */
export const COMPACT_SCHEMA = "source-comparison-gzip/1";
export const MAX_COMPARISON_BYTES = 128 * 1024 * 1024;
const marker = "__CMS_COMPARISON_SOURCE__";
function bytes(value, label) {
  if (!(value instanceof Uint8Array)) throw Error(label + " must return bytes");
  return value;
}
function base64(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let answer = "";
  for (let i = 0; i < value.length; i += 3) {
    const v = (value[i] << 16) | ((value[i + 1] || 0) << 8) | (value[i + 2] || 0);
    answer += alphabet[v >>> 18] + alphabet[(v >>> 12) & 63] +
      (i + 1 < value.length ? alphabet[(v >>> 6) & 63] : "=") +
      (i + 2 < value.length ? alphabet[v & 63] : "=");
  }
  return answer;
}
/**
 * Supply synchronous gzip(bytes), gunzip(bytes), sha256(bytes) for compact output.
 * The native CLI uses node:zlib and node:crypto. An ordinary render needs no codec.
 */
export function renderComparisonHtml(template, packet, options = {}) {
  if (typeof template !== "string" || template.split(marker).length !== 2)
    throw Error("Comparison template marker differs");
  if (!packet || packet.schema !== "source-comparison-bundle/1" || !packet.before || !packet.after)
    throw Error("Use a complete comparison bundle");
  let embedded = packet;
  if (options.compact) {
    if (!template.includes('source-comparison-gzip/1'))
      throw Error("This comparison template does not support compact sources");
    if (![options.gzip, options.gunzip, options.sha256].every(v => typeof v === "function"))
      throw Error("Compact rendering requires gzip, gunzip and SHA-256");
    const original = new TextEncoder().encode(JSON.stringify(packet));
    if (original.byteLength > MAX_COMPARISON_BYTES)
      throw Error("Compact source exceeds the 128 MiB receiving limit; use ordinary rendering");
    const compressed = bytes(options.gzip(original), "gzip");
    const reopened = bytes(options.gunzip(compressed), "gunzip");
    if (original.byteLength !== reopened.byteLength || !original.every((v, i) => v === reopened[i]))
      throw Error("Compressed comparison did not reopen byte for byte");
    const sourceSha = options.sha256(original), gzipSha = options.sha256(compressed);
    if (![sourceSha, gzipSha].every(v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v)))
      throw Error("SHA-256 must return a lowercase hexadecimal digest");
    embedded = {schema: COMPACT_SCHEMA, encoding: "gzip+base64",
      source_bytes: original.byteLength, source_sha256: sourceSha,
      gzip_bytes: compressed.byteLength, gzip_sha256: gzipSha, data: base64(compressed)};
  }
  return template.replace(marker, JSON.stringify(embedded).replaceAll("<", "\\u003c"));
}
