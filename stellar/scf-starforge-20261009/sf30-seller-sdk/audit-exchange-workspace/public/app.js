import {mountCorrectionDesk} from "/corrections.js";
import {AuditExchangeClient, AuditExchangeError, auditRequestId, auditFileBase64, auditSha256} from "/client.mjs";

const $=id=>document.getElementById(id);
const all=(selector,root=document)=>Array.from(root.querySelectorAll(selector));
const S={
  client:null,state:null,busy:false,section:"overview",inspector:"entities",detail:null,
  activeEntity:null,activeField:null,patches:[],edition:null,comparison:null,
  analysisPreview:null,analysisInput:null,projectionPreview:null,projectionInput:null,
  importFile:null,replaceFile:null,weatherFile:null,receiveFile:null,pending:null,
  draftTimer:null,draftSnapshot:null,draftError:null,tables:new Map(),database:null,dirtyForms:new Set(),
  analysisPollTimer:null,analysisPollBusy:false,analysisRefreshPaused:false,activeAnalysisId:null,
  tabId:sessionStorage.getItem("audit-exchange-tab")||auditRequestId()
};
let correctionDesk=null;
sessionStorage.setItem("audit-exchange-tab",S.tabId);
const pendingKey=id=>"audit-exchange:pending:"+id;
const requestOf=row=>row?.envelope?.requestId||row?.requestId;
const pendingMarker=row=>({format:"commons.audit-exchange.pending-ref.v1",workspaceId:row.workspaceId,recordKey:row.workspaceId,requestId:row.envelope.requestId,action:row.envelope.action,expectedVersion:row.envelope.expectedVersion,serverUrl:row.serverUrl,createdAt:row.createdAt,status:row.status});
const draftKey=()=>S.state?"audit-exchange:draft:"+S.state.workspaceId+":"+S.tabId+":"+(S.detail?.source.id||"workspace")+":"+(S.detail?.revision.id||"current"):null;
const text=value=>value===undefined||value===null?"":String(value);
const json=value=>JSON.stringify(value,null,2);
const current=()=>Boolean(S.detail&&S.detail.revision.id===S.detail.source.currentRevisionId);
const sourceName=id=>S.state?.sources.find(row=>row.id===id)?.name||id;
const entityName=key=>S.detail?.model.entities.find(row=>row.key===key)?.label||key||"(blank)";
const date=value=>value?String(value).replace("T"," ").replace("Z"," UTC"):"";
const bytes=value=>Number.isSafeInteger(value)?value.toLocaleString()+" bytes":text(value);
const clone=value=>JSON.parse(JSON.stringify(value));
function el(tag,value,cls){const node=document.createElement(tag);if(value!==undefined)node.textContent=text(value);if(cls)node.className=cls;return node;}
function action(label,fn){const button=el("button",label);button.type="button";button.addEventListener("click",()=>run(label,fn));return button;}
function literal(value){const span=el("span",value,"literal");if(value===""){span.textContent="(empty string)";span.classList.add("empty-value");}return span;}
function nodeOrText(value){return value instanceof Node?value:document.createTextNode(text(value));}
function details(label,value){const box=el("details");box.append(el("summary",label),el("pre",typeof value==="string"?value:json(value)));return box;}
function pairList(target,pairs,grid=false){const node=typeof target==="string"?$(target):target;node.replaceChildren();for(const [key,value] of pairs){const dt=el("dt",key),dd=el("dd");dd.append(nodeOrText(value));if(grid){const box=el("div");box.append(dt,dd);node.append(box);}else node.append(dt,dd);}}
function empty(target,message){const node=typeof target==="string"?$(target):target;node.replaceChildren(el("p",message,"empty"));}
function notice(message,level="info"){const box=$("notice");box.textContent=message;box.dataset.level=level;box.hidden=false;if(level==="error")box.focus();}
function clearNotice(){$("notice").hidden=true;}
function errorMessage(error){let message=error.message||String(error);if(error.code)message+="\n"+error.code;if(error.details)message+="\n"+json(error.details);return message;}
function setOptions(select,rows,{blank=null,preserve=true,value=null}={}){
  const previous=value??(preserve?select.value:null);select.replaceChildren();
  if(blank!==null){const option=el("option",blank);option.value="";select.append(option);}
  for(const row of rows){const option=el("option",Array.isArray(row)?row[1]:row);option.value=text(Array.isArray(row)?row[0]:row);select.append(option);}
  if(previous!==null&&Array.from(select.options).some(row=>row.value===text(previous)))select.value=text(previous);
}
function selected(select){return Array.from(select.selectedOptions).map(row=>row.value);}
function table(target,rows,columns,{pageSize=100,emptyText="No records in this selection.",reset=false}={}){
  const node=typeof target==="string"?$(target):target;
  const identity=typeof target==="string"?target:(node.dataset.tableKey||"table-"+auditRequestId());
  node.dataset.tableKey=identity;
  let state=S.tables.get(identity)||{page:0};if(reset)state.page=0;
  state.page=Math.min(state.page,Math.max(0,Math.ceil(rows.length/pageSize)-1));S.tables.set(identity,state);
  node.replaceChildren();if(!rows.length){node.append(el("p",emptyText,"empty"));return;}
  const start=state.page*pageSize,stop=Math.min(start+pageSize,rows.length);
  const controls=el("div",undefined,"table-controls"),range=el("span",(start+1)+"–"+stop+" of "+rows.length.toLocaleString()+" rows");
  const buttons=el("div",undefined,"actions");
  const previous=action("Previous",()=>{state.page--;table(node,rows,columns,{pageSize,emptyText});}),next=action("Next",()=>{state.page++;table(node,rows,columns,{pageSize,emptyText});});
  previous.disabled=state.page===0;next.disabled=stop===rows.length;buttons.append(previous,next);
  controls.append(range,buttons);node.append(controls);
  const wrap=el("div",undefined,"table-wrap"),t=el("table"),head=el("thead"),header=el("tr");
  for(const col of columns){const th=el("th",col.label);th.scope="col";header.append(th);}head.append(header);t.append(head);
  const body=el("tbody");for(const row of rows.slice(start,stop)){const tr=el("tr");for(const col of columns){const td=el("td");td.append(nodeOrText(col.cell(row)));tr.append(td);}body.append(tr);}t.append(body);wrap.append(t);node.append(wrap);
}
function diagnostics(target,rows){
  table(target,rows||[],[
    {label:"Severity",cell:r=>r.severity||"warning"},{label:"Code / profile",cell:r=>[r.code,r.profileId].filter(Boolean).join(" / ")},
    {label:"Diagnostic",cell:r=>r.message},{label:"Source location",cell:r=>[r.path,r.line!==undefined?"line "+r.line:"",r.column!==undefined?"column "+r.column:""].filter(Boolean).join("\n")}
  ],{emptyText:"No diagnostics in this result."});
}
function displayValidation(validation,targetSummary,targetTable){
  const v=validation||{xsd:{valid:false,diagnostics:[]},profiles:[]};
  const items=[["XML schema",v.xsd?.valid?"Valid":"Diagnostics retained"],...(v.profiles||[]).map(row=>[row.id,row.valid?"Valid":"Diagnostics retained"])];
  const summary=el("dl",undefined,"detail-list");pairList(summary,items);$(targetSummary).replaceChildren(summary);
  diagnostics(targetTable,[...(v.xsd?.diagnostics||[]),...(v.profiles||[]).flatMap(profile=>(profile.diagnostics||[]).map(row=>({...row,profileId:row.profileId||profile.id})))]);
}
function validationLabel(validation){const profileFailures=(validation?.profiles||[]).filter(row=>!row.valid).length;return (validation?.xsd?.valid?"Schema valid":"Schema diagnostics")+(profileFailures?", "+profileFailures+" profile(s) with diagnostics":"");}
function readProfiles(id){return all("input:checked",$(id)).map(row=>row.value);}
function renderProfiles(id,values=[]){const root=$(id);root.replaceChildren();for(const profile of S.state?.standards.profiles||[]){const label=el("label"),input=document.createElement("input");input.type="checkbox";input.value=profile.id;input.checked=values.includes(profile.id);input.dataset.draft="";input.id=id+"-"+profile.id.replace(/[^a-zA-Z0-9_-]/g,"_");label.append(input,document.createTextNode(profile.label||profile.id));root.append(label);}if(!root.children.length)root.append(el("p","No optional profiles are installed.","muted"));}

