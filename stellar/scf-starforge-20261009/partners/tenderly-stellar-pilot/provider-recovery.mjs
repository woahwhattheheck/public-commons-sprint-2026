// MIT. Saved-provider result review and recovery on the original Tenderly operation.
import { join, resolve } from 'node:path';
import { mkdir, readdir, rename, unlink, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { acquireRunbookMetadataLease } from '../../buyer-runbook/runbook.mjs';
import { privateDirectory, readBytes, writeNew, syncDirectory, json, parse, sha256 } from '../../sf102-cube-paid-query-adapter/onboarding/files.mjs';
import { canonicalOperationJSON } from '../../sf30-seller-sdk/upstream-idempotency.mjs';
import { inspectPlan, providerRequest, describeResult, upstreamBindings, PROVIDER_ORIGIN } from './product.mjs';

const SCHEMA = 'stellar-forge.tenderly-provider-lookup.v1';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const fail = (code, status = 409) => Object.assign(new Error(code), {code,status});
const need = (condition, code, status) => { if (!condition) throw fail(code,status); };
const encoded = value => canonicalOperationJSON(value);
const equal = (a,b) => encoded(a) === encoded(b);
const now = () => new Date().toISOString();
const privateJson = async (path,max=2*1024*1024) => parse(await readBytes(path,{privateFile:true,max}),path);

async function directory(path) {
  await mkdir(path,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  await privateDirectory(path);
  need(await realpath(path)===path,'TENDERLY_LOOKUP_CANONICAL_DIRECTORY_REQUIRED');
  return path;
}
async function atomic(path,data) {
  const temporary=path+'.writing-'+randomUUID();
  try { await writeNew(temporary,data); await rename(temporary,path); await syncDirectory(resolve(path,'..')); }
  finally { await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;}); }
}
async function optional(path,max) {
  try { return await privateJson(path,max); } catch(error) {if(error.code==='ENOENT')return null;throw error;}
}
function retryTime(value,at) {
  if(typeof value!=='string')return null;
  const time=/^[0-9]+$/.test(value)?Date.parse(at)+Number(value)*1000:Date.parse(value);
  return Number.isFinite(time)&&time>=Date.parse(at)?new Date(time).toISOString():null;
}
function summary(observation) {
  if(!observation)return null;
  const {bodyBase64,...visible}=observation;
  return visible;
}

/**
 * All mutations of the merchant stay in operations.recover. Lookup performs the
 * documented POST /simulations/{id} read and retains its complete original bytes.
 */
