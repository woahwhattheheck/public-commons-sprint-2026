// MIT. Managed Applications owns its ordinary lifecycle; this provider calls the original GTFS CLI.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../../distribution/runtime-workspace/application-provider.mjs';
import { absolute, need, plain } from '../../distribution/runtime-workspace/storage.mjs';

const CLI='stellar/scf-starforge-20261009/sf30-seller-sdk/gtfs/cli.mjs';
const LAUNCH='stellar-forge.gtfs-workspace-launch.v1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function validate(type,settings){
  need(Boolean(settings.sellerUrl)===Boolean(settings.resourceUrl),'APPLICATION_GTFS_BUYER_REQUIRED',
    'Select both the original running seller and public resource, or leave both empty.');
  if(settings.title!==undefined)need(typeof settings.title==='string'&&settings.title.trim()&&settings.title.length<=128,
    'APPLICATION_GTFS_TITLE_REQUIRED','Use a workspace title of 1–128 characters.');
}
function selected(request,flag,optional=false){
  const indexes=request.args.flatMap((value,index)=>value===flag?[index]:[]);
  if(optional&&!indexes.length)return null;
  need(indexes.length===1&&typeof request.args[indexes[0]+1]==='string'&&!request.args[indexes[0]+1].startsWith('--'),
    'APPLICATION_GTFS_STARTUP_CHANGED','The original managed arguments changed.');
  return request.args[indexes[0]+1];
}
export async function prepareGtfsApplication(type,settings,{inputPath,runtimeDirectory}){
  validate(type,settings);
  const {inspectMerchantRuntime}=await import('../../sf46-release/runtime-package.mjs');
  const runtime=await inspectMerchantRuntime(runtimeDirectory,{load:false});
  const cli=join(runtime.sourceRoot,CLI),original=await import(pathToFileURL(cli).href);
  need(original.GTFS_LAUNCH_SCHEMA===LAUNCH&&typeof original.inspectGtfsLaunch==='function',
    'APPLICATION_GTFS_SOURCE_REQUIRED','Select the complete runtime containing the original GTFS workspace.');
  const workspace=await inputPath(settings.workspaceDirectory,'directory',true,true);
  const source=await original.inspectGtfsLaunch(workspace.path);
  need(source.schema==='stellar-forge.gtfs-launch-selection.v1'&&source.directory===workspace.path&&
    ['NEW','SAVED','INITIALIZING'].includes(source.state),
    'APPLICATION_GTFS_WORKSPACE_CHANGED','Review this original private workspace.');
  const args=['serve','--workspace',workspace.path,'--port',String(settings.port??0)],
    inputs=[workspace,await inputPath(cli,'file')];
  if(source.state==='NEW'){
    args.push('--create-if-missing','--title',settings.title??'GTFS Schedule workspace');
  } else {
    need(UUID.test(source.workspaceId??''),'APPLICATION_GTFS_WORKSPACE_CHANGED');
    args.push('--expected-workspace-id',source.workspaceId);
    if(source.state==='INITIALIZING')args.push('--create-if-missing','--title',source.title);
  }
  for(const [field,flag,missing] of [['exportsDirectory','--exports',true],['releaseStore','--release-store',false]]){
    if(!settings[field])continue;
    const value=await inputPath(settings[field],'directory',missing,true);
    inputs.push(value);args.push(flag,value.path);
  }
  if(settings.sellerUrl)args.push('--seller',settings.sellerUrl,'--resource',settings.resourceUrl);
  return {args,inputs,createDirectories:[],
    applicationReview:{schema:'stellar-forge.application-review-content.v1',title:'GTFS Schedule workspace',
      summary:source.state==='SAVED'?'Reopen the same original feed editions, publications and complete history.':
        'The original command creates or continues this private GTFS workspace under the retained managed operation.',
      sections:[{title:'Original workspace',rows:[
        {label:'Directory',value:workspace.path},
        {label:'State',value:source.state},
        {label:'Workspace identity',value:source.workspaceId??'Assigned once when this managed Start is retained'},
        ...(source.revision!==undefined?[{label:'Current revision',value:source.revision}]:[]),
      ]}]}};
}
export async function gtfsStartup(request,text){
  if(request.command!=='gtfs'||!Array.isArray(request.args)||request.args[0]!=='serve'||
    typeof text!=='string'||text.length>16384)return null;
  let value;try{value=JSON.parse(text);}catch{return null;}
  if(!plain(value)||value.schema!==LAUNCH||value.status!=='GTFS_WORKSPACE_READY')return null;
  const directory=absolute(selected(request,'--workspace')),workspaceId=selected(request,'--expected-workspace-id'),
    port=selected(request,'--port');
  need(UUID.test(workspaceId)&&/^(0|[1-9]\d*)$/.test(port)&&Number(port)<=65535&&
    value.directory===directory&&value.workspaceId===workspaceId&&Number.isSafeInteger(value.pid)&&value.pid>0,
    'APPLICATION_GTFS_STARTUP_CHANGED','The original GTFS command must open the reviewed directory and workspace UUID.');
  let url;try{url=new URL(value.url);}catch{need(false,'APPLICATION_GTFS_STARTUP_CHANGED');}
  const actualPort=Number(url.port||80);
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.pathname==='/'&&!url.username&&!url.password&&
    !url.search&&!url.hash&&actualPort>=1&&actualPort<=65535&&(port==='0'||actualPort===Number(port)),
    'APPLICATION_GTFS_STARTUP_CHANGED','Use the original private GTFS listener.');
  const response=await fetch(new URL('/api/gtfs/identity',url),{redirect:'error',signal:AbortSignal.timeout(5000)});
  need(response.ok,'APPLICATION_GTFS_LISTENER_UNAVAILABLE','The original GTFS listener is not ready.');
  const reader=response.body.getReader(),chunks=[];let total=0;
  try{
    for(;;){const part=await reader.read();if(part.done)break;total+=part.value.length;
      need(total<=16384,'APPLICATION_GTFS_STARTUP_CHANGED');chunks.push(Buffer.from(part.value));}
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  let native;try{native=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,total)));}catch{need(false,'APPLICATION_GTFS_STARTUP_CHANGED');}
  need(native.schema==='stellar-forge.gtfs-workspace-identity.v1'&&native.workspaceId===workspaceId&&
    native.directory===directory&&native.pid===value.pid&&Number.isSafeInteger(native.revision)&&native.revision>=0,
    'APPLICATION_GTFS_STARTUP_CHANGED','The original listener does not match this managed workspace.');
  return {url:url.href,workspaceId,original:{schema:LAUNCH,directory,workspaceId,pid:value.pid,revision:native.revision}};
}
export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'gtfs',order:700,appendPort:false,
  catalog({common,field}){
    return [{id:'gtfs-schedule',command:'gtfs',requiredSource:CLI,title:'GTFS Schedule merchant',terminal:false,
      description:'Retain complete transit feeds, select actual service dates and routes, review editions, publish data and receive whole-workspace archives.',
      fields:[
        field('workspaceDirectory','Private GTFS workspace','path',true,'Choose a new private directory or reopen the original saved workspace.'),
        field('title','New workspace title','text',false,'Used once for a new workspace. Existing source and decisions keep their names.'),
        field('exportsDirectory','Private complete-archive directory','path',false,'Keep complete workspace archives outside the workspace.'),
        field('releaseStore','Existing seller release store','path',false,'Optional original SF82 store for retained release packages.'),
        field('sellerUrl','Original running seller URL','text',false),
        field('resourceUrl','Public resource URL','text',false),
        ...common,
      ]}];
  },
  validateSettings:validate,
  prepare:prepareGtfsApplication,
  runArguments({command,args,requestId}){
    need(command==='gtfs'&&args[0]==='serve','APPLICATION_GTFS_COMMAND_CHANGED');
    if(args.includes('--create-if-missing')&&!args.includes('--expected-workspace-id')){
      need(UUID.test(requestId),'APPLICATION_GTFS_OPERATION_ID_REQUIRED');
      return [...args,'--expected-workspace-id',requestId];
    }
    return args;
  },
  matchRequest(request){return !request.pythonCommand&&request.command==='gtfs'&&Array.isArray(request.args)&&request.args[0]==='serve';},
  createObserver(request,directory){
    return observeApplicationStartup(request,directory,text=>{
      if(!text.startsWith('{"schema":"'+LAUNCH+'",'))return null;
      return ()=>gtfsStartup(request,text);
    });
  },
};
