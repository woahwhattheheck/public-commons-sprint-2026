/**
 * Transfer one manifest-bound gzip/Base64 UTF-8 JSON source packet in a JavaScript
 * isolate without Node, atob, TextDecoder, or DecompressionStream.
 * The calling adapter retains the original provider result and supplies its
 * existing SHA-256 implementation.
 * Format references: RFC 1951 and RFC 1952.
 */
function b64Bytes(source) {
  if (typeof source !== "string") throw new TypeError("Base64 source must be text");
  const text=source.replace(/\s/g,""), alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  if (text.length%4) throw new Error("Base64 length");
  const bytes=[];
  for(let at=0;at<text.length;at+=4) {
    const a=alphabet.indexOf(text[at]),b=alphabet.indexOf(text[at+1]);
    const pad2=text[at+2]==="=",pad3=text[at+3]==="=";
    const c=pad2?0:alphabet.indexOf(text[at+2]),d=pad3?0:alphabet.indexOf(text[at+3]);
    if(Math.min(a,b,c,d)<0 || (pad2&&!pad3) || ((pad2||pad3)&&at+4!==text.length))
      throw new Error("Base64 alphabet or padding");
    if((pad2&&(b&15)) || (!pad2&&pad3&&(c&3))) throw new Error("Noncanonical Base64 padding");
    bytes.push((a<<2)|(b>>4));
    if(!pad2) bytes.push(((b&15)<<4)|(c>>2));
    if(!pad3) bytes.push(((c&3)<<6)|d);
  }
  return Uint8Array.from(bytes);
}

function gunzipExact(input, expectedBytes) {
  const a=Uint8Array.from(input), n=a.length;
  const fail=m=>{throw new Error(m)};
  const u32=p=>(a[p]|a[p+1]<<8|a[p+2]<<16|a[p+3]<<24)>>>0;
  const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0};
  if(n<18||a[0]!==31||a[1]!==139||a[2]!==8||(a[3]&224))fail("Invalid gzip header");
  if(!Number.isSafeInteger(expectedBytes)||expectedBytes<0||expectedBytes>16777216)fail("Expected size required, maximum16MiB");
  const end=n-8, flags=a[3];let p=10;
  const need=k=>{if(p+k>end)fail("Truncated gzip header")};
  if(flags&4){need(2);const z=a[p]|a[p+1]<<8;p+=2;need(z);p+=z}
  for(const flag of [8,16])if(flags&flag){do{need(1)}while(a[p++]!==0)}
  if(flags&2){need(2);if((crc(a.subarray(0,p))&65535)!==(a[p]|a[p+1]<<8))fail("Header CRC mismatch");p+=2}
  if(u32(n-4)!==expectedBytes)fail("Gzip size differs from original manifest");
  let bit=p*8, q=0;const out=new Uint8Array(expectedBytes);
  const read=k=>{if(bit+k>end*8)fail("Truncated DEFLATE");let v=0;for(let j=0;j<k;j++,bit++)v|=((a[bit>>>3]>>>(bit&7))&1)<<j;return v};
  const tree=lens=>{
    const count=new Array(16).fill(0), next=new Array(16).fill(0), tables=Array.from({length:16},()=>new Map());
    for(const l of lens){if(!Number.isInteger(l)||l<0||l>15)fail("Invalid Huffman length");if(l)count[l]++}
    let code=0,left=1;
    for(let k=1;k<=15;k++){left=left*2-count[k];if(left<0)fail("Oversubscribed Huffman tree");code=(code+count[k-1])*2;next[k]=code}
    for(let s=0;s<lens.length;s++)if(lens[s])tables[lens[s]].set(next[lens[s]]++,s);
    return tables;
  };
  const symbol=t=>{let c=0;for(let k=1;k<=15;k++){c=c*2+read(1);const v=t[k].get(c);if(v!==undefined)return v}fail("Invalid Huffman symbol")};
  const put=b=>{if(q>=out.length)fail("Output exceeds original manifest");out[q++]=b};
  const lb=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  const le=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  const db=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  const de=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  let final=0;
  while(!final){
    final=read(1);const kind=read(2);
    if(kind===0){bit=Math.ceil(bit/8)*8;const len=read(16),inv=read(16);if((len^inv)!==65535)fail("Stored length mismatch");for(let k=0;k<len;k++)put(read(8));continue}
    let lt,dt;
    if(kind===1){lt=tree(Array.from({length:288},(_,k)=>k<144?8:k<256?9:k<280?7:8));dt=tree(new Array(32).fill(5))}
    else if(kind===2){
      const nl=read(5)+257,nd=read(5)+1,nc=read(4)+4;
      if(nl>286)fail("Reserved literal count");
      const order=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15],cl=new Array(19).fill(0);
      for(let k=0;k<nc;k++)cl[order[k]]=read(3);
      const ct=tree(cl),lens=[];
      while(lens.length<nl+nd){
        const s=symbol(ct);if(s<16)lens.push(s);
        else {let val=0,len;if(s===16){if(!lens.length)fail("Repeat without prior length");val=lens[lens.length-1];len=read(2)+3}else if(s===17)len=read(3)+3;else if(s===18)len=read(7)+11;else fail("Invalid repeat");
          if(lens.length+len>nl+nd)fail("Length repeat overflow");while(len--)lens.push(val)}
      }
      if(!lens[256])fail("Missing end-of-block");
      lt=tree(lens.slice(0,nl));dt=tree(lens.slice(nl));
    }else fail("Reserved DEFLATE block");
    while(true){
      const s=symbol(lt);if(s<256){put(s);continue}if(s===256)break;
      if(s>285)fail("Reserved length code");
      const len=lb[s-257]+read(le[s-257]),d=symbol(dt);
      if(d>29)fail("Reserved distance code");const dist=db[d]+read(de[d]);
      if(dist>q)fail("Distance precedes output");if(q+len>out.length)fail("Output exceeds original manifest");
      for(let k=0;k<len;k++){out[q]=out[q-dist];q++}
    }
  }
  if(q!==expectedBytes||Math.ceil(bit/8)!==end)fail("Gzip output size or member boundary mismatch");
  if(crc(out)!==u32(n-8))fail("Gzip CRC mismatch");
  return out;
}

