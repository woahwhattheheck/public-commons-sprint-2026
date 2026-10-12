// MIT. Original grant-portfolio console in the maintained Applications lifecycle.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {absolute,canonical,digest,need,plain} from '../../distribution/runtime-workspace/storage.mjs';

const run=promisify(execFile);
const ROOT='stellar/scf-starforge-20261009/sf30-seller-sdk';
const BINDING='stellar-forge.grant-portfolio-managed-binding.v1';
const STARTUP='stellar-forge.grant-portfolio-workspace-launch.v1';
const hex=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const field=(name,label,type='path',required=false,description='')=>({name,label,type,required,description});

export function grantPortfolioApplication(common=[]) {
  return {id:'grant-portfolio',command:'grant-portfolio',title:'Grant portfolio reconciliation',terminal:false,
    requiredSource:ROOT+'/grant-portfolio/managed.py',
    description:'Receive original IATI and 360Giving editions, review organisations and grant/activity links, reconcile following editions and reopen complete source-linked portfolio deliveries.',
    fields:[
      field('workspaceDirectory','Saved portfolio workspace','path',true,'Choose the private directory initialized or received by the original grant-portfolio command.'),
      field('pythonExecutable','Existing Python executable','path',true,'Select the original Python 3.11+ executable with its installed publisher dependencies.'),
      field('connectionFile','Private console connection file','path',false,'Optional new private file for the original typed client and merchant provider; the console removes it on close.'),
      ...common,
    ]};
}

async function sourceFiles(sourceRoot) {
  const path=join(sourceRoot,'grant-portfolio','source-files.json');
  const bytes=await readFile(path);
  need(bytes.length<=1024*1024,'APPLICATION_GRANT_PORTFOLIO_SOURCE_CHANGED');
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{need(false,'APPLICATION_GRANT_PORTFOLIO_SOURCE_CHANGED');}
  need(plain(value)&&Object.keys(value).sort().join(',')==='files,schema'&&
    value.schema==='stellar-forge.grant-portfolio-source-files.v1'&&Array.isArray(value.files)&&
    value.files.length>=1&&value.files.length<=2048&&
    value.files.every(name=>typeof name==='string'&&name.length>0&&name.length<=512&&
      !/[\x00-\x1f\\]/.test(name)&&!name.startsWith('/')&&name.split('/').every(part=>part&&part!=='.'&&part!=='..'))&&
    JSON.stringify(value.files)===JSON.stringify([...new Set(value.files)].sort())&&
    value.files.includes('grant-portfolio/source-files.json')&&value.files.includes('grant-portfolio/managed.py'),
  'APPLICATION_GRANT_PORTFOLIO_SOURCE_CHANGED');
  return value.files;
}

