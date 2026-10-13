/* Original client source, retained native operations and complete receiving. */
"use strict";
const $ = (id) => document.getElementById(id);
const S = {meta:null, projects:[], projectId:null, project:null, pages:{}, editionCache:new Map(),
  draft:null, draftKey:null, tab:"source", viewEditionId:null, selectedFile:null, loadedFile:null,
  run:null, logOffset:0, nodeOffset:0, node:null, received:null, pending:null, busy:false, refreshing:false};
let database, saveTimer, jsonDownload, projectDialogMode="create", projectDialogRevision=null, projectDialogScope=null;
const bus = "BroadcastChannel" in window ? new BroadcastChannel("pipeline-staff-state") : null;
const pageNames = {edition:"editions",contract:"contracts",binding:"bindings",run:"runs",
  comparison:"comparisons",review:"reviews",release:"releases"};
const EMPTY_CONTRACT = {label:"",owner:"",purpose:"",command:"build",select:"",exclude:"",vars:{},
  threads:1,full_refresh:false,fail_fast:false,install_dependencies:false,generate_catalog:false,expectations:[],notes:""};
const EMPTY_BINDING = {label:"Local DuckDB",mode:"managed_duckdb",python_executable:"",
  dbt_executable:"dbt",target:"local"};
function element(tag, text, className){const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;}
function clear(id){$(id).replaceChildren();return $(id);}
function pretty(value){return JSON.stringify(value,null,2);}
function copy(value){return JSON.parse(JSON.stringify(value));}
function writerKey(meta=S.meta){return meta?JSON.stringify([meta.workspace_id,meta.selection?.root??null,meta.selection?.receiving_id??null]):null;}
function scopedDraftKey(meta,id){return "draft:"+encodeURIComponent(writerKey(meta))+":"+id;}
function projectFormKey(scope){return "project-form:"+encodeURIComponent(scope.writer_key)+":"+scope.mode+":"+(scope.project_id||"new");}
function mergeRows(old,rows){const map=new Map(old.map(x=>[x.id,x]));for(const row of rows)map.set(row.id,row);return [...map.values()].sort((a,b)=>(b.created_at||"").localeCompare(a.created_at||""));}
function report(error){const message=error && error.message ? error.message : String(error);notice(message+(error.details?"\n"+pretty(error.details):""),true);}
function notice(message,error=false){const n=$("notice");n.textContent=message;n.dataset.error=String(error);n.hidden=!message;}
function bind(id,event,handler){$(id).addEventListener(event,(e)=>{try{Promise.resolve(handler(e)).catch(report);}catch(error){report(error);}});}
function actionButton(label,fn){const b=element("button",label);b.type="button";b.addEventListener("click",()=>Promise.resolve().then(fn).catch(report));return b;}
function badge(value){return element("span",value,"tag");}
function recordButton(row,kind){return actionButton(row.label||row.id,()=>showJSON(kind+" record",row));}
function showJSON(title,value){$("json-dialog-title").textContent=title;$("json-dialog-content").textContent=pretty(value);jsonDownload={title,value};$("json-dialog").showModal();}
function table(id,headers,rows,render,empty="No saved records yet."){
  const box=clear(id);if(!rows.length){box.append(element("p",empty,"empty-table"));return;}
  const wrap=element("div",undefined,"table-wrap"),t=element("table"),head=element("thead"),tr=element("tr");
  for(const title of headers)tr.append(element("th",title));head.append(tr);t.append(head);const body=element("tbody");
  for(const row of rows){const r=element("tr");for(const value of render(row)){const cell=element("td");if(value instanceof Node)cell.append(value);else cell.textContent=value==null?"—":String(value);r.append(cell);}body.append(r);}t.append(body);wrap.append(t);box.append(wrap);
}
function fillSelect(id,rows,{empty,selected,label}={}){
  const select=$(id),old=selected===undefined?select.value:selected;select.replaceChildren();
  if(empty!==undefined){const o=element("option",empty);o.value="";select.append(o);}
  for(const row of rows){const option=element("option",label?label(row):(row.label||row.id));option.value=row.id;select.append(option);}
  if([...select.options].some(o=>o.value===old))select.value=old;else if(empty!==undefined)select.value="";
}
function utf8ToBase64(text){return bytesToBase64(new TextEncoder().encode(text));}
function bytesToBase64(bytes){let binary="";for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);}
function base64ToBytes(value){const binary=atob(value),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;}
async function hashBytes(bytes){const result=await crypto.subtle.digest("SHA-256",bytes);return [...new Uint8Array(result)].map(x=>x.toString(16).padStart(2,"0")).join("");}
function saveBlob(name,blob){const url=URL.createObjectURL(blob),a=element("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function saveJSON(name,value){saveBlob(name,new Blob([pretty(value)+"\n"],{type:"application/json"}));}
function fileName(label,extension="json"){return String(label).replace(/[^A-Za-z0-9._-]+/g,"-").slice(0,140)+"."+extension;}
async function openDatabase(){
  return new Promise((resolve,reject)=>{const request=indexedDB.open("pipeline-staff",1);
    request.onupgradeneeded=()=>request.result.createObjectStore("kv");
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}
async function readKV(key){return new Promise((resolve,reject)=>{const tx=database.transaction("kv","readonly"),r=tx.objectStore("kv").get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function writeKV(key,value){return new Promise((resolve,reject)=>{const tx=database.transaction("kv","readwrite");tx.objectStore("kv").put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
async function changeKV(key,fn){return new Promise((resolve,reject)=>{const tx=database.transaction("kv","readwrite"),store=tx.objectStore("kv"),r=store.get(key);let result;
  r.onsuccess=()=>{try{result=fn(r.result);if(result===undefined)store.delete(key);else store.put(result,key);}catch(error){tx.abort();reject(error);}};
  tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error("The browser storage transaction did not complete"));});}
async function flushDraft(){if(saveTimer){clearTimeout(saveTimer);saveTimer=null;}if(S.draft&&S.draftKey)await writeKV(S.draftKey,S.draft);}
function changed(section){if(!S.draft)return;S.draft.generation++;if(section)S.draft[section].dirty=true;clearTimeout(saveTimer);saveTimer=setTimeout(()=>{flushDraft().catch(report);},250);}
function makeDraft(project,meta){return {generation:0,source:{base:project.edition?.id||null,revision:meta.revision,files:{},delete_paths:[],dirty:false,label:project.edition?project.edition.label+" / revised":"Initial project",notes:"",conflicts:null},
  contract:{text:pretty(project.contract?.contract||EMPTY_CONTRACT),revision:meta.revision,base:project.contract?.id||null,dirty:false},
  binding:{value:copy(project.binding?.binding||EMPTY_BINDING),revision:meta.revision,base:project.binding?.id||null,dirty:false},
  forms:{reviewer:"",review_comment:"",review_decision:"revise",release_label:"",release_notes:"",comparison_label:""}};}
async function parseResponse(response){let value;try{value=await response.json();}catch{throw new Error("The server returned an incomplete response.");}
  if(!response.ok){const error=new Error(value.error?.message||"Request failed ("+response.status+")");error.details=value.error?.details;error.status=response.status;error.code=value.error?.code;throw error;}return value;}
async function requestJSON(url,options){const response=await fetch(url,{credentials:"same-origin",...options});if(response.status===401)showSession();return parseResponse(response);}
async function read(action,payload={}){
  const selected=writerKey();
  const value=await requestJSON("/api/read?action="+encodeURIComponent(action)+"&payload="+encodeURIComponent(JSON.stringify(payload)));
  if(selected!==writerKey()||value.selection&&writerKey(value)!==selected)
    throw new Error("The selected writer changed while this read was in progress. Refresh to load its saved state.");
  if(S.meta&&S.meta.workspace_id===value.workspace_id&&Number.isInteger(value.revision))S.meta.revision=Math.max(S.meta.revision,value.revision);
  return value.result;
}
function showSession(){$("session-screen").hidden=false;$("shell").hidden=true;}
async function connect(capability){
  await requestJSON("/api/session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({capability})});
  $("session-key").value="";$("session-screen").hidden=true;$("shell").hidden=false;history.replaceState(null,"",location.pathname+location.search);
}
async function withRequestLock(fn){if(navigator.locks)return navigator.locks.request("pipeline-staff-original-request",fn);return fn();}
function showPending(pending){
  S.pending=pending;$("pending-panel").hidden=!pending;
  if(pending){let body={};try{body=JSON.parse(pending.body);}catch{};$("pending-description").textContent=(body.action||pending.endpoint)+" · "+pending.request_id+" · "+(pending.response?"Completed response retained; apply it to current state.":"Resume the exact saved request and payload.");}
}
async function mutate(action,payload,{revision,context}={}){
  if(!S.meta)throw new Error("Open a workspace first.");
  return postRetained("/api/invoke",{action,payload,workspace_id:S.meta.workspace_id,
    expected_revision:revision===undefined?S.meta.revision:revision,request_id:crypto.randomUUID()},
    {action,workspace_id:S.meta.workspace_id,project_id:S.projectId,generation:S.draft?.generation,draft_key:S.draftKey,...context});
}
async function postRetained(endpoint,body,context={}){
  if(!S.meta?.selection)throw new Error("Refresh the original selected writer before preparing this request.");
  body={...body,selection:copy(S.meta.selection)};
  context={...context,workspace_id:body.workspace_id,selection:copy(body.selection),
    selection_key:writerKey({workspace_id:body.workspace_id,selection:body.selection})};
  await flushDraft();
  return withRequestLock(async()=>{
    const pending={request_id:body.request_id,endpoint,body:JSON.stringify(body),context,created_at:new Date().toISOString()};
    await changeKV("pending",(old)=>{if(old)throw new Error("Resolve the original retained request before another write.");return pending;});
    showPending(pending);bus?.postMessage({type:"pending"});return resolvePendingUnlocked();
  });
}
async function resolvePending(){return withRequestLock(resolvePendingUnlocked);}
async function resolvePendingUnlocked(){
  let pending=await readKV("pending");showPending(pending);if(!pending)return null;
  S.busy=true;
  try{
    if(!pending.response){
      let response,raw;
      try{response=await fetch(pending.endpoint,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:pending.body});raw=await response.text();}
      catch(error){throw new Error("The original request remains in this browser. Resolve it after the connection returns. "+error.message);}
      let value;try{value=JSON.parse(raw);}catch{throw new Error("The original request has no complete JSON response. Its request ID and body remain retained.");}
      if(response.status>=500||value.outcome_unknown)throw new Error(value.error?.message||"The original request has an unknown outcome. Resolve this same request.");
      pending={...pending,response:{status:response.status,body:raw}};
      await changeKV("pending",old=>{if(old?.request_id!==pending.request_id)throw new Error("The retained request changed in another tab.");return pending;});
      showPending(pending);
    }
    const value=JSON.parse(pending.response.body),success=pending.response.status>=200&&pending.response.status<300;
    await writeKV("lastResponse",{request_id:pending.request_id,endpoint:pending.endpoint,request_body:pending.body,
      response_status:pending.response.status,response_body:pending.response.body,received_at:new Date().toISOString()});
    if(success&&!pending.applied){await applySuccess(pending,value);if(S.draft)hydrateEditors();await flushDraft();pending={...pending,applied:true};await writeKV("pending",pending);}
    await refresh({force:true});
    await changeKV("pending",old=>old?.request_id===pending.request_id?undefined:old);
    showPending(await readKV("pending"));bus?.postMessage({type:"completed",request_id:pending.request_id});
    if(!success){const error=new Error(value.error?.message||"The original request was rejected.");error.details=value.error?.details;error.status=pending.response.status;throw error;}
    notice("Saved "+(JSON.parse(pending.body).action||pending.endpoint)+" · original request "+pending.request_id);
    return value;
  }finally{S.busy=false;}
}
async function applySuccess(pending,answer){
  const ctx=pending.context||{},body=JSON.parse(pending.body),p=body.payload||{},result=answer.result||{};
  const selected=!!ctx.selection_key&&ctx.selection_key===writerKey();
  if(selected&&body.action==="project.create")S.projectId=result.id;
  const current=selected&&ctx.workspace_id===S.meta?.workspace_id&&ctx.project_id===S.projectId;
  const expectedDraft=ctx.selection_key&&ctx.project_id?"draft:"+encodeURIComponent(ctx.selection_key)+":"+ctx.project_id:null;
  const storedDraft=ctx.draft_key===expectedDraft?ctx.draft_key:null;
  const d=current?S.draft:storedDraft?await readKV(storedDraft):null;
  if(d){
    if(body.action==="edition.save"&&d.source.base!==result.id){
      for(const f of p.files||[])if(d.source.files[f.path]?.content_base64===f.content_base64)delete d.source.files[f.path];
      d.source.delete_paths=d.source.delete_paths.filter(path=>!(p.delete_paths||[]).includes(path));
      d.source.base=result.id;d.source.revision=answer.revision;d.source.conflicts=null;
      if(d.source.label===p.label)d.source.label=result.label+" / revised";
      if(d.generation===ctx.generation)d.source.notes="";
      d.source.dirty=Object.keys(d.source.files).length>0||d.source.delete_paths.length>0;
      if(current){S.editionCache.set(result.id,result);S.viewEditionId=result.id;}
    }
    if(body.action==="contract.save"){let current;try{current=JSON.parse(d.contract.text);}catch{}
      if(current&&JSON.stringify(current)===JSON.stringify(p.contract)){d.contract.text=pretty(result.contract);d.contract.dirty=false;}
      d.contract.base=result.id;d.contract.revision=answer.revision;}
    if(body.action==="binding.save"){
      if(JSON.stringify(normalizedBinding(d.binding.value))===JSON.stringify(p.binding)){d.binding.value=copy(result.binding);d.binding.dirty=false;}
      d.binding.base=result.id;d.binding.revision=answer.revision;}
    if(body.action==="release.create"&&d.forms.release_label===p.label){d.forms.release_label="";d.forms.release_notes="";}
    if(body.action==="review.save"&&d.forms.review_comment===p.comment)d.forms.review_comment="";
    if(storedDraft&&d!==S.draft)await writeKV(storedDraft,d);
  }
  if(ctx.project_form_key&&["project.create","project.update"].includes(body.action)){
    await changeKV(ctx.project_form_key,saved=>saved?.writer_key===ctx.selection_key&&
      saved.label===p.label&&saved.description===p.description&&saved.project_id===(p.id||null)?undefined:saved);
  }
  if(selected&&(body.action==="run.execute"||body.action==="run.retry")){S.run=result;S.logOffset=0;$("run-log").textContent="";S.tab="runs";}
}
async function refresh({force=false}={}){
  if(S.refreshing&&!force)return;S.refreshing=true;
  try{
    await flushDraft();const meta=await requestJSON("/api/state"),switched=writerKey(S.meta)!==writerKey(meta);
    if(switched){
      if($("project-dialog").open){await retainProjectForm();$("project-dialog").close();}
      if($("import-dialog").open)$("import-dialog").close();
      S.projectId=null;S.project=null;S.draft=null;S.draftKey=null;S.run=null;S.editionCache.clear();S.pages={};
      S.selectedFile=null;S.loadedFile=null;S.viewEditionId=null;S.logOffset=0;S.nodeOffset=0;S.node=null;
      $("file-editor").value="";$("run-log").textContent="";projectDialogScope=null;
    }
    S.meta=meta;S.projects=switched?meta.projects.items:mergeRows(S.projects,meta.projects.items);
    $("workspace-badge").textContent=meta.workspace_id+" · revision "+meta.revision;
    renderProjects();$("projects-more").hidden=meta.projects.next_offset==null;
    if(!S.projectId&&S.projects.length)S.projectId=S.projects[0].id;
    if(S.projectId)await loadProject(S.projectId,{preserve:true});else{$("empty-project").hidden=false;$("project-workspace").hidden=true;}
    if(!$("receiving-workspace").hidden)await renderReceiving();
    const last=await readKV("lastResponse");if(last)$("last-response").textContent=last.response_body;
  }finally{S.refreshing=false;}
}
function renderProjects(){
  const filter=$("project-filter").value.toLowerCase(),box=clear("projects");
  for(const p of S.projects.filter(p=>(p.label+" "+p.description).toLowerCase().includes(filter))){
    const b=actionButton(p.label,()=>selectProject(p.id));b.className="project-item";b.setAttribute("aria-current",String(p.id===S.projectId));b.append(element("small",p.description||p.id));box.append(b);}
}
async function selectProject(id){await flushDraft();S.projectId=id;S.project=null;S.draft=null;S.draftKey=null;S.run=null;S.viewEditionId=null;S.selectedFile=null;S.loadedFile=null;S.pages={};await loadProject(id);renderProjects();$("receiving-workspace").hidden=true;$("project-workspace").hidden=false;}
async function loadProject(id,{preserve=false}={}){
  const project=await read("project.get",{id}),bindings=await read("records.list",{kind:"binding",project_id:id,limit:100});
  const changedProject=S.project?.project.id!==id;S.project=project;
  for(const [kind,name] of Object.entries(pageNames)){const page=kind==="binding"?bindings:project[name];if(!page)continue;const old=preserve?S.pages[kind]?.items||[]:[];S.pages[kind]={...page,items:mergeRows(old,page.items)};}
  for(const edition of S.pages.edition.items)S.editionCache.set(edition.id,edition);
  const key=scopedDraftKey(S.meta,id);
  if(S.draftKey!==key){S.draftKey=key;S.draft=await readKV(key)||makeDraft(project,S.meta);hydrateEditors();}
  if(!S.viewEditionId)S.viewEditionId=S.draft.source.base||project.edition?.id||null;
  $("empty-project").hidden=true;if($("receiving-workspace").hidden)$("project-workspace").hidden=false;
  $("project-title").textContent=project.project.label;$("project-description").textContent=project.project.description;
  $("selected-edition").textContent=project.edition?"Current edition: "+project.edition.label:"No source edition saved";
  $("execution-slot").textContent=S.meta.native_available?"Execution slot available":"Original native operation owns the execution slot";
  renderTabs();await renderSource();renderSavedLibraries();renderContractStatus();renderBindingStatus();
  if(S.run&&S.run.project_id===id)await loadRun(S.run.id,{preserveLog:true});
}
function hydrateEditors(){
  if(!S.draft)return;const d=S.draft;$("edition-label").value=d.source.label;$("edition-notes").value=d.source.notes;
  $("contract-json").value=d.contract.text;syncContractFields();syncBindingFields();
  $("review-reviewer").value=d.forms.reviewer||"";$("review-comment").value=d.forms.review_comment||"";
  $("review-decision").value=d.forms.review_decision||"revise";$("release-label").value=d.forms.release_label||"";
  $("release-notes").value=d.forms.release_notes||"";$("compare-label").value=d.forms.comparison_label||"";
}
function setTab(name){S.tab=name;renderTabs();}
function renderTabs(){for(const button of $("tabs").querySelectorAll("[data-tab]"))button.setAttribute("aria-selected",String(button.dataset.tab===S.tab));for(const name of ["source","contract","binding","runs","compare","reviews","releases"])$("tab-"+name).hidden=name!==S.tab;}
async function pageMore(kind){
  const old=S.pages[kind];if(!old||old.next_offset==null)return;const page=await read("records.list",{kind,project_id:S.projectId,offset:old.next_offset,limit:100});
  S.pages[kind]={...page,items:mergeRows(old.items,page.items)};if(kind==="edition")for(const row of page.items)S.editionCache.set(row.id,row);
  renderSavedLibraries();if(kind==="edition")await renderSource();
}
async function allSelections(){for(const kind of ["edition","contract","binding","run"])while(S.pages[kind]?.next_offset!=null)await pageMore(kind);notice("All saved execution selections for this client are loaded.");}
async function edition(id){if(!id)return null;if(!S.editionCache.has(id))S.editionCache.set(id,await read("edition.get",{id}));return S.editionCache.get(id);}
function draftRevisionMessage(section){const d=S.draft[section];return "Draft revision "+d.revision+" · current workspace revision "+S.meta.revision+(d.revision!==S.meta.revision?" · review current changes before saving":"")+(d.dirty?" · unsaved edits retained":"");}
async function downloadArchive(url,defaultName){
  notice("Preparing the complete archive…");
  const response=await fetch(url+(url.includes("?")?"&":"?")+"request_id="+crypto.randomUUID(),{credentials:"same-origin"});
  if(!response.ok){await parseResponse(response);return;}const blob=await response.blob(),bytes=new Uint8Array(await blob.arrayBuffer());
  const expected=response.headers.get("X-Archive-Sha256"),actual=await hashBytes(bytes);
  if(!expected||actual!==expected)throw new Error("The downloaded archive differs from its retained identity. The original saved work remains available.");
  const match=/filename="([^"]+)"/.exec(response.headers.get("Content-Disposition")||"");
  const name=match?match[1]:defaultName;
  await writeKV("lastDownload",{name,bytes:blob.size,sha256:actual,workspace_id:response.headers.get("X-Workspace-Id"),
    revision:response.headers.get("X-Workspace-Revision"),receiving_id:response.headers.get("X-Receiving-Id")});
  saveBlob(name,blob);notice("Downloaded "+name+" · "+blob.size+" bytes · SHA-256 "+actual);
}


function validateSourcePath(path){
  if(!path||path.length>512||path.startsWith("/")||path.includes("\\")||path.includes("\0")||path.split("/").some(x=>!x||x==="."||x===".."))return "unsafe_relative_path";
  const parts=path.split("/"),name=parts.at(-1),lower=name.toLowerCase();
  if(parts.some(x=>["target","logs","dbt_packages",".git",".venv","node_modules"].includes(x)))return "generated_or_installed_path";
  if(["profiles.yml","profiles.yaml",".env","credentials.json","service-account.json"].includes(lower)||name.startsWith(".env."))return "private_profile";
  if(!/\.(sql|yml|yaml|csv|json|md|txt|lock)$/i.test(name)&&name!==".gitignore")return "unsupported_source";
  return null;
}
function b64Size(value){return value.length*3/4-(value.endsWith("==")?2:value.endsWith("=")?1:0);}
function sourceRows(saved){
  const map=new Map((saved?.files||[]).map(x=>[x.path,{...x}]));
  if(S.viewEditionId===S.draft.source.base){for(const [path,row] of Object.entries(S.draft.source.files))map.set(path,{path,bytes:b64Size(row.content_base64),sha256:row.sha256||null,changed:true});for(const path of S.draft.source.delete_paths)if(map.has(path))map.set(path,{...map.get(path),deleted:true});}
  return [...map.values()].sort((a,b)=>a.path.localeCompare(b.path));
}
async function renderSource(){
  if(!S.project||!S.draft)return;
  fillSelect("edition-select",S.pages.edition.items,{empty:S.pages.edition.items.length?undefined:"No saved edition",selected:S.viewEditionId||"",
    label:row=>row.label+(row.id===S.project.project.edition_id?" · current":"")+" · "+row.id});
  $("editions-more").hidden=S.pages.edition.next_offset==null;
  const saved=await edition(S.viewEditionId),rows=sourceRows(saved),filter=$("file-filter").value.toLowerCase(),box=clear("source-files");
  $("source-identity").textContent=saved?saved.id+" · "+saved.source_sha256:"Initial source draft · save the original dbt_project.yml with its project files";
  for(const row of rows.filter(x=>x.path.toLowerCase().includes(filter))){
    const b=actionButton(row.path,()=>loadFile(row.path));b.className="file-item";b.setAttribute("aria-current",String(row.path===S.selectedFile));
    b.append(element("small",(row.deleted?"Deleted in draft":row.changed?"Changed in draft":row.bytes+" bytes")));box.append(b);
  }
  if(!rows.length)box.append(element("p","No source files. Import the client’s original project.","quiet"));
  if($("edition-label").value!==S.draft.source.label)$("edition-label").value=S.draft.source.label;
  if($("edition-notes").value!==S.draft.source.notes)$("edition-notes").value=S.draft.source.notes;renderChanges();
  if(S.selectedFile&&rows.some(x=>x.path===S.selectedFile)){
    if(S.loadedFile?.editionId!==S.viewEditionId)await loadFile(S.selectedFile);
  }else if(rows.length)await loadFile(rows[0].path);
  else{S.selectedFile=null;S.loadedFile=null;$("file-title").textContent="Select a source file";$("file-editor").value="";$("file-editor").disabled=true;$("file-download").disabled=true;$("file-delete").disabled=true;$("file-identity").textContent="";}
}
async function loadFile(path){
  await flushDraft();const source=S.draft.source,inDraft=S.viewEditionId===source.base;let row;
  if(inDraft&&source.files[path]){
    const item=source.files[path],raw=base64ToBytes(item.content_base64);let content=null;
    try{content=new TextDecoder("utf-8",{fatal:true}).decode(raw);}catch{}
    row={path,bytes:raw.length,sha256:item.sha256||null,content,content_base64:item.content_base64,draft:true};
  }else row=await read("file.read",{edition_id:S.viewEditionId,path});
  S.selectedFile=path;S.loadedFile={editionId:S.viewEditionId,data:row};
  $("file-title").textContent=path;$("file-identity").textContent=row.bytes+" bytes"+(row.sha256?" · SHA-256 "+row.sha256:" · unsaved draft bytes");
  $("file-editor").value=row.content??"";$("file-editor").disabled=!inDraft||row.content===null||source.delete_paths.includes(path);
  $("file-binary").hidden=row.content!==null;$("file-download").disabled=false;
  const savedEdition=await edition(S.viewEditionId);$("file-download").textContent=savedEdition?.files.some(x=>x.path===path)?"Download original bytes":"Download staged bytes";$("file-delete").disabled=!inDraft||source.delete_paths.includes(path);
  for(const button of $("source-files").querySelectorAll(".file-item"))button.setAttribute("aria-current",String(button.firstChild?.textContent===path));
}
function renderChanges(){
  if(!S.draft)return;const d=S.draft.source,box=clear("source-changes"),files=Object.keys(d.files).sort(),deleted=d.delete_paths;
  $("source-draft-status").textContent=draftRevisionMessage("source");
  if(!files.length&&!deleted.length)box.append(element("p","No staged file changes. Source notes and an edition label can still accompany a new saved edition.","quiet"));
  else{const ul=element("ul",undefined,"change-list");for(const path of files){const li=element("li");li.append(element("span",path),element("span","Save · "+b64Size(d.files[path].content_base64)+" bytes"));ul.append(li);}for(const path of deleted){const li=element("li");li.append(element("span",path),element("span","Delete"));ul.append(li);}box.append(ul);}
  const conflicts=clear("source-conflicts");
  if(d.conflicts){const container=element("div",undefined,"conflicts");container.append(element("h3","Saved source changed while this draft was open"),element("p","Choose how to resolve each overlapping path. Other draft changes are preserved."));
    for(const item of d.conflicts.items){const row=element("div",undefined,"conflict-row");row.append(element("span",item.path));const select=element("select");
      for(const [value,label] of [["","Choose a resolution"],["draft","Keep my draft"],["current","Use current saved file"]]){const o=element("option",label);o.value=value;select.append(o);}select.value=item.choice||"";select.addEventListener("change",()=>{item.choice=select.value;changed("source");});row.append(select);container.append(row);}
    container.append(actionButton("Apply source rebase",applySourceRebase));conflicts.append(container);
  }
}
async function addFile(){
  if(!S.draft)throw new Error("Create a client project first.");const path=prompt("Project-relative source path, for example models/orders.sql");if(path===null)return;
  const problem=validateSourcePath(path);if(problem)throw new Error("Use a supported project-relative source path: "+problem);
  const base=await edition(S.draft.source.base);if(base?.files.some(x=>x.path===path)||S.draft.source.files[path])throw new Error("That path exists. Select it in the file list to edit it.");
  S.draft.source.files[path]={content_base64:""};S.draft.source.delete_paths=S.draft.source.delete_paths.filter(x=>x!==path);
  changed("source");S.viewEditionId=S.draft.source.base;await renderSource();await loadFile(path);
}
async function deleteFile(){
  const path=S.selectedFile;if(!path)return;if(path==="dbt_project.yml")throw new Error("Keep the original dbt_project.yml in the source edition.");
  const base=await edition(S.draft.source.base);delete S.draft.source.files[path];
  if(base?.files.some(x=>x.path===path)&&!S.draft.source.delete_paths.includes(path))S.draft.source.delete_paths.push(path);
  changed("source");await renderSource();$("file-editor").disabled=true;$("file-delete").disabled=true;
}
async function saveSource(){
  const d=S.draft.source;await mutate("edition.save",{project_id:S.projectId,base_edition_id:d.base,label:d.label,source_notes:d.notes,
    files:Object.entries(d.files).map(([path,row])=>({path,content_base64:row.content_base64})),delete_paths:[...d.delete_paths]},
    {revision:d.revision,context:{source_base:d.base}});
}
async function reviewSourceRebase(){
  await refresh();const d=S.draft.source,current=S.project.edition;
  if((current?.id||null)===d.base){d.revision=S.meta.revision;d.conflicts=null;changed();await flushDraft();renderChanges();notice("The source draft now uses the current workspace revision.");return;}
  if(!d.base){
    const touched=new Set([...Object.keys(d.files),...d.delete_paths]),overlap=(current?.files||[]).filter(x=>touched.has(x.path)).map(x=>({path:x.path,choice:""}));
    d.conflicts={target:current.id,revision:S.meta.revision,items:overlap};
  }else{
    const delta=await read("edition.diff",{before_id:d.base,after_id:current.id}),touched=new Set([...Object.keys(d.files),...d.delete_paths]);
    d.conflicts={target:current.id,revision:S.meta.revision,items:delta.files.filter(x=>touched.has(x.path)).map(x=>({path:x.path,kind:x.kind,choice:""}))};
  }
  changed();if(!d.conflicts.items.length)await applySourceRebase();else{await flushDraft();renderChanges();}
}
async function applySourceRebase(){
  const d=S.draft.source,c=d.conflicts;if(!c)return;
  if(c.items.some(x=>!x.choice))throw new Error("Choose a resolution for every overlapping source path.");
  for(const item of c.items)if(item.choice==="current"){delete d.files[item.path];d.delete_paths=d.delete_paths.filter(x=>x!==item.path);}
  const current=await edition(c.target),paths=new Set(current.files.map(x=>x.path));d.delete_paths=d.delete_paths.filter(x=>paths.has(x));
  d.base=c.target;d.revision=c.revision;d.conflicts=null;S.viewEditionId=c.target;S.loadedFile=null;changed("source");await flushDraft();await renderSource();notice("Source rebase applied to the draft. Save a new edition when ready.");
}
async function discardSource(){
  if(!confirm("Discard only this local source draft and load the current saved edition?"))return;
  const fresh=makeDraft(S.project,S.meta);S.draft.source=fresh.source;S.viewEditionId=fresh.source.base;S.loadedFile=null;changed();await flushDraft();await renderSource();
}
async function stageImport(){
  if(!S.draft)throw new Error("Create a client project first.");
  const zip=$("source-zip").files[0],root=$("source-import-root").value.trim();let result;
  notice("Reading the selected original source…");
  if(zip){
    if(zip.size>512*1024*1024)throw new Error("The source ZIP exceeds 512 MiB.");
    result=await requestJSON("/api/import/source",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({content_base64:bytesToBase64(new Uint8Array(await zip.arrayBuffer())),...(root?{root}:{})})});
  }else{
    const selected=[...($("source-directory").files.length?$("source-directory").files:$("source-individual").files)];
    if(!selected.length)throw new Error("Select the original project directory, source files or a ZIP.");
    const named=selected.map(file=>({file,path:file.webkitRelativePath||file.name}));
    const roots=named.filter(x=>x.path.split("/").at(-1)==="dbt_project.yml").map(x=>x.path.includes("/")?x.path.slice(0,x.path.lastIndexOf("/")):".");
    const chosen=root|| (roots.length===1?roots[0]:null);
    if(!chosen||!roots.includes(chosen)){const error=new Error("Choose the project root containing the intended dbt_project.yml.");error.details={roots};throw error;}
    const prefix=chosen==="."?"":chosen.replace(/\/+$/,"")+"/",files=[],skipped=[],seen=new Set();let total=0;
    for(const entry of named){
      if(!entry.path.startsWith(prefix)){skipped.push({path:entry.path,reason:"outside_selected_project"});continue;}
      const path=entry.path.slice(prefix.length),problem=validateSourcePath(path);
      if(problem){skipped.push({path,reason:problem});continue;}
      if(seen.has(path))throw new Error("The selected source repeats "+path);seen.add(path);
      if(entry.file.size>32*1024*1024)throw new Error(path+" exceeds the 32 MiB source-file limit.");
      total+=entry.file.size;if(total>128*1024*1024)throw new Error("The selected source exceeds 128 MiB.");
      const bytes=new Uint8Array(await entry.file.arrayBuffer());files.push({path,bytes:bytes.length,sha256:await hashBytes(bytes),content_base64:bytesToBase64(bytes)});
    }
    if(!files.some(x=>x.path==="dbt_project.yml"))throw new Error("The edition must retain dbt_project.yml.");
    result={root:chosen,files,skipped,bytes:total};
  }
  for(const file of result.files){S.draft.source.files[file.path]={content_base64:file.content_base64,sha256:file.sha256};S.draft.source.delete_paths=S.draft.source.delete_paths.filter(x=>x!==file.path);}
  changed("source");S.viewEditionId=S.draft.source.base;S.loadedFile=null;await flushDraft();await renderSource();
  $("source-import-report").textContent=pretty({root:result.root,staged_files:result.files.map(x=>({path:x.path,bytes:x.bytes,sha256:x.sha256})),bytes:result.bytes,skipped:result.skipped});
  notice("Staged "+result.files.length+" original source files. Review and save the new edition.");
}
function contractValue(){let value;try{value=JSON.parse($("contract-json").value);}catch{throw new Error("The operating contract JSON is incomplete. Its draft remains intact.");}if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("The operating contract must be a JSON object.");return value;}
function syncContractFields(){
  let value;try{value=JSON.parse($("contract-json").value);}catch{return;}
  for(const key of ["label","owner","purpose","command","threads","select","exclude"])$("contract-"+key).value=value[key]??EMPTY_CONTRACT[key];
  for(const key of ["full_refresh","fail_fast","install_dependencies","generate_catalog"])$("contract-"+key).checked=value[key]??false;
}
function updateContractField(key){
  const value=contractValue(),node=$("contract-"+key);
  value[key]=node.type==="checkbox"?node.checked:key==="threads"?Number(node.value):node.value;
  $("contract-json").value=pretty(value);S.draft.contract.text=$("contract-json").value;changed("contract");renderContractStatus();
}
function renderContractStatus(){$("contract-status").textContent=draftRevisionMessage("contract");}
async function loadCurrentContract(){
  if(S.draft.contract.dirty&&!confirm("Replace this local contract draft with the current saved contract?"))return;
  S.draft.contract={text:pretty(S.project.contract?.contract||EMPTY_CONTRACT),revision:S.meta.revision,base:S.project.contract?.id||null,dirty:false};
  $("contract-json").value=S.draft.contract.text;syncContractFields();changed();await flushDraft();renderContractStatus();
}
async function saveContract(){const contract=contractValue();S.draft.contract.text=$("contract-json").value;await mutate("contract.save",{project_id:S.projectId,contract},{revision:S.draft.contract.revision});}
function normalizedBinding(value){const out=copy(value);if(!out.python_executable)delete out.python_executable;if(!out.dbt_executable)delete out.dbt_executable;if(!out.target)delete out.target;if(out.mode!=="external_profiles")delete out.profiles_dir;return out;}
function syncBindingFields(){
  const value=S.draft.binding.value;for(const key of ["label","mode","python_executable","dbt_executable","target","profiles_dir"])$("binding-"+key).value=value[key]||"";
  $("binding-profiles_dir").disabled=value.mode!=="external_profiles";
  $("binding-mode-description").textContent=value.mode==="external_profiles"?"The original profile directory and selected target are pinned before dispatch on this machine. Configure a receiving machine’s connection explicitly.":"The native worker creates a per-run DuckDB target using this project’s original profile name. A selected successful baseline can supply incremental data.";
}
function renderBindingStatus(){$("binding-status").textContent=draftRevisionMessage("binding");}
function updateBinding(key){S.draft.binding.value[key]=$("binding-"+key).value;changed("binding");if(key==="mode")syncBindingFields();renderBindingStatus();}
async function saveBinding(){await mutate("binding.save",{project_id:S.projectId,binding:normalizedBinding(S.draft.binding.value)},{revision:S.draft.binding.revision});}
async function loadCurrentBinding(){
  if(S.draft.binding.dirty&&!confirm("Replace this local installed binding draft with the current saved binding?"))return;
  S.draft.binding={value:copy(S.project.binding?.binding||EMPTY_BINDING),revision:S.meta.revision,base:S.project.binding?.id||null,dirty:false};syncBindingFields();changed();await flushDraft();renderBindingStatus();
}
async function useCurrentRevision(section){await refresh();S.draft[section].revision=S.meta.revision;changed();await flushDraft();section==="contract"?renderContractStatus():renderBindingStatus();notice("The "+section+" draft now uses the current workspace revision; its content is preserved.");}


function renderSavedLibraries(){
  if(!S.project)return;
  const runs=S.pages.run?.items||[],contracts=S.pages.contract?.items||[],bindings=S.pages.binding?.items||[],editions=S.pages.edition?.items||[];
  const label=row=>(row.label||row.id)+" · "+row.id;
  fillSelect("run-edition",editions,{empty:editions.length?undefined:"Save a source edition",selected:$("run-edition").value||S.project.project.edition_id,label});
  fillSelect("run-contract",contracts,{empty:contracts.length?undefined:"Save an operating contract",selected:$("run-contract").value||S.project.project.contract_id,label});
  fillSelect("run-binding",bindings,{empty:bindings.length?undefined:"Save an installed binding",selected:$("run-binding").value||S.project.project.binding_id,label});
  const byBinding=new Map(bindings.map(x=>[x.id,x]));
  fillSelect("run-baseline",runs.filter(x=>x.state==="succeeded"&&byBinding.get(x.binding_id)?.binding.mode==="managed_duckdb"),{empty:"New managed database",label:row=>row.id+" · "+row.created_at});
  $("run-execute").disabled=!editions.length||!contracts.length||!bindings.length||!S.meta.native_available;
  renderRuns();
  const manifestRuns=runs.filter(x=>x.outcome?.evaluation?.manifest);
  for(const id of ["compare-before","compare-after"])fillSelect(id,manifestRuns,{empty:"Select an original run",label:row=>row.id+" · "+row.state+" · "+row.created_at});
  fillSelect("review-run",runs.filter(x=>["succeeded","failed","cancelled"].includes(x.state)&&x.outcome),{empty:"Select a completed original outcome",label:row=>row.id+" · "+row.state});
  fillSelect("release-review",(S.pages.review?.items||[]).filter(x=>x.decision==="approve"),{empty:"Select an approved review",label:row=>row.reviewer+" · "+row.run_id+" · "+row.created_at});
  for(const kind of ["run","comparison","review","release"])$(pageNames[kind]+"-more").hidden=S.pages[kind]?.next_offset==null;
  table("comparisons-table",["Saved comparison","Before / after","Changed nodes","Saved"],S.pages.comparison?.items||[],row=>[
    actionButton(row.label,()=>showComparison(row)),row.before_run_id+"\n"+row.after_run_id,row.comparison?.changes?.length??0,row.created_at]);
  table("reviews-table",["Decision","Original run","Reviewer","Comment","Saved"],S.pages.review?.items||[],row=>[
    actionButton(row.decision,()=>showJSON("Review",row)),row.run_id,row.reviewer,row.comment,row.created_at]);
  table("releases-table",["Release","Original run","Approved review","Archive"],S.pages.release?.items||[],row=>[
    recordButton(row,"Release"),row.run_id,row.review_id,actionButton("Build & download release",()=>downloadArchive("/api/releases/"+encodeURIComponent(row.id)+"/download",fileName(row.label,"zip")))]);
  updateReviewEligibility();
}
function renderRuns(){
  const filter=$("run-filter").value,rows=(S.pages.run?.items||[]).filter(x=>!filter||x.state===filter);
  table("runs-table",["Original run","State","Source edition","Original Dagster ID","Updated"],rows,row=>[
    actionButton(row.id,()=>loadRun(row.id)),badge(row.state),row.edition_id,row.dagster_run_id,row.updated_at],
    filter?"No loaded runs in this state. Load earlier runs to inspect the complete history.":"No native run has been created.");
}
function definition(id,rows){const box=clear(id),dl=element("dl",undefined,"definition-grid");for(const [label,value] of rows){dl.append(element("dt",label),element("dd",value??"—"));}box.append(dl);}
async function executeRun(){
  const payload={project_id:S.projectId,edition_id:$("run-edition").value,contract_id:$("run-contract").value,binding_id:$("run-binding").value};
  if($("run-baseline").value)payload.base_run_id=$("run-baseline").value;
  await mutate("run.execute",payload);
}
async function loadRun(id,{preserveLog=false}={}){
  const oldId=S.run?.id;S.run=await read("run.get",{id});
  if(S.pages.run){S.pages.run.items=mergeRows(S.pages.run.items,[S.run]);renderSavedLibraries();}
  if(oldId!==id||!preserveLog){S.logOffset=0;$("run-log").textContent="";S.nodeOffset=0;S.node=null;$("node-detail").hidden=true;}
  const run=S.run,evaluation=run.outcome?.evaluation;
  $("run-detail").hidden=false;$("run-title").textContent=run.id;
  definition("run-summary",[["State",run.state],["Original Dagster run",run.dagster_run_id],["Source edition",run.edition_id],
    ["Source SHA-256",run.source_sha256],["Operating contract",run.contract_id],["Installed binding",run.binding_id],
    ["Original request",run.request_id],["Native dispatched",String(run.request_dispatched)],["Parent retry",run.parent_run_id],
    ["Incremental baseline",run.base_run_id],["Outcome SHA-256",run.outcome_sha256]]);
  $("run-start").disabled=!run.can_start;$("run-reconcile").disabled=!run.can_reconcile;$("run-retry").disabled=!run.can_retry;
  $("run-cancel").disabled=["succeeded","failed","cancelled"].includes(run.state);$("run-outcome").disabled=!run.outcome;
  const artifacts=clear("run-artifacts");for(const file of evaluation?.artifact_files||[]){
    const row=element("div",undefined,"artifact-row"),left=element("div",file.path);left.append(element("small",file.bytes+" bytes · SHA-256 "+file.sha256,"mono"));
    row.append(left,actionButton("Download original artifact",()=>downloadArtifact(run.id,file)));artifacts.append(row);}
  if(!artifacts.childNodes.length)artifacts.append(element("p","No original native artifacts have been retained yet.","empty-table"));
  table("run-criteria",["Original node","Accepted statuses","Observed","Required","Decision"],evaluation?.criteria||[],row=>[
    row.unique_id,row.accepted_statuses.join(", "),row.executed?row.observed_status:"Unexecuted",String(row.required),row.passed?"Satisfied":"Unmet"],
    run.outcome?"This contract has no node-level acceptance criteria. Inspect the original command result and operating contract.":"Acceptance is evaluated from the original native outcome.");
  const types=[...new Set((evaluation?.manifest?.nodes||[]).map(x=>x.resource_type).filter(Boolean))].sort();
  fillSelect("node-type",types.map(id=>({id,label:id})),{empty:"All types"});renderNodes();
  if(oldId!==id||!preserveLog)await logNext();
}
async function logNext(){
  if(!S.run)return;const id=S.run.id,page=await read("run.log",{id,offset:S.logOffset,limit:65536});if(S.run?.id!==id)return;
  $("run-log").textContent+=page.content||"";S.logOffset=page.next_offset;
  $("run-log-position").textContent="Read through byte "+page.next_offset+(page.finished?" · native log finished":page.has_more?" · more retained bytes":" · waiting for original native output");
  $("run-log-next").disabled=page.finished&&!page.has_more;
}
async function runControl(action){
  if(!S.run)return;const id=S.run.id;
  if(action==="run.retry"&&!confirm("Create an explicit linked retry of this completed failed or cancelled run?"))return;
  await mutate(action,{id});if(action!=="run.retry")await loadRun(id,{preserveLog:true});
}
async function downloadArtifact(runId,entry){
  const result=await read("run.artifact",{id:runId,path:entry.path}),bytes=base64ToBytes(result.content_base64);
  const digest=await hashBytes(bytes);if(result.bytes!==bytes.length||entry.bytes!==bytes.length||digest!==result.sha256||digest!==entry.sha256)throw new Error("The original artifact differs from its retained byte identity.");
  saveBlob(entry.path.split("/").at(-1),new Blob([bytes],{type:"application/json"}));notice("Downloaded original "+entry.path+" · "+bytes.length+" bytes.");
}
function nativeRows(){
  const evaluation=S.run?.outcome?.evaluation;if(!evaluation)return [];
  const results=new Map((evaluation.results||[]).map(x=>[x.unique_id,x]));
  for(const row of evaluation.freshness||[])if(!results.has(row.unique_id))results.set(row.unique_id,row);
  const manifest=evaluation.manifest?.nodes||[],nodes=new Map(manifest.map(x=>[x.unique_id,x]));
  // Preserve an executed row even if the emitted manifest omits its node definition.
  for(const row of results.values())if(!nodes.has(row.unique_id))nodes.set(row.unique_id,{unique_id:row.unique_id,resource_type:"",original_file_path:"",definition_missing:true});
  return [...nodes.values()].map(node=>({node,result:results.get(node.unique_id)||null})).sort((a,b)=>a.node.unique_id.localeCompare(b.node.unique_id));
}
function renderNodes(){
  const filter=$("node-filter").value.toLowerCase(),state=$("node-state").value,type=$("node-type").value;
  const rows=nativeRows().filter(x=>(!filter||[x.node.unique_id,x.node.original_file_path,x.node.description,x.result?.message].filter(Boolean).join(" ").toLowerCase().includes(filter))&&
    (!state||(state==="executed"?!!x.result:!x.result))&&(!type||x.node.resource_type===type));
  if(S.nodeOffset>=rows.length)S.nodeOffset=Math.max(0,Math.floor((rows.length-1)/100)*100);
  const visible=rows.slice(S.nodeOffset,S.nodeOffset+100);
  $("node-count").textContent=rows.length?"Showing "+(S.nodeOffset+1)+"–"+(S.nodeOffset+visible.length)+" of "+rows.length:"No native nodes";
  $("nodes-prev").disabled=S.nodeOffset===0;$("nodes-next").disabled=S.nodeOffset+100>=rows.length;
  table("nodes-table",["Original unique ID","Type","Source path","Native result","Duration"],visible,row=>[
    actionButton(row.node.unique_id,()=>selectNode(row)),row.node.resource_type,row.node.original_file_path,
    row.result?badge(row.result.status):badge("Unexecuted"),row.result?.execution_time==null?"—":String(row.result.execution_time)+" s"],
    S.run?.outcome?"No original nodes match the current filter.":"The original native outcome has not arrived.");
}
function selectNode(row){
  S.node=row;$("node-detail").hidden=false;$("node-title").textContent=row.node.unique_id;
  $("node-record").textContent=pretty({original_node:row.node,original_result:row.result,
    original_parents:S.run.outcome?.evaluation?.manifest?.parent_map?.[row.node.unique_id]||[],
    original_children:S.run.outcome?.evaluation?.manifest?.child_map?.[row.node.unique_id]||[]});
  $("node-accepted-statuses").value=["success","pass","warn"].includes(row.result?.status)?row.result.status:"";
  $("node-required").checked=true;
}
async function addExpectation(){
  if(!S.node)throw new Error("Select an original native node first.");
  const statuses=$("node-accepted-statuses").value.split(",").map(x=>x.trim()).filter(Boolean);if(!statuses.length)throw new Error("Specify the original dbt statuses the operator accepts for this node.");
  const contract=contractValue(),expectation={unique_id:S.node.node.unique_id,label:S.node.node.name||S.node.node.unique_id,
    accepted_statuses:[...new Set(statuses)],required:$("node-required").checked};
  contract.expectations=contract.expectations||[];if(!Array.isArray(contract.expectations))throw new Error("Contract expectations must be an array.");
  const at=contract.expectations.findIndex(x=>x.unique_id===expectation.unique_id);if(at>=0)contract.expectations[at]={...contract.expectations[at],...expectation};else contract.expectations.push(expectation);
  S.draft.contract.text=pretty(contract);$("contract-json").value=S.draft.contract.text;syncContractFields();changed("contract");await flushDraft();setTab("contract");renderContractStatus();notice("Added the original native node to the operating-contract draft. Save the contract to use it in a later run.");
}
async function createComparison(){
  const before=$("compare-before").value,after=$("compare-after").value;if(!before||!after||before===after)throw new Error("Select two different original runs of this client.");
  const answer=await mutate("comparison.create",{label:$("compare-label").value,before_run_id:before,after_run_id:after});showComparison(answer.result);
}
function showComparison(row){
  const box=clear("comparison-detail");box.append(element("h3",row.label),element("p",row.before_run_id+" → "+row.after_run_id,"mono"),
    actionButton("Download complete comparison",()=>saveJSON(fileName(row.label),row)));
  const source=element("h3","Changed original source paths");box.append(source);
  const paths=element("ul",undefined,"change-list");for(const item of row.source_diff?.files||[]){const li=element("li");li.append(element("span",item.path),element("span",item.kind));paths.append(li);}box.append(paths);
  const changes=element("div");changes.id="comparison-node-changes";box.append(changes);
  table(changes.id,["Native node","Change","Changed fields","Original definitions"],row.comparison?.changes||[],item=>[
    item.unique_id,item.kind,item.changed_fields.join(", "),actionButton("Inspect before / after",()=>showJSON("Original node comparison",item))],"No original native node definitions changed.");
  box.append(element("h3","Downstream original unique IDs"),element("p","These are relationships from the original manifest; execution remains visible in each run’s native results.","quiet"),
    element("pre",(row.comparison?.downstream_unique_ids||[]).join("\n")||"No downstream relationships changed.","json-view"));
}
function updateReviewEligibility(){
  const selected=$("review-run").value,run=(S.pages.run?.items||[]).find(x=>x.id===selected),decision=$("review-decision").value;
  const eligible=!!run&&(decision==="revise"||run.state==="succeeded"&&run.outcome?.evaluation?.criteria_satisfied===true);
  $("review-save").disabled=!eligible;
  $("review-eligibility").textContent=!run?"Select a completed original native outcome.":decision==="approve"&&!eligible?"Approval requires a successful native run and all required operating criteria.":decision==="approve"?"The saved native outcome satisfies the required operating criteria.":"The revision review will retain this exact native outcome and its source/contract identities.";
  fillSelect("review-comparison",(S.pages.comparison?.items||[]).filter(x=>x.after_run_id===selected),{empty:"No comparison",label:row=>row.label+" · "+row.id});
}
async function saveReview(){
  const payload={run_id:$("review-run").value,reviewer:$("review-reviewer").value,decision:$("review-decision").value,comment:$("review-comment").value};
  if($("review-comparison").value)payload.comparison_id=$("review-comparison").value;await mutate("review.save",payload);
}
async function createRelease(){await mutate("release.create",{review_id:$("release-review").value,label:$("release-label").value,operator_notes:$("release-notes").value});}


async function renderReceiving(){
  const value=await requestJSON("/api/received");S.received=value;const rows=Array.isArray(value.items)?value.items:value.items?.items||[];
  table("received-table",["Retained delivery","Current identity","Revision","Action"],rows,row=>{
    const rid=row.receiving_id||row.receipt?.receiving_id,selected=rid===value.selected.receiving_id;
    return [rid||row.root,row.workspace_id||row.receipt?.workspace_id,row.revision??row.receipt?.revision,
      selected?badge("Currently open"):actionButton("Open retained workspace",()=>openReceived(rid))];
  },"No complete delivery has been received in this catalogue.");
  $("open-original").disabled=value.selected.receiving_id==="original";
  const last=await readKV("lastResponse");$("last-response").textContent=last?last.response_body:"No response has been retained in this browser.";
}
async function showReceiving(){await flushDraft();$("project-workspace").hidden=true;$("empty-project").hidden=true;$("receiving-workspace").hidden=false;await renderReceiving();}
async function receiveArchive(){
  const file=$("receiving-file").files[0];if(!file)throw new Error("Select a complete workspace or client-release ZIP.");
  if(file.size>512*1024*1024)throw new Error("The receiving archive exceeds 512 MiB.");
  const bytes=new Uint8Array(await file.arrayBuffer());
  await postRetained("/api/receive",{content_base64:bytesToBase64(bytes),workspace_id:S.meta.workspace_id,
    expected_revision:S.meta.revision,request_id:crypto.randomUUID()},{archive_name:file.name,archive_bytes:file.size,archive_sha256:await hashBytes(bytes)});
  $("receiving-file").value="";$("receiving-selected").textContent="";await renderReceiving();
}
async function openReceived(receivingId){
  if(!receivingId)throw new Error("This receiving record has no original identifier.");
  await postRetained("/api/open",{receiving_id:receivingId,workspace_id:S.meta.workspace_id,expected_revision:S.meta.revision,request_id:crypto.randomUUID()},{receiving_id:receivingId});
  await renderReceiving();
}
async function openProjectDialog(mode){
  await flushDraft();projectDialogMode=mode;projectDialogRevision=S.meta.revision;
  const id=mode==="update"?S.projectId:null;
  projectDialogScope={writer_key:writerKey(),workspace_id:S.meta.workspace_id,
    selection:copy(S.meta.selection),mode,project_id:id};
  const saved=await readKV(projectFormKey(projectDialogScope));
  const recover=saved?.writer_key===projectDialogScope.writer_key&&saved.mode===mode&&saved.project_id===id;
  $("project-dialog-title").textContent=mode==="update"?"Edit client project":"New client project";
  $("project-label").value=recover?saved.label:mode==="update"?S.project.project.label:"";
  $("project-notes").value=recover?saved.description:mode==="update"?S.project.project.description:"";
  if(recover)projectDialogRevision=saved.revision;
  $("project-dialog").showModal();$("project-label").focus();
}
async function retainProjectForm(){
  if(!projectDialogScope)return;
  await writeKV(projectFormKey(projectDialogScope),{...projectDialogScope,
    revision:projectDialogRevision,label:$("project-label").value,description:$("project-notes").value});
}
async function saveProject(event){
  event.preventDefault();await retainProjectForm();
  if(!projectDialogScope||projectDialogScope.writer_key!==writerKey())
    throw new Error("This project draft belongs to another selected writer. Open that writer to continue it.");
  const scope=copy(projectDialogScope),payload={label:$("project-label").value,description:$("project-notes").value};
  if(scope.mode==="update")payload.id=scope.project_id;
  await mutate("project."+scope.mode,payload,{revision:projectDialogRevision,context:{project_form_key:projectFormKey(scope)}});
  $("project-dialog").close();
}
async function showHistory(kind){
  const rows=[];let offset=0;
  do{const page=await read("records.list",{kind,project_id:S.projectId,limit:200,offset});rows.push(...page.items);offset=page.next_offset;}while(offset!=null);
  showJSON("Saved "+kind+" history",rows);
}
async function showAudit(){
  const rows=[];let offset=0;
  do{const page=await read("audit.list",{limit:200,offset});rows.push(...page.items);offset=page.next_offset;}while(offset!=null);
  showJSON("Complete workspace history",rows);
}
function wire(){
  bind("session-connect","click",async()=>{try{await connect($("session-key").value.trim());await resumeBoot();}catch(error){$("session-error").textContent=error.message;}});
  bind("refresh","click",()=>refresh());bind("project-filter","input",renderProjects);
  bind("projects-more","click",async()=>{const page=await read("records.list",{kind:"project",offset:S.projects.length,limit:100});S.projects=mergeRows(S.projects,page.items);$("projects-more").hidden=page.next_offset==null;renderProjects();});
  for(const id of ["new-project","empty-new-project"])bind(id,"click",()=>openProjectDialog("create"));
  bind("edit-project","click",()=>openProjectDialog("update"));bind("project-form","submit",saveProject);
  for(const id of ["project-label","project-notes"])bind(id,"input",retainProjectForm);
  for(const button of document.querySelectorAll("[data-close]"))button.addEventListener("click",()=>$(button.dataset.close).close());
  for(const button of $("tabs").querySelectorAll("[data-tab]"))button.addEventListener("click",()=>setTab(button.dataset.tab));
  bind("resume-request","click",async()=>{if(!await readKV("pending"))await recoverServerRequest();return resolvePending();});
  bind("download-request","click",async()=>{const p=await readKV("pending");if(p)saveJSON("original-pipeline-request.json",p);else notice("The original request is retained by the server; resolve it from this workspace.");});
  bind("source-import-open","click",()=>{$("import-dialog").showModal();});bind("source-add","click",addFile);
  bind("source-import-stage","click",stageImport);
  for(const id of ["source-directory","source-individual","source-zip"])bind(id,"change",()=>{for(const other of ["source-directory","source-individual","source-zip"])if(other!==id)$(other).value="";$("source-import-report").textContent="";});
  bind("edition-select","change",async()=>{await flushDraft();S.viewEditionId=$("edition-select").value||null;S.loadedFile=null;await renderSource();});
  bind("source-use-current","click",async()=>{S.viewEditionId=S.project.edition?.id||null;S.loadedFile=null;await renderSource();});
  bind("editions-more","click",()=>pageMore("edition"));bind("file-filter","input",renderSource);
  bind("file-editor","input",()=>{
    if(!S.draft||!S.selectedFile||S.viewEditionId!==S.draft.source.base)return;
    S.draft.source.files[S.selectedFile]={content_base64:utf8ToBase64($("file-editor").value)};
    S.draft.source.delete_paths=S.draft.source.delete_paths.filter(x=>x!==S.selectedFile);
    changed("source");renderChanges();$("file-identity").textContent=new TextEncoder().encode($("file-editor").value).length+" bytes · unsaved UTF-8 draft";
  });
  bind("file-editor","keydown",(event)=>{if(event.key==="Tab"){event.preventDefault();const e=event.target,start=e.selectionStart,end=e.selectionEnd;e.setRangeText("  ",start,end,"end");e.dispatchEvent(new Event("input"));}});
  bind("file-download","click",async()=>{if(!S.selectedFile)return;const saved=await edition(S.viewEditionId),original=saved?.files.some(x=>x.path===S.selectedFile);const row=original?await read("file.read",{edition_id:S.viewEditionId,path:S.selectedFile}):{path:S.selectedFile,...S.draft.source.files[S.selectedFile]};saveBlob(row.path.split("/").at(-1),new Blob([base64ToBytes(row.content_base64)]));notice("Downloaded "+(original?"the original saved bytes of ":"the staged bytes of ")+row.path);});
  bind("file-delete","click",deleteFile);bind("source-save","click",saveSource);bind("source-rebase","click",reviewSourceRebase);bind("source-discard","click",discardSource);
  bind("edition-label","input",()=>{S.draft.source.label=$("edition-label").value;changed("source");renderChanges();});
  bind("edition-notes","input",()=>{S.draft.source.notes=$("edition-notes").value;changed("source");renderChanges();});
  for(const key of ["label","owner","purpose","command","threads","select","exclude","full_refresh","fail_fast","install_dependencies","generate_catalog"])
    bind("contract-"+key,$("contract-"+key).tagName==="SELECT"||$("contract-"+key).type==="checkbox"?"change":"input",()=>updateContractField(key));
  bind("contract-json","input",()=>{S.draft.contract.text=$("contract-json").value;changed("contract");syncContractFields();renderContractStatus();});
  bind("contract-save","click",saveContract);bind("contract-current","click",loadCurrentContract);bind("contract-rebase","click",()=>useCurrentRevision("contract"));bind("contract-history","click",()=>showHistory("contract"));
  for(const key of ["label","mode","python_executable","dbt_executable","target","profiles_dir"])bind("binding-"+key,key==="mode"?"change":"input",()=>updateBinding(key));
  bind("binding-save","click",saveBinding);bind("binding-current","click",loadCurrentBinding);bind("binding-rebase","click",()=>useCurrentRevision("binding"));
  bind("runtime-status","click",async()=>showJSON("Original runtime state",await read("runtime.get")));
  bind("run-execute","click",executeRun);bind("run-options-more","click",allSelections);bind("run-filter","change",renderRuns);
  bind("run-refresh","click",()=>S.run&&loadRun(S.run.id,{preserveLog:true}));
  for(const verb of ["start","reconcile","cancel","retry"])bind("run-"+verb,"click",()=>runControl("run."+verb));
  bind("run-outcome","click",()=>S.run?.outcome&&saveJSON(fileName(S.run.id+"-outcome"),S.run.outcome));
  bind("run-log-next","click",logNext);bind("run-log-reset","click",async()=>{S.logOffset=0;$("run-log").textContent="";await logNext();});
  for(const id of ["node-filter","node-state","node-type"])bind(id,id==="node-filter"?"input":"change",()=>{S.nodeOffset=0;renderNodes();});
  bind("nodes-prev","click",()=>{S.nodeOffset=Math.max(0,S.nodeOffset-100);renderNodes();});bind("nodes-next","click",()=>{S.nodeOffset+=100;renderNodes();});
  bind("node-add-expectation","click",addExpectation);bind("compare-create","click",createComparison);bind("review-save","click",saveReview);bind("release-create","click",createRelease);
  for(const kind of ["run","comparison","review","release"])bind(pageNames[kind]+"-more","click",()=>pageMore(kind));
  bind("review-run","change",updateReviewEligibility);bind("review-decision","change",()=>{S.draft.forms.review_decision=$("review-decision").value;changed();updateReviewEligibility();});
  for(const [id,key] of [["review-reviewer","reviewer"],["review-comment","review_comment"],["release-label","release_label"],["release-notes","release_notes"],["compare-label","comparison_label"]])
    bind(id,"input",()=>{S.draft.forms[key]=$(id).value;changed();});
  bind("show-receiving","click",showReceiving);bind("receiving-back","click",()=>{$("receiving-workspace").hidden=true;if(S.projectId)$("project-workspace").hidden=false;else $("empty-project").hidden=false;});
  bind("receiving-file","change",()=>{const f=$("receiving-file").files[0];$("receiving-selected").textContent=f?f.name+" · "+f.size+" bytes":"";});
  bind("receive-submit","click",receiveArchive);bind("open-original","click",()=>openReceived("original"));
  bind("backup","click",()=>downloadArchive("/api/backup","client-pipeline-workspace.zip"));bind("show-audit","click",showAudit);
  bind("json-dialog-download","click",()=>jsonDownload&&saveJSON(fileName(jsonDownload.title),jsonDownload.value));
  document.addEventListener("visibilitychange",()=>{if(document.hidden)flushDraft().catch(report);});
  window.addEventListener("pagehide",()=>{flushDraft().catch(()=>{});});
  document.addEventListener("keydown",(event)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="s"&&S.draft){event.preventDefault();const action={source:saveSource,contract:saveContract,binding:saveBinding}[S.tab];if(action)action().catch(report);}});
  bus?.addEventListener("message",async()=>{try{showPending(await readKV("pending"));if(!S.busy)await refresh();}catch(error){report(error);}});
  setInterval(()=>{if(!document.hidden&&!S.busy&&!S.refreshing&&S.run&&["launching","running","interrupted"].includes(S.run.state))
    loadRun(S.run.id,{preserveLog:true}).catch(report);},6000);
}
async function recoverServerRequest(){
  const record=await requestJSON("/api/pending");if(!record)return;
  const pending={request_id:record.request_id,endpoint:record.endpoint,body:JSON.stringify(record.body),
    context:{recovered_from_server:true},created_at:record.created_at};
  await changeKV("pending",old=>old||pending);showPending(await readKV("pending"));
}
async function resumeBoot(){
  const pending=await readKV("pending");showPending(pending);
  if(pending){try{await resolvePending();}catch(error){report(error);if(!S.meta)await refresh();}}
  else{await refresh();if(S.meta.pending_request){$("pending-panel").hidden=false;$("pending-description").textContent="Server retains original request "+S.meta.pending_request.request_id+". Resolve it before another write.";$("download-request").disabled=true;}}
}
async function boot(){
  database=await openDatabase();wire();
  const fragment=new URLSearchParams(location.hash.slice(1)),capability=fragment.get("capability");
  if(capability){await connect(capability);}
  try{await resumeBoot();}catch(error){if(error.status===401)showSession();else throw error;}
}
void boot().catch(report);
