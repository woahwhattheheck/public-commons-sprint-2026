// MIT. Follow resolution using one original retained paid-job buyer and its capability.
import {join} from 'node:path';
import {constants} from 'node:fs';
import {open,link,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {openJobBuyer} from '../../../sf30-seller-sdk/jobs/buyer.mjs';
import {createPublicHttpsFetch} from '../../../sf31-buyer-client/public-transport.mjs';
import {acquireStateLease} from '../../../merchant-fleet-gateway/state-lease.mjs';
import {need,id,text,revision,copy,now,hash,json,requestHash,same,validateReceipt,RESOLUTION_DOCUMENT_BYTES,RESOLUTION_RECEIPT_BYTES,RESOLUTION_RECEIVING_BYTES} from '../../../sf30-seller-sdk/jobs/resolution/contract.mjs';
import {privateDirectory,readPrivate,readDocument,writeDocument} from '../../../sf30-seller-sdk/jobs/resolution/storage.mjs';

export const BUYER_RESOLUTION_SCHEMA='stellar-forge.job-resolution-buyer.v1';
export const BUYER_RESOLUTION_EXPORT='stellar-forge.job-resolution-buyer-export.v1';
export const BUYER_RESOLUTION_RECEIVING_BYTES=RESOLUTION_RECEIVING_BYTES;
const MAX_BYTES=RESOLUTION_RECEIPT_BYTES;
const safe=e=>({code:/^[A-Z][A-Z0-9_]{0,100}$/.test(e?.code??'')?e.code:'JOB_RESOLUTION_CUSTOMER_FAILED'});
const projection=r=>({...r,jobState:undefined});
async function retainBytes(directory,bytes){
  const digest=hash(bytes),path=join(directory,digest+'.json'),old=await readPrivate(path,MAX_BYTES,{optional:true});
  if(old){need(old.equals(bytes),'JOB_RESOLUTION_RETAINED_RECEIPT_CHANGED',409);return {file:digest+'.json',sha256:digest,bytes:bytes.length};}
  const stage=join(directory,'.'+randomUUID()+'.pending');
  try{
    const handle=await open(stage,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
    try{await link(stage,path);}catch(e){if(e.code!=='EEXIST')throw e;need((await readPrivate(path,MAX_BYTES)).equals(bytes),'JOB_RESOLUTION_RETAINED_RECEIPT_CHANGED',409);}
    const dir=await open(directory,'r');try{await dir.sync();}finally{await dir.close();}
    return {file:digest+'.json',sha256:digest,bytes:bytes.length};
  }finally{await unlink(stage).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
export async function openJobResolutionBuyer({directory,transport,fetchImpl,requestTimeoutMs=60000}={}){
  const buyer=await openJobBuyer({directory,transport,fetchImpl,requestTimeoutMs});
  directory=buyer.directory;
  const original=await readDocument(join(directory,'buyer.json'),{max:65536}),purchase=await buyer.receipt();
  need(original.acceptanceSha256===purchase.acceptanceSha256&&/^[a-f0-9]{64}$/.test(original.purchaseSha256??'')&&
    /^[A-Za-z0-9_-]{43,128}$/.test(original.claimToken??''),'JOB_RESOLUTION_ORIGINAL_BUYER_CHANGED',409);
  const stateDirectory=await privateDirectory(join(directory,'resolution'));
  const receiptDirectory=await privateDirectory(join(stateDirectory,'receipts'));
  const lease=await acquireStateLease(stateDirectory);
  let closing=false,closePromise,tail=Promise.resolve();
  const controllers=new Set();
  try{
    const statePath=join(stateDirectory,'follow-through.json');
    let state=await readDocument(statePath,{optional:true});
    if(!state)state={schema:BUYER_RESOLUTION_SCHEMA,jobId:buyer.jobId,acceptanceSha256:original.acceptanceSha256,
      purchaseSha256:original.purchaseSha256,createdAt:now(),updatedAt:now(),receipt:null,operations:[]};
    need(state.schema===BUYER_RESOLUTION_SCHEMA&&state.jobId===buyer.jobId&&
      state.acceptanceSha256===original.acceptanceSha256&&state.purchaseSha256===original.purchaseSha256&&
      Array.isArray(state.operations)&&state.operations.length<=1000,'JOB_RESOLUTION_BUYER_STATE_CHANGED',409);
    for(const op of state.operations)need(op.requestSha256===requestHash(op.request)&&['ISSUE','MESSAGE'].includes(op.kind)&&
      ['PREPARED','DISPATCHING','RECEIVED','FAILED','UNKNOWN'].includes(op.state),'JOB_RESOLUTION_BUYER_OPERATION_CHANGED',409);
    const fetcher=fetchImpl??createPublicHttpsFetch({timeoutMs:requestTimeoutMs,trustedProxy:transport??null});
    const endpoint=buyer.acceptance.statusUrl+'/resolution';
    const serial=fn=>{
      need(!closing,'JOB_RESOLUTION_BUYER_CLOSING',503);
      const task=tail.then(()=>{lease.assertHeld();return fn();});tail=task.catch(()=>{});return task;
    };
    async function commit(){lease.assertHeld();state.updatedAt=now();await writeDocument(statePath,state);}
    async function savedReceipt(){
      if(!state.receipt)return null;
      const selected=state.receipt;need(selected.file===selected.sha256+'.json','JOB_RESOLUTION_RECEIPT_PATH_CHANGED',409);
      const bytes=await readPrivate(join(receiptDirectory,selected.file),MAX_BYTES);
      need(hash(bytes)===selected.sha256&&bytes.length===selected.bytes,'JOB_RESOLUTION_RETAINED_RECEIPT_CHANGED',409);
      const value=validateReceipt(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),buyer.acceptance);
      need(value.revision===selected.revision,'JOB_RESOLUTION_RETAINED_RECEIPT_CHANGED',409);
      return {value,bytes};
    }
    async function observe(bytes,{operations=state.operations}={}){
      need(bytes.length<=RESOLUTION_RECEIPT_BYTES,'JOB_RESOLUTION_RESPONSE_TOO_LARGE',413);
      const value=validateReceipt(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),buyer.acceptance);
      const current=await savedReceipt();
      if(current)need(value.revision>=current.value.revision&&
        (value.revision!==current.value.revision||same(projection(value),projection(current.value))),
        'JOB_RESOLUTION_RECEIPT_ROLLBACK',409);
      const actual=await buyer.receipt();
      if(actual.latestStatus?.nativeSettlement)need(actual.latestStatus.nativeSettlement.id===value.nativeSettlement.id,
        'JOB_RESOLUTION_PURCHASE_SETTLEMENT_MISMATCH',409);
      need(value.nativeSettlement.id===hash(['sf98.v1',value.functionId,'POST',value.payment.network,
        value.nativeSettlement.transactionFingerprint??value.nativeSettlement.receiptFingerprint].join('\n')),
        'JOB_RESOLUTION_PURCHASE_SETTLEMENT_MISMATCH',409);
      const digest=hash(bytes),at=now(),next={...state,operations,updatedAt:at,
        receipt:{file:digest+'.json',sha256:digest,bytes:bytes.length,revision:value.revision,observedAt:at}};
      // The entire proposed state is checked before receipt retention or
      // pointer changes; receiving keeps prior operations and bytes intact.
      need(json(next).length<=RESOLUTION_DOCUMENT_BYTES,'JOB_RESOLUTION_FILE_TOO_LARGE',413);
      await retainBytes(receiptDirectory,bytes);
      lease.assertHeld();await writeDocument(statePath,next);
      state=next;return value;
    }
    async function request(path,{method='GET',body,signal,deadlineMs=requestTimeoutMs}={}){
      need(Number.isSafeInteger(deadlineMs)&&deadlineMs>=1&&deadlineMs<=120000,'JOB_RESOLUTION_DEADLINE_INVALID');
      const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);
      if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
      const timeout=setTimeout(()=>controller.abort(Object.assign(new Error('JOB_RESOLUTION_DEADLINE'),{code:'JOB_RESOLUTION_DEADLINE'})),deadlineMs);
      timeout.unref?.();controllers.add(controller);
      try{
        const target=endpoint+path,response=await fetcher(target,{method,redirect:'manual',cache:'no-store',signal:controller.signal,
          headers:{Accept:'application/json','x-sfjobs-token':original.claimToken,
            ...(body===undefined?{}:{'content-type':'application/json'})},
          ...(body===undefined?{}:{body:JSON.stringify(body)})});
        need(response.status!==402,'JOB_RESOLUTION_UNEXPECTED_PAYMENT_REQUEST',409);
        need(response.status<300||response.status>=400,'JOB_RESOLUTION_REDIRECT_REJECTED',502);
        need(!response.url||response.url===target,'JOB_RESOLUTION_REDIRECT_REJECTED',502);
        need(!response.headers.get('content-encoding')||response.headers.get('content-encoding')==='identity','JOB_RESOLUTION_RESPONSE_ENCODING',502);
        const declared=response.headers.get('content-length');
        if(declared!==null)need(/^\d+$/.test(declared)&&Number(declared)<=MAX_BYTES,'JOB_RESOLUTION_RESPONSE_TOO_LARGE',502);
        const parts=[];let total=0;
        for await(const chunk of response.body??[]){total+=chunk.length;need(total<=MAX_BYTES,'JOB_RESOLUTION_RESPONSE_TOO_LARGE',502);parts.push(Buffer.from(chunk));}
        if(declared!==null)need(total===Number(declared),'JOB_RESOLUTION_RESPONSE_TRUNCATED',502);
        const bytes=Buffer.concat(parts);
        if(!response.ok){
          let value;try{value=JSON.parse(bytes);}catch{}
          throw Object.assign(new Error(value?.error??'JOB_RESOLUTION_HTTP_ERROR'),
            {code:/^[A-Z][A-Z0-9_]{0,100}$/.test(value?.error??'')?value.error:'JOB_RESOLUTION_HTTP_ERROR',status:response.status});
        }
        return bytes;
      }finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);controllers.delete(controller);}
    }
    async function inspectValue(){
      const saved=await savedReceipt();
      return {schema:'stellar-forge.job-resolution-customer-state.v1',jobId:buyer.jobId,
        acceptanceSha256:state.acceptanceSha256,purchaseSha256:state.purchaseSha256,
        receipt:saved?.value??null,retainedReceipt:copy(state.receipt),
        operations:copy(state.operations),updatedAt:state.updatedAt};
    }
    function matchOperation(op,receipt){
      const rows=op.kind==='ISSUE'?receipt.issues:receipt.messages,record=rows.find(r=>r.id===op.id);
      if(!record)return false;
      need(record.message===op.request.message||record.text===op.request.message,'JOB_RESOLUTION_REMOTE_REQUEST_CHANGED',409);
      if(op.kind==='ISSUE')need(record.requestedRemedy===op.request.requestedRemedy,'JOB_RESOLUTION_REMOTE_REQUEST_CHANGED',409);
      else need(record.author==='CUSTOMER'&&(record.issueId??null)===(op.request.issueId??null),'JOB_RESOLUTION_REMOTE_REQUEST_CHANGED',409);
      return true;
    }
    async function sendOperation(op,options){
      op.state='DISPATCHING';op.startedAt=now();op.error=null;await commit();
      try{
        const bytes=await request(op.kind==='ISSUE'?'/issues':'/messages',{method:'POST',body:op.request,...options});
        const value=await observe(bytes);need(matchOperation(op,value),'JOB_RESOLUTION_REMOTE_REQUEST_MISSING',409);
        op.state='RECEIVED';op.completedAt=now();op.receiptSha256=state.receipt.sha256;
      }catch(error){op.state=Number.isInteger(error.status)&&error.status>=400&&error.status<500?'FAILED':'UNKNOWN';
        op.error=safe(error);op.completedAt=now();}
      await commit();return inspectValue();
    }
    async function submit(kind,input,options){
      return serial(async()=>{
        const request={requestId:id(input.requestId),expectedRevision:revision(input.expectedRevision),message:text(input.message),
          ...(kind==='ISSUE'?{requestedRemedy:input.requestedRemedy??'CONTACT'}:{issueId:input.issueId??null})};
        if(kind==='ISSUE')need(['RETRY','REFUND','CONTACT'].includes(request.requestedRemedy),'JOB_RESOLUTION_REMEDY_INVALID');
        else if(request.issueId)id(request.issueId);
        let op=state.operations.find(o=>o.id===request.requestId);
        if(op){need(op.kind===kind&&op.requestSha256===requestHash(request),'JOB_RESOLUTION_REQUEST_CONFLICT',409);return inspectValue();}
        need(state.operations.length<1000,'JOB_RESOLUTION_OPERATION_LIMIT',409);
        op={id:request.requestId,kind,request,requestSha256:requestHash(request),state:'PREPARED',
          createdAt:now(),startedAt:null,completedAt:null,error:null};
        state.operations.push(op);await commit();return sendOperation(op,options);
      });
    }
    const api={
      directory,stateDirectory,jobId:buyer.jobId,
      inspect(){return serial(inspectValue);},
      refresh(options={}){return serial(async()=>{await observe(await request('',options));return inspectValue();});},
      issue(input,options={}){return submit('ISSUE',input,options);},
      message(input,options={}){return submit('MESSAGE',input,options);},
      recover(requestId,options={}){
        return serial(async()=>{
          const op=state.operations.find(o=>o.id===id(requestId));need(op,'JOB_RESOLUTION_OPERATION_NOT_FOUND',404);
          const receipt=await observe(await request('',options));
          if(matchOperation(op,receipt)){op.state='RECEIVED';op.completedAt=now();op.error=null;op.receiptSha256=state.receipt.sha256;}
          else if(op.state==='DISPATCHING')op.state='UNKNOWN';
          await commit();return inspectValue();
        });
      },
      resume(requestId,options={}){
        return serial(async()=>{
          const op=state.operations.find(o=>o.id===id(requestId));need(op,'JOB_RESOLUTION_OPERATION_NOT_FOUND',404);
          if(op.state==='RECEIVED')return inspectValue();
          return sendOperation(op,options);
        });
      },
      export(){
        return serial(async()=>{
          const saved=await savedReceipt();need(saved,'JOB_RESOLUTION_RECEIPT_REQUIRED',409);
          const acceptanceBytes=await readPrivate(join(directory,'acceptance.json'),65536);
          need(hash(acceptanceBytes)===state.acceptanceSha256,'JOB_RESOLUTION_ORIGINAL_BUYER_CHANGED',409);
          return {schema:BUYER_RESOLUTION_EXPORT,exportedAt:now(),jobId:buyer.jobId,
            acceptanceSha256:state.acceptanceSha256,acceptanceBase64:acceptanceBytes.toString('base64'),
            purchaseSha256:state.purchaseSha256,purchase:copy((await buyer.receipt()).purchase),
            receiptSha256:hash(saved.bytes),receiptBase64:saved.bytes.toString('base64'),
            operations:copy(state.operations)};
        });
      },
      receive(bundle){
        return serial(async()=>{
          need(json(bundle).length<=RESOLUTION_RECEIVING_BYTES,'JOB_RESOLUTION_RECEIVING_TOO_LARGE',413);
          need(bundle?.schema===BUYER_RESOLUTION_EXPORT&&bundle.jobId===buyer.jobId&&
            bundle.acceptanceSha256===state.acceptanceSha256&&bundle.purchaseSha256===state.purchaseSha256&&
            typeof bundle.acceptanceBase64==='string'&&bundle.acceptanceBase64.length<=87384&&
            typeof bundle.receiptBase64==='string'&&bundle.receiptBase64.length<=MAX_BYTES*4/3+4&&
            Array.isArray(bundle.operations)&&bundle.operations.length<=1000,'JOB_RESOLUTION_RECEIVING_SOURCE_CHANGED',409);
          const accepted=Buffer.from(bundle.acceptanceBase64,'base64'),bytes=Buffer.from(bundle.receiptBase64,'base64');
          need(accepted.toString('base64')===bundle.acceptanceBase64&&hash(accepted)===state.acceptanceSha256&&
            bytes.toString('base64')===bundle.receiptBase64&&hash(bytes)===bundle.receiptSha256,'JOB_RESOLUTION_RECEIVING_BYTES_CHANGED',409);
          const merged=new Map(state.operations.map(op=>[op.id,copy(op)]));
          need(merged.size===state.operations.length,'JOB_RESOLUTION_BUYER_OPERATION_CHANGED',409);
          for(const op of bundle.operations){
            id(op.id);need(op.requestSha256===requestHash(op.request)&&op.id===op.request.requestId&&
              ['ISSUE','MESSAGE'].includes(op.kind)&&['PREPARED','DISPATCHING','RECEIVED','FAILED','UNKNOWN'].includes(op.state),
              'JOB_RESOLUTION_RECEIVING_OPERATION_CHANGED',409);
            const previous=merged.get(op.id);
            if(previous)need(previous.requestSha256===op.requestSha256&&previous.kind===op.kind,
              'JOB_RESOLUTION_RECEIVING_OPERATION_CHANGED',409);
            else merged.set(op.id,copy(op));
          }
          // Validate the combined receiving state before changing either the
          // retained receipt pointer or any original customer operation.
          need(merged.size<=1000,'JOB_RESOLUTION_OPERATION_LIMIT',409);
          const receipt=validateReceipt(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),buyer.acceptance);
          for(const op of merged.values()){
            if(matchOperation(op,receipt)){op.state='RECEIVED';op.error=null;op.receiptSha256=bundle.receiptSha256;}
            else if(op.state==='DISPATCHING')op.state='UNKNOWN';
          }
          await observe(bytes,{operations:[...merged.values()]});
          return inspectValue();
        });
      },
      close(){
        if(!closePromise){closing=true;for(const c of controllers)c.abort(Object.assign(new Error('JOB_RESOLUTION_CLOSING'),{code:'JOB_RESOLUTION_CLOSING'}));
          closePromise=tail.then(()=>lease.close());}
        return closePromise;
      }
    };
    await savedReceipt();
    return Object.freeze(api);
  }catch(error){await lease.close();throw error;}
}
