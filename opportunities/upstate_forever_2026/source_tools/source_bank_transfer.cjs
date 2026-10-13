/* Complete source-bank transfer encoder. No filesystem, network, Node or Web APIs.
 * Companion: materialize_source_banks.py. See SOURCE_BANK_TRANSFER.md.
 * Deterministic RFC1952 gzip, SHA-256 content identity, Git SHA-1 blob identity.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CommonsSourceBankTransfer = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
"use strict";

function utf8(text) {
  if (typeof text !== "string") throw new TypeError("Expected exact original UTF-8 text");
  const out = [];
  for (const char of text) {
    const c = char.codePointAt(0);
    if (c >= 0xd800 && c <= 0xdfff) throw new Error("Unpaired Unicode surrogate");
    if (c < 128) out.push(c);
    else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63));
    else if (c < 65536) out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
    else out.push(240 | (c >> 18), 128 | ((c >> 12) & 63), 128 | ((c >> 6) & 63), 128 | (c & 63));
  }
  return new Uint8Array(out);
}

function sha256Bytes(s){
const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
const H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];const b=Array.from(s),bitlen=b.length*8;b.push(128);while(b.length%64!==56)b.push(0);const high=Math.floor(bitlen/4294967296),low=bitlen>>>0;for(let i=3;i>=0;i--)b.push((high>>>(i*8))&255);for(let i=3;i>=0;i--)b.push((low>>>(i*8))&255);const rotr=(x,n)=>(x>>>n)|(x<<(32-n));for(let o=0;o<b.length;o+=64){const w=new Array(64);for(let i=0;i<16;i++)w[i]=((b[o+4*i]<<24)|(b[o+4*i+1]<<16)|(b[o+4*i+2]<<8)|b[o+4*i+3])>>>0;for(let i=16;i<64;i++){const s0=rotr(w[i-15],7)^rotr(w[i-15],18)^(w[i-15]>>>3),s1=rotr(w[i-2],17)^rotr(w[i-2],19)^(w[i-2]>>>10);w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0;}let[a,c,d,e,f,g,h,j]=H;for(let i=0;i<64;i++){const S1=rotr(f,6)^rotr(f,11)^rotr(f,25),ch=(f&g)^((~f)&h),t1=(j+S1+ch+K[i]+w[i])>>>0,S0=rotr(a,2)^rotr(a,13)^rotr(a,22),maj=(a&c)^(a&d)^(c&d),t2=(S0+maj)>>>0;j=h;h=g;g=f;f=(e+t1)>>>0;e=d;d=c;c=a;a=(t1+t2)>>>0;}[a,c,d,e,f,g,h,j].forEach((v,i)=>H[i]=(H[i]+v)>>>0);}return H.map(x=>x.toString(16).padStart(8,'0')).join('');}
function sha1Bytes(input){const n=input.length;const len=Math.ceil((n+9)/64)*64;const data=new Uint8Array(len);data.set(input);data[n]=128;const bits=n*8;for(let i=0;i<8;i++)data[len-1-i]=Math.floor(bits/Math.pow(256,i))&255;let H=[0x67452301,0xefcdab89,0x98badcfe,0x10325476,0xc3d2e1f0];const rot=(x,n)=>(x<<n)|(x>>>(32-n));for(let off=0;off<len;off+=64){let w=new Int32Array(80);for(let i=0;i<16;i++)w[i]=(data[off+i*4]<<24)|(data[off+i*4+1]<<16)|(data[off+i*4+2]<<8)|data[off+i*4+3];for(let i=16;i<80;i++)w[i]=rot(w[i-3]^w[i-8]^w[i-14]^w[i-16],1);let[a,b,c,d,e]=H;for(let i=0;i<80;i++){let f,k;if(i<20){f=(b&c)|(~b&d);k=0x5a827999;}else if(i<40){f=b^c^d;k=0x6ed9eba1;}else if(i<60){f=(b&c)|(b&d)|(c&d);k=0x8f1bbcdc;}else{f=b^c^d;k=0xca62c1d6;}const temp=(rot(a,5)+f+e+k+w[i])|0;e=d;d=c;c=rot(b,30);b=a;a=temp;}H=H.map((v,i)=>(v+[a,b,c,d,e][i])|0);}return H.map(x=>(x>>>0).toString(16).padStart(8,"0")).join("");}
function gitBlobBytes(bytes) {
  const header = utf8("blob " + bytes.length + "\0");
  const data = new Uint8Array(header.length + bytes.length);
  data.set(header); data.set(bytes, header.length);
  return sha1Bytes(data);
}
function identity(text) {
  const bytes = utf8(text);
  return {bytes: bytes.length, sha256: sha256Bytes(bytes), git_blob: gitBlobBytes(bytes)};
}

function base64(bytes){const abc="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";let out="";for(let i=0;i<bytes.length;i+=3){const n=(bytes[i]<<16)|((bytes[i+1]||0)<<8)|(bytes[i+2]||0);out+=abc[(n>>>18)&63]+abc[(n>>>12)&63]+(i+1<bytes.length?abc[(n>>>6)&63]:"=")+(i+2<bytes.length?abc[n&63]:"=");}return out;}

function decodeBase64Unchecked(s) {
 const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
 const clean=s.replace(/\s/g,""); if(clean.length%4)throw Error("Base64 length");
 const out=new Uint8Array(clean.length/4*3-(clean.endsWith("==")?2:clean.endsWith("=")?1:0));
 let p=0;
 for(let i=0;i<clean.length;i+=4){let n=0;for(let j=0;j<4;j++){const c=clean[i+j];const v=c==="="?0:alphabet.indexOf(c);if(v<0)throw Error("Base64 character");n=(n<<6)|v;}for(let j=16;j>=0&&p<out.length;j-=8)out[p++]=(n>>>j)&255;}
 return out;
}


function gzipFixed(bytes) {
  const output=[], length=bytes.length, head=new Int32Array(65536), previous=new Int32Array(length);
  head.fill(-1);previous.fill(-1);
  let buffer=0, available=0;
  function bits(value,count){buffer|=value<<available;available+=count;while(available>=8){output.push(buffer&255);buffer>>>=8;available-=8;}}
  function reverse(value,width){let out=0;for(let i=0;i<width;i++){out=(out<<1)|(value&1);value>>>=1;}return out;}
  function literal(value){if(value<=143)bits(reverse(48+value,8),8);else if(value<=255)bits(reverse(400+value-144,9),9);else if(value<=279)bits(reverse(value-256,7),7);else bits(reverse(192+value-280,8),8);}
  const lengths=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  const lengthExtra=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  const distances=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  const distanceExtra=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  function hash(i){return ((bytes[i]*251+bytes[i+1])*251+bytes[i+2])&65535;}
  function remember(i){if(i+2<length){const h=hash(i);previous[i]=head[h];head[h]=i;}}
  bits(1,1);bits(1,2);
  for(let position=0;position<length;){
    let best=0,where=-1;
    if(position+2<length){
      let candidate=head[hash(position)],searched=0;
      const maximum=Math.min(258,length-position),oldest=Math.max(0,position-32768);
      while(candidate>=oldest&&candidate>=0&&searched++<96){
        if(bytes[candidate]===bytes[position]&&bytes[candidate+1]===bytes[position+1]&&bytes[candidate+2]===bytes[position+2]&&(best<3||bytes[candidate+best]===bytes[position+best])){
          let size=3;while(size<maximum&&bytes[candidate+size]===bytes[position+size])size++;
          if(size>best){best=size;where=candidate;if(best===maximum)break;}
        }
        candidate=previous[candidate];
      }
    }
    if(best>=3){
      let code=lengths.length-1;while(lengths[code]>best)code--;
      literal(257+code);bits(best-lengths[code],lengthExtra[code]);
      const distance=position-where;let dc=distances.length-1;while(distances[dc]>distance)dc--;
      bits(reverse(dc,5),5);bits(distance-distances[dc],distanceExtra[dc]);
      for(let i=position;i<position+best;i++)remember(i);
      position+=best;
    }else{literal(bytes[position]);remember(position);position++;}
  }
  literal(256);if(available)output.push(buffer&255);
  const table=new Uint32Array(256);
  for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}
  let crc=0xffffffff;for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);crc=(crc^0xffffffff)>>>0;
  const result=new Uint8Array(10+output.length+8);result.set([31,139,8,0,0,0,0,0,0,255]);result.set(output,10);
  const tail=10+output.length;for(let i=0;i<4;i++){result[tail+i]=(crc>>>(8*i))&255;result[tail+4+i]=(length>>>(8*i))&255;}
  return result;
}


function requireInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(label + " must be an integer >= " + minimum);
  return value;
}
function sourcePath(path) {
  if (typeof path !== "string" || /[\\:\x00-\x1f\x7f]/.test(path) ||
      path.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("Expected an ordinary relative POSIX source path: " + path);
  }
  utf8(path);
  return path;
}
function decodeBase64(text) {
  if (typeof text !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
    throw new Error("Expected canonical base64 source content");
  }
  const bytes = decodeBase64Unchecked(text);
  if (base64(bytes) !== text) throw new Error("Noncanonical base64 padding bits");
  return bytes;
}
function inspectBank(input, names, paths) {
  if (!input || typeof input !== "object" || !/^[a-z0-9-]+$/.test(input.name || "")) {
    throw new Error("Each bank needs a unique lowercase letters/digits/hyphens name");
  }
  if (names.has(input.name)) throw new Error("Repeated source bank name: " + input.name);
  names.add(input.name);
  const original = utf8(input.text), stamp = {
    bytes: original.length, sha256: sha256Bytes(original), git_blob: gitBlobBytes(original)
  };
  if (input.git_blob !== undefined && input.git_blob !== stamp.git_blob) throw new Error("Original bank Git blob differs: " + input.name);
  if (input.sha256 !== undefined && input.sha256 !== stamp.sha256) throw new Error("Original bank SHA-256 differs: " + input.name);
  const bank = JSON.parse(input.text);
  if (bank.schema !== "commons.source-bank/v1" || !Array.isArray(bank.files)) throw new Error("Expected commons.source-bank/v1");
  if (requireInteger(bank.file_count, "file_count") !== bank.files.length) throw new Error("Source file count differs: " + input.name);
  requireInteger(bank.source_bytes, "source_bytes");
  let sourceBytes = 0;
  for (const item of bank.files) {
    if (!item || typeof item !== "object") throw new Error("Expected source file metadata");
    const path = sourcePath(item.path);
    if (paths.has(path)) throw new Error("Source banks repeat a member: " + path);
    paths.add(path);
    const bytes = decodeBase64(item.content_base64);
    if (requireInteger(item.bytes, "source bytes") !== bytes.length ||
        item.sha256 !== sha256Bytes(bytes) || item.git_blob !== gitBlobBytes(bytes)) {
      throw new Error("Original source content or identity differs: " + path);
    }
    sourceBytes += bytes.length;
    requireInteger(sourceBytes, "total source bytes");
  }
  if (sourceBytes !== bank.source_bytes) throw new Error("Source byte count differs: " + input.name);
  return {name: input.name, original, stamp, fileCount: bank.file_count, sourceBytes};
}
function prepareTransfer(inputs, options = {}) {
  if (!Array.isArray(inputs) || !inputs.length) throw new Error("Supply at least one complete source bank");
  const operationId = options.operationId;
  if (typeof operationId !== "string" || !operationId.trim() || operationId.length > 256) throw new Error("Provide the stable operationId");
  utf8(operationId);
  const repository = options.repository;
  if (typeof repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Provide repository owner/name");
  const maxPayloadBytes = requireInteger(options.maxPayloadBytes ?? 600000, "maxPayloadBytes", 1024);
  const reserveBytes = requireInteger(options.reserveBytes ?? 4096, "reserveBytes");
  const chunkBytes = requireInteger(options.chunkBytes ?? 400000, "chunkBytes", 1);
  const names = new Set(), paths = new Set();
  const banks = inputs.map(input => inspectBank(input, names, paths));
  for (const path of paths) {
    const parts = path.split("/");
    while (parts.length > 1) {
      parts.pop();
      if (paths.has(parts.join("/"))) throw new Error("Source file is also a directory: " + parts.join("/"));
    }
  }
  // Include JSON escaping, tool arguments, and caller-selected transport reserve.
  function payloadBytes(text) {
    return utf8(JSON.stringify({repository_full_name: repository, content: text, encoding: "utf-8"})).length + reserveBytes;
  }
  const manifest = {
    schema: "commons.source-bank-transfer/v1", operation_id: operationId, repository,
    file_count: banks.reduce((n, bank) => n + bank.fileCount, 0),
    source_bytes: banks.reduce((n, bank) => n + bank.sourceBytes, 0), banks: []
  };
  requireInteger(manifest.source_bytes, "transfer source bytes");
  const parts = [];
  for (const bank of banks) {
    const gzip = gzipFixed(bank.original);
    const descriptor = {
      name: bank.name, original_git_blob: bank.stamp.git_blob,
      original_bytes: bank.stamp.bytes, original_sha256: bank.stamp.sha256,
      gzip_bytes: gzip.length, gzip_sha256: sha256Bytes(gzip), parts: []
    };
    for (let offset = 0, index = 0; offset < gzip.length; index++) {
      function makePart(size) {
        const data = gzip.subarray(offset, offset + size), checksum = sha256Bytes(data);
        const body = {
          schema: "commons.source-bank-part/v1", bank: bank.name, part_index: index,
          offset, bytes: size, sha256: checksum, encoding: "base64", data: base64(data)
        };
        const json = JSON.stringify(body) + "\n";
        return {json, checksum, size, payload: payloadBytes(json)};
      }
      let candidate = makePart(Math.min(chunkBytes, gzip.length - offset));
      if (candidate.payload > maxPayloadBytes) {
        let low = 1, high = candidate.size - 1, best = null;
        while (low <= high) {
          const middle = Math.floor((low + high) / 2), trial = makePart(middle);
          if (trial.payload <= maxPayloadBytes) { best = trial; low = middle + 1; }
          else high = middle - 1;
        }
        if (!best) throw new Error("Transport budget cannot contain one source byte and metadata");
        candidate = best;
      }
      const stamp = identity(candidate.json);
      const part = {
        git_blob: stamp.git_blob, json_bytes: stamp.bytes, json_sha256: stamp.sha256,
        index, offset, bytes: candidate.size, sha256: candidate.checksum
      };
      descriptor.parts.push(part);
      parts.push({...part, bank: bank.name, json: candidate.json, payload_bytes: candidate.payload});
      offset += candidate.size;
    }
    manifest.banks.push(descriptor);
  }
  const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
  if (payloadBytes(manifestJson) > maxPayloadBytes) {
    throw new Error("Manifest exceeds transport budget; use fewer banks per transfer or a larger verified envelope");
  }
  return {
    manifest, manifestJson, manifestIdentity: identity(manifestJson), parts,
    payloadBudget: {maxPayloadBytes, reserveBytes, chunkBytes}
  };
}
return Object.freeze({prepareTransfer, identity});

});
