#!/usr/bin/env node
// MIT. One leased worker for already-retained original signed webhook deliveries.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {openAmeroWorkspace} from './lib/workspace.mjs';
import {lease,now,need,publicError,readJSON} from './lib/files.mjs';

export async function startAmeroWorker({
 directory,configuration={},workspace:provided,signal,pollSeconds=15,onResult=()=>{},
}={}){
 need(Number.isFinite(pollSeconds)&&pollSeconds>=1&&pollSeconds<=300,'INVALID_WORKER_POLL');
 const workspace=provided??await openAmeroWorkspace({
  directory,connections:configuration.connections??{},name:configuration.name,
  sourceDirectory:configuration.sourceDirectory,runtimeDirectory:configuration.runtimeDirectory,
  expectedManifestSha256:configuration.expectedManifestSha256,
 });
 let guard;
 try{guard=await lease(workspace.directory,'webhook-worker');}
 catch(error){if(!provided)await workspace.close();throw error;}
 const controller=new AbortController(),abort=()=>controller.abort(signal?.reason??'worker-stopping');
 signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 let closePromise;
 const done=(async()=>{
  try{
   while(!controller.signal.aborted){
    const selected=workspace.privateList('webhooks').filter(row=>row.verified&&row.status==='RETAINED');
    for(const delivery of selected){
     if(controller.signal.aborted)break;
     const requestId='project-webhook:'+delivery.id;
     let prior;
     try{prior=workspace.item('requests',requestId);}
     catch(error){if(error.code!=='RECORD_NOT_FOUND')throw error;}
     // A failed explicit projection remains an operator-visible original outcome.
     // It is not retried under a new request or printed on every worker poll.
     if(prior?.status==='FAILED')continue;
     try{
      const result=await workspace.command({requestId,method:'webhook.reconcile',
       args:{webhookId:delivery.id},signal:controller.signal});
      await onResult({at:now(),requestId,result});
     }catch(error){
      if(controller.signal.aborted)throw error;
      await onResult({at:now(),requestId,error:publicError(error)});
     }
    }
    try{await delay(pollSeconds*1000,undefined,{signal:controller.signal});}
    catch(error){if(!controller.signal.aborted)throw error;}
   }
  }finally{
   signal?.removeEventListener('abort',abort);
   if(!provided)await workspace.close();
   await guard.release();
  }
 })();done.catch(()=>{});
 function close(){if(!closePromise){controller.abort('worker-stopping');closePromise=done;}return closePromise;}
 return{workspace,done,close,identity:guard.owner};
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const flags={};
 for(let i=2;i<process.argv.length;i+=2){
  need(process.argv[i]?.startsWith('--')&&process.argv[i+1],'ARGUMENT_REQUIRED');
  flags[process.argv[i].slice(2)]=process.argv[i+1];
 }
 const configuration=flags.configuration?await readJSON(path.resolve(flags.configuration)):{};
 const worker=await startAmeroWorker({
  directory:path.resolve(flags.directory),configuration,pollSeconds:Number(flags['poll-seconds']??15),
  onResult:value=>process.stdout.write(JSON.stringify(value)+'\n'),
 });
 process.stdout.write('AMERO_WEBHOOK_WORKER_READY '+JSON.stringify({
  directory:worker.workspace.directory,workspaceId:worker.workspace.describe().workspace.id,
 })+'\n');
 for(const name of ['SIGTERM','SIGINT'])process.once(name,()=>worker.close());
 await worker.done;
}
