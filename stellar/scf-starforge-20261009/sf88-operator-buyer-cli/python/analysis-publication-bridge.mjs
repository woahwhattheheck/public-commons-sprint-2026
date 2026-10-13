// SPDX-License-Identifier: MIT
// Analysis owns its request; the original Frictionless workbench owns native work.
import {constants} from 'node:fs';
import {open, lstat, realpath} from 'node:fs/promises';
import {isAbsolute, resolve, dirname, basename} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {openFrictionlessClient} from '../../../../stellar-forge/mcp-merchant-operator/frictionless-workspace-client.mjs';
import {openMerchantFileClient} from '../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs';

const SCHEMA='stellar-forge.analysis-publication-bridge.v1';
const MODE='ANALYSIS_PUBLICATION_BRIDGE';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/, ID=/^[a-f0-9]{32}$/, ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const REQUEST_BYTES=2*1024*1024, REPLY_BYTES=8*1024*1024, DESCRIPTOR_BYTES=16*1024*1024;
const RESOURCE_BYTES=256*1024*1024, EXPORT_BYTES=512*1024*1024;
const READ={
 status:[[],['limit','capturesOffset','editionsOffset','operationsOffset']],
 input:[[],[]],current:[[],[]],request:[['requestId'],[]],
 capture:[['captureId'],['section','resource','offset','limit']],
 edition:[['editionId'],[]],review:[['reviewId'],[]],
 'plan-input':[['editionId','query'],[]],
 'publisher-status':[[],['limit','plansOffset','runsOffset','historyOffset']],
 'publisher-target':[[],[]],
 'publisher-inspect':[['planRequestId','runId'],['query']],
 'inspect-export':[['requestId'],[]]
};
const ACTION={
 open:[[],[]],intake:[['expectedVersion','label'],[]],
 edition:[['expectedVersion','captureId','label'],[]],
 'review-edition':[['expectedVersion','editionId','reviewer','note'],[]],
 select:[['expectedVersion','editionId','reviewId','expectedSourceHash'],[]],
 plan:[['expectedVersion','editionId','reviewId','plan'],[]],
 export:[['expectedVersion','editionId','label'],['reviewId']],
 cancel:[['operationId'],[]],resume:[['requestId'],[]],
 'publisher-extract':[['planRequestId'],[]],
 'publisher-review':[['planRequestId','runId','candidateDigest','reviewer','note'],['initialize','expectedSnapshot','expectedRevision']],
 'publisher-publish':[['planRequestId','runId','reviewId'],[]],
 'publisher-recover':[['planRequestId','runId'],[]],
 'publisher-cancel':[['planRequestId','runId'],[]],
 'download-export':[['requestId','expected_source_hash','directory'],[]]
};
const NO_PACKAGE=new Set(['open','status','input','current','publisher-status','publisher-target']);
const SOURCE_KINDS=new Set(['intake','edition','review','select','plan','export','cancel']);
const STATES=new Set(['PREPARED','RUNNING','COMPLETE','FAILED','CANCELLED','INTERRUPTED']);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const issue=(code,extras={})=>Object.assign(new Error(code),{code,...extras});
function need(value,code){if(!value)throw issue(code);}
function exact(value,required,optional=[],code='REQUEST_FIELDS_INVALID'){
 need(plain(value),code);const keys=Object.keys(value),allowed=new Set([...required,...optional]);
 need(required.every(k=>Object.hasOwn(value,k))&&keys.every(k=>allowed.has(k)),code);
}
function textValue(value,maximum,code='TEXT_INVALID'){
 need(typeof value==='string'&&value.trim()&&value.length<=maximum&&!/[\u0000-\u001f\u007f]/.test(value),code);return value;
}
function nativeId(value){need(typeof value==='string'&&UUID.test(value),'NATIVE_ID_INVALID');return value;}
function hash(value){need(typeof value==='string'&&SHA.test(value),'HASH_INVALID');return value;}
function count(value,maximum=Number.MAX_SAFE_INTEGER,minimum=0){
 need(Number.isSafeInteger(value)&&value>=minimum&&value<=maximum,'NATIVE_REVISION_INVALID');return value;
}
function stableNativeId(workspace,id){
 const bytes=createHash('sha256').update('analysis-dataset-source-v1/'+workspace+'/'+id).digest().subarray(0,16);
 bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const raw=bytes.toString('hex');return raw.slice(0,8)+'-'+raw.slice(8,12)+'-'+raw.slice(12,16)+'-'+raw.slice(16,20)+'-'+raw.slice(20);
}
function privatePath(path){need(typeof path==='string'&&isAbsolute(path)&&path===resolve(path)&&!path.includes('\0'),'PRIVATE_PATH_REQUIRED');return path;}
function fileIdentity(a,b){
 return ['dev','ino','mode','uid','gid','nlink','size','mtimeNs','ctimeNs'].every(k=>a[k]===b[k]);
}
function privateRegular(info,maximum){
 need(info.isFile()&&info.nlink===1n&&(info.mode&0o077n)===0n&&
   (typeof process.getuid!=='function'||info.uid===BigInt(process.getuid()))&&
   info.size>=0n&&info.size<=BigInt(maximum),'PRIVATE_FILE_REQUIRED');
}
async function verifiedFile(path,{maximum,expected,collect=false,signal}){
 privatePath(path);signal.throwIfAborted();
 need(await realpath(path)===path,'PRIVATE_PATH_REQUIRED');
 const fd=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
 try{
  const before=await fd.stat({bigint:true});privateRegular(before,maximum);
  const entry=await lstat(path,{bigint:true});need(!entry.isSymbolicLink()&&fileIdentity(before,entry),'PRIVATE_FILE_CHANGED');
  if(expected)need(before.size===BigInt(expected.bytes),'PACKAGE_FILE_CHANGED');
  const checksum=createHash('sha256'),buffer=Buffer.alloc(1024*1024),parts=[];let total=0;
  for(;;){
   signal.throwIfAborted();const read=await fd.read(buffer,0,buffer.length,total);if(!read.bytesRead)break;
   total+=read.bytesRead;need(total<=maximum&&(!expected||total<=expected.bytes),'PACKAGE_FILE_CHANGED');
   const chunk=buffer.subarray(0,read.bytesRead);checksum.update(chunk);if(collect)parts.push(Buffer.from(chunk));
  }
  signal.throwIfAborted();
  const after=await fd.stat({bigint:true}),current=await lstat(path,{bigint:true});
  privateRegular(after,maximum);
  need(!current.isSymbolicLink()&&fileIdentity(before,after)&&fileIdentity(after,current)&&BigInt(total)===before.size&&
   await realpath(path)===path,'PRIVATE_FILE_CHANGED');
  const sha256=checksum.digest('hex');
  if(expected)need(total===expected.bytes&&sha256===expected.sha256,'PACKAGE_FILE_CHANGED');
  return {bytes:total,sha256,...(collect?{raw:Buffer.concat(parts,total)}:{})};
 }finally{await fd.close();}
}
function jsonBytes(raw,code){
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw issue(code);}
}
function validateArguments(action,args){
 const reading=Object.hasOwn(READ,action)&&(action!=='edition'||Object.hasOwn(args??{},'editionId'));
 const definition=(reading?READ:ACTION)[action];need(definition,'SOURCE_ACTION_INVALID');
 exact(args,...definition);need(Buffer.byteLength(JSON.stringify(args))<=1024*1024,'REQUEST_TOO_LARGE');
 for(const [key,value]of Object.entries(args)){
  if(['requestId','captureId','editionId','reviewId','operationId','planRequestId','runId'].includes(key))nativeId(value);
  if(['expectedSourceHash','candidateDigest','expected_source_hash'].includes(key))hash(value);
  if(['expectedVersion','expectedRevision','offset','limit','capturesOffset','editionsOffset','operationsOffset','plansOffset','runsOffset','historyOffset'].includes(key))count(value);
  if(key==='limit')count(value,100,1);
  if(key==='label')textValue(value,160);
  if(key==='reviewer')textValue(value,action==='review-edition'?80:128);
  if(key==='note')textValue(value,2000);
  if(key==='initialize')need(typeof value==='boolean','TARGET_DECISION_INVALID');
  if(key==='section')need(['overview','resource','files','queries'].includes(value),'SECTION_INVALID');
  if(key==='resource')textValue(value,128,'RESOURCE_INVALID');
  if(key==='query'){
   if(action==='plan-input')textValue(value,8192,'QUERY_INVALID');
   else need(typeof value==='string'&&value.length<=8192&&!/[\u0000-\u001f\u007f]/.test(value),'QUERY_INVALID');
  }
  if(key==='expectedSnapshot')textValue(value,256,'TARGET_DECISION_INVALID');
  if(key==='plan')need(plain(value),'PLAN_INVALID');
  if(key==='directory')privatePath(value);
 }
 if(action==='publisher-review'&&args.initialize!==true)
  need(typeof args.expectedSnapshot==='string'&&Number.isSafeInteger(args.expectedRevision),'TARGET_DECISION_REQUIRED');
 if(action==='capture'&&args.section==='resource')need(typeof args.resource==='string','RESOURCE_REQUIRED');
 return reading;
}
function validateRequest(value){
 exact(value,['schema','id','workspace_id','action','connection','reviewed_endpoint','native_request_id','args','allow_dispatch'],['package']);
 need(value.schema===SCHEMA&&ID.test(value.id??'')&&ID.test(value.workspace_id??''),'REQUEST_ID_INVALID');
 nativeId(value.native_request_id);need(value.native_request_id===stableNativeId(value.workspace_id,value.id),'NATIVE_ID_CHANGED');
 need(typeof value.allow_dispatch==='boolean','DISPATCH_DECISION_REQUIRED');
 const c=value.connection;exact(c,['name','url','token_file','workspace','workspace_id','publisher','input','timeout_ms']);
 for(const key of ['name','workspace','publisher','input'])need(typeof c[key]==='string'&&ALIAS.test(c[key]),'CONNECTION_ALIAS_INVALID');
 nativeId(c.workspace_id);privatePath(c.token_file);count(c.timeout_ms,300000,1000);
 need(typeof c.url==='string'&&c.url.length<=4096&&value.reviewed_endpoint===c.url,'REVIEWED_CONNECTION_CHANGED');
 let endpoint;try{endpoint=new URL(c.url);}catch{throw issue('CONNECTION_URL_INVALID');}
 need(endpoint.href===c.url&&!endpoint.username&&!endpoint.password&&!endpoint.search&&!endpoint.hash&&
   (endpoint.protocol==='https:'||endpoint.protocol==='http:'&&['127.0.0.1','[::1]'].includes(endpoint.hostname)),'CONNECTION_URL_INVALID');
 const reading=validateArguments(value.action,value.args);
 const pkg=value.package??null;
 need(NO_PACKAGE.has(value.action)||pkg!==null,'PACKAGE_REQUIRED');
 if(pkg!==null){
  exact(pkg,['job_id','index_sha256','descriptor','resource','resource_name','queries_text']);
  need(ID.test(pkg.job_id??''),'PACKAGE_ID_INVALID');hash(pkg.index_sha256);
  for(const [key,maximum]of [['descriptor',DESCRIPTOR_BYTES],['resource',RESOURCE_BYTES]]){
   exact(pkg[key],['path','bytes','sha256']);privatePath(pkg[key].path);count(pkg[key].bytes,maximum);hash(pkg[key].sha256);
  }
  need(pkg.descriptor.path!==pkg.resource.path&&dirname(pkg.descriptor.path)===dirname(pkg.resource.path)&&
    basename(pkg.descriptor.path)==='datapackage.json'&&basename(pkg.resource.path)==='data.json','PACKAGE_PATHS_CHANGED');
  textValue(pkg.resource_name,128,'RESOURCE_INVALID');
  need(typeof pkg.queries_text==='string'&&Buffer.byteLength(pkg.queries_text)<=1024*1024,'QUERY_TEXT_INVALID');
  const queries=jsonBytes(Buffer.from(pkg.queries_text),'QUERY_TEXT_INVALID');need(plain(queries)&&Object.keys(queries).length>0,'QUERY_TEXT_INVALID');
  for(const q of Object.values(queries))need(plain(q)&&q.resource===pkg.resource_name&&plain(q.projection),'QUERY_PACKAGE_CHANGED');
 }
 return {request:value,connection:c,package:pkg,reading};
}
async function verifyPackage(pkg,signal){
 const descriptor=await verifiedFile(pkg.descriptor.path,{maximum:DESCRIPTOR_BYTES,expected:pkg.descriptor,collect:true,signal});
 await verifiedFile(pkg.resource.path,{maximum:RESOURCE_BYTES,expected:pkg.resource,signal});
 const document=jsonBytes(descriptor.raw,'PACKAGE_DESCRIPTOR_INVALID');
 need(plain(document)&&Array.isArray(document.resources)&&document.resources.length===1,'PACKAGE_DESCRIPTOR_INVALID');
 const resource=document.resources[0];
 need(plain(resource)&&resource.name===pkg.resource_name&&resource.path==='data.json','PACKAGE_RESOURCE_CHANGED');
 // Parsing and interpreting the full descriptor remains the original parser's job.
 return JSON.parse(pkg.queries_text);
}

