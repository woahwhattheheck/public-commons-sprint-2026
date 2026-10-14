/** Read the complete immutable native populations without querying a live workspace. */
import {COLLECTION_CHUNK,collectionSHA256} from './collection_transfer.mjs';
import {inspectCollectionFolderEdition,readCollectionFolderBinding} from './collection_folder.mjs';
const clone=x=>JSON.parse(JSON.stringify(x));
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const FORMAT='upper-savannah-edition-reading/v1';
const populations={'accepted':'accepted.jsonl','excluded':'excluded.jsonl'};
export function collectionReadingFilters(value={}){
 if(!object(value)||Object.keys(value).some(k=>!['stationId','parameter','reason'].includes(k)))throw Error('Choose the original station, constituent and exclusion-reason filters.');
 const result={stationId:'',parameter:'',reason:''};
 for(const key of Object.keys(result)){if(value[key]!==undefined&&(typeof value[key]!=='string'||value[key].length>4096))throw Error('Reading filter is invalid: '+key);result[key]=value[key]??'';}
 return result;
}
function selection(edition){
 const value=inspectCollectionFolderEdition(edition).edition;
 for(const name of Object.values(populations))if(!value.files.some(f=>f.path===name))throw Error('This saved edition does not contain its complete accepted and excluded populations. Retain its original downloads.');
 if(!object(value.counts)||!Number.isSafeInteger(value.counts.accepted)||value.counts.accepted<0||!Number.isSafeInteger(value.counts.excluded)||value.counts.excluded<0||!Number.isSafeInteger(value.recordCount)||value.recordCount!==value.counts.accepted+value.counts.excluded)throw Error('Saved population counts are incomplete.');
 return value;
}
function query(value,edition){
 if(!object(value)||!Object.hasOwn(populations,value.population))throw Error('Choose accepted or excluded original inputs.');
 const member=edition.files.find(f=>f.path===populations[value.population]),offset=value.offset??0,limit=value.limit??50;
 if(!Number.isSafeInteger(offset)||offset<0||offset>member.bytes)throw Error('Choose a retained original reading position.');
 if(!Number.isSafeInteger(limit)||limit<1||limit>200)throw Error('Choose 1 to 200 complete records per page.');
 return {population:value.population,filters:collectionReadingFilters(value.filters),offset,limit};
}
export function validateCollectionReadingPosition(value,edition){
 const selected=selection(edition);
 if(!object(value)||value.format!==FORMAT||canonical(value.edition)!==canonical(selected))throw Error('The saved reading position belongs to a different complete edition.');
 const q=query(value,selected);
 if(!Array.isArray(value.history)||value.history.length>10000||value.history.some(v=>!Number.isSafeInteger(v)||v<0||v>q.offset)||new Set(value.history).size!==value.history.length)throw Error('The saved reading history is invalid.');
 if(value.history.some((n,i)=>i&&n<=value.history[i-1])||(value.history.length&&value.history.at(-1)>=q.offset))throw Error('The saved reading history is not ordered before this page.');
 return {format:FORMAT,edition:selected,...q,history:[...value.history]};
}
export function collectionReadingPosition(edition,values={}){
 const q=query({population:'accepted',filters:{},offset:0,limit:50,...values},selection(edition));
 return validateCollectionReadingPosition({format:FORMAT,edition:selection(edition),...q,history:values.history||[]},edition);
}
function checkCancellation(check,signal){check();if(signal?.aborted)throw Error('Reading paused. The selected edition and original reading position are retained.');}
function matches(row,filters){
 return (!filters.stationId||row.stationId===filters.stationId)&&(!filters.parameter||row.parameter===filters.parameter)&&(!filters.reason||(Array.isArray(row.reasons)&&row.reasons.includes(filters.reason)));
}
/** readChunk returns the actual native chunk bytes. Every use rechecks its identity. */
export function createCollectionEditionReader({edition,readChunk,check=()=>{},digest=collectionSHA256,maxRecordBytes=16*1024*1024}){
 const selected=selection(edition),cache=new Map();let closed=false;
 if(typeof readChunk!=='function'||!Number.isSafeInteger(maxRecordBytes)||maxRecordBytes<1)throw Error('A complete original byte reader is required.');
 const guard=signal=>{if(closed)throw Error('This saved-edition reader is closed.');checkCancellation(check,signal);};
 async function chunk(member,index,signal){
  guard(signal);const key=member.path+':'+index;
  if(cache.has(key)){const hit=cache.get(key);cache.delete(key);cache.set(key,hit);return hit;}
  const value=await readChunk(member,index);guard(signal);
  const bytes=value instanceof Uint8Array?value:new Uint8Array(value),expected=Math.min(COLLECTION_CHUNK,member.bytes-index*COLLECTION_CHUNK);
  if(bytes.length!==expected||await digest(bytes)!==member.chunks[index])throw Error('The original saved population changed: '+member.path+' / chunk '+index);guard(signal);
  cache.set(key,bytes);while(cache.size>4)cache.delete(cache.keys().next().value);return bytes;
 }
 async function line(member,start,signal){
  const parts=[];let size=0,offset=start,terminated=false;
  while(offset<member.bytes){
   const index=Math.floor(offset/COLLECTION_CHUNK),data=await chunk(member,index,signal),within=offset%COLLECTION_CHUNK;
   let end=data.indexOf(10,within);if(end<0)end=data.length;else terminated=true;
   const part=data.subarray(within,end);size+=part.length;
   if(size>maxRecordBytes)throw Error('An original record exceeds this reader’s '+maxRecordBytes+'-byte display budget. Download the complete original '+member.path+'; its bytes are retained.');
   parts.push(part);offset+=part.length+(terminated?1:0);if(terminated)break;
  }
  const bytes=new Uint8Array(size);let copied=0;for(const part of parts){bytes.set(part,copied);copied+=part.length;}
  const body=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
  if(!body.length)throw Error('The retained population contains an empty record at original byte '+start+'.');
  let row;try{row=JSON.parse(body);}catch{throw Error('The retained population record is not complete JSON at original byte '+start+'.');}
  if(!object(row)||typeof row.id!=='string'||!row.id)throw Error('The retained population record has no original identity at byte '+start+'.');
  return {row,start,nextOffset:offset,bytes:size};
 }
 return {
  edition:clone(selected),
  async page(value,{signal,progress=()=>{},maxScanBytes=8*1024*1024}={}){
   const q=query(value,selected),member=selected.files.find(f=>f.path===populations[q.population]);guard(signal);
   if(!Number.isSafeInteger(maxScanBytes)||maxScanBytes<1)throw Error('Choose a positive page scan budget.');
   if(q.offset>0&&q.offset<member.bytes){const prior=await chunk(member,Math.floor((q.offset-1)/COLLECTION_CHUNK),signal);if(prior[(q.offset-1)%COLLECTION_CHUNK]!==10)throw Error('The saved reading position is not an original record boundary.');}
   const rows=[];let offset=q.offset,scanned=0;
   while(offset<member.bytes&&rows.length<q.limit){
    const record=await line(member,offset,signal);guard(signal);offset=record.nextOffset;scanned++;
    if(matches(record.row,q.filters))rows.push({data:record.row,byteOffset:record.start,nextByteOffset:record.nextOffset});
    progress({population:q.population,bytes:offset,total:member.bytes,scanned,shown:rows.length});guard(signal);
    if(offset-q.offset>=maxScanBytes)break;
   }
   return {editionId:selected.id,workspaceRevision:selected.workspaceRevision,member:clone(member),...q,rows,nextOffset:offset,end:offset===member.bytes,scanned,scanBytes:offset-q.offset,nativePopulationCount:selected.counts[q.population]};
  },
  position:values=>collectionReadingPosition(selected,values),
  validatePosition:value=>validateCollectionReadingPosition(value,selected),
  close(){closed=true;cache.clear();}
 };
}
export async function openRemoteCollectionEditionReader({api,id,collectionId,check=()=>{},digest=collectionSHA256}){
 check();const edition=await api('/large/editions/'+id);check();inspectCollectionFolderEdition(edition,{id,collectionId});
 const readChunk=async(member,index)=>{
  check();const response=await api('/large/editions/'+id+'/files/'+encodeURIComponent(member.path)+'/'+index);check();
  const bytes=Math.min(COLLECTION_CHUNK,member.bytes-index*COLLECTION_CHUNK);
  if(response.id!==id||response.name!==member.path||response.index!==index||response.bytes!==bytes||response.sha256!==member.chunks[index]||typeof response.base64!=='string')throw Error('The returned population chunk belongs to another original member or range.');
  return Uint8Array.from(atob(response.base64),c=>c.charCodeAt(0));
 };
 return createCollectionEditionReader({edition,readChunk,check,digest});
}
async function localMember(directory,path){
 const parts=path.split('/');for(const part of parts.slice(0,-1))directory=await directory.getDirectoryHandle(part);
 return directory.getFileHandle(parts.at(-1));
}
/** Reads the existing complete folder and never writes or contacts its native workspace. */
export async function openFolderCollectionEditionReader({directory,check=()=>{},progress=()=>{},digest=collectionSHA256}){
 const received=await readCollectionFolderBinding({directory,check,digest});check();
 const edition=selection(received.selection.edition),files=await directory.getDirectoryHandle('files');check();
 const readChunk=async(member,index)=>{
  check();const file=await (await localMember(files,member.path)).getFile();check();if(file.size!==member.bytes)throw Error('The received original changed length: '+member.path);
  const start=index*COLLECTION_CHUNK;return new Uint8Array(await file.slice(start,Math.min(start+COLLECTION_CHUNK,member.bytes)).arrayBuffer());
 };
 const reader=createCollectionEditionReader({edition,readChunk,check,digest});
 return {...reader,folderName:directory.name,async originalFile(name){
  const member=edition.files.find(f=>f.path===name);if(!member)throw Error('Choose a member of this original edition.');
  const file=await (await localMember(files,name)).getFile();check();if(file.size!==member.bytes)throw Error('The received original changed length: '+name);
  for(let i=0;i<member.chunks.length;i++){const data=new Uint8Array(await file.slice(i*COLLECTION_CHUNK,Math.min((i+1)*COLLECTION_CHUNK,member.bytes)).arrayBuffer());check();if(await digest(data)!==member.chunks[i])throw Error('The received original changed: '+name+' / '+i);check();}
  return file;
 }};
}
