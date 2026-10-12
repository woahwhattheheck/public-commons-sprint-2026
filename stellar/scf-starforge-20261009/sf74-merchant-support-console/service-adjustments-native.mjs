// MIT. Existing merchant accounting actions joined to the original saved Support case.
import {constants} from 'node:fs';
import {lstat,mkdir,open,realpath} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {
  adjustmentRequest, adjustmentJson, validateAdjustment, validateRefundProof,
  previewAdjustment, renderAdjustmentCsv, renderAdjustmentHtml
} from '../merchant-settlement-accounting/adjustments.mjs';
import {captureBuyerAdjustments} from '../merchant-settlement-accounting/buyer-expense-source.mjs';
import {resolveRpcEndpoint} from '../sf86-rpc-transfer-reconcile/terms.mjs';
import {retainCaseArtifact} from './case-store.mjs';
import {serviceCanonical} from './service-commitments.mjs';
import {
  MAX_SERVICE_ADJUSTMENT_BYTES, SERVICE_ADJUSTMENT_OUTCOME_SCHEMA, readServiceAdjustments,
  prepareServiceAdjustmentIntent, prepareServiceAdjustmentOutcome, serviceAdjustmentError,
  validateServiceAdjustmentMaterial
} from './service-adjustments.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>serviceCanonical(a)===serviceCanonical(b);
const copy=value=>structuredClone(value);
const decoder=new TextDecoder('utf-8',{fatal:true});
const ACTIVE=new Set(['QUEUED','RUNNING']);
const TERMINAL=new Set(['COMPLETED','FAILED','INTERRUPTED']);
function need(ok,message,code='SERVICE_ADJUSTMENT_NATIVE_INVALID',status=409){
  if(!ok)throw serviceAdjustmentError(code,message,status);
}
function controller(value,methods){
  need(value&&methods.every(key=>typeof value[key]==='function'),
    'Use the already admitted original merchant accounting adjustments controller.','SERVICE_ADJUSTMENT_ACCOUNTING_REQUIRED',503);
  return value;
}
async function directory(path,{create=false}={}){
  need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'Choose an absolute private handover directory.');
  if(create)await mkdir(path,{recursive:true,mode:0o700});
  const info=await lstat(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&(process.platform==='win32'||!(info.mode&0o077)),
    'Use the original private handover directory.');
  // A provider-selected private path can be mounted elsewhere on receiving; the
  // resolved path is only used for this invocation's retained native files.
  return await realpath(path);
}
async function readBytes(path,max=MAX_SERVICE_ADJUSTMENT_BYTES){
  const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const before=await file.stat({bigint:true});
    need(before.isFile()&&before.size>0n&&before.size<=BigInt(max)&&(process.platform==='win32'||!(Number(before.mode)&0o077)),
      'A retained native file is not a private regular file within its size limit.');
    const bytes=await file.readFile(),after=await file.stat({bigint:true});
    need(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&
      before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs&&BigInt(bytes.length)===after.size,
      'The original native file changed while being read.');
    return bytes;
  }finally{await file.close();}
}
async function readOptional(path){
  try{return await readBytes(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
function parse(bytes){try{return JSON.parse(decoder.decode(bytes));}catch{throw serviceAdjustmentError('SERVICE_ADJUSTMENT_NATIVE_FILE_INVALID','A retained native result is not complete UTF-8 JSON.');}}
async function retainedJSON(path,value){
  const raw=adjustmentJson(value),existing=await readOptional(path);
  if(existing){const prior=parse(existing);need(same(prior,value),'The retained original native result differs from these bytes.','SERVICE_ADJUSTMENT_NATIVE_FILE_CONFLICT');return prior;}
  await retainCaseArtifact(path,raw);return copy(value);
}
function selectedState(value){
  if(!value||!Number.isSafeInteger(value.revision)||value.revision<0)return undefined;
  return {...(typeof value.schema==='string'?{schema:value.schema}:{}),revision:value.revision};
}
function selectedResult(value){
  return {adjustment:copy(value.adjustment),...(typeof value.duplicate==='boolean'?{duplicate:value.duplicate}:{}),
    ...(value.job?{job:copy(value.job)}:{}),...(selectedState(value.state)?{state:selectedState(value.state)}:{})};
}
function exactRecord(record,proposal){
  validateAdjustment(record);
  need(same(adjustmentRequest(record),proposal.nativePreview.request)&&record.previewSha256===proposal.nativePreview.previewSha256&&
    same(record.source,proposal.nativePreview.detail.source)&&same(record.original,proposal.nativePreview.detail.event)&&
    same(record.originalProof,proposal.nativePreview.detail.originalProof)&&same(record.originalProofFile,proposal.nativePreview.detail.originalProofFile)&&
    same(record.refundTerms,proposal.nativePreview.detail.refundTerms),
    'The original native adjustment differs from its saved Service proposal.','SERVICE_ADJUSTMENT_NATIVE_BINDING_CHANGED');
  return record;
}
function exactDetail(detail,proposal){
  need(same(detail.source,proposal.nativePreview.detail.source)&&same(detail.event,proposal.nativePreview.detail.event),
    'The selected accounting workspace does not contain this original payment and source.','SERVICE_ADJUSTMENT_NATIVE_BINDING_CHANGED');
  return detail;
}
async function selection(context,intentId){
  const view=await readServiceAdjustments(context),intent=view.intents.find(row=>row.id===intentId);
  need(intent,'Save the complete native intent in the original case before executing it.','SERVICE_ADJUSTMENT_INTENT_REQUIRED');
  const proposal=view.proposals.find(row=>row.id===intent.proposalId);
  return {view,intent,proposal,outcomes:view.outcomes.filter(row=>row.intentId===intent.id)};
}
function file(name,type,bytes){return {name,type,bytes:bytes.length,sha256:hash(bytes),base64:bytes.toString('base64')};}
/** Pure original accounting preview; caller retains its complete source in a proposal. */
export async function previewNativeServiceAdjustment(adjustments,request){
  const original=await controller(adjustments,['preview']).preview(copy(request));
  const checked=previewAdjustment(original.detail,original.request);
  need(checked.previewSha256===original.previewSha256,'The native preview changed during the original accounting read.');
  need(Number.isSafeInteger(original.workspaceRevision)&&original.workspaceRevision>=0,'The original preview has no saved workspace revision.');
  return copy(original);
}
/** Resolve the original network choice before the exact verification intent is saved. */
export async function prepareNativeServiceAdjustmentIntent(adjustments,context,input){
  if(input.action!=='verify')return prepareServiceAdjustmentIntent(context,input);
  const view=await readServiceAdjustments(context),proposal=view.proposals.find(row=>row.id===input.proposalId);
  need(proposal,'Save the original reviewed proposal before preparing its native action.','SERVICE_ADJUSTMENT_PROPOSAL_REQUIRED');
  const detail=await controller(adjustments,['detail']).detail(proposal.id);
  exactRecord(detail.adjustment,proposal);exactDetail(detail.detail,proposal);
  need(detail.adjustment.kind==='REFUND','Select the original retained refund request.');
  const endpoint=resolveRpcEndpoint(detail.adjustment.refundTerms.network,input.input?.rpcEndpoint,
    {allowLocal:adjustments.options?.allowLocalRpc===true});
  return prepareServiceAdjustmentIntent(context,{...copy(input),input:{...copy(input.input??{}),rpcEndpoint:endpoint}});
}
async function nativeRecord(adjustments,proposal,intent,root){
  const path=join(root,'record-result.json'),prior=await readOptional(path);
  if(prior){const value=parse(prior);exactRecord(value.adjustment,proposal);return selectedResult(value);}
  // Original record() checks its retained ID/request before current revision.
  // It is the authority for an accepted response lost before this file existed.
  const value=selectedResult(await controller(adjustments,['record']).record(copy(intent.request)));
  exactRecord(value.adjustment,proposal);return retainedJSON(path,value);
}
async function matchingJobs(adjustments,record,intent){
  const ids=[...new Set(record.history.filter(item=>item.action==='VERIFICATION_REQUESTED'&&
    item.transaction===intent.request.transaction).map(item=>item.jobId))];
  const matches=[];
  for(const id of ids){
    const job=await adjustments.savedJob(id);
    need(job.adjustmentId===record.id,'The original adjustment history refers to another verification request.');
    if(job.transaction===intent.request.transaction&&job.rpcEndpoint===intent.request.rpcEndpoint)matches.push(job);
  }
  return matches;
}
function exactJob(job,proposal,intent){
  need(job&&job.adjustmentId===proposal.id&&job.transaction===intent.request.transaction&&
    job.rpcEndpoint===intent.request.rpcEndpoint&&(ACTIVE.has(job.status)||TERMINAL.has(job.status)),
    'The retained native job differs from the selected original returned-transfer request.','SERVICE_ADJUSTMENT_NATIVE_JOB_CHANGED');
  return job;
}
async function nativeVerify(adjustments,proposal,intent,root){
  controller(adjustments,['detail','savedJob','verify','view']);
  let current=await adjustments.detail(proposal.id);exactRecord(current.adjustment,proposal);exactDetail(current.detail,proposal);
  const known=await readOptional(join(root,'verification-job.json'));
  let job,duplicate=true;
  if(known){
    const ref=parse(known);
    need(ref.intentSha256===intent.sha256&&ref.adjustmentId===proposal.id,'The saved verification receipt belongs to another original intent.');
    job=exactJob(await adjustments.savedJob(ref.id),proposal,intent);
  }else{
    // Full original history, not the first 100 status rows, recovers an accepted
    // verification whose HTTP response was interrupted.
    const jobs=await matchingJobs(adjustments,current.adjustment,intent),retry=intent.request.retryJobId??null;
    let eligible=jobs;
    if(retry){
      const at=jobs.findIndex(row=>row.id===retry);
      need(at>=0,'The selected prior verification is absent from this exact original transaction and endpoint.','SERVICE_ADJUSTMENT_RETRY_CHANGED');
      const prior=jobs[at];
      eligible=jobs.slice(at+1);
      if(!eligible.length){
        // Reopening a saved job may recover its already written native proof.
        // That accepted original result supersedes the earlier retry decision.
        const reread=await adjustments.savedJob(prior.id);
        if(reread.status==='COMPLETED'||ACTIVE.has(reread.status))eligible=[reread];
        else need(['FAILED','INTERRUPTED'].includes(reread.status),
          'The selected original verification is not available for an explicit retry.','SERVICE_ADJUSTMENT_RETRY_CHANGED');
      }
    }
    job=eligible.at(-1);
    if(!job){
      const {retryJobId,...request}=intent.request;
      const started=await adjustments.verify(proposal.id,copy(request));
      exactRecord(started.adjustment,proposal);job=exactJob(started.job,proposal,intent);duplicate=Boolean(started.duplicate);
    }
    exactJob(job,proposal,intent);
    await retainedJSON(join(root,'verification-job.json'),{schema:'stellar-forge.service-adjustment-native-job.v1',
      intentSha256:intent.sha256,adjustmentId:proposal.id,id:job.id});
  }
  // An original same-process controller waits its own promise. An HTTP-backed
  // owner may expose a saved-job wait, or return current progress for later read.
  if(ACTIVE.has(job.status)&&typeof adjustments.waitForJob==='function')job=exactJob(await adjustments.waitForJob(job.id),proposal,intent);
  else job=exactJob(await adjustments.savedJob(job.id),proposal,intent);
  current=await adjustments.detail(proposal.id);exactRecord(current.adjustment,proposal);
  const state=selectedState(await adjustments.view());
  return {adjustment:copy(current.adjustment),job:copy(job),duplicate,...(state?{state}:{}),recovered:true};
}
function exportBytes(value){
  need(value&&typeof value.name==='string'&&value.bytes instanceof Uint8Array,'Use the complete original AdjustmentWorkspace export.');
  return Buffer.from(value.bytes);
}
async function nativeCapture(adjustments,proposal,intent,root){
  controller(adjustments,['detail','export']);
  const nativePath=join(root,'merchant-adjustments-'+intent.request.runId+'.json');
  let raw=await readOptional(nativePath);
  if(!raw){
    const original=await adjustments.export({runId:intent.request.runId,format:'json'});
    raw=exportBytes(original);
    need(original.name==='merchant-adjustments-'+intent.request.runId+'.json','The native export filename differs from its selected original reconciliation.');
    need(raw.length<=32*1024*1024,'The complete original buyer export exceeds its maintained source limit.');
    const snapshot=parse(raw),event=snapshot.events?.find(item=>item.original?.eventId===intent.request.eventId),
      adjustment=event?.adjustments?.find(item=>item.id===proposal.id);
    need(adjustment,'The original exported payment is missing its saved adjustment.');
    exactRecord(adjustment,proposal);need(same(snapshot.source,proposal.nativePreview.detail.source),'The native export selects another original source.');
    await retainCaseArtifact(nativePath,raw);
  }
  const snapshot=parse(raw),event=snapshot.events?.find(item=>item.original?.eventId===intent.request.eventId),
    adjustment=event?.adjustments?.find(item=>item.id===proposal.id);
  need(adjustment,'The retained native export is missing the original adjustment.');exactRecord(adjustment,proposal);
  const name='merchant-adjustments-'+intent.request.runId+'.json',buyerPath=join(root,'buyer-capture.json');
  let buyerRaw=await readOptional(buyerPath),buyer;
  if(buyerRaw)buyer=parse(buyerRaw);
  else{
    buyer=await captureBuyerAdjustments({sourceFile:nativePath,sourceSha256:hash(raw),
      eventId:intent.request.eventId,expectedJob:intent.request.expectedJob});
    buyer=await retainedJSON(buyerPath,buyer);
  }
  const csv=renderAdjustmentCsv(snapshot),html=renderAdjustmentHtml(snapshot),
    files=[file(name.replace(/\.json$/,'.csv'),'text/csv',csv),file(name.replace(/\.json$/,'.html'),'text/html',html)];
  for(const item of files)await retainCaseArtifact(join(root,item.name),Buffer.from(item.base64,'base64'));
  return {adjustment:copy(adjustment),source:copy(snapshot.source),
    export:{name,type:'application/json',bytes:raw.length,sha256:hash(raw)},files,buyer};
}
function buyerComparable(value){
  return Object.fromEntries(Object.entries(value).filter(([key])=>!['captured_at','source_file','source_directory'].includes(key)));
}
/** Original native validators bind saved results and full buyer exports on receiving. */
export async function validateNativeServiceAdjustmentOutcome(context,outcome,{directory:outputDirectory}={}){
  const validated=await validateServiceAdjustmentMaterial(context,outcome);
  need(validated.schema===SERVICE_ADJUSTMENT_OUTCOME_SCHEMA,'Choose a returned original native outcome.');
  const {proposal,intent}=await selection(context,outcome.intentId);
  exactRecord(outcome.result.adjustment,proposal);
  if(outcome.action==='verify'){
    const job=exactJob(outcome.result.job,proposal,intent);
    if(job.result?.verification?.proof){
      const official=validateRefundProof(job.result.verification.proof,outcome.result.adjustment,{allowLocal:true});
      need(Boolean(job.result.official)===official&&job.result.verification.transaction===job.transaction&&
        job.result.verification.proof.transaction===job.transaction&&job.result.verification.proof.rpcEndpoint===job.rpcEndpoint,
        'The native job proof differs from its retained selected transfer.');
    }
  }
  if(outcome.action==='capture'){
    const root=await directory(outputDirectory,{create:true}),raw=Buffer.from(outcome.result.buyer.files[0].base64,'base64');
    const path=join(root,outcome.result.export.name);await retainCaseArtifact(path,raw);
    const captured=await captureBuyerAdjustments({sourceFile:path,sourceSha256:outcome.result.export.sha256,
      eventId:intent.request.eventId,expectedJob:intent.request.expectedJob});
    need(same(buyerComparable(captured),buyerComparable(outcome.result.buyer)),
      'The retained buyer handover differs from the original producer compiler and transfer validators.','SERVICE_ADJUSTMENT_BUYER_CHANGED');
    const snapshot=parse(raw);
    const expected=[file(outcome.result.export.name.replace(/\.json$/,'.csv'),'text/csv',renderAdjustmentCsv(snapshot)),
      file(outcome.result.export.name.replace(/\.json$/,'.html'),'text/html',renderAdjustmentHtml(snapshot))];
    need(same(expected,outcome.result.files),'The retained accountant CSV/HTML differ from the same original export.');
  }
  return validated;
}
/** Execute only an intent already saved through the existing Support case CAS.
 * The owning MerchantAccounting admission controls this controller's lifetime. */
export async function executeNativeServiceAdjustment(adjustments,{context,intentId,directory:outputDirectory}){
  const {view,intent,proposal,outcomes}=await selection(context,intentId);
  const base=await directory(outputDirectory,{create:true}),root=await directory(join(base,'service-adjustment-native',context.caseId,intent.id),{create:true});
  await retainedJSON(join(root,'intent.json'),{schema:'stellar-forge.service-adjustment-native-intent.v1',
    caseId:context.caseId,intent,proposalSha256:proposal.sha256});
  // Completed immutable record/export outcomes reopen directly. Verification
  // observes its saved job again so native progress remains visible after reload.
  if(intent.action!=='verify'&&outcomes.length){
    const prior=outcomes[0];return validateNativeServiceAdjustmentOutcome(context,prior,{directory:root});
  }
  if(intent.action==='verify'&&outcomes.length){
    const ids=new Set(outcomes.map(row=>row.result.job.id));
    need(ids.size===1,'This original verification intent acquired more than one native job.','SERVICE_ADJUSTMENT_NATIVE_JOB_CHANGED');
    await retainedJSON(join(root,'verification-job.json'),{schema:'stellar-forge.service-adjustment-native-job.v1',
      intentSha256:intent.sha256,adjustmentId:proposal.id,id:[...ids][0]});
  }
  // This read preserves the exact original source identity even when an alias is
  // moved to another native workspace. Native revisions/remaining totals remain
  // the original controller's authority.
  exactDetail(await controller(adjustments,['event']).event(proposal.nativePreview.request.runId,proposal.nativePreview.request.eventId),proposal);
  let result;
  if(intent.action==='record')result=await nativeRecord(adjustments,proposal,intent,root);
  else if(intent.action==='verify')result=await nativeVerify(adjustments,proposal,intent,root);
  else result=await nativeCapture(adjustments,proposal,intent,root);
  let outcome=await prepareServiceAdjustmentOutcome(context,{intentId:intent.id,result});
  const path=join(root,'outcome-'+outcome.id+'.json'),retained=await readOptional(path);
  if(retained){
    const saved=parse(retained);
    need(saved.intentSha256===intent.sha256&&same(saved.result,result),'The original native observation ID belongs to different bytes.');
    outcome=saved;
  }else await retainCaseArtifact(path,adjustmentJson(outcome));
  return validateNativeServiceAdjustmentOutcome(context,outcome,{directory:root});
}
