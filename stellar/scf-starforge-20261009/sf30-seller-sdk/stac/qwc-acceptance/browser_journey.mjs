import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";

const argv=process.argv.slice(2),at=argv.indexOf("--input");
assert(at>=0&&argv[at+1],"Use --input with the original native browser selection");
const input=JSON.parse(await fs.readFile(argv[at+1],"utf8"));
assert(["operate","reopen"].includes(input.phase),"Select the original receiving phase");
const directory=path.resolve(input.directory);
await fs.mkdir(directory,{recursive:true,mode:0o700});
const sha=raw=>crypto.createHash("sha256").update(raw).digest("hex");
const canonical=value=>JSON.stringify(value);
const selection={phase:input.phase,workspace_id:input.workspace_id,run_ids:input.run_ids,
  capture_id:input.capture_id,body_sha256:input.body_sha256,operation_id:input.operation_id,actor:input.actor};
const fingerprint=sha(canonical(selection));
const checkpointPath=path.join(directory,"browser-checkpoint.json");
let checkpoint;
try{checkpoint=JSON.parse(await fs.readFile(checkpointPath,"utf8"));assert.equal(checkpoint.fingerprint,fingerprint,"Keep the original browser selection");}
catch(error){if(error.code!=="ENOENT")throw error;checkpoint={schema:"starforge.qwc.native-browser.v1",fingerprint,selection,actions:{},stages:{},started_at:new Date().toISOString()};}
async function save(){
  const temporary=checkpointPath+"."+process.pid+".tmp";
  const handle=await fs.open(temporary,"w",0o600);
  try{await handle.writeFile(JSON.stringify(checkpoint,null,2)+"\n");await handle.sync();}finally{await handle.close();}
  await fs.rename(temporary,checkpointPath);
}
async function fileIdentity(file){const raw=await fs.readFile(file);return{path:file,bytes:raw.length,sha256:sha(raw)};}
async function until(fn,timeout=60000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,150));}
  throw new Error("The original browser stage did not finish within its selected deadline");
}
const playwright=await import(pathToFileURL(path.resolve(input.playwright_module)).href);
const browser=await playwright.chromium.launch({executablePath:input.chrome,headless:true,
  args:["--no-sandbox","--disable-dev-shm-usage"]});
