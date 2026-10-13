#!/usr/bin/env node
'use strict';
/* MIT. Original archive receiving -> original Runtime Files and Companion sets.
 * No application save/start, provider execution, or new workspace is performed.
 */
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const zlib=require('node:zlib'),{pathToFileURL}=require('node:url'),{TextDecoder}=require('node:util');
const archive=require('./application_archive_source.cjs');
const {receivingIO:io}=require('./connected_zip_receive.cjs');
const zip=require('./connected_zip.cjs');
const SCHEMA='commons.runtime-companion-archive.v1',BINDING='commons.runtime-companion-archive-binding.v1';
const MAX_INPUT=16*1024*1024,MAX_PACKET=256*1024*1024,MAX_RECORD=16*1024*1024;
const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const UTF8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const need=(ok,message)=>{if(!ok)throw Object.assign(Error(message),{code:'RUNTIME_COMPANION_ARCHIVE'});};
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n','utf8');
const parse=raw=>JSON.parse(UTF8.decode(raw));
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const id=raw=>archive.identify(raw);
const sha=raw=>id(raw).sha256;
const cancelled=signal=>need(!signal?.aborted,'The original receiving operation was cancelled; resume the same saved input.');
const within=(child,parent)=>child===parent||child.startsWith(parent+path.sep);
async function exists(file){try{return await fs.lstat(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function publish(file,raw){await io.publishFile(path.dirname(file),path.basename(file),raw);return{path:file,...id(raw)};}
async function record(file){return parse(await io.readOriginal(file,MAX_RECORD));}
async function exactFile(file,raw){need((await io.readOriginal(file,Math.max(1,raw.length))).equals(raw),'Original retained file changed: '+file);}
async function realDirectory(value,label){
 need(typeof value==='string'&&path.isAbsolute(value),'Supply the existing absolute '+label+' directory.');
 const root=path.resolve(value);need(await fs.realpath(root)===root,'Choose the original real '+label+' directory, without symlink aliases.');
 const stat=await fs.lstat(root);need(stat.isDirectory()&&!stat.isSymbolicLink(),'Choose a real '+label+' directory.');return root;
}
async function intentDirectory(directory,intent){
 need(typeof directory==='string'&&path.isAbsolute(directory),'Supply the original absolute private receiving directory.');
 const root=path.resolve(directory),raw=json(intent);
 await io.privateDirectory(path.dirname(root));await io.privateDirectory(root,true);
 if(!await exists(path.join(root,'intent.json'))){
  for(const name of await fs.readdir(root)){
   need(/^\.zip-receive-[a-f0-9-]{36}\.part$/.test(name),'Receiving directory has no matching original intention.');
   const stat=await fs.lstat(path.join(root,name));
   need(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1,'Retained intent prefix is not an owned regular file.');
   const prefix=await io.readOriginal(path.join(root,name),raw.length);
   need(raw.subarray(0,prefix.length).equals(prefix),'Retained intent prefix belongs to another input.');
  }
 }
 await publish(path.join(root,'intent.json'),raw);return root;
}
function decodeInput(raw,expectedSha256){
 need(HASH.test(expectedSha256??'')&&raw.length<=MAX_INPUT&&sha(raw)===expectedSha256,
  'Supply the unchanged complete input and its independently retained SHA-256; Runtime Files accepts at most 16 MiB.');
 const compressed=raw[0]===31&&raw[1]===139;
 const decoded=compressed?zlib.gunzipSync(raw,{maxOutputLength:MAX_PACKET}):raw;
 need(decoded.length<=MAX_PACKET,'The complete decoded source packet exceeds 256 MiB.');
 const packet=parse(decoded),bound=archive.inspectBinding(packet);
 return{raw,decoded,packet,bound,compressed};
}
function manifestFor(source,name,format){
 const files=source.files.map(row=>{
  const raw=Buffer.from(row.encoding==='base64'?zip.fromBase64(row.content):zip.utf8(row.content));
  need(equal(id(raw),{bytes:row.bytes,sha256:row.sha256,git_blob_sha1:row.git_blob_sha1}),'Selected source member identity changed.');
  const chunks=[];for(let offset=0;offset<raw.length;offset+=format.APPLICATION_INPUT_SET_LIMITS.chunkBytes)
   chunks.push(sha(raw.subarray(offset,offset+format.APPLICATION_INPUT_SET_LIMITS.chunkBytes)));
  return{path:row.path,bytes:row.bytes,sha256:row.sha256,chunkSha256:chunks};
 });
 return format.normalizeApplicationInputSet({schema:format.APPLICATION_INPUT_SET_SCHEMA,name,directories:source.directories,files});
}
async function runtimeAPI(directory,forbidden=[]){
 const root=await realDirectory(directory,'trusted Runtime source');
 for(const other of forbidden)need(!within(root,other)&&!within(other,root),
  'The trusted Runtime source must be separate from received application data and its receiving directory.');
 const names=['model.mjs','application-inputs.mjs','application-input-set-sources.mjs','application-input-set-archives.mjs','public/application-input-set-format.mjs','storage.mjs'];
 const original=[];
 for(const name of names)original.push({path:name,...id(await io.readOriginal(path.join(root,name),2*1024*1024))});
 const [model,inputs,sets,archives,format,storage]=await Promise.all(names.map(name=>import(pathToFileURL(path.join(root,name)).href)));
 need(typeof model.openRuntimeWorkspace==='function'&&typeof inputs.retainApplicationInputFile==='function'&&
  typeof sets.readApplicationInputSetDirectory==='function'&&typeof sets.retainApplicationInputSetDirectory==='function'&&
  typeof archives.exportApplicationInputSetArchive==='function'&&typeof archives.inspectApplicationInputSetArchiveFile==='function'&&
  typeof format.normalizeApplicationInputSet==='function'&&typeof storage.operationLease==='function','Use the existing complete Runtime Companion implementation.');
 async function unchanged(){
  for(const row of original)need(equal(id(await io.readOriginal(path.join(root,row.path),2*1024*1024)),
   {bytes:row.bytes,sha256:row.sha256,git_blob_sha1:row.git_blob_sha1}),'Trusted Runtime entry source changed during receiving.');
 }
 await unchanged();
 return{root,original,unchanged,...model,...inputs,...sets,...archives,format,operationLease:storage.operationLease};
}
async function withReceivingOwner(api,root,action){
 const lease=await api.operationLease(path.join(root,'receiving.lock'));
 try{return await action();}finally{await lease.close();}
}
function associationFor({workspaceId,setId,manifest,inputUpload,decoded,runtimeEntries}){
 return{schema:BINDING,workspaceId,setId,manifest,
  inputUpload:{uploadId:inputUpload,...id(decoded.raw),encoding:decoded.compressed?'gzip':'utf-8'},
  packet:id(decoded.decoded),archive:id(decoded.bound.archive),archiveBinding:decoded.bound.binding,
  coverage:decoded.bound.source.coverage,runtimeEntries,applicationExecution:false};
}
async function withRuntime(api,workspace,workspaceId,action){
 need(UUID.test(workspaceId??''),'Select the existing Runtime workspace UUID.');
 const model=await api.openRuntimeWorkspace({directory:workspace});let result,error;
 try{
  const state=await model.applicationInputSetsState({query:'',offset:0,limit:1,workingOffset:0,workingLimit:1});
  need(state.workspaceId===workspaceId,'This is not the selected original Runtime workspace.');
  result=await action(model);
 }catch(e){error=e;}
 finally{try{await model.close();}catch(e){
  if(error)error=Object.assign(Error(error.message+'; Runtime close also failed: '+e.message),
   {code:error.code??'RUNTIME_COMPANION_ARCHIVE',cause:error,closeError:{code:e.code,message:e.message}});
  else error=e;
 }}
 if(error)throw error;await api.unchanged();return result;
}
async function downloaded(model,uploadId,expected,{signal}={}){
 cancelled(signal);need(HASH.test(uploadId??''),'Original upload identity is missing.');
 const source=await model.applicationInputDownload({uploadId});let primary=null,total=0;
 const digest=crypto.createHash('sha256'),chunks=[];
 try{
  need(source.bytes===expected.bytes&&source.sha256===expected.sha256,'Retained Runtime file metadata differs.');
  for await(const part of source.stream){
   cancelled(signal);total+=part.length;need(total<=expected.bytes&&total<=MAX_INPUT,'Retained Runtime file exceeds its original bound.');
   digest.update(part);chunks.push(Buffer.from(part));
  }
  need(total===expected.bytes&&digest.digest('hex')===expected.sha256,'Retained Runtime file bytes differ.');
 }catch(e){primary=e;}
 finally{
  try{source.stream.destroy();}catch(e){primary??=e;}
  try{await source.close();}catch(e){primary??=e;}
 }
 if(primary)throw primary;return Buffer.concat(chunks,total);
}
async function verifySet(model,binding,api,signal){
 const set=await model.applicationInputSetInspect({setId:binding.setId});
 need(set.workspaceId===binding.workspaceId&&set.phase==='READY'&&equal(set.manifest,binding.manifest)&&
  sha(Buffer.from(api.format.applicationInputSetJSON(set.manifest),'utf8'))===set.setId,
  'The original complete Companion set changed.');
 need(set.files.length===set.manifest.files.length,'The original Companion member inventory is incomplete.');
 const expected=new Map(set.manifest.files.map(row=>[row.path,row]));const seen=new Set();
 for(const file of set.files){
  const row=expected.get(file.path);need(row&&!seen.has(file.path)&&file.phase==='READY'&&
   file.bytes===row.bytes&&file.sha256===row.sha256,'The original Companion member changed.');
  seen.add(file.path);await downloaded(model,file.uploadId,row,{signal});
 }
 return set;
}
async function verifiedBinding(model,result,api,signal){
 need(result?.schema===SCHEMA&&result.state==='RECEIVED'&&result.applicationExecution===false,'Open the complete original receiving result.');
 const bindingRaw=await downloaded(model,result.bindingUpload.uploadId,result.bindingUpload,{signal});
 const binding=parse(bindingRaw);
 need(binding.schema===BINDING&&binding.workspaceId===result.workspaceId&&binding.setId===result.setId&&
  equal(binding,result.binding),'The retained complete association differs.');
 const raw=await downloaded(model,binding.inputUpload.uploadId,binding.inputUpload,{signal});
 const decoded=decodeInput(raw,binding.inputUpload.sha256),manifest=manifestFor(decoded.bound.source,binding.manifest.name,api.format);
 need(equal(id(decoded.decoded),binding.packet)&&equal(id(decoded.bound.archive),binding.archive)&&
  equal(decoded.bound.binding,binding.archiveBinding)&&equal(manifest,binding.manifest)&&
  equal(decoded.bound.source.coverage,binding.coverage),'The retained packet no longer describes this exact Companion set.');
 const set=await verifySet(model,binding,api,signal);
 return{binding,bindingRaw,inputRaw:raw,decoded,set};
}
async function receive({input,expectedSha256,directory,runtimeSource,workspace,workspaceId,name,python,node=process.execPath,signal}={}){
 cancelled(signal);
 need(typeof python==='string'&&path.isAbsolute(python)&&typeof node==='string'&&path.isAbsolute(node),
  'Choose the existing absolute Python and Node executables.');
 const target=await realDirectory(workspace,'existing Runtime workspace');
 need(typeof directory==='string'&&path.isAbsolute(directory),'Supply the original absolute private receiving directory.');
 const destination=path.resolve(directory);
 need(!within(destination,target)&&!within(target,destination),'Use a separate receiving directory outside the existing Runtime workspace.');
 const raw=await io.readOriginal(path.resolve(input),MAX_INPUT),decoded=decodeInput(raw,expectedSha256);
 const api=await runtimeAPI(runtimeSource,[destination,target]);
 const manifest=manifestFor(decoded.bound.source,name,api.format); // All original limits before workspace mutation.
 const setId=sha(Buffer.from(api.format.applicationInputSetJSON(manifest),'utf8'));
 need(json(associationFor({workspaceId,setId,manifest,inputUpload:'0'.repeat(64),decoded,runtimeEntries:api.original})).length<=MAX_INPUT,
  'The complete association exceeds the original Runtime Files limit; keep the complete packet in host receiving.');
 const intent={schema:SCHEMA,command:'receive',input:id(raw),packet:id(decoded.decoded),workspace:target,workspaceId,
  runtimeSource:api.root,runtimeEntries:api.original,manifest,python,node};
 await withRuntime(api,target,workspaceId,async()=>null);
 const root=await intentDirectory(destination,intent);
 return withReceivingOwner(api,root,async()=>{
 const inputName=decoded.compressed?'original-source.json.gz':'original-source.json',heldInput=path.join(root,inputName);
 await publish(heldInput,raw);
 const received=await archive.receive({input:heldInput,directory:path.join(root,'archive-source'),python,node,signal});
 need(received.status==='COMPLETE'&&equal(received.packet,id(decoded.decoded)),'The unchanged original source receiver did not complete.');
 const source=await api.readApplicationInputSetDirectory({directory:received.sourceDirectory,name});
 need(equal(source.manifest,manifest),'The received source tree differs from the retained complete source packet.');
 // The original receiver verified executable identity. Companion copies are private
 // editable data; their packet retains original modes without changing the set engine.
 const result=await withRuntime(api,target,workspaceId,async model=>{
  cancelled(signal);
  const inputUpload=await api.retainApplicationInputFile(model,{path:heldInput,name:'application-source-'+sha(raw)+(decoded.compressed?'.json.gz':'.json')});
  need(inputUpload.phase==='READY','The original packet upload is incomplete.');
  await downloaded(model,inputUpload.uploadId,id(raw),{signal});
  const set=await api.retainApplicationInputSetDirectory(model,{directory:received.sourceDirectory,name,expectedManifest:manifest});
  need(set.phase==='READY'&&set.setId===setId&&set.workspaceId===workspaceId,'The original selected source set did not complete.');
  const binding=associationFor({workspaceId,setId,manifest,inputUpload:inputUpload.uploadId,decoded,runtimeEntries:api.original});
  const bindingRaw=json(binding);need(bindingRaw.length<=MAX_INPUT,'Complete source association exceeds the original Files limit.');
  await verifySet(model,binding,api,signal);
  const bindingPath=path.join(root,'association.json');await publish(bindingPath,bindingRaw);
  const saved=await api.retainApplicationInputFile(model,{path:bindingPath,name:'application-source-association-'+sha(bindingRaw)+'.json'});
  need(saved.phase==='READY','The original source association upload is incomplete.');
  await downloaded(model,saved.uploadId,id(bindingRaw),{signal});
  return{schema:SCHEMA,state:'RECEIVED',workspaceId,workspace:target,runtimeSource:api.root,setId,
   bindingUpload:{uploadId:saved.uploadId,...id(bindingRaw)},binding,applicationExecution:false};
 });
 // Close and reopen the original Runtime model before accepting its complete inputs.
 await withRuntime(api,target,workspaceId,model=>verifiedBinding(model,result,api,signal));
 cancelled(signal);await exactFile(heldInput,raw);
 await publish(path.join(root,'complete.json'),json(result));
 return{...result,receivingDirectory:root,sourceDirectory:received.sourceDirectory};
 });
}
async function openResult(directory,runtimeSource,workspace,workspaceId){
 const root=await realDirectory(directory,'original receiving');
 await io.privateDirectory(root);const result=await record(path.join(root,'complete.json')),intent=await record(path.join(root,'intent.json'));
 need(result.schema===SCHEMA&&result.workspace===intent.workspace&&result.workspaceId===intent.workspaceId&&
  result.runtimeSource===intent.runtimeSource&&equal(result.binding.manifest,intent.manifest)&&
  equal(result.binding.packet,intent.packet)&&equal(
   {bytes:result.binding.inputUpload.bytes,sha256:result.binding.inputUpload.sha256,git_blob_sha1:result.binding.inputUpload.git_blob_sha1},intent.input),
  'The original receiving intention and result differ.');
 const target=await realDirectory(workspace,'selected existing Runtime workspace');
 need(UUID.test(workspaceId??'')&&target===result.workspace&&workspaceId===result.workspaceId,
  'Explicitly select the same original Runtime workspace and UUID; received metadata is not mutation authority.');
 const api=await runtimeAPI(runtimeSource,[root,target]);
 need(api.root===result.runtimeSource&&equal(api.original,intent.runtimeEntries),'Use the same retained Runtime source edition for this receiving operation.');
 return{root,result,api};
}
async function review({directory,runtimeSource,workspace,workspaceId,signal}={}){
 const {root,result,api}=await openResult(directory,runtimeSource,workspace,workspaceId);
 await withRuntime(api,result.workspace,result.workspaceId,model=>verifiedBinding(model,result,api,signal));
 return{schema:SCHEMA,state:'VERIFIED',workspaceId:result.workspaceId,setId:result.setId,
  receivingDirectory:root,packet:result.binding.packet,originalFiles:result.binding.manifest.files.length,
  applicationExecution:false};
}
async function prepare({directory,runtimeSource,workspace,workspaceId,requestId,kind,field,memberPath='',signal}={}){
 need(UUID.test(requestId??'')&&typeof kind==='string'&&kind&&typeof field==='string'&&field,
  'Supply the original preparation UUID and existing application kind/path setting.');
 const {root,result,api}=await openResult(directory,runtimeSource,workspace,workspaceId);
 if(memberPath)api.format.applicationInputSetPath(memberPath);
 need(!memberPath||result.binding.manifest.files.some(row=>row.path===memberPath),'Select an actual original source member, or the whole folder.');
 const input={requestId,setId:result.setId,kind,field,memberPath};
 return withReceivingOwner(api,root,async()=>{
 const requests=path.join(root,'working-selections');await io.privateDirectory(requests,true);
 await publish(path.join(requests,requestId+'.json'),json(input));
 const selection=await withRuntime(api,result.workspace,result.workspaceId,async model=>{
  await verifiedBinding(model,result,api,signal);cancelled(signal);
  const value=await model.applicationInputSetPrepare(input);
  need(value.phase==='PREPARED'&&value.requestId===requestId&&value.setId===result.setId&&
   value.workspaceId===result.workspaceId,'Original working selection did not complete.');
  return value;
 });
 return{schema:SCHEMA,state:'PREPARED',workspaceId:result.workspaceId,setId:result.setId,selection,
  next:'Open the existing Application path setting, continue this retained working selection, then use Review application.',
  applicationSaved:false,applicationExecution:false};
 });
}
async function exportReceived({directory,runtimeSource,workspace,workspaceId,output,signal}={}){
 const {root,result,api}=await openResult(directory,runtimeSource,workspace,workspaceId);
 need(typeof output==='string'&&path.isAbsolute(output),'Select the independent private export directory.');
 const destination=path.resolve(output);
 for(const original of [root,path.resolve(result.workspace),api.root])need(!within(destination,original)&&!within(original,destination),
  'Use a separate export directory outside the source, receiving and Runtime workspace.');
 return withReceivingOwner(api,root,async()=>{
 const target=await intentDirectory(destination,{schema:SCHEMA,command:'export',workspaceId:result.workspaceId,
  setId:result.setId,bindingUpload:result.bindingUpload,packet:result.binding.packet});
 const exported=await withRuntime(api,result.workspace,result.workspaceId,async model=>{
  const value=await verifiedBinding(model,result,api,signal);
  const filename=value.binding.inputUpload.encoding==='gzip'?'original-source.json.gz':'original-source.json';
  await publish(path.join(target,filename),value.inputRaw);await publish(path.join(target,'association.json'),value.bindingRaw);
  const outputArchive=path.join(target,'companion-source-set.zip');
  if(!await exists(outputArchive))await api.exportApplicationInputSetArchive(model,{setId:result.setId,output:outputArchive});
  const opened=await api.inspectApplicationInputSetArchiveFile({archive:outputArchive});
  need(opened.setId===result.setId&&opened.originWorkspaceId===result.workspaceId&&equal(opened.manifest,value.binding.manifest),
   'Independent Companion archive differs from the complete original set.');
  const archiveRaw=await io.readOriginal(outputArchive,128*1024*1024);
  return{schema:SCHEMA,state:'EXPORTED',originWorkspaceId:result.workspaceId,setId:result.setId,
   packet:{file:filename,...id(value.inputRaw)},association:{file:'association.json',...id(value.bindingRaw)},
   companionArchive:{file:'companion-source-set.zip',...id(archiveRaw)},applicationExecution:false};
 });
 await publish(path.join(target,'complete.json'),json(exported));return{...exported,directory:target};
 });
}
const HELP='Verified application source -> existing Runtime Companion\n\n'+
 'receive --input PACKET --sha256 SHA --directory PRIVATE_RECEIVING --runtime-source TRUSTED_RUNTIME_WORKSPACE_SOURCE --workspace EXISTING_WORKSPACE --workspace-id UUID --name SET_NAME --python ABSOLUTE_PYTHON [--node ABSOLUTE_NODE]\n'+
 'review --directory SAME_RECEIVING --runtime-source SAME_TRUSTED_SOURCE --workspace SAME_WORKSPACE --workspace-id SAME_UUID\n'+
 'prepare --directory SAME_RECEIVING --runtime-source SAME_TRUSTED_SOURCE --workspace SAME_WORKSPACE --workspace-id SAME_UUID --request-id ORIGINAL_UUID --kind APPLICATION_KIND --field PATH_SETTING [--member ORIGINAL_MEMBER]\n'+
 'export --directory SAME_RECEIVING --runtime-source SAME_TRUSTED_SOURCE --workspace SAME_WORKSPACE --workspace-id SAME_UUID --output INDEPENDENT_PRIVATE_DIRECTORY\n'+
 'The original packet must fit the existing 16 MiB Files limit. Source limits remain 1024 files / 64 MiB. No application is saved or started.\n';
function argumentsFor(argv){
 const command=argv.shift();if(!command||['help','--help'].includes(command))return{command:'help'};
 const allowed={receive:['input','sha256','directory','runtime-source','workspace','workspace-id','name','python','node'],
  review:['directory','runtime-source','workspace','workspace-id'],prepare:['directory','runtime-source','workspace','workspace-id','request-id','kind','field','member'],
  export:['directory','runtime-source','workspace','workspace-id','output']}[command];
 need(allowed,'Choose receive, review, prepare or export.');const values={command};
 while(argv.length){const flag=argv.shift(),key=flag?.slice(2);need(flag?.startsWith('--')&&allowed.includes(key)&&!Object.hasOwn(values,key),'Unknown or repeated option.');
  const value=argv.shift();need(value&&!value.startsWith('--'),'Supply the complete option value.');values[key]=value;}
 const required={receive:['input','sha256','directory','runtime-source','workspace','workspace-id','name','python'],
  review:['directory','runtime-source','workspace','workspace-id'],prepare:['directory','runtime-source','workspace','workspace-id','request-id','kind','field'],export:['directory','runtime-source','workspace','workspace-id','output']}[command];
 for(const key of required)need(values[key],'Missing --'+key);
 for(const [from,to] of Object.entries({'sha256':'expectedSha256','runtime-source':'runtimeSource','workspace-id':'workspaceId','request-id':'requestId','member':'memberPath'}))
  if(Object.hasOwn(values,from)){values[to]=values[from];delete values[from];}
 return values;
}
async function main(argv=process.argv.slice(2)){
 const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
 try{
  const args=argumentsFor([...argv]);if(args.command==='help'){process.stdout.write(HELP);return 0;}
  const result=await({receive,review,prepare,export:exportReceived}[args.command])({...args,signal:controller.signal});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');return 0;
 }catch(e){process.stderr.write(JSON.stringify({state:'ERROR',code:e.code??e.name,message:e.message,detail:e.detail},null,2)+'\n');return 1;}
 finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
module.exports={SCHEMA,decodeInput,manifestFor,argumentsFor,receive,review,prepare,exportReceived,main};
if(require.main===module)main().then(code=>{process.exitCode=code;});
