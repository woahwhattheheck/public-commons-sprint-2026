#!/usr/bin/env node
/**
 * Operate named-graph dataset editions through the original loopback application.
 * Requires existing Python dependencies, Playwright and Chromium. No install,
 * customer service, remote RDF source or replacement native preparation runs.
 * Private checkpoints and original downloads stay under
 * --operation. Resume with the same arguments after an interruption.
 */
import fs from "node:fs/promises";
import sync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {spawn} from "node:child_process";
import {fileURLToPath,pathToFileURL} from "node:url";

const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args={};
for(const arg of process.argv.slice(2)){
  const at=arg.indexOf("=");
  if(!arg.startsWith("--")||at<3)throw Error("Arguments use --name=value.");
  args[arg.slice(2,at)]=arg.slice(at+1);
}
if(!args.workspace||!args.operation||!args.playwright||!args.chromium||!args.inputs)
  throw Error("Use --workspace=/new/private/dataset-workspace --operation=/private/dataset-receiving --inputs=/exact/manifest.json --playwright=/existing/module --chromium=/existing/chromium [--python=python3].");
const workspace=path.resolve(args.workspace),operation=path.resolve(args.operation);
if(operation===workspace||operation.startsWith(workspace+path.sep))
  throw Error("Keep the UI operation outside the original workspace.");
const python=args.python||"python3";
const now=()=>new Date().toISOString();
const sha=data=>crypto.createHash("sha256").update(data).digest("hex");
const exists=p=>fs.stat(p).then(()=>true,()=>false);
const readJSON=async p=>JSON.parse(await fs.readFile(p,"utf8"));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function assert(ok,message){if(!ok)throw Error(message);}
function atomicJSON(file,value){
  const temp=file+".writing-"+process.pid;
  const descriptor=sync.openSync(temp,"w",0o600);
  try{sync.writeFileSync(descriptor,JSON.stringify(value,null,2)+"\n");sync.fsyncSync(descriptor);}
  finally{sync.closeSync(descriptor);}
  sync.renameSync(temp,file);
  const dir=sync.openSync(path.dirname(file),"r");
  try{sync.fsyncSync(dir);}finally{sync.closeSync(dir);}
}
async function command(executable,argv,options={}){
  const child=spawn(executable,argv,{stdio:["pipe","pipe","pipe"],...options});
  let out="",err="";
  child.stdout?.on("data",b=>out+=b.toString());
  child.stderr?.on("data",b=>err+=b.toString());
  if(options.input!==undefined)child.stdin.end(options.input);else child.stdin?.end();
  await new Promise((resolve,reject)=>{child.once("error",reject);child.once("exit",resolve);});
  if(child.exitCode!==0)throw Error("Original local command failed: "+err.slice(-1600));
  return out;
}
if(!await exists(path.join(operation,"DATASET-STATE.json"))&&await exists(path.join(workspace,"application.sqlite3")))
  throw Error("This new dataset operation must start in a new workspace, or resume its own saved operation.");
await fs.mkdir(workspace,{recursive:true,mode:0o700});
await fs.mkdir(operation,{recursive:true,mode:0o700});
await fs.chmod(operation,0o700);
for(const sub of ["downloads","screenshots","tmp"])await fs.mkdir(path.join(operation,sub),{recursive:true,mode:0o700});
// Linux/POSIX flock belongs to the open file description shared by this Node
// descriptor and child fd3. Holding the Node descriptor keeps the lock after
// the short Python helper exits. Process death releases it without stale locks.
const lease=await fs.open(path.join(operation,"ui.lock"),"a+",0o600);
try{
  await command(python,["-B","-c","import fcntl; fcntl.flock(3,fcntl.LOCK_EX|fcntl.LOCK_NB)"],
    {stdio:["ignore","pipe","pipe",lease.fd]});
}catch(error){await lease.close();throw Error("This UI operation already has an active owner: "+error.message);}
const stateFile=path.join(operation,"DATASET-STATE.json"),resultFile=path.join(operation,"DATASET-RESULT.json");
let state=await exists(stateFile)?await readJSON(stateFile):{
  schema:"commons-semantic-dataset-ui-receiving/1",operation_id:"semantic-dataset-ui-"+crypto.randomUUID(),
  workspace_path:workspace,created_at:now(),generation:0,steps:{},actions:{},events:[],downloads:[],views:[],errors:[]};
