'use strict';
/** Original ordered, deterministic customer ZIP serializer shared by every receiver. */
function createLeadCustomerArchive({sha256Utf8,sha256Bytes}){
const issue=message=>Object.assign(new Error(message),{status:422,code:'LEAD_CUSTOMER_BUNDLE'});
function utf8(value,size){
  const out=new Uint8Array(size);let i=0;
  for(const char of value){
    const cp=char.codePointAt(0);
    if(cp<0x80)out[i++]=cp;
    else if(cp<0x800){out[i++]=0xc0|(cp>>6);out[i++]=0x80|(cp&63);}
    else if(cp<0x10000){out[i++]=0xe0|(cp>>12);out[i++]=0x80|((cp>>6)&63);out[i++]=0x80|(cp&63);}
    else{out[i++]=0xf0|(cp>>18);out[i++]=0x80|((cp>>12)&63);out[i++]=0x80|((cp>>6)&63);out[i++]=0x80|(cp&63);}
  }
  return out;
}
function file(name,content){
  const identity=sha256Utf8(content);
  return {name,content,...identity,data:utf8(content,identity.bytes)};
}
const CRC_TABLE=Uint32Array.from({length:256},(_,n)=>{
  for(let bit=0;bit<8;bit++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;
  return n>>>0;
});
function crc32(bytes){
  let crc=0xffffffff;
  for(const byte of bytes)crc=CRC_TABLE[(crc^byte)&255]^(crc>>>8);
  return (crc^0xffffffff)>>>0;
}
/**
 * ZIP stored records (PKWARE APPNOTE 6.3.10, sections 4.3.7/4.3.12/4.3.16).
 * Fixed file order and 1980-01-01 archive metadata keep a saved edition repeatable.
 * Customer dates retain their full precision in the documents and manifest.
 */
function zip(files){
  const rows=files.map(row=>({...row,nameBytes:Uint8Array.from(row.name,c=>c.charCodeAt(0)),crc:crc32(row.data)}));
  const localSize=rows.reduce((sum,row)=>sum+30+row.nameBytes.length+row.bytes,0);
  const centralSize=rows.reduce((sum,row)=>sum+46+row.nameBytes.length,0);
  const total=localSize+centralSize+22;
  if(total>=0xffffffff||rows.length>=0xffff)throw issue('This customer archive exceeds the supported ZIP format.');
  const out=new Uint8Array(total),view=new DataView(out.buffer);
  const u16=(offset,value)=>view.setUint16(offset,value,true),u32=(offset,value)=>view.setUint32(offset,value,true);
  let offset=0;
  for(const row of rows){
    row.offset=offset;
    u32(offset,0x04034b50);u16(offset+4,20);u16(offset+6,0x800);
    u16(offset+12,33);u32(offset+14,row.crc);u32(offset+18,row.bytes);u32(offset+22,row.bytes);
    u16(offset+26,row.nameBytes.length);out.set(row.nameBytes,offset+30);
    out.set(row.data,offset+30+row.nameBytes.length);offset+=30+row.nameBytes.length+row.bytes;
  }
  for(const row of rows){
    u32(offset,0x02014b50);u16(offset+4,20);u16(offset+6,20);u16(offset+8,0x800);
    u16(offset+14,33);u32(offset+16,row.crc);u32(offset+20,row.bytes);u32(offset+24,row.bytes);
    u16(offset+28,row.nameBytes.length);u32(offset+42,row.offset);
    out.set(row.nameBytes,offset+46);offset+=46+row.nameBytes.length;
  }
  u32(offset,0x06054b50);u16(offset+8,rows.length);u16(offset+10,rows.length);
  u32(offset+12,centralSize);u32(offset+16,localSize);
  return out;
}
/** Build a complete customer archive from explicitly selected files. */
function leadCustomerFileArchive(files){
  if(!Array.isArray(files)||!files.length)throw issue('Select complete customer files.');
  const names=new Set();
  const prepared=files.map(row=>{
    if(!row||typeof row.name!=='string'||! /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(row.name)||
      row.name.split('/').some(part=>!part||part==='.'||part==='..')||names.has(row.name))
      throw issue('Use distinct ordinary relative customer filenames.');
    names.add(row.name);
    if(typeof row.content==='string')return file(row.name,row.content);
    if(!(row.content instanceof Uint8Array))throw issue('Keep complete text or binary customer file bytes.');
    return {name:row.name,data:row.content,...sha256Bytes(row.content)};
  });
  return zip(prepared);
}

/** Read only the exact deterministic ordinary-file format produced above. */
function readLeadCustomerArchive(content,{maxBytes=64*1024*1024,maxFiles=1000}={}){
  if(!(content instanceof Uint8Array)||!Number.isSafeInteger(maxBytes)||maxBytes<22||
    !Number.isSafeInteger(maxFiles)||maxFiles<1||content.length<22||content.length>maxBytes)
    throw issue('Choose a complete customer archive within the declared limits.');
  const view=new DataView(content.buffer,content.byteOffset,content.byteLength),end=content.length-22;
  const u16=n=>view.getUint16(n,true),u32=n=>view.getUint32(n,true);
  if(u32(end)!==0x06054b50||u16(end+4)||u16(end+6)||u16(end+20)||
    u16(end+8)!==u16(end+10)||u16(end+10)>maxFiles)
    throw issue('Choose the complete original single-disk customer ZIP.');
  const count=u16(end+10),central=u32(end+16);
  if(central+u32(end+12)!==end)throw issue('The customer ZIP directory is incomplete.');
  const files=[];let at=0;
  for(let i=0;i<count;i++){
    if(at+30>central||u32(at)!==0x04034b50)throw issue('The original customer ZIP member is incomplete.');
    const size=u32(at+22),names=u16(at+26),extra=u16(at+28),start=at+30+names+extra,finish=start+size;
    if(finish>central||finish<start||u32(at+18)!==size||u16(at+8)!==0)
      throw issue('Choose an original stored customer ZIP member.');
    let name='';for(const byte of content.subarray(at+30,at+30+names))name+=String.fromCharCode(byte);
    files.push({name,content:content.subarray(start,finish)});at=finish;
  }
  if(at!==central||!files.length)throw issue('The customer ZIP has extra or missing members.');
  // Reuse the original writer to validate all names, CRCs, flags, timestamps,
  // offsets, ordering and complete central-directory bytes without a second codec.
  const rebuilt=leadCustomerFileArchive(files);
  if(rebuilt.length!==content.length||rebuilt.some((byte,index)=>byte!==content[index]))
    throw issue('The customer archive differs from its exact original writer format.');
  return files.map(row=>({...row,...sha256Bytes(row.content)}));
}

return {file,zip,leadCustomerFileArchive,readLeadCustomerArchive};
}
module.exports={createLeadCustomerArchive};
