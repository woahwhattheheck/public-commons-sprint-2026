// MIT. Retained read-only collection over the original SF86 verifier and SF82 records.
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir,open,lstat,realpath,readdir,rm} from 'node:fs/promises';
import {isAbsolute,resolve,dirname,join} from 'node:path';
import {originalRecordFromEvidence} from './cli.mjs';
import {checkOriginalTerms,rpcNetwork,ReconciliationError,requireTruth,object} from './terms.mjs';
import {reconcileRpc} from './verify.mjs';
import {createOfficialEventDecoder} from '../sf43-agent-commerce/verify.mjs';
import {withDeliveryLease} from '../sf98-merchant-delivery/delivery-lock.mjs';
import {exclusiveFile,publish} from './private-files.mjs';

export const PLAN_SCHEMA='stellar-forge.sf86.collection-plan.v1';
export const BATCH_SCHEMA='stellar-forge.sf86.collection.v1';
const RESULT_SCHEMA='stellar-forge.sf86.rpc-reconciliation.v1';
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const HEX=/^[0-9a-f]{64}$/;
const sha=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const kindOk=kind=>kind==='sf81-record'||kind==='sf82-evidence';
const fileKey=id=>sha(id);
const now=()=>new Date().toISOString();
const fail=code=>{throw new ReconciliationError(code);};
const absolute=path=>requireTruth(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&path!=='/',
  'ABSOLUTE_NORMALIZED_PATH_REQUIRED');

async function directory(path) {
  absolute(path);
  const info=await lstat(path);
  requireTruth(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077)&&
    await realpath(path)===path,'PRIVATE_COLLECTION_DIRECTORY_REQUIRED');
}
async function plain(path,max=4_000_000) {
  absolute(path);
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    const info=await handle.stat();
    requireTruth(info.isFile()&&info.size>0&&info.size<=max,'COLLECTION_SOURCE_SIZE_OR_TYPE_INVALID');
    const bytes=await handle.readFile();
    requireTruth(bytes.length>0&&bytes.length<=max,'COLLECTION_SOURCE_SIZE_OR_TYPE_INVALID');
    return bytes;
  } finally {await handle.close();}
}
function parse(bytes) {
  try{return JSON.parse(bytes.toString('utf8'));}
  catch{fail('COLLECTION_SOURCE_INVALID_JSON');}
}
function original(bytes,kind) {
  requireTruth(kindOk(kind),'COLLECTION_SOURCE_KIND_INVALID');
  const value=parse(bytes);
  return kind==='sf82-evidence'?originalRecordFromEvidence(value):value;
}
function expectedJob(job) {
  requireTruth(object(job)&&typeof job.id==='string'&&ID.test(job.id)&&job.fileKey===fileKey(job.id)&&
    HEX.test(job.sourceSha256)&&kindOk(job.kind)&&typeof job.payer==='string'&&
    Number.isSafeInteger(job.maxEventPages)&&job.maxEventPages>=1&&job.maxEventPages<=100,
  'COLLECTION_JOB_INVALID');
  rpcNetwork(job.network,job.rpcEndpoint);
}

/** Snapshot explicitly selected original operator files once, before network reads. */
export async function prepareBatch({planFile,directory:target}) {
  absolute(target);absolute(planFile);
  requireTruth(await realpath(dirname(target))===dirname(target),'COLLECTION_PARENT_MUST_BE_CANONICAL');
  const planBytes=await plain(planFile,1_000_000),plan=parse(planBytes);
  requireTruth(object(plan)&&plan.schema===PLAN_SCHEMA&&Array.isArray(plan.jobs)&&
    plan.jobs.length>0&&plan.jobs.length<=2000,'COLLECTION_PLAN_INVALID');
  const ids=new Set(),prepared=[];
  for(const input of plan.jobs) {
    requireTruth(object(input)&&typeof input.id==='string'&&ID.test(input.id)&&!ids.has(input.id),
      'COLLECTION_JOB_ID_INVALID_OR_DUPLICATE');
    ids.add(input.id);
    const bytes=await plain(input.sourceFile),record=original(bytes,input.kind);
    const terms=checkOriginalTerms(record,input.payer);
    const profile=rpcNetwork(terms.requirement.network,input.rpcEndpoint);
    const job={id:input.id,fileKey:fileKey(input.id),kind:input.kind,
      sourceSha256:sha(bytes),payer:input.payer,network:terms.requirement.network,
      intentId:terms.intentId,transaction:terms.receipt.transaction,rpcEndpoint:profile.endpoint,
      maxEventPages:input.maxEventPages??24};
    expectedJob(job);prepared.push({job,sourceFile:input.sourceFile});
  }
  // Finish all input review before claiming the create-only output directory.
  await mkdir(target,{mode:0o700});
  try {
    await directory(target);
    await mkdir(join(target,'sources'),{mode:0o700});
    await mkdir(join(target,'attempts'),{mode:0o700});
    const manifest={schema:BATCH_SCHEMA,batchId:randomUUID(),createdAt:now(),
      planSha256:sha(planBytes),jobs:prepared.map(item=>item.job)};
    await exclusiveFile(join(target,'plan.json'),planBytes);
    for(const {job,sourceFile} of prepared) {
      const bytes=await plain(sourceFile);
      requireTruth(sha(bytes)===job.sourceSha256,'COLLECTION_SOURCE_CHANGED_DURING_PREPARATION');
      await exclusiveFile(join(target,'sources',job.fileKey+'.json'),bytes);
      await mkdir(join(target,'attempts',job.fileKey),{mode:0o700});
    }
    await publish(join(target,'batch.json'),json(manifest));
    return summary(target,manifest,manifest.jobs.map(job=>jobStatus(job,null)));
  } catch(error) {await rm(target,{recursive:true,force:true});throw error;}
}

