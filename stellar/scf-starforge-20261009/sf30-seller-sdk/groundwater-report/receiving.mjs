// SPDX-License-Identifier: MIT
// Reopen actual SF88 files and use the original Groundwater and Operations receiving engines.
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {inspectHandoff} from '../../sf88-operator-buyer-cli/operations-handoff/contract.mjs';
import {exportSelectedInbox,inspectSavedHandoff} from '../../sf88-operator-buyer-cli/operations-handoff/customer.mjs';
import {prepareReview} from '../../sf88-operator-buyer-cli/prepare.mjs';
import {SCHEMA,MAX_FILE,MAX_JSON,sha,json,canonical,now,need,fail,fields,text,ident,digest,absolute,identity,
  read,readJSON,put,exists,checkFile,directory,ownedOperation,phase,finish,operation,core} from './common.mjs';

const CASE=/^operation-[a-f0-9]{32}$/, DEP=/^deployment-[a-f0-9]{32}$/, PURCHASE=/^purchase-[a-f0-9]{32}$/;
function uploaded(raw,limit,label){
  need(Buffer.isBuffer(raw)&&raw.length>0&&raw.length<=limit,'SOURCE_SIZE','Select the complete '+label+' within its supported bound.',413);
  return identity(raw);
}
export function inspectBuyerSelection({catalog,handoff,rowIndex,acceptIndex,jobId,response}){
  const catalogIdentity=uploaded(catalog,1024*1024,'original file catalog'),handoffIdentity=uploaded(handoff,8*1024*1024,'original SF88 handoff');
  const report=inspectHandoff(handoff);
  const row=report.rows.find(x=>x.jobId===jobId);
  need(row&&row.canReceive,'BUYER_SELECTION','Select one original receivable SF88 job.',422);
  const prepared=prepareReview(catalog,{rowIndex,acceptIndex,intentId:row.intentId,url:row.url,method:row.method,responseOut:'/private/groundwater-selected-response.zip'});
  const listing=prepared.draft.preparedFrom.originalListing,asset=listing.extensions?.['stellar-forge-asset'];
  need(asset&&asset.contentType==='application/zip','COMPLETE_REPORT_REQUIRED','Select the original complete report ZIP offer.',422);
  const packet=JSON.parse(handoff),original=packet.jobs.find(x=>x.native.id===jobId),expect=original.native.operation.expect,selected=prepared.draft.operation.expect;
  for(const key of ['scheme','network','asset','payTo','maxAtomic','maxTimeoutSeconds','paymentFlow'])
    need((expect[key]??null)===(selected[key]??null),'BUYER_TERMS_CHANGED','This catalog payment option differs from the original buyer selection.');
  need(row.method==='GET'&&row.url===listing.resource.url,'BUYER_RESOURCE_CHANGED','The original buyer request names another resource.');
  need(row.output.state==='VERIFIED'&&row.output.bytes===asset.bytes&&row.output.sha256===asset.sha256,
    'BUYER_OUTPUT_UNVERIFIED','The original SF88 reader has not verified this exact report file.');
  let responseIdentity=null;
  if(response!==undefined){
    responseIdentity=uploaded(response,MAX_FILE,'retained purchased ZIP');
    need(responseIdentity.bytes===asset.bytes&&responseIdentity.sha256===asset.sha256,'BUYER_RESPONSE_CHANGED','The selected response differs from the original pinned file product.');
  }
  return {schema:'stellar-forge.groundwater-buyer-selection.v1',catalog:catalogIdentity,handoff:handoffIdentity,
    rowIndex,acceptIndex,jobId,intentId:row.intentId,url:row.url,asset,acceptedTerms:selected,
    row,report,response:responseIdentity,
    interpretation:'The retained native reader reports payment and output independently. File receiving and an operator review do not change settlement or merchant order state.'};
}
export class OperationsConnection{
  constructor(accessUrl,{signal}={}){
    const u=new URL(accessUrl);
    need((u.protocol==='https:'||u.protocol==='http:'&&u.hostname==='127.0.0.1')&&!u.username&&!u.password&&
      u.hash.startsWith('#access=')&&u.hash.length>12,'OPERATIONS_ACCESS','Use the original private Operations access link.',422);
    this.origin=u.origin;this.token=u.hash.slice('#access='.length);this.signal=signal;
  }
  async request(path,body){
    need(/^\/api\/operations(?:\/|$)/.test(path),'OPERATIONS_ROUTE','Use the original Operations routes.');
    const stop=AbortSignal.timeout(60000),signal=this.signal?AbortSignal.any([stop,this.signal]):stop;
    const response=await fetch(this.origin+path,{method:body===undefined?'GET':'POST',redirect:'error',signal,
      headers:{authorization:'Bearer '+this.token,...(body===undefined?{}:{'content-type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    const reader=response.body?.getReader(),chunks=[];let count=0;
    if(reader)try{while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;need(count<=32*1024*1024,'OPERATIONS_SIZE','The original Operations response exceeds its bound.',413);chunks.push(value);}}finally{reader.releaseLock();}
    const raw=Buffer.concat(chunks.map(x=>Buffer.from(x)));let result;
    try{result=JSON.parse(raw);}catch{throw fail('OPERATIONS_RESPONSE','The original Operations response is incomplete.',503);}
    if(!response.ok)throw fail(result.error?.code??'OPERATIONS_REJECTED',result.error?.message??'The original Operations action was rejected.',response.status,result.error);
    return result;
  }
  cases(){return this.request('/api/operations');}
  read(caseId){need(CASE.test(caseId),'CASE_SELECTION','Select the original Operations case.',422);return this.request('/api/operations/'+caseId);}
  preview(caseId,body){need(CASE.test(caseId),'CASE_SELECTION','Select the original Operations case.',422);return this.request('/api/operations/'+caseId+'/buyer-preview',body);}
}
export async function previewOperations(connection,selection,handoff,caseId){
  const current=await connection.read(caseId);
  const preview=await connection.preview(caseId,{expectedVersion:current.program.version,filename:'original-sf88-handoff.json',contentBase64:handoff.toString('base64')});
  const row=preview.rows.find(x=>x.jobId===selection.jobId);
  need(row&&row.sourceRecordSha256===selection.row.sourceRecordSha256&&preview.source.sha256===selection.handoff.sha256,
    'OPERATIONS_SOURCE_CHANGED','The original Operations reader returned different source identities.');
  return {case:current.program,preview,row};
}
async function originalCommand(op,phaseName,connection,build){
  const prepared=await phase(op,phaseName,build),request=prepared.value;
  need(CASE.test(request.caseId)&&request.body.requestId===op.request.body.operationId+':'+phaseName,
    'COMMAND_IDENTITY','The original command ID or case binding differs.');
  const receiptPath=join(op.root,phaseName+'.receipt.json');
  if(await exists(receiptPath)){
    const saved=(await readJSON(receiptPath)).value;
    need(saved.requestSha256===sha(canonical(request)),'COMMAND_IDENTITY','The retained native command receipt differs.');
    return saved.result;
  }
  // The exact original request is durable before dispatch. Replaying it uses
  // native idempotency before CAS; no replacement request is generated.
  const result=await connection.request('/api/operations/'+request.caseId+'/command',request.body);
  await put(receiptPath,{requestSha256:sha(canonical(request)),result});
  return result;
}
function receivingInput(input){
  fields(input,['rowIndex','acceptIndex','jobId','decision','reason','caseId','deploymentId','purchaseId','expectedCaseVersion','expectedPreviewSha256'],'report receiving selection');
  digest(input.jobId,'original Inbox job ID');text(input.reason,'receiving review reason',8000);
  need(['received','changes_requested'].includes(input.decision),'RECEIVING_DECISION','Record an explicit file receiving decision.',422);
  if(input.caseId){
    need(CASE.test(input.caseId)&&DEP.test(input.deploymentId)&&(!input.purchaseId||PURCHASE.test(input.purchaseId)),
      'OPERATIONS_SELECTION','Select the original case, buyer deployment and explicit existing purchase or new-purchase choice.',422);
    need(Number.isSafeInteger(input.expectedCaseVersion)&&input.expectedCaseVersion>=1,'OPERATIONS_VERSION','Retain the reviewed case version.',422);
    digest(input.expectedPreviewSha256,'original buyer preview SHA-256');
  }else need(!input.deploymentId&&!input.purchaseId&&!input.expectedCaseVersion&&!input.expectedPreviewSha256,
    'OPERATIONS_SELECTION','Keep the complete Operations association together.',422);
  return structuredClone(input);
}
export async function receiveReport({desk,operationId,actor,input,catalog,handoff,response,connection=null,runtime={}}){
  const chosen=receivingInput(input);
  const sources={catalog:uploaded(catalog,1024*1024,'catalog'),handoff:uploaded(handoff,8*1024*1024,'SF88 source'),response:uploaded(response,MAX_FILE,'purchased ZIP')};
  return ownedOperation(desk,operationId,'receive',actor,{...chosen,sources},async op=>{
    for(const [name,raw]of [['catalog.json',catalog],['handoff.json',handoff],['response.zip',response]])await put(join(op.root,name),raw);
    if(await exists(join(op.root,'result.json')))return inspectReceiving(desk,operationId,runtime);
    const selected=inspectBuyerSelection({catalog,handoff,rowIndex:chosen.rowIndex,acceptIndex:chosen.acceptIndex,jobId:chosen.jobId,response});
    const inspected=(await phase(op,'original-report',()=>core('inspect-unbound',{archive:join(op.root,'response.zip')},runtime))).value;
    need(inspected.binding.archiveSha256===selected.asset.sha256&&inspected.binding.archiveBytes===selected.asset.bytes,
      'REPORT_OUTPUT_BINDING','The original scientific package differs from the saved buyer output.');
    const received=await core('receive',{archive:join(op.root,'response.zip'),directory:join(op.root,'received-report'),expected:inspected.binding},runtime);
    const review={schema:'stellar-forge.groundwater-file-receiving-review.v1',operationId,reviewer:actor,reviewedAt:op.request.createdAt,
      decision:chosen.decision,reason:chosen.reason,binding:inspected.binding,
      artifactReceipt:received.receipt,
      buyer:{source:selected.handoff,catalog:selected.catalog,jobId:selected.jobId,intentId:selected.intentId,url:selected.url,
        configSha256:selected.row.configSha256,sourceRecordSha256:selected.row.sourceRecordSha256,
        attemptStatus:selected.row.purchase.attemptStatus,settlementStatus:selected.row.purchase.settlementStatus,
        transactionHash:selected.row.purchase.transactionHash,network:selected.row.purchase.network,asset:selected.row.purchase.asset,
        amountAtomic:selected.row.purchase.amountStroops,output:selected.row.output},
      scope:'Operator review of the exact received report files and their source findings. It does not assert a new payment, independent customer, field validation or merchant order acceptance.',
      files:inspected.package.manifest.files};
    await put(join(op.root,'receiving-review.json'),review);
    let operations=null;
    if(chosen.caseId){
      need(connection instanceof OperationsConnection,'OPERATIONS_CONNECTION','Reopen the original configured Operations application.',503);
      const buyerResult=await originalCommand(op,'buyer-receive',connection,async()=>{
        const current=await connection.read(chosen.caseId);
        need(current.program.version===chosen.expectedCaseVersion,'OPERATIONS_CONFLICT','The case changed after selection; retain this original review.',409);
        const preview=await previewOperations(connection,selected,handoff,chosen.caseId);
        need(preview.preview.previewSha256===chosen.expectedPreviewSha256,'BUYER_PREVIEW_CONFLICT','The original buyer preview changed after review.');
        return {caseId:chosen.caseId,body:{expectedVersion:chosen.expectedCaseVersion,actor,requestId:operationId+':buyer-receive',
          note:chosen.reason,action:'buyer.receive',data:{filename:'original-sf88-handoff.json',contentBase64:handoff.toString('base64'),
            expectedPreviewSha256:chosen.expectedPreviewSha256,deploymentId:chosen.deploymentId,
            selections:[{jobId:chosen.jobId,purchaseId:chosen.purchaseId||null}]}}};
      });
      need(buyerResult.purchaseIds?.length===1&&buyerResult.selectedJobIds?.[0]===chosen.jobId,
        'OPERATIONS_RESULT','The original buyer receiver returned another selection.');
      const purchaseId=buyerResult.purchaseIds[0];
      const evidence=await originalCommand(op,'report-source',connection,async()=>{
        const current=await connection.read(chosen.caseId);
        need(current.program.version===buyerResult.version,'OPERATIONS_CONFLICT','The case changed after buyer receiving; retain the original partial operation.');
        return {caseId:chosen.caseId,body:{expectedVersion:current.program.version,actor,requestId:operationId+':report-source',
          note:'Attach the exact Groundwater report receiving review.',action:'source.add',
          data:{filename:'groundwater-report-'+sha(operationId).slice(0,20)+'.json',mediaType:'application/json',kind:'purchase',
            sourceUrl:selected.url,observedAt:op.request.createdAt,contentBase64:json(review).toString('base64')}}};
      });
      const linked=await originalCommand(op,'purchase-source',connection,async()=>{
        const current=await connection.read(chosen.caseId),purchase=current.records.purchases.find(x=>x.id===purchaseId);
        need(current.program.version===evidence.version&&purchase&&purchase.deploymentId===chosen.deploymentId&&purchase.intentId===selected.intentId,
          'OPERATIONS_CONFLICT','The original purchase association changed before report source linking.');
        // Preserve every independently recorded order/payment/output fact.
        const data={...purchase,sourceIds:[...new Set([...(purchase.sourceIds??[]),evidence.recordId])],
          sourceNote:((purchase.sourceNote??'')+'\nFrozen Groundwater report '+inspected.binding.reportId+
            '; exact ZIP '+inspected.binding.archiveSha256+'; receiving review '+operationId+'.').trim()};
        return {caseId:chosen.caseId,body:{expectedVersion:current.program.version,actor,requestId:operationId+':purchase-source',
          note:'Link the original report receiving evidence without changing the retained payment or order observation.',
          action:'purchase.observe',data}};
      });
      const current=await connection.read(chosen.caseId),purchase=current.records.purchases.find(x=>x.id===purchaseId);
      need(purchase?.sourceIds?.includes(evidence.recordId),'OPERATIONS_LINK','The original report source link is unavailable.');
      operations={caseId:chosen.caseId,deploymentId:chosen.deploymentId,purchaseId,buyerResult,evidenceResult:evidence,linkResult:linked};
      await put(join(op.root,'operations-receiving.json'),operations);
    }
    await finish(op,{kind:'receiving',reportId:inspected.binding.reportId,archiveSha256:inspected.binding.archiveSha256,
      reviewSha256:sha(json(review)),decision:chosen.decision,operations});
    return inspectReceiving(desk,operationId,runtime);
  });
}
export async function inspectReceiving(desk,id,runtime={}){
  const op=await operation(desk,id);
  need(op.request.body.action==='receive'&&op.result,'RECEIVING_INCOMPLETE','The original report receiving operation is incomplete.');
  const input=op.request.body.input;
  const catalog=await checkFile(join(op.root,'catalog.json'),input.sources.catalog,1024*1024),
    handoff=await checkFile(join(op.root,'handoff.json'),input.sources.handoff,8*1024*1024),
    response=await checkFile(join(op.root,'response.zip'),input.sources.response);
  const selected=inspectBuyerSelection({catalog,handoff,rowIndex:input.rowIndex,acceptIndex:input.acceptIndex,jobId:input.jobId,response});
  const review=(await readJSON(join(op.root,'receiving-review.json'))).value;
  need(sha(json(review))===op.result.result.reviewSha256&&review.operationId===id&&review.binding.archiveSha256===selected.asset.sha256,
    'RECEIVING_IDENTITY','The original report review differs from its committed receipt.');
  // This original method verifies the same received members and reuses its first
  // receipt. It performs no model, purchase or new receiving-decision operation.
  const current=await core('receive',{archive:join(op.root,'response.zip'),directory:join(op.root,'received-report'),expected:review.binding},runtime);
  need(canonical(current.receipt)===canonical(review.artifactReceipt),'RECEIVING_IDENTITY','The original artifact receipt differs.');
  if(op.result.result.operations){
    const link=(await readJSON(join(op.root,'operations-receiving.json'))).value;
    need(canonical(link)===canonical(op.result.result.operations),'OPERATIONS_RECEIPT','The saved Operations receiving receipt differs.');
    for(const name of ['buyer-receive','report-source','purchase-source']){
      const request=(await readJSON(join(op.root,name+'.phase.json'))).value,receipt=(await readJSON(join(op.root,name+'.receipt.json'))).value;
      need(request.operationSha256===op.request.bodySha256&&receipt.requestSha256===sha(canonical(request.value)),
        'OPERATIONS_RECEIPT','An original request/receipt binding differs.');
    }
  }
  return {state:'COMPLETE',operationId:id,root:op.root,review,buyer:selected,originalResult:op.result,availability:'VERIFIED'};
}
export async function continueReceiving({desk,operationId,connection=null,runtime={}}){
  const op=await operation(desk,operationId);
  need(op.request.body.action==='receive','OPERATION_ACTION','Select the original report receiving operation.');
  const {sources,...input}=op.request.body.input;
  return receiveReport({desk,operationId,actor:op.request.body.actor,input,
    catalog:await checkFile(join(op.root,'catalog.json'),sources.catalog,1024*1024),
    handoff:await checkFile(join(op.root,'handoff.json'),sources.handoff,8*1024*1024),
    response:await checkFile(join(op.root,'response.zip'),sources.response),connection,runtime});
}
export async function captureBuyer({desk,operationId,actor,inboxDirectory,intentIds,runtime={}}){
  absolute(inboxDirectory,'original Inbox directory');
  need(Array.isArray(intentIds)&&intentIds.length>=1&&intentIds.length<=100&&new Set(intentIds).size===intentIds.length,
    'ORIGINAL_INTENTS','Select distinct original intent IDs.',422);
  intentIds.forEach(id=>{text(id,'original buyer intent',128);need(/^[A-Za-z0-9._:-]{1,128}$/.test(id),'ORIGINAL_INTENTS','Use the exact original buyer intent ID.');});
  return ownedOperation(desk,operationId,'capture',actor,{inboxDirectory,intentIds},async op=>{
    const destination=join(op.root,'handoff.json'),attempt=join(op.root,'capture-attempt.json');
    if(!await exists(destination)){
      need(!await exists(attempt),'CAPTURE_UNRESOLVED','The original capture attempt has no retained publication. Resolve that original file; no new observation was made.');
      await put(attempt,{operationSha256:op.request.bodySha256,destination:'handoff.json',attemptedAt:now()});
      await exportSelectedInbox({directory:inboxDirectory,intentIds,destination,maxVerifyBytes:MAX_FILE,signal:runtime.signal});
    }
    const original=await inspectSavedHandoff({file:destination,signal:runtime.signal});
    need(original.intentIds.length===intentIds.length&&original.intentIds.every((x,i)=>x===intentIds[i]),'CAPTURE_IDENTITY','The saved capture names different original intents.');
    const result={kind:'buyer-capture',file:{path:'handoff.json',bytes:original.bytes,sha256:original.sha256},intentIds,counts:original.counts,noExecution:true};
    await finish(op,result);return {...result,operationId,root:op.root};
  });
}
