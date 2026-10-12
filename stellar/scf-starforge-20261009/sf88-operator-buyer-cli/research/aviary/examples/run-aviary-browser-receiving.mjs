#!/usr/bin/env node
/** The original public-source and completed-provider Aviary browser receiving journey.
 * All mutations go through the maintained UI; recovery uses the retained request,
 * original review history and original queued output. No provider action is invoked.
 */
import {spawn} from 'node:child_process';
import {open,readFile,writeFile,mkdir,link,unlink,rename,stat,lstat,readdir,realpath,readlink} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const arg={};
for(let i=2;i<process.argv.length;i+=2){
  const key=process.argv[i],value=process.argv[i+1];
  if(!key?.startsWith('--')||!value||value.startsWith('--')||Object.hasOwn(arg,key.slice(2)))throw new Error('Use each --name value once');
  arg[key.slice(2)]=value;
}
const allowed=new Set(['application','workspace','provider-workspace','operation-id','out','playwright-module','browser-executable','python']);
for(const key of Object.keys(arg))if(!allowed.has(key))throw new Error('Unknown option --'+key);
for(const key of ['application','workspace','provider-workspace','operation-id','out'])if(!arg[key])throw new Error('Missing --'+key);
const OPERATION='AVIARY-BROWSER-RECEIVING-6BA15-20261012';
const SCHEMA='commons.aviary.complete-browser-receiving.v2';
const ROOT=path.resolve(arg.out),APP=await realpath(path.resolve(arg.application));
const WORKSPACE=await realpath(path.resolve(arg.workspace));
const PROVIDER=await realpath(path.resolve(arg['provider-workspace']));
const PYTHON=arg.python||process.env.CODEX_PRIMARY_RUNTIME_PYTHON||'python3';
const SELF=fileURLToPath(import.meta.url);
const SUPPORT=path.join(path.dirname(SELF),'aviary_browser_support.py');
const PW=arg['playwright-module']?await realpath(path.resolve(arg['playwright-module'])):null;
const CHROME=arg['browser-executable']?await realpath(path.resolve(arg['browser-executable'])):null;
const SOURCE_FILES=['aviary.py','aviary_client.py','server.py','index.html','app.js','cli.mjs','README.md','PROVIDER_CONTRACT.md','managed.py','APPLICATIONS.md'];
const REVIEWED_GIT_BLOBS={
  'aviary.py':'98bffb67fc881ce552ea3e16b95653c71809d9c0',
  'aviary_client.py':'fbb80a55c1d013103b9ee2ab9035b702bc65cdd0',
  'server.py':'1b24cd4bcb4cff8c109d93c096dbe1439d6e29c7',
  'index.html':'4c8b810ead92c5f2b2ce35ae4cb34a36d74fcd10',
  'app.js':'b11290a355df1c2c109e1aecf7a9b6a068e2afbd'
};
const EXPECTED_COUNTS={resources:2,media:3,transcripts:1,indexes:2,supplemental:2};
const FIRST_NOTE='Public USGS collection reviewed from original publisher pages and captured media.';
const FINAL_NOTE=FIRST_NOTE+' Operator retained a later mapping note while the original save completed.';
const REASON='Temporary receiving review: retain the original resource while excluding it from this saved selection.';
const runId=randomUUID(),RUN=path.join(ROOT,'runs',runId);
const startedAt=new Date().toISOString();
const hash=b=>createHash('sha256').update(b).digest('hex');
const gitBlob=b=>createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
const encoded=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const jsonClone=v=>JSON.parse(JSON.stringify(v));
function expect(ok,message){if(!ok)throw new Error(message);}
function safeLabel(s){expect(typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(s),'Unsafe receiving label');return s;}
function within(root,filename){const relative=path.relative(root,path.resolve(filename));expect(relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative),'Path is outside its original directory: '+filename);return path.resolve(filename);}
async function exists(filename){try{await lstat(filename);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function readJson(filename,limit=8*1024*1024){
  const body=await readFile(filename);expect(body.length<=limit,'Retained JSON exceeds limit: '+filename);return JSON.parse(body.toString('utf8'));
}
async function optionalJson(filename,limit){try{return await readJson(filename,limit);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function syncDirectory(directory){const fd=await open(directory,'r');try{await fd.sync();}finally{await fd.close();}}
async function publishBytes(filename,body){
  await mkdir(path.dirname(filename),{recursive:true,mode:0o700});
  const original=await readFile(filename).catch(error=>error.code==='ENOENT'?null:Promise.reject(error));
  if(original!==null){expect(original.equals(body),'Immutable receiving file differs: '+filename);return filename;}
  const temporary=filename+'.pending-'+randomUUID();let fd=null;
  try{
    fd=await open(temporary,'wx',0o600);await fd.writeFile(body);await fd.sync();await fd.close();fd=null;
    try{await link(temporary,filename);}catch(error){if(error.code!=='EEXIST')throw error;expect((await readFile(filename)).equals(body),'Concurrent receiving publication differs: '+filename);}
    await syncDirectory(path.dirname(filename));return filename;
  }finally{
    if(fd)await fd.close().catch(()=>{});
    await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}
async function publish(filename,value){return publishBytes(filename,encoded(value));}
async function fileRecord(filename){
  const fd=await open(filename,'r');try{
    const before=await fd.stat({bigint:true});expect(before.isFile(),'Expected regular file: '+filename);
    const digest=createHash('sha256'),buffer=Buffer.allocUnsafe(256*1024);let bytes=0;
    while(true){const part=await fd.read(buffer,0,buffer.length,null);if(!part.bytesRead)break;digest.update(buffer.subarray(0,part.bytesRead));bytes+=part.bytesRead;}
    const after=await fd.stat({bigint:true});
    for(const key of ['dev','ino','size','mtimeNs','ctimeNs'])expect(before[key]===after[key],'File changed during receiving read: '+filename);
    expect(BigInt(bytes)===before.size,'File length changed: '+filename);
    return {path:path.resolve(filename),bytes,sha256:digest.digest('hex')};
  }finally{await fd.close();}
}
async function verifyFile(record){
  expect(record&&typeof record.path==='string'&&Number.isSafeInteger(record.bytes)&&/^[a-f0-9]{64}$/.test(record.sha256),'Invalid retained file descriptor');
  const actual=await fileRecord(record.path);expect(actual.bytes===record.bytes&&actual.sha256===record.sha256,'Retained file differs: '+record.path);return actual;
}
async function pinApplication(app){
  const files=[];
  for(const name of SOURCE_FILES){
    const filename=path.join(app,name),body=await readFile(filename);
    const blob=gitBlob(body);
    if(REVIEWED_GIT_BLOBS[name])expect(blob===REVIEWED_GIT_BLOBS[name],'Original reviewed application source differs: '+name);
    files.push({path:name,bytes:body.length,sha256:hash(body),gitBlob:blob});
  }
  return {files,sha256:hash(encoded(files))};
}
async function deadline(promise,milliseconds,label){
  let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),milliseconds);})]);}finally{clearTimeout(timer);}
}
function briefError(error){return {name:error?.name||'Error',message:String(error?.message||error),stack:typeof error?.stack==='string'?error.stack:null};}
expect(WORKSPACE!==PROVIDER,'Public and original provider workspaces must remain distinct');
for(const directory of [ROOT,RUN,path.join(ROOT,'steps'),path.join(ROOT,'captures'),path.join(ROOT,'tmp')])await mkdir(directory,{recursive:true,mode:0o700});
const sourcePin=await pinApplication(APP);
const inputValue={
  schema:SCHEMA,operationId:OPERATION,application:APP,workspace:WORKSPACE,providerWorkspace:PROVIDER,output:ROOT,
  originalProviderOperationId:arg['operation-id'],python:PYTHON,playwrightModule:PW,browserExecutable:CHROME,
  runner:await fileRecord(SELF),support:await fileRecord(SUPPORT),applicationSource:sourcePin
};
const identityPath=path.join(ROOT,'identity.json'),oldIdentity=await optionalJson(identityPath);
let identity;
if(oldIdentity){expect(isDeepStrictEqual(oldIdentity.input,inputValue),'Receiving input or original source changed');identity=oldIdentity;}
else{identity={schema:SCHEMA,operationId:OPERATION,created:startedAt,input:inputValue,inputSha256:hash(encoded(inputValue))};await publish(identityPath,identity);}
expect(identity.inputSha256===hash(encoded(identity.input)),'Receiving input hash differs');
const ownerPrefix=identity.inputSha256+':',ownerMarker=ownerPrefix+runId;
const resultPath=path.join(ROOT,'browser-receiving-result.json');
let browser=null,context=null,page=null,currentServer=null,lockChild=null;
let serverNumber=0,cliNumber=0,routePermit=null,mainError=null;
const children=new Set(),routes=new Set(),drains=[],cleanupErrors=[],pageErrors=[],consoleErrors=[],phases=[];
let originalPublic=null,originalProvider=null,finalPublic=null,artifacts={};
const environment={...process.env,PYTHONDONTWRITEBYTECODE:'1',TMPDIR:path.join(ROOT,'tmp'),AVIARY_BROWSER_RECEIVING_OWNER:ownerMarker};
async function mark(name,detail={}){
  const event={name,at:new Date().toISOString(),...detail};phases.push(event);
  await publish(path.join(RUN,'event-'+String(phases.length).padStart(3,'0')+'.json'),event);
  console.log(JSON.stringify({phase:name,...detail}));
}
function stepDirectory(name){return path.join(ROOT,'steps',safeLabel(name));}
async function stepRecord(name){return optionalJson(path.join(stepDirectory(name),'complete.json'));}
async function completeStep(name,value){
  const filename=path.join(stepDirectory(name),'complete.json'),saved=await optionalJson(filename);
  if(saved)return saved;
  const record={schema:SCHEMA,step:name,inputSha256:identity.inputSha256,completedAt:new Date().toISOString(),...value};
  await publish(filename,record);await mark(name,{reused:false});return record;
}
async function readStep(name){
  const value=await stepRecord(name);if(value)expect(value.schema===SCHEMA&&value.inputSha256===identity.inputSha256&&value.step===name,'Saved phase binding differs: '+name);return value;
}

