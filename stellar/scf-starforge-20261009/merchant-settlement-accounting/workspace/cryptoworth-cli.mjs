// MIT. Cryptoworth receiving through the original accounting workspace owner.
import {constants} from 'node:fs';
import {lstat,open,link,unlink} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {openAccountingWorkspace,WorkspaceError} from './store.mjs';
import {AccountantWorkspace} from './accountant-workspace.mjs';
import {CryptoworthWorkspace,handleCryptoworthRequest,CRYPTOWORTH_REQUEST_BYTES,CRYPTOWORTH_PACKET_BYTES} from './cryptoworth-workspace.mjs';
export const CRYPTOWORTH_HELP="Cryptoworth receiving — original merchant accounting workspace\n\nUse merchant-accounting-workspace cryptoworth, or node workspace/server.mjs cryptoworth.\n\n  status --url http://127.0.0.1:8446\n  source --url URL --handoff HANDOFF --accountant-revision initial\n  template --url URL --file /private/provider-template.csv\n  profile-preview --url URL --input /private/profile-request.json --out /private/profile-preview.json\n  profile-save --url URL --preview /private/profile-preview.json\n  profile --url URL --id PROFILE\n  profile-file --url URL --id PROFILE --name template.csv --out /private/next-template.csv\n\n  plan-preview --url URL --input /private/plan-request.json --out /private/plan-preview.json\n  plan-save --url URL --preview /private/plan-preview.json\n  plan --url URL --id PLAN\n  rows --url URL --id PLAN --status READY --offset 0 --limit 50\n\n  capture-preview --url URL --plan PLAN --input /private/native-capture.json --out /private/capture-preview.json\n  capture-save --url URL --plan PLAN --preview /private/capture-preview.json\n  capture --url URL --plan PLAN --id CAPTURE\n  capture-rows --url URL --plan PLAN --id CAPTURE --status CHANGED\n  return-preview --url URL --plan PLAN --input /private/accountant-return.json --out /private/return-preview.json\n  return-save --url URL --plan PLAN --preview /private/return-preview.json\n  return --url URL --plan PLAN --id RETURN\n  rollback --url URL --plan PLAN --input /private/completed-native-rollback.json\n\n  download --url URL --plan PLAN --name import.csv --out /private/import.csv\n  download --url URL --plan PLAN --capture CAPTURE --name comparison.csv --out /private/comparison.csv\n  download --url URL --plan PLAN --return RETURN --scope completed --name accountant.csv --out /private/accountant.csv\n  packet --url URL --plan PLAN --out /private/receiving-packet.json\n  packet-inspect --url URL --file /private/receiving-packet.json\n  packet-receive --url URL --file /private/receiving-packet.json --name \"October receiving\" --actor OPERATOR --expect REVISION\n\nChoose --workspace /private/accounting-workspace instead of --url to reopen a\nstopped workspace through its original owner. Use --url for an already running\nbrowser workspace. A received packet keeps its selected source and whole native\ncoverage history in the same original product.\n\nJSON input uses the documented HTTP fields. A file can be supplied as\n{\"file\":{\"path\":\"/private/actual.csv\"}}; dateEvidence[].file supports the same\nprivate path form. Other file forms remain the actual name/dataBase64 envelope.\nReview each complete saved preview before its matching save command. Preview\nfiles bind the original workspace, route, plan, UUID and source. Reuse that exact\npreview to reconcile an interrupted save; a changed source needs a fresh review.\nAn unapplied staged return becomes SUPERSEDED when the original owner confirms\nthat its accountant parent or active receiving coverage changed. Its files remain.\nRollback input must retain its own id, revision, captureId, nativeImportId,\ncompletedAt, actor, reason and actual native reference before the command runs.\n\nSource/row commands support --search TEXT --offset N --limit 1..200. Source\nrequires an explicit --accountant-revision initial|UUID. Template can use\n--delimiter comma|semicolon|tab. Download scopes are --capture, --return or\n--rollback; return --scope is stage|completed. Output paths must be new or already\ncontain these exact bytes. All new CLI files are private.\n\nThe operator supplies the actual Cryptoworth template and chain-specific Crypto\nIDs. Import/rollback remains the actual provider operation. This command records\nits native files, exact import unit and accountant handover in the original desk.\n";
const need=(ok,code,message,status=400)=>{if(!ok)throw new WorkspaceError(code,message,status);};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value),json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),emit=value=>process.stdout.write(json(value));
const pageFlags=['--search','--offset','--limit'],baseFlags=['--url','--workspace'];
const commands={
  status:[],source:['--handoff','--accountant-revision',...pageFlags],template:['--file','--delimiter','--out'],
  'profile-preview':['--input','--out'],'profile-save':['--preview'],profile:['--id'],'profile-file':['--id','--name','--out'],
  'plan-preview':['--input','--out'],'plan-save':['--preview'],plan:['--id'],rows:['--id','--status',...pageFlags],
  'capture-preview':['--plan','--input','--out'],'capture-save':['--plan','--preview'],capture:['--plan','--id'],
  'capture-rows':['--plan','--id','--status',...pageFlags],'return-preview':['--plan','--input','--out'],'return-save':['--plan','--preview'],return:['--plan','--id'],
  rollback:['--plan','--input'],download:['--plan','--name','--capture','--return','--rollback','--scope','--out'],packet:['--plan','--out'],
  'packet-inspect':['--file','--out'],'packet-receive':['--file','--name','--actor','--expect'],
};
function parse(argv){
  const [command,...args]=argv;need(Object.hasOwn(commands,command),'INVALID_ARGUMENTS',CRYPTOWORTH_HELP);
  const allowed=new Set([...baseFlags,...commands[command]]),options={};
  for(let i=0;i<args.length;i++){
    const key=args[i];need(allowed.has(key)&&!Object.hasOwn(options,key)&&typeof args[i+1]==='string'&&!args[i+1].startsWith('--'),'INVALID_ARGUMENTS',CRYPTOWORTH_HELP);
    options[key]=args[++i];
  }
  need(Boolean(options['--url'])!==Boolean(options['--workspace']),'WORKSPACE_TARGET_REQUIRED','Choose the running local --url or the stopped original --workspace.');
  return {command,options};
}
const required=(options,key)=>{need(typeof options[key]==='string'&&options[key].trim(),'ARGUMENT_REQUIRED','Provide '+key+'.');return options[key];};
function expected(options){
  const value=required(options,'--expect');need(/^(0|[1-9][0-9]*)$/.test(value)&&Number.isSafeInteger(Number(value)),'INVALID_REVISION','Use the current original workspace revision.');return Number(value);
}
function loopback(value){
  let url;try{url=new URL(value);}catch{}
  need(url&&url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash,
    'LOOPBACK_REQUIRED','Use the exact original local workspace URL printed by its owner.');return url;
}
async function readPrivateFile(filename,max){
  const path=resolve(filename),handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const before=await handle.stat();need(before.isFile()&&before.size>0&&before.size<=max,'INVALID_CRYPTOWORTH_INPUT','Select the actual regular source file within its supported size.');
    const bytes=await handle.readFile(),after=await handle.stat();
    need(bytes.length===before.size&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'CRYPTOWORTH_INPUT_CHANGED','The original input changed while it was read.',409);
    return {name:basename(path),bytes};
  }finally{await handle.close();}
}
async function readJson(filename){
  const file=await readPrivateFile(filename,CRYPTOWORTH_REQUEST_BYTES);let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(file.bytes));}catch{}
  need(object(value),'INVALID_CRYPTOWORTH_JSON','Use one complete UTF-8 request or saved preview JSON object.');return value;
}
async function inputFile(value,max=64*1024*1024){
  if(object(value)&&typeof value.path==='string'){
    need(!Object.hasOwn(value,'dataBase64'),'AMBIGUOUS_CRYPTOWORTH_INPUT','Choose either the actual file path or its complete byte envelope.');
    const file=await readPrivateFile(value.path,max);return {name:value.name??file.name,dataBase64:file.bytes.toString('base64')};
  }
  return value;
}
async function hydrate(value){
  if(value.file)value.file=await inputFile(value.file);
  if(Array.isArray(value.dateEvidence))for(const entry of value.dateEvidence)if(entry.file)entry.file=await inputFile(entry.file);
  return value;
}
async function retain(filename,bytes){
  const path=resolve(filename),description={path,bytes:bytes.length,sha256:hash(bytes)};
  try{
    const current=await readPrivateFile(path,CRYPTOWORTH_REQUEST_BYTES);
    need(current.bytes.equals(bytes),'CRYPTOWORTH_OUTPUT_EXISTS','This output path already contains different bytes. Choose a new file.',409);return description;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const pending=join(dirname(path),'.cryptoworth-'+randomUUID()+'.pending'),handle=await open(pending,'wx',0o600);
  try{
    await handle.writeFile(bytes);await handle.sync();await handle.close();
    try{await link(pending,path);}catch(error){
      if(error.code!=='EEXIST')throw error;const current=await readPrivateFile(path,CRYPTOWORTH_REQUEST_BYTES);
      need(current.bytes.equals(bytes),'CRYPTOWORTH_OUTPUT_EXISTS','The output path received different bytes. Choose a new file.',409);
    }
    await unlink(pending);const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
  }finally{await handle.close().catch(()=>{});await unlink(pending).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return description;
}
async function responseBytes(response,max){
  const declared=response.headers.get('content-length');if(declared)need(/^[0-9]+$/.test(declared)&&Number(declared)<=max,'CRYPTOWORTH_RESPONSE_SIZE','The original workspace response exceeds its supported size.');
  const chunks=[];let total=0;for await(const chunk of response.body){total+=chunk.length;need(total<=max,'CRYPTOWORTH_RESPONSE_SIZE','The original workspace response exceeds its supported size.');chunks.push(chunk);}
  return Buffer.concat(chunks,total);
}
export async function cryptoworthMain(argv,{signal}={}){
  if(!argv.length||argv.includes('--help')||argv.length===1&&argv[0]==='help'){process.stdout.write(CRYPTOWORTH_HELP);return;}
  const {command,options}=parse(argv),abort=signal?null:new AbortController();signal??=abort.signal;
  const stop=()=>abort?.abort();if(abort){process.once('SIGINT',stop);process.once('SIGTERM',stop);}
  let workspace,controller;
  try{
    signal.throwIfAborted();const url=options['--url']?loopback(options['--url']):null;
    if(!url){
      const directory=resolve(required(options,'--workspace')),info=await lstat(directory),state=await lstat(join(directory,'workspace.json'));
      need(info.isDirectory()&&!info.isSymbolicLink()&&state.isFile()&&!state.isSymbolicLink(),'EXISTING_WORKSPACE_REQUIRED','Reopen the actual stopped accounting workspace directory.');
      workspace=await openAccountingWorkspace({directory});controller=new CryptoworthWorkspace(workspace,new AccountantWorkspace(workspace));
    }
    let workspaceId;
    const request=async(path,value,{file=false}={})=>{
      signal.throwIfAborted();
      if(value!==undefined&&workspaceId&&!Object.hasOwn(value,'workspaceId'))value={...value,workspaceId};
      if(workspace){
        const parsed=new URL(path,'http://workspace'),result=await handleCryptoworthRequest(controller,{method:value===undefined?'GET':'POST',path:parsed.pathname,query:Object.fromEntries(parsed.searchParams),value});
        need(result,'NOT_FOUND','This original Cryptoworth operation was not found.',404);return file?result.file:result.value;
      }
      let response;try{response=await fetch(new URL(path,url),{method:value===undefined?'GET':'POST',signal,redirect:'error',cache:'no-store',
        ...(value===undefined?{}:{headers:{'Content-Type':'application/json','X-Workspace-Request':'1'},body:JSON.stringify(value)})});}
      catch(error){if(signal.aborted)throw error;throw new WorkspaceError('WORKSPACE_UNREACHABLE','The original local workspace could not be reached ('+(error.cause?.code??error.code??error.name)+'). Reopen its printed address or reconcile the same saved preview.');}
      const bytes=await responseBytes(response,CRYPTOWORTH_REQUEST_BYTES);
      if(!response.ok){let error;try{error=JSON.parse(bytes);}catch{}throw new WorkspaceError(error?.error??'WORKSPACE_OPERATION_FAILED',error?.message??'The original workspace returned HTTP '+response.status+'.',response.status);}
      return file?{bytes,type:response.headers.get('content-type')}:JSON.parse(bytes);
    };
    const root='/api/cryptoworth',status=await request(root);workspaceId=status.workspaceId;
    const encoded=flag=>encodeURIComponent(required(options,flag)),planPath=()=>root+'/plans/'+encoded('--plan');
    const query=values=>new URLSearchParams(Object.entries(values).filter(([,value])=>value!==undefined)).toString();
    const pageQuery=()=>Object.fromEntries([['search','--search'],['offset','--offset'],['limit','--limit'],['status','--status']].map(([name,flag])=>[name,options[flag]]));
    let result;
    if(command==='status')result=status;
    else if(command==='source')result=await request(root+'/source?'+query({handoffId:required(options,'--handoff'),accountantRevisionId:required(options,'--accountant-revision'),...pageQuery()}));
    else if(command==='template'){
      const original=await readPrivateFile(required(options,'--file'),64*1024*1024),delimiter={comma:',',semicolon:';',tab:'\t'}[options['--delimiter']];
      need(!options['--delimiter']||delimiter,'INVALID_DELIMITER','Choose comma, semicolon or tab.');
      result=await request(root+'/templates/inspect',{file:{name:original.name,dataBase64:original.bytes.toString('base64')},...(delimiter?{delimiter}:{})});
    }else if(command.endsWith('-preview')){
      const kind=command.slice(0,-8),endpoint=kind==='profile'?root+'/profiles':kind==='plan'?root+'/plans':planPath()+'/'+(kind==='capture'?'captures':'returns');
      const input=await hydrate(await readJson(required(options,'--input'))),preview=await request(endpoint+'/preview',input);
      const carrier={...preview,workspaceId,savePath:endpoint};
      result={file:await retain(required(options,'--out'),json(carrier)),requestId:preview.request.id,previewSha256:preview.previewSha256,workspaceRevision:preview.workspaceRevision,
        summary:preview.summary??preview.plan?.summary??preview.comparison?.summary??null};emit(result);return result;
    }else if(command.endsWith('-save')){
      const kind=command.slice(0,-5),endpoint=kind==='profile'?root+'/profiles':kind==='plan'?root+'/plans':planPath()+'/'+(kind==='capture'?'captures':'returns');
      const preview=await readJson(required(options,'--preview'));
      need(preview.workspaceId===workspaceId&&preview.savePath===endpoint&&object(preview.request)&&/^[a-f0-9]{64}$/.test(preview.previewSha256??'')&&Number.isSafeInteger(preview.workspaceRevision),
        'INVALID_CRYPTOWORTH_PREVIEW','Use the complete original workspace/route-bound preview file for this save.',409);
      result=await request(endpoint,{...preview.request,workspaceId:preview.workspaceId,revision:preview.workspaceRevision,previewSha256:preview.previewSha256});
    }else if(command==='profile')result=await request(root+'/profiles/'+encoded('--id'));
    else if(command==='plan')result=await request(root+'/plans/'+encoded('--id'));
    else if(command==='rows')result=await request(root+'/plans/'+encoded('--id')+'/rows?'+query(pageQuery()));
    else if(command==='capture'||command==='return')result=await request(planPath()+'/'+(command==='capture'?'captures':'returns')+'/'+encoded('--id'));
    else if(command==='capture-rows')result=await request(planPath()+'/captures/'+encoded('--id')+'/rows?'+query(pageQuery()));
    else if(command==='rollback'){
      const input=await readJson(required(options,'--input'));need(typeof input.id==='string','ROLLBACK_REQUEST_ID_REQUIRED','Save the completed native rollback request with its own id before sending it.');
      result=await request(planPath()+'/rollbacks',input);
    }else if(command==='profile-file'||command==='download'||command==='packet'){
      let path;if(command==='profile-file')path=root+'/profiles/'+encoded('--id')+'/download/'+encoded('--name');
      else if(command==='packet')path=planPath()+'/packet';
      else path=planPath()+'/download/'+encoded('--name')+'?'+query({captureId:options['--capture'],returnId:options['--return'],rollbackId:options['--rollback'],scope:options['--scope']});
      const file=await request(path,undefined,{file:true});result={file:await retain(required(options,'--out'),file.bytes),type:file.type};
    }else if(command==='packet-inspect'||command==='packet-receive'){
      const original=await readPrivateFile(required(options,'--file'),CRYPTOWORTH_PACKET_BYTES),value={file:{name:original.name,dataBase64:original.bytes.toString('base64')}};
      if(command==='packet-receive')Object.assign(value,{name:required(options,'--name'),actor:required(options,'--actor'),revision:expected(options)});
      result=await request(root+'/packets/'+(command==='packet-inspect'?'inspect':'receive'),value);
    }
    if(options['--out']&&['template','packet-inspect'].includes(command))result={file:await retain(options['--out'],json(result)),result};
    emit(result);return result;
  }finally{
    try{await controller?.pendingMutation;await workspace?.close();}
    finally{if(abort){process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  cryptoworthMain(process.argv.slice(2)).catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'CRYPTOWORTH_COMMAND_FAILED',message:error.message})+'\n');process.exitCode=1;});
