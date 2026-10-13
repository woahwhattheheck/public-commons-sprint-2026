/**
 * Read ordinary ZIP members in a code-only V8 isolate.
 * Supports stored and DEFLATE members; validates central-directory sizes and CRC32.
 * DEFLATE reference: https://www.rfc-editor.org/rfc/rfc1951
 */
export function base64Bytes(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const text = value.replace(/\s/g, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw new Error("Invalid base64");
  const output = new Uint8Array(text.length / 4 * 3 - (text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0));
  let position = 0;
  for (let i = 0; i < text.length; i += 4) {
    const a = alphabet.indexOf(text[i]), b = alphabet.indexOf(text[i + 1]);
    const c = alphabet.indexOf(text[i + 2]), d = alphabet.indexOf(text[i + 3]);
    output[position++] = (a << 2) | (b >> 4);
    if (text[i + 2] !== "=") output[position++] = ((b & 15) << 4) | (c >> 2);
    if (text[i + 3] !== "=") output[position++] = ((c & 3) << 6) | d;
  }
  return output;
}

export function utf8Text(bytes) {
  return decodeURIComponent(Array.from(bytes, (value) => "%" + value.toString(16).padStart(2, "0")).join(""));
}

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function huffman(lengths) {
  const maximum = Math.max(0, ...lengths);
  if (maximum > 15) throw new Error("Invalid Huffman length");
  const count = new Array(maximum + 1).fill(0);
  for (const length of lengths) if (length > 0) count[length]++;
  const next = new Array(maximum + 1).fill(0);
  let code = 0;
  for (let length = 1; length <= maximum; length++) {
    code = (code + (count[length - 1] ?? 0)) << 1;
    next[length] = code;
    if (code + count[length] > 2 ** length) throw new Error("Oversubscribed Huffman tree");
  }
  const tables = Array.from({length: maximum + 1}, () => new Map());
  lengths.forEach((length, symbol) => { if (length) tables[length].set(next[length]++, symbol); });
  return (read) => {
    let value = 0;
    for (let length = 1; length <= maximum; length++) {
      value = (value << 1) | read(1);
      if (tables[length].has(value)) return tables[length].get(value);
    }
    throw new Error("Invalid Huffman code");
  };
}

export function inflateRaw(input, expectedBytes, maximumBytes = 32 * 1024 * 1024, withInfo = false) {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || expectedBytes > maximumBytes) throw new Error("Uncompressed member exceeds declared size limit");
  const output = new Uint8Array(expectedBytes);
  let bit = 0, position = 0;
  const read = (count) => {
    if (bit + count > input.length * 8) throw new Error("Truncated DEFLATE data");
    let value = 0;
    for (let i = 0; i < count; i++, bit++) value |= ((input[bit >>> 3] >>> (bit & 7)) & 1) << i;
    return value;
  };
  const emit = (value) => {
    if (position >= expectedBytes) throw new Error("DEFLATE output exceeds declared member size");
    output[position++] = value;
  };
  const lengthBase = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  const lengthExtra = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  const distanceBase = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  const distanceExtra = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  let final = false;
  while (!final) {
    final = Boolean(read(1));
    const type = read(2);
    if (type === 0) {
      bit = (bit + 7) & ~7;
      const length = read(16), complement = read(16);
      if ((length ^ complement) !== 65535) throw new Error("Stored block length mismatch");
      for (let i = 0; i < length; i++) emit(read(8));
      continue;
    }
    if (type === 3) throw new Error("Reserved DEFLATE block type");
    let literal, distance;
    if (type === 1) {
      literal = huffman(Array.from({length: 288}, (_, i) => i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8));
      distance = huffman(new Array(32).fill(5));
    } else {
      const literalCount = read(5) + 257, distanceCount = read(5) + 1, codeCount = read(4) + 4;
      if (literalCount > 286) throw new Error("Invalid literal alphabet size");
      const order = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
      const codeLengths = new Array(19).fill(0);
      for (let i = 0; i < codeCount; i++) codeLengths[order[i]] = read(3);
      const decodeLength = huffman(codeLengths), lengths = [];
      while (lengths.length < literalCount + distanceCount) {
        const symbol = decodeLength(read);
        if (symbol <= 15) lengths.push(symbol);
        else {
          if (symbol === 16 && !lengths.length) throw new Error("Missing repeated Huffman length");
          const value = symbol === 16 ? lengths.at(-1) : 0;
          const count = symbol === 16 ? read(2) + 3 : symbol === 17 ? read(3) + 3 : read(7) + 11;
          for (let i = 0; i < count; i++) lengths.push(value);
        }
      }
      if (lengths.length !== literalCount + distanceCount || lengths[256] === 0) throw new Error("Invalid dynamic Huffman lengths");
      literal = huffman(lengths.slice(0, literalCount));
      distance = huffman(lengths.slice(literalCount));
    }
    while (true) {
      const symbol = literal(read);
      if (symbol < 256) { emit(symbol); continue; }
      if (symbol === 256) break;
      if (symbol < 257 || symbol > 285) throw new Error("Invalid DEFLATE length symbol");
      const length = lengthBase[symbol - 257] + read(lengthExtra[symbol - 257]);
      const distanceSymbol = distance(read);
      if (distanceSymbol > 29) throw new Error("Invalid DEFLATE distance symbol");
      const offset = distanceBase[distanceSymbol] + read(distanceExtra[distanceSymbol]);
      if (offset > position) throw new Error("DEFLATE reference precedes output");
      for (let i = 0; i < length; i++) emit(output[position - offset]);
    }
  }
  if (position !== expectedBytes) throw new Error("DEFLATE size differs from declared size");
  return withInfo ? {data: output, consumed_bytes: Math.ceil(bit / 8)} : output;
}

