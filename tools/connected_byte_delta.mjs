/**
 * Exact binary deltas for connected runtimes and ordinary source handoffs.
 * No Node, filesystem, network, or external package dependency.
 *
 * const delta = createByteDeltaCodec({sha256, base64Encode, base64Decode});
 * const packet = delta.encode(originalBytes, completeCurrentBytes);
 * const complete = delta.decode(originalBytes, packet);
 *
 * Transfer the packet alongside an identified, retained original.
 * decode verifies both original and reconstructed SHA256 and byte lengths.
 * A packet is a transport encoding: retain the complete reconstructed file
 * at its ordinary destination.
 */
export function createByteDeltaCodec(codec, options = {}) {
  for (const name of ['sha256', 'base64Encode', 'base64Decode'])
    if (typeof codec?.[name] !== 'function') throw new TypeError('Missing codec: ' + name);
  const limit = options.maxBytes ?? 128 * 1024 * 1024;
  const block = options.blockBytes ?? 64;
  const candidates = options.maxCandidates ?? 8;
  const maxSegments = options.maxSegments ?? 1000000;
  const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
  if (!integer(limit, 0, 1024 * 1024 * 1024) || !integer(block, 8, 4096) ||
      !integer(candidates, 1, 64) || !integer(maxSegments, 1, 1000000))
    throw new RangeError('Invalid byte delta limits');
  const fail = m => { throw new Error('byte-delta: ' + m); };
  const bytes = v => {
    if (!(v instanceof Uint8Array)) fail('Expected Uint8Array');
    if (v.length > limit) fail('Input exceeds byte limit');
    return v;
  };
  const identity = b => ({ bytes: b.length, sha256: codec.sha256(b) });
  const check = (b, id, label) => {
    if (!id || id.bytes !== b.length || !/^[a-f0-9]{64}$/.test(id.sha256 || '') ||
        codec.sha256(b) !== id.sha256) fail(label + ' identity differs');
  };
  const hashAt = (b, at) => {
    let h = 0;
    for (let j = 0; j < block; j++) h = (Math.imul(h, 257) + b[at + j]) >>> 0;
    return h;
  };
  let power = 1;
  for (let j = 1; j < block; j++) power = Math.imul(power, 257) >>> 0;
  const schema = 'commons.byte-delta.v1';
  function encode(baseInput, targetInput) {
    const base = bytes(baseInput), target = bytes(targetInput);
    const packet = { schema, base: identity(base), target: identity(target), mode: 'segments', segments: [] };
    const full = () => ({ schema, base: packet.base, target: packet.target,
      mode: 'full', data_base64: codec.base64Encode(target) });
    const index = new Map();
    for (let at = 0; at + block <= base.length; at += block) {
      const h = hashAt(base, at), list = index.get(h);
      if (!list) index.set(h, [at]);
      else if (list.length < candidates) list.push(at);
    }
    let cursor = 0, literalStart = 0, rolling = target.length >= block ? hashAt(target, 0) : 0;
    const literal = end => {
      if (end > literalStart) packet.segments.push({ data_base64: codec.base64Encode(target.subarray(literalStart, end)) });
    };
    while (cursor + block <= target.length) {
      let bestAt = 0, bestLength = 0;
      for (const at of index.get(rolling) || []) {
        let n = 0;
        while (n < block && base[at + n] === target[cursor + n]) n++;
        if (n !== block) continue;
        while (at + n < base.length && cursor + n < target.length &&
               base[at + n] === target[cursor + n]) n++;
        if (n > bestLength) { bestAt = at; bestLength = n; }
      }
      if (bestLength) {
        literal(cursor);
        const last = packet.segments[packet.segments.length - 1];
        if (last?.copy && last.copy[0] + last.copy[1] === bestAt) last.copy[1] += bestLength;
        else packet.segments.push({ copy: [bestAt, bestLength] });
        cursor += bestLength;
        literalStart = cursor;
        if (cursor + block <= target.length) rolling = hashAt(target, cursor);
      } else {
        rolling = (Math.imul((rolling - Math.imul(target[cursor], power)) >>> 0, 257) +
          (target[cursor + block] || 0)) >>> 0;
        cursor++;
      }
      if (packet.segments.length >= maxSegments) return full();
    }
    literal(target.length);
    const plain = full();
    return JSON.stringify(packet).length < JSON.stringify(plain).length ? packet : plain;
  }
  function decode(baseInput, packet) {
    const base = bytes(baseInput);
    if (!packet || packet.schema !== schema) fail('Unknown packet schema');
    check(base, packet.base, 'Original');
    if (!packet.target || !integer(packet.target.bytes, 0, limit) ||
        !/^[a-f0-9]{64}$/.test(packet.target.sha256 || '')) fail('Invalid target identity');
    if (packet.mode === 'full') {
      if (typeof packet.data_base64 !== 'string' ||
          packet.data_base64.length > 4 * Math.ceil(packet.target.bytes / 3))
        fail('Invalid full payload');
      const out = bytes(codec.base64Decode(packet.data_base64));
      check(out, packet.target, 'Target');
      return out;
    }
    if (packet.mode !== 'segments' || !Array.isArray(packet.segments) ||
        packet.segments.length > maxSegments) fail('Invalid segment list');
    const out = new Uint8Array(packet.target.bytes);
    let at = 0;
    for (const part of packet.segments) {
      if (!part || typeof part !== 'object') fail('Invalid segment');
      const copy = Object.prototype.hasOwnProperty.call(part, 'copy');
      const data = Object.prototype.hasOwnProperty.call(part, 'data_base64');
      if (copy === data) fail('Segment must contain exactly one operation');
      if (copy) {
        if (!Array.isArray(part.copy) || part.copy.length !== 2 ||
            !integer(part.copy[0], 0, base.length) || !integer(part.copy[1], 1, base.length) ||
            part.copy[0] + part.copy[1] > base.length ||
            at + part.copy[1] > out.length) fail('Invalid copy range');
        out.set(base.subarray(part.copy[0], part.copy[0] + part.copy[1]), at);
        at += part.copy[1];
      } else {
        if (typeof part.data_base64 !== 'string' ||
            part.data_base64.length > 4 * Math.ceil((out.length - at) / 3))
          fail('Invalid literal payload');
        const literal = bytes(codec.base64Decode(part.data_base64));
        if (!literal.length || at + literal.length > out.length) fail('Invalid literal length');
        out.set(literal, at); at += literal.length;
      }
    }
    if (at !== out.length) fail('Incomplete target');
    check(out, packet.target, 'Target');
    return out;
  }
  return { encode, decode, schema };
}