async function processRecord(pid){
  try{
    const raw=await readFile('/proc/'+pid+'/stat','utf8'),close=raw.lastIndexOf(')');
    const fields=raw.slice(close+2).trim().split(/\s+/);
    const command=await readFile('/proc/'+pid+'/cmdline');
    return {pid:Number(pid),state:fields[0],parentPid:Number(fields[1]),processGroup:Number(fields[2]),startTicks:fields[19],
      commandSha256:hash(command),command:command.toString('utf8').split('\0').filter(Boolean),
      executable:await readlink('/proc/'+pid+'/exe').catch(()=>null)};
  }catch(error){if(['ENOENT','ESRCH'].includes(error.code))return null;throw error;}
}
async function ownedProcesses(prefix){
  const found=[];
  for(const entry of await readdir('/proc')){
    if(!/^[0-9]+$/.test(entry)||Number(entry)===process.pid)continue;
    let bytes;
    try{bytes=await readFile('/proc/'+entry+'/environ');}catch(error){if(['ENOENT','ESRCH','EACCES','EPERM'].includes(error.code))continue;throw error;}
    const match=bytes.toString('utf8').split('\0').find(value=>value.startsWith('AVIARY_BROWSER_RECEIVING_OWNER='+prefix));
    if(!match)continue;
    const record=await processRecord(entry);if(record&&record.state!=='Z')found.push({...record,owner:match.slice('AVIARY_BROWSER_RECEIVING_OWNER='.length)});
  }
  return found;
}
async function signalExact(record,signal){
  const current=await processRecord(record.pid);
  if(!current||current.state==='Z')return false;
  expect(current.startTicks===record.startTicks&&current.commandSha256===record.commandSha256,'Owned process identity changed before cleanup');
  try{process.kill(current.processGroup===current.pid?-current.pid:current.pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}
  return true;
}
async function drainOrphans(records,label){
  if(!records.length)return {label,processes:[],drained:true};
  const before=records.map(value=>({...value}));let live=records;
  for(const [signal,milliseconds] of [['SIGINT',4000],['SIGTERM',4000],['SIGKILL',4000]]){
    for(const record of live)await signalExact(record,signal);
    const until=Date.now()+milliseconds;
    while(Date.now()<until){
      live=[];
      for(const record of before){
        const current=await processRecord(record.pid);
        if(current&&current.state!=='Z'&&current.startTicks===record.startTicks&&current.commandSha256===record.commandSha256)live.push(record);
      }
      if(!live.length)break;await sleep(80);
    }
    if(!live.length)break;
  }
  expect(!live.length,'An owned receiving process did not drain: '+JSON.stringify(live.map(value=>value.pid)));
  const receipt={label,processes:before,drained:true,at:new Date().toISOString()};
  await publish(path.join(RUN,safeLabel(label)+'.json'),receipt);return receipt;
}
async function spawnChild(command,argv,label,{stdin=false,cwd=APP,timeoutMs=90000}={}){
  safeLabel(label);const prefix=path.join(RUN,label);
  const launch={schema:SCHEMA,kind:label,command,arguments:argv,cwd,owner:ownerMarker,createdAt:new Date().toISOString(),
    stdout:prefix+'.stdout.log',stderr:prefix+'.stderr.log',timeoutMs};
  await publish(prefix+'.launch.json',launch);
  const stdout=await open(launch.stdout,'wx',0o600);let stderr=null,child=null;
  try{
    stderr=await open(launch.stderr,'wx',0o600);
    child=spawn(command,argv,{cwd,env:environment,detached:true,stdio:[stdin?'pipe':'ignore',stdout.fd,stderr.fd]});
    const entry={child,label,launch,closed:false,spawnError:null,record:null};
    entry.closePromise=new Promise(resolve=>{
      child.once('error',error=>{entry.spawnError=briefError(error);});
      child.once('close',(code,signal)=>{entry.closed=true;entry.exit={code,signal,spawnError:entry.spawnError};resolve(entry.exit);});
    });
    children.add(entry);
    if(child.stdin)child.stdin.on('error',()=>{});
    entry.record=child.pid?await processRecord(child.pid):null;
    await publish(prefix+'.process.json',{pid:child.pid||null,record:entry.record,owner:ownerMarker,launch:launch});
    return entry;
  }catch(error){
    if(child?.pid){try{process.kill(-child.pid,'SIGKILL');}catch{}}
    throw error;
  }finally{await stdout.close();if(stderr)await stderr.close();}
}
async function finishChild(entry,{stop=false,normal=false}={}){
  if(!entry)return null;
  if(stop&&!entry.closed){
    try{process.kill(-entry.child.pid,'SIGINT');}catch(error){if(error.code!=='ESRCH')throw error;}
  }
  let ended;
  try{ended=await deadline(entry.closePromise,stop?15000:entry.launch.timeoutMs,'Child '+entry.label);}
  catch(error){
    for(const signal of ['SIGTERM','SIGKILL']){
      if(entry.closed)break;try{process.kill(-entry.child.pid,signal);}catch(e){if(e.code!=='ESRCH')throw e;}
      await deadline(entry.closePromise,5000,'Child '+entry.label+' '+signal).catch(()=>{});
    }
    if(!entry.closed)throw error;
    ended=entry.exit;
    if(!stop)throw new Error('Child exceeded its receiving deadline: '+entry.label);
  }
  children.delete(entry);
  const stdout=await fileRecord(entry.launch.stdout),stderr=await fileRecord(entry.launch.stderr);
  const record={label:entry.label,pid:entry.child.pid||null,exit:ended,stdout,stderr,stdioClosed:true,at:new Date().toISOString()};
  await publish(path.join(RUN,entry.label+'.drain.json'),record);drains.push(record);
  if(normal)expect(ended.code===0&&!ended.spawnError,'Original child failed: '+entry.label+' '+JSON.stringify(ended));
  return record;
}
async function waitFirstJson(entry,label){
  const until=Date.now()+30000;
  while(Date.now()<until){
    const file=await readFile(entry.launch.stdout);
    expect(file.length<1024*1024,'Startup output is unexpectedly large: '+label);
    const text=file.toString('utf8'),end=text.indexOf('\n');
    if(end>=0)return JSON.parse(text.slice(0,end));
    if(entry.closed)throw new Error(label+' exited before readiness: '+(await readFile(entry.launch.stderr,'utf8')));
    await sleep(50);
  }
  throw new Error(label+' startup timed out');
}
async function runCli(argv,label,{timeoutMs=90000,cwd=APP}={}){
  const entry=await spawnChild(PYTHON,['-B',...argv],label,{timeoutMs,cwd});
  const drain=await finishChild(entry,{normal:false});
  const stdout=await readFile(entry.launch.stdout),stderr=await readFile(entry.launch.stderr);
  expect(stdout.length<=16*1024*1024&&stderr.length<=2*1024*1024,'Original CLI output exceeded receiving bounds');
  expect(drain.exit.code===0&&!drain.exit.spawnError,'Original CLI failed '+label+': '+stderr.toString('utf8'));
  return {value:JSON.parse(stdout.toString('utf8')),drain};
}
async function support(action,payload={},label='support'){
  const request={schema:'commons.aviary.browser-support.v2',action,application:APP,workspace:WORKSPACE,...payload};
  const requestPath=path.join(RUN,safeLabel(label)+'-'+String(++cliNumber).padStart(3,'0')+'.request.json');
  await publish(requestPath,request);
  return (await runCli([SUPPORT,'--request',requestPath],safeLabel(label)+'-'+String(cliNumber).padStart(3,'0'),{timeoutMs:120000})).value;
}
async function acquireLock(){
  lockChild=await spawnChild(PYTHON,['-B',SUPPORT,'--hold-lock',path.join(ROOT,'receiving.lock')],'lifetime-lock',{stdin:true,timeoutMs:120000});
  const ready=await waitFirstJson(lockChild,'Receiving lock');
  expect(ready.state==='LOCKED','Original receiving output is already owned');
}
async function releaseLock(){
  if(!lockChild)return;
  const child=lockChild;lockChild=null;child.child.stdin.end();await finishChild(child,{normal:true});
}
async function get(route){
  expect(currentServer,'Original server is not running');
  const response=await fetch(currentServer.origin+route,{signal:AbortSignal.timeout(30000)});
  const text=await response.text();expect(text.length<=16*1024*1024,'Original HTTP response exceeds receiving bounds');
  let value;try{value=JSON.parse(text);}catch{throw new Error('Original HTTP returned invalid JSON: '+route);}
  expect(response.ok,'Original HTTP '+route+' failed '+response.status+' '+JSON.stringify(value));return value;
}
async function closePage(){
  if(!page)return;const old=page;page=null;await deadline(old.close(),15000,'Browser page close');
}
async function openServer(app,root){
  expect(!currentServer,'An original server is already owned');
  const entry=await spawnChild(PYTHON,['-B',path.join(app,'aviary.py'),'serve','--workspace',root,'--port','0'],'server-'+String(++serverNumber).padStart(2,'0'),{cwd:app,timeoutMs:120000});
  let ready;
  try{
    ready=await waitFirstJson(entry,'Original Aviary server');
    const parsed=new URL(ready.url);
    expect(parsed.protocol==='http:'&&['127.0.0.1','localhost'].includes(parsed.hostname)&&parsed.pathname==='/'&&parsed.port,'Original server returned an unexpected origin');
    expect(Number(ready.pid)===entry.child.pid,'Original server PID differs from owned child');
    currentServer={entry,origin:parsed.origin,application:app,workspace:root,ready};
    await mark('server-opened',{pid:ready.pid,workspace:root,application:app,origin:parsed.origin});
  }catch(error){await finishChild(entry,{stop:true}).catch(e=>cleanupErrors.push(briefError(e)));throw error;}
}
async function closeServer(){
  if(!currentServer)return;
  await closePage();const old=currentServer;currentServer=null;
  const record=await finishChild(old.entry,{stop:true,normal:true});
  await mark('server-drained',{pid:old.entry.child.pid,exit:record.exit,stdioClosed:true});
}
async function openPage(){
  await closePage();expect(context&&currentServer,'Browser context or server is unavailable');
  page=await context.newPage();page.setDefaultTimeout(25000);
  page.on('pageerror',error=>pageErrors.push({message:error.message,server:currentServer?.workspace||null}));
  page.on('console',entry=>{if(entry.type()==='error'&&!entry.text().includes('favicon.ico'))consoleErrors.push({message:entry.text(),server:currentServer?.workspace||null});});
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==currentServer?.origin){
      pageErrors.push({message:'Unrequested browser origin: '+url.origin});await route.abort('blockedbyclient');return;
    }
    if(!['GET','HEAD'].includes(request.method())&&!(request.method()==='POST'&&url.pathname==='/api/preview')){
      pageErrors.push({message:'Unrequested browser mutation: '+request.method()+' '+url.pathname});await route.abort('blockedbyclient');return;
    }
    await route.continue();
  });
  await page.goto(currentServer.origin,{waitUntil:'domcontentloaded'});
  await page.locator('#metrics .metric').first().waitFor();
  await page.waitForFunction(()=>document.getElementById('mappingDirty').textContent.startsWith('All choices saved'));
}
async function freshPublic(){
  const status=(await get('/api/state')).status;
  expect(status.workspace.id===originalPublic.workspace.id&&isDeepStrictEqual(status.source,originalPublic.source),'Original public workspace/source changed');
  return status;
}
async function ensureCurrent(revision,document){
  const state=await freshPublic();
  expect(state.mapping.revision===revision&&isDeepStrictEqual(state.mapping.document,document),'Current mapping is outside the retained receiving prefix; preserve the newer review and reconcile it before continuing');
  return state;
}
async function savedUI(){
  await page.waitForFunction(()=>document.getElementById('mappingDirty').textContent.startsWith('All choices saved'));
  return freshPublic();
}

