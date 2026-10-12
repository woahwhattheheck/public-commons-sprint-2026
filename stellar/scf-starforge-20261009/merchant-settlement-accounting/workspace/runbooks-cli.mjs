// MIT. Client runbooks through the existing accounting workspace owner.
import {constants} from 'node:fs';
import {lstat,open,link,unlink} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {openAccountingWorkspace,WorkspaceError} from './store.mjs';
import {AccountantWorkspace} from './accountant-workspace.mjs';
import {RunbookWorkspace,handleRunbookRequest,runbookCanonical,RUNBOOK_FILE_BYTES,RUNBOOK_PACKET_BYTES,RUNBOOK_REQUEST_BYTES} from './runbooks-workspace.mjs';

export const RUNBOOK_HELP="Client runbooks — original merchant accounting workspace\n\nUse merchant-accounting-workspace runbooks, or node workspace/server.mjs runbooks.\nChoose --url http://127.0.0.1:8446 for the running browser, or --workspace DIR for\nthe stopped original accounting workspace.\n\n  status | sources\n  book --id RUNBOOK\n  cycle --id PERIOD\n  operation --id REQUEST\n\n  prepare --action save --input /private/procedures.json --out /private/save.json\n  prepare --action attach --input /private/file-note.json --file /private/source.pdf --out /private/upload.json\n  prepare --action create --input /private/period.json --out /private/create.json\n  prepare --action assign --id PERIOD --input /private/responsibility-handover.json --out /private/assign.json\n  prepare --action work --id PERIOD --input /private/work.json --out /private/work-request.json\n  prepare --action submit --id PERIOD --input /private/handover.json --out /private/submit.json\n  prepare --action review --id PERIOD --input /private/review.json --out /private/review-request.json\n  prepare --action receive --input /private/operator.json --file /private/client-close.json --out /private/receive.json\n  execute --prepared /private/save.json\n  reconcile --prepared /private/save.json\n\n  download --id PERIOD --format packet --out /private/client-close.json\n  download --id PERIOD --format print --out /private/client-close.html\n  download --id PERIOD --format tasks --out /private/client-close-tasks.csv\n  file --id FILE --out /private/original-file.pdf\n\nPrepare retains a new exact native request, the current original workspace and\nrevision, route and digest. Its input JSON contains actor and the action's native\nfields; the command supplies workspaceId, requestId and revision. Execute or\nreconcile the SAME saved request after an interrupted response. Reconcile reports\nthe original committed result when present. NOT_FOUND retains the request for\nexact execution; it does not replace its identity. An explicit applied:false\nvalidation response lets you correct the input and prepare a new request.\n\nSelect original client close files or an explicit accountant handoff/revision. Preparation and review\nuse the same saved procedure edition. A received period retains its complete\nsource; its procedures can begin the next local period with an actual local close source.\nUploads are up to8MiB; complete portable JSON packets are up to64MiB. Supporting\nHTTPS links remain links, while selected uploaded files are carried in full.\nEvery output path must be new or already contain the exact same bytes.\n";
const need=(ok,code,message,status=400)=>{if(!ok)throw new WorkspaceError(code,message,status);};
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const requestHash=(kind,target,input)=>hash(Buffer.from(runbookCanonical({kind,target,input})));
const emit=value=>process.stdout.write(json(value));
const flags={status:[],sources:[],book:['--id'],cycle:['--id'],operation:['--id'],prepare:['--action','--id','--input','--file','--out'],execute:['--prepared'],reconcile:['--prepared'],download:['--id','--format','--out'],file:['--id','--out']};
const ACTIONS={save:{kind:'edition_saved',path:'/api/runbooks/books/save'},attach:{kind:'file_retained',path:'/api/runbooks/files'},create:{kind:'cycle_created',path:'/api/runbooks/cycles'},assign:{kind:'assignment_changed',suffix:'assign'},work:{kind:'procedure_saved',suffix:'work'},submit:{kind:'preparation_submitted',suffix:'submit'},review:{kind:'review_saved',suffix:'review'},receive:{kind:'packet_received',path:'/api/runbooks/receive'}};
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
function route(action,id){
  const selected=ACTIONS[action];need(selected,'RUNBOOK_INVALID_ACTION','Choose save, attach, create, assign, work, submit, review or receive.');
  if(selected.suffix){need(UUID.test(id??''),'RUNBOOK_INVALID_ID','Choose the original period ID.');return {kind:selected.kind,target:id,path:'/api/runbooks/cycles/'+id+'/'+selected.suffix};}
  need(id===undefined||id===null,'RUNBOOK_INVALID_TARGET','This action takes its source selections in the complete JSON input.');return {kind:selected.kind,target:null,path:selected.path};
}
function parse(argv){
  const [command,...rest]=argv;need(Object.hasOwn(flags,command),'INVALID_ARGUMENTS',RUNBOOK_HELP);
  const allowed=new Set(['--url','--workspace','--client',...flags[command]]),options={};
  for(let i=0;i<rest.length;i++){const key=rest[i];need(allowed.has(key)&&!Object.hasOwn(options,key)&&rest[i+1]&&!rest[i+1].startsWith('--'),'INVALID_ARGUMENTS',RUNBOOK_HELP);options[key]=rest[++i];}
  need(Boolean(options['--url'])!==Boolean(options['--workspace']),'WORKSPACE_TARGET_REQUIRED','Choose the running local --url or the stopped original --workspace.');return {command,options};
}
const required=(options,name)=>{need(typeof options[name]==='string'&&options[name].trim(),'ARGUMENT_REQUIRED','Provide '+name+'.');return options[name];};
function loopback(value){
  let url;try{url=new URL(value);}catch{}
  need(url&&url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash,'LOOPBACK_REQUIRED','Use the exact original local workspace URL.');return url;
}
async function originalFile(filename,max=RUNBOOK_REQUEST_BYTES){
  const path=resolve(filename),handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const before=await handle.stat();need(before.isFile()&&before.size>0&&before.size<=max,'RUNBOOK_INVALID_FILE','Choose a complete regular input file within its supported size.');
    const bytes=await handle.readFile(),after=await handle.stat();
    need(bytes.length===before.size&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'RUNBOOK_INPUT_CHANGED','The selected file changed while it was read.',409);
    return {name:basename(path),bytes};
  }finally{await handle.close();}
}
async function originalJson(filename){
  const {bytes}=await originalFile(filename);let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{}
  need(plain(value),'RUNBOOK_INVALID_JSON','Choose a complete UTF-8 JSON input or prepared request.');return value;
}
async function retain(filename,bytes){
  const path=resolve(filename),result={path,bytes:bytes.length,sha256:hash(bytes)};
  try{const current=await originalFile(path);need(current.bytes.equals(bytes),'RUNBOOK_OUTPUT_EXISTS','This output already contains different bytes. Choose a new filename.',409);return result;}catch(error){if(error.code!=='ENOENT')throw error;}
  const staging=join(dirname(path),'.runbook-'+randomUUID()+'.pending'),handle=await open(staging,'wx',0o600);
  try{
    await handle.writeFile(bytes);await handle.sync();await handle.close();
    try{await link(staging,path);}catch(error){if(error.code!=='EEXIST')throw error;need((await originalFile(path)).bytes.equals(bytes),'RUNBOOK_OUTPUT_EXISTS','This output received different bytes. Choose a new filename.',409);}
    await unlink(staging);const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
  }finally{await handle.close().catch(()=>{});await unlink(staging).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return result;
}
async function readResponse(response){
  const declared=response.headers.get('content-length');if(declared)need(/^[0-9]+$/.test(declared)&&Number(declared)<=RUNBOOK_REQUEST_BYTES,'RUNBOOK_RESPONSE_SIZE','The workspace response exceeds its supported size.');
  let total=0;const parts=[];for await(const part of response.body){total+=part.length;need(total<=RUNBOOK_REQUEST_BYTES,'RUNBOOK_RESPONSE_SIZE','The workspace response exceeds its supported size.');parts.push(part);}return Buffer.concat(parts,total);
}
export async function runbooksMain(argv,{signal}={}){
  if(!argv.length||argv.includes('--help')){process.stdout.write(RUNBOOK_HELP);return;}
  const {command,options}=parse(argv),abort=signal?null:new AbortController();signal??=abort.signal;
  const stop=()=>abort?.abort();if(abort){process.once('SIGINT',stop);process.once('SIGTERM',stop);}
  let workspace,runbooks;
  try{
    signal.throwIfAborted();const url=options['--url']?loopback(options['--url']):null;
    need(options['--client']===undefined||url&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(options['--client']),'RUNBOOK_CLIENT_ALIAS','Use --client ALIAS with the running portfolio --url.');
    const clientMount=options['--client']?'/portfolio/clients/'+options['--client']:'';
    if(!url){
      const directory=resolve(required(options,'--workspace')),info=await lstat(directory),state=await lstat(join(directory,'workspace.json'));
      need(info.isDirectory()&&!info.isSymbolicLink()&&state.isFile()&&!state.isSymbolicLink(),'EXISTING_WORKSPACE_REQUIRED','Reopen the actual stopped accounting workspace.');
      workspace=await openAccountingWorkspace({directory});runbooks=new RunbookWorkspace(workspace,new AccountantWorkspace(workspace));
    }
    const request=async(path,value,{file=false}={})=>{
      signal.throwIfAborted();
      if(runbooks){const result=await handleRunbookRequest(runbooks,{method:value===undefined?'GET':'POST',path,value});need(result,'NOT_FOUND','Choose an original runbook operation.',404);return file?result.file:result.value;}
      let response;
      try{response=await fetch(new URL(clientMount+path,url),{method:value===undefined?'GET':'POST',signal,redirect:'error',cache:'no-store',...(value===undefined?{}:{headers:{'Content-Type':'application/json','X-Workspace-Request':'1'},body:JSON.stringify(value)})});}
      catch(error){if(signal.aborted)throw error;throw new WorkspaceError('WORKSPACE_UNREACHABLE','The original workspace could not be reached ('+(error.cause?.code??error.code??error.name)+'). Keep this same prepared request for reconciliation.');}
      const bytes=await readResponse(response);
      if(!response.ok){let failure;try{failure=JSON.parse(bytes);}catch{}const error=new WorkspaceError(failure?.error??'WORKSPACE_OPERATION_FAILED',failure?.message??'The workspace returned HTTP '+response.status+'.',response.status);if(failure?.applied===false)error.applied=false;throw error;}
      return file?{bytes,type:response.headers.get('content-type')}:JSON.parse(bytes);
    };
    const root='/api/runbooks',status=await request(root);let result;
    if(command==='status')result=status;
    else if(command==='sources')result=await request(root+'/sources');
    else if(command==='book'||command==='cycle'||command==='operation'){const id=required(options,'--id');need(UUID.test(id),'RUNBOOK_INVALID_ID','Choose the saved record ID.');result=await request(root+'/'+{book:'books',cycle:'cycles',operation:'operations'}[command]+'/'+id);}
    else if(command==='prepare'){
      const action=required(options,'--action'),selected=route(action,options['--id']),input=await originalJson(required(options,'--input'));
      need(!['workspaceId','requestId','revision'].some(key=>Object.hasOwn(input,key)),'RUNBOOK_ALREADY_BOUND','Use the unbound action input to prepare a new request, or execute the original prepared file.');
      need(typeof input.actor==='string'&&input.actor.trim(),'RUNBOOK_OPERATOR_REQUIRED','Include the current operator in input.actor.');
      if(options['--file']){
        need(['attach','receive'].includes(action)&&!Object.hasOwn(input,'content'),'RUNBOOK_INVALID_FILE_SELECTION','Choose one original supporting file or receiving packet.');
        const file=await originalFile(options['--file'],action==='attach'?RUNBOOK_FILE_BYTES:RUNBOOK_PACKET_BYTES);input.content=file.bytes.toString('base64');if(action==='attach')input.name??=file.name;
      }
      Object.assign(input,{workspaceId:status.workspaceId,requestId:randomUUID(),revision:status.revision});
      const prepared={schema:'stellar-forge.accounting-runbook-request.v1',action,...selected,requestSha256:requestHash(selected.kind,selected.target,input),input};
      result={file:await retain(required(options,'--out'),json(prepared)),workspaceId:input.workspaceId,revision:input.revision,requestId:input.requestId,action,path:selected.path,requestSha256:prepared.requestSha256};
    }else if(command==='execute'||command==='reconcile'){
      const prepared=await originalJson(required(options,'--prepared')),selected=route(prepared.action,prepared.target);
      need(prepared.schema==='stellar-forge.accounting-runbook-request.v1'&&plain(prepared.input)&&prepared.path===selected.path&&prepared.kind===selected.kind&&prepared.target===selected.target&&prepared.input.workspaceId===status.workspaceId&&prepared.requestSha256===requestHash(selected.kind,selected.target,prepared.input),'RUNBOOK_PREPARED_REQUEST_CHANGED','Use the exact prepared request for this original workspace.',409);
      if(command==='execute')result=await request(selected.path,prepared.input);
      else {
        try{
          const current=await request(root+'/operations/'+prepared.input.requestId),operation=current.operation;
          need(operation.kind===selected.kind&&operation.target===selected.target&&operation.requestSha256===prepared.requestSha256,'RUNBOOK_REQUEST_CONFLICT','This request ID belongs to different saved work.',409);
          result={status:'COMMITTED',workspaceId:status.workspaceId,currentRevision:current.revision,operation};
        }catch(error){if(error.code!=='RUNBOOK_OPERATION_NOT_FOUND')throw error;result={status:'NOT_FOUND',workspaceId:status.workspaceId,requestId:prepared.input.requestId,requestSha256:prepared.requestSha256};}
      }
    }else if(command==='download'||command==='file'){
      const id=required(options,'--id');need(UUID.test(id),'RUNBOOK_INVALID_ID','Choose the original period or file.');
      const format=options['--format']??'packet';if(command==='download')need(['packet','print','tasks'].includes(format),'RUNBOOK_INVALID_FORMAT','Choose packet, print or tasks.');
      const path=command==='file'?root+'/files/'+id:root+'/cycles/'+id+'/'+(format==='tasks'?'tasks.csv':format);
      const file=await request(path,undefined,{file:true});result={file:await retain(required(options,'--out'),file.bytes),type:file.type};
    }
    emit(result);return result;
  }finally{
    try{await workspace?.close();}finally{if(abort){process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)runbooksMain(process.argv.slice(2)).catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'RUNBOOK_COMMAND_FAILED',message:error.message,...(error.applied===false?{applied:false}:{})})+'\n');process.exitCode=1;});

// Original retained file transport is also used by the portfolio command interface.
export {originalFile as readRunbookInputFile,originalJson as readRunbookInputJson,retain as retainRunbookOutput,readResponse as readRunbookResponse,loopback as runbookLoopbackUrl};
