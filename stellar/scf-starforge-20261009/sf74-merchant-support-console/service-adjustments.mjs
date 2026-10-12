// MIT. Service-report adjustment handovers in the original commissioning journal.
import {
  applyCommissioningCommand, commissioningDigest, commissioningFileBytes,
  decodeCommissioningBytes, encodeCommissioningBytes, newCommissioning, validateCommissioning,
  MAX_MATERIAL_BYTES
} from './commissioning.mjs';
import {serviceCanonical, serviceSha256, validateServiceRecord} from './service-commitments.mjs';

export const SERVICE_ADJUSTMENT_PROPOSAL_SCHEMA='stellar-forge.merchant-service-adjustment-proposal.v1';
export const SERVICE_ADJUSTMENT_INTENT_SCHEMA='stellar-forge.merchant-service-adjustment-intent.v1';
export const SERVICE_ADJUSTMENT_OUTCOME_SCHEMA='stellar-forge.merchant-service-adjustment-outcome.v1';
export const SERVICE_ADJUSTMENT_VIEW_SCHEMA='stellar-forge.merchant-service-adjustments.v1';
export const MAX_SERVICE_ADJUSTMENT_BYTES=MAX_MATERIAL_BYTES;
const KINDS=new Map([
  [SERVICE_ADJUSTMENT_PROPOSAL_SCHEMA,'service-adjustment-proposal'],
  [SERVICE_ADJUSTMENT_INTENT_SCHEMA,'service-adjustment-intent'],
  [SERVICE_ADJUSTMENT_OUTCOME_SCHEMA,'service-adjustment-outcome']
]);
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ANY_UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const ALIAS=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
const copy=value=>structuredClone(value),same=(a,b)=>serviceCanonical(a)===serviceCanonical(b);
const own=(value,key)=>Object.hasOwn(value,key);
const now=()=>new Date().toISOString();
export function serviceAdjustmentError(code,message,status=422){return Object.assign(new Error(message),{code,status});}
function need(ok,message,code='INVALID_SERVICE_ADJUSTMENT',status=422){
  if(!ok)throw serviceAdjustmentError(code,message,status);
}
function object(value,label){need(value&&typeof value==='object'&&!Array.isArray(value),label+' must be a JSON object.');return value;}
function fields(value,keys,label){object(value,label);need(Object.keys(value).every(k=>keys.includes(k)),label+' has an undeclared field.');return value;}
function text(value,label,max=1000,empty=false){
  need(typeof value==='string'&&(empty||value.trim().length>0)&&value.trim().length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),'Check '+label+'.');
  return value.trim();
}
function uuid(value,label='identifier'){need(typeof value==='string'&&UUID.test(value),'Use the original '+label+' UUID.');return value;}
function nativeUuid(value,label){need(typeof value==='string'&&ANY_UUID.test(value),'Use the original '+label+' UUID.');return value;}
function hash(value,label='digest'){need(typeof value==='string'&&SHA.test(value),'Use the original SHA-256 '+label+'.');return value;}
function alias(value,label='accounting selection'){need(typeof value==='string'&&ALIAS.test(value),'Choose a declared '+label+'.');return value;}
function integer(value,label){need(Number.isSafeInteger(value)&&value>=0,'Use the original '+label+'.');return value;}
function instant(value,label='UTC time'){
  need(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value,'Use an exact '+label+'.');
  return value;
}
function atomic(value,label='amount'){
  need(typeof value==='string'&&/^[1-9][0-9]{0,38}$/.test(value)&&BigInt(value)<=(1n<<127n)-1n,'Use a positive integer '+label+' in the selected original asset’s atomic units.');return value;
}
function jsonShape(value,depth=0){
  need(depth<=64,'The retained JSON is nested too deeply.');
  if(value===null||typeof value==='string'||typeof value==='boolean')return;
  if(typeof value==='number'){need(Number.isFinite(value),'Retained JSON numbers must be finite.');return;}
  need(value&&typeof value==='object'&&(Array.isArray(value)||Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null),'Retain only complete JSON values.');
  for(const item of Array.isArray(value)?value:Object.values(value))jsonShape(item,depth+1);
}
function bytes(value){
  jsonShape(value);const raw=enc.encode(JSON.stringify(value,null,2)+'\n');
  need(raw.length<=MAX_SERVICE_ADJUSTMENT_BYTES,'This complete handover exceeds the original commissioning material limit.');
  return raw;
}
function withoutSeal(value){return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='sha256'));}
async function sealed(value){return {...copy(value),sha256:await serviceSha256(value)};}
async function checkSeal(value){hash(value.sha256);need(await serviceSha256(withoutSeal(value))===value.sha256,'A retained adjustment handover changed.','SERVICE_ADJUSTMENT_CHANGED',409);}
function caseIdentity(context){
  object(context,'Saved case context');return {
    id:uuid(context.caseId,'case'),revision:hash(context.caseRevision,'case revision'),
    workspaceSha256:hash(context.workspaceSha256,'case workspace')
  };
}
function normalizedBasis(value){
  fields(value,['amountAtomic','reference','description'],'Original monetary basis');
  return {amountAtomic:atomic(value.amountAtomic,'service basis'),
    reference:text(value.reference,'monetary basis reference',4096),
    description:text(value.description,'monetary basis description',8000)};
}
function requestOf(record){
  return Object.fromEntries(['id','runId','eventId','kind','amountAtomic','effectiveAt','reason','reference','actor','createdAt'].map(key=>[key,record[key]]));
}
async function nativeJsonHash(value){return commissioningDigest(enc.encode(JSON.stringify(value,null,2)+'\n'));}
async function validatePreview(value){
  fields(value,['request','previewSha256','detail','workspaceRevision'],'Original native preview');
  integer(value.workspaceRevision,'accounting workspace revision');hash(value.previewSha256,'native preview');
  const r=fields(value.request,['id','runId','eventId','kind','amountAtomic','effectiveAt','reason','reference','actor','createdAt'],'Original native request');
  nativeUuid(r.id,'adjustment');nativeUuid(r.runId,'reconciliation');hash(r.eventId,'event');
  need(['REFUND','CANCELLATION'].includes(r.kind),'Select an original refund request or cancellation.');
  atomic(r.amountAtomic);instant(r.createdAt,'native creation time');instant(r.effectiveAt,'native effective time');
  text(r.reason,'native reason',4000);text(r.reference,'native reference',1000,true);text(r.actor,'native operator',1000);
  const d=object(value.detail,'Original payment detail'),source=object(d.source,'Original payment source'),event=object(d.event,'Original payment event');
  nativeUuid(source.runId,'reconciliation');for(const key of ['reportSha256','manifestSha256','inputManifestSha256'])hash(source[key],key);
  need(source.runId===r.runId&&event.eventId===r.eventId,'The native request selects a different original payment.');
  text(event.network,'original network',160);hash(event.assetDigest,'original asset');atomic(event.amountAtomic,'original payment');
  object(d.totals,'Original payment totals');
  if(r.kind==='REFUND')need(d.refundTerms,'The native refund preview must retain its original return terms.');
  if(d.refundTerms!==null){
    const t=object(d.refundTerms,'Original return terms');
    need(t.network===event.network&&t.maxAmountAtomic===event.amountAtomic,'The retained return terms select another native payment.');
    text(t.asset,'original asset',1000);text(t.from,'original return sender',200);text(t.to,'original return recipient',200);
    need(d.originalProof&&d.originalProof.network===t.network&&d.originalProof.asset===t.asset&&
      d.originalProof.recipient===t.from&&d.originalProof.payer===t.to&&d.originalProof.atomicAmount===event.amountAtomic,
      'The original return direction differs from its retained payment proof.');
    need(await commissioningDigest(enc.encode(t.asset))===event.assetDigest,'The original asset differs from its ledger digest.');
    const recipient=event.recipientDigest??event.termsRecipientDigest;
    if(recipient)need(await commissioningDigest(enc.encode(t.from))===recipient,'The original payment recipient differs from its ledger digest.');
  }
  // The original accounting hash uses its declared request order and complete
  // source/event/totals objects. Preserve those native objects without rewriting.
  const binding={request:requestOf(r),source:d.source,original:d.event,refundTerms:d.refundTerms,totals:d.totals};
  need(await nativeJsonHash(binding)===value.previewSha256,'The native preview differs from its original request, payment or totals.','SERVICE_ADJUSTMENT_NATIVE_PREVIEW_CHANGED',409);
  return value;
}
function selectedRows(report,ids){
  need(Array.isArray(ids)&&ids.length<=1000&&ids.every(v=>typeof v==='string')&&new Set(ids).size===ids.length,'Choose distinct retained incident IDs.');
  const result=ids.slice().sort();
  need(result.every(id=>report.preview.incidents.some(row=>row.id===id)),'A selected incident is absent from the saved service report.');
  return result;
}
async function validateProposal(proposal,context,service){
  fields(proposal,['schema','id','createdAt','actor','sourceCase','accountingId','report','incidentIds','basis','nativePreview','sha256'],'Service adjustment proposal');
  need(proposal.schema===SERVICE_ADJUSTMENT_PROPOSAL_SCHEMA,'Choose the original service adjustment proposal.');
  uuid(proposal.id,'proposal');instant(proposal.createdAt);text(proposal.actor,'operator',200);alias(proposal.accountingId);
  fields(proposal.sourceCase,['id','revision','workspaceSha256'],'Original source case');
  uuid(proposal.sourceCase.id,'source case');hash(proposal.sourceCase.revision,'source case revision');hash(proposal.sourceCase.workspaceSha256,'source workspace');
  need(proposal.sourceCase.id===context.caseId,'The proposal belongs to another original saved case.','SERVICE_ADJUSTMENT_CASE_CHANGED',409);
  const report=service.reports.find(row=>row.id===proposal.report?.id&&row.sha256===proposal.report?.sha256);
  need(report&&same(report,proposal.report),'The original complete Service report is missing or changed.','SERVICE_ADJUSTMENT_REPORT_CHANGED',409);
  need(same(selectedRows(report,proposal.incidentIds),proposal.incidentIds),'Retained incident selection has changed.');
  need(same(normalizedBasis(proposal.basis),proposal.basis),'The retained monetary basis is not normalized.');
  await validatePreview(proposal.nativePreview);
  need(proposal.nativePreview.request.id===proposal.id&&proposal.nativePreview.request.actor===proposal.actor,
    'The proposal ID or operator differs from its original native request.');
  await checkSeal(proposal);return proposal;
}
function normalizeIntentInput(proposal,action,actor,input={}){
  if(action==='record'){
    fields(input,[],'Record input');
    return {...copy(proposal.nativePreview.request),revision:proposal.nativePreview.workspaceRevision,previewSha256:proposal.nativePreview.previewSha256};
  }
  if(action==='verify'){
    need(proposal.nativePreview.request.kind==='REFUND','Only a retained refund request has a returned-transfer verification.');
    fields(input,['revision','transaction','rpcEndpoint','retryJobId'],'Returned-transfer verification');
    const endpoint=text(input.rpcEndpoint,'selected original RPC endpoint',4096);
    let parsed;try{parsed=new URL(endpoint);}catch{}
    need(parsed&&['https:','http:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password&&!parsed.hash,'Retain the exact selected native RPC URL.');
    const request={revision:integer(input.revision,'accounting revision'),actor,
      transaction:hash(input.transaction,'returned transaction'),rpcEndpoint:endpoint};
    if(input.retryJobId!==undefined&&input.retryJobId!==null)request.retryJobId=nativeUuid(input.retryJobId,'prior verification job');
    return request;
  }
  if(action==='capture'){
    fields(input,['expectedJob'],'Buyer capture selection');
    const expectedJob=input.expectedJob??null;
    if(expectedJob!==null){
      fields(expectedJob,['job_id','settlement'],'Original buyer job selection');
      text(expectedJob.job_id,'original buyer job',1024);object(expectedJob.settlement,'Original buyer settlement');
      jsonShape(expectedJob);
      const event=proposal.nativePreview.detail.event;
      const settlement={id:event.eventId,receiptFingerprint:event.receiptFingerprint,transactionFingerprint:event.transactionFingerprint,
        network:event.network,assetDigest:event.assetDigest,recipientDigest:event.recipientDigest??event.termsRecipientDigest??null,
        amountAtomic:event.amountAtomic,routeId:event.routeId,method:event.method,orderReferenceDigest:event.orderReferenceDigest??null};
      need(Object.keys(settlement).every(key=>own(expectedJob.settlement,key)&&expectedJob.settlement[key]===settlement[key]),
        'The original buyer job selects another complete native settlement.');
      return {runId:proposal.nativePreview.request.runId,eventId:proposal.nativePreview.request.eventId,
        expectedJob:{job_id:expectedJob.job_id,settlement}};
    }
    return {runId:proposal.nativePreview.request.runId,eventId:proposal.nativePreview.request.eventId,expectedJob:null};
  }
  throw serviceAdjustmentError('INVALID_SERVICE_ADJUSTMENT_ACTION','Choose record, verify or capture.');
}
async function validateIntent(intent,proposals){
  fields(intent,['schema','id','createdAt','actor','proposalId','proposalSha256','action','request','sha256'],'Service adjustment intent');
  need(intent.schema===SERVICE_ADJUSTMENT_INTENT_SCHEMA,'Choose the original native intent.');
  uuid(intent.id,'intent');instant(intent.createdAt);text(intent.actor,'operator',200);uuid(intent.proposalId,'proposal');hash(intent.proposalSha256,'proposal');
  const proposal=proposals.get(intent.proposalId);need(proposal&&proposal.sha256===intent.proposalSha256,'The native intent is missing its original proposal.');
  let input;
  if(intent.action==='record')input={};
  else if(intent.action==='verify')input=Object.fromEntries(Object.entries(intent.request).filter(([key])=>key!=='actor'));
  else if(intent.action==='capture')input={expectedJob:intent.request.expectedJob};
  const expected=normalizeIntentInput(proposal,intent.action,intent.actor,input);
  need(same(expected,intent.request),'The native intent differs from its retained proposal or selected original request.','SERVICE_ADJUSTMENT_INTENT_CHANGED',409);
  await checkSeal(intent);return intent;
}
function nativeSourceSame(actual,proposal){
  const preview=proposal.nativePreview;
  need(same(actual.source,preview.detail.source)&&same(actual.original,preview.detail.event)&&
    same(requestOf(actual),preview.request)&&actual.previewSha256===preview.previewSha256,
    'The native result belongs to another original adjustment, event or reviewed source.','SERVICE_ADJUSTMENT_RESULT_CHANGED',409);
}
function fileBytes(file,label='native file'){
  fields(file,['name','type','bytes','sha256','base64'],label);
  text(file.name,label+' name',240);need(!/[/\\]/.test(file.name)&&file.name!=='.'&&file.name!=='..','Retain a native basename.');
  text(file.type,label+' type',160);integer(file.bytes,label+' byte count');hash(file.sha256,label+' hash');
  const raw=decodeCommissioningBytes(file.base64);need(raw.length===file.bytes,label+' length differs from the original bytes.');
  return raw;
}
function nativeJobMatches(job,proposal,intent){
  nativeUuid(job.id,'verification job');
  need(job.adjustmentId===proposal.id&&job.transaction===intent.request.transaction&&job.rpcEndpoint===intent.request.rpcEndpoint,
    'The saved job differs from the original returned-transfer request.','SERVICE_ADJUSTMENT_JOB_CHANGED',409);
  need(['QUEUED','RUNNING','COMPLETED','FAILED','INTERRUPTED'].includes(job.status),'Unknown original verification state.');
}
async function validateOutcome(outcome,proposals,intents){
  fields(outcome,['schema','id','createdAt','actor','intentId','intentSha256','proposalId','action','result','sha256'],'Native adjustment outcome');
  need(outcome.schema===SERVICE_ADJUSTMENT_OUTCOME_SCHEMA,'Choose the original native adjustment outcome.');
  uuid(outcome.id,'outcome');instant(outcome.createdAt);text(outcome.actor,'operator',200);uuid(outcome.intentId,'intent');hash(outcome.intentSha256,'intent');
  const intent=intents.get(outcome.intentId),proposal=proposals.get(outcome.proposalId);
  need(intent&&proposal&&intent.proposalId===proposal.id&&intent.sha256===outcome.intentSha256&&outcome.action===intent.action&&outcome.actor===intent.actor,
    'The native result is missing its exact saved intent.','SERVICE_ADJUSTMENT_INTENT_CHANGED',409);
  object(outcome.result,'Native result');
  if(outcome.action==='record'||outcome.action==='verify'){
    const result=fields(outcome.result,['adjustment','duplicate','state','job','recovered'],'Original native result');
    object(result.adjustment,'Original adjustment');nativeSourceSame(result.adjustment,proposal);
    if(result.duplicate!==undefined)need(typeof result.duplicate==='boolean','Invalid original replay result.');
    if(result.recovered!==undefined)need(typeof result.recovered==='boolean','Invalid recovery observation.');
    if(outcome.action==='verify')nativeJobMatches(object(result.job,'Original verification job'),proposal,intent);
    else need(!own(result,'job'),'A native record result has no verification job.');
  }else{
    const result=fields(outcome.result,['adjustment','source','export','files','buyer'],'Original buyer handover');
    object(result.adjustment,'Original adjustment');nativeSourceSame(result.adjustment,proposal);
    need(same(result.source,proposal.nativePreview.detail.source),'The original export belongs to another reconciliation.');
    const ex=fields(result.export,['name','type','bytes','sha256'],'Original adjustment export');
    text(ex.name,'export filename',240);need(!/[/\\]/.test(ex.name),'Use the original export basename.');
    need(ex.type==='application/json','The original producer export must be JSON.');integer(ex.bytes,'export byte count');hash(ex.sha256,'export');
    need(Array.isArray(result.files)&&result.files.length===2,'Retain the native CSV and HTML from this complete export.');
    const names=new Set();
    for(const f of result.files){const raw=fileBytes(f);need(!names.has(f.name),'Native filenames are duplicated.');names.add(f.name);need(await commissioningDigest(raw)===f.sha256,'Native report bytes changed.');}
    need(result.files.some(f=>f.type==='text/csv')&&result.files.some(f=>f.type==='text/html'),'Retain both native CSV and HTML.');
    const buyer=object(result.buyer,'Original buyer capture');
    need(buyer.schema==='stellar-forge.buyer-adjustment-source.v1'&&buyer.source_sha256===ex.sha256&&
      buyer.source_identity?.event_id===intent.request.eventId&&buyer.source_identity?.network===proposal.nativePreview.detail.event.network&&
      same(buyer.original_event,proposal.nativePreview.detail.event)&&same(buyer.receipt?.source,result.source)&&
      same(buyer.receipt?.expected_job,intent.request.expectedJob),
      'The buyer capture selects another original file, event or buyer job.','SERVICE_ADJUSTMENT_BUYER_CHANGED',409);
    need(Array.isArray(buyer.files)&&buyer.files.length===1,'Retain the original complete merchant adjustment JSON in the buyer capture.');
    const original=buyer.files[0],raw=decodeCommissioningBytes(original.base64);
    need(original.name==='merchant-adjustments.json'&&original.original_name===ex.name&&original.bytes===ex.bytes&&
      raw.length===ex.bytes&&original.sha256===ex.sha256&&await commissioningDigest(raw)===ex.sha256,
      'The complete original export bytes differ from the retained buyer source.');
    let doc;try{doc=JSON.parse(dec.decode(raw));}catch{throw serviceAdjustmentError('INVALID_SERVICE_ADJUSTMENT_EXPORT','The original export is not complete UTF-8 JSON.');}
    need(doc.schema==='stellar-forge.merchant-adjustment-export.v1'&&same(doc.source,result.source)&&
      doc.workspaceRevision===buyer.receipt.workspaceRevision&&doc.exportedAt===buyer.receipt.exportedAt,
      'The buyer receipt differs from its original export.');
    const events=doc.events?.filter(e=>e.original?.eventId===intent.request.eventId);
    need(events?.length===1&&same(events[0].original,proposal.nativePreview.detail.event)&&same(events[0].totals,buyer.receipt.totals),
      'The retained export has a missing or ambiguous original payment.');
    const record=events[0].adjustments?.find(a=>a.id===proposal.id);
    need(record&&same(record,result.adjustment),'The selected adjustment is missing from its original exported snapshot.');
    const manifest=decodeCommissioningBytes(buyer.manifest_base64);
    need(await commissioningDigest(manifest)===buyer.manifest_sha256,'The original buyer intake manifest changed.');
  }
  await checkSeal(outcome);return outcome;
}
async function readContext(context){
  caseIdentity(context);
  const service=await validateServiceRecord(context.service),commissioning=await validateCommissioning(context.commissioning)??newCommissioning();
  const proposals=new Map(),intents=new Map(),outcomes=new Map(),rows=[];
  for(const material of commissioning.materials){
    if(![...KINDS.values()].includes(material.kind))continue;
    need(material.mediaType==='application/json','Service adjustment handovers retain their complete original JSON.');
    const raw=commissioningFileBytes(commissioning,material.sha256);
    let value;try{value=JSON.parse(dec.decode(raw));}catch{throw serviceAdjustmentError('INVALID_SERVICE_ADJUSTMENT_MATERIAL','A retained service adjustment material is not complete JSON.');}
    need(KINDS.get(value?.schema)===material.kind&&material.id===value.id&&material.actor===value.actor&&material.recordedAt===value.createdAt,
      'A service adjustment material differs from its original journal identity.','SERVICE_ADJUSTMENT_MATERIAL_CHANGED',409);
    bytes(value);
    const command=materialCommand(value,'journal-check',commissioning.revision);
    const expectedRequest=await commissioningDigest(serviceCanonical({
      type:command.type,actor:command.actor,payload:command.payload,recordedAt:command.recordedAt
    }));
    need(commissioning.events.some(event=>event.type==='add_material'&&event.actor===value.actor&&
      event.recordedAt===value.createdAt&&event.requestSha256===expectedRequest&&
      event.result?.materialId===value.id&&event.result.sha256===material.sha256&&event.result.bytes===raw.length),
      'The handover is missing its exact original commissioning operation.','SERVICE_ADJUSTMENT_JOURNAL_CHANGED',409);
    const map=value.schema===SERVICE_ADJUSTMENT_PROPOSAL_SCHEMA?proposals:value.schema===SERVICE_ADJUSTMENT_INTENT_SCHEMA?intents:outcomes;
    need(!map.has(value.id),'A service adjustment material is duplicated.');map.set(value.id,value);rows.push({material,value});
  }
  for(const value of proposals.values())await validateProposal(value,context,service);
  for(const value of intents.values())await validateIntent(value,proposals);
  for(const value of outcomes.values())await validateOutcome(value,proposals,intents);
  return {service,commissioning,proposals,intents,outcomes,rows};
}
/** This view reads the one original commissioning material and event store. */
export async function readServiceAdjustments(context){
  const read=await readContext(context);
  return {schema:SERVICE_ADJUSTMENT_VIEW_SCHEMA,revision:read.commissioning.revision,
    proposals:[...read.proposals.values()].map(copy),intents:[...read.intents.values()].map(copy),
    outcomes:[...read.outcomes.values()].map(copy)};
}
export async function prepareServiceAdjustment(context,input){
  const read=await readContext(context);
  fields(input,['id','reportId','reportSha256','incidentIds','basis','accountingId','nativePreview','actor'],'Service adjustment proposal input');
  const report=read.service.reports.find(r=>r.id===uuid(input.reportId,'report')&&r.sha256===hash(input.reportSha256,'report'));
  need(report,'Choose an original retained Service report.','SERVICE_ADJUSTMENT_REPORT_CHANGED',409);
  const body={schema:SERVICE_ADJUSTMENT_PROPOSAL_SCHEMA,id:uuid(input.id,'proposal'),createdAt:now(),
    actor:text(input.actor,'operator',200),sourceCase:caseIdentity(context),accountingId:alias(input.accountingId),
    report:copy(report),incidentIds:selectedRows(report,input.incidentIds??[]),basis:normalizedBasis(input.basis),nativePreview:copy(input.nativePreview)};
  const prior=read.proposals.get(body.id);
  if(prior){
    const keys=['actor','accountingId','report','incidentIds','basis','nativePreview'];
    need(keys.every(key=>same(prior[key],body[key])),'This proposal ID already belongs to different reviewed inputs.','SERVICE_ADJUSTMENT_REQUEST_CONFLICT',409);
    return copy(prior);
  }
  const proposal=await sealed(body);await validateProposal(proposal,context,read.service);return proposal;
}
export async function prepareServiceAdjustmentIntent(context,input){
  const read=await readContext(context);
  fields(input,['id','proposalId','action','actor','input'],'Native intent input');
  const proposal=read.proposals.get(uuid(input.proposalId,'proposal'));
  need(proposal,'Save the original reviewed proposal before preparing its native action.','SERVICE_ADJUSTMENT_PROPOSAL_REQUIRED',409);
  const actor=text(input.actor,'operator',200),body={schema:SERVICE_ADJUSTMENT_INTENT_SCHEMA,id:uuid(input.id,'intent'),createdAt:now(),
    actor,proposalId:proposal.id,proposalSha256:proposal.sha256,action:input.action,
    request:normalizeIntentInput(proposal,input.action,actor,input.input??{})};
  const prior=read.intents.get(body.id);
  if(prior){
    need(['actor','proposalId','proposalSha256','action','request'].every(key=>same(prior[key],body[key])),
      'This native intent ID already belongs to another original request.','SERVICE_ADJUSTMENT_REQUEST_CONFLICT',409);
    return copy(prior);
  }
  const intent=await sealed(body);await validateIntent(intent,read.proposals);return intent;
}
function resultUuid(digest){
  const chars=digest.slice(0,32).split('');chars[12]='4';chars[16]=((parseInt(chars[16],16)&3)|8).toString(16);
  const s=chars.join('');return [s.slice(0,8),s.slice(8,12),s.slice(12,16),s.slice(16,20),s.slice(20)].join('-');
}
/** Called by the native leaf after its original operation or saved-job read. */
export async function prepareServiceAdjustmentOutcome(context,{intentId,result}){
  const read=await readContext(context),intent=read.intents.get(uuid(intentId,'intent'));
  need(intent,'Save the original native intent before retaining a result.','SERVICE_ADJUSTMENT_INTENT_REQUIRED',409);
  jsonShape(result);
  const original=[...read.outcomes.values()].find(row=>row.intentId===intent.id&&same(row.result,result));if(original)return copy(original);
  const id=resultUuid(await serviceSha256({intentId,result})),outcome=await sealed({
    schema:SERVICE_ADJUSTMENT_OUTCOME_SCHEMA,id,createdAt:now(),actor:intent.actor,
    intentId:intent.id,intentSha256:intent.sha256,proposalId:intent.proposalId,action:intent.action,result:copy(result)
  });
  await validateOutcome(outcome,read.proposals,read.intents);return outcome;
}
function materialCommand(material,requestId,expectedRevision){
  const raw=bytes(material),kind=KINDS.get(material.schema);
  return {type:'add_material',requestId,expectedRevision,actor:material.actor,
    payload:{id:material.id,name:kind+'-'+material.id+'.json',mediaType:'application/json',
      data:encodeCommissioningBytes(raw),kind,description:kind==='service-adjustment-proposal'?
        'Original Service report, explicit monetary basis and native merchant adjustment preview.':
        kind==='service-adjustment-intent'?'Exact saved native request for the original merchant accounting workspace.':
        'Original merchant accounting result or complete buyer handover.',
      taskIds:[],editionId:null,reference:'urn:stellar-forge:service-adjustment:'+material.id},
    recordedAt:material.createdAt};
}
export async function validateServiceAdjustmentMaterial(context,material){
  const read=await readContext(context);object(material,'Service adjustment material');bytes(material);
  if(material.schema===SERVICE_ADJUSTMENT_PROPOSAL_SCHEMA)await validateProposal(material,context,read.service);
  else if(material.schema===SERVICE_ADJUSTMENT_INTENT_SCHEMA)await validateIntent(material,read.proposals);
  else if(material.schema===SERVICE_ADJUSTMENT_OUTCOME_SCHEMA)await validateOutcome(material,read.proposals,read.intents);
  else throw serviceAdjustmentError('INVALID_SERVICE_ADJUSTMENT_MATERIAL','Choose an original service proposal, native intent or outcome.');
  return copy(material);
}
/** The caller saves this complete next commissioning value through the native case CAS. */
export async function retainServiceAdjustment(context,{requestId,expectedRevision,material}){
  const read=await readContext(context);alias(requestId,'original case request ID');integer(expectedRevision,'commissioning revision');
  object(material,'Service adjustment material');bytes(material);
  if(material.schema===SERVICE_ADJUSTMENT_PROPOSAL_SCHEMA)await validateProposal(material,context,read.service);
  else if(material.schema===SERVICE_ADJUSTMENT_INTENT_SCHEMA)await validateIntent(material,read.proposals);
  else if(material.schema===SERVICE_ADJUSTMENT_OUTCOME_SCHEMA)await validateOutcome(material,read.proposals,read.intents);
  else throw serviceAdjustmentError('INVALID_SERVICE_ADJUSTMENT_MATERIAL','Choose an original service proposal, native intent or outcome.');
  const all=new Map([...read.proposals,...read.intents,...read.outcomes]),prior=all.get(material.id);
  if(prior)need(same(prior,material),'A saved adjustment material ID belongs to different original bytes.','SERVICE_ADJUSTMENT_REQUEST_CONFLICT',409);
  const command=materialCommand(material,requestId,expectedRevision);
  const event=read.commissioning.events.find(row=>row.id===requestId);
  if(prior&&!event)return {commissioning:read.commissioning,material:copy(prior),replayed:true,revision:read.commissioning.revision};
  const applied=await applyCommissioningCommand(read.commissioning,command);
  const next={...context,commissioning:applied.state};await readContext(next);
  return {commissioning:applied.state,material:copy(material),replayed:applied.replayed,revision:applied.revision};
}
