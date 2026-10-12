// MIT. Managed Applications opens the original preservation workbench and source.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {realpath,lstat,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,dirname} from 'node:path';
import {absolute,canonical,digest,need,plain} from '../../../distribution/runtime-workspace/storage.mjs';

const execute=promisify(execFile);
const SDK='stellar/scf-starforge-20261009/sf88-operator-buyer-cli';
const ROOT=SDK+'/research/preservation';
const BINDING='stellar-forge.preservation-workbench-binding.v1';
const STARTUP='stellar-forge.preservation-workbench-launch.v1';
const SHA=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const BASE_SOURCE=Object.freeze([
  'research/preservation/preservation.py','research/preservation/roda.py',
  'research/preservation/roda_client.py','research/preservation/workbench.py',
  'research/preservation/workbench.html','research/preservation/workbench.js',
  'research/preservation/WORKBENCH.md','research/preservation/README.md',
  'research/preservation/RODA.md','research/preservation/RODA_REST.md',
  'research/preservation/cli.mjs','research/oai/oai_feed.py',
]);
const PRESERVICA_SOURCE=Object.freeze([
  'research/preservation/preservica.py','research/preservation/preservica_client.py',
  'research/preservation/PRESERVICA.md','research/preservation/PRESERVICA_PROVIDER_CONTRACT.md',
]);
const LIBNOVA_SOURCE=Object.freeze([
  'research/preservation/libnova.py','research/preservation/libnova_client.py',
  'research/preservation/LIBNOVA.md','research/preservation/LIBNOVA_PROVIDER_CONTRACT.md',
  'research/preservation/libnova-requirements.txt',
]);
const field=(name,label,type,required,description)=>({name,label,type,required,description});
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));

function nativeSources(value){
  need(plain(value),'APPLICATION_PRESERVATION_SOURCE_INCOMPLETE');
  const names=Object.keys(value),groups=[PRESERVICA_SOURCE,LIBNOVA_SOURCE];
  const optional=groups.flatMap(group=>group.filter(name=>Object.hasOwn(value,name)));
  need(BASE_SOURCE.every(name=>Object.hasOwn(value,name))&&
    groups.every(group=>group.every(name=>Object.hasOwn(value,name))||
      group.every(name=>!Object.hasOwn(value,name)))&&
    names.length===BASE_SOURCE.length+optional.length&&names.every(name=>SHA(value[name])),
    'APPLICATION_PRESERVATION_SOURCE_INCOMPLETE');
  return names;
}

async function inputDigest(input){
  if(SHA(input.sha256))return input.sha256;
  const handle=await open(input.path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const before=await handle.stat();
    need(before.isFile()&&before.dev===input.dev&&before.ino===input.ino&&
      before.size===input.bytes&&before.mtimeMs===input.mtimeMs&&before.ctimeMs===input.ctimeMs,
      'APPLICATION_PRESERVATION_SOURCE_CHANGED');
    const hash=createHash('sha256');let bytes=0;
    for await(const chunk of handle.createReadStream({autoClose:false})){hash.update(chunk);bytes+=chunk.length;}
    const after=await handle.stat();
    need(bytes===before.size&&after.size===before.size&&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs,
      'APPLICATION_PRESERVATION_SOURCE_CHANGED');
    return hash.digest('hex');
  }finally{await handle.close();}
}

export function preservationApplication(common=[]){
  return {
    id:'preservation-workspace',command:'preservation-workspace',title:'Research preservation',
    terminal:false,requiredSource:ROOT+'/workbench.py',
    description:'Review the original research records, retain exact destination revisions, operate Archivematica, RODA, Preservica and LIBNOVA handoffs, and reopen complete editable workspaces.',
    fields:[
      field('directory','Preservation workspace','path',true,
        'Choose an initialized or received workspace, or a new directory path below an existing private parent.'),
      field('pythonExecutable','Existing Python executable','path',true,
        'Select the original Python 3.11 or later executable. The workbench uses its standard library; LIBNOVA S3 operations also use the declared boto3 dependency.'),
      ...common,
    ],
  };
}

