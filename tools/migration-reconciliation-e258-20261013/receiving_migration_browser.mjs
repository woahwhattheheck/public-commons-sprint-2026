#!/usr/bin/env node
/**
 * Operate an already-running original migration case server.
 * No data creation, calculation, server dispatch, installation or native mutation.
 */
import fs from "node:fs/promises";
import {createReadStream} from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {pathToFileURL,fileURLToPath} from "node:url";
import {createInterface} from "node:readline";

const SCHEMA="tjlabs.migration-reconciliation.browser-receiving.v1";
const check=(c,m)=>{if(!c)throw Error(m);};
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const args={};
for(let i=2;i<process.argv.length;i++){
 const key=process.argv[i];check(["--server-receipt","--directory","--playwright","--chromium","--resume"].includes(key),"Unknown argument "+key);
 if(key==="--resume")args.resume=true;
 else{check(process.argv[i+1]&&!process.argv[i+1].startsWith("--"),"Missing value "+key);args[key.slice(2)]=process.argv[++i];}
}
for(const k of ["server-receipt","directory","playwright","chromium"])check(args[k],"Required --"+k);
const receiptPath=await fs.realpath(args["server-receipt"]),receiptBytes=await fs.readFile(receiptPath),receipt=JSON.parse(receiptBytes);
check(receipt.schema==="tjlabs.migration-reconciliation.server.v1"&&receipt.read_only===true,"Select the original read-only server receipt");
const origin=new URL(receipt.origin);
check(origin.protocol==="http:"&&origin.hostname==="127.0.0.1"&&origin.port&&/^\/[A-Za-z0-9_-]+\/$/.test(origin.pathname)&&!origin.search&&!origin.hash&&!origin.username&&!origin.password,"Use the exact original private localhost token root");
const root=path.resolve(args.directory),caseRoot=await fs.realpath(receipt.case);
function contained(file,base){const r=path.relative(base,file);return r!==""&&r!==".."&&!r.startsWith(".."+path.sep)&&!path.isAbsolute(r);}
check(root!==caseRoot&&!contained(root,caseRoot),"Browser output must stay outside the immutable original case");
async function identity(file){const digest=crypto.createHash("sha256");let bytes=0;for await(const block of createReadStream(file)){digest.update(block);bytes+=block.length;}return {bytes,sha256:digest.digest("hex")};}
async function exactFile(file,wanted){const actual=await identity(file);check(actual.bytes===wanted.bytes&&actual.sha256===wanted.sha256,"Retained full file identity differs: "+path.basename(file));return actual;}
const resultPath=path.join(caseRoot,"migration/result.json"),resultBytes=await fs.readFile(resultPath),result=JSON.parse(resultBytes);
check(result.schema==="tjlabs.migration-reconciliation.result.v1"&&result.source_run_identity===receipt.source_run_identity,"Original server and case result differ");
const originalManifest=path.join(caseRoot,"manifest.original.json"),sourceReport=path.join(caseRoot,"report.json"),htmlPath=path.join(caseRoot,"migration/report.html");
const local={result:await identity(resultPath),manifest:await identity(originalManifest),report:await identity(sourceReport),html:await identity(htmlPath)};
const helper=await fs.realpath(fileURLToPath(import.meta.url));
const input={schema:SCHEMA,receipt_path:receiptPath,receipt_sha256:sha(receiptBytes),case:caseRoot,source_run_identity:result.source_run_identity,selection_sha256:result.selection_sha256,
 helper_sha256:(await identity(helper)).sha256,playwright:await fs.realpath(args.playwright),chromium:await fs.realpath(args.chromium),local};