export function createTenderlyProviderRecovery({plan:rawPlan,stateDirectory,operations,
  env=process.env,upstreamOrigin=PROVIDER_ORIGIN,allowLoopbackUpstream=false}={}) {
  const review=inspectPlan(rawPlan),plan=review.plan,environment={...env};
  upstreamBindings(plan,{stateDirectory,upstreamOrigin,allowLoopbackUpstream});
  const root=join(stateDirectory,'provider-lookups');
  const ready=async()=>{await privateDirectory(stateDirectory);return directory(root);};
  async function requestFor(operationKey) {
    need(HASH.test(operationKey??''),'TENDERLY_LOOKUP_OPERATION_REQUIRED',400);
    const request=await operations.request(operationKey);
    need(request&&request.operationKey===operationKey&&HASH.test(request.requestHash??''),
      'TENDERLY_REQUEST_RECORD_NOT_FOUND',404);
    providerRequest(plan,request.body);
    const current=await operations.inspect(operationKey);
    need(current&&current.requestHash===request.requestHash,'TENDERLY_REQUEST_RECORD_MISMATCH');
    return {request,current};
  }
  function bindingFor(request,simulationId) {
    need(ID.test(simulationId??''),'TENDERLY_SIMULATION_ID_REQUIRED',400);
    return {schema:SCHEMA,planSha256:review.planSha256,operationKey:request.operationKey,
      requestHash:request.requestHash,requestSha256:sha256(encoded(providerRequest(plan,request.body))),
      simulationId,providerUrl:upstreamOrigin+review.provider.path.replace(/\/simulate$/,'/simulations/')+simulationId};
  }
  async function open(id) {
    need(HASH.test(id??''),'TENDERLY_LOOKUP_ID_REQUIRED',400);
    await ready();const path=join(root,id);await privateDirectory(path);
    const intent=await privateJson(join(path,'intent.json'));
    need(intent.schema===SCHEMA&&intent.id===id&&sha256(encoded(intent.binding))===id,'TENDERLY_LOOKUP_IDENTITY_CHANGED');
    const original=await requestFor(intent.binding.operationKey);
    need(equal(intent.binding,bindingFor(original.request,intent.binding.simulationId)),'TENDERLY_LOOKUP_REQUEST_CHANGED');
    return {path,intent,...original};
  }
  function inspectResult(record,request) {
    need(record.httpStatus===200,'TENDERLY_PROVIDER_HTTP_'+record.httpStatus,502);
    need(/^application\/json(?:;|$)/i.test(record.contentType),'TENDERLY_PROVIDER_JSON_REQUIRED',502);
    const bytes=Buffer.from(record.bodyBase64,'base64');
    need(bytes.toString('base64')===record.bodyBase64&&bytes.length===record.responseBytes&&
      sha256(bytes)===record.responseSha256,'TENDERLY_LOOKUP_RESPONSE_CHANGED');
    const result=parse(bytes,'saved provider result'),expected=providerRequest(plan,request.body);
    const described=describeResult({status:record.httpStatus,body:bytes},{plan,body:request.body});
    need(described&&described.simulationId===record.simulationId,'TENDERLY_SAVED_SIMULATION_ID_MISMATCH',422);
    const price=result.simulation?.gas_price;
    need((typeof price==='string'&&/^(0|[1-9][0-9]*)$/.test(price)||
      Number.isSafeInteger(price)&&price>=0)&&BigInt(price)===BigInt(expected.gas_price),
      'TENDERLY_SAVED_GAS_PRICE_MISMATCH',422);
    return {bytes,described};
  }
  async function observationFor(opened,id) {
    need(UUID.test(id??''),'TENDERLY_OBSERVATION_ID_REQUIRED',400);
    const requested=await privateJson(join(opened.path,'observations',id+'.request.json'));
    need(requested.lookupId===opened.intent.id&&requested.observationId===id,'TENDERLY_OBSERVATION_IDENTITY_CHANGED');
    const value=await optional(join(opened.path,'observations',id+'.json'));
    if(!value)return {...requested,state:'RESPONSE_PENDING',description:'The original lookup has not retained a complete response.'};
    need(value.schema===SCHEMA+'.observation'&&value.lookupId===opened.intent.id&&value.observationId===id&&
      value.simulationId===opened.intent.binding.simulationId,'TENDERLY_OBSERVATION_IDENTITY_CHANGED');
    if(value.bodyBase64!==undefined) {
      const bytes=Buffer.from(value.bodyBase64,'base64');
      need(bytes.toString('base64')===value.bodyBase64&&bytes.length===value.responseBytes&&
        sha256(bytes)===value.responseSha256,'TENDERLY_LOOKUP_RESPONSE_CHANGED');
    }
    if(value.state==='MATCHED') {
      const checked=inspectResult(value,opened.request);
      need(equal(checked.described,value.result),'TENDERLY_LOOKUP_REVIEW_CHANGED');
    }
    return value;
  }
  async function observations(opened) {
    const names=(await readdir(join(opened.path,'observations'))).filter(name=>name.endsWith('.request.json'));
    const rows=[];
    for(const name of names) {
      const id=name.slice(0,-'.request.json'.length);
      if(UUID.test(id))rows.push(summary(await observationFor(opened,id)));
    }
    return rows.sort((a,b)=>b.requestedAt.localeCompare(a.requestedAt)||b.observationId.localeCompare(a.observationId));
  }
  async function inspect(id) {
    const opened=await open(id),rows=await observations(opened);
    return {...opened.intent,operation:opened.current,latest:summary(rows[0]),
      observations:rows.map(summary),request:providerRequest(plan,opened.request.body)};
  }
  async function lookup({operationKey,simulationId,refresh=false}={}) {
    need(typeof refresh==='boolean','TENDERLY_LOOKUP_REFRESH_INVALID',400);
    const original=await requestFor(operationKey),binding=bindingFor(original.request,simulationId);
    const id=sha256(encoded(binding));await ready();
    const path=await directory(join(root,id));await directory(join(path,'observations'));await directory(join(path,'reconciliations'));
    const release=await acquireRunbookMetadataLease(path);
    try {
      const previous=await optional(join(path,'intent.json'));
      if(previous)need(previous.id===id&&equal(previous.binding,binding),'TENDERLY_LOOKUP_IDENTITY_CHANGED');
      else await atomic(join(path,'intent.json'),json({schema:SCHEMA,id,binding,createdAt:now()}));
      const opened=await open(id),rows=await observations(opened);
      if(rows.length&&!refresh)return {...await inspect(id),reused:true};
      if(rows[0]?.retryAt&&Date.parse(rows[0].retryAt)>Date.now()) {
        const error=fail('TENDERLY_PROVIDER_RETRY_AFTER',429);error.retryAt=rows[0].retryAt;throw error;
      }
      const accessKey=environment[plan.provider.accessKeyEnv];
      need(typeof accessKey==='string'&&accessKey.length>0&&!/[\r\n]/.test(accessKey),'TENDERLY_ACCESS_KEY_REQUIRED',503);
      const observationId=randomUUID(),requestedAt=now();
      const requested={lookupId:id,observationId,requestedAt};
      await atomic(join(path,'observations',observationId+'.request.json'),json(requested));
      const observed={schema:SCHEMA+'.observation',...requested,simulationId,providerUrl:binding.providerUrl};
      try {
        const response=await fetch(binding.providerUrl,{method:'POST',redirect:'error',
          headers:{'X-Access-Key':accessKey,Accept:'application/json'},signal:AbortSignal.timeout(plan.limits.timeoutMs)});
        observed.httpStatus=response.status;observed.contentType=response.headers.get('content-type')??'';
        observed.retryAfter=response.headers.get('retry-after');observed.retrievedAt=now();
        observed.retryAt=retryTime(observed.retryAfter,observed.retrievedAt);
        const chunks=[];let count=0;const reader=response.body?.getReader();
        need(reader,'TENDERLY_PROVIDER_EMPTY_RESPONSE',502);
        try {
          while(true) {
            const {done,value}=await reader.read();if(done)break;count+=value.length;
            need(count<=plan.limits.maxResponseBytes,'TENDERLY_SAVED_RESULT_EXCEEDS_LIMIT',413);
            chunks.push(value);
          }
        } finally {await reader.cancel().catch(()=>{});}
        const data=Buffer.concat(chunks);
        Object.assign(observed,{bodyBase64:data.toString('base64'),responseBytes:data.length,responseSha256:sha256(data)});
        try {observed.result=inspectResult(observed,opened.request).described;observed.state='MATCHED';}
        catch(error){observed.state=response.status===200?'MISMATCH':'PROVIDER_ERROR';observed.code=error.code??'TENDERLY_SAVED_RESPONSE_INVALID';}
      } catch(error) {
        observed.state='PROVIDER_ERROR';
        observed.code=error.code??(error.name==='TimeoutError'?'TENDERLY_LOOKUP_TIMEOUT':'TENDERLY_LOOKUP_TRANSPORT_FAILED');
      }
      observed.finishedAt=now();
      await atomic(join(path,'observations',observationId+'.json'),json(observed));
      return {...await inspect(id),reused:false};
    } finally {await release();}
  }
  async function list({operationKey,before='',limit=25}={}) {
    await requestFor(operationKey);await ready();
    need(Number.isSafeInteger(limit)&&limit>=1&&limit<=100&&
      (before===''||HASH.test(before)),'TENDERLY_LOOKUP_PAGE_INVALID',400);
    const names=(await readdir(root)).filter(name=>HASH.test(name)&&(!before||name>before)).sort();
    const records=[];let nextCursor=null;
    for(const id of names) {
      const intent=await optional(join(root,id,'intent.json'));
      if(!intent||intent.binding?.operationKey!==operationKey)continue;
      if(records.length===limit){nextCursor=records.at(-1).id;break;}
      const value=await inspect(id);
      records.push({id,simulationId:value.binding.simulationId,createdAt:value.createdAt,
        latest:value.latest,observationCount:value.observations.length});
    }
    return {records,nextCursor};
  }
  async function response({lookupId,observationId}={}) {
    const opened=await open(lookupId),value=await observationFor(opened,observationId);
    need(value.bodyBase64!==undefined,'TENDERLY_LOOKUP_RESPONSE_NOT_RETAINED',404);
    return {bytes:Buffer.from(value.bodyBase64,'base64'),status:value.httpStatus,
      contentType:value.contentType,sha256:value.responseSha256,record:summary(value)};
  }
  async function complete({lookupId,observationId,expectedGeneration,reference}={}) {
    need(Number.isSafeInteger(expectedGeneration)&&expectedGeneration>=1,'TENDERLY_OPERATION_GENERATION_REQUIRED',400);
    need(typeof reference==='string'&&reference.trim().length>=8&&reference.length<=240&&
      !/[\x00-\x1f\x7f]/.test(reference),'TENDERLY_PROVIDER_REFERENCE_REQUIRED',400);
    const initial=await open(lookupId),release=await acquireRunbookMetadataLease(initial.path);
    try {
      const opened=await open(lookupId),observed=await observationFor(opened,observationId);
      need(observed.state==='MATCHED','TENDERLY_MATCHED_PROVIDER_RESULT_REQUIRED');
      const checked=inspectResult(observed,opened.request);
      const command={lookupId,observationId,expectedGeneration,reference:reference.trim(),
        operationKey:opened.request.operationKey,requestHash:opened.request.requestHash,
        responseSha256:observed.responseSha256};
      const commandId=sha256(encoded(command));
      const completedPath=join(opened.path,'reconciliations',commandId+'.json');
      const recorded=await optional(completedPath);
      if(recorded) {
        need(equal(recorded.command,command),'TENDERLY_RECOVERY_RECORD_CHANGED');
        const current=await operations.inspect(command.operationKey),saved=await operations.response(command.operationKey);
        need(current?.state==='COMPLETE'&&saved&&sha256(saved.body)===observed.responseSha256,
          'TENDERLY_RECOVERED_OPERATION_CHANGED');
        return {...recorded,operation:current,reused:true};
      }
      let current=await operations.inspect(command.operationKey),reused=false;
      need(current&&current.requestHash===command.requestHash,'TENDERLY_REQUEST_RECORD_MISMATCH');
      if(current.state==='COMPLETE') {
        const saved=await operations.response(command.operationKey);
        need(saved&&sha256(saved.body)===observed.responseSha256,'TENDERLY_COMPLETE_RESPONSE_DIFFERS');
        reused=true;
      } else {
        await operations.recover({operationKey:command.operationKey,requestHash:command.requestHash,
          expectedGeneration,action:'complete',
          reference:reference.trim()+'; simulation='+observed.simulationId+'; sha256='+observed.responseSha256,
          response:{status:200,headers:{'content-type':observed.contentType},body:checked.bytes}});
        current=await operations.inspect(command.operationKey);
      }
      const saved=await operations.response(command.operationKey);
      need(current?.state==='COMPLETE'&&saved&&sha256(saved.body)===observed.responseSha256,
        'TENDERLY_RECOVERY_RESULT_NOT_RETAINED');
      const result={schema:SCHEMA+'.reconciliation',id:commandId,command,operation:current,completedAt:now(),reused};
      await atomic(completedPath,json(result));return result;
    } finally {await release();}
  }
  return Object.freeze({lookup,inspect,list,response,complete});
}
