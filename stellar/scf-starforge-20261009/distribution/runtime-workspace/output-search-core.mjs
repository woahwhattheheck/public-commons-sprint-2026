// MIT. Literal UTF-8 search over one original fixed-end output selection.
// No filesystem, Buffer, decoder or host dependency. read() owns source validation.
const MAX_BYTES = 8 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;
const continuation = value => value >= 0x80 && value <= 0xbf;
function integer(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new RangeError(name + " must be a safe integer from " + minimum + " through " + maximum + ".");
  return value;
}
function utf8Literal(value) {
  if (!(value instanceof Uint8Array)) throw new TypeError("needle must contain the original UTF-8 bytes.");
  integer(value.length, "needle byte length", 1, 4096);
  const bytes = value.slice();
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i++];
    if (first <= 0x7f) continue;
    let following, low = 0x80, high = 0xbf;
    if (first >= 0xc2 && first <= 0xdf) following = 1;
    else if (first >= 0xe0 && first <= 0xef) {
      following = 2;
      if (first === 0xe0) low = 0xa0;
      if (first === 0xed) high = 0x9f;
    } else if (first >= 0xf0 && first <= 0xf4) {
      following = 3;
      if (first === 0xf0) low = 0x90;
      if (first === 0xf4) high = 0x8f;
    } else throw new TypeError("needle must be valid UTF-8.");
    if (i + following > bytes.length || bytes[i] < low || bytes[i] > high)
      throw new TypeError("needle must be valid UTF-8.");
    for (let j = 1; j < following; j++)
      if (!continuation(bytes[i + j])) throw new TypeError("needle must be valid UTF-8.");
    i += following;
  }
  return bytes;
}
function failureTable(needle) {
  const table = new Int32Array(needle.length);
  for (let i = 1, matched = 0; i < needle.length; i++) {
    while (matched && needle[i] !== needle[matched]) matched = table[matched - 1];
    if (needle[i] === needle[matched]) matched++;
    table[i] = matched;
  }
  return table;
}
/**
 * Search every literal occurrence, including overlapping matches.
 *
 * All positions and lengths are original byte coordinates. offset is the NEXT
 * CANDIDATE START, not the end of the last physical read. Pass nextOffset back
 * unchanged with the same selected source and needle. A scan-budget boundary
 * deliberately rereads at most needle.length - 1 bytes on continuation.
 *
 * maxBytes limits bytes examined for matching in this call and must fit one
 * complete needle. Context reads are additional, bounded by limit/contextBytes.
 * The context of valid UTF-8 expands at most three bytes at either edge; malformed
 * source bytes remain unmodified. The wrapper decides how to display those bytes.
 *
 * read(offset, length) must return exactly that original range as Uint8Array.
 * Short reads, a different source or a changed fixed-end selection belong to the
 * original reader's error path. This core never manufactures missing bytes.
 */
export async function scanOutputSelection({
  read, endOffset, offset = 0, needle, limit = 100,
  maxBytes = MAX_BYTES, contextBytes = 96
} = {}) {
  if (typeof read !== "function") throw new TypeError("read must be the original selected range reader.");
  integer(endOffset, "endOffset", 0, Number.MAX_SAFE_INTEGER);
  integer(offset, "offset", 0, endOffset);
  integer(limit, "limit", 1, 200);
  integer(contextBytes, "contextBytes", 0, 4096);
  const literal = utf8Literal(needle), size = literal.length;
  integer(maxBytes, "maxBytes", size, MAX_BYTES);
  if (endOffset - offset < size)
    return { matches: [], nextOffset: endOffset, done: true, scannedBytes: 0 };

  async function exact(start, length) {
    const bytes = await read(start, length);
    if (!(bytes instanceof Uint8Array) || bytes.length !== length)
      throw new Error("The original selected output range did not return its exact requested bytes.");
    return bytes;
  }
  const table = failureTable(literal);
  const readEnd = offset + Math.min(maxBytes, endOffset - offset);
  const positions = [];
  let cursor = offset, matched = 0, scannedBytes = 0, stopped = false;
  let nextOffset = readEnd - size + 1;
  while (cursor < readEnd && !stopped) {
    const length = Math.min(CHUNK_BYTES, readEnd - cursor);
    const chunk = await exact(cursor, length);
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i];
      while (matched && byte !== literal[matched]) matched = table[matched - 1];
      if (byte === literal[matched]) matched++;
      scannedBytes++;
      if (matched === size) {
        const after = cursor + i + 1, start = after - size;
        positions.push({ offset: start, endOffset: after });
        matched = table[matched - 1];
        if (positions.length === limit) {
          nextOffset = start + 1;
          stopped = true;
          break;
        }
      }
    }
    cursor += length;
  }
  const done = nextOffset > endOffset - size;
  if (done) nextOffset = endOffset;
  const matches = [];
  for (const position of positions) {
    const wantedStart = position.offset - Math.min(contextBytes, position.offset);
    const wantedEnd = position.endOffset + Math.min(contextBytes, endOffset - position.endOffset);
    const start = wantedStart - Math.min(3, wantedStart);
    const end = wantedEnd + Math.min(3, endOffset - wantedEnd);
    const bytes = await exact(start, end - start);
    let left = wantedStart - start, right = wantedEnd - start;
    while (left > 0 && continuation(bytes[left])) left--;
    while (right < bytes.length && continuation(bytes[right])) right++;
    matches.push({ ...position,
      context: { offset: start + left, endOffset: start + right, bytes: bytes.slice(left, right) } });
  }
  return { matches, nextOffset, done, scannedBytes };
}