assert(state.workspace_path===workspace,"The checkpoint belongs to another original workspace.");
if(state.status==="complete"){console.log(JSON.stringify(await readJSON(resultFile)));await lease.close();process.exit(0);}
state.generation++;state.status="running";state.started_at=now();delete state.error;
const persist=()=>atomicJSON(stateFile,state);
const event=(type,detail={})=>{state.events.push({at:now(),type,...detail});persist();};
persist();
const imported=await import(pathToFileURL(path.resolve(args.playwright)).href);
const playwright=imported.chromium?imported:imported.default;
assert(playwright?.chromium,"The existing Playwright module must expose Chromium.");
let server=null,ready=null,activeRoot=null,browser=null,context=null,page=null,activeAction=null;
const thisErrors=[];
const HEADERS={"X-Semantic-Operator":"1"};
async function until(fn,label,ms=30000){
  const end=Date.now()+ms;let last;
  while(Date.now()<end){
    try{const value=await fn();if(value)return value;}catch(error){last=error;}
    await sleep(200);
  }
  throw Error(label+(last?": "+last.message:""));
}
async function getJSON(url){
  const response=await fetch(url,{headers:HEADERS,signal:AbortSignal.timeout(30000)});
  const body=await response.json();
  if(!response.ok)throw Error(body.error?.message||"Read HTTP "+response.status);
  return body;
}
const api=(suffix)=>getJSON(new URL(suffix,ready.url).href);
const fullState=()=>api("/api/state");
const row=(s,kind,id)=>s.records[kind].find(value=>value.id===id);
const reference=r=>({id:r.id,revision:r.revision});
function heads(s){return Object.values(s.records).flat().map(r=>({kind:r.kind,id:r.id,revision:r.revision,sha256:r.sha256}));}
function privacyFingerprint(payload){
  const clone=structuredClone(payload);
  if("passphrase" in clone)clone.passphrase="retained-private-recovery-passphrase";
  for(const key of ["data_base64","catalog_data_base64"])if(key in clone){clone[key+"_sha256"]=sha(Buffer.from(clone[key],"base64"));delete clone[key];}
  return sha(JSON.stringify(clone));
}
async function closeBrowser(){
  if(context){try{await context.close();}finally{context=null;page=null;}}
  if(browser){try{await browser.close();}finally{browser=null;}}
}
async function closeHost(){
  let browserError=null;
  try{await closeBrowser();}catch(error){browserError=error;}
  if(server){
    const child=server;server=null;
    if(child.exitCode===null&&child.signalCode===null)child.kill("SIGTERM");
    await until(()=>child.exitCode!==null||child.signalCode!==null,"Original host did not close",8000)
      .catch(async()=>{child.kill("SIGKILL");await until(()=>child.exitCode!==null||child.signalCode!==null,"Original host could not be reaped",5000);});
    event("host_closed",{pid:child.pid,exit_code:child.exitCode,signal:child.signalCode});
  }
  ready=null;activeRoot=null;
  if(browserError)throw browserError;
}
async function startHost(root,tag){
  root=path.resolve(root);
  if(server&&activeRoot===root)return;
  await closeHost();
  let buffer="",stderr="",opened=null,launchError=null;
  server=spawn(python,["-B",path.join(ROOT,"run.py"),"serve","--workspace",root,"--port","0","--parent-pid",String(process.pid)],
    {cwd:ROOT,env:{...process.env,PYTHONDONTWRITEBYTECODE:"1",TMPDIR:path.join(operation,"tmp"),SQLITE_TMPDIR:path.join(operation,"tmp")},stdio:["ignore","pipe","pipe"]});
  server.on("error",error=>launchError=error);
  server.stdout.on("data",chunk=>{
    buffer+=chunk.toString();const lines=buffer.split("\n");buffer=lines.pop();
    for(const line of lines){try{const data=JSON.parse(line);if(data.url)opened=data;}catch{/* Original logs remain separate. */}}
  });
  server.stderr.on("data",chunk=>stderr=(stderr+chunk.toString()).slice(-20000));
  await until(()=>{
    if(launchError)throw launchError;
    if(server.exitCode!==null||server.signalCode!==null)throw Error("Host ended before opening: "+stderr.slice(-1800));
    return opened;
  },"Existing semantic host did not open",45000);
  ready=opened;activeRoot=root;
  atomicJSON(path.join(operation,tag+"-host.json"),{...ready,pid:server.pid,workspace_path:root});
  event("host_opened",{tag,pid:server.pid,workspace_id:ready.workspace_id,workspace_path:root});
}
async function attachPage(p,tag){
  p.setDefaultTimeout(20000);
  p.on("dialog",async dialog=>{if(dialog.type()==="confirm"&&dialog.message().startsWith("Discard "))await dialog.accept();else{thisErrors.push({kind:"unexpected_dialog",message:dialog.message()});await dialog.dismiss();}});
  p.on("pageerror",error=>thisErrors.push({at:now(),tag,kind:"pageerror",message:error.message}));
  p.on("console",message=>{if(message.type()==="error")thisErrors.push({at:now(),tag,kind:"console",message:message.text()});});
  await p.route("**/api/operate",async route=>{
    if(route.request().method()!=="POST")return route.continue();
    try{
      const request=route.request().postDataJSON();
      assert(activeAction,"Unexpected unjournaled UI mutation "+request.action);
      assert(request.action===activeAction.action,"The UI dispatched a different operation.");
      const existing=state.actions[activeAction.label];
      const fingerprint=privacyFingerprint(request.payload);
      if(existing){
        assert(existing.input_sha256===fingerprint,"The retained operation inputs changed for "+activeAction.label);
        request.operation_id=existing.operation_id;
        await p.evaluate(({operation_id,action})=>sessionStorage.setItem("semantic-original-operation",JSON.stringify({operation_id,action})),
          {operation_id:request.operation_id,action:request.action});
      }else{
        state.actions[activeAction.label]={operation_id:request.operation_id,action:request.action,input_sha256:fingerprint,created_at:now(),status:"dispatched"};
        persist();
      }
      await route.continue({postData:JSON.stringify(request)});
    }catch(error){thisErrors.push({at:now(),tag,kind:"operation_guard",message:error.message});await route.abort("failed");}
  });
}
async function openBrowser(url=ready.url,tag="source"){
  await closeBrowser();
  browser=await playwright.chromium.launch({executablePath:path.resolve(args.chromium),headless:true,
    env:{...process.env,TMPDIR:path.join(operation,"tmp")},
    args:["--no-sandbox","--disable-dev-shm-usage","--disable-gpu","--disable-gpu-compositing","--disable-accelerated-2d-canvas","--no-zygote","--single-process"]});
  context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  page=await context.newPage();await attachPage(page,tag);
  await page.goto(url,{waitUntil:"domcontentloaded",timeout:45000});
  await page.waitForFunction(()=>typeof state!=="undefined"&&state&&document.querySelector("#content h1"),{timeout:30000});
  await page.locator("#actor").fill("Public-reference dataset operator");
  await page.locator("#actor").dispatchEvent("change");
}
async function navigate(view){
  if(await page.locator("#detail").evaluate(element=>element.open))await page.locator("#close-detail").click();
  await page.locator('#navigation a[href="#'+view+'"]').click();
  await page.waitForFunction(v=>location.hash==="#"+v&&document.querySelector('#navigation a[aria-current="page"]')?.getAttribute("href")==="#"+v,view);
}
async function action(label,name,submit){
  const prior=state.actions[label];
  if(prior?.status==="complete")return prior.result;
  if(prior){
    const current=await api("/api/operations/"+encodeURIComponent(prior.operation_id)).catch(()=>null);
    if(current?.status==="complete"){
      prior.status="complete";prior.result=current.result;prior.completed_at=now();persist();return prior.result;
    }
  }
  activeAction={label,action:name};
  try{
    const timeout=name.startsWith("recovery.")?180000:45000;
    const responseWait=page.waitForResponse(response=>response.url().endsWith("/api/operate")&&response.request().method()==="POST"
      &&response.request().postDataJSON()?.action===name,{timeout}).then(response=>({response}),error=>({error}));
    await submit();
    const outcome=await responseWait;if(outcome.error)throw outcome.error;
    const response=outcome.response,body=await response.json();
    if(!response.ok())throw Error(body.error?.message||"UI operation HTTP "+response.status());
    const saved=state.actions[label];assert(saved,"The actual UI request was not retained.");
    saved.status="complete";saved.completed_at=now();saved.result=body.result;persist();
    await page.waitForFunction(()=>!busy,{timeout:30000});
    return body.result;
  }catch(error){
    const diagnostic=await page.evaluate(()=>({url:location.href,notice:document.querySelector("#notice")?.innerText,
      active_form:document.activeElement?.closest("form")?.getAttribute("id"),
      invalid:[...document.querySelectorAll("input:invalid,select:invalid,textarea:invalid")].map(e=>({form:e.form?.getAttribute("id"),name:e.name,message:e.validationMessage}))})).catch(()=>null);
    event("ui_action_interrupted",{label,action:name,diagnostic});
    throw error;
  }finally{activeAction=null;}
}
async function step(label,fn){
  if(state.steps[label]?.status==="complete")return state.steps[label].result;
  event("step_started",{step:label});
  const result=await fn();
  state.steps[label]={status:"complete",completed_at:now(),result:result??null};persist();
  event("step_complete",{step:label});console.log(JSON.stringify({step:label,status:"complete",at:now()}));
  return result;
}
async function download(meta,locator,label){
  const target=path.join(operation,"downloads",label+"-"+path.basename(meta.path||meta.name||meta.id));
  if(await exists(target)){
    const body=await fs.readFile(target);
    if(sha(body)===meta.sha256&&body.length===meta.bytes)return {path:target,sha256:meta.sha256,bytes:body.length,artifact_id:meta.artifact_id||meta.id};
  }
  const pending=page.waitForEvent("download",{timeout:30000});
  await locator.click();
  const item=await pending;await item.saveAs(target);
  const body=await fs.readFile(target);
  assert(body.length===meta.bytes&&sha(body)===meta.sha256,"Complete UI download differs from retained artifact "+label);
  const saved={path:target,sha256:sha(body),bytes:body.length,artifact_id:meta.artifact_id||meta.id};
  state.downloads.push(saved);persist();return saved;
}
async function exportDownload(label,name,form,prepare){
  const old=state.actions[label];
  if(old?.status==="complete"){
    const meta=old.result.artifact;
    const target=path.join(operation,"downloads",label+"-"+path.basename(meta.name));
    if(await exists(target)){
      const bytes=await fs.readFile(target);
      if(bytes.length===meta.bytes&&sha(bytes)===meta.sha256)return {...old.result,download:{path:target,bytes:bytes.length,sha256:sha(bytes)}};
    }
    await navigate("overview");
    const original=await page.request.get(new URL("/api/files/"+meta.id,ready.url).href,{headers:HEADERS});
    assert(original.ok(),"The original exported artifact is no longer available.");
    const body=await original.body();assert(body.length===meta.bytes&&sha(body)===meta.sha256,"Original export changed.");
    await fs.writeFile(target,body,{mode:0o600});
    return {...old.result,download:{path:target,bytes:body.length,sha256:sha(body)}};
  }
  if(prepare)await prepare();
  const pending=page.waitForEvent("download",{timeout:180000});
  const result=await action(label,name,()=>page.locator(form+' button[type="submit"]').click());
  const item=await pending,target=path.join(operation,"downloads",label+"-"+path.basename(result.artifact.name));
  await item.saveAs(target);const body=await fs.readFile(target);
  assert(body.length===result.artifact.bytes&&sha(body)===result.artifact.sha256,"Exported download differs from its original complete artifact.");
  const saved={path:target,bytes:body.length,sha256:sha(body),artifact_id:result.artifact.id};
  state.downloads.push(saved);persist();return {...result,download:saved};
}
async function finishJob(job,label){
  await closeBrowser();
  event("native_job_observed",{job_id:job.id,label});
  const end=Date.now()+180000;let completed=null,continued=false;
  while(Date.now()<end){
    const current=await fullState(),record=row(current,"job",job.id);
    assert(record,"Original accepted native job disappeared.");
    if(record.payload.status==="interrupted"&&!continued){
      await openBrowser(ready.url,label+"-continue");await navigate("jobs");
      await action("continue-"+job.id+"-generation-"+record.payload.generation,"job.continue",()=>page.locator('[data-continue="'+job.id+'"]').click());
      continued=true;await closeBrowser();continue;
    }
    if(["failed","cancelled","interrupted"].includes(record.payload.status))throw Error("Original native job "+job.id+" ended "+record.payload.status+": "+JSON.stringify(record.payload.error));
    if(record.payload.status!=="complete"){await sleep(500);continue;}
    const result=record.payload.result_record;
    completed=result?row(current,result.kind,result.id):record;break;
  }
  assert(completed,"Original native job did not complete within its retained window.");
  await openBrowser(ready.url,label);
  return completed;
}
async function verifyHeads(url,expected){
  const actual=await getJSON(new URL("/api/state",url).href);
  for(const item of expected){
    const current=row(actual,item.kind,item.id);assert(current,"Original record missing on receiving: "+item.id);
    if(current.revision===item.revision&&current.sha256===item.sha256)continue;
    const history=await getJSON(new URL("/api/history/"+item.kind+"/"+item.id,url).href);
    assert(history.some(r=>r.revision===item.revision&&r.sha256===item.sha256),"Receiving lost original revision "+item.id);
    if(!["receiving","recovery"].includes(item.kind))assert(current.sha256===item.sha256,"A completed domain record changed on transfer: "+item.id);
  }
  assert(!actual.native_worker.running,"Received complete workspace unexpectedly launched native work.");
  return actual;
}
async function openChild(label,kind,id){
  const result=await action(label+"-generation-"+state.generation,"workspace.open",()=>page.locator('[data-open-workspace="'+kind+'"][data-id="'+id+'"]').click());
  const link=page.getByRole("link",{name:"Open received operator"});
  await link.waitFor();
  const href=await link.getAttribute("href");
  assert(new URL(href).origin===new URL(result.url).origin,"Open link differs from the actual local child.");
  const old=page,newPage=await context.newPage();await attachPage(newPage,label);
  page=newPage;await page.goto(href,{waitUntil:"domcontentloaded",timeout:30000});
  await page.waitForFunction(()=>typeof state!=="undefined"&&state&&document.querySelector("#content h1"),{timeout:30000});
  await old.close();
  return {result,url:href};
}

