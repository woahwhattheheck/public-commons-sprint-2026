/* Original large-assessment transfer through authenticated operator routes. */
const PART_BYTES=1024*1024;
const DIRECT_BYTES=2*1024*1024;

function fallbackSHA256(bytes){
const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
const H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];const p=new Uint8Array(Math.ceil((bytes.length+9)/64)*64);p.set(bytes);p[bytes.length]=128;
let hi=Math.floor(bytes.length/0x20000000),lo=bytes.length<<3;for(let k=0;k<4;k++){p[p.length-8+k]=hi>>>(24-k*8)&255;p[p.length-4+k]=lo>>>(24-k*8)&255;}
const rot=(x,n)=>(x>>>n)|(x<<(32-n)),W=new Uint32Array(64);
for(let off=0;off<p.length;off+=64){for(let i=0;i<16;i++){const j=off+i*4;W[i]=(p[j]<<24)|(p[j+1]<<16)|(p[j+2]<<8)|p[j+3];}for(let i=16;i<64;i++){const a=W[i-15],b=W[i-2];W[i]=(W[i-16]+(rot(a,7)^rot(a,18)^(a>>>3))+W[i-7]+(rot(b,17)^rot(b,19)^(b>>>10)))>>>0;}
let [a,b,c,d,e,f,g,h]=H;for(let i=0;i<64;i++){const t1=(h+(rot(e,6)^rot(e,11)^rot(e,25))+((e&f)^(~e&g))+K[i]+W[i])>>>0,t2=((rot(a,2)^rot(a,13)^rot(a,22))+((a&b)^(a&c)^(b&c)))>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}[a,b,c,d,e,f,g,h].forEach((v,i)=>H[i]=(H[i]+v)>>>0);}
return H.map(x=>x.toString(16).padStart(8,"0")).join("");
}

async function digest(bytes){
  if(globalThis.crypto?.subtle){
    const value=await globalThis.crypto.subtle.digest('SHA-256',bytes);
    return Array.from(new Uint8Array(value),byte=>byte.toString(16).padStart(2,'0')).join('');
  }
  return fallbackSHA256(bytes);
}
function base64(bytes){
  const pieces=[];
  for(let offset=0;offset<bytes.length;offset+=32768)
    pieces.push(String.fromCharCode(...bytes.subarray(offset,offset+32768)));
  return btoa(pieces.join(''));
}

export async function prepareAssessment(assessment,{progress=()=>{}}={}){
  progress('Preparing the calculated assessment for saving…');
  const raw=new TextEncoder().encode(JSON.stringify(assessment));
  if(raw.length<=DIRECT_BYTES)return {assessment};
  let encoded=raw,encoding='identity';
  if(typeof CompressionStream==='function'){
    try{
      const stream=new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'));
      const compressed=new Uint8Array(await new Response(stream).arrayBuffer());
      if(compressed.length<raw.length){encoded=compressed;encoding='gzip';}
    }catch(_){}
  }
  const rawSHA=await digest(raw);
  const transportSHA=encoding==='identity'?rawSHA:await digest(encoded);
  const upload={
    schema:'upstate.decision-transfer/v1',upload_id:transportSHA,
    encoding,bytes:encoded.length,sha256:transportSHA,
    raw_bytes:raw.length,raw_sha256:rawSHA,
    parts:Math.ceil(encoded.length/PART_BYTES),
  };
  return {upload,encoded};
}

export async function uploadAssessment(prepared,{api,url,workspace,progress=()=>{},isCurrent=()=>true}){
  if(prepared.assessment)return {assessment:prepared.assessment};
  const {upload,encoded}=prepared;
  const send=async body=>{
    if(!isCurrent())throw Error('The workspace changed. Reopen the original assessment to continue its saved transfer.');
    const result=await api(url,{method:'POST',body:{workspace,...body}});
    if(!isCurrent())throw Error('The workspace changed. Reopen the original assessment to continue its saved transfer.');
    return result;
  };
  const state=await send({upload});
  if(state.upload_id!==upload.upload_id||state.parts!==upload.parts||!Array.isArray(state.received_parts))
    throw Error('The operator returned a different assessment transfer. Reopen the original workspace and retry.');
  const received=new Set(state.received_parts);
  for(let part=0;part<upload.parts;part++){
    if(received.has(part))continue;
    progress('Saving assessment data: part '+(part+1)+' of '+upload.parts+
      ' · '+Math.ceil(upload.raw_bytes/1048576)+' MiB of original comparison data.');
    const bytes=encoded.subarray(part*PART_BYTES,Math.min((part+1)*PART_BYTES,encoded.length));
    const sha=await digest(bytes);
    const receipt=await send({upload,part,part_sha256:sha,content:base64(bytes)});
    if(receipt.upload_id!==upload.upload_id||receipt.part!==part||receipt.sha256!==sha||receipt.bytes!==bytes.length)
      throw Error('The saved assessment part differs from the original transfer. Retry to reconcile its retained bytes.');
  }
  progress('The original assessment data is retained. Saving its view and source references…');
  return {assessment_ref:upload};
}

export function operationId(){
  if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();
  if(globalThis.crypto?.getRandomValues){
    const bytes=globalThis.crypto.getRandomValues(new Uint8Array(18));
    return 'decision_'+Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
  }
  return 'decision_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)+'_'+Math.random().toString(36).slice(2);
}

export async function submissionIdentity(action,payload){
  const json=JSON.parse(JSON.stringify({action,payload}));
  const ordered=value=>Array.isArray(value)?value.map(ordered):
    value&&typeof value==='object'?
      Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
  return digest(new TextEncoder().encode(JSON.stringify(ordered(json))));
}
