// MIT. Connect to the existing local customer; retain full verified files without reopening its model.
import {open,link,unlink,realpath} from 'node:fs/promises';
import {dirname,join,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {readServiceFile} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/managed/selection.mjs';
import {absolute,ownedDirectory} from '../../stellar/scf-starforge-20261009/sf101-merchant-receiver/api-application/workspace/configuration.mjs';
import {readJobWorkspaceLaunch,jobWorkspaceLaunchPath} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/launch.mjs';
import {MCP_VERSION} from '../../stellar-forge/mcp-paid-agent/http-tools.mjs';
import {DOCUMENT_AGENT_PATH,DOCUMENT_AGENT_TOOLS,DOCUMENT_AGENT_REQUEST_BYTES} from './agent-schema.mjs';
import {documentError} from './contracts.mjs';

const HASH=/^[a-f0-9]{64}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const TERMINAL=new Set(['COMPLETE','CONTINUATION_REQUIRED','STOPPED','FAILED']);
function need(value,code,message){if(!value)throw documentError(code,message??code);}
function bounds(value,min,max,code){need(Number.isSafeInteger(value)&&value>=min&&value<=max,code);return value;}
function selectedUrl(value){
  let url;try{url=new URL(value);}catch{need(false,'DOCUMENT_AGENT_URL_REQUIRED');}
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!url.username&&!url.password&&!url.search&&
    /^#[a-f0-9]{64}$/.test(url.hash)&&Number(url.port||80)>=1,
    'DOCUMENT_AGENT_URL_REQUIRED','Use the original private loopback customer URL and its token fragment.');
  return {endpoint:url.origin+DOCUMENT_AGENT_PATH,origin:url.origin,token:url.hash.slice(1)};
}
async function jsonResponse(response,limit){
  const chunks=[];let bytes=0;
  try{
    for await(const chunk of response.body??[]){
      bytes+=chunk.byteLength;need(bytes<=limit,'DOCUMENT_AGENT_REPLY_TOO_LARGE');
      chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes)));
  }catch(error){
    try{await response.body?.cancel();}catch{}
    if(error.code)throw error;
    throw documentError('DOCUMENT_AGENT_REPLY_INVALID','The original customer did not return complete UTF-8 JSON.');
  }
}
/** Read and recheck the original private customer launch. Never starts another customer. */
export async function readDocumentAgentConnection(launchFile){
  launchFile=absolute(launchFile);
  const first=await readServiceFile(launchFile,65536,{privateFile:true});
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(first.bytes));}
  catch{need(false,'DOCUMENT_AGENT_LAUNCH_REQUIRED');}
  need(plain(value)&&launchFile===jobWorkspaceLaunchPath(value.directory)&&
    ['workspace','profile'].includes(value.operatorSelection?.kind),'DOCUMENT_AGENT_LAUNCH_REQUIRED');
  const operator=value.operatorSelection;
  const launch=await readJobWorkspaceLaunch({directory:value.directory,runtimeDirectory:value.runtimeDirectory,
    pid:value.pid,...(operator.kind==='workspace'?{operatorWorkspace:operator.directory}:{operatorProfile:operator.path})});
  need(launch.instanceId===value.instanceId&&launch.url===value.url,'DOCUMENT_AGENT_LAUNCH_CHANGED');
  const current=await readServiceFile(launchFile,65536,{privateFile:true});
  need(current.pin.sha256===first.pin.sha256,'DOCUMENT_AGENT_LAUNCH_CHANGED');
  selectedUrl(launch.url);
  return {url:launch.url,directory:launch.directory,pid:launch.pid,instanceId:launch.instanceId,
    launchFile,launchSha256:first.pin.sha256};
}
/**
 * No call retries or payment retries. A caller resumes accepted operations explicitly.
 * Keep the supplied URL/connection private: its fragment is the original customer token.
 */
