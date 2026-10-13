// SPDX-License-Identifier: MIT
// Original Dagster/dbt preparation, offline receiving and runtime inspection.
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open,lstat,mkdir,readFile,rename,link,unlink,realpath} from 'node:fs/promises';
import {dirname,resolve,join,isAbsolute,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const HERE=dirname(fileURLToPath(import.meta.url));
const HELPER=join(HERE,'preparation.py'),MANIFEST=join(HERE,'original-source.json');
const SCHEMA='stellar-forge.pipeline-delivery-preparation.v1',RUNTIME='stellar-forge.pipeline-delivery-runtime.v1';
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const hash=v=>createHash('sha256').update(v).digest('hex');
function need(v,message){if(!v)throw Object.assign(new Error(message),{code:'PIPELINE_PREPARATION'});}
function absolute(v){need(typeof v==='string'&&isAbsolute(v)&&resolve(v)===v&&!/[\x00-\x1f\x7f]/.test(v),'Select an absolute normalized original path.');return v;}
const inside=(root,p)=>{const r=relative(root,p);return !r||r!=='..'&&!r.startsWith('../')&&!isAbsolute(r);};
async function privateDirectory(path,{create=false}={}){
  path=absolute(path);
  if(create)await mkdir(path,{mode:0o700,recursive:true});
  const s=await lstat(path);need(s.isDirectory()&&!s.isSymbolicLink()&&await realpath(path)===path&&!(s.mode&0o077)&&(!process.getuid||s.uid===process.getuid()),'Use an owned private preparation directory.');
  return path;
}
async function bytes(path,limit=128*1024*1024){
  const fd=await open(absolute(path),constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const first=await fd.stat();need(first.isFile()&&first.size<=limit,'Use the complete selected regular file.');
    const data=await fd.readFile(),last=await fd.stat();
    need(data.length===first.size&&['dev','ino','size','mtimeMs','ctimeMs'].every(k=>first[k]===last[k]),'Selected bytes changed during reading.');
    return{path,bytes:data.length,sha256:hash(data),data};
  }finally{await fd.close();}
}
const descriptor=r=>({path:r.path,bytes:r.bytes,sha256:r.sha256});
async function json(path){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode((await bytes(path)).data));}
async function save(path,value,{replace=false}={}){
  const raw=Buffer.from(JSON.stringify(value,null,2)+'\n');await privateDirectory(dirname(path),{create:true});
  const temp=join(dirname(path),'.pipeline-'+randomUUID()),fd=await open(temp,'wx',0o600);
  try{await fd.writeFile(raw);await fd.sync();}finally{await fd.close();}
  try{if(replace)await rename(temp,path);else{try{await link(temp,path);}catch(e){if(e.code!=='EEXIST')throw e;need((await bytes(path)).sha256===hash(raw),'Retained preparation bytes differ.');}}
    const d=await open(dirname(path),'r');try{await d.sync();}finally{await d.close();}
  }finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
function environment(){
  const env={...process.env};
  for(const k of ['PYTHONPATH','PYTHONHOME','PYTHONUSERBASE','PYTHONSTARTUP','VIRTUAL_ENV'])delete env[k];
  env.PYTHONDONTWRITEBYTECODE='1';env.PIP_DISABLE_PIP_VERSION_CHECK='1';env.PIP_NO_INPUT='1';
  return env;
}
async function command({python,args,directory,mode}){
  python=absolute(python);directory=absolute(directory);
  need(!inside(HERE,directory),'Keep preparation and logs outside installed source.');
  await privateDirectory(directory,{create:true});
  const logs=join(directory,'.launcher');await privateDirectory(logs,{create:true});
  const id=randomUUID(),outPath=join(logs,id+'.stdout'),errPath=join(logs,id+'.stderr'),recordPath=join(logs,id+'.json');
  const selected={schema:'stellar-forge.pipeline-delivery-preparation-command.v1',id,mode,argv:[python,'-I','-B',HELPER,...args],cwd:directory,helper:descriptor(await bytes(HELPER)),manifest:descriptor(await bytes(MANIFEST)),state:'prepared',startedAt:new Date().toISOString()};
  await save(recordPath,selected);
  let out,err,child,closedPromise,closed=false,spawnError=null,observationError=null,result;
  try{
    out=await open(outPath,'wx',0o600);err=await open(errPath,'wx',0o600);
    child=spawn(python,['-I','-B',HELPER,...args],{cwd:directory,env:environment(),stdio:['ignore',out.fd,err.fd]});
    closedPromise=new Promise(resolveClose=>{
      child.on('error',e=>{spawnError=e;});
      child.once('close',(code,signal)=>{closed=true;resolveClose({code,signal});});
    });
    try{await save(recordPath,{...selected,state:'running',pid:child.pid??null},{replace:true});result=await closedPromise;}
    catch(e){observationError=e;}
    finally{
      if(observationError&&!closed&&child.pid&&child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
      result=await closedPromise;
      await out.sync();await err.sync();
      const receipt={...selected,state:'closed',pid:child.pid??null,exitCode:result.code,signal:result.signal,
        spawnError:spawnError?{code:spawnError.code??null,message:spawnError.message}:null,
        observationError:observationError?{code:observationError.code??null,message:observationError.message}:null,
        stdout:descriptor(await bytes(outPath)),stderr:descriptor(await bytes(errPath)),completedAt:new Date().toISOString()};
      await save(recordPath,receipt,{replace:true});
    }
    if(observationError)throw observationError;
    if(spawnError)throw spawnError;
    need(result.code===0,'The original preparation did not complete. Reopen the same command record: '+recordPath);
    return json(outPath);
  }finally{
    try{if(closedPromise){if(!closed&&child?.pid&&child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await closedPromise;}}
    finally{try{await out?.close();}finally{await err?.close();}}
  }
}
const fields=['mode','directory','python','source','runtimePython','archive','output','resume'];
async function run(options){
  need(plain(options)&&Object.keys(options).every(k=>fields.includes(k)),'Use the declared complete preparation fields.');
  const mode=options.mode;need(['prepare','receive','inspect','export'].includes(mode),'Select prepare, receive, inspect or export.');
  const directory=absolute(options.directory);
  let python=options.python;
  if(!python&&['inspect','export'].includes(mode)){
    const original=await json(join(directory,'.runtime','REQUEST.json'));python=original.python;
  }
  python=absolute(python);
  need(mode!=='receive'||options.archive,'Receiving requires the complete selected portable archive.');
  need(mode!=='export'||options.output,'Export requires the complete destination path.');
  const argv=[mode,'--directory',directory,'--python',python,'--manifest',MANIFEST];
  if(mode==='prepare')argv.push('--source',absolute(options.source??HERE));
  for(const [key,flag] of [['runtimePython','--runtime-python'],['archive','--archive'],['output','--output']])if(options[key]!==undefined)argv.push(flag,absolute(options[key]));
  if(options.resume)argv.push('--resume');
  const result=await command({python,args:argv,directory,mode});
  need(result.schema===SCHEMA&&result.state===(mode==='export'?'EXPORTED':'READY'),'The original preparation result is incomplete.');
  if(mode==='inspect')need(result.result?.schema===SCHEMA&&result.result.state==='READY','Inspect must return its complete original preparation result.');
  return result;
}
export const preparePipelineDeliveryRuntime=options=>run({...options,mode:'prepare'});
export const receivePipelineDeliveryRuntime=options=>run({...options,mode:'receive'});
export const inspectPipelineDeliveryPreparation=options=>run({...options,mode:'inspect'});
export const exportPipelineDeliveryRuntime=options=>run({...options,mode:'export'});
export async function inspectPipelineDeliveryRuntime({runtimeReadyFile,applicationDirectory,python}){
  runtimeReadyFile=absolute(runtimeReadyFile);const selected=await bytes(runtimeReadyFile),ready=JSON.parse(selected.data.toString('utf8'));
  need(ready.schema===RUNTIME&&ready.state==='READY','Select a complete original runtime READY record.');
  need(!python||ready.python===absolute(python),'The original Python invocation path differs.');
  need(!applicationDirectory||ready.applicationDirectory===absolute(applicationDirectory),'The prepared application differs.');
  const manifest=await bytes(MANIFEST);need(ready.sourceManifestSha256===manifest.sha256,'The selected original source edition differs.');
  const args=['inspect-runtime','--ready',runtimeReadyFile];if(applicationDirectory)args.push('--application',applicationDirectory);
  const result=await command({python:ready.python,args,directory:ready.runtimeDirectory,mode:'inspect-runtime'});
  need(result.schema===RUNTIME&&result.state==='READY'&&result.runtime.runtimeId===ready.runtimeId&&
    (await bytes(runtimeReadyFile)).sha256===selected.sha256,'Runtime inspection returned another selection.');
  return result.runtime;
}
export function parseArguments(argv){
  const args=[...argv],mode=args.shift(),o={mode};
  const map={'--directory':'directory','--python':'python','--source':'source','--runtime-python':'runtimePython','--archive':'archive','--output':'output'};
  while(args.length){const k=args.shift();if(k==='--resume'){need(!o.resume,'Duplicate resume option.');o.resume=true;continue;}
    need(map[k]&&args.length&&!Object.hasOwn(o,map[k]),'Use the declared exact preparation flags.');o[map[k]]=args.shift();}
  return o;
}
export async function main(argv=process.argv.slice(2)){
  if(!argv.length||['help','--help'].includes(argv[0])){
    const result={command:'pipeline-delivery-workbench-prepare',
      prepare:'prepare --directory ABS_PRIVATE --python ABS_BASE_PYTHON [--source ABS_PRODUCT_SOURCE] [--runtime-python ABS_ORIGINAL_VENV_PYTHON] [--resume]',
      receive:'receive --directory ABS_PRIVATE --python ABS_BASE_PYTHON --archive ABS_PORTABLE [--resume]',
      inspect:'inspect --directory ABS_PRIVATE [--python ABS_ORIGINAL_BASE_PYTHON]',
      export:'export --directory ABS_PRIVATE --output ABS_PORTABLE [--python ABS_ORIGINAL_BASE_PYTHON]'};
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }
  const result=await run(parseArguments(argv));process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(e=>{process.stderr.write(JSON.stringify({error:{code:e.code??'PIPELINE_PREPARATION_FAILED',message:e.message}})+'\n');process.exitCode=1;});
