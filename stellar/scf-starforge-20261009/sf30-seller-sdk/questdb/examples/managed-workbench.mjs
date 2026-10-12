#!/usr/bin/env node
// MIT. Continue the original native QuestDB case through installed Applications.
import { constants } from 'node:fs';
import { mkdir, readFile, writeFile, rename, open, realpath, lstat, link, unlink } from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const PREFIX='stellar/scf-starforge-20261009';
const PRODUCT=PREFIX+'/sf30-seller-sdk/questdb';
const NATIVE_PIN='342e328d0ef9b9ba41ecfb9a9171bf0c5393e6b1';
const SCHEMA='native.questdb-managed-journey.v1';
const HASH=/^[a-f0-9]{64}$/, COMMIT=/^[a-f0-9]{40}$/;
const execute=promisify(execFile), sha=value=>createHash('sha256').update(value).digest('hex');
const encoded=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const now=()=>new Date().toISOString();
function need(value,code,message=code){if(!value)throw Object.assign(new Error(message),{code});}
function inside(parent,path){const name=relative(parent,path);return name!==''&&!name.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&name!=='..'&&!isAbsolute(name);}
async function optional(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(issue){if(issue.code==='ENOENT')return null;throw issue;}}
async function privateDirectory(path,create=false,privateOnly=true){
  need(isAbsolute(path),'ABSOLUTE_DIRECTORY_REQUIRED');
  if(create)await mkdir(path,{recursive:true,mode:0o700});
  const info=await lstat(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&(!privateOnly||!(info.mode&0o077))&&await realpath(path)===path,
    'PRIVATE_REAL_DIRECTORY_REQUIRED',path+' must be an original private directory.');
  return path;
}
async function syncDirectory(path){const file=await open(path,constants.O_RDONLY);try{await file.sync();}finally{await file.close();}}
async function atomic(path,value){
  const temp=path+'.'+randomUUID()+'.tmp',file=await open(temp,'wx',0o600);
  try{await file.writeFile(encoded(value));await file.sync();}finally{await file.close();}
  await rename(temp,path);await syncDirectory(dirname(path));
}
async function immutable(path,value){
  const body=encoded(value);
  try{need((await readFile(path)).equals(body),'RETAINED_SELECTION_CHANGED',path);return;}
  catch(issue){if(issue.code!=='ENOENT')throw issue;}
  const temporary=path+'.'+randomUUID()+'.pending',file=await open(temporary,'wx',0o600);
  try{
    await file.writeFile(body);await file.sync();await file.close();
    try{await link(temporary,path);}
    catch(issue){if(issue.code!=='EEXIST')throw issue;need((await readFile(path)).equals(body),'RETAINED_SELECTION_CHANGED',path);}
    await syncDirectory(dirname(path));
  }finally{await file.close().catch(()=>{});await unlink(temporary).catch(issue=>{if(issue.code!=='ENOENT')throw issue;});}
}
async function fileIdentity(path,{maximum=64*1024*1024,privateOnly=true}={}){
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const first=await file.stat();
    need(first.isFile()&&first.size<=maximum&&(!privateOnly||!(first.mode&0o077)),'ORIGINAL_FILE_INVALID',path);
    const hash=createHash('sha256');
    for await(const part of file.createReadStream({start:0,autoClose:false}))hash.update(part);
    const last=await file.stat();
    need(first.size===last.size&&first.mtimeMs===last.mtimeMs&&first.ctimeMs===last.ctimeMs,'ORIGINAL_FILE_CHANGED',path);
    return{path,bytes:first.size,sha256:hash.digest('hex')};
  }finally{await file.close();}
}
async function originalNative(path,expectedSourcePin){
  path=resolve(path);const raw=await readFile(path);
  need(raw.length<=16*1024*1024,'NATIVE_RESULT_TOO_LARGE');
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),ctx=value.context;
  need(value.schema==='native.questdb-source-publisher-journey.v1'&&value.outcome==='PASS'&&
    value.sourcePin===expectedSourcePin&&COMMIT.test(value.sourcePin??'')&&ctx&&value.paths,
  'COMPLETED_NATIVE_QUESTDB_CASE_REQUIRED','Select the actual completed native-demo result and its original source pin.');
  const root=resolve(value.paths.directory),workbench=resolve(ctx.workspaceDirectory);
  await privateDirectory(root);await privateDirectory(workbench);
  need(inside(root,workbench)&&workbench===resolve(value.paths.workspaceDirectory)&&
    ctx.publicationId===value.reopen?.publicationId&&ctx.sourceRevision===value.reopen?.sourceRevision&&
    value.first?.run===ctx.firstRun&&value.second?.run===ctx.secondRun&&ctx.firstRun!==ctx.secondRun,
  'NATIVE_CASE_CONTEXT_CHANGED');
  for(const name of ['publisherDirectory','targetDirectory','sourceFile'])
    need(typeof ctx[name]==='string'&&inside(workbench,resolve(ctx[name])),'NATIVE_CASE_CONTEXT_CHANGED',name);
  const source=await fileIdentity(resolve(value.source.path));
  need(source.sha256===value.source.sha256&&source.bytes===value.source.bytes,'NATIVE_SOURCE_BYTES_CHANGED');
  need(same(await optional(join(root,'case.json')),value.case),'NATIVE_CASE_SELECTION_CHANGED');
  const sourceConfig=JSON.parse(await readFile(source.path,'utf8'));
  need(sourceConfig.schema==='stellar-forge.questdb-source.v1'&&sourceConfig.endpointEnv&&
    Number.isSafeInteger(value.first.rows)&&value.first.rows>0&&Number.isSafeInteger(value.second.rows)&&
    value.second.rows>=value.first.rows&&HASH.test(value.paid?.snapshot??'')&&Array.isArray(value.paid?.accepts),
  'NATIVE_CASE_RESULT_INVALID');
  for(const row of [value.sampled,value.preceding,value.first.capture,value.second.capture])
    need(row&&HASH.test(row.files?.manifest?.sha256??'')&&Number.isSafeInteger(row.rowCount),'NATIVE_CAPTURE_BINDING_REQUIRED');
  return{value,sourceConfig,root,workbench,result:{path,bytes:raw.length,sha256:sha(raw)}};
}

