#!/usr/bin/env node
/** Operate the actual retained Forms authoring workspace and its original inspector. */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";
const args={};for(let i=2;i<process.argv.length;i++){const k=process.argv[i];if(k==="--resume")args.resume=true;else{if(!["--receiving","--directory","--playwright","--chromium"].includes(k)||!process.argv[i+1])throw Error("Unknown/missing argument "+k);args[k.slice(2)]=process.argv[++i];}}
for(const k of ["receiving","directory","playwright","chromium"])if(!args[k])throw Error("Required --"+k);
const check=(v,m)=>{if(!v)throw Error(m);},sha=b=>crypto.createHash("sha256").update(b).digest("hex"),root=path.resolve(args.directory);
const receivingPath=await fs.realpath(args.receiving),receivingBytes=await fs.readFile(receivingPath),native=JSON.parse(receivingBytes);
check(native.operation==="FORMS-AUTHORING-WORKSPACE-RECEIVING-E258-20261013"&&native.status==="NATIVE_COMPLETE"&&native.server.kept,"Select the original complete kept authoring workspace");
const receiptPath=await fs.realpath(native.server.receipt),receiptBytes=await fs.readFile(receiptPath),receipt=JSON.parse(receiptBytes);
check(receipt.workspace_id===native.workspace_id&&receipt.schema==="tjlabs.forms-workspace.server.v1","Original selected server receipt differs");
const origin=new URL(receipt.origin);check(origin.hostname==="127.0.0.1"&&origin.protocol==="http:","Original private loopback required");
const within=(f,b)=>{const x=path.relative(b,f);return x===""||(!x.startsWith(".."+path.sep)&&x!==".."&&!path.isAbsolute(x));};
check(!within(root,path.resolve(native.workspace))&&!within(root,path.resolve(native.cold.directory)),"Browser output must remain outside the complete original and received workspaces");
const self=await fs.realpath(new URL(import.meta.url)),input={schema:"tjlabs.forms-workspace.browser-input.v1",receiving:{path:receivingPath,bytes:receivingBytes.length,sha256:sha(receivingBytes)},server:{path:receiptPath,bytes:receiptBytes.length,sha256:sha(receiptBytes)},workspace_id:receipt.workspace_id,helper_sha256:sha(await fs.readFile(self)),playwright:await fs.realpath(args.playwright),chromium:await fs.realpath(args.chromium)};
const exists=async p=>{try{await fs.access(p);return true;}catch(e){if(e.code==="ENOENT")return false;throw e;}};
async function atomic(file,value,replace=false){const raw=typeof value==="string"?value:JSON.stringify(value,null,2)+"\n",tmp=file+"."+crypto.randomUUID()+".tmp";let f;try{f=await fs.open(tmp,"wx",0o600);await f.writeFile(raw);await f.sync();await f.close();f=null;if(replace)await fs.rename(tmp,file);else await fs.link(tmp,file);}finally{if(f)await f.close();await fs.unlink(tmp).catch(e=>{if(e.code!=="ENOENT")throw e;});}}
if(await exists(root))check(args.resume,"Existing original course requires --resume");else await fs.mkdir(root,{recursive:true,mode:0o700});
const selected=path.join(root,"browser-input.json"),selectedRaw=JSON.stringify(input,null,2)+"\n";if(await exists(selected))check(await fs.readFile(selected,"utf8")===selectedRaw,"Original browser input/source/runtime changed");else await atomic(selected,selectedRaw);
const owner={hostname:os.hostname(),pid:process.pid,token:crypto.randomUUID()},lock=path.join(root,"browser.lock");let owns=false,context=null,attempt=null;
const artifacts=[],errors=[];let journal={schema:"tjlabs.forms-workspace.browser-journal.v1",input_sha256:sha(Buffer.from(selectedRaw)),steps:[],tab_id:crypto.randomUUID(),suffix:crypto.randomUUID().slice(0,8),draft_id:null};
const journalPath=path.join(root,"journal.json");if(await exists(journalPath)){journal=JSON.parse(await fs.readFile(journalPath,"utf8"));check(journal.input_sha256===sha(Buffer.from(selectedRaw)),"Original browser journal differs");}
async function saveJournal(){await atomic(journalPath,journal,true);}
async function rpc(method,params={}){const r=await fetch(new URL("api/rpc",origin),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({method,params})});const raw=await r.text();check(r.ok,"Actual workspace API failed "+raw);const x=JSON.parse(raw);check(x.workspace_id===native.workspace_id,"Actual native response belongs to another workspace");return x.value;}
async function retain(file){const b=await fs.readFile(file);const row={path:path.relative(root,file).split(path.sep).join("/"),bytes:b.length,sha256:sha(b)};artifacts.push(row);return row;}
async function artifact(name,text){const f=path.join(attempt,name);await atomic(f,text);await retain(f);return f;}
async function step(name,fn){const prior=journal.steps.find(x=>x.name===name);if(prior){for(const a of prior.artifacts||[]){const f=path.resolve(root,a.path);check(within(f,root),"Retained artifact path");const b=await fs.readFile(f);check(b.length===a.bytes&&sha(b)===a.sha256,"Original browser artifact changed");}return prior.value;}const start=artifacts.length,value=await fn();journal.steps.push({name,status:"COMPLETE",value:value??null,artifacts:artifacts.slice(start)});await saveJournal();return value;}
async function quiet(page){await page.waitForFunction(()=>!document.getElementById("save")?.disabled&&!document.getElementById("notice")?.textContent.includes("Opening the original"),null,{timeout:180000});}
async function click(page,id){await page.locator("#"+id).click();}
async function tab(page,name){await page.locator('[data-tab="'+name+'"]').click();await page.locator("#panel-"+name).waitFor({state:"visible"});}
async function section(page,name){await page.locator('[data-section="'+name+'"]').click();await page.waitForFunction(n=>document.querySelector('[data-section="'+n+'"]')?.getAttribute("aria-selected")==="true",name);}
async function screenshot(page,name){const f=path.join(attempt,name);await page.screenshot({path:f,fullPage:true});await retain(f);}
async function download(page,selector,name){const waiting=page.waitForEvent("download",{timeout:120000});await page.locator(selector).click();const d=await waiting;check(!(await d.failure()),"Complete actual download failed");const f=path.join(attempt,name);await d.saveAs(f);await retain(f);return f;}
async function waitNotice(page,text){await page.waitForFunction(x=>document.getElementById("notice")?.textContent.includes(x),text,{timeout:180000});}
async function activeId(page){return page.locator("#draft-context").textContent().then(t=>t.split(" · ")[0]);}
async function openDraft(page,id){await tab(page,"mapping");let offset=0;for(;;){const r=await rpc("draft.list",{offset,limit:20});const i=r.rows.findIndex(x=>x.id===id);if(i>=0){await page.evaluate(o=>{draftOffset=o;return loadDrafts();},offset);await page.locator('[data-draft="'+id+'"]').click();await page.waitForFunction(x=>document.getElementById("draft-context")?.textContent.startsWith(x+" · "),id);return;}offset+=r.rows.length;check(offset<r.total,"Original selected browser draft is missing");}}
async function field(page,p,value){const selector='[data-path="'+JSON.stringify(p).replace(/\\/g,"\\\\").replace(/"/g,'\\"')+'"]',n=page.locator(selector);await n.evaluate(e=>{for(let d=e.closest("details");d;d=d.parentElement.closest("details"))if(!d.open)d.querySelector("summary").click();});await n.scrollIntoViewIfNeeded();if(await n.evaluate(e=>e.tagName)==="SELECT")await n.selectOption(String(value));else if(await n.getAttribute("type")==="checkbox")await n.setChecked(Boolean(value));else{await n.fill(String(value));await n.press("Tab");}await page.waitForFunction(({p,v})=>{try{const raw=JSON.parse(document.getElementById("raw").value),x=p.reduce((o,k)=>o?.[k],raw);return JSON.stringify(x)===JSON.stringify(v)&&!active?.field_edits?.[JSON.stringify(p)];}catch{return false;}},{p,v:typeof value==="string"&&["primary_key","key_values","keys","dimensions","source_columns","target_columns","null_values"].includes(p.at(-1))?JSON.parse(value):value});}
async function waitSaved(page,name){await page.waitForFunction(n=>!document.getElementById("save")?.disabled&&document.getElementById("draft-name")?.value===n&&document.getElementById("pending-box")?.hidden,name,{timeout:180000});}
async function readAllDrafts(){const out=[];let offset=0;for(;;){const r=await rpc("draft.list",{offset,limit:100});out.push(...r.rows);offset+=r.rows.length;if(offset>=r.total)return out;check(r.rows.length,"Original draft paging stopped early");}}
try{
 try{await atomic(lock,owner);owns=true;}catch(e){if(e.code!=="EEXIST")throw e;const old=JSON.parse(await fs.readFile(lock,"utf8"));check(args.resume&&old.hostname===os.hostname(),"Original browser lock is owned elsewhere");let live=true;try{process.kill(old.pid,0);}catch(x){if(x.code==="ESRCH")live=false;else throw x;}check(!live,"Original browser PID remains live");await fs.rename(lock,path.join(root,"retired-lock-"+old.token+".json"));await atomic(lock,owner);owns=true;}
 const final=path.join(root,"browser-receiving.json");
 if(await exists(final)){const old=JSON.parse(await fs.readFile(final,"utf8"));check(old.input_sha256===journal.input_sha256&&old.status==="BROWSER_COURSE_COMPLETE","Original completion differs");for(const a of old.artifacts){const f=path.resolve(root,a.path);check(within(f,root),"Original artifact path");const b=await fs.readFile(f);check(b.length===a.bytes&&sha(b)===a.sha256,"Original completed artifact changed");}console.log(JSON.stringify(old));}
 else{
  await saveJournal();attempt=await fs.mkdtemp(path.join(root,"attempt-"));
  const module=await import(pathToFileURL(input.playwright).href),chromium=module.chromium??module.default?.chromium;
  check(chromium?.launchPersistentContext,"Actual installed Playwright chromium required");
  context=await chromium.launchPersistentContext(path.join(root,"browser-profile"),{headless:true,executablePath:input.chromium,viewport:{width:1440,height:1050},acceptDownloads:true,args:["--disable-dev-shm-usage"],serviceWorkers:"block"});
  await context.addInitScript(({host,id})=>{if(location.origin===host&&!sessionStorage.getItem("forms.mapping.tab"))sessionStorage.setItem("forms.mapping.tab",id);},{host:origin.origin,id:journal.tab_id});
  const page=await context.newPage();page.on("pageerror",e=>errors.push(String(e)));
  await page.goto(origin.href,{waitUntil:"domcontentloaded",timeout:120000});await quiet(page);
  // The browser's original exact pending command survives a prior helper process.
  if(await page.locator("#pending-box").isVisible()){await click(page,"recover");await quiet(page);check(await page.locator("#pending-box").isHidden(),"Original pending request did not reconcile");}
  const C=native.editions.find(x=>x.edition==="c");check(C,"Original complete C edition required");
  const name="Browser explicit mapping "+journal.suffix;
  await step("stream-original-complete-capture-through-ui",async()=>{
   await tab(page,"captures");const file=path.resolve(native.workspace,C.capture.archive.path);
   const raw=await fs.readFile(file);check(raw.length===C.capture.archive.bytes&&sha(raw)===C.capture.archive.sha256,"Actual original collector ZIP");
   await page.locator("#capture-file").setInputFiles(file);await click(page,"upload");
   await page.waitForFunction(()=>document.getElementById("upload-status")?.textContent.includes("imported and verified"),null,{timeout:180000});await quiet(page);
   const current=await rpc("capture.show",{capture_id:C.capture.id});check(current.archive.sha256===C.capture.archive.sha256,"Full source intake deduplicates the same immutable capture");
   return{capture_id:current.id,bytes:raw.length,sha256:sha(raw)};
  });
  await step("open-original-workspace-and-complete-capture",async()=>{
   check((await page.locator("#identity").textContent()).includes(native.workspace_id),"Actual original workspace identity");await screenshot(page,"01-captures-desktop.png");
   await page.locator('[data-capture="'+C.capture.id+'"]').click();await page.waitForFunction(x=>document.getElementById("capture-title")?.textContent.includes(x),C.capture.edition);
   await click(page,"capture-worksheet");await page.locator("#detail").waitFor({state:"visible"});const raw=await page.locator("#detail-body").textContent();check(JSON.parse(raw).value.status==="MAPPING_REQUIRED","Original collector boundary remains explicit");await artifact("Original_Capture_Worksheet.json",raw);await click(page,"detail-close");
   return{capture_id:C.capture.id,archive:C.capture.archive};
  });
  await step("create-mapping-required-draft-through-ui",async()=>{
   const found=(await readAllDrafts()).filter(x=>x.name===name);check(found.length<=1,"Original UI draft identity is ambiguous");
   if(found.length){journal.draft_id=found[0].id;await saveJournal();await openDraft(page,journal.draft_id);return {draft_id:journal.draft_id};}
   await tab(page,"captures");await page.locator('[data-capture="'+C.capture.id+'"]').click();await page.waitForFunction(x=>document.getElementById("capture-title")?.textContent.includes(x),C.capture.edition);await page.locator("#new-name").fill(name);await click(page,"new-draft");await page.waitForFunction(n=>document.getElementById("draft-name")?.value===n,name);await quiet(page);journal.draft_id=await activeId(page);await saveJournal();const d=await rpc("draft.show",{draft_id:journal.draft_id});check(JSON.parse(d.raw).discovery_manifest.tables.length===0,"New native mapping should start from mapping-required capture");return{draft_id:d.id,revision:d.revision};
  });
  await openDraft(page,journal.draft_id);
  await step("inspect-original-csv-and-author-table",async()=>{
   await tab(page,"captures");await page.locator('[data-capture="'+C.capture.id+'"]').click();await page.waitForFunction(x=>document.getElementById("capture-title")?.textContent.includes(x),C.capture.edition);
   const plan=JSON.parse(C.draft.raw),t=plan.discovery_manifest.tables[0],aid=plan.table_assets[t.id];
   await page.locator("#asset-search").fill(aid);await click(page,"asset-filter");await page.locator('[data-csv="'+aid+'"]').click();await page.waitForFunction(x=>document.getElementById("detail-title")?.textContent==='Original CSV · '+x,aid);
   const csv=JSON.parse(await page.locator("#detail-body").textContent()).value;check(csv.rows[0].record===1&&Array.isArray(csv.rows[0].values),"Actual literal one-based CSV records");await screenshot(page,"02-complete-csv-inspection.png");
   page.once("dialog",d=>d.accept("browser_explicit_table"));await page.getByRole("button",{name:"Add this original as a table",exact:true}).click();await page.locator("#detail").waitFor({state:"hidden"});await section(page,"tables");await page.locator("#editor details").first().locator("summary").click();
   await field(page,["discovery_manifest","tables",0,"columns",0,"type"],"text");
   await field(page,["discovery_manifest","tables",0,"primary_key"],JSON.stringify([csv.headers[0]]));
   const raw=await page.locator("#raw").inputValue(),authored=JSON.parse(raw);check(authored.table_assets.browser_explicit_table===aid&&authored.discovery_manifest.tables[0].sha256===csv.source.sha256,"Table authoring binds actual original source");
   await artifact("Authored_First_Table.json",raw);return{asset_id:aid,headers:csv.headers,rows:csv.total};
  });
  await step("retain-unfinished-native-text-and-reopen",async()=>{
   await section(page,"raw");const partial='{"schema":\n';await page.locator("#raw").fill(partial);await click(page,"save");await quiet(page);const id=journal.draft_id,d=await rpc("draft.show",{draft_id:id});check(d.raw===partial,"Native unfinished text must remain exact");await page.reload({waitUntil:"domcontentloaded"});await quiet(page);await openDraft(page,id);check(await page.locator("#raw").inputValue()===partial,"Cold page retains exact unfinished original");return{draft_id:id,revision:d.revision,raw:partial};
  });
  await step("complete-native-mapping-and-all-structured-sections",async()=>{
   const selected=path.join(attempt,"Selected_Complete_Intake.json");await atomic(selected,C.draft.raw);await retain(selected);
   await page.locator("#draft-import").setInputFiles(selected);await page.waitForFunction(raw=>document.getElementById("raw")?.value===raw,C.draft.raw);await section(page,"scope");
   await field(page,["interpretation_reference"],"DEMONSTRATION browser explicit complete mapping review "+journal.suffix);
   await field(page,["classes","responses","supported_route"],"Exact retained original CSV exports");
   await field(page,["classes","responses","review_owner"],"DEMONSTRATION receiving operator");
   await field(page,["classes","responses","decision_reference"],"Browser course "+journal.suffix);
   await section(page,"tables");let plan=JSON.parse(await page.locator("#raw").inputValue());await page.locator("#editor>details").first().locator("summary").click();await field(page,["discovery_manifest","tables",0,"primary_key"],JSON.stringify(plan.discovery_manifest.tables[0].primary_key));
   await section(page,"pairs");await page.locator("#editor>details").first().locator("summary").click();await field(page,["migration_selection","pairs",0,"comparison_reference"],plan.migration_selection.pairs[0].comparison_reference+" · explicitly reviewed in browser");
   await section(page,"attachments");await page.locator("#editor>details").first().locator("summary").click();await field(page,["attachments",0,"parent","record"],plan.attachments[0].parent.record);await field(page,["attachments",0,"parent","key_values"],JSON.stringify(plan.attachments[0].parent.key_values));
   await section(page,"files");await page.locator("#editor>details").first().locator("summary").click();await field(page,["file_comparisons",0,"reference"],plan.file_comparisons[0].reference+" · whole original bytes");
   await click(page,"validate");await page.waitForFunction(()=>document.getElementById("draft-status")?.textContent.includes('"STRUCTURE_VALID"'),null,{timeout:180000});await quiet(page);
   const d=await rpc("draft.show",{draft_id:journal.draft_id}),validated=await rpc("draft.validate",{draft_id:d.id,expected_revision:d.revision});check(validated.valid,"Actual authored native draft validates");journal.complete_draft=d;await saveJournal();await screenshot(page,"03-complete-structured-mapping.png");return{draft_id:d.id,revision:d.revision,intake_sha256:validated.intake_sha256};
  });
  await step("two-tab-revision-conflict-and-retained-alternative",async()=>{
   const secondReady=context.waitForEvent("page");await page.evaluate(()=>window.open(location.href,"_blank"));const second=await secondReady;await second.waitForLoadState("domcontentloaded");await quiet(second);check((await second.evaluate(()=>sessionStorage.getItem("forms.mapping.tab")))!==(await page.evaluate(()=>sessionStorage.getItem("forms.mapping.tab"))),"An opener-created tab must acquire its separate live working-copy identity");await openDraft(second,journal.draft_id);
   await section(second,"raw");await second.locator("#draft-name").fill(name+" stale alternative");
   await page.locator("#draft-name").fill(name+" current");await click(page,"save");await quiet(page);const current=await rpc("draft.show",{draft_id:journal.draft_id});
   await click(second,"save");await waitNotice(second,"later");check(await second.locator("#draft-name").inputValue()===name+" stale alternative","Stale local complete edit remains visible");check((await rpc("draft.show",{draft_id:journal.draft_id})).revision===current.revision,"Stale tab must not replace native revision");
   await screenshot(second,"04-retained-revision-conflict.png");await second.close();await page.reload({waitUntil:"domcontentloaded"});await quiet(page);await openDraft(page,journal.draft_id);return{current_revision:current.revision};
  });
  await step("calculate-whole-edition-and-open-original-inspector",async()=>{
   // If a prior helper stopped after native completion, reconcile that exact request from local history.
   const existing=[];let offset=0;for(;;){const r=await rpc("run.list",{offset,limit:100});existing.push(...r.rows.filter(x=>x.draft_id===journal.draft_id));offset+=r.rows.length;if(offset>=r.total)break;}
   let run=existing.at(-1);
   if(!run){await click(page,"run");await page.waitForFunction(()=>document.getElementById("panel-runs")?.hidden===false&&!document.getElementById("run")?.disabled,null,{timeout:300000});const r=await rpc("run.list",{offset:0,limit:500});run=r.rows.find(x=>x.draft_id===journal.draft_id);}
   check(run,"Actual complete native UI run returned");journal.run_id=run.id;await saveJournal();await tab(page,"runs");await click(page,"refresh-runs");
   const popup=context.waitForEvent("page");await page.locator('[data-inspector="'+run.id+'"][data-edition="project"]').click();const inspector=await popup;await inspector.waitForURL(u=>u.pathname.endsWith("/workspace/"),{timeout:180000});await inspector.locator("#project-identity").waitFor({timeout:120000});await screenshot(inspector,"05-original-calculated-inspector.png");await inspector.close();
   const file=await download(page,'[data-run-download="'+run.id+'"]',"Forms_Authored_Project.zip"),bytes=await fs.readFile(file);check(bytes.length===run.archive.bytes&&sha(bytes)===run.archive.sha256,"Actual complete native project download");
   return{run_id:run.id,project_identity:run.project_identity,archive:run.archive};
  });
  await openDraft(page,journal.draft_id);
  await step("following-capture-explicit-rebind-and-source-review",async()=>{
   const B=native.editions.find(x=>x.edition==="b");const fname="Browser explicit following source "+journal.suffix;
   const prior=(await readAllDrafts()).find(x=>x.name===fname);
   if(prior){journal.following_id=prior.id;await saveJournal();return{draft_id:prior.id};}
   await page.locator("#fork-name").evaluate(e=>e.closest("details").open=true);await page.locator("#fork-name").fill(fname);await page.locator("#fork-capture").fill(B.capture.id);await page.locator("#rebind-reference").fill("DEMONSTRATION selected complete C-to-B receiving comparison "+journal.suffix);
   await page.locator("#fork").scrollIntoViewIfNeeded();await click(page,"fork");await page.waitForFunction(n=>document.getElementById("draft-name")?.value===n,fname);await quiet(page);const id=await activeId(page),d=await rpc("draft.show",{draft_id:id});check(d.source_review&&d.base_draft_revision&&Array.isArray(d.source_review.assets),"Full old/new source review retained");journal.following_id=id;await saveJournal();await artifact("Following_Source_Review.json",JSON.stringify(d,null,2)+"\n");return{draft_id:id,revision:d.revision,changes:d.source_review.assets.length};
  });
  await step("complete-working-archive-download-import-and-reopen",async()=>{
   await tab(page,"requests");const file=await download(page,"#working-export","Forms_Complete_Working_Copies.json");const data=JSON.parse(await fs.readFile(file,"utf8"));check(data.workspace_id===native.workspace_id&&data.records.length>0,"Whole working archive preserves original workspace");
   await page.locator("#working-import").setInputFiles(file);await waitNotice(page,"separate alternatives");await page.reload({waitUntil:"domcontentloaded"});await quiet(page);await tab(page,"requests");await click(page,"refresh-local");check((await page.locator("#local-list").textContent()).includes("Imported"),"Cold reopened imported alternatives remain available");return{records:data.records.length};
  });
  await step("recover-imported-original-request-without-repeating-effect",async()=>{
   await tab(page,"requests");await click(page,"refresh-local");
   const records=await page.evaluate(()=>state.localRows.map((row,index)=>({row,index,request:requestCandidate(row)})));
   const candidate=records.find(x=>x.row.kind==='alternative'&&x.request?.status==='COMPLETE'&&x.request?.body?.method==='draft.save');
   check(candidate,"Actual imported complete original request remains selectable");
   const before=await rpc("workspace.describe"),nativeRequest=await rpc("request.show",{request_id:candidate.request.body.request_id});
   check(nativeRequest.status==="COMPLETE","Original imported request already completed natively");
   await page.locator('[data-local-request="'+candidate.index+'"]').click();await page.locator("#pending-box").waitFor({state:"visible"});await click(page,"recover");await quiet(page);
   check(await page.locator("#pending-box").isHidden(),"Imported original request reconciled");
   const after=await rpc("workspace.describe");check(after.revision===before.revision,"Recovered imported completed request created no second native effect");
   return{request_id:candidate.request.body.request_id,native_revision:after.revision};
  });
  await step("complete-workspace-zip-keyboard-desktop-narrow-and-pdf",async()=>{
   await tab(page,"handover");const file=await download(page,"#workspace-export","Forms_Complete_Workspace.zip");check((await fs.stat(file)).size>0,"Whole workspace archive downloaded");
   await tab(page,"mapping");await openDraft(page,journal.draft_id);await section(page,"scope");await screenshot(page,"06-mapping-desktop.png");
   await page.locator('[data-tab="captures"]').focus();await page.keyboard.press("End");check(await page.locator('[data-tab="handover"]').getAttribute("aria-selected")==="true","Tab keyboard End works");
   await page.setViewportSize({width:390,height:844});await tab(page,"mapping");await screenshot(page,"07-mapping-narrow.png");check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),"Narrow page has no external horizontal overflow");await tab(page,"captures");await screenshot(page,"08-capture-narrow.png");
   await page.setViewportSize({width:1440,height:1050});await tab(page,"handover");const pdf=path.join(attempt,"Forms_Workspace_Handover.pdf");await page.pdf({path:pdf,format:"A4",printBackground:true});await retain(pdf);return{archive_bytes:(await fs.stat(file)).size};
  });
  check(errors.length===0,"Actual browser errors: "+errors.join("; "));
  await context.close();context=null;
  const completeArtifacts=journal.steps.flatMap(x=>x.artifacts||[]);
  const viewing="# Actual Forms authoring workspace viewing\n\nOpen and VIEW every captured PNG at its actual desktop/narrow dimensions and every page of Forms_Workspace_Handover.pdf. Operate the exact outgoing workspace and original/received inspector. Open all complete intake/working/source-review JSON and both ZIPs; check their full member inventories. Functional receiving is separate from actual pixel and attachment review. Record the actual viewer and outcome in the existing operation. Keep source, raw unfinished revision, conflict and all original histories intact. No provider calls or customer correspondence were performed by this course.\n";
  const v=await artifact("VIEWING.md",viewing);
  const result={schema:"tjlabs.forms-workspace.browser-receiving.v1",status:"BROWSER_COURSE_COMPLETE",input_sha256:journal.input_sha256,workspace_id:native.workspace_id,run_id:journal.run_id,steps:journal.steps,artifacts:[...completeArtifacts,artifacts.at(-1)],visual_review:"PENDING_ACTUAL_SCREENSHOT_AND_ATTACHMENT_VIEWING",native_operation:native.operation};
  await atomic(final,result);console.log(JSON.stringify(result));
 }
}catch(e){if(attempt)await atomic(path.join(attempt,"failure.json"),{status:"INCOMPLETE",error:String(e),input_sha256:journal.input_sha256,steps:journal.steps,artifacts});console.error(String(e));process.exitCode=2;}
finally{if(context)await context.close().catch(()=>{});if(owns){const value=JSON.parse(await fs.readFile(lock,"utf8"));if(value.token===owner.token)await fs.unlink(lock);}}
