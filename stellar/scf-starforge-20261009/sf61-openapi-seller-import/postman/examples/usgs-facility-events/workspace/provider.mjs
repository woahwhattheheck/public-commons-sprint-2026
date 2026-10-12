// MIT. Resumable public USGS captures retain each original HTTP observation.
import { SOURCE_LIMIT, now, need, parseBytes, sourceRequest } from './model.mjs';

function retryTime(value) {
  if(!value)return null;
  if(/^\d+(?:\.\d+)?$/.test(value))return new Date(Date.now()+Number(value)*1000).toISOString();
  const time=Date.parse(value);return Number.isFinite(time)?new Date(Math.max(Date.now(),time)).toISOString():null;
}
function countOf(bytes) {
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes).trim();
  need(/^\d+$/.test(text)&&Number.isSafeInteger(Number(text)),'The USGS count response is not a non-negative integer.');
  return Number(text);
}
function eventResponse(bytes,status) {
  if(status===204){need(bytes.length===0,'USGS returned bytes with an HTTP 204 response.');return 0;}
  const value=parseBytes(bytes,'USGS response');
  need(value?.type==='FeatureCollection'&&Array.isArray(value.features),'The USGS response is not a GeoJSON FeatureCollection.');
  need(value.metadata?.status===undefined||value.metadata.status===200,'USGS returned unsuccessful GeoJSON metadata.');
  return value.features.length;
}
export class SourceCaptures {
  constructor(store,{fetch:transport=globalThis.fetch}={}) {this.store=store;this.fetch=transport;this.active=new Map();this.closed=false;}
  get size(){return this.active.size;}
  key(projectId,id){return projectId+':'+id;}
  start(projectId,id) {
    need(!this.closed,'The workspace is closing.',503);this.store.assertOpen();
    const key=this.key(projectId,id),running=this.active.get(key);
    if(running)return running.promise;
    const job=this.store.capture(projectId,id);
    if(job.state==='complete')return Promise.resolve(job);
    need(!job.retryAt||Date.parse(job.retryAt)<=Date.now(),'The source requested a retry after '+job.retryAt+'.',429);
    const controller=new AbortController();
    const promise=this.run(projectId,job,controller.signal).finally(()=>this.active.delete(key));
    this.active.set(key,{controller,promise});return promise;
  }
  pause(projectId,id) {
    const running=this.active.get(this.key(projectId,id));
    if(running){running.controller.abort(new Error('Capture paused by the operator.'));return running.promise;}
    const job=this.store.capture(projectId,id);
    if(job.state!=='complete'){job.state='paused';job.error=null;this.store.saveCapture(projectId,job);}
    return Promise.resolve(job);
  }
  async run(projectId,job,signal) {
    job.state='capturing';job.error=null;job.retryAt=null;this.store.saveCapture(projectId,job);
    try {
      while(job.pending.length) {
        signal.throwIfAborted();
        const window=job.pending[0];
        if(job.plan.mode==='feed') {
          const observation=await this.observe(projectId,job,window.id+'/query',sourceRequest(job.plan,window),'query',signal);
          this.store.completeSource(projectId,job,window,observation);continue;
        }
        const before=await this.observe(projectId,job,window.id+'/before',sourceRequest(job.plan,window,'count'),'count',signal);
        const beforeCount=countOf(this.store.blob(before.bodySha256));
        if(beforeCount>20000){this.split(projectId,job,window,beforeCount);continue;}
        let response;
        try {response=await this.observe(projectId,job,window.id+'/query',sourceRequest(job.plan,window),'query',signal);}
        catch(error) {
          if(error.providerStatus!==400)throw error;
          const observed=await this.observe(projectId,job,window.id+'/changed-count',sourceRequest(job.plan,window,'count'),'count',signal);
          const changedCount=countOf(this.store.blob(observed.bodySha256));
          if(changedCount>20000){this.split(projectId,job,window,changedCount);continue;}
          throw error;
        }
        const after=await this.observe(projectId,job,window.id+'/after',sourceRequest(job.plan,window,'count'),'count',signal);
        const afterCount=countOf(this.store.blob(after.bodySha256));
        if(afterCount>20000){this.split(projectId,job,window,afterCount);continue;}
        this.store.completeSource(projectId,job,window,response,{before:beforeCount,after:afterCount,
          beforeObservation:before.id,afterObservation:after.id});
      }
      job.state='complete';job.error=null;job.retryAt=null;
    }catch(error){
      job.state=signal.aborted?'paused':error.providerStatus===429||error.providerStatus===503?'waiting':'interrupted';
      job.error=String(error.message);if(error.retryAt)job.retryAt=error.retryAt;
    }
    this.store.saveCapture(projectId,job);return job;
  }
  split(projectId,job,window,count) {
    const start=Date.parse(window.starttime),end=Date.parse(window.endtime),middle=Math.floor((start+end)/2);
    need(middle>start&&middle<end,'USGS reports '+count+' events in the minimum time interval '+window.starttime+' to '+window.endtime+'. Save a narrower geographic or magnitude selection.');
    const midpoint=new Date(middle).toISOString();
    const children=[{id:window.id+'a',starttime:window.starttime,endtime:midpoint},{id:window.id+'b',starttime:midpoint,endtime:window.endtime}];
    job.pending.splice(0,1,...children);
    (job.splits??=[]).push({window,count,children,at:now()});
    this.store.saveCapture(projectId,job);
  }
  async observe(projectId,job,key,url,kind,signal) {
    const existing=[...job.observations].reverse().find(value=>value.key===key&&value.accepted);
    if(existing)return existing;
    const controller=new AbortController(),abort=()=>controller.abort(signal.reason);
    signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted)abort();
    const timer=setTimeout(()=>controller.abort(new Error('The source response exceeded 60 seconds.')),60000);
    let response,bytes;
    try {
      response=await this.fetch(url,{signal:controller.signal,redirect:'error',headers:{Accept:kind==='count'?'text/plain':'application/geo+json, application/json',
        'User-Agent':'Stellar-Forge-Facility-Operations/1.0 (+https://github.com/woahwhattheheck/public-commons-sprint-2026)'}});
      const declared=Number(response.headers.get('content-length'));
      need(!Number.isFinite(declared)||declared<=SOURCE_LIMIT,'The source response exceeds 64 MiB.');
      const chunks=[];let length=0;
      if(response.body)for await(const chunk of response.body){length+=chunk.byteLength;need(length<=SOURCE_LIMIT,'The source response exceeds 64 MiB.');chunks.push(Buffer.from(chunk));}
      bytes=Buffer.concat(chunks,length);
    }finally {clearTimeout(timer);signal.removeEventListener('abort',abort);}
    const headers=Object.fromEntries(['content-type','content-length','date','etag','last-modified','retry-after'].map(name=>[name,response.headers.get(name)]).filter(([,value])=>value!==null));
    const observation=this.store.retainObservation(projectId,job,{id:job.observations.length+1,key,kind,url:response.url||url,status:response.status,receivedAt:now(),headers,accepted:false},bytes);
    if(response.status!==200&&!(kind==='query'&&response.status===204)) {
      const error=Object.assign(new Error('USGS returned HTTP '+response.status+' for '+kind+'. The original response is retained in this capture.'),{providerStatus:response.status,retryAt:retryTime(headers['retry-after'])});
      observation.error=error.message;this.store.saveCapture(projectId,job);throw error;
    }
    try {if(kind==='count')countOf(bytes);else eventResponse(bytes,response.status);}
    catch(error){observation.error=error.message;this.store.saveCapture(projectId,job);throw error;}
    observation.accepted=true;this.store.saveCapture(projectId,job);return observation;
  }
  async close() {
    if(this.closed)return;this.closed=true;
    for(const value of this.active.values())value.controller.abort(new Error('The workspace is closing; resume this capture after reopening.'));
    await Promise.allSettled([...this.active.values()].map(value=>value.promise));
  }
}
