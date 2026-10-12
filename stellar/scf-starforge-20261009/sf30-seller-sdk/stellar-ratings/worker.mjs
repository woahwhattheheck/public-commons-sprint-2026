// MIT. Continuous original daily collection on the same operator and workspace.
import {createHash} from 'node:crypto';
import {need,integer,intent} from './common.mjs';

const requestId=value=>{
 const h=createHash('sha256').update(value).digest('hex');
 return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);
};
async function wait(ms,signal){
 if(signal?.aborted)return;
 await new Promise(done=>{
  let timer;
  const stop=()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);done();};
  timer=setTimeout(stop,ms);signal?.addEventListener('abort',stop,{once:true});
  if(signal?.aborted)stop();
 });
}
export async function runRatingsCollectionsWorker({
 operator,signal,enabled=false,intervalMs=60000,onEvent=()=>{}
}={}){
 need(operator?.invoke&&operator?.describe,'INVALID_OPERATOR',
  'Use the original running Stellar ratings operator.');
 integer(intervalMs,'daily collection polling interval',1000,3600000);
 need(typeof enabled==='boolean'&&typeof onEvent==='function','INVALID_WORKER',
  'Select the collection default and an event receiver.');
 const outcomes=new Map();let lastError=null;

 async function invoke(method,args,{original=false}={}){
  if(signal?.aborted)return null;
  // A saved long operation owns its complete original argument body. Its
  // native continuation recovers that intent before examining a new revision.
  if(original)return operator.invoke({method,args});
  for(;;){
   if(signal?.aborted)return null;
   const state=await operator.describe(),selected={...args,expectedRevision:state.revision};
   const previous=await operator.invoke({method:'request.status',args:{requestId:args.requestId}});
   if(previous.record){
    const expected=intent(method,selected);
    need(previous.workspaceId===state.workspaceId&&previous.record.operation===method&&
      previous.record.intentSha256===expected.intentSha256,'REQUEST_ID_CONFLICT',
      'The saved daily request belongs to a different original selection.');
    return {...previous.record.result,replayed:true};
   }
   try{return await operator.invoke({method,args:selected});}
   catch(error){
    // Native REVISION_CONFLICT is returned before a fresh mutation commits.
    // Every other result remains attached to its actual original request.
    if(error.code!=='REVISION_CONFLICT')throw error;
   }
  }
 }
 function emit(key,value){
  const signature=JSON.stringify(value);
  if(outcomes.get(key)!==signature){outcomes.set(key,signature);onEvent(value);}
 }
 while(!signal?.aborted){
  try{
   const state=await operator.describe();
   const collecting=typeof state.profile.collectDaily==='boolean'?state.profile.collectDaily:enabled;
   if(collecting){
    let offset=0;const visited=new Set();
    do{
     const page=await operator.invoke({method:'workspace.list',args:{table:'collections',offset,limit:1000}});
     for(const row of page.rows){
      visited.add(row.id);if(signal?.aborted)break;
      try{
       const current=await operator.invoke({method:'collection.read',args:{collectionId:row.id,limit:1}});
       if(!current.definition.definition.enabled)continue;
       const execution=current.execution;
       if(execution?.paused||execution?.status==='PAUSED'||execution?.status==='FAILED')continue;
       const to=new Date().toISOString().slice(0,10);
       if(execution?.status==='WAITING_FOR_BOUNDARY'){
        if(new Date(execution.cursor+'T00:00:00.000Z').getTime()+86400000>Date.now())continue;
        await invoke('collection.resume',{
         collectionId:row.id,
         requestId:requestId(state.workspaceId+':boundary:'+execution.id+':'+to)
        });
       }
       if(signal?.aborted)break;
       const version=current.definition.version,launch=current.definition.definition.launchDate;
       if(launch>=to&&!execution)continue;
       const active=Boolean(execution&&execution.status!=='COMPLETE');
       const args=active?execution.args:{
        collectionId:row.id,version,to,
        requestId:requestId(state.workspaceId+':collection:'+row.id+':'+version+':'+to)
       };
       const result=await invoke('collection.run',args,{original:active});
       if(result&&!result.replayed)emit(row.id,{
        type:'daily-collection',collectionId:row.id,status:result.status,
        from:result.from??null,to:result.to??to,
        dates:result.dates??result.completedDates??0,
        nextDate:result.nextDate??null
       });
      }catch(error){
       if(signal?.aborted)break;
       emit(row.id,{type:'daily-collection-error',collectionId:row.id,error:operator.publicError(error)});
      }
     }
     offset=page.nextOffset;
    }while(offset!==null&&!signal?.aborted);
    for(const key of outcomes.keys())if(!visited.has(key))outcomes.delete(key);
   }
   lastError=null;
  }catch(error){
   if(signal?.aborted)break;
   const value=operator.publicError(error),key=JSON.stringify(value);
   if(key!==lastError)onEvent({type:'daily-worker-error',error:value});lastError=key;
  }
  await wait(intervalMs,signal);
 }
 return {status:'STOPPED'};
}
