// MIT. Join the original independently authored appraisal to the original study programme.
import {isAbsolute,resolve,join,relative,sep} from 'node:path';
import {lstat} from 'node:fs/promises';
import {bindRiskOfBiasStudyCase} from './risk-of-bias/study-case.mjs';
import {runRiskOfBiasBrowser} from './risk-of-bias/receiving-browser.mjs';
import {riskOfBiasDigest,riskOfBiasInput} from './risk-of-bias/contracts.mjs';
import {readResearchHostFile} from './workspace-files.mjs';
import {privateDirectory,readJson,writeBytes,jsonBytes,digest,need,parseJson} from '../node/store.mjs';

const SCHEMA='sf88-study-extraction-appraisal-programme/v1',MAX_FILE=256*1024*1024;
const same=(a,b)=>riskOfBiasDigest(a)===riskOfBiasDigest(b);
const SELECTORS=['reviewId','protocolId','assessmentId','assessmentEditionId','draftIds','submissionIds','adjudicationId'];
async function optionalJson(file){
  try{const stat=await lstat(file);need(stat.isFile()&&!stat.isSymbolicLink(),'STUDY_APPRAISAL_FILE_INVALID');
    return await readJson(file,MAX_FILE);}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function immutableJson(file,value){
  const saved=await optionalJson(file);
  if(saved){need(same(saved,value),'STUDY_APPRAISAL_RETAINED_RECORD_CHANGED');return;}
  try{await writeBytes(file,jsonBytes(value),{exclusive:true});}
  catch(error){if(error.code!=='EEXIST')throw error;need(same(await optionalJson(file),value),'STUDY_APPRAISAL_RETAINED_RECORD_CHANGED');}
}
async function retained(descriptor){
  const file=typeof descriptor==='string'?descriptor:descriptor.file??descriptor.path;
  need(typeof file==='string'&&isAbsolute(file)&&resolve(file)===file,'STUDY_APPRAISAL_ABSOLUTE_FILE_REQUIRED');
  const body=await readResearchHostFile(file,MAX_FILE),identity={file,bytes:body.length,sha256:digest(body)};
  if(typeof descriptor==='object')need((descriptor.bytes===undefined||descriptor.bytes===identity.bytes)&&
    (descriptor.sha256===undefined||descriptor.sha256===identity.sha256),'STUDY_APPRAISAL_ORIGINAL_FILE_CHANGED');
  return {body,identity};
}
async function artifact(directory,descriptor){
  const value=await retained(descriptor),path=relative(directory,value.identity.file);
  need(path&&!isAbsolute(path)&&!path.split(sep).some(v=>!v||v==='.'||v==='..')&&
    !path.split(sep).some(v=>/^(?:browser-profile|.*connection.*\.json|workspace)$/.test(v)),
    'STUDY_APPRAISAL_DELIVERY_FILE_REQUIRED');
  return value.identity;
}
function selectionOf(result){
  const selection=Object.fromEntries(SELECTORS.map(key=>[key,structuredClone(result[key])]));
  need(['reviewId','protocolId','assessmentId','assessmentEditionId','adjudicationId'].every(key=>
    typeof selection[key]==='string'&&selection[key].length>0)&&
    Array.isArray(selection.draftIds)&&selection.draftIds.length===2&&
    Array.isArray(selection.submissionIds)&&selection.submissionIds.length===2&&
    new Set(selection.draftIds).size===2&&new Set(selection.submissionIds).size===2,
    'STUDY_APPRAISAL_COMPLETE_SELECTION_REQUIRED');
  return selection;
}
async function originalRequests(result){
  need(Array.isArray(result.requestFiles)&&result.requestFiles.length===7,'STUDY_APPRAISAL_SEVEN_UI_REQUESTS_REQUIRED');
  const values=[];
  for(const entry of result.requestFiles){
    need(entry.request&&entry.response&&entry.envelopePath,'STUDY_APPRAISAL_ORIGINAL_UI_FILES_REQUIRED');
    const request=await retained(entry.request),response=await retained(entry.response),envelope=await retained(entry.envelopePath);
    const input=parseJson(request.body),accepted=parseJson(response.body),originalEnvelope=parseJson(envelope.body);
    const normalized=riskOfBiasInput(input);
    need(input.requestId===entry.requestId&&input.action===entry.action&&
      originalEnvelope.dossierId===result.dossierId&&originalEnvelope.workspaceId===result.workspace.workspaceId&&
      same(originalEnvelope.payload,input)&&accepted.dossier?.id===result.dossierId&&
      accepted.operation?.requestId===entry.requestId&&same(accepted.operation.request,normalized),
      'STUDY_APPRAISAL_ORIGINAL_UI_REQUEST_CHANGED');
    values.push({stage:entry.stage,requestId:entry.requestId,action:entry.action,
      request:request.identity,response:response.identity,envelope:envelope.identity,
      operationId:accepted.operation.id,operationSha256:accepted.operation.sha256,
      originalRevision:accepted.operation.originalRevision,revision:accepted.operation.revision});
  }
  const actual=values.map(value=>value.action).sort(),expected=['create-review','create-assessment','save-draft',
    'save-draft','submit-review','submit-review','adjudicate'].sort();
  need(same(actual,expected),'STUDY_APPRAISAL_ORIGINAL_JOURNEY_CHANGED');return values;
}
async function recoverOriginalRequests({store,dossierId,requests,directory,signal}){
  const before=(await store.getMetadata(dossierId)).revision,records=[];
  for(const entry of requests){
    signal?.throwIfAborted();
    const request=await retained(entry.request),response=await retained(entry.response);
    const input=parseJson(request.body),accepted=parseJson(response.body),canonical=riskOfBiasInput(input);
    need(canonical.requestId===entry.requestId&&accepted.operation?.id===entry.operationId&&
      accepted.operation?.sha256===entry.operationSha256&&same(accepted.operation.request,canonical),
      'STUDY_APPRAISAL_ORIGINAL_REQUEST_IDENTITY_CHANGED');
    const recovered=await store.reviewRiskOfBias(dossierId,{...canonical,projection:'metadata'});
    need(recovered.duplicate===true&&recovered.dossier?.id===dossierId&&
      same(recovered.operation,accepted.operation),'STUDY_APPRAISAL_ORIGINAL_REQUEST_RECOVERY_CHANGED');
    records.push({stage:entry.stage,requestId:entry.requestId,operationId:entry.operationId,
      operationSha256:entry.operationSha256,originalRevision:entry.originalRevision,revision:entry.revision,
      originalRequestSha256:request.identity.sha256,duplicate:recovered.duplicate});
  }
  const revision=(await store.getMetadata(dossierId)).revision;
  need(revision===before,'STUDY_APPRAISAL_REPLAY_CHANGED_DOSSIER');
  const result={schema:'sf88-study-appraisal-original-replays/v1',dossierId,revision,records};
  await immutableJson(join(directory,'original-request-recovery.json'),result);return result;
}
export async function runStudyExtractionAppraisal({
  store,url,expectedWorkspaceId,seed,receivedSelection,inputs,runDirectory,
  playwrightModule,chromiumExecutable,signal,mode='author',authored
}){
  signal?.throwIfAborted();
  need(['author','inspect'].includes(mode)&&store&&typeof store.riskOfBias==='function'&&
    typeof store.reviewRiskOfBias==='function','STUDY_APPRAISAL_ORIGINAL_STORE_REQUIRED');
  for(const value of [runDirectory,playwrightModule,chromiumExecutable])
    need(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value,'STUDY_APPRAISAL_ABSOLUTE_RUNTIME_REQUIRED');
  need(typeof expectedWorkspaceId==='string'&&expectedWorkspaceId.length>0&&
    seed?.dossierId&&seed.questionId&&seed.studyId&&seed.reviewId&&seed.occurrenceId&&
    Number.isSafeInteger(receivedSelection?.currentRevision),'STUDY_APPRAISAL_ORIGINAL_BINDING_REQUIRED');
  const directory=await privateDirectory(runDirectory),dossierId=seed.dossierId;
  const binding={schema:SCHEMA,mode,dossierId,workspaceId:expectedWorkspaceId,
    questionId:seed.questionId,eligibilityReviewId:seed.reviewId,studyId:seed.studyId,studyVersion:seed.studyVersion,
    occurrenceId:seed.occurrenceId,sourceRevision:receivedSelection.currentRevision,
    extractionResultSetId:receivedSelection.resultSetId};
  await immutableJson(join(directory,'selection.json'),binding);
  const saved=await optionalJson(join(directory,'programme-result.json'));
  if(saved){
    need(saved.state==='COMPLETE'&&same(saved.binding,binding),'STUDY_APPRAISAL_PROGRAMME_CHANGED');
    await store.getMetadata(dossierId,{revision:saved.currentRevision});
    for(const file of saved.files)await artifact(directory,file);return saved;
  }
  const caseFile=join(directory,'bound-source-case.json');
  let sourceCase=await optionalJson(caseFile);
  if(!sourceCase){
    if(mode==='author')sourceCase=await bindRiskOfBiasStudyCase({reader:store,dossierId,questionId:seed.questionId,
      eligibilityReviewId:seed.reviewId,studyId:seed.studyId,studyVersion:seed.studyVersion,
      occurrenceId:seed.occurrenceId,revision:receivedSelection.currentRevision,
      extractionResultSetId:receivedSelection.resultSetId,inputs,signal});
    else{
      need(authored?.state==='COMPLETE'&&authored.mode==='author'&&authored.dossierId===dossierId,
        'STUDY_APPRAISAL_AUTHORED_CASE_REQUIRED');
      const original=await retained(authored.sourceCaseFile);sourceCase=parseJson(original.body);
    }
    await immutableJson(caseFile,sourceCase);
  }
  const {sha256,...caseBody}=sourceCase;
  need(typeof sha256==='string'&&riskOfBiasDigest(caseBody)===sha256&&
    sourceCase.dossierId===dossierId&&sourceCase.questionId===seed.questionId&&
    sourceCase.eligibilityReviewId===seed.reviewId&&sourceCase.studyId===seed.studyId&&
    sourceCase.studyVersion===seed.studyVersion&&sourceCase.source.occurrenceId===seed.occurrenceId&&
    sourceCase.sourceRevision===receivedSelection.currentRevision&&
    sourceCase.extractionResultSetId===receivedSelection.resultSetId,
    'STUDY_APPRAISAL_BOUND_SOURCE_CASE_CHANGED');
  if(mode==='inspect')need(authored?.sourceCaseSha256===sha256&&authored.sourceRevision===sourceCase.sourceRevision,
    'STUDY_APPRAISAL_RECEIVED_SOURCE_CASE_CHANGED');
  const browserDirectory=await privateDirectory(join(directory,'browser'));
  const result=await runRiskOfBiasBrowser({url,dossierId,questionId:seed.questionId,studyId:seed.studyId,
    studyVersion:seed.studyVersion,eligibilityReviewId:seed.reviewId,sourceCase,runDirectory:browserDirectory,
    playwrightModule,chromiumExecutable,mode,...(mode==='inspect'?{selection:authored.selection}:{}),signal});
  signal?.throwIfAborted();
  need(result.schema==='sf88-research-appraisal-browser-receiving/v1'&&result.mode===mode&&
    result.status===(mode==='author'?'AUTHORED_SOURCE_APPRAISAL':'RECEIVED_ORIGINAL_APPRAISAL')&&
    result.dossierId===dossierId&&result.workspace?.workspaceId===expectedWorkspaceId&&
    result.operationId===sourceCase.operationId&&Number.isSafeInteger(result.currentRevision),
    'STUDY_APPRAISAL_COMPLETE_BROWSER_REQUIRED');
  const selection=selectionOf(result);
  if(mode==='inspect')need(same(selection,authored.selection),'STUDY_APPRAISAL_RECEIVED_SELECTION_CHANGED');
  const requests=mode==='author'?await originalRequests(result):authored.requests;
  need(Array.isArray(requests)&&requests.length===7,'STUDY_APPRAISAL_ORIGINAL_REQUESTS_REQUIRED');
  const replay=await recoverOriginalRequests({store,dossierId,requests,directory,signal});
  need(replay.revision===result.currentRevision,'STUDY_APPRAISAL_BROWSER_REPLAY_REVISION_CHANGED');
  const files=new Map();
  const refs=[...result.nativeOutputs,...result.downloads,...result.screenshots,result.sourceCase,
    result.statePath,join(browserDirectory,'receiving-result.json'),caseFile,join(directory,'selection.json'),
    join(directory,'original-request-recovery.json')];
  if(mode==='author')for(const entry of requests)refs.push(entry.request,entry.response,entry.envelope);
  for(const ref of refs){
    signal?.throwIfAborted();const file=await artifact(directory,ref),old=files.get(file.file);
    need(!old||same(old,file),'STUDY_APPRAISAL_ARTIFACT_CHANGED');files.set(file.file,file);
  }
  const complete={schema:SCHEMA,state:'COMPLETE',mode,binding,dossierId,workspaceId:expectedWorkspaceId,
    operationId:sourceCase.operationId,sourceRevision:sourceCase.sourceRevision,
    originalRevision:result.originalRevision,currentRevision:result.currentRevision,selection,
    sourceCaseSha256:sourceCase.sha256,sourceCaseFile:await artifact(directory,caseFile),
    source:{fileName:sourceCase.source.fileName,sha256:sourceCase.source.sha256,bytes:sourceCase.source.bytes,
      occurrenceId:sourceCase.source.occurrenceId},
    study:{studyId:sourceCase.studyId,studyVersion:sourceCase.studyVersion,sha256:sourceCase.studySha256},
    selectedResult:{resultId:sourceCase.selectedResult.resultId,resultVersion:sourceCase.selectedResult.resultVersion,
      resultSha256:sourceCase.selectedResult.resultSha256},
    sourcePassageCount:sourceCase.sourcePassageCount,sourcePointerCount:sourceCase.sourcePointerCount,
    independentReviewers:sourceCase.reviewers.map(value=>structuredClone(value.actor)),
    requests:structuredClone(requests),replays:replay.records,files:[...files.values()],completedAt:new Date().toISOString()};
  await immutableJson(join(directory,'programme-result.json'),complete);return complete;
}
