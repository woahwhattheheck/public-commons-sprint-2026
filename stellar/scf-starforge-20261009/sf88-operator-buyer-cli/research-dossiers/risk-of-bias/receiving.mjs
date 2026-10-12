// MIT. Full appraisal receiving inside the original Research commissioning programme.
import {Readable} from 'node:stream';
import {isAbsolute,resolve,join,relative,sep,basename,dirname} from 'node:path';
import {lstat} from 'node:fs/promises';
import {privateDirectory,readJson,jsonBytes,digest,need,object} from '../../node/store.mjs';
import {readResearchHostFile} from '../workspace-files.mjs';
import {writePortableFile} from '../portable.mjs';
import {riskOfBiasDigest,riskOfBiasInput,RISK_OF_BIAS_SECTIONS} from './contracts.mjs';
import {bindRiskOfBiasStudyCase,RISK_STUDY_CASE_SCHEMA} from './study-case.mjs';

export const RISK_RECEIVING_SCHEMA='sf88-research-appraisal-receiving/v1';
const LIMIT=64*1024*1024,clone=value=>structuredClone(value);
const same=(left,right)=>riskOfBiasDigest(left)===riskOfBiasDigest(right);
const absolute=value=>typeof value==='string'&&isAbsolute(value)&&resolve(value)===value;
const check=signal=>signal?.throwIfAborted();
const select=value=>Object.fromEntries(['reviewId','protocolId','assessmentId','assessmentEditionId',
  'draftIds','submissionIds','adjudicationId'].map(key=>[key,clone(value[key])]));
const options=selection=>({reviewId:selection.reviewId,assessmentId:selection.assessmentId,
  assessmentEditionId:selection.assessmentEditionId});
