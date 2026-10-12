// MIT. Original Grants.gov research through the maintained installed Applications lifecycle.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, plain, need } from './storage.mjs';

const SOURCE='stellar/scf-starforge-20261009/sf30-seller-sdk/grantsgov';
const STARTUP='stellar-forge.grantsgov-workspace-startup.v1';
const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const field=(name,label,type='path',required=false,description='')=>({name,label,type,required,description});

export function grantsgovApplication(common){
  return {id:'grantsgov',command:'grantsgov',title:'Grants.gov opportunities',terminal:false,
    requiredSource:SOURCE+'/launch.mjs',
    description:'Research original federal opportunities, retain source editions and qualifications, prepare workshares, publish reviewed datasets and receive complete customer files.',
    fields:[
      field('workspaceDirectory','Initialized private Grants.gov workspace','path',true,
        'Initialize with grantsgov init or choose the original research workspace. Saved sources, reviews and publisher records reopen together.'),
      field('buyersFile','Original buyer workspace bindings','path',false,
        'Optional private JSON array of existing buyer IDs and directories, used by the original customer publisher.'),
      ...common]};
}
export async function prepareGrantsgovApplication(settings,{inputPath,runtimeDirectory}={}){
  need(typeof inputPath==='function','APPLICATION_GRANTS_INPUT_READER_REQUIRED');
  const directory=absolute(settings.workspaceDirectory);
  const inputs=[await inputPath(directory,'directory',false,true)];
  const runtime=await inspectMerchantRuntime(absolute(runtimeDirectory),{load:false});
  const sourceDirectory=join(runtime.sourceRoot,SOURCE);
  const native=await import(pathToFileURL(join(sourceDirectory,'launch.mjs')).href);
  need(typeof native.inspectGrantsWorkspace==='function'&&typeof native.inspectGrantsLaunchSource==='function'&&
    typeof native.readGrantsLaunchBuyers==='function'&&Array.isArray(native.GRANTS_LAUNCH_FILES),
    'APPLICATION_GRANTS_NATIVE_READER_REQUIRED');
  const source=await native.inspectGrantsLaunchSource(sourceDirectory);
  const pinned=[];
  for(const name of native.GRANTS_LAUNCH_FILES)pinned.push(await inputPath(join(sourceDirectory,name),'file'));
  need(source.files.length===pinned.length&&source.files.every((file,index)=>
    file.name===native.GRANTS_LAUNCH_FILES[index]&&file.sha256===pinned[index].sha256),'APPLICATION_GRANTS_SOURCE_CHANGED');
  inputs.push(...pinned);
  const workspace=await native.inspectGrantsWorkspace(directory);
  const args=['serve','--workspace',directory,'--workspace-identity',workspace.sha256,
    '--source-directory',sourceDirectory,'--source-sha256',source.sha256,'--startup-format','managed'];
  if(settings.buyersFile){
    const selected=await inputPath(settings.buyersFile,'file');
    await native.readGrantsLaunchBuyers(settings.buyersFile,{expectedSha256:selected.sha256});
    inputs.push(selected);args.push('--buyers',settings.buyersFile,'--buyers-sha256',selected.sha256);
  }
  return {args,inputs,createDirectories:[]};
}
function option(request,name,optional=false){
  need(Array.isArray(request.args),'APPLICATION_GRANTS_STARTUP_CHANGED');
  const positions=request.args.flatMap((value,index)=>value===name?[index]:[]);
  if(optional&&positions.length===0)return undefined;
  need(positions.length===1&&typeof request.args[positions[0]+1]==='string'&&
    !request.args[positions[0]+1].startsWith('--'),'APPLICATION_GRANTS_STARTUP_CHANGED');
  return request.args[positions[0]+1];
}
export async function grantsgovStartup(request,text){
  if(request.command!=='grantsgov'||typeof text!=='string'||text.length>32768||
    !text.startsWith('{"schema":"'+STARTUP+'",'))return null;
  let value;try{value=JSON.parse(text);}catch{return null;}
  if(!plain(value)||value.schema!==STARTUP||value.status!=='GRANTS_WORKSPACE_READY')return null;
  need(request.args?.[0]==='serve'&&option(request,'--startup-format')==='managed','APPLICATION_GRANTS_STARTUP_CHANGED');
  const directory=absolute(option(request,'--workspace'));
  const sourceDirectory=absolute(option(request,'--source-directory'));
  const launchSourceDirectory=join(absolute(request.releaseDirectory),'source',SOURCE);
  const workspaceIdentity=option(request,'--workspace-identity'),sourceSha256=option(request,'--source-sha256');
  need(HASH.test(workspaceIdentity)&&HASH.test(sourceSha256)&&value.directory===directory&&
    value.workspaceIdentity===workspaceIdentity&&value.sourceDirectory===sourceDirectory&&
    value.launchSourceDirectory===launchSourceDirectory&&value.sourceSha256===sourceSha256&&
    UUID.test(value.instanceId??'')&&Number.isSafeInteger(value.pid)&&value.pid>0,'APPLICATION_GRANTS_STARTUP_CHANGED');
  const native=await import(pathToFileURL(join(sourceDirectory,'launch.mjs')).href);
  const source=await native.inspectGrantsLaunchSource(sourceDirectory,{expectedSha256:sourceSha256});
  await native.inspectGrantsLaunchSource(launchSourceDirectory,{expectedSha256:sourceSha256});
  const workspace=await native.inspectGrantsWorkspace(directory,{expectedIdentity:workspaceIdentity});
  need(value.workspaceId===workspace.workspaceId&&JSON.stringify(value.sourceFiles)===JSON.stringify(source.files),
    'APPLICATION_GRANTS_STARTUP_CHANGED');
  const buyersFile=option(request,'--buyers',true),buyersSha256=option(request,'--buyers-sha256',true);
  need(Boolean(buyersFile)===Boolean(buyersSha256),'APPLICATION_GRANTS_STARTUP_CHANGED');
  const buyers=await native.readGrantsLaunchBuyers(buyersFile,{expectedSha256:buyersSha256});
  need(value.buyersFile===buyers.file&&value.buyersSha256===buyers.sha256&&
    JSON.stringify(value.buyerWorkspaces)===JSON.stringify(buyers.buyerWorkspaces.map(({id})=>id)),
    'APPLICATION_GRANTS_STARTUP_CHANGED');
  let url;try{url=new URL(value.grantsWorkspace);}catch{need(false,'APPLICATION_GRANTS_STARTUP_CHANGED');}
  const port=Number(option(request,'--port',true)??0),actualPort=Number(url.port||80);
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!url.username&&!url.password&&!url.search&&
    url.pathname==='/'&&/^#session=[A-Za-z0-9_-]{32,256}$/.test(url.hash)&&
    Number.isInteger(port)&&port>=0&&port<=65535&&actualPort>=1&&actualPort<=65535&&
    (port===0||actualPort===port),'APPLICATION_GRANTS_STARTUP_CHANGED');
  const response=await fetch(url.origin+'/api/identity',{redirect:'error',signal:AbortSignal.timeout(10000),
    headers:{authorization:'Bearer '+url.hash.slice('#session='.length),accept:'application/json'}});
  need(response.ok,'APPLICATION_GRANTS_LIVE_IDENTITY_CHANGED');
  const body=await response.text();
  need(Buffer.byteLength(body)<=65536,'APPLICATION_GRANTS_LIVE_IDENTITY_CHANGED');
  let live;try{live=JSON.parse(body);}catch{need(false,'APPLICATION_GRANTS_LIVE_IDENTITY_CHANGED');}
  need(live.ok===true&&live.result?.schema==='stellar-forge.grantsgov-session.v1'&&
    live.result.instanceId===value.instanceId&&live.result.pid===value.pid&&
    live.result.workspaceId===workspace.workspaceId&&live.result.createdAt===workspace.createdAt,
    'APPLICATION_GRANTS_LIVE_IDENTITY_CHANGED');
  return {url:url.href,original:{schema:STARTUP,directory,workspaceId:workspace.workspaceId,workspaceIdentity,
    sourceDirectory,launchSourceDirectory,sourceSha256,sourceFiles:source.files,buyersFile:buyers.file,
    buyersSha256:buyers.sha256,buyerWorkspaces:value.buyerWorkspaces,instanceId:value.instanceId,pid:value.pid}};
}
