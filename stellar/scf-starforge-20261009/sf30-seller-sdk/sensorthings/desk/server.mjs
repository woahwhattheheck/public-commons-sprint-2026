// MIT. Complete Operations Desk on the existing native SensorThings listener.
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {readBrowserAssets} from '../../../distribution/browser-assets.mjs';
import {serveSensorThingsWorkspace} from '../server.mjs';
import {createDeskInbox} from './inbox.mjs';
import {DESK_STARTUP_SCHEMA,deskSourceIdentity,writeDeskLaunch} from './managed-launch.mjs';
import {fault} from '../contract.mjs';
export async function createDeskStaticHandler(){
  const map=await readBrowserAssets(new URL('./browser-assets.json',import.meta.url)),assets=new Map();
  for(const [path,item]of map)assets.set(path,{type:item.type,bytes:await readFile(item.url)});
  return async(req,res,{url})=>{
    const asset=assets.get(url.pathname);if(!asset)return false;
    if(req.method!=='GET'&&req.method!=='HEAD')return false;
    res.writeHead(200,{'Content-Type':asset.type,'Content-Length':asset.bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});res.end(req.method==='HEAD'?undefined:asset.bytes);return true;
  };
}
export async function serveSensorThingsDesk(options={}){
  if(options.host!==undefined&&options.host!=='127.0.0.1')throw fault('DESK_BIND','The managed Operations Desk binds its original loopback host.');
  const instanceId=randomUUID(),inbox=createDeskInbox({sourceInboxDirectory:options.sourceInboxDirectory??null,instanceId}),
    staticHandler=await createDeskStaticHandler(),source=await deskSourceIdentity();
  let running,closePromise=null;
  try{
    running=await serveSensorThingsWorkspace({...options,host:'127.0.0.1',staticHandler,extraApiHandler:inbox.handleApi});
    const record={schema:DESK_STARTUP_SCHEMA,status:'SENSORTHINGS_DESK_READY',directory:running.workspace.directory,
      workspaceId:running.workspaceId,pid:process.pid,instanceId,origin:running.origin,url:running.url,
      sourceDirectory:source.sourceDirectory,sourceSha256:source.sha256,sourceFiles:source.files,
      sourceInboxDirectory:options.sourceInboxDirectory??null,buyerWorkspaceDirectory:options.buyerWorkspaceDirectory??null,
      releaseRuntimeFile:options.releaseRuntimeFile??null,startedAt:new Date().toISOString()};
    // Confirm the native authenticated hook is composed before announcing a
    // usable Desk. Its original server remains the authority for these checks.
    const probe=await fetch(running.origin+'/api/desk/info',{headers:{Authorization:'Bearer '+new URL(running.url).hash.slice(1),'X-SensorThings-Workspace':running.workspaceId},signal:AbortSignal.timeout(10000)});
    const info=await probe.json();
    if(!probe.ok||info.instanceId!==instanceId||info.workspaceId!==running.workspaceId)throw fault('DESK_NATIVE_API_JOIN_REQUIRED','The selected original server must include its authenticated extraApiHandler join.',409);
    await writeDeskLaunch(running.workspace,record);
    function close(){if(!closePromise)closePromise=(async()=>{await running.close();await inbox.close();})();return closePromise;}
    return {...running,record,close};
  }catch(e){if(running)await running.close().catch(()=>{});await inbox.close().catch(()=>{});throw e;}
}
