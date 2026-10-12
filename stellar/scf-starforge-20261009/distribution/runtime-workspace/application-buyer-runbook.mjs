// MIT. Original Buyer receiving through the selected installed Applications runtime.
import {join, isAbsolute, normalize} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual as same} from 'node:util';
import {inspectMerchantRuntime} from '../../sf46-release/runtime-package.mjs';
import {absolute, plain, need} from './storage.mjs';

const ROOT='stellar/scf-starforge-20261009';
const SOURCE=ROOT+'/buyer-runbook/';
const BINDING='stellar-forge.application-buyer-runbook-binding.v1';
export const BUYER_RUNBOOK_LAUNCH_SCHEMA='stellar-forge.buyer-runbook-workspace-launch.v1';
const SHA=/^[a-f0-9]{64}$/;
const field=(name,label,required=false,description='',type='path')=>({name,label,type,required,description});

export function buyerRunbookApplication(common=[]) {
  return {
    id:'buyer-runbook',command:'buyer-runbook',title:'Buyer receiving',terminal:false,
    requiredSource:SOURCE+'launch.mjs',
    description:'Receive merchant SDKs, requests and paid files, configure this buyer, approve original acquisitions in the browser, and reopen results, accounting and recovery.',
    fields:[
      field('stateDirectory','Private buyer workspace',true,
        'Open the original receiving workspace, or choose one new folder in an existing private parent.'),
      field('configsDirectory','Original buyer configurations',false,
        'Optional existing private config directory. An existing workspace remembers its directory; a new workspace can create its own.'),
      field('operatorSettings','Original operator settings',false,
        'Optional private preset. Local buyer setup can create and revise host settings inside the receiving application.'),
      field('paidFileClaimEnvs','Paid-file claim environment names',false,
        'Optional comma-separated existing variable names. Claim values stay in this host environment.','text'),
      field('initialRun','Existing acquisition to open',false,
        'Optional original runbook directory. Its saved operation identities and results are reused.'),
      ...common,
    ],
  };
}

function claimNames(value) {
  if(value===undefined)return undefined;
  need(typeof value==='string'&&value.length<=4096,'APPLICATION_BUYER_CLAIM_NAMES_INVALID');
  const names=value.split(',').map(name=>name.trim());
  need(names.length>=1&&names.length<=32&&new Set(names).size===names.length&&
    names.every(name=>/^[A-Z][A-Z0-9_]{1,64}$/.test(name)),
    'APPLICATION_BUYER_CLAIM_NAMES_INVALID','Enter existing environment variable names separated by commas.');
  return names;
}

async function retainInput(record,inputPath,inputs) {
  need(plain(record)&&typeof record.path==='string'&&SHA.test(record.sha256??'')&&
    Number.isSafeInteger(record.bytes)&&record.bytes>=0,'APPLICATION_BUYER_SELECTION_INVALID');
  const selected=await inputPath(absolute(record.path),'file');
  need(selected.sha256===record.sha256&&selected.bytes===record.bytes,
    'APPLICATION_BUYER_INPUT_CHANGED','Review this original buyer selection again.');
  inputs.push(selected);
}

