// MIT. One leased Horizon stream feeding the existing Paycashless workspace journal.
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {openPaycashlessWorkspace} from './workspace.mjs';
import {buildRequest,describeConnection} from './native.mjs';
import {lease,need,now,publicError} from './files.mjs';
import {sha256,canonicalJSON,parseSourceJSON} from './source-json.mjs';
import {SSEFrameDecoder} from './settlement-sse.mjs';

const hash=value=>sha256(Buffer.from(canonicalJSON(value)));
const ACTIVE=row=>row.status==='ACTIVE';
function selectedConnection(row,configuration){
 const selected=configuration.connections?.[row.connectionAlias];
 need(selected,'STREAM_CONNECTION_NOT_CONFIGURED');
 const d=describeConnection(selected),pinned=row.connection??{};
 for(const field of ['provider','environment','baseUrl','networkPassphrase'])
  need(d[field]===pinned[field],'STREAM_CONNECTION_CHANGED',{field});
 need(d.provider==='horizon','STREAM_HORIZON_REQUIRED');return selected;
}
function retainedRequest(workspace,id){
 try{return workspace.item('requests',id);}catch(error){if(error.code==='RECORD_NOT_FOUND')return null;throw error;}
}
function retryDelay(response,fallback){
 const raw=response.headers.get('retry-after');if(raw===null)return fallback;
 const milliseconds=/^\d+$/.test(raw)?Number(raw)*1000:Date.parse(raw)-Date.now();
 need(Number.isFinite(milliseconds)&&milliseconds<=8.64e15-Date.now(),'STREAM_RETRY_AFTER_INVALID');
 return Math.max(fallback,milliseconds,0);
}
export async function startSettlementStreamWorker({
 directory,configuration={},workspace:provided,streamId,signal,onResult=()=>{},fetchImpl=globalThis.fetch,
 idleMilliseconds=60000,reconnectMilliseconds=1000,
}={}){
 need(typeof streamId==='string'&&streamId.length>0,'STREAM_ID_REQUIRED');
 need(Number.isSafeInteger(idleMilliseconds)&&idleMilliseconds>=15000,'STREAM_IDLE_INTERVAL');
 need(Number.isSafeInteger(reconnectMilliseconds)&&reconnectMilliseconds>=250,'STREAM_RECONNECT_INTERVAL');
 need(typeof fetchImpl==='function','STREAM_FETCH_REQUIRED');
 const workspace=provided??await openPaycashlessWorkspace({directory,connections:configuration.connections??{},name:configuration.name,
  sourceDirectory:configuration.sourceDirectory,runtimeDirectory:configuration.runtimeDirectory,expectedManifestSha256:configuration.expectedManifestSha256});
 let guard;try{guard=await lease(workspace.directory,'settlement-stream-'+hash(streamId));}catch(error){if(!provided)await workspace.close();throw error;}
 const controller=new AbortController(),abort=()=>controller.abort(signal?.reason??'worker-stopping');
 signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 const instance=randomUUID();let activeReader=null,activeConnection=null,idleTimer=null,pauseTimer=null,closePromise;
 const report=async value=>{await onResult({at:now(),streamId,...value});};
 async function status(state,message,extra={}){
  return workspace.command({requestId:'stream-status:'+randomUUID(),method:'stream.status',args:{streamId,state,message,...extra}});
 }
 async function pauseHTTP204(){
  await status('STOPPED','Horizon returned HTTP 204; the selected stream is stopped.',{httpStatus:204});
  await workspace.command({requestId:'stream-stop:'+randomUUID(),method:'stream.pause',args:{streamId,paused:true}});
 }
 async function waitUntil(at){
  while(Date.now()<at&&!controller.signal.aborted){
   if(!ACTIVE(workspace.item('streams',streamId)))return false;
   await delay(Math.min(5000,at-Date.now()),undefined,{signal:controller.signal});
  }
  return !controller.signal.aborted;
 }
 async function commit(frame,requestURL,responseHeaders,requestCursor){
  if(frame.retry!==null)reconnectMilliseconds=Math.max(250,frame.retry);
  if(frame.event==='close')return 'close';
  if(frame.data===null)return 'control';
  need(!frame.event||frame.event==='message','STREAM_EVENT_TYPE_UNSUPPORTED');
  const parsed=parseSourceJSON(Buffer.from(frame.data),{maxBytes:16*1024*1024}),token=parsed.value?.paging_token;
  need(typeof token==='string'&&/^\d+$/.test(token),'STREAM_PAGING_TOKEN_REQUIRED');
  const id='stream-event:'+hash([streamId,token,frame.data]),prior=retainedRequest(workspace,id);
  if(prior){
   need(prior.method==='stream.commit'&&prior.args?.streamId===streamId&&prior.args.dataJSON===frame.data,'STREAM_REPLAY_IDENTITY_CHANGED');
   if(prior.status==='FAILED')throw Object.assign(new Error(prior.error?.message??'Original stream commit failed.'),prior.error??{code:'STREAM_COMMIT_FAILED'});
   if(prior.status!=='COMPLETE')await workspace.command({requestId:id,method:prior.method,args:prior.args});
   const current=workspace.item('streams',streamId);await report({state:'REPLAYED',cursor:current.cursor,requestId:id});return 'committed';
  }
  const current=workspace.item('streams',streamId);if(!ACTIVE(current))return 'paused';
  const args={streamId,expectedCursor:current.cursor,requestCursor,eventId:frame.id,dataJSON:frame.data,rawBase64:Buffer.from(frame.raw).toString('base64'),
   requestURL,responseHeaders,observedAt:now()};
  const result=await workspace.command({requestId:id,method:'stream.commit',args});
  const retained=workspace.item('streams',streamId);
  await report({state:'COMMITTED',cursor:retained.cursor,requestId:id,result:result.result});return 'committed';
 }
 const done=(async()=>{
  let failures=0,networkChecked=false,terminalFailure=false,outcome;
  try{
   for(;;){
    if(controller.signal.aborted)break;
    const row=workspace.item('streams',streamId);if(!ACTIVE(row))break;
    const selected=selectedConnection(row,configuration);
    need(typeof row.cursor==='string'&&/^\d+$/.test(row.cursor),'STREAM_STABLE_CURSOR_REQUIRED');
    const selectedRetryAt=row.retryAt??row.lastObservation?.retryAt;
    if(selectedRetryAt){const at=Date.parse(selectedRetryAt);need(Number.isFinite(at),'STREAM_RETRY_AT_INVALID');if(!await waitUntil(at))break;}
    // Use the original capture machinery once per owned worker start to retain
    // and validate this configured endpoint's actual network before streaming.
    if(!networkChecked){
     const started=await workspace.command({requestId:'stream-network-start:'+instance,method:'capture.start',
      args:{connectionAlias:row.connectionAlias,action:'horizon.network.get',input:{}}});
     const capture=await workspace.command({requestId:'stream-network-read:'+instance,method:'capture.run',
      args:{captureId:started.result.id,maxPages:1},signal:controller.signal});
     need(capture.result?.status==='COMPLETE','STREAM_NETWORK_SOURCE_INCOMPLETE');
     need(capture.result.pages?.length===1,'STREAM_NETWORK_SOURCE_REQUIRED');
     const networkSource=workspace.item('sources',capture.result.pages[0].sourceId);
     need(networkSource.action==='horizon.network.get'&&networkSource.connectionAlias===row.connectionAlias&&
      networkSource.environment===row.environment&&networkSource.bodyComplete===true&&
      !networkSource.projectionError&&!networkSource.error&&networkSource.classification?.outcome==='accepted',
      'STREAM_NETWORK_SOURCE_INVALID');
     const networks=(networkSource.versionIds??[]).map(id=>workspace.item('resourceVersions',id))
      .filter(version=>version.kind==='horizon-network');
     need(networks.length===1&&networks[0].sourceId===networkSource.id&&
      networks[0].connectionAlias===row.connectionAlias&&networks[0].environment===row.environment&&
      typeof networks[0].value?.network_passphrase==='string'&&
      networks[0].value.network_passphrase===selected.networkPassphrase,
      'STREAM_NETWORK_PASSPHRASE_MISMATCH');
     networkChecked=true;
    }
    const request=buildRequest(selected,'horizon.payments.account',{params:{accountId:row.accountId},
     query:{cursor:row.cursor,order:'asc',join:'transactions',include_failed:true,limit:100}});
    const headers={...request.headers,Accept:'text/event-stream'};
    if(row.lastEventId&&row.lastEventId===row.cursor)headers['Last-Event-ID']=row.lastEventId;
    activeConnection=new AbortController();
    const stopConnection=()=>activeConnection?.abort(controller.signal.reason??'worker-stopping');
    controller.signal.addEventListener('abort',stopConnection,{once:true});
    const armIdle=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(()=>activeConnection?.abort('stream-idle-timeout'),idleMilliseconds);};
    let response=null,retryIn=reconnectMilliseconds,stop=false,phase='network';
    try{
     await status('CONNECTING','Opening the original Horizon account stream.');
     armIdle();
     pauseTimer=setInterval(()=>{try{if(!ACTIVE(workspace.item('streams',streamId)))activeConnection?.abort('stream-paused');}catch(error){activeConnection?.abort(error);}},2000);
     response=await fetchImpl(request.url,{method:'GET',headers,redirect:'error',cache:'no-store',signal:activeConnection.signal});
     armIdle();
     if(response.status===204){await pauseHTTP204();stop=true;}
     else if(response.status===429||response.status===408||response.status>=500){
      retryIn=retryDelay(response,Math.max(reconnectMilliseconds,Math.min(60000,1000*2**Math.min(failures,6))));
      failures++;await status('RETRYING','Horizon requested a later connection.',{httpStatus:response.status,retryAt:new Date(Date.now()+retryIn).toISOString()});
     }else{
      need(response.status===200,'STREAM_HTTP_REJECTED',{status:response.status});
      need(response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()==='text/event-stream','STREAM_CONTENT_TYPE_INVALID');
      need(response.body,'STREAM_BODY_REQUIRED');
      const responseHeaders=Object.fromEntries(response.headers.entries()),decoder=new SSEFrameDecoder();
      activeReader=response.body.getReader();phase='reading';await status('CONNECTED','Receiving original Horizon events.',{httpStatus:200});
      while(!controller.signal.aborted&&ACTIVE(workspace.item('streams',streamId))){
       const read=await activeReader.read();armIdle();
       if(read.done){
        const ended=decoder.finish();
        for(const frame of ended.frames){phase='committing';const outcome=await commit(frame,request.url,responseHeaders,row.cursor);phase='reading';if(outcome==='close'||outcome==='paused')break;}
        if(ended.discardedBytes)await report({state:'PARTIAL_FRAME_DISCARDED',bytes:ended.discardedBytes,cursor:workspace.item('streams',streamId).cursor});
        break;
       }
       let closeEvent=false;
       for(const frame of decoder.feed(read.value)){
        phase='committing';const outcome=await commit(frame,request.url,responseHeaders,row.cursor);phase='reading';
        if(outcome==='committed')failures=0;
        if(outcome==='close'||outcome==='paused'){closeEvent=true;break;}
       }
       if(closeEvent)break;
      }
     }
    }catch(error){
     if(controller.signal.aborted||!ACTIVE(workspace.item('streams',streamId)))break;
     const network=phase!=='committing'&&(error.name==='TypeError'||error.name==='AbortError'||activeConnection.signal.reason==='stream-idle-timeout');
     if(!network){await status('ERROR',error.code??error.message);throw error;}
     failures++;retryIn=Math.max(reconnectMilliseconds,Math.min(60000,1000*2**Math.min(failures,6)));
     await status('RETRYING','The stream connection ended; retained events and cursor remain selected.',{retryAt:new Date(Date.now()+retryIn).toISOString()});
     await report({state:'RETRYING',error:publicError(error),retryMilliseconds:retryIn});
    }finally{
     clearTimeout(idleTimer);clearInterval(pauseTimer);controller.signal.removeEventListener('abort',stopConnection);
     try{await activeReader?.cancel();}catch{}activeReader=null;
     try{await response?.body?.cancel();}catch{}
     activeConnection?.abort('connection-finished');activeConnection=null;
    }
    if(stop||controller.signal.aborted||!ACTIVE(workspace.item('streams',streamId)))break;
    retryIn=Math.max(retryIn,reconnectMilliseconds);const retryAt=Date.now()+retryIn;
    need(Number.isFinite(retryAt)&&retryAt<=8.64e15,'STREAM_RETRY_RANGE');
    await status('RETRYING','Resuming the same saved Horizon cursor.',{retryAt:new Date(retryAt).toISOString()});
    if(!await waitUntil(retryAt))break;
   }
   outcome={stream:workspace.item('streams',streamId),stopped:true};return outcome;
  }catch(error){if(controller.signal.aborted){outcome={stream:workspace.item('streams',streamId),stopped:true};return outcome;}terminalFailure=true;try{await status('ERROR',error.code??error.message);}catch{}await report({state:'ERROR',error:publicError(error)});throw error;}
  finally{
   clearTimeout(idleTimer);clearInterval(pauseTimer);signal?.removeEventListener('abort',abort);
   try{await activeReader?.cancel();}catch{}activeConnection?.abort('worker-finished');
   try{
    const stopped=workspace.item('streams',streamId);
    if(!terminalFailure&&stopped.runtimeState!=='ERROR'&&stopped.runtimeState!=='STOPPED')
     await status('STOPPED',stopped.status==='PAUSED'?'The selected stream is paused; the owned connection is closed.':'The owned stream worker stopped; committed events and cursor are retained.',
      {retryAt:stopped.retryAt??null});
    if(outcome)outcome.stream=workspace.item('streams',streamId);
   }finally{try{if(!provided)await workspace.close();}finally{await guard.release();}}
  }
 })();done.catch(()=>{});
 function close(){if(!closePromise){controller.abort('worker-stopping');closePromise=done;}return closePromise;}
 return {workspace,streamId,done,close,identity:guard.owner};
}