function deferred(){
  let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});promise.catch(()=>{});return {promise,resolve,reject};
}
async function uiExchange(routePath,trigger,onRequest,{hold=null,label='ui-request'}={}){
  expect(lockChild&&!lockChild.closed,'Original receiving lock is no longer held');
  expect(page&&currentServer,'Original page is unavailable');
  const reached=deferred(),done=deferred(),gate=deferred();
  let seen=false,released=false,responseObject=null,routeError=null,typing=null;
  const release=()=>{if(!released){released=true;gate.resolve();}};
  const pattern='**'+routePath;
  const handler=async route=>{
    if(route.request().method()!=='POST'){await route.continue();return;}
    if(seen){const error=new Error('More than one original mutation was dispatched for '+label);routeError=error;reached.reject(error);done.reject(error);await route.abort('failed').catch(()=>{});return;}
    seen=true;
    try{
      const request=route.request(),body=JSON.parse(request.postData()||'null');
      expect(new URL(request.url()).origin===currentServer.origin,'Mutation origin changed');
      await onRequest(body);
      expect(lockChild&&!lockChild.closed,'Original receiving lock closed before dispatch');
      responseObject=await route.fetch({timeout:30000});
      const raw=await responseObject.body();expect(raw.length<=16*1024*1024,'Original mutation response exceeds receiving bounds');
      const value=JSON.parse(raw.toString('utf8'));
      const response={status:responseObject.status(),value,bytes:raw.length,sha256:hash(raw)};
      await publishBytes(path.join(RUN,label+'.response-body.json'),raw);
      await publish(path.join(RUN,label+'.response.json'),{schema:SCHEMA,route:routePath,request:body,response,observedAt:new Date().toISOString()});
      reached.resolve(response);
      if(hold)await deadline(gate.promise,45000,'Held original mapping response');
      await route.fulfill({response:responseObject});
      done.resolve(response);
    }catch(error){
      routeError=error;reached.reject(error);done.reject(error);
      await route.abort('failed').catch(()=>{});
    }finally{if(responseObject)await responseObject.dispose().catch(()=>{});}
  };
  const routeRecord={page,pattern,handler,release,done:done.promise};routes.add(routeRecord);
  await page.route(pattern,handler);
  try{
    await deadline(Promise.resolve().then(trigger),30000,'Original UI trigger '+label);
    const response=await deadline(reached.promise,40000,'Original UI response '+label);
    expect(response.status>=200&&response.status<300,'Original UI request failed '+routePath+': '+JSON.stringify(response));
    if(hold){
      await page.locator('#mappingNote').fill(hold.laterNote);
      const beforeRelease=await page.locator('#mappingNote').inputValue();
      release();await deadline(done.promise,15000,'Original response release '+label);
      await page.waitForFunction(()=>!document.getElementById('saveMapping').disabled&&document.getElementById('mappingDirty').textContent.startsWith('Unsaved'));
      typing={
        observedAt:new Date().toISOString(),laterNote:hold.laterNote,inputBeforeRelease:beforeRelease,
        inputAfterRelease:await page.locator('#mappingNote').inputValue(),
        dirtyText:await page.locator('#mappingDirty').innerText(),saveEnabled:await page.locator('#saveMapping').isEnabled(),
        response:{status:response.status,bytes:response.bytes,sha256:response.sha256}
      };
      expect(typing.inputBeforeRelease===hold.laterNote&&typing.inputAfterRelease===hold.laterNote&&typing.saveEnabled&&typing.dirtyText.startsWith('Unsaved'),'Later operator typing was lost after the original save response');
    }else await deadline(done.promise,15000,'Original UI request completion '+label);
    if(routeError)throw routeError;
    return {response,typing};
  }finally{
    release();
    if(seen)await deadline(done.promise.catch(()=>{}),10000,'Route handler release '+label).catch(error=>cleanupErrors.push(briefError(error)));
    await page.unroute(pattern,handler);routes.delete(routeRecord);
  }
}
async function mappingStep(name,{before,route='/api/mapping',context:stepContext={},expectedDocument=null,prepare,trigger,hold=null}){
  const directory=stepDirectory(name);await mkdir(directory,{recursive:true,mode:0o700});
  const intentPath=path.join(directory,'intent.json');
  const intended={schema:SCHEMA,step:name,inputSha256:identity.inputSha256,route,before:{revision:before.revision,document:before.document},
    expectedDocument,context:stepContext};
  await publish(intentPath,intended);
  const requestPath=path.join(directory,'request.json');
  let captured=await optionalJson(requestPath),complete=await readStep(name);
  const reconcile=async()=>{
    if(!captured)return null;
    expect(captured.schema===SCHEMA&&captured.inputSha256===identity.inputSha256&&captured.route===route,'Retained mapping request binding differs');
    const document=route==='/api/assign-keys'?expectedDocument:captured.body.document;
    const evidence=await support('mapping-evidence',{before:intended.before,expectedDocument:document,request:captured.body},name+'-history');
    if(!evidence.committed)return evidence;
    const filename=path.join(directory,'commit-reconciliation.json'),old=await optionalJson(filename);
    const stable={schema:SCHEMA,inputSha256:identity.inputSha256,step:name,requestSha256:hash(encoded(captured)),mapping:evidence.mapping,mappingSha256:evidence.mappingSha256,beforeSha256:evidence.beforeSha256};
    if(old){
      for(const key of Object.keys(stable))expect(isDeepStrictEqual(old[key],stable[key]),'Saved review reconciliation differs: '+name+' '+key);
    }else await publish(filename,{...stable,observedAt:new Date().toISOString(),currentRevisionAtObservation:evidence.currentMapping.revision});
    return evidence;
  };
  let evidence=await reconcile();
  if(complete){
    expect(evidence?.committed&&isDeepStrictEqual(complete.mapping,evidence.mapping),'Completed mapping phase lost its original committed review: '+name);
    if(complete.typingFence)await verifyFile(complete.typingFence);
    return complete;
  }
  if(!evidence?.committed){
    await ensureCurrent(before.revision,before.document);
    await prepare();
    const exchange=await uiExchange(route,trigger,async body=>{
      expect(body&&typeof body==='object'&&!Array.isArray(body)&&body.expectedRevision===before.revision,'Original mapping request revision differs');
      if(route==='/api/mapping'){
        expect(body.document&&typeof body.document==='object'&&!Array.isArray(body.document),'Original mapping request document is absent');
        if(expectedDocument)expect(isDeepStrictEqual(body.document,expectedDocument),'Original UI proposed a different saved mapping');
      }else expect(route==='/api/assign-keys'&&!Object.hasOwn(body,'document'),'Unexpected assignment request');
      const record={schema:SCHEMA,inputSha256:identity.inputSha256,route,body};
      if(captured)expect(isDeepStrictEqual(record,captured),'A resumed mapping request changed its original body');
      await publish(requestPath,record);captured=record;
      await publish(path.join(RUN,name+'.dispatch.json'),{schema:SCHEMA,step:name,requestSha256:hash(encoded(record)),dispatchedAt:new Date().toISOString()});
    },{hold,label:name});
    if(!hold)await savedUI();
    if(exchange.typing){
      const filename=path.join(directory,'typing-fence.json');
      const existing=await optionalJson(filename);
      if(existing){
        expect(existing.requestSha256===hash(encoded(captured))&&existing.typing.laterNote===hold.laterNote,'Original typing observation binding differs');
      }else await publish(filename,{schema:SCHEMA,inputSha256:identity.inputSha256,requestSha256:hash(encoded(captured)),typing:exchange.typing});
    }
    evidence=await reconcile();expect(evidence?.committed,'Original UI save was not found in its committed history: '+name);
  }
  const fencePath=path.join(directory,'typing-fence.json'),fence=await optionalJson(fencePath);
  if(fence){
    expect(fence.inputSha256===identity.inputSha256&&fence.requestSha256===hash(encoded(captured))&&fence.typing.inputAfterRelease===fence.typing.laterNote&&fence.typing.saveEnabled,'Typing observation no longer binds the committed save');
    if(hold)expect(fence.typing.laterNote===hold.laterNote,'Retained typing observation has a different intended note');
  }
  complete=await completeStep(name,{mapping:evidence.mapping,mappingSha256:evidence.mappingSha256,request:await fileRecord(requestPath),typingFence:fence?await fileRecord(fencePath):null});
  return complete;
}
async function noteStep(name,before,note,{laterNote=null,context:extra={}}={}){
  const expectedDocument={...jsonClone(before.document),note};
  return mappingStep(name,{
    before,expectedDocument,context:{note,laterNote,...extra},
    prepare:async()=>{await page.locator('[data-tab=mapping]').click();await page.locator('#mappingNote').fill(note);},
    trigger:()=>page.locator('#saveMapping').click(),hold:laterNote?{laterNote}:null
  });
}
async function finishLateTyping(first,later){
  let selected=first.typingFence?{sourceStep:'02-first-note',fence:first.typingFence,finalMapping:later.mapping}:null;
  const retained=await readStep('05-late-typing-proved');
  if(retained){await verifyFile(retained.fence);return retained;}
  let current=later.mapping;
  for(let index=1;!selected&&index<=32;index++){
    const prefix='typing-'+String(index).padStart(2,'0');
    const pairPath=path.join(stepDirectory(prefix),'pair.json');
    let pair=await optionalJson(pairPath);
    if(!pair){
      await ensureCurrent(current.revision,current.document);
      pair={schema:SCHEMA,inputSha256:identity.inputSha256,index,before:{revision:current.revision,document:current.document},
        temporaryNote:FINAL_NOTE+'\nReceiving observation '+index+': original delayed save response.',restoreNote:FINAL_NOTE,createdAt:new Date().toISOString()};
      await publish(pairPath,pair);
    }
    expect(pair.index===index&&pair.inputSha256===identity.inputSha256&&pair.restoreNote===FINAL_NOTE,'Numbered typing observation changed');
    const saved=await noteStep(prefix+'-save',pair.before,pair.temporaryNote,{laterNote:FINAL_NOTE,context:{observation:index}});
    const restored=await noteStep(prefix+'-restore',saved.mapping,FINAL_NOTE,{context:{observation:index}});
    current=restored.mapping;
    if(saved.typingFence){
      selected={sourceStep:prefix+'-save',fence:saved.typingFence,finalMapping:current};
      await completeStep(prefix,{observation:index,save:saved.mapping,restore:restored.mapping,fence:saved.typingFence});
    }else await completeStep(prefix,{observation:index,save:saved.mapping,restore:restored.mapping,typingProof:'NOT_RETAINED',restoredOriginalFinalNote:true});
  }
  expect(selected,'Thirty-two original typing observation pairs lack a completed proof; retain the saved revisions and inspect the original browser failure');
  await verifyFile(selected.fence);
  return completeStep('05-late-typing-proved',selected);
}
async function previewAt(revision){
  return support('preview',{revision},'historical-preview');
}
async function assertCounts(preview,expected=EXPECTED_COUNTS){
  expect(preview.ready,'Original source preview is not ready: '+JSON.stringify(preview.issues));
  for(const [kind,count] of Object.entries(expected))expect(preview.counts[kind]===count,'Original '+kind+' count differs: '+preview.counts[kind]);
}
async function rowStep(name,before,rowKey,include){
  const dialogSeen=deferred();
  const dialog=async value=>{try{await value.accept(REASON);dialogSeen.resolve();}catch(error){dialogSeen.reject(error);}};
  try{
    const saved=await mappingStep(name,{
      before,context:{rowKey,include,reason:include?null:REASON},
      prepare:async()=>{
        await page.locator('[data-tab=preview]').click();
        if(await page.locator('#previewKind').inputValue()!=='resources')await page.locator('#previewKind').selectOption('resources');
        else await page.locator('#refreshPreview').click();
        const checkbox=page.getByRole('checkbox',{name:'Include source row '+rowKey,exact:true});await checkbox.waitFor();
        if(include)await checkbox.check();
        else{page.once('dialog',dialog);await checkbox.uncheck();await deadline(dialogSeen.promise,10000,'Original reasoned exclusion dialog');}
      },
      trigger:()=>page.locator('#saveReview').click()
    });
    const observed=await previewAt(saved.mapping.revision);
    expect(observed.counts.resources===(include?2:1),'Saved source inclusion/exclusion does not match its original request');
    return saved;
  }finally{if(page)page.off('dialog',dialog);}
}
async function inspectTables(mapping){
  const prior=await readStep('08-five-tables-reviewed');
  const historical=await previewAt(mapping.revision);await assertCounts(historical);
  if(prior){
    expect(prior.revision===mapping.revision&&prior.mappingSha256===historical.mappingSha256,'Saved table review selection changed');return prior;
  }
  await ensureCurrent(mapping.revision,mapping.document);
  await page.locator('[data-tab=preview]').click();const inspected={};
  for(const [kind,count] of Object.entries(EXPECTED_COUNTS)){
    const observed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/preview'&&response.request().method()==='POST',{timeout:30000});
    observed.catch(()=>{});
    if(await page.locator('#previewKind').inputValue()===kind)await page.locator('#refreshPreview').click();
    else await page.locator('#previewKind').selectOption(kind);
    const response=await observed,document=await response.json();
    expect(response.ok(),'Original source table preview failed '+kind);
    expect(document.counts[kind]===count&&document.tables[kind].length===count,'Original displayed source table differs '+kind);
    expect(document.ready,'Original source preview is not ready '+kind);
    inspected[kind]={count,displayed:document.tables[kind].length};
    await publish(path.join(stepDirectory('08-five-tables-reviewed'),kind+'.preview.json'),document);
  }
  return completeStep('08-five-tables-reviewed',{revision:mapping.revision,mappingSha256:historical.mappingSha256,counts:inspected,sourceManifestSha256:historical.sourceManifestSha256});
}

