// SPDX-License-Identifier: MIT
// Original SF88 collection/recovery services over the maintained MCP transport.
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdir,rm} from 'node:fs/promises';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {initializationDirectory as privateDirectory,initializationBytes as privateBytes,
  retainInitializationRecord as retainRecord}
  from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import {need,InputError} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/config.mjs';
import {createNativeCollections,nativeCollectionActions,nativeCollectionsSchema} from './native-collections.mjs';
import {createNativeCollectionRecovery,nativeCollectionRecoveryActions,nativeCollectionRecoverySchema,
  NATIVE_COLLECTION_RECOVERY_RECEIVER} from './native-collections-recovery.mjs';
import {createMcpToolHandler} from './http-tools.mjs';
import {loadOAuthResourceHost} from './oauth-host.mjs';

const TOOL='sf43_discover_review_and_pay';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const fail=code=>{throw new InputError(code);};
function path(v){
  need(typeof v==='string'&&isAbsolute(v)&&resolve(v)===v&&v!=='/'&&!v.includes('\0'),
    'MCP_COLLECTION_RECEIVER_PRIVATE_DIRECTORY_REQUIRED');return v;
}
async function originalManifest(directory){
  const root=path(directory);await privateDirectory(root);
  let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(
    await privateBytes(join(root,'collection-receiver.json'),65536)));}
  catch(error){if(error.code)throw error;fail('MCP_COLLECTION_RECEIVER_MANIFEST_INVALID');}
  need(plain(value)&&value.schema===NATIVE_COLLECTION_RECOVERY_RECEIVER&&value.directory===root&&
    UUID.test(value.id??'')&&typeof value.createdAt==='string'&&value.workspace===undefined&&
    Object.keys(value).every(k=>['schema','id','directory','createdAt'].includes(k)),
    'MCP_COLLECTION_RECEIVER_MANIFEST_INVALID');
  return value;
}
export const collectionReceiverTool=Object.freeze({
  name:TOOL,
  description:'Operate the host-registered original Request Collections and encrypted recovery journals. '
    +'Inspect exact profiles and saved operation IDs before verification, restoration or reopening. '
    +'Collection execution retains the separately owned original listener approval. '
    +'This receiver exposes no generic Bazaar purchase, quote, wallet or signing operation.',
  inputSchema:{type:'object',additionalProperties:false,required:['action'],
    properties:{action:{enum:[...nativeCollectionActions,...nativeCollectionRecoveryActions]},
      ...nativeCollectionsSchema.properties,...nativeCollectionRecoverySchema.properties},
    anyOf:[...nativeCollectionsSchema.anyOf,...nativeCollectionRecoverySchema.anyOf]}
});
export async function initializeCollectionReceiver({directory}={}){
  const root=path(directory);await privateDirectory(dirname(root));let created=false;
  try{
    await mkdir(root,{mode:0o700});created=true;await privateDirectory(root);
    const manifest={schema:NATIVE_COLLECTION_RECOVERY_RECEIVER,id:randomUUID(),
      directory:root,createdAt:new Date().toISOString()};
    await retainRecord(join(root,'collection-receiver.json'),manifest);
    return {...manifest,status:'COLLECTION_RECEIVER_CREATED',walletCreated:false,listenerStarted:false};
  }catch(error){if(created)await rm(root,{recursive:true,force:true}).catch(()=>{});throw error;}
}
export async function openCollectionReceiver(directory){
  const manifest=await originalManifest(directory),shutdown=new AbortController();
  let closing=null,closed=false;
  const collections=createNativeCollections({manifest,isClosed:()=>closed});
  const recovery=createNativeCollectionRecovery({manifest,registerCollections:collections.register,isClosed:()=>closed});
  const available=()=>need(!closed,'MCP_NATIVE_WORKSPACE_CLOSING');
  return Object.freeze({
    manifest:structuredClone(manifest),tools:[structuredClone(collectionReceiverTool)],
    async registerRecovery(description){available();return recovery.register(description);},
    async registerCollections(description){available();return collections.register(description);},
    async openedConnection(name,requestId){available();return recovery.openedConnection(name,requestId);},
    async call(args={},context={}){
      available();need(plain(args)&&plain(context)&&
        (context.signal===undefined||context.signal instanceof AbortSignal),
        'MCP_COLLECTION_RECEIVER_ARGUMENTS_INVALID');
      const signal=context.signal?AbortSignal.any([context.signal,shutdown.signal]):shutdown.signal;
      signal.throwIfAborted();
      if(nativeCollectionRecoveryActions.includes(args.action))return recovery.call(args,{signal});
      if(nativeCollectionActions.includes(args.action))return collections.call(args,{signal});
      fail('MCP_COLLECTION_RECEIVER_ACTION_UNAVAILABLE');
    },
    close(){
      if(closing)return closing;
      closed=true;shutdown.abort();
      closing=(async()=>{
        const outcomes=await Promise.allSettled([recovery.close(),collections.close()]);
        const failure=outcomes.find(v=>v.status==='rejected');if(failure)throw failure.reason;
      })();return closing;
    }
  });
}
/** Own only this MCP listener. The registered original collection services keep their own lifetime. */
export async function startCollectionReceiver({directory,port=0,environment=process.env,oauthFetchImpl}={}){
  need(Number.isSafeInteger(port)&&port>=0&&port<=65535,'MCP_COLLECTION_RECEIVER_PORT_INVALID');
  const native=await openCollectionReceiver(directory);
  let access,server,handler,closing=null,stopping=false,address;
  const requests=new Map(),sockets=new Set();
  function responseError(response){
    if(response.destroyed)return;
    if(response.headersSent){response.destroy();return;}
    response.writeHead(500,{'content-type':'application/json','cache-control':'no-store'});
    response.end(JSON.stringify({error:'MCP_COLLECTION_RECEIVER_REQUEST_FAILED'}));
  }
  try{
    access=await loadOAuthResourceHost({configPath:environment.MCP_OAUTH_CONFIG,
      bearerToken:environment.MCP_ACCESS_TOKEN,fetchImpl:oauthFetchImpl});
    const origins=(environment.MCP_CLIENT_ORIGINS??'').split(',').map(v=>v.trim()).filter(Boolean);
    server=createServer((request,response)=>{
      if(stopping){response.writeHead(503,{'connection':'close'});response.end();return;}
      let finish;const finished=new Promise(done=>{finish=done;});
      let end=false;
      const done=()=>{if(end)return;end=true;requests.delete(request);finish();};
      response.once('finish',done);response.once('close',done);
      const entry={response,finished,pending:null};requests.set(request,entry);
      entry.pending=Promise.resolve().then(()=>handler(request,response))
        .catch(()=>responseError(response));
    });
    server.requestTimeout=30000;server.headersTimeout=10000;server.keepAliveTimeout=1000;
    server.setTimeout(30000,socket=>socket.destroy());
    server.on('connection',socket=>{
      sockets.add(socket);socket.once('close',()=>sockets.delete(socket));
    });
    await new Promise((done,reject)=>{
      server.once('error',reject);
      server.listen(port,'127.0.0.1',()=>{server.off('error',reject);done();});
    });
    address='http://127.0.0.1:'+server.address().port;
    handler=access.wrap(createMcpToolHandler({tools:native.tools,
      call:(name,args)=>{need(name===TOOL,'TOOL_NOT_FOUND');return native.call(args);}},
      {...access.transportOptions,allowedClientOrigins:[...new Set([...origins,address])],
        serverName:'starforge-collections-receiver',serverVersion:'1.0.0',
        maxRequestBytes:256*1024,
        instructions:'This operator-selected host exposes original Request Collections and recovery only. '
          +'Use registered aliases and exact profile, request, record and file hashes. '
          +'After a lost reply inspect the same request ID. Verification does not restore. '
          +'Restoration and collection execution require their original separate source checks and approvals. '
          +'Closing this MCP host does not stop the original recovery listener or cancel its retained operations.'}));
  }catch(error){
    stopping=true;
    for(const socket of sockets)socket.destroy();
    if(server?.listening)await new Promise(done=>server.close(done));
    await access?.close().catch(()=>{});await native.close().catch(()=>{});throw error;
  }
  return Object.freeze({
    schema:'stellar-forge.mcp-collection-receiver-listener.v1',id:native.manifest.id,
    directory:native.manifest.directory,address,url:address+'/mcp',pid:process.pid,
    authorization:access.describe(),walletCreated:false,originalListenerOwned:false,
    get activeRequests(){return requests.size;},
    close(){
      if(closing)return closing;
      stopping=true;
      closing=(async()=>{
        const stopped=new Promise(done=>server.close(done)),admitted=[...requests.entries()];
        // Incomplete original bodies must end before the HTTP/native drain.
        for(const [request]of admitted)if(!request.readableEnded)request.destroy();
        let failure;
        try{await access.close();}catch(error){failure=error;}
        try{await native.close();}catch(error){failure??=error;}
        await Promise.allSettled(admitted.map(([,entry])=>entry.pending));
        await Promise.allSettled(admitted.map(([,entry])=>entry.finished));
        server.closeIdleConnections();
        for(const socket of sockets)socket.destroy();
        await stopped;
        if(failure)throw failure;
      })();return closing;
    }
  });
}