function utf8String(a){let s="",parts=[];for(let i=0;i<a.length;){let c=a[i++],k=0,min=0;if(c<128){}else if(c>=194&&c<=223){c&=31;k=1;min=128}else if(c>=224&&c<=239){c&=15;k=2;min=2048}else if(c>=240&&c<=244){c&=7;k=3;min=65536}else throw Error("Invalid UTF8 lead");if(i+k>a.length)throw Error("Truncated UTF8");while(k--){const d=a[i++];if((d&192)!==128)throw Error("Invalid UTF8 continuation");c=(c<<6)|(d&63)}if(c<min||c>1114111||(c>=55296&&c<=57343))throw Error("Invalid UTF8 scalar");s+=String.fromCodePoint(c);if(s.length>32768){parts.push(s);s=""}}parts.push(s);return parts.join("")}

/**
 * Return complete verified JSON and bytes. Decode data only; never evaluate the
 * received source. The authenticated/original manifest supplies size and digest.
 */
function recoverGzipJsonPacket({base64, expectedBytes, expectedSha256, sha256Bytes}) {
  if (typeof base64 !== "string") throw new TypeError("Base64 source must be text");
  if (typeof sha256Bytes !== "function") throw new TypeError("Existing SHA-256 function is required");
  if (typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new TypeError("Original lower-case SHA-256 is required");
  }
  const compressed = b64Bytes(base64);
  const bytes = gunzipExact(compressed, expectedBytes);
  const actualSha256 = sha256Bytes(bytes);
  if (typeof actualSha256 !== "string" || actualSha256 !== expectedSha256) {
    throw new Error("Decoded source SHA-256 differs from original manifest");
  }
  const text = utf8String(bytes);
  const packet = JSON.parse(text);
  return {packet, text, bytes, compressedBytes: compressed.length, decodedBytes: bytes.length, sha256: actualSha256};
}


