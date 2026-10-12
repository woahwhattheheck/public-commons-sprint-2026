#!/usr/bin/env node
// MIT. Durable commands over the original Cloud/DuckDB provider and retained writer.
import {constants} from 'node:fs';
import {open,mkdir,realpath,link,unlink,readdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {connectCloudClient,CLOUD_CLIENT_TOOLS} from './client.mjs';
import {CLOUD_ACTIONS} from './catalog.mjs';
import {inspectCloudArtifact,downloadCloudArtifact,reopenCloudArtifact,parseCloudTransfer,CLOUD_TRANSFER_MANIFEST} from './remote-download.mjs';
import {uploadCloudFile,inspectCloudUpload} from './remote-upload.mjs';
import {privateSupportDirectory} from '../../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import {acquireStateLease} from '../../../merchant-fleet-gateway/state-lease.mjs';
const REQUEST='stellar-forge.cloud-remote-command.v1';
const TOOLS=new Map(CLOUD_CLIENT_TOOLS.map(value=>[value.name,value]));
const MUTATIONS=new Set(Object.keys(CLOUD_ACTIONS).map(name=>'merchant_cloud_'+name));
const sha=raw=>createHash('sha256').update(raw).digest('hex'),encode=value=>Buffer.from(JSON.stringify(value)+'\n');
const MAX_JSON=16*1024*1024,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const options={
 url:{type:'string'},'token-env':{type:'string'},arguments:{type:'string'},output:{type:'string'},
 'operation-dir':{type:'string'},'timeout-ms':{type:'string'},workspace:{type:'string'},
 'workspace-instance-id':{type:'string'},artifact:{type:'string'},id:{type:'string'},file:{type:'string'},kind:{type:'string'},
 sha256:{type:'string'},selection:{type:'string'},out:{type:'string'},directory:{type:'string'},'chunk-size':{type:'string'},help:{type:'boolean',short:'h'}
};
const help=String.raw`Cloud Delivery remote operator and receiving
  starforge cloud-remote tools [EXACT_TOOL]
  starforge cloud-remote call EXACT_TOOL --url MCP_URL --arguments REQUEST.json
      [--operation-dir PRIVATE_COMMAND_DIRECTORY] [--output RESULT.json]
  starforge cloud-remote recover --url MCP_URL --operation-dir PRIVATE_COMMAND_DIRECTORY
  starforge cloud-remote retry --url MCP_URL --operation-dir PRIVATE_COMMAND_DIRECTORY
      --workspace-instance-id CURRENT_UUID
  starforge cloud-remote inspect --url MCP_URL --workspace ALIAS --artifact KIND --id ID
      [--file ORIGINAL_MEMBER] [--kind summary|full] [--sha256 SHA256] --out SELECTION.json
  starforge cloud-remote download --url MCP_URL --selection SELECTION.json --out PRIVATE_TRANSFER_DIRECTORY
  starforge cloud-remote reopen --directory PRIVATE_TRANSFER_DIRECTORY
  starforge cloud-remote upload --url MCP_URL --arguments UPLOAD.json --operation-dir PRIVATE_UPLOAD_DIRECTORY
  starforge cloud-remote receive --url MCP_URL --directory PRIVATE_TRANSFER_DIRECTORY
      --arguments RECEIVING.json --operation-dir PRIVATE_RECEIVING_COMMAND_DIRECTORY
      [--workspace-instance-id CURRENT_UUID]

Every Cloud action (including native draft/package/start/stop) requires a private
command directory. The original request bytes, workspace UUID and dispatch marker
are retained before effect. A repeated call with no response inspects the original
operation; it never repeats a mutation. recover is read-only. retry is the explicit
operator continuation of a declared idempotent action after inspecting that same
operation; it keeps all native input fields/IDs and records a current owner UUID.
Start/stop are never retried by this command: inspect the actual runtime first.

UPLOAD.json contains workspace, workspaceInstanceId, editionId, fileId, path,
sha256 and bytes. The existing local file is streamed and compared to its native
committed prefix before sending remaining chunks. No intake/commit is implicit.
RECEIVING.json contains workspace, workspaceInstanceId, intakeOperationId,
expectedRevision and receiveOperationId. receive accepts only a completed
original delivery transfer, retains its exact input, performs original archive
intake, streams its bytes, then freezes and invokes the original native receive.
On a missing child reply it stops at that same child command directory. Explicit
retry there followed by the same receive command consumes the retained result.
Native source selection and edited draft adoption remain explicit original tools.

Open the selected host alias first with merchant_cloud_open. Download/reopen use
the original retained-file writer and SHA256 selection; they acquire no source
and infer no payment. Use the received_draft/select/draft_adopt tools or the same
browser editor to review and save an editable original merchant plan. Existing
commercial history and package identities remain provenance until that save.
No token is accepted on the command line: --token-env selects MCP_ACCESS_TOKEN
by default. --timeout-ms is 1..3600000; --chunk-size is 1..196608. Output parents
must already be private directories. Files are create-only, identical output is
reused. Cancelled calls must be reconciled by their original operation identity.
`;
function numericIdentity(value){
 const match=/^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(value);
 if(!match||value.length>1024)return null;
 let digits=(match[2]+(match[3]??'')).replace(/^0+/,'');
 if(!digits)return '0';
 let exponent=BigInt(match[4]??'0')-BigInt((match[3]??'').length);
 const trailing=digits.length-digits.replace(/0+$/,'').length;
 if(trailing){digits=digits.slice(0,-trailing);exponent+=BigInt(trailing);}
 return match[1]+digits+'e'+exponent;
}
function fail(code,message,details){throw Object.assign(new Error(message),{code,...details});}
function requireOption(values,key){
  const value=values[key];
  if(typeof value!=='string'||!value.length||/[\x00-\x1f\x7f]/.test(value))
    fail('CLOUD_REMOTE_OPTION_REQUIRED','Supply --'+key+'.');
  return value;
}
function integer(value,fallback,maximum,name){
  if(value===undefined)return fallback;
  if(!/^[1-9][0-9]*$/.test(value))fail('CLOUD_REMOTE_INTEGER','Use a positive integer for --'+name+'.');
  const result=Number(value);
  if(!Number.isSafeInteger(result)||result>maximum)fail('CLOUD_REMOTE_INTEGER','--'+name+' exceeds its native limit.');
  return result;
}
async function readBytes(filename,maximum=MAX_JSON,{missing=false}={}){
  let handle;
  try{handle=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);}
  catch(error){if(missing&&error.code==='ENOENT')return null;throw error;}
  try{
    const before=await handle.stat();
    if(!before.isFile()||before.size>maximum)fail('CLOUD_REMOTE_FILE_INVALID','Use a regular bounded original JSON file.');
    const chunks=[];let count=0;
    for(;;){
      const block=Buffer.alloc(Math.min(65536,maximum-count+1));
      const {bytesRead}=await handle.read(block,0,block.length,null);
      if(!bytesRead)break;
      count+=bytesRead;if(count>maximum)fail('CLOUD_REMOTE_FILE_TOO_LARGE','The selected JSON exceeds its native bound.');
      chunks.push(block.subarray(0,bytesRead));
    }
    const after=await handle.stat();
    if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs)
      fail('CLOUD_REMOTE_FILE_CHANGED','The selected input changed while being read.');
    return Buffer.concat(chunks,count);
  }finally{await handle.close();}
}
function json(raw){
  try{
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw),(_key,value,context)=>{
      if(typeof value==='number'&&(!Number.isFinite(value)||Number.isInteger(value)&&!Number.isSafeInteger(value)||
        typeof context?.source!=='string'||numericIdentity(context.source)!==numericIdentity(String(value))))
        fail('CLOUD_REMOTE_NUMBER_INVALID','Use exact decimal strings in declared native fields and safe integer revisions/counts.');
      return value;
    });
  }catch(error){if(error.code)throw error;fail('CLOUD_REMOTE_JSON_INVALID','Use complete UTF-8 JSON with its original native field values.');}
}
async function closeClient(client,primary){
  try{await client.close();}
  catch(error){if(primary)primary.cleanup={code:error.code??'CLOUD_CLIENT_CLOSE_INCOMPLETE'};else throw error;}
}
async function privateParent(filename){
  const parent=dirname(filename);
  await privateSupportDirectory(parent);
  if(await realpath(parent)!==parent)fail('CLOUD_REMOTE_PRIVATE_PATH','Choose a canonical private output directory without symlink components.');
}
async function retain(filename,raw){
  filename=resolve(filename);await privateParent(filename);
  const temporary=join(dirname(filename),'.cloud-'+randomUUID()+'.tmp');
  let handle,owned=false;
  try{
    handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);owned=true;
    await handle.writeFile(raw);await handle.sync();await handle.close();handle=null;
    try{await link(temporary,filename);}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const existing=await readBytes(filename,Math.max(raw.length,1));
      if(!existing.equals(raw))fail('CLOUD_REMOTE_OUTPUT_CONFLICT','The retained output has different original bytes; select a new output path.');
    }
    const parent=await open(dirname(filename),constants.O_RDONLY|constants.O_DIRECTORY);
    try{await parent.sync();}finally{await parent.close();}
  }finally{if(handle)await handle.close();if(owned)await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function emit(value,filename){
  const raw=encode(value);
  if(filename){await retain(filename,raw);process.stdout.write(JSON.stringify({output:resolve(filename),bytes:raw.length,sha256:sha(raw)})+'\n');}
  else process.stdout.write(raw);
}
async function commandDirectory(directory,operation){
  const root=resolve(directory);
  try{await mkdir(root,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  await privateSupportDirectory(root);
  if(await realpath(root)!==root)fail('CLOUD_REMOTE_PRIVATE_PATH','Choose the real private command directory without symlink components.');
  const permitted=new Set(['lease.lock','arguments.json','request.json','dispatch.json','result.json','intake','receive','upload.json','receive-arguments.json']);
  const names=await readdir(root);
  if(names.some(name=>!permitted.has(name)&&!/^(inspection|attempt)-[0-9]+-[a-f0-9-]{36}(?:-dispatch|-result)?\.json$/.test(name)&&
    !/^\.cloud-[a-f0-9-]{36}\.tmp$/.test(name)))
    fail('CLOUD_REMOTE_DIRECTORY_IN_USE','Choose an empty private directory or this original command directory.');
  const lease=await acquireStateLease(root);
  try{lease.assertHeld();const result=await operation(root,lease);lease.assertHeld();return result;}finally{await lease.close();}
}

function nativeKey(tool,args){
 const action=tool.slice('merchant_cloud_'.length);
 if(action==='start'||action==='stop')return {kind:'runtime',operationId:null};
 return {kind:action==='prepare'?'package':action.startsWith('draft_')?'draft':'cloud',
  operationId:args.operationId??args.editionId};
}
function validateRecord(value){
 if(value?.schema!==REQUEST||!MUTATIONS.has(value.tool)||!value.arguments||!UUID.test(value.workspaceId??'')||
  typeof value.arguments.workspace!=='string')
  fail('CLOUD_REMOTE_RECORD_INVALID','Use the original complete command record.');
 const {requestSha256,...payload}=value;
 if(!/^[a-f0-9]{64}$/.test(requestSha256??'')||sha(encode(payload))!==requestSha256)
  fail('CLOUD_REMOTE_RECORD_INVALID','The original command digest differs.');
 return value;
}
async function sameWorkspace(client,record,signal){
 const state=await client.status(record.arguments.workspace,{signal});
 if(state.workspaceId!==record.workspaceId||state.native?.workspaceId!==record.workspaceId)
  fail('CLOUD_REMOTE_WORKSPACE_CHANGED','The selected alias is not the original workspace UUID.');
 return state;
}
async function inspection(client,root,record,signal){
 const state=await sameWorkspace(client,record,signal),key=nativeKey(record.tool,record.arguments);
 let native,error;
 try{native=key.kind==='runtime'?await client.call('merchant_cloud_runtime',{workspace:record.arguments.workspace},{signal}):
  await client.operation(record.arguments.workspace,key.operationId,key.kind,{signal});}
 catch(issue){error={code:issue.code??'CLOUD_REMOTE_INSPECTION_FAILED',message:issue.message};}
 const result={schema:'stellar-forge.cloud-remote-inspection.v1',state:'RECONCILIATION_REQUIRED',requestSha256:record.requestSha256,
  workspaceId:record.workspaceId,workspaceInstanceId:state.instanceId,tool:record.tool,...key,
  native:native??null,error:error??null,inspectedAt:new Date().toISOString(),
  next:'Review this original native state. Explicit retry is available only for unchanged declared resumable actions.'};
 await retain(join(root,'inspection-'+Date.now()+'-'+randomUUID()+'.json'),encode(result));return result;
}
async function invoke(name,args,argumentBytes,rootName,connect,signal,{retryInstance}={}){
 return commandDirectory(rootName,async(root,lease)=>{
  const savedRequest=await readBytes(join(root,'request.json'),MAX_JSON,{missing:true});let record;
  if(savedRequest){
   record=validateRecord(json(savedRequest));
   const retainedArguments=await readBytes(join(root,'arguments.json'),3*1024*1024);
   if(!retainedArguments.equals(argumentBytes)||record.argumentsSha256!==sha(argumentBytes)||record.tool!==name||
    JSON.stringify(record.arguments)!==JSON.stringify(args))
    fail('CLOUD_REMOTE_REQUEST_CONFLICT','This command retains a different original tool or argument document.');
   const saved=await readBytes(join(root,'result.json'),MAX_JSON,{missing:true});
   if(saved){const value=json(saved);if(value.requestSha256!==record.requestSha256)fail('CLOUD_REMOTE_RECORD_INVALID','The response belongs to a different original command.');return {...value,reopened:true};}
  }
  const client=await connect();let primary;
  try{
   let state;
   if(record)state=await sameWorkspace(client,record,signal);
   else{
    state=await client.status(args.workspace,{signal});
    if(state.instanceId!==args.workspaceInstanceId||!UUID.test(state.workspaceId??''))
     fail('CLOUD_REMOTE_INSTANCE_CHANGED','Inspect and use the current original workspace instance.');
    const payload={schema:REQUEST,tool:name,arguments:args,argumentsSha256:sha(argumentBytes),
     workspaceId:state.workspaceId,endpoint:client.endpoint};
    record={...payload,requestSha256:sha(encode(payload))};
    await retain(join(root,'arguments.json'),argumentBytes);await retain(join(root,'request.json'),encode(record));
   }
   const dispatched=await readBytes(join(root,'dispatch.json'),MAX_JSON,{missing:true});
   let actual=args,attempt=null;
   if(dispatched){
    const observed=await inspection(client,root,record,signal);
    if(!retryInstance)return observed;
    const action=CLOUD_ACTIONS[name.slice('merchant_cloud_'.length)];
    if(!action?.resume)fail('CLOUD_REMOTE_RETRY_NOT_SUPPORTED','Inspect the actual runtime; start/stop do not have automatic or generic retry.');
    if(retryInstance!==state.instanceId)fail('CLOUD_REMOTE_INSTANCE_CHANGED','The selected continuation instance is not current.');
    if(observed.error&&!['CLOUD_OPERATION_NOT_FOUND','WORKSPACE_OPERATION_NOT_FOUND'].includes(observed.error.code))
     fail('CLOUD_REMOTE_INSPECTION_FAILED','Resolve the actual original-state read before retrying this command.');
    actual={...args,workspaceInstanceId:retryInstance};
    attempt='attempt-'+Date.now()+'-'+randomUUID();
    await retain(join(root,attempt+'.json'),encode({schema:'stellar-forge.cloud-remote-retry.v1',
     requestSha256:record.requestSha256,originalArguments:args,actualArguments:actual,inspection:observed,
     meaning:'EXPLICIT_SAME_OPERATION_CONTINUATION; only the original owner instance binding changes'}));
   }else if(retryInstance&&retryInstance!==args.workspaceInstanceId)
    fail('CLOUD_REMOTE_NOT_DISPATCHED','The original request was not dispatched. Review the original instance rather than rebinding an unattempted command.');
   signal.throwIfAborted();lease.assertHeld();
   await retain(join(root,attempt?attempt+'-dispatch.json':'dispatch.json'),encode({
    schema:'stellar-forge.cloud-remote-dispatch.v1',requestSha256:record.requestSha256,preparedAt:new Date().toISOString(),
    meaning:'CLIENT_DISPATCH_MARKER; original native state remains authoritative'}));
   try{
    const result=await client.call(name,actual,{signal});
    const saved={schema:'stellar-forge.cloud-remote-command-result.v1',state:'NATIVE_RESPONSE_RETAINED',
     requestSha256:record.requestSha256,operationId:nativeKey(name,args).operationId,tool:name,result};
    lease.assertHeld();await retain(join(root,'result.json'),encode(saved));return saved;
   }catch(error){
    error.cloudOperation??={tool:name,...nativeKey(name,args),workspace:args.workspace,workspaceInstanceId:actual.workspaceInstanceId};
    error.recover={command:'cloud-remote recover',operationDirectory:root};throw error;
   }
  }catch(error){primary=error;throw error;}finally{await closeClient(client,primary);}
 });
}
async function recover(rootName,connect,signal,{retryInstance}={}){
 const root=resolve(rootName),raw=await readBytes(join(root,'request.json')),record=validateRecord(json(raw));
 const argumentBytes=await readBytes(join(root,'arguments.json'),3*1024*1024);
 if(sha(argumentBytes)!==record.argumentsSha256||JSON.stringify(json(argumentBytes))!==JSON.stringify(record.arguments))
  fail('CLOUD_REMOTE_RECORD_INVALID','The retained original argument bytes or values changed.');
 if(retryInstance)return invoke(record.tool,record.arguments,argumentBytes,root,connect,signal,{retryInstance});
 return commandDirectory(root,async()=>{
  const saved=await readBytes(join(root,'result.json'),MAX_JSON,{missing:true});
  if(saved){const result=json(saved);if(result.requestSha256!==record.requestSha256)fail('CLOUD_REMOTE_RECORD_INVALID','The retained response has another command identity.');return {...result,reopened:true};}
  const client=await connect();let primary;
  try{return await inspection(client,root,record,signal);}catch(error){primary=error;throw error;}finally{await closeClient(client,primary);}
 });
}
async function uploadCommand(raw,rootName,connect,signal,chunkSize,override){
 const args=json(raw),keys=['workspace','workspaceInstanceId','editionId','fileId','path','sha256','bytes'];
 if(!args||Object.keys(args).some(key=>!keys.includes(key))||keys.some(key=>!Object.hasOwn(args,key)))
  fail('CLOUD_REMOTE_UPLOAD_ARGUMENTS','Use the complete original file, size/hash and existing upload identity.');
 args.path=resolve(args.path);
 return commandDirectory(rootName,async(root)=>{
  await retain(join(root,'arguments.json'),raw);
  const priorBytes=await readBytes(join(root,'upload.json'),MAX_JSON,{missing:true});
  const prior=priorBytes?json(priorBytes):null;
  if(prior&&(prior.argumentsSha256!==sha(raw)||JSON.stringify(prior.arguments)!==JSON.stringify(args)||!UUID.test(prior.workspaceId??'')))
   fail('CLOUD_REMOTE_REQUEST_CONFLICT','This upload belongs to another original file or workspace.');
  const completed=await readBytes(join(root,'result.json'),MAX_JSON,{missing:true});
  if(completed){
   const local=await inspectCloudUpload(args.path,{signal}),value=json(completed);
   if(!prior||local.bytes!==String(args.bytes)||local.sha256!==args.sha256||value.workspaceId!==prior.workspaceId||
    value.argumentsSha256!==prior.argumentsSha256)fail('CLOUD_REMOTE_UPLOAD_FILE_CHANGED','The original completed upload selection changed.');
   return {...value,reopened:true};
  }
  const client=await connect();let primary;
  try{
   const state=await client.status(args.workspace,{signal}),instance=override??args.workspaceInstanceId;
   if(instance!==state.instanceId||prior&&state.workspaceId!==prior.workspaceId)
    fail('CLOUD_REMOTE_INSTANCE_CHANGED','Use the actual same workspace UUID and its current upload instance.');
   const request=prior??{schema:'stellar-forge.cloud-remote-upload.v1',argumentsSha256:sha(raw),arguments:args,workspaceId:state.workspaceId};
   await retain(join(root,'upload.json'),encode(request));
   const result=await uploadCloudFile({client,...args,workspaceInstanceId:instance,expectedSha256:args.sha256,expectedBytes:args.bytes,signal,chunkSize});
   const saved={schema:'stellar-forge.cloud-remote-upload-result.v1',state:'COMPLETE',argumentsSha256:request.argumentsSha256,
    workspaceId:request.workspaceId,result};await retain(join(root,'result.json'),encode(saved));return saved;
  }catch(error){primary=error;throw error;}finally{await closeClient(client,primary);}
 });
}
async function receiveCommand(raw,transferDirectory,rootName,connect,signal,override){
 const args=json(raw),keys=['workspace','workspaceInstanceId','intakeOperationId','expectedRevision','receiveOperationId'];
 if(!args||Object.keys(args).some(key=>!keys.includes(key))||keys.some(key=>!Object.hasOwn(args,key)))
  fail('CLOUD_REMOTE_RECEIVE_ARGUMENTS','Use the original workspace instance, intake/receive operation IDs and initial Cloud revision.');
 const original=await reopenCloudArtifact({directory:transferDirectory,signal});
 const manifest=parseCloudTransfer(await readBytes(join(resolve(transferDirectory),CLOUD_TRANSFER_MANIFEST),65000));
 if(manifest.source.artifact!=='delivery'||manifest.source.member!==null||manifest.source.kind!==null)
  fail('CLOUD_REMOTE_DELIVERY_REQUIRED','Receive one complete verified original Cloud delivery artifact.');
 const payload=join(resolve(transferDirectory),'payload');
 return commandDirectory(rootName,async(root)=>{
  const request={schema:'stellar-forge.cloud-remote-receiving.v1',argumentsSha256:sha(raw),arguments:args,
   transferId:manifest.transferId,manifestSha256:original.manifestSha256,source:manifest.source};
  await retain(join(root,'arguments.json'),raw);await retain(join(root,'request.json'),encode(request));
  const saved=await readBytes(join(root,'result.json'),MAX_JSON,{missing:true});
  if(saved){const value=json(saved);if(value.transferId!==manifest.transferId)fail('CLOUD_REMOTE_RECORD_INVALID','This receiving result has another original transfer.');return {...value,reopened:true};}
  const instance=override??args.workspaceInstanceId;
  const intakeArgs={workspace:args.workspace,workspaceInstanceId:args.workspaceInstanceId,operationId:args.intakeOperationId,
   expectedRevision:args.expectedRevision,archive:{name:manifest.source.file.name,bytes:String(manifest.source.file.bytes),sha256:manifest.source.file.sha256}};
  const intake=await invoke('merchant_cloud_intake',intakeArgs,encode(intakeArgs),join(root,'intake'),connect,signal);
  if(intake.state==='RECONCILIATION_REQUIRED')return {...intake,phase:'intake',operationDirectory:join(root,'intake')};
  const nativeIntake=intake.result?.result?.edition;
  if(nativeIntake?.id!==args.intakeOperationId||!nativeIntake.archive)
   fail('CLOUD_REMOTE_RECEIVE_REPLY_INVALID','The original intake response does not bind this archive.');
  const client=await connect();let primary,receiveArgs,receiveBytes;
  try{
   const state=await client.status(args.workspace,{signal});
   if(state.instanceId!==instance||state.workspaceId!==intake.result?.workspaceId)
    fail('CLOUD_REMOTE_INSTANCE_CHANGED','Explicitly bind this same receiving continuation to the current instance of its original workspace UUID.');
   const upload=await uploadCloudFile({client,workspace:args.workspace,workspaceInstanceId:instance,
    editionId:args.intakeOperationId,fileId:'archive',path:payload,expectedBytes:String(manifest.source.file.bytes),
    expectedSha256:manifest.source.file.sha256,signal});
   receiveBytes=await readBytes(join(root,'receive-arguments.json'),MAX_JSON,{missing:true});
   if(receiveBytes)receiveArgs=json(receiveBytes);
   else{
    const current=await client.status(args.workspace,{signal});
    receiveArgs={workspace:args.workspace,workspaceInstanceId:instance,operationId:args.receiveOperationId,
     expectedRevision:current.native.cloud.revision,intakeId:args.intakeOperationId};
    receiveBytes=encode(receiveArgs);await retain(join(root,'receive-arguments.json'),receiveBytes);
   }
   if(upload.state!=='COMPLETE')fail('CLOUD_REMOTE_RECEIVE_UPLOAD_INCOMPLETE','The original archive upload remains incomplete.');
  }catch(error){primary=error;throw error;}finally{await closeClient(client,primary);}
  const received=await invoke('merchant_cloud_receive',receiveArgs,receiveBytes,join(root,'receive'),connect,signal);
  if(received.state==='RECONCILIATION_REQUIRED')return {...received,phase:'receive',operationDirectory:join(root,'receive')};
  const result={schema:'stellar-forge.cloud-remote-receiving-result.v1',state:'COMPLETE',transferId:manifest.transferId,
   original:manifest.source,workspace:args.workspace,intakeOperationId:args.intakeOperationId,receivingId:args.receiveOperationId,
   result:received.result,sourceSelectionRequired:true,
   next:'Select a received edition, inspect received_draft, and save explicit edits through draft_adopt or the original browser.'};
  await retain(join(root,'result.json'),encode(result));return result;
 });
}
export async function run(argv=process.argv.slice(2)){
 const parsed=parseArgs({args:argv,options,allowPositionals:true,strict:true,tokens:true});
 const {values:v,positionals,tokens}=parsed,seen=new Set();
 for(const item of tokens)if(item.kind==='option'){if(seen.has(item.name))fail('CLOUD_REMOTE_REPEATED_OPTION','Supply an option only once: --'+item.name);seen.add(item.name);}
 if(v.help||!positionals.length){process.stdout.write(help);return {exitCode:0};}
 const [command,name]=positionals,connection=['url','token-env','timeout-ms'];
 const allowed={
  tools:['output'],call:[...connection,'arguments','operation-dir','output'],recover:[...connection,'operation-dir','output'],
  retry:[...connection,'operation-dir','workspace-instance-id','output'],
  inspect:[...connection,'workspace','artifact','id','file','kind','sha256','out'],
  download:[...connection,'selection','out','chunk-size','output'],reopen:['directory','output'],
  upload:[...connection,'arguments','operation-dir','chunk-size','workspace-instance-id','output'],
  receive:[...connection,'arguments','directory','operation-dir','workspace-instance-id','output']};
 if(!Object.hasOwn(allowed,command)||positionals.length>(['tools','call'].includes(command)?2:1)||
  [...seen].some(key=>key!=='help'&&!allowed[command].includes(key)))fail('CLOUD_REMOTE_COMMAND_INVALID',help);
 if(command==='tools'){
  const value=name?TOOLS.get(name):CLOUD_CLIENT_TOOLS;if(!value)fail('CLOUD_REMOTE_TOOL','Choose an exact original Cloud tool.');
  await emit(value,v.output);return value;
 }
 const controller=new AbortController(),abort=()=>controller.abort();
 process.once('SIGINT',abort);process.once('SIGTERM',abort);
 const signal=controller.signal,timeoutMs=integer(v['timeout-ms'],120000,3600000,'timeout-ms');
 const connect=()=>connectCloudClient({url:requireOption(v,'url'),tokenEnv:v['token-env']??'MCP_ACCESS_TOKEN',timeoutMs,signal});
 const chunkSize=integer(v['chunk-size'],196608,196608,'chunk-size');
 if(v['workspace-instance-id']&&!UUID.test(v['workspace-instance-id']))fail('CLOUD_REMOTE_INSTANCE_CHANGED','Use a native UUID for the explicit owner binding.');
 let result;
 try{
  if(command==='call'){
   if(!TOOLS.has(name))fail('CLOUD_REMOTE_TOOL','Choose an exact original Cloud tool.');
   const raw=await readBytes(resolve(requireOption(v,'arguments')),3*1024*1024),args=json(raw);
   if(MUTATIONS.has(name))result=await invoke(name,args,raw,requireOption(v,'operation-dir'),connect,signal);
   else{
    const client=await connect();let primary;
    try{result=await client.call(name,args,{signal});}catch(error){primary=error;throw error;}finally{await closeClient(client,primary);}
   }
  }else if(command==='recover'||command==='retry'){
   result=await recover(requireOption(v,'operation-dir'),connect,signal,command==='retry'?{retryInstance:requireOption(v,'workspace-instance-id')}:{});
  }else if(command==='reopen')result=await reopenCloudArtifact({directory:resolve(requireOption(v,'directory')),signal});
  else if(command==='upload'||command==='receive'){
   const raw=await readBytes(resolve(requireOption(v,'arguments')),3*1024*1024);
   result=command==='upload'?await uploadCommand(raw,requireOption(v,'operation-dir'),connect,signal,chunkSize,v['workspace-instance-id']):
    await receiveCommand(raw,resolve(requireOption(v,'directory')),requireOption(v,'operation-dir'),connect,signal,v['workspace-instance-id']);
  }else{
   const client=await connect();let primary;
   try{
    if(command==='inspect'){
     const selected={workspace:requireOption(v,'workspace'),artifact:requireOption(v,'artifact'),id:requireOption(v,'id'),
      ...(v.file?{file:v.file}:{}),...(v.kind?{kind:v.kind}:{}),...(v.sha256?{expectedSha256:v.sha256}:{})};
     result=await inspectCloudArtifact({client,selection:selected,signal});
     await retain(resolve(requireOption(v,'out')),encode(result.selection));
    }else{
     const raw=await readBytes(resolve(requireOption(v,'selection')),65000),selection=parseCloudTransfer(raw);
     result=await downloadCloudArtifact({client,selection,directory:resolve(requireOption(v,'out')),signal,chunkSize});
    }
   }catch(error){primary=error;throw error;}finally{await closeClient(client,primary);}
  }
  if(result?.state==='RECONCILIATION_REQUIRED')process.exitCode=3;
  await emit(result,v.output);return result;
 }finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
 run().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'CLOUD_REMOTE_COMMAND_FAILED',message:error.message,
  ...(error.cloudOperation?{operation:error.cloudOperation}:{}),...(error.cloudUpload?{upload:error.cloudUpload}:{}),
  ...(error.recover?{recover:error.recover}:{}),...(error.cleanup?{cleanup:error.cleanup}:{})})+'\n');process.exitCode=1;});
