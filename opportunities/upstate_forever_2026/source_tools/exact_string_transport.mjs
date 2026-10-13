// Copyright TokenJunkieLabs. Exact UTF-8 source transport; no filesystem, network, or code execution.
// One implementation is shared by the standalone Eco receiver and generic fleet tooling.
// Restore the complete original text before parsing source-bank member records.

export function createExactStringTransport(codec, options = {}){
const limits={maxStringChars:20000000,maxTotalChars:150000000,maxNodes:1000000,maxDepth:80,...options};
for(const [key,value]of Object.entries(limits))if(!["maxStringChars","maxTotalChars","maxNodes","maxDepth"].includes(key)||!Number.isSafeInteger(value)||value<1)throw Error("Invalid transport limit: "+key);
function textInput(value){if(typeof value!=="string")throw Error("Source must be a complete UTF-8 string");if(value.length>limits.maxStringChars)throw Error("Source exceeds the configured string limit");return value;}
function quotedLength(value){let length=2;for(let i=0;i<value.length;i++){const n=value.charCodeAt(i);if(n===34||n===92||n===8||n===9||n===10||n===12||n===13)length+=2;else if(n<32||n>=0xd800&&n<=0xdbff&&!(i+1<value.length&&value.charCodeAt(i+1)>=0xdc00&&value.charCodeAt(i+1)<=0xdfff)||n>=0xdc00&&n<=0xdfff&&!(i>0&&value.charCodeAt(i-1)>=0xd800&&value.charCodeAt(i-1)<=0xdbff))length+=6;else length++;if(length>limits.maxStringChars)throw Error("Transport expansion exceeds the string limit");}return length;}

function pack(original){
textInput(original);if(codec)codec.utf8Encode(original);
const nodes=[], map=new Map();
const put=n=>{const k=JSON.stringify(n);if(map.has(k))return map.get(k);const id=nodes.length;if(id>=limits.maxNodes)throw Error("Transport exceeds the node limit");nodes.push(n);map.set(k,id);return id;};
const literal=s=>put([0,s]);
function walk(text,depth=0){
if(depth<12&&codec&&text.startsWith("H4sI")&&text.length>1000){try{const bytes=codec.gunzip(codec.base64Decode(text),{maxOutputBytes:Math.min(limits.maxStringChars*4,0x7fffffff)});if(codec.base64Encode(codec.gzip(bytes))===text){const decoded=codec.utf8Decode(bytes);if(codec.sha256(codec.utf8Encode(decoded))===codec.sha256(bytes))return put([3,walk(decoded,depth+1)]);}}catch{}}
const t=text.trim();
if(depth<12&&/^<!doctype html|^<html/i.test(t)){
let pieces=[],last=0;const re=/<(script|style)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;let m;
while((m=re.exec(text))){const start=m.index+m[0].indexOf(">")+1;const end=start+m[2].length;if(start>last)pieces.push(literal(text.slice(last,start)));pieces.push(walk(m[2],depth+1));last=end;}
if(pieces.length){if(last<text.length)pieces.push(literal(text.slice(last)));return put([1,pieces]);}
}
if(depth>12||t.length<2||!((t[0]==="{"&&t.endsWith("}"))||(t[0]==="["&&t.endsWith("]"))))return literal(text);
try{JSON.parse(text);}catch{return literal(text);}
let ids=[],last=0,i=0;
while(i<text.length){
if(text[i]!=='"'){i++;continue;}const start=i++;let escaped=false;
while(i<text.length){let ch=text[i++];if(escaped){escaped=false;continue;}if(ch==="\\"){escaped=true;continue;}if(ch==='"')break;}
const token=text.slice(start,i),v=JSON.parse(token);
if(start>last)ids.push(literal(text.slice(last,start)));
if(JSON.stringify(v)===token)ids.push(put([2,walk(v,depth+1)]));else ids.push(literal(token));
last=i;
}
if(last<text.length)ids.push(literal(text.slice(last)));
if(ids.length===1)return ids[0];return put([1,ids]);
}
return {schema:"commons.exact-string-transport/v1",root:walk(original),nodes};
}
function unpack(data){
if(data?.schema!=="commons.exact-string-transport/v1"||!Array.isArray(data.nodes)||data.nodes.length>limits.maxNodes)throw Error("Invalid string transport");
const memo=new Map(),active=new Set();let total=0;
function reserve(length){if(!Number.isSafeInteger(length)||length>limits.maxStringChars||total>limits.maxTotalChars-length)throw Error("Transport expansion exceeds configured limits");total+=length;}
function read(id,depth=0){
if(!Number.isInteger(id)||id<0||id>=data.nodes.length||depth>limits.maxDepth)throw Error("Invalid node reference");
if(memo.has(id))return memo.get(id);if(active.has(id))throw Error("Cyclic node");active.add(id);
const n=data.nodes[id];let value;
if(!Array.isArray(n)||n.length!==2)throw Error("Invalid node");
if(n[0]===0&&typeof n[1]==="string"){reserve(n[1].length);value=n[1];}
else if(n[0]===1&&Array.isArray(n[1])){
 const pieces=[];let length=0;
 for(const ref of n[1]){const piece=read(ref,depth+1);length+=piece.length;if(!Number.isSafeInteger(length)||length>limits.maxStringChars)throw Error("Transport expansion exceeds the string limit");pieces.push(piece);}
 reserve(length);value=pieces.join("");
}else if(n[0]===2){const child=read(n[1],depth+1);reserve(quotedLength(child));value=JSON.stringify(child);}
else if(n[0]===3&&codec){const child=read(n[1],depth+1),bytes=codec.gzip(codec.utf8Encode(child));reserve(4*Math.ceil(bytes.length/3));value=codec.base64Encode(bytes);}
else throw Error("Invalid node type");
active.delete(id);memo.set(id,value);return value;
}
const result=read(data.root);if(codec)codec.utf8Encode(result);return result;
}
return {pack,unpack};
}