function updateControls(){
  const connected=Boolean(S.client&&S.state),blocked=S.busy||!connected;
  $("refresh").disabled=blocked;
  all("[data-mutation]").forEach(button=>button.disabled=blocked||Boolean(S.pending));
  for(const id of ["source-picker","compare-form","analysis-preview-form","projection-preview-form"])$(id).querySelector("button[type=submit]").disabled=blocked||(id!=="source-picker"&&!S.detail);
  $("open-current").disabled=blocked||!S.detail||current();
  $("copy-xml").disabled=blocked||!S.detail;
  $("new-review").disabled=blocked||!S.detail;$("new-link").disabled=blocked||!S.detail;
  const sourceRequired=["patch-form","validate-form","replace-form"];
  for(const id of sourceRequired)$(id).querySelector("[data-mutation]").disabled=blocked||Boolean(S.pending)||!current()||(id==="patch-form"&&!S.patches.length);
  $("field-form").querySelector("button").disabled=blocked||!current();
  for(const id of ["review-form","link-form"])$(id).querySelector("[data-mutation]").disabled=blocked||Boolean(S.pending)||!S.detail;
  $("download-xml").disabled=blocked||Boolean(S.pending)||!S.detail;
  $("analysis-preview-form").querySelector("button[type=submit]").disabled=blocked||!S.detail||!$("analysis-building").value||!$("analysis-resource").value;
  $("analysis-form").querySelector("[data-mutation]").disabled=blocked||Boolean(S.pending)||!S.analysisPreview;
  $("analysis-resume-form").querySelector("[data-mutation]").disabled=blocked||Boolean(S.pending)||!canResumeAnalysis((S.state?.analysisRuns||[]).find(row=>analysisId(row)===S.activeAnalysisId));
  $("projection-save-form").querySelector("[data-mutation]").disabled=blocked||Boolean(S.pending)||!S.projectionPreview;
  $("export-edition-review").disabled=blocked||Boolean(S.pending)||!S.edition;$("export-edition-workspace").disabled=blocked||Boolean(S.pending)||!S.edition;
  $("recover-request").disabled=blocked||!S.pending;$("download-request").disabled=!S.pending;
  $("close-refused").disabled=blocked||S.pending?.status!=="refused";
  $("recover-file-form").querySelector("button").disabled=blocked;
  // Freeze user edits for a foreground operation so its completed response cannot
  // clear a newer, unsent form value. Background native-analysis reads leave S.busy false.
  for(const form of all("form"))form.inert=S.busy;
  document.body.setAttribute("aria-busy",String(S.busy));
  correctionDesk?.sync();
}
async function run(label,work){
  if(S.busy)return;
  S.busy=true;updateControls();$("busy-status").textContent=label+"…";
  try{return await work();}catch(error){notice(errorMessage(error),"error");}
  finally{S.busy=false;$("busy-status").textContent="";updateControls();}
}

