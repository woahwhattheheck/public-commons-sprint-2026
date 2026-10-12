// MIT. Facility operations through the original installed Applications lifecycle.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { absolute, plain, need } from './storage.mjs';
const SOURCE='stellar/scf-starforge-20261009/sf61-openapi-seller-import/postman/examples/usgs-facility-events/workspace';
const STARTUP='stellar-forge.facility-operations-startup.v1';
export function facilityApplication(common){
  return {id:'facility-operations',command:'usgs-facility-events',title:'Facility operations',terminal:false,
    requiredSource:SOURCE+'/managed-launch.mjs',
    description:'Operate facility rosters, retained USGS event editions, assigned reviews and complete customer handovers. Requires Node.js 24 or later.',
    fields:[{name:'workspaceDirectory',label:'Private facility workspace',type:'path',required:true,
      description:'Reopen the original customer workspace, or create one directory in an existing private parent.'},...common]};
}
export async function prepareFacilityApplication(settings,inputPath,runtimeDirectory){
  const workspace=await inputPath(settings.workspaceDirectory,'directory',true,true);
  const inputs=[workspace],createDirectories=workspace.exists?[]:[workspace.path];
  const {inspectMerchantRuntime}=await import('../../sf46-release/runtime-package.mjs');
  const selected=await inspectMerchantRuntime(absolute(runtimeDirectory),{load:false}),native=join(selected.sourceRoot,SOURCE);
  for(const file of ['server.mjs','store.mjs','model.mjs','provider.mjs','cli.mjs','managed-launch.mjs','browser-assets.json'])
    inputs.push(await inputPath(join(native,file),'file'));
  const {inspectFacilityWorkspace}=await import(pathToFileURL(join(native,'managed-launch.mjs')).href);
  need(typeof inspectFacilityWorkspace==='function','APPLICATION_FACILITY_READER_REQUIRED');
  if(workspace.exists){
    const original=await inspectFacilityWorkspace(workspace.path);
    if(original.initialized)inputs.push(await inputPath(original.manifestFile,'file'));
    for(const file of original.transferFiles)inputs.push(await inputPath(file,'file'));
  }
  return {args:['--workspace',workspace.path,'--managed-source',native],inputs,createDirectories};
}
function option(request,name,optional=false){
  need(Array.isArray(request.args),'APPLICATION_FACILITY_STARTUP_CHANGED');
  const positions=request.args.flatMap((value,index)=>value===name?[index]:[]);
  if(optional&&!positions.length)return undefined;
  need(positions.length===1&&typeof request.args[positions[0]+1]==='string','APPLICATION_FACILITY_STARTUP_CHANGED');
  return request.args[positions[0]+1];
}
export async function facilityStartup(request,text){
  if(request.command!=='usgs-facility-events'||typeof text!=='string'||text.length>16384||
    !text.startsWith('{"schema":"'+STARTUP+'",'))return null;
  let announcement;try{announcement=JSON.parse(text);}catch{return null;}
  if(!plain(announcement)||announcement.schema!==STARTUP||announcement.state!=='LISTENING')return null;
  const directory=absolute(option(request,'--workspace')),sourceDirectory=absolute(option(request,'--managed-source'));
  const launchSourceDirectory=join(absolute(request.releaseDirectory),'source',SOURCE);
  need(announcement.directory===directory&&announcement.sourceDirectory===sourceDirectory&&
    announcement.launchSourceDirectory===launchSourceDirectory&&Number.isSafeInteger(announcement.pid)&&announcement.pid>0,
    'APPLICATION_FACILITY_STARTUP_CHANGED');
  const {readFacilityLaunch}=await import(pathToFileURL(join(sourceDirectory,'managed-launch.mjs')).href);
  need(typeof readFacilityLaunch==='function','APPLICATION_FACILITY_READER_REQUIRED');
  const ready=await readFacilityLaunch({directory,sourceDirectory,launchSourceDirectory,pid:announcement.pid,instanceId:announcement.instanceId});
  need(ready.url===announcement.url&&ready.workspaceId===announcement.workspaceId&&ready.privateLaunch===announcement.privateLaunch&&
    ready.workspaceFileSha256===announcement.workspaceFileSha256&&ready.sourceSha256===announcement.sourceSha256,
    'APPLICATION_FACILITY_STARTUP_CHANGED');
  const port=Number(option(request,'--port',true)??0);
  need(Number.isInteger(port)&&port>=0&&port<=65535&&(port===0||Number(new URL(ready.url).port||80)===port),'APPLICATION_FACILITY_PORT_CHANGED');
  return {url:ready.url,original:{schema:STARTUP,directory,sourceDirectory,launchSourceDirectory,
    workspaceId:ready.workspaceId,workspaceFileSha256:ready.workspaceFileSha256,sourceSha256:ready.sourceSha256,
    sourceFiles:ready.sourceFiles,pid:ready.pid,instanceId:ready.instanceId,privateLaunch:ready.privateLaunch}};
}
