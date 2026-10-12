// MIT. Authenticated client for the original Socrata Property Operations owner.
import {request as httpRequest} from 'node:http';
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {canonical} from './propply.mjs';

import {PROPERTY_CLIENT_SCHEMA,PROPERTY_NATIVE_SCHEMA,PROPERTY_REQUEST_BYTES,PROPERTY_JSON_BYTES,PROPERTY_FILE_BYTES,
  PROPERTY_GROUPS,PROPERTY_READ_ACTIONS,PROPERTY_WRITE_ACTIONS,PROPERTY_PUBLISHER_ACTIONS,PROPERTY_FILE_KINDS} from './contract.mjs';
export * from './contract.mjs';
const READS=new Set(PROPERTY_READ_ACTIONS), WRITES=new Set(PROPERTY_WRITE_ACTIONS);
const ACTIONS=new Set([...READS,...WRITES,...PROPERTY_PUBLISHER_ACTIONS,'dataset.query','package.export']);
const HASH=/^[a-f0-9]{64}$/, KEY=/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const sha=v=>createHash('sha256').update(v).digest('hex');
const copy=v=>JSON.parse(canonical(v));
const immutable=v=>Object.freeze(copy(v));

export class PropertyClientError extends Error {
  constructor(code,message,{status=null,action=null,key=null,uncertain=false,result=null,cause}={}) {
    super(message,cause===undefined?undefined:{cause});
    Object.assign(this,{name:'PropertyClientError',code,status,action,key,uncertain,result});
  }
}
const fail=(code,message,detail)=>{throw new PropertyClientError(code,message,detail);};
function json(value,label) {
  if(!plain(value))fail('PROPERTY_CLIENT_INPUT',label+' must be a JSON object.');
  try{return Buffer.from(canonical(value));}
  catch(cause){fail('PROPERTY_CLIENT_INPUT',label+' must contain complete serializable JSON.',{cause});}
}
function options(value={}) {
  if(!plain(value)||Object.keys(value).some(k=>!['signal'].includes(k)))fail('PROPERTY_CLIENT_OPTIONS','Only the original AbortSignal is accepted as a request option.');
  return value;
}
function safeFile(value) {
  if(typeof value!=='string'||!value||value.length>500||value.startsWith('/')||/[\\\u0000-\u001f\u007f]/.test(value)||
    value.split('/').some(p=>!p||p==='.'||p==='..'))fail('PROPERTY_CLIENT_FILE','Select an exact native relative file.');
  return value;
}
function fileIdentity(value) {
  if(!plain(value)||!Number.isSafeInteger(value.bytes)||value.bytes<0||value.bytes>PROPERTY_FILE_BYTES||!HASH.test(value.sha256??''))
    fail('PROPERTY_CLIENT_FILE','Retain the original complete byte count and SHA-256.');
  return {bytes:value.bytes,sha256:value.sha256};
}
export function propertyConnection(url) {
  let parsed;try{parsed=new URL(url);}catch{fail('PROPERTY_CLIENT_CONNECTION','Use the private URL printed by the original workspace.');}
  if(typeof url!=='string'||url.length>8192||parsed.protocol!=='http:'||parsed.hostname!=='127.0.0.1'||
    parsed.username||parsed.password||parsed.search||parsed.pathname!=='/'||!parsed.port||
    !/^[A-Za-z0-9_-]{32,256}$/.test(parsed.hash.slice(1)))
    fail('PROPERTY_CLIENT_CONNECTION','Use the original authenticated loopback URL, including its private fragment.');
  return Object.freeze({origin:parsed.origin,token:parsed.hash.slice(1)});
}
/** The source-selected connection file stays private and may be atomically replaced on managed restart. */
export async function readPropertyConnection(file) {
  if(typeof file!=='string'||file!==resolve(file))fail('PROPERTY_CLIENT_CONNECTION','Choose the absolute private connection file.');
  const h=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const s=await h.stat();
    if(!s.isFile()||s.size<1||s.size>16384||process.platform!=='win32'&&((s.mode&0o077)!==0||process.getuid&&s.uid!==process.getuid()))
      fail('PROPERTY_CLIENT_CONNECTION','The connection must be a private, owned regular file.');
    const raw=await h.readFile();if(raw.length>16384)fail('PROPERTY_CLIENT_CONNECTION','The connection file changed while reading.');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(raw).trim();
    let value;if(text.startsWith('{')){try{value=JSON.parse(text);}catch{fail('PROPERTY_CLIENT_CONNECTION','The original connection record is incomplete.');}}
    else value={url:text};
    if(!plain(value)||typeof value.url!=='string')fail('PROPERTY_CLIENT_CONNECTION','The connection record must retain its original URL.');
    propertyConnection(value.url);
    return value;
  }finally{await h.close();}
}
function nativeState(value) {
  if(!plain(value)||value.schema!=='stellar-forge.socrata-workspace.v1'||typeof value.createdAt!=='string'||
    !Number.isFinite(Date.parse(value.createdAt))||!plain(value.property)||value.property.schema!==PROPERTY_NATIVE_SCHEMA||
    !Number.isSafeInteger(value.property.revision)||value.property.revision<0||
    value.property.id!==null&&(typeof value.property.id!=='string'||!KEY.test(value.property.id))||
    !PROPERTY_GROUPS.every(k=>Array.isArray(value.property[k]))||!Array.isArray(value.property.files)||!Array.isArray(value.property.operations)||
    !Array.isArray(value.exports))fail('PROPERTY_CLIENT_STATE','The server must expose the complete original Property Operations workspace.');
  return value;
}
function prepared(value) {
  if(!plain(value)||value.schema!==PROPERTY_CLIENT_SCHEMA||typeof value.createdAt!=='string'||!WRITES.has(value.action)||
    !plain(value.payload)||!KEY.test(value.payload.key??'')||!HASH.test(value.inputSha256??'')||
    sha(json(value.payload,'Prepared payload'))!==value.inputSha256)
    fail('PROPERTY_CLIENT_PREPARED','Use the complete unchanged saved request and original workspace identity.');
  return value;
}

