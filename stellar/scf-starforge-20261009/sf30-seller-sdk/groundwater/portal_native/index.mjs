#!/usr/bin/env node
/** Maintained Node entry for the same original Python portal lifecycle. */
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const entries={prepare:'prepare_portal.py',receive:'run_portal.py','prepare-input':'prepare_input.py',restore:'restore_prepared.py'};
export async function runGroundwaterPortal(mode,args,{python=process.env.STARFORGE_GROUNDWATER_PORTAL_PYTHON||'python3',signal}={}){
 if(!(mode in entries)||!Array.isArray(args)||args.some(x=>typeof x!=='string'))throw new TypeError('Choose one original portal command and its explicit string arguments.');
 if(signal?.aborted)throw new Error('Portal continuation cancelled before dispatch.');
 const command=['-B',fileURLToPath(new URL(entries[mode],import.meta.url)),...args];
 const child=spawn(python,command,{stdio:'inherit'});
 const stop=()=>{if(child.exitCode===null)child.kill('SIGTERM');};
 signal?.addEventListener('abort',stop);if(signal?.aborted)stop();
 try{
  const status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  if(status.code!==0){const error=new Error('The original portal command is incomplete. Retain its same input, private installation, accounts and returned archive; no model run was created by this caller.');error.status=status;throw error;}
  return {state:'complete',mode,originalPythonCommand:command,nativeModelRunsStarted:0};
 }finally{signal?.removeEventListener('abort',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=process.argv.slice(2),options={},controller=new AbortController();
 if(args[0]==='--python'){args.shift();options.python=args.shift();if(!options.python)throw new Error('Provide the selected Python path.');}
 const mode=args.shift();
 if(!(mode in entries))throw new Error('Usage: groundwater-portal [--python PATH] prepare|receive|prepare-input|restore ORIGINAL_ARGUMENTS');
 const stop=()=>controller.abort();process.on('SIGINT',stop);process.on('SIGTERM',stop);
 try{await runGroundwaterPortal(mode,args,{...options,signal:controller.signal});}
 catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
 finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
