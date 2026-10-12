// MIT. Original saved PMTiles release operations in the managed Applications catalog.
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectMerchantRuntime} from '../../sf46-release/runtime-package.mjs';
import {absolute,plain,need} from './storage.mjs';
import {inspectPMTilesApplicationWorkspace,inspectPMTilesApplicationRuntime}
  from '../../sf30-seller-sdk/pmtiles/application.mjs';

const PREFIX='stellar/scf-starforge-20261009/';
const ENTRY=PREFIX+'sf30-seller-sdk/pmtiles/application.mjs';
const STARTUP='stellar-forge.pmtiles-workspace-ready.v1';
const INTERFACE='stellar-forge.pmtiles-managed-application.v1';
const HASH=/^[a-f0-9]{64}$/;
const field=(name,label,type='path',required=false,description='')=>({name,label,type,required,description});

export function pmtilesApplication(common){
  return {
    id:'pmtiles-operations',command:'pmtiles-workspace',title:'PMTiles map releases',terminal:false,
    requiredSource:ENTRY,
    description:'Open the saved map workspace, inspect complete regional archives and styles, review native maps, publish or restore a release, and receive the complete customer workspace.',
    fields:[
      field('workspaceDirectory','Private PMTiles workspace','path',true,
        'Select an existing initialized or fully received PMTiles workspace. Its original sources and saved releases remain together.'),
      field('runtimeProfile','Original PMTiles runtime JSON','path',true,
        'Select the original verified PMTiles, Martin and preview runtime profile received with this workspace.'),
      ...common.map(item=>item.name==='port'?{...item,
        description:'Use 0 to retain this workspace’s browser port. An explicit port selects a new browser origin.'}:item),
    ],
  };
}

/** Review the selected installation and original metadata without opening another writer. */
export async function preparePMTilesApplication(settings,{inputPath,runtimeDirectory}={}){
  need(typeof inputPath==='function','APPLICATION_PMTILES_CONTEXT_REQUIRED');
  const directory=absolute(settings.workspaceDirectory),runtimeProfile=absolute(settings.runtimeProfile);
  const selected=await inspectMerchantRuntime(absolute(runtimeDirectory),{load:false});
  const inputs=[await inputPath(directory,'directory',false,true),await inputPath(runtimeProfile,'file')];
  const modulePath=join(selected.sourceRoot,ENTRY),moduleInput=await inputPath(modulePath,'file');
  inputs.push(moduleInput);
  const original=await import(pathToFileURL(modulePath).href);
  need(original.PMTILES_MANAGED_APPLICATION_SCHEMA===INTERFACE&&
    typeof original.inspectPMTilesApplicationWorkspace==='function'&&
    typeof original.inspectPMTilesApplicationRuntime==='function',
    'APPLICATION_PMTILES_SOURCE_REQUIRED','Select the complete PMTiles managed Applications installation.');
  const workspace=await original.inspectPMTilesApplicationWorkspace({directory});
  const runtime=await original.inspectPMTilesApplicationRuntime({runtimeProfile});
  need(workspace.directory===directory&&runtime.runtimeProfile===runtimeProfile&&
    inputs[1].sha256===runtime.profileSha256,'APPLICATION_PMTILES_INPUTS_CHANGED');
  need(Number.isInteger(settings.port??0)&&(settings.port??0)>=0&&(settings.port??0)<=65535,
    'APPLICATION_PORT_INVALID');
  inputs.push({kind:'pmtiles-workspace',path:directory,workspaceId:workspace.workspaceId,
    authoringPort:workspace.authoringPort});
  inputs.push({kind:'pmtiles-native-runtime',path:runtimeProfile,
    runtimeSha256:runtime.runtimeSha256,profileSha256:runtime.profileSha256,
    pmtilesVersion:runtime.pmtilesVersion,martinVersion:runtime.martinVersion,
    packages:runtime.packages,pythonHostContract:runtime.pythonHostContract});
  return {
    args:['--workspace',directory,'--workspace-id',workspace.workspaceId,
      '--runtime',runtimeProfile,'--runtime-sha256',runtime.runtimeSha256,
      '--runtime-profile-sha256',runtime.profileSha256,
      '--expected-authoring-port',String(workspace.authoringPort??0)],
    inputs,createDirectories:[],
  };
}
function selectedValue(request,name){
  need(Array.isArray(request.args),'APPLICATION_PMTILES_STARTUP_CHANGED');
  const positions=request.args.flatMap((value,index)=>value===name?[index]:[]);
  need(positions.length===1&&typeof request.args[positions[0]+1]==='string',
    'APPLICATION_PMTILES_STARTUP_CHANGED');
  return request.args[positions[0]+1];
}
function selectedPort(request,name){
  const value=selectedValue(request,name);
  need(/^\d+$/.test(value),'APPLICATION_PMTILES_STARTUP_CHANGED');
  const port=Number(value);
  need(Number.isInteger(port)&&port>=0&&port<=65535,'APPLICATION_PMTILES_STARTUP_CHANGED');
  return port;
}

