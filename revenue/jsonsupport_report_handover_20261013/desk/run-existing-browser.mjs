#!/usr/bin/env node
import fs from "node:fs/promises";
import nativeFs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
import {pathToFileURL,fileURLToPath} from "node:url";
const require=createRequire(import.meta.url),api=require("./report-core.cjs"),sha=require("../runtime/host/connected_sha256.cjs"),zip=require("../runtime/host/connected_zip.cjs");
function installedPlaywright(selected){
 let entry,packagePath;
 if(selected){
  entry=path.resolve(selected);let directory=path.dirname(entry);
  while(true){
   const candidate=path.join(directory,'package.json');
   if(nativeFs.existsSync(candidate)){
    const p=JSON.parse(nativeFs.readFileSync(candidate,'utf8'));
    if(['playwright','playwright-core'].includes(p.name)){packagePath=candidate;break;}
   }
   const parent=path.dirname(directory);if(parent===directory)break;directory=parent;
  }
 }else{
  for(const name of ['playwright','playwright-core']){
   try{entry=require.resolve(name);packagePath=require.resolve(name+'/package.json');break;}catch{}
  }
 }
 if(!entry||!packagePath)throw Error('Select the existing Playwright installation with --playwright-module; this course performs no installation.');
 const metadata=JSON.parse(nativeFs.readFileSync(packagePath,'utf8'));
 const version=/^(\d+)\.(\d+)\./.exec(metadata.version);
 if(!version||Number(version[1])<1||(Number(version[1])===1&&Number(version[2])<60))throw Error('The selected existing Playwright must support connectOverCDP noDefaults (version 1.60 or later).');
 return {entry,metadata};
}


