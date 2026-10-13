// SPDX-License-Identifier: MIT
import * as fs from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { dirname, join, resolve, relative, sep, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acquireWorkspaceLease, privateDirectory } from '../vendor/stellar-expert/store.mjs';
import { runBrowserJourney, receivingLifetime, receivingWrite } from './browser.mjs';

const ENTRY = fileURLToPath(import.meta.url);
const REFERENCE_SHA256 = '752bb3a767e5b2f456308df021bff017059e0631fb4370f31509346ad3a45237';
const OPERATION = 'TIPTAP-HOCUSPOCUS-WORKSHARE-0C7A-20261012';
const json = v => Buffer.from(JSON.stringify(v,null,2)+'\n');
const hash = v => createHash('sha256').update(v).digest('hex');
const now = () => new Date().toISOString();
const copy = v => structuredClone(v);
function need(v,code,message) { if(!v)throw Object.assign(new Error(message),{code}); }
function clean(e) { return {code:e?.code||'RECEIVING_FAILED',message:String(e?.message||e),status:e?.status??null}; }
async function exists(p) { try{await fs.lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;} }
async function readJSON(p) { return JSON.parse(await fs.readFile(p,'utf8')); }
async function regular(p) { const st=await fs.lstat(p);need(st.isFile()&&!st.isSymbolicLink(),'FILE_NOT_REGULAR',p);return st; }
async function syncDirectory(p) { const f=await fs.open(p,'r');try{await f.sync();}finally{await f.close();} }
async function atomic(p,b) {
  await fs.mkdir(dirname(p),{recursive:true,mode:0o700});const t=p+'.tmp-'+randomUUID(),f=await fs.open(t,'wx',0o600);
  try{await f.writeFile(b);await f.sync();}finally{await f.close();}await fs.rename(t,p);await syncDirectory(dirname(p));
}
async function immutable(p,b) {
  if(await exists(p)){await regular(p);need((await fs.readFile(p)).equals(b),'IMMUTABLE_FILE_CHANGED',p);return;}
  await fs.mkdir(dirname(p),{recursive:true,mode:0o700});const t=p+'.tmp-'+randomUUID(),f=await fs.open(t,'wx',0o600);
  try{await f.writeFile(b);await f.sync();}finally{await f.close();}
  try{await fs.link(t,p);}catch(e){if(e.code!=='EEXIST')throw e;need((await fs.readFile(p)).equals(b),'IMMUTABLE_FILE_CHANGED',p);}
  finally{await fs.unlink(t);}await syncDirectory(dirname(p));
}
async function fileInfo(p,root) { await regular(p);const b=await fs.readFile(p);return {path:relative(root,p).split(sep).join('/'),bytes:b.length,sha256:hash(b)}; }
function safeRelative(p) { need(typeof p==='string'&&p&&!isAbsolute(p)&&!p.includes('\\')&&!p.split('/').some(v=>!v||v==='.'||v==='..'),'SOURCE_PATH_INVALID',String(p));return p; }
async function verifyFiles(root,files) {
  for(const row of files){safeRelative(row.path);need(Number.isSafeInteger(row.bytes)&&row.bytes>=0&&/^[a-f0-9]{64}$/.test(row.sha256),'FILE_DESCRIPTOR_INVALID',row.path);
    const actual=await fileInfo(join(root,row.path),root);need(actual.bytes===row.bytes&&actual.sha256===row.sha256,'SELECTED_BYTES_CHANGED',row.path);}
}
async function readRuntimeSelection(source,runtimeReadyFile) {
  await regular(runtimeReadyFile);const runtimeBytes=await fs.readFile(runtimeReadyFile),runtimeReady=JSON.parse(runtimeBytes);
  need(runtimeReady?.schema==='tjlabs.tiptap-runtime-ready.v1'&&runtimeReady.state==='ready','RUNTIME_RECEIPT_INVALID','Use the completed original installation receipt.');
  need(typeof runtimeReady.sourceRoot==='string'&&await fs.realpath(runtimeReady.sourceRoot)===source,'RUNTIME_SOURCE_MISMATCH','The installed receipt must select this complete source tree.');
  need(runtimeReady.node?.executable===process.execPath&&runtimeReady.node?.version===process.version,'RUNTIME_NODE_MISMATCH','Invoke the exact Node executable and version retained by the installation receipt.');
  need(Array.isArray(runtimeReady.packages)&&runtimeReady.packages.length>0&&/^[a-f0-9]{64}$/.test(runtimeReady.selectionSha256),'RUNTIME_SELECTION_INVALID','Keep the original installed package selection and its identity.');
  need(runtimeReady.schemaSelection?.schemaId==='reference-v1'&&runtimeReady.schemaSelection?.field==='default','RUNTIME_SCHEMA_MISMATCH','Use the original shared reference schema and field.');
  for(const [path,selected] of [['package.json',runtimeReady.packageJson],['package-lock.json',runtimeReady.lockfile],['reference/schema.mjs',runtimeReady.schemaSelection]]) {
    need(selected&&Number.isSafeInteger(selected.bytes)&&selected.bytes>=0&&/^[a-f0-9]{64}$/.test(selected.sha256),'RUNTIME_FILE_DESCRIPTOR_INVALID',path);
    const actual=await fileInfo(join(source,path),source);
    need(actual.bytes===selected.bytes&&actual.sha256===selected.sha256,'RUNTIME_SELECTED_BYTES_CHANGED',path);
  }
  return {bytes:runtimeBytes,ready:runtimeReady};
}
function argumentsOf(argv) {
  const a={resume:false};
  for(let i=0;i<argv.length;i++){const key=argv[i];if(key==='--resume'){a.resume=true;continue;}if(key==='--recover-completed'){a.recoverCompleted=true;continue;}need(key.startsWith('--')&&argv[i+1]&&!argv[i+1].startsWith('--'),'ARGUMENT_REQUIRED',key);a[key.slice(2)]=argv[++i];}
  for(const key of ['source','directory','runtime-ready','source-manifest','playwright','chromium'])need(a[key],'ARGUMENT_REQUIRED','--'+key);
  need(Boolean(a['receiving-source'])===Boolean(a['receiving-runtime-ready']),'RECEIVING_INSTALLATION_ARGUMENTS_REQUIRED','Select --receiving-source and --receiving-runtime-ready together.');
  return a;
}
function semantic(value) {
  if(Array.isArray(value))return value.map(semantic);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,semantic(value[k])]));
  return value;
}
function retainedView(value) {
  const view=structuredClone(value);
  for(const key of ['historical','currentRevision','runtime','permissions'])delete view[key];
  for(const doc of view.documents||[])delete doc.access;
  for(const deployment of view.deployments||[])delete deployment.connections;
  return JSON.stringify(semantic(view));
}
function sameResult(a,b){return retainedView(a.view)===retainedView(b.view)&&JSON.stringify(semantic(a.result))===JSON.stringify(semantic(b.result));}
class Ledger {
  constructor(path,data,lifetime){this.path=path;this.data=data;this.lifetime=lifetime;this.tail=Promise.resolve();}
  save(){const b=json(this.data);this.tail=this.tail.then(()=>atomic(this.path,b),()=>atomic(this.path,b));return this.tail;}
  async phase(key,fn) {
    this.lifetime.check();
    const phase=this.data.phases[key] ||= {state:'prepared',createdAt:now()};
    if(phase.state==='complete')return copy(phase.result);
    await this.save();
    try{const result=await fn(phase);phase.result=result;phase.state='complete';phase.completedAt=now();delete phase.error;await this.save();return copy(result);}
    catch(e){phase.error=clean(e);phase.failedAt=now();try{await this.save();}catch{this.lifetime.fail(e);}throw e;}
  }
}
async function pause(ms=150){await new Promise(r=>setTimeout(r,ms));}
function one(rows,predicate,label) { const found=(rows||[]).filter(predicate);need(found.length===1,'REFERENCE_SELECTION_AMBIGUOUS',label+': '+found.length+' matches');return found[0]; }
function byTitle(view,kind,title){return one(view[kind],v=>v.title===title,kind+' '+title);}
function publicDocument(d){return {id:d.id,tenantId:d.tenantId,documentName:d.documentName,epochId:d.epochId,schemaId:d.schemaId,field:d.field,
  sourceId:d.sourceId,persisted:d.persisted?{sha256:d.persisted.sha256,bytes:d.persisted.bytes,stateVectorBase64:d.persisted.stateVectorBase64,stateVectorSha256:d.persisted.stateVectorSha256}:null};}

