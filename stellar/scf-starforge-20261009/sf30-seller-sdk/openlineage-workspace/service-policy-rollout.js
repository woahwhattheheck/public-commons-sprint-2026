// MIT. Complete multi-job service policy commissioning on the original workspace protocol.
const $ = id => document.getElementById(id);
const PLAN_SCHEMA = "commons.openlineage.service-policy-plan.v1";
const WORKING_SCHEMA = "commons.openlineage.service-policy-working.v1";
const POLICY_FIELDS = ["id","title","jobKey","owner","runbook","enabled","effectiveFrom","maxCompletionAgeSeconds","maxDurationSeconds","failureWindowSeconds","monitorFailures"];
const NUMBER_FIELDS = ["maxCompletionAgeSeconds","maxDurationSeconds","failureWindowSeconds"];
const LABELS = {title:"Policy title",jobKey:"Job",owner:"Owner",runbook:"Runbook",enabled:"Enabled",effectiveFrom:"Effective from",maxCompletionAgeSeconds:"Completion freshness (seconds)",maxDurationSeconds:"Execution duration (seconds)",failureWindowSeconds:"Failure window (seconds)",monitorFailures:"Monitor failures",id:"Policy ID"};
const JOURNAL_KEY = location.origin + "/service-policy-rollout";
const TOKEN_KEY = "openlineage-access:" + JOURNAL_KEY;
const s = {identity:null,data:null,connected:false,pending:null,pendingBusy:false,readBusy:false,busy:false,closing:false,
  draft:null,draftVersion:0,serial:0,savedSerial:0,preview:null,previewSerial:null,selectedRow:null,selectedRows:new Set(),selectedRollout:null,
  draftError:null,section:"draft",drafts:[],foreignPending:null};
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
const tasks = new Set(), urls = new Set();
let accessToken = "", dbPromise, draftTimer = null, saveQueue = Promise.resolve(), closePromise;
try { accessToken = sessionStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem("openlineage-access:" + location.origin + "/service-levels") ?? sessionStorage.getItem("openlineage-access:" + location.origin + "/") ?? ""; } catch {}
const clone = value => JSON.parse(JSON.stringify(value));
const pendingStatuses = new Set(["prepared","submitting","uncertain","blocked","conflict","rejected","complete"]);
const cancellableStatuses = new Set(["prepared","blocked","conflict","rejected"]);
const fmt = value => Number(value || 0).toLocaleString();
const when = value => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { timeZoneName: "short" }) : String(value);
};
const words = value => String(value ?? "—").replaceAll("-", " ");
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false || name === "value") continue;
    if (name.startsWith("on") && typeof value === "function") el.addEventListener(name.slice(2).toLowerCase(), value);
    else if (name === "className") el.className = value;
    else if (["disabled", "checked", "hidden", "open"].includes(name)) el[name] = Boolean(value);
    else el.setAttribute(name, value === true ? "" : String(value));
  }
  const add = value => {
    if (Array.isArray(value)) value.forEach(add);
    else if (value !== null && value !== undefined && value !== false) el.append(value instanceof Node ? value : document.createTextNode(String(value)));
  };
  children.forEach(add);
  if (attrs.value !== undefined) el.value = String(attrs.value);
  return el;
}
function btn(label, fn, attrs = {}) { return h("button", { type: "button", onclick: fn, ...attrs }, label); }
function badge(value, emphasis = false) { return h("span", { className: "badge" + (emphasis ? " emphasis" : "") }, words(value)); }
function jobParts(key) { try { const p = JSON.parse(key); return { namespace: p[1], name: p[2] }; } catch { return { namespace: "", name: String(key || "—") }; } }
function jobLabel(key) { const p = jobParts(key); return p.name + (p.namespace ? " · " + p.namespace : ""); }
function jobCell(key) { const p = jobParts(key); return h("div", {}, h("span", { className: "job-name" }, p.name), h("span", { className: "job-namespace" }, p.namespace)); }
function duration(value) {
  if (value === null || value === undefined) return "Not set";
  for (const [unit, name] of [[86400, "days"], [3600, "hours"], [60, "minutes"]]) if (value % unit === 0) return fmt(value / unit) + " " + name;
  return fmt(value) + " seconds";
}
function record(entries) { return h("dl", { className: "record-fields" }, entries.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v ?? "—")])); }
function jsonBlock(label, value, open = false) { return h("details", { className: "json-block", open }, h("summary", {}, label), h("pre", {}, JSON.stringify(value, null, 2))); }
function table(headers, rows, caption) {
  return h("div", { className: "table-wrap" }, h("table", {}, h("caption", { className: "sr-only" }, caption),
    h("thead", {}, h("tr", {}, headers.map(v => h("th", { scope: "col" }, v)))), h("tbody", {}, rows)));
}
function empty(title, text, buttons = []) { return h("div", { className: "empty" }, h("h3", {}, title), h("p", {}, text), buttons.length ? h("div", { className: "button-row" }, buttons) : null); }
function safeLink(value, label = "Open runbook") {
  try { const url = new URL(value); if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return h("a", { href: url.href, target: "_blank", rel: "noopener noreferrer" }, label); } catch {}
  return value ? h("span", {}, value) : "—";
}
function notice(message, error = false) {
  $("notice").textContent = message || ""; $("notice").hidden = !message;
  $("notice").classList.toggle("error", error); $("notice").setAttribute("role", error ? "alert" : "status");
}
function failFeedback(id, error) { $(id).textContent = error.message || String(error); }
function openDialog(id) { if (!$(id).open) $(id).showModal(); }
function closeDialog(id) { $(id).close(); }
function download(blob, name) { ownedDownload(blob, name); }
function downloadJSON(value, name) { download(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }), name); }
function localTime(value = new Date().toISOString()) {
  const d = new Date(value), pad = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}
function fromLocal(value, label) {
  if (!value || !Number.isFinite(new Date(value).getTime())) throw new Error("Choose a valid " + label + ".");
  return new Date(value).toISOString();
}

