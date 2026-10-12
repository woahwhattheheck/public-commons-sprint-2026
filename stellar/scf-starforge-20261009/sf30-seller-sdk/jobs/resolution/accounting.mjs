// MIT. Borrow the original AdjustmentWorkspace or its maintained local HTTP API.
import {need,object,UUID,copy} from './contract.mjs';
import {resolveRpcEndpoint} from '../../../sf86-rpc-transfer-reconcile/terms.mjs';

export function accountingOrigin(value){
  let url;try{url=new URL(value);}catch{need(false,'JOB_RESOLUTION_ACCOUNTING_URL_INVALID');}
  need(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)&&url.port&&
    url.pathname==='/'&&!url.search&&!url.hash&&!url.username&&!url.password,
    'JOB_RESOLUTION_ACCOUNTING_LOOPBACK_REQUIRED');
  return url.origin;
}
export function createJobAccounting({controller,url,fetchImpl=globalThis.fetch,timeoutMs=30000}={}){
  need(Boolean(controller)!==Boolean(url),'JOB_RESOLUTION_ACCOUNTING_SELECTION_REQUIRED');
  need(Number.isSafeInteger(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=120000,'JOB_RESOLUTION_ACCOUNTING_TIMEOUT_INVALID');
  if(controller)for(const key of ['event','preview','record','detail','verify','savedJob','withdraw','view','export'])
    need(typeof controller[key]==='function','JOB_RESOLUTION_ORIGINAL_ADJUSTMENTS_REQUIRED');
  const origin=url?accountingOrigin(url):null,active=new Set();let closed=false;
  async function call(path,{method='GET',value,signal,raw=false}={}){
    need(!closed,'JOB_RESOLUTION_ACCOUNTING_CLOSED',503);
    const local=new AbortController(),abort=()=>local.abort(signal?.reason);
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>local.abort(Object.assign(new Error('JOB_RESOLUTION_ACCOUNTING_DEADLINE'),{code:'JOB_RESOLUTION_ACCOUNTING_DEADLINE'})),timeoutMs);
    timer.unref?.();active.add(local);
    try{
      const target=origin+path,response=await fetchImpl(target,{method,redirect:'error',cache:'no-store',signal:local.signal,
        headers:method==='POST'?{'Content-Type':'application/json','X-Workspace-Request':'1'}:{Accept:'application/json'},
        ...(value===undefined?{}:{body:JSON.stringify(value)})});
      need(!response.url||response.url===target,'JOB_RESOLUTION_ACCOUNTING_REDIRECT',502);
      need(!response.headers.get('content-encoding')||response.headers.get('content-encoding')==='identity',
        'JOB_RESOLUTION_ACCOUNTING_ENCODING',502);
      const declared=response.headers.get('content-length');
      if(declared!==null)need(/^\d+$/.test(declared)&&Number(declared)<=16*1024*1024,'JOB_RESOLUTION_ACCOUNTING_RESPONSE_TOO_LARGE',502);
      const parts=[];let total=0;
      for await(const chunk of response.body??[]){total+=chunk.length;need(total<=16*1024*1024,'JOB_RESOLUTION_ACCOUNTING_RESPONSE_TOO_LARGE',502);parts.push(Buffer.from(chunk));}
      if(declared!==null)need(total===Number(declared),'JOB_RESOLUTION_ACCOUNTING_RESPONSE_TRUNCATED',502);
      const bytes=Buffer.concat(parts);
      if(raw&&response.ok)return {bytes,type:'application/json; charset=utf-8',name:'merchant-adjustments.json'};
      let result;try{result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{need(false,'JOB_RESOLUTION_ACCOUNTING_RESPONSE_INVALID',502);}
      need(object(result),'JOB_RESOLUTION_ACCOUNTING_RESPONSE_INVALID',502);
      if(!response.ok)throw Object.assign(new Error(result.message??result.error??'JOB_RESOLUTION_ACCOUNTING_REJECTED'),
        {code:typeof result.error==='string'?result.error:'JOB_RESOLUTION_ACCOUNTING_REJECTED',status:response.status});
      return result;
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);active.delete(local);}
  }
  const select=value=>{need(typeof value==='string'&&UUID.test(value),'JOB_RESOLUTION_ACCOUNTING_ID_REQUIRED');return encodeURIComponent(value);};
  return Object.freeze({
    origin,
    endpoint(network,value){return resolveRpcEndpoint(network,value,{allowLocal:controller?.options?.allowLocalRpc===true});},
    async state(){return controller?copy(controller.workspace.view()):call('/api/state');},
    async view(){return controller?copy(controller.view()):call('/api/adjustments');},
    async event(runId,eventId){
      need(/^[a-f0-9]{64}$/.test(eventId??''),'JOB_RESOLUTION_EVENT_REQUIRED');
      return controller?controller.event(runId,eventId):call('/api/adjustments/event?runId='+select(runId)+'&eventId='+eventId);
    },
    async preview(value){return controller?controller.preview(value):call('/api/adjustments/preview',{method:'POST',value});},
    async record(value){return controller?controller.record(value):call('/api/adjustments/record',{method:'POST',value});},
    async detail(id){return controller?controller.detail(id):call('/api/adjustments/'+select(id));},
    async verify(id,value){return controller?controller.verify(id,value):call('/api/adjustments/'+select(id)+'/verify',{method:'POST',value});},
    async savedJob(id){return controller?controller.savedJob(id):call('/api/adjustments/jobs/'+select(id));},
    async export(runId){return controller?controller.export({runId,format:'json'}):call('/api/adjustments/export?runId='+select(runId)+'&format=json',{raw:true});},
    async withdraw(id,value){return controller?controller.withdraw(id,value):call('/api/adjustments/'+select(id)+'/withdraw',{method:'POST',value});},
    close(){closed=true;for(const c of active)c.abort(Object.assign(new Error('JOB_RESOLUTION_CLOSING'),{code:'JOB_RESOLUTION_CLOSING'}));}
  });
}
