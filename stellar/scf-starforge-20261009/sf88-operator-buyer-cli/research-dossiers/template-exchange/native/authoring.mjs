// MIT. Existing primary-runtime authoring adapter for the same receiving programme.
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const need=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
const read=async path=>{try{return await fs.readFile(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
async function save(path,body){const old=await read(path);if(old){need(old.equals(body),'AUTHORING_REQUEST_CHANGED');return;}await fs.writeFile(path,body,{flag:'wx'});}
export async function runAuthoringCommand(executable,args,{signal,timeoutMs=180000,cwd}={}){
 need(!signal?.aborted,'TEMPLATE_OPERATION_CANCELLED');
 return new Promise((accept,reject)=>{
  const child=spawn(executable,args,{cwd,stdio:['ignore','pipe','pipe'],windowsHide:true});let stdout=[],stderr=[],size=0,diagnostics=0,failure=null,ended=false,kill;
  function fail(code){failure??=Object.assign(Error(code),{code});child.kill('SIGTERM');kill??=setTimeout(()=>{if(!ended)child.kill('SIGKILL');},600);kill.unref?.();}
  const abort=()=>fail('TEMPLATE_OPERATION_CANCELLED');signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>fail('TEMPLATE_AUTHORING_TIMEOUT'),timeoutMs);timer.unref?.();
  child.once('error',e=>{failure=Object.assign(Error('TEMPLATE_AUTHORING_START_FAILED'),{code:'TEMPLATE_AUTHORING_START_FAILED',cause:e});});
  child.stdout.on('data',b=>{size+=b.length;if(size>4*1024*1024)fail('TEMPLATE_AUTHORING_OUTPUT_LIMIT');else stdout.push(b);});
  child.stderr.on('data',b=>{diagnostics+=b.length;if(diagnostics>65536)fail('TEMPLATE_AUTHORING_DIAGNOSTIC_LIMIT');else stderr.push(b);});
  child.once('close',code=>{ended=true;clearTimeout(timer);clearTimeout(kill);signal?.removeEventListener('abort',abort);
   if(failure){reject(failure);return;}const result={exitCode:code,stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8')};
   if(code!==0){reject(Object.assign(Error('TEMPLATE_AUTHORING_FAILED'),{code:'TEMPLATE_AUTHORING_FAILED',result}));return;}accept(result);});
 });
}
export async function createArtifactAuthoring({runDirectory,signal,environment=process.env}){
 const runtime=environment.CODEX_PRIMARY_RUNTIME_NODE,modules=environment.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
 need(runtime&&modules,'TEMPLATE_PRIMARY_ARTIFACT_RUNTIME_REQUIRED');
 const owner=resolve(runDirectory,'artifact-authoring');await fs.mkdir(owner,{recursive:true});
 const source=await fs.readFile(fileURLToPath(new URL('./commissioning-workbook.mjs',import.meta.url)));
 const sourceSha256=sha(source),sourcePath=join(owner,'commissioning-workbook.mjs');
 await save(sourcePath,source);
 // Import resolution is isolated in a writable OS tmp directory; the primary
 // runtime and synchronized repository are never modified.
 const working=await fs.mkdtemp(join(tmpdir(),'research-template-authoring-'));
 await fs.symlink(modules,join(working,'node_modules'),'dir');
 await fs.writeFile(join(working,'commissioning-workbook.mjs'),source,{flag:'wx'});
 async function marker(){
  const path=join(owner,'artifact-marker.json'),retained=await read(path);if(retained){const value=JSON.parse(retained);need(value.sourceSha256===sourceSha256&&value.exitCode===0,'TEMPLATE_AUTHORING_MARKER_CHANGED');return;}
  const intentPath=join(owner,'artifact-marker-intent.json');need(!(await read(intentPath)),'TEMPLATE_AUTHORING_MARKER_RECONCILIATION_REQUIRED');
  await save(intentPath,Buffer.from(JSON.stringify({sourceSha256,startedAt:new Date().toISOString()})+'\n'));
  const script='/root/.codex/skills/builtins/spreadsheets/container_tools/mark_artifact_operation_started.mjs';
  const result=await runAuthoringCommand(runtime,[script,'--operation-kind','create','--expected-output-count','2','--output-format','xlsx'],{signal,cwd:working});
  await save(path,Buffer.from(JSON.stringify({sourceSha256,exitCode:result.exitCode,stdout:result.stdout,recordedAt:new Date().toISOString()})+'\n'));
 }
 async function execute(action,input){
  need(!signal?.aborted,'TEMPLATE_OPERATION_CANCELLED');
  const filename=join(owner,action+'-request.json'),body=Buffer.from(JSON.stringify(input,null,2)+'\n');await save(filename,body);
  if(action==='create')await marker();
  else need(await read(join(owner,'artifact-marker.json')),'TEMPLATE_AUTHORING_MARKER_REQUIRED');
  const result=await runAuthoringCommand(runtime,[join(working,'commissioning-workbook.mjs'),action,filename],{signal,cwd:working,timeoutMs:240000});
  const lines=result.stdout.trim().split('\n');let output;
  try{output=JSON.parse(lines.at(-1));}catch{throw Object.assign(Error('TEMPLATE_AUTHORING_RESPONSE_INVALID'),{code:'TEMPLATE_AUTHORING_RESPONSE_INVALID'});}
  const data=await fs.readFile(output.path);need(data.length===output.bytes&&sha(data)===output.sha256,'TEMPLATE_AUTHORED_FILE_CHANGED');
  await save(join(owner,action+'-process.json'),Buffer.from(JSON.stringify({sourceSha256,inputSha256:sha(body),...result},null,2)+'\n'));return output;
 }
 return {create:input=>execute('create',input),clientReturn:input=>execute('return',input),
  close:()=>fs.rm(working,{recursive:true,force:true}),sourceSha256};
}
