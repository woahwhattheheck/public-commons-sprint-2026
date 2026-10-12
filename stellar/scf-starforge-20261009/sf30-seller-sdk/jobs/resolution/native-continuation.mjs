#!/usr/bin/env node
// MIT. Continue one actually completed checkout through original job resolution and accounting.
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {openJobMerchant} from '../model.mjs';
import {startCustomerServer} from '../customer.mjs';
import {startJobsWorkspace} from '../workspace/server.mjs';
import {openAccountingWorkspace} from '../../../merchant-settlement-accounting/workspace/store.mjs';
import {compileTerms} from '../../../merchant-settlement-accounting/reconcile.mjs';
import {validateAdjustment,adjustmentRequest} from '../../../merchant-settlement-accounting/adjustments.mjs';
import {validStrKey} from '../../../sf86-rpc-transfer-reconcile/terms.mjs';
import {createPublicHttpsFetch} from '../../../sf31-buyer-client/public-transport.mjs';
import {acquireStateLease} from '../../../merchant-fleet-gateway/state-lease.mjs';
import {openJobWorkspace} from '../../../sf88-operator-buyer-cli/job-workspace/model.mjs';
import {startJobCustomerWorkspace} from '../../../sf88-operator-buyer-cli/job-workspace/server.mjs';
import {openJobResolutionBuyer} from '../../../sf88-operator-buyer-cli/job-workspace/resolution/client.mjs';
import {privateDirectory,readPrivate,readDocument,writeDocument} from './storage.mjs';
import {createOnlyFile} from './cli.mjs';
import {hash,json,need,jobBinding,validateReceipt,RESOLUTION_RECEIVING_BYTES} from './contract.mjs';

