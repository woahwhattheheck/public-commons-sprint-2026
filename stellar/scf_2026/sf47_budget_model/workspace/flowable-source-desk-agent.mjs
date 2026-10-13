// SPDX-License-Identifier: MIT
// Complete Flowable sidecar requests through the original Grant client transport.
import {createHash} from 'node:crypto';
export const FLOWABLE_SOURCE_DESK_SCHEMA='stellar-forge.flowable-source-desk.v1';
export const FLOWABLE_SOURCE_DESK_MAX_FILE=256*1024*1024;
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail=message=>Object.assign(new Error(message),{code:'GRANT_FLOWABLE_SOURCE_INPUT'});
const need=(ok,message)=>{if(!ok)throw fail(message);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const json=x=>JSON.parse(JSON.stringify(x));
const exact=(v,keys,required=keys)=>need(plain(v)&&Object.keys(v).every(k=>keys.includes(k))&&
 required.every(k=>Object.hasOwn(v,k)),'Keep the complete declared Flowable source fields.');
const uuid=x=>{need(typeof x==='string'&&UUID.test(x),'Keep the original request UUID.');return x;};
const sha=x=>{need(typeof x==='string'&&SHA.test(x),'Keep the original complete SHA256 identity.');return x;};
const whole=(x,min,max)=>{need(Number.isSafeInteger(x)&&x>=min&&x<=max,'Keep the original whole source count.');return x;};
const query=(route,value)=>route+'?'+new URLSearchParams(value).toString();
const fields={
 catalogue:['requestId','archiveId'],
 inspect:['requestId','archiveId','programmeId','programmeRevision','expectedProgrammeSha256','expectedBasisSha256'],
 template:['requestId','inspectionId','seedId','commissioningId','nativeCaseId','expectedVersion'],
 prepare:['requestId','inspectionId','seedId','bindingsId','commissioningId','nativeCaseId','expectedVersion','attachments'],
};
export function planFlowableSourceOperation(action,input){
 need(plain(input)&&/^operation-[a-f0-9]{32}$/.test(input.caseId??''),'Select the original customer case.');
 const base='/api/operations/'+input.caseId+'/flowable-sources';
 let route=base,options={mutation:false,timeoutMs:1830000,maxResponseBytes:64*1024*1024};
 if(action==='import'){
  exact(input,['caseId','requestId','kind','name','bytes','sha256']);
  uuid(input.requestId);sha(input.sha256);
  need(['archive','seed','bindings','commissioning','attachment'].includes(input.kind),'Choose an original source kind.');
  need(typeof input.name==='string'&&input.name.length>0&&input.name.length<=200&&
   !/[/\\\x00-\x1f\x7f]/.test(input.name)&&!['.','..'].includes(input.name),'Keep the original plain filename.');
  need(Buffer.isBuffer(input.bytes)||input.bytes instanceof Uint8Array,'Retain complete original input bytes.');
  const bytes=Buffer.from(input.bytes);
  const cap=['archive','attachment'].includes(input.kind)?FLOWABLE_SOURCE_DESK_MAX_FILE:
   ['seed','bindings'].includes(input.kind)?2*1024*1024:8*1024*1024;
  need(bytes.length<=cap&&hash(bytes)===input.sha256,'The complete original source differs from its declared identity.');
  route=query(base+'/import',{requestId:input.requestId,kind:input.kind,name:input.name,bytes:String(bytes.length),sha256:input.sha256});
  options={...options,body:bytes,contentType:'application/octet-stream',mutation:true,
   originalRequestId:input.requestId};
  input={...input,bytes}; // Retain the frozen copy for this exact attempt.
 }else if(Object.hasOwn(fields,action)){
  exact(input,['caseId','body']);exact(input.body,fields[action],fields[action].filter(k=>k!=='attachments'));
  const body=json(input.body);uuid(body.requestId);
  for(const k of ['archiveId','seedId','bindingsId','commissioningId','expectedProgrammeSha256','expectedBasisSha256'])
   if(body[k]!==undefined)sha(body[k]);
  if(body.inspectionId!==undefined)uuid(body.inspectionId);
  if(body.programmeRevision!==undefined)whole(body.programmeRevision,1,Number.MAX_SAFE_INTEGER);
  if(body.expectedVersion!==undefined)whole(body.expectedVersion,1,10000000);
  if(body.nativeCaseId!==undefined)need(body.nativeCaseId===input.caseId,'Retain the same original case selection.');
  route=base+'/'+action;options={...options,body,mutation:true,originalRequestId:body.requestId};
  input={caseId:input.caseId,body};
 }else if(action==='archive-describe'){
  exact(input,['caseId','requestId']);route=base+'/requests/'+uuid(input.requestId)+'/archive.zip?describe=1';
 }else if(action==='request'){
  exact(input,['caseId','requestId']);route=base+'/requests/'+uuid(input.requestId);
 }else if(action==='list'){
  exact(input,['caseId','offset','limit'],['caseId']);
  route=query(base+'/requests',{offset:String(whole(input.offset??0,0,Number.MAX_SAFE_INTEGER)),
   limit:String(whole(input.limit??100,1,200))});
 }else if(['file','file-describe'].includes(action)){
  exact(input,['caseId','fileId','expectedSha256'],action==='file'?['caseId','fileId','expectedSha256']:['caseId','fileId']);
  route=base+'/files/'+sha(input.fileId);if(action==='file-describe')route+='?describe=1';else sha(input.expectedSha256);
 }else if(['source-file','source-file-describe'].includes(action)){
  exact(input,['caseId','inspectionId','path','expectedSha256'],action==='source-file'?
   ['caseId','inspectionId','path','expectedSha256']:['caseId','inspectionId','path']);
  uuid(input.inspectionId);need(typeof input.path==='string'&&input.path.length>0&&input.path.length<=4096&&!input.path.includes('\0'),
   'Select the full original source member path.');
  route=query(base+'/sources/'+input.inspectionId+'/file',{path:input.path,...(action.endsWith('-describe')?{describe:'1'}:{})});
  if(action==='source-file')sha(input.expectedSha256);
 }else throw fail('Choose a declared original Flowable source operation.');
 return {action,input,route,options};
}
export async function performFlowableSourceOperation(plan,send){
 let options=plan.options,descriptor;
 if(['file','source-file'].includes(plan.action)){
  const description=await send(plan.route+(plan.route.includes('?')?'&':'?')+'describe=1',
   {mutation:false,timeoutMs:1830000,maxResponseBytes:1024*1024});
  descriptor=description.value;
  need(plain(descriptor)&&descriptor.sha256===plan.input.expectedSha256&&
   Number.isSafeInteger(descriptor.bytes)&&descriptor.bytes>=0&&descriptor.bytes<=FLOWABLE_SOURCE_DESK_MAX_FILE,
   'The original file descriptor differs from the selected complete source.');
  options={...options,maxResponseBytes:Math.max(1,descriptor.bytes)};
 }
 const result=await send(plan.route,options);
 if(descriptor)need(result.bytes.length===descriptor.bytes&&result.sha256===descriptor.sha256,
  'The complete original download differs from its retained byte identity.');
 if(plan.options.mutation){
  const requestId=plan.options.originalRequestId;
  need(result.value?.requestId===requestId,'The source operation returned a different original request.');
 }
 return result;
}
