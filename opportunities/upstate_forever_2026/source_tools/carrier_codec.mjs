// TokenJunkieLabs · UPSTATE-INTEGRATED-DELIVERY-ECD1-20261012
// Pure JavaScript source transport for runtimes without Node, filesystem or browser APIs.
// encodeApplicationCarrier returns the complete numbered carrier accepted by the existing Python receiver.

function fromBase64(s) {
  s=s.replace(/\s+/g,""); if(!/^[A-Za-z0-9+/]*={0,2}$/.test(s)||s.length%4)throw Error("bad base64");
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out=[],val=0,bits=0;
  for (let ch of s) { if(ch==="=")break; val=(val<<6)|alphabet.indexOf(ch);bits+=6;if(bits>=8){bits-=8;out.push((val>>>bits)&255);} }
  return new Uint8Array(out);
}
function inflateGzip(data) {
 if(data[0]!==31||data[1]!==139||data[2]!==8)throw Error("not gzip");let p=10,f=data[3];
 if(f&4){let n=data[p]|data[p+1]<<8;p+=2+n;}if(f&8){while(data[p++]){}}if(f&16){while(data[p++]){}}if(f&2)p+=2;
 let bi=p*8;function bits(n){let x=0;for(let j=0;j<n;j++){if((bi>>3)>=data.length-8)throw Error("truncated deflate");x|=((data[bi>>3]>>(bi&7))&1)<<j;bi++;}return x;}
 function tree(lengths){let count=new Array(16).fill(0),next=new Array(16).fill(0),maps=Array.from({length:16},()=>new Map()),max=0,c=0;lengths.forEach(n=>{if(n){count[n]++;max=Math.max(max,n);}});for(let n=1;n<=15;n++){c=(c+count[n-1])<<1;next[n]=c;}lengths.forEach((n,s)=>{if(!n)return;let x=next[n]++,r=0;for(let i=0;i<n;i++){r=(r<<1)|(x&1);x>>>=1;}maps[n].set(r,s);});return{maps,max};}
 function sym(t){let c=0;for(let n=1;n<=t.max;n++){c|=bits(1)<<(n-1);if(t.maps[n].has(c))return t.maps[n].get(c);}throw Error("invalid huffman");}
 const lb=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258],le=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0],db=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577],de=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
 let out=[],last=0;
 while(!last){last=bits(1);let type=bits(2);if(type===0){bi=(bi+7)&~7;let n=bits(16),nn=bits(16);if((n^nn)!==65535)throw Error("bad stored length");for(let i=0;i<n;i++)out.push(bits(8));continue;}if(type===3)throw Error("reserved deflate");
 let lit,dist;
 if(type===1){let lens=Array.from({length:288},(_,s)=>s<144?8:s<256?9:s<280?7:8);lit=tree(lens);dist=tree(new Array(32).fill(5));}
 else {let nl=bits(5)+257,nd=bits(5)+1,nc=bits(4)+4,order=[16,17,18,0,8,7,9,6,10,5,11,4,10,5],cl=new Array(19).fill(0);order=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];for(let i=0;i<nc;i++)cl[order[i]]=bits(3);let ct=tree(cl),lens=[];while(lens.length<nl+nd){let s=sym(ct);if(s<=15)lens.push(s);else{let count=s===16?bits(2)+3:s===17?bits(3)+3:bits(7)+11;let v=s===16?lens[lens.length-1]:0;if(v===undefined)throw Error("invalid repeat");for(let i=0;i<count;i++)lens.push(v);}}if(lens.length!==nl+nd)throw Error("excess lengths");lit=tree(lens.slice(0,nl));dist=tree(lens.slice(nl));}
 for(;;){let s=sym(lit);if(s<256){out.push(s);continue;}if(s===256)break;s-=257;if(s<0||s>=lb.length)throw Error("bad length");let len=lb[s]+bits(le[s]),d=sym(dist);if(d>=30)throw Error("bad distance");d=db[d]+bits(de[d]);if(d>out.length)throw Error("past start");for(let i=0;i<len;i++)out.push(out[out.length-d]);if(out.length>64*1024*1024)throw Error("inflation limit");}}
 const size=(data[data.length-4]|data[data.length-3]<<8|data[data.length-2]<<16|data[data.length-1]<<24)>>>0;if(out.length!==size)throw Error("size mismatch");
 let crc=~0;for(let b of out){crc^=b;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(~crc)>>>0;let expected=(data[data.length-8]|data[data.length-7]<<8|data[data.length-6]<<16|data[data.length-5]<<24)>>>0;if(crc!==expected)throw Error("crc mismatch");return new Uint8Array(out);
}
function utf8Decode(bytes) {let out="";for(let i=0;i<bytes.length;){let c=bytes[i++];if(c<128){out+=String.fromCharCode(c);continue;}let n=c<224?1:c<240?2:3,v=c&((1<<(6-n))-1);while(n--){let b=bytes[i++];if((b&192)!==128)throw Error("bad utf8");v=(v<<6)|(b&63);}out+=String.fromCodePoint(v);}return out;}
function utf8Encode(s) {let a=[];for(let ch of s){let c=ch.codePointAt(0);if(c<128)a.push(c);else if(c<2048)a.push(192|(c>>6),128|(c&63));else if(c<65536)a.push(224|(c>>12),128|((c>>6)&63),128|(c&63));else a.push(240|(c>>18),128|((c>>12)&63),128|((c>>6)&63),128|(c&63));}return new Uint8Array(a);}