const OPERATION='SCF-PAID-JOB-RESOLUTION-0B8D-20261012';
export async function runJobResolutionContinuation({checkoutResult,directory:requestedDirectory,proofDirectory,signal}={}){
need(typeof checkoutResult==='string'&&checkoutResult.length>0,'JOB_RESOLUTION_COMPLETED_CHECKOUT_REQUIRED');
if(requestedDirectory!==undefined)need(typeof requestedDirectory==='string'&&requestedDirectory.length>0,'JOB_RESOLUTION_JOURNEY_ARGUMENTS');
if(proofDirectory!==undefined)need(typeof proofDirectory==='string'&&proofDirectory.length>0,'JOB_RESOLUTION_JOURNEY_ARGUMENTS');
const completedPath=resolve(checkoutResult),completedBytes=await readPrivate(completedPath,1024*1024);
const completed=JSON.parse(completedBytes);
need(completed.result==='PASS'&&completed.fixture?.protocol==='LOCAL_PAID_JOB_PROTOCOL'&&
  completed.checkout?.phase==='ACCEPTED'&&/^[a-f0-9]{64}$/.test(completed.checkout.jobEntryId??''),
  'JOB_RESOLUTION_COMPLETED_CHECKOUT_REQUIRED');
const fixture=resolve(completed.fixtureDirectory),customerDirectory=resolve(completed.customerWorkspace);
need(fixture===completed.fixtureDirectory&&customerDirectory===join(fixture,'customer-workspace')&&
  fixture.startsWith(resolve(completed.retainedWorkDirectory)+'/'),'JOB_RESOLUTION_ORIGINAL_FIXTURE_CHANGED');
const directory=requestedDirectory?resolve(requestedDirectory):join(fixture,'resolution-continuation');
await privateDirectory(directory);
const lease=await acquireStateLease(directory),statePath=join(directory,'operation.json'),output=join(directory,'native-result.json');
const configPath=join(fixture,'merchant.json'),merchantDirectory=join(fixture,'merchant-state');
const accountingDirectory=join(directory,'accounting-workspace'),entryId=completed.checkout.jobEntryId;
const stop=new AbortController(),interrupt=()=>stop.abort(Object.assign(new Error('JOB_RESOLUTION_JOURNEY_STOPPED'),{code:'JOB_RESOLUTION_JOURNEY_STOPPED'}));
const abort=()=>stop.abort(signal?.reason);
if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
let customerModel,customerHost,merchant,merchantHost,customerListener,accounting,received,plan,jobId,buyerDirectory;
let phase='open original customer',complete=false,traffic={status:0,resolutionReads:0,issuePosts:0,messagePosts:0};
const deadline=setTimeout(()=>stop.abort(Object.assign(new Error('JOB_RESOLUTION_JOURNEY_DEADLINE'),{code:'JOB_RESOLUTION_JOURNEY_DEADLINE'})),120000);
deadline.unref?.();

function progress(next){phase=next;process.stdout.write(JSON.stringify({operation:OPERATION,phase})+'\n');}
async function immutable(path,bytes){
  const previous=await readPrivate(path,RESOLUTION_RECEIVING_BYTES,{optional:true});
  if(previous){assert.ok(previous.equals(bytes),'Original retained receiving bytes changed: '+path);return {path,bytes:bytes.length,sha256:hash(bytes)};}
  return createOnlyFile(path,bytes);
}
async function checkpoint(){lease.assertHeld();plan.updatedAt=new Date().toISOString();await writeDocument(statePath,plan);}
async function retainedRequest(name,produce){
  if(!plan.requests[name]){plan.requests[name]=produce();await checkpoint();}
  return plan.requests[name];
}
async function response(host,path,value){
  stop.signal.throwIfAborted();
  const res=await fetch(host.origin+path,{method:value===undefined?'GET':'POST',redirect:'error',
    signal:AbortSignal.any([stop.signal,AbortSignal.timeout(30000)]),
    headers:{authorization:'Bearer '+host.token,origin:host.origin,
      ...(value===undefined?{}:{'content-type':'application/json'})},
    ...(value===undefined?{}:{body:JSON.stringify(value)})});
  const parts=[];let length=0;
  for await(const part of res.body??[]){length+=part.length;need(length<=RESOLUTION_RECEIVING_BYTES,'JOB_RESOLUTION_JOURNEY_RESPONSE_TOO_LARGE');parts.push(Buffer.from(part));}
  const bytes=Buffer.concat(parts),declared=res.headers.get('content-length');
  if(declared!==null)assert.equal(length,Number(declared),'Original response length');
  if(!res.ok){let error;try{error=JSON.parse(bytes);}catch{}
    throw Object.assign(new Error('Original '+path+' returned HTTP '+res.status),
      {code:error?.error??error?.code??'JOB_RESOLUTION_JOURNEY_HTTP_ERROR',status:res.status});}
  const expected=res.headers.get('x-content-sha256');
  if(expected)assert.equal(hash(bytes),expected,'Original export SHA256');
  return {bytes,sha256:hash(bytes),status:res.status};
}
const api=async(host,path,value)=>JSON.parse((await response(host,path,value)).bytes);
const merchantPath=action=>'/api/jobs/'+encodeURIComponent(jobId)+'/resolution'+(action?'/'+action:'');
const customerPath=action=>'/api/job-workspace/jobs/'+entryId+'/resolution'+(action?'/'+action:'');
const transport=createPublicHttpsFetch({
  timeoutMs:30000,lookup:async()=>[{address:'8.8.8.8',family:4}],
  requestImpl(options,receive){
    assert.equal(options.hostname,'jobs-merchant.example');
    const base='/jobs/'+encodeURIComponent(jobId),path=options.path;
    const read=options.method==='GET'&&(path===base||path===base+'/resolution'||path===base+'/resolution/receipt');
    const write=options.method==='POST'&&(path===base+'/resolution/issues'||path===base+'/resolution/messages');
    assert.ok(read||write,'Only this original job status and resolution capability routes are admitted');
    if(path===base)traffic.status++;
    else if(read)traffic.resolutionReads++;
    else if(path.endsWith('/issues'))traffic.issuePosts++;
    else traffic.messagePosts++;
    assert.ok(customerListener,'The original customer listener owns this request');
    const target=new URL(customerListener.url);
    return httpRequest({hostname:'127.0.0.1',port:target.port,path,method:options.method,
      headers:{...options.headers,host:options.hostname},signal:options.signal,agent:false,
      maxHeaderSize:options.maxHeaderSize},receive);
  }
});
async function openCustomer(){
  customerModel=await openJobWorkspace({directory:customerDirectory,fetchImpl:transport});
  customerHost=await startJobCustomerWorkspace({model:customerModel,port:0});
}
async function closeCustomer(){
  try{await customerHost?.close();}finally{customerHost=null;try{await customerModel?.close();}finally{customerModel=null;}}
}
async function openMerchant(){
  merchant=await openJobMerchant({configPath,directory:merchantDirectory,
    resolution:{accounting:{controller:accounting.adjustments}}});
  need(merchant.resolution,'JOB_RESOLUTION_INTEGRATED_MERCHANT_REQUIRED');
  customerListener=await startCustomerServer({model:merchant,port:0});
  merchantHost=await startJobsWorkspace({model:merchant,port:0});
}
async function closeMerchantHosts(){
  const results=await Promise.allSettled([merchantHost?.close(),customerListener?.close()]);
  merchantHost=null;customerListener=null;
  const failed=results.filter(x=>x.status==='rejected');
  if(failed.length)throw new AggregateError(failed.map(x=>x.reason),'JOB_RESOLUTION_JOURNEY_HOST_CLOSE_FAILED');
}
async function customerWrite(kind,name,fields){
  const before=await api(customerHost,customerPath('refresh'),{});
  const input=await retainedRequest(name,()=>({requestId:plan.ids[name],expectedRevision:before.receipt.revision,...fields}));
  let result=await api(customerHost,customerPath(kind),input);
  let saved=result.operations.find(op=>op.id===input.requestId);
  if(saved?.state!=='RECEIVED'){
    result=await api(customerHost,customerPath('recover'),{requestId:input.requestId});
    saved=result.operations.find(op=>op.id===input.requestId);
    if(saved?.state!=='RECEIVED'){
      result=await api(customerHost,customerPath('resume'),{requestId:input.requestId});
      saved=result.operations.find(op=>op.id===input.requestId);
    }
  }
  assert.equal(saved?.state,'RECEIVED','Same saved customer request must complete');
  return result;
}
async function exportOnce(name,host,path){
  const destination=join(directory,name),old=await readPrivate(destination,RESOLUTION_RECEIVING_BYTES,{optional:true});
  const file=old?{bytes:old,sha256:hash(old)}:await response(host,path);
  await immutable(destination,file.bytes);
  if(plan.exports[name])assert.equal(plan.exports[name].sha256,file.sha256,'Original captured export changed');
  plan.exports[name]={path:destination,bytes:file.bytes.length,sha256:file.sha256};await checkpoint();
  return {value:JSON.parse(file.bytes),...file,path:destination};
}
try{
  await openCustomer();
  const originalEntry=customerModel.get(entryId);
  jobId=originalEntry.receipt.jobId;buyerDirectory=originalEntry.directory;
  need(/^[A-Za-z0-9._:-]{1,80}$/.test(jobId),'JOB_RESOLUTION_ORIGINAL_JOB_REQUIRED');
  need(originalEntry.receipt.latestStatus?.state==='COMPLETED'&&
    buyerDirectory.startsWith(join(customerDirectory,'buyers')+'/'),'JOB_RESOLUTION_ORIGINAL_COMPLETED_BUYER_REQUIRED');
  const recordPath=join(merchantDirectory,'records',jobId+'.json'),recordBytes=await readPrivate(recordPath);
  const originalRow=JSON.parse(recordBytes),binding=jobBinding(originalRow);
  need(originalRow.state==='COMPLETED'&&binding.jobId===jobId,'JOB_RESOLUTION_ORIGINAL_COMPLETED_JOB_REQUIRED');
  need(validStrKey(binding.payment.asset,'C')&&validStrKey(binding.payment.payTo,'G'),
    'JOB_RESOLUTION_ORIGINAL_ACCOUNTING_TERMS_REQUIRED');
  const initialSource={checkoutResultSha256:hash(completedBytes),fixtureDirectory:fixture,
    customerWorkspace:customerDirectory,entryId,jobId,buyerDirectory,
    jobRecordSha256:hash(recordBytes),configSha256:hash(await readPrivate(configPath)),
    eventId:binding.settlement.id,eventSha256:hash(JSON.stringify(binding.settlement)),
    inputSha256:binding.inputSha256,acceptanceSha256:originalEntry.receipt.acceptanceSha256,
    purchaseSha256:hash(await readPrivate(join(buyerDirectory,'purchase.json'),1024*1024)),
    outboxEventsSha256:hash(await readPrivate(join(merchantDirectory,'outbox','events.ndjson')))};
  plan=await readDocument(statePath,{optional:true});
  if(plan){assert.equal(plan.schema,'stellar-forge.job-resolution-native-operation.v1');assert.deepEqual(plan.source,initialSource);}
  else{
    plan={schema:'stellar-forge.job-resolution-native-operation.v1',operation:OPERATION,
      createdAt:new Date().toISOString(),source:initialSource,
      ids:Object.fromEntries(['capture','issue','reply','adjustment','message','drainReply','closeCase'].map(name=>[name,randomUUID()])),
      requests:{},exports:{},accountingRunId:null};
    await checkpoint();
  }
  await immutable(join(directory,'checkout-source.json'),completedBytes);
  progress('capture the original paid event with original accounting');
  const proofDir=proofDirectory?resolve(proofDirectory):join(directory,'original-proofs');
  await privateDirectory(proofDir);
  const termsFile=join(directory,'original-payment-terms.json');
  const terms={schema:'stellar-forge.merchant-accounting-terms.v1',routes:[{
    routeId:binding.functionId,method:'POST',network:binding.payment.network,
    amountAtomic:binding.payment.amountAtomic,asset:binding.payment.asset,payTo:binding.payment.payTo,
    priceBasis:'original paid job atomic terms',unitPriceUsd:null,unitCostUsd:null}]};
  compileTerms(terms);await immutable(termsFile,json(terms));
  accounting=await openAccountingWorkspace({directory:accountingDirectory,
    outboxDir:join(merchantDirectory,'outbox'),proofDir,termsFile});
  await openMerchant();
  assert.equal(hash(json(jobBinding(await merchant.get(jobId)))),hash(json(binding)));
  assert.equal((await merchant.snapshot()).worker.running,false);
  const captureRequest=requestId=>({requestId,revision:accounting.view().revision,
    name:'Original '+jobId+' resolution receiving',actor:'native job resolution',
    expectedTermsSelection:'source',expectedPeriodSelection:null,
    expectedNativeEvent:{id:binding.settlement.id,sha256:hash(JSON.stringify(binding.settlement))}});
  if(!plan.captureAttempts){
    const request=plan.requests.capture??captureRequest(plan.ids.capture);
    plan.requests.capture=request;
    plan.captureAttempts=[{request,createdAt:plan.createdAt,nativeRun:null}];
    await checkpoint();
  }
  need(Array.isArray(plan.captureAttempts)&&plan.captureAttempts.length>0,'JOB_RESOLUTION_CAPTURE_HISTORY_CHANGED');
  let attempt=plan.captureAttempts.at(-1);
  const observeCapture=async run=>{
    need(run.requestId===attempt.request.requestId,'JOB_RESOLUTION_CAPTURE_IDENTITY_CHANGED');
    attempt.nativeRun=structuredClone(run);attempt.observedAt=new Date().toISOString();
    plan.accountingRunId=run.id;await checkpoint();
  };
  let started=await accounting.begin(attempt.request);
  await observeCapture(started.run);
  if(['failed','interrupted'].includes(started.run.status)){
    // A stopped original accounting capture has no replay method. Preserve its
    // full run/request, then capture the same payment again before any case binds.
    const current=await merchant.resolution.get(jobId);
    need(!current.case.accounting,'JOB_RESOLUTION_BOUND_CAPTURE_RECOVERY_REQUIRED',409);
    const prior=attempt.request.requestId,request=captureRequest(randomUUID());
    attempt={request,createdAt:new Date().toISOString(),replacesCaptureRequestId:prior,nativeRun:null};
    plan.captureAttempts.push(attempt);plan.requests.capture=request;await checkpoint();
    started=await accounting.begin(request);
    await observeCapture(started.run);
  }
  await Promise.all([...accounting.tasks]);
  const run=await accounting.run(started.run.id);
  await observeCapture(run.run);
  assert.equal(run.run.status,'complete','Original accounting capture: '+(run.run.error??run.run.status));
  for(const path of ['/resolutions/','/resolutions/app.mjs','/resolutions/style.css'])
    assert.equal((await response(merchantHost,path)).status,200,path);
  for(const path of ['/jobs/resolutions/','/jobs/resolutions/app.mjs','/jobs/resolutions/style.css','/jobs/resolutions/limits.mjs'])
    assert.equal((await response(customerHost,path)).status,200,path);
  let view=await api(merchantHost,merchantPath());
  if(!view.case.accounting)view=await api(merchantHost,merchantPath('bind'),{runId:started.run.id,expectedRevision:view.case.revision});
  assert.equal(view.case.accounting.source.eventId,binding.settlement.id);
  assert.equal(view.case.accounting.source.runId,started.run.id);
  progress('customer issue and merchant response');
  await customerWrite('issues','issue',{requestedRemedy:'CONTACT',
    message:'Please retain the billing resolution for this delivered application result.'});
  view=await api(merchantHost,merchantPath());
  const reply=await retainedRequest('reply',()=>({requestId:plan.ids.reply,expectedRevision:view.case.revision,
    issueId:plan.ids.issue,message:'The original delivered job and its accounting record are selected for review.'}));
  view=await api(merchantHost,merchantPath('reply'),reply);
  progress('original accounting cancellation preview and record');
  const preview=await retainedRequest('preview',()=>({requestId:plan.ids.adjustment,expectedRevision:view.case.revision,
    kind:'CANCELLATION',amountAtomic:binding.payment.amountAtomic,
    effectiveAt:plan.createdAt.slice(0,19)+'Z',reason:'Reviewed cancellation in the original paid-job native receiving operation.',
    actor:'native job resolution',reference:jobId}));
  view=await api(merchantHost,merchantPath('preview'),preview);
  const selected=view.case.previews.find(item=>item.id===plan.ids.adjustment)?.preview;
  assert.ok(selected,'Original retained adjustment preview');
  assert.equal(selected.request.effectiveAt,preview.effectiveAt.replace('Z','.000Z'));
  assert.deepEqual(Object.keys(selected.request),Object.keys(adjustmentRequest(selected.request)));
  const record=await retainedRequest('record',()=>({requestId:plan.ids.adjustment,expectedRevision:view.case.revision}));
  view=await api(merchantHost,merchantPath('record'),record);
  const originalAdjustment=(await accounting.adjustments.detail(plan.ids.adjustment)).adjustment;
  validateAdjustment(originalAdjustment);
  assert.equal(originalAdjustment.kind,'CANCELLATION');assert.equal(originalAdjustment.status,'RECORDED');
  assert.equal(originalAdjustment.previewSha256,selected.previewSha256);
  assert.equal(originalAdjustment.eventId,binding.settlement.id);
  await customerWrite('messages','message',{issueId:plan.ids.issue,
    message:'The delivered result and original recorded accounting resolution are retained together.'});
  progress('drain an admitted original reply and reopen its owners');
  view=await api(merchantHost,merchantPath());
  const drainReply=await retainedRequest('drainReply',()=>({requestId:plan.ids.drainReply,expectedRevision:view.case.revision,
    issueId:plan.ids.issue,message:'The complete resolution record is ready for independent receiving.'}));
  await closeCustomer();await closeMerchantHosts();
  const pendingReply=merchant.resolution.reply(jobId,drainReply),closingMerchant=merchant.close();
  const drained=await pendingReply;await closingMerchant;merchant=null;
  assert.ok(drained.case.messages.some(message=>message.id===plan.ids.drainReply));
  await accounting.close();accounting=null;
  accounting=await openAccountingWorkspace({directory:accountingDirectory});
  const reopenedAdjustment=(await accounting.adjustments.detail(plan.ids.adjustment)).adjustment;
  assert.equal(reopenedAdjustment.requestSha256,originalAdjustment.requestSha256);
  assert.equal(reopenedAdjustment.previewSha256,originalAdjustment.previewSha256);
  await openMerchant();await openCustomer();
  view=await api(merchantHost,merchantPath());
  const closeCase=await retainedRequest('closeCase',()=>({requestId:plan.ids.closeCase,expectedRevision:view.case.revision,
    state:'CLOSED',actor:'native job resolution',message:'Delivered result and reviewed accounting cancellation received.'}));
  view=await api(merchantHost,merchantPath('case'),closeCase);
  const latest=await api(customerHost,customerPath('refresh'),{});
  assert.equal(latest.receipt.state,'CLOSED');assert.equal(latest.receipt.accounting.totals.cancelledAmountAtomic,binding.payment.amountAtomic);
  assert.equal(latest.receipt.accounting.totals.refundedAmountAtomic,'0');
  progress('complete original exports and independent customer receiving');
  const merchantExport=await exportOnce('merchant-resolution.json',merchantHost,merchantPath('export'));
  const buyerExport=await exportOnce('customer-resolution.json',customerHost,customerPath('export'));
  const accountingExport=await exportOnce('merchant-adjustments.json',merchantHost,merchantPath('accountingexport'));
  assert.equal(accountingExport.value.schema,'stellar-forge.merchant-adjustment-export.v1');
  const exportedEvent=accountingExport.value.events.find(value=>value.original.eventId===binding.settlement.id);
  assert.ok(exportedEvent);assert.equal(exportedEvent.adjustments.find(value=>value.id===plan.ids.adjustment)?.status,'RECORDED');
  const reconciled=await api(merchantHost,'/api/resolutions/receive',merchantExport.value);
  assert.equal(reconciled.case.revision,merchantExport.value.case.revision);
  const receivedDirectory=join(directory,'received-original-buyer');await privateDirectory(receivedDirectory);
  const receivedSources=[];
  for(const file of ['acceptance.json','purchase.json','buyer.json']){
    const bytes=await readPrivate(join(buyerDirectory,file),1024*1024);
    receivedSources.push({name:file,...await immutable(join(receivedDirectory,file),bytes)});
  }
  received=await openJobResolutionBuyer({directory:receivedDirectory,fetchImpl:transport});
  const receivedState=await received.receive(buyerExport.value);
  assert.equal(receivedState.receipt.nativeSettlement.id,binding.settlement.id);
  assert.equal(receivedState.receipt.revision,latest.receipt.revision);
  assert.equal(receivedState.operations.length,2);
  await received.close();received=null;
  received=await openJobResolutionBuyer({directory:receivedDirectory,fetchImpl:transport});
  const reopened=await received.inspect();
  assert.deepEqual(reopened.receipt,receivedState.receipt);
  assert.deepEqual(reopened.operations,receivedState.operations);
  const receiptBytes=Buffer.from(buyerExport.value.receiptBase64,'base64');
  validateReceipt(JSON.parse(receiptBytes),JSON.parse(await readPrivate(join(buyerDirectory,'acceptance.json'),65536)));
  assert.equal(hash(receiptBytes),buyerExport.value.receiptSha256);
  assert.equal(hash(await readPrivate(recordPath)),plan.source.jobRecordSha256);
  assert.equal(hash(await readPrivate(join(merchantDirectory,'outbox','events.ndjson'))),plan.source.outboxEventsSha256);
  assert.equal(hash(await readPrivate(join(buyerDirectory,'acceptance.json'),65536)),plan.source.acceptanceSha256);
  assert.equal(hash(await readPrivate(join(buyerDirectory,'purchase.json'),1024*1024)),plan.source.purchaseSha256);
  const result={schema:'stellar-forge.job-resolution-native-result.v1',result:'PASS',operation:OPERATION,
    node:process.version,source:plan.source,fixtureDirectory:fixture,customerWorkspace:customerDirectory,
    accountingWorkspace:accountingDirectory,accountingRunId:started.run.id,
    accountingCaptureAttempts:plan.captureAttempts.map(attempt=>({requestId:attempt.request.requestId,
      runId:attempt.nativeRun?.id??null,status:attempt.nativeRun?.status??'prepared',error:attempt.nativeRun?.error??null})),jobId,entryId,
    caseRevision:reopened.receipt.revision,caseState:reopened.receipt.state,
    adjustment:{id:originalAdjustment.id,kind:originalAdjustment.kind,status:originalAdjustment.status,
      requestSha256:originalAdjustment.requestSha256,previewSha256:originalAdjustment.previewSha256},
    receipt:{sha256:buyerExport.value.receiptSha256,bytes:receiptBytes.length,operations:reopened.operations.length},
    receiving:{directory:receivedDirectory,sources:receivedSources},exports:plan.exports,traffic,
    lifecycle:['original completed checkout','source-bound original accounting capture','customer issue and merchant response',
      'original cancellation preview and record','customer acknowledgement','admitted reply drain','original owner reopen',
      'complete merchant/customer/accounting exports','same-case merchant receiving','independent original-buyer receiving and reopen']};
  await received.close();received=null;
  await closeCustomer();await closeMerchantHosts();await merchant.close();merchant=null;
  await accounting.close();accounting=null;
  await writeDocument(output,result);plan.completedAt=new Date().toISOString();plan.result=output;await checkpoint();
  complete=true;process.stdout.write(JSON.stringify({operation:OPERATION,result:'PASS',output,exports:plan.exports})+'\n');
  return {...result,output};
}catch(error){
  await writeDocument(output,{schema:'stellar-forge.job-resolution-native-result.v1',result:'FAIL',operation:OPERATION,
    phase,code:error.code??'JOB_RESOLUTION_JOURNEY_FAILED',message:String(error.message??error).slice(0,1500),
    directory,fixtureDirectory:fixture,customerWorkspace:customerDirectory,accountingRunId:plan?.accountingRunId??null}).catch(()=>{});
  throw error;
}finally{
  clearTimeout(deadline);stop.abort();signal?.removeEventListener('abort',abort);process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);
  const closed=await Promise.allSettled([received?.close(),closeCustomer(),closeMerchantHosts()]);
  try{await merchant?.close();}finally{try{await accounting?.close();}finally{await lease.close();}}
  const failed=closed.filter(value=>value.status==='rejected');
  if(!complete)process.stderr.write(JSON.stringify({operation:OPERATION,phase,directory,output})+'\n');
  if(failed.length)throw new AggregateError(failed.map(value=>value.reason),'JOB_RESOLUTION_JOURNEY_CLOSE_FAILED');
}

}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const values={},args=process.argv.slice(2),names={'--checkout-result':'checkoutResult','--directory':'directory','--proof-dir':'proofDirectory'};
    need(args.length%2===0,'JOB_RESOLUTION_JOURNEY_ARGUMENTS');
    for(let i=0;i<args.length;i+=2){
      need(Object.hasOwn(names,args[i])&&typeof args[i+1]==='string'&&!Object.hasOwn(values,names[args[i]]),
        'JOB_RESOLUTION_JOURNEY_ARGUMENTS');
      values[names[args[i]]]=args[i+1];
    }
    await runJobResolutionContinuation(values);
  }catch(error){process.stderr.write(JSON.stringify({operation:OPERATION,error:error.code??'JOB_RESOLUTION_JOURNEY_FAILED',
      message:String(error.message??error).slice(0,1500)})+'\n');process.exitCode=1;}
}
