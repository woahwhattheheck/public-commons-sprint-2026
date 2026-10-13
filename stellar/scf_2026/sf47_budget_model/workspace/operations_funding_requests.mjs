/** Exact original funding-save requests and accepted results across browser reopen. */
const SCHEMA='stellar-forge.sf47-cost-funding.browser-request.v1';
const DOMAIN='stellar-forge.sf47-operations.v1';
const HASH=/^[a-f0-9]{64}$/, ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const check=(value,message)=>{if(!value)throw Error(message);};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
export const fundingCanonical=value=>JSON.stringify((function order(v){
  return Array.isArray(v)?v.map(order):object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,order(v[k])])):v;
})(value));
export const fundingEqual=(a,b)=>fundingCanonical(a)===fundingCanonical(b);
export async function fundingHash(value){
  const bytes=new TextEncoder().encode(fundingCanonical(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
const keys=(value,expected)=>object(value)&&fundingEqual(Object.keys(value).sort(),[...expected].sort());
const clone=value=>structuredClone(value);

export function createFundingRequests({caseId,caseCreatedAt,call,memory={},available=()=>true,storage=localStorage,storageNamespace='',validateActor=()=>{}}){
  const scope={caseId,caseCreatedAt}, prefix=(storageNamespace?storageNamespace+':':'')+SCHEMA+':'+encodeURIComponent(caseId)+':'+encodeURIComponent(caseCreatedAt)+':';
  memory.records=Object.assign(Object.create(null),memory.records||{});
  const name=(id,kind)=>prefix+id+':'+kind;
  function read(id,kind){
    const entry=memory.records[id] ||= {};
    const raw=storage.getItem(name(id,kind));
    const disk=raw===null?null:JSON.parse(raw);
    if(disk!==null&&entry[kind]!==undefined)
      check(fundingEqual(disk,entry[kind]),'The retained original '+kind+' differs between this view and browser storage.');
    if(disk!==null)entry[kind]=disk;
    return entry[kind]??null;
  }
  function retain(id,kind,value){
    const old=read(id,kind);
    check(old===null||fundingEqual(old,value),'The original '+kind+' cannot be replaced.');
    // Keep an observed result in memory even when the browser cannot persist it.
    (memory.records[id] ||= {})[kind]=clone(value);
    const raw=JSON.stringify(value);
    storage.setItem(name(id,kind),raw);
    check(storage.getItem(name(id,kind))===raw,'The browser could not retain the complete original '+kind+'. Download recovery before leaving.');
  }
  async function prepared(value){
    check(keys(value,['schema','caseId','caseCreatedAt','request','fingerprint','reportSha256','preparedAt'])
      &&value.schema===SCHEMA&&value.caseId===caseId&&value.caseCreatedAt===caseCreatedAt
      &&HASH.test(value.fingerprint)&&HASH.test(value.reportSha256)&&typeof value.preparedAt==='string',
      'This funding request belongs to a different original case.');
    const r=value.request;
    check(keys(r,['expectedVersion','requestId','actor','note','action','data'])
      &&Number.isInteger(r.expectedVersion)&&r.expectedVersion>=1&&ID.test(r.requestId)
      &&typeof r.actor==='string'&&r.actor.trim()&&typeof r.note==='string'&&r.note.trim()
      &&r.action==='funding.save'&&keys(r.data,['inputs','expectedPreviewSha256'])
      &&HASH.test(r.data.expectedPreviewSha256)&&keys(r.data.inputs,['expectedRevision','document'])
      &&Number.isInteger(r.data.inputs.expectedRevision)&&r.data.inputs.expectedRevision>=0
      &&object(r.data.inputs.document),
      'Keep the complete original operator, request, source revision and reviewed funding input.');
    check(await fundingHash({domain:DOMAIN,programId:caseId,body:r})===value.fingerprint,
      'The complete original request fingerprint changed.');
    return value;
  }
  async function result(value,p){
    check(object(value)&&value.id===caseId&&value.action==='funding.save'&&value.kind==='source'
      &&value.version===p.request.expectedVersion+1&&/^source-[a-f0-9]{32}$/.test(value.recordId)
      &&object(value.funding)&&value.funding.sourceId===value.recordId
      &&value.funding.caseVersion===value.version
      &&value.funding.revision===p.request.data.inputs.expectedRevision+1
      &&value.funding.reportSha256===p.reportSha256
      &&HASH.test(value.funding.sourceSha256)&&HASH.test(value.funding.editionSha256),
      'The original funding acknowledgment differs from the prepared source and edition.');
    return value;
  }
  async function proof(value,p){
    check(keys(value,['prepared','result','resultSha256'])&&fundingEqual(value.prepared,p)
      &&HASH.test(value.resultSha256),'The retained accepted response belongs to another request.');
    await result(value.result,p);
    check(await fundingHash(value.result)===value.resultSha256,'The complete accepted response changed.');
    return value;
  }
  async function evidence(p){
    await prepared(p);
    const id=p.request.requestId;
    const outgoing=read(id,'request');
    check(outgoing===null||fundingEqual(outgoing,p),'The original prepared request changed.');
    const returned=read(id,'returned'), accepted=read(id,'accepted');
    if(returned!==null)await proof(returned,p);
    if(accepted!==null)await proof(accepted,p);
    check(returned===null||accepted===null||fundingEqual(returned,accepted),
      'The retained returned and accepted responses differ.');
    return accepted??returned;
  }
  async function inventory(){
    const ids=new Set(Object.keys(memory.records));
    for(let i=0;i<storage.length;i++){
      const key=storage.key(i);if(!key?.startsWith(prefix))continue;
      const tail=key.slice(prefix.length), split=tail.lastIndexOf(':');
      if(split>0&&ID.test(tail.slice(0,split)))ids.add(tail.slice(0,split));
    }
    const records=[];
    for(const id of ids){
      let p=read(id,'request');
      const returned=read(id,'returned'), accepted=read(id,'accepted');
      if(p===null)p=accepted?.prepared??returned?.prepared??null;
      if(p===null)continue;
      await prepared(p);check(p.request.requestId===id,'A retained request has another storage identity.');
      const found=await evidence(p),closed=read(id,'closed'),rejected=read(id,'rejected');
      if(closed!==null){
        check(found&&keys(closed,['fingerprint','resultSha256'])&&closed.fingerprint===p.fingerprint
          &&closed.resultSha256===found.resultSha256,'The original completed request lacks its exact accepted result.');
      }
      records.push({prepared:p,proof:found,closed:closed!==null,rejected});
    }
    return records.sort((a,b)=>a.prepared.preparedAt.localeCompare(b.prepared.preparedAt)
      ||a.prepared.request.requestId.localeCompare(b.prepared.request.requestId));
  }
  async function open(){
    return (await inventory()).filter(row=>!row.closed);
  }
  async function prepare(request,reportSha256){
    validateActor(request);
    check(available(),'Open the original selected case before preparing a save.');
    check(!(await pending()).length,'Reconcile the retained original funding request before preparing another.');
    const p={schema:SCHEMA,...scope,request:clone(request),
      fingerprint:await fundingHash({domain:DOMAIN,programId:caseId,body:request}),
      reportSha256,preparedAt:new Date().toISOString()};
    await prepared(p);retain(request.requestId,'request',p);return p;
  }
  async function lookup(p){
    const prior=await evidence(p);
    const native=await call('/api/operations/'+caseId+'/cost-funding/request?requestId='+encodeURIComponent(p.request.requestId));
    check(native?.caseId===caseId&&native.caseCreatedAt===caseCreatedAt
      &&native.requestId===p.request.requestId&&typeof native.found==='boolean',
      'The original case or request journal changed.');
    // Recheck memory and durable returned-only proof after the awaited read.
    const latest=await evidence(p);
    check(!prior||latest&&fundingEqual(prior,latest),'The accepted evidence changed during original recovery.');
    if(!native.found){
      check(!latest,'This restored workspace lacks the accepted original funding save. Restore matching state; this request will not be resubmitted.');
      return null;
    }
    check(native.fingerprint===p.fingerprint,'The original request was committed with different complete inputs.');
    await result(native.result,p);
    check(native.resultSha256===await fundingHash(native.result),'The original response digest differs.');
    const observed={prepared:p,result:native.result,resultSha256:native.resultSha256};
    if(latest)check(fundingEqual(observed,latest),'The original committed result differs from the retained accepted result.');
    retain(p.request.requestId,'request',p);
    retain(p.request.requestId,'returned',observed);
    retain(p.request.requestId,'accepted',observed);
    return native.result;
  }
  async function complete(p,value){
    const found=await evidence(p);
    check(found&&fundingEqual(found.result,value),'Retain the original accepted result before closing the request.');
    retain(p.request.requestId,'closed',{fingerprint:p.fingerprint,resultSha256:found.resultSha256});
  }
  async function dispatch(p){
    let recovered=await lookup(p);if(recovered){await complete(p,recovered);return recovered;}
    check(available(),'Return to the original selected case to continue this retained save.');
    check(!(await evidence(p)),'Keep the accepted original response; do not resubmit.');
    check(read(p.request.requestId,'rejected')===null,
      'This request has a definite rejection. Retain it, refresh the current source and prepare a reviewed successor.');
    validateActor(p.request);
    retain(p.request.requestId,'request',p);
    let returned;
    try{returned=await call('/api/operations/'+caseId+'/command',clone(p.request));}
    catch(error){
      const status=Number(error.status??error.statusCode??error.details?.status);
      if([400,409,422].includes(status)&&error.code!=='REQUEST_CONFLICT'&&!await evidence(p))
        retain(p.request.requestId,'rejected',{status,code:error.code??null,message:String(error.message)});
      throw error;
    }
    const observed={prepared:p,result:returned,resultSha256:await fundingHash(returned)};
    retain(p.request.requestId,'returned',observed);
    await result(returned,p);
    retain(p.request.requestId,'accepted',observed);
    recovered=await lookup(p);
    check(recovered,'Keep the accepted response until the original journal is available.');
    await complete(p,recovered);return recovered;
  }
  async function retireRejected(p){
    const recovered=await lookup(p);
    if(recovered){await complete(p,recovered);return recovered;}
    check(!await evidence(p)&&read(p.request.requestId,'rejected')!==null,
      'Only an original definite rejection can release this prepared request.');
    // A rejection is retained in full; only this explicit local retirement hides it from pending.
    retain(p.request.requestId,'retired',{fingerprint:p.fingerprint,reason:'definite_rejection'});
    return null;
  }
  async function pending(){
    return (await open()).filter(row=>{
      const retired=read(row.prepared.request.requestId,'retired');
      if(retired!==null)check(row.rejected&&!row.proof&&fundingEqual(retired,{fingerprint:row.prepared.fingerprint,reason:'definite_rejection'}),
        'The retired request has no original definite rejection.');
      return retired===null;
    });
  }
  async function exportRecovery(){
    return {schema:SCHEMA+'.recovery',...scope,records:(await inventory()).map(row=>({
      prepared:row.prepared,returned:read(row.prepared.request.requestId,'returned'),
      accepted:read(row.prepared.request.requestId,'accepted')
    }))};
  }
  async function importRecovery(value){
    check(keys(value,['schema','caseId','caseCreatedAt','records'])&&value.schema===SCHEMA+'.recovery'
      &&value.caseId===caseId&&value.caseCreatedAt===caseCreatedAt&&Array.isArray(value.records)&&value.records.length<=500,
      'Choose the complete original case request recovery.');
    const seen=new Set();
    // Validate the complete input before publishing any actionable request.
    for(const row of value.records){
      check(keys(row,['prepared','returned','accepted']),'Keep complete original request proof fields.');
      await prepared(row.prepared);const id=row.prepared.request.requestId;
      check(!seen.has(id),'The recovery repeats an original request.');seen.add(id);
      if(row.returned!==null)await proof(row.returned,row.prepared);
      if(row.accepted!==null)await proof(row.accepted,row.prepared);
      if(row.returned===null&&row.accepted===null)validateActor(row.prepared.request);
      check(row.returned===null||row.accepted===null||fundingEqual(row.returned,row.accepted),
        'The imported original returned and accepted results differ.');
    }
    for(const row of value.records){
      const id=row.prepared.request.requestId;
      if(row.returned!==null)retain(id,'returned',row.returned);
      if(row.accepted!==null)retain(id,'accepted',row.accepted);
      retain(id,'request',row.prepared);
    }
    // Imported closure/rejection flags are deliberately not accepted.
    return pending();
  }
  return {prepare,lookup,dispatch,complete,pending,retireRejected,exportRecovery,importRecovery,evidence};
}
