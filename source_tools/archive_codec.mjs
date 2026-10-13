// Copyright TokenJunkieLabs. Pure JavaScript archive primitives; no filesystem, network or code evaluation.
// High-level limits and portable paths are enforced by source_bank.mjs.
export function createArchiveCodec() {
  "use strict";
  const fail = message => { throw new Error("archive_codec: " + message); };
  const bytes = value => value instanceof Uint8Array ? value : Uint8Array.from(value);
  function utf8Encode(text) {
    const out = [];
    for (let i = 0; i < text.length; i++) {
      let c = text.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const low = text.charCodeAt(++i);
        if (!(low >= 0xdc00 && low <= 0xdfff)) fail("unpaired UTF-16 surrogate");
        c = 0x10000 + ((c - 0xd800) << 10) + low - 0xdc00;
      } else if (c >= 0xdc00 && c <= 0xdfff) fail("unpaired UTF-16 surrogate");
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >>> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >>> 12), 0x80 | ((c >>> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >>> 18), 0x80 | ((c >>> 12) & 63), 0x80 | ((c >>> 6) & 63), 0x80 | (c & 63));
    }
    return Uint8Array.from(out);
  }
  function utf8Decode(input) {
    const a = bytes(input), chunks = [], part = [];
    for (let i = 0; i < a.length;) {
      const first = a[i++]; let c, count, minimum;
      if (first < 128) { c = first; count = 0; minimum = 0; }
      else if (first >= 0xc2 && first <= 0xdf) { c = first & 31; count = 1; minimum = 0x80; }
      else if (first >= 0xe0 && first <= 0xef) { c = first & 15; count = 2; minimum = 0x800; }
      else if (first >= 0xf0 && first <= 0xf4) { c = first & 7; count = 3; minimum = 0x10000; }
      else fail("invalid UTF-8 lead byte");
      for (let k = 0; k < count; k++) {
        if (i >= a.length || (a[i] & 0xc0) !== 0x80) fail("invalid UTF-8 continuation");
        c = (c << 6) | (a[i++] & 63);
      }
      if (c < minimum || c > 0x10ffff || (c >= 0xd800 && c <= 0xdfff)) fail("invalid UTF-8 scalar");
      if (c <= 0xffff) part.push(c);
      else { c -= 0x10000; part.push(0xd800 | (c >>> 10), 0xdc00 | (c & 1023)); }
      if (part.length >= 8192) { chunks.push(String.fromCharCode(...part)); part.length = 0; }
    }
    if (part.length) chunks.push(String.fromCharCode(...part));
    return chunks.join("");
  }
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function base64Decode(text) {
    const s = String(text).replace(/[ \t\r\n]/g, "");
    if (s.length % 4) fail("invalid base64 length");
    const padding = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
    const out = new Uint8Array(s.length / 4 * 3 - padding); let p = 0;
    for (let i = 0; i < s.length; i += 4) {
      const a = alphabet.indexOf(s[i]), b = alphabet.indexOf(s[i + 1]);
      const last = i + 4 === s.length;
      const c = s[i + 2] === "=" ? -2 : alphabet.indexOf(s[i + 2]);
      const d = s[i + 3] === "=" ? -2 : alphabet.indexOf(s[i + 3]);
      if (a < 0 || b < 0 || c === -1 || d === -1 ||
          (c === -2 && (!last || d !== -2)) || (d === -2 && !last))
        fail("invalid base64 alphabet or padding");
      if ((c === -2 && (b & 15)) || (d === -2 && c >= 0 && (c & 3)))
        fail("noncanonical base64 padding");
      const v = (a << 18) | (b << 12) | (Math.max(c, 0) << 6) | Math.max(d, 0);
      if (p < out.length) out[p++] = v >>> 16;
      if (p < out.length) out[p++] = (v >>> 8) & 255;
      if (p < out.length) out[p++] = v & 255;
    }
    return out;
  }
  function base64Encode(input) {
    const a = bytes(input), chunks = []; let part = "";
    for (let i = 0; i < a.length; i += 3) {
      const remain = a.length - i, v = (a[i] << 16) | ((a[i + 1] || 0) << 8) | (a[i + 2] || 0);
      part += alphabet[(v >>> 18) & 63] + alphabet[(v >>> 12) & 63] +
        (remain > 1 ? alphabet[(v >>> 6) & 63] : "=") + (remain > 2 ? alphabet[v & 63] : "=");
      if (part.length >= 8192) { chunks.push(part); part = ""; }
    }
    if (part) chunks.push(part);
    return chunks.join("");
  }
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[i] = c >>> 0;
  }
  function crc32(input) {
    let c = 0xffffffff;
    for (const v of bytes(input)) c = crcTable[(c ^ v) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  const shaK = Uint32Array.from([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ]);
  const rotate = (x, n) => (x >>> n) | (x << (32 - n));
  function sha256(input) {
    const a = typeof input === "string" ? utf8Encode(input) : bytes(input);
    const n = a.length, padded = new Uint8Array(Math.ceil((n + 9) / 64) * 64);
    padded.set(a); padded[n] = 128;
    const high = Math.floor(n / 0x20000000), low = (n * 8) >>> 0;
    for (let i = 0; i < 4; i++) {
      padded[padded.length - 8 + i] = (high >>> (24 - i * 8)) & 255;
      padded[padded.length - 4 + i] = (low >>> (24 - i * 8)) & 255;
    }
    const h = Uint32Array.from([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    const w = new Uint32Array(64);
    for (let offset = 0; offset < padded.length; offset += 64) {
      for (let i = 0; i < 16; i++) {
        const p = offset + i * 4;
        w[i] = ((padded[p] << 24) | (padded[p + 1] << 16) | (padded[p + 2] << 8) | padded[p + 3]) >>> 0;
      }
      for (let i = 16; i < 64; i++) {
        const x = w[i - 15], y = w[i - 2];
        w[i] = ((rotate(x,7) ^ rotate(x,18) ^ (x >>> 3)) + w[i - 16] +
                (rotate(y,17) ^ rotate(y,19) ^ (y >>> 10)) + w[i - 7]) >>> 0;
      }
      let [v0,v1,v2,v3,v4,v5,v6,v7] = h;
      for (let i = 0; i < 64; i++) {
        const t1 = (v7 + (rotate(v4,6) ^ rotate(v4,11) ^ rotate(v4,25)) +
                    ((v4 & v5) ^ (~v4 & v6)) + shaK[i] + w[i]) >>> 0;
        const t2 = ((rotate(v0,2) ^ rotate(v0,13) ^ rotate(v0,22)) +
                    ((v0 & v1) ^ (v0 & v2) ^ (v1 & v2))) >>> 0;
        v7=v6;v6=v5;v5=v4;v4=(v3+t1)>>>0;v3=v2;v2=v1;v1=v0;v0=(t1+t2)>>>0;
      }
      for (const [i,v] of [v0,v1,v2,v3,v4,v5,v6,v7].entries()) h[i] = (h[i] + v) >>> 0;
    }
    return Array.from(h, v => v.toString(16).padStart(8,"0")).join("");
  }
  const lengthBase = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  const lengthExtra = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  const distanceBase = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  const distanceExtra = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  function reverse(value, count) { let out=0; for(let i=0;i<count;i++){out=(out<<1)|(value&1);value>>>=1;} return out; }
  function huffman(lengths) {
    const count = new Uint16Array(16), next = new Uint16Array(16), maps = [], codes = [];
    let max=0, code=0, left=1;
    for (const length of lengths) { if(length<0 || length>15) fail("invalid Huffman length"); if(length){count[length]++;max=Math.max(max,length);} }
    for(let n=1;n<=15;n++){left=(left<<1)-count[n];if(left<0)fail("oversubscribed Huffman tree");code=(code+count[n-1])<<1;next[n]=code;if(count[n])maps[n]=new Map();}
    for(let symbol=0;symbol<lengths.length;symbol++){
      const n=lengths[symbol];if(n){const rev=reverse(next[n]++,n);maps[n].set(rev,symbol);codes[symbol]=[rev,n];}
    }
    return {maps,max,codes};
  }
  const fixedLengths = Array.from({length:288},(_,i)=>i<144?8:i<256?9:i<280?7:8);
  const fixedLiteral = huffman(fixedLengths), fixedDistance = huffman(Array(32).fill(5));
  function inflateRaw(input, offset=0, maxOutputBytes=134217728) {
    const a=bytes(input);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > a.length ||
        !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0 || maxOutputBytes > 0x7fffffff)
      fail("invalid inflate offset or output limit");
    let position=offset, buffer=0, buffered=0, output=new Uint8Array(Math.min(65536,maxOutputBytes)), used=0;
    function read(n){while(buffered<n){if(position>=a.length)fail("truncated deflate stream");buffer|=a[position++]<<buffered;buffered+=8;}const v=buffer&((1<<n)-1);buffer>>>=n;buffered-=n;return v;}
    function emit(v){if(used>=maxOutputBytes)fail("decompressed size exceeds maxOutputBytes");if(used===output.length){const grown=new Uint8Array(Math.min(maxOutputBytes,Math.max(1,output.length*2)));grown.set(output);output=grown;}output[used++]=v;}
    function decode(tree){let code=0;for(let n=1;n<=tree.max;n++){code|=read(1)<<(n-1);const symbol=tree.maps[n]?.get(code);if(symbol!==undefined)return symbol;}fail("invalid Huffman code");}
    let final=0;
    do {
      final=read(1);const type=read(2);
      if(type===0){
        buffer=0;buffered=0;
        const size=read(16), complement=read(16);
        if(((size^0xffff)&0xffff)!==complement)fail("invalid stored-block length");
        for(let i=0;i<size;i++)emit(read(8));
        continue;
      }
      let literal, distance;
      if(type===1){literal=fixedLiteral;distance=fixedDistance;}
      else if(type===2){
        const literalCount=read(5)+257,distanceCount=read(5)+1,codeCount=read(4)+4;
        const order=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15],codeLengths=Array(19).fill(0);
        for(let i=0;i<codeCount;i++)codeLengths[order[i]]=read(3);
        const codeTree=huffman(codeLengths),lengths=[];
        while(lengths.length<literalCount+distanceCount){
          const value=decode(codeTree);let repeat=1,length=value;
          if(value===16){if(!lengths.length)fail("repeat without previous code");length=lengths[lengths.length-1];repeat=read(2)+3;}
          else if(value===17){length=0;repeat=read(3)+3;}
          else if(value===18){length=0;repeat=read(7)+11;}
          else if(value>18)fail("invalid code-length symbol");
          if(lengths.length+repeat>literalCount+distanceCount)fail("code-length repeat overflow");
          for(let j=0;j<repeat;j++)lengths.push(length);
        }
        if(!lengths[256])fail("missing end-of-block code");
        literal=huffman(lengths.slice(0,literalCount));distance=huffman(lengths.slice(literalCount));
      } else fail("reserved deflate block type");
      while(true){
        const symbol=decode(literal);
        if(symbol<256){emit(symbol);continue;}
        if(symbol===256)break;
        if(symbol<257 || symbol>285)fail("invalid length symbol");
        const li=symbol-257,len=lengthBase[li]+read(lengthExtra[li]),ds=decode(distance);
        if(ds>29)fail("invalid distance symbol");
        const back=distanceBase[ds]+read(distanceExtra[ds]);
        if(back>used)fail("distance precedes output");
        for(let j=0;j<len;j++)emit(output[used-back]);
      }
    } while(!final);
    return {bytes:output.slice(0,used),nextOffset:position};
  }
  const read32 = (a,p) => ((a[p]|(a[p+1]<<8)|(a[p+2]<<16)|(a[p+3]<<24))>>>0);
  function gunzipDetailed(input, {maxOutputBytes=134217728,maxMembers=1024}={}) {
    const a=bytes(input), chunks=[], members=[];let p=0,total=0;
    if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0 || maxOutputBytes > 0x7fffffff ||
        !Number.isSafeInteger(maxMembers) || maxMembers < 1) fail("invalid gzip limits");
    while(p<a.length){
      if (members.length >= maxMembers) fail("gzip member limit exceeded");
      const start=p;
      if(p+10>a.length || a[p]!==31 || a[p+1]!==139 || a[p+2]!==8)fail("invalid gzip header");
      const flags=a[p+3];if(flags&0xe0)fail("reserved gzip flags");p+=10;
      if(flags&4){if(p+2>a.length)fail("truncated gzip extra");const n=a[p]|(a[p+1]<<8);p+=2+n;if(p>a.length)fail("truncated gzip extra");}
      for(const flag of [8,16])if(flags&flag){while(p<a.length && a[p]!==0)p++;if(p>=a.length)fail("unterminated gzip header");p++;}
      if(flags&2){if(p+2>a.length || (crc32(a.subarray(start,p))&0xffff)!==(a[p]|(a[p+1]<<8)))fail("gzip header CRC mismatch");p+=2;}
      const decoded=inflateRaw(a,p,maxOutputBytes-total);p=decoded.nextOffset;
      if(p+8>a.length)fail("truncated gzip trailer");
      const expectedCrc=read32(a,p),expectedSize=read32(a,p+4),actualCrc=crc32(decoded.bytes);
      if(actualCrc!==expectedCrc)fail("gzip CRC32 mismatch");
      if((decoded.bytes.length>>>0)!==expectedSize)fail("gzip ISIZE mismatch");
      p+=8;total+=decoded.bytes.length;chunks.push(decoded.bytes);
      members.push({start,end:p,bytes:decoded.bytes.length,crc32:actualCrc.toString(16).padStart(8,"0")});
    }
    if(!members.length)fail("empty gzip input");
    const out=new Uint8Array(total);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}
    return {bytes:out,members};
  }
  function deflateRaw(input) {
    const a=bytes(input), out=[];let buffer=0,buffered=0;
    function write(v,n){buffer|=v<<buffered;buffered+=n;while(buffered>=8){out.push(buffer&255);buffer>>>=8;buffered-=8;}}
    const symbol=(tree,s)=>{const pair=tree.codes[s];write(pair[0],pair[1]);};
    write(3,3);
    const heads=new Int32Array(65536).fill(-1),previous=new Int32Array(a.length).fill(-1);
    const hash=p=>((a[p]*251+a[p+1])*251+a[p+2])&65535;
    function insert(p){if(p+2<a.length){const h=hash(p);previous[p]=heads[h];heads[h]=p;}}
    for(let p=0;p<a.length;){
      let best=2,bestDistance=0;
      if(p+2<a.length){
        let candidate=heads[hash(p)],remaining=64;const maximum=Math.min(258,a.length-p);
        while(candidate>=0 && p-candidate<=32768 && remaining--){
          if(a[candidate]===a[p] && a[candidate+1]===a[p+1] && a[candidate+best]===a[p+best]){
            let len=2;while(len<maximum && a[candidate+len]===a[p+len])len++;
            if(len>best){best=len;bestDistance=p-candidate;if(len===maximum)break;}
          }
          candidate=previous[candidate];
        }
      }
      if(bestDistance && best>=3){
        let li=0;while(li+1<lengthBase.length && lengthBase[li+1]<=best)li++;
        symbol(fixedLiteral,257+li);write(best-lengthBase[li],lengthExtra[li]);
        let di=0;while(di+1<distanceBase.length && distanceBase[di+1]<=bestDistance)di++;
        symbol(fixedDistance,di);write(bestDistance-distanceBase[di],distanceExtra[di]);
        for(let j=0;j<best;j++)insert(p+j);p+=best;
      }else{symbol(fixedLiteral,a[p]);insert(p);p++;}
    }
    symbol(fixedLiteral,256);if(buffered)out.push(buffer&255);return Uint8Array.from(out);
  }
  function gzip(input) {
    const a=typeof input==="string"?utf8Encode(input):bytes(input), compressed=deflateRaw(a);
    const out=new Uint8Array(18+compressed.length);out.set([31,139,8,0,0,0,0,0,0,255]);out.set(compressed,10);
    const crc=crc32(a),size=a.length>>>0;for(let i=0;i<4;i++){out[out.length-8+i]=(crc>>>(8*i))&255;out[out.length-4+i]=(size>>>(8*i))&255;}
    return out;
  }
  function decodeSourceBank(encoded,expectedSha256) {
    const packed=base64Decode(encoded),decoded=gunzipDetailed(packed),digest=sha256(decoded.bytes);
    if(expectedSha256 && digest!==expectedSha256.toLowerCase())fail("source-bank SHA256 mismatch: "+digest);
    const text=utf8Decode(decoded.bytes),bank=JSON.parse(text);
    return {bank,text,bytes:decoded.bytes.length,sha256:digest,gzipBase64:base64Encode(packed),gzipBytes:packed.length,gzipSha256:sha256(packed),members:decoded.members};
  }
  function encodeSourceBank(bankOrText) {
    const text=typeof bankOrText==="string"?bankOrText:JSON.stringify(bankOrText),raw=utf8Encode(text),packed=gzip(raw);
    return {text,bytes:raw.length,sha256:sha256(raw),gzipBase64:base64Encode(packed),gzipBytes:packed.length,gzipSha256:sha256(packed)};
  }
  return {utf8Encode,utf8Decode,base64Encode,base64Decode,crc32,sha256,inflateRaw,
          gunzip:(input,options)=>gunzipDetailed(input,options).bytes,gunzipDetailed,deflateRaw,gzip,
          decodeSourceBank,encodeSourceBank};
}