/** Owns HTTP requests only. It never opens or closes the original workspace/publisher. */
export function createPropertyOperationsClient({url,expectedCreatedAt=null,expectedPropertyId=null,
  timeoutMs=300000,maxResponseBytes=PROPERTY_JSON_BYTES}={}) {
  const {origin,token}=propertyConnection(url);
  if(expectedCreatedAt!==null&&(typeof expectedCreatedAt!=='string'||!Number.isFinite(Date.parse(expectedCreatedAt)))||
    expectedPropertyId!==null&&(typeof expectedPropertyId!=='string'||!KEY.test(expectedPropertyId))||
    !Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>3600000||
    !Number.isSafeInteger(maxResponseBytes)||maxResponseBytes<1024||maxResponseBytes>512*1024*1024)
    fail('PROPERTY_CLIENT_CONFIGURATION','Choose the original workspace identity and bounded request limits.');
  let createdAt=expectedCreatedAt, propertyId=expectedPropertyId, closing=false;
  const active=new Map();
  function checkState(value) {
    const s=nativeState(value);
    if(createdAt!==null&&s.createdAt!==createdAt)fail('PROPERTY_CLIENT_WORKSPACE_CHANGED','This connection now identifies a different original workspace.');
    if(propertyId!==null&&s.property.id!==propertyId)fail('PROPERTY_CLIENT_WORKSPACE_CHANGED','The original property workspace identity changed.');
    createdAt=s.createdAt;if(s.property.id!==null)propertyId=s.property.id;
    return s;
  }
  function raw(path,{method='GET',body,signal,action=null,key=null,mutating=false,maximum=maxResponseBytes,onChunk}={}) {
    if(closing)return Promise.reject(new PropertyClientError('PROPERTY_CLIENT_CLOSED','The borrowed client is closing.'));
    if(signal?.aborted)return Promise.reject(new PropertyClientError('PROPERTY_CLIENT_ABORTED','The request was cancelled before dispatch.',{action,key,cause:signal.reason}));
    let req,timer,abort,settled=false;
    const job=new Promise((resolveJob,rejectJob)=>{
      function finish(error,value) {
        if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
        if(error)rejectJob(error instanceof PropertyClientError?error:new PropertyClientError('PROPERTY_CLIENT_TRANSPORT',
          mutating?'The response was lost. Inspect the saved original request before continuing.':'The original server response was not completely received.',
          {action,key,uncertain:mutating,cause:error}));
        else resolveJob(value);
      }
      req=httpRequest(origin+path,{method,headers:{Authorization:'Bearer '+token,Origin:origin,Accept:'application/json',
        ...(body?{'Content-Type':'application/json','Content-Length':String(body.length)}:{})}},response=>{
        const work=(async()=>{
          const parts=[],digest=createHash('sha256');let bytes=0;
          const declared=response.headers['content-length'];
          if(declared!==undefined&&(!/^(0|[1-9][0-9]*)$/.test(declared)||Number(declared)>maximum))
            fail('PROPERTY_CLIENT_RESPONSE_LIMIT','The original response exceeds the selected byte limit.',{status:response.statusCode,action,key,uncertain:mutating});
          try {
            for await(const chunk of response) {
              bytes+=chunk.length;
              if(bytes>maximum)fail('PROPERTY_CLIENT_RESPONSE_LIMIT','The original response exceeds the selected byte limit.',{status:response.statusCode,action,key,uncertain:mutating});
              digest.update(chunk);
              if(onChunk&&response.statusCode>=200&&response.statusCode<300)await onChunk(chunk);
              else parts.push(chunk);
            }
            if(!response.complete||declared!==undefined&&bytes!==Number(declared))
              fail('PROPERTY_CLIENT_RESPONSE_INCOMPLETE','The original response body is incomplete.',{status:response.statusCode,action,key,uncertain:mutating});
            return {status:response.statusCode,headers:response.headers,bytes,sha256:digest.digest('hex'),raw:Buffer.concat(parts)};
          }finally{if(!response.complete)response.destroy();}
        })();
        work.then(v=>finish(null,v),e=>{response.destroy();finish(e)});
      });
      req.once('error',e=>finish(e));
      abort=()=>req.destroy(signal.reason instanceof Error?signal.reason:new Error('Request cancelled.'));
      signal?.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>req.destroy(new Error('Original workspace request timed out.')),timeoutMs);timer.unref?.();
      req.end(body);
    });
    const closed=req?new Promise(resolveClose=>req.once('close',resolveClose)):Promise.resolve();
    active.set(job,{request:()=>req,mutating,closed});
    Promise.allSettled([job,closed]).then(()=>active.delete(job));
    return job;
  }
  function responseError(receipt,{action=null,key=null,mutating=false}={}) {
    let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(receipt.raw));}catch{}
    const code=typeof value?.error==='string'?value.error:'PROPERTY_CLIENT_HTTP';
    const message=typeof value?.message==='string'?value.message:'The original workspace rejected this request.';
    return new PropertyClientError(code,message,{status:receipt.status,action,key,
      uncertain:mutating&&(receipt.status>=500||value?.uncertain===true),result:value??{status:receipt.status,bytes:receipt.bytes,sha256:receipt.sha256}});
  }
  async function request(path,input,requestOptions={},action=null) {
    const isPost=input!==undefined,mutating=isPost&&!READS.has(action),key=input?.payload?.key??null;
    const body=isPost?json(input,'Native request'):undefined;
    if(body&&body.length>PROPERTY_REQUEST_BYTES)fail('PROPERTY_CLIENT_REQUEST_LIMIT','The original action limit is 512 KiB. Import a reviewed host file for large original inputs.',{action,key});
    const receipt=await raw(path,{method:isPost?'POST':'GET',body,...options(requestOptions),action,key,mutating});
    if(receipt.status<200||receipt.status>=300)throw responseError(receipt,{action,key,mutating});
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(receipt.raw));}
    catch(cause){fail('PROPERTY_CLIENT_JSON','The original JSON result was not completely received.',{status:receipt.status,action,key,uncertain:mutating,cause,result:{bytes:receipt.bytes,sha256:receipt.sha256}});}
  }
  async function status(requestOptions) {return checkState(await request('/api/state',undefined,requestOptions));}
  async function act(action,payload={},requestOptions) {
    if(!ACTIONS.has(action)||!plain(payload))fail('PROPERTY_CLIENT_ACTION','Select an original property, source-file or publisher action and its complete input.');
    await status(requestOptions);
    if(WRITES.has(action)&&(!KEY.test(payload.key??'')||!Number.isSafeInteger(payload.expected_revision)||payload.expected_revision<0||
      payload.workspace_id!==null&&!KEY.test(payload.workspace_id??'')))
      fail('PROPERTY_CLIENT_ACTION','Keep the original key, workspace_id and expected_revision in every property change.',{action,key:payload.key??null});
    const result=await request('/api/action',{action,payload},requestOptions,action);
    if(!plain(result)||!plain(result.state)||!Object.hasOwn(result,'result'))
      fail('PROPERTY_CLIENT_RESULT','The original action response is incomplete.',{action,key:payload.key??null,uncertain:!READS.has(action),result});
    try{checkState(result.state);}catch(cause){fail('PROPERTY_CLIENT_WORKSPACE_CHANGED','The returned action belongs to another workspace.',{action,key:payload.key??null,uncertain:!READS.has(action),result,cause});}
    return result;
  }
  async function prepare(action,input,{key=randomUUID(),signal}={}) {
    if(!WRITES.has(action)||!plain(input)||!KEY.test(key))fail('PROPERTY_CLIENT_PREPARED','Select an original property change and retain one request key.');
    if(['key','workspace_id','expected_revision'].some(k=>Object.hasOwn(input,k)))
      fail('PROPERTY_CLIENT_PREPARED','Preparation fills the original revision fields. Resume an existing envelope without preparing it again.');
    const state=await status({signal});
    const payload={...copy(input),key,workspace_id:state.property.id,expected_revision:state.property.revision};
    if(json({action,payload},'Native request').length>PROPERTY_REQUEST_BYTES)fail('PROPERTY_CLIENT_REQUEST_LIMIT','The original native request exceeds 512 KiB.');
    return immutable({schema:PROPERTY_CLIENT_SCHEMA,createdAt:state.createdAt,action,payload,inputSha256:sha(json(payload,'Prepared payload'))});
  }
  async function inspectPrepared(value,requestOptions) {
    prepared(value);
    const state=await status(requestOptions);
    if(value.createdAt!==state.createdAt)fail('PROPERTY_CLIENT_WORKSPACE_CHANGED','Reopen the original outer workspace for this saved request.');
    const observed=await act('property.operation',{key:value.payload.key},requestOptions);
    const operation=observed.result.operation;
    if(operation!==null&&(!plain(operation)||operation.action!==value.action||operation.input_sha256!==value.inputSha256))
      fail('PROPERTY_CLIENT_REQUEST_CONFLICT','The original key names a different complete native input.',{action:value.action,key:value.payload.key,result:observed});
    const sameRevision=observed.state.property.id===value.payload.workspace_id&&observed.state.property.revision===value.payload.expected_revision;
    return {prepared:copy(value),state:observed.state,operation:operation===null?null:copy(operation),
      disposition:operation?.state==='DONE'?'DONE':operation?'ISSUED':sameRevision?'ABSENT_AT_ORIGINAL_REVISION':'ABSENT_AFTER_CHANGE'};
  }
  async function invoke(value,{signal,resumeIssued=false}={}) {
    const observed=await inspectPrepared(value,{signal});
    if(observed.disposition==='DONE')return {state:observed.state,result:copy(observed.operation.result),reused:true,operation:observed.operation};
    if(observed.disposition==='ABSENT_AFTER_CHANGE')fail('PROPERTY_CLIENT_REVISION','The original request was not found and its reviewed workspace changed. Keep this request and review current state.',{action:value.action,key:value.payload.key,result:observed});
    if(observed.disposition==='ISSUED'&&!(resumeIssued&&value.action==='property.request.run'))
      fail('PROPERTY_CLIENT_RECONCILIATION','Inspect the original issued request. Only an explicit same-key native run recovery can continue an issued run.',{action:value.action,key:value.payload.key,uncertain:true,result:observed});
    return act(value.action,value.payload,{signal});
  }
  async function selectFile(selection,requestOptions) {
    if(!plain(selection))fail('PROPERTY_CLIENT_FILE','Choose an original file selection.');
    const state=await status(requestOptions);
    let descriptor,path;
    if(selection.kind==='property') {
      const file=safeFile(selection.file);descriptor=state.property.files.find(f=>f.file===file);
      if(!descriptor)fail('PROPERTY_CLIENT_FILE_NOT_FOUND','The selected original property file is absent.');
      path='/api/property/file?'+new URLSearchParams({file});
      descriptor={...copy(descriptor),name:file.split('/').at(-1)};
    }else if(selection.kind==='source-export'){
      if(!KEY.test(selection.exportId??'')||typeof selection.name!=='string'||selection.name.includes('/')||selection.name.includes('\\'))
        fail('PROPERTY_CLIENT_FILE','Choose an existing source export and exact member.');
      descriptor=state.exports.find(e=>e.id===selection.exportId)?.files?.find(f=>f.name===selection.name);
      if(!descriptor)fail('PROPERTY_CLIENT_FILE_NOT_FOUND','The selected original export member is absent.');
      path='/api/exports/'+encodeURIComponent(selection.exportId)+'/'+encodeURIComponent(selection.name);
    }else fail('PROPERTY_CLIENT_FILE','Use property or source-export for a manifest-declared file.');
    fileIdentity(descriptor);
    if(selection.sha256!==undefined&&selection.sha256!==descriptor.sha256||selection.bytes!==undefined&&selection.bytes!==descriptor.bytes)
      fail('PROPERTY_CLIENT_FILE_CHANGED','The native file differs from the reviewed original descriptor.');
    return {selection:copy(selection),createdAt:state.createdAt,propertyId:state.property.id,descriptor:copy(descriptor),path};
  }
  async function receiveFile(selection,{signal,onChunk}={}) {
    if(typeof onChunk!=='function')fail('PROPERTY_CLIENT_FILE','Supply a receiver for every original byte chunk.');
    const selected=await selectFile(selection,{signal});
    const receipt=await raw(selected.path,{signal,maximum:Math.max(selected.descriptor.bytes,1024*1024),onChunk});
    if(receipt.status<200||receipt.status>=300)throw responseError(receipt);
    if(receipt.bytes!==selected.descriptor.bytes||receipt.sha256!==selected.descriptor.sha256)
      fail('PROPERTY_CLIENT_FILE_CHANGED','The complete native file does not match its original manifest.',{result:{...selected,receipt:{bytes:receipt.bytes,sha256:receipt.sha256}}});
    return {createdAt:selected.createdAt,propertyId:selected.propertyId,selection:selected.selection,descriptor:selected.descriptor,bytes:receipt.bytes,sha256:receipt.sha256};
  }
  async function readFile(selection,requestOptions) {
    const chunks=[];const receipt=await receiveFile(selection,{...options(requestOptions),onChunk:chunk=>{chunks.push(Buffer.from(chunk));}});
    return {...receipt,data:Buffer.concat(chunks)};
  }
  async function receivePublisherFile({resourceId=null,kind,id,bytes,sha256:expectedSha},{signal,onChunk}={}) {
    if(!PROPERTY_FILE_KINDS.includes(kind)||typeof id!=='string'||!id||id.length>512||/[\u0000-\u001f\u007f]/.test(id)||
      resourceId!==null&&!KEY.test(resourceId)||typeof onChunk!=='function')
      fail('PROPERTY_CLIENT_PUBLISHER_FILE','Use the original resource, native file kind, retained ID and complete byte receiver.');
    if(bytes!==undefined||expectedSha!==undefined)fileIdentity({bytes,sha256:expectedSha});
    const state=await status({signal});
    const path=resourceId===null?'/api/publisher/exports/':'/api/property/publisher/exports/'+encodeURIComponent(resourceId)+'/';
    const receipt=await raw(path+encodeURIComponent(kind)+'/'+encodeURIComponent(id),
      {signal,maximum:bytes===undefined?PROPERTY_FILE_BYTES:Math.max(bytes,1024*1024),onChunk});
    if(receipt.status<200||receipt.status>=300)throw responseError(receipt);
    if(bytes!==undefined&&(receipt.bytes!==bytes||receipt.sha256!==expectedSha))
      fail('PROPERTY_CLIENT_FILE_CHANGED','The original publisher result differs from the reviewed complete bytes.');
    return {createdAt:state.createdAt,resourceId,kind,id,name:kind+'-'+id.replace(/[^A-Za-z0-9._-]/g,'_'),
      bytes:receipt.bytes,sha256:receipt.sha256,type:receipt.headers['content-type']??'application/octet-stream'};
  }
  async function readPublisherFile(selection,requestOptions) {
    const chunks=[],receipt=await receivePublisherFile(selection,
      {...options(requestOptions),onChunk:chunk=>{chunks.push(Buffer.from(chunk));}});
    return {...receipt,data:Buffer.concat(chunks)};
  }
  async function close({abortReads=false}={}) {
    closing=true;
    if(abortReads)for(const value of active.values())if(!value.mutating)value.request()?.destroy(new Error('Borrowed client read closed.'));
    await Promise.allSettled([...active].flatMap(([job,value])=>[job,value.closed]));
  }
  return Object.freeze({origin,get createdAt(){return createdAt},get propertyId(){return propertyId},
    status,act,prepare,inspectPrepared,invoke,selectFile,receiveFile,readFile,receivePublisherFile,readPublisherFile,close,
    record:(group,id,requestOptions)=>act('property.get',{group,id},requestOptions),
    operation:(key,requestOptions)=>act('property.operation',{key},requestOptions)});
}
