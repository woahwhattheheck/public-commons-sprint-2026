import {runNdtmsBrowserCourse,runNdtmsReceivedCourse} from "./ndtms-browser-course.mjs";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL,fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const abort = new AbortController();
const interrupted = () => abort.abort(new Error("The original browser receiving was interrupted."));
process.on("SIGINT", interrupted);
process.on("SIGTERM", interrupted);
const stop = () => abort.signal.throwIfAborted();
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const stable = value => value === null || typeof value !== "object" ? JSON.stringify(value) :
  Array.isArray(value) ? "[" + value.map(stable).join(",") + "]" :
  "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}";
const check = (value, message) => { if (!value) throw new Error(message); };
const input = [];
for await (const chunk of process.stdin) { input.push(chunk); check(input.reduce((n,x)=>n+x.length,0) <= 1024*1024,"The private browser input is too large."); }
const config = JSON.parse(Buffer.concat(input).toString("utf8"));
check(["nelc.browser-receiving/v1","nelc.ndtms-browser-receiving/v1"].includes(config.schema) && ["source","received"].includes(config.phase),"Select the original browser receiving phase.");
const origin = new URL(config.baseUrl);
check(origin.protocol === "http:" && origin.hostname === "127.0.0.1" && origin.pathname === "/","Use the actual owned local listener.");
const session = new URL(config.sessionUrl);
check(session.origin === origin.origin,"The local session must belong to the selected listener.");
const token = new URLSearchParams(session.hash.slice(1)).get("token");
check(/^[a-f0-9]{64}$/.test(token || ""),"The current listener's session token is required.");
const root = path.resolve(config.output);
await fs.mkdir(root,{recursive:true});
const journalPath = path.join(root,"browser.json");
const ndtms=config.schema==="nelc.ndtms-browser-receiving/v1";
const selection = ndtms ? {schema:"nelc.ndtms-browser-selection/v1",phase:config.phase,
  operationId:config.operationId,workspaceId:config.workspaceId,receiveName:config.receiveName||null,
  nativeResultSha256:sha(Buffer.from(stable(config.nativeResult))),
  sourceBrowserResultSha256:config.sourceBrowserResult?sha(Buffer.from(stable(config.sourceBrowserResult))):null,
  attachments:config.attachments||[]} : {schema:"nelc.browser-selection/v1",phase:config.phase,operationId:config.operationId,
  workspaceId:config.workspaceId,editionId:config.editionId,contractId:config.contractId,
  reportId:config.reportId,quarter:config.quarter,receiveName:config.receiveName};
