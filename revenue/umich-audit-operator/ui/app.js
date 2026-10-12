"use strict";
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const esc = value => String(value ?? "").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pretty = value => typeof value === "string" ? value : JSON.stringify(value, null, 2);
const list = value => Array.isArray(value) ? value : String(value||"").split(/[\n,]/).map(s=>s.trim()).filter(Boolean);
const title = value => String(value||"").replaceAll("_"," ").replace(/\b[a-z]/g,c=>c.toUpperCase());
let workspace = new URL(location.href).searchParams.get("workspace") || "";
let state, route="overview", routeOptions={}, generation=0;
const page=$("#page"), dialog=$("#editor");
const endpoint=(path,query={})=>path+"?"+new URLSearchParams({...query,...(workspace?{workspace}:{})});
const download=(id,inline=false)=>endpoint("/api/artifact/download",{id,...(inline?{inline:"1"}:{})});
function notice(message,error=false){const n=$("#notice");n.hidden=!message;n.classList.toggle("error",error);n.textContent=message;}
function errorBox(error){return '<div class="error" role="alert">'+esc(error.message||error)+(error.diagnostics?.length?'<pre>'+esc(pretty(error.diagnostics))+'</pre>':"")+'</div>';}
async function api(path,query={},post){
 const response=await fetch(endpoint(path,query),{credentials:"same-origin",...(post===undefined?{}:{method:"POST",headers:{"Content-Type":"application/json","X-Audit-Request":"1"},body:JSON.stringify(post)})});
 const data=await response.json();
 if(!response.ok){const e=new Error(data.error||"The workspace request did not complete.");Object.assign(e,data,{status:response.status});throw e;}return data;
}
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==="object")return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
async function hashInputs(v){const b=new TextEncoder().encode(JSON.stringify(canonical(v)));return [...new Uint8Array(await crypto.subtle.digest("SHA-256",b))].map(x=>x.toString(16).padStart(2,"0")).join("");}
function pendingKey(){return "commons-audit-pending-"+workspace;}
function pending(){try{return JSON.parse(sessionStorage.getItem(pendingKey())||"[]");}catch{return [];}}
function retainPending(values){try{sessionStorage.setItem(pendingKey(),JSON.stringify(values.slice(-30)));}catch{}}
async function action(name,inputs){
 const inputHash=await hashInputs({name,inputs});
 let original=pending().find(p=>p.hash===inputHash);
 if(!original){original={id:"ui-"+crypto.randomUUID(),action:name,hash:inputHash,at:new Date().toISOString()};retainPending([...pending(),original]);}
 try{
  const result=await api("/api/action",{}, {action:name,inputs,operation_id:original.id});
  retainPending(pending().filter(p=>p.id!==original.id));
  notice((result.replayed?"Recovered the original completed operation. ":"")+title(name)+" completed.");
  return result;
 }catch(e){
  if(e.status && e.status<500 && ![408,429].includes(e.status))retainPending(pending().filter(p=>p.id!==original.id));
  else notice("The response did not arrive. The original operation "+original.id+" is retained; retrying these same inputs reuses it.",true);
  throw e;
 }
}
async function fileInput(file,role="original",namespace=""){
 if(!file)throw new Error("Choose the complete original file.");
 if(file.size>64*1024*1024)throw new Error("The complete file exceeds 64 MiB.");
 const bytes=new Uint8Array(await file.arrayBuffer());let binary="";
 for(let n=0;n<bytes.length;n+=32768)binary+=String.fromCharCode(...bytes.subarray(n,n+32768));
 const result=await action("upload_source",{name:file.name,media_type:file.type||"application/octet-stream",data_base64:btoa(binary),role,namespace});
 return result.source;
}
function pageHead(name,description,actions=""){return '<div class="page-head"><div><h1>'+esc(name)+'</h1><p>'+esc(description)+'</p></div><div class="actions">'+actions+'</div></div>';}
function empty(message){return '<div class="empty">'+esc(message)+'</div>';}
function table(headings,rows){return '<div class="table-wrap"><table><thead><tr>'+headings.map(h=>'<th scope="col">'+esc(h)+'</th>').join("")+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>';}
function pill(value,strong=false){return '<span class="pill'+(strong?" strong":"")+'">'+esc(value)+'</span>';}
function artifactLink(a,label){return '<a href="'+esc(download(a.id))+'">'+esc(label||a.payload.name)+'</a>';}
function field(label,input,help=""){return '<div class="field"><label>'+esc(label)+'</label>'+input+(help?'<small>'+esc(help)+'</small>':"")+'</div>';}
function namedField(label,id,input,help=""){return '<div class="field"><label for="'+esc(id)+'">'+esc(label)+'</label>'+input+(help?'<small>'+esc(help)+'</small>':"")+'</div>';}
function dialogOpen(name,body){$("#dialog-title").textContent=name;$("#dialog-body").innerHTML=body;if(!dialog.open)dialog.showModal();}
function dialogError(e){let target=$(".dialog-error",dialog);if(!target){target=document.createElement("div");target.className="dialog-error";$("#dialog-body").prepend(target);}target.innerHTML=errorBox(e);target.scrollIntoView({block:"nearest"});}
function bindBusy(form,handler){form.addEventListener("submit",async e=>{e.preventDefault();const b=$('button[type="submit"]',form);if(b)b.disabled=true;try{await handler(new FormData(form),form);}catch(err){dialog.open?dialogError(err):notice(err.message,true);}finally{if(b)b.disabled=false;}});}
async function allRecords(kind){let values=[],offset=0;for(;;){const r=await api("/api/records",{kind,offset,limit:500});values.push(...r.items);offset+=r.items.length;if(offset>=r.total||!r.items.length)break;}return values;}
async function refreshState(){state=await api("/api/state");workspace=state.host_workspace_key;$("#actor-name").textContent=state.actor.label;$("#actor-role").textContent=title(state.actor.role);$("#workspace-id").textContent=state.workspace_id;$("#workspace-short").textContent=state.workspace_id;renderNav();}
const groups=[
 ["WORKSPACE",[["overview","Overview"],["risk","Risk & audit plan"],["engagement","Engagements"],["audit_area","Audit areas"],["sub_activity","Control activities"],["workpaper","Workpapers"],["observation","Observations"],["management_action","Management actions"],["evidence","Evidence"]]],
 ["REPORTING",[["follow-up","Follow-up"],["advisory_memo","Advisory memos"],["reports","Reports & handoffs"],["questionnaire","Issuer questionnaire"]]],
 ["OPERATIONS",[["sources","Source intake & mappings"],["receiving","Receiving & reconciliation"],["history","Activity & outputs"],["access","Access"],["recovery","Backup & recovery"]]]
];
function allowed(r){if(state.can_edit)return r!=="access"||state.actor.admin;return ["overview","engagement","audit_area","sub_activity","observation","management_action","evidence","follow-up","advisory_memo","reports","history"].includes(r);}
function renderNav(){$("#navigation").innerHTML=groups.map(([group,items])=>{const rows=items.filter(([r])=>allowed(r));return rows.length?'<div class="nav-group">'+esc(group)+'</div>'+rows.map(([r,n])=>'<button data-route="'+esc(r)+'"'+(r===route?' aria-current="page"':"")+'>'+esc(n)+'</button>').join(""):"";}).join("");$$("[data-route]",$("#navigation")).forEach(b=>b.onclick=()=>openRoute(b.dataset.route));}
async function openRoute(next=route,options={}){
 route=next;routeOptions=options;const current=++generation;renderNav();$("#navigation").classList.remove("open");$("#menu-toggle").setAttribute("aria-expanded","false");page.innerHTML='<p class="muted" role="status">Opening '+esc(title(next))+'…</p>';
 try{
  if(next==="overview")await overview();
  else if(next==="follow-up")await followUp();
  else if(next==="sources")await sourcesPage();
  else if(next==="reports")await reportsPage();
  else if(next==="receiving")await receivingPage();
  else if(next==="questionnaire")await questionnairePage();
  else if(next==="history")await historyPage();
  else if(next==="access")await accessPage();
  else if(next==="recovery")await recoveryPage();
  else await recordsPage(next,options);
  if(current===generation)$("#main").focus({preventScroll:true});
 }catch(e){if(current===generation)page.innerHTML=pageHead(title(next),"")+errorBox(e);}
}
async function overview(){
 const o=state.overview;
 page.innerHTML=pageHead("Audit workspace","Plan engagements, retain working records, resolve findings and prepare the appropriate reporting release.")+
 '<div class="metrics">'+[["Engagements",o.engagements],["Observations",o.observations],["Open actions",o.open_actions],["Follow-up due",o.follow_up_due]].map(([n,v])=>'<div class="metric"><span>'+esc(n)+'</span><strong>'+esc(v)+'</strong></div>').join("")+'</div>'+
 '<div class="grid"><section class="card"><h2>Work in progress</h2>'+table(["Record family","Records"],Object.entries(state.counts).map(([k,v])=>['<button class="link" data-family="'+esc(k)+'">'+esc(state.schemas[k]?.title||title(k))+'</button>',esc(v)]))+
 '<div class="actions">'+(state.can_edit?'<button id="overview-new">New engagement</button><button id="overview-intake">Import original records</button>':'<button id="overview-reports">Prepare a report</button>')+'</div></section>'+
 '<section class="card"><h2>Action follow-up</h2><dl class="detail-list"><dt>Committee review due</dt><dd>'+esc(o.committee_review_due)+'</dd><dt>Unresolved priority</dt><dd>'+esc(o.unresolved_priorities)+'</dd><dt>Current workpapers reviewed</dt><dd>'+esc(o.current_workpapers_reviewed)+'</dd><dt>Retained sources</dt><dd>'+esc(state.source_count)+'</dd></dl><button id="overview-follow">Open follow-up queue</button>'+
 '<h3>Operating reference</h3><p class="help">High and medium follow-up uses the published six- and twelve-month references. An explicit action-plan date is retained separately. A unit completion statement remains separate from auditor verification.</p><a href="https://audits.umich.edu/the-audit-process/reporting-follow-up/" target="_blank" rel="noreferrer">U-M reporting and follow-up</a></section></div>'+
 (state.can_edit&&state.readiness.length?'<section class="card"><h2>Records needing attention</h2>'+table(["Record","Detail"],state.readiness.map(r=>[esc(r.id||r.record_id||r.kind||"Workspace"),esc(r.message||r.detail||pretty(r))]))+'</section>':"");
 $$("[data-family]").forEach(b=>b.onclick=()=>openRoute(b.dataset.family));
 if($("#overview-new"))$("#overview-new").onclick=()=>recordEditor("engagement");
 if($("#overview-intake"))$("#overview-intake").onclick=()=>openRoute("sources");
 if($("#overview-reports"))$("#overview-reports").onclick=()=>openRoute("reports");
 $("#overview-follow").onclick=()=>openRoute("follow-up");
}
function recordColumns(kind,r){
 const p=r.record.payload;
 const context=p.owner_unit||p.unit_id||(p.unit_ids||[]).join(", ")||p.engagement_id||p.observation_id||"";
 const status=p.normalized_stage||p.status||p.source_status||p.priority_normalized||p.classification||"";
 return ['<button class="link" data-open="'+esc(r.record.id)+'">'+esc(r.label)+'</button>',esc(context),esc(status),
  r.score?esc(pretty(r.score)):r.current_review?pill(r.current_review.decision):esc("—"),esc(r.record.revision)];
}
async function recordsPage(kind,options={}){
 const schema=state.schemas[kind];if(!schema)throw new Error("Choose an available record family.");
 const result=await api("/api/records",{kind,q:options.q||"",offset:options.offset||0,limit:50});
 page.innerHTML=pageHead(schema.title,"Original record identity and earlier revisions remain available after each correction.",
  state.can_edit&&schema.fields.length?'<button class="primary" id="new-record">New '+esc(title(kind))+'</button>':"")+
 '<form class="toolbar" id="record-search"><label class="visually-label" for="record-query">Find records</label><input id="record-query" name="q" value="'+esc(options.q||"")+'" placeholder="Search record text or original ID"><button type="submit">Search</button></form>'+
 (result.items.length?table(["Record","Unit / parent","Stage / priority","Review / score","Revision"],result.items.map(r=>recordColumns(kind,r))):empty("No records match this view."))+
 '<div class="pager"><button id="record-previous" '+(result.offset===0?"disabled":"")+'>Previous</button><span>'+esc(result.total?result.offset+1:0)+'–'+esc(result.offset+result.items.length)+' of '+esc(result.total)+'</span><button id="record-next" '+(result.offset+result.limit>=result.total?"disabled":"")+'>Next</button></div>';
 if($("#new-record"))$("#new-record").onclick=()=>recordEditor(kind);
 $("#record-search").onsubmit=e=>{e.preventDefault();openRoute(kind,{q:$("#record-query").value,offset:0});};
 $("#record-previous").onclick=()=>openRoute(kind,{q:options.q||"",offset:Math.max(0,result.offset-50)});
 $("#record-next").onclick=()=>openRoute(kind,{q:options.q||"",offset:result.offset+50});
 $$("[data-open]").forEach(b=>b.onclick=()=>recordDetail(kind,b.dataset.open));
}
async function recordDetail(kind,id){
 const value=await api("/api/record",{kind,id}),r=value.record,p=r.payload,schema=state.schemas[kind];
 const known=new Set(schema.fields.map(s=>s.name));
 dialogOpen(title(kind),'<h3>'+esc(p[schema.label]||p.title||r.source.id)+'</h3>'+pill("Revision "+r.revision)+
 '<dl class="detail-list">'+schema.fields.filter(s=>p[s.name]!==undefined&&p[s.name]!==null&&p[s.name]!=="").map(s=>'<dt>'+esc(s.label)+'</dt><dd>'+esc(pretty(p[s.name]))+'</dd>').join("")+'</dl>'+
 (kind==="evidence"?'<p><a href="'+esc(endpoint("/api/evidence/download",{id}))+'">Download the exact retained evidence file</a></p>':"")+
 '<details><summary>Original identity and additional retained fields</summary><pre>'+esc(pretty({id:r.id,source:r.source,created_at:r.created_at,updated_at:r.updated_at,projection:r.projection,additional:Object.fromEntries(Object.entries(p).filter(([k])=>!known.has(k)))}))+'</pre></details>'+
 (state.can_edit?'<div class="actions"><button id="edit-record" class="primary">Edit current revision</button><button id="review-record">Record review</button><button id="history-record">Revision history</button>'+(kind==="management_action"?'<button id="verify-record">Record implementation review</button>':"")+'</div>':""));
 if(!state.can_edit)return;
 $("#edit-record").onclick=()=>recordEditor(kind,r);
 $("#review-record").onclick=()=>reviewDialog(r,value.input_hash);
 $("#history-record").onclick=async()=>{const h=await api("/api/history",{kind,id});dialogOpen("Revision history",h.records.map(v=>'<details'+(v.revision===r.revision?" open":"")+'><summary>Revision '+esc(v.revision)+(v.projection?" · retained audience projection":"")+' · '+esc(v.updated_at||"Original timestamp not supplied")+'</summary><pre>'+esc(pretty(v))+'</pre></details>').join(""));};
 if($("#verify-record"))$("#verify-record").onclick=()=>verifyDialog(r);
}
function renderField(spec,value){
 const id="edit-"+spec.name,common='id="'+esc(id)+'" name="'+esc(spec.name)+'"'+(spec.required?" required":"");
 let input;
 if(spec.type==="boolean")return '<div class="field"><label class="check" for="'+id+'"><input type="checkbox" '+common+(value===true?" checked":"")+'> '+esc(spec.label)+'</label></div>';
 if(spec.type==="select")input='<select '+common+'>'+(!spec.required&&!spec.options.includes("")?'<option value="">—</option>':"")+spec.options.map(v=>'<option value="'+esc(v)+'"'+(value===v?" selected":"")+'>'+esc(v||"Unresolved / unselected")+'</option>').join("")+'</select>';
 else if(["textarea","json","list"].includes(spec.type))input='<textarea '+common+(spec.type==="json"?' class="code"':"")+'>'+esc(spec.type==="list"?(Array.isArray(value)?value.join("\n"):value||""):spec.type==="json"?(value?pretty(value):""):value||"")+'</textarea>';
 else input='<input '+common+' type="'+(spec.type==="date"?"date":spec.type==="integer"?"number":"text")+'"'+(spec.type==="integer"?' min="0" step="1"':spec.type==="decimal"?' inputmode="decimal"':"")+(spec.type==="reference"?' list="lookup-'+esc(spec.target)+'"':"")+' value="'+esc(value??"")+'">';
 return namedField(spec.label+(spec.required?" *":""),id,input,spec.type==="list"?"One original ID per line.":spec.type==="reference"?"Select or enter the saved record ID.":spec.type==="json"?"Retain the full ordered JSON rules.":"");
}
async function recordEditor(kind,record=null,defaults={}){
 const schema=state.schemas[kind];let payload={...(record?.payload||defaults)};
 if(kind==="engagement"&&!record)payload.normalized_stage="Planning";
 if(kind==="evidence"&&!record)payload.classification="auditor_only";
 dialogOpen((record?"Edit ":"New ")+title(kind),'<form id="record-form"><div class="grid">'+schema.fields.map(s=>'<div class="'+(["textarea","list","json"].includes(s.type)?"full":"")+'">'+renderField(s,payload[s.name])+'</div>').join("")+'</div>'+
 (!record&&kind!=="questionnaire_response"?'<details><summary>Original source identity</summary>'+namedField("Source namespace","original-namespace",'<input id="original-namespace" name="_namespace" value="'+esc(state.workspace_id)+'">')+namedField("Original record ID","original-id",'<input id="original-id" name="_source_id" placeholder="Leave blank for a new locally assigned identity">')+'</details>':"")+
 '<div id="field-lookups"></div><div class="dialog-actions"><button type="button" id="cancel-edit">Cancel</button><button type="submit" class="primary">Save '+(record?"revision "+(record.revision+1):"record")+'</button></div></form>');
 $("#cancel-edit").onclick=()=>dialog.close();
 bindBusy($("#record-form"),async fd=>{
  const value={...payload};
  for(const spec of schema.fields){
   const raw=fd.get(spec.name);
   if(spec.type==="boolean")value[spec.name]=raw==="on";
   else if(spec.type==="list")value[spec.name]=list(raw);
   else if(spec.type==="integer")value[spec.name]=raw===""?null:Number(raw);
   else if(spec.type==="json")value[spec.name]=raw?JSON.parse(raw):{};
   else value[spec.name]=raw===null?"":String(raw);
  }
  await action("save_record",{kind,...(record?{id:record.id}:{}),expected_revision:record?.revision||0,payload:value,...(!record?{source_namespace:fd.get("_namespace")||state.workspace_id,source_id:fd.get("_source_id")||null}:{})});
  dialog.close();await refreshState();await openRoute();
 });
 for(const target of [...new Set(schema.fields.filter(s=>s.target).map(s=>s.target))]){
  const values=await api("/api/records",{kind:target,limit:500});
  const host=$("#field-lookups");if(!host)return;
  host.insertAdjacentHTML("beforeend",'<datalist id="lookup-'+esc(target)+'">'+values.items.map(v=>'<option value="'+esc(v.record.id)+'">'+esc(v.label)+'</option>').join("")+'</datalist>');
 }
}
function reviewDialog(r,inputHash){
 dialogOpen("Review current "+title(r.kind),'<form id="review-form"><p>This decision applies to '+esc(r.id)+' at revision '+esc(r.revision)+'.</p>'+
 namedField("Decision","review-decision",'<select id="review-decision" name="decision"><option value="approved">Approved</option><option value="rework">Rework requested</option><option value="withdrawn">Review withdrawn</option></select>')+
 namedField("Review reason","review-reason",'<textarea id="review-reason" name="reason" required></textarea>')+'<div class="dialog-actions"><button type="submit" class="primary">Record review</button></div></form>');
 bindBusy($("#review-form"),async fd=>{await action("review",{kind:r.kind,id:r.id,expected_revision:r.revision,input_hash:inputHash,decision:fd.get("decision"),reason:fd.get("reason")});dialog.close();await refreshState();await openRoute();});
}
async function verifyDialog(r){
 const ev=await allRecords("evidence");
 dialogOpen("Implementation review",'<form id="verify-form"><p>The unit’s statement remains in the action history. This records the auditor’s evidence and conclusion.</p>'+
 namedField("Review date","verify-date",'<input id="verify-date" name="review_date" type="date" required value="'+new Date().toISOString().slice(0,10)+'">')+
 namedField("Assessment","verify-assessment",'<textarea id="verify-assessment" name="assessment" required></textarea>')+
 '<fieldset><legend>Retained implementation evidence</legend>'+ev.map(e=>'<label class="check"><input type="checkbox" name="evidence" value="'+esc(e.record.id)+'">'+esc(e.label)+'</label>').join("")+'</fieldset><p class="help">Only evidence from this action’s engagement can be accepted.</p>'+
 '<label class="check"><input type="checkbox" name="completed">Implementation verified complete</label>'+
 namedField("Next review date, if explicitly scheduled","verify-next",'<input id="verify-next" name="next_review_date" type="date">')+
 '<div class="dialog-actions"><button type="submit" class="primary">Save implementation review</button></div></form>');
 bindBusy($("#verify-form"),async fd=>{await action("verify_action",{id:r.id,expected_revision:r.revision,evidence_ids:fd.getAll("evidence"),assessment:fd.get("assessment"),review_date:fd.get("review_date"),completed:fd.get("completed")==="on",next_review_date:fd.get("next_review_date")||null});dialog.close();await refreshState();await openRoute();});
}
async function followUp(){
 const r=await api("/api/follow-up",{...(routeOptions.as_of?{as_of:routeOptions.as_of}:{})});
 page.innerHTML=pageHead("Follow-up","Action-plan completion, recurring review and committee reference dates retain their separate meanings.")+
 '<form id="follow-form" class="inline-fields">'+namedField("As of","follow-date",'<input id="follow-date" name="date" type="date" value="'+esc(routeOptions.as_of||new Date().toISOString().slice(0,10))+'">')+'<button type="submit">Calculate queue</button></form>'+
 (r.items.length?table(["Action","Unit / priority","Unit statement","Auditor","MAP / reference","Next follow-up"],r.items.map(x=>[
 '<button class="link" data-action="'+esc(x.id)+'">'+esc(x.title)+'</button>',esc(x.owner_unit||"—")+'<br>'+pill(x.priority||"Unresolved"),
 esc(x.unit_status||"—")+(x.unit_completion_statement?'<p>'+esc(x.unit_completion_statement)+'</p>':""),
 pill(x.auditor_verified?"Verified":"Open",!x.auditor_verified),esc(x.target_date||"No target")+'<br><small>Reference: '+esc(x.reference_target_date||"Not routine")+'</small>'+(x.explicit_target_date?'<br><small>Override: '+esc(x.override_source)+'</small>':"")+(x.committee_review_due?'<p>'+pill("Committee review due",true)+'</p>':""),
 esc(x.next_review_date||"—")+(x.follow_up_due?'<p>'+pill("Follow-up due",true)+'</p>':"")])):empty("No management actions are visible in this scope."))+
 '<p class="help">Calendar month calculations clamp to month end. Low-priority items remain unit records and are excluded from routine Audit Services follow-up. Unknown priority stays unresolved.</p>';
 $("#follow-form").onsubmit=e=>{e.preventDefault();openRoute("follow-up",{as_of:$("#follow-date").value});};$$("[data-action]").forEach(b=>b.onclick=()=>recordDetail("management_action",b.dataset.action));
}

async function sourcesPage(){
 const [sources,mappings]=await Promise.all([api("/api/sources"),allRecords("source_mapping")]);
 page.innerHTML=pageHead("Source intake & mappings","Retain complete original files, inspect every row, review mappings and adopt stable record identities.",
 '<button class="primary" id="intake-start">Import audit records</button><button id="retain-file">Retain a document</button>')+
 '<div class="grid"><section class="card full"><h2>Original sources</h2>'+
 (sources.sources.length?table(["Source","Role / namespace","Bytes","Original hash","Actions"],sources.sources.map(s=>[
 esc(s.name),esc(s.role)+'<br><small>'+esc(s.namespace||"")+'</small>',esc(s.bytes.toLocaleString()),'<span class="code">'+esc(s.sha256)+'</span>',
 '<div class="actions"><a href="'+esc(endpoint("/api/source/download",{id:s.id}))+'">Download</a><button data-evidence-source="'+esc(s.id)+'">Link evidence</button><button data-inspect-source="'+esc(s.id)+'">Inspect</button></div>'])):empty("Retain a complete original source file to begin."))+
 '</section><section class="card full"><h2>Retained mappings</h2>'+
 (mappings.length?table(["Mapping","Source namespace","Revision"],mappings.map(m=>['<button class="link" data-mapping="'+esc(m.record.id)+'">'+esc(m.label)+'</button>',esc(m.record.payload.source_namespace),esc(m.record.revision)])):empty("Mappings can be saved while preparing a source import."))+'</section></div>';
 $("#intake-start").onclick=()=>intakeDialog(mappings,sources.sources);
 $("#retain-file").onclick=()=>retainDialog();
 $$("[data-mapping]").forEach(b=>b.onclick=()=>recordDetail("source_mapping",b.dataset.mapping));
 $$("[data-evidence-source]").forEach(b=>b.onclick=()=>{const s=sources.sources.find(s=>s.id===b.dataset.evidenceSource);recordEditor("evidence",null,{filename:s.name,source_id:s.id,sha256:s.sha256,size:s.bytes,media_type:s.media_type,classification:"auditor_only"});});
 $$("[data-inspect-source]").forEach(b=>b.onclick=async()=>{try{const r=await api("/api/source/inspect",{id:b.dataset.inspectSource});dialogOpen("Retained source",'<pre>'+esc(pretty(r))+'</pre>');}catch(e){notice(e.message,true);}});
}
function retainDialog(){
 dialogOpen("Retain an original document",'<form id="retain-form">'+namedField("Complete file","retain-original",'<input id="retain-original" name="file" type="file" required>')+
 namedField("Role","retain-role",'<select id="retain-role" name="role"><option value="original">Original source</option><option value="evidence">Audit evidence</option><option value="reference">Published reference</option><option value="target_contract">Declared native target contract</option></select>')+
 namedField("Source namespace","retain-namespace",'<input id="retain-namespace" name="namespace" placeholder="Original system or acquisition">')+
 '<div class="dialog-actions"><button type="submit" class="primary">Retain complete file</button></div></form>');
 bindBusy($("#retain-form"),async fd=>{await fileInput(fd.get("file"),fd.get("role"),fd.get("namespace"));dialog.close();await refreshState();await openRoute();});
}
function intakeDialog(mappings,sources){
 const kinds=Object.keys(state.schemas).filter(k=>!["review_decision","receiving_projection"].includes(k));
 dialogOpen("Import original audit records",'<form id="intake-form">'+
 '<div class="grid">'+namedField("Complete original file","intake-file",'<input id="intake-file" name="file" type="file" accept=".csv,.json,.jsonl">')+
 namedField("Or select a retained source","intake-retained",'<select id="intake-retained" name="source_id"><option value="">Choose a source</option>'+sources.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join("")+'</select>')+
 namedField("Record family","intake-kind",'<select id="intake-kind" name="kind">'+kinds.map(k=>'<option value="'+esc(k)+'">'+esc(state.schemas[k].title)+'</option>').join("")+'</select>')+
 namedField("Original source namespace","intake-namespace",'<input id="intake-namespace" name="namespace" required placeholder="Source system and dataset">')+
 namedField("CSV delimiter","intake-delimiter",'<select id="intake-delimiter" name="delimiter"><option value=",">Comma</option><option value=";">Semicolon</option><option value="|">Pipe</option><option value="&#9;">Tab</option></select>')+
 namedField("Encoding","intake-encoding",'<select id="intake-encoding" name="encoding"><option>utf-8-sig</option><option>utf-8</option><option>utf-16</option><option>utf-16-le</option></select>')+
 '</div>'+namedField("Saved mapping, if applicable","intake-mapping",'<select id="intake-mapping" name="mapping_id"><option value="">Prepare a new mapping</option>'+mappings.map(m=>'<option value="'+esc(m.record.id)+'">'+esc(m.label)+'</option>').join("")+'</select>')+
 '<p class="help">JSON may contain a complete rows_by_kind object. CSV preserves the original header labels and zero-based column positions, including blank or duplicate headers.</p><div class="dialog-actions"><button type="submit" class="primary">Inspect complete source</button></div></form>');
 bindBusy($("#intake-form"),async fd=>{
  let sourceId=fd.get("source_id");
  if(fd.get("file")?.size)sourceId=(await fileInput(fd.get("file"),"original",fd.get("namespace"))).id;
  if(!sourceId)throw new Error("Choose an original file or retained source.");
  const inputs={source_id:sourceId,kind:fd.get("kind"),source_namespace:fd.get("namespace"),delimiter:fd.get("delimiter"),encoding:fd.get("encoding"),...(fd.get("mapping_id")?{mapping_id:fd.get("mapping_id")}:{})};
  const inspected=await api("/api/source/inspect",{id:sourceId,kind:inputs.kind,delimiter:inputs.delimiter,encoding:inputs.encoding});
  mappingDialog(inputs,inspected);
 });
}
function mappingDialog(inputs,inspected){
 const specs=state.schemas[inputs.kind].fields,fields=["record_source_id","source_namespace","source_revision",...specs.map(s=>s.name)];
 const transforms=["identity","string","trim","integer","decimal","boolean","date","json","split","value_map"];
 const rows=(inspected.headers||[]).map(h=>{
  const guess=fields.includes(h.name)?h.name:(h.name==="source_id"&&inputs.kind!=="evidence"?"record_source_id":"");
  const spec=specs.find(s=>s.name===guess);
  const transform=spec?.type==="list"?"split":["integer","decimal","boolean","date","json"].includes(spec?.type)?spec.type:"identity";
  return ['<span class="code">'+esc(h.ordinal)+'</span> '+esc(h.name||"(blank header)"),
   '<select aria-label="Target for column '+h.ordinal+'" data-map-target="'+h.ordinal+'"><option value="">Retain as original value only</option>'+fields.map(v=>'<option'+(v===guess?" selected":"")+'>'+esc(v)+'</option>').join("")+'</select>',
   '<select aria-label="Transform for column '+h.ordinal+'" data-map-transform="'+h.ordinal+'">'+transforms.map(t=>'<option'+(t===transform?" selected":"")+'>'+t+'</option>').join("")+'</select>'];
 });
 dialogOpen("Review source mapping",'<form id="mapping-form"><h3>'+esc(inspected.source.name)+'</h3><p>'+esc(inspected.rows!==undefined?inspected.rows+" complete rows":pretty(inspected.counts||{}))+' retained for normalization.</p>'+
 (inspected.format==="csv"&&!inputs.mapping_id?table(["Original column / ordinal","Canonical field","Explicit transform"],rows):'<p>'+esc(inputs.mapping_id?"The retained mapping record will be applied at its current revision.":"Named JSON values will be normalized with their retained source identities.")+'</p>')+
 '<details><summary>Original preview</summary><pre>'+esc(pretty(inspected.preview||inspected))+'</pre></details>'+
 (!inputs.mapping_id?'<details><summary>Advanced ordered mapping rules</summary>'+namedField("Optional exact JSON rules","mapping-json",'<textarea id="mapping-json" name="mapping_json" class="code" placeholder="Leave blank to use the reviewed column mapping"></textarea>',"Use value_map, relationship_key, separator or null_rule here when the original format needs them. A split transform uses a pipe unless its separator is declared.")+'</details>':"")+
 '<div class="dialog-actions">'+(!inputs.mapping_id?'<button type="button" id="save-mapping">Save mapping as a record</button>':"")+'<button type="submit" class="primary">Prepare complete import</button></div></form>');
 function mappings(){
  const raw=$("#mapping-json")?.value.trim();if(raw)return JSON.parse(raw);
  return (inspected.headers||[]).map(h=>{
   const target=$('[data-map-target="'+h.ordinal+'"]')?.value;if(!target)return null;
   const spec=specs.find(s=>s.name===target),relation=spec?.target||(target==="evidence_ids"||target==="completion_evidence_ids"?"evidence":null);
   return {record_kind:inputs.kind,source_field_or_ordinal:h.ordinal,target_field:target,transform:$('[data-map-transform="'+h.ordinal+'"]').value,null_rule:"preserve",...(relation?{relationship_key:{kind:relation}}:{})};
  }).filter(Boolean);
 }
 if($("#save-mapping"))$("#save-mapping").onclick=()=>{try{recordEditor("source_mapping",null,{label:inspected.source.name+" mapping",record_kind:inputs.kind,source_namespace:inputs.source_namespace,mappings:mappings()});}catch(e){dialogError(e);}};
 bindBusy($("#mapping-form"),async()=>{const r=await action("prepare_import",{...inputs,...(!inputs.mapping_id?{mappings:mappings()}:{})});importReview(r);});
}
function importReview(result){
 const choices=result.choices||[],changed=choices.filter(c=>c.status==="changed");
 dialogOpen("Review complete import",'<form id="import-review-form"><p>'+choices.length+' original record identities: '+choices.filter(c=>c.status==="new").length+' new, '+changed.length+' changed and '+choices.filter(c=>c.status==="same").length+' unchanged.</p>'+
 (result.diagnostic_count?'<section><h3>Normalization results</h3><pre>'+esc(pretty(result.diagnostics))+'</pre><p>'+esc(result.diagnostic_count)+' total findings. <a href="'+esc(endpoint("/api/source/download",{id:result.complete_plan_source_id}))+'">Download the complete retained plan</a></p></section>':"")+
 (changed.length?table(["Changed record","Current revision","Decision"],changed.map(c=>[esc(c.label||c.id),esc(c.expected_revision),'<select required data-import-choice="'+esc(c.id)+'"><option value="">Choose this record</option><option value="keep_local">Keep local revision</option><option value="accept_incoming">Accept incoming as next revision</option></select>'])):'<p>New records retain original IDs; identical records are reused.</p>')+
 '<div class="dialog-actions"><button type="submit" class="primary" '+(!result.valid?"disabled":"")+'>Adopt complete reviewed import</button></div></form>');
 bindBusy($("#import-review-form"),async()=>{
  const decisions=Object.fromEntries(changed.map(c=>[c.id,{choice:$('[data-import-choice="'+c.id+'"]').value,expected_revision:c.expected_revision,expected_sha256:c.expected_sha256}]));
  await action("adopt_import",{preview_id:result.preview.id,decisions});dialog.close();await refreshState();await openRoute("engagement");
 });
}
async function questionnairePage(){
 const catalog=await api("/api/catalog");
 const selected=routeOptions.group||catalog.groups[0]?.id;
 const questions=catalog.questions.filter(q=>q.group_id===selected);
 page.innerHTML=pageHead("Original issuer questionnaire","Work through the exact issued question IDs, wording and page references. Responses remain separate from published requirements.",
 '<button class="primary" id="export-questionnaire">Export complete responses</button>')+
 '<section class="card"><div class="source-row"><h2>'+esc(catalog.answered)+' of '+esc(catalog.questions.length)+' answered</h2><span class="code">'+esc(catalog.catalog_sha256)+'</span></div>'+
 '<div class="progress" role="progressbar" aria-valuenow="'+catalog.answered+'" aria-valuemin="0" aria-valuemax="'+catalog.questions.length+'"><span id="question-progress"></span></div>'+
 '<div class="tabs" aria-label="Original question groups">'+catalog.groups.map(g=>'<button data-question-group="'+esc(g.id)+'" aria-pressed="'+(g.id===selected)+'">'+esc(g.id)+' '+esc(g.title||g.name||"(untitled in original)")+'</button>').join("")+'</div>'+
 questions.map(q=>{const r=catalog.responses[q.id];return '<section class="question"><div class="question-controls"><h3>'+esc(q.id)+' · source page '+esc((q.source_pages||[]).join(", "))+'</h3>'+pill(r?.payload.status||"Unanswered")+'</div><p>'+esc(q.text)+'</p>'+(r?.payload.response?'<p>'+esc(r.payload.response)+'</p>':"")+'<button data-question="'+esc(q.id)+'">'+(r?"Edit response":"Write response")+'</button></section>';}).join("")+'</section>'+
 '<p class="help">Catalog source: original event 1442341, RFP-0012413-TECH-2026. Blank group headings remain blank in the original catalog.</p>';
 $("#question-progress").style.width=(catalog.answered/catalog.questions.length*100)+"%";
 $$("[data-question-group]").forEach(b=>b.onclick=()=>openRoute("questionnaire",{group:b.dataset.questionGroup}));
 $$("[data-question]").forEach(b=>b.onclick=()=>recordEditor("questionnaire_response",catalog.responses[b.dataset.question]||null,{question_id:b.dataset.question,catalog_sha256:catalog.catalog_sha256,status:"Draft",owner_reference:state.actor.label,evidence_ids:[]}));
 $("#export-questionnaire").onclick=async()=>{try{const r=await action("export_questionnaire",{});dialogOpen("Complete issuer responses",'<p>'+r.answered+' of '+r.questions+' questions have a recorded response. The export includes every issued question.</p><p>'+artifactLink(r.artifact)+'</p>');}catch(e){notice(e.message,true);}};
}
const roleOptions=["auditor","unit_leadership","executive","board_regents","faic","it_leadership","medicine_it_leadership","advisory"];
async function reportsPage(){
 const [engagements,plans]=await Promise.all([allRecords("engagement"),api("/api/plans",{kind:"report_preview"})]);
 page.innerHTML=pageHead("Reports & handoffs","Select the reporting audience, review the frozen output and release its retained records and files.")+
 '<section class="card"><form id="report-form"><div class="grid">'+
 (state.can_edit?namedField("Audience","report-role",'<select id="report-role" name="role">'+roleOptions.map(r=>'<option value="'+r+'">'+esc(title(r))+'</option>').join("")+'</select>'):'<div><h2>'+esc(title(state.actor.role))+'</h2><p>Your current access scope applies to this release.</p></div>')+
 namedField("Review / release note","report-note",'<input id="report-note" name="note" required placeholder="Purpose and reporting period">')+
 (state.can_edit?namedField("Authorized unit IDs","report-units",'<textarea id="report-units" name="units"></textarea>',"One unit ID per line. Required for unit and IT audiences.")+
 namedField("Advisory recipient unit IDs","report-recipients",'<textarea id="report-recipients" name="recipients"></textarea>')+
 namedField("Selected advisory memo IDs","report-memos",'<textarea id="report-memos" name="memos"></textarea>'):"")+
 '</div><fieldset><legend>Engagements in this reporting release</legend>'+engagements.map(e=>'<label class="check"><input type="checkbox" name="engagements" value="'+esc(e.record.id)+'">'+esc(e.label)+' · '+esc((e.record.payload.unit_ids||[]).join(", "))+'</label>').join("")+
 '</fieldset><p class="help">Senior-report text uses approved report summaries and control results. Detailed observations, action plans and private evidence follow the selected audience.</p><button type="submit" class="primary">Prepare report preview</button></form></section>'+
 '<section class="card"><h2>Retained reporting releases</h2>'+
 (plans.items.length?table(["Prepared","Audience","Review note","Actions"],plans.items.map(p=>[esc(p.created_at),esc(title(p.plan.audience.role)),esc(p.plan.review_reference.note),
 '<button data-report="'+esc(p.id)+'">Open reviewed release</button>'])):empty("Prepare a report to retain its current record selection."))+'</section>';
 bindBusy($("#report-form"),async fd=>{
  const audience=state.can_edit?{role:fd.get("role"),unit_ids:list(fd.get("units")),recipient_unit_ids:list(fd.get("recipients")),selected_record_ids:list(fd.get("memos"))}:undefined;
  const r=await action("prepare_report",{selected_engagement_ids:fd.getAll("engagements"),review_note:fd.get("note"),...(audience?{audience}:{})});
  reportPreview(r.preview_id,r);
 });
 $$("[data-report]").forEach(b=>b.onclick=()=>{const p=plans.items.find(p=>p.id===b.dataset.report);reportPreview(p.id,p.plan);});
}
function reportPreview(id,plan){
 const reports=plan.reports||[],htmlReport=reports.find(r=>r.name.endsWith(".html"));
 dialogOpen("Reviewed reporting release",'<p>'+esc(title(plan.audience.role))+' · '+esc(plan.review_reference?.note||"")+'</p>'+
 '<div class="actions">'+reports.map(r=>artifactLink(r.artifact,r.name)).join(" ")+'</div>'+
 (htmlReport?'<iframe class="frame" title="Reviewed audit report" sandbox src="'+esc(download(htmlReport.artifact.id,true))+'"></iframe>':"")+
 '<div class="dialog-actions">'+(state.can_edit?'<button id="native-start">Export declared target format</button>':"")+'<button id="handoff-build" class="primary">Build reviewed handoff ZIP</button></div><div id="report-result"></div>');
 $("#handoff-build").onclick=async()=>{const b=$("#handoff-build");b.disabled=true;try{const r=await action("build_handoff",{preview_id:id});$("#report-result").innerHTML='<div class="card"><h3>Handoff retained</h3><p>'+artifactLink(r.artifact)+'</p><details><summary>Release manifest</summary><pre>'+esc(pretty(r.manifest))+'</pre></details></div>';}catch(e){dialogError(e);}finally{if(b.isConnected)b.disabled=false;}};
 if($("#native-start"))$("#native-start").onclick=()=>nativeExportDialog(id);
}
async function nativeExportDialog(previewId){
 const sources=(await api("/api/sources")).sources.filter(s=>s.media_type.includes("json")||s.name.endsWith(".json"));
 dialogOpen("Declared target export",'<form id="native-form"><p>Use the actual selected target’s import contract. The contract explicitly declares every file, field position, type, delimiter and encoding.</p>'+
 namedField("Original target-contract JSON","native-contract-file",'<input id="native-contract-file" name="file" type="file" accept=".json">')+
 namedField("Or a retained contract","native-contract",'<select id="native-contract" name="source_id"><option value="">Choose declared contract</option>'+sources.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join("")+'</select>')+
 '<div class="dialog-actions"><button type="submit" class="primary">Export all declared tables</button></div></form>');
 bindBusy($("#native-form"),async fd=>{
  let id=fd.get("source_id");if(fd.get("file")?.size)id=(await fileInput(fd.get("file"),"target_contract")).id;
  if(!id)throw new Error("Choose the exact declared target contract.");
  const r=await action("prepare_native",{preview_id:previewId,target_contract_source_id:id});
  dialogOpen("Declared native tables retained",'<p>'+artifactLink(r.artifact)+'</p><p>Native export ID <span class="code">'+esc(r.native_id)+'</span></p><details><summary>Complete native manifest</summary><pre>'+esc(pretty(r.manifest))+'</pre></details><button id="native-compare">Compare the complete returned files</button>');
  $("#native-compare").onclick=()=>nativeCompareDialog(r.native_id);
 });
}
function nativeCompareDialog(nativeId){
 dialogOpen("Compare complete target return",'<form id="native-compare-form"><p>Every selected identity and declared field is compared. Each returned file remains an original retained source.</p>'+
 namedField("Complete returned ZIP or one-table CSV","return-file",'<input id="return-file" name="file" type="file" required accept=".zip,.csv">')+
 namedField("Source namespace fallback","return-namespace",'<input id="return-namespace" name="namespace" placeholder="Leave blank when the release has one namespace">',"Per-row declared namespaces take precedence.")+
 '<div class="dialog-actions"><button type="submit" class="primary">Compare complete return</button></div></form>');
 bindBusy($("#native-compare-form"),async fd=>{const source=await fileInput(fd.get("file"),"native_return");const r=await action("compare_native",{native_id:nativeId,return_source_id:source.id,source_namespace:fd.get("namespace")||null});comparisonDetail(r.comparison,r.artifact,nativeId);});
}
function comparisonDetail(c,artifact,nativeId){
 dialogOpen("Native return comparison",'<h3>'+esc(title(c.status))+'</h3><p>'+esc(c.matched)+' matched · '+esc(c.missing?.length||0)+' missing · '+esc(c.added?.length||0)+' added · '+esc(c.changed?.length||0)+' changed.</p>'+
 (artifact?'<p>'+artifactLink(artifact,"Download complete comparison")+'</p>':"")+
 (c.changed?.length?table(["Record","Declared field","Expected","Returned"],c.changed.flatMap(x=>x.differences.map(d=>[esc(x.id),esc(d.field),esc(pretty(d.expected)),esc(pretty(d.returned))]))):"")+
 '<details><summary>Complete comparison and original return hashes</summary><pre>'+esc(pretty(c))+'</pre></details>'+
 (nativeId?'<button id="compare-correction">Compare a corrected return</button>':""));
 if($("#compare-correction"))$("#compare-correction").onclick=()=>nativeCompareDialog(nativeId);
}

async function receivingPage(){
 const [receipts,natives,comparisons]=await Promise.all([api("/api/plans",{kind:"receiving_preview"}),api("/api/plans",{kind:"native_preview"}),api("/api/plans",{kind:"native_comparison"})]);
 page.innerHTML=pageHead("Receiving & reconciliation","Bring a reviewed audit release into this workspace, resolve competing edits and reconcile complete native returns.",
 '<button class="primary" id="receive-start">Receive an audit handoff</button>')+
 '<section class="card"><h2>Retained receiving operations</h2>'+
 (receipts.items.length?table(["Prepared","Original bundle","Status","Action"],receipts.items.map(r=>[esc(r.created_at),'<span class="code">'+esc(r.plan.bundle_sha256)+'</span>',pill(r.plan.plan.status),
 '<button data-receive="'+esc(r.id)+'">Open receiving plan</button>'])):empty("Receive a handoff ZIP to inspect its complete file and record manifest."))+'</section>'+
 '<section class="card"><h2>Declared native exports</h2>'+
 (natives.items.length?table(["Prepared","Target contract","Action"],natives.items.map(n=>[esc(n.created_at),esc(pretty(n.plan.contract.native_contract_reference)),'<button data-native-compare="'+esc(n.id)+'">Compare returned files</button>'])):empty("Create a declared target export from a reviewed report."))+'</section>'+
 '<section class="card"><h2>Complete return comparisons</h2>'+
 (comparisons.items.length?table(["Compared","Status","Matched","Changes","Action"],comparisons.items.map(c=>[esc(c.created_at),pill(c.plan.status),esc(c.plan.matched),esc((c.plan.changed||[]).length+(c.plan.added||[]).length+(c.plan.missing||[]).length),
 '<button data-comparison="'+esc(c.id)+'">Open comparison</button>'])):empty("Each returned original is compared against its retained declared export."))+'</section>';
 $("#receive-start").onclick=()=>receiveDialog();
 $$("[data-receive]").forEach(b=>b.onclick=()=>{const p=receipts.items.find(v=>v.id===b.dataset.receive);receiptReview(p.id,p.plan.plan);});
 $$("[data-native-compare]").forEach(b=>b.onclick=()=>nativeCompareDialog(b.dataset.nativeCompare));
 $$("[data-comparison]").forEach(b=>b.onclick=()=>{const c=comparisons.items.find(v=>v.id===b.dataset.comparison);comparisonDetail(c.plan,null,c.plan.native_id);});
}
function receiveDialog(){
 dialogOpen("Receive reviewed audit handoff",'<form id="receive-form">'+namedField("Complete original handoff ZIP","receive-file",'<input id="receive-file" name="file" type="file" accept=".zip" required>')+
 '<p>All manifest files and original bytes are inspected before receiving choices are prepared. A repeated bundle reuses its original receipt.</p><div class="dialog-actions"><button type="submit" class="primary">Inspect and prepare receiving</button></div></form>');
 bindBusy($("#receive-form"),async fd=>{const source=await fileInput(fd.get("file"),"received_bundle");const r=await action("prepare_receipt",{source_id:source.id});receiptReview(r.preview_id,r.plan);});
}
function receiptReview(id,plan){
 const unique=[];const seen=new Set();
 for(const c of plan.conflicted||[]){const key=c.kind+"/"+c.id;if(!seen.has(key)){seen.add(key);unique.push(c);}}
 dialogOpen("Review receiving plan",'<form id="receipt-form"><h3>'+esc(title(plan.status))+'</h3><p>'+
 esc(plan.planned_imports?.length||0)+' planned record changes · '+esc(plan.reused?.length||0)+' reused records · '+esc(plan.source_imports?.length||0)+' incoming original files.</p>'+
 '<p class="code">Original bundle '+esc(plan.bundle_sha256)+'</p>'+
 (unique.length?table(["Conflict","Current / incoming","Explicit resolution"],unique.map((c,index)=>[
 esc(c.id||c.reason)+'<p class="help">'+esc(c.reason)+'</p>',
 esc(c.current_revision??"—")+" / "+esc(c.incoming_revision??"—"),
 c.id&&c.current_sha256?'<select required data-receive-choice="'+index+'"><option value="">Choose this record</option>'+(c.kind==="source"?'<option value="retain_both">Retain both original source files</option>':'<option value="keep_local">Keep local record</option><option value="accept_incoming">Accept incoming as next local revision</option>')+'</select><label for="receive-reason-'+index+'">Decision reason</label><textarea id="receive-reason-'+index+'" data-receive-reason="'+index+'" required></textarea>':'<p>Resolve the indicated graph or retained-history conflict in the source records, then prepare receiving again.</p>'
 ])):"")+
 '<details><summary>Complete receiving plan</summary><pre>'+esc(pretty(plan))+'</pre></details>'+
 '<div class="dialog-actions"><button type="submit" class="primary">'+(plan.status==="replayed"?"Recover original receipt":"Accept reviewed receiving")+'</button></div></form>');
 bindBusy($("#receipt-form"),async()=>{
  const resolutions=unique.filter(c=>c.id&&c.current_sha256).map(c=>{const i=unique.indexOf(c);return {id:c.id,kind:c.kind,choice:$('[data-receive-choice="'+i+'"]').value,reason:$('[data-receive-reason="'+i+'"]').value,current_sha256:c.current_sha256,incoming_sha256:c.incoming_sha256};});
  const r=await action("adopt_receipt",{preview_id:id,resolutions});
  dialogOpen("Receiving complete",'<h3>'+esc(r.replayed_bundle?"Original accepted bundle recovered":"Accepted")+'</h3><p>'+esc((r.imported||[]).length)+' original record identities adopted in this workspace.</p><pre>'+esc(pretty(r))+'</pre><button id="receiving-open-work">Open retained engagements</button>');
  $("#receiving-open-work").onclick=async()=>{dialog.close();await refreshState();await openRoute("engagement");};await refreshState();
 });
}
async function historyPage(){
 const outputs=await api("/api/artifacts");
 const activity=state.can_edit?await api("/api/operations"):{operations:[],events:[]};
 page.innerHTML=pageHead("Activity & retained outputs","Reopen saved outputs and recover the original result of a completed operation.")+
 '<section class="card"><h2>Saved outputs</h2>'+
 (outputs.artifacts.length?table(["Output","Created","Bytes","Original hash"],outputs.artifacts.map(a=>[artifactLink(a),esc(a.created_at),esc(a.payload.bytes.toLocaleString()),'<span class="code">'+esc(a.payload.sha256)+'</span>'])):empty("Reports, handoffs, comparisons and backups appear here after creation."))+'</section>'+
 (state.can_edit?'<section class="card"><h2>Recent operations</h2>'+table(["Operation","Action","Completed","Result"],activity.operations.map(o=>['<span class="code">'+esc(o.id)+'</span>',esc(title(o.action)),esc(o.completed_at||o.created_at),'<button data-operation="'+esc(o.id)+'">Open original result</button>']))+
 '<p class="help">Showing the most recent 100 operations. Older records remain retained in the workspace database and encrypted backup.</p></section><section class="card"><h2>Recent record activity</h2>'+table(["Sequence","Action","Actor","Detail"],activity.events.map(e=>[esc(e.sequence),esc(e.action||e.type),esc(e.actor),'<span class="code">'+esc(pretty(e.detail))+'</span>']))+'</section>':"");
 $$("[data-operation]").forEach(b=>b.onclick=async()=>{try{const r=await api("/api/operation",{id:b.dataset.operation});dialogOpen("Original operation result",(r.artifact?'<p>'+artifactLink(r.artifact)+'</p>':"")+'<pre>'+esc(pretty(r))+'</pre>');}catch(e){notice(e.message,true);}});
}
async function accessPage(){
 const r=await api("/api/grants");
 page.innerHTML=pageHead("Workspace access","Create scoped access for a receiving team and revoke the same link when its work is complete.",
 '<button class="primary" id="access-create">Create access link</button>')+
 '<section class="card">'+table(["Person / team","Role","Units","Expires","State","Action"],r.grants.map(g=>[
 esc(g.label),esc(title(g.role)),esc((g.unit_ids||[]).join(", ")||"Role scope"),esc(g.expires_at||"Owner key"),pill(g.active?"Active":"Revoked"),
 g.id!=="owner"&&g.active?'<button data-revoke="'+esc(g.id)+'">Revoke this link</button>':""]))+'</section>'+
 '<p class="help">Access links authenticate to this loopback host. The role and units are enforced by the server. A restored workspace renews credentials; old links and sessions do not carry over.</p>';
 $("#access-create").onclick=()=>accessDialog();
 $$("[data-revoke]").forEach(b=>b.onclick=()=>{const g=r.grants.find(g=>g.id===b.dataset.revoke);dialogOpen("Revoke access",'<p>Revoke '+esc(g.label)+' and invalidate its existing sessions?</p><button id="confirm-revoke" class="primary">Revoke this access link</button>');$("#confirm-revoke").onclick=async()=>{try{await action("revoke_grant",{grant_id:g.id});dialog.close();await openRoute("access");}catch(e){dialogError(e);}};});
}
function accessDialog(){
 dialogOpen("Create scoped access",'<form id="access-form"><div class="grid">'+
 namedField("Person or team","grant-label",'<input id="grant-label" name="label" required>')+
 namedField("Role","grant-role",'<select id="grant-role" name="role">'+roleOptions.map(r=>'<option value="'+r+'">'+esc(title(r))+'</option>').join("")+'</select>')+
 namedField("Authorized unit IDs","grant-units",'<textarea id="grant-units" name="units"></textarea>')+
 namedField("Expires in days","grant-days",'<input id="grant-days" name="days" type="number" min="1" max="366" value="30" required>')+
 namedField("Advisory recipient units","grant-recipients",'<textarea id="grant-recipients" name="recipients"></textarea>')+
 namedField("Selected advisory memo IDs","grant-records",'<textarea id="grant-records" name="records"></textarea>')+
 '</div><div class="dialog-actions"><button type="submit" class="primary">Create access link</button></div></form>');
 bindBusy($("#access-form"),async fd=>{
  const r=await action("create_grant",{label:fd.get("label"),role:fd.get("role"),unit_ids:list(fd.get("units")),recipient_unit_ids:list(fd.get("recipients")),selected_record_ids:list(fd.get("records")),expires_days:Number(fd.get("days"))});
  dialogOpen("Scoped access created",'<h3>'+esc(r.grant.label)+'</h3><p>'+esc(title(r.grant.role))+' · '+esc(r.grant.unit_ids.join(", ")||"Role scope")+'</p>'+
  namedField("Private access link","grant-link",'<textarea id="grant-link" readonly>'+esc(r.access_link||"This original link is no longer active.")+'</textarea>')+
  '<p class="help">Share this local access link through the team’s approved private channel. It grants the exact role and units shown above.</p><button id="copy-grant">Copy access link</button>');
  $("#copy-grant").onclick=async()=>{try{await navigator.clipboard.writeText(r.access_link);notice("Access link copied.");}catch{$("#grant-link").select();}};await refreshState();
 });
}
async function recoveryPage(){
 const backups=(await api("/api/artifacts")).artifacts.filter(a=>a.payload.detail?.encrypted);
 page.innerHTML=pageHead("Backup & recovery","Save an encrypted snapshot, restore it into a new private folder and open the retained workspace with renewed access.")+
 '<div class="grid"><section class="card"><h2>Create an encrypted backup</h2><form id="backup-form">'+
 namedField("Backup label","backup-label",'<input id="backup-label" name="label" placeholder="Release or recovery checkpoint">')+
 namedField("Passphrase","backup-pass",'<input id="backup-pass" name="passphrase" type="password" autocomplete="new-password" minlength="12" required>',"At least 12 characters. Keep this outside the backup archive.")+
 namedField("Repeat passphrase","backup-repeat",'<input id="backup-repeat" name="repeat" type="password" autocomplete="new-password" minlength="12" required>')+
 '<button type="submit" class="primary">Create encrypted snapshot</button></form><div id="backup-result"></div></section>'+
 '<section class="card"><h2>Restore a workspace</h2>'+
 (state.actor.admin?'<form id="restore-form">'+namedField("Select a retained backup","restore-artifact",'<select id="restore-artifact" name="artifact_id"><option value="">Choose backup</option>'+backups.map(a=>'<option value="'+esc(a.id)+'">'+esc(a.payload.detail.label||a.payload.name)+' · '+esc(a.created_at)+'</option>').join("")+'</select>')+
 namedField("Or upload the original encrypted backup","restore-file",'<input id="restore-file" name="file" type="file" accept=".cab">')+
 namedField("Backup passphrase","restore-pass",'<input id="restore-pass" name="passphrase" type="password" autocomplete="off" required>')+
 namedField("New workspace folder name","restore-name",'<input id="restore-name" name="destination_name" pattern="[A-Za-z0-9_-]{1,180}" value="audit-restored-'+Date.now()+'" required>')+
 '<p class="help">The new folder is created beside this workspace. Existing folders are never overwritten.</p><button type="submit" class="primary">Restore and open a new workspace</button></form>':'<p>The workspace owner opens restored workspaces.</p>')+
 '<div id="restore-result"></div></section></div><section class="card"><h2>Retained backups</h2>'+
 (backups.length?table(["Encrypted backup","Label","Bytes","Snapshot time"],backups.map(a=>[artifactLink(a),esc(a.payload.detail.label),esc(a.payload.bytes.toLocaleString()),esc(a.payload.detail.manifest.created_at||a.created_at)])):empty("No encrypted backup has been created in this workspace."))+
 '</section><p class="help">Backups contain the consistent database and every retained source object. Previously generated encrypted download files are kept outside the source archive to avoid recursive backups. After restore, those older download listings remain in history; keep the original backup file or create a new one.</p>';
 bindBusy($("#backup-form"),async(fd,form)=>{
  if(fd.get("passphrase")!==fd.get("repeat"))throw new Error("The two passphrases differ.");
  const r=await action("backup",{passphrase:fd.get("passphrase"),label:fd.get("label")});form.reset();
  $("#backup-result").innerHTML='<div class="card"><h3>Encrypted backup retained</h3><p>'+artifactLink(r.artifact)+'</p><p class="code">'+esc(r.artifact.payload.sha256)+'</p><button id="show-new-backup">Refresh backup list</button></div>';
  $("#show-new-backup").onclick=()=>openRoute("recovery");
 });
 if($("#restore-form"))bindBusy($("#restore-form"),async(fd,form)=>{
  const inputs={artifact_id:fd.get("artifact_id")||null,passphrase:fd.get("passphrase"),destination_name:fd.get("destination_name")};
  if(fd.get("file")?.size){const file=fd.get("file");if(file.size>64*1024*1024)throw new Error("Use the documented local restore command for an archive above 64 MiB.");
   const bytes=new Uint8Array(await file.arrayBuffer());let binary="";for(let n=0;n<bytes.length;n+=32768)binary+=String.fromCharCode(...bytes.subarray(n,n+32768));inputs.data_base64=btoa(binary);delete inputs.artifact_id;}
  if(!inputs.artifact_id&&!inputs.data_base64)throw new Error("Choose a retained backup or the original encrypted file.");
  const r=await action("restore",inputs);form.reset();
  $("#restore-result").innerHTML='<div class="card"><h3>Restored workspace ready</h3><p>'+esc(r.records)+' records and '+esc(r.source_count)+' original sources retained.</p><p>'+esc(r.directory)+'</p><a href="'+esc(r.access_link)+'" target="_blank" rel="noreferrer">Open the restored workspace</a><p class="help">This new workspace has renewed access. The original workspace remains open.</p></div>';
 });
}
async function start(){
 const fragment=new URLSearchParams(location.hash.slice(1)),token=fragment.get("access");
 if(token){history.replaceState(null,"",location.pathname+location.search);try{await api("/api/login",{}, {token});}catch(e){$("#login-error").textContent=e.message;}}
 try{
  await refreshState();$("#login").hidden=true;$("#shell").hidden=false;await openRoute();
  const unresolved=pending();if(unresolved.length){
   let recovered=0;for(const p of unresolved){try{await api("/api/operation",{id:p.id});retainPending(pending().filter(x=>x.id!==p.id));recovered++;}catch{}}
   if(recovered)notice(recovered+" original completed operation"+(recovered===1?" was":"s were")+" recovered after reopening.");
   else notice("A previous operation response is unresolved. Its original ID remains retained for a same-input retry.",true);
  }
 }catch(e){$("#shell").hidden=true;$("#login").hidden=false;if(e.status!==401)$("#login-error").textContent=e.message;}
}
$("#close-dialog").onclick=()=>dialog.close();
$("#menu-toggle").onclick=()=>{const open=$("#navigation").classList.toggle("open");$("#menu-toggle").setAttribute("aria-expanded",String(open));};
$("#refresh").onclick=async()=>{try{await refreshState();await openRoute(route,routeOptions);}catch(e){notice(e.message,true);}};
$("#sign-out").onclick=async()=>{try{await api("/api/logout",{},{});}finally{retainPending([]);location.reload();}};
$("#login-form").onsubmit=async e=>{e.preventDefault();const button=$('button[type="submit"]',$("#login-form"));button.disabled=true;try{await api("/api/login",{}, {token:$("#access-key").value});$("#access-key").value="";await start();}catch(err){$("#login-error").textContent=err.message;}finally{button.disabled=false;}};
start();
