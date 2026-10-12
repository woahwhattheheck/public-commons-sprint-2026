// MIT. Source-owned Matomo application in the original reviewed Applications lifecycle.
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectMerchantRuntime} from '../../sf46-release/runtime-package.mjs';
import {APPLICATION_PROVIDER_SCHEMA,observeApplicationStartup} from '../../distribution/runtime-workspace/application-provider.mjs';
import {fault} from '../postgres/publisher/files.mjs';
import {MATOMO_STARTUP_SCHEMA,MATOMO_LAUNCH_FILES,matomoLaunchDirectory} from './launch.mjs';
const SOURCE='stellar/scf-starforge-20261009/sf30-seller-sdk/matomo';
const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const need=(value,code='APPLICATION_MATOMO_SOURCE_CHANGED')=>{if(!value)throw fault(code,undefined,400);};
function option(request,name,optional=false) {
  need(Array.isArray(request.args),'APPLICATION_MATOMO_REQUEST_CHANGED');
  const indexes=request.args.flatMap((v,i)=>v===name?[i]:[]);
  if(optional&&!indexes.length)return undefined;
  need(indexes.length===1&&typeof request.args[indexes[0]+1]==='string'&&!request.args[indexes[0]+1].startsWith('--'),
    'APPLICATION_MATOMO_REQUEST_CHANGED');
  return request.args[indexes[0]+1];
}
async function requestIdentity(request) {
  need(request.command==='matomo-workspace'&&!request.pythonCommand&&request.args?.[0]==='serve'&&
    request.args.filter(x=>x==='--startup-json').length===1&&!request.args.includes('--create'),
    'APPLICATION_MATOMO_REQUEST_CHANGED');
  const directory=matomoLaunchDirectory(option(request,'--workspace'));
  const sourceDirectory=matomoLaunchDirectory(option(request,'--source-directory'));
  const workspaceIdentity=option(request,'--workspace-identity'),sourceSha256=option(request,'--source-sha256');
  need(HASH.test(workspaceIdentity)&&HASH.test(sourceSha256),'APPLICATION_MATOMO_REQUEST_CHANGED');
  const native=await import(pathToFileURL(join(sourceDirectory,'launch.mjs')).href);
  const source=await native.inspectMatomoLaunchSource(sourceDirectory,{expectedSha256:sourceSha256});
  const launchSourceDirectory=join(matomoLaunchDirectory(request.releaseDirectory),'source',SOURCE);
  await native.inspectMatomoLaunchSource(launchSourceDirectory,{expectedSha256:sourceSha256});
  const allowLoopback=request.args.includes('--allow-loopback');
  const workspace=await native.inspectMatomoWorkspace(directory,{expectedIdentity:workspaceIdentity,allowLoopback});
  return {native,directory,sourceDirectory,launchSourceDirectory,source,workspace,workspaceIdentity,sourceSha256};
}
export async function prepareMatomoApplication(settings,{inputPath,runtimeDirectory}={}) {
  need(typeof inputPath==='function','APPLICATION_MATOMO_INPUT_READER_REQUIRED');
  const directory=matomoLaunchDirectory(settings.workspaceDirectory);
  const inputs=[await inputPath(directory,'directory',false,true)];
  const runtime=await inspectMerchantRuntime(matomoLaunchDirectory(runtimeDirectory),{load:false});
  const sourceDirectory=join(runtime.sourceRoot,SOURCE),pinned=[];
  for(const name of MATOMO_LAUNCH_FILES)pinned.push(await inputPath(join(sourceDirectory,name),'file'));
  const native=await import(pathToFileURL(join(sourceDirectory,'launch.mjs')).href);
  const source=await native.inspectMatomoLaunchSource(sourceDirectory);
  need(source.files.length===pinned.length&&source.files.every((file,i)=>
    file.name===MATOMO_LAUNCH_FILES[i]&&file.sha256===pinned[i].sha256));
  const workspace=await native.inspectMatomoWorkspace(directory,{allowLoopback:settings.allowLoopbackSource===true});
  inputs.push(...pinned);
  const args=['serve','--workspace',directory,'--workspace-identity',workspace.sha256,
    '--source-directory',sourceDirectory,'--source-sha256',source.sha256,'--startup-json'];
  if(settings.allowLoopbackSource===true)args.push('--allow-loopback');
  if(settings.python){const python=await inputPath(settings.python,'file');inputs.push(python);args.push('--python',settings.python);}
  return {args,inputs,createDirectories:[]};
}
export async function matomoStartup(request,text) {
  if(typeof text!=='string'||text.length>32768||!text.startsWith('{"schema":"'+MATOMO_STARTUP_SCHEMA+'",'))return null;
  let value;try{value=JSON.parse(text);}catch{return null;}
  if(value?.schema!==MATOMO_STARTUP_SCHEMA||value.status!=='MATOMO_WORKSPACE_READY')return null;
  const checked=await requestIdentity(request),{workspace,source}=checked;
  need(value.directory===checked.directory&&value.workspaceId===workspace.workspaceId&&
    value.workspaceIdentity===checked.workspaceIdentity&&value.settingsSha256===workspace.settingsSha256&&
    value.sourceDirectory===checked.sourceDirectory&&value.launchSourceDirectory===checked.launchSourceDirectory&&
    value.sourceSha256===checked.sourceSha256&&JSON.stringify(value.sourceFiles)===JSON.stringify(source.files)&&
    UUID.test(value.instanceId??'')&&Number.isSafeInteger(value.pid)&&value.pid>0,'APPLICATION_MATOMO_STARTUP_CHANGED');
  let url;try{url=new URL(value.url);}catch{need(false,'APPLICATION_MATOMO_STARTUP_CHANGED');}
  const port=Number(option(request,'--port',true)??0);
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.pathname==='/'&&!url.search&&
    !url.username&&!url.password&&/^#[a-f0-9]{64}$/.test(url.hash)&&Number.isInteger(port)&&port>=0&&port<=65535&&
    Number(url.port)>=1&&Number(url.port)<=65535&&(port===0||Number(url.port)===port),'APPLICATION_MATOMO_STARTUP_CHANGED');
  const response=await fetch(new URL('/api/identity',url),{method:'GET',redirect:'error',
    headers:{Authorization:'Bearer '+url.hash.slice(1),Accept:'application/json'},signal:AbortSignal.timeout(5000)});
  need(response.status===200,'APPLICATION_MATOMO_LISTENER_CHANGED');
  const reader=response.body?.getReader();need(reader,'APPLICATION_MATOMO_LISTENER_CHANGED');
  let size=0;const chunks=[];
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;
    need(size<=8192,'APPLICATION_MATOMO_LISTENER_CHANGED');chunks.push(part.value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  let observed;try{observed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));}
  catch{need(false,'APPLICATION_MATOMO_LISTENER_CHANGED');}
  need(observed.schema==='stellar-forge.matomo-listener.v1'&&observed.instanceId===value.instanceId&&
    observed.workspaceId===workspace.workspaceId&&observed.sourceSha256===workspace.settings.sourceSha256&&
    observed.pid===value.pid,'APPLICATION_MATOMO_LISTENER_CHANGED');
  return {url:url.href,original:{schema:MATOMO_STARTUP_SCHEMA,directory:checked.directory,
    workspaceId:workspace.workspaceId,workspaceIdentity:checked.workspaceIdentity,settingsSha256:workspace.settingsSha256,
    sourceDirectory:checked.sourceDirectory,launchSourceDirectory:checked.launchSourceDirectory,
    sourceSha256:checked.sourceSha256,sourceFiles:source.files,instanceId:value.instanceId,pid:value.pid}};
}
export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'matomo',order:1000,
  catalog({common,field}){return [{id:'matomo-authoring',command:'matomo-workspace',title:'Matomo reports and delivery',
    terminal:false,requiredSource:SOURCE+'/launch.mjs',
    description:'Open the original retained report workspace, review native subtables and editions, publish query and dataset packages, and receive the complete source handover.',
    fields:[field('workspaceDirectory','Initialized private Matomo workspace','path',true,
      'Select the same workspace initialized with matomo-source; opening does not contact the provider.'),
      field('python','Existing Python executable','path',false,'Optional original Python interpreter for receiving and typed source operations.'),
      field('allowLoopbackSource','Allow an explicitly local Matomo source','boolean',false,
        'Keep enabled only when this saved original source deliberately uses HTTP loopback.'),...common]}];},
  prepare:(_type,settings,context)=>prepareMatomoApplication(settings,context),
  matchRequest:request=>!request.pythonCommand&&request.command==='matomo-workspace',
  verifyLaunch:request=>requestIdentity(request),
  createObserver:(request,directory)=>observeApplicationStartup(request,directory,text=>{
    if(!text.startsWith('{"schema":"'+MATOMO_STARTUP_SCHEMA+'",'))return null;
    return ()=>matomoStartup(request,text);
  })
};
