/** Deterministic gzip encoding for retained source banks in ordinary JavaScript. */
import {crc32} from './artifact-reader.mjs';

const LENGTH_BASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
const LENGTH_EXTRA = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
const DIST_BASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
const DIST_EXTRA = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];

function reverse(value, count) {
  let output = 0;
  for (let i = 0; i < count; i++) { output = output * 2 + (value & 1); value >>>= 1; }
  return output;
}

export function deflateFixed(input, {max_chain = 32, max_input_bytes = 64 * 1024 * 1024} = {}) {
  if (!(input instanceof Uint8Array)) throw new TypeError('Input must be Uint8Array');
  if (!Number.isSafeInteger(max_input_bytes) || max_input_bytes < 0 || input.length > max_input_bytes)
    throw new RangeError('Input exceeds declared compression size limit');
  if (!Number.isInteger(max_chain) || max_chain < 1 || max_chain > 256)
    throw new RangeError('max_chain must be between 1 and 256');
  const out = [];
  let buffer = 0, bits = 0;
  const write = (value, count) => {
    buffer |= value << bits;
    bits += count;
    while (bits >= 8) { out.push(buffer & 255); buffer >>>= 8; bits -= 8; }
  };
  const symbol = value => {
    if (value <= 143) write(reverse(0x30 + value, 8), 8);
    else if (value <= 255) write(reverse(0x190 + value - 144, 9), 9);
    else if (value <= 279) write(reverse(value - 256, 7), 7);
    else write(reverse(0xc0 + value - 280, 8), 8);
  };
  // One final fixed-Huffman DEFLATE block, followed by the end-of-block symbol.
  write(1, 1); write(1, 2);
  const heads = new Int32Array(65536); heads.fill(-1);
  const previous = new Int32Array(input.length); previous.fill(-1);
  const hash = i => ((input[i] * 251 + input[i + 1]) * 251 + input[i + 2]) & 65535;
  const insert = i => {
    if (i + 2 >= input.length) return -1;
    const key = hash(i), candidate = heads[key];
    previous[i] = candidate; heads[key] = i;
    return candidate;
  };
  let i = 0;
  while (i < input.length) {
    let candidate = insert(i), best = 2, distance = 0, searched = 0;
    const maximum = Math.min(258, input.length - i), oldest = Math.max(0, i - 32768);
    while (candidate >= oldest && candidate >= 0 && searched++ < max_chain) {
      if (maximum >= 3 && input[candidate] === input[i] &&
          input[candidate + 1] === input[i + 1] &&
          input[candidate + best] === input[i + best]) {
        let length = 2;
        while (length < maximum && input[candidate + length] === input[i + length]) length++;
        if (length > best) { best = length; distance = i - candidate; if (best === maximum) break; }
      }
      candidate = previous[candidate];
    }
    if (best >= 3) {
      let lengthCode = 0;
      while (lengthCode + 1 < LENGTH_BASE.length && best >= LENGTH_BASE[lengthCode + 1]) lengthCode++;
      symbol(257 + lengthCode);
      write(best - LENGTH_BASE[lengthCode], LENGTH_EXTRA[lengthCode]);
      let distanceCode = 0;
      while (distanceCode + 1 < DIST_BASE.length && distance >= DIST_BASE[distanceCode + 1]) distanceCode++;
      write(reverse(distanceCode, 5), 5);
      write(distance - DIST_BASE[distanceCode], DIST_EXTRA[distanceCode]);
      for (let offset = 1; offset < best; offset++) insert(i + offset);
      i += best;
    } else { symbol(input[i]); i++; }
  }
  symbol(256);
  if (bits) out.push(buffer & 255);
  return Uint8Array.from(out);
}

export function writeGzip(input, options = {}) {
  const compressed = deflateFixed(input, options);
  const out = new Uint8Array(10 + compressed.length + 8);
  out.set([31,139,8,0,0,0,0,0,0,255]); // zero timestamp; OS-independent stream
  out.set(compressed, 10);
  const checksum = crc32(input), offset = 10 + compressed.length;
  for (let i = 0; i < 4; i++) {
    out[offset + i] = (checksum >>> (8 * i)) & 255;
    out[offset + 4 + i] = (input.length >>> (8 * i)) & 255;
  }
  return out;
}
