// Portable source carrier encoding and decoding.
// Pure JavaScript source transport for runtimes without Node, filesystem or browser APIs.
// encodeApplicationCarrier returns the complete numbered carrier accepted by the existing Python receiver.

function fromBase64(s) {
  s=s.replace(/\s+/g,""); if(!/^[A-Za-z0-9+/]*={0,2}$/.test(s)||s.length%4)throw Error("bad base64");
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const padding=s.endsWith("==")?2:s.endsWith("=")?1:0;
  const out=new Uint8Array(s.length/4*3-padding);
  let val=0,bits=0,position=0;
  for (let ch of s) { if(ch==="=")break; val=(val<<6)|alphabet.indexOf(ch);bits+=6;if(bits>=8){bits-=8;out[position++]=(val>>>bits)&255;} }
  return out;
}
const CRC32_TABLE=new Uint32Array(256);
for(let i=0;i<256;i++){let value=i;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);CRC32_TABLE[i]=value;}
function crc32Bytes(bytes) {
  let crc=~0;
  for(const value of bytes)crc=(crc>>>8)^CRC32_TABLE[(crc^value)&255];
  return (~crc)>>>0;
}
function inflateGzip(data) {
 if(data.length<18||data[0]!==31||data[1]!==139||data[2]!==8)throw Error("not gzip");let p=10,f=data[3];
 if(f&4){let n=data[p]|data[p+1]<<8;p+=2+n;}if(f&8){while(data[p++]){}}if(f&16){while(data[p++]){}}if(f&2)p+=2;
 let bi=p*8;function bits(n){let x=0;for(let j=0;j<n;j++){if((bi>>3)>=data.length-8)throw Error("truncated deflate");x|=((data[bi>>3]>>(bi&7))&1)<<j;bi++;}return x;}
 function tree(lengths){let count=new Array(16).fill(0),next=new Array(16).fill(0),maps=Array.from({length:16},()=>new Map()),max=0,c=0;lengths.forEach(n=>{if(n){count[n]++;max=Math.max(max,n);}});for(let n=1;n<=15;n++){c=(c+count[n-1])<<1;next[n]=c;}lengths.forEach((n,s)=>{if(!n)return;let x=next[n]++,r=0;for(let i=0;i<n;i++){r=(r<<1)|(x&1);x>>>=1;}maps[n].set(r,s);});return{maps,max};}
 function sym(t){let c=0;for(let n=1;n<=t.max;n++){c|=bits(1)<<(n-1);if(t.maps[n].has(c))return t.maps[n].get(c);}throw Error("invalid huffman");}
 const lb=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258],le=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0],db=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577],de=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
 // The existing 64 MiB source limit also bounds the output allocation.
 const size=(data[data.length-4]|data[data.length-3]<<8|data[data.length-2]<<16|data[data.length-1]<<24)>>>0;
 if(size>64*1024*1024)throw Error("inflation limit");
 const out=new Uint8Array(size);let written=0,last=0;
 while(!last){last=bits(1);let type=bits(2);if(type===0){bi=(bi+7)&~7;let n=bits(16),nn=bits(16);if((n^nn)!==65535)throw Error("bad stored length");if(written+n>size)throw Error("size mismatch");for(let i=0;i<n;i++)out[written++]=bits(8);continue;}if(type===3)throw Error("reserved deflate");
 let lit,dist;
 if(type===1){let lens=Array.from({length:288},(_,s)=>s<144?8:s<256?9:s<280?7:8);lit=tree(lens);dist=tree(new Array(32).fill(5));}
 else {let nl=bits(5)+257,nd=bits(5)+1,nc=bits(4)+4,order=[16,17,18,0,8,7,9,6,10,5,11,4,10,5],cl=new Array(19).fill(0);order=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];for(let i=0;i<nc;i++)cl[order[i]]=bits(3);let ct=tree(cl),lens=[];while(lens.length<nl+nd){let s=sym(ct);if(s<=15)lens.push(s);else{let count=s===16?bits(2)+3:s===17?bits(3)+3:bits(7)+11;let v=s===16?lens[lens.length-1]:0;if(v===undefined)throw Error("invalid repeat");for(let i=0;i<count;i++)lens.push(v);}}if(lens.length!==nl+nd)throw Error("excess lengths");lit=tree(lens.slice(0,nl));dist=tree(lens.slice(nl));}
 for(;;){let s=sym(lit);if(s<256){if(written>=size)throw Error("size mismatch");out[written++]=s;continue;}if(s===256)break;s-=257;if(s<0||s>=lb.length)throw Error("bad length");let len=lb[s]+bits(le[s]),d=sym(dist);if(d>=30)throw Error("bad distance");d=db[d]+bits(de[d]);if(d>written)throw Error("past start");if(written+len>size)throw Error("size mismatch");for(let i=0;i<len;i++){out[written]=out[written-d];written++;}}}
 if(written!==size)throw Error("size mismatch");
 const crc=crc32Bytes(out),expected=(data[data.length-8]|data[data.length-7]<<8|data[data.length-6]<<16|data[data.length-5]<<24)>>>0;if(crc!==expected)throw Error("crc mismatch");return out;
}
function utf8Decode(bytes) {
 const chunks=[];let codes=[];
 function flush(){if(codes.length){chunks.push(String.fromCharCode(...codes));codes=[];}}
 for(let i=0;i<bytes.length;){
  let c=bytes[i++],v=c;
  if(c>=128){let n=c<224?1:c<240?2:3;v=c&((1<<(6-n))-1);while(n--){let b=bytes[i++];if((b&192)!==128)throw Error("bad utf8");v=(v<<6)|(b&63);}}
  if(v<=65535)codes.push(v);else{if(v>0x10ffff)throw new RangeError("Invalid code point");v-=0x10000;codes.push(0xd800+(v>>10),0xdc00+(v&1023));}
  if(codes.length>=8192)flush();
 }
 flush();return chunks.join("");
}
function utf8Encode(s) {
  let size=0;
  for(const ch of s){const c=ch.codePointAt(0);size+=c<128?1:c<2048?2:c<65536?3:4;}
  const out=new Uint8Array(size);let position=0;
  for(const ch of s){
    const c=ch.codePointAt(0);
    if(c<128)out[position++]=c;
    else if(c<2048){out[position++]=192|(c>>6);out[position++]=128|(c&63);}
    else if(c<65536){out[position++]=224|(c>>12);out[position++]=128|((c>>6)&63);out[position++]=128|(c&63);}
    else{out[position++]=240|(c>>18);out[position++]=128|((c>>12)&63);out[position++]=128|((c>>6)&63);out[position++]=128|(c&63);}
  }
  return out;
}

