#!/usr/bin/env node
// MIT. One CLI over the retained Treasury workspace and its original publisher.
import { readFile, copyFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openFiscalWorkspace } from './workspace-model.mjs';

export const HELP = `Fiscal Data workspace — Node 22+ / Linux

node fiscaldata/cli.mjs workspace --dir /private/fiscal-data [--port 0] [--buyers /private/buyer-bindings.json]
node fiscaldata/cli.mjs state --dir /private/fiscal-data
node fiscaldata/cli.mjs action --dir /private/fiscal-data --action sources.save --input source.json
node fiscaldata/cli.mjs action --dir /private/fiscal-data --action captures.start --input capture.json --wait
node fiscaldata/cli.mjs worker --dir /private/fiscal-data [--once]
node fiscaldata/cli.mjs file --dir /private/fiscal-data --kind export --id UUID --name delivery.tar.gz --out /private/delivery.tar.gz

The same private directory is reopened for every continuation. Close its browser
server before using a separate CLI writer. --input is exact JSON; creation
requestId values are retained and reused only for identical retry inputs.
--buyers is a JSON array of {id,label,directory} for existing SF88 workspaces.
--limits is a JSON object of documented source/storage ceilings; both startup
options are also accepted by state, action and worker. No payment credentials
belong in the action JSON. Use the original configured buyer workspace.
`;
async function jsonFile(path,maximum=16*1024**2){
  const data=await readFile(resolve(path));if(data.length>maximum)throw new Error('Input JSON exceeds its byte limit.');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
}
const emit=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
export async function main(argv=process.argv.slice(2)){
  if(!argv.length||argv.includes('--help')){process.stdout.write(HELP);return;}
  const command=argv.shift(),values={},flags=new Set(['--wait','--once']);
  const allowed=new Set(['--dir','--port','--buyers','--limits','--action','--input','--kind','--id','--name','--out',...flags]);
  for(let i=0;i<argv.length;i++){
    const name=argv[i];if(!allowed.has(name)||Object.hasOwn(values,name))throw new Error('Unknown or repeated option: '+name);
    if(flags.has(name)){values[name]=true;continue;}
    if(!argv[i+1]||argv[i+1].startsWith('--'))throw new Error('Missing value for '+name);values[name]=argv[++i];
  }
  if(!values['--dir'])throw new Error('--dir is required.');
  const options={directory:resolve(values['--dir']),
    buyerWorkspaces:values['--buyers']?await jsonFile(values['--buyers'],65536):[],
    limits:values['--limits']?await jsonFile(values['--limits'],65536):{}};
  if(command==='workspace'){
    const port=values['--port']===undefined?0:Number(values['--port']);
    if(!Number.isSafeInteger(port)||port<0||port>65535)throw new Error('Port must be an integer from 0 to 65535.');
    const {startFiscalWorkspace}=await import('./workspace-server.mjs');
    const service=await startFiscalWorkspace({...options,port});
    emit({url:service.url,directory:options.directory});
    await new Promise((done,reject)=>{
      let stopping=false;const stop=()=>{if(stopping)return;stopping=true;service.close().then(done,reject);};
      process.once('SIGINT',stop);process.once('SIGTERM',stop);
      service.server.once('close',done);service.server.once('error',reject);
    });return;
  }
  if(!['state','action','worker','file'].includes(command))throw new Error('Choose workspace, state, action, worker or file.');
  const workspace=await openFiscalWorkspace(options);let stop=false;
  const requestStop=()=>{stop=true;void workspace.close();};
  process.once('SIGINT',requestStop);process.once('SIGTERM',requestStop);
  try{
    if(command==='state'){emit(await workspace.snapshot());return;}
    if(command==='file'){
      if(!values['--kind']||!values['--id']||!values['--name']||!values['--out'])throw new Error('File export requires --kind, --id, --name and --out.');
      const file=await workspace.file(values['--kind'],values['--id'],values['--name']),out=resolve(values['--out']);
      await copyFile(file.path,out,1);await chmod(out,0o600);emit({path:out,name:file.name,size:file.size,sha256:file.sha256});return;
    }
    let selected=null;
    if(command==='action'){
      if(!values['--action'])throw new Error('--action is required.');
      const input=values['--input']?await jsonFile(values['--input']):{};
      const response=await workspace.dispatch(values['--action'],input);emit(response);
      if(!values['--wait'])return;
      if(!['captures.start','captures.resume'].includes(values['--action']))throw new Error('--wait follows captures.start or captures.resume.');
      selected=response.result.id;
    }
    await workspace.startWorker();
    let prior=null;
    while(!stop){
      const state=await workspace.snapshot(),jobs=selected?state.captures.filter(item=>item.id===selected):state.captures;
      const report=JSON.stringify({worker:state.worker,captures:jobs.map(({id,status,rows,pages,nextPage,error})=>({id,status,rows,pages,nextPage,error}))});
      if(report!==prior){process.stdout.write(report+'\n');prior=report;}
      const pending=jobs.some(item=>['RUNNING','QUEUED'].includes(item.status));
      if((selected||values['--once'])&&!pending&&!state.worker.captureId){
        if(jobs.some(item=>item.status==='FAILED'))process.exitCode=1;break;
      }
      await new Promise(done=>setTimeout(done,300));
    }
  }finally{
    process.removeListener('SIGINT',requestStop);process.removeListener('SIGTERM',requestStop);await workspace.close();
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write(JSON.stringify({code:error.code??'FISCALDATA_CLI',message:error.message,status:error.status??null})+'\n');process.exitCode=1;});
