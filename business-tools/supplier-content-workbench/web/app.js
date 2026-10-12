/* Supplier Content Exchange — local operator UI. All authority remains in the native API. */
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const h=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const enc=v=>encodeURIComponent(String(v??""));
const label=v=>String(v??"").replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());
const amount=v=>v==null?"—":typeof v==="number"?v.toLocaleString():String(v);
const fmtBytes=n=>n==null?"—":n<1024?n+" B":n<1048576?(n/1024).toFixed(1)+" KB":(n/1048576).toFixed(2)+" MB";
const date=v=>{if(!v)return"—";const d=new Date(v);return Number.isNaN(d.valueOf())?String(v):new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(d);};
const json=v=>JSON.stringify(v,null,2);
const isBlank=v=>v==null||v==="";
const textValue=v=>isBlank(v)?"—":typeof v==="object"?json(v):String(v);
const ICONS={
 dashboard:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="4" rx="1"/><rect x="14" y="11" width="7" height="10" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
 box:'<path d="m3 7 9-4 9 4v10l-9 4-9-4Z"/><path d="m3 7 9 4 9-4M12 11v10M7 5l10 4"/>',
 upload:'<path d="M12 16V3m-4 4 4-4 4 4M4 14v6h16v-6"/>',
 review:'<path d="M9 3H5v18h14V3h-4"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="m8 13 3 3 5-6"/>',
 suppliers:'<path d="M3 21V7l9-4 9 4v14M8 21v-6h8v6M7 9h1m4 0h1m4 0h1M7 12h1m4 0h1m4 0h1"/>',
 users:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5v2"/>',
 mapping:'<path d="M4 4h5v5H4zM15 15h5v5h-5zM9 6h5a4 4 0 0 1 4 4v5M4 16h5v4H4zM9 18h6"/>',
 release:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5M5 7H3v5m16-5h2v5"/>',
 history:'<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-5v6l4 2"/>',
 bell:'<path d="M5 10a7 7 0 0 1 14 0v5l2 3H3l2-3Zm4 11h6"/>',
 shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
 book:'<path d="M12 5c-3-2-7-2-10-1v15c3-1 7-1 10 1m0-15c3-2 7-2 10-1v15c-3-1-7-1-10 1V5"/>',
 search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
 plus:'<path d="M12 4v16M4 12h16"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
 refresh:'<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
 close:'<path d="m5 5 14 14M19 5 5 19"/>', menu:'<path d="M3 6h18M3 12h18M3 18h18"/>',
 check:'<path d="m4 12 5 5L20 6"/>',file:'<path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8M8 16h8"/>',
 logout:'<path d="M9 3H3v18h6M9 12h12m-5-5 5 5-5 5"/>'
};
const icon=name=>'<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true">'+(ICONS[name]||ICONS.file)+'</svg>';
const link=(to,title,cls="")=>'<a class="'+h(cls)+'" href="#'+h(to)+'">'+title+'</a>';
const button=(name,title,cls="",attrs="")=>'<button type="button" class="button '+h(cls)+'" data-action="'+h(name)+'" '+attrs+'>'+title+'</button>';
const notice=(content,kind="info")=>'<div class="notice '+h(kind)+'">'+content+'</div>';
const pill=(status,kind)=>{const k=String(status??"unknown").toLowerCase();return '<span class="pill '+h(kind||({approved:"good",accepted:"good",active:"good",complete:"good",prepared:"info",pending:"warning",pending_review:"warning",rejected:"danger",error:"danger",warning:"warning",inactive:"neutral",resolved:"good",unread:"info"}[k]||"neutral"))+'"><span class="dot" aria-hidden="true"></span>'+h(label(status||"Unknown"))+'</span>';};
const header=(title,description,actions="",eyebrow="Supplier workspace")=>'<header class="page-header"><div><div class="eyebrow">'+h(eyebrow)+'</div><h1>'+h(title)+'</h1>'+(description?'<p>'+h(description)+'</p>':"")+'</div><div class="header-actions">'+actions+'</div></header>';
const card=(title,body,extra="",subtitle="")=>'<section class="card">'+(title?'<div class="card-head"><div><h2>'+h(title)+'</h2>'+(subtitle?'<p>'+h(subtitle)+'</p>':"")+'</div>'+extra+'</div>':"")+'<div class="card-body">'+body+'</div></section>';
const empty=(title,description,actions="",i="box")=>'<div class="empty-state"><div class="empty-icon">'+icon(i)+'</div><h2>'+h(title)+'</h2><p>'+h(description)+'</p><div class="actions" data-layout="center">'+actions+'</div></div>';
const dl=entries=>'<dl class="definition rows">'+entries.map(([k,v])=>'<dt>'+h(k)+'</dt><dd>'+v+'</dd>').join("")+'</dl>';
const code=v=>'<pre class="code-block wrap">'+h(typeof v==="string"?v:json(v))+'</pre>';
const field=(name,title,opts={})=>{
 const id=opts.id||"field-"+name, val=opts.value??"",help=opts.help?'<div class="help" id="'+h(id)+'-help">'+h(opts.help)+'</div>':"";
 const attrs=' id="'+h(id)+'" name="'+h(name)+'" '+(opts.required?"required ":"")+(opts.readonly?"readonly ":"")+(opts.disabled?"disabled ":"")+(opts.help?'aria-describedby="'+h(id)+'-help" ':"")+(opts.placeholder?'placeholder="'+h(opts.placeholder)+'" ':"");
 let control;
 if(opts.type==="textarea")control='<textarea'+attrs+'rows="'+h(opts.rows||4)+'"'+(opts.code?' class="code"':"")+'>'+h(val)+'</textarea>';
 else if(opts.options)control='<select'+attrs+'>'+opts.options.map(o=>{const v=typeof o==="object"?o.value:o,t=typeof o==="object"?o.label:label(o);return'<option value="'+h(v)+'"'+(String(v)===String(val)?" selected":"")+'>'+h(t)+'</option>';}).join("")+'</select>';
 else control='<input'+attrs+'type="'+h(opts.type||"text")+'" value="'+h(val)+'"'+(opts.autocomplete?' autocomplete="'+h(opts.autocomplete)+'"':"")+(opts.minlength?' minlength="'+h(opts.minlength)+'"':"")+(opts.inputmode?' inputmode="'+h(opts.inputmode)+'"':"")+'>';
 return '<div class="field '+(opts.full?"full":"")+'"><label for="'+h(id)+'">'+h(title)+(opts.optional?' <span class="optional">Optional</span>':"")+'</label>'+control+help+'</div>';
};
const check=(name,title,help="",checked=false)=>'<label class="check-row"><input type="checkbox" name="'+h(name)+'" '+(checked?"checked":"")+'><span>'+h(title)+(help?'<small>'+h(help)+'</small>':"")+'</span></label>';
const formActions=(title="Save",note="")=>'<div class="form-actions"><span class="left">'+h(note)+'</span><button type="submit" class="button primary">'+h(title)+'</button></div>';
const formError=()=>'<div data-form-error hidden class="notice danger page-message" role="alert" tabindex="-1"></div>';
const table=(heads,rows,cls="table-wide")=>'<div class="table-wrap" tabindex="0" role="region" aria-label="Scrollable data table"><table class="'+h(cls)+'"><thead><tr>'+heads.map(x=>'<th scope="col">'+x+'</th>').join("")+'</tr></thead><tbody>'+rows.join("")+'</tbody></table></div>';
const tr=cols=>'<tr>'+cols.map(c=>'<td>'+c+'</td>').join("")+'</tr>';
const metrics=rows=>'<div class="metrics">'+rows.map((r,i)=>'<div class="metric '+(i===0?"emphasis":"")+'"><div class="metric-label">'+h(r[0])+'</div><div class="metric-value metric-number">'+h(amount(r[1]))+'</div><div class="metric-note">'+h(r[2]||"")+'</div></div>').join("")+'</div>';
function routeInfo(){const raw=(location.hash.slice(1)||"dashboard").split("?");return{parts:raw[0].split("/").filter(Boolean).map(s=>{try{return decodeURIComponent(s);}catch{return s;}}),query:new URLSearchParams(raw.slice(1).join("?"))};}
function go(to){if(location.hash==="#"+to)render();else location.hash=to;}
function routeQuery(changes){const {parts,query}=routeInfo();for(const [k,v] of Object.entries(changes)){if(v==null||v==="")query.delete(k);else query.set(k,String(v));}go(parts.map(enc).join("/")+(query.size?"?"+query:""));}
function pages(rows,size=20){const n=Math.max(0,Number(routeInfo().query.get("page")||0));const index=Math.min(n,Math.max(0,Math.ceil(rows.length/size)-1));return{rows:rows.slice(index*size,(index+1)*size),index,size,total:rows.length};}
function pager(p){return'<div class="pagination"><span>'+h(p.total?((p.index*p.size+1)+"–"+Math.min((p.index+1)*p.size,p.total)+" of "+p.total):"No records")+'</span><div class="actions">'+button("previous","Previous","small",'data-page="'+(p.index-1)+'" '+(!p.index?"disabled":""))+button("next","Next","small",'data-page="'+(p.index+1)+'" '+((p.index+1)*p.size>=p.total?"disabled":""))+'</div></div>';}
function bindPager(root=document){$$("[data-page]",root).forEach(b=>b.addEventListener("click",()=>routeQuery({page:b.dataset.page})));}
function matches(row,q,keys){if(!q)return true;const v=q.toLowerCase();return keys.some(k=>String(row[k]??"").toLowerCase().includes(v));}
function toast(message,kind=""){const el=document.createElement("div");el.className="toast "+kind;el.textContent=message;$("#toast-region").append(el);setTimeout(()=>el.remove(),6500);}
function showDialog(title,body,footer=""){const d=$("#app-dialog");if(d.open)d.close();d.classList.remove("dialog-wide");d.innerHTML='<div class="dialog-head"><h2 id="dialog-title">'+h(title)+'</h2>'+button("close-dialog",icon("close"),"icon quiet",'aria-label="Close dialog"')+'</div><div class="dialog-body">'+body+'</div>'+(footer?'<div class="dialog-foot">'+footer+'</div>':"");$("[data-action=close-dialog]",d).onclick=()=>d.close();d.showModal();return d;}
function busy(form,on){$$("button[type=submit]",form).forEach(b=>{if(on){b.dataset.originalText=b.innerHTML;b.innerHTML='<span class="spinner loading-inline" aria-hidden="true"></span>Working…';}else if(b.dataset.originalText)b.innerHTML=b.dataset.originalText;b.disabled=on;});form.setAttribute("aria-busy",String(on));}
function showFormError(form,e){const box=$("[data-form-error]",form);if(box){box.hidden=false;box.textContent=e.message||String(e);box.focus();}else toast(e.message||String(e),"danger");const errors=e.details?.fields||e.details?.errors;if(errors&&typeof errors==="object")for(const [key,msg] of Object.entries(errors)){const input=form.elements.namedItem(key);if(input instanceof Element){input.setAttribute("aria-invalid","true");const n=document.createElement("div");n.className="error";n.textContent=Array.isArray(msg)?msg.join("; "):String(msg);input.parentElement.append(n);}}}
function onForm(id,handler){const form=$(id);if(!form)return;form.addEventListener("submit",async e=>{e.preventDefault();if(!form.reportValidity())return;const box=$("[data-form-error]",form);if(box)box.hidden=true;$$(".error",form).forEach(n=>n.remove());$$("[aria-invalid]",form).forEach(n=>n.removeAttribute("aria-invalid"));busy(form,true);try{await handler(new FormData(form),form);}catch(err){showFormError(form,err);if(err.status===409&&$("[data-form-error]",form)){const retry=document.createElement("button");retry.type="button";retry.className="button small";retry.textContent="Review current record";retry.addEventListener("click",async()=>{const values=[];for(const el of Array.from(form.elements)){if(!el.name||el.disabled||el.readOnly||["password","file","submit","button"].includes(el.type)||/otp|secret|password/i.test(el.name))continue;values.push({name:el.name,value:el.value,checked:el.checked,type:el.type});}state.reviewDraft={hash:location.hash,formId:form.id,values};await render();});$("[data-form-error]",form).append(document.createElement("br"),retry);}}finally{busy(form,false);}});}
function parseJSON(value,title,fallback={}){if(!String(value??"").trim())return fallback;try{return JSON.parse(value);}catch{throw new Error(title+" must be valid JSON. The original text is still in the form.");}}
function safeReference(value){try{const u=new URL(value,location.href);if(!["https:","http:"].includes(u.protocol))return h(value);return'<a href="'+h(u.href)+'" target="_blank" rel="noopener noreferrer">'+h(value)+'</a>';}catch{return h(value);}}
class APIError extends Error{constructor(message,code,status,details){super(message);this.code=code;this.status=status;this.details=details;}}
const state={session:null,generation:0,abort:null,pendingMemory:new Map(),dashboard:null,reviewDraft:null};
const canReview=()=>["admin","reviewer"].includes(state.session?.user?.role);
const isAdmin=()=>state.session?.user?.role==="admin";
const canManageUsers=()=>["admin","supplier_admin"].includes(state.session?.user?.role);
async function api(path,{method="GET",body,requestId,signal}={}){
 const controller=new AbortController();const cancel=()=>controller.abort();if(signal){if(signal.aborted)cancel();else signal.addEventListener("abort",cancel,{once:true});}
 const timer=setTimeout(cancel,120000);let r;
 try{r=await fetch("/api"+path,{method,credentials:"same-origin",cache:"no-store",headers:{"Accept":"application/json",...(body!==undefined?{"Content-Type":"application/json"}:{}),...(requestId?{"Idempotency-Key":requestId}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});}
 catch(e){throw new APIError(e.name==="AbortError"?"The request stopped before its response arrived. Its outcome is not yet confirmed.":"The service response could not be reached. Its outcome is not yet confirmed.","transport_unknown",0);}
 finally{clearTimeout(timer);signal?.removeEventListener("abort",cancel);}
 let payload;try{payload=await r.json();}catch{throw new APIError("The service did not return a readable result. Check the original request before retrying.","response_unknown",r.status>=400?r.status:0);}
 if(!r.ok||payload.ok!==true){const e=payload.error||{};throw new APIError(e.message||"The native operation could not be completed.",e.code||"native_error",r.status,e.details);}
 return payload.data;
}
let dbPromise;
function requestDB(){return dbPromise??=new Promise((resolve,reject)=>{const r=indexedDB.open("supplier-content-exchange-requests",1);r.onupgradeneeded=()=>r.result.createObjectStore("requests",{keyPath:"id"});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error("The browser could not preserve this request for recovery. Allow local storage and try again before sending."));});}
async function requestDBCall(mode,operation){const db=await requestDB();return new Promise((resolve,reject)=>{const tx=db.transaction("requests",mode),store=tx.objectStore("requests");let result;const r=operation(store);r.onsuccess=()=>{result=r.result;};tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(new Error("The browser request record could not be updated. Check the original request outcome if dispatch had already begun."));});}
const savedRequests=async()=>{const all=await requestDBCall("readonly",s=>s.getAll());return all.filter(r=>r.userId===state.session?.user?.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));};
const saveRequest=r=>requestDBCall("readwrite",s=>s.put(r));
async function shaText(s){const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,"0")).join("");}
function resultIdentity(d){if(!d||typeof d!=="object")return{};return Object.fromEntries(["id","revision","status","edition","filename","sha256","name","receipt","receiving_locator","workspace_id"].filter(k=>Object.hasOwn(d,k)).map(k=>[k,d[k]]));}
async function performRequest(r,body){
 r.state="pending";r.lastAttemptAt=new Date().toISOString();await saveRequest(r);state.pendingMemory.set(r.id,body);
 try{const data=await api(r.path,{method:"POST",body,requestId:r.id});r.state="accepted";r.result=resultIdentity(data);r.completedAt=new Date().toISOString();r.bodyJSON=null;r.error=null;await saveRequest(r);state.pendingMemory.delete(r.id);return data;}
 catch(e){r.state=e.status>=400&&e.status<500?"rejected":"unknown";r.error={message:e.message,code:e.code,status:e.status};try{await saveRequest(r);}catch{}if(r.state==="unknown")e.message+=" Review the saved original request in Request recovery; keep UUID "+r.id+".";throw e;}
}
async function mutate(path,body,{name="Save change",sensitive=false}={}){
 const serialized=JSON.stringify(body),identity=sensitive?JSON.stringify(body,(key,value)=>/^(password|otp|secret|client_secret)$/i.test(key)?"[protected value omitted]":value):serialized,bodySHA256=await shaText(identity),existing=(await savedRequests()).find(r=>r.path===path&&r.bodySHA256===bodySHA256&&["pending","unknown"].includes(r.state));
 const record=existing||{id:crypto.randomUUID(),userId:state.session.user.id,path,name,createdAt:new Date().toISOString(),state:"prepared",bodySHA256,bodyJSON:sensitive?null:serialized,sensitive};
 return performRequest(record,body);
}
async function recoverRequest(record){
 try{
 const receipt=await api("/requests/"+enc(record.id));
 if(receipt.id!==record.id||![record.path,"/api"+record.path].includes(receipt.path)||!Object.hasOwn(receipt,"response"))throw new Error("The native request receipt does not match this exact UUID and path. Keep the original request for review.");
 const result=receipt.response;record.state="accepted";record.result=resultIdentity(result);record.nativeBodySHA256=record.sensitive?null:receipt.body_sha256;record.bodyJSON=null;record.completedAt=receipt.created_at;await saveRequest(record);state.pendingMemory.delete(record.id);return{found:true,result};
 }catch(e){if(e.status===404&&e.code==="REQUEST_NOT_COMMITTED")return{found:false};throw e;}
}
async function fileBase64(file,progress=()=>{}){
 return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onprogress=e=>{if(e.lengthComputable)progress(e.loaded/e.total);};reader.onerror=()=>reject(new Error("The selected file could not be read. Choose the original file again."));reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.readAsDataURL(file);});
}
function downloadObject(value,name){const u=URL.createObjectURL(new Blob([json(value)+"\n"],{type:"application/json"}));const a=document.createElement("a");a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}


