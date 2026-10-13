// MIT. Existing customer PDFs on the original assembly plan, paid batch and customer lifetime.
import {join,relative,isAbsolute,sep,basename} from 'node:path';
import {readdir,lstat,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {absolute,ownedDirectory,ownedBytes,writeExact,encoded,parse,canonical,plain}
  from '../../stellar/scf-starforge-20261009/sf101-merchant-receiver/api-application/workspace/configuration.mjs';
import {verifyFile} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/resource-library/files.mjs';
import {documentError} from './contracts.mjs';
import {prepareDocumentPdfAssembly,receiveDocumentPdfAssembly,readDocumentPdfAssembly,
  inspectDocumentPdfAssembly,prepareDocumentPdfAssemblyBatch,runDocumentPdfAssembly,
  documentPdfAssemblyOutput,exportDocumentPdfAssembly} from './assembly.mjs';

export const DOCUMENT_ASSEMBLY_WORKSPACE_SCHEMA='stellar-forge.document-assembly-workspace.v1';
const MiB=1048576,UPLOAD_LIMIT=28*MiB,PLAN_LIMIT=192*MiB;
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,HASH=/^[a-f0-9]{64}$/,EDITION=/^[a-f0-9]{32}$/;
const digest=value=>createHash('sha256').update(value).digest('hex'),copy=value=>structuredClone(value);
function need(value,code,status=400){if(!value)throw Object.assign(documentError(code),{status});}
function id(value){need(typeof value==='string'&&ID.test(value),'DOCUMENT_ASSEMBLY_ID_REQUIRED');return value;}
function hash(value){need(HASH.test(value??''),'DOCUMENT_ASSEMBLY_SOURCE_SELECTION_REQUIRED');return value;}
function inside(path,root){const part=relative(root,path);return part!==''&&part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part);}
function errorView(error){return {code:/^[A-Z][A-Z0-9_]{1,99}$/.test(error?.code??'')?error.code:'DOCUMENT_ASSEMBLY_OPERATION_FAILED',
  message:typeof error?.message==='string'?error.message.slice(0,1200):'Continue the original document operation.'};}
function upload(value,maximum){
  need(plain(value)&&typeof value.name==='string'&&value.name.length>0&&value.name.length<=255&&
    !/[\x00-\x1f\x7f/\\]/.test(value.name)&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&value.bytes<=maximum&&
    HASH.test(value.sha256??'')&&typeof value.base64==='string'&&value.base64.length<=Math.ceil(maximum/3)*4,
    'DOCUMENT_ASSEMBLY_UPLOAD_REQUIRED');
  const raw=Buffer.from(value.base64,'base64');
  need(raw.length===value.bytes&&raw.toString('base64')===value.base64&&digest(raw)===value.sha256,
    'DOCUMENT_ASSEMBLY_UPLOAD_CHANGED');return raw;
}
function operationView(value){return {id:value.id,assemblyId:value.assemblyId,kind:value.kind,state:value.state,
  startedAt:value.startedAt,endedAt:value.endedAt,progress:copy(value.progress),result:copy(value.result),error:copy(value.error)};}
function summary(source){return {id:source.plan.request.id,name:source.plan.request.name,directory:source.directory,
  sourceSha256:source.sha256,sourceBytes:source.bytes,request:copy(source.plan.request),counts:copy(source.plan.counts)};}