export async function preparePreservationApplication(settings,{
  inputPath,selectedExecutable,runtimeDirectory,applicationEnvironment,
}={}){
  need(typeof inputPath==='function'&&typeof selectedExecutable==='function'&&
    typeof applicationEnvironment==='function','APPLICATION_PRESERVATION_CONTEXT_REQUIRED');
  const workspace=await inputPath(settings.directory,'directory',true,true);
  const parent=await inputPath(dirname(workspace.path),'directory',false,!workspace.exists);
  const python=await selectedExecutable(settings.pythonExecutable);
  const {inspectMerchantRuntime}=await import('../../../sf46-release/runtime-package.mjs');
  const selected=await inspectMerchantRuntime(runtimeDirectory,{load:false});
  const sourceRoot=await realpath(join(selected.sourceRoot,SDK));
  const {environment}=await applicationEnvironment(settings.environmentFile);
  let observed;
  try{
    const result=await execute(python.executable,['-B',join(sourceRoot,'research/preservation/workbench.py'),
      'binding','--workspace',workspace.path],{
      encoding:'utf8',maxBuffer:1024*1024,timeout:120000,windowsHide:true,env:environment,
    });
    observed=JSON.parse(result.stdout);
  }catch(error){
    need(false,'APPLICATION_PRESERVATION_BINDING_UNAVAILABLE',
      'The original preservation workspace could not open with the selected Python: '+
      String(error.stderr||error.message||error).trim().slice(0,1500));
  }
  need(plain(observed)&&observed.schema===BINDING&&observed.workspace===workspace.path&&
    observed.sourceRoot===sourceRoot&&plain(observed.workspaceIdentity)&&plain(observed.python)&&SHA(observed.sha256),
    'APPLICATION_PRESERVATION_BINDING_CHANGED');
  const {sha256,...original}=observed;
  need(digest(JSON.stringify(canonical(original)))===sha256,'APPLICATION_PRESERVATION_BINDING_CHANGED');
  const identity=observed.workspaceIdentity;
  need(identity.parent===parent.path&&String(parent.dev)===identity.parentDevice&&
    String(parent.ino)===identity.parentInode&&['initialized','awaiting-source'].includes(identity.state),
    'APPLICATION_PRESERVATION_WORKSPACE_CHANGED');
  need(await realpath(observed.python.executable)===await realpath(python.executable)&&
    Array.isArray(observed.python.version)&&observed.python.version.length===3&&
    observed.python.version.every(Number.isSafeInteger)&&
    (observed.python.version[0]>3||observed.python.version[0]===3&&observed.python.version[1]>=11),
    'APPLICATION_PRESERVATION_PYTHON_CHANGED');
  const inputs=[workspace,parent,...python.inputs];
  for(const name of nativeSources(observed.source)){
    const item=await inputPath(join(sourceRoot,name),'file');
    need(await inputDigest(item)===observed.source[name],'APPLICATION_PRESERVATION_SOURCE_CHANGED');
    inputs.push(item);
  }
  for(const name of ['application.mjs','application-provider.mjs'])
    inputs.push(await inputPath(join(sourceRoot,'research/preservation',name),'file'));
  if(identity.state==='initialized'){
    need(String(workspace.dev)===identity.device&&String(workspace.ino)===identity.inode&&
      SHA(identity.sourceBindingSha256)&&Number.isSafeInteger(identity.sourceRecords)&&identity.sourceRecords>=0,
      'APPLICATION_PRESERVATION_WORKSPACE_CHANGED');
    for(const [name,key]of [['project.json','projectSha256'],['prepared.json','preparedSha256']]){
      const item=await inputPath(join(workspace.path,name),'file');
      need(await inputDigest(item)===identity[key],'APPLICATION_PRESERVATION_WORKSPACE_CHANGED');
      inputs.push(item);
    }
  }else{
    const present=await lstat(workspace.path).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    need(present===null,'APPLICATION_PRESERVATION_WORKSPACE_CHANGED');
  }
  const port=Number(settings.port??0);
  need(Number.isSafeInteger(port)&&port>=0&&port<=65535,'APPLICATION_PRESERVATION_PORT');
  return {
    args:['--python',python.executable,'workbench','serve','--workspace',workspace.path,
      '--expected-binding',sha256,'--port',String(port)],
    inputs,createDirectories:[],binding:observed,
  };
}

