// MIT. Run the existing WFS source-file receiver and retain its child lifetime.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { need, jsonBytes } from './model.mjs';

export async function runWfsPython(file,value,{python,signal,maxOutputBytes=2097152,timeout=300000}={}) {
  need(file==='source_receive.py','Select the maintained WFS source receiver.');
  need(Number.isSafeInteger(maxOutputBytes)&&maxOutputBytes>=1&&maxOutputBytes<=4*1024*1024,
    'Invalid original helper response allowance.');
  need(Number.isSafeInteger(timeout)&&timeout>=1000&&timeout<=600000,'Invalid original helper timeout.');
  const executable=python??process.env.SF30_WFS_PYTHON??process.env.CODEX_PRIMARY_RUNTIME_PYTHON??
    (process.platform==='win32'?'python':'python3');
  need(typeof executable==='string'&&executable.length>0,'Select the existing Python3.11+ executable.');
  const payload=jsonBytes(value);
  need(payload.length<=4*1024*1024,'The original receiving descriptor exceeds4 MiB.');
  signal?.throwIfAborted();
  const child=spawn(executable,['-B',fileURLToPath(new URL('./'+file,import.meta.url))],
    {shell:false,stdio:['pipe','pipe','pipe']});
  const chunks=[],errors=[];let size=0,errorSize=0,exceeded=false,spawnError=null,timedOut=false,
    inputError=null,killTimer=null;
  const stop=()=>{
    if(child.exitCode!==null||child.signalCode!==null)return;
    child.kill('SIGTERM');
    if(killTimer===null){killTimer=setTimeout(()=>child.kill('SIGKILL'),2000);killTimer.unref();}
  };
  const settled=new Promise(resolve=>{
    child.once('error',error=>{spawnError=error;});
    child.once('close',(code,endedSignal)=>resolve({code,endedSignal}));
  });
  child.stdout.on('data',chunk=>{
    size+=chunk.length;
    if(size>maxOutputBytes){exceeded=true;stop();}else chunks.push(chunk);
  });
  child.stderr.on('data',chunk=>{
    if(errorSize<16384)errors.push(chunk.subarray(0,16384-errorSize));
    errorSize+=chunk.length;
  });
  child.stdin.on('error',error=>{inputError=error;});
  signal?.addEventListener('abort',stop,{once:true});
  if(signal?.aborted)stop();
  const timer=setTimeout(()=>{timedOut=true;stop();},timeout);timer.unref();
  let result;
  try{
    try{child.stdin.end(payload);}catch(error){inputError=error;stop();}
    result=await settled;
  }finally{
    clearTimeout(timer);if(killTimer!==null)clearTimeout(killTimer);
    signal?.removeEventListener('abort',stop);
  }
  signal?.throwIfAborted();
  need(!spawnError,'Python3.11+ is required; configure SF30_WFS_PYTHON.','WFS_PYTHON_REQUIRED',503);
  need(!timedOut,'The original receiving helper was interrupted; reopen the same delivery.',
    'WFS_HELPER_INTERRUPTED',504);
  need(!exceeded&&result.code===0&&!inputError,
    'WFS source receiving could not finish: '+Buffer.concat(errors).toString('utf8').slice(0,2048),
    'WFS_HELPER_FAILED');
  const decoded=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size));
  return JSON.parse(decoded);
}
