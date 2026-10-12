// MIT. Native CoCart selection and live identity in the maintained Applications lifecycle.
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectMerchantRuntime} from '../../sf46-release/runtime-package.mjs';
import {absolute,need,plain,digest} from './storage.mjs';

export const COCART_READY_SCHEMA='stellar-forge.cocart-workspace-startup.v1';
const SOURCE='stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/cocart';
const FILES=['managed.mjs','server.mjs','workspace.mjs','browser-assets.json','index.html','app.js','app.css','../buyer.mjs','../../distribution/browser-assets.mjs'];
const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const field=(name,label,type='path',required=false,description='')=>({name,label,type,required,description});

export function cocartApplication(common) {
  return {
    id:'cocart-workspace',command:'cocart-managed',title:'CoCart customer workspace',terminal:false,
    requiredSource:SOURCE+'/managed.mjs',
    description:'Open the original guest carts, catalog, native checkout previews, Woo handoffs and complete receiving exports in the same retained workspace.',
    fields:[
      field('workspaceDirectory','Original private CoCart workspace','path',true,
        'Create from the native profile or receive a complete original export with cocart-managed setup before selecting this directory.'),
      field('sdkModule','Original CoCart SDK module','path',false,
        'Optional absolute entry for @cocartheadless/sdk 1.2.1; otherwise use the SDK installed with this runtime.'),
      field('connectionFile','Private CoCart merchant connection','path',false,
        'Optional same-workspace connection emitted by cocart-managed setup. The shared merchant agent and browser retain the same original cart and revision.'),
      field('workspaceAlias','Connection workspace alias','text',false,
        'Required when the selected connection declares more than one workspace.'),
      ...common,
    ],
  };
}

export async function prepareCocartApplication(settings,{inputPath,runtimeDirectory}={}) {
  need(typeof inputPath==='function','APPLICATION_COCART_INPUT_READER_REQUIRED');
  need(settings.connectionFile||!settings.workspaceAlias,'APPLICATION_COCART_CONNECTION_REQUIRED');
  const directory=absolute(settings.workspaceDirectory),inputs=[await inputPath(directory,'directory',false,true)];
  const runtime=await inspectMerchantRuntime(absolute(runtimeDirectory),{load:false});
  const sourceDirectory=join(runtime.sourceRoot,SOURCE),pinned=[];
  for(const name of FILES) pinned.push(await inputPath(resolve(sourceDirectory,name),'file'));
  const native=await import(pathToFileURL(join(sourceDirectory,'managed.mjs')).href);
  const source=await native.inspectCocartLaunchSource(sourceDirectory);
  need(Array.isArray(source.files)&&source.files.length===FILES.length,'APPLICATION_COCART_SOURCE_CHANGED');
  for(const [index,file] of source.files.entries())
    need(file.name===FILES[index]&&file.sha256===pinned[index]?.sha256,'APPLICATION_COCART_SOURCE_CHANGED');
  inputs.push(...pinned);
  const sdk=await native.inspectCocartSDK(settings.sdkModule);
  inputs.push(await inputPath(sdk.entry,'file'));
  const workspace=await native.inspectCocartWorkspace(directory);
  const args=['serve','--directory',directory,'--workspace-identity',workspace.identity,
    '--workspace-version',workspace.version,'--source-directory',sourceDirectory,'--source-sha256',source.sha256,
    '--sdk',sdk.entry,'--sdk-sha256',sdk.sha256,'--startup-json'];
  if(settings.connectionFile) {
    const input=await inputPath(settings.connectionFile,'file');inputs.push(input);
    const connection=await native.readCocartManagedConnection(settings.connectionFile,{
      alias:settings.workspaceAlias,directory,expectedSha256:input.sha256,sdkEntry:sdk.entry,
    });
    args.push('--connection',connection.file,'--connection-sha256',connection.sha256,'--alias',connection.alias);
  }
  return {args,inputs,createDirectories:[],
    resourceKey:digest(JSON.stringify({family:'cocart-workspace',directory}))};
}
function option(request,name,optional=false) {
  need(Array.isArray(request.args),'APPLICATION_COCART_STARTUP_CHANGED');
  const positions=request.args.flatMap((x,i)=>x===name?[i]:[]);
  if(optional&&positions.length===0)return undefined;
  need(positions.length===1&&typeof request.args[positions[0]+1]==='string'&&
    !request.args[positions[0]+1].startsWith('--'),'APPLICATION_COCART_STARTUP_CHANGED');
  return request.args[positions[0]+1];
}
async function liveIdentity(url) {
  const token=url.hash.slice('#token='.length),target=new URL('/api/identity',url);
  const response=await fetch(target,{headers:{'X-CoCart-Workspace':token},redirect:'error',
    signal:AbortSignal.timeout(5000)});
  need(response.ok&&String(response.headers.get('content-type')).startsWith('application/json'),
    'APPLICATION_COCART_LISTENER_CHANGED');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try {
    for(;;) {
      const {done,value}=await reader.read();if(done)break;
      size+=value.length;need(size<=65536,'APPLICATION_COCART_LISTENER_CHANGED');chunks.push(value);
    }
  } finally {await reader.cancel().catch(()=>{});}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{need(false,'APPLICATION_COCART_LISTENER_CHANGED');}
}