export async function prepareGrantPortfolioApplication(settings,{
  inputPath,selectedExecutable,runtimeDirectory,applicationEnvironment,
}={}) {
  need(typeof inputPath==='function'&&typeof selectedExecutable==='function'&&
    typeof applicationEnvironment==='function','APPLICATION_GRANT_PORTFOLIO_CONTEXT_REQUIRED');
  const workspace=await inputPath(settings.workspaceDirectory,'directory',false,true);
  const python=await selectedExecutable(settings.pythonExecutable);
  const {inspectMerchantRuntime}=await import('../../sf46-release/runtime-package.mjs');
  const selected=await inspectMerchantRuntime(runtimeDirectory,{load:false});
  const sourceRoot=await realpath(join(selected.sourceRoot,ROOT));
  const inputs=[workspace,...python.inputs],{environment}=await applicationEnvironment(settings.environmentFile);
  let observed;
  try {
    const output=await run(python.executable,[join(sourceRoot,'grant-portfolio','cli.py'),
      '--workspace',workspace.path,'binding'],{encoding:'utf8',maxBuffer:2*1024*1024,timeout:15000,windowsHide:true,env:environment});
    observed=JSON.parse(output.stdout);
  }catch(error){
    need(false,'APPLICATION_GRANT_PORTFOLIO_BINDING_UNAVAILABLE',
      'The original portfolio workspace could not open with the selected Python: '+
      String(error.stderr||error.message||error).trim().slice(0,1500));
  }
  need(plain(observed)&&observed.schema===BINDING&&observed.workspace===workspace.path&&
    uuid(observed.workspaceId)&&observed.sourceRoot===sourceRoot&&plain(observed.workspaceIdentity)&&
    plain(observed.python)&&plain(observed.source)&&hex(observed.sha256),
  'APPLICATION_GRANT_PORTFOLIO_BINDING_CHANGED');
  const {sha256,sourceRoot:ignored,...core}=observed;
  need(digest(JSON.stringify(canonical(core))+'\n')===sha256,'APPLICATION_GRANT_PORTFOLIO_BINDING_CHANGED');
  need(await realpath(observed.python.executable)===await realpath(python.executable)&&
    Array.isArray(observed.python.version)&&observed.python.version.length===3&&
    observed.python.version.every(Number.isSafeInteger)&&
    (observed.python.version[0]>3||observed.python.version[0]===3&&observed.python.version[1]>=11),
  'APPLICATION_GRANT_PORTFOLIO_PYTHON_CHANGED');
  const files=await sourceFiles(sourceRoot);
  need(Object.keys(observed.source).sort().join('\n')===files.join('\n')&&files.every(name=>hex(observed.source[name])),
    'APPLICATION_GRANT_PORTFOLIO_SOURCE_INCOMPLETE');
  for(const relative of files){
    const item=await inputPath(join(sourceRoot,relative),'file');
    need(item.sha256===observed.source[relative],'APPLICATION_GRANT_PORTFOLIO_SOURCE_CHANGED',
      'The original portfolio source changed during application review.');
    inputs.push(item);
  }
  const marker=await inputPath(join(workspace.path,'workspace.json'),'file');
  need(marker.sha256===observed.workspaceIdentity.markerSha256&&
    String(marker.dev)===observed.workspaceIdentity.markerDevice&&String(marker.ino)===observed.workspaceIdentity.markerInode&&
    String(workspace.dev)===observed.workspaceIdentity.device&&String(workspace.ino)===observed.workspaceIdentity.inode,
  'APPLICATION_GRANT_PORTFOLIO_WORKSPACE_CHANGED');
  inputs.push(marker);
  const args=['--python',python.executable,'--workspace',workspace.path,'serve',
    '--expected-binding',sha256,'--startup-format','json'];
  if(settings.connectionFile){
    const connection=await inputPath(settings.connectionFile,'file',true,true);
    if(connection.exists){
      let retained;
      try{
        const output=await run(python.executable,[join(sourceRoot,'grant-portfolio','cli.py'),
          '--workspace',workspace.path,'connection','--file',connection.path],
          {encoding:'utf8',maxBuffer:65536,timeout:15000,windowsHide:true,env:environment});
        retained=JSON.parse(output.stdout);
      }catch(error){need(false,'APPLICATION_GRANT_PORTFOLIO_CONNECTION_CHANGED',
        'Inspect the original connection and its workspace before reopening: '+
        String(error.stderr||error.message||error).trim().slice(0,1000));}
      need(retained?.schema==='stellar-forge.grant-portfolio-connection-state.v1'&&
        retained.exists===true&&retained.path===connection.path&&
        retained.workspace===workspace.path&&retained.workspaceId===observed.workspaceId&&
        retained.bindingSha256===sha256&&retained.sha256===connection.sha256,
      'APPLICATION_GRANT_PORTFOLIO_CONNECTION_CHANGED');
      need(retained.writerActive===false,'APPLICATION_GRANT_PORTFOLIO_CONNECTION_ACTIVE',
        'Open or stop the existing original portfolio console before starting another writer.');
    }
    inputs.push(connection);args.push('--connection-file',connection.path);
  }
  return {args,inputs,createDirectories:[],binding:observed};
}

