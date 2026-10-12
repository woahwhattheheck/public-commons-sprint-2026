// MIT. Incremental file checksum for the original browser upload/import contract.
// SHA-256 operations, constants and padding: NIST FIPS 180-4, sections 4–6.
// https://doi.org/10.6028/NIST.FIPS.180-4
const K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);
const rotate = (word, places) => word >>> places | word << (32 - places);

export class Sha256 {
  constructor() {
    this.state = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    this.pending = new Uint8Array(64); this.pendingView = new DataView(this.pending.buffer);
    this.words = new Uint32Array(64); this.used = 0; this.bytes = 0; this.finished = false;
  }
  block(view, offset = 0) {
    const w = this.words;
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = rotate(a, 7) ^ rotate(a, 18) ^ a >>> 3;
      const s1 = rotate(b, 17) ^ rotate(b, 19) ^ b >>> 10;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    const state = this.state;
    let a = state[0], b = state[1], c = state[2], d = state[3], e = state[4], f = state[5], g = state[6], h = state[7];
    for (let i = 0; i < 64; i++) {
      const sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = e & f ^ ~e & g;
      const t1 = (h + sum1 + choice + K[i] + w[i]) >>> 0;
      const sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = a & b ^ a & c ^ b & c;
      const t2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0; state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0; state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0; state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0; state[7] = (state[7] + h) >>> 0;
  }
  update(input) {
    if (this.finished) throw new Error('This SHA-256 input has already been completed.');
    if (!(input instanceof Uint8Array)) throw new TypeError('SHA-256 requires original byte chunks.');
    if (!Number.isSafeInteger(this.bytes + input.byteLength)) throw new RangeError('SHA-256 input exceeds the supported byte count.');
    this.bytes += input.byteLength;
    let offset = 0;
    if (this.used) {
      const count = Math.min(64 - this.used, input.byteLength);
      this.pending.set(input.subarray(0, count), this.used); this.used += count; offset += count;
      if (this.used < 64) return this;
      this.block(this.pendingView); this.used = 0;
    }
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    while (offset + 64 <= input.byteLength) { this.block(view, offset); offset += 64; }
    if (offset < input.byteLength) {
      this.pending.set(input.subarray(offset)); this.used = input.byteLength - offset;
    }
    return this;
  }
  hex() {
    if (this.finished) return this.result;
    this.finished = true;
    this.pending[this.used++] = 0x80;
    if (this.used > 56) { this.pending.fill(0, this.used); this.block(this.pendingView); this.used = 0; }
    this.pending.fill(0, this.used, 56);
    this.pendingView.setBigUint64(56, BigInt(this.bytes) * 8n);
    this.block(this.pendingView);
    this.result = Array.from(this.state, word => word.toString(16).padStart(8, '0')).join('');
    return this.result;
  }
}

export async function sha256File(file, { chunkBytes = 1048576, onProgress } = {}) {
  if (!file || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 8 * 1024 * 1024 * 1024 ||
      typeof file.slice !== 'function') throw new TypeError('Select an original file up to 8 GiB.');
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > 8 * 1024 * 1024)
    throw new RangeError('Select a file chunk size from 1 byte to 8 MiB.');
  const hash = new Sha256();
  onProgress?.({ bytes: 0, total: file.size });
  for (let offset = 0; offset < file.size;) {
    const end = Math.min(file.size, offset + chunkBytes);
    const input = new Uint8Array(await file.slice(offset, end).arrayBuffer());
    if (input.byteLength !== end - offset) throw new Error('The selected file changed while its checksum was being read.');
    hash.update(input); offset = end;
    onProgress?.({ bytes: offset, total: file.size });
  }
  return hash.hex();
}