export async function receive(options, { signal = null } = {}) {
  const lifetime = receivingLifetime(signal), attemptId = randomUUID();
  const servers = new Map(), serverStates = new Map();
  let directory = null;
  const browserOwners = new Set(), httpBodies = new Set(), closeErrors = [];
  let lease = null, ledger = null, ownerClosed = false, closePromise = null, closure = null, closureValue = null, journalCloseAttempted = false;
  let input = null, resultPath = null, completedCandidate = null;
  const owner = { close: () => closeOwnedReceiving(), get closed() { return ownerClosed; }, get closure() { return closure; } };
  const noteError = error => {
    if (closeErrors.length < 64) closeErrors.push(clean(error));
    return lifetime.fail(error);
  };
  const progress = value => receivingWrite(process.stdout,JSON.stringify({operationId:OPERATION,...value})+'\n',lifetime);
  function trackedHTTP(run) {
    lifetime.check();
    const held = Promise.resolve().then(run);
    httpBodies.add(held); held.then(() => httpBodies.delete(held), () => httpBodies.delete(held));
    return held;
  }
  function adoptServer(name, server) {
    need(server && typeof server.close === 'function','APPLICATION_CLOSE_OWNER_MISSING','Retain the acquired original application before validating it.');
    need(!servers.has(name) || servers.get(name) === server,'APPLICATION_OWNER_CHANGED',name);
    servers.set(name,server);
    if (!serverStates.has(server)) serverStates.set(server,{physicalClosed:false,closedAt:null});
    return server;
  }
  async function closeServer(name) {
    const server=servers.get(name);if(!server)return;
    const state=serverStates.get(server);
    try {
      if (!state.physicalClosed) { await server.close(); state.physicalClosed=true;state.closedAt=now(); }
      if(ledger?.data.servers[name]) { ledger.data.servers[name].closedAt=state.closedAt; await ledger.save(); }
      servers.delete(name);serverStates.delete(server);
    } catch(error) { noteError(error);throw error; }
  }
  async function closeAll() {
    for(const name of [...servers.keys()].reverse()) {
      try { await closeServer(name); } catch {}
    }
  }
  async function runOwnedBrowser(run,args) {
    lifetime.check();
    try { return await run({...args,signal:lifetime.signal}); }
    catch(error) {
      const held=error?.browserJourney || (typeof error?.closeFailedBrowserJourney==='function'?{close:error.closeFailedBrowserJourney}:null);
      if(held) {
        need(typeof held.close==='function','BROWSER_CLOSE_OWNER_MISSING','Retain the original failed browser owner.');
        browserOwners.add(held);
      }
      throw error;
    }
  }
  async function closeOwnedReceiving() {
    if(ownerClosed)return;
    if(closePromise)return closePromise;
    closePromise=(async()=>{
      while(browserOwners.size || httpBodies.size || servers.size) {
        for(const held of [...browserOwners]) {
          try { await held.close();browserOwners.delete(held); } catch(error) { noteError(error); }
        }
        if(httpBodies.size)await Promise.allSettled([...httpBodies]);
        // Browser-side requests must finish while their original applications
        // still exist. Do not release either application ahead of that owner.
        if(!browserOwners.size&&!httpBodies.size)await closeAll();
        if(browserOwners.size||httpBodies.size||servers.size)await pause(500);
      }
      if(ledger&&!journalCloseAttempted) {
        journalCloseAttempted=true;
        ledger.data.lastCloseErrors=closeErrors;
        try { await ledger.save(); } catch(error) { noteError(error); }
      }
      if(lease)await lease.close();
      lease=null;
      if(input&&resultPath) {
        if(!closureValue)closureValue={
          schema:'tjlabs.tiptap-receiving-owner-closed.v1',operationId:OPERATION,attemptId,
          inputSha256:hash(json(input)),closedAt:now(),
          result:await exists(resultPath)?await fileInfo(resultPath,directory):null,
          firstError:lifetime.first?clean(lifetime.first):null,
          closed:{applications:true,browserJourneys:true,httpBodies:true,files:true,lease:true},
        };
        const path=join(directory,'receiving-closures',attemptId+'.json');
        await immutable(path,json(closureValue));closure=await fileInfo(path,directory);
      }
      ownerClosed=true;
    })();
    try { await closePromise; } catch(error) { closePromise=null;throw error; }
  }
  async function finalizeOwners() {
    while(!ownerClosed) {
      try { await closeOwnedReceiving(); } catch(error) { noteError(error);await pause(500); }
    }
  }
  try {
    lifetime.check();directory=resolve(options.directory);

  const source=await fs.realpath(resolve(options.source));
  need(await fs.realpath(ENTRY)===join(source,'receiving','receive.mjs'),'RECEIVER_SOURCE_MISMATCH','Use the receiving programme from the declared selected source.');
  need(Number(process.versions.node.split('.')[0])>=24,'NODE_RUNTIME_UNSUPPORTED','The selected native runtime requires Node 24 or newer.');
  const sourceManifestPath=resolve(options['source-manifest']),runtimeReadyFile=resolve(options['runtime-ready']);
  const sourceManifestBytes=await fs.readFile(sourceManifestPath),sourceManifest=JSON.parse(sourceManifestBytes);
  need(sourceManifest.schema&&sourceManifest.sourceRef&&Array.isArray(sourceManifest.files)&&sourceManifest.files.length,'SOURCE_MANIFEST_INVALID','Use the complete original source manifest.');
  need(new Set(sourceManifest.files.map(v=>v.path)).size===sourceManifest.files.length,'SOURCE_MANIFEST_DUPLICATE','Selected source paths must be unique.');
  await verifyFiles(source,sourceManifest.files);
  for(const p of ['receiving/receive.mjs','receiving/browser.mjs','server.mjs','package.json','package-lock.json','reference/schema.mjs','reference/documents.json','vendor/stellar-expert/store.mjs'])
    need(sourceManifest.files.some(f=>f.path===p),'SOURCE_MANIFEST_INCOMPLETE',p);
  const originalBytes=await fs.readFile(join(source,'reference','documents.json'));
  need(originalBytes.length===3818&&hash(originalBytes)===REFERENCE_SHA256,'REFERENCE_SOURCE_CHANGED','Use the complete original three-document source.');
  const reference=JSON.parse(originalBytes);
  need(Array.isArray(reference.documents)&&reference.documents.length===3,'REFERENCE_POPULATION_CHANGED','The original reference contains three documents.');
  need(reference.documents.filter(d=>d.tenantId==='tenant-a').length===2&&reference.documents.filter(d=>d.tenantId==='tenant-b').length===1,'REFERENCE_TENANTS_CHANGED','Keep the original two-tenant population.');
  const {bytes:runtimeBytes,ready:runtimeReady}=await readRuntimeSelection(source,runtimeReadyFile);
  need(Boolean(options['receiving-source'])===Boolean(options['receiving-runtime-ready']),'RECEIVING_INSTALLATION_ARGUMENTS_REQUIRED','Select --receiving-source and --receiving-runtime-ready together.');
  const separateReceiving=Boolean(options['receiving-source']);
  const receivingSource=separateReceiving?await fs.realpath(resolve(options['receiving-source'])):source;
  const receivingRuntimeReadyFile=separateReceiving?resolve(options['receiving-runtime-ready']):runtimeReadyFile;
  if(separateReceiving)await verifyFiles(receivingSource,sourceManifest.files);
  const receivingSelection=separateReceiving?await readRuntimeSelection(receivingSource,receivingRuntimeReadyFile):{bytes:runtimeBytes,ready:runtimeReady};
  const receivingRuntimeSHA=hash(receivingSelection.bytes);
  await regular(resolve(options.chromium));await regular(resolve(options.playwright));
  input={operationId:OPERATION,source,sourceRef:sourceManifest.sourceRef,sourceManifestSha256:hash(sourceManifestBytes),
    runtimeReadySha256:hash(runtimeBytes),runtimeReadyFile,node:{executable:process.execPath,version:process.version},
    reference:{path:'reference/documents.json',bytes:originalBytes.length,sha256:REFERENCE_SHA256},
    playwright:resolve(options.playwright),chromium:resolve(options.chromium),
    ...(separateReceiving?{receivingInstallation:{source:receivingSource,sourceManifestSha256:hash(sourceManifestBytes),runtimeReadyFile:receivingRuntimeReadyFile,runtimeReadySha256:receivingRuntimeSHA}}:{})};
  lifetime.check();await privateDirectory(directory,{create:true});lease=await acquireWorkspaceLease(directory);
  const ledgerPath=join(directory,'receiving.json'),output=join(directory,'delivery');
  resultPath=join(directory,'result.json');
  let actors,authFile,createApplicationServer,receivingApplicationServer,runReceivingBrowserJourney=runBrowserJourney;
  async function openServer(name) {
    lifetime.check();
    if(servers.has(name))return servers.get(name);
    const retained=ledger.data.servers[name] ||= {directory:join(directory,name+'-workspace'),port:0};
    await ledger.save();
    const open=name==='receiving'?receivingApplicationServer:createApplicationServer;
    const readyFile=name==='receiving'?receivingRuntimeReadyFile:runtimeReadyFile;
    let server;
    try {
      server=await open({directory:retained.directory,authFile,runtimeReadyFile:readyFile,host:'127.0.0.1',port:retained.port});
      adoptServer(name,server);
    } catch(error) {
      const held=error?.application || (typeof error?.closeFailedApplication==='function'?{close:error.closeFailedApplication}:null);
      if(held)adoptServer(name,held);
      throw error;
    }
    lifetime.check();
    need(new URL(server.origin).hostname==='127.0.0.1','SERVER_ORIGIN_CHANGED','The reference host must bind loopback.');
    if(retained.origin)need(retained.origin===server.origin&&retained.instanceId===server.instanceId,'SERVER_IDENTITY_CHANGED','Reopen the same original host origin and installation.');
    retained.port=Number(new URL(server.origin).port);retained.origin=server.origin;retained.instanceId=server.instanceId;retained.openedAt=now();delete retained.closedAt;
    await ledger.save();
    const session=await get(name,'/api/session');
    need(session.instanceId===server.instanceId&&session.actor.id===actors.operator.id&&session.permissions.operate&&session.runtime.ready,
      'NATIVE_RUNTIME_NOT_READY','The original host must verify the selected installed runtime and operator.');
    retained.runtime=session.runtime;await ledger.save();return server;
  }
  async function http(name,path,{method='GET',body,headers={}}={}) {
    return trackedHTTP(async()=>{
      lifetime.check();
      const server=servers.get(name);need(server,'SERVER_NOT_OPEN',name);
      let response;
      try {
        response=await fetch(server.origin+path,{method,headers:{Authorization:'Bearer '+actors.operator.token,...headers},
          ...(body===undefined?{}:{body:typeof body==='string'||body instanceof Uint8Array?body:JSON.stringify(body)}),
          redirect:'error',signal:lifetime.signal});
        let value;const bytes=Buffer.from(await response.arrayBuffer());
        try{value=JSON.parse(bytes);}catch{throw Object.assign(new Error('Original HTTP response is unreadable.'),{code:'HTTP_RESPONSE_UNREADABLE',status:response.status});}
        if(!response.ok)throw Object.assign(new Error(value.error?.message||'Original HTTP action failed.'),{code:value.error?.code||'HTTP_'+response.status,status:response.status,details:value.error?.details,response:value});
        lifetime.check();return value;
      } finally {
        if(response?.body&&!response.bodyUsed)await response.body.cancel();
      }
    });
  }
  const get=(name,path)=>http(name,path);
  const view=(name,id,revision=null)=>get(name,'/api/projects/'+encodeURIComponent(id)+(revision===null?'':'?revision='+revision));
  async function create(name,key,title,notes='') {
    return command(name,key,null,null,{title,notes});
  }
  async function command(name,key,projectId,action,payload) {
    lifetime.check();
    const keyName=name+':'+key;let record=ledger.data.requests[keyName];
    if(!record) {
      const before=projectId?await view(name,projectId):null;
      const requestId=randomUUID(),data=typeof payload==='function'?await payload(before):copy(payload);
      const body=projectId?{action,projectId,expectedRevision:before.revision,requestId,payload:data}:{requestId,...data};
      record={state:'prepared',host:name,path:projectId?'/api/actions':'/api/projects',requestId,projectId,action,
        bodyText:JSON.stringify(body),bodySha256:hash(JSON.stringify(body)),before,createdAt:now()};
      ledger.data.requests[keyName]=record;await ledger.save();
    }
    need(record.host===name&&record.projectId===projectId&&record.action===action&&hash(record.bodyText)===record.bodySha256,'REQUEST_IDENTITY_CHANGED',keyName);
    if(record.state==='committed')return copy(record.response);
    record.lastDispatchAt=now();record.state='sending';await ledger.save();
    try {
      const response=await http(name,record.path,{method:'POST',body:record.bodyText,headers:{'Content-Type':'application/json'}});
      need(response.view?.id&&Number.isSafeInteger(response.view.revision)&&Number.isSafeInteger(response.currentRevision),'RESPONSE_BINDING_MISSING',keyName);
      if(projectId&&action!=='handoff.receive')need(response.view.id===projectId,'RESPONSE_PROJECT_CHANGED',keyName);
      record.response=response;record.state='committed';record.committedAt=now();delete record.error;await ledger.save();return copy(response);
    } catch(e){record.state=e.status>=400&&e.status<500?'rejected':'uncertain';record.error=clean(e);if(e.response)record.observedError=e.response;try{await ledger.save();}catch{lifetime.fail(e);}throw e;}
  }
  async function replay(name,key) {
    const record=ledger.data.requests[name+':'+key];need(record?.state==='committed','ORIGINAL_REQUEST_NOT_COMMITTED',key);
    const response=await http(name,record.path,{method:'POST',body:record.bodyText,headers:{'Content-Type':'application/json'}});
    need(response.replayed===true&&sameResult(response,record.response),
      'REPLAY_RESULT_CHANGED',key);
    return {requestId:record.requestId,bodySha256:record.bodySha256,originalRevision:record.response.view.revision,currentRevision:response.currentRevision,response};
  }
  async function upload(name,key,path,filename) {
    await regular(path);const bytes=await fs.readFile(path),sha256=hash(bytes);let item=ledger.data.uploads[name+':'+key];
    if(!item){item={uploadId:randomUUID(),path:resolve(path),filename,bytes:bytes.length,sha256,offset:0};ledger.data.uploads[name+':'+key]=item;await ledger.save();}
    need(item.path===resolve(path)&&item.bytes===bytes.length&&item.sha256===sha256&&item.filename===filename,'UPLOAD_INPUT_CHANGED',key);
    let remote;
    try{remote=await get(name,'/api/uploads/'+item.uploadId);}catch(e){if(e.status!==404)throw e;remote=await http(name,'/api/uploads',{method:'POST',body:{uploadId:item.uploadId,filename,mediaType:filename.endsWith('.json')?'application/json':'application/octet-stream',bytes:bytes.length,sha256},headers:{'Content-Type':'application/json'}});}
    const check=v=>need(v.id===item.uploadId&&v.bytes===item.bytes&&v.sha256===sha256&&Number.isSafeInteger(v.offset)&&v.offset>=0&&v.offset<=bytes.length,'UPLOAD_RECEIPT_CHANGED',key);
    check(remote);
    while(remote.offset<bytes.length){
      const start=remote.offset,end=Math.min(bytes.length,start+8*1024*1024),chunk=bytes.subarray(start,end);
      remote=await http(name,'/api/uploads/'+item.uploadId,{method:'PATCH',body:chunk,headers:{'Content-Type':'application/octet-stream',
        'Content-Range':'bytes '+start+'-'+(end-1)+'/'+bytes.length,'X-Chunk-SHA256':hash(chunk)}});
      check(remote);need(remote.offset>=end,'UPLOAD_PROGRESS_UNCERTAIN',key);item.offset=remote.offset;await ledger.save();
    }
    remote=await http(name,'/api/uploads/'+item.uploadId+'/finish',{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}});
    check(remote);need(remote.complete&&remote.objectId,'UPLOAD_NOT_COMPLETE',key);item.complete=true;item.objectId=remote.objectId;await ledger.save();return item.uploadId;
  }
  async function download(name,path,destination,expected=null) {
    return trackedHTTP(async()=>{
      lifetime.check();let response;
      try {
        const server=servers.get(name);need(server,'SERVER_NOT_OPEN',name);
        response=await fetch(server.origin+path,{headers:{Authorization:'Bearer '+actors.operator.token},redirect:'error',signal:lifetime.signal});
        need(response.ok,'DOWNLOAD_FAILED',path+' HTTP '+response.status);
        const bytes=Buffer.from(await response.arrayBuffer()),sha256=hash(bytes),declared=response.headers.get('x-content-sha256'),length=response.headers.get('content-length');
        need(/^[a-f0-9]{64}$/.test(declared||'')&&declared===sha256,'DOWNLOAD_HASH_CHANGED',path);
        if(length!==null)need(Number(length)===bytes.length,'DOWNLOAD_LENGTH_CHANGED',path);
        if(expected)need(expected.sha256===sha256&&expected.bytes===bytes.length,'ORIGINAL_DOWNLOAD_CHANGED',path);
        lifetime.check();
        await immutable(destination,bytes);return {...await fileInfo(destination,directory),contentType:response.headers.get('content-type'),filename:response.headers.get('content-disposition')};
      } finally {
        if(response?.body&&!response.bodyUsed)await response.body.cancel();
      }
    });
  }
  async function settle(name,projectId,{documentCount=null}={}) {
    const deadline=Date.now()+120000;
    while(Date.now()<deadline){
      const current=await view(name,projectId),failed=(current.jobs||[]).find(j=>['failed','interrupted'].includes(j.status));
      if(failed){
        const identity=hash(json(failed)),key=failed.id+':'+identity;
        if(!ledger.data.failures[key]){ledger.data.failures[key]={job:failed,observedAt:now()};await ledger.save();throw Object.assign(new Error('The original native job ended. Its actual result is retained; inspect it before --resume.'),{code:'NATIVE_JOB_REVIEW_REQUIRED'});}
        need(options.resume,'NATIVE_JOB_REVIEW_REQUIRED','Resume the same operation explicitly after reviewing its retained native failure.');
        await command(name,'resume-native-'+key,projectId,'job.resume',{jobId:failed.id,reason:'Continue the same original job after reviewing the retained failed attempt '+failed.attemptId+'.'});
      }else if(!(current.jobs||[]).some(j=>['queued','running','cancelling'].includes(j.status))&&(documentCount===null||current.documents.length===documentCount))return current;
      await pause(200);
    }
    throw Object.assign(new Error('The original native job has not reached its retained terminal state.'),{code:'NATIVE_JOB_PENDING'});
  }
  async function ensureRunning(name,context,projectId,deploymentId) {
    // A completed HTTP start receipt remains historical after its leased
    // Node owner ends. Explicit continuation starts the same deployment.
    const groups=ledger.data.deploymentContinuations ||= {};
    const key=name+':'+context+':'+deploymentId,group=groups[key] ||= [];
    for(;;) {
      const pending=group.find(r=>!r.acknowledgedAt);
      if(pending) {
        await command(name,pending.requestKey,projectId,'deployment.start',{deploymentId});
        pending.acknowledgedAt=now();await ledger.save();
      }
      const current=await settle(name,projectId),deployment=one(current.deployments,d=>d.id===deploymentId,'selected native deployment');
      if(deployment.status==='running') {
        need(current.activeDeploymentId===deploymentId,'NATIVE_DEPLOYMENT_SELECTION_CHANGED','The live deployment must be the original selected target.');
        return {view:current,deployment};
      }
      need(['prepared','stopped','failed','interrupted'].includes(deployment.status),'NATIVE_DEPLOYMENT_PENDING','Wait for the original native owner to finish.');
      need(options.resume,'DEPLOYMENT_CONTINUATION_REQUIRED','The original native owner ended after its start receipt. Use --resume to explicitly continue this same deployment.');
      need(!current.activeDeploymentId,'NATIVE_DEPLOYMENT_SELECTION_CHANGED','Another deployment is selected; preserve its current owner.');
      const observed={deploymentId,editionId:deployment.editionId,status:deployment.status,jobId:deployment.jobId??null,
        startedAt:deployment.startedAt??null,stoppedAt:deployment.stoppedAt??null,lastError:deployment.lastError??null,revision:current.revision};
      const requestKey='continue-'+context+'-'+hash(json(observed));
      need(!group.some(r=>r.requestKey===requestKey&&r.acknowledgedAt),'NATIVE_DEPLOYMENT_DID_NOT_START','The explicit continuation did not produce a new native owner.');
      group.push({requestKey,observed,createdAt:now()});await ledger.save();
    }
  }
  async function deploymentState(name,projectId,deploymentId,expected) {
    const until=Date.now()+60000;while(Date.now()<until){const v=await view(name,projectId),d=one(v.deployments,x=>x.id===deploymentId,'deployment');
      if(expected.includes(d.status))return {view:v,deployment:d};if(['failed','interrupted'].includes(d.status))throw Object.assign(new Error(JSON.stringify(d.error||d)),{code:'NATIVE_DEPLOYMENT_FAILED'});await pause(150);}
    throw Object.assign(new Error('The original deployment has not drained or started.'),{code:'NATIVE_DEPLOYMENT_PENDING'});
  }
  try {
    const existing=await exists(ledgerPath)?await readJSON(ledgerPath):null;
    if(existing)need(JSON.stringify(existing.input)===JSON.stringify(input),'RECEIVING_INPUT_CHANGED','Continue with the original complete source and runtime selection.');
    else need(!(await exists(resultPath)),'RESULT_LEDGER_MISSING','A completed result requires its original receiving journal.');
    ledger=new Ledger(ledgerPath,existing||{schema:'tjlabs.tiptap-receiving.v1',operationId:OPERATION,input,state:'prepared',createdAt:now(),
      phases:{},requests:{},uploads:{},failures:{},servers:{}},lifetime);
    await ledger.save();await lease.assert();await fs.mkdir(output,{recursive:true,mode:0o700});
    if(options.recoverCompleted) {
      need(ledger.data.finalCandidate?.state==='complete' && await exists(resultPath),
        'COMPLETED_RESULT_REQUIRED','Completed-only recovery requires the already-published original result and final candidate.');
      need((await fs.readFile(resultPath)).equals(json(ledger.data.finalCandidate)),
        'COMPLETED_RESULT_CHANGED','The immutable receiving result differs from its original final candidate.');
    }
    if(ledger.data.finalCandidate){
      const candidate=ledger.data.finalCandidate;
      need(candidate.schema==='tjlabs.tiptap-receiving-result.v1'&&candidate.operationId===OPERATION&&candidate.state==='complete'&&
        JSON.stringify(candidate.input)===JSON.stringify(input),'COMPLETED_RESULT_CHANGED','Retain the original complete result selection.');
      await verifyFiles(directory,candidate.files);await immutable(resultPath,json(candidate));
      for(const [sub,host,selectedSource,readySHA] of [
        ['browser-working','source',source,input.runtimeReadySha256],
        ['browser-receiving','receiving',receivingSource,receivingRuntimeSHA],
      ]) {
        lifetime.check();
        const browserResult=await readJSON(join(directory,sub,'result.json')),selected=browserResult.input;
        need(candidate.files.some(row=>row.path===sub+'/result.json')&&browserResult.state==='complete'&&
          browserResult.schema==='tjlabs.tiptap-browser-receiving.v1'&&selected.projectId===candidate.projectId&&
          selected.sourceRoot===selectedSource&&selected.origin===ledger.data.servers[host]?.origin&&
          selected.sourceManifestSha256===input.sourceManifestSha256&&selected.runtimeReadySha256===readySHA&&
          selected.playwright===input.playwright&&selected.chromium===input.chromium&&
          selected.phase===(host==='source'?'collaboration':'receiving'),
          'COMPLETED_BROWSER_SELECTION_CHANGED','Retain each full original browser result and host binding.');
        const module=selectedSource===source?{runBrowserJourney}:await import(pathToFileURL(join(selectedSource,'receiving','browser.mjs')).href);
        need(typeof module.runBrowserJourney==='function','RECEIVING_BROWSER_EXPORT_MISSING','Use the same selected complete browser source.');
        await runOwnedBrowser(module.runBrowserJourney,{...selected,directory:join(directory,sub),
          actors:selected.actors,recoverCompleted:true});
      }
      ledger.data.state='complete';await ledger.save();completedCandidate=candidate;return completedCandidate;
    }
    need(!options.recoverCompleted,'COMPLETED_RESULT_REQUIRED','Completed-only recovery cannot start an application or domain course.');
    authFile=join(directory,'private-auth.json');
    if(await exists(authFile)) {
      const auth=await readJSON(authFile);need(auth.schema==='tjlabs.tiptap-auth.v1'&&auth.actors.length===5,'REFERENCE_AUTH_CHANGED','Use the original private host actors.');
      actors=Object.fromEntries(auth.actors.map(a=>[a.id,a]));
      for(const id of ['operator','editor-a','editor-b','viewer','outsider'])need(actors[id]?.token,'REFERENCE_AUTH_CHANGED',id);
    } else {
      actors=Object.fromEntries([
        ['operator','Migration operator',['operator'],['*']],['editor-a','Editor A',['editor'],['tenant-a']],
        ['editor-b','Editor B',['editor'],['tenant-a']],['viewer','Receiving viewer',['viewer'],['tenant-a']],
        ['outsider','Second tenant editor',['editor'],['tenant-b']],
      ].map(([id,name,roles,tenantIds])=>[id,{id,name,roles,tenantIds,token:randomBytes(36).toString('base64url')}]));
      await immutable(authFile,json({schema:'tjlabs.tiptap-auth.v1',actors:Object.values(actors)}));
    }
    const authSHA=hash(await fs.readFile(authFile));if(ledger.data.authSha256)need(ledger.data.authSha256===authSHA,'PRIVATE_AUTH_CHANGED','The original host auth file changed.');
    ledger.data.authSha256=authSHA;await ledger.save();
    ({createApplicationServer}=await import(pathToFileURL(join(source,'server.mjs')).href));
    need(typeof createApplicationServer==='function','CORE_SERVER_EXPORT_MISSING','Use the original complete server facade.');
    receivingApplicationServer=createApplicationServer;
    if(separateReceiving){
      ({createApplicationServer:receivingApplicationServer}=await import(pathToFileURL(join(receivingSource,'server.mjs')).href));
      ({runBrowserJourney:runReceivingBrowserJourney}=await import(pathToFileURL(join(receivingSource,'receiving','browser.mjs')).href));
      need(typeof receivingApplicationServer==='function'&&typeof runReceivingBrowserJourney==='function','RECEIVING_SERVER_EXPORT_MISSING','Use the complete original received application and browser facade.');
    }
    const shared=await import(pathToFileURL(join(source,'reference','schema.mjs')).href);
    need(shared.SCHEMA_ID==='reference-v1'&&shared.FIELD_NAME==='default','REFERENCE_SCHEMA_CHANGED','Use the original shared schema and field.');
    const sourceServer=await openServer('source');

    const setup=await ledger.phase('original-source-native-import',async()=>{
      await progress({phase:'source-and-mapping'});
      const created=await create('source','create-original-project','Collaborative migration receiving','Original authored three-document reference; preserve both tenant boundaries and all native state.');
      const projectId=created.view.id;
      await command('source','tenant-a',projectId,'tenant.save',{tenantId:'tenant-a',name:'Reference tenant A',notes:'Two original authored documents.'});
      await command('source','tenant-b',projectId,'tenant.save',{tenantId:'tenant-b',name:'Reference tenant B',notes:'The original isolated document.'});
      const uploaded=await upload('source','original-documents',join(source,'reference','documents.json'),'documents.json');
      const sourceReply=await command('source','retain-original-documents',projectId,'source.retain',{uploadId:uploaded,title:'Original authored three-document population',role:'documents',
        metadata:{schema:reference.schema,provenance:reference.provenance,sourceSha256:REFERENCE_SHA256}});
      const documentSource=byTitle(sourceReply.view,'sources','Original authored three-document population');
      need(documentSource.sha256===REFERENCE_SHA256&&documentSource.bytes===3818,'RETAINED_SOURCE_CHANGED','Native intake changed the full reference.');
      const schemaUpload=await upload('source','shared-schema',join(source,'reference','schema.mjs'),'schema.mjs');
      const schemaReply=await command('source','retain-shared-schema',projectId,'source.retain',{uploadId:schemaUpload,title:'Original shared native/editor schema',role:'schema',metadata:{schemaId:shared.SCHEMA_ID,field:shared.FIELD_NAME}});
      const schemaSource=byTitle(schemaReply.view,'sources','Original shared native/editor schema');
      const editionReply=await command('source','save-original-edition',projectId,'edition.save',{
        title:'Original reviewed reference edition',notes:'The native transformer and editor share the exact schema.',
        sourceIds:[documentSource.id,schemaSource.id],schemaId:shared.SCHEMA_ID,field:shared.FIELD_NAME,
        config:{debounceMs:250,maxDebounceMs:1500,maxDocumentBytes:33554432,allowedOrigins:[sourceServer.origin]}});
      const edition=byTitle(editionReply.view,'editions','Original reviewed reference edition');
      await command('source','freeze-original-edition',projectId,'edition.freeze',{editionId:edition.id});
      const mapping={arrayPath:'documents',sourceKeyField:'id',titleField:'title',tenantField:'tenantId',contentField:'content',documentNameField:'documentName',
        schemaId:shared.SCHEMA_ID,field:shared.FIELD_NAME};
      const planned=await command('source','plan-original-migration',projectId,'migration.plan',{title:'Review all original documents',editionId:edition.id,sourceId:documentSource.id,format:'tiptap_json',mapping});
      const migration=byTitle(planned.view,'migrations','Review all original documents');
      need(migration.rows.length===3&&migration.rows.every(r=>!r.errors?.length),'NATIVE_REFERENCE_PLAN_INVALID','Retain the actual original plan errors.');
      const rows=migration.rows.map(row=>{
        const original=one(reference.documents,v=>v.id===row.sourceKey,'original source row');
        return {rowId:row.id,decision:'import',tenantId:original.tenantId,documentName:original.documentName,title:original.title,reason:'Import this complete explicitly authored reference document into its original tenant.'};
      });
      await command('source','review-original-migration',projectId,'migration.review',{migrationId:migration.id,rows});
      await command('source','apply-original-migration',projectId,'migration.apply',{migrationId:migration.id});
      const imported=await settle('source',projectId,{documentCount:3});
      const selected=reference.documents.map(row=>one(imported.documents,d=>d.tenantId===row.tenantId&&d.title===row.title,'imported '+row.id));
      need(selected.every(d=>d.epochId&&d.persisted?.sha256),'NATIVE_IMPORT_NOT_RETAINED','Every original imported document requires its complete binary receipt.');
      for(const [id,tenantId,access] of [['operator','tenant-a','write'],['operator','tenant-b','write'],['editor-a','tenant-a','write'],['editor-b','tenant-a','write'],['viewer','tenant-a','read'],['outsider','tenant-b','write']])
        await command('source','grant-'+id+'-'+tenantId,projectId,'grant.save',{actorId:id,tenantId,documentIds:[],access,enabled:true,reason:'Explicit receiving actor for this original tenant only.'});
      await command('source','review-import-result',projectId,'review.save',{subjectType:'migration',subjectId:migration.id,decision:'accepted',
        note:'All three original source documents were mapped and imported with complete native binary custody.',evidenceSourceIds:[documentSource.id,schemaSource.id]});
      const prepared=await command('source','prepare-original-deployment',projectId,'deployment.prepare',{title:'Original collaboration reference',editionId:edition.id});
      const deployment=byTitle(prepared.view,'deployments','Original collaboration reference');
      await command('source','start-original-deployment',projectId,'deployment.start',{deploymentId:deployment.id});
      await ensureRunning('source','original-native-import',projectId,deployment.id);
      const sourceFile=await download('source','/api/projects/'+projectId+'/sources/'+documentSource.id+'/content',join(output,'original-documents.json'),
        {bytes:3818,sha256:REFERENCE_SHA256});
      return {projectId,documentSourceId:documentSource.id,schemaSourceId:schemaSource.id,editionId:edition.id,migrationId:migration.id,
        deploymentId:deployment.id,documents:selected.map(publicDocument),sourceFile,createReplay:await replay('source','create-original-project'),
        importReplay:await replay('source','apply-original-migration')};
    });
    const projectId=setup.projectId,documentIds=setup.documents.map(d=>d.id);
    const browser=await ledger.phase('complete-original-browser',async()=>{
      await progress({phase:'original-collaboration-browser'});
      await ensureRunning('source','original-browser',projectId,setup.deploymentId);
      return runOwnedBrowser(runBrowserJourney,{directory:join(directory,'browser-working'),sourceRoot:source,origin:sourceServer.origin,actors,projectId,documentIds,
        playwright:input.playwright,chromium:input.chromium,phase:'collaboration',runtimeReadySha256:input.runtimeReadySha256,sourceManifestSha256:input.sourceManifestSha256,
        historicalRevision:ledger.data.requests['source:review-original-migration'].response.view.revision,onProgress:progress,
        checkpoint:async({documentId,persisted})=>{
          const r=await command('source','checkpoint-before-epoch-restore',projectId,'checkpoint.create',{title:'Complete native baseline before content restoration',deploymentId:setup.deploymentId,mode:'persisted'});
          const checkpointView=await settle('source',projectId);
          const cp=byTitle(checkpointView,'checkpoints','Complete native baseline before content restoration');
          await download('source','/api/projects/'+projectId+'/checkpoints/'+cp.id+'/download',join(output,'checkpoint-before-restore.ndjson.gz'));
          return {checkpointId:cp.id,documentId,persisted,checkpoint:cp};
        },
        restore:async({checkpointId,documentId,previousEpochId})=>{
          await command('source','restore-original-document-epoch',projectId,'document.restore',{checkpointId,documentIds:[documentId],
            reason:'Verify explicit restoration while an older editor retains an isolated offline update.',mode:'new_epoch'});
          let selected=await settle('source',projectId),document=one(selected.documents,d=>d.id===documentId,'restored document');
          need(document.epochId!==previousEpochId,'RESTORE_EPOCH_NOT_CHANGED','Content restore must create a distinct physical epoch.');
          const deployment=one(selected.deployments,d=>d.id===setup.deploymentId,'original stopped deployment');
          need(['stopped','prepared'].includes(deployment.status),'RESTORE_LEFT_RUNTIME_ACTIVE','Content restore must leave native collaboration stopped.');
          await command('source','restart-after-explicit-restore',projectId,'deployment.start',{deploymentId:setup.deploymentId});
          await ensureRunning('source','restored-document-browser',projectId,setup.deploymentId);
          return {projectId,documentId,previousEpochId,epochId:document.epochId,document:publicDocument(document),
            replay:await replay('source','restore-original-document-epoch')};
        }});
    });
    const baseline=await ledger.phase('closed-baseline-handoff',async()=>{
      await command('source','stop-before-baseline-handoff',projectId,'deployment.stop',{deploymentId:setup.deploymentId,reason:'Close the original browser collaboration before complete receiving custody.'});
      await deploymentState('source',projectId,setup.deploymentId,['stopped']);
      await settle('source',projectId);
      await command('source','baseline-drain-checkpoint',projectId,'checkpoint.create',{title:'Closed baseline native custody',deploymentId:setup.deploymentId,mode:'drain'});
      await settle('source',projectId);
      const r=await command('source','prepare-baseline-handoff',projectId,'handoff.prepare',current=>({title:'Original collaborative baseline',notes:'Complete original source, review, native state, and explicit restore history.',revision:current.revision}));
      const handoff=byTitle(r.view,'handoffs','Original collaborative baseline');
      const file=await download('source','/api/projects/'+projectId+'/handoffs/'+handoff.id+'/download',join(output,'baseline-handoff.ndjson.gz'),handoff);
      return {handoff,file,project:await view('source',projectId),replay:await replay('source','prepare-baseline-handoff')};
    });
    const forward=await ledger.phase('runtime-rollback-and-forward-handoff',async()=>{
      await progress({phase:'runtime-configuration-and-delivery'});
      const before=await view('source',projectId),original=one(before.editions,e=>e.id===setup.editionId,'original edition');
      const beforeDocuments=baseline.project.documents.map(publicDocument);
      const candidateReply=await command('source','save-candidate-runtime-edition',projectId,'edition.save',{
        title:'Reviewed alternate persistence timing',notes:'An explicit configuration realization; document state stays native and complete.',
        sourceIds:original.sourceIds,schemaId:original.schemaId,field:original.field,config:{...original.config,debounceMs:500,maxDebounceMs:2000}});
      const candidate=byTitle(candidateReply.view,'editions','Reviewed alternate persistence timing');
      await command('source','freeze-candidate-runtime-edition',projectId,'edition.freeze',{editionId:candidate.id});
      const prepared=await command('source','prepare-candidate-deployment',projectId,'deployment.prepare',{title:'Reviewed alternate runtime',editionId:candidate.id});
      const deployment=byTitle(prepared.view,'deployments','Reviewed alternate runtime');
      if(!ledger.data.requests['source:rollback-native-runtime-configuration']) {
        await command('source','start-candidate-deployment',projectId,'deployment.start',{deploymentId:deployment.id});
        await ensureRunning('source','candidate-runtime',projectId,deployment.id);
      }
      await command('source','rollback-native-runtime-configuration',projectId,'deployment.rollback',{deploymentId:deployment.id,targetEditionId:setup.editionId,
        reason:'Return to the original reviewed persistence configuration without replacing collaborative document data.',documentPolicy:'preserve_current'});
      const after=await settle('source',projectId);
      for(const expected of beforeDocuments){const actual=publicDocument(one(after.documents,d=>d.id===expected.id,'preserved document'));
        need(JSON.stringify(actual)===JSON.stringify(expected),'CONFIGURATION_ROLLBACK_CHANGED_DOCUMENT','Runtime rollback changed native document content or epoch.');}
      const currentDeployment=one(after.deployments,d=>d.id===deployment.id,'candidate deployment');
      if(currentDeployment.status==='running'||currentDeployment.status==='stopping')await command('source','stop-after-runtime-rollback',projectId,'deployment.stop',{deploymentId:deployment.id,reason:'Close original runtime before final full handoff.'});
      await deploymentState('source',projectId,deployment.id,['stopped','prepared']);
      await settle('source',projectId);
      const cpReply=await command('source','final-drain-checkpoint',projectId,'checkpoint.create',{title:'Final reviewed native document checkpoint',deploymentId:deployment.id,mode:'drain'});
      const checkpointView=await settle('source',projectId);
      const checkpoint=byTitle(checkpointView,'checkpoints','Final reviewed native document checkpoint');
      await download('source','/api/projects/'+projectId+'/checkpoints/'+checkpoint.id+'/download',join(output,'final-checkpoint.ndjson.gz'));
      await command('source','review-final-checkpoint',projectId,'review.save',{subjectType:'checkpoint',subjectId:checkpoint.id,decision:'accepted',
        note:'Native concurrent, delete-only, offline, new-epoch, and configuration-preservation observations are retained in the same receiving programme.',
        evidenceSourceIds:[setup.documentSourceId,setup.schemaSourceId]});
      const r=await command('source','prepare-forward-handoff',projectId,'handoff.prepare',current=>({title:'Complete reviewed collaborative receiving edition',notes:'All original source and binary history retained; receiving opens closed.',revision:current.revision}));
      const handoff=byTitle(r.view,'handoffs','Complete reviewed collaborative receiving edition');
      const file=await download('source','/api/projects/'+projectId+'/handoffs/'+handoff.id+'/download',join(output,'forward-handoff.ndjson.gz'),handoff);
      const exactReplay=await replay('source','rollback-native-runtime-configuration');
      await download('source','/api/projects/'+projectId+'/handoffs/'+baseline.handoff.id+'/download',join(output,'baseline-handoff.ndjson.gz'),baseline.handoff);
      return {handoff,file,checkpoint,beforeDocuments,afterDocuments:after.documents.map(publicDocument),project:await view('source',projectId),rollbackReplay:exactReplay};
    });

    const receiveResults=await ledger.phase('fresh-same-forward-older-receiving',async()=>{
      await progress({phase:'fresh-and-forward-receiving'});
      await openServer('receiving');
      const placeholder=await create('receiving','create-receiving-placeholder','Receiving original collaborative project','Temporary empty intake boundary; original project identity is selected by receiving.');
      const baselineUpload=await upload('receiving','baseline-package',join(directory,baseline.file.path),'baseline-handoff.ndjson.gz');
      const fresh=await command('receiving','receive-original-baseline',placeholder.view.id,'handoff.receive',{uploadId:baselineUpload});
      need(fresh.view.id===projectId&&(fresh.result.projectId||fresh.view.id)===projectId,'IMPORTED_PROJECT_ID_CHANGED','Receiving must select the original project, not its placeholder.');
      need((fresh.view.deployments||[]).every(d=>d.status!=='running'&&d.status!=='stopping'),'RECEIVING_STARTED_SOURCE_RUNTIME','Fresh receiving must open closed.');
      const duplicateReplay=await replay('receiving','receive-original-baseline');
      const same=await command('receiving','receive-same-baseline',projectId,'handoff.receive',{uploadId:baselineUpload});
      const forwardUpload=await upload('receiving','forward-package',join(directory,forward.file.path),'forward-handoff.ndjson.gz');
      const advanced=await command('receiving','receive-forward-edition',projectId,'handoff.receive',{uploadId:forwardUpload});
      const current=await view('receiving',projectId);
      const old=await command('receiving','receive-older-original-baseline',projectId,'handoff.receive',{uploadId:baselineUpload});
      const afterOld=await view('receiving',projectId);
      need(afterOld.revision>=current.revision,'OLDER_RECEIVE_ROLLED_BACK_HISTORY','An older package moved the current receiving revision backward.');
      for(const expected of forward.project.documents.map(publicDocument)){
        const actual=publicDocument(one(afterOld.documents,d=>d.id===expected.id,'received document'));
        need(JSON.stringify(actual)===JSON.stringify(expected),'RECEIVED_NATIVE_DOCUMENT_CHANGED','The complete original native document was not preserved.');
      }
      const retainedSource=one(afterOld.sources,s=>s.id===setup.documentSourceId,'received original source');
      need(retainedSource.sha256===REFERENCE_SHA256,'RECEIVED_ORIGINAL_SOURCE_CHANGED','Receiving changed the original reference source.');
      const sourceFile=await download('receiving','/api/projects/'+projectId+'/sources/'+setup.documentSourceId+'/content',join(output,'received-original-documents.json'),{bytes:3818,sha256:REFERENCE_SHA256});
      const historyRevision=ledger.data.requests['source:review-original-migration'].response.view.revision;
      const historical=await view('receiving',projectId,historyRevision);
      need(historical.historical&&historical.revision===historyRevision,'RECEIVED_HISTORY_CHANGED','The original migration review is not available as its own revision.');
      await download('receiving','/api/projects/'+projectId+'/sources/'+setup.documentSourceId+'/content?revision='+historyRevision,
        join(output,'historical-original-documents.json'),{bytes:3818,sha256:REFERENCE_SHA256});
      return {fresh,same,advanced,older:old,requestReplay:duplicateReplay,current:afterOld,historical,sourceFile};
    });
    const receivingBrowser=await ledger.phase('receiving-browser-and-native-reopen',async()=>{
      const received=await openServer('receiving');
      const displayed=(await view('receiving',projectId)).handoffs||[];
      // The final outer handoff describes the selected revision and is not
      // self-contained inside that same revision. Download every named record
      // that the received original snapshot actually carries.
      const expectedHandoffs=displayed.filter(h=>h.id===baseline.handoff.id||h.id===forward.handoff.id).map(h=>({id:h.id,bytes:h.bytes,sha256:h.sha256}));
      const result=await runOwnedBrowser(runReceivingBrowserJourney,{directory:join(directory,'browser-receiving'),sourceRoot:receivingSource,origin:received.origin,actors,projectId,documentIds,
        playwright:input.playwright,chromium:input.chromium,phase:'receiving',runtimeReadySha256:receivingRuntimeSHA,sourceManifestSha256:input.sourceManifestSha256,
        historicalRevision:receiveResults.historical.revision,expectedHandoffs,onProgress:progress});
      const beforeSource=await view('source',projectId),beforeReceived=await view('receiving',projectId);
      await closeServer('receiving');await closeServer('source');
      await openServer('source');await openServer('receiving');
      const afterSource=await view('source',projectId),afterReceived=await view('receiving',projectId);
      need(afterSource.id===beforeSource.id&&afterSource.revision===beforeSource.revision&&afterReceived.id===beforeReceived.id&&afterReceived.revision===beforeReceived.revision,
        'REOPEN_PROJECT_CHANGED','The same original workspaces did not reopen their retained revisions.');
      for(const [before,after] of [[beforeSource,afterSource],[beforeReceived,afterReceived]])
        need(JSON.stringify(before.documents.map(publicDocument))===JSON.stringify(after.documents.map(publicDocument)),'REOPEN_NATIVE_STATE_CHANGED','Native binary identity changed on reopen.');
      return {browser:result,source:afterSource,receiving:afterReceived,
        receivedRequestReplay:await replay('receiving','receive-original-baseline'),sourceHandoffReplay:await replay('source','prepare-forward-handoff')};
    });
    await immutable(join(output,'selected-source-manifest.json'),sourceManifestBytes);
    await immutable(join(output,'actual-runtime-ready.json'),runtimeBytes);
    if(separateReceiving)await immutable(join(output,'receiving-runtime-ready.json'),receivingSelection.bytes);
    await immutable(join(output,'native-request-receipts.json'),json(ledger.data.requests));
    await immutable(join(output,'receiving-observations.json'),json({setup,browser,baseline,forward,receiveResults,receivingBrowser}));
    await closeAll();lifetime.check();need(!servers.size&&!browserOwners.size&&!httpBodies.size,'APPLICATION_OWNER_CLOSE_FAILED','The original application/browser/body owners must close before the immutable result.');
    const files=[];
    for(const name of await fs.readdir(output))if(!name.includes('.tmp-'))files.push(await fileInfo(join(output,name),directory));
    for(const sub of ['browser-working','browser-receiving']){
      const browserResult=await readJSON(join(directory,sub,'result.json'));
      files.push(await fileInfo(join(directory,sub,'result.json'),directory));
      for(const f of browserResult.files)files.push({...f,path:sub+'/'+f.path});
    }
    await verifyFiles(directory,files);
    const candidate={schema:'tjlabs.tiptap-receiving-result.v1',operationId:OPERATION,state:'complete',input,completedAt:now(),ownersClosedAt:now(),
      projectId,referenceDocuments:3,tenants:2,sourceRevision:receivingBrowser.source.revision,receivingRevision:receivingBrowser.receiving.revision,
      sourceRuntime:ledger.data.servers.source.runtime,receivingRuntime:ledger.data.servers.receiving.runtime,
      checks:{nativeMigration:true,concurrentEditors:true,completeDeletionPersistence:true,offlineNativeMerge:true,tenantIsolation:true,
        oldEpochIsolation:true,configurationPreservesContent:true,originalHTTPReplay:true,freshSameForwardOlderReceiving:true,historicalRevision:true,reopen:true,desktopMobile:true},
      files};
    completedCandidate=candidate;ledger.data.finalCandidate=candidate;await ledger.save();await immutable(resultPath,json(candidate));ledger.data.state='complete';await ledger.save();
    await progress({phase:'complete',projectId,result:resultPath,files:files.length});return candidate;
  }catch(e){
    lifetime.fail(e);
    if(ledger){ledger.data.lastError=clean(e);ledger.data.lastFailureAt=now();await ledger.save().catch(()=>{});}
    throw e;
  }
  }catch(error){
    lifetime.fail(error);
    try { error.receivingOwner=owner;error.closeFailedReceiving=owner.close; } catch {}
    throw error;
  }finally{
    await finalizeOwners();
    if(completedCandidate&&closure)Object.defineProperty(completedCandidate,'ownerClosure',{value:closure,enumerable:false,configurable:true});
    await lifetime.finish();
    if(lifetime.first){
      try { lifetime.first.receivingOwner=owner;lifetime.first.closeFailedReceiving=owner.close; } catch {}
      throw lifetime.first;
    }
  }
}
export async function main(argv=process.argv.slice(2),{signal=null}={}){return receive(argumentsOf(argv),{signal});}
if(process.argv[1]&&resolve(process.argv[1])===ENTRY){
  const cliLifetime=receivingLifetime();
  try {
    const result=await main(process.argv.slice(2),{signal:cliLifetime.signal});
    await receivingWrite(process.stdout,JSON.stringify({operationId:OPERATION,phase:'owner-closed',result:'result.json',
      closure:result.ownerClosure})+'\n',cliLifetime);
    cliLifetime.check();
  }catch(error){
    cliLifetime.fail(error);process.exitCode=1;
    try { await receivingWrite(process.stderr,JSON.stringify({...clean(cliLifetime.first),
      closure:error.receivingOwner?.closure||null})+'\n',cliLifetime); } catch {}
  }finally{
    await cliLifetime.finish();if(cliLifetime.first)process.exitCode=1;
  }
}