export function readZip(bytes, options = {}) {
  const maxTotal = options.max_total_bytes ?? 64 * 1024 * 1024;
  const maxMember = options.max_member_bytes ?? 32 * 1024 * 1024;
  const u16 = (offset) => bytes[offset] | (bytes[offset + 1] << 8);
  const u32 = (offset) => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && (u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== bytes.length)) end--;
  if (end < Math.max(0, bytes.length - 65557)) throw new Error("ZIP end directory not found");
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) throw new Error("Split ZIP is unsupported");
  const count = u16(end + 10), centralSize = u32(end + 12), centralStart = u32(end + 16);
  if (count === 65535 || centralSize === 0xffffffff || centralStart === 0xffffffff) throw new Error("ZIP64 is unsupported");
  if (centralStart + centralSize > end) throw new Error("Invalid ZIP central directory bounds");
  const files = [], names = new Set();
  let cursor = centralStart, total = 0;
  for (let i = 0; i < count; i++) {
    if (u32(cursor) !== 0x02014b50) throw new Error("Invalid ZIP central member");
    const flags = u16(cursor + 8), method = u16(cursor + 10), expectedCrc = u32(cursor + 16);
    const compressedSize = u32(cursor + 20), size = u32(cursor + 24);
    const nameLength = u16(cursor + 28), extraLength = u16(cursor + 30), commentLength = u16(cursor + 32);
    const local = u32(cursor + 42), path = utf8Text(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (flags & 1) throw new Error("Encrypted ZIP is unsupported");
    if (![0, 8].includes(method)) throw new Error("Unsupported ZIP compression method: " + method);
    if (size > maxMember || (total += size) > maxTotal) throw new Error("ZIP exceeds configured size limits");
    if (path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === "..")) throw new Error("Non-portable ZIP member path");
    if (names.has(path)) throw new Error("Duplicate ZIP member path");
    names.add(path);
    if (u32(local) !== 0x04034b50) throw new Error("ZIP local header is missing");
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    if (start + compressedSize > centralStart) throw new Error("ZIP member crosses directory");
    const compressed = bytes.slice(start, start + compressedSize);
    const content = method === 0 ? compressed : inflateRaw(compressed, size, maxMember);
    if (content.length !== size || crc32(content) !== expectedCrc) throw new Error("ZIP member checksum mismatch: " + path);
    if (!path.endsWith("/")) files.push({path,bytes:size,crc32:expectedCrc,data:content});
  }
  if (cursor !== centralStart + centralSize) throw new Error("ZIP directory length differs");
  return files;
}

/**
 * Read a single GZIP member with optional header fields and CRC verification.
 * Reference: https://www.rfc-editor.org/rfc/rfc1952
 */