let journal;
try { journal=JSON.parse(await fs.readFile(journalPath,"utf8")); check(stable(journal.selection)===stable(selection),"The retained browser phase has another original selection."); }
catch(error) { if(error.code!=="ENOENT") throw error; journal={schema:"nelc.browser-journal/v1",selection,createdAt:new Date().toISOString(),requests:{},evidence:{},screenshots:[],status:"PREPARED"}; }
async function atomic(file,bytes) {
  const pending=file+".receiving";
  const prior=await fs.lstat(pending).catch(error=>{if(error.code==="ENOENT")return null;throw error;});
  check(!prior || prior.isFile() && !prior.isSymbolicLink(),"An owned browser staging path is not ordinary.");
  const stream=await fs.open(pending,"w",0o600);
  try { await stream.writeFile(bytes); await stream.sync(); } finally { await stream.close(); }
  await fs.rename(pending,file);
}
let journalWrite=Promise.resolve();
function save() {
  journal.updatedAt=new Date().toISOString();
  const bytes=Buffer.from(JSON.stringify(journal,null,2)+"\n");
  journalWrite=journalWrite.then(()=>atomic(journalPath,bytes));
  return journalWrite;
}
async function fileReceipt(file) {
  const stat=await fs.stat(file),hash=crypto.createHash("sha256"),handle=await fs.open(file,"r");
  try { const buffer=Buffer.alloc(1024*1024);let count=0;
    while(true){stop();const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;count+=bytesRead;hash.update(buffer.subarray(0,bytesRead));}
    check(count===stat.size,"The retained file changed while hashing.");return {path:file,bytes:count,sha256:hash.digest("hex")};
  } finally { await handle.close(); }
}
async function api(relative,options={}) {
  stop();
  const response=await fetch(new URL(relative,origin),{...options,signal:abort.signal,
    headers:{"Authorization":"Bearer "+token,...(options.body?{"Content-Type":"application/json"}:{}),...(options.headers||{})}});
  const raw=await response.text();let value;
  try{value=JSON.parse(raw);}catch{throw new Error("The original operator returned a non-JSON response: "+response.status);}
  if(!response.ok){const error=new Error(value.error?.message||"Operator request failed.");error.code=value.error?.code;error.details=value.error?.details;throw error;}
  return value;
}
async function originalTask(label) {
  const input=journal.requests[label];
  check(input,"The original UI request was not retained before dispatch.");
  let value;
  try{value=await api("/api/tasks/"+encodeURIComponent(input.id));}
  catch(error){if(error.code!=="TASK_MISSING")throw error;value=await api("/api/tasks",{method:"POST",body:JSON.stringify(input)});}
  check(stable(value.input)===stable(input),"The original task ID has different retained input.");
  if(value.state==="INTERRUPTED")value=await api("/api/tasks",{method:"POST",body:JSON.stringify({...input,resume:true})});
  const deadline=Date.now()+20*60*1000;
  while(["RUNNING","QUEUED"].includes(value.state)){
    stop();check(Date.now()<deadline,"The original task remains active; continue this same retained task.");
    await sleep(300,undefined,{signal:abort.signal});
    value=await api("/api/tasks/"+encodeURIComponent(input.id));
    check(stable(value.input)===stable(input),"The original task input changed while waiting.");
  }
  check(value.state==="COMPLETED","Original task "+input.id+" ended "+value.state+": "+(value.error?.message||""));
  journal.evidence[label]={id:input.id,inputSha256:value.inputSha256,result:value.result,state:"COMPLETED"};
  await save();return value.result;
}

