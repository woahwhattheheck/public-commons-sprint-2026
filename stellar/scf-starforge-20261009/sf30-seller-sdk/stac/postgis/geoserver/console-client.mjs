// MIT. Attach to the original private loopback writer; retain only this client's requests.
import { request as httpRequest } from 'node:http';
import { readPrivate, identity } from '../../../postgres/publisher/files.mjs';
import { absolute, need, operationId, nativeBytes, parseExactJSON, MiB } from './contract.mjs';

function pause(ms,signal){
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason);};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
}
export async function openGeoServerConsoleClient({connectionFile,expectedInstanceId,signal}={}){
  absolute(connectionFile);signal?.throwIfAborted();
  const raw=await readPrivate(connectionFile,262144),connection=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  need(connection.schema==='starforge.geoserver-console-connection.v1'&&
    typeof connection.instanceId==='string'&&connection.instanceId.length<=128,'GEOSERVER_CONSOLE_CONNECTION');
  absolute(connection.workspace);
  const url=new URL(connection.url);
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.port&&url.pathname==='/'&&!url.search&&
    !url.username&&!url.password&&/^#[a-f0-9]{64}$/.test(url.hash)&&connection.origin===url.origin,
    'GEOSERVER_CONSOLE_PRIVATE_ORIGIN');
  if(expectedInstanceId)need(connection.instanceId===expectedInstanceId,'GEOSERVER_CONSOLE_INSTANCE_CHANGED');
  const token=url.hash.slice(1),origin=url.origin,lifetime=new AbortController(),pending=new Set(),jobs=new Set();
  let admission=true,closing=null,ready;
  function call(path,{method='GET',input,signal:external,cleanup=false}={}){
    if(!admission&&!cleanup)return Promise.reject(Object.assign(new Error('The GeoServer console client is closing.'),{code:'GEOSERVER_CLIENT_CLOSED'}));
    const target=new URL(path,origin);need(target.origin===origin,'GEOSERVER_CONSOLE_REQUEST_ORIGIN');
    const deadline=AbortSignal.timeout(cleanup?10000:300000);
    const combined=AbortSignal.any([deadline,...(external?[external]:[]),...(cleanup?[]:[lifetime.signal])]);
    combined.throwIfAborted();const body=input===undefined?null:nativeBytes(input);
    need(!body||body.length<=2*MiB,'GEOSERVER_REQUEST_LIMIT');
    const task=new Promise((resolve,reject)=>{
      let response,finished=false;const chunks=[];let length=0;
      const done=(error,value)=>{if(finished)return;finished=true;combined.removeEventListener('abort',abort);
        if(error){response?.destroy();request.destroy();reject(error);}else resolve(value);};
      const request=httpRequest(target,{method,headers:{authorization:'Bearer '+token,origin,
        accept:'application/json',...(body?{'content-type':'application/json','content-length':String(body.length)}:{})}},incoming=>{
        response=incoming;
        incoming.on('data',chunk=>{length+=chunk.length;
          if(length>64*MiB)done(Object.assign(new Error('The native console result exceeds 64 MiB.'),{code:'GEOSERVER_CONSOLE_RESULT_LIMIT'}));
          else chunks.push(chunk);});
        incoming.once('error',error=>done(error));
        incoming.once('aborted',()=>done(new Error('The native console response ended before completion.')));
        incoming.once('end',()=>{
          try{
            need(/^application\/json(?:\s*;|$)/i.test(incoming.headers['content-type']??''),'GEOSERVER_CONSOLE_JSON');
            const result=parseExactJSON(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
            if(incoming.statusCode<200||incoming.statusCode>=300){
              const error=Object.assign(new Error(result.error?.message??'The GeoServer console returned HTTP '+incoming.statusCode),
                {code:result.error?.code??'GEOSERVER_CONSOLE_HTTP',status:incoming.statusCode});throw error;
            }
            done(null,result);
          }catch(error){done(error);}
        });
      });
      const abort=()=>done(combined.reason??new Error('GeoServer console request cancelled.'));
      request.once('error',error=>done(error));combined.addEventListener('abort',abort,{once:true});
      if(combined.aborted){abort();return;}request.end(body??undefined);
    });
    pending.add(task);task.then(()=>pending.delete(task),()=>pending.delete(task));return task;
  }
  async function ensureReady(){
    ready??=call('/api/launch',{signal}).then(launch=>{
      need(launch.schema==='starforge.geoserver-console-launch.v1'&&launch.instanceId===connection.instanceId&&
        launch.workspace===connection.workspace&&identity(launch.profile)===identity(connection.profile),
        'GEOSERVER_CONSOLE_INSTANCE_CHANGED');return launch;});
    return ready;
  }
  function retain(work){
    if(!admission)return Promise.reject(new Error('The GeoServer console client is closing.'));
    const task=Promise.resolve().then(work);jobs.add(task);
    task.then(()=>jobs.delete(task),()=>jobs.delete(task));return task;
  }
  async function run(action,input,{signal:external}={}){
    const combined=AbortSignal.any([lifetime.signal,...(signal?[signal]:[]),...(external?[external]:[])]);
    return retain(async()=>{
      await ensureReady();operationId(input.operationId);let dispatched=false;
      try{
        dispatched=true;const started=await call('/api/action',{method:'POST',input:{action,input},signal:combined});
        const id=started.job?.id;need(typeof id==='string','GEOSERVER_CONSOLE_JOB');
        while(true){
          const observed=await call('/api/job?id='+encodeURIComponent(id),{signal:combined});
          need(observed.job?.id===id&&observed.job.operationId===input.operationId&&observed.job.action===action,
            'GEOSERVER_CONSOLE_JOB_CHANGED');
          if(observed.job.state!=='RUNNING'){
            const result=await call('/api/operation?id='+encodeURIComponent(input.operationId),{signal:combined});
            if(observed.job.state!=='COMPLETED')throw Object.assign(new Error(observed.job.error?.message??'The original operation was interrupted.'),
              {code:observed.job.error?.code??'GEOSERVER_OPERATION_INTERRUPTED',operation:result,job:observed.job});
            return {...result,job:observed.job};
          }
          await pause(750,combined);
        }
      }catch(error){
        if(dispatched&&combined.aborted){
          try{error.cancellation=await call('/api/cancel',{method:'POST',input:{operationId:input.operationId},cleanup:true});}
          catch(cleanup){error.cancellationError={code:cleanup.code,message:cleanup.message};}
        }
        throw error;
      }
    });
  }
  const get=(path,options={})=>retain(async()=>{await ensureReady();return call(path,{signal:options.signal??signal});});
  const close=()=>{
    if(closing)return closing;admission=false;lifetime.abort(new Error('The original GeoServer client is closing.'));
    closing=(async()=>{await Promise.allSettled([...jobs]);await Promise.allSettled([...pending]);})();return closing;
  };
  try{await ensureReady();}catch(error){await close();throw error;}
  return {connection:{schema:connection.schema,connectionFile,origin,instanceId:connection.instanceId,workspace:connection.workspace,
      profile:connection.profile},
    run,inspect:(id,options)=>get(id?'/api/operation?id='+encodeURIComponent(operationId(id)):'/api/state',options),
    target:options=>get('/api/target',options),
    source:(input,options={})=>retain(async()=>{await ensureReady();return call('/api/source',{method:'POST',input,signal:options.signal??signal});}),
    cancel:(input,options={})=>retain(async()=>{await ensureReady();return call('/api/cancel',{method:'POST',input,signal:options.signal??signal});}),
    close};
}
