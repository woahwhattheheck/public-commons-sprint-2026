'use strict';

// Complete source bytes for connected sessions and native receiving.
// Provider framing, acquisition, message identity and publication stay with
// connected_public_source and connected_source_reconciliation.
const BYTES_SCHEMA = 'commons.source_bytes/v1';
const BUNDLE_SCHEMA = 'commons.source_bundle/v1';
const PART_SCHEMA = 'commons.source_bytes_part/v1';
const DELTA_SCHEMA = 'commons.exact-byte-delta/v1';
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw TypeError(label + ' must be an object');
  return value;
}
function uint(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw RangeError(label + ' must be a nonnegative safe integer within ' + maximum);
  return value;
}
function byteArray(value) {
  if (!(value instanceof Uint8Array)) throw TypeError('Source bytes must be Uint8Array');
  return value;
}
function digestText(value, label) {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value)) throw TypeError(label + ' must be a full SHA-256 digest');
  return value.toLowerCase();
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
function equal(a, b) { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); }

function utf8(text) {
  if (typeof text !== 'string') throw TypeError('UTF-8 input must be a string');
  let length = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 128) length++;
    else if (c < 2048) length += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      const d = text.charCodeAt(++i);
      if (!(d >= 0xdc00 && d <= 0xdfff)) throw TypeError('Unpaired UTF-16 surrogate');
      length += 4;
    } else {
      if (c >= 0xdc00 && c <= 0xdfff) throw TypeError('Unpaired UTF-16 surrogate');
      length += 3;
    }
  }
  const result = new Uint8Array(length);
  let at = 0;
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c < 128) result[at++] = c;
    else if (c < 2048) { result[at++] = 0xc0 | c >>> 6; result[at++] = 0x80 | c & 63; }
    else if (c >= 0xd800 && c <= 0xdbff) {
      c = 0x10000 + ((c - 0xd800) << 10) + text.charCodeAt(++i) - 0xdc00;
      result[at++] = 0xf0 | c >>> 18; result[at++] = 0x80 | c >>> 12 & 63;
      result[at++] = 0x80 | c >>> 6 & 63; result[at++] = 0x80 | c & 63;
    } else {
      result[at++] = 0xe0 | c >>> 12; result[at++] = 0x80 | c >>> 6 & 63; result[at++] = 0x80 | c & 63;
    }
  }
  return result;
}
function textUtf8(input) {
  const bytes = byteArray(input), chunks = [], units = [];
  function append(value) {
    if (value > 65535) { value -= 65536; units.push(0xd800 | value >>> 10, 0xdc00 | value & 1023); }
    else units.push(value);
    if (units.length >= 4096) { chunks.push(String.fromCharCode.apply(null, units)); units.length = 0; }
  }
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i++];
    if (first < 128) { append(first); continue; }
    let count, value, minimum;
    if (first >= 0xc2 && first <= 0xdf) { count = 1; value = first & 31; minimum = 0x80; }
    else if (first >= 0xe0 && first <= 0xef) { count = 2; value = first & 15; minimum = 0x800; }
    else if (first >= 0xf0 && first <= 0xf4) { count = 3; value = first & 7; minimum = 0x10000; }
    else throw TypeError('Invalid UTF-8 leading byte at ' + (i - 1));
    if (i + count > bytes.length) throw TypeError('Truncated UTF-8 sequence');
    while (count--) {
      const next = bytes[i++];
      if ((next & 0xc0) !== 0x80) throw TypeError('Invalid UTF-8 continuation byte at ' + (i - 1));
      value = value * 64 + (next & 63);
    }
    if (value < minimum || value > 0x10ffff || value >= 0xd800 && value <= 0xdfff) throw TypeError('Invalid UTF-8 scalar');
    append(value);
  }
  if (units.length) chunks.push(String.fromCharCode.apply(null, units));
  return chunks.join('');
}
function fromBase64(value) {
  if (typeof value !== 'string') throw TypeError('Base64 input must be a string');
  const text = value.replace(/[ \t\r\n]/g, '');
  if (text.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw TypeError('Expected complete padded standard base64');
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  if (padding && text.length < 4) throw TypeError('Invalid base64 padding');
  const result = new Uint8Array(text.length / 4 * 3 - padding);
  let at = 0;
  for (let i = 0; i < text.length; i += 4) {
    const a = alphabet.indexOf(text[i]), b = alphabet.indexOf(text[i + 1]);
    const c = text[i + 2] === '=' ? 0 : alphabet.indexOf(text[i + 2]);
    const d = text[i + 3] === '=' ? 0 : alphabet.indexOf(text[i + 3]);
    if (a < 0 || b < 0 || c < 0 || d < 0) throw TypeError('Invalid base64 quartet');
    if (i + 4 === text.length && (padding === 2 && b & 15 || padding === 1 && c & 3)) throw TypeError('Nonzero base64 padding bits');
    const n = a << 18 | b << 12 | c << 6 | d;
    if (at < result.length) result[at++] = n >>> 16 & 255;
    if (at < result.length) result[at++] = n >>> 8 & 255;
    if (at < result.length) result[at++] = n & 255;
  }
  return result;
}
function toBase64(input) {
  const bytes = byteArray(input), chunks = [];
  let text = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = bytes[i] << 16 | (bytes[i + 1] || 0) << 8 | (bytes[i + 2] || 0);
    text += alphabet[n >>> 18 & 63] + alphabet[n >>> 12 & 63]
      + (i + 1 < bytes.length ? alphabet[n >>> 6 & 63] : '=')
      + (i + 2 < bytes.length ? alphabet[n & 63] : '=');
    if (text.length >= 16384) { chunks.push(text); text = ''; }
  }
  chunks.push(text);
  return chunks.join('');
}
function concatenate(parts, maximum = DEFAULT_MAX_BYTES) {
  let size = 0;
  for (const part of parts) size = uint(size + byteArray(part).length, 'Combined byte length', maximum);
  const output = new Uint8Array(size);
  let at = 0;
  for (const part of parts) { output.set(part, at); at += part.length; }
  return output;
}