const NAV=[
 ["dashboard","Overview","dashboard",()=>true],["submissions","Submissions","upload",()=>true],["products","Approved products","box",()=>true],
 ["suppliers","Suppliers","suppliers",()=>canReview()],["users","People & access","users",canManageUsers],
 ["mappings","Output mappings","mapping",canReview],["releases","Release register","release",canReview],
 ["notifications","Notifications","bell",()=>true],["audit","Activity history","history",()=>canReview()],
 ["handoff","Complete project","book",isAdmin],["guide","Operating guide","book",()=>true]
];
function shell(){
 const u=state.session.user,active=routeInfo().parts[0],current=NAV.find(r=>r[0]===active)?.[1]||label(active);
 $("#app").innerHTML='<div class="app-shell"><aside class="sidebar" aria-label="Primary navigation">'+link("dashboard",'<span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span><span></span></span><span><strong>Content Exchange</strong><small>Supplier workbench</small></span>',"brand")+'<div class="workspace-chip"><strong>Product content operations</strong><small>'+h(u.supplier_id?"Supplier access":"Review & integration workspace")+'</small></div><div class="nav-section">Workspace</div><nav class="nav-links">'+NAV.filter(r=>r[3]()).map(([id,title,i])=>'<a href="#'+id+'"'+(id===active?' aria-current="page"':"")+'>'+icon(i)+'<span>'+h(title)+'</span></a>').join("")+'</nav><div class="sidebar-foot"><strong>Traceable source. Explicit decisions.</strong>Supplier staging, review and portable exports.</div></aside><button type="button" class="backdrop" aria-label="Close navigation"></button><div class="main-shell"><div class="topbar"><button type="button" class="menu-button" aria-label="Open navigation" aria-expanded="false">'+icon("menu")+'</button><div class="topbar-path"><span>Workspace</span><span aria-hidden="true">/</span><span>'+h(current)+'</span></div><div class="topbar-right"><span class="environment">Local operator workspace</span>'+link("recovery",icon("refresh")+'<span class="sr-only">Request recovery</span>',"button icon quiet")+link("profile",'<span class="avatar">'+h((u.name||"U").split(/\s+/).map(x=>x[0]).slice(0,2).join("").toUpperCase())+'</span><span><span class="name">'+h(u.name)+'</span><span class="role">'+h(label(u.role))+'</span></span>',"identity-button")+'</div></div><main class="main-content" id="main-content" tabindex="-1"><div class="loading"><span class="spinner" aria-hidden="true"></span>Loading the current native record…</div></main></div></div>';
 const menu=$(".menu-button"),backdrop=$(".backdrop");
 const toggle=on=>{$(".app-shell").classList.toggle("nav-open",on);menu.setAttribute("aria-expanded",String(on));if(!on)menu.focus();};
 menu.onclick=()=>toggle(!$(".app-shell").classList.contains("nav-open"));backdrop.onclick=()=>toggle(false);
}
function content(html,generation){if(generation!==undefined&&generation!==state.generation)return false;$("#main-content").innerHTML=html;bindPager($("#main-content"));return true;}
function listToolbar({query="",status="",statuses=[],suppliers=[],supplier=""}={}){
 return '<form id="list-filter" class="toolbar">'+field("q","Search",{value:query,placeholder:"Name, identifier or source…",id:"filter-query"})+
 (statuses.length?field("status","Status",{value:status,options:[{value:"",label:"All statuses"},...statuses.map(s=>({value:s,label:label(s)}))],id:"filter-status"}):"")+
 (suppliers.length?field("supplier_id","Supplier",{value:supplier,options:[{value:"",label:"All suppliers"},...suppliers.map(s=>({value:s.id,label:s.name}))],id:"filter-supplier"}):"")+
 '<div class="toolbar-actions"><button class="button" type="submit">'+icon("search")+'Filter</button>'+button("clear-filter","Clear","quiet")+'</div></form>';
}
function bindFilter(){const f=$("#list-filter");if(!f)return;$(".field",f)?.classList.add("search");f.onsubmit=e=>{e.preventDefault();const d=new FormData(f);routeQuery({q:d.get("q"),status:d.get("status"),supplier_id:d.get("supplier_id"),page:null});};$("[data-action=clear-filter]",f).onclick=()=>routeQuery({q:null,status:null,supplier_id:null,page:null});}
function activityRows(rows){return(rows||[]).map(r=>'<div class="timeline-item"><div class="timeline-marker" aria-hidden="true"></div><div><strong>'+h(label(r.action||r.event||r.kind||r.type||"Saved activity"))+'</strong><p>'+h(r.message||r.note||r.summary||r.entity_id||r.subject||"")+'</p><div class="timeline-time">'+h(date(r.created_at||r.at||r.timestamp))+(r.actor_name||r.user_name||r.actor?' · '+h(r.actor_name||r.user_name||textValue(r.actor)):"")+'</div></div></div>').join("");}
function sourceNotes(notes){if(!notes)return"";const rows=Array.isArray(notes)?notes:[notes];return rows.map(n=>'<div class="source-item">'+(typeof n==="string"?'<p>'+h(n)+'</p>':'<strong>'+h(n.title||n.name||n.label||"Source context")+'</strong><p>'+h(n.message||n.note||n.description||json(n))+'</p>')+'</div>').join("");}
async function authView(){
 const setup=state.session?.setup_required;
 $("#app").innerHTML='<div class="login-shell"><section class="login-intro"><a class="brand" href="#"><span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span><span></span></span><span><strong>Content Exchange</strong><small>Supplier workbench</small></span></a><h1>Move product content from source to approval.</h1><p>Bring supplier files, quality findings and publishing decisions into one accountable workspace.</p><div class="login-source">Original supplier documentation and configurable operating rules. Government systems retain their own authority and production credentials.</div></section><main id="main-content" class="login-main"><div class="login-box"><div class="eyebrow">'+(setup?"Start your workspace":"Welcome back")+'</div><h2>'+(setup?"Create the first administrator":"Sign in")+'</h2><p>'+(setup?"This creates the initial local account for this workspace.":"Use the account assigned to your supplier or review team.")+'</p><form id="auth-form">'+formError()+(setup?field("name","Your name",{required:true,autocomplete:"name"}):"")+field("email","Email address",{type:"email",required:true,autocomplete:"username"})+field("password","Password",{type:"password",required:true,autocomplete:setup?"new-password":"current-password",minlength:setup?12:undefined})+(!setup?field("otp","Authenticator code",{optional:true,inputmode:"numeric",autocomplete:"one-time-code",help:"Enter the current code if multi-factor authentication is enabled."}):"")+'<button type="submit" class="button primary">'+(setup?"Create local workspace":"Sign in")+icon("arrow")+'</button></form><p class="login-note">Your role determines which supplier records and review actions are available.</p></div></main></div>';
 onForm("#auth-form",async d=>{await api(setup?"/setup":"/login",{method:"POST",body:setup?{name:d.get("name"),email:d.get("email"),password:d.get("password")}:{email:d.get("email"),password:d.get("password"),otp:d.get("otp")||undefined}});state.session=await api("/session");await render();});
}
async function dashboardView(g){
 const d=await api("/dashboard",{signal:state.abort.signal});if(g!==state.generation)return;state.dashboard=d;
 const c=d.counts||{},actions=link("submissions/new",icon("plus")+"New submission","button primary");
 content(header("A clear path to approved content","Review source quality, follow supplier corrections, and prepare traceable product exports.",actions,"Content operations")+
 metrics([["Pending review",c.pending,"Current submission queue"],["Approved products",c.products,"Current product editions"],["Supplier submissions",c.submissions,"Retained original sources"],["Prepared & reviewed releases",c.releases,"Frozen output editions"]])+
 '<div class="grid-aside"><div class="stack">'+card("Keep work moving",'<div class="item-list"><div class="item-row"><span class="item-icon">'+icon("upload")+'</span><div class="grow"><h3>Bring in supplier content</h3><p>Import an original file or enter a manual submission. Validation stays with its source edition.</p></div>'+link("submissions/new","Open","button small")+'</div><div class="item-row"><span class="item-icon">'+icon("review")+'</span><div class="grow"><h3>Review the queue</h3><p>Resolve errors, acknowledge warnings and retain the reason for each decision.</p></div>'+link("submissions","View queue","button small")+'</div>'+(canReview()?'<div class="item-row"><span class="item-icon">'+icon("release")+'</span><div class="grow"><h3>Prepare an exact output</h3><p>Preview a field map, select approved editions and keep acknowledgment separate from export creation.</p></div>'+link("releases","Releases","button small")+'</div>':"")+'</div>')+
 card("Recent activity",d.activity?.length?'<div class="timeline">'+activityRows(d.activity.slice(0,8))+'</div>':empty("No activity yet","Your first source intake will begin this workspace’s history.","","history"),canReview()?link("audit","Full history","button small quiet"):"")+'</div><aside class="stack">'+
 card("Source & operating scope",'<div class="source-list">'+(sourceNotes(d.source_notes)||'<p class="muted small">Supplier staging, review and mapped file exchange. Production connections are configured separately by the qualified platform operator.</p>')+'</div>')+
 card("Your notifications",'<div class="metric-value">'+h(amount(c.unread_notifications))+'</div><p class="muted small">Unread messages available to your account.</p><div class="actions spaced">'+link("notifications","Open notifications","button small")+'</div>')+'</aside></div>',g);
}
async function submissionsView(g){
 const q=routeInfo().query,rows=await api("/submissions"+(q.get("status")||q.get("supplier_id")?"?"+new URLSearchParams(Object.fromEntries(["status","supplier_id"].filter(k=>q.get(k)).map(k=>[k,q.get(k)]))):""),{signal:state.abort.signal});
 const suppliers=canReview()?await api("/suppliers",{signal:state.abort.signal}):[];
 const filtered=rows.filter(r=>matches(r,q.get("q"),["filename","supplier_name","id","source_label"])),p=pages(filtered);
 const statuses=Array.from(new Set(rows.map(r=>r.status))).sort();
 const body=p.rows.length?table(["Submission","Supplier","Quality checks","Status","Received"],p.rows.map(r=>tr([
 link("submissions/"+enc(r.id),h(r.filename||r.source_label||"Manual submission"),"table-title")+'<span class="table-sub">'+h(r.format||"manual")+' · '+h(amount(r.item_count))+' item'+(r.item_count===1?"":"s")+(r.parent_id?' · Corrected edition':"")+'</span>',
 h(r.supplier_name||r.supplier_id),
 '<span class="'+(r.error_count?"text-danger":"muted")+'">'+h(amount(r.error_count))+' errors</span><span class="table-sub">'+h(amount(r.warning_count))+' warnings</span>',
 pill(r.status)+'<span class="table-sub">Revision '+h(r.revision)+'</span>',h(date(r.created_at))
 ]))):empty("No matching submissions","Adjust the filters or start with an original supplier file.",link("submissions/new","New submission","button primary"),"upload");
 content(header("Supplier submissions","Each intake retains its source bytes, validation findings and review history.",link("submissions/new",icon("plus")+"New submission","button primary"))+
 '<section class="card">'+listToolbar({query:q.get("q")||"",status:q.get("status")||"",statuses,suppliers,supplier:q.get("supplier_id")||""})+body+pager(p)+'</section>',g);bindFilter();
}
function itemIdentity(value){
 const item=value?.item||value||{},type=value?.identifier_type||item.identifier_type||((value?.gtin||item.gtin)?"gtin":"supplier");
 return {type,value:String(value?.identifier||item.identifier||value?.gtin||item.gtin||value?.key||item.key||""),namespace:String(value?.identifier_namespace||item.identifier_namespace||""),note:String(value?.identifier_note||item.identifier_note||"")};
}
function itemTitle(value){return value?.name||value?.item?.name||itemIdentity(value).value||"Unnamed item";}
function identityHTML(value){const i=itemIdentity(value);return '<span class="mono">'+h(i.value||"Not supplied")+'</span><span class="table-sub">'+h(i.type==="gtin"?"GTIN":"Supplier identifier")+(i.namespace?' · '+h(i.namespace):"")+'</span>';}
function itemMatches(value,q,keys){const i=itemIdentity(value);return matches(value,q,keys)||matches(i,q,["value","namespace"]);}
function bindManualIdentity(form){
 const type=form.elements.namedItem("identifier_type");const sync=()=>{const local=type.value==="supplier";for(const name of["gtin","identifier","identifier_namespace"]){const input=form.elements.namedItem(name),active=name==="gtin"?!local:local;input.disabled=!active;input.required=active;input.closest(".field").hidden=!active;}};
 type.addEventListener("change",sync);sync();
}
async function productsView(g){
 const rows=await api("/products",{signal:state.abort.signal}),q=routeInfo().query.get("q")||"",p=pages(rows.filter(r=>itemMatches(r,q,["name","key","gtin","brand","supplier_name"])));
 content(header("Approved product editions","Current editions are listed here. Every product keeps its approval source and older editions.")+'<section class="card">'+listToolbar({query:q})+(p.rows.length?table(["Product","Supplier","Identity","Edition","Approved"],p.rows.map(r=>tr([
 link("products/"+enc(r.id),h(itemTitle(r)),"table-title")+'<span class="table-sub">'+h(r.brand||"Brand not supplied")+'</span>',
 h(r.supplier_name||r.supplier_id),
 identityHTML(r),
 '<span class="pill good">Edition '+h(r.edition)+'</span>',h(date(r.approved_at))
 ]))):empty("No approved products","Products appear after an authorized reviewer approves an eligible submission.",link("submissions","Open submissions","button"),"box"))+pager(p)+'</section>',g);bindFilter();
}


