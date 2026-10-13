#!/usr/bin/env node
/** Manual browser receiving on the exact retained collection-accession case. */
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
if(!process.env.COLLECTION_RECEIVING_GUARD){
  // The original kernel guard survives into the Node owner and its server children.
  const locker=String.raw`import fcntl,os,sys
p=sys.argv[1]
fd=os.open(p,os.O_RDWR|os.O_CREAT,0o600)
fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
os.set_inheritable(fd,True)
os.environ["COLLECTION_RECEIVING_GUARD"]=str(fd)
os.execv(sys.argv[2],sys.argv[2:])
`;
  const child=spawn(python,["-B","-c",locker,path.join(op,"browser.lock"),process.execPath,self,...process.argv.slice(2)],{stdio:"inherit"});
  process.exitCode=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("exit",code=>resolve(code??1));});
}else{
  const guard=Number(process.env.COLLECTION_RECEIVING_GUARD);assert(Number.isSafeInteger(guard)&&guard>=3);
  assert(fstatSync(guard).isFile(),"Original receiving guard is not an inherited regular file.");
  const original=await read(path.join(op,"COMPLETE.json"));assert.equal(original.phase,"COMPLETE");
  const reviewBytes=await fs.readFile(args["--review"]),review=JSON.parse(reviewBytes.toString("utf8"));
  assert.equal(review.inventorySha256,original.source.sha256);
  const directory=path.join(op,"browser");await fs.mkdir(directory,{recursive:true,mode:0o700});
  const intent={schema:"stellar-forge.collection-browser.v1.selection",operation:op,application,
    accession:original.settings.id,workspace:original.workspace,originalCaseSha256:sha(await fs.readFile(path.join(op,"COMPLETE.json"))),
    review:{bytes:reviewBytes.length,sha256:sha(reviewBytes)},browser:path.resolve(args["--browser"]),
    playwrightModule:path.resolve(args["--playwright-module"]),python:path.resolve(python)};
  await write(path.join(directory,"selection.json"),intent);
  await publish(path.join(directory,"original-following-review.json"),reviewBytes);
  const progressPath=path.join(directory,"progress.json");
  const progress=await exists(progressPath)?await read(progressPath):{schema:"stellar-forge.collection-browser.v1.progress",steps:{}};
  const save=async(key,value)=>{if(progress.steps[key])assert.deepEqual(progress.steps[key],value);else progress.steps[key]=value;
    await write(progressPath,progress,true);console.log(JSON.stringify({phase:key,retained:true}));};
  const attempt=path.join(directory,"attempts",new Date().toISOString().replaceAll(":","-")+"-"+randomUUID());
  await fs.mkdir(attempt,{recursive:true,mode:0o700});
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
  async function selected(url){return api(url,"/api/accession?id="+encodeURIComponent(intent.accession));}
  async function waitFor(fn,message){const start=Date.now();while(Date.now()-start<600000){const result=await fn();if(result)return result;await sleep(500);}throw Error(message);}
  async function choose(page,url){
    await page.goto(url);await page.locator("#tab-collections").click();
    await page.locator("#collection-select").selectOption(intent.accession);
    await page.locator("#collection-summary").filter({hasText:original.settings.title}).waitFor();
    await page.locator("#collection-review-note").waitFor({state:"visible"});
    await page.waitForFunction(()=>!document.querySelector("#collection-review-note").disabled);
  }
  async function download(page,locator,file,expected){
    const wait=page.waitForEvent("download");await locator.click();const dl=await wait;
    const temp=path.join(attempt,randomUUID()+"-"+dl.suggestedFilename());await dl.saveAs(temp);
    const bytes=await fs.readFile(temp);if(expected)assert.deepEqual({bytes:bytes.length,sha256:sha(bytes)},expected);
    await publish(file,bytes);return{file,bytes:bytes.length,sha256:sha(bytes)};
  }
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const issues=[];page.on("pageerror",e=>issues.push(e.message));
  let final;
  try{
    const live=await server(application,intent.workspace,"original");
    let observed=await selected(live.url);
    await choose(page,live.url);
    await page.screenshot({path:path.join(attempt,"01-original-desktop.png"),fullPage:true});
    const normalized={...review,note:review.note||"",decisions:[...review.decisions].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)};
    if(canonical(observed.review)!==canonical(normalized)){
      assert.equal(observed.revision,1,"Resume the original selected revision; do not overwrite later work.");
      await page.locator("#collection-review-import").setInputFiles(args["--review"]);
      await page.locator("#collection-review-reopen").click();
      await page.locator("#collection-merge-imported").waitFor({state:"visible"});
      await page.locator("#collection-merge-imported").click();
      await page.screenshot({path:path.join(attempt,"02-explicit-review-differences.png"),fullPage:true});
      await page.locator("#collection-merge-apply").click();
      await page.locator("#collection-save").click();
      observed=await waitFor(async()=>{const value=await selected(live.url);return canonical(value.review)===canonical(normalized)?value:null;},
        "The original following review was not observed; retain its current state.");
    }
    assert.equal(canonical(observed.review),canonical(normalized));
    assert.equal(observed.revision,2,"This manual programme selects one following review after native revision1.");
    await save("following-review",{revision:observed.revision,reviewSha256:observed.reviewSha256,inventorySha256:observed.inventory.sha256});
    await choose(page,live.url);
    const exportedReview=await download(page,page.locator("#collection-review-download"),path.join(directory,"review.json"));
    assert.equal(canonical(await read(exportedReview.file)),canonical(normalized));
    await save("review-download",exportedReview);

    let state=await api(live.url,"/api/state");
    let job=state.jobs.find(j=>j.kind==="collection-transfer"&&j.arguments?.id===intent.accession&&j.arguments?.expectedRevision===2);
    if(!job){await page.locator("#collection-build").click();}
    job=await waitFor(async()=>{
      const data=await api(live.url,"/api/state"),same=data.jobs.filter(j=>j.kind==="collection-transfer"&&j.arguments?.id===intent.accession&&j.arguments?.expectedRevision===2);
      assert(same.length<=1,"Multiple matching original build operations require explicit reconciliation.");
      const row=same[0];if(row&&["FAILED","INTERRUPTED"].includes(row.state))throw Error("Original build requires its retained recovery: "+row.id);
      return row?.state==="COMPLETED"?row:null;
    },"Original package is still pending.");
    await save("package-job",{id:job.id,artifact:job.result.artifact});
    await page.locator("#tab-delivery").click();
    await waitFor(async()=>page.locator('a[href="/download?id='+job.result.artifact.id+'"]').count(),"Package link did not appear.");
    await save("package-download",await download(page,page.locator('a[href="/download?id='+job.result.artifact.id+'"]'),
      path.join(directory,"reviewed-transfer.zip"),{bytes:job.result.artifact.bytes,sha256:job.result.artifact.sha256}));

    // Open the actual downloaded report and retain all package metadata attachments.
    // The maintained verifier and original BagReader read the ZIP; no substitute parser.
    const attachmentScript=String.raw`import base64,json,sys
sys.path.insert(0,sys.argv[1])
import collection_accession as c
import preservation as p
receipt=c.verify_bag(sys.argv[2])
reader=p.BagReader(sys.argv[2])
try:
    members={name:base64.b64encode(reader.read(name)).decode("ascii")
             for name in reader.names if name.startswith("data/metadata/")}
    print(json.dumps({"receipt":receipt,"members":members},ensure_ascii=False))
finally:
    reader.close()
`;
    const attachmentChild=spawn(python,["-B","-c",attachmentScript,path.join(application,"research/preservation"),
      progress.steps["package-download"].file],{stdio:["ignore","pipe","pipe",guard],env:{...process.env,COLLECTION_RECEIVING_GUARD:"3"}});
    processes.push(attachmentChild);let attachmentOut="",attachmentErrors="";
    attachmentChild.stdout.on("data",b=>attachmentOut+=b);attachmentChild.stderr.on("data",b=>attachmentErrors+=b);
    const attachmentCode=await new Promise((resolve,reject)=>{attachmentChild.once("error",reject);attachmentChild.once("exit",code=>resolve(code));});
    await publish(path.join(attempt,"attachment-read.txt"),attachmentErrors);
    assert.equal(attachmentCode,0,"The actual downloaded BagIt attachment did not verify.");
    const attachment=JSON.parse(attachmentOut),members={};
    assert.equal(attachment.receipt.identity.reviewSha256,observed.reviewSha256);
    for(const [name,encoded]of Object.entries(attachment.members)){
      assert(name.startsWith("data/metadata/")&&!name.split("/").some(p=>!p||p==="."||p===".."));
      const body=Buffer.from(encoded,"base64"),file=path.join(directory,"package-attachments",name);
      await publish(file,body);members[name]={file,bytes:body.length,sha256:sha(body)};
    }
    assert(members["data/metadata/review.html"]&&members["data/metadata/metadata.csv"]);
    await save("package-attachments",{verification:attachment.receipt,members});
    const report=await browser.newPage({viewport:{width:1440,height:1000}});
    report.on("pageerror",e=>issues.push(e.message));
    await report.goto(pathToFileURL(members["data/metadata/review.html"].file).href);
    await report.locator("table").waitFor();
    await report.screenshot({path:path.join(attempt,"07-downloaded-report-desktop.png"),fullPage:true});
    await report.setViewportSize({width:390,height:844});
    await report.screenshot({path:path.join(attempt,"08-downloaded-report-narrow.png"),fullPage:true});
    await report.close();

    state=await api(live.url,"/api/state");
    if(!progress.steps["export-intent"])await save("export-intent",{priorJobIds:state.jobs.map(j=>j.id)});
    const prior=new Set(progress.steps["export-intent"].priorJobIds);
    let exports=state.jobs.filter(j=>!prior.has(j.id)&&j.kind==="complete-export");
    assert(exports.length<=1,"More than one following export requires original-operation reconciliation.");
    if(!exports.length)await page.locator("#export-workspace").click();
    const exportJob=await waitFor(async()=>{
      const data=await api(live.url,"/api/state"),rows=data.jobs.filter(j=>!prior.has(j.id)&&j.kind==="complete-export");
      assert(rows.length<=1);const row=rows[0];
      if(row&&["FAILED","INTERRUPTED"].includes(row.state))throw Error("Use the original Activity Recover completed export action for "+row.id+", then resume this same programme.");
      return row?.state==="COMPLETED"?row:null;
    },"The original full export is still pending.");
    await save("export-job",{id:exportJob.id,artifact:exportJob.result.artifact});
    await waitFor(async()=>page.locator('a[href="/download?id='+exportJob.result.artifact.id+'"]').count(),"Complete delivery link did not appear.");
    const complete=await download(page,page.locator('a[href="/download?id='+exportJob.result.artifact.id+'"]'),path.join(directory,"complete.zip"),
      {bytes:exportJob.result.artifact.bytes,sha256:exportJob.result.artifact.sha256});
    await save("complete-download",complete);
    await page.screenshot({path:path.join(attempt,"03-complete-delivery.png"),fullPage:true});
    const received=path.join(directory,"received");
    const child=spawn(python,["-B",path.join(application,"research/preservation/workbench.py"),"receive","--source",complete.file,"--output",received],
      {stdio:["ignore","pipe","pipe",guard],env:{...process.env,COLLECTION_RECEIVING_GUARD:"3"}});
    processes.push(child);let stdout="",stderr="";child.stdout.on("data",b=>stdout+=b);child.stderr.on("data",b=>stderr+=b);
    const exit=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("exit",code=>resolve(code));});
    await publish(path.join(attempt,"cold-receive.txt"),stdout+"\n"+stderr);assert.equal(exit,0,"Cold receiver failed.");
    const receipt=JSON.parse(stdout);assert(receipt.received);
    await save("cold-receive",{directory:received,archive:receipt.archive});
    const cold=await server(path.join(received,"application"),path.join(received,"workspace"),"received");
    const reopened=await selected(cold.url);assert.equal(reopened.reviewSha256,observed.reviewSha256);
    assert.deepEqual(reopened.inventory,observed.inventory);assert.deepEqual(reopened.reviewHistory,observed.reviewHistory);
    await choose(page,cold.url);await page.screenshot({path:path.join(attempt,"04-received-desktop.png"),fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(attempt,"05-received-narrow.png"),fullPage:true});
    await page.locator("[data-collection-row]").first().click();
    await page.screenshot({path:path.join(attempt,"06-original-file-review-narrow.png"),fullPage:true});
    assert.deepEqual(issues,[],"Browser emitted an actual application error.");
    final={schema:"stellar-forge.collection-browser.v1.result",phase:"AUTOMATED_COURSE_COMPLETE",intent,
      steps:progress.steps,attempt,sourceInventorySha256:reopened.inventory.sha256,reviewSha256:reopened.reviewSha256,
      visualAcceptance:"PENDING_PRODUCER_LOOK: inspect all eight actual desktop/narrow screenshots and complete downloaded review, metadata, report and original files."};
    await write(path.join(attempt,"result.json"),final);await write(path.join(directory,"LATEST.json"),final,true);
    console.log(JSON.stringify(final));
  }catch(error){
    await write(path.join(attempt,"FAILED.json"),{error:error.message,stack:error.stack,steps:progress.steps});
    throw error;
  }finally{
    await browser.close();
    for(const child of processes)if(child.exitCode===null&&child.signalCode===null){child.kill("SIGTERM");
      await new Promise(resolve=>{child.once("exit",resolve);setTimeout(resolve,10000);});}
    assert(processes.every(child=>child.exitCode!==null||child.signalCode!==null),"An original child remains active; retain its inherited guard and reconcile before restarting.");
  }
}
