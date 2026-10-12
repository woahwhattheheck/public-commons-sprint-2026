// SPDX-License-Identifier: MIT
// Delivery actions use the original SensorThings writer and immutable artifact receiver.
import {join} from 'node:path';
import {privateDirectory} from '../../../stellar-expert/store.mjs';
import {identity,json,stable,plain,need,hash,text,absolute,selected,opId,makeRecord,verifyRecord,
  phase,optionalJSON,operationRoot,claimOperation} from './common.mjs';
import {MERCHANT_SCHEMA,MERCHANT_ACTIONS,MERCHANT_MEANING} from './schema.mjs';
import {MAX_ASSET_BYTES,MAX_ASSET_BUDGET} from '../../../response-asset.mjs';
import {freezePublicationSelection} from './source.mjs';
import {publishOffer,inspectOffer,prepareBuyer,startOffer} from './seller.mjs';
import {previewReceiving,captureInbox,receiveProject,inspectReceiving,inspectInput} from './receiving.mjs';
import {connectionFromRuntime,validateOperations} from './operations.mjs';
import {operationProject} from './history.mjs';
const clone=x=>structuredClone(x);
export function merchantRuntime(input={},buyerInboxDirectory=null){
  need(plain(input),'RUNTIME','Use the host-selected merchant runtime configuration.',422);
  const allowed=['port','maxInFlight','drainGraceMs','nativeFactory','operationsAccessFile','signal'];
  need(Object.keys(input).every(k=>allowed.includes(k)),'RUNTIME','Use declared host runtime fields.',422);
  const runtime={port:input.port??0,maxInFlight:input.maxInFlight??4,drainGraceMs:input.drainGraceMs??60000,
    nativeFactory:input.nativeFactory??null,operationsAccessFile:input.operationsAccessFile??null,signal:input.signal};
  for(const [key,min,max]of [['port',0,65535],['maxInFlight',1,256],['drainGraceMs',1,300000]])
    need(Number.isSafeInteger(runtime[key])&&runtime[key]>=min&&runtime[key]<=max,'RUNTIME','Use a bounded '+key+'.',422);
  need(runtime.nativeFactory===null||typeof runtime.nativeFactory==='function','RUNTIME','Use the maintained configured native payment factory.',422);
  if(runtime.operationsAccessFile)absolute(runtime.operationsAccessFile,'original Operations access file');
  if(buyerInboxDirectory)absolute(buyerInboxDirectory,'original buyer Inbox directory');
  runtime.buyerInboxDirectory=buyerInboxDirectory;return runtime;
}
export function merchantContext(state,op,{inboxDirectory=null,buyerInboxDirectory=null}={}){
  const p=op.payload,c={workspaceId:state.workspaceId};
  need(Object.hasOwn(MERCHANT_ACTIONS,op.action),'ACTION','Select an advertised original delivery action.',422);
  text(p.actor,'the attributed operator',200);
  if(op.action==='analysis.merchant.offer'){
    c.source=freezePublicationSelection(state,p);c.projectId=c.source.publication.projectId;
    c.versionId=c.source.publication.versionId;c.publicationId=c.source.publication.id;
  }else if(['analysis.merchant.start','analysis.merchant.stop','analysis.merchant.buyer.prepare'].includes(op.action)){
    c.offer=selected(state.analysisMerchant,p.offerId,'original seller offer');need(c.offer.kind==='offer','OFFER','Select an existing original seller offer.',422);
    if(op.action!=='analysis.merchant.stop')need(identity(c.offer)===hash(p.expectedOfferSha256),'OFFER_CHANGED','The reviewed offer changed.');
    text(p.note,'the operator note');c.projectId=c.offer.projectId;c.versionId=c.offer.versionId;c.publicationId=c.offer.publicationId;
  }else if(op.action==='analysis.merchant.inbox.capture'){
    const publication=selected(state.analysisPublications,p.publicationId,'original publication');
    need(publication.projectId===p.projectId&&publication.versionId===p.versionId,'PUBLICATION','Select the exact project, version and publication.');
    need(buyerInboxDirectory,'BUYER_INBOX','Configure the existing native buyer Inbox on the host.',503);
    text(p.note,'the operator note');c.buyerInboxDirectory=buyerInboxDirectory;
    c.projectId=p.projectId;c.versionId=p.versionId;c.publicationId=p.publicationId;
  }else if(op.action==='analysis.merchant.receive'){
    need(inboxDirectory,'INBOX','Configure the existing host source inbox.',503);text(p.reason,'the receiving reason');
    need(['received','changes_requested'].includes(p.decision),'DECISION','Choose an attributed receiving decision.',422);
    opId(p.publicationId);hash(p.expectedPublicationSha256);validateOperations(p.operations);
    c.inboxDirectory=inboxDirectory;c.publicationId=p.publicationId;
    const known=(state.analysisPublications??[]).find(x=>x.id===p.publicationId);
    c.projectId=opId(p.projectId);c.versionId=hash(p.versionId);
    if(known)need(known.projectId===c.projectId&&known.versionId===c.versionId,'PUBLICATION','The incoming selection differs from this retained publication.');
  }else if(op.action==='analysis.merchant.resume'){
    const original=state.operations[opId(p.originalOperationId)];
    need(original&&Object.hasOwn(MERCHANT_ACTIONS,original.action)&&original.action!=='analysis.merchant.resume',
      'ORIGINAL_OPERATION','Choose the original local delivery operation, not an imported history or another resume request.',404);
    need(original.requestSha256===hash(p.expectedRequestSha256),'ORIGINAL_REQUEST','The selected original request changed.');
    text(p.reason,'the original-operation continuation reason');
    c.original={operationId:original.operationId,action:original.action,requestSha256:original.requestSha256,
      contextSha256:identity(original.context),createdAt:original.createdAt,projectId:operationProject(original)};
    c.projectId=c.original.projectId;
  }
  return c;
}
function recordSummary(record){
  return {id:record.id,recordSha256:identity(record),kind:record.kind,projectId:record.projectId,versionId:record.versionId,
    publicationId:record.publicationId,operationId:record.operationId,originWorkspaceId:record.originWorkspaceId,
    createdAt:record.createdAt,actor:record.actor,fileCount:record.files.length,source:record.value.binding??null,
    title:record.value.terms?.title??record.kind,execution:record.value.execution??null};
}
export function createMerchantManager({store,runtime={},validateSnapshot=()=>{}}){
  const services=new Map();let closing=false,closed=null;
  const active=()=>need(!closing,'CLOSED','The original workspace is closing.',503);
  function record(id){active();hash(id,'record identity');return selected(store.read().analysisMerchant,id,'delivery record');}
  function service(id){
    const original=record(id);need(original.kind==='offer','OFFER','Select an original offer.');
    const live=services.get(id);
    return {offerId:id,offerSha256:identity(original),running:Boolean(live),origin:live?.value.url??null,
      mode:live?.value.mode??null,startOperationId:live?.operationId??null,
      meaning:live?'Observed in this original workspace process.':'No live seller is owned by this workspace process. A historical start is not current readiness.'};
  }
  async function inspect(id){
    const r=record(id);
    if(r.kind==='offer')return {...await inspectOffer(store,r),service:service(id)};
    if(r.kind==='receiving')return inspectReceiving(store,r);
    const proof=await verifyRecord(store,r);
    return {record:r,recordSha256:identity(r),availability:'VERIFIED',originalAction:proof.action,
      ...(r.kind.startsWith('service-')?{service:service(r.value.offerId)}:{})};
  }
  function overview(projectId=null){
    active();const s=store.read(),records=(s.analysisMerchant??[]).filter(x=>projectId===null||x.projectId===projectId);
    return {schema:MERCHANT_SCHEMA,workspaceId:s.workspaceId,revision:s.revision,records:records.map(recordSummary),
      sourceProjects:(s.analysisProjects??[]).map(x=>({id:x.id,title:x.title,headVersionId:x.headVersionId})),
      publications:(s.analysisPublications??[]).filter(x=>projectId===null||x.projectId===projectId).map(x=>({id:x.id,projectId:x.projectId,versionId:x.versionId,title:x.title,createdAt:x.createdAt,publicationSha256:identity(x),fileCount:x.files.length})),
      exports:(s.analysisExports??[]).filter(x=>projectId===null||x.projectId===projectId),meaning:MERCHANT_MEANING,
      runtime:{buyerInboxBound:Boolean(runtime.buyerInboxDirectory),operationsBound:Boolean(runtime.operationsAccessFile),
        nativePaymentConfigured:Boolean(runtime.nativeFactory),port:runtime.port??0},limits:{fileBytes:MAX_ASSET_BYTES,totalRouteBytes:MAX_ASSET_BUDGET},
      services:records.filter(x=>x.kind==='offer').map(x=>service(x.id))};
  }
  async function operation(id){
    active();opId(id);const op=store.read().operations[id];
    need(op&&Object.hasOwn(MERCHANT_ACTIONS,op.action),'ORIGINAL_OPERATION','Select an original local delivery operation.',404);
    let result=null,availability=null;
    if(op.state==='COMPLETE'){result=JSON.parse((await store.object(op.resultSha256)).toString('utf8'));
      try{availability=await verifyResult(result);}catch(e){availability={available:false,code:e.code,message:e.message};}}
    return {schema:'stellar-forge.sensorthings-analysis-merchant-operation-view.v1',workspaceId:store.read().workspaceId,
      original:clone(op),result,availability,executed:false};
  }
  function operations(){
    active();const s=store.read();return {workspaceId:s.workspaceId,revision:s.revision,
      operations:Object.values(s.operations).filter(x=>Object.hasOwn(MERCHANT_ACTIONS,x.action)).map(x=>({
        operationId:x.operationId,action:x.action,requestSha256:x.requestSha256,state:x.state,createdAt:x.createdAt,
        projectId:operationProject(x),error:x.error??null,resumptions:x.merchantResumptions??[]})),
      importedHistory:(s.analysisMerchantHistory??[]).map(x=>({id:x.id,originWorkspaceId:x.originWorkspaceId,projectId:x.projectId,original:{operationId:x.original.operationId,action:x.original.action,state:x.original.state,requestSha256:x.original.requestSha256,createdAt:x.original.createdAt},files:x.files.length})),meaning:'Original local operations may be explicitly continued. Imported histories are read-only.'};
  }
  async function verifyResult(result){
    if(result?.schema==='stellar-forge.sensorthings-analysis-merchant-record.v1'){
      const current=selected(store.read().analysisMerchant,result.id,'committed original delivery record');
      need(stable(current)===stable(result),'RESULT','The original committed result differs from its workspace record.');
      const checked=await inspect(current.id);return {available:true,recordId:current.id,recordSha256:identity(current),availability:checked.availability};
    }
    need(result?.schema==='stellar-forge.sensorthings-analysis-merchant-resume.v1','RESULT','The saved delivery result has an unknown schema.');
    return verifyResult(result.originalResult);
  }
  async function execute(op){
    active();await claimOperation(store,op);const c=op.context.analysis.merchant,p=op.payload;
    if(op.action==='analysis.merchant.offer')return {record:await publishOffer(store,op)};
    if(op.action==='analysis.merchant.buyer.prepare')return {record:await prepareBuyer(store,op,c.offer)};
    if(op.action==='analysis.merchant.inbox.capture')return {record:await captureInbox(store,op,runtime)};
    if(op.action==='analysis.merchant.receive')return receiveProject(store,op,runtime,{validateSnapshot});
    if(op.action==='analysis.merchant.start'){
      const offer=c.offer,attemptPath=join(operationRoot(store,op),'merchant-service-start.attempt.json');
      const observed=await phase(store,op,'service-start',async()=>{
        const prior=await optionalJSON(attemptPath),live=services.get(offer.id);
        if(live){need(live.operationId===op.operationId,'SERVICE_ACTIVE','Stop the original live offer before starting another service session.');return live.value;}
        need(!prior,'SERVICE_UNAVAILABLE','The original start was attempted but its live service/observation is unavailable. Preserve it and select an explicit new start operation.');
        await privateDirectory(operationRoot(store,op),{create:true});
        await store.immutable(attemptPath,json({schema:'stellar-forge.sensorthings-analysis-merchant-service-attempt.v1',
          operationId:op.operationId,requestSha256:op.requestSha256,offerId:offer.id,offerSha256:identity(offer)}));
        const instance=await startOffer(store,offer,runtime),value={offerId:offer.id,offerSha256:identity(offer),
          url:instance.url,mode:instance.mode,startedAt:new Date().toISOString(),execution:'SERVICE_STARTED',
          meaning:'Observed native listener. Challenge-only mode cannot settle a purchase; native payment mode uses the configured original factory.'};
        services.set(offer.id,{operationId:op.operationId,instance,value});return value;
      });
      return {record:await makeRecord(store,op,{kind:'service-start',projectId:offer.projectId,versionId:offer.versionId,
        publicationId:offer.publicationId,value:observed,files:[offer.value.catalog]})};
    }
    if(op.action==='analysis.merchant.stop'){
      const offer=c.offer,value=await phase(store,op,'service-stop',async()=>{
        const live=services.get(offer.id);
        if(live){await live.instance.close();services.delete(offer.id);}
        return {offerId:offer.id,offerSha256:identity(offer),stoppedAt:new Date().toISOString(),execution:'SERVICE_INACTIVE',
          originalStartOperationId:live?.operationId??null,previouslyRunning:Boolean(live)};
      });
      return {record:await makeRecord(store,op,{kind:'service-stop',projectId:offer.projectId,versionId:offer.versionId,
        publicationId:offer.publicationId,value,files:[offer.value.catalog]})};
    }
    need(false,'ACTION','Use the original core continuation for this declared operation.',422);
  }
  async function cases(){const connection=await connectionFromRuntime(runtime);
    need(connection,'OPERATIONS_UNCONFIGURED','Configure the original Operations connection on this host.',503);
    return {origin:connection.origin,value:await connection.cases()};}
  async function caseRead(id){const connection=await connectionFromRuntime(runtime);
    need(connection,'OPERATIONS_UNCONFIGURED','Configure the original Operations connection on this host.',503);
    return {origin:connection.origin,value:await connection.read(id)};}
  function close(){
    if(closed)return closed;closing=true;
    closed=(async()=>{const results=await Promise.allSettled([...services.values()].map(async live=>{await live.instance.close();services.delete(live.value.offerId);}));
      const failed=results.find(x=>x.status==='rejected');if(failed)throw failed.reason;})();
    void closed.catch(()=>{closed=null;});return closed;
  }
  return {record,inspect,overview,service,operation,operations,verifyResult,execute,cases,case:caseRead,
    input:selection=>inspectInput(store,selection,runtime.inboxDirectory),
    history:id=>clone(selected(store.read().analysisMerchantHistory,hash(id),'imported historical operation')),
    preview:selection=>previewReceiving(store,selection,runtime,runtime.inboxDirectory),close};
}
