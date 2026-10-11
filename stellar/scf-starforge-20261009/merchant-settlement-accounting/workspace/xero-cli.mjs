// MIT. Native Xero commands through the original accounting workspace owner.
import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {openAccountingWorkspace,WorkspaceError} from './store.mjs';
import {AccountantWorkspace} from './accountant-workspace.mjs';
import {XeroWorkspace,handleXeroRequest} from './xero-workspace.mjs';

export const XERO_HELP=[
  'Merchant accounting: Xero journals',
  '',
  'Use merchant-accounting-workspace xero, or node workspace/server.mjs xero:',
  '',
  '  status --url http://127.0.0.1:8446',
  '  source --url http://127.0.0.1:8446 --handoff HANDOFF_ID --context CONTEXT_ID',
  '  import-context --url http://127.0.0.1:8446 --input /private/context.json',
  '  capture-context --url http://127.0.0.1:8446 --input /private/context-request.json',
  '  preview --url http://127.0.0.1:8446 --input /private/journal-request.json --out /private/preview.json',
  '  save --url http://127.0.0.1:8446 --preview /private/preview.json',
  '  detail --url http://127.0.0.1:8446 --plan PLAN_ID',
  '  operate --url http://127.0.0.1:8446 --plan PLAN_ID --input /private/operation.json',
  '  operation --url http://127.0.0.1:8446 --plan PLAN_ID --operation OPERATION_ID',
  '  import-response --url http://127.0.0.1:8446 --plan PLAN_ID --input /private/responses.json',
  '  preview-return --url http://127.0.0.1:8446 --plan PLAN_ID --capture CAPTURE_ID --input /private/return-request.json --out /private/return-preview.json',
  '  apply-return --url http://127.0.0.1:8446 --plan PLAN_ID --capture CAPTURE_ID --preview /private/return-preview.json',
  '  download --url http://127.0.0.1:8446 --plan PLAN_ID --file xero-handoff.tar --out /private/xero-handoff.tar',
  '  cancel --url http://127.0.0.1:8446 --plan PLAN_ID --input /private/cancellation.json',
  '',
  'Use --workspace /private/accounting-workspace for a stopped original workspace.',
  'All output may be saved with --out. Files are created privately and must be new.',
  'Native calls use STARFORGE_XERO_ACCESS_TOKEN from the serving process environment.',
  'operate waits for its retained operation. Interrupting an uncertain draft creation',
  'requires refreshing its original request; it never automatically resends it.',
  'Request schemas and the complete valuation workflow: workspace/XERO.md.',
  ''
].join('\n');