/** Only the original managed command can announce this exact saved workspace. */
export async function pmtilesApplicationStartup(request,directory,text){
  if(request.command!=='pmtiles-workspace'||request.pythonCommand||typeof text!=='string'||
    text.length>16384||!text.startsWith('{'))return null;
  let value;try{value=JSON.parse(text);}catch{return null;}
  if(!plain(value)||value.schema!==STARTUP)return null;
  const workspaceDirectory=absolute(selectedValue(request,'--workspace'));
  const runtimeProfile=absolute(selectedValue(request,'--runtime'));
  const workspaceId=selectedValue(request,'--workspace-id');
  const profileSha256=selectedValue(request,'--runtime-profile-sha256');
  const runtimeSha256=selectedValue(request,'--runtime-sha256');
  need(HASH.test(profileSha256)&&HASH.test(runtimeSha256),'APPLICATION_PMTILES_STARTUP_CHANGED');
  const requestedPort=selectedPort(request,'--port');
  const previousPort=selectedPort(request,'--expected-authoring-port')||null;
  const current=await inspectPMTilesApplicationWorkspace({directory:workspaceDirectory,expectedWorkspaceId:workspaceId});
  const runtime=await inspectPMTilesApplicationRuntime({runtimeProfile,
    expectedProfileSha256:profileSha256,expectedRuntimeSha256:runtimeSha256});
  let url;try{url=new URL(value.url);}catch{need(false,'APPLICATION_PMTILES_STARTUP_CHANGED');}
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!url.username&&!url.password&&
    !url.search&&url.pathname==='/'&&/^#token=[a-f0-9]{64}$/.test(url.hash)&&
    Number.isInteger(value.port)&&value.port>=1&&value.port<=65535&&Number(url.port)===value.port&&
    value.origin===url.origin&&(!(requestedPort||previousPort)||value.port===(requestedPort||previousPort))&&
    current.authoringPort===value.port&&value.previousAuthoringPort===previousPort&&
    value.workspaceId===current.workspaceId&&value.workspaceDirectory===workspaceDirectory&&
    value.runtimeProfile===runtimeProfile&&value.profileSha256===runtime.profileSha256&&
    value.runtimeSha256===runtime.runtimeSha256,'APPLICATION_PMTILES_STARTUP_CHANGED',
    'The original native announcement must match this reviewed workspace, runtime and browser port.');
  return {url:url.href,workspaceId:current.workspaceId,original:{
    schema:STARTUP,directory:workspaceDirectory,workspaceId:current.workspaceId,
    observedRevision:current.revision,currentRelease:current.currentRelease,
    authoringPort:current.authoringPort,authoringOrigin:url.origin,
    runtimeProfile,profileSha256:runtime.profileSha256,runtimeSha256:runtime.runtimeSha256,
  }};
}
