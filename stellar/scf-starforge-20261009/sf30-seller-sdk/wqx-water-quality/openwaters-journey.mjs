// MIT. Complete original-capture receiving through the Open Waters workspace.
import assert from 'node:assert/strict';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fork } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { privateDirectory, atomicJson } from '../routescan/quota.mjs';
import { writeBytes as writeNativeBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { receiveQualityCaptureBundle } from './journey.mjs';
import { readCapture } from './provider.mjs';
import { joinCapture } from './samples.mjs';
import { openWaterQualityProject } from './project.mjs';
import { startWaterQualityWorkspace } from './workspace.mjs';
import { openWatersCanonical, normalizeOpenWatersOptions, parseOpenWatersPaste } from './openwaters.mjs';

const CAPTURE_SHA='cbb29504ab01598cddb21bde33c918ca92075aad7f53fdac4fb07581371d29d7';
const REVIEW_ID='potomac-quarter-open-waters',PLAN_ID='potomac-quarter-open-waters-01';
const TITLE='Potomac Chain Bridge — complete Q1 2025 receiving';
const sha=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const equal=(a,b,message)=>assert.equal(openWatersCanonical(a),openWatersCanonical(b),message);
async function readOrNull(file) {
  try{return JSON.parse(await readFile(file,'utf8'));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function writeExact(file,bytes) {
  try{await writeNativeBytes(file,bytes,{exclusive:true});}
  catch(error){if(error.code!=='EEXIST')throw error;assert.equal(await realpath(file),file);assert.deepEqual(await readFile(file),bytes,'Resume the same receiving file.');}
}
async function request(workspace,path,input) {
  const state=input===undefined?null:await workspace.view();
  const response=await fetch(workspace.url+path,input===undefined?{}:{method:'POST',
    headers:{'content-type':'application/json','x-workspace-token':state.token,origin:workspace.url},body:JSON.stringify(input)});
  const bytes=Buffer.from(await response.arrayBuffer());
  assert.equal(response.status,200,path+': '+(response.status===200?'':bytes.toString('utf8').slice(0,2000)));
  return {response,bytes};
}
async function requestJson(workspace,path,input){return JSON.parse((await request(workspace,path,input)).bytes.toString('utf8'));}
function originalLimit(limit) {
  return {id:limit.id,type:limit.type??null,value:limit.value??null,unit:limit.unit??null,
    comment:limit.comment??null,origin:limit.origin??null,source:limit.source??null};
}
export async function prepareOpenWatersJourney({directory,captureDirectory,sourceBundle,options,browser=false,
  playwrightModule,browserExecutable,onProgress}={}) {
  const root=await privateDirectory(resolve(directory)),projectDirectory=join(root,'project'),receiverDirectory=join(root,'receiver');
  const exportsDirectory=await privateDirectory(join(root,'exports')),reviewId=REVIEW_ID,planId=PLAN_ID;
  const choices=normalizeOpenWatersOptions(options??JSON.parse(await readFile(new URL('./examples/potomac-2025-q1.openwaters.json',import.meta.url),'utf8')));
  const configuration={schema:'starforge.wqx-open-waters-journey.v1',captureSha256:CAPTURE_SHA,reviewId,planId,options:choices};
  let operation=await readOrNull(join(root,'open-waters-operation.json'));
  if(operation)equal(operation.configuration,configuration,'Continue the original operation with its original choices.');
  else{operation={configuration,startedAt:new Date().toISOString()};await atomicJson(root,'open-waters-operation.json',operation,{exclusive:true});}
  let stage='source',project,workspace,receiverWorkspace,receiver,sourceRequests=0;
  const originalOnly={async request(){sourceRequests++;throw Error('Continue from the complete retained capture.');}};
  async function progress(next,detail={}) {
    stage=next;const value={schema:configuration.schema,stage,startedAt:operation.startedAt,updatedAt:new Date().toISOString(),...detail};
    await atomicJson(root,'open-waters-progress.json',value);await onProgress?.(value);
  }
  try {
    await progress('source');
    const received=captureDirectory?{capture:await readCapture(resolve(captureDirectory))}:
      await receiveQualityCaptureBundle(sourceBundle??fileURLToPath(new URL('./examples/potomac-2025-q1.source.json',import.meta.url)),join(root,'upstream-capture'));
    const upstream=received.capture;assert.equal(upstream.status,'COMPLETE');assert.equal(upstream.captureSha256,CAPTURE_SHA);
    const model=await joinCapture(upstream);assert.equal(model.rows.length,1035);
    assert.equal(model.rows.reduce((sum,row)=>sum+(row.limits??[]).length,0),1112);
    project=await openWaterQualityProject(projectDirectory,{transport:originalOnly});
    let original;
    try{original=await project.capture(upstream.operationId);}
    catch(error){
      if(error.code!=='ENOENT')throw error;const state=await project.read();
      await project.importCapture({sourceDirectory:upstream.directory,title:TITLE,expectedRevision:state?.revision??0});
      original=await project.capture(upstream.operationId);
    }
    assert.equal(original.captureSha256,CAPTURE_SHA);
    const review=await project.saveReview({reviewId,captureId:upstream.operationId,options:{},
      note:'Complete quarter receiving; keep every selected original result and detection limit.',expectedCaptureSha256:CAPTURE_SHA});
    assert.equal(review.analysis.observations.length,1035);
    await progress('prepare',{sourceResults:1035,originalLimits:1112,reviewSha256:review.reviewSha256});
    const initial=await project.previewOpenWaters({reviewId,options:{...choices,locationMode:'create'}});
    assert(initial.locations.some(row=>row.issues.some(issue=>issue.field==='HORIZ_COLL_METHOD')),'The original location has no reported collection method.');
    const preview=await project.previewOpenWaters({reviewId,options:choices,expectedReviewSha256:review.reviewSha256});
    const plan=await project.saveOpenWaters({planId,reviewId,options:choices,expectedReviewSha256:review.reviewSha256});
    assert.equal(plan.summary.selectedResults,1035);assert.equal(plan.summary.distinctActivities,13);assert.equal(plan.summary.distinctStations,1);
    assert.equal(plan.results.reduce((sum,row)=>sum+row.limits.length,0),1112);
    const originals=new Map(model.rows.map(row=>[row.id,row]));
    for(const row of plan.results){
      const source=originals.get(row.sourceRecordId);assert(source);assert.equal(row.sourceRecordSha256,source.recordSha256);equal(row.source,source.source);
      equal(row.limits.map(originalLimit),(source.limits??[]).map(originalLimit),'Every original limit survives receiving.');
    }
    for(const row of plan.activities){assert.equal(row.sourceId.length,36);assert.equal(row.destinationId.length,32);assert.equal(row.destinationId,row.sourceId.replaceAll('-',''));}
    equal((await project.readOpenWaters(planId)).files,plan.files);
    const changed=await project.previewOpenWaters({reviewId,options:{...choices,notes:choices.notes+' Additional receiving note.'}});
    assert.notEqual(changed.planSha256,preview.planSha256);
    await assert.rejects(project.saveOpenWaters({planId,reviewId,options:changed.options}),error=>error.code==='WQX_OPEN_WATERS_PLAN_CHANGED');
    const files=[];
    for(const entry of plan.files){
      const exported=await project.exportOpenWaters({planId,format:entry.format});assert.equal(exported.bytes.length,entry.bytes);assert.equal(sha(exported.bytes),entry.sha256);
      await writeExact(join(exportsDirectory,entry.filename),exported.bytes);files.push(entry);
      if(entry.format==='results'){
        const parsed=parseOpenWatersPaste(exported.bytes.toString('utf8'),'S');assert.equal(parsed.rows.length,plan.summary.readyResults);
        assert(parsed.headers.includes('Activity ID'));assert(!parsed.headers.includes('ACTIVITY_ID'));
      }
      if(entry.format==='locations')assert.equal(parseOpenWatersPaste(exported.bytes.toString('utf8'),'M').rows.length,plan.summary.readyLocations);
    }
    const completeFile=files.find(row=>row.format==='bundle'),before=await project.exportOpenWaters({planId,format:'bundle'});
    const current=await project.read(),nextTitle=TITLE+' — subsequent planning';
    if(current.title!==nextTitle)await project.save({title:nextTitle,selection:current.selection,expectedRevision:current.revision});
    assert.deepEqual((await project.exportOpenWaters({planId,format:'bundle'})).bytes,before.bytes,'Later project revisions preserve the complete saved receiving bundle.');
    await project.close();project=null;
    workspace=await startWaterQualityWorkspace({directory:projectDirectory,transport:originalOnly});
    const reopened=await requestJson(workspace,'/api/open-waters/'+planId);assert.equal(reopened.planSha256,plan.planSha256);equal(reopened.files,plan.files);
    assert((await requestJson(workspace,'/api/open-waters')).some(row=>row.planId===planId));
    equal((await requestJson(workspace,'/api/workspace')).openWaters.find(row=>row.planId===planId).summary,plan.summary);
    const nativeDownloads=[];
    for(const entry of files){
      const value=await request(workspace,'/api/open-waters/'+planId+'/'+entry.format);assert.equal(value.bytes.length,entry.bytes);assert.equal(sha(value.bytes),entry.sha256);
      nativeDownloads.push({format:entry.format,status:value.response.status,bytes:entry.bytes,sha256:entry.sha256});
    }
    assert.equal(sourceRequests,0);
    const checkpoint=await saveNativeCheckpoint(root,{
      schema:configuration.schema,status:'native-complete',startedAt:operation.startedAt,completedAt:new Date().toISOString(),
      configuration,source:{captureId:upstream.operationId,captureSha256:CAPTURE_SHA,results:1035,activities:13,stations:1,limits:1112,sourceRequests},
      reviewId,reviewSha256:review.reviewSha256,planId,planSha256:plan.planSha256,options:choices,summary:plan.summary,
      files,nativeDownloads,completeBundleSha256:completeFile.sha256,stableAcrossLaterProjectRevision:true,
      preparation:{mode:'original-native',originalResultAndLimitPointers:true,compactActivityIdentities:true,
        immutableChoices:true,completeExports:true,httpReopen:true}
    });
    await progress('native-complete',{planSha256:plan.planSha256,summary:plan.summary,checkpointSha256:checkpoint.checkpointSha256});
    return checkpoint;
  }catch(error){
    await atomicJson(root,'open-waters-error.json',{stage,at:new Date().toISOString(),code:error.code??error.name,message:error.message,stack:error.stack});throw error;
  }finally{await receiver?.close();await receiverWorkspace?.close();await workspace?.close();await project?.close();}
}

const NATIVE_FILE='open-waters-native-result.json',RECEIVING_FILE='open-waters-receiving-result.json';
const FORMATS=['locations','results','crosswalk','report','bundle','references'];
const retainedOnly={async request(){throw Error('Resume from this operation’s retained original source.');}};
const checkpointHash=value=>sha(openWatersCanonical(value));
function manifestFiles(files) {
  assert(Array.isArray(files));assert.equal(files.length,FORMATS.length);
  assert.deepEqual(files.map(x=>x.format).sort(),[...FORMATS].sort());
  for(const file of files){
    assert(typeof file.filename==='string'&&file.filename&&!/[\/\\\x00]/u.test(file.filename)&&file.filename!=='.'&&file.filename!=='..');
    assert(Number.isSafeInteger(file.bytes)&&file.bytes>=0);assert(/^[a-f0-9]{64}$/u.test(file.sha256));
  }
  return files;
}
async function fingerprint(file) {
  assert.equal(await realpath(file),resolve(file),'Retained receiving outputs must be original private files.');
  const information=await stat(file);assert(information.isFile());assert.equal(information.nlink,1);
  const digest=createHash('sha256');let bytes=0;
  for await(const chunk of createReadStream(file)){bytes+=chunk.length;digest.update(chunk);}
  return {bytes,sha256:digest.digest('hex')};
}
async function verifyRetainedExports(root,files) {
  const result=[];
  for(const file of manifestFiles(files)){
    const found=await fingerprint(join(root,'exports',file.filename));
    assert.equal(found.bytes,file.bytes,file.format+' retained byte count');assert.equal(found.sha256,file.sha256,file.format+' retained hash');
    result.push({format:file.format,filename:file.filename,...found});
  }
  return result;
}
async function saveNativeCheckpoint(root,content) {
  const record={...content,checkpointSha256:checkpointHash(content)},previous=await readOrNull(join(root,NATIVE_FILE));
  if(previous){equal(previous.configuration,record.configuration,'Retain the original checkpoint configuration.');
    assert.equal(previous.planSha256,record.planSha256);equal(previous.files,record.files);return previous;}
  await atomicJson(root,NATIVE_FILE,record,{exclusive:true});return record;
}
export async function readOpenWatersNativeResult(directory) {
  const root=resolve(directory),record=await readOrNull(join(root,NATIVE_FILE));
  assert(record,'Prepare the original native phase or adopt its completed receiving bundle first.');
  const {checkpointSha256,...content}=record;assert.equal(checkpointHash(content),checkpointSha256,'Original native checkpoint hash');
  assert.equal(record.configuration.captureSha256,CAPTURE_SHA);assert.equal(record.planId,PLAN_ID);assert.equal(record.reviewId,REVIEW_ID);
  assert.equal(record.configuration.planId,record.planId);assert.equal(record.configuration.reviewId,record.reviewId);
  equal(record.configuration.options,record.options);manifestFiles(record.files);
  const operation=await readOrNull(join(root,'open-waters-operation.json'));
  assert(operation);equal(operation.configuration,record.configuration,'Resume the same receiving operation.');
  await verifyRetainedExports(root,record.files);return record;
}
async function phaseProgress(root,operation,stage,detail,onProgress) {
  const value={schema:operation.configuration.schema,startedAt:operation.startedAt,stage,updatedAt:new Date().toISOString(),...detail};
  await atomicJson(root,'open-waters-progress.json',value);await onProgress?.(value);return value;
}
export async function adoptOpenWatersJourney({directory,preparedBundle,options,onProgress}={}) {
  const root=await privateDirectory(resolve(directory));await privateDirectory(join(root,'exports'));
  if(await readOrNull(join(root,NATIVE_FILE)))return readOpenWatersNativeResult(root);
  const priorProgress=await readOrNull(join(root,'open-waters-progress.json'));
  let operation=await readOrNull(join(root,'open-waters-operation.json')),project,bundleBytes,bundle;
  try{
    project=await openWaterQualityProject(join(root,'project'),{transport:retainedOnly});
    let plan;
    try{plan=await project.readOpenWaters(PLAN_ID);}
    catch(error){if(error.code!=='ENOENT')throw error;}
    if(preparedBundle){
      const source=resolve(preparedBundle),information=await stat(source);
      assert(information.isFile()&&information.size<=128*1024*1024,'Use the complete receiving bundle within the native 128 MiB request limit.');
      bundleBytes=await readFile(source);bundle=JSON.parse(bundleBytes.toString('utf8'));
      assert.equal(bundle.plan?.planId,PLAN_ID);assert.equal(bundle.plan?.reviewId,REVIEW_ID);assert.equal(bundle.plan?.captureSha256,CAPTURE_SHA);
      equal(bundle.plan.options,normalizeOpenWatersOptions(options??operation?.configuration.options??bundle.plan.options),'Use the original prepared mapping choices.');
      if(!plan)plan=await project.receiveOpenWaters({bundle});
      assert.equal(plan.planSha256,bundle.plan.planSha256);
    }
    assert(plan,'Continue with the original saved project/exports or supply --prepared-bundle from its completed native phase.');
    assert.equal(plan.captureSha256,CAPTURE_SHA);assert.equal(plan.summary.selectedResults,1035);
    assert.equal(plan.summary.distinctActivities,13);assert.equal(plan.summary.distinctStations,1);
    assert.equal(plan.results.reduce((sum,row)=>sum+row.limits.length,0),1112);
    const choices=normalizeOpenWatersOptions(options??operation?.configuration.options??plan.options);
    equal(plan.options,choices,'Continue with the saved mapping choices.');
    const configuration={schema:'starforge.wqx-open-waters-journey.v1',captureSha256:CAPTURE_SHA,reviewId:REVIEW_ID,planId:PLAN_ID,options:choices};
    if(operation)equal(operation.configuration,configuration);
    else{operation={configuration,startedAt:new Date().toISOString(),receivedFromCompletedBundle:true};
      await atomicJson(root,'open-waters-operation.json',operation,{exclusive:true});}
    await phaseProgress(root,operation,'adopt-completed-native-phase',{planSha256:plan.planSha256},onProgress);
    if(bundle){
      const complete=plan.files.find(file=>file.format==='bundle');
      assert.equal(bundleBytes.length,complete.bytes);assert.equal(sha(bundleBytes),complete.sha256);
      await writeExact(join(root,'exports',complete.filename),bundleBytes);
      for(const member of bundle.artifacts){
        const expected=plan.files.find(file=>file.format===member.format);assert(expected);
        assert.equal(expected.filename,member.filename);assert.equal(expected.sha256,member.sha256);assert.equal(expected.bytes,member.bytes);
        const bytes=Buffer.from(member.dataBase64,'base64');
        assert.equal(bytes.toString('base64'),member.dataBase64);assert.equal(bytes.length,member.bytes);assert.equal(sha(bytes),member.sha256);
        await writeExact(join(root,'exports',member.filename),bytes);
      }
      bundleBytes=null;bundle=null;
    }
    const retainedFiles=await verifyRetainedExports(root,plan.files);
    const review=await project.readReview(plan.reviewId),capture=await project.capture(plan.captureId);
    assert.equal(review.reviewSha256,plan.reviewSha256);assert.equal(capture.captureSha256,CAPTURE_SHA);
    const legacy=priorProgress&&priorProgress.planSha256===plan.planSha256?priorProgress:null;
    const checkpoint=await saveNativeCheckpoint(root,{
      schema:configuration.schema,status:'native-retained',startedAt:operation.startedAt,completedAt:new Date().toISOString(),configuration,
      source:{captureId:plan.captureId,captureSha256:CAPTURE_SHA,results:1035,activities:13,stations:1,limits:1112,sourceRequests:0},
      reviewId:plan.reviewId,reviewSha256:plan.reviewSha256,planId:plan.planId,planSha256:plan.planSha256,
      options:choices,summary:plan.summary,files:plan.files,nativeDownloads:[],
      completeBundleSha256:plan.files.find(file=>file.format==='bundle').sha256,stableAcrossLaterProjectRevision:null,
      preparation:{mode:preparedBundle?'completed-bundle-received':'saved-plan-reopened',retainedFiles,priorProgress:legacy}
    });
    await phaseProgress(root,operation,'native-complete',{planSha256:checkpoint.planSha256,checkpointSha256:checkpoint.checkpointSha256},onProgress);
    return checkpoint;
  }finally{bundle=null;bundleBytes=null;await project?.close();}
}
async function receiveBundleHttp(workspace,file) {
  const state=await workspace.view();
  async function* body(){yield Buffer.from('{"bundle":');for await(const chunk of createReadStream(file))yield chunk;yield Buffer.from('}');}
  const response=await fetch(workspace.url+'/api/open-waters/receive',{method:'POST',duplex:'half',
    headers:{'content-type':'application/json','x-workspace-token':state.token,origin:workspace.url},body:body()});
  const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;
}
async function receivePreparedOpenWaters({directory,browser=false,playwrightModule,browserExecutable,onProgress}={}) {
  const root=resolve(directory),checkpoint=await readOpenWatersNativeResult(root);
  const operation=await readOrNull(join(root,'open-waters-operation.json'));
  const previous=await readOrNull(join(root,RECEIVING_FILE));
  if(previous&&previous.nativeCheckpointSha256===checkpoint.checkpointSha256&&(!browser||previous.browser?.status==='PASS'))return previous;
  let workspace,browserResult=null;
  try{
    await phaseProgress(root,operation,browser?'browser-resume':'receive-resume',{planSha256:checkpoint.planSha256},onProgress);
    if(browser){
      const {runOpenWatersBrowserJourney}=await import('./openwaters-browser-journey.mjs');
      const retained=await readOrNull(join(root,'browser','open-waters-browser-result.json'));
      if(retained?.status==='PASS'&&retained.planSha256===checkpoint.planSha256&&retained.reviewSha256===checkpoint.reviewSha256)browserResult=retained;
      else browserResult=await runOpenWatersBrowserJourney({
        directory:join(root,'project'),reviewId:checkpoint.reviewId,options:checkpoint.options,planId:checkpoint.planId,
        outputDirectory:await privateDirectory(join(root,'browser')),receiverDirectory:join(root,'receiver'),
        resume:true,expectedPlanSha256:checkpoint.planSha256,playwrightModule,browserExecutable
      });
      assert.equal(browserResult.planSha256,checkpoint.planSha256);assert.equal(browserResult.reviewSha256,checkpoint.reviewSha256);
    }else{
      workspace=await startWaterQualityWorkspace({directory:join(root,'receiver'),transport:retainedOnly});
      let received;
      try{received=await workspace.project.readOpenWaters(checkpoint.planId);}
      catch(error){if(error.code!=='ENOENT')throw error;}
      if(!received)received=await receiveBundleHttp(workspace,join(root,'exports',checkpoint.files.find(file=>file.format==='bundle').filename));
      assert.equal(received.planSha256,checkpoint.planSha256);equal(received.files,checkpoint.files);
    }
    const result={schema:checkpoint.schema,status:'received',nativeCheckpointSha256:checkpoint.checkpointSha256,
      planId:checkpoint.planId,planSha256:checkpoint.planSha256,reviewSha256:checkpoint.reviewSha256,
      receivedAt:new Date().toISOString(),browser:browserResult};
    await atomicJson(root,RECEIVING_FILE,result);
    await phaseProgress(root,operation,'receiving-complete',{planSha256:checkpoint.planSha256},onProgress);return result;
  }finally{await workspace?.close();}
}
async function verifyPreparedOpenWaters({directory,onProgress}={}) {
  const root=resolve(directory),checkpoint=await readOpenWatersNativeResult(root),operation=await readOrNull(join(root,'open-waters-operation.json'));
  const receiving=await readOrNull(join(root,RECEIVING_FILE));assert(receiving);assert.equal(receiving.nativeCheckpointSha256,checkpoint.checkpointSha256);
  let receiver;
  try{
    await phaseProgress(root,operation,'verify-received-exports',{planSha256:checkpoint.planSha256},onProgress);
    receiver=await openWaterQualityProject(join(root,'receiver'),{transport:retainedOnly});
    const receivedPlan=await receiver.readOpenWaters(checkpoint.planId),receivedReview=await receiver.readReview(checkpoint.reviewId);
    assert.equal(receivedPlan.planSha256,checkpoint.planSha256);equal(receivedPlan.files,checkpoint.files);
    assert.equal(receivedReview.reviewSha256,checkpoint.reviewSha256);
    assert.equal((await receiver.capture(checkpoint.source.captureId)).captureSha256,CAPTURE_SHA);
    const receivedFiles=[];
    for(const entry of checkpoint.files){
      const value=await receiver.exportOpenWaters({planId:checkpoint.planId,format:entry.format});
      assert.equal(value.bytes.length,entry.bytes);assert.equal(sha(value.bytes),entry.sha256);
      receivedFiles.push({format:entry.format,bytes:entry.bytes,sha256:entry.sha256});
    }
    const result={schema:checkpoint.schema,status:'complete',startedAt:checkpoint.startedAt,completedAt:new Date().toISOString(),
      source:checkpoint.source,projectDirectory:join(root,'project'),receiverDirectory:join(root,'receiver'),
      reviewId:checkpoint.reviewId,reviewSha256:checkpoint.reviewSha256,planId:checkpoint.planId,planSha256:checkpoint.planSha256,
      options:checkpoint.options,summary:checkpoint.summary,files:checkpoint.files,nativeDownloads:checkpoint.nativeDownloads,receivedFiles,
      completeBundleSha256:checkpoint.completeBundleSha256,stableAcrossLaterProjectRevision:checkpoint.stableAcrossLaterProjectRevision,
      nativeCheckpointSha256:checkpoint.checkpointSha256,preparation:checkpoint.preparation,browser:receiving.browser};
    await atomicJson(root,'open-waters-result.json',result);await phaseProgress(root,operation,'complete',{summary:result.summary,planSha256:result.planSha256},onProgress);
    return result;
  }finally{await receiver?.close();}
}
async function isolatedPhase(phase,input) {
  const {onProgress,...serializable}=input;
  return new Promise((resolveResult,reject)=>{
    const inherited=[];
    for(let index=0;index<process.execArgv.length;index++){
      const arg=process.execArgv[index];
      if(/^--max-old-space-size=\d+$/u.test(arg)||arg==='--expose-gc')inherited.push(arg);
      else if(arg==='--max-old-space-size'&&/^\d+$/u.test(process.execArgv[index+1]??''))inherited.push(arg,process.execArgv[++index]);
    }
    const child=fork(fileURLToPath(import.meta.url),['--phase-worker',phase],{
      execArgv:inherited,stdio:['ignore','inherit','inherit','ipc'],serialization:'advanced'
    });
    let result,failure,pending=Promise.resolve();
    child.on('message',message=>{
      if(message?.type==='progress')pending=pending.then(()=>onProgress?.(message.value));
      else if(message?.type==='result')result=message.value;
      else if(message?.type==='error')failure=Object.assign(new Error(message.error.message),message.error);
    });
    child.once('error',reject);
    child.once('exit',(code,signal)=>{
      pending.then(()=>{
        if(failure)reject(failure);
        else if(code!==0||!result)reject(Object.assign(new Error('Open Waters '+phase+' phase ended '+(signal??code)+'. Resume this same directory from its retained checkpoint.'),{code:'WQX_OPEN_WATERS_PHASE_INTERRUPTED',phase,signal,exitCode:code}));
        else resolveResult(result);
      },reject);
    });
    child.send(serializable,error=>{if(error)reject(error);});
  });
}
async function bindCheckpointInput(checkpoint,input) {
  if(input.options)equal(normalizeOpenWatersOptions(input.options),checkpoint.options,'Resume the original receiving choices.');
  if(input.preparedBundle){
    const completed=checkpoint.files.find(file=>file.format==='bundle'),provided=await fingerprint(resolve(input.preparedBundle));
    assert.equal(provided.bytes,completed.bytes);assert.equal(provided.sha256,completed.sha256,'Resume from this operation’s complete bundle.');
  }
}
export async function resumeOpenWatersJourney(input={}) {
  assert(input.directory,'Choose the original receiving directory.');
  if(!await readOrNull(join(resolve(input.directory),NATIVE_FILE)))await isolatedPhase('adopt',input);
  const checkpoint=await readOpenWatersNativeResult(input.directory);
  await bindCheckpointInput(checkpoint,input);
  const existing=await readOrNull(join(resolve(input.directory),'open-waters-result.json'));
  if(existing?.status==='complete'&&(!input.browser||existing.browser?.status==='PASS')){
    if(existing.nativeCheckpointSha256===checkpoint.checkpointSha256)return existing;
  }
  await isolatedPhase('receive',input);return isolatedPhase('verify',input);
}
export async function runOpenWatersJourney(input={}) {
  assert(input.directory,'Choose --directory for the retained complete receiving operation.');
  const root=await privateDirectory(resolve(input.directory));input={...input,directory:root};
  const existing=await readOrNull(join(root,NATIVE_FILE));
  const checkpoint=existing?await readOpenWatersNativeResult(root):
    await isolatedPhase(input.resume||input.preparedBundle?'adopt':'native',input);
  await bindCheckpointInput(checkpoint,input);
  if(input.nativeOnly)return checkpoint;
  return resumeOpenWatersJourney(input);
}
const HELP=`Open Waters complete receiving
  node openwaters-journey.mjs --directory DIR [--capture DIR | --source-bundle FILE] [--browser]
  node openwaters-journey.mjs --directory SAME_DIR --resume --browser
  node openwaters-journey.mjs --directory RECEIVING_DIR --prepared-bundle COMPLETE.json --resume --browser

Native preparation writes open-waters-native-result.json and exits before the browser starts.
--native-only stops after that completed native phase.
--resume opens the original saved plan and exact exports, including an interrupted pre-checkpoint run.
--prepared-bundle receives the completed portable bundle into the same operation on another host.
--options FILE must match the saved mapping choices.
--playwright-module PATH and --browser-executable PATH select an installed browser runtime.
The original source capture, saved plan, exports, receiving project, checkpoints and browser files stay in DIR.
`;
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv[2]==='--phase-worker'){
    const phase=process.argv[3],work={native:prepareOpenWatersJourney,adopt:adoptOpenWatersJourney,receive:receivePreparedOpenWaters,verify:verifyPreparedOpenWaters}[phase];
    if(!work)throw Error('Unknown Open Waters phase.');
    process.once('message',async input=>{
      const send=value=>new Promise((accept,reject)=>process.send(value,error=>error?reject(error):accept()));
      try{
        const value=await work({...input,onProgress:value=>send({type:'progress',value})});
        await send({type:'result',value});
      }catch(error){
        await atomicJson(resolve(input.directory),'open-waters-error.json',{stage:phase,at:new Date().toISOString(),code:error.code??error.name,message:error.message,stack:error.stack}).catch(()=>{});
        await send({type:'error',error:{message:error.message,code:error.code??error.name,stack:error.stack}}).catch(()=>{});process.exitCode=1;
      }finally{process.disconnect();}
    });
  }else{
    const args=process.argv.slice(2),input={};let optionFile;
    while(args.length){
      const name=args.shift();
      if(name==='--help'||name==='-h'){process.stdout.write(HELP);args.length=0;input.help=true;break;}
      if(name==='--browser'){input.browser=true;continue;}
      if(name==='--resume'){input.resume=true;continue;}
      if(name==='--native-only'){input.nativeOnly=true;continue;}
      const value=args.shift();if(!value)throw Error('Supply a value for '+name+'.');
      if(name==='--directory')input.directory=value;else if(name==='--capture')input.captureDirectory=value;else if(name==='--source-bundle')input.sourceBundle=value;
      else if(name==='--prepared-bundle')input.preparedBundle=value;
      else if(name==='--options')optionFile=value;else if(name==='--playwright-module')input.playwrightModule=value;else if(name==='--browser-executable')input.browserExecutable=value;
      else throw Error('Unknown receiving option '+name+'.');
    }
    if(!input.help){
      if(!input.directory)throw Error('Choose --directory for the retained complete receiving operation.');
      if(optionFile)input.options=JSON.parse(await readFile(resolve(optionFile),'utf8'));
      input.onProgress=value=>process.stdout.write(json({stage:value.stage,at:value.updatedAt,summary:value.summary}));
      runOpenWatersJourney(input).then(value=>process.stdout.write(json(value))).catch(error=>{console.error(error);process.exitCode=1;});
    }
  }
}
