/**
 * Local SHA-256 of exact bytes in memory.
 * This is byte identity for this session, not authenticity.
 */

export const BYTE_IDENTITY_NOTICE =
  "SHA-256 of the exact bytes loaded in this session. Local byte identity only. Not authenticity, not chain of custody, not a timestamp authority, not legal proof.";

export function toUint8(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  throw new TypeError("hash input must be bytes");
}

export async function sha256Hex(bytes) {
  const buf = toUint8(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return hexFromBytes(new Uint8Array(digest));
}

export function hexFromBytes(bytes) {
  const b = toUint8(bytes);
  let out = "";
  for (let i = 0; i < b.length; i++) out += b[i].toString(16).padStart(2, "0");
  return out;
}

export function utf8Bytes(text) {
  return new TextEncoder().encode(String(text ?? ""));
}
