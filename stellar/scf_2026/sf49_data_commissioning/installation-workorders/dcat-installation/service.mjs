// SPDX-License-Identifier: MIT
/** Complete retained catalogue commissioning; native Operations remains the case writer. */
import {open,mkdir,lstat,realpath,readdir,link,unlink} from 'node:fs/promises';
import {constants,createReadStream} from 'node:fs';
import {resolve,join,dirname,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {regular,operationLease} from '../../../../scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import {readProfile} from '../profiles.mjs';
import {dcatInstallationTemplate,prepareDcatInstallation} from '../dcat-installation-core.mjs';
import {inspectDcatInstallationArchive,dcatInstallationMember} from '../dcat-installation-source.mjs';

const escaped=value=>String(value??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
function renderDcatInstallationSource(source,selection=null){return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Complete catalogue source</title><style>body{font:16px system-ui;max-width:1000px;margin:2rem auto;padding:1rem;color:#181818;background:#fff}pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #bbb;padding:1rem}</style><h1>Complete catalogue source</h1><p>This document carries the complete inspected source record and selected commissioning scope. Retain the accompanying original .ckanw archive for every original file and editable receiving.</p>'+(selection?'<h2>Selected work</h2><pre>'+escaped(JSON.stringify(selection,null,2))+'</pre>':'')+'<h2>Whole original source</h2><pre>'+escaped(JSON.stringify(source,null,2))+'</pre></html>';}
const SCHEMA='stellar-forge.dcat-installation-preparation-service.v1';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const KINDS=new Set(['archive','case','seed','bindings','selection','report','installation','preview','workorder','preparation','profile']);
const MAX_ARCHIVE=128*1024*1024,MAX_JSON=8*1024*1024,MAX_REPORT=128*1024*1024;
const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
const encode=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const canonical=v=>JSON.stringify(ordered(v));
const hash=v=>createHash('sha256').update(v).digest('hex');
const need=(ok,message,status=400)=>{if(!ok)throw Object.assign(new Error(message),{code:'DCAT_INSTALLATION_INPUT',status});};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const parse=raw=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
const id=value=>{need(typeof value==='string'&&HASH.test(value),'Use the complete retained file identity.');return value;};
const requestId=value=>{need(typeof value==='string'&&UUID.test(value),'Retain the original request UUID.');return value;};
const filename=value=>{need(typeof value==='string'&&value.length>0&&value.length<=180&&!/[/\\\u0000-\u001f\u007f]/.test(value)&&value!=='.'&&value!=='..','Use an ordinary complete filename.');return value;};
const maximum=kind=>kind==='archive'?MAX_ARCHIVE:['report','preparation'].includes(kind)?MAX_REPORT:MAX_JSON;
async function privateDirectory(path){
 await mkdir(path,{recursive:true,mode:0o700});
 const info=await lstat(path);
 need(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077)&&await realpath(path)===path&&(process.getuid===undefined||info.uid===process.getuid()),'Use an owned private directory without symbolic-link ancestors.');
 return path;
}
async function optional(path,limit=MAX_REPORT){try{return await regular(path,limit);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function exactWrite(path,raw){
 const prior=await optional(path,Math.max(raw.length,MAX_REPORT));
 if(prior){need(prior.equals(raw),'Preserve the differing retained file: '+basename(path),409);return;}
 const temporary=path+'.pending-'+randomUUID();let file;
 try{
  file=await open(temporary,'wx',0o600);await file.writeFile(raw);await file.sync();await file.close();file=null;
  try{await link(temporary,path);}catch(e){if(e.code!=='EEXIST')throw e;need((await regular(path,Math.max(raw.length,MAX_REPORT))).equals(raw),'The concurrently retained file differs.',409);}
 }finally{
  if(file)await file.close();
  try{await unlink(temporary);}catch(e){if(e.code!=='ENOENT')throw e;}
  const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
 }
}
async function fullIdentity(path,limit){
 const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=await handle.stat();need(before.isFile()&&before.size<=limit,'The complete selected file exceeds this receiving capacity.');
  const digest=createHash('sha256');let bytes=0;
  for await(const raw of handle.createReadStream({autoClose:false})){bytes+=raw.length;need(bytes<=limit,'The complete file grew beyond receiving capacity.');digest.update(raw);}
  const after=await handle.stat();
  need(before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs&&bytes===after.size,'The original selected file changed during reading.',409);
  return{bytes,sha256:digest.digest('hex')};
 }finally{await handle.close();}
}
export async function createDcatInstallationService({directory}={}){
 need(typeof directory==='string'&&directory===resolve(directory),'Choose an absolute preparation directory.');
 // Preparation source copies must not be recursively included in a source workspace.
 for(let parent=directory;;parent=dirname(parent)){
  for(const marker of ['workbench.json','workspace.json']){
   const raw=await optional(join(parent,marker),MAX_REPORT);
   if(raw){let value;try{value=parse(raw);}catch{continue;}
    need(!String(value.schema??'').includes('ckan')&&!String(value.schema??'').includes('runtime-workspace'),'Select a preparation directory outside the original catalogue and runtime workspaces.');
   }
  }
  if(dirname(parent)===parent)break;
 }
 const root=await privateDirectory(directory);
 for(const name of ['blobs','files','requests'])await privateDirectory(join(root,name));
 await exactWrite(join(root,'service.json'),encode({schema:SCHEMA}));
 let closing=false,active=Promise.resolve();const accepted=new Set();
 const transaction=async(request,work)=>{
  requestId(request.requestId);
  let finish;const current=new Promise(r=>{finish=r;});const previous=active;active=current;
  await previous;
  let lease;
  try{
   lease=await operationLease(join(root,'dcat-installation.lock'));
   const folder=await privateDirectory(join(root,'requests',request.requestId));
   await exactWrite(join(folder,'request.json'),encode(request));
   const existing=await optional(join(folder,'result.json'));
   if(existing){const result=parse(existing);await validateResult(request,result);return result;}
   if(!work)return null;
   const result=await work(folder);
   need(result.requestId===request.requestId&&result.type===request.type&&Array.isArray(result.files),'The preparation result lost its original request.');
   await exactWrite(join(folder,'result.json'),encode(result));return result;
  }finally{try{if(lease)await lease.close();}finally{finish();}}
 };
 async function descriptor(fileId){
  const row=parse(await regular(join(root,'files',id(fileId)+'.json'),MAX_JSON));
  const {fileId:ignored,...body}=row;
  need(row.fileId===fileId&&hash(canonical(body))===fileId&&body.schema===SCHEMA+'.file'&&KINDS.has(body.kind)&&HASH.test(body.sha256)&&Number.isSafeInteger(body.bytes)&&body.bytes>=0&&body.bytes<=maximum(body.kind),'The retained file descriptor changed.');
  filename(row.name);return row;
 }
 async function file(fileId){
  const row=await descriptor(fileId),path=join(root,'blobs',row.sha256);
  need(canonical(await fullIdentity(path,maximum(row.kind)))===canonical({bytes:row.bytes,sha256:row.sha256}),'The complete retained source changed.',409);
  return{path,descriptor:row};
 }
 async function retainFile(kind,name,raw){
  need(KINDS.has(kind),'Choose a supported complete source kind.');filename(name);
  need(Buffer.isBuffer(raw)&&raw.length<=maximum(kind),'The complete source exceeds its selected kind capacity.');
  const body={schema:SCHEMA+'.file',kind,name,bytes:raw.length,sha256:hash(raw)};
  const row={...body,fileId:hash(canonical(body))};
  await exactWrite(join(root,'blobs',row.sha256),raw);
  await exactWrite(join(root,'files',row.fileId+'.json'),encode(row));return row;
 }
 async function selected(fileId,kind){
  const value=await file(fileId);need(value.descriptor.kind===kind,'Select the original '+kind+' file.');return value;
 }
 async function jsonInput(fileId,kind){const value=await selected(fileId,kind);return{...value,raw:await regular(value.path,maximum(kind))};}
 async function validateResult(request,result){
  need(plain(result)&&result.schema===SCHEMA+'.result'&&result.requestId===request.requestId&&result.type===request.type&&Array.isArray(result.files),'The retained preparation result differs.');
  for(const row of result.files)need(canonical((await file(row.fileId)).descriptor)===canonical(row),'The complete result attachment differs.');
  for(const key of ['archiveId','caseId','seedId','bindingsId','selectionId'])if(request[key])await file(request[key]);
 }
 async function get(value){
  const folder=join(root,'requests',requestId(value)),request=parse(await regular(join(folder,'request.json'),MAX_JSON));
  const raw=await optional(join(folder,'result.json'));
  if(!raw)return{schema:SCHEMA+'.pending',requestId:value,request,type:request.type,status:'PENDING'};
  const result=parse(raw);await validateResult(request,result);return{...result,request,status:'COMPLETE'};
 }
 async function importStream({requestId:uuid,kind,name,bytes,sha256,stream}){
  requestId(uuid);
  need(['archive','case','seed','bindings','selection'].includes(kind),'Select an original input kind.');
  filename(name);need(Number.isSafeInteger(bytes)&&bytes>=0&&bytes<=maximum(kind)&&HASH.test(sha256??''),'Select the complete file size and SHA-256.');
  // Consume every offered body, including retries, before adopting the retained request.
  const request={schema:SCHEMA+'.request',type:'import',requestId:requestId(uuid),kind,name,bytes,sha256};
  await transaction(request,null);
  const temporary=join(root,'blobs','.upload-'+randomUUID());let handle,seen=0;const digest=createHash('sha256');
  try{
   handle=await open(temporary,'wx',0o600);
   for await(const raw of stream){seen+=raw.length;need(seen<=bytes,'The complete uploaded file exceeds its selected length.');digest.update(raw);await handle.writeFile(raw);}
   need(seen===bytes&&digest.digest('hex')===sha256,'The complete uploaded file differs from its selected identity.');
   await handle.sync();await handle.close();handle=null;
   return await transaction(request,async()=>{
    const target=join(root,'blobs',sha256);
    try{await link(temporary,target);}catch(e){if(e.code!=='EEXIST')throw e;}
    const blobParent=await open(join(root,'blobs'),'r');try{await blobParent.sync();}finally{await blobParent.close();}
    need(canonical(await fullIdentity(target,maximum(kind)))===canonical({bytes,sha256}),'The retained full input differs.');
    const body={schema:SCHEMA+'.file',kind,name,bytes,sha256},row={...body,fileId:hash(canonical(body))};
    await exactWrite(join(root,'files',row.fileId+'.json'),encode(row));
    return{schema:SCHEMA+'.result',type:'import',requestId:uuid,file:row,files:[row]};
   });
  }finally{if(handle)await handle.close();try{await unlink(temporary);}catch(e){if(e.code!=='ENOENT')throw e;}}
 }
 async function importFile({requestId:uuid,path,kind,expectedSha256}){
  need(typeof path==='string'&&path===resolve(path),'Select an absolute original source file.');need(KINDS.has(kind),'Select a supported input kind.');
  const identity=await fullIdentity(path,maximum(kind));
  need(expectedSha256===undefined||expectedSha256===identity.sha256,'The selected original input digest differs.');
  return importStream({requestId:uuid,kind,name:basename(path),...identity,stream:createReadStream(path,{flags:constants.O_RDONLY|constants.O_NOFOLLOW})});
 }
 const result=(type,uuid,files,values={})=>({schema:SCHEMA+'.result',type,requestId:uuid,...values,files});
 async function inspection(value){
  const folder=join(root,'requests',requestId(value));
  const request=parse(await regular(join(folder,'request.json'),MAX_JSON)),row=parse(await regular(join(folder,'result.json'),MAX_REPORT));
  need(request.type==='inspect'&&request.requestId===value&&row.schema===SCHEMA+'.result'&&row.type==='inspect'&&row.requestId===value&&row.archiveId===request.archiveId&&Array.isArray(row.files),'Select a complete original archive inspection.');
  const report=row.files.find(f=>f.name==='Dcat_Complete_Source_Report.json');need(report,'The inspection source report is missing.');
  const reportFile=await file(report.fileId);need(canonical(reportFile.descriptor)===canonical(report),'The source-report identity differs.');
  const source=parse(await regular(reportFile.path,MAX_REPORT)),archive=await descriptor(row.archiveId);
  need(archive.kind==='archive'&&source.archive?.bytes===archive.bytes&&source.archive?.sha256===archive.sha256,'The source report and complete archive selection differ.');
  // Original members are checked individually on download. Rehashing the entire
  // compressed archive for every member would multiply large-transfer work.
  return{row:{...row,source},source};
 }
 async function inspect({requestId:uuid,archiveId}){
  const request={schema:SCHEMA+'.request',type:'inspect',requestId:requestId(uuid),archiveId:id(archiveId)};
  return transaction(request,async(folder)=>{
   const archive=await selected(archiveId,'archive');
   const source=await inspectDcatInstallationArchive({archivePath:archive.path,expectedArchiveSha256:archive.descriptor.sha256,directory:join(folder,'original-received-workspace')});
   const files=[archive.descriptor,await retainFile('report','Dcat_Complete_Source_Report.json',encode(source)),
    await retainFile('report','Dcat_Complete_Source_Report.html',Buffer.from(renderDcatInstallationSource(source)))];
   return result('inspect',uuid,files,{archiveId,source});
  });
 }
 async function profileForRequest(uuid){
  const priorRaw=await optional(join(root,'requests',requestId(uuid),'request.json'),MAX_JSON);
  const prior=priorRaw?parse(priorRaw):null;
  if(prior?.profile){
   const retained=await selected(prior.profile.fileId,'profile');
   need(retained.descriptor.bytes===prior.profile.source.bytes&&retained.descriptor.sha256===prior.profile.source.sha256,'The original selected profile identity differs.');
   return{value:parse(await regular(retained.path,MAX_JSON)),source:prior.profile.source,descriptor:retained.descriptor};
  }
  const profile=readProfile('dcat-catalogues'),raw=await regular(profile.source.path,2*1024*1024);
  need(raw.length===profile.source.bytes&&hash(raw)===profile.source.sha256,'The installed original profile changed during selection.');
  return{value:parse(raw),source:profile.source,descriptor:await retainFile('profile','Original_Installation_Profile.json',raw)};
 }
 async function template({requestId:uuid,inspectionId,caseId,seedId}){
  const profile=await profileForRequest(uuid);
  const request={schema:SCHEMA+'.request',type:'template',requestId:requestId(uuid),inspectionId:requestId(inspectionId),caseId:id(caseId),seedId:id(seedId),profile:{fileId:profile.descriptor.fileId,source:profile.source}};
  return transaction(request,async()=>{
   const inspected=await inspection(inspectionId),caseInput=await jsonInput(caseId,'case'),seed=await jsonInput(seedId,'seed');
   const value=dcatInstallationTemplate({source:inspected.source,seed:parse(seed.raw),caseValue:parse(caseInput.raw),profile:profile.value});
   const files=[caseInput.descriptor,seed.descriptor,
    profile.descriptor,
    await retainFile('selection','Selected_Dcat_Scope.json',encode(value.selection)),
    await retainFile('bindings','bindings.json',encode(value.bindings))];
   return result('template',uuid,files,{inspectionId,caseId,seedId,bindings:value.bindings,selection:value.selection,profile:profile.source});
  });
 }
 async function prepare({requestId:uuid,inspectionId,caseId,seedId,bindingsId,selectionId,selectionSourceId}){
  need(typeof selectionSourceId==='string'&&selectionSourceId.length>0&&selectionSourceId.length<=200,'Select the scope file’s actual source ID in the original case.');
  const profile=await profileForRequest(uuid);
  const request={schema:SCHEMA+'.request',type:'prepare',requestId:requestId(uuid),inspectionId:requestId(inspectionId),
   caseId:id(caseId),seedId:id(seedId),bindingsId:id(bindingsId),selectionId:id(selectionId),selectionSourceId,profile:{fileId:profile.descriptor.fileId,source:profile.source}};
  return transaction(request,async()=>{
   const inspected=await inspection(inspectionId),inputs={};
   for(const [key,kind]of [['caseId','case'],['seedId','seed'],['bindingsId','bindings'],['selectionId','selection']])inputs[kind]=await jsonInput(request[key],kind);
   const value=prepareDcatInstallation({source:inspected.source,seed:parse(inputs.seed.raw),caseValue:parse(inputs.case.raw),profile:profile.value,
    bindings:parse(inputs.bindings.raw),selectionRaw:inputs.selection.raw,selectionSourceId});
   const document=encode(value.prepared.document);need(document.length<=128*1024,'The complete Installation exceeds its original 128 KiB capacity.');
   const archive=await selected(inspected.row.archiveId,'archive');
   const files=[archive.descriptor,...Object.values(inputs).map(x=>x.descriptor),
    await retainFile('profile','Original_Installation_Profile.json',encode(profile.value)),
    await retainFile('installation','installation-input.json',document),
    await retainFile('preview','installation-preview-input.json',encode(value.prepared.preview)),
    await retainFile('workorder','WORKORDER.md',Buffer.from(value.workorder)),
    await retainFile('report','Dcat_Installation_Scope.json',encode(value.snapshot)),
    await retainFile('report','Dcat_Complete_Source_Report.json',encode(inspected.source)),
    await retainFile('report','Dcat_Complete_Source_Report.html',Buffer.from(renderDcatInstallationSource(inspected.source,parse(inputs.selection.raw)))),
    await retainFile('preparation','preparation.json',encode({...value.prepared,bindings:value.bindings}))];
   return result('prepare',uuid,files,{inspectionId,archiveId:inspected.row.archiveId,source:value.prepared.source,workshareCaseId:value.prepared.workshareCaseId,
    selections:value.prepared.selections,installation:value.prepared.document,scope:value.snapshot});
  });
 }
 async function list({offset=0,limit=100}={}){
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=200,'Select a valid request page.');
  const ids=(await readdir(join(root,'requests'))).filter(x=>UUID.test(x)).sort();
  const rows=[];
  for(const uuid of ids.slice(offset,offset+limit)){
   const path=join(root,'requests',uuid),requestRaw=await optional(join(path,'request.json'),MAX_JSON);if(!requestRaw)continue;
   const request=parse(requestRaw),raw=await optional(join(path,'result.json'));
   const value=raw?parse(raw):null;
   rows.push({requestId:uuid,type:request.type,status:raw?'COMPLETE':'PENDING',request,files:value?.files??[]});
  }
  return{schema:SCHEMA+'.list',offset,limit,total:ids.length,nextOffset:offset+limit<ids.length?offset+limit:null,rows};
 }
 async function sourceFile({inspectionId,path}){
  const inspected=await inspection(inspectionId);
  return dcatInstallationMember({directory:join(root,'requests',requestId(inspectionId),'original-received-workspace'),source:inspected.source,path});
 }
 const owned=fn=>(...args)=>{
  need(!closing,'This preparation service is closing.',409);
  const promise=Promise.resolve().then(()=>fn(...args));accepted.add(promise);
  promise.then(()=>accepted.delete(promise),()=>accepted.delete(promise));return promise;
 };
 let stopped;
 return Object.freeze({directory:root,...Object.fromEntries(Object.entries({importFile,importStream,inspect,template,prepare,get,file,list,sourceFile}).map(([key,fn])=>[key,owned(fn)])),
  close(){closing=true;return stopped??=Promise.allSettled([...accepted]).then(()=>active);}});
}