function requestSelection(request) {
  need(Array.isArray(request.args),'APPLICATION_GRANT_PORTFOLIO_STARTUP_CHANGED');
  const args=request.args;
  need(args.length>=11&&args[0]==='--python'&&args[2]==='--workspace'&&args[4]==='serve',
    'APPLICATION_GRANT_PORTFOLIO_STARTUP_CHANGED');
  const flags=[...args.slice(0,4),...args.slice(5)],options=new Map();
  need(flags.length%2===0,'APPLICATION_GRANT_PORTFOLIO_STARTUP_CHANGED');
  for(let index=0;index<flags.length;index+=2){
    const key=flags[index],value=flags[index+1];
    need(['--python','--workspace','--expected-binding','--startup-format','--connection-file','--port'].includes(key)&&
      !options.has(key)&&typeof value==='string','APPLICATION_GRANT_PORTFOLIO_STARTUP_CHANGED');
    options.set(key,value);
  }
  need(options.size===(options.has('--connection-file')?6:5)&&options.get('--startup-format')==='json'&&
    hex(options.get('--expected-binding'))&&/^(0|[1-9]\d*)$/.test(options.get('--port'))&&
    Number(options.get('--port'))<=65535,'APPLICATION_GRANT_PORTFOLIO_STARTUP_CHANGED');
  return {workspace:absolute(options.get('--workspace')),python:absolute(options.get('--python')),
    binding:options.get('--expected-binding'),port:Number(options.get('--port')),
    connection:options.has('--connection-file')?absolute(options.get('--connection-file')):null};
}

export async function grantPortfolioStartup(request,text) {
  if(request.command!=='grant-portfolio'||typeof text!=='string'||text.length>32768||!text.startsWith('{'))return null;
  let value;try{value=JSON.parse(text);}catch{return null;}
  if(!plain(value)||value.schema!==STARTUP||value.status!=='GRANT_PORTFOLIO_WORKSPACE_READY')return null;
  const selected=requestSelection(request);
  need(value.workspace===selected.workspace&&uuid(value.workspaceId)&&value.bindingSha256===selected.binding&&
    (value.connectionFile??null)===selected.connection&&plain(value.python)&&
    Array.isArray(value.python.version)&&value.python.version.length===3&&
    Number.isSafeInteger(value.pid)&&value.pid>0&&typeof value.sourceRoot==='string',
  'APPLICATION_GRANT_PORTFOLIO_STARTUP_CHANGED');
  need(await realpath(value.python.executable)===await realpath(selected.python)&&
    await realpath(value.sourceRoot)===await realpath(join(absolute(request.releaseDirectory),'source',ROOT)),
  'APPLICATION_GRANT_PORTFOLIO_EXECUTION_CHANGED',
  'The original console must use its reviewed Python and adopted source.');
  let url;try{url=new URL(value.console);}catch{need(false,'APPLICATION_GRANT_PORTFOLIO_STARTUP_CHANGED');}
  const port=Number(url.port||80);
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&port>=1&&port<=65535&&
    (!selected.port||port===selected.port)&&!url.username&&!url.password&&!url.search&&url.pathname==='/'&&
    /^[A-Za-z0-9_-]{43}$/.test(url.hash.slice(1)),'APPLICATION_GRANT_PORTFOLIO_STARTUP_CHANGED');
  const response=await fetch(new URL('/api/launch',url),{
    redirect:'error',headers:{authorization:'Bearer '+url.hash.slice(1),origin:url.origin},signal:AbortSignal.timeout(5000),
  });
  need(response.status===200&&/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??'')&&
    /^\d+$/.test(response.headers.get('content-length')??'')&&Number(response.headers.get('content-length'))<=32768,
  'APPLICATION_GRANT_PORTFOLIO_STARTUP_UNAVAILABLE');
  const raw=await response.arrayBuffer();
  need(raw.byteLength<=32768,'APPLICATION_GRANT_PORTFOLIO_STARTUP_CHANGED');
  let active;try{active=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{need(false,'APPLICATION_GRANT_PORTFOLIO_STARTUP_CHANGED');}
  need(JSON.stringify(canonical(active))===JSON.stringify(canonical(value)),
    'APPLICATION_GRANT_PORTFOLIO_STARTUP_CHANGED','The live original console differs from its startup announcement.');
  return {url:url.href,original:{schema:STARTUP,workspace:selected.workspace,workspaceId:value.workspaceId,
    bindingSha256:selected.binding,sourceRoot:value.sourceRoot,python:value.python,pid:value.pid,
    ...(selected.connection?{connectionFile:selected.connection}:{})}};
}
