// SPDX-License-Identifier: MIT
// Exact SF88 output -> original SensorThings project importer -> original SF47 receiving.
import {join} from 'node:path';
import {lstat} from 'node:fs/promises';
import {inspectHandoff} from '../../../../sf88-operator-buyer-cli/operations-handoff/contract.mjs';
import {exportSelectedInbox,inspectSavedHandoff} from '../../../../sf88-operator-buyer-cli/operations-handoff/customer.mjs';
import {prepareReview} from '../../../../sf88-operator-buyer-cli/prepare.mjs';
import {MAX_ASSET_BYTES,MAX_ASSET_BUDGET} from '../../../response-asset.mjs';
import {privateDirectory} from '../../../stellar-expert/store.mjs';
import {importProject,inspectProjectManifest} from '../transfer.mjs';
import {inspectIncomingProject} from './source.mjs';
import {OperationsConnection,connectionFromRuntime,operationsPreview,originalCommand,validateOperations} from './operations.mjs';
import {identity,json,stable,sha,need,text,hash,absolute,plain,descriptor,exactPath,exactFile,fileJSON,retainedPath,
  operationRoot,phase,freeze,makeRecord,verifyRecord,selected,safeFile,MAX_HANDOFF,MAX_CATALOG} from './common.mjs';
const inputFile=(v,maximum,label)=>{
  need(plain(v)&&Object.keys(v).every(k=>['filename','bytes','sha256'].includes(k))&&safeFile(v.filename)&&
    Number.isSafeInteger(v.bytes)&&v.bytes>0&&v.bytes<=maximum,'INPUT_FILE','Select the complete '+label+' from the original host-bound inbox.',422);hash(v.sha256);return v;
};
async function inboxBytes(directory,file,maximum){need(directory,'INBOX','The host source inbox is not configured.',503);
  return exactPath(join(directory,file.filename),file,maximum);}