function database(){
  if(S.database)return S.database;
  S.database=new Promise((resolve,reject)=>{
    const req=indexedDB.open("audit-exchange-operator",1);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains("pending"))db.createObjectStore("pending",{keyPath:"workspaceId"});if(!db.objectStoreNames.contains("closed"))db.createObjectStore("closed",{keyPath:"requestId"});};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(new Error("The browser could not retain the original request: "+req.error?.message));
  });return S.database;
}
async function pendingTransaction(work){
  const db=await database();return await new Promise((resolve,reject)=>{
    const tx=db.transaction(["pending","closed"],"readwrite"),pending=tx.objectStore("pending"),closed=tx.objectStore("closed");
    let result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||new Error("The original request could not be retained."));tx.onabort=()=>reject(tx.error||new Error("The original request reservation did not complete."));
    work(pending,closed,value=>{result=value;},tx);
  });
}
function localPending(id=S.state?.workspaceId){
  if(!id)return null;const raw=localStorage.getItem(pendingKey(id));if(!raw)return null;
  let value;try{value=JSON.parse(raw);}catch{throw new Error("The retained request is unreadable. Preserve its complete browser value before continuing.");}
  if(value.workspaceId!==id||!requestOf(value))throw new Error("The retained request identity does not match this workspace.");
  return value;
}
async function reconcilePending(){
  if(!S.state)return;
  const id=S.state.workspaceId,local=localPending(id);
  const value=await pendingTransaction((pending,closed,done)=>{
    const read=pending.get(id);read.onsuccess=()=>{
      const stored=read.result||null;
      if(stored&&local&&requestOf(stored)!==requestOf(local)){done({conflict:true,stored,local});return;}
      if(stored){done(stored);return;}
      if(local?.envelope){pending.add(local);done(local);return;}
      if(local){
        // A prepared marker is published before the reservation transaction
        // completes. executePending cannot send until that transaction commits.
        if(local.status==="prepared"){localStorage.removeItem(pendingKey(id));done(null);return;}
        done({missing:true,marker:local});return;
      }
      done(null);
    };
  });
  if(value?.conflict)throw new Error("Two different retained requests exist for this workspace. Preserve both original request identities before continuing.");
  if(value?.missing)throw new Error("The original request marker remains, but its complete browser record is missing. Open the downloaded original request file to recover its exact inputs.");
  S.pending=value;
  if(value)localStorage.setItem(pendingKey(id),JSON.stringify(pendingMarker(value)));
  renderPending();updateControls();
}
function renderPending(){
  const row=S.pending;$("recovery-banner").hidden=!row;
  if(!row)return;
  $("recovery-description").textContent=row.envelope.action+" · "+row.envelope.requestId+" · original workspace version "+row.envelope.expectedVersion+" · "+row.status+". "+(row.error?.message||"");
  const detailsValue={...row,envelope:{...row.envelope,inputs:{...row.envelope.inputs}}};
  for(const key of ["contentBase64","weatherCsvBase64"])if(detailsValue.envelope.inputs[key])detailsValue.envelope.inputs[key]="[Complete original file bytes retained; use Download complete request.]";
  $("recovery-details").textContent=json(detailsValue);
  $("close-refused").hidden=row.status!=="refused";
}
async function retainMutation(envelope){
  const id=S.state.workspaceId;
  const row={format:"commons.audit-exchange.pending.v1",workspaceId:id,serverUrl:S.client.baseUrl,createdAt:new Date().toISOString(),status:"prepared",envelope:clone(envelope)};
  const retained=await pendingTransaction((pending,closed,done)=>{
    const read=pending.get(id);read.onsuccess=()=>{
      const local=localPending(id);
      if(read.result||local){done({existing:read.result||local});return;}
      // Retain the complete envelope in the serialized browser transaction.
      // A small workspace marker keeps large XML/application packages recoverable.
      try{localStorage.setItem(pendingKey(id),JSON.stringify(pendingMarker(row)));pending.add(row);done(row);}
      catch(error){done({error:error.message});}
    };
  });
  if(retained?.existing){S.pending=retained.existing;renderPending();throw new Error("Recover the original retained request before preparing another workspace change.");}
  if(retained?.error)throw new Error("The complete original request could not be retained before sending: "+retained.error);
  S.pending=row;renderPending();return row;
}
async function updatePending(status,error=null){
  if(!S.pending)return;
  const original=S.pending,row={...original,status,error:error?{code:error.code||"",message:error.message||String(error),details:error.details}:null};
  const updated=await pendingTransaction((pending,closed,done)=>{
    const read=pending.get(row.workspaceId);read.onsuccess=()=>{
      if(read.result?.envelope.requestId!==row.envelope.requestId){done(false);return;}
      localStorage.setItem(pendingKey(row.workspaceId),JSON.stringify(pendingMarker(row)));pending.put(row);done(true);
    };
  });
  if(!updated)throw new Error("Another tab completed or replaced the pending request. Refresh its original result.");
  S.pending=row;renderPending();
}
async function closePending(result,reason){
  const row=S.pending;if(!row)return;
  const closed=await pendingTransaction((pending,history,done)=>{
    const read=pending.get(row.workspaceId);read.onsuccess=()=>{
      if(read.result?.envelope.requestId!==row.envelope.requestId){done(false);return;}
      history.put({requestId:row.envelope.requestId,workspaceId:row.workspaceId,action:row.envelope.action,expectedVersion:row.envelope.expectedVersion,closedAt:new Date().toISOString(),reason,result});
      pending.delete(row.workspaceId);
      const local=localPending(row.workspaceId);if(requestOf(local)===row.envelope.requestId)localStorage.removeItem(pendingKey(row.workspaceId));
      done(true);
    };
  });
  if(!closed)throw new Error("The original request changed in another tab. Reopen its retained result before continuing.");
  S.pending=null;renderPending();
}
function operator(){const value=$("actor").value.trim();if(!value)throw new Error("Enter the operator name to record with this change.");return value;}
async function mutate(actionName,inputs){
  if(!S.client||!S.state)throw new Error("Open a workspace first.");
  await flushDraft();
  await reconcilePending();if(S.pending)throw new Error("Recover the retained original request before preparing another change.");
  const envelope=S.client.envelope(actionName,inputs,{expectedVersion:S.state.version});
  await retainMutation(envelope);return await executePending();
}
async function executePending(){
  const name="audit-exchange-request:"+S.state.workspaceId;
  if(navigator.locks?.request)return navigator.locks.request(name,{mode:"exclusive",ifAvailable:true},lock=>{
    if(!lock)throw new Error("Another tab is executing this workspace's original request. Refresh its retained outcome when that send completes.");
    return sendPending();
  });
  return sendPending();
}
async function sendPending(){
  const row=S.pending;if(!row)throw new Error("There is no retained original request.");
  if(row.workspaceId!==S.client.workspaceId)throw new Error("Reconnect to the original request's workspace.");
  await updatePending("sent");
  let response;
  try{response=await S.client.execute(clone(row.envelope));}
  catch(error){await updatePending(error.outcomeUnknown?"outcome unknown":"refused",error);throw error;}
  S.state=response.state;
  await closePending(response.result,"completed");
  renderState();notice("Saved "+row.envelope.action+" in workspace "+S.state.name+".");
  return response.result;
}
function downloadBytes(data,name,mediaType="application/octet-stream"){
  const url=URL.createObjectURL(new Blob([data],{type:mediaType})),a=document.createElement("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function download(item){const result=await S.client.download(item);downloadBytes(result.bytes,result.name,result.mediaType);notice("Downloaded "+result.name+" · "+bytes(result.bytes.length)+" · SHA256 "+result.sha256);}
async function exportFile(inputs){const result=await mutate("export.create",{...inputs,actor:operator(),note:inputs.note||""});await download(result);return result;}

function snapshotDraft(){
  const key=draftKey();if(!key)return null;
  const fields={};for(const input of all("[data-draft]"))if(input.id)fields[input.id]=input.type==="checkbox"?input.checked:input.tagName==="SELECT"&&input.multiple?selected(input):input.value;
  return {key,workspaceId:S.state.workspaceId,sourceId:S.detail?.source.id||null,revisionId:S.detail?.revision.id||null,fields,patches:clone(S.patches),activeFieldKey:S.activeField?.key||null,dirtyForms:[...S.dirtyForms],savedAt:new Date().toISOString()};
}
function saveDraft(snapshot){
  if(!snapshot)return;try{localStorage.setItem(snapshot.key,JSON.stringify(snapshot));S.draftError=null;}
  catch(error){S.draftError=error;notice("Keep this tab open: its draft could not be retained. "+error.message,"error");throw error;}
}
function queueDraft(){clearTimeout(S.draftTimer);S.draftSnapshot=snapshotDraft();S.draftTimer=setTimeout(()=>{const snapshot=S.draftSnapshot;S.draftSnapshot=null;S.draftTimer=null;try{saveDraft(snapshot);}catch{}},200);}
async function flushDraft(){
  clearTimeout(S.draftTimer);S.draftTimer=null;
  const snapshot=S.draftSnapshot||snapshotDraft();S.draftSnapshot=null;
  saveDraft(snapshot);
}
function restoreDraft(){
  const key=draftKey();if(!key)return;
  const raw=localStorage.getItem(key);if(!raw)return;
  const draft=JSON.parse(raw);if(draft.workspaceId!==S.state.workspaceId||draft.sourceId!==(S.detail?.source.id||null)||draft.revisionId!==(S.detail?.revision.id||null))throw new Error("The retained draft belongs to another source revision.");
  for(const [id,value] of Object.entries(draft.fields||{})){const input=$(id);if(!input||!input.hasAttribute("data-draft"))continue;if(input.type==="checkbox")input.checked=Boolean(value);else if(input.tagName==="SELECT"&&input.multiple){for(const option of input.options)option.selected=Array.isArray(value)&&value.includes(option.value);}else input.value=text(value);}
  const patches=draft.patches||[];
  if(patches.some(row=>!S.detail?.model.fields.some(field=>field.key===row.key&&field.path===row.path&&field.value===row.expected)))throw new Error("A retained field draft differs from this exact source revision. Its full saved draft is preserved.");
  S.patches=patches;S.dirtyForms=new Set(draft.dirtyForms||[]);
  if(S.detail){
    renderAnalysisChoices(null,draft.fields||{});
    const field=S.detail.model.fields.find(row=>row.key===draft.activeFieldKey);
    if(field)openField(field,draft.fields?.["field-after"]??field.value);
  }
  renderPatches();syncNativeOptions();
}
async function showSection(section){await flushDraft();S.section=section;all("[data-panel]").forEach(node=>node.hidden=node.dataset.panel!==section);all("[data-section]").forEach(node=>node.setAttribute("aria-current",node.dataset.section===section?"page":"false"));scheduleAnalysisRefresh();if(section==="corrections")await correctionDesk.open();}
function showInspector(view){S.inspector=view;all("[data-inspector-panel]").forEach(node=>node.hidden=node.dataset.inspectorPanel!==view);all("[data-inspector]").forEach(node=>node.setAttribute("aria-current",node.dataset.inspector===view?"page":"false"));}
function sourceBinding(){return S.detail?S.detail.source.name+" · revision "+S.detail.revision.number+" · "+S.detail.revision.id:"Open a source revision in Inspect and correct.";}
function clearDetailView(){
  S.activeEntity=null;S.activeField=null;S.analysisPreview=null;S.projectionPreview=null;S.analysisInput=null;S.projectionInput=null;S.comparison=null;S.dirtyForms.clear();
  for(const file of ["import","replace","weather","receive"]){S[file+"File"]=null;$(file+"-file").value="";}
  for(const form of all("form"))if(form.id!=="connect-form")form.reset();
  for(const id of ["entities-table","fields-table","patches-table","references-table","series-table","validation-summary","validation-table","revision-table","comparison-table","edition-sources","analysis-readings","projection-tables"])empty(id,"Open a source revision to view its retained records.");
  for(const id of ["entity-detail","field-form","edition-detail","analysis-preview","analysis-result","projection-preview","receive-result","reference-comparison"])$(id).hidden=true;
  $("source-context").replaceChildren(el("p","Select a source document."));$("xml-text").value="";
  for(const id of ["compare-source","review-binding","link-binding","analysis-binding","projection-binding"])$(id).textContent=sourceBinding();
  pairList("comparison-summary",[],true);$("projection-result").replaceChildren();
  for(const id of ["revision-select","compare-before","compare-after"])$(id).replaceChildren();
  syncNativeOptions();
}
function requireDetail(){if(!S.detail)throw new Error("Open the complete source revision first.");return S.detail;}
function requireCurrent(){const d=requireDetail();if(!current())throw new Error("Open the current source revision before saving XML changes. Historical revisions remain available for reviews and exports.");return d;}
async function refresh({keepDetail=true}={}){
  await flushDraft();S.state=await S.client.getState();renderState();await reconcilePending();
  if(keepDetail&&S.detail){const source=S.state.sources.find(row=>row.id===S.detail.source.id);if(source){S.detail.source={...source};renderSourceContext();updateControls();}}
}
async function openSource(sourceId,revisionId,section="inspect"){
  await flushDraft();const detail=await S.client.read("source.get",{sourceId,...(revisionId?{revisionId}:{})});
  S.detail=detail;S.activeEntity=null;S.activeField=null;S.patches=[];S.dirtyForms.clear();S.edition=null;S.analysisPreview=null;S.projectionPreview=null;S.analysisInput=null;S.projectionInput=null;S.replaceFile=null;S.weatherFile=null;
  $("replace-file").value="";$("weather-file").value="";$("replace-file-status").textContent="";$("weather-file-status").textContent="";
  $("review-form").reset();$("link-form").reset();$("review-id").value="";$("link-id").value="";
  $("field-form").hidden=true;$("entity-detail").hidden=true;$("analysis-preview").hidden=true;$("analysis-result").hidden=true;$("projection-preview").hidden=true;$("projection-result").replaceChildren();
  renderDetail();restoreDraft();await showSection(section);updateControls();
}
function renderState(){
  if(!S.state)return;const state=S.state;
  $("connection-status").textContent="Connected to "+state.name+" · workspace "+state.workspaceId+" · version "+state.version;
  $("footer-identity").textContent=state.workspaceId;$("workspace-pin").value=state.workspaceId;
  $("version-badge").textContent="Version "+state.version;
  pairList("workspace-summary",[["Workspace",state.name],["Sources",state.sources.length],["Saved editions",state.editions.length],["Open reviews",state.reviews.filter(r=>["open","investigating"].includes(r.status)).length],["Related records",state.links.length],["Analysis runs",state.analysisRuns.length]],true);
  setOptions($("source-select"),state.sources.map(r=>[r.id,r.name]),{value:S.detail?.source.id||null,blank:state.sources.length?null:"No sources retained"});
  all("[data-schema]").forEach(select=>setOptions(select,(state.standards.schemas||[]).map(r=>[r.id,r.label||r.version||r.id]),{value:select.value||"2.7.0"}));
  renderProfiles("import-profiles",readProfiles("import-profiles"));
  setOptions($("export-edition"),state.editions.map(r=>[r.id,r.number+" · "+r.name]),{blank:"Current workspace"});
  renderSources();renderReviews();renderLinks();renderEditions();renderExports();renderAnalysisRuns();
  table("overview-sources",state.sources,[{label:"Document",cell:r=>action(r.name,()=>openSource(r.id))},{label:"Current revision",cell:r=>r.revisionNumber},{label:"Validation",cell:r=>validationLabel(r.validation)}],{pageSize:8,emptyText:"Import the first source document to begin."});
  table("overview-reviews",state.reviews.filter(r=>["open","investigating"].includes(r.status)),[{label:"Review",cell:r=>action(r.title,()=>openReview(r))},{label:"Assignee",cell:r=>r.assignee||"Unassigned"},{label:"Status",cell:r=>r.status}],{pageSize:8,emptyText:"No open or investigating reviews."});
  const standards=$("standards");standards.replaceChildren();
  for(const group of [["Schemas",state.standards.schemas||[]],["Profiles",state.standards.profiles||[]],["Licenses",state.standards.licenses||[]]]){standards.append(el("h4",group[0]));const list=el("ul");for(const item of group[1])list.append(el("li",[item.label||item.id,item.version,item.path].filter(Boolean).join(" · ")));standards.append(list);}
  updateExportBinding();updateControls();
}
function renderSources(){table("sources-table",S.state?.sources||[],[
  {label:"Source",cell:r=>action(r.name,()=>openSource(r.id))},
  {label:"Declared version",cell:r=>r.declaredVersion||"(not declared)"},
  {label:"Selected schema / profiles",cell:r=>r.selectedSchema+"\n"+(r.profileIds||[]).join(", ")},
  {label:"Current revision",cell:r=>r.revisionNumber},
  {label:"Counts",cell:r=>details("All source counts",r.counts)},
  {label:"Validation",cell:r=>validationLabel(r.validation)},
  {label:"Original SHA256",cell:r=>el("span",r.originalSha256,"mono")}
]);}
function renderSourceContext(){
  const d=S.detail;if(!d)return;
  const box=$("source-context"),dl=el("dl",undefined,"detail-list");box.replaceChildren(el("h3",d.source.name));
  pairList(dl,[["Source ID",d.source.id],["Viewing",("Revision "+d.revision.number)+(current()?" · current":" · saved historical revision")],["Revision ID",d.revision.id],["Complete XML",bytes(d.revision.bytes)],["SHA256",d.revision.sha256],["Declared version",d.revision.declaredVersion||"(not declared)"],["Selected schema",d.revision.selectedSchema],["Profiles",(d.revision.profileIds||[]).join(", ")||"None"],["Revision note",d.revision.note||""]]);box.append(dl);
  for(const id of ["compare-source","review-binding","link-binding","analysis-binding","projection-binding"])$(id).textContent=sourceBinding();
  $("xml-text").value=d.xmlText;
  $("patch-draft-status").textContent=S.patches.length+" staged correction(s). "+(current()?"Save them together as one revision.":"Open current revision to edit XML.");
  updateExportBinding();
}
function renderDetail(){
  const d=S.detail;if(!d)return;renderSourceContext();
  setOptions($("source-select"),S.state.sources.map(r=>[r.id,r.name]),{value:d.source.id});
  const revisions=d.revisions.map(r=>[r.id,"Revision "+r.number+" · "+date(r.createdAt)]);
  for(const id of ["revision-select","compare-before","compare-after"])setOptions($(id),revisions,{value:id==="compare-before"?(d.revisions.find(r=>r.id===d.revision.parentId)?.id||d.revisions[0]?.id):d.revision.id});
  setOptions($("entity-kind"),[...new Set(d.model.entities.map(r=>r.semanticKind).filter(Boolean))].sort(),{blank:"All source entities"});
  const entities=d.model.entities.map(r=>[r.key,(r.label||r.xmlId||r.kind)+" · "+r.kind]);
  setOptions($("field-entity"),entities,{blank:"All entities",preserve:false});
  setOptions($("review-entity"),entities,{blank:"Whole document",preserve:false});
  setOptions($("link-entity"),entities,{preserve:false});
  for(const id of ["projection-assets","projection-documents","projection-requirements"])setOptions($(id),entities,{preserve:false});
  for(const prefix of ["validate","replace"]){$(prefix+"-schema").value=d.revision.selectedSchema;renderProfiles(prefix+"-profiles",d.revision.profileIds||[]);}
  $("entity-query").value="";$("field-query").value="";$("series-query").value="";
  renderEntities();renderFields();renderReferences();renderSeries();renderPatches();renderRevisions();
  displayValidation(d.validation,"validation-summary","validation-table");
  renderAnalysisChoices();
}
function renderEntities(){
  const query=$("entity-query").value.toLowerCase(),kind=$("entity-kind").value;
  const rows=(S.detail?.model.entities||[]).filter(r=>(!kind||r.semanticKind===kind)&&(!query||[r.label,r.xmlId,r.kind,r.semanticKind,r.path].join("\n").toLowerCase().includes(query)));
  table("entities-table",rows,[
    {label:"Entity",cell:r=>action(r.label||r.xmlId||r.kind,()=>{S.activeEntity=r;$("entity-detail").hidden=false;const dl=el("dl",undefined,"detail-list");pairList(dl,[["XML kind",r.kind],["Semantic kind",r.semanticKind||"(not supplied)"],["XML ID",r.xmlId||"(absent)"],["Exact key",r.key],["Path",r.path],["Facilities",(r.facilityKeys||[]).map(entityName).join("\n")],["Buildings",(r.buildingKeys||[]).map(entityName).join("\n")],["Fields",(r.fieldKeys||[]).length]]);$("entity-summary").replaceChildren(dl);})},
    {label:"Semantic kind",cell:r=>r.semanticKind||"(not supplied)"},{label:"XML kind",cell:r=>r.kind},{label:"XML ID",cell:r=>r.xmlId||"(absent)"},{label:"Buildings",cell:r=>(r.buildingKeys||[]).map(entityName).join("\n")},{label:"Fields",cell:r=>(r.fieldKeys||[]).length}
  ]);
}
function renderFields(){
  const query=$("field-query").value.toLowerCase(),entity=$("field-entity").value;
  const rows=(S.detail?.model.fields||[]).filter(r=>(!entity||r.entityKey===entity)&&(!query||[r.name,r.value,r.path,r.attributeName].join("\n").toLowerCase().includes(query)));
  table("fields-table",rows,[
    {label:"Field",cell:r=>r.name},{label:"Entity",cell:r=>entityName(r.entityKey)},{label:"Kind / attribute",cell:r=>r.kind+(r.attributeName?"\n"+r.attributeName:"")},{label:"Exact value",cell:r=>literal(r.value)},
    {label:"Correction",cell:r=>r.editable?action("Stage correction",()=>openField(r,S.patches.find(p=>p.key===r.key)?.value??r.value)):"Read-only structural value"}
  ]);
}
function openField(field,value){
  S.activeField=field;$("field-form").hidden=false;
  pairList("field-context",[["Entity",entityName(field.entityKey)],["Field",field.name],["Path",field.path],["Kind",field.kind],["Expanded attribute",field.attributeName||""]]);
  $("field-before").value=field.value;$("field-after").value=value;updateControls();$("field-after").focus();
}
function renderPatches(){
  table("patches-table",S.patches,[
    {label:"Field",cell:r=>r.name},{label:"Exact path",cell:r=>r.path},{label:"Before",cell:r=>literal(r.expected)},{label:"After",cell:r=>literal(r.value)},
    {label:"Draft",cell:r=>action("Remove",()=>{S.patches=S.patches.filter(p=>p.key!==r.key);renderPatches();queueDraft();})}
  ],{emptyText:"No staged field corrections."});
  $("patch-draft-status").textContent=S.patches.length+" staged correction(s)"+(S.detail?" for revision "+S.detail.revision.number:"")+".";
  updateControls();
}
function renderReferences(){table("references-table",S.detail?.model.references||[],[
  {label:"From entity",cell:r=>entityName(r.fromKey)},{label:"Path",cell:r=>r.path},{label:"Target XML ID",cell:r=>r.targetXmlId},{label:"Resolution",cell:r=>r.resolution},{label:"Target entity",cell:r=>r.targetKey?entityName(r.targetKey):"(no unique local target)"}
]);}
function seriesColumns(){return [
  {label:"Building",cell:r=>(r.buildingKeys||[]).map(entityName).join("\n")},{label:"Scenario",cell:r=>entityName(r.scenarioKey)},{label:"Resource",cell:r=>r.resourceXmlId||entityName(r.resourceKey)},{label:"Reading",cell:r=>literal(r.readingType)},{label:"Units",cell:r=>literal(r.units)},{label:"Start",cell:r=>literal(r.start)},{label:"End",cell:r=>literal(r.end)},{label:"Value",cell:r=>literal(r.value)},{label:"Interval",cell:r=>literal(r.interval)},{label:"Source stream",cell:r=>details(r.streamKey||"Exact source identity",r)}
];}
function renderSeries(){const query=$("series-query").value.toLowerCase();table("series-table",(S.detail?.model.timeSeries||[]).filter(r=>!query||Object.values(r).map(text).join("\n").toLowerCase().includes(query)),seriesColumns());}
function renderRevisions(){table("revision-table",S.detail?.revisions||[],[
  {label:"Revision",cell:r=>action("Revision "+r.number,()=>openSource(S.detail.source.id,r.id,"revisions"))},{label:"Created / operator",cell:r=>date(r.createdAt)+"\n"+r.actor},{label:"Schema / profiles",cell:r=>r.selectedSchema+"\n"+(r.profileIds||[]).join(", ")},{label:"Note",cell:r=>r.note},{label:"Complete bytes / SHA256",cell:r=>bytes(r.bytes)+"\n"+r.sha256}
]);}
function renderComparison(result){
  S.comparison=result;pairList("comparison-summary",Object.entries(result.counts||{}),true);
  const rows=[...result.added.map(r=>({state:"added",key:r.key,before:null,after:r})),...result.removed.map(r=>({state:"removed",key:r.key,before:r,after:null})),...result.changed.map(r=>({state:"changed",...r}))];
  table("comparison-table",rows,[{label:"Change",cell:r=>r.state},{label:"Field / exact path",cell:r=>(r.after||r.before).name+"\n"+(r.after||r.before).path},{label:"Before",cell:r=>r.before?literal(r.before.value):"(absent)"},{label:"After",cell:r=>r.after?literal(r.after.value):"(absent)"},{label:"Structural details",cell:r=>details("Full before / after",r)}],{emptyText:"The selected revisions have no changed fields."});
  $("reference-comparison").hidden=false;$("reference-comparison-json").textContent=json(result.referenceChanges);
}
function renderEditions(){table("editions-table",S.state?.editions||[],[
  {label:"Edition",cell:r=>action(r.number+" · "+r.name,()=>openEdition(r.id))},{label:"Created",cell:r=>date(r.createdAt)},{label:"Workspace version",cell:r=>r.version},{label:"Note",cell:r=>r.note}
]);}
async function openEdition(id){
  const edition=await S.client.read("edition.get",{editionId:id});S.edition=edition;$("edition-detail").hidden=false;$("edition-title").textContent="Edition "+edition.number+" · "+edition.name;
  pairList("edition-summary",[["Edition ID",edition.id],["Saved",date(edition.createdAt)],["Workspace version",edition.version],["Note",edition.note]]);
  table("edition-sources",edition.sources,[{label:"Source",cell:r=>action(sourceName(r.sourceId),()=>openSource(r.sourceId,r.revisionId))},{label:"Exact revision",cell:r=>r.revisionId},{label:"SHA256",cell:r=>r.sha256}]);
  $("edition-sidecars").textContent=json({reviews:edition.reviews,links:edition.links,analysisRuns:edition.analysisRuns});await showSection("editions");updateControls();
}
function renderReviews(){
  const state=$("review-filter").value,query=$("review-query").value.toLowerCase();
  table("reviews-table",(S.state?.reviews||[]).filter(r=>(!state||r.status===state)&&(!query||[r.title,r.note,r.assignee,sourceName(r.sourceId)].join("\n").toLowerCase().includes(query))),[
    {label:"Review",cell:r=>action(r.title,()=>openReview(r))},{label:"Status",cell:r=>r.status},{label:"Assignee / due",cell:r=>r.assignee+"\n"+r.dueDate},{label:"Bound source",cell:r=>sourceName(r.sourceId)+"\n"+r.revisionId},{label:"Note",cell:r=>literal(r.note)}
  ]);
}
async function openReview(review){
  if(!mayReplaceForm("review-form","review"))return;
  await openSource(review.sourceId,review.revisionId,"reviews");
  S.dirtyForms.delete("review-form");$("review-id").value=review.id;$("review-title").value=review.title;$("review-status").value=review.status;$("review-note").value=review.note;$("review-assignee").value=review.assignee;$("review-due").value=review.dueDate;$("review-entity").value=review.entityKey||"";$("review-evidence").value=(review.evidence||[]).map(row=>row.label+" | "+row.url).join("\n");$("review-form-title").textContent="Edit retained review";queueDraft();
}
function renderLinks(){table("links-table",S.state?.links||[],[
  {label:"Source",cell:r=>action(sourceName(r.sourceId),()=>openLink(r))},{label:"Revision / entity",cell:r=>r.revisionId+"\n"+r.entityKey},{label:"Target kind",cell:r=>r.targetKind},{label:"Target workspace / record",cell:r=>r.targetWorkspaceId+"\n"+r.targetRecordId},{label:"Join note",cell:r=>r.note}
]);}
async function openLink(link){if(!mayReplaceForm("link-form","related record"))return;await openSource(link.sourceId,link.revisionId,"links");S.dirtyForms.delete("link-form");$("link-id").value=link.id;$("link-entity").value=link.entityKey;$("link-kind").value=link.targetKind;$("link-workspace").value=link.targetWorkspaceId;$("link-record").value=link.targetRecordId;$("link-note").value=link.note;$("link-form-title").textContent="Edit explicit related record";queueDraft();}
function streamLabel(key,rows){
  if(!key)return "(original reading selection)";
  const row=rows.find(item=>item.streamKey===key)||{};
  const fields=[["phase","Phase"],["peakType","Peak"],["quantity","Quantity"],["flowDirection","Flow"],["intervalDuration","Interval"],["intervalDurationUnits","Interval units"]];
  const labels=fields.filter(([name])=>typeof row[name]==="string"&&row[name]!=="").map(([name,label])=>{
    const value=row[name];return label+": "+(value===""?"(blank literal)":value!==null&&typeof value==="object"?json(value):String(value));
  });
  return labels.length?labels.join(" · ")+" · "+key:key;
}
function renderAnalysisChoices(changed=null,preferred={}){
  const rows=S.detail?.model.timeSeries||[];
  const buildings=(S.detail?.model.entities||[]).filter(row=>row.semanticKind==="building").map(row=>row.key);
  const hasUnassigned=rows.some(row=>!(row.buildingKeys||[]).length);
  const scope=row=>(row.buildingKeys||[]).length?row.buildingKeys:buildings;
  const levels=[
    ["analysis-building",scope],["analysis-scenario",r=>[r.scenarioKey]],["analysis-resource",r=>[r.resourceKey]],["analysis-reading-type",r=>[r.readingType]],["analysis-units",r=>[r.units]],["analysis-stream",r=>[r.streamKey||""]]
  ];
  let filtered=rows,reset=false;
  for(const [id,get] of levels){
    const options=[...new Set(filtered.flatMap(get).map(text))].sort();const prior=preferred[id]??$(id).value;
    setOptions($(id),options.map(key=>[key,id==="analysis-stream"?streamLabel(key,filtered):id==="analysis-reading-type"||id==="analysis-units"?(key===""?"(blank literal)":key):entityName(key)]),{preserve:!reset,value:!reset?prior:null,blank:id==="analysis-building"&&hasUnassigned?"Choose the building for these original readings":null});
    if(id===changed)reset=true;
    const value=$(id).value;filtered=filtered.filter(row=>get(row).map(text).includes(value));
  }
  const selectedBuilding=$("analysis-building").value,unassigned=filtered.filter(row=>!(row.buildingKeys||[]).length).length;
  $("analysis-scope-hint").textContent=!selectedBuilding&&hasUnassigned?
    "The source contains readings without an explicit building association. Choose an actual native Building to bind this analysis.":
    unassigned?unassigned+" selected readings have no recorded building association. "+entityName(selectedBuilding)+" is your explicit analysis choice; the original source associations remain unchanged.":
    filtered.length?"The selected readings retain their source-recorded building associations.":"Choose a complete original source stream.";
  S.analysisPreview=null;S.analysisInput=null;$("analysis-preview").hidden=true;updateControls();
}
function analysisSelection(){const d=requireDetail();return {sourceId:d.source.id,revisionId:d.revision.id,buildingKey:$("analysis-building").value,scenarioKey:$("analysis-scenario").value,resourceKey:$("analysis-resource").value,readingType:$("analysis-reading-type").value,units:$("analysis-units").value,...($("analysis-stream").value?{streamKey:$("analysis-stream").value}:{})};}
function projectionSelection(){const d=requireDetail();return {sourceId:d.source.id,revisionId:d.revision.id,assetEntityKeys:selected($("projection-assets")),documentEntityKeys:selected($("projection-documents")),requirementEntityKeys:selected($("projection-requirements"))};}
const NATIVE_MODELS=["Mean","SLR","3PC","3PH","4P","5P","HDD","CDD","HDD-CDD","TOW","TOWT"];
function nativeOptions(){
  let options;try{options=JSON.parse($("model-options").value);}catch{throw new Error("Model options must be a complete JSON object.");}
  if(!options||Array.isArray(options)||typeof options!=="object")throw new Error("Model options must be a JSON object.");
  return options;
}
function nativeOptionsStatus(message,error=false){$("model-options-status").textContent=message;$("model-options-status").dataset.error=String(error);}
function syncNativeOptions(){
  let options;try{options=nativeOptions();}catch(error){nativeOptionsStatus(error.message,true);return;}
  for(const input of all("[data-native-option]")){
    const key=input.dataset.nativeOption,value=options[key];
    if(key==="models"){
      const values=Array.isArray(value)?value:value===undefined?NATIVE_MODELS:[];
      for(const item of all("option[data-advanced]",input))item.remove();
      for(const v of values)if(typeof v==="string"&&!Array.from(input.options).some(item=>item.value===v)){const item=new Option(v,v);item.dataset.advanced="";input.add(item);}
      for(const item of input.options)item.selected=values.includes(item.value);
    }else{
      const nativeValue=typeof value==="string"?value:"";
      if(input.tagName==="SELECT"){
        for(const item of all("option[data-advanced]",input))item.remove();
        if(nativeValue&&!Array.from(input.options).some(item=>item.value===nativeValue)){const item=new Option(nativeValue+" (from complete options)",nativeValue);item.dataset.advanced="";input.add(item);}
      }
      input.value=nativeValue;
    }
  }
  nativeOptionsStatus("Controls and complete JSON describe the same retained native configuration.");
}
function updateNativeOption(event){
  const input=event.currentTarget,key=input.dataset.nativeOption;
  try{
    const options=nativeOptions(),value=key==="models"?selected(input):input.value.trim();
    if(key==="models"&&!value.length)throw new Error("Select at least one native model.");
    if(value==="")delete options[key];else options[key]=value;
    $("model-options").value=json(options);S.dirtyForms.add("analysis-form");queueDraft();syncNativeOptions();
  }catch(error){nativeOptionsStatus(error.message,true);notice(error.message,"error");syncNativeOptions();}
}
function analysisId(result){return result?.analysisId||result?.id||null;}
function canResumeAnalysis(result){
  if(!result||["queued","running"].includes(result.status))return false;
  return ["needs-runtime","needs-input","failed"].includes(result.status)&&result.metadata?.terminal===false;
}
function activeAnalyses(){return (S.state?.analysisRuns||[]).some(row=>["queued","running"].includes(row.status));}
function scheduleAnalysisRefresh(delay=2500){
  clearTimeout(S.analysisPollTimer);S.analysisPollTimer=null;
  if(!S.client||S.analysisRefreshPaused||S.section!=="analysis"||document.hidden||!activeAnalyses())return;
  S.analysisPollTimer=setTimeout(refreshNativeAnalyses,delay);
}
async function refreshNativeAnalyses(){
  S.analysisPollTimer=null;
  if(!S.client||S.analysisRefreshPaused||S.section!=="analysis"||document.hidden||!activeAnalyses())return;
  if(S.busy||S.analysisPollBusy){scheduleAnalysisRefresh();return;}
  const client=S.client;S.analysisPollBusy=true;let delay=2500;
  try{
    const state=await client.getState();
    if(S.client!==client)return;
    // A foreground action may have advanced this workspace while GET was in flight.
    if(S.busy||S.state?.workspaceId!==state.workspaceId||state.version<S.state.version){client.state=S.state;return;}
    S.state=state;
    if(S.detail){const source=state.sources.find(row=>row.id===S.detail.source.id);if(source)S.detail.source={...source};}
    $("connection-status").textContent="Connected to "+state.name+" · workspace "+state.workspaceId+" · version "+state.version;
    $("version-badge").textContent="Version "+state.version;
    renderAnalysisRuns();updateControls();
    $("analysis-refresh-status").textContent=activeAnalyses()?"Native work is running. Its retained status and outputs refresh while this view is open.":"The displayed native runs have returned their retained results.";
  }catch(error){
    if(S.client===client){
      if(error.code==="AUDIT_WORKSPACE_CHANGED")S.analysisRefreshPaused=true;
      $("analysis-refresh-status").textContent="Analysis status could not be refreshed. "+error.message;
      delay=10000;
    }
  }finally{S.analysisPollBusy=false;if(S.client===client)scheduleAnalysisRefresh(delay);}
}
function renderAnalysisResult(result){
  const id=analysisId(result),retained=(S.state?.analysisRuns||[]).find(row=>analysisId(row)===id);
  if(retained&&["queued","running"].includes(result.status))result=retained;
  S.activeAnalysisId=id;
  $("analysis-result").hidden=false;$("analysis-result-status").textContent=(result.analysisId||result.id||"Native run")+" · "+result.status;
  diagnostics("analysis-result-diagnostics",result.diagnostics||[]);$("analysis-result-json").textContent=json(result);
  const outputs=$("analysis-outputs");outputs.replaceChildren();for(const file of result.outputs||[])outputs.append(action("Download "+file.name,()=>download(file)));
  $("analysis-resume-form").hidden=!canResumeAnalysis(result);
  $("analysis-resume-binding").textContent="Analysis "+id+" · source "+text(result.sourceId||"retained original")+" · revision "+text(result.revisionId||"retained original")+" · "+result.status;
  updateControls();
}
function renderAnalysisRuns(){table("analysis-runs-table",S.state?.analysisRuns||[],[
  {label:"Run",cell:r=>action(r.analysisId||r.id,async()=>{renderAnalysisResult(r);await showSection("analysis");})},{label:"Status",cell:r=>r.status},{label:"Source / revision",cell:r=>sourceName(r.sourceId)+"\n"+text(r.revisionId)},{label:"Created",cell:r=>date(r.createdAt)},{label:"Outputs",cell:r=>(r.outputs||[]).map(f=>f.name).join("\n")}
]);
  const active=(S.state?.analysisRuns||[]).find(row=>analysisId(row)===S.activeAnalysisId);if(active)renderAnalysisResult(active);
  scheduleAnalysisRefresh();
}
function renderProjection(result){
  S.projectionPreview=result;$("projection-preview").hidden=false;
  $("projection-selection").textContent="Source "+result.sourceId+" · revision "+result.revisionId+" · selection SHA256 "+result.selectionSha256;
  diagnostics("projection-diagnostics",result.diagnostics||[]);
  const root=$("projection-tables");root.replaceChildren();
  for(const [name,rows] of Object.entries(result.tables)){const article=el("article"),target=el("div");target.dataset.tableKey="projection:"+name;article.append(el("h4",name),target);root.append(article);const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))];table(target,rows,columns.map(key=>({label:key,cell:row=>{const v=row[key];return v!==null&&typeof v==="object"?json(v):literal(text(v));}})),{emptyText:"This table has no rows for the explicit selection."});}
  updateControls();
}
function renderExports(){table("exports-table",S.state?.exports||[],[
  {label:"Retained file",cell:r=>action(r.name,()=>download(r))},{label:"Kind",cell:r=>r.kind},{label:"Complete bytes",cell:r=>bytes(r.bytes)},{label:"SHA256",cell:r=>el("span",r.sha256,"mono")},{label:"Created",cell:r=>date(r.createdAt)}
]);}
function updateExportBinding(){
  const kind=$("export-kind").value,edition=$("export-edition").value;
  $("export-edition").disabled=kind==="xml";
  $("export-binding").textContent=kind==="xml"?sourceBinding():edition?"Saved edition "+edition+" within the complete retained workspace.":"Current workspace "+(S.state?.name||"")+" with its retained history.";
}

