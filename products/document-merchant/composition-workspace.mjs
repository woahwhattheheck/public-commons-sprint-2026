// MIT. Dataset composition on the original customer, paid batches and Resource library.
import {join,relative,isAbsolute,sep,basename} from 'node:path';
import {readdir,lstat,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {
  absolute,ownedDirectory,ownedBytes,writeExact,encoded,parse,canonical,plain
} from '../../stellar/scf-starforge-20261009/sf101-merchant-receiver/api-application/workspace/configuration.mjs';
import {verifyFile} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/resource-library/files.mjs';
import {documentProvider,documentError,defaultDocumentSettings} from './contracts.mjs';
import {documentCorrectionDraft,composeDocumentCorrection} from './corrections.mjs';
import {openDocumentAssemblyWorkspace} from './assembly-workspace.mjs';
import {
  composeDocumentSources,readDocumentComposition,
  receiveDocumentComposition,prepareDocumentCompositionBatch,
  readDocumentCompositionBatch,exportDocumentComposition
} from './composition.mjs';
import {
  inspectDocumentBatch,runDocumentBatch,receiveDocumentBatch,saveDocumentBatchReport
} from './batch.mjs';
import {
  documentAssemblyTemplate,stageDocumentPdfAssemblyFromBatch,prepareDocumentPdfAssemblyBatch,
  readDocumentPdfAssembly,inspectDocumentPdfAssembly,runDocumentPdfAssembly,
  exportDocumentPdfAssembly,documentPdfAssemblyOutput
} from './assembly.mjs';

export const DOCUMENT_COMPOSITION_WORKSPACE_SCHEMA='stellar-forge.document-composition-workspace.v1';
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,HASH=/^[a-f0-9]{64}$/;
const MiB=1048576,MAX_PLAN=192*MiB;
const digest=value=>createHash('sha256').update(value).digest('hex');
const copy=value=>structuredClone(value);
const now=()=>new Date().toISOString();
function need(value,code,message,status=400){
  if(!value)throw Object.assign(documentError(code,message??code),{status});
}
function identifier(value){
  need(typeof value==='string'&&ID.test(value),'DOCUMENT_COMPOSITION_ID_REQUIRED');return value;
}
function hash(value){
  need(typeof value==='string'&&HASH.test(value),'DOCUMENT_COMPOSITION_SOURCE_SELECTION_REQUIRED');return value;
}
function inside(path,root){
  const part=relative(root,path);return part!==''&&part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part);
}
function integer(value,min,max,code){
  need(Number.isSafeInteger(value)&&value>=min&&value<=max,code);return value;
}
function errorView(error){
  return {code:/^[A-Z][A-Z0-9_]{1,99}$/.test(error?.code??'')?error.code:'DOCUMENT_COMPOSITION_OPERATION_FAILED',
    message:typeof error?.message==='string'?error.message.slice(0,1200):'The original operation needs continuation.'};
}
function uploadedFile(value,maxBytes){
  need(plain(value)&&Object.keys(value).every(key=>['name','base64','bytes','sha256'].includes(key))&&
    typeof value.name==='string'&&value.name.length>0&&value.name.length<=255&&
    !/[\x00-\x1f\x7f/\\]/.test(value.name)&&
    Number.isSafeInteger(value.bytes)&&value.bytes>0&&value.bytes<=maxBytes&&
    typeof value.base64==='string'&&value.base64.length<=Math.ceil(maxBytes/3)*4&&
    HASH.test(value.sha256??''),'DOCUMENT_COMPOSITION_UPLOAD_REQUIRED');
  const raw=Buffer.from(value.base64,'base64');
  need(raw.toString('base64')===value.base64&&raw.length===value.bytes&&digest(raw)===value.sha256,
    'DOCUMENT_COMPOSITION_UPLOAD_CHANGED');
  try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);}
  catch{need(false,'DOCUMENT_COMPOSITION_UTF8_REQUIRED','Select the complete UTF-8 source file.');}
}
function sourceSummary(source){
  return {id:source.id,name:source.plan.request.name,provider:source.plan.request.provider,
    merchantOrigin:source.plan.request.merchantOrigin,directory:source.directory,
    sourceSha256:source.sha256,sourceBytes:source.bytes,counts:copy(source.counts)};
}
function operationView(operation){
  return {id:operation.id,compositionId:operation.compositionId,kind:operation.kind,state:operation.state,
    startedAt:operation.startedAt,endedAt:operation.endedAt,progress:copy(operation.progress),
    result:copy(operation.result),error:copy(operation.error)};
}
function defaultOrigin(value){
  if(value===null)return null;
  let selected;try{selected=new URL(value);}catch{need(false,'DOCUMENT_COMPOSITION_MERCHANT_REQUIRED');}
  need(selected.protocol==='https:'&&selected.origin===value&&!selected.username&&!selected.password,
    'DOCUMENT_COMPOSITION_MERCHANT_REQUIRED');return value;
}