function sha256Bytes(bytes) {
  const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const H=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  // Hash complete blocks in place; only the final one or two blocks need padding.
  const complete=bytes.length-bytes.length%64;
  const tail=new Uint8Array(bytes.length%64<56?64:128);
  tail.set(typeof bytes.subarray==="function"?bytes.subarray(complete):bytes.slice(complete));tail[bytes.length-complete]=128;
  let bitLength=bytes.length*8;
  for(let i=0;i<8;i++){tail[tail.length-1-i]=bitLength%256;bitLength=Math.floor(bitLength/256);}
  const words=new Uint32Array(64),rotate=(x,n)=>(x>>>n)|(x<<(32-n));
  for(let offset=0;offset<complete+tail.length;offset+=64){
    const input=offset<complete?bytes:tail,at=offset<complete?offset:offset-complete;
    for(let i=0;i<16;i++){const j=at+i*4;words[i]=(input[j]<<24)|(input[j+1]<<16)|(input[j+2]<<8)|input[j+3];}
    for(let i=16;i<64;i++){const a=words[i-15],b=words[i-2];words[i]=(words[i-16]+(rotate(a,7)^rotate(a,18)^(a>>>3))+words[i-7]+(rotate(b,17)^rotate(b,19)^(b>>>10)))>>>0;}
    let a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
    for(let i=0;i<64;i++){
      const first=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+K[i]+words[i])>>>0;
      const second=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;
      h=g;g=f;f=e;e=(d+first)>>>0;d=c;c=b;b=a;a=(first+second)>>>0;
    }
    H[0]+=a;H[1]+=b;H[2]+=c;H[3]+=d;H[4]+=e;H[5]+=f;H[6]+=g;H[7]+=h;
  }
  return Array.from(H,x=>x.toString(16).padStart(8,"0")).join("");
}
function toBase64(bytes){const a="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";let s="";for(let i=0;i<bytes.length;i+=3){const n=(bytes[i]<<16)|((bytes[i+1]||0)<<8)|(bytes[i+2]||0);s+=a[(n>>>18)&63]+a[(n>>>12)&63]+(i+1<bytes.length?a[(n>>>6)&63]:"=")+(i+2<bytes.length?a[n&63]:"=");}return s;}