function unpackLz77(input, expectedBytes, maximum = DEFAULT_MAX_BYTES) {
  const bytes = byteArray(input);
  const output = new Uint8Array(uint(expectedBytes, 'LZ77 output length', maximum));
  let at = 0, used = 0;
  while (at < bytes.length) {
    const tag = bytes[at++];
    if (tag < 128) {
      const length = tag + 1;
      if (at + length > bytes.length || used + length > output.length) throw RangeError('LZ77 literal exceeds source or output');
      output.set(bytes.subarray(at, at + length), used); at += length; used += length;
    } else {
      if (at + 2 > bytes.length) throw RangeError('Truncated LZ77 distance');
      const length = tag - 128 + 3, distance = bytes[at++] * 256 + bytes[at++];
      if (!distance || distance > used || used + length > output.length) throw RangeError('Invalid LZ77 back-reference');
      for (let i = 0; i < length; i++) { output[used] = output[used - distance]; used++; }
    }
  }
  if (used !== output.length) throw RangeError('LZ77 output length mismatch');
  return output;
}
function packLz77(input) {
  const bytes = byteArray(input), output = [], literal = [];
  const head = new Int32Array(65536), previous = new Int32Array(65536);
  head.fill(-1); previous.fill(-1);
  const key = i => ((bytes[i] * 251 + bytes[i + 1]) * 251 + bytes[i + 2]) & 65535;
  function add(i) {
    if (i + 2 >= bytes.length) return;
    const k = key(i); previous[i & 65535] = head[k]; head[k] = i;
  }
  function flush() {
    if (literal.length) { output.push(literal.length - 1); for (const b of literal) output.push(b); literal.length = 0; }
  }
  for (let at = 0; at < bytes.length;) {
    let length = 0, distance = 0;
    if (at + 2 < bytes.length) {
      let candidate = head[key(at)], budget = 32;
      while (candidate >= 0 && at - candidate <= 65535 && budget--) {
        let n = 0;
        while (n < 130 && at + n < bytes.length && bytes[candidate + n] === bytes[at + n]) n++;
        if (n > length) { length = n; distance = at - candidate; if (n === 130) break; }
        candidate = previous[candidate & 65535];
      }
    }
    if (length >= 3) {
      flush(); output.push(128 + length - 3, distance >>> 8, distance & 255);
      for (let i = 0; i < length; i++) add(at + i);
      at += length;
    } else { literal.push(bytes[at]); add(at++); if (literal.length === 128) flush(); }
  }
  flush();
  return Uint8Array.from(output);
}

