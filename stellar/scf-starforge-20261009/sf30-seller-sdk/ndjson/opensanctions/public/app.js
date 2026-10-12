/* MIT. Original-source operator on the retained NDJSON Workspace. */
const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const pretty = value => JSON.stringify(value, null, 2);
const time = value => value ? new Date(value * 1000).toLocaleString() : "—";
const short = value => value ? String(value).slice(0, 12) : "—";
const tokenKey = "starforge-source-monitoring:" + location.origin;
const token = location.hash.slice(1) || sessionStorage.getItem(tokenKey) || "";
if (token) { sessionStorage.setItem(tokenKey, token); history.replaceState(null, "", location.pathname); }
$("#native-link").href = "/#" + encodeURIComponent(token);
let state, contract, busy = false, view = "overview", selectedUpdate, selectedChange, selectedRequest, localPlan;
let entityOffset=0, counterpartyOffset=0, changeOffset=0;
let currentChangeRows=[];
const escape = value => String(value ?? "—").replace(/[&<>"']/g, ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const p = value => "<pre class='scroll-box'>" + escape(pretty(value)) + "</pre>";
const message = (text, error=false) => { const n=$("#notice"); n.textContent=text; n.className=error?"error":"success"; };
const named = (form,name) => form.elements.namedItem(name);
const value = (form,name) => named(form,name).value.trim();
function objectValue(form,name,fallback={}) {
  const source = value(form,name);
  if (!source) return fallback;
  try { const result=JSON.parse(source); if (!result || Array.isArray(result) || typeof result!=="object") throw 0; return result; }
  catch { throw new Error(name + " must be a JSON object"); }
}
async function api(path, body, options={}) {
  const headers = {"Authorization":"Bearer "+token,...options.headers};
  const init={method:body===undefined?"GET":"POST",headers,cache:"no-store"};
  if (body!==undefined) {
    if (body instanceof Blob || body instanceof ArrayBuffer) init.body=body;
    else {init.body=JSON.stringify(body); headers["Content-Type"]="application/json";}
  }
  const response=await fetch(path.startsWith("/")?path:"/api/os/"+path,init);
  if (options.download) {
    if (!response.ok) throw new Error((await response.json()).error || "Download failed");
    return {blob:await response.blob(), response};
  }
  let data;
  try {data=await response.json();} catch {throw new Error("The local application returned an unreadable response ("+response.status+")");}
  if (!response.ok || data?.ok===false && data?.error) throw new Error(data.error || data.message || pretty(data));
  return data;
}
async function run(label, task) {
  if (busy) return;
  busy=true;
  const changed=$$("button,input,select,textarea").filter(el=>!el.disabled);
  changed.forEach(el=>el.disabled=true);
  message(label+"…");
  try {const result=await task(); message(label+" completed."); return result;}
  catch(error) {message(error.message || String(error),true); console.error(error);}
  finally {busy=false;changed.filter(el=>el.isConnected).forEach(el=>el.disabled=false); syncDispatch();}
}
function onForm(id,label,fn) {$("#"+id).addEventListener("submit",event=>{event.preventDefault(); const form=event.currentTarget;run(label,()=>fn(form));});}
function table(id,headers,rows,empty="No retained records yet.") {
  $("#"+id).innerHTML=rows.length ? "<table><thead><tr>"+headers.map(h=>"<th>"+escape(h)+"</th>").join("")+"</tr></thead><tbody>"+
    rows.map(row=>"<tr>"+row.map(cell=>"<td>"+cell+"</td>").join("")+"</tr>").join("")+"</tbody></table>" : "<p class='muted'>"+escape(empty)+"</p>";
}
function button(label,action,id,extra="") {
  return '<button type="button" data-action="'+escape(action)+'" data-id="'+escape(id)+'" '+extra+'>'+escape(label)+"</button>";
}
function kv(obj) {return "<dl>"+Object.entries(obj).map(([k,v])=>"<div><dt>"+escape(k)+"</dt><dd>"+escape(typeof v==="object"?pretty(v):v)+"</dd></div>").join("")+"</dl>";}
function optionFill(el, rows, label, preferred) {
  const old=el.value;
  const choices=rows.map(row=>({id:row.id,label:label(row)}));
  el.replaceChildren(...choices.map(row=>new Option(row.label,row.id)));
  if (choices.some(r=>r.id===old)) el.value=old;
  else if (preferred && choices.some(r=>r.id===preferred)) el.value=preferred;
}
function edition(id) {return state.editions.find(item=>item.id===id);}
function comparison(id) {return state.comparisons.find(item=>item.id===id);}
function editionLabel(row) {return row.dataset+" · "+row.version;}
function comparisonLabel(row) {return row.dataset+" · "+(edition(row.before)?.version||short(row.before))+" → "+(edition(row.after)?.version||short(row.after));}
function navigate(name) {
  view=name;
  $$("nav [data-view]").forEach(el=>el.classList.toggle("selected",el.dataset.view===name));
  $$("main>section").forEach(el=>el.hidden=el.id!=="view-"+name);
}
$$("[data-view]").forEach(el=>el.addEventListener("click",()=>navigate(el.dataset.view)));
function renderState() {
  $("#connection").textContent="Local workspace open";
  $("#metrics").innerHTML=[
    ["Source editions",state.editions.length],["Source records",state.editions.reduce((n,e)=>n+e.statistics.records,0)],
    ["Update operations",state.updates.length],["Customer cases",state.cases.length],
    ["Native requests",state.requests.length],["Portfolios",state.portfolios.length]
  ].map(([label,count])=>"<div><strong>"+count.toLocaleString()+"</strong><span>"+escape(label)+"</span></div>").join("");
  $("#recent-work").innerHTML=state.editions.length ? "<ul>"+state.editions.slice(0,4).map(e=>"<li><strong>"+escape(e.dataset)+"</strong> · "+escape(e.version)+" · "+e.statistics.records.toLocaleString()+" original records</li>").join("")+"</ul>" : "<p>Receive the first source edition to begin.</p>";
  $$("select[data-editions]").forEach(el=>optionFill(el,state.editions,editionLabel));
  if (state.editions.length>1 && $("#before-edition").value===$("#after-edition").value) $("#before-edition").value=state.editions[state.editions.length-1].id;
  $$("select[data-portfolios]").forEach(el=>optionFill(el,state.portfolios,row=>row.label+" · "+row.statistics.records+" records"));
  optionFill($("#review-comparison"),state.comparisons,comparisonLabel);
  optionFill($("#profile-selection"),state.profiles,row=>row.label+" · "+row.dataset);
  const kinds=new Set(state.comparisons.flatMap(c=>Object.keys(c.counts)));
  const oldKind=$("#change-kind").value;
  $("#change-kind").replaceChildren(new Option("Property and identifier changes","__material__"),new Option("All original changes",""),
    ...[...kinds].sort().map(kind=>new Option(kind.replaceAll("_"," "),kind)));
  if (oldKind==="__material__" || oldKind==="" || kinds.has(oldKind)) $("#change-kind").value=oldKind;
  if (!named($("#case-form"),"monitoring").value) named($("#case-form"),"monitoring").value=pretty(contract.monitoring);
  table("edition-table",["Edition","Original population","Source metadata","Open"],state.editions.map(e=>[
    "<strong>"+escape(e.dataset)+"</strong><br>"+escape(e.version),e.statistics.records.toLocaleString()+" records<br>"+escape(e.statistics.schemas?pretty(e.statistics.schemas):""),
    "Published SHA-1 "+escape(e.resource.checksum?.value||e.resource.checksum)+"<br>Received "+escape(time(e.receivedAt)),
    button("Inspect","edition",e.id)+" "+button("Original FtM","source",e.source)]));
  table("statement-table",["Statement population","Edition","Original lineage","Open"],state.statement_sets.map(s=>[
    escape(s.name||s.id)+"<br>"+s.records.toLocaleString()+" records",escape(edition(s.edition)?.version),escape(s.complete?"Complete declared scope":"Selected source rows")+"<br>"+escape(pretty(s.scope)),
    button("Original CSV","object",s.original)]));
  table("update-table",["Editions","Native operations","Status","Open"],state.updates.map(u=>[
    escape(edition(u.plan.before)?.version)+" → "+escape(edition(u.plan.after)?.version),
    escape(Object.entries(u.operationCounts||{}).map(([k,v])=>k+" "+v).join(" · ")||"No nonempty change file"),
    escape(u.state)+"<br>"+escape(u.selection?u.selection.reviewer:"Awaiting selection"),button("Inspect update","update",u.id)]));
  table("portfolio-table",["Portfolio","Population","Received","Open"],state.portfolios.map(item=>[
    "<strong>"+escape(item.label)+"</strong><br>"+escape(item.key),item.statistics.records.toLocaleString(),escape(time(item.receivedAt)),
    button("Inspect","portfolio",item.id)+" "+button("Original FtM","source",item.source)]));
  table("case-table",["Counterparty","Current source identity","Decisions","Open"],state.cases.map(c=>[
    escape(c.portfolioKey)+"<br>"+escape(c.counterpartyId),escape(c.candidateId)+"<br>"+escape(c.resolvedCurrentIds.join(", ")||"Absent from selected edition"),
    "Identity: "+escape(c.resolution)+"<br>Relevance: "+escape(c.relevance),button("Review case","case",c.id)]));
  table("request-table",["Native operation","Original profile","State","Open"],state.requests.map(r=>[
    escape(r.kind)+" · "+escape(r.method)+"<br>"+escape(short(r.id)),escape(state.profiles.find(p=>p.id===r.profile)?.label||short(r.profile)),
    escape(r.state)+"<br>"+escape(time(r.createdAt)),button("Inspect request","request",r.id)]));
  $("#contract-summary").innerHTML=kv({"Native source engine":"Retained SF30 NDJSON Workspace","Delta content":contract.publisherDelta.fields.join(", "),"Original publisher source":contract.publisherDelta.path,"Source revision":contract.publisherDelta.commit});
}
async function refresh() {
  state=await api("state");
  if (!contract) contract=await api("contract");
  renderState();
  await Promise.all([loadEntities(),loadCounterparties(),loadChanges()]);
  if (selectedUpdate) inspectUpdate(selectedUpdate.id);
  if (selectedRequest) await inspectRequest(selectedRequest.id);
}
$("#refresh").addEventListener("click",()=>run("Refresh workspace",refresh));
function pager(id,result,go) {
  const root=$("#"+id);root.replaceChildren();
  if (!result.total) return;
  const label=document.createElement("span");label.textContent=(result.offset+1)+"–"+Math.min(result.offset+result.rows.length,result.total)+" of "+result.total.toLocaleString();root.append(label);
  for (const [title,offset,disabled] of [["Previous",Math.max(0,result.offset-25),result.offset===0],["Next",result.nextOffset,result.nextOffset===null]]) {
    const el=document.createElement("button");el.type="button";el.textContent=title;el.disabled=disabled;
    el.addEventListener("click",()=>run("Read original records",()=>go(offset)));root.append(el);
  }
}
async function loadEntities() {
  const id=$("#source-edition").value;if (!id) return;
  const e=edition(id);
  $("#source-detail").innerHTML=kv({"Dataset":e.dataset,"Version":e.version,"Original source":e.source,"Native build":e.build,"Population":e.statistics.records,"Published last change":e.lastChange,"Published last export":e.lastExport,"Selected use":e.entitlement.note});
  const result=await api("entities?"+new URLSearchParams({scope:id,offset:entityOffset,limit:25}));
  table("entity-table",["Entity","Schema","Original row","Open"],result.rows.map(r=>[
    escape(r.caption)+"<br><code>"+escape(r.id)+"</code>",escape(r.schema),"Record "+r.record+" · physical line "+r.line,button("Inspect","entity",r.id)]));
  pager("entity-pager",result,async offset=>{entityOffset=offset;await loadEntities();});
}
async function loadCounterparties() {
  const id=$("#portfolio-selection").value;if (!id) return;
  const result=await api("entities?"+new URLSearchParams({scope:id,offset:counterpartyOffset,limit:25}));
  table("counterparty-table",["Counterparty","Schema","Original row","Open"],result.rows.map(r=>[
    escape(r.caption)+"<br><code>"+escape(r.id)+"</code>",escape(r.schema),"Record "+r.record+" · physical line "+r.line,button("Inspect","counterparty",r.id)]));
  pager("counterparty-pager",result,async offset=>{counterpartyOffset=offset;await loadCounterparties();});
}
async function loadChanges() {
  const id=$("#review-comparison").value;if (!id) {table("change-table",[],[]);return;}
  const c=comparison(id),kind=$("#change-kind").value;
  $("#comparison-summary").innerHTML=kv({"Comparison":comparisonLabel(c),"Original findings":c.findingCount,"Source change types":c.counts,"Native comparison":c.nativeCounts});
  const params={comparison:id,offset:changeOffset,limit:25};
  if (kind==="__material__") params.material="true"; else if (kind) params.kind=kind;
  const result=await api("changes?"+new URLSearchParams(params));currentChangeRows=result.rows;
  table("change-table",["Source entity","Change","Current identity","Review"],result.rows.map(r=>[
    escape(r.caption)+"<br><code>"+escape(r.entityId)+"</code>",escape(r.kind.replaceAll("_"," "))+"<br>"+escape(r.schema),
    escape(r.resolvedCurrentIds?.join(", ")||"Absent in selected edition"),button(r.reviews.length?"Open · "+r.reviews.length+" reviews":"Review","change",r.id)]));
  pager("change-pager",result,async offset=>{changeOffset=offset;await loadChanges();});
  const impacts=await api("impacts?"+new URLSearchParams({comparison:id}));
  table("impact-table",["Original case","Current identifier","Review route","Open"],impacts.rows.map(row=>[
    escape(row.case.counterpartyId)+"<br>"+escape(row.case.candidateId),escape(row.currentIds.join(", ")||"Absent in selected edition"),
    escape(row.reviewRequired?row.reasons.join("; "):"Prior decisions retained"),button("Review case","case",row.case.id)]),"No existing customer cases are affected by this comparison.");
}
$("#source-edition").addEventListener("change",()=>run("Read source",async()=>{entityOffset=0;await loadEntities();}));
$("#portfolio-selection").addEventListener("change",()=>run("Read counterparties",async()=>{counterpartyOffset=0;await loadCounterparties();}));
for (const id of ["review-comparison","change-kind"]) $("#"+id).addEventListener("change",()=>run("Read changes",async()=>{changeOffset=0;await loadChanges();}));
async function upload(file,sourceUrl="") {
  if (!file) throw new Error("Choose the original source file");
  const headers={"Content-Type":file.type||"application/octet-stream","X-Original-Name":encodeURIComponent(file.name)};
  if (sourceUrl) headers["X-Original-URL"]=encodeURIComponent(sourceUrl);
  if (file.name.endsWith(".gz")) headers["X-Original-Compression"]="gzip";
  return api("object",file,{headers});
}
async function download(path,fallback) {
  const {blob,response}=await api(path,undefined,{download:true});
  const disposition=response.headers.get("content-disposition")||"";
  const name=disposition.match(/filename="([^"]+)"/)?.[1] || fallback;
  const href=URL.createObjectURL(blob),a=document.createElement("a");a.href=href;a.download=name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(href),10000);return {name,bytes:blob.size};
}
onForm("published-form","Receive original published edition",async form=>{
  const result=await api("published-edition",{metadataUrl:value(form,"metadataUrl"),entitlement:{kind:value(form,"entitlement"),note:value(form,"note")}});
  await refresh();$("#source-edition").value=result.edition.id;await loadEntities();
});
onForm("local-edition-form","Receive original source files",async form=>{
  const meta=await upload(named(form,"metadata").files[0],value(form,"metadataUrl"));
  const entities=await upload(named(form,"entities").files[0]);
  const result=await api("edition",{metadata:meta.id,entities:entities.id,metadataUrl:value(form,"metadataUrl"),label:value(form,"label")||null});
  await refresh();$("#source-edition").value=result.id;await loadEntities();
});
onForm("query-form","Query original dataset",async form=>{
  const selected=edition($("#source-edition").value);if (!selected) throw new Error("Choose the original edition");
  const result=await api("/api/query",{build:selected.build,query:objectValue(form,"query")});
  $("#query-summary").textContent="Native build "+short(selected.build)+" · original engine response "+result.response?.status;
  $("#query-result").textContent=pretty(result);
});
onForm("statement-form","Receive native statements",async form=>{
  const original=await upload(named(form,"original").files[0],value(form,"sourceUrl"));
  await api("statement-set",{edition:value(form,"edition"),original:original.id,sourceUrl:value(form,"sourceUrl"),
    name:original.name,complete:named(form,"complete").checked,scope:objectValue(form,"scope")});
  await refresh();
});
const selectedEditions=()=>({before:$("#before-edition").value,after:$("#after-edition").value});
$("#compare-editions").addEventListener("click",()=>run("Compare original editions",async()=>{
  const result=await api("compare",selectedEditions());await refresh();$("#review-comparison").value=result.id;changeOffset=0;await loadChanges();navigate("review");
}));
$("#fetch-update").addEventListener("click",()=>run("Receive published delta chain",async()=>{
  const result=await api("fetch-update",selectedEditions());await refresh();inspectUpdate((result.update||result).id);
}));
onForm("delta-index-form","Read original delta index",async form=>{
  const original=await upload(named(form,"index").files[0]);
  localPlan=await api("update-plan?"+new URLSearchParams({...selectedEditions(),index:original.id}));
  const root=$("#delta-file-inputs");root.replaceChildren();
  if (localPlan.requiresFullReload) {const note=document.createElement("p");note.textContent="The selected base predates the retained changing editions. The complete verified target source is retained for full receiving.";root.append(note);}
  for (const item of localPlan.required) {
    const label=document.createElement("label");label.textContent=item.version+" · "+item.url;
    const input=document.createElement("input");input.type="file";input.accept=".json,.jsonl,.ndjson,.gz";input.dataset.version=item.version;label.append(input);root.append(label);
  }
  $("#stage-local-update").hidden=false;
});
$("#stage-local-update").addEventListener("click",()=>run("Apply complete original delta chain",async()=>{
  if (!localPlan) throw new Error("Receive the original delta index first");
  const deltas=[];
  for (const input of $$("#delta-file-inputs input")) {
    const selected=localPlan.required.find(r=>r.version===input.dataset.version);
    const obj=await upload(input.files[0],selected.url);deltas.push({version:selected.version,object:obj.id});
  }
  const result=await api("update",{before:localPlan.before,after:localPlan.after,index:localPlan.index,deltas});
  await refresh();inspectUpdate(result.id);
}));
function inspectUpdate(id) {
  selectedUpdate=state.updates.find(u=>u.id===id);if (!selectedUpdate) return;
  const u=selectedUpdate;$("#update-inspection").hidden=false;
  $("#update-detail").innerHTML=kv({"Status":u.state,"Native original operations":u.operationCounts,
    "Required changing editions":u.plan?.required?.map(v=>v.version)||u.lineage?.map(v=>v.version),
    "Original content equivalence":u.reconciliation?.publisherContentEquivalent,"Incremental population":u.reconciliation?.incrementalRecords,
    "Published population":u.reconciliation?.publishedRecords,"Full-record metadata differences":u.reconciliation?.differentFields,
    "Selected published version":u.selection?.version||"Awaiting reviewer"})+
    (u.operationLog?button("Original delta operation log","object",u.operationLog):"")+
    (u.reconciliation?.differences?" "+button("Full source differences","object",u.reconciliation.differences):"")+
    "<details><summary>Complete original operation</summary>"+p(u)+"</details>";
}
onForm("select-update-form","Select verified original edition",async form=>{
  if (!selectedUpdate) throw new Error("Choose the retained update");
  await api("select-update",{id:selectedUpdate.id,reviewer:value(form,"reviewer"),reason:value(form,"reason"),expected:selectedUpdate.selection?.revision||null});
  await refresh();
});
async function inspectChange(id) {
  selectedChange=currentChangeRows.find(row=>row.id===id);
  if (!selectedChange) throw new Error("Refresh the selected comparison to read this original change");
  const c=selectedChange;$("#review-inspection").hidden=false;$("#change-title").textContent=c.caption+" · "+c.kind.replaceAll("_"," ");
  const comp=comparison(c.comparison),originals=[];
  if (c.before && c.kind!=="SOURCE_ASSERTION_REMOVED") originals.push(["Earlier original",await api("entity?"+new URLSearchParams({scope:comp.before,id:c.entityId}))]);
  if (c.after) originals.push(["Later original",await api("entity?"+new URLSearchParams({scope:comp.after,id:c.entityId}))]);
  for (const current of c.resolvedCurrentIds||[]) if (current!==c.entityId) originals.push(["Resolved current identifier",await api("entity?"+new URLSearchParams({scope:comp.after,id:current}))]);
  $("#change-detail").innerHTML=kv({"Entity":c.entityId,"Type":c.kind,"Original property changes":c.properties||c.assertion,"Metadata fields":c.metadataFields,"Membership changes":c.referenceChanges,"Semantic metadata changes":c.semanticMetadataFields,
    "Current identifiers":c.resolvedCurrentIds,"Authority conclusion":c.authorityConclusion||"Awaiting an explicit source-backed review"})+
    originals.map(([label,entity])=>"<details><summary>"+escape(label)+" · physical line "+entity.line+"</summary>"+p(entity)+"</details>").join("");
  $("#change-history").innerHTML="<h3>Original review history</h3>"+(c.reviews.length?c.reviews.map(r=>"<article>"+kv({Decision:r.decision,Reviewer:r.reviewer,Reason:r.reason,At:time(r.at),"Authority source":r.authorityUrl})+"</article>").join(""):"<p>No review recorded.</p>");
}
onForm("change-review-form","Save source review",async form=>{
  if (!selectedChange) throw new Error("Select the original change");
  const id=selectedChange.id;
  await api("review",{change:id,decision:value(form,"decision"),reviewer:value(form,"reviewer"),reason:value(form,"reason"),authorityUrl:value(form,"authorityUrl")||null,
    expected:selectedChange.reviews.at(-1)?.id||null});
  await refresh();await inspectChange(id);
});
function resetCase() {
  const f=$("#case-form");f.reset();for(const key of ["case_id","expected","match_request"]) named(f,key).value="";
  named(f,"monitoring").value=pretty(contract.monitoring);$("#case-history").textContent="";
}
$("#new-case").addEventListener("click",resetCase);
async function inspectCase(id) {
  const result=await api("case?"+new URLSearchParams({id})),c=result.case,form=$("#case-form");
  const fields={case_id:c.id,expected:c.revision,match_request:c.matchRequest||"",portfolio_id:c.portfolio,counterparty_id:c.counterpartyId,edition_id:c.edition,
    candidate_id:c.candidateId,resolution:c.resolution,relevance:c.relevance,reviewer:c.reviewer,reason:c.reason,monitoring:pretty(c.monitoring||contract.monitoring)};
  for (const [key,v] of Object.entries(fields)) named(form,key).value=v;
  $("#case-history").innerHTML="<h3>Complete original case history</h3>"+result.history.map(event=>"<details><summary>"+escape(time(event.value.updatedAt))+" · "+escape(event.value.resolution)+" / "+escape(event.value.relevance)+"</summary>"+p(event.value)+"</details>").join("");
  navigate("review");
}
onForm("case-form","Save customer case decision",async form=>{
  const body={portfolio_id:value(form,"portfolio_id"),counterparty_id:value(form,"counterparty_id"),candidate_id:value(form,"candidate_id"),
    edition_id:value(form,"edition_id"),resolution:value(form,"resolution"),relevance:value(form,"relevance"),reason:value(form,"reason"),reviewer:value(form,"reviewer"),
    monitoring:objectValue(form,"monitoring",contract.monitoring),match_request:value(form,"match_request")||null,case_id:value(form,"case_id")||null,expected:value(form,"expected")||null};
  const result=await api("case",body);await refresh();await inspectCase(result.id);
});
onForm("portfolio-form","Receive original counterparties",async form=>{
  const original=await upload(named(form,"original").files[0]);
  const result=await api("portfolio",{original:original.id,key:value(form,"key"),label:value(form,"label")});
  await refresh();$("#portfolio-selection").value=result.id;counterpartyOffset=0;await loadCounterparties();
});
onForm("profile-form","Save native service profile",async form=>{
  const kind=value(form,"authKind");
  const result=await api("profile",{label:value(form,"label"),endpoint:value(form,"endpoint"),dataset:value(form,"dataset"),
    auth:kind==="none"?{kind}:{kind,env:value(form,"authEnv")},parameters:objectValue(form,"parameters"),config:objectValue(form,"config"),
    weights:objectValue(form,"weights"),sourceNote:value(form,"sourceNote")});
  await refresh();$("#profile-selection").value=result.id;
});
onForm("prepare-form","Prepare native request",async form=>{
  const kind=value(form,"kind"),body={profile:value(form,"profile"),kind};
  if (value(form,"edition")) body.edition=value(form,"edition");
  if (value(form,"refresh_key")) body.refresh_key=value(form,"refresh_key");
  if (kind==="match") {body.portfolio=value(form,"portfolio");body.entity_ids=value(form,"entity_ids").split(/\r?\n/).map(v=>v.trim()).filter(Boolean);}
  if (kind==="entity") body.entity_id=value(form,"entity_id");
  if (kind==="statements") body.parameters=objectValue(form,"statementParameters");
  const result=await api("prepare",body);await refresh();await inspectRequest(result.id);
});
function syncDispatch() {$("#dispatch-request").disabled=busy||!selectedRequest||selectedRequest.state!=="PREPARED";}
async function inspectRequest(id) {
  selectedRequest=await api("request?"+new URLSearchParams({id}));
  const r=selectedRequest;$("#request-inspection").hidden=false;
  $("#request-detail").innerHTML=kv({"Original operation":r.id,"Native route":r.method+" "+r.url,"State":r.state,"Request SHA-256":r.requestSha256,
    "Original response":r.response?.status,"Correlation keys":Object.keys(r.correlation||{}),"Attempt":r.attempt})+
    button("Download request bytes","object",r.request)+(r.response?.object?" "+button("Download response bytes","object",r.response.object):"");
  const source=await api("object?"+new URLSearchParams({id:r.request}),undefined,{download:true});
  $("#request-body").textContent=await source.blob.text()||"(GET request has no body)";
  $("#response-body").textContent="";table("candidate-table",[],[]);
  if (r.response) {
    const received=await api("response?"+new URLSearchParams({id}));
    $("#response-body").textContent=pretty(received);
    const parsed=received.parsed||received.body||received.original||received.response||{};
    const rows=[];
    for (const [counterparty,result] of Object.entries(parsed.responses||{})) {
      for (const candidate of result.results||[]) rows.push([escape(counterparty),escape(candidate.caption||candidate.id)+"<br>"+escape(candidate.id),
        escape(candidate.score)+" · "+escape(candidate.match?"Native match":"Native non-match"),
        button("Review candidate","candidate",candidate.id,'data-counterparty="'+escape(counterparty)+'"')]);
    }
    table("candidate-table",["Original counterparty","Native candidate","Original score","Review"],rows);
  }
  syncDispatch();
}
$("#dispatch-request").addEventListener("click",()=>run("Dispatch original native request",async()=>{
  if (!selectedRequest||selectedRequest.state!=="PREPARED") throw new Error("This original operation has already left preparation; read its retained response or receive the existing worker outcome");
  await api("dispatch",{id:selectedRequest.id,expected:selectedRequest.revision});await refresh();
}));
onForm("receive-response-form","Receive actual native response",async form=>{
  if (!selectedRequest) throw new Error("Choose the original native request");
  const original=await upload(named(form,"original").files[0]);
  await api("receive-response",{id:selectedRequest.id,original:original.id,status:Number(value(form,"status")),sourceNote:value(form,"sourceNote"),expected:selectedRequest.revision});
  await refresh();
});
$("#export-workspace").addEventListener("click",()=>run("Export complete receiving workspace",async()=>{
  const result=await download("export","OpenSanctions_Receiving_Workspace.zip");
  $("#export-detail").textContent=result.name+" · "+result.bytes.toLocaleString()+" bytes · complete original source and case history.";
}));
onForm("receiving-form","Receive complete workspace",async form=>{
  const file=named(form,"original").files[0];if (!file) throw new Error("Choose the original receiving ZIP");
  const result=await api("import",file,{headers:{"Content-Type":"application/zip"}});$("#receiving-result").textContent=pretty(result);await refresh();
});
document.addEventListener("click",event=>{
  const trigger=event.target.closest("button[data-action]");if (!trigger) return;
  const {action,id}=trigger.dataset;
  run("Open original "+action,async()=>{
    if (action==="edition") {$("#source-edition").value=id;entityOffset=0;await loadEntities();navigate("sources");}
    if (action==="portfolio") {$("#portfolio-selection").value=id;counterpartyOffset=0;await loadCounterparties();navigate("portfolios");}
    if (action==="entity") {const result=await api("entity?"+new URLSearchParams({scope:$("#source-edition").value,id}));$("#entity-detail").textContent=pretty(result);$("#entity-detail").parentElement.open=true;}
    if (action==="counterparty") $("#counterparty-detail").textContent=pretty(await api("entity?"+new URLSearchParams({scope:$("#portfolio-selection").value,id})));
    if (action==="source") await download("source?"+new URLSearchParams({id}),"original.ftm.json");
    if (action==="object") await download("object?"+new URLSearchParams({id}),"original");
    if (action==="update") {inspectUpdate(id);navigate("updates");}
    if (action==="change") await inspectChange(id);
    if (action==="case") await inspectCase(id);
    if (action==="request") {await inspectRequest(id);navigate("screening");}
    if (action==="candidate") {
      resetCase();const f=$("#case-form"),r=selectedRequest;
      for (const [key,v] of Object.entries({portfolio_id:r.portfolio,counterparty_id:trigger.dataset.counterparty,candidate_id:id,edition_id:r.edition||$("#source-edition").value,match_request:r.id})) named(f,key).value=v;
      navigate("review");
    }
  });
});
await run("Open retained source workspace",refresh);