/** Source plans and the original batch own durable state. This controller owns only its HTTP work. */
export async function openDocumentCompositionWorkspace({workspace,sourceRoot,provider='mintpdf',
  merchantOrigin=null,intakeAccessToken=null,deadlineMs=300000,pollMs=1500}={}){
  need(workspace&&typeof workspace.status==='function'&&typeof workspace.intake?.get==='function'&&
    typeof workspace.library?.download==='function','DOCUMENT_COMPOSITION_ORIGINAL_CUSTOMER_REQUIRED');
  const customerDirectory=absolute(workspace.directory);
  const service=documentProvider(provider);
  merchantOrigin=defaultOrigin(merchantOrigin);
  integer(deadlineMs,1000,3600000,'DOCUMENT_COMPOSITION_DEADLINE_INVALID');
  integer(pollMs,250,30000,'DOCUMENT_COMPOSITION_POLL_INVALID');
  need(intakeAccessToken===null||typeof intakeAccessToken==='string'&&intakeAccessToken.length>0&&
    intakeAccessToken.length<=16384,'DOCUMENT_COMPOSITION_INTAKE_KEY_INVALID');
  sourceRoot=absolute(sourceRoot??join(customerDirectory,'artifacts','document-compositions'));
  const roots=workspace.status().fileRoots;
  need(Array.isArray(roots)&&roots.some(root=>inside(sourceRoot,root)),
    'DOCUMENT_COMPOSITION_SOURCE_ROOT_NOT_DECLARED',
    'Keep document compositions inside an original customer file root.');
  await ownedDirectory(sourceRoot,{create:true});
  const bundles=await openDocumentAssemblyWorkspace({workspace,sourceRoot:join(sourceRoot,'.pdf-bundles'),
    intakeAccessToken,merchantOrigin:provider==='pdfmint'?merchantOrigin:null,deadlineMs,pollMs});
  const operations=new Map(),active=new Map(),summaries=new Map();
  let closing=false,closePromise;
  function directoryFor(id){return join(sourceRoot,identifier(id));}
  function status(){
    return {schema:DOCUMENT_COMPOSITION_WORKSPACE_SCHEMA,workspaceDirectory:customerDirectory,
      sourceRoot,defaults:{provider:service.id,merchantOrigin,formats:[...service.formats],settings:defaultDocumentSettings(service.id)},
      providers:['mintpdf','snaplab','pdfmint'].map(id=>({id,formats:[...documentProvider(id).formats],
        settings:defaultDocumentSettings(id)})),
      closing,active:[...active.values()].map(operationView)};
  }
  async function source(id,expectedSha256,signal){
    const value=await readDocumentComposition(directoryFor(id),{requireFiles:false,
      ...(expectedSha256===undefined?{}:{expectedSha256:hash(expectedSha256)}),signal});
    need(value.id===id,'DOCUMENT_COMPOSITION_DIRECTORY_ID_CHANGED');
    return value;
  }
  async function summary(id){
    const file=join(directoryFor(id),'composition-plan.json'),info=await lstat(file);
    const clock=[info.dev,info.ino,info.size,info.mtimeMs,info.ctimeMs].join(':');
    const retained=summaries.get(id);
    if(retained?.clock===clock)return copy(retained.value);
    const value=sourceSummary(await source(id));
    summaries.set(id,{clock,value});
    if(summaries.size>256)summaries.delete(summaries.keys().next().value);
    return copy(value);
  }
  async function list({offset=0,limit=20}={}){
    integer(offset,0,Number.MAX_SAFE_INTEGER,'DOCUMENT_COMPOSITION_OFFSET_INVALID');
    integer(limit,1,100,'DOCUMENT_COMPOSITION_LIMIT_INVALID');
    const entries=(await readdir(sourceRoot,{withFileTypes:true})).filter(entry=>
      entry.isDirectory()&&!entry.isSymbolicLink()&&ID.test(entry.name)).map(entry=>entry.name).sort();
    const items=[];
    for(const id of entries.slice(offset,offset+limit)){
      try{items.push({...await summary(id),active:active.has(id)?operationView(active.get(id)):null});}
      catch(error){items.push({id,directory:directoryFor(id),state:error.code==='ENOENT'?'SOURCE_REQUIRED':'SOURCE_UNAVAILABLE',
        error:errorView(error),active:active.has(id)?operationView(active.get(id)):null});}
    }
    return {total:entries.length,offset,limit,items};
  }
  async function exportsFor(directory,signal){
    const root=join(directory,'exports');
    let entries;try{entries=await readdir(root,{withFileTypes:true});}
    catch(error){if(error.code==='ENOENT')return [];throw error;}
    const results=[];
    for(const entry of entries.filter(row=>row.isDirectory()&&!row.isSymbolicLink()&&
      /^[a-f0-9]{32}$/.test(row.name)).sort((a,b)=>a.name.localeCompare(b.name))){
      signal?.throwIfAborted();
      try{
        const saved=parse(await ownedBytes(join(root,entry.name,'composition-export.json'),2*MiB));
        need(saved.id===basename(directory)&&saved.directory===join(root,entry.name),
          'DOCUMENT_COMPOSITION_EXPORT_ID_CHANGED');
        results.push({id:entry.name,state:'COMPLETE',source:saved.source,counts:saved.counts,
          documents:saved.batch.documents,receivedDocuments:saved.batch.receivedDocuments,
          collection:saved.batch.collection,archive:saved.batch.archive,
          observedAt:saved.batch.observedAt});
      }catch(error){results.push({id:entry.name,directory:join(root,entry.name),
        state:error.code==='ENOENT'?'CONTINUATION_REQUIRED':'REVIEW_REQUIRED',
        ...(error.code==='ENOENT'?{}:{error:errorView(error)})});}
    }
    return results;
  }
  function assemblyDirectory(composition,assemblyId){
    return join(composition.directory,'assemblies',identifier(assemblyId));
  }
  async function assembliesFor(composition,signal){
    let entries;try{entries=await readdir(join(composition.directory,'assemblies'),{withFileTypes:true});}
    catch(error){if(error.code==='ENOENT')return [];throw error;}
    const result=[];
    for(const entry of entries.filter(item=>item.isDirectory()&&!item.isSymbolicLink()&&ID.test(item.name))
      .sort((a,b)=>a.name.localeCompare(b.name))){
      signal?.throwIfAborted();
      try{
        const saved=await readDocumentPdfAssembly(assemblyDirectory(composition,entry.name),{requireFiles:false,signal});
        need(saved.plan.origin?.compositionId===composition.id&&
          saved.plan.origin.compositionSha256===composition.sha256,'DOCUMENT_ASSEMBLY_COMPOSITION_CHANGED');
        result.push({id:entry.name,name:saved.plan.request.name,sourceSha256:saved.sha256,
          sourceBytes:saved.bytes,counts:copy(saved.plan.counts)});
      }catch(error){result.push({id:entry.name,state:'SOURCE_REQUIRED',error:errorView(error)});}
    }
    return result;
  }
  async function assembly({id,sourceSha256,assemblyId,assemblySha256,signal}={}){
    const composition=await source(id,sourceSha256,signal);
    const view=await inspectDocumentPdfAssembly({workspace,directory:assemblyDirectory(composition,assemblyId),
      expectedSha256:assemblySha256,signal});
    need(view.origin?.compositionId===composition.id&&view.origin.compositionSha256===composition.sha256,
      'DOCUMENT_ASSEMBLY_COMPOSITION_CHANGED');
    const root=join(view.directory,'exports');let entries=[];
    try{entries=await readdir(root,{withFileTypes:true});}catch(error){if(error.code!=='ENOENT')throw error;}
    const exports=[];
    for(const entry of entries.filter(item=>item.isDirectory()&&!item.isSymbolicLink()&&/^[a-f0-9]{32}$/.test(item.name))){
      try{
        const saved=parse(await ownedBytes(join(root,entry.name,'assembly-delivery.json'),4*MiB));
        need(saved.id===assemblyId&&saved.source.sha256===view.sourceSha256&&saved.directory===join(root,entry.name),
          'DOCUMENT_ASSEMBLY_EXPORT_CHANGED');
        const receipt=parse(await ownedBytes(join(root,entry.name,'assembly-archive.json'),65536));
        need(receipt.sourceSha256===view.sourceSha256&&receipt.archive?.path===join(root,entry.name,'complete-pdf-bundle.tar'),
          'DOCUMENT_ASSEMBLY_EXPORT_CHANGED');
        exports.push({id:entry.name,complete:true,counts:saved.counts,files:saved.files,native:saved.native,archive:receipt.archive});
      }catch(error){exports.push({id:entry.name,complete:false,error:errorView(error)});}
    }
    return {...view,exports};
  }

  async function get({id,offset=0,limit=100,sourceSha256,signal}={}){
    identifier(id);integer(offset,0,2000,'DOCUMENT_COMPOSITION_OFFSET_INVALID');
    integer(limit,1,200,'DOCUMENT_COMPOSITION_LIMIT_INVALID');
    const composition=await source(id,sourceSha256,signal);
    let native=null,rows=new Map();
    try{
      const bound=await readDocumentCompositionBatch({directory:composition.directory,workspace,signal});
      const snapshot=await inspectDocumentBatch({workspace,plan:bound.batch.plan,signal});
      rows=new Map(snapshot.rows.map(row=>[row.id,row]));
      native={planSha256:bound.batch.sha256,planBytes:bound.batch.bytes,
        directory:bound.batch.plan.directory,createdAt:bound.batch.plan.createdAt,
        totals:copy(snapshot.totals),units:copy(bound.batch.plan.unitMeaning),
        receivedDocuments:snapshot.receivedDocuments,documents:snapshot.documents,
        counts:copy(snapshot.counts),parentTasks:copy(snapshot.parentTasks)};
    }catch(error){if(error.code!=='ENOENT')throw error;}
    return {...sourceSummary(composition),request:copy(composition.plan.originalRequest),
      sourceFiles:composition.plan.files.filter(file=>file.role!=='document').map(({content,...file})=>copy(file)),
      page:{offset,limit,total:composition.plan.documents.length},
      documents:composition.plan.documents.slice(offset,offset+limit).map(item=>{
        const {settings,...details}=item;
        return {...copy(details),native:rows.has(item.id)?copy(rows.get(item.id)):null};
      }),native,exports:await exportsFor(composition.directory,signal),assemblies:await assembliesFor(composition,signal),
      active:active.has(id)?operationView(active.get(id)):null};
  }
  async function correctionDraft({id,sourceSha256,documentIds,newId,name,mode,reason,signal}={}){
    const original=await source(id,hash(sourceSha256),signal);
    return documentCorrectionDraft({source:original,documentIds,id:newId,name,mode,reason});
  }
  function operation({operationId}={}){
    need(typeof operationId==='string'&&operations.has(operationId),'DOCUMENT_COMPOSITION_OPERATION_NOT_FOUND',
      'Refresh the saved composition to continue its original records.',404);
    return operationView(operations.get(operationId));
  }
  async function selectedBatch(input,signal){
    const composition=await source(input.id,input.sourceSha256,signal);
    const selected=await readDocumentCompositionBatch({directory:composition.directory,workspace,signal});
    need(selected.composition.sha256===composition.sha256,'DOCUMENT_COMPOSITION_SOURCE_SELECTION_CHANGED');
    return selected;
  }
  async function receiveUploaded(input,signal,onProgress){
    need(plain(input.request)&&input.request.id===input.id,'DOCUMENT_COMPOSITION_ID_CHANGED');
    need(plain(input.templates)&&Object.keys(input.templates).length<=8,
      'DOCUMENT_COMPOSITION_TEMPLATE_SOURCES_REQUIRED');
    const dataset=uploadedFile(input.dataset,16*MiB);
    const templates=Object.fromEntries(Object.entries(input.templates).map(([id,value])=>
      [id,uploadedFile(value,MiB)]));
    const plan=composeDocumentSources({request:input.request,dataset,templates});
    return receivePlan(plan,input.id,signal,onProgress);
  }
  async function receivePlan(plan,id,signal,onProgress){
    const raw=encoded(plan),sha256=digest(raw);
    signal.throwIfAborted();
    const temporary=join(sourceRoot,'.composition-source-'+randomUUID()+'.json');
    try{
      await writeExact(temporary,raw);
      const saved=await receiveDocumentComposition({source:temporary,directory:directoryFor(id),
        expectedSha256:sha256,signal});
      need(saved.id===id,'DOCUMENT_COMPOSITION_ID_CHANGED');
      await onProgress({stage:'DOCUMENT_SOURCES_PREPARED',id:saved.id,...saved.counts});
      return sourceSummary(saved);
    }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  }
  async function reportResult(selected,snapshot,signal){
    signal.throwIfAborted();
    const reportId=digest(encoded(snapshot)).slice(0,32);
    const directory=join(selected.composition.directory,'reports',reportId);
    const report=await saveDocumentBatchReport({snapshot,plan:selected.batch.plan,directory});
    return {sourceSha256:selected.composition.sha256,planSha256:selected.batch.sha256,
      documents:snapshot.documents,receivedDocuments:snapshot.receivedDocuments,
      counts:copy(snapshot.counts),parentTasks:copy(snapshot.parentTasks),report:{id:reportId,...report},
      operation:copy(snapshot.operation??null)};
  }
  async function execute(kind,input,signal,onProgress){
    if(kind==='stage')return receiveUploaded(input,signal,onProgress);
    if(kind==='correct'){
      need(plain(input.draft)&&input.draft.id===input.id,'DOCUMENT_CORRECTION_DRAFT_REQUIRED');
      const original=await source(identifier(input.draft.parent?.id),hash(input.draft.parent?.sourceSha256),signal);
      const plan=composeDocumentCorrection({source:original,draft:input.draft});
      return receivePlan(plan,input.id,signal,onProgress);
    }
    if(kind==='restore'){
      need((input.sourceFile!==undefined)!==(input.source!==undefined),
        'DOCUMENT_COMPOSITION_RESTORE_SOURCE_REQUIRED');
      let path,temporary=null;
      try{
        if(input.source!==undefined){
          const raw=Buffer.from(uploadedFile(input.source,28*MiB),'utf8');
          need(digest(raw)===input.sourceSha256,'DOCUMENT_COMPOSITION_SOURCE_SELECTION_CHANGED');
          need(parse(raw).request?.id===input.id,'DOCUMENT_COMPOSITION_ID_CHANGED');
          temporary=join(sourceRoot,'.composition-receiving-'+randomUUID()+'.json');
          await writeExact(temporary,raw);path=temporary;
        }else{
          path=absolute(input.sourceFile);
          need(roots.some(root=>inside(path,root)),'DOCUMENT_COMPOSITION_SOURCE_FILE_NOT_DECLARED');
          const raw=await ownedBytes(path,MAX_PLAN,{privateMode:false});
          need(digest(raw)===input.sourceSha256,'DOCUMENT_COMPOSITION_SOURCE_SELECTION_CHANGED');
          need(parse(raw).request?.id===input.id,'DOCUMENT_COMPOSITION_ID_CHANGED');
        }
        signal.throwIfAborted();
        const result=await receiveDocumentComposition({source:path,directory:directoryFor(input.id),
          expectedSha256:input.sourceSha256,signal});
        return sourceSummary(result);
      }finally{if(temporary)await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
    }
    if(kind==='prepare'){
      const original=await source(input.id,input.sourceSha256,signal);
      const result=await prepareDocumentCompositionBatch({workspace,directory:original.directory,
        intakeAccessToken,signal,onProgress});
      need(result.composition.sha256===original.sha256,'DOCUMENT_COMPOSITION_SOURCE_SELECTION_CHANGED');
      return {...sourceSummary(original),planSha256:result.batch.sha256,
        totals:copy(result.batch.plan.totals),units:copy(result.batch.plan.unitMeaning)};
    }
    if(kind==='assembly-stage'){
      const selected=await selectedBatch(input,signal);
      need(Array.isArray(input.documentIds)&&input.documentIds.length>0&&
        new Set(input.documentIds).size===input.documentIds.length,'DOCUMENT_ASSEMBLY_SELECTION_REQUIRED');
      const known=new Set(selected.composition.plan.documents.map(item=>item.id));
      need(input.documentIds.every(id=>known.has(id)),'DOCUMENT_ASSEMBLY_SELECTION_CHANGED');
      need(plain(input.request)&&input.request.id===input.assemblyId,'DOCUMENT_ASSEMBLY_ID_CHANGED');
      await ownedDirectory(join(selected.composition.directory,'assemblies'),{create:true});
      const saved=await stageDocumentPdfAssemblyFromBatch({workspace,
        directory:assemblyDirectory(selected.composition,input.assemblyId),request:input.request,
        batchDirectory:selected.batch.plan.directory,batchPlanSha256:selected.batch.sha256,
        itemIds:input.documentIds,composition:{id:input.id,sha256:selected.composition.sha256},signal});
      await onProgress({stage:'ORDERED_PDF_VOLUMES_SAVED',...saved.plan.counts});
      return {assemblyId:input.assemblyId,assemblySha256:saved.sha256,counts:copy(saved.plan.counts)};
    }
    if(kind.startsWith('assembly-')){
      const composition=await source(input.id,input.sourceSha256,signal);
      const directory=assemblyDirectory(composition,input.assemblyId);
      const saved=await readDocumentPdfAssembly(directory,{expectedSha256:hash(input.assemblySha256),signal});
      need(saved.plan.origin?.compositionId===input.id&&saved.plan.origin.compositionSha256===composition.sha256,
        'DOCUMENT_ASSEMBLY_COMPOSITION_CHANGED');
      if(kind==='assembly-prepare'){
        const result=await prepareDocumentPdfAssemblyBatch({workspace,directory,expectedSha256:saved.sha256,
          intakeAccessToken,signal,onProgress});
        return {assemblyId:input.assemblyId,assemblySha256:saved.sha256,
          planSha256:result.batch?.sha256??null,totals:copy(result.totals),counts:copy(saved.plan.counts)};
      }
      if(kind==='assembly-run'||kind==='assembly-receive'){
        const result=await runDocumentPdfAssembly({workspace,directory,expectedSha256:saved.sha256,
          approvedPlanSha256:input.planSha256,receiveOnly:kind==='assembly-receive',intakeAccessToken,
          signal,deadlineMs,pollMs,onProgress});
        return {assemblyId:input.assemblyId,assemblySha256:saved.sha256,complete:result.complete,
          counts:result.counts,volumes:result.volumes.map(row=>({id:row.id,state:row.state,received:row.received}))};
      }
      if(kind==='assembly-export'){
        const exportId=input.exportId??randomUUID().replaceAll('-','');
        need(/^[a-f0-9]{32}$/.test(exportId),'DOCUMENT_ASSEMBLY_EXPORT_REQUIRED');
        const destination=join(directory,'exports',exportId);
        await ownedDirectory(destination,{create:input.exportId===undefined});
        await onProgress({stage:'COMPLETE_PDF_BUNDLE_EXPORT',exportId});
        const result=await exportDocumentPdfAssembly({workspace,directory,expectedSha256:saved.sha256,destination,signal});
        return {assemblyId:input.assemblyId,assemblySha256:saved.sha256,exportId,counts:result.counts,complete:true};
      }
      need(false,'DOCUMENT_COMPOSITION_ACTION_INVALID');
    }

    const selected=await selectedBatch(input,signal);
    if(kind==='run'||kind==='receive'){
      let snapshot;
      try{
        const context={workspace,plan:selected.batch.plan,signal,deadlineMs,pollMs,onProgress};
        snapshot=kind==='run'?await runDocumentBatch({...context,
          approvedPlanSha256:input.planSha256,planSha256:selected.batch.sha256,
          ...(intakeAccessToken===null?{}:{intakeAccessToken})}):
          await receiveDocumentBatch(context);
        return await reportResult(selected,snapshot,signal);
      }catch(error){
        // The original journals remain usable after cancellation; save their complete current view.
        try{
          snapshot=await inspectDocumentBatch({workspace,plan:selected.batch.plan});
          await reportResult(selected,snapshot,new AbortController().signal);
        }catch{/* Original requests/checkouts/jobs retain their own complete outcomes. */}
        throw error;
      }
    }
    if(kind==='export'){
      const snapshot=await inspectDocumentBatch({workspace,plan:selected.batch.plan,signal});
      need(snapshot.receivedDocuments>0,'DOCUMENT_BATCH_RECEIVED_DOCUMENT_REQUIRED',
        'Receive at least one complete document before exporting its Collection.');
      // Each requested customer edition keeps the original Collection's current notes and members.
      // An interrupted export reuses its selected directory and native archive through exportId.
      const exportId=input.exportId??randomUUID().replaceAll('-','');
      need(/^[a-f0-9]{32}$/.test(exportId),'DOCUMENT_COMPOSITION_EXPORT_REQUIRED');
      const destination=join(selected.composition.directory,'exports',exportId);
      await ownedDirectory(destination,{create:input.exportId===undefined});
      await onProgress({stage:'DOCUMENT_COLLECTION_EXPORT',exportId});
      const result=await exportDocumentComposition({workspace,directory:selected.composition.directory,
        destination,signal});
      return {exportId,...result};
    }
    need(false,'DOCUMENT_COMPOSITION_ACTION_INVALID');
  }
  function start(kind,input={}){
    need(!closing,'DOCUMENT_COMPOSITION_WORKSPACE_CLOSING','The customer workspace is closing.',409);
    need(['stage','correct','restore','prepare','run','receive','export','assembly-stage','assembly-prepare',
      'assembly-run','assembly-receive','assembly-export'].includes(kind)&&plain(input),
      'DOCUMENT_COMPOSITION_ACTION_INVALID');
    const id=identifier(input.id);
    if(kind!=='stage'&&kind!=='correct')hash(input.sourceSha256);
    if(kind==='run'||kind==='assembly-run')hash(input.planSha256);
    if(kind.startsWith('assembly-'))identifier(input.assemblyId);
    if(kind.startsWith('assembly-')&&kind!=='assembly-stage')hash(input.assemblySha256);
    if(kind==='export'&&input.exportId!==undefined)need(/^[a-f0-9]{32}$/.test(input.exportId),'DOCUMENT_COMPOSITION_EXPORT_REQUIRED');
    need(!active.has(id),'DOCUMENT_COMPOSITION_OPERATION_ACTIVE',
      'Continue the active operation for this composition.',409);
    need(active.size<4,'DOCUMENT_COMPOSITION_OPERATION_CAPACITY',
      'The current source operations are still running.',429);
    const entry={id:randomUUID(),compositionId:id,kind,state:'RUNNING',startedAt:now(),endedAt:null,
      progress:null,result:null,error:null,controller:new AbortController(),promise:null};
    active.set(id,entry);operations.set(entry.id,entry);
    for(const [key,old]of operations)if(operations.size>128&&old.state!=='RUNNING')operations.delete(key);
    // Return the accepted HTTP request before beginning potentially large local source work.
    entry.promise=new Promise(resolve=>setImmediate(resolve)).then(()=>
      execute(kind,input,entry.controller.signal,async progress=>{entry.progress=copy(progress);})).then(result=>{
        entry.result=result;
        entry.state=((kind==='run'||kind==='receive')&&result.receivedDocuments<result.documents||
          (kind==='assembly-run'||kind==='assembly-receive')&&!result.complete)?'CONTINUATION_REQUIRED':'COMPLETE';
      },error=>{
        entry.error=errorView(error);
        entry.state=entry.controller.signal.aborted?'STOPPED':'FAILED';
      }).finally(()=>{entry.endedAt=now();active.delete(id);summaries.delete(id);});
    return operationView(entry);
  }
  async function cancel({operationId}={}){
    const selected=operations.get(operationId);
    need(selected,'DOCUMENT_COMPOSITION_OPERATION_NOT_FOUND',undefined,404);
    if(selected.state==='RUNNING')selected.controller.abort(
      documentError('DOCUMENT_COMPOSITION_STOPPED','The current document operation was stopped.'));
    return operationView(selected);
  }
  async function fileDescriptor(input,signal){
    const composition=await source(input.id,input.sourceSha256,signal);
    let selected;
    if(input.kind==='source-plan')selected={path:composition.planPath,bytes:composition.bytes,
      sha256:composition.sha256,name:'composition-plan.json'};
    else if(input.kind==='source'){
      const file=composition.plan.files.find(file=>file.path===input.file);
      need(file,'DOCUMENT_COMPOSITION_SOURCE_FILE_NOT_FOUND',undefined,404);
      selected={path:join(composition.directory,file.path),bytes:file.bytes,sha256:file.sha256,name:basename(file.path)};
    }else if(input.kind==='native-plan'){
      const bound=await selectedBatch(input,signal);
      selected={path:join(bound.batch.plan.directory,'batch-plan.json'),bytes:bound.batch.bytes,
        sha256:bound.batch.sha256,name:'batch-plan.json'};
    }else if(input.kind==='export'){
      need(/^[a-f0-9]{32}$/.test(input.exportId??''),'DOCUMENT_COMPOSITION_EXPORT_REQUIRED');
      const directory=join(composition.directory,'exports',input.exportId);
      const saved=parse(await ownedBytes(join(directory,'composition-export.json'),2*MiB));
      need(saved.id===input.id&&saved.directory===directory&&saved.source.sha256===composition.sha256,
        'DOCUMENT_COMPOSITION_EXPORT_SOURCE_CHANGED');
      if(input.file==='documents.tar')selected={...saved.batch.archive,name:'documents.tar'};
      else if(input.file==='composition-plan.json')selected={...saved.source,name:'composition-plan.json'};
      else{
        const row=saved.batch.files.find(file=>file.name===input.file);
        need(row,'DOCUMENT_COMPOSITION_EXPORT_FILE_NOT_FOUND',undefined,404);
        selected={path:join(directory,row.name),bytes:row.bytes,sha256:row.sha256,name:row.name};
      }
    }else if(input.kind==='report'){
      need(/^[a-f0-9]{32}$/.test(input.reportId??'')&&
        ['batch-plan.json','batch-results.json','batch-results.csv','batch-review.html'].includes(input.file),
        'DOCUMENT_COMPOSITION_REPORT_REQUIRED');
      const directory=join(composition.directory,'reports',input.reportId);
      const raw=await ownedBytes(join(directory,'batch-results.json'),64*MiB);
      need(digest(raw).slice(0,32)===input.reportId,'DOCUMENT_COMPOSITION_REPORT_CHANGED');
      const snapshot=parse(raw),bound=await selectedBatch(input,signal);
      need(snapshot.id===input.id&&snapshot.inputSha256===bound.batch.plan.inputSha256,
        'DOCUMENT_COMPOSITION_REPORT_SOURCE_CHANGED');
      const body=await ownedBytes(join(directory,input.file),64*MiB);
      selected={path:join(directory,input.file),bytes:body.length,sha256:digest(body),name:input.file};
    }else need(false,'DOCUMENT_COMPOSITION_FILE_KIND_INVALID');
    need(inside(absolute(selected.path),composition.directory),
      'DOCUMENT_COMPOSITION_FILE_OUTSIDE_ORIGINAL_SOURCE');
    return selected;
  }
  async function download(input,{signal}={}){
    need(plain(input),'DOCUMENT_COMPOSITION_DOWNLOAD_REQUIRED');
    if(typeof input.kind==='string'&&input.kind.startsWith('assembly-')){
      const composition=await source(input.id,input.sourceSha256,signal);
      const directory=assemblyDirectory(composition,input.assemblyId);
      const selected=await readDocumentPdfAssembly(directory,{expectedSha256:hash(input.assemblySha256),signal});
      need(selected.plan.origin?.compositionId===input.id&&selected.plan.origin.compositionSha256===composition.sha256,
        'DOCUMENT_ASSEMBLY_COMPOSITION_CHANGED');
      let file;
      if(input.kind==='assembly-pdf'){
        const output=await documentPdfAssemblyOutput({workspace,directory,
          expectedSha256:selected.sha256,volumeId:input.volumeId,signal});
        if(output.resourceId)return workspace.library.download(output.resourceId,{signal});
        file={path:output.path,bytes:output.bytes,sha256:output.sha256,name:output.filename};
      }else if(input.kind==='assembly-source'){
        file={path:join(directory,'assembly-plan.json'),bytes:selected.bytes,sha256:selected.sha256,name:'assembly-plan.json'};
      }else if(input.kind==='assembly-export'){
        need(/^[a-f0-9]{32}$/.test(input.exportId??''),'DOCUMENT_ASSEMBLY_EXPORT_REQUIRED');
        const root=join(directory,'exports',input.exportId);
        const saved=parse(await ownedBytes(join(root,'assembly-delivery.json'),4*MiB));
        need(saved.id===input.assemblyId&&saved.directory===root&&saved.source.sha256===selected.sha256,
          'DOCUMENT_ASSEMBLY_EXPORT_CHANGED');
        if(input.file==='native/documents.tar'){
          need(saved.native?.archive.path===join(root,'native','documents.tar'),'DOCUMENT_ASSEMBLY_NATIVE_EXPORT_REQUIRED');
          file={...saved.native.archive,name:'documents.tar'};
        }else if(input.file==='complete-pdf-bundle.tar'){
          const receipt=parse(await ownedBytes(join(root,'assembly-archive.json'),65536));
          need(receipt.sourceSha256===saved.source.sha256&&receipt.archive?.path===join(root,input.file),
            'DOCUMENT_ASSEMBLY_EXPORT_CHANGED');
          file={...receipt.archive,name:input.file};
        }else if(input.file==='assembly-delivery.json'){
          const raw=await ownedBytes(join(root,input.file),4*MiB);
          file={path:join(root,input.file),bytes:raw.length,sha256:digest(raw),name:input.file};
        }else{
          const row=saved.files.find(value=>value.path===input.file);
          need(row,'DOCUMENT_ASSEMBLY_EXPORT_FILE_NOT_FOUND');
          file={...row,path:join(root,row.path),name:basename(row.path)};
        }
      }else need(false,'DOCUMENT_ASSEMBLY_DOWNLOAD_REQUIRED');
      need(inside(absolute(file.path),directory),'DOCUMENT_ASSEMBLY_FILE_OUTSIDE_SOURCE');
      const resource={id:digest(canonical([input.id,selected.sha256,file.path,file.sha256])),
        name:file.name,path:file.path,bytes:file.bytes,sha256:file.sha256,deliveryStatus:'SAVED'};
      const opened=await verifyFile(resource,{roots:[sourceRoot],maxFileBytes:file.bytes,indexBytes:0,
        tempRoot:sourceRoot,signal,spool:true});
      return {resource,...opened};
    }
    if(input.kind==='pdf'){
      const selected=await selectedBatch(input,signal);
      const snapshot=await inspectDocumentBatch({workspace,plan:selected.batch.plan,signal});
      const row=snapshot.rows.find(row=>row.id===input.documentId);
      need(row?.received,'DOCUMENT_COMPOSITION_PDF_NOT_RECEIVED',undefined,409);
      const pdf=row.outputs.files.find(file=>file.slot==='pdf');
      need(pdf?.resourceId,'DOCUMENT_COMPOSITION_PDF_RESOURCE_REQUIRED');
      const resource=workspace.library.resource(pdf.resourceId);
      need(resource.sha256===pdf.sha256&&resource.bytes===pdf.bytes,
        'DOCUMENT_COMPOSITION_PDF_RESOURCE_CHANGED');
      return workspace.library.download(pdf.resourceId,{signal});
    }
    const file=await fileDescriptor(input,signal);
    const resource={id:digest(canonical([input.id,input.sourceSha256,file.path,file.sha256])),
      name:file.name,path:file.path,bytes:file.bytes,sha256:file.sha256,deliveryStatus:'SAVED'};
    const opened=await verifyFile(resource,{roots:[sourceRoot],maxFileBytes:file.bytes,
      indexBytes:0,tempRoot:sourceRoot,signal,spool:true});
    return {resource,...opened};
  }
  function close(){
    if(closePromise)return closePromise;
    closing=true;
    const pending=[...active.values()];
    for(const entry of pending)entry.controller.abort(
      documentError('DOCUMENT_COMPOSITION_WORKSPACE_CLOSING','The document workspace is closing.'));
    closePromise=Promise.allSettled([...pending.map(entry=>entry.promise),bundles.close()]).then(()=>undefined);
    return closePromise;
  }
  return Object.freeze({workspace,sourceRoot,bundles,status,list,get,assembly,correctionDraft,operation,start,cancel,download,close});
}