const need=(ok,code,message,status=400)=>{if(!ok)throw new WorkspaceError(code,message,status);};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const commandKeys={
  status:[],source:['--handoff','--context'],detail:['--plan'],
  'import-context':['--input'],'capture-context':['--input'],
  preview:['--input'],save:['--preview'],
  operate:['--plan','--input'],operation:['--plan','--operation'],
  'import-response':['--plan','--input'],
  'preview-return':['--plan','--capture','--input'],
  'apply-return':['--plan','--capture','--preview'],
  download:['--plan','--file'],cancel:['--plan','--input']
};
function argumentsFor(argv){
  const [command,...args]=argv;
  need(Object.hasOwn(commandKeys,command),'INVALID_ARGUMENTS',XERO_HELP);
  const accepted=new Set(['--workspace','--url','--out',...commandKeys[command]]),options={};
  for(let i=0;i<args.length;i++){
    const key=args[i];
    need(accepted.has(key)&&!Object.hasOwn(options,key)&&args[i+1]&&!args[i+1].startsWith('--'),'INVALID_ARGUMENTS',XERO_HELP);
    options[key]=args[++i];
  }
  need(Boolean(options['--workspace'])!==Boolean(options['--url']),'WORKSPACE_TARGET_REQUIRED','Choose --workspace for the stopped original workspace or --url for its running local server.');
  return {command,options};
}
function required(options,key){need(typeof options[key]==='string'&&options[key].trim(),'ARGUMENT_REQUIRED','Provide '+key+'.');return options[key];}
function endpoint(value){
  let url;try{url=new URL(value);}catch{}
  need(url&&url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash,'LOOPBACK_REQUIRED','Use the exact printed local accounting workspace URL.');
  return url;
}
async function readJsonFile(filename){
  const path=resolve(filename),handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await handle.stat();
    need(before.isFile()&&before.size>0&&before.size<=96_000_000,'INVALID_XERO_FILE','Use a regular request or preview JSON file of at most 96 MB.');
    const bytes=await handle.readFile(),after=await handle.stat();
    need(bytes.length===before.size&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'XERO_FILE_CHANGED','The input changed while it was being read.',409);
    let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{}
    need(object(value),'INVALID_XERO_JSON','The input must contain one JSON object.');return value;
  }finally{await handle.close();}
}
async function retainFile(filename,bytes){
  const path=resolve(filename),handle=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  return {path,bytes:bytes.length,sha256:digest(bytes)};
}
function prepared(preview){
  need(object(preview.request)&&/^[a-f0-9]{64}$/.test(preview.previewSha256??'')&&Number.isSafeInteger(preview.workspaceRevision)&&preview.workspaceRevision>=0,'INVALID_PREVIEW_FILE','Use the complete saved output of the corresponding preview command.');
  return {...preview.request,revision:preview.workspaceRevision,previewSha256:preview.previewSha256};
}
export async function xeroMain(argv,{signal}={}){
  if(!argv.length||argv.length===1&&['--help','help'].includes(argv[0])||argv.length===2&&argv[1]==='--help'){process.stdout.write(XERO_HELP);return;}
  const {command,options}=argumentsFor(argv),controller=signal?null:new AbortController();signal??=controller.signal;
  const stop=()=>controller?.abort();if(controller){process.once('SIGINT',stop);process.once('SIGTERM',stop);}
  let workspace,xero,onAbort;
  try{
    signal.throwIfAborted();const url=options['--url']?endpoint(options['--url']):null;
    if(!url){
      const directory=resolve(options['--workspace']),info=await lstat(directory);
      need(info.isDirectory()&&!info.isSymbolicLink(),'EXISTING_WORKSPACE_REQUIRED','Reopen the original workspace directory.');
      const retainedState=await lstat(resolve(directory,'workspace.json'));
      need(retainedState.isFile()&&!retainedState.isSymbolicLink(),'EXISTING_WORKSPACE_REQUIRED','Select the retained original accounting workspace.');
      workspace=await openAccountingWorkspace({directory});xero=new XeroWorkspace(workspace,new AccountantWorkspace(workspace));await xero.init();
      onAbort=()=>xero.close();signal.addEventListener('abort',onAbort,{once:true});signal.throwIfAborted();
    }
    const request=async(path,value,{file=false}={})=>{
      signal.throwIfAborted();
      if(xero){
        const parsed=new URL(path,'http://workspace'),result=await handleXeroRequest(xero,{method:value===undefined?'GET':'POST',path:parsed.pathname,query:Object.fromEntries(parsed.searchParams),value});
        need(result,'NOT_FOUND','This Xero operation was not found.',404);return file?result.file:result.value;
      }
      let response;
      try{response=await fetch(new URL(path,url),{method:value===undefined?'GET':'POST',signal,redirect:'error',cache:'no-store',...(value===undefined?{}:{headers:{'Content-Type':'application/json','X-Workspace-Request':'1'},body:JSON.stringify(value)})});}
      catch(error){if(signal.aborted)throw error;throw new WorkspaceError('WORKSPACE_UNREACHABLE','The accounting workspace at '+url.origin+' could not be reached ('+(error.cause?.code??error.code??error.name)+').');}
      if(!response.ok){let error;try{error=await response.json();}catch{}throw new WorkspaceError(error?.error??'WORKSPACE_OPERATION_FAILED',error?.message??'The local workspace returned HTTP '+response.status+'.',response.status);}
      return file?{bytes:Buffer.from(await response.arrayBuffer()),type:response.headers.get('content-type')}:response.json();
    };
    const base=()=>'/api/xero/plans/'+encodeURIComponent(required(options,'--plan'));
    const input=()=>readJsonFile(required(options,'--input'));
    const capture=()=>base()+'/captures/'+encodeURIComponent(required(options,'--capture'));
    let result,file;
    if(command==='status')result=await request('/api/xero');
    else if(command==='source')result=await request('/api/xero/source?'+new URLSearchParams({handoffId:required(options,'--handoff'),contextId:required(options,'--context')}));
    else if(command==='import-context')result=await request('/api/xero/contexts/import',await input());
    else if(command==='capture-context')result=await request('/api/xero/contexts/capture',await input());
    else if(command==='preview'){required(options,'--out');result=await request('/api/xero/preview',await input());}
    else if(command==='save')result=await request('/api/xero/plans',prepared(await readJsonFile(required(options,'--preview'))));
    else if(command==='detail')result=await request(base());
    else if(command==='import-response')result=await request(base()+'/captures',await input());
    else if(command==='preview-return'){required(options,'--out');result=await request(capture()+'/preview',await input());}
    else if(command==='apply-return')result=await request(capture()+'/returns',prepared(await readJsonFile(required(options,'--preview'))));
    else if(command==='cancel')result=await request(base()+'/cancel',await input());
    else if(command==='operation')result=await request(base()+'/operations/'+encodeURIComponent(required(options,'--operation')));
    else if(command==='operate'){
      const queued=await request(base()+'/operations',await input()),id=queued.operation?.id??queued.id;
      need(typeof id==='string','XERO_OPERATION_MISSING','The retained operation did not return an ID.');
      process.stderr.write('Saved Xero operation '+id+'. Waiting for its retained result.\n');
      const operationPath=base()+'/operations/'+encodeURIComponent(id);
      do{result=await request(operationPath);if(['QUEUED','RUNNING'].includes(result.status))await delay(750,undefined,{signal});}while(['QUEUED','RUNNING'].includes(result.status));
      if(!['COMPLETE','COMPLETED'].includes(result.status)){const retained=options['--out']?{file:await retainFile(options['--out'],json(result))}:result;process.stdout.write(json(retained));throw new WorkspaceError(result.error?.code??'XERO_OPERATION_FAILED',result.error?.message??'The retained operation ended with status '+result.status+'.');}
    }else if(command==='download'){required(options,'--out');file=await request(base()+'/download/'+encodeURIComponent(required(options,'--file')),undefined,{file:true});}
    const output=file?{file:await retainFile(options['--out'],file.bytes),type:file.type}:options['--out']?{file:await retainFile(options['--out'],json(result))}:result;
    process.stdout.write(json(output));return output;
  }finally{
    if(onAbort)signal.removeEventListener('abort',onAbort);
    try{await xero?.close();}finally{try{await workspace?.close();}finally{if(controller){process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}}}
  }
}