function supplierOptions(rows){return rows.map(s=>({value:s.id,label:s.name+(s.gln?" · "+s.gln:"")}));}
function supplierSelect(rows,value=""){return field("supplier_id","Supplier",{required:true,value:value||state.session.user.supplier_id||"",disabled:!!state.session.user.supplier_id,options:[{value:"",label:"Choose a supplier"},...supplierOptions(rows)],full:true,help:"Content remains within this supplier’s access scope."});}
async function newSubmissionView(g){
 const parentId=routeInfo().query.get("parent_id"),parent=parentId?await api("/submissions/"+enc(parentId),{signal:state.abort.signal}):null;
 const suppliers=await api("/suppliers",{signal:state.abort.signal}),mode=routeInfo().query.get("mode")||"file";
 const top=parent?notice('<strong>Correcting a retained submission.</strong> This creates a child of '+h(parent.filename||parent.id)+'. The earlier source, findings and decision remain in its history.',"info"):"";
 let body;
 if(mode==="manual"){
 body='<form id="manual-form">'+formError()+supplierSelect(suppliers,parent?.supplier_id)+field("source_label","Source description",{required:true,value:"Manual supplier entry",help:"Describe the origin of the values you enter."})+
 '<div class="form-section"><h3>Product identity</h3><div class="fields">'+field("identifier_type","Identifier type",{required:true,value:"gtin",options:[{value:"gtin",label:"GTIN"},{value:"supplier",label:"Supplier identifier — including random-weight merchandise"}],full:true,help:"Choose the identity actually supplied for this item."})+field("gtin","GTIN",{required:true,inputmode:"numeric",help:"Preserved as text, including leading zeros."})+field("identifier","Original supplier identifier",{required:true,disabled:true,help:"Use the actual text identifier from the supplier’s catalog or record."})+field("identifier_namespace","Identifier namespace",{required:true,disabled:true,help:"The original catalog, system or supplier scope that makes this identifier unambiguous."})+field("identifier_note","Identifier source note",{optional:true,type:"textarea",full:true,help:"Retain the source context, including any random-weight item convention."})+field("provider_gln","Provider GLN",{optional:true,inputmode:"numeric"})+field("name","Product name",{required:true})+field("brand","Brand",{optional:true})+field("description","Description",{type:"textarea",optional:true,full:true})+'</div></div>'+
 '<div class="form-section"><h3>Product information</h3><div class="fields">'+field("ingredients","Ingredients",{type:"textarea",optional:true})+field("allergens","Allergens",{type:"textarea",optional:true})+field("net_content","Net content",{optional:true,help:"Retain the supplied quantity and unit as written."})+field("packaging","Packaging",{optional:true})+'</div></div>'+
 '<details class="form-section"><summary>Structured attributes and additional items</summary><p class="muted small">Use the original normalized values. Numeric identifiers should remain JSON strings.</p><div class="fields">'+field("dimensions","Dimensions",{type:"textarea",code:true,optional:true,help:"JSON object or array; leave blank when unknown."})+field("nutrition","Nutrition",{type:"textarea",code:true,optional:true,help:"JSON object or array; no values are inferred."})+field("images","Image references",{type:"textarea",code:true,optional:true,help:"JSON array of the supplied image references."})+field("attributes","Additional source attributes",{type:"textarea",code:true,optional:true,help:"JSON object or original ordered attribute array."})+field("additional_items","Additional complete items",{type:"textarea",code:true,optional:true,full:true,help:"JSON array. The structured item above remains the first item."})+'</div></details>'+
 formActions("Submit for validation","The native validator determines completeness and review eligibility.")+'</form>';
 }else{
 body='<form id="upload-form">'+formError()+supplierSelect(suppliers,parent?.supplier_id)+field("source_label","Source description",{required:true,value:"",placeholder:"Publisher export, supplier correction or supplied documentation…",help:"Keep sample or documentation provenance explicit."})+
 '<div class="upload-zone" id="source-drop"><div class="empty-icon">'+icon("upload")+'</div><strong>Choose the original supplier file</strong><p>CSV, XLSX, XML, ZIP or JSON. Original bytes are retained alongside normalized items.</p><label class="sr-only" for="source-file">Supplier source file</label><input type="file" id="source-file" name="source_file" accept=".csv,.xlsx,.xml,.zip,.json" required></div><div id="upload-state" class="upload-list" aria-live="polite"></div>'+
 formActions("Import & validate","Import creates a retained submission. It does not approve or publish products.")+'</form>';
 }
 content(header(parent?"Submit a correction":"New supplier submission","Keep original files and identity intact while the native validator checks the content.",link("submissions","Back to submissions","button quiet"))+
 '<div class="grid-aside"><section class="card"><div class="card-body stack">'+top+'<nav class="tabs" aria-label="Submission method">'+link("submissions/new?mode=file"+(parentId?"&parent_id="+enc(parentId):""),"Original file")+
 link("submissions/new?mode=manual"+(parentId?"&parent_id="+enc(parentId):""),"Manual entry")+'</nav>'+body+'</div></section><aside class="stack">'+
 card("What happens next",'<div class="timeline"><div class="timeline-item"><div class="timeline-marker"></div><div><strong>Retain source</strong><p>The original file or manual values receive their own source identity.</p></div></div><div class="timeline-item"><div class="timeline-marker"></div><div><strong>Validate content</strong><p>Errors and warnings refer to the affected item and field.</p></div></div><div class="timeline-item"><div class="timeline-marker"></div><div><strong>Record a decision</strong><p>An authorized reviewer approves or rejects this exact revision.</p></div></div></div>')+
 card("Supplier formats",'<p class="small muted">The current publisher profile follows retained source documentation. A documentation sample remains a sample; importing it does not establish a live GDSN or government connection.</p>')+'</aside></div>',g);
 if(g!==state.generation)return;$$(".tabs a").forEach(a=>{if(a.hash.includes("mode="+mode))a.setAttribute("aria-current","page");});
 if(mode==="manual"){bindManualIdentity($("#manual-form"));onForm("#manual-form",async d=>{
 const item=Object.fromEntries(["gtin","identifier_type","identifier","identifier_namespace","identifier_note","provider_gln","name","brand","description","ingredients","allergens","net_content","packaging"].map(k=>[k,String(d.get(k)||"")]));if(item.identifier_type==="gtin")item.identifier=item.gtin;
 for(const k of["dimensions","nutrition","attributes"])item[k]=parseJSON(d.get(k),label(k),{});
 item.images=parseJSON(d.get("images"),"Images",[]);if(!Array.isArray(item.images))throw new Error("Images must be a JSON array.");
 const extra=parseJSON(d.get("additional_items"),"Additional items",[]);if(!Array.isArray(extra))throw new Error("Additional items must be a JSON array.");
 const data=await mutate("/submissions/manual",{supplier_id:state.session.user.supplier_id||d.get("supplier_id"),items:[item,...extra],parent_id:parentId||undefined,source_label:d.get("source_label")},{name:"Manual supplier submission"});toast("Submission retained and validated.");go("submissions/"+enc(data.id));
 });}
 else{
 const drop=$("#source-drop"),input=$("#source-file");for(const type of["dragenter","dragover"])drop.addEventListener(type,e=>{e.preventDefault();drop.classList.add("dragging");});for(const type of["dragleave","drop"])drop.addEventListener(type,e=>{e.preventDefault();drop.classList.remove("dragging");});drop.addEventListener("drop",e=>{if(e.dataTransfer.files.length===1){input.files=e.dataTransfer.files;input.dispatchEvent(new Event("change"));}else toast("Choose one original source file for this submission.","warning");});
 input.onchange=()=>{const f=input.files[0];$("#upload-state").innerHTML=f?'<div class="upload-item"><strong>'+h(f.name)+'</strong><span>'+h(fmtBytes(f.size))+'</span><span class="muted small">Ready to read the original bytes.</span></div>':"";};
 onForm("#upload-form",async d=>{
 const f=input.files[0];if(!f)throw new Error("Choose the original supplier file.");
 const target=$("#upload-state");target.innerHTML='<div class="upload-item"><strong>'+h(f.name)+'</strong><span>'+h(fmtBytes(f.size))+'</span><span id="upload-progress-text" class="muted small">Reading source file…</span><div class="progress-track"><span id="upload-progress"></span></div></div>';
 const b64=await fileBase64(f,p=>{const bar=$("#upload-progress");if(bar)bar.style.width=(p*100)+"%";});$("#upload-progress-text").textContent="Source read. Waiting for native validation…";
 const data=await mutate("/submissions",{supplier_id:state.session.user.supplier_id||d.get("supplier_id"),filename:f.name,content_base64:b64,parent_id:parentId||undefined,source_label:d.get("source_label")},{name:"Import "+f.name});toast("Original source retained and validated.");go("submissions/"+enc(data.id));
 });
 }
}
function findingRows(rows){return rows.map(f=>tr([pill(f.severity),'<strong>'+h(f.code)+'</strong><span class="table-sub">'+h(f.message)+'</span>','<span class="mono">'+h(f.item_key||"Whole submission")+'</span>','<span class="mono">'+h(f.field||"—")+'</span>']));}
function flattenAttributes(value){
 const rows=[];let order=0;
 function visit(v,path){
 if(Array.isArray(v)){v.forEach((x,i)=>{if(x&&typeof x==="object"&&!Array.isArray(x)&&("name" in x||"path" in x||"source_path" in x)){rows.push({order:++order,path:String(x.path||x.source_path||path+"["+i+"]"),name:String(x.name||x.attribute||""),value:x});}else visit(x,path+"["+i+"]");});}
 else if(v&&typeof v==="object"){for(const [key,x]of Object.entries(v))visit(x,path?path+"."+key:key);}
 else rows.push({order:++order,path,name:path.split(/[./]/).filter(Boolean).pop()||path,value:v});
 }
 visit(value||{},"");return rows;
}
function attributeBrowser(value,id){
 const original=flattenAttributes(value);let q="",offset=0,size=25;
 const renderRows=()=>{const filtered=original.filter(r=>!q||(r.path+" "+r.name+" "+JSON.stringify(r.value)).toLowerCase().includes(q));offset=Math.min(offset,Math.max(0,Math.floor((filtered.length-1)/size)*size));const selected=filtered.slice(offset,offset+size);
 $("#"+id).innerHTML='<form class="toolbar" data-attribute-filter>'+field("attribute_q","Find an original attribute",{value:q,placeholder:"Source path, name or value",id:id+"-query"})+'<div class="toolbar-actions"><button type="submit" class="button small">Search attributes</button></div></form>'+
 (selected.length?table(["Source order / path","Name","Original value"],selected.map(r=>tr(['<span class="muted small">#'+h(r.order)+'</span><span class="table-sub mono">'+h(r.path)+'</span>',h(r.name),'<details><summary>'+h((typeof r.value==="object"?JSON.stringify(r.value):String(r.value)).slice(0,130))+'</summary>'+code(r.value)+'</details>'])),"table-wide table-compact"):empty("No attributes match","Try a shorter original name or source value."))+
 '<div class="pagination"><span>'+h(filtered.length?offset+1:0)+'–'+h(Math.min(offset+size,filtered.length))+' of '+h(filtered.length)+' matched · '+h(original.length)+' retained rows</span><div class="actions">'+button("attr-prev","Previous","small",(!offset?"disabled":""))+button("attr-next","Next","small",(offset+size>=filtered.length?"disabled":""))+'</div></div>';
 const form=$("[data-attribute-filter]",$("#"+id));form.onsubmit=e=>{e.preventDefault();q=String(new FormData(form).get("attribute_q")||"").toLowerCase();offset=0;renderRows();};$("[data-action=attr-prev]",$("#"+id)).onclick=()=>{offset=Math.max(0,offset-size);renderRows();};$("[data-action=attr-next]",$("#"+id)).onclick=()=>{offset+=size;renderRows();};
 };renderRows();
}
function itemSections(item,attrsId){
 const images=Array.isArray(item.images)?item.images:Object.entries(item.images||{}).map(([name,v])=>({name,value:v}));
 return '<div class="stack">'+dl([["Item key",'<span class="mono">'+h(item.key)+'</span>'],["Identifier",identityHTML(item)],["Identifier namespace",h(itemIdentity(item).namespace||"Not supplied")],["Identifier source note",h(itemIdentity(item).note||"Not supplied")],["GTIN",'<span class="mono">'+h(item.gtin||"Not supplied")+'</span>'],["Provider GLN",'<span class="mono">'+h(item.provider_gln||"Not supplied")+'</span>'],["Brand",h(item.brand||"Not supplied")],["Description",h(item.description||"Not supplied")],["Net content",h(textValue(item.net_content))]])+
 '<div class="grid-2">'+card("Ingredients",'<p class="small break">'+h(textValue(item.ingredients))+'</p>')+card("Allergens",'<p class="small break">'+h(textValue(item.allergens))+'</p>')+'</div>'+
 '<div class="grid-3">'+["dimensions","packaging","nutrition"].map(k=>card(label(k),typeof item[k]==="object"?code(item[k]):'<p class="small break">'+h(textValue(item[k]))+'</p>')).join("")+'</div>'+
 card("Supplied image references",images.length?'<div class="source-list">'+images.map(image=>{const u=typeof image==="string"?image:image.url||image.href||image.value;return'<div class="source-item">'+(typeof u==="string"?safeReference(u):code(image))+(typeof image==="object"&&image!==null?'<details><summary>Original reference metadata</summary>'+code(image)+'</details>':"")+'</div>';}).join("")+'</div>':'<p class="muted small">No image references were supplied for this item.</p>')+
 '<section class="card"><div class="card-head"><div><h2>Original source attributes</h2><p>Searchable, paged values. Original paths, qualifiers and repeated values remain in the source.</p></div></div><div id="'+h(attrsId)+'"></div></section></div>';
}
function openItem(item){const d=showDialog(itemTitle(item),itemSections(item,"dialog-attributes"),button("close-item","Close","primary"));d.classList.add("dialog-wide");$("[data-action=close-item]",d).onclick=()=>d.close();attributeBrowser(item.attributes,"dialog-attributes");}
async function submissionView(id,g){
 const r=await api("/submissions/"+enc(id),{signal:state.abort.signal}),tab=routeInfo().query.get("tab")||"items",findings=r.findings||[],items=r.items||[];
 const counts={errors:findings.filter(f=>f.severity==="error").length,warnings:findings.filter(f=>f.severity==="warning").length},q=routeInfo().query.get("q")||"",p=pages(items.filter(i=>itemMatches(i,q,["key","gtin","name","brand","provider_gln"])),15);
 const tabs=[["items","Items ("+items.length+")"],["quality","Quality ("+findings.length+")"],["source","Original source"],["history","Review history"]];
 let body;
 if(tab==="quality"){const fp=pages(findings,25);body=card("Validation findings",findings.length?table(["Severity","Finding","Item","Field"],findingRows(fp.rows))+pager(fp):'<div class="notice"><strong>No validation findings.</strong> Review the actual source and product information before deciding.</div>');}
 else if(tab==="source")body=card("Source custody",dl([["Source label",h(r.source_label)],["Filename",h(r.filename)],["SHA-256",'<span class="mono">'+h(r.source_sha256)+'</span>'],["Parent submission",r.parent_id?link("submissions/"+enc(r.parent_id),h(r.parent_id)):"None"]])+'<div class="divider"></div>'+code(r.provenance||{})+(r.observations?.length?'<h3>Source observations</h3>'+code(r.observations):""));
 else if(tab==="history")body=card("Saved source and review events",r.history?.length?'<div class="timeline">'+activityRows(r.history)+'</div>':empty("No review events","This original submission has not yet received a review decision.","","history"));
 else body='<section class="card">'+listToolbar({query:q})+(p.rows.length?table(["Item","Identity","Brand","Details"],p.rows.map(item=>tr([
 '<strong>'+h(itemTitle(item))+'</strong><span class="table-sub">'+h(item.key)+'</span>',identityHTML(item)+'<span class="table-sub">Provider '+h(item.provider_gln||"not supplied")+'</span>',h(item.brand||"—"),
 button("open-item","Review item","small",'data-item-index="'+h(items.indexOf(item))+'"')
 ]))):empty("No normalized items",items.length?"No items match the current filter.":"Review the original source and validation findings. No products have been inferred."))+pager(p)+'</section>';
 const decided=["approved","rejected"].includes(String(r.status).toLowerCase());
 const review=canReview()?card("Review this revision",decided?'<p class="small">This submission is '+h(r.status)+'. Its retained decision remains in history.</p>'+link("submissions/new?parent_id="+enc(r.id),"Submit a correction","button small"):
 '<form id="review-form">'+formError()+field("decision","Decision",{required:true,options:[{value:"",label:"Choose a decision"},{value:"approve",label:"Approve eligible content"},{value:"reject",label:"Reject with a reason"}]})+field("note","Review note",{required:true,type:"textarea",help:"Explain the decision or the correction the supplier needs to make."})+
 (counts.warnings?check("acknowledge_warnings","I reviewed the warnings","Required for approval. This does not erase any original warning."):"")+
 formActions("Record decision","Applies only to revision "+r.revision)+
 (counts.errors?notice(h(counts.errors)+" error(s) prevent approval. Reject with a correction note or review a later corrected submission.","warning"):"")+'</form>'):
 card("Review status",'<p class="small">Your reviewer will decide this exact submission. If a correction is needed, create a child submission so both sources remain available.</p>'+link("submissions/new?parent_id="+enc(r.id),"Submit a correction","button small"));
 content(header(r.filename||r.source_label||"Supplier submission","Original supplier content, its validation findings and the exact review decision.",'<a class="button" href="/api/submissions/'+enc(r.id)+'/download">'+icon("file")+'Download original</a>'+link("submissions","All submissions","button quiet"),r.supplier_name||"Supplier submission")+
 '<div class="meta-line page-message">'+pill(r.status)+'<span>Revision '+h(r.revision)+'</span><span>·</span><span>'+h(date(r.created_at))+'</span><span class="mono">'+h(r.id)+'</span></div>'+
 metrics([["Normalized items",items.length,"Preserved item identities"],["Errors",counts.errors,"Must be resolved before approval"],["Warnings",counts.warnings,"Require explicit reviewer acknowledgment"],["Source revision",r.revision,"Decision uses this exact version"]])+
 '<nav class="tabs" aria-label="Submission detail">'+tabs.map(([t,title])=>'<a href="#submissions/'+enc(r.id)+'?tab='+t+'"'+(tab===t?' aria-current="page"':"")+'>'+h(title)+'</a>').join("")+'</nav><div class="grid-review"><div>'+body+'</div><aside class="stack review-sticky">'+review+
 card("Source identity",'<span class="mono small">'+h(r.source_sha256)+'</span><p class="muted small">Original bytes remain downloadable. Approved editions retain this source identity.</p>')+'</aside></div>',g);
 if(g!==state.generation)return;bindFilter();$("[data-item-index]").forEach(b=>b.onclick=()=>openItem(items[Number(b.dataset.itemIndex)]));
 onForm("#review-form",async d=>{if(d.get("decision")==="approve"&&counts.errors)throw new Error("This source has errors. Approval is unavailable until a corrected submission resolves them.");if(d.get("decision")==="approve"&&counts.warnings&&!d.get("acknowledge_warnings"))throw new Error("Acknowledge the retained warnings before approving this revision.");
 await mutate("/submissions/"+enc(r.id)+"/review",{expected_revision:r.revision,decision:d.get("decision"),note:d.get("note"),acknowledge_warnings:!!d.get("acknowledge_warnings")},{name:"Review submission revision "+r.revision});toast("Decision saved with its source revision.");render();
 });
}
async function productView(id,g){
 const p=await api("/products/"+enc(id),{signal:state.abort.signal}),item=p.item||{};
 content(header(itemTitle(p),"Approved content retains the exact supplier source and edition used for each export.",link("submissions/"+enc(p.submission_id),"Approval source","button")+link("products","All products","button quiet"),p.supplier_name||"Approved product")+
 '<div class="meta-line page-message">'+pill(p.is_current?"Current edition":"Historical edition",p.is_current?"good":"neutral")+'<span>Edition '+h(p.edition)+'</span><span>· Approved '+h(date(p.approved_at))+'</span></div>'+
 '<div class="grid-aside"><div>'+itemSections(item,"product-attributes")+'</div><aside class="stack">'+card("Edition identity",dl([["Native product",'<span class="mono">'+h(p.id)+'</span>'],["Source SHA-256",'<span class="mono">'+h(p.source_sha256)+'</span>'],["Submission",link("submissions/"+enc(p.submission_id),h(p.submission_id))]]))+
 card("Product history",'<div class="item-list">'+(p.history||[]).map(e=>'<div class="item-row"><div class="grow">'+link("products/"+enc(e.id),"<strong>Edition "+h(e.edition)+"</strong>")+'<p>'+h(date(e.approved_at))+'</p></div>'+(e.id===p.id?pill("Selected","info"):"")+'</div>').join("")+'</div>')+'</aside></div>',g);
 if(g===state.generation)attributeBrowser(item.attributes,"product-attributes");
}