export async function cocartStartup(request,text) {
  if(request.command!=='cocart-managed'||typeof text!=='string'||text.length>65536||
    !text.startsWith('{"schema":"'+COCART_READY_SCHEMA+'",'))return null;
  let value;try{value=JSON.parse(text);}catch{return null;}
  if(!plain(value)||value.schema!==COCART_READY_SCHEMA||value.status!=='COCART_WORKSPACE_READY')return null;
  need(request.args?.[0]==='serve'&&request.args.filter(x=>x==='--startup-json').length===1,
    'APPLICATION_COCART_STARTUP_CHANGED');
  const directory=absolute(option(request,'--directory'));
  const sourceDirectory=absolute(option(request,'--source-directory'));
  const launchSourceDirectory=join(absolute(request.releaseDirectory),'source',SOURCE);
  const workspaceIdentity=option(request,'--workspace-identity'),workspaceVersion=option(request,'--workspace-version');
  const sourceSha256=option(request,'--source-sha256'),sdkEntry=absolute(option(request,'--sdk'));
  const sdkSha256=option(request,'--sdk-sha256');
  need([workspaceIdentity,workspaceVersion,sourceSha256,sdkSha256].every(x=>HASH.test(x))&&
    value.directory===directory&&value.workspaceIdentity===workspaceIdentity&&value.workspaceVersion===workspaceVersion&&
    Number.isSafeInteger(value.workspaceRevision)&&value.workspaceRevision>=0&&
    value.sourceDirectory===sourceDirectory&&value.launchSourceDirectory===launchSourceDirectory&&
    value.sourceSha256===sourceSha256&&UUID.test(value.instanceId??'')&&
    Number.isSafeInteger(value.pid)&&value.pid>0,'APPLICATION_COCART_STARTUP_CHANGED');
  const native=await import(pathToFileURL(join(sourceDirectory,'managed.mjs')).href);
  const source=await native.inspectCocartLaunchSource(sourceDirectory,{expectedSha256:sourceSha256});
  await native.inspectCocartLaunchSource(launchSourceDirectory,{expectedSha256:sourceSha256});
  await native.inspectCocartWorkspace(directory,{expectedIdentity:workspaceIdentity});
  const sdk=await native.inspectCocartSDK(sdkEntry,{expectedSha256:sdkSha256});
  need(JSON.stringify(value.sourceFiles)===JSON.stringify(source.files)&&
    JSON.stringify(value.sdk)===JSON.stringify(sdk),'APPLICATION_COCART_STARTUP_CHANGED');
  const connectionFile=option(request,'--connection',true),connectionSha256=option(request,'--connection-sha256',true);
  const alias=option(request,'--alias',true);
  need(Boolean(connectionFile)===Boolean(connectionSha256)&&Boolean(connectionFile)===Boolean(alias),
    'APPLICATION_COCART_STARTUP_CHANGED');
  const connection=await native.readCocartManagedConnection(connectionFile,{
    alias,directory,expectedSha256:connectionSha256,sdkEntry:sdk.entry,
  });
  need(JSON.stringify(value.connection)===JSON.stringify(connection),'APPLICATION_COCART_STARTUP_CHANGED');
  const requestedPort=Number(option(request,'--port',true)??0);
  let url;try{url=new URL(value.cocartWorkspace);}catch{need(false,'APPLICATION_COCART_STARTUP_CHANGED');}
  const actualPort=Number(url.port||80);
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.pathname==='/'&&!url.username&&!url.password&&!url.search&&
    /^#token=[a-f0-9]{64}$/.test(url.hash)&&Number.isInteger(requestedPort)&&requestedPort>=0&&requestedPort<=65535&&
    Number.isInteger(actualPort)&&actualPort>=1&&actualPort<=65535&&(requestedPort===0||actualPort===requestedPort),
    'APPLICATION_COCART_STARTUP_CHANGED');
  const live=await liveIdentity(url);
  const {cocartWorkspace,...original}=value;
  need(plain(live)&&live.origin===url.origin&&JSON.stringify(live.identity)===JSON.stringify(original)&&
    HASH.test(live.current?.version)&&Number.isSafeInteger(live.current?.revision),
    'APPLICATION_COCART_LISTENER_CHANGED');
  return {url:url.href,original};
}