export function inspectBuyer({catalog,handoff,response,rowIndex,acceptIndex,jobId}){
  need(Buffer.isBuffer(catalog)&&catalog.length>0&&catalog.length<=MAX_CATALOG&&Buffer.isBuffer(handoff)&&handoff.length>0&&handoff.length<=MAX_HANDOFF,
    'BUYER_SOURCE','Select the complete native catalog and original saved Inbox handoff.',413);
  const report=inspectHandoff(handoff),row=report.rows.find(r=>r.jobId===jobId);
  need(row?.canReceive,'BUYER_JOB','Select an original receivable Inbox job.',422);
  const prepared=prepareReview(catalog,{rowIndex,acceptIndex,intentId:row.intentId,url:row.url,method:row.method,
    responseOut:'/private/original-analysis-project.ndjson.gz'}),listing=prepared.draft.preparedFrom.originalListing,
    asset=listing.extensions?.['stellar-forge-asset'],packet=JSON.parse(handoff),
    native=packet.jobs.find(j=>j.native.id===jobId),expected=native?.native.operation.expect,actual=prepared.draft.operation.expect;
  need(asset?.contentType==='application/gzip'&&asset.bytes<=MAX_ASSET_BYTES,'COMPLETE_PROJECT','Select the actual complete analysis project archive offer.',422);
  need(expected,'BUYER_JOB','The original handoff omits the selected native job.');
  for(const key of ['scheme','network','asset','payTo','maxAtomic','maxTimeoutSeconds','paymentFlow'])
    need((expected[key]??null)===(actual[key]??null),'BUYER_TERMS','The catalog payment option differs from the original buyer request.');
  need(row.method==='GET'&&listing.resource.url===row.url&&row.output.state==='VERIFIED'&&
    row.output.sha256===asset.sha256&&row.output.bytes===asset.bytes,'BUYER_OUTPUT','The original reader has not verified this exact archive response.');
  if(response!==undefined)need(Buffer.isBuffer(response)&&response.length===asset.bytes&&sha(response)===asset.sha256,
    'RESPONSE_BYTES','The selected saved response differs from the original native output.');
  return {catalog:{bytes:catalog.length,sha256:sha(catalog)},handoff:{bytes:handoff.length,sha256:sha(handoff)},
    rowIndex,acceptIndex,jobId,intentId:row.intentId,url:row.url,asset,acceptedTerms:actual,row,
    sourceCounts:report.counts,meaning:'Original payment, settlement and output observations remain separate from this receiving review.'};
}
export async function previewReceiving(store,p,runtime,inboxDirectory){
  inputFile(p.catalog,MAX_CATALOG,'native catalog');inputFile(p.handoff,MAX_HANDOFF,'native Inbox handoff');inputFile(p.response,MAX_ASSET_BYTES,'original response');
  hash(p.expectedPublicationSha256);text(p.publicationId,'the selected publication ID',100);
  const catalog=await inboxBytes(inboxDirectory,p.catalog,MAX_CATALOG),handoff=await inboxBytes(inboxDirectory,p.handoff,MAX_HANDOFF),
    response=await inboxBytes(inboxDirectory,p.response,MAX_ASSET_BYTES),
    buyer=inspectBuyer({catalog,handoff,response,rowIndex:p.rowIndex,acceptIndex:p.acceptIndex,jobId:p.jobId}),
    original=await inspectIncomingProject(store,{path:join(inboxDirectory,p.response.filename),expectedSha256:p.response.sha256,
      expectedBytes:p.response.bytes,publicationId:p.publicationId,expectedPublicationSha256:p.expectedPublicationSha256});
  let operations=null;
  if(p.operations?.caseId)operations=await operationsPreview(await connectionFromRuntime(runtime),buyer,handoff,p.operations.caseId);
  return {schema:'stellar-forge.sensorthings-analysis-merchant-preview.v1',workspaceId:store.read().workspaceId,
    project:{id:original.manifest.snapshot.project.id,title:original.manifest.snapshot.project.title,
      headVersionId:original.manifest.snapshot.project.headVersionId},publication:original.publication,binding:original.binding,
    inspection:original.inspection,buyer,operations,mutated:false,
    meaning:'Read-only original source selection. The original project importer still must verify every member and citation before a receiving decision commits.'};
}
export async function captureInbox(store,op,runtime){
  const c=op.context.analysis.merchant,p=op.payload,ids=p.intentIds;
  need(Array.isArray(ids)&&ids.length>=1&&ids.length<=100&&new Set(ids).size===ids.length,'INTENTS','Select distinct original Inbox intents.',422);
  ids.forEach(id=>need(typeof id==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(id),'INTENT','Retain the exact original Inbox intent ID.',422));
  absolute(c.buyerInboxDirectory,'host-bound original Inbox');const root=operationRoot(store,op);
  await privateDirectory(root,{create:true});
  const target=join(root,'merchant-inbox-handoff.json'),attempt=join(root,'merchant-inbox-capture.attempt.json');
  let present;try{present=await lstat(target);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!present){
    let prior;try{prior=await lstat(attempt);}catch(e){if(e.code!=='ENOENT')throw e;}
    need(!prior,'CAPTURE_UNAVAILABLE','The original capture attempt has no retained handoff. Resolve that original file; a new observation was not made.');
    await store.immutable(attempt,json({schema:'stellar-forge.sensorthings-analysis-merchant-capture-attempt.v1',
      operationId:op.operationId,requestSha256:op.requestSha256,intentIds:ids,createdAt:op.createdAt}));
    await exportSelectedInbox({directory:c.buyerInboxDirectory,intentIds:ids,destination:target,
      maxVerifyBytes:Math.min(1024*1024*1024,MAX_ASSET_BUDGET),signal:runtime.signal});
  }
  const saved=await inspectSavedHandoff({file:target,signal:runtime.signal});
  need(stable(saved.intentIds)===stable(ids),'CAPTURE_IDENTITY','The saved native capture selects different original intents.');
  const file={name:'merchant-inbox-handoff.json',type:'application/json',bytes:saved.bytes,sha256:saved.sha256,
    storage:{operationId:op.operationId,filename:'merchant-inbox-handoff.json'}};
  return makeRecord(store,op,{kind:'inbox-capture',projectId:p.projectId,versionId:p.versionId,publicationId:p.publicationId,
    value:{file,intentIds:ids,counts:saved.counts,noExecution:true,canReceive:saved.canReceive??null},files:[file]});
}
export async function receiveProject(store,op,runtime,{validateSnapshot=()=>{}}={}){
  const p=op.payload,c=op.context.analysis.merchant,association=validateOperations(p.operations);
  text(p.reason,'an explicit receiving review reason');
  need(['received','changes_requested'].includes(p.decision),'DECISION','Record an explicit file receiving decision.',422);
  const inputs=await phase(store,op,'received-inputs',async()=>{
    const files={};
    for(const [key,maximum,type]of [['catalog',MAX_CATALOG,'application/json'],['handoff',MAX_HANDOFF,'application/json'],['response',MAX_ASSET_BYTES,'application/gzip']]){
      const selectedFile=inputFile(p[key],maximum,key),raw=await inboxBytes(c.inboxDirectory,selectedFile,maximum);
      files[key]=await freeze(store,op,key+(key==='response'?'.ndjson.gz':'.json'),raw,type,{input:selectedFile});
    }
    return files;
  });
  const catalog=await exactFile(store,inputs.catalog,MAX_CATALOG),handoff=await exactFile(store,inputs.handoff,MAX_HANDOFF),
    response=await exactFile(store,inputs.response,MAX_ASSET_BYTES),
    buyer=inspectBuyer({catalog,handoff,response,rowIndex:p.rowIndex,acceptIndex:p.acceptIndex,jobId:p.jobId}),
    original=await inspectIncomingProject(store,{path:retainedPath(store,inputs.response),expectedSha256:inputs.response.sha256,
      expectedBytes:inputs.response.bytes,publicationId:p.publicationId,expectedPublicationSha256:p.expectedPublicationSha256});
  need(original.binding.projectId===c.projectId&&original.binding.versionId===c.versionId,'PROJECT_SELECTION','The delivered project/version differ from the reviewed receiving selection.');
  validateSnapshot(original.manifest.snapshot);
  const imported=await importProject(store,{inboxDirectory:operationRoot(store,op),filename:inputs.response.name,
    expectedSha256:inputs.response.sha256,expectedBytes:inputs.response.bytes,id:op.operationId,createdAt:op.createdAt});
  need(stable(imported.snapshot)===stable(original.manifest.snapshot),'RECEIVED_PROJECT','The native receiver returned another original analysis snapshot.');
  validateSnapshot(imported.snapshot);
  const firstReview={schema:'stellar-forge.sensorthings-analysis-file-receiving.v1',operationId:op.operationId,actor:p.actor,
    reviewedAt:op.createdAt,decision:p.decision,reason:p.reason,binding:original.binding,projectReceipt:imported.receipt,
    buyer:{catalog:buyer.catalog,handoff:buyer.handoff,jobId:buyer.jobId,intentId:buyer.intentId,url:buyer.url,
      sourceRecordSha256:buyer.row.sourceRecordSha256,configSha256:buyer.row.configSha256,
      purchase:structuredClone(buyer.row.purchase),output:structuredClone(buyer.row.output)},
    meaning:'Exact native file receiving and attributed operator review. It records no new acquisition, payment, scientific approval or merchant order acceptance.'};
  const reviewFile=await freeze(store,op,'receiving-review.json',json(firstReview),'application/json',{binding:original.binding});
  let operations=null;
  if(association){
    const connection=await connectionFromRuntime(runtime);
    need(connection&&connection.origin===association.origin,'OPERATIONS_ORIGIN','Reconnect the originally selected Operations origin.',503);
    const received=await originalCommand(store,op,'buyer-receive',connection,async()=>{
      const preview=await operationsPreview(connection,buyer,handoff,association.caseId);
      need(preview.program.version===association.expectedCaseVersion&&preview.preview.previewSha256===association.expectedPreviewSha256,
        'OPERATIONS_REVIEW','The original case or buyer preview changed after operator review.');
      return {origin:connection.origin,caseId:association.caseId,body:{expectedVersion:association.expectedCaseVersion,actor:p.actor,
        requestId:op.operationId+':buyer-receive',note:p.reason,action:'buyer.receive',data:{filename:'original-sf88-handoff.json',
          contentBase64:handoff.toString('base64'),expectedPreviewSha256:association.expectedPreviewSha256,
          deploymentId:association.deploymentId,selections:[{jobId:p.jobId,purchaseId:association.purchaseId||null}]}}};
    });
    need(received.purchaseIds?.length===1&&received.selectedJobIds?.length===1&&received.selectedJobIds[0]===p.jobId,
      'OPERATIONS_RESULT','The original receiver returned another selected buyer job.');
    const purchaseId=received.purchaseIds[0],source=await originalCommand(store,op,'analysis-source',connection,async()=>{
      const current=await connection.read(association.caseId);
      need(current.program.version===received.version,'OPERATIONS_VERSION','The case changed after original buyer receiving.');
      return {origin:connection.origin,caseId:association.caseId,body:{expectedVersion:current.program.version,actor:p.actor,
        requestId:op.operationId+':analysis-source',note:'Attach the exact original analysis-project receiving review.',action:'source.add',
        data:{filename:'analysis-receiving-'+sha(op.operationId).slice(0,20)+'.json',mediaType:'application/json',kind:'purchase',
          sourceUrl:buyer.url,observedAt:op.createdAt,contentBase64:json(firstReview).toString('base64')}}};
    });
    const linked=await originalCommand(store,op,'purchase-source',connection,async()=>{
      const current=await connection.read(association.caseId),purchase=current.records.purchases.find(r=>r.id===purchaseId);
      need(current.program.version===source.version&&purchase?.deploymentId===association.deploymentId&&purchase.intentId===buyer.intentId,
        'OPERATIONS_LINK','The original purchase association changed before source linking.');
      return {origin:connection.origin,caseId:association.caseId,body:{expectedVersion:current.program.version,actor:p.actor,
        requestId:op.operationId+':purchase-source',note:'Link the frozen analysis receiving evidence; preserve independent order/payment observations.',
        action:'purchase.observe',data:{...purchase,sourceIds:[...new Set([...(purchase.sourceIds??[]),source.recordId])],
          sourceNote:((purchase.sourceNote??'')+'\nOriginal analysis publication '+original.publication.id+
            '; complete project '+inputs.response.sha256+'; receiving '+op.operationId+'.').trim()}}};
    });
    operations=await phase(store,op,'operations-observation',async()=>{
      const current=await connection.read(association.caseId),purchase=current.records.purchases.find(r=>r.id===purchaseId);
      need(purchase?.sourceIds?.includes(source.recordId),'OPERATIONS_LINK','The native receiving source link is unavailable.');
      return {origin:connection.origin,caseId:association.caseId,deploymentId:association.deploymentId,purchaseId,
        buyerResult:received,sourceResult:source,linkResult:linked,observedProgramVersion:current.program.version};
    });
  }
  const operationsFile=operations?await freeze(store,op,'operations-receiving.json',json(operations),'application/json',{binding:original.binding}):null;
  const record=await makeRecord(store,op,{kind:'receiving',projectId:original.binding.projectId,versionId:original.binding.versionId,
    publicationId:original.publication.id,value:{binding:original.binding,buyer,decision:p.decision,reason:p.reason,review:reviewFile,
      projectReceipt:imported.receipt,inputs,operations,operationsFile,sourceReviewRequired:true},
    files:[...Object.values(inputs),reviewFile,...(operationsFile?[operationsFile]:[]),...original.publication.files]});
  return {record,snapshot:imported.snapshot,receipt:imported.receipt};
}
export async function inspectReceiving(store,record){
  const proof=await verifyRecord(store,record);need(record.kind==='receiving'&&proof.action==='analysis.merchant.receive','RECEIVING','Select the original committed receiving record.');
  const v=record.value,p=proof.payload,catalog=await exactFile(store,v.inputs.catalog,MAX_CATALOG),
    handoff=await exactFile(store,v.inputs.handoff,MAX_HANDOFF),response=await exactFile(store,v.inputs.response,MAX_ASSET_BYTES),
    buyer=inspectBuyer({catalog,handoff,response,rowIndex:p.rowIndex,acceptIndex:p.acceptIndex,jobId:p.jobId}),
    original=await inspectIncomingProject(store,{path:retainedPath(store,v.inputs.response),expectedSha256:v.inputs.response.sha256,
      expectedBytes:v.inputs.response.bytes,publicationId:p.publicationId,expectedPublicationSha256:p.expectedPublicationSha256}),
    {value:review}=await fileJSON(store,v.review);
  need(stable(original.binding)===stable(v.binding)&&stable(buyer)===stable(v.buyer)&&stable(review.binding)===stable(v.binding)&&
    review.operationId===record.operationId&&review.actor===record.actor&&review.decision===p.decision&&review.reason===p.reason&&
    stable(review.projectReceipt)===stable(v.projectReceipt),'RECEIVING_IDENTITY','The original receiving review changed.');
  // Full original import checks are only replayed in the same receiving workspace.
  // Imported history remains the original observation, with its files reverified.
  let receiving=null;
  if(store.read().workspaceId===record.originWorkspaceId){
    receiving=await importProject(store,{inboxDirectory:join(store.root,'exports',record.operationId),filename:v.inputs.response.name,
      expectedSha256:v.inputs.response.sha256,expectedBytes:v.inputs.response.bytes,id:record.operationId,createdAt:record.createdAt});
    need(stable(receiving.receipt)===stable(v.projectReceipt),'RECEIVING_RECEIPT','The original artifact receiving receipt differs.');
  }
  if(v.operations){
    const {value:observed}=await fileJSON(store,v.operationsFile);
    need(stable(observed)===stable(v.operations),'OPERATIONS_RECEIPT','The original Operations result differs.');
  }
  return {record,recordSha256:identity(record),availability:'VERIFIED',buyer,binding:v.binding,
    receivingScope:receiving?'ORIGINAL_RECEIVING_WORKSPACE':'IMPORTED_HISTORICAL_RECEIVING',operationsCurrentState:'NOT_REQUERIED'};
}

