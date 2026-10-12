// MIT. Python applications in the original managed runtime lifecycle.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { absolute, canonical, digest, json, need, plain, saveJSON, now } from '../runtime-workspace/storage.mjs';
import { bindPythonApplicationCommand, preparePythonApplicationCommand } from './command-binding.mjs';
import { pythonRuntimeBinding } from './workspace.mjs';

const field=(name,label,type='path',required=false,description='')=>({name,label,type,required,description});
const installation=field('installationId','Installed Python environment','text',true,
  'Select the retained installation from the Python workspace.');
const environment=field('environmentFile','Private environment JSON','path');
const original='stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/stellar_forge_buyer/';
const key=value=>digest(json(canonical(value)));
export const PYTHON_APPLICATION_CATALOG=Object.freeze([
  {id:'python-analysis',python:true,command:'analysis',terminal:false,
    requiredSource:original+'analysis_workspace.py',title:'Analysis and workbook workspace',
    description:'Open the original analysis database, workbook sources, refresh review, reports and deliveries with its installed Python environment.',
    fields:[installation,field('databaseDirectory','Analysis database directory','path',true),
      field('nodeExecutable','Original Node executable','path',false,'Defaults to this managed runtime worker’s Node executable.'),
      field('port','Local port','port',false,'Use 0 to select an available loopback port.'),environment]},
  {id:'python-workbooks',python:true,command:'workbooks',terminal:false,
    requiredSource:original+'analysis_workbooks.py',title:'Workbook build and receiving',
    description:'Run the original workbook build, receive, inspect or copy command and retain its exact output and operating result.',
    fields:[installation,field('argumentsJSON','Original command arguments','json',true,
      'JSON array; for example ["inspect","--delivery","/private/delivery","--manifest-sha256","EXACT_SHA"].'),environment]},
  {id:'python-workbook-delivery',python:true,command:'workbookDelivery',terminal:false,
    requiredSource:original+'workbook_client.py',title:'Workbook delivery and refresh',
    description:'Run the original recipe or reviewed refresh against the selected analysis database and retained delivery operation.',
    fields:[installation,field('argumentsJSON','Original delivery arguments','json',true,
      'JSON array using --database, --recipe or --refresh-recipe, and --operation.'),environment]},
]);
function argumentsFrom(settings) {
  let args;
  try{args=JSON.parse(settings.argumentsJSON);}catch{need(false,'PYTHON_APPLICATION_ARGUMENTS_INVALID','Use a JSON array of original command arguments.');}
  need(Array.isArray(args) && args.every(item=>typeof item==='string'),'PYTHON_APPLICATION_ARGUMENTS_INVALID');
  return args;
}
function option(args,name) {
  const values=[];
  for(let index=0;index<args.length;index++){
    if(args[index]===name){need(index+1<args.length,'PYTHON_APPLICATION_ARGUMENTS_INVALID');values.push(args[index+1]);}
    else if(args[index].startsWith(name+'='))values.push(args[index].slice(name.length+1));
  }
  need(values.length<=1,'PYTHON_APPLICATION_ARGUMENTS_INVALID','Select '+name+' once.');
  return values[0];
}
export function pythonApplicationResource(type,settings) {
  if(type.command==='analysis')return key({family:'python-analysis',directory:settings.databaseDirectory});
  const args=argumentsFrom(settings);
  return key({family:'python-workbook',directory:option(args,'--operation')??option(args,'--destination')??
    option(args,'--delivery')??option(args,'--database')??null,args});
}
export async function pythonApplicationCommand(root,type,settings,{
  runtimeId,runtimeDirectory,inputPath,selectedExecutable,applicationEnvironment,
}={}) {
  need(type.python===true && PYTHON_APPLICATION_CATALOG.some(item=>item.id===type.id && item.command===type.command),
    'PYTHON_APPLICATION_KIND_INVALID');
  const binding=await pythonRuntimeBinding(runtimeDirectory,runtimeId),inputs=[];
  let args;
  if(type.command==='analysis'){
    inputs.push(await inputPath(settings.databaseDirectory,'directory',true,true));
    const node=await selectedExecutable(settings.nodeExecutable??process.execPath);
    inputs.push(...node.inputs);
    args=['--database',settings.databaseDirectory,'--checkout',binding.sourceRoot,'--node',node.executable,
      'serve','--port',String(settings.port??0)];
  }else{
    args=argumentsFrom(settings);
    for(const [flag,kind,missing,privateOnly] of [
      ['--database','directory',false,true],['--recipe','file',false,false],
      ['--refresh-recipe','file',false,false],['--archive','file',false,false],
      ['--delivery','directory',false,true],['--operation','directory',true,true],
      ['--destination','directory',true,true],
    ]){
      const path=option(args,flag);
      if(path!==undefined)inputs.push(await inputPath(absolute(path),kind,missing,privateOnly));
    }
  }
  const pythonCommand=await bindPythonApplicationCommand(root,{
    runtimeId,runtimeDirectory,installationId:settings.installationId,command:type.command,args,
  });
  if(settings.environmentFile)inputs.push(await inputPath(settings.environmentFile,'file'));
  const env=await applicationEnvironment(settings.environmentFile);
  return {command:type.command,args,inputs,createDirectories:[],terminal:false,pythonCommand,
    ...(settings.environmentFile?{environmentFile:settings.environmentFile,environmentSha256:env.sha256}:{})};
}
export async function validatePythonManagedCommand(root,request,selected) {
  const descriptor=request.pythonCommand;
  need(plain(descriptor) && request.applicationId && request.terminal!==true &&
    PYTHON_APPLICATION_CATALOG.some(item=>item.command===descriptor.command),
    'PYTHON_MANAGED_APPLICATION_REQUIRED');
  need(request.command===descriptor.command && key(request.args)===key(descriptor.args),
    'PYTHON_MANAGED_COMMAND_CHANGED');
  const runtime=selected.runtime;
  need(runtime && ['directory','installationId','profileId','profileSha256','sourceCommit','sourceManifestSha256']
    .every(name=>runtime[name]===descriptor.runtime?.[name]),'PYTHON_MANAGED_RELEASE_CHANGED');
  return preparePythonApplicationCommand(root,descriptor);
}
function launchBody(request) {
  const descriptor=request.pythonCommand;
  return {schema:'stellar-forge.python-command-launch.v1',requestHash:request.requestHash,
    releaseId:request.releaseId,digest:request.releaseDigest,command:request.command,
    executable:descriptor.executable,args:descriptor.argv,cwd:descriptor.cwd,
    binding:descriptor};
}
export async function pythonManagedLaunch(root,request,{leaseFd}={}) {
  await preparePythonApplicationCommand(root,request.pythonCommand,{leaseFd});
  return {...launchBody(request),createdAt:now()};
}
export function assertPythonManagedLaunch(request,launch) {
  const {createdAt,...body}=launch;
  need(typeof createdAt==='string' && key(body)===key(launchBody(request)),
    'PYTHON_MANAGED_LAUNCH_CHANGED');
}
export const pythonManagedStopSignal=request=>request.pythonCommand?.command==='analysis'?'SIGINT':'SIGTERM';
export async function preparePythonManagedChild(root,request,environment,{leaseFd=3}={}) {
  const command=await preparePythonApplicationCommand(root,request.pythonCommand,{leaseFd});
  return {executable:command.executable,args:command.args,
    options:{cwd:command.cwd,shell:false,env:environment,stdio:['ignore','pipe','pipe',leaseFd]}};
}
function privateURL(value) {
  try{
    const url=new URL(value);
    return url.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname) &&
      url.port && url.hash && !url.username && !url.password && value.length<=4096?url:null;
  }catch{return null;}
}
async function privateControl(path) {
  const handle=await open(absolute(path),constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await handle.stat();
    need(before.isFile() && before.nlink===1 && !(before.mode&0o077) && before.size<=65536 &&
      (process.getuid===undefined || before.uid===process.getuid()),'PYTHON_APPLICATION_PRIVATE_LAUNCH_REQUIRED');
    const bytes=await handle.readFile(),after=await handle.stat();
    need(bytes.length===before.size && before.size===after.size && before.mtimeMs===after.mtimeMs &&
      before.ctimeMs===after.ctimeMs,'PYTHON_APPLICATION_PRIVATE_LAUNCH_CHANGED');
    let value;
    try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
    catch{need(false,'PYTHON_APPLICATION_PRIVATE_LAUNCH_INVALID');}
    return value;
  }finally{await handle.close();}
}
const READ_ANALYSIS_IDENTITY="import json,sys\nfrom stellar_forge_buyer.analysis_workspace import AnalysisWorkspace\ns=AnalysisWorkspace.read_state(sys.argv[1])\nprint(json.dumps({'schema':s['schema'],'workspace_id':s['workspace_id'],'database':s['database']}))";
async function originalAnalysisIdentity(descriptor) {
  const database=descriptor.args[descriptor.args.indexOf('--database')+1];
  const child=spawn(descriptor.python,['-I','-c',READ_ANALYSIS_IDENTITY,database],
    {cwd:descriptor.cwd,shell:false,stdio:['ignore','pipe','pipe',3]});
  let bytes=Buffer.alloc(0),errorText='',oversized=false;
  child.stdout.on('data',value=>{if(bytes.length+value.length>65536){oversized=true;child.kill('SIGTERM');}else bytes=Buffer.concat([bytes,value]);});
  child.stderr.on('data',value=>{if(errorText.length<4096)errorText+=value.toString('utf8');});
  const timer=setTimeout(()=>child.kill('SIGTERM'),15000);
  try{
    const exit=await new Promise((accept,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>accept({code,signal}));});
    need(exit.code===0 && !oversized,'PYTHON_APPLICATION_IDENTITY_UNAVAILABLE',
      'The original Analysis database identity could not be reopened.'+(errorText?' '+errorText.slice(0,1000):''));
    return JSON.parse(bytes.toString('utf8'));
  }finally{clearTimeout(timer);}
}
export function observePythonApplicationOutput(request,directory,{pid}={}) {
  const descriptor=request.pythonCommand,ready=descriptor.ready;
  let buffer='',seen=false,closed=false,saving=Promise.resolve(),savedError=null;
  const decoder=new StringDecoder('utf8');
  async function line(text) {
    if(seen || !ready || ready.kind!=='analysis-private-launch')return;
    let announcement;
    try{announcement=JSON.parse(text);}catch{return;}
    if(announcement.status!=='LISTENING')return;
    need(announcement.private_launch===ready.file && Number.isInteger(pid) && pid>0,
      'PYTHON_APPLICATION_PRIVATE_LAUNCH_CHANGED');
    const control=await privateControl(ready.file),url=privateURL(control.url);
    need(control.schema===ready.schema && control.pid===pid && url &&
      url.href.split('#')[0]===announcement.address,'PYTHON_APPLICATION_PRIVATE_LAUNCH_CHANGED');
    const identity=await originalAnalysisIdentity(descriptor);
    need(identity.schema===ready.schema && identity.workspace_id===control.workspace_id,
      'PYTHON_APPLICATION_DATABASE_CHANGED');
    await saveJSON(join(directory,'application-url.json'),{
      schema:'stellar-forge.application-url.v1',applicationId:request.applicationId,
      operationId:directory.split('/').at(-1),command:request.command,
      source:'original-analysis-private-launch',observedAt:now(),url:url.href,
      workspaceId:control.workspace_id,privateLaunch:ready.file,originalPid:pid,
      pythonInstallation:descriptor.installationId,bindingFingerprint:descriptor.fingerprint,
    });
    seen=true;
  }
  function queue(text){
    saving=saving.then(()=>line(text)).catch(error=>{if(!savedError)savedError=error;});
  }
  return {
    write(bytes){
      if(closed || seen || !ready)return;
      buffer+=decoder.write(bytes);
      const lines=buffer.split(/\r?\n/);buffer=lines.pop();
      for(const text of lines)queue(text);
      if(buffer.length>16384)buffer=buffer.slice(-16384);
    },
    async close(){
      if(!closed){closed=true;buffer+=decoder.end();if(buffer)queue(buffer);}
      await saving;if(savedError)throw savedError;
    },
  };
}
