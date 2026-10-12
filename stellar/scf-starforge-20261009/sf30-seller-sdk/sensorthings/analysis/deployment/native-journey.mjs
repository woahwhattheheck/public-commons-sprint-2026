#!/usr/bin/env node
// MIT. One retained analysis workspace -> actual native viewer -> publication -> receiving.
import {open,mkdir,link,unlink,rename,lstat,readdir,readFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,dirname,join,isAbsolute,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {serveSensorThingsWorkspace} from '../../server.mjs';
import {MerchantSensorThingsWorkspaces} from '../../mcp.mjs';
import {inspectSensorThingsFiles,downloadSensorThingsFiles} from '../../download.mjs';
import {CONNECTION_SCHEMA} from '../../schema.mjs';
import {WORKSPACE_SCHEMA} from '../../contract.mjs';
import {inspectWorkspaceIdentity} from '../../../stellar-expert/store.mjs';

const VERSION='stellar-forge.sensorthings-analysis-native-journey.v1';
const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,KEY=/^[A-Za-z0-9_-]{8,100}$/;
const SOURCE=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const LIMIT=32*1024*1024;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(ok,code,message,details=null)=>{if(!ok)throw Object.assign(new Error(message),{code,details});};
function canonical(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
function same(a,b){return canonical(a)===canonical(b);}
function child(root,name){
  need(typeof name==='string'&&name&&!name.startsWith('/')&&!/[\\\u0000-\u001f\u007f]/u.test(name)&&
    name.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!p.includes(':')),'ANALYSIS_JOURNEY_PATH','Use an original relative journal member.');
  return join(root,name);
}
async function directory(path,{create=true}={}){
  need(isAbsolute(path),'ANALYSIS_JOURNEY_PATH','Use explicit absolute native directories.');
  if(create)await mkdir(path,{recursive:true,mode:0o700});
  const stat=await lstat(path);
  need(stat.isDirectory()&&!stat.isSymbolicLink(),'ANALYSIS_JOURNEY_PATH','A native directory was replaced by another object.');
  return path;
}
async function originalBytes(path,maximum=LIMIT){
  const h=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const before=await h.stat({bigint:true});
    need(before.isFile()&&before.size<=BigInt(maximum),'ANALYSIS_JOURNEY_FILE','Select the retained regular file within its declared size.');
    const parts=[];let total=0;const buffer=Buffer.allocUnsafe(65536);
    for(;;){const {bytesRead}=await h.read(buffer,0,buffer.length,total);if(!bytesRead)break;
      total+=bytesRead;need(total<=maximum,'ANALYSIS_JOURNEY_FILE','Retained file exceeded its selected size.');
      parts.push(Buffer.from(buffer.subarray(0,bytesRead)));}
    const after=await h.stat({bigint:true}),named=await lstat(path,{bigint:true});
    need(['dev','ino','size','mtimeNs','ctimeNs'].every(k=>before[k]===after[k])&&named.dev===after.dev&&named.ino===after.ino&&
      !named.isSymbolicLink()&&BigInt(total)===before.size,'ANALYSIS_JOURNEY_FILE_CHANGED','The original file changed while being read.');
    return Buffer.concat(parts,total);
  }finally{await h.close();}
}
async function jsonFile(path,maximum=LIMIT){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await originalBytes(path,maximum)));}
async function optionalJSON(path){try{return await jsonFile(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function syncDirectory(path){const h=await open(path,constants.O_RDONLY);try{await h.sync();}finally{await h.close();}}
async function immutable(path,content){
  const bytes=Buffer.isBuffer(content)?content:Buffer.from(typeof content==='string'?content:canonical(content)+'\n');
  await directory(dirname(path));const expected={path,bytes:bytes.length,sha256:digest(bytes)};
  try{need((await originalBytes(path,Math.max(bytes.length,LIMIT))).equals(bytes),
    'ANALYSIS_JOURNEY_CHANGED','Preserve the differing original journal or output member.',{path});return expected;}
  catch(e){if(e.code!=='ENOENT')throw e;}
  // A digest-bound temporary member may continue only its exact already-written
  // prefix. Unknown/differing files are retained; publication is create-only.
  const temporary=path+'.partial-'+expected.sha256;
  const h=await open(temporary,constants.O_CREAT|constants.O_RDWR|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0),0o600);
  try{
    const before=await h.stat({bigint:true});
    need(before.isFile()&&before.size<=BigInt(bytes.length),'ANALYSIS_JOURNEY_PARTIAL','The retained partial has a different size/type.',{path:temporary});
    const prefix=Buffer.alloc(Number(before.size));let offset=0;
    while(offset<prefix.length){const r=await h.read(prefix,offset,prefix.length-offset,offset);need(r.bytesRead>0,'ANALYSIS_JOURNEY_PARTIAL','The saved partial ended early.');offset+=r.bytesRead;}
    need(prefix.equals(bytes.subarray(0,prefix.length)),'ANALYSIS_JOURNEY_PARTIAL','Preserve the differing original partial member.',{path:temporary});
    for(let at=prefix.length;at<bytes.length;){const w=await h.write(bytes,at,bytes.length-at,at);need(w.bytesWritten>0,'ANALYSIS_JOURNEY_WRITE','The journal write made no progress.');at+=w.bytesWritten;}
    await h.sync();
  }finally{await h.close();}
  need((await originalBytes(temporary,Math.max(bytes.length,LIMIT))).equals(bytes),'ANALYSIS_JOURNEY_PARTIAL','The complete partial differs from its intended original bytes.');
  try{await link(temporary,path);}catch(e){if(e.code!=='EEXIST')throw e;
    need((await originalBytes(path,Math.max(bytes.length,LIMIT))).equals(bytes),'ANALYSIS_JOURNEY_CHANGED','The published original member differs.',{path});}
  await syncDirectory(dirname(path));await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});
  return expected;
}
async function fileIdentity(path,{sha256,bytes}={}){
  const h=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const before=await h.stat({bigint:true});need(before.isFile(),'ANALYSIS_JOURNEY_FILE','An original output is not a regular file.');
    if(bytes!==undefined)need(before.size===BigInt(bytes),'ANALYSIS_JOURNEY_FILE_CHANGED','An original output byte count differs.',{path});
    const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(131072);let at=0;
    for(;;){const read=await h.read(buffer,0,buffer.length,at);if(!read.bytesRead)break;at+=read.bytesRead;hash.update(buffer.subarray(0,read.bytesRead));}
    const after=await h.stat({bigint:true}),named=await lstat(path,{bigint:true});
    need(['dev','ino','size','mtimeNs','ctimeNs'].every(k=>before[k]===after[k])&&named.dev===after.dev&&named.ino===after.ino&&!named.isSymbolicLink(),
      'ANALYSIS_JOURNEY_FILE_CHANGED','An original output changed while being verified.',{path});
    const value={path,bytes:at,sha256:hash.digest('hex')};
    if(sha256!==undefined)need(value.sha256===sha256,'ANALYSIS_JOURNEY_FILE_CHANGED','An original output SHA256 differs.',{path});
    return value;
  }finally{await h.close();}
}
async function placeOriginal(source,target,expected){
  const original=await fileIdentity(source,expected);await directory(dirname(target));
  try{return await fileIdentity(target,expected);}catch(e){if(e.code!=='ENOENT')throw e;}
  const temporary=target+'.receiving-'+original.sha256;
  let input=null,output=null,problem=null;
  try{
    input=await open(source,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
    output=await open(temporary,constants.O_RDWR|constants.O_CREAT|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0),0o600);
    const before=await input.stat({bigint:true}),partial=await output.stat({bigint:true});
    need(before.isFile()&&partial.isFile()&&partial.size<=before.size,'ANALYSIS_JOURNEY_PARTIAL','Preserve the differing source-file receiving partial.');
    const buffer=Buffer.allocUnsafe(131072),check=Buffer.allocUnsafe(131072);let at=0;
    while(at<Number(partial.size)){
      const length=Math.min(buffer.length,Number(partial.size)-at);
      const [a,b]=await Promise.all([input.read(buffer,0,length,at),output.read(check,0,length,at)]);
      need(a.bytesRead===length&&b.bytesRead===length&&buffer.subarray(0,length).equals(check.subarray(0,length)),
        'ANALYSIS_JOURNEY_PARTIAL','The original receiving prefix differs. Preserve it before another source choice.');at+=length;
    }
    for(;;){const {bytesRead}=await input.read(buffer,0,buffer.length,at);if(!bytesRead)break;
      let written=0;while(written<bytesRead){const w=await output.write(buffer,written,bytesRead-written,at+written);
        need(w.bytesWritten>0,'ANALYSIS_JOURNEY_WRITE','The original file write made no progress.');written+=w.bytesWritten;}at+=bytesRead;}
    const after=await input.stat({bigint:true}),named=await lstat(source,{bigint:true});
    need(['dev','ino','size','mtimeNs','ctimeNs'].every(k=>before[k]===after[k])&&named.dev===after.dev&&named.ino===after.ino&&!named.isSymbolicLink(),
      'ANALYSIS_JOURNEY_SOURCE_CHANGED','The selected original changed while being staged.');await output.sync();
  }catch(e){problem=e;}
  finally{for(const handle of [input,output])if(handle)try{await handle.close();}catch(e){problem=problem?new AggregateError([problem,e],'Original receiving cleanup failed.'):e;}}
  if(problem)throw problem;
  await fileIdentity(temporary,expected);
  try{await link(temporary,target);}catch(e){if(e.code!=='EEXIST')throw e;await fileIdentity(target,expected);}
  await syncDirectory(dirname(target));await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});
  return fileIdentity(target,expected);
}
function checkHandoff(h){
  const cleanText=(value,max)=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=max;
  need(h?.schema==='stellar-forge.sensorthings-analysis-native-handoff.v1'&&KEY.test(h.operationId??'')&&
    UUID.test(h.workspaceId??'')&&/^[a-f0-9]{40}$/.test(h.sourceHead??'')&&cleanText(h.actor,200)&&
    ['workspaceDirectory','sourceInboxDirectory','receivingDirectory','receivingInboxDirectory'].every(k=>isAbsolute(h[k]??'')&&resolve(h[k])===h[k])&&
    Array.isArray(h.views)&&h.views.length>0&&h.views.length<=20,
    'ANALYSIS_JOURNEY_HANDOFF','Use the exact stopped native intake handoff and explicit original/receiving directories.');
  need(h.workspaceDirectory!==h.receivingDirectory&&h.sourceInboxDirectory!==h.receivingInboxDirectory,
    'ANALYSIS_JOURNEY_HANDOFF','Select the distinct receiving workspace while preserving the original.');
  need(h.viewer&&HASH.test(h.viewer.sha256??'')&&Number.isSafeInteger(h.viewer.bytes)&&h.viewer.bytes>0&&
    h.viewer.filename==='helgoland-complete.zip'&&(!h.viewer.sourcePath||isAbsolute(h.viewer.sourcePath)),
    'ANALYSIS_JOURNEY_HANDOFF','Retain the actual original Helgoland archive filename, SHA and byte count.');
  const keys=new Set();
  const review=decision=>need(decision&&cleanText(decision.note,12000)&&Array.isArray(decision.acknowledgeIssues)&&
    decision.acknowledgeIssues.every(c=>cleanText(c,200))&&new Set(decision.acknowledgeIssues).size===decision.acknowledgeIssues.length,
    'ANALYSIS_JOURNEY_REVIEW_BASIS','Supply the attributed original review note and exact distinct finding codes.');
  const annotation=value=>need(value&&cleanText(value.text,12000)&&cleanText(value.reason,12000)&&
    ['note','quality','interpretation'].includes(value.kind??'note')&&(!value.occurrenceId||HASH.test(value.occurrenceId)),
    'ANALYSIS_JOURNEY_ANNOTATION','Use an explicitly attributed annotation and retained source occurrence.');
  for(const view of h.views){
    need(KEY.test(view.key??'')&&!keys.has(view.key)&&HASH.test(view.editionId??'')&&Array.isArray(view.streamKeys)&&
      view.streamKeys.length>0&&view.streamKeys.length<=20&&view.streamKeys.every(k=>HASH.test(k))&&
      new Set(view.streamKeys).size===view.streamKeys.length&&['map','numeric'].includes(view.mode)&&
      cleanText(view.title,200)&&cleanText(view.sourceNote,10000),
      'ANALYSIS_JOURNEY_HANDOFF','Each native view requires actual original edition/stream identities and an attributed source note.');
    keys.add(view.key);
    if(view.projectId||view.versionId)need(KEY.test(view.projectId??'')&&HASH.test(view.versionId??''),
      'ANALYSIS_JOURNEY_HANDOFF','Select both the original project and saved version.');
    if(view.period)need(cleanText(view.period.start,100)&&cleanText(view.period.end,100),
      'ANALYSIS_JOURNEY_HANDOFF','Retain exact explicit source-period endpoints.');
    if(view.review)review(view.review);review(view.receivingReview);
    if(view.annotation)annotation(view.annotation);if(view.receivingAnnotation)annotation(view.receivingAnnotation);
    if(view.comparison)need(HASH.test(view.comparison.editionId??'')&&cleanText(view.comparison.note,12000),
      'ANALYSIS_JOURNEY_HANDOFF','The comparison needs its existing right-hand source edition and attributed note.');
    if(view.publication)need(cleanText(view.publication.title,200)&&cleanText(view.publication.note,12000),
      'ANALYSIS_JOURNEY_HANDOFF','Use the explicit publication title and interpretation.');
  }
  if(h.python){
    const p=h.python;
    if(p.programmeSource)need(HASH.test(p.programmeSource.sha256??'')&&
      Number.isSafeInteger(p.programmeSource.bytes)&&p.programmeSource.bytes>0&&p.programmeSource.bytes<=1024*1024,
      'ANALYSIS_JOURNEY_PYTHON_SOURCE','Bind the exact maintained programme source SHA-256 and byte count from the selected composed release.');
    need(['interpreter','modulePath','checkout','workspace','receivedWorkspace','control','output'].every(k=>isAbsolute(p[k]??'')&&resolve(p[k])===p[k])&&
      (!p.operationId||/^[a-f0-9]{32}$/.test(p.operationId))&&cleanText(p.title,200)&&
      Array.isArray(p.sources)&&p.sources.length>0&&p.sources.length<=16&&
      new Set(p.sources.map(x=>String(x.name).toLowerCase())).size===p.sources.length&&new Set(p.sources.map(x=>x.editionId)).size===p.sources.length&&
      p.sources.every(x=>/^[A-Za-z][A-Za-z0-9_]{0,19}$/.test(x.name??'')&&HASH.test(x.editionId??'')&&KEY.test(x.exportId??''))&&
      (p.allowIncomplete===undefined||typeof p.allowIncomplete==='boolean')&&Array.isArray(p.comparisons??[])&&
      (p.comparisons??[]).every(c=>p.sources.some(x=>x.name===c.left)&&p.sources.some(x=>x.name===c.right)&&c.left!==c.right),
      'ANALYSIS_JOURNEY_PYTHON','Use the original prepared-source editions/export IDs, maintained Python checkout and one explicit programme workspace/restore selection.');
    need(new Set([p.workspace,p.receivedWorkspace,p.control,p.output]).size===4&&disjoint(p.workspace,p.receivedWorkspace)&&
      [p.workspace,p.receivedWorkspace,p.control,p.output].every(x=>disjoint(x,h.workspaceDirectory)&&disjoint(x,h.receivingDirectory)),
      'ANALYSIS_JOURNEY_PYTHON','Keep the maintained Python Analysis workspaces and control separate from the original SensorThings stores.');
  }
  return h;
}
function errorView(error,redact){
  const clean=value=>typeof value==='string'?redact(value):Array.isArray(value)?value.map(clean):
    value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,/^(authorization|token|password|secret)$/i.test(k)?'[redacted]':clean(v)])):value;
  return {code:typeof error?.code==='string'?error.code:'ANALYSIS_NATIVE_JOURNEY_FAILED',
    message:redact(String(error?.message??error)),details:clean(error?.details??null),
    causes:error instanceof AggregateError?[...error.errors].map(e=>errorView(e,redact)):[]};
}
async function startNative(h,{received=false,expectedWorkspaceId=null,allowCreate=false}={}){
  const workspaceDirectory=received?h.receivingDirectory:h.workspaceDirectory;
  const inboxDirectory=received?h.receivingInboxDirectory:h.sourceInboxDirectory;
  const existing=await inspectWorkspaceIdentity(workspaceDirectory,{schema:WORKSPACE_SCHEMA,allowMissing:allowCreate});
  need(existing||allowCreate,'ANALYSIS_JOURNEY_WORKSPACE','The original workspace identity is absent; do not initialize another source workspace.');
  const expected=received?expectedWorkspaceId:h.workspaceId;
  if(expected)need(existing?.workspaceId===expected,'ANALYSIS_JOURNEY_WORKSPACE','The retained workspace UUID changed.');
  const server=await serveSensorThingsWorkspace({directory:workspaceDirectory,sourceInboxDirectory:inboxDirectory,
    expectedWorkspaceId:expected??existing?.workspaceId,host:'127.0.0.1',port:0});
  let client=null;
  try{
    const privateUrl=new URL(server.url);need(privateUrl.origin===server.origin&&privateUrl.hash.length>32,
      'ANALYSIS_JOURNEY_SESSION','The original listener did not return its retained private session.');
    const alias=received?'received':'original';
    client=new MerchantSensorThingsWorkspaces({schema:CONNECTION_SCHEMA,workspaces:{[alias]:{
      workspaceId:server.workspaceId,consoleUrlEnv:'SCF_ANALYSIS_JOURNEY_PRIVATE_URL'}}},
      {environment:{SCF_ANALYSIS_JOURNEY_PRIVATE_URL:server.url}});
    let closed=false;
    return {server,client,alias,workspaceId:server.workspaceId,origin:server.origin,token:privateUrl.hash.slice(1),
      entry:server.origin+'/analysis/'+privateUrl.hash,
      async close(){if(closed)return;closed=true;const errors=[];
        try{await client.close();}catch(e){errors.push(e);}try{await server.close();}catch(e){errors.push(e);}
        if(errors.length)throw new AggregateError(errors,'The original native listener or held file reader did not finish closing.');}};
  }catch(error){
    const errors=[error];if(client)try{await client.close();}catch(e){errors.push(e);}
    try{await server.close();}catch(e){errors.push(e);}
    throw errors.length>1?new AggregateError(errors,'Original listener setup/cleanup failed.'):error;
  }
}
async function api(native,path,{body=null,signal=null,allowMissing=false}={}){
  need(path.startsWith('/api/')&&new URL(path,native.origin).origin===native.origin,'ANALYSIS_JOURNEY_API','Use the original same-origin API.');
  const response=await fetch(native.origin+path,{method:body===null?'GET':'POST',redirect:'error',signal,
    headers:{Authorization:'Bearer '+native.token,'X-SensorThings-Workspace':native.workspaceId,
      ...(body===null?{}:{'Content-Type':'application/json'})},...(body===null?{}:{body:typeof body==='string'?body:canonical(body)})});
  const parts=[];let length=0;
  if(response.body){const reader=response.body.getReader();try{for(;;){const {done,value}=await reader.read();if(done)break;
    length+=value.byteLength;if(length>LIMIT){await reader.cancel();throw Object.assign(new Error('The original API response exceeded its declared bound.'),{code:'ANALYSIS_JOURNEY_API'});}parts.push(Buffer.from(value));}}
    finally{reader.releaseLock();}}
  const raw=Buffer.concat(parts,length);let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{throw Object.assign(new Error('The original API did not return complete JSON.'),{code:'ANALYSIS_JOURNEY_API'});}
  if(allowMissing&&response.status===404&&path.startsWith('/api/operations/')&&value.error==='OPERATION')return null;
  need(response.ok,typeof value.error==='string'?value.error:'ANALYSIS_JOURNEY_API',value.message??'The original native API returned an error.',{status:response.status,operationId:value.operationId??null});
  need(response.headers.get('X-SensorThings-Workspace')===native.workspaceId,'ANALYSIS_JOURNEY_WORKSPACE','The original API response belongs to another workspace.');
  return value;
}
class Actions {
  constructor({page,native,root,signal,redact}){Object.assign(this,{page,native,root,signal,redact});this.current=null;this.failure=null;}
  async install(){
    await this.page.route('**/api/action',async route=>{
      try{
        const req=route.request();need(req.method()==='POST'&&this.current,'ANALYSIS_JOURNEY_UNEXPECTED_ACTION',
          'An application action has no retained active operator phase.');
        const raw=req.postData();need(typeof raw==='string'&&Buffer.byteLength(raw)<=2*1024*1024,
          'ANALYSIS_JOURNEY_ACTION','The complete original action body is unavailable.');
        const body=JSON.parse(raw),phase=this.current;
        need(body.action===phase.action&&KEY.test(body.operationId??'')&&Number.isSafeInteger(body.expectedRevision),
          'ANALYSIS_JOURNEY_ACTION_CHANGED','The visible form submitted a different action or invalid original identity.');
        phase.check?.(body.payload);
        await immutable(child(phase.directory,'request.json'),raw);
        await immutable(child(phase.directory,'request-binding.json'),{workspaceId:this.native.workspaceId,operationId:body.operationId,
          action:body.action,requestSha256:digest(Buffer.from(raw)),nativeRequestSha256:digest(Buffer.from(canonical({action:body.action,payload:body.payload}))),phase:phase.key,meaning:'Exact visible form body retained before dispatch.'});
        phase.body=body;phase.raw=raw;await route.continue();
      }catch(e){this.failure=e;await route.abort('failed');}
    });
  }
  async original(phase){
    const requestPath=child(phase.directory,'request.json');let raw;
    try{raw=(await originalBytes(requestPath,2*1024*1024)).toString('utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}
    const body=JSON.parse(raw);need(body.action===phase.action&&KEY.test(body.operationId??''),'ANALYSIS_JOURNEY_ACTION_CHANGED','Retain the exact original submitted action.');
    phase.check?.(body.payload);
    const nativeRequestSha256=digest(Buffer.from(canonical({action:body.action,payload:body.payload})));
    await immutable(child(phase.directory,'request-binding.json'),{workspaceId:this.native.workspaceId,operationId:body.operationId,
      action:body.action,requestSha256:digest(Buffer.from(raw)),nativeRequestSha256,phase:phase.key,meaning:'Exact visible form body retained before dispatch.'});
    const operation=await api(this.native,'/api/operations/'+body.operationId,{signal:this.signal,allowMissing:true});
    if(operation)need(operation.operationId===body.operationId&&operation.requestSha256===nativeRequestSha256,
      'ANALYSIS_JOURNEY_REQUEST_CHANGED','The original operation is bound to a different request.');
    if(operation?.state==='FAILED')throw Object.assign(new Error('The original action failed; retain its original result before a corrected operator action.'),
      {code:'ANALYSIS_JOURNEY_ORIGINAL_FAILED',details:{operationId:body.operationId,error:operation.error}});
    let result;
    if(operation?.state==='COMPLETE'){
      need(operation.result!==null&&operation.result!==undefined,'ANALYSIS_JOURNEY_RESULT','The committed original result is unavailable.');
      result=operation.result;
    }else{
      // This is only the saved original request, never a fresh operation or a rebase.
      const response=await api(this.native,'/api/action',{body:raw,signal:this.signal});
      need(response.operationId===body.operationId&&Object.hasOwn(response,'result'),'ANALYSIS_JOURNEY_RESULT',
        'The same original request remains unresolved.');
      result=response.result;
    }
    const readback=await api(this.native,'/api/operations/'+body.operationId,{signal:this.signal});
    need(readback.operationId===body.operationId&&readback.requestSha256===nativeRequestSha256&&readback.state==='COMPLETE'&&same(readback.result,result),'ANALYSIS_JOURNEY_RESULT','The original committed action readback differs.');
    await immutable(child(phase.directory,'complete.json'),{schema:'stellar-forge.sensorthings-native-action-result.v1',
      workspaceId:this.native.workspaceId,operationId:body.operationId,action:body.action,requestSha256:digest(Buffer.from(raw)),result});
    return {operationId:body.operationId,result,request:body};
  }
  async perform(key,action,{check=null,prepare,submit}={}){
    this.signal?.throwIfAborted();need(!this.current,'ANALYSIS_JOURNEY_ACTION','A prior original UI action is still active.');
    const phase={key,action,directory:child(this.root,key),check};await directory(phase.directory);
    const restored=await this.original(phase);if(restored)return restored;
    await prepare();this.signal?.throwIfAborted();this.current=phase;this.failure=null;
    try{
      const resultPromise=this.page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/action',{timeout:120000})
        .then(value=>({value}),error=>({error}));
      await submit();const observed=await resultPromise;if(observed.error)throw this.failure??observed.error;const response=observed.value;
      if(this.failure)throw this.failure;
      const raw=await response.body();need(raw.length<=LIMIT,'ANALYSIS_JOURNEY_RESULT','The submitted action response exceeded its native bound.');
      await immutable(child(phase.directory,'first-response.json'),{httpStatus:response.status(),body:JSON.parse(raw.toString('utf8'))});
      need(response.ok(),'ANALYSIS_JOURNEY_ACTION_RESPONSE','The visible original action requires its retained error/readback.',{status:response.status()});
      return await this.original(phase);
    }finally{this.current=null;}
  }
}
async function nativeFiles(native,selection,output,signal,onProgress){
  const selected=await inspectSensorThingsFiles({client:native.client,workspace:native.alias,workspaceId:native.workspaceId,selection,signal});
  const binding={workspaceId:native.workspaceId,selection,manifestSha256:selected.manifestSha256,manifest:selected.manifest};
  await immutable(child(output,'selection.json'),binding);
  const result=await downloadSensorThingsFiles({client:native.client,workspace:native.alias,workspaceId:native.workspaceId,selection,
    exportId:selected.manifest.id,expectedManifestSha256:selected.manifestSha256,directory:child(output,'received'),signal,onProgress});
  const identities=[];
  for(const file of selected.manifest.files)identities.push({...file,...await fileIdentity(child(child(output,'received'),file.name),file)});
  await immutable(child(output,'complete.json'),{schema:'stellar-forge.sensorthings-native-downloaded-files.v1',...binding,files:identities});
  return {...binding,result,files:identities};
}
async function inspectSource(native,h,output,signal){
  const original=await api(native,'/api/view',{signal});need(original.workspaceId===h.workspaceId,
    'ANALYSIS_JOURNEY_WORKSPACE','The actual original intake workspace UUID differs.');
  const editions=[];
  for(const id of [...new Set([...h.views.flatMap(v=>[v.editionId,...(v.comparison?[v.comparison.editionId]:[])]),...(h.python?.sources??[]).map(s=>s.editionId)])]){
    const edition=await api(native,'/api/editions/'+id+'/metadata',{signal});
    const summary=await api(native,'/api/editions/'+id+'/summary',{signal});
    need(edition.id===id,'ANALYSIS_JOURNEY_SOURCE','An original native source edition differs.');
    editions.push({id,edition,summary});
  }
  const evidence={schema:'stellar-forge.sensorthings-analysis-native-intake-readback.v1',workspaceId:h.workspaceId,
    sourceHead:h.sourceHead,originalView:original,editions,meaning:'Read existing source editions; no source capture/provider request is made by this continuation.'};
  const old=await optionalJSON(child(output,'intake-readback.json'));
  if(old){need(old.workspaceId===h.workspaceId&&same(old.editions,editions)&&old.sourceHead===h.sourceHead,
    'ANALYSIS_JOURNEY_SOURCE_CHANGED','The original stopped intake editions changed.');return old;}
  await immutable(child(output,'intake-readback.json'),evidence);return evidence;
}
async function screenshot(page,output,name,bindings){
  const bytes=await page.screenshot({fullPage:true});const saved=await immutable(child(output,name),bytes);
  const metadata={...saved,viewport:page.viewportSize(),bindings,meaning:'Actual original native browser screenshot from this selected source/view.'};
  await immutable(child(output,name+'.json'),metadata);return metadata;
}


const TAB_NAMES={overview:'Overview',selection:'Selection',source:'Source review',rows:'Events / rows',viewer:'Native viewer',
  annotations:'Annotations',compare:'Compare editions',publish:'Publication',transfer:'Receive / export'};
function formFor(page,title){return page.locator('#pane form').filter({has:page.getByRole('heading',{name:title,exact:true})});}
async function navigate(page,native,actor,{projectId=null,versionId=null,tab='overview'}={}){
  const url=new URL('/analysis/',native.origin);
  if(projectId)url.searchParams.set('project',projectId);
  if(versionId)url.searchParams.set('version',versionId);
  url.searchParams.set('tab',tab);url.hash=native.token;
  await page.goto(url.href,{waitUntil:'domcontentloaded'});
  await page.locator('#identity').filter({hasText:native.workspaceId}).waitFor({timeout:60000});
  await page.locator('#actor').fill(actor);
  if(await page.locator('#pending').isVisible()){
    await page.getByRole('button',{name:'Read original outcome',exact:true}).click();
    await page.locator('#pending').waitFor({state:'hidden',timeout:60000});
  }
  const selected=page.locator('#tabs').getByRole('button',{name:TAB_NAMES[tab],exact:true});
  if(await selected.getAttribute('aria-current')!=='page')await selected.click();
  await page.locator('#pane').getByText('Reading the retained workspace…',{exact:true}).waitFor({state:'hidden'});
  if(projectId)need((await page.locator('#project-header').innerText()).includes(projectId),'ANALYSIS_JOURNEY_PROJECT','The original UI opened another project.');
  if(versionId)need(await page.locator('#project-header select[name=version]').inputValue()===versionId,
    'ANALYSIS_JOURNEY_VERSION','The original UI opened another saved version.');
}
async function recoverAction(actions,key,action,check){
  actions.signal?.throwIfAborted();const phase={key,action,check,directory:child(actions.root,key)};
  await directory(phase.directory);return actions.original(phase);
}
function exactPayload(actual,expected,label){
  need(same(actual,expected),'ANALYSIS_JOURNEY_FORM_CHANGED','The visible '+label+' form differs from its exact selected source/input.');
}
function selectionFor(view,viewerId){return {streamKeys:[...view.streamKeys],period:view.period??null,view:view.mode,viewerId};}
async function selectStreams(form,view){
  await form.locator('select[name=editionId]').selectOption(view.editionId);
  for(const key of view.streamKeys)await form.locator('input[name=streamKeys][value="'+key+'"]').waitFor();
  const boxes=form.locator('input[name=streamKeys]');for(let i=0;i<await boxes.count();i++){
    const box=boxes.nth(i);await box.setChecked(view.streamKeys.includes(await box.getAttribute('value')));
  }
  await form.locator('select[name=view]').selectOption(view.mode);
  await form.locator('input[name=fullPeriod]').setChecked(!view.period);
  if(view.period){await form.locator('input[name=start]').fill(view.period.start);await form.locator('input[name=end]').fill(view.period.end);}
}
async function ensureViewer({page,native,actions,h,output}){
  const payload={filename:h.viewer.filename,expectedSha256:h.viewer.sha256,expectedBytes:h.viewer.bytes,actor:h.actor},
    check=value=>exactPayload(value,payload,'viewer receiving');
  const prior=await recoverAction(actions,'viewer-receive','analysis.viewer.import',check);
  if(prior)return prior.result;
  const overview=await api(native,'/api/analysis',{signal:actions.signal});
  const existing=overview.viewers.filter(v=>v.archive?.sha256===h.viewer.sha256&&v.archive?.bytes===h.viewer.bytes);
  need(existing.length<=1,'ANALYSIS_JOURNEY_VIEWER','More than one viewer manifest claims this exact original archive.');
  if(existing.length){
    const viewer=await api(native,'/api/analysis/viewers/'+existing[0].id,{signal:actions.signal});
    await immutable(child(output,'existing-viewer.json'),{id:viewer.id,archive:viewer.archive,meaning:'Reuse the actual already-installed original viewer.'});return viewer;
  }
  const originalTarget=child(h.sourceInboxDirectory,h.viewer.filename);
  if(h.viewer.sourcePath)await placeOriginal(h.viewer.sourcePath,originalTarget,h.viewer);
  const source=await fileIdentity(originalTarget,h.viewer);
  let form;
  const result=await actions.perform('viewer-receive','analysis.viewer.import',{check,
    prepare:async()=>{await navigate(page,native,h.actor,{tab:'transfer'});form=formFor(page,'Receive original viewer archive');
      await form.locator('select[name=filename]').selectOption(h.viewer.filename);
      need((await form.innerText()).includes(source.sha256),'ANALYSIS_JOURNEY_INBOX','The visible original viewer inbox hash differs.');},
    submit:()=>form.getByRole('button',{name:'Receive original viewer archive',exact:true}).click()});
  need(result.result.archive.sha256===h.viewer.sha256&&result.result.archive.bytes===h.viewer.bytes,
    'ANALYSIS_JOURNEY_VIEWER','The original imported archive differs.');return result.result;
}
async function createAnalysis({page,native,actions,h,view,viewerId}){
  if(view.projectId){
    const version=await api(native,'/api/analysis/versions/'+view.versionId,{signal:actions.signal});
    need(version.projectId===view.projectId&&version.editionId===view.editionId&&same(version.selection.streamKeys,view.streamKeys)&&
      version.selection.view===view.mode&&version.selection.viewerId===viewerId,
      'ANALYSIS_JOURNEY_EXISTING_SELECTION','The handed original analysis differs from its exact source/viewer selection.');
    await immutable(child(actions.root,view.key+'-existing-project.json'),{projectId:view.projectId,versionId:view.versionId});
    return {projectId:view.projectId,versionId:view.versionId,version};
  }
  const payload={title:view.title,editionId:view.editionId,selection:selectionFor(view,viewerId),actor:h.actor,note:view.sourceNote};
  let form;
  const result=await actions.perform(view.key+'-create','analysis.create',{check:value=>exactPayload(value,payload,'analysis selection'),
    prepare:async()=>{await navigate(page,native,h.actor,{tab:'selection'});await page.locator('#new-project').click();
      form=formFor(page,'Create the first saved analysis');await selectStreams(form,view);
      await form.locator('input[name=title]').fill(view.title);await form.locator('select[name=viewerId]').selectOption(viewerId);
      await form.locator('textarea[name=reason]').fill(view.sourceNote);},
    submit:()=>form.getByRole('button',{name:'Create analysis',exact:true}).click()});
  return result.result;
}
async function reviewEdition({page,native,actions,h,editionId,decision,scope}){
  const key=scope+'-review-'+editionId,check=value=>{
    need(value.editionId===editionId&&value.actor===h.actor&&value.decision==='accept','ANALYSIS_JOURNEY_REVIEW','The selected original source review changed.');
    if(decision){const {acknowledgeIssues,...rest}=value;
      exactPayload(rest,{editionId,decision:'accept',actor:h.actor,note:decision.note},'source review');
      need(Array.isArray(acknowledgeIssues)&&same([...acknowledgeIssues].sort(),[...decision.acknowledgeIssues].sort()),
        'ANALYSIS_JOURNEY_REVIEW','The exact acknowledged finding set differs.');}
  };
  const prior=await recoverAction(actions,key,'edition.review',check);if(prior)return prior.result;
  const before=await api(native,'/api/view',{signal:actions.signal}),latest=[...(before.reviews??[])].reverse().find(r=>r.editionId===editionId);
  if(latest?.decision==='accept'){
    await immutable(child(actions.root,key+'-existing.json'),latest);return latest;
  }
  need(decision&&typeof decision.note==='string'&&decision.note.trim()&&Array.isArray(decision.acknowledgeIssues),
    'ANALYSIS_JOURNEY_REVIEW_BASIS','Supply the attributed decision and exact original findings for this source edition.');
  let form;
  const result=await actions.perform(key,'edition.review',{check,
    prepare:async()=>{await navigate(page,native,h.actor,{tab:'selection'});await page.locator('#new-project').click();
      await formFor(page,'Create the first saved analysis').locator('select[name=editionId]').selectOption(editionId);
      await page.locator('#pane code').filter({hasText:editionId}).waitFor();
      await page.locator('#tabs').getByRole('button',{name:'Source review',exact:true}).click();
      form=formFor(page,'Record the original edition review');await form.waitFor();
      const actual=await form.locator('input[name=issues]').evaluateAll(elements=>elements.map(e=>e.value));
      need(same([...actual].sort(),[...decision.acknowledgeIssues].sort()),
        'ANALYSIS_JOURNEY_REVIEW_BASIS','The original required findings differ from the handed review basis.',{editionId,required:actual});
      await form.locator('select[name=decision]').selectOption('accept');
      await form.locator('textarea[name=note]').fill(decision.note);
      for(const code of decision.acknowledgeIssues)await form.getByLabel(code,{exact:true}).check();},
    submit:()=>form.getByRole('button',{name:'Record source review',exact:true}).click()});
  const after=await api(native,'/api/view',{signal:actions.signal}),review=[...(after.reviews??[])].reverse().find(r=>r.editionId===editionId);
  need(review?.decision==='accept'&&review.actor===h.actor&&review.note===decision.note,
    'ANALYSIS_JOURNEY_REVIEW','The actual source decision was not retained.');return result.result;
}
async function findOccurrence(native,versionId,annotation,signal){
  let offset=0;
  for(;;){
    const page=await api(native,'/api/analysis/versions/'+versionId+'/rows?offset='+offset+'&limit=100',{signal});
    const index=page.rows.findIndex(row=>annotation.occurrenceId?row.occurrence_id===annotation.occurrenceId:true);
    if(index>=0)return {row:page.rows[index],offset,index,total:page.total};
    need(page.nextOffset!==null&&page.nextOffset>offset,'ANALYSIS_JOURNEY_CITATION','The exact cited original occurrence is not in the saved selection.');
    offset=page.nextOffset;
  }
}
async function annotateAnalysis({page,native,actions,h,view,current}){
  if(!view.annotation)return current;
  const located=await findOccurrence(native,current.versionId,view.annotation,actions.signal),row=located.row;
  const annotation={kind:view.annotation.kind??'note',status:'active',text:view.annotation.text,
    refs:[{editionId:current.version.editionId,sha256:row.source_page_sha256,jsonPointer:row.source_pointer,occurrenceId:row.occurrence_id}]},
    payload={projectId:current.projectId,baseVersionId:current.versionId,annotation,actor:h.actor,reason:view.annotation.reason};
  let form;
  const result=await actions.perform(view.key+'-annotation','analysis.annotate',{check:value=>exactPayload(value,payload,'cited annotation'),
    prepare:async()=>{await navigate(page,native,h.actor,{projectId:current.projectId,versionId:current.versionId,tab:'rows'});
      for(let offset=0;offset<located.offset;offset+=100){await page.getByRole('button',{name:'Next page',exact:true}).first().click();
        await page.locator('#pane').getByText('Reading the retained workspace…',{exact:true}).waitFor({state:'hidden'});}
      const selected=page.locator('#pane table tbody tr').nth(located.index);
      need((await selected.innerText()).includes(row.source_page_sha256)&&(await selected.innerText()).includes(row.source_pointer),
        'ANALYSIS_JOURNEY_CITATION','The visible row differs from the original cited occurrence.');
      await selected.getByRole('button',{name:'Cite this occurrence',exact:true}).click();
      form=formFor(page,'Add a cited annotation');await form.waitFor();
      need(same(JSON.parse(await form.locator('textarea[name=refs]').inputValue()),annotation.refs),
        'ANALYSIS_JOURNEY_CITATION','The visible source citation was changed.');
      await form.locator('select[name=kind]').selectOption(annotation.kind);
      await form.locator('select[name=status]').selectOption('active');await form.locator('textarea[name=text]').fill(annotation.text);
      await form.locator('textarea[name=reason]').fill(view.annotation.reason);},
    submit:()=>form.getByRole('button',{name:'Save cited annotation',exact:true}).click()});
  need(result.result.version.parentId===current.versionId&&result.result.version.annotations.some(a=>same(a.refs,annotation.refs)&&a.text===annotation.text),
    'ANALYSIS_JOURNEY_CITATION','The saved annotation did not retain the exact source and original version.');
  return result.result;
}
async function compareEdition({page,native,actions,h,view,current}){
  if(!view.comparison)return null;
  const payload={projectId:current.projectId,baseVersionId:current.versionId,rightEditionId:view.comparison.editionId,actor:h.actor,note:view.comparison.note};
  let form;
  const result=await actions.perform(view.key+'-comparison','analysis.compare',{check:value=>exactPayload(value,payload,'edition comparison'),
    prepare:async()=>{await navigate(page,native,h.actor,{projectId:current.projectId,versionId:current.versionId,tab:'compare'});
      form=formFor(page,'Compare with another retained edition');await form.locator('select[name=rightEditionId]').selectOption(view.comparison.editionId);
      await form.locator('textarea[name=note]').fill(view.comparison.note);},
    submit:()=>form.getByRole('button',{name:'Save edition comparison',exact:true}).click()});
  const compared=await api(native,'/api/analysis/comparisons/'+result.result.id,{signal:actions.signal});
  need(compared.versionId===current.versionId&&compared.leftEditionId===current.version.editionId&&compared.rightEditionId===view.comparison.editionId,
    'ANALYSIS_JOURNEY_COMPARISON','The saved comparison changed its original source identities.');
  if(view.comparison.expectedCounts)need(same(compared.counts,view.comparison.expectedCounts),
    'ANALYSIS_JOURNEY_COMPARISON','The actual retained comparison differs from its explicit source-derived expectation.');
  await immutable(child(actions.root,view.key+'-comparison-readback.json'),compared);return compared;
}
async function receiveEvidence({page,native,actions,h,current,key,file,title,note}){
  await placeOriginal(file.path,child(h.sourceInboxDirectory,file.name),file);
  const payload={filename:file.name,expectedSha256:file.sha256,expectedBytes:file.bytes,actor:h.actor,note,
    projectId:current.projectId,baseVersionId:current.versionId,title};
  let form;
  const result=await actions.perform(key,'analysis.evidence.import',{check:value=>exactPayload(value,payload,'actual viewer evidence'),
    prepare:async()=>{await navigate(page,native,h.actor,{projectId:current.projectId,versionId:current.versionId,tab:'publish'});
      form=formFor(page,'Retain viewer evidence');await form.locator('select[name=filename]').selectOption(file.name);
      await form.locator('input[name=title]').fill(title);await form.locator('textarea[name=note]').fill(note);},
    submit:()=>form.getByRole('button',{name:'Retain viewer evidence',exact:true}).click()});
  need(result.result.versionId===current.versionId&&result.result.file.sha256===file.sha256&&result.result.file.bytes===file.bytes,
    'ANALYSIS_JOURNEY_EVIDENCE','The actual evidence attachment differs from its selected source/version.');return result.result;
}
async function publishAnalysis({page,native,actions,h,view,current,comparison,evidence}){
  const title=view.publication?.title??view.title+' — retained observation analysis',
    note=view.publication?.note??view.sourceNote,comparisonIds=comparison?[comparison.id]:[],evidenceIds=evidence.map(x=>x.id),
    payload={projectId:current.projectId,baseVersionId:current.versionId,title,actor:h.actor,note,comparisonIds,evidenceIds};
  let form;
  const result=await actions.perform(view.key+'-publication','analysis.publish',{check:value=>exactPayload(value,payload,'approved publication'),
    prepare:async()=>{await navigate(page,native,h.actor,{projectId:current.projectId,versionId:current.versionId,tab:'publish'});
      form=formFor(page,'Prepare a frozen publication');await form.locator('input[name=title]').fill(title);await form.locator('textarea[name=note]').fill(note);
      for(const [name,ids]of [['comparisonIds',comparisonIds],['evidenceIds',evidenceIds]]){
        const choices=form.locator('input[name='+name+']');for(let i=0;i<await choices.count();i++){
          const box=choices.nth(i);await box.setChecked(ids.includes(await box.getAttribute('value')));}
        for(const id of ids)need(await form.locator('input[name='+name+'][value="'+id+'"]').isChecked(),'ANALYSIS_JOURNEY_PUBLICATION','The selected original publication evidence is missing.');
      }},
    submit:()=>form.getByRole('button',{name:'Prepare publication',exact:true}).click()});
  const publication=await api(native,'/api/analysis/publications/'+result.result.id,{signal:actions.signal});
  need(publication.projectId===current.projectId&&publication.versionId===current.versionId&&publication.editionId===current.version.editionId&&
    same(publication.evidenceIds,evidenceIds)&&same(publication.comparisonIds,comparisonIds),
    'ANALYSIS_JOURNEY_PUBLICATION','The frozen publication differs from its selected source and evidence.');return publication;
}
async function exportAnalysis({page,native,actions,h,current,key,note}){
  const payload={projectId:current.projectId,actor:h.actor,note};let form;
  const result=await actions.perform(key,'analysis.export',{check:value=>exactPayload(value,payload,'complete project export'),
    prepare:async()=>{await navigate(page,native,h.actor,{projectId:current.projectId,versionId:current.versionId,tab:'transfer'});
      form=formFor(page,'Export the complete editable project');await form.locator('textarea[name=note]').fill(note);},
    submit:()=>form.getByRole('button',{name:'Export complete project',exact:true}).click()});
  need(result.result.projectId===current.projectId&&result.result.headVersionId===current.versionId&&result.result.file?.bytes>0,
    'ANALYSIS_JOURNEY_EXPORT','The complete project export differs from its frozen current head.');return result.result;
}
async function importAnalysis({page,native,actions,h,key,file,note,projectId}){
  // Each actual archive edition has its own flat inbox name; later exports may
  // retain the same publisher filename while containing different exact bytes.
  const filename='analysis-'+file.sha256+'.ndjson.gz';
  await placeOriginal(file.path,child(h.receivingInboxDirectory,filename),file);
  const payload={filename,expectedSha256:file.sha256,expectedBytes:file.bytes,actor:h.actor,note};let form;
  const result=await actions.perform(key,'analysis.import',{check:value=>exactPayload(value,payload,'complete project receiving'),
    prepare:async()=>{await navigate(page,native,h.actor,{tab:'transfer'});form=formFor(page,'Receive complete project');
      await form.locator('select[name=filename]').selectOption(filename);await form.locator('textarea[name=note]').fill(note);},
    submit:()=>form.getByRole('button',{name:'Receive complete project',exact:true}).click()});
  need(result.result.projectId===projectId&&result.result.receipt?.archive?.sha256===file.sha256,
    'ANALYSIS_JOURNEY_RECEIVING','The original receiver returned another project or source archive.');
  return result.result;
}
async function attachReceipt({page,native,actions,h,current,publication,file,key,note}){
  await placeOriginal(file.path,child(h.sourceInboxDirectory,file.name),file);
  const payload={filename:file.name,expectedSha256:file.sha256,expectedBytes:file.bytes,actor:h.actor,note,publicationId:publication.id};let form;
  const result=await actions.perform(key,'analysis.receipt.import',{check:value=>exactPayload(value,payload,'local receiving evidence'),
    prepare:async()=>{await navigate(page,native,h.actor,{projectId:current.projectId,versionId:current.versionId,tab:'transfer'});
      await page.locator('select[name=publicationId]').selectOption(publication.id);form=formFor(page,'Attach original receiving receipt');
      await form.locator('select[name=filename]').selectOption(file.name);await form.locator('textarea[name=note]').fill(note);},
    submit:()=>form.getByRole('button',{name:'Attach original receiving receipt',exact:true}).click()});
  need(result.result.publicationId===publication.id&&result.result.file.sha256===file.sha256,
    'ANALYSIS_JOURNEY_RECEIPT','The local receiving evidence was attached to another original publication.');return result.result;
}


async function verifyDescriptors(files){
  for(const file of files??[])await fileIdentity(file.path,file);
}
function nativeGeometry(){
  const root=document.querySelector('n52-diagram .diagram n52-d3-timeseries-graph .d3 > svg');
  if(!root)return {present:false,groups:[],svg:null};
  const finite=value=>typeof value==='string'&&value.trim()&&/[0-9]/.test(value)&&!/(NaN|Infinity)/.test(value);
  const groups=[...root.querySelectorAll('g.diagram-path')].map(g=>{
    const lines=[...g.querySelectorAll(':scope > path.line')],line=lines.at(-1);
    const points=[...g.querySelectorAll(':scope > circle.graphDots')].filter(n=>Number.isFinite(Number(n.getAttribute('cx')))&&Number.isFinite(Number(n.getAttribute('cy'))));
    const bars=[...g.querySelectorAll(':scope > rect.bar')].filter(n=>Number.isFinite(Number(n.getAttribute('x')))&&Number.isFinite(Number(n.getAttribute('y')))&&Number(n.getAttribute('width'))>0&&Number(n.getAttribute('height'))>=0);
    return {dataPath:finite(line?.getAttribute('d'))?line.getAttribute('d'):null,points:points.length,bars:bars.length};
  });
  return {present:true,groups,svg:root.outerHTML};
}
async function openNativeViewer({page,native,h,view,current,output,signal,scope='original',redact=value=>value}){
  const completePath=child(output,'native-view-complete.json'),saved=await optionalJSON(completePath),
    binding={workspaceId:native.workspaceId,projectId:current.projectId,versionId:current.versionId,
      editionId:current.version.editionId,viewerId:current.version.selection.viewerId,mode:view.mode};
  if(saved){
    need(same(saved.binding,binding),'ANALYSIS_JOURNEY_NATIVE_CHANGED','The retained native rendering belongs to another selected version.');
    await verifyDescriptors(saved.files);return saved;
  }
  signal?.throwIfAborted();const attempt=child(output,'attempt-'+randomUUID());await directory(attempt);
  const observedAt=new Date().toISOString(),metadata=await api(native,'/api/analysis/viewers/'+binding.viewerId+'/'+binding.versionId+'/'+view.mode+'/deployment.json',{signal});
  need(metadata.workspaceId===native.workspaceId&&metadata.versionId===current.versionId&&metadata.viewerId===binding.viewerId&&metadata.mode===view.mode,
    'ANALYSIS_JOURNEY_NATIVE_CHANGED','The native deployment is bound to another saved source.');
  need(metadata.availability?.selected?.available===true,'ANALYSIS_JOURNEY_NATIVE_UNAVAILABLE',
    metadata.availability?.selected?.issue?.message??'This exact original source is unavailable in the native viewer.',metadata.availability?.selected?.issue);
  const requestRecord={schema:'stellar-forge.sensorthings-native-view-request.v1',binding,observedAt,sourceHead:h.sourceHead,
    actualDeployment:metadata,scope,meaning:'Read the actual installed original viewer and retained source; no upstream data request or capture.'};
  await immutable(child(attempt,'view-request.json'),requestRecord);
  const responses=[],problems=[],pending=new Set(),browserErrors=[];let totalBytes=0;
  const onError=error=>{if(browserErrors.length<50)browserErrors.push(redact(String(error.message??error)).slice(0,1600));};
  const onResponse=response=>{
    let url;try{url=new URL(response.url());}catch{return;}
    if(url.origin!==native.origin||!(url.pathname.startsWith(metadata.paths.sta)||url.pathname===metadata.paths.settings))return;
    const run=(async()=>{
      const raw=await response.body();totalBytes+=raw.length;
      need(raw.length<=LIMIT&&totalBytes<=128*1024*1024,'ANALYSIS_JOURNEY_NATIVE_CAPACITY','The exact native response collection exceeded its declared evidence capacity.');
      need(responses.length<10000,'ANALYSIS_JOURNEY_NATIVE_CAPACITY','The original viewer exceeded the response-count capacity.');
      const source=await immutable(child(attempt,'responses/'+digest(raw)+'.json'),raw);
      responses.push({path:url.pathname+url.search,httpStatus:response.status(),method:response.request().method(),file:source,
        contentType:response.headers()['content-type']??null});
    })().catch(error=>{problems.push(error);}).finally(()=>pending.delete(run));
    pending.add(run);
  };
  page.on('response',onResponse);page.on('pageerror',onError);
  let rendering,svgFile=null,screen;
  try{
    await navigate(page,native,h.actor,{projectId:current.projectId,versionId:current.versionId,tab:'viewer'});
    await page.locator('select[name=nativeMode]').selectOption(view.mode);
    const launch=page.getByRole('button',{name:view.mode==='numeric'?'Launch native numeric diagram':'Launch native map',exact:true});
    await launch.waitFor();await launch.click();
    const iframe=page.locator('iframe.native-frame');await iframe.waitFor();
    need(await iframe.getAttribute('src')===metadata.paths.entry,'ANALYSIS_JOURNEY_NATIVE_PATH','The analyst changed the exact native entry or saved permalink.');
    const handle=await iframe.elementHandle(),frame=await handle.contentFrame();
    need(frame,'ANALYSIS_JOURNEY_NATIVE_FRAME','The registered native viewer frame is missing.');
    await frame.locator('#sensorthings-retained-caption').waitFor({timeout:120000});
    if(view.mode==='numeric'){
      need(metadata.nativeNavigation?.applied&&metadata.nativeNavigation.datasets.length>0,
        'ANALYSIS_JOURNEY_NATIVE_SELECTION','The original numeric permalink has no exact selected dataset/time range.');
      await frame.waitForFunction(nativeGeometryReady=> {
        const root=document.querySelector('n52-diagram .diagram n52-d3-timeseries-graph .d3 > svg');if(!root)return false;
        const valid=value=>value&&/[0-9]/.test(value)&&!/(NaN|Infinity)/.test(value);
        const groups=[...root.querySelectorAll('g.diagram-path')].filter(g=>{
          const lines=[...g.querySelectorAll(':scope > path.line')],last=lines.at(-1);
          return valid(last?.getAttribute('d'))||[...g.querySelectorAll(':scope > circle.graphDots')].some(n=>Number.isFinite(Number(n.getAttribute('cx')))&&Number.isFinite(Number(n.getAttribute('cy'))))||
            [...g.querySelectorAll(':scope > rect.bar')].some(n=>Number(n.getAttribute('width'))>0&&Number.isFinite(Number(n.getAttribute('y'))));
        });
        return groups.length>=nativeGeometryReady;
      },metadata.nativeNavigation.datasets.length,{timeout:120000});
      const geometry=await frame.evaluate(nativeGeometry);
      need(geometry.present&&geometry.groups.some(g=>g.dataPath||g.points||g.bars),
        'ANALYSIS_JOURNEY_NATIVE_EMPTY','The original numeric viewer has no actual plotted data geometry.');
      svgFile=await immutable(child(attempt,'native-diagram.svg'),geometry.svg);
      rendering={kind:'native_numeric_diagram',groups:geometry.groups,selectedDatasets:metadata.nativeNavigation.datasets,
        selectedPeriod:metadata.nativeNavigation.period,legendText:await frame.locator('n52-diagram .legend').innerText(),
        renderingLimits:['This original Helgoland component filters zero-valued line/dot samples by a truthiness check.',
          'Native generalization and requested surrounding values can change plotted point counts. Geometry count is not the original observation denominator.'],
        source:{repository:'52North/helgoland-toolbox',commit:'ddd2b20f40ddd5fc80084f8d336644a06d53a484',
          path:'libs/d3/src/lib/d3-timeseries-graph/d3-timeseries-graph.component.ts',gitBlob:'093c8db19069b31ffad33fd77ceace203e37e93e'}};
    }else{
      const expectedUrl=native.origin+metadata.paths.sta;
      const service=frame.locator('n52-custom-service-selector .service-list .service-item')
        .filter({hasText:'OGC SensorThings API'}).filter({hasText:expectedUrl});
      await service.waitFor({timeout:120000});need(await service.count()===1,'ANALYSIS_JOURNEY_NATIVE_PROVIDER','The original provider selection is ambiguous.');
      need(!((await service.getAttribute('class'))??'').includes('unresolvable-service'),
        'ANALYSIS_JOURNEY_NATIVE_PROVIDER','The native client could not resolve this retained provider.');
      const providerText=await service.innerText();await service.click();
      await frame.locator('n52-station-map-selector').waitFor({timeout:120000});
      await frame.waitForFunction(()=>{
        const root=document.querySelector('n52-station-map-selector #timeseries');if(!root)return false;
        const shown=node=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0;};
        return [...root.querySelectorAll('.leaflet-marker-pane .leaflet-marker-icon')].some(shown)||
          [...root.querySelectorAll('.leaflet-overlay-pane svg path.leaflet-interactive')].some(n=>shown(n)&&n.getAttribute('d')&&!/(NaN|Infinity)/.test(n.getAttribute('d')));
      },null,{timeout:120000});
      const geometry=await frame.evaluate(()=>{
        const root=document.querySelector('n52-station-map-selector #timeseries'),shown=n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0;};
        return {markerOrClusterIcons:[...root.querySelectorAll('.leaflet-marker-pane .leaflet-marker-icon')].filter(shown).length,
          vectorPaths:[...root.querySelectorAll('.leaflet-overlay-pane svg path.leaflet-interactive')].filter(n=>shown(n)&&n.getAttribute('d')).length};
      });
      rendering={kind:'native_map_selection',providerLabel:'OGC SensorThings API',providerUrl:expectedUrl,providerText,
        stationMapPresent:true,geometry,stationGeometrySource:{repository:'52North/helgoland-toolbox',commit:'ddd2b20f40ddd5fc80084f8d336644a06d53a484',
          path:'libs/map/src/lib/selector/station-map-selector/station-map-selector.component.ts',gitBlob:'0b88321ee15eba2daaf1471acfd50d46bc78f0b1'},source:{repository:'52North/helgoland',commit:'a17117b955d3453af0cfc056be012ded507426b0',
          path:'src/common/timeseries/map-selection/map-selection.component.ts',gitBlob:'66d2f44dfed55f56d0a436c1c926e4116d4a51f7'},
        meaning:'Actual original provider, visible native feature geometry and retained STA responses. Cluster icons are not station counts; the original component skips platforms without source geometry.'};
    }
    await page.waitForLoadState('networkidle',{timeout:30000});
    while(pending.size)await Promise.allSettled([...pending]);
    if(problems.length)throw new AggregateError(problems,'An original native response could not be retained completely.');
    need(responses.some(r=>r.path.startsWith(metadata.paths.sta)&&r.httpStatus===200),
      'ANALYSIS_JOURNEY_NATIVE_REQUEST','The installed original connector did not read this retained STA endpoint.');
    need(responses.every(r=>r.httpStatus>=200&&r.httpStatus<300),
      'ANALYSIS_JOURNEY_NATIVE_RESPONSE','The original native connector returned an unresolved response.',responses.filter(r=>r.httpStatus<200||r.httpStatus>=300).map(r=>({path:r.path,status:r.httpStatus})));
    screen=await screenshot(page,attempt,'native-'+view.mode+'.png',binding);
    if(svgFile)rendering.svg=svgFile;
  }finally{
    page.off('response',onResponse);page.off('pageerror',onError);
    while(pending.size)await Promise.allSettled([...pending]);
    const close=page.getByRole('button',{name:'Close viewer',exact:true});
    if(await close.count())await close.click().catch(()=>{});
  }
  const files=[screen,...(svgFile?[svgFile]:[]),...responses.map(r=>r.file)];
  const record={schema:'stellar-forge.sensorthings-native-view-evidence.v1',binding,observedAt,completedAt:new Date().toISOString(),
    sourceHead:h.sourceHead,actualDeployment:metadata,rendering,responses,browserErrors,files,
    meaning:'Actual local native Helgoland rendering and retained source responses. This is not provider uptime, scientific approval or external customer acceptance.'};
  const evidence=await immutable(child(attempt,'native-view-evidence.json'),record);
  const result={...record,evidence,files:[...files,evidence]};await immutable(completePath,result);return result;
}
async function browserPublicationDownload({page,native,h,current,publication,output,signal}){
  const path=child(output,'browser-download.json'),prior=await optionalJSON(path);
  if(prior){await verifyDescriptors(prior.files);return prior;}
  signal?.throwIfAborted();await navigate(page,native,h.actor,{projectId:current.projectId,versionId:current.versionId,tab:'publish'});
  const row=page.locator('#pane table tbody tr').filter({hasText:publication.id});
  await row.getByRole('button',{name:'Review complete publication',exact:true}).click();
  const listed=await api(native,'/api/files?selection='+encodeURIComponent(JSON.stringify({kind:'analysis',id:publication.id})),{signal});
  const file=listed.files.find(f=>/\.html$/i.test(f.name)&&f.bytes<=64*1024*1024)??listed.files.find(f=>f.bytes<=64*1024*1024);
  need(file,'ANALYSIS_JOURNEY_BROWSER_DOWNLOAD','The original publication has no supported complete browser download.');
  const selected=page.locator('#detail-body table tbody tr').filter({hasText:file.sha256});
  need(await selected.count()===1,'ANALYSIS_JOURNEY_BROWSER_DOWNLOAD','The original file row is ambiguous.');
  const attempt=child(output,'browser-attempt-'+randomUUID());await directory(attempt);
  const waiting=page.waitForEvent('download',{timeout:120000}).then(value=>({value}),error=>({error}));
  await selected.getByRole('button',{name:'Download exact file',exact:true}).click();
  const observed=await waiting;if(observed.error)throw observed.error;const download=observed.value;
  const failure=await download.failure();need(!failure,'ANALYSIS_JOURNEY_BROWSER_DOWNLOAD','The actual native file download did not finish.');
  const temporary=await download.path();need(temporary,'ANALYSIS_JOURNEY_BROWSER_DOWNLOAD','The original downloaded file is unavailable.');
  const received=await placeOriginal(temporary,child(attempt,file.name),file);
  await page.locator('#close-detail').click();
  const result={schema:'stellar-forge.sensorthings-native-browser-download.v1',workspaceId:native.workspaceId,publicationId:publication.id,
    selection:file.selection,files:[received],meaning:'Complete original browser download, bound by native manifest, length and SHA256.'};
  await immutable(path,result);return result;
}
function flatReceived(download,file){
  const exact=download.files.find(x=>x.sha256===file.sha256&&x.bytes===file.bytes&&x.originalName===(file.name??file.filename));
  need(exact,'ANALYSIS_JOURNEY_RECEIVING','The complete native file receiver did not return the selected exact original file.');
  return {...exact,name:exact.originalName};
}
async function verifyProjectClosure(native,expected,{signal,allowHistorical=false}={}){
  const project=await api(native,'/api/analysis/projects/'+expected.projectId,{signal});
  const version=await api(native,'/api/analysis/versions/'+expected.versionId,{signal});
  const summary=await api(native,'/api/analysis/versions/'+expected.versionId+'/summary',{signal});
  need((allowHistorical||project.project.headVersionId===expected.versionId)&&same(version,expected.version)&&same(summary,expected.summary),
    'ANALYSIS_JOURNEY_REOPEN_CHANGED','The received project head, original saved selection or complete selected data summary differs.');
  const viewer=await api(native,'/api/analysis/viewers/'+version.selection.viewerId,{signal});
  need(same(viewer,expected.viewer),'ANALYSIS_JOURNEY_REOPEN_CHANGED','The original installed viewer archive/source edition differs after receiving.');
  const sourceFiles=[];
  for(const original of expected.editions){
    const edition=await api(native,'/api/editions/'+original.id+'/metadata',{signal});
    need(same(edition,original),'ANALYSIS_JOURNEY_REOPEN_CHANGED','The original retained source edition differs after receiving.');
    for(const source of edition.sourceFiles){
      signal?.throwIfAborted();const bytes=await native.server.workspace.store.object(source.sha256);
      need(bytes.length===source.bytes&&digest(bytes)===source.sha256,'ANALYSIS_JOURNEY_SOURCE_CHANGED','A complete original source object is unavailable.');
      sourceFiles.push({sha256:source.sha256,bytes:source.bytes});
    }
  }
  for(const original of [viewer.archive,...viewer.files,...viewer.upstreamSources]){
    signal?.throwIfAborted();const bytes=await native.server.workspace.store.object(original.sha256);
    need(bytes.length===original.bytes&&digest(bytes)===original.sha256,'ANALYSIS_JOURNEY_VIEWER_CHANGED','A complete original viewer/license object is unavailable after receiving.');
  }
  for(const id of expected.publicationIds){
    const actual=await api(native,'/api/analysis/publications/'+id,{signal});
    const original=expected.publications.find(p=>p.id===id);
    need(same(actual,original),'ANALYSIS_JOURNEY_PUBLICATION_CHANGED','An original frozen publication changed after receiving.');
    for(const file of actual.files){
      need(KEY.test(file.storage?.operationId??'')&&file.storage?.filename===file.name,
        'ANALYSIS_JOURNEY_PUBLICATION_CHANGED','An original publication file lost its retained storage identity.');
      await fileIdentity(child(native.server.workspace.store.root,'exports/'+file.storage.operationId+'/'+file.storage.filename),file);
    }
  }
  need(expected.versionIds.every(id=>project.versions.some(v=>v.id===id))&&expected.comparisonIds.every(id=>project.comparisons.some(c=>c.id===id)),
    'ANALYSIS_JOURNEY_HISTORY_CHANGED','The original version/comparison history is incomplete after receiving.');
  return {projectId:expected.projectId,versionId:version.id,viewerId:viewer.id,sourceFiles,
    versionIds:project.versions.map(x=>x.id),comparisonIds:project.comparisons.map(x=>x.id),publicationIds:project.publications.map(x=>x.id),
    receivingIds:project.receipts.map(x=>x.id),meaning:'Original source, viewer, selected summary, publications and saved history were actually re-read.'};
}


