// MIT. Original-policy commissioning, retained source capture and offline receiving.
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readdir, lstat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { privateDirectory, readBytes, readJson, writeBytes, writeJson, jsonBytes,
  syncDirectory, exists, need, object, safeCode } from '../../../../sf88-operator-buyer-cli/node/store.mjs';
import { withPrivateLock } from '../../../routescan/quota.mjs';
import { createStacProvider, canonicalJson } from '../../provider.mjs';
import { PLAN_SCHEMA, RUN_SCHEMA, PACKAGE_SCHEMA, digest, bytesDigest, clone, identifier,
  approvalBinding, prepareCommissioningPlan, verifyPlan, retainedRequestMatches,
  inspectObservation, compareCommissioningRuns, commissioningReport } from './model.mjs';

const SCHEMA='scf-eoapi-commissioning-workspace/v1';
const MAX=64*1024*1024, PACKAGE_MAX=256*1024*1024;
const now=()=>new Date().toISOString();
const safePart=value=>{need(typeof value==='string'&&/^[a-z]+-[a-f0-9]{24,64}$/.test(value),'EOAPI_COMMISSIONING_PATH_INVALID');return value;};
const relative=value=>{
  need(typeof value==='string'&&value.length<=1000&&value.split('/').every(part=>/^[A-Za-z0-9._-]+$/.test(part)&&!['.','..'].includes(part)),
    'EOAPI_COMMISSIONING_PATH_INVALID');return value;
};
const errorCode=error=>safeCode(error?.code,'EOAPI_COMMISSIONING_SOURCE_FAILED');
async function retainedFile(path,limit=MAX){
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const info=await handle.stat();
    need(info.isFile()&&info.size<=limit&&(process.platform==='win32'||(!(info.mode&0o077)&&(!process.getuid||info.uid===process.getuid()))),
      'EOAPI_COMMISSIONING_PRIVATE_FILE_REQUIRED');
    const data=await handle.readFile();need(data.length<=limit,'EOAPI_COMMISSIONING_FILE_LIMIT');return data;
  }finally{await handle.close();}
}
async function exactWrite(path,raw){
  if(await exists(path)){
    const current=await retainedFile(path,raw.length);
    need(current.equals(raw),'EOAPI_COMMISSIONING_DESTINATION_CONFLICT');
    const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));try{await file.sync();}finally{await file.close();}
  }else await writeBytes(path,raw);
  await syncDirectory(dirname(path));
}
function checkRun(run,workspaceId){
  need(object(run)&&run.schema===RUN_SCHEMA&&run.workspaceId===workspaceId&&
    ['PENDING','RUNNING','INTERRUPTED','COMPLETE'].includes(run.status)&&Array.isArray(run.attempts)&&Array.isArray(run.results),
    'EOAPI_COMMISSIONING_RUN_INVALID');
  safePart(run.id);safePart(run.planId);identifier(run.operationId);
  return run;
}
function revalidate(plan,binding){
  need(plan.policyWorkspaceId===binding.workspaceId&&plan.approvalId===binding.approval.id&&plan.policyDigest===binding.policyDigest,
    'EOAPI_COMMISSIONING_APPROVAL_CHANGED');
  const input={title:plan.title,approvalId:plan.approvalId,target:plan.target,minimumIntervalMs:plan.minimumIntervalMs,
    ...(plan.note?{note:plan.note}:{}),cases:plan.cases.map(row=>({
      id:row.id,title:row.title,principal:row.principal,request:row.request,expect:row.expect
    }))};
  const prepared=prepareCommissioningPlan(input,binding,{assets:plan.cases.map(row=>row.sourceAsset).filter(Boolean)});
  need(prepared.digest===plan.digest,'EOAPI_COMMISSIONING_PLAN_CHANGED');return prepared;
}
const responseFiles=['request.json','response.json','response.bin'];
async function readResponse(path,entry){
  if(!await exists(join(path,'response.json')))return null;
  need(await exists(join(path,'response.bin'))&&await exists(join(path,'request.json')),'EOAPI_COMMISSIONING_SOURCE_INCOMPLETE');
  const [request,record,raw]=await Promise.all([
    readJson(join(path,'request.json'),1024*1024),readJson(join(path,'response.json'),1024*1024),retainedFile(join(path,'response.bin'))
  ]);
  need(retainedRequestMatches(entry.request,request.request)&&retainedRequestMatches(entry.request,record.request),
    'EOAPI_COMMISSIONING_SOURCE_REQUEST_CHANGED');
  need(request.requestHash===bytesDigest(canonicalJson(request.request))&&record.requestHash===bytesDigest(canonicalJson(record.request)),
    'EOAPI_COMMISSIONING_SOURCE_REQUEST_CHANGED');
  return {request,record,raw,observation:inspectObservation(entry,record,raw)};
}
function refsFrom(state){
  const result=new Map(),seen=new Set();
  const walk=value=>{
    if(!value||typeof value!=='object'||seen.has(value))return;seen.add(value);
    if(typeof value.directory==='string'&&/^captures\/[A-Za-z0-9._-]+$/.test(value.directory)&&object(value.request))
      result.set(value.directory,value);
    for(const child of Object.values(value))walk(child);
  };
  walk(state.catalogSources??[]);walk(state.editions??[]);return result;
}
function payloadMap(bundle){
  need(object(bundle)&&bundle.schema===PACKAGE_SCHEMA&&Array.isArray(bundle.files)&&bundle.files.length<=1024,
    'EOAPI_COMMISSIONING_PACKAGE_INVALID');
  const {digest:given,...body}=bundle;need(given===digest(body),'EOAPI_COMMISSIONING_PACKAGE_CHANGED');
  verifyPlan(bundle.plan);checkRun(bundle.run,bundle.sourceWorkspaceId);
  need(bundle.run.status==='COMPLETE'&&bundle.run.planDigest===bundle.plan.digest&&bundle.run.results.length===bundle.plan.cases.length,
    'EOAPI_COMMISSIONING_COMPLETE_RUN_REQUIRED');
  const files=new Map();let bytes=0;
  for(const file of bundle.files){
    relative(file.path);
    need(/^captures\/attempt-[a-f0-9]{32}\/(?:request\.json|response\.json|response\.bin)$/.test(file.path)&&!files.has(file.path),
      'EOAPI_COMMISSIONING_PACKAGE_PATH_INVALID');
    need(Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=MAX&&typeof file.contentBase64==='string'&&
      file.contentBase64.length===Math.ceil(file.bytes/3)*4,'EOAPI_COMMISSIONING_PACKAGE_FILE_INVALID');
    const raw=Buffer.from(file.contentBase64,'base64');bytes+=raw.length;
    need(bytes<=PACKAGE_MAX&&raw.length===file.bytes&&raw.toString('base64')===file.contentBase64&&bytesDigest(raw)===file.sha256,
      'EOAPI_COMMISSIONING_PACKAGE_FILE_CHANGED');
    files.set(file.path,raw);
  }
  const cases=new Map(bundle.plan.cases.map(row=>[row.id,row])),resultIds=new Set();
  for(const result of bundle.run.results){
    const entry=cases.get(result.caseId);
    need(entry&&!resultIds.has(result.caseId)&&object(result.source),'EOAPI_COMMISSIONING_PACKAGE_RESULT_INVALID');
    resultIds.add(result.caseId);
    const path=relative(result.source.path);
    const raw=files.get(path+'/response.bin'),metadata=files.get(path+'/response.json'),requestRaw=files.get(path+'/request.json');
    need(raw&&metadata&&requestRaw,'EOAPI_COMMISSIONING_PACKAGE_SOURCE_MISSING');
    const record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(metadata));
    const request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(requestRaw));
    need(retainedRequestMatches(entry.request,request.request)&&retainedRequestMatches(entry.request,record.request)&&
      request.requestHash===bytesDigest(canonicalJson(request.request))&&record.requestHash===bytesDigest(canonicalJson(record.request)),'EOAPI_COMMISSIONING_SOURCE_REQUEST_CHANGED');
    const observed=inspectObservation(entry,record,raw);
    for(const key of Object.keys(observed))need(canonicalJson(observed[key])===canonicalJson(result[key]),'EOAPI_COMMISSIONING_PACKAGE_RESULT_CHANGED');
  }
  return {files,bytes};
}
export function inspectCommissioningPackage(bundle){
  const {files,bytes}=payloadMap(bundle);
  return {schema:PACKAGE_SCHEMA,digest:bundle.digest,sourceWorkspaceId:bundle.sourceWorkspaceId,
    runId:bundle.run.id,planDigest:bundle.plan.digest,files:files.size,bytes,report:commissioningReport(bundle.run,bundle.plan)};
}
export async function openCommissioningWorkspace({directory,policyWorkspace,sourceRuntimeFor,stacWorkspace,
  create=true,title='Deployment commissioning'}={}){
  directory=await privateDirectory(directory,{create});
  const statePath=join(directory,'workspace.json');
  for(const name of ['plans','runs','imports'])await privateDirectory(join(directory,name),{create});
  await syncDirectory(directory);await syncDirectory(dirname(directory));
  await withPrivateLock(directory,'workspace.lock',async()=>{
    if(!await exists(statePath)){
      need(create,'EOAPI_COMMISSIONING_WORKSPACE_NOT_FOUND');
      need(typeof title==='string'&&title.length>0&&title.length<=300,'EOAPI_COMMISSIONING_TITLE_INVALID');
      await writeJson(statePath,{schema:SCHEMA,id:'commissioning-'+randomUUID().replaceAll('-',''),title,createdAt:now()});
    }
  });
  const state=await readJson(statePath,1024*1024);
  need(state.schema===SCHEMA&&typeof state.id==='string','EOAPI_COMMISSIONING_WORKSPACE_INVALID');
  let closed=false,closePromise=null;const active=new Map(),pending=new Set();
  const tracked=fn=>(...args)=>{
    need(!closed,'EOAPI_COMMISSIONING_WORKSPACE_CLOSED');
    const operation=Promise.resolve().then(()=>fn(...args));pending.add(operation);
    operation.then(()=>pending.delete(operation),()=>pending.delete(operation));return operation;
  };
  const planPath=id=>join(directory,'plans',safePart(id)+'.json');
  const runDirectory=id=>join(directory,'runs',safePart(id));
  async function getPlan(id){return verifyPlan(await readJson(planPath(id),4*1024*1024));}
  async function getRun(id){return checkRun(await readJson(join(runDirectory(id),'run.json'),16*1024*1024),state.id);}
  const saveRun=run=>writeJson(join(runDirectory(run.id),'run.json'),run);
  async function currentBinding(plan){
    need(policyWorkspace&&typeof policyWorkspace.getState==='function','EOAPI_COMMISSIONING_POLICY_CONNECTION_REQUIRED');
    return approvalBinding(await policyWorkspace.getState(),plan.approvalId);
  }
  async function savePlan({input,operationId}={}){
    identifier(operationId);need(!closed,'EOAPI_COMMISSIONING_WORKSPACE_CLOSED');
    need(policyWorkspace&&typeof policyWorkspace.getState==='function','EOAPI_COMMISSIONING_POLICY_CONNECTION_REQUIRED');
    const binding=approvalBinding(await policyWorkspace.getState(),input?.approvalId);
    const source=stacWorkspace?await stacWorkspace.getState():null;
    const assets=[];
    for(const review of source?.assetReviews??[])if(object(review)&&typeof review.href==='string')assets.push(review);
    const plan=prepareCommissioningPlan(input,binding,{assets});
    const id='plan-'+digest({workspaceId:state.id,operationId}).slice(0,32);
    return withPrivateLock(directory,'workspace.lock',async()=>{
      const path=planPath(id);
      if(await exists(path)){const existing=await getPlan(id);need(existing.digest===plan.digest,'EOAPI_COMMISSIONING_OPERATION_CHANGED');return {id,plan:existing,reused:true};}
      await writeJson(path,plan);return {id,plan,reused:false};
    });
  }
  async function createRun({planId,operationId}={}){
    need(!closed,'EOAPI_COMMISSIONING_WORKSPACE_CLOSED');identifier(operationId);
    const plan=await getPlan(planId);revalidate(plan,await currentBinding(plan));
    const id='run-'+digest({workspaceId:state.id,operationId}).slice(0,32),location=runDirectory(id);
    return withPrivateLock(directory,'workspace.lock',async()=>{
      await privateDirectory(location);await syncDirectory(dirname(location));
      if(await exists(join(location,'run.json'))){
        const original=await getRun(id);need(original.planId===planId&&original.operationId===operationId,'EOAPI_COMMISSIONING_OPERATION_CHANGED');
        return {...original,reused:true};
      }
      await privateDirectory(join(location,'captures'));await syncDirectory(location);
      const run={schema:RUN_SCHEMA,id,workspaceId:state.id,operationId,planId,planDigest:plan.digest,
        policyDigest:plan.policyDigest,approvalId:plan.approvalId,status:'PENDING',createdAt:now(),updatedAt:now(),
        completedAt:null,attempts:[],results:[],error:null};
      await saveRun(run);return run;
    });
  }
  function controllerFor(runId,signal){
    need(!active.has(runId),'EOAPI_COMMISSIONING_RUN_ACTIVE');
    const controller=new AbortController(),stop=()=>controller.abort(signal.reason);
    if(signal?.aborted)stop();else signal?.addEventListener('abort',stop,{once:true});
    active.set(runId,controller);
    return {controller,release:()=>{signal?.removeEventListener('abort',stop);active.delete(runId);}};
  }
  async function finishObservation(run,entry,attempt,captured){
    const retained=join(runDirectory(run.id),relative(attempt.path));
    await syncDirectory(retained);await syncDirectory(dirname(retained));
    const original=run.results.find(row=>row.caseId===entry.id);
    const result={...captured.observation,source:{path:attempt.path,attemptId:attempt.id,mode:attempt.mode,
      sourceWorkspaceId:attempt.sourceWorkspaceId??state.id,captureRef:attempt.captureRef??attempt.path,sourceImports:attempt.sourceImports??[]}};
    if(original)need(digest(original)===digest(result),'EOAPI_COMMISSIONING_RESULT_CHANGED');else run.results.push(result);
    attempt.status='COMPLETE';attempt.completedAt=now();attempt.response={bytes:captured.record.bytes,sha256:captured.record.sha256,status:captured.record.status};
    run.results.sort((a,b)=>run.planCaseOrder.indexOf(a.caseId)-run.planCaseOrder.indexOf(b.caseId));
    run.status=run.results.length===run.planCaseOrder.length?'COMPLETE':'RUNNING';
    run.error=null;run.updatedAt=now();if(run.status==='COMPLETE')run.completedAt??=run.updatedAt;
    await saveRun(run);return result;
  }
  async function recoverResponses(run,plan){
    run.planCaseOrder??=plan.cases.map(row=>row.id);
    for(const entry of plan.cases){
      if(run.results.some(row=>row.caseId===entry.id))continue;
      for(const attempt of run.attempts.filter(row=>row.caseId===entry.id).reverse()){
        const response=await readResponse(join(runDirectory(run.id),relative(attempt.path)),entry);
        if(response){await finishObservation(run,entry,attempt,response);break;}
      }
    }
    return run;
  }
  async function executeRun({runId,signal}={}){
    need(!closed,'EOAPI_COMMISSIONING_WORKSPACE_CLOSED');
    const local=controllerFor(runId,signal),{controller}=local;
    try{
      return await withPrivateLock(runDirectory(runId),'run.lock',async()=>{
        let run=await getRun(runId);const plan=await getPlan(run.planId);
        need(run.planDigest===plan.digest,'EOAPI_COMMISSIONING_RUN_PLAN_CHANGED');
        if(run.status==='COMPLETE')return {...run,reused:true};
        revalidate(plan,await currentBinding(plan));run=await recoverResponses(run,plan);
        if(run.status==='COMPLETE')return {...run,reused:true};
        run.status='RUNNING';run.updatedAt=now();run.error=null;await saveRun(run);
        for(const entry of plan.cases){
          if(run.results.some(row=>row.caseId===entry.id))continue;
          controller.signal.throwIfAborted();
          const previous=run.attempts.at(-1);
          if(previous?.dispatchedAt&&plan.minimumIntervalMs){
            const remaining=Date.parse(previous.dispatchedAt)+plan.minimumIntervalMs-Date.now();
            if(remaining>0)await new Promise((resolveWait,reject)=>{
              const timer=setTimeout(done,remaining);
              const aborted=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',aborted);reject(controller.signal.reason);};
              function done(){controller.signal.removeEventListener('abort',aborted);resolveWait();}
              controller.signal.addEventListener('abort',aborted,{once:true});
              if(controller.signal.aborted)aborted();
            });
          }
          let runtime;
          if(sourceRuntimeFor)runtime=await sourceRuntimeFor({principal:entry.principal,endpoint:plan.endpoint,signal:controller.signal});
          else {need(entry.principal==='anonymous','EOAPI_COMMISSIONING_PRIVATE_CONNECTION_REQUIRED');runtime={};}
          need(object(runtime)&&(!runtime.sourceAuth||entry.principal!=='anonymous'),'EOAPI_COMMISSIONING_PRINCIPAL_CONNECTION_MISMATCH');
          if(entry.principal!=='anonymous')need(runtime.sourceAuth&&typeof runtime.sourceAuth.requestHeaders==='function'&&
            typeof runtime.sourceAuth.authorizationForOrigin==='function'&&runtime.sourceAuth.authorizationForOrigin(new URL(entry.request.url).origin),
            'EOAPI_COMMISSIONING_PRIVATE_CONNECTION_REQUIRED');
          const provider=createStacProvider({endpoint:plan.endpoint,transport:runtime.transport,sourceAuth:runtime.sourceAuth});
          const attempt={id:'attempt-'+randomUUID().replaceAll('-',''),caseId:entry.id,mode:'dispatch',
            status:'DISPATCHING',dispatchedAt:now(),completedAt:null};
          attempt.path='captures/'+attempt.id;
          run.attempts.push(attempt);run.updatedAt=now();await saveRun(run);
          let failure=null;
          try{await provider.captureJson(entry.request,{directory:join(runDirectory(run.id),attempt.path),signal:controller.signal});}
          catch(error){failure=error;}
          const captured=await readResponse(join(runDirectory(run.id),attempt.path),entry);
          if(captured){await finishObservation(run,entry,attempt,captured);}
          else {
            attempt.status='INTERRUPTED';attempt.error=errorCode(failure);
            run.status='INTERRUPTED';run.error={caseId:entry.id,code:attempt.error,at:now()};run.updatedAt=now();
            await saveRun(run);return run;
          }
        }
        return run;
      });
    }catch(error){
      try{
        await withPrivateLock(runDirectory(runId),'run.lock',async()=>{
          const run=await getRun(runId);if(run.status!=='COMPLETE'){
            run.status='INTERRUPTED';run.error={code:errorCode(error),at:now()};run.updatedAt=now();await saveRun(run);
          }
        });
      }catch{}
      throw error;
    }finally{local.release();}
  }
  async function adoptCapture({runId,caseId,captureRef,sourceWorkspaceId}={}){
    need(stacWorkspace&&typeof stacWorkspace.getState==='function','EOAPI_COMMISSIONING_STAC_CONNECTION_REQUIRED');
    identifier(caseId);relative(captureRef);need(!closed,'EOAPI_COMMISSIONING_WORKSPACE_CLOSED');
    return withPrivateLock(runDirectory(runId),'run.lock',async()=>{
      const run=await getRun(runId),plan=await getPlan(run.planId),entry=plan.cases.find(row=>row.id===caseId);
      need(entry,'EOAPI_COMMISSIONING_CASE_NOT_FOUND');
      need(entry.principal==='anonymous','EOAPI_COMMISSIONING_RETAINED_PRINCIPAL_PROOF_REQUIRED');
      revalidate(plan,await currentBinding(plan));
      const source=await stacWorkspace.getState();
      need(source.id===sourceWorkspaceId&&source.endpoint===plan.endpoint,'EOAPI_COMMISSIONING_SOURCE_WORKSPACE_CHANGED');
      const registered=refsFrom(source).get(captureRef);
      need(registered&&retainedRequestMatches(entry.request,registered.request),'EOAPI_COMMISSIONING_CAPTURE_NOT_REGISTERED');
      const captured=await readResponse(join(stacWorkspace.directory,captureRef),entry);
      need(captured,'EOAPI_COMMISSIONING_CAPTURE_INCOMPLETE');
      const completed=run.results.find(row=>row.caseId===caseId);
      if(completed){
        need(completed.source.sourceWorkspaceId===sourceWorkspaceId&&completed.source.captureRef===captureRef&&
          completed.observed.sha256===captured.record.sha256,'EOAPI_COMMISSIONING_RESULT_CHANGED');
        return {run,reused:true};
      }
      run.planCaseOrder??=plan.cases.map(row=>row.id);
      let attempt=run.attempts.find(row=>row.caseId===caseId&&row.mode==='adopt'&&row.sourceWorkspaceId===sourceWorkspaceId&&row.captureRef===captureRef);
      if(!attempt){
        attempt={id:'attempt-'+randomUUID().replaceAll('-',''),caseId,mode:'adopt',status:'COPYING',sourceWorkspaceId,captureRef,
          dispatchedAt:null,sourceStartedAt:captured.record.startedAt,completedAt:null,
          sourceImports:(source.imports??[]).map(row=>({sourceWorkspaceId:row.sourceWorkspaceId,digest:row.digest,editionIds:row.editionIds,completedAt:row.completedAt}))};
        attempt.path='captures/'+attempt.id;run.attempts.push(attempt);run.updatedAt=now();await saveRun(run);
      }
      const destination=await privateDirectory(join(runDirectory(run.id),attempt.path));
      for(const name of responseFiles)await exactWrite(join(destination,name),await retainedFile(join(stacWorkspace.directory,captureRef,name),name==='response.bin'?MAX:1024*1024));
      await finishObservation(run,entry,attempt,await readResponse(destination,entry));
      return {run,reused:false};
    });
  }
  async function exportRun({runId}={}){
    return withPrivateLock(runDirectory(runId),'run.lock',async()=>{
      const run=await getRun(runId),plan=await getPlan(run.planId);
      need(run.status==='COMPLETE','EOAPI_COMMISSIONING_COMPLETE_RUN_REQUIRED');
      const files=[];let total=0;
      for(const attempt of run.attempts)for(const name of responseFiles){
        const path=relative(attempt.path+'/'+name),absolute=join(runDirectory(runId),path);
        if(!await exists(absolute))continue;
        const raw=await retainedFile(absolute,name==='response.bin'?MAX:1024*1024);total+=raw.length;
        need(total<=PACKAGE_MAX,'EOAPI_COMMISSIONING_PACKAGE_LIMIT');
        files.push({path,bytes:raw.length,sha256:bytesDigest(raw),contentBase64:raw.toString('base64')});
      }
      files.sort((a,b)=>a.path.localeCompare(b.path));
      const body={schema:PACKAGE_SCHEMA,sourceWorkspaceId:state.id,run:clone(run),plan:clone(plan),files};
      const bundle={...body,digest:digest(body)};inspectCommissioningPackage(bundle);return bundle;
    });
  }
  async function importPackage({package:bundle,operationId}={}){
    need(!closed,'EOAPI_COMMISSIONING_WORKSPACE_CLOSED');identifier(operationId);const inspection=inspectCommissioningPackage(bundle),payload=payloadMap(bundle);
    const id='import-'+digest({workspaceId:state.id,operationId}).slice(0,32),location=join(directory,'imports',id);
    return withPrivateLock(directory,'workspace.lock',async()=>{
      await privateDirectory(location);await syncDirectory(dirname(location));
      const intentPath=join(location,'intent.json'),completedPath=join(location,'receipt.json');
      if(await exists(intentPath)){
        const intent=await readJson(intentPath);
        need(intent.operationId===operationId&&intent.packageDigest===bundle.digest&&intent.workspaceId===state.id,
          'EOAPI_COMMISSIONING_IMPORT_OPERATION_CHANGED');
      }else{
        need((await readdir(location)).length===0,'EOAPI_COMMISSIONING_IMPORT_DESTINATION_CONFLICT');
        await writeJson(intentPath,{schema:'scf-eoapi-commissioning-import-intent/v1',operationId,workspaceId:state.id,
          packageDigest:bundle.digest,sourceWorkspaceId:bundle.sourceWorkspaceId,runId:bundle.run.id,createdAt:now()});
      }
      if(await exists(completedPath)){
        const receipt=await readJson(completedPath);need(receipt.packageDigest===bundle.digest,'EOAPI_COMMISSIONING_IMPORT_CHANGED');
        return {...receipt,reused:true};
      }
      for(const [path,raw] of payload.files){
        const target=join(location,relative(path));await privateDirectory(dirname(target));await exactWrite(target,raw);
      }
      await exactWrite(join(location,'plan.json'),jsonBytes(bundle.plan));
      await exactWrite(join(location,'run.json'),jsonBytes(bundle.run));
      await exactWrite(join(location,'package.json'),jsonBytes(bundle));
      const receipt={schema:'scf-eoapi-commissioning-import/v1',id,operationId,workspaceId:state.id,
        sourceWorkspaceId:bundle.sourceWorkspaceId,runId:bundle.run.id,packageDigest:bundle.digest,
        planDigest:bundle.plan.digest,files:inspection.files,bytes:inspection.bytes,completedAt:now()};
      await syncDirectory(join(location,'captures'));await syncDirectory(location);await syncDirectory(dirname(location));await writeJson(completedPath,receipt);
      return {...receipt,reused:false};
    });
  }
  async function getImported({importId}={}){
    const location=join(directory,'imports',safePart(importId));
    const receipt=await readJson(join(location,'receipt.json'));
    const bundle=await readJson(join(location,'package.json'),Math.ceil(PACKAGE_MAX*1.4)+16*1024*1024);
    need(receipt.packageDigest===bundle.digest,'EOAPI_COMMISSIONING_IMPORT_CHANGED');
    const inspection=inspectCommissioningPackage(bundle);
    return {receipt,report:inspection.report};
  }
  async function getState(){
    const plans=[],runs=[],imports=[];
    for(const name of (await readdir(join(directory,'plans'))).filter(name=>/^plan-[a-f0-9]{32}\.json$/.test(name)).sort()){
      const id=name.slice(0,-5),plan=await getPlan(id);
      plans.push({id,title:plan.title,digest:plan.digest,approvalId:plan.approvalId,policyDigest:plan.policyDigest,cases:plan.cases.length,target:plan.target,endpoint:plan.endpoint});
    }
    for(const name of (await readdir(join(directory,'runs'))).filter(name=>/^run-[a-f0-9]{32}$/.test(name)).sort()){
      if(!await exists(join(runDirectory(name),'run.json')))continue;
      const run=await getRun(name);
      runs.push({id:run.id,planId:run.planId,status:run.status,createdAt:run.createdAt,completedAt:run.completedAt,
        cases:run.results.length,passed:run.results.filter(row=>row.passed).length,failed:run.results.filter(row=>!row.passed).length,error:run.error});
    }
    for(const name of (await readdir(join(directory,'imports'))).filter(name=>/^import-[a-f0-9]{32}$/.test(name)).sort()){
      const file=join(directory,'imports',name,'receipt.json');if(await exists(file))imports.push(await readJson(file));
    }
    const policy=policyWorkspace?await policyWorkspace.getState():null;
    const approvals=(policy?.approvals??[]).map(value=>({id:value.id,reviewId:value.reviewId,policyDigest:value.policyDigest,reviewer:value.reviewer,at:value.at,current:value.id===policy.currentApprovalId,endpoint:policy.reviews.find(row=>row.id===value.reviewId)?.policy?.deployment?.publicUrl??null,upstream:policy.reviews.find(row=>row.id===value.reviewId)?.policy?.upstream?.url??null}));
    const source=stacWorkspace?await stacWorkspace.getState():null;
    const retainedCaptures=source?[...refsFrom(source)].map(([captureRef,row])=>({captureRef,sourceWorkspaceId:source.id,request:row.request,completedAt:row.completedAt??null})):[];
    return {...clone(state),plans,runs,imports,approvals,retainedCaptures};
  }
  async function getReport({runId}={}){const run=await getRun(runId);return commissioningReport(run,await getPlan(run.planId));}
  async function compareRuns({leftRunId,rightRunId}={}){return compareCommissioningRuns(await getRun(leftRunId),await getRun(rightRunId));}
  return Object.freeze({directory,getState:tracked(getState),getPlan:tracked(getPlan),getRun:tracked(getRun),getReport:tracked(getReport),
    savePlan:tracked(savePlan),createRun:tracked(createRun),executeRun:tracked(executeRun),adoptCapture:tracked(adoptCapture),
    exportRun:tracked(exportRun),importPackage:tracked(importPackage),getImported:tracked(getImported),compareRuns:tracked(compareRuns),
    close(){
      if(closePromise)return closePromise;closed=true;
      for(const controller of active.values())controller.abort(new Error('EOAPI_COMMISSIONING_WORKSPACE_CLOSED'));
      closePromise=Promise.allSettled([...pending]).then(()=>undefined);return closePromise;
    }
  });
}
