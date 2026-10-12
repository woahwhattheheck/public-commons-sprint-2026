#!/usr/bin/env node
// MIT. Retain one reviewed protocol request and continue its original source import.
import {parseArgs,isDeepStrictEqual} from 'node:util';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ResearchWorkspaceClient} from './workspace-client.mjs';
import {readResearchHostFile} from './workspace-files.mjs';
import {inspectStudyProtocolBundle} from './study-protocol-inspection.mjs';
import {inspectStudyProtocolReceiveRequest,STUDY_PROTOCOL_RECEIVE_REQUEST} from './study-protocol-client.mjs';
import {SOURCE_BUNDLE_LIMIT} from './source-bundles.mjs';
import {privateDirectory,writeBytes,readBytes,exists,parseJson,jsonBytes,digest,need,object} from '../node/store.mjs';

export const STUDY_PROTOCOL_PREPARED='sf88-study-protocol-prepared/v1';
const RECEIVED='sf88-study-protocol-received/v1';
const CONTROL_LIMIT=SOURCE_BUNDLE_LIMIT*2+2*1024*1024;
const same=(a,b,code)=>need(isDeepStrictEqual(a,b),code);
const identity=request=>({requestId:request.requestId,requestSha256:digest(jsonBytes(request)),
  workspaceId:request.workspaceId,dossierId:request.dossierId,questionId:request.questionId,
  bundleSha256:request.bundleSha256,bundleBytes:request.bundleBytes});
const descriptor=(file,raw)=>({file,bytes:raw.length,sha256:digest(raw)});
async function retain(file,raw){
  await privateDirectory(dirname(file));
  if(await exists(file)){
    const saved=await readBytes(file,Math.max(raw.length,1));
    need(saved.equals(raw),'PROTOCOL_REVIEW_FILE_CHANGED');
    return descriptor(file,saved);
  }
  try{await writeBytes(file,raw,{exclusive:true});}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    const saved=await readBytes(file,Math.max(raw.length,1));
    need(saved.equals(raw),'PROTOCOL_REVIEW_FILE_CHANGED');
  }
  const saved=await readBytes(file,Math.max(raw.length,1));
  need(saved.equals(raw),'PROTOCOL_REVIEW_FILE_CHANGED');
  return descriptor(file,saved);
}
function selectedReview(value){
  const request=value?.schema===STUDY_PROTOCOL_PREPARED?value.request:value;
  const inspected=inspectStudyProtocolReceiveRequest(request);
  if(value?.schema===STUDY_PROTOCOL_PREPARED){
    same(value.inspection,inspected.inspection,'PROTOCOL_PREPARED_INSPECTION_CHANGED');
    if(value.preview!==null){
      const preview=value.preview;
      need(object(preview)&&preview.dossierId===request.dossierId&&preview.questionId===request.questionId&&
        preview.bundleSha256===request.bundleSha256&&preview.bundleBytes===request.bundleBytes&&
        preview.expectedRevision===request.expectedRevision,'PROTOCOL_PREPARED_PREVIEW_CHANGED');
      same(preview.sources,inspected.inspection.sourceBundle.sources,'PROTOCOL_PREPARED_PREVIEW_CHANGED');
      same(preview.findings,inspected.inspection.sourceBundle.findings,'PROTOCOL_PREPARED_PREVIEW_CHANGED');
    }
  }
  return {schema:STUDY_PROTOCOL_PREPARED,request:structuredClone(request),inspection:inspected.inspection,
    preview:value?.schema===STUDY_PROTOCOL_PREPARED?structuredClone(value.preview):null};
}
async function readReview(file){
  const raw=await readResearchHostFile(resolve(file),CONTROL_LIMIT);
  return {raw,review:selectedReview(parseJson(raw))};
}
async function retainReview(directory,review){
  const file=join(directory,'REVIEW.json');
  if(await exists(file)){
    const saved=await readReview(file);
    same(saved.review.request,review.request,'PROTOCOL_ORIGINAL_REVIEW_REQUEST_CHANGED');
    same(saved.review.inspection,review.inspection,'PROTOCOL_ORIGINAL_REVIEW_SOURCE_CHANGED');
    return {review:saved.review,source:descriptor(file,saved.raw)};
  }
  await retain(file,jsonBytes(review));
  const saved=await readReview(file);
  same(saved.review.request,review.request,'PROTOCOL_ORIGINAL_REVIEW_REQUEST_CHANGED');
  return {review:saved.review,source:descriptor(file,saved.raw)};
}
function receivedSelection(value,request){
  need(object(value)&&value.schema===RECEIVED,'PROTOCOL_ORIGINAL_RECEIVED_RESULT_REQUIRED');
  same(value.selection,identity(request),'PROTOCOL_RECEIVED_REQUEST_CHANGED');
  const result=value.result;
  need(object(result)&&result.id===request.dossierId&&Number.isSafeInteger(result.revision)&&
    result.revision>=request.expectedRevision&&Array.isArray(result.editions)&&
    result.questions?.some(q=>q.id===request.questionId),'PROTOCOL_RECEIVED_RESULT_CHANGED');
  const editions=result.editions.filter(edition=>edition.questionId===request.questionId&&
    edition.origin?.mode==='LOCAL_SOURCE_BUNDLE'&&edition.raw?.sha256===request.bundleSha256);
  need(editions.length===1&&editions[0].raw.bytes===request.bundleBytes,'PROTOCOL_RECEIVED_SOURCE_CHANGED');
  return editions[0];
}
const summary=(review,source)=>({schema:STUDY_PROTOCOL_PREPARED,review:source,
  selection:identity(review.request),inspection:review.inspection,preview:review.preview});