function gzipFixed(input) {
  const bytes = typeof input === "string" ? Uint8Array.from(unescape(encodeURIComponent(input)), c=>c.charCodeAt(0)) : Uint8Array.from(input);
  const out=[31,139,8,0,0,0,0,0,0,255];
  let bits=0, count=0;
  const emit=(v,n)=>{bits|=v<<count;count+=n;while(count>=8){out.push(bits&255);bits>>>=8;count-=8;}};
  const reverse=(v,n)=>{let r=0;for(let i=0;i<n;i++){r=(r<<1)|(v&1);v>>>=1;}return r;};
  const literal=n=>{let c,l;if(n<144){c=48+n;l=8;}else if(n<256){c=400+n-144;l=9;}else if(n<280){c=n-256;l=7;}else{c=192+n-280;l=8;}emit(reverse(c,l),l);};
  const lengthBase=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  const lengthExtra=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  const distanceBase=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  const distanceExtra=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  const head=new Int32Array(65536);head.fill(-1);
  const previous=new Int32Array(bytes.length);previous.fill(-1);
  const hash=i=>((bytes[i]*251+bytes[i+1])*251+bytes[i+2])&65535;
  const insert=i=>{if(i+2<bytes.length){const h=hash(i);previous[i]=head[h];head[h]=i;}};
  emit(1,1);emit(1,2);
  let at=0;
  while(at<bytes.length) {
    let best=2, distance=0;
    const maximum=Math.min(258,bytes.length-at);
    if(maximum>=3) {
      let candidate=head[hash(at)], attempts=0;
      while(candidate>=0&&at-candidate<=32768&&attempts++<128) {
        if(bytes[candidate]===bytes[at]&&bytes[candidate+1]===bytes[at+1]&&bytes[candidate+best]===bytes[at+best]) {
          let size=2;while(size<maximum&&bytes[candidate+size]===bytes[at+size])size++;
          if(size>best){best=size;distance=at-candidate;if(size===maximum)break;}
        }
        candidate=previous[candidate];
      }
    }
    if(best>=3) {
      let li=0;while(li+1<lengthBase.length&&lengthBase[li+1]<=best)li++;
      literal(257+li);if(lengthExtra[li])emit(best-lengthBase[li],lengthExtra[li]);
      let di=0;while(di+1<distanceBase.length&&distanceBase[di+1]<=distance)di++;
      emit(reverse(di,5),5);if(distanceExtra[di])emit(distance-distanceBase[di],distanceExtra[di]);
      for(let k=0;k<best;k++)insert(at+k);at+=best;
    } else {literal(bytes[at]);insert(at);at++;}
  }
  literal(256);
  if(count)out.push(bits&255);
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  crc=(crc^0xffffffff)>>>0;
  for(let i=0;i<4;i++)out.push((crc>>>(i*8))&255);
  for(let i=0;i<4;i++)out.push((bytes.length>>>(i*8))&255);
  return Uint8Array.from(out);
}


function encodeBase64(input) {
  const bytes=Uint8Array.from(input), alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",parts=[];
  let part="";
  for(let at=0;at<bytes.length;at+=3) {
    const a=bytes[at],b=bytes[at+1],c=bytes[at+2];
    part+=alphabet[a>>2]+alphabet[((a&3)<<4)|((b??0)>>4)];
    part+=at+1<bytes.length?alphabet[((b&15)<<2)|((c??0)>>6)]:"=";
    part+=at+2<bytes.length?alphabet[c&63]:"=";
    if(part.length>=32768){parts.push(part);part="";}
  }
  parts.push(part);return parts.join("");
}

/**
 * Compress the exact already-authored UTF-8 JSON text without reserializing it.
 * The returned manifest describes these exact bytes; retain its source identity
 * with the original operation before sending through the existing part helper.
 */
function createGzipJsonPacket({text,sha256Bytes,compression="fixed"}) {
  if(typeof text!=="string") throw new TypeError("Complete original JSON text is required");
  if(typeof sha256Bytes!=="function") throw new TypeError("Existing SHA-256 function is required");
  const bytes=Uint8Array.from(unescape(encodeURIComponent(text)),c=>c.charCodeAt(0));
  if(bytes.length>16777216) throw new Error("Packet exceeds the 16 MiB decoder maximum");
  JSON.parse(text);
  const sha256=sha256Bytes(bytes);
  if(typeof sha256!=="string"||!/^[a-f0-9]{64}$/.test(sha256)) throw new TypeError("SHA-256 function must return a lower-case digest");
  if(compression!=="fixed"&&compression!=="adaptive") throw new TypeError("Compression must be fixed or adaptive");
  const compressed=compression==="adaptive"?gzipAdaptive(bytes):gzipFixed(bytes);
  return {encoding:"gzip+base64",base64:encodeBase64(compressed),decodedBytes:bytes.length,compressedBytes:compressed.length,sha256};
}