function gzipBytes(bytes) {
  const lengthBase=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  const lengthExtra=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  const distanceBase=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  const distanceExtra=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  const reverse=(value,n)=>{let result=0;while(n--){result=(result<<1)|(value&1);value>>>=1;}return result;};
  const codes=new Uint16Array(288),lengths=new Uint8Array(288);
  for(let symbol=0;symbol<288;symbol++){
    let value,n;if(symbol<144){value=symbol+48;n=8;}else if(symbol<256){value=symbol-144+400;n=9;}else if(symbol<280){value=symbol-256;n=7;}else{value=symbol-280+192;n=8;}
    codes[symbol]=reverse(value,n);lengths[symbol]=n;
  }
  const output=[31,139,8,0,0,0,0,0,0,255];let accumulator=0,bits=0;
  const put=(value,n)=>{accumulator|=value<<bits;bits+=n;while(bits>=8){output.push(accumulator&255);accumulator>>>=8;bits-=8;}};
  const symbol=value=>put(codes[value],lengths[value]);
  put(1,1);put(1,2);
  // DEFLATE references only its preceding 32 KiB. Reusing these slots retains
  // the same candidate order and compressed bytes for any input length.
  const heads=new Int32Array(65536).fill(-1),previous=new Int32Array(32768).fill(-1);
  const hash=position=>(((bytes[position]*251+bytes[position+1])*251+bytes[position+2])&65535);
  const insert=position=>{if(position+2>=bytes.length)return;let h=hash(position);previous[position&32767]=heads[h];heads[h]=position;};
  let position=0;
  while(position<bytes.length){
    let bestLength=0,bestDistance=0;
    const maximum=Math.min(258,bytes.length-position);
    if(maximum>=3){
      let candidate=heads[hash(position)],searched=0,minimum=Math.max(0,position-32768);
      while(candidate>=minimum&&candidate>=0&&searched++<64){
        if(bytes[candidate]===bytes[position]&&bytes[candidate+1]===bytes[position+1]&&bytes[candidate+2]===bytes[position+2]){
          let length=3;while(length<maximum&&bytes[candidate+length]===bytes[position+length])length++;
          if(length>bestLength){bestLength=length;bestDistance=position-candidate;if(length===maximum)break;}
        }
        candidate=previous[candidate&32767];
      }
    }
    if(bestLength>=3){
      let code=0;while(code<28&&bestLength>=lengthBase[code+1])code++;
      symbol(257+code);put(bestLength-lengthBase[code],lengthExtra[code]);
      code=0;while(code<29&&bestDistance>=distanceBase[code+1])code++;
      put(reverse(code,5),5);put(bestDistance-distanceBase[code],distanceExtra[code]);
      const end=position+bestLength;while(position<end)insert(position++);
    }else{symbol(bytes[position]);insert(position);position++;}
  }
  symbol(256);if(bits)output.push(accumulator&255);
  const crc=crc32Bytes(bytes);
  for(let i=0;i<4;i++)output.push((crc>>>(8*i))&255);
  const size=bytes.length>>>0;for(let i=0;i<4;i++)output.push((size>>>(8*i))&255);
  return new Uint8Array(output);
}

