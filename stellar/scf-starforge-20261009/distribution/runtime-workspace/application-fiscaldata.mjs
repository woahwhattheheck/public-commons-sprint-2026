// MIT. Original named Fiscal operator through installed Applications.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, need, plain, digest, json, canonical } from './storage.mjs';
const SOURCE='stellar/scf-starforge-20261009/sf30-seller-sdk/fiscaldata/managed.mjs';
const STARTUP='stellar-forge.fiscaldata-application-startup.v1';
const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const field=(name,label,type='path',required=false,description='')=>({name,label,type,required,description});
const hash=value=>digest(json(canonical(value)));
export function fiscalDataApplication(common){
 return {id:'fiscaldata',command:'fiscaldata',requiredSource:SOURCE,title:'Fiscal Data operations',terminal:true,
  description:'Review retained Treasury sources, exact decimal editions and comparisons; operate the original publisher and buyer; stop and reopen the same named-operator workspace.',
  fields:[
   field('connectionFile','Private Fiscal operator connection','path',true,'The original named operator, source aliases, merchant terms and buyer workspace references.'),
   field('workspaceAlias','Declared source workspace','text',true,'Choose the initialized workspace alias in that connection file.'),
   field('exportsDirectory','Private source-package directory','path',true,'An existing private directory outside the source workspaces, used by the original checkpoint and receiving workflow.'),
   field('terminalPython','Original terminal Python','path',false,'Defaults to /usr/bin/python3. Configured purchases use the original approval terminal.'),
   ...common]};
}
export async function prepareFiscalDataApplication(settings,{inputPath,runtimeDirectory}={}){
 need(typeof inputPath==='function','APPLICATION_FISCALDATA_INPUT_READER_REQUIRED');
 const runtime=await inspectMerchantRuntime(absolute(runtimeDirectory),{load:false});
 const native=await import(pathToFileURL(join(runtime.sourceRoot,SOURCE)).href);
 need(typeof native.inspectFiscalManagedSelection==='function'&&typeof native.inspectFiscalManagedSource==='function',
  'APPLICATION_FISCALDATA_RUNTIME_REQUIRED','Choose a runtime containing the complete Fiscal Data managed operator.');
 const selection=await native.inspectFiscalManagedSelection({connectionFile:absolute(settings.connectionFile),
  workspaceAlias:settings.workspaceAlias,exportsDirectory:absolute(settings.exportsDirectory)});
 const source=await native.inspectFiscalManagedSource(runtime.sourceRoot);
 const inputs=[
  await inputPath(selection.connectionFile,'file'),
  await inputPath(selection.workspace.directory,'directory',false,true),
  await inputPath(selection.exportsDirectory,'directory',false,true)
 ];
 need(inputs[0].sha256===selection.connectionSha256,'APPLICATION_FISCALDATA_CONNECTION_CHANGED');
 for(const file of source.files){
  const input=await inputPath(join(runtime.sourceRoot,file.path),'file');
  need(input.sha256===file.sha256,'APPLICATION_FISCALDATA_SOURCE_CHANGED');inputs.push(input);
 }
 return {args:['managed','--connection',selection.connectionFile,'--workspace',selection.workspaceAlias,
  '--exports',selection.exportsDirectory,'--expected-connection-sha256',selection.connectionSha256,
  '--expected-workspace-identity',selection.workspace.sha256,'--managed-source',runtime.sourceRoot,
  '--expected-source-sha256',source.sha256,'--startup-format','json'],inputs,createDirectories:[],
  resourceKey:hash({family:'fiscaldata',directory:selection.workspace.directory})};
}
function option(request,name,optional=false){
 need(Array.isArray(request.args),'APPLICATION_FISCALDATA_STARTUP_CHANGED');
 const indices=request.args.flatMap((value,index)=>value===name?[index]:[]);
 if(optional&&indices.length===0)return undefined;
 need(indices.length===1&&typeof request.args[indices[0]+1]==='string'&&!request.args[indices[0]+1].startsWith('--'),
  'APPLICATION_FISCALDATA_STARTUP_CHANGED');
 return request.args[indices[0]+1];
}
async function liveIdentity(url){
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(5000)});
 need(response.status===200,'APPLICATION_FISCALDATA_LISTENER_NOT_READY');
 const cookies=response.headers.getSetCookie?.()??[response.headers.get('set-cookie')].filter(Boolean);
 await response.body?.cancel();
 const cookie=cookies.map(value=>value.split(';')[0]).filter(value=>/^sf_fiscal_[0-9]*=/.test(value)).join('; ');
 need(cookie,'APPLICATION_FISCALDATA_LISTENER_NOT_READY');
 const reply=await fetch(new URL('api/identity',url),{headers:{cookie},redirect:'error',signal:AbortSignal.timeout(5000)});
 need(reply.status===200,'APPLICATION_FISCALDATA_LISTENER_NOT_READY');
 const reader=reply.body.getReader(),chunks=[];let size=0;
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
   need(size<=32768,'APPLICATION_FISCALDATA_IDENTITY_TOO_LARGE');chunks.push(value);}
 }finally{await reader.cancel().catch(()=>{});}
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
 catch{need(false,'APPLICATION_FISCALDATA_IDENTITY_INVALID');}return value;
}
export async function fiscalDataStartup(request,text){
 if(request.command!=='fiscaldata'||typeof text!=='string'||text.length>32768||
  !text.startsWith('{"schema":"'+STARTUP+'",'))return null;
 let value;try{value=JSON.parse(text);}catch{return null;}
 if(!plain(value)||value.schema!==STARTUP||value.status!=='FISCALDATA_APPLICATION_READY')return null;
 need(request.args[0]==='managed'&&option(request,'--startup-format')==='json',
  'APPLICATION_FISCALDATA_STARTUP_CHANGED');
 const connectionFile=absolute(option(request,'--connection')),workspaceAlias=option(request,'--workspace');
 const exportsDirectory=absolute(option(request,'--exports')),sourceRoot=absolute(option(request,'--managed-source'));
 const launchSourceRoot=join(absolute(request.releaseDirectory),'source');
 const connectionSha256=option(request,'--expected-connection-sha256'),
  workspaceIdentity=option(request,'--expected-workspace-identity'),sourceSha256=option(request,'--expected-source-sha256');
 need([connectionSha256,workspaceIdentity,sourceSha256].every(x=>HASH.test(x))&&
  value.connectionFile===connectionFile&&value.connectionSha256===connectionSha256&&value.workspaceAlias===workspaceAlias&&
  value.exportsDirectory===exportsDirectory&&value.sourceRoot===sourceRoot&&value.launchSourceRoot===launchSourceRoot&&
  value.workspaceIdentity===workspaceIdentity&&value.sourceSha256===sourceSha256&&
  UUID.test(value.instanceId??'')&&UUID.test(value.modelInstanceId??'')&&Number.isSafeInteger(value.pid)&&value.pid>0,
  'APPLICATION_FISCALDATA_STARTUP_CHANGED');
 const native=await import(pathToFileURL(join(sourceRoot,SOURCE)).href);
 const selection=await native.inspectFiscalManagedSelection({connectionFile,workspaceAlias,exportsDirectory,
  expectedConnectionSha256:connectionSha256,expectedWorkspaceIdentity:workspaceIdentity});
 const selected=await native.inspectFiscalManagedSource(sourceRoot,{expectedSha256:sourceSha256});
 await native.inspectFiscalManagedSource(launchSourceRoot,{expectedSha256:sourceSha256});
 need(value.workspaceId===selection.workspace.id&&value.directory===selection.workspace.directory&&
  hash(value.operator)===hash(selection.operator)&&hash(value.sourceFiles)===hash(selected.files),
  'APPLICATION_FISCALDATA_STARTUP_CHANGED');
 let url;try{url=new URL(value.url);}catch{need(false,'APPLICATION_FISCALDATA_STARTUP_CHANGED');}
 const port=Number(option(request,'--port',true)??0);
 need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!url.username&&!url.password&&!url.hash&&!url.search&&
  url.pathname==='/'&&Number.isSafeInteger(port)&&port>=0&&port<=65535&&
  Number(url.port||80)>=1&&Number(url.port||80)<=65535&&(port===0||Number(url.port||80)===port),
  'APPLICATION_FISCALDATA_STARTUP_CHANGED');
 const {url:unused,...original}=value;
 need(hash(await liveIdentity(url))===hash(original),'APPLICATION_FISCALDATA_LISTENER_CHANGED',
  'The actual local listener differs from the original reviewed Fiscal application.');
 return {url:url.href,original};
}