async function suppliersView(g){
 const rows=await api("/suppliers",{signal:state.abort.signal}),q=routeInfo().query.get("q")||"",p=pages(rows.filter(r=>matches(r,q,["name","gln","contact_email","id"])));
 content(header("Supplier organizations","Keep provider identity, delegated access and submissions within the correct supplier scope.",isAdmin()?button("new-supplier",icon("plus")+"Add supplier","primary"):"")+
 '<section class="card">'+listToolbar({query:q})+(p.rows.length?table(["Supplier","Provider GLN","Contact","Submissions"],p.rows.map(r=>tr(['<strong>'+h(r.name)+'</strong><span class="table-sub mono">'+h(r.id)+'</span>','<span class="mono">'+h(r.gln||"Not supplied")+'</span>',h(r.contact_email||"Not supplied"),link("submissions?supplier_id="+enc(r.id),"Open submissions","button small")]))):empty("No supplier organizations","An administrator can add the organization responsible for the original product content.","","suppliers"))+pager(p)+'</section>',g);bindFilter();
 const add=$("[data-action=new-supplier]");if(add)add.onclick=()=>{
 const d=showDialog("Add a supplier",'<form id="supplier-form">'+formError()+field("name","Supplier name",{required:true})+field("gln","Provider GLN",{optional:true,inputmode:"numeric",help:"Keep leading zeros and the original provider identity."})+field("contact_email","Contact email",{type:"email",optional:true})+formActions("Create supplier")+'</form>');
 onForm("#supplier-form",async f=>{await mutate("/suppliers",{name:f.get("name"),gln:f.get("gln"),contact_email:f.get("contact_email")},{name:"Create supplier organization"});d.close();toast("Supplier created.");render();});
 };
}
async function usersView(g){
 const [rows,suppliers]=await Promise.all([api("/users",{signal:state.abort.signal}),api("/suppliers",{signal:state.abort.signal})]),q=routeInfo().query.get("q")||"",p=pages(rows.filter(r=>matches(r,q,["name","email","role","supplier_name"])));
 content(header("People & access","Delegated supplier administrators manage their own organization’s users. Workspace administrators manage review roles.",button("new-user",icon("plus")+"Add person","primary"))+
 '<section class="card">'+listToolbar({query:q})+(p.rows.length?table(["Person","Role","Supplier scope","Access","Action"],p.rows.map(r=>tr([
 '<strong>'+h(r.name)+'</strong><span class="table-sub">'+h(r.email)+'</span>',h(label(r.role)),h(r.supplier_name||suppliers.find(s=>s.id===r.supplier_id)?.name||(r.supplier_id||"Workspace review")),
 pill(r.active===false?"Inactive":"Active")+'<span class="table-sub">'+(r.mfa_enabled?"Authenticator enabled":"Authenticator not enabled")+'</span>',
 r.id===state.session.user.id?'<span class="muted small">Your account</span>':button("toggle-user",r.active===false?"Reactivate":"Deactivate","small "+(r.active===false?"":"danger"),'data-user-id="'+h(r.id)+'"')
 ]))):empty("No people in this scope","Add a person with the appropriate supplier or review role.","","users"))+pager(p)+'</section>',g);bindFilter();if(g!==state.generation)return;
 $("[data-action=new-user]").onclick=()=>{
 const roles=isAdmin()?["supplier","supplier_admin","reviewer","admin"]:["supplier","supplier_admin"],d=showDialog("Add a person",'<form id="user-form">'+formError()+field("name","Name",{required:true,autocomplete:"name"})+field("email","Email",{required:true,type:"email",autocomplete:"username"})+field("password","Initial password",{required:true,type:"password",autocomplete:"new-password",minlength:12,help:"Give the initial credential to its owner through your approved channel."})+field("role","Role",{required:true,value:"supplier",options:roles})+supplierSelect(suppliers)+formActions("Create person","Credentials are not retained in browser request storage.")+'</form>');
 const role=$("#field-role",d),supplier=$("#field-supplier_id",d);const refresh=()=>{const needs=role.value.startsWith("supplier");supplier.required=needs;supplier.closest(".field").hidden=!needs;};role.onchange=refresh;refresh();
 onForm("#user-form",async f=>{const role=f.get("role");await mutate("/users",{name:f.get("name"),email:f.get("email"),password:f.get("password"),role,supplier_id:role.startsWith("supplier")?(state.session.user.supplier_id||f.get("supplier_id")):null},{name:"Create person "+f.get("email"),sensitive:true});d.close();toast("Person created with scoped access.");render();});
 };
 $$("[data-user-id]").forEach(b=>b.onclick=()=>{
 const user=rows.find(r=>r.id===b.dataset.userId),active=user.active===false;
 const d=showDialog(active?"Reactivate this account?":"Deactivate this account?",'<p>'+h(user.name)+" · "+h(user.email)+'</p><p class="muted small">'+(active?"This restores the user’s assigned role and supplier scope.":"This removes the user’s active access while preserving their authored history.")+'</p>',button("confirm-user",active?"Reactivate":"Deactivate",active?"primary":"danger")+button("cancel-user","Cancel"));
 $("[data-action=cancel-user]",d).onclick=()=>d.close();$("[data-action=confirm-user]",d).onclick=async e=>{const btn=e.currentTarget;btn.disabled=true;try{await mutate("/users/"+enc(user.id),{expected_revision:user.revision,active},{name:(active?"Reactivate ":"Deactivate ")+user.name});d.close();toast("Account access updated.");render();}catch(err){toast(err.message,"danger");btn.disabled=false;}};
 });
}
const CORE_PATHS=["key","gtin","identifier_type","identifier","identifier_namespace","identifier_note","provider_gln","name","brand","description","ingredients","allergens","net_content","dimensions","packaging","images","nutrition"];
function mappingFieldRow(f={},index=0){return '<tr data-mapping-row><td><label class="sr-only" for="map-source-'+index+'">Source path '+(index+1)+'</label><input id="map-source-'+index+'" data-map-source list="source-paths" value="'+h(f.source||"")+'" required placeholder="name or attributes.originalName"></td><td><label class="sr-only" for="map-target-'+index+'">Target field '+(index+1)+'</label><input id="map-target-'+index+'" data-map-target value="'+h(f.target||"")+'" required placeholder="Receiving field name"></td><td><label class="check-row"><input type="checkbox" data-map-required '+(f.required?"checked":"")+'><span>Required</span></label></td><td>'+button("remove-map",icon("close"),"icon quiet",'aria-label="Remove this field mapping"')+'</td></tr>';}
function readMapping(form){return $$("[data-mapping-row]",form).map(row=>({source:$("[data-map-source]",row).value.trim(),target:$("[data-map-target]",row).value.trim(),required:$("[data-map-required]",row).checked}));}
function selectionTable(rows,selected){return rows.length?table(['<span class="sr-only">Select product</span>','Approved product','Identity','Edition'],rows.map(p=>tr(['<input type="checkbox" data-product-id="'+h(p.id)+'" aria-label="Select '+h(itemTitle(p))+'" '+(selected.has(p.id)?"checked":"")+'>','<strong>'+h(itemTitle(p))+'</strong><span class="table-sub">'+h(p.supplier_name||"")+'</span>',identityHTML(p),h(p.edition)]))):empty("No approved editions","Approve a source submission before preparing an output.");}

