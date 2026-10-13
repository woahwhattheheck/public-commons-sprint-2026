// MIT. Retain explicitly selected result files alongside their original Application run.
// File custody reuses the complete input-set engine; this module never dispatches a worker.
import {constants} from 'node:fs';
import {open,readdir} from 'node:fs/promises';
import {join,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {initializationDirectory,retainInitializationRecord} from '../../sf88-operator-buyer-cli/initialization.mjs';
import {need,plain,operationId,recordId,absolute,readJSON,json,canonical,withWorkspaceWrite,operationLease,
  receivedOperation} from './storage.mjs';
import {requireApplicationInputWorkspace} from './application-input-workspace.mjs';
import {readApplicationInputSetDirectory,retainApplicationInputSetDirectory} from './application-input-set-sources.mjs';
import {applicationInputSetJSON,normalizeApplicationInputSet} from './public/application-input-set-format.mjs';

export const APPLICATION_RESULT_REVIEW_SCHEMA='stellar-forge.runtime-application-result-review.v1';
export const APPLICATION_RESULT_CAPTURE_SCHEMA='stellar-forge.runtime-application-result-capture.v1';
export const APPLICATION_RESULT_HANDOFF_SCHEMA='stellar-forge.runtime-application-result-handoff.v1';
export const APPLICATION_RESULT_REVIEW_MAX_BYTES=3*1024*1024;
const REVIEW=APPLICATION_RESULT_REVIEW_SCHEMA,CAPTURE=APPLICATION_RESULT_CAPTURE_SCHEMA,HANDOFF=APPLICATION_RESULT_HANDOFF_SCHEMA;
const HASH=/^[a-f0-9]{64}$/, UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const hash=value=>createHash('sha256').update(value).digest('hex');
const identity=value=>hash(json(canonical(value)));
const same=(a,b)=>identity(a)===identity(b);
const fields=(value,allowed)=>need(plain(value)&&Object.keys(value).every(key=>allowed.includes(key)),
  'APPLICATION_RESULT_ARGUMENTS_INVALID');
const text=(value,maximum,empty=false)=>need(typeof value==='string'&&value.length<=maximum&&
  !value.includes('\0')&&(empty||value.trim().length>0),'APPLICATION_RESULT_TEXT_INVALID');
const inside=(parent,child)=>{const part=relative(parent,child);return part===''||(!part.startsWith('..'+sep)&&part!=='..'&&!part.startsWith(sep));};
const statSame=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
function bounded(value) {
  need(Buffer.byteLength(json(value))<=APPLICATION_RESULT_REVIEW_MAX_BYTES,'APPLICATION_RESULT_METADATA_LIMIT',
    'The complete run context and manifest exceed the supported 3 MiB review. No context was truncated.');
  return value;
}
function selection(input) {
  recordId(input.applicationId);operationId(input.operationId);absolute(input.directory);
  text(input.name,180);text(input.actor,240);text(input.note,16000);
  return {applicationId:input.applicationId,operationId:input.operationId,directory:input.directory,
    name:input.name.trim(),actor:input.actor,note:input.note};
}
async function record(root,path,optional=false,maximum=APPLICATION_RESULT_REVIEW_MAX_BYTES) {
  let fd;
  try {
    fd=await open(join(root,path),constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
    const first=await fd.stat();need(first.isFile()&&first.size<=maximum,
      'APPLICATION_RESULT_RECORD_INVALID');
    const raw=await fd.readFile(),last=await fd.stat();
    need(raw.length===first.size&&statSame(first,last),'APPLICATION_RESULT_RECORD_CHANGED');
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
    return {path,bytes:raw.length,sha256:hash(raw),rawBase64:raw.toString('base64'),value};
  } catch(error) {if(optional&&error.code==='ENOENT')return null;throw error;}
  finally {if(fd)await fd.close();}
}
function decodedRecord(value,path,optional=false) {
  if(optional&&value===null)return null;
  need(plain(value)&&value.path===path&&Number.isSafeInteger(value.bytes)&&value.bytes>=0&&
    value.bytes<=APPLICATION_RESULT_REVIEW_MAX_BYTES&&HASH.test(value.sha256??'')&&typeof value.rawBase64==='string',
    'APPLICATION_RESULT_PROVENANCE_CHANGED');
  const raw=Buffer.from(value.rawBase64,'base64');
  need(raw.toString('base64')===value.rawBase64&&raw.length===value.bytes&&hash(raw)===value.sha256,
    'APPLICATION_RESULT_PROVENANCE_CHANGED');
  const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  need(same(parsed,value.value),'APPLICATION_RESULT_PROVENANCE_CHANGED');
  return parsed;
}
function validateProvenance(value,applicationId,operation) {
  need(plain(value)&&plain(value.records),'APPLICATION_RESULT_PROVENANCE_INVALID');
  const rows=value.records, runPath='applications/'+applicationId+'/runs/'+operation+'.json';
  const run=decodedRecord(rows.run,runPath);
  need(run.schema==='stellar-forge.application-run.v1'&&run.id===operation&&run.applicationId===applicationId&&
    HASH.test(run.revision??'')&&plain(run.request)&&run.request.requestId===operation&&
    run.request.applicationId===applicationId&&run.request.operation==='managed-run',
    'APPLICATION_RESULT_RUN_CHANGED');
  recordId(run.reviewId);
  need(run.requestHash===identity({applicationId,requestId:operation,reviewId:run.reviewId}),
    'APPLICATION_RESULT_RUN_CHANGED');
  const app=decodedRecord(rows.application,'applications/'+applicationId+'/revisions/'+run.revision+'.json');
  const review=decodedRecord(rows.startReview,'application-reviews/'+run.reviewId+'.json');
  need(app.schema==='stellar-forge.runtime-application.v1'&&app.id===applicationId&&app.revision===run.revision&&
    review.schema==='stellar-forge.application-start-review.v1'&&review.id===run.reviewId&&
    review.applicationId===applicationId&&review.applicationRevision===run.revision,
    'APPLICATION_RESULT_APPLICATION_CHANGED');
  const {schema:appSchema,id:appId,revision,createdAt,updatedAt,saveRequestId,saveRequestHash,reviewId,...appBody}=app;
  const {id:startId,reviewedAt,...startBody}=review;
  need(identity(appBody)===revision&&identity(startBody).slice(0,24)===startId&&
    same(review.runtime,app.runtime)&&review.homeId===app.homeId&&
    run.request.homeId===review.homeId&&run.request.releaseId===review.releaseId&&
    run.request.expectedRevision===review.homeRevision&&run.request.command===review.command?.command,
    'APPLICATION_RESULT_APPLICATION_CHANGED');
  const request=decodedRecord(rows.operationRequest,'operations/'+operation+'/request.json',true);
  const state=decodedRecord(rows.state,'operations/'+operation+'/state.json',true);
  const result=decodedRecord(rows.commandResult,'operations/'+operation+'/command-result.json',true);
  const cancellation=decodedRecord(rows.cancellation,runPath.replace(/\.json$/,'.cancel.json'),true);
  if(request) {
    const {requestHash,createdAt,...body}=request;
    need(requestHash===identity(body)&&request.operation==='managed-run'&&request.applicationId===applicationId,
      'APPLICATION_RESULT_OPERATION_CHANGED');
    if(request.clientRequestHash)need(request.clientRequestHash===identity(run.request),'APPLICATION_RESULT_OPERATION_CHANGED');
    // Historical requests predating clientRequestHash must still match every
    // originally supplied run field; normalization may add further fields.
    else for(const [key,item] of Object.entries(run.request))if(key!=='requestId')
      need(same(request[key]??null,item),'APPLICATION_RESULT_OPERATION_CHANGED');
  }
  need(!cancellation||(cancellation.applicationId===applicationId&&cancellation.operationId===operation),
    'APPLICATION_RESULT_CANCELLATION_CHANGED');
  need(typeof value.receivedHistory==='boolean','APPLICATION_RESULT_PROVENANCE_INVALID');
  for(const [key,item] of Object.entries({application:app,run,startReview:review,operationRequest:request,state,commandResult:result,cancellation}))
    need(same(value[key],item),'APPLICATION_RESULT_PROVENANCE_CHANGED');
  return value;
}
export function validateApplicationResultReview(value) {
  bounded(value);need(plain(value)&&value.schema===REVIEW,'APPLICATION_RESULT_REVIEW_INVALID');
  operationId(value.workspaceId);selection(value);
  const {reviewSha256,...body}=value;
  need(reviewSha256===identity(body),'APPLICATION_RESULT_REVIEW_CHANGED');
  const manifest=normalizeApplicationInputSet(value.manifest);
  need(same(manifest,value.manifest)&&manifest.name===value.name&&value.setId===hash(applicationInputSetJSON(manifest)),
    'APPLICATION_RESULT_MANIFEST_CHANGED');
  validateProvenance(value.provenance,value.applicationId,value.operationId);
  return value;
}
function validateCapture(intent) {
  need(plain(intent)&&intent.schema===CAPTURE&&typeof intent.createdAt==='string','APPLICATION_RESULT_CAPTURE_INVALID');
  operationId(intent.requestId);validateApplicationResultReview(intent.review);
  need(intent.workspaceId===intent.review.workspaceId,'APPLICATION_RESULT_CAPTURE_CHANGED');
  return intent;
}
function validateDocument(document) {
  need(plain(document)&&document.schema===HANDOFF,'APPLICATION_RESULT_HANDOFF_INVALID');
  const capture=validateCapture(document.capture),review=capture.review,completion=document.completion;
  need(document.originWorkspaceId===capture.workspaceId&&document.source?.path==='files'&&
    document.source.setId===review.setId&&same(document.source.manifest,review.manifest)&&
    completion?.requestId===capture.requestId&&completion.intentSha256===identity(capture)&&
    completion.setId===review.setId,'APPLICATION_RESULT_HANDOFF_CHANGED');
  return document;
}
export function createApplicationResultSetsAPI(root,workspaceId,model) {
  const directory=join(root,'application-result-sets'),requests=join(directory,'captures'),imports=join(directory,'received');
  const live=()=>requireApplicationInputWorkspace(root,workspaceId);
  async function mutate(fn) {
    return withWorkspaceWrite(root,async()=>{
      await live();await initializationDirectory(directory,{create:true});
      const lease=await operationLease(join(directory,'results.lock'));
      try{return await fn();}finally{await lease.close();}
    });
  }
  function sourceAllowed(path) {
    absolute(path);need(!inside(directory,path),'APPLICATION_RESULT_RECURSIVE_SOURCE');
    for(const name of ['application-inputs','application-input-sets','application-result-sets'])
      need(!inside(path,join(root,name)),'APPLICATION_RESULT_RECURSIVE_SOURCE',
        'Select the output folder itself, not a directory containing the retained input/result library.');
  }
  async function provenance(input) {
    const {applicationId,operationId:operation}=input;
    const run=await record(root,'applications/'+applicationId+'/runs/'+operation+'.json');
    need(HASH.test(run.value?.revision??''),'APPLICATION_RESULT_RUN_CHANGED');recordId(run.value.reviewId);
    const rows={
      application:await record(root,'applications/'+applicationId+'/revisions/'+run.value.revision+'.json'),
      run,
      startReview:await record(root,'application-reviews/'+run.value.reviewId+'.json'),
      operationRequest:await record(root,'operations/'+operation+'/request.json',true),
      state:await record(root,'operations/'+operation+'/state.json',true),
      commandResult:await record(root,'operations/'+operation+'/command-result.json',true),
      cancellation:await record(root,'applications/'+applicationId+'/runs/'+operation+'.cancel.json',true)
    };
    const value={...Object.fromEntries(Object.entries(rows).map(([key,item])=>[key,item?.value??null])),
      records:rows,receivedHistory:Boolean(await receivedOperation(root,operation))};
    return validateProvenance(value,applicationId,operation);
  }
  async function buildReview(input) {
    const chosen=selection(input);sourceAllowed(chosen.directory);
    const before=await provenance(chosen),source=await readApplicationInputSetDirectory(chosen);
    need(same(before,await provenance(chosen)),'APPLICATION_RESULT_OBSERVATION_CHANGED',
      'The original run observation changed while its files were read. Review the current observation again.',409);
    const body={schema:REVIEW,workspaceId,...chosen,provenance:before,
      manifest:source.manifest,setId:hash(applicationInputSetJSON(source.manifest))};
    return bounded({...body,reviewSha256:identity(body)});
  }
  async function completedOriginal(review) {
    const complete=await readJSON(join(root,'application-input-sets','originals',review.setId,'complete.json'),true);
    if(!complete)return null;
    const source=await model().applicationInputSetInspect({setId:review.setId});
    need(source.phase==='READY'&&same(source.manifest,review.manifest)&&
      complete.workspaceId===workspaceId&&complete.setId===review.setId&&
      same(complete.files,source.files.map(file=>({path:file.path,uploadId:file.uploadId,bytes:file.bytes,sha256:file.sha256}))),
      'APPLICATION_RESULT_SOURCE_CHANGED');
    return source;
  }
  async function read(requestId) {
    operationId(requestId);const base=join(requests,requestId);await initializationDirectory(base);
    const intent=validateCapture(await readJSON(join(base,'intent.json'))),complete=await readJSON(join(base,'complete.json'),true);
    need(intent.requestId===requestId&&intent.workspaceId===workspaceId,'APPLICATION_RESULT_CAPTURE_CHANGED');
    if(complete)need(complete.requestId===requestId&&complete.intentSha256===identity(intent)&&
      complete.setId===intent.review.setId,'APPLICATION_RESULT_COMPLETION_CHANGED');
    const value={requestId,phase:complete?'CAPTURED':'CAPTURING',setId:intent.review.setId,intent,complete};
    if(complete) {
      value.source=await model().applicationInputSetInspect({setId:value.setId});
      need(value.source.phase==='READY'&&same(value.source.manifest,intent.review.manifest),'APPLICATION_RESULT_SOURCE_CHANGED');
    }
    return value;
  }
  async function imported(requestId) {
    operationId(requestId);const base=join(imports,requestId);await initializationDirectory(base);
    const intent=await readJSON(join(base,'intent.json')),complete=await readJSON(join(base,'complete.json'),true);
    need(intent?.schema===HANDOFF&&intent.workspaceId===workspaceId&&intent.requestId===requestId&&
      intent.documentSha256===identity(intent.document),'APPLICATION_RESULT_RECEIVE_CHANGED');
    absolute(intent.directory);validateDocument(intent.document);
    if(complete)need(complete.requestId===requestId&&complete.intentSha256===identity(intent)&&
      complete.setId===intent.document.source.setId,'APPLICATION_RESULT_RECEIVE_CHANGED');
    const value={requestId,phase:complete?'RECEIVED':'RECEIVING',setId:intent.document.source.setId,
      documentSha256:intent.documentSha256,origin:intent.document,custody:intent.custody,createdAt:intent.createdAt,directory:intent.directory};
    if(complete) {
      value.source=await model().applicationInputSetInspect({setId:value.setId});
      need(value.source.phase==='READY'&&same(value.source.manifest,intent.document.source.manifest),'APPLICATION_RESULT_SOURCE_CHANGED');
    }
    return value;
  }
  async function requestStatus(where,requestId,readOne) {
    operationId(requestId);const base=join(where,requestId);
    try {await initializationDirectory(base);}
    catch(error) {if(error.code==='ENOENT')return {requestId,phase:'NOT_FOUND'};throw error;}
    const intent=await record(root,relative(root,join(base,'intent.json')),true,4*1024*1024);
    if(intent===null) {
      need(!await record(root,relative(root,join(base,'complete.json')),true,4*1024*1024),'APPLICATION_RESULT_INCOMPLETE_RECORD');
      return {requestId,phase:'NOT_FOUND'};
    }
    return readOne(requestId);
  }
  async function list(where,readOne) {
    try{await initializationDirectory(where);}catch(error){if(error.code==='ENOENT')return [];throw error;}
    const found=[];
    for(const name of await readdir(where))if(UUID.test(name)&&await readJSON(join(where,name,'intent.json'),true))
      found.push(await readOne(name));
    return found;
  }
  async function readHandoff(sourceRoot) {
    await initializationDirectory(sourceRoot);
    need(same((await readdir(sourceRoot)).sort(),['complete.json','custody.json','files','result-set.json']),
      'APPLICATION_RESULT_HANDOFF_MEMBERS_CHANGED');
    need(same((await readdir(join(sourceRoot,'files'))).sort(),['complete.json','input-set.json','originals']),
      'APPLICATION_RESULT_HANDOFF_MEMBERS_CHANGED');
    const document=validateDocument(await readJSON(join(sourceRoot,'result-set.json')));
    const complete=await readJSON(join(sourceRoot,'complete.json'));
    need(complete?.schema===HANDOFF&&complete.documentSha256===identity(document)&&
      complete.requestId===document.capture.requestId,'APPLICATION_RESULT_HANDOFF_CHANGED');
    const custody=await readJSON(join(sourceRoot,'custody.json'));
    need(custody?.schema===HANDOFF&&custody.documentSha256===identity(document)&&
      custody.workspaceId===custody.inputSetWorkspaceId&&['capture','received'].includes(custody.origin),
      'APPLICATION_RESULT_CUSTODY_CHANGED');
    operationId(custody.workspaceId);operationId(custody.requestId);
    if(custody.origin==='capture')need(custody.workspaceId===document.originWorkspaceId&&
      custody.requestId===document.capture.requestId,'APPLICATION_RESULT_CUSTODY_CHANGED');
    const base=join(sourceRoot,'files'),wrapper=await readJSON(join(base,'input-set.json')),done=await readJSON(join(base,'complete.json'));
    need(wrapper?.schema==='stellar-forge.runtime-application-input-set-export.v1'&&
      wrapper.workspaceId===custody.inputSetWorkspaceId&&wrapper.setId===document.source.setId&&
      same(wrapper.manifest,document.source.manifest)&&done?.setId===document.source.setId&&
      done.manifestSha256===hash(json(wrapper)),'APPLICATION_RESULT_HANDOFF_CHANGED');
    const source=await readApplicationInputSetDirectory({directory:join(base,'originals'),name:document.source.manifest.name});
    need(same(source.manifest,document.source.manifest),'APPLICATION_RESULT_HANDOFF_CHANGED');
    return {document,complete,source,wrapper,custody};
  }
  return {
    async applicationResultSetsState(input={}) {
      fields(input,['applicationId','offset','limit']);await live();if(input.applicationId)recordId(input.applicationId);
      const offset=input.offset??0,limit=input.limit??20;
      need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'APPLICATION_RESULT_PAGE_INVALID');
      const items=(await list(requests,read)).filter(row=>!input.applicationId||row.intent.review.applicationId===input.applicationId);
      items.sort((a,b)=>b.intent.createdAt.localeCompare(a.intent.createdAt)||a.requestId.localeCompare(b.requestId));
      const received=await list(imports,imported);
      received.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.requestId.localeCompare(b.requestId));
      return {workspaceId,offset,limit,total:items.length,
        items:items.slice(offset,offset+limit).map(row=>({requestId:row.requestId,phase:row.phase,
          setId:row.setId,applicationId:row.intent.review.applicationId,operationId:row.intent.review.operationId,
          name:row.intent.review.name,createdAt:row.intent.createdAt,files:row.intent.review.manifest.files.length,
          bytes:row.intent.review.manifest.files.reduce((sum,file)=>sum+file.bytes,0)})),
        received:{total:received.length,items:received.slice(offset,offset+limit).map(row=>({requestId:row.requestId,
          phase:row.phase,setId:row.setId,name:row.origin.source.manifest.name,
          originWorkspaceId:row.origin.originWorkspaceId,createdAt:row.createdAt}))}};
    },
    async applicationResultSetReview(input) {
      fields(input,['applicationId','operationId','directory','name','actor','note']);await live();return buildReview(input);
    },
    async applicationResultSetRead(input) {
      fields(input,['requestId']);await live();return requestStatus(requests,input.requestId,read);
    },
    async applicationResultSetReceived(input) {
      fields(input,['requestId']);await live();return requestStatus(imports,input.requestId,imported);
    },
    async applicationResultSetCapture(input) {
      fields(input,['requestId','review']);operationId(input.requestId);validateApplicationResultReview(input.review);
      need(input.review.workspaceId===workspaceId,'APPLICATION_RESULT_WORKSPACE_CHANGED');
      return mutate(async()=>{
        await initializationDirectory(requests,{create:true});const base=join(requests,input.requestId);
        await initializationDirectory(base,{create:true});
        let intent=await readJSON(join(base,'intent.json'),true);
        if(intent) {
          validateCapture(intent);need(same(intent.review,input.review),'APPLICATION_RESULT_REQUEST_REUSED',undefined,409);
          const saved=await read(input.requestId);if(saved.complete)return saved;
        } else {
          need(same(await buildReview(input.review),input.review),'APPLICATION_RESULT_REVIEW_STALE',
            'The selected files or original run observation changed. Keep this request and review the current source separately.',409);
          intent=await retainInitializationRecord(join(base,'intent.json'),{
            schema:CAPTURE,workspaceId,requestId:input.requestId,review:input.review,createdAt:new Date().toISOString()
          },{resume:true,ignore:['createdAt']});
        }
        // The observed original run is now frozen. Its later state may advance;
        // resumption still uses this exact request and the complete selected bytes.
        const captured=await completedOriginal(intent.review)??await retainApplicationInputSetDirectory(model(),{
          directory:intent.review.directory,name:intent.review.name,expectedManifest:intent.review.manifest});
        need(captured.setId===intent.review.setId,'APPLICATION_RESULT_SOURCE_CHANGED');
        await retainInitializationRecord(join(base,'complete.json'),{
          requestId:input.requestId,intentSha256:identity(intent),setId:captured.setId},{resume:true});
        return read(input.requestId);
      });
    },
    async applicationResultSetExport(input) {
      fields(input,['requestId','directory','origin']);operationId(input.requestId);
      const output=absolute(input.directory),origin=input.origin??'capture';
      need(['capture','received'].includes(origin),'APPLICATION_RESULT_EXPORT_ORIGIN_INVALID');
      return mutate(async()=>{
        let document;
        if(origin==='received') {
          const saved=await imported(input.requestId);need(saved.phase==='RECEIVED','APPLICATION_RESULT_INCOMPLETE',undefined,409);
          document=saved.origin;
        } else {
          const saved=await read(input.requestId);need(saved.complete,'APPLICATION_RESULT_INCOMPLETE',undefined,409);
          document={schema:HANDOFF,originWorkspaceId:workspaceId,capture:saved.intent,completion:saved.complete,
            source:{path:'files',setId:saved.setId,manifest:saved.intent.review.manifest}};
        }
        for(const name of ['application-inputs','application-input-sets','application-result-sets'])
          need(!inside(join(root,name),output)&&!inside(output,join(root,name)),'APPLICATION_RESULT_EXPORT_OVERLAP');
        await initializationDirectory(output,{create:true});
        const previous=await readJSON(join(output,'result-set.json'),true);
        if(!previous)need((await readdir(output)).length===0,'APPLICATION_RESULT_EXPORT_NOT_EMPTY');
        await retainInitializationRecord(join(output,'result-set.json'),document,{resume:true});
        // Received handoffs retain their original source workspace in the export wrapper.
        // The local original engine exports the exact same bytes; its wrapper is
        // recorded separately with current custody below, never rewritten.
        const result=await model().applicationInputSetExport({setId:document.source.setId,directory:join(output,'files')});
        await retainInitializationRecord(join(output,'custody.json'),{
          schema:HANDOFF,workspaceId,documentSha256:identity(document),
          inputSetWorkspaceId:workspaceId,origin,requestId:input.requestId},{resume:true});
        await retainInitializationRecord(join(output,'complete.json'),{
          schema:HANDOFF,documentSha256:identity(document),requestId:document.capture.requestId},{resume:true});
        return {directory:output,documentSha256:identity(document),document,files:result};
      });
    },
    async applicationResultSetReceive(input) {
      fields(input,['requestId','directory']);operationId(input.requestId);const sourceRoot=absolute(input.directory);
      return mutate(async()=>{
        need(!inside(sourceRoot,directory)&&!inside(directory,sourceRoot),'APPLICATION_RESULT_RECEIVE_OVERLAP');
        await initializationDirectory(imports,{create:true});const base=join(imports,input.requestId);
        await initializationDirectory(base,{create:true});
        const prior=await readJSON(join(base,'intent.json'),true);
        if(prior) {
          need(prior.directory===sourceRoot,'APPLICATION_RESULT_RECEIVE_REQUEST_REUSED',undefined,409);
          const saved=await imported(input.requestId);if(saved.phase==='RECEIVED')return saved;
        }
        const supplied=await readHandoff(sourceRoot),document=supplied.document;
        if(prior)need(same(prior.document,document),'APPLICATION_RESULT_RECEIVE_REQUEST_REUSED',undefined,409);
        const intent=await retainInitializationRecord(join(base,'intent.json'),{
          schema:HANDOFF,workspaceId,requestId:input.requestId,directory:sourceRoot,document,documentSha256:identity(document),custody:supplied.custody,
          createdAt:new Date().toISOString()},{resume:true,ignore:['createdAt']});
        const captured=await retainApplicationInputSetDirectory(model(),{directory:supplied.source.directory,
          name:document.source.manifest.name,expectedManifest:document.source.manifest});
        need(captured.setId===document.source.setId,'APPLICATION_RESULT_HANDOFF_CHANGED');
        const after=await readHandoff(sourceRoot);
        need(same(after.document,document)&&same(after.complete,supplied.complete)&&same(after.custody,supplied.custody),'APPLICATION_RESULT_HANDOFF_CHANGED');
        await retainInitializationRecord(join(base,'complete.json'),{
          requestId:input.requestId,intentSha256:identity(intent),setId:captured.setId},{resume:true});
        return imported(input.requestId);
      });
    }
  };
}