const crcTable = Uint32Array.from({length: 256}, (_, value) => {
  for (let i = 0; i < 8; i++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const b of bytes) value = value >>> 8 ^ crcTable[(value ^ b) & 255];
  return (value ^ 0xffffffff) >>> 0;
}

// RFC 1951 blocks and RFC 1952 members. No Node, browser or native codec is required.
function decodeGzip(input, maximum = DEFAULT_MAX_BYTES) {
  const bytes = byteArray(input), members = [];
  uint(maximum, 'Maximum gzip output', 0x7fffffff);
  let position = 0, total = 0;
  const n = bytes.length;
  const u32 = i => (bytes[i] | bytes[i + 1] << 8 | bytes[i + 2] << 16 | bytes[i + 3] << 24) >>> 0;
  if (!n) throw TypeError('Empty gzip source');
  while (position < n) {
    const start = position;
    function need(i, count) { if (i + count > n) throw RangeError('Truncated gzip header or payload'); }
    need(position, 18);
    if (bytes[position] !== 31 || bytes[position + 1] !== 139 || bytes[position + 2] !== 8) throw TypeError('Expected gzip DEFLATE member');
    const flags = bytes[position + 3];
    if (flags & 224) throw TypeError('Reserved gzip flags');
    position += 10;
    if (flags & 4) { need(position, 2); const length = bytes[position] | bytes[position + 1] << 8; position += 2; need(position, length); position += length; }
    for (const flag of [8, 16]) if (flags & flag) { do { need(position, 1); } while (bytes[position++] !== 0); }
    if (flags & 2) {
      need(position, 2);
      if ((crc32(bytes.subarray(start, position)) & 65535) !== (bytes[position] | bytes[position + 1] << 8)) throw TypeError('Gzip header CRC mismatch');
      position += 2;
    }
    const remaining = maximum - total;
    let output = new Uint8Array(Math.min(65536, remaining)), used = 0, bit = position * 8;
    function read(count) {
      if (bit + count > n * 8) throw RangeError('Truncated DEFLATE stream');
      let value = 0;
      for (let i = 0; i < count; i++, bit++) value |= (bytes[Math.floor(bit / 8)] >>> (bit % 8) & 1) << i;
      return value;
    }
    function emit(value) {
      if (used >= remaining) throw RangeError('Gzip output exceeds maximum');
      if (used === output.length) {
        const grown = new Uint8Array(Math.min(remaining, Math.max(1, output.length * 2)));
        grown.set(output); output = grown;
      }
      output[used++] = value;
    }
    function tree(lengths) {
      const counts = new Uint16Array(16), next = new Uint16Array(16);
      let max = 0, code = 0;
      for (const length of lengths) {
        if (!Number.isInteger(length) || length < 0 || length > 15) throw TypeError('Invalid Huffman code length');
        if (length) { counts[length]++; max = Math.max(max, length); }
      }
      for (let length = 1; length <= 15; length++) {
        code = (code + counts[length - 1]) * 2;
        if (code + counts[length] > 1 << length) throw TypeError('Oversubscribed Huffman tree');
        next[length] = code;
      }
      const map = new Map();
      for (let value = 0; value < lengths.length; value++) {
        const length = lengths[value]; if (!length) continue;
        let c = next[length]++, reverse = 0;
        for (let i = 0; i < length; i++) { reverse = reverse << 1 | c & 1; c >>>= 1; }
        map.set(length << 16 | reverse, value);
      }
      return {map, max};
    }
    function symbol(t) {
      let code = 0;
      for (let length = 1; length <= t.max; length++) {
        code |= read(1) << length - 1;
        const value = t.map.get(length << 16 | code);
        if (value !== undefined) return value;
      }
      throw TypeError('Invalid Huffman symbol');
    }
    const lengthBase = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
    const lengthExtra = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
    const distanceBase = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
    const distanceExtra = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
    let final = 0;
    while (!final) {
      final = read(1);
      const kind = read(2);
      if (kind === 0) {
        bit = Math.ceil(bit / 8) * 8;
        const length = read(16), inverse = read(16);
        if ((length ^ inverse) !== 65535) throw TypeError('Stored DEFLATE length mismatch');
        for (let i = 0; i < length; i++) emit(read(8));
        continue;
      }
      if (kind === 3) throw TypeError('Reserved DEFLATE block type');
      let literals, distances;
      if (kind === 1) {
        literals = tree(Array.from({length: 288}, (_, i) => i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8));
        distances = tree(Array(32).fill(5));
      } else {
        const nl = read(5) + 257, nd = read(5) + 1, nc = read(4) + 4;
        if (nl > 286) throw TypeError('Invalid literal alphabet length');
        const order = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15], lengths = Array(19).fill(0);
        for (let i = 0; i < nc; i++) lengths[order[i]] = read(3);
        const codeTree = tree(lengths), all = [];
        while (all.length < nl + nd) {
          const value = symbol(codeTree);
          if (value <= 15) { all.push(value); continue; }
          let count, repeated = 0;
          if (value === 16) {
            if (!all.length) throw TypeError('Huffman repeat without previous length');
            repeated = all[all.length - 1]; count = read(2) + 3;
          } else if (value === 17) count = read(3) + 3;
          else if (value === 18) count = read(7) + 11;
          else throw TypeError('Invalid code-length symbol');
          if (all.length + count > nl + nd) throw TypeError('Huffman repeat exceeds alphabet');
          while (count--) all.push(repeated);
        }
        if (!all[256]) throw TypeError('Missing DEFLATE end symbol');
        literals = tree(all.slice(0, nl)); distances = tree(all.slice(nl));
      }
      while (true) {
        const value = symbol(literals);
        if (value < 256) { emit(value); continue; }
        if (value === 256) break;
        if (value > 285) throw TypeError('Reserved DEFLATE length symbol');
        const li = value - 257, length = lengthBase[li] + read(lengthExtra[li]);
        const di = symbol(distances);
        if (di > 29) throw TypeError('Reserved DEFLATE distance symbol');
        const distance = distanceBase[di] + read(distanceExtra[di]);
        if (distance > used) throw RangeError('DEFLATE distance exceeds output');
        for (let i = 0; i < length; i++) emit(output[used - distance]);
      }
    }
    position = Math.ceil(bit / 8);
    need(position, 8);
    const member = output.slice(0, used);
    if (used !== u32(position + 4)) throw TypeError('Gzip ISIZE mismatch');
    if (crc32(member) !== u32(position)) throw TypeError('Gzip payload CRC mismatch');
    members.push(member); total += used; position += 8;
  }
  return concatenate(members, maximum);
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\')
    || value.startsWith('/') || /^[A-Za-z]:/.test(value)
    || value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw TypeError('A source member must retain a relative POSIX file path');
  }
  return value;
}

