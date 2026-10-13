#!/usr/bin/env node
/** Manual browser receiving on the exact retained transfer-inspection case. */
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
for(const k of ["--application","--operation","--browser","--playwright-module","--python"])assert(args[k],"Missing "+k);
const op=path.resolve(args["--operation"]),application=path.resolve(args["--application"]);
const self=fileURLToPath(import.meta.url),python=args["--python"];
const sha=b=>createHash("sha256").update(b).digest("hex");
const canonical=value=>JSON.stringify(value,function(_,v){return v&&typeof v==="object"&&!Array.isArray(v)?
  Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v;});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const read=async file=>JSON.parse(await fs.readFile(file,"utf8"));
async function exists(p){try{await fs.lstat(p);return true;}catch(e){if(e.code==="ENOENT")return false;throw e;}}
async function publish(file,bytes,replace=false){
  bytes=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  if(!replace&&await exists(file)){assert((await fs.readFile(file)).equals(bytes),"Retained file differs: "+file);return;}
  const temp=file+".partial-"+randomUUID();const h=await fs.open(temp,"wx",0o600);
  try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}
  try{if(replace)await fs.rename(temp,file);else await fs.link(temp,file);
    const parent=await fs.open(path.dirname(file),"r");try{await parent.sync();}finally{await parent.close();}
  }finally{await fs.unlink(temp).catch(()=>{});}
}
const write=(file,value,replace=false)=>publish(file,JSON.stringify(value,null,2)+"\n",replace);
if(!process.env.TRANSFER_RECEIVING_GUARD){
  // The original kernel guard survives into the Node owner and its server children.
  const locker=String.raw`import fcntl,os,sys
p=sys.argv[1]
fd=os.open(p,os.O_RDWR|os.O_CREAT,0o600)
fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
os.set_inheritable(fd,True)
os.environ["TRANSFER_RECEIVING_GUARD"]=str(fd)
os.execv(sys.argv[2],sys.argv[2:])
`;
  const child=spawn(python,["-B","-c",locker,path.join(op,"transfer-inspection.lock"),process.execPath,self,...process.argv.slice(2)],{stdio:"inherit"});
  process.exitCode=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("exit",code=>resolve(code??1));});
}else{
  const guard=Number(process.env.TRANSFER_RECEIVING_GUARD);assert(Number.isSafeInteger(guard)&&guard>=3);
  assert(fstatSync(guard).isFile(),"Original receiving guard is not an inherited regular file.");
  const native=await read(path.join(op,"transfer-inspection","COMPLETE.json"));
  assert.equal(native.phase,"COMPLETE");
  assert.equal(native.workspace,path.resolve(native.workspace));
  const nativeSelections=await read(path.join(op,"transfer-inspection","selected-package-inputs.json"));
  assert.equal(nativeSelections.length,2);
  for(let i=0;i<2;i++){
    const selection=nativeSelections[i];
    if(selection.kind==="artifact"){
      assert.deepEqual(Object.keys(selection).sort(),["id","kind"]);
      assert.equal(selection.id,native.comparison.packages[i].artifactId);
    }else{
      assert.deepEqual(Object.keys(selection).sort(),["kind","path"]);
      assert.equal(selection.kind,"path");assert.equal(selection.path,native.originalPackages[i].path);
    }
  }
  const sourceFiles=native.sourceFiles;
  assert(sourceFiles&&typeof sourceFiles==="object"&&!Array.isArray(sourceFiles));
  async function verifySelectedSource(){
    for(const [name,expected]of Object.entries(sourceFiles)){
      assert(name.startsWith("research/")&&!name.includes("\\")&&!name.split("/").some(p=>!p||p==="."||p===".."));
      const file=path.join(application,name),info=await fs.lstat(file);
      assert(info.isFile()&&!info.isSymbolicLink(),"Selected original source must be a regular file: "+name);
      const body=await fs.readFile(file);
      assert.deepEqual({bytes:body.length,sha256:sha(body)},expected,"The native course's selected source changed: "+name);
    }
  }
  await verifySelectedSource();
  const directory=path.join(op,"transfer-inspection","browser");
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const intent={schema:"stellar-forge.transfer-inspection-browser.v1.selection",operation:op,application,
    originalResultSha256:sha(await fs.readFile(path.join(op,"transfer-inspection","COMPLETE.json"))),
    workspace:native.workspace,packages:native.originalPackages,selections:nativeSelections,sourceFiles,browser:path.resolve(args["--browser"]),
    playwrightModule:path.resolve(args["--playwright-module"]),python:path.resolve(python)};
  await write(path.join(directory,"selection.json"),intent);
  const progressPath=path.join(directory,"progress.json");
  const progress=await exists(progressPath)?await read(progressPath):{schema:"stellar-forge.transfer-inspection-browser.v1.progress",steps:{}};
  const save=async(key,value)=>{if(progress.steps[key])assert.deepEqual(progress.steps[key],value);else progress.steps[key]=value;
    await write(progressPath,progress,true);console.log(JSON.stringify({phase:key,retained:true}));};
  const attempt=path.join(directory,"attempts",new Date().toISOString().replaceAll(":","-")+"-"+randomUUID());
  await fs.mkdir(attempt,{recursive:true,mode:0o700});
  const pw=await import(pathToFileURL(path.resolve(args["--playwright-module"])).href);
  const browser=await(pw.chromium||pw.default?.chromium).launch({executablePath:args["--browser"],headless:true,args:["--no-sandbox"]});
  const processes=[];
  async function server(sdk,workspace,label){
    const child=spawn(python,["-B",path.join(sdk,"research/preservation/workbench.py"),"serve","--workspace",workspace,"--port","0"],
      {stdio:["ignore","pipe","pipe",guard],env:{...process.env,TRANSFER_RECEIVING_GUARD:"3"}});
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
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const issues=[];page.on("pageerror",e=>issues.push(e.message));
  async function reportView(url,id){
    await page.locator("#transfer-report-select").selectOption(id);
    await waitFor(async()=>{
      const actual=await page.locator("#transfer-selection").textContent();
      const expected=await api(url,"/api/transfer-report?id="+encodeURIComponent(id));
      return actual===JSON.stringify(expected.selection,null,2)?expected:null;
    },"Selected complete report did not finish loading.");
  }
  async function runUI(url,mode){
    const selections=mode==="inspect"?[nativeSelections[1]]:nativeSelections;
    for(let i=0;i<selections.length;i++){
      const selected=selections[i];
      await page.locator("#transfer-kind-"+i).selectOption(selected.kind);
      if(selected.kind==="artifact")await page.locator("#transfer-package-"+i).selectOption(selected.id);
      else await page.locator("#transfer-path-"+i).fill(selected.path);
    }
    const key="ui-"+mode;
    if(!progress.steps[key+"-intent"]){
      const state=await api(url,"/api/state");
      await save(key+"-intent",{priorJobIds:state.jobs.map(job=>job.id),selections});
    }
    assert.deepEqual(progress.steps[key+"-intent"].selections,selections);
    const prior=new Set(progress.steps[key+"-intent"].priorJobIds);
    const matching=state=>state.jobs.filter(job=>!prior.has(job.id)&&job.kind==="transfer-"+mode&&
      canonical(job.arguments)===canonical({mode,selections}));
    const observedState=await api(url,"/api/state");
    let rows=matching(observedState);assert(rows.length<=1,"Reconcile the original selected UI operation.");
    const completed=progress.steps[key+"-job"];
    if(!rows.length&&!completed){
      assert(observedState.jobCount<=observedState.jobs.length,"Original job window is incomplete; reconcile the retained full Activity history before another click.");
      await page.locator("#transfer-"+mode).click();
    }
    const job=completed?{id:completed.id,result:completed.result}:await waitFor(async()=>{
      const rows=matching(await api(url,"/api/state"));assert(rows.length<=1);
      const row=rows[0];
      if(row&&["FAILED","INTERRUPTED"].includes(row.state))throw Error("Preserve and reconcile original transfer job "+row.id);
      return row?.state==="COMPLETED"?row:null;
    },"Original selected report job remains pending.");
    const expected=mode==="inspect"?native.inspection:native.comparison;
    assert.deepEqual(job.result,expected,"Browser action must reproduce the exact original complete report.");
    await save(key+"-job",{id:job.id,result:job.result});
    await page.reload();await page.locator("#tab-delivery").click();
    await reportView(url,job.result.artifacts.json.id);
    const reports={};
    for(const extension of ["json","html","csv"]){
      const artifact=job.result.artifacts[extension],file=path.join(directory,mode+"."+extension);
      reports[extension]=await download(page,page.locator('#transfer-downloads a[href="/download?id='+artifact.id+'"]'),file,
        {bytes:artifact.bytes,sha256:artifact.sha256});
    }
    const full=await read(reports.json.file);
    const original=await api(url,"/api/transfer-report?id="+job.result.artifacts.json.id);
    assert.deepEqual(full.summary,original.summary);
    await save(key+"-downloads",reports);
    let all=[],offset=0;
    while(true){
      const value=await api(url,"/api/transfer-report?id="+job.result.artifacts.json.id+"&offset="+offset);
      all.push(...value.rows);
      if(offset+50>=value.total)break;
      offset+=50;
    }
    assert.deepEqual(all,full.rows,"Every full row must remain pageable without truncation.");
    if(full.rows.length){
      const first=full.rows[0];
      await page.locator("[data-transfer-row]").first().click();
      assert.equal(await page.locator("#transfer-original pre").textContent(),JSON.stringify(first,null,2));
    }
    if(mode==="compare"){
      await page.locator("#transfer-changes").selectOption("changed");
      await page.locator("#transfer-filter").click();
      await waitFor(async()=>page.locator("#transfer-page").textContent().then(text=>
        full.summary.changed?text.endsWith("of "+full.summary.changed+" rows"):text==="No matching rows"),"Changed-row view did not settle.");
      await page.locator("#transfer-changes").selectOption("all");await page.locator("#transfer-filter").click();
    }
    await page.screenshot({path:path.join(attempt,mode+"-desktop.png"),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(attempt,mode+"-narrow.png"),fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    const reportPage=await browser.newPage({viewport:{width:1440,height:1000}});
    reportPage.on("pageerror",e=>issues.push(e.message));
    await reportPage.goto(pathToFileURL(reports.html.file).href);
    await reportPage.locator("table").waitFor();
    assert.equal(await reportPage.locator("tbody tr").count(),full.rows.length);
    await reportPage.screenshot({path:path.join(attempt,mode+"-download-desktop.png"),fullPage:true});
    await reportPage.setViewportSize({width:390,height:844});
    await reportPage.screenshot({path:path.join(attempt,mode+"-download-narrow.png"),fullPage:true});
    await reportPage.close();
    return job.result;
  }
  try{
    const live=await server(application,intent.workspace,"original");
    await page.goto(live.url);await page.locator("#tab-delivery").click();
    await page.locator("#transfer-inspect").waitFor({state:"visible"});
    const initial=await api(live.url,"/api/state");
    const sourceBefore={status:initial.status,accessions:initial.accessions,reviewHistory:initial.reviewHistory};
    await save("source-before",sourceBefore);
    const inspection=await runUI(live.url,"inspect"),comparison=await runUI(live.url,"compare");
    const state=await api(live.url,"/api/state");
    assert.deepEqual({status:state.status,accessions:state.accessions,reviewHistory:state.reviewHistory},sourceBefore);
    if(!progress.steps["export-intent"])await save("export-intent",{priorJobIds:state.jobs.map(j=>j.id)});
    const prior=new Set(progress.steps["export-intent"].priorJobIds);
    let rows=state.jobs.filter(j=>!prior.has(j.id)&&j.kind==="complete-export");
    assert(rows.length<=1,"Reconcile the original selected complete export.");
    const savedExport=progress.steps["export-job"];
    if(!rows.length&&!savedExport){
      assert(state.jobCount<=state.jobs.length,"Reconcile the retained full export history before another click.");
      await page.locator("#export-workspace").click();
    }
    const exportJob=savedExport?{id:savedExport.id,result:{artifact:savedExport.artifact}}:await waitFor(async()=>{
      const value=await api(live.url,"/api/state"),jobs=value.jobs.filter(j=>!prior.has(j.id)&&j.kind==="complete-export");
      assert(jobs.length<=1);const job=jobs[0];
      if(job&&["FAILED","INTERRUPTED"].includes(job.state))throw Error("Use original Activity export recovery for "+job.id+" before resuming.");
      return job?.state==="COMPLETED"?job:null;
    },"Original complete export remains pending.");
    await save("export-job",{id:exportJob.id,artifact:exportJob.result.artifact});
    await page.reload();await page.locator("#tab-delivery").click();
    const complete=await download(page,page.locator('a[href="/download?id='+exportJob.result.artifact.id+'"]'),
      path.join(directory,"complete.zip"),{bytes:exportJob.result.artifact.bytes,sha256:exportJob.result.artifact.sha256});
    await save("complete-download",complete);
    const received=path.join(directory,"received");
    const child=spawn(python,["-B",path.join(application,"research/preservation/workbench.py"),"receive","--source",complete.file,"--output",received],
      {stdio:["ignore","pipe","pipe",guard],env:{...process.env,TRANSFER_RECEIVING_GUARD:"3"}});
    processes.push(child);let stdout="",stderr="";
    child.stdout.on("data",b=>stdout+=b);child.stderr.on("data",b=>stderr+=b);
    const exit=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("exit",code=>resolve(code));});
    await publish(path.join(attempt,"cold-receive.txt"),stdout+"\n"+stderr);assert.equal(exit,0,"Original complete receiving failed.");
    const receipt=JSON.parse(stdout);assert(receipt.received);await save("cold-receive",{directory:received,archive:receipt.archive});
    const cold=await server(path.join(received,"application"),path.join(received,"workspace"),"received");
    await page.goto(cold.url);await page.locator("#tab-delivery").click();
    for(const [mode,result]of [["inspect",inspection],["compare",comparison]]){
      await reportView(cold.url,result.artifacts.json.id);
      const response=await fetch(cold.url+"/download?id="+result.artifacts.json.id);
      assert(response.ok);assert((Buffer.from(await response.arrayBuffer())).equals(await fs.readFile(path.join(directory,mode+".json"))));
      for(const item of result.packages){
        const response=await fetch(cold.url+"/download?id="+item.artifactId);assert(response.ok);
        const bytes=Buffer.from(await response.arrayBuffer());assert.deepEqual({bytes:bytes.length,sha256:sha(bytes)},{bytes:item.bytes,sha256:item.sha256});
      }
    }
    await page.screenshot({path:path.join(attempt,"received-desktop.png"),fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(attempt,"received-narrow.png"),fullPage:true});
    assert.deepEqual(issues,[]);
    await verifySelectedSource();
    const result={schema:"stellar-forge.transfer-inspection-browser.v1.result",phase:"AUTOMATED_COURSE_COMPLETE",
      intent,steps:progress.steps,attempt,visualAcceptance:"PENDING_PRODUCER_LOOK: inspect all ten desktop/narrow screenshots, complete report downloads, original ZIPs and reopened workspace."};
    await write(path.join(attempt,"result.json"),result);await write(path.join(directory,"LATEST.json"),result,true);
    console.log(JSON.stringify(result));
  }catch(error){
    await write(path.join(attempt,"FAILED.json"),{error:error.message,stack:error.stack,steps:progress.steps});throw error;
  }finally{
    await browser.close();
    for(const child of processes)if(child.exitCode===null&&child.signalCode===null){child.kill("SIGTERM");
      await new Promise(resolve=>{child.once("exit",resolve);setTimeout(resolve,10000);});}
    assert(processes.every(child=>child.exitCode!==null||child.signalCode!==null),"An original child remains active; its inherited guard must be reconciled.");
  }
}
