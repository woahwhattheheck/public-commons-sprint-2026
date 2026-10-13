/** Pure JavaScript carrier for exact UTF-8 source across rich-text connectors.
 * No filesystem, network, dependencies, browser globals, or Node globals required.
 * Compatible with the maintained commons.artifact-base64/v1 materializer.
 */
function createSourceCarrierCodec(){
// Standard fixed-Huffman DEFLATE carrier for actual UTF-8 source.
// compressionResult(text) -> {zlibBase64,gzipBase64,utf8Bytes,deflateBytes,adler32,crc32}.
// No file, network, npm, browser globals or binary tool output required.
function utf8Bytes(text) {
  const bytes = [];
  for (const char of text) {
    const c = char.codePointAt(0);
    if (c < 128) bytes.push(c);
    else if (c < 2048) bytes.push(192 | c >> 6, 128 | c & 63);
    else if (c < 65536) bytes.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
    else bytes.push(240 | c >> 18, 128 | c >> 12 & 63, 128 | c >> 6 & 63, 128 | c & 63);
  }
  return bytes;
}
function bytesBase64(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let encoded = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i+1], c = bytes[i+2];
    encoded += alphabet[a >> 2] + alphabet[((a & 3) << 4) | ((b || 0) >> 4)]
      + (b === undefined ? "=" : alphabet[((b & 15) << 2) | ((c || 0) >> 6)])
      + (c === undefined ? "=" : alphabet[c & 63]);
  }
  return encoded;
}
function reverseBits(value, length) {
  let result = 0;
  for (let i = 0; i < length; i++) { result = (result << 1) | (value & 1); value >>>= 1; }
  return result;
}
const lengthBases = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
const lengthExtra = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
const distanceBases = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
const distanceExtra = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
function fixedCode(symbol) {
  if (symbol <= 143) return [symbol + 0x30, 8];
  if (symbol <= 255) return [symbol - 144 + 0x190, 9];
  if (symbol <= 279) return [symbol - 256, 7];
  return [symbol - 280 + 0xc0, 8];
}
function deflateFixed(input) {
  const output = []; let bits = 0, buffer = 0;
  function put(value, length) {
    buffer |= value << bits; bits += length;
    while (bits >= 8) { output.push(buffer & 255); buffer >>>= 8; bits -= 8; }
  }
  function symbol(value) { const [code, n] = fixedCode(value); put(reverseBits(code, n), n); }
  const heads = new Map(), previous = new Int32Array(input.length); previous.fill(-1);
  const key = i => input[i] | input[i+1] << 8 | input[i+2] << 16;
  function index(i) {
    if (i + 2 < input.length) { const k = key(i); previous[i] = heads.get(k) ?? -1; heads.set(k, i); }
  }
  put(1, 1); put(1, 2);
  for (let i = 0; i < input.length;) {
    let bestLength = 0, bestDistance = 0;
    if (i + 2 < input.length) {
      let p = heads.get(key(i)) ?? -1, tries = 0;
      while (p >= 0 && i - p <= 32768 && tries++ < 256) {
        let n = 0; const max = Math.min(258, input.length - i);
        while (n < max && input[p+n] === input[i+n]) n++;
        if (n > bestLength) { bestLength = n; bestDistance = i - p; if (n === 258) break; }
        p = previous[p];
      }
    }
    if (bestLength >= 3) {
      let j = 0;
      while (j < lengthBases.length - 1 && lengthBases[j+1] <= bestLength) j++;
      symbol(257 + j); put(bestLength - lengthBases[j], lengthExtra[j]);
      j = 0;
      while (j < distanceBases.length - 1 && distanceBases[j+1] <= bestDistance) j++;
      put(reverseBits(j, 5), 5); put(bestDistance - distanceBases[j], distanceExtra[j]);
      for (let x = 0; x < bestLength; x++) index(i+x);
      i += bestLength;
    } else { symbol(input[i]); index(i); i++; }
  }
  symbol(256); if (bits) output.push(buffer & 255);
  return output;
}
function inflateOwnFixed(input) {
  let bitPosition = 0;
  function get(n) {
    let value = 0;
    for (let i = 0; i < n; i++, bitPosition++) {
      if ((bitPosition >> 3) >= input.length) throw Error("Incomplete DEFLATE carrier");
      value |= ((input[bitPosition >> 3] >> (bitPosition & 7)) & 1) << i;
    }
    return value;
  }
  if (get(1) !== 1 || get(2) !== 1) throw Error("This receiver expects the fixed-Huffman carrier produced above");
  const table = new Map();
  for (let s = 0; s < 288; s++) { const [v, n] = fixedCode(s); table.set(n + ":" + reverseBits(v, n), s); }
  const output = [];
  for (;;) {
    let value = 0, symbol;
    for (let n = 1; n <= 9; n++) {
      value |= get(1) << (n - 1);
      if (table.has(n + ":" + value)) { symbol = table.get(n + ":" + value); break; }
    }
    if (symbol === undefined || symbol > 285) throw Error("Invalid DEFLATE symbol");
    if (symbol < 256) output.push(symbol);
    else if (symbol === 256) break;
    else {
      const j = symbol - 257, length = lengthBases[j] + get(lengthExtra[j]);
      const d = reverseBits(get(5), 5);
      if (d >= 30) throw Error("Invalid DEFLATE distance");
      const distance = distanceBases[d] + get(distanceExtra[d]);
      if (distance > output.length) throw Error("DEFLATE distance exceeds retained history");
      for (let n = 0; n < length; n++) output.push(output[output.length - distance]);
    }
  }
  return output;
}
function crc32Bytes(input) {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function compressionResult(text) {
  const input = utf8Bytes(text), body = deflateFixed(input), restored = inflateOwnFixed(body);
  if (restored.length !== input.length || input.some((byte, i) => byte !== restored[i])) {
    throw Error("Actual source carrier round trip differs");
  }
  let a = 1, b = 0;
  for (const byte of input) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  const adler = ((b << 16) | a) >>> 0, crc = crc32Bytes(input), size = input.length >>> 0;
  const zlib = [0x78,0x01].concat(body, [adler >>> 24, adler >>> 16 & 255, adler >>> 8 & 255, adler & 255]);
  const le32 = value => [value & 255, value >>> 8 & 255, value >>> 16 & 255, value >>> 24];
  const gzip = [31,139,8,0,0,0,0,0,0,255].concat(body, le32(crc), le32(size));
  return {zlibBase64: bytesBase64(zlib), gzipBase64: bytesBase64(gzip),
    utf8Bytes: input.length, deflateBytes: body.length,
    adler32: adler.toString(16).padStart(8,"0"), crc32: crc.toString(16).padStart(8,"0")};
}

function sha256Bytes(input) {
 const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
 const bytes=Array.from(input),bitLength=bytes.length*8;
 bytes.push(128);while(bytes.length%64!==56)bytes.push(0);
 const high=Math.floor(bitLength/4294967296),low=bitLength>>>0;
 for(const n of [high,low])bytes.push(n>>>24,n>>>16&255,n>>>8&255,n&255);
 let h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
 const rr=(x,n)=>(x>>>n)|(x<<(32-n));
 for(let p=0;p<bytes.length;p+=64){
  const w=new Uint32Array(64);
  for(let i=0;i<16;i++)w[i]=(bytes[p+4*i]<<24)|(bytes[p+4*i+1]<<16)|(bytes[p+4*i+2]<<8)|bytes[p+4*i+3];
  for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2];w[i]=(w[i-16]+(rr(a,7)^rr(a,18)^(a>>>3))+w[i-7]+(rr(b,17)^rr(b,19)^(b>>>10)))>>>0;}
  let [a,b,c,d,e,f,g,z]=h;
  for(let i=0;i<64;i++){const t1=(z+(rr(e,6)^rr(e,11)^rr(e,25))+((e&f)^(~e&g))+k[i]+w[i])>>>0,t2=((rr(a,2)^rr(a,13)^rr(a,22))+((a&b)^(a&c)^(b&c)))>>>0;
   z=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
  h=h.map((v,i)=>(v+[a,b,c,d,e,f,g,z][i])>>>0);
 }
 return h.map(v=>v.toString(16).padStart(8,"0")).join("");
}