const inputManifestPath=path.resolve(args.inputs),inputRoot=path.dirname(inputManifestPath);
const inputManifestBytes=await fs.readFile(inputManifestPath),inputManifest=JSON.parse(inputManifestBytes);
assert(inputManifest.schema==="commons-semantic-dataset-receiving-inputs/1","Choose the exact dataset receiving input manifest.");
const inputFiles=new Map();
for(const item of inputManifest.files){
  assert(typeof item.id==="string"&&!inputFiles.has(item.id),"Every source input needs a unique original ID.");
  const file=path.resolve(inputRoot,item.path),raw=await fs.readFile(file);
  assert(raw.length===item.bytes&&sha(raw)===item.sha256,"Original receiving input changed: "+item.id);
  inputFiles.set(item.id,{...item,path:file,raw});
}
for(const name of ["baseline","corrected","shapes"])assert(inputFiles.has(inputManifest[name]),"Original "+name+" input is missing.");
const sourceInputs=Object.fromEntries(["baseline","corrected","shapes"].map(name=>[name,inputFiles.get(inputManifest[name])]));
const inputIdentity=sha(inputManifestBytes);
if(state.input_manifest_sha256)assert(state.input_manifest_sha256===inputIdentity,"Resume requires the same original input manifest.");
else{state.input_manifest_sha256=inputIdentity;state.input_files=inputManifest.files.map(({id,path,bytes,sha256})=>({id,path,bytes,sha256}));persist();}
const key=r=>r.id+"@"+r.revision;
const fill=(form,name,value)=>page.locator(form+' [name="'+name+'"]').fill(String(value));
async function readyCatalog(form){
  await page.locator(form+" [data-graph-selector]").first().waitFor({state:"visible",timeout:30000});
}
async function sourceFile(label,file,{title,role="data",format="trig",revision=null,companion=null}={}){
  await navigate("sources");
  if(revision)await page.locator('[data-edit-source="'+revision.id+'"]').click();
  await fill("#source-form","title",title);
  await page.locator('#source-form [name="format"]').selectOption(format);
  await page.locator('#source-form [name="role"]').selectOption(role);
  await fill("#source-form","source_reference",file.source_reference||"Internal public-source derivation / "+file.sha256);
  await fill("#source-form","edition",file.edition||"Retained receiving input "+file.id);
  await fill("#source-form","license",file.license||"Local reference derivation; original attribution retained in the source manifest");
  await page.locator('#source-form [name="file"]').setInputFiles(file.path);
  if(companion)await page.locator('#source-form [name="catalog_file"]').setInputFiles(companion.path);
  return action(label,"source.import",()=>page.locator('#source-form button[type="submit"]').click());
}
async function inspectDataset(label,source){
  await navigate("sources");
  const job=await action(label,"source.inspect",()=>page.locator('[data-inspect-dataset="'+key(source)+'"]').click());
  return finishJob(job,label);
}
async function buildDataset(label,source,title){
  await navigate("snapshots");
  await fill("#snapshot-form","title",title);
  await page.locator('#snapshot-form [name="sources"]').selectOption(key(source));
  await page.locator('#snapshot-form [name="data_model"]').selectOption("dataset");
  const job=await action(label,"snapshot.build",()=>page.locator('#snapshot-form button[type="submit"]').click());
  return finishJob(job,label);
}
async function saveNativeFiles(record,label){
  const files=record.payload.files||record.payload.native_result?.files||[],saved=[];
  for(const meta of files){
    const dest=path.join(operation,"downloads",label+"-"+path.basename(meta.path));
    let data=await exists(dest)?await fs.readFile(dest):null;
    if(!data||data.length!==meta.bytes||sha(data)!==meta.sha256){
      const exact=await fetch(new URL("/api/files/"+encodeURIComponent(meta.artifact_id),ready.url),{headers:HEADERS});
      assert(exact.ok,"Original native artifact is unavailable.");
      data=Buffer.from(await exact.arrayBuffer());
      assert(data.length===meta.bytes&&sha(data)===meta.sha256,"Original native artifact changed.");
      await fs.writeFile(dest,data,{mode:0o600});
    }
    saved.push({...meta,path:dest});
  }
  return saved;
}
async function fileJSON(record,role){
  const files=record.payload.files||record.payload.native_result?.files||[];
  const file=files.find(f=>f.role===role);
  assert(file,"Missing complete native "+role+" output.");
  return getJSON(new URL("/api/files/"+file.artifact_id,ready.url));
}
async function chooseGraphs(form,selection="all"){
  await readyCatalog(form);
  const selector=page.locator(form+" [data-graph-selector]").first();
  await selector.locator("[data-graph-mode]").selectOption(selection==="all"?"all":"selected");
  if(selection!=="all")await selector.locator("[data-graph-values]").selectOption(selection.map(g=>JSON.stringify(g)));
}
async function queryDataset(label,snapshot,title,options={}){

  await navigate("queries");
  await fill("#query-form","title",title);
  await page.locator('#query-form [name="snapshot"]').selectOption(key(snapshot));
  await chooseGraphs("#query-form",options.scope?.named_graphs??inputManifest.query_scope?.named_graphs??"all");
  await page.locator('#query-form [name="dataset_default_graph"]').selectOption(options.scope?.default_graph??inputManifest.query_scope?.default_graph??"default");
  await fill("#query-form","query",options.query||inputManifest.query||"SELECT ?graph ?s ?p ?o WHERE { GRAPH ?graph { ?s ?p ?o } } ORDER BY ?graph ?s ?p ?o");
  const job=await action(label,"query.run",()=>page.locator('#query-form button[type="submit"]').click());
  return finishJob(job,label);
}
async function validateDataset(label,snapshot,shapes,mode){
  await navigate("validation");
  await fill("#validation-form","title","Public-reference dataset / "+mode+" validation");
  await page.locator('#validation-form [name="snapshot"]').selectOption(key(snapshot));
  await page.locator('#validation-form [name="shapes"]').selectOption(key(shapes));
  await chooseGraphs("#validation-form",inputManifest.validation_scopes?.[mode]?.graphs??"all");
  await page.locator('#validation-form [name="dataset_validation_mode"]').selectOption(mode);
  const job=await action(label,"validation.run",()=>page.locator('#validation-form button[type="submit"]').click());
  return finishJob(job,label);
}
async function capture(view,label,width,prepare=null){
  await navigate(view);await page.setViewportSize({width,height:1000});
  if(prepare)await prepare();
  const size=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,
    title:document.querySelector("#content h1")?.textContent}));
  assert(size.scroll<=size.client+1,"Dataset "+view+" view extends beyond the viewport.");
  const file=path.join(operation,"screenshots",label+".png");
  await page.screenshot({path:file,fullPage:true});
  const saved={view,width,...size,path:file};state.views.push(saved);persist();return saved;
}
let failure=null;
try{
  await startHost(workspace,"dataset-source");
  await openBrowser();
  const original=await step("retain-original-w3c-trig",async()=>{
    await navigate("sources");
    await page.locator('#reference-form [name="path"]').selectOption("w3c/examples/conformance-standards.trig");
    await page.locator('#reference-form [name="role"]').selectOption("data");
    return action("retain-w3c-trig","source.reference",()=>page.locator('#reference-form button[type="submit"]').click());
  });
  const originalInspection=await step("inspect-original-w3c-dataset",()=>inspectDataset("inspect-w3c-dataset",original));
  const originalSnapshot=await step("snapshot-original-w3c-dataset",()=>buildDataset("snapshot-w3c-dataset",original,"W3C conformance standards / original dataset"));
  const originalQuery=await step("query-original-named-graph",()=>queryDataset("query-w3c-dataset",originalSnapshot,"W3C original named-graph query",{
    query:"SELECT ?s ?p ?o WHERE { GRAPH <https://dcat.example.org/testResult> { ?s ?p ?o } } ORDER BY ?s ?p ?o",
    scope:{default_graph:"default",named_graphs:[{type:"uri",value:"https://dcat.example.org/testResult"}]}
  }));
  const baselineSource=await step("retain-authored-dataset-edition",()=>sourceFile("retain-authored-dataset",sourceInputs.baseline,{
    title:"Public-reference dataset / local operating edition",format:sourceInputs.baseline.format||"trig"}));
  const baselineInspection=await step("inspect-authored-dataset-edition",()=>inspectDataset("inspect-authored-dataset",baselineSource));
  const baseline=await step("build-authored-dataset-edition",()=>buildDataset("build-authored-dataset",baselineSource,"Public-reference dataset / baseline"));
  const baselineCatalog=await step("retain-baseline-catalogue",async()=>{
    const catalog=await fileJSON(baseline,"graph_catalog");
    assert(catalog.schema==="commons-semantic-graph-catalog/1"&&catalog.graphs.length,"Complete graph catalogue is required.");
    if(inputManifest.expected?.baseline_empty_graphs!==undefined)
      assert(catalog.graphs.filter(g=>g.empty).length===inputManifest.expected.baseline_empty_graphs,"Baseline empty-graph inventory differs from the original operation.");
    const outputs=await saveNativeFiles(baseline,"baseline");
    await navigate("snapshots");
    await page.locator('[data-record="snapshot"][data-id="'+baseline.id+'"]').click();
    const file=baseline.payload.files.find(f=>f.role==="graph_catalog");
    await page.locator('#detail [data-preview="'+file.artifact_id+'"]').click();
    await page.getByRole("heading",{name:"Complete retained graph catalogue"}).waitFor();
    await page.screenshot({path:path.join(operation,"screenshots","dataset-catalogue-desktop.png"),fullPage:true});
    await page.locator("#close-detail").click();
    return {catalog,outputs};
  });
  const baselineQuery=await step("query-authored-cross-graph-identity",()=>queryDataset("query-authored-cross-graph",baseline,"Public-reference dataset / cross-graph identity"));
  const shapes=await step("retain-selected-public-reference-constraint",()=>sourceFile("retain-dataset-shapes",sourceInputs.shapes,{
    title:"Selected constraints for public-reference dataset",role:"shapes",format:sourceInputs.shapes.format||"turtle"}));
  const perGraph=await step("validate-each-retained-graph",()=>validateDataset("validate-per-graph",baseline,shapes,"per_graph"));
  const union=await step("validate-explicit-selected-union",()=>validateDataset("validate-union",baseline,shapes,"union"));
  assert(typeof inputManifest.expected?.per_graph_conforms==="boolean"&&typeof inputManifest.expected?.union_conforms==="boolean",
    "The original receiving manifest must declare both validation expectations.");
  assert(perGraph.payload.summary?.conforms===inputManifest.expected.per_graph_conforms,
    "The actual selected per-graph validation disagrees with the authored source expectation.");
  assert(union.payload.summary?.conforms===inputManifest.expected.union_conforms,
    "The actual explicit-union validation disagrees with the authored source expectation.");
  const correctedSource=await step("retain-corrected-source-edition",()=>sourceFile("revise-authored-dataset",sourceInputs.corrected,{
    title:baselineSource.payload.title,revision:baselineSource,format:sourceInputs.corrected.format||"trig"}));
  const corrected=await step("build-corrected-dataset",()=>buildDataset("build-corrected-dataset",correctedSource,"Public-reference dataset / corrected edition"));
  const comparison=await step("compare-complete-quad-and-graph-change",async()=>{
    await navigate("changes");
    await fill("#comparison-form","title","Public-reference graph membership and empty-graph changes");
    await page.locator('#comparison-form [name="before"]').selectOption(key(baseline));
    await page.locator('#comparison-form [name="after"]').selectOption(key(corrected));
    await readyCatalog("#comparison-form");
    await page.locator('#comparison-form [name="dataset_impact_mode"]').selectOption("within_graph");
    if(inputManifest.edge_predicates)await fill("#comparison-form","edge_predicates",inputManifest.edge_predicates.join("\n"));
    const job=await action("compare-dataset-editions","comparison.run",()=>page.locator('#comparison-form button[type="submit"]').click());
    const record=await finishJob(job,"compare-dataset-editions");
    await saveNativeFiles(record,"comparison");
    return record;
  });
  assert(comparison.payload.summary?.quad_difference_complete===true&&comparison.payload.summary?.graph_inventory_difference_complete===true,
    "The original comparison must retain complete quad and graph-inventory differences.");
  for(const [name,snapshot] of [["baseline",baseline],["corrected",corrected]]){
    const summary=snapshot.payload.summary||{};
    for(const [field,expectedKey] of [["quad_count",name+"_quads"],["graph_count",name+"_graphs"],["empty_graph_count","empty_graphs"]]){
      const expected=inputManifest.expected?.[expectedKey];
      if(Number.isInteger(expected))assert(summary[field]===expected,"The actual "+name+" "+field+" disagrees with its retained source.");
    }
    assert(summary.canonicalization?.profile==="commons-semantic-dataset-inventory/1",
      "The exact snapshot must retain its declared empty-graph inventory profile.");
  }
  const decision=await step("record-exact-internal-review",async()=>{
    await navigate("changes");
    await page.locator('[data-record="comparison"][data-id="'+comparison.id+'"]').click();
    await fill("#decision-form","title","Internal review of retained public-reference dataset editions");
    await page.locator('#decision-form [name="disposition"]').selectOption("reviewed");
    await fill("#decision-form","note","Internal dataset receiving review: original public references and explicitly authored operating inputs remain identified separately. This decision pins the exact quad, graph-inventory and scoped-impact comparison. It does not represent a customer acceptance.");
    return action("review-dataset-comparison","decision.save",()=>page.locator('#decision-form button[type="submit"]').click());
  });
  await step("native-dataset-mobile-views",async()=>{
    const views=[];
    const preparations={
      snapshots:async()=>{
        await page.locator('#snapshot-form [name="sources"]').selectOption(key(original));
        await page.locator('#snapshot-form [name="data_model"]').selectOption("dataset");
        await readyCatalog("#snapshot-form");
      },
      validation:async()=>{
        await page.locator('#validation-form [name="snapshot"]').selectOption(key(baseline));
        await page.locator('#validation-form [name="shapes"]').selectOption(key(shapes));
        await chooseGraphs("#validation-form",inputManifest.validation_scopes?.union?.graphs??"all");
        await page.locator('#validation-form [name="dataset_validation_mode"]').selectOption("union");
      },
      queries:async()=>{
        await page.locator('#query-form [name="snapshot"]').selectOption(key(corrected));
        await chooseGraphs("#query-form",inputManifest.query_scope?.named_graphs??"all");
        await page.locator('#query-form [name="dataset_default_graph"]').selectOption("union");
        await fill("#query-form","query",inputManifest.query||"SELECT ?graph ?s ?p ?o WHERE { GRAPH ?graph { ?s ?p ?o } }");
      },
      changes:async()=>{
        await page.locator('#comparison-form [name="before"]').selectOption(key(baseline));
        await page.locator('#comparison-form [name="after"]').selectOption(key(corrected));
        await readyCatalog("#comparison-form");
      }
    };
    for(const [view,label] of [["snapshots","dataset-snapshot-mobile"],["validation","dataset-validation-mobile"],["queries","dataset-query-mobile"],["changes","dataset-change-mobile"]])
      views.push(await capture(view,label,390,preparations[view]));
    await page.setViewportSize({width:1440,height:1000});
    return views;
  });
  const exported=await step("export-complete-dataset-workspace",async()=>{
    await navigate("receiving");state.exported_heads=heads(await fullState());persist();
    return exportDownload("export-dataset-workspace","handoff.export","#handoff-export-form");
  });
  const received=await step("receive-and-open-original-dataset-workspace",async()=>{
    const destination=path.join(operation,"receiving-parent");
    await startHost(destination,"receiving-parent");await openBrowser();
    await navigate("receiving");
    await fill("#handoff-form","title","Complete public-reference dataset handoff");
    await fill("#handoff-form","source_reference","Original dataset workspace handoff / "+exported.download.sha256);
    await page.locator('#handoff-form [name="file"]').setInputFiles(exported.download.path);
    const receipt=await action("receive-dataset-workspace","handoff.receive",()=>page.locator('#handoff-form button[type="submit"]').click());
    const opened=await openChild("open-received-dataset","receiving",receipt.id);
    const current=await verifyHeads(opened.url,state.exported_heads);
    const catalogueFile=row(current,"snapshot",corrected.id).payload.files.find(f=>f.role==="graph_catalog");
    const catalog=await getJSON(new URL("/api/files/"+catalogueFile.artifact_id,opened.url));
    return {receipt_id:receipt.id,workspace_path:current.workspace_path,workspace_id:current.workspace_id,
      records:heads(current).length,dataset_sha256:catalog.dataset_sha256};
  });
  await startHost(received.workspace_path,"received-continuation");await openBrowser();
  const continued=await step("query-after-independent-receiving",()=>queryDataset("query-received-dataset",corrected,"Received dataset / original named-graph query"));
  const roundtrip=await step("reuse-exact-nquads-and-empty-graph-catalogue",async()=>{
    const originals=await saveNativeFiles(corrected,"corrected");
    const nq=originals.find(f=>f.role==="dataset"),catalogue=originals.find(f=>f.role==="graph_catalog");
    const incoming=await sourceFile("retain-received-nquads",{
      ...nq,id:"retained-nquads",source_reference:"Exact received dataset "+corrected.id+" / "+nq.sha256,
      edition:"Original emitted dataset and catalogue"
    },{title:"Received dataset / exact N-Quads with graph catalogue",format:"nquads",companion:catalogue});
    const next=await buildDataset("rebuild-received-dataset",incoming,"Received dataset / catalogue-preserving rebuild");
    const actual=await fileJSON(next,"graph_catalog"),prior=await fileJSON(corrected,"graph_catalog");
    assert(actual.dataset_sha256===prior.dataset_sha256,"Dataset identity changed when its exact N-Quads and graph catalogue were reused.");
    assert(JSON.stringify(actual.graphs.map(g=>g.graph))===JSON.stringify(prior.graphs.map(g=>g.graph)),"Graph inventory changed on catalogue-preserving reuse.");
    return {source:reference(incoming),snapshot:reference(next),dataset_sha256:actual.dataset_sha256,graphs:actual.graphs.length};
  });
  const finalHandoff=await step("export-received-dataset-continuation",async()=>{
    await navigate("receiving");
    return exportDownload("export-received-dataset","handoff.export","#handoff-export-form");
  });
  const finalState=await fullState();
  assert(thisErrors.length===0,"Browser errors occurred: "+JSON.stringify(thisErrors));
  const result={schema:"commons-semantic-dataset-ui-receiving-result/1",status:"PASS",
    operation_id:state.operation_id,source_path:ROOT,workspace_id:finalState.workspace_id,
    source_workspace:workspace,received_workspace:received.workspace_path,input_manifest_sha256:inputIdentity,
    original_w3c:{source:reference(original),inspection:reference(originalInspection),snapshot:reference(originalSnapshot),query:reference(originalQuery)},
    baseline:{source:reference(baselineSource),snapshot:reference(baseline),query:reference(baselineQuery),catalogue:baselineCatalog.catalog},
    validation:{per_graph:{record:reference(perGraph),summary:perGraph.payload.summary},union:{record:reference(union),summary:union.payload.summary}},
    corrected:{source:reference(correctedSource),snapshot:reference(corrected)},comparison:{record:reference(comparison),summary:comparison.payload.summary},
    review:reference(decision),receiving:received,continued_query:reference(continued),catalogue_roundtrip:roundtrip,
    source_handoff:exported.download,final_handoff:finalHandoff.download,
    views:state.views,retained_records:heads(finalState).length,completed_steps:Object.keys(state.steps).length,
    browser_errors:[],external_provider_calls:0,completed_at:now(),closed:false};
  state.status="finishing";state.completed_at=result.completed_at;atomicJSON(resultFile,result);persist();
}catch(error){
  failure=error;state.status="interrupted";state.error={at:now(),message:error.message,stack:error.stack};
  state.errors.push(...thisErrors);persist();
  console.error(JSON.stringify({status:"interrupted",operation_id:state.operation_id,error:error.message}));
}finally{
  try{await closeHost();state.closed_at=now();persist();}
  catch(error){failure||=error;state.status="interrupted";state.cleanup_error=error.message;persist();}
  if(state.status==="finishing"&&!failure){
    const result=await readJSON(resultFile);result.closed=true;result.closed_at=state.closed_at;
    atomicJSON(resultFile,result);state.status="complete";persist();console.log(JSON.stringify(result));
  }
  await lease.close();
}
if(failure)process.exit(1);
