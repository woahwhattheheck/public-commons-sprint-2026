// MIT. Resume the workspace's saved read-only acquisition schedules.
import {randomUUID} from 'node:crypto';
import {publicError,withLock} from './common.mjs';
function pause(ms,signal){return new Promise(resolve=>{
 if(signal?.aborted){resolve();return;}const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();};
 const timer=setTimeout(done,ms);signal?.addEventListener('abort',done,{once:true});
});}
export async function runTurbolongAcquisitionsWorker({workspace,signal,intervalMs=1500,onProgress=()=>{}}={}){
 if(!workspace?.readState||!workspace?.acquisitionRun)throw new TypeError('Use the original open Turbolong workspace.');
 return withLock(workspace.directory,'acquisitions-worker.lock',async()=>{
 while(!signal?.aborted){
  const state=await workspace.readState();
  const rows=Object.values(state.acquisitions).filter(row=>!row.paused&&row.desiredState==='RUNNING'&&
   (!row.nextRunAt||Date.parse(row.nextRunAt)<=Date.now())).sort((a,b)=>(a.nextRunAt??a.createdAt).localeCompare(b.nextRunAt??b.createdAt));
  for(const row of rows){
   if(signal?.aborted)break;
   const fresh=await workspace.readState(),selected=fresh.acquisitions[row.id];
   if(!selected||selected.paused||selected.desiredState!=='RUNNING')continue;
   const previous=selected.execution&&!['COMPLETE','CANCELED'].includes(selected.execution.state)?selected.execution.requestArgs:null;
   const args=previous?{...previous,expectedRevision:fresh.revision}:{requestId:randomUUID(),expectedRevision:fresh.revision,acquisitionId:selected.id};
   try{const result=await workspace.acquisitionRun(args,{signal});await onProgress({acquisitionId:selected.id,result});}
   catch(error){
    await onProgress({acquisitionId:selected.id,error:publicError(error)});
    // A different existing runner/explicit revision change is reconciled by its
    // saved execution on the next read. Other failures pause only this schedule.
    if(!['REVISION_CONFLICT','WORKSPACE_BUSY','LOCK_BUSY','ACQUISITION_RUNNING'].includes(error.code)){
     try{const latest=await workspace.readState();await workspace.acquisitionPause({requestId:randomUUID(),
       expectedRevision:latest.revision,acquisitionId:selected.id});}catch{}
    }
   }
  }
  await pause(intervalMs,signal);
 }
 });
}