function jobIdentity(job){
  expect(job&&typeof job.id==='string'&&typeof job.kind==='string'&&typeof job.created==='string'&&job.arguments&&typeof job.arguments==='object','Original queued job identity is incomplete');
  return {id:job.id,kind:job.kind,arguments:job.arguments,created:job.created};
}
function jobMatches(job,intent){
  if(job.kind!==intent.kind||intent.beforeJobIds.includes(job.id))return false;
  if(!job.arguments||typeof job.arguments.output!=='string')return false;
  if(intent.kind==='native-package'&&job.arguments.revision!=null&&Number(job.arguments.revision)!==intent.selection.revision)return false;
  const expectedDirectory=path.join(path.dirname(WORKSPACE),path.basename(WORKSPACE)+'-deliveries');
  if(path.resolve(path.dirname(job.arguments.output))!==expectedDirectory)return false;
  const prefix=intent.kind==='native-package'?'Aviary_Native_Package_':'Aviary_Complete_Workspace_';
  return path.basename(job.arguments.output).startsWith(prefix)&&job.arguments.output.endsWith('.zip');
}
async function retainedQueueResponse(name,intent,capturedRequest){
  if(!capturedRequest)return null;
  const matches=[];
  for(const run of await readdir(path.join(ROOT,'runs'))){
    const filename=path.join(ROOT,'runs',run,name+'.response.json');
    const response=await optionalJson(filename);
    if(!response)continue;
    expect(response.schema===SCHEMA&&response.route===intent.route&&isDeepStrictEqual(response.request,capturedRequest.body),'Original queued HTTP capture changed');
    const job=response.response?.value?.job;
    if(job&&jobMatches(job,intent))matches.push(jobIdentity(job));
  }
  const unique=new Map(matches.map(value=>[value.id,value]));
  expect(unique.size<=1,'More than one original accepted job is bound to this request');
  return [...unique.values()][0]||null;
}
async function queueOutput(name,{kind,route,selection,trigger}){
  const directory=stepDirectory(name);await mkdir(directory,{recursive:true,mode:0o700});
  const intentPath=path.join(directory,'intent.json');
  let intent=await optionalJson(intentPath);
  if(!intent){
    await ensureCurrent(selection.revision,selection.document);
    const jobs=await get('/api/jobs');
    intent={schema:SCHEMA,inputSha256:identity.inputSha256,step:name,kind,route,
      selection:{workspaceId:selection.workspaceId,revision:selection.revision,mappingSha256:selection.mappingSha256,sourceManifestSha256:selection.sourceManifestSha256},
      beforeJobIds:jobs.jobs.map(job=>job.id).sort(),createdAt:new Date().toISOString()};
    await publish(intentPath,intent);
  }
  expect(intent.inputSha256===identity.inputSha256&&intent.step===name&&intent.kind===kind&&intent.route===route&&intent.selection.revision===selection.revision&&intent.selection.mappingSha256===selection.mappingSha256&&intent.selection.sourceManifestSha256===selection.sourceManifestSha256,'Original queued selection changed');
  const bindingPath=path.join(directory,'original-job.json'),requestPath=path.join(directory,'request.json');
  let binding=await optionalJson(bindingPath),capturedRequest=await optionalJson(requestPath);
  let jobs=await get('/api/jobs'),job=null;
  if(!binding){
    const fromResponse=await retainedQueueResponse(name,intent,capturedRequest);
    if(fromResponse){
      job=jobs.jobs.find(value=>value.id===fromResponse.id);
      expect(job&&isDeepStrictEqual(jobIdentity(job),fromResponse),'Original accepted job disappeared from its persisted journal');
      binding=fromResponse;
    }else if(capturedRequest){
      const candidates=jobs.jobs.filter(value=>jobMatches(value,intent));
      expect(candidates.length<=1,'Queued response is uncertain and more than one persisted job could match; preserve all original jobs');
      if(candidates.length===1){job=candidates[0];binding=jobIdentity(job);}
    }
    if(binding)await publish(bindingPath,binding);
  }
  if(!binding){
    await ensureCurrent(selection.revision,selection.document);
    await page.locator('[data-tab=delivery]').click();
    const exchange=await uiExchange(route,trigger,async body=>{
      expect(body&&typeof body==='object'&&!Array.isArray(body),'Original queued request body is absent');
      if(kind==='native-package'&&body.revision!=null)expect(Number(body.revision)===selection.revision,'Original package request revision differs');
      const record={schema:SCHEMA,inputSha256:identity.inputSha256,route,body};
      if(capturedRequest)expect(isDeepStrictEqual(capturedRequest,record),'Resumed queued request body differs');
      await publish(requestPath,record);capturedRequest=record;
      await publish(path.join(RUN,name+'.dispatch.json'),{schema:SCHEMA,requestSha256:hash(encoded(record)),beforeJobIds:intent.beforeJobIds,at:new Date().toISOString()});
    },{label:name});
    job=exchange.response.value.job;
    expect(exchange.response.status===202&&jobMatches(job,intent),'Original queued response does not bind the selected job');
    binding=jobIdentity(job);await publish(bindingPath,binding);
  }
  let completed=await readStep(name);
  const until=Date.now()+90000;
  while(true){
    jobs=await get('/api/jobs');job=jobs.jobs.find(value=>value.id===binding.id);
    expect(job&&isDeepStrictEqual(jobIdentity(job),binding),'Original persisted job changed or disappeared');
    if(['COMPLETED','FAILED','INTERRUPTED'].includes(job.state))break;
    expect(['QUEUED','RUNNING'].includes(job.state),'Original queued state is unsupported');
    if(Date.now()>=until)throw new Error('Original job '+job.id+' is still '+job.state+'; retain its output and reconcile after the owned server drains');
    await sleep(100);
  }
  const payload={job:binding,selection:intent.selection,applicationSource:sourcePin.files};
  let observed=await support('verify-job',payload,name+'-verify');
  if(observed.state==='MISSING'&&job.state==='INTERRUPTED'){
    await closeServer();
    observed=await support('resume-job',payload,name+'-resume-original');
    await openServer(APP,WORKSPACE);await openPage();
  }
  expect(observed.state==='VERIFIED','Original queued output is incomplete; no replacement job was created: '+JSON.stringify({job:binding.id,state:job.state,output:binding.arguments.output}));
  expect(observed.archive.output===binding.arguments.output,'Verified original output path differs');
  if(completed){
    expect(completed.job.id===binding.id&&completed.archive.sha256===observed.archive.sha256&&completed.archive.bytes===observed.archive.bytes,'Completed original queue output changed');
    await verifyFile(completed.archive.file);return completed;
  }
  completed=await completeStep(name,{job:binding,observedOriginalJobState:observed.job.state,
    archive:observed.archive,verification:observed,originalJobRecordPreserved:true});
  return completed;
}
async function publishCaptured(capture){
  const filename=capture.file.path;
  if(await exists(filename)){await verifyFile(capture.file);return capture.file;}
  expect(capture.pendingPath&&await exists(capture.pendingPath),'Retained capture bytes are unavailable; preserve its original descriptor');
  await verifyFile({...capture.file,path:capture.pendingPath});
  try{await link(capture.pendingPath,filename);}catch(error){if(error.code!=='EEXIST')throw error;await verifyFile(capture.file);}
  await syncDirectory(path.dirname(filename));await verifyFile(capture.file);
  await unlink(capture.pendingPath).catch(error=>{if(error.code!=='ENOENT')throw error;});
  return capture.file;
}
async function downloadArchive(name,queued,filename){
  const directory=stepDirectory(name);await mkdir(directory,{recursive:true,mode:0o700});
  const original=queued.archive.file;
  await verifyFile(original);
  const target=path.join(ROOT,filename);
  const intent={schema:SCHEMA,inputSha256:identity.inputSha256,jobId:queued.job.id,source:original,target};
  await publish(path.join(directory,'intent.json'),intent);
  const expected={path:target,bytes:original.bytes,sha256:original.sha256};
  let capture=await optionalJson(path.join(directory,'capture.json'));
  if(capture)expect(capture.file.bytes===expected.bytes&&capture.file.sha256===expected.sha256&&capture.file.path===target&&capture.jobId===queued.job.id,'Original browser download identity changed');
  if(await exists(target)){
    await verifyFile(expected);
    if(!capture){capture={schema:SCHEMA,inputSha256:identity.inputSha256,jobId:queued.job.id,file:expected,pendingPath:null,reconciledFromOriginalQueuedArchive:true,capturedAt:new Date().toISOString()};await publish(path.join(directory,'capture.json'),capture);}
    return completeStep(name,{file:expected,capture:await fileRecord(path.join(directory,'capture.json')),jobId:queued.job.id});
  }
  if(capture&&capture.pendingPath&&await exists(capture.pendingPath)){
    await publishCaptured(capture);
    return completeStep(name,{file:expected,capture:await fileRecord(path.join(directory,'capture.json')),jobId:queued.job.id});
  }
  await page.locator('[data-tab=delivery]').click();
  const linkElement=page.locator('#artifactList a').filter({hasText:path.basename(queued.archive.output)});
  await linkElement.waitFor();
  const event=page.waitForEvent('download',{timeout:30000});event.catch(()=>{});
  await linkElement.click();const download=await event;
  const pending=path.join(directory,'download-'+runId+'.pending.zip');
  try{
    await deadline(download.saveAs(pending),60000,'Original browser archive download');
    const actual=await fileRecord(pending);
    expect(actual.bytes===expected.bytes&&actual.sha256===expected.sha256,'Actual browser download differs from original queued output');
    const observation={schema:SCHEMA,inputSha256:identity.inputSha256,jobId:queued.job.id,file:expected,pendingPath:pending,suggestedFilename:download.suggestedFilename(),capturedAt:new Date().toISOString()};
    if(!capture){capture=observation;await publish(path.join(directory,'capture.json'),capture);}
    else await publish(path.join(directory,'recovery-'+runId+'.json'),observation);
    await publishCaptured(observation);
  }finally{await download.delete().catch(()=>{});}
  return completeStep(name,{file:expected,capture:await fileRecord(path.join(directory,'capture.json')),jobId:queued.job.id});
}
async function screenshot(name,width,height){
  safeLabel(name);const directory=path.join(ROOT,'captures',name);
  await mkdir(directory,{recursive:true,mode:0o700});
  const filename=path.join(ROOT,name),recordPath=path.join(directory,'capture.json');
  let capture=await optionalJson(recordPath);
  if(capture){
    expect(capture.inputSha256===identity.inputSha256&&capture.width===width&&capture.height===height&&capture.file.path===filename,'Original screenshot selection differs');
    await publishCaptured(capture);return {...capture.file,width,height,dimensions:capture.dimensions,capture:await fileRecord(recordPath)};
  }
  expect(!await exists(filename),'An unbound legacy screenshot already occupies the output; preserve it before starting this v2 journey');
  await page.setViewportSize({width,height});
  const pending=path.join(directory,'pixels-'+runId+'.pending.png');
  await page.screenshot({path:pending,type:'png',fullPage:true});
  const dimensions=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight}));
  expect(dimensions.document<=dimensions.viewport+1,'Original application overflows its viewport: '+JSON.stringify(dimensions));
  const pixels=await fileRecord(pending),prefix=await open(pending,'r');
  try{const signature=Buffer.alloc(8);await prefix.read(signature,0,8,0);expect(signature.equals(Buffer.from([137,80,78,71,13,10,26,10])),'Original screenshot is not PNG');}finally{await prefix.close();}
  capture={schema:SCHEMA,inputSha256:identity.inputSha256,file:{...pixels,path:filename},pendingPath:pending,width,height,dimensions,
    origin:currentServer.origin,workspace:currentServer.workspace,capturedAt:new Date().toISOString()};
  await publish(recordPath,capture);await publishCaptured(capture);
  return {...capture.file,width,height,dimensions,capture:await fileRecord(recordPath)};
}
async function coldReceive(exported,expectedMapping){
  const name='13-cold-receive',directory=stepDirectory(name);
  const target=path.join(ROOT,'received-public');
  const request={schema:SCHEMA,inputSha256:identity.inputSha256,source:exported,target};
  await publish(path.join(directory,'request.json'),request);await verifyFile(exported);
  let complete=await readStep(name),received;
  if(complete){
    received=complete.received;
    const inspected=await support('inspect',{application:received.application,workspace:received.workspace},'cold-reopen-inspect');
    expect(inspected.status.workspace.id===originalPublic.workspace.id&&isDeepStrictEqual(inspected.status.source,originalPublic.source),'Retained received workspace identity/source changed');
    expect(inspected.status.mapping.revision===expectedMapping.revision&&isDeepStrictEqual(inspected.status.mapping.document,expectedMapping.document),'Retained cold review differs');
  }else{
    const result=await runCli([path.join(APP,'aviary.py'),'receive','--source',exported.path,'--output',target],'cold-receive-'+String(++cliNumber),{timeoutMs:120000});
    received=result.value;
    expect(received.status.workspace.id===originalPublic.workspace.id,'Original cold receiving changed workspace identity');
    complete=await completeStep(name,{received,source:exported,request:await fileRecord(path.join(directory,'request.json')),cli:result.drain});
  }
  const pin=await pinApplication(received.application);expect(pin.sha256===sourcePin.sha256,'Original complete handoff application changed');
  return received;
}
async function screenshotPhase(name,shots){
  const saved=await readStep(name);
  if(saved){
    for(const record of saved.screenshots){await verifyFile(record);await verifyFile(record.capture);}
    return saved;
  }
  const screenshots=[];
  for(const item of shots){
    await item.prepare();
    screenshots.push(await screenshot(item.name,item.width,item.height));
  }
  return completeStep(name,{screenshots,independentImageInspection:'PENDING',pixelFiles:'LOCAL_QA'});
}

