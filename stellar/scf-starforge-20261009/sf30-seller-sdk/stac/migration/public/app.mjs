import {ExactNumber, parseExactJSON, stringifyExactJSON} from "/vector/json.mjs";
const $ = selector => document.querySelector(selector);
const clone = value => parseExactJSON(stringifyExactJSON(value));
const text = value => value === null || value === undefined ? "" : String(value);
const short = value => text(value).slice(0, 12);
const savedKey = "migration-operator-v1";
const sections = [["overview","Overview"],["sources","Sources"],["mapping","Mapping"],["plans","Plans & review"],
                  ["outputs","Native projects"],["publication","Map publication"],["handover","Handover"],["history","History"]];
let workspace, draft, journal = [], db, generation = 0, noticeTimer, publication, actor = "";
let admittingMutation = false, activeRequestId = null;
let current = {view:"overview",captureId:"",layerId:"",planId:"",editionId:"",comparisonId:"",offsets:{},fileQuery:""};
const main = $("#content");
const publicationRoot = document.createElement("div");
const key = suffix => workspace.id + ":" + suffix;

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name,value] of Object.entries(props)) {
    if (name === "value" || name === "checked") continue;
    if (name.startsWith("on") && typeof value === "function") node.addEventListener(name.slice(2).toLowerCase(), value);
    else if (name === "class") node.className = value;
    else if (name === "text") node.textContent = text(value);
    else if (value !== false && value !== null && value !== undefined) node.setAttribute(name,value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false)
    node.append(child instanceof Node ? child : document.createTextNode(text(child)));
  if (Object.hasOwn(props,"value")) node.value = text(props.value);
  if (Object.hasOwn(props,"checked")) node.checked = !!props.checked;
  return node;
}
function btn(label,action,kind="") {
  const node=h("button",{type:"button",class:kind},label);
  node.addEventListener("click",async()=>{if(node.disabled)return;node.disabled=true;try{await run(action);}finally{node.disabled=false;}});
  return node;
}
const panel = (...children) => h("section",{class:"panel"},...children);
const field = (label,node) => h("label",{},label,node);
const input = (value,change,props={}) => h("input",{value,...props,oninput:event=>change(event.target.value)});
const area = (value,change,props={}) => h("textarea",{value,...props,oninput:event=>change(event.target.value)});
const select = (value,options,change,props={}) => h("select",{value,...props,onchange:event=>change(event.target.value)},
  options.map(row=>h("option",{value:Array.isArray(row)?row[0]:row},Array.isArray(row)?row[1]:row)));
const checkbox = (label,value,change) => h("label",{class:"check"},h("input",{type:"checkbox",checked:value,
  onchange:event=>change(event.target.checked)}),label);
const json = value => stringifyExactJSON(value,2);
const detail = (label,value) => { $("#detail-title").textContent=label; $("#detail-body").textContent=typeof value==="string"?value:json(value); $("#detail-dialog").showModal(); };
function table(headers,rows,cls="") { return h("div",{class:"table-wrap"},h("table",{class:cls},
  h("thead",{},h("tr",{},headers.map(x=>h("th",{},x)))),h("tbody",{},rows))); }