let browser,context,page,browserPromise,contextPromise,closePromise,activeTask;
const pageErrors=[],requestErrors=[];
function closeOwned() {
  if(closePromise)return closePromise;
  closePromise=(async()=>{
    const failures=[];
    if(browserPromise)try{browser=await browserPromise;}catch{}
    if(contextPromise)try{context=await contextPromise;}catch{}
    if(context)try{await context.close();context=null;}catch(error){failures.push(error);}
    if(browser)try{await browser.close();browser=null;}catch(error){failures.push(error);}
    if(failures.length)throw failures[0];
  })();
  return closePromise;
}
abort.signal.addEventListener("abort",()=>{void closeOwned().catch(()=>{});});
async function start() {
  const {chromium}=await import(pathToFileURL(path.resolve(config.playwright)).href);
  stop();
  browserPromise=chromium.launch({executablePath:config.chromium,headless:true,args:["--no-sandbox","--disable-dev-shm-usage"],timeout:60000});
  browser=await browserPromise;stop();
  contextPromise=browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  context=await contextPromise;stop();page=await context.newPage();stop();
  page.setDefaultTimeout(45000);
  page.on("pageerror",error=>pageErrors.push({message:error.message,at:new Date().toISOString()}));
  page.on("requestfailed",request=>{if(!abort.signal.aborted)requestErrors.push({url:new URL(request.url()).pathname,error:request.failure()?.errorText});});
  await page.route("**/api/tasks",async route=>{
    if(route.request().method()!=="POST")return route.continue();
    try{
      stop();const input=route.request().postDataJSON();const label=activeTask;
      check(label,"A UI task was submitted without an original native phase selection.");
      if(journal.requests[label])check(stable(journal.requests[label])===stable(input),"The UI prepared different input for an already retained original step.");
      else journal.requests[label]=input;
      await save();stop();await route.continue();
    }catch(error){pageErrors.push({message:error.message,at:new Date().toISOString()});await route.abort("aborted");}
  });
  await page.goto(config.sessionUrl,{waitUntil:"domcontentloaded"});await ready("overview");
  const observed=await api("/api/overview");
  check(observed.workspace.id===config.workspaceId,"The actual UI opened a different workspace.");
}
async function ready(view,afterGeneration=-1) {
  await page.waitForFunction(({view,afterGeneration})=>{
    const main=document.querySelector("#main");
    return main?.dataset.view===view && main.getAttribute("aria-busy")==="false" && Number(main.dataset.generation)>afterGeneration;
  },{view,afterGeneration});
  check(await page.locator("#main .page-header h1").count()===1,"The "+view+" view did not finish with its native source.");
  const notice=page.locator("#notice.error:not(.hidden)");
  if(await notice.count())throw new Error("The operator reported an input/application error: "+await notice.textContent());
}
async function open(view) {
  stop();
  if(new URL(page.url()).hash!=="#"+view)await page.locator('#navigation a[href="#'+view+'"]').click();
  await ready(view);
}
async function shot(name) {
  stop();const file=path.join(root,name+".png");
  if(!journal.screenshots.some(x=>x.name===name)){
    await page.screenshot({path:file,fullPage:true});
    journal.screenshots.push({name,...await fileReceipt(file)});await save();
  }else{
    const original=journal.screenshots.find(x=>x.name===name),current=await fileReceipt(file);
    check(current.sha256===original.sha256&&current.bytes===original.bytes,"A retained browser image changed.");
  }
}
async function originalUIAction(label,action) {
  if(!journal.requests[label]){
    activeTask=label;
    try{
      await action();
      const deadline=Date.now()+45000;
      while(!journal.requests[label]){stop();check(Date.now()<deadline,"The UI did not dispatch its prepared original task.");await sleep(50,undefined,{signal:abort.signal});}
    }finally{activeTask=null;}
  }
  const result=await originalTask(label);
  await page.waitForFunction(()=>document.documentElement.dataset.pendingActions==="0");
  await ready(new URL(page.url()).hash.slice(1)||"overview");
  const dialog=page.locator("#record-dialog");
  if(await dialog.isVisible())await dialog.locator("[data-close-dialog]").click();
  const generation=Number(await page.locator("#main").getAttribute("data-generation"));
  await page.locator("#refresh").click();await ready(new URL(page.url()).hash.slice(1)||"overview",generation);
  return result;
}
async function explicitReport() {
  await open("reports");
  const edition=await api("/api/record?"+new URLSearchParams({kind:"edition",id:config.editionId}));
  const source=edition.tables.find(x=>x.name==="stat-stop-smok-serv-eng-2025-26-q4.csv");
  check(source&&source.rows===110188,"The original full NHS service table is missing.");
  const index=name=>{const value=source.headers.indexOf(name);check(value>=0,"The original source header is missing: "+name);return value;};
  const label="operator-report";
  const result=await originalUIAction(label,async()=>{
    let generation=Number(await page.locator("#main").getAttribute("data-generation"));
    await page.getByLabel("Source edition",{exact:true}).selectOption(config.editionId);await ready("reports",generation);
    generation=Number(await page.locator("#main").getAttribute("data-generation"));
    await page.getByLabel("Source table",{exact:true}).selectOption(source.id);await ready("reports",generation);
    const detail=page.locator("details").filter({has:page.locator("summary").filter({hasText:"Build another explicit report"})});
    if(await detail.getAttribute("open")===null)await detail.locator("summary").click();
    const form=detail.locator("form");
    await form.getByLabel("Report name",{exact:true}).fill("NELC "+config.phase+" operator — original published quarter "+config.quarter);
    for(const name of ["FinancialYear","OrgType","OrgCode","Quarter","Sex","MonitoringCategoryType","MonitoringCategory"])
      await form.locator('input[name="dimensions"][value="'+index(name)+'"]').check();
    for(const name of ["Set quit date","Quit","Quit (%)"]){
      const i=index(name);await form.locator('input[name="metric"][value="'+i+'"]').check();
      await form.locator('select[name="kind'+i+'"]').selectOption(name.includes("%")?"percentage":"count");
      await form.locator('input[name="unit'+i+'"]').fill(name.includes("%")?"%":"people as published");
    }
    const filters=[["OrgCode","E06000012"],["Sex","All persons"],["MonitoringCategoryType","Age band"],["MonitoringCategory","All ages"],["Quarter",config.quarter]].map(([name,value])=>({column:index(name),value}));
    await form.getByLabel("Filters as original column index/value pairs",{exact:true}).fill(JSON.stringify(filters));
    await form.getByLabel("Period and source basis",{exact:true}).fill("2025-04-01 to 2026-03-31, original published quarter "+config.quarter);
    await form.getByLabel("Population and comparison purpose",{exact:true}).fill("Read the exact retained E06000012 / All persons / Age band / All ages row for the selected original quarter, with no aggregation or inferred cohort interpretation.");
    await form.getByRole("button",{name:"Retain source-row report",exact:true}).click();
  });
  check(result.action==="report"&&result.result.editionId===config.editionId&&result.result.complete&&result.result.rows===1,
        "The original UI report did not retain one complete explicitly selected source row.");
  const report=result.result;
  await open("reports");const generation=Number(await page.locator("#main").getAttribute("data-generation"));
  await page.getByLabel("Report",{exact:true}).selectOption(report.id);await ready("reports",generation);
  await shot(config.phase+"-reported-source-values");
  const reportPanel=page.locator("section.panel").filter({has:page.getByRole("heading",{name:"Retained report",exact:true})});
  const file=path.join(root,"Operator_Original_Quarter_Report.csv");
  if(!journal.evidence.reportDownload){
    const waiting=page.waitForEvent("download");
    await reportPanel.getByRole("button",{name:"report.csv",exact:true}).click();
    const download=await waiting;await download.saveAs(file+".receiving");
    const received=await fileReceipt(file+".receiving");
    check(received.sha256===report.artifact.sha256&&received.bytes===report.artifact.bytes,"The UI report download differs from its retained artifact.");
    await fs.rename(file+".receiving",file);
    journal.evidence.reportDownload={...received,path:file,reportId:report.id};await save();
  }else{
    const current=await fileReceipt(file);check(current.sha256===journal.evidence.reportDownload.sha256,"The original report download changed.");
  }
  return report;
}
async function inspectViews() {
  for(const view of ["sources","contracts","findings","reports","releases","returns","changes","recovery","local","delivery","history"]){
    await open(view);
    journal.evidence["view-"+view]={title:await page.locator("#main .page-header h1").innerText(),observedAt:new Date().toISOString()};
    if(["sources","contracts","changes","recovery","delivery"].includes(view))await shot(config.phase+"-"+view);
  }
  await open("overview");
  await page.setViewportSize({width:390,height:844});
  await ready("overview");
  const width=await page.evaluate(()=>({body:document.documentElement.scrollWidth,viewport:innerWidth}));
  check(width.body<=width.viewport+2,"The operator overflows the mobile viewport.");
  await shot(config.phase+"-mobile-overview");
  await page.getByRole("button",{name:"Open navigation",exact:true}).click();
  check(await page.locator('.shell.menu-open').count()===1,"The mobile navigation did not open.");
  await page.setViewportSize({width:1440,height:1000});
  await open("overview");
}
async function backupAndReceive() {
  await open("delivery");
  const receipt=await originalUIAction("complete-backup",async()=>{
    await page.getByRole("button",{name:"Freeze complete workspace & application",exact:true}).click();
  });
  check(receipt.schema==="nelc.backup-receipt/v1"&&receipt.selection.workspaceId===config.workspaceId,"The UI froze another workspace.");
  const file=path.join(root,"Original_Complete_Workspace.zip");
  if(!journal.evidence.backupDownload){
    const dialog=page.locator("#record-dialog");
    if(await dialog.isVisible())await dialog.locator("[data-close-dialog]").click();
    await open("delivery");
    const row=page.locator("tr").filter({hasText:receipt.id});
    const waiting=page.waitForEvent("download");
    await row.getByRole("button",{name:"Complete ZIP",exact:true}).click();
    const download=await waiting;await download.saveAs(file+".receiving");
    const actual=await fileReceipt(file+".receiving");
    check(actual.sha256===receipt.sha256&&actual.bytes===receipt.bytes,"The complete UI backup download differs from its original receipt.");
    await fs.rename(file+".receiving",file);
    journal.evidence.backupDownload={...actual,path:file};await save();
  }else{
    const actual=await fileReceipt(file);check(actual.sha256===receipt.sha256&&actual.bytes===receipt.bytes,"The retained original downloaded backup changed.");
  }
  const receiving=await originalUIAction("complete-receiving",async()=>{
    await open("delivery");
    const panel=page.locator("section.panel").filter({has:page.getByRole("heading",{name:"Receive into a fresh owned directory",exact:true})});
    await panel.getByLabel("Complete original portable ZIP",{exact:true}).setInputFiles(file);
    await panel.getByLabel("Fresh receiving directory name",{exact:true}).fill(config.receiveName);
    await panel.getByRole("button",{name:"Verify & receive complete workspace",exact:true}).click();
  });
  check(receiving.schema==="nelc.receiving-receipt/v1"&&receiving.archiveSha256===receipt.sha256&&receiving.originalWorkspace.id===config.workspaceId,
        "The actual operator receiving did not retain the original full workspace.");
  if(await page.locator("#record-dialog").isVisible())await page.locator("#record-dialog [data-close-dialog]").click();
  await open("history");await shot("source-original-tasks-and-history");
  return {backup:receipt,backupPath:file,receiving};
}

