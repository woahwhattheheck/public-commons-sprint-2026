/** Join the original issuer/customer review to the existing spatial receiving. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {pathToFileURL,fileURLToPath} from "node:url";

const execute=promisify(execFile);
const NAME="C79F internal engineering review",ROLE="Internal engineering",ORGANIZATION="TJLabs";
const SUMMARY="Internal engineering review of the retained 217-feature upstream MODEL_DOMAIN and the full 33-requirement issuer profile. Source files were verified in this portable packet. Reporting-basin scope and the issuer review process are recorded as questions; the other requirements retain their unreviewed status.";
const QUESTION={
  "scope.basin":"The retained source collection contains the 217 original upstream catchments under the MODEL_DOMAIN role. Please confirm the reporting-basin boundary required for this Upper Savannah review, or supply the authoritative boundary and its relationship to these retained catchments.",
  "work.review":"Please confirm the review cadence, designated reviewer and acceptance authority for the full 33-requirement issuer review. This internal review preserves the original source files, geographic selection and review history for that handover."
};
const assert=(value,message)=>{if(!value)throw Error(message);};
function sha(value){return crypto.createHash("sha256").update(value).digest("hex");}
function syncDirectory(directory){const fd=fs.openSync(directory,"r");try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function keepJSON(file,value){
  const bytes=Buffer.from(JSON.stringify(value,null,2)+"\n");
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  if(fs.existsSync(file)){assert(fs.readFileSync(file).equals(bytes),"Retain the original customer context");syncDirectory(path.dirname(file));return;}
  const temporary=file+".tmp-"+crypto.randomUUID(),fd=fs.openSync(temporary,"wx",0o600);
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  try{fs.linkSync(temporary,file);syncDirectory(path.dirname(file));}finally{fs.unlinkSync(temporary);}
}
function fileRecord(file,durable=false){
  const fd=fs.openSync(file,"r"),digest=crypto.createHash("sha256"),buffer=Buffer.alloc(1024*1024);let bytes=0;
  try{for(;;){const count=fs.readSync(fd,buffer,0,buffer.length,null);if(!count)break;bytes+=count;digest.update(buffer.subarray(0,count));}if(durable)fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  if(durable)syncDirectory(path.dirname(file));
  return {path:path.resolve(file),bytes,sha256:digest.digest("hex")};
}
function sameFile(file,pin){const actual=fileRecord(file);assert(actual.bytes===pin.bytes&&actual.sha256===pin.sha256,"Retained customer file differs: "+path.basename(file));return actual;}
function inside(directory,file){
  const relative=path.relative(directory,file);
  return relative!==""&&!path.isAbsolute(relative)&&relative!==".."&&!relative.startsWith(".."+path.sep);
}
function selectedMapIds(control){
  const ids=control.spatial_export_ids??[];
  assert(Array.isArray(ids)&&ids.every(id=>typeof id==="string"&&id.trim())&&new Set(ids).size===ids.length,
    "Select each original completed map export once");
  return ids;
}
function contextFor(control,report,persist){
  assert(control.features===217&&control.source_collection_id&&report.review_id,"Retain the selected original 217-feature geographic review");
  const value={schema:"upstate.customer-spatial-receiving-context/v1",operation_id:control.operation,
    application:path.resolve(control.original_application),workspace_root:path.resolve(control.original_workspace),
    output:path.join(path.resolve(control.output),"customer-review"),spatial_review_id:report.review_id,
    source_collection_id:control.source_collection_id};
  const maps=selectedMapIds(control);
  if(maps.length)value.spatial_export_ids=[...maps];
  const file=path.join(path.resolve(control.output),"customer-context.json");
  keepJSON(file,value);
  const pin=fileRecord(file);
  report.customer??={};
  if(report.customer.context)assert(report.customer.context.path===pin.path&&report.customer.context.sha256===pin.sha256,"Original customer review context changed");
  else{report.customer.context=pin;persist();}
  return {file,value};
}
async function invoke(phase,args,{control,report,persist,application}){
  const script=path.join(application||control.original_application,"operator/customer_spatial_receiving.py");
  assert(fs.statSync(script).isFile(),"The joined original customer adapter is absent");
  try{
    const returned=await execute(control.python,["-B",script,"--context",report.customer.context.path,...args,phase],
      {cwd:application||control.original_application,env:process.env,timeout:240000,maxBuffer:4*1024*1024});
    const value=JSON.parse(returned.stdout.trim());
    assert(value&&typeof value==="object"&&!Array.isArray(value),"The original customer phase returned no object");
    assert(value.review_id&&value.project_id===control.project_id&&value.source_collection_id===control.source_collection_id&&value.requirements===33,
      "The customer phase changed the original project, source collection or 33 requirements");
    assert(JSON.stringify(value.spatial_export_ids??[])===JSON.stringify(selectedMapIds(control)),
      "The customer phase changed its original completed map selection");
    assert(value.expected_reviewer?.name===NAME&&value.expected_reviewer?.role===ROLE&&value.expected_reviewer?.organization===ORGANIZATION,
      "The native customer phase changed its internal reviewer binding");
    delete report.customer.error;persist();return value;
  }catch(error){
    report.customer.error={phase,message:String(error),stderr:String(error.stderr||""),at:new Date().toISOString()};persist();throw error;
  }
}
function readPacket(result,control){
  const folder=fs.realpathSync(result.packet_directory),entry=path.resolve(result.entry);
  assert(inside(folder,entry)&&fs.realpathSync(entry)===entry,"Original customer entry is outside its packet");
  const packet=JSON.parse(fs.readFileSync(path.join(folder,"review.json"),"utf8")),review=packet.review;
  assert(packet.schema==="upstate.customer-review-packet/v1"&&review?.id===result.review_id&&review.project?.id===control.project_id,
    "Original exported customer review identity differs");
  assert(Array.isArray(review.requirements)&&review.requirements.length===33&&new Set(review.requirements.map(x=>x.id)).size===33,
    "The complete issuer profile requires 33 distinct requirements");
  assert(Object.keys(QUESTION).every(id=>review.requirements.some(x=>x.id===id)),"The original basin/review requirements are absent");
  assert(Array.isArray(review.artifacts)&&review.artifacts.length>0&&Array.isArray(packet.files),"Original source artifacts are absent");
  const maps=review.selections.filter(item=>item.kind==="spatial-exports");
  assert(JSON.stringify(maps.map(item=>item.id))===JSON.stringify(selectedMapIds(control)),
    "The complete customer packet changed its original map exports");
  for(const item of maps){
    const original=item.source;
    const retained=result.spatial_exports.find(map=>map.id===item.id);
    assert(original?.id===item.id&&original.state==="complete"&&original.project_id===control.project_id&&
      retained?.review_id===original.review_id,"The map belongs to another original project or saved view");
    const artifacts=review.artifacts.filter(artifact=>artifact.selection_kind==="spatial-exports"&&artifact.selection_id===item.id);
    const expected=["export.json",...Object.values(original.files).map(member=>member.path)].sort();
    assert(JSON.stringify(artifacts.map(artifact=>artifact.original_path).sort())===JSON.stringify(expected),
      "The customer packet lacks an original completed map member");
    for(const member of Object.values(original.files)){
      const artifact=artifacts.find(item=>item.original_path===member.path);
      assert(artifact.bytes===member.bytes&&artifact.sha256===member.sha256,
        "A customer map file differs from its original completed export");
    }
  }
  const files=[];
  for(const file of packet.files){
    const target=path.resolve(folder,file.path);
    assert(inside(folder,target)&&fs.realpathSync(target)===target,"Original artifact escapes its packet: "+file.path);
    const identity=fileRecord(target);
    assert(identity.bytes===file.bytes&&identity.sha256===file.sha256,"Original artifact bytes differ: "+file.path);
    files.push({artifact_id:file.artifact_id,path:file.path,bytes:identity.bytes,sha256:identity.sha256});
  }
  for(const artifact of review.artifacts)assert(files.some(x=>x.artifact_id===artifact.id&&x.path===artifact.path),"Original artifact has no complete retained file: "+artifact.id);
  return {folder,entry,packet,review,files,maps,expected_reviewer:result.expected_reviewer};
}
async function openPacket(context,selected){
  const page=await context.newPage(),errors=[],outside=[];
  page.setDefaultTimeout(30000);
  page.on("pageerror",error=>errors.push(String(error)));
  await page.route("**/*",async route=>{
    const value=new URL(route.request().url());
    if(["data:","blob:"].includes(value.protocol)){await route.continue();return;}
    if(value.protocol==="file:"){
      try{const target=path.resolve(fileURLToPath(value));if(inside(selected.folder,target)&&fs.realpathSync(target)===target){await route.continue();return;}}catch{}
    }
    outside.push(value.protocol+"//"+value.host+value.pathname);await route.abort();
  });
  await page.goto(pathToFileURL(selected.entry).href,{waitUntil:"domcontentloaded"});
  assert(await page.locator("#review-title").innerText()===selected.review.title,"Customer review title changed");
  assert(await page.locator(".fatal").count()===0,"Original customer application did not initialize");
  return {page,errors,outside};
}
function verifyPage(state){
  assert(state.errors.length===0,"Original customer application error: "+state.errors.join("; "));
  assert(state.outside.length===0,"Original customer packet requested a resource outside its retained directory");
}
async function verifyRequirements(page,review){
  const cards=page.locator("#requirements-list > section.panel");
  assert(await cards.count()===33,"The browser did not expose all 33 issuer requirements");
  for(let index=0;index<review.requirements.length;index++){
    const expected=review.requirements[index],card=cards.nth(index);
    assert(await card.locator(".item-head .item-title h3").textContent()===expected.title,
      "The original requirement title changed: "+expected.id);
    assert(await card.locator("span.mono.muted").first().textContent()===expected.id,
      "The original requirement identity changed");
    assert(await card.locator("p.requirement-detail").textContent()===(expected.detail||""),
      "The original requirement detail changed: "+expected.id);
  }
}
function verifyResponse(body,selected,parent){
  const review=selected.review;
  assert(body.schema==="upstate.customer-review-response/v1"&&body.review_id===review.id&&body.project_id===review.project.id,
    "Downloaded customer response changed its original review identity");
  assert(body.previous_response_id===parent,"Downloaded response changed its original parent");
  assert(body.disposition==="in-review","Keep the original internal engineering disposition");
  const reviewer=selected.expected_reviewer;
  assert(body.reviewer?.name===reviewer.name&&body.reviewer?.role===reviewer.role&&body.reviewer?.organization===reviewer.organization,
    "Downloaded response changed the native internal reviewer identity");
  assert(body.summary===SUMMARY,"Downloaded response changed its internal source-review summary");
  assert(Array.isArray(body.artifact_decisions)&&body.artifact_decisions.length===review.artifacts.length&&
    new Set(body.artifact_decisions.map(x=>x.artifact_id)).size===review.artifacts.length&&
    body.artifact_decisions.every(x=>review.artifacts.some(a=>a.id===x.artifact_id)&&x.decision==="unreviewed"),
    "Downloaded response changed its original artifact selection");
  assert(Array.isArray(body.requirement_decisions)&&body.requirement_decisions.length===33&&
    new Set(body.requirement_decisions.map(x=>x.requirement_id)).size===33,"Downloaded requirement selection is incomplete");
  for(const row of body.requirement_decisions){
    assert(review.requirements.some(x=>x.id===row.requirement_id),"Downloaded response added another requirement");
    const question=QUESTION[row.requirement_id];
    assert(row.decision===(question?"question":"unreviewed"),"Downloaded requirement disposition differs: "+row.requirement_id);
    assert((row.comment||"")===(question||""),"Downloaded requirement comment differs: "+row.requirement_id);
  }
  assert(Array.isArray(body.corrections)&&body.corrections.length===0,"The original internal review gained an unrelated correction");
}
async function inspectMapPreviews(page,selected){
  const previews=[];
  if(!selected.maps.length)return previews;
  await page.getByRole("tab",{name:/^Files/}).click();
  for(const map of selected.maps){
    const artifact=selected.review.artifacts.find(item=>item.selection_kind==="spatial-exports"&&
      item.selection_id===map.id&&item.role==="map_png");
    assert(artifact?.media_type==="image/png","The completed map's original PNG is absent");
    const row=page.locator('#file-rows tr[data-artifact-id="'+artifact.id+'"]');
    await row.getByRole("button",{name:artifact.label||artifact.original_path||artifact.id,exact:true}).click();
    const preview=page.locator("#file-detail .preview img");
    await preview.scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>{
      const image=document.querySelector("#file-detail .preview img");
      return image?.complete&&image.naturalWidth>0&&image.naturalHeight>0;
    });
    const actual=await preview.evaluate(image=>({
      src:image.getAttribute("src"),width:image.naturalWidth,height:image.naturalHeight}));
    assert(actual.src==="./"+artifact.path.split("/").map(encodeURIComponent).join("/"),
      "The browser preview changed its original map file");
    previews.push({export_id:map.id,artifact_id:artifact.id,bytes:artifact.bytes,sha256:artifact.sha256,
      width:actual.width,height:actual.height});
  }
  return previews;
}
async function createResponse(context,selected,responsePath,parent){
  const state=await openPacket(context,selected),page=state.page,reviewer=selected.expected_reviewer;
  try{
    await page.locator("#reviewer-name").fill(reviewer.name);
    await page.getByLabel("Role",{exact:true}).fill(reviewer.role);
    await page.getByLabel("Organization",{exact:true}).fill(reviewer.organization);
    await page.getByLabel("Response summary",{exact:true}).fill(SUMMARY);
    await page.getByRole("tab",{name:/^Files/}).click();
    const rows=page.locator("#file-rows tr");
    const artifactIds=await rows.evaluateAll(nodes=>nodes.map(node=>node.getAttribute("data-artifact-id")));
    assert(artifactIds.length===selected.review.artifacts.length&&new Set(artifactIds).size===artifactIds.length,
      "Original artifact listing is incomplete or repeats an identity");
    for(const artifact of selected.review.artifacts){
      const index=artifactIds.indexOf(artifact.id);
      assert(index>=0,"The original artifact row is absent: "+artifact.id);
      const row=rows.nth(index);
      assert(await row.getAttribute("data-artifact-id")===artifact.id,"The original artifact row changed");
      await row.getByRole("button",{name:artifact.label||artifact.original_path||artifact.id,exact:true}).click();
      const link=page.locator("#file-detail").getByRole("link",{name:"Open original file",exact:true});
      const expected="./"+artifact.path.split("/").map(encodeURIComponent).join("/");
      assert(await link.getAttribute("href")===expected,"An original artifact link changed");
      await page.locator("#file-detail").getByLabel("Decision",{exact:true}).selectOption("unreviewed");
    }
    await inspectMapPreviews(page,selected);
    await page.getByRole("tab",{name:"Requirements",exact:true}).click();
    await verifyRequirements(page,selected.review);
    const cards=page.locator("#requirements-list > section.panel");
    for(let index=0;index<selected.review.requirements.length;index++){
      const requirement=selected.review.requirements[index],card=cards.nth(index),question=QUESTION[requirement.id];
      await card.getByLabel("Decision",{exact:true}).selectOption(question?"question":"unreviewed");
      await card.getByLabel("Comment",{exact:true}).fill(question||"");
      await card.getByLabel("Assigned to",{exact:true}).fill(question?reviewer.name:"");
    }
    await page.getByRole("tab",{name:"Overview",exact:true}).click();
    await page.getByLabel("Overall response",{exact:true}).selectOption("in-review");
    await page.waitForFunction(()=>document.getElementById("save-status")?.textContent.startsWith("Draft saved on this browser ·"));
    await page.reload({waitUntil:"domcontentloaded"});
    await page.waitForFunction(()=>document.getElementById("save-status")?.textContent.startsWith("Draft restored ·"));
    assert(await page.locator("#reviewer-name").inputValue()===reviewer.name,"The original customer draft did not reopen");
    assert(await page.getByLabel("Overall response",{exact:true}).inputValue()==="in-review","Reopened draft disposition changed");
    await page.getByRole("tab",{name:"Requirements",exact:true}).click();
    await verifyRequirements(page,selected.review);
    for(const [id,question] of Object.entries(QUESTION)){
      const index=selected.review.requirements.findIndex(x=>x.id===id),card=page.locator("#requirements-list > section").nth(index);
      assert(await card.getByLabel("Decision",{exact:true}).inputValue()==="question"&&await card.getByLabel("Comment",{exact:true}).inputValue()===question,
        "The original source-specific question did not reopen: "+id);
    }
    await page.getByRole("tab",{name:"Overview",exact:true}).click();
    assert(!fs.existsSync(responsePath),"Retain the original existing downloaded response");
    const promise=page.waitForEvent("download",{timeout:30000});
    await page.locator("#export-response").click();
    const download=await promise;
    fs.mkdirSync(path.dirname(responsePath),{recursive:true,mode:0o700});
    const temporary=responsePath+".download-"+crypto.randomUUID();
    await download.saveAs(temporary);
    const downloaded=fileRecord(temporary,true),body=JSON.parse(fs.readFileSync(temporary,"utf8"));
    verifyResponse(body,selected,parent);
    try{fs.linkSync(temporary,responsePath);}
    catch(error){if(error.code!=="EEXIST")throw error;sameFile(responsePath,downloaded);}
    syncDirectory(path.dirname(responsePath));
    fs.unlinkSync(temporary);syncDirectory(path.dirname(responsePath));
    const pin=fileRecord(responsePath,true);
    await page.locator("#reviewer-name").fill("Temporary local edit");
    await page.locator("#response-file").setInputFiles(responsePath);
    await page.waitForFunction(name=>document.getElementById("reviewer-name").value===name,reviewer.name);
    verifyPage(state);return pin;
  }finally{await page.close();}
}
async function inspectHistory(context,selected,responseId,{mobile=false}={}){
  assert(selected.packet.latest_response_id===responseId&&selected.packet.responses.some(x=>x.id===responseId),
    "The exported review lost the imported original response");
  const state=await openPacket(context,selected),page=state.page;
  try{
    assert(await page.locator("#reviewer-name").inputValue()==="","The received packet inherited the internal reviewer identity into a new response");
    await page.getByRole("tab",{name:"Responses",exact:true}).click();
    assert(await page.locator("#history-detail").innerText().then(x=>x.includes(responseId)),"The imported response history did not reopen");
    assert(await page.locator("#response-anchor").innerText().then(x=>x.includes(responseId)),"The next response lost its original history anchor");
    await page.getByRole("tab",{name:"Requirements",exact:true}).click();
    await verifyRequirements(page,selected.review);
    const mapPreviews=await inspectMapPreviews(page,selected);
    if(mobile){
      await page.setViewportSize({width:412,height:915});
      assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2)),"Received customer review exceeds its mobile viewport");
    }
    verifyPage(state);
    return {review_id:selected.review.id,response_id:responseId,requirements:33,files:selected.files.length,
      spatial_export_ids:selected.maps.map(item=>item.id),map_previews:mapPreviews,mobile_width:mobile?412:null};
  }finally{await page.close();}
}
export async function beforeBackup({context,control,report,persist,stage}){
  const retained=contextFor(control,report,persist);
  const prepared=await invoke("prepare",[],{control,report,persist});
  const selected=readPacket(prepared,control);
  if(report.customer.review_id)assert(report.customer.review_id===prepared.review_id,"Retain the original customer review");
  else{
    report.customer.review_id=prepared.review_id;
    report.customer.initial_parent_response_id=selected.packet.latest_response_id;
  }
  report.customer.prepared=prepared;persist();
  const responsePath=path.join(retained.value.output,"browser-response.json");
  if(report.customer.response)sameFile(responsePath,report.customer.response);
  else if(fs.existsSync(responsePath)){
    const body=JSON.parse(fs.readFileSync(responsePath,"utf8"));
    verifyResponse(body,selected,report.customer.initial_parent_response_id);
    report.customer.response=fileRecord(responsePath,true);persist();
  }else{
    assert(!prepared.response_exists,"Recover the retained downloaded response of the existing imported review");
    assert(selected.packet.latest_response_id===report.customer.initial_parent_response_id,"An independent response advanced before this internal draft");
    report.customer.response=await createResponse(context,selected,responsePath,report.customer.initial_parent_response_id);persist();
  }
  verifyResponse(JSON.parse(fs.readFileSync(responsePath,"utf8")),selected,report.customer.initial_parent_response_id);
  const imported=prepared.response_exists ? prepared : await invoke("import-response",["--response",responsePath],{control,report,persist});
  assert(imported.review_id===prepared.review_id&&imported.response_id,"The original response import changed review identity");
  if(report.customer.imported){
    assert(report.customer.imported.review_id===imported.review_id&&report.customer.imported.response_id===imported.response_id,
      "Retain the original imported customer response");
    if(report.customer.imported.archive&&imported.archive){
      assert(report.customer.imported.archive.path===imported.archive.path,"Retain the original completed customer packet");
      sameFile(imported.archive.path,report.customer.imported.archive);
    }
  }else report.customer.imported=imported;
  persist();
  const completed=readPacket(imported,control);
  const history=await inspectHistory(context,completed,imported.response_id);
  report.customer.before_backup={complete:true,...history,source_manifest_sha256:control.source_manifest_sha256,at:new Date().toISOString()};
  persist();stage("customer_review_before_backup",{review_id:prepared.review_id,response_id:imported.response_id,requirements:33,questions:2,unreviewed_requirements:31,disposition:"in-review"});
  return report.customer;
}
export async function restored({context,control,report,persist,stage}){
  contextFor(control,report,persist);
  assert(report.customer?.before_backup?.complete&&report.customer.imported?.response_id,"Complete the original customer review before receiving its backup");
  assert(report.received?.application&&report.received?.workspace,"The original Workspace restore is required");
  const result=await invoke("restored",["--application",report.received.application,"--workspace",report.received.workspace],
    {control,report,persist,application:report.received.application});
  assert(result.review_id===report.customer.review_id&&result.response_id===report.customer.imported.response_id,
    "Original restore changed the customer review or imported response");
  const selected=readPacket(result,control),history=await inspectHistory(context,selected,result.response_id,{mobile:true});
  if(report.customer.restored?.complete){
    assert(report.customer.restored.review_id===result.review_id&&report.customer.restored.response_id===result.response_id&&
      report.customer.restored.archive.path===result.archive.path,"Retain the completed received customer packet");
    sameFile(result.archive.path,report.customer.restored.archive);
  }else report.customer.restored={...result,complete:true,browser:history,source_manifest_sha256:control.source_manifest_sha256,at:new Date().toISOString()};
  persist();stage("customer_review_restored",{review_id:result.review_id,response_id:result.response_id,requirements:33,files:history.files,disposition:"in-review"});
  return report.customer;
}