class RequestError extends Error {
  constructor(message,status=0,details=null){super(message);this.status=status;this.details=details;}
}
function tracked(fn){return(...args)=>{if(args[0]?.type==="submit")args[0].preventDefault();if(s.closing)return;const task=Promise.resolve().then(()=>fn(...args));tasks.add(task);task.catch(error=>notice(error.message,true)).finally(()=>tasks.delete(task));return task;};}
async function response(path,options={},unbound=false){
  if(s.closing && !s.pendingBusy)throw new Error("The operator is closing.");
  const headers=new Headers(options.headers??{});
  if(accessToken)headers.set("Authorization","Bearer "+accessToken);
  if(!unbound&&s.identity){headers.set("X-OpenLineage-Workspace",s.identity.workspaceId);headers.set("X-OpenLineage-Instance",s.identity.instanceId);}
  const aborter=new AbortController(),timer=setTimeout(()=>aborter.abort(),45000);
  try{
    const result=await fetch(path,{...options,headers,signal:aborter.signal,credentials:"same-origin",cache:"no-store"});
    if(!result.ok){let body;try{body=await result.json();}catch{body={};}
      const message=typeof body.error==="string"?body.error:body.error?.message??body.message??result.statusText;
      if(result.status===401)openDialog("connection-dialog");
      throw new RequestError(message||"Workspace request failed.",result.status,body.details??body.error?.details??null);}
    try{return await result.json();}catch{throw new RequestError("The workspace returned an unreadable response.",502);}
  }catch(error){if(error instanceof RequestError)throw error;throw new RequestError(error.name==="AbortError"?"The workspace response did not arrive in time.":"The workspace connection was interrupted.");}
  finally{clearTimeout(timer);}
}
const action=(name,args={})=>response("/api/action",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:name,args})});
function database(){
  if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB){reject(new Error("Browser request storage is unavailable. Download your unfinished work."));return;}
    const request=indexedDB.open("openlineage-operator",1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains("pending"))request.result.createObjectStore("pending");};
    request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();dbPromise=null;};resolve(request.result);};
    request.onerror=()=>{dbPromise=null;reject(new Error("The browser could not open saved work."));};
    request.onblocked=()=>{notice("Close the older workspace tab blocking browser storage. This original storage request will continue when it closes.",true);};
  });
  return dbPromise;
}
async function journal(mode,value){
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("pending",mode==="read"?"readonly":"readwrite"),store=tx.objectStore("pending"),read=store.get(JOURNAL_KEY);
    let found,message="";
    read.onsuccess=()=>{
      found=read.result;if(mode==="read")return;
      const clearing=mode==="clear"||mode==="cancel",existingId=found?.args?.operationId,nextId=clearing?value:value?.args?.operationId;
      if(existingId&&existingId!==nextId){message="Another saved request is active. Recover its original input first.";tx.abort();return;}
      if(mode==="write"&&existingId===nextId&&found.body!==value.body){message="The saved request body changed in another tab.";tx.abort();return;}
      if(mode==="cancel"&&found&&(!cancellableStatuses.has(found.status)||found.uncertainOutcome)){message="The original request may have reached the workspace. Recover it first.";tx.abort();return;}
      if(clearing)store.delete(JOURNAL_KEY);else{if(found?.status==="complete"&&value.status!=="complete"){message="This original request is already saved. Reopen its complete result.";tx.abort();return;}store.put(value,JOURNAL_KEY);}
    };
    tx.oncomplete=()=>resolve(found);tx.onerror=tx.onabort=()=>reject(new Error(message||"The browser could not retain the exact request."));
  });
}
function validPending(p){
  if(!p||p.action!=="service-policy-rollout.apply"||typeof p.body!=="string"||!p.args?.operationId||!pendingStatuses.has(p.status)||typeof p.workspaceId!=="string")return false;
  try{const body=JSON.parse(p.body);return body.action===p.action&&JSON.stringify(body.args)===JSON.stringify(p.args);}catch{return false;}
}
function sameJSON(a,b){
  if(a===b)return true;
  if(a===null||b===null||typeof a!=="object"||typeof b!=="object"||Array.isArray(a)!==Array.isArray(b))return false;
  const keys=Object.keys(a),other=Object.keys(b);
  return keys.length===other.length&&keys.every(key=>Object.hasOwn(b,key)&&sameJSON(a[key],b[key]));
}
function adoptPending(found){
  if(s.pending?.status==="complete")return s.pending;
  s.pending=found;return found;
}
async function retain(p){
  if(p.status==="complete")s.pending=p;
  try{await journal("write",p);s.pending=p;}
  catch(error){adoptPending(await journal("read").catch(()=>s.pending));throw error;}
  finally{renderPending();controls();}
}
async function clearPending(cancel=false){
  const id=s.pending?.args?.operationId;if(!id)return;
  try{await journal(cancel?"cancel":"clear",id);s.pending=null;}catch(error){adoptPending(await journal("read").catch(()=>s.pending));throw error;}finally{renderPending();controls();}
}
function draftPrefix(){return JOURNAL_KEY+"/draft/"+encodeURIComponent(s.identity.workspaceId)+"/";}
function draftKey(id){return draftPrefix()+id;}
function newDraft(){const now=new Date().toISOString();return{id:crypto.randomUUID(),workspaceId:s.identity.workspaceId,createdAt:now,updatedAt:now,state:{title:"",reason:"",rows:[]}};}
function rawPolicy(policy){const p={};for(const key of POLICY_FIELDS){const value=policy[key];p[key]=NUMBER_FIELDS.includes(key)?(value===null||value===undefined?"":String(value)):key==="id"?(value??null):value;}return p;}
function assertDraft(d){
  if(!d||typeof d.id!=="string"||d.workspaceId!==s.identity.workspaceId||!d.state||typeof d.state.title!=="string"||typeof d.state.reason!=="string"||!Array.isArray(d.state.rows)||d.state.rows.length>200)throw new Error("Choose a complete working file from this workspace.");
  const ids=new Set();for(const row of d.state.rows){if(!/^[A-Za-z0-9_.:-]{1,120}$/.test(row.rowId)||ids.has(row.rowId)||!row.policy||!POLICY_FIELDS.every(key=>Object.hasOwn(row.policy,key)))throw new Error("The working row is incomplete.");ids.add(row.rowId);
    if(row.expectedVersion!==null&&(!Number.isSafeInteger(row.expectedVersion)||row.expectedVersion<1))throw new Error("The policy version is invalid.");
    for(const key of POLICY_FIELDS){const value=row.policy[key];if(["enabled","monitorFailures"].includes(key)){if(typeof value!=="boolean")throw new Error("The policy setting is invalid.");}else if(key==="id"){if(value!==null&&typeof value!=="string")throw new Error("The policy ID is invalid.");}else if(typeof value!=="string")throw new Error("The unfinished policy fields must remain text.");}
  }
  return d;
}
async function draftTransaction(snapshot,expected){
  const db=await database(),prefix=draftPrefix(),key=prefix+snapshot.id;
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("pending","readwrite"),store=tx.objectStore("pending"),request=store.get(key);let saved,forked=false;
    request.onsuccess=()=>{
      const prior=request.result;
      if((prior?.version??0)!==expected){forked=true;snapshot={...snapshot,id:crypto.randomUUID(),forkedFrom:{id:snapshot.id,version:expected},createdAt:new Date().toISOString()};}
      saved={...snapshot,kind:"service-policy-rollout-draft",version:forked?1:expected+1,updatedAt:new Date().toISOString()};
      store.put(saved,prefix+saved.id);
    };
    tx.oncomplete=()=>resolve({saved,forked});tx.onerror=tx.onabort=()=>reject(new Error("The unfinished draft could not be saved. Download this current work before closing."));
  });
}
function queueSave(){
  if(!s.draft)return saveQueue;
  const snapshot=clone(s.draft),serial=s.serial,sourceId=s.draft.id;
  saveQueue=saveQueue.catch(()=>{}).then(async()=>{
    if(!s.draft||s.draft.id!==sourceId)return;
    try{
      const result=await draftTransaction(snapshot,s.draftVersion);
      if(s.draft?.id===sourceId){s.draft.id=result.saved.id;s.draft.createdAt=result.saved.createdAt;s.draft.updatedAt=result.saved.updatedAt;s.draftVersion=result.saved.version;s.draft.version=result.saved.version;s.savedSerial=serial;s.draftError=null;
        if(result.forked){s.draft.forkedFrom=result.saved.forkedFrom;notice("Another tab saved that draft. Your unfinished work is preserved as a separate draft.");if(s.serial>serial){if(draftTimer)clearTimeout(draftTimer);draftTimer=setTimeout(()=>{draftTimer=null;queueSave();},0);}}
        try{sessionStorage.setItem(JOURNAL_KEY+"/draft-selection/"+s.identity.workspaceId,s.draft.id);}catch{}
      }
    }catch(error){s.draftError=error.message;throw error;}finally{renderDraftStatus();controls();}
  });
  saveQueue.catch(error=>notice(error.message,true));return saveQueue;
}
async function flushDraft(){if(draftTimer){clearTimeout(draftTimer);draftTimer=null;}await saveQueue.catch(()=>{});while(s.draft&&s.savedSerial!==s.serial){await queueSave();}if(s.draftError)throw new Error(s.draftError);}
function changed(){
  s.serial++;s.preview=null;s.previewSerial=null;if(draftTimer)clearTimeout(draftTimer);
  draftTimer=setTimeout(()=>{draftTimer=null;queueSave();},300);renderPreview();renderDraftStatus();controls();
}
async function listDrafts(){
  const db=await database(),prefix=draftPrefix();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("pending","readonly"),request=tx.objectStore("pending").openCursor(IDBKeyRange.bound(prefix,prefix+"\uffff")),rows=[];
    request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;const value=cursor.value;if(value?.kind==="service-policy-rollout-draft"&&value.workspaceId===s.identity.workspaceId)rows.push(value);cursor.continue();};
    tx.oncomplete=()=>resolve(rows.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));tx.onerror=()=>reject(new Error("Saved drafts could not be listed."));
  });
}
async function chooseDraft(d){
  assertDraft(d);s.draft=clone(d);s.draftVersion=d.version??0;s.serial=0;s.savedSerial=0;s.draftError=null;s.preview=null;s.previewSerial=null;s.selectedRows.clear();s.selectedRow=d.state.rows[0]?.rowId??null;renderDraft();renderPreview();
  try{sessionStorage.setItem(JOURNAL_KEY+"/draft-selection/"+s.identity.workspaceId,d.id);}catch{}
}
async function openDraftChooser(){
  await flushDraft();s.drafts=await listDrafts();
  $("draft-list").replaceChildren(s.drafts.length?table(["Draft","Rows","Saved","Open"],s.drafts.map(d=>h("tr",{},h("td",{},d.state.title||"Untitled rollout"),h("td",{},d.state.rows.length),h("td",{},when(d.updatedAt)),h("td",{},btn("Open",tracked(async()=>{await flushDraft();await chooseDraft(d);closeDialog("drafts-dialog");}))))),"Saved working drafts"):empty("No saved drafts","Start a rollout and its unfinished input will be retained here."));
  openDialog("drafts-dialog");
}
async function connect(){
  if(s.busy||s.readBusy||s.pendingBusy)throw new Error("Wait for the current operation before reconnecting.");
  const identity=await response("/api/identity",{},true),expected=s.pending?.workspaceId??s.identity?.workspaceId;
  if(!identity?.workspaceId||!identity?.instanceId)throw new Error("The workspace identity is incomplete.");
  if(expected&&identity.workspaceId!==expected)throw new Error("This address serves another workspace. Reconnect to the original workspace.");
  s.identity=identity;await refresh();
  if(!s.draft){const drafts=await listDrafts();let selected;try{selected=sessionStorage.getItem(JOURNAL_KEY+"/draft-selection/"+identity.workspaceId);}catch{}
    await chooseDraft(drafts.find(d=>d.id===selected)??drafts[0]??newDraft());}
}
async function refresh(){
  if(!s.identity)throw new Error("Connect to the workspace first.");if(s.readBusy||s.pendingBusy)return;
  s.readBusy=true;controls();
  try{const data=await action("service-policy-rollout.read");
    if(data.workspaceId!==s.identity.workspaceId||!Number.isSafeInteger(data.revision)||!Array.isArray(data.jobs)||!Array.isArray(data.policies)||!Array.isArray(data.rollouts))throw new Error("The rollout workspace response is incomplete.");
    s.data=data;s.connected=true;
    if(s.preview&&s.preview.sourceRevision!==data.revision){s.preview=null;s.previewSerial=null;}
    $("workspace-title").textContent=data.workspaceId;$("revision-label").textContent="Revision "+data.revision;
    $("connection-state").textContent="Connected · "+timeZone;$("last-refreshed").textContent="Refreshed "+when(new Date().toISOString());renderAll();
  }catch(error){s.connected=false;$("connection-state").textContent="Connection needs attention";throw error;}
  finally{s.readBusy=false;renderPending();controls();}
}

