// MIT. Applications uses the original Aviary workspace, Python and operator.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {absolute,canonical,digest,need,plain} from '../../../distribution/runtime-workspace/storage.mjs';

const execute=promisify(execFile);
const ROOT='stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research/aviary';
const BINDING='stellar-forge.aviary-managed-binding.v1';
const STARTUP='stellar-forge.aviary-workspace-launch.v1';
const SHA=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const UUID=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const NATIVE_SOURCES=Object.freeze([
  'APPLICATIONS.md','PROVIDER_CONTRACT.md','README.md','app.js','aviary.py',
  'aviary_client.py','cli.mjs','index.html','managed.py','server.py',
]);
const field=(name,label,type,required,description)=>({name,label,type,required,description});

export function aviaryApplication(common=[]){
  return {
    id:'aviary-workspace',command:'aviary-workspace',title:'Aviary collection migration',
    terminal:false,requiredSource:ROOT+'/managed.py',
    description:'Review the original audiovisual collection, map all five Aviary import tables, retain native packages and API progress, and reopen complete collection handoffs.',
    fields:[
      field('directory','Saved Aviary workspace','path',true,
        'Choose the initialized or received directory containing aviary.sqlite3 and its original source manifest.'),
      field('pythonExecutable','Existing Python executable','path',true,
        'Select the original Python 3.11 or later executable. The native application uses the Python standard library.'),
      ...common,
    ],
  };
}

export async function prepareAviaryApplication(settings,{
  inputPath,selectedExecutable,runtimeDirectory,applicationEnvironment,
}={}){
  need(typeof inputPath==='function'&&typeof selectedExecutable==='function'&&
    typeof applicationEnvironment==='function','APPLICATION_AVIARY_CONTEXT_REQUIRED');
  const workspace=await inputPath(settings.directory,'directory',false,true);
  const python=await selectedExecutable(settings.pythonExecutable);
  const {inspectMerchantRuntime}=await import('../../../sf46-release/runtime-package.mjs');
  const selected=await inspectMerchantRuntime(runtimeDirectory,{load:false});
  const sourceRoot=await realpath(join(selected.sourceRoot,ROOT));
  const {environment}=await applicationEnvironment(settings.environmentFile);
  let observed;
  try{
    const result=await execute(python.executable,['-B',join(sourceRoot,'aviary.py'),
      'binding','--workspace',workspace.path],{
      encoding:'utf8',maxBuffer:1024*1024,timeout:15000,windowsHide:true,env:environment,
    });
    observed=JSON.parse(result.stdout);
  }catch(error){
    need(false,'APPLICATION_AVIARY_BINDING_UNAVAILABLE',
      'The original Aviary workspace could not open with the selected Python: '+
      String(error.stderr||error.message||error).trim().slice(0,1500));
  }
  need(plain(observed)&&observed.schema===BINDING&&observed.workspace===workspace.path&&
    UUID(observed.workspaceId)&&observed.sourceRoot===sourceRoot&&
    plain(observed.workspaceIdentity)&&plain(observed.source)&&plain(observed.python)&&SHA(observed.sha256),
    'APPLICATION_AVIARY_BINDING_CHANGED');
  const {sha256,...original}=observed;
  need(digest(JSON.stringify(canonical(original))+'\n')===sha256,'APPLICATION_AVIARY_BINDING_CHANGED');
  need(await realpath(observed.python.executable)===await realpath(python.executable)&&
    Array.isArray(observed.python.version)&&observed.python.version.length===3&&
    observed.python.version.every(Number.isSafeInteger)&&
    (observed.python.version[0]>3||observed.python.version[0]===3&&observed.python.version[1]>=11),
    'APPLICATION_AVIARY_PYTHON_CHANGED');
  need(Object.keys(observed.source).sort().join('\n')===[...NATIVE_SOURCES].sort().join('\n')&&
    NATIVE_SOURCES.every(name=>SHA(observed.source[name])),'APPLICATION_AVIARY_SOURCE_INCOMPLETE');
  const inputs=[workspace,...python.inputs];
  for(const name of NATIVE_SOURCES){
    const item=await inputPath(join(sourceRoot,name),'file');
    need(item.sha256===observed.source[name],'APPLICATION_AVIARY_SOURCE_CHANGED',
      'The original Aviary application changed during review.');
    inputs.push(item);
  }
  for(const name of ['application.mjs','application-provider.mjs'])
    inputs.push(await inputPath(join(sourceRoot,name),'file'));
  const marker=await inputPath(join(workspace.path,'source-manifest.json'),'file');
  need(marker.sha256===observed.workspaceIdentity.sourceManifestFileSha256&&
    String(workspace.dev)===observed.workspaceIdentity.device&&
    String(workspace.ino)===observed.workspaceIdentity.inode,
    'APPLICATION_AVIARY_WORKSPACE_CHANGED');
  inputs.push(marker);
  return {
    args:['--python',python.executable,'managed','--workspace',workspace.path,'--expected-binding',sha256],
    inputs,createDirectories:[],binding:observed,
  };
}