function gzipDynamic(data){
 const lb=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258],le=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0],db=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577],de=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
 const tokens=[],lf=new Uint32Array(286),df=new Uint32Array(30),head=new Int32Array(65536).fill(-1),prev=new Int32Array(data.length).fill(-1),key=i=>((data[i]*251+data[i+1])*251+data[i+2])&65535,insert=i=>{if(i+2<data.length){const h=key(i);prev[i]=head[h];head[h]=i;}};
 for(let i=0;i<data.length;){let best=0,distance=0;if(i+2<data.length){let j=head[key(i)],budget=120;const max=Math.min(258,data.length-i);while(j>=0&&i-j<=32768&&budget--){if(data[j]===data[i]&&data[j+1]===data[i+1]&&data[j+2]===data[i+2]){let n=3;while(n<max&&data[j+n]===data[i+n])n++;if(n>best){best=n;distance=i-j;if(n===max)break;}}j=prev[j];}}
  if(best>=3){let lc=lb.length-1;while(lb[lc]>best)lc--;let dc=db.length-1;while(db[dc]>distance)dc--;tokens.push([lc+257,best-lb[lc],le[lc],dc,distance-db[dc],de[dc]]);lf[lc+257]++;df[dc]++;for(let n=0;n<best;n++)insert(i+n);i+=best;}else{tokens.push(data[i]);lf[data[i]]++;insert(i);i++;}}
 tokens.push(256);lf[256]++;
 function lengths(freq,max){for(let floor=1;floor<1e10;floor*=2){let nodes=Array.from(freq,(f,s)=>({weight:Math.max(floor,f),s}));while(nodes.length>1){nodes.sort((a,b)=>a.weight-b.weight);const a=nodes.shift(),b=nodes.shift();nodes.push({weight:a.weight+b.weight,a,b});}const sizes=Array(freq.length).fill(0);const visit=(n,depth)=>{if(n.s!==undefined)sizes[n.s]=Math.max(1,depth);else{visit(n.a,depth+1);visit(n.b,depth+1);}};visit(nodes[0],0);if(Math.max(...sizes)<=max)return sizes;}throw Error('Huffman lengths');}
 const reverse=(v,n)=>{let r=0;for(let i=0;i<n;i++){r=r*2+(v&1);v>>>=1;}return r;};
 function codes(sizes){const count=Array(16).fill(0),next=Array(16).fill(0);for(const n of sizes)count[n]++;let code=0;for(let n=1;n<16;n++){code=(code+count[n-1])<<1;next[n]=code;}return sizes.map(n=>reverse(next[n]++,n));}
 const ll=lengths(lf,15),dl=lengths(df,15),cf=new Uint32Array(19);for(const n of [...ll,...dl])cf[n]++;const cl=lengths(cf,7),lc=codes(ll),dc=codes(dl),cc=codes(cl),out=[31,139,8,0,0,0,0,0,0,3];let buffer=0,used=0;const bits=(v,n)=>{buffer|=v<<used;used+=n;while(used>=8){out.push(buffer&255);buffer>>>=8;used-=8;}};
 bits(5,3);bits(29,5);bits(29,5);bits(15,4);for(const i of [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15])bits(cl[i],3);
 for(const n of [...ll,...dl])bits(cc[n],cl[n]);
 for(const token of tokens){if(typeof token==='number')bits(lc[token],ll[token]);else{bits(lc[token[0]],ll[token[0]]);bits(token[1],token[2]);bits(dc[token[3]],dl[token[3]]);bits(token[4],token[5]);}}
 if(used)out.push(buffer&255);let crc=0xffffffff;for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;for(let i=0;i<4;i++)out.push((crc>>>(8*i))&255);for(let i=0;i<4;i++)out.push((data.length>>>(8*i))&255);return new Uint8Array(out);
}

/** Explicit optional compression; old fixed output remains the default. */
function gzipAdaptive(input) {
  const bytes=typeof input==="string"?transferUtf8(input):Uint8Array.from(input);
  const fixed=gzipFixed(bytes),dynamic=gzipDynamic(bytes);
  return dynamic.length<fixed.length?dynamic:fixed;
}


