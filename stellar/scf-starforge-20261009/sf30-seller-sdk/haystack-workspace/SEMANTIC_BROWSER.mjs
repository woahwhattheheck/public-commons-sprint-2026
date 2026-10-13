#!/usr/bin/env node
// MIT. Complete staff/browser continuation over the one original semantic workspace.
import assert from "node:assert/strict";
import { promises as fs, createReadStream } from "node:fs";
import { dirname, basename, join, resolve, relative, isAbsolute } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { HaystackClient } from "./client.mjs";
import { actions } from "./catalog.mjs";
import { MerchantHaystackWorkspaces, readHaystackWorkspaceConfiguration, haystackWorkspaceTools } from "./merchant.mjs";
import { atomicWrite, createOnlyFile } from "./files.mjs";
import { verifyBundle } from "./portable.mjs";
import { canonicalJson, stringifyJson } from "./json-codec.mjs";

const OPERATION="SCF-HAYSTACK-POINT-MODELLING-B3909-20261012";
const INPUT_SCHEMA="commons.haystack.semantic-browser-input.v1";
const JOURNAL_SCHEMA="commons.haystack.semantic-browser-journal.v1";
const RESULT_SCHEMA="commons.haystack.semantic-browser-result.v1";
const ROOT=dirname(fileURLToPath(import.meta.url));
const MUTATIONS=new Set(actions.filter(row=>row.writes).map(row=>row.action));
const originalSource="https://project-haystack.org/example/download/charlie.json";
const derivedReference=originalSource+"#derived-eight-row-point-list-tsv";
const stamp=()=>new Date().toISOString();
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const asBytes=value=>Buffer.from(stringifyJson(value,2)+"\n");
const same=(left,right,message)=>assert.equal(canonicalJson(left),canonicalJson(right),message);
const outcome=value=>{const copy=structuredClone(value);delete copy.replayed;return copy;};
const errorData=error=>({name:error?.name||"Error",message:error?.message||String(error),code:error?.code||null,status:error?.status||null});
const pause=ms=>new Promise(resolveDone=>setTimeout(resolveDone,ms));
function safeName(value){return String(value).replace(/[^a-zA-Z0-9_.-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,130)||"artifact";}
async function hashFile(path){
  const h=createHash("sha256");let bytes=0;const before=await fs.stat(path);
  assert(before.isFile(),"Select a complete regular file: "+path);
  for await(const part of createReadStream(path)){h.update(part);bytes+=part.length;}
  const after=await fs.stat(path);
  assert(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,"The selected file changed while it was read.");
  return{bytes,sha256:h.digest("hex")};
}
async function readJson(path){return JSON.parse(await fs.readFile(path,"utf8"));}
async function exists(path){try{await fs.lstat(path);return true;}catch(error){if(error.code==="ENOENT")return false;throw error;}}
async function until(check,message,timeout=120000){
  const end=Date.now()+timeout;let last;
  while(Date.now()<end){try{const value=await check();if(value)return value;}catch(error){last=error;}await pause(100);}
  throw new Error(message+(last?": "+last.message:""));
}

export async function runSemanticBrowser(input){
  assert(input&&input.schema===INPUT_SCHEMA&&input.operationId===OPERATION,"Select the original complete point-modelling browser input.");
  const I=structuredClone(input),url=new URL(I.url);
  assert(url.protocol==="http:"&&url.hostname==="127.0.0.1"&&url.pathname==="/"&&!url.search&&!url.hash&&!url.username&&!url.password&&url.port,"Select the original retained loopback origin.");
  for(const name of["workspaceId","instanceId","modelId","sourceId","intakeId","returnModelId","sourceEntityId","validationId"])assert(typeof I[name]==="string"&&I[name],"Missing original "+name+".");
  for(const name of["outputRoot","playwrightModule","executablePath","intakeFile","browserIntakeFile","returnFile"])assert(typeof I[name]==="string"&&isAbsolute(I[name]),"Use the complete absolute "+name+".");
  assert(typeof I.token==="string"&&!/[\r\n\0]/.test(I.token),"Use the original single-line token.");
  assert.equal(I.expectedEntities,624);assert.equal(I.expectedSourceRows,1248);
  const outputRoot=resolve(I.outputRoot);await fs.mkdir(outputRoot,{recursive:true,mode:0o700});
  const owned=await fs.lstat(outputRoot);
  assert(owned.isDirectory()&&!owned.isSymbolicLink()&&(!process.getuid||owned.uid===process.getuid())&&(owned.mode&0o077)===0,"Use an owned private browser operation directory.");
  const sourcePins={};
  for(const key of["intakeFile","browserIntakeFile","returnFile"])sourcePins[key]={name:basename(I[key]),...await hashFile(I[key])};
  const binding={operationId:OPERATION,origin:url.origin,workspaceId:I.workspaceId,modelId:I.modelId,sourceId:I.sourceId,intakeId:I.intakeId,
    returnModelId:I.returnModelId,sourceEntityId:I.sourceEntityId,validationId:I.validationId,expectedEntities:I.expectedEntities,expectedSourceRows:I.expectedSourceRows,sourcePins};
  const inputSha256=sha(Buffer.from(canonicalJson(binding))),journalPath=join(outputRoot,"semantic-browser-journal.json");
  let J=await exists(journalPath)?await readJson(journalPath):null;
  if(J){assert.equal(J.schema,JOURNAL_SCHEMA);assert.equal(J.inputSha256,inputSha256,"This retained browser operation selects different original inputs.");same(J.binding,binding);}
  else{J={schema:JOURNAL_SCHEMA,operationId:OPERATION,inputSha256,binding,startedAt:stamp(),state:"PREPARED",tabId:randomUUID(),peerTabId:randomUUID(),
    invocations:[],stages:{},requests:{},files:{},faults:{},failures:[],runtime:null};await atomicWrite(journalPath,asBytes(J));}
  let saving=Promise.resolve(),activeStage=null,lastStage=null,context=null,browser=null,mainPage=null,peerPage=null,merchant=null,identity=null;
  const routeTasks=new Set(),routeErrors=[],pageErrors=[];
  async function persist(){const bytes=asBytes(J);const work=saving.then(()=>atomicWrite(journalPath,bytes));saving=work.catch(()=>{});return work;}
  async function artifact(label,extension,body){
    const bytes=Buffer.from(body),hash=sha(bytes),name=join("artifacts",safeName(label)+"-"+hash.slice(0,20)+"."+safeName(extension));
    const path=join(outputRoot,name);await fs.mkdir(dirname(path),{recursive:true,mode:0o700});await createOnlyFile(path,bytes);
    const receipt={path:name.replaceAll("\\","/"),bytes:bytes.length,sha256:hash};
    J.files[receipt.path]=receipt;await persist();return receipt;
  }
  async function jsonArtifact(label,value){return artifact(label,"json",asBytes(value));}
  async function verified(receipt){
    assert(receipt&&typeof receipt.path==="string"&&!isAbsolute(receipt.path)&&!receipt.path.split(/[\\/]/).includes(".."),"A retained artifact path changed.");
    const path=join(outputRoot,receipt.path),pin=await hashFile(path);same(pin,{bytes:receipt.bytes,sha256:receipt.sha256});return fs.readFile(path);
  }
  async function verifyAllFiles(){for(const receipt of Object.values(J.files))await verified(receipt);}
  if(J.state==="COMPLETE"){
    await verifyAllFiles();const raw=await fs.readFile(join(outputRoot,"semantic-browser-result.json"));assert.equal(sha(raw),J.resultSha256,"The retained complete result changed.");
    const result=JSON.parse(raw);assert.equal(result.schema,RESULT_SCHEMA);assert.equal(result.operationId,OPERATION);assert.equal(result.workspaceId,I.workspaceId);
    assert.equal(result.inputSha256,inputSha256);assert.equal(result.completed,true);return result;
  }
  J.invocations.push({startedAt:stamp(),instanceId:I.instanceId,sourcePaths:{intakeFile:I.intakeFile,browserIntakeFile:I.browserIntakeFile,returnFile:I.returnFile},node:process.version});
  J.state="RUNNING";await persist();
  const client=new HaystackClient({url:url.origin,token:I.token,workspaceId:I.workspaceId,instanceId:I.instanceId});
  const status=()=>client.request("workspace.status",{});
  async function currentModel(id=I.modelId,versionId){const current=await status();return client.request("semantic.model.read",{expectedRevision:current.revision,modelId:id,...(versionId?{versionId}:{})});}
  async function step(name,work){
    const previous=J.stages[name];if(previous?.state==="COMPLETE")return structuredClone(previous.result);
    J.stages[name]??={state:"PREPARED",startedAt:stamp(),requestId:null,plan:null};activeStage=name;lastStage=name;
    await persist();process.stdout.write(stringifyJson({event:"SEMANTIC_BROWSER_STAGE",operationId:OPERATION,stage:name,at:stamp()})+"\n");
    try{const result=await work(J.stages[name]);assert(!routeErrors.length,"The original browser request trace failed: "+routeErrors.map(e=>e.message).join("; "));
      J.stages[name].state="COMPLETE";J.stages[name].result=result;J.stages[name].completedAt=stamp();await persist();return structuredClone(result);
    }finally{activeStage=null;}
  }
  async function draft(page){return page.evaluate(async({workspaceId,tabId})=>{
    const {dbRead}=await import("/semantic-browser-state.mjs");return dbRead("drafts","semantic:"+workspaceId+":"+tabId);
  },{workspaceId:I.workspaceId,tabId:page===peerPage?J.peerTabId:J.tabId});}
  async function operations(page){return page.evaluate(async workspaceId=>{
    const {semanticOperations}=await import("/semantic-browser-state.mjs");return semanticOperations(workspaceId);
  },I.workspaceId);}
  async function draftSettled(page,predicate,message="The complete draft was not retained."){
    return until(async()=>{const saved=await draft(page);return saved&&predicate(saved)?saved:null;},message);
  }
  async function idle(page,timeout=180000){
    await page.waitForFunction(()=>document.body.dataset.busy==="false",null,{timeout});
    assert.equal(await page.locator("#connection-state").innerText(),"Workspace open","The original modelling page is not connected.");
  }
  async function ready(page){
    await page.waitForSelector("#connection-state");
    await page.waitForFunction(()=>document.body.dataset.busy==="false",null,{timeout:180000});
    if(await page.locator("#connection-state").innerText()!=="Workspace open"){
      await page.locator("#connect-open").click();await page.locator("#connect-workspace").fill(I.workspaceId);
      await page.locator("#connect-token").fill(I.token);await page.locator("#connect-form").evaluate(form=>form.requestSubmit());await idle(page);
    }
    await page.waitForFunction(()=>document.querySelector("#revision")?.textContent.startsWith("Revision ")&&document.querySelector("#model-count")?.textContent.includes(" models"));
    const actual=await page.evaluate(async()=>{const saved=sessionStorage.getItem("commons.haystack.semantic.workspace");return{saved,origin:location.origin};});
    assert.equal(actual.saved,I.workspaceId);assert.equal(actual.origin,url.origin);
  }
  async function closeRetainedEditorDialog(page){
    for(const kind of["entity","relation","dictionary"]){
      const dialog=page.locator("#"+kind+"-dialog");
      if(await dialog.evaluate(node=>node.open)){
        await page.locator("#"+kind+"-cancel").click();
        await draftSettled(page,value=>!value.dialog,"The original editor dialog did not close durably.");
      }
    }
  }
  async function changeView(page,name){await page.locator('[data-view="'+name+'"]').click();await page.waitForSelector("#view-"+name+":not([hidden])");}
  async function refresh(page){await page.locator("#refresh").click();await idle(page);}
  async function openModel(page,modelId){
    await idle(page);await changeView(page,"model");await page.locator("#model-select").selectOption(modelId);await page.locator("#model-open").click();await idle(page);
    await page.waitForFunction(id=>document.querySelector("#model-status")?.textContent.includes(id),modelId);
  }
  function watchPage(page,tabId){
    page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(90000);
    page.on("pageerror",error=>pageErrors.push({at:stamp(),tabId,...errorData(error)}));
    page.on("dialog",dialog=>dialog.accept().catch(error=>routeErrors.push(error)));
  }
  async function preparePage(page,tabId){
    watchPage(page,tabId);await page.addInitScript(({origin,tab,workspace})=>{
      if(location.origin===origin){sessionStorage.setItem("commons.haystack.operator.tab",tab);sessionStorage.setItem("commons.haystack.semantic.workspace",workspace);}
    },{origin:url.origin,tab:tabId,workspace:I.workspaceId});
    await page.goto(url.origin+"/semantic.html");await ready(page);return page;
  }
  async function trace(route){
    const request=route.request();let envelope;
    try{envelope=JSON.parse(request.postData()||"null");}catch{return route.continue();}
    if(!envelope||!MUTATIONS.has(envelope.action))return route.continue();
    assert(activeStage,"A modelling mutation was dispatched outside its retained stage.");
    assert.equal(new URL(request.url()).origin,url.origin);
    assert.equal(request.headers()["x-haystack-workspace"],I.workspaceId);
    const action=envelope.action,args=envelope.args,id=args?.operationId;assert(typeof id==="string"&&id);
    const stage=J.stages[activeStage],body=asBytes(envelope),hash=sha(body);
    if(stage.expectedAction)assert.equal(action,stage.expectedAction);
    if(stage.requestId)assert.equal(stage.requestId,id,"A new request replaced the retained original stage.");
    else{stage.requestId=id;await persist();}
    let record=J.requests[id];
    if(record){assert.equal(record.payloadSha256,hash,"The original request input changed.");assert.equal(record.stage,activeStage);}
    else{
      const file=await artifact("request-"+id,"json",body);
      record=J.requests[id]={operationId:id,workspaceId:I.workspaceId,action,stage:activeStage,payloadSha256:hash,request:file,state:"PREPARED",attempts:[]};
      await persist();
    }
    const attempt={at:stamp(),instanceId:I.instanceId,state:"DISPATCHING"};record.attempts.push(attempt);await persist();
    let response;
    try{
      response=await route.fetch({timeout:600000,maxRedirects:0,maxRetries:0});
      const bytes=await response.body(),file=await artifact("response-"+id,"json",bytes);
      attempt.status=response.status();attempt.response=file;attempt.state=response.ok()?"RETURNED":"REJECTED";attempt.finishedAt=stamp();
      record.state=response.ok()?"RETURNED":"REJECTED";record.response=file;record.httpStatus=response.status();await persist();
      if(J.faults[activeStage]?.state==="ARMED"&&response.ok()){
        J.faults[activeStage]={state:"ACCEPTED_RESPONSE_RETAINED_THEN_DROPPED",operationId:id,response:file,at:stamp()};await persist();
        await route.abort("failed");return;
      }
      await route.fulfill({response,body:bytes});
    }catch(error){
      attempt.state=attempt.response?attempt.state:"OUTCOME_UNKNOWN";attempt.error=errorData(error);record.error=errorData(error);await persist();
      await route.abort("failed").catch(()=>{});throw error;
    }finally{if(response)await response.dispose().catch(()=>{});}
  }
  async function startBrowser(){
    const runtimeRequire=createRequire(import.meta.url),playwright=runtimeRequire(I.playwrightModule);
    assert(playwright.chromium?.launchPersistentContext,"Use the original installed Playwright module.");
    context=await playwright.chromium.launchPersistentContext(join(outputRoot,"browser-profile"),{
      executablePath:I.executablePath,headless:true,viewport:{width:1365,height:900},acceptDownloads:true,
      args:["--no-sandbox","--disable-dev-shm-usage"],locale:"en-US",timezoneId:"UTC"
    });
    browser=context.browser();
    let moduleDirectory=(await fs.stat(I.playwrightModule)).isDirectory()?I.playwrightModule:dirname(I.playwrightModule),playwrightVersion=null;
    for(;;){
      const packageFile=join(moduleDirectory,"package.json");
      if(await exists(packageFile)){const selected=await readJson(packageFile);if(["playwright","playwright-core"].includes(selected.name)&&typeof selected.version==="string"){playwrightVersion=selected.version;break;}}
      const parent=dirname(moduleDirectory);assert.notEqual(parent,moduleDirectory,"The selected Playwright package metadata is missing.");moduleDirectory=parent;
    }
    J.runtime={node:process.version,playwright:playwrightVersion,
      chromium:browser?.version()||null,executablePath:I.executablePath,...await hashFile(I.executablePath)};
    await persist();
    await context.route(url.origin+"/api/action",route=>{
      const task=trace(route);routeTasks.add(task);task.catch(error=>routeErrors.push(error)).finally(()=>routeTasks.delete(task));return task;
    });
    const pages=context.pages();mainPage=pages[0]||await context.newPage();
    for(const page of pages.slice(1))await page.close();
    await preparePage(mainPage,J.tabId);
  }
  async function closeBrowser(){
    const failures=[];
    if(context){const original=context;try{await original.close();if(context===original){context=null;mainPage=null;peerPage=null;}}catch(error){failures.push(error);}}
    if(browser){const original=browser;try{if(original.isConnected())await original.close();if(browser===original)browser=null;}catch(error){failures.push(error);}}
    if(routeTasks.size)await Promise.allSettled([...routeTasks]);
    if(failures.length)throw new AggregateError(failures,"The original modelling browser did not close completely.");
  }
  async function requestEnvelope(stage){
    assert(stage.requestId&&J.requests[stage.requestId],"The original request has not been retained.");
    const record=J.requests[stage.requestId],raw=await verified(record.request);assert.equal(sha(raw),record.payloadSha256);
    const value=JSON.parse(raw);assert.equal(value.args.operationId,stage.requestId);return value;
  }
  async function recover(page,stage,{allowRejected=false}={}){
    const envelope=await requestEnvelope(stage),record=J.requests[stage.requestId];let receipt;
    if(allowRejected&&record.state==="REJECTED")return{rejected:true,status:record.httpStatus,response:JSON.parse(await verified(record.response)),operationId:stage.requestId};
    try{receipt=await client.request("operation.read",{operationId:stage.requestId});}
    catch(error){if(error.status!==404)throw error;receipt=await client.request(envelope.action,envelope.args);}
    assert.equal(receipt.operationId,stage.requestId);assert.equal(receipt.workspaceId,I.workspaceId);
    record.outcome=await jsonArtifact("original-outcome-"+stage.requestId,receipt);record.state="CONFIRMED";await persist();
    if(page){
      await idle(page);await changeView(page,"history");await page.locator("#operations-refresh").click();await idle(page);
      const card=page.locator("#operations > .compact").filter({has:page.locator("p.row-source",{hasText:stage.requestId})});
      if(await card.count()===1){await card.getByRole("button",{name:"Read original receipt",exact:true}).click();await idle(page);
        const rows=await operations(page);assert.equal(rows.find(row=>row.operationId===stage.requestId)?.state,"completed");}
      else await refresh(page);
    }
    return receipt;
  }
  async function mutate(page,stage,action,submit,{drop=false,allowRejected=false}={}){
    stage.expectedAction=action;await persist();
    if(stage.requestId)return recover(page,stage,{allowRejected});
    if(drop){J.faults[activeStage]??={state:"ARMED",at:stamp()};await persist();}
    await submit();
    await until(()=>stage.requestId&&J.requests[stage.requestId]?.response,"The original saved request did not return its complete response.",600000);
    await idle(page,600000);
    const record=J.requests[stage.requestId];
    if(record.httpStatus>=400){
      assert(allowRejected,"The original modelling operation failed: "+Buffer.from(await verified(record.response)).toString("utf8"));
      return{rejected:true,status:record.httpStatus,response:JSON.parse(await verified(record.response)),operationId:stage.requestId};
    }
    if(drop){
      assert.equal(J.faults[activeStage]?.state,"ACCEPTED_RESPONSE_RETAINED_THEN_DROPPED");
      const before=await operations(page),saved=before.find(row=>row.operationId===stage.requestId);
      assert(saved&&saved.action===action);same(saved.args,(await requestEnvelope(stage)).args);
      await page.reload();await ready(page);
      const retained=(await operations(page)).find(row=>row.operationId===stage.requestId);
      assert(retained);same(retained.args,saved.args,"Reload changed the original pending request.");
    }
    return recover(page,stage);
  }
  async function download(page,label,click,expected){
    const [completed]=await Promise.all([page.waitForEvent("download",{timeout:180000}),Promise.resolve().then(click)]);
    const failure=await completed.failure();assert.equal(failure,null,"The complete browser download failed.");
    const path=await completed.path();assert(path,"The complete original download path is unavailable.");
    const bytes=await fs.readFile(path),actual={bytes:bytes.length,sha256:sha(bytes)};
    if(expected)same(actual,{bytes:expected.bytes,sha256:expected.sha256},"The browser download differs from its complete original file.");
    const file=await artifact(label,basename(completed.suggestedFilename()).split(".").at(-1)||"bin",bytes);
    return{...file,name:completed.suggestedFilename()};
  }
  async function screenshot(page,label){
    const image=await page.screenshot({fullPage:false});return artifact(label,"png",image);
  }
  async function jsonRanges(action,args){
    let offset=0,expected=null,total=null;const parts=[];let count=0;
    for(;;){
      const part=await merchant.call("merchant_haystack_semantic_read",{workspace:"semantic",action,args,offset,length:524288,...(expected?{expectedResponseSha256:expected}:{})});
      assert.equal(part.workspaceId,I.workspaceId);assert.equal(part.action,action);assert.equal(part.offset,offset);
      if(expected===null){expected=part.sha256;total=part.totalBytes;}
      assert.equal(part.sha256,expected);assert.equal(part.totalBytes,total);
      const bytes=Buffer.from(part.base64,"base64");assert.equal(bytes.length,part.bytes);assert.equal(sha(bytes),part.chunkSha256);
      assert.equal(part.nextOffset,offset+bytes.length);assert.equal(part.complete,part.nextOffset===total);parts.push(bytes);count++;offset=part.nextOffset;
      if(part.complete)break;assert(bytes.length>0);
    }
    const raw=Buffer.concat(parts);assert.equal(raw.length,total);assert.equal(sha(raw),expected);return{value:JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw)),bytes:raw.length,sha256:expected,ranges:count};
  }
  async function openMerchant(){
    const tokenFile=I.token?join(outputRoot,"merchant-token"):null;if(tokenFile)await atomicWrite(tokenFile,Buffer.from(I.token+"\n"));
    const config={schema:"stellar-forge.haystack-workspace-host.v1",workspaces:{semantic:{
      label:"Original Charlie point-modelling workspace",workspaceId:I.workspaceId,connectionFile:join(identity.directory,"connection.json"),
      ...(tokenFile?{tokenFile}:{}),timeoutMs:600000,maxInputBytes:33554432,maxReturnBytes:201326592,inputs:{
        "point-original":{kind:"point-list",format:"csv",path:I.intakeFile,name:basename(I.intakeFile),sha256:sourcePins.intakeFile.sha256,sourceReference:originalSource+"#derived-point-list-csv"},
        "point-browser":{kind:"point-list",format:"tsv",delimiter:"\t",path:I.browserIntakeFile,name:basename(I.browserIntakeFile),sha256:sourcePins.browserIntakeFile.sha256,sourceReference:derivedReference},
        "contractor-return":{kind:"workspace-return",path:I.returnFile,name:basename(I.returnFile),sha256:sourcePins.returnFile.sha256}
      }
    }}};
    const configPath=join(outputRoot,"merchant-host.json");await atomicWrite(configPath,asBytes(config));
    merchant=new MerchantHaystackWorkspaces({haystackWorkspaces:await readHaystackWorkspaceConfiguration(configPath)});
  }
  let result=null,primary=null;
  try{
    identity=await client.connect();assert.equal(identity.workspaceId,I.workspaceId);assert.equal(identity.instanceId,I.instanceId);
    await openMerchant();await startBrowser();

    const seed=await step("original-source-model-and-native-report",async()=>{
      const current=await status(),model=await client.request("semantic.model.read",{expectedRevision:current.revision,modelId:I.modelId});
      assert.equal(model.model.id,I.modelId);assert.equal(model.version.content.entities.length,I.expectedEntities);assert.equal(model.assessment.sourceRows,I.expectedSourceRows);
      const entity=model.version.content.entities.find(row=>row.id===I.sourceEntityId);assert(entity&&entity.sourceRefs.length>=1);
      const records=[];let metadata;
      for await(const page of client.pages("semantic.intake.read",{expectedRevision:current.revision,intakeId:I.intakeId,limit:250})){
        metadata??=page.intake;records.push(...page.items);
      }
      assert.equal(records.length,624);assert.equal(metadata.rowCount,624);assert.equal(metadata.assetId,sourcePins.intakeFile.sha256);
      const validation=await client.request("semantic.validation.read",{expectedRevision:current.revision,validationId:I.validationId});
      assert.equal(validation.validation.modelId,I.modelId);assert(validation.validation.outputs.length>=3);
      const files=[await jsonArtifact("original-complete-model",model),await jsonArtifact("original-point-list-all-rows",{intake:metadata,items:records}),await jsonArtifact("original-native-validation",validation)];
      return{modelId:I.modelId,versionId:model.version.id,entityId:entity.id,sourceReferences:entity.sourceRefs,
        entities:model.assessment.entities,sourceRows:model.assessment.sourceRows,intakeColumns:metadata.columns,intakeRows:records.length,
        model:files[0],intake:files[1],validation:files[2],files};
    });
    await step("managed-original-catalog-and-complete-model-ranges",async()=>{
      const list=await merchant.call("merchant_haystack_workspaces",{});assert.equal(list.workspaces.length,1);assert.equal(list.workspaces[0].workspaceId,I.workspaceId);
      const selected=await merchant.call("merchant_haystack_connection",{workspace:"semantic"});assert.equal(selected.selected.instanceId,I.instanceId);
      for(const [alias,pin] of[["point-original",sourcePins.intakeFile],["point-browser",sourcePins.browserIntakeFile],["contractor-return",sourcePins.returnFile]]){
        const metadata=await merchant.call("merchant_haystack_input",{workspace:"semantic",input:alias,expectedSha256:pin.sha256});assert.equal(metadata.bytes,pin.bytes);
      }
      const tools=haystackWorkspaceTools((name,description,properties,required,annotations)=>({name,description,properties,required,annotations}));
      for(const definition of actions.filter(row=>row.action.startsWith("semantic.")))assert(tools.some(row=>row.name==="merchant_"+definition.name));
      for(const name of["merchant_haystack_semantic_read","merchant_haystack_semantic_intake_import_file","merchant_haystack_semantic_return_preview_file","merchant_haystack_semantic_return_apply_file"])assert(tools.some(row=>row.name===name));
      const current=await status(),model=await jsonRanges("semantic.model.read",{expectedRevision:current.revision,modelId:I.modelId});
      same(model.value,await client.request("semantic.model.read",{expectedRevision:current.revision,modelId:I.modelId}));
      const catalogue=await jsonRanges("semantic.catalog",{});assert(catalogue.value.runtime?.standard||catalogue.value.standard);
      return{workspaceId:I.workspaceId,semanticActions:actions.filter(row=>row.action.startsWith("semantic.")).length,toolCount:tools.length,
        modelRanges:model.ranges,catalogueRanges:catalogue.ranges,files:[await jsonArtifact("complete-merchant-tools",tools),
          await jsonArtifact("complete-merchant-model",model.value),await jsonArtifact("complete-merchant-standard",catalogue.value)],
        managedApplications:{sourceIntegration:"original provider, related semantic link and common environmentFile",nativeReceiving:"PENDING_ORIGINAL_READY_RUNTIME_INPUT"}};
    });
    await step("inspect-every-original-point-row-in-browser",async()=>{
      await changeView(mainPage,"intake");
      const original=JSON.parse(await verified(seed.intake)),card=mainPage.locator("#intakes > .compact").filter({has:mainPage.locator("label",{hasText:sourcePins.intakeFile.name+" · 624 rows"})});
      assert.equal(await card.count(),1);await card.getByRole("button",{name:"Inspect source rows",exact:true}).click();await idle(mainPage);
      const rows=[];
      for(;;){
        const pageRows=await mainPage.locator("#intake-detail tbody tr").evaluateAll(items=>items.map(row=>[...row.querySelectorAll("td")].map(cell=>cell.textContent)));
        assert(pageRows.length>0&&pageRows.length<=50);rows.push(...pageRows);
        const next=mainPage.locator("#intake-detail").getByRole("button",{name:"Next source rows",exact:true});
        if(await next.count()===0)break;await next.click();await idle(mainPage);
      }
      assert.equal(rows.length,624);
      same(rows,original.items.map(row=>[row.rowIndex+" / "+row.physicalEndLine,...row.cells]),"The browser omitted or changed original point cells.");
      const headings=await mainPage.locator("#intake-detail thead th").allTextContents();
      same(headings,["Row / end line",...original.intake.columns.map((name,index)=>"Column "+(index+1)+" · "+(name||"(blank)"))]);
      const downloadReceipt=await download(mainPage,"original-point-list",()=>card.getByRole("button",{name:"Download original",exact:true}).click(),sourcePins.intakeFile);
      return{rows:rows.length,headings,files:[downloadReceipt,await jsonArtifact("browser-original-point-cells",{headings,rows}),await screenshot(mainPage,"desktop-original-intake")]};
    });
    const browserIntake=await step("retain-derived-tsv-through-browser-reload",async stage=>{
      const receipt=await mutate(mainPage,stage,"semantic.intake.import",async()=>{
        await changeView(mainPage,"intake");await mainPage.locator("#source-file").setInputFiles(I.browserIntakeFile);await idle(mainPage);
        await mainPage.locator("#source-format").selectOption("tsv");await mainPage.locator("#source-delimiter").selectOption("tab");await mainPage.locator("#source-url").fill(derivedReference);
        const saved=await draftSettled(mainPage,value=>value.sourceFile?.sha256===sourcePins.browserIntakeFile.sha256&&value.forms["source-format"]==="tsv"&&value.forms["source-delimiter"]==="tab"&&value.forms["source-url"]===derivedReference);
        stage.sourceDraft=await jsonArtifact("retained-browser-intake-before-reload",{name:saved.sourceFile.name,bytes:saved.sourceFile.bytes,sha256:saved.sourceFile.sha256,forms:saved.forms});await persist();
        await mainPage.reload();await ready(mainPage);await changeView(mainPage,"intake");
        const reopened=await draft(mainPage);assert.equal(reopened.sourceFile.sha256,saved.sourceFile.sha256);assert.equal(reopened.sourceFile.base64,saved.sourceFile.base64);
        assert((await mainPage.locator("#source-file-status").innerText()).includes(sourcePins.browserIntakeFile.name));
        assert.equal(await mainPage.locator("#source-file").evaluate(node=>node.files.length),0,"The reloaded browser should use the original retained file, not a new file selection.");
        await mainPage.locator("#intake-form").getByRole("button",{name:"Retain original source",exact:true}).click();
      });
      assert(receipt.intake?.id);assert.equal(receipt.intake.rowCount,8);assert.equal(receipt.intake.assetId,sourcePins.browserIntakeFile.sha256);
      const envelope=await requestEnvelope(stage);assert.equal(envelope.args.format,"tsv");assert.equal(envelope.args.delimiter,"\t");assert.equal(sha(Buffer.from(envelope.args.base64,"base64")),sourcePins.browserIntakeFile.sha256);
      const replay=await merchant.call("merchant_haystack_semantic_intake_import_file",{workspace:"semantic",input:"point-browser",expectedSha256:sourcePins.browserIntakeFile.sha256,
        operationId:envelope.args.operationId,expectedRevision:envelope.args.expectedRevision,sourceUrl:envelope.args.sourceUrl});
      assert.equal(replay.replayed,true);same(outcome(replay),outcome(receipt));
      return{intakeId:receipt.intake.id,operationId:receipt.operationId,revision:receipt.revision,rows:receipt.intake.rowCount,sourceDraft:stage.sourceDraft,
        files:[await jsonArtifact("browser-intake-original-replay",replay)]};
    });
    await step("map-the-retained-eight-row-intake",async stage=>{
      const current=await status(),intake=await client.request("semantic.intake.read",{expectedRevision:current.revision,intakeId:browserIntake.intakeId,limit:50});
      assert.equal(intake.total,8);assert.equal(intake.intake.columns.length,8);
      stage.plan??={title:"Charlie eight-row point-list mapping",namespace:"https://example.org/charlie/point-list-review/",naming:{template:"{nativeId}",case:"preserve",separator:"_",description:"Names retain the original mapped identifiers; changes are reviewed explicitly."}};
      await persist();await refresh(mainPage);await changeView(mainPage,"intake");
      for(const checkbox of await mainPage.locator("#native-sources input[type=checkbox]").all())await checkbox.uncheck();
      for(const checkbox of await mainPage.locator("#intakes input[type=checkbox]").all())await checkbox.uncheck();
      const card=mainPage.locator("#intakes > .compact").filter({has:mainPage.locator("label",{hasText:sourcePins.browserIntakeFile.name+" · 8 rows"})});assert.equal(await card.count(),1);await card.locator("input[type=checkbox]").check();
      await mainPage.locator("#mapping-title").fill(stage.plan.title);await mainPage.locator("#mapping-namespace").fill(stage.plan.namespace);
      await mainPage.locator("#naming-template").fill(stage.plan.naming.template);await mainPage.locator("#naming-case").selectOption(stage.plan.naming.case);
      await mainPage.locator("#naming-separator").fill(stage.plan.naming.separator);await mainPage.locator("#naming-description").fill(stage.plan.naming.description);
      const mapping=mainPage.locator("#mapping-sources .mapping-row").filter({has:mainPage.locator("h4",{hasText:sourcePins.browserIntakeFile.name})});assert.equal(await mapping.count(),1);
      const selects=mapping.locator("select");assert.equal(await selects.count(),7);
      for(const [index,value]of["0","2","4","5","6","7","point"].entries())await selects.nth(index).selectOption(value);
      await mainPage.locator("#mapping-form").getByRole("button",{name:"Preview complete model",exact:true}).click();await idle(mainPage);
      const saved=await draftSettled(mainPage,value=>value.draft?.modelId===null&&value.draft?.content?.title===stage.plan.title&&value.draft?.content?.entities?.length===8);
      assert.equal(saved.draft.assessment.sourceRows,8);same(saved.draft.selection,{nativeSourceIds:[],intakeIds:[browserIntake.intakeId]});
      const mappingContent=saved.draft.content.mappings.find(row=>row.intakeId===browserIntake.intakeId);assert(mappingContent);assert.equal(mappingContent.nameColumn,2);
      return{contextId:saved.draft.contextId,entities:8,sourceRows:8,files:[await jsonArtifact("complete-eight-row-preview",saved.draft),await screenshot(mainPage,"desktop-point-mapping-preview")]};
    });
    await step("retain-entity-dialog-and-dictionary-draft",async stage=>{
      const saved=await draft(mainPage);assert(saved.draft&&saved.draft.content.entities.length===8);
      stage.plan??={entityId:saved.draft.content.entities[0].id,entityNote:"Reviewed this mapped identifier against its retained TSV row; no live field observation was made.",
        dictionaryId:"term:"+randomUUID(),dictionaryTerm:"reviewed point label",dictionaryIri:"https://example.org/charlie/point-list-review/reviewed-label",
        dictionaryDefinition:"The operator-reviewed display label for an entity whose original point-list row remains retained.",dictionaryNote:"Naming documentation for the retained mapping; it is not a Brick conformance claim."};
      await persist();await closeRetainedEditorDialog(mainPage);await changeView(mainPage,"model");await mainPage.locator("#entity-search").fill(stage.plan.entityId);
      const row=mainPage.locator("#entities tr").filter({has:mainPage.locator(".row-source",{hasText:stage.plan.entityId})});assert.equal(await row.count(),1);
      await row.getByRole("button",{name:"Edit",exact:true}).click();await idle(mainPage);
      await mainPage.locator("#entity-note").fill(stage.plan.entityNote);
      const originalRefs=saved.draft.content.entities.find(item=>item.id===stage.plan.entityId).sourceRefs;
      const dialog=await draftSettled(mainPage,value=>value.dialog?.kind==="entity"&&value.dialog?.fields["entity-note"]===stage.plan.entityNote);
      same(dialog.dialog.sourceRefs,originalRefs);await mainPage.reload();await ready(mainPage);
      assert(await mainPage.locator("#entity-dialog").evaluate(node=>node.open));assert.equal(await mainPage.locator("#entity-note").inputValue(),stage.plan.entityNote);
      const restored=await draft(mainPage);same(restored.dialog.sourceRefs,originalRefs);
      await mainPage.locator("#entity-form").getByRole("button",{name:"Keep changes in draft",exact:true}).click();await idle(mainPage);
      const currentDraft=await draft(mainPage),existingTerm=currentDraft.draft.content.dictionary.find(item=>item.id===stage.plan.dictionaryId);
      if(existingTerm){
        const cards=mainPage.locator("#dictionary > .compact").filter({has:mainPage.locator(".row-source",{hasText:existingTerm.iri})});let found=false;
        for(let index=0;index<await cards.count();index++){
          await cards.nth(index).getByRole("button",{name:"Edit",exact:true}).click();await idle(mainPage);
          if(await mainPage.locator("#dictionary-id").inputValue()===stage.plan.dictionaryId){found=true;break;}
          await mainPage.locator("#dictionary-cancel").click();
        }
        assert(found,"The retained original dictionary draft row was not found.");
      }else{await mainPage.locator("#dictionary-add").click();await idle(mainPage);}
      await mainPage.locator("#dictionary-id").fill(stage.plan.dictionaryId);
      await mainPage.locator("#dictionary-term").fill(stage.plan.dictionaryTerm);await mainPage.locator("#dictionary-iri").fill(stage.plan.dictionaryIri);
      await mainPage.locator("#dictionary-kind").selectOption("naming");await mainPage.locator("#dictionary-definition").fill(stage.plan.dictionaryDefinition);
      await mainPage.locator("#dictionary-source").fill(derivedReference);await mainPage.locator("#dictionary-note").fill(stage.plan.dictionaryNote);
      await mainPage.locator("#dictionary-form").getByRole("button",{name:"Keep term in draft",exact:true}).click();await idle(mainPage);
      await mainPage.locator("#model-assess").click();await idle(mainPage);
      const final=await draftSettled(mainPage,value=>value.draft?.content.dictionary.some(item=>item.id===stage.plan.dictionaryId)&&value.draft?.assessment?.entities===8);
      same(final.draft.content.entities.find(item=>item.id===stage.plan.entityId).sourceRefs,originalRefs);
      assert.equal(final.draft.content.entities.find(item=>item.id===stage.plan.entityId).note,stage.plan.entityNote);
      return{entityId:stage.plan.entityId,dictionaryId:stage.plan.dictionaryId,files:[await jsonArtifact("complete-retained-eight-row-draft",final.draft)]};
    });
    const deskModel=await step("save-complete-browser-mapping-model",async stage=>{
      const receipt=await mutate(mainPage,stage,"semantic.model.create",async()=>{
        await changeView(mainPage,"model");await mainPage.locator("#model-author").fill("Building point-list operator");
        await mainPage.locator("#model-note").fill("Save the complete reviewed eight-row TSV mapping with original row references and naming documentation.");
        await mainPage.locator("#model-save-form").getByRole("button",{name:"Save complete model version",exact:true}).click();
      });
      assert(receipt.model?.id&&receipt.version?.id);const saved=await currentModel(receipt.model.id,receipt.version.id);
      assert.equal(saved.version.content.entities.length,8);assert.equal(saved.assessment.sourceRows,8);
      assert(saved.version.content.entities.every(item=>item.sourceRefs.some(ref=>ref.kind==="intake"&&ref.sourceId===browserIntake.intakeId)));
      const envelope=await requestEnvelope(stage),replay=await merchant.call("merchant_haystack_semantic_model_create",{workspace:"semantic",...envelope.args});
      assert.equal(replay.replayed,true);same(outcome(replay),outcome(receipt));
      return{modelId:receipt.model.id,versionId:receipt.version.id,operationId:receipt.operationId,files:[await jsonArtifact("complete-browser-created-model",saved),await jsonArtifact("original-model-create-merchant-replay",replay)]};
    });

    const editedDraft=await step("main-model-source-linked-draft-and-reopen",async stage=>{
      const before=await currentModel();
      if(!stage.plan){
        const entity=before.version.content.entities.find(row=>row.id===I.sourceEntityId),relation=before.version.content.relations[0],dictionary=before.version.content.dictionary[0];assert(entity);
        stage.plan={baseHeadId:before.version.id,baseRevision:before.revision,notes:before.version.content.notes+"\n\nOperator desk review: preserve the complete original source mapping while reviewing contractor model changes.",
          entityId:entity.id,entityNote:entity.note+"\nChecked this entity's complete native and derived point-list references in the operator model.",
          relation:relation?{id:relation.id,note:relation.note+"\nReviewed against the relation's existing original source context."}:null,
          dictionary:dictionary?{id:dictionary.id,iri:dictionary.iri,term:dictionary.term,note:dictionary.note+"\nReviewed terminology retained with the complete source-linked model."}:null,
          before:await jsonArtifact("main-model-before-browser-draft",before)};
        await persist();
      }
      assert.equal(before.version.id,stage.plan.baseHeadId,"The original saved head advanced before its retained field edits were applied.");
      await closeRetainedEditorDialog(mainPage);await refresh(mainPage);await openModel(mainPage,I.modelId);assert((await draft(mainPage)).draft.baseHeadId===stage.plan.baseHeadId);
      await mainPage.locator("#model-notes").fill(stage.plan.notes);await mainPage.locator("#entity-search").fill(I.sourceEntityId);
      const entityRow=mainPage.locator("#entities tr").filter({has:mainPage.locator(".row-source",{hasText:I.sourceEntityId})});assert.equal(await entityRow.count(),1);
      await entityRow.getByRole("button",{name:"Edit",exact:true}).click();await idle(mainPage);
      await mainPage.locator("#entity-note").fill(stage.plan.entityNote);
      const retained=await draftSettled(mainPage,value=>value.dialog?.fields["entity-note"]===stage.plan.entityNote);
      same(retained.dialog.sourceRefs,seed.sourceReferences);await mainPage.reload();await ready(mainPage);
      assert(await mainPage.locator("#entity-dialog").evaluate(node=>node.open));assert.equal(await mainPage.locator("#entity-note").inputValue(),stage.plan.entityNote);
      await mainPage.locator("#entity-form").getByRole("button",{name:"Keep changes in draft",exact:true}).click();await idle(mainPage);
      if(stage.plan.relation){
        const original=JSON.parse(await verified(stage.plan.before)).version.content.relations.find(row=>row.id===stage.plan.relation.id);
        const cards=mainPage.locator("#relations > .compact").filter({has:mainPage.locator("strong",{hasText:original.subjectId+" → "+original.objectId})});
        const candidates=await cards.count();assert(candidates>=1);
        let selected=null;
        for(let index=0;index<candidates;index++){
          const card=cards.nth(index);await card.getByRole("button",{name:"Edit",exact:true}).click();await idle(mainPage);
          if(await mainPage.locator("#relation-id").inputValue()===stage.plan.relation.id){selected=card;break;}
          await mainPage.locator("#relation-cancel").click();
        }
        assert(selected,"The exact original relationship editor was not found.");
        assert.equal(await mainPage.locator("#relation-subject").inputValue(),original.subjectId);assert.equal(await mainPage.locator("#relation-object").inputValue(),original.objectId);
        assert.equal(await mainPage.locator("#relation-predicate").inputValue(),original.predicate);
        await mainPage.locator("#relation-note").fill(stage.plan.relation.note);await mainPage.locator("#relation-form").getByRole("button",{name:"Keep relationship in draft",exact:true}).click();await idle(mainPage);
      }
      if(stage.plan.dictionary){
        const cards=mainPage.locator("#dictionary > .compact").filter({has:mainPage.locator(".row-source",{hasText:stage.plan.dictionary.iri})});let found=false;
        for(let index=0;index<await cards.count();index++){
          await cards.nth(index).getByRole("button",{name:"Edit",exact:true}).click();await idle(mainPage);
          if(await mainPage.locator("#dictionary-id").inputValue()===stage.plan.dictionary.id){found=true;break;}await mainPage.locator("#dictionary-cancel").click();
        }
        assert(found,"The exact original dictionary row was not found.");
        await mainPage.locator("#dictionary-note").fill(stage.plan.dictionary.note);await mainPage.locator("#dictionary-form").getByRole("button",{name:"Keep term in draft",exact:true}).click();await idle(mainPage);
      }
      await mainPage.locator("#entity-search").fill("");await mainPage.locator("#model-assess").click();await idle(mainPage);
      const complete=await draftSettled(mainPage,value=>value.draft?.content.notes===stage.plan.notes&&value.draft?.assessment?.sourceRows===I.expectedSourceRows);
      const original=JSON.parse(await verified(stage.plan.before));
      same(complete.draft.content.entities.map(row=>({id:row.id,sourceRefs:row.sourceRefs,observation:row.observation})),
        original.version.content.entities.map(row=>({id:row.id,sourceRefs:row.sourceRefs,observation:row.observation})));
      assert.equal((await currentModel()).version.id,stage.plan.baseHeadId,"Unsaved browser changes changed the saved head.");
      const artifactReceipt=await jsonArtifact("complete-main-model-unsaved-draft",complete.draft);
      await mainPage.reload();await ready(mainPage);const reopened=await draft(mainPage);same(reopened.draft.content,complete.draft.content);
      assert.equal(reopened.draft.baseHeadId,stage.plan.baseHeadId);assert.equal(reopened.draft.baseRevision,stage.plan.baseRevision);
      return{baseHeadId:stage.plan.baseHeadId,baseRevision:stage.plan.baseRevision,entityId:I.sourceEntityId,relationId:stage.plan.relation?.id||null,dictionaryId:stage.plan.dictionary?.id||null,files:[artifactReceipt,await screenshot(mainPage,"desktop-retained-model-draft")]};
    });
    const firstSave=await step("saved-model-response-loss-and-original-receipt",async stage=>{
      const receipt=await mutate(mainPage,stage,"semantic.model.save",async()=>{
        await changeView(mainPage,"model");await mainPage.locator("#model-author").fill("Building modelling operator");
        await mainPage.locator("#model-note").fill("Retain the reviewed source, relationship and dictionary notes as one complete saved model version.");
        await mainPage.locator("#model-save-form").getByRole("button",{name:"Save complete model version",exact:true}).click();
      },{drop:true});
      assert.equal(receipt.model.id,I.modelId);assert.notEqual(receipt.version.id,editedDraft.baseHeadId);
      const envelope=await requestEnvelope(stage);assert.equal(envelope.args.expectedHeadId,editedDraft.baseHeadId);assert.equal(envelope.args.expectedRevision,editedDraft.baseRevision);
      const full=await currentModel(I.modelId,receipt.version.id);same(full.version.content,envelope.args.content);
      return{modelId:I.modelId,versionId:receipt.version.id,operationId:receipt.operationId,lostResponse:J.faults["saved-model-response-loss-and-original-receipt"],
        files:[await jsonArtifact("main-model-after-lost-response-recovery",full)]};
    });
    const retainedDraft=await step("retain-a-draft-before-the-peer-edits",async stage=>{
      await refresh(mainPage);await openModel(mainPage,I.modelId);
      const before=await currentModel();assert.equal(before.version.id,firstSave.versionId);
      stage.plan??={baseHeadId:before.version.id,baseRevision:before.revision,note:"Local operator intent: keep the source-linked mapping and add the reviewed handover context after comparing the peer edition.",
        notes:before.version.content.notes+"\n\nLocal operator intent: keep the source-linked mapping and add the reviewed handover context after comparing the peer edition."};
      await persist();await mainPage.locator("#model-notes").fill(stage.plan.notes);
      const saved=await draftSettled(mainPage,value=>value.draft?.content.notes===stage.plan.notes&&value.draft.baseHeadId===stage.plan.baseHeadId);
      await mainPage.reload();await ready(mainPage);const reopened=await draft(mainPage);same(reopened.draft.content,saved.draft.content);
      return{baseHeadId:stage.plan.baseHeadId,baseRevision:stage.plan.baseRevision,note:stage.plan.note,notes:stage.plan.notes,files:[await jsonArtifact("retained-local-draft-before-peer",saved.draft)]};
    });
    const peerSave=await step("peer-edits-the-same-original-model",async stage=>{
      if(!peerPage){peerPage=await context.newPage();await preparePage(peerPage,J.peerTabId);}
      const receipt=await mutate(peerPage,stage,"semantic.model.save",async()=>{
        await refresh(peerPage);await openModel(peerPage,I.modelId);
        const current=await currentModel();assert.equal(current.version.id,retainedDraft.baseHeadId);
        stage.plan??={notes:current.version.content.notes+"\n\nPeer reviewer note: retain the incoming contractor's independent source and model history for explicit owner review.",baseHeadId:current.version.id};
        await persist();await peerPage.locator("#model-notes").fill(stage.plan.notes);
        await peerPage.locator("#model-author").fill("Second building modelling reviewer");
        await peerPage.locator("#model-note").fill("Save this peer review against the same original model head while the other editor retains its own unsaved draft.");
        await peerPage.locator("#model-save-form").getByRole("button",{name:"Save complete model version",exact:true}).click();
      });
      assert.equal(receipt.model.id,I.modelId);assert.notEqual(receipt.version.id,retainedDraft.baseHeadId);
      return{modelId:I.modelId,versionId:receipt.version.id,operationId:receipt.operationId,notes:stage.plan.notes,
        files:[await jsonArtifact("complete-peer-model-edition",await currentModel(I.modelId,receipt.version.id))]};
    });
    const stale=await step("compare-and-reject-the-retained-stale-draft",async stage=>{
      await refresh(mainPage);await changeView(mainPage,"model");
      const saved=await draft(mainPage);assert.equal(saved.draft.baseHeadId,retainedDraft.baseHeadId);assert.equal(saved.draft.content.notes,retainedDraft.notes);
      assert((await mainPage.locator("#draft-state").innerText()).includes("advanced"));
      await mainPage.locator("#model-recompare").click();await idle(mainPage);
      const currentText=await mainPage.locator("#model-comparison").innerText();assert(currentText.includes("head advanced"));
      const comparisons=await mainPage.locator("#model-comparison pre").allTextContents();assert.equal(comparisons.length,2);
      assert.equal(JSON.parse(comparisons[0]).notes,peerSave.notes);assert.equal(JSON.parse(comparisons[1]).notes,retainedDraft.notes);
      assert(await mainPage.locator("#model-rebase").isDisabled(),"A changed model head must not silently adopt the current revision.");
      const rejected=await mutate(mainPage,stage,"semantic.model.save",async()=>{
        await mainPage.locator("#model-author").fill("Building modelling operator");
        await mainPage.locator("#model-note").fill("Attempt the still-retained original base once; inspect its actual conflict before resolving the edited fields.");
        await mainPage.locator("#model-save-form").getByRole("button",{name:"Save complete model version",exact:true}).click();
      },{allowRejected:true});
      assert.equal(rejected.rejected,true);assert.equal(rejected.status,409);assert.equal((await currentModel()).version.id,peerSave.versionId);
      assert.equal((await draft(mainPage)).draft.content.notes,retainedDraft.notes);
      return{operationId:rejected.operationId,oldHeadId:retainedDraft.baseHeadId,currentHeadId:peerSave.versionId,rejected:true,status:409,
        files:[await jsonArtifact("complete-current-versus-retained-model-comparison",{current:JSON.parse(comparisons[0]),retained:JSON.parse(comparisons[1]),rejection:rejected}),await screenshot(mainPage,"desktop-stale-model-comparison")]};
    });
    const resolved=await step("explicitly-apply-the-retained-note-to-the-peer-head",async stage=>{
      const receipt=await mutate(mainPage,stage,"semantic.model.save",async()=>{
        await changeView(mainPage,"model");await mainPage.locator("#model-recompare").click();await idle(mainPage);
        const current=await currentModel();assert.equal(current.version.id,peerSave.versionId);
        stage.plan??={baseHeadId:current.version.id,selectedNotes:current.version.content.notes+"\n\n"+retainedDraft.note};
        await persist();await mainPage.locator("#model-reset").click();await idle(mainPage);
        assert.equal(await mainPage.locator("#model-notes").inputValue(),peerSave.notes);
        await mainPage.locator("#model-notes").fill(stage.plan.selectedNotes);
        await mainPage.locator("#model-author").fill("Building modelling operator");
        await mainPage.locator("#model-note").fill("After reading both full contents, preserve the peer edition and apply only the retained local handover note.");
        await mainPage.locator("#model-save-form").getByRole("button",{name:"Save complete model version",exact:true}).click();
      });
      const full=await currentModel(I.modelId,receipt.version.id);assert.equal(full.version.content.notes,stage.plan.selectedNotes);
      const peer=await currentModel(I.modelId,peerSave.versionId);
      for(const key of["title","namespace","naming","mappings","entities","relations","dictionary"])same(full.version.content[key],peer.version.content[key],"Explicit note resolution changed another model field.");
      const envelope=await requestEnvelope(stage);assert.equal(envelope.args.expectedHeadId,peerSave.versionId);
      return{modelId:I.modelId,versionId:receipt.version.id,operationId:receipt.operationId,previousHeadId:peerSave.versionId,staleRequestId:stale.operationId,
        files:[await jsonArtifact("complete-explicit-model-resolution",full)]};
    });
    const nativeValidation=await step("validate-the-exact-reviewed-head-in-browser",async stage=>{
      const receipt=await mutate(mainPage,stage,"semantic.validate",async()=>{
        await refresh(mainPage);await openModel(mainPage,I.modelId);assert.equal((await draft(mainPage)).draft.baseHeadId,resolved.versionId);
        await changeView(mainPage,"validation");await mainPage.locator("#validation-author").fill("Building native-standard reviewer");
        await mainPage.locator("#validation-form").getByRole("button",{name:"Validate exact saved version",exact:true}).click();
      });
      assert(receipt.validation?.id);const current=await status(),full=await client.request("semantic.validation.read",{expectedRevision:current.revision,validationId:receipt.validation.id});
      assert.equal(full.validation.modelId,I.modelId);assert.equal(full.validation.versionId,resolved.versionId);assert.equal(typeof full.validation.conforms,"boolean");
      assert(full.validation.outputs.length>=3);assert.equal(new Set(full.validation.outputs.map(file=>file.name)).size,full.validation.outputs.length);
      return{validationId:full.validation.id,versionId:full.validation.versionId,operationId:receipt.operationId,conforms:full.validation.conforms,
        outputs:full.validation.outputs,files:[await jsonArtifact("complete-current-native-validation",full)]};
    });
    await step("read-the-standard-and-download-every-native-output",async()=>{
      await refresh(mainPage);await openModel(mainPage,I.modelId);await changeView(mainPage,"validation");
      const catalogue=await client.request("semantic.catalog",{});assert(catalogue.classes.length&&catalogue.properties.length);
      assert((await mainPage.locator("#standard").innerText()).includes("actual local ontology"));
      const term=catalogue.classes.find(row=>row.label)?.label||catalogue.classes[0].iri;
      await mainPage.locator("#term-search").fill(term);await mainPage.locator("#term-kind").selectOption("classes");
      await mainPage.locator("#term-search-form").getByRole("button").click();await idle(mainPage);assert((await mainPage.locator("#terms").innerText()).includes("matching terms"));
      const cards=mainPage.locator("#validations > .compact").filter({has:mainPage.locator("strong",{hasText:"Building native-standard reviewer"})});assert.equal(await cards.count(),1);
      await cards.getByRole("button",{name:"Read full native report",exact:true}).click();await idle(mainPage);
      const detail=JSON.parse(await mainPage.locator("#validation-result pre").innerText());assert.equal(detail.id,nativeValidation.validationId);same(detail.outputs,nativeValidation.outputs);
      const files=[];
      for(const output of detail.outputs)files.push(await download(mainPage,"native-"+output.name,()=>mainPage.locator("#validation-result").getByRole("button",{name:"Download "+output.name,exact:true}).click(),output));
      return{validationId:detail.id,conforms:detail.conforms,completeNativeFiles:files.length,files:[...files,await screenshot(mainPage,"desktop-full-native-report")]};
    });
    const reviewed=await step("save-the-human-review-for-the-exact-model",async stage=>{
      const receipt=await mutate(mainPage,stage,"semantic.model.review",async()=>{
        await refresh(mainPage);await openModel(mainPage,I.modelId);
        await mainPage.locator("#review-author").fill("Owner modelling reviewer");await mainPage.locator("#review-decision").selectOption(nativeValidation.conforms?"ready":"changes");
        await mainPage.locator("#review-note").fill(nativeValidation.conforms?
          "Reviewed the complete source-linked model and the actual saved native report. The conformance result does not assert live equipment operation.":
          "Reviewed the complete source-linked model and the actual native violations. Retain the original report and resolve the reported modelling issues before relying on conformance.");
        await mainPage.locator("#model-review-form").getByRole("button",{name:"Save exact-version review",exact:true}).click();
      });
      assert.equal(receipt.review.versionId,resolved.versionId);assert.equal(receipt.review.validationId,nativeValidation.validationId);
      return{reviewId:receipt.review.id,modelId:I.modelId,versionId:receipt.review.versionId,validationId:receipt.review.validationId,operationId:receipt.operationId,
        decision:receipt.review.decision,files:[await jsonArtifact("complete-owner-model-review",receipt.review)]};
    });

    const returnPreview=await step("review-every-returned-model-and-retain-choices",async stage=>{
      await refresh(mainPage);await openModel(mainPage,I.modelId);await changeView(mainPage,"handover");
      const current=await status(),bytes=await fs.readFile(I.returnFile);
      assert.equal(sha(bytes),sourcePins.returnFile.sha256);
      const preview=await client.request("semantic.return.preview",{expectedRevision:current.revision,base64:bytes.toString("base64")});
      assert.equal(preview.workspaceId,I.workspaceId);assert.equal(preview.packageSha256,sourcePins.returnFile.sha256);
      assert(preview.models.some(row=>row.modelId===I.modelId));assert(preview.models.some(row=>row.modelId===I.returnModelId));
      assert.equal(preview.models.find(row=>row.modelId===I.modelId).localHeadId,resolved.versionId);
      assert.equal(preview.models.find(row=>row.modelId===I.returnModelId).localHeadId,null);
      stage.plan??={revision:preview.revision,packageSha256:preview.packageSha256,decisions:preview.models.map(row=>({modelId:row.modelId,decision:row.modelId===I.returnModelId?"adopt":"keep",
        expectedLocalHeadId:row.localHeadId,expectedIncomingHeadId:row.incomingHeadId})),preview:await jsonArtifact("complete-browser-return-preview",preview)};
      same(stage.plan.decisions.map(({decision,...row})=>row),preview.models.map(row=>({modelId:row.modelId,expectedLocalHeadId:row.localHeadId,expectedIncomingHeadId:row.incomingHeadId})));
      assert.equal(stage.plan.revision,preview.revision,"The reviewed return base changed; retain this complete comparison before a new staff decision.");
      await persist();await mainPage.locator("#return-file").setInputFiles(I.returnFile);await idle(mainPage);
      await mainPage.locator("#return-preview-form").getByRole("button",{name:"Compare every returned model",exact:true}).click();await idle(mainPage);
      const readRetained=()=>mainPage.evaluate(async({workspaceId,tabId})=>{
        const {dbRead}=await import("/semantic-browser-state.mjs"),saved=await dbRead("drafts","semantic:"+workspaceId+":"+tabId);
        return{preview:saved?.returnPreview,decisions:saved?.returnDecisions,file:saved?.returnFile?{name:saved.returnFile.name,bytes:saved.returnFile.bytes,sha256:saved.returnFile.sha256}:null};
      },{workspaceId:I.workspaceId,tabId:J.tabId});
      same((await readRetained()).preview,preview);
      const cards=mainPage.locator("#return-models > .card");assert.equal(await cards.count(),preview.models.length);
      for(const [index,row] of preview.models.entries()){
        assert.equal(await cards.nth(index).locator("h4").innerText(),row.title);
        const changes=JSON.parse(await cards.nth(index).locator("pre").innerText());same(changes,row.changes);
        await cards.nth(index).locator("select").selectOption(stage.plan.decisions[index].decision);
      }
      await mainPage.locator("#return-author").fill("Original building model owner");
      await mainPage.locator("#return-note").fill("Keep the complete current main model after the peer resolution; adopt the explicitly selected new contractor detail model and retain every incoming source, version and native report.");
      await until(async()=>{const saved=await readRetained();return saved&&stage.plan.decisions.every(row=>saved.decisions[row.modelId]===row.decision);},"The complete returned-model choices were not retained.");
      const before=await readRetained();await mainPage.reload();await ready(mainPage);await changeView(mainPage,"handover");same(await readRetained(),before,"Reload changed the selected contractor file or model decisions.");
      assert.equal(await mainPage.locator("#return-file").evaluate(node=>node.files.length),0);
      for(const [index,row]of preview.models.entries())assert.equal(await mainPage.locator("#return-models > .card").nth(index).locator("select").inputValue(),stage.plan.decisions[index].decision);
      // Read the same complete original comparison through the host-pinned alias.
      let offset=0,expected=null,total=null;const ranges=[];
      for(;;){
        const part=await merchant.call("merchant_haystack_semantic_return_preview_file",{workspace:"semantic",input:"contractor-return",expectedSha256:sourcePins.returnFile.sha256,
          expectedRevision:preview.revision,offset,length:524288,...(expected?{expectedResponseSha256:expected}:{})});
        assert.equal(part.workspaceId,I.workspaceId);assert.equal(part.offset,offset);if(expected===null){expected=part.sha256;total=part.totalBytes;}
        assert.equal(part.sha256,expected);assert.equal(part.totalBytes,total);const chunk=Buffer.from(part.base64,"base64");assert.equal(chunk.length,part.bytes);assert.equal(sha(chunk),part.chunkSha256);
        assert.equal(part.nextOffset,offset+chunk.length);ranges.push(chunk);offset=part.nextOffset;if(part.complete){assert.equal(offset,total);break;}assert(chunk.length>0);
      }
      const full=Buffer.concat(ranges);assert.equal(sha(full),expected);same(JSON.parse(full),preview);
      return{revision:preview.revision,packageSha256:preview.packageSha256,models:preview.models.length,decisions:stage.plan.decisions,merchantRanges:ranges.length,
        files:[stage.plan.preview,await jsonArtifact("retained-return-choices-after-reload",before),await screenshot(mainPage,"desktop-complete-return-choices")]};
    });
    const adopted=await step("apply-the-original-reviewed-keep-and-adopt-decisions",async stage=>{
      const receipt=await mutate(mainPage,stage,"semantic.return.apply",async()=>{
        await changeView(mainPage,"handover");await mainPage.locator("#return-apply-form").getByRole("button",{name:"Apply reviewed model decisions",exact:true}).click();
      });
      const envelope=await requestEnvelope(stage);assert.equal(envelope.args.expectedRevision,returnPreview.revision);
      same(envelope.args.decisions,returnPreview.decisions);assert.equal(sha(Buffer.from(envelope.args.base64,"base64")),returnPreview.packageSha256);
      assert(receipt.return?.id);const main=await currentModel(),returned=await currentModel(I.returnModelId);
      assert.equal(main.version.id,resolved.versionId,"Keeping the main model replaced its current local head.");
      assert.equal(returned.model.id,I.returnModelId);assert.equal(returned.version.id,returnPreview.decisions.find(row=>row.modelId===I.returnModelId).expectedIncomingHeadId);
      const current=await status(),full=await client.request("semantic.return.read",{expectedRevision:current.revision,returnId:receipt.return.id});
      assert(full.return.incomingModels.some(row=>row.id===I.returnModelId));assert.equal(full.return.packageSha256,returnPreview.packageSha256);
      const {base64,...nativeArgs}=envelope.args;
      const replay=await merchant.call("merchant_haystack_semantic_return_apply_file",{workspace:"semantic",input:"contractor-return",expectedSha256:returnPreview.packageSha256,...nativeArgs});
      assert.equal(replay.replayed,true);same(outcome(replay),outcome(receipt));assert.equal((await currentModel()).version.id,resolved.versionId);
      return{returnId:receipt.return.id,operationId:receipt.operationId,mainModelId:I.modelId,keptHeadId:resolved.versionId,adoptedModelId:I.returnModelId,adoptedHeadId:returned.version.id,
        files:[await jsonArtifact("complete-owner-return-decision",full),await jsonArtifact("complete-adopted-contractor-model",returned),await jsonArtifact("same-return-merchant-replay",replay)]};
    });
    const reports={};
    for(const [kind,formats]of[["semantic-report",["json","csv","html"]],["semantic-dictionary",["json","csv"]]]){
      for(const format of formats){
        const name="download-"+kind+"-"+format;
        reports[kind+"-"+format]=await step(name,async stage=>{
          const receipt=await mutate(mainPage,stage,"delivery.prepare",async()=>{
            await refresh(mainPage);await openModel(mainPage,I.modelId);await changeView(mainPage,"handover");
            await mainPage.locator("#report-kind").selectOption(kind);await mainPage.locator("#report-format").selectOption(format);
            await mainPage.locator("#model-report-form").getByRole("button",{name:"Prepare model report",exact:true}).click();
          });
          assert.equal(receipt.kind,kind);assert.equal(typeof receipt.sha256,"string");await changeView(mainPage,"handover");
          const file=await download(mainPage,name,()=>mainPage.locator("#delivery").getByRole("button",{name:"Download complete file",exact:true}).click(),receipt);
          const bytes=await verified(file);
          if(format==="json"){
            const report=JSON.parse(bytes);assert.equal(report.workspaceId,I.workspaceId);
            if(kind==="semantic-report"){assert.equal(report.model.model.id,I.modelId);assert.equal(report.model.version.id,resolved.versionId);assert.equal(report.model.version.content.entities.length,624);}
            else{assert.equal(report.modelId,I.modelId);assert.equal(report.versionId,resolved.versionId);}
          }
          return{operationId:receipt.operationId,name:receipt.name,kind,format,file,files:[file,await jsonArtifact(name+"-original-receipt",receipt)]};
        });
      }
    }
    const workspaceDelivery=await step("download-the-complete-editable-workspace",async stage=>{
      const receipt=await mutate(mainPage,stage,"delivery.prepare",async()=>{
        await changeView(mainPage,"handover");await mainPage.locator("#workspace-export").click();
      });
      assert.equal(receipt.kind,"workspace");await changeView(mainPage,"handover");
      const file=await download(mainPage,"complete-editable-point-model-workspace",()=>mainPage.locator("#delivery").getByRole("button",{name:"Download complete file",exact:true}).click(),receipt);
      const verifiedPackage=verifyBundle(await verified(file));assert.equal(verifiedPackage.state.workspaceId,I.workspaceId);
      const semantic=verifiedPackage.state.semantics;
      assert(semantic.models.some(row=>row.id===I.modelId&&row.headId===resolved.versionId));assert(semantic.models.some(row=>row.id===I.returnModelId&&row.headId===adopted.adoptedHeadId));
      assert(semantic.models.some(row=>row.id===deskModel.modelId));assert(semantic.intakes.some(row=>row.id===browserIntake.intakeId&&row.assetId===sourcePins.browserIntakeFile.sha256));
      assert(semantic.validations.some(row=>row.id===nativeValidation.validationId));assert(semantic.reviews.some(row=>row.id===reviewed.reviewId));assert(semantic.returns.some(row=>row.id===adopted.returnId));
      assert(verifiedPackage.application.has("SEMANTIC_BROWSER.mjs"));assert(verifiedPackage.application.has("SEMANTIC_RECEIVING.mjs"));
      return{operationId:receipt.operationId,file,workspaceId:I.workspaceId,revision:verifiedPackage.state.revision,
        models:semantic.models.length,intakes:semantic.intakes.length,versions:semantic.versions.length,validations:semantic.validations.length,reviews:semantic.reviews.length,returns:semantic.returns.length,
        portableApplicationFiles:verifiedPackage.application.size,files:[file,await jsonArtifact("complete-workspace-original-delivery-receipt",receipt)]};
    });
    await step("complete-model-pages-and-immutable-history",async()=>{
      await refresh(mainPage);await openModel(mainPage,I.modelId);await mainPage.locator("#entity-search").fill("");
      const ids=[];for(;;){
        const rows=await mainPage.locator("#entities tr .row-source").allTextContents();assert(rows.length>0&&rows.length<=100);ids.push(...rows);
        if(await mainPage.locator("#entities-next").isDisabled())break;await mainPage.locator("#entities-next").click();
      }
      const current=await currentModel();same(ids,current.version.content.entities.map(row=>row.id));assert.equal(ids.length,624);
      await changeView(mainPage,"history");
      const versionIds=await mainPage.locator("#model-history > .compact .row-source").allTextContents();
      for(const versionId of[firstSave.versionId,peerSave.versionId,resolved.versionId])assert(versionIds.includes(versionId));
      const first=mainPage.locator("#model-history > .compact").filter({has:mainPage.locator(".row-source",{hasText:firstSave.versionId})});assert.equal(await first.count(),1);
      await first.getByRole("button",{name:"Read this version",exact:true}).click();await idle(mainPage);
      const original=JSON.parse(await mainPage.locator("#history-detail pre").innerText());assert.equal(original.version.id,firstSave.versionId);
      await changeView(mainPage,"handover");
      const decision=mainPage.locator("#returns > .compact").filter({has:mainPage.locator("strong",{hasText:"Original building model owner"})});assert.equal(await decision.count(),1);
      await decision.getByRole("button",{name:"Read complete return decision",exact:true}).click();await idle(mainPage);
      const returned=JSON.parse(await mainPage.locator("#history-detail pre").innerText());assert.equal(returned.return.id,adopted.returnId);
      return{entities:ids.length,versionIds,returnId:adopted.returnId,files:[await jsonArtifact("browser-complete-model-page-identities",ids),await jsonArtifact("browser-original-version-history-read",original),await jsonArtifact("browser-full-return-history-read",returned)]};
    });
    await step("desktop-and-390-pixel-complete-operator-views",async()=>{
      const files=[],views=[];
      for(const viewport of[{width:1365,height:900},{width:390,height:844}]){
        await mainPage.setViewportSize(viewport);
        for(const name of["intake","model","validation","handover","history"]){
          await changeView(mainPage,name);await mainPage.locator("#main").scrollIntoViewIfNeeded();
          const geometry=await mainPage.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,view:document.querySelector(".view:not([hidden])")?.id,
            heading:document.querySelector(".view:not([hidden]) h2")?.textContent,connected:document.querySelector("#connection-state")?.textContent}));
          assert.equal(geometry.width,viewport.width);assert.equal(geometry.view,"view-"+name);assert.equal(geometry.connected,"Workspace open");
          assert(geometry.documentWidth<=viewport.width+2,"The "+name+" view overflows the "+viewport.width+"px viewport.");
          const text=await mainPage.locator("#view-"+name).innerText();
          files.push(await artifact(viewport.width+"-"+name+"-visible-content","txt",Buffer.from(text)));
          files.push(await screenshot(mainPage,viewport.width+"-"+name));views.push({...geometry,viewport});
        }
      }
      await mainPage.setViewportSize({width:1365,height:900});
      return{views,files};
    });
    await step("same-profile-browser-close-and-reopen",async()=>{
      const current=await currentModel(),snapshot={headId:current.version.id,workspaceId:I.workspaceId,modelIds:[I.modelId,I.returnModelId,deskModel.modelId],
        originalRequests:Object.values(J.requests).map(row=>({operationId:row.operationId,action:row.action,payloadSha256:row.payloadSha256,state:row.state}))};
      await closeBrowser();assert.equal(context,null);assert.equal(browser,null);await startBrowser();await refresh(mainPage);await openModel(mainPage,I.modelId);
      const reopened=await currentModel();assert.equal(reopened.version.id,snapshot.headId);assert.equal(reopened.workspaceId,snapshot.workspaceId);
      const options=await mainPage.locator("#model-select option").evaluateAll(rows=>rows.map(row=>row.value));for(const id of snapshot.modelIds)assert(options.includes(id));
      const browserRequests=await mainPage.evaluate(async workspaceId=>{
        const {semanticOperations}=await import("/semantic-browser-state.mjs");return(await semanticOperations(workspaceId)).map(row=>({operationId:row.operationId,action:row.action,state:row.state,argsShaSource:row.args.operationId}));
      },I.workspaceId);
      for(const request of snapshot.originalRequests){
        const original=browserRequests.find(row=>row.operationId===request.operationId);assert(original,"The original browser request was not retained across process reopen.");
        assert.equal(original.action,request.action);assert.equal(original.argsShaSource,request.operationId);
        assert.equal(original.state,request.operationId===stale.operationId?"not completed":"completed");
      }
      await changeView(mainPage,"history");await mainPage.locator("#operations-refresh").click();await idle(mainPage);
      return{workspaceId:I.workspaceId,headId:snapshot.headId,requestCount:snapshot.originalRequests.length,profileReopened:true,
        files:[await jsonArtifact("complete-browser-profile-reopen",{snapshot,browserRequests}),await screenshot(mainPage,"desktop-reopened-original-requests")]};
    });
    const final=await currentModel();assert.equal(final.version.id,resolved.versionId);assert.equal(final.version.content.entities.length,624);assert.equal(final.assessment.sourceRows,1248);
    assert(!pageErrors.length,"The original modelling page raised an uncaught error: "+pageErrors.map(row=>row.message).join("; "));
    assert(!routeErrors.length,"A complete original browser request was not retained.");
    result={schema:RESULT_SCHEMA,completed:true,operationId:OPERATION,inputSha256,workspaceId:I.workspaceId,origin:url.origin,startedAt:J.startedAt,completedAt:null,
      originalModelId:I.modelId,originalSourceId:I.sourceId,originalIntakeId:I.intakeId,sourcePins,
      browserIntakeId:browserIntake.intakeId,browserModelId:deskModel.modelId,currentHeadId:resolved.versionId,
      originalInterruptedRequestId:firstSave.operationId,peerRequestId:peerSave.operationId,staleRequestId:stale.operationId,resolutionRequestId:resolved.operationId,
      validationId:nativeValidation.validationId,nativeConforms:nativeValidation.conforms,reviewId:reviewed.reviewId,
      returnId:adopted.returnId,returnRequestId:adopted.operationId,adoptedModelId:I.returnModelId,adoptedHeadId:adopted.adoptedHeadId,
      reports,workspaceDelivery,managedApplications:{sourceJoined:true,nativeReceiving:"PENDING_ORIGINAL_READY_RUNTIME_INPUT"},
      runtime:J.runtime,stages:J.stages,requestCount:Object.keys(J.requests).length,outputRoot,files:Object.values(J.files),pageErrors};
  }catch(error){primary=error;J.failures.push({at:stamp(),stage:activeStage||lastStage,...errorData(error)});}
  const cleanup=[];
  if(merchant){try{await merchant.close();merchant=null;}catch(error){cleanup.push(error);}}
  try{await closeBrowser();}catch(error){cleanup.push(error);}
  await saving;
  if(primary||cleanup.length){
    J.state="INTERRUPTED";J.cleanupFailures=cleanup.map(errorData);await persist().catch(error=>cleanup.push(error));
    const failures=[...(primary?[primary]:[]),...cleanup];
    throw new AggregateError(failures,"The original semantic browser operation is incomplete: "+failures.map(error=>error.message).join("; "));
  }
  assert(result);await verifyAllFiles();result.completedAt=stamp();result.cleanup={browserClosed:true,borrowedMerchantClosed:true,originalServerOwnedByParent:true};
  const resultPath=join(outputRoot,"semantic-browser-result.json");
  await atomicWrite(resultPath,asBytes(result));J.state="COMPLETE";J.completedAt=result.completedAt;J.resultPath=resultPath;J.resultSha256=sha(asBytes(result));await persist();
  process.stdout.write(stringifyJson({event:"SEMANTIC_BROWSER_COMPLETE",operationId:OPERATION,workspaceId:I.workspaceId,resultPath,files:result.files.length})+"\n");
  return result;
}
