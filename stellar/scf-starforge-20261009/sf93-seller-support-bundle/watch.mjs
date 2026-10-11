// MIT. Own the watcher process only; original sellers and delivery workers stay independent.
import {randomUUID} from 'node:crypto';
import {readSupportBundle,readLocal} from './bundle.mjs';
import {openIncidentStore} from './incident-store.mjs';
import {applyObservation,validateDelivery} from './incident-model.mjs';
import {destinationForEvent,deliverNotification,applyDelivery,updateIncidentNotificationState} from './notifications.mjs';

async function collectMerchant(merchant,signal) {
  let packet;
  try {packet=await readSupportBundle({...merchant,signal});}
  catch(error) {
    return {error:signal?.aborted?'STOPPING':error.message.startsWith('SF93_SOURCE_INVALID')?
      'SOURCE_FORMAT_INVALID':error.message.startsWith('SF93_SIZE')?'SOURCE_SIZE_LIMIT':'ENDPOINT_READ_FAILED'};
  }
  let delivery=null,deliveryError=null;
  if(merchant.delivery) {
    try {
      const response=await readLocal(merchant.ops,'/api/delivery','application/json',{signal});
      delivery=validateDelivery(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(response.bytes)),Date.now());
    } catch {deliveryError=signal?.aborted?'STOPPING':'DELIVERY_READ_FAILED';}
  }
  return {packet,delivery,deliveryError};
}
function delay(ms,signal) {
  if(signal?.aborted)return Promise.resolve();
  return new Promise(done=>{
    const finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',finish);done();};
    const timer=setTimeout(finish,ms);signal?.addEventListener('abort',finish,{once:true});
  });
}
async function drainNotifications(store,env,signal) {
  if(signal?.aborted)return;
  const jobs=await store.transaction(state=>{
    const now=Date.now(),jobs=[];
    for(const event of state.notifications) {
      if(event.status==='IN_FLIGHT'&&Date.parse(event.inFlightUntil)<=now) {
        event.status='RETRY';event.attemptId=null;event.inFlightUntil=null;
        event.lastReason='PREVIOUS_ATTEMPT_OUTCOME_UNKNOWN';event.nextAttemptAt=new Date(now).toISOString();
        updateIncidentNotificationState(state,event);
      }
      if(!['PENDING','RETRY'].includes(event.status)||Date.parse(event.nextAttemptAt)>now)continue;
      const destination=destinationForEvent(state,event,env);
      if(destination.reason){event.status='PAUSED';event.lastReason=destination.reason;updateIncidentNotificationState(state,event);continue;}
      const options={...state.config.notification,maxAttempts:event.attemptLimit};
      if(event.attempts>=options.maxAttempts){event.status='EXHAUSTED';event.lastReason='ATTEMPT_LIMIT';updateIncidentNotificationState(state,event);continue;}
      if(jobs.length>=4)continue;
      event.attempts++;event.status='IN_FLIGHT';event.attemptId=randomUUID();
      event.inFlightUntil=new Date(now+options.timeoutMs+1000).toISOString();
      updateIncidentNotificationState(state,event);
      jobs.push({event:structuredClone(event),destination,options});
    }
    return jobs;
  });
  if(!jobs.length)return;
  const results=await Promise.all(jobs.map(async job=>{
    try{return await deliverNotification(job.event,job.destination,job.options,{signal});}
    catch{return {accepted:false,status:null,reason:'TRANSPORT_ERROR',retryable:true};}
  }));
  await store.transaction(state=>{
    for(let i=0;i<jobs.length;i++) {
      const job=jobs[i],event=state.notifications.find(item=>item.id===job.event.id);
      if(!event||event.status!=='IN_FLIGHT'||event.attemptId!==job.event.attemptId)continue;
      applyDelivery(event,results[i],job.options,Date.now());
      updateIncidentNotificationState(state,event);
    }
  });
}
export async function runIncidentWatch({directory,environment=process.env,signal,onReady=()=>{}}) {
  const store=await openIncidentStore(directory),lease=await store.acquireWorker();
  const instanceId=randomUUID();let started=false;
  try {
    await store.transaction(state=>{
      state.worker={instanceId,pid:process.pid,status:'RUNNING',startedAt:new Date().toISOString(),
        lastSweepAt:null,stoppedAt:null,lastError:null};
    });
    started=true;onReady({directory:store.root,instanceId,pid:process.pid});
    while(!signal?.aborted) {
      lease.assertHeld();
      const begun=Date.now(),snapshot=await store.read();
      const observations=await Promise.all(snapshot.config.merchants.map(merchant=>collectMerchant(merchant,signal)));
      if(signal?.aborted)break; // Intentional shutdown is not an endpoint incident.
      lease.assertHeld();
      await store.transaction(async(state,io)=>{
        if(state.configHash!==snapshot.configHash)return;
        for(let i=0;i<snapshot.config.merchants.length;i++)
          await applyObservation(state,snapshot.config.merchants[i],observations[i],io.capture,environment,Date.now());
        state.worker.lastSweepAt=new Date().toISOString();state.worker.lastError=null;
      });
      await drainNotifications(store,environment,signal);
      await delay(Math.max(100,snapshot.config.pollMs-(Date.now()-begun)),signal);
    }
    return {instanceId,stopped:true};
  } catch(error) {
    if(started)await store.transaction(state=>{
      if(state.worker?.instanceId===instanceId)state.worker.lastError='WATCH_OPERATION_FAILED';
    }).catch(()=>{});
    throw error;
  } finally {
    try {
      if(started)await store.transaction(state=>{
        if(state.worker?.instanceId===instanceId){state.worker.status='STOPPED';state.worker.stoppedAt=new Date().toISOString();}
      });
    } finally {await lease.close();}
  }
}