/** UTF-8 for metadata written by the existing JSON/native part protocol. */
function transferUtf8(text) {
  return Uint8Array.from(unescape(encodeURIComponent(text)), c=>c.charCodeAt(0));
}
function transferDigest(bytes, sha256Bytes) {
  if(typeof sha256Bytes!=="function") throw new TypeError("Existing SHA-256 function is required");
  const digest=sha256Bytes(bytes);
  if(typeof digest!=="string"||!/^[a-f0-9]{64}$/.test(digest)) throw new TypeError("SHA-256 function must return a lower-case digest");
  return digest;
}
function transferInteger(value,minimum,maximum,label) {
  if(!Number.isSafeInteger(value)||value<minimum||value>maximum) throw new TypeError("Invalid "+label);
  return value;
}
function transferJson(value) {
  const result={};
  for(const key of Object.keys(value).sort()) result[key]=value[key];
  return JSON.stringify(result);
}
function transferObject(value,fields,label) {
  let result=value;
  if(typeof value==="string"){
    result=JSON.parse(value);
    // Original envelopes have fixed ASCII keys and scalar values. Check the
    // original text before JSON.parse could hide a repeated key.
    const names=[...value.matchAll(/"([^"\\]*)"\s*:/g)].map(item=>item[1]);
    if(names.length!==fields.length||new Set(names).size!==fields.length||
       names.some(name=>!fields.includes(name))) throw new TypeError("Invalid or repeated "+label+" fields");
  }
  if(!result||typeof result!=="object"||Array.isArray(result)||
     Object.keys(result).length!==fields.length||
     Object.keys(result).some(key=>!fields.includes(key))) throw new TypeError("Invalid "+label+" fields");
  return result;
}
const FILE_TRANSFER_FIELDS=["schema","transfer_id","bytes","sha256","parts","raw_chunk_bytes","max_request_bytes","transport","uploaded"];
const FILE_PART_FIELDS=["schema","transfer_id","index","count","offset","bytes","sha256","data_base64"];

function checkedFileTransferManifest(value) {
  const m=transferObject(value,FILE_TRANSFER_FIELDS,"manifest");
  if(m.schema!=="commons.file-transfer.v1"||m.transport!=="file_envelopes_only"||m.uploaded!==false)
    throw new TypeError("Expected the original file-envelope manifest");
  transferInteger(m.bytes,0,Number.MAX_SAFE_INTEGER,"file size");
  transferInteger(m.raw_chunk_bytes,1,Number.MAX_SAFE_INTEGER,"raw chunk size");
  transferInteger(m.max_request_bytes,512,Number.MAX_SAFE_INTEGER,"request budget");
  transferInteger(m.parts,1,100000,"part count");
  if(m.raw_chunk_bytes>m.max_request_bytes||m.parts!==Math.max(1,Math.ceil(m.bytes/m.raw_chunk_bytes)))
    throw new TypeError("Manifest part sizing mismatch");
  if(typeof m.sha256!=="string"||!/^[a-f0-9]{64}$/.test(m.sha256)||m.transfer_id!=="sha256-"+m.sha256)
    throw new TypeError("Manifest digest or transfer ID mismatch");
  return {...m};
}
function filePartEnvelope(source,manifest,index,sha256Bytes) {
  transferInteger(index,0,manifest.parts-1,"part index");
  const offset=index*manifest.raw_chunk_bytes;
  const raw=source.subarray(offset,Math.min(source.length,offset+manifest.raw_chunk_bytes));
  const item={schema:"commons.file-part.v1",transfer_id:manifest.transfer_id,index,count:manifest.parts,
    offset,bytes:raw.length,sha256:transferDigest(raw,sha256Bytes),data_base64:encodeBase64(raw)};
  if(transferUtf8(transferJson(item)).length>manifest.max_request_bytes)
    throw new Error("Concrete envelope exceeds original request budget");
  return item;
}
function fileTransferView(source,manifest,sha256Bytes) {
  const stable=Object.freeze({...manifest});
  return Object.freeze({
    manifest:stable,
    manifestText:transferJson(stable),
    part:index=>filePartEnvelope(source,stable,index,sha256Bytes),
    partText:index=>transferJson(filePartEnvelope(source,stable,index,sha256Bytes)),
    resume:(status,binding={})=>fileTransferResume(source,stable,status,sha256Bytes,binding)
  });
}
/**
 * Prepare the SAME manifest and part envelopes consumed by transfer_parts.py.
 * Copy the exact source once; later caller mutation cannot change a part.
 */