export function readGzip(bytes, options = {}) {
  if (bytes.length < 18 || bytes[0] !== 31 || bytes[1] !== 139 || bytes[2] !== 8) throw new Error("Invalid GZIP header");
  const flags = bytes[3];
  if (flags & 224) throw new Error("Reserved GZIP flags");
  const u16 = (offset) => bytes[offset] | (bytes[offset + 1] << 8);
  const u32 = (offset) => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  const trailer = bytes.length - 8;
  let offset = 10, filename = null;
  const requireHeader = () => { if (offset > trailer) throw new Error("GZIP header crosses trailer"); };
  if (flags & 4) { if (offset + 2 > trailer) throw new Error("Truncated GZIP extra field"); const length = u16(offset); offset += 2 + length; requireHeader(); }
  const zeroTerminated = () => {
    const start = offset;
    while (offset < trailer && bytes[offset] !== 0) offset++;
    if (offset >= trailer) throw new Error("Truncated GZIP header text");
    const value = Array.from(bytes.slice(start, offset), (byte) => String.fromCharCode(byte)).join("");
    offset++;
    return value;
  };
  if (flags & 8) filename = zeroTerminated();
  if (flags & 16) zeroTerminated();
  if (flags & 2) {
    if (offset + 2 > trailer || (crc32(bytes.slice(0, offset)) & 65535) !== u16(offset)) throw new Error("GZIP header checksum mismatch");
    offset += 2;
  }
  requireHeader();
  const size = u32(trailer + 4), expectedCrc = u32(trailer);
  const inflated = inflateRaw(bytes.slice(offset, trailer), size, options.max_member_bytes ?? 32 * 1024 * 1024, true);
  if (inflated.consumed_bytes !== trailer - offset) throw new Error("Expected exactly one GZIP member");
  if (crc32(inflated.data) !== expectedCrc) throw new Error("GZIP data checksum mismatch");
  return {data: inflated.data, bytes: size, crc32: expectedCrc, filename, mtime: u32(4)};
}

export function utf8(s){const b=[];for(const c of s){const p=c.codePointAt(0);if(p<128)b.push(p);else if(p<2048)b.push(192|(p>>6),128|(p&63));else if(p<65536)b.push(224|(p>>12),128|((p>>6)&63),128|(p&63));else b.push(240|(p>>18),128|((p>>12)&63),128|((p>>6)&63),128|(p&63));}return b;}
export function base64(bytes){const a="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";let r="";for(let i=0;i<bytes.length;i+=3){const x=bytes[i],y=bytes[i+1],z=bytes[i+2];r+=a[x>>2]+a[((x&3)<<4)|((y??0)>>4)]+(y===undefined?"=":a[((y&15)<<2)|((z??0)>>6)])+(z===undefined?"=":a[z&63]);}return r;}
export function sha256(input){const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];const r=(x,n)=>(x>>>n)|(x<<(32-n));const b=[...input],bits=b.length*8;b.push(128);while(b.length%64!==56)b.push(0);for(let i=7;i>=0;i--)b.push(Math.floor(bits/2**(i*8))&255);for(let o=0;o<b.length;o+=64){const w=new Array(64);for(let i=0;i<16;i++)w[i]=((b[o+4*i]<<24)|(b[o+4*i+1]<<16)|(b[o+4*i+2]<<8)|b[o+4*i+3])>>>0;for(let i=16;i<64;i++){const a=w[i-15],c=w[i-2];w[i]=(w[i-16]+(r(a,7)^r(a,18)^(a>>>3))+w[i-7]+(r(c,17)^r(c,19)^(c>>>10)))>>>0;}let[a,c,d,e,f,g,z,j]=h;for(let i=0;i<64;i++){const t=(j+(r(f,6)^r(f,11)^r(f,25))+((f&g)^((~f)&z))+k[i]+w[i])>>>0;const u=((r(a,2)^r(a,13)^r(a,22))+((a&c)^(a&d)^(c&d)))>>>0;j=z;z=g;g=f;f=(e+t)>>>0;e=d;d=c;c=a;a=(t+u)>>>0;}[a,c,d,e,f,g,z,j].forEach((v,i)=>h[i]=(h[i]+v)>>>0);}return h.map(v=>v.toString(16).padStart(8,"0")).join("");}