/** Preview only host-selected existing files. Original native readers still gate receiving. */
export async function inspectInput(store,selection,inboxDirectory){
  need(plain(selection)&&Object.keys(selection).every(k=>['kind','file'].includes(k)),'INPUT','Select one original input file.',422);
  const kind=selection.kind,maximum=kind==='catalog'?MAX_CATALOG:kind==='handoff'?MAX_HANDOFF:MAX_ASSET_BYTES;
  need(['catalog','handoff','project'].includes(kind),'INPUT','Select a catalog, native handoff or complete project.',422);
  const file=inputFile(selection.file,maximum,kind),raw=await inboxBytes(inboxDirectory,file,maximum);
  if(kind==='handoff')return {kind,file,report:inspectHandoff(raw),mutated:false};
  if(kind==='catalog'){
    let value;try{value=JSON.parse(raw.toString('utf8'));}catch{need(false,'CATALOG','Select the original complete native JSON catalog.',422);}
    need(plain(value)&&Array.isArray(value.resources)&&value.resources.length<=10000,'CATALOG','The original catalog has no bounded resources list.',422);
    return {kind,file,value,mutated:false,meaning:'Original catalog metadata. The selected row and payment option are checked by the maintained buyer reader.'};
  }
  const original=await inspectProjectManifest(store,{path:join(inboxDirectory,file.filename),expectedBytes:file.bytes,expectedSha256:file.sha256});
  return {kind,file,project:original.manifest.snapshot.project,originalWorkspaceId:original.manifest.originalWorkspaceId,
    publications:original.manifest.snapshot.publications.map(p=>({id:p.id,projectId:p.projectId,versionId:p.versionId,title:p.title,
      publicationSha256:identity(p),fileCount:p.files.length})),inspection:original.inspection,mutated:false};
}
