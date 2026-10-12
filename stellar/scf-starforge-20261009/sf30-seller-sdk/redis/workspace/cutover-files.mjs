// MIT. Held original cutover files and sparse paging of their complete differences.
import {open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';

const hash=()=>createHash('sha256');
const issue=(code,message)=>Object.assign(new Error(message),{code,status:409});
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
const cache=new Map();
const MAX_CACHE=8388608,BLOCK=64;
let cacheBytes=0;
function safe(info,maximum){
  if(!info.isFile()||info.size>BigInt(maximum))
    throw issue('REDIS_CUTOVER_FILE_INVALID','Choose a complete regular cutover file within its original byte limit.');
}
export async function openRedisCutoverFile(path,{sha256,maximum=536870912}={}){
  if(sha256!==undefined&&!/^[a-f0-9]{64}$/.test(sha256))
    throw issue('REDIS_CUTOVER_FILE_DIGEST_INVALID','Use the saved complete file digest.');
  const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const before=await file.stat({bigint:true});safe(before,maximum);
    const digest=hash(),buffer=Buffer.allocUnsafe(262144);let position=0;
    while(position<Number(before.size)){
      const {bytesRead}=await file.read(buffer,0,Math.min(buffer.length,Number(before.size)-position),position);
      if(!bytesRead)throw issue('REDIS_CUTOVER_FILE_CHANGED','The original file ended before its saved length.');
      digest.update(buffer.subarray(0,bytesRead));position+=bytesRead;
    }
    const actual=digest.digest('hex');
    if(!same(before,await file.stat({bigint:true}))||sha256!==undefined&&actual!==sha256)
      throw issue('REDIS_CUTOVER_FILE_CHANGED','The complete original cutover file changed.');
    return {file,info:before,bytes:position,sha256:actual,
      async *stream({start=0,end=position}={}){
        if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>position)
          throw issue('REDIS_CUTOVER_RANGE_INVALID','Choose an exact range of the original file.');
        const chunk=Buffer.allocUnsafe(262144);let offset=start;
        while(offset<end){
          const {bytesRead}=await file.read(chunk,0,Math.min(chunk.length,end-offset),offset);
          if(!bytesRead)throw issue('REDIS_CUTOVER_FILE_CHANGED','The original file changed during download.');
          yield Buffer.from(chunk.subarray(0,bytesRead));offset+=bytesRead;
        }
        if(!same(before,await file.stat({bigint:true})))
          throw issue('REDIS_CUTOVER_FILE_CHANGED','The original file changed during download.');
      },close:()=>file.close()};
  }catch(error){await file.close();throw error;}
}
export async function redisCutoverFileDigest(path,options){
  const selected=await openRedisCutoverFile(path,options);
  try{return {bytes:selected.bytes,sha256:selected.sha256};}finally{await selected.close();}
}
// The engine emits deterministic two-space JSON. Control lines fit within 256
// bytes; arbitrary row strings can be much larger and never enter this buffer.
async function lines(file,start,end,visit,digest){
  const buffer=Buffer.allocUnsafe(262144),prefix=Buffer.allocUnsafe(256);
  let offset=start,lineStart=start,lineLength=0,prefixLength=0;
  while(offset<end){
    const {bytesRead}=await file.read(buffer,0,Math.min(buffer.length,end-offset),offset);
    if(!bytesRead)throw issue('REDIS_CUTOVER_FILE_CHANGED','The complete difference file ended during paging.');
    if(digest)digest.update(buffer.subarray(0,bytesRead));
    for(let i=0;i<bytesRead;i++){
      const value=buffer[i];
      if(value===10){
        const returned=visit({start:lineStart,end:offset+i,text:prefix.subarray(0,prefixLength).toString('utf8'),length:lineLength});
        const keep=returned&&typeof returned.then==='function'?await returned:returned;
        lineStart=offset+i+1;lineLength=0;prefixLength=0;
        if(keep===false)return;
      }else{if(prefixLength<prefix.length)prefix[prefixLength++]=value;lineLength++;}
    }
    offset+=bytesRead;
  }
  if(lineLength)await visit({start:lineStart,end,text:prefix.subarray(0,prefixLength).toString('utf8'),length:lineLength});
}
async function bytesAt(file,start,length){
  const bytes=Buffer.allocUnsafe(length);let position=0;
  while(position<length){
    const {bytesRead}=await file.read(bytes,position,length-position,start+position);
    if(!bytesRead)throw issue('REDIS_CUTOVER_FILE_CHANGED','The selected difference entry is incomplete.');
    position+=bytesRead;
  }
  return bytes;
}
function remember(key,index){
  const cost=index.blocks*24+index.headerBytes+1024;
  while(cache.size&&cacheBytes+cost>MAX_CACHE){
    const [old,value]=cache.entries().next().value;cache.delete(old);cacheBytes-=value.cost;
  }
  if(cost<=MAX_CACHE){cache.set(key,{...index,cost});cacheBytes+=cost;}
}
async function indexDifference(file,info,sha256){
  const key=[info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs,sha256].join(':');
  const retained=cache.get(key);
  if(retained){cache.delete(key);cache.set(key,retained);return retained;}
  const arrays={},digest=hash();let current=null,entry=null,firstArray=null,blocks=0;
  await lines(file,0,Number(info.size),line=>{
    const text=line.length<=256?line.text:null;
    const header=text?.match(/^  "(changed|removed|added)": \[(\])?,?$/);
    if(header){
      if(current||arrays[header[1]])throw issue('REDIS_CUTOVER_DIFFERENCE_INVALID','Keep the original complete difference structure.');
      firstArray??=line.start;const value={count:0,blocks:[],end:line.end};arrays[header[1]]=value;
      current=header[2]?null:header[1];return;
    }
    if(!current)return;
    if(text==='    {'){
      if(entry!==null)throw issue('REDIS_CUTOVER_DIFFERENCE_INVALID','The original difference entry is nested incorrectly.');
      entry=line.start+4;
      if(arrays[current].count%BLOCK===0){arrays[current].blocks.push(entry);blocks++;}
    }else if(text==='    }'||text==='    },'){
      if(entry===null)throw issue('REDIS_CUTOVER_DIFFERENCE_INVALID','The original difference entry has no beginning.');
      arrays[current].count++;entry=null;
    }else if(text==='  ]'||text==='  ],'){
      if(entry!==null)throw issue('REDIS_CUTOVER_DIFFERENCE_INVALID','The original difference entry is incomplete.');
      arrays[current].end=line.start;current=null;
    }
  },digest);
  if(current||entry!==null||firstArray===null||firstArray>2097152||digest.digest('hex')!==sha256||
      !same(info,await file.stat({bigint:true})))
    throw issue('REDIS_CUTOVER_DIFFERENCE_CHANGED','Keep the complete original difference file and its saved digest.');
  const header=await bytesAt(file,0,firstArray);
  let metadata;
  try{metadata=JSON.parse(header.toString('utf8')+'  "_paged": true\n}');}
  catch{throw issue('REDIS_CUTOVER_DIFFERENCE_INVALID','The original difference metadata is incomplete.');}
  const indexed={metadata,arrays,blocks,headerBytes:header.length};
  remember(key,indexed);return indexed;
}
/** Index each 64th original difference entry, then parse only the requested
 * entries. Full rows remain in the original file; no row copies are cached. */
