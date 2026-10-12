// MIT. Original Buyer application actions, then the original Research receiver.
import {join,basename} from 'node:path';
import {BuyerRunbookAgent,readBuyerAgentConfiguration} from '../../../buyer-runbook/agent-client.mjs';
import {BUYER_AGENT_ACTIONS} from '../../../buyer-runbook/agent-contract.mjs';
import {receiveCustomerHandover} from '../customer-updates/operator.mjs';
import {describeCustomerFile,copyCustomerFile} from '../customer-updates/files.mjs';
import {receiveResearchPaidArchive,inspectResearchPaidArchive} from './archive.mjs';
import {selectedBuyer} from './configuration.mjs';
import {COMMERCE_SCHEMA,PUBLICATION_LIMIT,PAID_ARCHIVE_LIMIT,fields,identifier,hash,alias,text,atomic,
 environmentName,publicPublication,checkPublicationArchive,phaseId,need,copy,same,fingerprint} from './contracts.mjs';
import {customerDirectory,withCustomerOperation,optionalJson,retainRequest,retainCustomerJson,retainCustomerBytes,
 readCustomerJson,jsonBytes,digest,stamp,inspectCommerceRecord,retainedBytes,exists} from './files.mjs';

const purchaseSchema='sf88-research-paid-purchase-prepared/v1';
const requestFile=id=>'action-'+identifier(id)+'.json';
function sourceInput(input){
 fields(input,['requestId','buyer','filename','base64']);identifier(input.requestId);alias(input.buyer);text(input.filename,180);
 need(typeof input.base64==='string'&&input.base64.length<=4*Math.ceil(PUBLICATION_LIMIT/3),
  'RESEARCH_COMMERCE_PUBLICATION_SIZE_INVALID');
 const body=Buffer.from(input.base64,'base64');
 need(body.length>0&&body.length<=PUBLICATION_LIMIT&&body.toString('base64')===input.base64,
  'RESEARCH_COMMERCE_PUBLICATION_ENCODING_INVALID');
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}
 catch{throw Object.assign(new Error('RESEARCH_COMMERCE_PUBLICATION_JSON_INVALID'),{code:'RESEARCH_COMMERCE_PUBLICATION_JSON_INVALID'});}
 const publication=publicPublication(value);
 return {request:{requestId:input.requestId,buyer:input.buyer,filename:input.filename,
  publicationSha256:digest(body),publicationBytes:body.length},body,publication};
}
async function purchaseRecord(root){
 const record=await inspectCommerceRecord(root,'purchases');
 const input=await retainedBytes(root,'publication.json',{sha256:record.request.request.publicationSha256,
  bytes:record.request.request.publicationBytes}),publication=publicPublication(JSON.parse(input.toString('utf8')));
 const buyer=await optionalJson(root,'buyer.json');
 need(buyer&&buyer.bindingSha256===fingerprint(buyer.binding),'RESEARCH_COMMERCE_BUYER_BINDING_CHANGED');
 const handoff=await readCustomerJson(join(root,'merchant.handoff.json'));
 need(same(handoff.value,publication.handoff),'RESEARCH_COMMERCE_BUYER_HANDOFF_CHANGED');
 return {...record,publication,buyer,handoff};
}
async function readPrepared(root){
 const prepared=await optionalJson(root,'prepared.json');
 if(prepared){
  const {preparedSha256,...proof}=prepared;
  need(prepared.schema===purchaseSchema&&preparedSha256===fingerprint(proof),
   'RESEARCH_COMMERCE_PREPARED_PURCHASE_CHANGED');
 }
 return prepared;
}
function requestId(input){fields(input,['id']);return identifier(input.id);}
function preparedInput(input){
 fields(input,['id','requestId','preparedSha256']);identifier(input.id);identifier(input.requestId);hash(input.preparedSha256);
 return copy(input);
}
async function selectedPrepared(root,input){
 const record=await purchaseRecord(root),prepared=await readPrepared(root);
 need(record.request.request.requestId===input.id&&prepared&&prepared.preparedSha256===input.preparedSha256&&
  prepared.publicationSha256===record.request.request.publicationSha256,
  'RESEARCH_COMMERCE_PREPARED_PURCHASE_CHANGED');
 return {record,prepared};
}
async function saveAction(root,kind,input){
 const name=requestFile(input.requestId),old=await optionalJson(root,name);
 if(old){need(old.kind===kind&&same(old.input,input),'RESEARCH_COMMERCE_ACTION_ID_REUSED');return old;}
 const saved={schema:'sf88-research-commerce-action/v1',kind,input:copy(input),createdAt:stamp()};
 await retainCustomerJson(root,name,saved);return saved;
}
async function nativeDraftId(agent,workspace,manifestId){
 let offset=0,snapshot=null;const matches=[];
 for(;;){
  const page=(await agent.call('list',{workspace,collection:'drafts',offset,limit:200,
   ...(snapshot?{expectedStateSha256:snapshot}:{})})).native;
  snapshot=page.stateSha256;
  for(const row of page.items)if(row.planId===manifestId)matches.push(row.id);
  if(page.nextOffset===null)break;offset=page.nextOffset;
 }
 need(matches.length===1,'RESEARCH_COMMERCE_NATIVE_DRAFT_RECONCILIATION_REQUIRED');return matches[0];
}
/** The native agent owns dispatch/replay/reconciliation and the payment attempt. */
async function nativeAction(agent,action,args){
 try{return await agent.call(action,args);}
 catch(error){
  let record;try{record=(await agent.call('operation',{workspace:args.workspace,requestId:args.requestId})).native;}
  catch{throw error;}
  if(record?.found&&['COMPLETE','RECONCILED'].includes(record.phase))
   return agent.call('resume',{workspace:args.workspace,requestId:args.requestId});
  if(!record?.found||!['ATTENTION','DISPATCHING'].includes(record.phase)||BUYER_AGENT_ACTIONS[action]?.replay)throw error;
  let id;
  if(action==='save_draft')id=args.id??await nativeDraftId(agent,args.workspace,args.manifest.id);
  try{
   await agent.call('reconcile',{workspace:args.workspace,requestId:args.requestId,...(id?{id}:{})});
   return await agent.call('resume',{workspace:args.workspace,requestId:args.requestId});
  }catch(problem){
   error.researchCommerce={originalRequestId:args.requestId,nativeAction:action,
    reconciliationCode:problem.code??'BUYER_AGENT_NATIVE_RECONCILIATION_REQUIRED'};
   throw error;
  }
 }
}
async function verifyRun(agent,workspace,prepared){
 const reply=await agent.call('run',{workspace,id:prepared.runId}),run=reply.native;
 need(run.id===prepared.runId&&run.state?.plan?.id===prepared.planId&&Array.isArray(run.state.operations),
  'RESEARCH_COMMERCE_NATIVE_ACQUISITION_CHANGED');
 const rows=run.state.operations.filter(row=>row.id===prepared.operationId);
 need(rows.length===1,'RESEARCH_COMMERCE_NATIVE_OPERATION_CHANGED');
 const row=rows[0],paid=row.paidFile;
 need(row.intentId===prepared.intentId&&row.config?.sha256===prepared.configSha256&&
  row.sourceConfig?.sha256===prepared.sourceConfigSha256&&paid&&
  paid.handoffSha256===prepared.handoffSha256&&paid.orderReference===prepared.orderReference&&
  paid.file?.sha256===prepared.archive.sha256&&paid.file.bytes===prepared.archive.bytes,
  'RESEARCH_COMMERCE_NATIVE_ORDER_CHANGED');
 return {reply,run,row};
}
export class ResearchCommerceBuyer{
 #configuration;#client;#workspaceId;#agents=new Set();#clients=new Set();#pending=new Set();#closing=false;#close;
 constructor({configuration,client,workspaceId}={}){
  need(typeof configuration==='function'&&typeof client==='function'&&/^research_[a-f0-9]{64}$/.test(workspaceId??''),
   'RESEARCH_COMMERCE_ORIGINAL_WORKSPACE_REQUIRED');
  this.#configuration=configuration;this.#client=client;this.#workspaceId=workspaceId;
 }
 #run(work){
  need(!this.#closing,'RESEARCH_COMMERCE_CLOSING');
  const pending=Promise.resolve().then(work);this.#pending.add(pending);
  pending.finally(()=>this.#pending.delete(pending)).catch(()=>{});return pending;
 }
 async #agent(root,work){
  const agent=await BuyerRunbookAgent.fromFile(join(root,'buyer-agent.json'));this.#agents.add(agent);
  let failure;
  try{return await work(agent);}
  catch(error){failure=error;throw error;}
  finally{
   try{await agent.close();this.#agents.delete(agent);}
   catch(error){
    if(failure){failure.researchCommerceClose=error.code??'BUYER_AGENT_CLOSE_INCOMPLETE';}
    else throw Object.assign(error,{outcomeUnknown:true,retainedDirectory:root});
   }
  }
 }
 receive({directory,input}={}){
  const selected=sourceInput(input);
  return this.#run(()=>withCustomerOperation(directory,async root=>{
   const retained=await retainRequest(root,'purchases',selected.request,{workspaceId:this.#workspaceId});
   need(retained.workspaceId===this.#workspaceId,'RESEARCH_COMMERCE_RECEIVING_WORKSPACE_CHANGED');
   await retainCustomerBytes(root,'publication.json',selected.body);
   const handoff=await retainCustomerJson(root,'merchant.handoff.json',selected.publication.handoff);
   let saved=await optionalJson(root,'buyer.json');
   if(!saved){
    const buyer=await selectedBuyer(await this.#configuration(),selected.request.buyer);
    need(buyer.definition.maximumFileBytes>=selected.publication.archive.bytes&&
     buyer.definition.maximumExportBytes>=selected.publication.archive.bytes,
     'RESEARCH_COMMERCE_BUYER_FILE_CAPACITY');
    await customerDirectory(join(root,'agent'));
    const {files:discarded,storageDirectory:originalStorage,...definition}=buyer.definition;
    const config={schema:'stellar-forge.buyer-runbook.agent-connections.v1',workspaces:{
     selected:{...definition,storageDirectory:join(root,'agent'),files:{
      research_order:{path:handoff.path,kind:'paid-handoff',sha256:handoff.sha256,label:selected.publication.title}}}}};
    await retainCustomerJson(root,'buyer-agent.json',config);
    // The original reader checks canonical paths, native/storage separation and limits.
    await readBuyerAgentConfiguration(join(root,'buyer-agent.json'));
    saved={binding:buyer.binding,bindingSha256:buyer.bindingSha256,view:buyer.view,createdAt:stamp()};
    await retainCustomerJson(root,'buyer.json',saved);
   }
   const record=await purchaseRecord(root);
   if(record.result)return {schema:COMMERCE_SCHEMA,kind:'purchases',id:selected.request.requestId,
    status:'OFFER_RECEIVED',publication:record.publication,buyer:saved.view,result:record.result.result,reused:true};
   return this.#agent(root,async agent=>{
    const reply=await nativeAction(agent,'receive_paid_file',{workspace:'selected',file:'research_order',
     expectedSha256:handoff.sha256,filename:'merchant.handoff.json',
     requestId:phaseId(selected.request.requestId,'receive-native-paid-file')});
    need(reply.native?.handoff?.file?.sha256===record.publication.archive.sha256&&
     reply.native.handoff.file.bytes===record.publication.archive.bytes&&
     reply.native.handoff.orderReference===record.publication.handoff.orderReference,
     'RESEARCH_COMMERCE_RECEIVED_ORDER_CHANGED');
    const result={paidFileId:reply.native.id,original:reply,completedAt:stamp()};
    await retainCustomerJson(root,'result.json',{schema:'sf88-research-commerce-result/v1',
     requestSha256:record.request.requestSha256,result});
    return {schema:COMMERCE_SCHEMA,kind:'purchases',id:selected.request.requestId,status:'OFFER_RECEIVED',
     publication:record.publication,buyer:saved.view,result,reused:false};
   });
  }));
 }
 prepare({directory,input}={}){
  fields(input,['id','requestId','expectedRevision','totalAtomic','dailyAtomic','claimEnv']);
  identifier(input.id);identifier(input.requestId);atomic(input.totalAtomic);atomic(input.dailyAtomic);environmentName(input.claimEnv);
  need(Number.isSafeInteger(input.expectedRevision)&&input.expectedRevision>=0&&input.expectedRevision<=10000,
   'RESEARCH_COMMERCE_BUYER_REVIEW_REVISION_REQUIRED');const request=copy(input);
  return this.#run(()=>withCustomerOperation(directory,async root=>{
   const record=await purchaseRecord(root);
   need(record.request.request.requestId===request.id&&record.result,'RESEARCH_COMMERCE_RECEIVED_OFFER_REQUIRED');
   const existing=await readPrepared(root);
   if(existing){
    need(same(existing.input,request),'RESEARCH_COMMERCE_PURCHASE_ALREADY_PREPARED');
    return {schema:COMMERCE_SCHEMA,kind:'purchases',id:request.id,status:'BUYER_PREPARED',prepared:existing,reused:true};
   }
   await saveAction(root,'prepare',request);
   return this.#agent(root,async agent=>{
    const id=record.result.result.paidFileId;
    let paid=(await agent.call('paid_file',{workspace:'selected',id})).native;
    need(same(paid.handoff,record.publication.handoff),'RESEARCH_COMMERCE_RECEIVED_ORDER_CHANGED');
    let reviewed;
    if(paid.prepared||paid.preparing){
     need(paid.review&&['totalAtomic','dailyAtomic','claimEnv'].every(key=>paid.review[key]===request[key])&&
      paid.review.filename==='research-customer.handover.gz','RESEARCH_COMMERCE_ORIGINAL_BUYER_REVIEW_CHANGED');
     reviewed={native:paid};
    }else reviewed=await nativeAction(agent,'review_paid_file',{workspace:'selected',id,
     expectedRevision:request.expectedRevision,totalAtomic:request.totalAtomic,dailyAtomic:request.dailyAtomic,
     filename:'research-customer.handover.gz',claimEnv:request.claimEnv,requestId:phaseId(request.requestId,'review')});
    const nativeReview=reviewed.native.review;
    need(nativeReview&&same(reviewed.native.handoff,record.publication.handoff),'RESEARCH_COMMERCE_NATIVE_REVIEW_CHANGED');
    const provisioned=await nativeAction(agent,'prepare_paid_file',{workspace:'selected',id,
     reviewSha256:nativeReview.reviewSha256,requestId:phaseId(request.requestId,'prepare')});
    const ready=provisioned.native;
    need(ready.intentId===paid.summary.intentId&&ready.reviewSha256===nativeReview.reviewSha256&&
     ready.paidFile?.handoffSha256===record.handoff.sha256,'RESEARCH_COMMERCE_NATIVE_PREPARATION_CHANGED');
    const planId='research_'+request.id.replaceAll('-',''),operationId='research-delivery';
    const manifest={schema:'stellar-forge.buyer-runbook.v1',id:planId,title:record.publication.title,
     operations:[{id:operationId,label:record.publication.title,config:ready.configName}]};
    const draft=await nativeAction(agent,'save_draft',{workspace:'selected',expectedRevision:0,manifest,
     requestId:phaseId(request.requestId,'save-acquisition')});
    const current=draft.native;
    need(current?.plan?.id===planId&&current.manifest?.operations?.length===1&&
     current.manifest.operations[0].config===ready.configPath,'RESEARCH_COMMERCE_NATIVE_DRAFT_CHANGED');
    const initialized=await nativeAction(agent,'initialize',{workspace:'selected',id:current.id,
     expectedRevision:current.revision,reviewSha256:current.reviewSha256,requestId:phaseId(request.requestId,'initialize')});
    const nativeRows=initialized.native.state?.operations?.filter(row=>row.id===operationId);
    need(nativeRows?.length===1&&nativeRows[0].sourceConfig?.sha256===ready.configSha256&&
     nativeRows[0].paidFile?.handoffSha256===ready.paidFile.handoffSha256,
     'RESEARCH_COMMERCE_NATIVE_ACQUISITION_CHANGED');
    const proof={schema:purchaseSchema,input:request,publicationSha256:record.request.request.publicationSha256,
     buyerBindingSha256:record.buyer.bindingSha256,paidFileId:id,runId:current.id,planId,operationId,
     intentId:ready.intentId,sourceConfigSha256:ready.configSha256,configSha256:nativeRows[0].config.sha256,
     handoffSha256:ready.paidFile.handoffSha256,
     orderReference:record.publication.handoff.orderReference,archive:copy(record.publication.archive),
     nativeReview:copy(nativeReview),nativePreparation:copy(ready),nativeDraft:copy(current),
     nativeInitialized:copy(initialized),createdAt:stamp()};
    const prepared={...proof,preparedSha256:fingerprint(proof)};
    await verifyRun(agent,'selected',prepared);
    await retainCustomerJson(root,'prepared.json',prepared);
    return {schema:COMMERCE_SCHEMA,kind:'purchases',id:request.id,status:'BUYER_PREPARED',prepared,reused:false};
   });
  }));
 }
 action({directory,kind,input}={}){
  need(['execute','retrieve','recover','finalize','cancel'].includes(kind),'RESEARCH_COMMERCE_BUYER_ACTION_INVALID');
  let request;
  if(kind==='cancel'){
   fields(input,['id','requestId','preparedSha256','executionId']);
   request=preparedInput({id:input.id,requestId:input.requestId,preparedSha256:input.preparedSha256});
   request.executionId=identifier(input.executionId);
  }else request=preparedInput(input);
  return this.#run(async()=>{
   // Retain the exact action under its writer, then let native cancellation reach
   // the same running buyer operation while execute awaits the original result.
   const held=await withCustomerOperation(directory,async root=>{
    const {prepared}=await selectedPrepared(root,request);await saveAction(root,kind,request);
    return {root,prepared};
   });
   const {root,prepared}=held;
   return this.#agent(root,async agent=>{
    await verifyRun(agent,'selected',prepared);
    const native=kind==='retrieve'?'retrieve_file':kind;
    const args={workspace:'selected',id:prepared.runId,requestId:request.requestId,
     ...(['execute','retrieve','finalize'].includes(kind)?{only:prepared.operationId}:{}),
     ...(kind==='retrieve'?{configSha256:prepared.configSha256,handoffSha256:prepared.handoffSha256}:{}),
     ...(kind==='cancel'?{executionId:request.executionId}:{})};
    const reply=await nativeAction(agent,native,args),current=await verifyRun(agent,'selected',prepared);
    return {schema:COMMERCE_SCHEMA,kind:'purchases',id:request.id,action:kind,requestId:request.requestId,
     original:reply,run:current.run,operation:current.row};
   });
  });
 }
 inspect({directory,id,refresh=false}={}){
  identifier(id);need(typeof refresh==='boolean','RESEARCH_COMMERCE_REFRESH_INVALID');
  return this.#run(()=>withCustomerOperation(directory,async root=>{
   const record=await purchaseRecord(root);need(record.request.request.requestId===id,'RESEARCH_COMMERCE_REQUEST_CHANGED');
   const prepared=await readPrepared(root),received=await optionalJson(root,'received.json');
   const view={schema:COMMERCE_SCHEMA,kind:'purchases',id,publication:record.publication,buyer:record.buyer.view,
    status:received?'DOSSIER_RECEIVED':prepared?'BUYER_PREPARED':record.result?'OFFER_RECEIVED':'RECEIVING',
    result:record.result?.result??null,prepared,received};
   if(!refresh)return view;
   return this.#agent(root,async agent=>{
    const opened=await agent.call('open',{workspace:'selected'}),buyerOperator=await agent.call('operator',{workspace:'selected'});
    let paidFile=null,run=null,operation=null;
    if(record.result)paidFile=(await agent.call('paid_file',{workspace:'selected',id:record.result.result.paidFileId})).native;
    if(prepared){const current=await verifyRun(agent,'selected',prepared);run=current.run;operation=current.row;}
    const approval=(await agent.call('approval',{workspace:'selected'})).native;
    return {...view,buyerConnection:opened.connection??opened.native,operator:buyerOperator.native,paidFile,run,operation,approval};
   });
  }));
 }
 reconcile({directory,input}={}){
  fields(input,['id','requestId','nativeRequestId','nativeId'],['id','requestId','nativeRequestId']);
  identifier(input.id);identifier(input.requestId);identifier(input.nativeRequestId);
  const request=copy(input);
  return this.#run(()=>withCustomerOperation(directory,async root=>{
   const record=await purchaseRecord(root);need(record.request.request.requestId===request.id,'RESEARCH_COMMERCE_REQUEST_CHANGED');
   await saveAction(root,'reconcile',request);
   return this.#agent(root,async agent=>{
    const saved=(await agent.call('operation',{workspace:'selected',requestId:request.nativeRequestId})).native;
    need(saved.found,'RESEARCH_COMMERCE_NATIVE_REQUEST_NOT_FOUND');
    let id=request.nativeId;
    if(saved.action==='save_draft'&&!id)id=saved.args.id??await nativeDraftId(agent,'selected',saved.args.manifest.id);
    const result=await agent.call('reconcile',{workspace:'selected',requestId:request.nativeRequestId,...(id?{id}:{})});
    return {schema:COMMERCE_SCHEMA,kind:'purchases',id:request.id,action:'reconcile',original:result};
   });
  }));
 }
 receiveDossier({directory,input}={}){
  fields(input,['id','requestId','preparedSha256','sourceActor'],['id','requestId','preparedSha256']);
  const request=preparedInput({id:input.id,requestId:input.requestId,preparedSha256:input.preparedSha256});
  if(input.sourceActor!==undefined)request.sourceActor=text(input.sourceActor,200);
  return this.#run(()=>withCustomerOperation(directory,async root=>{
   const {record,prepared}=await selectedPrepared(root,request);await saveAction(root,'receive-dossier',request);
   const original=await optionalJson(root,'received.json');
   if(original){
    need(original.workspaceId===this.#workspaceId&&original.publicationSha256===record.request.request.publicationSha256,
     'RESEARCH_COMMERCE_RECEIVED_RESULT_CHANGED');
    const local=await receiveResearchPaidArchive({directory:join(root,'archive-receiving'),
     expectedSha256:record.publication.archive.sha256,expectedBytes:record.publication.archive.bytes,
     manifestSha256:record.publication.delivery.manifestSha256});
    checkPublicationArchive(record.publication,{...local.handover,archive:local.archive});
    return {schema:COMMERCE_SCHEMA,kind:'purchases',id:request.id,status:'DOSSIER_RECEIVED',received:original,reused:true};
   }
   const exportId='research_'+request.id.replaceAll('-','');
   let capture=await optionalJson(root,'buyer-export.json');
   const receivedDirectory=await customerDirectory(join(root,'buyer-files'));
   if(!capture){
    capture=await this.#agent(root,async agent=>{
     await verifyRun(agent,'selected',prepared);
     const value=(await agent.call('capture',{workspace:'selected',exportId,
      files:[{kind:'paid-resource',id:prepared.runId,operation:prepared.operationId,
       expectedSha256:record.publication.archive.sha256}]})).native;
     need(value.manifest?.files?.length===1&&value.manifest.files[0].bytes===record.publication.archive.bytes&&
      value.manifest.files[0].sha256===record.publication.archive.sha256,
      'RESEARCH_COMMERCE_PURCHASED_ARCHIVE_CHANGED');return value;
    });
    await retainCustomerJson(root,'buyer-export.json',capture);
   }
   need(capture.exportId===exportId&&capture.manifest.directory===record.buyer.binding.directory&&
    capture.manifest.selectionSha256===record.buyer.binding.expectedSelectionSha256,
    'RESEARCH_COMMERCE_BUYER_EXPORT_CHANGED');
   let download=await optionalJson(root,'buyer-download.json');
   if(!download){
    download=await this.#agent(root,agent=>agent.download({workspace:'selected',exportId,directory:receivedDirectory,
     expectedManifestSha256:capture.manifestSha256}));
    await retainCustomerJson(root,'buyer-download.json',download);
   }
   const member=capture.manifest.files[0],path=join(receivedDirectory,member.name);
   await describeCustomerFile(path,{sha256:record.publication.archive.sha256,bytes:record.publication.archive.bytes,
    maximum:PAID_ARCHIVE_LIMIT});
   const unpacked=await receiveResearchPaidArchive({directory:join(root,'archive-receiving'),path,
    expectedSha256:record.publication.archive.sha256,expectedBytes:record.publication.archive.bytes,
    manifestSha256:record.publication.delivery.manifestSha256});
   checkPublicationArchive(record.publication,{...unpacked.handover,archive:unpacked.archive});
   const client=await this.#client();this.#clients.add(client);
   let received,receiveError;
   try{
    const status=await client.status();need(status.workspaceId===this.#workspaceId,'RESEARCH_COMMERCE_RECEIVING_WORKSPACE_CHANGED');
    received=await receiveCustomerHandover({client,directory:join(root,'native-receiving'),sourceDirectory:unpacked.handover.directory,
     manifestSha256:record.publication.delivery.manifestSha256,sourceActor:request.sourceActor});
   }catch(error){receiveError=error;throw error;}
   finally{
    try{await client.close();this.#clients.delete(client);}
    catch(error){
     if(receiveError)receiveError.researchCommerceClose=error.code??'RESEARCH_COMMERCE_RESEARCH_CLOSE_INCOMPLETE';
     else throw Object.assign(error,{outcomeUnknown:true,retainedDirectory:root});
    }
   }
   need(received.workspaceId===this.#workspaceId&&received.dossierId===record.publication.delivery.dossierId&&
    received.deliveryId===record.publication.delivery.deliveryId&&received.revision===record.publication.delivery.revision,
    'RESEARCH_COMMERCE_NATIVE_RECEIVING_CHANGED');
   const result={schema:'sf88-research-paid-customer-received/v1',workspaceId:this.#workspaceId,
    publicationSha256:record.request.request.publicationSha256,publicationId:record.publication.publicationId,
    orderReference:prepared.orderReference,archive:record.publication.archive,
    buyer:{directory:record.buyer.binding.directory,selectionSha256:record.buyer.binding.expectedSelectionSha256,
     paidFileId:prepared.paidFileId,runId:prepared.runId,operationId:prepared.operationId,intentId:prepared.intentId,
     exportId,manifestSha256:capture.manifestSha256},
    nativeReceiving:received,completedAt:stamp()};
   await retainCustomerJson(root,'received.json',result);
   return {schema:COMMERCE_SCHEMA,kind:'purchases',id:request.id,status:'DOSSIER_RECEIVED',received:result,reused:false};
  }));
 }
 file({directory,id,kind}={}){
  identifier(id);need(['publication','handoff','received','archive'].includes(kind),'RESEARCH_COMMERCE_FILE_SELECTION_REQUIRED');
  return this.#run(()=>withCustomerOperation(directory,async root=>{
   const record=await purchaseRecord(root);need(record.request.request.requestId===id,'RESEARCH_COMMERCE_REQUEST_CHANGED');
   if(kind==='archive'){
    const capture=await optionalJson(root,'buyer-export.json');
    need(capture?.manifest?.files?.length===1,'RESEARCH_COMMERCE_ARCHIVE_NOT_RECEIVED');
    const file=await describeCustomerFile(join(root,'buyer-files',capture.manifest.files[0].name),{
     sha256:record.publication.archive.sha256,bytes:record.publication.archive.bytes,maximum:PAID_ARCHIVE_LIMIT});
    return {...file,contentType:'application/gzip'};
   }
   const name=kind==='publication'?'publication.json':kind==='handoff'?'merchant.handoff.json':'received.json';
   return {...await describeCustomerFile(join(root,name),{maximum:PUBLICATION_LIMIT}),contentType:'application/json; charset=utf-8'};
  }));
 }
 close(){
  if(this.#close)return this.#close;this.#closing=true;
  return this.#close=(async()=>{
   await Promise.allSettled([...this.#pending]);
   const failed=[];
   for(const client of [...this.#clients])try{await client.close();this.#clients.delete(client);}catch(error){failed.push(error);}
   for(const agent of [...this.#agents])try{await agent.close();this.#agents.delete(agent);}catch(error){failed.push(error);}
   need(failed.length===0,'RESEARCH_COMMERCE_BUYER_CLOSE_INCOMPLETE');
  })().catch(error=>{this.#close=null;throw error;});
 }
}
