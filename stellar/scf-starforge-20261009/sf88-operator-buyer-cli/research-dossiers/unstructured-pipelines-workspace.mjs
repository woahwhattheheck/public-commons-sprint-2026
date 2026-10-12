// MIT. Managed Pipelines operations and explicit output receiving in the original research workspace.
import { join, resolve, isAbsolute } from 'node:path';
import { unlink } from 'node:fs/promises';
import {
  privateDirectory, readJson, readBytes, writeJson, writeBytes, jsonBytes,
  digest, need, object, now,
} from '../node/store.mjs';
import { withPrivateLock } from '../../sf30-seller-sdk/routescan/quota.mjs';
import { openPipelineOperations } from './unstructured-pipelines/operations.mjs';
import {
  createPipelineResearchEdition, verifyPipelineResearchEdition, pipelineResearchOrigin,
  PIPELINE_EDITION_MODE, PIPELINE_SOURCE_REFERENCE,
} from './unstructured-pipelines/edition.mjs';

export const PIPELINE_UPLOAD_BYTES = 32 * 1024 * 1024;
export const PIPELINE_UPLOAD_BODY_BYTES = Math.ceil(PIPELINE_UPLOAD_BYTES / 3) * 4 + 1048576;
const copy = value => structuredClone(value);
const HEX = /^[a-f0-9]{64}$/;
const OP = /^up_[a-f0-9]{64}$/;
const OUT = /^out_[a-f0-9]{64}$/;
const INPUT = /^in_[a-f0-9]{64}$/;
const EDITION = /^e_[a-f0-9]{64}$/;
const RECEIVING = 'stellar-forge.unstructured-pipelines-receiving.v1';
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value) ?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
const canonicalBytes = value => Buffer.from(JSON.stringify(canonical(value)));
const same = (a,b) => canonicalBytes(a).equals(canonicalBytes(b));
const clean = (value, maximum=512) => typeof value==='string' && value.trim().length>0 &&
  Buffer.byteLength(value)<=maximum && !/[\0-\x1f\x7f]/.test(value);
function fields(value, allowed, code) {
  need(object(value) && Object.keys(value).every(key=>allowed.includes(key)),code);
  return value;
}
function revision(value) {
  need(Number.isSafeInteger(value)&&value>=0,'EXPECTED_REVISION_REQUIRED');return value;
}
function requestId(value) {need(clean(value,256),'PIPELINE_REQUEST_ID_REQUIRED');return value;}
function operationId(value) {need(OP.test(value??''),'PIPELINE_OPERATION_ID_INVALID');return value;}
function selected(value) {
  fields(value,['operationId','outputId','editionId'],'PIPELINE_OUTPUT_SELECTION_INVALID');
  need((typeof value.editionId==='string') !== (typeof value.operationId==='string'),
    'PIPELINE_ONE_OUTPUT_SELECTION_REQUIRED');
  if(value.editionId!==undefined)need(EDITION.test(value.editionId)&&value.outputId===undefined,'PIPELINE_EDITION_ID_INVALID');
  else need(OP.test(value.operationId)&&OUT.test(value.outputId??''),'PIPELINE_OUTPUT_SELECTION_INVALID');
  return copy(value);
}
function summary(view) {
  const p=view.plan, v=view.operation;
  return {
    plan:{id:p.id,sha256:p.sha256,preparedAt:p.preparedAt,payload:{
      request:copy(p.payload.request),source:copy(p.payload.source),profile:copy(p.payload.profile),
      inputs:p.payload.inputs.map(input=>Object.fromEntries(
        ['id','index','filename','contentType','bytes','sha256'].map(key=>[key,input[key]]))),
      limits:copy(p.payload.limits),
    }},
    operation:{id:v.id,revision:v.revision,phase:v.phase,providerJobId:v.providerJobId,
      providerStatus:v.job?.status??null,workflowId:v.job?.workflow_id??null,
      outputs:(v.outputs??[]).map(output=>Object.fromEntries(
        ['id','fileId','nodeId','bytes','sha256','contentType','receivedAt','receiptId'].map(key=>[key,output[key]??null]))),
      cancel:copy(v.cancel),lastError:copy(v.lastError),updatedAt:v.updatedAt,
      jobObservedAt:v.jobObservedAt??null,detailsObservedAt:v.detailsObservedAt??null},
    outputOptions:copy(view.outputOptions??[]),running:Boolean(view.running),interrupted:Boolean(view.interrupted),
    sourceMatches:Boolean(view.sourceMatches),profileMatches:Boolean(view.profileMatches),
    ...(view.replayed===undefined?{}:{replayed:view.replayed}),
    ...(view.actionResult===undefined?{}:{actionResult:copy(view.actionResult)}),
  };
}
function filename(value,fallback) {
  const name=typeof value==='string'?value.replace(/[^A-Za-z0-9._-]/g,'_').slice(0,150):'';
  return /^[A-Za-z0-9]/.test(name)?name:fallback;
}

