// MIT. One managed owner for the original receiver, merchant and private operator.
import {randomUUID} from 'node:crypto';
import {mkdir,open,rename,lstat,realpath} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {EventFeedStore} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/webhook-feed/store.mjs';
import {startWebhookReceiver} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/webhook-feed/receiver.mjs';
import {startWebhookFeedWorkspace} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/webhook-feed/workspace.mjs';
import {startWebhookFeedMerchant} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/webhook-feed/merchant.mjs';
import {operationLease,privateDirectory} from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import {SESSION_SCHEMA,STORE,need,exact,encode} from './contracts.mjs';
import {privateJson} from './connection.mjs';
export const SOURCE_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export async function inspectWebhookStore(directory,{allowMissing=false}={}){
 directory=resolve(directory);let info;
 try{info=await lstat(join(directory,'events.sqlite'));}catch(error){if(allowMissing&&error.code==='ENOENT')return null;throw error;}
 need(info.isFile()&&!info.isSymbolicLink()&&await realpath(directory)===directory,'WEBHOOK_OPERATIONS_STORE_REQUIRED');
 const db=new DatabaseSync(join(directory,'events.sqlite'),{readOnly:true});
 try{const storeId=db.prepare("SELECT value FROM metadata WHERE key='storeId'").get()?.value;need(STORE.test(storeId??'')&&db.prepare('PRAGMA user_version').get().user_version===1,'WEBHOOK_OPERATIONS_STORE_REQUIRED');return {directory,storeId};}finally{db.close();}
}
export async function readRuntimeOptions(file){
 if(!file)return {receiverPort:0,merchantPort:null,facilitator:null,allowLocalFacilitator:false};
 const raw=await privateJson(file,65536);exact(raw,['receiverPort','merchantPort','facilitator','allowLocalFacilitator']);
 for(const name of ['receiverPort','merchantPort'])need(raw[name]===undefined||raw[name]===null||Number.isInteger(raw[name])&&raw[name]>=0&&raw[name]<=65535,'WEBHOOK_OPERATIONS_INVALID_PORT');
 need(raw.allowLocalFacilitator===undefined||typeof raw.allowLocalFacilitator==='boolean','WEBHOOK_OPERATIONS_CONFIGURATION_INVALID');
 need(raw.facilitator===undefined||raw.facilitator===null||typeof raw.facilitator==='string'&&raw.facilitator.length>0,'WEBHOOK_OPERATIONS_INVALID_FACILITATOR');
 if(raw.facilitator){const url=new URL(raw.facilitator);need(!url.username&&!url.password&&!url.search&&!url.hash&&(url.protocol==='https:'||raw.allowLocalFacilitator===true&&url.protocol==='http:'&&url.hostname==='127.0.0.1'),'WEBHOOK_OPERATIONS_INVALID_FACILITATOR');}
 need(!raw.allowLocalFacilitator||raw.facilitator,'WEBHOOK_OPERATIONS_INVALID_FACILITATOR');
 return {receiverPort:raw.receiverPort===undefined?0:raw.receiverPort,merchantPort:raw.merchantPort??null,facilitator:raw.facilitator??null,allowLocalFacilitator:raw.allowLocalFacilitator??false};
}
async function atomicSession(file,value){
 const temporary=file+'.'+randomUUID()+'.next',handle=await open(temporary,'wx',0o600);
 try{await handle.writeFile(encode(value));await handle.sync();}finally{await handle.close();}
 await rename(temporary,file);const parent=await open(dirname(file),'r');try{await parent.sync();}finally{await parent.close();}
}
async function nativeFactory(options){
 if(!options.facilitator)return null;
 const [{HTTPFacilitatorClient},{createNativeSellerServer}]=await Promise.all([import('@x402/core/server'),import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/native-factory.mjs')]);
 return compiled=>createNativeSellerServer(compiled,{facilitatorClient:new HTTPFacilitatorClient({url:options.facilitator.replace(/\/$/,'')})});
}
export async function startWebhookOperations({directory,port=0,runtimeFile,expectedStoreId,operationId=randomUUID()}={}){
 need(typeof directory==='string'&&directory.length>0,'WEBHOOK_OPERATIONS_STATE_REQUIRED');directory=resolve(directory);
 need(directory!=='/'&&Number.isInteger(port)&&port>=0&&port<=65535,'WEBHOOK_OPERATIONS_CONFIGURATION_INVALID');
 need(typeof operationId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(operationId),'WEBHOOK_OPERATIONS_OPERATION_REQUIRED');
 if(expectedStoreId!==undefined)need(STORE.test(expectedStoreId),'WEBHOOK_OPERATIONS_STORE_REQUIRED');
 await mkdir(directory,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});await privateDirectory(directory);
 const lease=await operationLease(join(directory,'.webhook-operations.lock')),sessions=[];let store,session,closing,complete=false,workspace;
 const sessionFile=join(directory,'.webhook-operations-session.json');
 function close(){
  if(complete)return Promise.resolve();if(closing)return closing;
  const attempt=(async()=>{let failure;for(const item of [...sessions].reverse())try{await item.close();}catch(error){failure??=error;}if(failure)throw failure;
   if(session)await atomicSession(sessionFile,{...session,state:'STOPPED',url:null,closedAt:new Date().toISOString()});
   store?.close();await lease.close();complete=true;})();
  closing=attempt;attempt.catch(()=>{if(closing===attempt)closing=null;});return attempt;
 }
 try{
  const options=await readRuntimeOptions(runtimeFile);
  if(expectedStoreId){const original=await inspectWebhookStore(directory);need(original.storeId===expectedStoreId,'WEBHOOK_OPERATIONS_STORE_CHANGED');}
  store=new EventFeedStore(directory);
  const binding={schema:SESSION_SCHEMA,instanceId:randomUUID(),operationId,directory,storeId:store.storeId,pid:process.pid,sourceRoot:SOURCE_ROOT,startedAt:new Date().toISOString()};
  let receiver=null,merchant=null;
  if(options.receiverPort!==null){const native=await startWebhookReceiver({store,port:options.receiverPort});sessions.push(native);receiver={url:native.url};}
  if(options.merchantPort!==null){const native=await startWebhookFeedMerchant({store,plan:store.merchantPlan().plan,port:options.merchantPort,nativeFactory:await nativeFactory(options)});sessions.push(native);merchant={url:native.url,mode:native.mode,feeds:native.feeds};}
  workspace=await startWebhookFeedWorkspace({store,port,operation:{...binding,receiver,merchant}});sessions.push(workspace);
  session={...binding,state:'READY',url:workspace.url,receiver,merchant,runtimeFile:runtimeFile?resolve(runtimeFile):null,sessionFile};
  await atomicSession(sessionFile,session);return {session,store,workspace,close};
 }catch(error){await close().catch(cleanup=>{error.cleanupCode=cleanup.code??'WEBHOOK_OPERATIONS_CLOSE_FAILED';});throw error;}
}
export async function managedMain(argv=process.argv.slice(2)){
 const flags=new Set(['--state','--port','--runtime-file','--expected-store-id','--operation-id']),value={};
 if(argv.length===1&&argv[0]==='--help'){process.stdout.write('webhook-operations-workspace --state PRIVATE_DIRECTORY [--runtime-file JSON] [--port 0]\n');return;}
 need(argv.length%2===0,'WEBHOOK_OPERATIONS_ARGUMENTS_INVALID');
 for(let i=0;i<argv.length;i+=2){need(flags.has(argv[i])&&!Object.hasOwn(value,argv[i])&&typeof argv[i+1]==='string'&&!argv[i+1].startsWith('--'),'WEBHOOK_OPERATIONS_ARGUMENTS_INVALID');value[argv[i]]=argv[i+1];}
 need(value['--state'],'WEBHOOK_OPERATIONS_STATE_REQUIRED');const port=value['--port']??'0';need(/^(0|[1-9]\d{0,4})$/.test(port),'WEBHOOK_OPERATIONS_INVALID_PORT');
 let owner,stopping=false,resolveStopped;const stopped=new Promise(done=>{resolveStopped=done;});
 const stop=()=>{stopping=true;if(owner)owner.close().then(resolveStopped,error=>{process.stderr.write(JSON.stringify({error:error.code??'WEBHOOK_OPERATIONS_CLOSE_FAILED'})+'\n');process.exitCode=1;resolveStopped();});};
 process.on('SIGTERM',stop);process.on('SIGINT',stop);
 try{owner=await startWebhookOperations({directory:value['--state'],port:Number(port),runtimeFile:value['--runtime-file'],expectedStoreId:value['--expected-store-id'],operationId:value['--operation-id']});if(stopping){await owner.close();return;}
  process.stdout.write(JSON.stringify(owner.session)+'\n');await stopped;
 }finally{if(owner)await owner.close();process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))managedMain().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'WEBHOOK_OPERATIONS_FAILED',message:error.message})+'\n');process.exitCode=1;});