function encodeApplicationCarrier(document, {title="Upper Savannah complete application source", chunkChars=28000}={}) {
  if(!document || document.schema!=="commons.source-map/1" || document.kind!=="upstate.complete-application-source/v1")throw Error("Choose the complete application source map");
  if(!Number.isInteger(chunkChars)||chunkChars<1024||chunkChars>100000||chunkChars%4)throw Error("Choose a base64 part length divisible by four");
  const names=Object.keys(document.files||{}).sort(),metadata=document.file_metadata||{};
  if(!names.length||names.length!==Object.keys(metadata).length)throw Error("Source inventory differs");
  let sourceBytes=0;
  for(const name of names){
    if(typeof document.files[name]!=="string"||!name||name.startsWith("/")||name.includes("\\")||name.split("/").some(p=>!p||p==="."||p===".."||p.includes(":")))throw Error("Invalid source member");
    const entry=metadata[name],encoding=entry?.encoding||"utf-8";
    if(!["utf-8","utf8","base64"].includes(encoding))throw Error("Unsupported member encoding: "+name);
    const body=encoding==="base64"?fromBase64(document.files[name]):utf8Encode(document.files[name]);
    if(!entry||entry.bytes!==body.length||entry.sha256!==sha256Bytes(body)||!["100644","100755"].includes(entry.mode))throw Error("Source identity differs: "+name);
    sourceBytes+=body.length;
  }
  const bytes=utf8Encode(JSON.stringify(document,null,2)+"\n"),compressed=gzipBytes(bytes),encoded=toBase64(compressed),count=Math.ceil(encoded.length/chunkChars);
  const common={schema:"upstate.application-source-part/v1",edition:document.edition,encoding:"gzip+base64",parts:count,payload_bytes:bytes.length,payload_sha256:sha256Bytes(bytes),compressed_bytes:compressed.length,compressed_sha256:sha256Bytes(compressed),files:names.length,source_bytes:sourceBytes};
  const parts=Array.from({length:count},(_,i)=>({...common,part:i+1,data:encoded.slice(i*chunkChars,(i+1)*chunkChars)}));
  const fence=String.fromCharCode(96).repeat(3);
  const markdown="# "+title+"\n\nEdition: "+document.edition+"\nSource: "+document.source_ref+"\n\n"+names.length+" complete files; "+sourceBytes+" source bytes. Decoded JSON SHA256 "+common.payload_sha256+". Gzip SHA256 "+common.compressed_sha256+". The numbered parts are accepted by source_tools/application_assembly.py. All-text maps also work with receive_application_source.py.\n\n"+parts.map(part=>fence+"json\n"+JSON.stringify(part)+"\n"+fence).join("\n\n")+"\n";
  return {metadata:common,parts,markdown};
}