function createSourceBytes(dependencies = {}, options = {}) {
  const hashBytes = dependencies.sha256Bytes ||
    (typeof require === 'function' ? require('./connected_sha256.cjs').sha256Bytes : null);
  if (typeof hashBytes !== 'function') throw TypeError('Supply maintained connected_sha256.sha256Bytes');
  const maximum = uint(options.maxBytes ?? DEFAULT_MAX_BYTES, 'Maximum output bytes', 0x7fffffff);
  function digest(input) {
    const bytes = byteArray(input), actual = hashBytes(bytes);
    if (!actual || actual.bytes !== bytes.length) throw TypeError('SHA-256 dependency returned a different byte length');
    return {bytes: bytes.length, sha256: digestText(actual.sha256, 'Computed SHA-256')};
  }
  function verify(input, expected = {}) {
    const bytes = byteArray(input);
    uint(bytes.length, 'Source byte length', maximum);
    object(expected, 'Expected byte identity');
    const actual = digest(bytes);
    if (expected.bytes !== undefined && uint(expected.bytes, 'Expected byte length', maximum) !== actual.bytes) throw RangeError('Source byte length mismatch');
    if (expected.sha256 !== undefined && digestText(expected.sha256, 'Expected SHA-256') !== actual.sha256) throw TypeError('Source SHA-256 mismatch');
    return {data: bytes, ...actual};
  }
  function decode(envelope) {
    object(envelope, 'Source envelope');
    const {encoding, data} = envelope;
    let output;
    if (encoding === 'utf8') output = utf8(data);
    else if (encoding === 'base64') output = fromBase64(data);
    else if (encoding === 'gzip+base64') output = decodeGzip(fromBase64(data), maximum);
    else if (encoding === 'commons-lz77-v1+base64' || encoding === 'lz77-byte-v1') output = unpackLz77(fromBase64(data), envelope.bytes, maximum);
    else throw TypeError('Select utf8, base64, gzip+base64 or commons-lz77-v1+base64');
    return verify(output, envelope);
  }
  function encode(input, encoding = 'commons-lz77-v1+base64') {
    const actual = verify(input);
    let data;
    if (encoding === 'utf8') data = textUtf8(actual.data);
    else if (encoding === 'base64') data = toBase64(actual.data);
    else if (encoding === 'commons-lz77-v1+base64' || encoding === 'lz77-byte-v1') data = toBase64(packLz77(actual.data));
    else throw TypeError('Portable encoding supports utf8, base64 and commons-lz77-v1+base64');
    return {schema: BYTES_SCHEMA, encoding, bytes: actual.bytes, sha256: actual.sha256, data};
  }
  function split(envelope, partCharacters = 60000, metadata = {}) {
    decode(envelope);
    uint(partCharacters, 'Part character length', maximum);
    if (partCharacters < 4) throw RangeError('Part length must be at least four characters');
    if (envelope.encoding === 'utf8') throw TypeError('Split an encoded byte stream, preserving Unicode across transport');
    object(metadata, 'Original part metadata');
    for (const key of ['schema', 'part', 'parts', 'file', 'data']) if (own(metadata, key)) throw TypeError('Part metadata conflicts with ' + key);
    const parts = Math.max(1, Math.ceil(envelope.data.length / partCharacters));
    const file = {encoding: envelope.encoding, bytes: envelope.bytes, sha256: envelope.sha256};
    return Array.from({length: parts}, (_, index) => ({
      ...metadata, schema: PART_SCHEMA, part: index + 1, parts, file,
      data: envelope.data.slice(index * partCharacters, (index + 1) * partCharacters),
    }));
  }
  function assemble(parts) {
    if (!Array.isArray(parts) || !parts.length) throw TypeError('Supply every complete multipart source record');
    const first = object(parts[0], 'Source part'), count = uint(first.parts, 'Declared part count', maximum);
    if (!count || parts.length !== count) throw RangeError('Missing or surplus source parts');
    const identity = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'part' && key !== 'data'));
    const original = identity(first), selected = new Map();
    for (const part of parts) {
      object(part, 'Source part');
      if (!equal(identity(part), original)) throw TypeError('Multipart records identify different source revisions');
      const number = uint(part.part, 'Part number', count);
      if (!number || selected.has(number) || typeof part.data !== 'string') throw TypeError('Missing, duplicate or invalid source part');
      selected.set(number, part.data);
    }
    const data = Array.from({length: count}, (_, index) => selected.get(index + 1)).join('');
    if (first.file.encoding === 'utf8') throw TypeError('Multipart receiving expects an encoded byte stream');
    const decoded = decode({...object(first.file, 'Multipart file identity'), data});
    return {...decoded, partCount: count, original};
  }
  function parseJson(input, expected = {}) {
    const source = verify(input, expected);
    return {...source, value: JSON.parse(textUtf8(source.data))};
  }
  function receiveBundle(input, selection = {}) {
    object(selection, 'Bundle selection');
    const source = input instanceof Uint8Array ? parseJson(input, selection.expected || {}) : null;
    const container = object(source ? source.value : input, 'Complete source container');
    const layout = selection.layout || (container.schema === BUNDLE_SCHEMA ? 'records' : null);
    if (!['text-map', 'records'].includes(layout)) throw TypeError('Select the documented text-map or records layout');
    const filesKey = selection.filesKey || 'files', originalFiles = container[filesKey];
    const fields = {path: 'path', content: 'content', encoding: 'encoding', bytes: 'bytes', sha256: 'sha256', ...(selection.fields || {})};
    const files = [], paths = new Set();
    let total = 0;
    function receive(path, content, record = null) {
      safeRelativePath(path);
      if (paths.has(path)) throw TypeError('Duplicate source member: ' + path);
      paths.add(path);
      let actual;
      if (record) {
        const envelope = {encoding: record[fields.encoding] || 'utf8', data: content};
        if (own(record, fields.bytes)) envelope.bytes = record[fields.bytes];
        if (own(record, fields.sha256)) envelope.sha256 = record[fields.sha256];
        actual = decode(envelope);
      } else actual = verify(utf8(content));
      total = uint(total + actual.bytes, 'Complete bundle bytes', maximum);
      const identity = {...(selection.sourceIdentity || {}), ...(selection.sourceIdentities?.[path] || {}),
        path, bytes: actual.bytes, sha256: actual.sha256};
      files.push({path, ...actual, identity});
    }
    if (layout === 'text-map') {
      object(originalFiles, 'Complete source file map');
      for (const [path, content] of Object.entries(originalFiles)) receive(path, content);
    } else {
      if (!Array.isArray(originalFiles)) throw TypeError('Complete source files must be an array');
      for (const record of originalFiles) {
        object(record, 'Source member record');
        receive(record[fields.path], record[fields.content], record);
      }
    }
    const countKey = selection.countKey || 'fileCount';
    if (own(container, countKey) && uint(container[countKey], 'Declared file count') !== files.length) throw RangeError('Source file count mismatch');
    const manifestKey = selection.manifestKey || 'manifest';
    const manifest = container[manifestKey];
    if (manifest !== undefined) {
      if (!Array.isArray(manifest) || manifest.length !== files.length) throw RangeError('Manifest does not identify every source member');
      const manifestFields = {path: 'path', bytes: 'bytes', sha256: 'sha256', ...(selection.manifestFields || {})};
      const observed = new Set(), byPath = new Map(files.map(file => [file.path, file]));
      for (const row of manifest) {
        object(row, 'Manifest member');
        const path = row[manifestFields.path], actual = byPath.get(path);
        if (!actual || observed.has(path)) throw TypeError('Manifest contains an unknown or duplicate member: ' + path);
        observed.add(path);
        verify(actual.data, {bytes: row[manifestFields.bytes], sha256: row[manifestFields.sha256]});
      }
    }
    return {
      schema: 'commons.received_source_bundle/v1', containerSchema: container.schema ?? null,
      ...(source ? {container: {bytes: source.bytes, sha256: source.sha256}} : {}),
      files, fileCount: files.length, bytes: total, manifest: files.map(file => ({path: file.path, bytes: file.bytes, sha256: file.sha256})),
      ...(manifest !== undefined ? {originalManifest: manifest} : {}),
    };
  }
  function makeBundle(files, metadata = {}) {
    if (!Array.isArray(files)) throw TypeError('Supply complete source files');
    object(metadata, 'Bundle metadata');
    for (const key of ['schema', 'files', 'manifest', 'fileCount']) if (own(metadata, key)) throw TypeError('Bundle metadata conflicts with ' + key);
    const records = files.map(file => {
      object(file, 'Source member');
      const data = file.data !== undefined ? byteArray(file.data) : utf8(file.content);
      const actual = verify(data), encoding = file.encoding || 'base64';
      const encoded = encode(data, encoding);
      return {path: safeRelativePath(file.path), encoding, content: encoded.data, bytes: actual.bytes, sha256: actual.sha256};
    });
    const bundle = {...metadata, schema: BUNDLE_SCHEMA, fileCount: records.length, files: records,
      manifest: records.map(({path, bytes, sha256}) => ({path, bytes, sha256}))};
    receiveBundle(bundle);
    return bundle;
  }
  function createDelta(baseInput, nextInput, metadata = {}) {
    const base = verify(baseInput), next = verify(nextInput), block = 16, buckets = new Map();
    object(metadata, 'Delta metadata');
    for (const key of ['schema', 'baseBytes', 'baseSha256', 'outputBytes', 'outputSha256', 'operations']) {
      if (own(metadata, key)) throw TypeError('Delta metadata conflicts with ' + key);
    }
    function key(bytes, index) {
      let value = 2166136261;
      for (let i = 0; i < block; i++) value = Math.imul(value ^ bytes[index + i], 16777619);
      return value >>> 0;
    }
    for (let i = 0; i + block <= base.bytes; i += 8) {
      const k = key(base.data, i), positions = buckets.get(k) || [];
      // Keep varied original offsets while bounding repetitive-source search.
      if (positions.length < 16) positions.push(i); else positions[(i >>> 3) % 16] = i;
      buckets.set(k, positions);
    }
    const operations = [];
    let literalStart = 0, at = 0;
    function literal(end) {
      if (end > literalStart) operations.push({literal: toBase64(next.data.subarray(literalStart, end))});
    }
    while (at < next.bytes) {
      let best = 0, offset = 0;
      if (at + block <= next.bytes) for (const candidate of buckets.get(key(next.data, at)) || []) {
        let length = 0;
        while (candidate + length < base.bytes && at + length < next.bytes && base.data[candidate + length] === next.data[at + length]) length++;
        if (length > best) { best = length; offset = candidate; }
      }
      if (best >= block) {
        literal(at);
        const previous = operations[operations.length - 1];
        if (previous?.copy && previous.copy[0] + previous.copy[1] === offset) previous.copy[1] += best;
        else operations.push({copy: [offset, best]});
        at += best; literalStart = at;
      } else at++;
    }
    literal(at);
    const delta = {...metadata, schema: DELTA_SCHEMA, baseBytes: base.bytes, baseSha256: base.sha256,
      outputBytes: next.bytes, outputSha256: next.sha256, operations};
    applyDelta(base.data, delta);
    return delta;
  }
  function applyDelta(baseInput, delta) {
    object(delta, 'Exact-byte delta');
    if (delta.schema !== DELTA_SCHEMA) throw TypeError('Expected ' + DELTA_SCHEMA);
    const base = verify(baseInput, {bytes: delta.baseBytes, sha256: delta.baseSha256});
    const size = uint(delta.outputBytes, 'Delta output length', maximum);
    digestText(delta.outputSha256, 'Delta output SHA-256');
    if (!Array.isArray(delta.operations)) throw TypeError('Delta operations must be an array');
    const output = new Uint8Array(size);
    let at = 0;
    for (const operation of delta.operations) {
      object(operation, 'Delta operation');
      const keys = Object.keys(operation);
      if (keys.length !== 1) throw TypeError('Each delta operation is exactly one copy or literal');
      let data;
      if (keys[0] === 'copy') {
        if (!Array.isArray(operation.copy) || operation.copy.length !== 2) throw TypeError('Copy is [byte offset, byte length]');
        const offset = uint(operation.copy[0], 'Copy offset', base.bytes), length = uint(operation.copy[1], 'Copy length', base.bytes);
        if (!length || offset + length > base.bytes) throw RangeError('Delta copy exceeds the exact base');
        data = base.data.subarray(offset, offset + length);
      } else if (keys[0] === 'literal') {
        data = fromBase64(operation.literal);
        if (!data.length) throw TypeError('Empty delta literal');
      } else throw TypeError('Unknown delta operation');
      if (at + data.length > size) throw RangeError('Delta exceeds declared output');
      output.set(data, at); at += data.length;
    }
    if (at !== size) throw RangeError('Delta output is incomplete');
    return verify(output, {bytes: size, sha256: delta.outputSha256});
  }
  return Object.freeze({digest, verify, encode, decode, split, assemble, parseJson, receiveBundle, makeBundle, createDelta, applyDelta,
    utf8, textUtf8, fromBase64, toBase64, packLz77, unpackLz77: (data, size) => unpackLz77(data, size, maximum),
    decodeGzip: data => decodeGzip(data, maximum), maxBytes: maximum});
}