function safeCode(error){
 const code=typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{0,127}$/.test(error.code)?error.code:
  error?.name==='AbortError'?'ANALYSIS_PUBLICATION_CANCELLED':error?.name==='TimeoutError'?'ANALYSIS_PUBLICATION_TIMEOUT':'ANALYSIS_PUBLICATION_BRIDGE_FAILED';
 return code;
}
function safeIdentity(request){
 const result={mode:MODE,id:ID.test(request?.id??'')?request.id:null,
  workspace_id:ID.test(request?.workspace_id??'')?request.workspace_id:null,
  package_id:ID.test(request?.package?.job_id??'')?request.package.job_id:null,
  index_sha256:SHA.test(request?.package?.index_sha256??'')?request.package.index_sha256:null,
  action:typeof request?.action==='string'&&Object.hasOwn({...READ,...ACTION},request.action)?request.action:null,
  native_request_id:UUID.test(request?.native_request_id??'')?request.native_request_id:null};
 return result;
}
export async function runAnalysisPublicationBridge(request,{controller=new AbortController()}={}){
 const signal=controller.signal,identity=safeIdentity(request);
 let dispatchStarted=false,mutationRejected=false,binding=null,timeout,connectionView=null;
 const mutate=async fn=>{
  signal.throwIfAborted();dispatchStarted=true;
  try{return await fn();}
  catch(error){mutationRejected=error?.applied===false;throw error;}
 };
 try{
  const selected=validateRequest(request),c=selected.connection,pkg=selected.package,a=request.args;
  timeout=setTimeout(()=>controller.abort(issue('ANALYSIS_PUBLICATION_TIMEOUT')),c.timeout_ms);timeout.unref?.();
  connectionView={name:c.name,endpoint:c.url,workspace:c.workspace,workspace_id:c.workspace_id,publisher:c.publisher,input:c.input};
  signal.throwIfAborted();
  const queries=pkg?await verifyPackage(pkg,signal):null;
  if(pkg)binding={descriptorSha256:pkg.descriptor.sha256,resourceName:pkg.resource_name,
   resourceSha256:pkg.resource.sha256,resourceBytes:pkg.resource.bytes};
  const tokenFile=await verifiedFile(c.token_file,{maximum:64*1024,collect:true,signal});
  let token;try{token=new TextDecoder('utf-8',{fatal:true}).decode(tokenFile.raw).trim();}catch{throw issue('PRIVATE_TOKEN_INVALID');}
  need(token.length>=24&&!/[^\x21-\x7e]/.test(token),'PRIVATE_TOKEN_INVALID');
  const original=await openMerchantFileClient({url:c.url,tokenEnv:'ANALYSIS_PUBLICATION_TOKEN',
   environment:{ANALYSIS_PUBLICATION_TOKEN:token},signal,errorPrefix:'ANALYSIS_PUBLICATION',
   clientName:'starforge-analysis-publication',maximumResponseBytes:32*1024*1024});
  need(original.endpoint===c.url&&original.endpoint===request.reviewed_endpoint,'REVIEWED_CONNECTION_CHANGED');
  // This is a deadline wrapper around the original client, not another transport.
  const transport={endpoint:original.endpoint,call:(name,args,options={})=>original.call(name,args,
   {...options,requestSignal:options.requestSignal===null?null:signal,
    timeoutMs:Math.min(options.timeoutMs??c.timeout_ms,c.timeout_ms)})};
  const client=await openFrictionlessClient({workspace:c.workspace,workspaceId:c.workspace_id,client:transport,signal});
  function statusBinding(value){
   need(plain(value)&&value.workspace===c.workspace&&value.workspaceId===c.workspace_id&&
    value.publisher===c.publisher&&value.state==='OPEN'&&value.native?.workspaceId===c.workspace_id&&
    value.native.publisher?.sourceName==='Frictionless Data Package','NATIVE_WORKSPACE_CHANGED');
   return value;
  }
  const pub=(action,args={})=>transport.call('merchant_publisher_'+action,{publisher:c.publisher,...args});
  const captures=new Map(),editions=new Map(),reviews=new Map();
  function captureSummary(value,id){
   const record=value?.capture;
   need(plain(record)&&record.id===id&&record.descriptorSha256===pkg.descriptor.sha256&&SHA.test(record.captureSha256??''),'NATIVE_CAPTURE_CHANGED');
   return record;
  }
  async function bindCapture(id){
   nativeId(id);if(captures.has(id))return captures.get(id);
   const value=await client.capture(id),capture=captureSummary(value,id);
   let offset=0,total=null,matched=false,received=0;const names=new Set();
   for(;;){
    const page=await client.capture(id,{section:'files',offset,limit:100});
    const current=captureSummary(page,id);need(current.captureSha256===capture.captureSha256,'NATIVE_CAPTURE_CHANGED');
    need(Array.isArray(page.items)&&page.items.length<=100&&page.offset===offset&&
     Number.isSafeInteger(page.total)&&page.total>=0&&page.total<=10000&&
     (total===null||page.total===total),'NATIVE_CAPTURE_PAGE_CHANGED');
    total=page.total;
    for(const file of page.items){
     need(plain(file)&&typeof file.name==='string'&&!names.has(file.name)&&Number.isSafeInteger(file.bytes)&&
      file.bytes>=0&&SHA.test(file.sha256??''),'NATIVE_CAPTURE_FILE_CHANGED');
     names.add(file.name);received++;
     if(file.sha256===pkg.resource.sha256&&file.bytes===pkg.resource.bytes)matched=true;
    }
    if(page.next===null){need(received===total,'NATIVE_CAPTURE_PAGE_CHANGED');break;}
    need(Number.isSafeInteger(page.next)&&page.next===offset+page.items.length&&page.next>offset&&page.next<total,'NATIVE_CAPTURE_PAGE_CHANGED');
    offset=page.next;
   }
   need(matched,'NATIVE_RESOURCE_CHANGED');
   const resource=await client.capture(id,{section:'resource',resource:pkg.resource_name});
   need(captureSummary(resource,id).captureSha256===capture.captureSha256&&resource.resource?.name===pkg.resource_name,'NATIVE_RESOURCE_CHANGED');
   const observed={captureId:id,captureSha256:capture.captureSha256,descriptorSha256:capture.descriptorSha256};
   Object.assign(binding,observed);const result={value,capture,resource,observed};captures.set(id,result);return result;
  }
  async function bindEdition(id){
   nativeId(id);if(editions.has(id))return editions.get(id);
   const value=await client.edition(id),edition=value?.edition;
   need(plain(edition)&&edition.id===id&&UUID.test(edition.captureId??'')&&SHA.test(edition.sourceHash??''),'NATIVE_EDITION_CHANGED');
   const captured=await bindCapture(edition.captureId);
   need(edition.captureSha256===captured.capture.captureSha256&&
    JSON.stringify(value.queries)===JSON.stringify(queries)&&typeof value.queriesText==='string','NATIVE_EDITION_CHANGED');
   let originalQueries;try{originalQueries=JSON.parse(value.queriesText);}catch{throw issue('NATIVE_QUERY_TEXT_CHANGED');}
   need(JSON.stringify(originalQueries)===JSON.stringify(queries),'NATIVE_QUERY_PROJECTION_CHANGED');
   Object.assign(binding,captured.observed,{editionId:id,sourceHash:edition.sourceHash});
   const result={value,edition,captured};editions.set(id,result);return result;
  }
  async function bindReview(id,{editionId,ready=false}={}){
   nativeId(id);let selected=reviews.get(id);
   if(!selected){
    const value=await client.review(id);need(plain(value)&&value.id===id&&UUID.test(value.editionId??''),'NATIVE_REVIEW_CHANGED');
    const edition=await bindEdition(value.editionId);
    need(value.sourceHash===edition.edition.sourceHash,'NATIVE_REVIEW_CHANGED');
    selected={value,edition};reviews.set(id,selected);
   }
   need((editionId===undefined||selected.value.editionId===editionId)&&(!ready||selected.value.ready===true),'NATIVE_REVIEW_CHANGED');
   Object.assign(binding,{editionId:selected.value.editionId,sourceHash:selected.value.sourceHash,reviewId:id});
   return selected;
  }
  function requestShape(value,id){
   need(plain(value)&&value.id===id&&SOURCE_KINDS.has(value.kind)&&STATES.has(value.state)&&plain(value.input)&&
    value.input.workspaceId===c.workspace_id&&value.input.requestId===id,'NATIVE_REQUEST_CHANGED');
   return value;
  }
  async function inspectOperation(id){
   nativeId(id);return requestShape(await client.request(id,'inspect'),id);
  }
  async function maybeOperation(id){
   try{return await inspectOperation(id);}catch(error){if(error.code==='FRICTIONLESS_RECORD_NOT_FOUND')return null;throw error;}
  }
  async function bindInput(kind,input,visited=new Set()){
   const action=kind==='review'?'review-edition':kind;
   need(SOURCE_KINDS.has(kind),'NATIVE_REQUEST_KIND_CHANGED');
   const [required,optional]=ACTION[action];
   let nativeRequired=[...required],nativeOptional=[...optional];
   if(kind==='intake')nativeRequired.push('input','expectedSha256');
   if(kind==='edition')nativeRequired.push('queriesText');
   exact(input,['requestId','workspaceId',...nativeRequired],nativeOptional,'NATIVE_REQUEST_INPUT_CHANGED');
   nativeId(input.requestId);need(input.workspaceId===c.workspace_id,'NATIVE_WORKSPACE_CHANGED');
   if(kind==='intake'){
    need(input.input===c.input&&input.expectedSha256===pkg.descriptor.sha256,'NATIVE_REQUEST_INPUT_CHANGED');
   }else if(kind==='edition'){
    await bindCapture(input.captureId);
    need(typeof input.queriesText==='string'&&input.queriesText===pkg.queries_text,'NATIVE_QUERY_PROJECTION_CHANGED');
   }else if(kind==='cancel'){
    need(visited.size<16&&!visited.has(input.operationId),'NATIVE_REQUEST_CYCLE');
    const next=new Set(visited);next.add(input.operationId);
    await bindOperation(await inspectOperation(input.operationId),input.operationId,next);
   }else{
    const selected=await bindEdition(input.editionId);
    if(['select','plan'].includes(kind)||kind==='export'&&input.reviewId!==undefined)
     await bindReview(input.reviewId,{editionId:input.editionId,ready:true});
    if(kind==='plan')need(plain(input.plan)&&input.plan.sourceHash===selected.edition.sourceHash,'NATIVE_PLAN_SOURCE_CHANGED');
   }
  }
  function exportFiles(op){
   const result=op.result;
   need(op.kind==='export'&&op.state==='COMPLETE'&&plain(result)&&
    result.schema==='stellar-forge.frictionless-workbench-export.v1'&&result.exportId===op.id&&
    result.workspaceId===c.workspace_id&&result.editionId===op.input.editionId&&
    result.sourceHash===binding.sourceHash&&result.captureSha256===binding.captureSha256&&
    Array.isArray(result.files)&&result.files.length>=4&&result.files.length<10000&&
    result.manifestFile?.name==='manifest.json','NATIVE_EXPORT_CHANGED');
   const files=[result.manifestFile,...result.files],names=new Set();let total=0,declared=0;
   for(const file of files){
    need(plain(file)&&typeof file.name==='string'&&file.name.length<=512&&!/^[\/]/.test(file.name)&&
     !/[\\:\u0000-\u001f\u007f]/.test(file.name)&&file.name.split('/').every(p=>p&&p!=='.'&&p!=='..')&&
     !names.has(file.name)&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=RESOURCE_BYTES&&
     SHA.test(file.sha256??''),'NATIVE_EXPORT_FILE_CHANGED');
    names.add(file.name);total+=file.bytes;if(file!==result.manifestFile)declared+=file.bytes;
   }
   need(total<=EXPORT_BYTES&&declared===result.totalBytes&&
    ['manifest.json','source.tar.gz','source-edition.json','capture-inspection.json','RECEIVING.md'].every(n=>names.has(n)),'NATIVE_EXPORT_CHANGED');
   binding.files=files.map(file=>({name:file.name,bytes:file.bytes,sha256:file.sha256,
    ...(typeof file.mime==='string'?{mime:file.mime}:{})}));
   binding.exportId=op.id;binding.nativeManifestSha256=result.manifestFile.sha256;
   return result;
  }
  async function bindOperation(value,id,visited=new Set([id])){
   const op=requestShape(value,id);await bindInput(op.kind,op.input,visited);
   if(op.state==='COMPLETE'){
    need(plain(op.result),'NATIVE_REQUEST_RESULT_CHANGED');
    if(op.kind==='intake'){
     need(op.result.captureId===id,'NATIVE_CAPTURE_CHANGED');await bindCapture(id);
    }else if(op.kind==='edition'){
     need(op.result.editionId===id,'NATIVE_EDITION_CHANGED');
     const edition=await bindEdition(id);
     need(edition.edition.captureId===op.input.captureId&&op.result.sourceHash===edition.edition.sourceHash,'NATIVE_EDITION_CHANGED');
    }else if(op.kind==='review'){
     need(op.result.reviewId===id&&op.result.editionId===op.input.editionId,'NATIVE_REVIEW_CHANGED');
     await bindReview(id,{editionId:op.input.editionId});
    }else if(op.kind==='plan'){
     need(op.result.editionId===op.input.editionId&&op.result.reviewId===op.input.reviewId&&
      op.result.sourceHash===binding.sourceHash&&Number.isSafeInteger(op.result.planId)&&op.result.planId>0&&
      SHA.test(op.result.planDigest??''),'NATIVE_PLAN_CHANGED');
    }else if(op.kind==='export')exportFiles(op);
    else if(op.kind==='select')need(op.result.editionId===op.input.editionId&&op.result.reviewId===op.input.reviewId&&op.result.sourceHash===binding.sourceHash,'NATIVE_SELECTION_CHANGED');
    else if(op.kind==='cancel')need(op.result.operationId===op.input.operationId,'NATIVE_CANCEL_CHANGED');
   }
   return op;
  }
  async function bindPlan(id){
   const op=await bindOperation(await inspectOperation(id),id);
   need(op.kind==='plan'&&op.state==='COMPLETE','NATIVE_PLAN_NOT_COMPLETE');
   Object.assign(binding,{planRequestId:id,planId:op.result.planId,planDigest:op.result.planDigest,sourceHash:op.result.sourceHash});
   return op;
  }
  function runBinding(value,runId,plan){
   const run=value?.run,actualPlan=value?.plan;
   need(plain(run)&&run.id===runId&&run.plan===plan.result.planId&&plain(run.data)&&
    run.data.planDigest===plan.result.planDigest&&plain(actualPlan)&&actualPlan.id===plan.result.planId&&
    actualPlan.data?.digest===plan.result.planDigest&&actualPlan.data.sourceHash===plan.result.sourceHash,'NATIVE_PUBLISHER_PLAN_CHANGED');
   if(run.data.candidate)need(run.data.candidate.sourceHash===plan.result.sourceHash&&
    run.data.candidate.planDigest===plan.result.planDigest&&SHA.test(run.data.candidate.candidateDigest??''),'NATIVE_CANDIDATE_CHANGED');
   Object.assign(binding,{runId,planRequestId:plan.id,planId:plan.result.planId,planDigest:plan.result.planDigest,
    ...(run.data.candidate?{candidateDigest:run.data.candidate.candidateDigest}:{})});
   return value;
  }
  async function inspectRun(runId,plan,query){
   nativeId(runId);
   return runBinding(await pub('inspect',{runId,...(query!==undefined?{query}:{})}),runId,plan);
  }
  function verifyRunRow(run,runId,plan){
   need(plain(run)&&run.id===runId&&run.plan===plan.result.planId&&run.data?.planDigest===plan.result.planDigest,'NATIVE_PUBLISHER_RESULT_CHANGED');
   if(run.data.candidate)need(run.data.candidate.sourceHash===plan.result.sourceHash&&
    run.data.candidate.planDigest===plan.result.planDigest&&SHA.test(run.data.candidate.candidateDigest??''),'NATIVE_CANDIDATE_CHANGED');
   return run;
  }
  function matchingReview(run,args){
   const review=run.data?.review,target=review?.target;
   return plain(review)&&UUID.test(review.id??'')&&review.candidateDigest===args.candidateDigest&&
    review.reviewer===args.reviewer.trim()&&review.note===args.note.trim()&&plain(target)&&
    (args.initialize===true?target.mode==='initialize':
     target.mode==='refresh'&&target.expectedSnapshot===args.expectedSnapshot&&target.expectedRevision===args.expectedRevision);
  }

  let result,replayed=false,reconciled=false;
  if(request.action==='open'){
   if(request.allow_dispatch)result=statusBinding(await mutate(()=>client.open()));
   else{
    // A lost open reply can be recovered by observing the exact original workspace.
    const observed=await client.status({limit:1});
    need(plain(observed)&&observed.workspace===c.workspace&&observed.publisher===c.publisher,'NATIVE_WORKSPACE_CHANGED');
    need(observed.state==='OPEN','NATIVE_OPEN_OUTCOME_UNKNOWN');
    result=statusBinding(observed);replayed=true;reconciled=true;
   }
  }else{
   const status=statusBinding(await client.status(request.action==='status'?a:{limit:1}));
   if(selected.reading){
    switch(request.action){
     case 'status':result=status;break;
     case 'input':
      result=await client.input(c.input);
      if(pkg)need(result.input===c.input&&result.kind==='descriptor'&&result.expectedSha256Required===true&&
       result.sha256===pkg.descriptor.sha256&&result.bytes===pkg.descriptor.bytes,'NATIVE_INPUT_CHANGED');
      break;
     case 'current':result=await client.current();break;
     case 'request':result=await bindOperation(await inspectOperation(a.requestId),a.requestId);break;
     case 'capture':{
      await bindCapture(a.captureId);const {captureId,...page}=a;
      result=await client.capture(captureId,page);captureSummary(result,captureId);break;
     }
     case 'edition':result=(await bindEdition(a.editionId)).value;break;
     case 'review':result=(await bindReview(a.reviewId)).value;break;
     case 'plan-input':{
      const edition=await bindEdition(a.editionId);
      result=await client.planInput(a.editionId,a.query);
      need(result.editionId===a.editionId&&result.sourceHash===edition.edition.sourceHash&&
       result.plan?.sourceHash===edition.edition.sourceHash,'NATIVE_PLAN_INPUT_CHANGED');break;
     }
     case 'publisher-status':
      result=await pub('status',a);
      need(result.publisher===c.publisher&&result.sourceName==='Frictionless Data Package','NATIVE_PUBLISHER_CHANGED');break;
     case 'publisher-target':
      result=await pub('target');need(result.publisher===c.publisher,'NATIVE_PUBLISHER_CHANGED');break;
     case 'publisher-inspect':{
      const plan=await bindPlan(a.planRequestId);result=await inspectRun(a.runId,plan,a.query);break;
     }
     case 'inspect-export':
      result=await bindOperation(await client.inspectExport(a.requestId),a.requestId);
      need(result.kind==='export','NATIVE_EXPORT_CHANGED');break;
     default:throw issue('SOURCE_ACTION_INVALID');
    }
   }else if(['intake','edition','review-edition','select','plan','export','cancel'].includes(request.action)){
    const action=request.action,kind=action==='review-edition'?'review':action;
    let body={requestId:request.native_request_id,...a};
    if(action==='intake')body={requestId:request.native_request_id,expectedVersion:a.expectedVersion,
     input:c.input,expectedSha256:pkg.descriptor.sha256,label:a.label};
    if(action==='edition')body={requestId:request.native_request_id,expectedVersion:a.expectedVersion,
     captureId:a.captureId,label:a.label,queriesText:pkg.queries_text};
    const expected={...body,workspaceId:c.workspace_id};
    const previous=await maybeOperation(request.native_request_id);
    if(previous){
     need(previous.kind===kind&&isDeepStrictEqual(previous.input,expected),'NATIVE_REQUEST_INPUT_CHANGED');
     result=await bindOperation(previous,request.native_request_id);replayed=true;
    }else{
     need(request.allow_dispatch,'NATIVE_REQUEST_OUTCOME_UNKNOWN');
     await bindInput(kind,expected,new Set([request.native_request_id]));
     if(action==='intake'){
      const input=await client.input(c.input);
      need(input.input===c.input&&input.kind==='descriptor'&&input.expectedSha256Required===true&&
       input.sha256===pkg.descriptor.sha256&&input.bytes===pkg.descriptor.bytes,'NATIVE_INPUT_CHANGED');
     }
     const methods={intake:'intake',edition:'createEdition','review-edition':'reviewEdition',
      select:'select',plan:'savePlan',export:'export',cancel:'cancel'};
     result=await mutate(()=>client[methods[action]](body));
     const op=requestShape(result?.operation,request.native_request_id);
     need(op.kind===kind&&isDeepStrictEqual(op.input,expected),'NATIVE_REQUEST_INPUT_CHANGED');
     await bindOperation(op,request.native_request_id);
    }
   }else if(request.action==='resume'){
    const originalOperation=await bindOperation(await inspectOperation(a.requestId),a.requestId);
    need(originalOperation.kind!=='cancel','NATIVE_REQUEST_NOT_RESUMABLE');
    if(!request.allow_dispatch){
     need(['COMPLETE','RUNNING'].includes(originalOperation.state),'NATIVE_RESUME_OUTCOME_UNKNOWN');
     result=originalOperation;replayed=true;
    }else{
     result=await mutate(()=>client.request(a.requestId,'resume'));
     const op=requestShape(result?.operation,a.requestId);
     need(op.kind===originalOperation.kind&&isDeepStrictEqual(op.input,originalOperation.input),'NATIVE_REQUEST_INPUT_CHANGED');
     await bindOperation(op,a.requestId);
    }
   }else if(request.action==='download-export'){
    const op=await bindOperation(await inspectOperation(a.requestId),a.requestId);
    const exported=exportFiles(op);
    need(exported.sourceHash===a.expected_source_hash,'NATIVE_EXPORT_CHANGED');
    // Python selected this private destination; the original receiver owns its lease,
    // retained file manifests, prefix validation, release and complete-file hashes.
    privatePath(a.directory);const directory=await lstat(a.directory,{bigint:true});
    need(directory.isDirectory()&&!directory.isSymbolicLink()&&(directory.mode&0o077n)===0n&&
     (typeof process.getuid!=='function'||directory.uid===BigInt(process.getuid()))&&
     await realpath(a.directory)===a.directory,'PRIVATE_OUTPUT_DIRECTORY_REQUIRED');
    result=await client.downloadExport({exportId:a.requestId,directory:a.directory,signal});
    need(result.schema==='stellar-forge.frictionless-source-downloaded.v1'&&result.state==='COMPLETE'&&
     result.exportId===a.requestId&&result.directory===a.directory&&result.workspaceId===c.workspace_id&&
     result.editionId===exported.editionId&&result.sourceHash===exported.sourceHash&&
     result.captureSha256===exported.captureSha256&&result.nativeManifestSha256===exported.manifestFile.sha256&&
     result.files===binding.files.length&&result.bytes===binding.files.reduce((n,f)=>n+f.bytes,0),'NATIVE_EXPORT_RECEIVING_CHANGED');
   }else if(request.action==='publisher-extract'){
    const plan=await bindPlan(a.planRequestId);let previous;
    try{previous=await inspectRun(request.native_request_id,plan);}catch(error){if(error.code!=='RUN_NOT_FOUND')throw error;}
    if(previous){result=previous;replayed=true;}
    else{
     need(request.allow_dispatch,'NATIVE_EXTRACTION_OUTCOME_UNKNOWN');
     result=await mutate(()=>pub('extract',{runId:request.native_request_id,planId:plan.result.planId,planDigest:plan.result.planDigest}));
     verifyRunRow(result?.run,request.native_request_id,plan);
     binding.runId=request.native_request_id;
    }
   }else if(['publisher-review','publisher-publish','publisher-recover','publisher-cancel'].includes(request.action)){
    const plan=await bindPlan(a.planRequestId),observed=await inspectRun(a.runId,plan),run=observed.run;
    if(request.action==='publisher-review'){
     need(run.data?.candidate?.candidateDigest===a.candidateDigest,'NATIVE_CANDIDATE_CHANGED');
     if(!request.allow_dispatch){
      if(!matchingReview(run,a))throw issue('NATIVE_REVIEW_OUTCOME_UNKNOWN',{result:run});
      result=run;replayed=true;reconciled=true;
     }else{
      const {planRequestId,...choice}=a;
      result=verifyRunRow(await mutate(()=>pub('review',choice)),a.runId,plan);
      need(matchingReview(result,a),'NATIVE_REVIEW_CHANGED');
     }
     binding.publisherReviewId=result.data.review.id;
    }else if(request.action==='publisher-publish'){
     need(run.data?.review?.id===a.reviewId&&run.data.review.candidateDigest===run.data.candidate?.candidateDigest,'NATIVE_PUBLICATION_REVIEW_CHANGED');
     if(!request.allow_dispatch){
      result=verifyRunRow(await mutate(()=>pub('recover',{runId:a.runId})),a.runId,plan);
      if(result.state!=='PUBLISHED')throw issue('PUBLICATION_REVIEW_REQUIRED',{result});
      reconciled=true;
     }else{
      result=verifyRunRow(await mutate(()=>pub('publish',{runId:a.runId,reviewId:a.reviewId})),a.runId,plan);
     }
     binding.publisherReviewId=a.reviewId;
    }else if(request.action==='publisher-recover'){
     result=verifyRunRow(await mutate(()=>pub('recover',{runId:a.runId})),a.runId,plan);reconciled=result.state==='PUBLISHED';
    }else{
     if(run.state==='CANCELLED'){result=run;replayed=true;reconciled=true;}
     else{
      need(request.allow_dispatch,'NATIVE_CANCEL_OUTCOME_UNKNOWN');
      result=await mutate(()=>pub('cancel',{runId:a.runId}));
      need(result?.cancelling===a.runId,'NATIVE_CANCEL_CHANGED');
     }
    }
    if(result?.state==='PUBLISHED'){
     need(typeof result.data?.publication?.snapshot==='string'&&Number.isSafeInteger(result.data.publication.revision),'NATIVE_PUBLICATION_CHANGED');
     binding.publication={snapshot:result.data.publication.snapshot,revision:result.data.publication.revision};
    }
   }else throw issue('SOURCE_ACTION_INVALID');
  }
  need(plain(result),'NATIVE_RESULT_INVALID');
  const envelope={...identity,ok:true,connection:connectionView,dispatchStarted,result,binding,
   ...(replayed?{replayed:true}:{}),...(reconciled?{reconciled:true}:{})};
  need(Buffer.byteLength(JSON.stringify(envelope))+1<=REPLY_BYTES,'NATIVE_REPLY_TOO_LARGE');
  // A validated complete native result is authoritative even if cancellation arrives next.
  return envelope;
 }catch(error){
  const response={...identity,ok:false,...(connectionView?{connection:connectionView}:{}),
   dispatchStarted,error:safeCode(error),...(binding?{binding}:{})};
  if(!dispatchStarted||mutationRejected)response.applied=false;
  if(Number.isInteger(error?.status)&&error.status>=100&&error.status<=599)response.status=error.status;
  else{
   const observed=/^ANALYSIS_PUBLICATION_DOWNLOAD_HTTP_([1-5][0-9]{2})$/.exec(error?.code??'');
   if(observed)response.status=Number(observed[1]);
  }
  if(typeof error?.retryAfter==='number'&&Number.isFinite(error.retryAfter)&&error.retryAfter>=0)response.retryAfter=error.retryAfter;
  if(plain(error?.result))response.result=error.result;
  if(Buffer.byteLength(JSON.stringify(response))+1>REPLY_BYTES){
   delete response.binding;delete response.result;response.error='NATIVE_REPLY_TOO_LARGE';
  }
  return response;
 }finally{
  clearTimeout(timeout);
  // close() belongs to the merchant that owns the native workbench and its jobs.
 }
}
export async function main(argv=process.argv.slice(2)){
 const controller=new AbortController();let committed=false,request=null,reply;
 const abort=()=>{if(!committed)controller.abort(issue('ANALYSIS_PUBLICATION_CANCELLED'));};
 process.on('SIGTERM',abort);process.on('SIGINT',abort);
 const intakeTimeout=setTimeout(()=>controller.abort(issue('ANALYSIS_PUBLICATION_TIMEOUT')),300000);intakeTimeout.unref?.();
 try{
  need(argv.length===2&&argv[0]==='--request','REQUEST_ARGUMENTS_INVALID');
  const input=await verifiedFile(argv[1],{maximum:REQUEST_BYTES,collect:true,signal:controller.signal});
  request=jsonBytes(input.raw,'REQUEST_JSON_INVALID');
  clearTimeout(intakeTimeout);
  reply=await runAnalysisPublicationBridge(request,{controller});
 }catch(error){
  reply={...safeIdentity(request),ok:false,dispatchStarted:false,applied:false,error:safeCode(error)};
 }finally{clearTimeout(intakeTimeout);}
 const text=JSON.stringify(reply)+'\n';
 // Once this complete JSON has been validated, late cancellation cannot replace it.
 committed=true;
 try{
  await new Promise((resolve,reject)=>process.stdout.write(text,error=>error?reject(error):resolve()));
  process.exitCode=reply.ok?0:1;
 }catch{process.exitCode=1;}
 finally{
  process.removeListener('SIGTERM',abort);process.removeListener('SIGINT',abort);
  controller.abort(issue('ANALYSIS_PUBLICATION_CLIENT_FINISHED'));
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
