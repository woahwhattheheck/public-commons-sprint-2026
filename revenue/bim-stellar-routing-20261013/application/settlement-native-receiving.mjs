import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openWorkspace,receiveWorkspace,inspectPacket} from './lib/workspace.mjs';
import {bytes,hash,identity} from './lib/value.mjs';
import {writeExact,atomicJSON,verifyFile,readJSON,directory,lease} from './lib/files.mjs';
import {createSettlementService} from './lib/settlement-service.mjs';
import {createOriginalSettlementAnalytics} from './lib/settlement-source.mjs';
const source=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(process.argv[2]??'');
if(!process.argv[2])throw Error('Pass one new or retained private receiving directory.');
await directory(root);
const receivingLease=await lease(root,'settlement-native-receiving');
let workspace;
try{
const operationId='BIM-SETTLEMENT-RECEIVING-4593-20261013';
const selected={schema:'bim.settlement-native-receiving.v1',operationId,application:hash(await fs.readFile(path.join(source,'source-files.json')))};
const write=async(name,value)=>{await writeExact(path.join(root,name),bytes(value));return value;};
await write('receiving-selection.json',selected);
let journal=await readJSON(path.join(root,'receiving-journal.json'),true)??{schema:'bim.settlement-native-journal.v1',selection:selected,steps:[]};
if(identity(journal.selection)!==identity(selected))throw Error('Original receiving source changed.');
const checkpoint=()=>atomicJSON(path.join(root,'receiving-journal.json'),journal);
async function artifact(record,name,data){
 const descriptor=await writeExact(path.join(root,name),data);
 const value={path:name,bytes:descriptor.bytes,sha256:descriptor.sha256};
 record.artifacts??=[];const old=record.artifacts.find(x=>x.path===name);
 if(old&&identity(old)!==identity(value))throw Error('Original completed artifact changed: '+name);
 if(!old)record.artifacts.push(value);await checkpoint();return value;
}
async function verifyArtifacts(record){
 if(!Array.isArray(record.artifacts)||!record.artifacts.some(x=>x.path==='steps/'+record.name+'.json'))throw Error('Completed receiving step lacks its original retained artifact selection.');
 for(const descriptor of record.artifacts)await verifyFile(root,descriptor);
 const result=await readJSON(path.join(root,'steps',record.name+'.json'));
 if(identity(result)!==identity(record.result))throw Error('Completed receiving result changed: '+record.name);
}
const step=async(name,run,verifyNative=async()=>{})=>{
 const old=journal.steps.find(x=>x.name===name);
 if(old?.status==='COMPLETE'){await verifyArtifacts(old);await verifyNative(old);return old.result;}
 const record=old??{name,status:'RUNNING',artifacts:[]};if(!old)journal.steps.push(record);await checkpoint();
 try{
  const retained=await readJSON(path.join(root,'steps',name+'.json'),true);
  if(retained!==null){record.result=retained;await artifact(record,'steps/'+name+'.json',bytes(retained));}
  else{record.result=await run(record);await artifact(record,'steps/'+name+'.json',bytes(record.result));}
  await verifyArtifacts(record);await verifyNative(record);
  record.status='COMPLETE';delete record.error;await checkpoint();return record.result;
 }catch(error){record.error={code:error.code??null,message:error.message};await checkpoint();throw error;}
};
function verifyRequest(record,status){
 const original=workspace.request(record.envelope.requestId);
 if(original.status!==status)throw Error('Original native request state changed: '+record.envelope.requestId);
 if(identity(original.envelope)!==identity(record.envelope))throw Error('Original native request envelope changed.');
 return original;
}
 workspace=await openWorkspace({directory:path.join(root,'workspace'),name:'BIM settlement original receiving',sourceDirectory:source,adapters:[],fetch:async()=>{throw Error('This local original-store course has no provider request.');}});
 await step('retained-original-source',async record=>{
  const raw=await fs.readFile(path.join(source,'SETTLEMENT.md'));
  record.envelope??={requestId:'settlement-native-source',expectedRevision:workspace.read().workspace.revision,method:'source.import',args:{name:'SETTLEMENT.md',type:'text/markdown; charset=utf-8',bytes:raw.length,sha256:hash(raw),contentBase64:raw.toString('base64')}};
  await checkpoint();return workspace.command(record.envelope);
 },record=>{verifyRequest(record,'COMPLETE');});
 await step('original-failed-request-retained',async record=>{
  record.envelope??={requestId:'settlement-native-unavailable-action',expectedRevision:workspace.read().workspace.revision,method:'query.run',args:{actionId:'settlement.unregistered-source-read',input:{}}};await checkpoint();
  try{await workspace.command(record.envelope);throw Error('Unregistered action unexpectedly ran.');}catch(error){const original=workspace.request(record.envelope.requestId);if(original.status!=='FAILED')throw error;return{request:original,errorCode:original.error.code};}
 },record=>{const original=verifyRequest(record,'FAILED');if(identity(original)!==identity(record.result.request))throw Error('Original failed source request changed.');});
 const service=createSettlementService({workspace});
 let packet;
 await step('complete-selected-package',async record=>{
  const saved=await readJSON(path.join(root,'complete-source.json'),true);
  const opened=saved?service.receive(saved):await service.build({includeUndated:true});
  const file=service.file({sourceSha256:opened.report.source.sha256,reportSha256:opened.report.sha256,selection:opened.report.selection,name:'complete-source.json'});
  packet=JSON.parse(file.bytes);await artifact(record,'complete-source.json',file.bytes);return{sha256:hash(file.bytes),bytes:file.bytes.length,report:opened.report};
 });
 if(!packet)packet=JSON.parse(await fs.readFile(path.join(root,'complete-source.json'),'utf8'));
 const selectedReport=service.receive(packet).report;
 await step('original-exception-note-and-replay',async record=>{
  const exception=selectedReport.exceptions.find(x=>x.kind==='ORIGINAL_REQUEST_FAILED');if(!exception)throw Error('Actual failed request is missing from full report.');
  record.review??={sourceSha256:selectedReport.source.sha256,reportSha256:selectedReport.sha256,exceptionId:exception.id,decision:'ACKNOWLEDGED',reason:'The source-only receiving course deliberately selected an unregistered read action; its original FAILED request remains retained.',evidenceIds:[exception.sourceRefs[0].id]};
  if(!record.envelope){const prepared=service.prepareReview(record.review);record.envelope={requestId:'settlement-native-exception-review',expectedRevision:prepared.expectedRevision};}
  await checkpoint();const first=await service.review(record.review,record.envelope),again=await service.review(record.review,record.envelope);
  if(identity(first.response??first.result)!==identity(again.response??again.result)||again.replayed!==true)throw Error('Original review replay differs.');
  return{first,again,notes:service.reviews(record.review)};
 },async record=>{const original=workspace.request(record.envelope.requestId);if(original.status!=='COMPLETE')throw Error('Original exception decision changed.');const replay=await service.review(record.review,record.envelope);if(replay.replayed!==true||identity(replay.response)!==identity(record.result.first.response))throw Error('Original accepted review response changed.');});
 await step('following-source-and-original-review-replay',async record=>{
  const raw=await fs.readFile(path.join(source,'BIM_SETTLEMENT_CONTRACT.json'));
  record.envelope??={requestId:'settlement-native-following-source',expectedRevision:workspace.read().workspace.revision,method:'source.import',args:{name:'BIM_SETTLEMENT_CONTRACT.json',type:'application/json',bytes:raw.length,sha256:hash(raw),contentBase64:raw.toString('base64')}};
  await checkpoint();const following=await workspace.command(record.envelope);
  const original=journal.steps.find(x=>x.name==='original-exception-note-and-replay');
  service.clear();
  const replay=await service.review(original.review,original.envelope);
  if(replay.replayed!==true||identity(replay.response)!==identity(original.result.first.response))throw Error('Later source change prevented the original accepted review replay.');
  let changedRejected=false;try{await service.review({...original.review,reason:original.review.reason+' changed'},original.envelope);}catch(error){changedRejected=error.code==='ORIGINAL_REVIEW_INPUT_CONFLICT';}
  if(!changedRejected)throw Error('Changed review input reused an original request.');
  service.receive(packet);return{following,replay,changedRejected};
 },record=>{verifyRequest(record,'COMPLETE');});
 await step('immutable-multi-tab-reports',async record=>{
  const first=service.file({sourceSha256:selectedReport.source.sha256,reportSha256:selectedReport.sha256,name:'report.json'});
  const analytics=createOriginalSettlementAnalytics(),alternate=analytics.exportPackage(packet.source,{...selectedReport.selection,accounts:['unselected-source-course-account']});
  const other=service.receive(alternate),following=await service.build({includeUndated:true});
  const retained=service.file({sourceSha256:selectedReport.source.sha256,reportSha256:selectedReport.sha256,name:'report.json'});
  if(first.sha256!==retained.sha256||!first.bytes.equals(retained.bytes))throw Error('Another tab replaced the original report.');
  const ref=selectedReport.exceptions[0].sourceRefs[0],originalDetail=service.source({sourceSha256:selectedReport.source.sha256,ref});
  await artifact(record,'multi-tab/original-report.json',retained.bytes);
  await artifact(record,'multi-tab/following-source.json',service.file({sourceSha256:following.report.source.sha256,reportSha256:following.report.sha256,name:'complete-source.json'}).bytes);
  return{originalReportSha256:selectedReport.sha256,otherReportSha256:other.report.sha256,followingReportSha256:following.report.sha256,originalFileSha256:retained.sha256,originalDetailSha256:identity(originalDetail)};
 });
 await step('all-complete-files',async record=>{
  const names=['report.json','complete-source.json','volume.csv','selections.csv','route-attempts.csv','balance-observations.csv','vault-activities.csv','positions.csv','execution-quality.csv','movements.csv','reconciliation.csv','fallbacks.csv','lifecycle.csv','exceptions.csv','report.html','manifest.json'],files=[];
  await directory(path.join(root,'report-files'));
  for(const name of names){const file=service.file({sourceSha256:selectedReport.source.sha256,selection:selectedReport.selection,name});await artifact(record,'report-files/'+name,file.bytes);files.push({name,bytes:file.bytes.length,sha256:file.sha256});}
  return files;
 });
 await step('full-package-independent-recompute',async()=>{
  const a=createOriginalSettlementAnalytics(),reopened=a.receivePackage(JSON.parse(await fs.readFile(path.join(root,'report-files/complete-source.json'),'utf8')));
  if(identity(reopened.result)!==identity(selectedReport))throw Error('Full original report differs after reopen.');
  const damaged=JSON.parse(JSON.stringify(packet));damaged.source.body.workspace.workspace.name+=' changed';let refused=false;try{a.receivePackage(damaged);}catch{refused=true;}if(!refused)throw Error('Changed source was accepted.');
  return{reportSha256:reopened.result.sha256,sourceSha256:reopened.result.source.sha256,changedOriginalRejected:refused};
 });
 const exportResult=await step('whole-original-workspace-export',async record=>{
  const saved=await readJSON(path.join(root,'whole-workspace.json'),true),exported=saved??await workspace.portable();
  if(identity(exported.body.workspace.history)!==identity(workspace.read().history))throw Error('Retained workspace export differs from original receiving history.');
  await artifact(record,'whole-workspace.json',bytes(exported));return inspectPacket(exported);
 });
 await workspace.close();workspace=null;
 await step('original-workspace-receive-and-reopen',async()=>{
  const original=JSON.parse(await fs.readFile(path.join(root,'whole-workspace.json'),'utf8'));
  const received=await receiveWorkspace({packet:original,directory:path.join(root,'received-workspace'),requestId:'settlement-native-whole-receive',sourceDirectory:source,adapters:[]});
  const reopened=await openWorkspace({directory:path.join(root,'received-workspace'),sourceDirectory:source,adapters:[]});
  try{const state=reopened.read(),prior=original.body.workspace;if(identity(state.history)!==identity(prior.history)||identity(state.notes)!==identity(prior.notes))throw Error('Original report review history changed.');return{received,workspaceId:state.workspace.id,revision:state.workspace.revision,notes:state.notes,executionEnabled:state.config.executionEnabled};}finally{await reopened.close();}
 },async record=>{const reopened=await openWorkspace({directory:path.join(root,'received-workspace'),sourceDirectory:source,adapters:[]});try{const state=reopened.read(),prior=JSON.parse(await fs.readFile(path.join(root,'whole-workspace.json'),'utf8')).body.workspace;if(identity(state.history)!==identity(prior.history)||identity(state.notes)!==identity(prior.notes)||state.workspace.id!==record.result.workspaceId)throw Error('Completed received workspace changed.');}finally{await reopened.close();}});
 journal.status='NATIVE_COMPLETE_BROWSER_PENDING';journal.scope='Original SQLite source import, retained failed request, immutable exception note/replay, sixteen complete files, source-recomputed package and whole original workspace receiving. Provider network and mounted full-application browser continuation remain with the original programme owner.';
 await checkpoint();console.log(JSON.stringify({status:journal.status,operationId,root,steps:journal.steps.map(x=>({name:x.name,status:x.status})),reportSha256:selectedReport.sha256,sourceSha256:selectedReport.source.sha256,exportResult}));
}finally{try{if(workspace)await workspace.close();}finally{await receivingLease.release();}}
