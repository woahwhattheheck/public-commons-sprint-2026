#!/usr/bin/env node
/**
 * Continue an existing semantic workspace through its real loopback UI.
 * Requires existing Python dependencies, Playwright and Chromium. No install,
 * customer service, remote RDF source or replacement native preparation runs.
 * Private checkpoints, original downloads and recovery secrets stay under
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
if(!args.workspace||!args.operation||!args.playwright||!args.chromium)
  throw Error("Use --workspace=/existing/private/workspace --operation=/private/ui-receiving --playwright=/existing/module --chromium=/existing/chromium [--python=python3].");
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
await fs.access(workspace);
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
const stateFile=path.join(operation,"UI-STATE.json"),resultFile=path.join(operation,"UI-RESULT.json");
let state=await exists(stateFile)?await readJSON(stateFile):{
  schema:"commons-semantic-ui-receiving/1",operation_id:"semantic-ui-"+crypto.randomUUID(),
  workspace_path:workspace,created_at:now(),generation:0,steps:{},actions:{},events:[],downloads:[],views:[],errors:[]};
assert(state.workspace_path===workspace,"The checkpoint belongs to another original workspace.");
if(state.status==="complete"){console.log(JSON.stringify(await readJSON(resultFile)));await lease.close();process.exit(0);}
state.generation++;state.status="running";state.started_at=now();delete state.error;
const persist=()=>atomicJSON(stateFile,state);
const event=(type,detail={})=>{state.events.push({at:now(),type,...detail});persist();};
persist();
const passPath=path.join(operation,"recovery-passphrase.txt");
if(!await exists(passPath))await fs.writeFile(passPath,crypto.randomBytes(32).toString("base64url")+"\n",{mode:0o600,flag:"wx"});
const passphrase=(await fs.readFile(passPath,"utf8")).trim();
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
  if("data_base64" in clone){clone.data_sha256=sha(Buffer.from(clone.data_base64,"base64"));delete clone.data_base64;}
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
  await page.locator("#actor").fill("Public-source UI receiving");
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
    assert(result,"Complete native job lacks its retained result record.");
    completed=row(current,result.kind,result.id);break;
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
async function inspectViews(prefix,width){
  await page.setViewportSize({width,height:1000});
  const output=[];
  for(const view of ["overview","sources","mappings","snapshots","validation","queries","changes","jobs","receiving","recovery"]){
    await navigate(view);
    const size=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,title:document.querySelector("#content h1")?.textContent}));
    assert(size.scroll<=size.client+1,prefix+" "+view+" page overflows: "+JSON.stringify(size));
    output.push({view,width,...size});
  }
  state.views.push(...output.map(item=>({edition:prefix,...item})));persist();
  return output;
}
let failure=null;
try{
  await startHost(workspace,"original");
  await openBrowser();
  const initial=await step("original-identity",async()=>{
    const current=await fullState();
    const mapping=current.records.mapping.find(r=>r.id===args.mapping)||current.records.mapping.find(r=>r.payload.title==="Published title inventory mapping");
    assert(mapping,"Choose the existing derived public-title mapping with --mapping=ID.");
    const source=row(current,"source",mapping.payload.source.id);
    assert(source?.payload.role==="table"&&source.payload.format==="csv","The selected original mapping needs its retained CSV.");
    const snapshots=current.records.snapshot.filter(r=>r.payload.parameters?.mappings?.some(m=>m.mapping_id===mapping.id&&m.revision===mapping.revision));
    const baseline=snapshots.sort((a,b)=>b.updated_at.localeCompare(a.updated_at))[0];
    assert(baseline,"The completed original mapping snapshot is required.");
    assert(current.records.job.length&&current.records.job.every(r=>r.payload.status==="complete"),"Complete the existing original native jobs before this UI continuation.");
    const rdfRefs=baseline.payload.inputs.filter(i=>i.role==="data").map(i=>({id:i.source_id,revision:i.revision}));
    const originalHandoff=current.artifacts.find(f=>f.role==="workspace-handoff");
    assert(originalHandoff,"Retain the original application-native handoff before UI receiving.");
    return {workspace_id:current.workspace_id,source,mapping,baseline,rdf_refs:rdfRefs,
      original_jobs:current.records.job.map(r=>({id:r.id,revision:r.revision,sha256:r.sha256})),
      original_heads:heads(current),original_handoff:originalHandoff,
      original_validation:current.records.validation.map(r=>({id:r.id,revision:r.revision,summary:r.payload.summary})),
      original_vault_fingerprint:sha(await fs.readFile(path.join(workspace,"private","vault.key")))};
  });
  assert(ready.workspace_id===initial.workspace_id,"The original workspace identity changed.");
  const revised=await step("source-revision",async()=>{
    await navigate("sources");event("original_sources_view_open");
    const meta={...initial.source.payload,id:initial.source.payload.artifact_id,name:"original-title-inventory.csv"};
    const saved=await download(meta,page.locator('[data-download="'+meta.id+'"]').first(),"original-title-inventory");
    const edited=path.join(operation,"downloads","reviewed-title-inventory.csv");
    if(!await exists(edited)){
      await command(python,["-B","-c",
        "import csv,sys\nfrom pathlib import Path\nsource,target=sys.argv[1:3]\nwith open(source,newline='',encoding='utf-8-sig') as f:\n r=csv.DictReader(f); names=r.fieldnames; rows=list(r)\nassert rows and 'title' in names\nrows[0]['title'] += ' [UI reviewed edition]'\nwith open(target,'w',newline='',encoding='utf-8') as f:\n w=csv.DictWriter(f,fieldnames=names,lineterminator='\\n');w.writeheader();w.writerows(rows)\n",
        saved.path,edited]);
      await fs.chmod(edited,0o600);
    }
    event("reviewed_source_file_ready",{path:edited});
    await page.locator('[data-edit-source="'+initial.source.id+'"]').click();
    event("original_source_edit_open");
    await page.locator('#source-form [name="file"]').setInputFiles(edited);
    await page.locator('#source-form [name="edition"]').fill("Explicit UI-reviewed local title edition; original publication unchanged");
    event("original_source_edit_filled");
    await sleep(2800);
    assert(await page.locator('#source-form [name="id"]').inputValue()===initial.source.id,"Background refresh discarded the active source edit.");
    const result=await action("save-source-revision","source.import",()=>page.locator('#source-form button[type="submit"]').click());
    assert(result.id===initial.source.id&&result.revision===initial.source.revision+1,"Source edit did not retain its original ID and next revision.");
    await page.locator('[data-history="source"][data-id="'+result.id+'"]').click();
    await page.locator("#detail .history-entry").nth(result.revision-1).waitFor();
    const history=await page.locator("#detail-body").innerText();
    assert(history.includes(initial.source.payload.sha256),"Original source bytes are absent from visible revision history.");
    await page.locator("#close-detail").click();
    return result;
  });
  const mapped=await step("mapping-revision",async()=>{
    await navigate("mappings");
    await page.locator('[data-edit-mapping="'+initial.mapping.id+'"]').click();
    await page.locator('#mapping-form [name="source"]').selectOption(revised.id+"@"+revised.revision);
    await page.locator('#mapping-form [name="review_note"]').fill("UI reviewer pins the complete next local title-table edition and retains every original term mapping.");
    const result=await action("save-mapping-revision","mapping.save",()=>page.locator('#mapping-form button[type="submit"]').click());
    assert(result.id===initial.mapping.id&&result.revision===initial.mapping.revision+1,"Mapping edit lost its original identity.");
    assert(result.payload.source.revision===revised.revision,"The mapping did not pin the reviewed source revision.");
    assert(result.payload.definition.fields.length===initial.mapping.payload.definition.fields.length,"A mapped source field was lost.");
    return result;
  });
  const snapshot=await step("reviewed-native-snapshot",async()=>{
    await navigate("snapshots");
    await page.locator('#snapshot-form [name="title"]').fill("UI reviewed local title edition");
    await page.locator('#snapshot-form [name="sources"]').selectOption(initial.rdf_refs.map(r=>r.id+"@"+r.revision));
    await page.locator('#snapshot-form [name="mappings"]').selectOption(mapped.id+"@"+mapped.revision);
    const job=await action("build-reviewed-snapshot","snapshot.build",()=>page.locator('#snapshot-form button[type="submit"]').click());
    const result=await finishJob(job,"reviewed-snapshot");
    assert(result.payload.summary.triples===initial.baseline.payload.summary.triples,"Changing one literal unexpectedly changed graph size.");
    return result;
  });
  const profileValidation=await step("published-modular-profile",async()=>{
    await navigate("sources");
    await page.locator('#profile-form [name="profile_id"]').selectOption("dcat-ap-3.0.1-modular");
    const imported=await action("import-published-profile","source.profile",()=>page.locator('#profile-form button[type="submit"]').click());
    const shapes=imported.sources.filter(r=>r.payload.role==="shapes"),ontologies=imported.sources.filter(r=>r.payload.role==="ontology");
    assert(imported.original_files_retained===true&&shapes.length===3&&ontologies.length===1,"The documented three-module profile and ontology were not retained.");
    await navigate("validation");
    await page.locator('#validation-form [name="title"]').fill("UI reviewed graph against documented DCAT-AP modular profile");
    await page.locator('#validation-form [name="snapshot"]').selectOption(snapshot.id+"@"+snapshot.revision);
    await page.locator('#validation-form [name="shapes"]').selectOption(shapes.map(r=>r.id+"@"+r.revision));
    await page.locator('#validation-form [name="ontologies"]').selectOption(ontologies.map(r=>r.id+"@"+r.revision));
    await page.locator('#validation-form [name="inference"]').selectOption("none");
    const job=await action("validate-published-modular-profile","validation.run",()=>page.locator('#validation-form button[type="submit"]').click());
    const result=await finishJob(job,"complete-published-profile");
    assert(result.payload.summary.shapes_valid===true&&result.payload.summary.data_validation_performed===true,"The complete published profile did not reach actual data validation.");
    assert(typeof result.payload.summary.conforms==="boolean"&&result.payload.summary.report_complete===true,"The original native conformance result is incomplete.");
    await navigate("validation");await page.locator('[data-record="validation"][data-id="'+result.id+'"]').click();
    for(const [index,file] of result.payload.files.entries())
      await download(file,page.locator('#detail [data-download="'+file.artifact_id+'"]').first(),"validation-"+index);
    await page.locator('#decision-form [name="disposition"]').selectOption(result.payload.summary.conforms?"accepted":"changes_requested");
    await page.locator('#decision-form [name="note"]').fill(result.payload.summary.conforms?
      "Reviewed the complete original native conformance result for the explicitly selected published modules.":
      "Reviewed actual data findings from the valid published module composition. The original public metadata and all native nonconformance details are retained for correction; no conformance claim is inferred.");
    const decision=await action("review-complete-profile","decision.save",()=>page.locator('#decision-form button[type="submit"]').click());
    return {profile:imported.profile_id,source_ids:imported.sources.map(reference),record:result,review:decision};
  });
  const query=await step("typed-query",async()=>{
    await navigate("queries");
    await page.locator('#query-form [name="title"]').fill("UI reviewed typed graph statements");
    await page.locator('#query-form [name="snapshot"]').selectOption(snapshot.id+"@"+snapshot.revision);
    await page.locator('#query-form [name="query"]').fill("SELECT ?subject ?predicate ?object WHERE { ?subject ?predicate ?object } ORDER BY ?subject ?predicate ?object");
    await page.locator('#query-form [name="row_limit"]').fill("10000");
    const job=await action("query-reviewed-snapshot","query.run",()=>page.locator('#query-form button[type="submit"]').click());
    const result=await finishJob(job,"typed-query");
    assert(result.payload.summary.result_complete&&!result.payload.summary.truncated,"The UI query result is incomplete.");
    return result;
  });
  const comparison=await step("complete-change-review",async()=>{
    await navigate("changes");
    await page.locator('#comparison-form [name="title"]').fill("UI one-title edition impact");
    await page.locator('#comparison-form [name="before"]').selectOption(initial.baseline.id+"@"+initial.baseline.revision);
    await page.locator('#comparison-form [name="after"]').selectOption(snapshot.id+"@"+snapshot.revision);
    await page.locator('#comparison-form [name="depth"]').fill("2");
    await page.locator('#comparison-form [name="node_limit"]').fill("100000");
    const job=await action("compare-reviewed-edition","comparison.run",()=>page.locator('#comparison-form button[type="submit"]').click());
    const result=await finishJob(job,"graph-change");
    assert(result.payload.summary.added_triples===1&&result.payload.summary.removed_triples===1,"The single UI title edit must yield one added and one removed triple.");
    assert(result.payload.summary.graph_difference_complete&&!result.payload.summary.impact_truncated,"Native comparison or impact is incomplete.");
    await navigate("changes");await page.locator('[data-record="comparison"][data-id="'+result.id+'"]').click();
    await page.locator('#decision-form [name="disposition"]').selectOption("accepted");
    await page.locator('#decision-form [name="note"]').fill("Reviewed the exact one added and one removed title statement; the complete original source, changed edition and impact files remain available.");
    const decision=await action("review-comparison","decision.save",()=>page.locator('#decision-form button[type="submit"]').click());
    assert(decision.payload.record_revision===result.revision&&decision.payload.record_sha256===result.sha256,"Decision did not pin the exact reviewed result.");
    return {...result,review:decision};
  });
  await step("typed-output-and-original-validation",async()=>{
    await navigate("queries");await page.locator('[data-record="query"][data-id="'+query.id+'"]').click();
    const nativeJSON=query.payload.files.find(f=>/json/.test(f.media_type||"")&&/result/i.test(f.path)&&!/summary/.test(f.path));
    assert(nativeJSON,"Native typed SPARQL JSON result is missing.");
    await page.locator('[data-preview="'+nativeJSON.artifact_id+'"]').click();
    await page.getByRole("heading",{name:"Typed query bindings",exact:true}).waitFor();
    const downloaded=await download(nativeJSON,page.locator('#detail [data-download="'+nativeJSON.artifact_id+'"]'),"typed-query");
    const parsed=await readJSON(downloaded.path);
    assert(parsed.results.bindings.length===query.payload.summary.rows_returned,"The native JSON rows disagree with the query summary.");
    assert(parsed.results.bindings.some(r=>Object.values(r).some(v=>v.type==="uri")),"Typed URI values were lost.");
    assert(parsed.results.bindings.some(r=>Object.values(r).some(v=>v.type==="literal")),"Typed literal values were lost.");
    await page.screenshot({path:path.join(operation,"screenshots","typed-query-desktop.png"),fullPage:true});
    await page.locator("#close-detail").click();
    for(const [kind,record] of [["snapshot",snapshot],["comparison",comparison]]){
      await navigate(kind==="snapshot"?"snapshots":"changes");
      await page.locator('[data-record="'+kind+'"][data-id="'+record.id+'"]').click();
      for(const [index,file] of record.payload.files.entries())
        await download(file,page.locator('#detail [data-download="'+file.artifact_id+'"]').first(),kind+"-"+index);
      await page.locator("#close-detail").click();
    }
    await navigate("validation");
    for(const original of initial.original_validation){
      await page.locator('[data-record="validation"][data-id="'+original.id+'"]').click();
      const text=await page.locator("#detail-body").innerText();
      assert(text.includes(original.summary.native_outcome),"The original validation outcome was hidden or relabeled.");
      await page.locator("#close-detail").click();
    }
    return {typed_rows:parsed.results.bindings.length,variables:parsed.head.vars,original_validation:initial.original_validation};
  });
  await step("desktop-views",async()=>{
    const views=await inspectViews("original",1440);
    await navigate("changes");await page.screenshot({path:path.join(operation,"screenshots","changes-desktop.png"),fullPage:true});
    return views;
  });
  const incoming=await step("retain-incoming-edition",async()=>{
    const meta=initial.original_handoff,oldPath=path.join(operation,"downloads","original-native-handoff.zip");
    if(!await exists(oldPath)){
      const response=await page.request.get(new URL("/api/files/"+meta.id,ready.url).href,{headers:HEADERS});
      assert(response.ok(),"Original native handoff is missing.");
      const body=await response.body();assert(body.length===meta.bytes&&sha(body)===meta.sha256,"The original native handoff changed.");
      await fs.writeFile(oldPath,body,{mode:0o600});
    }
    await navigate("receiving");
    await page.locator('#handoff-form [name="title"]').fill("Retained original native edition inside reviewed parent");
    await page.locator('#handoff-form [name="source_reference"]').fill("The same original application-native handoff, before the explicit UI-reviewed source revision.");
    await page.locator('#handoff-form [name="file"]').setInputFiles(oldPath);
    const result=await action("receive-original-native","handoff.receive",()=>page.locator('#handoff-form button[type="submit"]').click());
    assert(result.payload.archive_sha256===meta.sha256,"Incoming edition identity changed.");
    await page.locator('#handoff-form [name="title"]').fill("Replay the same original native edition");
    await page.locator('#handoff-form [name="source_reference"]').fill("Exact same original archive receiving replay.");
    await page.locator('#handoff-form [name="file"]').setInputFiles(oldPath);
    const replay=await action("receive-original-native-replay","handoff.receive",()=>page.locator('#handoff-form button[type="submit"]').click());
    assert(replay.id===result.id,"Receiving the same archive created another branch.");
    return result;
  });
  const exported=await step("parent-handoff-and-encryption",async()=>{
    const before=await fullState();state.exported_heads=heads(before);persist();
    await navigate("receiving");
    const handoff=await exportDownload("parent-export","handoff.export","#handoff-export-form");
    await navigate("recovery");
    const encrypted=await exportDownload("encrypted-export","recovery.export","#recovery-export-form",
      ()=>page.locator('#recovery-export-form [name="passphrase"]').fill(passphrase));
    assert(encrypted.local_key_excluded===true,"Recovery export did not exclude the original local key.");
    return {handoff,encrypted};
  });
  const receiver=await step("receiving-parent-and-child",async()=>{
    const desk=path.join(operation,"receiving-desk");
    await startHost(desk,"receiver");await openBrowser(ready.url,"receiver");
    await navigate("receiving");
    await page.locator('#handoff-form [name="title"]').fill("Complete reviewed parent with its incoming edition");
    await page.locator('#handoff-form [name="source_reference"]').fill("Complete original UI-reviewed engineering workspace handoff.");
    await page.locator('#handoff-form [name="file"]').setInputFiles(exported.handoff.download.path);
    const receipt=await action("receive-reviewed-parent","handoff.receive",()=>page.locator('#handoff-form button[type="submit"]').click());
    assert(receipt.payload.source_workspace_id===initial.workspace_id,"Parent receiving changed the source workspace identity.");
    const opened=await openChild("open-reviewed-parent","receiving",receipt.id);
    let child=await verifyHeads(opened.url,state.exported_heads);
    assert(child.workspace_path===path.join(desk,"receiving",receipt.id),"The parent did not open under the new receiver's own root.");
    const localParent=child.workspace_path;
    await navigate("recovery");
    const inheritedRecovery=child.records.recovery.find(r=>r.payload.location_status==="original_archive_required");
    assert(inheritedRecovery,"Transferred recovery must keep its original archive requirement.");
    assert(await page.locator('[data-open-workspace="recovery"][data-id="'+inheritedRecovery.id+'"]').count()===0,"UI exposed a stale original-host recovery path.");
    await navigate("receiving");
    const originalEdition=child.records.receiving.find(r=>r.id===incoming.id);
    assert(originalEdition&&originalEdition.payload.location_status==="retained_archive_available","The inherited original archive was not retained for receiver-owned continuation.");
    // The page now belongs to the received parent, so its original operations
    // must be read from that page's server during this local child opening.
    const parentReady=ready;ready={...ready,url:opened.url};
    let nested;
    try{nested=await openChild("open-inherited-incoming","receiving",incoming.id);}
    finally{ready=parentReady;}
    const nestedState=await getJSON(new URL("/api/state",nested.url).href);
    assert(nestedState.workspace_path===path.join(localParent,"receiving",incoming.id),"Inherited child followed a former host path.");
    assert(nestedState.workspace_id===initial.workspace_id,"Inherited original edition lost its workspace ID.");
    assert(row(nestedState,"source",initial.source.id).revision===initial.source.revision,"Inherited child did not reopen its original received edition.");
    assert(!nestedState.native_worker.running,"Opening a complete incoming edition repeated native work.");
    await page.screenshot({path:path.join(operation,"screenshots","received-original-edition.png"),fullPage:true});
    return {receipt_id:receipt.id,parent_path:localParent,inherited_receipt_id:incoming.id,child_path:nestedState.workspace_path,
      retained_original_source_revision:initial.source.revision,transferred_recovery_archive_required:true};
  });
  const restored=await step("encrypted-cold-reopen",async()=>{
    await startHost(workspace,"original-recovery");await openBrowser(ready.url,"original-recovery");
    await navigate("recovery");
    const destination=path.join(operation,"restored-workspace");
    await page.locator('#recovery-restore-form [name="file"]').setInputFiles(exported.encrypted.download.path);
    await page.locator('#recovery-restore-form [name="passphrase"]').fill(passphrase);
    await page.locator('#recovery-restore-form [name="destination"]').fill(destination);
    const result=await action("restore-encrypted-original","recovery.restore",()=>page.locator('#recovery-restore-form button[type="submit"]').click());
    assert(result.payload.archive_sha256===exported.encrypted.download.sha256,"Recovery restored another encrypted archive.");
    const opened=await openChild("open-cold-restored","recovery",result.id);
    const current=await verifyHeads(opened.url,state.exported_heads);
    assert(current.workspace_id===initial.workspace_id&&current.workspace_path===destination,"Cold restore lost its original workspace identity.");
    const fresh=sha(await fs.readFile(path.join(destination,"private","vault.key")));
    assert(fresh!==initial.original_vault_fingerprint,"Cold receiving reused the former private key.");
    const mobile=await inspectViews("cold-restored",390);
    await navigate("queries");await page.screenshot({path:path.join(operation,"screenshots","restored-mobile.png"),fullPage:true});
    return {recovery_id:result.id,workspace_path:destination,workspace_id:current.workspace_id,original_heads_verified:state.exported_heads.length,
      fresh_local_key:true,restored_source_revision:row(current,"source",revised.id).revision,mobile_views:mobile};
  });
  assert(thisErrors.length===0,"Browser/operator errors were observed: "+JSON.stringify(thisErrors));
  state.status="complete";state.completed_at=now();
  const result={schema:"commons-semantic-ui-receiving-result/1",status:"PASS",operation_id:state.operation_id,
    workspace_id:initial.workspace_id,completed_at:state.completed_at,
    original_native_jobs:initial.original_jobs.length,new_reviewed_edition_native_jobs:4,
    source_revision:revised.revision,mapping_revision:mapped.revision,snapshot:reference(snapshot),
    typed_query:{id:query.id,rows:query.payload.summary.rows_returned,complete:query.payload.summary.result_complete},
    comparison:{id:comparison.id,...comparison.payload.summary},review_decision:comparison.review.id,
    desktop_views:state.steps["desktop-views"].result,mobile_views:restored.mobile_views,
    receiving:receiver,cold_restore:restored,encrypted:{bytes:exported.encrypted.download.bytes,sha256:exported.encrypted.download.sha256},
    parent_handoff:{bytes:exported.handoff.download.bytes,sha256:exported.handoff.download.sha256},
    original_validation_outcomes:initial.original_validation,published_modular_validation:{id:profileValidation.record.id,...profileValidation.record.payload.summary},
    downloads:state.downloads.map(d=>({path:d.path,bytes:d.bytes,sha256:d.sha256,artifact_id:d.artifact_id})),
    browser_errors:[],customer_calls:0,source_path:ROOT,closed:false};
  atomicJSON(resultFile,result);persist();
}catch(error){
  failure=error;state.status="interrupted";state.error={at:now(),message:error.message,stack:error.stack};
  state.errors.push(...thisErrors);persist();
  console.error(JSON.stringify({status:"interrupted",operation_id:state.operation_id,error:error.message}));
}finally{
  try{await closeHost();state.closed_at=now();persist();}
  catch(error){failure||=error;state.cleanup_error=error.message;persist();}
  if(state.status==="complete"&&!failure){
    const result=await readJSON(resultFile);result.closed=true;result.closed_at=state.closed_at;
    atomicJSON(resultFile,result);console.log(JSON.stringify(result));
  }
  await lease.close();
}
if(failure)process.exit(1);
