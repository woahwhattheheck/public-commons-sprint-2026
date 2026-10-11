#!/usr/bin/env node
// MIT. Complete operator commands for the original single-merchant container.
import { spawn } from 'node:child_process';
import { readFile,lstat } from 'node:fs/promises';
import { resolve,join,isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { checkContainer,validateContainerSpec,CONTAINER_SCHEMA } from './container.mjs';

const BASE='stellar/scf-starforge-20261009/sf99-merchant-deploy/';
const need=(value,message)=>{if(!value)throw new Error(message);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function bytes(file){
  const stat=await lstat(file);
  need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=2*1024*1024,'Original regular operator artifact required');
  const data=await readFile(file);need(data.length<=2*1024*1024,'Operator artifact grew beyond limit');return data;
}
const json=async file=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(file)));

/** Stop/status need saved project identity even when live input bytes changed. */
export async function inspectContainerOperation(bundle){
  bundle=resolve(bundle);
  const container=await json(join(bundle,'container.json'));
  need(container.schema===CONTAINER_SCHEMA&&container.bundle===bundle&&object(container.spec),
    'Original container manifest required at its generated path');
  const spec=validateContainerSpec(container.spec);
  need(container.hostBundle===join(bundle,'host')&&container.composeFile===join(bundle,'compose.json'),
    'Use the original nested host and saved Compose path');
  const hostBytes=await bytes(join(container.hostBundle,'deployment.json'));
  need(hash(hostBytes)===container.hostManifestSha256,'Original host manifest changed');
  const host=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(hostBytes));
  need(host.schema==='stellar-forge.merchant-host.v1'&&host.bundle===container.hostBundle&&
    /^[a-z][a-z0-9-]{0,39}$/.test(host.merchant??''),'Original merchant host selection required');
  need(container.project==='stellar-forge-'+host.merchant&&container.service==='merchant'&&
    container.hostname===container.project&&container.networkMode==='host'&&
    container.sourceRoot===host.sourceRoot&&container.stateRoot===host.stateRoot,
    'Saved container project no longer matches the original merchant');
  for(const [key,value] of Object.entries(spec))need(same(container[key],value),'Saved runtime selection changed: '+key);
  need(object(container.artifacts)&&same(Object.keys(container.artifacts).sort(),['RUNBOOK.md','compose.json']),
    'Complete original container artifacts required');
  for(const [name,expected] of Object.entries(container.artifacts)){
    need(/^[a-f0-9]{64}$/.test(expected),'Invalid container artifact digest');
    need(hash(await bytes(join(bundle,name)))===expected,'Container artifact changed: '+name);
  }
  const compose=await json(container.composeFile),service=compose.services?.[container.service];
  need(compose.name===container.project&&object(compose.services)&&
    same(Object.keys(compose.services),[container.service])&&object(service)&&
    service.image===container.image&&service.hostname===container.hostname&&service.network_mode==='host',
    'Saved Compose project differs from the selected merchant');
  return {host,container,bundle};
}

function executable(value){
  need(value==='docker'||typeof value==='string'&&isAbsolute(value)&&resolve(value)===value&&
    !/[\x00-\x1f\x7f]/.test(value),'Docker must be the existing docker command or an absolute executable');
  return value;
}
async function command(file,args,{maximum=2*1024*1024}={}){
  return new Promise((accept,reject)=>{
    const child=spawn(file,args,{stdio:['ignore','pipe','pipe'],shell:false});
    const output={stdout:[],stderr:[]};let count=0,failed=false;
    for(const name of ['stdout','stderr'])child[name].on('data',chunk=>{
      count+=chunk.length;
      if(count>maximum){if(!failed){failed=true;child.kill('SIGTERM');reject(new Error('Docker output exceeded the retained operation limit'));}return;}
      output[name].push(chunk);
    });
    child.once('error',error=>reject(new Error(error.code==='ENOENT'?'Docker Compose is unavailable on this selected host':error.message)));
    child.once('close',(exitCode,signal)=>accept({exitCode:exitCode??1,signal,
      stdout:Buffer.concat(output.stdout).toString('utf8'),stderr:Buffer.concat(output.stderr).toString('utf8')}));
  });
}
function parsedJSON(output){
  const value=output.trim();if(!value)return null;
  try{return JSON.parse(value);}catch{
    return value.split('\n').filter(Boolean).map(line=>JSON.parse(line));
  }
}
function success(result,operation){
  if(result.exitCode!==0)throw Object.assign(new Error('Docker '+operation+' failed with exit '+result.exitCode),
    {code:'CONTAINER_OPERATION_FAILED',operation,exitCode:result.exitCode,providerStderr:result.stderr});
  return result;
}
const composeArgs=(container,args)=>['compose','--project-name',container.project,
  '--project-directory',container.bundle,'--file',container.composeFile,...args];