async function readBatch(target) {
  await directory(target);await directory(join(target,'sources'));await directory(join(target,'attempts'));
  const batch=parse(await plain(join(target,'batch.json'),2_000_000));
  requireTruth(batch.schema===BATCH_SCHEMA&&typeof batch.batchId==='string'&&
    /^[a-f0-9-]{36}$/.test(batch.batchId)&&HEX.test(batch.planSha256)&&
    Array.isArray(batch.jobs)&&batch.jobs.length>0&&batch.jobs.length<=2000,'COLLECTION_MANIFEST_INVALID');
  const ids=new Set();
  for(const job of batch.jobs) {
    expectedJob(job);
    requireTruth(!ids.has(job.id),'COLLECTION_JOB_ID_INVALID_OR_DUPLICATE');ids.add(job.id);
  }
  const planBytes=await plain(join(target,'plan.json'),1_000_000),plan=parse(planBytes);
  requireTruth(sha(planBytes)===batch.planSha256&&plan.schema===PLAN_SCHEMA&&
    Array.isArray(plan.jobs)&&plan.jobs.length===batch.jobs.length,'COLLECTION_PLAN_CHANGED');
  for(let i=0;i<batch.jobs.length;i++) {
    const job=batch.jobs[i],input=plan.jobs[i];
    requireTruth(object(input)&&input.id===job.id&&input.kind===job.kind&&input.payer===job.payer&&
      (input.maxEventPages??24)===job.maxEventPages&&
      rpcNetwork(job.network,input.rpcEndpoint).endpoint===job.rpcEndpoint,'COLLECTION_PLAN_JOB_CHANGED');
  }
  return batch;
}
async function sourceRecord(target,job) {
  const bytes=await plain(join(target,'sources',job.fileKey+'.json'));
  requireTruth(sha(bytes)===job.sourceSha256,'COLLECTION_SOURCE_CHANGED');
  const record=original(bytes,job.kind),terms=checkOriginalTerms(record,job.payer);
  requireTruth(terms.intentId===job.intentId&&terms.requirement.network===job.network&&
    terms.receipt.transaction===job.transaction,'COLLECTION_RECORD_BINDING_CHANGED');
  return record;
}
async function latest(target,batch,job) {
  const root=join(target,'attempts',job.fileKey);await directory(root);
  const entries=(await readdir(root)).filter(name=>!/^\.collect-[a-f0-9-]{36}\.tmp$/.test(name)).sort();
  requireTruth(entries.length<=1000,'COLLECTION_TOO_MANY_ATTEMPTS');
  let prior=null;
  for(let i=0;i<entries.length;i++) {
    const name=String(i+1).padStart(6,'0')+'.json';
    requireTruth(entries[i]===name,'COLLECTION_ATTEMPT_SEQUENCE_INVALID');
    const bytes=await plain(join(root,name),80_000),value=parse(bytes),c=value.collector;
    requireTruth(value.schema===RESULT_SCHEMA&&object(c)&&c.schema===BATCH_SCHEMA&&
      c.batchId===batch.batchId&&c.jobId===job.id&&c.sourceSha256===job.sourceSha256&&
      c.planSha256===batch.planSha256&&c.attempt===i+1&&
      c.previousResultSha256===(prior?.sha256??null)&&value.intentId===job.intentId&&
      value.network===job.network&&value.transaction===job.transaction&&
      value.payer===job.payer&&value.rpcEndpoint===job.rpcEndpoint&&
      ['NOT_RECONCILED','LOCAL_RPC_REPLAY_MATCHED','CHAIN_TRANSFER_MATCHED_RPC_TESTNET',
        'CHAIN_TRANSFER_MATCHED_RPC_PUBNET'].includes(value.verdict),
    'COLLECTION_RESULT_BINDING_INVALID');
    prior={value,bytes,sha256:sha(bytes),attempt:i+1};
  }
  return prior;
}
function jobStatus(job,result) {
  return {id:job.id,intentId:job.intentId,network:job.network,rpcEndpoint:job.rpcEndpoint,
    sourceSha256:job.sourceSha256,attempts:result?.attempt??0,
    verdict:result?.value.verdict??'UNATTEMPTED',reason:result?.value.reason??null,
    resultSha256:result?.sha256??null};
}
function summary(target,batch,jobs,extra={}) {
  return {schema:BATCH_SCHEMA,directory:target,batchId:batch.batchId,planSha256:batch.planSha256,
    jobs,totals:{jobs:jobs.length,unattempted:jobs.filter(x=>x.verdict==='UNATTEMPTED').length,
      reconciled:jobs.filter(x=>x.verdict.startsWith('CHAIN_TRANSFER_MATCHED_RPC_')).length,
      localReplays:jobs.filter(x=>x.verdict==='LOCAL_RPC_REPLAY_MATCHED').length,
      unresolved:jobs.filter(x=>x.verdict==='NOT_RECONCILED').length},...extra};
}
export async function inspectBatch({directory:target}) {
  const batch=await readBatch(target),jobs=[];
  for(const job of batch.jobs) {
    await sourceRecord(target,job);
    jobs.push(jobStatus(job,await latest(target,batch,job)));
  }
  return summary(target,batch,jobs);
}

