'use strict';

/* MIT. Ordinary source ZIP intake over the maintained connected_zip primitives
 * and connected_gzip raw inflater. PKWARE APPNOTE 6.3.10 sections 4.3–4.6.
 * Existing strict writer/readers remain unchanged. No filesystem or execution.
 */
const zip=require('./connected_zip.cjs');
const CP437="ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
const fail=(ok,message)=>{if(!ok)throw TypeError(message);};
const integer=(n,min,max,label)=>{if(!Number.isSafeInteger(n)||n<min||n>max)throw RangeError(label+' is outside its supported bound');return n;};
function same(a,b){if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;}
function relativeName(name,directory=false){
 fail(typeof name==='string'&&name.length>0&&!/[\x00-\x1f\x7f\\]/.test(name)&&!name.startsWith('/')&&!/^[A-Za-z]:/.test(name),'ZIP name is not an ordinary relative POSIX path');
 const path=directory&&name.endsWith('/')?name.slice(0,-1):name;
 fail(path&&path.split('/').every(p=>p&&p!=='.'&&p!=='..'),'ZIP name contains an empty or relative component');
 return path;
}
function cp437(bytes){let out='';for(const b of bytes)out+=b<128?String.fromCharCode(b):CP437[b-128];return out;}
function extras(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),result=[];let at=0;
 while(at<bytes.length){fail(at+4<=bytes.length,'Truncated ZIP extra field');const id=view.getUint16(at,true),size=view.getUint16(at+2,true);at+=4;
  fail(at+size<=bytes.length,'Truncated ZIP extra field payload');result.push({id,data:bytes.subarray(at,at+size)});at+=size;}
 return result;
}
function oneExtra(fields,id){const hits=fields.filter(x=>x.id===id);fail(hits.length<=1,'Ambiguous repeated ZIP identity extra field');return hits[0]?.data;}
function unicodeExtra(fields,id,raw){
 const field=oneExtra(fields,id);if(!field)return null;
 fail(field.length>=5,'Truncated Unicode ZIP extra field');
 if(field[0]!==1)return null;
 const crc=new DataView(field.buffer,field.byteOffset,field.byteLength).getUint32(1,true);
 // APPNOTE: an outdated CRC means this optional extra field must be ignored.
 if(crc!==zip.crc32(raw))return null;
 return zip.utf8Text(field.subarray(5));
}
function decodedName(raw,flags,fields){
 const extra=unicodeExtra(fields,0x7075,raw),utf8=!!(flags&0x800);
 const base=utf8?zip.utf8Text(raw):cp437(raw);
 relativeName(base,base.endsWith('/'));
 if(utf8&&extra!==null)fail(extra===base,'Unicode extra path differs from the UTF-8 name');
 const name=extra??base;relativeName(name,name.endsWith('/'));
 return {name,encoding:utf8?'utf8':extra!==null?'unicode-extra':'cp437'};
}
function readZipArchive(input,options={}){
 const maxBytes=integer(options.maxBytes??128*1024*1024,22,0x7fffffff,'maxBytes');
 const maxEntries=integer(options.maxEntries??2000,0,1000000,'maxEntries');
 const maxUncompressedBytes=integer(options.maxUncompressedBytes??128*1024*1024,0,0x7fffffff,'maxUncompressedBytes');
 fail(input instanceof Uint8Array&&input.length>=22&&input.length<=maxBytes,'Supply complete ZIP bytes within maxBytes');
 // Source bytes are retained exactly; caller must not mutate them while using this view.
 const bytes=input,view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const bounds=(at,size,end=bytes.length)=>fail(Number.isSafeInteger(at)&&Number.isSafeInteger(size)&&at>=0&&size>=0&&at+size<=end,'ZIP field exceeds its original boundary');
 const u16=at=>{bounds(at,2);return view.getUint16(at,true);};
 const u32=at=>{bounds(at,4);return view.getUint32(at,true);};
 const u64=at=>{bounds(at,8);const n=u32(at)+u32(at+4)*4294967296;fail(Number.isSafeInteger(n),'ZIP64 value exceeds exact JavaScript integer range');return n;};
 const slice=(at,size,end)=>{bounds(at,size,end);return bytes.subarray(at,at+size);};
 let eocd=-1;
 for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--){
  if(u32(at)===0x06054b50&&at+22+u16(at+20)===bytes.length){eocd=at;break;}
 }
 fail(eocd>=0,'Complete ZIP end directory and comment are required');
 fail(u16(eocd+4)===0&&u16(eocd+6)===0,'Multi-disk ZIP archives are unsupported');
 let count=u16(eocd+10),centralBytes=u32(eocd+12),centralOffset=u32(eocd+16),endDirectory=eocd,zip64=false;
 fail(u16(eocd+8)===count,'Split ZIP member counts are unsupported');
 const hasLocator=eocd>=20&&u32(eocd-20)===0x07064b50;
 if(hasLocator){
  zip64=true;const locator=eocd-20;
  fail(u32(locator+4)===0&&u32(locator+16)===1,'Multi-disk ZIP64 archives are unsupported');
  const start=u64(locator+8);bounds(start,56,locator);
  fail(u32(start)===0x06064b50,'ZIP64 directory locator is invalid');
  const size=u64(start+4);fail(size>=44&&start+12+size===locator,'ZIP64 directory boundary changed');
  fail(u32(start+16)===0&&u32(start+20)===0,'Multi-disk ZIP64 archives are unsupported');
  const fullCount=u64(start+32),fullBytes=u64(start+40),fullOffset=u64(start+48);
  fail(u64(start+24)===fullCount,'Split ZIP64 member counts are unsupported');
  fail((count===65535||count===fullCount)&&(centralBytes===0xffffffff||centralBytes===fullBytes)&&
    (centralOffset===0xffffffff||centralOffset===fullOffset),'Classic and ZIP64 directory identities differ');
  count=fullCount;centralBytes=fullBytes;centralOffset=fullOffset;endDirectory=start;
 }else fail(count!==65535&&centralBytes!==0xffffffff&&centralOffset!==0xffffffff,'Missing ZIP64 directory');
 integer(count,0,maxEntries,'ZIP entries');bounds(centralOffset,centralBytes,endDirectory);
 fail(centralOffset+centralBytes===endDirectory,'ZIP central directory has unaccounted bytes');
 const records=[];let at=centralOffset,total=0;
 for(let index=0;index<count;index++){
  bounds(at,46,endDirectory);fail(u32(at)===0x02014b50,'ZIP central member signature is invalid');
  const madeBy=u16(at+4),versionNeeded=u16(at+6),flags=u16(at+8),method=u16(at+10);
  fail((versionNeeded&255)<=45,'ZIP requires unsupported extraction features');
  fail((flags&~0x80e)===0,'Encrypted, patched or unsupported ZIP flags');
  fail(method===0||method===8,'Only STORE and ordinary DEFLATE members are supported');
  fail(method===8||(flags&6)===0,'Compression option flags do not match STORE');
  const nameLength=u16(at+28),extraLength=u16(at+30),commentLength=u16(at+32);
  bounds(at,46+nameLength+extraLength+commentLength,endDirectory);
  const nameBytes=slice(at+46,nameLength),extraBytes=slice(at+46+nameLength,extraLength),fields=extras(extraBytes);
  const commentBytes=slice(at+46+nameLength+extraLength,commentLength);
  let compressedBytes=u32(at+20),size=u32(at+24),localOffset=u32(at+42),disk=u16(at+34);
  const zip64Sizes=size===0xffffffff||compressedBytes===0xffffffff,z64=oneExtra(fields,1);
  if(zip64Sizes||localOffset===0xffffffff||disk===65535){
   fail(z64,'Missing member ZIP64 extra field');let p=0;
   const zv=new DataView(z64.buffer,z64.byteOffset,z64.byteLength),znum=width=>{
    fail(p+width<=z64.length,'Truncated member ZIP64 value');
    const n=zv.getUint32(p,true)+(width===8?zv.getUint32(p+4,true)*4294967296:0);p+=width;
    fail(Number.isSafeInteger(n),'Member ZIP64 value exceeds exact integer range');return n;};
   if(size===0xffffffff)size=znum(8);if(compressedBytes===0xffffffff)compressedBytes=znum(8);
   if(localOffset===0xffffffff)localOffset=znum(8);if(disk===65535)disk=znum(4);
  }
  fail(disk===0,'Multi-disk ZIP members are unsupported');
  total+=size;integer(total,0,maxUncompressedBytes,'Total uncompressed ZIP bytes');
  bounds(localOffset,30,centralOffset);fail(method!==0||size===compressedBytes,'Stored ZIP member sizes differ');
  const decoded=decodedName(nameBytes,flags,fields),externalAttributes=u32(at+38),host=madeBy>>>8;
  const unixMode=[3,19].includes(host)?externalAttributes>>>16:0,unixType=unixMode&0o170000;
  fail(!unixType||unixType===0o100000||unixType===0o040000,'ZIP symlinks and special files are unsupported');
  const directory=decoded.name.endsWith('/')||unixType===0o040000||!!(externalAttributes&16);
  fail(!directory||(!unixType||unixType===0o040000),'ZIP path and Unix file kind differ');
  fail(!directory||size===0,'ZIP directory has nonempty data');
  const path=relativeName(decoded.name,directory);
  const commentUnicode=unicodeExtra(fields,0x6375,commentBytes);
  records.push({index,name:decoded.name,path,kind:directory?'directory':'file',nameEncoding:decoded.encoding,
   mode:unixMode?unixMode&0o777:directory?0o755:0o644,unixMode,madeBy,versionNeeded,flags,method,
   bytes:size,compressedBytes,crc32:u32(at+16),dosTime:u16(at+12),dosDate:u16(at+14),
   localOffset,centralOffset:at,centralBytes:46+nameLength+extraLength+commentLength,zip64:zip64Sizes,
   nameBytes,extraBytes,commentBytes,commentText:commentUnicode??(flags&0x800?zip.utf8Text(commentBytes):cp437(commentBytes)),
   externalAttributes,internalAttributes:u16(at+36)});
  at+=46+nameLength+extraLength+commentLength;
 }
 fail(at===endDirectory,'ZIP member count and central directory differ');
 const canonical=new Map(),directoryNames=new Map();
 for(const r of records){const key=r.path.normalize('NFC').toLowerCase();fail(!canonical.has(key),'ZIP paths collide after Unicode/case normalization');canonical.set(key,r);}
 for(const r of records){const parts=r.path.split('/');for(let i=1;i<parts.length;i++){
  const originalParent=parts.slice(0,i).join('/'),parentKey=originalParent.normalize('NFC').toLowerCase();
  const earlier=directoryNames.get(parentKey);fail(!earlier||earlier===originalParent,'ZIP implicit directories collide after Unicode/case normalization');directoryNames.set(parentKey,originalParent);
  const parent=canonical.get(parentKey);
  if(parent)fail(parent.kind==='directory'&&parent.path===originalParent,'ZIP parent is a file or an aliased directory');
 }}
 const localOrder=[...records].sort((a,b)=>a.localOffset-b.localOffset);let expectedOffset=0;
 for(let i=0;i<localOrder.length;i++){
  const r=localOrder[i],o=r.localOffset,boundary=localOrder[i+1]?.localOffset??centralOffset;
  fail(o===expectedOffset&&u32(o)===0x04034b50,'ZIP local records overlap or contain unaccounted prefix bytes');
  fail(u16(o+4)===r.versionNeeded&&u16(o+6)===r.flags&&u16(o+8)===r.method&&
   u16(o+10)===r.dosTime&&u16(o+12)===r.dosDate,'ZIP local metadata differs from its central record');
  const names=u16(o+26),extraSize=u16(o+28);bounds(o,30+names+extraSize,boundary);
  const localName=slice(o+30,names),localExtra=slice(o+30+names,extraSize),fields=extras(localExtra);
  fail(same(localName,r.nameBytes),'ZIP local and central original name bytes differ');
  // A local Unicode extra, when present, must identify the same decoded path.
  const localUnicode=unicodeExtra(fields,0x7075,localName);
  if(localUnicode!==null)fail(localUnicode===r.name,'ZIP local Unicode path differs');
  let packed=u32(o+18),size=u32(o+22),localZip64=packed===0xffffffff||size===0xffffffff;
  if(localZip64){
   const extra=oneExtra(fields,1);fail(extra&&extra.length>=16,'Missing complete local ZIP64 sizes');
   const v=new DataView(extra.buffer,extra.byteOffset,extra.byteLength);
   const fullSize=v.getUint32(0,true)+v.getUint32(4,true)*4294967296;
   const fullPacked=v.getUint32(8,true)+v.getUint32(12,true)*4294967296;
   fail(Number.isSafeInteger(fullSize)&&Number.isSafeInteger(fullPacked),'Local ZIP64 size exceeds exact integer range');
   if(size===0xffffffff)size=fullSize;if(packed===0xffffffff)packed=fullPacked;
  }
  const descriptor=!!(r.flags&8),localCrc=u32(o+14);
  fail(descriptor?(localCrc===0||localCrc===r.crc32)&&(size===0||size===r.bytes)&&(packed===0||packed===r.compressedBytes):
   localCrc===r.crc32&&size===r.bytes&&packed===r.compressedBytes,'ZIP local sizes or CRC differ');
  const dataOffset=o+30+names+extraSize,dataEnd=dataOffset+r.compressedBytes;bounds(dataOffset,r.compressedBytes,boundary);
  let descriptorBytes=0,descriptorSignature=false;
  if(descriptor){
   const width=(r.zip64||localZip64)?8:4;
   // Exact next-header boundary disambiguates a CRC equal to the optional signature.
   for(const signature of [false,true]){
    const length=(signature?4:0)+4+2*width;
    if(dataEnd+length!==boundary)continue;
    let p=dataEnd;if(signature){if(u32(p)!==0x08074b50)continue;p+=4;}
    if(u32(p)!==r.crc32)continue;p+=4;
    const packedValue=width===8?u64(p):u32(p),sizeValue=width===8?u64(p+width):u32(p+width);
    if(packedValue===r.compressedBytes&&sizeValue===r.bytes){descriptorBytes=length;descriptorSignature=signature;break;}
   }
   fail(descriptorBytes>0,'ZIP data descriptor differs from the central record');
  }else fail(dataEnd===boundary,'ZIP has unaccounted member bytes');
  const compressed=bytes.subarray(dataOffset,dataEnd);
  const data=r.method===0?compressed:require('./connected_gzip.cjs').inflateRawBytes(compressed,{
   expected_bytes:r.bytes,max_output_bytes:Math.max(1,r.bytes),max_input_bytes:Math.max(1,maxBytes)}).data;
  fail(data.length===r.bytes&&zip.crc32(data)===r.crc32,'ZIP decoded length or CRC mismatch: '+r.name);
  Object.assign(r,{data,dataOffset,localExtraBytes:localExtra,localRecordBytes:boundary-o,
   descriptor:descriptor?{offset:dataEnd,bytes:descriptorBytes,signature:descriptorSignature,zip64:r.zip64||localZip64}:null});
  expectedOffset=boundary;
 }
 fail(expectedOffset===centralOffset,'ZIP contains unlisted local records');
 return {schema:'commons.zip-archive.v1',archive:{data:bytes,bytes:bytes.length,zip64,centralOffset,centralBytes,eocdOffset:eocd,
  commentBytes:bytes.subarray(eocd+22),entries:records.length,uncompressedBytes:total},entries:records};
}
module.exports={readZipArchive};
