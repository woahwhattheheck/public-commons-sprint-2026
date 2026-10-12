// MIT. Dependency-free facilitator-to-resource-server extension transport.
export const HEADER_NAME = 'EXTENSION-RESPONSES';
export const MAX_HEADER_BYTES = 16_384;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const STATUS_KEY = /^[a-z][a-z0-9_-]{0,63}$/;

/** Keep a trusted upstream sidechannel only when its original base64 JSON is valid. */
export function validatedExtensionResponsesHeader(value) {
  if (typeof value !== 'string' || !value || value.length > 4 * Math.ceil(MAX_HEADER_BYTES / 3) ||
      value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;
  try {
    const bytes = Buffer.from(value,'base64');
    if (bytes.length > MAX_HEADER_BYTES || bytes.toString('base64') !== value) return null;
    const fields = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if (!plain(fields) || !Object.keys(fields).length ||
        Object.keys(fields).some(key => !STATUS_KEY.test(key))) return null;
    return value;
  } catch { return null; }
}

