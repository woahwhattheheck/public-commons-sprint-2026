// MIT. Original Service capture -> native buyer coding -> issued accountant handover.
// Storage remains the SF74 commissioning journal. Financial decisions remain the
// original SF36 Store and admitted AccountantWorkspace.
import {constants} from 'node:fs';
import {open,lstat,mkdir,realpath} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {
  applyCommissioningCommand,commissioningDigest,commissioningFileBytes,
  encodeCommissioningBytes,newCommissioning,validateCommissioning,MAX_MATERIAL_BYTES
} from './commissioning.mjs';
import {serviceCanonical,serviceSha256} from './service-commitments.mjs';
import {readServiceAdjustments,serviceAdjustmentError} from './service-adjustments.mjs';
import {validateNativeServiceAdjustmentOutcome} from './service-adjustments-native.mjs';
import {retainCaseArtifact} from './case-store.mjs';
import {validateBuyerExpenseArguments} from '../../../stellar-forge/mcp-merchant-operator/buyer-expense-protocol.mjs';
import {inspectBuyerSource} from '../merchant-settlement-accounting/accountant/buyer-source.mjs';

export const SERVICE_BUYER_INTENT_SCHEMA='stellar-forge.merchant-service-buyer-intent.v1';
export const SERVICE_BUYER_OUTCOME_SCHEMA='stellar-forge.merchant-service-buyer-outcome.v1';
export const SERVICE_BUYER_VIEW_SCHEMA='stellar-forge.merchant-service-buyer-handovers.v1';
export const SERVICE_BUYER_ACTIONS=Object.freeze([
  'adjustment_capture','refund_review','center_save','labels_save','period_save',
  'coding_save','credit_coding_save','disposition','period_review','period_close',
  'period_reopen','delivery','accountant_create','accountant_return_save'
]);
const KINDS=new Map([[SERVICE_BUYER_INTENT_SCHEMA,'service-buyer-intent'],
  [SERVICE_BUYER_OUTCOME_SCHEMA,'service-buyer-outcome']]);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const NATIVE_UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/,ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/,SHA=/^[a-f0-9]{64}$/;