async function verifyNdtmsSelection(){
  if(!ndtms)return;
  {
    check(config.nativeResult?.schema==="nelc.ndtms-native-result/v1"&&config.nativeResult.sourceWorkspaceId===config.workspaceId,"Use the exact completed native source selection.");
    const applicationRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
    const applicationRaw=await fs.readFile(path.join(applicationRoot,"APPLICATION.json"));
    check(sha(applicationRaw)===config.nativeResult.selection.applicationSha256,"The browser source is not the frozen native application.");
    const application=JSON.parse(applicationRaw);
    for(const item of application.files){
      const relative=path.posix.normalize(item.path);
      check(relative===item.path&&!relative.startsWith("../")&&!path.isAbsolute(relative),"The application source path is not relative.");
      const body=await fs.readFile(path.join(applicationRoot,relative));
      check(body.length===item.bytes&&sha(body)===item.sha256,"An original application member changed: "+relative);
    }
    for(const [url,file] of [["/","index.html"],["/app.mjs","app.mjs"],["/ndtms.mjs","ndtms.mjs"],["/style.css","style.css"]]){
      const response=await fetch(new URL(url,origin),{signal:abort.signal,headers:{Authorization:"Bearer "+token}});
      check(response.ok,"The actual original application route is unavailable.");
      const body=Buffer.from(await response.arrayBuffer()),expected=application.files.find(x=>x.path==="operator/web/"+file);
      check(expected&&body.length===expected.bytes&&sha(body)===expected.sha256,"The current served UI differs from the exact installed source: "+file);
    }
  }
  for(const attachment of config.attachments||[]){
    const stat=await fs.lstat(attachment.path);
    check(stat.isFile()&&!stat.isSymbolicLink(),"The selected attachment is not an ordinary file.");
    const actual=await fileReceipt(attachment.path);
    check(actual.bytes===attachment.bytes&&actual.sha256===attachment.sha256,"An exact selected outgoing attachment changed.");
  }
}