/** A local development adapter supplies the native seller's supported-kind discovery.
 * It accepts no payment operation. The actual native-demo paid result stays original.
 */
async function openDiscoveryFacilitator(directory,selection){
  const saved=selection??{schema:'native.questdb-managed-facilitator.v1',id:randomUUID(),port:0};
  need(saved.schema==='native.questdb-managed-facilitator.v1'&&Number.isInteger(saved.port)&&saved.port>=0&&saved.port<=65535,
    'FACILITATOR_SELECTION_INVALID');
  const counts={supported:0,other:0};
  const server=createServer((req,res)=>{
    const reply=(status,value)=>{const body=encoded(value);res.writeHead(status,{'content-type':'application/json','content-length':body.length,'cache-control':'no-store'});res.end(body);};
    if(req.method==='GET'&&req.url==='/supported'){
      counts.supported++;reply(200,{kinds:[{x402Version:2,scheme:'exact',network:'stellar:testnet'}],extensions:['bazaar'],signers:{}});return;
    }
    if(req.method==='GET'&&req.url==='/identity'){reply(200,{schema:saved.schema,id:saved.id});return;}
    counts.other++;req.resume();reply(405,{error:'This retained lifecycle adapter supplies discovery only.'});
  });
  server.requestTimeout=10000;server.headersTimeout=5000;
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(saved.port,'127.0.0.1',done);});
  const binding={...saved,port:server.address().port},url='http://127.0.0.1:'+binding.port;
  try{await immutable(join(directory,'facilitator.json'),binding);}
  catch(issue){await new Promise(done=>server.close(done));throw issue;}
  let closed=false;
  return{binding,url,counts,close:async()=>{if(closed)return;closed=true;const stopped=new Promise((done,reject)=>server.close(issue=>issue?reject(issue):done()));server.closeIdleConnections();await stopped;}};
}

