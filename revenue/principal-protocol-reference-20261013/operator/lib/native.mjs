// MIT. One exact, never automatically repeated Stellar CLI attempt.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {need,identity,bytes,hash,clone} from './value.mjs';
import {directory,writeExact,readJSON,fileDescriptor,verifyFile} from './files.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
export async function runNative(root,requestId,plan,mode,config,{signal}={}){
 const attempt=path.join(root,'native',hash(requestId));
 await directory(attempt);
 const script=path.join(HERE,'../native/principal_attempt.py');
 const owner=path.join(HERE,'../native/watershed_process.py');
 const spec={schema:'principal.native-attempt.v1',requestId,planId:plan.id,mode,
  executable:plan.config.stellar.executable,executableSha256:plan.config.stellar.sha256,
  expectedVersion:plan.config.stellar.version,configDirectory:plan.config.stellar.configDirectory,
  sourceAccount:plan.config.sourceAccount,network:plan.config.network,contract:plan.selection.contract,
  argv:mode==='execute'?plan.executeArgv:plan.selection.argv,
  owner:{...(await fileDescriptor(owner)),path:owner},script:{...(await fileDescriptor(script)),path:script}};
 const specPath=path.join(attempt,'input.json');
 await writeExact(specPath,bytes(spec));
 const terminal=path.join(attempt,'result.json');
 let result=await readJSON(terminal,true);
 if(!result){
  const started=await readJSON(path.join(attempt,'reserved.json'),true);
  need(!started,'NATIVE_OUTCOME_UNRESOLVED',{requestId,attempt});
  need(typeof config.stellar?.python==='string'&&path.isAbsolute(config.stellar.python),'PYTHON_EXECUTABLE_REQUIRED');
  const child=spawn(config.stellar.python,[script,specPath],{stdio:['ignore','ignore','pipe'],shell:false,windowsHide:true});
  let diagnostics=[];child.stderr.on('data',b=>diagnostics.push(Buffer.from(b)));
  let spawned=false;child.once('spawn',()=>{spawned=true;});
  const stop=()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');};
  signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
  let code,error;
  try{code=await new Promise(resolve=>{child.once('error',e=>{error=e;});child.once('close',(c,s)=>resolve({code:c,signal:s}));});}
  finally{signal?.removeEventListener('abort',stop);}
  // Python owns and drains the complete actual Stellar tree before its exit.
  const log=Buffer.concat(diagnostics);await writeExact(path.join(attempt,'controller-stderr.bin'),log);
  result=await readJSON(terminal,true);
  need(result,'NATIVE_OUTCOME_UNRESOLVED',{requestId,attempt,spawned,exit:code,error:error?.code??null});
 }
 need(result.schema==='principal.native-result.v1'&&result.requestId===requestId&&result.inputSha256===hash(bytes(spec))&&result.planId===plan.id&&result.mode===mode&&result.lifetimes==='CLOSED','NATIVE_RESULT_IDENTITY');
 need(Array.isArray(result.files)&&new Set(result.files.map(f=>f.path)).size===result.files.length,'NATIVE_FILE_SET');for(const f of result.files)await verifyFile(attempt,f);
 need(result.invocation?.argv&&identity(result.invocation.argv)===identity(spec.argv),'NATIVE_ARGV_CHANGED');
 const selected=[...result.files,{...(await fileDescriptor(terminal)),path:'result.json'}];
 if(!selected.some(f=>f.path==='input.json'))selected.push({...(await fileDescriptor(specPath)),path:'input.json'});
 for(const [name,file,descriptor]of [['owner-source.py',owner,spec.owner],['attempt-source.py',script,spec.script]]){
  const data=await fs.readFile(file);need(data.length===descriptor.bytes&&hash(data)===descriptor.sha256,'NATIVE_SOURCE_CHANGED');await writeExact(path.join(attempt,name),data);selected.push({path:name,bytes:data.length,sha256:hash(data)});
 }
 try{selected.push({...(await fileDescriptor(path.join(attempt,'controller-stderr.bin'))),path:'controller-stderr.bin'});}catch(e){if(e.code!=='ENOENT')throw e;}
 return{result:clone(result),attempt,files:await Promise.all(selected.map(async f=>{const data=await fs.readFile(path.join(attempt,f.path));need(data.length===f.bytes&&hash(data)===f.sha256,'NATIVE_FILE_CHANGED');return{...f,data};}))};
}