/** The original assembly and batch files own durable state; this controller owns only admitted HTTP work. */
export async function openDocumentAssemblyWorkspace({workspace,sourceRoot,intakeAccessToken=null,
  merchantOrigin=null,deadlineMs=300000,pollMs=1500}={}){
  need(workspace&&typeof workspace.status==='function'&&typeof workspace.library?.download==='function',
    'DOCUMENT_ASSEMBLY_CUSTOMER_REQUIRED');
  const directory=absolute(workspace.directory),roots=workspace.status().fileRoots;
  sourceRoot=absolute(sourceRoot??join(directory,'artifacts','document-compositions','.pdf-bundles'));
  need(Array.isArray(roots)&&roots.some(root=>inside(sourceRoot,root)),'DOCUMENT_ASSEMBLY_SOURCE_OUTSIDE_CUSTOMER_ROOT');
  need(Number.isSafeInteger(deadlineMs)&&deadlineMs>=1000&&deadlineMs<=3600000&&
    Number.isSafeInteger(pollMs)&&pollMs>=250&&pollMs<=30000,'DOCUMENT_ASSEMBLY_WAIT_OPTIONS_INVALID');
  need(intakeAccessToken===null||typeof intakeAccessToken==='string'&&intakeAccessToken.length>0&&
    intakeAccessToken.length<=16384,'DOCUMENT_ASSEMBLY_INTAKE_KEY_INVALID');
  if(merchantOrigin!==null){let url;try{url=new URL(merchantOrigin);}catch{need(false,'DOCUMENT_ASSEMBLY_ORIGIN_REQUIRED');}
    need(url.protocol==='https:'&&url.origin===merchantOrigin&&!url.username&&!url.password,'DOCUMENT_ASSEMBLY_ORIGIN_REQUIRED');}
  await ownedDirectory(sourceRoot,{create:true});
  const active=new Map(),operations=new Map(),summaries=new Map();let closing=false,closePromise;
  const directoryFor=value=>join(sourceRoot,id(value));
  function status(){return {schema:DOCUMENT_ASSEMBLY_WORKSPACE_SCHEMA,workspaceDirectory:directory,sourceRoot,
    merchantOrigin,uploadLimit:UPLOAD_LIMIT,sourcePlanLimit:PLAN_LIMIT,closing,
    active:[...active.values()].map(operationView)};}
  async function source(input,{requireFiles=true,signal}={}){
    const value=await readDocumentPdfAssembly(directoryFor(input.id),{
      ...(input.sourceSha256===undefined?{}:{expectedSha256:hash(input.sourceSha256)}),requireFiles,signal});
    need(value.plan.request.id===input.id,'DOCUMENT_ASSEMBLY_DIRECTORY_ID_CHANGED');return value;
  }
  async function selectedSummary(value){
    const info=await lstat(join(directoryFor(value),'assembly-plan.json'));
    const clock=[info.dev,info.ino,info.size,info.mtimeMs,info.ctimeMs].join(':');
    const saved=summaries.get(value);if(saved?.clock===clock)return copy(saved.value);
    const next=summary(await source({id:value},{requireFiles:false}));summaries.set(value,{clock,value:next});
    if(summaries.size>256)summaries.delete(summaries.keys().next().value);return next;
  }
  async function list({offset=0,limit=20}={}){
    need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100,
      'DOCUMENT_ASSEMBLY_PAGE_INVALID');
    const entries=(await readdir(sourceRoot,{withFileTypes:true})).filter(row=>row.isDirectory()&&
      !row.isSymbolicLink()&&ID.test(row.name)).map(row=>row.name).sort();
    const items=[];
    for(const value of entries.slice(offset,offset+limit)){
      try{items.push({...await selectedSummary(value),active:active.has(value)?operationView(active.get(value)):null});}
      catch(error){items.push({id:value,state:error.code==='ENOENT'?'SOURCE_REQUIRED':'SOURCE_UNAVAILABLE',
        error:errorView(error),active:active.has(value)?operationView(active.get(value)):null});}
    }
    return {total:entries.length,offset,limit,items};
  }
  async function exportRecord(selected,exportId){
    need(EDITION.test(exportId??''),'DOCUMENT_ASSEMBLY_EXPORT_REQUIRED');
    const root=join(selected.directory,'exports',exportId);
    const deliveryBytes=await ownedBytes(join(root,'assembly-delivery.json'),4*MiB),delivery=parse(deliveryBytes);
    const receipt=parse(await ownedBytes(join(root,'assembly-archive.json'),65536));
    need(delivery.id===selected.plan.request.id&&delivery.directory===root&&delivery.source.sha256===selected.sha256&&
      receipt.sourceSha256===selected.sha256&&receipt.deliverySha256===digest(deliveryBytes)&&receipt.archive?.path===join(root,'complete-pdf-bundle.tar'),
      'DOCUMENT_ASSEMBLY_EXPORT_CHANGED');
    return {root,delivery,receipt};
  }
  async function get({id:assemblyId,sourceSha256,signal}={}){
    const selected=await source({id:assemblyId,sourceSha256},{requireFiles:false,signal});
    let value;
    try{value=await inspectDocumentPdfAssembly({workspace,directory:selected.directory,expectedSha256:selected.sha256,signal});}
    catch(error){
      if(error.code!=='ENOENT')throw error;
      return {...summary(selected),origin:copy(selected.plan.origin),sourceState:'CONTINUATION_REQUIRED',
        originalFiles:selected.plan.files.map(({base64,...file})=>copy(file)),complete:false,native:null,exports:[],
        volumes:selected.plan.volumes.map(volume=>({...copy(volume),state:'SOURCE_REQUIRED',received:false,native:null})),
        active:active.has(assemblyId)?operationView(active.get(assemblyId)):null};
    }
    let entries=[];try{entries=await readdir(join(selected.directory,'exports'),{withFileTypes:true});}
    catch(error){if(error.code!=='ENOENT')throw error;}
    const exports=[];
    for(const row of entries.filter(row=>row.isDirectory()&&!row.isSymbolicLink()&&EDITION.test(row.name)).sort((a,b)=>a.name.localeCompare(b.name))){
      signal?.throwIfAborted();
      try{const {delivery,receipt}=await exportRecord(selected,row.name);
        exports.push({id:row.name,complete:true,counts:delivery.counts,files:delivery.files,native:delivery.native,archive:receipt.archive});}
      catch(error){exports.push({id:row.name,complete:false,error:errorView(error)});}
    }
    return {...value,sourceState:'COMPLETE',exports,active:active.has(assemblyId)?operationView(active.get(assemblyId)):null};
  }
  async function execute(kind,input,signal,onProgress){
    if(kind==='stage'){
      need(plain(input.request)&&input.request.id===input.id&&Array.isArray(input.files)&&
        input.files.length>0&&input.files.length<=2000,'DOCUMENT_ASSEMBLY_SOURCES_REQUIRED');
      let total=0;const sources=[];
      for(const file of input.files){
        signal.throwIfAborted();const raw=upload(file,UPLOAD_LIMIT);total+=raw.length;
        need(total<=UPLOAD_LIMIT,'DOCUMENT_ASSEMBLY_BROWSER_SOURCE_LIMIT');
        sources.push({id:id(file.id),filename:file.name,bytes:raw.length,sha256:file.sha256,base64:file.base64});
      }
      const result=await prepareDocumentPdfAssembly({directory:directoryFor(input.id),request:input.request,sources,signal});
      return summary(result);
    }
    if(kind==='restore'){
      need((input.source!==undefined)!==(input.sourceFile!==undefined),'DOCUMENT_ASSEMBLY_RESTORE_SOURCE_REQUIRED');
      let path,temporary=null;
      try{
        let raw;
        if(input.source!==undefined){raw=upload(input.source,UPLOAD_LIMIT);
          temporary=join(sourceRoot,'.assembly-receiving-'+randomUUID()+'.json');path=temporary;}
        else{path=absolute(input.sourceFile);need(roots.some(root=>inside(path,root)),'DOCUMENT_ASSEMBLY_SOURCE_OUTSIDE_CUSTOMER_ROOT');
          raw=await ownedBytes(path,PLAN_LIMIT,{privateMode:false});}
        need(digest(raw)===input.sourceSha256&&parse(raw).request?.id===input.id,'DOCUMENT_ASSEMBLY_SOURCE_SELECTION_CHANGED');
        if(temporary)await writeExact(temporary,raw);signal.throwIfAborted();
        return summary(await receiveDocumentPdfAssembly({source:path,directory:directoryFor(input.id),
          expectedSha256:input.sourceSha256,signal}));
      }finally{if(temporary)await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
    }
    if(kind==='materialize'){
      const selected=await source(input,{requireFiles:false,signal});
      return summary(await prepareDocumentPdfAssembly({directory:selected.directory,request:selected.plan.request,
        sources:selected.plan.files,origin:selected.plan.origin,signal}));
    }
    const selected=await source(input,{signal}),options={workspace,directory:selected.directory,expectedSha256:selected.sha256,signal};
    if(kind==='prepare'){
      const result=await prepareDocumentPdfAssemblyBatch({...options,intakeAccessToken,onProgress});
      return {...summary(selected),planSha256:result.batch?.sha256??null,totals:copy(result.totals)};
    }
    if(kind==='run'||kind==='receive'){
      const result=await runDocumentPdfAssembly({...options,approvedPlanSha256:input.planSha256,receiveOnly:kind==='receive',
        intakeAccessToken,deadlineMs,pollMs,onProgress});
      return {id:result.id,sourceSha256:result.sourceSha256,complete:result.complete,counts:copy(result.counts),
        receivedVolumes:result.volumes.filter(row=>row.received).length,volumes:result.volumes.length};
    }
    if(kind==='export'){
      const exportId=input.exportId??randomUUID().replaceAll('-','');
      need(EDITION.test(exportId),'DOCUMENT_ASSEMBLY_EXPORT_REQUIRED');
      const destination=join(selected.directory,'exports',exportId);
      await ownedDirectory(destination,{create:input.exportId===undefined});
      await onProgress({stage:'DOCUMENT_ASSEMBLY_EXPORT',exportId});
      const result=await exportDocumentPdfAssembly({...options,destination});
      return {id:input.id,sourceSha256:selected.sha256,exportId,counts:copy(result.counts),complete:true};
    }
    need(false,'DOCUMENT_ASSEMBLY_ACTION_INVALID');
  }
  function start(kind,input={}){
    need(!closing,'DOCUMENT_ASSEMBLY_WORKSPACE_CLOSING',409);
    need(['stage','restore','materialize','prepare','run','receive','export'].includes(kind)&&plain(input),'DOCUMENT_ASSEMBLY_ACTION_INVALID');
    const assemblyId=id(input.id);if(kind!=='stage')hash(input.sourceSha256);
    if(kind==='run')hash(input.planSha256);
    if(kind==='export'&&input.exportId!==undefined)need(EDITION.test(input.exportId),'DOCUMENT_ASSEMBLY_EXPORT_REQUIRED');
    need(!active.has(assemblyId),'DOCUMENT_ASSEMBLY_OPERATION_ACTIVE',409);
    need(active.size<4,'DOCUMENT_ASSEMBLY_OPERATION_CAPACITY',429);
    const operation={id:randomUUID(),assemblyId,kind,state:'RUNNING',startedAt:new Date().toISOString(),endedAt:null,
      progress:null,result:null,error:null,controller:new AbortController(),promise:null};
    active.set(assemblyId,operation);operations.set(operation.id,operation);
    for(const [key,old]of operations)if(operations.size>128&&old.state!=='RUNNING')operations.delete(key);
    operation.promise=new Promise(resolve=>setImmediate(resolve)).then(()=>execute(kind,input,operation.controller.signal,
      async value=>{operation.progress=copy(value);})).then(result=>{
        operation.result=result;operation.state=(kind==='run'||kind==='receive')&&!result.complete?'CONTINUATION_REQUIRED':'COMPLETE';
      },error=>{operation.error=errorView(error);operation.state=operation.controller.signal.aborted?'STOPPED':'FAILED';})
      .finally(()=>{operation.endedAt=new Date().toISOString();active.delete(assemblyId);summaries.delete(assemblyId);});
    return operationView(operation);
  }
  function operation({operationId}={}){
    need(operations.has(operationId),'DOCUMENT_ASSEMBLY_OPERATION_NOT_FOUND',404);return operationView(operations.get(operationId));
  }
  async function cancel({operationId}={}){
    const value=operations.get(operationId);need(value,'DOCUMENT_ASSEMBLY_OPERATION_NOT_FOUND',404);
    if(value.state==='RUNNING')value.controller.abort(documentError('DOCUMENT_ASSEMBLY_STOPPED'));
    return operationView(value);
  }
  async function download(input,{signal}={}){
    need(plain(input),'DOCUMENT_ASSEMBLY_DOWNLOAD_REQUIRED');hash(input.sourceSha256);
    const selected=await source(input,{requireFiles:input.kind!=='source',signal});let file;
    if(input.kind==='source')file={path:join(selected.directory,'assembly-plan.json'),bytes:selected.bytes,
      sha256:selected.sha256,name:'assembly-plan.json'};
    else if(input.kind==='original'){
      const original=selected.plan.files.find(file=>file.id===input.fileId);
      need(original,'DOCUMENT_ASSEMBLY_SOURCE_FILE_NOT_FOUND',404);
      file={path:join(selected.directory,'originals',original.id+'.pdf'),bytes:original.bytes,sha256:original.sha256,name:original.filename};
    }else if(input.kind==='pdf'){
      const output=await documentPdfAssemblyOutput({workspace,directory:selected.directory,expectedSha256:selected.sha256,
        volumeId:input.volumeId,signal});
      file={path:output.path,bytes:output.bytes,sha256:output.sha256,name:output.filename};
      if(output.resourceId){
        const resource=workspace.library.resource(output.resourceId);
        need(resource.bytes===file.bytes&&resource.sha256===file.sha256,'DOCUMENT_ASSEMBLY_PDF_RESOURCE_CHANGED');
        return workspace.library.download(output.resourceId,{signal});
      }
    }else if(input.kind==='export'){
      const {root,delivery,receipt}=await exportRecord(selected,input.exportId);
      if(input.file==='complete-pdf-bundle.tar')file={...receipt.archive,name:input.file};
      else if(input.file==='documents.tar'){
        need(delivery.native?.archive.path===join(root,'native','documents.tar'),'DOCUMENT_ASSEMBLY_NATIVE_EXPORT_REQUIRED');
        file={...delivery.native.archive,name:input.file};
      }else if(input.file==='assembly-delivery.json'){
        const raw=await ownedBytes(join(root,input.file),4*MiB);
        file={path:join(root,input.file),bytes:raw.length,sha256:digest(raw),name:input.file};
      }else{
        const row=delivery.files.find(value=>value.path===input.file);
        need(row,'DOCUMENT_ASSEMBLY_EXPORT_FILE_NOT_FOUND',404);
        file={path:join(root,row.path),bytes:row.bytes,sha256:row.sha256,name:basename(row.path)};
      }
    }else need(false,'DOCUMENT_ASSEMBLY_DOWNLOAD_REQUIRED');
    need(inside(absolute(file.path),selected.directory),'DOCUMENT_ASSEMBLY_FILE_OUTSIDE_SOURCE');
    const resource={id:digest(canonical([input.id,selected.sha256,file.path,file.sha256])),name:file.name,
      path:file.path,bytes:file.bytes,sha256:file.sha256,deliveryStatus:'SAVED'};
    const opened=await verifyFile(resource,{roots:[sourceRoot],maxFileBytes:file.bytes,indexBytes:0,tempRoot:sourceRoot,signal,spool:true});
    return {resource,...opened};
  }
  function close(){
    if(closePromise)return closePromise;closing=true;
    const pending=[...active.values()];
    for(const value of pending)value.controller.abort(documentError('DOCUMENT_ASSEMBLY_WORKSPACE_CLOSING'));
    closePromise=Promise.allSettled(pending.map(value=>value.promise)).then(()=>undefined);return closePromise;
  }
  return Object.freeze({workspace,sourceRoot,status,list,get,operation,start,cancel,download,close});
}