async function exists(file){
  try{const stat=await lstat(file);need(stat.isFile()&&!stat.isSymbolicLink(),'RISK_RECEIVING_FILE_INVALID');return true;}
  catch(error){if(error.code==='ENOENT')return false;throw error;}
}
async function identity(file){
  const bytes=await readResearchHostFile(file,LIMIT);
  return {file,bytes:bytes.length,sha256:digest(bytes)};
}
async function immutable(file,bytes){
  bytes=Buffer.from(bytes);
  if(await exists(file)){const saved=await readResearchHostFile(file,LIMIT);
    need(saved.length===bytes.length&&digest(saved)===digest(bytes),'RISK_RECEIVING_FILE_CHANGED');
    return {file,bytes:bytes.length,sha256:digest(bytes)};
  }
  try{return await writePortableFile(file,{filename:basename(file),contentType:'application/octet-stream',
    body:Readable.from([bytes])});}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    const saved=await readResearchHostFile(file,LIMIT);
    need(saved.length===bytes.length&&digest(saved)===digest(bytes),'RISK_RECEIVING_FILE_CHANGED');
    return {file,bytes:bytes.length,sha256:digest(bytes)};
  }
}
const immutableJson=(file,value)=>immutable(file,jsonBytes(value));
const optional=async file=>await exists(file)?readJson(file,LIMIT):null;
async function checkpoint(file,produce){
  const saved=await optional(file);if(saved)return saved;
  const value=await produce();await immutableJson(file,value);return value;
}
function artifactPath(root,file){
  need(absolute(root)&&absolute(file),'RISK_RECEIVING_ABSOLUTE_PATH_REQUIRED');
  const local=relative(root,file);
  need(local&&!isAbsolute(local)&&!local.split(sep).some(value=>!value||value==='..'||value==='.')&&
    !local.split(sep).some(value=>/^(?:browser-profile|.*connection.*\.json|workspace)$/.test(value)),
    'RISK_RECEIVING_ARTIFACT_OUTSIDE_OPERATION');
  return file;
}
async function verifiedArtifacts(root,values){
  const unique=new Map();
  for(const item of values){
    const file=artifactPath(root,item.file??item.path),actual=await identity(file);
    need(actual.bytes===item.bytes&&actual.sha256===item.sha256,'RISK_RECEIVING_ARTIFACT_CHANGED');
    const value={...item,...actual};delete value.path;
    const old=unique.get(file);need(!old||old.bytes===value.bytes&&old.sha256===value.sha256,'RISK_RECEIVING_ARTIFACT_CHANGED');
    unique.set(file,value);
  }
  return [...unique.values()];
}
async function browserArtifacts(root,browser){
  const envelopes=[];
  for(const value of browser.requestFiles)envelopes.push({
    ...await identity(artifactPath(root,value.envelopePath)),kind:'appraisal-browser-recovery-envelope',
    action:value.action,requestId:value.requestId,
  });
  const stateFile=artifactPath(root,browser.statePath),resultFile=join(dirname(stateFile),'receiving-result.json');
  const values=[
    ...envelopes,
    {...await identity(stateFile),kind:'appraisal-browser-recovery-state'},
    {...await identity(artifactPath(root,resultFile)),kind:'appraisal-browser-completed-result'},
    {...browser.sourceCase,kind:'appraisal-source-case'},
    ...browser.requestFiles.flatMap(value=>[
      {...value.request,kind:'appraisal-original-request',action:value.action,requestId:value.requestId},
      {...value.response,kind:'appraisal-original-response',action:value.action,requestId:value.requestId},
    ]),
    ...browser.nativeOutputs.map(value=>({...value,kind:'appraisal-native-output'})),
    ...browser.downloads.map(value=>({...value,kind:'appraisal-browser-report'})),
    ...browser.screenshots.map(value=>({...value,kind:'appraisal-browser-screenshot'})),
  ];
  return verifiedArtifacts(root,values);
}
async function pageRows(store,id,selection,revision,section,signal){
  const rows=[];let offset=0,total=null;
  do{
    check(signal);
    const page=await store.riskOfBias(id,{...options(selection),revision,section,offset,limit:5});
    need(page.schema==='sf88-research-risk-of-bias-view/v1'&&page.dossierId===id&&page.revision===revision&&
      page.section===section&&page.reviewId===selection.reviewId&&page.assessmentId===selection.assessmentId&&
      page.assessment?.editionId===selection.assessmentEditionId&&page.offset===offset&&Array.isArray(page.items)&&
      Number.isSafeInteger(page.total)&&page.total>=0&&(total===null||page.total===total),
      'RISK_RECEIVING_PAGE_CHANGED');
    total=page.total;rows.push(...page.items);
    if(page.nextOffset===null){need(rows.length===total,'RISK_RECEIVING_PAGE_INCOMPLETE');return rows;}
    need(page.nextOffset===offset+page.items.length&&page.nextOffset>offset&&page.nextOffset<total,
      'RISK_RECEIVING_PAGE_CURSOR_CHANGED');
    offset=page.nextOffset;
  }while(true);
}
async function snapshot(store,id,selection,revision,signal){
  const sections={};
  for(const section of RISK_OF_BIAS_SECTIONS)sections[section]=await pageRows(store,id,selection,revision,section,signal);
  const page=await store.riskOfBias(id,{...options(selection),revision,section:'comparisons'});
  need(page.comparison?.adjudication?.id===selection.adjudicationId&&page.comparison.adjudicationCurrent===true,
    'RISK_RECEIVING_ADJUDICATION_CHANGED');
  return {dossierId:id,revision,selection:select(selection),sections,
    comparison:clone(page.comparison),assessment:clone(page.assessment),protocol:clone(page.protocol)};
}
function checkCase(sourceCase,ids={}){
  need(sourceCase?.schema===RISK_STUDY_CASE_SCHEMA,'RISK_RECEIVING_BOUND_CASE_REQUIRED');
  const {sha256,...body}=sourceCase;
  need(sha256===riskOfBiasDigest(body),'RISK_RECEIVING_CASE_DIGEST_CHANGED');
  for(const [key,value]of Object.entries(ids))if(value!==undefined)
    need(sourceCase[key]===value,'RISK_RECEIVING_CASE_SELECTION_CHANGED');
}
function checkHistory(view,sourceCase,{draftCount=2,submissionCount=2,adjudicationCount=1}={}){
  const {sections,assessment}=view;
  need(assessment.target.studyId===sourceCase.studyId&&assessment.target.studyVersion===sourceCase.studyVersion&&
    assessment.target.studySha256===sourceCase.studySha256&&
    assessment.target.resultId===sourceCase.selectedResult.resultId&&
    assessment.target.resultVersion===sourceCase.selectedResult.resultVersion&&
    assessment.target.resultSha256===sourceCase.selectedResult.resultSha256&&
    same(assessment.target.result.record,sourceCase.selectedResult.sourceRecord),
    'RISK_RECEIVING_ORIGINAL_TARGET_CHANGED');
  need(same(view.protocol.definition,sourceCase.protocol),'RISK_RECEIVING_PROTOCOL_CHANGED');
  need(sections.drafts.length===draftCount&&sections.submissions.length===submissionCount&&
    sections.adjudications.length===adjudicationCount,'RISK_RECEIVING_REVIEW_HISTORY_CHANGED');
  need(sections.submissions.some(value=>value.actor.id===sourceCase.reviewers[0].actor.id)&&
    sections.submissions.some(value=>value.actor.id===sourceCase.reviewers[1].actor.id)&&
    view.comparison.submissionIds.length===2,'RISK_RECEIVING_INDEPENDENT_REVIEWS_CHANGED');
  need(assessment.target.occurrenceIds.length===1&&assessment.target.occurrenceIds[0]===sourceCase.source.occurrenceId&&
    sections.sources.some(value=>value.occurrenceId===sourceCase.source.occurrenceId&&value.files?.some(file=>
      file.name===sourceCase.source.fileName&&file.bytes===sourceCase.source.bytes&&file.sha256===sourceCase.source.sha256)),
    'RISK_RECEIVING_SOURCE_MEMBER_CHANGED');
}
async function reports(store,id,selection,revision,directory,signal){
  await privateDirectory(directory);const result=[];
  for(const format of ['json','csv','md','html']){
    check(signal);
    const exported=await store.exportRiskOfBias(id,{...options(selection),revision,format});
    need(exported.revision===revision&&typeof exported.body==='string'&&exported.body.length>0,
      'RISK_RECEIVING_REPORT_CHANGED');
    const file=join(directory,'Appraisal_r'+revision+'.'+format),saved=await immutable(file,Buffer.from(exported.body,'utf8'));
    result.push({...saved,kind:'appraisal-complete-report',format,revision,
      filename:exported.filename,contentType:exported.contentType});
  }
  return result;
}
async function acceptedResult(root,file,binding){
  const value=await optional(file);if(!value)return null;
  need(value.schema===RISK_RECEIVING_SCHEMA&&value.state==='COMPLETE'&&same(value.binding,binding),
    'RISK_RECEIVING_COMPLETED_INPUT_CHANGED');
  await verifiedArtifacts(root,value.artifacts);
  return value;
}
/** Browser authoring + the original client/CLI/Merchant receiving in one borrowed listener. */
export async function receiveRiskOfBiasStudy({
  store,url,connectionFile,workspaceDirectory,expectedWorkspaceId,runDirectory,
  dossierId,questionId,eligibilityReviewId,studyId,studyVersion,occurrenceId,
  revision,extractionResultSetId,inputs,playwrightModule,chromiumExecutable,signal,
  browserDriver,transportDriver,node=process.execPath,python=process.env.CODEX_PRIMARY_RUNTIME_PYTHON??'python3',
}={}){
  check(signal);
  need(store&&['riskOfBias','getMetadata','extractionSourceValues','exportRiskOfBias'].every(key=>typeof store[key]==='function'),
    'RISK_RECEIVING_ORIGINAL_STORE_REQUIRED');
  for(const file of [connectionFile,workspaceDirectory,runDirectory,playwrightModule,chromiumExecutable])
    need(absolute(file),'RISK_RECEIVING_ABSOLUTE_PATH_REQUIRED');
  need(/^research_[a-f0-9]{64}$/.test(expectedWorkspaceId??''),'RISK_RECEIVING_WORKSPACE_REQUIRED');
  runDirectory=await privateDirectory(runDirectory);
  const binding={schema:RISK_RECEIVING_SCHEMA,phase:'original-author',workspaceId:expectedWorkspaceId,
    dossierId,questionId,eligibilityReviewId,studyId,studyVersion,occurrenceId,extractionResultSetId};
  await immutableJson(join(runDirectory,'input.json'),binding);
  const done=await acceptedResult(runDirectory,join(runDirectory,'result.json'),binding);if(done)return done;
  const caseFile=join(runDirectory,'bound-source-case.json');
  const sourceCase=await checkpoint(caseFile,async()=>bindRiskOfBiasStudyCase({
    reader:store,dossierId,questionId,eligibilityReviewId,studyId,studyVersion,occurrenceId,
    revision:revision??(await store.getMetadata(dossierId)).revision,extractionResultSetId,inputs,signal}));
  checkCase(sourceCase,{dossierId,questionId,eligibilityReviewId,studyId,studyVersion,extractionResultSetId});
  browserDriver??=(await import('./receiving-browser.mjs')).runRiskOfBiasBrowser;
  transportDriver??=(await import('./receiving-transports.mjs')).receiveRiskOfBiasTransports;
  need(typeof browserDriver==='function'&&typeof transportDriver==='function','RISK_RECEIVING_ORIGINAL_DRIVERS_REQUIRED');
  const browser=await browserDriver({url,dossierId,questionId,studyId,studyVersion,eligibilityReviewId,sourceCase,
    runDirectory:await privateDirectory(join(runDirectory,'browser')),playwrightModule,chromiumExecutable,mode:'author',signal});
  need(browser.schema==='sf88-research-appraisal-browser-receiving/v1'&&browser.status==='AUTHORED_SOURCE_APPRAISAL'&&
    browser.dossierId===dossierId&&browser.operationId===sourceCase.operationId&&
    browser.workspace?.workspaceId===expectedWorkspaceId&&browser.requestFiles.length===7&&
    browser.draftIds.length===2&&browser.submissionIds.length===2,'RISK_RECEIVING_BROWSER_CHANGED');
  const selection=select(browser),view=await snapshot(store,dossierId,selection,browser.currentRevision,signal);
  checkHistory(view,sourceCase);
  need(view.sections.operations.length===7&&view.sections.operations[0].action==='create-review'&&
    view.sections.operations.at(-1).action==='adjudicate','RISK_RECEIVING_NATIVE_ACTIONS_CHANGED');
  const original=view.sections.operations[0],requestFile=join(runDirectory,'original-create-review.request.json');
  await immutableJson(requestFile,original.request);
  const transport=await transportDriver({connectionFile,workspaceDirectory,expectedWorkspaceId,dossierId,
    ...options(selection),revision:browser.currentRevision,replayRequestFile:requestFile,
    runDirectory:await privateDirectory(join(runDirectory,'transports')),signal,node,python});
  need(transport?.state==='COMPLETE'&&transport.selection?.dossierId===dossierId&&
    transport.selection.revision===browser.currentRevision&&Array.isArray(transport.artifacts),
    'RISK_RECEIVING_TRANSPORT_CHANGED');
  const snapshotFile=join(runDirectory,'original-appraisal.json');
  await immutableJson(snapshotFile,view);
  const artifacts=[
    {...await identity(caseFile),kind:'appraisal-bound-case'},
    {...await identity(requestFile),kind:'appraisal-original-replay-request'},
    {...await identity(snapshotFile),kind:'appraisal-original-history'},
    ...await browserArtifacts(runDirectory,browser),
    ...await verifiedArtifacts(runDirectory,transport.artifacts),
    ...await reports(store,dossierId,selection,browser.currentRevision,join(runDirectory,'reports'),signal),
  ];
  const result={schema:RISK_RECEIVING_SCHEMA,state:'COMPLETE',binding,sourceCase,selection,browser,
    revision:browser.currentRevision,originalRevision:sourceCase.sourceRevision,
    operationIds:view.sections.operations.map(value=>value.id),transport,artifacts,
    completedAt:new Date().toISOString()};
  await immutableJson(join(runDirectory,'result.json'),result);return result;
}
/** Compare the existing original JSON/gzip receiver at the same selected revision. */
export async function verifyRiskOfBiasReceiving({
  original,received,dossierId,revision,sourceCase,selection,runDirectory,signal,
}={}){
  check(signal);checkCase(sourceCase,{dossierId});
  need(absolute(runDirectory),'RISK_RECEIVING_ABSOLUTE_PATH_REQUIRED');await privateDirectory(runDirectory);
  const binding={schema:RISK_RECEIVING_SCHEMA,phase:'portable-receiving',dossierId,revision,
    sourceCaseSha256:sourceCase.sha256,selection:select(selection)};
  await immutableJson(join(runDirectory,'input.json'),binding);
  const done=await acceptedResult(runDirectory,join(runDirectory,'result.json'),binding);if(done)return done;
  const left=await snapshot(original,dossierId,selection,revision,signal);
  const right=await snapshot(received,dossierId,selection,revision,signal);
  need(same(left,right),'RISK_RECEIVING_PORTABLE_HISTORY_CHANGED');
  const counts={draftCount:left.sections.drafts.length,submissionCount:left.sections.submissions.length,
    adjudicationCount:left.sections.adjudications.length};
  checkHistory(left,sourceCase,counts);checkHistory(right,sourceCase,counts);
  const record={schema:RISK_RECEIVING_SCHEMA,dossierId,revision,selection:select(selection),
    sourceCaseSha256:sourceCase.sha256,completeNativeViewSha256:riskOfBiasDigest(right),
    sections:Object.fromEntries(Object.entries(right.sections).map(([section,items])=>[
      section,{count:items.length,sha256:riskOfBiasDigest(items)}])),
    nativeOperationIds:right.sections.operations.map(value=>value.id),
    originalSource:clone(sourceCase.source),result:clone(sourceCase.selectedResult),
    outcome:'COMPLETE_ORIGINAL_HISTORY_REOPENED'};
  const artifact=await immutableJson(join(runDirectory,'received-appraisal.json'),record);
  const result={schema:RISK_RECEIVING_SCHEMA,state:'COMPLETE',binding,record,
    artifacts:[{...artifact,kind:'appraisal-portable-receiving'}],completedAt:new Date().toISOString()};
  await immutableJson(join(runDirectory,'result.json'),result);return result;
}
function actionSteps({store,id,sourceCase,workspaceId,directory,signal}){
  return async(name,action,actor,produce)=>{
    check(signal);
    need(/^[a-z0-9-]+$/.test(name),'RISK_RECEIVING_STEP_INVALID');
    const file=join(directory,name+'.request.json'),saved=await optional(file);
    const requestId='rap_'+digest(jsonBytes({operation:sourceCase.operationId,workspaceId,dossierId:id,
      sourceCaseSha256:sourceCase.sha256,step:name})).slice(0,60);
    let request=saved;
    if(!request){
      const data=await produce();
      request=riskOfBiasInput({requestId,expectedRevision:(await store.getMetadata(id)).revision,
        actor,action,reviewId:data.reviewId,data:data.body});
      await immutableJson(file,request);
    }else{
      const normalized=riskOfBiasInput(request);
      need(same(normalized,request)&&request.requestId===requestId&&request.action===action&&same(request.actor,actor),
        'RISK_RECEIVING_REQUEST_CHANGED');
    }
    check(signal);
    const reply=await store.reviewRiskOfBias(id,{...request,projection:'metadata'}),operation=reply.operation;
    need(reply.dossier?.id===id&&operation?.dossierId===id&&operation.requestId===request.requestId&&
      operation.requestSha256===riskOfBiasDigest(request)&&same(operation.request,request)&&
      operation.originalRevision===request.expectedRevision&&operation.revision===request.expectedRevision+1,
      'RISK_RECEIVING_NATIVE_RECEIPT_CHANGED');
    const responseFile=join(directory,name+'.operation.json');await immutableJson(responseFile,operation);
    return {operation,requestFile:file,artifacts:[
      {...await identity(file),kind:'appraisal-received-request',action,requestId},
      {...await identity(responseFile),kind:'appraisal-received-operation',action,requestId},
    ]};
  };
}
/**
 * Receive the complete original review, clarify the actual MEDIAN label in A's
 * retained answer, submit that correction and resolve its complete comparison.
 * It uses the same original Store and the original customer's listener.
 */
