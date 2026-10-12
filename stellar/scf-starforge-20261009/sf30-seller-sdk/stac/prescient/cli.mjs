#!/usr/bin/env node
// MIT. Prescient operator commands reuse the original STAC host and customer engine.
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {initializePrescientOperator,openPrescientOperator} from './runtime.mjs';
import {openPrescientConfiguration,receivePrescientProfile,portablePrescientProfile} from './configuration.mjs';
import {startStacServer} from '../server.mjs';
import {stacRetain} from '../merchant.mjs';

export const PRESCIENT_HELP=`Prescient reviewed customer workspace

  starforge stac prescient-init --workspace DIR --profile PROFILE_JSON --actor NAME
  starforge stac prescient-serve --workspace DIR --deployment PRIVATE_HOST_JSON [--port 0]
  starforge stac prescient-state --workspace DIR
  starforge stac prescient-profile-save --workspace DIR --input COMMAND_JSON
  starforge stac prescient-profile-review --workspace DIR --input COMMAND_JSON
  starforge stac prescient-profile-approve --workspace DIR --input COMMAND_JSON
  starforge stac prescient-profile-import --workspace DIR --input PORTABLE_PROFILE --binding ID --actor NAME
  starforge stac prescient-profile-export --workspace DIR --profile-sha256 HASH --out FILE

Runtime and original receiving commands:
  starforge stac prescient-connect --workspace DIR --deployment PRIVATE_HOST_JSON --input COMMAND_JSON
  starforge stac prescient-session --workspace DIR --deployment PRIVATE_HOST_JSON --input COMMAND_JSON
  starforge stac prescient-delivery-review --workspace DIR --deployment PRIVATE_HOST_JSON --input COMMAND_JSON
  starforge stac prescient-delivery-export --workspace DIR --deployment PRIVATE_HOST_JSON --input COMMAND_JSON
  starforge stac prescient-delivery-open --workspace DIR --deployment PRIVATE_HOST_JSON --input COMMAND_JSON

Command JSON carries actor, operationId and expectedRevision, plus the exact reviewed
input. Use the SAME operationId after an interrupted response. Completed commands
return the original saved result. A profile change requires its own review and approval.
The deployment JSON contains private file references and trusted receiving roots;
credentials remain in their host-owned files or environment. OPERATOR.md defines the
profile, original SDK installation and full receiving procedure.
`;
const need=(value,code)=>{if(!value)throw Object.assign(new Error(code),{code});return value;};
const required=(flags,key)=>need(typeof flags[key]==='string'&&flags[key], 'PRESCIENT_FLAG_'+key.replaceAll('-','_').toUpperCase()+'_REQUIRED');
async function jsonFile(path){
  const bytes=await readFile(resolve(path));need(bytes.length<=1024*1024,'PRESCIENT_COMMAND_FILE_TOO_LARGE');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
const configuration=directory=>openPrescientConfiguration({directory:join(directory,'operator'),create:false});
export async function runPrescientCommand({command,flags={}}={}){
  command=command.replace(/^prescient-/u,'');
  if(command==='help')return {result:{help:PRESCIENT_HELP}};
  const directory=resolve(required(flags,'workspace'));
  if(command==='init')return {result:await initializePrescientOperator({directory,
    profile:await jsonFile(required(flags,'profile')),actor:required(flags,'actor'),
    operationId:flags['operation-id']??'initial-profile'})};
  if(command==='state')return {result:await (await configuration(directory)).getState()};
  if(command==='profile-export'){
    const state=await (await configuration(directory)).getState(),record=state.profiles.find(row=>row.sha256===required(flags,'profile-sha256'));
    need(record,'PRESCIENT_PROFILE_NOT_FOUND');const result=portablePrescientProfile(record.profile);
    await stacRetain(resolve(required(flags,'out')),Buffer.from(JSON.stringify(result,null,2)+'\n'));
    return {result:{profileSha256:record.sha256,out:resolve(flags.out)}};
  }
  if(command.startsWith('profile-')){
    const store=await configuration(directory);
    if(command==='profile-import'){
      const profile=receivePrescientProfile(await jsonFile(required(flags,'input')),required(flags,'binding'));
      return {result:await store.saveProfile({profile,actor:required(flags,'actor')},
        {operationId:flags['operation-id']??randomUUID(),...(flags['expected-revision']===undefined?{}:{expectedRevision:Number(flags['expected-revision'])})})};
    }
    const input=await jsonFile(required(flags,'input'));
    const method={'profile-save':'saveProfile','profile-review':'reviewProfile','profile-approve':'approveProfile'}[command];
    need(method,'PRESCIENT_COMMAND_UNKNOWN');return {result:await store[method](input,input)};
  }
  const deployment=await jsonFile(required(flags,'deployment'));
  const runtime=await openPrescientOperator({directory,deployment,
    ...(flags['profile-sha256']?{profileSha256:flags['profile-sha256']}:{})});
  try{
    if(command==='serve'){
      let server,workspaceId;
      try{workspaceId=(await runtime.workspace.getState()).id;
        server=await startStacServer({workspace:runtime.workspace,prescient:runtime.controller,port:Number(flags.port??0)});}
      catch(error){await runtime.close();throw error;}
      return {result:{url:server.url,workspaceId,directory,profileSha256:runtime.selectedProfileSha256},
        close:async()=>{await runtime.close();await server.close();}};
    }
    const routes={connect:'/connect',session:'/session','delivery-review':'/deliveries/review',
      'delivery-export':'/deliveries/export','delivery-open':'/deliveries/open'};
    need(routes[command],'PRESCIENT_COMMAND_UNKNOWN');
    const body=await jsonFile(required(flags,'input'));
    const result=await runtime.controller.dispatch({method:'POST',path:routes[command],body});
    return {result};
  }finally{if(command!=='serve')await runtime.close();}
}
export async function runPrescientCLI(argv=process.argv.slice(2)){
  const [command,...rest]=argv,flags={};
  for(let i=0;i<rest.length;i+=2){need(/^--[a-z][a-z0-9-]*$/u.test(rest[i])&&typeof rest[i+1]==='string'&&!rest[i+1].startsWith('--'),'PRESCIENT_ARGUMENT_INVALID');
    const key=rest[i].slice(2);need(!Object.hasOwn(flags,key),'PRESCIENT_DUPLICATE_FLAG');flags[key]=rest[i+1];}
  const result=await runPrescientCommand({command:command??'help',flags});
  process.stdout.write(JSON.stringify(result.result)+'\n');
  if(result.close)await new Promise((resolveDone,reject)=>{
    let closing=false;
    const stop=()=>{if(closing)return;closing=true;result.close().then(resolveDone,reject);};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
  });
}
const invoked=process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href;
if(invoked)runPrescientCLI().catch(error=>{
  process.stderr.write(JSON.stringify({error:{code:/^[A-Z0-9_]+$/u.test(error?.code??'')?error.code:'PRESCIENT_COMMAND_FAILED'}})+'\n');
  process.exitCode=1;
});
