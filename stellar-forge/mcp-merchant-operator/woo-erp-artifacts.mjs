// MIT. Complete original ERP source files, transport manifests and bounded JSON navigation.
import { constants } from 'node:fs';
import { open, mkdir, realpath, link, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { verifyErpProject, canonicalErpJson, ERP_MAX_BYTES } from '../../stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/merchant-erp-client.mjs';

export const ERP_EXPORT_SCHEMA='stellar-forge.sf104.erp-file-export.v1';
export const ERP_MAPPING_SCHEMA='stellar-forge.sf104.erp-map.v1';
export const ERP_FILE_LIMIT=ERP_MAX_BYTES;
const HASH=/^[a-f0-9]{64}$/,ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/;
export const erpPlain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const erpDigest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function erpFailure(code,message){return Object.assign(new Error(message),{code:'WOO_ERP_'+code});}
function need(value,code,message){if(!value)throw erpFailure(code,message);}
export function erpParseJson(bytes){
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
 catch{throw erpFailure('JSON_INVALID','Select a complete UTF-8 JSON source file.');}
}
export async function readPrivateErpFile(path,maximum=ERP_FILE_LIMIT){
 const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
 try{
  const before=await handle.stat({bigint:true});
  need(before.isFile()&&before.size<=BigInt(maximum)&&(process.platform==='win32'||!(before.mode&0o077n)),
   'PRIVATE_FILE_REQUIRED','Use a private regular source file within the original ERP size limit.');
  const bytes=await handle.readFile(),after=await handle.stat({bigint:true});
  need(BigInt(bytes.length)===before.size&&bytes.length<=maximum&&['dev','ino','size','mtimeNs','ctimeNs','mode','uid'].every(key=>before[key]===after[key]),
   'SOURCE_CHANGED','The original file changed while it was being read. Inspect its current bytes before continuing.');
  return bytes;
 }finally{await handle.close();}
}
export function readWooErpInputDefinitions(raw={},baseDirectory){
 need(erpPlain(raw)&&Object.keys(raw).length<=128,'CONFIGURATION_ERROR','Declare at most128 original ERP mapping/project inputs.');
 const entries=Object.create(null);
 for(const [name,item] of Object.entries(raw)){
  need(ALIAS.test(name)&&erpPlain(item)&&Object.keys(item).every(key=>['label','kind','file'].includes(key))&&
   ['mapping','project'].includes(item.kind)&&typeof item.file==='string'&&item.file.length>0&&!/[\0\r\n]/.test(item.file),
   'CONFIGURATION_ERROR','ERP inputs need a store-local alias, mapping/project kind and host-selected file path.');
  const label=item.label??name;
  need(typeof label==='string'&&label.length>0&&label.length<=240&&!/[\0\r\n]/.test(label),
   'CONFIGURATION_ERROR','Use a short plain ERP input label.');
  entries[name]={label,kind:item.kind,file:resolve(baseDirectory,item.file)};
 }
 return entries;
}
export function originalErpInput(kind,value){
 if(kind==='project'){
  try{verifyErpProject(value);}catch{throw erpFailure('PROJECT_INVALID','The complete original ERP project digest is invalid.');}
  need(HASH.test(value.operation?.operationId??'')&&Number.isSafeInteger(value.operation?.revision)&&value.operation.revision>=1,
   'PROJECT_INVALID','The original project must retain its operation ID and journal revision.');
  return value;
 }
 const mapping=value?.schema===ERP_MAPPING_SCHEMA?value:value?.mapping;
 need(erpPlain(mapping)&&mapping.schema===ERP_MAPPING_SCHEMA,'MAPPING_INVALID','Select a complete original ERP mapping or native mapping export.');
 return mapping;
}
export async function loadWooErpInput(store,name,expectedSha256){
 const selected=store.erpInputs?.[name];
 need(selected,'INPUT_NOT_FOUND','Choose an ERP input alias declared for this original Woo store.');
 const bytes=await readPrivateErpFile(selected.file),sha256=erpDigest(bytes),value=erpParseJson(bytes);
 need(expectedSha256===undefined||expectedSha256===sha256,'SOURCE_CHANGED','The selected ERP source differs from its inspected file hash.');
 const original=originalErpInput(selected.kind,value);
 return {selected,bytes,sha256,value,original};
}
const pointerPart=value=>String(value).replaceAll('~','~0').replaceAll('/','~1');
function valueAt(root,pointer=''){
 if(pointer==='')return root;
 need(pointer.startsWith('/')&&!/~(?:[^01]|$)/.test(pointer),'POINTER_INVALID','Use an original JSON pointer with ~0 and ~1 escapes.');
 let value=root;
 for(const escaped of pointer.slice(1).split('/')){
  const key=escaped.replaceAll('~1','/').replaceAll('~0','~');
  need((erpPlain(value)||Array.isArray(value))&&Object.hasOwn(value,key)&&
   (!Array.isArray(value)||/^(0|[1-9][0-9]*)$/.test(key)),'POINTER_NOT_FOUND','Select a child pointer returned by the original value page.');
  value=value[key];
 }
 return value;
}
function nodeView(value,pointer){
 const type=value===null?'null':Array.isArray(value)?'array':typeof value;
 const result={pointer,type};
 if(type==='array'||type==='object'){
  result.children=Object.keys(value).length;
  const serialized=JSON.stringify(value);
  if(Buffer.byteLength(serialized)<=2048)result.value=value;
 }else if(type==='string'){
  result.length=value.length;
  if(Buffer.byteLength(value)<=2048)result.value=value;
 }else result.value=value;
 return result;
}
/** Every child and every string suffix is reachable; only a child preview is bounded. */
export function pageWooErpValue(root,{pointer='',offset=0,limit,expectedSnapshotSha256}={},snapshotSha256=erpDigest(JSON.stringify(root))){
 need(offset===0||expectedSnapshotSha256,'SNAPSHOT_REQUIRED','Repeat the first page snapshotSha256 when continuing.');
 need(expectedSnapshotSha256===undefined||expectedSnapshotSha256===snapshotSha256,
  'SNAPSHOT_CHANGED','The original source changed. Reopen its first page and select the current native revision.');
 const value=valueAt(root,pointer),descriptor=nodeView(value,pointer);
 if(typeof value==='string'){
  limit??=4096;
  need(limit<=65536&&offset<=value.length,'PAGE_INVALID','Use a string offset within its original UTF-16 length and at most65536 units.');
  const text=value.slice(offset,offset+limit),end=offset+text.length;
  return {snapshotSha256,pointer,type:'string',offset,limit,total:value.length,units:'utf16',text,nextOffset:end<value.length?end:null};
 }
 if(erpPlain(value)||Array.isArray(value)){
  limit??=25;
  const keys=Object.keys(value);
  need(limit<=100&&offset<=keys.length,'PAGE_INVALID','Read at most100 original JSON children per page, within the returned total.');
  const selected=keys.slice(offset,offset+limit);
  return {snapshotSha256,pointer,type:descriptor.type,offset,limit,total:keys.length,
   nextOffset:offset+selected.length<keys.length?offset+selected.length:null,
   rows:selected.map(key=>({key,...nodeView(value[key],pointer+'/'+pointerPart(key))}))};
 }
 need(offset===0,'PAGE_INVALID','Scalar values have one original value and no continuation offset.');
 return {snapshotSha256,...descriptor,offset:0,total:1,nextOffset:null};
}
function verifyNativeValue(kind,id,value){
 if(kind==='project'){
  originalErpInput(kind,value);
  need(value.operation.operationId===id,'EXPORT_IDENTITY_CHANGED','The native project belongs to another original order.');
 }else{
  need(erpPlain(value)&&value.id===id&&erpPlain(value.mapping)&&value.mapping.schema===ERP_MAPPING_SCHEMA&&erpDigest(canonicalErpJson(value.mapping))===id,
   'EXPORT_IDENTITY_CHANGED','The native mapping differs from its selected immutable ID.');
 }
 return value;
}
export function parseWooErpManifest(bytes,selection={}){
 const value=erpParseJson(bytes);
 need(erpPlain(value)&&value.schema===ERP_EXPORT_SCHEMA&&ALIAS.test(value.store??'')&&ALIAS.test(value.exportId??'')&&
  ['mapping','project'].includes(value.kind)&&HASH.test(value.id??'')&&HASH.test(value.nativeSha256??'')&&
  typeof value.siteUrl==='string'&&value.siteUrl.length<=2048&&Array.isArray(value.files)&&value.files.length===1,
  'MANIFEST_INVALID','Select a complete original ERP project/mapping file manifest.');
 const filename=value.kind==='project'?'project.json':'mapping.json',file=value.files[0];
 need(erpPlain(file)&&file.name===filename&&Number.isSafeInteger(file.bytes)&&file.bytes>0&&file.bytes<=ERP_FILE_LIMIT&&HASH.test(file.sha256??'')&&
  (value.kind==='project'?Number.isSafeInteger(value.revision)&&value.revision>=1:value.revision===null&&value.nativeSha256===value.id),
  'MANIFEST_INVALID','The retained file set must match its original native project or mapping identity.');
 for(const key of ['store','siteUrl','kind','id','exportId']){
  need(selection[key]===undefined||value[key]===selection[key],'EXPORT_IDENTITY_CHANGED','This complete export belongs to another original store, operation or selection.');
 }
 return value;
}
async function privateDirectory(path,create){
 if(create)try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
 const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try{
  const info=await handle.stat();
  need(info.isDirectory()&&(process.platform==='win32'||!(info.mode&0o077))&&await realpath(path)===path,
   'PRIVATE_DIRECTORY_REQUIRED','Use the original private export directory without symlinked parents.');
 }finally{await handle.close();}
 return path;
}
export async function wooErpExportDirectory(exportsDirectory,selection,create=false){
 let directory=await privateDirectory(resolve(exportsDirectory),create);
 for(const part of ['woocommerce',selection.store,'erp',selection.kind,selection.id,selection.exportId]){
  need(typeof part==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(part),'EXPORT_SELECTION_INVALID','Use the original store, artifact kind, native ID and export alias.');
  directory=await privateDirectory(join(directory,part),create);
 }
 return directory;
}
async function writeRetained(path,bytes){
 const temporary=join(dirname(path),'.erp-write-'+randomUUID());
 let handle,created=false;
 try{
  handle=await open(temporary,'wx',0o600);created=true;await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
  try{await link(temporary,path);}
  catch(error){
   if(error.code!=='EEXIST')throw error;
   const existing=await readPrivateErpFile(path,Math.max(65000,bytes.length));
   need(existing.equals(bytes),'EXPORT_ID_CONFLICT','This export name already retains different original bytes. Reopen that export or choose a new name for a later edition.');
  }
  const parent=await open(dirname(path),constants.O_RDONLY);try{await parent.sync();}finally{await parent.close();}
 }finally{await handle?.close();if(created)await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export async function inspectWooErpExport(exportsDirectory,selection,{verify=true}={}){
 const directory=await wooErpExportDirectory(exportsDirectory,selection),bytes=await readPrivateErpFile(join(directory,'manifest.json'),65000);
 const manifest=parseWooErpManifest(bytes,selection),manifestSha256=erpDigest(bytes);
 let value;
 if(verify){
  const file=manifest.files[0],source=await readPrivateErpFile(join(directory,file.name));
  need(source.length===file.bytes&&erpDigest(source)===file.sha256,'EXPORT_CHANGED','The retained native file differs from its completion manifest.');
  value=verifyNativeValue(manifest.kind,manifest.id,erpParseJson(source));
  need((manifest.kind==='project'?value.sha256:value.id)===manifest.nativeSha256&&
   (manifest.kind==='project'?value.operation.revision:null)===manifest.revision,
   'EXPORT_CHANGED','The original native digest or journal revision differs from its manifest.');
 }
 return {directory,bytes,manifest,manifestSha256,value};
}
export async function retainWooErpExport(exportsDirectory,selection,expectedRevision,load){
 const directory=await wooErpExportDirectory(exportsDirectory,selection,true);
 let published=false;
 try{await readPrivateErpFile(join(directory,'manifest.json'),65000);published=true;}
 catch(error){if(error.code!=='ENOENT')throw error;}
 if(published){
  const saved=await inspectWooErpExport(exportsDirectory,selection);
  need(selection.kind!=='project'||saved.manifest.revision===expectedRevision,'EXPORT_ID_CONFLICT','This export name retains another original journal revision.');
  return saved;
 }
 const filename=selection.kind==='project'?'project.json':'mapping.json',path=join(directory,filename);
 let bytes,value;
 try{bytes=await readPrivateErpFile(path);value=verifyNativeValue(selection.kind,selection.id,erpParseJson(bytes));}
 catch(error){if(error.code!=='ENOENT')throw error;}
 if(value===undefined){
  value=verifyNativeValue(selection.kind,selection.id,await load());
  bytes=Buffer.from(JSON.stringify(value));
  need(bytes.length<=ERP_FILE_LIMIT,'EXPORT_TOO_LARGE','The complete native export exceeds its original16MiB file limit.');
 }
 need(selection.kind!=='project'||value.operation.revision===expectedRevision,'REVISION_CHANGED','Inspect the current original order before exporting its exact journal revision.');
 await writeRetained(path,bytes);
 const manifest={schema:ERP_EXPORT_SCHEMA,store:selection.store,siteUrl:selection.siteUrl,kind:selection.kind,id:selection.id,exportId:selection.exportId,
  nativeSha256:selection.kind==='project'?value.sha256:value.id,revision:selection.kind==='project'?value.operation.revision:null,
  files:[{name:filename,bytes:bytes.length,sha256:erpDigest(bytes)}]};
 await writeRetained(join(directory,'manifest.json'),Buffer.from(JSON.stringify(manifest)));
 return inspectWooErpExport(exportsDirectory,selection);
}
export function wooErpExportView(result){
 return {state:'MANIFEST_RETAINED',store:result.manifest.store,kind:result.manifest.kind,id:result.manifest.id,exportId:result.manifest.exportId,
  manifest:result.manifest,manifestSha256:result.manifestSha256,manifestFile:{name:'manifest.json',bytes:result.bytes.length,sha256:result.manifestSha256}};
}

export async function writeWooErpOutput(path,value){
 path=resolve(path);await privateDirectory(dirname(path),false);
 const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
 need(bytes.length<=ERP_FILE_LIMIT,'OUTPUT_TOO_LARGE','Use the complete original export downloader for larger output.');
 await writeRetained(path,bytes);
 return {path,bytes:bytes.length,sha256:erpDigest(bytes)};
}
