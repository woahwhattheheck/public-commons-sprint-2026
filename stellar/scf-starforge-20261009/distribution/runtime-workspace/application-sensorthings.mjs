// MIT. Source-owned Desk preparation on the original Applications lifecycle.
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectMerchantRuntime} from '../../sf46-release/runtime-package.mjs';
import {absolute,plain,need,regular} from './storage.mjs';
const SOURCE='stellar/scf-starforge-20261009/sf30-seller-sdk/sensorthings/desk';
const SCHEMA='stellar-forge.sensorthings-desk-startup.v1';
const field=(name,label,type='path',required=false,description='')=>({name,label,type,required,description});
export function sensorThingsApplication(common){
  return {id:'sensorthings-desk',command:'sensorthings-desk',title:'SensorThings operations',terminal:false,requiredSource:SOURCE+'/server.mjs',
    description:'Review original sensor source editions, continue captures, compare exact records, publish native datasets and receive complete customer source files.',
    fields:[field('workspaceDirectory','Private SensorThings workspace','path',true,'Reopen the original workspace or create one private directory in an existing parent.'),
      field('sourceInboxDirectory','Private source archive inbox','path',false,'Existing private directory separate from the workspace; receives original source archives from this browser.'),
      field('buyerWorkspaceDirectory','Original buyer workspace','path',false,'Optional existing SF88 buyer workspace for saved customer intents and native result receiving.'),
      field('releaseRuntimeFile','Private merchant runtime JSON','path',false,'Original merchant port/facilitator settings; empty uses the native challenge-only default.'),...common]};
}
export async function prepareSensorThingsApplication(settings,{inputPath,runtimeDirectory}={}){
  need(typeof inputPath==='function','APPLICATION_SENSORTHINGS_READER_REQUIRED');
  const directory=absolute(settings.workspaceDirectory),workspace=await inputPath(directory,'directory',true,true),
    inputs=[workspace],createDirectories=workspace.exists?[]:[directory],
    runtime=await inspectMerchantRuntime(absolute(runtimeDirectory),{load:false}),native=join(runtime.sourceRoot,SOURCE);
  for(const name of ['server.mjs','cli.mjs','managed-launch.mjs','inbox.mjs','browser-assets.json'])inputs.push(await inputPath(join(native,name),'file'));
  const source=await import(pathToFileURL(join(native,'managed-launch.mjs')).href);
  need(typeof source.inspectSensorThingsWorkspace==='function','APPLICATION_SENSORTHINGS_SOURCE_REQUIRED');
  const original=workspace.exists?await source.inspectSensorThingsWorkspace(directory,{allowMissing:true}):null,
    args=['--workspace',directory];
  if(original)args.push('--expected-workspace-id',original.workspaceId);
  for(const [name,option]of [['sourceInboxDirectory','--source-inbox'],['buyerWorkspaceDirectory','--buyer-workspace']]){
    if(settings[name]){const path=absolute(settings[name]);
      if(name==='sourceInboxDirectory')need(path!==directory&&!path.startsWith(directory+'/'),'APPLICATION_SENSORTHINGS_INBOX_SEPARATE','Keep source archive receiving outside the original workspace state.');
      const selected=await inputPath(path,'directory',false,true);inputs.push(selected);args.push(option,selected.path);}
  }
  if(settings.releaseRuntimeFile){const selected=await inputPath(absolute(settings.releaseRuntimeFile),'file'),bytes=await regular(selected.path,65536);let value;
    try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{need(false,'APPLICATION_SENSORTHINGS_RUNTIME_JSON');}
    need(plain(value),'APPLICATION_SENSORTHINGS_RUNTIME_JSON');inputs.push(selected);args.push('--release-runtime',selected.path);}
  return {args,inputs,createDirectories};
}
function option(request,name,optional=false){
  need(Array.isArray(request.args),'APPLICATION_SENSORTHINGS_STARTUP_CHANGED');const at=request.args.flatMap((x,i)=>x===name?[i]:[]);
  if(optional&&!at.length)return undefined;need(at.length===1&&typeof request.args[at[0]+1]==='string'&&!request.args[at[0]+1].startsWith('--'),'APPLICATION_SENSORTHINGS_STARTUP_CHANGED');return request.args[at[0]+1];
}
export async function sensorThingsStartup(request,text){
  if(request.command!=='sensorthings-desk'||typeof text!=='string'||text.length>65536||!text.startsWith('{"schema":"'+SCHEMA+'",'))return null;
  let record;try{record=JSON.parse(text);}catch{return null;}
  if(!plain(record)||record.schema!==SCHEMA||record.status!=='SENSORTHINGS_DESK_READY')return null;
  const directory=absolute(option(request,'--workspace')),native=join(absolute(request.releaseDirectory),'source',SOURCE),
    expectedWorkspaceId=option(request,'--expected-workspace-id',true),sourceInboxDirectory=option(request,'--source-inbox',true)??null,
    buyerWorkspaceDirectory=option(request,'--buyer-workspace',true)??null,releaseRuntimeFile=option(request,'--release-runtime',true)??null;
  need(record.directory===directory&&record.sourceDirectory===native&&record.sourceInboxDirectory===sourceInboxDirectory&&record.buyerWorkspaceDirectory===buyerWorkspaceDirectory&&record.releaseRuntimeFile===releaseRuntimeFile&&Number.isSafeInteger(record.pid)&&record.pid>0,'APPLICATION_SENSORTHINGS_STARTUP_CHANGED');
  const {readDeskLaunch}=await import(pathToFileURL(join(native,'managed-launch.mjs')).href);
  const ready=await readDeskLaunch({directory,expectedWorkspaceId,expectedSourceDirectory:native,expectedInstanceId:record.instanceId});
  need(ready.url===record.url&&ready.workspaceId===record.workspaceId&&ready.sourceSha256===record.sourceSha256&&ready.pid===record.pid,'APPLICATION_SENSORTHINGS_STARTUP_CHANGED');
  const port=Number(option(request,'--port',true)??0);need(Number.isInteger(port)&&port>=0&&port<=65535&&(port===0||Number(new URL(ready.url).port||80)===port),'APPLICATION_SENSORTHINGS_PORT_CHANGED');
  const {url,...original}=ready;return {url,original};
}