// Complete native source documents share the existing Python receiver's format.
const NATIVE_SOURCE_SCHEMA = "upstate.complete-application-transport/v1";
const NATIVE_SOURCE_BEGIN = "BEGIN_UPSTATE_SOURCE_GZIP_BASE64";
const NATIVE_SOURCE_END = "END_UPSTATE_SOURCE_GZIP_BASE64";
function nativeCanonical(value) {
  if (Array.isArray(value)) return "[" + value.map(nativeCanonical).join(",") + "]";
  if (value && typeof value === "object")
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + nativeCanonical(value[key])).join(",") + "}";
  return JSON.stringify(value);
}
function nativeSourceMembers(bank) {
  if (!bank || bank.schema !== NATIVE_SOURCE_SCHEMA || !bank.files ||
      typeof bank.files !== "object" || Array.isArray(bank.files) ||
      !bank.file_metadata || typeof bank.file_metadata !== "object" ||
      Array.isArray(bank.file_metadata))
    throw Error("A complete native application source bank is required");
  if (typeof bank.operation_id !== "string" || !bank.operation_id.trim() ||
      typeof bank.edition !== "string" || !bank.edition.trim())
    throw Error("The native source bank requires its operation and edition identities");
  const names = Object.keys(bank.files).sort();
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(bank.file_metadata).sort()))
    throw Error("Every native source member needs its original metadata");
  const seen = new Set();
  let sourceBytes = 0;
  function member(path, bytes, metadata) {
    if (typeof path !== "string" || !path || path.includes("\\") || path.includes("\0") ||
        path.startsWith("/") || path.split("/").some(part => !part || part === "." || part === ".."))
      throw Error("Native source paths must be relative to the application");
    if (seen.has(path)) throw Error("Duplicate native source member: " + path);
    if (!metadata || metadata.bytes !== bytes.length || metadata.sha256 !== sha256Bytes(bytes))
      throw Error("Original native source bytes differ: " + path);
    seen.add(path);
    sourceBytes += bytes.length;
  }
  for (const path of names) {
    const content = bank.files[path], metadata = bank.file_metadata[path];
    if (typeof content !== "string" || !metadata ||
        (metadata.encoding !== undefined && metadata.encoding !== "utf-8"))
      throw Error("A complete UTF-8 source body is required: " + path);
    member(path, utf8Encode(content), metadata);
  }
  const binary = bank.binary_files === undefined ? [] : bank.binary_files;
  if (!Array.isArray(binary)) throw Error("Original binary members must be an array");
  for (const row of binary) {
    if (!row || typeof row.content_base64 !== "string")
      throw Error("An original binary source body is required");
    member(row.path, fromBase64(row.content_base64), row);
  }
  return {sourceFileCount: seen.size, sourceBytes};
}
function nativeTransportPayload(metadata, base64) {
  if (!metadata || metadata.schema !== NATIVE_SOURCE_SCHEMA)
    throw Error("Unsupported native source transport");
  const compressedBytes = fromBase64(base64);
  if (compressedBytes.length !== metadata.gzip_bytes ||
      sha256Bytes(compressedBytes) !== metadata.gzip_sha256)
    throw Error("The complete compressed source differs from its original transport");
  const bytes = inflateGzip(compressedBytes);
  if (bytes.length !== metadata.json_bytes || sha256Bytes(bytes) !== metadata.json_sha256)
    throw Error("The decoded complete source differs from its original transport");
  const jsonText = utf8Decode(bytes), bank = JSON.parse(jsonText);
  const inventory = nativeSourceMembers(bank);
  if (metadata.operation_id !== bank.operation_id || metadata.edition !== bank.edition)
    throw Error("The native transport and complete bank have different source identities");
  if (metadata.source_file_count !== undefined &&
      metadata.source_file_count !== inventory.sourceFileCount)
    throw Error("The native source file count differs from its complete inventory");
  return {metadata, bank, jsonText, base64, compressedBytes, ...inventory};
}
function decodeNativeSourceDocuments(documents) {
  if (typeof documents === "string") documents = [documents];
  if (!Array.isArray(documents) || !documents.length ||
      documents.some(text => typeof text !== "string"))
    throw Error("Provide the complete source document or all of its exported text parts");
  const received = documents.map(document => {
    const text = document.replace(/^\uFEFF/, ""), lines = text.split(/\r?\n/);
    const starts = [], ends = [];
    lines.forEach((line, index) => {
      if (line.trim() === NATIVE_SOURCE_BEGIN) starts.push(index);
      if (line.trim() === NATIVE_SOURCE_END) ends.push(index);
    });
    if (starts.length !== 1 || ends.length !== 1 || ends[0] <= starts[0])
      throw Error("Each source document must contain one complete source part");
    const headers = lines.slice(0, starts[0]);
    const metadataRows = headers.filter(line => line.startsWith("SOURCE_TRANSPORT_METADATA="));
    const partRows = headers.filter(line => line.startsWith("SOURCE_TRANSPORT_PART="));
    if (metadataRows.length !== 1 || partRows.length > 1)
      throw Error("Missing or duplicate native source transport metadata");
    const metadata = JSON.parse(metadataRows[0].slice("SOURCE_TRANSPORT_METADATA=".length));
    const part = partRows.length ? JSON.parse(partRows[0].slice("SOURCE_TRANSPORT_PART=".length)) : null;
    const base64 = lines.slice(starts[0] + 1, ends[0]).join("").replace(/\s+/g, "");
    if (part !== null) {
      if (!part || !Number.isSafeInteger(part.part) || !Number.isSafeInteger(part.parts) ||
          part.parts < 1 || part.part < 1 || part.part > part.parts)
        throw Error("Invalid original source part identity");
      if (base64.length !== part.base64_chars ||
          sha256Bytes(utf8Encode(base64)) !== part.base64_sha256)
        throw Error("An exported source part differs from its original content");
    }
    return {metadata, part, base64};
  });
  const metadata = received[0].metadata, identity = nativeCanonical(metadata);
  if (received.some(row => nativeCanonical(row.metadata) !== identity))
    throw Error("The exported source parts belong to different application editions");
  let ordered;
  if (received.every(row => row.part === null)) {
    if (received.length !== 1)
      throw Error("Multiple source documents require original numbered part metadata");
    ordered = received;
  } else {
    if (received.some(row => row.part === null))
      throw Error("A numbered application source part is missing its metadata");
    const total = received[0].part.parts;
    ordered = received.slice().sort((a, b) => a.part.part - b.part.part);
    if (ordered.length !== total ||
        ordered.some((row, index) => row.part.parts !== total || row.part.part !== index + 1))
      throw Error("Receive every original application source part exactly once");
  }
  return nativeTransportPayload(metadata, ordered.map(row => row.base64).join(""));
}