async function compose(docker,container,args,options){return command(docker,composeArgs(container,args),options);}
async function retainedRuntime(host){
  try{
    const value=await json(join(host.stateRoot,'.container-runtime','runtime.json'));
    need(value.schema==='stellar-forge.merchant-container-runtime.v1'&&value.merchant===host.merchant,
      'Original retained runtime record required');
    return {runtimeId:value.runtimeId,phase:value.phase,mode:value.mode,updatedAt:value.updatedAt,
      failure:value.failure,children:value.children};
  }catch(error){if(error.code==='ENOENT')return null;return {readable:false,error:'RETAINED_RUNTIME_UNAVAILABLE'};}
}
async function status(docker,host,container,{probe=true}={}){
  const result=success(await compose(docker,container,['ps','--all','--format','json']),'status');
  const parsed=parsedJSON(result.stdout),rows=parsed===null?[]:Array.isArray(parsed)?parsed:[parsed];
  need(rows.every(object),'Docker returned an unreadable container status');
  const selected=rows.filter(row=>(row.Service??row.service)===container.service);
  const running=selected.filter(row=>(row.State??row.state)==='running');
  let native=null;
  if(probe&&running.length===1){
    const observed=await compose(docker,container,['exec','-T',container.service,host.node,
      join(host.sourceRoot,BASE+'container-runtime.mjs'),'status','--bundle',container.hostBundle]);
    if(observed.exitCode===0){try{native=parsedJSON(observed.stdout);}catch{native={readable:false,error:'NATIVE_STATUS_UNREADABLE'};}}
    else native={readable:false,error:'NATIVE_STATUS_UNAVAILABLE',exitCode:observed.exitCode};
  }
  return {containers:selected,running:running.length,native,retained:await retainedRuntime(host)};
}