const copy=value=>structuredClone(value),same=(a,b)=>serviceCanonical(a)===serviceCanonical(b);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const decoder=new TextDecoder('utf-8',{fatal:true}),now=()=>new Date().toISOString();
function need(ok,message,code='SERVICE_BUYER_INVALID',status=422){
  if(!ok)throw serviceAdjustmentError(code,message,status);
}
function record(value,keys,label){
  need(value&&typeof value==='object'&&!Array.isArray(value)&&
    [Object.prototype,null].includes(Object.getPrototypeOf(value)),label+' must be a JSON object.');
  if(keys)need(Object.keys(value).every(k=>keys.includes(k)),label+' has an undeclared field.');
  return value;
}
function text(value,label,max=1000){
  need(typeof value==='string'&&value.trim().length>0&&value.length<=max&&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),'Check '+label+'.');return value;
}
function id(value,label='original record'){need(typeof value==='string'&&ID.test(value),'Choose the '+label+' ID.');return value;}
function uuid(value,label='intent'){need(typeof value==='string'&&UUID.test(value),'Retain the original '+label+' UUID.');return value;}
function sha(value,label='source'){need(typeof value==='string'&&SHA.test(value),'Retain the exact '+label+' SHA-256.');return value;}
function alias(value){need(typeof value==='string'&&ALIAS.test(value),'Choose a declared buyer/accountant workspace alias.');return value;}
function revision(value){need(Number.isSafeInteger(value)&&value>=0,'Retain the original whole workspace revision.');return value;}
function instant(value){need(typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value,'Retain the original observation time.');return value;}
function jsonShape(value,depth=0){
  need(depth<=80,'The original handover exceeds the supported nesting.');
  if(value===null||typeof value==='boolean')return;
  if(typeof value==='string'){need(decoder.decode(Buffer.from(value))===value,'Retain complete valid UTF-8 text.');return;}
  if(typeof value==='number'){need(Number.isFinite(value),'Use finite original JSON values.');return;}
  need(value&&typeof value==='object'&&(Array.isArray(value)||[Object.prototype,null].includes(Object.getPrototypeOf(value))),'Use complete JSON values.');
  for(const child of Array.isArray(value)?value:Object.values(value))jsonShape(child,depth+1);
}
function jsonBytes(value){
  jsonShape(value);const raw=Buffer.from(JSON.stringify(value,null,2)+'\n');
  need(raw.length<=MAX_MATERIAL_BYTES,'The complete handover exceeds the original case material limit. Keep the original native export and choose its existing buyer delivery route.','SERVICE_BUYER_MATERIAL_LIMIT',413);
  return raw;
}
function parse(bytes){try{return JSON.parse(decoder.decode(bytes));}catch{throw serviceAdjustmentError('SERVICE_BUYER_FILE_INVALID','The original file is not complete UTF-8 JSON.');}}
function bare(value){return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='sha256'));}
async function seal(value){return {...copy(value),sha256:await serviceSha256(value)};}
async function checkSeal(value){sha(value.sha256);need(await serviceSha256(bare(value))===value.sha256,'The saved buyer handover changed.','SERVICE_BUYER_CHANGED',409);}
function caseIdentity(context){return {id:uuid(context.caseId,'case'),revision:sha(context.caseRevision,'case revision'),workspaceSha256:sha(context.workspaceSha256,'case workspace')};}
function captureReference(value){
  const b=value.result.buyer;
  return {id:value.id,sha256:value.sha256,intentId:value.intentId,proposalId:value.proposalId,
    sourceSha256:value.result.export.sha256,eventId:b.source_identity.event_id,manifestSha256:b.manifest_sha256};
}
function fileDescriptor(name,type,bytes){return {name,type,bytes:bytes.length,sha256:hash(bytes),base64:Buffer.from(bytes).toString('base64')};}
function fileBytes(value){
  record(value,['name','type','bytes','sha256','base64'],'Original delivery file');
  need(typeof value.name==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(value.name),'Choose a complete original delivery filename.');
  text(value.type,'media type',200);sha(value.sha256,'file');revision(value.bytes);
  need(value.bytes>0&&value.bytes<=MAX_MATERIAL_BYTES&&typeof value.base64==='string'&&
    value.base64.length===4*Math.ceil(value.bytes/3),'The complete original file size differs.');
  const raw=Buffer.from(value.base64,'base64');
  need(raw.length===value.bytes&&raw.toString('base64')===value.base64&&hash(raw)===value.sha256,
    'The complete original delivery file differs from its saved bytes.','SERVICE_BUYER_FILE_CHANGED',409);return raw;
}
function nativeCanonical(value){
  // Original Python domain.canonical: ensure_ascii=True, sort_keys=True, compact.
  // Native request keys are the fixed ASCII contract; values retain exact text.
  return serviceCanonical(value).replace(/[\u007f-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
}
function nativeRequestFingerprint(request){
  return hash(Buffer.from(nativeCanonical({method:'POST',path:request.path,
    payload:request.body.payload,expected_revision:request.body.expected_revision})));
}
function currentBuyer(aliasName,state,workspaceId){
  need(state?.schema==='stellar-forge.buyer-expense-workspace.v1'&&state.id===workspaceId,
    'The admitted buyer workspace identity differs from its original state.','SERVICE_BUYER_WORKSPACE_CHANGED',409);
  return {alias:alias(aliasName),workspaceId:id(workspaceId,'buyer workspace'),revision:revision(state.revision),
    schema:state.schema,dataContext:state.data_context??''};
}
function checkBuyer(value){
  record(value,['alias','workspaceId','revision','schema','dataContext'],'Buyer selection');
  alias(value.alias);id(value.workspaceId,'buyer workspace');revision(value.revision);
  need(value.schema==='stellar-forge.buyer-expense-workspace.v1'&&['','operational','development'].includes(value.dataContext),'Use the original native buyer identity/context.');
}
async function withBuyer(owner,workspace,fn){
  need(owner&&typeof owner.withServiceBuyerWorkspace==='function','Use the already admitted original buyer owner.','SERVICE_BUYER_OWNER_REQUIRED',503);
  return owner.withServiceBuyerWorkspace(alias(workspace),async s=>{
    need(s&&typeof s.workspaceId==='string'&&['read','mutate','bytes'].every(k=>typeof s[k]==='function'),
      'The original buyer owner did not provide its native operation.','SERVICE_BUYER_OWNER_REQUIRED',503);
    return fn(s);
  });
}
async function withAccountant(owner,workspace,fn){
  need(owner&&typeof owner.withServiceAccountant==='function','Use the already admitted original accountant owner.','SERVICE_BUYER_ACCOUNTANT_REQUIRED',503);
  return owner.withServiceAccountant(alias(workspace),async s=>{
    sha(s?.workspaceId,'accountant workspace');sha(s?.sourcesSha256,'accountant sources');
    need(s.accountant&&['prepareBuyer','create','detail','file','view'].every(k=>typeof s.accountant[k]==='function'),
      'Use the existing original AccountantWorkspace.','SERVICE_BUYER_ACCOUNTANT_REQUIRED',503);return fn(s);
  });
}
async function privateDirectory(path,{create=false}={}){
  need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'Use the host-owned absolute buyer handover directory.');
  if(create)await mkdir(path,{recursive:true,mode:0o700});
  const st=await lstat(path);
  need(st.isDirectory()&&!st.isSymbolicLink()&&!(st.mode&0o077)&&(!process.getuid||st.uid===process.getuid()),
    'Use a private owner-controlled handover directory.');return realpath(path);
}
async function operationDirectory(base,caseId,intentId){
  const root=await privateDirectory(base,{create:true});
  return privateDirectory(join(root,'service-buyer',uuid(caseId,'case'),uuid(intentId)),{create:true});
}
async function readOptional(path){
  let handle;try{handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
  try{const before=await handle.stat({bigint:true});need(before.isFile()&&before.size<=BigInt(MAX_MATERIAL_BYTES)&&!(Number(before.mode)&0o077),'Use an unchanged private native result.');
    const bytes=await handle.readFile(),after=await handle.stat({bigint:true});
    need(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs&&BigInt(bytes.length)===after.size,
      'The original native result changed while being read.');return bytes;
  }finally{await handle.close();}
}
async function retainedFile(path,bytes){const old=await readOptional(path);if(old){need(old.equals(bytes),'A retained operation filename belongs to different original bytes.','SERVICE_BUYER_FILE_CONFLICT',409);return old;}await retainCaseArtifact(path,bytes);return bytes;}
async function retainedJSON(path,value){return parse(await retainedFile(path,jsonBytes(value)));}
async function allPages(s,path){
  let offset=0,total=null;const values=[];
  for(let page=0;page<500;page++){
    const response=await s.read(path+'?offset='+offset+'&limit=200');
    need(Array.isArray(response.items)&&Number.isSafeInteger(response.total)&&response.offset===offset,
      'The original buyer returned an incomplete page.','SERVICE_BUYER_PAGE_CHANGED',409);
    if(total===null)total=response.total;else need(total===response.total,'The original buyer collection changed during its read.','SERVICE_BUYER_WORKSPACE_CHANGED',409);
    values.push(...response.items);
    if(response.next===null){need(values.length===total,'The original buyer collection is incomplete.');return values;}
    need(Number.isSafeInteger(response.next)&&response.next>offset&&response.next===offset+response.items.length,'The original buyer page cursor changed.');offset=response.next;
  }
  throw serviceAdjustmentError('SERVICE_BUYER_COLLECTION_LIMIT','Use the original buyer application to narrow this collection before preparing the Service handover.',413);
}
function packetMatches(packet,capture){
  const b=capture.result.buyer;
  need(packet?.source_kind==='merchant_adjustments'&&packet.source_sha256===capture.result.export.sha256&&
    packet.manifest_sha256===b.manifest_sha256&&same(packet.original_event,b.original_event)&&
    same(packet.receipt,b.receipt)&&same(packet.purchase,b.purchase)&&same(packet.credits,b.credits),
    'This buyer receipt differs from the saved original Service capture.','SERVICE_BUYER_CAPTURE_CHANGED',409);
  return packet;
}
async function matchingPacket(s,capture,selectedId){
  if(selectedId!==undefined)return packetMatches(await s.read('/api/refund-packets/'+id(selectedId,'receipt')),capture);
  const matches=(await allPages(s,'/api/refund-packets')).filter(p=>p.manifest_sha256===capture.result.buyer.manifest_sha256);
  need(matches.length===1,'Capture the saved original Service export in this buyer workspace, then select its receipt.','SERVICE_BUYER_RECEIPT_REQUIRED',409);
  return packetMatches(await s.read('/api/refund-packets/'+id(matches[0].id)),capture);
}
function normalizeInput(action,input){
  record(input,null,'Buyer action input');jsonShape(input);need(SERVICE_BUYER_ACTIONS.includes(action),'Choose an original buyer handover action.');
  if(action==='adjustment_capture'){
    record(input,['name','provenance','dataContext'],'Capture input');text(input.name,'source name',160);text(input.provenance,'original provenance',6000);
    need(['operational','development'].includes(input.dataContext),'Select the original operational/development context.');return copy(input);
  }
  if(action==='delivery'){record(input,['closeId'],'Delivery selection');id(input.closeId,'issued close');return copy(input);}
  if(action==='accountant_create'){
    record(input,['deliveryOutcomeId','accountingWorkspace','name','handoffId'],'Accountant handoff');
    uuid(input.deliveryOutcomeId,'delivery outcome');alias(input.accountingWorkspace);text(input.name,'accountant handoff name',160);
    if(input.handoffId!==undefined)need(NATIVE_UUID.test(input.handoffId),'Use the original accountant handoff UUID.');return copy(input);
  }
  if(action==='accountant_return_save'){
    record(input,['closeId','file','previewSha256','operator','name','reason','supersedes'],'Bookkeeping return');
    id(input.closeId,'issued close');fileBytes(input.file);sha(input.previewSha256,'return preview');
    validateBuyerExpenseArguments(action,{workspace:'selected',requestId:'selected',expectedRevision:0,closeId:input.closeId,
      accountantSource:'selected',previewSha256:input.previewSha256,operator:input.operator,name:input.name,
      ...(input.reason===undefined?{}:{reason:input.reason}),supersedes:input.supersedes});
    return copy(input);
  }
  const selected=copy(input);delete selected.packetId;
  if(input.packetId!==undefined)id(input.packetId,'receipt');
  validateBuyerExpenseArguments(action,{workspace:'selected',requestId:'selected',expectedRevision:0,...selected});
  return copy(input);
}
function originalRequest(action,input,intentId,buyer,capture,sourceFile){
  let path,payload;
  if(action==='adjustment_capture'){
    need(typeof sourceFile==='string'&&isAbsolute(sourceFile)&&resolve(sourceFile)===sourceFile,'Keep the host-owned original capture path.');
    path='/api/adjustment-packets';payload={name:input.name,provenance:input.provenance,data_context:input.dataContext,
      source_file:sourceFile,source_sha256:capture.result.export.sha256,event_id:capture.result.buyer.source_identity.event_id,
      expected_job:copy(capture.result.buyer.receipt.expected_job??null)};
  }else if(['center_save','labels_save','period_save'].includes(action)){
    path='/api/'+({center_save:'centers',labels_save:'labels',period_save:'periods'})[action];payload=copy(input.payload);
  }else if(['refund_review','coding_save','credit_coding_save'].includes(action)){
    path='/api/'+({refund_review:'refund-packets',coding_save:'items',credit_coding_save:'credits'})[action]+'/'+id(input.id)+
      (action==='refund_review'?'/decision':'/coding');payload=copy(input.payload);
  }else if(action==='disposition'){path='/api/periods/'+id(input.periodId)+'/disposition';payload=copy(input.payload);}
  else if(action==='period_review'){path='/api/periods/'+id(input.id)+'/review';payload={reviewer:input.reviewer,role:input.role,notes:input.notes};}
  else if(action==='period_close'){path='/api/periods/'+id(input.id)+'/close';payload={review_id:input.reviewId};}
  else if(action==='period_reopen'){path='/api/periods/'+id(input.id)+'/reopen';payload={operator:input.operator,reason:input.reason};}
  else if(action==='accountant_return_save'){
    path='/api/closes/'+id(input.closeId)+'/accountant-return';payload={content_base64:input.file.base64,sha256:input.file.sha256,
      preview_sha256:input.previewSha256,operator:input.operator,name:input.name,reason:input.reason??'',supersedes:copy(input.supersedes)};
  }else return null;
  return {method:'POST',path,body:{request_id:'service-buyer-'+uuid(intentId),expected_revision:buyer.revision,payload}};
}
function buyerSourceFile(outcome){
  need(outcome?.action==='delivery','Choose the retained original issued buyer delivery.','SERVICE_BUYER_DELIVERY_REQUIRED',409);
  const file=outcome.result.files?.find(f=>f.name==='issued-buyer-accountant-source.json');
  need(file,'The retained delivery has no complete issued buyer source.');const raw=fileBytes(file),inspected=inspectBuyerSource(raw);
  need(inspected.document.workspaceId===outcome.buyer.workspaceId&&inspected.document.issued.id===outcome.result.closeId,
    'The issued accountant source belongs to another buyer workspace or close.','SERVICE_BUYER_SOURCE_CHANGED',409);
  return {file,raw,inspected};
}
function commandFor(value,requestId,expectedRevision){
  const raw=jsonBytes(value),kind=KINDS.get(value.schema);
  need(kind,'Choose a typed buyer intent or original native outcome.');
  return {type:'add_material',requestId,expectedRevision,actor:value.actor,recordedAt:value.createdAt,
    payload:{id:value.id,name:kind+'-'+value.id+'.json',mediaType:'application/json',data:encodeCommissioningBytes(raw),
      kind,description:kind==='service-buyer-intent'?'Original Service capture and exact admitted buyer/accountant request.':
      'Original buyer/accountant committed result and complete retained delivery files.',taskIds:[],editionId:null,
      reference:'urn:stellar-forge:service-buyer:'+value.id}};
}
async function readContext(context){
  caseIdentity(context);const native=await readServiceAdjustments(context);
  const commissioning=await validateCommissioning(context.commissioning)??newCommissioning();
  const captures=new Map(native.outcomes.filter(x=>x.action==='capture').map(x=>[x.id,x])),intents=new Map(),outcomes=new Map();
  for(const material of commissioning.materials.filter(x=>[...KINDS.values()].includes(x.kind))){
    const raw=commissioningFileBytes(commissioning,material.sha256),value=parse(raw);
    need(KINDS.get(value.schema)===material.kind&&value.id===material.id&&value.actor===material.actor&&value.createdAt===material.recordedAt,
      'The buyer material differs from its original commissioning identity.','SERVICE_BUYER_JOURNAL_CHANGED',409);
    jsonBytes(value);const command=commandFor(value,'journal-check',commissioning.revision);
    const requestSha256=await commissioningDigest(serviceCanonical({type:command.type,actor:command.actor,payload:command.payload,recordedAt:command.recordedAt}));
    need(commissioning.events.some(e=>e.type==='add_material'&&e.actor===value.actor&&e.recordedAt===value.createdAt&&
      e.requestSha256===requestSha256&&e.result?.materialId===material.id&&e.result.sha256===material.sha256&&e.result.bytes===raw.length),
      'The buyer handover is missing its exact original case operation.','SERVICE_BUYER_JOURNAL_CHANGED',409);
    const into=value.schema===SERVICE_BUYER_INTENT_SCHEMA?intents:outcomes;
    need(!into.has(value.id),'A buyer material ID is duplicated.');into.set(value.id,value);
  }
  const read={commissioning,captures,intents,outcomes};
  for(const intent of intents.values())await validateIntent(context,read,intent);
  for(const outcome of outcomes.values())await validateOutcome(context,read,outcome);
  return read;
}
async function validateIntent(context,read,value){
  record(value,['schema','id','createdAt','actor','sourceCase','capture','buyer','action','input','request','basis','accountant','sha256'],'Buyer intent');
  need(value.schema===SERVICE_BUYER_INTENT_SCHEMA,'Choose an original buyer intent.');
  uuid(value.id);instant(value.createdAt);text(value.actor,'operator',200);checkBuyer(value.buyer);record(value.basis,null,'Retained native basis');
  need(value.sourceCase?.id===context.caseId,'The buyer intent belongs to another original case.','SERVICE_BUYER_CASE_CHANGED',409);
  sha(value.sourceCase.revision,'case revision');sha(value.sourceCase.workspaceSha256,'case workspace');
  const capture=read.captures.get(value.capture?.id);need(capture&&same(captureReference(capture),value.capture),
    'The saved original Service capture is missing or changed.','SERVICE_BUYER_CAPTURE_CHANGED',409);
  normalizeInput(value.action,value.input);
  if(value.action==='delivery'){
    need(value.request?.method==='GET'&&value.request.closeId===value.input.closeId&&
      value.request.expectedRevision===value.buyer.revision&&same(value.request.files,deliveryRoutes(value.input.closeId,value.buyer.revision)),
      'The issued delivery selection changed.');
    need(value.basis.issued?.id===value.input.closeId,'Keep the complete original issued close.');
  }else if(value.action==='accountant_create'){
    const delivery=read.outcomes.get(value.input.deliveryOutcomeId),source=buyerSourceFile(delivery);
    need(same(value.buyer,delivery.buyer)&&same(delivery.capture,captureReference(capture))&&value.accountant?.alias===value.input.accountingWorkspace,
      'The accountant handoff selects another saved buyer delivery.');sha(value.accountant.workspaceId,'accountant workspace');
    sha(value.accountant.sourcesSha256,'accountant sources');revision(value.accountant.revision);
    const expected={id:value.input.handoffId??value.id,name:value.input.name,actor:value.actor,revision:value.accountant.revision,
      buyerSource:{contentBase64:source.file.base64,sha256:source.file.sha256}};
    need(same(value.request,expected),'The original accountant request changed.');
  }else{
    need(same(value.request,originalRequest(value.action,value.input,value.id,value.buyer,capture,value.request?.body?.payload?.source_file)),
      'The saved request differs from the original native buyer contract.');
  }
  await checkSeal(value);return value;
}
function verifyReceipt(intent,receipt){
  need(receipt?.state==='COMMITTED'&&receipt.id===intent.request.body.request_id&&receipt.operation===intent.request.path&&
    receipt.fingerprint===nativeRequestFingerprint(intent.request)&&receipt.response?.request_id===receipt.id&&
    Number.isSafeInteger(receipt.response.revision)&&receipt.response.revision===intent.buyer.revision+1,
    'The original buyer request receipt differs from the saved intent.','SERVICE_BUYER_RECEIPT_CHANGED',409);
  return receipt;
}
async function validateOutcome(context,read,value){
  record(value,['schema','id','createdAt','actor','intentId','intentSha256','capture','buyer','action','result','sha256'],'Buyer outcome');
  need(value.schema===SERVICE_BUYER_OUTCOME_SCHEMA,'Choose the original buyer outcome.');uuid(value.id,'outcome');instant(value.createdAt);
  const intent=read.intents.get(value.intentId);
  need(intent&&intent.sha256===value.intentSha256&&intent.actor===value.actor&&intent.action===value.action&&
    same(intent.capture,value.capture)&&same(intent.buyer,value.buyer),'The returned buyer operation differs from its saved intent.','SERVICE_BUYER_INTENT_CHANGED',409);
  record(value.result,null,'Original buyer result');
  if(value.action==='delivery'){
    need(value.result.closeId===intent.input.closeId&&value.result.workspaceId===intent.buyer.workspaceId&&
      value.result.revision===intent.buyer.revision&&Array.isArray(value.result.files)&&
      same(value.result.files.map(f=>({name:f.name,type:f.type})),intent.request.files.map(f=>({name:f.name,type:f.type}))),
      'The complete buyer delivery selection changed.');
    value.result.files.forEach(fileBytes);
    need(same(buyerSourceFile(value).inspected.document.issued,intent.basis.issued),
      'The issued source differs from the complete reviewed original close.','SERVICE_BUYER_ISSUED_CHANGED',409);
  }else if(value.action==='accountant_create'){
    need(value.result.accountant?.workspaceId===intent.accountant.workspaceId&&
      value.result.accountant.sourcesSha256===intent.accountant.sourcesSha256&&value.result.record?.id===intent.request.id&&
      value.result.record?.requestSha256===accountantRequestSha(intent.request)&&
      Array.isArray(value.result.files)&&Array.isArray(value.result.record.files)&&
      same(value.result.files.map(f=>({name:f.name,bytes:f.bytes,sha256:f.sha256})),
        value.result.record.files.map(f=>({name:f.name,bytes:f.bytes,sha256:f.sha256}))),
      'The original accountant handoff belongs to another workspace, request or retained file edition.');
    value.result.files.forEach(fileBytes);
    const source=value.result.files.find(f=>f.name==='original-buyer-source.json');
    need(source&&source.base64===intent.request.buyerSource.contentBase64&&source.sha256===intent.request.buyerSource.sha256,
      'The original accountant source bytes changed.');
  }else{
    verifyReceipt(intent,value.result);
    if(['adjustment_capture','refund_review'].includes(value.action))packetMatches(value.result.response.result,read.captures.get(value.capture.id));
  }
  need(value.id===resultUuid(intent)&&value.createdAt===originalTime(intent,value.result),
    'The buyer outcome must retain the original native result identity and time.','SERVICE_BUYER_OUTCOME_CHANGED',409);
  await checkSeal(value);return value;
}
export async function readServiceBuyerHandovers(context){
  const r=await readContext(context);return {schema:SERVICE_BUYER_VIEW_SCHEMA,revision:r.commissioning.revision,
    captures:[...r.captures.values()].map(captureReference),intents:[...r.intents.values()].map(copy),outcomes:[...r.outcomes.values()].map(copy)};
}
export function serviceBuyerSummary(view){
  const summary={schema:view.schema,revision:view.revision,captures:copy(view.captures),
    intents:view.intents.map(v=>({id:v.id,createdAt:v.createdAt,actor:v.actor,capture:copy(v.capture),buyer:copy(v.buyer),action:v.action,sha256:v.sha256,
      ...(v.accountant?{accountant:copy(v.accountant)}:{}),recordId:v.input.id??v.input.closeId??null})),
    outcomes:view.outcomes.map(v=>({id:v.id,createdAt:v.createdAt,actor:v.actor,intentId:v.intentId,intentSha256:v.intentSha256,
      capture:copy(v.capture),buyer:copy(v.buyer),action:v.action,sha256:v.sha256,
      recordId:v.result.response?.result?.id??v.result.record?.id??v.result.closeId??null,revision:v.result.response?.revision??v.result.revision??null,
      files:(v.result.files??[]).map(({base64,...file})=>file)}))};return summary;
}


function deliveryRoutes(closeId,expectedRevision){
  const close='/api/closes/'+id(closeId,'issued close');
  revision(expectedRevision);
  return [
    {name:'issued-buyer-accountant-source.json',type:'application/json',path:close+'/accountant-source'},
    {name:'buyer-expense-accountant-edition.zip',type:'application/zip',path:close+'/packet'},
    {name:'buyer-bookkeeping-complete-period.zip',type:'application/zip',path:close+'/bookkeeping-packet?expected_revision='+expectedRevision},
    {name:'buyer-expense-complete-project.zip',type:'application/zip',path:'/api/complete-project?expected_revision='+expectedRevision}
  ];
}
function selectedCapture(read,captureOutcomeId){
  const value=read.captures.get(uuid(captureOutcomeId,'capture outcome'));
  need(value,'Save the original Service capture outcome before opening its buyer workflow.','SERVICE_BUYER_CAPTURE_REQUIRED',409);
  return value;
}
function selectedPeriod(state,periodId){
  const value=state.periods.find(v=>v.id===id(periodId,'period'));
  need(value,'Choose an original buyer period.','SERVICE_BUYER_PERIOD_REQUIRED',409);return value;
}
function packetCredit(packet,capture,credit){
  const expected=capture.result.buyer.credits.find(v=>v.adjustment_id===credit?.native?.adjustment_id);
  need(expected&&packet.status==='ACCEPTED'&&(packet.credit_ids??[]).includes(credit.id)&&
    (credit.packet_history??[]).includes(packet.id)&&same(credit.native,expected)&&credit.item_id===packet.item_id,
    'The selected credit is not the verified original return in this saved capture.','SERVICE_BUYER_CREDIT_CHANGED',409);
  return credit;
}
function issuedCapture(issued,capture){
  const b=capture.result.buyer;
  const found=(issued.refund_packets??[]).find(p=>p.manifest_sha256===b.manifest_sha256&&
    p.native?.source_sha256===capture.result.export.sha256&&same(p.native.original_event,b.original_event)&&
    same(p.native.receipt,b.receipt)&&same(p.native.purchase,b.purchase)&&same(p.native.credits,b.credits));
  need(found&&found.status==='ACCEPTED',
    'Choose the issued period that retains this exact accepted Service capture. A later source edition remains a separate selection.',
    'SERVICE_BUYER_ISSUED_CAPTURE_REQUIRED',409);return found;
}
async function inspectNativeSelection(s,capture,{packetId,itemId,creditId,periodId}={}){
  const state=await s.read('/api/state'),packets=await allPages(s,'/api/refund-packets');
  const matching=packets.filter(p=>p.manifest_sha256===capture.result.buyer.manifest_sha256);
  let packet=null,item=null,credit=null,report=null;
  if(packetId!==undefined)packet=packetMatches(await s.read('/api/refund-packets/'+id(packetId,'receipt')),capture);
  else if(matching.length===1)packet=packetMatches(await s.read('/api/refund-packets/'+id(matching[0].id)),capture);
  const originalCredits=await allPages(s,'/api/credits');
  const credits=packet?originalCredits.filter(c=>(packet.credit_ids??[]).includes(c.id)).map(c=>packetCredit(packet,capture,c)):[];
  if(itemId!==undefined){
    need(packet?.status==='ACCEPTED'&&packet.item_id===itemId,'Select the original purchase linked by this accepted receipt.','SERVICE_BUYER_PURCHASE_CHANGED',409);
    item=await s.read('/api/items/'+id(itemId,'purchase'));
  }else if(packet?.item_id)item=await s.read('/api/items/'+id(packet.item_id,'purchase'));
  if(creditId!==undefined){
    need(packet,'Select the retained original receipt first.','SERVICE_BUYER_RECEIPT_REQUIRED',409);
    credit=packetCredit(packet,capture,await s.read('/api/credits/'+id(creditId,'credit')));
  }
  if(periodId!==undefined){selectedPeriod(state,periodId);report=await s.read('/api/periods/'+id(periodId)+'/report');}
  const after=await s.read('/api/state');
  need(after.id===state.id&&after.revision===state.revision,'The buyer workspace changed during its read. Refresh this original selection.',
    'SERVICE_BUYER_WORKSPACE_CHANGED',409);
  return {state,packets:matching,packet,item,credits,credit,report};
}
/** Read the actual admitted workspace. Complete native values are retained; no
 * alternate purchase, credit, classification or period projection is computed. */
export async function inspectServiceBuyerWorkspace(buyer,context,input){
  record(input,['captureOutcomeId','buyerWorkspace','packetId','periodId','itemId','creditId'],'Buyer view selection');
  const read=await readContext(context),capture=selectedCapture(read,input.captureOutcomeId),workspace=alias(input.buyerWorkspace);
  return withBuyer(buyer,workspace,async s=>{
    const selected=await inspectNativeSelection(s,capture,input);
    return {buyer:currentBuyer(workspace,selected.state,s.workspaceId),capture:captureReference(capture),
      packets:copy(selected.packets),centers:copy(selected.state.centers),periods:copy(selected.state.periods),labels:copy(selected.state.labels),
      packet:copy(selected.packet),item:copy(selected.item),credits:copy(selected.credits),credit:copy(selected.credit),report:copy(selected.report)};
  });
}
export async function previewServiceBuyerAccountantReturn(buyer,context,input){
  record(input,['captureOutcomeId','buyerWorkspace','closeId','file'],'Accountant return preview');
  const read=await readContext(context),capture=selectedCapture(read,input.captureOutcomeId),raw=fileBytes(input.file);
  id(input.closeId,'issued close');
  return withBuyer(buyer,input.buyerWorkspace,async s=>{
    const state=await s.read('/api/state'),binding=currentBuyer(input.buyerWorkspace,state,s.workspaceId);
    issuedCapture(await s.read('/api/closes/'+input.closeId),capture);
    const preview=await s.mutate('/api/closes/'+input.closeId+'/accountant-preview',
      {payload:{content_base64:raw.toString('base64'),sha256:input.file.sha256}});
    need(preview.revision===binding.revision,'The original bookkeeping history changed. Refresh and preview the same returned bytes.','SERVICE_BUYER_WORKSPACE_CHANGED',409);
    return {buyer:binding,capture:captureReference(capture),closeId:input.closeId,file:{name:input.file.name,type:input.file.type,bytes:raw.length,sha256:input.file.sha256},preview};
  });
}
async function nativeBasis(s,state,capture,action,input){
  if(action==='adjustment_capture')return {sourceSha256:capture.result.export.sha256,eventId:capture.result.buyer.source_identity.event_id};
  if(action==='center_save')return {centers:copy(state.centers)};
  if(action==='labels_save')return {labels:copy(state.labels)};
  if(action==='period_save')return {periods:copy(state.periods)};
  const packet=await matchingPacket(s,capture,action==='refund_review'?input.id:input.packetId);
  if(action==='refund_review'){
    need(packet.status==='PENDING','This original receipt already has a decision. Reopen its saved request or choose another pending receipt.',
      'SERVICE_BUYER_RECEIPT_REVIEWED',409);
    return {packet};
  }
  need(packet.status==='ACCEPTED','Accept the original receipt before coding or issuing its buyer handover.','SERVICE_BUYER_RECEIPT_REQUIRED',409);
  if(action==='coding_save'){
    need(packet.item_id===input.id,'Choose the original purchase linked by this accepted receipt.','SERVICE_BUYER_PURCHASE_CHANGED',409);
    const item=await s.read('/api/items/'+id(input.id));
    need(item.basis===input.payload.basis,'The original purchase coding basis changed.','SERVICE_BUYER_CODING_CHANGED',409);
    return {packet,item,centers:copy(state.centers)};
  }
  if(action==='credit_coding_save'){
    const credit=packetCredit(packet,capture,await s.read('/api/credits/'+id(input.id)));
    need(credit.basis===input.payload.basis,'The original credit or purchase allocation basis changed.','SERVICE_BUYER_CODING_CHANGED',409);
    return {packet,credit,centers:copy(state.centers)};
  }
  if(action==='delivery'){
    const issued=await s.read('/api/closes/'+id(input.closeId));issuedCapture(issued,capture);return {packet,issued};
  }
  if(action==='accountant_return_save'){
    const issued=await s.read('/api/closes/'+id(input.closeId));issuedCapture(issued,capture);
    const preview=await s.mutate('/api/closes/'+input.closeId+'/accountant-preview',
      {payload:{content_base64:input.file.base64,sha256:input.file.sha256}});
    need(preview.revision===state.revision&&preview.preview_sha256===input.previewSha256,
      'Preview the exact accountant return against this current issued history.','SERVICE_BUYER_RETURN_PREVIEW_CHANGED',409);
    return {packet,issued,preview};
  }
  const periodId=action==='disposition'?input.periodId:input.id;
  const period=selectedPeriod(state,periodId),report=await s.read('/api/periods/'+id(periodId)+'/report');
  if(action==='period_close'){
    const review=await s.read('/api/reviews/'+id(input.reviewId,'review'));
    need(review.period_id===period.id&&review.context_sha256===report.context_sha256&&review.decision==='READY'&&report.ready,
      'Use the exact current ready review for this period.','SERVICE_BUYER_REVIEW_CHANGED',409);
    return {packet,period,report,review};
  }
  if(action==='disposition'){
    need(report.issues.some(issue=>issue.item_id===input.payload.item_id&&issue.code===input.payload.code&&issue.basis===input.payload.basis),
      'Choose an actual current issue and its original basis.','SERVICE_BUYER_ISSUE_CHANGED',409);
  }
  return {packet,period,report};
}
function samePreparation(intent,input,capture){
  need(intent.id===input.id&&intent.actor===input.actor&&intent.action===input.action&&
    intent.buyer.alias===input.buyerWorkspace&&same(intent.input,normalizeInput(input.action,input.input))&&
    same(intent.capture,captureReference(capture)),
    'This intent ID already names different original buyer inputs. Reopen it or prepare a new explicit decision.',
    'SERVICE_BUYER_INTENT_CONFLICT',409);
  return intent;
}
/** Prepare complete native requests once. The returned intent must be saved
 * through the original case before execute is called. Repeated preparation
 * retains the first observed native revision, original path and request bytes. */
export async function prepareServiceBuyerIntent(buyer,context,input,{directory,accounting}={}){
  record(input,['id','captureOutcomeId','buyerWorkspace','action','actor','input'],'Buyer preparation');
  uuid(input.id);text(input.actor,'operator',200);alias(input.buyerWorkspace);
  const normalized=normalizeInput(input.action,input.input),read=await readContext(context),capture=selectedCapture(read,input.captureOutcomeId);
  const prior=read.intents.get(input.id);
  if(prior)return copy(samePreparation(prior,input,capture));
  const operation=await operationDirectory(directory,context.caseId,input.id),preparedPath=join(operation,'prepared-intent.json');
  const prepared=await readOptional(preparedPath);
  if(prepared){
    const retained=parse(prepared);await validateIntent(context,read,retained);return copy(samePreparation(retained,input,capture));
  }
  await validateNativeServiceAdjustmentOutcome(context,capture,{directory:operation});
  const original=Buffer.from(capture.result.buyer.files[0].base64,'base64'),sourceFile=join(operation,capture.result.export.name);
  need(original.length===capture.result.export.bytes&&hash(original)===capture.result.export.sha256,
    'The saved original merchant adjustment bytes differ.','SERVICE_BUYER_CAPTURE_CHANGED',409);
  await retainedFile(sourceFile,original);
  return withBuyer(buyer,input.buyerWorkspace,async s=>{
    const state=await s.read('/api/state'),binding=currentBuyer(input.buyerWorkspace,state,s.workspaceId);
    let request,basis,accountant,buyerBinding=binding;
    if(input.action==='accountant_create'){
      const delivery=read.outcomes.get(normalized.deliveryOutcomeId),source=buyerSourceFile(delivery);
      need(delivery.capture.id===capture.id&&delivery.capture.sha256===capture.sha256&&
        delivery.buyer.alias===binding.alias&&delivery.buyer.workspaceId===binding.workspaceId,
        'Select the complete issued delivery from this same buyer and Service capture.','SERVICE_BUYER_DELIVERY_CHANGED',409);
      buyerBinding=copy(delivery.buyer);
      const selected=await withAccountant(accounting,normalized.accountingWorkspace,async a=>{
        const preview=await a.accountant.prepareBuyer({buyerSource:{contentBase64:source.file.base64,sha256:source.file.sha256}});
        const view=await a.accountant.view();
        need(view.revision===preview.workspaceRevision,'The original accountant workspace changed during preparation.','SERVICE_BUYER_ACCOUNTANT_CHANGED',409);
        return {accountant:{alias:normalized.accountingWorkspace,workspaceId:a.workspaceId,sourcesSha256:a.sourcesSha256,revision:revision(view.revision)},
          preview};
      });
      accountant=selected.accountant;
      request={id:normalized.handoffId??input.id,name:normalized.name,actor:input.actor,revision:accountant.revision,
        buyerSource:{contentBase64:source.file.base64,sha256:source.file.sha256}};
      basis={deliveryOutcomeId:delivery.id,deliveryOutcomeSha256:delivery.sha256,preview:selected.preview};
    }else{
      basis=await nativeBasis(s,state,capture,input.action,normalized);
      request=input.action==='delivery'?{method:'GET',closeId:normalized.closeId,expectedRevision:binding.revision,
        files:deliveryRoutes(normalized.closeId,binding.revision)}:
        originalRequest(input.action,normalized,input.id,binding,capture,sourceFile);
    }
    const after=await s.read('/api/state');
    need(after.id===binding.workspaceId&&after.revision===binding.revision,'The buyer workspace changed during preparation. Refresh before preparing this exact action.',
      'SERVICE_BUYER_WORKSPACE_CHANGED',409);
    const value=await seal({schema:SERVICE_BUYER_INTENT_SCHEMA,id:input.id,createdAt:now(),actor:input.actor,
      sourceCase:caseIdentity(context),capture:captureReference(capture),buyer:buyerBinding,action:input.action,
      input:normalized,request,basis,...(accountant?{accountant}:{})});
    await validateIntent(context,read,value);
    await retainedJSON(preparedPath,value);return copy(value);
  });
}
async function originalReceipt(s,intent){
  try{return verifyReceipt(intent,await s.read('/api/requests/'+intent.request.body.request_id));}
  catch(error){if(error.code==='REQUEST_NOT_COMMITTED')return null;throw error;}
}
function resultUuid(intent){
  const value=createHash('sha256').update('stellar-forge.service-buyer-outcome\0'+intent.sha256).digest();
  value[6]=(value[6]&15)|0x40;value[8]=(value[8]&63)|0x80;
  const h=value.subarray(0,16).toString('hex');
  return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}
function originalTime(intent,result){
  const value=result.created_at??result.record?.createdAt??intent.createdAt;
  need(typeof value==='string'&&Number.isFinite(Date.parse(value)),'Retain the original native result time.');
  return new Date(value).toISOString();
}
async function outcomeFor(intent,result){
  return seal({schema:SERVICE_BUYER_OUTCOME_SCHEMA,id:resultUuid(intent),createdAt:originalTime(intent,result),
    actor:intent.actor,intentId:intent.id,intentSha256:intent.sha256,capture:copy(intent.capture),buyer:copy(intent.buyer),
    action:intent.action,result:copy(result)});
}
function verifyBuyerIdentity(intent,binding){
  need(binding.alias===intent.buyer.alias&&binding.workspaceId===intent.buyer.workspaceId&&binding.schema===intent.buyer.schema,
    'The declared buyer alias now opens another workspace. Reopen the original selected owner.',
    'SERVICE_BUYER_WORKSPACE_CHANGED',409);
}
function accountantRequestSha(request){
  // Exact original AccountantWorkspace.create() request, including its key order.
  return hash(Buffer.from(JSON.stringify({runId:null,closeId:null,name:request.name.trim(),actor:request.actor.trim(),labels:[],
    buyerSource:request.buyerSource},null,2)+'\n'));
}
async function executeAccountant(accounting,intent,operation){
  return withAccountant(accounting,intent.accountant.alias,async a=>{
    need(a.workspaceId===intent.accountant.workspaceId&&a.sourcesSha256===intent.accountant.sourcesSha256,
      'The declared accountant selection changed from the retained preparation.','SERVICE_BUYER_ACCOUNTANT_CHANGED',409);
    // The original engine checks an existing handoff ID/request before revision.
    // This exact call therefore also recovers an accepted response loss.
    const returned=await a.accountant.create(copy(intent.request)),record=returned.record;
    need(record?.id===intent.request.id&&record.requestSha256===accountantRequestSha(intent.request),
      'The original accountant handoff request differs from the saved Service intent.','SERVICE_BUYER_ACCOUNTANT_RECEIPT_CHANGED',409);
    const files=[];
    for(const selected of record.files){
      const native=await a.accountant.file(record.id,selected.name,{revisionId:'initial'}),raw=Buffer.from(native.bytes);
      need(raw.length===selected.bytes&&hash(raw)===selected.sha256,'An original accountant handoff file changed.','SERVICE_BUYER_FILE_CHANGED',409);
      const file=fileDescriptor(selected.name,native.type,raw);fileBytes(file);
      await retainedFile(join(operation,file.name),raw);files.push(file);
    }
    const source=files.find(f=>f.name==='original-buyer-source.json');
    need(source&&source.base64===intent.request.buyerSource.contentBase64&&source.sha256===intent.request.buyerSource.sha256,
      'The original accountant receiver did not retain the identical issued buyer source.','SERVICE_BUYER_SOURCE_CHANGED',409);
    const detail=await a.accountant.detail(record.id,{revisionId:'initial'});
    return {accountant:{alias:intent.accountant.alias,workspaceId:a.workspaceId,sourcesSha256:a.sourcesSha256},
      record:copy(record),detail:copy(detail),files};
  });
}
async function executeDelivery(s,intent,capture,operation){
  const current=await s.read('/api/state'),binding=currentBuyer(intent.buyer.alias,current,s.workspaceId);
  verifyBuyerIdentity(intent,binding);
  need(binding.revision===intent.buyer.revision,'The original buyer revision advanced before this complete delivery. Preserve this intent and prepare a new explicit current delivery.',
    'SERVICE_BUYER_DELIVERY_STALE',409);
  const issued=await s.read('/api/closes/'+intent.input.closeId);issuedCapture(issued,capture);
  need(same(issued,intent.basis.issued),'The original issued close changed.','SERVICE_BUYER_ISSUED_CHANGED',409);
  const files=[];
  for(const selected of intent.request.files){
    const raw=Buffer.from(await s.bytes(selected.path)),file=fileDescriptor(selected.name,selected.type,raw);fileBytes(file);
    await retainedFile(join(operation,file.name),raw);files.push(file);
  }
  const after=await s.read('/api/state');
  need(after.id===binding.workspaceId&&after.revision===binding.revision,
    'The original buyer changed while assembling its complete delivery. Retain this attempt and prepare a current delivery.','SERVICE_BUYER_DELIVERY_STALE',409);
  const result={workspaceId:binding.workspaceId,revision:binding.revision,closeId:intent.input.closeId,files};
  buyerSourceFile({action:'delivery',buyer:intent.buyer,result});
  return result;
}
/** Execute only a case-retained intent. No revision, request ID, selected source
 * path or successful native receipt is reconstructed on retry. */
export async function executeServiceBuyerIntent(buyer,{context,intentId,directory,accounting}){
  const read=await readContext(context),intent=read.intents.get(uuid(intentId)),capture=intent&&read.captures.get(intent.capture.id);
  need(intent&&capture,'Save the original prepared buyer intent in this case before executing it.','SERVICE_BUYER_INTENT_REQUIRED',409);
  const existing=[...read.outcomes.values()].filter(o=>o.intentId===intentId);
  need(existing.length<=1,'This original intent has conflicting outcome identities.','SERVICE_BUYER_OUTCOME_CONFLICT',409);
  if(existing.length)return copy(existing[0]);
  const operation=await operationDirectory(directory,context.caseId,intentId),outcomePath=join(operation,'native-outcome.json');
  const retained=await readOptional(outcomePath);
  if(retained){const value=parse(retained);await validateOutcome(context,read,value);
    need(value.intentId===intent.id,'This original local outcome belongs to another intent.');return value;}
  await validateNativeServiceAdjustmentOutcome(context,capture,{directory:operation});
  return withBuyer(buyer,intent.buyer.alias,async s=>{
    const state=await s.read('/api/state'),binding=currentBuyer(intent.buyer.alias,state,s.workspaceId);
    verifyBuyerIdentity(intent,binding);
    let result;
    if(intent.action==='accountant_create')result=await executeAccountant(accounting,intent,operation);
    else if(intent.action==='delivery')result=await executeDelivery(s,intent,capture,operation);
    else{
      result=await originalReceipt(s,intent);
      if(!result){
        need(binding.revision===intent.buyer.revision,
          'No successful original request is retained and the buyer revision has changed. Refresh and prepare a new explicit decision; keep this exact intent for history.',
          'SERVICE_BUYER_REQUEST_STALE',409);
        if(intent.action==='adjustment_capture'){
          const target=intent.request.body.payload.source_file;
          need(target===join(operation,capture.result.export.name),
            'This uncommitted capture was prepared in another host directory. Preserve it and prepare a new explicit source selection here.','SERVICE_BUYER_SOURCE_PATH_CHANGED',409);
          await retainedFile(target,Buffer.from(capture.result.buyer.files[0].base64,'base64'));
        }
        try{await s.mutate(intent.request.path,copy(intent.request.body));}
        catch(error){
          // Only the native request journal can turn a lost response into a
          // committed result. Any failed/uncertain read leaves this intent intact.
          try{result=await originalReceipt(s,intent);}catch(recoveryError){throw Object.assign(recoveryError,{originalFailure:{code:error.code??'UNKNOWN',message:error.message}});}
          if(!result)throw error;
        }
        if(!result)result=await originalReceipt(s,intent);
        need(result,'The original buyer did not return a committed request receipt. Retain and recover this same intent.','SERVICE_BUYER_REQUEST_UNCERTAIN',503);
      }
      if(intent.action==='adjustment_capture'||intent.action==='refund_review')packetMatches(result.response.result,capture);
    }
    const outcome=await outcomeFor(intent,result);
    await validateOutcome(context,read,outcome);
    await retainedJSON(outcomePath,outcome);return copy(outcome);
  });
}
export async function validateServiceBuyerMaterial(context,material){
  const read=await readContext(context);jsonBytes(material);
  if(material.schema===SERVICE_BUYER_INTENT_SCHEMA)await validateIntent(context,read,material);
  else if(material.schema===SERVICE_BUYER_OUTCOME_SCHEMA)await validateOutcome(context,read,material);
  else throw serviceAdjustmentError('SERVICE_BUYER_MATERIAL_REQUIRED','Choose the prepared buyer intent or its original native outcome.');
  return copy(material);
}
/** Caller persists this complete commissioning value with the ordinary case CAS.
 * Public routes accept intents only; native execution is the outcome writer. */
export async function retainServiceBuyerMaterial(context,{requestId,expectedRevision,material}){
  id(requestId,'original case request');revision(expectedRevision);
  const read=await readContext(context);jsonBytes(material);
  if(material.schema===SERVICE_BUYER_INTENT_SCHEMA)await validateIntent(context,read,material);
  else if(material.schema===SERVICE_BUYER_OUTCOME_SCHEMA)await validateOutcome(context,read,material);
  else throw serviceAdjustmentError('SERVICE_BUYER_MATERIAL_REQUIRED','Choose the prepared buyer intent or its original native outcome.');
  const previous=read.intents.get(material.id)??read.outcomes.get(material.id);
  if(previous)need(same(previous,material),'This saved buyer material ID belongs to different original bytes.','SERVICE_BUYER_MATERIAL_CONFLICT',409);
  if(material.schema===SERVICE_BUYER_OUTCOME_SCHEMA){
    const prior=[...read.outcomes.values()].find(o=>o.intentId===material.intentId);
    need(!prior||same(prior,material),'This original buyer intent already has its retained outcome.','SERVICE_BUYER_OUTCOME_CONFLICT',409);
  }
  if(previous&&!read.commissioning.events.some(e=>e.id===requestId))
    return {commissioning:read.commissioning,material:copy(previous),replayed:true,revision:read.commissioning.revision};
  const applied=await applyCommissioningCommand(read.commissioning,commandFor(material,requestId,expectedRevision));
  return {commissioning:applied.state,material:copy(material),replayed:applied.replayed,revision:applied.revision};
}
export async function serviceBuyerFile(context,{outcomeId,name}){
  const read=await readContext(context),outcome=read.outcomes.get(uuid(outcomeId,'outcome'));
  need(outcome,'Choose the saved original buyer outcome.','SERVICE_BUYER_OUTCOME_REQUIRED',404);
  if(name==='original-buyer-result.json')return {name,type:'application/json',bytes:jsonBytes(outcome)};
  const selected=outcome.result.files?.find(f=>f.name===name);
  need(selected,'Choose a complete file retained by this original buyer outcome.','SERVICE_BUYER_FILE_REQUIRED',404);
  return {name:selected.name,type:selected.type,bytes:fileBytes(selected)};
}