async function readLoopbackFile(url,path,expected,destination){
  need(path.startsWith('/api/')&&!path.includes('?')&&!path.includes('#')&&HASH.test(expected.sha256)&&
    Number.isSafeInteger(expected.bytes)&&expected.bytes>=0,'RECEIVING_SELECTION_INVALID');
  try{
    const retained=await fileIdentity(destination);
    need(retained.sha256===expected.sha256&&retained.bytes===expected.bytes,'RECEIVED_FILE_CHANGED');
    return{...retained,reopened:true};
  }catch(issue){if(issue.code!=='ENOENT')throw issue;}
  const endpoint=new URL(url),controller=new AbortController(),partial=destination+'.receiving';
  const output=await open(partial,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
  const timer=setTimeout(()=>controller.abort(),120000);
  try{
    const existing=await output.stat();
    need(existing.isFile()&&!(existing.mode&0o077)&&existing.size<=expected.bytes,'RECEIVING_PARTIAL_INVALID');
    const response=await fetch(new URL(path,endpoint.origin),{redirect:'error',signal:controller.signal,
      headers:{authorization:'Bearer '+endpoint.hash.slice(1),origin:endpoint.origin}});
    need(response.status===200,'WORKBENCH_FILE_RESPONSE_FAILED',String(response.status));
    const length=response.headers.get('content-length');
    need(length===null||/^(0|[1-9][0-9]*)$/.test(length)&&Number(length)===expected.bytes,'WORKBENCH_FILE_LENGTH_CHANGED');
    let position=0;const hash=createHash('sha256');
    for await(const bytes of response.body){
      const chunk=Buffer.from(bytes);need(position+chunk.length<=expected.bytes,'WORKBENCH_FILE_TOO_LARGE');
      hash.update(chunk);
      const overlap=Math.max(0,Math.min(chunk.length,existing.size-position));
      if(overlap){
        const prior=Buffer.alloc(overlap);let read=0;
        while(read<overlap){const part=await output.read(prior,read,overlap-read,position+read);need(part.bytesRead>0,'RECEIVING_PREFIX_UNAVAILABLE');read+=part.bytesRead;}
        need(prior.equals(chunk.subarray(0,overlap)),'RECEIVING_PREFIX_CHANGED');
      }
      let written=overlap;
      while(written<chunk.length){const part=await output.write(chunk,written,chunk.length-written,position+written);need(part.bytesWritten>0,'RECEIVING_WRITE_FAILED');written+=part.bytesWritten;}
      position+=chunk.length;
    }
    need(position===expected.bytes&&hash.digest('hex')===expected.sha256,'RECEIVING_HASH_MISMATCH');
    await output.sync();
  }finally{clearTimeout(timer);await output.close();}
  try{await link(partial,destination);}
  catch(issue){if(issue.code!=='EEXIST')throw issue;const retained=await fileIdentity(destination);need(retained.sha256===expected.sha256&&retained.bytes===expected.bytes,'RECEIVED_FILE_CHANGED');}
  await unlink(partial);await syncDirectory(dirname(destination));
  return{path:destination,bytes:expected.bytes,sha256:expected.sha256,reopened:false};
}

async function startMcpProcess({modulePath,url,environment,directory,label}){
  const child=spawn(process.execPath,[modulePath],{cwd:directory,shell:false,
    env:{...environment,QUESTDB_WORKSPACE_URL:url},stdio:['pipe','pipe','pipe']});
  const pending=new Map(),stderr=[],notifications=[];let serial=0,stderrBytes=0,ended=false,inputFailure=null;
  let closingRequested=false,closePromise=null,closedTrace=null;
  const failInput=issue=>{
    inputFailure??=Object.assign(new Error('Original MCP input stream failed.'),{code:'MCP_INPUT_FAILED',causeCode:issue?.code??null});
    for(const item of pending.values()){clearTimeout(item.timer);item.reject(inputFailure);}pending.clear();
  };
  child.stdin.on('error',failInput);
  const terminal=new Promise(done=>child.once('close',(code,signal)=>{ended=true;for(const item of pending.values()){clearTimeout(item.timer);item.reject(Object.assign(new Error('Original MCP process ended.'),{code:'MCP_PROCESS_ENDED'}));}pending.clear();done({code,signal});}));
  const lines=createInterface({input:child.stdout,crlfDelay:Infinity});
  lines.on('line',line=>{
    if(Buffer.byteLength(line)>8388608){child.kill('SIGTERM');return;}
    let value;try{value=JSON.parse(line);}catch{child.kill('SIGTERM');return;}
    if(Object.hasOwn(value,'id')){
      const item=pending.get(value.id);if(!item)return;
      pending.delete(value.id);clearTimeout(item.timer);
      value.error?item.reject(Object.assign(new Error(value.error.message),{code:'MCP_JSONRPC_ERROR',details:value.error})):item.resolve(value.result);
    }else if(notifications.length<20)notifications.push(value);
  });
  child.stderr.on('data',data=>{const remain=131072-stderrBytes;if(remain>0){const part=data.subarray(0,remain);stderr.push(part);stderrBytes+=part.length;}});
  await new Promise((done,reject)=>{child.once('spawn',done);child.once('error',reject);});
  function requireInput(){
    if(inputFailure)throw inputFailure;
    need(!ended,'MCP_PROCESS_ENDED');need(!closingRequested,'MCP_PROCESS_CLOSING');
  }
  function request(method,params){
    requireInput();const id=++serial;
    return new Promise((done,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(Object.assign(new Error('Original MCP request did not finish: '+method),{code:'MCP_REQUEST_TIMEOUT'}));},120000);
      pending.set(id,{resolve:done,reject,timer});
      child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,...(params===undefined?{}:{params})})+'\n',issue=>{
        if(issue){const item=pending.get(id);if(item){clearTimeout(item.timer);pending.delete(id);item.reject(issue);}}
      });
    });
  }
  const notify=(method,params)=>{requireInput();return child.stdin.write(JSON.stringify({jsonrpc:'2.0',method,...(params===undefined?{}:{params})})+'\n');};
  async function call(name,input={}){
    const result=await request('tools/call',{name,arguments:input});
    if(result?.isError){
      const detail=result.content?.find(value=>value.type==='text')?.text??'Original MCP tool failed';
      throw Object.assign(new Error(detail),{code:'MCP_TOOL_FAILED'});
    }
    if(result?.structuredContent)return result.structuredContent;
    const text=result?.content?.find(value=>value.type==='text')?.text;
    need(typeof text==='string','MCP_TOOL_RESULT_REQUIRED');return JSON.parse(text);
  }
  async function within(milliseconds){
    const timeout=new AbortController();
    try{return await Promise.race([terminal,delay(milliseconds,null,{signal:timeout.signal,ref:false})]);}
    finally{timeout.abort();}
  }
  async function close(){
    if(closedTrace)return closedTrace;
    if(closePromise)return closePromise;
    closingRequested=true;
    closePromise=(async()=>{
      if(!ended)try{child.stdin.end();}catch(issue){failInput(issue);}
      let result=await within(5000);
      if(!result){child.kill('SIGTERM');result=await within(5000);}
      if(!result){child.kill('SIGKILL');result=await within(5000);}
      need(result,'MCP_PROCESS_STILL_ACTIVE');
      lines.close();
      const trace={schema:'native.questdb-managed-mcp-process.v1',pid:child.pid,...result,
        requests:serial,notifications,inputFailure:inputFailure?{code:inputFailure.code,causeCode:inputFailure.causeCode}:null,
        stderr:Buffer.concat(stderr).toString('utf8')};
      await atomic(join(directory,label+'-mcp-process.json'),trace);closedTrace=trace;return trace;
    })();
    try{return await closePromise;}finally{closePromise=null;}
  }
  return{pid:child.pid,request,notify,call,close};
}
async function allCaptures(client){
  const rows=[];let offset=0;
  do{
    const page=await client.captures({offset,limit:100});
    need(Array.isArray(page.items)&&page.offset===offset&&Number.isSafeInteger(page.total),'CAPTURE_PAGE_INVALID');
    rows.push(...page.items);if(page.nextOffset===null){need(rows.length===page.total,'CAPTURE_PAGE_INCOMPLETE');return rows;}
    need(Number.isSafeInteger(page.nextOffset)&&page.nextOffset>offset,'CAPTURE_PAGE_DID_NOT_ADVANCE');offset=page.nextOffset;
  }while(true);
}
function shortRun(run){return{id:run.id,state:run.state,plan:run.data?.planId??null};}
function applicationSummary(value){
  return{id:value.id,revision:value.revision,kind:value.kind,phase:value.phase,
    runtime:value.runtime,home:value.home,release:value.release,totalRuns:value.totalRuns,
    current:value.current?{id:value.current.id,phase:value.current.phase,active:value.current.active,
      state:value.current.state,result:value.current.result,stop:value.current.stop,
      startup:value.current.url?.original??null,origin:value.current.privateUrl?new URL(value.current.privateUrl).origin:null}:null};
}

