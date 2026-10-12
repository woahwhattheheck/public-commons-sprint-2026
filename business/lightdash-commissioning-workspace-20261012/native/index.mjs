import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {mkdir,readFile,realpath} from 'node:fs/promises';
import {check,readJson,saveJson,objectDigest,fileIdentity,verifyManifest} from './files.mjs';
import {describeEngine,planOperation,validatePlan} from './contract.mjs';
import {inheritReceiving} from './lease.mjs';
export {describeEngine,planOperation};
const HERE=path.dirname(fileURLToPath(import.meta.url));
function roots(workspaceDir,operationDir){check(path.isAbsolute(workspaceDir)&&path.isAbsolute(operationDir),'LIGHTDASH_PATH','Native operations need absolute workspace paths.');const workspace=path.resolve(workspaceDir),operation=path.resolve(operationDir);check(operation.startsWith(workspace+path.sep),'LIGHTDASH_OPERATION_SCOPE','Native operation must be inside its owning workspace.');return{workspace,operation,native:path.join(operation,'native')};}
async function runtimeStillMatches(operation){for(const e of [...Object.values(operation.connection.runtime).filter(v=>v?.path),operation.connection.runtime.package,...Object.values(operation.connection.runtime.modules)]){const p=e.path??e.file;const actual=await fileIdentity(p);check(actual.sha256===e.sha256&&actual.bytes===e.bytes,'LIGHTDASH_RUNTIME_CHANGED','Selected original executable or CLI module changed.');}}
async function staged({workspaceDir,operationDir,operation},create){
 validatePlan(operation);const r=roots(workspaceDir,operationDir);
 if(create){
  await mkdir(r.native,{recursive:true,mode:0o700});
  await saveJson(path.join(r.native,'plan.json'),operation,{createOnly:true});
  const index=path.join(r.workspace,'native-state','operations');await mkdir(index,{recursive:true,mode:0o700});
  await saveJson(path.join(index,operation.operationId+'.json'),{schema:'lightdash-commissioning.operation-location.v1',operationId:operation.operationId,digest:operation.digest,nativeDirectory:r.native},{createOnly:true});
 }else{
  const saved=await readJson(path.join(r.native,'plan.json'),{optional:true});if(!saved)return {...r,absent:true};check(objectDigest(saved)===objectDigest(operation),'LIGHTDASH_PLAN_CHANGED','The requested operation differs from retained native state.');
 }
 return r;
}
async function host(mode,r,operation){
 const executable=operation.connection.runtime.python.path;
 const args=['-I','-B',path.join(HERE,'host.py'),mode,'--workspace',r.workspace,'--native',r.native];
 const child=spawn(executable,args,inheritReceiving(['ignore','pipe','pipe']));
 let out='',err='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 child.stdout.on('data',b=>{out+=b;if(out.length>4*1024*1024)child.kill('SIGTERM');});
 child.stderr.on('data',b=>{err=(err+b).slice(-16384);});
 const exited=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 let reply;try{reply=JSON.parse(out.trim());}catch{check(false,'LIGHTDASH_HOST_INTERRUPTED','The native host ended without a complete response. Inspect the same retained operation before continuing.',{processExit:exited});}
 check(reply&&reply.operationId===operation.operationId&&reply.digest===operation.digest,'LIGHTDASH_HOST_BINDING','Native response is bound to another operation.');
 return reply;
}
export async function executeOperation({workspaceDir,operationDir,operation}){
 const r=await staged({workspaceDir,operationDir,operation},true);
 const old=await readJson(path.join(r.native,'result.json'),{optional:true});if(old)check(old.operationId===operation.operationId&&old.digest===operation.digest,'LIGHTDASH_RESULT_BINDING','Retained native result belongs to another operation.');if(['SUCCEEDED','FAILED'].includes(old?.state))return {...old,replayed:true};
 await runtimeStillMatches(operation);
 await verifyManifest(operation.edition);
 if(operation.connection.profiles)await verifyManifest(operation.connection.profiles);
 if(operation.input.content)await verifyManifest(operation.input.content);
 return host('execute',r,operation);
}
export async function inspectOperation({workspaceDir,operationDir,operation,refresh=false}){
 const r=await staged({workspaceDir,operationDir,operation},false);
 if(r.absent)return {schema:'lightdash-commissioning.result.v1',operationId:operation.operationId,digest:operation.digest,state:'PLANNED',dispatched:false,artifacts:[],nativeReferences:[]};
 return host(refresh?'inspect':'status',r,operation);
}