function sha256Bytes(bytes){
 const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
 const H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],data=new Uint8Array(Math.ceil((bytes.length+9)/64)*64);data.set(bytes);data[bytes.length]=128;let bitlen=bytes.length*8;for(let i=0;i<8;i++){data[data.length-1-i]=bitlen%256;bitlen=Math.floor(bitlen/256);}
 const rr=(x,n)=>(x>>>n)|(x<<(32-n));for(let off=0;off<data.length;off+=64){const w=new Uint32Array(64);for(let i=0;i<16;i++)w[i]=(data[off+i*4]<<24)|(data[off+i*4+1]<<16)|(data[off+i*4+2]<<8)|data[off+i*4+3];for(let i=16;i<64;i++){let a=w[i-15],b=w[i-2];w[i]=(w[i-16]+(rr(a,7)^rr(a,18)^(a>>>3))+w[i-7]+(rr(b,17)^rr(b,19)^(b>>>10)))>>>0;}let [a,b,c,d,e,f,g,h]=H;for(let i=0;i<64;i++){let t1=(h+(rr(e,6)^rr(e,11)^rr(e,25))+((e&f)^(~e&g))+K[i]+w[i])>>>0,t2=((rr(a,2)^rr(a,13)^rr(a,22))+((a&b)^(a&c)^(b&c)))>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}for(let [i,x]of [a,b,c,d,e,f,g,h].entries())H[i]=(H[i]+x)>>>0;}return H.map(x=>x.toString(16).padStart(8,"0")).join("");
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
  const heads=new Int32Array(65536).fill(-1),previous=new Int32Array(bytes.length).fill(-1);
  const hash=position=>(((bytes[position]*251+bytes[position+1])*251+bytes[position+2])&65535);
  const insert=position=>{if(position+2>=bytes.length)return;let h=hash(position);previous[position]=heads[h];heads[h]=position;};
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
        candidate=previous[candidate];
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
  const crcTable=new Uint32Array(256);
  for(let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);crcTable[i]=c;}
  let crc=~0;for(let value of bytes)crc=(crc>>>8)^crcTable[(crc^value)&255];crc=(~crc)>>>0;
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

export {fromBase64, toBase64, utf8Encode, utf8Decode, sha256Bytes, inflateGzip, gzipBytes, encodeApplicationCarrier};