function mountProductSelection(id,products,selected,onChange){
 const container=document.getElementById(id);let query="",offset=0;const size=20;
 const draw=()=>{
 const filtered=products.filter(p=>itemMatches(p,query,["name","key","gtin","supplier_name"]));offset=Math.min(offset,Math.max(0,Math.floor((filtered.length-1)/size)*size));
 container.innerHTML='<div data-product-filter class="toolbar">'+field("selection_query","Find approved editions",{value:query,id:id+"-search",placeholder:"Product, identifier, namespace or supplier"})+'<div class="toolbar-actions"><button type="button" data-filter-editions class="button small">Filter editions</button></div></div>'+selectionTable(filtered.slice(offset,offset+size),selected)+
 '<div class="pagination"><span>'+h(filtered.length?offset+1:0)+'–'+h(Math.min(offset+size,filtered.length))+' of '+h(filtered.length)+' matching editions</span><div class="actions">'+button("pick-prev","Previous","small",offset?"":"disabled")+button("pick-next","Next","small",offset+size<filtered.length?"":"disabled")+'</div></div>';
 bindSelection(container,selected,onChange);const input=$('[name="selection_query"]',container);const filter=()=>{query=input.value;offset=0;draw();};$("[data-filter-editions]",container).onclick=filter;input.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();filter();}};$("[data-action=pick-prev]",container).onclick=()=>{offset-=size;draw();};$("[data-action=pick-next]",container).onclick=()=>{offset+=size;draw();};
 };draw();
}