export async function prepareBuyerRunbookApplication(settings,{inputPath,runtimeDirectory}={}) {
  need(plain(settings)&&typeof inputPath==='function','APPLICATION_BUYER_INPUTS_REQUIRED');
  const runtime=await inspectMerchantRuntime(absolute(runtimeDirectory),{load:false,source:false});
  const launchPath=join(runtime.sourceRoot,SOURCE,'launch.mjs');
  const launchInput=await inputPath(launchPath,'file');
  const native=await import(pathToFileURL(launchPath).href);
  need(typeof native.inspectRunbookWorkspaceSelection==='function',
    'APPLICATION_BUYER_BROWSER_SOURCE_REQUIRED',
    'Choose the installed Buyer receiving edition with browser approval and managed launch support.');
  const state=await inputPath(absolute(settings.stateDirectory),'directory',true,true);
  const inputs=[launchInput,state];
  const options={
    directory:state.path,approvalMode:'BROWSER',
    ...(settings.configsDirectory===undefined?{}:{configsDirectory:absolute(settings.configsDirectory)}),
    ...(settings.operatorSettings===undefined?{}:{operatorSettings:absolute(settings.operatorSettings)}),
    ...(settings.paidFileClaimEnvs===undefined?{}:{paidFileClaimEnvs:claimNames(settings.paidFileClaimEnvs)}),
    runs:settings.initialRun===undefined?[]:[absolute(settings.initialRun)],
  };
  const selected=await native.inspectRunbookWorkspaceSelection(options);
  need(plain(selected)&&plain(selected.selection)&&selected.selection.directory===state.path&&
    selected.selection.approvalMode==='BROWSER'&&SHA.test(selected.selectionSha256??'')&&
    Array.isArray(selected.inputFiles)&&Array.isArray(selected.sourceFiles)&&selected.sourceFiles.length>0,
    'APPLICATION_BUYER_SELECTION_INVALID');
  for(const record of selected.inputFiles)await retainInput(record,inputPath,inputs);
  for(const record of selected.sourceFiles) {
    need(plain(record)&&typeof record.path==='string'&&!isAbsolute(record.path)&&
      !record.path.includes('\\')&&normalize(record.path)===record.path&&
      !record.path.split('/').includes('..'),'APPLICATION_BUYER_SOURCE_PATH_INVALID');
    await retainInput({...record,path:join(runtime.sourceRoot,ROOT,record.path)},inputPath,inputs);
  }
  // Keep original directory identity in the launch review; mutable host settings
  // and acquisition records continue to be managed by the original application.
  if(options.configsDirectory)inputs.push(await inputPath(options.configsDirectory,'directory',false,true));
  if(options.operatorSettings)inputs.push(await inputPath(options.operatorSettings,'file'));
  for(const run of options.runs)inputs.push(await inputPath(run,'directory',false,true));
  const args=['workspace','--state',state.path,'--approval-mode','browser',
    '--expected-selection-sha256',selected.selectionSha256];
  if(options.configsDirectory)args.push('--configs',options.configsDirectory);
  if(options.operatorSettings)args.push('--operator-settings',options.operatorSettings);
  if(options.paidFileClaimEnvs)args.push('--claim-envs',options.paidFileClaimEnvs.join(','));
  if(options.runs.length)args.push('--run',options.runs[0]);
  return {
    args,inputs,createDirectories:state.exists?[]:[state.path],
    identity:{schema:BINDING,selection:selected.selection,selectionSha256:selected.selectionSha256,
      sourceFiles:selected.sourceFiles},
  };
}

function requestFlags(request) {
  need(request.command==='buyer-runbook'&&Array.isArray(request.args)&&request.args[0]==='workspace'&&
    (request.args.length-1)%2===0,'APPLICATION_BUYER_STARTUP_CHANGED');
  const allowed=new Set(['--state','--configs','--operator-settings','--claim-envs','--run','--port',
    '--approval-mode','--expected-selection-sha256']);
  const flags=new Map();
  for(let i=1;i<request.args.length;i+=2) {
    const name=request.args[i],value=request.args[i+1];
    need(allowed.has(name)&&!flags.has(name)&&typeof value==='string'&&value.length>0,
      'APPLICATION_BUYER_STARTUP_CHANGED');
    flags.set(name,value);
  }
  need(flags.get('--approval-mode')==='browser'&&SHA.test(flags.get('--expected-selection-sha256')??''),
    'APPLICATION_BUYER_STARTUP_CHANGED');
  absolute(flags.get('--state'));
  const port=flags.get('--port')??'0';
  need(/^(0|[1-9][0-9]{0,4})$/.test(port)&&Number(port)<=65535,'APPLICATION_BUYER_PORT_CHANGED');
  return {flags,port:Number(port)};
}