function redactWith(secrets){
  return value=>{let text=String(value);
    for(const secret of secrets)if(secret)text=text.split(secret).join('[private session]');
    return text.replace(/(Bearer\s+)[A-Za-z0-9._~-]{24,}/gi,'$1[private session]')
      .replace(/(https?:\/\/(?:127\.0\.0\.1|\[::1\])(?::[0-9]+)?\/[^ \n"'<>#]*)#[A-Za-z0-9_-]{32,200}/g,'$1#[private session]');};
}
function disjoint(a,b){const inside=(x,y)=>{const r=relative(x,y);return r===''||(!r.startsWith('..')&&!isAbsolute(r));};return !inside(a,b)&&!inside(b,a);}
async function acquireJourneyLease(output){
  const lock=child(output,'journey.lock'),handle=await open(lock,constants.O_CREAT|constants.O_RDWR|(constants.O_NOFOLLOW??0),0o600);
  try{need((await handle.stat()).isFile(),'ANALYSIS_JOURNEY_LOCK','The original journal lock is not a regular file.');}finally{await handle.close();}
  const helper=spawn('flock',['--exclusive','--nonblock',lock,process.execPath,'-e',
    "process.stdout.write('LOCKED\\n');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));"],
    {stdio:['pipe','pipe','pipe'],windowsHide:true});
  let locked=false,closed=false,failure=null,outputText='';
  const ended=new Promise(resolve=>{
    helper.once('error',error=>{failure=error;closed=true;resolve();});
    helper.once('close',(code,signal)=>{closed=true;if(locked&&code!==0)failure=Object.assign(new Error('The original journey lease ended unexpectedly.'),{code:'ANALYSIS_JOURNEY_LEASE_LOST',details:{exitCode:code,signal}});resolve();});
  });
  try{
    await new Promise((yes,no)=>{
      helper.once('error',no);
      helper.stdout.on('data',part=>{outputText=(outputText+part).slice(-100);if(outputText.includes('LOCKED\n')){locked=true;yes();}});
      helper.once('close',code=>{if(!locked)no(Object.assign(new Error(code===1?'This exact native journey is already owned by another process.':'The original journal lease did not start.'),{code:'ANALYSIS_JOURNEY_BUSY'}));});
      helper.stderr.on('data',()=>{});
    });
  }catch(error){if(!closed)helper.stdin.end();await ended;throw error;}
  return {assert(){need(locked&&!closed,'ANALYSIS_JOURNEY_LEASE_LOST','The original native journal owner is no longer active.');},
    async close(){if(!closed)helper.stdin.end();await ended;if(failure)throw failure;}};
}
async function openBrowser({playwrightModule,browserExecutable,output,origins,redact}){
  need(isAbsolute(playwrightModule)&&isAbsolute(browserExecutable),'ANALYSIS_JOURNEY_BROWSER','Use the actual existing Playwright module and Chromium executable.');
  const library=await import(pathToFileURL(playwrightModule).href),chromium=library.chromium??library.default?.chromium;
  need(chromium?.launchServer&&chromium?.connect,'ANALYSIS_JOURNEY_BROWSER','The selected original Playwright runtime is incomplete.');
  await directory(output);const rejected=[];let owned=null,browser=null,context=null,closed=false;
  async function close(){
    if(closed)return;closed=true;const errors=[];
    if(context)try{await context.close();}catch(e){errors.push(e);}
    if(browser)try{await browser.close();}catch(e){errors.push(e);}
    if(owned){
      // BrowserServer.kill is limited to this exact launched browser. A stalled
      // graceful shutdown never authorizes a host-wide process action.
      let timer;
      const graceful=owned.close().then(()=>({ok:true}),error=>({error}));
      const outcome=await Promise.race([graceful,new Promise(resolve=>{timer=setTimeout(()=>resolve({timeout:true}),10000);})]);
      clearTimeout(timer);
      if(outcome.timeout){try{await owned.kill();}catch(e){errors.push(e);}const drained=await graceful;if(drained.error)errors.push(drained.error);
        errors.push(Object.assign(new Error('The owned browser needed forced shutdown after its drain interval.'),{code:'ANALYSIS_JOURNEY_BROWSER_DRAIN'}));}
      else if(outcome.error)errors.push(outcome.error);
    }
    if(errors.length)throw new AggregateError(errors,'The original browser did not finish a clean native drain.');
  }
  try{
    owned=await chromium.launchServer({headless:true,executablePath:browserExecutable,host:'127.0.0.1',
      handleSIGINT:false,handleSIGTERM:false,handleSIGHUP:false,
      args:['--disable-dev-shm-usage'],downloadsPath:child(output,'downloads'),timeout:120000});
    browser=await chromium.connect(owned.wsEndpoint());
    context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,serviceWorkers:'block'});
    await context.route('**/*',async route=>{
      const request=route.request();let url;try{url=new URL(request.url());}catch{await route.abort('blockedbyclient');return;}
      if(['data:','blob:','about:'].includes(url.protocol)){await route.continue();return;}
      if(!origins.has(url.origin)){
        if(rejected.length<100)rejected.push({origin:url.origin,path:redact(url.pathname),method:request.method()});
        await route.abort('blockedbyclient');return;
      }
      await route.continue();
    });
    return {context,browser,owned,rejected,async page(){const p=await context.newPage();p.setDefaultTimeout(60000);p.setDefaultNavigationTimeout(60000);return p;},close};
  }catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'Original browser setup/cleanup failed.');}throw error;}
}
async function bindReceiving(h,output){
  const plan={schema:'stellar-forge.sensorthings-analysis-native-receiving-plan.v1',operationId:h.operationId,
    originalWorkspaceId:h.workspaceId,directory:h.receivingDirectory,inboxDirectory:h.receivingInboxDirectory,
    meaning:'A distinct new receiving workspace for the original immutable project archives. No historical database replacement.'},
    path=child(output,'receiving-plan.json'),prior=await optionalJSON(path);
  if(prior)need(same(prior,plan),'ANALYSIS_JOURNEY_RECEIVING_CHANGED','The original receiving directory or request changed.');
  else{
    for(const target of [h.receivingDirectory,h.receivingInboxDirectory]){
      try{const entries=await readdir(target);need(entries.length===0,'ANALYSIS_JOURNEY_RECEIVING_OCCUPIED','Use a new empty receiving directory; preserve the existing workspace or inbox.',{path:target});}
      catch(error){if(error.code!=='ENOENT')throw error;}
    }
    await immutable(path,plan);
  }
  await directory(h.receivingDirectory);await directory(h.receivingInboxDirectory);
  await immutable(child(h.receivingDirectory,'analysis-native-receiving-plan.json'),plan);
  const saved=await optionalJSON(child(output,'receiving-identity.json'));
  if(saved)need(saved.operationId===h.operationId&&saved.directory===h.receivingDirectory&&UUID.test(saved.workspaceId),
    'ANALYSIS_JOURNEY_RECEIVING_CHANGED','The retained receiving identity differs.');
  return saved;
}
async function expectedProject(native,current,{signal}={}){
  const state=await api(native,'/api/analysis/projects/'+current.projectId,{signal}),
    version=await api(native,'/api/analysis/versions/'+current.versionId,{signal}),
    summary=await api(native,'/api/analysis/versions/'+current.versionId+'/summary',{signal}),
    viewer=await api(native,'/api/analysis/viewers/'+version.selection.viewerId,{signal});
  need(state.project.headVersionId===current.versionId,'ANALYSIS_JOURNEY_HEAD_CHANGED','The selected original project has a different current head.');
  const editionIds=new Set(state.versions.map(v=>v.editionId));
  for(const comparison of state.comparisons){editionIds.add(comparison.leftEditionId);editionIds.add(comparison.rightEditionId);}
  const editions=[];for(const id of [...editionIds].sort())editions.push(await api(native,'/api/editions/'+id+'/metadata',{signal}));
  return {schema:'stellar-forge.sensorthings-native-project-expectation.v1',projectId:state.project.id,versionId:version.id,
    version,summary,viewer,editions,versionIds:state.versions.map(x=>x.id),comparisonIds:state.comparisons.map(x=>x.id),
    publicationIds:state.publications.map(x=>x.id),publications:state.publications,receiptIds:state.receipts.map(x=>x.id)};
}
function fileSet(download){return download.files.map(f=>({name:f.originalName,type:f.type,bytes:f.bytes,sha256:f.sha256})).sort((a,b)=>a.name.localeCompare(b.name));}
async function stageEvidenceSet({page,native,actions,h,view,current,nativeView}){
  const selected=[{...nativeView.evidence,extension:'json',title:'Actual native '+view.mode+' response and rendering record'},
    {...nativeView.files.find(f=>f.path.endsWith('.png')),extension:'png',title:'Actual original native '+view.mode+' view'},
    ...(nativeView.rendering.svg?[{...nativeView.rendering.svg,extension:'svg',title:'Actual original native numeric diagram geometry'}]:[])];
  const records=[];
  for(let i=0;i<selected.length;i++){
    const item=selected[i];need(HASH.test(item.sha256??''),'ANALYSIS_JOURNEY_EVIDENCE','A complete actual native evidence file is missing.');
    const file={...item,name:'native-'+view.key+'-'+item.sha256.slice(0,20)+'.'+item.extension};
    records.push(await receiveEvidence({page,native,actions,h,current,key:view.key+'-native-evidence-'+i,file,title:item.title,
      note:view.sourceNote+' Actual local Helgoland rendering bound to original source edition '+current.version.editionId+
        ', saved analysis version '+current.versionId+' and complete file SHA256 '+file.sha256+'. The source result representation remains unchanged.'}));
  }
  return records;
}
async function verifyExpectedFiles(root){
  const records=[];
  async function walk(path){
    for(const entry of await readdir(path,{withFileTypes:true})){
      const target=join(path,entry.name);
      if(entry.isDirectory())await walk(target);
      else if(entry.isFile()&&entry.name==='complete.json'){
        const record=await jsonFile(target);
        if(record.schema==='stellar-forge.sensorthings-native-downloaded-files.v1'){await verifyDescriptors(record.files);records.push({workspaceId:record.workspaceId,selection:record.selection,files:record.files});}
      }
    }
  }
  await walk(root);return records;
}
async function verifyCompleted(result){
  need(result.schema===VERSION&&result.state==='COMPLETE','ANALYSIS_JOURNEY_RESULT','The original complete native result has an unsupported shape.');
  for(const file of result.files??[])await fileIdentity(file.path,file);
  for(const record of result.projects??[]){
    await verifyDescriptors(record.originalView.files);await verifyDescriptors(record.receivedView.files);
    await verifyDescriptors(record.browserDownload.files);
    await verifyDescriptors(record.publicationDownload.files);await verifyDescriptors(record.receivedPublicationDownload.files);
    await verifyDescriptors(record.initialProjectDownload.files);await verifyDescriptors(record.finalProjectDownload.files);
    await verifyDescriptors(record.receivingProjectDownload.files);
  }
  if(result.python){
    await fileIdentity(result.python.requestFile.path,result.python.requestFile);
    need(Array.isArray(result.python.sourceFiles)&&result.python.sourceFiles.length>0,
      'ANALYSIS_JOURNEY_PYTHON_RESULT','The complete original downloaded source closure is absent.');
    await verifyDescriptors(result.python.sourceFiles);
    await fileIdentity(result.python.completeFile.path,result.python.completeFile);
    await verifyDescriptors(result.python.result.files);
    await fileIdentity(result.python.result.delivery.path,result.python.result.delivery);
  }
  if(result.reopen){await fileIdentity(result.reopen.file.path,result.reopen.file);const childResult=await jsonFile(result.reopen.file.path);
    need(childResult.state==='COMPLETE'&&childResult.planSha256===result.reopen.planSha256,'ANALYSIS_JOURNEY_REOPEN_CHANGED','The saved fresh-process readback changed.');
    await verifyDescriptors(childResult.files);}
  return result;
}
async function runOwnedNode(args,{signal,redact,log,outputLimit=1024*1024,executable=process.execPath,environment=process.env}={}){
  signal?.throwIfAborted();const processChild=spawn(executable,args,{stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32',windowsHide:true,env:environment});
  let bytes=0,lines='',errors='',spawnError=null,stopped=false,timer=null;
  const append=(part,stderr=false)=>{
    bytes+=part.length;if(bytes>outputLimit){if(!stopped)stop();return;}
    if(stderr)errors=(errors+part.toString('utf8')).slice(-32000);
    else{lines+=part.toString('utf8');let at;while((at=lines.indexOf('\n'))>=0){log?.(redact(lines.slice(0,at)));lines=lines.slice(at+1);}}
  };
  processChild.stdout.on('data',part=>append(part));processChild.stderr.on('data',part=>append(part,true));
  const send=signalName=>{if(!processChild.pid)return;try{
    if(process.platform==='win32')processChild.kill(signalName);else process.kill(-processChild.pid,signalName);
  }catch(error){if(error.code!=='ESRCH')throw error;}};
  function stop(){if(stopped)return;stopped=true;send('SIGTERM');timer=setTimeout(()=>{try{send('SIGKILL');}catch{}},10000);}
  const abort=()=>stop();signal?.addEventListener('abort',abort,{once:true});
  const ended=await new Promise(resolve=>{
    processChild.once('error',error=>{spawnError=error;resolve({exitCode:null,signal:null});});
    processChild.once('close',(exitCode,exitSignal)=>resolve({exitCode,signal:exitSignal}));
  });
  clearTimeout(timer);signal?.removeEventListener('abort',abort);
  if(lines)log?.(redact(lines));
  if(spawnError)throw spawnError;
  need(bytes<=outputLimit,'ANALYSIS_JOURNEY_CHILD_OUTPUT','The same native child exceeded its bounded diagnostic output.');
  if(signal?.aborted)signal.throwIfAborted();
  need(ended.exitCode===0,'ANALYSIS_JOURNEY_CHILD','The original same-journey child did not complete.',{...ended,stderr:redact(errors)});
  return {...ended,stdoutBytes:bytes};
}
async function readOnlyReopen({plan,planSha256,output,playwrightModule,browserExecutable,signal,progress=()=>{}}){
  need(plan.schema==='stellar-forge.sensorthings-analysis-native-reopen-plan.v1'&&HASH.test(planSha256)&&UUID.test(plan.receivingWorkspaceId),
    'ANALYSIS_JOURNEY_REOPEN','Use the exact original receiving plan.');
  const secrets=new Set(),redact=redactWith(secrets),errors=[],origins=new Set();
  let native=null,browser=null,result=null;
  try{
    native=await startNative(plan.handoff,{received:true,expectedWorkspaceId:plan.receivingWorkspaceId});secrets.add(native.token);origins.add(native.origin);
    const before=await api(native,'/api/view',{signal});
    browser=await openBrowser({playwrightModule,browserExecutable,output:child(output,'browser'),origins,redact});
    const page=await browser.page();
    // This child is a pure application reopen: any unexpected UI mutation is
    // blocked, and the unchanged workspace revision is checked afterward.
    await page.route('**/api/action',route=>route.abort('blockedbyclient'));
    const readbacks=[],files=[];
    for(const item of plan.projects){
      signal?.throwIfAborted();const readback=await verifyProjectClosure(native,item.expected,{signal});
      const current={projectId:item.expected.projectId,versionId:item.expected.versionId,version:item.expected.version};
      await navigate(page,native,plan.handoff.actor,{projectId:current.projectId,versionId:current.versionId,tab:'overview'});
      const view=await openNativeViewer({page,native,h:plan.handoff,view:item.view,current,
        output:child(output,item.view.key),signal,scope:'fresh-process-reopen',redact});
      const fullPage=await screenshot(page,child(output,item.view.key),'reopened-project-'+randomUUID()+'.png',{workspaceId:native.workspaceId,...readback});
      files.push(...view.files,fullPage);readbacks.push({key:item.view.key,...readback,nativeView:view});
      progress({stage:'Fresh process reopened exact received analysis',projectId:current.projectId,versionId:current.versionId});
    }
    need(browser.rejected.length===0,'ANALYSIS_JOURNEY_EXTERNAL_REQUEST','The native viewer attempted an unconfigured external request.',browser.rejected);
    const after=await api(native,'/api/view',{signal});
    need(before.revision===after.revision&&same(before,after),'ANALYSIS_JOURNEY_REOPEN_MUTATED','The pure application reopen changed original workspace state.');
    result={schema:'stellar-forge.sensorthings-analysis-native-reopen-result.v1',state:'COMPLETE',planSha256,
      workspaceId:native.workspaceId,beforeRevision:before.revision,afterRevision:after.revision,projects:readbacks,files,
      meaning:'A separate Node process reopened the same received application and original source/view/publication objects without a business action.'};
  }catch(error){errors.push(error);}
  finally{
    if(browser)try{await browser.close();}catch(error){errors.push(error);}
    if(native)try{await native.close();}catch(error){errors.push(error);}
  }
  if(errors.length)throw new AggregateError(errors,'The original fresh-process receiving reopen did not complete.');
  await immutable(child(output,'reopen-result.json'),result);return result;
}
async function completeView({page,receivedPage,native,received,actions,receivedActions,h,view,viewer,output,signal,redact,progress}){
  await directory(output);
  const prior=await optionalJSON(child(output,'project-result.json'));
  if(prior){
    need(prior.key===view.key&&prior.viewerId===viewer.id&&same(prior.view,view),'ANALYSIS_JOURNEY_REQUEST_CHANGED','The complete original view belongs to another selection.');
    await verifyDescriptors(prior.originalView.files);await verifyDescriptors(prior.receivedView.files);
    for(const record of [prior.browserDownload,prior.publicationDownload,prior.receivedPublicationDownload,
      prior.initialProjectDownload,prior.finalProjectDownload,prior.receivingProjectDownload])await verifyDescriptors(record.files);
    await verifyProjectClosure(received,prior.receivedExpected,{signal});
    return prior;
  }
  const created=await createAnalysis({page,native,actions,h,view,viewerId:viewer.id});
  await reviewEdition({page,native,actions,h,editionId:view.editionId,decision:view.review,scope:'original-'+view.key});
  const current=await annotateAnalysis({page,native,actions,h,view,current:created});
  const comparison=await compareEdition({page,native,actions,h,view,current});
  const originalView=await openNativeViewer({page,native,h,view,current,output:child(output,'native-original'),signal,redact});
  progress({stage:'Actual original native view completed',key:view.key,projectId:current.projectId,versionId:current.versionId});
  const evidence=await stageEvidenceSet({page,native,actions,h,view,current,nativeView:originalView});
  const publication=await publishAnalysis({page,native,actions,h,view,current,comparison,evidence});
  const browserDownload=await browserPublicationDownload({page,native,h,current,publication,output:child(output,'browser-publication'),signal});
  const publicationDownload=await nativeFiles(native,{kind:'analysis',id:publication.id},child(output,'publication-original'),signal);
  const expectedPath=child(output,'original-project-expectation.json');
  let expected=await optionalJSON(expectedPath);
  if(expected){need(expected.projectId===current.projectId&&expected.versionId===current.versionId,'ANALYSIS_JOURNEY_EXPECTATION_CHANGED','The frozen original project expectation changed.');
    await verifyProjectClosure(native,expected,{signal});}
  else{expected=await expectedProject(native,current,{signal});await immutable(expectedPath,expected);}
  const initialExport=await exportAnalysis({page,native,actions,h,current,key:view.key+'-initial-export',
    note:'Complete original project, sources, viewer, publication and history for the explicitly selected local receiving workspace. '+view.sourceNote});
  const initialProjectDownload=await nativeFiles(native,{kind:'analysis',id:initialExport.id},child(output,'project-initial'),signal);
  const originalArchive=flatReceived(initialProjectDownload,initialExport.file);
  const firstImport=await importAnalysis({page:receivedPage,native:received,actions:receivedActions,h,key:view.key+'-initial-import',file:originalArchive,
    note:'Receive the complete original project from workspace '+native.workspaceId+'; preserve source/view/publication identities and require a local source review.',projectId:current.projectId});
  const firstReadbackPath=child(output,'received-initial-readback.json');
  let firstReadback=await optionalJSON(firstReadbackPath);
  if(firstReadback){
    need(firstReadback.projectId===current.projectId&&firstReadback.versionId===current.versionId,
      'ANALYSIS_JOURNEY_REOPEN_CHANGED','The retained initial receiving readback changed.');
    await verifyProjectClosure(received,expected,{signal,allowHistorical:true});
  }else{firstReadback=await verifyProjectClosure(received,expected,{signal});await immutable(firstReadbackPath,firstReadback);}
  await reviewEdition({page:receivedPage,native:received,actions:receivedActions,h,editionId:view.editionId,
    decision:view.receivingReview,scope:'receiving-'+view.key});
  const receivedView=await openNativeViewer({page:receivedPage,native:received,h,view,current,
    output:child(output,'native-received'),signal,scope:'received-workspace',redact});
  const receivedPublicationDownload=await nativeFiles(received,{kind:'analysis',id:publication.id},child(output,'publication-received'),signal);
  need(same(fileSet(publicationDownload),fileSet(receivedPublicationDownload)),
    'ANALYSIS_JOURNEY_PUBLICATION_CHANGED','The original file receiver returned a different publication after project receiving.');
  let localCurrent=current;
  if(view.receivingAnnotation){
    localCurrent=await annotateAnalysis({page:receivedPage,native:received,actions:receivedActions,h,
      view:{...view,key:view.key+'-receiving',annotation:view.receivingAnnotation},current});
  }
  const localState=await api(received,'/api/analysis/projects/'+localCurrent.projectId,{signal});
  need(localState.project.headVersionId===localCurrent.versionId,'ANALYSIS_JOURNEY_LOCAL_HEAD_CHANGED','The receiving analysis advanced outside this retained continuation.');
  const receiptPath=child(output,'local-receiving-receipt.json');
  let receipt=await optionalJSON(receiptPath);
  const receiptBody={schema:'stellar-forge.sensorthings-analysis-local-receipt.v1',originalWorkspaceId:native.workspaceId,
    receivingWorkspaceId:received.workspaceId,projectId:current.projectId,originalVersionId:current.versionId,
    receivedCurrentVersionId:localCurrent.versionId,publicationId:publication.id,originalArchive:{bytes:originalArchive.bytes,sha256:originalArchive.sha256},
    receivingOperationId:firstImport.id,files:fileSet(receivedPublicationDownload),sourceReadback:firstReadback,
    nativeEvidence:{bytes:receivedView.evidence.bytes,sha256:receivedView.evidence.sha256},actor:h.actor,
    meaning:'Actual local file receiving and native application readback. This is not an external customer acknowledgement or scientific approval.'};
  if(receipt){const {recordedAt,...body}=receipt;need(same(body,receiptBody),'ANALYSIS_JOURNEY_RECEIPT_CHANGED','The saved original local receipt differs.');}
  else{receipt={...receiptBody,recordedAt:new Date().toISOString()};await immutable(receiptPath,receipt);}
  const receiptFile={...await fileIdentity(receiptPath),name:'receiving-'+view.key+'-'+digest(Buffer.from(canonical(receipt))).slice(0,16)+'.json'};
  const attached=await attachReceipt({page,native,actions,h,current,publication,file:receiptFile,key:view.key+'-attach-receipt',
    note:'Actual local receiving workspace '+received.workspaceId+' verified this publication and reopened its original native view. '+receiptBody.meaning});
  const finalExport=await exportAnalysis({page,native,actions,h,current,key:view.key+'-final-export',
    note:'Complete original project after retaining actual local publication receiving evidence. All previous source, version, publication and receipt records remain included.'});
  const finalProjectDownload=await nativeFiles(native,{kind:'analysis',id:finalExport.id},child(output,'project-final'),signal);
  const finalArchive=flatReceived(finalProjectDownload,finalExport.file);
  const finalImport=await importAnalysis({page:receivedPage,native:received,actions:receivedActions,h,key:view.key+'-final-import',file:finalArchive,
    note:'Receive the later full original project archive containing its actual local receiving receipt; preserve the current local head and original history.',projectId:current.projectId});
  need(finalImport.preservedLocalHeadVersionId===localCurrent.versionId,'ANALYSIS_JOURNEY_LOCAL_HEAD_CHANGED','Receiving the final source archive replaced the existing local analysis head.');
  const receivedExpected=await expectedProject(received,localCurrent,{signal});
  need(expected.versionIds.every(id=>receivedExpected.versionIds.includes(id))&&receivedExpected.receiptIds.includes(attached.id),
    'ANALYSIS_JOURNEY_HISTORY_CHANGED','The final received project lost an original version or actual attached receipt.');
  const finalReadback=await verifyProjectClosure(received,receivedExpected,{signal});
  await immutable(child(output,'received-final-expectation.json'),receivedExpected);
  await immutable(child(output,'received-final-readback.json'),finalReadback);
  const receivingExport=await exportAnalysis({page:receivedPage,native:received,actions:receivedActions,h,current:localCurrent,
    key:view.key+'-receiving-export',note:'Complete received editable project, preserved original history, local source review and any explicitly attributed continued edit.'});
  const receivingProjectDownload=await nativeFiles(received,{kind:'analysis',id:receivingExport.id},child(output,'receiving-final-backup'),signal);
  progress({stage:'Publication, complete project receiving and final backup completed',key:view.key,projectId:current.projectId,publicationId:publication.id,
    receivingWorkspaceId:received.workspaceId,sourceArchiveSha256:finalArchive.sha256});
  return {key:view.key,view,current,localCurrent,viewerId:viewer.id,comparison,evidence,publication,originalView,receivedView,browserDownload,
    publicationDownload,receivedPublicationDownload,initialExport,initialProjectDownload,firstImport,receiptFile,attached,
    finalExport,finalProjectDownload,finalImport,receivingExport,receivingProjectDownload,receivedExpected};
}


async function preparePythonSources({page,native,actions,h,output,signal,progress}){
  const configuration=h.python;await directory(output);
  const requested=[];
  for(const selected of configuration.sources){
    signal?.throwIfAborted();
    const original=await api(native,'/api/view',{signal}),exported=original.exports.find(x=>x.id===selected.exportId);
    need(exported?.editionId===selected.editionId&&exported.schema==='stellar-forge.sensorthings-transfer-receipt.v1'&&
      exported.originalWorkspaceId===native.workspaceId&&HASH.test(exported.file?.sha256??''),
      'ANALYSIS_JOURNEY_PYTHON_SOURCE','Select the already completed original edition.export receipt for this exact source.');
    if(selected.exportSha256)need(exported.file.sha256===selected.exportSha256,'ANALYSIS_JOURNEY_PYTHON_SOURCE','The original source export bytes changed.');
    const key='python-'+selected.name+'-prepare',payload={editionId:selected.editionId,exportId:selected.exportId,actor:h.actor},
      check=value=>exactPayload(value,payload,'original Python source preparation');
    let prepared=null,originalOperation=null;
    const prior=await recoverAction(actions,key,'analysis.python.prepare',check);
    if(prior){prepared=prior.result;originalOperation=prior.operationId;}
    else{
      const overview=await api(native,'/api/analysis',{signal});
      const existing=(overview.pythonSources??[]).filter(x=>x.editionId===selected.editionId&&x.exportId===selected.exportId&&
        (!selected.preparationId||x.id===selected.preparationId));
      need(existing.length<=1,'ANALYSIS_JOURNEY_PYTHON_PREPARATION','Retain the exact selected existing Python preparation ID.');
      if(existing.length){
        prepared=existing[0];
        need(Array.isArray(prepared.files),'ANALYSIS_JOURNEY_PYTHON_PREPARATION','The installed overview must expose the complete retained original preparation record.');
      }else{
        let form;
        const result=await actions.perform(key,'analysis.python.prepare',{check,
          prepare:async()=>{
            await navigate(page,native,h.actor,{tab:'transfer'});
            const editionChoice=page.locator('#pane select[name=pythonEditionId]');
            need(await editionChoice.count()===1,'ANALYSIS_JOURNEY_PYTHON_UI','Install the original Python analysis handover pane.');
            await editionChoice.selectOption(selected.editionId);
            form=page.locator('#pane form').filter({has:page.locator('select[name=pythonExportId]')});
            need(await form.count()===1,'ANALYSIS_JOURNEY_PYTHON_UI','Use the current Prepare the complete analysis source form.');
            await form.locator('select[name=pythonExportId] option[value="'+selected.exportId+'"]').waitFor({state:'attached'});
            await form.locator('select[name=pythonExportId]').selectOption(selected.exportId);
          },
          submit:()=>form.locator('button[type=submit]').click()});
        prepared=result.result;originalOperation=result.operationId;
      }
    }
    need(prepared.schema==='stellar-forge.sensorthings-python-source.v1'&&prepared.editionId===selected.editionId&&
      prepared.exportId===selected.exportId&&prepared.exportSha256===exported.file.sha256&&prepared.originalWorkspaceId===native.workspaceId&&
      Array.isArray(prepared.files)&&prepared.files.length>0,
      'ANALYSIS_JOURNEY_PYTHON_PREPARATION','The original preparation lost its exact source/export identity.');
    const selectedOutput=child(output,'sources/'+selected.name);
    await immutable(child(selectedOutput,'preparation.json'),{record:prepared,originalOperationId:originalOperation,
      meaning:'Original analysis.python.prepare result or exact already-retained preparation; no source capture.'});
    const downloaded=await nativeFiles(native,{kind:'analysis',id:prepared.id},child(selectedOutput,'native-receiving'),signal);
    const downloadManifest=await fileIdentity(child(selectedOutput,'native-receiving/received/sensorthings-download.json'),
      {sha256:downloaded.manifestSha256});
    need(same(await jsonFile(downloadManifest.path,4*1024*1024),downloaded.manifest),
      'ANALYSIS_JOURNEY_PYTHON_FILE','The complete original downloaded manifest differs from the selected native file set.');
    const files=[];
    for(const file of prepared.files){
      need(/^(?:source\.json|intake\.json|files\/[a-f0-9]{64}\.(?:json|bin))$/.test(file.file),
        'ANALYSIS_JOURNEY_PYTHON_FILE','Retain the exact original prepared-source relative selector.');
      const originalFile=downloaded.files.filter(f=>f.selection?.kind==='analysis'&&f.selection.id===prepared.id&&
        f.selection.file===file.file&&f.sha256===file.sha256&&f.bytes===file.bytes);
      need(originalFile.length===1,'ANALYSIS_JOURNEY_PYTHON_FILE','The original native receiver did not return this exact prepared-source selector.');
      files.push({...file,...await fileIdentity(originalFile[0].path,file)});
    }
    need(downloaded.files.length===prepared.files.length,'ANALYSIS_JOURNEY_PYTHON_FILE','The retained preparation and native receiving file sets differ.');
    const intake=files.find(f=>f.file==='intake.json');need(intake,'ANALYSIS_JOURNEY_PYTHON_FILE','The complete original intake manifest is absent.');
    const body=await jsonFile(intake.path,4*1024*1024);
    need(body.editionId===selected.editionId&&body.exportId===selected.exportId&&body.originalWorkspaceId===native.workspaceId&&
      body.exportSha256===exported.file.sha256,'ANALYSIS_JOURNEY_PYTHON_FILE','The original received intake points to another edition/export.');
    requested.push({name:selected.name,editionId:selected.editionId,exportId:selected.exportId,preparation:prepared,
      intake:intake.path,sha256:intake.sha256,downloadManifest,files,downloaded});
    progress({stage:'Original Python source prepared and fully received',name:selected.name,editionId:selected.editionId,
      exportId:selected.exportId,preparationId:prepared.id,files:files.length});
  }
  const operationId=configuration.operationId??digest(Buffer.from('analysis-python:'+h.operationId)).slice(0,32),
    request={schema:'stellar-forge.sensorthings-analysis-programme.v1',operation_id:operationId,
      workspace:configuration.workspace,received_workspace:configuration.receivedWorkspace,control:configuration.control,
      output:configuration.output,checkout:configuration.checkout,node:process.execPath,title:configuration.title,
      sources:requested.map(({name,downloadManifest})=>({name,download_manifest:downloadManifest.path,
        download_manifest_sha256:downloadManifest.sha256})),
      comparisons:configuration.comparisons??[],allow_incomplete:configuration.allowIncomplete??false};
  const requestFile=await immutable(child(output,'programme-request.json'),request);
  return {request,requestFile,sources:requested,programmeSource:{path:'stellar_forge_buyer/sensorthings_analysis.py',
    sha256:configuration.programmeSource?.sha256??'15aa00275611a240e850621488126637c1457d25b6b4e1228f462605586938ed',
    bytes:configuration.programmeSource?.bytes??72526},
    meaning:'The existing complete original Python Analysis programme consumes these exact received manifests and source files.'};
}
async function runPreparedPython({h,prepared,output,signal,redact,progress}){
  const sourcePath=child(h.python.modulePath,prepared.programmeSource.path);
  await fileIdentity(sourcePath,prepared.programmeSource);
  await fileIdentity(prepared.requestFile.path,prepared.requestFile);
  const sourceFiles=prepared.sources.flatMap(source=>[source.downloadManifest,...source.files]);
  await verifyDescriptors(sourceFiles);
  const recordPath=child(output,'programme-complete.json'),prior=await optionalJSON(recordPath);
  if(prior){
    need(prior.originalOperationId===prepared.request.operation_id&&same(prior.requestFile,prepared.requestFile)&&same(prior.sourceFiles,sourceFiles),
      'ANALYSIS_JOURNEY_PYTHON_RESULT','The completed original Python programme request changed.');
    await fileIdentity(prior.completeFile.path,prior.completeFile);await verifyDescriptors(prior.result.files);
    await fileIdentity(prior.result.delivery.path,prior.result.delivery);return prior;
  }
  const completePath=child(h.python.control,'complete.json'),before=await optionalJSON(completePath);
  // The original programme itself owns its control lock, deterministic jobs,
  // archive restore and continued query/report/workbook revisions. No parallel
  // calculation or substitute Analysis engine is introduced here.
  const execution=await runOwnedNode(['-m','stellar_forge_buyer.sensorthings_analysis','--input',prepared.requestFile.path],{
    executable:h.python.interpreter,environment:{...process.env,PYTHONPATH:h.python.modulePath},
    signal,redact,outputLimit:4*1024*1024,log:line=>progress({stage:'Original Python Analysis programme',detail:line})});
  const result=await jsonFile(completePath,4*1024*1024);
  need(result.schema==='stellar-forge.sensorthings-analysis-programme.v1'&&result.status==='COMPLETE'&&
    result.operation_id===prepared.request.operation_id,'ANALYSIS_JOURNEY_PYTHON_RESULT','The original Python programme did not retain its exact complete result.');
  need(same(result.sources.map(x=>({name:x.name,editionId:x.edition_id,intakeSha256:x.intake_sha256})),
    prepared.sources.map(x=>({name:x.name,editionId:x.editionId,intakeSha256:x.sha256}))),
    'ANALYSIS_JOURNEY_PYTHON_RESULT','The Python result changed its original source editions/intake bytes.');
  need(result.receiving?.saved_query_revisions?.original===1&&result.receiving?.saved_query_revisions?.edited===2,
    'ANALYSIS_JOURNEY_PYTHON_RESULT','The original restored Analysis workspace did not retain both saved-query revisions.');
  await verifyDescriptors(result.files);await fileIdentity(result.delivery.path,result.delivery);
  const completeFile=await fileIdentity(completePath);
  const record={schema:'stellar-forge.sensorthings-analysis-native-python-result.v1',originalOperationId:prepared.request.operation_id,
    completedReplay:before!==null,requestFile:prepared.requestFile,sourceFiles,completeFile,execution,result};
  await immutable(recordPath,record);return record;
}


export async function runAnalysisNativeJourney(handoff,{output,playwrightModule,browserExecutable,signal=null,onProgress=()=>{}}={}){
  const h=checkHandoff(handoff);
  need(isAbsolute(output??'')&&disjoint(output,h.workspaceDirectory)&&disjoint(output,h.receivingDirectory),
    'ANALYSIS_JOURNEY_OUTPUT','Keep the original native journal/output outside either application workspace.');
  need(disjoint(h.workspaceDirectory,h.receivingDirectory)&&disjoint(h.sourceInboxDirectory,h.receivingInboxDirectory),
    'ANALYSIS_JOURNEY_HANDOFF','The original and receiving workspaces/inboxes must not contain one another.');
  await directory(output);
  const secrets=new Set(),redact=redactWith(secrets),progress=value=>onProgress(JSON.parse(redact(canonical(value))));
  const binding={schema:VERSION,operationId:h.operationId,sourceHead:h.sourceHead,handoff:h,
    driver:await fileIdentity(fileURLToPath(import.meta.url)),node:process.execPath,nodeVersion:process.version,
    playwrightModule,browserExecutable,output};
  let lease=null,native=null,received=null,browser=null,result=null,pythonPrepared=null,pythonResult=null,reopen=null;
  const origins=new Set(),projects=[],failures=[],startedAt=new Date().toISOString();
  try{
    lease=await acquireJourneyLease(output);
    await immutable(child(output,'native-request.json'),binding);
    const complete=await optionalJSON(child(output,'native-result.json'));
    if(complete){
      need(complete.operationId===h.operationId&&complete.requestSha256===digest(Buffer.from(canonical(binding))),
        'ANALYSIS_JOURNEY_REQUEST_CHANGED','This complete result belongs to another original request.');
      const verified=await verifyCompleted(complete);await lease.close();lease=null;return verified;
    }
    signal?.throwIfAborted();lease.assert();
    const receivingIdentity=await bindReceiving(h,output);
    native=await startNative(h);secrets.add(native.token);origins.add(native.origin);
    const intake=await inspectSource(native,h,output,signal);
    received=await startNative(h,{received:true,expectedWorkspaceId:receivingIdentity?.workspaceId??null,allowCreate:!receivingIdentity});
    secrets.add(received.token);origins.add(received.origin);
    await immutable(child(output,'receiving-identity.json'),{operationId:h.operationId,directory:h.receivingDirectory,workspaceId:received.workspaceId});
    browser=await openBrowser({playwrightModule,browserExecutable,output:child(output,'browser-'+randomUUID()),origins,redact});
    const page=await browser.page(),receivedPage=await browser.page();
    const actions=new Actions({page,native,root:child(output,'actions-original'),signal,redact}),
      receivedActions=new Actions({page:receivedPage,native:received,root:child(output,'actions-receiving'),signal,redact});
    await actions.install();await receivedActions.install();
    const viewer=await ensureViewer({page,native,actions,h,output});
    await immutable(child(output,'viewer-original.json'),viewer);
    for(const view of h.views){
      signal?.throwIfAborted();lease.assert();
      const project=await completeView({page,receivedPage,native,received,actions,receivedActions,h,view,viewer,
        output:child(output,'projects/'+view.key),signal,redact,progress});
      projects.push(project);
      await immutable(child(output,'projects/'+view.key+'/project-result.json'),project);
    }
    if(h.python)pythonPrepared=await preparePythonSources({page,native,actions,h,output:child(output,'python'),signal,progress});
    need(browser.rejected.length===0,'ANALYSIS_JOURNEY_EXTERNAL_REQUEST','The original native viewer attempted an unconfigured external request.',browser.rejected);
    const currentOriginal=await api(native,'/api/view',{signal}),currentReceived=await api(received,'/api/view',{signal});
    const snapshots={schema:'stellar-forge.sensorthings-analysis-native-final-state.v1',
      original:currentOriginal,received:currentReceived,intakeSha256:digest(Buffer.from(canonical(intake)))};
    const snapshotFile=await immutable(child(output,'final-workspace-views.json'),snapshots);
    const plan={schema:'stellar-forge.sensorthings-analysis-native-reopen-plan.v1',operationId:h.operationId,
      handoff:h,receivingWorkspaceId:received.workspaceId,
      projects:projects.map(p=>({view:p.view,expected:p.receivedExpected}))};
    const planFile=await immutable(child(output,'reopen-plan.json'),plan);
    // The parent retains the one journey lease while each original application
    // and browser is drained. Only then may the same receiver reopen in a fresh process.
    await browser.close();browser=null;
    await received.close();received=null;
    await native.close();native=null;
    signal?.throwIfAborted();lease.assert();
    if(pythonPrepared)pythonResult=await runPreparedPython({h,prepared:pythonPrepared,output:child(output,'python'),
      signal,redact,progress});
    const reopenOutput=child(output,'fresh-process-reopen'),childResultPath=child(reopenOutput,'reopen-result.json');
    let childResult=await optionalJSON(childResultPath);
    if(childResult){
      need(childResult.planSha256===planFile.sha256&&childResult.state==='COMPLETE',
        'ANALYSIS_JOURNEY_REOPEN_CHANGED','The retained fresh-process result names another original plan.');
      await verifyDescriptors(childResult.files);
    }else{
      await directory(reopenOutput);
      const processResult=await runOwnedNode([fileURLToPath(import.meta.url),'--reopen-plan',planFile.path,
        '--expected-plan-sha256',planFile.sha256,'--output',reopenOutput,'--playwright-module',playwrightModule,
        '--browser-executable',browserExecutable],{signal,redact,log:line=>progress({stage:'Original fresh-process receiving',detail:line})});
      childResult=await jsonFile(childResultPath);
      need(childResult.state==='COMPLETE'&&childResult.planSha256===planFile.sha256,
        'ANALYSIS_JOURNEY_REOPEN','The original fresh-process child did not save its exact complete result.');
      await immutable(child(output,'reopen-process.json'),{...processResult,planSha256:planFile.sha256});
    }
    const childResultFile=await fileIdentity(childResultPath);
    reopen={planSha256:planFile.sha256,file:childResultFile,result:childResult};
    const files=[snapshotFile,planFile,childResultFile,...projects.flatMap(p=>[p.receiptFile,...p.finalProjectDownload.files,...p.receivingProjectDownload.files]),
      ...(pythonResult?[pythonResult.completeFile,pythonResult.result.delivery]:[])];
    result={schema:VERSION,state:'COMPLETE',operationId:h.operationId,requestSha256:digest(Buffer.from(canonical(binding))),
      sourceHead:h.sourceHead,startedAt,completedAt:new Date().toISOString(),originalWorkspaceId:h.workspaceId,
      receivingWorkspaceId:plan.receivingWorkspaceId,projects,python:pythonResult,reopen,files,
      sourceCaptureExecuted:false,paymentExecuted:false,
      meaning:'Actual same-source analyst UI, original Helgoland rendering, frozen publication, original manifest-bound downloads, complete editable project receiving and fresh-process native reopen. Local receiving evidence remains distinct from external acceptance.'};
    await verifyCompleted(result);
  }catch(error){failures.push(error);}
  finally{
    if(browser)try{await browser.close();}catch(error){failures.push(error);}
    if(received)try{await received.close();}catch(error){failures.push(error);}
    if(native)try{await native.close();}catch(error){failures.push(error);}
  }
  try{
    if(failures.length){
      await immutable(child(output,'attempts/'+randomUUID()+'.json'),{schema:VERSION,state:signal?.aborted?'INTERRUPTED':'FAILED',
        operationId:h.operationId,requestSha256:digest(Buffer.from(canonical(binding))),recordedAt:new Date().toISOString(),
        errors:failures.map(error=>errorView(error,redact)),
        meaning:'Original request, action identities, source objects, partial receiving and completed outputs are retained for the same invocation.'});
      throw new AggregateError(failures,'The original native analysis journey did not complete.');
    }
    need(result,'ANALYSIS_JOURNEY_RESULT','No complete native result was produced.');
    await immutable(child(output,'native-result.json'),result);
    progress({stage:'Complete original native analysis and receiving',operationId:h.operationId,projects:result.projects.length,
      originalWorkspaceId:result.originalWorkspaceId,receivingWorkspaceId:result.receivingWorkspaceId,python:result.python?.result?.status??null});
    return result;
  }finally{if(lease)await lease.close();}
}
function parseCommand(args){
  const values={};
  if(args.length===1&&args[0]==='--help')return {help:true};
  for(let i=0;i<args.length;i+=2){
    const key=args[i],value=args[i+1];
    need(['--handoff','--output','--playwright-module','--browser-executable','--reopen-plan','--expected-plan-sha256'].includes(key)&&
      value!==undefined&&values[key]===undefined,'ANALYSIS_JOURNEY_ARGUMENT','Use the documented complete native handoff and runtime paths exactly once.');
    values[key]=value;
  }
  const reopen=Boolean(values['--reopen-plan']);
  need(Boolean(values['--handoff'])!==reopen&&['--output','--playwright-module','--browser-executable'].every(k=>values[k])&&
    (!reopen||HASH.test(values['--expected-plan-sha256']??''))&&
    Object.entries(values).filter(([k])=>k!=='--expected-plan-sha256').every(([,v])=>isAbsolute(v)),
    'ANALYSIS_JOURNEY_ARGUMENT','Supply absolute handoff/output/existing Playwright/browser paths, or the exact internal read-only reopen plan.');
  return values;
}
async function command(){
  const args=parseCommand(process.argv.slice(2));
  if(args.help){console.log('node analysis/deployment/native-journey.mjs --handoff ABS_JSON --output ABS_DIRECTORY --playwright-module ABS_MODULE --browser-executable ABS_CHROMIUM');return;}
  const controller=new AbortController(),signalNames=['SIGINT','SIGTERM'],handlers=new Map();
  for(const name of signalNames){const handler=()=>{if(!controller.signal.aborted)controller.abort(Object.assign(new Error('The original native continuation was interrupted; drain owned work and resume its retained request.'),{code:'ANALYSIS_JOURNEY_INTERRUPTED'}));};
    handlers.set(name,handler);process.on(name,handler);}
  try{
    const options={output:resolve(args['--output']),playwrightModule:resolve(args['--playwright-module']),
      browserExecutable:resolve(args['--browser-executable']),signal:controller.signal,
      onProgress:value=>console.log(JSON.stringify(value))};
    if(args['--reopen-plan']){
      const raw=await originalBytes(args['--reopen-plan']);
      need(digest(raw)===args['--expected-plan-sha256'],'ANALYSIS_JOURNEY_REOPEN_CHANGED','The exact original reopen plan file changed.');
      const result=await readOnlyReopen({plan:JSON.parse(raw.toString('utf8')),planSha256:digest(raw),...options,progress:options.onProgress});
      console.log(JSON.stringify({state:result.state,workspaceId:result.workspaceId,planSha256:result.planSha256}));
    }else{
      const handoff=await jsonFile(args['--handoff']),result=await runAnalysisNativeJourney(handoff,options);
      console.log(JSON.stringify({state:result.state,operationId:result.operationId,originalWorkspaceId:result.originalWorkspaceId,
        receivingWorkspaceId:result.receivingWorkspaceId,projects:result.projects.length,
        result:child(options.output,'native-result.json'),pythonDelivery:result.python?.result?.delivery??null}));
    }
  }finally{for(const [name,handler]of handlers)process.off(name,handler);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  command().catch(error=>{const record=errorView(error,redactWith(new Set()));
    console.error(JSON.stringify(record));process.exitCode=1;});
}
