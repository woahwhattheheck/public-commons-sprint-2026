// SPDX-License-Identifier: MIT
import {constants} from 'node:fs';
import {open,mkdir,lstat} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {RetainedFileReads} from './retained-file-reads.mjs';
import {privateDirectory,regular,saveJSON} from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import {createGraviteeWorkspaceClient} from '../../products/gravitee-merchant/client.mjs';
import {writeImmutableBytes} from '../../products/gravitee-merchant/store.mjs';
import {validateGraviteeAction} from '../../products/gravitee-merchant/actions.mjs';
import {sha256,hashJSON,requireValue,object} from '../../products/gravitee-merchant/contract.mjs';
import {GRAVITEE_METHODS,GRAVITEE_ALIAS,GRAVITEE_SHA,GRAVITEE_UUID,graviteeWorkspaceTools} from './catalog/gravitee-workspace.mjs';
export {graviteeWorkspaceTools} from './catalog/gravitee-workspace.mjs';
export const GRAVITEE_CONNECTION_SCHEMA='stellar-forge.gravitee-workspace-connection.v1';
async function privateFile(path,maximum=1024*1024){
 const info=await lstat(path);requireValue(info.isFile()&&!info.isSymbolicLink()&&!(info.mode&0o077)&&(typeof process.getuid!=='function'||info.uid===process.getuid()),'GRAVITEE_PRIVATE_FILE_REQUIRED');
 return regular(path,maximum);
}
async function privateFolder(path){try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}return privateDirectory(path);}
export async function readGraviteeWorkspaceConfiguration(path){
 path=resolve(path);const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await privateFile(path)));
 requireValue(value.schema===GRAVITEE_CONNECTION_SCHEMA&&object(value.workspaces)&&Object.keys(value.workspaces).length,'GRAVITEE_CONNECTION_INVALID');
 const workspaces=Object.create(null);
 for(const[alias,item]of Object.entries(value.workspaces)){
  requireValue(GRAVITEE_ALIAS.test(alias)&&object(item)&&typeof item.label==='string'&&GRAVITEE_UUID.test(item.workspaceId),'GRAVITEE_WORKSPACE_DECLARATION_INVALID');
  requireValue(Boolean(item.consoleUrlFile)!==Boolean(item.consoleUrlEnv),'GRAVITEE_WORKSPACE_URL_SOURCE_REQUIRED');
  const selected={label:item.label,workspaceId:item.workspaceId};
  if(item.consoleUrlFile)selected.consoleUrlFile=resolve(dirname(path),item.consoleUrlFile);
  else{requireValue(/^[A-Za-z_][A-Za-z0-9_]*$/.test(item.consoleUrlEnv),'GRAVITEE_URL_ENVIRONMENT_INVALID');selected.consoleUrlEnv=item.consoleUrlEnv;}
  workspaces[alias]=selected;
 }
 return{schema:GRAVITEE_CONNECTION_SCHEMA,workspaces};
}
export class MerchantGraviteeWorkspaces{
 #config;#environment;#fetch;#pending=new Set();#controller=new AbortController();#closed=false;
 #reads=new RetainedFileReads({errorPrefix:'GRAVITEE_EXPORT'});
 constructor(config,{environment=process.env,fetch=globalThis.fetch}={}){this.#config=config;this.#environment=environment;this.#fetch=fetch;}
 get summary(){return{configured:Boolean(this.#config.graviteeWorkspaces),...this.#reads.summary,workspaces:Object.entries(this.#config.graviteeWorkspaces?.workspaces??{}).map(([workspace,value])=>({workspace,label:value.label,workspaceId:value.workspaceId}))};}
 async #using(alias,fn){
  requireValue(GRAVITEE_ALIAS.test(alias),'GRAVITEE_ALIAS_INVALID');const definition=this.#config.graviteeWorkspaces?.workspaces?.[alias];
  requireValue(definition,'GRAVITEE_WORKSPACE_NOT_CONFIGURED');const raw=definition.consoleUrlFile?new TextDecoder('utf-8',{fatal:true}).decode(await privateFile(definition.consoleUrlFile,4096)).trim():this.#environment[definition.consoleUrlEnv];
  const url=new URL(raw);requireValue(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&url.pathname==='/'&&!url.search&&GRAVITEE_SHA.test(url.hash.slice(1)),'GRAVITEE_LOCAL_WORKSPACE_URL_REQUIRED');
  const client=createGraviteeWorkspaceClient({url:url.href,workspaceId:definition.workspaceId,fetch:this.#fetch});
  const current=await client.action('view',{}, {signal:this.#controller.signal});requireValue(current.workspaceId===definition.workspaceId,'GRAVITEE_WORKSPACE_ID_CHANGED');
  return fn(client,definition);
 }
 async #root(){await privateDirectory(this.#config.exportsDirectory);return privateFolder(join(this.#config.exportsDirectory,'gravitee-workspace-exports'));}
 async #retain(bytes,original){
  const hash=sha256(bytes),identity={schema:'stellar-forge.gravitee-export.v1',original,file:{name:'original.json',bytes:bytes.length,sha256:hash,mediaType:'application/json'}},exportId=hashJSON(identity),root=await this.#root(),directory=await privateFolder(join(root,exportId));
  const path=join(directory,'original.json');await writeImmutableBytes(path,bytes);
  const manifest={...identity,exportId};
  try{await saveJSON(join(directory,'manifest.json'),manifest);}catch(error){if(error.code!=='EEXIST')throw error;const saved=JSON.parse((await privateFile(join(directory,'manifest.json'))).toString('utf8'));requireValue(hashJSON(saved)===hashJSON(manifest),'GRAVITEE_EXPORT_MANIFEST_CHANGED');}
  return{state:'COMPLETE_RESULT_RETAINED',...manifest};
 }
 async #manifest(exportId){
  requireValue(GRAVITEE_SHA.test(exportId),'GRAVITEE_EXPORT_ID_INVALID');const directory=await privateDirectory(join(await this.#root(),exportId));
  const manifest=JSON.parse((await privateFile(join(directory,'manifest.json'))).toString('utf8')),{exportId:saved,...identity}=manifest;
  requireValue(saved===exportId&&hashJSON(identity)===saved&&manifest.file.name==='original.json','GRAVITEE_EXPORT_MANIFEST_CHANGED');return{directory,manifest};
 }
 async #execute(name,args){
  if(name==='merchant_gravitee_workspaces')return this.summary;
  if(name==='merchant_gravitee_export_manifest')return(await this.#manifest(args.exportId)).manifest;
  if(name==='merchant_gravitee_export_file_release'){requireValue(GRAVITEE_UUID.test(args.readId),'GRAVITEE_READ_ID_INVALID');return this.#reads.release(args.exportId,args.readId);}
  if(name==='merchant_gravitee_export_file'){
   const {directory,manifest}=await this.#manifest(args.exportId),file=manifest.file;
   requireValue(args.expectedSha256===file.sha256,'GRAVITEE_EXPORT_DIGEST_CHANGED');
   const offset=args.offset??0,limit=args.limit??65536;requireValue(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>0&&limit<=65536,'GRAVITEE_EXPORT_RANGE_INVALID');
   return this.#reads.read({scope:args.exportId,key:file.name,kind:'gravitee-export',directory,expectedSha256:file.sha256,readId:args.readId,offset,limit,load:async()=>{
    const handle=await open(join(directory,file.name),constants.O_RDONLY|constants.O_NOFOLLOW);try{const info=await handle.stat();requireValue(info.isFile()&&info.size===file.bytes&&!(info.mode&0o077),'GRAVITEE_EXPORT_FILE_CHANGED');return{readonlyFileHandle:handle,bytes:file.bytes,sha256:file.sha256,name:file.name,type:file.mediaType};}catch(error){await handle.close();throw error;}
   }});
  }
  if(name==='merchant_gravitee_download')return this.#using(args.workspace,async(client,definition)=>{
   const bytes=Buffer.from(await client.download(args.reference,{signal:this.#controller.signal}));
   requireValue(bytes.length===args.reference.bytes&&sha256(bytes)===args.reference.sha256,'GRAVITEE_ORIGINAL_DOWNLOAD_CHANGED');
   return this.#retain(bytes,{workspace:args.workspace,workspaceId:definition.workspaceId,reference:args.reference});
  });
  const method=Object.hasOwn(GRAVITEE_METHODS,name)?GRAVITEE_METHODS[name]:null;requireValue(method,'GRAVITEE_TOOL_UNKNOWN');const {workspace,...input}=args;validateGraviteeAction(method,input);
  return this.#using(workspace,async(client,definition)=>{
   const result=await client.action(method,input,{signal:this.#controller.signal}),bytes=Buffer.from(JSON.stringify(result));
   if(bytes.length<=65536)return result;
   return this.#retain(bytes,{workspace,workspaceId:definition.workspaceId,method,requestId:input.requestId??null,inputSha256:hashJSON(input)});
  });
 }
 call(name,args={}){
  requireValue(!this.#closed,'GRAVITEE_PROVIDER_CLOSED');requireValue(object(args),'GRAVITEE_TOOL_INPUT_INVALID');
  const definitions=new Map(graviteeWorkspaceTools((name,description,properties,required)=>({name,properties,required})).map(x=>[x.name,x])),definition=definitions.get(name);
  requireValue(definition&&Object.keys(args).every(key=>Object.hasOwn(definition.properties,key))&&definition.required.every(key=>args[key]!==undefined),'GRAVITEE_TOOL_INPUT_INVALID');
  requireValue(Buffer.byteLength(JSON.stringify(args))<=256*1024*1024,'GRAVITEE_TOOL_INPUT_TOO_LARGE');
  const task=this.#execute(name,args);this.#pending.add(task);task.then(()=>this.#pending.delete(task),()=>this.#pending.delete(task));return task;
 }
 async close(){if(this.#closed)return;this.#closed=true;this.#controller.abort();await Promise.allSettled([...this.#pending]);await this.#reads.close();}
}
