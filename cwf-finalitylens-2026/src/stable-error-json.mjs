/** Deterministic canonical JSON for Solana RPC execution-error fingerprints.
 * JSON object member order is irrelevant; array order is not. Body is already
 * capped by the RPC stream reader, but bound depth/visits as a second gate.
 */
export function stableErrorJson(value) {
  const seen = new WeakSet();
  let nodes = 0;
  function canonical(v, depth) {
    if (depth > 48 || ++nodes > 32768) throw new TypeError('RPC error JSON exceeds canonicalization limits');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v !== 'object') throw new TypeError('Unsupported RPC error JSON value');
    if (seen.has(v)) throw new TypeError('Cyclic RPC error JSON');
    seen.add(v);
    try {
      if (Array.isArray(v)) return v.map(item => canonical(item, depth + 1));
      const output = Object.create(null);
      for (const key of Object.keys(v).sort()) {
        output[key] = canonical(v[key], depth + 1);
      }
      return output;
    } finally {
      seen.delete(v);
    }
  }
  return JSON.stringify(canonical(value, 0));
}