function options(values,expectedWorkspaceId){
  need(typeof values.connection==='string','PROTOCOL_ORIGINAL_CONNECTION_REQUIRED');
  if(values['workspace-id'])need(values['workspace-id']===expectedWorkspaceId,'PROTOCOL_WORKSPACE_CHANGED');
  return {connectionFile:resolve(values.connection),expectedWorkspaceId};
}
export async function runStudyProtocolReview(argv){
  const {values,positionals}=parseArgs({args:argv,allowPositionals:true,strict:true,options:{
    source:{type:'string'},sha256:{type:'string'},review:{type:'string'},directory:{type:'string'},
    connection:{type:'string'},'workspace-id':{type:'string'},dossier:{type:'string'},
    question:{type:'string'},out:{type:'string'},help:{type:'boolean'}
  }});
  if(values.help||!positionals.length)return {
    commands:{
      inspect:'inspect --source ABS_SOURCE_BUNDLE [--sha256 SHA256] [--out ABS_INSPECTION_JSON]',
      prepare:'prepare --source ABS_SOURCE_BUNDLE --connection ABS_CONNECTION --workspace-id ID --dossier ID --question ID --directory ABS_REVIEW',
      reconcile:'reconcile --review ABS_REVIEW_JSON --connection ABS_CONNECTION [--workspace-id ID] [--out ABS_STATE_JSON]',
      receive:'receive --review ABS_REVIEW_JSON --connection ABS_CONNECTION --directory ABS_REVIEW [--workspace-id ID]'
    },
    originalCapture:'starforge research-study-protocol capture --study-file ABS_REGISTRY --directory ABS_CAPTURE --operation ORIGINAL_OPERATION',
    completeHandover:'Use the same original research-study-protocol receive operation and complete current --engine-source selection; see STUDY-PROTOCOL-OPERATOR.md.',
    recovery:'REVIEW.json is immutable and contains the full source/request. Reconcile or receive it again without editing the request or original expected revision.'
  };
  need(positionals.length===1,'PROTOCOL_REVIEW_COMMAND_REQUIRED');
  const command=positionals[0];
  need(['inspect','prepare','reconcile','receive'].includes(command),'PROTOCOL_REVIEW_COMMAND_INVALID');
  if(command==='inspect'||command==='prepare'){
    need(typeof values.source==='string','PROTOCOL_ORIGINAL_SOURCE_REQUIRED');
    const raw=await readResearchHostFile(resolve(values.source),SOURCE_BUNDLE_LIMIT,
      values.sha256?{sha256:values.sha256}:{});
    const inspection=inspectStudyProtocolBundle(raw);
    if(command==='inspect'){
      if(values.out)return {inspection,output:await retain(resolve(values.out),jsonBytes(inspection))};
      return inspection;
    }
    need(typeof values.directory==='string'&&typeof values.dossier==='string'&&typeof values.question==='string'&&
      /^research_[a-f0-9]{64}$/.test(values['workspace-id']??''),'PROTOCOL_ORIGINAL_QUESTION_SELECTION_REQUIRED');
    const directory=await privateDirectory(resolve(values.directory));
    const client=new ResearchWorkspaceClient(options(values,values['workspace-id']));
    try{
      await client.status();
      const file=join(directory,'REVIEW.json');
      if(await exists(file)){
        const {raw:saved,review}=await readReview(file);
        same({workspaceId:review.request.workspaceId,dossierId:review.request.dossierId,questionId:review.request.questionId,
          bundleSha256:review.request.bundleSha256,bundleBytes:review.request.bundleBytes},
        {workspaceId:values['workspace-id'],dossierId:values.dossier,questionId:values.question,
          bundleSha256:inspection.bundleSha256,bundleBytes:inspection.bundleBytes},'PROTOCOL_ORIGINAL_REVIEW_SELECTION_CHANGED');
        return summary(review,descriptor(file,saved));
      }
      const prepared=await client.studyProtocol().prepare({dossierId:values.dossier,questionId:values.question,bytes:raw});
      const review=selectedReview({schema:STUDY_PROTOCOL_PREPARED,...prepared});
      const retained=await retainReview(directory,review);
      return summary(retained.review,retained.source);
    }finally{await client.close();}
  }
  need(typeof values.review==='string','PROTOCOL_ORIGINAL_REVIEW_REQUIRED');
  const original=await readReview(values.review),request=original.review.request;
  const client=new ResearchWorkspaceClient(options(values,request.workspaceId));
  try{
    const protocol=client.studyProtocol();
    if(command==='reconcile'){
      const state=await protocol.reconcile(request);
      if(values.out)return {state,output:await retain(resolve(values.out),jsonBytes(state))};
      return state;
    }
    need(typeof values.directory==='string','PROTOCOL_REVIEW_DIRECTORY_REQUIRED');
    const directory=await privateDirectory(resolve(values.directory));
    const retained=await retainReview(directory,original.review),file=join(directory,'RECEIVED.json');
    if(await exists(file)){
      const raw=await readBytes(file,16*1024*1024),saved=parseJson(raw);
      const edition=receivedSelection(saved,request);
      const state=await protocol.reconcile(request);
      need(state.state==='ALREADY_RECEIVED'&&state.currentRevision>=saved.result.revision,
        'PROTOCOL_ORIGINAL_RECEIVED_STATE_CHANGED');
      const pinned=await client.metadata(request.dossierId,{revision:saved.result.revision});
      const actual=pinned.editions.find(row=>row.id===edition.id);
      same(actual,edition,'PROTOCOL_ORIGINAL_RECEIVED_EDITION_CHANGED');
      return {schema:RECEIVED,reused:true,review:retained.source,receipt:descriptor(file,raw),
        selection:saved.selection,revision:saved.result.revision,editionId:edition.id,state};
    }
    // The complete request is durable before this one original source mutation.
    const result=await protocol.receive(request);
    const saved={schema:RECEIVED,selection:identity(request),result};
    const edition=receivedSelection(saved,request),receipt=await retain(file,jsonBytes(saved));
    return {schema:RECEIVED,reused:false,review:retained.source,receipt,selection:saved.selection,
      revision:result.revision,editionId:edition.id};
  }finally{await client.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.stdout.write(JSON.stringify(await runStudyProtocolReview(process.argv.slice(2)),null,2)+'\n');}
  catch(error){process.stderr.write(JSON.stringify({error:error.code??error.message,
    ...(Number.isInteger(error.status)?{status:error.status}:{}),
    recovery:'Preserve the original REVIEW.json and source. Reconcile that request before changing the selected operation.'})+'\n');process.exitCode=1;}
}