function createFileTransfer({bytes,maxRequestBytes,rawChunkLimit,sha256Bytes}) {
  if(!(bytes instanceof Uint8Array)) throw new TypeError("Exact source Uint8Array is required");
  transferInteger(maxRequestBytes,512,Number.MAX_SAFE_INTEGER,"request budget");
  if(rawChunkLimit!==undefined) transferInteger(rawChunkLimit,1,Number.MAX_SAFE_INTEGER,"raw chunk limit");
  const source=Uint8Array.from(bytes),sha256=transferDigest(source,sha256Bytes),transfer_id="sha256-"+sha256;
  // Match the original Python planner's conservative 20-digit metadata bound.
  const empty={schema:"commons.file-part.v1",transfer_id,index:0,count:0,offset:0,bytes:0,
    sha256:"0".repeat(64),data_base64:""};
  const worst=transferJson(empty).replace(/"(count|index|offset)":0/g,(_,key)=>'"'+key+'":'+"9".repeat(20));
  const overhead=worst.length+20;
  let chunk=Math.floor((maxRequestBytes-overhead)/4)*3;
  if(rawChunkLimit!==undefined)chunk=Math.min(chunk,rawChunkLimit);
  if(chunk<1)throw new Error("Budget leaves no room for file content");
  const count=Math.max(1,Math.ceil(source.length/chunk));
  if(count>100000)throw new Error("More than 100000 parts; use a larger budget or native binary upload");
  const manifest={schema:"commons.file-transfer.v1",transfer_id,bytes:source.length,sha256,parts:count,
    raw_chunk_bytes:chunk,max_request_bytes:maxRequestBytes,transport:"file_envelopes_only",uploaded:false};
  return fileTransferView(source,manifest,sha256Bytes);
}
/** Reopen a retained original transfer, without recompressing or choosing a new size. */
function reopenFileTransfer({bytes,manifest,sha256Bytes}) {
  if(!(bytes instanceof Uint8Array))throw new TypeError("Exact original source Uint8Array is required");
  const m=checkedFileTransferManifest(manifest),source=Uint8Array.from(bytes);
  if(source.length!==m.bytes||transferDigest(source,sha256Bytes)!==m.sha256)
    throw new Error("Source differs from original file-transfer manifest");
  // Check the actual worst selected envelope before returning usable methods.
  filePartEnvelope(source,m,m.parts-1,sha256Bytes);
  if(m.parts>1)filePartEnvelope(source,m,m.parts-2,sha256Bytes);
  return fileTransferView(source,m,sha256Bytes);
}
function fileTransferResume(source,manifest,status,sha256Bytes,binding) {
  if(!status||typeof status!=="object"||Array.isArray(status))throw new TypeError("Actual receiver status is required");
  if(!binding||typeof binding!=="object"||Array.isArray(binding)||Object.keys(binding).some(key=>key!=="directory"&&key!=="path"))
    throw new TypeError("Receiver binding accepts only the original directory and path");
  if(status.state!=="receiving"&&status.state!=="restored")throw new TypeError("Expected actual receiving/restored status");
  if(status.transfer_id!==manifest.transfer_id||status.bytes!==manifest.bytes||status.sha256!==manifest.sha256)
    throw new Error("Receiver belongs to another original transfer");
  if(typeof status.directory!=="string"||!status.directory||typeof status.path!=="string"||!status.path)
    throw new Error("Receiver directory and destination are required");
  for(const [option,field] of [["directory","directory"],["path","path"]]){
    if(binding[option]!==undefined&&(typeof binding[option]!=="string"||binding[option]!==status[field]))
      throw new Error("Receiver "+field+" differs from original binding");
  }
  const size=transferInteger(status.received_bytes,0,manifest.bytes,"retained prefix size");
  const index=size===manifest.bytes?null:Math.floor(size/manifest.raw_chunk_bytes);
  if(status.next_part_index!==index||status.next_part_offset!==(index===null?null:index*manifest.raw_chunk_bytes))
    throw new Error("Receiver continuation does not match its retained prefix");
  if(status.state==="restored"&&size!==manifest.bytes)throw new Error("Restored receiver is incomplete");
  if(transferDigest(source.subarray(0,size),sha256Bytes)!==status.prefix_sha256)
    throw new Error("Receiver prefix differs from complete original source");
  return {state:status.state,directory:status.directory,path:status.path,transfer_id:manifest.transfer_id,
    received_bytes:size,prefix_sha256:status.prefix_sha256,next_part_index:index,
    next_part_offset:index===null?null:index*manifest.raw_chunk_bytes,
    finish_required:index===null&&status.state!=="restored",complete:status.state==="restored"};
}
function checkedFilePart(value,manifest,sha256Bytes) {
  const item=transferObject(value,FILE_PART_FIELDS,"part");
  transferInteger(item.index,0,manifest.parts-1,"part index");
  transferInteger(item.count,1,100000,"part count");
  transferInteger(item.offset,0,manifest.bytes,"part offset");
  transferInteger(item.bytes,0,manifest.raw_chunk_bytes,"part byte count");
  const offset=item.index*manifest.raw_chunk_bytes,size=Math.min(manifest.raw_chunk_bytes,manifest.bytes-offset);
  if(item.schema!=="commons.file-part.v1"||item.transfer_id!==manifest.transfer_id||item.count!==manifest.parts||
     item.offset!==offset||item.bytes!==size||typeof item.sha256!=="string"||!/^[a-f0-9]{64}$/.test(item.sha256))
    throw new Error("Part identity, numbering, offset or size mismatch");
  if(typeof item.data_base64!=="string")throw new TypeError("Part Base64 must be text");
  const raw=b64Bytes(item.data_base64);
  if(encodeBase64(raw)!==item.data_base64||raw.length!==size||transferDigest(raw,sha256Bytes)!==item.sha256)
    throw new Error("Part byte count or digest mismatch");
  const packed=typeof value==="string"?value:transferJson(item);
  if(transferUtf8(packed).length>manifest.max_request_bytes)throw new Error("Part exceeds original request budget");
  return {item,raw};
}
/**
 * Recover provider-returned original part bodies. Ordering is selected by their
 * declared index; duplicates/missing parts are errors, never implicit success.
 */
