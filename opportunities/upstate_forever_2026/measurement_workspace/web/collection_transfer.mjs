/** Existing checked-chunk transport for complete collection originals and editions. */
export const COLLECTION_CHUNK=256*1024;
export async function collectionSHA256(data){
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),n=>n.toString(16).padStart(2,'0')).join('');
}
export function collectionRandomId(){
 return Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
}
function encode(data){let s='';for(let n=0;n<data.length;n+=32768)s+=String.fromCharCode(...data.subarray(n,n+32768));return btoa(s);}
function decode(data){if(typeof data!=='string')throw new Error('The original chunk has no complete body.');return Uint8Array.from(atob(data),c=>c.charCodeAt(0));}
/** write() retains the complete pending body before using the existing API.
 * It clears that pending body only after receiving the original response.
 */
export async function uploadCollectionOriginal({row,file,definition,read,write,check,progress=()=>{},digest=collectionSHA256}){
 if(!file||file.size!==row.source.bytes)throw new Error('Reselect the complete original '+row.source.name+' ('+row.source.bytes+' bytes).');
 check();let active;
 try{active=await read('/large/intakes/'+row.intakeId);}catch(error){if(error.status!==404)throw error;}
 check();
 if(!active)active=await write('/large/intakes','POST',{...definition,id:row.intakeId,bytes:file.size},{kind:'upload',rowKey:row.key});
 check();
 if(active.id!==row.intakeId||active.bytes!==file.size||active.kind!==definition.kind)throw new Error('The retained intake has a different original definition. Keep it and create a new interpretation for this row.');
 if(!Number.isSafeInteger(active.offset)||active.offset<0||active.offset>file.size)throw new Error('The retained intake returned an invalid upload offset.');
 if(active.offset!==file.size&&active.offset%COLLECTION_CHUNK!==0)throw new Error('The retained prefix is not on an original chunk boundary.');
 const retained=active.offset;
 for(let offset=0;offset<file.size;offset+=COLLECTION_CHUNK){
  check();const data=new Uint8Array(await file.slice(offset,Math.min(offset+COLLECTION_CHUNK,file.size)).arrayBuffer());check();
  if(data.length!==Math.min(COLLECTION_CHUNK,file.size-offset))throw new Error('The selected file changed while its original bytes were read.');
  const sha256=await digest(data);check();const prefix=offset<retained;
  const response=await write('/large/intakes/'+row.intakeId+'/chunks','PUT',{offset,sha256,...(prefix?{check:true}:{base64:encode(data)})},{kind:'upload',rowKey:row.key});
  check();
  if(response.id!==row.intakeId||!Number.isSafeInteger(response.offset)||response.offset<offset+data.length||response.offset>file.size||(prefix&&!response.reused))throw new Error('The retained source prefix changed. Reopen this original intake before continuing.');
  active.offset=response.offset;progress({rowKey:row.key,checkedPrefix:prefix,bytes:offset+data.length,total:file.size});
 }
 return active;
}
/** A download owns one temporary file, so concurrent readers cannot remove it. */
export async function downloadCollectionMember({api,id,name,check,progress=()=>{},digest=collectionSHA256,download,storage=globalThis.navigator?.storage,maxMemoryBytes=64*1024*1024}){
 check();const edition=await api('/large/editions/'+id);check();
 const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 const member=edition.files?.find(x=>x.path===name);
 if(edition.id!==id||(edition.chunkBytes!==undefined&&edition.chunkBytes!==COLLECTION_CHUNK)||!member||!Number.isSafeInteger(member.bytes)||member.bytes<0||!validHash(member.sha256)||!Array.isArray(member.chunks)||member.chunks.length!==Math.ceil(member.bytes/COLLECTION_CHUNK)||member.chunks.some(v=>!validHash(v)))throw new Error('The saved complete member is unavailable.');
 let directory,handle,writable;const parts=[],temporary='collection-'+collectionRandomId();let total=0,finished=false;
 try{
  if(storage?.getDirectory){
   try{
    directory=await storage.getDirectory();check();
    handle=await directory.getFileHandle(temporary,{create:true});check();
    writable=await handle.createWritable();check();
   }catch(error){
    if(writable)await writable.abort().catch(()=>{});writable=null;
    if(directory)await directory.removeEntry(temporary).catch(()=>{});directory=null;handle=null;
    check();
   }
  }
  if(!writable&&member.bytes>maxMemoryBytes)throw new Error('This browser cannot retain this complete download on disk. Use the installed collection export command for this saved edition; its original files remain available.');
  for(let index=0;index<member.chunks.length;index++){
   check();const response=await api('/large/editions/'+id+'/files/'+encodeURIComponent(name)+'/'+index);check();
   const data=decode(response.base64),expectedBytes=Math.min(COLLECTION_CHUNK,member.bytes-index*COLLECTION_CHUNK);
   if(response.id!==id||response.name!==name||response.index!==index||response.bytes!==expectedBytes||response.sha256!==member.chunks[index]||data.length!==expectedBytes)throw new Error('The returned chunk belongs to another saved edition member or range.');
   if(await digest(data)!==member.chunks[index])throw new Error('Saved original download chunk differs from the selected edition.');
   check();total+=data.length;
   if(total>member.bytes)throw new Error('Saved original download exceeds its declared complete length.');
   if(writable)await writable.write(data);else parts.push(data);check();
   progress({name,bytes:total,total:member.bytes});
  }
  if(total!==member.bytes)throw new Error('The downloaded member is incomplete.');
  if(writable){await writable.close();writable=null;}check();
  const blob=handle?await handle.getFile():new Blob(parts,{type:member.type||'application/octet-stream'});check();
  if(blob.size!==member.bytes)throw new Error('Complete original download length differs.');
  const cleanup=async()=>{if(directory)await directory.removeEntry(temporary).catch(()=>{});};
  download(name,blob,cleanup);finished=true;return member;
 }finally{
  if(writable)await writable.abort().catch(()=>{});
  if(!finished&&directory)await directory.removeEntry(temporary).catch(()=>{});
 }
}
