// MIT. Native Merchant tools join the same browser listener and retained snapshots.
import {constants} from 'node:fs';
import {open,lstat,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {RetainedFileReads} from '../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import {readWebhookFeedConfiguration,privateBytes,privateJson} from './connection.mjs';
import {openWebhookFeedOperator} from './operator.mjs';
import {validateWebhookArguments} from './catalog.mjs';
import {restoreWebhookSnapshot,writeOriginal} from './receiving.mjs';
import {PREFIX,SESSION_SCHEMA,MANIFEST_SCHEMA,MANIFEST_NAME,MAX_FILE_BYTES,STORE,need,id,encode,decode,digest,parseSnapshotManifest} from './contracts.mjs';
export {readWebhookFeedConfiguration};
export class MerchantWebhookFeeds{
 #config;#reads=new RetainedFileReads({errorPrefix:'WEBHOOK_OPERATIONS',maxImmutableFileBytes:MAX_FILE_BYTES});#pending=new Set();#closing=false;#closed;
 constructor(config){this.#config=config.webhookFeeds??{workspaces:{},receivers:{}};}
 get summary(){return {configured:Object.keys(this.#config.workspaces),receivers:Object.keys(this.#config.receivers??{}),closing:this.#closing,...this.#reads.summary};}
 #definition(alias){id(alias,'workspace alias');const value=this.#config.workspaces[alias];need(value,'WEBHOOK_OPERATIONS_WORKSPACE_NOT_CONFIGURED');return value;}
 async #manifest(alias,exportId){
  const definition=this.#definition(alias);id(exportId,'snapshot name');
  const session=await privateJson(definition.sessionFile,32768);
  need(session.schema===SESSION_SCHEMA&&session.directory===definition.directory&&STORE.test(session.storeId??'')&&(!definition.expectedStoreId||definition.expectedStoreId===session.storeId),'WEBHOOK_OPERATIONS_SESSION_CHANGED');
  const directory=join(definition.directory,'snapshots',exportId);need(await realpath(directory)===directory,'WEBHOOK_OPERATIONS_PRIVATE_PATH_REQUIRED');
  const original=await privateBytes(join(directory,'snapshot.json'),65536),snapshot=decode(original);
  need(snapshot.schema==='stellar-forge.webhook-feed-backup.v1'&&snapshot.storeId===session.storeId&&snapshot.database?.name==='events.sqlite','WEBHOOK_OPERATIONS_MANIFEST_CHANGED');
  const files=[{name:'snapshot.json',bytes:original.length,sha256:digest(original),contentType:'application/json'},{name:'events.sqlite',bytes:snapshot.database.bytes,sha256:snapshot.database.sha256,contentType:'application/vnd.sqlite3'}];
  const manifest={schema:MANIFEST_SCHEMA,exportId,storeId:snapshot.storeId,createdAt:snapshot.createdAt,originalManifestSha256:files[0].sha256,highWatermark:snapshot.highWatermark,acceptedEvents:snapshot.acceptedEvents,retainedEvents:snapshot.retainedEvents,purgedThroughSequence:snapshot.purgedThroughSequence,files,bytes:files.reduce((sum,item)=>sum+item.bytes,0)};
  const bytes=encode(manifest);parseSnapshotManifest(bytes,exportId);
  const info=await lstat(join(directory,'events.sqlite'));need(info.isFile()&&!info.isSymbolicLink()&&info.size===files[1].bytes,'WEBHOOK_OPERATIONS_FILE_CHANGED');
  return {directory,manifest,bytes,sha256:digest(bytes)};
 }
 async #file(args){
  const selected=await this.#manifest(args.workspace,args.exportId);
  need(selected.sha256===args.expectedManifestSha256,'WEBHOOK_OPERATIONS_MANIFEST_CHANGED');
  const isManifest=args.file===MANIFEST_NAME,item=isManifest?{name:MANIFEST_NAME,bytes:selected.bytes.length,sha256:selected.sha256,contentType:'application/json'}:selected.manifest.files.find(item=>item.name===args.file);
  need(item&&item.sha256===args.expectedSha256,'WEBHOOK_OPERATIONS_FILE_CHANGED');
  const result=await this.#reads.read({scope:args.workspace,key:args.exportId+':'+item.name,kind:'webhook-snapshot',directory:selected.directory,readId:args.readId,expectedSha256:args.expectedSha256,offset:args.offset??0,limit:args.limit??65536,
   load:async()=>{
    if(isManifest)return {name:item.name,type:item.contentType,bytes:selected.bytes};
    const handle=await open(join(selected.directory,item.name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    return {readonlyFileHandle:handle,name:item.name,type:item.contentType,bytes:item.bytes,sha256:item.sha256};
   }});
  return {workspace:args.workspace,exportId:args.exportId,manifestSha256:selected.sha256,...result};
 }
 async #execute(action,args,{signal}={}){
  signal?.throwIfAborted();
  if(action==='workspaces')return {workspaces:Object.entries(this.#config.workspaces).map(([workspace,value])=>({workspace,label:value.label,expectedStoreId:value.expectedStoreId})),receivers:Object.keys(this.#config.receivers??{})};
  const definition=this.#definition(args.workspace);
  if(action==='file_release'){await this.#reads.release(args.workspace,args.readId);return {workspace:args.workspace,exportId:args.exportId,readId:args.readId,state:'RELEASED'};}
  if(action==='file')return this.#file(args);
  if(action==='manifest'||action==='receive'){
   const selected=await this.#manifest(args.workspace,args.exportId);
   if(action==='manifest')return {state:'MANIFEST_RETAINED',workspace:args.workspace,exportId:args.exportId,manifest:selected.manifest,manifestFile:{name:MANIFEST_NAME,bytes:selected.bytes.length,sha256:selected.sha256}};
   need(selected.sha256===args.expectedManifestSha256,'WEBHOOK_OPERATIONS_MANIFEST_CHANGED');
   const receiver=this.#config.receivers?.[args.receiver];need(receiver,'WEBHOOK_OPERATIONS_RECEIVER_NOT_CONFIGURED');
   // The wrapper manifest is an immutable companion to the original two files.
   await writeOriginal(join(selected.directory,MANIFEST_NAME),selected.bytes);
   const result=await restoreWebhookSnapshot({directory:selected.directory,destination:receiver.directory,exportId:args.exportId,expectedManifestSha256:selected.sha256});
   return {workspace:args.workspace,receiver:args.receiver,...result};
  }
  const native=await openWebhookFeedOperator(definition,{signal}),{workspace,...input}=args;
  const result=await native.call(action,input);return Array.isArray(result)?{workspace,events:result}:{workspace,...result};
 }
 call(name,args={},options={}){
  const action=validateWebhookArguments(name,args);need(!this.#closing,'WEBHOOK_OPERATIONS_CLOSING');
  const promise=this.#execute(action,args,options);this.#pending.add(promise);promise.finally(()=>this.#pending.delete(promise)).catch(()=>{});return promise;
 }
 close(){
  if(this.#closed)return this.#closed;this.#closing=true;
  const promise=(async()=>{await Promise.allSettled([...this.#pending]);await this.#reads.close();})();
  this.#closed=promise;promise.catch(()=>{if(this.#closed===promise)this.#closed=null;});return promise;
 }
}