export async function continueRiskOfBiasReceiving({
  store,url,connectionFile,workspaceDirectory,expectedWorkspaceId,runDirectory,
  sourceCase,selection,browserSelection,playwrightModule,chromiumExecutable,signal,
  browserDriver,transportDriver,node=process.execPath,python=process.env.CODEX_PRIMARY_RUNTIME_PYTHON??'python3',
}={}){
  check(signal);checkCase(sourceCase);
  for(const file of [connectionFile,workspaceDirectory,runDirectory,playwrightModule,chromiumExecutable])
    need(absolute(file),'RISK_RECEIVING_ABSOLUTE_PATH_REQUIRED');
  need(store&&typeof store.reviewRiskOfBias==='function'&&/^research_[a-f0-9]{64}$/.test(expectedWorkspaceId??''),
    'RISK_RECEIVING_ORIGINAL_STORE_REQUIRED');
  runDirectory=await privateDirectory(runDirectory);
  const dossierId=sourceCase.dossierId,binding={schema:RISK_RECEIVING_SCHEMA,phase:'received-correction',
    workspaceId:expectedWorkspaceId,dossierId,sourceCaseSha256:sourceCase.sha256,selection:select(selection)};
  await immutableJson(join(runDirectory,'input.json'),binding);
  const done=await acceptedResult(runDirectory,join(runDirectory,'result.json'),binding);if(done)return done;
  browserDriver??=(await import('./receiving-browser.mjs')).runRiskOfBiasBrowser;
  transportDriver??=(await import('./receiving-transports.mjs')).receiveRiskOfBiasTransports;
  const baseline=await checkpoint(join(runDirectory,'received-baseline.json'),async()=>{
    const revision=(await store.getMetadata(dossierId)).revision;
    const value=await snapshot(store,dossierId,selection,revision,signal);checkHistory(value,sourceCase);
    return value;
  });
  const browser=await browserDriver({url,dossierId,questionId:sourceCase.questionId,studyId:sourceCase.studyId,
    studyVersion:sourceCase.studyVersion,eligibilityReviewId:sourceCase.eligibilityReviewId,sourceCase,
    selection:browserSelection??selection,runDirectory:await privateDirectory(join(runDirectory,'browser')),
    playwrightModule,chromiumExecutable,mode:'inspect',signal});
  need(browser.status==='RECEIVED_ORIGINAL_APPRAISAL'&&browser.workspace?.workspaceId===expectedWorkspaceId&&
    browser.adjudicationId===selection.adjudicationId,'RISK_RECEIVING_IMPORTED_BROWSER_CHANGED');
  const a=sourceCase.reviewers[0],b=sourceCase.reviewers[1],resolver=sourceCase.adjudication.actor;
  const oldDraft=baseline.sections.drafts.find(value=>value.id===selection.draftIds[0]);
  const oldSubmission=baseline.sections.submissions.find(value=>value.id===selection.submissionIds[0]);
  need(oldDraft?.current===true&&oldSubmission?.current===true&&oldDraft.actor.id===a.actor.id&&
    oldSubmission.actor.id===a.actor.id&&baseline.sections.submissions.some(value=>
      value.id===selection.submissionIds[1]&&value.actor.id===b.actor.id),
    'RISK_RECEIVING_ORIGINAL_REVIEWER_HISTORY_CHANGED');
  const requestDirectory=await privateDirectory(join(runDirectory,'requests'));
  const step=actionSteps({store,id:dossierId,sourceCase,workspaceId:expectedWorkspaceId,directory:requestDirectory,signal});
  const draft=await step('clarify-original-median','save-draft',a.actor,async()=>{
    const content={answers:clone(a.answers),judgments:clone(a.judgments),overall:clone(a.overall)};
    const answer=content.answers.find(value=>value.fieldId==='formation-consequences');
    need(answer?.value.includes('reports an age value of'),'RISK_RECEIVING_ORIGINAL_CLARIFICATION_CHANGED');
    answer.value=answer.value.replace('reports an age value of','reports median ages of');
    answer.rationale+=' Received-copy clarification: the original registry labels this baseline statistic MEDIAN; the reported 54.5 and 54.2 values and all other answers remain unchanged.';
    const passage=sourceCase.adjudication.answers.find(value=>value.fieldId==='formation-consequences')?.basis.find(value=>
      value.jsonPointer==='/resultsSection/baselineCharacteristicsModule/measures/1/paramType');
    need(passage?.quote==='MEDIAN','RISK_RECEIVING_ORIGINAL_MEDIAN_SOURCE_REQUIRED');
    if(!answer.basis.some(value=>same(value,passage)))answer.basis.push(clone(passage));
    return {reviewId:selection.reviewId,body:{assessmentId:selection.assessmentId,
      assessmentEditionId:selection.assessmentEditionId,...content,supersedes:oldDraft.id,
      reason:'Clarify the original registry MEDIAN label in the received copy of reviewer A’s baseline answer; preserve every reported value and the original review history.'}};
  });
  need(draft.operation.result.draft?.supersedes===oldDraft.id,'RISK_RECEIVING_DRAFT_LINEAGE_CHANGED');
  const submission=await step('submit-median-clarification','submit-review',a.actor,async()=>({
    reviewId:selection.reviewId,body:{assessmentId:selection.assessmentId,assessmentEditionId:selection.assessmentEditionId,
      draftId:draft.operation.result.draft.id,supersedes:oldSubmission.id,
      reason:'Submit the source-linked baseline statistic clarification as the next immutable A review; keep independent B and the original submitted versions.'}}));
  const adjudication=await step('resolve-received-clarification','adjudicate',resolver,async()=>{
    const page=await store.riskOfBias(dossierId,{...options(selection),revision:submission.operation.revision,section:'comparisons'});
    const comparison=page.comparison;
    need(comparison?.submissionIds.includes(submission.operation.result.submission.id)&&
      comparison.submissionIds.includes(selection.submissionIds[1])&&comparison.submissionIds.length===2&&
      comparison.adjudicationCurrent===false,'RISK_RECEIVING_CORRECTION_COMPARISON_CHANGED');
    return {reviewId:selection.reviewId,body:{assessmentId:selection.assessmentId,
      assessmentEditionId:selection.assessmentEditionId,submissionIds:clone(comparison.submissionIds),
      expectedComparisonSha256:comparison.sha256,answers:clone(sourceCase.adjudication.answers),
      judgments:clone(sourceCase.adjudication.judgments),overall:clone(sourceCase.adjudication.overall),
      supersedes:selection.adjudicationId,
      reason:sourceCase.adjudication.reason+' Received-copy continuation: reviewer A now names the original MEDIAN statistic explicitly. Reconcile the complete new A plus original B submission set, retaining the original adjudication and all earlier source-bound judgments.'}};
  });
  const next={...select(selection),draftIds:[draft.operation.result.draft.id,selection.draftIds[1]],
    submissionIds:[submission.operation.result.submission.id,selection.submissionIds[1]],
    adjudicationId:adjudication.operation.result.adjudication.id};
  const revision=adjudication.operation.revision,after=await snapshot(store,dossierId,next,revision,signal);
  checkHistory(after,sourceCase,{draftCount:3,submissionCount:3,adjudicationCount:2});
  for(const original of baseline.sections.operations){
    const retained=after.sections.operations.find(value=>value.id===original.id);
    need(retained&&same(retained,original),'RISK_RECEIVING_EARLIER_OPERATION_CHANGED');
  }
  need(after.sections.submissions.some(value=>value.id===selection.submissionIds[1]&&same(value,
    baseline.sections.submissions.find(row=>row.id===value.id))),'RISK_RECEIVING_INDEPENDENT_B_CHANGED');
  const transport=await transportDriver({connectionFile,workspaceDirectory,expectedWorkspaceId,dossierId,
    ...options(next),revision,replayRequestFile:draft.requestFile,
    runDirectory:await privateDirectory(join(runDirectory,'transports')),signal,node,python});
  need(transport?.state==='COMPLETE'&&transport.selection?.dossierId===dossierId&&
    transport.selection.revision===revision&&Array.isArray(transport.artifacts),'RISK_RECEIVING_TRANSPORT_CHANGED');
  const finalFile=join(runDirectory,'received-appraisal.json');await immutableJson(finalFile,after);
  const artifacts=[
    {...await identity(join(runDirectory,'received-baseline.json')),kind:'appraisal-received-baseline'},
    {...await identity(finalFile),kind:'appraisal-complete-received-history'},
    ...await browserArtifacts(runDirectory,browser),
    ...draft.artifacts,...submission.artifacts,...adjudication.artifacts,
    ...await verifiedArtifacts(runDirectory,transport.artifacts),
    ...await reports(store,dossierId,next,revision,join(runDirectory,'reports'),signal),
  ];
  const result={schema:RISK_RECEIVING_SCHEMA,state:'COMPLETE',binding,sourceCase,selection:next,
    originalSelection:select(selection),revision,originalRevision:baseline.revision,browser,transport,
    operationIds:after.sections.operations.map(value=>value.id),artifacts,
    correction:{fieldId:'formation-consequences',sourcePointer:'/resultsSection/baselineCharacteristicsModule/measures/1/paramType',
      originalDraftId:oldDraft.id,originalSubmissionId:oldSubmission.id,newDraftId:next.draftIds[0],
      newSubmissionId:next.submissionIds[0],originalAdjudicationId:selection.adjudicationId,
      newAdjudicationId:next.adjudicationId,unchangedIndependentSubmissionId:selection.submissionIds[1]},
    completedAt:new Date().toISOString()};
  await immutableJson(join(runDirectory,'result.json'),result);return result;
}