function nativeSourceBank(source, operationId) {
  if (source && source.schema === NATIVE_SOURCE_SCHEMA) return source;
  if (!source || source.schema !== "commons.source-map/1" ||
      source.kind !== "upstate.complete-application-source/v1" ||
      !source.files || !source.file_metadata ||
      Array.isArray(source.files) || Array.isArray(source.file_metadata))
    throw Error("Provide a complete native bank or complete application source map");
  if (JSON.stringify(Object.keys(source.files).sort()) !==
      JSON.stringify(Object.keys(source.file_metadata).sort()))
    throw Error("Every application source-map member needs its original metadata");
  if (source.binary_files !== undefined && !Array.isArray(source.binary_files))
    throw Error("Original binary members must be an array");
  const operation = operationId ?? source.operation_id ?? source.source_ref;
  if (typeof operation !== "string" || !operation.trim())
    throw Error("A complete source map needs its source_ref or an explicit operationId");
  const bank = {...source, schema: NATIVE_SOURCE_SCHEMA, operation_id: operation,
    source_schema: source.schema, files: Object.create(null), file_metadata: Object.create(null),
    binary_files: [...(source.binary_files || [])]};
  for (const [path, content] of Object.entries(source.files)) {
    const metadata = source.file_metadata[path];
    if (!metadata || typeof content !== "string")
      throw Error("A complete source-map member is required: " + path);
    if (metadata.encoding === "base64") {
      bank.binary_files.push({...metadata, path, content_base64: content});
    } else {
      if (metadata.encoding !== undefined && metadata.encoding !== "utf-8")
        throw Error("Unsupported source-map member encoding: " + path);
      bank.files[path] = content;
      bank.file_metadata[path] = {...metadata};
    }
  }
  return bank;
}

