// MIT. Complete commissioning command surface; one original workspace/listener.
import { readFile, lstat, open, link, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { restoreCentralArchive } from '../archive.mjs';
import { fault, digest } from '../../odata/state.mjs';
import { normalizeConnection } from './agreement.mjs';
import { openCentralCommissioning, serveCentralCommissioning } from './open.mjs';

const methods=new Map([['state','state'],['inspect','inspect'],['record-host','recordHost'],
  ['save-draft','saveDraft'],['prepare','prepare'],['install','install'],['capture','capturePeriod'],
  ['resume','resumeCapture'],['deliver','deliver'],['readiness','readiness']]);
export const COMMISSIONING_HELP=String.raw`Central commissioning — source agreement to two original reporting periods

  node commissioning/cli.mjs serve --workspace /private/field-workspace \
    --connection /private/central-host/connection.json --port 0 \
    --ready-file /private/commissioning-listener.json
  node commissioning/cli.mjs COMMAND --workspace /private/field-workspace \
    --connection /private/central-host/connection.json --input /private/action.json
  node commissioning/cli.mjs COMMAND --operator-file /private/commissioning-listener.json \
    --input /private/action.json

Commands:
  inspect       {id, projectId?}; records native current user/projects/forms.
  record-host   {id, handover}; retains actual original central-host handover.
  save-draft    {id, requestId, expectedRevision, agreement}; full original JSON.
  readiness     complete agreement object; names missing source/report decisions.
  prepare       {id, draftId, draftRevision, inspectionId, existingPlanIds?}.
  install       {id}; replays the selected immutable two-plan preparation.
  capture       {id, period:0|1, requestId, label?}; waits unless --no-wait.
  resume        {id, captureId}; original source capture continuation.
  deliver       {id, requestId, captures:[{period:0,captureId,reviewId},{period:1,...}]}.
  state         original definitions, plans, capture/review and full handovers.
  restore       --archive FILE --expected-sha256 HASH --workspace NEW_DIRECTORY.

Helpful file options:
  --agreement FILE --id DRAFT --request-id UUID --expected-revision N
  --host-handover FILE --id RECEIPT
  --environment FILE    Private JSON map containing the selected authEnv value;
                        only that named Authorization value is loaded.
  --connection FILE     Original central-host connection.json or bootstrap JSON.
  --operator-file FILE  Borrow a live original listener; never opens another DB.
  --no-wait             Capture/resume with an existing original listener only.
  --ready-file FILE     New private listener descriptor, removed on clean close.
  --host, --port        Local serve address; the original server enforces loopback.

Retain every action ID and full input before retrying. This command never accepts
a source review automatically. Use the original field workspace for source rows,
media/XML, quality and explicit review. All definitions, original observations and
complete delivery documents live in its original SQLite/source archive.
`;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
async function jsonFile(path,max=2*1024*1024){
  const info=await lstat(path);
  if(!info.isFile()||info.size>max)throw fault('CENTRAL_COMMISSIONING_INPUT','Use a regular UTF-8 JSON file within the input limit.');
  const bytes=await readFile(path);if(bytes.length>max)throw fault('CENTRAL_COMMISSIONING_INPUT','The input exceeds its size limit.');
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!plain(value))throw fault('CENTRAL_COMMISSIONING_INPUT','Use a JSON object.');
  return value;
}
function parse(argv){
  if(!argv.length||argv.includes('--help'))return {help:true};
  const [command,...args]=argv;if(!methods.has(command)&&!['serve','restore'].includes(command))
    throw fault('CENTRAL_COMMISSIONING_COMMAND','Use --help for the commissioning command list.');
  const out={command,fields:{}},seen=new Set();
  const files=new Set(['workspace','connection','environment','operator-file','input','agreement','host-handover','ready-file','archive']);
  const fields=new Map([['id','id'],['request-id','requestId'],['expected-revision','expectedRevision'],
    ['project-id','projectId'],['draft-id','draftId'],['draft-revision','draftRevision'],
    ['inspection-id','inspectionId'],['period','period'],['capture-id','captureId']]);
  const ints=new Set(['expectedRevision','draftRevision','period']);
  for(let i=0;i<args.length;i++){
    const flag=args[i];if(!flag.startsWith('--')||seen.has(flag))throw fault('CENTRAL_COMMISSIONING_OPTIONS','Use distinct named options.');seen.add(flag);
    const key=flag.slice(2);
    if(key==='no-wait'){out.noWait=true;continue;}
    const value=args[++i];if(value===undefined||value.startsWith('--'))throw fault('CENTRAL_COMMISSIONING_OPTIONS','Supply a value for '+flag+'.');
    if(files.has(key))out[key]=resolve(value);
    else if(fields.has(key)){const name=fields.get(key);out.fields[name]=ints.has(name)?Number(value):value;
      if(ints.has(name)&&(!value.trim()||!Number.isSafeInteger(out.fields[name])))throw fault('CENTRAL_COMMISSIONING_OPTIONS','Use an integer for '+flag+'.');}
    else if(['expected-sha256','host'].includes(key))out[key]=value;
    else if(key==='port'){out.port=Number(value);if(!Number.isSafeInteger(out.port))throw fault('CENTRAL_COMMISSIONING_OPTIONS','Use an integer local port.');}
    else throw fault('CENTRAL_COMMISSIONING_OPTIONS','Unknown commissioning option '+flag+'.');
  }
  if(out['operator-file']&&(out.workspace||out.connection||out.environment||out['ready-file']))
    throw fault('CENTRAL_COMMISSIONING_ATTACHMENT','Choose the existing listener or a direct workspace, not both.');
  return out;
}
async function loadConnection(options){
  if(!options.connection){if(options.environment)throw fault('CENTRAL_COMMISSIONING_CONNECTION','Choose the connection whose one environment alias is loaded.');return undefined;}
  const value=await jsonFile(options.connection,256*1024),connection=normalizeConnection(value.connection??value);
  if(options.environment){
    const env=await jsonFile(options.environment,64*1024),authorization=env[connection.authEnv];
    if(typeof authorization!=='string'||!authorization||/[\r\n]/.test(authorization))
      throw fault('CENTRAL_AUTH_REFERENCE','The private environment file must contain the complete original Authorization header.');
    const existing=process.env[connection.authEnv];
    if(existing&&existing!==authorization)throw fault('CENTRAL_AUTH_REFERENCE','The selected authorization alias already has another value in this process.');
    process.env[connection.authEnv]=authorization;
  }
  return connection;
}
async function actionInput(options){
  const file=options.input?await jsonFile(options.input):{},flags=options.fields??{};
  for(const key of Object.keys(flags))if(Object.hasOwn(file,key))throw fault('CENTRAL_COMMISSIONING_INPUT','The input file and options repeat '+key+'.');
  const input={...file,...flags};
  if(options.agreement){if(input.agreement)throw fault('CENTRAL_COMMISSIONING_INPUT','Choose one complete agreement.');input.agreement=await jsonFile(options.agreement);}
  if(options['host-handover']){if(input.handover)throw fault('CENTRAL_COMMISSIONING_INPUT','Choose one original handover.');input.handover=await jsonFile(options['host-handover']);}
  return input;
}
function output(value){process.stdout.write(JSON.stringify(value,null,2)+'\n');}
async function publishReady(path,value){
  const body=Buffer.from(JSON.stringify(value,null,2)+'\n'),temporary=path+'.'+randomUUID()+'.part';
  const handle=await open(temporary,'wx',0o600);
  try{await handle.writeFile(body);await handle.sync();}finally{await handle.close();}
  try{await link(temporary,path);const directory=await open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();}}
  finally{await unlink(temporary).catch(()=>{});}
  return {path,sha256:digest(body)};
}
async function retireReady(receipt){
  if(!receipt)return;
  try{if(digest(await readFile(receipt.path))===receipt.sha256)await unlink(receipt.path);}catch(error){if(error.code!=='ENOENT')throw error;}
}
async function remoteClient(path){
  const record=await jsonFile(path,256*1024),url=new URL(record.url),origin=url.origin;
  if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.protocol!=='http:'||url.username||url.password)
    throw fault('CENTRAL_COMMISSIONING_LISTENER','Use the existing private loopback listener descriptor.');
  const token=record.token??new URLSearchParams(url.hash.slice(1)).get('token');
  if(typeof token!=='string'||Buffer.byteLength(token)<32||!record.workspaceId)
    throw fault('CENTRAL_COMMISSIONING_LISTENER','Use its complete original workspace/token identity.');
  async function request(route,input){
    const response=await fetch(origin+route,{method:input===undefined?'GET':'POST',redirect:'error',
      headers:{Authorization:'Bearer '+token,...(input===undefined?{}:{'Content-Type':'application/json'})},
      ...(input===undefined?{}:{body:JSON.stringify(input)})});
    const result=await response.json();
    if(!response.ok||result.ok===false)throw Object.assign(new Error(result.error?.message??'Original listener request failed.'),result.error??{status:response.status});
    return result.result??result;
  }
  const state=await request('/api/commissioning/state');
  if(state.workspaceId!==record.workspaceId)throw fault('CENTRAL_COMMISSIONING_LISTENER','The original listener serves another workspace.');
  return {request,workspaceId:state.workspaceId,async edition(id){return request('/api/captures/'+encodeURIComponent(id));}};
}
export async function runCommissioningCli(argv=process.argv.slice(2)){
  const options=parse(argv);if(options.help){process.stdout.write(COMMISSIONING_HELP);return;}
  const input=await actionInput(options);
  if(options.command==='restore'){
    if(options['operator-file'])throw fault('CENTRAL_COMMISSIONING_RESTORE','Restore into a new independent workspace, then reopen it.');
    const result=await restoreCentralArchive({archive:options.archive,expectedSha256:options['expected-sha256'],directory:options.workspace});
    output(result);return result;
  }
  const connection=await loadConnection(options);
  if(options.command==='serve'){
    if(!options.workspace||options['operator-file'])throw fault('CENTRAL_COMMISSIONING_WORKSPACE','Serve the selected original private workspace.');
    const service=await serveCentralCommissioning({directory:options.workspace,connection,host:options.host??'127.0.0.1',port:options.port??0});
    const ready={schema:service.schema,workspaceId:service.workspaceId,directory:service.directory,
      origin:service.origin,url:service.url,fieldWorkspaceUrl:service.fieldWorkspaceUrl,token:service.token};
    let readyReceipt=null,finish;
    const stopped=new Promise(resolve=>{finish=resolve;});
    const shutdown=()=>finish();
    process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
    try{if(options['ready-file'])readyReceipt=await publishReady(options['ready-file'],ready);
      output(ready);await stopped;}
    finally{process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);
      try{await service.close();}finally{await retireReady(readyReceipt);}}
    return ready;
  }
  const method=methods.get(options.command),operationId=input.requestId??input.id??input.captureId;
  if(operationId)process.stderr.write(JSON.stringify({schema:'stellar-forge.central-commissioning-operation.v1',method,operationId,inputSha256:digest(JSON.stringify(input))})+'\n');
  let owner=null,remote=null;
  try{
    if(options['operator-file'])remote=await remoteClient(options['operator-file']);
    else{if(!options.workspace)throw fault('CENTRAL_COMMISSIONING_WORKSPACE','Choose the private workspace or its existing listener.');owner=await openCentralCommissioning({directory:options.workspace,connection});}
    if(options.noWait&&!remote)throw fault('CENTRAL_COMMISSIONING_MANAGED_REQUIRED','Use --no-wait only with the existing original listener.');
    let result=remote?await remote.request(method==='state'?'/api/commissioning/state':'/api/commissioning/'+method,method==='state'?undefined:input):
      await owner.commissioning[method](input);
    if(['capturePeriod','resumeCapture'].includes(method)&&!options.noWait){
      const id=result.capture?.id??result.id;
      if(owner)result={...result,capture:await owner.workspace.wait({id})};
      else{let capture=result.capture??result;while(capture.status==='CAPTURING'){await new Promise(resolve=>setTimeout(resolve,1000));capture=await remote.edition(id);}result={...result,capture};}
      if(result.capture?.status==='FAILED')process.exitCode=1;
    }
    output(result);return result;
  }finally{await owner?.close();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  runCommissioningCli().catch(error=>{process.stderr.write(JSON.stringify({code:error.code||'CENTRAL_COMMISSIONING_CLI',message:error.message,
    ...(error.details?{details:error.details}:{})})+'\n');process.exitCode=1;});
