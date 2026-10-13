// MIT. Existing complete InboxTask packet -> original customer-delivery framing.
import { join } from 'node:path';
import { openInboxTaskPacket } from '../../node/agents/inbox-task.mjs';
import { initializationDirectory, initializationBytes, optionalInitializationBytes, retainInitializationFile } from '../../initialization.mjs';
import { SCHEMA, bytes, clone, need, hash, identity, digest, absolute, measure, copyFile, ensureMember, writePackage, MAX_CONTENT } from './format.mjs';
import { selectSource } from './source.mjs';
import { reviewHtml } from './review.mjs';

const ID=/^[A-Za-z0-9._-]{1,100}$/;
const parse=async path=>{const raw=await optionalInitializationBytes(path,32*1024*1024);return raw?JSON.parse(raw):null;};
export function taskDeliveryRequest(input){
 need(input&&ID.test(input.id)&&!['.','..'].includes(input.id),'CUSTOMER_TASK_DELIVERY_ID');
 need(hash(input.expectedTaskSha256),'CUSTOMER_TASK_DELIVERY_IDENTITY');
 absolute(input.packetDirectory);absolute(input.sourceRoot);absolute(input.sourceManifest);
 need(typeof input.title==='string'&&input.title.trim()&&input.title.length<=160&&!/[\x00-\x1f]/.test(input.title)&&typeof input.note==='string'&&input.note.length<=10000,'CUSTOMER_DELIVERY_TITLE');
 need(Array.isArray(input.intentIds)&&input.intentIds.length>0&&input.intentIds.length<=100&&new Set(input.intentIds).size===input.intentIds.length&&input.intentIds.every(x=>typeof x==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(x)),'CUSTOMER_DELIVERY_INTENTS');
 return{kind:'inbox-task',id:input.id,packetDirectory:input.packetDirectory,expectedTaskSha256:input.expectedTaskSha256,title:input.title,note:input.note,intentIds:[...input.intentIds],sourceRoot:input.sourceRoot,sourceManifest:input.sourceManifest};
}
function originalObservation(job){
 const native=job.outcome??{},outcomes=native.originalOutcomeReport?.outcomes;
 const result=Array.isArray(outcomes)?outcomes.find(x=>x.intentId===job.operation.intentId):null;
 // Keep the original terminal's own observation. The selected later RPC read has
 // a separate projection and never replaces this original payment observation.
 const signed=result?.signedAttempt===true||native.error?.paymentSent===true;
 const settlement=result?.independentlyVerifiedTransfer===true?'SETTLED':
  ['PENDING_RECONCILIATION','SELLER_REPORTED_ONLY'].includes(result?.status)?'PENDING':
  result?.status==='SELLER_REPORTED_FAILED'?'FAILED':'UNKNOWN';
 const error=typeof native.error?.code==='string'&&/^[A-Z0-9_]{1,150}$/.test(native.error.code)?native.error.code:null;
 return{attemptStatus:signed?'ATTEMPTED':result?.signedAttempt===false?'NOT_ATTEMPTED':'UNKNOWN',
  settlementStatus:settlement,outputStatus:result?.observedHttpBody===true?'OBSERVED':'UNKNOWN',
  network:result?.network??job.operation.expect?.network??'UNKNOWN',
  asset:result?.asset??job.operation.expect?.asset??'UNKNOWN',
  amountAtomic:result?.amountAtomic??'UNKNOWN',transactionHash:null,
  ledger:Number.isSafeInteger(result?.ledger)?result.ledger:null,issues:error?[error]:[]};
}
function recoveryProjection(job,entry){
 if(!entry.selection.rpcResult)return null;
 const value=job.rpcRecovery,file=value.responseFile,s=value.settlement;
 return{kind:'SETTLED_RPC_RECOVERY_READ',state:value.state,readId:value.readId,
  readSha256:value.readSha256,completedSha256:value.completedSha256,
  bindingSha256:entry.binding.rpcResultSha256,
  originalAttemptStartedAt:file.originalAttemptStartedAt,
  recoveryReadStartedAt:file.recoveryReadStartedAt,responseObservedAt:file.responseObservedAt,publishedAt:file.publishedAt,
  httpStatus:file.httpStatus,httpStatusSource:file.httpStatusSource,
  transactionHash:s.transaction,ledger:s.ledger,network:s.network,asset:s.asset,amountAtomic:s.amountAtomic};
}
async function origin(input){
 const packet=await openInboxTaskPacket({directory:input.packetDirectory,expectedTaskSha256:input.expectedTaskSha256});
 const raw=await initializationBytes(join(input.packetDirectory,'receiving.json'),32*1024*1024);
 const manifestRaw=await initializationBytes(join(input.packetDirectory,'manifest.json'),16*1024*1024);
 need(identity(JSON.parse(raw))===identity(packet.plan)&&identity(JSON.parse(manifestRaw))===identity(packet.packet),'CUSTOMER_TASK_PACKET_CHANGED');
 const task={taskSha256:packet.taskSha256,planSha256:packet.packet.planSha256,system:packet.task.system,id:packet.task.id,revision:packet.task.revision};
 const sourceFiles=[{name:'manifest.json',bytes:manifestRaw.length,sha256:digest(manifestRaw)},{name:'receiving.json',bytes:raw.length,sha256:digest(raw)}];
 let total=0;const rows=[],responses=[];
 for(const [index,intentId]of input.intentIds.entries()){
  const at=packet.plan.task.manifest.entries.findIndex(x=>x.selection.intentId===intentId);
  need(at>=0,'CUSTOMER_TASK_INTENT_NOT_SELECTED');
  const entry=packet.plan.task.manifest.entries[at],job=packet.plan.jobs[at],file=packet.files.find(x=>x.intentId===intentId);
  const response=packet.response(intentId),verified=await response.verify();
  need(verified.bytes===file.bytes&&verified.sha256===file.sha256,'CUSTOMER_TASK_RESPONSE_CHANGED');
  total+=file.bytes;need(total<=MAX_CONTENT,'CUSTOMER_DELIVERY_CONTENT_LIMIT');
  const recovery=recoveryProjection(job,entry);
  const witnesses=[...sourceFiles];
  if(recovery)for(const [name,value]of [['read.json',job.rpcRecovery.readDocument],['completed.json',job.rpcRecovery.completedDocument]])witnesses.push({name,bytes:value.bytes,sha256:value.sha256});
  rows.push({intentId,jobId:job.id,configSha256:job.configSha256,sourceConfigSha256:job.sourceConfigSha256,
   sourceRecordSha256:identity({taskSha256:packet.taskSha256,entry,job}),
   originalCreatedAt:job.createdAt,capturedAt:packet.plan.createdAt,method:job.operation.method,nativeState:job.state,
   originalSourceFiles:witnesses,observation:originalObservation(job),
   originalOutcome:{status:job.outcome?.status??null,httpStatus:job.outcome?.httpStatus??null,responseStatus:job.outcome?.responseFile?.status??null,errorCode:job.outcome?.error?.code??null},
   recovery,
   output:{state:'VERIFIED',path:'responses/'+String(index+1).padStart(3,'0')+'.bin',bytes:file.bytes,sha256:file.sha256}});
  responses.push({response,row:rows.at(-1)});
 }
 const capture={sha256:digest(raw),bytes:raw.length,capturedAt:packet.plan.createdAt};
 return{packet,raw,manifestRaw,task,capture,rows,responses,sourceFiles};
}

