#!/usr/bin/env node
// MIT. Continue the completed native Support case through complete package UI and installed MCP.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {constants,createReadStream} from 'node:fs';
import {mkdir,readFile,writeFile,rename,readdir,lstat,open,unlink,realpath} from 'node:fs/promises';
import {resolve,join,dirname,basename,isAbsolute,relative,sep} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {parseArgs} from 'node:util';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';

const SCHEMA='stellar-forge.case-package-workspace-native-result.v1';
const P='stellar/scf-starforge-20261009/sf74-merchant-support-console';
const API='/api/case-packages',SOURCE_API='/api/commissioning/source-bundles';
const json=value=>JSON.stringify(value,null,2)+'\n';
const sha=value=>createHash('sha256').update(value).digest('hex');
const copy=value=>JSON.parse(JSON.stringify(value));
const now=()=>new Date().toISOString();
const pause=ms=>new Promise(done=>setTimeout(done,ms));
const fault=(message,code='CASE_PACKAGE_NATIVE_FAILED')=>Object.assign(new Error(message),{code});
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
function absolute(value,label){assert(typeof value==='string'&&isAbsolute(value),label+' requires an absolute path');return resolve(value);}
function within(parent,path){const r=relative(parent,path);return r===''||(!isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+sep));}
async function privateDirectory(path){
  await mkdir(path,{recursive:true,mode:0o700});const st=await lstat(path);
  assert(st.isDirectory()&&!st.isSymbolicLink()&&(st.mode&0o077)===0,'Use a real private directory: '+path);
  if(process.getuid)assert.equal(st.uid,process.getuid());return path;
}
async function bytes(path,maximum=96*1024*1024){
  const h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await h.stat();assert(before.isFile()&&before.size<=maximum,'Original file exceeds its declared input');
    const value=await h.readFile(),after=await h.stat();
    assert.equal(value.length,before.size);assert.equal(after.dev,before.dev);assert.equal(after.ino,before.ino);
    assert.equal(after.size,before.size);assert.equal(after.mtimeMs,before.mtimeMs);return value;
  }finally{await h.close();}
}
async function filePin(path){
  const h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await h.stat();assert(before.isFile(),'Original member must be a regular file');
    const buffer=Buffer.allocUnsafe(1024*1024),hash=createHash('sha256');let count=0;
    for(;;){const r=await h.read(buffer,0,buffer.length,null);if(!r.bytesRead)break;count+=r.bytesRead;hash.update(buffer.subarray(0,r.bytesRead));}
    const after=await h.stat();assert.equal(count,before.size);assert.equal(after.size,before.size);
    assert.equal(after.mtimeMs,before.mtimeMs);return {bytes:count,sha256:hash.digest('hex')};
  }finally{await h.close();}
}
async function retain(path,value){
  value=Buffer.isBuffer(value)?value:Buffer.from(value);await privateDirectory(dirname(path));
  let h;try{h=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await h.writeFile(value);await h.sync();}
  catch(error){if(error.code!=='EEXIST')throw error;assert((await bytes(path,Math.max(1,value.length))).equals(value),'Original retained bytes changed: '+path);}
  finally{await h?.close();}return {name:basename(path),bytes:value.length,sha256:sha(value)};
}
async function atomic(path,value){
  await privateDirectory(dirname(path));const temp=path+'.'+randomUUID()+'.tmp';let h;
  try{h=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    await h.writeFile(json(value));await h.sync();await h.close();h=null;await rename(temp,path);
    const d=await open(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY);try{await d.sync();}finally{await d.close();}
  }finally{await h?.close();await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function inventory(directory){
  const found=[];async function walk(root,prefix){
    for(const e of(await readdir(root,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      const path=join(root,e.name),name=prefix?prefix+'/'+e.name:e.name,st=await lstat(path);
      assert(!st.isSymbolicLink(),'Portable original cannot contain a symbolic link: '+name);
      if(st.isDirectory())await walk(path,name);else{assert(st.isFile());found.push({name,...await filePin(path)});}
    }
  }await walk(directory,'');return found;
}
async function until(read,accept,label,{timeout=180000,interval=200}={}){
  const end=performance.now()+timeout;let value;
  for(;;){value=await read();if(accept(value))return value;if(performance.now()>end)throw Object.assign(fault(label+' did not settle'),{lastResult:value});await pause(interval);}
}
async function http(origin,path,{method='GET',body,headers={},timeout=180000,raw=false}={}){
  const has=body!==undefined;
  const response=await fetch(origin+path,{method,headers:{...(has?{origin}:{}),
    ...(has&&!raw?{'content-type':'application/json'}:{}),...headers},
    ...(has?{body:raw?body:JSON.stringify(body)}:{}),...(raw&&body?.pipe?{duplex:'half'}:{}),
    signal:AbortSignal.timeout(timeout)});
  const original=Buffer.from(await response.arrayBuffer());let result;
  try{result=JSON.parse(original.toString('utf8'));}catch{throw fault('Original API returned a non-JSON response: '+path);}
  if(!response.ok)throw Object.assign(fault(result.detail||result.error||'Original API failed',result.error||'HTTP_'+response.status),
    {status:response.status,result});
  return result;
}
async function allHistory(store,id){
  const rows=[],seen=new Set();let before=null;
  do{const page=await store.history(id,{before,limit:100});for(const row of page.revisions){assert(!seen.has(row.revision));seen.add(row.revision);rows.push(row);}before=page.nextBefore;}while(before!==null);
  return rows;
}
function decodeTool(result){
  if(result?.isError)throw Object.assign(fault('The original MCP tool returned an error'),{result});
  if(result?.structuredContent&&Object.keys(result.structuredContent).length)return result.structuredContent;
  const text=result?.content?.filter(row=>row.type==='text').map(row=>row.text).join('\n');if(text){try{return JSON.parse(text);}catch{}}
  return result;
}
async function main(){
  const {values}=parseArgs({options:Object.fromEntries(['source','source-map','baseline-workspace','workspace','modules','browser','node','python','operation-id'].map(name=>[name,{type:'string'}])),strict:true});
  const source=absolute(values.source,'Source'),baselineRoot=absolute(values['baseline-workspace'],'Completed native workspace'),
    root=absolute(values.workspace,'Continuation output'),modules=absolute(values.modules,'Existing Node modules'),
    browserPath=absolute(values.browser,'Existing Chromium'),python=absolute(values.python,'Existing Python'),
    node=values.node?absolute(values.node,'Existing Node'):process.execPath,
    operationId=values['operation-id']||'SCF-CASE-PACKAGE-WORKSPACE-20261012-7A2F';
  assert(/^[A-Za-z0-9][A-Za-z0-9._:-]{3,150}$/.test(operationId));
  assert(!within(source,root)&&!within(root,source),'Keep source and native state separate');
  assert(root!==baselineRoot&&!within(root,baselineRoot),'Use a distinct output directory preserving the original baseline');
  await privateDirectory(root);
  const baselinePath=join(baselineRoot,'implementation-operation.json'),baselineBytes=await bytes(baselinePath,64*1024*1024),
    baseline=JSON.parse(baselineBytes);
  assert.equal(baseline.status,'COMPLETED','Complete and close the original case workflow before this continuation');
  assert(Array.isArray(baseline.resourcesReleased?.results)&&baseline.resourcesReleased.results.every(r=>r.status==='closed'),
    'The original case owners must be closed');
  assert(uuid(baseline.receivedCase?.id),'Use the actual completed receiving case');
  const originalInput=JSON.parse(await bytes(join(baselineRoot,'original-input.json'),4*1024*1024));
  const actor=originalInput.operator?.name;assert(typeof actor==='string'&&actor.trim());
  const sourceMapPath=absolute(values['source-map']||join(baselineRoot,'source-map.json'),'Frozen source map');
  const sourceMapBytes=await bytes(sourceMapPath,32*1024*1024),sourceMap=JSON.parse(sourceMapBytes);
  assert(sourceMap.files&&typeof sourceMap.files==='object','Use the complete selected source map');
  const sourceFiles=Array.isArray(sourceMap.files)?sourceMap.files:Object.entries(sourceMap.files).map(([path,value])=>({path,source:typeof value==='string'?value:value.source,sha256:value.sha256}));
  const rows=[];
  for(const file of sourceFiles){
    assert(typeof file.path==='string'&&!isAbsolute(file.path)&&!file.path.split('/').includes('..'));
    const actual=await filePin(join(source,file.path)),expected=typeof file.source==='string'?sha(Buffer.from(file.source)):file.sha256;
    assert(digest(expected));assert.equal(actual.sha256,expected,'Selected installed source changed: '+file.path);rows.push({path:file.path,...actual});
  }
  for(const needed of [P+'/case-package-desk.mjs',P+'/case-package-operations.mjs','stellar-forge/mcp-merchant-operator/support-case-packages.mjs'])
    assert(rows.some(r=>r.path===needed),'Freeze the complete installed package product before first dispatch: '+needed);
  const paths={senderCases:join(baselineRoot,'receiver-cases'),senderSources:join(baselineRoot,'receiver-cases','source-bundles'),
    senderPackages:join(root,'sender-packages'),receiverCases:join(root,'receiver-cases'),
    receiverSources:join(root,'receiver-cases','source-bundles'),receiverPackages:join(root,'receiver-packages'),
    remoteCases:join(root,'mcp-receiver-cases'),remoteSources:join(root,'mcp-receiver-cases','source-bundles'),
    remotePackages:join(root,'mcp-receiver-packages'),output:join(root,'delivery'),screens:join(root,'screens'),
    commands:join(root,'original-commands'),mcp:join(root,'installed-mcp'),downloads:join(root,'browser-downloads')};
  for(const path of Object.values(paths))await privateDirectory(path);
  const journalFile=join(root,'case-package-operation.json');
  let journal;try{journal=JSON.parse(await bytes(journalFile,64*1024*1024));}catch(error){if(error.code!=='ENOENT')throw error;}
  const binding={operationId:baseline.operationId,journalSha256:sha(baselineBytes),caseId:baseline.receivedCase.id,
    finalRevision:baseline.finalExport?.caseRevision??baseline.steps.final_complete_native_delivery?.revision};
  assert(digest(binding.finalRevision));
  if(journal){assert.equal(journal.schema,SCHEMA);assert.equal(journal.operationId,operationId);assert.deepEqual(journal.baseline,binding);
    assert.equal(journal.sourceMapSha256,sha(sourceMapBytes),'Continue the same installed source');}
  else journal={schema:SCHEMA,operationId,state:'running',startedAt:now(),baseline:binding,sourceMapSha256:sha(sourceMapBytes),
    source:{commit:originalInput.sourceCommit,mapBlob:originalInput.sourceMapBlob??null,files:rows},
    paths:copy(paths),stages:{},requests:{},artifacts:[],browserErrors:[],resources:{closed:false,browserClosed:false,serversClosed:false,workersClosed:false}};
  let writeTail=Promise.resolve();const save=()=>writeTail=writeTail.then(()=>atomic(journalFile,journal));
  await retain(join(root,'completed-baseline-operation.json'),baselineBytes);await retain(join(root,'source-map.json'),sourceMapBytes);await save();
  if(journal.state==='completed'&&journal.resources.closed){process.stdout.write(json({state:journal.state,operationId,result:journalFile}));return;}
  const imports=await Promise.all(['case-store.mjs','workspace-file.mjs','server.mjs','commissioning.mjs'].map(n=>import(pathToFileURL(join(source,P,n)).href)));
  const [{openCaseStore},{parseWorkspace},{start},commissioning]=imports;
  const senderStore=await openCaseStore(paths.senderCases),receiverStore=await openCaseStore(paths.receiverCases),remoteStore=await openCaseStore(paths.remoteCases);
  let sender=null,receiver=null,remote=null,mcpSender=null,mcpReceiver=null,browser=null,context=null,page=null;
  const children=new Set(),owners=[];
  const env={...process.env,SCF_PYTHON:python},id=name=>'cp-'+sha(operationId+':'+name).slice(0,40);
  const liveOperation=name=>journal.requests[name]?.id??null;
  async function stage(name,work){
    if(journal.stages[name])return journal.stages[name];journal.state='running';journal.activeStage=name;await save();
    const result=await work();journal.stages[name]={completedAt:now(),...result};await save();return journal.stages[name];
  }
  async function startDesk(name,options){
    const value=await start({...options,port:options.port??0,allowLoopback:true,environment:options.environment??env});
    value.url=new URL(value.url).origin;owners.push({name,owner:value,closed:false});return value;
  }
  async function closeOwner(owner){
    if(!owner)return;const entry=owners.find(x=>x.owner===owner);if(entry?.closed)return;
    await owner.close();if(entry)entry.closed=true;
  }
  async function screen(name){
    const file=join(paths.screens,name+'.png');await page.screenshot({path:file,fullPage:true});
    const pin=await filePin(file);journal.artifacts=journal.artifacts.filter(x=>x.name!=='screens/'+name+'.png');
    journal.artifacts.push({name:'screens/'+name+'.png',...pin});await save();return pin;
  }
  async function openCase(desk,store,caseId){
    const record=await store.read(caseId);await page.goto(desk.url,{waitUntil:'domcontentloaded'});
    await page.locator('#case-search').fill(record.name);
    await page.getByRole('button',{name:'Find merchant cases',exact:true}).click();
    await page.getByRole('table',{name:'Saved merchant cases'}).getByRole('button',{name:record.name,exact:true}).click();
    await until(()=>page.locator('#case-status').textContent(),t=>t?.includes(caseId),'original case open');
    await page.locator('#cp-actor').fill(actor);await page.locator('#case-packages').scrollIntoViewIfNeeded();
    await until(()=>page.locator('#case-packages .cp-desk').getAttribute('data-busy'),v=>v==='false','package desk load');
    return record;
  }
  async function nativeRequest(key,origin,path,body){
    let record=journal.requests[key];
    if(record){assert.equal(record.path,path);assert.deepEqual(record.body,body,'Original request body');}
    else{record={path,body:copy(body),preparedAt:now()};journal.requests[key]=record;await save();}
    if(record.result)return record.result;
    const value=await http(origin,path,{method:'POST',body:record.body});record.result=value;record.returnedAt=now();await save();return value;
  }
  async function sourceCommand(key,action,input){
    const requestId=id('source-'+key),body={id:input.id,requestId,action,input:copy(input)};
    if(['attach','reopen'].includes(action))body.input.requestId=requestId;
    const old=journal.requests['source-'+key];
    if(old?.result)return old.result;
    if(!old){journal.requests['source-'+key]={body,preparedAt:now()};await save();}
    else assert.deepEqual(old.body,body,'Original native source command');
    let current;
    try{current=await http(sender.url,SOURCE_API+'/command?'+new URLSearchParams({id:input.id,requestId}));}
    catch(error){if(!['SF49_DELIVERY_COMMAND_NOT_FOUND'].includes(error.code))throw error;}
    if(!current||['NEEDS_CONTINUATION','FAILED'].includes(current.state))
      await http(sender.url,SOURCE_API+'/command',{method:'POST',body:{...body,...(current?{continue:true}:{})}});
    current=await until(()=>http(sender.url,SOURCE_API+'/command?'+new URLSearchParams({id:input.id,requestId})),v=>{
      if(v.state==='FAILED')throw Object.assign(fault(v.error?.message||'Original source command failed'),{result:v});
      return v.state==='COMPLETE';},'native source '+action,{timeout:300000});
    journal.requests['source-'+key].result=current.result;await save();return current.result;
  }
  async function settled(origin,operation){
    return until(()=>http(origin,API+'/operations/'+operation),value=>{
      if(['NEEDS_CONTINUATION','FAILED'].includes(value.state)&&!value.runningHere)
        throw Object.assign(fault('Original package operation requires continuation'),{result:value});
      return value.state==='COMPLETE'&&!value.runningHere;},'complete package '+operation,{timeout:600000});
  }

  async function ensureBrowser(){
    if(browser)return;
    const require=createRequire(join(modules,'playwright','package.json')),{chromium}=require('playwright');
    browser=await chromium.launch({executablePath:browserPath,headless:true,
      args:['--no-sandbox','--disable-dev-shm-usage'],downloadsPath:paths.downloads});
    context=await browser.newContext({viewport:{width:1440,height:1080},timezoneId:'UTC',acceptDownloads:true});
    page=await context.newPage();page.setDefaultTimeout(60000);
    page.on('pageerror',error=>journal.browserErrors.push({at:now(),message:error.message}));
  }
  async function ensureSender(){
    if(sender&&!owners.find(x=>x.owner===sender)?.closed)return sender;
    sender=await startDesk('original-completed-case',{casesDir:paths.senderCases,sourceDir:paths.senderSources,packageDir:paths.senderPackages});
    return sender;
  }
  async function ensureReceiver(){
    if(receiver&&!owners.find(x=>x.owner===receiver)?.closed)return receiver;
    receiver=await startDesk('folder-package-receiver',{casesDir:paths.receiverCases,sourceDir:paths.receiverSources,packageDir:paths.receiverPackages});
    return receiver;
  }
  async function packageManifest(origin,selection,expected){
    return http(origin,API+'/manifest?'+new URLSearchParams({kind:selection.kind,id:selection.id,...(expected?{manifestSha:expected}:{})}));
  }
  async function verifyPortable(directory,expected){
    const manifestBytes=await bytes(join(directory,'case-source-package.json'),64*1024*1024),manifest=JSON.parse(manifestBytes);
    if(expected)assert.equal(sha(manifestBytes),expected,'Exact complete package manifest');
    assert.equal(manifest.schema,'stellar-forge.merchant-case-source-package.v1');
    for(const file of manifest.files){
      const path=resolve(directory,file.name);assert(within(directory,path));
      const actual=await filePin(path);assert.equal(String(actual.bytes),String(file.bytes),'Original member bytes: '+file.name);
      assert.equal(actual.sha256,file.sha256,'Original member digest: '+file.name);
    }
    assert(manifest.caseHistory.revisions.length>0);
    for(const bundle of manifest.sourceBundles){
      assert(digest(bundle.bundleId)&&digest(bundle.manifestSha256));
      assert.equal(sha(Buffer.from(bundle.manifestText)),bundle.manifestSha256,'Native manifest bytes');
      const originalManifest=bundle.files.find(file=>file.path==='manifest.json');
      assert(originalManifest&&originalManifest.sha256===bundle.manifestSha256,'Original native manifest is in every full member inventory');
      assert(manifest.files.some(file=>file.name===bundle.archive.name&&file.sha256===bundle.archive.sha256),'Original complete native archive is retained');
    }
    return {manifest,manifestSha256:sha(manifestBytes),manifestBytes:manifestBytes.length,
      members:manifest.files.length,bytes:manifest.files.reduce((n,row)=>n+BigInt(row.bytes),0n).toString()};
  }
  async function browserOperation(key,action){
    const retained=journal.requests[key];
    if(retained?.result)return retained.result;
    if(retained?.body){
      const result=await http(new URL(page.url()).origin,API+'/operations',{method:'POST',body:retained.body});
      assert.equal(result.id,retained.body.id);retained.result=result;await save();return result;
    }
    const routeName=new URL(page.url()).origin+API+'/operations';
    await page.route(routeName,async route=>{
      if(route.request().method()!=='POST'){await route.continue();return;}
      const body=route.request().postDataJSON();
      if(journal.requests[key])assert.deepEqual(journal.requests[key].body,body,'Original browser input remains selected');
      else{journal.requests[key]={body:copy(body),preparedAt:now()};await save();}
      await route.continue();
    });
    const waiting=page.waitForResponse(response=>{
      const request=response.request();return request.method()==='POST'&&new URL(response.url()).pathname===API+'/operations';
    }).then(async response=>{
      const body=response.request().postDataJSON(),result=await response.json();
      assert.deepEqual(journal.requests[key].body,body);journal.requests[key].result=result;journal.requests[key].returnedAt=now();await save();
      assert.equal(response.status(),202,'The original browser operation was accepted');assert.equal(result.id,body.id);return result;
    });
    waiting.catch(()=>{});
    try{await action();return await waiting;}finally{await page.unroute(routeName);}
  }
  async function chooseOperation(origin,operation){
    await page.getByRole('tab',{name:'Operations',exact:true}).click();
    let row=page.locator('#case-packages table tbody tr').filter({has:page.getByText(operation,{exact:true})});
    if(await row.count()){
      await row.getByRole('button',{name:'Open',exact:true}).click();
    }else{
      // The browser's operation list is paginated; load the current source again
      // so its first page contains the newly completed original operation.
      await page.reload({waitUntil:'domcontentloaded'});
      await until(()=>page.locator('#case-packages .cp-desk').getAttribute('data-busy'),v=>v==='false','package operation list');
      await page.getByRole('tab',{name:'Operations',exact:true}).click();
      row=page.locator('#case-packages table tbody tr').filter({has:page.getByText(operation,{exact:true})});
      assert.equal(await row.count(),1);await row.getByRole('button',{name:'Open',exact:true}).click();
    }
    await until(()=>page.locator('#cp-operation-progress').textContent(),value=>{
      try{return JSON.parse(value).state==='COMPLETE';}catch{return false;}
    },'completed browser operation');
    const actual=await http(origin,API+'/operations/'+operation);assert.equal(actual.state,'COMPLETE');return actual;
  }
  async function downloadOriginal(origin,selection,packageSha,bundle,member,name){
    const path=API+'/original-files?'+new URLSearchParams({kind:selection.kind,id:selection.id,manifestSha:packageSha,
      bundleId:bundle.bundleId,bundleSha:bundle.manifestSha256,name:member.path});
    const response=await fetch(origin+path,{signal:AbortSignal.timeout(120000)});
    assert.equal(response.status,200);assert.equal(response.headers.get('x-content-sha256'),member.sha256);
    const value=Buffer.from(await response.arrayBuffer());assert.equal(String(value.length),String(member.bytes));assert.equal(sha(value),member.sha256);
    const retained=await retain(join(paths.output,name),value);return {path:member.path,...retained};
  }
  async function runCommand(key,args){
    journal.cli??={};const attempt=(journal.cli[key]?.attempt??0)+1;
    const prefix=join(paths.commands,key+'-'+attempt),out=await open(prefix+'.stdout',constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600),
      err=await open(prefix+'.stderr',constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
    let child,result;
    try{
      child=spawn(node,args,{cwd:root,env,stdio:['ignore',out.fd,err.fd]});children.add(child);
      result=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>done({code,signal}));});
    }finally{
      if(child&&child.exitCode===null&&child.signalCode===null){
        child.kill('SIGTERM');await new Promise(done=>{const timer=setTimeout(()=>{child.kill('SIGKILL');},10000);child.once('close',()=>{clearTimeout(timer);done();});});
      }
      if(child)children.delete(child);await out.close();await err.close();
    }
    journal.cli[key]={attempt,args,result,stdout:await filePin(prefix+'.stdout'),stderr:await filePin(prefix+'.stderr')};await save();
    assert.equal(result?.code,0,'The original installed CLI must complete: '+key);
    return JSON.parse((await bytes(prefix+'.stdout',64*1024*1024)).toString('utf8'));
  }
  try{
    await ensureBrowser();await ensureSender();
    await stage('completed_case_and_installed_package_workspace',async()=>{
      const record=await senderStore.read(binding.caseId);
      assert.equal(record.revision,binding.finalRevision,'Start with the exact completed original receiving revision');
      const history=await allHistory(senderStore,binding.caseId);for(const row of history)await senderStore.read(binding.caseId,row.revision);
      journal.originalHistory=history.map(row=>row.revision);journal.initialCase={id:record.id,revision:record.revision,
        workspaceSha256:sha(record.workspaceText),supportSha256:sha(record.supportText)};await save();
      await openCase(sender,senderStore,binding.caseId);
      const catalog=await http(sender.url,API+'/catalog');
      assert.equal(catalog.casesDirectory,paths.senderCases);assert.equal(catalog.sourceDirectory,paths.senderSources);
      assert.equal(catalog.directory,paths.senderPackages);assert(catalog.enabled);
      await screen('01-original-completed-case-package-workspace');
      return {case:copy(journal.initialCase),history:journal.originalHistory,catalog};
    });
    await stage('all_native_source_editions_and_unassigned_originals',async()=>{
      const attachmentSets=[
        [{path:join(baselineRoot,'delivery','FINAL_RECEIVED_IMPLEMENTATION.html'),name:'completed-implementation.html',role:'implementation-report'},
         {path:join(baselineRoot,'delivery','FINAL_RECEIVED_TASKS.csv'),name:'completed-implementation-tasks.csv',role:'implementation-task-register'}],
        [{path:baselinePath,name:'original-completed-operation.json',role:'native-operating-result'},
         {path:join(baselineRoot,'delivery','ORIGINAL_CASE_RECEIVING.md'),name:'original-case-receiving.md',role:'receiving-instructions'}]
      ];
      const originalRevision=journal.initialCase.revision,descriptors=[];
      // Both native source selections start from the SAME actual saved case.
      // Their separate original attachments remain distinct source editions.
      for(let index=0;index<attachmentSets.length;index++){
        const files=[];
        for(let n=0;n<attachmentSets[index].length;n++){
          const selected=attachmentSets[index][n],pin=await filePin(selected.path);
          files.push({id:'original-'+index+'-'+n,name:selected.name,role:selected.role,...pin});
        }
        const transferId=id('source-edition-'+index),selection={id:transferId,kind:'source',caseId:binding.caseId,
          caseRevision:originalRevision,label:'Original completed-case source edition '+(index+1),actor,files};
        await sourceCommand('begin-'+index,'begin',selection);
        for(let n=0;n<files.length;n++){
          const key='source-upload-'+index+'-'+n,selected=files[n],path=attachmentSets[index][n].path;
          if(!journal.requests[key]?.result){
            journal.requests[key]??={transferId,file:selected,path,preparedAt:now()};await save();
            const value=await http(sender.url,SOURCE_API+'/upload?'+new URLSearchParams({id:transferId,file:selected.id}),
              {method:'PUT',body:createReadStream(path),raw:true,headers:{'content-type':'application/octet-stream','content-length':String(selected.bytes)}});
            journal.requests[key].result=value;await save();
          }
        }
        const prepared=await sourceCommand('prepare-'+index,'prepare',{id:transferId});
        assert.equal(prepared.state,'READY');assert(prepared.descriptor?.files?.length>=files.length+1);
        descriptors.push(prepared.descriptor);
      }
      assert.notEqual(descriptors[0].manifestSha256,descriptors[1].manifestSha256);
      for(let index=0;index<descriptors.length;index++){
        const key='source-attach-'+index,prior=journal.requests['source-'+key]?.body?.input,
          current=await senderStore.read(binding.caseId);
        const result=await sourceCommand(key,'attach',{id:id('source-edition-'+index),caseId:binding.caseId,
          expectedRevision:prior?.expectedRevision??current.revision,actor});
        assert.equal(result.attachment.bundleId,descriptors[index].bundleId);
        assert.equal(result.attachment.manifestSha256,descriptors[index].manifestSha256);
      }
      const record=await senderStore.read(binding.caseId),workspace=await parseWorkspace(record.workspaceText);
      const retained=commissioning.commissioningSourceBundles(workspace.commissioning);
      for(const descriptor of descriptors){
        const original=retained.find(row=>row.bundleId===descriptor.bundleId&&row.manifestSha256===descriptor.manifestSha256);
        assert(original,'Both actual native editions remain available');
        for(const file of descriptor.files)assert(original.files.some(row=>row.path===file.path&&row.sha256===file.sha256));
      }
      const unassignedSha=sha(baselineBytes),originalSource=retained.find(row=>row.files.some(file=>file.sha256===unassignedSha));
      assert(originalSource,'The actual completed operating result is an original retained source member');
      const currentMaterials=workspace.commissioning.materials??[],materialIds=currentMaterials.filter(row=>row.sha256===unassignedSha).map(row=>row.id);
      const assigned=currentMaterials.some(row=>materialIds.includes(row.id)&&(row.taskIds??[]).length>0)||
        (workspace.commissioning.tasks??[]).some(row=>(row.materialIds??[]).some(value=>materialIds.includes(value)));
      assert(!assigned,'The complete operating result remains unassigned to a task');
      journal.sourceEditions={caseRevision:record.revision,descriptors:copy(descriptors),all:retained.map(({manifestText,...row})=>row),
        unassigned:{bundleId:originalSource.bundleId,manifestSha256:originalSource.manifestSha256,sha256:unassignedSha}};await save();
      await openCase(sender,senderStore,binding.caseId);await screen('02-retained-native-source-editions');
      return {caseId:binding.caseId,revision:record.revision,sourceBundles:retained.length,
        originalManifests:descriptors.map(row=>row.manifestSha256),unassignedOriginal:copy(journal.sourceEditions.unassigned)};
    });
    await stage('browser_export_and_original_response_recovery',async()=>{
      await openCase(sender,senderStore,binding.caseId);
      const exportId=id('browser-export'),revision=journal.sourceEditions.caseRevision;
      journal.exportSelection??={exportId,caseId:binding.caseId,revision};await save();
      assert.deepEqual(journal.exportSelection,{exportId,caseId:binding.caseId,revision});
      const body={id:exportId,kind:'export',actor,caseId:binding.caseId,revision};
      journal.requests.browserExport??={body,preparedAt:now()};await save();
      if(!journal.lostBrowserReply){
        const pattern=sender.url+API+'/operations';let intercepted=false;
        await page.route(pattern,async route=>{
          if(route.request().method()!=='POST'||route.request().postDataJSON()?.id!==exportId){await route.continue();return;}
          assert(!intercepted,'Only the original selected reply is interrupted');intercepted=true;
          assert.deepEqual(route.request().postDataJSON(),body);
          const actual=await route.fetch(),native=await actual.json();
          assert.equal(actual.status(),202);assert.equal(native.id,exportId);
          journal.lostBrowserReply={at:now(),request:copy(body),actualResponse:native,
            responseSha256:sha(await actual.body())};await save();
          // The real native operation has accepted its original request. Only
          // this browser's response body is interrupted, preserving its input.
          await route.fulfill({status:202,contentType:'application/json',body:'{"id":'+JSON.stringify(exportId)+'}'});
        });
        try{
          await page.locator('#cp-export-id').fill(exportId);await page.locator('#cp-export').click();
          await until(()=>page.locator('#cp-status').textContent(),text=>text?.includes('incomplete'),'retained original browser reply');
          assert(intercepted);assert(await page.locator('#cp-resume-pending').isVisible());
          assert(await page.locator('#cp-export').isDisabled(),'New operations keep the retained original input');
          await screen('03-original-pending-export-recovery');
        }finally{await page.unroute(pattern);}
      }
      const oldStatus=await http(sender.url,API+'/operations/'+exportId);
      assert.equal(oldStatus.request.createdAt,journal.lostBrowserReply.actualResponse.request.createdAt);
      if(await page.locator('#cp-resume-pending').isVisible()&&await page.locator('#cp-resume-pending').isEnabled()){
        const replay=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===API+'/operations')
          .then(async response=>{assert.deepEqual(response.request().postDataJSON(),body);const result=await response.json();assert.equal(response.status(),202);return result;});
        await page.locator('#cp-resume-pending').click();
        journal.requests.browserExport.result=await replay;await save();
      }else{
        journal.requests.browserExport.result=await http(sender.url,API+'/operations',{method:'POST',body});await save();
      }
      const completed=await settled(sender.url,exportId);
      assert.equal(completed.request.createdAt,journal.lostBrowserReply.actualResponse.request.createdAt,'Exact original preparation is reused');
      const manifest=await packageManifest(sender.url,{kind:'operation',id:exportId});
      const directory=join(paths.senderPackages,'operations',exportId,'package'),verified=await verifyPortable(directory,manifest.manifestSha256);
      for(const revision of journal.originalHistory)assert(verified.manifest.caseHistory.revisions.some(row=>row.revision===revision));
      for(const source of journal.sourceEditions.all){
        const actual=verified.manifest.sourceBundles.find(row=>row.bundleId===source.bundleId&&row.manifestSha256===source.manifestSha256);
        assert(actual);for(const file of source.files)assert(actual.files.some(row=>row.path===file.path&&row.sha256===file.sha256));
      }
      journal.exportPackage={directory,exportId,manifestSha256:verified.manifestSha256,
        caseRevision:revision,caseHistory:verified.manifest.caseHistory.revisions.map(row=>row.revision),
        sourceBundles:verified.manifest.sourceBundles.map(({manifestText,...row})=>row)};await save();
      await chooseOperation(sender.url,exportId);await page.locator('#cp-view-operation-package').click();
      await page.locator('#cp-inventory-section').selectOption('sourceBundles');
      await until(()=>page.locator('#case-packages .cp-desk').getAttribute('data-busy'),v=>v==='false','complete source inventory');
      await screen('04-complete-package-original-source-inventory');
      const bundle=verified.manifest.sourceBundles.find(row=>row.manifestSha256===journal.sourceEditions.unassigned.manifestSha256),
        member=bundle.files.find(row=>row.sha256===journal.sourceEditions.unassigned.sha256);
      const original=await downloadOriginal(sender.url,{kind:'operation',id:exportId},verified.manifestSha256,bundle,member,'RETAINED_UNASSIGNED_OPERATING_RESULT.json');
      return {exportId,manifestSha256:verified.manifestSha256,directory,
        sourceBundles:verified.manifest.sourceBundles.length,revisions:verified.manifest.caseHistory.revisions.length,
        originalRequestCreatedAt:completed.request.createdAt,lostReplyReconciled:true,unassignedOriginal:original};
    });

    await ensureReceiver();
    await stage('browser_folder_upload_receive_and_full_history',async()=>{
      await page.goto(receiver.url,{waitUntil:'domcontentloaded'});
      await until(()=>page.locator('#case-packages .cp-desk').getAttribute('data-busy'),value=>value==='false','fresh package receiver');
      await page.locator('#cp-actor').fill(actor);
      const inputId=id('browser-folder-input');await page.locator('#cp-input-id').fill(inputId);
      if(!journal.requests.folderInspection?.body){
        await page.locator('#cp-local-files').setInputFiles(journal.exportPackage.directory);
        await until(()=>page.locator('#cp-local-summary').textContent(),value=>value?.includes(journal.exportPackage.exportId),'selected exact package folder');
      }
      const inspection=await browserOperation('folderInspection',()=>page.locator('#cp-upload').click());
      assert.equal(inspection.request.kind,'inspect');assert.deepEqual(inspection.request.source,{kind:'input',id:inputId});
      assert.equal(inspection.request.manifestSha256,journal.exportPackage.manifestSha256);
      const completedInspection=await settled(receiver.url,inspection.id);
      journal.folderInput={id:inputId,inspectionId:inspection.id,manifestSha256:journal.exportPackage.manifestSha256};await save();
      const uploaded=await http(receiver.url,API+'/inputs/'+inputId);
      assert.equal(uploaded.missingFiles,0);assert.equal(uploaded.availableFiles,uploaded.files);
      await chooseOperation(receiver.url,inspection.id);await page.locator('#cp-view-operation-package').click();
      await until(()=>page.locator('#cp-inventory-summary').textContent(),value=>value?.includes(journal.exportPackage.exportId),'received input inventory');
      await screen('05-complete-folder-inspected-originals');
      const received=await browserOperation('folderReceiving',()=>page.locator('#cp-receive-selected').click());
      assert.equal(received.request.kind,'receive');assert.deepEqual(received.request.source,{kind:'input',id:inputId});
      const finished=await settled(receiver.url,received.id),receipt=finished.result;
      assert.equal(receipt.manifestSha256,journal.exportPackage.manifestSha256);
      assert.equal(receipt.sourceDirectory,paths.receiverSources);
      assert.equal(receipt.originalCaseHistory.revisions,journal.exportPackage.caseHistory.length);
      assert.equal(receipt.sourceBundles.length,journal.exportPackage.sourceBundles.length);
      const opened=await http(receiver.url,API+'/operations/'+received.id+'/open',{method:'POST',body:{}});
      const selected=await senderStore.read(journal.exportSelection.caseId,journal.exportSelection.revision);
      const restored=await receiverStore.read(opened.case.id,opened.importedRevision);
      assert.equal(restored.workspaceText,selected.workspaceText);assert.equal(restored.supportText,selected.supportText);
      assert.deepEqual(restored.metadata,selected.metadata);
      const preservedStore=await openCaseStore(receipt.originalCaseHistory.directory);
      for(const revision of journal.exportPackage.caseHistory){
        const actual=await preservedStore.read(binding.caseId,revision),original=await senderStore.read(binding.caseId,revision);
        assert.equal(actual.workspaceText,original.workspaceText);assert.equal(actual.supportText,original.supportText);
        assert.deepEqual(actual.metadata,original.metadata);
      }
      const state=await parseWorkspace(restored.workspaceText),sources=commissioning.commissioningSourceBundles(state.commissioning);
      assert.equal(sources.length,journal.sourceEditions.all.length);
      for(const row of sources)assert(journal.sourceEditions.all.some(source=>source.bundleId===row.bundleId&&source.manifestSha256===row.manifestSha256));
      const full=await packageManifest(receiver.url,{kind:'operation',id:received.id},journal.exportPackage.manifestSha256);
      const bundle=full.manifest.sourceBundles.find(row=>row.manifestSha256===journal.sourceEditions.unassigned.manifestSha256),
        original=bundle.files.find(row=>row.sha256===journal.sourceEditions.unassigned.sha256);
      const downloaded=await downloadOriginal(receiver.url,{kind:'operation',id:received.id},full.manifestSha256,bundle,original,'RECEIVED_UNASSIGNED_OPERATING_RESULT.json');
      journal.receivingCase={id:opened.case.id,importedRevision:opened.importedRevision,revision:opened.case.revision,
        operationId:received.id,sourceDirectory:opened.sourceDirectory,sourceCase:opened.sourceCase};await save();
      await chooseOperation(receiver.url,received.id);
      const openPromise=page.waitForResponse(response=>response.request().method()==='POST'&&
        new URL(response.url()).pathname===API+'/operations/'+received.id+'/open').then(async response=>{
          const result=await response.json();assert.equal(response.status(),200);return result;});
      await page.locator('#cp-open-received').click();const browserOpen=await openPromise;
      assert.equal(browserOpen.case.id,opened.case.id);
      await until(()=>page.locator('#case-status').textContent(),text=>text?.includes(opened.case.id),'original browser received case');
      await screen('06-received-case-and-all-native-sources');
      await page.setViewportSize({width:390,height:844});await page.locator('#case-packages').scrollIntoViewIfNeeded();
      await screen('07-complete-case-package-mobile');
      const viewport=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
      assert(viewport.scroll<=viewport.width+1,'The complete package workspace must fit the mobile viewport');
      await page.setViewportSize({width:1440,height:1080});
      return {input:copy(journal.folderInput),inspection:completedInspection.id,receivingOperation:received.id,
        receivingCase:copy(journal.receivingCase),nativeSourceBundles:receipt.sourceBundles.length,
        sourceFilesVerified:receipt.sourceFilesVerified,preservedOriginalRevisions:receipt.originalCaseHistory.revisions,
        originalDownloaded:downloaded,mobile:viewport};
    });

    const mcpTokenEnv='SCF_COMPLETE_CASE_PACKAGE_NATIVE_TOKEN';
    const mcpEnvironment={...env,[mcpTokenEnv]:'scf-package-'+randomUUID()+'-'+randomUUID()};
    const handoffAlias='original-case-package',handoffConfigPath=join(paths.mcp,'original-package-sources.json');
    async function ensureMcpSource(){
      if(mcpSender&&!owners.find(row=>row.owner===mcpSender)?.closed)return mcpSender;
      // Release the browser owner before opening the same source directory in
      // the original installed MCP owner.
      await closeOwner(sender);sender=null;
      const [{initReleaseStore,readReleaseState},{readMerchantConfig},{startMerchantMcp}]=await Promise.all([
        import(pathToFileURL(join(source,'stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).href),
        import(pathToFileURL(join(source,'stellar-forge/mcp-merchant-operator/config.mjs')).href),
        import(pathToFileURL(join(source,'stellar-forge/mcp-merchant-operator/serve.mjs')).href)]);
      const rootMcp=await privateDirectory(join(paths.mcp,'source')),releaseStore=join(rootMcp,'releases'),
        exportsDirectory=await privateDirectory(join(rootMcp,'support-exports'));
      try{await readReleaseState(releaseStore);}catch(error){if(error.code!=='ENOENT')throw error;await initReleaseStore(releaseStore);}
      const connection=join(rootMcp,'support-connection.json'),configuration=join(rootMcp,'merchant-mcp.json');
      await retain(connection,json({schema:'stellar-forge.merchant-support-connection.v1',casesDirectory:paths.senderCases,
        sourceDirectory:paths.senderSources,packagesDirectory:paths.senderPackages}));
      await retain(configuration,json({schema:'stellar-forge.merchant-mcp.v1',name:'Complete original case package source',
        releaseStore,exportsDirectory,sources:{},supportConnection:connection}));
      await readMerchantConfig(configuration);
      let old;try{old=JSON.parse(await bytes(handoffConfigPath,65000));}catch(error){if(error.code!=='ENOENT')throw error;}
      const originalEndpoint=old?.sources?.[handoffAlias]?.url;
      mcpSender=await startMerchantMcp({configPath:configuration,port:originalEndpoint?Number(new URL(originalEndpoint).port):0,
        tokenEnv:mcpTokenEnv,environment:mcpEnvironment});
      owners.push({name:'installed-original-case-package-mcp',owner:mcpSender,closed:false});
      const endpoint=mcpSender.url.replace(/\/$/,'')+'/mcp';
      if(originalEndpoint)assert.equal(endpoint,originalEndpoint,'Reopen the same configured original source endpoint');
      else{
        await privateDirectory(join(paths.mcp,'original-downloads'));
        await retain(handoffConfigPath,json({schema:'stellar-forge.support-handoff-sources.v1',sources:{
          [handoffAlias]:{label:'Original complete case, history and source bundles',url:endpoint,
            tokenEnv:mcpTokenEnv,directory:join(paths.mcp,'original-downloads')}}}));
      }
      journal.mcpSource={configuration,connection,endpoint,handoffConfigPath,alias:handoffAlias};await save();
      return mcpSender;
    }
    async function rpc(owner,method,params){
      const request={jsonrpc:'2.0',id:randomUUID(),method,params};
      const {MCP_VERSION}=await import(pathToFileURL(join(source,'stellar-forge/mcp-paid-agent/http-tools.mjs')).href);
      const endpoint=owner.url.replace(/\/$/,'')+'/mcp',response=await fetch(endpoint,{method:'POST',
        headers:{'content-type':'application/json','mcp-protocol-version':MCP_VERSION,authorization:'Bearer '+mcpEnvironment[mcpTokenEnv]},
        body:JSON.stringify(request),signal:AbortSignal.timeout(300000)});
      const raw=Buffer.from(await response.arrayBuffer());assert.equal(response.status,200,'Original installed MCP transport');
      let result;try{result=JSON.parse(raw.toString('utf8'));}catch{throw fault('Original MCP returned non-JSON');}
      assert.equal(result.id,request.id);if(result.error)throw Object.assign(fault(result.error.message,'ORIGINAL_MCP_ERROR'),{result});
      return result.result;
    }
    async function callMcp(owner,name,args){return decodeTool(await rpc(owner,'tools/call',{name,arguments:args}));}
    async function ensureRemote(){
      if(remote&&!owners.find(row=>row.owner===remote)?.closed)return remote;
      // The configured original endpoint is retained on disk even after the
      // source listener closes; offline reopen uses its existing checkpoint.
      assert(journal.mcpSource);
      remote=await startDesk('original-handoffs-complete-package-receiver',{casesDir:paths.remoteCases,
        sourceDir:paths.remoteSources,packageDir:paths.remotePackages,handoffSources:handoffConfigPath,environment:mcpEnvironment});
      return remote;
    }
    async function readMcpFile(owner,args,{chunk=65536,exerciseReopen=false}={}){
      let offset=0,readId,parts=[],last,reopened=false;
      for(;;){
        const result=await callMcp(owner,'merchant_case_package_export_file',{...args,offset,limit:chunk,...(readId?{readId}:{})});
        assert.equal(result.offset,offset);assert.equal(result.file.sha256,args.expectedSha256);
        const part=Buffer.from(result.data,'base64');assert.equal(part.length,result.bytesRead);parts.push(part);
        offset+=part.length;last=result;
        if(result.nextOffset===null)break;
        assert.equal(result.nextOffset,offset);readId=result.readId;
        if(exerciseReopen&&!reopened){
          await callMcp(owner,'merchant_case_package_export_file_release',{exportId:args.exportId,readId});
          readId=undefined;reopened=true;
        }
      }
      const value=Buffer.concat(parts);assert.equal(value.length,last.file.bytes);assert.equal(sha(value),args.expectedSha256);
      return {value,bytes:value.length,sha256:sha(value),reopened,readId:last.readId};
    }
    await stage('installed_mcp_catalog_export_and_original_leased_files',async()=>{
      await ensureMcpSource();
      const list=await rpc(mcpSender,'tools/list',{}),names=list.tools.map(tool=>tool.name);
      const packageNames=names.filter(name=>name.startsWith('merchant_case_package_'));
      assert.equal(packageNames.length,16);assert(names.includes('merchant_case_implementation_read'));
      const catalog=await callMcp(mcpSender,'merchant_case_package_catalog',{});
      assert.equal(catalog.directory,paths.senderPackages);assert.equal(catalog.sourceDirectory,paths.senderSources);
      const selected=await senderStore.read(binding.caseId,journal.exportSelection.revision),exportId=id('installed-mcp-export'),
        body={id:exportId,kind:'export',actor,caseId:selected.id,revision:selected.revision};
      journal.requests.mcpExport??={body,preparedAt:now()};assert.deepEqual(journal.requests.mcpExport.body,body);await save();
      const prepared=await callMcp(mcpSender,'merchant_case_package_prepare',body);
      assert.equal(prepared.id,exportId);
      await callMcp(mcpSender,'merchant_case_package_run',{id:exportId});
      const completed=await until(()=>callMcp(mcpSender,'merchant_case_package_status',{id:exportId}),value=>{
        if(value.state==='NEEDS_CONTINUATION'&&!value.runningHere)throw Object.assign(fault('Installed MCP export needs its original continuation'),{result:value});
        return value.state==='COMPLETE'&&!value.runningHere;},'installed MCP full export',{timeout:600000});
      journal.requests.mcpExport.result=completed;await save();
      const descriptor=await callMcp(mcpSender,'merchant_case_package_export_manifest',{exportId});
      const manifestRead=await readMcpFile(mcpSender,{exportId,file:'case-source-package.json',
        expectedManifestSha256:descriptor.manifestSha256,expectedSha256:descriptor.manifestSha256},
        {chunk:1024,exerciseReopen:true});
      const manifest=JSON.parse(manifestRead.value);
      assert.equal(manifestRead.bytes,descriptor.manifestFile.bytes);
      assert(manifestRead.reopened,'An original file can continue from its exact SHA and offset after lease release');
      const fullDirectory=join(paths.senderPackages,'operations',exportId,'package');
      const full=await verifyPortable(fullDirectory,descriptor.manifestSha256);
      assert.equal(full.manifest.sourceBundles.length,journal.exportPackage.sourceBundles.length);
      for(const revision of journal.exportPackage.caseHistory)assert(full.manifest.caseHistory.revisions.some(row=>row.revision===revision));
      const nativeFile=full.manifest.sourceBundles.find(row=>row.manifestSha256===journal.sourceEditions.unassigned.manifestSha256).archive;
      const first=await callMcp(mcpSender,'merchant_case_package_export_file',{exportId,file:nativeFile.name,
        expectedManifestSha256:descriptor.manifestSha256,expectedSha256:nativeFile.sha256,offset:0,limit:4096});
      assert.equal(first.file.sha256,nativeFile.sha256);assert.equal(String(first.file.bytes),String(nativeFile.bytes));
      assert.equal(first.offset,0);assert.equal(first.bytesRead,Math.min(4096,Number(nativeFile.bytes)));
      if(first.nextOffset!==null)await callMcp(mcpSender,'merchant_case_package_export_file_release',{exportId,readId:first.readId});
      await retain(join(paths.output,'INSTALLED_MCP_COMPLETE_MANIFEST.json'),manifestRead.value);
      journal.mcpExport={exportId,directory:fullDirectory,manifestSha256:descriptor.manifestSha256,
        caseRevision:selected.revision,files:manifest.files.length,nativeSourceBundles:manifest.sourceBundles.length};await save();
      return {source:copy(journal.mcpSource),export:copy(journal.mcpExport),installedTools:packageNames,
        immutableManifestLeaseReopened:manifestRead.reopened,originalArchiveFirstRange:{name:nativeFile.name,
          bytes:first.bytesRead,total:first.file.bytes,sha256:first.file.sha256}};
    });
    if(!journal.stages.remote_native_package_receive_and_offline_reopen)await ensureMcpSource();
    // The same original configured source is consumed by the existing Handoffs
    // client; its full native archives use the SF49 receiver.
    await ensureRemote();
    await stage('remote_native_package_receive_and_offline_reopen',async()=>{
      await page.goto(remote.url,{waitUntil:'domcontentloaded'});
      await until(()=>page.locator('#case-packages .cp-desk').getAttribute('data-busy'),value=>value==='false','remote package receiving desk');
      await page.locator('#cp-actor').fill(actor);await page.locator('#cp-remote-profile').selectOption(handoffAlias);
      await page.locator('#cp-remote-export').fill(journal.mcpExport.exportId);await page.locator('#cp-remote-id').fill(id('remote-receiving'));
      await page.locator('#cp-remote-inspect').click();
      await until(()=>page.locator('#cp-remote-receive').isEnabled(),Boolean,'exact original remote manifest');
      const received=await browserOperation('remoteReceiving',()=>page.locator('#cp-remote-receive').click());
      assert.equal(received.request.profile,handoffAlias);assert.equal(received.request.exportId,journal.mcpExport.exportId);
      assert.equal(received.request.manifestSha256,journal.mcpExport.manifestSha256);
      const finished=await settled(remote.url,received.id),receipt=finished.result.receiving;
      assert.equal(receipt.manifestSha256,journal.mcpExport.manifestSha256);
      assert.equal(receipt.sourceDirectory,paths.remoteSources);
      assert.equal(receipt.sourceBundles.length,journal.mcpExport.nativeSourceBundles);
      const downloaded=await verifyPortable(join(paths.remotePackages,'operations',received.id,'download'),journal.mcpExport.manifestSha256);
      const opened=await http(remote.url,API+'/operations/'+received.id+'/open',{method:'POST',body:{}});
      const sourceRecord=await senderStore.read(binding.caseId,journal.mcpExport.caseRevision),
        imported=await remoteStore.read(opened.case.id,opened.importedRevision);
      assert.equal(imported.workspaceText,sourceRecord.workspaceText);assert.equal(imported.supportText,sourceRecord.supportText);
      const sourceEndpoint=journal.mcpSource.endpoint;await closeOwner(mcpSender);mcpSender=null;
      journal.originalSourceClosed={at:now(),endpoint:sourceEndpoint,beforeEditedReopen:true};await save();
      await chooseOperation(remote.url,received.id);
      const browserOpen=page.waitForResponse(response=>response.request().method()==='POST'&&
        new URL(response.url()).pathname===API+'/operations/'+received.id+'/open').then(async response=>{
          const result=await response.json();assert.equal(response.status(),200);return result;});
      await page.locator('#cp-open-received').click();assert.equal((await browserOpen).case.id,opened.case.id);
      await until(()=>page.locator('#case-status').textContent(),text=>text?.includes(opened.case.id),'remote original case open offline');
      await screen('08-original-mcp-received-case-source-offline');
      journal.remoteReceiving={operationId:received.id,caseId:opened.case.id,importedRevision:opened.importedRevision,
        revision:opened.case.revision,manifestSha256:journal.mcpExport.manifestSha256,
        sourceDirectory:opened.sourceDirectory,packageDirectory:join(paths.remotePackages,'operations',received.id,'download')};await save();
      const beforeEdit=await remoteStore.read(opened.case.id);
      journal.receivingNote??={at:now(),body:'Complete case/source package '+journal.mcpExport.exportId+
        ' received through the original installed MCP and native Handoffs/SF49 receivers; source listener closed before this receiving observation.'};
      journal.requests.receivingNote??={id:beforeEdit.id,expectedRevision:beforeEdit.revision,
        workspaceText:beforeEdit.workspaceText,supportText:beforeEdit.supportText,
        metadata:{...beforeEdit.metadata,notes:[beforeEdit.metadata.notes,journal.receivingNote.body].filter(Boolean).join('\n\n')}};await save();
      let edited;
      if(journal.requests.receivingNote.result)edited=await remoteStore.read(beforeEdit.id,journal.requests.receivingNote.result.revision);
      else{const result=await remoteStore.save(journal.requests.receivingNote);edited=await remoteStore.read(result.case.id,result.case.revision);
        journal.requests.receivingNote.result={id:edited.id,revision:edited.revision};await save();}
      const oldUrl=remote.url;await closeOwner(remote);remote=null;await ensureRemote();
      await http(remote.url,API+'/operations/'+received.id+'/run',{method:'POST',body:{}});
      const completed=await settled(remote.url,received.id),reopened=await http(remote.url,API+'/operations/'+received.id+'/open',{method:'POST',body:{}});
      assert.equal(completed.request.createdAt,finished.request.createdAt);
      assert.equal(reopened.case.id,opened.case.id);assert.equal(reopened.case.revision,edited.revision,'Completed receive keeps later legitimate edits');
      const current=await remoteStore.read(reopened.case.id);assert.deepEqual(current.metadata,edited.metadata);
      const bundle=downloaded.manifest.sourceBundles.find(row=>row.manifestSha256===journal.sourceEditions.unassigned.manifestSha256),
        member=bundle.files.find(row=>row.sha256===journal.sourceEditions.unassigned.sha256);
      const original=await downloadOriginal(remote.url,{kind:'operation',id:received.id},journal.mcpExport.manifestSha256,bundle,member,
        'MCP_RECEIVED_UNASSIGNED_OPERATING_RESULT.json');
      journal.remoteReceiving.revision=current.revision;journal.remoteReceiving.editedReopen={at:now(),previousUrl:oldUrl,currentUrl:remote.url,
        revision:current.revision,sourceOffline:true};await save();
      await openCase(remote,remoteStore,current.id);await screen('09-same-edited-case-native-offline-reopen');
      return {operationId:received.id,case:copy(journal.remoteReceiving),sourceClosed:copy(journal.originalSourceClosed),
        fullHistory:receipt.originalCaseHistory.revisions,sourceBundles:receipt.sourceBundles.length,
        sourceFilesVerified:receipt.sourceFilesVerified,offlineOriginal:original};
    });

    await stage('original_cli_final_complete_case_and_receiving_delivery',async()=>{
      const selected=await remoteStore.read(journal.remoteReceiving.caseId);
      assert.equal(selected.revision,journal.remoteReceiving.revision);
      const previous=journal.finalPackage;
      const finalSelection={caseId:selected.id,revision:selected.revision,exportId:id('final-complete-case'),
        directory:join(paths.output,'Complete_Received_Case_And_All_Sources')};
      if(previous)assert.deepEqual(previous.selection,finalSelection);else{journal.finalPackage={selection:finalSelection};await save();}
      await closeOwner(remote);remote=null;
      const result=await runCommand('final-complete-case-export',[join(source,P,'commissioning-cli.mjs'),'export',
        '--cases-dir',paths.remoteCases,'--source-dir',paths.remoteSources,'--case',finalSelection.caseId,
        '--revision',finalSelection.revision,'--out',finalSelection.directory,'--export-id',finalSelection.exportId,'--python',python]);
      assert.equal(result.caseSource.state,'COMPLETE');
      const verified=await verifyPortable(finalSelection.directory,result.caseSource.manifestSha256);
      const workspace=await parseWorkspace(selected.workspaceText),full=commissioning.commissioningSourceBundles(workspace.commissioning);
      assert.equal(verified.manifest.sourceBundles.length,full.length);
      for(const original of full){
        const preserved=verified.manifest.sourceBundles.find(row=>row.bundleId===original.bundleId&&row.manifestSha256===original.manifestSha256);
        assert(preserved);assert.equal(preserved.files.length,original.files.length);
        for(const member of original.files){const actual=preserved.files.find(row=>row.path===member.path);assert(actual);
          assert.equal(actual.role,member.role);assert.equal(String(actual.bytes),String(member.bytes));assert.equal(actual.sha256,member.sha256);}
      }
      const history=await allHistory(remoteStore,selected.id);
      for(const row of history)assert(verified.manifest.caseHistory.revisions.some(original=>original.revision===row.revision));
      const senderHistory=await allHistory(senderStore,binding.caseId);
      for(const revision of journal.originalHistory)assert(senderHistory.some(row=>row.revision===revision));
      const baselineCurrent=await bytes(baselinePath,64*1024*1024);assert(baselineCurrent.equals(baselineBytes),'The accepted original baseline result stays byte-identical');
      journal.finalPackage={selection:finalSelection,manifestSha256:verified.manifestSha256,files:verified.members,
        bytes:verified.bytes,caseHistory:history.map(row=>row.revision),sourceBundles:verified.manifest.sourceBundles.map(({manifestText,...row})=>row)};
      await save();
      await ensureRemote();await openCase(remote,remoteStore,selected.id);
      await page.getByRole('tab',{name:'Receiving and MCP',exact:true}).click();
      await screen('10-independent-receiving-paths-and-installed-mcp');
      const report=[
        '# Complete case and source package receiving',
        '',
        'Operation: '+operationId,
        '',
        'Receiving operator: '+actor,
        '',
        '## Actual completed case',
        '',
        '- Original completed Support continuation: '+binding.operationId,
        '- Its exact result SHA-256: '+binding.journalSha256,
        '- Original completed receiving case: '+binding.caseId,
        '- Original continuation revision: '+binding.finalRevision,
        '- Browser package receiving case: '+journal.receivingCase.id,
        '- Installed MCP receiving case: '+selected.id,
        '- Current received revision: '+selected.revision,
        '- Final complete manifest SHA-256: '+verified.manifestSha256,
        '',
        '## Operated workflow',
        '',
        'The original saved Support case was continued with two native SF49 source editions. Both selections used the same retained case revision and carried different original operating artifacts. The complete operating result was retained as an unassigned source attachment. Every original source member and manifest remained attached to its immutable edition.',
        '',
        'The browser exported the complete case and all retained source bundles. Its actual accepted export response was interrupted at the browser. The browser retained the original request and reconciled the same operation ID and body. The complete folder was then uploaded and inspected through the original streaming receiver, received into a fresh Case desk, and opened with the full original sender history preserved.',
        '',
        'The installed Merchant MCP exposed the complete package tools, exported the selected case, and served its exact manifest and native archive through the original descriptor reader. An original file read resumed from the same SHA and offset after release. The existing Handoffs transport received that entire package, reopened the case and registered every native source archive in the original SF49 receiving service.',
        '',
        'The source listener closed before the receiving observation. The receiving case was edited, its host closed and reopened, and the completed original operation was resumed while the source remained offline. Its same case identity and later receiving edit remained current. The final original CLI export now contains '+verified.members+' original members and '+full.length+' complete native source bundles.',
        '',
        '## Retained packages and original histories',
        '',
        '- First browser export: '+relative(root,journal.exportPackage.directory).split(sep).join('/'),
        '- Installed MCP export: '+relative(root,journal.mcpExport.directory).split(sep).join('/'),
        '- Complete downloaded original: '+relative(root,journal.remoteReceiving.packageDirectory).split(sep).join('/'),
        '- Final received case and all sources: '+relative(root,finalSelection.directory).split(sep).join('/'),
        '- Current independent Case store: '+relative(root,paths.remoteCases).split(sep).join('/'),
        '- Current independent source service: '+relative(root,paths.remoteSources).split(sep).join('/'),
        '- Current original receiving operations: '+relative(root,paths.remotePackages).split(sep).join('/'),
        '',
        'The incoming package retains the complete original sender case store. The final outgoing package retains the received case’s own history and every original source edition. Keep both with the actual receiving journals when transferring this operated workspace.',
        '',
        '## Open the received workspace',
        '',
        'Extract the complete stopped-workspace delivery, then change to its root containing OPEN.md and source/. Use the selected distribution and an existing Node/Python runtime:',
        '',
        '    export SCF_DELIVERY_ROOT="$(pwd)"',
        '    export SCF_PYTHON="$(command -v python3)"',
        '    node "$SCF_DELIVERY_ROOT/source/'+P+'/server.mjs"'+
          ' --cases-dir "$SCF_DELIVERY_ROOT/case-package-continuation/native/'+relative(root,paths.remoteCases).split(sep).join('/')+'"'+
          ' --source-dir "$SCF_DELIVERY_ROOT/case-package-continuation/native/'+relative(root,paths.remoteSources).split(sep).join('/')+'"'+
          ' --package-dir "$SCF_DELIVERY_ROOT/case-package-continuation/native/'+relative(root,paths.remotePackages).split(sep).join('/')+'" --port 8784',
        '',
        'Set SCF_PYTHON to the receiving machine’s installed Python executable if python3 resolves elsewhere. The case-package paths in this guide are relative to case-package-continuation/native/ within that extracted delivery. The native JSON retains the original observed absolute paths. Open the loopback URL returned by this original host, then select case '+selected.id+'. Its completed local package operations and source files reopen without the former source listener.',
        '',
        'For another independent receiver, use the actual final package above with the original commissioning-cli.mjs receive-package command, a new private receiving directory, the exact manifest SHA-256, and its existing case/source directories. Installed MCP uses the same casesDirectory, sourceDirectory and packagesDirectory in its private Support connection.',
        '',
        'Screens and original command outputs are retained alongside case-package-operation.json. That result names the exact installed source map, every completed stage and the final owner shutdown.',
        ''
      ].join('\n');
      await retain(join(paths.output,'COMPLETE_CASE_PACKAGE_RECEIVING.md'),report);
      const resultView={schema:'stellar-forge.case-package-receiving-delivery.v1',operationId,operator:actor,baseline:binding,
        browserReceiving:journal.receivingCase,installedMcpReceiving:journal.remoteReceiving,finalPackage:journal.finalPackage,
        sourceMapSha256:journal.sourceMapSha256,generatedAt:journal.receivingNote.at};
      await retain(join(paths.output,'COMPLETE_CASE_PACKAGE_RECEIVING.json'),json(resultView));
      assert.equal(journal.browserErrors.length,0,'The connected original browser workflow completed without JavaScript errors');
      return {receivingCase:{id:selected.id,revision:selected.revision},finalPackage:copy(journal.finalPackage),
        originalSenderRevisions:senderHistory.length,receivedRevisions:history.length,
        sourceBundles:full.length,browserErrors:journal.browserErrors.length};
    });
    journal.state='operated';delete journal.activeStage;await save();
  }catch(error){
    journal.state='failed';journal.error={at:now(),stage:journal.activeStage??null,code:error.code??error.name,
      message:error.message,stack:error.stack??null,...(error.result?{originalResult:error.result}:{})};
    await save();
  }finally{
    const closure=[];
    for(const [name,owner]of [['browser-context',context],['browser',browser]]){
      if(!owner)continue;
      try{await owner.close();closure.push({name,status:'closed'});}catch(error){closure.push({name,status:'error',message:error.message});}
    }
    for(const entry of [...owners].reverse()){
      if(entry.closed){closure.push({name:entry.name,status:'closed'});continue;}
      try{await closeOwner(entry.owner);closure.push({name:entry.name,status:'closed'});}
      catch(error){closure.push({name:entry.name,status:'error',message:error.message});}
    }
    for(const child of children){
      try{
        if(child.exitCode===null&&child.signalCode===null){
          child.kill('SIGTERM');await new Promise(done=>{
            const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
            child.once('close',()=>{clearTimeout(timer);done();});
          });
        }
        closure.push({name:'original-cli-child',status:'closed'});children.delete(child);
      }catch(error){closure.push({name:'original-cli-child',status:'error',message:error.message});}
    }
    journal.resources={closed:closure.every(row=>row.status==='closed'),
      browserClosed:closure.filter(row=>row.name==='browser-context'||row.name==='browser').every(row=>row.status==='closed'),
      serversClosed:closure.filter(row=>row.name!=='browser-context'&&row.name!=='browser'&&row.name!=='original-cli-child').every(row=>row.status==='closed'),
      workersClosed:children.size===0&&owners.every(row=>row.closed),observedAt:now(),owners:closure};
    if(journal.resources.closed&&journal.resources.workersClosed&&journal.state==='operated'){
      journal.state='completed';journal.completedAt=now();
    }else if(!journal.resources.closed||!journal.resources.workersClosed){
      journal.state='failed';journal.error??={at:now(),stage:'original-owner-shutdown',code:'NATIVE_SHUTDOWN_INCOMPLETE',
        message:'The original owners have not all closed.'};
    }
    try{journal.artifacts=await inventory(paths.output);journal.screenshots=await inventory(paths.screens);}
    catch(error){journal.state='failed';journal.error??={at:now(),stage:'retained-output-inventory',code:error.code??error.name,message:error.message};}
    await save();
  }
  process.stdout.write(json({schema:SCHEMA,operationId,state:journal.state,result:journalFile,
    receivingCase:journal.remoteReceiving??journal.receivingCase,finalPackage:journal.finalPackage,
    resources:journal.resources}));
  if(journal.state!=='completed'||!journal.resources.closed||!journal.resources.workersClosed)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{
  process.stderr.write(json({error:error.code??'CASE_PACKAGE_NATIVE_FAILED',message:error.message}));process.exitCode=1;
});