function recoverFileTransfer({manifest,parts,sha256Bytes}) {
  const m=checkedFileTransferManifest(manifest);
  if(!Array.isArray(parts)||parts.length!==m.parts)throw new Error("Expected every original part exactly once");
  const selected=new Map();
  for(const value of parts){
    const part=checkedFilePart(value,m,sha256Bytes);
    if(selected.has(part.item.index))throw new Error("Duplicate original part index");
    selected.set(part.item.index,part);
  }
  // A manifest alone cannot trigger an arbitrarily large allocation: every
  // declared part has already supplied and verified its actual complete bytes.
  const bytes=new Uint8Array(m.bytes);
  for(let i=0;i<m.parts;i++){const part=selected.get(i);if(!part)throw new Error("Missing original part");bytes.set(part.raw,part.item.offset);}
  if(transferDigest(bytes,sha256Bytes)!==m.sha256)throw new Error("Full file digest differs from original manifest");
  return {bytes,manifest:m,transfer_id:m.transfer_id,sha256:m.sha256};
}
/** Prepare exact compressed source for the original file receiver. */
function createGzipJsonTransfer({text,sha256Bytes,maxRequestBytes,rawChunkLimit,compression="fixed"}) {
  const packet=createGzipJsonPacket({text,sha256Bytes,compression});
  const transfer=createFileTransfer({bytes:b64Bytes(packet.base64),maxRequestBytes,rawChunkLimit,sha256Bytes});
  return {packet:{encoding:packet.encoding,decodedBytes:packet.decodedBytes,
    compressedBytes:packet.compressedBytes,sha256:packet.sha256},transfer};
}
/** Recover complete source from original native-compatible provider part bodies. */
function recoverGzipJsonTransfer({packet,manifest,parts,sha256Bytes}) {
  if(!packet||packet.encoding!=="gzip+base64")throw new TypeError("Original gzip source metadata is required");
  const received=recoverFileTransfer({manifest,parts,sha256Bytes});
  if(received.bytes.length!==packet.compressedBytes)throw new Error("Compressed source size differs from original packet");
  return recoverGzipJsonPacket({base64:encodeBase64(received.bytes),expectedBytes:packet.decodedBytes,
    expectedSha256:packet.sha256,sha256Bytes});
}

export {
  b64Bytes as decodeBase64,
  encodeBase64,
  gunzipExact,
  gzipFixed,
  utf8String as decodeUtf8,
  recoverGzipJsonPacket,
  createGzipJsonPacket,
  gzipAdaptive,
  createFileTransfer,
  reopenFileTransfer,
  recoverFileTransfer,
  createGzipJsonTransfer,
  recoverGzipJsonTransfer
};
