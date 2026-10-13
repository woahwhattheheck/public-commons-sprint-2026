// MIT. Complete stored ZIP handover for the original Runtime companion-set format.
// This scoped profile reads the ordinary ZIPs emitted by Runtime, without extraction.
import {APPLICATION_INPUT_SET_LIMITS as LIMITS,normalizeApplicationInputSet,applicationInputSetJSON} from './application-input-set-format.mjs';
export const APPLICATION_INPUT_SET_ARCHIVE_LIMITS=Object.freeze({bytes:128*1024*1024,metadata:24*1024*1024,members:LIMITS.files+LIMITS.directories+3});
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const check=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'APPLICATION_INPUT_SET_ARCHIVE_INVALID',status:400});};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fields=(x,names)=>plain(x)&&Object.keys(x).length===names.length&&Object.keys(x).every(k=>names.includes(k));
const same=(a,b)=>a.length===b.length&&a.every((n,i)=>n===b[i]);
const crcTable=new Uint32Array(256);
for(let n=0;n<256;n++){let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c>>>0;}
export function inputSetArchiveCRC(bytes,state=0xffffffff){let c=state;for(const n of bytes)c=crcTable[(c^n)&255]^(c>>>8);return c>>>0;}
const finishCRC=c=>(c^0xffffffff)>>>0;
const u16=(v,p)=>v.getUint16(p,true),u32=(v,p)=>v.getUint32(p,true);
const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
export const inputSetArchiveJSON=value=>encoder.encode(JSON.stringify(value,null,2)+'\n');
function encodedName(name){const bytes=encoder.encode(name);check(bytes.length>0&&bytes.length<=65535,'A complete original path exceeds the ZIP profile.');return bytes;}
export function inputSetArchiveLocal(name,size){
 const n=encodedName(name),b=new Uint8Array(30+n.length),v=view(b);
 v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x808,true);
 v.setUint16(12,33,true);v.setUint32(18,size,true);v.setUint32(22,size,true);v.setUint16(26,n.length,true);b.set(n,30);return b;
}
export function inputSetArchiveDescriptor(crc,size){const b=new Uint8Array(16),v=view(b);v.setUint32(0,0x08074b50,true);v.setUint32(4,crc,true);v.setUint32(8,size,true);v.setUint32(12,size,true);return b;}
export function inputSetArchiveCentral(name,size,crc,offset){
 const n=encodedName(name),b=new Uint8Array(46+n.length),v=view(b),directory=name.endsWith('/');
 v.setUint32(0,0x02014b50,true);v.setUint16(4,0x0314,true);v.setUint16(6,20,true);v.setUint16(8,0x808,true);
 v.setUint16(14,33,true);v.setUint32(16,crc,true);v.setUint32(20,size,true);v.setUint32(24,size,true);v.setUint16(28,n.length,true);
 v.setUint32(38,((directory?0o40700:0o100600)<<16)>>>0,true);v.setUint32(42,offset,true);b.set(n,46);return b;
}
export function inputSetArchiveEnd(count,centralBytes,offset){const b=new Uint8Array(22),v=view(b);v.setUint32(0,0x06054b50,true);v.setUint16(8,count,true);v.setUint16(10,count,true);v.setUint32(12,centralBytes,true);v.setUint32(16,offset,true);return b;}
export function inputSetArchiveLayout(record,complete){
 const rows=[{name:'input-set.json',body:inputSetArchiveJSON(record)},{name:'complete.json',body:inputSetArchiveJSON(complete)},
  {name:'originals/',body:new Uint8Array()},...record.manifest.directories.map(p=>({name:'originals/'+p+'/',body:new Uint8Array()})),
  ...record.manifest.files.map(file=>({name:'originals/'+file.path,file}))];
 let bytes=22;
 for(const row of rows){row.bytes=row.body?.length??row.file.bytes;const n=encodedName(row.name).length;bytes+=30+n+row.bytes+16+46+n;}
 check(rows.length<=APPLICATION_INPUT_SET_ARCHIVE_LIMITS.members&&bytes<=APPLICATION_INPUT_SET_ARCHIVE_LIMITS.bytes,'The complete archive exceeds the supported allowance.');
 return {rows,bytes};
}
/** read(offset,length) must return exactly those retained original bytes. No writer is called. */
export async function inspectApplicationInputSetArchive({bytes,read,sha256,onProgress=()=>{},signal}){
 check(Number.isSafeInteger(bytes)&&bytes>=22&&bytes<=APPLICATION_INPUT_SET_ARCHIVE_LIMITS.bytes,'Choose a complete Runtime source-set ZIP no larger than 128 MiB.');
 check(typeof read==='function'&&typeof sha256==='function','A complete original archive reader is required.');
 async function get(offset,length){
  signal?.throwIfAborted();check(Number.isSafeInteger(offset)&&Number.isSafeInteger(length)&&offset>=0&&length>=0&&offset+length<=bytes,'A complete ZIP member is outside the original file.');
  const result=await read(offset,length),raw=result instanceof Uint8Array?result:new Uint8Array(result);
  check(raw.length===length,'The complete original ZIP was shortened.');return raw;
 }
 const end=view(await get(bytes-22,22));
 check(u32(end,0)===0x06054b50&&u16(end,4)===0&&u16(end,6)===0&&u16(end,20)===0,'Choose an unchanged complete Runtime source-set ZIP.');
 const count=u16(end,10),centralBytes=u32(end,12),centralOffset=u32(end,16);
 check(count===u16(end,8)&&count>=4&&count<=APPLICATION_INPUT_SET_ARCHIVE_LIMITS.members&&centralOffset+centralBytes===bytes-22,'The complete ZIP inventory is invalid.');
 const entries=[],names=new Set();let cursor=centralOffset,localEnd=0;
 for(let i=0;i<count;i++){
  const central=await get(cursor,46),c=view(central),n=u16(c,28);
  check(u32(c,0)===0x02014b50&&u16(c,4)===0x0314&&u16(c,6)===20&&u16(c,8)===0x808&&u16(c,10)===0&&u16(c,12)===0&&u16(c,14)===33&&
   u16(c,30)===0&&u16(c,32)===0&&u16(c,34)===0&&u16(c,36)===0&&n>0&&cursor+46+n<=bytes-22,
   'Use an original stored Runtime source-set ZIP; compressed, linked or extended members are outside this profile.');
  const nameBytes=await get(cursor+46,n);let name;try{name=decoder.decode(nameBytes);}catch{check(false,'A complete ZIP path is not UTF-8.');}
  check(!names.has(name),'Duplicate original ZIP members are not admitted.');names.add(name);
  const size=u32(c,24),crc=u32(c,16),offset=u32(c,42),directory=name.endsWith('/');
  check(u32(c,20)===size&&offset===localEnd&&u32(c,38)===(((directory?0o40700:0o100600)<<16)>>>0),'The complete ZIP member type, size or original order is invalid.');
  check(size<=(name==='input-set.json'?APPLICATION_INPUT_SET_ARCHIVE_LIMITS.metadata:name==='complete.json'?4096:LIMITS.fileBytes)&&(!directory||size===0),'A complete ZIP member exceeds its allowance.');
  const local=await get(offset,30+n);
  check(same(local,inputSetArchiveLocal(name,size)),'The original local and central member definitions disagree.');
  const start=offset+local.length,stop=start+size;
  check(stop+16<=centralOffset,'A complete ZIP member overlaps the original inventory.');
  check(same(await get(stop,16),inputSetArchiveDescriptor(crc,size)),'The original ZIP member completion disagrees with its inventory.');
  entries.push({name,start,bytes:size,crc});localEnd=stop+16;cursor+=46+n;
 }
 check(cursor===bytes-22&&localEnd===centralOffset,'The complete ZIP has unaccounted or missing bytes.');
 const byName=new Map(entries.map(x=>[x.name,x])),manifestEntry=byName.get('input-set.json'),completeEntry=byName.get('complete.json');
 check(manifestEntry&&completeEntry,'The original source-set manifest and completion are required.');
 async function member(entry){const raw=await get(entry.start,entry.bytes);check(finishCRC(inputSetArchiveCRC(raw))===entry.crc,'A complete original ZIP member failed its CRC: '+entry.name);return raw;}
 const rawManifest=await member(manifestEntry),rawComplete=await member(completeEntry);let record,complete;
 try{record=JSON.parse(decoder.decode(rawManifest));complete=JSON.parse(decoder.decode(rawComplete));}catch{check(false,'The complete source-set metadata is not valid UTF-8 JSON.');}
 check(fields(record,['schema','workspaceId','setId','manifest'])&&record.schema==='stellar-forge.runtime-application-input-set-export.v1'&&
  typeof record.workspaceId==='string'&&record.workspaceId.length>0&&record.workspaceId.length<=128&&/^[a-f0-9]{64}$/.test(record.setId??''),'The original source-set identity is incomplete.');
 const manifest=normalizeApplicationInputSet(record.manifest);
 check(JSON.stringify(record.manifest)===JSON.stringify(manifest),'The complete original manifest is not normalized.');
 check(record.setId===await sha256(encoder.encode(applicationInputSetJSON(manifest))),'The complete manifest differs from its original set ID.');
 check(fields(complete,['setId','manifestSha256'])&&complete.setId===record.setId&&complete.manifestSha256===await sha256(rawManifest),'The original archive completion does not bind this full manifest.');
 const expected=inputSetArchiveLayout(record,complete);
 check(expected.bytes===bytes&&expected.rows.length===entries.length&&expected.rows.every((row,i)=>row.name===entries[i].name&&row.bytes===entries[i].bytes),'The complete original ZIP has missing, extra or reordered members.');
 const files=[];
 for(const row of expected.rows){
  const entry=byName.get(row.name);signal?.throwIfAborted();
  if(row.file){await onProgress({path:row.file.path,bytes:row.bytes,files:files.length,total:manifest.files.length});
   const raw=await member(entry);check(await sha256(raw)===row.file.sha256,'The complete original file differs: '+row.file.path);
   for(let i=0;i<row.file.chunkSha256.length;i++)check(await sha256(raw.subarray(i*LIMITS.chunkBytes,(i+1)*LIMITS.chunkBytes))===row.file.chunkSha256[i],'An original file chunk differs: '+row.file.path);
   files.push({...row.file,offset:entry.start});
  }else {const raw=await member(entry);check(same(raw,row.body),'The original ZIP metadata bytes differ.');}
 }
 return {schema:'stellar-forge.runtime-application-input-set-archive-review.v1',setId:record.setId,originWorkspaceId:record.workspaceId,manifest,files,bytes};
}
