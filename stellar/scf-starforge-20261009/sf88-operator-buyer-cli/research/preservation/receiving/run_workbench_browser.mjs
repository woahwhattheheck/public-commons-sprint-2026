#!/usr/bin/env node
/**
 * Complete browser receiving over the same completed original 169-record
 * preservation workbench. Provider receiving must finish before this program.
 * It makes review/package/export changes through the real UI and cold-reopens
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
const SCHEMA="stellar-forge.preservation-workbench-browser.v1";
const OP="preservica-original-169-local-receiving-20261012";
const COMMIT="67556acb5d51a7626e1a6e49c6795ee6e67144c2";
const PINS={
 "research/oai/oai_feed.py": "82c6f4e0958e3a0518953abc91ab100eaa4da884066efb186fcf22a1b0a385f7",
 "research/preservation/cli.mjs": "b932fdfdd5c51918ca3b65950641acca56b63a46f4a003e77c5a432bb1535d07",
 "research/preservation/preservation.py": "be09a866bb006d746995a5aaa7458229d6d7df811291c9c8dfd5b4e4ffcf5792",
 "research/preservation/preservica_client.py": "3d80af585964c8b42ef47757a58fefbe9ca717d0d0f2a22c6a83656b04454a7f",
 "research/preservation/PRESERVICA_PROVIDER_CONTRACT.md": "6e6ef7a0881d40dcbfea11580a62f7782d83da2d3f30a1484f543ccdacae1c0b",
 "research/preservation/PRESERVICA.md": "848cb720e21e31a328b234e15fb643ddcb8f1df13e106852e72f0435564d8623",
 "research/preservation/preservica.py": "131cb2b636e464b41867cf4ab4f38d02e599baa51e4350c180e9c1e6d6b284f9",
 "research/preservation/README.md": "b6cceb0982d65dcfb0e3487c0ac5a3d3d801aa0a5e5da9afd3e758cfa509b8e4",
 "research/preservation/roda_client.py": "576e23497cad37c683f1d074a24bc386d3aa77d2c4f801cd20e30dbbeac1af83",
 "research/preservation/RODA_REST.md": "9bef56ef143bd02bb6dcd8f07de955129a8148975c14d9fa22e72596f2438985",
 "research/preservation/RODA.md": "b2cc5ebb804df740ee9e21263914c49bdf78d322deb08686e647ac3fa68d7806",
 "research/preservation/roda.py": "05ea790873d6c68557a16cdbba26550582da937f2b59af3c8c544d19a917b8fc",
 "research/preservation/workbench.html": "2e8fea41b59d39f6b7a1e52011632085b13c1901d453ba6af655e4d005e79cb3",
 "research/preservation/workbench.js": "41cdf73cdb7a0d0ee9c26bd240cc31aa5757a86dd5bdd66950e7200d2633e86e",
 "research/preservation/WORKBENCH.md": "35c57af25d58b15f32a2061149e199e0ed3685d3b639ee836d3e3de182a5fc5a",
 "research/preservation/workbench.py": "e704d33e4d439d25aae01239c2e46717d41f82b3bb605d30ba8c760a9df73b19"
};
const sha=value=>createHash("sha256").update(value).digest("hex");
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==="object"?
 Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const canonical=value=>JSON.stringify(ordered(value))+"\n";
const utc=()=>new Date().toISOString();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const failure=e=>({name:e.name,message:e.message,stack:e.stack});
function parseArgs(argv){
 const values={}, allowed=new Set(["application","workspace","operation-id","output","browser","playwright-module","python","receiving-result","timeout-ms"]);
 for(let i=0;i<argv.length;i+=2){
  const key=argv[i]?.replace(/^--/,"");
  assert(argv[i]?.startsWith("--")&&allowed.has(key)&&argv[i+1]&&!(key in values),"Invalid or repeated flag: "+argv[i]);
  values[key]=argv[i+1];
 }
 for(const key of ["application","workspace","operation-id","output"])assert(values[key],"Missing --"+key);
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
 if(!entry){const known="/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";if(await exists(known))entry=known;}
 assert(entry,"Select installed Playwright with --playwright-module. No dependency is installed by this runner.");
 entry=await fs.realpath(path.resolve(entry));
 const imported=await import(pathToFileURL(entry).href), chromium=imported.chromium||imported.default?.chromium;
 assert(chromium?.launch,"The selected module does not expose Playwright Chromium.");
 let executable=args.browser||process.env.PRESERVATION_BROWSER_EXECUTABLE;
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
 const writes=[];
 child.stdout.on("data",chunk=>{
  writes.push(out.write(chunk));first+=chunk.toString("utf8");
  if(first.length>65536){readyReject(new Error("Unexpected Workbench startup output."));return;}
  if(first.includes("\n"))try{const value=JSON.parse(first.split("\n")[0]);if(value.url)readyResolve(value);}catch(e){readyReject(e);}
 });
 child.stderr.on("data",chunk=>writes.push(err.write(chunk)));
 child.on("error",readyReject);child.on("close",()=>readyReject(new Error("Workbench ended before startup: "+first.slice(-1000))));
 async function stop(){
  if(!ended)child.kill("SIGINT");let result,forced=false;
  try{result=await bounded(closed,30000,"Workbench did not drain.");}
  catch{forced=true;child.kill("SIGTERM");try{result=await bounded(closed,5000,"Workbench did not stop.");}catch{child.kill("SIGKILL");result=await closed;}}
  await Promise.allSettled(writes);await out.sync();await err.sync();await out.close();await err.close();
  assert(!forced,"Workbench needed forced termination; preserve its original operation before continuing.");
  return {...result,forced,pid:child.pid,workspace};
 }
 let startup;
 try{startup=await bounded(ready,30000,"Workbench startup deadline.");assert.equal(startup.workspace,workspace);
  const url=new URL(startup.url);assert.equal(url.protocol,"http:");assert.equal(url.hostname,"127.0.0.1");
 }catch(e){await stop().catch(()=>{});throw e;}
 return {url:startup.url,startup,stop};
}
const escape=value=>String(value??"").replace(/[&<>"']/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]));

async function main(){
 const args=parseArgs(process.argv.slice(2)), runId=randomUUID(), startedAt=utc();
 const application=await fs.realpath(path.resolve(args.application)),workspace=await fs.realpath(path.resolve(args.workspace));
 const output=path.resolve(args.output),python=args.python||process.env.PYTHON||"python3";
 assert(output!==workspace&&!output.startsWith(workspace+path.sep),"Keep browser outputs outside the original workspace.");
 await fs.mkdir(output,{recursive:true,mode:0o700});
 for(const part of ["phases","screenshots","downloads","logs","source","browser-temp","drains"])
  await fs.mkdir(path.join(output,part),{recursive:true,mode:0o700});
 const support=path.join(HERE,"workbench_browser_support.py");
 const sourcePins={};
 for(const [name,expected] of Object.entries(PINS)){
  sourcePins[name]=await identity(path.join(application,name));
  assert.equal(sourcePins[name].sha256,expected,"The completed original application changed: "+name);
 }
 const receivingFile=path.resolve(args["receiving-result"]||path.join(workspace,"..","..","receiving-result.json"));
 const receiving=await readJson(receivingFile);
 assert.equal(receiving.status,"PASS");assert.equal(receiving.recordCount,169);assert.equal(receiving.nativeState,"VERIFIED");
 assert.equal(receiving.operationId,OP);assert.equal(path.resolve(receiving.workbenchWorkspace),workspace);
 const input={schema:SCHEMA+".input",sourceCommit:COMMIT,application,workspace,operationId:OP,
  receivingResult:{path:receivingFile,...await identity(receivingFile)},sourcePins,
  runner:await identity(fileURLToPath(import.meta.url)),support:await identity(support)};
 await publishJson(path.join(output,"input.json"),input);
 await publish(path.join(output,"source/run_workbench_browser.mjs"),await fs.readFile(fileURLToPath(import.meta.url)));
 await publish(path.join(output,"source/workbench_browser_support.py"),await fs.readFile(support));
 const inputSha256=sha(canonical(input));
 async function inspect(app=application,root=workspace){
  const result=await command(python,["-B",support,"--application",app,"inspect","--workspace",root,"--operation-id",OP]);
  return JSON.parse(result.stdout);
 }
 const baselineFile=path.join(output,"baseline.json");
 const baseline=await exists(baselineFile)?await readJson(baselineFile):await inspect();
 await publishJson(baselineFile,baseline);
 assert.equal(baseline.status.sourceRecords,169);assert.equal(baseline.status.includedRecords,169);
 assert.equal(baseline.progress.state,"VERIFIED");assert.equal(baseline.progress.readback.verifiedRecords,169);
 assert.equal(baseline.progress.transfer.uploadId,receiving.uploadId);
 assert.equal(baseline.handoffId,receiving.handoffId);
 const originalSelection={sourceManifestSha256:baseline.status.project.binding.manifestSha256,
  revision:baseline.status.revision,reviewSha256:baseline.status.reviewSha256};
 const finalPath=path.join(output,"browser-result.json");
 if(await exists(finalPath)){
  const done=await readJson(finalPath);assert.equal(done.inputSha256,inputSha256);assert.equal(done.status,"PASS");
  for(const artifact of done.artifacts)assert.deepEqual(await identity(path.join(output,artifact.path)),{bytes:artifact.bytes,sha256:artifact.sha256});
  const actual=await inspect();assert.equal(actual.preparedInventorySha256,baseline.preparedInventorySha256);
  assert.equal(actual.status.revision,done.finalReview.revision);assert.equal(actual.status.reviewSha256,done.finalReview.reviewSha256);
  console.log(JSON.stringify({...done,reused:true}));return;
 }
 const phases={};
 async function phase(name,work){
  const file=path.join(output,"phases",name+".json");
  if(await exists(file)){
   const retained=await readJson(file);assert.equal(retained.inputSha256,inputSha256);phases[name]=retained.result;return retained.result;
  }
  const result=await work();
  await publishJson(file,{schema:SCHEMA+".phase",inputSha256,name,completedAt:utc(),result});
  phases[name]=result;console.log(JSON.stringify({phase:name,state:"COMPLETE"}));return result;
 }
 let browser,context,page,server,coldServer;const network=[],errors=[],blocked=[],allowed=new Set();
 const runtime=await browserRuntime(args);await publishJson(path.join(output,"browser-runtime.json"),runtime.descriptor);
 const deadline=Date.now()+args.timeout;
 async function waitFor(work,message,limit=60000){
  const until=Math.min(deadline,Date.now()+limit);let last;
  while(Date.now()<until){try{const value=await work();if(value)return value;}catch(e){last=e;}await sleep(150);}
  throw new Error(message+(last?": "+last.message:""));
 }
 async function api(url){
  return await page.evaluate(async endpoint=>{
   const response=await fetch(endpoint,{cache:"no-store"});
   const value=await response.json();if(!response.ok)throw new Error(value.message||value.error||String(response.status));return value;
  },url);
 }
 const state=()=>api("/api/state");
 async function tab(name){await page.locator("#tab-"+name).click();await page.locator("#page-"+name).waitFor({state:"visible"});}
 async function loadPage(url){
  await page.goto(url,{waitUntil:"domcontentloaded"});
  await waitFor(async()=>await page.locator("#source-count").textContent()==="169","The original 169-record workspace did not appear.");
  await waitFor(async()=>!(await page.locator("#connection").textContent()).includes("CONNECTING"),"Workbench did not connect.");
 }
 async function screenshot(name,caption){
  const file=path.join(output,"screenshots",name+".png"),sidecar=file+".json",capture=file+".capture.json";
  if(await exists(sidecar)){const old=await readJson(sidecar);assert.deepEqual(await identity(file),old.identity);return old;}
  let retained;
  if(await exists(capture))retained=await readJson(capture);
  else{
   assert(!(await exists(file)),"An unbound original PNG needs its exact capture receipt.");
   const metrics=await page.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight},
    documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight}));
   assert(metrics.documentWidth<=metrics.viewport.width+2,"The whole page overflows the selected viewport: "+name);
   const temp=file+".pending-"+runId;
   await page.screenshot({path:temp,type:"png",fullPage:true,animations:"disabled"});
   retained={descriptor:{path:relative(output,file),identity:await identity(temp),caption,metrics},
    temporary:relative(output,temp),inputSha256};
   await publishJson(capture,retained);
  }
  assert.equal(retained.inputSha256,inputSha256);assert.equal(retained.descriptor.path,relative(output,file));
  const temp=path.resolve(output,retained.temporary);relative(output,temp);
  if(await exists(file))assert.deepEqual(await identity(file),retained.descriptor.identity);
  else await publishFile(temp,file,retained.descriptor.identity);
  if(await exists(temp))await fs.unlink(temp);
  await publishJson(sidecar,retained.descriptor);return retained.descriptor;
 }
 async function selectOriginal(){
  await tab("destinations");
  await page.locator("#destination-list button").filter({hasText:OP}).click();
  await waitFor(async()=>(await page.locator("#migration-id").textContent())===OP&&
   (await page.locator("#migration-state").textContent())==="VERIFIED","The saved original destination did not load.");
  const actual=await api("/api/migration?id="+encodeURIComponent(OP));
  assert.deepEqual(actual.configuration,baseline.operation.configuration);
  assert.deepEqual(actual.settings,baseline.operation.settings);assert.deepEqual(actual.selection,baseline.operation.selection);
  assert.equal(actual.progress.transfer.uploadId,receiving.uploadId);assert.equal(actual.progress.readback.verifiedRecords,169);
  const shown=JSON.parse(await page.locator("#migration-configuration").textContent());
  assert.deepEqual(shown.configuration,baseline.operation.configuration);
  return {id:actual.id,selection:actual.selection,uploadId:actual.progress.transfer.uploadId,state:actual.progress.state,verifiedRecords:169};
 }
 async function refresh(){await page.locator("#refresh-state").click();await waitFor(async()=>!(await state()).active,"Original background work did not finish.",180000);}
 async function openRecord(id){
  await tab("records");await page.locator("#record-query").fill("id:"+id);
  const button=page.locator("#record-rows .record-button").filter({hasText:id});
  await waitFor(async()=>await button.count()===1,"The exact selected source record did not appear: "+id);
  await button.click();await waitFor(async()=>(await page.locator("#record-identity").textContent()).startsWith(id+"\n"),"Wrong record editor.");
 }
 async function applyJson(review){
  await tab("records");const details=page.locator("#advanced-review");
  if(!(await details.evaluate(node=>node.open)))await details.locator("summary").click();
  await page.locator("#review-json").fill(JSON.stringify(review,null,2));
  await page.locator("#apply-review-json").click();
  await waitFor(async()=>!(await page.locator("#save-review").isDisabled()),"The complete review did not become a valid draft.");
 }
 async function reconcileSavedReview(name,current,expectedRevision){
  const responsePath=path.join(output,"phases",name+".response.json");
  const request=await readJson(path.join(output,"phases",name+".request.json"));
  assert.equal(request.expectedRevision,expectedRevision);assert.equal(current.revision,expectedRevision+1);
  assert.deepEqual(current.review,request.review,"The committed review differs from the retained original request.");
  if(await exists(responsePath)){
   const response=await readJson(responsePath);assert.deepEqual(current,response.status);return response.status;
  }
  const retained=await inspect();
  assert.deepEqual(retained.status,current);
  assert(retained.history.some(x=>x.selection.revision===current.revision&&x.selection.reviewSha256===current.reviewSha256));
  const reconciliationPath=path.join(output,"phases",name+".commit-reconciliation.json");
  if(await exists(reconciliationPath)){
   const prior=await readJson(reconciliationPath);assert.equal(prior.kind,"ORIGINAL_REVIEW_COMMIT_READBACK");
   assert.deepEqual(prior.request,request);assert.deepEqual(prior.status,current);
   assert.equal(typeof prior.observedAt,"string");assert(Number.isFinite(Date.parse(prior.observedAt)));
   return prior.status;
  }
  await publishJson(reconciliationPath,{
   kind:"ORIGINAL_REVIEW_COMMIT_READBACK",request,status:current,observedAt:utc()});
  return current;
 }
 async function saveUI(name,{lateNote=null}={}){
  const intentPath=path.join(output,"phases",name+".request.json"),responsePath=path.join(output,"phases",name+".response.json");
  let release,heldResolve,heldReject;
  const held=new Promise((resolve,reject)=>{heldResolve=resolve;heldReject=reject;});
  const gate=new Promise(resolve=>{release=resolve;});
  const handler=async route=>{
   if(route.request().method()!=="POST"){await route.continue();return;}
   try{
    await publishJson(intentPath,route.request().postDataJSON());
    const response=await route.fetch(),body=await response.body();
    assert.equal(response.status(),200,"Original review save failed.");
    const value=JSON.parse(body.toString("utf8"));await publishJson(responsePath,value);
    heldResolve(value);if(lateNote!==null)await gate;await route.fulfill({response,body});
   }catch(e){heldReject(e);await route.abort().catch(()=>{});}
  };
  await page.route("**/api/review",handler);
  try{
   const responsePromise=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/review"&&r.request().method()==="POST",{timeout:60000});
   await page.locator("#save-review").click();
   const value=await bounded(held,60000,"The real save response was not retained.");
   if(lateNote!==null){
    await page.locator("#review-note").fill(lateNote);assert.equal(await page.locator("#review-note").inputValue(),lateNote);release();
   }
   const observed=await responsePromise;assert.equal(observed.status(),200);
   await waitFor(async()=>await page.locator("#save-review").textContent()==="Save review","The save response did not finish rendering.");
   if(lateNote!==null){
    assert.equal(await page.locator("#review-note").inputValue(),lateNote,"Typing made during the actual save was overwritten.");
    assert.equal(await page.locator("#save-review").isDisabled(),false,"The remaining typed draft was cleared.");
    await publishJson(path.join(output,"phases",name+".typing-fence.json"),{savedRevision:value.status.revision,
     savedReviewSha256:value.status.reviewSha256,typedNote:lateNote,observedDraft:await page.locator("#review-note").inputValue(),
     preserved:true,observedAt:utc()});
   }
   await waitFor(async()=>(await state()).status.revision>=value.status.revision,"Saved revision did not appear.");
   return value.status;
  }finally{release();await page.unroute("**/api/review",handler);}
 }
 async function completedJob(id){
  return await waitFor(async()=>{const current=await state(),job=current.jobs.find(x=>x.id===id);
   if(!job)return null;if(["FAILED","INTERRUPTED"].includes(job.state))throw new Error("Original job did not complete: "+JSON.stringify(job));
   return job.state==="COMPLETED"?job:null;
  },"The original package/export job did not finish.",240000);
 }
 async function queuedClick(selector,endpoint,receiptFile=null){
  const responsePromise=page.waitForResponse(r=>new URL(r.url()).pathname===endpoint&&r.request().method()==="POST",{timeout:60000});
  await page.locator(selector).click();const response=await responsePromise;assert.equal(response.status(),202);
  const value=await response.json();const id=value.job?.id||value.jobId||value.id;
  assert(id,"The original queued action did not return its job ID.");
  if(receiptFile)await publishJson(receiptFile,{id,response:value});
  return await completedJob(id);
 }
 async function download(artifact,label){
  await tab("delivery");await refresh();
  const target=path.join(output,"downloads",label+".zip"), expected={bytes:artifact.bytes,sha256:artifact.sha256};
  if(await exists(target)){assert.deepEqual(await identity(target),expected);return {path:relative(output,target),...expected,artifactId:artifact.id};}
  const anchor=page.locator('a[href="/download?id='+artifact.id+'"]').first();
  await anchor.waitFor({state:"visible"});const promised=page.waitForEvent("download",{timeout:60000});await anchor.click();
  const incoming=await promised,temp=target+".pending-"+runId;await incoming.saveAs(temp);
  assert.equal(await incoming.failure(),null);await publishFile(temp,target,expected);await fs.unlink(temp);
  return {path:relative(output,target),...expected,artifactId:artifact.id,suggestedFilename:incoming.suggestedFilename()};
 }
 async function stop(which){
  const running=which==="cold"?coldServer:server;if(!running)return;
  if(which==="cold")coldServer=null;else server=null;
  const drained=await running.stop();await publishJson(path.join(output,"drains",which+"-"+runId+".json"),{observedAt:utc(),...drained});
 }

 try{
  server=await startServer(python,application,workspace,path.join(output,"logs"),"original-"+runId);allowed.add(server.url);
  browser=await runtime.chromium.launch({headless:true,executablePath:runtime.descriptor.browser.executable,
   args:["--no-sandbox","--disable-dev-shm-usage","--renderer-process-limit=1"],
   env:{...process.env,TMPDIR:path.join(output,"browser-temp")}});
  context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,locale:"en-US",timezoneId:"UTC"});
  await context.route("**/*",async route=>{
   const request=route.request(),url=new URL(request.url());
   if(["data:","about:","blob:"].includes(url.protocol)||allowed.has(url.origin)){await route.continue();return;}
   blocked.push({method:request.method(),origin:url.origin,path:url.pathname});await route.abort();
  });
  context.on("page",p=>{
   p.on("pageerror",e=>errors.push({kind:"pageerror",message:e.message}));
   p.on("console",m=>{if(m.type()==="error")errors.push({kind:"console",message:m.text(),location:m.location()});});
   p.on("dialog",d=>d.accept().catch(()=>{}));
   p.on("response",r=>{const url=new URL(r.url());network.push({method:r.request().method(),origin:url.origin,path:url.pathname,status:r.status()});});
  });
  page=await context.newPage();page.setDefaultTimeout(30000);await loadPage(server.url);
  await phase("01-original-workspace",async()=>{
   const now=await state();assert.equal(now.migrations.length,1);assert.equal(now.migrations[0].id,OP);
   await screenshot("01-desktop-overview","Original 169-record reviewed source and saved receiving operation.");
   const destination=await selectOriginal();
   await screenshot("02-desktop-original-destination","The complete original Preservica destination is VERIFIED; its original upload and configuration remain selected.");
   return {sourceRecords:169,originalReview:originalSelection,destination};
  });
  const records=await phase("02-record-selection",async()=>{
   await tab("records");const preview=await api("/api/preview");
   assert(preview.rows.length>=2);return preview.rows.slice(0,2).map(row=>({
    identifier:row.identifier,title:row.reviewedDc.title,decision:row.decision,include:row.include}));
  });
  const reviewNote="Browser receiving: reasoned title correction and one temporary exclusion.";
  const typedNote=reviewNote+" This sentence was typed while the actual save response was in flight.";
  const modified=await phase("03-reasoned-review",async()=>{
   const current=(await state()).status;
   if(current.revision===originalSelection.revision+1){
    const saved={status:await reconcileSavedReview("reasoned-save",current,originalSelection.revision)};
    const fence=path.join(output,"phases/reasoned-save.typing-fence.json");
    return {status:saved.status,records,typingFence:await exists(fence)?await readJson(fence):null,recoveredCommit:true};
   }
   assert.equal(current.revision,originalSelection.revision,"Reconcile a concurrent original review before this journey.");
   await openRecord(records[0].identifier);
   if(!(await page.locator("#correction-title").count())){
    await page.locator("#field-select").selectOption("title");await page.locator("#add-field").click();
   }
   const corrected=[...(records[0].title||[])];assert(corrected.length,"The source example needs an original title.");
   corrected[0]+=" [reviewed metadata example]";
   await page.locator("#correction-title").fill(JSON.stringify(corrected));
   await page.locator("#record-reason").fill("Temporary receiving example: show a reasoned metadata correction while retaining the original title.");
   await page.locator("#apply-record").click();await waitFor(async()=>!await page.locator("#save-review").isDisabled(),"Record correction was not applied.");
   await openRecord(records[1].identifier);await page.locator("#record-include").uncheck();
   await page.locator("#record-reason").fill("Temporary receiving example: exclude this record with an explicit reason; the complete baseline is restored later.");
   await page.locator("#apply-record").click();await waitFor(async()=>!await page.locator("#save-review").isDisabled(),"Record exclusion was not applied.");
   await page.locator("#review-note").fill(reviewNote);
   const saved=await saveUI("reasoned-save",{lateNote:typedNote});
   assert.equal(saved.revision,originalSelection.revision+1);assert.equal(saved.includedRecords,168);assert.equal(saved.excludedRecords,1);
   const correctedDecision=saved.review.decisions.find(x=>x.identifier===records[0].identifier);
   const excluded=saved.review.decisions.find(x=>x.identifier===records[1].identifier);
   assert.deepEqual(correctedDecision.fields.title,corrected);assert.equal(excluded.include,false);assert(excluded.reason);
   await screenshot("03-desktop-reasoned-review","A reasoned correction and exclusion are saved; typing during the actual save remains as an unsaved review note.");
   return {status:saved,records,typingFence:await readJson(path.join(output,"phases/reasoned-save.typing-fence.json"))};
  });
  const kept=await phase("04-save-retained-draft",async()=>{
   const current=(await state()).status;
   if(current.revision===originalSelection.revision+2){
    const saved={status:await reconcileSavedReview("retained-draft",current,originalSelection.revision+1)};
    const fence=path.join(output,"phases/retained-draft.typing-fence.json");
    return {status:saved.status,typingFence:await exists(fence)?await readJson(fence):null,recoveredCommit:true};
   }
   assert.equal(current.revision,originalSelection.revision+1);
   const desired=structuredClone(modified.status.review);desired.note=typedNote;
   if((await page.locator("#review-note").inputValue())!==typedNote)await applyJson(desired);
   const retryFence=modified.typingFence?null:typedNote+" The recovered receiving observation also retains this later unsaved sentence.";
   const saved=await saveUI("retained-draft",{lateNote:retryFence});
   assert.equal(saved.revision,originalSelection.revision+2);assert.equal(saved.review.note,typedNote);
   return {status:saved,typingFence:retryFence?await readJson(path.join(output,"phases/retained-draft.typing-fence.json")):null};
  });
  const restored=await phase("05-restore-original-review",async()=>{
   const current=(await state()).status;
   if(current.revision===originalSelection.revision+3){
    assert.deepEqual(current.review,baseline.status.review);
    const old={status:await reconcileSavedReview("restore-save",current,originalSelection.revision+2)};
    return {status:old.status,recoveredCommit:true,previewFence:await readJson(path.join(output,"phases/restore-preview-fence.json"))};
   }
   assert.equal(current.revision,originalSelection.revision+2);
   await tab("records");const details=page.locator("#advanced-review");
   if(!(await details.evaluate(node=>node.open)))await details.locator("summary").click();
   await page.locator("#review-json").fill(JSON.stringify(baseline.status.review,null,2));
   let release,resolveHeld,rejectHeld,taken=false;
   const gate=new Promise(resolve=>{release=resolve;}),held=new Promise((resolve,reject)=>{resolveHeld=resolve;rejectHeld=reject;});
   const handler=async route=>{
    if(taken||route.request().method()!=="POST"){await route.continue();return;}taken=true;
    try{const response=await route.fetch(),body=await response.body();assert.equal(response.status(),200);
     resolveHeld(JSON.parse(body.toString("utf8")));await gate;await route.fulfill({response,body});
    }catch(e){rejectHeld(e);await route.abort().catch(()=>{});}
   };
   await page.route("**/api/preview",handler);
   try{
    await page.locator("#apply-review-json").click();await bounded(held,60000,"Original complete-review validation did not return.");
    await page.locator("#record-query").fill("id:"+records[0].identifier);
    await sleep(300);release();
    await waitFor(async()=>await page.locator("#record-rows .record-button").count()===1&&
     (await page.locator("#record-rows .record-button").first().textContent())===records[0].identifier,"A stale JSON-validation preview replaced the current search.");
    await waitFor(async()=>!await page.locator("#save-review").isDisabled(),"Restored original review was not applied.");
    const proof={query:await page.locator("#record-query").inputValue(),
     returnedIdentifier:await page.locator("#record-rows .record-button").first().textContent(),preserved:true,observedAt:utc()};
    const proofPath=path.join(output,"phases/restore-preview-fence.json");
    if(await exists(proofPath)){
     const prior=await readJson(proofPath);assert.equal(prior.preserved,true);
     assert.equal(prior.query,proof.query);assert.equal(prior.returnedIdentifier,proof.returnedIdentifier);
    }else await publishJson(proofPath,proof);
   }finally{release();await page.unroute("**/api/preview",handler);}
   const saved=await saveUI("restore-save");assert.equal(saved.revision,originalSelection.revision+3);
   assert.equal(saved.reviewSha256,originalSelection.reviewSha256);assert.deepEqual(saved.review,baseline.status.review);
   assert.equal(saved.includedRecords,169);assert.equal(saved.excludedRecords,0);
   return {status:saved,previewFence:await readJson(path.join(output,"phases/restore-preview-fence.json"))};
  });
  let finalRestored=restored.status;
  if(!(modified.typingFence?.preserved||kept.typingFence?.preserved)){
   const recovery=await phase("05b-recovered-typing-observation",async()=>{
    const observations=[];
    for(let index=1;index<=64;index++){
     const number=String(index).padStart(4,"0"),name="05b-typing-observation-"+number;
     const r=restored.status.revision+2*(index-1);
     const typingName="recovered-typing-save-"+number,baselineName="recovered-baseline-save-"+number;
     const observation=await phase(name,async()=>{
      let current=(await state()).status;
      const draft=structuredClone(baseline.status.review);
      draft.note+=" Temporary explicit resumed browser observation "+number+".";
      const typedNote=draft.note+" Typed during the saved response.";
      if(current.revision===r){
       assert.deepEqual(current.review,baseline.status.review);
       await applyJson(draft);await saveUI(typingName,{lateNote:typedNote});
      }else if(current.revision===r+1){
       await reconcileSavedReview(typingName,current,r);
      }else assert.equal(current.revision,r+2,"Reconcile an unrelated review before resuming the saved observation.");
      const request=await readJson(path.join(output,"phases",typingName+".request.json"));
      assert.equal(request.expectedRevision,r);assert.deepEqual(request.review,draft);
      const fencePath=path.join(output,"phases",typingName+".typing-fence.json");
      let fence=null;
      if(await exists(fencePath)){
       fence=await readJson(fencePath);assert.equal(fence.preserved,true);
       assert.equal(fence.savedRevision,r+1);assert.equal(fence.savedReviewSha256,sha(canonical(request.review)));
       assert.equal(fence.typedNote,typedNote);assert.equal(fence.observedDraft,typedNote);
       const retained=await inspect();
       assert(retained.history.some(x=>x.selection.revision===r+1&&x.selection.reviewSha256===fence.savedReviewSha256));
      }
      current=(await state()).status;let status;
      if(current.revision===r+1){
       await applyJson(baseline.status.review);status=await saveUI(baselineName);
      }else status=await reconcileSavedReview(baselineName,current,r+1);
      assert.equal(status.revision,r+2);assert.deepEqual(status.review,baseline.status.review);
      assert.equal(status.reviewSha256,originalSelection.reviewSha256);
      return {number,startRevision:r,status,typingFence:fence,
       observationState:fence?"OBSERVED":"COMMIT_RECONCILED_WITHOUT_TYPING_PROOF"};
     });
     observations.push({phase:name,...observation});
     if(observation.typingFence?.preserved)return {
      status:observation.status,typingFence:observation.typingFence,observations};
    }
    throw new Error("Retained interrupted observation limit reached; preserve the original restored workspace and receipts.");
   });
   finalRestored=recovery.status;
  }
  const laterSelection={...originalSelection,revision:finalRestored.revision};
  await phase("06-history-and-pagination",async()=>{
   await refresh();await tab("records");await page.locator("#record-query").fill("");
   await waitFor(async()=>await page.locator("#record-rows .record-button").count()===50,"Full source page did not return.");
   await page.locator("#next-page").click();
   await waitFor(async()=>(await page.locator("#page-label").textContent()).includes("51"),"Next original source page did not appear.");
   const secondPage=await page.locator("#page-label").textContent();await page.locator("#previous-page").click();
   const now=await state(),same=now.reviewHistory.filter(x=>x.selection.reviewSha256===originalSelection.reviewSha256);
   assert(same.some(x=>x.selection.revision===originalSelection.revision));assert(same.some(x=>x.selection.revision===laterSelection.revision));
   await tab("delivery");
   const options=await page.locator("#package-revision option").evaluateAll(nodes=>nodes.map(n=>({value:n.value,label:n.textContent})));
   for(const selection of [originalSelection,laterSelection])assert(options.some(x=>x.value===selection.revision+":"+selection.reviewSha256));
   await screenshot("04-desktop-history","Identical restored review content remains selectable at two distinct saved revisions.");
   return {secondPage,originalSelection,laterSelection,matchingHistory:same,options};
  });
  await phase("07-destination-drafts",async()=>{
   await selectOriginal();await page.locator("#new-destination").click();
   await page.locator("#destination-provider").selectOption("preservica");
   const draft={id:"browser-unsaved-preservica-169",label:"Unsaved comparison draft — retained locally",
    settings:{...baseline.operation.settings,title:"Unsaved source comparison"},
    configuration:{...baseline.operation.configuration,requestTimeoutSeconds:75},
    revision:originalSelection.revision+":"+originalSelection.reviewSha256};
   await page.locator("#destination-id").fill(draft.id);await page.locator("#destination-label").fill(draft.label);
   await page.locator("#destination-settings").fill(JSON.stringify(draft.settings,null,2));
   await page.locator("#destination-configuration").fill(JSON.stringify(draft.configuration,null,2));
   await page.locator("#destination-revision").selectOption(draft.revision);
   await selectOriginal();await page.locator("#new-destination").click();
   assert.equal(await page.locator("#destination-id").inputValue(),draft.id);assert.equal(await page.locator("#destination-label").inputValue(),draft.label);
   assert.deepEqual(JSON.parse(await page.locator("#destination-settings").inputValue()),draft.settings);
   assert.deepEqual(JSON.parse(await page.locator("#destination-configuration").inputValue()),draft.configuration);
   assert.equal(await page.locator("#destination-revision").inputValue(),draft.revision);
   await page.locator("#destination-provider").selectOption("roda");await page.locator("#destination-label").fill("Separate unsaved RODA draft");
   await page.locator("#destination-provider").selectOption("preservica");assert.equal(await page.locator("#destination-label").inputValue(),draft.label);
   await screenshot("05-desktop-unsaved-destination","A separate unsaved destination draft survives selecting the original saved operation and switching providers.");
   await selectOriginal();const current=await state();assert.equal(current.migrations.length,1);
   return {draft,originalOperationId:OP,migrationCount:current.migrations.length,savedConfigurationUnchanged:true};
  });
  async function packagePhase(name,selection){
   return await phase(name,async()=>{
    await tab("delivery");await page.locator("#package-revision").selectOption(selection.revision+":"+selection.reviewSha256);
    const now=await state(),retained=now.jobs.filter(x=>x.kind==="native-package"&&x.state==="COMPLETED"&&
     canonical(x.arguments.selection)===canonical(selection)).at(-1);
    const job=retained||await queuedClick("#build-package","/api/package");
    assert.deepEqual(job.arguments.selection,selection);
    const artifact=job.result.artifact,downloaded=await download(artifact,"Research_Review_r"+selection.revision);
    const result=await command(python,["-B",support,"--application",application,"package","--source",path.join(output,downloaded.path),
      "--output",path.join(output,"received-package-r"+selection.revision)]);
    const checked=JSON.parse(result.stdout);assert.equal(checked.verification.identity.reviewRevision,selection.revision);
    assert.equal(checked.verification.identity.reviewSha256,selection.reviewSha256);assert.equal(checked.verification.includedRecords,169);
    return {selection,jobId:job.id,artifact,download:downloaded,receiving:checked};
   });
  }
  const originalPackage=await packagePhase("08-original-revision-package",originalSelection);
  const laterPackage=await packagePhase("09-restored-revision-package",laterSelection);
  assert.notEqual(originalPackage.receiving.verification.bagId,laterPackage.receiving.verification.bagId);
  await phase("10-narrow-operator",async()=>{
   await page.setViewportSize({width:390,height:844});
   const images=[];
   await tab("overview");images.push(await screenshot("06-narrow-overview","Narrow overview of the same source and saved review."));
   await tab("records");images.push(await screenshot("07-narrow-records","Narrow record review keeps source identifiers and decisions readable."));
   await selectOriginal();images.push(await screenshot("08-narrow-destination","Narrow saved destination retains the original verified transfer and source selection."));
   await tab("delivery");images.push(await screenshot("09-narrow-delivery","Narrow delivery view exposes the complete native packages and historical selections."));
   await page.setViewportSize({width:1440,height:1000});return {viewport:{width:390,height:844},images};
  });
  const exported=await phase("11-full-workspace-download",async()=>{
   const current=await inspect();assert.equal(current.preparedInventorySha256,baseline.preparedInventorySha256);
   assert.deepEqual(current.operationFile,baseline.operationFile);assert.deepEqual(current.status.review,baseline.status.review);
   await publishJson(path.join(output,"final-original-inspection.json"),current);
   await tab("delivery");
   const requestFile=path.join(output,"phases/full-export.request.json"),queueFile=path.join(output,"phases/full-export.queue.json");
   if(!(await exists(requestFile)))await publishJson(requestFile,{jobIdsBefore:(await state()).jobs.map(x=>x.id),selection:laterSelection});
   const originalRequest=await readJson(requestFile);assert.deepEqual(originalRequest.selection,laterSelection);
   let job;
   if(await exists(queueFile))job=await completedJob((await readJson(queueFile)).id);
   else {
    const later=(await state()).jobs.filter(x=>x.kind==="complete-export"&&!originalRequest.jobIdsBefore.includes(x.id));
    assert(later.length<=1,"Reconcile the original browser export before starting another local export.");
    if(later.length){await publishJson(queueFile,{id:later[0].id,reconciledOriginal:true});job=await completedJob(later[0].id);}
    else job=await queuedClick("#export-workspace","/api/export",queueFile);
   }
   const artifact=job.result.artifact||job.result;
   const downloaded=await download(artifact,"Research_Preservation_Workbench_Complete_Browser");
   await screenshot("10-desktop-complete-delivery","Complete application and workspace download follows the same original verified destination.");
   return {jobId:job.id,artifact,download:downloaded,finalReview:laterSelection,originalPreparedUnchanged:true};
  });
  await page.close({runBeforeUnload:false});page=null;await stop("original");
  const received=await phase("12-cold-receiving",async()=>{
   const destination=path.join(output,"received-workbench");
   const result=await command(python,["-B",support,"--application",application,"receive","--source",path.join(output,exported.download.path),"--output",destination],{timeout:240000});
   return JSON.parse(result.stdout);
  });
  const coldRoot=path.join(output,"received-workbench/workspace"),coldApplication=path.join(output,"received-workbench/application");
  await phase("13-cold-browser-reopen",async()=>{
   const current=await inspect(coldApplication,coldRoot);assert.equal(current.preparedInventorySha256,baseline.preparedInventorySha256);
   assert.deepEqual(current.operationFile,baseline.operationFile);assert.equal(current.progress.state,"VERIFIED");
   assert.equal(current.progress.readback.verifiedRecords,169);assert.equal(current.progress.transfer.uploadId,receiving.uploadId);
   assert.equal(current.status.revision,laterSelection.revision);assert.equal(current.status.reviewSha256,originalSelection.reviewSha256);
   for(const [name,exact] of Object.entries(baseline.reviewFiles))assert.deepEqual(current.reviewFiles[name],exact,"Original review/candidate not retained: "+name);
   coldServer=await startServer(python,coldApplication,coldRoot,path.join(output,"logs"),"received-"+runId);allowed.add(coldServer.url);
   page=await context.newPage();page.setDefaultTimeout(30000);await loadPage(coldServer.url);await selectOriginal();
   await screenshot("11-desktop-cold-reopened","The downloaded application cold-opens the same VERIFIED original operation and restored review history.");
   await tab("delivery");await page.locator("#package-revision").selectOption(originalSelection.revision+":"+originalSelection.reviewSha256);
   const coldState=await state(),artifact=coldState.artifacts.find(x=>x.id===originalPackage.artifact.id);
   assert(artifact?.available,"The original historical package was not available after complete receiving.");
   const downloaded=await download(artifact,"Cold_Original_Review_r"+originalSelection.revision);
   assert.equal(downloaded.sha256,originalPackage.download.sha256);
   const after=await inspect(coldApplication,coldRoot);assert.equal(after.preparedInventorySha256,baseline.preparedInventorySha256);
   await publishJson(path.join(output,"final-received-inspection.json"),after);
   await page.close({runBeforeUnload:false});page=null;await stop("cold");
   return {workspace:coldRoot,application:coldApplication,operationId:OP,uploadId:receiving.uploadId,progressToken:receiving.progressToken,
    state:after.progress.state,verifiedRecords:169,finalReview:laterSelection,originalReviewsRetained:Object.keys(baseline.reviewFiles).length,
    originalPreparedInventorySha256:after.preparedInventorySha256,historicalDownload:downloaded};
  });
  await browser.close();browser=null;
  assert.equal(blocked.length,0,"A browser request attempted to leave the original local workbench.");
  const forbidden=network.filter(x=>x.method==="POST"&&["/api/init","/api/prepare","/api/run","/api/refresh","/api/reconcile","/api/resume-preparation"].includes(x.path));
  assert.equal(forbidden.length,0,"The browser must retain the existing original provider operation.");
  const unsuccessful=network.filter(x=>x.status>=400&&!(x.path==="/favicon.ico"&&x.status===404));
  assert.deepEqual(unsuccessful,[],"An operator HTTP response failed.");
  const applicationErrors=errors.filter(x=>!x.location?.url?.endsWith("/favicon.ico"));
  assert.deepEqual(applicationErrors,[],"The browser emitted an application error.");
  await publishJson(path.join(output,"network-"+runId+".json"),{network,blocked,errors,forbidden});
  const images=[];
  for(const name of (await fs.readdir(path.join(output,"screenshots"))).filter(x=>x.endsWith(".png.json")).sort()){
   const image=await readJson(path.join(output,"screenshots",name));assert.deepEqual(await identity(path.join(output,image.path)),image.identity);images.push(image);
  }
  const checks={same169Source:true,originalProviderVerified:true,reasonedEditAndExclusion:true,
   typingDuringSavePreserved:true,lateJsonPreviewFenced:true,sameContentAtDistinctRevisions:true,
   savedAndUnsavedDestinationsSeparate:true,exactHistoricalPackages:true,desktopAndNarrowScreenshots:true,
   realBrowserDownloads:true,completeOriginalWorkspaceReceived:true,coldSameOperationVerified:true,
   originalReviewCandidatesRetained:true,originalPreparedBytesUnchanged:true,noProviderActionFromBrowser:true,serversAndBrowserDrained:true};
  const result={schema:SCHEMA,status:"PASS",inputSha256,startedAt,completedAt:utc(),sourceCommit:COMMIT,
   sourceRecords:169,operationId:OP,originalReceivingResult:input.receivingResult,originalSelection,finalReview:laterSelection,
   originalProviderIds:{uploadId:receiving.uploadId,progressToken:receiving.progressToken,handoffId:receiving.handoffId},
   runtime:runtime.descriptor,checks,phases,images,
   pythonRuntime:(await command(python,["--version"],{timeout:15000,limit:65536})).stdout.trim(),
   visualInspection:{state:"SCREENSHOTS_RETAINED_FOR_INDEPENDENT_IMAGE_REVIEW",imageCount:images.length},
   completeWorkspace:exported.download,receivedWorkspace:coldRoot,receivedApplication:coldApplication};
  const style="body{font:16px/1.6 system-ui,sans-serif;color:#172834;background:#edf2f4;margin:0}main{max-width:1140px;margin:auto;padding:44px 24px}h1{font-size:2.4rem;line-height:1.15}h2{margin-top:2rem}.card{background:white;border:1px solid #cad5dc;border-radius:12px;padding:24px;margin:22px 0}table{border-collapse:collapse;width:100%;font-size:.92rem}th,td{padding:10px;border-bottom:1px solid #d6e0e5;text-align:left;overflow-wrap:anywhere}code{overflow-wrap:anywhere}img{width:100%;height:auto;border:1px solid #cad5dc}a{color:#075d89}.muted{color:#536674}figure{margin:20px 0}figcaption{padding:10px 0}";
  const rows=Object.entries(checks).map(([key,value])=>"<tr><td>"+escape(key)+"</td><td>"+(value?"PASS":"UNRESOLVED")+"</td></tr>").join("");
  const html="<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Preservation workbench — original 169-record browser receiving</title><style>"+style+"</style><main><p class=\"muted\">Original receiving "+escape(OP)+"</p><h1>Complete preservation workbench browser receiving</h1><p>The same 169-record source and completed original Preservica destination remain intact after review editing, historical package selection, browser downloads and a cold application reopen.</p><div class=\"card\"><h2>Saved result</h2><p>Review r"+originalSelection.revision+" was edited with an explicit correction and exclusion, then restored byte for byte at r"+laterSelection.revision+". Both saved revisions remain independently selectable. The original provider operation remains VERIFIED for all 169 records.</p><p>Original upload: <code>"+escape(receiving.uploadId)+"</code>. Original progress token: <code>"+escape(receiving.progressToken)+"</code>.</p><p>This is a local receiving demonstration using the previously completed source-bound HTTP fixture. It does not claim acceptance by a customer Preservica tenant. The browser dispatched no provider mutation.</p><p><a href=\""+escape(exported.download.path)+"\">Complete application and workspace ZIP</a> · <a href=\"browser-result.json\">Exact receiving result</a> · <a href=\"source/run_workbench_browser.mjs\">Repeatable browser source</a></p></div><div class=\"card\"><h2>Actual receiving checks</h2><table><thead><tr><th>Boundary</th><th>Result</th></tr></thead><tbody>"+rows+"</tbody></table></div><h2>Desktop and narrow browser captures</h2><p class=\"muted\">Screenshots are original browser output. Independent image review is recorded separately after inspection.</p>"+images.map(x=>"<figure><img loading=\"lazy\" src=\""+escape(x.path)+"\" alt=\""+escape(x.caption)+"\"><figcaption>"+escape(x.caption)+" — "+x.metrics.viewport.width+" × "+x.metrics.viewport.height+" viewport; SHA-256 <code>"+x.identity.sha256+"</code>.</figcaption></figure>").join("")+"<div class=\"card\"><h2>Reopen</h2><p>Use the complete ZIP with its included <code>workbench.py receive</code> command. The received workspace is <code>"+escape(coldRoot)+"</code>; its complete application is <code>"+escape(coldApplication)+"</code>. The original operation and all committed and retained unpublished review files are preserved.</p><p>Browser: "+escape(runtime.descriptor.browser.version)+"; Playwright "+escape(runtime.descriptor.playwright.version)+"; Node "+escape(runtime.descriptor.node)+".</p></div></main></html>";
  await publish(path.join(output,"Preservation_Workbench_Browser_Receiving.html"),html);
  const markdown="# Complete preservation workbench browser receiving\n\nStatus: PASS. Source: 169 original records. Original operation: "+OP+".\n\n"+
   "Review r"+originalSelection.revision+" was corrected and temporarily reduced to 168 included records, then its complete original JSON was restored at r"+laterSelection.revision+". The same content hash is retained at two selectable revisions. Typing during a delayed real save response and the current search during delayed JSON validation were preserved.\n\n"+
   "The same original Preservica upload remains VERIFIED for all 169 records. No provider action was sent by the browser. Original upload: "+receiving.uploadId+"; progress: "+receiving.progressToken+". These are the retained local HTTP receiving fixture's identifiers, not a customer-tenant acceptance claim.\n\n"+
   "Complete application/workspace: ["+path.basename(exported.download.path)+"]("+exported.download.path+").\n\n"+
   "Cold received workspace: "+coldRoot+"\n\n"+Object.keys(checks).map(k=>"- PASS: "+k).join("\n")+
   "\n\n## Screenshots\n\n"+images.map(x=>"- ["+x.caption+"]("+x.path+") — "+x.metrics.viewport.width+" × "+x.metrics.viewport.height+"; "+x.identity.sha256).join("\n")+
   "\n\nIndependent image review is pending the reviewer's inspection of these actual PNGs. Exact hashes and all original phase receipts are included in browser-result.json.\n";
  await publish(path.join(output,"Preservation_Workbench_Browser_Receiving.md"),markdown);
  const wanted=["input.json","baseline.json","browser-runtime.json","final-original-inspection.json","final-received-inspection.json",
   "Preservation_Workbench_Browser_Receiving.html","Preservation_Workbench_Browser_Receiving.md",
   "source/run_workbench_browser.mjs","source/workbench_browser_support.py"];
  for(const directory of ["phases","downloads","screenshots","drains"]){
   for(const name of (await fs.readdir(path.join(output,directory))).sort())if(!name.includes(".pending-"))wanted.push(directory+"/"+name);
  }
  for(const name of (await fs.readdir(output)).filter(x=>x.startsWith("network-")&&x.endsWith(".json")))wanted.push(name);
  result.artifacts=[];for(const name of [...new Set(wanted)])result.artifacts.push({path:name,...await identity(path.join(output,name))});
  await publishJson(finalPath,result);
  console.log(JSON.stringify({status:"PASS",operationId:OP,sourceRecords:169,finalReview:laterSelection,
   completeWorkspace:exported.download,receivedWorkspace:coldRoot,images:images.length,resultPath:finalPath,checks}));
 }catch(error){
  const failurePath=path.join(output,"failure-"+runId+".json");
  await publishJson(failurePath,{schema:SCHEMA+".failure",inputSha256,observedAt:utc(),error:failure(error),
   phases:Object.keys(phases),network,blocked,errors}).catch(()=>{});
  throw error;
 }finally{
  if(page)await page.close({runBeforeUnload:false}).catch(()=>{});
  if(browser)await browser.close().catch(()=>{});
  await stop("cold").catch(error=>console.error(JSON.stringify({phase:"cold-drain",error:failure(error)})));
  await stop("original").catch(error=>console.error(JSON.stringify({phase:"original-drain",error:failure(error)})));
 }
}
main().catch(error=>{console.error(JSON.stringify({status:"FAILED",error:failure(error)}));process.exitCode=1;});