function parse(argv){const a={};for(let i=0;i<argv.length;i++){if(!["--built","--out","--cdp"].includes(argv[i])||!argv[i+1]||a[argv[i]])throw Error("Use --built COMPLETE_BUILD --out NEW_OUTPUT --cdp EXISTING_ENDPOINT");a[argv[i]]=argv[++i];}if(!a["--built"]||!a["--out"]||!a["--cdp"])throw Error("Use --built COMPLETE_BUILD --out NEW_OUTPUT --cdp EXISTING_ENDPOINT");const endpoint=new URL(a["--cdp"]);if(!["http:","https:","ws:","wss:"].includes(endpoint.protocol)||endpoint.username||endpoint.password)throw Error("Use the existing CDP endpoint without embedded credentials.");return a;}
async function exists(p){try{await fs.stat(p);return true;}catch(e){if(e.code==="ENOENT")return false;throw e;}}
export async function run(argv){
 const args=parse(argv),built=path.resolve(args["--built"]),out=path.resolve(args["--out"]);if(await exists(out))throw Error("Select a new review directory.");await fs.mkdir(out,{mode:0o700});
 const receipt={schema:"jsonsupport.report-desk-browser.v1",status:"running",started_at:new Date().toISOString(),source:built,views:[],downloads:[],operations:[],errors:[]},contexts=[];
 const save=async()=>fs.writeFile(path.join(out,"review.json"),JSON.stringify(receipt,null,2)+"\n");
 let currentPage;
 try{
  await save();const selected=installedPlaywright(process.env.JSONSUPPORT_PLAYWRIGHT_MODULE);const pw=await import(pathToFileURL(selected.entry).href);receipt.playwright=selected.metadata.version;
  const browser=await pw.chromium.connectOverCDP(args["--cdp"],{noDefaults:true});receipt.connected=true;await save();
  const apps={};for(const kind of ["sample","paid"]){const file=path.join(built,"customer","report-"+kind,"app.html"),body=await fs.readFile(file,"utf8");apps[kind]={body,file,identity:sha.sha256Utf8(body),initial:api.receiveWorking(await fs.readFile(path.join(built,"customer","report-"+kind,"working.json"),"utf8"))};}
  async function context(width){const c=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true,serviceWorkers:"block"});contexts.push(c);await c.route("**/*",async route=>{const u=new URL(route.request().url());const app=u.origin==="https://json-report-review.invalid"&&!u.search?apps[u.pathname.split("/")[1]]:null;if(app&&u.pathname.endsWith("/app.html")&&route.request().isNavigationRequest()&&route.request().method()==="GET")await route.fulfill({status:200,contentType:"text/html; charset=utf-8",body:app.body});else await route.abort();});return c;}
  async function open(c,kind){const p=await c.newPage();currentPage=p;p.on("pageerror",e=>receipt.errors.push({kind,message:e.message}));const response=await p.goto("https://json-report-review.invalid/"+kind+"/app.html");if(!response||await response.text()!==apps[kind].body)throw Error("Actual opening document differs from the complete selected source.");await p.locator("#agency-name").waitFor();return p;}
  async function capture(p,kind,width,name){const dimensions=await p.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}));if(dimensions.width>width)throw Error(kind+" "+name+" overflows at "+width+"px: "+dimensions.width);const filename=kind+"-"+width+"-"+name+".png";await p.screenshot({path:path.join(out,filename),fullPage:true});receipt.views.push({kind,width,name,file:filename,...dimensions});await save();}
  async function download(p,selector,name,expected){const [d]=await Promise.all([p.waitForEvent("download"),p.locator(selector).click()]);const target=path.join(out,name);await d.saveAs(target);const data=await fs.readFile(target);if(expected!==undefined&&data.toString("utf8")!==expected)throw Error("Actual download differs: "+name);receipt.downloads.push({file:name,...sha.sha256Bytes(new Uint8Array(data))});await save();return target;}
  async function stateOf(p,kind){const value=await p.evaluate(k=>localStorage.getItem(k),"tjl-json-report:"+apps[kind].initial.seed_sha256);if(!value)throw Error("Actual browser working copy missing.");return api.receiveWorking(value,apps[kind].initial.seed_sha256);}
  for(const kind of ["sample","paid"]){
   const c=await context(1440),p=await open(c,kind),initial=apps[kind].initial,lead=initial.seed.leads[0],leadId=lead.id;
   await capture(p,kind,1440,"agency-context");
   await p.locator('[data-tab="report"]').click();await p.locator('[name="report_name"]').fill("Public agency report — browser preparation");await p.locator('[name="client"]').fill("TJL-authored source preparation");await p.locator('[name="source_system"]').fill("Original public agency profile");await p.locator('[name="operator"]').fill("Prepared report operator");await p.locator('[name="route"]').selectOption("api");await p.locator('[name="data_notes"]').fill("Public business research only. Actual browser mapping and downloads; no remote conversion requested.");
   const record={agency:lead.document.organization,reference:"00017",checked:lead.document.checked_at,source:lead.document.source_url};
   await p.locator('[name="source_text"]').fill(JSON.stringify({records:[record]},null,2));await p.locator('[name="records_pointer"]').fill("/records");
   for(const col of [{name:"Agency",pointer:"/agency",type:"text"},{name:"Reference",pointer:"/reference",type:"text"},{name:"Checked",pointer:"/checked",type:"date"},{name:"Source",pointer:"/source",type:"text"}]){await p.locator("#add-column").click();const r=p.locator(".column-row").last();await r.locator('[data-field="name"]').fill(col.name);await r.locator('[data-field="pointer"]').fill(col.pointer);await r.locator('[data-field="type"]').selectOption(col.type);await r.locator('[data-field="required"]').check();}
   await p.locator("#preview-draft").click();if(!await p.locator("#preview").innerText().then(x=>x.includes("0 issues")))throw Error("Actual mapped preview contains issues.");
   await p.locator('#report-form button[type="submit"],#report-form .actions button').first().click();
   let working=await stateOf(p,kind);if(working.revision!==1||api.compile(working.projects[leadId]).rows[0].Reference!=="00017")throw Error("Actual saved report lost its source identifier.");
   await p.locator("#preview-draft").click();await capture(p,kind,1440,"report-setup");
   await p.locator('[name="report_name"]').fill("Unsaved field remains");p.once("dialog",d=>d.dismiss());await p.locator('[data-tab="run"]').click();if(await p.locator('[name="report_name"]').inputValue()!=="Unsaved field remains")throw Error("Declined navigation lost the current form.");await p.locator('[name="report_name"]').fill(working.projects[leadId].config.report_name);p.once("dialog",d=>d.accept());await p.locator('[data-tab="run"]').click();
   await download(p,"#request-file",kind+"-request.json",api.requestBody(working.projects[leadId]));await download(p,"#preview-csv",kind+"-preview.csv",api.previewCsv(working.projects[leadId]));
   await p.locator('[name="output_name"]').fill(kind+"-preview.csv");await p.locator('[name="output_rows"]').fill("1");await p.locator('[name="notes"]').fill("Actual browser saved the mapped public research and downloaded its complete JSON request and local CSV. Remote spreadsheet conversion awaits the selected account operation.");await p.locator("#run-form button").first().click();
   await capture(p,kind,1440,"conversion-results");await p.locator('[data-tab="handover"]').click();await p.locator('[name="title"]').fill("Public source preparation");await p.locator("#handover-form button").click();working=await stateOf(p,kind);
   await download(p,".download-handover",kind+"-handover.json",JSON.stringify(working.projects[leadId].handovers[0],null,2)+"\n");await download(p,".handover-report",kind+"-handover.html");await capture(p,kind,1440,"handover");
   await p.locator('[data-tab="guide"]').click();await capture(p,kind,1440,"guide");
   const workingPath=await download(p,"#export-working",kind+"-working.json",api.exportWorking(working));
   const sourcePath=await download(p,"#download-source",kind+"-application-source.json",await fs.readFile(path.join(built,"customer","report-"+kind,"application-source.json"),"utf8"));
   const source=JSON.parse(await fs.readFile(sourcePath,"utf8"));for(const f of source.files){const id=sha.sha256Utf8(f.content);if(id.bytes!==f.bytes||id.sha256!==f.sha256)throw Error("Downloaded source member differs: "+f.path);}
   const rebuild=require("../rebuild.cjs");const rebuilt=rebuild.rebuild(["--source",sourcePath,"--output-dir",path.join(out,kind+"-received-application")]);if(await fs.readFile(rebuilt.app,"utf8")!==apps[kind].body)throw Error("Downloaded whole source did not rebuild the original complete app.");
   const peer=await open(c,kind);await peer.locator('[data-tab="report"]').click();await peer.locator('[name="report_name"]').fill("Current browser copy from second tab");await peer.locator('#report-form .actions button').first().click();const newer=await stateOf(peer,kind);
   p.once("dialog",d=>d.accept());await p.locator("#open-working").setInputFiles(workingPath);await p.waitForFunction(()=>document.querySelector("#notice").textContent.includes("Another tab"));if(api.exportWorking(await stateOf(peer,kind))!==api.exportWorking(newer))throw Error("Stale import overwrote newer browser work.");await p.locator("#reopen-browser").click();await peer.close();
   const current=await stateOf(p,kind);const latestPath=await download(p,"#export-working",kind+"-current-working.json",api.exportWorking(current));await c.close();contexts.splice(contexts.indexOf(c),1);
   const phoneContext=await context(390),phone=await open(phoneContext,kind);phone.once("dialog",d=>d.accept());await phone.locator("#open-working").setInputFiles(latestPath);await phone.waitForFunction(()=>document.querySelector("#notice").textContent.includes("reopened"));if(api.exportWorking(await stateOf(phone,kind))!==api.exportWorking(current))throw Error("Independent phone receive changed the complete working file.");
   for(const [tab,name]of [["context","agency-context"],["report","report-setup"],["run","conversion-results"],["handover","handover"],["guide","guide"]]){await phone.locator('[data-tab="'+tab+'"]').click();if(tab==="report")await phone.locator("#preview-draft").click();await capture(phone,kind,390,name);}
   await download(phone,"#export-working",kind+"-phone-working.json",api.exportWorking(current));await phone.reload();await phone.locator("#agency-name").waitFor();if(api.exportWorking(await stateOf(phone,kind))!==api.exportWorking(current))throw Error("Phone reload lost complete work.");
   await capture(phone,kind,390,"reloaded");await phoneContext.close();contexts.splice(contexts.indexOf(phoneContext),1);
   const archive=await fs.readFile(path.join(built,"JSON-Support-report-"+kind+".zip"));const members=zip.readStoredZip(new Uint8Array(archive));if(members.length!==12)throw Error("Whole customer archive selection changed.");for(const item of members.filter(x=>x.name.startsWith("report-"+kind+"/"))){const selected=await fs.readFile(path.join(built,"customer",item.name));if(Buffer.compare(Buffer.from(item.data),selected)!==0)throw Error("Current customer archive member differs: "+item.name);}
   receipt.operations.push({edition:kind,agencies:initial.seed.leads.length,final_revision:current.revision,working_reopened_equal:true,source_rebuilt_equal:true,stale_import_preserved_newer_copy:true,unsaved_form_preserved:true,whole_archive_members:members.length});
  }
  if(receipt.errors.length)throw Error("Original application produced browser errors.");receipt.status="complete";
 }catch(error){receipt.status="interrupted";receipt.failure=String(error.stack||error);if(currentPage)try{await currentPage.screenshot({path:path.join(out,"last-observed-screen.png"),fullPage:true});}catch{}}
 finally{for(const c of contexts)try{await c.close();}catch{}receipt.finished_at=new Date().toISOString();await save();}
 return{output:out,...receipt};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){let code=1;try{const result=await run(process.argv.slice(2));console.log(JSON.stringify(result,null,2));code=result.status==="complete"?0:1;}catch(e){console.error(e.stack||e);}process.exit(code);}