function selection(request){
  const args=request.args;
  need(Array.isArray(args)&&args.length===9&&args[0]==='--python'&&args[2]==='managed',
    'APPLICATION_AVIARY_REQUEST_CHANGED');
  const flags=new Map();
  for(let i=3;i<args.length;i+=2){
    need(['--workspace','--expected-binding','--port'].includes(args[i])&&
      !flags.has(args[i])&&typeof args[i+1]==='string','APPLICATION_AVIARY_REQUEST_CHANGED');
    flags.set(args[i],args[i+1]);
  }
  need(flags.size===3&&SHA(flags.get('--expected-binding'))&&
    /^(0|[1-9]\d*)$/.test(flags.get('--port'))&&Number(flags.get('--port'))<=65535,
    'APPLICATION_AVIARY_REQUEST_CHANGED');
  return {python:absolute(args[1]),workspace:absolute(flags.get('--workspace')),
    binding:flags.get('--expected-binding'),port:Number(flags.get('--port'))};
}

export async function aviaryStartup(request,text){
  if(request.command!=='aviary-workspace'||typeof text!=='string'||text.length>32768)return null;
  let value;try{value=JSON.parse(text);}catch{return null;}
  if(!plain(value)||value.schema!==STARTUP||value.status!=='AVIARY_WORKSPACE_READY')return null;
  const selected=selection(request);
  need(value.workspace===selected.workspace&&UUID(value.workspaceId)&&value.bindingSha256===selected.binding&&
    plain(value.python)&&plain(value.source)&&Number.isSafeInteger(value.pid)&&value.pid>0&&
    typeof value.sourceRoot==='string','APPLICATION_AVIARY_STARTUP_CHANGED');
  need(await realpath(value.python.executable)===await realpath(selected.python)&&
    await realpath(value.sourceRoot)===await realpath(join(absolute(request.releaseDirectory),'source',ROOT)),
    'APPLICATION_AVIARY_EXECUTION_CHANGED');
  need(Object.keys(value.source).sort().join('\n')===[...NATIVE_SOURCES].sort().join('\n')&&
    NATIVE_SOURCES.every(name=>SHA(value.source[name])),'APPLICATION_AVIARY_SOURCE_CHANGED');
  let url;try{url=new URL(value.url);}catch{need(false,'APPLICATION_AVIARY_STARTUP_CHANGED');}
  const port=Number(url.port||80);
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&port>=1&&port<=65535&&
    (!selected.port||port===selected.port)&&url.pathname==='/'&&!url.username&&!url.password&&
    !url.search&&!url.hash&&value.url===url.origin,'APPLICATION_AVIARY_STARTUP_CHANGED');
  const response=await fetch(new URL('/api/launch',url),{
    redirect:'error',headers:{origin:url.origin},signal:AbortSignal.timeout(5000),
  });
  const length=response.headers.get('content-length')??'';
  need(response.status===200&&/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??'')&&
    /^\d+$/.test(length)&&Number(length)<=32768,'APPLICATION_AVIARY_STARTUP_UNAVAILABLE');
  const bytes=await response.arrayBuffer();
  need(bytes.byteLength===Number(length)&&bytes.byteLength<=32768,'APPLICATION_AVIARY_STARTUP_CHANGED');
  let active;try{active=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{need(false,'APPLICATION_AVIARY_STARTUP_CHANGED');}
  need(JSON.stringify(canonical(active))===JSON.stringify(canonical(value)),
    'APPLICATION_AVIARY_STARTUP_CHANGED','The live original workspace differs from its launch announcement.');
  return {url:url.href,original:{
    schema:STARTUP,workspace:selected.workspace,workspaceId:value.workspaceId,
    bindingSha256:selected.binding,sourceRoot:value.sourceRoot,python:value.python,pid:value.pid,
  }};
}
