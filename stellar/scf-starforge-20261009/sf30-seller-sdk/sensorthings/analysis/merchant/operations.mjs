// SPDX-License-Identifier: MIT
// Bounded transport for the maintained SF47 Operations API; no replacement business engine.
import {readOwned} from '../../../stellar-expert/store.mjs';
import {need,text,absolute,phase,stable,identity,plain} from './common.mjs';
export const CASE=/^operation-[a-f0-9]{32}$/,DEPLOYMENT=/^deployment-[a-f0-9]{32}$/,PURCHASE=/^purchase-[a-f0-9]{32}$/;
export class OperationsConnection{
  constructor(accessUrl,{signal}={}){
    const u=new URL(accessUrl);
    need((u.protocol==='https:'||u.protocol==='http:'&&u.hostname==='127.0.0.1')&&!u.username&&!u.password&&
      u.hash.startsWith('#access=')&&u.hash.length>12,'OPERATIONS_ACCESS','Configure the original private Operations access link.',422);
    this.origin=u.origin;this.token=u.hash.slice(8);this.signal=signal;
  }
  async request(path,body){
    need(/^\/api\/operations(?:\/|$)/.test(path),'OPERATIONS_ROUTE','Use the original Operations route.');
    const timeout=AbortSignal.timeout(60000),signal=this.signal?AbortSignal.any([this.signal,timeout]):timeout,
      response=await fetch(this.origin+path,{method:body===undefined?'GET':'POST',redirect:'error',signal,
        headers:{authorization:'Bearer '+this.token,...(body===undefined?{}:{'content-type':'application/json'})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
    const reader=response.body?.getReader(),parts=[];let bytes=0;
    try{if(reader)while(true){const r=await reader.read();if(r.done)break;bytes+=r.value.length;
      need(bytes<=32*1024*1024,'OPERATIONS_CAPACITY','Use the original bounded Operations response.',413);parts.push(Buffer.from(r.value));}}
    finally{reader?.releaseLock();}
    let value;try{value=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{need(false,'OPERATIONS_RESPONSE','The original Operations response is incomplete.',503);}
    need(response.ok,'OPERATIONS_REJECTED',value?.error?.message??value?.message??'The original Operations request was rejected.',
      response.status,plain(value?.error)?value.error:undefined);return value;
  }
  cases(){return this.request('/api/operations');}
  read(id){need(CASE.test(id),'CASE','Select an original Operations case.',422);return this.request('/api/operations/'+id);}
  preview(id,body){need(CASE.test(id),'CASE','Select an original Operations case.',422);return this.request('/api/operations/'+id+'/buyer-preview',body);}
}
export async function connectionFromRuntime(runtime={}){
  if(!runtime.operationsAccessFile)return null;
  absolute(runtime.operationsAccessFile,'host-selected Operations access file');
  const raw=await readOwned(runtime.operationsAccessFile,16384),access=raw.toString('utf8').trim();
  return new OperationsConnection(access,{signal:runtime.signal});
}
export async function operationsPreview(connection,selection,handoff,caseId){
  need(connection instanceof OperationsConnection,'OPERATIONS_UNCONFIGURED','The host must configure its original Operations connection.',503);
  const current=await connection.read(caseId),preview=await connection.preview(caseId,{expectedVersion:current.program.version,
    filename:'original-sf88-handoff.json',contentBase64:handoff.toString('base64')});
  const row=preview.rows.find(x=>x.jobId===selection.jobId);
  need(row&&row.sourceRecordSha256===selection.row.sourceRecordSha256&&preview.source.sha256===selection.handoff.sha256,
    'OPERATIONS_SOURCE','The original Operations reader returned different native source identities.');
  return {origin:connection.origin,program:current.program,preview,row};
}
export async function originalCommand(store,op,name,connection,build){
  need(connection instanceof OperationsConnection,'OPERATIONS_UNCONFIGURED','Reopen the original configured Operations connection.',503);
  const request=await phase(store,op,name+'-request',build);
  need(CASE.test(request.caseId)&&request.origin===connection.origin&&request.body.requestId===op.operationId+':'+name,
    'OPERATIONS_REQUEST','The original command ID, case or receiving origin changed.');
  const receipt=await phase(store,op,name+'-receipt',async()=>({requestSha256:identity(request),
    result:await connection.request('/api/operations/'+request.caseId+'/command',request.body)}));
  need(receipt.requestSha256===identity(request),'OPERATIONS_RECEIPT','The saved native result belongs to another original request.');
  return receipt.result;
}
export function validateOperations(value){
  if(value===undefined||value===null)return null;
  need(plain(value)&&Object.keys(value).every(k=>['caseId','deploymentId','purchaseId','expectedCaseVersion','expectedPreviewSha256','origin'].includes(k))&&
    CASE.test(value.caseId)&&DEPLOYMENT.test(value.deploymentId)&&(!value.purchaseId||PURCHASE.test(value.purchaseId))&&
    Number.isSafeInteger(value.expectedCaseVersion)&&value.expectedCaseVersion>=1&&/^[a-f0-9]{64}$/.test(value.expectedPreviewSha256??''),
    'OPERATIONS_SELECTION','Keep the exact case, buyer deployment, purchase choice, version and original preview together.',422);
  const u=new URL(value.origin);need(u.origin===value.origin&&(u.protocol==='https:'||u.protocol==='http:'&&u.hostname==='127.0.0.1'),
    'OPERATIONS_ORIGIN','Select the actual configured Operations origin.',422);return structuredClone(value);
}
