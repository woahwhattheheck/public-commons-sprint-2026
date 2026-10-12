// MIT. Original SEC source operator in the existing managed Applications controller.
import { join } from 'node:path';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute,plain,need,canonical,digest,json,processIdentity } from './storage.mjs';
import { namespaceProcessIdentity } from './process-identity.mjs';
const originalIdentity=async pid=>await processIdentity(pid)??await namespaceProcessIdentity(pid);
import { SEC_EDGAR_STARTUP,SEC_EDGAR_PROBE,SEC_EDGAR_LAUNCH_FILE,reviewSecEdgarInputs,
 secEdgarPrivateJson,secEdgarPrivateUrl } from '../../sf30-seller-sdk/sec-edgar/managed-launch.mjs';

const SOURCE='stellar/scf-starforge-20261009/sf30-seller-sdk/sec-edgar/';
const same=(left,right)=>digest(json(canonical(left)))===digest(json(canonical(right)));
const field=(name,label,description)=>({name,label,type:'path',required:true,description});
export function secEdgarApplication(common){
 return {id:'sec-edgar',command:'sec-edgar',title:'SEC EDGAR source operator',terminal:false,
  requiredSource:SOURCE+'managed-launch.mjs',
  description:'Import original company facts and filing editions, review actual records, retain merchant drafts and export the selected customer products.',
  fields:[
   field('workspaceDirectory','Private SEC operator workspace','Reopen the retained drafts and revision history, or create a workspace in an existing private parent.'),
   field('storeDirectory','Private SEC capture store','Use the original immutable capture store, or create a store in an existing private parent.'),
   ...common]};
}
export async function prepareSecEdgarApplication(settings,{inputPath,runtimeDirectory}={}){
 const directory=absolute(settings.workspaceDirectory),storeDirectory=absolute(settings.storeDirectory);
 const folders=await Promise.all([inputPath(directory,'directory',true,true),inputPath(storeDirectory,'directory',true,true)]);
 const inputs=[...folders],createDirectories=[...new Set(folders.filter(value=>!value.exists).map(value=>value.path))];
 const selected=await reviewSecEdgarInputs({directory,storeDirectory,optional:true});
 const runtime=await inspectMerchantRuntime(runtimeDirectory,{load:false});
 for(const name of ['cli.mjs','server.mjs','workspace.mjs','source.mjs','managed-launch.mjs'])
  inputs.push(await inputPath(join(runtime.sourceRoot,SOURCE,name),'file'));
 for(const path of selected.files)inputs.push(await inputPath(path,'file'));
 const args=['workspace','--store',storeDirectory,'--workspace',directory,
  '--expected-workspace-identity',selected.workspace?.sha256??'new',
  '--expected-store-identity',selected.store?.sha256??'new',
  '--expected-source-review',selected.selection?.sha256??'new'];
 return {args,inputs,createDirectories,identity:{workspace:selected.workspace,store:selected.store,selection:selected.selection}};
}
function option(request,name,optional=false){
 need(Array.isArray(request.args)&&request.args[0]==='workspace','APPLICATION_SEC_STARTUP_CHANGED');
 const positions=request.args.flatMap((value,index)=>value===name?[index]:[]);
 if(optional&&!positions.length)return null;
 need(positions.length===1&&typeof request.args[positions[0]+1]==='string','APPLICATION_SEC_STARTUP_CHANGED');
 return request.args[positions[0]+1];
}
async function probe(selected){
 const response=await fetch(new URL('/api/application',selected.origin),{
  headers:{Accept:'application/json',Authorization:'Bearer '+selected.key},
  redirect:'error',signal:AbortSignal.timeout(5000)});
 need(response.ok&&response.headers.get('content-type')?.startsWith('application/json'),'APPLICATION_SEC_LISTENER_CHANGED');
 const chunks=[];let bytes=0;
 try{for await(const chunk of response.body){bytes+=chunk.length;need(bytes<=16384,'APPLICATION_SEC_LISTENER_CHANGED');chunks.push(chunk);}}
 finally{if(bytes>16384)await response.body?.cancel().catch(()=>{});}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
/** Keep the existing child, private browser session and source review bound together. */
export async function secEdgarStartup(request,operationDirectory,text,context={}){
 if(request.command!=='sec-edgar'||request.args?.[0]!=='workspace'||!request.applicationId||
  typeof text!=='string'||text.length>16384||!text.startsWith('{'))return null;
 let value;try{value=JSON.parse(text);}catch{return null;}
 if(!plain(value)||value.schema!==SEC_EDGAR_STARTUP||value.status!=='SEC_EDGAR_WORKSPACE_READY')return null;
 absolute(operationDirectory);
 const directory=absolute(option(request,'--workspace')),storeDirectory=absolute(option(request,'--store'));
 const current=await reviewSecEdgarInputs({directory,storeDirectory});
 for(const [flag,key]of [['--expected-workspace-identity','workspace'],['--expected-store-identity','store'],['--expected-source-review','selection']]){
  const expected=option(request,flag);
  need((expected==='new'||expected===current[key]?.sha256)&&same(value[key],current[key]),'APPLICATION_SEC_STARTUP_CHANGED');
 }
 const saved=await secEdgarPrivateJson(join(directory,SEC_EDGAR_LAUNCH_FILE));
 need(same(saved.value,value),'APPLICATION_SEC_LAUNCH_CHANGED');
 need(Number.isSafeInteger(context.pid)&&context.pid>0&&plain(value.process)&&
  Number.isSafeInteger(value.process.pid)&&Number.isSafeInteger(value.process.ppid)&&
  (value.process.pid===context.pid||value.process.ppid===context.pid)&&
  value.process.start===await originalIdentity(value.process.pid)&&await originalIdentity(context.pid),
 'APPLICATION_SEC_CHILD_CHANGED');
 const port=Number(option(request,'--port',true)??0);
 need(Number.isInteger(port)&&port>=0&&port<=65535,'APPLICATION_SEC_PORT_INVALID');
 const selected=secEdgarPrivateUrl(value.url,port),observed=await probe(selected);
 need(observed.schema===SEC_EDGAR_PROBE&&same(observed.workspace,current.workspace)&&same(observed.store,current.store)&&
  same(observed.selection,current.selection)&&same(observed.process,value.process),'APPLICATION_SEC_LISTENER_CHANGED');
 return {url:selected.url,original:{schema:SEC_EDGAR_STARTUP,launchId:value.launchId,
  workspace:current.workspace,store:current.store,selection:current.selection,process:value.process}};
}
