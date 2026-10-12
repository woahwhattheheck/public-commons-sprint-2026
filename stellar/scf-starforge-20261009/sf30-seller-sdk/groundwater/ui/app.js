(() => {
"use strict";
const cfg = window.GROUNDWATER_CONFIG || {};
const base = new URL(cfg.apiBase || "/api", location.href);
if (base.origin !== location.origin) throw new Error("The operator API must use this same origin.");
const apiBase = base.pathname.replace(/\/$/, "");
const prefix = "groundwater:" + location.origin + apiBase + ":";
const el = id => document.getElementById(id);
const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pretty = value => JSON.stringify(value, null, 2);
const code = value => '<code>' + esc(value) + '</code>';
const tag = value => '<span class="tag ' + esc(value) + '">' + esc(String(value || "unreviewed").replace(/_/g, " ")) + '</span>';
const empty = message => '<p class="empty">' + esc(message) + '</p>';
const jsonView = (title, value, open=false) => '<details' + (open ? " open" : "") + '><summary>' + esc(title) + '</summary><pre>' + esc(pretty(value)) + '</pre></details>';
const card = (title, body) => '<section class="card"><h2>' + esc(title) + '</h2>' + body + '</section>';
const link = (route, label) => '<a href="#' + esc(route) + '">' + esc(label) + '</a>';
const apiUrl = (path, query={}) => apiBase + path + (Object.keys(query).length ? "?" + new URLSearchParams(query) : "");
const download = (path, label, query={}) => '<a href="' + esc(apiUrl(path,query)) + '" target="_blank" rel="noopener">' + esc(label) + '</a>';
const note = (text, kind="") => '<div class="note ' + esc(kind) + '">' + esc(text) + '</div>';
function table(headers, rows, message="No records have been saved."){
 return rows.length ? '<div class="table-wrap"><table><thead><tr>' + headers.map(h=>"<th>"+esc(h)+"</th>").join("") + "</tr></thead><tbody>" + rows.map(row=>"<tr>"+row.map(c=>"<td>"+c+"</td>").join("")+"</tr>").join("")+"</tbody></table></div>" : empty(message);
}
function facts(values){return '<dl class="facts">'+values.map(([k,v])=>"<dt>"+esc(k)+"</dt><dd>"+v+"</dd>").join("")+"</dl>";}
function input(name,label,value="",type="text",extra=""){return "<label>"+esc(label)+'<input name="'+esc(name)+'" type="'+type+'" value="'+esc(value)+'" '+extra+"></label>";}
function area(name,label,value="",extra=""){return "<label>"+esc(label)+'<textarea name="'+esc(name)+'" '+extra+">"+esc(value)+"</textarea></label>";}
function options(rows,value="",placeholder="Select…"){return '<option value="">'+esc(placeholder)+"</option>"+rows.map(([id,label])=>'<option value="'+esc(id)+'"'+(String(id)===String(value)?" selected":"")+">"+esc(label)+"</option>").join("");}
function select(name,label,rows,value="",extra=""){return "<label>"+esc(label)+'<select name="'+esc(name)+'" '+extra+">"+options(rows,value)+"</select></label>";}
function check(name,label,checked=false,value="on"){return '<label class="check"><input type="checkbox" name="'+esc(name)+'" value="'+esc(value)+'"'+(checked?" checked":"")+"><span>"+esc(label)+"</span></label>";}
function form(id,handler,body,submitText="Save",write=true){return '<form id="'+esc(id)+'" data-handler="'+esc(handler)+'" data-draft-key="'+esc(draftKey(id))+'">'+body+'<div class="actions"><button type="submit"'+(write?' class="primary" data-write':' class="primary"')+'>'+esc(submitText)+"</button>"+(write?'<button type="button" data-reset-draft>Discard draft and reload current values</button>':"")+"</div></form>";}
function parseStored(key,fallback){try {const raw=localStorage.getItem(prefix+key);return raw?JSON.parse(raw):fallback;}catch{return fallback;}}
function saveStored(key,value){try{localStorage.setItem(prefix+key,JSON.stringify(value));}catch{throw new Error("This browser could not preserve the original request. Free storage or export existing drafts before sending this action.");}}
function removeStored(key){localStorage.removeItem(prefix+key);}
let projectId=parseStored("project",""),state=null,busy=false,generation=0;
let pending=parseStored("pending",null), selectedSourceText=null, currentDetail=null;
const fileBytes=new Map();
const titles={overview:"Project desk",sources:"Original sources",editions:"Scenarios & review",runs:"Native runs",compare:"Compare results",reports:"Frozen reports",receiving:"Receiving",runtime:"Runtime",backup:"Backup & reopen",history:"Original operations"};
function route(){const [page="overview",id=""]=(location.hash.slice(1)||"overview").split("/");return {page:titles[page]?page:"overview",id:decodeURIComponent(id)};}
function draftKey(id){return (projectId||"workspace")+":"+route().page+":"+id;}
function saveDraft(formNode){
 if(!formNode.dataset.draftKey)return;
 const value={};
 for(const field of formNode.elements){
  if(!field.name||field.type==="file"||field.type==="submit"||field.type==="button")continue;
  const key=field.type==="checkbox" ? field.name+":"+field.value : field.name;
  value[key]=field.type==="checkbox"?field.checked:field.multiple?Array.from(field.selectedOptions).map(x=>x.value):field.value;
 }
 try {saveStored("draft:"+formNode.dataset.draftKey,value);}catch(err){notice(err.message,true);}
}
function restoreDrafts(){
 for(const formNode of el("content").querySelectorAll("form[data-draft-key]")){
  const saved=parseStored("draft:"+formNode.dataset.draftKey,null);if(!saved)continue;
  for(const field of formNode.elements){
   if(!field.name||field.type==="file")continue;
   const key=field.type==="checkbox"?field.name+":"+field.value:field.name;
   if(!Object.prototype.hasOwnProperty.call(saved,key))continue;
   if(field.type==="checkbox")field.checked=Boolean(saved[key]);
   else if(field.multiple){for(const option of field.options)option.selected=saved[key].includes(option.value);}
   else field.value=saved[key];
  }
 }
}
function notice(message,error=false){el("notice").hidden=!message;el("notice").className=error?"error":"";el("notice").textContent=message||"";}
function setBusy(value){busy=value;el("activity").textContent=value?"Preserving original operation…":"";applyAvailability();}
function applyAvailability(){document.querySelectorAll("[data-write]").forEach(button=>button.disabled=busy||Boolean(pending));el("refresh").disabled=busy;}
async function read(path,query={}){
 const response=await fetch(apiUrl(path,query),{credentials:"same-origin",headers:{Accept:"application/json"},cache:"no-store"});
 let body;try{body=await response.json();}catch{throw new Error("The original server response was not readable. Preserve the request and read its recorded outcome.");}
 if(!response.ok){const e=new Error(body.error?.message||"The original request failed.");e.code=body.error?.code;e.status=response.status;e.detail=body.error;throw e;}
 return body;
}
function currentActor(){const value=String(cfg.actor||el("actor").value||"").trim();if(!value)throw new Error("Enter the named operator before saving.");return value;}
function selectedProject(){if(!projectId)throw new Error("Choose or create the project for this source or scenario.");return projectId;}
function field(formNode,name){return formNode.elements.namedItem(name);}
function value(formNode,name){return field(formNode,name)?.value||"";}
function checked(formNode,name){return Boolean(field(formNode,name)?.checked);}
function many(formNode,name){return Array.from(formNode.querySelectorAll('[name="'+name+'"]:checked')).map(x=>x.value);}
function parseJSON(value,label){try{return JSON.parse(value);}catch{throw new Error(label+" must be valid JSON.");}}
function stable(value){if(Array.isArray(value))return "["+value.map(stable).join(",")+"]";if(value&&typeof value==="object")return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+stable(value[k])).join(",")+"}";return JSON.stringify(value);}
function expectedRecorded(saved){const normalized=structuredClone(saved.request);if(saved.file)normalized.payload.original_upload={sha256:saved.file.sha256,bytes:saved.file.bytes};return normalized;}
function verifyOperation(operation,saved){if(operation.id!==saved.request.operation_id||operation.action!==saved.request.action||stable(operation.request)!==stable(expectedRecorded(saved)))throw new Error("The recorded operation does not match this original request. Its saved body has been preserved for review.");}
function renderRecovery(){
 el("recovery").hidden=!pending;if(!pending)return;
 const mismatch=pending.dispatchUrl!==location.origin+apiBase+"/action"||(state&&pending.workspaceId!==state.workspace.id);
 el("recovery").innerHTML="<h2>Original request retained</h2><p>"+esc(pending.request.action)+" · "+code(pending.request.operation_id)+"</p>"+note(mismatch?"This saved request belongs to another original workspace or API URL. Return to that original workspace before continuing.":pending.rejected?"The server rejected this request without a recorded commit. Review the preserved draft before creating a new request.":"Read the original outcome first. Retrying uses this same ID, body, selected files and workspace version.","warn")+jsonView("Saved request metadata",pending.request)+'<div class="actions"><button type="button" id="recover-request"'+(busy||mismatch?" disabled":"")+'>Read original outcome</button><button type="button" id="retry-request"'+(busy||mismatch||pending.rejected?" disabled":"")+'>Retry same request</button>'+(pending.rejected?'<button type="button" id="return-to-draft">Return rejected request to draft</button>':"")+"</div>"+(pending.file?'<p class="muted">Original file: '+esc(pending.file.name)+" · "+esc(pending.file.bytes)+" bytes · "+code(pending.file.sha256)+'</p><label>Reselect the exact original file if needed<input type="file" id="recovery-file" accept=".zip"></label>':"");
 applyAvailability();
}
async function acceptOutcome(operation,result){
 verifyOperation(operation,pending);
 const saved=pending;
 saveStored("lastOutcome",{operation,result,receivedAt:new Date().toISOString()});
 removeStored("pending");pending=null;fileBytes.delete(saved.request.operation_id);
 if(saved.formKey)removeStored("draft:"+saved.formKey);
 if(result?.project_id){projectId=result.project_id;saveStored("project",projectId);}
 renderRecovery();
 await refresh();
 notice("Original "+saved.request.action+" committed as "+saved.request.operation_id+". "+(result?.id?"Record "+result.id+".":""));
 return result;
}
async function recoverPending(quiet=false){
 if(!pending)return true;
 if(pending.dispatchUrl!==location.origin+apiBase+"/action"||(state&&pending.workspaceId!==state.workspace.id))throw new Error("Return to the original workspace URL to read this request.");
 try{
  const operation=await read("/operations/"+encodeURIComponent(pending.request.operation_id));
  await acceptOutcome(operation,operation.result);return true;
 }catch(err){if(err.status===404){if(!quiet)notice("No committed original outcome is recorded yet. An in-progress request may still finish. Retry only this retained request if its original file is available.",true);return false;}throw err;}
}
async function originalFile(file){
 if(!file)throw new Error("Select the complete original ZIP.");
 if(file.size>64*1024*1024)throw new Error("The original ZIP limit is 64 MiB.");
 const bytes=new Uint8Array(await file.arrayBuffer());
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(x=>x.toString(16).padStart(2,"0")).join("");
 return {bytes,metadata:{name:file.name,bytes:bytes.length,sha256:hash}};
}
function toBase64(bytes){let parts=[];for(let i=0;i<bytes.length;i+=24576)parts.push(btoa(String.fromCharCode(...bytes.subarray(i,i+24576))));return parts.join("");}
async function sendPending(){
 if(!pending)throw new Error("No original request is retained.");
 if(pending.dispatchUrl!==location.origin+apiBase+"/action"||pending.workspaceId!==state.workspace.id)throw new Error("The selected workspace differs from this original request.");
 const request=structuredClone(pending.request);
 if(pending.file){
  let bytes=fileBytes.get(request.operation_id);
  if(!bytes){const source=await originalFile(el("recovery-file")?.files[0]);if(source.metadata.sha256!==pending.file.sha256||source.metadata.bytes!==pending.file.bytes)throw new Error("This file differs from the original request. Select the same bytes.");bytes=source.bytes;fileBytes.set(request.operation_id,bytes);}
  request.payload.content_base64=toBase64(bytes);
 }
 const headers={"Content-Type":"application/json",Accept:"application/json"};
 if(cfg.csrfToken)headers["X-CSRFToken"]=cfg.csrfToken;
 try{
  const response=await fetch(pending.dispatchUrl,{method:"POST",credentials:"same-origin",headers,body:JSON.stringify(request)});
  let result;try{result=await response.json();}catch{throw new Error("The response was interrupted after dispatch. Read the retained original outcome.");}
  if(!response.ok){const e=new Error(result.error?.message||"The original action did not return success.");e.code=result.error?.code;e.status=response.status;e.detail=result.error;throw e;}
  const operation=await read("/operations/"+encodeURIComponent(request.operation_id));
  return await acceptOutcome(operation,result.result);
 }catch(err){
  if(pending){
   try{if(await recoverPending(true)){notice("The response was interrupted, but the matching original commit was recovered. Check the saved run, delivery or backup before continuing.",false);return;}}catch(recovery){notice(recovery.message,true);}
   if(pending){pending.issue={code:err.code||"response_uncertain",message:err.message};pending.rejected=Boolean(err.status>=400&&err.status<500&&["stale_version","invalid_text","invalid_integer","invalid_decimal","required","decision","unresolved_findings","blocking_finding","source_incomplete","reference_inspection_required","reference_basis_changed","reference_reader_changed","source_identity","scenario_review","runtime_required","layer_mapping","changes","operation_mismatch","receiver_directory","project_binding","comparison_project"].includes(err.code));saveStored("pending",pending);renderRecovery();}
  }
  throw err;
 }
}
async function mutate(formNode,action,payload,file=null){
 if(pending)throw new Error("Resolve the retained original request before saving another action.");
 saveDraft(formNode);
 let original=null;if(file)original=await originalFile(file);
 const request={action,actor:currentActor(),operation_id:"groundwater-ui-"+crypto.randomUUID(),expected_version:state.workspace.version,payload};
 const next={request,dispatchUrl:location.origin+apiBase+"/action",workspaceId:state.workspace.id,file:original?.metadata||null,formKey:formNode.dataset.draftKey,createdAt:new Date().toISOString()};
 saveStored("pending",next);pending=next;
 if(original)fileBytes.set(request.operation_id,original.bytes);
 renderRecovery();return sendPending();
}
function navigation(){
 for(const a of document.querySelectorAll("[data-nav]"))a.classList.toggle("active",a.dataset.nav===route().page);
 el("page-title").textContent=titles[route().page];
 el("project-select").innerHTML=options(state.projects.map(x=>[x.id,x.name]),projectId,"All projects");
 el("workspace-identity").textContent=state.workspace.id+" · version "+state.workspace.version+(state.project?" · "+state.project.name:"");
}
async function refresh(){
 const query=projectId?{project_id:projectId}:{};
 state=await read("/state",query);
 navigation();renderRecovery();await render();
}
function sectionIntro(title,message){return '<div class="section-head"><div><h2>'+esc(title)+"</h2><p class=\"muted\">"+esc(message)+"</p></div></div>";}
function projectRequired(){return projectId?"":note("Choose a project before attaching original sources, scenarios or results.");}
function renderOverview(){
 const p=state.project;
 const counts=[["Original sources",state.sources.length],["Scenario editions",state.editions.length],["Completed runs",state.runs.filter(x=>x.state==="complete").length],["Frozen reports",state.reports.length]];
 const kpis='<div class="kpis">'+counts.map(([label,n])=>'<div class="kpi"><b>'+n+"</b><span>"+label+"</span></div>").join("")+"</div>";
 const projectForm=form("project-create","project-create",'<div class="grid">'+input("name","Project name","","text","required maxlength=300")+input("site_label","Site or study label","","text","maxlength=1000")+'<div class="wide">'+area("description","Purpose and scope")+"</div></div>","Create project");
 const settings=p?form("project-settings-"+p.id,"project-update",'<input type="hidden" name="id" value="'+esc(p.id)+'"><input type="hidden" name="expected_project_version" value="'+p.version+'"><div class="grid">'+input("name","Project name",p.name,"text","required")+input("site_label","Site or study label",p.site_label)+'<div class="wide">'+area("description","Purpose and scope",p.description)+"</div></div>","Save project settings"):empty("Select an original project to review its settings.");
 return sectionIntro("From original model to received study","Retain the complete source, review each scenario, run both actual solvers, and freeze the reviewed result for an independent receiver.")+kpis+card("Projects",table(["Project","Scope","Version"],state.projects.map(x=>[link("overview",x.name)+'<div class="actions"><button type="button" class="small" data-project="'+esc(x.id)+'">Open project</button></div>',esc(x.description),esc(x.version)])))+'<div class="split">'+card("Create a project",projectForm)+card("Selected project",settings)+"</div>"+card("Working sequence",'<ol><li><p>'+link("sources","Retain original source files")+" and inspect their declared units, model references and findings.</p></li><li><p>"+link("editions","Author and review an immutable scenario")+" against one retained parent edition.</p></li><li><p>"+link("runs","Create and execute a native run")+", then review the exact result and source discrepancies.</p></li><li><p>"+link("reports","Freeze a complete report")+" and "+link("receiving","record its delivery and receiving decision")+".</p></li><li><p>"+link("backup","Back up and independently reopen")+" the same source, operations and native results.</p></li></ol>");
}
function findingsRead(findings){return findings.length?findings.map(f=>'<div class="finding">'+tag(f.severity)+"<h4>"+esc(f.id)+"</h4><p>"+esc(f.message)+"</p>"+jsonView("Original evidence and context",f)+"</div>").join(""):empty("No source findings were recorded.");}
function findingsForm(findings){
 return findings.map(f=>'<div class="finding" data-finding="'+esc(f.id)+'">'+tag(f.severity)+"<h4>"+esc(f.id)+"</h4><p>"+esc(f.message)+"</p>"+jsonView("Original evidence",f.evidence||f)+'<div class="grid">'+select("finding:"+f.id,"Disposition",[["acknowledged","Acknowledge this exact finding"],["requires_change","Changes required"]]) + area("finding_reason:"+f.id,"Attributed finding reason","","maxlength=4000")+"</div></div>").join("");
}
function reviewForm(kind,id,findings,referenceBasis=null){
 return form(kind+"-review-"+id,kind+"-review",'<input type="hidden" name="id" value="'+esc(id)+'">'+(referenceBasis?'<input type="hidden" name="reference_basis_sha256" value="'+esc(referenceBasis.sha256)+'">':"")+findingsForm(findings)+'<div class="grid">'+select("decision","Review decision",[["approved","Approve exact edition/result"],["changes_requested","Request changes"]],"","required")+area("reason","Overall review reason","","required maxlength=8000")+"</div>","Save named review");
}
function referenceInspection(source,status){
 if(!status)return "";
 const basis=status.basis;
 const summary=facts([["Original source",code(source.id)],["Source SHA-256",code(source.sha256)],["Inspection basis",code(basis.sha256)],["Installed reader",code(status.reader.source_sha256)],["Retained inspection",basis.inspection_id?code(basis.inspection_id):"Original import"]]);
 const current=status.current?note("These findings use the installed reference reader over the same original files and selected namefiles.") : note("The retained findings were produced by an earlier reader. Inspect these same original files before a new edition review or native run.","warn");
 const inspectionForm=form("source-inspect-"+source.id,"source-inspect",'<input type="hidden" name="id" value="'+esc(source.id)+'"><input type="hidden" name="source_sha256" value="'+esc(source.sha256)+'"><input type="hidden" name="reader_sha256" value="'+esc(status.reader.source_sha256)+'">'+area("reason","Reference inspection reason","","required maxlength=8000")+note("This records a new attributed inspection of the retained ZIP and its exact members. The source, baseline edition and previous import remain unchanged."),"Inspect retained native references");
 return card("Current reference inspection",summary+current+findingsRead(basis.findings)+jsonView("Resolved native input and output paths",basis.profile,true)+inspectionForm+jsonView("Reference inspection history",status.inspections));
}
function editionReference(id){
 const edition=state.editions.find(row=>row.id===id);
 if(edition?.profile?.adapter!=="native_package")return {};
 if(!edition.reference_inspection_current||!edition.reference_basis_sha256)throw new Error("Open the original source and inspect its native references with the installed reader before queueing.");
 return {reference_basis_sha256:edition.reference_basis_sha256};
}
async function renderSources(id){
 let body=sectionIntro("Complete original sources","The unchanged publisher files and uploaded native packages retain their original byte hashes. Generated inputs and solver outputs belong to a later native attempt.")+projectRequired();
 body+=card("Source inventory",table(["Source","Kind","Original members","Actions"],state.sources.map(x=>[link("sources/"+x.id,x.name),tag(x.kind),esc(x.files.length),link("sources/"+x.id,"Inspect originals")])));
 if(id){
  const d=await read("/sources/"+encodeURIComponent(id));currentDetail=d;const source=d.source;
  body+=card(source.name,facts([["Original source",code(source.id)],["Source SHA-256",code(source.sha256)],["Retained ZIP",source.archive?esc(source.archive.filename)+" · "+code(source.archive.sha256):"Publisher files individually retained"]])+jsonView("Original import profile and native references",source.profile,true)+jsonView("Findings retained by the original import",source.findings));
  body+=referenceInspection(source,d.reference_inspection);
  body+=card("Original files",table(["Original path","Bytes","SHA-256","View"],source.files.map(x=>[esc(x.path),esc(x.bytes),code(x.sha256),download("/sources/"+id+"/original","Download",{path:x.path})+' · <button type="button" class="small" data-view-source="'+esc(id)+'" data-path="'+esc(x.path)+'">View source</button>'])));
  body+='<section class="card" id="source-viewer" hidden><h2>Original source text</h2><p id="source-viewer-path" class="mono"></p><pre class="source-preview" id="source-viewer-text"></pre></section>';
  body+=card("Editions from this source",table(["Edition","Kind","Review"],d.editions.map(x=>[link("editions/"+x.id,x.name),tag(x.kind),esc(x.id)])));
 }
 if(projectId){
  const publisher=form("publisher-source","publisher-source",input("name","Source label","Unchanged USGS TWRI publisher baseline","text","required")+note("Retains the exact 14 bundled publisher files. No model is built and no solver starts at intake. The executable/prose recharge and native legacy unit discrepancies remain visible."),"Retain publisher baseline");
  const imported=form("source-import","source-import",'<div class="grid">'+input("name","Source name","","text","required")+input("file","Complete original native ZIP","","file",'required accept=".zip"')+input("mf6_namefile","Exact MF6 simulation namefile path","","text")+input("legacy_namefile","Exact MODFLOW-2005 namefile path","","text")+'<div class="wide">'+area("layer_mapping","Explicit layer pairs: [MF6, legacy] indices","[]","required")+area("intended_units","Attributed intended units (JSON object, optional)","{}")+note("The source inventory resolves literal native references. Select paths as they occur in the archive. Native declarations are read from the actual model; an intended-unit label does not override them. Uploaded Python is retained as a source file and is never executed.")+"</div></div>","Retain complete ZIP");
  body+='<div class="split">'+card("Original publisher baseline",publisher)+card("Import native model package",imported)+"</div>";
 }
 return body;
}

function editionsTable(){return table(["Edition","Parent","Kind","Review","SHA-256"],state.editions.map(x=>[link("editions/"+x.id,x.name),x.parent_id?link("editions/"+x.parent_id,x.parent_id):"Original baseline",tag(x.kind),tag(x.review_state),code(x.sha256)]));}
async function renderEditions(id){
 let body=sectionIntro("Immutable scenarios and review","Every change names its exact parent, original value, selected value and reason. Both solver models are generated from the same reviewed source.")+projectRequired()+card("Edition history",editionsTable());
 let d=null;if(id){d=await read("/editions/"+encodeURIComponent(id));currentDetail=d;}
 const parent=d?.edition||state.editions[0];
 if(d){
  body+=card(d.edition.name,facts([["Edition",code(d.edition.id)],["Parent",d.edition.parent_id?link("editions/"+d.edition.parent_id,d.edition.parent_id):"Original source baseline"],["Original source",link("sources/"+d.source.id,d.source.name)],["Edition SHA-256",code(d.edition.sha256)]])+jsonView("Exact parameters and profile",d.edition,true)+jsonView("Previous named reviews",d.reviews)+(d.reference_inspection&&!d.reference_inspection.current?note("Open this source and inspect its retained native references before preparing a new review.","warn"):reviewForm("edition",d.edition.id,d.reference_inspection?d.reference_inspection.basis.findings:d.source.findings,d.reference_inspection?.basis)));
  body+=card("Queue this edition",form("run-create-"+d.edition.id,"run-create",'<input type="hidden" name="edition_id" value="'+esc(d.edition.id)+'">'+area("reason","Native run purpose","","required")+note("Queueing freezes the actual runtime identity. Execution is a separate explicit action; the unchanged baseline preserves the publisher's declared metadata."),"Create queued run"));
 }
 if(parent&&parent.profile.adapter==="publisher_twri"){
  const wells=parent.parameters.wells.map((w,i)=>[check("well_selected","Change well "+i,false,String(i)),esc("MF6 "+w[0]+", "+w[1]+", "+w[2]),code(w[3]),input("well:"+i,"New rate",w[3],"text",'inputmode="decimal"'),area("well_reason:"+i,"Reason")]);
  let formBody='<input type="hidden" name="parent_id" value="'+esc(parent.id)+'">'+facts([["Selected parent",link("editions/"+parent.id,parent.name)],["Parent SHA-256",code(parent.sha256)]])+'<div class="grid">'+input("name","Scenario name","","text","required maxlength=300")+area("description","Purpose and assumptions","","required")+"</div>"+'<h3>Recharge</h3>'+check("change_recharge","Change recharge from the selected parent")+facts([["Original value",code(parent.parameters.recharge)+" · intended feet/second"]])+'<div class="grid">'+input("recharge","Selected recharge",parent.parameters.recharge,"text",'inputmode="decimal"')+area("recharge_reason","Recharge change reason")+"</div><h3>Existing wells</h3>"+note("Well rates are decimal strings in the source's intended feet³/second. Each existing MF6 aquifer location is mapped to its original legacy aquifer. Positive values inject; negative values withdraw.")+table(["Selection","Layer, row, column","Parent rate","Selected rate","Reason"],wells);
  if(parent.parameters.legacy_units.length!=="feet"||parent.parameters.legacy_units.time!=="seconds"){
   formBody+="<h3>Legacy native unit declaration</h3>"+check("align_units","Create an attributed scenario declaring legacy DIS feet and seconds")+note("This changes only the selected scenario's native metadata. It does not relabel or rewrite the unchanged publisher baseline.","warn")+area("units_reason","Reason for this explicit metadata change");
  }else formBody+=note("This parent already declares legacy feet/seconds. The original baseline and its different declarations remain available.");
  body+=card("Create a scenario from "+parent.name,form("scenario-create-"+parent.id,"scenario-create",formBody,"Save immutable scenario"));
 }else if(parent)body+=card("Native package editions",note("The reviewed TWRI editor changes only the documented recharge, existing wells and legacy unit metadata. Retain a changed external model as a separate complete original package; its original bytes and references remain explicit."));
 else body+=card("Start with original source",empty("Retain a publisher baseline or a complete native model package before creating scenarios."));
 return body;
}
function runName(run){const edition=state.editions.find(x=>x.id===run.edition_id);return edition?edition.name:run.edition_id;}
function nativeBudgetTable(engine){
 const rows=[];
 for(const step of engine.budgets||[])for(const term of step.terms||[])rows.push([esc(step.kstp+"/"+step.kper+" · "+step.totim),esc(term.canonical),esc(term.native_labels.join(", ")),code(term.in),code(term.out),code(term.net),esc(step.rate_units)]);
 return table(["Step/period · time","Boundary/storage term","Native labels","In","Out","Net","Rate units"],rows);
}
function maskedMetrics(metric){
 if(!metric)return "Unavailable";
 return facts([["Jointly valid cells",esc(metric.jointly_valid)+" / "+esc(metric.cells)],["Maximum absolute",code(metric.max_absolute)],["Mean signed",code(metric.mean_signed)],["Root mean square",code(metric.root_mean_square)],["Before exclusions",code(pretty(metric.before_exclusions))],["After exclusions",code(pretty(metric.after_exclusions))]]);
}
function crossEngine(result){
 const value=result.cross_engine;if(!value)return "";
 let body=note(value.declared_units_match?"Both native models declare the same length and time units. Exact output steps and mapped masks are still checked.":"Native unit declarations differ. Numeric differences remain visible; a physical same-time comparison is unavailable.","warn");
 for(const pair of value.pairs){
  body+=facts([["MF6 output",code(pretty(pair.mf6_step))],["Legacy output",code(pretty(pair.legacy_step||null))],["Physical comparison",tag(pair.physical_comparable?"complete":"unavailable")]])+(pair.issue?note(pair.issue,"warn"):"");
  body+=table(["MF6 ↔ legacy layer","Numeric differences","Physical head differences"],(pair.aquifers||[]).map(a=>[esc(a.mf6_layer+" ↔ "+a.legacy_layer),maskedMetrics(a.numeric_difference),a.physical_head_difference?maskedMetrics(a.physical_head_difference):"Unavailable: native declarations differ."]));
 }
 return body+jsonView("Original publisher criterion and comparison scope",result.publisher_comparison)+jsonView("Unmatched output steps",value.unmatched_legacy_steps);
}
function engineResult(name,engine,runId){
 let body=facts([["Native model",code(engine.model_id)],["Declared length/time",esc(engine.units.length)+" / "+esc(engine.units.time)],["Head and budget precision",esc(engine.head_precision)+" / "+esc(engine.budget_precision)],["Original head",download("/runs/"+runId+"/file",engine.head_file,{path:engine.head_file})],["Original budget",download("/runs/"+runId+"/file",engine.budget_file,{path:engine.budget_file})]]);
 body+=table(["Native step / period","Native time","Valid / excluded cells","Constant-head cells"],engine.heads.map(h=>[esc(h.kstp+" / "+h.kper),code(h.totim)+" "+esc(engine.units.time),jsonView("Mask counts",h.counts),esc(h.counts.constant_head||0)]));
 body+="<h3>Native budget rates</h3>"+nativeBudgetTable(engine)+jsonView("Mapped mass balance and unmatched terms",engine.budgets.map(s=>({kstp:s.kstp,kper:s.kper,totim:s.totim,rate_units:s.rate_units,mapped_balance:s.mapped_balance,unmapped_terms:s.unmapped_terms,excluded_internal_terms:s.excluded_internal_terms})),true);
 body+="<h3>Native listing</h3>"+note("Printed listing rates and cumulative volumes retain their own native unit basis. A steady solution is not a transient 24-hour hydrograph.")+jsonView("Printed rates and cumulative volumes",engine.listing)+jsonView("Native grid and mask definition",{shape:engine.shape,grid:engine.grid,mask_definition:engine.mask_definition});
 return card(name==="mf6"?"MODFLOW 6":"MODFLOW-2005 double",body);
}
async function renderRuns(id){
 let body=sectionIntro("Original native runs","Queue an exact reviewed edition, then execute both pinned solvers. Interrupted attempts retain their files and ownership; continuation first reconciles the same original run.")+projectRequired()+card("Retained runs",table(["Run / edition","State","Attempt","Worker","Open"],state.runs.map(x=>[esc(runName(x))+"<br>"+code(x.id),tag(x.state),esc(x.attempt),x.worker_active?"Active original worker":"No live worker",link("runs/"+x.id,"Inspect run")])));
 if(!id)return body+card("Queue an edition",state.editions.length?form("run-create-selected","run-create",'<div class="grid">'+select("edition_id","Retained edition",state.editions.map(x=>[x.id,x.name+" · "+x.review_state]),"","required")+area("reason","Native run purpose","","required")+"</div>","Create queued run"):empty("Retain original source before queueing a run."));
 const d=await read("/runs/"+encodeURIComponent(id));currentDetail=d;const run=d.run;
 body+=card(d.edition.name,facts([["Run",code(run.id)],["State",tag(run.state)+(run.worker_active?" · original worker active":"")],["Edition",link("editions/"+d.edition.id,d.edition.name)],["Runtime SHA-256",code(run.runtime_sha256)],["Application SHA-256",code(run.application_sha256)],["Result SHA-256",code(run.result_sha256||"Not complete")]])+jsonView("Exact runtime and path rebindings",{runtime:run.runtime,rebindings:run.runtime_rebindings})+jsonView("Original attempts",d.attempts)+(run.issue?note(run.issue.message||pretty(run.issue),"bad"):""));
 if(run.state!=="complete"){
  const handler=run.state==="queued"?"run-execute":"run-resume";
  const title=run.state==="queued"?"Execute original run":"Continue original run";
  body+=card(title,form("run-continue-"+id,handler,'<input type="hidden" name="id" value="'+esc(id)+'">'+area("reason","Continuation purpose","","required")+check("retry_incomplete","After the original child has stopped, retain the incomplete attempt and explicitly retry under this same run")+check("rebind_runtime","After restore, adopt configured host paths only if the complete runtime fingerprints match")+note("A live original worker is returned without another execution. Missing files from a completed result are reported as unavailable and are never regenerated by recovery."),title));
 }
 if(d.log_excerpt)body+=card("Observed original attempt log",facts([["Attempt",esc(d.log_excerpt.attempt)],["Observed at",esc(d.log_excerpt.observed_at)],["Bytes",esc(d.log_excerpt.bytes)]])+'<pre>'+esc(d.log_excerpt.tail)+"</pre>");
 if(d.result){
  const result=d.result;
  body+=card("Native completion",facts([["Time semantics",esc(result.time_semantics.replace(/_/g," "))],["Original source",link("sources/"+d.source.id,d.source.name)],["Native completion time",esc(result.completed_at)]])+jsonView("Both original solver executions",result.native_executions,true)+note(result.scientific_precision));
  body+=card("Mapped aquifer comparison",crossEngine(result));
  for(const [name,engine] of Object.entries(result.engines))body+=engineResult(name,engine,id);
  body+=card("Head maps",'<div class="plot-grid">'+(result.derived_plots||[]).map(name=>'<figure><img class="result-img" src="'+esc(apiUrl("/runs/"+id+"/file",{path:"analysis/"+name,inline:"1"}))+'" alt="'+esc(name)+'"><figcaption>'+esc(name)+" · native declared units, model-local grid</figcaption></figure>").join("")+"</div>"+note("The unchanged publisher figure uses normalized specific-discharge arrows. Arrow length in that figure does not represent discharge magnitude."));
  body+=card("Named result review",(d.review?jsonView("Current exact-result review",d.review,true):empty("The numerical result has not yet received a named review."))+reviewForm("run",id,result.findings));
  body+=card("Complete native file closure",table(["Original attempt member","Bytes","SHA-256","Download"],d.files.map(x=>[esc(x.path),esc(x.bytes),code(x.sha256),download("/runs/"+id+"/file","Original bytes",{path:x.path})])));
  body+=card("Next receiving step",'<p>'+link("reports","Freeze the approved result and selected comparisons in a complete report")+".</p>");
 }
 return body;
}
function comparisonView(result){
 let body=facts([["Before run",link("runs/"+result.before_run_id,result.before_run_id)],["After run",link("runs/"+result.after_run_id,result.after_run_id)],["Before result SHA-256",code(result.before_result_sha256)],["After result SHA-256",code(result.after_result_sha256)]]);
 for(const [name,engine] of Object.entries(result.engines)){
  body+="<h3>"+esc(name)+"</h3>"+facts([["Before native units",esc(engine.before_units.length+" / "+engine.before_units.time)],["After native units",esc(engine.after_units.length+" / "+engine.after_units.time)],["Grid matches",esc(engine.grid_matches)],["Units match",esc(engine.units_match)],["Time semantics",esc(engine.time_semantics)]]);
  for(const step of engine.steps){
   body+="<h4>Step "+esc(step.kstp)+" / period "+esc(step.kper)+" · "+esc(step.totim)+" "+esc(step.units.time)+"</h4>"+(step.issue?note(step.issue,"warn"):"");
   body+=table(["Layer","Numeric difference","Physical head difference"],step.layers.map(x=>[esc(x.layer),maskedMetrics(x.numeric_difference),x.physical_head_difference?maskedMetrics(x.physical_head_difference):"Unavailable for this native grid/unit/time pair."]));
  }
  body+="<h4>Boundary and storage rate changes</h4>"+table(["Native time","Term","Before net","After net","Physical net change"],engine.budget_rates.map(x=>[code(x.totim),esc(x.term),code(x.before?.net??"Absent"),code(x.after?.net??"Absent"),x.physical_comparable?code(x.net_difference):"Unavailable"]));
  body+=jsonView("Unmatched before steps",engine.unmatched_before_steps);
 }
 return body;
}
function renderCompare(){
 const runs=state.runs.filter(x=>x.state==="complete").map(x=>[x.id,runName(x)+" · "+x.id]);
 return sectionIntro("Compare retained baseline and scenario","The reader pairs exact original output steps and compares compatible grids and declared units. Numeric differences remain distinct when physical comparison is unavailable.")+card("Select both original runs",form("comparison-select","comparison",'<div class="grid">'+select("baseline_run_id","Before: baseline or parent run",runs,"","required")+select("run_id","After: selected scenario run",runs,"","required")+"</div>","Read immutable comparison",false))+'<section class="card" id="comparison-result" hidden></section>';
}

async function renderReports(id){
 let body=sectionIntro("Frozen complete reports","Each package binds its exact source, edition, native result, selected comparison inputs and outputs, and named review. Opening it later verifies the original frozen bytes.")+card("Report register",table(["Report","Frozen at","SHA-256","Exports"],state.reports.map(x=>[link("reports/"+x.id,x.title),esc(x.created),code(x.sha256),["zip","json","html","csv"].map(format=>download("/reports/"+x.id+"/export",format.toUpperCase(),{format})).join(" · ")])));
 if(id){
  const d=await read("/reports/"+encodeURIComponent(id));currentDetail=d;
  body+=card(d.report.title,facts([["Original report",code(id)],["Frozen report SHA-256",code(d.report.sha256)],["Run",link("runs/"+d.report.run_id,d.report.run_id)],["Frozen actor",esc(d.snapshot.actor)],["Purpose",esc(d.snapshot.reason)]])+jsonView("Frozen source, edition and exact review",{source:d.snapshot.source,edition:d.snapshot.edition,review:d.snapshot.review},true)+jsonView("Included comparison originals",(d.snapshot.comparison_runs||[]).map(x=>({run:x.run,edition:x.edition,review:x.review})))+jsonView("Complete package manifest",d.manifest)+jsonView("Original delivery records",d.deliveries)+jsonView("Named receiving decisions",d.acknowledgments));
 }
 if(projectId){
  const runs=state.runs.filter(x=>x.state==="complete");
  const compare=runs.map(x=>check("comparison_run_ids",runName(x)+" · "+x.id,false,x.id)).join("");
  body+=card("Freeze the reviewed result",form("report-freeze","report-freeze",'<div class="grid">'+select("run_id","Completed run",runs.map(x=>[x.id,runName(x)+" · "+x.id]),"","required")+input("title","Report title","","text","required maxlength=500")+'<div class="wide">'+area("reason","Purpose, scope and receiving use","","required")+"</div></div><h3>Comparison runs to include</h3><p class=\"muted\">Select up to 20 distinct original runs. The package retains their actual inputs, outputs, runtime identity and review state.</p>"+'<div class="choice-list">'+(compare||empty("No completed comparison runs are available."))+"</div>","Freeze complete report"));
 }
 return body;
}
function renderReceiving(){
 const reportRows=state.reports.map(x=>[x.id,x.title]);
 const receiverRows=state.receivers.map(x=>[x.id,x.name]);
 let body=sectionIntro("Delivery and named receiving","A verified file copy establishes delivery. A separate attributed decision records what the receiver accepted or asked to correct.");
 body+=card("Original receivers",table(["Receiver","Private directory","Version","Edit"],state.receivers.map(x=>[esc(x.name),code(x.directory),esc(x.version),'<button type="button" class="small" data-edit-receiver="'+esc(x.id)+'">Edit receiver</button>'])));
 body+=card("Create or update receiver",form("receiver-save","receiver-save",'<input type="hidden" name="id"><input type="hidden" name="expected_receiver_version"><div class="grid">'+input("name","Receiver name","","text","required")+input("directory","Existing absolute receiving directory",cfg.receiverDirectory||"","text","required")+"</div>"+note("Use a private receiving directory separate from the model workspace. Portal storage policies constrain this selection to the current authorized Paths root."),"Save receiver"));
 body+=card("Deliver a frozen report",form("report-deliver","report-deliver",'<div class="grid">'+select("report_id","Original report",reportRows,"","required")+select("receiver_id","Selected receiver",receiverRows,"","required")+'<div class="wide">'+area("reason","Delivery purpose","","required")+"</div></div>","Deliver exact package"));
 body+=card("Original deliveries",table(["Delivery","Report / receiver","File identity","State","Continue"],state.deliveries.map(x=>[code(x.id),link("reports/"+x.report_id,state.reports.find(r=>r.id===x.report_id)?.title||x.report_id)+"<br>"+esc(x.receiver?.name||x.receiver_id),esc(x.filename)+"<br>"+code(x.sha256)+"<br>"+esc(x.bytes)+" bytes",tag(x.state)+(x.issue?"<p>"+esc(x.issue.message)+"</p>":""),'<button type="button" class="small" data-select-delivery="'+esc(x.id)+'">Open original</button>'])));
 const deliveries=state.deliveries.map(x=>[x.id,x.id+" · "+x.state]);
 body+='<div class="split">'+card("Reconcile or continue",form("delivery-control","delivery-control",select("id","Original delivery",deliveries,"","required")+select("mode","Action",[["reconcile","Read back original file and receipt"],["resume","Continue original delivery"]],"reconcile","required")+area("reason","Continuation reason")+note("Continue uses the same delivery ID, report bytes, receiver and filename. It does not create a replacement delivery."),"Continue selected original"))+card("Record receiving decision",form("delivery-acknowledge","delivery-acknowledge",select("id","Original verified delivery",deliveries,"","required")+select("decision","Receiving decision",[["accepted","Accepted"],["corrections_requested","Corrections requested"]],"","required")+'<div class="grid">'+input("by","Receiving reviewer","","text","required")+input("occurred_on","Occurred at, with timezone","","text",'required placeholder="2026-10-12T16:30:00Z"')+"</div>"+input("reference","Original receiving reference","","text","required")+area("reason","What was accepted or what needs correction","","required"),"Save named receiving decision"))+"</div>";
 body+=card("Receiving history",table(["Delivery","Decision","Reviewer / date","Reference and reason","Report SHA-256"],state.acknowledgments.map(x=>[code(x.delivery_id),tag(x.decision),esc(x.by)+"<br>"+esc(x.occurred_on),esc(x.reference)+"<p>"+esc(x.reason)+"</p>",code(x.report_sha256)])));
 return body;
}
function renderRuntime(){
 const r=state.runtime;
 return sectionIntro("Pinned native runtime","Configure existing executables and inspect their complete installed dependency and binary fingerprints. The operator does not install dependencies or start a solver during configuration.")+card("Configured identity",r?facts([["Runtime SHA-256",code(r.sha256)],["Configured by",esc(r.actor)],["Configured at",esc(r.configured_at)],["Reason",esc(r.reason)]])+jsonView("Exact installed runtime",r,true):empty("No original native runtime is configured."))+card("Inspect and configure existing runtime",form("runtime-configure","runtime-configure",'<div class="grid">'+input("python_executable","Python with pinned native dependencies",r?.paths.python_executable||"","text","required")+input("mf6_executable","MODFLOW 6.8.1 executable",r?.paths.mf6_executable||"","text","required")+input("mf2005_executable","MODFLOW-2005 1.12.00 double executable",r?.paths.mf2005_executable||"","text","required")+area("reason","Runtime selection reason","","required")+"</div>"+note("Select mf2005dbl from the official executables 29.0 release. That bundle's older mf6 is not the required 6.8.1 executable.","warn"),"Inspect and configure runtime"))+card("Installation and recovery",'<p>Use the '+ '<a href="'+esc(cfg.guideUrl||"/guide")+'" target="_blank" rel="noopener">operator guide</a>'+" for the explicit dependency and solver acquisition commands. After restore, equivalent installed paths may be selected, but the complete runtime fingerprints must match before the same original run is resumed.</p>");
}
function renderBackup(){
 return sectionIntro("Backup and independent reopen","Capture the stopped complete application, original database, source objects, native attempt files, reports and receiving history. Restore into a new empty destination; original identities and operations remain intact.")+card("Create full backup",form("backup-create","backup-create",area("reason","Backup purpose","","required")+note("All original solver children must be stopped before capture. Existing archive files are retained as history rather than recursively embedded in a later backup."),"Create complete backup"))+card("Original backup register",table(["Backup","State","Original file","Action"],state.backups.map(x=>[code(x.id)+"<br>"+esc(x.created),tag(x.status)+(x.issue?"<p>"+esc(x.issue.message)+"</p>":""),esc(x.filename||"")+"<br>"+code(x.sha256||"")+(x.bytes?"<br>"+esc(x.bytes)+" bytes":""),x.status==="complete"?download("/backups/"+x.id+"/download","Download complete ZIP"):x.status==="external_archive"?"Original archive is held by its receiver.":'<button type="button" class="small" data-select-backup="'+esc(x.id)+'">Continue original backup</button>'])))+card("Continue retained backup",form("backup-resume","backup-resume",select("id","Original backup",state.backups.filter(x=>["queued","failed"].includes(x.status)).map(x=>[x.id,x.id+" · "+x.status]),"","required")+area("reason","Continuation reason","","required"),"Continue original backup"))+card("Independent receiving and restore",'<p>Use these commands with the exact downloaded archive and a new empty destination. The receiving request is retained before extraction, so repeating it reopens that same package.</p><pre>python workspace.py inspect-package --archive /absolute/original-package.zip\npython workspace.py receive-package --archive /absolute/original-report.zip --destination /absolute/new-report-receiver\npython workspace.py restore --archive /absolute/original-backup.zip --destination /absolute/new-restore\npython workspace.py state --workspace /absolute/new-restore/workspace\npython workspace.py serve --workspace /absolute/new-restore/workspace --port 8892</pre>'+note("A restored workspace has its original UUID, operations, sources, editions and run IDs. It does not automatically start a solver. In Tethys, restore to an administrator-prepared private slot and open that slot's UUID-bound URL.")+'<p>Frozen report HTML is in the independently received package. Keep the complete package beside it so its figures and original source/native files remain available.</p>');
}
function renderHistory(){
 const last=parseStored("lastOutcome",null);
 return sectionIntro("Original operation history","Every committed operator request retains its exact ID, actor, workspace version and result. Readback uses the same operation identity after a lost response.")+card("Read a saved operation",form("operation-read","operation-read",input("operation_id","Original operation ID","","text","required"),"Read original operation",false))+'<section class="card" id="operation-result" hidden></section>'+(last?card("Last recovered outcome",jsonView("Original request and result",last,true)):"")+card("Workspace history",table(["Sequence / date","Action","Actor","Original operation","Recorded body"],state.history.map(x=>[esc(x.seq)+"<br>"+esc(x.created),esc(x.action),esc(x.actor),'<button type="button" class="small" data-operation="'+esc(x.operation_id)+'">'+esc(x.operation_id)+"</button>",jsonView("Original event",x.body)])));
}
async function render(){
 if(!state)return;
 const token=++generation,{page,id}=route();
 navigation();
 try{
  const painters={overview:renderOverview,sources:renderSources,editions:renderEditions,runs:renderRuns,compare:renderCompare,reports:renderReports,receiving:renderReceiving,runtime:renderRuntime,backup:renderBackup,history:renderHistory};
  const html=await painters[page](id);
  if(token!==generation)return;
  el("content").innerHTML=html;restoreDrafts();applyAvailability();
 }catch(err){if(token===generation)el("content").innerHTML=card("Original resource unavailable",note(err.message,"bad")+note("The original identifiers and pending requests remain retained. Refresh or return to the original record; this read does not start another native operation."));}
}
function reviewChoices(formNode){
 return Array.from(formNode.querySelectorAll("[data-finding]")).flatMap(node=>{
  const id=node.dataset.finding,disposition=value(formNode,"finding:"+id);
  return disposition?[{id,disposition,reason:value(formNode,"finding_reason:"+id)}]:[];
 });
}
const handlers={
 "project-create":(formNode)=>mutate(formNode,"project.create",{name:value(formNode,"name"),description:value(formNode,"description"),site_label:value(formNode,"site_label")}),
 "project-update":(formNode)=>mutate(formNode,"project.update",{id:value(formNode,"id"),expected_project_version:Number(value(formNode,"expected_project_version")),name:value(formNode,"name"),description:value(formNode,"description"),site_label:value(formNode,"site_label")}),
 "publisher-source":async formNode=>{const result=await mutate(formNode,"source.publisher",{project_id:selectedProject(),name:value(formNode,"name")});if(result?.source_id)location.hash="sources/"+result.source_id;},
 "source-import":async formNode=>{const file=field(formNode,"file").files[0];const p={project_id:selectedProject(),name:value(formNode,"name"),filename:file?.name||"",layer_mapping:parseJSON(value(formNode,"layer_mapping"),"Layer mapping"),intended_units:parseJSON(value(formNode,"intended_units")||"{}","Intended units")};for(const name of ["mf6_namefile","legacy_namefile"])if(value(formNode,name))p[name]=value(formNode,name);const result=await mutate(formNode,"source.import",p,file);if(result?.source_id)location.hash="sources/"+result.source_id;},
 "source-inspect":async formNode=>{const result=await mutate(formNode,"source.inspect",{id:value(formNode,"id"),source_sha256:value(formNode,"source_sha256"),reader_sha256:value(formNode,"reader_sha256"),reason:value(formNode,"reason")});if(result?.source_id)location.hash="sources/"+result.source_id;},
 "scenario-create":async formNode=>{
  const parent=state.editions.find(x=>x.id===value(formNode,"parent_id"));if(!parent)throw new Error("The original parent edition is not selected.");
  const changes=[];
  if(checked(formNode,"change_recharge"))changes.push({kind:"recharge",before:parent.parameters.recharge,after:value(formNode,"recharge"),reason:value(formNode,"recharge_reason")});
  for(const selected of many(formNode,"well_selected")){const index=Number(selected);changes.push({kind:"well",index,before:parent.parameters.wells[index][3],after:value(formNode,"well:"+index),reason:value(formNode,"well_reason:"+index)});}
  if(checked(formNode,"align_units"))changes.push({kind:"legacy_units",before:parent.parameters.legacy_units,after:{length:"feet",time:"seconds"},reason:value(formNode,"units_reason")});
  if(!changes.length)throw new Error("Select at least one explicit scenario change.");
  const result=await mutate(formNode,"edition.create",{project_id:selectedProject(),parent_id:parent.id,name:value(formNode,"name"),description:value(formNode,"description"),changes});if(result?.id)location.hash="editions/"+result.id;
 },
 "edition-review":formNode=>mutate(formNode,"edition.review",{id:value(formNode,"id"),decision:value(formNode,"decision"),reason:value(formNode,"reason"),findings:reviewChoices(formNode),...(value(formNode,"reference_basis_sha256")?{reference_basis_sha256:value(formNode,"reference_basis_sha256")}:{})}),
 "run-review":formNode=>mutate(formNode,"run.review",{id:value(formNode,"id"),decision:value(formNode,"decision"),reason:value(formNode,"reason"),findings:reviewChoices(formNode)}),
 "run-create":async formNode=>{const edition_id=value(formNode,"edition_id");const result=await mutate(formNode,"run.create",{edition_id,reason:value(formNode,"reason"),...editionReference(edition_id)});if(result?.id)location.hash="runs/"+result.id;},
 "run-execute":formNode=>mutate(formNode,"run.execute",{id:value(formNode,"id"),reason:value(formNode,"reason"),retry_incomplete:checked(formNode,"retry_incomplete"),rebind_runtime:checked(formNode,"rebind_runtime")}),
 "run-resume":formNode=>mutate(formNode,"run.resume",{id:value(formNode,"id"),reason:value(formNode,"reason"),retry_incomplete:checked(formNode,"retry_incomplete"),rebind_runtime:checked(formNode,"rebind_runtime")}),
 "comparison":async formNode=>{saveDraft(formNode);const result=await read("/runs/"+encodeURIComponent(value(formNode,"run_id"))+"/compare",{baseline_run_id:value(formNode,"baseline_run_id")});el("comparison-result").hidden=false;el("comparison-result").innerHTML="<h2>Exact retained comparison</h2>"+comparisonView(result);},
 "report-freeze":async formNode=>{const run_id=value(formNode,"run_id"),selected=many(formNode,"comparison_run_ids");if(selected.includes(run_id))throw new Error("Select other original runs as comparisons, not the result being frozen.");const result=await mutate(formNode,"report.freeze",{run_id,title:value(formNode,"title"),reason:value(formNode,"reason"),comparison_run_ids:selected});if(result?.id)location.hash="reports/"+result.id;},
 "receiver-save":formNode=>{const payload={name:value(formNode,"name"),directory:value(formNode,"directory")};if(value(formNode,"id"))Object.assign(payload,{id:value(formNode,"id"),expected_receiver_version:Number(value(formNode,"expected_receiver_version"))});return mutate(formNode,"receiver.save",payload);},
 "report-deliver":formNode=>mutate(formNode,"report.deliver",{report_id:value(formNode,"report_id"),receiver_id:value(formNode,"receiver_id"),reason:value(formNode,"reason")}),
 "delivery-control":formNode=>mutate(formNode,value(formNode,"mode")==="resume"?"delivery.resume":"delivery.reconcile",{id:value(formNode,"id"),...(value(formNode,"mode")==="resume"?{reason:value(formNode,"reason")}:{})}),
 "delivery-acknowledge":formNode=>mutate(formNode,"delivery.acknowledge",{id:value(formNode,"id"),decision:value(formNode,"decision"),by:value(formNode,"by"),occurred_on:value(formNode,"occurred_on"),reference:value(formNode,"reference"),reason:value(formNode,"reason")}),
 "runtime-configure":formNode=>mutate(formNode,"runtime.configure",{python_executable:value(formNode,"python_executable"),mf6_executable:value(formNode,"mf6_executable"),mf2005_executable:value(formNode,"mf2005_executable"),reason:value(formNode,"reason")}),
 "backup-create":formNode=>mutate(formNode,"backup.create",{reason:value(formNode,"reason")}),
 "backup-resume":formNode=>mutate(formNode,"backup.resume",{id:value(formNode,"id"),reason:value(formNode,"reason")}),
 "operation-read":async formNode=>{const result=await read("/operations/"+encodeURIComponent(value(formNode,"operation_id")));el("operation-result").hidden=false;el("operation-result").innerHTML="<h2>Original recorded operation</h2>"+jsonView("Saved request and result",result,true);}
};
document.addEventListener("submit",async event=>{
 const formNode=event.target.closest("form[data-handler]");if(!formNode)return;event.preventDefault();
 if(busy)return;notice("");setBusy(true);
 try{await handlers[formNode.dataset.handler](formNode);}catch(err){notice(err.message,true);}finally{setBusy(false);renderRecovery();}
});
document.addEventListener("input",event=>{const formNode=event.target.closest("form[data-draft-key]");if(formNode)saveDraft(formNode);});
document.addEventListener("change",event=>{const formNode=event.target.closest("form[data-draft-key]");if(formNode)saveDraft(formNode);});
document.addEventListener("click",async event=>{
 const button=event.target.closest("button");if(!button||busy)return;
 try{
  if(button.hasAttribute("data-reset-draft")){const original=button.closest("form[data-draft-key]");if(pending)throw new Error("Recover the original request before discarding its draft.");removeStored("draft:"+original.dataset.draftKey);await refresh();notice("The saved draft was discarded and current values were reloaded.");return;}
  if(button.dataset.project){projectId=button.dataset.project;saveStored("project",projectId);await refresh();return;}
  if(button.id==="recover-request"||button.id==="retry-request"){setBusy(true);if(button.id==="recover-request")await recoverPending();else await sendPending();return;}
  if(button.id==="return-to-draft"&&pending?.rejected){saveStored("rejected:"+pending.request.operation_id,pending);removeStored("pending");pending=null;renderRecovery();notice("The rejected request remains in local history. Review the preserved draft against current state before saving a new request.");await refresh();return;}
  if(button.dataset.viewSource){
   const response=await fetch(apiUrl("/sources/"+encodeURIComponent(button.dataset.viewSource)+"/original",{path:button.dataset.path}),{credentials:"same-origin",cache:"no-store"});
   if(!response.ok)throw new Error("The exact original source file is unavailable.");
   const raw=await response.arrayBuffer();if(raw.byteLength>2*1024*1024)throw new Error("This original is larger than the 2 MiB text preview. Download its verified original bytes.");
   const decoded=new TextDecoder("utf-8",{fatal:true}).decode(raw);el("source-viewer").hidden=false;el("source-viewer-path").textContent=button.dataset.path;el("source-viewer-text").textContent=decoded;el("source-viewer").scrollIntoView({behavior:"smooth",block:"start"});return;
  }
  if(button.dataset.editReceiver){
   const receiver=state.receivers.find(x=>x.id===button.dataset.editReceiver),formNode=el("receiver-save");
   for(const name of ["id","name","directory"])field(formNode,name).value=receiver[name];field(formNode,"expected_receiver_version").value=receiver.version;saveDraft(formNode);formNode.scrollIntoView({behavior:"smooth"});return;
  }
  if(button.dataset.selectDelivery){for(const id of ["delivery-control","delivery-acknowledge"]){field(el(id),"id").value=button.dataset.selectDelivery;saveDraft(el(id));}el("delivery-control").scrollIntoView({behavior:"smooth"});return;}
  if(button.dataset.selectBackup){field(el("backup-resume"),"id").value=button.dataset.selectBackup;saveDraft(el("backup-resume"));el("backup-resume").scrollIntoView({behavior:"smooth"});return;}
  if(button.dataset.operation){field(el("operation-read"),"operation_id").value=button.dataset.operation;await handlers["operation-read"](el("operation-read"));el("operation-result").scrollIntoView({behavior:"smooth"});}
 }catch(err){notice(err.message,true);}finally{setBusy(false);renderRecovery();}
});
el("project-select").addEventListener("change",async event=>{if(busy)return;projectId=event.target.value;saveStored("project",projectId);location.hash=route().page;try{await refresh();}catch(err){notice(err.message,true);}});
el("refresh").addEventListener("click",()=>refresh().catch(err=>notice(err.message,true)));
el("actor").value=cfg.actor||parseStored("actor","");el("actor").readOnly=Boolean(cfg.actor);
el("actor").addEventListener("change",()=>saveStored("actor",el("actor").value));
el("guide-link").href=cfg.guideUrl||"/guide";
window.addEventListener("hashchange",()=>render());
window.addEventListener("beforeunload",event=>{if(busy||pending){event.preventDefault();event.returnValue="";}});
refresh().catch(err=>{notice(err.message,true);el("content").innerHTML=card("Workspace connection",note("The original workspace could not be read. Retained requests remain in this browser; refresh after the original service is available.","warn"));renderRecovery();});
})();
