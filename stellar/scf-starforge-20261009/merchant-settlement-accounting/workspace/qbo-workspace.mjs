// MIT. QuickBooks handoff, review and return inside the original accounting lease.
import {constants} from 'node:fs';
import {lstat,mkdir,open,link,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {inspectHandoff,renderCsv} from '../accountant/engine.mjs';
import {QBO_DOCS,QBO_CURRENCIES,qboHash,qboCanonical,qboJson,qboCheck as check,qboId as id,qboText as text,
  createQboPlan,validateQboPlan,checkQboSource,inspectQboResponse,validateQboResult,qboReturnCsv,renderQboReview} from '../accountant/qbo.mjs';
import {normalizeQboCompany} from '../accountant/qbo-company.mjs';
import {QboHttpClient,qboRetryAt} from '../accountant/qbo-http.mjs';

export const QBO_REQUEST_BYTES=32*1024*1024;
const copy=value=>structuredClone(value),now=()=>new Date().toISOString();
const records=workspace=>workspace.state.qboPlans??[];
const digest=value=>qboHash(qboCanonical(value));
const fileType=name=>({json:'application/json; charset=utf-8',csv:'text/csv; charset=utf-8',html:'text/html; charset=utf-8'})[name.split('.').at(-1)]??'application/octet-stream';
function requestFields(value){
  return {id:id(value.id),name:text(value.name,'journal name'),actor:text(value.actor,'operator',1000),createdAt:value.createdAt,
    handoffId:id(value.handoffId),expectedParentId:value.expectedParentId??null,realmId:value.realmId,companyName:value.companyName,
    baseCurrency:value.baseCurrency,environment:value.environment??'sandbox',txnDate:value.txnDate,docNumber:value.docNumber??null,
    rows:value.rows,companySnapshot:value.companySnapshot??null};
}
async function privateDir(path){
  try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  const stat=await lstat(path);check(stat.isDirectory()&&!stat.isSymbolicLink()&&!(stat.mode&0o077),'QBO_PRIVATE_DIRECTORY','Use the original private accounting workspace.');
}
async function syncDir(path){const file=await open(path,'r');try{await file.sync();}finally{await file.close();}}
async function readExact(directory,file){
  check(file&&typeof file.name==='string'&&/^[a-z0-9-]+\.(json|csv|html)$/.test(file.name),'QBO_FILE_REQUIRED','Choose a retained journal file.',404);
  const handle=await open(join(directory,file.name),constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const stat=await handle.stat();check(stat.isFile()&&stat.size===file.bytes&&stat.size<=256*1024*1024,'QBO_FILE_CHANGED','A retained journal file changed.',409);
    const bytes=await handle.readFile();check(qboHash(bytes)===file.sha256,'QBO_FILE_CHANGED','A retained journal file changed.',409);return bytes;
  }finally{await handle.close();}
}
// A crash before workspace.json commits leaves an exact packet reusable by the
// same request ID. Never delete a completed packet after an uncertain fsync.
async function packet(directory,contents){
  await privateDir(directory);const files=[];
  for(const [name,value] of Object.entries(contents)){
    const bytes=Buffer.isBuffer(value)?value:Buffer.from(value),entry={name,bytes:bytes.length,sha256:qboHash(bytes)};
    const pending=join(directory,'.'+name+'.'+randomUUID()+'.pending');
    const handle=await open(pending,'wx',0o600);
    try{
      try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
      try{await link(pending,join(directory,name));}
      catch(error){if(error.code!=='EEXIST')throw error;await readExact(directory,entry);}
      files.push(entry);
    }finally{await rm(pending,{force:true});}
  }
  await syncDir(directory);return files;
}
function responseRequest(value){
  check(typeof value.responseJson==='string'&&Buffer.byteLength(value.responseJson,'utf8')<=8*1024*1024,'QBO_RESPONSE_REQUIRED','Choose the original QuickBooks JSON response, up to 8 MiB.');
  return {id:id(value.id),createdAt:value.createdAt,name:text(value.name,'response name'),actor:text(value.actor,'operator',1000),
    realmId:value.realmId,expectedParentId:value.expectedParentId??null,responseSha256:qboHash(Buffer.from(value.responseJson,'utf8')),previewSha256:value.previewSha256??null};
}
function sealResult(result,accountantReturn){
  const {integrity,...body}=result;
  const value={...body,accountantReturn:accountantReturn?{id:accountantReturn.id,integrity:copy(accountantReturn.integrity),summary:copy(accountantReturn.summary)}:null};
  return {...value,integrity:{sha256:digest(value)}};
}

export class QboWorkspace{
  constructor(workspace,accountant,{client=new QboHttpClient()}={}){this.workspace=workspace;this.accountant=accountant;this.client=client;this.nativeFlights=new Map();this.nativeStop=new AbortController();}
  row(planId){id(planId);const record=records(this.workspace).find(item=>item.id===planId);check(record,'QBO_PLAN_NOT_FOUND','Choose a retained QuickBooks journal.',404);return record;}
  directory(planId){return join(this.workspace.directory,'qbo',id(planId));}
  responseRow(planId,responseId){const row=this.row(planId).responses.find(item=>item.id===id(responseId));check(row,'QBO_RESPONSE_NOT_FOUND','Choose a retained QuickBooks response.',404);return row;}
  async plan(planId){
    const record=this.row(planId),plan=JSON.parse((await readExact(this.directory(planId),record.files.find(file=>file.name==='plan.json'))).toString('utf8'));
    validateQboPlan(plan);check(plan.id===record.id&&plan.integrity.sha256===record.integrity.sha256,'QBO_PLAN_CHANGED','The journal identity changed.',409);return plan;
  }
  view(){return {revision:this.workspace.state.revision,handoffs:copy(this.workspace.state.accountantHandoffs??[]),plans:copy(records(this.workspace)),currencies:QBO_CURRENCIES,docs:QBO_DOCS,connection:this.connection()};}
  async current(handoffId){
    const record=this.accountant.row(handoffId),handoff=await this.accountant.readHandoff(handoffId),parent=await this.accountant.readRevision(record,handoff);
    return {record,handoff,parent};
  }
  async handoff(handoffId){
    const {record,handoff,parent}=await this.current(handoffId);
    return {revision:this.workspace.state.revision,record:copy(record),source:copy(handoff.source),expectedParentId:parent?.id??null,
      rows:inspectHandoff(handoff,parent).rows.map(row=>({rowId:row.rowId,eventId:row.eventId,at:row.original.at,optionId:row.original.optionId,
        network:row.original.network,transfer:row.original.transfer,delivery:row.original.delivery,amountAtomic:row.original.amountAtomic,
        label:copy(row.label),adjustments:copy(row.adjustments??null),externalStatus:row.externalStatus,externalBookRef:row.externalBookRef}))};
  }
  async detail(planId){
    const record=this.row(planId),plan=await this.plan(planId),{parent}=await this.current(plan.handoffId);
    return {revision:this.workspace.state.revision,record:copy(record),plan,responses:copy(record.responses),expectedParentId:parent?.id??null};
  }
  async preparePlan(value){
    const request=requestFields(value),{handoff,parent}=await this.current(request.handoffId);
    check(request.expectedParentId===(parent?.id??null),'QBO_STALE_ACCOUNTANT','Reload the selected handoff after its accountant return changed.',409);
    const plan=createQboPlan({...request,docNumber:request.docNumber??undefined,handoff,revision:parent});
    return {request,plan,previewSha256:plan.integrity.sha256,revision:this.workspace.state.revision};
  }
  async preview(value){const {plan,previewSha256,revision}=await this.preparePlan(value);return {plan,previewSha256,revision};}
  async create(value){
    return this.workspace.serial(async()=>{
      const request=requestFields(value),requestSha256=digest(request),prior=records(this.workspace).find(item=>item.id===request.id);
      if(prior){check(prior.requestSha256===requestSha256,'QBO_REQUEST_CHANGED','This journal request ID belongs to different source or mappings.',409);return {record:copy(prior),duplicate:true,revision:this.workspace.state.revision};}
      this.workspace.expected(value.revision);check(records(this.workspace).length<2000,'QBO_PLAN_LIMIT','This workspace retains 2,000 journal plans.');
      const {plan}=await this.preparePlan(value);
      check(value.previewSha256===plan.integrity.sha256,'QBO_PREVIEW_CHANGED','Preview the current journal mappings before retaining this plan.',409);
      const {handoff,parent}=await this.current(plan.handoffId),root=join(this.workspace.directory,'qbo');
      await privateDir(root);
      const files=await packet(this.directory(plan.id),{'plan.json':qboJson(plan),'journal-entry.json':qboJson(plan.journalEntry),
        'handoff.json':qboJson(handoff),'accountant.csv':renderCsv(handoff,parent),'review.html':renderQboReview(plan),
        ...(parent?{'accountant-return.json':qboJson(parent)}:{})});
      await privateDir(join(this.directory(plan.id),'responses'));
      const record={id:plan.id,name:plan.name,actor:plan.actor,createdAt:plan.createdAt,handoffId:plan.handoffId,realmId:plan.realmId,
        companyName:plan.companyName,baseCurrency:plan.baseCurrency,environment:plan.environment,txnDate:plan.txnDate,docNumber:plan.docNumber,
        status:'DRAFT',integrity:plan.integrity,summary:plan.summary,eventIds:plan.rows.map(row=>row.eventId),
        requestSha256,files,review:null,cancellation:null,responses:[]};
      this.workspace.state.qboPlans??=[];this.workspace.state.qboPlans.unshift(record);await syncDir(root);
      await this.workspace.commit('qbo_journal_prepared',request.actor,{planId:plan.id,handoffId:plan.handoffId,realmId:plan.realmId,planSha256:plan.integrity.sha256});
      return {record:copy(record),duplicate:false,revision:this.workspace.state.revision};
    });
  }
  async review(planId,value){
    return this.workspace.serial(async()=>{
      const record=this.row(planId),request={id:id(value.id),actor:text(value.actor,'reviewer',1000),note:text(value.note??'','review note',4000,{empty:true}),planSha256:value.planSha256};
      const requestSha256=digest(request);
      if(record.review?.id===request.id){check(record.review.requestSha256===requestSha256,'QBO_REVIEW_CHANGED','This review request changed.',409);return {record:copy(record),duplicate:true,revision:this.workspace.state.revision};}
      this.workspace.expected(value.revision);check(record.status==='DRAFT','QBO_REVIEW_STATE','Review a prepared journal once.',409);
      const plan=await this.plan(planId),{handoff,parent}=await this.current(plan.handoffId);
      check(request.planSha256===plan.integrity.sha256,'QBO_PREVIEW_CHANGED','Review the exact retained journal.',409);checkQboSource(plan,handoff,parent);
      const selected=new Set(record.eventIds);
      const overlap=records(this.workspace).find(other=>other.id!==planId&&other.realmId===record.realmId&&other.environment===record.environment&&
        ['REVIEWED','BOOKED'].includes(other.status)&&other.eventIds.some(eventId=>selected.has(eventId)));
      check(!overlap,'QBO_EVENT_RESERVED','A reviewed or booked journal already contains a selected event for this company. Open that journal or cancel it if unused.',409);
      record.review={...request,createdAt:now(),requestSha256};record.status='REVIEWED';
      await this.workspace.commit('qbo_journal_reviewed',request.actor,{planId,reviewId:request.id,planSha256:request.planSha256});
      return {record:copy(record),duplicate:false,revision:this.workspace.state.revision};
    });
  }
  async cancel(planId,value){
    return this.workspace.serial(async()=>{
      const record=this.row(planId),request={id:id(value.id),actor:text(value.actor,'operator',1000),note:text(value.note,'cancellation note',4000),
        planSha256:value.planSha256,unusedConfirmed:value.unusedConfirmed===true},requestSha256=digest(request);
      if(record.cancellation?.id===request.id){check(record.cancellation.requestSha256===requestSha256,'QBO_CANCEL_CHANGED','This cancellation request changed.',409);return {record:copy(record),duplicate:true,revision:this.workspace.state.revision};}
      this.workspace.expected(value.revision);
      check(request.unusedConfirmed,'QBO_UNUSED_CONFIRMATION','Confirm this journal is unused before releasing its selected events.');
      check(!record.nativePost||!this.nativeFlights.has(planId)&&!record.nativePost.observedJournalId&&!record.nativePost.sourceAttemptId&&
        (!record.nativePost.dispatched||record.nativePost.status==='FAULT'&&record.nativePost.writeAttempts===1),
        'QBO_NATIVE_POST_RETAINED','Reconcile the retained native posting before releasing these source events.',409);
      check(['DRAFT','REVIEWED'].includes(record.status)&&!record.responses.some(row=>row.status==='PENDING'||row.status==='SAVED'),
        'QBO_CANCEL_STATE','A retained matched response or booked journal must be handled in the original accounting records.',409);
      check(request.planSha256===record.integrity.sha256,'QBO_PLAN_CHANGED','Choose the exact journal to cancel.',409);
      record.cancellation={...request,createdAt:now(),requestSha256};record.status='CANCELLED';
      await this.workspace.commit('qbo_journal_cancelled',request.actor,{planId,cancellationId:request.id});
      return {record:copy(record),duplicate:false,revision:this.workspace.state.revision};
    });
  }
  async prepareResponse(planId,value){
    const record=this.row(planId);check(record.status==='REVIEWED','QBO_REVIEW_REQUIRED','Review this retained journal before importing its result.',409);
    const plan=await this.plan(planId),request=responseRequest(value),{handoff,parent}=await this.current(plan.handoffId);
    check(!this.nativeFlights.has(planId)||record.nativePost?.id===request.id,'QBO_NATIVE_POST_ACTIVE','Continue the retained native posting before importing another response.',409);
    check(!record.responses.some(response=>['PENDING','SAVED'].includes(response.status)),'QBO_RESPONSE_ALREADY_RETAINED','Finish the original retained journal response before importing another result.',409);
    check(request.expectedParentId===(parent?.id??null),'QBO_STALE_ACCOUNTANT','Reload the current accountant return before previewing this response.',409);
    const raw=Buffer.from(value.responseJson,'utf8'),inspected=inspectQboResponse({...request,plan,responseBytes:raw});
    let accountantValue=null,accountantPreview=null,csvBytes=null;
    if(inspected.kind==='MATCHED'){
      const duplicate=records(this.workspace).some(other=>other.realmId===record.realmId&&other.environment===record.environment&&
        other.responses.some(response=>response.journalEntryId===inspected.journalEntryId&&['PENDING','SAVED'].includes(response.status)));
      check(!duplicate,'QBO_JOURNAL_ALREADY_IMPORTED','This QuickBooks journal is already retained; reopen its original response.',409);
      csvBytes=qboReturnCsv(plan,inspected,handoff,parent);
      accountantValue={id:request.id,actor:request.actor,name:request.name,createdAt:request.createdAt,expectedParentId:parent?.id??null,csvBase64:csvBytes.toString('base64')};
      accountantPreview=await this.accountant.preview(plan.handoffId,accountantValue);
      check(accountantPreview.revision.summary.conflictRows===0&&accountantPreview.revision.summary.unknownRows===0,'QBO_RETURN_CONFLICT','Review the original accountant return conflicts before saving.',409);
      accountantValue.previewSha256=accountantPreview.revision.integrity.sha256;
    }
    const result=sealResult(inspected,accountantPreview?.revision);
    return {request,result,raw,csvBytes,accountantValue,previewSha256:result.integrity.sha256,revision:this.workspace.state.revision};
  }
  async previewResponse(planId,value){const prepared=await this.prepareResponse(planId,value);return {result:prepared.result,previewSha256:prepared.previewSha256,revision:prepared.revision};}
  async saveResponse(planId,value){
    const request=responseRequest(value),requestSha256=digest(request);
    const prior=this.row(planId).responses.find(item=>item.id===request.id);
    if(prior){
      check(prior.requestSha256===requestSha256,'QBO_RESPONSE_REQUEST_CHANGED','This response ID belongs to another exact file or preview.',409);
      if(prior.status==='PENDING')await this.finishResponse(planId,request.id);
      return {record:copy(this.row(planId)),response:copy(this.responseRow(planId,request.id)),duplicate:true,revision:this.workspace.state.revision};
    }
    await this.workspace.serial(async()=>{
      this.workspace.expected(value.revision);
      const record=this.row(planId);check(!record.responses.some(item=>item.id===request.id),'QBO_RESPONSE_EXISTS','Reopen the response saved by this request.',409);
      check(record.responses.length<2000,'QBO_RESPONSE_LIMIT','This journal retains 2,000 responses.');
      const prepared=await this.prepareResponse(planId,value);
      check(value.previewSha256===prepared.result.integrity.sha256,'QBO_RESPONSE_PREVIEW_CHANGED','Preview this exact response before saving its result.',409);
      const directory=join(this.directory(planId),'responses',request.id),accountantRequest=prepared.accountantValue?{...prepared.accountantValue}:null;
      if(accountantRequest)delete accountantRequest.csvBase64;
      const files=await packet(directory,{'response.json':prepared.raw,'result.json':qboJson(prepared.result),
        ...(prepared.csvBytes?{'returned.csv':prepared.csvBytes,'return-request.json':qboJson(accountantRequest)}:{})});
      record.responses.push({id:request.id,name:request.name,actor:request.actor,createdAt:request.createdAt,
        status:prepared.result.kind==='FAULT'?'FAULT':'PENDING',kind:prepared.result.kind,requestSha256,responseSha256:request.responseSha256,
        resultSha256:prepared.result.integrity.sha256,summary:prepared.result.summary,errors:prepared.result.errors,
        journalEntryId:prepared.result.journalEntryId,syncToken:prepared.result.syncToken,returnId:null,files,lastError:null});
      await syncDir(join(this.directory(planId),'responses'));
      await this.workspace.commit('qbo_response_retained',request.actor,{planId,responseId:request.id,kind:prepared.result.kind,responseSha256:request.responseSha256});
    });
    if(this.responseRow(planId,request.id).status==='PENDING')await this.finishResponse(planId,request.id);
    return {record:copy(this.row(planId)),response:copy(this.responseRow(planId,request.id)),duplicate:false,revision:this.workspace.state.revision};
  }
  async finishResponse(planId,responseId){
    const response=this.responseRow(planId,responseId);if(response.status!=='PENDING')return;
    const directory=join(this.directory(planId),'responses',responseId);
    const csvBytes=await readExact(directory,response.files.find(file=>file.name==='returned.csv'));
    const request=JSON.parse((await readExact(directory,response.files.find(file=>file.name==='return-request.json'))).toString('utf8'));
    const raw=await readExact(directory,response.files.find(file=>file.name==='response.json'));
    const retainedResult=JSON.parse((await readExact(directory,response.files.find(file=>file.name==='result.json'))).toString('utf8'));
    validateQboResult(retainedResult);const plan=await this.plan(planId);
    const inspected=inspectQboResponse({plan,responseBytes:raw,realmId:plan.realmId,id:responseId,name:retainedResult.name,actor:retainedResult.actor,createdAt:retainedResult.createdAt});
    check(retainedResult.integrity.sha256===response.resultSha256&&retainedResult.responseSha256===qboHash(raw)&&inspected.journalEntryId===retainedResult.journalEntryId&&inspected.syncToken===retainedResult.syncToken,'QBO_RESULT_CHANGED','The retained native result changed before accountant recovery.',409);
    check(request.id===responseId,'QBO_RETURN_ID_CHANGED','The retained accountant request changed.',409);
    const result=await this.accountant.apply(this.row(planId).handoffId,{...request,csvBase64:csvBytes.toString('base64'),revision:this.workspace.state.revision});
    await this.workspace.serial(async()=>{
      const record=this.row(planId),retained=this.responseRow(planId,responseId);if(retained.status==='SAVED')return;
      check(result.savedReturn.id===responseId&&result.savedReturn.integrity.sha256===request.previewSha256&&result.savedReturn.importSha256===qboHash(csvBytes),
        'QBO_RETURN_LINK_CHANGED','The saved accountant return differs from the retained QuickBooks response.',409);
      retained.status='SAVED';retained.returnId=result.savedReturn.id;retained.accountantReturn=copy(result.savedReturn);
      retained.lastError=null;record.status='BOOKED';
      await this.workspace.commit('qbo_accountant_return_saved',request.actor,{planId,responseId,returnId:result.savedReturn.id,journalEntryId:retained.journalEntryId,syncToken:retained.syncToken});
    });
  }
  async resume(planId,responseId,value){
    this.workspace.expected(value.revision);text(value.actor,'operator',1000);
    await this.finishResponse(planId,responseId);
    return {record:copy(this.row(planId)),response:copy(this.responseRow(planId,responseId)),revision:this.workspace.state.revision};
  }
  async recover(){
    await this.workspace.serial(async()=>{
      let changed=false;
      for(const record of records(this.workspace))if(record.nativePost&&['PREPARED','RUNNING'].includes(record.nativePost.status)){
        record.nativePost.status=record.nativePost.dispatched||record.nativePost.observedJournalId?'UNCERTAIN':'RETRYABLE';record.nativePost.updatedAt=now();
        record.nativePost.lastError={code:'QBO_NATIVE_PROCESS_INTERRUPTED',message:'The original process ended during this posting. Resume its retained identity.'};changed=true;
      }
      if(changed)await this.workspace.commit('qbo_native_interruption_recovered','workspace',{});
    });
    for(const record of [...records(this.workspace)])for(const response of [...record.responses])if(response.status==='PENDING'){
      try{await this.finishResponse(record.id,response.id);}
      catch(error){
        await this.workspace.serial(async()=>{
          const retained=this.responseRow(record.id,response.id),lastError={code:error.code??'QBO_RETURN_RECOVERY',message:String(error.message??error).slice(0,2000)};
          if(qboCanonical(retained.lastError)===qboCanonical(lastError))return;
          retained.lastError=lastError;await this.workspace.commit('qbo_return_recovery_pending','workspace',{planId:record.id,responseId:response.id,...lastError});
        });
      }
    }
    for(const record of [...records(this.workspace)])if(record.nativePost&&record.nativePost.status!=='BOOKED'&&
      (record.nativePost.sourceAttemptId||record.responses.some(response=>['PENDING','SAVED'].includes(response.status)))){
      try{await this.finishNativeLocal(record.id);}
      catch(error){
        const operation=this.row(record.id).nativePost,lastError={code:error.code??'QBO_NATIVE_LOCAL_RECOVERY',message:String(error.message??error).slice(0,1000)};
        if(qboCanonical(operation.lastError)!==qboCanonical(lastError))await this.updateNative(record.id,
          {status:operation.sourceAttemptId?'RECEIVED':operation.dispatched||operation.observedJournalId?'UNCERTAIN':'RETRYABLE',lastError},'qbo_native_local_recovery_pending');
      }
    }
  }

  connection(){return this.client.info();}
  async fetchCompany(value){return this.client.company(value,{signal:this.nativeStop.signal});}
  nativeDirectory(planId){return join(this.directory(planId),'native-post');}
  nativeState(planId){const record=this.row(planId);return {record:copy(record),nativePost:copy(record.nativePost??null),revision:this.workspace.state.revision};}
  async previewPost(planId,value){
    this.workspace.expected(value.revision);
    const record=this.row(planId);check(record.status==='REVIEWED','QBO_REVIEW_REQUIRED','Review this journal before posting it to the configured company.',409);
    check(!record.nativePost,'QBO_NATIVE_POST_EXISTS','Continue the retained posting operation for this journal.',409);
    check(!record.responses.some(response=>['PENDING','SAVED'].includes(response.status)),'QBO_RESPONSE_ALREADY_RETAINED','Finish the original retained journal response before posting.',409);
    const plan=await this.plan(planId),{handoff,parent}=await this.current(plan.handoffId);checkQboSource(plan,handoff,parent);this.client.target(plan);
    check((value.expectedParentId??null)===(parent?.id??null),'QBO_STALE_ACCOUNTANT','Reload this journal after the accountant return changes.',409);
    const operationId=id(value.id),actor=text(value.actor,'operator',1000);
    check(!records(this.workspace).some(row=>row.nativePost?.requestId===operationId||row.responses.some(response=>response.id===operationId)),
      'QBO_NATIVE_REQUEST_ID_REUSED','Choose a new posting UUID; an original operation already owns this identity.',409);
    check(typeof value.createdAt==='string'&&Number.isFinite(Date.parse(value.createdAt))&&new Date(value.createdAt).toISOString()===value.createdAt,'QBO_NATIVE_CREATED_AT','Use the original posting review timestamp.');
    const bytes=await readExact(this.directory(planId),record.files.find(file=>file.name==='journal-entry.json'));
    const preview={schema:'stellar-forge.quickbooks-native-post.v1',id:operationId,requestId:operationId,createdAt:value.createdAt,actor,
      planId,planSha256:plan.integrity.sha256,requestSha256:qboHash(bytes),expectedParentId:parent?.id??null,realmId:plan.realmId,
      environment:plan.environment,docNumber:plan.docNumber,summary:copy(plan.summary),method:'POST',requestUrl:this.client.endpoint('journalentry',{requestId:operationId}).href};
    return {preview,previewSha256:digest(preview),revision:this.workspace.state.revision};
  }
  async post(planId,value){
    const existing=this.row(planId).nativePost;
    if(existing){
      check(existing.id===value.id&&existing.previewSha256===value.previewSha256&&existing.actor===value.actor&&existing.createdAt===value.createdAt,
        'QBO_NATIVE_REQUEST_CHANGED','This journal already has an exact retained posting request.',409);
      return this.runNativePost(planId);
    }
    await this.workspace.serial(async()=>{
      const prepared=await this.previewPost(planId,value);check(value.previewSha256===prepared.previewSha256,'QBO_NATIVE_PREVIEW_CHANGED','Review this exact company and journal request before posting.',409);
      const record=this.row(planId),bytes=await readExact(this.directory(planId),record.files.find(file=>file.name==='journal-entry.json'));
      const files=await packet(this.nativeDirectory(planId),{'intent.json':qboJson(prepared.preview),'request.json':bytes});
      await privateDir(join(this.nativeDirectory(planId),'attempts'));
      record.nativePost={...prepared.preview,previewSha256:prepared.previewSha256,status:'PREPARED',files,attempts:[],dispatched:false,
        responseId:null,journalEntryId:null,observedJournalId:null,sourceAttemptId:null,writeAttempts:0,retryAt:null,lastError:null,updatedAt:now()};
      await this.workspace.commit('qbo_native_post_reviewed',value.actor,{planId,requestId:value.id,requestSha256:prepared.preview.requestSha256,realmId:prepared.preview.realmId});
    });
    return this.runNativePost(planId);
  }
  async resumePost(planId,value){
    const operation=this.row(planId).nativePost;check(operation,'QBO_NATIVE_POST_REQUIRED','Choose a retained native posting.',404);
    check(value.id===operation.id,'QBO_NATIVE_REQUEST_CHANGED','Continue the original posting request.',409);
    await this.workspace.serial(async()=>{
      this.workspace.expected(value.revision);const actor=text(value.actor,'operator',1000);
      this.row(planId).nativePost.lastResume={actor,at:now()};
      await this.workspace.commit('qbo_native_post_resumed',actor,{planId,requestId:operation.id});
    });
    return this.runNativePost(planId);
  }
  async updateNative(planId,values,action='qbo_native_post_updated'){
    await this.workspace.serial(async()=>{
      const operation=this.row(planId).nativePost;check(operation,'QBO_NATIVE_POST_REQUIRED','Choose a retained native posting.',404);
      Object.assign(operation,values,{updatedAt:now()});
      await this.workspace.commit(action,operation.actor,{planId,requestId:operation.id,status:operation.status,...(operation.lastError?{code:operation.lastError.code}:{})});
    });
  }
  async captureNative(planId,kind,response){
    const attemptId=randomUUID(),receipt={schema:'stellar-forge.quickbooks-native-attempt.v1',id:attemptId,kind,
      receivedAt:response.receivedAt,status:response.status,ok:response.ok,headers:response.headers,request:response.request,
      responseSha256:qboHash(response.bytes),responseBytes:response.bytes.length};
    let saved;
    await this.workspace.serial(async()=>{
      const operation=this.row(planId).nativePost;
      const files=await packet(join(this.nativeDirectory(planId),'attempts',attemptId),{'response.json':response.bytes,'receipt.json':qboJson(receipt)});
      saved={...receipt,files};operation.attempts.push(saved);operation.updatedAt=now();
      await this.workspace.commit('qbo_native_response_retained',operation.actor,{planId,requestId:operation.id,attemptId,kind,status:response.status,responseSha256:receipt.responseSha256});
    });
    return saved;
  }
  async nativeHttpFailure(planId,response,kind){
    const operation=this.row(planId).nativePost;
    let source;try{source=JSON.parse(response.bytes.toString('utf8'));}catch{}
    const fault=kind==='post'&&response.status===400&&source?.Fault&&operation.writeAttempts===1&&!operation.observedJournalId;
    const status=fault?'FAULT':operation.dispatched||operation.observedJournalId?'UNCERTAIN':'RETRYABLE';
    const retryAt=qboRetryAt(response);
    await this.updateNative(planId,{status,retryAt,lastError:{code:response.status===429?'QBO_NATIVE_THROTTLED':'QBO_NATIVE_HTTP_'+response.status,
      message:response.status===429?'QuickBooks requested a pause. Resume at or after the retained retry time.':'QuickBooks returned HTTP '+response.status+'. Its exact response is retained with this operation.'}});
  }
  async finishNativeLocal(planId){
    const record=this.row(planId),operation=record.nativePost;
    if(!operation)return false;
    const prior=record.responses.find(response=>response.status==='PENDING');
    if(prior?.status==='PENDING')await this.finishResponse(planId,prior.id);
    const saved=this.row(planId).responses.find(response=>response.status==='SAVED'&&(response.id===operation.id||this.row(planId).status==='BOOKED'));
    if(saved){
      if(operation.status!=='BOOKED')await this.updateNative(planId,{status:'BOOKED',responseId:saved.id,journalEntryId:saved.journalEntryId,lastError:null,retryAt:null},'qbo_native_booking_linked');
      return true;
    }
    if(!operation.sourceAttemptId)return false;
    const attempt=operation.attempts.find(item=>item.id===operation.sourceAttemptId);check(attempt,'QBO_NATIVE_RESPONSE_REQUIRED','The retained native response reference changed.',409);
    const raw=await readExact(join(this.nativeDirectory(planId),'attempts',attempt.id),attempt.files.find(file=>file.name==='response.json'));
    const plan=await this.plan(planId),{parent}=await this.current(plan.handoffId);
    const value={id:operation.id,createdAt:operation.createdAt,actor:operation.actor,name:'Native QuickBooks journal '+plan.docNumber,
      realmId:plan.realmId,expectedParentId:parent?.id??null,responseJson:raw.toString('utf8')};
    const prepared=await this.previewResponse(planId,value);
    check(prepared.result.kind==='MATCHED','QBO_NATIVE_RESPONSE_MISMATCH','The retained response does not match the original reviewed journal.',409);
    await this.saveResponse(planId,{...value,revision:prepared.revision,previewSha256:prepared.previewSha256});
    const response=this.responseRow(planId,operation.id);
    await this.updateNative(planId,{status:'BOOKED',responseId:response.id,journalEntryId:response.journalEntryId,lastError:null,retryAt:null},'qbo_native_booking_linked');
    return true;
  }
  async acceptNative(planId,response,attempt){
    const plan=await this.plan(planId),operation=this.row(planId).nativePost;
    const result=inspectQboResponse({plan,responseBytes:response.bytes,realmId:plan.realmId,id:operation.id,actor:operation.actor,
      name:'Native QuickBooks journal '+plan.docNumber,createdAt:operation.createdAt});
    if(result.kind==='FAULT'){
      const definitive=attempt.kind==='post'&&operation.writeAttempts===1&&!operation.observedJournalId;
      await this.updateNative(planId,{status:definitive?'FAULT':operation.dispatched||operation.observedJournalId?'UNCERTAIN':'RETRYABLE',
        lastError:{code:'QBO_NATIVE_FAULT',message:'QuickBooks returned a fault. Review the retained native response.'}});return;
    }
    await this.updateNative(planId,{status:'RECEIVED',sourceAttemptId:attempt.id,journalEntryId:result.journalEntryId,observedJournalId:result.journalEntryId,lastError:null,retryAt:null},'qbo_native_journal_received');
    await this.finishNativeLocal(planId);
  }
  runNativePost(planId){
    if(this.nativeFlights.has(planId))return this.nativeFlights.get(planId);
    const run=this.performNativePost(planId).finally(()=>this.nativeFlights.delete(planId));this.nativeFlights.set(planId,run);return run;
  }
  async performNativePost(planId){
    const operation=this.row(planId).nativePost;check(operation,'QBO_NATIVE_POST_REQUIRED','Choose a retained native posting.',404);
    check(!this.nativeStop.signal.aborted,'QBO_NATIVE_CLOSING','The original workspace is closing.',409);
    if(operation.status==='BOOKED')return this.nativeState(planId);
    if(operation.retryAt)check(Date.now()>=Date.parse(operation.retryAt),'QBO_NATIVE_THROTTLED','QuickBooks requested a pause until '+operation.retryAt+'.',429);
    try{
      if(await this.finishNativeLocal(planId))return this.nativeState(planId);
      const record=this.row(planId),plan=await this.plan(planId),{handoff,parent}=await this.current(plan.handoffId);
      check(record.status==='REVIEWED','QBO_REVIEW_REQUIRED','The native posting belongs to a reviewed retained journal.',409);
      checkQboSource(plan,handoff,parent);this.client.target(plan);
      const intent=JSON.parse((await readExact(this.nativeDirectory(planId),operation.files.find(file=>file.name==='intent.json'))).toString('utf8'));
      const bytes=await readExact(this.nativeDirectory(planId),operation.files.find(file=>file.name==='request.json'));
      check(digest(intent)===operation.previewSha256&&intent.id===operation.id&&intent.planSha256===plan.integrity.sha256&&qboHash(bytes)===intent.requestSha256,
        'QBO_NATIVE_REQUEST_CHANGED','The retained native posting request changed.',409);
      check(intent.requestUrl===this.client.endpoint('journalentry',{requestId:operation.id}).href,'QBO_NATIVE_CONNECTION_CHANGED','Resume with the original company, environment and minor-version configuration.',409);
      await this.updateNative(planId,{status:'RUNNING',lastError:null,retryAt:null});
      const matches=[];
      for await(const page of this.client.searchJournal(plan,{signal:this.nativeStop.signal})){
        await this.captureNative(planId,'query',page.response);
        if(!page.response.ok){await this.nativeHttpFailure(planId,page.response,'query');return this.nativeState(planId);}
        if(page.error)throw Object.assign(new Error(page.error.message),{code:page.error.code});
        for(const entry of page.rows)if(entry.PrivateNote===plan.journalEntry.PrivateNote)matches.push(entry);
      }
      if(matches.length>1){await this.updateNative(planId,{status:'CONFLICT',observedJournalId:matches[0].Id,observedJournalIds:matches.map(entry=>entry.Id),lastError:{code:'QBO_NATIVE_MULTIPLE_JOURNALS',message:'Several native journals carry this exact plan identity. Review their retained source before continuing.'}});return this.nativeState(planId);}
      if(matches.length===1){
        await this.updateNative(planId,{observedJournalId:matches[0].Id},'qbo_native_journal_observed');
        const response=await this.client.readJournal(plan,matches[0].Id,{signal:this.nativeStop.signal}),attempt=await this.captureNative(planId,'read',response);
        if(!response.ok){await this.nativeHttpFailure(planId,response,'read');return this.nativeState(planId);}
        try{await this.acceptNative(planId,response,attempt);}
        catch(error){await this.updateNative(planId,{status:this.row(planId).nativePost.sourceAttemptId?'RECEIVED':'CONFLICT',
          lastError:{code:error.code??'QBO_NATIVE_RECONCILIATION',message:String(error.message??error).slice(0,1000)}});}
        return this.nativeState(planId);
      }
      check(!this.row(planId).nativePost.observedJournalId,'QBO_NATIVE_OBSERVED_JOURNAL_MISSING','A previously observed journal is absent from this source query. Reconcile its original native identity before another write.',409);
      // Admission precedes the external effect. Every retry keeps its original
      // requestid, URL and exact reviewed request bytes.
      await this.workspace.serial(async()=>{
        const live=this.row(planId),{handoff:currentHandoff,parent:currentParent}=await this.current(plan.handoffId);
        check(live.status==='REVIEWED','QBO_REVIEW_REQUIRED','The journal changed before native dispatch.',409);checkQboSource(plan,currentHandoff,currentParent);
        check(!live.responses.some(response=>['PENDING','SAVED'].includes(response.status)),'QBO_RESPONSE_ALREADY_RETAINED','Finish the original retained journal response before dispatch.',409);
        live.nativePost.writeAttempts=(live.nativePost.writeAttempts??0)+1;live.nativePost.dispatched=true;live.nativePost.firstDispatchedAt??=now();live.nativePost.updatedAt=now();
        await this.workspace.commit('qbo_native_dispatch_admitted',operation.actor,{planId,requestId:operation.id,requestSha256:operation.requestSha256});
      });
      const response=await this.client.createJournal(plan,{requestId:operation.id,bytes,signal:this.nativeStop.signal});
      const attempt=await this.captureNative(planId,'post',response);
      if(!response.ok){await this.nativeHttpFailure(planId,response,'post');return this.nativeState(planId);}
      await this.acceptNative(planId,response,attempt);
    }catch(error){
      const current=this.row(planId).nativePost;
      await this.updateNative(planId,{status:current.sourceAttemptId?'RECEIVED':current.dispatched||current.observedJournalId?'UNCERTAIN':'RETRYABLE',
        lastError:{code:error.code??'QBO_NATIVE_OPERATION_INTERRUPTED',message:String(error.message??error).slice(0,1000)}});
    }
    return this.nativeState(planId);
  }
  async nativeFile(planId,name,attemptId){
    const operation=this.row(planId).nativePost;check(operation,'QBO_NATIVE_POST_REQUIRED','Choose a retained native posting.',404);
    const source=attemptId?operation.attempts.find(item=>item.id===id(attemptId)):operation;check(source,'QBO_NATIVE_ATTEMPT_REQUIRED','Choose a retained native response.',404);
    const file=source.files.find(item=>item.name===name);check(file,'QBO_FILE_NOT_FOUND','Choose a retained native file.',404);
    const directory=attemptId?join(this.nativeDirectory(planId),'attempts',attemptId):this.nativeDirectory(planId);
    return {bytes:await readExact(directory,file),type:fileType(name),name:'quickbooks-native-'+(attemptId??operation.id)+'-'+name};
  }
  get tasks(){return new Set(this.nativeFlights.values());}
  async close(){this.nativeStop.abort();await Promise.allSettled([...this.nativeFlights.values()]);}

  async file(planId,name,responseId){
    const record=this.row(planId);await this.plan(planId);
    if(!responseId&&name==='journal-entry.json')check(['REVIEWED','BOOKED'].includes(record.status),'QBO_REVIEW_REQUIRED','Review the retained journal before exporting its native request.',409);
    const selected=responseId?this.responseRow(planId,responseId):record,file=selected.files.find(item=>item.name===name);
    check(file,'QBO_FILE_NOT_FOUND','Choose a retained QuickBooks file.',404);
    const directory=responseId?join(this.directory(planId),'responses',id(responseId)):this.directory(planId);
    return {bytes:await readExact(directory,file),name:'quickbooks-'+(responseId??planId)+'-'+name,type:fileType(name)};
  }
}
export async function handleQboRequest(qbo,{method,path,value}){
  const parts=path.split('/').filter(Boolean);if(parts[0]!=='api'||parts[1]!=='qbo')return null;
  if(parts.length===2&&method==='GET')return {value:qbo.view()};
  if(path==='/api/qbo/connection'&&method==='GET')return {value:qbo.connection()};
  if(path==='/api/qbo/company/fetch'&&method==='POST')return {value:await qbo.fetchCompany(value)};
  if(path==='/api/qbo/company/preview'&&method==='POST')return {value:{company:normalizeQboCompany(value)}};
  if(parts.length===4&&parts[2]==='handoffs'&&method==='GET')return {value:await qbo.handoff(parts[3])};
  if(path==='/api/qbo/preview'&&method==='POST')return {value:await qbo.preview(value)};
  if(path==='/api/qbo/plans'&&method==='POST')return {value:await qbo.create(value)};
  if(parts[2]==='plans'&&parts[3]){
    const planId=parts[3];
    if(parts.length===5&&parts[4]==='post'&&method==='POST')return {value:await qbo.post(planId,value)};
    if(parts.length===6&&parts[4]==='post'&&parts[5]==='preview'&&method==='POST')return {value:await qbo.previewPost(planId,value)};
    if(parts.length===6&&parts[4]==='post'&&parts[5]==='resume'&&method==='POST')return {value:await qbo.resumePost(planId,value)};
    if(parts.length===7&&parts[4]==='post'&&parts[5]==='download'&&method==='GET')return {file:await qbo.nativeFile(planId,parts[6])};
    if(parts.length===9&&parts[4]==='post'&&parts[5]==='attempts'&&parts[7]==='download'&&method==='GET')return {file:await qbo.nativeFile(planId,parts[8],parts[6])};
    if(parts.length===4&&method==='GET')return {value:await qbo.detail(planId)};
    if(parts.length===5&&parts[4]==='review'&&method==='POST')return {value:await qbo.review(planId,value)};
    if(parts.length===5&&parts[4]==='cancel'&&method==='POST')return {value:await qbo.cancel(planId,value)};
    if(parts.length===6&&parts[4]==='download'&&method==='GET')return {file:await qbo.file(planId,parts[5])};
    if(parts.length===6&&parts[4]==='responses'&&parts[5]==='preview'&&method==='POST')return {value:await qbo.previewResponse(planId,value)};
    if(parts.length===5&&parts[4]==='responses'&&method==='POST')return {value:await qbo.saveResponse(planId,value)};
    if(parts.length===7&&parts[4]==='responses'&&parts[6]==='resume'&&method==='POST')return {value:await qbo.resume(planId,parts[5],value)};
    if(parts.length===8&&parts[4]==='responses'&&parts[6]==='download'&&method==='GET')return {file:await qbo.file(planId,parts[7],parts[5])};
  }
  check(false,'NOT_FOUND','This QuickBooks operation was not found.',404);
}