async function main(argv) {
  const fs = require('node:fs'), path = require('node:path');
  let inputPath = '-', reportPath = null, maxBytes = DEFAULT_MAX_BYTES;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') {
      process.stdout.write('Usage: node host/connected_source_bytes.cjs --input JOB.json|- [--output REPORT.json] [--max-bytes N]\nActions: encode, decode, bundle, receive, delta-create, delta-apply\n');
      return 0;
    }
    if (!['--input', '--output', '--max-bytes'].includes(flag)) throw TypeError('Unknown option: ' + flag);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw TypeError('Missing value for ' + flag);
    if (flag === '--input') inputPath = value;
    else if (flag === '--output') reportPath = value;
    else maxBytes = Number(value);
  }
  const codec = createSourceBytes({}, {maxBytes});
  const readBytes = filename => Uint8Array.from(fs.readFileSync(filename));
  const readJson = filename => JSON.parse(codec.textUtf8(readBytes(filename)));
  const job = object(readJson(inputPath === '-' ? 0 : inputPath), 'Source byte job');
  const result = {schema: 'commons.source_bytes_operation/v1', action: job.action};
  if (job.operation_id !== undefined) result.operation_id = job.operation_id;
  function selected(name) {
    const inline = own(job, name), fromFile = own(job, name + '_path');
    if (inline === fromFile) throw TypeError('Supply exactly one ' + name + ' or ' + name + '_path');
    return inline ? job[name] : readJson(job[name + '_path']);
  }
  function decoded() {
    const options = ['envelope', 'parts', 'input'].filter(name => own(job, name) || own(job, name + '_path'));
    if (options.length !== 1) throw TypeError('Supply exactly one envelope, parts or input_path source');
    if (options[0] === 'envelope') return codec.decode(selected('envelope'));
    if (options[0] === 'parts') return codec.assemble(selected('parts'));
    if (own(job, 'input') || !own(job, 'input_path')) throw TypeError('Raw input uses input_path');
    return codec.verify(readBytes(job.input_path), job.expected || {});
  }
  function writeNew(filename, input) {
    const bytes = byteArray(input), absolute = path.resolve(filename);
    let fd;
    try { fd = fs.openSync(absolute, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const stat = fs.lstatSync(absolute);
      if (!stat.isFile() || stat.isSymbolicLink()) throw TypeError('Output exists and is not an original regular file: ' + absolute);
      const actual = codec.verify(readBytes(absolute), codec.digest(bytes));
      return {path: absolute, bytes: actual.bytes, sha256: actual.sha256, reused: true};
    }
    try {
      let at = 0;
      while (at < bytes.length) {
        const count = fs.writeSync(fd, bytes, at, bytes.length - at);
        if (!count) throw Error('Output write made no progress');
        at += count;
      }
      fs.fsyncSync(fd);
    } catch (error) {
      error.message += '; partial output retained at ' + absolute;
      throw error;
    } finally { fs.closeSync(fd); }
    const actual = codec.verify(readBytes(absolute), codec.digest(bytes));
    return {path: absolute, bytes: actual.bytes, sha256: actual.sha256, reused: false};
  }
  function writeJson(filename, value) { return writeNew(filename, codec.utf8(JSON.stringify(value, null, 2) + '\n')); }
  function materialize(bundle, destination) {
    const target = path.resolve(destination);
    if (fs.existsSync(target)) {
      if (!fs.lstatSync(target).isDirectory() || fs.lstatSync(target).isSymbolicLink()) throw TypeError('Receiving destination is not a regular directory');
      function list(directory, prefix = '') {
        const names = [];
        for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
          const name = prefix + entry.name;
          if (entry.isSymbolicLink()) throw TypeError('Receiving directory contains a symbolic link: ' + name);
          if (entry.isDirectory()) names.push(...list(path.join(directory, entry.name), name + '/'));
          else if (entry.isFile()) names.push(name);
          else throw TypeError('Receiving directory contains a non-file member: ' + name);
        }
        return names;
      }
      const found = list(target).sort(), expected = bundle.files.map(file => file.path).sort();
      if (!equal(found, expected)) throw TypeError('Existing receiving directory contains a different complete member set');
      for (const file of bundle.files) codec.verify(readBytes(path.join(target, file.path)), file);
      return {directory: target, reused: true};
    }
    const parent = path.dirname(target);
    const staged = fs.mkdtempSync(path.join(parent, '.' + path.basename(target) + '-receiving-'));
    try {
      for (const file of bundle.files) {
        const filename = path.join(staged, safeRelativePath(file.path));
        fs.mkdirSync(path.dirname(filename), {recursive: true, mode: 0o700});
        writeNew(filename, file.data);
      }
      // The complete directory is published after all original members arrive.
      if (fs.existsSync(target)) throw Error('Receiving destination appeared during preparation');
      fs.renameSync(staged, target);
    } catch (error) {
      error.message += '; prepared source remains at ' + staged;
      throw error;
    }
    return {directory: target, reused: false};
  }
  if (job.action === 'encode') {
    const envelope = codec.encode(readBytes(job.input_path), job.encoding);
    if (job.part_characters !== undefined) {
      const parts = codec.split(envelope, job.part_characters, job.metadata || {});
      if (job.output_path) result.output = writeJson(job.output_path, parts);
      else result.parts = parts;
    } else if (job.output_path) result.output = writeJson(job.output_path, envelope);
    else result.envelope = envelope;
    result.source = {bytes: envelope.bytes, sha256: envelope.sha256};
  } else if (job.action === 'decode') {
    const source = decoded();
    if (!job.output_path) throw TypeError('Decode requires the original output_path');
    result.output = writeNew(job.output_path, source.data);
  } else if (job.action === 'bundle') {
    if (!Array.isArray(job.files)) throw TypeError('Bundle requires complete files');
    const bundle = codec.makeBundle(job.files.map(file => ({path: file.path,
      data: readBytes(file.input_path), encoding: file.encoding})), job.metadata || {});
    if (job.output_path) result.output = writeJson(job.output_path, bundle);
    else result.bundle = bundle;
    result.fileCount = bundle.fileCount; result.manifest = bundle.manifest;
  } else if (job.action === 'receive') {
    const source = decoded(), bundle = codec.receiveBundle(source.data, job.selection || {});
    if (!job.destination) throw TypeError('Receiving requires an original destination directory');
    result.receiving = materialize(bundle, job.destination);
    result.source = {bytes: source.bytes, sha256: source.sha256};
    result.fileCount = bundle.fileCount; result.bytes = bundle.bytes;
    result.sources = bundle.files.map(file => file.identity);
  } else if (job.action === 'delta-create') {
    const delta = codec.createDelta(readBytes(job.base_path), readBytes(job.input_path), job.metadata || {});
    const output = job.encoding ? codec.encode(codec.utf8(JSON.stringify(delta)), job.encoding) : delta;
    if (job.output_path) result.output = writeJson(job.output_path, output);
    else result.delta = output;
    result.base = {bytes: delta.baseBytes, sha256: delta.baseSha256};
    result.source = {bytes: delta.outputBytes, sha256: delta.outputSha256};
  } else if (job.action === 'delta-apply') {
    const selections = ['delta', 'delta_envelope'].filter(name => own(job, name) || own(job, name + '_path'));
    if (selections.length !== 1) throw TypeError('Supply exactly one delta or delta_envelope');
    const delta = selections[0] === 'delta_envelope'
      ? codec.parseJson(codec.decode(selected('delta_envelope')).data).value : selected('delta');
    const source = codec.applyDelta(readBytes(job.base_path), delta);
    if (!job.output_path) throw TypeError('Delta receiving requires output_path');
    result.output = writeNew(job.output_path, source.data);
  } else throw TypeError('Choose encode, decode, bundle, receive, delta-create or delta-apply');
  if (reportPath) writeJson(reportPath, result);
  else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return 0;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {BYTES_SCHEMA, BUNDLE_SCHEMA, PART_SCHEMA, DELTA_SCHEMA, DEFAULT_MAX_BYTES,
    createSourceBytes, utf8, textUtf8, fromBase64, toBase64, packLz77, unpackLz77, decodeGzip, safeRelativePath, main};
  if (typeof require === 'function' && require.main === module) {
    main(process.argv.slice(2)).then(code => {process.exitCode = code;}).catch(error => {
      process.stderr.write(JSON.stringify({error: 'source_bytes_failed', message: error.message}) + '\n');
      process.exitCode = 2;
    });
  }
}
