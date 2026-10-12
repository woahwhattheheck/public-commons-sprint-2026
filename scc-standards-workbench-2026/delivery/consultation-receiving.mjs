import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {spawn,execFileSync} from "node:child_process";
import {createHash,randomUUID} from "node:crypto";
import assert from "node:assert/strict";

const flag=process.argv.indexOf("--config");
if(flag<0||!process.argv[flag+1])throw Error("Use --config ABSOLUTE_JSON_CONFIGURATION");
const config=JSON.parse(fs.readFileSync(process.argv[flag+1],"utf8"));
for(const key of ["source","workspace","output","python","playwright","chromium"]){
 if(typeof config[key]!=="string"||!path.isAbsolute(config[key]))throw Error("Configuration requires absolute "+key);
}
const port=config.port||18976,base="http://127.0.0.1:"+port;
fs.mkdirSync(config.output,{recursive:true});fs.mkdirSync(config.workspace,{recursive:true});
const progressFile=path.join(config.output,"progress.json");
const progress=fs.existsSync(progressFile)?JSON.parse(fs.readFileSync(progressFile,"utf8")):{schema:"scc-consultation-journey/v1",steps:{},started_at:new Date().toISOString()};
const save=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+".next";fs.writeFileSync(tmp,JSON.stringify(value,null,2)+"\n");fs.renameSync(tmp,file);};
const hash=raw=>createHash("sha256").update(raw).digest("hex");
const sourceManifest=()=>{
 const rows=[];
 const visit=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){if(["__pycache__","build","dist"].includes(e.name)||e.name.endsWith(".egg-info"))continue;const p=path.join(dir,e.name);if(e.isDirectory())visit(p);else if(e.isFile()){const raw=fs.readFileSync(p);rows.push({path:path.relative(config.source,p).split(path.sep).join("/"),bytes:raw.length,sha256:hash(raw)});}}};
 visit(config.source);return rows;
};
const initialSource=sourceManifest(),sourceIdentity=hash(JSON.stringify(initialSource));
if(progress.source_identity&&progress.source_identity!==sourceIdentity){
 if(config.continuation_from_source_identity!==progress.source_identity||typeof config.source_change_note!=="string"||!config.source_change_note.trim())throw Error("The retained review journey's source changed. Set the exact continuation_from_source_identity and a source_change_note to continue its existing case after the completed prior invocation.");
 (progress.source_revisions??=[]).push({previous_identity:progress.source_identity,current_identity:sourceIdentity,recorded_at:new Date().toISOString(),note:config.source_change_note});
}
progress.source_identity=sourceIdentity;progress.source_files=initialSource;save(progressFile,progress);
const stage=async(name,action)=>{if(progress.steps[name])return progress.steps[name].value;progress.active=name;save(progressFile,progress);const value=await action();progress.steps[name]={completed_at:new Date().toISOString(),value:value??null};save(progressFile,progress);process.stdout.write(JSON.stringify({stage:name,complete:true})+"\n");return value;};
let server=null,browser=null,operator=null,reviewer=null,projectId=null;
const pageErrors=[],serverLog=fs.openSync(path.join(config.output,"server.log"),"a");
async function api(route,options={}){
 const r=await fetch(base+route,{...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});
 if(!r.ok){const body=await r.text();const e=Error("HTTP "+r.status+" "+route+": "+body);e.status=r.status;throw e;}
 return r.headers.get("content-type")?.includes("application/json")?r.json():Buffer.from(await r.arrayBuffer());
}
async function start(workspace){
 server=spawn(config.python,["-B",path.join(config.source,"server.py"),"--workspace",workspace,"--port",String(port)],{stdio:["ignore",serverLog,serverLog],env:{...process.env,PYTHONDONTWRITEBYTECODE:"1"}});
 for(let i=0;i<100;i++){try{await api("/api/status");return;}catch{}if(server.exitCode!==null)throw Error("Application exited before serving.");await new Promise(r=>setTimeout(r,100));}
 throw Error("Application did not start.");
}
async function stop(){
 if(!server)return;const child=server;server=null;
 if(child.exitCode===null){child.kill("SIGINT");await Promise.race([new Promise(r=>child.once("exit",r)),new Promise(r=>setTimeout(r,5000))]);if(child.exitCode===null){child.kill("SIGTERM");await new Promise(r=>child.once("exit",r));}}
}
const project=()=>api("/api/projects/"+projectId);
async function mutate(operation,payload,requestId){
 const p=await project();return api("/api/projects/"+projectId+"/operations",{method:"POST",body:JSON.stringify({operation,payload,expected_revision:p.revision,request_id:requestId||randomUUID(),actor:"Authored consultation demonstration"})});
}
async function record(collection,id){return api("/api/projects/"+projectId+"/records/"+collection+"/"+encodeURIComponent(id));}
async function selectProject(){
 await operator.goto(base);await operator.locator("#project-picker").selectOption(projectId);
 await operator.locator('[data-section="consultation"]').click();
 await operator.getByRole("heading",{name:"Consultation receiving",exact:true}).waitFor();
}
async function showResponse(id){
 await selectProject();await operator.locator('[data-review="tab"][data-tab="responses"]').click();
 await operator.locator('[data-review="response"][data-id="'+id+'"]').click();
 await operator.locator("#review-response-detail .review-comment-list button").first().waitFor();
}
async function selectComment(commentId){await operator.locator('[data-review="comment"][data-id="'+commentId+'"]').click();}
async function receive(file,packetId,note=""){
 await selectProject();await operator.locator('[data-review="receive"][data-id="'+packetId+'"]').click();
 const d=operator.locator("#consultation-dialog");
 await d.locator('[name="return_file"]').setInputFiles(file);await d.locator("#review-preview").click();
 await d.locator("#review-preview-result .review-hash").waitFor();
 const predecessor=d.locator('[name="supersedes"]');
 if(await predecessor.isVisible())await predecessor.check();
 await d.locator('[name="receipt_note"]').fill(note);
 await d.locator("#review-submit").click();await d.waitFor({state:"hidden"});
 const p=await project(),sha=hash(fs.readFileSync(file));
 const row=p.review.responses.find(r=>r.source_sha256===sha);
 if(row)return row.id;
 const detail=await api("/api/projects/"+projectId+"/review/preview",{method:"POST",body:JSON.stringify({packet_id:packetId,filename:path.basename(file),content_base64:fs.readFileSync(file).toString("base64")})});
 assert.ok(detail.duplicate_of);return detail.duplicate_of;
}
async function disposition(responseId,commentId,choice,rationale,editionId,visibility="recipient_only",amendmentId=""){
 await showResponse(responseId);await selectComment(commentId);
 await operator.locator('[data-review="resolve"][data-id="'+commentId+'"]').click();
 const d=operator.locator("#consultation-dialog");
 await d.locator('[name="disposition"]').selectOption(choice);await d.locator('[name="rationale"]').fill(rationale);
 if(editionId){await d.locator('[name="resolution_edition_id"]').selectOption(editionId);await d.locator("#review-resolution-text h3").first().waitFor();}
 if(amendmentId)await d.locator('[name="amendment_id"][value="'+amendmentId+'"]').check();
 await d.locator('[name="response_visibility"]').selectOption(visibility);
 if(visibility==="public")await d.locator('[name="publication_basis"]').fill("Explicit selection of this authored demonstration comment for the public product example.");
 await d.locator("#review-submit").click();await d.waitFor({state:"hidden"});
}
async function download(page,button,file){const event=page.waitForEvent("download");await button.click();const transfer=await event;await transfer.saveAs(file);assert.ok(fs.statSync(file).size);return file;}
function unzip(file,destination){
 fs.mkdirSync(destination,{recursive:true});
 execFileSync(config.python,["-B","-c","from pathlib import Path\nimport zipfile,sys\nroot=Path(sys.argv[2])\nwith zipfile.ZipFile(sys.argv[1]) as z:\n for item in z.infolist():\n  p=Path(item.filename)\n  if p.is_absolute() or '..' in p.parts:raise ValueError('Unsafe archive member')\n  if not item.is_dir():\n   target=root/p;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(z.read(item))\n",file,destination]);
}
async function exportedResponse(file){
 await download(reviewer,reviewer.locator("#export-response"),file);return JSON.parse(fs.readFileSync(file,"utf8"));
}
const savedResponse=name=>path.join(config.output,name);
try{
 await start(config.workspace);
 const playwright=await import(pathToFileURL(config.playwright).href);
 browser=await playwright.chromium.launch({headless:true,executablePath:config.chromium,args:["--no-sandbox","--disable-dev-shm-usage"]});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 context.on("page",page=>{page.on("pageerror",e=>pageErrors.push(String(e)));page.on("dialog",dialog=>dialog.accept());});
 operator=await context.newPage();operator.setDefaultTimeout(25000);
 projectId=await stage("prepare_review_example",async()=>{
  await operator.goto(base);await operator.locator("#more-menu").click();await operator.locator('[data-action="review-demo"]').click();
  await operator.getByRole("heading",{name:"Consultation receiving",exact:true}).waitFor();
  const id=await operator.locator("#project-picker").inputValue();assert.equal(id,"scc-municipal-review-example-v1");
  return id;
 });
 const editionId="review-example-edition-v1";
 const packetId=await stage("operator_freeze_and_pending_save_recovery",async()=>{
  const replayFile=savedResponse("packet-replay.json");
  if(fs.existsSync(replayFile)){
   const kept=JSON.parse(fs.readFileSync(replayFile,"utf8"));
   const value=await api("/api/projects/"+projectId+"/operations",{method:"POST",body:JSON.stringify(kept.request)});
   assert.equal(value.packet_id,kept.result.packet_id);assert.equal(value.replayed,true);return value.packet_id;
  }
  const before=(await project()).review.packets.length;
  const requests=[];let intercepted=null;
  const routeURL=base+"/api/projects/"+projectId+"/operations";
  await operator.route(routeURL,async route=>{
   const request=route.request().postDataJSON();
   if(request.operation!=="review.packet"){await route.continue();return;}
   requests.push(request);
   if(intercepted===null){
    const response=await route.fetch();assert.equal(response.status(),200);
    intercepted={request,result:await response.json()};
    save(replayFile,intercepted);
    await route.fulfill({status:502,contentType:"application/json",body:JSON.stringify({error:"Authored proxy interruption after the committed save response."})});
   }else await route.continue();
  });
  await selectProject();await operator.locator('[data-review="packet"]').click();
  const dialog=operator.locator("#consultation-dialog");
  await dialog.locator('[name="consultation_id"]').selectOption("review-example-consultation-v1");
  await dialog.locator('[name="title"]').fill("Bilingual reviewer packet — source-date demonstration");
  await dialog.locator('[name="instructions_en"]').fill("Review the original public cases and paired clauses. Mark this practice response as authored.");
  await dialog.locator('[name="instructions_fr"]').fill("Examiner les cas publics originaux et les clauses bilingues. Indiquer qu'il s'agit d'une réponse d'exercice.");
  await dialog.locator('[name="reply_route_en"]').fill("Export the JSON and retain it in this local workbench's Consultation receiving view.");
  await dialog.locator('[name="reply_route_fr"]').fill("Exporter le JSON et le conserver dans Consultation receiving de cet outil local.");
  await dialog.locator("#review-submit").click();
  await dialog.locator("#review-retry").waitFor({state:"visible"});
  const replay=operator.waitForResponse(r=>r.url()===routeURL&&r.status()===200);
  await dialog.locator("#review-retry").click();assert.equal((await(await replay).json()).replayed,true);
  await dialog.waitFor({state:"hidden"});await operator.unroute(routeURL);
  assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);
  assert.equal((await project()).review.packets.length,before+1);
  return intercepted.result.packet_id;
 });
 const packet=await record("review_packets",packetId),clauses=packet.snapshot.edition.snapshot.clauses,first=clauses[0],second=clauses[1];
 const proposedEn=first.body_en+"\n\nThe handover shall retain the Census reference date separately from the municipal change effective date.";
 const proposedFr=first.body_fr+"\n\nLe dossier de transfert doit conserver la date de référence du recensement séparément de la date d'entrée en vigueur du changement municipal.";
 const recipient=path.join(config.output,"recipient"),packetZip=savedResponse("Bilingual_Reviewer_Example.zip");
 await stage("download_frozen_packet",async()=>{
  await selectProject();await download(operator,operator.locator('a[href*="audience=consultation"][href*="'+packetId+'"]'),packetZip);
  unzip(packetZip,recipient);
  const original=JSON.parse(fs.readFileSync(path.join(recipient,"packet.json"),"utf8"));
  assert.equal(original.packet_sha256,packet.packet_sha256);assert.equal(original.packet.source_edition_sha256,packet.source_edition_sha256);
  assert.equal(original.packet.edition.snapshot.cases.length,8);return{packet_id:packetId,sha256:hash(fs.readFileSync(packetZip))};
 });
 reviewer=await context.newPage();reviewer.setDefaultTimeout(25000);await reviewer.goto(pathToFileURL(path.join(recipient,"reviewer.html")).href);
 const firstFile=savedResponse("Authored_Review_Response_v1.json");
 await stage("offline_authored_response",async()=>{
  if(fs.existsSync(firstFile))return{file:firstFile,sha256:hash(fs.readFileSync(firstFile))};
  await reviewer.locator('#reviewer-fields [name="name"]').fill("Authored reviewer");
  await reviewer.locator('#reviewer-fields [name="organization"]').fill("Product demonstration");
  await reviewer.locator('[name="authored_example"]').check();
  await reviewer.locator("#language").selectOption("bilingual");
  await reviewer.locator('[name="reviewer_language"]').selectOption("bilingual");
  await reviewer.locator('[data-view="cases"]').click();
  assert.ok((await reviewer.locator("#main").innerText()).includes("Amos"));
  for(const [clause,body,en,fr] of [
   [first,"Authored observation: retain the Census reference date separately from the municipal change date.",proposedEn,proposedFr],
   [second,"Authored observation: confirm that a missing value remains distinct from a recorded zero.","",""]
  ]){
   await reviewer.locator('[data-clause="'+clause.id+'"]').click();
   await reviewer.locator('[data-add-comment="'+clause.id+'"]').click();
   const d=reviewer.locator("#comment-dialog");
   await d.locator('[name="body"]').fill(body);await d.locator('[name="proposed_text_en"]').fill(en);await d.locator('[name="proposed_text_fr"]').fill(fr);
   await d.locator("#save-comment").click();await d.waitFor({state:"hidden"});
  }
  await download(reviewer,reviewer.locator("#save-draft"),savedResponse("Authored_Review_Draft.json"));
  const response=await exportedResponse(firstFile);assert.equal(response.comments.length,2);assert.equal(response.authored_example,true);
  await reviewer.screenshot({path:savedResponse("reviewer-bilingual.png"),fullPage:true});
  return{file:firstFile,response_id:response.response_id,entry_ids:response.comments.map(r=>r.id),sha256:hash(fs.readFileSync(firstFile))};
 });
 const firstResponse=await stage("retain_first_original",async()=>{
  const sha=hash(fs.readFileSync(firstFile)),found=(await project()).review.responses.find(r=>r.source_sha256===sha);
  return found?.id||await receive(firstFile,packetId);
 });
 const firstDetail=await api("/api/projects/"+projectId+"/review/responses/"+firstResponse);
 const firstComment=firstDetail.comments.find(r=>r.entry.clause_id===first.id).comment.id;
 const secondComment=firstDetail.comments.find(r=>r.entry.clause_id===second.id).comment.id;
 await stage("predecessor_decision",async()=>{
  const c=await record("comments",secondComment);
  if(c.disposition!=="rejected")await disposition(firstResponse,secondComment,"rejected","The paired source clause already distinguishes missing values and recorded zeros.",editionId);
  return{comment_id:secondComment,disposition:"rejected"};
 });
 const amendment=await stage("clause_conflict_and_amendment",async()=>{
  const current=await project();const existing=current.review_amendments.find(r=>r.comment_id===firstComment);
  if(existing)return existing.id;
  await showResponse(firstResponse);await selectComment(firstComment);await operator.locator('[data-review="amend"][data-id="'+firstComment+'"]').click();
  const d=operator.locator("#consultation-dialog");await d.locator("#review-current-clause .review-hash").waitFor();
  await d.locator('[name="use_en"]').check();await d.locator('[name="use_fr"]').check();
  await d.locator('[name="rationale"]').fill("Adopt the source-date distinction while preserving the current clause and its source notes.");
  const prior=await record("clauses",first.id);prior.notes+=(prior.notes?"\n":"")+"Authored concurrent source-note update.";
  await mutate("record.save",{collection:"clauses",record:prior},"review-demo-concurrent-source-note");
  const rejection=operator.waitForResponse(r=>r.url().endsWith("/operations")&&r.status()===409);
  await d.locator("#review-submit").click();await rejection;
  assert.equal(await d.locator('[name="body_en"]').inputValue(),proposedEn);
  await d.locator("[data-rebase]").click();await d.locator("#review-form-revision").filter({hasText:"current saved context reviewed"}).waitFor();
  await d.locator("#review-submit").click();await d.waitFor({state:"hidden"});
  const after=await record("clauses",first.id);assert.equal(after.body_en,proposedEn);assert.equal(after.body_fr,proposedFr);assert.ok(after.notes.includes("Authored concurrent source-note update."));
  return(await project()).review_amendments.find(r=>r.comment_id===firstComment).id;
 });
 const successor=await stage("freeze_successor_and_resolve",async()=>{
  const id="review-example-successor-v1";
  if(!(await project()).editions.some(r=>r.id===id))await mutate("edition.freeze",{id,label:"Municipal reconciliation — source-date clarification",contributor_ids:[],notes:"Authored product demonstration successor."},"review-demo-successor-freeze");
  if((await record("comments",firstComment)).disposition!=="accepted")await disposition(firstResponse,firstComment,"accepted","The exact paired date clarification appears in the selected successor clause.",id,"recipient_only",amendment);
  return id;
 });
 const correctedFile=savedResponse("Authored_Review_Response_v2.json");
 await stage("offline_corrected_return",async()=>{
  if(fs.existsSync(correctedFile))return{file:correctedFile,sha256:hash(fs.readFileSync(correctedFile))};
  await reviewer.locator("#open-file").setInputFiles(firstFile);
  await reviewer.locator('[data-view="comments"]').click();
  const original=JSON.parse(fs.readFileSync(firstFile,"utf8"));
  await reviewer.locator('[data-edit-comment="'+original.comments[0].id+'"]').click();
  await reviewer.locator('#comment-dialog [name="body"]').fill(original.comments[0].body+" Additional explanation: affected Census population is not a new annual population estimate.");
  await reviewer.locator("#save-comment").click();
  const response=await exportedResponse(correctedFile);
  assert.equal(response.response_id,original.response_id);assert.deepEqual(response.comments[1],original.comments[1]);assert.notEqual(response.comments[0].body,original.comments[0].body);
  return{file:correctedFile,sha256:hash(fs.readFileSync(correctedFile))};
 });
 const correctedResponse=await stage("retain_correction",async()=>{
  const sha=hash(fs.readFileSync(correctedFile)),found=(await project()).review.responses.find(r=>r.source_sha256===sha);
  return found?.id||await receive(correctedFile,packetId,"Authored corrected return: one explanation changed; retain the exact predecessor and its decisions.");
 });
 await stage("adopt_unchanged_predecessor_decision",async()=>{
  const detail=await api("/api/projects/"+projectId+"/review/responses/"+correctedResponse);
  const unchanged=detail.comments.find(r=>r.entry.clause_id===second.id);
  if(unchanged.comment.disposition==="rejected")return{comment_id:unchanged.comment.id,already_recorded:true};
  assert.equal(detail.decision_carry.eligible_count,1);
  await showResponse(correctedResponse);await operator.locator('[data-review="carry"][data-id="'+correctedResponse+'"]').click();
  const d=operator.locator("#consultation-dialog");assert.equal(await d.locator('[name="entry_id"]:checked').count(),1);
  await d.locator('[name="rationale"]').fill("Adopt the prior decision for the unchanged missing-versus-zero entry; review the changed date explanation separately.");
  await d.locator("#review-submit").click();await d.waitFor({state:"hidden"});
  const fresh=await api("/api/projects/"+projectId+"/review/responses/"+correctedResponse);
  assert.equal(fresh.comments.find(r=>r.entry.clause_id===second.id).comment.disposition,"rejected");
  assert.equal(fresh.comments.find(r=>r.entry.clause_id===first.id).comment.disposition,"open");
  assert.equal((await record("comments",secondComment)).disposition,"rejected");
  return{comment_id:unchanged.comment.id};
 });
 await stage("resolve_changed_entry",async()=>{
  const detail=await api("/api/projects/"+projectId+"/review/responses/"+correctedResponse),comment=detail.comments.find(r=>r.entry.clause_id===first.id).comment;
  if(comment.disposition!=="accepted")await disposition(correctedResponse,comment.id,"accepted","The additional explanation was reviewed. The selected source-date wording and original source vintages address the point.",successor,"public");
  return{comment_id:comment.id};
 });
 await stage("duplicate_original_and_selected_handover",async()=>{
  const before=await project();const file=savedResponse("Authored_Review_Response_v2_duplicate.json");
  const duplicate=JSON.parse(fs.readFileSync(correctedFile,"utf8"));duplicate.exported_at=new Date().toISOString();save(file,duplicate);
  const id=await receive(file,packetId);assert.equal(id,correctedResponse);
  const after=await project();assert.equal(after.collection_counts.comments,before.collection_counts.comments);assert.equal(after.review.responses.length,2);
  const reply=await api("/api/projects/"+projectId+"/export?audience=review_response&response_id="+correctedResponse);
  fs.writeFileSync(savedResponse("Authored_Respondent_Reply.zip"),reply);unzip(savedResponse("Authored_Respondent_Reply.zip"),path.join(config.output,"reply"));
  const response=JSON.parse(fs.readFileSync(path.join(config.output,"reply","response.json"),"utf8"));assert.equal(response.comments.length,2);assert.equal(response.comments.some(r=>"reviewer" in r||"email" in r),false);
  const published=await api("/api/projects/"+projectId+"/export?audience=edition&edition_id="+successor);
  fs.writeFileSync(savedResponse("Authored_Successor_Edition.zip"),published);unzip(savedResponse("Authored_Successor_Edition.zip"),path.join(config.output,"successor"));
  const appendix=JSON.parse(fs.readFileSync(path.join(config.output,"successor","publication","consultation.json"),"utf8"));assert.equal(appendix.comments.length,1);assert.equal(appendix.comments[0].authored_example,true);
  await showResponse(correctedResponse);await operator.screenshot({path:savedResponse("operator-decisions.png"),fullPage:true});
  await operator.setViewportSize({width:390,height:844});await operator.screenshot({path:savedResponse("operator-mobile.png"),fullPage:true});await operator.setViewportSize({width:1440,height:1000});
  return{comments:after.collection_counts.comments,returns:after.review.responses.length,public_entries:appendix.comments.length,reply_sha256:hash(reply),successor_sha256:hash(published)};
 });
 await stage("same_project_export_restore_reopen",async()=>{
  const before=await project(),raw=await api("/api/projects/"+projectId+"/export?audience=private_restore");
  const archive=savedResponse("consultation-original-project.private.zip");fs.writeFileSync(archive,raw);
  await stop();const reopened=path.join(config.output,"reopened-workspace");
  const out=execFileSync(config.python,["-B",path.join(config.source,"server.py"),"--workspace",reopened,"--restore",archive,"--no-serve"],{encoding:"utf8"});
  fs.writeFileSync(savedResponse("restore-result.json"),out);
  await start(reopened);const after=await project();assert.deepEqual(after,before);
  await showResponse(correctedResponse);assert.ok((await operator.locator("#review-response-detail").innerText()).includes("Additional explanation"));
  return{project_id:projectId,revision:after.revision,archive_sha256:hash(raw),reopened_workspace:reopened,counts:after.collection_counts};
 });
 assert.deepEqual(sourceManifest(),initialSource,"The producer source changed during the native review journey.");
 assert.deepEqual(pageErrors,[]);
 const outputs=fs.readdirSync(config.output).filter(n=>/\.(zip|json|png)$/.test(n)&&!["progress.json","result.json","failure.json"].includes(n)).map(name=>{const raw=fs.readFileSync(savedResponse(name));return{name,bytes:raw.length,sha256:hash(raw),private:name.endsWith(".private.zip")};});
 save(savedResponse("result.json"),{schema:"scc-consultation-journey-result/v1",completed_at:new Date().toISOString(),project_id:projectId,source_identity:sourceIdentity,source_files:initialSource,steps:Object.keys(progress.steps),page_errors:pageErrors,outputs});
 process.stdout.write(JSON.stringify({completed:true,project_id:projectId,output:config.output,page_errors:pageErrors.length})+"\n");
}catch(error){save(savedResponse("failure.json"),{at:new Date().toISOString(),stage:progress.active,project_id:projectId,message:String(error),stack:error.stack,page_errors:pageErrors});throw error;}
finally{if(browser)await browser.close();await stop();fs.closeSync(serverLog);}
