(() => {
"use strict";
const $ = id => document.getElementById(id);
const state = {token:"", session:0, view:"overview", status:null, loading:0, generation:0, cursors:{}, filters:{}, requests:new Set()};
const pages = {
  overview:["Overview","Configuration readiness and the retained delivery workload."],
  notifications:["Authenticated notifications","Original ingress receipts, repeated arrivals and canonical reconciliation."],
  events:["Canonical events","Provider row identities and original event envelopes retained independently of delivery."],
  catchups:["Catch-up ranges","Explicit ledger ranges, original provider cursors and resumable progress."],
  deliveries:["Customer delivery","Retained customer outcomes, attempts and explicit retry with the same event key."],
  tasks:["Worker tasks","Queued work, due times, interrupted operations and recoverable errors."],
  exports:["Export and recovery","Complete private records and commands for portable workspace recovery."]
};
const states = {
  notifications:["queued","reconciling","reconciled","failed"],
  catchups:["queued","running","completed","failed","cancelled"],
  deliveries:["queued","running","retry","delivered","failed","uncertain"],
  tasks:["queued","running","retry","succeeded","failed","uncertain","cancelled"]
};
function el(tag, attrs={}, children=[]) {
  const node=document.createElement(tag);
  for (const [key,value] of Object.entries(attrs)) {
    if (key==="class") node.className=value;
    else if (key==="text") node.textContent=value;
    else if (key==="checked" || key==="disabled" || key==="hidden") node[key]=Boolean(value);
    else node.setAttribute(key,String(value));
  }
  for (const child of (Array.isArray(children)?children:[children])) {
    if (child!==null && child!==undefined) node.append(child instanceof Node?child:document.createTextNode(String(child)));
  }
  return node;
}
function replace(node,...children){node.replaceChildren(...children);}
function button(text,action,attrs={}) {
  const node=el("button",{type:"button",...attrs},text);
  node.addEventListener("click",()=>act(node,action));
  return node;
}
function notice(message,error=false){$("notice").textContent=message;$("notice").dataset.error=String(error);$("notice").hidden=!message;}
async function act(node,action) {
  if(node.disabled)return;
  node.disabled=true;
  try { await action(); } catch(error) { if(error.name!=="AbortError")notice(error.message,true); }
  finally {node.disabled=false;}
}
function disconnect(message="") {
  state.token="";state.status=null;state.generation++;state.session++;
  for(const controller of state.requests)controller.abort();
  state.requests.clear();
  $("operator-token").value="";$("login").hidden=false;$("application").hidden=true;
  $("disconnect").hidden=true;$("connection-state").textContent="Operator access";
  if($("record-dialog").open)$("record-dialog").close();
  replace($("content"));replace($("record-content"));
  if(message)notice(message,true);
}
async function fetchAPI(path,{method="GET",body}={}) {
  const controller=new AbortController();state.requests.add(controller);
  try {
    const headers={"Authorization":"Bearer "+state.token};
    if(body!==undefined)headers["Content-Type"]="application/json";
    const response=await fetch(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),cache:"no-store",credentials:"omit",signal:controller.signal});
    if(!response.ok) {
      let result={};try{result=await response.json();}catch{}
      const message=result.error?.message||("Request failed with status "+response.status+".");
      if(response.status===401)disconnect("Operator access expired or the token changed. Connect again.");
      throw new Error(message);
    }
    return response;
  } finally {state.requests.delete(controller);}
}
async function api(path,options){return (await fetchAPI(path,options)).json();}
const fmtTime=value=>{
  if(value===null||value===undefined||value==="")return "—";
  const date=new Date(typeof value==="number"?value*1000:value);
  return Number.isNaN(date.valueOf())?String(value):date.toLocaleString();
};
const count=value=>Number(value||0).toLocaleString();
const sum=value=>Object.values(value||{}).reduce((total,item)=>total+Number(item||0),0);
const errText=value=>!value?"—":typeof value==="string"?value:(value.message||JSON.stringify(value));
function code(value,short=false) {
  const text=value===null||value===undefined?"—":String(value);
  return el("span",{class:"mono",title:text},short&&text.length>22?text.slice(0,18)+"…":text);
}
function badge(value) {
  const text=value||"unknown";
  const type=["failed","uncertain"].includes(text)?" attention":["queued","running","retry","reconciling"].includes(text)?" running":["delivered","completed","reconciled","succeeded"].includes(text)?" done":"";
  return el("span",{class:"state"+type},text.replaceAll("_"," "));
}
function facts(values){const list=el("dl",{class:"facts"});for(const [name,value] of values)list.append(el("dt",{},name),el("dd",{},value));return list;}
function panel(title,...children){return el("section",{class:"panel"},[el("h2",{},title),...children]);}
function table(headers,rows) {
  return el("div",{class:"table-scroller"},el("table",{},[
    el("thead",{},el("tr",{},headers.map(text=>el("th",{scope:"col"},text)))),
    el("tbody",{},rows.map(row=>el("tr",{},row.map(value=>el("td",{},value)))))
  ]));
}
function field(label,input,note="",full=false) {
  const id="field-"+crypto.randomUUID();input.id=id;
  return el("div",{class:"field"+(full?" full":"")},[el("label",{for:id},label),input,note?el("span",{class:"caption"},note):null]);
}
function integer(input,label) {
  const text=input.value.trim();
  if(!/^[0-9]+$/.test(text)||!Number.isSafeInteger(Number(text)))throw new Error(label+" must be a whole ledger number.");
  return Number(text);
}
function pageState(view){return state.cursors[view]||(state.cursors[view]=[null]);}
async function loadView({reset=false}={}) {
  if(!state.token)return;
  const view=state.view, generation=++state.generation;
  if(reset)state.cursors[view]=[null];
  state.loading++;$("content").setAttribute("aria-busy","true");
  $("page-title").textContent=pages[view][0];$("page-description").textContent=pages[view][1];
  for(const node of $("navigation").querySelectorAll("[data-view]"))node.setAttribute("aria-current",node.dataset.view===view?"page":"false");
  try {
    if(view==="overview"||view==="exports") {
      const status=await api("/api/status");if(generation!==state.generation)return;
      state.status=status;renderStatus(status,view);
    } else {
      const cursors=pageState(view),params=new URLSearchParams({limit:"50"});
      if(cursors.at(-1))params.set("after",cursors.at(-1));
      if(state.filters[view])params.set("state",state.filters[view]);
      const result=await api("/api/"+view+"?"+params);if(generation!==state.generation)return;
      renderList(view,result);
    }
    $("refreshed-at").textContent="Updated "+new Date().toLocaleTimeString();
    $("connection-state").textContent=(state.status?.configuration.network||"Connected")+" · operator";
  } catch(error) {if(generation===state.generation&&error.name!=="AbortError")notice(error.message,true);}
  finally {state.loading--;if(generation===state.generation)$("content").removeAttribute("aria-busy");}
}
function renderStatus(data,view) {
  const config=data.configuration||{},ops=data.operations||{},counts=ops.counts||{},worker=ops.worker||{};
  if(view==="exports") {
    replace($("content"),
      panel("Complete operations export",
        el("p",{}, "Download every retained notification, canonical event, catch-up job, worker task, customer delivery and attempt from the backend snapshot. Original event values and recovery state travel together in versioned NDJSON records."),
        el("div",{class:"actions"},[
          button("Download full operations",()=>download("/api/export","mercury-operations.ndjson"),{class:"primary"}),
          button("Canonical events only",()=>download("/api/export/events","mercury-events.ndjson")),
          button("Configuration and counts",()=>download("/api/export/status","mercury-operations-status.json"))
        ])),
      panel("Portable operational recovery",
        el("p",{},"The CLI creates a private ZIP archive containing the service configuration, retained operations and eligible customer SQLite database inside this workspace. Restore that archive into a new workspace, then supply the existing private credential environment when starting the recovered service."),
        el("pre",{},"python -m mercury_ops --config /private/workspace/config.json --env-file /private/workspace/secrets.env backup --out /private/backups/mercury-workspace.backup.zip\n\npython -m mercury_ops restore --from /private/backups/mercury-workspace.backup.zip --into /private/restored-workspace"),
        el("p",{class:"record-note"},"Use a new output or recovery destination. The recovered config.json points at the new workspace. Start it with --env-file pointing to the retained credential file.")),
      panel("Recover interrupted work",el("p",{},"Reconcile expired local work after an interrupted process. A currently running worker keeps ownership. Uncertain customer outcomes remain visible for an explicit retry decision."),
        button("Recover interrupted work",async()=>{const result=await api("/api/recover",{method:"POST",body:{}});notice("Recovery completed: "+JSON.stringify(result));await loadView();}))
    );return;
  }
  const delivery=counts.deliveries||{},attention=Number(delivery.failed||0)+Number(delivery.uncertain||0);
  const metrics=el("div",{class:"metrics"},[
    ["Canonical events",counts.events],["Delivered",delivery.delivered],["Pending delivery",Number(delivery.queued||0)+Number(delivery.retry||0)+Number(delivery.running||0)],["Delivery attention",attention]
  ].map(([label,value])=>el("div",{class:"metric"},[el("div",{class:"value"},count(value)),el("div",{class:"label"},label)])));
  const readiness=panel("Configuration readiness",facts([
    ["Provider",config.provider_ready?"Ready":"Set "+(config.credential_variables?.provider||"provider credential")+" and contract scope"],
    ["Webhook intake",config.webhook_ready?"Ready":"Set "+(config.credential_variables?.webhook||"webhook secret")+" and contract scope"],
    ["Operator access",config.operator_ready?"Configured":"Set operator environment variable"],
    ["Customer destination",config.destination?.kind||"Unconfigured"]
  ]),el("p",{class:"record-note"},"Edit the private configuration and environment files on the service host, then restart this process. Credential values stay on that host."));
  const details=panel("Source and destination",facts([
    ["Network",config.network||"—"],["Provider scope",config.provider_scope||"—"],["API base",code(config.api_base)],
    ["Contracts",config.contracts?.length?config.contracts.join("\n"):"Add the agreed customer contract addresses to config.json"],
    ["Event family",Object.keys(config.topic_filters||{}).length?Object.entries(config.topic_filters).map(([topic,value])=>topic+": "+value).join("\n"):"All topics within the configured contract scope"],
    ["Notification endpoint",code(location.origin+(data.operator?.webhook_path||"/webhooks/mercury"))],
    ["Destination",JSON.stringify(config.destination||{})]
  ]));
  const queue=panel("Retained work",facts([
    ["Notifications",count(sum(counts.notifications))],["Catch-up jobs",count(sum(counts.jobs))],
    ["Worker tasks",count(sum(counts.tasks))],["Worker ownership",worker.busy?"Processing retained work":"Available"],
    ["Running tasks",count(worker.running_tasks)],["Next due",fmtTime(worker.next_due_at)]
  ]),data.operator?.worker?.state==="failed"?el("p",{class:"record-note"},"This service's worker stopped: "+errText(data.operator.worker.error)+". Restart the operator process after addressing the retained error."):null);
  replace($("content"),metrics,el("div",{class:"grid"},[readiness,details]),el("div",{class:"section-gap"},queue));
}
function filterControl(view) {
  if(!states[view])return el("span",{class:"caption"},"Original provider identities");
  const select=el("select",{"aria-label":"State filter"},[el("option",{value:""},"All states"),...states[view].map(value=>el("option",{value},value))]);
  select.value=state.filters[view]||"";
  select.addEventListener("change",()=>{state.filters[view]=select.value;loadView({reset:true});});
  return el("div",{},[el("label",{},"State "),select]);
}
function renderList(view,result) {
  const items=result.items||[],cursors=pageState(view),headers=[],rows=[];
  const show=(kind,id)=>button("Details",()=>openRecord(kind,id));
  if(view==="notifications") {
    headers.push("Receipt","Transaction","Contract","State","Arrivals","Received","Details");
    for(const item of items)rows.push([code(item.notification_id,true),code(item.tx_hash,true),code(item.contract_id,true),badge(item.state),count(item.arrivals),fmtTime(item.last_received_at||item.received_at),show(view,item.notification_id)]);
  } else if(view==="events") {
    headers.push("Event key","Provider row","Contract","Transaction / index","Delivery","First retained","Details");
    for(const item of items)rows.push([code(item.event_id,true),code(item.provider_row_id),code(item.contract_id,true),el("div",{},[code(item.tx_hash,true),el("div",{class:"caption"},"Index: "+(item.event_index??"not supplied"))]),badge(item.delivery_state),fmtTime(item.first_seen_at),show(view,item.event_id)]);
  } else if(view==="catchups") {
    headers.push("Job","Ledger range","State","Pages / events","Retained cursor","Updated","Details");
    for(const item of items)rows.push([code(item.job_id),count(item.ledger_from)+" – "+count(item.ledger_to),badge(item.state),count(item.pages)+" / "+count(item.events_seen),code(item.cursor,true),fmtTime(item.updated_at),show(view,item.job_id)]);
  } else if(view==="deliveries") {
    headers.push("Original event key","State","Attempts","Updated","Last error","Details");
    for(const item of items)rows.push([code(item.event_id,true),badge(item.state),count(item.attempts),fmtTime(item.updated_at),errText(item.error),show(view,item.event_id)]);
  } else {
    headers.push("Task","Kind","State","Attempts","Due","Last error","Details");
    for(const item of items)rows.push([code(item.task_id,true),item.kind||"—",badge(item.state),count(item.attempts),fmtTime(item.due_at),errText(item.error),show(view,item.task_id)]);
  }
  const previous=button("Previous",async()=>{cursors.pop();await loadView();},{disabled:cursors.length===1});
  const next=button("Older records",async()=>{cursors.push(result.next_cursor);await loadView();},{disabled:!result.next_cursor});
  const toolbar=el("div",{class:"toolbar"},[filterControl(view),el("span",{class:"caption"},count(items.length)+" records on this page")]);
  const pager=el("div",{class:"pager"},[el("span",{},"Page "+cursors.length+" · newest retained records first"),el("div",{class:"actions"},[previous,next])]);
  const content=[];
  if(view==="catchups")content.push(catchupForm());
  if(view==="events")content.push(reconcileForm());
  content.push(toolbar,items.length?table(headers,rows):el("div",{class:"empty"},"No "+pages[view][0].toLowerCase()+" match this page and state."),pager);
  replace($("content"),...content);
}
function catchupForm() {
  const job=el("input",{value:"catchup-"+crypto.randomUUID(),required:true,maxlength:"100"});
  const first=el("input",{inputmode:"numeric",required:true,placeholder:"First ledger"});
  const last=el("input",{inputmode:"numeric",required:true,placeholder:"Last ledger"});
  const size=el("input",{inputmode:"numeric",value:String(state.status?.configuration.page_size||100),required:true});
  const contracts=el("textarea",{placeholder:"One configured contract address per line"});contracts.value=(state.status?.configuration.contracts||[]).join("\n");
  const submit=el("button",{type:"submit",class:"primary"},"Create retained catch-up");
  const form=el("form",{},[
    el("div",{class:"form-grid"},[field("Stable job ID",job,"Retry the same request with the same ID.",true),field("First ledger (inclusive)",first),field("Last ledger (inclusive)",last),field("Provider page size",size,"1–1000 canonical rows per provider page."),field("Contracts",contracts,"Leave empty to use the configured contract scope.",true)]),
    el("div",{class:"actions"},submit)
  ]);
  form.addEventListener("submit",event=>{event.preventDefault();act(submit,async()=>{
    const body={job_id:job.value.trim(),ledger_from:integer(first,"First ledger"),ledger_to:integer(last,"Last ledger"),page_size:integer(size,"Page size")};
    if(body.ledger_to<body.ledger_from)throw new Error("The last ledger must be at or after the first ledger.");
    if(body.page_size<1||body.page_size>1000)throw new Error("Page size must be from 1 to 1000.");
    const selected=contracts.value.split(/[\s,]+/).map(value=>value.trim()).filter(Boolean);
    if(new Set(selected).size!==selected.length)throw new Error("Use each contract address once.");
    if(selected.length)body.contracts=selected;
    const result=await api("/api/catchups",{method:"POST",body});notice("Catch-up retained: "+result.job_id);await loadView({reset:true});await openRecord("catchups",result.job_id);
  });});
  return el("details",{class:"disclosure"},[el("summary",{},"Create a ledger-range catch-up"),el("p",{class:"caption"},"Each page advances the original provider cursor only after the canonical rows and delivery work are retained. The job freezes the configured event-family topic filters when first created; its details retain those exact predicates. Later configuration changes apply to new job IDs."),form]);
}
function reconcileForm() {
  const tx=el("input",{required:true,placeholder:"Original transaction hash",spellcheck:"false"});
  const submit=el("button",{type:"submit"},"Reconcile transaction");
  const operationId="operator-"+crypto.randomUUID();
  const form=el("form",{},[field("Transaction hash",tx,"The canonical query retains distinct provider rows from the same transaction."),el("div",{class:"actions"},submit)]);
  form.addEventListener("submit",event=>{event.preventDefault();act(submit,async()=>{
    const result=await api("/api/reconcile",{method:"POST",body:{tx_hash:tx.value.trim(),operation_id:operationId}});
    notice("Reconciliation retained: "+result.task_id);await loadView();await openRecord("tasks",result.task_id);
  });});
  return el("details",{class:"disclosure"},[el("summary",{},"Reconcile an original transaction"),form]);
}
function saveBlob(blob,filename) {
  const url=URL.createObjectURL(blob),anchor=el("a",{href:url,download:filename});
  document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function download(path,filename) {
  let handle=null;
  if(window.showSaveFilePicker) {
    try {handle=await window.showSaveFilePicker({suggestedName:filename});}
    catch(error){if(error.name==="AbortError")return;throw error;}
  }
  const response=await fetchAPI(path);
  if(handle&&response.body)await response.body.pipeTo(await handle.createWritable());
  else saveBlob(await response.blob(),filename);
  notice("Export prepared: "+count(response.headers.get("Content-Length"))+" bytes"+(response.headers.get("X-Content-SHA256")?" · SHA-256 "+response.headers.get("X-Content-SHA256"):""));
}
function formatExactJSON(raw) {
  // Format original JSON tokens without converting provider numbers through JavaScript.
  const tokens=raw.match(/"(?:\\.|[^"\\])*"|[{}\[\],:]|[^\s{}\[\],:]+/g)||[];
  let depth=0,text="";
  const line=()=>"\n"+"  ".repeat(depth);
  for(let i=0;i<tokens.length;i++) {
    const token=tokens[i];
    if(token==="{"||token==="[") {
      text+=token;depth++;
      if(tokens[i+1]!=="}"&&tokens[i+1]!=="]")text+=line();
    } else if(token==="}"||token==="]") {
      depth--;
      if(tokens[i-1]!=="{"&&tokens[i-1]!=="[")text+=line();
      text+=token;
    } else if(token===",")text+=","+line();
    else if(token===":")text+=": ";
    else text+=token;
  }
  return text;
}
async function openRecord(kind,identity) {
  const session=state.session;
  const response=await fetchAPI("/api/"+kind+"/"+encodeURIComponent(identity));
  const raw=await response.text(),data=JSON.parse(raw);
  if(session!==state.session||!state.token)return;
  $("record-kind").textContent=pages[kind][0];$("record-title").textContent=String(identity);
  const controls=el("div",{class:"actions"});
  const safeName=String(identity).replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,100);
  controls.append(button("Download record JSON",()=>saveBlob(new Blob([raw],{type:"application/json"}),"mercury-"+kind+"-"+safeName+".json")));
  async function mutate(action,caption) {
    const result=await api("/api/"+kind+"/"+encodeURIComponent(identity)+"/"+action,{method:"POST",body:{}});
    notice(caption+": "+(result.state||JSON.stringify(result)));
    await loadView();await openRecord(kind,identity);
  }
  const notes=[];
  if(kind==="deliveries") {
    notes.push(el("p",{class:"record-note"},"Delivery retries reuse this exact event key. A previous uncertain attempt may already have reached the customer endpoint; the destination must deduplicate that key."));
    if(["failed","uncertain","retry"].includes(data.state))controls.append(button("Retry with same event key",async()=>{
      if(data.state==="uncertain"&&!window.confirm("Retry this original event key? The previous request may already have committed at the customer destination. Confirm that the destination deduplicates this key or that the earlier outcome has been checked."))return;
      await mutate("retry","Delivery retry retained");
    },{class:"primary"}));
  }
  if(kind==="tasks"&&["failed","uncertain"].includes(data.state))controls.append(button("Retry retained task",async()=>{
    if(data.state==="uncertain"&&!window.confirm("Retry this retained operation? An uncertain customer delivery may already have committed. Check the destination's original event key before repeating it."))return;
    await mutate("retry","Task retry retained");
  }));
  if(kind==="catchups") {
    if(data.state==="failed")controls.append(button("Resume saved catch-up",()=>mutate("retry","Catch-up resumed"),{class:"primary"}));
    if(["queued","running","failed"].includes(data.state))controls.append(button("Cancel catch-up",()=>mutate("cancel","Catch-up cancelled")));
    notes.push(el("p",{class:"record-note"},"The saved range, original provider cursor and retained events remain visible after cancellation or recovery."));
    if(data.state==="cancelled")notes.push(el("p",{class:"record-note"},"Create a new stable job ID to query this range again. This cancelled job and its completed pages remain retained."));
  }
  if(kind==="notifications"&&data.task_id)controls.append(button("Open reconciliation task",()=>openRecord("tasks",data.task_id)));
  if(kind==="events")controls.append(button("Open customer delivery",()=>openRecord("deliveries",identity)));
  if(kind==="notifications"&&data.raw_body_base64)controls.append(button("Download original authenticated body",()=>{
    const bytes=Uint8Array.from(atob(data.raw_body_base64),char=>char.charCodeAt(0));
    saveBlob(new Blob([bytes],{type:"application/json"}),"mercury-notification-"+safeName+"-original.json");
  }));
  replace($("record-content"),controls,...notes,el("pre",{},formatExactJSON(raw)));
  if(!$("record-dialog").open)$("record-dialog").showModal();
}
$("connect-form").addEventListener("submit",event=>{
  event.preventDefault();
  const submit=event.currentTarget.querySelector("button");
  act(submit,async()=>{
    state.session++;state.token=$("operator-token").value.trim();$("operator-token").value="";
    try {
      state.status=await api("/api/status");$("login").hidden=true;$("application").hidden=false;$("disconnect").hidden=false;
      notice("");await loadView();
    } catch(error) {state.token="";throw error;}
  });
});
$("disconnect").addEventListener("click",()=>{disconnect();notice("");});
$("close-record").addEventListener("click",()=>$("record-dialog").close());
$("refresh").addEventListener("click",()=>loadView());
$("navigation").addEventListener("click",event=>{
  const node=event.target.closest("[data-view]");if(!node)return;
  state.view=node.dataset.view;loadView();
});
setInterval(()=>{
  if(state.token&&$("auto-refresh").checked&&!state.loading&&!$("record-dialog").open&&document.visibilityState==="visible") {
    if($("content").querySelector("details[open]"))return;
    loadView();
  }
},5000);
window.addEventListener("pagehide",()=>disconnect());
})();