function listenerUrl(value,port) {
  need(typeof value==='string'&&value.length<=4096,'APPLICATION_BUYER_LISTENER_INVALID');
  const url=new URL(value);
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!url.username&&!url.password&&
    url.pathname==='/'&&!url.search&&!url.hash&&
    Number.isInteger(Number(url.port))&&Number(url.port)>=1&&Number(url.port)<=65535&&
    (!port||Number(url.port)===port),'APPLICATION_BUYER_LISTENER_INVALID');
  return url.href;
}

async function observedLaunch(url) {
  const response=await fetch(new URL('/api/launch',url),{
    redirect:'error',signal:AbortSignal.timeout(5000),headers:{accept:'application/json'},
  });
  need(response.ok&&response.headers.get('content-type')?.split(';')[0]==='application/json',
    'APPLICATION_BUYER_LISTENER_UNAVAILABLE');
  const chunks=[];let length=0;
  for await(const part of response.body) {
    length+=part.length;
    need(length<=65536,'APPLICATION_BUYER_LISTENER_INVALID');
    chunks.push(part);
  }
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
}

export async function buyerRunbookStartup(request,text) {
  if(request?.command!=='buyer-runbook'||typeof text!=='string'||text.length>16384||
    !text.startsWith('{"schema":"'+BUYER_RUNBOOK_LAUNCH_SCHEMA+'",'))return null;
  const {flags,port}=requestFlags(request),binding=request.buyerRunbook;
  need(plain(binding)&&binding.schema===BINDING&&plain(binding.selection)&&
    Array.isArray(binding.sourceFiles)&&binding.sourceFiles.length>0&&
    SHA.test(binding.selectionSha256??'')&&binding.selectionSha256===flags.get('--expected-selection-sha256')&&
    binding.selection.directory===flags.get('--state')&&binding.selection.approvalMode==='BROWSER',
    'APPLICATION_BUYER_STARTUP_CHANGED');
  const selected=binding.selection;
  need(selected.operatorSettings===(flags.get('--operator-settings')??null)&&
    same(selected.paidFileClaimEnvs,flags.has('--claim-envs')?claimNames(flags.get('--claim-envs')):null)&&
    same(selected.initialRuns,flags.has('--run')?[flags.get('--run')]:[])&&
    (!flags.has('--configs')||selected.configsDirectory===flags.get('--configs')),
    'APPLICATION_BUYER_STARTUP_CHANGED');
  const announcement=JSON.parse(text);
  need(plain(announcement)&&announcement.schema===BUYER_RUNBOOK_LAUNCH_SCHEMA&&
    announcement.mode==='BUYER_RUNBOOK_WORKSPACE'&&announcement.approvalMode==='BROWSER'&&
    announcement.approvalAvailable===true&&announcement.directory===selected.directory&&
    same(announcement.selection,selected)&&same(announcement.sourceFiles,binding.sourceFiles)&&
    announcement.selectionSha256===binding.selectionSha256&&
    Number.isSafeInteger(announcement.pid)&&announcement.pid>0&&
    typeof announcement.instanceId==='string'&&/^[A-Za-z0-9._:-]{16,128}$/.test(announcement.instanceId),
    'APPLICATION_BUYER_STARTUP_CHANGED');
  const url=listenerUrl(announcement.url,port),observed=await observedLaunch(url);
  need(plain(observed)&&observed.schema===announcement.schema&&observed.mode===announcement.mode&&
    observed.pid===announcement.pid&&observed.instanceId===announcement.instanceId&&
    observed.approvalMode==='BROWSER'&&observed.approvalAvailable===true&&
    observed.directory===selected.directory&&same(observed.selection,selected)&&
    same(observed.sourceFiles,binding.sourceFiles)&&observed.selectionSha256===binding.selectionSha256&&
    listenerUrl(observed.url,port)===url,'APPLICATION_BUYER_LISTENER_CHANGED',
    'Open the running original buyer instance selected by this application.');
  return {url,original:{schema:BUYER_RUNBOOK_LAUNCH_SCHEMA,selection:selected,
    selectionSha256:binding.selectionSha256,pid:announcement.pid,instanceId:announcement.instanceId,
    approvalMode:'BROWSER'}};
}
