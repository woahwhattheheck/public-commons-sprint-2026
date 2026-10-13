#!/usr/bin/env node
/** Complete portable-review journey on the existing original accession case. */
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import * as fs from "node:fs/promises";
import {fstatSync} from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import {pathToFileURL,fileURLToPath} from "node:url";
const args={};
for(let i=2;i<process.argv.length;i+=2){
  const name=process.argv[i];assert(name.startsWith("--")&&process.argv[i+1]&&!Object.hasOwn(args,name));args[name]=process.argv[i+1];
}
for(const k of ["--application","--operation","--review","--browser","--playwright-module","--python"])assert(args[k],"Missing "+k);
const op=path.resolve(args["--operation"]),application=path.resolve(args["--application"]);
const self=fileURLToPath(import.meta.url),python=args["--python"];
const sha=b=>createHash("sha256").update(b).digest("hex");
const canonical=value=>JSON.stringify(value,function(_,v){return v&&typeof v==="object"&&!Array.isArray(v)?
  Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v;});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const read=async file=>JSON.parse(await fs.readFile(file,"utf8"));
async function exists(p){try{await fs.lstat(p);return true;}catch(e){if(e.code==="ENOENT")return false;throw e;}}
async function durableDirectory(target){
  target=path.resolve(target);const parent=path.dirname(target);
  let info;
  try{info=await fs.lstat(target);}catch(error){if(error.code!=="ENOENT")throw error;}
  if(!info){
    assert.notEqual(parent,target,"A filesystem root must already exist.");
    await durableDirectory(parent);
    try{await fs.mkdir(target,{mode:0o700});}catch(error){if(error.code!=="EEXIST")throw error;}
    info=await fs.lstat(target);
  }
  assert(info.isDirectory()&&!info.isSymbolicLink(),"Receiving directories must be original ordinary directories: "+target);
  const parentHandle=await fs.open(parent,"r");try{await parentHandle.sync();}finally{await parentHandle.close();}
}
async function publish(file,bytes,replace=false){
  bytes=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
  await durableDirectory(path.dirname(file));
  if(!replace&&await exists(file)){assert((await fs.readFile(file)).equals(bytes),"Retained file differs: "+file);return;}
  const temp=file+".partial-"+randomUUID();const h=await fs.open(temp,"wx",0o600);
  try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}
  try{if(replace)await fs.rename(temp,file);else await fs.link(temp,file);
    const parent=await fs.open(path.dirname(file),"r");try{await parent.sync();}finally{await parent.close();}
  }finally{await fs.unlink(temp).catch(()=>{});}
}
const write=(file,value,replace=false)=>publish(file,JSON.stringify(value,null,2)+"\n",replace);