const inputText=JSON.stringify(input,null,2)+"\n",inputSHA=sha(Buffer.from(inputText));
async function atomic(file,body,replace=false){
 const temporary=path.join(path.dirname(file),"."+path.basename(file)+"-"+crypto.randomUUID()+".tmp");let h=null;
 try{h=await fs.open(temporary,"wx");await h.writeFile(body);await h.sync();await h.close();h=null;if(replace)await fs.rename(temporary,file);else await fs.link(temporary,file);}
 finally{if(h)await h.close().catch(()=>{});await fs.unlink(temporary).catch(e=>{if(e.code!=="ENOENT")throw e;});}
}
try{await fs.mkdir(root);}catch(e){if(e.code!=="EEXIST")throw e;check(args.resume,"Existing receiving directory requires --resume");}
const realRoot=await fs.realpath(root);check(realRoot!==caseRoot&&!contained(realRoot,caseRoot),"Receiving output resolves into immutable case");
try{await atomic(path.join(root,"browser-input.json"),inputText);}catch(e){if(e.code!=="EEXIST")throw e;check(await fs.readFile(path.join(root,"browser-input.json"),"utf8")===inputText,"Restore exact original receipt/source/runtime selections");}
const lockPath=path.join(root,"browser.lock"),owner={hostname:os.hostname(),pid:process.pid,token:crypto.randomUUID()};
let ownsLock=false,browser=null,context=null,attempt=null,version=null;
const steps=[],artifacts=[],pageErrors=[];
const safeError=error=>String(error).split(receipt.origin).join("[private original case URL]").split(origin.pathname).join("/[private-token]/");
async function retained(file){const id=await identity(file);artifacts.push({path:path.relative(root,file).split(path.sep).join("/"),...id});return file;}
async function save(name,body){const file=path.join(attempt,name);await atomic(file,body);return retained(file);}
async function step(name,fn){const out=await fn();steps.push({name,status:"COMPLETE",result:out??null});await atomic(path.join(attempt,"progress.json"),JSON.stringify({schema:SCHEMA,input_sha256:inputSHA,steps,artifacts},null,2)+"\n",true);return out;}
async function capture(page,name){const file=path.join(attempt,name);await page.screenshot({path:file,fullPage:true});await retained(file);}
async function downloaded(page,selector,name){
 const waiting=page.waitForEvent("download",{timeout:60000});await page.locator(selector).click();const d=await waiting;
 check(!(await d.failure()),"Actual download failed: "+name);const file=path.join(attempt,name);await d.saveAs(file);await retained(file);return file;
}
async function get(relative,query={}){
 const url=new URL(relative,origin);for(const[k,v]of Object.entries(query))if(v!==""&&v!==null&&v!==undefined)url.searchParams.set(k,String(v));
 const response=await fetch(url,{redirect:"error",signal:AbortSignal.timeout(60000)});const text=await response.text();
 check(response.ok,"Original server read failed: "+relative+" HTTP "+response.status);return {text,value:JSON.parse(text)};
}
async function app(page){
 page.on("pageerror",e=>pageErrors.push(safeError(e)));
 await page.goto(receipt.origin,{waitUntil:"domcontentloaded",timeout:60000});
 await page.locator("#case-summary .stat").first().waitFor({timeout:30000});
 await page.waitForFunction(()=>document.querySelector("#rows-status").textContent.startsWith("Applied view:"),null,{timeout:60000});
 check(await page.locator("#fatal").isHidden(),"Original inspector displayed a fatal rendering error");
 const boot=JSON.parse(await page.locator("#migration-bootstrap").textContent());
 check(boot.source_run_identity===result.source_run_identity&&boot.selection_sha256===result.selection_sha256,"Actual HTML bootstrap differs");
}
async function rowView(page,{pair="",classification="",search=""}={}){
 await page.locator("#tab-records").click();await page.locator("#pair-filter").selectOption(pair);await page.locator("#status-filter").selectOption(classification);await page.locator("#key-search").fill(search);
 const response=page.waitForResponse(r=>new URL(r.url()).pathname===origin.pathname+"api/rows"&&new URL(r.url()).searchParams.get("offset")==="0");
 await page.locator("#apply-filters").click();const r=await response;check(r.ok(),"Applied original record view failed");const data=await r.json();
 await page.waitForFunction(({n,p,s})=>{const t=document.querySelector("#rows-status").textContent;return t.startsWith("Applied view: "+(p||"all pairs")+"; "+(s||"all classifications")+";")&&t.includes("of "+n+" matching records.");},{n:data.total,p:pair,s:classification},{timeout:60000});
 return data;
}
async function selectRow(page,row){
 await page.locator('[data-row="'+row.row_id+'"]').click();
 await page.locator("#download-record").waitFor({timeout:30000});
 check((await page.locator("#record-detail h2").textContent()).endsWith(String(row.row_id)),"Displayed row identity differs");
}
async function sourceDrilldown(page,ref,name){
 const buttons=page.locator("#record-detail [data-source]");
 let found=false;for(let i=0;i<await buttons.count();i++){const v=JSON.parse(await buttons.nth(i).getAttribute("data-source"));if(v.table===ref.table&&v.record===ref.record){await buttons.nth(i).click();found=true;break;}}
 check(found,"Original source reference control is required");
 await page.locator("#download-source-record").waitFor({timeout:30000});
 const file=await downloaded(page,"#download-source-record",name);
 const actual=await fs.readFile(file,"utf8"),expected=await get("api/source",ref);
 check(actual===expected.text,"Original CSV record download must retain full native JSON text");
 const value=JSON.parse(actual);check(Array.isArray(value.headers)&&Array.isArray(value.values)&&value.record===ref.record&&value.table===ref.table,"Complete original CSV record shape");
 await capture(page,name.replace(/\.json$/,".png"));await page.keyboard.press("Escape");
 return {table:ref.table,record:ref.record,source_sha256:value.source.sha256,values:value.values.length};
}
async function countJSONL(file){
 let count=0,first=null,last=null;
 for await(const line of createInterface({input:createReadStream(file),crlfDelay:Infinity})){if(!line)continue;const r=JSON.parse(line);count++;first??=r.row_id??r.total_id;last=r.row_id??r.total_id;}
 return {count,first,last};
}
try{
 try{await atomic(lockPath,JSON.stringify(owner));ownsLock=true;}
 catch(e){
  if(e.code!=="EEXIST")throw e;const original=await fs.readFile(lockPath,"utf8"),previous=JSON.parse(original);
  check(args.resume&&previous.hostname===os.hostname()&&Number.isInteger(previous.pid),"Existing original receiver lock remains owned");
  let live=true;try{process.kill(previous.pid,0);}catch(err){if(err.code==="ESRCH")live=false;else throw err;}
  check(!live,"Original browser course is still active");check(await fs.readFile(lockPath,"utf8")===original,"Original lock changed");
  await fs.rename(lockPath,path.join(root,"retired-lock-"+previous.token+".json"));await atomic(lockPath,JSON.stringify(owner));ownsLock=true;
 }
 const outcomePath=path.join(root,"browser-receiving.json");
 let prior=null;try{prior=JSON.parse(await fs.readFile(outcomePath,"utf8"));}catch(e){if(e.code!=="ENOENT")throw e;}
 if(prior?.status==="BROWSER_COURSE_COMPLETE"){
  check(prior.input_sha256===inputSHA,"Completed original receiving selection differs");
  for(const item of prior.artifacts){const file=path.resolve(root,item.path);check(contained(file,root),"Invalid retained artifact path");await exactFile(file,item);}
  console.log(JSON.stringify(prior));process.exitCode=0;
 }else{
  attempt=path.join(root,"attempt-"+new Date().toISOString().replace(/[:.]/g,"-")+"-"+crypto.randomUUID());await fs.mkdir(attempt);
  const playwright=await import(pathToFileURL(input.playwright).href);check(playwright.chromium,"Selected installed module must expose chromium");
  browser=await playwright.chromium.launch({executablePath:input.chromium,headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});version=browser.version();
  context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1050}});
  await context.route("**/*",route=>{
   const url=new URL(route.request().url());if(url.origin===origin.origin||url.protocol==="file:"||url.protocol==="blob:")return route.continue();return route.abort("blockedbyclient");
  });
  const page=await context.newPage();
  const original=await step("open-exact-existing-native-case",async()=>{
   const summary=await get("api/summary"),capabilities=(await get("api/capabilities")).value;
   check(summary.text===resultBytes.toString("utf8"),"Server returns the complete exact original summary bytes");
   check(capabilities.read_only===true&&capabilities.archive_available===!!receipt.archive,"Original capability selection differs");
   if(receipt.archive)check(capabilities.archive.bytes===receipt.archive.bytes&&capabilities.archive.sha256===receipt.archive.sha256,"Selected archive identity differs");
   await app(page);await capture(page,"01-records-desktop.png");
   return {comparison_records:result.comparison_records,totals:result.totals.count,archive_available:capabilities.archive_available};
  });
  await step("page-complete-record-population",async()=>{
   const initial=(await get("api/rows",{limit:40,offset:0})).value;check(initial.total===result.comparison_records,"Complete population count differs");
   if(initial.total>40){
    await page.locator('[data-page="next"]').click();await page.waitForFunction(()=>document.querySelector("#rows-status").textContent.includes("Showing 41–"),null,{timeout:60000});
    await capture(page,"02-next-record-page.png");
    await page.locator('[data-page="previous"]').click();await page.waitForFunction(()=>document.querySelector("#rows-status").textContent.includes("Showing 1–"),null,{timeout:60000});
   }
   return {records:initial.total,paged:initial.total>40};
  });
  let chosen=null;
  await step("select-native-classification-pair-and-key-view",async()=>{
   const candidates=result.pairs.slice().sort((a,b)=>Number(b.fields.some(f=>f.kind==="decimal"))-Number(a.fields.some(f=>f.kind==="decimal")));
   const classifications=[...new Set(["DIFFERENCE","MATCHED",...result.pairs.flatMap(p=>Object.keys(p.summary.status_counts))])];
   for(const classification of classifications){
    for(const pair of candidates){
     if(!Object.hasOwn(pair.summary.status_counts,classification))continue;
     const data=(await get("api/rows",{pair:pair.id,classification,limit:40,offset:0})).value;
     chosen=data.rows.find(r=>r.source_records.length&&r.target_records.length&&r.fields.some(f=>f.kind==="decimal"))||
       (!pair.fields.some(f=>f.kind==="decimal")?data.rows.find(r=>r.source_records.length&&r.target_records.length&&r.fields.length):null);
     if(chosen)break;
    }
    if(chosen)break;
   }
   if(!chosen)chosen=(await get("api/rows",{limit:1,offset:0})).value.rows[0];
   check(chosen,"Receiving requires the actual nonempty comparison population");
   const view=await rowView(page,{pair:chosen.pair,classification:chosen.classification});
   check(view.rows.some(r=>r.row_id===chosen.row_id),"Selected original row remains in requested first page");
   await selectRow(page,chosen);
   const raw=await downloaded(page,"#download-record","Migration_Selected_Record.json");check(await fs.readFile(raw,"utf8")===(await get("api/row",{id:chosen.row_id})).text,"Whole selected record download is exact");
   if(chosen.fields.length){await page.locator("#field-filter").selectOption(chosen.fields[0].id);await page.locator("#field-filter").selectOption("");}
   await page.locator("#exact-values").check();if(chosen.fields.some(f=>f.kind==="decimal"&&f.source_exact!==null))check(await page.locator("#record-detail .quantity small").count()>0,"Actual exact numerical fractions must be visible");await capture(page,"03-full-record-and-exact-fields.png");
   const text=chosen.key?.[0]??chosen.source_key?.[0];
   if(text!==null&&text!==undefined){const searched=await rowView(page,{pair:chosen.pair,classification:chosen.classification,search:String(text)});check(searched.rows.some(r=>r.row_id===chosen.row_id),"Literal original key search retains selected record");}
   await rowView(page,{pair:chosen.pair,classification:chosen.classification});await selectRow(page,chosen);
   return {row_id:chosen.row_id,pair:chosen.pair,classification:chosen.classification};
  });
  await step("read-original-source-and-target-records",async()=>{
   const outputs=[];
   if(chosen.source_records.length)outputs.push(await sourceDrilldown(page,chosen.source_records[0],"Original_Source_Record.json"));
   if(chosen.target_records.length)outputs.push(await sourceDrilldown(page,chosen.target_records[0],"Original_Target_Record.json"));
   check(outputs.length>0,"Native course must provide original row evidence");
   return outputs;
  });
  const savedView=await step("export-exact-applied-view-and-full-filtered-population",async()=>{
   const current=(await get("api/rows",{pair:chosen.pair,classification:chosen.classification,offset:0,limit:40})).value;
   const selectedJSONL=await downloaded(page,"#download-filtered-jsonl","Migration_Filtered_Rows.jsonl");
   const count=await countJSONL(selectedJSONL);check(count.count===current.total,"Filtered export must include every matching record, not one page");
   await downloaded(page,"#download-filtered-csv","Migration_Filtered_Rows.csv");
   await downloaded(page,"#download-page-csv","Migration_Current_Page.csv");
   await page.locator("#tab-downloads").click();
   const settings=await downloaded(page,"#save-view","Migration_View.json");
   const snapshot=await downloaded(page,"#download-page-html","Migration_Current_Page.html");
   const html=await fs.readFile(snapshot,"utf8");check(html.includes("explicitly limited")&&!html.includes(origin.pathname),"Subset snapshot has scope and no private access token");
   return {settings,snapshot,matching_records:count.count};
  });
  await step("inspect-complete-paged-dimension-totals",async()=>{
   await page.locator("#tab-totals").click();
   await page.waitForFunction(()=>document.querySelector("#totals-status")?.textContent.startsWith("Showing"),null,{timeout:60000});
   const first=(await get("api/totals",{offset:0,limit:40})).value;check(first.total===result.totals.count,"Full dimension total count differs");
   if(first.total>40){await page.locator('[data-totals-page="next"]').click();await page.waitForFunction(()=>document.querySelector("#totals-status").textContent.startsWith("Showing 41–"),null,{timeout:60000});await page.locator('[data-totals-page="previous"]').click();await page.waitForFunction(()=>document.querySelector("#totals-status").textContent.startsWith("Showing 1–"),null,{timeout:60000});}
   if(first.rows.length){
    const total=first.rows[0];await page.locator('[data-total="'+total.total_id+'"]').click();await page.locator("#download-total").waitFor();
    const file=await downloaded(page,"#download-total","Migration_Selected_Total.json");check(await fs.readFile(file,"utf8")===(await get("api/total",{id:total.total_id})).text,"Complete native total response retained exactly");
    await page.locator("#totals-pair").selectOption(total.pair);await page.locator("#totals-field").selectOption(total.field);await page.locator("#total-status").selectOption(total.status);
    if(total.dimensions.length)await page.locator("#dimension-search").fill(String(total.dimensions[0]));
    const response=page.waitForResponse(r=>new URL(r.url()).pathname===origin.pathname+"api/totals");await page.locator("#totals-filters button").click();const filtered=await(await response).json();
    await page.waitForFunction(n=>document.querySelector("#totals-status").textContent.includes("of "+n+" matching total groups."),filtered.total,{timeout:60000});
    const fileAll=await downloaded(page,"#download-filtered-totals-jsonl","Migration_Filtered_Totals.jsonl");check((await countJSONL(fileAll)).count===filtered.total,"Filtered totals export includes all matching groups");
    await downloaded(page,"#download-filtered-totals-csv","Migration_Filtered_Totals.csv");
   }
   await capture(page,"04-dimension-totals.png");return {total_groups:first.total,paged:first.total>40};
  });
  await step("inspect-mappings-coverage-and-original-definitions",async()=>{
   const mapping=result.pairs.find(p=>p.key_mapping&&Object.values(p.crosswalk_issue_counts??{}).some(n=>n>0))||result.pairs.find(p=>p.key_mapping)||result.pairs.find(p=>p.id===chosen.pair);
   await page.locator("#tab-definition").click();await page.locator("#definition-pair").selectOption(mapping.id);await capture(page,"05-mapping-and-coverage.png");
   await page.locator("#show-crosswalk").click();await page.waitForFunction(()=>document.querySelector("#rows-status").textContent.includes("; CROSSWALK_ISSUE;"),null,{timeout:60000});
   await page.locator("#tab-sources").click();await page.waitForFunction(()=>document.querySelector("#sources-panel h2")?.textContent.startsWith("Complete original"),null,{timeout:60000});
   const original=page.locator("#sources-panel details").first();await original.locator("summary").click();await capture(page,"06-original-source-definitions.png");
   return {source_tables:result.source_inputs.length,mapping_pair:mapping.id,crosswalk_issues:mapping.crosswalk_issue_counts??{}};
  });
  await step("desktop-keyboard-narrow-and-current-view-print",async()=>{
   await page.locator("#tab-sources").focus();await page.keyboard.press("Home");check(await page.locator("#tab-records").getAttribute("aria-selected")==="true","Keyboard Home selects first view");
   await rowView(page,{pair:chosen.pair,classification:chosen.classification});await selectRow(page,chosen);
   await page.setViewportSize({width:390,height:844});await capture(page,"07-records-narrow.png");
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),"Narrow document overflows outside its table scrollers");
   await page.locator("#tab-totals").click();await page.waitForFunction(()=>document.querySelector("#totals-status")?.textContent.startsWith("Showing"),null,{timeout:60000});await capture(page,"08-totals-narrow.png");
   await page.setViewportSize({width:1440,height:1050});await page.locator("#tab-definition").click();
   const pdf=path.join(attempt,"Migration_Current_View.pdf");await page.pdf({path:pdf,format:"A4",printBackground:true});await retained(pdf);return {narrow_width:390,printed_scope:"Current mapping view"};
  });
  await step("stream-all-original-results-and-complete-case",async()=>{
   await page.locator("#tab-downloads").click();
   const expected=[["#download-all-jsonl","All_Rows.jsonl",result.rows.jsonl],["#download-all-csv","All_Rows.csv",result.rows.csv],["#download-all-totals-jsonl","All_Totals.jsonl",result.totals.jsonl],["#download-all-totals-csv","All_Totals.csv",result.totals.csv],
    ['a[href="download/result.json"]',"Migration_Result.json",local.result],['a[href="download/source-report.json"]',"Original_Report.json",local.report],['a[href="download/manifest.original.json"]',"Original_Manifest.json",local.manifest]];
   for(const[selector,name,wanted]of expected){const file=await downloaded(page,selector,name);await exactFile(file,wanted);}
   if(receipt.archive){const file=await downloaded(page,"#download-case","Migration_Case.zip");await exactFile(file,receipt.archive);}
   else check(await page.locator("#download-case").getAttribute("aria-disabled")==="true","Unavailable archive must be visibly disabled");
   await capture(page,"09-complete-downloads.png");return {full_rows:result.rows.count,full_totals:result.totals.count,whole_archive:!!receipt.archive};
  });
  await step("cold-reopen-subset-html-and-exact-server-view",async()=>{
   const cold=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1050}});
   const offline=await cold.newPage();await offline.goto(pathToFileURL(savedView.snapshot).href,{waitUntil:"domcontentloaded"});
   check((await offline.locator("body").textContent()).includes("explicitly limited"),"Downloaded snapshot states its limited scope");await capture(offline,"10-cold-page-snapshot.png");
   const reopened=await cold.newPage();await app(reopened);await reopened.locator("#tab-downloads").click();await reopened.locator("#load-view").setInputFiles(savedView.settings);
   await reopened.waitForFunction(()=>document.querySelector("#notice").textContent.startsWith("Restored the view"),null,{timeout:60000});
   check(await reopened.locator("#pair-filter").inputValue()===chosen.pair,"Cold restore retains exact selected pair");
   await reopened.locator("#tab-records").click();check((await reopened.locator("#record-detail h2").textContent()).endsWith(String(chosen.row_id)),"Cold source-bound detail restored");await capture(reopened,"11-cold-server-view.png");await cold.close();return {same_original_case:true,subset_html_opened:true};
  });
  check(pageErrors.length===0,"Actual browser reported errors: "+pageErrors.join("; "));
  await browser.close();browser=null;
  await save("VIEWING.md",[
   "# Actual migration inspector receiving — view the saved outputs","",
   "This course operated the existing native localhost case and downloaded its actual files. Functional completion is not a claim that screenshot pixels or PDF pages were viewed.","",
   "Open and VIEW every PNG in this attempt at its real dimensions. Inspect every page of Migration_Current_View.pdf. Check original field values, exact fractions, long keys, unresolved/null states, source/target CSV dialogs, totals and narrow table scrolling.","",
   "Open Migration_Current_Page.html offline and confirm its explicit subset scope and no private server token. Open complete Migration_Result.json, Original_Report.json and Original_Manifest.json; inspect the selected full JSONL/CSV identities and complete Migration_Case.zip if supplied.","",
   "Use the original native receiving course to receive the complete archive and reopen the whole case with its selected application. Keep full population and totals streams; do not replace the complete case with one page snapshot.","",
   "Record actual viewer/outcome in the existing original receiving thread. visual_review remains pending until those actual screenshots, PDF and exports are opened and viewed. Preserve user-selected tabs and current owner browser instructions.","",
   "TJLabs attribution remains. No customer message, acceptance or production-system change is performed.",""
  ].join("\n"));
  const outcome={schema:SCHEMA,status:"BROWSER_COURSE_COMPLETE",input_sha256:inputSHA,source_run_identity:result.source_run_identity,selection_sha256:result.selection_sha256,browser_version:version,steps,artifacts,visual_review:"PENDING_ACTUAL_SCREENSHOT_AND_EXPORT_VIEWING",server_ownership:"Existing original native process remains with its launching owner"};
  await atomic(outcomePath,JSON.stringify(outcome,null,2)+"\n",true);console.log(JSON.stringify(outcome));
 }
}catch(error){
 const message=safeError(error);if(attempt)await atomic(path.join(attempt,"failure.json"),JSON.stringify({schema:SCHEMA,status:"INCOMPLETE",input_sha256:inputSHA,error:message,steps,artifacts,visual_review:"PENDING_ACTUAL_SCREENSHOT_AND_EXPORT_VIEWING"},null,2)+"\n");
 console.error(message);process.exitCode=2;
}finally{
 if(browser)await browser.close().catch(()=>{});
 if(ownsLock){try{const current=JSON.parse(await fs.readFile(lockPath,"utf8"));if(current.token===owner.token)await fs.unlink(lockPath);}catch(e){if(e.code!=="ENOENT")console.error("Original lock retained: "+safeError(e));}}
}