export async function runContainerOperation(bundle,operation,{docker='docker',publicOrigin=false,tail=100,waitSeconds}={}){
  need(['pull','up','status','stop','logs','smoke'].includes(operation),'Select pull, up, status, stop, logs or smoke');
  docker=executable(docker);
  const selected=['up','smoke'].includes(operation)?await checkContainer(bundle):await inspectContainerOperation(bundle);
  const {host,container}=selected;
  const base={operation,merchant:host.merchant,bundle:selected.bundle,project:container.project,service:container.service,image:container.image};
  if(operation==='pull'){
    need(container.image.includes('@sha256:'),'A local image ID is loaded through its original image workflow; pull requires the selected registry digest');
    success(await command(docker,['pull',container.image]),'pull');
    const result=success(await command(docker,['image','inspect',container.image,'--format','{{json .Id}}']),'image inspect');
    return {...base,imageId:parsedJSON(result.stdout)};
  }
  if(operation==='status')return {...base,...await status(docker,host,container)};
  if(operation==='logs'){
    need(Number.isInteger(tail)&&tail>=1&&tail<=10000,'Log tail must be between 1 and 10000 lines');
    const result=success(await compose(docker,container,['logs','--no-color','--tail',String(tail),container.service],{maximum:8*1024*1024}),'logs');
    return {...base,log:result.stdout+result.stderr};
  }
  if(operation==='stop'){
    const prior=await retainedRuntime(host);
    success(await compose(docker,container,['stop',container.service]),'stop');
    const after=await status(docker,host,container,{probe:false});
    need(after.running===0,'Docker still reports the selected merchant running after stop');
    return {...base,priorRuntimeId:prior?.runtimeId??null,...after};
  }
  if(operation==='smoke'){
    const result=await compose(docker,container,['exec','-T',container.service,host.node,
      join(host.sourceRoot,BASE+'cli.mjs'),'smoke','--bundle',container.hostBundle,...(publicOrigin?['--public']:[])]);
    let native;try{native=parsedJSON(result.stdout);}catch{success(result,'native smoke');}
    if(!object(native)||native.merchant!==host.merchant||typeof native.passed!=='boolean'){
      success(result,'native smoke');throw new Error('Original merchant smoke result required');
    }
    const observed=await status(docker,host,container);
    const ready=observed.running===1&&observed.native?.ready===true&&observed.native?.mode==='all';
    return {...base,passed:result.exitCode===0&&native.passed&&ready,native,runtime:observed};
  }
  waitSeconds??=container.startupTimeoutSeconds+30;
  need(Number.isInteger(waitSeconds)&&waitSeconds>=container.startupTimeoutSeconds&&waitSeconds<=900,
    'Wait must cover the selected native startup timeout and be at most 900 seconds');
  success(await compose(docker,container,['up','--detach','--wait','--wait-timeout',String(waitSeconds),
    '--no-build','--pull','never',container.service]),'start');
  const observed=await status(docker,host,container);
  need(observed.running===1&&observed.native?.ready===true&&observed.native?.mode==='all','The selected container started but its original merchant is not ready; inspect status and logs');
  return {...base,...observed};
}

const HELP=`node cli.mjs container pull|up|status|stop|logs|smoke --bundle CONTAINER_DIRECTORY
  [--docker /absolute/path/to/docker]
  [--tail 100]          logs only
  [--public]            smoke only
  [--wait-seconds 120]  up only

Commands operate the original saved merchant project. Up uses the already loaded
image and unchanged original source. Stop/status/logs retain the saved project
selection after live input drift. Runtime status and smoke run inside the same
container as the original merchant. Stop preserves every bind-mounted state file.`;

export async function main(args=process.argv.slice(2)){
  if(!args.length||args[0]==='--help'){console.log(HELP);return 0;}
  const [operation,...rest]=args,allowed=['--bundle','--docker',
    ...(operation==='logs'?['--tail']:[]),...(operation==='up'?['--wait-seconds']:[]),...(operation==='smoke'?['--public']:[])];
  const values={};
  for(let index=0;index<rest.length;index++){
    const key=rest[index];need(allowed.includes(key)&&!Object.hasOwn(values,key),HELP);
    if(key==='--public')values[key]=true;
    else{need(rest[index+1]&&!rest[index+1].startsWith('--'),HELP);values[key]=rest[++index];}
  }
  need(values['--bundle'],HELP);
  for(const key of ['--tail','--wait-seconds'])if(values[key]!==undefined)need(/^[1-9][0-9]{0,4}$/.test(values[key]),HELP);
  const result=await runContainerOperation(values['--bundle'],operation,{
    docker:values['--docker']??'docker',publicOrigin:!!values['--public'],
    ...(values['--tail']?{tail:Number(values['--tail'])}:{}),
    ...(values['--wait-seconds']?{waitSeconds:Number(values['--wait-seconds'])}:{}),
  });
  if(operation==='logs')process.stdout.write(result.log);
  else console.log(JSON.stringify(result,null,2));
  return result.passed===false?1:0;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().then(code=>{process.exitCode=code;}).catch(error=>{console.error(error.message);process.exitCode=1;});