export async function runQuestDbManagedJourney({directory,nativeResultPath,runtimeDirectory,expectedManifest,
  expectedNativeSourcePin=NATIVE_PIN,expectedProductSourceSha256,environmentFile,onOpen=async()=>{},onEvent=()=>{},
  timeoutMs=180000}={}){
  need(typeof directory==='string'&&typeof nativeResultPath==='string'&&typeof runtimeDirectory==='string'&&
    HASH.test(expectedManifest??'')&&COMMIT.test(expectedNativeSourcePin??'')&&typeof onOpen==='function'&&
    Number.isSafeInteger(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=900000,'MANAGED_RECEIVING_ARGUMENTS_REQUIRED');
  directory=resolve(directory);runtimeDirectory=resolve(runtimeDirectory);
  await privateDirectory(directory,true);await privateDirectory(runtimeDirectory,false,false);
  const native=await originalNative(nativeResultPath,expectedNativeSourcePin);
  need(directory!==native.workbench&&!inside(native.workbench,directory)&&
    directory!==runtimeDirectory&&!inside(runtimeDirectory,directory),'SEPARATE_RECEIVING_DIRECTORY_REQUIRED');
  const sourceRoot=join(runtimeDirectory,'package','source');
  const fromSource=path=>import(pathToFileURL(join(sourceRoot,path)).href);
  const[{inspectMerchantRuntime,inspectInstalledRuntime},{createRuntimeWorkspace,openRuntimeWorkspace},
    {inspectQuestDbApplicationWorkspace,inspectQuestDbApplicationSource,checkQuestDbApplicationRuntime},
    {createQuestDbWorkbenchClient},{acquireWorkspace},{MCP_VERSION},{QUESTDB_TOOLS}]=await Promise.all([
      fromSource(PREFIX+'/sf46-release/runtime-package.mjs'),
      fromSource(PREFIX+'/distribution/runtime-workspace/model.mjs'),
      fromSource(PRODUCT+'/managed-application.mjs'),
      fromSource(PRODUCT+'/workspace/client.mjs'),
      fromSource(PREFIX+'/sf30-seller-sdk/postgres/publisher/files.mjs'),
      fromSource('stellar-forge/mcp-paid-agent/http-tools.mjs'),
      fromSource(PRODUCT+'/workspace/tools.mjs'),
    ]);
  const release=await acquireWorkspace(directory),attempt=randomUUID(),startedAt=now();
  let apps,facilitator,activeRun=null,mcp,finalResult,failure,reused=false;
  const changedEnvironment=new Map();
  const progressPath=join(directory,'managed-progress.json'),resultPath=join(directory,'managed-result.json');
  let progress={schema:'native.questdb-managed-progress.v1',createdAt:startedAt,stages:{},attempts:[]};
  const persist=async()=>atomic(progressPath,progress);
  const event=async(name,value={})=>{progress.lastEvent={name,at:now(),...value};await persist();onEvent({event:name,...value});};
  const appsDirectory=join(directory,'applications'),artifacts=join(directory,'receiving');
  const stageRecord=name=>progress.stages[name]??=( {attempts:[]} );
  async function selectedApplication(){
    const state=await apps.applicationsState({historyLimit:100});
    return state.applications.find(value=>value.id===progress.applicationId)??null;
  }
  async function waitFor(name,read,predicate){
    const deadline=Date.now()+timeoutMs;
    for(;;){
      const value=await read();if(predicate(value))return value;
      if(value?.phase==='UNAVAILABLE')throw Object.assign(new Error(value.error?.message??name),{code:value.error?.code??'APPLICATION_UNAVAILABLE'});
      if(value?.phase==='FAILED'||value?.adoption&&!value.adoption.active&&['FAILED','CANCELLED'].includes(value.adoption.phase))
        throw Object.assign(new Error(name+' failed in its original operation; inspect the retained output.'),{code:'ORIGINAL_APPLICATION_OPERATION_FAILED'});
      if(Date.now()>=deadline)throw Object.assign(new Error(name+' did not finish; the original operation remains in its retained history.'),{code:'APPLICATION_WAIT_TIMEOUT'});
      await delay(500);
    }
  }
  async function stopOriginal(operationId){
    if(!operationId)return null;
    const saved=await selectedApplication();
    need(saved,'ORIGINAL_APPLICATION_REQUIRED');
    const run=saved.runs.find(value=>value.id===operationId);
    if(!run)return null;
    if(run.active||['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(run.phase)){
      try{await apps.applicationsStop({applicationId:saved.id,operationId});}
      catch(issue){
        const current=(await apps.state()).operations.find(value=>value.id===operationId);
        if(current?.workerActive||current?.commandActive)throw issue;
        await apps.applicationsRecover({applicationId:saved.id,operationId});
      }
    }
    const closed=await waitFor('Stop original managed command',async()=>{
      const [value,state]=await Promise.all([selectedApplication(),apps.state()]);
      const original=value?.runs.find(row=>row.id===operationId),operation=state.operations.find(row=>row.id===operationId);
      return{application:value,run:original,operation};
    },value=>value.run&&!value.run.active&&!value.operation?.workerActive&&!value.operation?.commandActive&&
      !['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(value.run.phase));
    const output=await apps.applicationsOutput({applicationId:saved.id,operationId});
    await atomic(join(directory,operationId+'-stopped.json'),{application:applicationSummary(closed.application),operation:closed.operation,output});
    if(activeRun===operationId)activeRun=null;
    return{operationId,phase:closed.run.phase,result:closed.run.result,output:operationId+'-stopped.json'};
  }
  async function startOriginal(name){
    const stage=stageRecord(name);let attemptRecord=stage.attempts.at(-1);
    if(attemptRecord){
      const selected=await selectedApplication(),run=selected?.runs.find(value=>value.id===attemptRecord.requestId);
      if(run?.active&&!run.stop){
        activeRun=run.id;
        return waitFor('Original application startup',selectedApplication,value=>
          value?.current?.id===run.id&&value.phase==='RUNNING'&&Boolean(value.current.privateUrl));
      }
      if(run&&['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(run.phase)){
        await apps.applicationsRecover({applicationId:progress.applicationId,operationId:run.id});
        const current=await selectedApplication(),recovered=current.runs.find(value=>value.id===run.id);
        if(recovered?.active&&!recovered.stop){
          activeRun=run.id;
          return waitFor('Original application recovery',selectedApplication,value=>
            value?.current?.id===run.id&&value.phase==='RUNNING'&&Boolean(value.current.privateUrl));
        }
        await stopOriginal(run.id);
      }
      if(!run){
        // Save/start response recovery uses this original reviewed request unchanged.
        activeRun=attemptRecord.requestId;
        await apps.applicationsStart({applicationId:progress.applicationId,requestId:attemptRecord.requestId,reviewId:attemptRecord.reviewId});
        return waitFor('Original application startup',selectedApplication,value=>
          value?.current?.id===attemptRecord.requestId&&value.phase==='RUNNING'&&Boolean(value.current.privateUrl));
      }
      if(stage.completed)return null;
      attemptRecord.terminal={id:run.id,phase:run.phase,state:run.state,result:run.result,stop:run.stop};
      await persist();
    }
    const review=await apps.applicationsStartReview({applicationId:progress.applicationId});
    attemptRecord={requestId:randomUUID(),reviewId:review.id,reviewedAt:now(),
      previousRequestId:stage.attempts.at(-1)?.requestId??null};
    stage.attempts.push(attemptRecord);await persist();
    await immutable(join(directory,attemptRecord.requestId+'-start-review.json'),review);
    activeRun=attemptRecord.requestId;
    await apps.applicationsStart({applicationId:progress.applicationId,requestId:attemptRecord.requestId,reviewId:review.id});
    const opened=await waitFor('Original application startup',selectedApplication,value=>
      value?.current?.id===attemptRecord.requestId&&value.phase==='RUNNING'&&Boolean(value.current.privateUrl));
    need(opened.current.url?.original?.schema==='stellar-forge.questdb-application-startup.v1','ORIGINAL_STARTUP_BINDING_REQUIRED');
    await atomic(join(directory,name+'-connection.json'),{questdbWorkspace:opened.current.privateUrl,
      applicationId:opened.id,operationId:opened.current.id,directory:native.workbench});
    await event(name+'-open',{applicationId:opened.id,operationId:opened.current.id,origin:new URL(opened.current.privateUrl).origin});
    return opened;
  }
  async function inspectProduct(client,binding){
    const value=native.value,ctx=value.context,state=await client.state(),product=await client.publication(ctx.publicationId);
    need(state.directory===native.workbench&&state.revision===ctx.sourceRevision&&
      state.sourceHash===binding.current.sourceHash&&same(state.source,native.sourceConfig)&&
      state.publications.length===1&&state.publications[0].id===ctx.publicationId,'MANAGED_SOURCE_BINDING_CHANGED');
    need(product.id===ctx.publicationId&&product.status.directory===ctx.publisherDirectory&&
      product.target.directory===ctx.targetDirectory&&product.target.dataset.rowCount===value.second.rows&&
      Boolean(product.seller?.origin),'MANAGED_PUBLICATION_BINDING_CHANGED');
    const[first,second]=await Promise.all([client.run(ctx.publicationId,ctx.firstRun),client.run(ctx.publicationId,ctx.secondRun)]);
    need(first.run.id===ctx.firstRun&&second.run.id===ctx.secondRun&&first.run.state==='PUBLISHED'&&second.run.state==='PUBLISHED'&&
      first.preview.page.total===value.first.rows&&second.preview.page.total===value.second.rows&&
      first.run.data.candidate.dataset.snapshot===value.paid.snapshot,'MANAGED_EDITION_CHANGED');
    for(const preview of [first.preview,second.preview]){
      need(preview.rows.length>0,'ORIGINAL_NATIVE_ROWS_REQUIRED');
      for(const row of preview.rows){
        need(row.null_note===null&&row.empty_note===''&&typeof row.event_epoch_ns==='string'&&
          BigInt(row.event_epoch_ns)>BigInt(Number.MAX_SAFE_INTEGER)&&typeof row.decimal_price==='string'&&
          typeof row.event_time_ns==='string'&&typeof row.is_buy==='boolean','MANAGED_NATIVE_VALUES_CHANGED');
      }
    }
    const buyers=binding.current.publications.find(row=>row.id===ctx.publicationId);
    need(product.buyers.some(row=>row.id===value.paid.buyerRequestId&&row.intentId===value.paid.intentId)&&
      product.buyers.length===buyers.buyerCount,'MANAGED_BUYER_BINDING_CHANGED');
    const offer=await client.buyerOffer(ctx.publicationId,ctx.firstRun,'limit=20');
    need(same(offer.accepts,value.paid.accepts),'MANAGED_PAYMENT_CHOICES_CHANGED');
    const captures=await allCaptures(client),chosen={};
    for(const name of ['sampled','preceding']){
      const original=value[name],matches=captures.filter(row=>row.files?.manifest?.sha256===original.files.manifest.sha256);
      need(matches.length===1&&matches[0].state==='COMPLETE'&&matches[0].sourceHash===binding.current.sourceHash&&
        matches[0].manifest.rowCount===original.rowCount,'MANAGED_CAPTURE_CHANGED',name);
      chosen[name]=matches[0];
    }
    return{state,product,first,second,offer,captures,chosen};
  }
  async function inspectOpen(name,application,binding,runtime){
    const url=application.current.privateUrl,client=await createQuestDbWorkbenchClient({url});
    const selected=await inspectProduct(client,binding),installed=await inspectInstalledRuntime({
      home:application.home.directory,releaseId:application.release.id,load:true});
    need(installed.state==='READY'&&installed.sourceManifestSha256===runtime.sourceManifestSha256,
      'MANAGED_RELEASE_ATTACHMENT_CHANGED');
    const mcpPath=join(installed.managedSourceRoot,PRODUCT,'workspace/mcp.mjs');
    mcp=await startMcpProcess({modulePath:mcpPath,url,environment:process.env,directory,label:name});
    const initialized=await mcp.request('initialize',{protocolVersion:MCP_VERSION,capabilities:{},
      clientInfo:{name:'questdb-managed-receiving',version:'1.0.0'}});
    need(initialized.protocolVersion===MCP_VERSION,'MCP_PROTOCOL_CHANGED');mcp.notify('notifications/initialized');
    const catalogue=await mcp.request('tools/list'),expected=QUESTDB_TOOLS.map(value=>value.name).sort();
    need(same(catalogue.tools.map(value=>value.name).sort(),expected),'MCP_TOOL_CATALOGUE_CHANGED');
    const rpcState=await mcp.call('questdb_status'),rpcRun=await mcp.call('questdb_run',{
      publicationId:native.value.context.publicationId,runId:native.value.context.firstRun});
    need(rpcState.directory===native.workbench&&rpcState.revision===binding.current.revision&&
      rpcRun.run.id===native.value.context.firstRun&&rpcRun.preview.page.total===native.value.first.rows,
    'MCP_ORIGINAL_WORKSPACE_CHANGED');
    const capture=await mcp.call('questdb_capture_status',{captureId:selected.chosen.sampled.id});
    need(capture.files.manifest.sha256===native.value.sampled.files.manifest.sha256,'MCP_CAPTURE_CHANGED');
    const capturePart=await mcp.call('questdb_capture_file',{captureId:capture.id,file:'csv',offset:0,limit:196608});
    need(capturePart.sha256===capture.files.csv.sha256&&capturePart.totalBytes===capture.files.csv.bytes&&capturePart.offset===0&&
      Buffer.from(capturePart.base64,'base64').length===capturePart.bytes,'MCP_CAPTURE_RANGE_CHANGED');
    const received=await mcp.call('questdb_receive_capture',{captureId:capture.id,directory:join(artifacts,'sampled-capture')});
    need(received.receiving.state==='COMPLETE'&&received.capture.orderedRowsSha256===native.value.sampled.orderedRowsSha256&&
      received.capture.rowCount===native.value.sampled.rowCount,'MCP_COMPLETE_RECEIVING_CHANGED');
    const resources=await mcp.request('resources/read',{uri:'questdb://workspace/status'});
    const resourceState=JSON.parse(resources.contents[0].text);
    need(resourceState.directory===native.workbench&&resourceState.revision===binding.current.revision,'MCP_RESOURCE_CHANGED');
    const files=[];
    for(const[label,id]of [['first',native.value.context.firstRun],['second',native.value.context.secondRun]]){
      const destination=await privateDirectory(join(artifacts,label),true);
      for(const filename of ['data.csv','dataset.json','candidate.json']){
        const original=await fileIdentity(join(native.value.context.publisherDirectory,'runs',id,filename));
        files.push(await readLoopbackFile(url,'/api/publications/'+native.value.context.publicationId+'/files/'+id+'/'+filename,
          original,join(destination,filename)));
      }
    }
    const buyerId=native.value.paid.buyerRequestId,buyer=selected.product.buyers.find(row=>row.id===buyerId);
    const originalBuyer=await fileIdentity(join(native.workbench,'publications',native.value.context.publicationId,'buyers',buyerId+'.json'));
    need(originalBuyer.sha256===buyer.configSha256,'ORIGINAL_BUYER_BYTES_CHANGED');
    files.push(await readLoopbackFile(url,'/api/files/buyer/'+native.value.context.publicationId+'/'+buyerId,
      originalBuyer,join(artifacts,'original-buyer.json')));
    const opened={schema:'native.questdb-managed-open.v1',phase:name,application:applicationSummary(application),
      installation:{sourceCommit:runtime.sourceCommit,sourceManifestSha256:runtime.sourceManifestSha256,
        releaseId:installed.releaseId,releaseDirectory:installed.releaseDirectory},
      context:native.value.context,captures:selected.captures.map(row=>({id:row.id,state:row.state,query:row.query,files:row.files})),
      sourceRevision:selected.state.revision,first:{run:shortRun(selected.first.run),rows:selected.first.preview.page.total,
        snapshot:selected.first.run.data.candidate.dataset.snapshot},
      second:{run:shortRun(selected.second.run),rows:selected.second.preview.page.total,
        snapshot:selected.second.run.data.candidate.dataset.snapshot},
      paymentChoices:selected.offer.accepts,buyers:selected.product.buyers,schedule:selected.product.schedule,
      mcp:{pid:mcp.pid,protocolVersion:initialized.protocolVersion,tools:expected,originalCaptureId:capture.id},
      receiving:{directory:received.directory,files:received.receiving.files,rowCount:received.capture.rowCount},files};
    await atomic(join(directory,name+'-opened.json'),opened);
    await onOpen({phase:name,application,client,mcp,url,directory,nativeResult:native.value,runtime,opened});
    // The receiving callback observes the retained product; changed user work gets
    // a new explicit continuation rather than silently replacing this baseline.
    const after=await inspectQuestDbApplicationWorkspace(native.workbench,{expectedIdentity:binding.sha256});
    need(after.currentSha256===binding.currentSha256,'MANAGED_WORKBENCH_CHANGED_DURING_RECEIVING');
    await inspectProduct(client,binding);
    const mcpResult=await mcp.close();mcp=null;
    need(mcpResult.code===0,'MCP_PROCESS_FAILED',JSON.stringify(mcpResult));
    opened.mcp.result=mcpResult;
    await atomic(join(directory,name+'-opened.json'),opened);return opened;
  }
  try{
    const retainedProgress=await optional(progressPath);
    if(retainedProgress){
      need(retainedProgress.schema==='native.questdb-managed-progress.v1'&&retainedProgress.stages&&
        typeof retainedProgress.stages==='object'&&!Array.isArray(retainedProgress.stages)&&Array.isArray(retainedProgress.attempts),
        'MANAGED_PROGRESS_INVALID');
      progress=retainedProgress;
    }
    await privateDirectory(artifacts,true);await privateDirectory(join(directory,'attempts'),true);
    const runtime=await inspectMerchantRuntime(runtimeDirectory,{expectedManifest,load:true});
    checkQuestDbApplicationRuntime(runtime);
    const productSource=await inspectQuestDbApplicationSource(runtime.sourceRoot,
      expectedProductSourceSha256?{expectedSha256:expectedProductSourceSha256}:{});
    const binding=await inspectQuestDbApplicationWorkspace(native.workbench);
    need(binding.current.revision===native.value.context.sourceRevision&&binding.current.publications.length===1&&
      binding.current.publications[0].id===native.value.context.publicationId&&binding.current.publications[0].sellerRunningIntent,
    'ORIGINAL_NATIVE_WORKBENCH_BINDING_REQUIRED');
    const selection={schema:'native.questdb-managed-selection.v1',nativeResult:native.result,
      nativeSourcePin:expectedNativeSourcePin,workspaceIdentity:binding.sha256,workspaceCurrentSha256:binding.currentSha256,
      runtime:{directory:runtime.directory,installationId:runtime.installationId,profileId:runtime.profileId,
        profileSha256:runtime.profileSha256,lockSha256:runtime.lockSha256,sourceCommit:runtime.sourceCommit,
        sourceManifestSha256:runtime.sourceManifestSha256},productSource,
      ...(environmentFile?{environmentFile:resolve(environmentFile)}:{})};
    await immutable(join(directory,'selection.json'),selection);
    await immutable(join(directory,'workbench-before.json'),binding);
    const complete=await optional(resultPath);
    if(complete?.outcome==='PASS'){finalResult=complete;reused=true;return complete;}
    progress.attempts.push({id:attempt,startedAt,node:process.version});await persist();
    for(const name of binding.current.requiredEnvironment){
      if(name===native.sourceConfig.endpointEnv){
        const value=native.value.case.endpoint;
        need(process.env[name]===undefined||process.env[name]===value,'ORIGINAL_ENDPOINT_ENVIRONMENT_CHANGED');
        changedEnvironment.set(name,process.env[name]);process.env[name]=value;
      }else if(!environmentFile)need(Boolean(process.env[name]),'ORIGINAL_CREDENTIAL_ENVIRONMENT_REQUIRED',name);
    }
    facilitator=await openDiscoveryFacilitator(directory,await optional(join(directory,'facilitator.json')));
    if(!await optional(join(appsDirectory,'workspace.json')))await createRuntimeWorkspace({directory:appsDirectory});
    apps=await openRuntimeWorkspace({directory:appsDirectory});
    const attached=await apps.attach({directory:runtimeDirectory,label:'Original QuestDB native workbench'});
    need(attached.status==='READY','READY_RUNTIME_REQUIRED');
    if(progress.runtimeId)need(progress.runtimeId===attached.runtimeId,'ORIGINAL_RUNTIME_ENTRY_CHANGED');
    else{progress.runtimeId=attached.runtimeId;await persist();}
    const catalogue=await apps.applicationsState({historyLimit:100});
    const kind=catalogue.catalog.find(value=>value.id==='questdb-publisher');
    need(kind?.command==='questdb-workspace','QUESTDB_APPLICATION_NOT_IN_READY_INSTALLATION');
    const settings={workspaceDirectory:native.workbench,datasetFacilitator:facilitator.url,
      allowLocalDatasetFacilitator:true,port:0,...(environmentFile?{environmentFile:resolve(environmentFile)}:{})};
    for(const name of Object.keys(settings))need(kind.fields.some(field=>field.name===name),'APPLICATION_SETTING_NOT_IN_ORIGINAL_CATALOGUE',name);
    if(!progress.applicationId){
      const saveRequestId=progress.saveRequestId??randomUUID();progress.saveRequestId=saveRequestId;await persist();
      const retained=catalogue.applications.find(value=>value.saveRequestId===saveRequestId);
      if(retained){progress.applicationId=retained.id;progress.savedRevision=retained.revision;await persist();}
      else{
        let review=progress.saveReviewId?await optional(join(appsDirectory,'application-reviews',progress.saveReviewId+'.json')):null;
        if(!review){review=await apps.applicationsReview({runtimeId:attached.runtimeId,kind:kind.id,settings,label:'QuestDB retained execution editions'});
          progress.saveReviewId=review.id;await persist();}
        await immutable(join(directory,'application-review.json'),review);
        const saved=await apps.applicationsSave({requestId:saveRequestId,reviewId:review.id});
        progress.applicationId=saved.applicationId;progress.savedRevision=saved.revision;await persist();
        await atomic(join(directory,'application-saved.json'),saved);
        if(saved.connectionError)throw Object.assign(new Error(saved.connectionError.message),{code:saved.connectionError.code});
      }
    }
    const selected=await selectedApplication();
    need(selected&&selected.kind===kind.id&&selected.revision===progress.savedRevision&&same(selected.settings,settings),
      'SAVED_APPLICATION_SELECTION_CHANGED');
    if(!selected.release)await apps.applicationsConnect({applicationId:selected.id});
    const connected=await waitFor('Original runtime adoption',selectedApplication,value=>Boolean(value?.release));
    await atomic(join(directory,'application-adopted.json'),applicationSummary(connected));
    await event('application-saved-and-adopted',{applicationId:connected.id,revision:connected.revision,releaseId:connected.release.id});
    let first=progress.stages.first?.completed?await optional(join(directory,'first-opened.json')):null;
    if(!first){
      const opened=await startOriginal('first');need(opened,'ORIGINAL_FIRST_START_REQUIRED');
      first=await inspectOpen('first',opened,binding,runtime);
      const stopped=await stopOriginal(opened.current.id);Object.assign(stageRecord('first'),{completed:true,stopped});await persist();
      await event('first-original-command-stopped',{operationId:stopped.operationId,phase:stopped.phase});
    }
    await apps.close();apps=null;
    const modulePath=pathToFileURL(join(sourceRoot,PREFIX,'distribution/runtime-workspace/model.mjs')).href;
    const bindingPath=pathToFileURL(join(sourceRoot,PRODUCT,'managed-application.mjs')).href;
    const probe=[
      "const {openRuntimeWorkspace}=await import(process.argv[1]);const {inspectQuestDbApplicationWorkspace}=await import(process.argv[2]);",
      "const model=await openRuntimeWorkspace({directory:process.argv[3]});",
      "try{const state=await model.applicationsState({historyLimit:100});const application=state.applications.find(value=>value.id===process.argv[4]);",
      "const workspace=await inspectQuestDbApplicationWorkspace(process.argv[5]);console.log(JSON.stringify({pid:process.pid,parentPid:Number(process.argv[6]),inspectedAt:new Date().toISOString(),node:process.version,application,workspace}));}finally{await model.close();}"
    ].join('\n');
    let reopened=await optional(join(directory,'fresh-process-reopened.json'));
    if(!reopened){
      reopened=JSON.parse((await execute(process.execPath,['--input-type=module','-e',probe,modulePath,bindingPath,appsDirectory,
        progress.applicationId,native.workbench,String(process.pid)],{env:process.env,timeout:120000,maxBuffer:8388608})).stdout);
      await atomic(join(directory,'fresh-process-reopened.json'),reopened);
    }
    need(Number.isSafeInteger(reopened.parentPid)&&reopened.pid!==reopened.parentPid&&reopened.application.id===progress.applicationId&&
      reopened.application.revision===progress.savedRevision&&!reopened.application.current?.active&&
      reopened.workspace.sha256===binding.sha256&&reopened.workspace.currentSha256===binding.currentSha256,
    'FRESH_PROCESS_REOPEN_CHANGED');
    apps=await openRuntimeWorkspace({directory:appsDirectory});
    let second=progress.stages.reopen?.completed?await optional(join(directory,'reopen-opened.json')):null;
    if(!second){
      const opened=await startOriginal('reopen');need(opened,'ORIGINAL_REOPEN_START_REQUIRED');
      second=await inspectOpen('reopen',opened,binding,runtime);
      const stopped=await stopOriginal(opened.current.id);Object.assign(stageRecord('reopen'),{completed:true,stopped});await persist();
      await event('reopened-original-command-stopped',{operationId:stopped.operationId,phase:stopped.phase});
    }
    need(first.application.id===second.application.id&&first.application.revision===second.application.revision&&
      first.application.current.id!==second.application.current.id&&same(first.paymentChoices,second.paymentChoices)&&
      same(first.buyers,second.buyers)&&same(first.captures,second.captures),'MANAGED_REOPEN_IDENTITY_CHANGED');
    const after=await inspectQuestDbApplicationWorkspace(native.workbench,{expectedIdentity:binding.sha256});
    need(after.currentSha256===binding.currentSha256,'RETAINED_NATIVE_WORKBENCH_CHANGED');
    const finalApplication=await selectedApplication();
    finalResult={schema:SCHEMA,outcome:'PASS',startedAt:progress.createdAt,completedAt:now(),attempt,
      nativeSourcePin:expectedNativeSourcePin,nativeResult:native.result,selection,
      application:applicationSummary(finalApplication),context:native.value.context,
      first,reopen:second,freshProcess:{pid:reopened.pid,node:reopened.node,applicationId:reopened.application.id,
        revision:reopened.application.revision,workspaceIdentity:reopened.workspace.sha256},
      sourceUnchanged:after.currentSha256===binding.currentSha256,lifecycle:progress.stages,
      facilitator:{schema:facilitator.binding.schema,discoveryRequests:facilitator.counts.supported,otherRequests:facilitator.counts.other},
      paths:{directory,result:resultPath,applications:appsDirectory,receiving:artifacts,
        originalWorkbench:native.workbench,originalNativeResult:native.result.path}};
    need(facilitator.counts.other===0,'UNEXPECTED_PAYMENT_OPERATION_DURING_REOPEN');
  }catch(issue){
    failure=issue;finalResult={schema:SCHEMA,outcome:'FAILED',startedAt:progress.createdAt,stoppedAt:now(),attempt,
      error:{code:issue.code??'QUESTDB_MANAGED_RECEIVING_FAILED',message:issue.message},
      nativeResult:native.result,context:native.value.context,applicationId:progress.applicationId??null,
      lastEvent:progress.lastEvent,lifecycle:progress.stages};
  }finally{
    const cleanup=[];
    if(mcp)try{await mcp.close();}catch(issue){cleanup.push({action:'close original MCP',message:issue.message});}
    if(apps&&activeRun)try{await stopOriginal(activeRun);}catch(issue){cleanup.push({action:'stop original managed command',operationId:activeRun,message:issue.message});}
    if(apps)try{await apps.close();}catch(issue){cleanup.push({action:'close Applications model',message:issue.message});}
    if(facilitator)try{await facilitator.close();}catch(issue){cleanup.push({action:'close local discovery adapter',message:issue.message});}
    for(const[name,value]of changedEnvironment){if(value===undefined)delete process.env[name];else process.env[name]=value;}
    if(cleanup.length){failure??=Object.assign(new Error('Original cleanup requires its retained operation.'),{code:'MANAGED_CLEANUP_INCOMPLETE'});
      finalResult={...finalResult,outcome:'FAILED',cleanup};}
    try{
      if(finalResult&&!reused){await immutable(join(directory,'attempts',attempt+'.json'),finalResult);await atomic(resultPath,finalResult);}
    }finally{await release();}
  }
  if(failure)throw failure;
  return finalResult;
}

const HELP=[
'Continue an actual completed QuestDB native case through the original installed Applications.',
'',
'node managed-workbench.mjs DIRECTORY --native-result ORIGINAL/journey-result.json',
'  --runtime ORIGINAL_READY_DIRECTORY --manifest ORIGINAL_PACKAGE_MANIFEST_SHA256',
'  [--native-source-pin COMMIT] [--product-source-sha256 SHA256]',
'  [--environment-file ORIGINAL_PRIVATE_ENVIRONMENT_FILE] [--browser-module MODULE.mjs]',
'',
'The selected runtime must already be READY and contain questdb-workspace and its native payment profile.',
'The optional browser module exports inspectQuestDbManagedApplication(context), invoked during each live',
'original managed command. context contains phase, private url, original client/MCP and retained identities.',
'Keep that receiving callback observational so this original native-result binding remains unchanged.',
'The full result and live connection files are retained privately; stdout contains paths and identities.',
''].join('\n');
export async function main(args=process.argv.slice(2)){
  if(!args.length||args.includes('--help')){process.stdout.write(HELP+'\n');return;}
  const[directory,...rest]=args,options={},names={
    '--native-result':'nativeResultPath','--runtime':'runtimeDirectory','--manifest':'expectedManifest',
    '--native-source-pin':'expectedNativeSourcePin','--product-source-sha256':'expectedProductSourceSha256',
    '--environment-file':'environmentFile','--browser-module':'browserModule'};
  need(rest.length%2===0,'MANAGED_RECEIVING_ARGUMENT_INVALID',HELP);
  for(let index=0;index<rest.length;index+=2){
    const name=names[rest[index]],value=rest[index+1];
    need(name&&value&&!value.startsWith('--')&&!Object.hasOwn(options,name),'MANAGED_RECEIVING_ARGUMENT_INVALID',HELP);options[name]=value;
  }
  if(options.browserModule){
    const module=await import(pathToFileURL(resolve(options.browserModule)).href);
    need(typeof module.inspectQuestDbManagedApplication==='function','BROWSER_RECEIVING_EXPORT_REQUIRED');
    options.onOpen=module.inspectQuestDbManagedApplication;delete options.browserModule;
  }
  const result=await runQuestDbManagedJourney({directory,...options,onEvent:value=>process.stdout.write(JSON.stringify(value)+'\n')});
  process.stdout.write(JSON.stringify({outcome:result.outcome,result:result.paths.result,applicationId:result.application.id,
    sourceRevision:result.context.sourceRevision,publicationId:result.context.publicationId})+'\n');return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(issue=>{process.stderr.write(JSON.stringify({code:issue.code??'QUESTDB_MANAGED_RECEIVING_FAILED',message:issue.message})+'\n');process.exitCode=1;});