export async function inspectInboxTaskDelivery({packetDirectory,expectedTaskSha256}={}){
 absolute(packetDirectory);need(hash(expectedTaskSha256),'CUSTOMER_TASK_DELIVERY_IDENTITY');
 const packet=await openInboxTaskPacket({directory:packetDirectory,expectedTaskSha256});
 return{schema:SCHEMA+'.task-inspection',task:{taskSha256:packet.taskSha256,planSha256:packet.packet.planSha256,system:packet.task.system,id:packet.task.id,revision:packet.task.revision},
  intents:packet.plan.task.manifest.entries.map((entry,index)=>{
   const job=packet.plan.jobs[index],file=packet.files.find(value=>value.intentId===entry.selection.intentId);
   need(file,'CUSTOMER_TASK_INTENT_NOT_SELECTED');
   return{intentId:entry.selection.intentId,role:entry.selection.role,jobId:job.id,nativeState:job.state,
    originalStatus:job.outcome?.error?.code??job.outcome?.status??null,
    recoveredReadId:entry.selection.rpcResult?.readId??null,bytes:file.bytes,sha256:file.sha256};
  })};
}

export function createInboxTaskDelivery({directory,exportsRoot,lock,inspect}){
 async function preview(input){
  input=taskDeliveryRequest(input);
  const selected=await origin(input);
  const source=await selectSource({...input,exclude:[directory,input.packetDirectory]});
  const value={schema:SCHEMA+'.task-preview',request:input,task:selected.task,
   capture:selected.capture,jobs:selected.rows,packetFiles:selected.sourceFiles,
   source:{sha256:source.sha256,files:source.files.length,bytes:source.bytes}};
  return{...value,previewSha256:identity(value)};
 }
 async function prepare(input){
  const savedRequest=taskDeliveryRequest(input);need(hash(input.expectedPreviewSha256),'CUSTOMER_DELIVERY_PREVIEW_REQUIRED');
  return lock(async()=>{
   const base=join(exportsRoot,savedRequest.id);await initializationDirectory(base,{create:true});
   const intentPath=join(base,'intent.json');let intent=await parse(intentPath);
   if(intent)need(identity(intent.request)===identity(savedRequest)&&intent.previewSha256===input.expectedPreviewSha256,'CUSTOMER_DELIVERY_REQUEST_CONFLICT');
   else{
    const reviewed=await preview(savedRequest);
    need(reviewed.previewSha256===input.expectedPreviewSha256,'CUSTOMER_DELIVERY_PREVIEW_CHANGED');
    intent={schema:SCHEMA+'.intent',request:savedRequest,previewSha256:reviewed.previewSha256,preview:reviewed,createdAt:new Date().toISOString()};
    await retainInitializationFile(intentPath,bytes(intent),{resume:true});
   }
   if(await parse(join(base,'result.json')))return inspect(savedRequest.id);
   const selected=await origin(savedRequest);
   need(identity(selected.task)===identity(intent.preview.task)&&identity(selected.capture)===identity(intent.preview.capture)&&identity(selected.rows)===identity(intent.preview.jobs)&&identity(selected.sourceFiles)===identity(intent.preview.packetFiles),'CUSTOMER_TASK_PACKET_CHANGED');
   const source=await selectSource({...savedRequest,exclude:[directory,savedRequest.packetDirectory]});
   need(source.sha256===intent.preview.source.sha256,'CUSTOMER_DELIVERY_SOURCE_CHANGED');
   // Retain the complete original private plan and packet descriptor. Customer
   // projection contains selected facts and complete response/source files only.
   await retainInitializationFile(join(base,'private-original-task.json'),selected.raw,{resume:true});
   await retainInitializationFile(join(base,'private-original-task-manifest.json'),selected.manifestRaw,{resume:true});
   const members=join(base,'members');await initializationDirectory(members,{create:true});const files=[];
   for(const {response,row}of selected.responses){
    const destination=await ensureMember(members,row.output.path);
    try{await measure(destination,row.output);}
    catch(error){
     if(error.code!=='ENOENT')throw error;
     try{await response.saveAs(destination);}
     catch(failure){if(failure.code!=='EEXIST')throw failure;}
     await measure(destination,row.output);
    }
    files.push({path:row.output.path,role:'response',bytes:row.output.bytes,sha256:row.output.sha256});
   }
   for(const row of source.files){const path='source/'+row.path;await copyFile(join(savedRequest.sourceRoot,row.path),await ensureMember(members,path),row);files.push({path,role:'source',bytes:row.bytes,sha256:row.sha256});}
   const review={schema:SCHEMA+'.review',title:savedRequest.title,note:savedRequest.note,collection:null,task:selected.task,capture:selected.capture,rows:selected.rows,outputsComplete:true,source:{sha256:source.sha256,files:source.files}};
   for(const[path,raw]of[['review.json',bytes(review)],['review.html',Buffer.from(reviewHtml(review))]]){
    await retainInitializationFile(join(members,path),raw,{resume:true});files.push({path,role:'review',bytes:raw.length,sha256:digest(raw)});
   }
   const manifest={...review,schema:SCHEMA,files},archive=await writePackage(join(base,'customer-delivery.ndjson'),manifest,row=>join(members,row.path));
   const result={schema:SCHEMA+'.result',id:savedRequest.id,state:'COMPLETE',request:savedRequest,previewSha256:intent.previewSha256,package:{filename:savedRequest.id+'.ndjson',mediaType:'application/x-ndjson',bytes:archive.bytes,sha256:archive.sha256,manifestSha256:archive.manifestSha256},manifest};
   await retainInitializationFile(join(base,'result.json'),bytes(result),{resume:true});return clone(result);
  });
 }
 return{inspect:inspectInboxTaskDelivery,preview,prepare};
}