function selection(request){
  const args=request.args;
  need(Array.isArray(args)&&args.length===10&&args[0]==='--python'&&
    args[2]==='workbench'&&args[3]==='serve','APPLICATION_PRESERVATION_REQUEST_CHANGED');
  const flags=new Map();
  for(let i=4;i<args.length;i+=2){
    need(['--workspace','--expected-binding','--port'].includes(args[i])&&
      !flags.has(args[i])&&typeof args[i+1]==='string','APPLICATION_PRESERVATION_REQUEST_CHANGED');
    flags.set(args[i],args[i+1]);
  }
  need(flags.size===3&&SHA(flags.get('--expected-binding'))&&
    /^(0|[1-9]\d*)$/.test(flags.get('--port'))&&Number(flags.get('--port'))<=65535,
    'APPLICATION_PRESERVATION_REQUEST_CHANGED');
  return {python:absolute(args[1]),workspace:absolute(flags.get('--workspace')),
    binding:flags.get('--expected-binding'),port:Number(flags.get('--port'))};
}

export async function preservationStartup(request,text){
  if(request.command!=='preservation-workspace'||typeof text!=='string'||text.length>65536)return null;
  let value;try{value=JSON.parse(text);}catch{return null;}
  if(!plain(value)||value.schema!==STARTUP||value.status!=='PRESERVATION_WORKBENCH_READY')return null;
  const selected=selection(request);
  need(value.application==='stellar-forge.preservation-workbench.v1'&&value.workspace===selected.workspace&&
    value.bindingSha256===selected.binding&&plain(value.workspaceIdentity)&&
    typeof value.instanceId==='string'&&/^[a-f0-9]{32}$/.test(value.instanceId)&&
    plain(value.python)&&Number.isSafeInteger(value.pid)&&value.pid>0&&typeof value.sourceRoot==='string',
    'APPLICATION_PRESERVATION_STARTUP_CHANGED');
  need(await realpath(value.python.executable)===await realpath(selected.python)&&
    await realpath(value.sourceRoot)===await realpath(join(absolute(request.releaseDirectory),'source',SDK)),
    'APPLICATION_PRESERVATION_EXECUTION_CHANGED');
  nativeSources(value.source);
  let url;try{url=new URL(value.url);}catch{need(false,'APPLICATION_PRESERVATION_STARTUP_CHANGED');}
  const port=Number(url.port||80);
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&port>=1&&port<=65535&&
    (!selected.port||port===selected.port)&&url.pathname==='/'&&!url.username&&!url.password&&
    !url.search&&!url.hash&&value.url===url.origin,'APPLICATION_PRESERVATION_STARTUP_CHANGED');
  const response=await fetch(new URL('/api/launch',url),{
    redirect:'error',headers:{origin:url.origin},signal:AbortSignal.timeout(5000),
  });
  const length=response.headers.get('content-length')??'';
  need(response.status===200&&/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??'')&&
    /^\d+$/.test(length)&&Number(length)<=65536,'APPLICATION_PRESERVATION_STARTUP_UNAVAILABLE');
  const bytes=await response.arrayBuffer();
  need(bytes.byteLength===Number(length)&&bytes.byteLength<=65536,'APPLICATION_PRESERVATION_STARTUP_CHANGED');
  let active;try{active=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{need(false,'APPLICATION_PRESERVATION_STARTUP_CHANGED');}
  need(equal(active,value),'APPLICATION_PRESERVATION_STARTUP_CHANGED',
    'The live original workspace differs from its launch announcement.');
  return {url:url.href,original:{
    schema:STARTUP,workspace:selected.workspace,instanceId:value.instanceId,pid:value.pid,
    bindingSha256:selected.binding,workspaceIdentity:value.workspaceIdentity,
    sourceRoot:value.sourceRoot,python:value.python,
  }};
}