function bindSelection(container,selected,callback=()=>{}){$$("[data-product-id]",container).forEach(b=>b.onchange=()=>{if(b.checked)selected.add(b.dataset.productId);else selected.delete(b.dataset.productId);callback();});}
function previewHTML(result){
 const findings=result.findings||result.warnings||[],rows=result.rows||result.preview||[];
 return '<div class="stack">'+(findings.length?notice("<strong>Mapping findings</strong>"+'<ul>'+findings.map(f=>'<li>'+h(typeof f==="string"?f:f.message||json(f))+'</li>').join("")+'</ul>',"warning"):notice("The native mapping preview is available. The final release validates required values again."))+
 (Array.isArray(rows)&&rows.length?objectRowsTable(rows.slice(0,20)):"")+
 '<details><summary>Complete native preview</summary>'+code(result)+'</details></div>';
}
function objectRowsTable(rows){const keys=Array.from(new Set(rows.flatMap(r=>Object.keys(r||{}))));return table(keys.map(h),rows.map(r=>tr(keys.map(k=>'<span class="break">'+h(textValue(r[k]))+'</span>'))));}
async function mappingsView(g){
 const rows=await api("/mappings",{signal:state.abort.signal}),q=routeInfo().query.get("q")||"",p=pages(rows.filter(r=>matches(r,q,["name","target","format"])));
 content(header("Output mappings","Each saved mapping is a retained version. Preview the exact normalized fields before preparing a release.",link("mappings/new",icon("plus")+"Create mapping","button primary"))+
 '<section class="card">'+listToolbar({query:q})+(p.rows.length?table(["Mapping","Target","Format","Version","Fields"],p.rows.map(r=>tr([link("mappings/"+enc(r.id),h(r.name),"table-title"),h(r.target),h(String(r.format).toUpperCase()),h(r.version),h((r.fields||[]).length)]))):empty("No output mappings","Describe a receiving system’s documented field names, then preview approved product editions.",link("mappings/new","Create mapping","button primary"),"mapping"))+pager(p)+'</section>',g);bindFilter();
}
async function mappingEditView(g){
 const [mappings,products]=await Promise.all([api("/mappings",{signal:state.abort.signal}),api("/products",{signal:state.abort.signal})]),from=routeInfo().query.get("from"),previous=from?mappings.find(m=>m.id===from):null,selected=new Set();
 content(header(previous?"Create a mapping successor":"Create an output mapping","Use documented receiving field names. The saved version remains immutable.",link("mappings","All mappings","button quiet"))+
 '<form id="mapping-form">'+formError()+'<div class="grid-aside"><div class="stack">'+card("Mapping definition",'<div class="fields">'+field("name","Mapping name",{required:true,value:previous?.name||""})+field("target","Receiving system / target",{required:true,value:previous?.target||"",help:"A descriptive target, not a configured network endpoint."})+field("format","Output format",{required:true,value:previous?.format||"csv",options:[{value:"csv",label:"CSV"},{value:"json",label:"JSON"}]})+'</div>'+
 '<datalist id="source-paths">'+CORE_PATHS.map(p=>'<option value="'+h(p)+'"></option>').join("")+'</datalist><div class="table-wrap"><table class="mapping-editor"><thead><tr><th>Normalized source path</th><th>Receiving field</th><th>Presence</th><th></th></tr></thead><tbody id="mapping-fields">'+(previous?.fields?.length?previous.fields:[{}]).map(mappingFieldRow).join("")+'</tbody></table></div><div class="actions">'+button("add-map",icon("plus")+"Add field","small")+'</div><p class="muted small">Use attributes.&lt;original name&gt; only when that name identifies one unambiguous source value. Qualified or repeated values remain in the original source.</p>')+
 card("Preview with approved editions",'<div class="meta-line"><span id="map-selection-count">0 selected</span>'+button("select-all-products","Select all","small quiet")+button("clear-products","Clear","small quiet")+'</div><div id="map-products">'+'' +'</div><div class="actions">'+button("preview-map","Preview selected editions","primary")+'</div><div id="mapping-preview" class="stack"></div>')+'</div><aside class="stack">'+
 card("Versioned definition",previous?'<p class="small">This uses '+h(previous.name)+' version '+h(previous.version)+' as a starting point. The earlier field map and its releases remain available.</p>':'<p class="small">Save a mapping once the receiving field names and required values are explicit. A release pins one saved mapping version and the exact approved product editions.</p>')+
 card("Save this field map",formActions("Save mapping","Required values are checked again for every release."))+'</aside></div></form>',g);if(g!==state.generation)return;
 let nextIndex=(previous?.fields?.length||1);const bindRows=()=>$$("[data-action=remove-map]").forEach(b=>b.onclick=()=>{b.closest("tr").remove();});bindRows();
 $("[data-action=add-map]").onclick=()=>{$("#mapping-fields").insertAdjacentHTML("beforeend",mappingFieldRow({},nextIndex++));bindRows();};
 const count=()=>{$("#map-selection-count").textContent=selected.size+" selected";};mountProductSelection("map-products",products,selected,count);
 $("[data-action=select-all-products]").onclick=()=>{products.forEach(p=>selected.add(p.id));$$("[data-product-id]").forEach(x=>x.checked=true);count();};
 $("[data-action=clear-products]").onclick=()=>{selected.clear();$$("[data-product-id]").forEach(x=>x.checked=false);count();};
 $("[data-action=preview-map]").onclick=async e=>{const b=e.currentTarget;b.disabled=true;try{const f=$("#mapping-form"),fields=readMapping(f);if(!fields.length||fields.some(x=>!x.source||!x.target))throw new Error("Add complete source and target names for the field map.");if(!selected.size)throw new Error("Select at least one approved edition for this preview.");const result=await mutate("/mappings/preview",{fields,format:f.elements.format.value,product_ids:[...selected]},{name:"Preview output mapping"});$("#mapping-preview").innerHTML=previewHTML(result);}catch(err){showFormError($("#mapping-form"),err);}finally{b.disabled=false;}};
 onForm("#mapping-form",async(d,form)=>{const fields=readMapping(form);if(!fields.length)throw new Error("Add at least one field mapping.");const result=await mutate("/mappings",{name:d.get("name"),target:d.get("target"),format:d.get("format"),fields},{name:"Save mapping "+d.get("name")});toast("Immutable mapping version saved.");go("mappings/"+enc(result.id));});
}
async function mappingView(id,g){
 const mappings=await api("/mappings",{signal:state.abort.signal}),m=mappings.find(r=>r.id===id);if(!m)throw new Error("This mapping is not available in your current scope.");
 content(header(m.name,"This retained version supplies the exact field transformation used by a release.",link("mappings/new?from="+enc(id),"Create successor","button")+link("releases/new?mapping_id="+enc(id),"Prepare release","button primary"))+
 '<div class="meta-line page-message">'+pill("Version "+m.version,"info")+'<span>'+h(m.target)+'</span><span>'+h(String(m.format).toUpperCase())+'</span></div>'+
 card("Retained field map",table(["Normalized source","Receiving field","Presence"],(m.fields||[]).map(f=>tr(['<span class="mono">'+h(f.source)+'</span>','<span class="mono">'+h(f.target)+'</span>',f.required?pill("Required","warning"):"Optional"]))))+
 '<div class="divider"></div>'+card("Complete definition",code(m)),g);
}
async function releasesView(g){
 const rows=await api("/releases",{signal:state.abort.signal}),q=routeInfo().query.get("q")||"",p=pages(rows.filter(r=>matches(r,q,["name","target","filename","mapping_name"])));
 content(header("Release register","Prepare exact files from approved editions. Record downstream acknowledgments against their retained hashes.",link("releases/new",icon("plus")+"Prepare release","button primary"))+
 '<section class="card">'+listToolbar({query:q})+(p.rows.length?table(["Release","Target & map","State","Exact output","Prepared"],p.rows.map(r=>tr([
 link("releases/"+enc(r.id),h(r.name||r.filename||r.id),"table-title")+'<span class="table-sub">'+h((r.products||[]).length)+' approved editions</span>',
 h(r.target)+'<span class="table-sub">'+h(r.mapping_name)+' · Version '+h(r.mapping_version)+'</span>',pill(r.status),
 h(String(r.format||"").toUpperCase())+' · '+h(fmtBytes(r.bytes))+'<span class="table-sub mono">'+h((r.sha256||"").slice(0,16))+'…</span>',h(date(r.created_at))
 ]))):empty("No releases yet","Create a field map and select approved product editions to prepare a frozen output.",link("mappings","Open mappings","button"),"release"))+pager(p)+'</section>',g);bindFilter();
}
async function newReleaseView(g){
 const [mappings,products]=await Promise.all([api("/mappings",{signal:state.abort.signal}),api("/products",{signal:state.abort.signal})]),selected=new Set(),initial=routeInfo().query.get("mapping_id")||"";
 content(header("Prepare a product release","The output pins an immutable mapping and the exact approved editions selected below.",link("releases","Release register","button quiet"))+
 '<form id="release-form">'+formError()+'<div class="grid-aside"><div class="stack">'+card("Release details",'<div class="fields">'+field("name","Release name",{optional:true,placeholder:"Purpose or receiving reference"})+field("mapping_id","Retained field map",{required:true,value:initial,options:[{value:"",label:"Choose a mapping version"},...mappings.map(m=>({value:m.id,label:m.name+" · v"+m.version+" · "+m.target}))]})+field("note","Preparation note",{type:"textarea",optional:true,full:true})+'</div>')+
 card("Select approved editions",'<div class="meta-line page-message"><span id="release-selection-count">0 selected</span>'+button("release-select-all","Select all","small quiet")+button("release-clear-all","Clear","small quiet")+'</div><div id="release-products">'+'' +'</div>')+
 card("Preview the receiving fields",'<p class="muted small">The preview uses the selected mapping and editions. Required missing values prevent final preparation.</p><div class="actions">'+button("preview-release","Preview selected output","primary")+'</div><div id="release-preview" class="stack"></div>')+'</div><aside class="stack">'+
 card("Frozen output",'<p class="small">Creating a release prepares a downloadable file and retains its hash, field map and product editions. Acknowledgment is recorded separately from the release detail.</p>'+formActions("Prepare release"))+'</aside></div></form>',g);if(g!==state.generation)return;
 const count=()=>{$("#release-selection-count").textContent=selected.size+" selected";$("#release-preview").innerHTML="";};mountProductSelection("release-products",products,selected,count);
 $("[data-action=release-select-all]").onclick=()=>{products.forEach(p=>selected.add(p.id));$$("[data-product-id]").forEach(c=>c.checked=true);count();};
 $("[data-action=release-clear-all]").onclick=()=>{selected.clear();$$("[data-product-id]").forEach(c=>c.checked=false);count();};
 $("#field-mapping_id").onchange=count;
 $("[data-action=preview-release]").onclick=async e=>{const b=e.currentTarget;b.disabled=true;try{const mapping=mappings.find(m=>m.id===$("#field-mapping_id").value);if(!mapping)throw new Error("Choose the retained mapping version.");if(!selected.size)throw new Error("Select at least one approved edition.");const result=await mutate("/mappings/preview",{fields:mapping.fields,format:mapping.format,product_ids:[...selected]},{name:"Preview release output"});$("#release-preview").innerHTML=previewHTML(result);}catch(err){showFormError($("#release-form"),err);}finally{b.disabled=false;}};
 onForm("#release-form",async d=>{if(!selected.size)throw new Error("Select at least one approved product edition.");const result=await mutate("/releases",{name:d.get("name"),mapping_id:d.get("mapping_id"),product_ids:[...selected],note:d.get("note")},{name:"Prepare frozen product release"});toast("Exact release prepared.");go("releases/"+enc(result.id));});
}
async function releaseView(id,g){
 const r=await api("/releases/"+enc(id),{signal:state.abort.signal}),tab=routeInfo().query.get("tab")||"content";
 let body;
 if(tab==="history")body=card("Acknowledgment history",r.acks?.length?'<div class="source-list">'+r.acks.map(a=>'<div class="source-item"><div class="space-between"><strong>'+h(a.reference||"Retained acknowledgment")+'</strong>'+pill(a.status)+'</div><p>'+h(a.message||"")+'</p><div class="meta-line">'+h(date(a.created_at||a.at))+' · '+h(a.actor_name||a.created_by||a.operator||"")+'</div><details><summary>Exact acknowledgment record</summary>'+code(a)+'</details></div>').join("")+'</div>':'<p class="muted small">No acknowledgment has been recorded for these bytes.</p>')+
 '<div class="divider"></div>'+card("Delivery attempt records",r.attempts?.length?code(r.attempts):'<p class="muted small">This file has been prepared for the operator. No configured delivery attempt is recorded.</p>');
 else if(tab==="editions")body=card("Pinned product editions",table(["Product identity","Edition","Original source","Product"],(r.products||[]).map(p=>tr([identityHTML(p),h(p.edition),link("submissions/"+enc(p.submission_id),h(p.submission_id))+'<span class="table-sub mono">'+h(p.source_sha256)+'</span>',link("products/"+enc(p.id),"Open edition","button small")]))))+
 '<div class="divider"></div>'+card("Pinned mapping",code(r.mapping));
 else{const p=pages(r.rows||[],20);body='<section class="card"><div class="card-head"><h2>Frozen mapped rows</h2><span class="muted small">'+h(r.format)+' · '+h(fmtBytes(r.bytes))+'</span></div>'+(p.rows.length?objectRowsTable(p.rows):empty("No mapped rows","Inspect the exact output and preparation record."))+pager(p)+'</section>';}
 content(header(r.name||r.filename,"Exact product editions and mapped output remain unchanged as acknowledgment history grows.",'<a class="button primary" href="/api/releases/'+enc(r.id)+'/download">'+icon("release")+'Download exact output</a>'+link("releases","All releases","button quiet"),r.target||"Product release")+
 '<div class="meta-line page-message">'+pill(r.status)+'<span>Revision '+h(r.revision)+'</span><span>· '+h(date(r.created_at))+'</span></div>'+
 '<nav class="tabs" aria-label="Release detail">'+[["content","Mapped output"],["editions","Pinned source editions"],["history","Acknowledgments & history"]].map(([t,title])=>'<a href="#releases/'+enc(id)+'?tab='+t+'"'+(tab===t?' aria-current="page"':"")+'>'+title+'</a>').join("")+'</nav>'+
 '<div class="grid-review"><div>'+body+'</div><aside class="stack">'+card("Output identity",dl([["File",h(r.filename)],["Bytes",h(amount(r.bytes))],["SHA-256",'<span class="mono">'+h(r.sha256)+'</span>'],["Mapping",h(r.mapping_name)+" · v"+h(r.mapping_version)],["Preparation note",h(r.note||"None")]]))+
 card("Record supplied acknowledgment",'<form id="ack-form">'+formError()+'<p class="muted small">Record an external or internal receipt you actually hold. This operator-entered record is bound to the exact output hash shown above.</p>'+field("status","Receiving decision",{required:true,options:[{value:"",label:"Choose the supplied decision"},{value:"accepted",label:"Accepted"},{value:"rejected",label:"Rejected"}]})+field("reference","Acknowledgment reference",{required:true,help:"Original message, ticket, response or signed receipt identifier."})+field("message","Original response / operator note",{required:true,type:"textarea"})+check("confirm","I checked the acknowledgment against this exact output","SHA-256 "+r.sha256)+formActions("Record acknowledgment","Applies to current release revision "+r.revision)+'</form>')+'</aside></div>',g);
 if(g!==state.generation)return;onForm("#ack-form",async d=>{if(!d.get("confirm"))throw new Error("Confirm that the supplied acknowledgment refers to these exact output bytes.");await mutate("/releases/"+enc(id)+"/ack",{expected_revision:r.revision,sha256:r.sha256,status:d.get("status"),reference:d.get("reference"),message:d.get("message")},{name:"Record acknowledgment for "+(r.name||r.filename)});toast("Hash-bound acknowledgment retained.");render();});
}


