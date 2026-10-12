// MIT. Source-owned Cloud application through original reviewed Applications.
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectMerchantRuntime} from '../../../sf46-release/runtime-package.mjs';
import {APPLICATION_PROVIDER_SCHEMA,observeApplicationStartup} from '../../../distribution/runtime-workspace/application-provider.mjs';
import {fault} from '../../postgres/publisher/files.mjs';
import {CLOUD_STARTUP_SCHEMA,CLOUD_LAUNCH_FILES,cloudDirectory} from './launch.mjs';
const SOURCE='stellar/scf-starforge-20261009/sf30-seller-sdk/duckdb/cloud-delivery';
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const need=(condition,code='APPLICATION_CLOUD_SOURCE_CHANGED')=>{if(!condition)throw fault(code,undefined,400);};
function option(request,name,optional=false){
 need(Array.isArray(request.args),'APPLICATION_CLOUD_REQUEST_CHANGED');
 const indexes=request.args.flatMap((value,index)=>value===name?[index]:[]);
 if(optional&&!indexes.length)return undefined;
 need(indexes.length===1&&typeof request.args[indexes[0]+1]==='string'&&!request.args[indexes[0]+1].startsWith('--'),'APPLICATION_CLOUD_REQUEST_CHANGED');
 return request.args[indexes[0]+1];
}
async function requestIdentity(request){
 need(request.command==='cloud-workspace'&&!request.pythonCommand&&request.args?.[0]==='serve'&&
  request.args.filter(value=>value==='--startup-json').length===1,'APPLICATION_CLOUD_REQUEST_CHANGED');
 const directory=cloudDirectory(option(request,'--directory')),workspaceId=option(request,'--workspace-id'),sha256=option(request,'--source-sha256');
 need(UUID.test(workspaceId??'')&&SHA.test(sha256??''),'APPLICATION_CLOUD_REQUEST_CHANGED');
 const sourceDirectory=join(cloudDirectory(request.releaseDirectory),'source',SOURCE);
 const native=await import(pathToFileURL(join(sourceDirectory,'launch.mjs')).href);
 const source=await native.inspectCloudLaunchSource(sourceDirectory,{expectedSha256:sha256});
 const workspace=await native.inspectCloudWorkspace(directory,{workspaceId});
 return {directory,workspaceId,sourceDirectory,source,workspace};
}
export async function prepareCloudApplication(settings,{inputPath,runtimeDirectory}={}){
 need(typeof inputPath==='function','APPLICATION_CLOUD_INPUT_READER_REQUIRED');
 const directory=cloudDirectory(settings.workspaceDirectory),inputs=[await inputPath(directory,'directory',false,true)];
 const runtime=await inspectMerchantRuntime(cloudDirectory(runtimeDirectory),{load:false});
 const sourceDirectory=join(runtime.sourceRoot,SOURCE),pins=[];
 for(const name of CLOUD_LAUNCH_FILES)pins.push(await inputPath(join(sourceDirectory,name),'file'));
 const native=await import(pathToFileURL(join(sourceDirectory,'launch.mjs')).href);
 const source=await native.inspectCloudLaunchSource(sourceDirectory),workspace=await native.inspectCloudWorkspace(directory);
 need(source.files.length===pins.length&&source.files.every((file,index)=>file.name===CLOUD_LAUNCH_FILES[index]&&file.sha256===pins[index].sha256));
 inputs.push(...pins);
 const args=['serve','--directory',directory,'--workspace-id',workspace.workspaceId,'--source-sha256',source.sha256,'--startup-json'];
 if(settings.python){inputs.push(await inputPath(settings.python,'file'));args.push('--python',settings.python);}
 return {args,inputs,createDirectories:[]};
}
export async function cloudStartup(request,text){
 if(typeof text!=='string'||text.length>32768||!text.startsWith('{"schema":"'+CLOUD_STARTUP_SCHEMA+'",'))return null;
 let value;try{value=JSON.parse(text);}catch{return null;}
 if(value.schema!==CLOUD_STARTUP_SCHEMA||value.state!=='READY')return null;
 const checked=await requestIdentity(request);
 need(value.directory===checked.directory&&value.workspaceId===checked.workspaceId&&
  value.sourceSha256===checked.source.sha256&&JSON.stringify(value.sourceFiles)===JSON.stringify(checked.source.files)&&
  UUID.test(value.instanceId??'')&&Number.isSafeInteger(value.pid)&&value.pid>0,'APPLICATION_CLOUD_STARTUP_CHANGED');
 let url;try{url=new URL(value.url);}catch{need(false,'APPLICATION_CLOUD_STARTUP_CHANGED');}
 const port=Number(option(request,'--port',true)??0);
 need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.pathname==='/'&&!url.search&&!url.username&&!url.password&&
  /^#key=[a-f0-9]{64}$/.test(url.hash)&&Number.isInteger(port)&&port>=0&&port<=65535&&
  Number(url.port)>0&&Number(url.port)<=65535&&(port===0||Number(url.port)===port),'APPLICATION_CLOUD_STARTUP_CHANGED');
 const response=await fetch(new URL('/api/identity',url),{method:'GET',redirect:'error',headers:{
  'x-duckdb-workspace':url.hash.slice(5),Accept:'application/json'},signal:AbortSignal.timeout(5000)});
 need(response.status===200,'APPLICATION_CLOUD_LISTENER_CHANGED');
 const reader=response.body?.getReader();need(reader,'APPLICATION_CLOUD_LISTENER_CHANGED');
 const chunks=[];let size=0;
 try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;
  need(size<=8192,'APPLICATION_CLOUD_LISTENER_CHANGED');chunks.push(next.value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 let observed;try{observed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));}
 catch{need(false,'APPLICATION_CLOUD_LISTENER_CHANGED');}
 need(observed.schema==='stellar-forge.duckdb-workspace-listener.v1'&&observed.workspaceId===checked.workspaceId&&
  observed.instanceId===value.instanceId&&observed.pid===value.pid,'APPLICATION_CLOUD_LISTENER_CHANGED');
 return {url:url.href,original:{schema:CLOUD_STARTUP_SCHEMA,directory:checked.directory,workspaceId:checked.workspaceId,
  instanceId:value.instanceId,pid:value.pid,sourceSha256:checked.source.sha256,sourceFiles:checked.source.files}};
}
export default {
 schema:APPLICATION_PROVIDER_SCHEMA,id:'coinmetrics-cloud',order:1020,
 catalog({common,field}){return [{id:'coinmetrics-cloud-workspace',command:'cloud-workspace',title:'Cloud Delivery and DuckDB',
  terminal:false,requiredSource:SOURCE+'/launch.mjs',
  description:'Review exact source editions and typed comparisons, edit native DuckDB queries and merchant drafts, export and receive complete original handovers.',
  fields:[field('workspaceDirectory','Initialized private Cloud/DuckDB workspace','path',true,
   'Select the same directory initialized with cloud-workspace. Its current UUID and original source files are retained.'),
   field('python','Existing Python executable','path',false,'Optional interpreter with the original DuckDB requirements.'),...common]}];},
 prepare:(_type,settings,context)=>prepareCloudApplication(settings,context),
 matchRequest:request=>!request.pythonCommand&&request.command==='cloud-workspace',
 verifyLaunch:request=>requestIdentity(request),
 createObserver:(request,directory)=>observeApplicationStartup(request,directory,text=>{
  if(!text.startsWith('{"schema":"'+CLOUD_STARTUP_SCHEMA+'",'))return null;
  return ()=>cloudStartup(request,text);
 })
};
