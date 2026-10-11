// MIT. Commands for the original accounting workspace adjustment lifecycle.
import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {openAccountingWorkspace,WorkspaceError} from './store.mjs';
import {handleAdjustmentRequest} from './adjustments-workspace.mjs';

export const ADJUSTMENTS_HELP=`Merchant accounting adjustments

Use the existing merchant-accounting-workspace command, or node workspace/server.mjs:

  adjustments status --url http://127.0.0.1:8446
  adjustments events --url http://127.0.0.1:8446 --run RUN_ID
  adjustments event --url http://127.0.0.1:8446 --run RUN_ID --event EVENT_ID
  adjustments detail --url http://127.0.0.1:8446 --id ADJUSTMENT_ID

  adjustments preview --url http://127.0.0.1:8446 \\
    --input /private/refund-request.json --out /private/refund-preview.json
  adjustments record --url http://127.0.0.1:8446 \\
    --preview /private/refund-preview.json
  adjustments verify --url http://127.0.0.1:8446 --id ADJUSTMENT_ID \\
    --transaction RETURN_TRANSACTION --actor OPERATOR --expect REVISION
  adjustments job --url http://127.0.0.1:8446 --id JOB_ID
  adjustments withdraw --url http://127.0.0.1:8446 --id ADJUSTMENT_ID \\
    --reason REASON --actor OPERATOR --expect REVISION
  adjustments export --url http://127.0.0.1:8446 --run RUN_ID \\
    --format json --out /private/merchant-adjustments.json

Use --workspace /private/accounting-workspace instead of --url to reopen a stopped
workspace through its original owner. The running browser workspace uses --url.
Preview input: runId, eventId, kind (REFUND or CANCELLATION), amountAtomic (string),
effectiveAt (UTC ISO timestamp), reason, reference, actor.
Review the saved preview before recording it. A changed revision needs a new preview.
Verify waits for its retained background job; job reopens the exact saved attempt.
Optional events: --search TEXT --offset 0 --limit 50 (maximum 200).
Optional verify: --rpc-endpoint ORIGINAL_HTTPS_ENDPOINT.
For direct --workspace verification, --rpc-proxy-env names the configured host variable.
For --url verification, set --rpc-proxy-env when starting the original server.
Export formats: json, csv, html. Output files are created privately and must be new.
Status contains the recent 100 adjustments and jobs; event, detail and export retain
the selected original payment's full history.
`;

const need=(ok,code,message,status=400)=>{if(!ok)throw new WorkspaceError(code,message,status);};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const emit=value=>process.stdout.write(json(value));
const baseKeys=['--workspace','--url'];
const commandKeys={
  status:[],events:['--run','--search','--offset','--limit'],event:['--run','--event'],
  detail:['--id'],job:['--id'],preview:['--input','--out'],record:['--preview'],
  verify:['--id','--transaction','--actor','--expect','--rpc-endpoint','--rpc-proxy-env'],
  withdraw:['--id','--reason','--actor','--expect'],
  export:['--run','--format','--out']
};
function argumentsFor(argv){
  const [command,...args]=argv;
  need(Object.hasOwn(commandKeys,command),'INVALID_ARGUMENTS',ADJUSTMENTS_HELP);
  const accepted=new Set([...baseKeys,...commandKeys[command]]),options={};
  for(let i=0;i<args.length;i++){
    const key=args[i];
    need(accepted.has(key)&&!Object.hasOwn(options,key)&&args[i+1]&&!args[i+1].startsWith('--'),
      'INVALID_ARGUMENTS',ADJUSTMENTS_HELP);
    options[key]=args[++i];
  }
  need(Boolean(options['--workspace'])!==Boolean(options['--url']),
    'WORKSPACE_TARGET_REQUIRED','Choose --workspace for a stopped workspace or --url for its running local server.');
  return {command,options};
}
function required(options,key){
  need(typeof options[key]==='string'&&options[key].trim(),'ARGUMENT_REQUIRED','Provide '+key+'.');
  return options[key];
}
function revision(options){
  const value=required(options,'--expect');
  need(/^(?:0|[1-9][0-9]*)$/.test(value)&&Number.isSafeInteger(Number(value)),
    'INVALID_REVISION','Use the saved workspace revision from status.');
  return Number(value);
}
function endpoint(value){
  let url;try{url=new URL(value);}catch{}
  need(url&&url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)&&
    !url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash,
    'LOOPBACK_REQUIRED','Use the exact printed local accounting workspace URL.');
  return url;
}
async function readJsonFile(filename){
  const path=resolve(filename),handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await handle.stat();
    need(before.isFile()&&before.size>0&&before.size<=32_000_000,
      'INVALID_ADJUSTMENT_FILE','Use a regular request or preview JSON file of at most 32 MB.');
    const bytes=await handle.readFile(),after=await handle.stat();
    need(bytes.length===before.size&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,
      'ADJUSTMENT_FILE_CHANGED','The adjustment input changed while it was being read.',409);
    let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{}
    need(object(value),'INVALID_ADJUSTMENT_JSON','The adjustment input must contain one JSON object.');return value;
  }finally{await handle.close();}
}
async function retainFile(filename,bytes){
  const path=resolve(filename),handle=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  return {path,bytes:bytes.length,sha256:digest(bytes)};
}
function compact(result){
  return {adjustment:result.adjustment,duplicate:Boolean(result.duplicate),revision:result.state.revision};
}