async function notificationsView(g){
 const rows=await api("/notifications",{signal:state.abort.signal}),p=pages(rows);
 content(header("Your notifications","Submission and review updates visible within your assigned workspace scope.")+
 '<section class="card">'+(p.rows.length?'<div class="card-body item-list">'+p.rows.map(n=>'<article class="item-row"><span class="item-icon">'+icon("bell")+'</span><div class="grow"><div class="space-between"><h3>'+h(n.title||label(n.kind||"Workspace update"))+'</h3>'+pill(n.read_at||n.read?"Read":"Unread",n.read_at||n.read?"neutral":"info")+'</div><p>'+h(n.message||n.body||"")+'</p><div class="meta-line">'+h(date(n.created_at))+'</div><div class="actions">'+(n.submission_id?link("submissions/"+enc(n.submission_id),"Open submission","button small quiet"):"")+(!(n.read_at||n.read)?button("read-notification","Mark as read","small",'data-notification-id="'+h(n.id)+'"'):"")+'</div></div></article>').join("")+'</div>':empty("You’re up to date","New workspace notifications will appear here after relevant supplier or review activity.","","bell"))+pager(p)+'</section>',g);
 if(g!==state.generation)return;$$("[data-notification-id]").forEach(b=>b.onclick=async()=>{b.disabled=true;try{await mutate("/notifications/"+enc(b.dataset.notificationId)+"/read",{}, {name:"Mark workspace notification read"});render();}catch(e){b.disabled=false;toast(e.message,"danger");}});
}
async function auditView(g){
 const rows=await api("/audit",{signal:state.abort.signal}),q=routeInfo().query.get("q")||"",filtered=rows.filter(r=>!q||JSON.stringify(r).toLowerCase().includes(q.toLowerCase())),p=pages(filtered);
 content(header("Workspace activity history","Retained native events show who changed source, access and operating state.")+
 '<section class="card">'+listToolbar({query:q})+(p.rows.length?table(["Activity","Actor / subject","When","Retained record"],p.rows.map(r=>tr([
 '<strong>'+h(label(r.action||r.kind||r.event||r.type))+'</strong><span class="table-sub">'+h(r.note||r.message||"")+'</span>',h(r.actor_name||r.user_name||textValue(r.actor||r.user_id))+'<span class="table-sub mono">'+h(r.entity_id||r.subject_id||r.target_id||"")+'</span>',
 h(date(r.created_at||r.at||r.timestamp)),'<details><summary>View event</summary>'+code(r)+'</details>'
 ]))):empty("No matching history","Adjust the filter to find an original event.","","history"))+pager(p)+'</section>',g);bindFilter();
}
async function handoffView(g){
 content(header("Complete project handoff","Preserve the application, original supplier files, decisions and account configuration together.")+
 '<div class="grid-2"><div class="stack">'+card("Save the private working project",'<p class="small">Download the complete retained case and included application source. The exported copy removes active login sessions and retains user accounts, password hashes and authenticator enrollment.</p>'+notice("<strong>Private account configuration is included.</strong> Store the archive in your approved private location. Recipients sign in again with the retained account credentials.","warning")+
 '<div class="actions spaced"><a class="button primary" href="/api/backup">'+icon("release")+'Download complete project ZIP</a></div>')+
 card("What remains with the case",'<ul class="small"><li>Original supplier files and source provenance</li><li>Submission findings, decisions and correction relationships</li><li>Approved product editions and immutable field maps</li><li>Exact released bytes and supplied acknowledgment history</li><li>Users, authenticator enrollment and native audit history</li><li>Complete application source and receiving instructions</li></ul>')+'</div><div class="stack">'+
 card("Receive an existing complete project",'<form id="restore-form">'+formError()+'<p class="muted small">The trusted receiver verifies the archive and creates a separate receiving directory. The currently open workspace remains intact.</p><div class="upload-zone"><strong>Choose the original complete project ZIP</strong><p>The receiver validates its manifest and saved state before accepting it.</p><label class="sr-only" for="restore-file">Complete project ZIP</label><input type="file" name="restore_file" id="restore-file" accept=".zip" required></div><div id="restore-read-status" class="help" aria-live="polite"></div>'+formActions("Verify & receive project","Archive contents do not execute during receiving.")+'</form><div id="restore-result" class="stack"></div>')+'</div></div>',g);
 if(g!==state.generation)return;onForm("#restore-form",async()=>{
 const file=$("#restore-file").files[0];if(!file)throw new Error("Choose the complete original project ZIP.");$("#restore-read-status").textContent="Reading "+file.name+" ("+fmtBytes(file.size)+")…";
 const body=await fileBase64(file);$("#restore-read-status").textContent="Waiting for trusted receiving and state verification…";
 const result=await mutate("/restore",{filename:file.name,content_base64:body},{name:"Receive complete project "+file.name});$("#restore-read-status").textContent="Receiving completed.";
 $("#restore-result").innerHTML=notice("<strong>Project received.</strong> The complete receipt below identifies the separate verified workspace.")+
 dl([["Status",pill(result.status)],["Source SHA-256",'<span class="mono">'+h(result.source_sha256)+'</span>'],["Source bytes",h(amount(result.source_bytes))],["Receiving directory",'<span class="mono">'+h(result.directory)+'</span>'],["Received",h(date(result.received_at))]])+
 '<p class="small">Open this received state with the reviewed included server application, then sign in again with its retained account.</p>'+code('python3 server.py --state '+JSON.stringify(result.directory)+' --port 0')+
 button("save-receipt","Download receiving receipt","small")+ '<details><summary>Complete native receipt</summary>'+code(result)+'</details>';
 $("[data-action=save-receipt]").onclick=()=>downloadObject(result,"Supplier_Content_Receiving_Receipt.json");toast("Complete project received in a separate directory.");
 });
}
async function profileView(g){
 const session=await api("/session",{signal:state.abort.signal}),u=session.user;state.session=session;
 content(header("Your account","Your native role and supplier scope control access to this workspace.",button("logout",icon("logout")+"Sign out","quiet"))+
 '<div class="grid-2">'+card("Account identity",dl([["Name",h(u.name)],["Role",h(label(u.role))],["Supplier scope",h(u.supplier_id||"Workspace review")],["Authenticator",u.mfa_enabled?pill("Enabled","good"):pill("Not enrolled","warning")]]))+
 card("Authenticator enrollment",u.mfa_enabled?'<p class="small">Your account requires its configured authenticator code when you sign in. Enrollment remains in private complete-project backups.</p>':
 '<p class="small">Enroll a time-based authenticator for this local account, then confirm one generated code.</p><div class="actions">'+button("enroll-mfa","Begin authenticator enrollment","primary")+'</div>')+'</div>',g);
 if(g!==state.generation)return;$("[data-action=logout]").onclick=async()=>{try{await mutate("/logout",{}, {name:"Sign out"});state.pendingMemory.clear();state.session=await api("/session");render();}catch(e){toast(e.message,"danger");}};
 const enroll=$("[data-action=enroll-mfa]");if(enroll)enroll.onclick=async()=>{enroll.disabled=true;try{
 const result=await mutate("/mfa/enroll",{}, {name:"Begin authenticator enrollment",sensitive:true});
 const d=showDialog("Confirm your authenticator",'<form id="mfa-form">'+formError()+'<p class="small">Add the following enrollment secret to your authenticator. It is displayed only in this enrollment dialog.</p>'+field("secret","Enrollment secret",{readonly:true,value:result.secret,autocomplete:"off"})+
 '<details><summary>Authenticator setup URI</summary>'+code(result.otpauth_uri)+'</details>'+field("otp","Current authenticator code",{required:true,inputmode:"numeric",autocomplete:"one-time-code"})+formActions("Confirm enrollment")+'</form>');
 d.addEventListener("close",()=>d.replaceChildren(),{once:true});onForm("#mfa-form",async f=>{await mutate("/mfa/confirm",{otp:f.get("otp")},{name:"Confirm authenticator enrollment",sensitive:true});d.close();toast("Authenticator enrollment confirmed.");render();});
 }catch(e){toast(e.message,"danger");}finally{enroll.disabled=false;}};
}
function requestRoute(r,result){const id=result?.id||r.result?.id;if(r.path.startsWith("/submissions"))return id?"submissions/"+enc(id):"submissions";if(r.path.startsWith("/releases"))return id?"releases/"+enc(id):"releases";if(r.path==="/mappings")return id?"mappings/"+enc(id):"mappings";if(r.path.startsWith("/users"))return"users";if(r.path.startsWith("/suppliers"))return"suppliers";if(r.path==="/restore")return"handoff";return"dashboard";}
function inspectRequest(r){
 let body=r.bodyJSON?JSON.parse(r.bodyJSON):null;if(body?.content_base64)body={...body,content_base64:"[Retained original encoded bytes: "+body.content_base64.length+" characters]"};
 const d=showDialog("Saved original request",dl([["Request UUID",'<span class="mono">'+h(r.id)+'</span>'],["Operation",h(r.name)],["Native path",'<span class="mono">POST /api'+h(r.path)+'</span>'],[(r.sensitive?"Nonsecret request identity SHA-256":"Browser body SHA-256"),'<span class="mono">'+h(r.bodySHA256)+'</span>'],["State",pill(r.state)],["Created",h(date(r.createdAt))]])+
 (r.error?notice(h(r.error.message),"warning"):"")+
 (body?'<h3>Retained request values</h3>'+code(body):'<p class="muted small">'+(r.sensitive?"Passwords and authenticator values are not stored in browser request history.":"The accepted original is retained by the native workspace.")+'</p>')+
 (r.result?'<h3>Accepted identity</h3>'+code(r.result):""),button("close-request","Close","primary"));$("[data-action=close-request]",d).onclick=()=>d.close();
}
async function recoveryView(g){
 const records=await savedRequests(),pending=records.filter(r=>["unknown","pending","prepared"].includes(r.state)),rest=records.filter(r=>!["unknown","pending","prepared"].includes(r.state)).slice(0,60);
 const renderRecords=rows=>table(["Original operation","State","Created","Actions"],rows.map(r=>tr([
 '<strong>'+h(r.name)+'</strong><span class="table-sub mono">'+h(r.id)+'</span>',pill(r.state),h(date(r.createdAt)),
 button("inspect-request","Details","small",'data-request="'+h(r.id)+'"')+
 (["unknown","pending","prepared"].includes(r.state)?button("check-request","Check original outcome","small primary",'data-request="'+h(r.id)+'"'):"")+
 (r.state==="accepted"?link(requestRoute(r),"Open record","button small quiet"):"")
 ])));
 content(header("Request recovery","Check the saved original UUID after a lost response. Accepted native changes are recovered without creating another submission or decision.")+
 '<div class="stack">'+card("Unconfirmed original requests",pending.length?renderRecords(pending):empty("No unconfirmed requests","The browser has no pending operation for this signed-in native user.","","check"))+
 card("Recent completed or rejected requests",rest.length?renderRecords(rest):'<p class="muted small">This browser has not yet saved request history for this account.</p>')+'</div>',g);
 if(g!==state.generation)return;$$("[data-action=inspect-request]").forEach(b=>b.onclick=()=>inspectRequest(records.find(r=>r.id===b.dataset.request)));
 $$("[data-action=check-request]").forEach(b=>b.onclick=async()=>{
 const r=records.find(x=>x.id===b.dataset.request);b.disabled=true;try{
 const checked=await recoverRequest(r);if(checked.found){toast("Original accepted outcome recovered.");render();return;}
 const body=state.pendingMemory.get(r.id)||(r.bodyJSON?JSON.parse(r.bodyJSON):null);
 if(!body){showDialog("No committed response is recorded",'<p>The native service reports that this exact request has not committed. Sensitive credentials were not stored in this browser.</p><p class="muted small">Return to the original form and enter the same values to reuse its UUID. Keep the existing request record.</p>'+code({request_id:r.id,path:r.path}),link(requestRoute(r),"Return to the original area","button primary"));return;}
 const d=showDialog("Retry the original request?",'<p>The native service reports no committed response for this exact UUID. The original saved values are available.</p>'+dl([["Operation",h(r.name)],["UUID",'<span class="mono">'+h(r.id)+'</span>'],[(r.sensitive?"Nonsecret request identity SHA-256":"Body SHA-256"),'<span class="mono">'+h(r.bodySHA256)+'</span>']])+'<p class="muted small">This resends the same UUID and body. Existing revision guards still apply.</p>',button("retry-original","Retry original request","primary")+button("cancel-retry","Keep pending"));
 $("[data-action=cancel-retry]",d).onclick=()=>d.close();$("[data-action=retry-original]",d).onclick=async e=>{const btn=e.currentTarget;btn.disabled=true;try{await performRequest(r,body);d.close();toast("Original request resolved.");render();}catch(err){toast(err.message,"danger");btn.disabled=false;}};
 }catch(e){toast(e.message,"danger");}finally{b.disabled=false;}
 });
}
function guideView(g){
 content(header("Operating guide","A practical path from supplier source to review, mapped output and complete private receiving.")+
 '<div class="grid-aside"><div class="stack">'+card("1. Set up scoped access",'<div class="readable"><p>The first local administrator creates the workspace account once. Add supplier organizations with their original provider GLNs, then create supplier users or delegated supplier administrators. Reviewers can decide submissions and prepare releases; supplier users see their own organization’s content.</p><p>Use People & access to deactivate a user while retaining their authored history. Authenticator enrollment is available under Your account.</p></div>')+
 card("2. Preserve original supplier content",'<div class="readable"><p>New submission accepts an original CSV, XLSX, XML, ZIP or JSON file, or a manual entry. Give the source a clear description. Preserve leading zeros in GTINs and GLNs; for random-weight merchandise or other items without a fixed GTIN, select Supplier identifier and retain its original text identifier, namespace and source note.</p><p>The publisher documentation contains generated example items, qualified and repeated attributes. Their provenance remains visible. Open an item and search its original source attributes instead of replacing them with flattened guesses.</p><p>Source response messages with different document or item identities remain separate observations. A matching response must be tied explicitly to its intended source or output.</p></div>')+
 card("3. Review one exact revision",'<div class="readable"><p>Open the source download, item information and native findings. Errors prevent approval. Warnings require an explicit acknowledgment by the authorized reviewer.</p><p>Record a clear approval or rejection note. A rejected file remains immutable; Submit a correction creates a child submission with its own bytes and findings. Approved product editions retain the original submission and source hash.</p><p>If another action advances a record while you review it, the saved revision guard rejects the stale decision. Keep the draft note, reload the current source and review the new basis before submitting another decision.</p></div>')+
 card("4. Map and prepare a frozen output",'<div class="readable"><p>Create a versioned field map using normalized dot paths and the documented receiving field names. An attributes.&lt;original name&gt; selector is only valid when it identifies an unambiguous original value.</p><p>Select approved editions and preview the mapped rows. Required missing values prevent preparation. A release freezes its product editions, source hashes and mapping version, and provides the exact downloadable output.</p><p>When a receiving party supplies an acknowledgment, record its actual reference and response against the release SHA-256. The native history records the operator and time; file preparation does not create a network-delivery claim.</p></div>')+
 card("5. Recover an uncertain response",'<div class="readable"><p>Before a state-changing request is sent, the browser preserves its UUID and exact values for the signed-in native user. Request recovery checks the native committed response first.</p><p>If a response already exists, recover that accepted result. If the service confirms that the original UUID is not committed, you can explicitly resend the same request. Revision conflicts preserve the rejection and the original draft; review the current native record before creating a revised request.</p><p>Passwords and authenticator values are excluded from browser request storage. Their request metadata remains available, and the original values can be entered again when recovery requires them.</p></div>')+
 card("6. Receive the complete private project",'<div class="readable"><p>An administrator downloads the complete project ZIP from Complete project. The exported copy includes application source, original supplier files, the native SQLite history and account configuration; active sessions are removed. Keep the archive private because password hashes and authenticator enrollment are retained.</p><p>The ZIP includes the application under app/ and the original case under state/. For an archive created by your own trusted application, extract it and run:</p>'+code("python3 app/server.py --state state --port 0")+'<p>For incoming packages, use a separately trusted receiver first.</p><p>The trusted receive command validates the archive and creates a separate directory. It does not execute incoming archive code or overwrite the currently open case. The receipt identifies the original archive hash, source workspace and complete received state.</p>'+code("python3 server.py receive ORIGINAL.zip --directory /private/receiving --sha256 EXACT_SHA")+'<p>Use the reviewed included server application to open the receipt’s exact directory:</p>'+code("python3 server.py --state RECEIPT_DIRECTORY --port 0")+'<p>Sign in again with the retained account and authenticator. Reopen the supplier source, approval history, exact output and acknowledgment history from that received case.</p></div>')+
 '</div><aside class="stack">'+card("Operating scope",'<p class="small">This application provides supplier staging, validation, review and documented file exchange. Government-selected core product and asset systems retain their system-of-record authority.</p><div class="divider"></div><p class="small muted">The qualified platform operator supplies production interfaces, GDSN connectivity and required hosting/security controls. Imported publisher examples and local successful runs do not establish government acceptance.</p>')+
 card("Useful views",'<div class="item-list">'+[["submissions","Source and review queue"],["products","Approved editions"],["releases","Exact output and acknowledgments"],["recovery","Original request recovery"]].map(([path,title])=>'<div class="item-row">'+link(path,h(title))+'</div>').join("")+'</div>')+'</aside></div>',g);
}
async function render(){
 const g=++state.generation;state.abort?.abort();state.abort=new AbortController();$("#app-dialog")?.close();
 try{
 state.session=await api("/session",{signal:state.abort.signal});if(g!==state.generation)return;
 if(!state.session.authenticated){await authView();return;}
 shell();const {parts}=routeInfo(),[page,id]=parts;
 if(["suppliers","mappings","releases","audit"].includes(page)&&!canReview())throw new Error("This view is outside your assigned role. Your supplier records remain available under Submissions and Approved products.");
 if(page==="users"&&!canManageUsers())throw new Error("Your role cannot administer other people’s access.");
 if(page==="handoff"&&!isAdmin())throw new Error("Complete project backup and receiving require the workspace administrator.");
 if(page==="dashboard")await dashboardView(g);
 else if(page==="submissions"&&id==="new")await newSubmissionView(g);
 else if(page==="submissions"&&id)await submissionView(id,g);
 else if(page==="submissions")await submissionsView(g);
 else if(page==="products"&&id)await productView(id,g);
 else if(page==="products")await productsView(g);
 else if(page==="suppliers")await suppliersView(g);
 else if(page==="users")await usersView(g);
 else if(page==="mappings"&&id==="new")await mappingEditView(g);
 else if(page==="mappings"&&id)await mappingView(id,g);
 else if(page==="mappings")await mappingsView(g);
 else if(page==="releases"&&id==="new")await newReleaseView(g);
 else if(page==="releases"&&id)await releaseView(id,g);
 else if(page==="releases")await releasesView(g);
 else if(page==="notifications")await notificationsView(g);
 else if(page==="audit")await auditView(g);
 else if(page==="handoff")await handoffView(g);
 else if(page==="profile")await profileView(g);
 else if(page==="recovery")await recoveryView(g);
 else if(page==="guide")guideView(g);
 else content(header("View not found","Choose a workspace area from the navigation.")+link("dashboard","Open overview","button primary"),g);
 
 if(g===state.generation&&state.reviewDraft?.hash===location.hash){
 const draft=state.reviewDraft,form=document.getElementById(draft.formId);
 if(form){if(form.id==="manual-form"){const savedType=draft.values.find(v=>v.name==="identifier_type"),selector=form.elements.namedItem("identifier_type");if(savedType&&selector){selector.value=savedType.value;selector.dispatchEvent(new Event("change"));}}for(const v of draft.values){const el=form.elements.namedItem(v.name);if(el instanceof Element&&!el.disabled&&!el.readOnly){if(["checkbox","radio"].includes(v.type))el.checked=v.checked;else el.value=v.value;}}const info=document.createElement("div");info.className="notice info page-message";info.textContent="Your draft is restored against the current record. Review the current source and revision before submitting a new decision.";form.prepend(info);}
 state.reviewDraft=null;
 }
 }catch(e){
 if(g!==state.generation)return;
 if(e.status===401){state.session={authenticated:false,setup_required:false};await authView();return;}
 const target=$("#main-content");if(target){target.innerHTML=header("This view could not be opened","The original native workspace has been retained.")+notice(h(e.message),"danger")+'<div class="actions">'+button("retry-view",icon("refresh")+"Retry this view","primary")+link("recovery","Check request recovery","button")+'</div>';$("[data-action=retry-view]")?.addEventListener("click",render);}
 else $("#app").innerHTML='<main id="main-content" class="main-content">'+notice(h(e.message),"danger")+'</main>';
 }
}
window.addEventListener("hashchange",render);
window.addEventListener("unhandledrejection",event=>{if(event.reason?.name==="AbortError")return;console.error("Supplier workspace error",event.reason?.message||"Uncaught native UI error");});
await render();