let context,page,activeAction=null;
const pageErrors=[];
const origin=new URL(input.origin).origin;
assert.equal(new URL(origin).hostname,"127.0.0.1","The native UI receives only its selected loopback origin");
try{
  context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
  await context.route("**/*",async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==origin){await route.abort("blockedbyclient");return;}
    if(activeAction&&request.method()==="POST"&&url.pathname==="/api/actions"){
      const payload=JSON.parse(request.postData()||"{}");
      const old=checkpoint.actions[activeAction];
      if(old)assert.equal(canonical(old.payload),canonical(payload),"Retain the exact original browser action");
      else{checkpoint.actions[activeAction]={payload,selected_at:new Date().toISOString()};await save();}
    }
    await route.continue();
  });
  page=await context.newPage();
  page.on("pageerror",error=>pageErrors.push(error.message));
  async function ready(){
    await page.goto(origin,{waitUntil:"domcontentloaded",timeout:30000});
    await page.waitForFunction(()=>document.querySelector("#workspace-details")?.textContent.includes("Workspace "),{timeout:30000});
    await page.locator("#actor").fill(input.actor);
    const state=await api("/api/state");
    assert.equal(state.id,input.workspace_id,"Open the original captured workspace");
    return state;
  }
  async function api(url,payload){
    return page.evaluate(async({url,payload})=>{
      const headers=payload?{"Content-Type":"application/json","X-Publication-Review-Token":document.querySelector('meta[name="publication-review-token"]').content}:{};
      const response=await fetch(url,payload?{method:"POST",headers,body:JSON.stringify(payload)}:{});
      const value=await response.json();
      if(!response.ok||value.error){const error=value.error||{code:"HTTP_"+response.status,message:"Original request failed"};return{__error:error};}
      return value;
    },{url,payload});
  }
  async function committedPending(payload,remove=false){
    await page.evaluate(async({workspace,payload,remove})=>{
      const {openReviewStore}=await import("/review-store.js");
      const state=await (await fetch("/api/state")).json();
      const store=await openReviewStore(workspace,state.receiving_context?.archive_sha256||"original");
      try{if(remove)await store.removePending(payload.operation_id);else await store.putPending(payload);}finally{store.close();}
    },{workspace:input.workspace_id,payload,remove});
  }
  async function perform(key,trigger,expectedError){
    let action=checkpoint.actions[key];
    if(!action){
      activeAction=key;
      try{await trigger();await until(()=>checkpoint.actions[key],30000);}
      finally{activeAction=null;}
      action=checkpoint.actions[key];
    }else{
      await committedPending(action.payload);
      const submitted=await api("/api/actions",action.payload);
      assert(!submitted.__error,JSON.stringify(submitted.__error));
    }
    let job=await until(async()=>{
      const current=await api("/api/jobs/"+encodeURIComponent(action.payload.operation_id));
      if(current.__error){if(current.__error.code==="JOB_NOT_FOUND")return false;throw new Error(JSON.stringify(current.__error));}
      return ["COMPLETE","FAILED"].includes(current.state)?current:false;
    },150000);
    if(expectedError){
      assert.equal(job.state,"FAILED","The exact incorrect import selection must be rejected");
      assert(expectedError.includes(job.error.code),"Unexpected original rejection "+JSON.stringify(job.error));
    }else{
      assert.equal(job.state,"COMPLETE",JSON.stringify(job.error||job));
      assert.notEqual(job.result?.complete,false,"The original native action requires its retained findings");
    }
    checkpoint.actions[key].outcome={state:job.state,error:job.error||null,result:job.result||null};
    await save();
    await committedPending(action.payload,true);
    await ready();
    return job;
  }
  const allCaptures=state=>state.runs.flatMap(run=>Object.values(run.results).flat());
  async function nav(name){await page.locator('nav button[data-tab="'+name+'"]').click();}
  async function reviewCard(captureId){
    const state=await api("/api/state"),capture=allCaptures(state).find(item=>item.operation_id===captureId);
    assert(capture,"The original selected response is present");
    await nav("review");await page.locator("#review-run").selectOption(capture.run_id);
    await page.locator("#review-filter").selectOption("all");
    return page.locator("#review-cards > .card").filter({hasText:captureId}).first();
  }
  async function openImport(runId){
    const state=await api("/api/state"),run=state.runs.find(item=>item.id===runId);
    const check=run.checks.find(item=>item.id===input.capture_check),roleIndex=run.roles.findIndex(item=>item.id===input.capture_role);
    assert(check&&roleIndex>=0,"Keep the same original check and role in this selected publication");
    await nav("capture");await page.locator("#capture-run").selectOption(runId);
    const row=page.locator("#capture-matrix tbody tr").filter({hasText:check.title}).first();
    await row.locator("td").nth(roleIndex+1).getByRole("button",{name:"Import original response",exact:true}).click();
    await page.locator("#native-body").setInputFiles(input.body);
    await page.locator("#native-metadata").setInputFiles(input.metadata);
  }
  async function downloadArchive(key){
    await nav("delivery");
    const job=await perform(key,()=>page.locator("#export").click());
    const operationId=job.id,receipt=job.result;
    assert.equal(receipt.workspace_id,input.workspace_id);
    const response=await page.request.get(origin+"/api/exports/"+encodeURIComponent(operationId));
    assert.equal(response.status(),200);
    const raw=await response.body();
    assert.equal(raw.length,receipt.archive.bytes);assert.equal(sha(raw),receipt.archive.sha256);
    const target=path.join(directory,key+"-handover.zip");
    try{assert.deepEqual(await fs.readFile(target),raw,"Preserve the exact downloaded original archive");}
    catch(error){if(error.code!=="ENOENT")throw error;await fs.writeFile(target,raw,{flag:"wx",mode:0o600});}
    const repeated=await page.request.get(origin+"/api/exports/"+encodeURIComponent(operationId));
    assert.equal(sha(await repeated.body()),receipt.archive.sha256,"Repeated original download keeps exact bytes");
    return{path:target,bytes:raw.length,sha256:sha(raw),operation_id:operationId,manifest_sha256:receipt.manifest_sha256};
  }

  let state=await ready();
  assert(input.run_ids.every(id=>state.runs.some(run=>run.id===id)),"Both original native editions reopen");
  assert(allCaptures(state).length>=input.native_response_count,"All original native responses remain");
  const artifacts=[];
  if(input.phase==="operate"){
    const native=allCaptures(state).find(item=>item.operation_id===input.capture_id);
    assert.equal(native.body.sha256,input.body_sha256);
    const note="Reviewed the original native capability response "+input.capture_id+
      ": HTTP "+native.response.status+", publication keyword and the selected role's layer/CRS requirements. "+
      "The exact response SHA-256 is "+native.body.sha256+".";
    if(!checkpoint.stages.draft){
      const card=await reviewCard(input.capture_id);
      await card.locator(".review-form select").selectOption("accepted");
      await card.locator(".review-form textarea").fill(note);
      await card.getByText("Unfinished note saved in this browser",{exact:false}).waitFor();
      checkpoint.stages.draft={note,base_revision:state.revision};await save();
    }else{
      await page.evaluate(async({workspace,captureId,draft})=>{
        const {openReviewStore}=await import("/review-store.js");
        const store=await openReviewStore(workspace);
        try{const current=await store.listDrafts();if(!current[captureId])await store.putDraft(captureId,{decision:"accepted",note:draft.note,base_revision:draft.base_revision});}
        finally{store.close();}
      },{workspace:input.workspace_id,captureId:input.capture_id,draft:checkpoint.stages.draft});
      await ready();
    }
    let card=await reviewCard(input.capture_id);
    await page.locator("#refresh").click();
    await until(async()=>await (await reviewCard(input.capture_id)).locator("textarea").inputValue()===note);
    await ready();card=await reviewCard(input.capture_id);
    assert.equal(await card.locator("textarea").inputValue(),note,"An unfinished original note survives browser reload");

    const other=input.run_ids.find(value=>value!==input.capture_run);
    const wrongState=await api("/api/state");
    const otherRun=wrongState.runs.find(value=>value.id===other);
    if(otherRun.checks.some(value=>value.id===input.capture_check)&&otherRun.roles.some(value=>value.id===input.capture_role)){
      const before=allCaptures(wrongState).length;
      await openImport(other);
      const rejected=await perform("mismatched-publication-import",()=>page.locator("#import-response").click(),
        ["IMPORTED_PUBLICATION_CHANGED","CAPTURE_REQUEST_CHANGED"]);
      assert.equal(allCaptures(await api("/api/state")).length,before,"A wrong edition does not acquire or relabel a response");
      checkpoint.stages.edition_binding={source_capture:input.capture_id,target_run:other,error:rejected.error.code};
      await save();
    }
    await openImport(input.capture_run);
    const imported=await perform("original-native-import",()=>page.locator("#import-response").click());
    assert.equal(imported.result.body.sha256,input.body_sha256);
    assert.equal(imported.result.publication.manifest.sha256,native.publication.manifest.sha256);
    card=await reviewCard(input.capture_id);
    assert.equal(await card.locator("textarea").inputValue(),note,"Completing an import preserves a different unfinished review");
    const rebase=card.getByRole("button",{name:"Use current revision after review",exact:true});
    if(await rebase.count()){
      await rebase.click();
      await until(async()=>await (await reviewCard(input.capture_id)).getByRole("button",{name:"Use current revision after review",exact:true}).count()===0);
    }
    card=await reviewCard(input.capture_id);
    const reviewed=await perform("native-capability-review",()=>card.getByRole("button",{name:"Save review",exact:true}).click());
    assert.equal(reviewed.result.capture_id,input.capture_id);
    checkpoint.stages.draft_preservation={source_capture:input.capture_id,review_operation:reviewed.id,note};
    await save();

    state=await api("/api/state");
    const map=allCaptures(state).find(item=>item.request.operation==="GetMap"&&item.response.media_type.split(";")[0]==="image/png"&&item.evaluation.state==="PASS");
    assert(map,"The complete native workflow retains an actual successful map");
    card=await reviewCard(map.operation_id);
    await card.scrollIntoViewIfNeeded();
    const image=card.locator("img.map-output");
    await image.waitFor();
    await until(()=>image.evaluate(node=>node.complete&&node.naturalWidth>0));
    const size=await image.evaluate(node=>[node.naturalWidth,node.naturalHeight]);
    assert.deepEqual(size,map.evaluation.model.image_size);
    const mapShot=path.join(directory,"original-native-map.png");
    await page.screenshot({path:mapShot,fullPage:false});artifacts.push(await fileIdentity(mapShot));
    const print=allCaptures(state).find(item=>item.request.operation==="GetPrint"&&item.evaluation.state==="PASS");
    assert(print,"The complete native workflow retains its actual PDF print response");
    card=await reviewCard(print.operation_id);
    const downloadEvent=page.waitForEvent("download");
    await card.getByRole("link",{name:"Open original print PDF",exact:true}).click();
    const download=await downloadEvent;
    const pdfPath=path.join(directory,"original-native-print.pdf");
    await download.saveAs(pdfPath);
    const pdf=await fileIdentity(pdfPath);
    assert.equal(pdf.bytes,print.body.bytes);assert.equal(pdf.sha256,print.body.sha256);artifacts.push(pdf);
    checkpoint.stages.original_outputs={map_capture:map.operation_id,print_capture:print.operation_id,map_size:size};
    await save();
  }else{
    assert.equal(state.receiving_context.archive_sha256,input.original_archive_sha256);
    const original=state.operations[input.original_export_id];
    assert.equal(original.state,"RUNNING","The original export snapshot keeps its actual historical in-progress row");
    assert.equal(original.view_state,"RETAINED_RUNNING_HISTORY","The receiver distinguishes original export history from live work");
    await nav("delivery");
    await page.getByText("This entry is the original archive's historical in-progress snapshot.",{exact:false}).first().waitFor();
    checkpoint.stages.original_history={operation_id:input.original_export_id,state:original.state,view_state:original.view_state};
    await save();
  }

  await nav("changes");
  await page.locator("#compare-left").selectOption(input.run_ids[0]);
  await page.locator("#compare-right").selectOption(input.run_ids[1]);
  await page.locator("#compare").click();
  await page.locator("#comparison > .card").first().waitFor();
  const comparison=await api("/api/compare?left="+encodeURIComponent(input.run_ids[0])+"&right="+encodeURIComponent(input.run_ids[1]));
  assert(comparison.publication_changed,"The original before/after comparison retains both different publication identities");
  const comparisonShot=path.join(directory,"edition-comparison.png");
  await page.screenshot({path:comparisonShot,fullPage:false});artifacts.push(await fileIdentity(comparisonShot));
  checkpoint.stages.comparison={changes:comparison.changes.length,publication_changed:comparison.publication_changed};
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});await nav("delivery");
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
    assert.equal(overflow,false,"The actual operator remains usable at "+width+" pixels");
    const target=path.join(directory,"operator-"+width+".png");
    await page.screenshot({path:target,fullPage:false});artifacts.push(await fileIdentity(target));
  }
  await page.setViewportSize({width:1280,height:900});
  const archive=await downloadArchive(input.phase+"-complete");
  assert.equal(pageErrors.length,0,"Actual operator page errors: "+pageErrors.join("; "));
  const result={schema:"starforge.qwc.native-browser.v1",phase:input.phase,workspace_id:input.workspace_id,
    fingerprint,operation_id:input.operation_id,state:"COMPLETE",completed_at:new Date().toISOString(),
    archive,artifacts,stages:checkpoint.stages,page_errors:pageErrors};
  const resultPath=path.join(directory,"browser-result.json");
  await fs.writeFile(resultPath,JSON.stringify(result,null,2)+"\n",{flag:"wx",mode:0o600});
  checkpoint.state="COMPLETE";checkpoint.completed_at=result.completed_at;await save();
  process.stdout.write(JSON.stringify({state:result.state,phase:result.phase,workspace_id:result.workspace_id,archive})+"\n");
}finally{
  await context?.close();
  await browser.close();
}