async function selectFile(kind,file){
  if(!file)throw new Error("Choose the complete original file.");
  const raw=new Uint8Array(await file.arrayBuffer()),sha=await auditSha256(raw);
  S[kind+"File"]=file;
  const id={import:"import-file-status",replace:"replace-file-status",weather:"weather-file-status",receive:"receive-file-status"}[kind];
  $(id).textContent=file.name+" · "+bytes(file.size)+" · SHA256 "+sha;
  if(kind==="import")$("import-name").value=file.name;
  queueDraft();
}
function parseEvidence(value){
  return value.split(/\r?\n/).filter(line=>line.trim()).map(line=>{
    const at=line.indexOf("|");if(at<1)throw new Error("Use one evidence link per line in the form: label | URL.");
    const label=line.slice(0,at).trim(),url=line.slice(at+1).trim();let parsed;try{parsed=new URL(url);}catch{throw new Error("Enter a complete evidence URL: "+url);}
    if(!["http:","https:"].includes(parsed.protocol))throw new Error("Evidence links use HTTP or HTTPS URLs.");
    return {label,url};
  });
}
function mayReplaceForm(id,label){return !S.dirtyForms.has(id)||confirm("Replace the unsaved "+label+" form?");}
function clearReview(){ if(!mayReplaceForm("review-form","review"))return;S.dirtyForms.delete("review-form");$("review-form").reset();$("review-id").value="";$("review-form-title").textContent="New source-bound review";$("review-binding").textContent=sourceBinding();if(S.activeEntity)$("review-entity").value=S.activeEntity.key;queueDraft();}
function clearLink(){ if(!mayReplaceForm("link-form","related record"))return;S.dirtyForms.delete("link-form");$("link-form").reset();$("link-id").value="";$("link-form-title").textContent="Add a related workspace record";$("link-binding").textContent=sourceBinding();if(S.activeEntity)$("link-entity").value=S.activeEntity.key;queueDraft();}