/** Account, API key reference and all filesystem paths are chosen by the local launcher. */
export async function openSavedPipelineSource(configPath,{env=process.env}={}) {
  need(typeof configPath==='string'&&isAbsolute(configPath)&&resolve(configPath)===configPath,
    'PIPELINE_SOURCE_ABSOLUTE_PATH_REQUIRED');
  const value=fields(await readJson(configPath,1048576),
    ['schema','workspaceId','directory','configurationFile'],'PIPELINE_SOURCE_CONFIGURATION_INVALID');
  need(value.schema==='stellar-forge.unstructured-pipelines-source.v1'&&clean(value.workspaceId,128),
    'PIPELINE_SOURCE_IDENTITY_REQUIRED');
  for(const path of [value.directory,value.configurationFile])
    need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'PIPELINE_SOURCE_ABSOLUTE_PATH_REQUIRED');
  const configuration=await readJson(value.configurationFile,1048576);
  const operations=await openPipelineOperations({directory:value.directory,configuration,env});
  return {operations,workspaceId:value.workspaceId,directory:value.directory};
}

export async function openUnstructuredPipelineWorkspace({dossiers,source=null}={}) {
  need(dossiers&&['get','receive','readRetainedEdition'].every(key=>typeof dossiers[key]==='function'),
    'PIPELINE_ORIGINAL_DOSSIER_STORE_REQUIRED');
  need(source===null||object(source)&&object(source.operations)&&clean(source.workspaceId,128),
    'PIPELINE_SOURCE_INVALID');
  const operations=source?.operations??null;
  if(operations)for(const method of ['source','prepare','list','inspect','readInput','submit','refresh','cancel',
    'listProviderJobs','reconcile','retainOutput','readOutput','close'])
    need(typeof operations[method]==='function','PIPELINE_ORIGINAL_OPERATIONS_API_REQUIRED');
  const directory=operations?await privateDirectory(source.directory):null;
  const uploads=directory?await privateDirectory(join(directory,'operator-inputs')):null;
  const receiving=directory?await privateDirectory(join(directory,'research-receiving')):null;
  const metadata=(id,options)=>typeof dossiers.getMetadata==='function'?dossiers.getMetadata(id,options):dossiers.get(id,options);
  let cached=null,closed=false;
  const clear=()=>{cached=null;};
  async function configured() {
    const current=operations?await operations.source():null;
    return {configured:operations!==null,workspaceId:source?.workspaceId??null,source:current,
      uploadLimitBytes:PIPELINE_UPLOAD_BYTES};
  }
  async function owned(dossierId,id) {
    need(operations&&!closed,'PIPELINE_SOURCE_NOT_CONFIGURED');
    const view=await operations.inspect(operationId(id));
    need(view.plan.payload.request.context?.dossierId===dossierId,'PIPELINE_OPERATION_DOSSIER_MISMATCH');
    return view;
  }
  async function list(dossierId,{after='',limit=30}={}) {
    need(after===''||OP.test(after),'PIPELINE_OPERATION_CURSOR_INVALID');
    need(Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'PIPELINE_OPERATION_PAGE_INVALID');
    const before=await metadata(dossierId);
    const all=operations?(await operations.list()).filter(view=>view.plan.payload.request.context?.dossierId===dossierId):[];
    const start=after===''?0:all.findIndex(view=>view.plan.id===after)+1;
    need(after===''||start>0,'PIPELINE_OPERATION_CURSOR_CHANGED');
    const rows=all.slice(start,start+limit);
    return {...await configured(),operations:rows.map(summary),
      nextAfter:start+limit<all.length?rows.at(-1).plan.id:null,revision:before.revision,
      editions:before.editions.filter(row=>row.mode==='retained'&&row.origin?.mode===PIPELINE_EDITION_MODE)
        .map(row=>({id:row.id,label:row.label,questionId:row.questionId,createdAt:row.createdAt,
          origin:copy(row.origin),sha256:row.raw.sha256,bytes:row.raw.bytes}))};
  }

  async function prepare(dossierId,input) {
    need(operations&&!closed,'PIPELINE_SOURCE_NOT_CONFIGURED');
    fields(input,['requestId','profileId','questionId','label','expectedRevision','inputs'],'PIPELINE_PREPARATION_FIELDS_INVALID');
    requestId(input.requestId);revision(input.expectedRevision);
    need(clean(input.profileId,128)&&clean(input.questionId,160)&&clean(input.label,240),'PIPELINE_PREPARATION_SELECTION_REQUIRED');
    const sourceView=await operations.source(), limits=sourceView.limits;
    need(Array.isArray(input.inputs)&&input.inputs.length>0&&
      input.inputs.length<=Math.min(32,limits.maxInputs),'PIPELINE_INPUT_SELECTION_REQUIRED');
    let total=0;
    const files=input.inputs.map((file,index)=>{
      fields(file,['filename','contentType','base64'],'PIPELINE_UPLOAD_FIELDS_INVALID');
      need(clean(file.filename,1024)&&!/[\\/]/.test(file.filename)&&
        clean(file.contentType,256)&&typeof file.base64==='string','PIPELINE_UPLOAD_INVALID');
      need(file.base64.length<=Math.ceil(Math.min(limits.maxInputBytes,PIPELINE_UPLOAD_BYTES)/3)*4,
        'PIPELINE_UPLOAD_TOO_LARGE');
      const bytes=Buffer.from(file.base64,'base64');
      need(bytes.toString('base64')===file.base64&&bytes.length<=limits.maxInputBytes,'PIPELINE_UPLOAD_INVALID');
      total+=bytes.length;
      need(total<=Math.min(PIPELINE_UPLOAD_BYTES,limits.maxTotalInputBytes),'PIPELINE_UPLOAD_TOO_LARGE');
      return {filename:file.filename,contentType:file.contentType,index,bytes:bytes.length,
        sha256:digest(bytes),body:bytes,name:String(index+1).padStart(3,'0')+'.input'};
    });
    const matching=(await operations.list()).find(view=>view.plan.payload.request.requestId===input.requestId);
    if(matching) {
      const request=matching.plan.payload.request;
      need(request.profileId===input.profileId&&request.label===input.label&&
        request.context?.dossierId===dossierId&&request.context.questionId===input.questionId&&
        request.context.preparationRevision===input.expectedRevision&&
        matching.plan.payload.inputs.length===files.length&&
        files.every((file,index)=>['filename','contentType','bytes','sha256'].every(key=>
          matching.plan.payload.inputs[index][key]===file[key])),
      'PIPELINE_PREPARATION_REQUEST_CHANGED');
      return {...summary(matching),replayed:true};
    }
    const before=await metadata(dossierId);
    need(before.revision===input.expectedRevision,'REVISION_CONFLICT');
    const question=before.questions.find(row=>row.id===input.questionId);
    need(question,'QUESTION_NOT_FOUND');
    need(sourceView.profiles.some(profile=>profile.id===input.profileId),'PIPELINE_PROFILE_NOT_FOUND');
    const stage=await privateDirectory(join(uploads,digest(Buffer.from(input.requestId))));
    const descriptor={schema:'stellar-forge.pipeline-operator-upload.v1',requestId:input.requestId,
      dossierId,profileId:input.profileId,questionId:input.questionId,label:input.label,
      preparationRevision:input.expectedRevision,
      files:files.map(({body,...value})=>value)};
    return withPrivateLock(stage,'upload.lock',async()=>{
      try {need(same(await readJson(join(stage,'request.json'),1048576),descriptor),'PIPELINE_UPLOAD_REQUEST_CHANGED');}
      catch(error){if(error.code!=='ENOENT')throw error;await writeJson(join(stage,'request.json'),descriptor,{exclusive:true});}
      for(const file of files) {
        const path=join(stage,file.name);
        try {await writeBytes(path,file.body,{exclusive:true});}
        catch(error) {
          if(error.code!=='EEXIST')throw error;
          const original=await readBytes(path,PIPELINE_UPLOAD_BYTES);
          need(original.length===file.bytes&&digest(original)===file.sha256,'PIPELINE_UPLOAD_CHANGED');
        }
      }
      const result=await operations.prepare({
        requestId:input.requestId,profileId:input.profileId,label:input.label,
        context:{dossierId,questionId:question.id,questionText:question.text,
          preparationRevision:input.expectedRevision},
        inputs:files.map(file=>({path:join(stage,file.name),filename:file.filename,
          contentType:file.contentType,sourceRef:'research-dossier:'+dossierId})),
      });
      need(result.plan.payload.request.context?.dossierId===dossierId&&
        result.plan.payload.inputs.length===files.length&&files.every((file,index)=>
          ['filename','contentType','bytes','sha256'].every(key=>result.plan.payload.inputs[index][key]===file[key])),
      'PIPELINE_RETAINED_INPUT_CHANGED');
      // The job owner's verified originals now own these bytes; retain the small upload identity and lease.
      for(const file of files)await unlink(join(stage,file.name)).catch(error=>{if(error.code!=='ENOENT')throw error;});
      clear();return summary(result);
    });
  }
  async function inspect(dossierId,id) {return summary(await owned(dossierId,id));}
  const actionFields={
    submit:['requestId','expectedRevision','expectedPlanSha256'],
    refresh:['requestId','expectedRevision'],
    cancel:['requestId','expectedRevision','reason'],
    reconcile:['requestId','expectedRevision','expectedPlanSha256','providerJobId','reason'],
    retain:['requestId','expectedRevision','fileId','nodeId'],
  };
  async function act(dossierId,id,action,data) {
    need(Object.hasOwn(actionFields,action),'PIPELINE_ACTION_INVALID');
    fields(data,actionFields[action],'PIPELINE_ACTION_FIELDS_INVALID');
    requestId(data.requestId);revision(data.expectedRevision);
    await owned(dossierId,id);
    clear();
    return summary(await operations[action==='retain'?'retainOutput':action](id,copy(data)));
  }
  async function providerJobs(dossierId,id,query={}) {
    await owned(dossierId,id);
    fields(query,['workflowId','status'],'PIPELINE_PROVIDER_LIST_FIELDS_INVALID');
    return operations.listProviderJobs(id,copy(query));
  }
  async function inputFile(dossierId,id,inputId) {
    await owned(dossierId,id);
    need(INPUT.test(inputId??''),'PIPELINE_INPUT_ID_INVALID');
    const original=await operations.readInput(id,inputId);
    return {bytes:original.body,sha256:original.metadata.sha256,
      filename:filename(original.metadata.filename,'pipeline-input.bin'),contentType:'application/octet-stream'};
  }
  async function outputFile(dossierId,id,outputId) {
    await owned(dossierId,id);
    need(OUT.test(outputId??''),'PIPELINE_OUTPUT_ID_INVALID');
    const original=await operations.readOutput(id,outputId);
    return {bytes:original.body,sha256:original.metadata.sha256,
      filename:filename(original.metadata.fileId,'pipeline-output')+'.output',
      contentType:'application/octet-stream'};
  }
  async function capture(dossierId,selection) {
    selection=selected(selection);
    let checked,retained=null;
    if(selection.editionId) {
      const original=await dossiers.readRetainedEdition(dossierId,selection.editionId);
      need(original.edition.origin?.mode===PIPELINE_EDITION_MODE,'PIPELINE_RETAINED_EDITION_REQUIRED');
      checked=verifyPipelineResearchEdition(original.bytes);
      need(checked.sha256===original.edition.raw.sha256,'PIPELINE_RETAINED_EDITION_CHANGED');
      retained={id:original.edition.id,label:original.edition.label,questionId:original.edition.questionId};
    } else {
      const view=await owned(dossierId,selection.operationId);
      const output=await operations.readOutput(selection.operationId,selection.outputId);
      need(output.metadata.id===selection.outputId,'PIPELINE_RETAINED_OUTPUT_CHANGED');
      const edition=createPipelineResearchEdition({view,output:output.metadata,body:output.body,
        workspaceId:source.workspaceId});
      checked=verifyPipelineResearchEdition(edition.bytes);
    }
    cached={dossierId,selection,checked,retained};return cached;
  }
  async function observed(dossierId,selection,expectedEditionSha256) {
    selection=selected(selection);
    need(HEX.test(expectedEditionSha256??''),'PIPELINE_REVIEWED_EDITION_REQUIRED');
    const value=cached?.dossierId===dossierId&&same(cached.selection,selection)?cached:await capture(dossierId,selection);
    need(value.checked.sha256===expectedEditionSha256,'PIPELINE_REVIEWED_EDITION_CHANGED');
    return value;
  }
  async function review(dossierId,selection) {
    const value=await capture(dossierId,selection),checked=value.checked;
    return {selection:copy(value.selection),editionSha256:checked.sha256,editionBytes:checked.bytes.length,
      binding:copy(checked.binding),inputs:copy(checked.inputs),output:copy(checked.output),
      format:checked.format,itemCount:checked.items.length,warnings:copy(checked.value.warnings),retained:value.retained};
  }
  async function elements(dossierId,{selection,expectedEditionSha256,offset=0,limit=25,page='',type='',query=''}={}) {
    need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100&&
      [page,type,query].every(value=>typeof value==='string')&&page.length<=100&&type.length<=200&&query.length<=2000,
    'PIPELINE_ELEMENT_FILTER_INVALID');
    const {checked}=await observed(dossierId,selection,expectedEditionSha256),term=query.toLocaleLowerCase();
    const all=checked.items.map((item,index)=>({position:index+1,item}));
    const filtered=all.filter(({item})=>(page===''||String(item.metadata?.page_number??'')===page)&&
      (type===''||String(item.metadata?.pipeline?.type??'')===type)&&
      (term===''||JSON.stringify(item.content).toLocaleLowerCase().includes(term)));
    return {editionSha256:checked.sha256,total:all.length,filtered:filtered.length,offset,limit,
      items:filtered.slice(offset,offset+limit).map(copy),nextOffset:offset+limit<filtered.length?offset+limit:null};
  }
  async function download(dossierId,{selection,expectedEditionSha256,file}={}) {
    need(['output','edition'].includes(file),'PIPELINE_DOWNLOAD_SELECTION_INVALID');
    const {checked}=await observed(dossierId,selection,expectedEditionSha256);
    return {bytes:file==='edition'?checked.bytes:checked.body,
      filename:filename(checked.output.fileId,'pipeline-output')+(file==='edition'?'.research.json':'.output'),
      contentType:file==='edition'?'application/json; charset=utf-8':'application/octet-stream',
      sha256:file==='edition'?checked.sha256:checked.output.sha256};
  }

  async function receive(dossierId,data) {
    need(operations&&!closed,'PIPELINE_SOURCE_NOT_CONFIGURED');
    fields(data,['requestId','selection','expectedEditionSha256','questionId','label','expectedRevision'],
      'PIPELINE_RECEIVING_FIELDS_INVALID');
    const selection=selected(data.selection);
    need(selection.operationId,'PIPELINE_ORIGINAL_OUTPUT_SELECTION_REQUIRED');
    requestId(data.requestId);revision(data.expectedRevision);
    need(HEX.test(data.expectedEditionSha256??'')&&clean(data.questionId,160)&&clean(data.label,240),
      'PIPELINE_RECEIVING_SELECTION_REQUIRED');
    const request={requestId:data.requestId,dossierId,selection,expectedEditionSha256:data.expectedEditionSha256,
      questionId:data.questionId,label:data.label,expectedRevision:data.expectedRevision};
    const requestSha256=digest(canonicalBytes(request));
    const path=await privateDirectory(join(receiving,digest(Buffer.from(data.requestId))));
    return withPrivateLock(path,'receive.lock',async()=>{
      const recordPath=join(path,'receiving.json');
      let prior=null;
      try {
        prior=await readJson(recordPath,1048576);
        need(prior.schema===RECEIVING&&prior.requestSha256===requestSha256&&same(prior.request,request),
          'PIPELINE_RECEIVING_REQUEST_CHANGED');
      } catch(error){if(error.code!=='ENOENT')throw error;}
      const before=await metadata(dossierId);
      if(prior?.phase==='RECEIVED') {
        need(before.editions.some(row=>row.id===prior.receipt.editionId&&row.raw?.sha256===data.expectedEditionSha256),
          'PIPELINE_RECEIVED_EDITION_MISSING');
        return {receipt:copy(prior.receipt),replayed:true,dossier:await dossiers.get(dossierId)};
      }
      if(prior?.phase==='RECEIVING') {
        const retained=before.editions.find(row=>row.questionId===data.questionId&&
          row.raw?.sha256===data.expectedEditionSha256&&row.origin?.receivingRequestId===data.requestId);
        if(retained) {
          const originalRevision=data.expectedRevision+1;
          const original=before.revision===originalRevision?before:await metadata(dossierId,{revision:originalRevision});
          need(original.editions.some(row=>row.id===retained.id&&
            row.origin?.receivingRequestId===data.requestId),'PIPELINE_RECEIVING_RECONCILIATION_FAILED');
          const receipt={requestId:data.requestId,dossierId,questionId:data.questionId,editionId:retained.id,
            editionSha256:data.expectedEditionSha256,originalRevision:data.expectedRevision,
            revision:originalRevision,duplicate:false,receivedAt:prior.startedAt,reconciled:true};
          await writeJson(recordPath,{...prior,phase:'RECEIVED',receipt});
          clear();return {receipt,replayed:true,dossier:await dossiers.get(dossierId)};
        }
      }
      need(before.revision===data.expectedRevision,'REVISION_CONFLICT');
      need(before.questions.some(row=>row.id===data.questionId),'QUESTION_NOT_FOUND');
      const fresh=await capture(dossierId,selection);
      need(fresh.checked.sha256===data.expectedEditionSha256,'PIPELINE_REVIEWED_EDITION_CHANGED');
      const already=before.editions.find(row=>row.questionId===data.questionId&&
        row.provider==='unstructured-pipelines'&&row.raw?.sha256===data.expectedEditionSha256);
      const base=prior??{schema:RECEIVING,request,requestSha256,phase:'RECEIVING',startedAt:now()};
      if(already) {
        const receipt={requestId:data.requestId,dossierId,questionId:data.questionId,editionId:already.id,
          editionSha256:data.expectedEditionSha256,originalRevision:before.revision,revision:before.revision,
          duplicate:true,receivedAt:base.startedAt};
        await writeJson(recordPath,{...base,phase:'RECEIVED',receipt});
        clear();return {receipt,replayed:false,dossier:await dossiers.get(dossierId)};
      }
      if(!prior)await writeJson(recordPath,base,{exclusive:true});
      const after=await dossiers.receive(dossierId,{
        questionId:data.questionId,label:data.label,provider:'unstructured-pipelines',
        rawBytes:fresh.checked.bytes,sourceReference:PIPELINE_SOURCE_REFERENCE,
        expectedRevision:data.expectedRevision,projection:'metadata',
        origin:{...pipelineResearchOrigin(fresh.checked),receivingRequestId:data.requestId},
      });
      const edition=after.editions.find(row=>row.questionId===data.questionId&&
        row.raw?.sha256===data.expectedEditionSha256&&row.origin?.receivingRequestId===data.requestId);
      need(edition,'PIPELINE_RECEIVED_EDITION_MISSING');
      const receipt={requestId:data.requestId,dossierId,questionId:data.questionId,editionId:edition.id,
        editionSha256:data.expectedEditionSha256,originalRevision:data.expectedRevision,
        revision:after.revision,duplicate:false,receivedAt:base.startedAt};
      await writeJson(recordPath,{...base,phase:'RECEIVED',receipt});
      clear();return {receipt,replayed:false,dossier:await dossiers.get(dossierId)};
    });
  }
  return Object.freeze({
    configured,list,prepare,inspect,act,providerJobs,inputFile,outputFile,review,elements,download,receive,clear,
    async close(){if(closed)return;closed=true;clear();if(operations)await operations.close();},
  });
}