/** Resume unattempted jobs, or explicitly refresh selected unsuccessful reads. */
export async function collectBatch({directory:target,retryIds=[],fetchImpl=fetch,
  decodeContractEvent,signal,onResult}={}) {
  const batch=await readBatch(target);
  requireTruth(Array.isArray(retryIds)&&new Set(retryIds).size===retryIds.length&&
    retryIds.every(id=>batch.jobs.some(job=>job.id===id)),'COLLECTION_RETRY_IDS_INVALID');
  try {
    // Original Linux kernel-backed lock releases on process death. It belongs
    // to this collection directory; the merchant outbox is never locked here.
    return await withDeliveryLease(target,async()=>{
      const states=new Map();
      for(const job of batch.jobs) {
        await sourceRecord(target,job);
        states.set(job.id,await latest(target,batch,job));
      }
      for(const id of retryIds)requireTruth(states.get(id)?.value.verdict==='NOT_RECONCILED',
        'COLLECTION_RETRY_REQUIRES_UNRESOLVED_RESULT');
      const work=batch.jobs.filter(job=>retryIds.length?retryIds.includes(job.id):!states.get(job.id));
      for(const job of work)requireTruth((states.get(job.id)?.attempt??0)<1000,
        'COLLECTION_TOO_MANY_ATTEMPTS');
      let decoder=decodeContractEvent;
      if(work.length&&!signal?.aborted&&!decoder) {
        try{decoder=await createOfficialEventDecoder();}
        catch{fail('STELLAR_SDK_DECODER_UNAVAILABLE');}
      }
      let attempted=0,cancelled=Boolean(signal?.aborted);
      for(const job of work) {
        if(signal?.aborted){cancelled=true;break;}
        const record=await sourceRecord(target,job),prior=states.get(job.id);
        let value;
        try {
          value=await reconcileRpc({record,payer:job.payer,rpcEndpoint:job.rpcEndpoint,
            maxEventPages:job.maxEventPages,fetchImpl,decodeContractEvent:decoder,signal});
        } catch(error) {
          if(signal?.aborted||error.code==='RECONCILIATION_CANCELLED'){cancelled=true;break;}
          value={schema:RESULT_SCHEMA,verdict:'NOT_RECONCILED',
            reason:error instanceof ReconciliationError?error.code:'RECONCILIATION_EXECUTION_FAILED',
            intentId:job.intentId,network:job.network,transaction:job.transaction,payer:job.payer,
            rpcEndpoint:job.rpcEndpoint,reservation:'UNCHANGED_VERIFY_SEPARATELY'};
        }
        const attempt=(prior?.attempt??0)+1;
        value.collector={schema:BATCH_SCHEMA,batchId:batch.batchId,jobId:job.id,
          sourceSha256:job.sourceSha256,planSha256:batch.planSha256,attempt,
          completedAt:now(),previousResultSha256:prior?.sha256??null};
        const bytes=Buffer.from(json(value));
        await publish(join(target,'attempts',job.fileKey,String(attempt).padStart(6,'0')+'.json'),bytes);
        const result={value,bytes,sha256:sha(bytes),attempt};states.set(job.id,result);attempted++;
        if(onResult)await onResult(jobStatus(job,result));
      }
      return summary(target,batch,batch.jobs.map(job=>jobStatus(job,states.get(job.id))),
        {attempted,cancelled:cancelled||Boolean(signal?.aborted)});
    },{purpose:'drain'});
  } catch(error) {if(error.code==='SF98_DELIVERY_BUSY')fail('COLLECTION_BUSY');throw error;}
}