export function createDocumentAgentClient({url,connection,fetch:fetchImpl=globalThis.fetch,
  timeoutMs=120000,maxReplyBytes=256*1024*1024}={}){
  const selected=selectedUrl(connection?.url??url);
  need(typeof fetchImpl==='function','DOCUMENT_AGENT_FETCH_REQUIRED');
  bounds(timeoutMs,1000,3600000,'DOCUMENT_AGENT_TIMEOUT_INVALID');
  bounds(maxReplyBytes,1024,512*1024*1024,'DOCUMENT_AGENT_REPLY_LIMIT_INVALID');
  let sequence=0,initialized=null;
  async function rpc(method,params,{signal,notification=false}={}){
    signal?.throwIfAborted();
    const id=++sequence,body=JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id}),method,...(params===undefined?{}:{params})});
    need(Buffer.byteLength(body)<=DOCUMENT_AGENT_REQUEST_BYTES,'DOCUMENT_AGENT_REQUEST_TOO_LARGE',
      'Use a complete source plan from the original allowed host root for inputs above the inline limit.');
    const combined=AbortSignal.any([AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])]);
    const response=await fetchImpl(selected.endpoint,{method:'POST',redirect:'error',signal:combined,
      headers:{authorization:'Bearer '+selected.token,'content-type':'application/json',
        accept:'application/json, text/event-stream','mcp-protocol-version':MCP_VERSION},body});
    if(notification){
      try{await response.body?.cancel();}catch{}
      need(response.status===202,'DOCUMENT_AGENT_INITIALIZATION_FAILED');return {};
    }
    const result=await jsonResponse(response,maxReplyBytes);
    need(response.ok&&result?.jsonrpc==='2.0'&&result.id===id,'DOCUMENT_AGENT_HTTP_ERROR',
      'The original customer rejected or interrupted this request (HTTP '+response.status+').');
    if(result.error)throw Object.assign(documentError('DOCUMENT_AGENT_RPC_ERROR',String(result.error.message??'MCP request failed.')),
      {details:result.error});
    need(plain(result.result),'DOCUMENT_AGENT_REPLY_INVALID');
    return result.result;
  }
  async function initialize({signal}={}){
    if(initialized)return initialized;
    const result=await rpc('initialize',{protocolVersion:MCP_VERSION,capabilities:{},
      clientInfo:{name:'stellar-forge-document-client',version:'1.0.0'}},{signal});
    need(result.protocolVersion===MCP_VERSION&&result.serverInfo?.name==='stellar-forge-document-customer',
      'DOCUMENT_AGENT_SERVER_CHANGED');
    await rpc('notifications/initialized',undefined,{signal,notification:true});
    initialized=result;return result;
  }
  async function call(name,args={},options={}){
    need(DOCUMENT_AGENT_TOOLS.some(tool=>tool.name===name),'DOCUMENT_AGENT_TOOL_REQUIRED');
    await initialize(options);
    const result=await rpc('tools/call',{name,arguments:args},options);
    const value=result.structuredContent;
    need(plain(value),'DOCUMENT_AGENT_REPLY_INVALID');
    if(result.isError)throw Object.assign(documentError(value.code??'DOCUMENT_AGENT_TOOL_ERROR',
      value.message??value.reason??'Document operation failed.'),{details:value});
    if(name==='documents_status'&&connection?.directory)
      need(value.workspaceDirectory===connection.directory,'DOCUMENT_AGENT_CUSTOMER_CHANGED');
    return value;
  }
  async function wait(operationId,{bundles=false,pollMs=1000,deadlineMs=300000,signal,onProgress}={}){
    bounds(pollMs,100,30000,'DOCUMENT_AGENT_POLL_INVALID');
    bounds(deadlineMs,1000,86400000,'DOCUMENT_AGENT_DEADLINE_INVALID');
    const started=Date.now(),name=bundles?'pdf_bundle_operation':'documents_operation';
    for(;;){
      signal?.throwIfAborted();
      const operation=await call(name,{operationId},{signal});await onProgress?.(operation);
      need(operation.id===operationId,'DOCUMENT_AGENT_OPERATION_CHANGED');
      if(TERMINAL.has(operation.state))return operation;
      need(operation.state==='RUNNING','DOCUMENT_AGENT_OPERATION_STATE_INVALID');
      if(Date.now()-started>=deadlineMs)return {...operation,waitExpired:true,
        continuation:'The original operation remains active. Poll this ID or reopen its saved source; no new payment was started.'};
      await delay(Math.min(pollMs,Math.max(1,deadlineMs-(Date.now()-started))),undefined,{signal});
    }
  }
  async function download(input,destination,{bundles=false,signal,maxBytes=512*1024*1024}={}){
    bounds(maxBytes,1,8*1024*1024*1024,'DOCUMENT_AGENT_FILE_LIMIT_INVALID');
    destination=absolute(destination);const parent=dirname(destination);
    await ownedDirectory(parent,{create:true});
    need(await realpath(parent)===parent,'DOCUMENT_AGENT_DESTINATION_REQUIRED');
    const ticket=await call(bundles?'pdf_bundle_download':'documents_download',input,{signal});
    need(/^\/transfer\/[a-f0-9]{48}$/.test(ticket.url??'')&&Number.isSafeInteger(ticket.bytes)&&
      ticket.bytes>=0&&ticket.bytes<=maxBytes&&HASH.test(ticket.sha256??''),'DOCUMENT_AGENT_FILE_TICKET_INVALID');
    const combined=AbortSignal.any([AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])]);
    let response,handle,temporary,complete=false;
    try{
      response=await fetchImpl(selected.origin+ticket.url,{method:'GET',redirect:'error',signal:combined,
        headers:{authorization:'Bearer '+selected.token,accept:'application/octet-stream'}});
      need(response.ok&&response.status===200&&response.body,'DOCUMENT_AGENT_FILE_HTTP_ERROR');
      need(Number(response.headers.get('content-length'))===ticket.bytes&&
        response.headers.get('x-content-sha256')===ticket.sha256,'DOCUMENT_AGENT_FILE_METADATA_CHANGED');
      temporary=join(parent,'.'+basename(destination)+'.'+randomUUID()+'.receiving');
      handle=await open(temporary,'wx',0o600);
      const hash=createHash('sha256');let bytes=0;
      for await(const chunk of response.body){
        signal?.throwIfAborted();bytes+=chunk.byteLength;
        need(bytes<=ticket.bytes,'DOCUMENT_AGENT_FILE_BYTES_CHANGED');hash.update(chunk);
        let offset=0;while(offset<chunk.byteLength){
          const written=await handle.write(chunk,offset,chunk.byteLength-offset,null);
          need(written.bytesWritten>0,'DOCUMENT_AGENT_FILE_WRITE_FAILED');offset+=written.bytesWritten;
        }
      }
      const sha256=hash.digest('hex');
      need(bytes===ticket.bytes&&sha256===ticket.sha256,'DOCUMENT_AGENT_FILE_CONTENT_CHANGED');
      await handle.sync();await handle.close();handle=null;
      // Link is atomic and refuses to overwrite an existing customer file.
      await link(temporary,destination);complete=true;
      return {path:destination,bytes,sha256,source:input,bundles};
    }finally{
      try{await handle?.close();}catch{}
      if(!complete)try{await response?.body?.cancel();}catch{}
      if(temporary)await unlink(temporary).catch(()=>{});
    }
  }
  return Object.freeze({
    endpoint:selected.endpoint,
    initialize,
    async tools(options={}){await initialize(options);return (await rpc('tools/list',{},options)).tools;},
    call,wait,download,
    status:(input={},options={})=>call('documents_status',input,options),
    get:(input,options={})=>call('documents_get',input,options),
    stage:(input,options={})=>call('documents_stage',input,options),
    quote:(input,options={})=>call('documents_quote',input,options),
    execute:(input,options={})=>call('documents_execute',input,options),
    receive:(input,options={})=>call('documents_receive',input,options),
    export:(input,options={})=>call('documents_export',input,options)
  });
}