function base64Decode(s) {
  if(typeof s!=="string"||s.length%4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s))throw Error("Invalid base64");
  const a="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",out=[];
  for(let i=0;i<s.length;i+=4){const x=a.indexOf(s[i])*262144+a.indexOf(s[i+1])*4096+(s[i+2]==="="?0:a.indexOf(s[i+2])*64)+(s[i+3]==="="?0:a.indexOf(s[i+3]));out.push((x>>>16)&255);if(s[i+2]!=="=")out.push((x>>>8)&255);if(s[i+3]!=="=")out.push(x&255);}
  return Uint8Array.from(out);
}
function decodeUtf8Strict(a){let s="";for(let i=0;i<a.length;){const b=a[i++];if(b<128){s+=String.fromCharCode(b);continue;}let n,v,min;if(b>=194&&b<=223){n=1;v=b&31;min=128;}else if(b>=224&&b<=239){n=2;v=b&15;min=2048;}else if(b>=240&&b<=244){n=3;v=b&7;min=65536;}else throw Error("Invalid UTF8");for(let k=0;k<n;k++){const c=a[i++];if(c===undefined||(c&192)!==128)throw Error("Invalid UTF8 continuation");v=v*64+(c&63);}if(v<min||v>1114111||(v>=55296&&v<=57343))throw Error("Invalid UTF8 scalar");s+=String.fromCodePoint(v);}return s;}
function gzipInflate(input,maxOutput=16777216){
 const a=typeof input==="string"?base64Decode(input):input;let p=0;
 const u32=i=>(a[i]|a[i+1]<<8|a[i+2]<<16|a[i+3]<<24)>>>0;
 if(a.length<18||a[0]!==31||a[1]!==139||a[2]!==8||a[3]&224)throw Error("Invalid gzip header");
 const flags=a[3];p=10;
 if(flags&4){if(p+2>a.length-8)throw Error("Bad extra");const len=a[p]|a[p+1]<<8;p+=2+len;}
 for(const flag of [8,16])if(flags&flag){while(p<a.length-8&&a[p++]){}}
 if(flags&2)p+=2;
 if(p>=a.length-8)throw Error("Truncated gzip");
 let bit=0,end=a.length-8;const out=[];
 function bits(n){let value=0;for(let k=0;k<n;k++){if(p>=end)throw Error("Truncated deflate");value|=((a[p]>>>bit)&1)<<k;if(++bit===8){bit=0;p++;}}return value;}
 function tree(lengths){const counts=new Array(16).fill(0),next=new Array(16).fill(0),tables=Array.from({length:16},()=>new Map());let max=0;for(const n of lengths){if(n<0||n>15)throw Error("Invalid code length");if(n){counts[n]++;max=Math.max(max,n);}}let left=1;for(let n=1;n<=15;n++){left=left*2-counts[n];if(left<0)throw Error("Oversubscribed Huffman tree");}let c=0;for(let n=1;n<=15;n++){c=(c+counts[n-1])<<1;next[n]=c;}lengths.forEach((n,sym)=>{if(!n)return;const code=next[n]++;let rev=0;for(let k=0;k<n;k++)rev=(rev<<1)|((code>>>k)&1);tables[n].set(rev,sym);});return{tables,max};}
 function symbol(t){let c=0;for(let n=1;n<=t.max;n++){c|=bits(1)<<(n-1);if(t.tables[n].has(c))return t.tables[n].get(c);}throw Error("Invalid Huffman code");}
 function emit(v){if(out.length>=maxOutput)throw Error("Inflate size limit");out.push(v);}
 const lbase=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258],lextra=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
 const dbase=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577],dextra=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
 let last=0;do{
 last=bits(1);const type=bits(2);
 if(type===0){if(bit){bit=0;p++;}const len=bits(16),inv=bits(16);if((len^65535)!==inv)throw Error("Stored length differs");for(let i=0;i<len;i++)emit(bits(8));continue;}
 let lt,dt;
 if(type===1){lt=tree(Array.from({length:288},(_,i)=>i<144?8:i<256?9:i<280?7:8));dt=tree(new Array(32).fill(5));}
 else if(type===2){const nl=bits(5)+257,nd=bits(5)+1,nc=bits(4)+4;const ord=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15],cl=new Array(19).fill(0);if(nl>286||nd>32)throw Error("Invalid dynamic sizes");for(let i=0;i<nc;i++)cl[ord[i]]=bits(3);const ct=tree(cl),lens=[];while(lens.length<nl+nd){const v=symbol(ct);if(v<16)lens.push(v);else{let n,val;if(v===16){if(!lens.length)throw Error("Missing repeated length");n=bits(2)+3;val=lens[lens.length-1];}else if(v===17){n=bits(3)+3;val=0;}else if(v===18){n=bits(7)+11;val=0;}else throw Error("Invalid repeated length");if(lens.length+n>nl+nd)throw Error("Excess code lengths");while(n--)lens.push(val);}}if(!lens[256])throw Error("Missing end code");lt=tree(lens.slice(0,nl));dt=tree(lens.slice(nl));}
 else throw Error("Reserved deflate block");
 while(true){const v=symbol(lt);if(v<256){emit(v);continue;}if(v===256)break;if(v>285)throw Error("Reserved length");const li=v-257,len=lbase[li]+bits(lextra[li]),ds=symbol(dt);if(ds>29)throw Error("Reserved distance");const distance=dbase[ds]+bits(dextra[ds]);if(distance>out.length)throw Error("Distance outside retained output");for(let k=0;k<len;k++)emit(out[out.length-distance]);}
 }while(!last);
 if(bit)p++;
 if(p!==end)throw Error("Unexpected gzip member/trailing data");
 const output=Uint8Array.from(out);if(u32(end+4)!==(output.length>>>0))throw Error("Gzip length differs");
 let crc=4294967295;for(const x of output){crc^=x;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?3988292384:0);}crc=(crc^4294967295)>>>0;if(crc!==u32(end))throw Error("Gzip CRC differs");
 return output;
}

  function assertText(text,maxBytes){
    if(typeof text!=="string")throw new TypeError("Use complete UTF-8 text");
    for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const d=text.charCodeAt(++i);if(!(d>=0xdc00&&d<=0xdfff))throw Error("Unpaired UTF-16 surrogate");}else if(c>=0xdc00&&c<=0xdfff)throw Error("Unpaired UTF-16 surrogate");}
    const bytes=utf8Bytes(text);if(bytes.length>maxBytes)throw Error("Source exceeds selected byte limit");return bytes;
  }
  function limit(value){if(!Number.isSafeInteger(value)||value<0||value>64*1024*1024)throw Error("Choose a byte limit from 0 through 64 MiB");return value;}
  function encodeText(text,{maxBytes=16*1024*1024,decodedSchema}={}){
    limit(maxBytes);const source=assertText(text,maxBytes),result=compressionResult(text),compressed=base64Decode(result.gzipBase64);
    const envelope={schema:"commons.artifact-base64/v1",encoding:"gzip+base64",
      original_bytes:source.length,original_sha256:sha256Bytes(source),
      gzip_bytes:compressed.length,gzip_sha256:sha256Bytes(compressed),
      content_base64:result.gzipBase64};
    if(decodedSchema!==undefined){if(typeof decodedSchema!=="string"||decodedSchema.length>160)throw Error("Use a short decoded schema label");envelope.decoded_schema=decodedSchema;}
    return envelope;
  }
  function decodeText(envelope,{maxBytes=16*1024*1024,maxCompressedBytes=32*1024*1024}={}){
    limit(maxBytes);limit(maxCompressedBytes);
    if(!envelope||envelope.schema!=="commons.artifact-base64/v1"||envelope.encoding!=="gzip+base64")throw Error("Choose the complete gzip/base64 source envelope");
    for(const key of ["original_bytes","gzip_bytes"])if(!Number.isSafeInteger(envelope[key])||envelope[key]<0)throw Error("Invalid source byte count");
    for(const key of ["original_sha256","gzip_sha256"])if(typeof envelope[key]!=="string"||!/^[a-f0-9]{64}$/.test(envelope[key]))throw Error("Invalid source SHA-256");
    if(envelope.original_bytes>maxBytes||envelope.gzip_bytes>maxCompressedBytes)throw Error("Source exceeds selected byte limit");
    const encoded=envelope.content_base64;
    if(typeof encoded!=="string"||encoded.length!==Math.ceil(envelope.gzip_bytes/3)*4)throw Error("Base64 length differs");
    const compressed=base64Decode(encoded);
    if(bytesBase64(compressed)!==encoded||compressed.length!==envelope.gzip_bytes||sha256Bytes(compressed)!==envelope.gzip_sha256)throw Error("Original gzip source identity differs");
    const source=gzipInflate(compressed,Math.min(maxBytes,envelope.original_bytes));
    if(source.length!==envelope.original_bytes||sha256Bytes(source)!==envelope.original_sha256)throw Error("Decoded source identity differs");
    return decodeUtf8Strict(source);
  }
  return Object.freeze({encodeText,decodeText,
    identity(text,{maxBytes=16*1024*1024}={}){limit(maxBytes);const bytes=assertText(text,maxBytes);return{bytes:bytes.length,sha256:sha256Bytes(bytes)};}});

}
if(typeof module!=="undefined"&&module.exports)module.exports={createSourceCarrierCodec};