/** Export one current original SF86 result per job for the existing accounting reader. */
export async function exportBatch({directory:target,output}) {
  absolute(output);
  requireTruth(output!==target&&!output.startsWith(target+'/'),'COLLECTION_EXPORT_MUST_BE_SEPARATE');
  requireTruth(await realpath(dirname(output))===dirname(output),'COLLECTION_PARENT_MUST_BE_CANONICAL');
  return withDeliveryLease(target,async()=>{
    const batch=await readBatch(target),selected=[];
    for(const job of batch.jobs) {
      await sourceRecord(target,job);
      const result=await latest(target,batch,job);
      if(result)selected.push({job,result});
    }
    await mkdir(output,{mode:0o700});
    try {
      await directory(output);const proofs=join(output,'proofs');await mkdir(proofs,{mode:0o700});
      for(const {job,result} of selected)await exclusiveFile(join(proofs,job.fileKey+'.json'),result.bytes);
      const manifest={schema:'stellar-forge.sf86.collection-export.v1',batchId:batch.batchId,
        planSha256:batch.planSha256,createdAt:now(),unattempted:batch.jobs.length-selected.length,
        files:selected.map(({job,result})=>({jobId:job.id,path:'proofs/'+job.fileKey+'.json',
          sha256:result.sha256,sourceSha256:job.sourceSha256,attempt:result.attempt,verdict:result.value.verdict}))};
      await publish(join(output,'manifest.json'),json(manifest));
      return {...manifest,output,proofDirectory:proofs};
    } catch(error){await rm(output,{recursive:true,force:true});throw error;}
  },{purpose:'drain'});
}

/** Reopen exactly the exported attempt set, including an earlier retained view. */
export async function inspectBatchExport({directory:target,output}) {
  await directory(output);await directory(join(output,'proofs'));
  const batch=await readBatch(target),bytes=await plain(join(output,'manifest.json'),2_000_000);
  const manifest=parse(bytes);
  requireTruth(manifest.schema==='stellar-forge.sf86.collection-export.v1'&&
    manifest.batchId===batch.batchId&&manifest.planSha256===batch.planSha256&&
    Array.isArray(manifest.files)&&manifest.files.length<=batch.jobs.length&&
    manifest.unattempted===batch.jobs.length-manifest.files.length,'COLLECTION_EXPORT_MANIFEST_INVALID');
  const ids=new Set(),names=new Set();
  for(const file of manifest.files) {
    const job=batch.jobs.find(item=>item.id===file.jobId);
    requireTruth(job&&!ids.has(job.id)&&file.path==='proofs/'+job.fileKey+'.json'&&
      file.sourceSha256===job.sourceSha256&&HEX.test(file.sha256)&&
      Number.isSafeInteger(file.attempt)&&file.attempt>=1&&file.attempt<=1000,
    'COLLECTION_EXPORT_ENTRY_INVALID');
    ids.add(job.id);names.add(job.fileKey+'.json');
    await sourceRecord(target,job);await latest(target,batch,job);
    const originalBytes=await plain(join(target,'attempts',job.fileKey,String(file.attempt).padStart(6,'0')+'.json'),80_000);
    const proof=await plain(join(output,file.path),80_000);
    requireTruth(sha(originalBytes)===file.sha256&&sha(proof)===file.sha256&&
      parse(proof).verdict===file.verdict,'COLLECTION_EXPORT_PROOF_CHANGED');
  }
  const actual=await readdir(join(output,'proofs'));
  requireTruth(actual.length===names.size&&actual.every(name=>names.has(name)),'COLLECTION_EXPORT_FILES_CHANGED');
  return {...manifest,output,proofDirectory:join(output,'proofs'),manifestSha256:sha(bytes)};
}
