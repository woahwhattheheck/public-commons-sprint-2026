"use strict";
/* Actual staff editor, original saved command recovery, full archive download,
 * receiving and complete desktop/phone view review. No County writes. */
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {createRequire}=require("node:module");
const input=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const root=path.resolve(input.directory);fs.mkdirSync(root,{recursive:true,mode:0o700});
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const need=(v,m)=>{if(!v)throw Error(m);};
function retain(name,value,immutable=true){
 const target=path.join(root,name),raw=Buffer.isBuffer(value)?value:Buffer.from(stable(value));
 if(immutable&&fs.existsSync(target)){need(fs.readFileSync(target).equals(raw),"Original browser record differs: "+name);return;}
 fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
 const tmp=target+".partial",fd=fs.openSync(tmp,"w",0o600);
 try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(tmp,target);const dir=fs.openSync(path.dirname(target),"r");try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
function saved(name){const p=path.join(root,name);return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,"utf8")):null;}
const identity=Object.fromEntries(Object.entries(input).filter(([k])=>!["url","origin"].includes(k)));
retain("input.json",identity);
const token=new URL(input.url).hash.slice(1);
need(token&&new URL(input.url).origin===input.origin,"Use the original private application launch URL");
let owner=null,page=null;const errors=[],httpErrors=[],screenshots=[],geometry=[];
let activeStage=null, launchReceipt=null, launchName=null;
const profile=path.join(root,"profile");
function environmentIdentity(){
 need(process.platform==="linux","Original browser custody requires Linux process identity");
 return {bootId:fs.readFileSync("/proc/sys/kernel/random/boot_id","utf8").trim(),
   pidNamespace:fs.readlinkSync("/proc/self/ns/pid")};
}
function processIdentity(pid){
 try {
  const st=fs.readFileSync("/proc/"+pid+"/stat","utf8"),tail=st.slice(st.lastIndexOf(")")+2).split(/\s+/);
  const cmd=fs.readFileSync("/proc/"+pid+"/cmdline"),exe=fs.realpathSync("/proc/"+pid+"/exe");
  return {pid:Number(pid),startTicks:tail[19],exe,commandSha256:sha(cmd),arguments:cmd.toString("utf8").split("\0").filter(Boolean)};
 }catch(e){if(["ENOENT","ESRCH"].includes(e.code))return null;throw e;}
}
function sameProcess(a,b){return !!a&&!!b&&a.pid===b.pid&&a.startTicks===b.startTicks&&a.exe===b.exe&&a.commandSha256===b.commandSha256;}
function profileProcesses(){
 const result=[];
 for(const pid of fs.readdirSync("/proc").filter(x=>/^[0-9]+$/.test(x))){
  let cmd;
  try{cmd=fs.readFileSync("/proc/"+pid+"/cmdline").toString("utf8").split("\0").filter(Boolean);}
  catch(e){if(["ENOENT","ESRCH"].includes(e.code))continue;throw Error("Cannot establish original browser absence: "+e.code);}
  const selected=cmd.some((x,i)=>x==="--user-data-dir="+profile||x==="--user-data-dir"&&cmd[i+1]===profile);
  if(selected){const actual=processIdentity(pid);if(actual)result.push(actual);}
 }
 return result;
}
function prepareLaunch(){
 const env=environmentIdentity(),prior=saved("browser-owner.json");
 if(prior&&prior.state!=="CLOSED"){
  need(stable(prior.environment)===stable(env),"Prior browser launch belongs to another PID namespace or boot; original ownership remains unresolved");
  const parent=processIdentity(prior.owner.pid);
  need(!sameProcess(prior.owner,parent),"Original browser owner still exists; keep its existing operation");
  const remaining=profileProcesses();
  need(remaining.length===0,"Original profile still has a browser process; reconcile that exact owner before another launch");
  const settled={...prior,state:"CLOSED",closedAt:new Date().toISOString(),closure:"Original Node owner absent and complete same-namespace profile scan empty"};
  retain(prior.recordPath,settled,false);retain("browser-owner.json",settled,false);
 }
 need(profileProcesses().length===0,"Selected original browser profile is already owned");
 const attempt=prior?prior.attempt+1:0;launchName="launches/"+String(attempt).padStart(5,"0")+".json";
 launchReceipt={schema:"geocove.browser-owner.v1",state:"STARTING",attempt,recordPath:launchName,
   operationId:input.operationId,environment:env,owner:(()=>{const visible=Number(fs.readFileSync("/proc/self/stat","utf8").split(" ",1)[0]);const original=processIdentity(visible);need(original,"Original Node owner identity is unavailable");return {...original,namespacePid:process.pid};})(),profile,
   executable:fs.realpathSync(input.executablePath),at:new Date().toISOString(),processes:[]};
 retain(launchName,launchReceipt);retain("browser-owner.json",launchReceipt,false);
}
function acceptedLaunch(){
 const processes=profileProcesses();
 need(processes.length>0&&processes.some(x=>x.exe===launchReceipt.executable),"Actual launched original browser process is not identifiable");
 launchReceipt={...launchReceipt,state:"RUNNING",processes,acceptedAt:new Date().toISOString()};
 retain(launchName,launchReceipt,false);retain("browser-owner.json",launchReceipt,false);
}
async function closeOwner(){
 if(owner){await owner.close();owner=null;}
 if(launchReceipt){
  need(stable(environmentIdentity())===stable(launchReceipt.environment),"Browser closure namespace changed");
  need(profileProcesses().length===0,"Original browser process remains after context close");
  launchReceipt={...launchReceipt,state:"CLOSED",closedAt:new Date().toISOString(),closure:"Owned Playwright context closed and exact profile processes absent"};
  retain(launchName,launchReceipt,false);retain("browser-owner.json",launchReceipt,false);
 }
}

