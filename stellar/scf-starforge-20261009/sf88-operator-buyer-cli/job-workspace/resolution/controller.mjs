// MIT. Resolution follows the original customer catalog and closes each retained buyer owner after use.
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openJobResolutionBuyer} from './client.mjs';
import {readDocument} from '../../../sf30-seller-sdk/jobs/resolution/storage.mjs';
import {need,copy,now,hash,json} from '../../../sf30-seller-sdk/jobs/resolution/contract.mjs';

export function openJobResolutionController({lease,getEntry,listEntries,transport,fetchImpl,requestTimeoutMs=60000,maxConcurrent=4}={}){
  need(lease&&typeof lease.assertHeld==='function'&&typeof getEntry==='function'&&typeof listEntries==='function',
    'JOB_RESOLUTION_CUSTOMER_OWNER_REQUIRED');
  need(Number.isSafeInteger(maxConcurrent)&&maxConcurrent>=1&&maxConcurrent<=4,'JOB_RESOLUTION_CUSTOMER_CAPACITY_INVALID');
  const tasks=new Map();let closing=false,closePromise;
  const accepting=()=>{lease.assertHeld();need(!closing,'JOB_RESOLUTION_CUSTOMER_CLOSING',503);};
  function entry(id){need(/^[a-f0-9]{64}$/.test(id??''),'JOB_WORKSPACE_ID_INVALID');return getEntry(id);}
  async function withBuyer(entryId,kind,fn,{signal}={}){
    accepting();need(!tasks.has(entryId),'JOB_RESOLUTION_CUSTOMER_ACTIVE',409);
    need(tasks.size<maxConcurrent,'JOB_RESOLUTION_CUSTOMER_CAPACITY',429);
    const selected=entry(entryId),controller=new AbortController();
    const abort=()=>controller.abort(signal?.reason);
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    const task={id:randomUUID(),entryId,kind,state:'RUNNING',startedAt:now(),controller,promise:null,buyer:null};
    tasks.set(entryId,task);
    task.promise=(async()=>{
      try{
        task.buyer=await openJobResolutionBuyer({directory:selected.directory,transport,fetchImpl,requestTimeoutMs});
        const state=await task.buyer.inspect();
        need(state.acceptanceSha256===selected.receipt.acceptanceSha256&&state.jobId===selected.receipt.jobId,
          'JOB_RESOLUTION_CUSTOMER_ENTRY_CHANGED',409);
        controller.signal.throwIfAborted();lease.assertHeld();
        const result=await fn(task.buyer,{signal:controller.signal});
        return result;
      }finally{
        try{await task.buyer?.close();}finally{signal?.removeEventListener('abort',abort);tasks.delete(entryId);}
      }
    })();
    return task.promise;
  }
  function display(task){return {id:task.id,entryId:task.entryId,kind:task.kind,state:task.state,startedAt:task.startedAt};}
  return Object.freeze({
    status(){accepting();return {active:[...tasks.values()].map(display),capacity:maxConcurrent};},
    async list(query={}){
      accepting();const page=await listEntries(query),items=[];
      for(const selected of page.items){
        const saved=await readDocument(join(selected.directory,'resolution','follow-through.json'),{optional:true});
        if(saved)need(saved.acceptanceSha256===selected.receipt.acceptanceSha256,'JOB_RESOLUTION_CUSTOMER_ENTRY_CHANGED',409);
        items.push({id:selected.id,jobId:selected.receipt.jobId,label:selected.label,jobState:selected.receipt.latestStatus?.state??'AWAITING_SETTLEMENT',
          revision:saved?.receipt?.revision??null,observedAt:saved?.receipt?.observedAt??null,
          pending:(saved?.operations??[]).filter(op=>op.state!=='RECEIVED').length,
          task:tasks.has(selected.id)?display(tasks.get(selected.id)):null});
      }
      return {...page,items};
    },
    inspect(entryId,options={}){return withBuyer(entryId,'INSPECT',async b=>({entryId,...await b.inspect()}),options);},
    refresh(entryId,options={}){return withBuyer(entryId,'REFRESH',async(b,o)=>({entryId,...await b.refresh(o)}),options);},
    issue(entryId,input,options={}){return withBuyer(entryId,'ISSUE',async(b,o)=>({entryId,...await b.issue(input,o)}),options);},
    message(entryId,input,options={}){return withBuyer(entryId,'MESSAGE',async(b,o)=>({entryId,...await b.message(input,o)}),options);},
    recover(entryId,{requestId},options={}){return withBuyer(entryId,'RECOVER',async(b,o)=>({entryId,...await b.recover(requestId,o)}),options);},
    resume(entryId,{requestId},options={}){return withBuyer(entryId,'RESUME',async(b,o)=>({entryId,...await b.resume(requestId,o)}),options);},
    receive(entryId,bundle,options={}){return withBuyer(entryId,'RECEIVE',async b=>({entryId,...await b.receive(bundle)}),options);},
    export(entryId,options={}){
      return withBuyer(entryId,'EXPORT',async b=>{const bytes=json(await b.export());return {bytes,sha256:hash(bytes),
        name:'paid-job-resolution-'+hash(b.jobId).slice(0,16)+'.json',type:'application/json; charset=utf-8'};},options);
    },
    async stop(entryId){
      accepting();entry(entryId);const task=tasks.get(entryId);if(!task)return {stopped:true};
      task.state='CANCELLING';task.controller.abort(Object.assign(new Error('JOB_RESOLUTION_CUSTOMER_STOPPED'),{code:'JOB_RESOLUTION_CUSTOMER_STOPPED'}));
      await task.promise.catch(()=>{});return {stopped:true,operationId:task.id};
    },
    close(){
      if(!closePromise){closing=true;for(const task of tasks.values()){task.state='CANCELLING';
          task.controller.abort(Object.assign(new Error('JOB_RESOLUTION_CUSTOMER_CLOSING'),{code:'JOB_RESOLUTION_CUSTOMER_CLOSING'}));}
        closePromise=Promise.allSettled([...tasks.values()].map(t=>t.promise)).then(()=>({closed:true}));}
      return closePromise;
    }
  });
}