function locked(){return !s.connected||!s.data||!s.draft||Boolean(s.pending)||s.pendingBusy||s.busy||s.readBusy||s.closing;}
function controls(){
  const disabled=locked();
  document.querySelectorAll("[data-edit]").forEach(node=>{node.disabled=disabled;});
  document.querySelectorAll("[data-read]").forEach(node=>{node.disabled=!s.connected||s.readBusy||s.pendingBusy||s.busy||s.closing;});
  $("refresh-button").disabled=s.readBusy||s.pendingBusy||s.busy||s.closing;
  $("connection-button").disabled=s.readBusy||s.pendingBusy||s.busy||s.closing;
  $("preview-button").disabled=disabled||!s.draft?.state.rows.length;
  $("apply-button").disabled=disabled||!s.preview||s.previewSerial!==s.serial||s.preview.sourceRevision!==s.data?.revision||!(s.preview.counts.create+s.preview.counts.update);
  $("download-working").disabled=!s.draft;$("bulk-button").disabled=disabled||!s.selectedRows.size;
  $("new-draft").disabled=disabled;$("open-drafts").disabled=disabled;
}
function renderDraftStatus(){
  $("draft-status").textContent=!s.draft?"No working draft":s.draftError?s.draftError:s.savedSerial===s.serial?"Saved in this browser · "+when(s.draft.updatedAt):"Saving unfinished input…";
  $("draft-status").classList.toggle("error",Boolean(s.draftError));
}
function showSection(name){
  s.section=name;for(const key of ["draft","history"])$(key+"-panel").hidden=key!==name;
  document.querySelectorAll("[data-section]").forEach(node=>node.setAttribute("aria-current",node.dataset.section===name?"page":"false"));
}
function renderAll(){renderSummary();renderDraft();renderHistory();renderPreview();renderPending();controls();}
function renderSummary(){
  const d=s.data;if(!d)return;
  $("summary").replaceChildren(...[["Observed jobs",d.jobs.length,"Original captured job identities"],["Current policies",d.policies.length,"Existing versions and histories"],["Saved rollouts",d.rollouts.length,"Immutable before-and-after records"],["Selected changes",s.draft?.state.rows.length??0,"Reviewed and applied together"]].map(([title,count,note])=>h("div",{className:"metric"},h("div",{className:"metric-label"},title),h("div",{className:"metric-value"},fmt(count)),h("div",{className:"metric-note"},note))));
}
function renderDraft(){
  if(!s.draft)return;$("rollout-title").value=s.draft.state.title;$("rollout-reason").value=s.draft.state.reason;
  renderRows();renderEditor();renderDraftStatus();renderSummary();
}
function renderRows(){
  const rows=s.draft?.state.rows??[];
  $("selected-count").textContent=rows.length+" / 200 policies";
  if(!rows.length){$("selected-policies").replaceChildren(empty("Select policies and jobs","Add existing policy versions to update, or observed jobs for new policies."));return;}
  $("selected-policies").replaceChildren(table(["Select","Policy / job","Original version","Proposed conditions","Actions"],rows.map(row=>{
    const p=row.policy,current=p.id?s.data?.policies.find(x=>x.id===p.id):null,stale=Boolean(p.id&&current?.version!==row.expectedVersion);
    return h("tr",{className:row.rowId===s.selectedRow?"selected-row":""},
      h("td",{},h("input",{type:"checkbox",checked:s.selectedRows.has(row.rowId),"aria-label":"Select "+(p.title||jobLabel(p.jobKey)),"data-edit":true,onchange:event=>{event.target.checked?s.selectedRows.add(row.rowId):s.selectedRows.delete(row.rowId);controls();}})),
      h("td",{},h("span",{className:"cell-title"},p.title||"Untitled policy"),jobCell(p.jobKey)),
      h("td",{},p.id?"Version "+row.expectedVersion:"New policy",stale?h("small",{className:"version-note"},"Current version "+(current?.version??"unavailable")):null),
      h("td",{},p.enabled?"Enabled":"Disabled",h("small",{},"Freshness "+(p.maxCompletionAgeSeconds||"—")+" s · duration "+(p.maxDurationSeconds||"—")+" s"),h("small",{},p.monitorFailures?"Failure window "+p.failureWindowSeconds+" s":"Failure monitoring off")),
      h("td",{},h("div",{className:"button-row"},btn("Edit",()=>{s.selectedRow=row.rowId;renderRows();renderEditor();controls();$("policy-title").focus();},{"data-edit":true}),
        p.id?btn(stale?"Review current version":"Review baseline",()=>openBaseline(row),{"data-edit":true}):null,
        btn("Remove",()=>{s.draft.state.rows=s.draft.state.rows.filter(r=>r.rowId!==row.rowId);s.selectedRows.delete(row.rowId);if(s.selectedRow===row.rowId)s.selectedRow=s.draft.state.rows[0]?.rowId??null;changed();renderDraft();controls();},{"data-edit":true}))));
  }),"Selected policies and their original versions"));controls();
}
function renderEditor(){
  const row=s.draft?.state.rows.find(r=>r.rowId===s.selectedRow),box=$("policy-editor");box.hidden=!row;if(!row)return;
  $("policy-heading").textContent=row.policy.title||jobLabel(row.policy.jobKey);
  $("policy-job").textContent=jobLabel(row.policy.jobKey);$("policy-version").textContent=row.policy.id?"Original policy "+row.policy.id+" · version "+row.expectedVersion:"Create a policy for this observed job";
  for(const key of POLICY_FIELDS.filter(k=>!["id","jobKey"].includes(k))){const el=$("policy-"+key);if(!el)continue;if(el.type==="checkbox")el.checked=row.policy[key];else el.value=row.policy[key];}
  $("policy-baseline").replaceChildren(row.baseline?jsonBlock("Complete original policy and history",row.baseline):h("p",{className:"muted"},"This row creates a new policy when the rollout is applied."));
}
function newPolicy(job){
  return{id:null,title:jobParts(job.key).name+" service policy",jobKey:job.key,owner:"",runbook:"",enabled:true,effectiveFrom:new Date().toISOString(),
    maxCompletionAgeSeconds:"",maxDurationSeconds:"",failureWindowSeconds:"86400",monitorFailures:true};
}
function openChooser(){
  if(locked())return;s.chooserJobs=new Set();s.chooserPolicies=new Set();$("source-search").value="";renderChooser();openDialog("source-dialog");
}
function renderChooser(){
  const search=$("source-search").value.trim().toLowerCase(),rows=s.draft?.state.rows??[],ids=new Set(rows.map(r=>r.policy.id).filter(Boolean));
  const match=value=>value.toLowerCase().includes(search),jobs=(s.data?.jobs??[]).filter(j=>match(jobLabel(j.key))),policies=(s.data?.policies??[]).filter(p=>match(p.title+" "+jobLabel(p.jobKey)+" "+p.owner));
  $("source-jobs").replaceChildren(jobs.length?table(["Select","Observed job","Current policies"],jobs.map(j=>h("tr",{},
    h("td",{},h("input",{type:"checkbox","data-source-job":j.key,checked:s.chooserJobs?.has(j.key),"aria-label":"Create policy for "+jobLabel(j.key),onchange:event=>{event.target.checked?s.chooserJobs.add(j.key):s.chooserJobs.delete(j.key);}})),
    h("td",{},jobCell(j.key)),h("td",{},(s.data.policies.filter(p=>p.jobKey===j.key).length||"None")))),"Observed jobs available for a new policy"):empty("No matching observed jobs","Capture the original job events in the main workspace or adjust the search."));
  $("source-policies").replaceChildren(policies.length?table(["Select","Existing policy","Job","Version"],policies.map(p=>h("tr",{},
    h("td",{},h("input",{type:"checkbox","data-source-policy":p.id,checked:s.chooserPolicies?.has(p.id),disabled:ids.has(p.id),"aria-label":"Select "+p.title,onchange:event=>{event.target.checked?s.chooserPolicies.add(p.id):s.chooserPolicies.delete(p.id);}})),
    h("td",{},p.title,ids.has(p.id)?h("small",{},"Already selected"):null),h("td",{},jobCell(p.jobKey)),h("td",{},p.version))),"Existing policies available to update"):empty("No matching policies","Select observed jobs to create their policies."));
}
function addSources(){
  const rows=s.draft.state.rows,selectedPolicies=[...(s.chooserPolicies??[])].map(id=>s.data.policies.find(p=>p.id===id)),
    selectedJobs=[...(s.chooserJobs??[])].map(key=>s.data.jobs.find(j=>j.key===key));
  if(selectedPolicies.some(p=>!p)||selectedJobs.some(j=>!j))throw new Error("The source selection changed. Reopen the original jobs and policies.");
  if(rows.length+selectedPolicies.length+selectedJobs.length>200)throw new Error("A rollout can contain up to 200 policies.");
  const newRows=[...selectedPolicies.map(p=>({rowId:crypto.randomUUID(),expectedVersion:p.version,policy:rawPolicy(p),baseline:clone(p)})),
    ...selectedJobs.map(j=>({rowId:crypto.randomUUID(),expectedVersion:null,policy:newPolicy(j),baseline:null}))];
  if(!newRows.length)throw new Error("Select at least one observed job or existing policy.");
  rows.push(...newRows);s.selectedRow??=newRows[0].rowId;changed();renderDraft();closeDialog("source-dialog");controls();
}
function openBulk(){
  if(!s.selectedRows.size)return;$("bulk-form").reset();$("bulk-selection").textContent=s.selectedRows.size+" selected draft rows";
  $("bulk-feedback").textContent="";openDialog("bulk-dialog");
}
function applyBulk(event){
  event.preventDefault();const fields=[...document.querySelectorAll("[data-bulk-use]:checked")].map(el=>el.dataset.bulkUse);
  if(!fields.length)throw new Error("Choose the settings to change.");
  for(const row of s.draft.state.rows.filter(r=>s.selectedRows.has(r.rowId)))for(const key of fields){const input=$("bulk-"+key);row.policy[key]=["enabled","monitorFailures"].includes(key)?input.value==="true":input.value;}
  changed();renderDraft();closeDialog("bulk-dialog");controls();
}
function displayValue(key,wrapped){
  if(!wrapped?.present)return h("span",{className:"muted"},"Absent");
  const value=wrapped.value;if(key==="jobKey")return jobLabel(value);
  if(value===null)return "Not set";if(typeof value==="boolean")return value?"Yes":"No";
  if(typeof value==="object")return h("pre",{},JSON.stringify(value,null,2));return String(value);
}
function fieldTable(fields){
  return table(["Field","Before","After"],fields.map(f=>h("tr",{},h("th",{scope:"row"},LABELS[f.field]??f.field),h("td",{},displayValue(f.field,f.before)),h("td",{},displayValue(f.field,f.after)))),"Exact policy field changes");
}
function openBaseline(row){
  const current=s.data?.policies.find(p=>p.id===row.policy.id);if(!current)throw new Error("The original policy is unavailable. Refresh the workspace.");
  $("baseline-title").textContent=row.policy.title||"Policy version review";
  $("baseline-body").replaceChildren(h("p",{},"Selected version "+row.expectedVersion+" · current version "+current.version),
    table(["Field","Selected original","Current policy","Your proposal"],POLICY_FIELDS.map(key=>h("tr",{},
      h("th",{scope:"row"},LABELS[key]),h("td",{},displayValue(key,{present:Object.hasOwn(row.baseline??{},key),value:row.baseline?.[key]})),
      h("td",{},displayValue(key,{present:Object.hasOwn(current,key),value:current[key]})),h("td",{},String(row.policy[key]??"Not set")))),"Original, current and proposed policy"),
    jsonBlock("Complete selected history",row.baseline),jsonBlock("Complete current history",current));
  $("baseline-use").disabled=current.version===row.expectedVersion;
  $("baseline-use").onclick=()=>{if(locked())return;row.expectedVersion=current.version;row.baseline=clone(current);changed();renderRows();renderEditor();closeDialog("baseline-dialog");notice("The current policy version is now the reviewed baseline. Your proposed field values are preserved.");controls();};
  openDialog("baseline-dialog");
}
function buildPlan(){
  const state=s.draft.state;
  return{schema:PLAN_SCHEMA,title:state.title,reason:state.reason,rows:state.rows.map(row=>{
    const policy={};for(const key of POLICY_FIELDS){let value=row.policy[key];if(NUMBER_FIELDS.includes(key)){
      if(value===""){if(key==="failureWindowSeconds")throw new Error("Enter a failure window for "+(row.policy.title||jobLabel(row.policy.jobKey))+".");value=null;}
      else{if(!/^[0-9]+$/.test(value)||!Number.isSafeInteger(Number(value)))throw new Error("Use whole seconds for "+LABELS[key]+" in "+(row.policy.title||jobLabel(row.policy.jobKey))+".");value=Number(value);}
    }policy[key]=value;}return{rowId:row.rowId,expectedVersion:row.expectedVersion,policy};
  })};
}
async function previewRollout(){
  if(locked())return;s.busy=true;controls();
  try{await flushDraft();const serial=s.serial,plan=buildPlan(),result=await action("service-policy-rollout.preview",{plan});
    if(result.schema!=="commons.openlineage.service-policy-preview.v1"||result.workspaceId!==s.identity.workspaceId||!Number.isSafeInteger(result.sourceRevision)||!Array.isArray(result.rows)||!result.counts||!/^[a-f0-9]{64}$/.test(result.previewSha256))throw new Error("The preview response is incomplete.");
    if(serial!==s.serial)throw new Error("The draft changed during preview. Preview the current proposal.");
    s.preview=result;s.previewSerial=serial;renderPreview();
    if(result.sourceRevision!==s.data.revision)notice("Preview uses revision "+result.sourceRevision+". Refresh the workspace to confirm this revision before applying.",true);
    else notice("The complete proposal is ready to review. "+result.counts.create+" create, "+result.counts.update+" update, "+result.counts.unchanged+" unchanged.");
    $("preview-panel").scrollIntoView({behavior:"smooth",block:"start"});
  }finally{s.busy=false;controls();}
}
function previewRows(preview,committed=null){
  return preview.rows.map(row=>{
    const committedRow=committed?.find(r=>r.rowId===row.rowId),p=committedRow?.after??row.after;
    return h("article",{className:"rollout-row"},h("div",{className:"section-heading"},h("div",{},h("h3",{},p.title),h("p",{className:"muted"},jobLabel(p.jobKey))),badge(row.change)),
      record([["Original version",row.expectedVersion??"New policy"],["Following version",p.version],["Policy ID",p.id??"Assigned when applied"],["Owner",p.owner||"Unassigned"]]),
      row.fields.length?fieldTable(row.fields):h("p",{className:"muted"},"Every selected policy field is unchanged."),
      jsonBlock("Complete before and after",{rowId:row.rowId,before:committedRow?.before??row.before,after:p}));
  });
}
function renderPreview(){
  const box=$("preview-content"),p=s.preview;
  if(!p){box.replaceChildren(empty("Review the complete proposal","Select the actual policies and jobs, edit their settings, then preview every change together."));controls();return;}
  box.replaceChildren(record([["Title",p.plan.title],["Reason",p.plan.reason],["Source revision",p.sourceRevision],["Creates",p.counts.create],["Updates",p.counts.update],["Unchanged",p.counts.unchanged]]),
    h("p",{className:"muted"},"All selected policy changes will commit together. Assessments and incidents retain their current state."),
    ...previewRows(p),jsonBlock("Complete selected original sources",p.source),jsonBlock("Complete normalized proposal",p.plan));
  controls();
}
async function applyRollout(){
  if(locked()||!s.preview||s.previewSerial!==s.serial||s.preview.sourceRevision!==s.data.revision)throw new Error("Preview the current proposal and workspace revision first.");
  if(!s.preview.counts.create&&!s.preview.counts.update)throw new Error("This preview has no policy changes.");
  s.busy=true;controls();
  try{
    await flushDraft();
    const args={operationId:crypto.randomUUID(),expectedRevision:s.preview.sourceRevision,plan:clone(s.preview.plan),expectedPreviewSha256:s.preview.previewSha256},payload={action:"service-policy-rollout.apply",args};
    await retain({...payload,body:JSON.stringify(payload),workspaceId:s.identity.workspaceId,instanceId:s.identity.instanceId,createdAt:new Date().toISOString(),status:"prepared",uncertainOutcome:false,draftId:s.draft.id,workingDraft:{...clone(s.draft),version:s.draftVersion}});
    await sendPending();
  }finally{s.busy=false;controls();}
}
function validateSaved(p,result,detail){
  const rollout=detail.rollout,preview=rollout?.preview;
  if(!validPending(p)||!sameJSON(Object.keys(p.args).sort(),["expectedPreviewSha256","expectedRevision","operationId","plan"])||
    detail.workspaceId!==p.workspaceId||preview?.workspaceId!==p.workspaceId||
    rollout?.schema!=="commons.openlineage.service-policy-rollout.v1"||
    rollout.operationId!==p.args.operationId||rollout.sourceRevision!==p.args.expectedRevision||
    preview.sourceRevision!==p.args.expectedRevision||rollout.committedRevision!==rollout.sourceRevision+1||
    rollout.previewSha256!==p.args.expectedPreviewSha256||preview.previewSha256!==p.args.expectedPreviewSha256||
    !sameJSON(preview.plan,p.args.plan)||!Array.isArray(rollout.policies)||
    rollout.policies.length!==p.args.plan.rows.length)throw new Error("The saved rollout does not match the complete original request.");
  const rows=new Map(rollout.policies.map(row=>[row.rowId,row]));
  if(rows.size!==rollout.policies.length||p.args.plan.rows.some(row=>!rows.has(row.rowId)))throw new Error("The saved rollout is missing an original policy row.");
  const expected={workspaceId:p.workspaceId,revision:rollout.committedRevision,operationId:rollout.operationId,
    rollout:Object.fromEntries(["id","title","reason","createdAt","operationId","sourceRevision","committedRevision","previewSha256","rolloutSha256"].map(key=>[key,rollout[key]])),
    policies:rollout.policies.map(row=>({id:row.after.id,version:row.after.version,jobKey:row.after.jobKey}))};
  expected.rollout.counts=preview.counts;
  const actual=clone(result);delete actual.replayed;
  if(!sameJSON(actual,expected))throw new Error("The saved result differs from its complete native rollout record.");
  return rollout;
}
async function saveAppliedDraft(p,rollout){
  assertDraft(p.workingDraft);
  const db=await database(),prefix=draftPrefix(),id="applied-"+p.args.operationId,key=prefix+id;
  const original=clone(p.workingDraft),byRow=new Map(rollout.policies.map(row=>[row.rowId,row]));
  const now=new Date().toISOString(),snapshot={id,workspaceId:p.workspaceId,createdAt:now,updatedAt:now,
    kind:"service-policy-rollout-draft",version:1,lastAppliedRolloutId:rollout.id,
    appliedFrom:{id:original.id,version:original.version??null,state:original.state},
    state:{title:rollout.title,reason:rollout.reason,rows:rollout.preview.plan.rows.map(row=>{
      const saved=byRow.get(row.rowId).after;
      return{rowId:row.rowId,expectedVersion:saved.version,policy:rawPolicy(saved),baseline:clone(saved)};
    })}};
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("pending","readwrite"),store=tx.objectStore("pending");
    const previous=store.get(key),pending=store.get(JOURNAL_KEY);let saved,nextPending,message="";
    const commit=()=>{
      if(previous.readyState!=="done"||pending.readyState!=="done")return;
      const found=pending.result,prior=previous.result;
      if(found?.args?.operationId===p.args.operationId&&found.body!==p.body){message="The original saved request changed in another tab.";tx.abort();return;}
      if(prior){
        if(prior.lastAppliedRolloutId!==rollout.id||prior.workspaceId!==p.workspaceId){message="The saved follow-up draft belongs to another rollout.";tx.abort();return;}
        saved=prior;
      }else{saved=snapshot;store.put(saved,key);}
      if(found?.args?.operationId===p.args.operationId){store.delete(JOURNAL_KEY);nextPending=null;}
      else nextPending=found??null;
    };
    previous.onsuccess=commit;pending.onsuccess=commit;
    tx.oncomplete=()=>resolve({saved,nextPending});
    tx.onerror=tx.onabort=()=>reject(new Error(message||"The saved rollout is retained. Download the exact request and retry reopening its draft."));
  });
}
async function finishSaved(p,result){
  if(!result?.rollout?.id)throw new Error("Recover the original request to obtain its complete saved result.");
  const detail=await action("service-policy-rollout.get",{id:result.rollout.id}),rollout=validateSaved(p,result,detail);
  await saveQueue.catch(()=>{});
  const completed=await saveAppliedDraft(p,rollout);
  s.pending=completed.nextPending;await chooseDraft(completed.saved);
  s.selectedRollout=rollout;s.preview=null;s.previewSerial=null;renderDraft();renderPending();renderDetail();controls();showSection("history");
  notice("Rollout "+rollout.title+" saved at revision "+result.revision+". Its following draft is open; the original proposal and other saved editions are preserved."+(result.replayed?" Original request recovered.":""));
}
async function sendPending(){
  if(!s.pending||s.pendingBusy||!s.connected||s.pending.workspaceId!==s.identity?.workspaceId)return;
  const current=s.pending,found=await journal("read"),p=current.status==="complete"?current:found;
  if(!validPending(p)||p.args.operationId!==current.args.operationId||p.body!==current.body){adoptPending(found);renderPending();controls();throw new Error("The retained request changed in another tab. Review its original input.");}
  s.pendingBusy=true;controls();
  try{
    if(p.status==="complete"){await finishSaved(p,p.result);s.pendingBusy=false;await refresh();return;}
    const wasUncertain=p.uncertainOutcome||["submitting","uncertain"].includes(p.status);
    await retain({...p,status:"submitting",message:""});
    let result;
    try{
      result=await response("/api/action",{method:"POST",headers:{"Content-Type":"application/json"},body:p.body});
      if(result.workspaceId!==p.workspaceId||!result.rollout?.id||!Number.isSafeInteger(result.revision))throw new RequestError("The save response is incomplete.",502);
    }catch(error){
      const currentRevision=error.details?.currentRevision??error.details?.actualRevision,conflict=error.status===409&&Number.isSafeInteger(currentRevision);
      const status=wasUncertain||!error.status||error.status>=500?"uncertain":conflict?"conflict":[401,403,409,423,429].includes(error.status)?"blocked":"rejected";
      await retain({...p,status,uncertainOutcome:status==="uncertain",responseStatus:error.status,message:error.message,currentRevision});
      if([401,403].includes(error.status)||(error.status===409&&!conflict))s.connected=false;
      notice(status==="uncertain"?"The result is pending. Recover this exact original request.":error.message,true);return;
    }
    const complete={...p,status:"complete",result,message:"Saved at revision "+result.revision+". Finish reopening its complete record."};
    await retain(complete);await finishSaved(complete,result);
  }finally{s.pendingBusy=false;renderPending();controls();}
  if(!s.pending)await refresh().catch(error=>notice("The rollout is saved. "+error.message,true));
}
function renderPending(){
  const box=$("pending-panel"),p=s.pending;box.hidden=!p;if(!p){box.replaceChildren();return;}
  if(!validPending(p)){box.replaceChildren(h("h2",{id:"pending-title"},"Retained request needs recovery"),h("p",{},"Download the complete record before changing it."),btn("Download retained request",()=>downloadJSON(p,"openlineage-policy-request.json")));return;}
  const same=p.workspaceId===s.identity?.workspaceId,buttons=[];
  if(!s.pendingBusy&&same&&s.connected)buttons.push(btn(p.status==="complete"?"Finish saved rollout":"Recover original request",tracked(sendPending),{className:"primary"}));
  if(!s.pendingBusy&&cancellableStatuses.has(p.status)&&!p.uncertainOutcome)buttons.push(btn("Return to draft",tracked(async()=>{await clearPending(true);s.preview=null;s.previewSerial=null;await refresh();notice("The unsaved request was cancelled. Review the current policy versions and preview your retained proposal.");})));
  if(!same||!s.connected)buttons.push(btn("Reconnect to original workspace",()=>openDialog("connection-dialog")));
  buttons.push(btn("Download exact request",()=>downloadJSON(p,"service-policy-request-"+p.args.operationId+".json")));
  box.replaceChildren(h("h2",{id:"pending-title"},p.status==="complete"?"Saved rollout":"Original apply request"),
    h("p",{},p.message||"The complete proposal is retained with its original request identity."),h("p",{className:"muted"},"State "+p.status+" · workspace revision "+p.args.expectedRevision+" · "+when(p.createdAt)),
    h("div",{className:"button-row"},buttons),jsonBlock("Complete retained request",p));
}

