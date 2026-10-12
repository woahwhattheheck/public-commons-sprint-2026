#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
export async function runGroundwaterPublisherJourney(inputFile,{python=process.env.STARFORGE_GROUNDWATER_PYTHON||'python3',phase='all',retryRunIds=[],signal}={}){
 const args=['-B',fileURLToPath(new URL('./run_publisher_workflow.py',import.meta.url)),inputFile,'--phase',phase];
 for(const id of retryRunIds)args.push('--retry-run',id);
 const child=spawn(python,args,{stdio:'inherit'});
 const stop=()=>{if(child.exitCode===null)child.kill('SIGTERM');};
 signal?.addEventListener('abort',stop);if(signal?.aborted)stop();
 try{
  const status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  if(status.code!==0){const error=new Error('Original groundwater native journey is incomplete; retain the same input, workspace, requests and native runs.');error.status=status;throw error;}
  return {state:'complete',inputFile,originalPythonCommand:args};
 }finally{signal?.removeEventListener('abort',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=process.argv.slice(2),inputFile=args.shift();
 if(!inputFile)throw new Error('Usage: groundwater-native ORIGINAL_INPUT.json [--python PATH] [--phase all|prepare|complete] [--retry-run ORIGINAL_ID]');
 const options={retryRunIds:[]},controller=new AbortController();
 for(let i=0;i<args.length;i+=2){
  if(!args[i+1])throw new Error('Missing original option value');
  if(args[i]==='--python')options.python=args[i+1];
  else if(args[i]==='--phase')options.phase=args[i+1];
  else if(args[i]==='--retry-run')options.retryRunIds.push(args[i+1]);
  else throw new Error('Unknown option '+args[i]);
 }
 const stop=()=>controller.abort();process.on('SIGTERM',stop);process.on('SIGINT',stop);
 try{await runGroundwaterPublisherJourney(inputFile,{...options,signal:controller.signal});}
 catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
 finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}
