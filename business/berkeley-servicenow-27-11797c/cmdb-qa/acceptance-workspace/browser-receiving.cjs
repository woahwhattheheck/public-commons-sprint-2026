#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */
"use strict";
const fs=require("node:fs"),path=require("node:path"),http=require("node:http"),assert=require("node:assert/strict"),cp=require("node:child_process");
const C=require("./workspace.cjs"),Example=require("./example.cjs"),{build}=require("./build.cjs");
function installedPlaywright(cdp){
 const selected=process.env.ALCOR_PLAYWRIGHT_MODULE;
 let entry,metadata;
 const candidates=selected?[path.resolve(selected)]:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES&&path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,"playwright"),"playwright","playwright-core"].filter(Boolean);
 for(const candidate of candidates){try{entry=require.resolve(candidate);break;}catch{}}
 if(!entry)throw Error("Select an existing Playwright installation with ALCOR_PLAYWRIGHT_MODULE; this course installs no runtime.");
 if(cdp){
  let directory=path.dirname(entry);
  while(true){
   const file=path.join(directory,"package.json");
   if(fs.existsSync(file)){const p=JSON.parse(fs.readFileSync(file,"utf8"));if(["playwright","playwright-core"].includes(p.name)){metadata=p;break;}}
   const parent=path.dirname(directory);if(parent===directory)break;directory=parent;
  }
  const version=metadata&&/^(\d+)\.(\d+)\./.exec(metadata.version);
  if(!version||Number(version[1])<1||(Number(version[1])===1&&Number(version[2])<60))throw Error("Existing-CDP receiving needs installed Playwright 1.60 or later for noDefaults.");
 }
 return require(entry);
}
async function receive(out){
 const cdp=process.env.ALCOR_CDP_ENDPOINT||"";
 if(cdp){const u=new URL(cdp);if(!["http:","https:","ws:","wss:"].includes(u.protocol)||u.username||u.password)throw Error("Use the existing authorized CDP endpoint without embedded credentials.");}
 const {chromium}=installedPlaywright(cdp);
 fs.mkdirSync(out,{mode:0o700}); // Preserve previous output; select a new directory for the complete course.
 build(path.join(out,"release"));
 const root=path.resolve(out);
 const views=[],events=[],errors=[],ownedContexts=new Set();let browser,server;
 const record=(stage,details={})=>{const e={stage,...details};events.push(e);console.log(JSON.stringify(e));};
 const result={operation:"ALCOR-ORIGINAL-CMDB-BROWSER-379A",status:"RUNNING",views,events};
 const save=()=>fs.writeFileSync(path.join(root,"BROWSER_RECEIVING.json"),JSON.stringify(result,null,2)+"\n");
 try{
  let origin;
  if(cdp){
   origin="https://alcor-original-receiving.invalid";
   browser=await chromium.connectOverCDP(cdp,{timeout:20000,noDefaults:true});
   result.connection="existing_authorized_cdp_private_context";
  }else{
   server=http.createServer((req,res)=>{let name;try{name=decodeURIComponent(new URL(req.url,"http://localhost").pathname);}catch{return res.writeHead(400).end();}
    const p=path.resolve(root,"."+name);if(!p.startsWith(root+path.sep))return res.writeHead(403).end();
    try{const data=fs.readFileSync(p);res.setHeader("Content-Type",p.endsWith(".html")?"text/html; charset=utf-8":"application/octet-stream");res.end(data);}catch{res.writeHead(404).end();}});
   await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});origin="http://127.0.0.1:"+server.address().port;
   browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||"/workspace/scratch/5403360e55a4/counterpress-capture-runtime/bin/chromium",headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
   result.connection="owned_chromium";
  }
  const createContext=async(viewport)=>{
   const context=await browser.newContext({viewport,acceptDownloads:true,serviceWorkers:"block"});ownedContexts.add(context);
   if(cdp){
    const allowed=new Map([["/release/Open_CMDB_Workspace.html",path.join(root,"release","Open_CMDB_Workspace.html")],["/received-handover/Open_CMDB_Workspace.html",path.join(root,"received-handover","Open_CMDB_Workspace.html")]]);
    await context.route("**/*",async route=>{
     const request=route.request(),url=new URL(request.url()),filename=url.origin===origin&&allowed.get(url.pathname);
     if(filename&&request.isNavigationRequest()&&request.method()==="GET"&&!url.search){
      await route.fulfill({status:200,contentType:"text/html; charset=utf-8",body:fs.readFileSync(filename),headers:{"cache-control":"no-store"}});
     }else{if(!url.pathname.endsWith("/favicon.ico"))errors.push("Unexpected document resource: "+url.origin+url.pathname);await route.abort();}
    });
   }
   return context;
  };
  record("original_browser_started",{connection:result.connection});const context=await createContext({width:1440,height:1080});
  let page=await context.newPage();page.on("pageerror",error=>errors.push(error.message));
  const idle=()=>page.waitForFunction(()=>!document.body.dataset.busy);
  const click=async(selector)=>{await page.locator(selector).click();await idle();};
  const tab=async(name)=>click('[data-tab="'+name+'"]');
  const screenshot=async(name,width)=>{await idle();const dims=await page.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:innerWidth}));
   assert(dims.page<=dims.viewport+1,"Page overflow: "+name+" "+JSON.stringify(dims));const filename=name+".jpg";
   await page.screenshot({path:path.join(root,filename),type:"jpeg",quality:85,fullPage:true});views.push({name,width,...dims,file:filename});save();};
  const download=async(selector,name)=>{const waiting=page.waitForEvent("download");await click(selector);const d=await waiting;await d.saveAs(path.join(root,name));return path.join(root,name);};
  await page.goto(origin+"/release/Open_CMDB_Workspace.html");await page.locator('[data-action="new"]').first().waitFor();
  await page.locator("#save-state").filter({hasText:"No workspace open"}).waitFor();
  await click('footer [data-action="guide"]');await page.locator("#content .guide").waitFor();
  const initialGuide=await download('[data-action="save-guide"]',"operating-guide-before-workspace.md");
  assert.equal(fs.readFileSync(initialGuide,"utf8"),fs.readFileSync(path.join(__dirname,"OPERATOR.md"),"utf8"));
  record("operating_guide_opened_before_workspace");
  await page.locator("#actor").fill("Authored browser operator");await page.locator("#actor").blur();await click('.workspace-bar [data-action="new"]');
  for(const [name,value]of Object.entries({label:"Original hardware receiving",customer:"Authored acceptance customer",tableClass:"Authored hardware assets",owner:"Authored delivery owner"}))await page.locator('#new-form [name="'+name+'"]').fill(value);
  await click('#new-form button[type="submit"]');await page.locator("#new-dialog").waitFor({state:"hidden"});
  async function importCsv(label,side,text,parentLabel){
   await tab("intake");await page.selectOption("#import-side",side);await page.fill("#import-label",label);
   if(parentLabel){const v=await page.locator("#import-parent option").evaluateAll((xs,label)=>xs.find(x=>x.textContent.startsWith(label))?.value,parentLabel);assert(v);await page.selectOption("#import-parent",v);}
   await page.fill("#import-note","Authored complete file received through the original browser workflow.");
   await page.locator("#csv-file").setInputFiles({name:label+".csv",mimeType:"text/csv",buffer:Buffer.from(text)});await click('[data-action="import"]');
   await page.locator("#content tbody tr").filter({hasText:label}).first().waitFor();
  }
  async function map(){
   await tab("mapping");await page.selectOption("#key-target","asset_id");
   for(let i=0;i<Example.mapping.fields.length;i++){const r=Example.mapping.fields[i];await page.fill("#field-name-"+i,r.name);await page.selectOption("#field-source-"+i,r.source);await page.selectOption("#field-target-"+i,r.target);}
  }
  await importCsv("Original baseline","source","\ufeff"+Example.source);await importCsv("Duplicate target","target",Example.invalid);
  await map();await click('[data-action="preview-mapping"]');await page.getByText("Duplicate stable key",{exact:true}).waitFor();await screenshot("desktop-01-input-problem",1440);
  await importCsv("First valid target","target",Example.target,"Duplicate target");await map();await page.fill("#mapping-label","Original hardware mapping");
  await click('[data-action="preview-mapping"]');await screenshot("desktop-02-field-mapping",1440);await click('[data-action="save-mapping"]');
  await page.fill("#compare-label","First received target");await click('[data-action="compare"]');await page.locator(".finding-choice").first().waitFor();
  assert.equal(await page.locator(".finding-choice").count(),4);await screenshot("desktop-03-original-comparison",1440);
  async function review(keys,status,note,evidence){
   await page.locator(".finding-choice").evaluateAll(xs=>xs.forEach(x=>x.checked=false));
   for(const key of keys)await page.locator('.finding-choice[aria-label^="Select '+key+' "]').check();
   await page.selectOption("#review-status",status);await page.fill("#review-owner","Authored receiving owner");await page.fill("#review-note",note);await page.fill("#review-evidence",evidence);await click('[data-action="review"]');
  }
  await review(["A-100","A-400"],"correction_required","Restore original owner and missing laptop.","Authored correction 12");
  await review(["A-200","A-700"],"accepted_change","Relocation and new asset are approved.","Authored approval 42");await screenshot("desktop-04-exception-ownership",1440);
  async function accept(status,note,reference){
   await tab("receiving");await page.selectOption("#accept-status",status);await page.fill("#accept-person","Authored receiving lead");await page.fill("#accept-authority",reference);await page.fill("#accept-note",note);await click('[data-action="accept"]');
  }
  await accept("REVIEW_REQUIRED","Correct the two original asset differences.","Authored acceptance 10");
  await importCsv("Corrected target","target",Example.correction,"First valid target");
  await tab("comparison");await page.fill("#compare-label","Corrected target received");await page.locator("#carry-accepted").check();await click('[data-action="compare"]');
  assert.equal(await page.locator(".finding-choice").count(),2);await screenshot("desktop-05-corrected-comparison",1440);
  await accept("ACCEPTED","Original ownership and inventory restored; approved changes retained.","Authored acceptance 43");await screenshot("desktop-06-acceptance",1440);
  const saved=await download('[data-action="workspace"]',"browser-workspace.json"),workspace=C.receive(fs.readFileSync(saved,"utf8"));
  assert.equal(workspace.snapshots.length,4);assert.equal(workspace.runs.length,2);assert.equal(workspace.revision,11);
  assert.equal(workspace.snapshots[0].text,"\ufeff"+Example.source);assert.equal(workspace.snapshots[0].bytes,Buffer.byteLength("\ufeff"+Example.source));
  assert.equal(C.acceptance(workspace,workspace.runs.at(-1).id).status,"ACCEPTED");
  await download('[data-action="report"]',"browser-acceptance-report.html");await download('[data-action="exceptions"]',"browser-exceptions.csv");
  const zip=await download('[data-action="package"]',"browser-complete-handover.zip"),extracted=path.join(root,"received-handover");
  const py=`import sys,json,zipfile,pathlib,hashlib
archive,out=pathlib.Path(sys.argv[1]),pathlib.Path(sys.argv[2])
out.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(archive) as z:
 manifest=json.loads(z.read("HANDOVER.json"))
 for row in manifest["files"]:
  data=z.read(row["path"])
  if len(data)!=row["bytes"] or hashlib.sha256(data).hexdigest()!=row["sha256"]:raise ValueError("Original member differs: "+row["path"])
 for member in z.infolist():
  p=(out/member.filename).resolve()
  if not p.is_relative_to(out.resolve()):raise ValueError("Unsafe archive member")
  if member.is_dir():p.mkdir(parents=True,exist_ok=True)
  else:p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(z.read(member))
 print(json.dumps({"members":len(z.infolist()),"verified":len(manifest["files"]),"workspaceSha256":manifest["workspaceSha256"]}))
`;
  const zipResult=JSON.parse(cp.execFileSync(process.env.CODEX_PRIMARY_RUNTIME_PYTHON||"python3",["-c",py,zip,extracted],{encoding:"utf8"}));
  assert.equal(C.canonical(C.receive(fs.readFileSync(path.join(extracted,"workspace.json"),"utf8"))),C.canonical(workspace));
  result.archive=zipResult;result.originalBomPreserved=true;record("complete_original_handover_reopened",zipResult);
  await tab("history");await screenshot("desktop-07-history",1440);await tab("overview");await screenshot("desktop-08-overview",1440);
  await click('[data-action="guide"]');await screenshot("desktop-09-operating-guide",1440);
  await context.close();ownedContexts.delete(context);
  const phone=await createContext({width:390,height:844});page=await phone.newPage();page.on("pageerror",error=>errors.push(error.message));
  await page.goto(origin+"/received-handover/Open_CMDB_Workspace.html");await page.getByText("Original hardware receiving",{exact:true}).waitFor();
  for(const [name,key]of [["overview","overview"],["intake","intake"],["mapping","mapping"],["comparison","comparison"],["acceptance","receiving"],["history","history"]]){
   await tab(key);await screenshot("phone-"+name,390);
  }
  await tab("comparison");await page.fill("#actor","Authored phone reviewer");await page.locator("#actor").blur();
  await review(["A-200"],"assigned","Confirm revised customer reference on the received copy.","");
  await tab("receiving");await page.getByText("superseded by later exception review",{exact:false}).waitFor();await screenshot("phone-later-review",390);
  await tab("comparison");await review(["A-200"],"accepted_change","Reconfirmed the same approved relocation.","Authored approval 42, received copy");
  await accept("ACCEPTED","Received full original record and reconfirmed the updated review.","Authored phone receiving 44");
  const phoneSaved=await download('[data-action="workspace"]',"phone-received-workspace.json"),phoneWorkspace=C.receive(fs.readFileSync(phoneSaved,"utf8"));
  assert.equal(phoneWorkspace.revision,14);assert.equal(phoneWorkspace.id,workspace.id);assert.equal(phoneWorkspace.acceptances.length,3);
  assert(C.acceptance(phoneWorkspace,phoneWorkspace.runs.at(-1).id).current);await screenshot("phone-complete-receiving",390);
  await page.reload();await page.getByText("Original hardware receiving",{exact:true}).waitFor();await tab("history");
  assert.equal(await page.locator("#content table").first().locator("tbody tr").count(),14);await screenshot("phone-reopened-history",390);
  assert.deepEqual(errors,[]);result.status="PASS";result.originalRevision=11;result.receivedRevision=14;result.browserErrors=errors;record("original_browser_complete",{views:views.length});save();
 }catch(error){result.status="FAILED";result.error={message:error.message,stack:error.stack};save();throw error;}
 finally{
  const cleanup=[];
  for(const context of ownedContexts){try{await context.close();}catch(error){cleanup.push("Owned context: "+error.message);}}
  // Never close the attached browser or touch its existing default context.
  if(browser&&!cdp){try{await browser.close();}catch(error){cleanup.push("Owned browser: "+error.message);}}
  if(server){try{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}catch(error){cleanup.push("Owned server: "+error.message);}}
  if(cleanup.length){result.cleanupErrors=cleanup;result.status="FAILED";}
  record("original_browser_closed",{connection:result.connection,ownedContextsOnly:!!cdp});save();
 }
 return result;
}
if(require.main===module){
 receive(path.resolve(process.argv[2]||"browser-output")).then(r=>{console.log(JSON.stringify({status:r.status,views:r.views.length}));process.exit(r.status==="PASS"?0:1);}).catch(e=>{console.error(e.stack);process.exit(1);});
}
// CLI exit detaches a CDP connection after closing only this course's private contexts.
module.exports={receive};
