#!/usr/bin/env node
// MIT. Python attaches to the original live product through its maintained Node client.
import { createInterface } from 'node:readline';
import { dirname } from 'node:path';
import { connectMppChannel, actions } from '../client.mjs';
import { parseBundle } from '../receiving.mjs';
import { requireValue as need, hash, stable } from '../../mpp-charge/storage.mjs';
import { regular, privateDirectory } from '../../distribution/runtime-workspace/storage.mjs';
import { fullPath, privateFile, writePrivate } from '../../../../products/mpp-workspace/workspace.mjs';

const SCHEMA='stellar-forge.mpp-channel-python-bridge.v1';
const MAX_REQUEST=4*1024*1024, MAX_REPLY=32*1024*1024, MAX_FILE=128*1024*1024;
const METHODS=new Set(['identity','state','record','job','operate','run','response-file','handover-file','close']);
const plain=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const finite=(value,min,max)=>Number.isSafeInteger(value) && value>=min && value<=max;
function fault(error,extra={}) {
  return {code:typeof error.code==='string'?error.code:'MPP_CHANNEL_BRIDGE_OPERATION_FAILED',
    message:String(error.message ?? 'The original operation did not complete.'),
    ...(Number.isInteger(error.status)?{status:error.status}:{}),
    ...(error.jobId?{jobId:error.jobId}:{}),
    ...(error.purchaseId?{purchaseId:error.purchaseId}:{}),...extra};
}
async function send(frame) {
  const bytes=Buffer.from(JSON.stringify({schema:SCHEMA,...frame})+'\n');
  need(bytes.length<=MAX_REPLY,'MPP_CHANNEL_BRIDGE_REPLY_LIMIT');
  await new Promise((resolve,reject)=>process.stdout.write(bytes,error=>error?reject(error):resolve()));
}
async function receiveDocument(file) {
  return JSON.parse((await regular(fullPath(file),MAX_FILE)).toString('utf8'));
}
async function saveArtifact(file,bytes) {
  fullPath(file);need(Buffer.isBuffer(bytes) && bytes.length<=MAX_FILE,'MPP_CHANNEL_BRIDGE_FILE_LIMIT');
  await privateDirectory(dirname(file));
  let saved;
  try { saved=await privateFile(file,MAX_FILE); } catch(error) { if(error.code!=='ENOENT')throw error; }
  if(saved)need(saved.equals(bytes),'MPP_CHANNEL_RECEIVED_FILE_CONFLICT',409);
  else {
    try { await writePrivate(file,bytes); }
    catch(error) {
      // The original atomic writer owns creation. Reopen an identical concurrent completion.
      let current;
      try { current=await privateFile(file,MAX_FILE); } catch { throw error; }
      if(!current.equals(bytes))throw error;
    }
  }
  return {path:file,bytes:bytes.length,sha256:hash(bytes)};
}
async function receiveFile(client,kind,input) {
  need(plain(input) && typeof input.id==='string','MPP_CHANNEL_BRIDGE_FILE_INPUT_REQUIRED');
  fullPath(input.path);
  if(input.expectedSha256!==undefined)
    need(/^[a-f0-9]{64}$/.test(input.expectedSha256),'MPP_CHANNEL_BRIDGE_DIGEST_REQUIRED');
  const identity=await client.identity();
  let payload,details;
  if(kind==='response') {
    const purchase=await client.record('purchases',input.id);
    need(purchase.response,'MPP_CHANNEL_RESPONSE_UNAVAILABLE',404);
    payload=await client.response(input.id);
    need(payload.bytes.length===purchase.response.bytes && hash(payload.bytes)===purchase.response.sha256,
      'MPP_CHANNEL_ORIGINAL_RESPONSE_CHANGED',409);
    details={purchaseId:purchase.id,taskId:purchase.taskId,profileId:purchase.profileId,
      source:purchase.config?.source ?? null,channel:purchase.config?.channel ?? null,
      amountAtomic:purchase.amountAtomic ?? null,receipt:purchase.receipt ?? null,
      contentType:purchase.response.contentType,status:purchase.response.status};
  } else {
    payload=await client.handover(input.id);
    const bundle=parseBundle(payload.bytes.toString('utf8'));
    need(bundle.sha256===input.id,'MPP_CHANNEL_ORIGINAL_HANDOVER_CHANGED',409);
    details={bundleSha256:bundle.sha256,handoverId:bundle.id,sourceWorkspace:bundle.sourceWorkspace,
      channel:bundle.channel,versions:bundle.versions,records:bundle.records.length,
      sourceFiles:bundle.sourceFiles.length,inputFiles:bundle.inputFiles.length,contentType:'application/json'};
  }
  const fileSha256=hash(payload.bytes);
  need(input.expectedSha256===undefined || input.expectedSha256===fileSha256,
    'MPP_CHANNEL_RECEIVED_DIGEST_CHANGED',409);
  const file=await saveArtifact(input.path,payload.bytes);
  const record={schema:'stellar-forge.mpp-channel-received-file.v1',kind,
    workspace:identity.workspace,workspaceCreatedAt:identity.createdAt,...details,...file};
  const recordPath=input.path+'.'+hash(stable(record)).slice(0,16)+'.channel.json';
  await saveArtifact(recordPath,Buffer.from(JSON.stringify(record,null,2)+'\n'));
  return {...record,recordPath};
}
function resultSummary(result) {
  return {state:result?.state ?? null,completedPurchases:result?.results?.length ?? 0,
    ...(result?.job?{job:result.job}:{}),...(result?.purchaseId?{purchaseId:result.purchaseId}:{}),
    ...(result?.purchase?{purchaseId:result.purchase.id,purchase:result.purchase}: {})};
}
async function dispatch(client,request) {
  const input=request.input;
  need(plain(input),'MPP_CHANNEL_BRIDGE_INPUT_REQUIRED');
  if(request.method==='identity')return client.identity();
  if(request.method==='state')return client.state();
  if(request.method==='record') {
    need(['tasks','purchases','contracts','funders','funding','settlements','observations'].includes(input.kind),'MPP_CHANNEL_RECORD_KIND');
    return client.record(input.kind,input.id);
  }
  if(request.method==='job')return client.job(input.id);
  if(request.method==='operate') {
    need(actions.includes(input.action) && plain(input.arguments),'MPP_CHANNEL_OPERATION_NOT_FOUND',404);
    need(finite(input.waitMs,0,3600000),'MPP_CHANNEL_WAIT_INVALID');
    return client.invoke(input.action,input.arguments,{waitMs:input.waitMs});
  }
  if(request.method==='run') {
    need(finite(input.waitMs,0,3600000),'MPP_CHANNEL_WAIT_INVALID');
    need((typeof input.file==='string')!==Object.hasOwn(input,'document'),
      'MPP_CHANNEL_SELECT_ONE_WORK_LIST');
    const document=typeof input.file==='string'?await receiveDocument(input.file):input.document;
    const identity=await client.identity();
    if(input.resultPath!==undefined) {
      fullPath(input.resultPath);await privateDirectory(dirname(input.resultPath));
      // Preserve a differently selected result file before any new work is dispatched.
      try {
        const previous=await privateFile(input.resultPath,MAX_FILE);
        const retained=JSON.parse(previous.toString('utf8'));
        need(retained.schema==='stellar-forge.mpp-channel-work-file.v1' &&
          retained.workSha256===hash(stable(document)) && retained.workspace===identity.workspace &&
          retained.workspaceCreatedAt===identity.createdAt,'MPP_CHANNEL_WORK_RESULT_SELECTION_CHANGED',409);
      } catch(error) { if(error.code!=='ENOENT')throw error; }
    }
    const result=await client.runPurchases(document,{waitMs:input.waitMs});
    if(input.resultPath===undefined)return result;
    const record={schema:'stellar-forge.mpp-channel-work-file.v1',
      workSha256:hash(stable(document)),workspace:identity.workspace,workspaceCreatedAt:identity.createdAt,result};
    // Every changed outcome has its own immutable edition, while the requested path retains the first result.
    const encoded=Buffer.from(JSON.stringify(record,null,2)+'\n');
    let path=input.resultPath;
    try {
      const previous=await privateFile(path,MAX_FILE);
      if(!previous.equals(encoded))path=input.resultPath+'.'+hash(encoded).slice(0,16)+'.json';
    } catch(error) { if(error.code!=='ENOENT')throw error; }
    try {
      const file=await saveArtifact(path,encoded);
      return {schema:'stellar-forge.mpp-channel-work-file-result.v1',...resultSummary(result),
        workSha256:record.workSha256,file};
    } catch(error) { error.originalResult=resultSummary(result);throw error; }
  }
  if(request.method==='response-file')return receiveFile(client,'response',input);
  if(request.method==='handover-file')return receiveFile(client,'handover',input);
  if(request.method==='close')return {state:'CLOSED'};
  throw Object.assign(new Error('Use the original supported channel operation.'),{code:'MPP_CHANNEL_BRIDGE_METHOD_INVALID'});
}
export async function main(args=process.argv.slice(2)) {
  let client,lines;
  try {
    need(Number(process.versions.node.split('.')[0])>=22,'MPP_CHANNEL_NODE_22_REQUIRED');
    need(args.length===2 && args[0]==='--directory','MPP_CHANNEL_BRIDGE_DIRECTORY_REQUIRED');
    client=await connectMppChannel({directory:fullPath(args[1])});
    await send({type:'ready',identity:await client.identity(),methods:[...METHODS]});
    lines=createInterface({input:process.stdin,crlfDelay:Infinity,terminal:false});
    for await(const line of lines) {
      let request;
      try {
        need(Buffer.byteLength(line)<=MAX_REQUEST,'MPP_CHANNEL_BRIDGE_REQUEST_LIMIT');
        request=JSON.parse(line);
        need(request?.schema===SCHEMA && typeof request.id==='string' &&
          /^[a-f0-9]{32}$/.test(request.id) && METHODS.has(request.method),'MPP_CHANNEL_BRIDGE_REQUEST_INVALID');
        const result=await dispatch(client,request);
        await send({type:'result',id:request.id,ok:true,result});
        if(request.method==='close')break;
      } catch(error) {
        const uncertain=['operate','run'].includes(request?.method) &&
          !Number.isInteger(error.status) && !error.jobId && !error.originalResult;
        await send({type:'result',id:request?.id ?? null,ok:false,
          error:fault(error,{uncertain,...(error.originalResult?{originalResult:error.originalResult}:{})})});
        if(!request?.id)break;
      }
    }
    return 0;
  } catch(error) {
    await send({type:'fatal',error:fault(error)}).catch(()=>{});
    return 1;
  } finally { lines?.close();await client?.close(); }
}
main().then(code=>{process.exitCode=code;},()=>{process.exitCode=1;});
