/* MIT — Starforge CoinGecko market operations. */
async function runMarketWorkspace(){

"use strict";
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const h=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const attr=h, clone=x=>x==null?x:JSON.parse(JSON.stringify(x,(_k,v)=>v instanceof File?{fileName:v.name,fileBytes:v.size,fileModified:v.lastModified,fileType:v.type}:v));
const draftJSON=x=>JSON.stringify(x,(_k,v)=>v instanceof File?{fileName:v.name,fileBytes:v.size,fileModified:v.lastModified,fileType:v.type}:v);
const equal=(a,b)=>draftJSON(a)===draftJSON(b);
const valueText=v=>v===null?"Not supplied":v===undefined?"Absent":typeof v==="object"?JSON.stringify(v):String(v);
const displayDate=v=>v?new Date(v).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"medium"}):"—";
const localInput=v=>{if(!v)return"";const d=new Date(v);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,19)};
const bytes=v=>Number(v||0).toLocaleString()+" B";
const S={state:null,project:null,tab:"overview",panes:{sources:"captures",research:"snapshots"},tables:{},picked:{requests:new Set(),captures:new Set()},requestCache:null,modal:null,modalStack:[],renderId:0,jobTimer:null,busy:false,actor:localStorage.getItem("cg-market-operator")||"",projectId:localStorage.getItem("cg-market-project")||"",notice:""};
const tabs=[["overview","Overview"],["requests","Requests"],["collections","Collections"],["sources","Sources"],["research","Research"],["provider","Provider"],["handover","Handover"],["history","History"]];
const endpoint=id=>S.state.contracts.find(c=>c.id===id)||{id,name:id,pathFields:[],queryFields:[]};
const endpointName=id=>endpoint(id).name;
const badge=(value,kind="")=>`<span class="badge ${attr(kind)}">${h(value)}</span>`;
const button=(label,action,id="",extra="")=>`<button type="button" data-action="${attr(action)}"${id?` data-id="${attr(id)}"`:""} ${extra}>${h(label)}</button>`;
const download=(url,label="Download original")=>`<a class="button" href="${attr(url)}" download>${h(label)}</a>`;
const external=url=>/^https?:\/\//.test(url||"")?`<a href="${attr(url)}" target="_blank" rel="noreferrer">${h(url)}</a>`:h(url||"Not configured");
const empty=(title,text,action="")=>`<div class="empty"><h3>${h(title)}</h3><p>${h(text)}</p>${action}</div>`;
const note=(text,kind="")=>`<div class="notice ${attr(kind)}">${h(text)}</div>`;
const section=(title,body,actions="")=>`<section class="section"><div class="section-head"><h2>${h(title)}</h2><div class="actions">${actions}</div></div>${body}</section>`;
function toast(message,error=false){const box=$("#toast");box.textContent=message;box.className=error?"toast error":"toast";box.hidden=false;clearTimeout(S.toastTimer);S.toastTimer=setTimeout(()=>box.hidden=true,error?18000:7000)}
function showError(e){toast(e?.message||String(e),true)}
async function api(path,options={}){
  let response;
  try{response=await fetch(path,{cache:"no-store",...options,headers:{"X-Workspace-Request":"1",...(options.body?{"Content-Type":"application/json"}:{}),...options.headers}})}
  catch(e){throw Object.assign(new Error("The connection ended before the result was received. Keep this operation and retry its exact saved request."),{uncertain:true,cause:e})}
  let data;const text=await response.text();
  try{data=text?JSON.parse(text):{}}catch{throw Object.assign(new Error("The server returned an unreadable response. The original operation remains available."),{status:response.status,uncertain:options.method==="POST"})}
  if(!response.ok)throw Object.assign(new Error(data.message||data.error||`HTTP ${response.status}`),data,{status:response.status,uncertain:response.status>=500});
  return data;
}
const get=path=>api(path);
function actor(){S.actor=$("#operator-name").value.trim();if(!S.actor){$("#operator-name").focus();throw new Error("Enter the name of the operator recording this work.")}localStorage.setItem("cg-market-operator",S.actor);return S.actor}
async function mutation(path,payload,{operation,project=true}={}){
  const op=operation||{id:crypto.randomUUID()};
  if(!op.body)op.body={actor:actor(),opId:op.id,...(project&&S.project?{revision:S.project.revision}:{}),...payload};
  const r=await api(path,{method:"POST",body:JSON.stringify(op.body)});
  if(S.project&&r.projectId===S.project.id&&Number.isInteger(r.revision))S.project.revision=r.revision;
  return r.value;
}
async function refreshState(){S.state=await get("/api/state");S.state.contracts||=[];S.state.buyerProfiles||=[];renderHeader()}
async function loadProject(id=S.projectId){
  if(!id){S.project=null;S.projectId="";return null}
  const d=await get("/api/projects/"+encodeURIComponent(id));S.project=d.project;S.projectDetail=d;S.projectId=id;localStorage.setItem("cg-market-project",id);return d;
}
async function refreshCurrent(){await refreshState();if(S.projectId)await loadProject();S.requestCache=null;await renderView()}
async function selectProject(id){if(S.busy)return;if(S.modal?.isForm&&S.modal.dirty&&!confirm("Switch projects and discard the unsaved editor fields?")){renderHeader();return}closeModal(true);S.picked={requests:new Set(),captures:new Set()};S.tables={};S.requestCache=null;await loadProject(id);renderHeader();await renderView()}
function renderHeader(){
  $("#operator-name").value=S.actor;
  $("#project-select").innerHTML=`<option value="">Choose a project</option>`+(S.state?.projects||[]).map(p=>`<option value="${attr(p.id)}"${p.id===S.projectId?" selected":""}>${h(p.name)}</option>`).join("");
  $("#navigation").innerHTML=tabs.map(([id,label])=>`<button type="button" data-action="nav" data-id="${id}" ${id===S.tab?'aria-current="page"':""}>${h(label)}</button>`).join("");
  $("#project-context").textContent=S.project?`${S.project.name} · revision ${S.project.revision}`:"Create or open a market research project";
}
function tableState(key){return S.tables[key]||=( {offset:0,limit:25,q:"",kind:"",status:""} )}
function queryString(key){const t=tableState(key);return new URLSearchParams(Object.fromEntries(Object.entries(t).filter(([,v])=>v!==""&&v!==undefined))).toString()}
async function list(path,key){let r=await get(path+"?"+queryString(key));const t=tableState(key);if(t.offset>=r.total&&t.offset>0){t.offset=Math.max(0,Math.floor((r.total-1)/t.limit)*t.limit);r=await get(path+"?"+queryString(key))}return r}
async function allItems(collection){
  const out=[];let offset=0,total;
  do{const r=await get(`/api/projects/${S.projectId}/${collection}?offset=${offset}&limit=100`);out.push(...r.items);total=r.total;offset+=r.items.length;if(r.items.length===0&&offset<total)throw new Error("The full collection could not be read. Refresh and inspect the current project.");}while(offset<total);
  return out;
}
async function allRequests(){const rev=S.project.revision;if(S.requestCache?.revision===rev)return S.requestCache.items;const items=await allItems("requests");S.requestCache={revision:rev,items};return items}
function listControls(key,data,{kindOptions=[],statusOptions=[],placeholder="Search records"}={}){
  const t=tableState(key),from=data.total?data.offset+1:0,to=Math.min(data.total,data.offset+data.items.length);
  return `<div class="list-controls"><label class="search"><span class="sr-only">${h(placeholder)}</span><input type="search" data-search="${attr(key)}" value="${attr(t.q)}" placeholder="${attr(placeholder)}"></label>${kindOptions.length?`<label>Kind <select data-filter="kind" data-key="${attr(key)}"><option value="">All</option>${kindOptions.map(v=>`<option value="${attr(v)}"${t.kind===v?" selected":""}>${h(v)}</option>`).join("")}</select></label>`:""}${statusOptions.length?`<label>Status <select data-filter="status" data-key="${attr(key)}"><option value="">All</option>${statusOptions.map(v=>`<option value="${attr(v)}"${t.status===v?" selected":""}>${h(v)}</option>`).join("")}</select></label>`:""}<span class="count">${from.toLocaleString()}–${to.toLocaleString()} of ${data.total.toLocaleString()}</span>${button("Previous","page",key,`data-direction="-1" ${data.offset===0?"disabled":""}`)}${button("Next","page",key,`data-direction="1" ${to>=data.total?"disabled":""}`)}</div>`;
}
function dataTable(headings,rows,emptyText="No records match this view."){return rows.length?`<div class="table-scroll"><table><thead><tr>${headings.map(v=>`<th scope="col">${v}</th>`).join("")}</tr></thead><tbody>${rows.map(cells=>`<tr>${cells.map(cell=>`<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`:empty("No records",emptyText)}
function keyValues(object){return `<dl class="key-values">${Object.entries(object).map(([k,v])=>`<div><dt>${h(k)}</dt><dd>${typeof v==="string"?h(v):h(valueText(v))}</dd></div>`).join("")}</dl>`}
function jsonView(value){return `<pre class="json-view">${h(JSON.stringify(value,null,2))}</pre>`}
function checkRow(set,id,label){return `<input type="checkbox" data-pick="${attr(set)}" data-id="${attr(id)}" aria-label="${attr(label)}"${S.picked[set].has(id)?" checked":""}>`}
function subnav(group,items){return `<div class="subnav" aria-label="${attr(group)} views">${items.map(v=>button(v[1],"pane",v[0],`data-group="${attr(group)}" ${S.panes[group]===v[0]?'aria-current="page"':""}`)).join("")}</div>`}
async function renderView(){
  const generation=++S.renderId;renderHeader();
  if(!S.project){$("#main").innerHTML=empty("Market data operations","Create a project to configure requests, retain original responses, prepare collections and assemble a complete handover.",button("Create project","new-project"));return}
  const focus=document.activeElement?.dataset.search,selection=document.activeElement?.selectionStart;
  let content=await ({overview:overviewView,requests:requestsView,collections:collectionsView,sources:sourcesView,research:researchView,provider:providerView,handover:handoverView,history:historyView}[S.tab])();
  if(generation!==S.renderId)return;
  $("#main").innerHTML=`<div class="page-title"><div><p class="eyebrow">CoinGecko · Stellar market operations</p><h1>${h(tabs.find(t=>t[0]===S.tab)[1])}</h1></div>${button("Refresh","refresh")}</div>${content}`;
  if(focus){const el=$(`[data-search="${CSS.escape(focus)}"]`);if(el){el.focus();el.setSelectionRange(selection,selection)}}
}
function dialogShell(title,body,footer=""){
  return `<div class="dialog-head"><div>${S.modalStack.length?button("Back","dialog-back"):""}<h2 id="dialog-title">${h(title)}</h2></div>${button("Close","close-dialog")}</div><div class="dialog-content">${body}</div>${footer?`<div class="dialog-footer">${footer}</div>`:""}`;
}
function closeModal(force=false){
  if(S.busy&&!force)return;
  if(S.modal?.isForm&&!force&&S.modal.dirty&&!confirm("Close this editor and discard its unsaved fields?"))return;
  clearTimeout(S.jobTimer);S.jobTimer=null;S.modal=null;S.modalStack=[];const d=$("#dialog");if(d.open)d.close();d.innerHTML="";
}
function detailModal(title,body,footer="",{back=false,refresh,focus=true}={}){
  clearTimeout(S.jobTimer);S.jobTimer=null;
  if(back&&S.modal)S.modalStack.push(S.modal);
  S.modal={title,body,footer,refresh,isForm:false};
  const d=$("#dialog");d.innerHTML=dialogShell(title,body,footer);if(!d.open)d.showModal();if(focus)$("#dialog .dialog-head button")?.focus();
}
function rebuildDetail(body,footer=""){if(!S.modal||S.modal.isForm)return;S.modal.body=body;S.modal.footer=footer;$("#dialog").innerHTML=dialogShell(S.modal.title,body,footer)}
function fieldsHtml(fields,values){
  return fields.map(f=>{
    const v=values[f.name]??f.default??"",id="field-"+f.name.replace(/[^A-Za-z0-9_-]/g,"-");
    const common=`id="${id}" name="${attr(f.name)}"${f.required?" required":""}${f.min!==undefined?` min="${attr(f.min)}"`:""}${f.max!==undefined?` max="${attr(f.max)}"`:""}${f.readOnly?" readonly":""}`;
    let control;
    if(f.type==="select"||f.type==="multiselect")control=`<select ${common}${f.type==="multiselect"?' multiple size="9"':""}>${(f.options||[]).map(o=>{const [value,label]=Array.isArray(o)?o:[o,o];const selected=f.type==="multiselect"?(Array.isArray(v)&&v.includes(value)):String(value)===String(v);return `<option value="${attr(value)}"${selected?" selected":""}>${h(label)}</option>`}).join("")}</select>`;
    else if(f.type==="textarea"||f.type==="json")control=`<textarea ${common} rows="${f.rows||5}"${f.type==="json"?' class="code" spellcheck="false"':""}>${h(f.type==="json"&&typeof v==="object"?JSON.stringify(v,null,2):v)}</textarea>`;
    else if(f.type==="checkbox")control=`<input ${common} type="checkbox"${v?" checked":""}>`;
    else if(f.type==="file")control=`<input ${common} type="file"${f.accept?` accept="${attr(f.accept)}"`:""}>`;
    else control=`<input ${common} type="${attr(f.type||"text")}" value="${attr(v)}"${f.type==="datetime-local"?' step="1"':""}${f.pattern?` pattern="${attr(f.pattern)}"`:""}${f.placeholder?` placeholder="${attr(f.placeholder)}"`:""}>`;
    return `<label class="field ${f.wide?"wide":""} ${f.type==="checkbox"?"checkbox-field":""}" for="${id}"><span>${h(f.label)}</span>${control}${f.help?`<small>${h(f.help)}</small>`:""}</label>`;
  }).join("");
}
function rawFormValues(fields,form=$("#editor")){
  return Object.fromEntries(fields.map(f=>{const el=form.elements.namedItem(f.name);let v;if(f.type==="checkbox")v=el.checked;else if(f.type==="multiselect")v=[...el.selectedOptions].map(o=>o.value);else if(f.type==="file")v=el.files[0]||null;else if(f.type==="json"){try{v=el.value.trim()?JSON.parse(el.value):null}catch{throw new Error(f.label+" must contain valid JSON.")}}else v=el.value;return[f.name,v]}));
}
function setFormValues(fields,values){
  for(const f of fields){const el=$("#editor").elements.namedItem(f.name);if(!el||f.type==="file")continue;const v=values[f.name]??"";if(f.type==="checkbox")el.checked=!!v;else if(f.type==="multiselect"){for(const o of el.options)o.selected=Array.isArray(v)&&v.includes(o.value)}else el.value=f.type==="json"&&typeof v==="object"?JSON.stringify(v,null,2):v;}
}
function openForm({title,fields,initial={},intro="",extra="",read,apply,save,latest,after,submitLabel="Save",onMount}){
  clearTimeout(S.jobTimer);S.jobTimer=null;
  S.modalStack=[];
  const m=S.modal={isForm:true,title,fields,initial:clone(initial),baseline:clone(initial),intro,extra,read,apply,save,latest,after,submitLabel,dirty:false,operation:{id:crypto.randomUUID()},onMount};
  const content=`<form id="editor">${intro?note(intro):""}<div id="form-error" role="alert" hidden></div><div id="conflict-panel" hidden></div><div class="form-grid">${fieldsHtml(fields,initial)}</div>${extra}<div class="form-actions"><button type="submit" class="primary">${h(submitLabel)}</button>${button("Cancel","close-dialog")}</div></form>`;
  const d=$("#dialog");d.innerHTML=dialogShell(title,content);if(!d.open)d.showModal();onMount?.();$("#editor input:not([type=hidden]),#editor select,#editor textarea")?.focus();
  if(read)m.baseline=clone(read(rawFormValues(fields)));
}
function setFormBusy(busy){
  S.busy=busy;$("#dialog").toggleAttribute("aria-busy",busy);
  for(const e of $$("button,input,select,textarea",$("#dialog"))){if(busy){e.dataset.wasDisabled=e.disabled?"1":"0";e.disabled=true}else{if(e.dataset.wasDisabled!==undefined){e.disabled=e.dataset.wasDisabled==="1";delete e.dataset.wasDisabled}}}
  const submit=$("#editor button[type=submit]");if(submit)submit.textContent=busy?"Saving…":S.modal?.submitLabel||"Save";
}
function threeWay(base,mine,current,path=[],conflicts=[]){
  if(equal(mine,base))return clone(current);if(equal(current,base)||equal(mine,current))return clone(mine);
  const object=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
  if(object(base)&&object(mine)&&object(current)){const out={};for(const k of new Set([...Object.keys(base),...Object.keys(mine),...Object.keys(current)])){const v=threeWay(base[k],mine[k],current[k],[...path,k],conflicts);if(v!==undefined)out[k]=v;}return out}
  conflicts.push({path,base:clone(base),mine:clone(mine),current:clone(current)});return clone(current);
}
function putAt(object,path,value){if(path.length===0)return clone(value);let x=object;for(const k of path.slice(0,-1))x=x[k]??={};if(value===undefined)delete x[path.at(-1)];else x[path.at(-1)]=clone(value);return object}
async function inspectConflict(error){
  const m=S.modal;if(!m?.isForm)return;
  const mine=m.read?m.read(rawFormValues(m.fields)):rawFormValues(m.fields);
  const current=await m.latest?.()||{value:m.baseline};
  await loadProject();
  const conflicts=[],merged=threeWay(m.baseline,mine,current.value,[],conflicts);
  m.conflict={mine,current,conflicts,merged};
  const panel=$("#conflict-panel");panel.hidden=false;
  panel.innerHTML=`<h3>Another operator saved this record</h3><p>Your fields are retained. Changes to different fields are combined below. Choose a value for each field changed by both operators, then inspect the editor before saving.</p>${conflicts.length?dataTable(["Field","Original","Your value","Current value","Use"],conflicts.map((c,i)=>[h(c.path.join("."))||"Record",h(valueText(c.base)),h(valueText(c.mine)),h(valueText(c.current)),`<select data-conflict="${i}" aria-label="Choose ${attr(c.path.join("."))}"><option value="">Choose…</option><option value="mine">Your value</option><option value="current">Current value</option></select>`])):note("These changes affect different fields and can be combined.")}${button("Apply reviewed merge","apply-merge")}`;
  panel.scrollIntoView({block:"nearest"});
}
async function submitEditor(){
  const m=S.modal;if(!m?.isForm||S.busy)return;
  if(!$("#editor").reportValidity())return;
  const err=$("#form-error");err.hidden=true;
  try{
    const raw=rawFormValues(m.fields),value=m.read?m.read(raw):raw;
    if(m.operation.body&&m.savedValue&&!equal(value,m.savedValue))throw new Error("Retry the original uncertain operation before changing its fields, or inspect the retained record and start a separate edit.");
    m.savedValue=clone(value);setFormBusy(true);
    const result=await m.save(value,m.operation);
    await refreshState();if(S.projectId)await loadProject();S.requestCache=null;
    setFormBusy(false);m.dirty=false;closeModal(true);
    await renderView();if(m.after)await m.after(result);toast("Saved.");
  }catch(e){
    setFormBusy(false);
    if(e.status===409&&["STALE_REVISION","STALE_VERSION"].includes(e.error)){m.operation={id:crypto.randomUUID()};m.savedValue=null;try{await inspectConflict(e)}catch(x){err.hidden=false;err.textContent=x.message}}
    else{err.hidden=false;err.className="notice error";err.textContent=e.message;if(e.uncertain){m.submitLabel="Retry the same operation";$("#editor button[type=submit]").textContent=m.submitLabel;}else{m.operation={id:crypto.randomUUID()};m.savedValue=null}}
  }
}
function applyMerge(){
  const m=S.modal,c=m?.conflict;if(!c)return;
  let merged=clone(c.merged);
  for(let i=0;i<c.conflicts.length;i++){const choice=$(`[data-conflict="${i}"]`).value;if(!choice)throw new Error("Choose a value for every field changed by both operators.");const item=c.conflicts[i];merged=putAt(merged,item.path,item[choice]);}
  m.baseline=clone(c.current.value);m.initial=clone(c.current.value);m.currentVersion=c.current.version;m.operation={id:crypto.randomUUID()};m.savedValue=null;
  if(m.apply)m.apply(merged);else setFormValues(m.fields,merged);
  $("#conflict-panel").hidden=true;$("#form-error").hidden=false;$("#form-error").className="notice";$("#form-error").textContent="The reviewed merge is in the editor. Inspect it and save.";m.dirty=true;m.conflict=null;
}
async function fileBase64(file,{limit=S.state.limits?.uploadBytes||15000000}={}){
  if(!file)throw new Error("Choose the original file.");if(limit&&file.size>limit)throw new Error(`The selected file exceeds the ${Number(limit).toLocaleString()} byte limit.`);
  const data=new Uint8Array(await file.arrayBuffer());let binary="";for(let i=0;i<data.length;i+=32768)binary+=String.fromCharCode(...data.subarray(i,i+32768));return btoa(binary);
}
async function retainFile(file,memo){
  if(!file)throw new Error("Choose the original file.");
  const key=file.name+":"+file.size+":"+file.lastModified;
  if(memo.file===file&&memo.id)return memo.id;
  if(memo.file&&memo.file!==file&&memo.operation?.body&&!memo.id)throw new Error("The original file upload has an uncertain result. Select that same file and retry its saved operation before choosing a different source.");
  if(memo.file!==file){memo.file=file;memo.key=key;memo.id=null;memo.operation={id:crypto.randomUUID()};}
  memo.operation||={id:crypto.randomUUID()};
  const r=await mutation(`/api/projects/${S.projectId}/files`,{filename:file.name,contentType:file.type||"application/octet-stream",contentBase64:await fileBase64(file)},{operation:memo.operation});
  memo.key=key;memo.id=r.id;return r.id;
}



async function overviewView(){
  const d=S.projectDetail,c=d.counts||{},jobs=d.latestJobs||[];
  const config=S.project.config||{};
  const cards=[["Requests",c.requests||0],["Collections",c.collections||0],["Original captures",c.captures||0],["Saved snapshots",c.snapshots||0],["Comparisons",c.comparisons||0],["Research notes",c.notes||0]];
  return `<div class="metrics">${cards.map(([label,value])=>`<div><strong>${value.toLocaleString()}</strong><span>${h(label)}</span></div>`).join("")}</div>`+
    section("Project configuration",keyValues({"Merchant origin":config.merchantOrigin||"Not configured","Merchant prefix":config.merchantPrefix||"/api/v3/stellar","Buyer profile":(S.state.buyerProfiles.find(p=>p.id===config.buyerProfileId)||{}).name||"Not selected","Project ID":S.project.id}),button("Edit configuration","config"))+
    section("Current operations",jobs.length?dataTable(["Operation","Kind","Progress","State",""],jobs.map(j=>[h(j.name),h(j.kind),`${j.completed??0} / ${j.total??0}`,badge(j.status),button("Inspect","job",j.id)])):empty("Ready for the first collection","Configure requests for one or more endpoint families, retain an unsigned vendor or merchant challenge, and prepare the selected collection.",button("New request","new-request")),button("Observe requests","probe"))+
    section("Request families",`<div class="family-grid">${S.state.contracts.map(e=>`<article><h3>${h(e.name)}</h3><p>${h(e.description)}</p><code>${h(e.pathTemplate)}</code><div class="actions">${button("Configure","new-request",e.id)}${e.docsUrl?external(e.docsUrl):""}</div></article>`).join("")}</div>`)+
    section("Working record",`<p>Every saved request, original response, payment attempt and comparison remains available in this project. Data network and payment network are recorded independently. Vendor examples are labeled at capture, row and snapshot level.</p><div class="actions">${button("Open research","nav","research")}${button("Prepare handover","nav","handover")}</div>`);
}
function projectForm(){
  openForm({title:"Create market operations project",fields:[{name:"name",label:"Project name",required:true,wide:true}],save:(v,op)=>mutation("/api/projects",v,{operation:op,project:false}),after:p=>selectProject(p.id),submitLabel:"Create project"});
}
function configValues(p){return {merchantOrigin:p.config?.merchantOrigin||"",merchantPrefix:p.config?.merchantPrefix||"/api/v3/stellar",buyerProfileId:p.config?.buyerProfileId||""}}
function configForm(prefill={}){
  const initial={...configValues(S.project),...prefill};
  openForm({title:"Project configuration",intro:"Select the provider-operated Stellar service and an existing buyer profile. Vendor source discovery and response imports remain available when no merchant is configured.",fields:[
    {name:"merchantOrigin",label:"Merchant origin",type:"url",placeholder:"https://market.example.com",wide:true},
    {name:"merchantPrefix",label:"Merchant route prefix",required:true,help:"The provider’s additional Stellar routes; the vendor uses its own x402 routes."},
    {name:"buyerProfileId",label:"Existing buyer profile",type:"select",options:[["","No buyer profile"],...S.state.buyerProfiles.map(p=>[p.id,`${p.name} · ${p.network}${p.workspaceConfigured?"":" · setup incomplete"}`])]}
  ],initial,save:(v,op)=>mutation(`/api/projects/${S.projectId}/config`,{config:v},{operation:op}),latest:async()=>({value:configValues((await get(`/api/projects/${S.projectId}`)).project)})});
}
async function requestsView(){
  const data=await list(`/api/projects/${S.projectId}/requests`,"requests");
  return section("Saved request definitions",`<p class="muted">Path, query and provider selection remain attached to each version. Selecting a request on another page keeps the previous selections.</p><div class="actions">${button("New request","new-request")}${button(`Create collection (${S.picked.requests.size})`,"new-collection")}${button("Observe selected","probe")}${button("Clear selection","clear-picks","requests")}</div>${listControls("requests",data,{placeholder:"Search name, endpoint or request identity"})}`+
    dataTable(["Select","Request","Endpoint","State","Selector / resource",""],data.items.map(r=>[checkRow("requests",r.id,"Select "+r.name),`<strong>${h(r.name)}</strong><small>${h(r.id)} · version ${r.version}</small>`,h(endpointName(r.endpoint)),badge(r.enabled?"Enabled":"Disabled"),`<span>${h(valueText(r.effectiveSelector||r.path||{}))}</span><small>${h(r.urls?.merchant||r.urls?.vendor||"")}</small>`,`<div class="actions">${button("Inspect","request",r.id)}${button("Edit","edit-request",r.id)}</div>`])));
}
const requestWritable=r=>({name:r.name,endpoint:r.endpoint,path:clone(r.path||{}),query:clone(r.query||{}),notes:r.notes||"",enabled:r.enabled!==false});
function requestFlat(r){const out={name:r.name,endpoint:r.endpoint,notes:r.notes||"",enabled:r.enabled!==false};for(const[k,v]of Object.entries(r.path||{}))out["path."+k]=v;for(const[k,v]of Object.entries(r.query||{}))out["query."+k]=v===true?"true":v===false?"false":v;return out}
function requestFields(e){
  return [{name:"name",label:"Request name",required:true},{name:"endpoint",label:"Endpoint family",type:"select",options:S.state.contracts.map(x=>[x.id,x.name])},
    ...(e.pathFields||[]).map(f=>({...f,name:"path."+f.name,type:"text",help:f.description})),
    ...(e.queryFields||[]).map(f=>({...f,name:"query."+f.name,type:f.type==="enum"||f.type==="boolean"?"select":f.type==="integer"?"number":"text",options:f.type==="boolean"?[["","Not specified"],["true","True"],["false","False"]]:f.enum?[["","Not specified"],...f.enum.map(x=>[x,x])]:undefined,help:f.description})),
    {name:"notes",label:"Research or operating notes",type:"textarea",wide:true},{name:"enabled",label:"Include in new observations",type:"checkbox"}];
}
function readRequestForm(raw){
  const e=endpoint(raw.endpoint),out={name:raw.name,endpoint:raw.endpoint,path:{},query:{},notes:raw.notes||"",enabled:raw.enabled};
  for(const f of e.pathFields||[]){const v=raw["path."+f.name];if(v!==""&&v!==undefined)out.path[f.name]=v}
  for(const f of e.queryFields||[]){const v=raw["query."+f.name];if(v!==""&&v!==undefined)out.query[f.name]=f.type==="boolean"?v==="true":f.type==="integer"?Number(v):v}
  return out;
}
async function requestForm(id,chosenEndpoint){
  const original=id?(await get("/api/requests/"+id)).request:null,first=endpoint(chosenEndpoint||original?.endpoint||S.state.contracts[0]?.id);
  const drafts=new Map(),initial=original?requestWritable(original):{name:first.name,endpoint:first.id,path:clone(first.example?.path||{}),query:clone(first.example?.query||{}),notes:"",enabled:true};
  let editorBaseline=clone(initial),version=original?.version;
  function mountRequest(value){
    const e=endpoint(value.endpoint),fields=requestFields(e);
    openForm({title:original?"Edit request":"Configure request",fields,initial:requestFlat(value),intro:`${e.description||""} Data-network identifiers belong to the requested market data. Payment terms are selected from the original merchant challenge.`,read:readRequestForm,apply:v=>{version=S.modal.currentVersion??version;editorBaseline=clone(S.modal.baseline);mountRequest(v)},save:(v,op)=>mutation(original?"/api/requests/"+original.id:`/api/projects/${S.projectId}/requests`,{...(original?{version:S.modal.currentVersion??version}:{}),request:v},{operation:op}),latest:original?async()=>{const r=(await get("/api/requests/"+id)).request;return {value:requestWritable(r),version:r.version}}:async()=>({value:editorBaseline}),after:r=>requestDetail(r.id),onMount:()=>{
      $("#editor [name=endpoint]").addEventListener("change",()=>{
        const raw=rawFormValues(fields),previous=readRequestForm({...raw,endpoint:e.id});drafts.set(e.id,previous);
        const next=endpoint(raw.endpoint),stored=drafts.get(next.id)||{...previous,endpoint:next.id,path:clone(next.example?.path||{}),query:clone(next.example?.query||{})};mountRequest(stored);S.modal.dirty=true;
      });
    }});
    S.modal.baseline=clone(editorBaseline);
  }
  mountRequest(initial);
}
async function requestDetail(id,{back=false}={}){
  const d=await get("/api/requests/"+id),r=d.request;
  detailModal(r.name,`<div class="detail-intro">${badge(endpointName(r.endpoint))}${badge(r.enabled?"Enabled":"Disabled")}<span>Version ${r.version}</span></div>${keyValues({"Request ID":r.id,"Data path":r.path,"Native query":r.query,"Effective selector":r.effectiveSelector,"Updated":displayDate(r.updatedAt)})}<div class="source-addresses"><h3>Vendor request</h3>${external(r.urls?.vendor)}<h3>Merchant request</h3>${external(r.urls?.merchant)}</div>${r.notes?section("Notes",`<p class="prose">${h(r.notes)}</p>`):""}<details><summary>Version history (${d.versions?.length||0})</summary>${jsonView(d.versions||[])}</details>`,button("Edit request","edit-request",id)+button("Observe this request","probe-one",id)+button("Add research note","new-note",id,`data-target-type="request"`),{back});
}



async function collectionsView(){
  const data=await list(`/api/projects/${S.projectId}/collections`,"collections");
  return section("Ordered request collections",`<div class="actions">${button("New collection","new-collection")}${button("Import definition","import-collection")}</div>${listControls("collections",data)}`+dataTable(["Collection","Requests","Updated",""],data.items.map(c=>[`<strong>${h(c.name)}</strong><small>${h(c.description||"")}</small>`,String(c.requestIds?.length??c.requestCount??0),h(displayDate(c.updatedAt)),`<div class="actions">${button("Open","collection",c.id)}${button("Edit","edit-collection",c.id)}</div>`])));
}
const collectionWritable=c=>({name:c.name,description:c.description||"",requestIds:[...(c.requestIds||[])]});
async function collectionForm(id){
  const requests=await allRequests(),record=id?(await get("/api/collections/"+id)).collection:null;
  const initial=record?collectionWritable(record):{name:"",description:"",requestIds:[...S.picked.requests]};
  let order=[...initial.requestIds],version=record?.version;
  function renderOrder(){
    $("#ordered-requests").innerHTML=order.length?`<ol>${order.map((id,i)=>{const r=requests.find(x=>x.id===id);return `<li data-order-id="${attr(id)}"><div><strong>${h(r?.name||id)}</strong><small>${h(r?endpointName(r.endpoint):"Original request reference")}</small></div><div class="actions">${button("Up","order-up",id,i===0?"disabled":"")}${button("Down","order-down",id,i===order.length-1?"disabled":"")}${button("Remove","order-remove",id)}</div></li>`}).join("")}</ol>`:empty("No requests selected","Add requests in the order they should be inspected and prepared.");
    $("#request-order-add").innerHTML=`<option value="">Choose a saved request</option>`+requests.filter(r=>!order.includes(r.id)).map(r=>`<option value="${attr(r.id)}">${h(r.name)} · ${h(endpointName(r.endpoint))}</option>`).join("");
  }
  openForm({title:record?"Edit collection":"Create collection",fields:[{name:"name",label:"Collection name",required:true,wide:true},{name:"description",label:"Purpose and operating notes",type:"textarea",wide:true}],initial,extra:`<section class="order-editor"><h3>Requests in collection order</h3><div class="actions"><select id="request-order-add" aria-label="Add saved request"></select>${button("Add request","order-add")}</div><div id="ordered-requests"></div></section>`,read:v=>({...v,requestIds:[...order]}),apply:v=>{setFormValues(S.modal.fields,v);order=[...v.requestIds];version=S.modal.currentVersion??version;renderOrder()},save:(v,op)=>mutation(record?"/api/collections/"+id:`/api/projects/${S.projectId}/collections`,{...(record?{version:S.modal.currentVersion??version}:{}),collection:v},{operation:op}),latest:record?async()=>{const c=(await get("/api/collections/"+id)).collection;return {value:collectionWritable(c),version:c.version}}:async()=>({value:initial}),after:c=>collectionDetail(c.id),onMount:()=>{
    S.modal.orderCommand=(action,id)=>{
      if(action==="order-add"){const selected=$("#request-order-add").value;if(selected&&!order.includes(selected))order.push(selected)}
      else{const i=order.indexOf(id);if(i<0)return;if(action==="order-remove")order.splice(i,1);else{const j=i+(action==="order-up"?-1:1);if(j>=0&&j<order.length)[order[i],order[j]]=[order[j],order[i]]}}
      S.modal.dirty=true;renderOrder();
    };renderOrder();
  }});
}
async function collectionDetail(id,{back=false}={}){
  const d=await get("/api/collections/"+id),c=d.collection;
  detailModal(c.name,`${c.description?`<p class="prose">${h(c.description)}</p>`:""}<p class="muted">Version ${c.version} · ${d.requests.length} requests in saved order</p>`+dataTable(["Order","Request","Endpoint","Current resource",""],d.requests.map((r,i)=>[String(i+1),h(r.name),h(endpointName(r.endpoint)),`<small>${h(r.urls?.merchant||r.urls?.vendor||"")}</small>`,button("Inspect","request",r.id,`data-back="1"`)])),button("Edit collection","edit-collection",id)+button("Observe collection","probe-collection",id)+button("Prepare checkout","checkout",id)+download(`/api/collections/${id}/download`,"Export definition"),{back});
}
async function importCollectionForm(){
  const files=await allItems("files"),memo={};
  openForm({title:"Import a request collection",intro:"Import the original JSON definition. Request definitions and their saved order are retained in this project.",fields:[
    {name:"name",label:"Collection name",required:true,wide:true},
    {name:"fileId",label:"Retained original file",type:"select",options:[["","Upload a file below"],...files.map(f=>[f.id,f.name+" · "+bytes(f.bytes)])],wide:true},
    {name:"sourceFile",label:"Original collection JSON",type:"file",accept:".json,application/json",wide:true}
  ],save:async(v,op)=>{const fileId=v.fileId||await retainFile(v.sourceFile,memo);return mutation(`/api/projects/${S.projectId}/collection-import`,{fileId,name:v.name},{operation:op})},after:r=>collectionDetail(r.collection.id)});
}
async function checkoutForm(id){
  const d=await get("/api/collections/"+id),captures=await allItems("captures"),c=d.collection;
  const fullCaps=[];
  for(const summary of captures.filter(x=>x.kind==="challenge"&&d.requests.some(r=>r.id===x.requestId))){const full=summary.challenge?summary:(await get("/api/captures/"+summary.id)).capture;fullCaps.push(full)}
  const options=new Map();
  const rows=d.requests.map(r=>{
    const choices=[];
    for(const cap of fullCaps.filter(x=>x.requestId===r.id)){
      (cap.challenge?.accepts||[]).forEach((terms,index)=>{
        const isStellar=String(terms.network||"").startsWith("stellar:");
        const current=cap.requestVersion===r.version&&cap.requestUrl===r.urls?.merchant;
        const key=cap.id+":"+index;options.set(key,{requestId:r.id,captureId:cap.id,acceptIndex:index,terms,current,isStellar});
        choices.push({key,allowed:isStellar&&current,label:`${cap.name||displayDate(cap.observedAt)} · ${terms.amount} atomic ${terms.asset} · ${terms.network}${current?"":" · earlier / other resource"}${isStellar?"":" · vendor network"}`});
      });
    }
    return [h(r.name),h(endpointName(r.endpoint)),`<select data-checkout="${attr(r.id)}" aria-label="Select payment terms for ${attr(r.name)}"><option value="">Do not include</option>${choices.map(o=>`<option value="${attr(o.key)}"${o.allowed?"":" disabled"}>${h(o.label)}</option>`).join("")}</select>`,button("Inspect source","checkout-source",r.id)];
  });
  const fields=[{name:"name",label:"Prepared purchase name",required:true,wide:true},{name:"buyerProfileId",label:"Existing buyer profile",type:"select",required:true,options:[["","Select a buyer profile"],...S.state.buyerProfiles.map(p=>[p.id,`${p.name} · ${p.network}`])],wide:true}];
  openForm({title:"Prepare collection checkout",fields,initial:{name:c.name+" · purchase",buyerProfileId:S.project.config?.buyerProfileId||""},intro:"Choose one original Stellar payment option for each request to include. Preparing the collection pins its request and terms in the existing buyer inbox. The subsequent execution view shows the current native operator requirements and each original outcome.",extra:dataTable(["Request","Endpoint","Original payment option",""],rows)+`<div id="checkout-selection-detail"></div>`,read:v=>({...v,selections:$$("[data-checkout]",$("#dialog")).filter(el=>el.value).map(el=>{const {requestId,captureId,acceptIndex}=options.get(el.value);return{requestId,captureId,acceptIndex}})}),save:(v,op)=>{if(!v.selections.length)throw new Error("Select at least one current merchant payment option.");return mutation(`/api/collections/${id}/checkout`,{...v,version:c.version},{operation:op})},latest:async()=>{const latest=(await get("/api/collections/"+id)).collection;if(latest.version!==c.version)throw new Error("This collection changed. Reopen checkout to inspect its current request order and original challenges.");return{value:S.modal.baseline,version:latest.version}},after:j=>jobDetail(j.id),submitLabel:"Prepare selected purchases",onMount:()=>{
    S.modal.checkoutSource=requestId=>{const el=$(`[data-checkout="${CSS.escape(requestId)}"]`),selected=el.value&&options.get(el.value);if(!selected)throw new Error("Choose the original option to inspect.");const cap=fullCaps.find(x=>x.id===selected.captureId);$("#checkout-selection-detail").innerHTML=section("Selected original terms",keyValues({"Original request":cap.requestUrl,"Advertised resource":cap.advertisedResourceUrl,"Capture":cap.id})+jsonView(selected.terms));};
  }});
}



async function sourcesView(){
  const pane=S.panes.sources||"captures";
  const data=await list(`/api/projects/${S.projectId}/${pane}`,"sources-"+pane);
  const top=subnav("sources",[["captures","Captures"],["jobs","Operations"],["files","Original files"]]);
  if(pane==="captures"){
    const rows=data.items.map(c=>[
      c.kind==="response"?checkRow("captures",c.id,"Select "+c.name):"",
      `<strong>${h(c.name)}</strong><small>${h(c.requestId)}</small>`,
      `${h(endpointName(c.endpoint))}<small>${h(c.basis)}</small>`,
      h(displayDate(c.observedAt)),
      `${h(c.httpStatus)}<small>${h(c.analysis?.rowCount??c.rowCount??"—")} rows</small>`,
      button("Open source","capture",c.id)
    ]);
    const actions=button("Observe requests","probe")+button("Import original response","import-response")+button(`Snapshot selected (${S.picked.captures.size})`,"new-snapshot")+button("Clear selection","clear-picks","captures");
    return top+section("Original market sources",`<div class="actions">${actions}</div>`+listControls("sources-captures",data,{placeholder:"Search source, request or capture identity",kindOptions:["challenge","response"]})+dataTable(["Select","Capture","Family / basis","Observed","HTTP / rows",""],rows));
  }
  if(pane==="jobs"){
    const rows=data.items.map(j=>[h(j.name),h(j.kind),`${j.completed??0} / ${j.total??0}`,badge(j.status),button("Inspect","job",j.id)]);
    return top+section("Native observation and purchase operations",listControls("sources-jobs",data)+dataTable(["Operation","Kind","Progress","Status",""],rows));
  }
  const rows=data.items.map(f=>[h(f.name),bytes(f.bytes),`<code>${h(f.sha256)}</code>`,h(displayDate(f.createdAt)),download(`/api/files/${f.id}/download`)]);
  return top+section("Retained original files",listControls("sources-files",data)+dataTable(["File","Size","Original SHA-256","Saved",""],rows));
}
async function probeForm({requestIds,collectionId}={}){
  const requests=await allRequests();
  if(collectionId)requestIds=(await get("/api/collections/"+collectionId)).collection.requestIds;
  const chosen=requestIds||[...S.picked.requests];
  openForm({title:"Observe original endpoint responses",intro:"The observer sends one unsigned GET for each selected request and retains the original body, headers and payment challenge. A 402 response is an observed result. Choose the data service whose current offer you need.",fields:[
    {name:"name",label:"Observation name",required:true,wide:true},
    {name:"target",label:"Data service",type:"select",options:[["vendor","CoinGecko’s published x402 service"],["merchant","Configured Stellar merchant"]],required:true,wide:true},
    {name:"requestIds",label:"Saved requests",type:"multiselect",options:requests.map(r=>[r.id,`${r.name} · ${endpointName(r.endpoint)}${r.enabled?"":" · disabled"}`]),required:true,wide:true}
  ],initial:{name:"Original endpoint observations",target:"vendor",requestIds:chosen},save:(v,op)=>mutation(`/api/projects/${S.projectId}/probes`,v,{operation:op}),after:j=>jobDetail(j.id),submitLabel:"Start observations"});
}
async function importResponseForm(requestId){
  const [requests,files]=await Promise.all([allRequests(),allItems("files")]),memo={};
  openForm({title:"Import an original response",intro:"Keep the supplied response bytes and original HTTP metadata. The recorded source and time describe the uploaded material.",fields:[
    {name:"name",label:"Source name",required:true,wide:true},
    {name:"requestId",label:"Saved request",type:"select",required:true,options:[["","Select a request"],...requests.map(r=>[r.id,r.name+" · "+endpointName(r.endpoint)])],wide:true},
    {name:"fileId",label:"Retained response file",type:"select",options:[["","Upload an original file below"],...files.map(f=>[f.id,f.name])],wide:true},
    {name:"sourceFile",label:"Original response / HTTP metadata JSON",type:"file",accept:".json,application/json",wide:true},
    {name:"headersFileId",label:"Retained headers file, if separate",type:"select",options:[["","Included in original response / none"],...files.map(f=>[f.id,f.name])],wide:true},
    {name:"httpStatus",label:"Original HTTP status",type:"number",min:100,max:599,required:true},
    {name:"observedAt",label:"Original observation time (local)",type:"datetime-local",required:true},
    {name:"sourceUrl",label:"Original request URL",type:"url",required:true,wide:true}
  ],initial:{requestId:requestId||"",httpStatus:"200",observedAt:""},save:async(v,op)=>{
    const fileId=v.fileId||await retainFile(v.sourceFile,memo);
    return mutation(`/api/projects/${S.projectId}/imports`,{name:v.name,requestId:v.requestId,fileId,httpStatus:Number(v.httpStatus),observedAt:new Date(v.observedAt).toISOString(),sourceUrl:v.sourceUrl,...(v.headersFileId?{headersFileId:v.headersFileId}:{})},{operation:op});
  },after:c=>captureDetail(c.id)});
}



const identityText=row=>[row.identity?.network,row.identity?.address||row.identity?.coinId||row.identity?.providerId||row.key].filter(Boolean).join(" · ");
const rowKinds=["coin","token","pool","included"];
function rowsTable(data,{captureId,snapshotId}={}){
  const rows=data.items.map(r=>[
    `<strong>${h(r.name||r.key)}</strong><small>${h(r.kind)}</small>`,
    `<code>${h(identityText(r))}</code>`,
    (r.fields||[]).slice(0,3).map(f=>`<small>${h(f.label||f.key)}: <strong>${h(valueText(f.value))}</strong></small>`).join(""),
    button("Inspect row","row",r.id,`data-capture-id="${attr(r.sourceCaptureId||captureId||"")}"${snapshotId?` data-snapshot-id="${attr(snapshotId)}"`:""}`)
  ]);
  return dataTable(["Entity","Identity","Original values",""],rows);
}
async function captureDetail(id,{back=false}={}){
  const d=await get("/api/captures/"+id),c=d.capture,key="capture-rows-"+id;
  let body=`<div class="detail-intro">${badge(c.kind)}${badge(c.basis)}<span>${h(endpointName(c.endpoint))}</span></div>`;
  body+=keyValues({"Original request URL":c.requestUrl,"Provider-advertised resource":c.advertisedResourceUrl||"Not advertised","Observation time":displayDate(c.observedAt),"Received":displayDate(c.receivedAt),"HTTP status":c.httpStatus,"Saved request version":c.requestVersion,"Original capture":c.id});
  body+=`<div class="actions">${c.sourceFileId?download(`/api/files/${c.sourceFileId}/download`,"Original supplied source"):""}${c.bodyFileId?download(`/api/files/${c.bodyFileId}/download`,"Original body"):""}${c.headersFileId?download(`/api/files/${c.headersFileId}/download`,"Original headers"):""}${c.challengeFileId?download(`/api/files/${c.challengeFileId}/download`,"Original challenge"):""}</div>`;
  if(c.rawBodyReference?.available===false)body+=section("Original body reference",keyValues(c.rawBodyReference));
  if(c.notices?.length)body+=note(c.notices.map(x=>typeof x==="string"?x:JSON.stringify(x)).join("\n"));
  if(c.kind==="challenge"){
    const accepts=c.challenge?.accepts||[];
    const rows=accepts.map((t,i)=>[String(i+1),h(t.scheme),h(t.network),`<code>${h(t.asset)}</code>`,`<code>${h(t.amount)}</code>`,`<code>${h(t.payTo)}</code>`]);
    body+=section("Original payment options",dataTable(["Order","Scheme","Network","Asset","Atomic amount","Recipient"],rows));
    body+=`<details><summary>Complete unchanged challenge</summary>${jsonView(c.challenge)}</details>`;
  }else{
    const rows=await list(`/api/captures/${id}/rows`,key);
    body+=section("Source analysis",keyValues(c.analysis||{}))+listControls(key,rows,{kindOptions:rowKinds,placeholder:"Search entities and original values"})+rowsTable(rows,{captureId:id});
  }
  if(c.originalOutcome||c.originalQueue)body+=`<details><summary>Original buyer outcome and inbox record</summary>${jsonView({originalOutcome:c.originalOutcome,originalQueue:c.originalQueue})}</details>`;
  const actions=(c.kind==="challenge"?button("Extract vendor example","sample",id):button("Add to snapshot","snapshot-one",id))+button("Add research note","new-note",id,`data-target-type="capture"`);
  detailModal(c.name,body,actions,{back,refresh:()=>captureDetail(id)});
  S.modal.captureId=id;
}
async function rowDetail(captureId,id,{back=true}={}){
  const d=await get(`/api/captures/${captureId}/rows/${encodeURIComponent(id)}`),r=d.row;
  const fields=x=>dataTable(["Field","Exact original value","Source pointer"],(x.fields||[]).map(f=>[h(f.label||f.key),`<span class="exact">${h(valueText(f.value))}</span>`,`<code>${h(f.sourcePointer)}</code>`]));
  let body=keyValues({"Kind":r.kind,"Entity identity":r.identity,"Original source pointer":r.sourcePointer,"Capture":r.sourceCaptureId})+fields(r);
  if(r.notices?.length)body+=note(r.notices.map(x=>typeof x==="string"?x:JSON.stringify(x)).join("\n"));
  if(r.relations?.length){
    const relationRows=r.relations.map(x=>[h(x.name),h(x.type),h(x.id),h(x.resolved?"Original included entity":"Not included in this source")]);
    body+=section("Provider entity relations",dataTable(["Relation","Provider type","Provider ID","Resolution"],relationRows));
  }
  if(d.linkedEntities?.length){
    body+=section("Included entities",d.linkedEntities.map(x=>`<article class="included-entity"><h3>${h(x.name||x.identity?.providerId||x.id)}</h3>${keyValues(x.identity||{})}${fields(x)}</article>`).join(""));
  }
  detailModal(r.name||r.key,body,button("Add research note","new-note",id,`data-target-type="row"`)+button("Open original capture","capture",captureId),{back});
}
function sampleForm(captureId){
  openForm({title:"Retain the provider’s original example",intro:"This extracts the exact Bazaar output.example from the retained vendor challenge. The result is labeled as a provider example throughout the workspace.",fields:[{name:"name",label:"Example name",required:true,wide:true}],initial:{name:"Original provider example"},save:(v,op)=>mutation(`/api/projects/${S.projectId}/samples`,{captureId,...v},{operation:op}),after:c=>captureDetail(c.id),submitLabel:"Extract original example"});
}



function jobActions(job){
  let html=button("Refresh operation","job",job.id);
  if(job.canExecute===true)html+=button("Execute prepared purchase","job-execute",job.id,'class="primary"');
  if(job.canCancel===true)html+=button("Cancel remaining work","job-cancel",job.id);
  if(job.canResume===true)html+=button("Resume remaining work","job-resume",job.id);
  if(job.canRecover===true)html+=button("Recover original results","job-recover",job.id);
  return html;
}
async function jobDetail(id,{back=false,poll=false}={}){
  const previousScroll=$("#dialog .dialog-content")?.scrollTop||0;
  const d=await get("/api/jobs/"+id),j=d.job;
  if(poll&&S.modal?.job?.id!==id)return;
  const outcomes=j.items||[],progress=`${j.completed??0} of ${j.total??outcomes.length}`;
  const itemRows=outcomes.map((item,i)=>[
    String(i+1),
    `<strong>${h(item.requestId)}</strong><small>Version ${h(item.requestVersion)}</small><small>${h(item.requestUrl)}</small>`,
    badge(item.status),
    item.terms?`<code>${h(item.terms.amount)}</code><small>${h(item.terms.asset)} · ${h(item.terms.network)}</small>`:"—",
    item.intentId?`<code>${h(item.intentId)}</code>`:"—",
    item.error?`<span class="error-text">${h(item.error.message||item.error.code||valueText(item.error))}</span>`:h(item.originalQueue?.outcome?.buyerStatus||item.originalQueue?.state||""),
    item.resultCaptureId?button("Open result","capture",item.resultCaptureId,`data-back="1"`):item.captureId?button("Original challenge","capture",item.captureId,`data-back="1"`):""
  ]);
  let body=`<div class="detail-intro">${badge(j.kind)}${badge(j.status)}<span>${h(progress)}</span></div>`;
  body+=keyValues({"Operation ID":j.id,"Prepared":displayDate(j.createdAt),"Started":displayDate(j.startedAt),"Completed":displayDate(j.completedAt),"Current version":j.version});
  if(j.kind==="checkout")body+=note("The native inbox keeps each exact request and its permanent attempt identity. Execution, payment outcome and response delivery are shown from their original records. Recovery inspects those saved results.");
  if(j.errors?.length)body+=section("Recorded operation errors",`<ul>${j.errors.map(e=>`<li>${h(e.message||e.code||valueText(e))}</li>`).join("")}</ul>`);
  body+=dataTable(["Order","Request","Item state","Selected terms","Original intent","Original outcome / error",""],itemRows);
  body+=`<details><summary>Complete native operation record</summary>${jsonView(j)}</details>`;
  detailModal(j.name,body,jobActions(j),{back,refresh:()=>jobDetail(id),focus:!poll});
  if(poll)$("#dialog .dialog-content").scrollTop=previousScroll;
  S.modal.job=j;
  const active=["queued","running"].includes(j.status);
  if(active){S.jobTimer=setTimeout(async()=>{if(S.modal?.job?.id!==id)return;if(S.busy){S.jobTimer=setTimeout(()=>jobDetail(id,{poll:true}).catch(showError),2500);return}try{await jobDetail(id,{poll:true})}catch(e){if(S.modal?.job?.id===id)toast("Operation refresh: "+e.message,true)}},2500)}
}
async function jobAction(action,id){
  if(S.busy)return;
  const j=S.modal?.job?.id===id?S.modal.job:(await get("/api/jobs/"+id)).job;
  const capability={execute:"canExecute",cancel:"canCancel",resume:"canResume",recover:"canRecover"}[action];
  if(j[capability]!==true)throw new Error("This action is unavailable in the current original operation. Refresh it to inspect the latest state.");
  S.jobOperations||=new Map();const key=id+":"+action,op=S.jobOperations.get(key)||{id:crypto.randomUUID()};S.jobOperations.set(key,op);
  setFormBusy(true);
  try{
    await mutation(`/api/jobs/${id}/${action}`,{version:j.version},{operation:op});
    S.jobOperations.delete(key);await loadProject();await jobDetail(id);toast(action==="recover"?"Original operation results recovered.":"Operation updated.");
  }catch(e){
    if(!e.uncertain)S.jobOperations.delete(key);
    if(e.status===409){await jobDetail(id);toast("The operation advanced. Its current original state is now displayed; review the available action.",true)}
    else{toast(e.message+(e.uncertain?" The same saved operation will be used when you retry this action.":""),true)}
  }finally{setFormBusy(false)}
}



async function researchView(){
  const pane=S.panes.research||"snapshots",data=await list(`/api/projects/${S.projectId}/${pane}`,"research-"+pane);
  const top=subnav("research",[["snapshots","Snapshots"],["comparisons","Comparisons"],["notes","Research notes"]]);
  if(pane==="snapshots"){
    const rows=data.items.map(s=>[h(s.name),String(s.captureIds?.length??s.captureCount??0),h(displayDate(s.createdAt)),button("Open snapshot","snapshot",s.id)]);
    return top+section("Frozen source collections",`<p class="muted">Each snapshot retains its selected response captures and original source identities.</p><div class="actions">${button("Create snapshot","new-snapshot")}</div>`+listControls("research-snapshots",data)+dataTable(["Snapshot","Responses","Saved",""],rows));
  }
  if(pane==="comparisons"){
    const rows=data.items.map(c=>[h(c.name),`${c.summary?.changed??0} changed · ${c.summary?.new??0} new · ${c.summary?.resolved??0} removed`,h(displayDate(c.createdAt)),button("Inspect comparison","comparison",c.id)]);
    return top+section("Exact source comparisons",`<p class="muted">Numeric deltas use exact decimal arithmetic. Missing values, source lexical changes, market cap and FDV remain distinct.</p><div class="actions">${button("Compare snapshots","new-comparison")}</div>`+listControls("research-comparisons",data)+dataTable(["Comparison","Result","Created",""],rows));
  }
  const rows=data.items.map(n=>[`<strong>${h(n.title)}</strong><small>${h(n.type)}</small>`,`${h(n.targetType)}<small>${h(n.targetId)}</small>`,h(n.assignee||"Unassigned"),badge(n.status),button("Open note","note",n.id)]);
  return top+section("Research and data quality work",`<div class="actions">${button("New note","new-note")}</div>`+listControls("research-notes",data,{statusOptions:["open","reviewed","resolved"]})+dataTable(["Note","Source target","Assignee","Status",""],rows));
}
async function snapshotForm(captureIds){
  const [captures,collections]=await Promise.all([allItems("captures"),allItems("collections")]);
  const responses=captures.filter(c=>c.kind==="response");
  openForm({title:"Freeze a source snapshot",intro:"Select one response for each request. Earlier sources and their vendor-example or native-response basis remain visible in the snapshot.",fields:[
    {name:"name",label:"Snapshot name",required:true,wide:true},
    {name:"collectionId",label:"Collection context",type:"select",options:[["","No collection context"],...collections.map(c=>[c.id,c.name])],wide:true},
    {name:"captureIds",label:"Original response captures",type:"multiselect",required:true,options:responses.map(c=>[c.id,`${c.name} · ${endpointName(c.endpoint)} · ${c.basis} · ${displayDate(c.observedAt)}`]),wide:true}
  ],initial:{name:"",collectionId:"",captureIds:captureIds||[...S.picked.captures]},save:(v,op)=>{
    const requests=v.captureIds.map(id=>responses.find(c=>c.id===id)?.requestId);
    if(new Set(requests).size!==requests.length)throw new Error("A snapshot can select only one response for each saved request. Choose the desired version of each source.");
    return mutation(`/api/projects/${S.projectId}/snapshots`,{name:v.name,captureIds:v.captureIds,...(v.collectionId?{collectionId:v.collectionId}:{})},{operation:op});
  },after:s=>snapshotDetail(s.id),submitLabel:"Create frozen snapshot"});
}
async function snapshotDetail(id,{back=false}={}){
  const d=await get("/api/snapshots/"+id),s=d.snapshot,key="snapshot-rows-"+id;
  const rows=await list(`/api/snapshots/${id}/rows`,key);
  let body=keyValues({"Snapshot ID":s.id,"Saved":displayDate(s.createdAt),"Original responses":s.captureIds.length,"Collection":s.collectionId||"None"});
  body+=section("Frozen sources",dataTable(["Original capture","Basis","Observed",""],(d.captures||[]).map(c=>[h(c.name),h(c.basis),h(displayDate(c.observedAt)),button("Inspect source","capture",c.id,`data-back="1"`)])));
  body+=listControls(key,rows,{kindOptions:rowKinds,placeholder:"Search the frozen source collection"})+rowsTable(rows,{snapshotId:id});
  detailModal(s.name,body,download(`/api/snapshots/${id}/download`,"Download complete snapshot")+button("Compare this snapshot","compare-from",id)+button("Add research note","new-note",id,`data-target-type="snapshot"`),{back,refresh:()=>snapshotDetail(id)});
  S.modal.snapshotId=id;
}
async function comparisonForm(baselineId){
  const snapshots=await allItems("snapshots");
  if(snapshots.length<2)throw new Error("Save two snapshots before preparing a source comparison.");
  const options=snapshots.map(s=>[s.id,`${s.name} · ${displayDate(s.createdAt)}`]);
  openForm({title:"Compare frozen snapshots",intro:"Compare the saved entity identities and original fields. The comparison preserves both source rows and computes decimal changes without rounding their values.",fields:[
    {name:"name",label:"Comparison name",required:true,wide:true},
    {name:"baselineId",label:"Baseline snapshot",type:"select",required:true,options},
    {name:"currentId",label:"Current snapshot",type:"select",required:true,options}
  ],initial:{name:"",baselineId:baselineId||snapshots[1]?.id,currentId:snapshots[0]?.id},save:(v,op)=>{if(v.baselineId===v.currentId)throw new Error("Choose two different snapshots.");return mutation(`/api/projects/${S.projectId}/comparisons`,v,{operation:op})},after:c=>comparisonDetail(c.id),submitLabel:"Create comparison"});
}
async function comparisonDetail(id,{back=false}={}){
  const d=await get("/api/comparisons/"+id),c=d.comparison,key="comparison-rows-"+id;
  const rows=await list(`/api/comparisons/${id}/rows`,key);
  const rendered=rows.items.map(r=>[
    `<strong>${h(r.currentRow?.name||r.baselineRow?.name||r.key)}</strong><small>${h(identityText(r))}</small>`,
    badge(r.status),
    (r.fields||[]).filter(f=>f.change!=="same"||f.wireChanged).slice(0,4).map(f=>`<small>${h(f.label||f.key)}: ${h(valueText(f.before))} → ${h(valueText(f.after))}${f.decimalDelta!=null?` · Δ ${h(f.decimalDelta)}`:""}${f.wireChanged?" · source representation changed":""}</small>`).join("")||"Original fields unchanged",
    button("Inspect both sources","comparison-row",r.id,`data-comparison-id="${attr(id)}"`)
  ]);
  const body=keyValues({"Comparison":c.id,"Baseline snapshot":c.baselineId,"Current snapshot":c.currentId,"Saved":displayDate(c.createdAt)})+
    `<div class="metrics compact">${Object.entries(c.summary||{}).map(([label,n])=>`<div><strong>${h(n)}</strong><span>${h(label)}</span></div>`).join("")}</div>`+
    listControls(key,rows,{kindOptions:rowKinds,statusOptions:["new","resolved","changed","unchanged"],placeholder:"Search exact source changes"})+dataTable(["Entity","Result","Field changes",""],rendered);
  detailModal(c.name,body,download(`/api/comparisons/${id}/download`,"Download full comparison")+button("Add research note","new-note",id,`data-target-type="comparison"`),{back,refresh:()=>comparisonDetail(id)});
  S.modal.comparisonId=id;S.modal.comparisonRows=new Map(rows.items.map(r=>[r.id,r]));
}
function comparisonRowDetail(comparisonId,id){
  const r=S.modal?.comparisonRows?.get(id);if(!r)throw new Error("Refresh the comparison and open the current row.");
  const cells=(r.fields||[]).map(f=>[h(f.label||f.key),h(valueText(f.before)),h(valueText(f.after)),h(f.change),f.decimalDelta==null?"—":`<code>${h(f.decimalDelta)}</code>`,h(f.wireChanged?"Changed":"Same")]);
  const body=keyValues({"Identity":r.identity,"Comparison result":r.status})+dataTable(["Field","Baseline","Current","Change","Exact decimal delta","Source representation"],cells)+`<details><summary>Complete original source rows</summary>${jsonView({baseline:r.baselineRow,current:r.currentRow})}</details>`;
  const actions=(r.baselineRow?button("Baseline original row","row",r.baselineRow.id,`data-capture-id="${attr(r.baselineRow.sourceCaptureId)}"`):"")+(r.currentRow?button("Current original row","row",r.currentRow.id,`data-capture-id="${attr(r.currentRow.sourceCaptureId)}"`):"");
  detailModal(r.currentRow?.name||r.baselineRow?.name||r.key,body,actions,{back:true});
}



const noteWritable=n=>({targetType:n.targetType,targetId:n.targetId,title:n.title,text:n.text||"",assignee:n.assignee||"",status:n.status||"open",type:n.type||"research",sourceFileIds:[...(n.sourceFileIds||[])]});
async function noteForm({id,targetId="",targetType="request"}={}){
  const files=await allItems("files"),record=id?(await get("/api/notes/"+id)).note:null;
  const initial=record?noteWritable(record):{targetType,targetId,title:"",text:"",assignee:S.actor,status:"open",type:"research",sourceFileIds:[]};
  const fields=[
    {name:"title",label:"Note title",required:true,wide:true},
    {name:"targetType",label:"Source type",type:"select",required:true,options:["request","capture","row","snapshot","comparison"]},
    {name:"targetId",label:"Original source identity",required:true},
    {name:"type",label:"Work type",type:"select",options:[["research","Research"],["data_quality","Data quality"],["follow_up","Follow-up"]]},
    {name:"status",label:"Status",type:"select",options:[["open","Open"],["reviewed","Reviewed"],["resolved","Resolved"]]},
    {name:"assignee",label:"Assignee",wide:true},
    {name:"text",label:"Research, findings and actions",type:"textarea",rows:12,required:true,wide:true},
    {name:"sourceFileIds",label:"Original supporting files",type:"multiselect",options:files.map(f=>[f.id,f.name+" · "+bytes(f.bytes)]),wide:true}
  ];
  openForm({title:record?"Edit research note":"Create research note",fields,initial,save:(v,op)=>mutation(record?"/api/notes/"+id:`/api/projects/${S.projectId}/notes`,{...(record?{version:S.modal.currentVersion??record.version}:{}),note:v},{operation:op}),latest:record?async()=>{const n=(await get("/api/notes/"+id)).note;return {value:noteWritable(n),version:n.version}}:async()=>({value:initial}),after:n=>noteDetail(n.id)});
}
async function noteDetail(id,{back=false}={}){
  const n=(await get("/api/notes/"+id)).note;
  const files=await Promise.all((n.sourceFileIds||[]).map(async fileId=>(await get("/api/files/"+fileId)).file));
  const body=`<div class="detail-intro">${badge(n.type)}${badge(n.status)}<span>${h(n.assignee||"Unassigned")}</span></div>`+
    keyValues({"Source type":n.targetType,"Original source identity":n.targetId,"Note ID":n.id,"Version":n.version,"Last updated":displayDate(n.updatedAt)})+
    `<article class="prose note-text">${h(n.text)}</article>`+
    (files.length?section("Original supporting files",dataTable(["File","Bytes","SHA-256",""],files.map(f=>[h(f.name),bytes(f.bytes),`<code>${h(f.sha256)}</code>`,download(`/api/files/${f.id}/download`)]))):"");
  const targetActions={request:"request",capture:"capture",snapshot:"snapshot",comparison:"comparison"};
  detailModal(n.title,body,button("Edit note","edit-note",id)+(targetActions[n.targetType]?button("Open source",targetActions[n.targetType],n.targetId,`data-back="1"`):""),{back});
}
async function historyView(){
  const data=await list(`/api/projects/${S.projectId}/events`,"history");
  S.historyRows=new Map(data.items.map((event,index)=>[String(event.id??event.sequence??index),event]));
  const rows=data.items.map((e,i)=>[h(displayDate(e.createdAt||e.at)),h(e.actor||e.operator||"Native worker"),h(e.type||e.action||e.kind),`<code>${h(e.objectId||e.entityId||e.opId||"")}</code>`,button("Inspect history","event",String(e.id??e.sequence??i))]);
  return section("Project operating history",listControls("history",data,{placeholder:"Search operator, event or original operation identity"})+dataTable(["Recorded","Operator","Action","Identity",""],rows));
}



async function providerView(){
  const data=await list(`/api/projects/${S.projectId}/provider-plans`,"provider");
  const rows=data.items.map(p=>[h(p.name),`<small>${h(p.publicOrigin)}${h(p.pathPrefix)}</small>`,String(p.endpointIds?.length??0),String(p.accepts?.length??0),button("Inspect deployment","provider-plan",p.id)]);
  return section("Provider-operated Stellar deployments",`<p>Create a deployable configuration for the provider’s additional Stellar routes. Each plan uses the original seller importer, server and payment requirements.</p><div class="actions">${button("New provider plan","new-provider")}</div>`+listControls("provider",data)+dataTable(["Plan","Public resource prefix","Families","Default payment options",""],rows));
}
const providerWritable=p=>({name:p.name,publicOrigin:p.publicOrigin,pathPrefix:p.pathPrefix||"/api/v3/stellar",endpointIds:[...(p.endpointIds||[])],accepts:clone(p.accepts||[]),endpointAccepts:clone(p.endpointAccepts||{}),upstream:clone(p.upstream||{origin:"",basePath:"",apiKeyEnv:""})});
function providerFlat(p){return {name:p.name,publicOrigin:p.publicOrigin,pathPrefix:p.pathPrefix,endpointIds:p.endpointIds,endpointAccepts:p.endpointAccepts||{},upstreamOrigin:p.upstream?.origin||"",upstreamBasePath:p.upstream?.basePath||"",apiKeyEnv:p.upstream?.apiKeyEnv||""}}
async function providerForm(id){
  const record=id?(await get("/api/provider-plans/"+id)).plan:null;
  const initial=record?providerWritable(record):{name:"",publicOrigin:S.project.config?.merchantOrigin||"",pathPrefix:S.project.config?.merchantPrefix||"/api/v3/stellar",endpointIds:S.state.contracts.map(e=>e.id),accepts:[],endpointAccepts:{},upstream:{origin:"",basePath:"",apiKeyEnv:""}};
  let terms=clone(initial.accepts),version=record?.version;
  const known=["scheme","network","asset","amount","payTo","maxTimeoutSeconds"];
  const fields=[
    {name:"name",label:"Provider plan name",required:true,wide:true},
    {name:"publicOrigin",label:"Public merchant origin",type:"url",required:true,wide:true},
    {name:"pathPrefix",label:"Stellar route prefix",required:true,wide:true},
    {name:"endpointIds",label:"Endpoint families",type:"multiselect",required:true,options:S.state.contracts.map(e=>[e.id,e.name]),wide:true},
    {name:"upstreamOrigin",label:"Licensed upstream origin, if used",type:"url",wide:true,help:"A provider may instead supply its own native data callback when starting the service."},
    {name:"upstreamBasePath",label:"Licensed upstream API prefix"},
    {name:"apiKeyEnv",label:"Upstream key environment variable",pattern:"[A-Za-z_][A-Za-z0-9_]*",help:"Environment variable name only; the key stays in the provider’s runtime."},
    {name:"endpointAccepts",label:"Per-family payment overrides",type:"json",rows:6,wide:true,help:"Optional object keyed by endpoint family, containing complete ordered payment option arrays. Empty object uses the defaults below."}
  ];
  function renderTerms(){
    $("#payment-terms").innerHTML=terms.length?terms.map((t,i)=>{
      const extras=Object.fromEntries(Object.entries(t).filter(([k])=>!known.includes(k)));
      const control=(key,label,{required=true,type="text",pattern}={})=>`<label class="field"><span>${h(label)}</span><input data-term-field="${key}" type="${type}" value="${attr(t[key]??"")}" ${required?"required":""}${pattern?` pattern="${attr(pattern)}"`:""}></label>`;
      return `<article class="payment-option" data-term-index="${i}"><div class="section-head"><h3>Payment option ${i+1}</h3><div class="actions">${button("Up","term-up",String(i),i===0?"disabled":"")}${button("Down","term-down",String(i),i===terms.length-1?"disabled":"")}${button("Remove","term-remove",String(i))}</div></div><div class="form-grid">${control("scheme","Scheme")}${control("network","Stellar payment network")}${control("asset","Asset")}${control("amount","Atomic amount",{pattern:"[0-9]+"})}${control("payTo","Payment recipient")}${control("maxTimeoutSeconds","Timeout in seconds",{required:false,type:"number"})}<label class="field wide"><span>Additional original option fields</span><textarea data-term-extra rows="4" class="code" spellcheck="false">${h(JSON.stringify(extras,null,2))}</textarea></label></div></article>`;
    }).join(""):empty("No default payment options","Add the provider’s actual Stellar requirements or define explicit options for every selected endpoint.");
  }
  function readTerms(){
    return $$("[data-term-index]",$("#dialog")).map(card=>{
      let t;try{t=JSON.parse($("[data-term-extra]",card).value||"{}")}catch{throw new Error("Additional payment fields must contain valid JSON.")}
      if(!t||typeof t!=="object"||Array.isArray(t))throw new Error("Additional payment fields must be an object.");
      if(known.some(k=>Object.hasOwn(t,k)))throw new Error("Edit the named payment fields in their controls.");
      for(const input of $$("[data-term-field]",card)){
        const key=input.dataset.termField,v=input.value;
        if(key==="maxTimeoutSeconds"){if(v!=="")t[key]=Number(v)}
        else t[key]=v;
      }
      return t;
    });
  }
  const read=v=>({name:v.name,publicOrigin:v.publicOrigin,pathPrefix:v.pathPrefix,endpointIds:v.endpointIds,accepts:readTerms(),endpointAccepts:v.endpointAccepts||{},upstream:{origin:v.upstreamOrigin,basePath:v.upstreamBasePath,apiKeyEnv:v.apiKeyEnv}});
  openForm({title:record?"Edit provider deployment":"Create provider deployment",fields,initial:providerFlat(initial),intro:"Preserve each payment option’s network, asset, recipient and atomic amount. Per-family overrides remain complete original option arrays.",extra:`<section class="terms-editor"><div class="section-head"><h3>Default payment options in advertised order</h3>${button("Add payment option","term-add")}</div><div id="payment-terms"></div></section>`,read,apply:v=>{setFormValues(fields,providerFlat(v));terms=clone(v.accepts);version=S.modal.currentVersion??version;renderTerms()},save:(v,op)=>mutation(record?"/api/provider-plans/"+id:`/api/projects/${S.projectId}/provider-plans`,{...(record?{version:S.modal.currentVersion??version}:{}),plan:v},{operation:op}),latest:record?async()=>{const p=(await get("/api/provider-plans/"+id)).plan;return{value:providerWritable(p),version:p.version}}:async()=>({value:initial}),after:p=>providerDetail(p.id),onMount:()=>{
    renderTerms();S.modal.baseline=clone(initial);
    S.modal.termCommand=(action,index)=>{
      terms=readTerms();const i=Number(index);
      if(action==="term-add")terms.push({scheme:"exact",network:"stellar:testnet",asset:"",amount:"",payTo:"",maxTimeoutSeconds:60});
      else if(action==="term-remove")terms.splice(i,1);
      else{const j=i+(action==="term-up"?-1:1);if(j>=0&&j<terms.length)[terms[i],terms[j]]=[terms[j],terms[i]]}
      renderTerms();S.modal.dirty=true;
    };
  }});
  S.modal.baseline=clone(initial);
}
async function providerDetail(id,{back=false}={}){
  const d=await get("/api/provider-plans/"+id),p=d.plan,c=d.compiled||{};
  const operations=[];
  for(const [route,methods]of Object.entries(c.spec?.paths||{}))for(const[method,definition]of Object.entries(methods))if(["get","post","put","patch","delete","head"].includes(method))operations.push([h(method.toUpperCase()),`<code>${h(route)}</code>`,h(definition.operationId||definition.summary||"")]);
  let body=keyValues({"Provider plan":p.id,"Version":p.version,"Public origin":p.publicOrigin,"Stellar route prefix":p.pathPrefix,"Selected endpoint families":p.endpointIds,"Licensed upstream":p.upstream?.origin||"Provider native data callback","Key environment variable":p.upstream?.apiKeyEnv||"None"});
  body+=section("Compiled native routes",dataTable(["Method","Route","Operation"],operations,"The compiled route details are retained in the deployment object."));
  body+=section("Default original payment options",jsonView(p.accepts));
  if(Object.keys(p.endpointAccepts||{}).length)body+=section("Per-family original options",jsonView(p.endpointAccepts));
  body+=`<details><summary>Complete compiled OpenAPI and native deployment</summary>${jsonView(c)}</details>`;
  detailModal(p.name,body,button("Edit provider plan","edit-provider",id)+download(`/api/provider-plans/${id}/download`,"Download complete deployment")+button("Use in project configuration","use-provider",id),{back});
  S.modal.provider=p;
}



async function handoverView(){
  const data=await list(`/api/projects/${S.projectId}/exports`,"handover");
  const rows=data.items.map(e=>[
    `<strong>${h(e.name)}</strong><small>${h(displayDate(e.createdAt))}</small>`,
    bytes(e.bytes),`<code>${h(e.sha256)}</code>`,
    e.available===false?badge("Historical archive metadata"):download(`/api/exports/${e.id}/download`,"Download complete archive"),
    button("Inspect handover","export",e.id)
  ]);
  return section("Complete project handover",`<p>Package the original files, request definitions, captures, frozen research, provider plans, notes and operating history together. A restored project receives its own identities and keeps its original source mappings.</p><div class="actions">${button("Create complete archive","new-export")}${button("Restore an archive","restore")}</div>`+listControls("handover",data)+dataTable(["Handover","Archive bytes","Original SHA-256","Availability",""],rows))+
    section("Operating sequence",`<ol class="operating-sequence"><li><strong>Review the sources.</strong> Open the retained response and challenge files, inspect entity identities and complete any research notes.</li><li><strong>Freeze the intended collection.</strong> Save the selected response captures as a snapshot and retain a comparison when changes matter.</li><li><strong>Export the project.</strong> Download the complete archive and keep its original hash alongside the provider deployment and installed product.</li><li><strong>Reopen it.</strong> Restore the archive as a separate project, inspect its source mapping, and bind an existing buyer profile when preparing future work.</li></ol>`);
}
async function exportForm(){
  const [snapshots,comparisons]=await Promise.all([allItems("snapshots"),allItems("comparisons")]);
  openForm({title:"Create complete project archive",intro:"The archive includes the original project records and files. Selected research views identify the handover’s focus while the full project history remains included.",fields:[
    {name:"name",label:"Handover name",required:true,wide:true},
    {name:"snapshotId",label:"Highlighted snapshot",type:"select",options:[["","No highlighted snapshot"],...snapshots.map(s=>[s.id,s.name])],wide:true},
    {name:"comparisonId",label:"Highlighted comparison",type:"select",options:[["","No highlighted comparison"],...comparisons.map(c=>[c.id,c.name])],wide:true}
  ],initial:{name:S.project.name+" · complete handover"},save:(v,op)=>mutation(`/api/projects/${S.projectId}/exports`,{name:v.name,...(v.snapshotId?{snapshotId:v.snapshotId}:{}),...(v.comparisonId?{comparisonId:v.comparisonId}:{})},{operation:op}),after:e=>exportDetail(e.id,{record:e}),submitLabel:"Create complete archive"});
}
async function exportDetail(id,{record,back=false}={}){
  const e=record||(await allItems("exports")).find(x=>x.id===id);if(!e)throw new Error("This archive record is not in the current project.");
  let body=keyValues({"Handover ID":e.id,"Created":displayDate(e.createdAt),"Archive bytes":e.bytes,"Original SHA-256":e.sha256,"Snapshot":e.snapshotId||"None highlighted","Comparison":e.comparisonId||"None highlighted","Archive available":e.available===false?"Historical metadata retained":"Yes"});
  if(e.available===false)body+=note("This earlier archive is recorded in the restored history. Create a new complete archive from the current project when another downloadable handover is needed.");
  body+=`<details><summary>Complete handover record</summary>${jsonView(e)}</details>`;
  detailModal(e.name,body,e.available===false?button("Create current archive","new-export"):download(`/api/exports/${id}/download`,"Download complete archive"),{back});
}
function restoreForm(){
  openForm({title:"Restore a complete project",intro:"Open the saved archive as a separate project. The restored source mappings and native attempt history remain available for inspection.",fields:[
    {name:"name",label:"Restored project name",required:true,wide:true},
    {name:"sourceFile",label:"Original complete gzip archive",type:"file",accept:".gz,.gzip,application/gzip",required:true,wide:true}
  ],initial:{name:"Restored market operations"},save:async(v,op)=>mutation("/api/restore",{name:v.name,contentBase64:await fileBase64(v.sourceFile,{limit:S.state.limits?.restoreBytes||67108864})},{operation:op,project:false}),after:async r=>{
    await selectProject(r.project.id);
    detailModal("Project restored",keyValues({"Restored project":r.project.name,"New project identity":r.project.id})+section("Original source mappings",jsonView(r.mapping)),button("Open restored sources","nav","sources")+button("Open project handover","nav","handover"));
  },submitLabel:"Restore separate project"});
}



async function refreshSurface(){
  const focused=document.activeElement?.dataset.search,position=document.activeElement?.selectionStart;
  if(S.modal?.refresh&&!S.modal.isForm)await S.modal.refresh();else await renderView();
  if(focused){const el=$(`[data-search="${CSS.escape(focused)}"]`);if(el){el.focus();el.setSelectionRange(position,position)}}
}
async function runAction(action,id,el){
  const back=el?.dataset.back==="1";
  if(action==="nav"){closeModal();if(S.modal)return;S.tab=id;await renderView();return}
  if(action==="pane"){S.panes[el.dataset.group]=id;await renderView();return}
  if(action==="refresh"){await refreshCurrent();return}
  if(action==="new-project"){projectForm();return}
  if(action==="config"){configForm();return}
  if(action==="close-dialog"){closeModal();return}
  if(action==="dialog-back"){
    clearTimeout(S.jobTimer);
    const prior=S.modalStack.pop();if(!prior){closeModal();return}
    S.modal=prior;if(prior.refresh)await prior.refresh();else $("#dialog").innerHTML=dialogShell(prior.title,prior.body,prior.footer);return;
  }
  if(action==="apply-merge"){applyMerge();return}
  if(action==="page"){
    const t=tableState(id);t.offset=Math.max(0,t.offset+Number(el.dataset.direction)*t.limit);
    await refreshSurface();return;
  }
  if(action==="clear-picks"){S.picked[id].clear();await renderView();return}
  if(action==="new-request"){await requestForm(null,id||undefined);return}
  if(action==="edit-request"){await requestForm(id);return}
  if(action==="request"){await requestDetail(id,{back});return}
  if(action==="new-collection"){await collectionForm();return}
  if(action==="edit-collection"){await collectionForm(id);return}
  if(action==="collection"){await collectionDetail(id,{back});return}
  if(action==="import-collection"){await importCollectionForm();return}
  if(action.startsWith("order-")){S.modal?.orderCommand?.(action,id);return}
  if(action==="checkout"){await checkoutForm(id);return}
  if(action==="checkout-source"){S.modal?.checkoutSource?.(id);return}
  if(action==="probe"){await probeForm();return}
  if(action==="probe-one"){await probeForm({requestIds:[id]});return}
  if(action==="probe-collection"){await probeForm({collectionId:id});return}
  if(action==="import-response"){await importResponseForm(id);return}
  if(action==="capture"){await captureDetail(id,{back});return}
  if(action==="row"){await rowDetail(el.dataset.captureId,id,{back:true});return}
  if(action==="sample"){sampleForm(id);return}
  if(action==="job"){await jobDetail(id,{back});return}
  if(action.startsWith("job-")){await jobAction(action.slice(4),id);return}
  if(action==="new-snapshot"){await snapshotForm();return}
  if(action==="snapshot-one"){await snapshotForm([id]);return}
  if(action==="snapshot"){await snapshotDetail(id,{back});return}
  if(action==="new-comparison"){await comparisonForm();return}
  if(action==="compare-from"){await comparisonForm(id);return}
  if(action==="comparison"){await comparisonDetail(id,{back});return}
  if(action==="comparison-row"){comparisonRowDetail(el.dataset.comparisonId,id);return}
  if(action==="new-note"){await noteForm({targetId:id||"",targetType:el.dataset.targetType||"request"});return}
  if(action==="edit-note"){await noteForm({id});return}
  if(action==="note"){await noteDetail(id,{back});return}
  if(action==="event"){const e=S.historyRows?.get(id);if(e)detailModal("Original operating event",jsonView(e));return}
  if(action==="new-provider"){await providerForm();return}
  if(action==="edit-provider"){await providerForm(id);return}
  if(action==="provider-plan"){await providerDetail(id,{back});return}
  if(action.startsWith("term-")){S.modal?.termCommand?.(action,id);return}
  if(action==="use-provider"){const p=S.modal?.provider||(await get("/api/provider-plans/"+id)).plan;configForm({merchantOrigin:p.publicOrigin,merchantPrefix:p.pathPrefix});return}
  if(action==="new-export"){await exportForm();return}
  if(action==="export"){await exportDetail(id,{back});return}
  if(action==="restore"){restoreForm();return}
}
document.addEventListener("click",event=>{
  const el=event.target.closest("[data-action]");if(!el||el.disabled||S.busy||S.actionBusy)return;
  event.preventDefault();S.actionBusy=true;
  Promise.resolve(runAction(el.dataset.action,el.dataset.id||"",el)).catch(showError).finally(()=>S.actionBusy=false);
});
document.addEventListener("submit",event=>{if(event.target.id==="editor"){event.preventDefault();submitEditor().catch(showError)}});
document.addEventListener("input",event=>{
  const target=event.target;
  if(target.closest("#editor")&&S.modal?.isForm)S.modal.dirty=true;
  if(target.dataset.search){
    const t=tableState(target.dataset.search);t.q=target.value;t.offset=0;
    clearTimeout(S.searchTimer);S.searchTimer=setTimeout(()=>refreshSurface().catch(showError),320);
  }
});
document.addEventListener("change",event=>{
  const target=event.target;
  if(target.closest("#editor")&&S.modal?.isForm)S.modal.dirty=true;
  if(target.dataset.filter){const t=tableState(target.dataset.key);t[target.dataset.filter]=target.value;t.offset=0;refreshSurface().catch(showError)}
  if(target.dataset.pick){
    const name=target.dataset.pick,id=target.dataset.id;
    if(target.checked)S.picked[name].add(id);else S.picked[name].delete(id);
    const selector=name==="requests"?'#main [data-action="new-collection"]':'#main [data-action="new-snapshot"]';
    const b=$(selector);if(b)b.textContent=name==="requests"?`Create collection (${S.picked[name].size})`:`Snapshot selected (${S.picked[name].size})`;
  }
});
$("#project-select").addEventListener("change",event=>selectProject(event.target.value).catch(showError));
$("#operator-name").addEventListener("change",event=>{S.actor=event.target.value.trim();localStorage.setItem("cg-market-operator",S.actor)});
$("#dialog").addEventListener("cancel",event=>{event.preventDefault();closeModal()});
window.addEventListener("beforeunload",event=>{if(S.busy||S.modal?.isForm&&S.modal.dirty){event.preventDefault();event.returnValue=""}});
await refreshState();
if(S.projectId&&!S.state.projects.some(p=>p.id===S.projectId))S.projectId="";
if(!S.projectId&&S.state.projects.length===1)S.projectId=S.state.projects[0].id;
if(S.projectId)await loadProject();
await renderView();

}
runMarketWorkspace().catch(error=>{const main=document.querySelector('#main');main.textContent='The workspace could not open: '+(error.message||String(error));console.error(error);});