export async function adjustmentsMain(argv,{signal}={}){
  if(!argv.length||argv.length===1&&['--help','help'].includes(argv[0])||argv.length===2&&argv[1]==='--help'){
    process.stdout.write(ADJUSTMENTS_HELP);return;
  }
  const {command,options}=argumentsFor(argv),controller=signal?null:new AbortController();
  signal??=controller.signal;
  const stop=()=>controller?.abort();
  if(controller){process.once('SIGINT',stop);process.once('SIGTERM',stop);}
  let workspace,onAbort;
  try{
    signal.throwIfAborted();
    const url=options['--url']?endpoint(options['--url']):null;
    if(url)need(!options['--rpc-proxy-env'],'SERVER_PROXY_CONFIGURATION',
      'Configure --rpc-proxy-env when starting the original workspace server.');
    else{
      const directory=resolve(options['--workspace']),info=await lstat(directory);
      need(info.isDirectory()&&!info.isSymbolicLink(),'EXISTING_WORKSPACE_REQUIRED','Reopen the existing original workspace directory.');
      const retainedState=await lstat(resolve(directory,'workspace.json'));
      need(retainedState.isFile()&&!retainedState.isSymbolicLink(),'EXISTING_WORKSPACE_REQUIRED','Select the retained original accounting workspace.');
      workspace=await openAccountingWorkspace({directory});
      workspace.adjustments.configureTransport({httpsProxyEnv:options['--rpc-proxy-env']});
      onAbort=()=>workspace.adjustments.close();
      signal.addEventListener('abort',onAbort,{once:true});
      signal.throwIfAborted();
    }
    const request=async(path,value,{file=false}={})=>{
      signal.throwIfAborted();
      if(workspace){
        const parsed=new URL(path,'http://workspace');
        const result=await handleAdjustmentRequest(workspace.adjustments,{
          method:value===undefined?'GET':'POST',path:parsed.pathname,
          query:Object.fromEntries(parsed.searchParams),value
        });
        need(result,'NOT_FOUND','This adjustment operation was not found.',404);
        return file?result.file:result.value;
      }
      let response;
      try{response=await fetch(new URL(path,url),{
        method:value===undefined?'GET':'POST',signal,redirect:'error',cache:'no-store',
        ...(value===undefined?{}:{headers:{'Content-Type':'application/json','X-Workspace-Request':'1'},body:JSON.stringify(value)})
      });}catch(error){
        if(signal.aborted)throw error;
        throw new WorkspaceError('WORKSPACE_UNREACHABLE','The original workspace at '+url.origin+
          ' could not be reached ('+(error.cause?.code??error.code??error.name)+'). Use its current printed local address.');
      }
      if(!response.ok){
        let error;try{error=await response.json();}catch{}
        throw new WorkspaceError(error?.error??'WORKSPACE_OPERATION_FAILED',
          error?.message??'The local workspace returned HTTP '+response.status+'.',response.status);
      }
      return file?{bytes:Buffer.from(await response.arrayBuffer()),type:response.headers.get('content-type')}:response.json();
    };
    const eventPath=(name,values)=>'/api/adjustments/'+name+'?'+new URLSearchParams(values);
    const id=()=>encodeURIComponent(required(options,'--id'));
    const mutation=()=>({revision:revision(options),actor:required(options,'--actor')});
    let result;
    if(command==='status')result=await request('/api/adjustments');
    else if(command==='events'){
      const query={runId:required(options,'--run')};
      for(const [flag,name] of [['--search','search'],['--offset','offset'],['--limit','limit']])
        if(options[flag]!==undefined)query[name]=options[flag];
      result=await request(eventPath('events',query));
    }else if(command==='event')result=await request(eventPath('event',{
      runId:required(options,'--run'),eventId:required(options,'--event')
    }));
    else if(command==='detail')result=await request('/api/adjustments/'+id());
    else if(command==='job')result=await request('/api/adjustments/jobs/'+id());
    else if(command==='preview'){
      const output=required(options,'--out'),input=await readJsonFile(required(options,'--input'));
      const preview=await request('/api/adjustments/preview',input);
      result={file:await retainFile(output,json(preview)),request:preview.request,
        previewSha256:preview.previewSha256,workspaceRevision:preview.workspaceRevision};
    }else if(command==='record'){
      const preview=await readJsonFile(required(options,'--preview'));
      need(object(preview.request)&&/^[a-f0-9]{64}$/.test(preview.previewSha256??'')&&
        Number.isSafeInteger(preview.workspaceRevision)&&preview.workspaceRevision>=0,
        'INVALID_PREVIEW_FILE','Use the complete retained output from adjustments preview.');
      result=compact(await request('/api/adjustments/record',{
        ...preview.request,revision:preview.workspaceRevision,previewSha256:preview.previewSha256
      }));
    }else if(command==='verify'){
      const adjustmentId=id(),body={...mutation(),transaction:required(options,'--transaction').trim().toLowerCase()};
      if(options['--rpc-endpoint'])body.rpcEndpoint=options['--rpc-endpoint'];
      const queued=await request('/api/adjustments/'+adjustmentId+'/verify',body);
      const jobId=queued.job.id;
      process.stderr.write('Saved return verification job '+jobId+'. Waiting for its result.\n');
      let job;
      if(workspace)job=await workspace.adjustments.waitForJob(jobId);
      else{
        do{
          job=await request('/api/adjustments/jobs/'+encodeURIComponent(jobId));
          if(['QUEUED','RUNNING'].includes(job.status))await delay(750,undefined,{signal});
        }while(['QUEUED','RUNNING'].includes(job.status));
      }
      const retained=await request('/api/adjustments/'+adjustmentId);
      result={adjustment:retained.adjustment,job,revision:(await request('/api/adjustments')).revision};
      if(job.status!=='COMPLETED'){
        emit(result);
        throw new WorkspaceError(job.error?.code??'REFUND_VERIFICATION_FAILED',
          job.error?.message??'The retained return verification ended with status '+job.status+'.');
      }
    }else if(command==='withdraw'){
      result=compact(await request('/api/adjustments/'+id()+'/withdraw',{
        ...mutation(),reason:required(options,'--reason')
      }));
    }else if(command==='export'){
      const output=required(options,'--out'),format=options['--format']??'json';
      need(['json','csv','html'].includes(format),'INVALID_EXPORT_FORMAT','Choose json, csv or html.');
      const file=await request(eventPath('export',{runId:required(options,'--run'),format}),undefined,{file:true});
      result={file:await retainFile(output,file.bytes),type:file.type};
    }
    emit(result);return result;
  }finally{
    if(onAbort)signal.removeEventListener('abort',onAbort);
    try{await workspace?.close();}
    finally{if(controller){process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}}
  }
}