const cell = (value,cls="") => h("td",{class:cls},value);
function pager(result,change) {
  const offset=result.offset||0, limit=result.limit||50, total=result.total||0;
  const more=result.hasMore ?? (result.nextOffset!==null && result.nextOffset!==undefined);
  return h("div",{class:"pager"},h("span",{class:"muted"},total?text(offset+1)+"–"+text(Math.min(total,offset+limit))+" of "+text(total):"0 records"),
    h("button",{disabled:offset===0,onclick:()=>run(()=>change(Math.max(0,offset-limit)))}, "Previous"),
    h("button",{disabled:!more,onclick:()=>run(()=>change(offset+limit))},"Next"));
}
function notify(message,kind="") { $("#notice").textContent=message; $("#notice").dataset.kind=kind; }
async function run(action) { try { await action(); } catch(error) { notify(error.message||String(error),"error"); } }
function empty(message) { return h("div",{class:"empty"},message); }
function downloadText(name,body,type="application/json") {
  const url=URL.createObjectURL(new Blob([body],{type}));
  const link=h("a",{href:url,download:name}); link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function download(relativePath,options="workspace") {
  const selected=typeof options==="string"?{kind:options}:options||{};
  const kind=selected.kind||"workspace";
  const url="/download?kind="+encodeURIComponent(kind)+"&path="+encodeURIComponent(relativePath);
  if(!selected.returnBlob) {
    const link=h("a",{href:url,download:""});
    document.body.append(link);link.click();link.remove();return;
  }
  if(kind!=="workspace")throw new Error("Inline preview requires a declared workspace file.");
  const descriptor=await api("files",{path:relativePath});
  if(descriptor.path!==relativePath||!Number.isSafeInteger(descriptor.bytes)||descriptor.bytes<0||
    !/^[a-f0-9]{64}$/.test(descriptor.sha256))throw new Error("The native file descriptor is incomplete.");
  const response=await fetch(url);
  if(!response.ok) {
    const raw=await response.text();
    let problem;try{problem=parseExactJSON(raw);}catch{}
    throw new Error(problem?.error?.message||problem?.error?.code||"The saved file could not be reopened.");
  }
  if(response.headers.get("Content-Length")!==String(descriptor.bytes)||
    response.headers.get("X-Content-SHA256")!==descriptor.sha256)
    throw new Error("The saved file descriptor changed before preview.");
  const bytes=await response.arrayBuffer();
  const actual=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),value=>value.toString(16).padStart(2,"0")).join("");
  if(bytes.byteLength!==descriptor.bytes||actual!==descriptor.sha256)
    throw new Error("The complete preview bytes differ from the saved native file.");
  const mimeType=response.headers.get("Content-Type")||"application/octet-stream";
  const filename=relativePath.split("/").pop();
  return {blob:new Blob([bytes],{type:mimeType}),descriptor:clone(descriptor),mimeType,filename};
}
async function openDatabase() {
  db=await new Promise((resolve,reject)=>{
    const request=indexedDB.open(savedKey,1);
    request.onupgradeneeded=()=>request.result.createObjectStore("records");
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
function put(name,value) { return new Promise((resolve,reject)=>{
  const tx=db.transaction("records","readwrite");tx.objectStore("records").put(stringifyExactJSON(value),name);
  tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error("The browser could not retain this request."));
}); }
function get(name) { return new Promise((resolve,reject)=>{
  const request=db.transaction("records").objectStore("records").get(name);
  request.onsuccess=()=>{try{resolve(request.result===undefined?null:parseExactJSON(request.result));}catch(e){reject(e);}};
  request.onerror=()=>reject(request.error);
}); }
async function stash() {
  if(!workspace || !draft) return;
  await put(key("draft"),{schema:"migration-browser-draft.v1",draft,current,actor});
}
function changed(fn) { return value=>{fn(value);void stash().catch(error=>notify(error.message,"error"));}; }
async function api(command,payload={}) {
  const response=await fetch("/api",{method:"POST",headers:{"Content-Type":"application/json"},
    body:stringifyExactJSON({command,payload})});
  const raw=await response.text();
  let value;
  try { value=parseExactJSON(raw); } catch(error) {
    throw Object.assign(new Error("No complete native result returned. The original request remains available to resume."),{status:response.status,retryable:true});
  }
  if(!response.ok || !value.ok) {
    const problem=value.error||{};
    throw Object.assign(new Error(problem.message||problem.code||"Native operation failed."),
      {status:response.status,code:problem.code,details:problem.details,retryable:!!problem.retryable,returned:value});
  }
  return value.result;
}
async function refreshMeta() {
  workspace=await api("state");
  $("#workspace-title").textContent=workspace.title;
  $("#workspace-meta").textContent="Revision "+workspace.revision+" · "+workspace.id;
}
async function saveJournal() { await put(key("requests"),journal); renderRequests(); }
function applyResult(command,result) {
  if(result.capture) current.captureId=result.capture.id;
  if(result.plan) current.planId=result.plan.id;
  if(result.edition) current.editionId=result.edition.id;
  if(result.comparison) current.comparisonId=result.comparison.id;
}
function canonicalRequest(value) {
  const ordered=item=>{
    if(item instanceof ExactNumber||item===null||typeof item!=="object")return item;
    if(Array.isArray(item))return item.map(ordered);
    return Object.fromEntries(Object.keys(item).sort().map(name=>[name,ordered(item[name])]));
  };
  return stringifyExactJSON(ordered(value));
}
async function continueRequest(record) {
  if(activeRequestId!==null)throw new Error("The local operator is still awaiting its current native request.");
  activeRequestId=record.id;
  try {
    record.status="pending";record.lastAttemptAt=new Date().toISOString();await saveJournal();
    notify("Executing "+record.command+". The original request is retained.");
    let result;
    try { result=await api(record.command,record.payload); }
    catch(error) {
      record.status=error.status && error.status<500 && !error.retryable ? "returned-error":"pending";
      record.error={message:error.message,code:error.code||null,status:error.status||null,
        retryable:!!error.retryable,returned:error.returned||null};
      await saveJournal();throw error;
    }
    if(record.result && canonicalRequest(record.result)!==canonicalRequest(result)) {
      record.priorResults??=[];
      record.priorResults.push({completedAt:record.completedAt,result:record.result});
    }
    record.status="completed";record.result=result;record.completedAt=new Date().toISOString();delete record.error;
    await saveJournal();
    applyResult(record.command,result);await stash();
    try { await refreshMeta(); }
    catch(error) { notify("The native operation completed and its full result is retained. Workspace refresh returned: "+error.message,"error");return result; }
    notify("Completed "+record.command+" at the retained native revision.");
    return result;
  } finally {activeRequestId=null;}
}
async function mutate(command,args={}) {
  if(admittingMutation)throw new Error("The local operator is saving its current request.");
  const payload=clone(args);
  admittingMutation=true;
  try {
    const prior=Object.hasOwn(payload,"requestId")?journal.find(row=>row.payload.requestId===payload.requestId):null;
    if(journal.some(row=>row!==prior&&(row.status==="pending"||row.status==="prepared")))
      throw new Error("Resume the retained request in Saved requests and recovery before starting another native change.");
    actor=$("#actor").value.trim();
    if(!Object.hasOwn(payload,"revision"))payload.revision=prior?prior.payload.revision:workspace.revision;
    if(!Object.hasOwn(payload,"requestId"))payload.requestId="migration-"+crypto.randomUUID();
    if(!Object.hasOwn(payload,"actor"))payload.actor=prior?prior.payload.actor:actor;
    if(typeof payload.actor!=="string"||!payload.actor.trim())
      throw new Error("Enter the operator name before saving a change.");
    if(typeof payload.requestId!=="string"||!payload.requestId)
      throw new Error("Keep the complete original native request ID.");
    if(prior) {
      if(prior.workspaceId!==workspace.id||prior.command!==command||
        canonicalRequest(prior.payload)!==canonicalRequest(payload))
        throw new Error("This request ID already belongs to a different retained native input.");
      return await continueRequest(prior);
    }
    await stash();
    const record={id:crypto.randomUUID(),workspaceId:workspace.id,command,payload,
      createdAt:new Date().toISOString(),status:"prepared"};
    journal.push(record);await saveJournal();
    return await continueRequest(record);
  } finally {admittingMutation=false;}
}
function renderRequests() {
  $("#request-count").textContent="("+journal.filter(r=>r.status==="pending"||r.status==="prepared").length+" pending)";
  const root=$("#request-list");root.replaceChildren();
  if(!journal.length){root.append(h("p",{class:"muted"},"Native requests are retained here before dispatch."));return;}
  for(const record of [...journal].reverse()) root.append(h("div",{class:"request"},
    h("div",{class:"row"},h("div",{},h("strong",{},record.command),h("span",{class:"tag"},record.status),
      h("div",{class:"code"},record.payload.requestId),h("div",{class:"muted"},record.createdAt)),
      btn("Request",()=>detail("Original request",{command:record.command,payload:record.payload}),"small"),
      record.result?btn("Result",()=>detail("Retained native result",record.result),"small"):null,
      btn("Save request",()=>downloadText(record.payload.requestId+".json",json({command:record.command,payload:record.payload})),"small"),
      record.status!=="completed"?btn("Resume exact request",async()=>{await continueRequest(record);await render();},"small"):null),
    record.error?h("p",{class:"muted"},record.error.message):null));
}
async function imported(file) {
  if(!file) throw new Error("Choose the original JSON file.");
  if(file.size>16*1024*1024) throw new Error("The original JSON document exceeds 16 MiB.");
  const bytes=new Uint8Array(await file.arrayBuffer());
  let binary="";
  for(let offset=0;offset<bytes.length;offset+=32768) binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
  const original={value:null,originalBase64:btoa(binary),filename:file.name,originalText:null,bytes:bytes.length,parseError:null};
  try {
    original.originalText=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);
    original.value=parseExactJSON(original.originalText.replace(/^\uFEFF/,""));
  } catch(error) { original.parseError=error.message; }
  return original;
}
function downloadOriginal(original) {
  const raw=Uint8Array.from(atob(original.originalBase64),character=>character.charCodeAt(0));
  const url=URL.createObjectURL(new Blob([raw],{type:"application/json"}));
  h("a",{href:url,download:original.filename}).click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function validPlan(value) {
  const object=x=>x && typeof x==="object" && !Array.isArray(x);
  return object(value) && value.schema==="starforge.gis-migration-plan.v1" && typeof value.captureId==="string"
    && Array.isArray(value.formats) && Array.isArray(value.layers) && value.layers.every(layer=>
      object(layer) && typeof layer.sourceLayerId==="string" && Array.isArray(layer.fields) &&
      layer.fields.every(row=>object(row)&&typeof row.source==="string"&&typeof row.name==="string") &&
      Array.isArray(layer.keys||[]) && (layer.keys||[]).every(row=>object(row)&&Array.isArray(row.fields)))
    && Array.isArray(value.projectDefinitions) && value.projectDefinitions.every(row=>
      object(row)&&typeof row.id==="string"&&Array.isArray(row.sourceLayerIds))
    && Array.isArray(value.pendingDecisions||[]) && (value.pendingDecisions||[]).every(object);
}
async function list(kind,offset=0) { return api("records",{kind,offset,limit:50}); }
async function all(kind) {
  const rows=[];let offset=0;
  for(;;){const page=await list(kind,offset);rows.push(...page.rows);if(!page.hasMore)return rows;offset+=page.limit;}
}
function recordLabel(row) { return (row.title||row.selectionId||row.id)+" · "+short(row.id); }
async function navigate(view) {
  current.view=view;await stash();await render();
}
async function render() {
  const token=++generation, view=current.view;
  for(const button of $("#navigation").children) button.setAttribute("aria-current",button.dataset.view===view?"page":"false");
  if(view==="publication") {
    main.replaceChildren(publicationRoot);
    if(!publication) {
      const module=await import("/cartography.mjs");
      if(token!==generation)return;
      publication=await module.mount({root:publicationRoot,api,mutate,download,
        onChange:refreshMeta,storageKey:key("cartography"),getWorkspace:()=>({...workspace})});
    }
    await publication.refresh?.();return;
  }
  main.replaceChildren(h("p",{class:"muted"},"Opening saved workspace records…"));
  const builders={overview:overviewView,sources:sourcesView,mapping:mappingView,plans:plansView,
    outputs:outputsView,handover:handoverView,history:historyView};
  const node=await builders[view]();
  if(token===generation && current.view===view) main.replaceChildren(node);
}
async function overviewView() {
  const stats=workspace.counts;
  const holder=h("div",{},h("h2",{},"Source to delivered project"),
    h("p",{class:"lead"},"Retain the complete source, review explicit mapping choices, generate native data and maps, then reopen the complete handover."),
    h("div",{class:"metrics"},[["captures","Source captures"],["plans","Mapping plans"],["editions","Native editions"],["projectDeliveries","Project deliveries"]]
      .map(([name,label])=>h("div",{class:"metric"},h("strong",{},stats[name]||0),label))),
    h("div",{class:"grid"},
      panel(h("h3",{},"1. Original source"),h("p",{},"Import a complete selection manifest or receive a retained capture. Every selected record remains accessible."),
        btn("Open sources",()=>navigate("sources"))),
      panel(h("h3",{},"2. Explicit mapping"),h("p",{},"Choose destination names, exact value representations, null and key rules, CRS and project layers."),
        btn("Open mapping",()=>navigate("mapping"))),
      panel(h("h3",{},"3. Native delivery"),h("p",{},"Build the actual vector outputs and saved QGIS maps. Corrected editions retain their predecessors."),
        btn("Open projects",()=>navigate("outputs"))),
      panel(h("h3",{},"4. Full receiving"),h("p",{},"Export all original data, plans, native projects, resources and selected program source in the same archive."),
        btn("Open handover",()=>navigate("handover")))),
    panel(h("h3",{},"Installed native engines"),
      h("p",{class:"muted"},"The selected runtime performs native operations. These reads report its actual installed providers."),
      h("div",{class:"toolbar"},btn("Read GDAL / Fiona",async()=>detail("Installed vector provider",await api("native-info"))),
        btn("Read QGIS",async()=>detail("Installed QGIS provider",await api("qgis-info"))),
        btn("Selected program files",()=>detail("Complete program source",workspace.nativeSource)))));
  return holder;
}
async function sourcesView() {
  const captures=await all("captures");
  const comparisons=await all("comparisons");
  const captureId=current.captureId||captures[0]?.id||"";
  if(captureId)current.captureId=captureId;
  const holder=h("div",{},h("h2",{},"Original source editions"));
  const intake=draft.intake;
  const file=h("input",{type:"file",accept:".json,application/json",onchange:event=>run(async()=>{
    const original=await imported(event.target.files[0]);
    intake.import=original;await stash();
    if(original.parseError)throw new Error(original.parseError);
    if(!original.value || typeof original.value!=="object" || original.value.schema!=="starforge.vector-selection.v1")
      throw new Error("Choose the original vector selection manifest.");
    intake.import=original;intake.text=json(original.value);await stash();await render();
  })});
  holder.append(panel(h("h3",{},"Capture approved local exports"),
    h("p",{class:"muted"},"The selection manifest binds exact local source paths, byte counts, hashes, layers and row identities."),
    field("Original selection JSON",file),
    intake.import?h("div",{class:"toolbar"},h("span",{class:"muted"},intake.import.filename+" · "+intake.import.bytes+" original bytes retained"),
      btn("Download unchanged original",()=>downloadOriginal(intake.import),"small"),
      intake.import.parseError?h("span",{class:"warning"},intake.import.parseError):null):null,
    field("Complete selection",area(intake.text||"",changed(value=>intake.text=value),{class:"code",rows:7})),
    h("div",{class:"row"},field("Source root on the selected native host",input(intake.sourceRoot,changed(value=>intake.sourceRoot=value))),
      btn("Capture original source",async()=>{
        const selection=parseExactJSON(intake.text.replace(/^\uFEFF/,""));
        const result=await mutate("capture",{selection,sourceRoot:intake.sourceRoot,originalBase64:intake.import?.originalBase64||null});
        current.captureId=result.capture.id;current.layerId="";await stash();await render();
      },"primary")),
    h("details",{},h("summary",{},"Receive an existing native capture"),h("div",{class:"inner row"},
      field("Existing capture directory",input(intake.directory,changed(value=>intake.directory=value))),
      field("Capture manifest SHA-256",input(intake.sha,changed(value=>intake.sha=value))),
      btn("Receive capture",async()=>{await mutate("receive-capture",{directory:intake.directory,expectedManifestSha256:intake.sha});await render();})))));
  if(!captures.length){holder.append(empty("No source capture has been saved."));return holder;}
  holder.append(panel(h("div",{class:"row"},field("Saved source",select(captureId,captures.map(r=>[r.id,recordLabel(r)]),async value=>{
    current.captureId=value;current.layerId="";current.offsets.source=0;await stash();await render();
  })),btn("Create mapping draft",async()=>{const next=await api("draft",{captureId});await retainPreviousPlan();
    draft.plan=next;draft.planOriginal=null;draft.optionsText={};await navigate("mapping");}))));
  const capture=await api("document",{kind:"capture",id:captureId});
  const layerId=capture.inspection.layers.some(r=>r.id===current.layerId)?current.layerId:capture.inspection.layers[0]?.id;
  if(current.captureId===captureId)current.layerId=layerId||"";
  holder.append(panel(h("h3",{},"Complete source record access"),
    h("div",{class:"toolbar"},btn("Original manifest",()=>detail("Complete original capture manifest",capture.manifest)),
      btn("Native source inspection",()=>detail("Complete source inspection",capture.inspection))),
    field("Layer",select(layerId,capture.inspection.layers.map(r=>[r.id,r.name+" · "+r.counts.features+" features"]),async value=>{
      current.layerId=value;current.offsets.source=0;await stash();await render();
    }))));
  if(layerId){
    const page=await api("source-rows",{captureId,layerId,offset:current.offsets.source||0,limit:50});
    holder.append(table(["Position","Original identity","Source row","Complete retained record"],page.rows.map(row=>h("tr",{},
      cell(row.position),cell(row.identityJson,"code long"),cell(short(row.rowKey),"code"),
      cell(btn("Open geometry & properties",()=>detail("Original source record · "+row.position,parseExactJSON(row.recordJson)),"small"))))),
      pager(page,async offset=>{current.offsets.source=offset;await stash();await render();}));
  }
  if(captures.length>1){
    draft.compareBefore ||= captures[1].id;draft.compareAfter ||= captureId;
    holder.append(panel(h("h3",{},"Compare baseline and corrected source"),
      h("div",{class:"row"},field("Baseline",select(draft.compareBefore,captures.map(r=>[r.id,recordLabel(r)]),changed(v=>draft.compareBefore=v))),
        field("Corrected source",select(draft.compareAfter,captures.map(r=>[r.id,recordLabel(r)]),changed(v=>draft.compareAfter=v))),
        btn("Compare every original row",async()=>{await mutate("compare-captures",{beforeCaptureId:draft.compareBefore,afterCaptureId:draft.compareAfter});await render();}))));
  }
  if(comparisons.length){
    const comparisonId=current.comparisonId||comparisons[0].id;current.comparisonId=comparisonId;
    holder.append(field("Saved complete comparison",select(comparisonId,comparisons.map(r=>[r.id,short(r.beforeCaptureId)+" → "+short(r.afterCaptureId)]),async value=>{
      current.comparisonId=value;current.offsets.comparison=0;await stash();await render();
    })));
    const page=await api("comparison-rows",{comparisonId,offset:current.offsets.comparison||0,limit:50});
    holder.append(table(["Original change"],page.changes.map((row,index)=>h("tr",{},cell(btn("Open complete change "+(page.offset+index+1),()=>detail("Original feature change",parseExactJSON(row.valueJson)),"link"))))),
      pager({...page,hasMore:page.nextOffset!==null},async offset=>{current.offsets.comparison=offset;await stash();await render();}));
  }
  return holder;
}
function planDraftCheckpoint() {
  return clone({schema:"migration-complete-plan-draft.v1",plan:draft.plan,
    planOriginal:draft.planOriginal||null,optionsText:draft.optionsText||{}});
}
async function retainPreviousPlan() {
  if(draft.plan)await put(key("previous-plan-draft"),planDraftCheckpoint());
}
function assembledPlan() {
  if(!validPlan(draft.plan))throw new Error("Keep the complete editable migration plan.");
  const plan=clone(draft.plan);
  for(const project of plan.projectDefinitions) {
    if(draft.optionsText && Object.hasOwn(draft.optionsText,project.id)) {
      let options;
      try {options=parseExactJSON(draft.optionsText[project.id]);}
      catch(error) {throw new Error("Correct the retained native display JSON for "+project.id+": "+error.message);}
      if(!options||typeof options!=="object"||Array.isArray(options)||options instanceof ExactNumber)
        throw new Error("Native display choices for "+project.id+" must be a complete object keyed by source layer.");
      project.layerOptions=options;
    }
  }
  return plan;
}
async function recoverPreviousPlan() {
  const prior=await get(key("previous-plan-draft"));
  if(!prior)throw new Error("No previous draft is retained.");
  const complete=prior.schema==="migration-complete-plan-draft.v1";
  const plan=complete?prior.plan:prior;
  if(!validPlan(plan))throw new Error("The previous draft needs complete layer, field and project rows.");
  const displaced=draft.plan?planDraftCheckpoint():null;
  draft.plan=clone(plan);
  draft.planOriginal=complete?clone(prior.planOriginal||null):null;
  draft.optionsText=complete?clone(prior.optionsText||{}):{};
  if(displaced)await put(key("previous-plan-draft"),displaced);
  await stash();await render();
}
async function mappingView() {
  const captures=await all("captures"), previous=await all("plans");
  const holder=h("div",{},h("h2",{},"Explicit mapping plan"));
  if(!captures.length){holder.append(empty("Capture or receive the original source before defining its mapping."),btn("Open sources",()=>navigate("sources")));return holder;}
  draft.planCaptureId ||= current.captureId||captures[0].id;
  const selector=select(draft.planCaptureId,captures.map(r=>[r.id,recordLabel(r)]),changed(v=>draft.planCaptureId=v));
  holder.append(panel(h("div",{class:"row"},field("Source for a new draft",selector),
    field("Carry forward a saved plan",select(draft.predecessor||"",[["","Start a new mapping"],...previous.map(r=>[r.id,recordLabel(r)])],changed(v=>draft.predecessor=v))),
    btn("Create / rebase draft",async()=>{
      await retainPreviousPlan();
      draft.plan=await api("draft",{captureId:draft.planCaptureId,predecessorPlanId:draft.predecessor||null});
      draft.planOriginal=null;draft.optionsText={};current.offsets.fields=0;await stash();await render();
    })),
    h("div",{class:"toolbar"},field("Import editable original plan",h("input",{type:"file",accept:".json,application/json",onchange:event=>run(async()=>{
      const original=await imported(event.target.files[0]);
      draft.failedPlanImport=original;await stash();
      if(original.parseError)throw new Error(original.parseError);
      if(!validPlan(original.value))
        throw new Error("Choose a complete migration plan with layers and project definitions.");
      await retainPreviousPlan();
      draft.plan=original.value;draft.planOriginal=original;delete draft.failedPlanImport;draft.optionsText={};await stash();await render();
    })})),
    btn("Recover previous draft",recoverPreviousPlan))));
  if(draft.recoveredDraft)holder.append(panel(h("h3",{},"Original editor state retained"),
    h("p",{},"A prior draft had incomplete editor rows. The complete saved state remains available while this editor opens with usable controls."),
    btn("Download retained editor state",()=>downloadText("migration-original-editor-state.json",json(draft.recoveredDraft)))));
  if(draft.failedPlanImport)holder.append(panel(h("h3",{},"Retained original import needs correction"),
    h("p",{},draft.failedPlanImport.parseError||"The imported document needs complete layer, field, key and project arrays."),
    btn("Download exact original",()=>downloadOriginal(draft.failedPlanImport))));
  const plan=draft.plan;
  if(!plan){holder.append(empty("Create a draft from a selected source, or import a complete plan."));return holder;}
  let capture;
  try { capture=await api("document",{kind:"capture",id:plan.captureId}); }
  catch(error) {
    holder.append(panel(h("h3",{},"Receive this draft's original source"),
      h("p",{},error.message),h("p",{class:"code"},plan.captureId),
      btn("Download complete retained draft",()=>downloadText("migration-plan-draft.json",json(assembledPlan()))),
      btn("Download complete editor state",()=>downloadText("migration-plan-editor.json",json(planDraftCheckpoint()))),
      btn("Open sources",()=>navigate("sources"))));
    return holder;
  }
  const inspection=new Map(capture.inspection.layers.map(row=>[row.id,row]));
  holder.append(panel(h("div",{class:"row"},
    field("Plan title",input(plan.title,changed(v=>plan.title=v))),
    field("PostGIS destination schema",input(plan.postgisSchema,changed(v=>plan.postgisSchema=v)))),
    field("Reason and operating notes",area(plan.note||"",changed(v=>plan.note=v),{rows:2})),
    h("div",{class:"toolbar"},h("span",{class:"tag"},"GeoPackage · all selected source fields"),
      checkbox("Also create Shapefile and its complete sidecar data",plan.formats.includes("ESRI Shapefile"),changed(v=>plan.formats=v?["GPKG","ESRI Shapefile"]:["GPKG"])),
      btn("Complete editable JSON",()=>downloadText("migration-plan.json",json(assembledPlan()))),
      draft.planOriginal?btn("Download unchanged imported plan",()=>downloadOriginal(draft.planOriginal)):null),
    h("p",{class:"muted"},"Source "+plan.captureId+(plan.predecessorPlanId?" · prior plan "+short(plan.predecessorPlanId):""))));
  if(!plan.layers.length){holder.append(empty("The plan has no layer decisions. Recover or import a complete draft."));return holder;}
  const layerId=plan.layers.some(r=>r.sourceLayerId===draft.mapLayerId)?draft.mapLayerId:plan.layers[0].sourceLayerId;
  if(draft.plan===plan)draft.mapLayerId=layerId;
  const layer=plan.layers.find(r=>r.sourceLayerId===layerId), source=inspection.get(layerId);
  holder.append(field("Mapping layer",select(layerId,plan.layers.map(r=>[r.sourceLayerId,r.title+" · "+r.sourceLayerId]),async value=>{
    draft.mapLayerId=value;current.offsets.fields=0;await stash();await render();
  })));
  holder.append(panel(h("div",{class:"row"},
    field("Destination table",input(layer.table,changed(v=>layer.table=v))),
    field("Layer delivery label",input(layer.title,changed(v=>layer.title=v))),
    field("Null geometry",select(layer.geometryNulls,["preserve","reject"],changed(v=>layer.geometryNulls=v)))),
    h("div",{class:"row"},
      field("Source CRS declaration, if missing",input(layer.sourceCrs||"",changed(v=>{if(v)layer.sourceCrs=v;else delete layer.sourceCrs;}))),
      field("Explicit source CRS reassignment",input(layer.assignSourceCrs||"",changed(v=>{if(v)layer.assignSourceCrs=v;else delete layer.assignSourceCrs;}))),
      field("Target CRS transformation",input(layer.targetCrs||"",changed(v=>{if(v)layer.targetCrs=v;else delete layer.targetCrs;})))),
    h("p",{class:"muted"},"Leave CRS overrides empty to preserve the actual original native CRS. Assignment and coordinate transformation are distinct saved decisions."),
    field("Layer notes",area(layer.note||"",changed(v=>layer.note=v),{rows:2}))));
  const offset=current.offsets.fields||0, fields=layer.fields.slice(offset,offset+50);
  holder.append(h("h3",{},"Complete field decisions"),table(["Original field / values","Destination name","Representation","Native type","Null rule","Shapefile name","Note"],fields.map(row=>h("tr",{},
    h("td",{},h("strong",{},row.source),source?.fields?.[row.source]?h("div",{class:"muted"},json(source.fields[row.source].kinds)):null),
    cell(input(row.name,changed(v=>row.name=v))),cell(select(row.mode,["auto","native","json","reference"],changed(v=>row.mode=v))),
    cell(input(row.physicalType||"",changed(v=>{if(v)row.physicalType=v;else delete row.physicalType;}),{placeholder:"For explicit native type"})),
    cell(select(row.nullPolicy,["preserve","required","non-null"],changed(v=>row.nullPolicy=v))),
    cell(input(row.shapefileName||"",changed(v=>{if(v)row.shapefileName=v;else delete row.shapefileName;}),{maxlength:10})),
    cell(input(row.note||"",changed(v=>row.note=v))))),"fields"),
    pager({offset,limit:50,total:layer.fields.length,hasMore:offset+50<layer.fields.length},async n=>{current.offsets.fields=n;await stash();await render();}),
    h("p",{class:"muted"},"Required means the property must be present; it may be null. Non-null requires a present value. Every source field stays in the native/sidecar delivery."));
  const keys=panel(h("h3",{},"Destination key decisions"),h("p",{class:"muted"},"Keys are reviewed across every source row using the selected native values and binary equality. Database-specific collations remain a target-system choice."));
  layer.keys ||= [];
  for(const [index,keyRow] of layer.keys.entries()){
    keys.append(h("fieldset",{},h("legend",{},keyRow.name||"Key "+(index+1)),h("div",{class:"row"},
      field("Key name",input(keyRow.name,changed(v=>keyRow.name=v))),
      field("Null key values",select(keyRow.nulls,["reject","distinct","equal"],changed(v=>keyRow.nulls=v))),
      btn("Remove key",async()=>{layer.keys.splice(index,1);await stash();await render();},"small")),
      h("div",{class:"choice-list"},layer.fields.map(row=>checkbox(row.source,keyRow.fields.includes(row.source),changed(value=>{
        keyRow.fields=value?[...keyRow.fields,row.source]:keyRow.fields.filter(x=>x!==row.source);
      })))),
      field("Reason",input(keyRow.note||"",changed(v=>keyRow.note=v)))));
  }
  keys.append(btn("Add key",async()=>{const used=new Set(layer.keys.map(row=>row.name));let ordinal=1;while(used.has("key_"+ordinal))ordinal++;
    layer.keys.push({name:"key_"+ordinal,fields:[],nulls:"reject",note:""});await stash();await render();}));holder.append(keys);
  const projects=panel(h("h3",{},"Delivered QGIS project definitions"),
    h("p",{class:"muted"},"The delivery label identifies each map in the handover. The original native project title uses the workspace title."));
  for(const [index,project] of plan.projectDefinitions.entries()){
    projects.append(h("fieldset",{},h("legend",{},project.title||"Project "+(index+1)),h("div",{class:"row"},
      field("Stable definition ID",h("input",{value:project.id,onchange:event=>run(async()=>{
        const value=event.target.value;
        if(!value||plan.projectDefinitions.some(row=>row!==project&&row.id===value)||
          value!==project.id&&draft.optionsText&&Object.hasOwn(draft.optionsText,value)) {
          event.target.value=project.id;
          throw new Error("Each project definition needs its own nonempty stable ID.");
        }
        if(value!==project.id && draft.optionsText && Object.hasOwn(draft.optionsText,project.id)) {
          draft.optionsText[value]=draft.optionsText[project.id];delete draft.optionsText[project.id];
        }
        project.id=value;await stash();
      })})),
      field("Delivery label",input(project.title,changed(v=>project.title=v))),
      field("Project CRS",input(project.projectCrs||"",changed(v=>project.projectCrs=v||null))),
      btn("Remove definition",async()=>{plan.projectDefinitions.splice(index,1);await stash();await render();},"small")),
      h("div",{class:"choice-list"},plan.layers.map(row=>checkbox(row.title+" · "+row.sourceLayerId,project.sourceLayerIds.includes(row.sourceLayerId),changed(value=>{
        project.sourceLayerIds=value?[...project.sourceLayerIds,row.sourceLayerId]:project.sourceLayerIds.filter(x=>x!==row.sourceLayerId);
      })))),
      h("details",{},h("summary",{},"Native display and retained style choices"),
        h("p",{class:"muted"},"Optional object keyed by selected source-layer ID: label, visible, opacity, vectorSubsetString, crsOverride, retained styleFile and styleDependencies."),
        area(draft.optionsText?.[project.id]??json(project.layerOptions||{}),changed(value=>{draft.optionsText ||= {};draft.optionsText[project.id]=value;}),{class:"code",rows:4}))));
  }
  projects.append(btn("Add project definition",async()=>{
    const used=new Set([...plan.projectDefinitions.map(row=>row.id),...Object.keys(draft.optionsText||{})]);let ordinal=1;
    while(used.has("map-"+ordinal))ordinal++;
    plan.projectDefinitions.push({id:"map-"+ordinal,title:"Migrated map "+ordinal,projectCrs:null,
      sourceLayerIds:plan.layers.map(r=>r.sourceLayerId),format:"GPKG"});
    await stash();await render();
  }));holder.append(projects);
  if(plan.pendingDecisions?.length) holder.append(panel(h("h3",{},"Corrected-source decisions"),...plan.pendingDecisions.map((row,index)=>
    h("fieldset",{},h("legend",{},row.kind),btn("Original source change",()=>detail("Corrected-source decision",row),"small"),
      field("Decision and disposition",area(row.decision||"",changed(v=>row.decision=v),{rows:2}))))));
  holder.append(h("div",{class:"toolbar"},btn("Save plan & review every source row",async()=>{
    const complete=assembledPlan();
    const result=await mutate("save-plan",{plan:complete,originalBase64:draft.planOriginal?.originalBase64||null});
    current.planId=result.plan.id;await navigate("plans");
  },"primary"),btn("Save editable draft",()=>downloadText("migration-plan-draft.json",json(assembledPlan()))),
    btn("Save complete editor state",()=>downloadText("migration-plan-editor.json",json(planDraftCheckpoint())))));
  return holder;
}

async function plansView() {
  const page=await list("plans",current.offsets.plans||0);
  const holder=h("div",{},h("h2",{},"Saved plans and source review"));
  if(!page.rows.length){holder.append(empty("No mapping plan has been saved."),btn("Open mapping",()=>navigate("mapping")));return holder;}
  holder.append(table(["Saved plan","Source","Complete source review","Saved"],page.rows.map(row=>h("tr",{class:row.id===current.planId?"selected-row":""},
    cell(btn(row.title,async()=>{current.planId=row.id;current.offsets.issues=0;await stash();await render();},"link")),
    cell(short(row.captureId),"code"),cell(row.valid?"Passed · "+row.features+" features":row.issues+" issues · "+row.features+" features"),
    cell(row.createdAt,"muted")))),
    pager(page,async offset=>{current.offsets.plans=offset;await stash();await render();}));
  const id=current.planId||page.rows[0].id;
  const opened=await api("document",{kind:"plan",id});
  const plan=opened.plan;
  holder.append(panel(h("h3",{},plan.title),
    h("p",{class:"code"},id),h("p",{},opened.review.valid?"Every saved source constraint passed.":opened.review.issues+" complete source issues require correction."),
    h("div",{class:"toolbar"},
      btn("Copy into editable revision",async()=>{await retainPreviousPlan();
        draft.plan=clone(plan);draft.plan.predecessorPlanId=id;draft.planOriginal=null;draft.optionsText={};await navigate("mapping");}),
      btn("Complete saved plan",()=>detail("Saved original plan",plan)),
      btn("Download plan",()=>download(opened.record.file.path)),
      btn("Complete source review",()=>detail("Every source constraint and native field map",opened.review))),
    table(["Layer","Features","Issues","Native field mapping"],opened.review.layers.map(row=>h("tr",{},
      cell(row.sourceLayerId),cell(row.features),cell(row.issues),
      cell(btn("Open all formats / fields",()=>detail("Original-to-native field mapping",row.fields),"small")))))));
  if(opened.review.issues){
    const issuePage=await api("issues",{planId:id,offset:current.offsets.issues||0,limit:50,
      ...(draft.issueLayer?{layerId:draft.issueLayer}:{})});
    holder.append(field("Issue layer",select(draft.issueLayer||"",[["","All layers"],...plan.layers.map(r=>[r.sourceLayerId,r.title])],async value=>{
      draft.issueLayer=value;current.offsets.issues=0;await stash();await render();
    })),table(["Issue","Layer","Source position","Complete detail"],issuePage.rows.map(row=>h("tr",{},
      cell(row.kind),cell(row.layerId,"code"),cell(row.sourcePosition),
      cell(btn("Open original values",()=>detail("Source issue "+row.id,parseExactJSON(row.detailJson)),"small"))))),
      pager(issuePage,async offset=>{current.offsets.issues=offset;await stash();await render();}));
  }
  draft.reviewNotes ||= {};draft.reviewOutcomes ||= {};
  holder.append(panel(h("h3",{},"Record the mapping review"),
    h("div",{class:"row"},
      field("Review outcome",select(draft.reviewOutcomes[id]||"changes-requested",[["changes-requested","Changes requested"],["accepted","Accepted"]],
        changed(value=>draft.reviewOutcomes[id]=value))),
      field("Review reason",input(draft.reviewNotes[id]||"",changed(value=>draft.reviewNotes[id]=value)))),
    h("div",{class:"toolbar"},
      btn("Save review",async()=>{await mutate("review-plan",{planId:id,outcome:draft.reviewOutcomes[id]||"changes-requested",note:draft.reviewNotes[id]||""});await render();}),
      opened.review.valid?btn("Build native data edition",async()=>{await mutate("build-edition",{planId:id});if(current.view==="plans")await navigate("outputs");},"primary"):null)));
  const reviews=(await all("reviews")).filter(row=>row.planId===id);
  if(reviews.length)holder.append(table(["Outcome","Operator","Reason","Time"],reviews.map(row=>h("tr",{},
    cell(row.outcome),cell(row.actor),cell(row.note,"long"),cell(row.at,"muted")))));
  return holder;
}
async function outputsView() {
  const page=await list("editions",current.offsets.editions||0);
  const deliveries=await all("projectDeliveries");
  const holder=h("div",{},h("h2",{},"Native data and delivered QGIS projects"),
    h("p",{class:"lead"},"Each edition retains the exact original source, mapping plan, native output bindings and actual provider readback."));
  if(!page.rows.length){holder.append(empty("Build a native edition from a saved mapping plan."),btn("Open plans",()=>navigate("plans")));return holder;}
  holder.append(table(["Native edition","Plan","Source / native features","Saved"],page.rows.map(row=>h("tr",{},
    cell(btn(recordLabel(row),async()=>{current.editionId=row.id;await stash();await render();},"link")),
    cell(short(row.planId),"code"),cell(row.counts.sourceFeatures+" / "+row.counts.nativeFeatures),cell(row.createdAt,"muted")))),
    pager(page,async offset=>{current.offsets.editions=offset;await stash();await render();}));
  const id=current.editionId||page.rows[0].id;
  const edition=await api("document",{kind:"edition",id});
  const metadata=page.rows.find(row=>row.id===id)||(await all("editions")).find(row=>row.id===id);
  holder.append(panel(h("h3",{},"Complete native edition"),h("p",{class:"code"},id),
    h("div",{class:"toolbar"},
      btn("Original native readback",()=>detail("Actual native output reopening",edition.nativeReceiving)),
      btn("Full output manifest",()=>detail("Complete original native manifest",edition.vector.manifest)),
      metadata?btn("PostGIS handover",()=>download(metadata.destinationFile.path)):null,
      btn("Build / retain QGIS project set",async()=>{await mutate("build-projects",{editionId:id});await render();},"primary")),
    h("p",{class:"muted"},"The GeoPackage and explicit destination handover are ready for the selected PostGIS import. Existing database changes belong to the selected deployment operation."),
    table(["Native output layer","Format","Features","Output data / complete mapping"],edition.vector.manifest.native.layers.map(row=>h("tr",{},
      cell(row.layer),cell(row.driver),cell(row.featureCount),
      cell(h("div",{class:"toolbar"},btn("Download data",()=>download(edition.vector.path+"/"+row.path),"small"),
        btn("Fields, CRS & original source",()=>detail("Complete native layer",row),"small"))))))));
  holder.append(panel(h("h3",{},"Selected project definitions"),
    table(["Delivery label","Project CRS","Original source layers"],edition.projectDefinitions.map(row=>h("tr",{},
      cell(row.title),cell(row.projectCrs||"Original native layer CRS"),cell(row.sourceLayerIds.join(", "),"long")))),
    h("p",{class:"muted"},"Delivery labels identify the selected maps; original QGIS project titles use the workspace title. Each saved native input retains its selected CRS and full layer/style choices.")));
  const completed=deliveries.filter(row=>row.editionId===id);
  if(!completed.length)holder.append(empty("The native data is saved. Build its complete QGIS project set to retain the editable maps and resources."));
  for(const row of completed)holder.append(panel(h("h3",{},"Retained project delivery"),h("p",{class:"muted"},row.at+" · "+row.actor),
    table(["Delivery label","Original project","Native input","QGIS file"],row.projects.map(project=>h("tr",{},
      cell(project.deliveryTitle||project.definitionId),cell(project.projectId,"code long"),
      cell(project.nativeInput?btn("Download exact native input",()=>download(project.nativeInput.path),"small"):text(short(project.inputSha256))),
      cell(btn("Download editable QGZ",()=>download(project.file.path),"small"))))),
    h("div",{class:"toolbar"},btn("Complete delivery result",()=>download(row.resultFile.path)),
      btn("Native reopen all saved maps",async()=>detail("Actual independent map readback",await api("native-reopen"))))));
  return holder;
}
async function handoverView() {
  const holder=h("div",{},h("h2",{},"Complete receiving and operating files"),
    h("p",{class:"lead"},"The original archive includes selected source files, all mapping and comparison records, native data, editable maps, styles, publication outputs and the exact runnable program."));
  holder.append(panel(h("h3",{},"Export this saved revision"),
    h("p",{},"Workspace revision "+workspace.revision+". The request is retained before the original archive writer starts."),
    h("div",{class:"toolbar"},btn("Export complete handover",async()=>{
      const result=await mutate("export");notify("Complete archive saved · "+result.bytes+" bytes · SHA-256 "+result.sha256);
      await render();download(result.download.path,"archive");
    },"primary"),btn("Verify all declared migration files",async()=>detail("Complete retained-file verification",await api("verify"))))));
  const exports=journal.filter(row=>row.command==="export"&&row.status==="completed");
  if(exports.length)holder.append(table(["Revision","Complete archive","SHA-256","Saved"],[...exports].reverse().map(row=>h("tr",{},
    cell(row.result.revision),cell(btn(row.result.bytes+" bytes · download",()=>download(row.result.download.path,"archive"),"link")),
    cell(row.result.sha256,"code long"),cell(row.completedAt,"muted")))));
  const receive=draft.receive;
  holder.append(panel(h("h3",{},"Receive a complete handover on this machine"),
    h("div",{class:"row"},field("Original archive path",input(receive.archive,changed(v=>receive.archive=v))),
      field("Expected complete archive SHA-256",input(receive.sha,changed(v=>receive.sha=v)))),
    h("div",{class:"row"},field("Receiving workspace directory",input(receive.destination,changed(v=>receive.destination=v))),
      field("Native QGIS reopening",select(receive.nativeReopen||"required",[["required","Required"],["auto","Use if installed"],["skip","Receive original files only"]],changed(v=>receive.nativeReopen=v))),
      btn("Receive / resume same archive",async()=>{
        const result=await mutate("receive",{archive:receive.archive,destination:receive.destination,
          expectedSha256:receive.sha,nativeReopen:receive.nativeReopen||"required"});
        detail("Original workspace received",result);
      })),
    h("p",{class:"muted"},"Receiving uses the original archive identity and destination. The source workspace remains open here; start the operator against the received directory to continue its own revision history.")));
  const filePage=await api("files",{offset:current.offsets.files||0,limit:50,query:current.fileQuery||""});
  holder.append(panel(h("h3",{},"Every declared operating file"),
    h("div",{class:"row"},field("Find a source, output, style or program file",input(current.fileQuery||"",value=>current.fileQuery=value)),
      btn("Find files",async()=>{current.offsets.files=0;await stash();await render();}))),
    table(["Original path","Bytes","SHA-256","Download"],filePage.rows.map(row=>h("tr",{},
      cell(row.path,"file-name"),cell(row.bytes),cell(short(row.sha256),"code"),
      cell(btn("Download",()=>download(row.path),"small"))))),
    pager(filePage,async offset=>{current.offsets.files=offset;await stash();await render();}));
  return holder;
}
async function historyView() {
  const page=await api("history",{offset:current.offsets.history||0,limit:50});
  return h("div",{},h("h2",{},"Original workspace history"),
    h("p",{class:"lead"},"These are the original committed actions, actors, revisions and request identities. A resumed request reuses its existing result."),
    table(["Revision","Action","Operator","Time","Complete original result"],page.rows.map(row=>h("tr",{},
      cell(row.revision),cell(row.action),cell(row.actor),cell(row.at,"muted"),
      cell(btn("Open "+short(row.requestId),()=>detail("Original committed workspace action",row),"small"))))),
    pager(page,async offset=>{current.offsets.history=offset;await stash();await render();}));
}
function initialDraft() {
  return {intake:{text:"",sourceRoot:"",directory:"",sha:""},receive:{archive:"",sha:"",destination:"",nativeReopen:"required"},
    plan:null,optionsText:{},reviewNotes:{},reviewOutcomes:{}};
}
async function start() {
  const params=new URLSearchParams(location.hash.replace(/^#/,""));
  const access=params.get("access");
  if(access) {
    const response=await fetch("/session",{method:"POST",headers:{"X-Migration-Access":access}});
    if(!response.ok)throw new Error("Open the current local operator address.");
    history.replaceState(null,"",location.pathname);
  }
  await openDatabase();await refreshMeta();
  const saved=await get(key("draft"));
  draft={...initialDraft(),...(saved?.draft||{})};
  if(draft.plan && !validPlan(draft.plan)) {
    await put(key("structurally-invalid-draft"),saved);
    draft.recoveredDraft=saved;draft.plan=null;
  }
  if(saved?.current)current={...current,...saved.current,offsets:{...current.offsets,...saved.current.offsets}};
  if(!sections.some(row=>row[0]===current.view))current.view="overview";
  actor=saved?.actor||"";$("#actor").value=actor;
  $("#actor").addEventListener("input",event=>{actor=event.target.value;void stash().catch(error=>notify(error.message,"error"));});
  journal=(await get(key("requests")))||[];
  renderRequests();
  for(const [view,label] of sections)$("#navigation").append(h("button",{type:"button","data-view":view,onclick:()=>run(()=>navigate(view))},label));
  await render();
}
void run(start);
