import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { HaystackClient } from "./client.mjs";
import { canonicalJson } from "./json-codec.mjs";
import { atomicWrite, plainRead } from "./files.mjs";

const SCHEMA = "commons.haystack.corrective-browser.v1";
const DB = "commons.haystack.operator.v1";
const TAB = "commons.haystack.operator.tab";
const MUTATIONS = new Set(["work.capture","work.update","work.evidence","work.submit","work.review","return.apply","delivery.prepare"]);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const clone = value => JSON.parse(JSON.stringify(value));
const same = (a,b) => canonicalJson(a) === canonicalJson(b);
const json = value => Buffer.from(JSON.stringify(value,null,2)+"\n");
const errorValue = error => ({name:error?.name||"Error",message:error?.message||String(error),code:error?.code||null});
const resultBody = value => value?.result && (value.result.itemId || value.result.kind || value.result.returnId) ? value.result : value;
const missing = error => error?.status === 404 || ["operation_not_found","unknown_operation","not_found"].includes(error?.code);

/**
 * Operate the original server owned by CORRECTIVE_RECEIVING. This function does
 * not start a server, acquire another product operation, or control a device.
 * The caller retains its original operation lock throughout this invocation.
 */
export async function runCorrectiveBrowser({
  url, workspaceId, instanceId, token="", outputRoot, sourceId, recordKey,
  evidenceFile, returnFile, manualItemId, diagnosticItemId, returnItemId
}) {
  for (const [name,value] of Object.entries({url,workspaceId,instanceId,outputRoot,sourceId,recordKey,evidenceFile,returnFile,manualItemId,diagnosticItemId,returnItemId}))
    assert.equal(typeof value,"string","Supply the original "+name);
  assert.ok(workspaceId && instanceId && sourceId && recordKey && manualItemId !== diagnosticItemId);
  const origin = new URL(url).origin;
  assert.equal(new URL(url).origin,new URL(url).href.replace(/\/$/,""),"Use the original server's HTTP origin");
  const root = resolve(outputRoot);
  await fs.mkdir(root,{recursive:true,mode:0o700});
  await fs.mkdir(join(root,"files"),{recursive:true,mode:0o700});
  const evidence = await plainRead(resolve(evidenceFile),8*1024*1024);
  const returned = await plainRead(resolve(returnFile),192*1024*1024);
  assert.ok(evidence.length && returned.length,"The supplied original evidence and return must be complete");
  const input = {
    origin,workspaceId,sourceId,recordKey,manualItemId,diagnosticItemId,returnItemId,
    evidence:{name:basename(evidenceFile),bytes:evidence.length,sha256:hash(evidence)},
    returned:{name:basename(returnFile),bytes:returned.length,sha256:hash(returned)}
  };
  const inputSha256 = hash(canonicalJson(input));
  const journalPath = join(root,"journal.json"), resultPath = join(root,"result.json");
  let state;
  try { state=JSON.parse((await plainRead(journalPath,8*1024*1024)).toString("utf8")); }
  catch (error) { if(error.code!=="ENOENT")throw error; }
  if(state) {
    assert.equal(state.schema,SCHEMA); assert.equal(state.inputSha256,inputSha256,"Reopen the same original browser input");
    assert.ok(state.tabs?.author && state.tabs?.peer && state.commands && state.steps);
  } else state={schema:SCHEMA,inputSha256,input,tabs:{author:randomUUID(),peer:randomUUID()},phase:"PREPARED",commands:{},steps:{},files:{},sourceEditions:[],createdAt:new Date().toISOString()};
  let writes=Promise.resolve(), context=null, closing=null, interrupted=null, active=null;
  const routeTasks=new Set(), routeErrors=[], pageErrors=[];
  const client=new HaystackClient({url:origin,token,workspaceId,instanceId,maxResponseBytes:256*1024*1024});
  await client.connect();
  function save() {
    state.updatedAt=new Date().toISOString(); const bytes=json(state);
    writes=writes.then(()=>atomicWrite(journalPath,bytes)); return writes;
  }
  async function readWork(itemId) {
    const status=await client.request("workspace.status");
    const value=await client.request("work.read",{expectedRevision:status.revision,itemId});
    assert.equal(value.id,itemId);assert.equal(value.workspaceId,workspaceId);
    return value;
  }
  async function readOperation(id) {
    const value=await client.request("operation.read",{operationId:id});
    const body=resultBody(value);
    assert.equal(body.operationId||value.operationId,id,"Read back the exact original operation");
    return body;
  }
  async function closeBrowser() {
    if(closing)return closing;
    if(!context)return;
    const owned=context, browser=owned.browser();
    closing=(async()=>{
      const errors=[];
      try { await owned.close(); } catch(error) { errors.push(error); }
      if(browser)try { await browser.close(); } catch(error) { errors.push(error); }
      context=null;
      if(errors.length)throw new AggregateError(errors,"The original browser did not close completely");
    })();
    return closing;
  }
  const signalHandler=()=>{interrupted=new Error("Original corrective browser interrupted; keep its journal and profile");closeBrowser().catch(error=>routeErrors.push(error));};
  process.on("SIGINT",signalHandler);process.on("SIGTERM",signalHandler);
  function checkRunning(){if(interrupted)throw interrupted;if(routeErrors.length)throw new AggregateError(routeErrors,"Original browser request handling failed");}
  async function idle(page) {
    await page.waitForFunction(()=>document.body.dataset.busy!=="true",{},{timeout:30000});
    await Promise.all([...routeTasks]);checkRunning();
  }
  async function localRows(page) {
    return page.evaluate(async({database,workspace})=>{
      const {canonicalJson}=await import("/json-codec.mjs");
      const db=await new Promise((resolve,reject)=>{
        const r=indexedDB.open(database);
        r.onupgradeneeded=()=>{r.transaction.abort();reject(new Error("The original operator database is absent"));};
        r.onerror=()=>reject(r.error);r.onsuccess=()=>resolve(r.result);
      });
      try {
        const rows=await new Promise((resolve,reject)=>{const tx=db.transaction("operations","readonly"),r=tx.objectStore("operations").getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
        return await Promise.all(rows.filter(x=>x.workspaceId===workspace).map(async row=>{
          const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonicalJson(row.args)));
          const args=structuredClone(row.args);if("base64" in args)args.base64="[original complete bytes retained in IndexedDB]";
          return {operationId:row.operationId,action:row.action,state:row.state,receipt:row.receipt,
            argsSha256:Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,"0")).join(""),args};
        }));
      } finally { db.close(); }
    },{database:DB,workspace:workspaceId});
  }
  async function draft(page,role="author") {
    return page.evaluate(({database,key})=>new Promise((resolve,reject)=>{
      const r=indexedDB.open(database);
      r.onupgradeneeded=()=>{r.transaction.abort();reject(new Error("The retained draft database is absent"));};
      r.onerror=()=>reject(r.error);
      r.onsuccess=()=>{const db=r.result,tx=db.transaction("drafts","readonly"),q=tx.objectStore("drafts").get(key);q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>reject(q.error);tx.oncomplete=()=>db.close();tx.onabort=()=>{db.close();reject(tx.error);};};
    }),{database:DB,key:workspaceId+":"+state.tabs[role]});
  }
  async function retained(page,predicate,role="author") {
    const deadline=Date.now()+15000;
    while(Date.now()<deadline) {
      checkRunning();const value=await draft(page,role);
      if(predicate(value))return value;
      await new Promise(resolve=>setTimeout(resolve,125));
    }
    throw new Error("The authored draft did not reach its original IndexedDB record");
  }
  async function nav(page,name) {await page.locator('button[data-panel="'+name+'"]').click();await idle(page);}
  async function connect(page) {
    await page.goto(origin,{waitUntil:"domcontentloaded"});
    await page.locator("#connect-dialog").waitFor({state:"visible"});
    assert.equal(await page.locator("#connect-url").inputValue(),origin);
    await page.locator("#connect-workspace").fill(workspaceId);
    await page.locator("#connect-token").fill(token);
    await page.locator('#connect-form button[type="submit"]').click();
    await page.locator("#connect-dialog").waitFor({state:"hidden"});
    await idle(page);
    assert.match(await page.locator("#connection-state").textContent(),/Connected/);
    const details=await page.locator("#connection-details").textContent();
    assert.ok(details.includes(workspaceId) && details.includes(instanceId),"The UI opened the original server and workspace");
  }
  async function newPage(role) {
    const tab=state.tabs[role];
    let page;
    for(const candidate of context.pages()) {
      if(new URL(candidate.url()==="about:blank"?origin:candidate.url()).origin!==origin)continue;
      const retainedId=await candidate.evaluate(key=>sessionStorage.getItem(key),TAB).catch(()=>null);
      if(retainedId===tab){page=candidate;break;}
    }
    page ||= await context.newPage();
    await page.addInitScript(({key,id})=>{
      const prior=sessionStorage.getItem(key);
      if(prior && prior!==id)throw new Error("This tab belongs to a different original operator draft");
      sessionStorage.setItem(key,id);
    },{key:TAB,id:tab});
    page.on("pageerror",error=>pageErrors.push(errorValue(error)));
    await connect(page);return page;
  }
  async function handleRoute(route) {
    const request=route.request();
    if(request.method()!=="POST"){await route.continue();return;}
    const payload=request.postDataJSON();
    if(!MUTATIONS.has(payload?.action)){await route.continue();return;}
    const owner=active;
    assert.ok(owner,"A product mutation must belong to its retained browser step");
    assert.equal(payload.action,owner.action,"The browser dispatched a different action");
    const args=payload.args, argsSha256=hash(canonicalJson(args));
    assert.equal(typeof args.operationId,"string");
    let command=state.commands[owner.name];
    assert.ok(command && command.action===payload.action);
    if(command.operationId) {
      assert.equal(command.operationId,args.operationId,"Continue the original request UUID");
      assert.equal(command.argsSha256,argsSha256,"Continue the complete unchanged request");
    } else {
      const summary=clone(args);if("base64" in summary)summary.base64="[complete original bytes retained in IndexedDB]";
      Object.assign(command,{operationId:args.operationId,argsSha256,args:summary,dispatchedAt:new Date().toISOString()});
      await save();
    }
    const response=await route.fetch({maxRedirects:0,maxRetries:0,timeout:60000});
    const body=await response.json();
    command.httpStatus=response.status();
    if(response.ok())command.receipt=resultBody(body);
    else command.error=body;
    await save();
    if(owner.loseReply && response.ok() && !command.lostReplyInjected) {
      command.lostReplyInjected=true;await save();await route.abort("failed");return;
    }
    await route.fulfill({response});
  }
  async function launch() {
    checkRunning();closing=null;
    const require=createRequire(import.meta.url);
    const {chromium}=require(process.env.HAYSTACK_PLAYWRIGHT_MODULE||"/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
    context=await chromium.launchPersistentContext(join(root,"profile"),{
      headless:true,executablePath:process.env.HAYSTACK_CHROMIUM_EXECUTABLE||"/workspace/scratch/705ebf077387/browser-runtime/chrome-headless-shell-linux64/chrome-headless-shell",
      viewport:{width:1280,height:900},acceptDownloads:true,args:["--no-sandbox","--disable-dev-shm-usage"]
    });
    context.setDefaultTimeout(30000);
    await context.route(origin+"/api/action",route=>{
      const task=handleRoute(route).catch(async error=>{routeErrors.push(error);await route.abort("failed").catch(()=>{});});
      routeTasks.add(task);task.finally(()=>routeTasks.delete(task));return task;
    });
    const response=await context.request.get(origin+"/app.js");
    assert.ok(response.ok(),"The original app source is served");
    const served=await response.body(),selected=await plainRead(fileURLToPath(new URL("./app.js",import.meta.url)),2*1024*1024);
    assert.equal(hash(served),hash(selected),"The browser must operate the selected complete app");
    const edition={appSha256:hash(served),companionSha256:hash(await plainRead(fileURLToPath(import.meta.url),2*1024*1024))};
    if(!state.sourceEditions.some(x=>same(x,edition))){state.sourceEditions.push(edition);await save();}
  }
  async function findRow(page,bodyId,key,nextId) {
    for(let count=0;count<1000;count++) {
      const rows=page.locator("#"+bodyId+" tr").filter({hasText:key});
      if(await rows.count()){assert.equal(await rows.count(),1,"The complete source identity must select one row");return rows.first();}
      const next=page.locator("#"+nextId);assert.ok(await next.isEnabled(),"The original row is absent from the complete paged view: "+key);
      await next.click();await idle(page);
    }
    throw new Error("The original paged view did not terminate");
  }
  async function openWork(page,id) {
    await nav(page,"work");
    for(const selector of ["#work-status-filter","#work-priority-filter","#work-source-filter"])await page.locator(selector).selectOption("");
    await page.locator("#work-assignee-filter").fill("");await page.locator("#work-query-filter").fill("");
    await page.locator('#work-filter-form button[type="submit"]').click();await idle(page);
    const row=await findRow(page,"work-body",id,"work-next");
    await row.locator("button").first().click();await idle(page);
    assert.match(await page.locator("#work-detail-label").textContent(),/Work item/);
  }
  async function recover(page,name) {
    const command=state.commands[name];
    await nav(page,"operations");
    const row=page.locator("#local-operations-body tr").filter({hasText:command.operationId});
    assert.equal(await row.count(),1,"Retain the same browser's original request");
    await row.getByRole("button",{name:"Read receipt",exact:true}).click();await idle(page);
    let receipt;
    try { receipt=await readOperation(command.operationId); }
    catch(error) {
      if(!missing(error))throw error;
      active={name,action:command.action,loseReply:false};
      try {
        await row.getByRole("button",{name:"Resend original",exact:true}).click();
        await page.locator("#confirm-dialog").waitFor({state:"visible"});
        await page.locator("#confirm-yes").click();await idle(page);
        receipt=await readOperation(command.operationId);
      } finally {active=null;}
    }
    command.receipt=receipt;command.state="COMPLETE";command.recoveredAt=new Date().toISOString();await save();return receipt;
  }
  async function command(page,name,action,perform,{loseReply=false}={}) {
    checkRunning();let selected=state.commands[name];
    if(selected?.operationId)return recover(page,name);
    if(!selected) {
      selected=state.commands[name]={action,state:"PREPARED",baseline:(await localRows(page)).map(x=>x.operationId),preparedAt:new Date().toISOString()};
      await save();
    } else {
      assert.equal(selected.action,action);
      const candidates=(await localRows(page)).filter(x=>x.action===action&&!selected.baseline.includes(x.operationId));
      assert.ok(candidates.length<=1,"More than one original request needs explicit receiving reconciliation");
      if(candidates.length) {
        const row=candidates[0];Object.assign(selected,{operationId:row.operationId,argsSha256:row.argsSha256,args:row.args});
        await save();return recover(page,name);
      }
    }
    active={name,action,loseReply};
    try {await perform();await idle(page);}
    finally {active=null;}
    if(!selected.operationId) {
      const candidates=(await localRows(page)).filter(x=>x.action===action&&!selected.baseline.includes(x.operationId));
      assert.equal(candidates.length,1,"The UI did not retain one complete original request");
      Object.assign(selected,{operationId:candidates[0].operationId,argsSha256:candidates[0].argsSha256,args:candidates[0].args});await save();
    }
    const receipt=await readOperation(selected.operationId);
    selected.receipt=receipt;
    if(!loseReply){selected.state="COMPLETE";selected.completedAt=new Date().toISOString();}
    await save();return receipt;
  }
  async function step(name,fn) {
    checkRunning();if(state.steps[name]?.state==="COMPLETE")return state.steps[name].result;
    state.steps[name]={...state.steps[name],state:"RUNNING",startedAt:state.steps[name]?.startedAt||new Date().toISOString()};await save();
    process.stdout.write(JSON.stringify({kind:"haystack_browser_progress",step:name,workspaceId})+"\n");
    const result=await fn();state.steps[name]={...state.steps[name],state:"COMPLETE",result:result??null,completedAt:new Date().toISOString()};await save();return result;
  }
  async function originalDownload(page,button,key,expected) {
    const destination=join(root,"files",key),temporary=destination+".downloading";
    const promise=page.waitForEvent("download");
    const clicked=button.click();
    const [download]=await Promise.all([promise,clicked]);
    await download.saveAs(temporary);await idle(page);
    const bytes=await plainRead(temporary,192*1024*1024);
    assert.equal(bytes.length,expected.bytes);assert.equal(hash(bytes),expected.sha256);
    try {const prior=await plainRead(destination,192*1024*1024);assert.equal(hash(prior),hash(bytes),"Preserve the original downloaded edition");await fs.unlink(temporary);}
    catch(error){if(error.code!=="ENOENT")throw error;await fs.rename(temporary,destination);}
    state.files[key]={path:destination,name:download.suggestedFilename(),bytes:bytes.length,sha256:hash(bytes)};await save();return state.files[key];
  }
  async function screenshot(page,name) {
    const path=join(root,name);await page.screenshot({path,fullPage:true});
    const bytes=await plainRead(path,32*1024*1024);state.files[name]={path,bytes:bytes.length,sha256:hash(bytes),internalReview:true};await save();
  }
  async function verifyRetainedFiles(){for(const value of Object.values(state.files)){const bytes=await plainRead(value.path,192*1024*1024);assert.equal(bytes.length,value.bytes);assert.equal(hash(bytes),value.sha256);}}
  async function preserveNativeItems() {
    for(const [id,before] of Object.entries(state.nativeItems)) {
      const after=await readWork(id);
      assert.ok(same(after.current,before.current),"The return review must preserve the completed original operator item");
    }
    const status=await client.request("workspace.status");
    assert.ok(same(status.selectedSourceIds,state.selection.sourceIds),"The browser must preserve the original selected sources");
    assert.equal(status.materialSha256,state.selection.materialSha256,"Work review must not silently accept source/tag changes");
  }
  let primary=null, result=null;
  try {
    if(state.phase==="COMPLETE") {
      await verifyRetainedFiles();
      for(const value of Object.values(state.commands))if(value.operationId)await readOperation(value.operationId);
      await preserveNativeItems();
      result=clone(state.result);
      await atomicWrite(resultPath,json(result));
    } else {
    await save();await launch();
    let page=await newPage("author");
    const status=await client.request("workspace.status");
    if(!state.selection) {
      const manual=await readWork(manualItemId),diagnostic=await readWork(diagnosticItemId);
      assert.equal(manual.current.status,"verified");assert.equal(diagnostic.current.status,"exception");
      state.selection={sourceIds:status.selectedSourceIds,materialSha256:status.materialSha256};
      state.nativeItems={[manualItemId]:{current:manual.current},[diagnosticItemId]:{current:diagnostic.current}};
      await save();
    }
    const capture = await step("record_capture",()=>command(page,"record_capture","work.capture",async()=>{
      await nav(page,"assets");
      await page.locator("#asset-edition").selectOption("");await page.locator("#asset-source").selectOption(sourceId);
      await page.locator("#asset-role").selectOption("");await page.locator("#asset-query").fill("");
      await page.locator('#asset-filter-form button[type="submit"]').click();await idle(page);
      const row=await findRow(page,"assets-body",recordKey,"asset-next");
      await row.locator("button").first().click();await idle(page);
      assert.ok((await page.locator("#record-details").textContent()).includes(recordKey));
      await page.locator("#record-details").getByRole("button",{name:"Capture work from record",exact:true}).click();await idle(page);
      await page.locator("#work-capture-title").fill("Source record review — original operator handover");
      await page.locator("#work-capture-description").fill("Review this retained source record, assign its operating follow-through and preserve the evidence used for sign-off.");
      await page.locator("#work-capture-author").fill("Receiving operator");
      await page.locator("#work-capture-save").click();
    }));
    state.browserItemId=capture.itemId;assert.ok(state.browserItemId);await save();
    const itemId=state.browserItemId;
    await step("draft_reload",async()=>{
      await openWork(page,itemId);
      await page.locator("#work-edit-description").fill("Keep this authored source review while another operator updates the assignment. The original source bytes remain the evidence.");
      await page.locator("#work-edit-assignee").fill("Site operations");
      await page.locator("#work-edit-priority").selectOption("high");
      await page.locator("#work-edit-author").fill("Receiving operator");
      await page.locator("#work-edit-note").fill("Original assignment draft retained before the peer's change.");
      const saved=await retained(page,d=>d?.workState?.items?.[itemId]?.fields?.assignee==="Site operations" &&
        d.workState.items[itemId].note==="Original assignment draft retained before the peer's change.");
      state.assignmentDraft=clone(saved.workState.items[itemId]);await save();
      await connect(page);await openWork(page,itemId);
      assert.equal(await page.locator("#work-edit-assignee").inputValue(),state.assignmentDraft.fields.assignee);
      assert.equal(await page.locator("#work-edit-description").inputValue(),state.assignmentDraft.fields.description);
      return {expectedHeadSha256:state.assignmentDraft.expectedHeadSha256,fields:state.assignmentDraft.fields};
    });
    await step("peer_assignment",async()=>{
      const peer=await newPage("peer");
      try {
        const receipt=await command(peer,"peer_assignment","work.update",async()=>{
          await openWork(peer,itemId);
          await peer.locator("#work-edit-assignee").fill("Maintenance lead");
          await peer.locator("#work-edit-author").fill("Peer operator");
          await peer.locator("#work-edit-note").fill("The peer takes the current assignment while the original author retains a separate draft.");
          await peer.locator("#work-update-save").click();
        });
        assert.equal(receipt.itemId,itemId);return receipt;
      } finally {await peer.close();}
    });
    await step("review_stale_draft",async()=>{
      await page.locator("#refresh-workspace").click();await idle(page);await openWork(page,itemId);
      assert.equal(await page.locator("#work-edit-assignee").inputValue(),"Site operations");
      const peerHead=state.commands.peer_assignment.receipt.headSha256;
      assert.equal((await readWork(itemId)).headSha256,peerHead,"Review the exact peer edition");
      if(await page.locator("#work-stale").isVisible()) {
        const comparison=await page.locator("#work-base-comparison").textContent();
        assert.ok(comparison.includes("Site operations")&&comparison.includes("Maintenance lead"),"Show the original/draft/current assignment comparison");
        await screenshot(page,"assignment-comparison-desktop.png");
        await page.locator("#work-adopt-current").click();await idle(page);
      } else {
        const original=(await draft(page))?.workState?.items?.[itemId];
        assert.ok(original?.expectedHeadSha256===peerHead && original.rebases?.some(x=>
          x.fromHeadSha256===state.assignmentDraft.expectedHeadSha256 && x.toHeadSha256===peerHead &&
          same(x.draft,state.assignmentDraft.fields)),"Reopen the original explicit comparison decision");
      }
      await page.locator("#work-stale").waitFor({state:"hidden"});
      await page.locator("#work-edit-note").fill("Reviewed the peer's Maintenance lead assignment; retain the authored Site operations scope and assignment on the current edition.");
      const saved=await retained(page,d=>d?.workState?.items?.[itemId]?.note?.startsWith("Reviewed the peer"));
      assert.equal(saved.workState.items[itemId].fields.assignee,"Site operations");
      return {reviewedPeerHead:state.commands.peer_assignment.receipt.headSha256};
    });
    await step("author_assignment",()=>command(page,"author_assignment","work.update",async()=>{
      await openWork(page,itemId);assert.equal(await page.locator("#work-edit-assignee").inputValue(),"Site operations");
      assert.equal(await page.locator("#work-stale").isVisible(),false);
      await page.locator("#work-update-save").click();
    }));
    await step("evidence_lost_reply",async()=>{
      const receipt=await command(page,"evidence_lost_reply","work.evidence",async()=>{
        await openWork(page,itemId);await page.locator("#work-evidence-kind").selectOption("file");
        await page.locator("#work-evidence-author").fill("Receiving operator");
        await page.locator("#work-evidence-note").fill("The complete original source-record JSON supports this submitted work.");
        await page.locator("#work-evidence-file").setInputFiles(resolve(evidenceFile));
        await retained(page,d=>d?.workState?.items?.[itemId]?.evidenceFile?.sha256===input.evidence.sha256);
        await page.locator("#work-evidence-save").click();
      },{loseReply:true});
      assert.equal(receipt.itemId,itemId);
      assert.equal(state.commands.evidence_lost_reply.lostReplyInjected,true,"The server accepted the original evidence before its browser response was lost");
      await connect(page);
      const recovered=await recover(page,"evidence_lost_reply");
      assert.equal(recovered.operationId,state.commands.evidence_lost_reply.operationId);
      await openWork(page,itemId);
      if(await page.locator("#work-stale").isVisible()){await page.locator("#work-adopt-current").click();await idle(page);}
      const current=await readWork(itemId);
      const selected=current.evidence.filter(x=>x.kind==="file"&&x.sha256===input.evidence.sha256&&x.name===input.evidence.name);
      assert.equal(selected.length,1,"The original lost reply must not produce duplicate file evidence");
      state.evidenceId=selected[0].id;await save();return {itemId,evidenceId:state.evidenceId,operationId:recovered.operationId};
    });
    await step("original_evidence_download",async()=>{
      await openWork(page,itemId);
      const section=page.locator("#work-evidence-list section").filter({hasText:input.evidence.sha256});
      assert.equal(await section.count(),1);
      return originalDownload(page,section.getByRole("button",{name:"Download original evidence",exact:true}),"original-record-evidence.json",input.evidence);
    });
    await step("submit_work",()=>command(page,"submit_work","work.submit",async()=>{
      await openWork(page,itemId);
      await page.locator("#work-review-author").fill("Receiving operator");
      await page.locator("#work-review-edition").selectOption("");
      await page.locator("#work-review-note").fill("Submit the source-linked review and its complete retained evidence for sign-off.");
      await page.locator("#work-submit").click();
    }));
    await step("verify_work",()=>command(page,"verify_work","work.review",async()=>{
      await openWork(page,itemId);
      const current=await readWork(itemId);
      assert.equal(current.current.status,"submitted");assert.ok(current.current.submission?.sha256);
      await page.locator("#work-review-author").fill("Reviewing operator");
      await page.locator("#work-review-note").fill("Verified this exact submitted source review and original evidence.");
      await page.locator("#work-verify").click();
    }));
    assert.equal((await readWork(itemId)).current.status,"verified");
    await step("finding_capture",async()=>{
      const receipt=await command(page,"finding_capture","work.capture",async()=>{
        const currentStatus=await client.request("workspace.status"),known=new Set();
        for await(const items of client.pages("works.list",{expectedRevision:currentStatus.revision,limit:100}))
          for(const item of items.items)if(item.origin?.diagnosticSha256)known.add(item.origin.diagnosticSha256);
        await nav(page,"diagnostics");
        await page.locator("#diagnostic-edition").selectOption("");await page.locator("#diagnostic-source").selectOption(sourceId);
        await page.locator("#diagnostic-severity").selectOption("");await page.locator("#diagnostic-record").fill("");
        await page.locator('#diagnostic-filter-form button[type="submit"]').click();await idle(page);
        let selected=false;
        for(let pageCount=0;pageCount<1000&&!selected;pageCount++) {
          const rows=page.locator("#diagnostics-body tr");
          for(let i=0;i<await rows.count();i++) {
            const row=rows.nth(i),pre=row.locator("pre");
            if(!await pre.count())continue;
            const diagnostic=JSON.parse(await pre.first().textContent()),sha=hash(canonicalJson(diagnostic));
            if(known.has(sha))continue;
            state.capturedDiagnostic={id:diagnostic.id,sha256:sha,snapshot:diagnostic};await save();
            await row.getByRole("button",{name:"Capture work",exact:true}).click();await idle(page);
            await page.locator("#work-capture-title").fill("Retained finding — operating follow-through");
            await page.locator("#work-capture-author").fill("Receiving operator");
            await page.locator("#work-capture-description").fill("Retain this existing automated finding for an explicit operating follow-through; its source snapshot remains unchanged.");
            await page.locator("#work-capture-save").click();selected=true;break;
          }
          if(!selected) {
            const next=page.locator("#diagnostic-next");
            assert.ok(await next.isEnabled(),"The selected source has no uncaptured current finding for the requested browser stage");
            await next.click();await idle(page);
          }
        }
        assert.ok(selected,"Read the complete current findings before recording one");
      });
      state.browserDiagnosticItemId=receipt.itemId;await save();
      const item=await readWork(receipt.itemId);
      assert.equal(item.origin.diagnosticSha256,state.capturedDiagnostic.sha256);
      assert.equal(item.current.status,"open");return {itemId:item.id,diagnosticSha256:item.origin.diagnosticSha256};
    });
    await step("return_review_draft",async()=>{
      await nav(page,"work");
      await page.locator("#work-return-file").setInputFiles(resolve(returnFile));
      await retained(page,d=>d?.workState?.returned?.file?.sha256===input.returned.sha256);
      await page.locator("#work-return-preview").click();await idle(page);
      const prepared=await draft(page),preview=prepared?.workState?.returned?.preview;
      assert.ok(preview && preview.packageSha256===input.returned.sha256);
      const additional=preview.items.find(x=>x.itemId===returnItemId);
      assert.ok(additional && additional.kind==="new" && additional.localHeadSha256===null,"Accept the original recipient's distinct new fourth-record work item");
      assert.ok(preview.items.some(x=>x.itemId===manualItemId)&&preview.items.some(x=>x.itemId===diagnosticItemId));
      for(const item of preview.items) {
        await page.locator('[data-return-decision="'+item.itemId+'"]').selectOption(item.itemId===returnItemId?"accept":"keep");
        if(item.itemId===returnItemId)for(const field of item.conflicts)
          await page.locator('[data-return-choice="'+item.itemId+'"][data-field="'+field+'"]').selectOption("incoming");
      }
      await page.locator("#work-return-author").fill("Receiving operator");
      await page.locator("#work-return-note").fill("Keep the author's completed manual and diagnostic work. Accept the recipient's new fourth-record work with its retained evidence and event history.");
      const saved=await retained(page,d=>d?.workState?.returned?.decisions?.[returnItemId]?.decision==="accept" &&
        d.workState.returned.decisions[manualItemId]?.decision==="keep" &&
        d.workState.returned.note.startsWith("Keep the author's completed"));
      state.returnDecisions=clone(saved.workState.returned.decisions);state.returnPreview=clone(preview);await save();
      await screenshot(page,"returned-work-review-desktop.png");
      await connect(page);await nav(page,"work");
      const reopened=await draft(page);
      assert.equal(reopened.workState.returned.file.sha256,input.returned.sha256);
      assert.ok(same(reopened.workState.returned.decisions,state.returnDecisions),"Reload preserves every explicit return choice");
      assert.equal(await page.locator('[data-return-decision="'+returnItemId+'"]').inputValue(),"accept");
      return {packageSha256:preview.packageSha256,items:preview.items.length,acceptedItemId:returnItemId};
    });
    const returnReceipt=await step("return_apply",()=>command(page,"return_apply","return.apply",async()=>{
      await nav(page,"work");
      assert.equal(await page.locator("#work-return-stale").isVisible(),false,"Review a changed workspace before a fresh return application");
      await page.locator("#work-return-apply").click();
    }));
    await preserveNativeItems();
    const received=await readWork(returnItemId);
    assert.ok(received.evidence.length,"Retain the recipient's original note evidence");
    state.returnedItemId=received.id;
    await step("return_receipt_readback",async()=>{
      await nav(page,"work");
      const row=page.locator("#work-returns-list .list-item").filter({hasText:"Keep the author's completed manual and diagnostic work."});
      assert.equal(await row.count(),1,"Read the same original return decision");
      await row.getByRole("button",{name:"Read retained decisions",exact:true}).click();await idle(page);
      const full=await page.locator("#work-return-read").textContent();
      assert.ok(full.includes(returnItemId)&&full.includes(input.returned.sha256));
      const currentStatus=await client.request("workspace.status");let decision=null;
      for await(const page of client.pages("returns.list",{expectedRevision:currentStatus.revision,limit:100}))
        for(const item of page.items)if(item.packageSha256===input.returned.sha256&&item.note?.startsWith("Keep the author's completed")) {
          assert.equal(decision,null,"The original package was reviewed once");decision=await client.request("return.read",{expectedRevision:currentStatus.revision,returnId:item.id});
        }
      assert.ok(decision?.id);state.returnId=decision.id;state.returnDecisionSha256=decision.sha256;await save();
      return {returnId:decision.id,sha256:decision.sha256,operationId:returnReceipt.operationId};
    });
    const register=await step("work_register_prepare",()=>command(page,"work_register_prepare","delivery.prepare",async()=>{
      await nav(page,"exports");await page.locator("#report-kind").selectOption("work-register");await page.locator("#report-format").selectOption("csv");
      await page.locator('#report-form button[type="submit"]').click();
    }));
    for(const field of ["sourceId","editionId","role"])assert.equal(Object.hasOwn(state.commands.work_register_prepare.args,field),false,"Work register is not a source-filtered asset report");
    await step("work_register_download",async()=>{
      await recover(page,"work_register_prepare");
      await page.locator("#operation-details").getByRole("button",{name:"Open prepared delivery",exact:true}).click();await idle(page);
      return originalDownload(page,page.locator("#delivery-result").getByRole("button",{name:"Download complete file",exact:true}),"work-register.csv",register);
    });
    const workspace=await step("workspace_prepare",()=>command(page,"workspace_prepare","delivery.prepare",async()=>{
      await nav(page,"exports");await page.locator("#prepare-workspace-delivery").click();
    }));
    await step("workspace_download",async()=>{
      await recover(page,"workspace_prepare");
      await page.locator("#operation-details").getByRole("button",{name:"Open prepared delivery",exact:true}).click();await idle(page);
      return originalDownload(page,page.locator("#delivery-result").getByRole("button",{name:"Download complete file",exact:true}),"complete-corrective-workspace.zip",workspace);
    });
    await step("responsive_review",async()=>{
      await page.setViewportSize({width:1280,height:900});await openWork(page,itemId);await screenshot(page,"verified-work-desktop.png");
      await page.setViewportSize({width:390,height:844});await openWork(page,returnItemId);await screenshot(page,"returned-work-mobile.png");
      const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
      assert.ok(dimensions.scroll<=dimensions.width+1,"The complete work view fits the mobile viewport");
      await page.setViewportSize({width:1280,height:900});return dimensions;
    });
    await step("closed_browser_reopen",async()=>{
      await closeBrowser();await launch();page=await newPage("author");
      for(const id of [itemId,state.browserDiagnosticItemId,returnItemId,manualItemId,diagnosticItemId])await openWork(page,id);
      await nav(page,"operations");
      for(const name of ["evidence_lost_reply","return_apply","workspace_prepare"]) {
        const original=state.commands[name],row=page.locator("#local-operations-body tr").filter({hasText:original.operationId});
        assert.equal(await row.count(),1);assert.ok((await row.textContent()).includes("completed"));
        await readOperation(original.operationId);
      }
      await preserveNativeItems();await verifyRetainedFiles();
      await openWork(page,itemId);assert.match(await page.locator("#work-detail-summary").textContent(),/verified/);
      await page.setViewportSize({width:390,height:844});await screenshot(page,"reopened-work-mobile.png");
      return {workspaceId,instanceId,originalRequestIds:Object.values(state.commands).map(x=>x.operationId)};
    });
    await preserveNativeItems();await verifyRetainedFiles();
    if(pageErrors.length)throw new Error("The operator reported browser errors: "+JSON.stringify(pageErrors));
    result={schema:SCHEMA,state:"COMPLETE",inputSha256,workspaceId,instanceId,
      browserItemId:itemId,browserDiagnosticItemId:state.browserDiagnosticItemId,returnedItemId:returnItemId,
      manualItemId,diagnosticItemId,returnId:state.returnId,returnDecisionSha256:state.returnDecisionSha256,
      originalRequestIds:Object.values(state.commands).map(x=>x.operationId),lostReplyOperationId:state.commands.evidence_lost_reply.operationId,
      peerOperationId:state.commands.peer_assignment.operationId,sourceEditions:state.sourceEditions,
      files:clone(state.files),steps:Object.keys(state.steps),journalPath,completedAt:null};
    state.phase="OPERATING_WORK_COMPLETE";await save();
    }
  } catch(error) {primary=error;}
  finally {
    const cleanup=[];
    try {await Promise.all([...routeTasks]);}catch(error){cleanup.push(error);}
    try {await closeBrowser();}catch(error){cleanup.push(error);}
    process.off("SIGINT",signalHandler);process.off("SIGTERM",signalHandler);
    if(routeErrors.length)cleanup.push(...routeErrors);
    if(interrupted && !primary)primary=interrupted;
    if(cleanup.length)primary=primary?new AggregateError([primary,...cleanup],"The original browser operation and cleanup failed"):new AggregateError(cleanup,"The original browser cleanup failed");
    if(primary) {
      state.phase="INCOMPLETE";state.error=errorValue(primary);
      state.errors=primary instanceof AggregateError?primary.errors.map(errorValue):[errorValue(primary)];
      try {await save();await atomicWrite(resultPath,json({schema:SCHEMA,state:"INCOMPLETE",workspaceId,inputSha256,journalPath,errors:state.errors}));}
      catch(error){primary=new AggregateError([primary,error],"Preserve the original browser failure and checkpoint failure");}
    } else if(result) {
      result.completedAt ||= new Date().toISOString();state.phase="COMPLETE";state.result=result;delete state.error;delete state.errors;
      try {await save();await atomicWrite(resultPath,json(result));}
      catch(error){primary=error;}
    }
  }
  if(primary)throw primary;
  return clone(result);
}