assert((await fs.stat(op)).isDirectory(),"Use the original completed collection operation directory.");
if(!process.env.COLLECTION_RECEIVING_GUARD){
  const locker="import fcntl,os,sys\nfd=os.open(sys.argv[1],os.O_RDWR|os.O_CREAT,0o600)\nfcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)\nos.set_inheritable(fd,True)\nos.environ['COLLECTION_RECEIVING_GUARD']=str(fd)\nos.execv(sys.argv[2],sys.argv[2:])\n";
  const child=spawn(python,["-B","-c",locker,path.join(op,"browser.lock"),process.execPath,self,...process.argv.slice(2)],{stdio:"inherit"});
  process.exitCode=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("exit",code=>resolve(code??1));});
}else{
  const guard=Number(process.env.COLLECTION_RECEIVING_GUARD);assert(Number.isSafeInteger(guard)&&guard>=3&&fstatSync(guard).isFile());
  const originalRaw=await fs.readFile(path.join(op,"COMPLETE.json")),original=JSON.parse(originalRaw.toString("utf8"));
  assert.equal(original.phase,"COMPLETE");assert(original.settings?.id&&path.isAbsolute(original.workspace));
  const directory=path.join(op,"portable-review");await durableDirectory(directory);
  const attempt=path.join(directory,"attempts",new Date().toISOString().replaceAll(":","-")+"-"+randomUUID());
  await durableDirectory(attempt);
  async function captureSource(){
    const script="import json,sys,pathlib\nsys.path.insert(0,sys.argv[1])\nimport workbench as w\nroot=pathlib.Path(sys.argv[1]).parent.parent\nnames=list(w.APPLICATION)\nfor group in (w.PRESERVICA_APPLICATION,w.LIBNOVA_APPLICATION,w.ARCHIVEMATICA_APPLICATION,w.COLLECTION_APPLICATION,w.TRANSFER_APPLICATION,w.PORTABLE_REVIEW_APPLICATION):\n present=[(root/name).exists() for name in group]\n if any(present):\n  assert all(present),'Incomplete selected source group'\n  names.extend(group)\nprint(json.dumps({'files':{name:w.file_digest(root/name) for name in names}}))\n";
    const child=spawn(python,["-B","-c",script,path.join(application,"research/preservation")],{stdio:["ignore","pipe","pipe",guard],env:{...process.env,COLLECTION_RECEIVING_GUARD:"3"}});
    let out="",err="";child.stdout.on("data",b=>out+=b);child.stderr.on("data",b=>err+=b);
    const code=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("exit",resolve);});assert.equal(code,0,err);
    return JSON.parse(out).files;
  }
  const sourceFiles=await captureSource(),reviewBytes=await fs.readFile(args["--review"]),review=JSON.parse(reviewBytes.toString("utf8"));
  assert.equal(review.inventorySha256,original.source.sha256);
  const intent={schema:"stellar-forge.collection-review-receiving.v1.selection",operation:op,application,
    originalCaseSha256:sha(originalRaw),workspace:original.workspace,accession:original.settings.id,sourceFiles,
    review:{bytes:reviewBytes.length,sha256:sha(reviewBytes)},browser:path.resolve(args["--browser"]),
    playwrightModule:path.resolve(args["--playwright-module"]),python:path.resolve(python)};
  await write(path.join(directory,"selection.json"),intent);
  await publish(path.join(directory,"selected-review.json"),reviewBytes);
  async function verifySource(){
    for(const[name,identity]of Object.entries(sourceFiles)){
      assert(name.startsWith("research/")&&!name.split("/").some(x=>!x||x==="."||x==="..")&&!name.includes("\\"));
      const file=path.join(application,name),info=await fs.lstat(file);assert(info.isFile()&&!info.isSymbolicLink());
      const body=await fs.readFile(file);assert.deepEqual({bytes:body.length,sha256:sha(body)},identity);
      await publish(path.join(directory,"source",name),body);
    }
  }
  await verifySource();
  await import(pathToFileURL(path.join(application,"research/preservation/collection_review.js")).href);
  const portable=globalThis.PreservationCollectionReview;assert(portable?.create&&portable?.returnReview);
  const progressPath=path.join(directory,"progress.json"),progress=await exists(progressPath)?await read(progressPath):{steps:{}};
  const save=async(key,value)=>{if(progress.steps[key])assert.deepEqual(progress.steps[key],value);else progress.steps[key]=value;
    await write(progressPath,progress,true);console.log(JSON.stringify({phase:key,retained:true}));};
  const pw=await import(pathToFileURL(path.resolve(args["--playwright-module"])).href);
  const browser=await(pw.chromium||pw.default?.chromium).launch({executablePath:args["--browser"],headless:true,args:["--no-sandbox"]});
  const processes=[];
  async function server(sdk,workspace,label){
    const child=spawn(python,["-B",path.join(sdk,"research/preservation/workbench.py"),"serve","--workspace",workspace,"--port","0"],
      {stdio:["ignore","pipe","pipe",guard],env:{...process.env,COLLECTION_RECEIVING_GUARD:"3"}});
    processes.push(child);let lines="",errors="",launch;
    child.stdout.on("data",part=>{lines+=part;for(const line of lines.split("\n")){try{let v=JSON.parse(line);if(v.url)launch=v;}catch{}}});
    child.stderr.on("data",part=>{errors+=part;});
    const began=Date.now();
    while(!launch&&child.exitCode===null&&child.signalCode===null&&Date.now()-began<30000)await sleep(100);
    await publish(path.join(attempt,label+"-startup.txt"),lines+"\n"+errors);
    assert(launch,"Original Workbench did not open; preserve any existing native server before retrying.");
    assert.equal(launch.workspace,workspace);
    return{child,url:launch.url};
  }
  async function api(url,route){const r=await fetch(url+route);if(!r.ok)throw Error(await r.text());return r.json();}
  async function waitFor(fn,message){const start=Date.now();while(Date.now()-start<600000){const result=await fn();if(result)return result;await sleep(500);}throw Error(message);}
  async function download(page,locator,file,expected){
    const wait=page.waitForEvent("download");await locator.click();const dl=await wait;
    const temp=path.join(attempt,randomUUID()+"-"+dl.suggestedFilename());await dl.saveAs(temp);
    const bytes=await fs.readFile(temp);if(expected)assert.deepEqual({bytes:bytes.length,sha256:sha(bytes)},expected);
    await publish(file,bytes);return{file,bytes:bytes.length,sha256:sha(bytes)};
  }

  let page;const issues=[];
  const sourceURL=url=>url+"/api/accession-review-source?id="+encodeURIComponent(intent.accession);
  const current=async url=>{const r=await fetch(sourceURL(url));assert(r.ok);return portable.source(await r.json());};
  async function choose(p,url){
    await p.goto(url);await p.locator("#tab-collections").click();await p.locator("#collection-select").selectOption(intent.accession);
    await p.waitForFunction(()=>{const n=document.querySelector("#collection-review-note");return n&&!n.disabled;});
  }
  const outputs={};
  async function downloadOnce(p,control,name){
    const file=path.join(directory,name);
    const result=await download(p,p.locator(control),file);
    outputs[name]=result;return result;
  }
  async function artifact(url,item,file){
    const r=await fetch(url+"/download?id="+item.id);assert(r.ok);const body=Buffer.from(await r.arrayBuffer());
    assert.deepEqual({bytes:body.length,sha256:sha(body)},{bytes:item.bytes,sha256:item.sha256});await publish(file,body);
    return{file,bytes:body.length,sha256:sha(body)};
  }
  try{
    page=await browser.newPage({viewport:{width:1440,height:1000}});
    page.on("pageerror",e=>issues.push(e.message));page.on("dialog",dialog=>dialog.accept());
    const live=await server(application,intent.workspace,"original");
    const observed=await current(live.url),baseFile=path.join(directory,"original-source.json");
    if(!await exists(baseFile))await write(baseFile,observed);
    const base=await portable.source(await read(baseFile)),baseHead=base.history.at(-1);
    assert.deepEqual(base.inventory,observed.inventory);assert.deepEqual(base.accession,observed.accession);
    assert(base.history.every((r,i)=>portable.equal(r,observed.history[i])),"The original history changed.");
    const target=portable.review(review,base.inventory);
    assert(!portable.equal(target,baseHead.review),"Select a real following operator review for this original course.");
    if(observed.history.length!==base.history.length){
      assert.equal(observed.history.length,base.history.length+1,"Later native work requires explicit new continuation.");
      assert(portable.equal(observed.history.at(-1).review,target),"An intervening saved review differs from the selected return.");
    }
    await choose(page,live.url);
    const initialFile=path.join(directory,"original-working.html");
    if(!await exists(initialFile)){
      assert.equal(observed.history.length,base.history.length);
      await downloadOnce(page,"#collection-working-html","original-working.html");
    }
    const originalHTML=await fs.readFile(initialFile,"utf8");
    outputs["original-working.html"]={file:initialFile,bytes:Buffer.byteLength(originalHTML),sha256:sha(originalHTML)};
    const marker=originalHTML.match(/<script id="collection-working-data" type="application\/json">([\s\S]*?)<\/script>/);
    assert(marker);const opening=await portable.validate(JSON.parse(marker[1]));assert.deepEqual(opening.source,base);
    await save("original-working",{file:initialFile,bytes:Buffer.byteLength(originalHTML),sha256:sha(originalHTML),workingSha256:opening.sha256});
    const offline=await browser.newPage({viewport:{width:1440,height:1000}});
    offline.on("pageerror",e=>issues.push(e.message));offline.on("dialog",dialog=>dialog.accept());
    await offline.goto(pathToFileURL(initialFile).href);await offline.waitForFunction(()=>!document.querySelector("#review-note").disabled);
    const paths=[...new Set([...opening.draft.decisions.map(r=>r.path),...target.decisions.map(r=>r.path)])];
    const sample=paths[0]||Object.keys(base.inventory.files)[0];
    async function openPath(p){
      await offline.locator("#query").fill(p);
      let found=false;
      for(let pageNumber=0;pageNumber<=Math.ceil(Object.keys(base.inventory.files).length/50);pageNumber++){
        const index=await offline.locator("[data-file]").evaluateAll((nodes,p)=>nodes.findIndex(n=>n.dataset.file===p),p);
        if(index>=0){await offline.locator("[data-file]").nth(index).click();found=true;break;}
        if(await offline.locator("#next").isDisabled())break;
        await offline.locator("#next").click();
      }
      assert(found,"The exact original path was absent from the complete filtered pages.");
      await offline.locator("#file-title").filter({hasText:p}).waitFor();
    }
    await openPath(sample);await offline.locator("#file-fields").fill("{\n");
    await downloadOnce(offline,"#download-json","unfinished-working.json");
    const unfinished=await portable.validate(await read(path.join(directory,"unfinished-working.json")));
    assert.equal(unfinished.editor.path,sample);assert.equal(unfinished.editor.fieldsText,"{\n");
    await offline.locator("#working-file").setInputFiles(path.join(directory,"unfinished-working.json"));
    await offline.locator("#working-open").click();
    await offline.waitForFunction(()=>!document.querySelector("#file-fields").disabled);
    assert.equal(await offline.locator("#file-fields").inputValue(),"{\n");
    await offline.screenshot({path:path.join(attempt,"01-unfinished-edit-reopened.png"),fullPage:true});
    await offline.locator("#reload-file").click();
    const byPath=new Map(target.decisions.map(r=>[r.path,r]));
    for(const p of paths){
      await openPath(p);const selected=byPath.get(p);
      if(selected){
        await offline.locator("#file-include").setChecked(selected.include);
        await offline.locator("#file-fields").fill(JSON.stringify(selected.fields,null,2));
        await offline.locator("#file-reason").fill(selected.reason);
        await offline.locator("#apply-file").click();
      }else await offline.locator("#original-file").click();
      await offline.waitForFunction(()=>document.querySelector("#file-editor").hidden);
    }
    await offline.locator("#review-note").fill(target.note);
    await downloadOnce(offline,"#download-json","returned-working.json");
    await downloadOnce(offline,"#download-html","returned-working.html");
    const returned=await portable.validate(await read(path.join(directory,"returned-working.json")));
    assert(portable.equal(returned.draft,target));assert.equal(returned.editor,null);assert.deepEqual(returned.source,base);
    await offline.goto(pathToFileURL(path.join(directory,"returned-working.html")).href);
    await offline.waitForFunction(()=>!document.querySelector("#review-note").disabled);
    assert.equal(await offline.locator("#review-note").inputValue(),target.note);
    await offline.screenshot({path:path.join(attempt,"02-returned-working-desktop.png"),fullPage:true});
    await offline.setViewportSize({width:390,height:844});await offline.screenshot({path:path.join(attempt,"03-returned-working-narrow.png"),fullPage:true});
    await save("returned-working",{sha256:returned.sha256,draft:target,outputs});
    let latest=await current(live.url);
    assert(portable.equal(await portable.returnReview(returned,latest),target));
    if(!portable.equal(latest.history.at(-1).review,target)){
      assert.deepEqual(latest,base,"The original saved review advanced before applying this return.");
      await save("save-intent",{baseRevision:baseHead.revision,baseReviewSha256:baseHead.reviewSha256,workingSha256:returned.sha256});
      await choose(page,live.url);
      await page.locator("#collection-review-import").setInputFiles(path.join(directory,"returned-working.html"));
      await page.locator("#collection-review-reopen").click();
      await page.locator("#collection-merge-imported").waitFor({state:"visible"});
      await page.locator("#collection-merge-imported").click();
      await page.screenshot({path:path.join(attempt,"04-explicit-native-comparison.png"),fullPage:true});
      await page.locator("#collection-merge-apply").click();
      await page.locator("#collection-save").click();
      latest=await waitFor(async()=>{const value=await current(live.url);return portable.equal(value.history.at(-1).review,target)?value:null;},"The original native save remains unobserved; retain its intent.");
    }
    assert.equal(latest.history.length,base.history.length+1);
    assert(base.history.every((r,i)=>portable.equal(r,latest.history[i])));assert(portable.equal(latest.history.at(-1).review,target));
    await write(path.join(directory,"accepted-source.json"),latest);await save("accepted-native",{sha256:latest.sha256,revision:latest.history.at(-1).revision,reviewSha256:latest.history.at(-1).reviewSha256});
    await choose(page,live.url);await page.locator("#tab-delivery").click();
    const state=await api(live.url,"/api/state");
    if(!progress.steps["export-intent"])await save("export-intent",{priorJobIds:state.jobs.map(j=>j.id)});
    const prior=new Set(progress.steps["export-intent"].priorJobIds),savedExport=progress.steps["export-job"];
    let jobs=state.jobs.filter(j=>!prior.has(j.id)&&j.kind==="complete-export");assert(jobs.length<=1);
    if(!jobs.length&&!savedExport){
      assert(state.jobCount<=state.jobs.length,"The job window is incomplete; reconcile the original export before another click.");
      await page.locator("#export-workspace").click();
    }
    const job=savedExport?{id:savedExport.id,result:{artifact:savedExport.artifact}}:await waitFor(async()=>{
      const rows=(await api(live.url,"/api/state")).jobs.filter(j=>!prior.has(j.id)&&j.kind==="complete-export");assert(rows.length<=1);
      const row=rows[0];if(row&&["FAILED","INTERRUPTED"].includes(row.state))throw Error("Recover the original complete export in Activity: "+row.id);
      return row?.state==="COMPLETED"?row:null;
    },"The original complete export remains pending.");
    await save("export-job",{id:job.id,artifact:job.result.artifact});
    const complete=await artifact(live.url,job.result.artifact,path.join(directory,"complete.zip"));await save("complete-download",complete);
    const received=path.join(directory,"received"),child=spawn(python,["-B",path.join(application,"research/preservation/workbench.py"),"receive","--source",complete.file,"--output",received],
      {stdio:["ignore","pipe","pipe",guard],env:{...process.env,COLLECTION_RECEIVING_GUARD:"3"}});
    processes.push(child);let stdout="",stderr="";child.stdout.on("data",b=>stdout+=b);child.stderr.on("data",b=>stderr+=b);
    const exit=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("exit",resolve);});
    await publish(path.join(attempt,"cold-receive.txt"),stdout+"\n"+stderr);assert.equal(exit,0);const receipt=JSON.parse(stdout);assert(receipt.received);
    await save("cold-receive",{directory:received,archive:receipt.archive});
    const cold=await server(path.join(received,"application"),path.join(received,"workspace"),"received");
    assert.deepEqual(await current(cold.url),latest);
    await choose(page,cold.url);await page.screenshot({path:path.join(attempt,"05-cold-reopened-desktop.png"),fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(attempt,"06-cold-reopened-narrow.png"),fullPage:true});
    assert.deepEqual(await current(live.url),latest);await verifySource();assert.deepEqual(issues,[]);
    for(const item of Object.values(progress.steps["returned-working"].outputs)){
      const raw=await fs.readFile(item.file);assert.deepEqual({bytes:raw.length,sha256:sha(raw)},{bytes:item.bytes,sha256:item.sha256});
    }
    const result={schema:"stellar-forge.collection-review-receiving.v1.result",phase:"AUTOMATED_COURSE_COMPLETE",intent,
      source:base.sha256,accepted:latest.sha256,steps:progress.steps,attempt,
      visualAcceptance:"PENDING_PRODUCER_LOOK: open and inspect the six exact desktop/narrow images, all working JSON/HTML and complete workspace; operate controls and reopen downloaded files."};
    await write(path.join(attempt,"result.json"),result);await write(path.join(directory,"LATEST.json"),result,true);console.log(JSON.stringify(result));
  }catch(error){await write(path.join(attempt,"FAILED.json"),{error:error.message,stack:error.stack,steps:progress.steps});throw error;}
  finally{
    await browser.close();
    for(const child of processes)if(child.exitCode===null&&child.signalCode===null){child.kill("SIGTERM");
      await new Promise(resolve=>{child.once("exit",resolve);setTimeout(resolve,10000);});}
    assert(processes.every(child=>child.exitCode!==null||child.signalCode!==null),"An original child remains active; retain its inherited guard.");
  }
}