$("connect-form").addEventListener("submit",event=>{event.preventDefault();run("Open workspace",async()=>{
  await flushDraft();
  const client=new AuditExchangeClient({baseUrl:$("server-url").value.trim(),workspaceId:$("workspace-pin").value.trim()||undefined});
  const state=await client.connect();S.client=client;S.state=state;S.detail=null;S.patches=[];S.edition=null;S.pending=null;S.analysisRefreshPaused=false;S.activeAnalysisId=null;
  localStorage.setItem("audit-exchange:last-connection",JSON.stringify({url:client.baseUrl,workspaceId:state.workspaceId}));
  clearDetailView();renderState();await reconcilePending();restoreDraft();notice("Opened "+state.name+".");
});});
$("refresh").addEventListener("click",()=>run("Refresh original workspace",()=>refresh()));
all("[data-section]").forEach(button=>button.addEventListener("click",()=>run("Open section",()=>showSection(button.dataset.section))));
all("[data-inspector]").forEach(button=>button.addEventListener("click",()=>showInspector(button.dataset.inspector)));
$("source-picker").addEventListener("submit",event=>{event.preventDefault();run("Open source revision",()=>openSource($("source-select").value,$("revision-select").value||undefined));});
$("source-select").addEventListener("change",()=>run("Read selected source revisions",async()=>{
  const id=$("source-select").value;if(!id)return;const detail=await S.client.read("source.get",{sourceId:id});
  setOptions($("revision-select"),detail.revisions.map(r=>[r.id,"Revision "+r.number+" · "+date(r.createdAt)]),{value:detail.revision.id});
}));
$("open-current").addEventListener("click",()=>run("Open current source revision",()=>openSource(requireDetail().source.id)));
$("entity-query").addEventListener("input",renderEntities);$("entity-kind").addEventListener("change",renderEntities);
$("field-query").addEventListener("input",renderFields);$("field-entity").addEventListener("change",renderFields);$("series-query").addEventListener("input",renderSeries);
$("entity-fields").addEventListener("click",()=>{if(S.activeEntity){$("field-entity").value=S.activeEntity.key;renderFields();showInspector("fields");}});
$("entity-review").addEventListener("click",()=>run("Prepare entity review",async()=>{clearReview();await showSection("reviews");}));
$("entity-link").addEventListener("click",()=>run("Prepare related record",async()=>{clearLink();await showSection("links");}));
$("field-form").addEventListener("submit",event=>{event.preventDefault();run("Stage field correction",async()=>{
  requireCurrent();const field=S.activeField;if(!field?.editable)throw new Error("Select an editable source field.");
  const value=$("field-after").value;S.patches=S.patches.filter(row=>row.key!==field.key);
  if(value!==field.value)S.patches.push({key:field.key,name:field.name,path:field.path,kind:field.kind,...(field.attributeName?{attributeName:field.attributeName}:{}),expected:field.value,value});
  renderPatches();queueDraft();notice(value===field.value?"The exact value is unchanged.":"Added the exact correction to this revision's draft.");
});});
$("clear-patches").addEventListener("click",()=>run("Clear correction draft",async()=>{if(S.patches.length&&!confirm("Clear the staged field corrections for this source revision?"))return;S.patches=[];renderPatches();queueDraft();}));
$("patch-form").addEventListener("submit",event=>{event.preventDefault();run("Save complete field correction",async()=>{
  const d=requireCurrent();if(!S.patches.length)throw new Error("Stage one or more field corrections first.");
  const patches=S.patches.map(({key,name,...patch})=>patch);
  const result=await mutate("source.patch",{sourceId:d.source.id,expectedRevisionId:d.revision.id,patches,actor:operator(),note:$("patch-note").value});
  S.patches=[];clearTimeout(S.draftTimer);S.draftTimer=null;S.draftSnapshot=null;saveDraft(snapshotDraft());await openSource(result.sourceId,result.revisionId);showInspector("validation");
});});
$("validate-form").addEventListener("submit",event=>{event.preventDefault();run("Validate complete source",async()=>{
  const d=requireCurrent(),result=await mutate("source.validate",{sourceId:d.source.id,expectedRevisionId:d.revision.id,selectedSchema:$("validate-schema").value,profileIds:readProfiles("validate-profiles"),actor:operator(),note:$("validate-note").value});
  await openSource(result.sourceId,result.revisionId);showInspector("validation");
});});
$("import-file").addEventListener("change",()=>run("Read original XML",()=>selectFile("import",$("import-file").files[0])));
$("replace-file").addEventListener("change",()=>run("Read replacement XML",()=>selectFile("replace",$("replace-file").files[0])));
$("weather-file").addEventListener("change",()=>run("Read original weather CSV",()=>selectFile("weather",$("weather-file").files[0])));
$("receive-file").addEventListener("change",()=>run("Read original case package",()=>selectFile("receive",$("receive-file").files[0])));
$("xml-drop").addEventListener("keydown",event=>{if(event.target===$("xml-drop")&&["Enter"," "].includes(event.key)){event.preventDefault();$("import-file").click();}});
for(const name of ["dragenter","dragover"])$("xml-drop").addEventListener(name,event=>{event.preventDefault();$("xml-drop").dataset.drag="true";});
$("xml-drop").addEventListener("dragleave",()=>{$("xml-drop").dataset.drag="false";});
$("xml-drop").addEventListener("drop",event=>{event.preventDefault();$("xml-drop").dataset.drag="false";const files=event.dataTransfer.files;if(files.length!==1){notice("Drop one complete XML document at a time.","error");return;}run("Read dropped original XML",()=>selectFile("import",files[0]));});
$("import-form").addEventListener("submit",event=>{event.preventDefault();run("Import complete XML source",async()=>{
  if(!S.importFile)throw new Error("Choose the complete original XML file.");
  const result=await mutate("source.import",{name:$("import-name").value,contentBase64:await auditFileBase64(S.importFile),selectedSchema:$("import-schema").value,profileIds:readProfiles("import-profiles"),actor:operator(),note:$("import-note").value});
  S.importFile=null;$("import-file").value="";$("import-file-status").textContent="Complete original XML retained.";await openSource(result.sourceId,result.revisionId);showInspector("validation");
});});
$("replace-form").addEventListener("submit",event=>{event.preventDefault();run("Save complete replacement revision",async()=>{
  const d=requireCurrent();if(!S.replaceFile)throw new Error("Choose the complete replacement XML.");
  const result=await mutate("source.replace",{sourceId:d.source.id,expectedRevisionId:d.revision.id,contentBase64:await auditFileBase64(S.replaceFile),selectedSchema:$("replace-schema").value,profileIds:readProfiles("replace-profiles"),actor:operator(),note:$("replace-note").value});
  await openSource(result.sourceId,result.revisionId);showInspector("validation");
});});
$("download-xml").addEventListener("click",()=>run("Export selected complete XML",async()=>{const d=requireDetail();await exportFile({kind:"xml",sourceId:d.source.id,revisionId:d.revision.id,note:"Complete selected source revision."});}));
$("copy-xml").addEventListener("click",()=>run("Copy complete displayed XML",async()=>{await navigator.clipboard.writeText(requireDetail().xmlText);notice("Copied the complete displayed XML text. The XML export retains its complete original bytes.");}));
$("compare-form").addEventListener("submit",event=>{event.preventDefault();run("Compare complete source revisions",async()=>{const d=requireDetail();renderComparison(await S.client.read("source.compare",{sourceId:d.source.id,fromRevisionId:$("compare-before").value,toRevisionId:$("compare-after").value}));});});
$("edition-form").addEventListener("submit",event=>{event.preventDefault();run("Save complete workspace edition",async()=>{const result=await mutate("edition.save",{name:$("edition-name").value,note:$("edition-note").value,actor:operator()});await openEdition(result.editionId);});});
$("export-edition-review").addEventListener("click",()=>run("Export saved edition review",()=>exportFile({kind:"review",editionId:S.edition.id,note:"Review of saved edition "+S.edition.number+"."})));
$("export-edition-workspace").addEventListener("click",()=>run("Export complete saved workspace",()=>exportFile({kind:"workspace",editionId:S.edition.id,note:"Complete workspace including saved edition "+S.edition.number+"."})));
$("review-filter").addEventListener("change",renderReviews);$("review-query").addEventListener("input",renderReviews);
$("new-review").addEventListener("click",()=>run("Prepare new review",async()=>{clearReview();await showSection("reviews");}));
$("review-form").addEventListener("submit",event=>{event.preventDefault();run("Save source-bound review",async()=>{
  const d=requireDetail();const input={...($("review-id").value?{id:$("review-id").value}:{}),sourceId:d.source.id,revisionId:d.revision.id,...($("review-entity").value?{entityKey:$("review-entity").value}:{}),status:$("review-status").value,title:$("review-title").value,note:$("review-note").value,assignee:$("review-assignee").value,dueDate:$("review-due").value,evidence:parseEvidence($("review-evidence").value),actor:operator()};
  const result=await mutate("review.save",input);$("review-id").value=result.reviewId;S.dirtyForms.delete("review-form");queueDraft();
});});
$("new-link").addEventListener("click",()=>run("Prepare related workspace record",async()=>{clearLink();await showSection("links");}));
$("link-form").addEventListener("submit",event=>{event.preventDefault();run("Save explicit workspace join",async()=>{
  const d=requireDetail(),result=await mutate("link.save",{...($("link-id").value?{id:$("link-id").value}:{}),sourceId:d.source.id,revisionId:d.revision.id,entityKey:$("link-entity").value,targetKind:$("link-kind").value,targetWorkspaceId:$("link-workspace").value,targetRecordId:$("link-record").value,note:$("link-note").value,actor:operator()});$("link-id").value=result.linkId;S.dirtyForms.delete("link-form");queueDraft();
});});
all("[data-native-option]").forEach(input=>input.addEventListener("change",updateNativeOption));
$("model-options").addEventListener("input",syncNativeOptions);
$("analysis-resume-form").addEventListener("submit",event=>{event.preventDefault();run("Resume the same native analysis",async()=>{
  const retained=(S.state?.analysisRuns||[]).find(row=>analysisId(row)===S.activeAnalysisId);
  if(!canResumeAnalysis(retained))throw new Error("Read the retained native outcome before continuing this analysis.");
  const result=await mutate("analysis.resume",{analysisId:analysisId(retained),actor:operator(),note:$("analysis-resume-note").value});
  S.dirtyForms.delete("analysis-resume-form");renderAnalysisResult(result);queueDraft();
});});
for(const id of ["analysis-building","analysis-scenario","analysis-resource","analysis-reading-type","analysis-units","analysis-stream"])$(id).addEventListener("change",()=>renderAnalysisChoices(id));
$("analysis-preview-form").addEventListener("submit",event=>{event.preventDefault();run("Preview complete selected readings",async()=>{
  const selection=analysisSelection(),result=await S.client.read("analysis.preview",selection);S.analysisInput=clone(selection);S.analysisPreview=result;$("analysis-preview").hidden=false;pairList("analysis-selection",Object.entries(result.selection).map(([name,value])=>[name,value!==null&&typeof value==="object"?details("Complete native "+name,value):literal(text(value))]));table("analysis-readings",result.readings,seriesColumns());diagnostics("analysis-diagnostics",result.diagnostics);$("analysis-native-profile").textContent=json(result.nativeProfile);updateControls();
});});
$("analysis-form").addEventListener("submit",event=>{event.preventDefault();run("Run native analysis",async()=>{
  if(!S.analysisPreview||JSON.stringify(analysisSelection())!==JSON.stringify(S.analysisInput))throw new Error("Preview the current exact reading selection first.");
  if(!S.weatherFile)throw new Error("Choose the actual weather CSV for this run.");
  const modelOptions=nativeOptions();
  if(!modelOptions.weatherUnits||!modelOptions.weatherInterval)throw new Error("Choose the actual observed weather units and interval before retaining this run.");
  const result=await mutate("analysis.run",{...S.analysisInput,weatherCsvBase64:await auditFileBase64(S.weatherFile),weatherName:S.weatherFile.name,weatherSource:$("weather-source").value,modelOptions,actor:operator(),note:$("analysis-note").value});renderAnalysisResult(result);
});});
for(const id of ["projection-assets","projection-documents","projection-requirements"])$(id).addEventListener("change",()=>{S.projectionPreview=null;S.projectionInput=null;$("projection-preview").hidden=true;updateControls();});
$("projection-preview-form").addEventListener("submit",event=>{event.preventDefault();run("Preview all turnover tables",async()=>{const input=projectionSelection(),result=await S.client.read("projection.preview",input);S.projectionInput=clone(input);renderProjection(result);});});
$("projection-save-form").addEventListener("submit",event=>{event.preventDefault();run("Save complete turnover projection",async()=>{
  if(!S.projectionPreview||JSON.stringify(projectionSelection())!==JSON.stringify(S.projectionInput))throw new Error("Preview this exact source selection before saving.");
  const result=await mutate("projection.save",{...S.projectionInput,expectedSelectionSha256:S.projectionPreview.selectionSha256,actor:operator(),note:$("projection-note").value});
  const exported=await S.client.read("export.get",{exportId:result.exportId});$("projection-result").replaceChildren(action("Download "+exported.name,()=>download(exported)));notice("Saved the complete projection and original source XML.");
});});
$("export-kind").addEventListener("change",updateExportBinding);$("export-edition").addEventListener("change",updateExportBinding);
$("export-form").addEventListener("submit",event=>{event.preventDefault();run("Prepare complete retained export",async()=>{
  const kind=$("export-kind").value,editionId=$("export-edition").value,input={kind,note:$("export-note").value};
  if(kind==="xml"){const d=requireDetail();input.sourceId=d.source.id;input.revisionId=d.revision.id;}
  else if(editionId)input.editionId=editionId;
  await exportFile(input);
});});
$("receive-form").addEventListener("submit",event=>{event.preventDefault();run("Receive complete exported case",async()=>{
  if(!S.receiveFile)throw new Error("Choose the original complete exported case.");
  const result=await mutate("workspace.receive",{contentBase64:await auditFileBase64(S.receiveFile),name:S.receiveFile.name,actor:operator(),note:$("receive-note").value});
  $("receive-result").hidden=false;$("receive-result-json").textContent=json(result);S.receiveFile=null;$("receive-file").value="";$("receive-file-status").textContent="Complete case received.";
});});
$("recover-file-form").addEventListener("submit",event=>{event.preventDefault();run("Open complete original request file",async()=>{
  if(!S.state)throw new Error("Open the original workspace first.");
  const file=$("recover-file").files[0];if(!file)throw new Error("Choose the complete downloaded original request.");
  const row=JSON.parse(await file.text());
  if(row.format!=="commons.audit-exchange.pending.v1"||row.workspaceId!==S.state.workspaceId||!row.envelope)throw new Error("This file must be the complete original request for the connected workspace.");
  const envelope=S.client.envelope(row.envelope.action,row.envelope.inputs,{requestId:row.envelope.requestId,expectedVersion:row.envelope.expectedVersion});
  await pendingTransaction((pending,closed,done)=>{
    const get=pending.get(row.workspaceId);get.onsuccess=()=>{
      const existing=get.result,marker=localPending(row.workspaceId);
      if((existing&&requestOf(existing)!==envelope.requestId)||(marker&&requestOf(marker)!==envelope.requestId)){done(false);return;}
      const restored={...row,envelope,status:row.status||"outcome unknown"};
      pending.put(restored);localStorage.setItem(pendingKey(row.workspaceId),JSON.stringify(pendingMarker(restored)));done(true);
    };
  }).then(restored=>{if(!restored)throw new Error("Another original request is already retained for this workspace.");});
  await reconcilePending();notice("Opened the complete original request. Recover it with its original identity and inputs.");
});});
$("recover-request").addEventListener("click",()=>run("Recover original retained request",async()=>{await reconcilePending();const actionName=S.pending?.envelope.action,originalInputs=clone(S.pending?.envelope.inputs||{}),result=await executePending();await refresh();if(result?.sourceId&&result?.revisionId)await openSource(result.sourceId,result.revisionId);else if(["analysis.run","analysis.resume"].includes(actionName))renderAnalysisResult(result);else if(actionName==="export.create")await download(result);else if(actionName==="return.apply")await correctionDesk.recovered(result,originalInputs);else if(actionName==="workspace.receive"){$("receive-result").hidden=false;$("receive-result-json").textContent=json(result);}notice("Recovered the original "+actionName+" result.");}));
$("download-request").addEventListener("click",()=>{if(S.pending)downloadBytes(json(S.pending)+"\n","audit-original-request-"+S.pending.envelope.requestId+".json","application/json");});
$("close-refused").addEventListener("click",()=>run("Close refused original request",async()=>{await reconcilePending();if(S.pending?.status!=="refused")throw new Error("Recover the original result before closing this request.");await closePending(null,"server refused");await refresh();notice("Closed the refused request. Review the current workspace before preparing a new change.");}));
document.addEventListener("input",event=>{if(event.target.matches("[data-draft]")){if(event.target.form?.id)S.dirtyForms.add(event.target.form.id);queueDraft();}if(event.target===$("actor"))localStorage.setItem("audit-exchange:operator",$("actor").value);});
document.addEventListener("change",event=>{if(event.target.matches("[data-draft]")){if(event.target.form?.id)S.dirtyForms.add(event.target.form.id);queueDraft();}});
window.addEventListener("storage",event=>{if(S.state&&event.key===pendingKey(S.state.workspaceId)&&!S.busy)run("Reconcile original request from another tab",reconcilePending);});
document.addEventListener("visibilitychange",()=>scheduleAnalysisRefresh());
window.addEventListener("beforeunload",event=>{try{if(S.draftSnapshot)saveDraft(S.draftSnapshot);}catch{}if(S.busy||S.draftError){event.preventDefault();event.returnValue="";}});
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden"&&S.draftSnapshot){try{saveDraft(S.draftSnapshot);S.draftSnapshot=null;clearTimeout(S.draftTimer);}catch{}}});
$("server-url").value=location.origin+"/";$("actor").value=localStorage.getItem("audit-exchange:operator")||"";
try{const previous=JSON.parse(localStorage.getItem("audit-exchange:last-connection")||"null");if(previous&&new URL(previous.url).origin===location.origin){$("server-url").value=previous.url;$("workspace-pin").value=previous.workspaceId;}}catch{}
correctionDesk=mountCorrectionDesk({state:()=>S.state,busy:()=>S.busy,pending:()=>S.pending,tabId:()=>S.tabId,read:(...args)=>S.client.read(...args),mutate,run,operator,download,downloadBytes,exportFile,openSource,notice,fileBase64:auditFileBase64});
syncNativeOptions();updateControls();