function encodeNativeSourceDocuments(source, options = {}) {
  const {maxDocumentChars = 900000, maxBase64Chars = 880000, lineWidth = 120,
         title = "Upper Savannah — complete native application source",
         sourceReference = "", includeBootstrap, operationId} = options;
  if (!Number.isSafeInteger(maxDocumentChars) || maxDocumentChars < 4096 ||
      !Number.isSafeInteger(maxBase64Chars) || maxBase64Chars < 4 ||
      !Number.isSafeInteger(lineWidth) || lineWidth < 16 || lineWidth > 1024)
    throw Error("Choose valid native document, base64-part and line-width limits");
  if (typeof title !== "string" || !title || /[\r\n\0]/.test(title) ||
      typeof sourceReference !== "string" || /[\r\n\0]/.test(sourceReference))
    throw Error("Use single-line native source title and reference values");
  let retained;
  if (typeof source === "string" || Array.isArray(source)) {
    retained = decodeNativeSourceDocuments(source);
  } else {
    const bank = nativeSourceBank(source, operationId), inventory = nativeSourceMembers(bank);
    const jsonText = JSON.stringify(bank, null, 2) + "\n", bytes = utf8Encode(jsonText);
    const compressedBytes = gzipBytes(bytes);
    retained = {bank, jsonText, compressedBytes, base64: toBase64(compressedBytes),
      ...inventory, metadata: {
        schema: NATIVE_SOURCE_SCHEMA, operation_id: bank.operation_id,
        edition: bank.edition, source_file_count: inventory.sourceFileCount,
        json_bytes: bytes.length, json_sha256: sha256Bytes(bytes),
        gzip_bytes: compressedBytes.length, gzip_sha256: sha256Bytes(compressedBytes)
      }};
  }
  if (includeBootstrap !== undefined && typeof includeBootstrap !== "boolean")
    throw Error("Choose a boolean includeBootstrap option");
  let bootstrap = "";
  const receiverPath = "source_tools/receive_drive_source.py";
  const addBootstrap = includeBootstrap ?? typeof retained.bank.files[receiverPath] === "string";
  if (addBootstrap) {
    const path = receiverPath, body = retained.bank.files[path];
    if (typeof body !== "string")
      throw Error("The complete bank must retain its native receiver to include the bootstrap");
    const row = {path, ...retained.bank.file_metadata[path],
      encoding: "utf-8", content_base64: toBase64(utf8Encode(body))};
    const bank = {schema: "commons.source-bank/v1",
      operation_id: retained.bank.operation_id, edition: retained.bank.edition, files: [row]};
    const fence = String.fromCharCode(96).repeat(3);
    bootstrap = "\nComplete native bootstrap receiver (same source body contained in the application):\n\n" +
      fence + "json\n" + JSON.stringify(bank) + "\n" + fence + "\n";
  }
  function render(fragment, part, parts) {
    const metadata = {...retained.metadata, parts};
    const partMetadata = {part, parts, base64_chars: fragment.length,
      base64_sha256: sha256Bytes(utf8Encode(fragment))};
    const wrapped = [];
    for (let i = 0; i < fragment.length; i += lineWidth) wrapped.push(fragment.slice(i, i + lineWidth));
    const text = title + " — part " + part + " of " + parts + "\n\n" +
      (sourceReference ? "Retained original source: " + sourceReference + ".\n" : "") +
      "Export every part as a complete text/plain file. Pass every original file to the native receiver with repeated --document arguments.\n\n" +
      "SOURCE_TRANSPORT_METADATA=" + JSON.stringify(metadata) + "\n" +
      "SOURCE_TRANSPORT_PART=" + JSON.stringify(partMetadata) + "\n" +
      NATIVE_SOURCE_BEGIN + "\n" + wrapped.join("\n") + "\n" + NATIVE_SOURCE_END + "\n" + bootstrap;
    const bytes = utf8Encode(text);
    return {...partMetadata, file_name: "upper-savannah-native-source.part-" + part + ".txt",
      text, chars: text.length, bytes: bytes.length, sha256: sha256Bytes(bytes)};
  }
  const overhead = render("", 1, 1).chars;
  let capacity = Math.min(maxBase64Chars,
    Math.floor((maxDocumentChars - overhead - 128) / (1 + 1 / lineWidth)));
  capacity -= capacity % 4;
  if (capacity < 4) throw Error("The document limit cannot fit its metadata and complete bootstrap");
  let documents;
  while (true) {
    const parts = Math.ceil(retained.base64.length / capacity);
    documents = Array.from({length: parts}, (_, index) =>
      render(retained.base64.slice(index * capacity, (index + 1) * capacity), index + 1, parts));
    const overrun = Math.max(...documents.map(document => document.chars - maxDocumentChars));
    if (overrun <= 0) break;
    capacity -= Math.ceil(overrun / 4) * 4;
    if (capacity < 4) throw Error("The document limit cannot fit complete source parts");
  }
  return {metadata: {...retained.metadata, parts: documents.length},
    sourceFileCount: retained.sourceFileCount, sourceBytes: retained.sourceBytes, documents};
}

export {fromBase64, toBase64, utf8Encode, utf8Decode, sha256Bytes, inflateGzip, gzipBytes, encodeApplicationCarrier, decodeNativeSourceDocuments, encodeNativeSourceDocuments};