async function selectPreview(kind){
  const pending=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/preview'&&response.request().method()==='POST',{timeout:30000});pending.catch(()=>{});
  if(await page.locator('#previewKind').inputValue()===kind)await page.locator('#refreshPreview').click();
  else await page.locator('#previewKind').selectOption(kind);
  const response=await pending,value=await response.json();
  expect(response.ok()&&value.tables?.[kind]&&value.counts[kind]===EXPECTED_COUNTS[kind],'Original visible preview differs: '+kind);
  return value;
}
async function allPhaseRecords(){
  const records=[];
  for(const name of (await readdir(path.join(ROOT,'steps'))).sort()){
    const filename=path.join(ROOT,'steps',name,'complete.json');
    if(await exists(filename))records.push(await fileRecord(filename));
  }
  return records;
}
async function validateOutcome(outcome){
  expect(outcome.schema===SCHEMA&&outcome.inputSha256===identity.inputSha256&&outcome.operationId===OPERATION,'Completed browser identity differs');
  for(const record of [outcome.nativePackage,outcome.publicWorkspaceExport,...outcome.screenshots,...outcome.phaseReceipts])await verifyFile(record);
  expect(outcome.screenshots.length===4&&outcome.originalProviderActions.length>0,'Completed browser evidence is incomplete');
  expect(outcome.originalProviderActions.every(action=>['CONFIRMED','ADOPTED'].includes(action.state)),'Retained original provider state is not terminal');
  const actual=await pinApplication(APP);expect(actual.sha256===sourcePin.sha256,'Completed original application source changed');
}
async function runJourney(){
  const publicInitial=await support('inspect',{},'public-initial');
  const providerInitial=await support('inspect',{workspace:PROVIDER},'provider-initial');
  const baselinePath=path.join(ROOT,'public-baseline.json'),providerPath=path.join(ROOT,'provider-baseline.json');
  const baseline=await optionalJson(baselinePath),providerBaseline=await optionalJson(providerPath);
  if(!baseline)await publish(baselinePath,{schema:SCHEMA,inputSha256:identity.inputSha256,inspection:publicInitial,observedAt:new Date().toISOString()});
  if(!providerBaseline)await publish(providerPath,{schema:SCHEMA,inputSha256:identity.inputSha256,inspection:providerInitial,observedAt:new Date().toISOString()});
  const original=baseline||await readJson(baselinePath),originalSavedProvider=providerBaseline||await readJson(providerPath);
  expect(original.inputSha256===identity.inputSha256&&originalSavedProvider.inputSha256===identity.inputSha256,'Original baseline identity differs');
  originalPublic=original.inspection.status;originalProvider=originalSavedProvider.inspection.status;
  expect(publicInitial.status.workspace.id===originalPublic.workspace.id&&isDeepStrictEqual(publicInitial.status.source,originalPublic.source),'Original public source or workspace identity changed');
  expect(providerInitial.status.workspace.id===originalProvider.workspace.id&&isDeepStrictEqual(providerInitial.status.runs,originalProvider.runs),'Original saved provider operations changed outside the browser journey');
  const originalRun=originalProvider.runs.find(value=>value.id===arg['operation-id']);
  expect(originalRun&&originalRun.actions.length&&originalRun.actions.every(action=>['CONFIRMED','ADOPTED'].includes(action.state)),'Original provider operation is absent or has an unfinished action');
  expect(original.inspection.preview.counts.resources===2&&original.inspection.preview.counts.media===3,'Original public source is not the retained two-resource/three-media example');
  const imported=PW?await import(pathToFileURL(PW).href):require('playwright');
  const chromium=imported.chromium||imported.default?.chromium;
  expect(chromium,'Selected Playwright module does not export Chromium');
  const launch={headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--renderer-process-limit=1'],env:environment};
  if(CHROME)launch.executablePath=CHROME;
  browser=await deadline(chromium.launch(launch),45000,'Original Chromium launch');
  context=await browser.newContext({viewport:{width:1365,height:950},acceptDownloads:true});
  await openServer(APP,WORKSPACE);await openPage();
  await mark('original-public-source-open',{workspaceId:originalPublic.workspace.id,initialRevision:originalPublic.mapping.revision,sourceBytes:originalPublic.source.bytes});
  const expectedKeys=await support('expected-keys',{before:originalPublic.mapping},'expected-original-keys');
  const assigned=await mappingStep('01-assign-keys',{
    before:originalPublic.mapping,route:'/api/assign-keys',expectedDocument:expectedKeys.document,
    context:{originalKeyAllocation:'MAINTAINED_EFFECTIVE_VALUES_AND_KEY',expectedMappingSha256:expectedKeys.mappingSha256},
    prepare:async()=>{await page.locator('[data-tab=mapping]').click();},
    trigger:()=>page.locator('#assignKeys').click()
  });
  expect(Object.keys(assigned.mapping.document.keyMaps.resources).length===2&&Object.keys(assigned.mapping.document.keyMaps.media).length===3,'Original source identifiers were not allocated completely');
  const first=await noteStep('02-first-note',assigned.mapping,FIRST_NOTE,{laterNote:FINAL_NOTE});
  const later=await noteStep('03-later-note',first.mapping,FINAL_NOTE);
  const typing=await finishLateTyping(first,later);
  let current=typing.finalMapping;
  const rowPath=path.join(ROOT,'reviewed-resource-row.json');
  let chosen=await optionalJson(rowPath);
  if(!chosen){
    await ensureCurrent(current.revision,current.document);
    await page.locator('[data-tab=preview]').click();await selectPreview('resources');
    const label=await page.locator('#previewRows input').first().getAttribute('aria-label');
    expect(label?.startsWith('Include source row '),'Original source-row identity is absent');
    chosen={schema:SCHEMA,inputSha256:identity.inputSha256,rowKey:label.slice('Include source row '.length),sourceManifestSha256:original.inspection.preview.sourceManifestSha256};
    await publish(rowPath,chosen);
  }
  expect(chosen.inputSha256===identity.inputSha256&&chosen.sourceManifestSha256===original.inspection.preview.sourceManifestSha256,'Original selected source row changed');
  const excluded=await rowStep('06-reasoned-exclusion',current,chosen.rowKey,false);
  const restored=await rowStep('07-original-inclusion-restored',excluded.mapping,chosen.rowKey,true);
  current=restored.mapping;
  const tableReview=await inspectTables(current);
  finalPublic=await freshPublic();
  expect(finalPublic.mapping.revision===current.revision&&isDeepStrictEqual(finalPublic.mapping.document,current.document),'Final original public review differs');
  const selection={workspaceId:originalPublic.workspace.id,revision:current.revision,document:current.document,
    mappingSha256:tableReview.mappingSha256,sourceManifestSha256:tableReview.sourceManifestSha256};
  const native=await queueOutput('09-native-package',{kind:'native-package',route:'/api/package',selection,trigger:()=>page.locator('#buildPackage').click()});
  const nativeDownload=await downloadArchive('10-native-browser-download',native,'USGS_Aviary_Native_Package.zip');
  const handoff=await queueOutput('11-complete-workspace',{kind:'workspace-export',route:'/api/export',selection,trigger:()=>page.locator('#exportWorkspace').click()});
  const exportDownload=await downloadArchive('12-workspace-browser-download',handoff,'USGS_Aviary_Complete_Workspace.zip');
  const publicShots=await screenshotPhase('12b-public-screenshots',[
    {name:'aviary-public-desktop.png',width:1365,height:950,prepare:async()=>{await page.locator('[data-tab=overview]').click();}},
    {name:'aviary-public-mobile.png',width:390,height:844,prepare:async()=>{await page.locator('[data-tab=preview]').click();await selectPreview('media');}}
  ]);
  await closeServer();
  const received=await coldReceive(exportDownload.file,current);
  await openServer(received.application,received.workspace);await openPage();
  const cold=(await get('/api/state')).status;
  expect(cold.workspace.id===originalPublic.workspace.id&&cold.mapping.revision===current.revision&&isDeepStrictEqual(cold.mapping.document,current.document)&&isDeepStrictEqual(cold.source,originalPublic.source),'Cold original public review/source/identity differs');
  await completeStep('14-cold-browser-open',{workspaceId:cold.workspace.id,revision:cold.mapping.revision,source:cold.source,applicationSource:sourcePin.sha256});
  await closeServer();
  await openServer(APP,PROVIDER);await openPage();
  const providerBefore=(await get('/api/state')).status;
  expect(providerBefore.workspace.id===originalProvider.workspace.id&&isDeepStrictEqual(providerBefore.runs,originalProvider.runs),'Original provider operation changed before browser selection');
  const providerSaved=await readStep('15-original-provider-draft');
  if(!providerSaved){
    await page.locator('[data-tab=transfer]').click();
    await page.locator('#savedOperation').selectOption(originalRun.id);
    await page.waitForFunction(id=>document.getElementById('runSummary').textContent.includes(id)&&!document.getElementById('runMigration').disabled,originalRun.id);
    await page.locator('#newOperation').click();
    const draft={baseUrl:'https://receiving-draft.aviaryplatform.com',organizationId:'456',collectionId:'789',tokenEnv:'AVIARY_RECEIVING_DRAFT_TOKEN',operationId:'public-usgs-browser-draft'};
    for(const [id,value] of Object.entries(draft))await page.locator('#'+id).fill(value);
    await page.locator('#savedOperation').selectOption(originalRun.id);
    await page.waitForFunction(()=>!document.getElementById('runMigration').disabled);
    await page.locator('#newOperation').click();
    for(const [id,value] of Object.entries(draft))expect(await page.locator('#'+id).inputValue()===value,'New destination draft was replaced: '+id);
    await page.locator('#savedOperation').selectOption(originalRun.id);
    await page.waitForFunction(()=>!document.getElementById('runMigration').disabled);
    const after=(await get('/api/state')).status;
    expect(isDeepStrictEqual(after.runs,originalProvider.runs),'Original provider operations changed during read-only browser review');
    await completeStep('15-original-provider-draft',{workspaceId:after.workspace.id,operationId:originalRun.id,draft,
      actions:originalRun.actions.map(action=>({key:action.action_key,state:action.state,id:action.provider_id})),providerMutationCount:0});
  }else{
    expect(providerSaved.operationId===originalRun.id&&providerSaved.workspaceId===originalProvider.workspace.id,'Retained selected provider identity differs');
    await page.locator('[data-tab=transfer]').click();await page.locator('#savedOperation').selectOption(originalRun.id);
    await page.waitForFunction(id=>document.getElementById('runSummary').textContent.includes(id)&&!document.getElementById('runMigration').disabled,originalRun.id);
  }
  const providerShots=await screenshotPhase('16-provider-screenshots',[
    {name:'aviary-original-migration-desktop.png',width:1365,height:950,prepare:async()=>{}},
    {name:'aviary-original-migration-mobile.png',width:390,height:844,prepare:async()=>{}}
  ]);
  const providerAfter=(await get('/api/state')).status;
  expect(isDeepStrictEqual(providerAfter.runs,originalProvider.runs),'Original provider actions changed during browser receiving');
  await closeServer();
  expect(pageErrors.length===0,'Original application browser errors: '+JSON.stringify(pageErrors));
  expect(consoleErrors.length===0,'Original application console errors: '+JSON.stringify(consoleErrors));
  const finalSource=await pinApplication(APP);expect(finalSource.sha256===sourcePin.sha256,'Original application source changed during browser receiving');
  const finalInspect=await support('inspect',{},'final-public');
  expect(finalInspect.status.mapping.revision===current.revision&&isDeepStrictEqual(finalInspect.status.mapping.document,current.document)&&isDeepStrictEqual(finalInspect.status.source,originalPublic.source),'Original public workspace changed after export/cold receive');
  return {
    schema:SCHEMA,operationId:OPERATION,inputSha256:identity.inputSha256,startedAt:identity.created,
    publicWorkspaceId:originalPublic.workspace.id,providerWorkspaceId:originalProvider.workspace.id,
    originalProviderOperationId:originalRun.id,source:originalPublic.source,initialMappingRevision:originalPublic.mapping.revision,
    finalMapping:current,applicationSource:sourcePin,
    nativePackage:{...nativeDownload.file,selectionRevision:native.archive.revision,jobId:native.job.id},
    publicWorkspaceExport:{...exportDownload.file,jobId:handoff.job.id},
    receivedPublic:{application:received.application,workspace:received.workspace},
    originalProviderActions:originalRun.actions.map(action=>({key:action.action_key,state:action.state,id:action.provider_id})),
    providerMutationCount:0,queuedJobIds:[native.job.id,handoff.job.id],
    screenshots:[...publicShots.screenshots,...providerShots.screenshots],
    independentImageInspection:'PENDING',pixelFiles:'LOCAL_QA',
    phaseReceipts:await allPhaseRecords(),phases:(await allPhaseRecords()).map(record=>({name:path.basename(path.dirname(record.path)),receipt:record})),pageErrors,consoleErrors
  };
}
const completionPath=path.join(ROOT,'completion-candidate.json');
let outcome=null,completion=null,existingResult=null;
try{
  await acquireLock();
  const previous=(await ownedProcesses(ownerPrefix)).filter(value=>value.owner!==ownerMarker);
  if(previous.length)await drainOrphans(previous,'reconciled-prior-owned-processes');
  existingResult=await optionalJson(resultPath);
  completion=await optionalJson(completionPath);
  if(existingResult){
    expect(existingResult.state==='PASS'&&existingResult.schema===SCHEMA,'A different or legacy final browser result is retained; do not overwrite it');
    await validateOutcome(existingResult);outcome=existingResult;
  }else if(completion){
    expect(completion.schema===SCHEMA&&completion.inputSha256===identity.inputSha256,'Original completion candidate binding differs');
    await validateOutcome(completion.outcome);
    expect(!(await ownedProcesses(completion.owner)).length,'Original completed browser still has an owned live process');
    outcome=completion.outcome;
  }else outcome=await runJourney();
}catch(error){mainError=error;}
finally{
  for(const retained of [...routes]){
    retained.release();
    await deadline(retained.done.catch(()=>{}),10000,'Pending route cleanup').catch(error=>cleanupErrors.push(briefError(error)));
    await retained.page.unroute(retained.pattern,retained.handler).catch(error=>cleanupErrors.push(briefError(error)));
    routes.delete(retained);
  }
  await closePage().catch(error=>cleanupErrors.push(briefError(error)));
  await closeServer().catch(error=>cleanupErrors.push(briefError(error)));
  if(context){const owned=context;context=null;await deadline(owned.close(),15000,'Original browser context close').catch(error=>cleanupErrors.push(briefError(error)));}
  if(browser){const owned=browser;browser=null;await deadline(owned.close(),15000,'Original Chromium close').catch(error=>cleanupErrors.push(briefError(error)));}
  for(const entry of [...children]){
    if(entry===lockChild)continue;
    await finishChild(entry,{stop:true}).catch(error=>cleanupErrors.push(briefError(error)));
  }
  const nonLock=(await ownedProcesses(ownerMarker).catch(error=>{cleanupErrors.push(briefError(error));return [];})).filter(value=>value.pid!==lockChild?.child.pid);
  if(nonLock.length){
    cleanupErrors.push({name:'CleanupError',message:'Application descendants required forced cleanup after the original close paths'});
    await drainOrphans(nonLock,'forced-current-owned-processes').catch(error=>cleanupErrors.push(briefError(error)));
  }
  if(!mainError&&!cleanupErrors.length&&outcome&&!existingResult&&!completion){
    completion={schema:SCHEMA,inputSha256:identity.inputSha256,owner:ownerMarker,runId,applicationCompletedAt:new Date().toISOString(),
      applicationProcessesDrained:true,contextClosed:true,browserClosed:true,drains:jsonClone(drains),outcome};
    await publish(completionPath,completion).catch(error=>{mainError=error;});
  }
  await releaseLock().catch(error=>cleanupErrors.push(briefError(error)));
  const leftover=await ownedProcesses(ownerMarker).catch(error=>{cleanupErrors.push(briefError(error));return [];});
  if(leftover.length){
    cleanupErrors.push({name:'CleanupError',message:'A receiving child remained active after final cleanup'});
    await drainOrphans(leftover,'final-owned-process-cleanup').catch(error=>cleanupErrors.push(briefError(error)));
  }
}
if(mainError||cleanupErrors.length){
  const failure={schema:SCHEMA,inputSha256:identity.inputSha256,runId,state:'FAILED',at:new Date().toISOString(),
    error:mainError?briefError(mainError):null,cleanupErrors,pageErrors,consoleErrors,phases,drains,
    resume:'Use the same command, original workspaces and output; retain every original request, job and artifact.'};
  await publish(path.join(RUN,'failure.json'),failure);
  console.error(JSON.stringify({state:'FAILED',runId,receipt:path.join(RUN,'failure.json'),error:failure.error,cleanupErrors}));
  process.exitCode=1;
}else{
  let final;
  if(existingResult)final=existingResult;
  else{
    expect(completion&&completion.applicationProcessesDrained&&completion.contextClosed&&completion.browserClosed,'Completed browser drain receipt absent');
    expect(!(await ownedProcesses(completion.owner)).length,'Original application/lock processes are still active');
    final={...completion.outcome,state:'PASS',completedAt:completion.applicationCompletedAt,
      cleanup:{applicationProcessesDrained:true,contextClosed:true,browserClosed:true,controlLockReleased:true,owner:completion.owner,drains:completion.drains}};
    await publish(resultPath,final);
  }
  console.log(JSON.stringify({state:'PASS',reused:Boolean(existingResult),result:resultPath,
    publicWorkspaceId:final.publicWorkspaceId,providerWorkspaceId:final.providerWorkspaceId,
    queuedJobIds:final.queuedJobIds,screenshots:final.screenshots.length,independentImageInspection:'PENDING'}));
}
