'use strict';
// MIT. Original UTF-8/Git-blob/ZIP32 serializer used for the retained EDMS and CalHFA source archives.
// Hash exact binary/UTF-8 SHA-256 with the separately maintained connected_sha256.cjs.

function utf8(s) {
  const out=[]; for(const ch of s){const n=ch.codePointAt(0); if(n>=0xd800&&n<=0xdfff)throw Error('Unpaired Unicode surrogate');
    if(n<0x80)out.push(n);else if(n<0x800)out.push(0xc0|(n>>6),0x80|(n&63));else if(n<0x10000)out.push(0xe0|(n>>12),0x80|((n>>6)&63),0x80|(n&63));else out.push(0xf0|(n>>18),0x80|((n>>12)&63),0x80|((n>>6)&63),0x80|(n&63));
  } return Uint8Array.from(out);
}
function join(parts){const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length}return out}
function sha1(raw){
 const n=raw.length,total=Math.ceil((n+9)/64)*64,buf=new Uint8Array(total);buf.set(raw);buf[n]=0x80;const dv=new DataView(buf.buffer);dv.setUint32(total-8,Math.floor(n/0x20000000),false);dv.setUint32(total-4,(n*8)>>>0,false);
 const w=new Uint32Array(80),rol=(v,s)=>(v<<s)|(v>>>(32-s));let h0=0x67452301,h1=0xefcdab89,h2=0x98badcfe,h3=0x10325476,h4=0xc3d2e1f0;
 for(let off=0;off<total;off+=64){for(let i=0;i<16;i++)w[i]=dv.getUint32(off+i*4,false);for(let i=16;i<80;i++)w[i]=rol(w[i-3]^w[i-8]^w[i-14]^w[i-16],1);
 let a=h0,b=h1,c=h2,d=h3,e=h4;for(let i=0;i<80;i++){let f,k;if(i<20){f=(b&c)|(~b&d);k=0x5a827999}else if(i<40){f=b^c^d;k=0x6ed9eba1}else if(i<60){f=(b&c)|(b&d)|(c&d);k=0x8f1bbcdc}else{f=b^c^d;k=0xca62c1d6}const t=(rol(a,5)+f+e+k+w[i])>>>0;e=d;d=c;c=rol(b,30);b=a;a=t}
 h0=(h0+a)>>>0;h1=(h1+b)>>>0;h2=(h2+c)>>>0;h3=(h3+d)>>>0;h4=(h4+e)>>>0
 }return [h0,h1,h2,h3,h4].map(n=>n.toString(16).padStart(8,'0')).join('')
}
function gitBlob(raw){return sha1(join([utf8('blob '+raw.length+'\0'),raw]))}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value}
function jsonBytes(value){return utf8(JSON.stringify(canonical(value),null,2)+'\n')}
function jsonText(value){return JSON.stringify(canonical(value),null,2)+'\n'}
const crcTable=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);return c>>>0});
function crc32(raw){let crc=0xffffffff;for(const b of raw)crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0}
function base64(raw){const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',chunks=[];let s='';for(let i=0;i<raw.length;i+=3){const a=raw[i],hasB=i+1<raw.length,hasC=i+2<raw.length,b=hasB?raw[i+1]:0,c=hasC?raw[i+2]:0,v=(a<<16)|(b<<8)|c;s+=chars[(v>>>18)&63]+chars[(v>>>12)&63]+(hasB?chars[(v>>>6)&63]:'=')+(hasC?chars[v&63]:'=');if(s.length>=16384){chunks.push(s);s=''}}chunks.push(s);return chunks.join('')}
function zipStored(files){
 if (!files || typeof files !== 'object' || Array.isArray(files)) throw TypeError('Named original byte arrays required');
 const names=Object.keys(files).sort(),locals=[],central=[];
 if (names.length > 65535) throw RangeError('ZIP32 supports at most 65535 original members');
 for (const name of names) {
  if (!name || name.startsWith('/') || /[\\\x00-\x1f\x7f]/.test(name) ||
      name.split('/').some(part=>!part || part==='.' || part==='..') ||
      utf8(name).length > 65535 || !(files[name] instanceof Uint8Array) || files[name].length > 0xffffffff)
    throw TypeError('Use original relative ZIP32 file names and complete byte arrays');
 }
 let offset=0;for(const name of names){const n=utf8(name),raw=files[name],crc=crc32(raw),h=new Uint8Array(30),v=new DataView(h.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(8,0,true);v.setUint16(10,0,true);v.setUint16(12,0x21,true);v.setUint32(14,crc,true);v.setUint32(18,raw.length,true);v.setUint32(22,raw.length,true);v.setUint16(26,n.length,true);
 const c=new Uint8Array(46),d=new DataView(c.buffer);d.setUint32(0,0x02014b50,true);d.setUint16(4,(3<<8)|20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(10,0,true);d.setUint16(12,0,true);d.setUint16(14,0x21,true);d.setUint32(16,crc,true);d.setUint32(20,raw.length,true);d.setUint32(24,raw.length,true);d.setUint16(28,n.length,true);d.setUint32(38,(0o100600<<16)>>>0,true);d.setUint32(42,offset,true);
 locals.push(h,n,raw);central.push(c,n);offset+=h.length+n.length+raw.length;if(offset>0xffffffff)throw RangeError('Original ZIP32 archive exceeds its offset capacity')}
 const directory=join(central);if(directory.length>0xffffffff)throw RangeError('Original ZIP32 directory exceeds capacity');const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,names.length,true);e.setUint16(10,names.length,true);e.setUint32(12,directory.length,true);e.setUint32(16,offset,true);return join([...locals,directory,end])
}
module.exports = {utf8,join,sha1,gitBlob,jsonBytes,jsonText,crc32,base64,zipStored};
