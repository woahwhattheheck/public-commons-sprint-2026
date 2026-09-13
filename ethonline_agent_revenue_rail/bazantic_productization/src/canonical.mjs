import { createHash } from 'node:crypto';
function normalize(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('canonical JSON accepts finite numbers only'); return Object.is(value, -0) ? 0 : value; }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') { const out={}; for (const key of Object.keys(value).sort()) { const v=value[key]; if (v!==undefined) out[key]=normalize(v); } return out; }
  throw new TypeError(`unsupported canonical value type: ${typeof value}`);
}
export const canonicalJson = (value) => JSON.stringify(normalize(value));
export function sha256Hex(value) { const bytes=typeof value==='string'?value:canonicalJson(value); return createHash('sha256').update(bytes,'utf8').digest('hex'); }
export const isSha256Hex = (value) => typeof value==='string' && /^[0-9a-f]{64}$/.test(value);