async function api(endpoint,body){
 const r=await fetch(input.origin+endpoint,{method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json","X-Workspace-Id":body.workspaceId,"X-Workspace-Directory":body.workspaceDirectory},body:JSON.stringify(body)});
 const value=await r.json();need(r.ok&&!value.error,"Original browser recovery failed: "+JSON.stringify(value));return value;
}
async function reconcile(stage,endpoint){
 const old=saved("actions/"+stage+".input.json");if(!old)return null;
 need(old.endpoint===endpoint,"Original browser request endpoint differs");
 const result=await api(endpoint,old.body),prior=saved("actions/"+stage+".result.json");
 if(prior){
  if(endpoint==="/api/command"){
   const clean=x=>Object.fromEntries(Object.entries(x).filter(([k])=>k!=="reused"));
   need(stable(clean(prior))===stable(clean(result)),"Recovered original command result differs");
  }else if(endpoint==="/api/export"){
   need(prior.sha256===result.sha256&&prior.bytes===result.bytes&&stable(prior.manifest)===stable(result.manifest),"Recovered original export differs");
  }else{
   need(stable(prior.receipt)===stable(result.receipt)&&prior.sha256===result.sha256&&prior.bytes===result.bytes,"Recovered original receiving binding differs");
  }
  return prior;
 }
 retain("actions/"+stage+".result.json",result);return result;
}
async function go(section){
 await page.locator('nav button[data-section="'+section+'"]').click();
 await page.locator('nav button.active[data-section="'+section+'"]').waitFor();
 await page.waitForFunction(()=>document.querySelector("#content")?.querySelectorAll("section.panel").length>0);
 await page.waitForLoadState("networkidle");
 const failure=await page.locator("#status").evaluate(x=>x.classList.contains("error")?x.textContent:null);
 need(!failure,"Actual editor reported: "+failure);
}
async function photograph(name,scope="#content"){
 await page.evaluate(()=>window.scrollTo(0,0));
 const found=await page.evaluate(scope=>{
  const width=document.documentElement.clientWidth;
  const outside=[...document.querySelectorAll(scope+" button,"+scope+" input,"+scope+" select,"+scope+" textarea")].filter(x=>{
   const s=getComputedStyle(x),r=x.getBoundingClientRect();
   return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&(r.left<-2||r.right>width+2);
  }).map(x=>({tag:x.tagName,name:x.getAttribute("name"),label:(x.textContent||x.getAttribute("aria-label")||"").slice(0,120)}));
  return{viewport:width,scrollWidth:document.documentElement.scrollWidth,title:document.querySelector(scope+" .page-title,"+scope+" h1,"+scope+" h2")?.textContent,
   textLength:document.querySelector(scope)?.innerText.length||0,outside};
 },scope);
 need(found.textLength>50,"Main customer view is empty: "+name);
 need(found.scrollWidth<=found.viewport+2,"Page exceeds viewport: "+name);
 // A real horizontally scrollable original data table is allowed; editor controls are not.
 need(found.outside.length===0,"Editor control leaves viewport: "+name+" "+JSON.stringify(found.outside));
 const file=path.join(root,"screenshots",name+".png");fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 await page.screenshot({path:file,fullPage:true});const b=fs.readFileSync(file);
 screenshots.push({name,path:file,bytes:b.length,sha256:sha(b)});geometry.push({name,...found});
}
async function main(){
 const prior=saved("result.json");
 if(prior){need(prior.state==="COMPLETE"&&prior.inputSha256===sha(Buffer.from(stable(identity))),"Original completed browser selection differs");
  for(const f of prior.screenshots){const b=fs.readFileSync(f.path);need(b.length===f.bytes&&sha(b)===f.sha256,"Original screenshot changed");}return prior;}
 let playwright;
 try{playwright=require("playwright");}
 catch{const root=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;need(root,"Original Playwright dependency path is required");playwright=createRequire(path.join(root,"__highway_runtime.cjs"))("playwright");}
 try{
  prepareLaunch();
  owner=await playwright.chromium.launchPersistentContext(profile,{
   executablePath:input.executablePath,headless:true,args:["--no-sandbox","--disable-gpu"],
   viewport:{width:1440,height:1000},deviceScaleFactor:1,acceptDownloads:true});
  acceptedLaunch();
  page=owner.pages()[0]||await owner.newPage();
  page.on("pageerror",e=>errors.push(String(e)));
  page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
  page.on("response",r=>{if(r.url().startsWith(input.origin+"/api/")&&r.status()>=400)httpErrors.push({url:r.url().split("?")[0],status:r.status()});});
  await page.route(input.origin+"/api/**",async route=>{
   const request=route.request(),endpoint=new URL(request.url()).pathname;
   if(activeStage&&request.method()==="POST"&&["/api/command","/api/export","/api/receive"].includes(endpoint)){
    const record={endpoint,body:request.postDataJSON()};
    if(endpoint==="/api/command")need(stable(record.body.command.actor)===stable(input.actor),"Actual UI command changed the original operator identity");
    retain("actions/"+activeStage+".input.json",record);
   }
   await route.continue();
  });
  await page.goto(input.url,{waitUntil:"domcontentloaded"});
  await page.locator('nav button[data-section="sources"]').waitFor();
  await page.waitForFunction(()=>document.querySelector("#content .panel"));
  await page.waitForLoadState("networkidle");
  // The first request is the editor's own authentic capability fetch.
  const current=await page.evaluate(()=>({id:model.state.id,revision:model.revision,sourceSha256:model.sourceSha256}));
  need(current.id===input.workspaceId&&current.sourceSha256===input.sourceSha256,"Opened another original workspace or selected application source");
  need(input.actor&&typeof input.actor.id==="string"&&input.actor.id.length>0&&typeof input.actor.name==="string"&&input.actor.name.length>0,"Original operator identity is required");
  const operator=page.locator("section.panel").filter({has:page.getByRole("heading",{name:"Your operating context",exact:true})});
  await operator.getByLabel("Operator name",{exact:true}).fill(input.actor.name);
  await operator.getByLabel("Operator reference",{exact:true}).fill(input.actor.id);
  await operator.getByRole("button",{name:"Use this operator",exact:true}).click();
  const selectedActor=await page.evaluate(()=>actor());
  need(stable(selectedActor)===stable(input.actor),"The actual interface did not retain the original operator identity");
  await go("followup");
  const oldReport=await reconcile("operating-report","/api/command");
  if(!oldReport){
   const form=page.locator("section.panel").filter({has:page.getByRole("heading",{name:"Freeze the operating handover",exact:true})}).locator("form");
   await form.locator('[name="title"]').fill("Receiving operator — complete Highway handover");
   await form.locator('[name="notes"]').fill("Actual source capture, approved local commissioning proposal, original paired review and complete cold receiving. No County service edit.");
   activeStage="operating-report";
   const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/command"&&r.request().method()==="POST");
   await form.getByRole("button",{name:"Save",exact:true}).click();
   const r=await response;const value=await r.json();need(r.ok()&&!value.error,"Actual handover Save failed");
   retain("actions/operating-report.result.json",value);activeStage=null;
  }else await page.evaluate(()=>refresh());
  await go("transfer");
  let exported=await reconcile("workspace-export","/api/export");
  if(!exported){
   activeStage="workspace-export";
   const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/export"&&r.request().method()==="POST");
   await page.getByRole("button",{name:/Prepare complete handover|Continue original export/}).click();
   const r=await response;exported=await r.json();need(r.ok()&&!exported.error,"Actual complete handover export failed");
   retain("actions/workspace-export.result.json",exported);activeStage=null;
  } else {
   const intent=saved("actions/workspace-export.input.json");
   await page.evaluate(async({intent,result})=>{await localPut("current-export",{publicationId:intent.body.publicationId,revision:intent.body.revision,result});await render();},{intent,result:exported});
  }
  const archivePath=path.join(root,"Highway_Field_Workspace.zip");
  if(fs.existsSync(archivePath)){const b=fs.readFileSync(archivePath);need(b.length===exported.bytes&&sha(b)===exported.sha256,"Saved browser archive differs");}
  else{
   const waiting=page.waitForEvent("download");await page.getByRole("button",{name:"Download complete workspace",exact:true}).click();
   const download=await waiting;await download.saveAs(archivePath);need(!(await download.failure()),"Browser archive download failed");
   const b=fs.readFileSync(archivePath);need(b.length===exported.bytes&&sha(b)===exported.sha256,"Browser archive bytes differ from original export");
  }
  let received=await reconcile("workspace-receive","/api/receive");
  if(!received){
   await page.locator('input[name="archive"]').setInputFiles(archivePath);activeStage="workspace-receive";
   const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/receive"&&r.request().method()==="POST");
   await page.getByRole("button",{name:"Inspect and receive full archive",exact:true}).click();
   const r=await response;received=await r.json();need(r.ok()&&!received.error,"Actual browser cold receiving failed");
   retain("actions/workspace-receive.result.json",received);activeStage=null;
  }
  need(received.current.state.id===input.workspaceId,"Browser receiving changed original workspace identity");
  const sections=["sources","forms","field","review","dispatch","followup","proposals","reconciliation","history","transfer"];
  for(const viewport of [{name:"desktop",width:1440,height:1000},{name:"phone",width:390,height:844}]){
   await page.setViewportSize({width:viewport.width,height:viewport.height});
   for(const section of sections){
    await go(section);await photograph(viewport.name+"-"+section);
    if(section==="field"){
     const savedPanel=page.locator("section.panel").filter({has:page.getByRole("heading",{name:"Saved inspections",exact:true})});
     await savedPanel.getByRole("button",{name:"Open",exact:true}).first().click();
     await page.locator('[data-field-key="review-note"]').waitFor();
     await photograph(viewport.name+"-inspection-detail");
    }
    if(section==="reconciliation"){
     const detail=page.locator("details").filter({has:page.locator("summary").filter({hasText:"Complete report"})}).first();
     if(await detail.count()){await detail.locator("summary").click();await photograph(viewport.name+"-paired-report");}
    }
   }
   await page.goto(input.origin+"/guide",{waitUntil:"networkidle"});
   await photograph(viewport.name+"-operating-guide","main");
   if(viewport.name==="desktop"){
    await page.goto(input.url,{waitUntil:"networkidle"});
    await page.locator('nav button[data-section="sources"]').waitFor();
   }
  }
  need(errors.length===0&&httpErrors.length===0,"Browser errors: "+JSON.stringify({errors,httpErrors}));
  const result={schema:"geocove.browser-programme-result.v1",state:"COMPLETE",operationId:input.operationId,
   inputSha256:sha(Buffer.from(stable(identity))),workspaceId:input.workspaceId,screenshots,geometry,
   command:saved("actions/operating-report.result.json"),export:exported,receiving:received,
   downloadedArchive:{path:archivePath,bytes:exported.bytes,sha256:exported.sha256},errors,httpErrors,
   completedAt:new Date().toISOString(),allOwnedResourcesClosed:true};
  await closeOwner();result.browserOwner=launchReceipt;retain("result.json",result);return result;
 }catch(error){retain("interrupted.json",{state:"INTERRUPTED",operationId:input.operationId,error:String(error.stack||error),errors,httpErrors,screenshots,at:new Date().toISOString()},false);throw error;}
 finally{if(owner)await closeOwner();}
}
main().then(r=>process.stdout.write(JSON.stringify({state:r.state,operationId:r.operationId,screenshots:r.screenshots.length})+"\n")).catch(e=>{process.stderr.write(String(e.stack||e)+"\n");process.exitCode=2;});

