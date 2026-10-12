#!/usr/bin/env node
/**
 * Complete browser receiving over the same completed original 169-record
 * preservation workbench. Provider receiving must finish before this program.
 * It saves an operator review and complete exports through the real UI and cold-reopens
 * the complete downloaded workspace. It does not dispatch a provider action.
 */
import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {createReadStream, constants} from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import {spawn} from "node:child_process";
import {fileURLToPath, pathToFileURL} from "node:url";
import {createRequire} from "node:module";

const HERE=path.dirname(fileURLToPath(import.meta.url));
const SCHEMA="stellar-forge.archivematica-workbench-browser.v1";
const OP="ARCHIVEMATICA-RESEARCH-RECEIVING-6BA15-20261012";
const sha=value=>createHash("sha256").update(value).digest("hex");
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==="object"?
 Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const canonical=value=>JSON.stringify(ordered(value))+"\n";
const utc=()=>new Date().toISOString();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const failure=e=>({name:e.name,message:e.message,stack:e.stack});
function parseArgs(argv){
 const values={}, allowed=new Set(["application","workspace","operation-id","output","browser","playwright-module","python","receiving-result","source-manifest","timeout-ms"]);
 for(let i=0;i<argv.length;i+=2){
  const key=argv[i]?.replace(/^--/,"");
  assert(argv[i]?.startsWith("--")&&allowed.has(key)&&argv[i+1]&&!(key in values),"Invalid or repeated flag: "+argv[i]);
  values[key]=argv[i+1];
 }
 for(const key of ["application","workspace","operation-id","output","receiving-result","source-manifest"])assert(values[key],"Missing --"+key);
 assert.equal(values["operation-id"],OP,"Use the completed original receiving operation.");
 values.timeout=Number(values["timeout-ms"]||600000);
 assert(Number.isSafeInteger(values.timeout)&&values.timeout>=60000&&values.timeout<=1800000);
 return values;
}
async function exists(file){try{await fs.lstat(file);return true;}catch(e){if(e.code==="ENOENT")return false;throw e;}}
async function identity(file){
 const named=await fs.lstat(file);assert(named.isFile()&&!named.isSymbolicLink(),"Expected an original regular file: "+file);
 const handle=await fs.open(file,"r");
 try{
  const before=await handle.stat({bigint:true}), hash=createHash("sha256");let bytes=0;
  for await(const part of createReadStream(file,{fd:handle.fd,autoClose:false,highWaterMark:262144})){hash.update(part);bytes+=part.length;}
  const after=await handle.stat({bigint:true});
  for(const key of ["dev","ino","size","mtimeNs","ctimeNs"])assert.equal(after[key],before[key],"File changed: "+file);
  return {bytes,sha256:hash.digest("hex")};
 }finally{await handle.close();}
}
async function readJson(file){
 const s=await fs.lstat(file);assert(s.isFile()&&!s.isSymbolicLink()&&s.size<=32*1024*1024,"Invalid retained JSON: "+file);
 return JSON.parse(await fs.readFile(file,"utf8"));
}
async function syncDirectory(directory){const h=await fs.open(directory,"r");try{await h.sync();}finally{await h.close();}}
async function publish(file,raw){
 raw=Buffer.isBuffer(raw)?raw:Buffer.from(raw);
 const expected={bytes:raw.length,sha256:sha(raw)};
 if(await exists(file)){assert.deepEqual(await identity(file),expected,"Retained output differs: "+file);return;}
 await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
 const temp=file+".pending-"+randomUUID();let h;
 try{
  h=await fs.open(temp,"wx",0o600);await h.writeFile(raw);await h.sync();await h.close();h=null;
  try{await fs.link(temp,file);}catch(e){if(e.code!=="EEXIST")throw e;assert.deepEqual(await identity(file),expected);}
  await syncDirectory(path.dirname(file));
 }finally{if(h)await h.close().catch(()=>{});await fs.unlink(temp).catch(()=>{});}
}
const publishJson=(file,value)=>publish(file,canonical(value));
async function publishFile(source,target,expected){
 assert.deepEqual(await identity(source),expected);
 const h=await fs.open(source,"r");try{await h.sync();}finally{await h.close();}
 if(await exists(target))assert.deepEqual(await identity(target),expected);
 else {await fs.link(source,target);await syncDirectory(path.dirname(target));}
}
function relative(root,file){
 const value=path.relative(root,file).split(path.sep).join("/");
 assert(value&&!value.startsWith("../")&&!path.isAbsolute(value),"Artifact left the original output.");
 return value;
}
async function bounded(promise,milliseconds,message){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),milliseconds);})]);}
 finally{clearTimeout(timer);}
}
async function command(executable,args,{timeout=180000,cwd,env=process.env,limit=32*1024*1024}={}){
 return await new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{cwd,env,stdio:["ignore","pipe","pipe"]});
  let out=[],err=[],size=0,fault=null;
  const timer=setTimeout(()=>{fault=new Error("Original child exceeded its receiving deadline.");child.kill("SIGTERM");},timeout);
  const hard=setTimeout(()=>{if(child.exitCode===null)child.kill("SIGKILL");},timeout+5000);
  function retain(list,chunk){size+=chunk.length;if(size>limit){fault||=new Error("Original child output limit.");child.kill("SIGTERM");}else list.push(chunk);}
  child.stdout.on("data",x=>retain(out,x));child.stderr.on("data",x=>retain(err,x));child.on("error",e=>{fault=e;});
  child.on("close",(code,signal)=>{
   clearTimeout(timer);clearTimeout(hard);
   const result={code,signal,stdout:Buffer.concat(out).toString("utf8"),stderr:Buffer.concat(err).toString("utf8")};
   if(fault)reject(Object.assign(fault,{result}));
   else if(code!==0)reject(Object.assign(new Error("Original child failed: "+result.stderr.slice(-5000)),{result}));
   else resolve(result);
  });
 });
}
async function browserRuntime(args){
 let entry=args["playwright-module"]||process.env.PLAYWRIGHT_MODULE;
 if(!entry)try{entry=createRequire(import.meta.url).resolve("playwright");}catch{}
 if(!entry&&process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES)try{
  entry=createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,"receiving.cjs")).resolve("playwright");
 }catch{}
 if(!entry){const known="/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";if(await exists(known))entry=known;}
 assert(entry,"Select installed Playwright with --playwright-module. No dependency is installed by this runner.");
 entry=await fs.realpath(path.resolve(entry));
 const imported=await import(pathToFileURL(entry).href), chromium=imported.chromium||imported.default?.chromium;
 assert(chromium?.launch,"The selected module does not expose Playwright Chromium.");
 let executable=args.browser||process.env.PRESERVATION_BROWSER_EXECUTABLE;
 if(!executable)try{const retained=chromium.executablePath();if(await exists(retained))executable=retained;}catch{}
 if(!executable)for(const candidate of [
  "/workspace/scratch/705ebf077387/browser-runtime/chrome-headless-shell-linux64/chrome-headless-shell",
  "/usr/bin/google-chrome","/usr/bin/chromium","/usr/bin/chromium-browser"]){
  if(await exists(candidate)){executable=candidate;break;}
 }
 assert(executable,"Select the existing browser with --browser.");
 executable=await fs.realpath(path.resolve(executable));await fs.access(executable,constants.X_OK);
 let packageFile=path.join(path.dirname(entry),"package.json");
 if(!(await exists(packageFile)))packageFile=path.join(path.dirname(path.dirname(entry)),"package.json");
 const metadata=await readJson(packageFile), version=await command(executable,["--version"],{timeout:15000,limit:65536});
 return {chromium,descriptor:{node:process.version,nodeExecutable:process.execPath,
  playwright:{entry,entryIdentity:await identity(entry),version:metadata.version,package:await identity(packageFile)},
  browser:{executable,...await identity(executable),version:version.stdout.trim()||version.stderr.trim()}}};
}
async function startServer(python,application,workspace,logs,name){
 const out=await fs.open(path.join(logs,name+".stdout.log"),"a",0o600),err=await fs.open(path.join(logs,name+".stderr.log"),"a",0o600);
 const child=spawn(python,["-B",path.join(application,"research/preservation/workbench.py"),"serve","--workspace",workspace,"--port","0"],
  {cwd:application,env:{...process.env,PYTHONDONTWRITEBYTECODE:"1"},stdio:["ignore","pipe","pipe"]});
 let first="",readyResolve,readyReject,ended=false;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const closed=new Promise(resolve=>child.on("close",(code,signal)=>{ended=true;resolve({code,signal});}));
 let stopPromise;
 const writes=[];
 child.stdout.on("data",chunk=>{
  writes.push(out.write(chunk));first+=chunk.toString("utf8");
  if(first.length>65536){readyReject(new Error("Unexpected Workbench startup output."));return;}
  if(first.includes("\n"))try{const value=JSON.parse(first.split("\n")[0]);if(value.url)readyResolve(value);}catch(e){readyReject(e);}
 });
 child.stderr.on("data",chunk=>writes.push(err.write(chunk)));
 child.on("error",readyReject);child.on("close",()=>readyReject(new Error("Workbench ended before startup: "+first.slice(-1000))));
 async function stop(){
  if(stopPromise)return await stopPromise;
  stopPromise=(async()=>{
  if(!ended)child.kill("SIGINT");let result,forced=false;
  try{result=await bounded(closed,30000,"Workbench did not drain.");}
  catch{forced=true;child.kill("SIGTERM");try{result=await bounded(closed,5000,"Workbench did not stop.");}catch{child.kill("SIGKILL");result=await closed;}}
  await Promise.allSettled(writes);await out.sync();await err.sync();await out.close();await err.close();
  assert(!forced,"Workbench needed forced termination; preserve its original operation before continuing.");
  return {...result,forced,pid:child.pid,workspace};
  })();return await stopPromise;
 }
 let startup;
 try{startup=await bounded(ready,30000,"Workbench startup deadline.");assert.equal(startup.workspace,workspace);
  const url=new URL(startup.url);assert.equal(url.protocol,"http:");assert.equal(url.hostname,"127.0.0.1");
 }catch(e){await stop().catch(()=>{});throw e;}
 return {url:startup.url,startup,stop};
}
const escape=value=>String(value??"").replace(/[&<>"']/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]));

async function main(){
 const args=parseArgs(process.argv.slice(2)),startedAt=utc(),instanceId=randomUUID();
 const application=await fs.realpath(path.resolve(args.application)),workspace=await fs.realpath(path.resolve(args.workspace));
 const output=path.resolve(args.output),python=args.python||process.env.PYTHON||"python3";
 assert(output!==workspace&&!output.startsWith(workspace+path.sep),"Keep receiving downloads outside the original workspace.");
 await fs.mkdir(output,{recursive:true,mode:0o700});
 for(const name of ["phases","screenshots","downloads","logs","source","browser-temp","drains"])
  await fs.mkdir(path.join(output,name),{recursive:true,mode:0o700});
 const support=path.join(HERE,"archivematica_browser_support.py");
 const manifestFile=await fs.realpath(path.resolve(args["source-manifest"])),manifest=await readJson(manifestFile);
 assert.equal(manifest.operationId,OP);
 assert(manifest.files&&typeof manifest.files==="object"&&!Array.isArray(manifest.files));
 const required=["preservation.py","workbench.py","workbench.html","workbench.js","WORKBENCH.md",
  "archivematica.py","archivematica_client.py","ARCHIVEMATICA.md","ARCHIVEMATICA_PROVIDER_CONTRACT.md","archivematica-requirements.txt"];
 for(const name of required)assert(manifest.files["research/preservation/"+name],"Missing complete application member: "+name);
 const sourcePins={};
 for(const [name,expected]of Object.entries(manifest.files)){
  assert(!path.isAbsolute(name)&&!name.split("/").some(x=>["",".",".."].includes(x))&&name.startsWith("research/"));
  assert(Number.isSafeInteger(expected.bytes)&&expected.bytes>=0&&/^[0-9a-f]{64}$/.test(expected.sha256));
  sourcePins[name]=await identity(path.join(application,name));
  assert.deepEqual(sourcePins[name],expected,"The selected complete application changed: "+name);
 }
 const receivingFile=await fs.realpath(path.resolve(args["receiving-result"])),receiving=await readJson(receivingFile);
 assert.equal(receiving.status,"PASS");assert.equal(receiving.recordCount,169);assert.equal(receiving.nativeState,"VERIFIED");
 assert.equal(receiving.operationId,OP);assert.equal(path.resolve(receiving.workbenchWorkspace),workspace);
 const input={schema:SCHEMA+".input",operationId:OP,application,workspace,
  sourceManifest:{path:manifestFile,...await identity(manifestFile)},sourcePins,
  receivingResult:{path:receivingFile,...await identity(receivingFile)},
  runner:await identity(fileURLToPath(import.meta.url)),support:await identity(support)};
 const inputSha256=sha(canonical(input));await publishJson(path.join(output,"input.json"),input);
 await publish(path.join(output,"source/run-archivematica-browser.mjs"),await fs.readFile(fileURLToPath(import.meta.url)));
 await publish(path.join(output,"source/archivematica_browser_support.py"),await fs.readFile(support));
 async function inspect(app=application,root=workspace){
  const result=await command(python,["-B",support,"--application",app,"inspect","--workspace",root,"--operation-id",OP]);
  return JSON.parse(result.stdout);
 }
 const baselinePath=path.join(output,"baseline.json");
 const baseline=await exists(baselinePath)?await readJson(baselinePath):await inspect();
 await publishJson(baselinePath,baseline);
 assert.equal(baseline.status.sourceRecords,169);assert.equal(baseline.status.includedRecords,169);
 assert.equal(baseline.progress.state.state,"VERIFIED");assert.equal(baseline.packageId,receiving.packageId);
 assert.equal(path.resolve(baseline.prepared),path.resolve(receiving.preparedWorkspace));
 for(const key of ["transferUuid","sipUuid","aipUuid"])assert.equal(baseline.progress.state[key],receiving[key]);
 assert.equal(baseline.receivingProof.summary.includedRecords,169);
 assert.equal(baseline.receivingProof.aip.allOriginalRecordsVerified,true);
 const finalPath=path.join(output,"browser-result.json"),completionPath=path.join(output,"browser-completion.pending.json");
 async function validateCompleted(result,{pendingPublications=[]}={}){
  assert.equal(result.status,"PASS");assert.equal(result.inputSha256,inputSha256);
  assert.equal(result.operationId,OP);assert.deepEqual(result.source,sourcePins);
  for(const item of result.artifacts){
   if(!pendingPublications.includes(item.path))
    assert.deepEqual(await identity(path.join(output,item.path)),{bytes:item.bytes,sha256:item.sha256});
  }
  for(const name of result.drains){
   const drain=await readJson(path.join(output,name));
   assert.equal(drain.inputSha256,inputSha256);assert.equal(drain.forced,false);
  }
  const current=await inspect();assert.equal(current.preparedInventorySha256,baseline.preparedInventorySha256);
  assert.deepEqual(current.status.review,baseline.status.review);assert.equal(current.status.revision,result.finalRevision);
  const cold=await inspect(result.coldApplication,result.coldWorkspace);
  assert.equal(cold.preparedInventorySha256,baseline.preparedInventorySha256);
  assert.deepEqual(cold.status.review,baseline.status.review);assert.equal(cold.status.revision,result.finalRevision);
 }
 async function finishCompletion(candidate){
  assert.equal(candidate.schema,SCHEMA+".completion");assert.equal(candidate.inputSha256,inputSha256);
  assert.deepEqual(candidate.publications.map(x=>x.path).sort(),["ARCHIVEMATICA_BROWSER_RECEIVING.html","browser-network.json"]);
  for(const item of candidate.publications){
   assert.equal(typeof item.content,"string");
   const row=candidate.result.artifacts.find(x=>x.path===item.path);assert(row);
   assert.deepEqual({bytes:row.bytes,sha256:row.sha256},{bytes:Buffer.byteLength(item.content),sha256:sha(item.content)});
  }
  await validateCompleted(candidate.result,{pendingPublications:candidate.publications.map(x=>x.path)});
  for(const item of candidate.publications)await publish(path.join(output,item.path),item.content);
  await validateCompleted(candidate.result);
  await publishJson(finalPath,candidate.result);
  return candidate.result;
 }
 if(await exists(finalPath)){
  const prior=await readJson(finalPath);await validateCompleted(prior);
  console.log(JSON.stringify({...prior,reused:true}));return;
 }
 if(await exists(completionPath)){
  const prior=await finishCompletion(await readJson(completionPath));
  console.log(JSON.stringify({...prior,reused:true}));return;
 }
 const phases={},screenshots=[],downloads=[],errors=[],requests=[],localFiles=new Set(),origins=new Set();
 async function phase(name,work){
  const file=path.join(output,"phases",name+".json");
  if(await exists(file)){const old=await readJson(file);assert.equal(old.inputSha256,inputSha256);phases[name]=old.result;return old.result;}
  const result=await work();await publishJson(file,{inputSha256,name,completedAt:utc(),result});phases[name]=result;
  console.log(JSON.stringify({phase:name,status:"COMPLETE"}));return result;
 }
 let browser,context,page,server,coldServer;
 async function drainInstance(handle,name){
  const drain={inputSha256,instanceId,...await handle.stop()};
  const receiptPath="drains/"+name+"-"+instanceId+".json";
  await publishJson(path.join(output,receiptPath),drain);
  const originalPath=path.join(output,"drains",name+".json");
  if(await exists(originalPath)){
   const original=await readJson(originalPath);
   assert.equal(original.inputSha256,inputSha256);assert.equal(original.forced,false);
  }else await publishJson(originalPath,drain);
  return {...drain,receiptPath};
 }
 const runtime=await browserRuntime(args);await publishJson(path.join(output,"browser-runtime.json"),runtime.descriptor);
 const deadline=Date.now()+args.timeout;
 async function until(work,message,limit=60000){
  const stop=Math.min(deadline,Date.now()+limit);let last;
  while(Date.now()<stop){try{const value=await work();if(value)return value;}catch(e){last=e;}await sleep(150);}
  throw new Error(message+(last?": "+last.message:""));
 }
 async function api(endpoint){return await page.evaluate(async endpoint=>{
  const response=await fetch(endpoint,{cache:"no-store"}),value=await response.json();
  if(!response.ok)throw new Error(value.message||value.error||String(response.status));return value;
 },endpoint);}
 const state=()=>api("/api/state");
 async function tab(name){await page.locator("#tab-"+name).click();await page.locator("#page-"+name).waitFor({state:"visible"});}
 async function open(url){
  await page.goto(url,{waitUntil:"domcontentloaded"});
  await until(async()=>(await page.locator("#source-count").textContent())==="169","The original 169 records did not appear.");
 }
 async function refresh(){await page.locator("#refresh-state").click();await until(async()=>!(await state()).active,"The original local job did not finish.",240000);}
 async function capture(name,caption,{fullPage=true}={}){
  const file=path.join(output,"screenshots",name+".png"),receipt=file+".json",candidate=file+".candidate.json",temp=file+".pending";
  const selection={inputSha256,name,caption,fullPage};
  async function validate(descriptor){
   assert.deepEqual(descriptor.selection,selection);
   assert.equal(descriptor.path,relative(output,file));
   assert(descriptor.layout.width<=descriptor.layout.viewport.width+2,"Saved page overflow in "+name);
  }
  if(await exists(receipt)){
   const old=await readJson(receipt);await validate(old);
   assert.deepEqual(await identity(file),{bytes:old.bytes,sha256:old.sha256});return old;
  }
  let descriptor;
  if(await exists(candidate)){descriptor=await readJson(candidate);await validate(descriptor);}
  else{
   assert(!(await exists(file)),"The original published screenshot requires its retained candidate.");
   const layout=await page.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight},
    width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}));
   assert(layout.width<=layout.viewport.width+2,"Page overflow in "+name);
   await page.screenshot({path:temp,type:"png",fullPage,animations:"disabled"});
   descriptor={path:relative(output,file),caption,selection,...await identity(temp),layout};
   await publishJson(candidate,descriptor);
  }
  const expected={bytes:descriptor.bytes,sha256:descriptor.sha256};
  if(await exists(file))assert.deepEqual(await identity(file),expected);
  else await publishFile(temp,file,expected);
  await publishJson(receipt,descriptor);
  if(await exists(temp)){assert.deepEqual(await identity(temp),expected);await fs.unlink(temp);}
  return descriptor;
 }
 async function selected(){
  await tab("destinations");await page.locator("#destination-list button").filter({hasText:OP}).click();
  await until(async()=>(await page.locator("#migration-id").textContent())===OP&&
   (await page.locator("#migration-state").textContent())==="VERIFIED","The original receiving operation did not render.");
  const current=await api("/api/migration?id="+encodeURIComponent(OP));
  assert.equal(current.provider,"archivematica");assert.deepEqual(current.selection,baseline.operation.selection);
  assert.deepEqual(current.settings,baseline.operation.settings);assert.deepEqual(current.configuration,baseline.operation.configuration);
  assert.deepEqual(current.progress.state,baseline.progress.state);
  assert.deepEqual(current.progress.operation,baseline.progress.operation);
  assert.equal(await page.locator("#export-archivematica-destination").isVisible(),true);
  assert.equal(await page.locator("#archivematica-decisions").isVisible(),false);
  return {operationId:OP,state:current.progress.state.state,packageId:current.progress.operation.packageId,
   transferUuid:current.progress.state.transferUuid,sipUuid:current.progress.state.sipUuid,aipUuid:current.progress.state.aipUuid};
 }
 async function download(item,label){
  assert(item.available!==false);await tab("delivery");await refresh();
  const name=label+path.extname(item.name),file=path.join(output,"downloads",name);
  if(await exists(file)){assert.deepEqual(await identity(file),{bytes:item.bytes,sha256:item.sha256});return {path:relative(output,file),...item,localPath:relative(output,file)};}
  const wait=page.waitForEvent("download",{timeout:60000});
  await page.locator('a[href="/download?id='+encodeURIComponent(item.id)+'"]').click();
  const transfer=await wait,temp=file+".pending";await transfer.saveAs(temp);
  assert.equal(await transfer.failure(),null);
  await publishFile(temp,file,{bytes:item.bytes,sha256:item.sha256});await fs.unlink(temp);
  return {...item,localPath:relative(output,file)};
 }
 async function completed(id){
  let result=await until(async()=>{const current=await state(),job=current.jobs.find(x=>x.id===id);
   return job&&["COMPLETED","FAILED","INTERRUPTED"].includes(job.state)?job:null;
  },"The selected local export did not complete.",240000);
  if(["FAILED","INTERRUPTED"].includes(result.state)){
   await tab("activity");await refresh();
   const observed=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/recover-export"&&r.request().method()==="POST",{timeout:240000});
   await page.locator('[data-recover-export="'+id+'"]').click();
   const response=await observed,value=await response.json();
   assert.equal(response.status(),200,"Original export recovery failed: "+JSON.stringify(value));
   assert.deepEqual(response.request().postDataJSON(),{jobId:id});
   assert.equal(value.job?.id,id);assert.equal(value.recovered,true);
   result=value.job;
   await publishJson(path.join(output,"phases","export-recovery-"+id+".json"),{inputSha256,jobId:id,result});
  }
  assert.equal(result.state,"COMPLETED","The original local export failed: "+JSON.stringify(result));
  return result;
 }
 async function exportFromUI(name,selector,endpoint,kind,body){
  const intentPath=path.join(output,"phases",name+".intent.json"),responsePath=path.join(output,"phases",name+".response.json");
  let intent;
  if(await exists(intentPath))intent=await readJson(intentPath);
  else{const before=await state();intent={operationId:OP,endpoint,body,kind,previousJobs:before.jobs.map(x=>x.id)};await publishJson(intentPath,intent);}
  assert.deepEqual({endpoint,body,kind},{endpoint:intent.endpoint,body:intent.body,kind:intent.kind});
  let id;
  if(await exists(responsePath))id=(await readJson(responsePath)).id;
  else{
   const current=await state(),matches=current.jobs.filter(x=>!intent.previousJobs.includes(x.id)&&x.kind===kind&&
    JSON.stringify(ordered(x.arguments))===JSON.stringify(ordered(body)));
   assert(matches.length<=1,"Multiple local exports need their exact original job selection.");
   if(matches.length){id=matches[0].id;await publishJson(responsePath,{id,readback:matches[0]});}
   else{
    const response=page.waitForResponse(r=>new URL(r.url()).pathname===endpoint&&r.request().method()==="POST",{timeout:60000});
    await page.locator(selector).click();const observed=await response;assert.equal(observed.status(),202);
    assert.deepEqual(observed.request().postDataJSON(),body);
    const returned=await observed.json();id=returned.job?.id||returned.jobId||returned.id;assert(id);
    await publishJson(responsePath,{id,response:returned});
   }
  }
  const job=await completed(id),artifact=job.result?.artifact;
  assert(artifact&&artifact.id,"Completed export did not retain its artifact.");
  return {jobId:id,artifact};
 }
 async function saveNote(note,revision){
  await tab("records");await page.locator("#review-note").fill(note);
  await until(async()=>!await page.locator("#save-review").isDisabled(),"The operator note did not become editable.");
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/review"&&r.request().method()==="POST",{timeout:60000});
  await page.locator("#save-review").click();const actual=await response;assert.equal(actual.status(),200);
  const body=actual.request().postDataJSON();assert.equal(body.expectedRevision,revision);
  const result=await actual.json();assert.equal(result.status.revision,revision+1);
  await until(async()=>(await state()).status.revision===revision+1&&
   (await page.locator("#save-review").textContent())==="Save review","The saved note did not finish rendering.");
  return {request:body,status:result.status};
 }
 try{
  server=await startServer(python,application,workspace,path.join(output,"logs"),"original-"+instanceId);origins.add(new URL(server.url).origin);
  browser=await runtime.chromium.launch({headless:true,executablePath:runtime.descriptor.browser.executable,
   args:["--no-sandbox","--disable-dev-shm-usage","--renderer-process-limit=1"],
   env:{...process.env,TMPDIR:path.join(output,"browser-temp")}});
  context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,locale:"en-US",timezoneId:"UTC"});
  await context.route("**/*",async route=>{
   const req=route.request(),url=new URL(req.url());
   if(["data:","about:","blob:"].includes(url.protocol)||origins.has(url.origin)||localFiles.has(url.href)){await route.continue();return;}
   errors.push({kind:"unexpected-request",method:req.method(),origin:url.origin,path:url.pathname});await route.abort();
  });
  context.on("page",p=>{
   p.on("pageerror",e=>errors.push({kind:"pageerror",message:e.message}));
   p.on("response",r=>{const url=new URL(r.url());requests.push({method:r.request().method(),origin:url.origin,path:url.pathname,status:r.status()});});
   p.on("dialog",d=>d.accept().catch(()=>{}));
  });
  page=await context.newPage();page.setDefaultTimeout(30000);await open(server.url);
  const first=await phase("01-original-operator",async()=>{
   const current=await state();assert(current.migrations.some(x=>x.id===OP&&x.provider==="archivematica"));
   for(const key of ["roda","preservica","libnova","archivematica"])assert.equal(current.providers[key]?.available,true);
   const overview=await capture("01-overview","The original 169-record research edition and complete installed receiving destinations.");
   const destination=await selected(),screen=await capture("02-destination","The completed original transfer, SIP and AIP with the saved receiving selections.");
   return {overview,destination,screen};
  });screenshots.push(first.overview,first.screen);
  const review=await phase("02-editable-record-review",async()=>{
   await tab("records");await page.locator("#record-query").fill("");
   await until(async()=>await page.locator("#record-rows .record-button").count()===50,"The first full source page did not appear.");
   await page.locator("#next-page").click();
   await until(async()=>(await page.locator("#page-label").textContent()).includes("51"),"The next original source page did not appear.");
   const pageLabel=await page.locator("#page-label").textContent();await page.locator("#previous-page").click();
   const preview=await api("/api/preview"),record=preview.rows[0];assert(record.identifier);
   await page.locator("#record-query").fill("id:"+record.identifier);
   await until(async()=>await page.locator("#record-rows .record-button").count()===1,"The selected source record did not appear.");
   await page.locator("#record-rows .record-button").click();
   await until(async()=>(await page.locator("#record-identity").textContent()).startsWith(record.identifier+"\n"),"The selected source editor did not appear.");
   assert.equal(await page.locator("#record-reason").isEnabled(),true);
   const original=baseline.status.review,note=(original.note||"")+" Browser handover: the receiving engineer opened and saved this complete review.";
   const changed=structuredClone(original);changed.note=note;
   let current=(await state()).status,changedSave=null,restoredSave=null;
   if(current.revision===baseline.status.revision){
    assert.deepEqual(current.review,original);changedSave=await saveNote(note,current.revision);current=changedSave.status;
    await publishJson(path.join(output,"phases","review-note-saved.json"),changedSave);
   }
   if(current.revision===baseline.status.revision+1){
    assert.deepEqual(current.review,changed);restoredSave=await saveNote(original.note||"",current.revision);current=restoredSave.status;
    await publishJson(path.join(output,"phases","review-note-restored.json"),restoredSave);
   }
   assert.equal(current.revision,baseline.status.revision+2);assert.deepEqual(current.review,original);
   assert.equal(current.includedRecords,169);assert.equal(current.excludedRecords,0);
   const screen=await capture("03-records","The original record, metadata editor and saved review history remain editable after receiving.");
   return {identifier:record.identifier,pageLabel,restoredRevision:current.revision,reviewSha256:current.reviewSha256,screen};
  });screenshots.push(review.screen);
  const files=await phase("03-receiving-delivery",async()=>{
   await tab("delivery");await refresh();const current=await state(),results=[];
   for(const kind of ["archivematica-original-bagit","archivematica-source-review","archivematica-receiving-evidence","archivematica-receiving-report"]){
    const matches=current.artifacts.filter(x=>x.kind===kind&&x.operationId===OP);assert.equal(matches.length,1,"Choose the original "+kind);
    results.push(await download(matches[0],kind));
   }
   const evidence=results.find(x=>x.kind==="archivematica-receiving-evidence");
   assert.deepEqual(await readJson(path.join(output,evidence.localPath)),baseline.receivingProof);
   const report=results.find(x=>x.kind==="archivematica-receiving-report");
   assert.deepEqual({bytes:report.bytes,sha256:report.sha256},baseline.receivingReport);
   const screen=await capture("04-delivery","The original BagIt source, source review and complete receiving results are available together.");
   const url=pathToFileURL(path.join(output,report.localPath)).href;localFiles.add(url);
   await page.goto(url,{waitUntil:"domcontentloaded"});assert((await page.locator("body").textContent()).includes(OP));
   const reportScreen=await capture("05-receiving-report","The actual received-edition summary and provider identifiers.",{fullPage:false});
   await open(server.url);return {files:results,screen,reportScreen};
  });screenshots.push(files.screen,files.reportScreen);downloads.push(...files.files);
  const destination=await phase("04-complete-destination-export",async()=>{
   await selected();
   const exported=await exportFromUI("destination-export","#export-archivematica-destination","/api/export-destination",
    "destination-export",{operationId:OP});
   assert.equal(exported.artifact.kind,"archivematica-complete-destination");
   const artifact=await download(exported.artifact,"Archivematica_Complete_Receiving");
   const target=path.join(output,"received-destination");
   const received=JSON.parse((await command(python,["-B",support,"--application",application,"provider-receive",
    "--source",path.join(output,artifact.localPath),"--output",target,"--operation-id",OP],{timeout:300000})).stdout);
   assert.equal(received.progress.state.state,"VERIFIED");assert.deepEqual(received.receivingProof,baseline.receivingProof);
   assert.equal(received.preparedInventorySha256,baseline.preparedInventorySha256);
   return {exported,artifact,received};
  });downloads.push(destination.artifact);
  const complete=await phase("05-complete-workspace-export",async()=>{
   await tab("delivery");
   const exported=await exportFromUI("workspace-export","#export-workspace","/api/export","complete-export",{});
   assert.equal(exported.artifact.kind,"complete-workspace");
   const artifact=await download(exported.artifact,"Research_Preservation_Complete");
   const target=path.join(output,"received-workspace");
   const received=JSON.parse((await command(python,["-B",support,"--application",application,"receive",
    "--source",path.join(output,artifact.localPath),"--output",target],{timeout:300000})).stdout);
   assert.equal(received.manifest.sourceRecords,169);assert.equal(received.manifest.includedRecords,169);
   return {exported,artifact,target,received};
  });downloads.push(complete.artifact);
  const originalDrain=await drainInstance(server,"original");server=null;
  const cold=await phase("06-cold-workspace-browser",async()=>{
   const coldApplication=path.join(complete.target,"application"),coldWorkspace=path.join(complete.target,"workspace");
   const before=await inspect(coldApplication,coldWorkspace);
   assert.equal(before.preparedInventorySha256,baseline.preparedInventorySha256);
   assert.deepEqual(before.status.review,baseline.status.review);assert.equal(before.status.revision,review.restoredRevision);
   for(const name of required)assert.deepEqual(await identity(path.join(coldApplication,"research/preservation",name)),sourcePins["research/preservation/"+name]);
   coldServer=await startServer(python,coldApplication,coldWorkspace,path.join(output,"logs"),"received-"+instanceId);
   origins.add(new URL(coldServer.url).origin);await open(coldServer.url);
   const overview=await capture("06-received-overview","The independently received application opens the same original research edition and saved operation.");
   const destination=await selected();
   await page.setViewportSize({width:860,height:900});
   const narrow=await capture("07-received-destination","The same completed receiving operation opens from the independently received application at a narrower desktop width.");
   await page.setViewportSize({width:1440,height:1000});await tab("records");
   assert.equal(await page.locator("#review-note").isEnabled(),true);
   assert.equal(await page.locator("#review-note").inputValue(),baseline.status.review.note||"");
   const after=await inspect(coldApplication,coldWorkspace);
   assert.equal(after.preparedInventorySha256,baseline.preparedInventorySha256);
   const drain=await drainInstance(coldServer,"received");coldServer=null;
   return {workspace:coldWorkspace,application:coldApplication,destination,overview,narrow,
    reviewRevision:after.status.revision,reviewSha256:after.status.reviewSha256,
    preparedInventorySha256:after.preparedInventorySha256,drain};
  });screenshots.push(cold.overview,cold.narrow);
  await context.close();context=null;await browser.close();browser=null;
  const final=await inspect();
  assert.deepEqual(final.status.review,baseline.status.review);assert.equal(final.status.revision,review.restoredRevision);
  assert.equal(final.preparedInventorySha256,baseline.preparedInventorySha256);
  assert.equal(errors.length,0,JSON.stringify(errors));
  const failed=requests.filter(x=>x.status>=400&&x.path!=="/favicon.ico");assert.equal(failed.length,0,JSON.stringify(failed));
  const providerActions=requests.filter(x=>["/api/run","/api/refresh","/api/decide","/api/reconcile","/api/prepare"].includes(x.path));
  assert.equal(providerActions.length,0,"This browser continuation belongs to the completed original receiving operation.");
  const network=canonical({inputSha256,requests,errors});
  const rows=screenshots.map(x=>"<section><h2>"+escape(x.caption)+"</h2><img src='"+escape(x.path)+"' alt='"+escape(x.caption)+"'><p>"+escape(x.sha256)+"</p></section>").join("");
  const links=downloads.map(x=>"<li><a href='"+escape(x.localPath)+"'>"+escape(path.basename(x.localPath))+"</a> · "+escape(x.bytes)+" bytes</li>").join("");
  const html="<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"+
   "<title>Archivematica operator receiving</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#202020;background:#fff;max-width:1240px;margin:auto;padding:24px}"+
   "h1{font-size:26px}h2{font-size:18px}section{border-top:1px solid #ccc;margin-top:24px;padding-top:18px}img{max-width:100%;border:1px solid #ccc}p,li{overflow-wrap:anywhere}</style>"+
   "<h1>Archivematica operator receiving</h1><p>The same 169-record operation was opened in Chromium, reviewed, downloaded and received into an independently opened editable application.</p>"+
   "<p>Operation: "+escape(OP)+"<br>Transfer: "+escape(receiving.transferUuid)+"<br>SIP: "+escape(receiving.sipUuid)+"<br>AIP: "+escape(receiving.aipUuid)+"</p>"+
   "<h2>Complete receiving files</h2><ul>"+links+"</ul>"+rows+"</html>";
  const publications=[{path:"browser-network.json",content:network},{path:"ARCHIVEMATICA_BROWSER_RECEIVING.html",content:html}];
  const drains=[originalDrain.receiptPath,cold.drain.receiptPath];
  const artifacts=[];
  for(const item of [...screenshots.map(x=>({path:x.path})),...downloads.map(x=>({path:x.localPath})),
   ...drains.map(file=>({path:file})),...Object.keys(phases).map(name=>({path:"phases/"+name+".json"})),
   {path:"browser-runtime.json"},{path:"input.json"},{path:"baseline.json"},
   {path:"source/run-archivematica-browser.mjs"},{path:"source/archivematica_browser_support.py"}]){
   if(!artifacts.some(x=>x.path===item.path))artifacts.push({...item,...await identity(path.join(output,item.path))});
  }
  for(const item of publications)artifacts.push({path:item.path,bytes:Buffer.byteLength(item.content),sha256:sha(item.content)});
  const result={schema:SCHEMA,status:"PASS",operationId:OP,inputSha256,startedAt,completedAt:utc(),
   recordCount:169,nativeState:"VERIFIED",workbenchWorkspace:workspace,preparedWorkspace:baseline.prepared,
   packageId:baseline.packageId,transferUuid:receiving.transferUuid,sipUuid:receiving.sipUuid,aipUuid:receiving.aipUuid,
   finalRevision:final.status.revision,reviewSha256:final.status.reviewSha256,
   preparedInventorySha256:final.preparedInventorySha256,receivingProof:baseline.progress.state.proof,
   phases:Object.keys(phases),screenshots:screenshots.length,downloads:downloads.length,
   browser:runtime.descriptor,receivingResult:input.receivingResult,coldWorkspace:cold.workspace,coldApplication:cold.application,
   artifacts,drains,source:sourcePins};
  const candidate={schema:SCHEMA+".completion",inputSha256,result,publications};
  await publishJson(completionPath,candidate);
  console.log(JSON.stringify(await finishCompletion(candidate)));
 }catch(error){
  await fs.writeFile(path.join(output,"failure-"+Date.now()+".json"),canonical({schema:SCHEMA,status:"FAILED",
   operationId:OP,inputSha256,at:utc(),error:failure(error),completedPhases:Object.keys(phases),errors,requests}),{mode:0o600});
  throw error;
 }finally{
  if(context)await context.close().catch(()=>{});
  if(browser)await browser.close().catch(()=>{});
  if(coldServer)await drainInstance(coldServer,"received").catch(()=>{});
  if(server)await drainInstance(server,"original").catch(()=>{});
 }
}
main().catch(error=>{console.error(JSON.stringify({status:"FAILED",error:failure(error)}));process.exitCode=1;});