export async function pageRedisCutoverDifference(path,{sha256,kind,offset=0,limit=25,maxResponseBytes=2097152}={}){
  if(!/^[a-f0-9]{64}$/.test(sha256??'')||!['changed','removed','added'].includes(kind)||
      !Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)
    throw issue('REDIS_CUTOVER_DIFFERENCE_QUERY_INVALID','Choose the original digest, difference group, offset and 1–100 entries.');
  const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const before=await file.stat({bigint:true});safe(before,536870912);
    const index=await indexDifference(file,before,sha256),array=index.arrays[kind]??{count:0,blocks:[]};
    if(offset>array.count)throw issue('REDIS_CUTOVER_DIFFERENCE_OFFSET_INVALID','Choose a position within this complete difference group.');
    const items=[];let used=0,nextOffset=null,oversized=null;
    if(offset<array.count){
      const block=Math.floor(offset/BLOCK);let row=block*BLOCK,entry=null;
      // The sparse offset points at "{". Rewind four spaces so the same format
      // reader handles the first entry exactly like every subsequent entry.
      await lines(file,array.blocks[block]-4,array.end,async line=>{
        const text=line.length<=256?line.text:null;
        if(text==='    {')entry=line.start+4;
        else if(text==='    }'||text==='    },'){
          if(entry===null)throw issue('REDIS_CUTOVER_DIFFERENCE_INVALID','The selected entry has no original beginning.');
          if(row>=offset){
            const length=line.start+5-entry;
            if(length>maxResponseBytes-used){
              nextOffset=row;oversized=items.length?null:{offset:row,bytes:length};return false;
            }
            const bytes=await bytesAt(file,entry,length);
            items.push(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));used+=length;
            if(items.length===limit){nextOffset=row+1<array.count?row+1:null;return false;}
          }
          row++;entry=null;
        }
      });
    }
    if(!same(before,await file.stat({bigint:true})))
      throw issue('REDIS_CUTOVER_DIFFERENCE_CHANGED','The original difference file changed while reading this page.');
    return {schema:'stellar-forge.redis-cutover-difference-page.v1',sha256,kind,offset,limit,
      total:array.count,counts:Object.fromEntries(['changed','removed','added'].map(name=>[name,index.arrays[name]?.count??0])),
      metadata:index.metadata,items,nextOffset,oversized,complete:nextOffset===null};
  }finally{await file.close();}
}