export function createExactSourceEnvelope(codec, transportFactory, settings = {}) {
 const schema="commons.exact-source-envelope/v1",codecId="commons.archive-codec/fixed-huffman-v1";
 const maxSourceBytes=settings.maxSourceBytes??33554432,maxTransportBytes=settings.maxTransportBytes??33554432,maxNodes=settings.maxNodes??1000000;
 for(const [name,value]of Object.entries({maxSourceBytes,maxTransportBytes,maxNodes}))if(!Number.isSafeInteger(value)||value<1||value>0x7fffffff)throw Error("Invalid "+name);
 const transport=transportFactory(codec,{maxStringChars:maxSourceBytes,maxTotalChars:Math.min(8*maxSourceBytes,Number.MAX_SAFE_INTEGER),maxNodes,maxDepth:80});
 const checkHash=(value,label)=>{if(typeof value!=="string"||!/^[a-f0-9]{64}$/.test(value))throw Error("Invalid "+label+" SHA-256");return value;};
 const checkBytes=(value,limit,label)=>{if(!Number.isSafeInteger(value)||value<0||value>limit)throw Error(label+" exceeds the configured byte limit");return value;};
 function encode(original,name="source.txt") {
  if(typeof original!=="string"||typeof name!=="string")throw Error("Source and display name must be strings");
  const bytes=codec.utf8Encode(original);checkBytes(bytes.length,maxSourceBytes,"Source");
  const tree=transport.pack(original),treeBytes=codec.utf8Encode(JSON.stringify(tree));checkBytes(treeBytes.length,maxTransportBytes,"Decoded transport");
  const packed=codec.gzip(treeBytes);checkBytes(packed.length,maxTransportBytes,"Compressed transport");
  return {schema,codec:codecId,source:{name,bytes:bytes.length,sha256:codec.sha256(bytes)},transport:{encoding:"gzip+base64",bytes:packed.length,sha256:codec.sha256(packed),decoded_bytes:treeBytes.length,decoded_sha256:codec.sha256(treeBytes),payload:codec.base64Encode(packed)}};
 }
 function decode(envelope,expectedSha256) {
  if(!envelope||envelope.schema!==schema||envelope.codec!==codecId)throw Error("Unsupported exact-source envelope or codec");
  const source=envelope.source,t=envelope.transport;
  if(!source||typeof source.name!=="string"||!t||t.encoding!=="gzip+base64"||typeof t.payload!=="string")throw Error("Incomplete exact-source envelope");
  checkBytes(source.bytes,maxSourceBytes,"Source");checkHash(source.sha256,"Source");checkBytes(t.bytes,maxTransportBytes,"Compressed transport");checkHash(t.sha256,"Compressed transport");checkBytes(t.decoded_bytes,maxTransportBytes,"Decoded transport");checkHash(t.decoded_sha256,"Decoded transport");
  if(t.payload.length>4*Math.ceil(maxTransportBytes/3)+4096)throw Error("Encoded transport exceeds the configured limit");
  if(expectedSha256!==undefined&&checkHash(expectedSha256,"Expected source")!==source.sha256)throw Error("Envelope is not the expected original source");
  const packed=codec.base64Decode(t.payload);if(packed.length!==t.bytes||codec.sha256(packed)!==t.sha256)throw Error("Compressed transport identity differs");
  const decoded=codec.gunzip(packed,{maxOutputBytes:t.decoded_bytes,maxMembers:1});
  if(decoded.length!==t.decoded_bytes||codec.sha256(decoded)!==t.decoded_sha256)throw Error("Decoded transport identity differs");
  const tree=JSON.parse(codec.utf8Decode(decoded)),text=transport.unpack(tree),bytes=codec.utf8Encode(text);
  if(bytes.length!==source.bytes||codec.sha256(bytes)!==source.sha256)throw Error("Restored original source identity differs");
  return {text,bytes,source:{...source},nodes:tree.nodes.length,compressed_bytes:packed.length,decoded_transport_bytes:decoded.length};
 }
 function inspect(envelope,expectedSha256){const r=decode(envelope,expectedSha256);return {schema,codec:codecId,source:r.source,nodes:r.nodes,compressed_bytes:r.compressed_bytes,decoded_transport_bytes:r.decoded_transport_bytes,verified:true};}
 return {schema,codecId,encode,decode,inspect};
}

