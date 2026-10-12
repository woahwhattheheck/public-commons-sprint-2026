// MIT. Complete original-capture receiving through the Open Waters workspace.
import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
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
export async function runOpenWatersJourney({directory,captureDirectory,sourceBundle,options,browser=false,
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
    await progress('receive',{planSha256:plan.planSha256,summary:plan.summary,files});
    let browserResult=null;
    if(browser){
      const {runOpenWatersBrowserJourney}=await import('./openwaters-browser-journey.mjs');
      browserResult=await runOpenWatersBrowserJourney({directory:projectDirectory,reviewId,options:choices,planId,
        outputDirectory:await privateDirectory(join(root,'browser')),receiverDirectory,workspace,playwrightModule,browserExecutable});
    }else{
      receiverWorkspace=await startWaterQualityWorkspace({directory:receiverDirectory,transport:originalOnly});
      const receivedPlan=await requestJson(receiverWorkspace,'/api/open-waters/receive',{bundle:JSON.parse(before.bytes)});assert.equal(receivedPlan.planSha256,plan.planSha256);
      await receiverWorkspace.close();receiverWorkspace=null;
    }
    receiver=await openWaterQualityProject(receiverDirectory,{transport:originalOnly});
    const receivedPlan=await receiver.readOpenWaters(planId),receivedReview=await receiver.readReview(reviewId);
    assert.equal(receivedPlan.planSha256,plan.planSha256);equal(receivedPlan.files,files);assert.equal(receivedReview.reviewSha256,review.reviewSha256);
    assert.equal((await receiver.capture(upstream.operationId)).captureSha256,CAPTURE_SHA);
    const receivedFiles=[];
    for(const entry of files){const value=await receiver.exportOpenWaters({planId,format:entry.format});assert.equal(value.bytes.length,entry.bytes);assert.equal(sha(value.bytes),entry.sha256);receivedFiles.push({format:entry.format,bytes:entry.bytes,sha256:entry.sha256});}
    assert.equal(sourceRequests,0);
    const result={schema:configuration.schema,status:'complete',startedAt:operation.startedAt,completedAt:new Date().toISOString(),
      source:{captureSha256:CAPTURE_SHA,results:1035,activities:13,stations:1,limits:1112,sourceRequests},
      projectDirectory,receiverDirectory,reviewId,reviewSha256:review.reviewSha256,planId,planSha256:plan.planSha256,
      options:choices,summary:plan.summary,files,nativeDownloads,receivedFiles,completeBundleSha256:completeFile.sha256,
      stableAcrossLaterProjectRevision:true,browser:browserResult};
    await atomicJson(root,'open-waters-result.json',result);await progress('complete',{summary:plan.summary,planSha256:plan.planSha256});return result;
  }catch(error){
    await atomicJson(root,'open-waters-error.json',{stage,at:new Date().toISOString(),code:error.code??error.name,message:error.message,stack:error.stack});throw error;
  }finally{await receiver?.close();await receiverWorkspace?.close();await workspace?.close();await project?.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),input={};let optionFile;
  while(args.length){
    const name=args.shift();if(name==='--browser'){input.browser=true;continue;}const value=args.shift();if(!value)throw Error('Supply a value for '+name+'.');
    if(name==='--directory')input.directory=value;else if(name==='--capture')input.captureDirectory=value;else if(name==='--source-bundle')input.sourceBundle=value;
    else if(name==='--options')optionFile=value;else if(name==='--playwright-module')input.playwrightModule=value;else if(name==='--browser-executable')input.browserExecutable=value;
    else throw Error('Unknown receiving option '+name+'.');
  }
  if(!input.directory)throw Error('Choose --directory for the retained complete receiving operation.');
  if(optionFile)input.options=JSON.parse(await readFile(resolve(optionFile),'utf8'));
  input.onProgress=value=>process.stdout.write(json({stage:value.stage,at:value.updatedAt,summary:value.summary}));
  runOpenWatersJourney(input).then(value=>process.stdout.write(json(value))).catch(error=>{console.error(error);process.exitCode=1;});
}
