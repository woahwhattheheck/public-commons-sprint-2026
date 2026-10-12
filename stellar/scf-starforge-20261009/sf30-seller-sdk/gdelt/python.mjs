// MIT. Run the feature's standard-library decoder/receiver and retain child lifetime.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { need, jsonBytes } from './model.mjs';

export async function runGdeltPython(file,value,{python,signal,maxOutputBytes=1048576,timeout=120000}={}) {
  need(['zip_decode.py','source_receive.py'].includes(file),'Select a maintained GDELT Python entrypoint.');
  need(Number.isSafeInteger(maxOutputBytes)&&maxOutputBytes>=1&&maxOutputBytes<=192*1024*1024,'Invalid helper response allowance.');
  const executable=python??process.env.SF30_GDELT_PYTHON??process.env.CODEX_PRIMARY_RUNTIME_PYTHON??(process.platform==='win32'?'python':'python3');
  need(typeof executable==='string'&&executable.length>0,'Select the existing Python3.11+ executable.');
  signal?.throwIfAborted();
  const child=spawn(executable,['-B',fileURLToPath(new URL('./'+file,import.meta.url))],{shell:false,stdio:['pipe','pipe','pipe']});
  const chunks=[],errors=[];let size=0,errorSize=0,exceeded=false,spawnError=null,timedOut=false;
  const stop=()=>child.kill('SIGTERM');
  const settled=new Promise(resolve=>{
    child.once('error',error=>{spawnError=error;});
    child.once('close',(code,endedSignal)=>resolve({code,endedSignal}));
  });
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>maxOutputBytes){exceeded=true;stop();}else chunks.push(chunk);});
  child.stderr.on('data',chunk=>{errorSize+=chunk.length;if(errorSize<=16384)errors.push(chunk);});
  child.stdin.on('error',()=>{});
  signal?.addEventListener('abort',stop,{once:true});
  if(signal?.aborted)stop();
  child.stdin.end(jsonBytes(value));
  const timer=setTimeout(()=>{timedOut=true;stop();},timeout);timer.unref();
  let result;
  try{result=await settled;}finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);}
  signal?.throwIfAborted();
  need(!spawnError,'Python3.11+ is required; configure SF30_GDELT_PYTHON.','GDELT_PYTHON_REQUIRED',503);
  need(!timedOut,'The original helper exceeded its execution time; reopen the same retained operation.','GDELT_HELPER_INTERRUPTED',504);
  need(!exceeded&&result.code===0,'GDELT helper could not finish: '+Buffer.concat(errors).toString('utf8').slice(0,2048),'GDELT_HELPER_FAILED');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));
}