try {
  await save();
  await verifyNdtmsSelection();
  await start();
  if(ndtms){
    if(journal.status!=="COMPLETE"){
      journal.status="RUNNING";await save();
      const runtime={api,open,ready,shot,originalUIAction,backupAndReceive,journal,save,fileReceipt,stop};
      const course=config.phase==="source"
        ? await runNdtmsBrowserCourse({page,context,outputDirectory:root,nativeResult:config.nativeResult,sessionUrl:config.sessionUrl,attachments:config.attachments||[],runtime})
        : await runNdtmsReceivedCourse({page,context,outputDirectory:root,nativeResult:config.nativeResult,sourceBrowserResult:config.sourceBrowserResult,runtime});
      check(pageErrors.length===0,"The actual page raised a runtime error: "+JSON.stringify(pageErrors));
      check(requestErrors.length===0,"An actual operator request failed: "+JSON.stringify(requestErrors));
      await verifyNdtmsSelection();
      journal.result={schema:"nelc.ndtms-browser-result/v1",status:"COMPLETE",phase:config.phase,workspaceId:config.workspaceId,course,
        taskIds:Object.fromEntries(Object.entries(journal.requests).map(([name,input])=>[name,input.id])),
        screenshots:journal.screenshots,pageErrors,requestErrors,completedAt:new Date().toISOString()};
      journal.status="COMPLETE";await save();
    }else{
      for(const receipt of journal.screenshots){const actual=await fileReceipt(receipt.path);check(actual.sha256===receipt.sha256&&actual.bytes===receipt.bytes,"A retained original browser image changed.");}
      const visit=async value=>{
        if(!value||typeof value!=="object")return;
        if(typeof value.path==="string"&&Number.isSafeInteger(value.bytes)&&/^[a-f0-9]{64}$/.test(value.sha256||"")){
          const actual=await fileReceipt(value.path);check(actual.bytes===value.bytes&&actual.sha256===value.sha256,"A complete original browser output changed.");
        }
        for(const child of Object.values(value))await visit(child);
      };
      await visit(journal.evidence);
      for(const label of Object.keys(journal.requests))await originalTask(label);
    }
    await verifyNdtmsSelection();
    await closeOwned();process.stdout.write(JSON.stringify(journal.result,null,2)+"\n");
  }else{
  let report,portable={};
  if(journal.status!=="COMPLETE"){
    journal.status="RUNNING";await save();
    await inspectViews();report=await explicitReport();
    if(config.phase==="source")portable=await backupAndReceive();
    const overview=await api("/api/overview");
    check(overview.workspace.id===config.workspaceId,"The final browser workspace identity changed.");
    check(pageErrors.length===0,"An actual page/runtime error occurred: "+JSON.stringify(pageErrors));
    check(requestErrors.length===0,"An actual operator request failed: "+JSON.stringify(requestErrors));
    const result={schema:"nelc.browser-result/v1",status:"COMPLETE",phase:config.phase,workspaceId:config.workspaceId,
      revision:overview.workspace.revision,reportId:report.id,reportDownload:journal.evidence.reportDownload,
      screenshots:journal.screenshots,taskIds:Object.fromEntries(Object.entries(journal.requests).map(([name,input])=>[name,input.id])),
      ...portable,pageErrors,requestErrors,completedAt:new Date().toISOString()};
    journal.result=result;journal.status="COMPLETE";await save();
  }else{
    for(const receipt of journal.screenshots){const actual=await fileReceipt(receipt.path);check(actual.sha256===receipt.sha256&&actual.bytes===receipt.bytes,"A retained browser artifact changed.");}
    for(const label of Object.keys(journal.requests))await originalTask(label);
  }
  await closeOwned();
  process.stdout.write(JSON.stringify(journal.result,null,2)+"\n");

  }
} catch(error) {
  journal.status=abort.signal.aborted?"INTERRUPTED":"ATTENTION";
  journal.failure={message:error.message,observedAt:new Date().toISOString()};
  await save().catch(()=>{});
  await closeOwned().catch(closeError=>{process.stderr.write(JSON.stringify({error:"OWNED_BROWSER_CLOSE",message:closeError.message})+"\n");});
  process.stderr.write(JSON.stringify({schema:"nelc.browser-failure/v1",status:journal.status,message:error.message,phase:config.phase})+"\n");
  process.exitCode=abort.signal.aborted?130:1;
} finally {
  process.removeListener("SIGINT",interrupted);process.removeListener("SIGTERM",interrupted);
}
