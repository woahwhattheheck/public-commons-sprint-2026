// MIT. Original Stellar application binding for the retained Applications launcher.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, plain, need, digest, json, canonical } from './storage.mjs';

const INSTALLED = 'stellar/scf-starforge-20261009/partners/cheesecake-stellar-agent/installed.mjs';
const STARTUP = 'stellar-forge.application-installed-startup.v1';
const field = (name,label,type='path',required=false,description='') => ({name,label,type,required,description});
export function cheesecakeApplication(common) {
  return {id:'stellar-application',command:'stellar-application',title:'Stellar agent application',terminal:true,
    requiredSource:INSTALLED,
    description:'Review selected Stellar and MCP requests, use current application authorization, approve native payments, inspect aggregate spending and reopen complete retained results.',
    fields:[field('configurationFile','Original application configuration','path',true,
      'Use the application.json created by the selected installed runtime. It retains the original handoff and private state.'),
      field('terminalPython','Terminal Python executable','path',false,
        'Defaults to /usr/bin/python3. Native payment approval uses the existing managed terminal.'),
      ...common]};
}
/** Inspect original selected inputs without loading its signer, authorization module or provider. */
export async function prepareCheesecakeApplication(settings,inputPath,runtimeDirectory) {
  const runtime=await inspectMerchantRuntime(absolute(runtimeDirectory),{load:false});
  const sourceModule=join(runtime.sourceRoot,INSTALLED);
  const sourceInput=await inputPath(sourceModule,'file');
  const {inspectInstalledApplication}=await import(pathToFileURL(sourceModule).href);
  const selected=await inspectInstalledApplication(absolute(settings.configurationFile));
  need(selected.sourceRoot===runtime.sourceRoot,'APPLICATION_SELECTED_RUNTIME_CHANGED');
  const inputs=[sourceInput],seen=new Set([sourceModule]);
  for(const path of selected.directories) {
    inputs.push(await inputPath(path,'directory',false,true));seen.add(path);
  }
  for(const reference of selected.references) {
    if(seen.has(reference.path))continue;
    const item=await inputPath(reference.path,'file');
    need(item.bytes===reference.bytes&&(!item.sha256||item.sha256===reference.sha256),
      'APPLICATION_SELECTED_SOURCE_CHANGED');
    inputs.push({...item,sha256:reference.sha256});seen.add(reference.path);
  }
  const args=['serve','--config',selected.configFile,
    '--expected-selection-sha256',selected.selectionSha256,
    '--managed-source',selected.applicationDirectory];
  // State identity, rather than the configuration filename, owns exclusivity.
  const resourceKey=digest(json(canonical({family:'stellar-application',directory:selected.stateDirectory})));
  return {args,inputs,resourceKey};
}
function selectedArgument(request,name) {
  need(Array.isArray(request.args)&&request.args[0]==='serve','APPLICATION_STELLAR_STARTUP_CHANGED');
  const indices=request.args.flatMap((value,index)=>value===name?[index]:[]);
  need(indices.length===1&&typeof request.args[indices[0]+1]==='string','APPLICATION_STELLAR_STARTUP_CHANGED');
  return request.args[indices[0]+1];
}
/** Read only the original installed command's bound startup announcement. */
export function cheesecakeStartup(request,text) {
  if(request.command!=='stellar-application'||typeof text!=='string'||text.length>16384||!text.startsWith('{'))return null;
  let value;
  try{value=JSON.parse(text);}catch{return null;}
  if(!plain(value)||value.schema!==STARTUP||value.status!=='STELLAR_APPLICATION_READY')return null;
  const configFile=absolute(selectedArgument(request,'--config'));
  const expected=selectedArgument(request,'--expected-selection-sha256');
  const sourceDirectory=absolute(selectedArgument(request,'--managed-source'));
  const launchSourceDirectory=join(absolute(request.releaseDirectory),'source',
    'stellar/scf-starforge-20261009/partners/cheesecake-stellar-agent');
  const runtimeDirectory=join(sourceDirectory,'..','..','sf88-operator-buyer-cli');
  need(value.sourceDirectory===sourceDirectory&&value.launchSourceDirectory===launchSourceDirectory&&
    value.runtimeDirectory===runtimeDirectory&&Number.isSafeInteger(value.pid)&&value.pid>0&&
    plain(value.sourceFiles)&&Object.hasOwn(value.sourceFiles,'installed.mjs')&&
    Object.values(value.sourceFiles).every(sha=>/^[a-f0-9]{64}$/.test(sha)),
    'APPLICATION_STELLAR_STARTUP_CHANGED');
  need(/^[a-f0-9]{64}$/.test(expected)&&value.configFile===configFile&&value.selectionSha256===expected&&
    /^[a-f0-9]{64}$/.test(value.configurationSha256??'')&&
    /^[a-f0-9]{64}$/.test(value.handoffId??'')&&
    /^[A-Za-z0-9._:-]{1,128}$/.test(value.applicationId??'')&&
    typeof value.serverId==='string'&&value.serverId.length>=1&&value.serverId.length<=128&&
    (value.remoteMcpSourceSha256===null||/^[a-f0-9]{64}$/.test(value.remoteMcpSourceSha256??'')),
    'APPLICATION_STELLAR_STARTUP_CHANGED');
  absolute(value.stateDirectory);
  let url;
  try{url=new URL(value.origin);}catch{need(false,'APPLICATION_STELLAR_STARTUP_CHANGED');}
  const hostIndex=request.args.indexOf('--host'),expectedHost=hostIndex<0?'127.0.0.1':request.args[hostIndex+1];
  const portIndex=request.args.indexOf('--port'),expectedPort=portIndex<0?0:Number(request.args[portIndex+1]);
  const actualPort=Number(url.port||80);
  need(url.protocol==='http:'&&['127.0.0.1','[::1]'].includes(url.hostname)&&
    url.hostname===(expectedHost==='::1'?'[::1]':expectedHost)&&actualPort>=1&&actualPort<=65535&&
    Number.isInteger(expectedPort)&&expectedPort>=0&&expectedPort<=65535&&(expectedPort===0||actualPort===expectedPort)&&
    url.pathname==='/'&&!url.username&&!url.password&&!url.search&&!url.hash,
    'APPLICATION_STELLAR_STARTUP_CHANGED');
  return {url:url.href,original:{schema:STARTUP,configFile,
    configurationSha256:value.configurationSha256,selectionSha256:expected,
    applicationId:value.applicationId,stateDirectory:value.stateDirectory,handoffId:value.handoffId,
    sourceDirectory,launchSourceDirectory,runtimeDirectory,sourceFiles:value.sourceFiles,pid:value.pid,
    remoteMcpSourceSha256:value.remoteMcpSourceSha256,serverId:value.serverId}};
}
