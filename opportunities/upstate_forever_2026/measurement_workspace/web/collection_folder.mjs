/** Complete original edition receiving into an explicitly selected local folder. */
import {COLLECTION_CHUNK,collectionSHA256} from './collection_transfer.mjs';
const FORMAT='upper-savannah-collection-folder/v1';
const RECEIPT='upper-savannah-collection-folder-received/v1';
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const clone=v=>JSON.parse(JSON.stringify(v));
const text=v=>JSON.stringify(v,null,2)+'\n';
const utf8=v=>new TextEncoder().encode(v);
function object(v){return v&&typeof v==='object'&&!Array.isArray(v);}
function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(object(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
function memberParts(value){
 if(typeof value!=='string'||!value||value.length>4096)throw Error('The original member path is invalid.');
 const parts=value.split('/');
 for(const part of parts)if(!part||part==='.'||part==='..'||/[\\:*?"<>|\u0000-\u001f]/.test(part)||/[. ]$/.test(part)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))throw Error('This exact original path cannot be received portably: '+value);
 return parts;
}
export function inspectCollectionFolderEdition(edition,{id=edition?.id,collectionId=edition?.collectionBinding?.collectionId}={}){
 if(!object(edition)||!hex(id)||edition.id!==id||!hex(collectionId)||edition.collectionBinding?.collectionId!==collectionId||edition.collectionBinding?.editionId!==id||!Number.isSafeInteger(edition.workspaceRevision)||edition.workspaceRevision<0||edition.chunkBytes!==COLLECTION_CHUNK||!Array.isArray(edition.files)||!edition.files.length)throw Error('Choose a complete saved collection edition with its original binding.');
 const paths=new Map();let total=0;
 for(const f of edition.files){
  if(!object(f)||!Number.isSafeInteger(f.bytes)||f.bytes<0||!hex(f.sha256)||!Array.isArray(f.chunks)||f.chunks.length!==Math.ceil(f.bytes/COLLECTION_CHUNK)||f.chunks.some(x=>!hex(x)))throw Error('The complete original edition has invalid member metadata.');
  const parts=memberParts(f.path),key=parts.map(p=>p.normalize('NFC').toLowerCase()).join('/');
  if(paths.has(key))throw Error('Original member paths collide on a receiving filesystem: '+f.path);
  for(const other of paths.keys())if(key.startsWith(other+'/')||other.startsWith(key+'/'))throw Error('Original file and directory paths collide: '+f.path);
  paths.set(key,f.path);total+=f.bytes;if(!Number.isSafeInteger(total))throw Error('The original edition exceeds an exact receiving byte count.');
 }
 return {format:FORMAT,edition:clone(edition),totalBytes:total};
}
async function maybeFile(directory,name){
 try{return await directory.getFileHandle(name);}catch(error){if(error.name==='NotFoundError')return null;throw error;}
}
async function readJSON(directory,name){
 const handle=await maybeFile(directory,name);if(!handle)throw Error('Retain the complete original '+name+' from this receiving folder.');
 const file=await handle.getFile();if(!file.size)throw Error('The original '+name+' is not complete yet. Resume the same receiving folder.');return JSON.parse(await file.text());
}
/** Recheck the original target around the exclusive writer and before commit. */
async function guardedWrite(handle,isComplete,produce,check){
 check();if(await isComplete())return;let stream;
 try{
  stream=await handle.createWritable({mode:'exclusive'});check();
  if(await isComplete()){await stream.abort();stream=null;return;}
  await produce(stream);check();
  if(await isComplete()){await stream.abort();stream=null;return;}
  await stream.close();stream=null;
 }finally{if(stream)await stream.abort().catch(()=>{});}
 check();
}
async function exactText(directory,name,value,check){
 const body=utf8(value);check();const handle=await directory.getFileHandle(name,{create:true});check();
 const complete=async()=>{const file=await handle.getFile();check();if(!file.size)return false;if(file.size!==body.length||await file.text()!==value)throw Error('Keep the different existing receiving file unchanged: '+name);check();return true;};
 await guardedWrite(handle,complete,async stream=>{await stream.write(body);check();},check);
 if(!await complete())throw Error('The complete receiving document differs after writing: '+name);return handle;
}
async function descend(directory,parts,create,check){
 for(const name of parts){check();directory=await directory.getDirectoryHandle(name,{create});check();if(directory.name!==name)throw Error('The destination changed an original directory name.');}return directory;
}
async function originalHandle(directory,name,create,check){
 const parts=memberParts(name),parent=await descend(directory,parts.slice(0,-1),create,check);
 const handle=create?await parent.getFileHandle(parts.at(-1),{create:true}):await maybeFile(parent,parts.at(-1));check();
 if(handle&&handle.name!==parts.at(-1))throw Error('The destination changed an original filename.');return handle;
}
async function checkedFile(handle,member,check,digest,{allowEmpty=false}={}){
 if(!handle)return false;const file=await handle.getFile();check();
 if(file.size===0&&member.bytes>0&&allowEmpty)return false;
 if(file.size!==member.bytes)throw Error('Keep the changed or incomplete original file unchanged: '+member.path);
 if(member.bytes===0&&await digest(new Uint8Array())!==member.sha256)throw Error('The empty original file hash differs: '+member.path);check();
 for(let index=0;index<member.chunks.length;index++){
  const start=index*COLLECTION_CHUNK,expected=Math.min(COLLECTION_CHUNK,member.bytes-start),bytes=new Uint8Array(await file.slice(start,start+expected).arrayBuffer());check();
  if(bytes.length!==expected||await digest(bytes)!==member.chunks[index])throw Error('The saved original file has changed: '+member.path+' / chunk '+index);check();
 }return true;
}
async function checkedChunk(handle,member,index,check,digest){
 if(!handle)return null;const file=await handle.getFile(),expected=Math.min(COLLECTION_CHUNK,member.bytes-index*COLLECTION_CHUNK);check();
 if(file.size===0&&expected>0)return null;
 if(file.size!==expected)throw Error('Retain the changed original receiving chunk: '+member.path+' / '+index);
 const data=new Uint8Array(await file.arrayBuffer());check();if(await digest(data)!==member.chunks[index])throw Error('Retain the changed original receiving chunk: '+member.path+' / '+index);check();return data;
}
async function remoteChunk(api,id,member,index,check,digest){
 check();const value=await api('/large/editions/'+id+'/files/'+encodeURIComponent(member.path)+'/'+index);check();
 const expected=Math.min(COLLECTION_CHUNK,member.bytes-index*COLLECTION_CHUNK);
 if(value.id!==id||value.name!==member.path||value.index!==index||value.bytes!==expected||value.sha256!==member.chunks[index]||typeof value.base64!=='string')throw Error('The returned original chunk selects another member or range.');
 const data=Uint8Array.from(atob(value.base64),c=>c.charCodeAt(0));
 if(data.length!==expected||await digest(data)!==member.chunks[index])throw Error('The original chunk bytes differ from this saved edition.');check();return data;
}
async function writeChunk(directory,name,data,member,index,check,digest){
 const handle=await directory.getFileHandle(name,{create:true});check();
 const complete=async()=>Boolean(await checkedChunk(handle,member,index,check,digest));
 await guardedWrite(handle,complete,async stream=>{await stream.write(data);check();},check);
 if(!await complete())throw Error('The complete checked receiving chunk was not retained.');return handle;
}
function receiptFor(selection,selectionSha256){
 return {format:RECEIPT,editionId:selection.edition.id,collectionId:selection.edition.collectionBinding.collectionId,selectionSha256,
  totalBytes:selection.totalBytes,files:selection.edition.files.map(f=>({path:f.path,bytes:f.bytes,sha256:f.sha256,chunks:f.chunks.length})),
  verification:'Every saved original byte range was read back against the immutable native chunk hashes and exact complete length; whole-file SHA-256 values are retained from that same native edition.'};
}
function openingFor(selection,selectionSha256){
 return '# Complete original Measurements collection edition\n\nPrepared by TokenJunkieLabs\n\nEdition: '+selection.edition.id+'\nCollection: '+selection.edition.collectionBinding.collectionId+'\nWorkspace revision: '+selection.edition.workspaceRevision+'\nSelection SHA-256: '+selectionSha256+'\n\nAll original recipient files are under files/ with their exact original relative paths. Open the reports there with their accompanying files. Keep project.zip complete when using the original installed archive receiver; a receiving folder does not recalculate a scientific study.\n\nEDITION.json retains the complete original edition, collection binding, original file lengths and full/chunk hashes. RECEIVED.json is written only after every full recipient file has been saved and read back against that selection. Until it exists, keep this partial folder and use Receive complete edition to folder again, selecting the SAME PARENT folder; the existing checked chunks will be reused. Never rename or edit the receiving metadata or chunk files. A changed original is preserved and reported instead of replaced.\n\nTo verify a completed folder after browser restart, use Verify received edition folder and select this edition folder itself. The check reads every original file without contacting or altering its native workspace. The declared whole-file hashes remain the original native values; this reader independently checks every native chunk and length.\n\nThe chunks/ directory contains durable interrupted receiving data. Verified member chunks are removed after the complete original file is received. Remaining chunks can be kept for a later exact resume; they are not extra scientific source files.\n';
}
async function receiveLocked({api,id,collectionId,directory,check,progress,digest}){
 check();const edition=await api('/large/editions/'+id);check();
 const selection=inspectCollectionFolderEdition(edition,{id,collectionId}),selectionText=text(selection),selectionSha256=await digest(utf8(selectionText));check();
 const folderName='measurement-edition-'+id;let root;
 try{root=await directory.getDirectoryHandle(folderName);}
 catch(error){if(error.name!=='NotFoundError')throw error;root=await directory.getDirectoryHandle(folderName,{create:true});}
 check();if(root.name!==folderName)throw Error('The receiving folder name changed.');
 const marker=await maybeFile(root,'EDITION.json');
 if(!marker||(await marker.getFile()).size===0){
  for await(const [name] of root.entries())if(name!=='EDITION.json')throw Error('The selected existing folder has no complete original edition binding. Keep it unchanged and select another parent folder.');
 }
 await exactText(root,'EDITION.json',selectionText,check);
 const files=await descend(root,['files'],true,check),chunks=await descend(root,['chunks'],true,check),received=[];
 let total=0;const cleanupErrors=[];
 for(let memberIndex=0;memberIndex<edition.files.length;memberIndex++){
  const member=edition.files[memberIndex],handle=await originalHandle(files,member.path,true,check);
  if(await checkedFile(handle,member,check,digest,{allowEmpty:true})){total+=member.bytes;received.push(member.path);progress({stage:'verified-existing',name:member.path,bytes:member.bytes,total:member.bytes,editionBytes:total,editionTotal:selection.totalBytes});continue;}
  const memberDirectory=await descend(chunks,[String(memberIndex)],true,check);
  for(let index=0;index<member.chunks.length;index++){
   const name=String(index)+'.chunk';let retained=await maybeFile(memberDirectory,name),data=await checkedChunk(retained,member,index,check,digest);
   if(!data){data=await remoteChunk(api,id,member,index,check,digest);retained=await writeChunk(memberDirectory,name,data,member,index,check,digest);await checkedChunk(retained,member,index,check,digest);}
   progress({stage:'receiving',name:member.path,bytes:Math.min((index+1)*COLLECTION_CHUNK,member.bytes),total:member.bytes,editionBytes:total,editionTotal:selection.totalBytes});
  }
  await guardedWrite(handle,()=>checkedFile(handle,member,check,digest,{allowEmpty:true}),async stream=>{
   for(let index=0;index<member.chunks.length;index++){const data=await checkedChunk(await maybeFile(memberDirectory,String(index)+'.chunk'),member,index,check,digest);if(!data)throw Error('The original checked receiving chunk disappeared.');await stream.write(data);check();}
  },check);
  check();await checkedFile(handle,member,check,digest);total+=member.bytes;received.push(member.path);
  progress({stage:'received',name:member.path,bytes:member.bytes,total:member.bytes,editionBytes:total,editionTotal:selection.totalBytes});
  for(let index=0;index<member.chunks.length;index++){check();try{await memberDirectory.removeEntry(String(index)+'.chunk');}catch(error){cleanupErrors.push(member.path+' / '+index+': '+error.message);}}
  try{await chunks.removeEntry(String(memberIndex));}catch(error){if(error.name!=='NotFoundError'&&error.name!=='InvalidModificationError')cleanupErrors.push(member.path+': '+error.message);}
 }
 check();await exactText(root,'START_HERE.md',openingFor(selection,selectionSha256),check);
 const receipt=receiptFor(selection,selectionSha256);await exactText(root,'RECEIVED.json',text(receipt),check);
 return {status:'COMPLETE',folderName,selectionSha256,receipt,cleanupErrors};
}
/** One actual selection, one whole-edition receiver, original verified chunk custody. */
export async function receiveCollectionEditionFolder({api,id,collectionId,directory,check=()=>{},progress=()=>{},digest=collectionSHA256,locks=globalThis.navigator?.locks}){
 if(!directory?.getDirectoryHandle||!locks?.request)throw Error('This browser does not expose selected-folder receiving with the required writer coordination. Use the existing complete-file download or installed export.');
 check();return locks.request('measurement-collection-folder:'+id,{mode:'exclusive',ifAvailable:true},async lock=>{
  if(!lock)throw Error('This original edition is already receiving in another tab. Resume it after that writer finishes.');
  return receiveLocked({api,id,collectionId,directory,check,progress,digest});
 });
}
/** Read the original folder's complete selection and receiving metadata.
 * Population readers verify each actual chunk they display; full reopening below
 * independently reads every complete member.
 */
export async function readCollectionFolderBinding({directory,check=()=>{},digest=collectionSHA256}){
check();const saved=await readJSON(directory,'EDITION.json');check();
 if(saved.format!==FORMAT)throw Error('Select the original complete Measurements edition folder.');
 const selection=inspectCollectionFolderEdition(saved.edition);
 if(canonical(saved)!==canonical(selection))throw Error('The saved edition binding or full source metadata changed.');
 const selectionSha256=await digest(utf8(text(selection))),expected=receiptFor(selection,selectionSha256),receipt=await readJSON(directory,'RECEIVED.json');check();
 if(canonical(receipt)!==canonical(expected))throw Error('The original edition has no matching complete receiving result. Resume its original receiving folder.');

 return {selection,selectionSha256,receipt};
}
/** Offline, read-only reopening of the complete original folder. */
export async function reopenCollectionEditionFolder({directory,check=()=>{},progress=()=>{},digest=collectionSHA256}){
 const {selection,selectionSha256,receipt}=await readCollectionFolderBinding({directory,check,digest});check();
const files=await descend(directory,['files'],false,check);let total=0;
 for(const member of selection.edition.files){const handle=await originalHandle(files,member.path,false,check);if(!await checkedFile(handle,member,check,digest))throw Error('The original complete file is missing: '+member.path);total+=member.bytes;progress({stage:'verified',name:member.path,bytes:member.bytes,total:member.bytes,editionBytes:total,editionTotal:selection.totalBytes});}
 return {status:'COMPLETE',folderName:directory.name,selectionSha256,receipt};
}