function renderHistory(){
  const rows=[...(s.data?.rollouts??[])],search=$("history-search").value.trim().toLowerCase();
  const selected=rows.filter(r=>[r.title,r.reason,r.id].join(" ").toLowerCase().includes(search));
  $("rollout-history").replaceChildren(selected.length?table(["Rollout","Applied","Changes","Revision","Open"],selected.map(r=>h("tr",{},
    h("td",{},h("span",{className:"cell-title"},r.title),h("small",{},r.reason)),h("td",{},when(r.createdAt)),
    h("td",{},r.counts.create+" create · "+r.counts.update+" update · "+r.counts.unchanged+" unchanged"),
    h("td",{},r.sourceRevision+" → "+r.committedRevision),h("td",{},btn("Open",tracked(()=>openRollout(r.id)),{"data-read":true})))),"Saved service policy rollouts"):empty(rows.length?"No matching rollouts":"No saved rollouts",rows.length?"Adjust the search.":"A saved rollout keeps the full before-and-after record for every selected policy."));
  renderDetail();controls();
}
async function openRollout(id){
  if(!s.connected||s.readBusy||s.pendingBusy||s.busy)return;
  s.readBusy=true;controls();
  try{const result=await action("service-policy-rollout.get",{id});
    if(result.workspaceId!==s.identity.workspaceId||result.rollout?.id!==id||!Array.isArray(result.rollout.policies))throw new Error("The saved rollout response is incomplete.");
    s.selectedRollout=result.rollout;renderDetail();$("rollout-detail").scrollIntoView({behavior:"smooth",block:"start"});
  }finally{s.readBusy=false;controls();}
}
function renderDetail(){
  const box=$("rollout-detail"),r=s.selectedRollout;box.hidden=!r;if(!r)return;
  box.replaceChildren(h("div",{className:"section-heading"},h("div",{},h("h2",{},r.title),h("p",{className:"muted"},r.reason)),
    h("div",{className:"button-row"},["html","csv","json"].map(format=>btn("Download "+format.toUpperCase(),tracked(()=>downloadReport(r.id,format)),{"data-read":true})))),
    record([["Applied",when(r.createdAt)],["Source revision",r.sourceRevision],["Committed revision",r.committedRevision],["Original request",r.operationId],["Rollout",r.id]]),
    ...previewRows(r.preview,r.policies),jsonBlock("Original captured events, sources and jobs",r.preview.source),jsonBlock("Complete immutable rollout",r));
}
async function downloadReport(id,format){
  const workspaceId=s.identity?.workspaceId,result=await action("service-policy-rollout.report",{id,format});
  if(s.identity?.workspaceId!==workspaceId||typeof result.text!=="string"||typeof result.mediaType!=="string")throw new Error("The report response is incomplete.");
  download(new Blob([result.text],{type:result.mediaType}),"service-policy-rollout-"+id+"."+format);
}
function workingFile(){
  return{schema:WORKING_SCHEMA,workspaceId:s.draft.workspaceId,exportedAt:new Date().toISOString(),draft:clone(s.draft),pending:s.pending?clone(s.pending):null};
}
async function inspectWorking(file){
  if(!file)return;
  const document=JSON.parse(await file.text());if(document.schema!==WORKING_SCHEMA||document.workspaceId!==s.identity?.workspaceId)throw new Error("This file belongs to another workspace or format.");
  assertDraft(document.draft);
  if(document.pending){
    const p=document.pending;
    if(!validPending(p)||p.workspaceId!==document.workspaceId||p.workingDraft?.id!==p.draftId)throw new Error("The original request in this file is incomplete.");
    assertDraft(p.workingDraft);
    if(p.status==="complete"){
      if(!s.connected)throw new Error("Connect to the original workspace to verify this saved working file.");
      const detail=await action("service-policy-rollout.get",{id:p.result?.rollout?.id});
      validateSaved(p,p.result,detail);
    }
  }
  s.incoming=clone(document);
  $("incoming-body").replaceChildren(record([["Workspace",document.workspaceId],["Draft",document.draft.state.title||"Untitled"],["Selected policies",document.draft.state.rows.length],["Original draft",document.draft.id],["Exported",when(document.exportedAt)],["Pending request",document.pending?document.pending.args.operationId:"None"]]),
    h("p",{},document.pending?"Opening this file retains its exact original apply request for recovery before further editing.":"Opening this file creates a separate local draft and preserves your current work."),
    jsonBlock("Complete incoming working file",document));
  openDialog("incoming-dialog");
}
async function receiveWorking(){
  if(!s.incoming||locked())return;s.busy=true;controls();
  try{
    await flushDraft();const document=s.incoming;
    const d=clone(document.draft),originalId=d.id;d.id=crypto.randomUUID();d.createdAt=new Date().toISOString();d.forkedFrom={id:originalId,version:d.version??0,exportedAt:document.exportedAt};delete d.version;
    if(document.pending){const p=clone(document.pending);const admitted=clone(p.workingDraft);admitted.id=d.id;admitted.version=0;p.draftId=d.id;p.workingDraft=admitted;if(p.status!=="complete"){p.status="uncertain";p.uncertainOutcome=true;p.message="Imported original request. Recover its exact result before editing.";}await retain(p);}
    await chooseDraft(d);s.serial++;await flushDraft();
    s.incoming=null;closeDialog("incoming-dialog");notice("Complete working file opened as a separate local draft.");renderAll();
  }finally{s.busy=false;controls();}
}
async function startNewDraft(){
  if(locked())return;s.busy=true;controls();
  try{await flushDraft();await chooseDraft(newDraft());s.serial++;await flushDraft();showSection("draft");$("rollout-title").focus();}
  finally{s.busy=false;controls();}
}
function ownedDownload(blob,name){
  const url=URL.createObjectURL(blob);urls.add(url);const link=h("a",{href:url,download:name});document.body.append(link);link.click();link.remove();
  setTimeout(()=>{URL.revokeObjectURL(url);urls.delete(url);},30000);
}
async function closeOperator(){
  if(closePromise)return closePromise;s.closing=true;controls();
  closePromise=(async()=>{if(draftTimer){clearTimeout(draftTimer);draftTimer=null;}
    while(tasks.size)await Promise.allSettled([...tasks]);
    await flushDraft();if(dbPromise){const db=await dbPromise;db.close();dbPromise=null;}
    for(const url of urls)URL.revokeObjectURL(url);urls.clear();return{closed:true,pending:s.pending?{operationId:s.pending.args?.operationId,status:s.pending.status}:null};
  })().catch(error=>{closePromise=null;throw error;});return closePromise;
}
window.openLineagePolicyRollout=Object.freeze({
  inspect:()=>({workspaceId:s.identity?.workspaceId??null,revision:s.data?.revision??null,connected:s.connected,busy:s.busy||s.readBusy||s.pendingBusy,closing:s.closing,
    draft:s.draft?{id:s.draft.id,version:s.draftVersion,rows:s.draft.state.rows.length,dirty:s.serial!==s.savedSerial,error:s.draftError}:null,
    pending:s.pending?{operationId:s.pending.args?.operationId,status:s.pending.status}:null,preview:s.preview?{sourceRevision:s.preview.sourceRevision,previewSha256:s.preview.previewSha256,counts:s.preview.counts}:null}),
  flush:flushDraft,close:closeOperator
});
document.querySelectorAll("[data-section]").forEach(el=>el.addEventListener("click",()=>showSection(el.dataset.section)));
document.querySelectorAll("[data-close]").forEach(el=>el.addEventListener("click",()=>closeDialog(el.dataset.close)));
$("refresh-button").addEventListener("click",tracked(refresh));
$("connection-button").addEventListener("click",()=>{ $("connection-feedback").textContent="";openDialog("connection-dialog");});
$("connection-form").addEventListener("submit",tracked(async event=>{
  event.preventDefault();if(s.busy||s.readBusy||s.pendingBusy)return;
  accessToken=$("access-token").value;
  try{await connect();try{sessionStorage.setItem(TOKEN_KEY,accessToken);}catch{}closeDialog("connection-dialog");notice("Connected to the original workspace.");}
  catch(error){failFeedback("connection-feedback",error);controls();}
}));
for(const [id,key]of [["rollout-title","title"],["rollout-reason","reason"]])$(id).addEventListener("input",event=>{if(!s.draft)return;s.draft.state[key]=event.target.value;changed();});
for(const key of POLICY_FIELDS.filter(k=>!["id","jobKey"].includes(k))){
  const input=$("policy-"+key);if(!input)continue;
  input.addEventListener(input.type==="checkbox"?"change":"input",event=>{
    const row=s.draft?.state.rows.find(r=>r.rowId===s.selectedRow);if(!row)return;
    row.policy[key]=input.type==="checkbox"?event.target.checked:event.target.value;changed();renderRows();
    if(key==="title")$("policy-heading").textContent=row.policy.title||jobLabel(row.policy.jobKey);
  });
}
$("add-sources").addEventListener("click",openChooser);
$("source-search").addEventListener("input",renderChooser);
$("add-selected-sources").addEventListener("click",tracked(addSources));
$("select-all-rows").addEventListener("click",()=>{for(const row of s.draft?.state.rows??[])s.selectedRows.add(row.rowId);renderRows();controls();});
$("clear-row-selection").addEventListener("click",()=>{s.selectedRows.clear();renderRows();controls();});
$("bulk-button").addEventListener("click",openBulk);
$("bulk-form").addEventListener("submit",event=>{try{applyBulk(event);}catch(error){failFeedback("bulk-feedback",error);}});
$("preview-button").addEventListener("click",tracked(previewRollout));
$("apply-button").addEventListener("click",tracked(applyRollout));
$("history-search").addEventListener("input",renderHistory);
$("download-working").addEventListener("click",()=>downloadJSON(workingFile(),"service-policy-working-"+s.draft.id+".json"));
$("new-draft").addEventListener("click",tracked(startNewDraft));
$("open-drafts").addEventListener("click",tracked(openDraftChooser));
$("working-file").addEventListener("change",tracked(async event=>{const file=event.target.files[0];event.target.value="";await inspectWorking(file);}));
$("receive-working").addEventListener("click",tracked(receiveWorking));
$("access-token").value=accessToken;
window.addEventListener("focus",tracked(async()=>{
  if(s.pendingBusy||s.busy||s.readBusy||s.closing)return;adoptPending(await journal("read"));renderPending();controls();
}));
window.addEventListener("beforeunload",event=>{if(s.serial!==s.savedSerial||s.pendingBusy){event.preventDefault();event.returnValue="";}});
async function initialize(){
  controls();renderPreview();try{s.pending=await journal("read");renderPending();}catch(error){notice(error.message,true);}
  try{await connect();if(s.pending?.workingDraft&&s.pending.draftId!==s.draft.id){const drafts=await listDrafts(),stored=drafts.find(d=>d.id===s.pending.draftId);await chooseDraft(stored??s.pending.workingDraft);}}
  catch(error){notice(error.message,true);openDialog("connection-dialog");}controls();
}
tracked(initialize)();
