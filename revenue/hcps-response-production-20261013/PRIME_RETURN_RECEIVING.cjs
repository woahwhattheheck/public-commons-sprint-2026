#!/usr/bin/env node
"use strict";
const fs=require("node:fs"),path=require("node:path"),http=require("node:http"),crypto=require("node:crypto");
const C=require("./hcps-core.cjs"),R=require("./hcps-return.cjs"),{build,retain}=require("./BUILD.cjs");
const args=process.argv.slice(2),idx=args.indexOf("--case"),CASE=idx>=0?path.resolve(args[idx+1]):null;
function need(value,message){if(!value)throw Error(message);}
need(CASE&&CASE!==__dirname,"Use the same original HCPS --case.");
const ROOT=path.join(CASE,"prime-review"),attempt=crypto.randomUUID();fs.mkdirSync(ROOT,{recursive:true});
const lease=Number(process.env.HCPS_LEASE_FD);need(Number.isInteger(lease)&&lease>=3,"Use the original leased prime-review controller.");
const held=fs.fstatSync(lease),actual=fs.statSync(path.join(CASE,"operation.lock"));need(held.dev===actual.dev&&held.ino===actual.ino,"The original operation lease differs.");
const sha=raw=>crypto.createHash("sha256").update(raw).digest("hex"),read=file=>JSON.parse(fs.readFileSync(file,"utf8"));
function identity(file){const st=fs.lstatSync(file);need(st.isFile()&&!st.isSymbolicLink(),"Keep the exact ordinary original file.");const raw=fs.readFileSync(file);return{path:file,bytes:raw.length,sha256:sha(raw)};}
function json(file,value){retain(file,Buffer.from(JSON.stringify(value,null,2)+"\n"));}
function event(name,details={}){const v={at:new Date().toISOString(),name,...details};const fd=fs.openSync(path.join(ROOT,"events.jsonl"),"a");try{fs.writeSync(fd,JSON.stringify(v)+"\n");fs.fsyncSync(fd);}finally{fs.closeSync(fd);}process.stdout.write(JSON.stringify(v)+"\n");}
function verify(value){for(const f of value.artifacts||[]){const current=identity(f.path);need(current.bytes===f.bytes&&current.sha256===f.sha256,"A complete retained output differs: "+f.path);}return value;}
async function stage(name,fn){const file=path.join(ROOT,"stages",name+".json");if(fs.existsSync(file)){event(name,{state:"adopting-complete"});return verify(read(file));}event(name,{state:"started"});const result=verify(await fn());json(file,result);event(name,{state:"complete"});return result;}
function output(name){const file=path.join(ROOT,name);fs.mkdirSync(path.dirname(file),{recursive:true});return file;}
function attemptFile(name){return output("attempts/"+attempt+"/"+name);}
async function packageRead(file){return R.readPackage(fs.readFileSync(file,"utf8"));}
async function saveWorking(page,file){if(fs.existsSync(file)){await packageRead(file);return file;}const raw=await page.evaluate(()=>HCPSDesk.workingPackage());await R.readPackage(raw);retain(file,Buffer.from(raw));return file;}
function playwright(){for(const name of [process.env.HCPS_PLAYWRIGHT_REQUIRE,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES&&path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,"playwright"),"playwright"].filter(Boolean)){try{return require(name);}catch{}}throw Error("Use the existing Playwright runtime for this complete browser course.");}
async function ready(page){await page.waitForFunction(()=>window.HCPSDesk?.current()&&window.HCPSReturnUI&&document.body.getAttribute("aria-busy")!=="true"&&HCPSDesk.storageState().pendingWrites===0,{timeout:60000});}
async function click(page,id){await page.locator("#"+id).click();await page.waitForFunction(()=>document.body.getAttribute("aria-busy")!=="true"&&HCPSDesk.storageState().pendingWrites===0,{timeout:120000});need(!(await page.locator("#message").getAttribute("class")).includes("error"),await page.locator("#message").textContent());}
async function tab(page,name){await page.locator('[data-tab="'+name+'"]').click();await ready(page);}
async function working(page){const raw=await page.evaluate(()=>HCPSDesk.workingPackage());return{raw,...await R.readPackage(raw)};}
async function importOriginal(page,file){await tab(page,"history");await page.locator("#receive-file").setInputFiles(file);await click(page,"receive-package");}
async function requireNote(page,id,note){await tab(page,"requirements");await page.getByRole("button",{name:id,exact:true}).click();await page.locator("#requirement-note").fill(note);await click(page,"requirement-apply");}
async function download(page,id,file){if(fs.existsSync(file))return file;const pending=page.waitForEvent("download");await click(page,id);const item=await pending,tmp=output("downloads/."+crypto.randomUUID()+".receiving");await item.saveAs(tmp);try{retain(file,fs.readFileSync(tmp));}finally{fs.unlinkSync(tmp);}return file;}
const contexts=[],errors=[];let server,drain;
async function close(){if(drain)return drain;drain=(async()=>{const failures=[];for(let i=contexts.length-1;i>=0;i--){try{await contexts[i].close();contexts.splice(i,1);}catch(e){failures.push(e.message);}}if(server){try{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));server=null;}catch(e){failures.push(e.message);}}need(!failures.length,"Drain the original browser/server handles: "+failures.join("; "));})();try{return await drain;}finally{drain=null;}}
for(const sig of ["SIGTERM","SIGINT"])process.on(sig,()=>{event("signal",{signal:sig});close().then(()=>process.exit(sig==="SIGTERM"?143:130),e=>{console.error(e);process.exitCode=1;});});
(async()=>{
 const original=read(path.join(CASE,"COMPLETE.json"));need(original.status==="complete","Complete the existing original six-stage HCPS operation first.");
 for(const name of original.stages)verify(read(path.join(CASE,"stages",name+".json")));
 const authorFile=path.join(CASE,"author","Complete_Author_Workspace.json"),source=await packageRead(authorFile),playbackStage=read(path.join(CASE,"stages","04-complete-application-and-full-playback.json")),playbackFile=playbackStage.playback,playback=read(playbackFile);
 need(playback.intendedSeconds===225&&playback.trace.some(e=>e.event==="complete"&&e.elapsedSeconds<=240),"Use the actual completed original presentation trace.");
 const planFile=path.join(ROOT,"INPUT.json"),names=["hcps-core.cjs","hcps-return.cjs","hcps-app.js","hcps-return-ui.js","index.template.html","hcps.css","production-seed.json","BUILD.cjs","VERIFY.cjs","ASSEMBLE.py","PRIME_RETURN_RECEIVING.cjs","PRIME_RETURN_RECEIVING.py","OPERATING.md"],sourceFiles=names.map(name=>({name,...identity(path.join(__dirname,name))}));
 let input;if(fs.existsSync(planFile)){input=read(planFile);need(input.originalWorkspace.sha256===identity(authorFile).sha256&&input.playback.sha256===identity(playbackFile).sha256&&C.equal(input.sourceFiles,sourceFiles),"Retain this original source generation and full initial inputs.");}
 else{input={format:"commons.hcps.prime-return-original-input.v1",operationId:read(path.join(CASE,"operation.json")).operationId,workspaceId:source.workspace.workspaceId,originalWorkspace:identity(authorFile),playback:identity(playbackFile),sourceFiles,at:new Date().toISOString(),baselineEditionId:crypto.randomUUID(),purpose:"Review the actual completed original timed-course evidence and source-bound colleague corrections.",runtime:{node:process.version,chromium:process.env.HCPS_CHROMIUM||"Playwright existing default",playwrightRequire:process.env.HCPS_PLAYWRIGHT_REQUIRE||null}};json(planFile,input);}
 const baseline=await stage("01-complete-actual-playback-baseline",async()=>{
  const file=output("baseline/Complete_Reviewed_Playback_Baseline.json");
  if(fs.existsSync(file)){const w=(await packageRead(file)).workspace;need(w.editions.at(-1).id===input.baselineEditionId,"Retained actual-playback edition differs.");return{file,artifacts:[identity(file)]};}
  let w=C.clone(source.workspace);w=await C.addDocument(w,{name:"Complete_Original_225_Second_Playback.json",mediaType:"application/json",raw:new Uint8Array(fs.readFileSync(playbackFile)),role:"evidence",note:"Complete observed original twelve-slide playback; actual completion is within240seconds."});
  const document=w.draft.documents.at(-1),r=w.draft.requirements.find(x=>x.id==="R23");Object.assign(r,{status:"complete",note:"The original receiving programme observed all twelve slides after one manual start and retained the actual225-second course completion within240seconds.",reviewer:"Original HCPS receiving operator",decisionDate:input.at.slice(0,10),evidence:[{documentId:document.id,pages:"",locator:"Complete original playback trace and actual completion event"}]});
  w.draft.actor="Original HCPS receiving operator";w.draft.note=input.purpose;w=await C.saveEdition(w,{actor:w.draft.actor,note:w.draft.note,at:input.at,editionId:input.baselineEditionId});retain(file,Buffer.from(await C.pack(w)));return{file,artifacts:[identity(file)]};
 });
 const built=await build(__dirname,path.join(ROOT,"application")),routes=new Map([["/author.html",{file:path.join(ROOT,"application","HCPS_Response_Desk.html"),type:"text/html"}],["/colleague.html",{file:path.join(ROOT,"application","HCPS_Response_Desk.html"),type:"text/html"}]]);
 server=http.createServer((req,res)=>{const item=routes.get(new URL(req.url,"http://127.0.0.1").pathname);if(req.method!=="GET"||!item){res.writeHead(404);res.end();return;}const raw=fs.readFileSync(item.file);res.writeHead(200,{"Content-Type":item.type+";charset=utf-8","Content-Length":raw.length,"Cache-Control":"no-store"});res.end(raw);});
 const originFile=path.join(ROOT,"browser-origin.json"),port=fs.existsSync(originFile)?read(originFile).port:0;await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(port,"127.0.0.1",resolve);});const origin="http://127.0.0.1:"+server.address().port;json(originFile,{port:server.address().port,origin});
 const p=playwright(),launch={headless:true,viewport:{width:1440,height:1000},acceptDownloads:true,...(process.env.HCPS_CHROMIUM?{executablePath:process.env.HCPS_CHROMIUM}:{})};
 async function open(name,url){const context=await p.chromium.launchPersistentContext(path.join(ROOT,"browser-"+name),launch);contexts.push(context);const page=context.pages()[0]||await context.newPage();page.on("pageerror",e=>errors.push(name+": "+e.message));page.on("dialog",d=>d.accept());await page.goto(url);await ready(page);return page;}
 const author=await open("author",origin+"/author.html");
 if((await working(author)).workspace.workspaceId!==input.workspaceId)await importOriginal(author,baseline.file);
 const issued=await stage("02-actual-issued-edition",async()=>{
  await tab(author,"prime-review");let w=(await working(author)).workspace,issue=R.history(w).issues.find(x=>x.baselineEditionId===input.baselineEditionId);
  if(!issue){
   const pending=await author.evaluate(()=>HCPSDesk.reviewBridge.state()?.pendingIssue);
   if(pending){const wait=author.waitForEvent("download");await click(author,"issue-recover");await wait;}
   else{await author.locator("#issue-edition").selectOption(input.baselineEditionId);await author.locator("#issue-note").fill("Review original cover clarity and the exact retained full playback evidence.");const wait=author.waitForEvent("download");await click(author,"issue-create");await wait;}
   w=(await working(author)).workspace;issue=R.history(w).issues.find(x=>x.baselineEditionId===input.baselineEditionId);
  }
  need(issue,"The actual issued edition was not retained.");const file=output("issued/Complete_Issued_Edition.json");retain(file,Buffer.from(R.history(w).archives[issue.archiveSha256].raw));const work=await saveWorking(author,output("issued/Complete_Author_After_Issue.json"));const shot=attemptFile("Issued_Complete_Edition.png");await author.screenshot({path:shot,fullPage:true});return{file,work,issueId:issue.id,artifacts:[file,work,shot].map(identity)};
 });
 if(!R.history((await working(author)).workspace).issues.some(i=>i.id===issued.issueId))await importOriginal(author,issued.work);
 const colleague=await open("colleague",origin+"/colleague.html");
 const returned=await stage("03-colleague-complete-return-and-unfinished-draft",async()=>{
  const file=output("colleague/Complete_Colleague_Return.json");
  if(fs.existsSync(file)){const parsed=await packageRead(file);need(parsed.workspace.receiving.some(x=>x.packageSha256===identity(issued.file).sha256),"Retained return has another issued source.");if(!C.equal((await working(colleague)).workspace.draft,parsed.workspace.draft))await importOriginal(colleague,file);await tab(colleague,"slides");await colleague.locator("#slide-select").selectOption("P02");need((await colleague.locator("#slide-body").inputValue()).startsWith("Unfinished colleague"),"The actual adopted complete return lost its unfinished editor.");await colleague.reload();await ready(colleague);const shot=attemptFile("Colleague_Adopted_Unfinished_Reload.png");await colleague.screenshot({path:shot,fullPage:true});return{file,artifacts:[file,shot].map(identity)};}
  if(!(await working(colleague)).workspace.receiving.some(x=>x.packageSha256===identity(issued.file).sha256))await importOriginal(colleague,issued.file);
  await requireNote(colleague,"R01","Colleague clarification: retain the actual authorized signatory and exact legal entity fields from the original cover.");
  await tab(colleague,"documents");let w=(await working(colleague)).workspace,doc=w.draft.documents.find(d=>d.name==="Returned_Original_Playback_Trace.json");
  const copy=output("colleague/Returned_Original_Playback_Trace.json");retain(copy,fs.readFileSync(playbackFile));
  if(!doc){await colleague.locator("#document-files").setInputFiles(copy);await colleague.locator("#document-role").selectOption("evidence");await colleague.locator("#document-note").fill("The complete same actual original playback, selected explicitly by the independent colleague.");await click(colleague,"documents-add");w=(await working(colleague)).workspace;doc=w.draft.documents.find(d=>d.name==="Returned_Original_Playback_Trace.json");}
  await tab(colleague,"requirements");await colleague.getByRole("button",{name:"R23",exact:true}).click();await colleague.locator("#requirement-note").fill("Colleague reviewed the complete original playback and selected its independently retained full trace.");await colleague.locator("#requirement-reviewer").fill("Independent colleague receiving operator");await colleague.locator("#requirement-date").fill(input.at.slice(0,10));await colleague.locator("#requirement-evidence").fill(JSON.stringify([{documentId:doc.id,pages:"",locator:"Full original completion trace"}]));await click(colleague,"requirement-apply");
  const note="Independent colleague return over the exact issued source.";w=(await working(colleague)).workspace;
  if(!w.editions.some(e=>e.note===note)){await colleague.locator("#actor").fill("Independent colleague receiving operator");await colleague.locator("#review-note").fill(note);await tab(colleague,"history");await click(colleague,"edition-save");}
  await tab(colleague,"slides");await colleague.locator("#slide-select").selectOption("P02");await colleague.locator("#slide-body").fill("Unfinished colleague wording retained for the author to inspect; approved firm facts remain to be supplied.");
  await colleague.waitForFunction(()=>HCPSDesk.storageState().pendingWrites===0);const local=await colleague.evaluate(()=>HCPSDesk.current().id);await colleague.reload();await ready(colleague);need(await colleague.evaluate(()=>HCPSDesk.current().id)===local,"Reload changed the actual colleague working copy.");await tab(colleague,"slides");need((await colleague.locator("#slide-body").inputValue()).startsWith("Unfinished colleague"),"Unfinished colleague wording did not survive reload.");
  await saveWorking(colleague,file);const shot=attemptFile("Colleague_Unfinished_Reload.png");await colleague.screenshot({path:shot,fullPage:true});return{file,artifacts:[file,copy,shot].map(identity)};
 });
 const changed=await stage("04-independent-author-edition",async()=>{
  const file=output("author/Complete_Independent_Author.json");if(fs.existsSync(file)){await packageRead(file);return{file,artifacts:[identity(file)]};}
  const note="Independent author clarification before returned reconciliation.";
  if(!(await working(author)).workspace.editions.some(e=>e.note===note)){
   await requireNote(author,"R01","Author clarification: the cover must preserve the original legal entity and its authorized contract signatory.");
   await requireNote(author,"R23","Author reviewed the actual full timed trace and retained the original single-start completion record.");
   await author.locator("#actor").fill("Original HCPS author receiving operator");await author.locator("#review-note").fill(note);await tab(author,"history");await click(author,"edition-save");
  }
  await saveWorking(author,file);return{file,artifacts:[identity(file)]};
 });
 if(!(await working(author)).workspace.editions.some(e=>e.note==="Independent author clarification before returned reconciliation."))await importOriginal(author,changed.file);
 const accepted=await stage("05-full-browser-choice-reopening-and-apply",async()=>{
  const finalFile=output("author/Complete_Author_After_Return.json");
  if(fs.existsSync(finalFile)){const parsed=await packageRead(finalFile);need(R.history(parsed.workspace).decisions.length===1,"Retained complete author decision differs.");if(!C.equal(R.history((await working(author)).workspace),R.history(parsed.workspace)))await importOriginal(author,finalFile);await tab(author,"prime-review");const shot=attemptFile("Adopted_Complete_Review.png");await author.screenshot({path:shot,fullPage:true});await author.setViewportSize({width:390,height:844});const mobile=attemptFile("Adopted_Mobile_Return.png");await author.screenshot({path:mobile,fullPage:true});await author.setViewportSize({width:1440,height:1000});return{file:finalFile,artifacts:[finalFile,shot,mobile].map(identity)};}
  await tab(author,"prime-review");let state=await author.evaluate(()=>HCPSDesk.reviewBridge.state()),d=state?.drafts.find(x=>x.issueId===issued.issueId);
  if(!d){await click(author,"return-new");await author.locator("#return-issue").selectOption(issued.issueId);await author.locator("#return-file").setInputFiles(returned.file);await ready(author);await author.locator("#return-actor").fill("Original HCPS author receiving operator");await author.locator("#return-note").fill("Retain the author cover clarification, accept the colleague evidence selection and explicitly reopen its mixed completion review.");await click(author,"return-compare");}
  state=await author.evaluate(()=>HCPSDesk.reviewBridge.state());d=state.drafts.find(x=>x.id===state.selected);
  if(!d.completed){
   if(d.pending)await click(author,"return-recover");
   else{
    if(!d.preview)await click(author,"return-compare");
    await click(author,"return-all-returned");
    for(const field of ["field:/requirements/R01/note","field:/requirements/R23/note"]){const sel=author.locator('select[data-change-id="'+field+'"]');need(await sel.count()===1,"Actual complete comparison omitted "+field);await sel.locator("..").evaluate(e=>e.open=true);await sel.selectOption("current");}
    await author.locator("#return-ack").check();await author.waitForFunction(()=>HCPSDesk.storageState().pendingWrites===0);
    const before=await author.evaluate(()=>HCPSDesk.reviewBridge.state()),copyId=await author.evaluate(()=>HCPSDesk.current().id);await author.reload();await ready(author);await tab(author,"prime-review");need(await author.evaluate(()=>HCPSDesk.current().id)===copyId&&C.equal(await author.evaluate(()=>HCPSDesk.reviewBridge.state()),before),"The complete return and unfinished choices did not survive the actual reload.");
    await click(author,"return-plan-create");let prepared=await author.evaluate(()=>{const s=HCPSDesk.reviewBridge.state();return s.drafts.find(x=>x.id===s.selected).plan;});need(prepared.unresolved.some(x=>x.id==="requirement:R23"),"The mixed completion decision did not request an explicit material review.");
    await click(author,"return-reopen-materials");await click(author,"return-plan-create");prepared=await author.evaluate(()=>{const s=HCPSDesk.reviewBridge.state();return s.drafts.find(x=>x.id===s.selected).plan;});need(prepared.unresolved.length===0,"Explicit reopening did not resolve complete plan.");const shot=attemptFile("Complete_Three_Way_Review.png");await author.screenshot({path:shot,fullPage:true});await click(author,"return-apply");
   }
  }
  const result=await working(author),h=R.history(result.workspace);need(h.decisions.length===1,"Expected one complete attributed return decision.");need(result.workspace.draft.requirements.find(r=>r.id==="R23").status==="ready-for-review","The material-bound completion was not reopened.");need(result.workspace.draft.requirements[0].note.startsWith("Author clarification:"),"Author cover choice was lost.");need(h.archives[h.decisions[0].returnedSha256].raw===fs.readFileSync(returned.file,"utf8"),"The complete incoming original bytes changed.");const originalAuthor=(await packageRead(changed.file)).workspace;need(C.equal(result.workspace.editions.slice(0,originalAuthor.editions.length),originalAuthor.editions),"An earlier author edition changed.");
  await saveWorking(author,finalFile);await author.setViewportSize({width:390,height:844});const mobile=attemptFile("Mobile_Prime_Return_Applied.png");await author.screenshot({path:mobile,fullPage:true});await author.setViewportSize({width:1440,height:1000});return{file:finalFile,artifacts:[finalFile,mobile].map(identity)};
 });
 if(R.history((await working(author)).workspace).decisions.length!==1)await importOriginal(author,accepted.file);
 const delivered=await stage("06-full-editable-application-and-independent-reopen",async()=>{
  await tab(author,"history");const app=await download(author,"download-application",output("delivery/HCPS_Complete_Prime_Reviewed_Response_Desk.html"));routes.set("/recipient.html",{file:app,type:"text/html"});
  const recipient=await open("recipient",origin+"/recipient.html"),w=(await working(recipient)).workspace,local=await recipient.evaluate(()=>HCPSDesk.current().id),originalW=(await packageRead(accepted.file)).workspace;
  need(C.equal(w.draft,originalW.draft)&&C.equal(w.editions,originalW.editions)&&C.equal(w.returnReview,originalW.returnReview),"The actual delivered application did not receive complete original review history.");
  for(const [key,value] of Object.entries(originalW.objects))need(C.equal(w.objects[key],value),"An original document changed in the delivered application.");
  await tab(recipient,"prime-review");await recipient.reload();await ready(recipient);need(await recipient.evaluate(()=>HCPSDesk.current().id)===local,"Delivered application reload duplicated the retained copy.");await tab(recipient,"prime-review");const shot=attemptFile("Delivered_Complete_Review_History.png");await recipient.screenshot({path:shot,fullPage:true});await recipient.setViewportSize({width:390,height:844});const mobile=attemptFile("Delivered_Mobile_Review.png");await recipient.screenshot({path:mobile,fullPage:true});
  const file=await saveWorking(recipient,output("recipient/Complete_Received_Prime_Review.json"));await C.validate((await packageRead(file)).workspace);return{application:app,file,artifacts:[app,file,shot,mobile].map(identity)};
 });
 await close();need(!errors.length,"The actual browser reported errors: "+errors.join("\n"));
 const result={format:"commons.hcps.complete-prime-review-receiving.v1",status:"complete",operationId:input.operationId,workspaceId:input.workspaceId,source:built,stages:["01-complete-actual-playback-baseline","02-actual-issued-edition","03-colleague-complete-return-and-unfinished-draft","04-independent-author-edition","05-full-browser-choice-reopening-and-apply","06-full-editable-application-and-independent-reopen"],delivery:delivered};json(path.join(ROOT,"COMPLETE.json"),result);event("COMPLETE",result);
})().catch(async e=>{event("FAILED",{message:e.message,stack:e.stack});try{await close();}catch(x){event("FAILED_DRAIN",{message:x.message});}process.exitCode=1;});
