const content = document.querySelector("#content");
const noticeBox = document.querySelector("#notice");
const dirty = new Set();
let serial = 0;
const view = {tab:"expenses", nodeImport:false, item:null, credit:null, refundPacket:null, creditOffset:0, refundOffset:0, source:null, capture:null, period:null, review:null, close:null, issue:null,
              periodEdit:false, setting:"centers", center:null, expensesOffset:0, captureOffset:0, sourceOffset:0,
              historyOffset:0, bookkeepingOffset:0, bookkeeping:null, activityOffset:0, query:"", filterSource:"", filterStatus:""};
let state = null;
let token = location.hash.slice(1) || sessionStorage.getItem("sf36-expense-capability") || "";
if (location.hash) { sessionStorage.setItem("sf36-expense-capability", token); history.replaceState(null, "", location.pathname); }

function el(tag, attrs={}, ...children) {
  const node = document.createElement(tag);
  for (const [name,value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (name === "class") node.className = value;
    else if (name === "text") node.textContent = value;
    else if (name === "checked" || name === "disabled") node[name] = Boolean(value);
    else node.setAttribute(name, String(value));
  }
  for (const child of children.flat(Infinity)) if (child !== undefined && child !== null) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
function button(label, action, cls="", disabled=false) {
  const b = el("button", {type:"button", class:cls, disabled}, label);
  b.addEventListener("click", async () => { b.disabled=true; try { await action(); } catch(e) { notify(e.message,true); } finally { if(b.isConnected)b.disabled=disabled; } });
  return b;
}
function notify(message, error=false) { noticeBox.className=message ? "notice"+(error?" error":"") : ""; noticeBox.textContent=message||""; }
function mark(form) {
  form.dataset.revision=String(state.revision);
  form.addEventListener("input",()=>dirty.add(form));
  form.addEventListener("change",()=>dirty.add(form));
}
function discard() {
  if(dirty.size && !window.confirm("Discard the unsaved form changes before leaving this view?")) return false;
  dirty.clear(); return true;
}
async function navigate(action) { if(discard()) { await action(); await render(); } }
window.addEventListener("beforeunload",e=>{if(dirty.size){e.preventDefault();e.returnValue="";}});
async function api(path, body) {
  const headers={Authorization:"Bearer "+token};
  if(body!==undefined)headers["Content-Type"]="application/json";
  const response=await fetch(path,{method:body===undefined?"GET":"POST",headers,body:body===undefined?undefined:JSON.stringify(body),cache:"no-store"});
  const data=await response.json();
  if(!response.ok){const e=new Error(data.error?.message||"The workspace request failed");e.code=data.error?.code;e.status=response.status;throw e;}
  return data;
}
async function refreshState() {
  state=await api("/api/state");
  document.querySelector("#revision").textContent="Revision "+state.revision+(state.data_context==="development"?" · Development operation":"");
  document.body.dataset.revision=String(state.revision);
}
async function save(form,path,payload) {
  const result=await api(path,{expected_revision:Number(form.dataset.revision),payload});
  dirty.delete(form); await refreshState(); form.dataset.revision=String(state.revision);
  return result.result;
}
async function redrawAfter(message) {
  notify(message);
  if(dirty.size) { notify(message+" Your other unsaved form is preserved."); return; }
  await render();
}
async function mutate(path,payload={}) {
  const result=await api(path,{expected_revision:state.revision,payload});
  await refreshState(); return result.result;
}
function field(def) {
  const id="field-"+(++serial);
  const wrap=el("label",{class:"field"+(def.wide?" wide":""),for:id});
  wrap.append(el("span",{id:id+"-label"},def.label));
  let input;
  if(def.choices) {
    input=el("select",{id,name:def.name});
    for(const choice of def.choices)input.append(el("option",{value:choice.value},choice.label));
    input.value=def.value??"";
  } else if(def.multiline) input=el("textarea",{id,name:def.name,rows:def.rows||3});
  else input=el("input",{id,name:def.name,type:def.type||"text",inputmode:def.inputmode,autocomplete:"off"});
  if(!def.choices) {
    if(def.type==="checkbox"){input.checked=Boolean(def.value);wrap.classList.add("checkbox");}
    else input.value=def.value??"";
  }
  if(def.required)input.required=true;
  if(def.maxlength)input.maxLength=def.maxlength;
  if(def.readonly)input.readOnly=true;
  input.setAttribute("aria-labelledby",id+"-label");
  wrap.append(input);
  if(def.help){input.setAttribute("aria-describedby",id+"-help");wrap.append(el("small",{id:id+"-help"},def.help));}
  return {wrap,input};
}
function formCard(title, defs, submitLabel, action, options={}) {
  const card=el("section",{class:"card"},el("h2",{},title));
  if(options.intro)card.append(el("p",{class:"quiet"},options.intro));
  const form=el("form",{"aria-label":title});
  const grid=el("div",{class:"form-grid"});
  const fields={};
  for(const def of defs){const f=field(def);fields[def.name]=f.input;grid.append(f.wrap);}
  form.append(grid);
  const submit=el("button",{type:"submit",class:"primary"},submitLabel);
  const actions=el("div",{class:"actions"},submit);
  if(options.cancel)actions.append(button("Cancel",options.cancel));
  const message=el("div",{class:"form-message",role:"status"});
  form.append(actions,message);card.append(form);mark(form);
  form.addEventListener("submit",async e=>{
    e.preventDefault();submit.disabled=true;message.replaceChildren();
    try {
      const values=Object.fromEntries(Object.entries(fields).map(([name,input])=>[name,input.type==="checkbox"?input.checked:input.value]));
      await action(values,form);
    } catch(e) {
      message.append(el("p",{class:"error"},e.message));
      if(e.code==="WORKSPACE_CHANGED"){
        await refreshState().catch(()=>{});
        message.append(button("I reviewed the changes; use current revision",()=>{form.dataset.revision=String(state.revision);message.replaceChildren(el("p",{},"Your form is preserved. Save when the displayed values are ready."));}));
      }
    } finally {if(submit.isConnected)submit.disabled=false;}
  });
  return {card,form,fields,message,actions};
}
function heading(title,intro) { content.append(el("h1",{},title),el("p",{class:"intro"},intro)); }
function badge(value,dark=false){return el("span",{class:"badge"+(dark?" dark":"")},value);}
function facts(values) {
  const node=el("dl",{class:"facts"});
  for(const [label,value] of values)node.append(el("dt",{},label),el("dd",{class:label.includes("digest")||label.includes("Receipt")?"code":""},value??"—"));
  return node;
}
function table(headers,rows) {
  if(!rows.length)return el("div",{class:"empty"},"No retained records match this view.");
  const head=el("tr");for(const h of headers)head.append(el("th",{scope:"col"},h));
  const body=el("tbody");for(const row of rows){const tr=el("tr");for(const cell of row)tr.append(el("td",{},cell));body.append(tr);}
  return el("div",{class:"table-wrap"},el("table",{},el("thead",{},head),body));
}
function pager(data,go,size=50) {
  return el("div",{class:"pager"},el("span",{},data.total?String(data.offset+1)+"–"+Math.min(data.offset+data.items.length,data.total)+" of "+data.total:"0 records"),
    button("Previous",()=>go(Math.max(0,data.offset-size)),"small",data.offset===0),
    button("Next",()=>go(data.next),"small",data.next===null));
}
function localTable(headers,rows,size=50) {
  const host=el("div");let offset=0;
  function draw(){const data={items:rows.slice(offset,offset+size),offset,total:rows.length,next:offset+size<rows.length?offset+size:null};
    host.replaceChildren(table(headers,data.items),pager(data,x=>{offset=x;draw();},size));}
  draw();return host;
}
function unit(value,row,labels=state.labels) {
  if(value===null||value===undefined)return "Not established";
  const raw=String(value);const label=labels.find(l=>l.network===row.network&&l.asset===row.asset);
  if(!label)return raw+" base units";
  const sign=raw.startsWith("-")?"-":"";const n=raw.replace(/^-/,"").padStart(label.decimals+1,"0");
  const shown=sign+(label.decimals?n.slice(0,-label.decimals)+"."+n.slice(-label.decimals):n);
  return raw+" base units · "+shown+" "+label.symbol;
}
function totalCards(report) {
  const host=el("div",{class:"cards"});
  for(const [title,rows] of [["Allocated settled actual",report.totals],...(report.credit_totals?.length?[["Allocated native returns",report.credit_totals],["Net native expense",report.net_totals]]:[]),["Outstanding reserved maximum",report.outstanding_totals]]){
    const c=el("section",{class:"card muted"},el("h3",{},title));
    if(!rows.length)c.append(el("p",{},"0 base units"));
    for(const row of rows)c.append(el("p",{class:"code"},row.network+" / "+row.asset),el("p",{class:"allocation-total"},unit(row.amount,row,report.labels||state.labels)));
    host.append(c);
  }return host;
}
async function download(path,filename) {
  const response=await fetch(path,{headers:{Authorization:"Bearer "+token},cache:"no-store"});
  if(!response.ok){const e=await response.json();throw new Error(e.error?.message||"Download failed");}
  const blob=await response.blob();const url=URL.createObjectURL(blob);
  const link=el("a",{href:url,download:filename});document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function viewReport(id) {
  if(!discard())return;
  const target=window.open("about:blank","_blank");
  if(!target)throw new Error("Allow this workspace to open the issued report, or download its accountant packet.");
  target.opener=null;
  try {
    const response=await fetch("/api/closes/"+id+"/html",{headers:{Authorization:"Bearer "+token}});
    if(!response.ok){const e=await response.json();throw new Error(e.error?.message||"Report could not open");}
    const url=URL.createObjectURL(await response.blob());target.location.replace(url);
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  } catch(e) {target.close();throw e;}
}
function selectedSource(){return state.sources.find(s=>s.id===view.source);}
function selectedPeriod(){return state.periods.find(p=>p.id===view.period);}
async function render(){
  content.replaceChildren();dirty.clear();
  document.querySelectorAll("nav button").forEach(b=>b.setAttribute("aria-current",b.dataset.tab===view.tab?"page":"false"));
  document.body.dataset.tab=view.tab;
  if(view.tab==="expenses")await renderExpenses();
  if(view.tab==="sources")await renderSources();
  if(view.tab==="credits")await renderCredits();
  if(view.tab==="periods")await renderPeriods();
  if(view.tab==="settings")await renderSettings();
  if(view.tab==="activity")await renderActivity();
}
async function renderExpenses() {
  if(view.item)return renderExpense();
  heading("Buyer expenses","Review accepted native statement rows, assign recognition dates and allocate settled actual to cost centers and projects. Each network and asset keeps its original units.");
  const bar=el("div",{class:"toolbar"});
  const search=field({name:"search",label:"Search request, service, receipt or memo",value:view.query});search.wrap.classList.add("search");
  const source=field({name:"source",label:"Source",value:view.filterSource,choices:[{value:"",label:"All sources"},...state.sources.map(s=>({value:s.id,label:s.name}))]});
  const status=field({name:"status",label:"Coding status",value:view.filterStatus,choices:["","UNCODED","CODED","STALE","RESERVED","PAYMENT_UNRESOLVED","FAILED_TRANSACTION","NO_SIGNED_DISPATCH","OBSERVATION_REVIEW","SPENDING_SOURCE_REVIEW","NO_PAYMENT_REQUIRED","ACCOUNTING_UNRESOLVED","ABSENT"].map(x=>({value:x,label:x||"All states"}))});
  const apply=()=>navigate(()=>{view.query=search.input.value;view.filterSource=source.input.value;view.filterStatus=status.input.value;view.expensesOffset=0;});
  bar.append(search.wrap,source.wrap,status.wrap,button("Apply filters",apply));
  search.input.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();apply().catch(e=>notify(e.message,true));}});
  content.append(bar);
  const data=await api("/api/expenses?"+new URLSearchParams({q:view.query,source:view.filterSource,status:view.filterStatus,offset:view.expensesOffset,limit:50}));
  content.append(table(["Original request / source","Service / native day","Network / asset","Settled actual","Reserved maximum","Coding",""],data.items.map(item=>{
    const r=item.row;return [el("div",{class:"long"},el("div",{class:"code"},r.request_id),el("div",{class:"quiet"},item.source_name)),
      el("div",{},r.service,el("div",{class:"quiet"},r.day)),el("div",{class:"code"},r.network,el("br"),r.asset),
      el("span",{class:"code"},r.state==="unpaid"?"No payment required":r.settled_base_units??"Not established"),el("span",{class:"code"},reservationDisplay(r)),badge(item.status),
      button("Open expense",()=>navigate(()=>{view.item=item.id;}),"small")];
  })),pager(data,x=>navigate(()=>{view.expensesOffset=x;})));
  if(!state.sources.length)content.append(el("div",{class:"card"},el("p",{},"Start by registering the original buyer ledger and reviewing its first capture."),button("Register source",()=>navigate(()=>{view.tab="sources";view.source=null;}),"primary")));
}
async function renderExpense(){
  const item=await api("/api/items/"+view.item), r=item.row;
  content.append(button("← Expense list",()=>navigate(()=>{view.item=null;}),"small"));
  heading("Expense allocation",item.source_name+" · "+r.request_id);
  const native=el("section",{class:"card"},el("div",{class:"card-header"},el("h2",{},"Original native row"),badge(item.status)),
    facts([["Service",r.service],["Network / asset",r.network?r.network+" / "+r.asset:"No payment asset"],[r.native_date_basis||(r.source_kind==="mcp_quote"?"MCP quote creation day":"Native reservation day"),r.day],["Settled actual",unit(r.settled_base_units,r)],
           ["Outstanding reservation",reservationDisplay(r)],[["woo_refund","merchant_adjustments"].includes(r.source_kind)?"Original bound purchase":r.source_kind==="mcp_quote"?"Original quoted amount":"Original authorized maximum",r.amount||"Not established"],["Receipt reference",r.receipt_ref||"No receipt reference"],
           ["Request digest",r.request_digest],["Proof digest",r.proof_sha256||"—"],["Accepted source capture",item.capture_id]]));
  content.append(native);
  if(r.native_detail&&["mcp_quote","governed_mcp"].includes(r.source_kind)){
    const n=r.native_detail,file=n.result_file;
    content.append(el("section",{class:"card"},el("h2",{},"Original MCP purchase"),
      facts([["Buyer state",n.native_status],["Payment observation",n.classification],["Original signed dispatch",n.signed_request_dispatched?"Recorded":"None recorded"],
        ["Payer",n.payer||"Not recorded"],["Merchant recipient",n.recipient||"Not recorded"],["Tool / method",n.tool_name||n.method],
        ["Original endpoint",n.url],["Arguments digest",n.arguments_sha256||"—"],["Observation digest",n.observation_sha256||"None retained"],
        ["Original quote digest",n.quote_sha256]]),
      n.problems?.length?el("p",{class:"notice"},n.problems.join(" · ")):null,
      el("h3",{},"Recorded result"),
      facts([["File state",file?.status||"No complete-file record"],["Recorded bytes",file?.bytes??n.result_preview?.bodyBytes??"Unknown"],
        ["Recorded digest",file?.sha256||n.result_preview?.bodySha256||"Unknown"]]),
      el("p",{class:"quiet"},"The source capture retains the original quote, receipt, observation and recorded result metadata. Purchased bytes remain in the native buyer's result inbox."),
      el("details",{},el("summary",{},"Inspect retained payment and result fields"),el("pre",{class:"pre"},JSON.stringify(n,null,2)))));
  }
  if(r.source_kind==="governed_mcp"){
    const n=r.native_detail,owner=n.spending_owner||{};
    content.append(el("section",{class:"card"},el("h2",{},"Original governed spending"),
      facts([["Native owner",owner.actor+" / "+owner.service],["Payer",owner.payer],["Quote / spending join",n.spending_link],
        ["Original ledger state",n.spending_state||"No original reservation"],["Reservation day",n.spending_reservation_day||"—"],
        ["Original maximum",n.spending_maximum??"Not reserved"],["Outstanding native units",n.spending_reserved_base_units],
        ["Original settled units",n.spending_actual??"Not settled"],["Quote-observed matched units",n.observed_settled_actual??"Not established"],
        ["Native request digest",n.spending_request_sha256||"No native binding"],["Retained binding digest",n.spending_binding_sha256||"No retained binding"],
        ["Native finality record",n.finality_record_sha256||"No retained native finality"],["Original ledger proof",n.spending_proof_sha256||"—"]]),
      n.unverified_spending_exposure?el("div",{class:"notice"},"Original ledger capacity awaiting source attribution: "+n.unverified_spending_exposure.amount+" native units",
        el("details",{},el("summary",{},"Inspect the exact original ledger exposure"),el("pre",{class:"pre"},JSON.stringify(n.unverified_spending_exposure,null,2)))):null,
      n.spending_problems?.length?el("p",{class:"notice"},n.spending_problems.join(" · ")):null,
      n.spending_notes?.length?el("p",{class:"quiet"},n.spending_notes.join(" · ")):null,
      el("p",{class:"quiet"},"The original SF36 row supplies the reserved and settled units. If the quote already has a matched transfer while the ledger remains reserved, reconcile it in the original buyer, then capture and review this source again."),
      button("Open governed source",()=>navigate(()=>{view.tab="sources";view.source=item.source_id;view.item=null;}),"small")));
  }
  if(r.source_kind==="woo_refund"){
    const n=r.native_detail;
    content.append(el("section",{class:"card"},el("h2",{},"Original merchant purchase"),
      facts([["Operation context",n.data_context],["Store / order",n.site_url+" / "+n.order_reference],
        ["Original store amount",n.store_amount+" "+n.store_currency],["Buyer payer",n.payer],["Merchant recipient",n.recipient]]),
      el("p",{class:"quiet"},"The original native purchase and store currency mapping are retained separately. Return allocations use the exact native units."),
      button("Open credits and returns",()=>navigate(()=>{view.tab="credits";}),"small")));
  }
  if(r.source_kind==="merchant_adjustments"){
    const n=r.native_detail;
    content.append(el("section",{class:"card"},el("h2",{},"Original merchant payment and source decisions"),
      facts([["Operation context",n.data_context],["Original reference",n.source_reference],["Buyer payer",n.payer],
        ["Merchant recipient",n.recipient],["Original payment proof",n.observation_sha256]]),
      el("details",{},el("summary",{},"Original source and job binding"),el("pre",{class:"pre"},JSON.stringify({event:n.original_event,job:n.declared_job},null,2))),
      button("Open credits and source decisions",()=>navigate(()=>{view.tab="credits";}),"small")));
  }
  if(r.source_kind==="node_operation"){
    const n=r.native_detail;
    content.append(el("section",{class:"card"},el("h2",{},"Original Node accounting operation"),
      facts([["Original intent",n.node_intent_id],["Original accounting command",n.node_command_id],
        ["Native accounting outcome",n.native_status],["Original authority",n.record_authority],
        ["Original source SHA256",n.node_source_sha256],["Original export bytes",n.node_source_bytes],
        ["Producing attempt",n.attempt_created_at],["Observed response",n.source_observed_at],
        ["Accounting completion",n.accounting_completed_at],["Original HTTP status",n.http_status??"Not recorded"],
        ["Operation context",n.data_context],["Original ledger provenance",n.original_operator_ledger||"No ledger used"]]),
      el("p",{class:"quiet"},r.state==="unpaid"?"The original response required no payment. This retained source creates no expense, payment asset or reservation.":
        "The original accounting result and source remain retained. Ledger capacity stays in its original source; the imported export makes no reservation or payment."),
      button("Download exact original export",()=>download("/api/captures/"+item.capture_id+"/node-original","original-node-accounting-export.json")),
      el("details",{},el("summary",{},"Retained original source and finality fields"),el("pre",{class:"pre"},JSON.stringify(n,null,2)))));
  }
  if(item.missing||r.state!=="settled"){
    content.append(el("section",{class:"card"},el("h2",{},"Review this row in its period"),el("p",{},"This original row is not available for expense allocation. Its period retains the native payment or reservation state and any required carry-forward or exclusion decision."),
      button("Open period review",()=>navigate(()=>{view.tab="periods";}),"primary")));return;
  }
  const centers=state.centers.filter(c=>c.active);
  if(!centers.length){content.append(el("section",{class:"card"},el("p",{},"Create an active cost center before coding this expense."),button("Create cost center",()=>navigate(()=>{view.tab="settings";view.setting="centers";}),"primary")));return;}
  const previous=item.coding;
  const f=formCard("Allocate settled actual",[
    {name:"recognition_date",label:"Recognition date",type:"date",value:previous?.recognition_date||"",required:true,help:"Chosen by the operator; the original reservation or quote-creation day keeps its own source meaning."},
    {name:"operator",label:"Coding owner",value:previous?.operator||"",required:true},
    {name:"memo",label:"Expense memo",value:previous?.memo||"",multiline:true,wide:true}
  ],"Save allocation edition",async(values,form)=>{
    const allocations=[...rows.children].map(tr=>Object.fromEntries([...tr.querySelectorAll("[data-key]")].map(input=>[input.dataset.key,input.value])));
    await save(form,"/api/items/"+item.id+"/coding",{...values,basis:item.basis,allocations});
    await redrawAfter("Allocation edition retained.");
  });
  const rows=el("tbody");const headings=el("tr");
  for(const h of ["Cost center","Base units","Project","Account code","Line memo",""])headings.append(el("th",{},h));
  const total=el("p",{class:"allocation-total","aria-live":"polite"});
  const recompute=()=>{let sum=0n,ok=true;for(const input of rows.querySelectorAll('[data-key="amount"]')){if(!/^(0|[1-9][0-9]*)$/.test(input.value)){ok=false;break;}sum+=BigInt(input.value);}
    total.textContent=(ok?sum.toString():"Invalid amount")+" / "+r.settled_base_units+" native settled base units";};
  function addLine(line={}){
    const tr=el("tr"), ordinal=++serial;
    for(const def of [
      {key:"center_id",label:"Cost center line "+ordinal,choices:[{value:"",label:"Select cost center"},...centers.map(c=>({value:c.id,label:c.code+" · "+c.name}))],value:line.center_id||centers[0].id},
      {key:"amount",label:"Base units line "+ordinal,value:line.amount??"0",inputmode:"numeric"},
      {key:"project",label:"Project line "+ordinal,value:line.project||""},
      {key:"account_code",label:"Account code line "+ordinal,value:line.account_code||""},
      {key:"memo",label:"Memo line "+ordinal,value:line.memo||""}]){
      const part=field({...def,name:def.key});part.input.dataset.key=def.key;tr.append(el("td",{},part.wrap));}
    tr.append(el("td",{},button("Remove",()=>{rows.removeChild(tr);dirty.add(f.form);recompute();},"small")));
    rows.append(tr);tr.addEventListener("input",recompute);recompute();
  }
  for(const line of previous?.allocations||[{amount:r.settled_base_units}])addLine(line);
  const grid=el("div",{class:"table-wrap allocation-table"},el("table",{},el("thead",{},headings),rows));
  f.form.insertBefore(el("div",{class:"detail"},el("h3",{},"Allocation lines"),grid,el("div",{class:"actions"},button("Add allocation line",()=>{addLine();dirty.add(f.form);},"small")),total),f.actions);
  content.append(f.card);
  if(item.coding_history.length)content.append(el("section",{class:"card"},el("h2",{},"Retained allocation editions"),
    localTable(["Saved","Recognition date","Owner","Edition / memo"],item.coding_history.map(c=>[c.created_at,c.recognition_date,c.operator,
      el("details",{},el("summary",{},c.id),el("pre",{class:"pre"},JSON.stringify(c,null,2)))]))));
}
function reservationDisplay(row){
  if(row.source_kind==="node_operation")return row.state==="unpaid"?"No payment or reservation":"Original ledger remains separate";
  const unverified=row.native_detail?.unverified_spending_exposure;
  if(unverified)return String(row.reserved_base_units||"0")+" linked; "+unverified.amount+" original units awaiting source attribution";
  return row.source_kind&&!["sf36_ledger","governed_mcp"].includes(row.source_kind)?"Separate source":String(row.reserved_base_units);
}
function sourceKindLabel(kind){
  return ({woo_refund:"Original customer refund packets",merchant_adjustments:"Original merchant adjustment exports",
    node_operation:"Original Node accounting exports",mcp_quote:"Native MCP quotes",governed_mcp:"Governed native MCP purchases",sf36_ledger:"SF36 ledger"})[kind]||kind;
}
function sourcePathLabel(source){
  return source.kind==="node_operation"?"Original Node operation identity":source.immutable_intake?"Original customer packet":source.kind==="governed_mcp"?"Original governed source descriptor":
    source.kind==="mcp_quote"?"Original MCP quote directory":"Original ledger";
}
function governedSourceSection(source){
  const owner=source.spending_owner;if(!owner)return null;
  return el("section",{class:"card"},el("h2",{},"Captured native spending owner"),
    facts([["Actor / service",owner.actor+" / "+owner.service],["Payer",owner.payer],["Original host configuration",owner.configurationFile],
      ["Selected host digest",owner.configurationSha256],["Original native state",owner.stateDirectory],["Original policy",owner.policy],
      ["Original shared ledger",owner.ledger],["Ledger state",source.ledger_state]]),
    source.unlinked_spending_exposures?.length?el("div",{},el("h3",{},"Original spending awaiting source attribution"),
      localTable(["Original request","Native ledger state","Reserved / settled units","Original request digest"],source.unlinked_spending_exposures.map(row=>[
        el("span",{class:"code"},row.request_id),row.state,el("div",{},"Reserved: "+row.amount,el("div",{},"Settled: "+row.settled_actual)),
        el("span",{class:"code"},row.request_digest)]))):null,
    source.source_issues?.length?el("details",{open:true},el("summary",{},"Original source issues"),
      el("pre",{class:"pre"},JSON.stringify(source.source_issues,null,2))):null,
    source.source_notes?.length?el("details",{},el("summary",{},"Retained source notes"),
      el("pre",{class:"pre"},JSON.stringify(source.source_notes,null,2))):null);
}
async function renderSources(){
  if(view.nodeImport)return renderNodeImport();
  if(view.capture)return renderCapture();
  if(view.source&&!selectedSource())view.source=null;
  heading("Source captures","Register an original buyer ledger or MCP source, or import a completed original Node accounting export. Each complete capture becomes current after a named source review.");
  if(view.source){
    const source=selectedSource();
    content.append(button("← All sources",()=>navigate(()=>{view.source=null;}),"small"));
    content.append(el("section",{class:"card"},el("div",{class:"card-header"},el("h2",{},source.name),badge(source.pending.length+" pending")),
      facts([[sourcePathLabel(source),source.path],["Source provenance",source.provenance||"—"],["Accepted capture",source.current_capture||"None"],
        ["Projection digest",source.projection_sha256||"—"],["Native rows / source transitions",String(source.rows??0)+" / "+(source.kind==="node_operation"?"No ledger transitions in this export":String(source.journal_events??0))],["Captured",source.capture_time||"—"]]),
      el("div",{class:"actions"},source.immutable_intake?button(source.kind==="node_operation"?"Import successor Node export":"Import successor original receipt",()=>navigate(()=>{if(source.kind==="node_operation"){view.nodeImport=true;}else{view.tab="credits";view.refundPacket=null;view.credit=null;}}),"primary"):button(source.kind==="governed_mcp"?"Capture quotes and original spending":source.kind==="mcp_quote"?"Capture original MCP quotes":"Capture original ledger",async()=>{if(!discard())return;const result=await mutate("/api/sources/"+source.id+"/capture");view.capture=result.id;view.captureOffset=0;await redrawAfter("New native capture is awaiting review.");},"primary"))));
    if(source.kind==="governed_mcp")content.append(governedSourceSection(source));
    const data=await api("/api/sources/"+source.id+"/captures?offset="+view.sourceOffset+"&limit=20");
    content.append(el("section",{class:"card"},el("h2",{},"Capture history"),
      table(["Captured","State","Native rows","Changes",""],data.items.map(c=>[c.created_at,badge(c.status),(c.source.records??c.source.reservations),c.change_count,
        button("Review capture",()=>navigate(()=>{view.capture=c.id;view.captureOffset=0;}),"small")])),
      pager(data,x=>navigate(()=>{view.sourceOffset=x;}),20)));
    if(!source.immutable_intake)content.append(formCard(source.kind==="governed_mcp"?"Reattach original governed source":source.kind==="mcp_quote"?"Rebind moved original MCP source":"Rebind moved original ledger",[
      {name:"path",label:source.kind==="governed_mcp"?"Selected private governed-source descriptor":source.kind==="mcp_quote"?"New original MCP quote directory":"New original ledger path",value:source.path,wide:true,required:true},
      {name:"operator",label:"Source owner",required:true},
      {name:"reason",label:"Rebinding reason",multiline:true,required:true,wide:true}
    ],"Check continuity and capture",async(values,form)=>{const r=await save(form,"/api/sources/"+source.id+"/rebind",values);view.capture=r.capture.id;view.captureOffset=0;await redrawAfter("Original request identities matched; review the new capture.");},
      {intro:"Use the same original buyer source after moving it. Its retained request identities and terms are checked before the new locator is saved."}).card);
    return;
  }
  content.append(table(["Source / kind","Original source","Accepted rows","Pending captures",""],state.sources.map(s=>[el("div",{},s.name,el("div",{class:"quiet"},sourceKindLabel(s.kind))),el("span",{class:"code"},s.path),String(s.rows??0),String(s.pending.length),
    button("Open source",()=>navigate(()=>{view.source=s.id;view.sourceOffset=0;}),"small")])));
  content.append(el("section",{class:"card"},el("h2",{},"Original Node operation"),el("p",{},"Import a completed original accounting export with its retained producing attempt, evidence and native outcome."),button("Import Node accounting export",()=>navigate(()=>{view.nodeImport=true;}),"primary")));
  content.append(formCard("Register original buyer ledger",[
    {name:"name",label:"Source name",required:true},
    {name:"data_context",label:"Original operation context",value:state.data_context||"operational",choices:[{value:"operational",label:"Operational buyer source"},{value:"development",label:"Controlled development operation"}],help:"Keep the original source attribution. An accepted workspace retains one operation context."},
    {name:"path",label:"Original SF36 SQLite path",required:true,wide:true,help:"Select the existing reservations.sqlite file in its original buyer workspace."},
    {name:"provenance",label:"Source provenance",multiline:true,wide:true,help:"Retain the original operator, operation and source references that explain this ledger."}
  ],"Capture source for review",async(values,form)=>{const r=await save(form,"/api/sources",values);view.source=r.id;view.capture=r.capture.id;view.captureOffset=0;await redrawAfter("Original source captured. Review the retained rows before accepting them.");}).card);
  content.append(formCard("Register original MCP buyer source",[
    {name:"name",label:"Source name",required:true},
    {name:"data_context",label:"Original operation context",value:state.data_context||"operational",choices:[{value:"operational",label:"Operational buyer source"},{value:"development",label:"Controlled development operation"}],help:"Keep the original source attribution. An accepted workspace retains one operation context."},
    {name:"path",label:"Original MCP quote directory",required:true,wide:true,help:"Choose the existing private directory containing the original quotes.sqlite; no signer or operator module is loaded."},
    {name:"provenance",label:"Source provenance",multiline:true,wide:true,help:"Retain the original buyer operation, source owner and payment-observation references."}
  ],"Capture MCP source for review",async(values,form)=>{const r=await save(form,"/api/sources",{...values,kind:"mcp_quote"});view.source=r.id;view.capture=r.capture.id;view.captureOffset=0;await redrawAfter("Original MCP quotes captured. Review their payment and result classifications before accepting.");},
  {intro:"A saved matched native transfer can enter expense. Seller status, an unresolved quote and an SF36 reservation remain distinct. New MCP captures use the host's existing Node runtime; retained editions reopen independently."}).card);
  content.append(formCard("Register governed native MCP purchases",[
    {name:"name",label:"Source name",required:true},
    {name:"data_context",label:"Original operation context",value:state.data_context||"operational",choices:[{value:"operational",label:"Operational buyer source"},{value:"development",label:"Controlled development operation"}]},
    {name:"path",label:"Private governed-source descriptor",required:true,wide:true,
      help:"Select an existing private JSON file with schema stellar-forge.governed-mcp-expense-input.v1, quoteDirectory and spendingConfigurationFile. Use the original native spending host and its complete shared ledger."},
    {name:"provenance",label:"Source provenance",multiline:true,wide:true,
      help:"Retain the original buyer, source owner, operation and spending references."}
  ],"Capture purchases and spending",async(values,form)=>{
    const r=await save(form,"/api/sources",{...values,kind:"governed_mcp"});view.source=r.id;view.capture=r.capture.id;view.captureOffset=0;
    await redrawAfter("Original quotes, native bindings and the shared spending statement are captured for review.");
  },{intro:"This source matches original quote IDs and native request digests to the original SF36 ledger. It retains outstanding reservations, settled amounts, payment observations and complete-result metadata together. Only this buyer's bound rows enter its expense totals."}).card);
}
async function renderCapture(){
  const c=await api("/api/captures/"+view.capture+"?offset="+view.captureOffset+"&limit=20");
  content.append(button("← Source history",()=>navigate(()=>{view.capture=null;}),"small"));
  heading("Native capture review",c.id);
  content.append(el("section",{class:"card"},el("div",{class:"card-header"},el("h2",{},"Retained source edition"),badge(c.status)),
    facts([["Captured",c.captured_at],["Original rows",(c.source.records??c.source.reservations)],["Journal events / last sequence",String(c.source.journal_events)+" / "+String(c.source.last_sequence)],
      ["Projection digest",c.source.projection_sha256],["Changes","Added "+c.change_counts.ADDED+" · Changed "+c.change_counts.CHANGED+" · Absent "+c.change_counts.ABSENT]]),
    button("Download original capture",()=>download("/api/captures/"+c.id+"/original","native-statement-capture.json"),"small")));
  if(c.source.kind==="node_operation"){
    content.append(el("section",{class:"card"},el("h2",{},"Original Node source"),
      facts([["Intent",c.source.intent_id],["Accounting command",c.source.command_id],["Native outcome",c.source.outcome],
        ["Original file digest",c.source.source_sha256],["Original bytes",c.source.source_bytes],
        ["Intake owner",c.node_intake?.operator],["Original provenance",c.node_intake?.provenance],
        ["Original filename",c.node_intake?.filename]]),
      el("p",{class:"quiet"},"The exported file contains one original operation, not a complete spending ledger. Unpaid outcomes create no asset or settled expense."),
      button("Download exact Node export",()=>download("/api/captures/"+c.id+"/node-original","original-node-accounting-export.json"),"small")));
  }
  if(c.source.kind==="governed_mcp"){
    content.append(governedSourceSection({...c.source,source_issues:c.source.integrity_issues}));
    content.append(el("section",{class:"card"},el("h2",{},"Complete source coverage"),
      facts([["Captured quotes",c.source.records],["Linked original requests",c.source.linked_requests],
        ["All shared ledger rows retained",c.source.shared_ledger_rows],["Other shared rows outside this source's totals",c.source.other_shared_ledger_rows],
        ["Quote transitions / last sequence",String(c.source.quote_transitions)+" / "+String(c.source.quote_last_sequence)],
        ["Native owner initialized",c.source.native_initialized?"Yes":"First purchase has not initialized its native records"]])));
  }
  content.append(el("section",{class:"card"},el("h2",{},"Original row differences"),
    table(["Request","Change","Native detail"],c.changes.items.map(change=>[el("span",{class:"code"},change.request_id),badge(change.kind),
      el("details",{},el("summary",{},"View before / after"),el("pre",{class:"pre"},JSON.stringify(change,null,2)))])),
    pager(c.changes,x=>navigate(()=>{view.captureOffset=x;}),20)));
  if(c.status==="PENDING")content.append(formCard("Source decision",[
    {name:"decision",label:"Decision",value:"ACCEPT",choices:[{value:"ACCEPT",label:"Accept as current source"},{value:"REJECT",label:"Reject and retain this capture"}]},
    {name:"operator",label:"Source reviewer",required:true},
    {name:"reason",label:"Source review reason",required:true,multiline:true,wide:true}
  ],"Retain source decision",async(values,form)=>{await save(form,"/api/captures/"+c.id+"/decision",values);await redrawAfter("Source decision retained.");}).card);
  else content.append(el("section",{class:"card"},el("h2",{},"Recorded decision"),facts([["Reviewer",c.operator],["Reviewed",c.reviewed_at],["Reason",c.reason]])));
}
async function renderSettings(){
  heading("Cost centers and asset labels","Keep account and project codes as text. Asset labels add an explicit display scale; exports retain the exact original base-unit amounts.");
  content.append(el("div",{class:"toolbar"},button("Cost centers",()=>navigate(()=>{view.setting="centers";}),view.setting==="centers"?"primary":""),
    button("Asset labels",()=>navigate(()=>{view.setting="labels";}),view.setting==="labels"?"primary":"")));
  if(view.setting==="labels"){
    content.append(formCard("Native asset display labels",[
      {name:"assets",label:"Asset labels JSON",multiline:true,rows:12,wide:true,value:JSON.stringify(state.labels,null,2),help:'Each entry contains network, asset, symbol and decimals (0–30). Leave [] to show native base units only.'}
    ],"Save display labels",async(values,form)=>{let assets;try{assets=JSON.parse(values.assets);}catch{throw new Error("Enter valid asset-label JSON.");}
      await save(form,"/api/labels",{assets});await redrawAfter("Asset labels retained without currency conversion.");}).card);return;
  }
  content.append(table(["Code","Cost center","State",""],state.centers.map(c=>[el("span",{class:"code"},c.code),c.name,badge(c.active?"ACTIVE":"INACTIVE"),
    button("Edit center",()=>navigate(()=>{view.center=c.id;}),"small")])));
  const current=state.centers.find(c=>c.id===view.center);
  content.append(formCard(current?"Edit cost center":"New cost center",[
    {name:"code",label:"Cost center code",value:current?.code||"",required:true},
    {name:"name",label:"Cost center name",value:current?.name||"",required:true},
    {name:"active",label:"Available for new allocations",type:"checkbox",value:current?.active??true,wide:true}
  ],"Save cost center",async(values,form)=>{await save(form,"/api/centers",{...values,...(current?{id:current.id}:{})});view.center=null;await redrawAfter("Cost center saved.");},
    current?{cancel:()=>navigate(()=>{view.center=null;})}:{}).card);
}

function nativeOutcomeSection(report, title="Original native purchase outcomes"){
  const rows=report.native_payment_outcomes||[];
  if(!rows.length)return null;
  return el("section",{class:"card"},el("h2",{},title),
    el("p",{class:"quiet"},"Original purchase and quote facts retain their source context. Quoted prices, store currency values and native spending reservations remain separate."),
    localTable(["Original request / source","Original source day","Buyer / payment state","Quoted / settled base units","Original spending","Original transaction / result"],rows.map(r=>[
      el("div",{class:"long code"},r.request_id,el("div",{class:"quiet"},r.source_name)),r.quote_day,
      el("div",{},r.native_status,el("div",{class:"quiet"},r.payment_classification),r.missing?el("div",{},"Absent from latest source"):null),
      el("div",{class:"code"},r.native_status==="NO_PAYMENT_REQUIRED"?"No payment required":r.quoted_amount??"Unknown",
        el("div",{},"Settled: "+(r.settled_actual??"Not established")),el("div",{class:"quiet"},r.network?r.network+" / "+r.asset:"No payment asset")),
      r.source_kind==="governed_mcp"?el("div",{class:"long code"},r.spending_state||"No native reservation",
        el("div",{},"Reserved: "+r.spending_reserved_base_units),el("div",{},"Original actual: "+(r.spending_actual??"Not settled")),
        el("div",{},"Quote observed: "+(r.observed_settled_actual??"Not established")),
        el("div",{class:"quiet"},r.spending_request_sha256||"No native binding"),
        r.spending_problems?.length?el("div",{},r.spending_problems.join(" · ")):null):(r.source_kind==="node_operation"?"Original ledger remains separate":"Separate source"),
      el("div",{class:"long code"},r.receipt_ref||"No original transaction reference",
        r.source_kind==="node_operation"?el("div",{},r.node_command_id,el("div",{class:"quiet"},"Observed: "+r.source_observed_at),el("div",{},r.node_source_sha256)):
        el("div",{},el("div",{class:"quiet"},"Result: "+(r.result_file?.status||"No complete-file record")),
          el("div",{},r.result_file?.sha256||r.result_preview?.bodySha256||"No recorded result digest")))
    ])));
}

async function renderPeriods(){
  if(view.close)return renderIssued();
  heading("Period review","Review the current source editions, exact allocations and outstanding reservations. A named review can issue a frozen accountant edition; reopening keeps every prior edition.");
  if(view.period&&!selectedPeriod())view.period=null;
  const select=field({name:"period",label:"Recognition period",value:view.period||"",choices:[{value:"",label:"Select a period"},...state.periods.map(p=>({value:p.id,label:p.name+" · "+p.state}))]});
  content.append(el("div",{class:"toolbar"},select.wrap,
    button("Open period",()=>navigate(()=>{view.period=select.input.value||null;view.review=null;view.issue=null;view.periodEdit=false;view.historyOffset=0;})),
    button("New period",()=>navigate(()=>{view.period=null;view.periodEdit=true;view.review=null;view.issue=null;}))));
  const period=selectedPeriod();
  if(view.periodEdit||(!period&&!state.periods.length)){
    content.append(formCard(period?"Edit recognition period":"Create recognition period",[
      {name:"name",label:"Period name",value:period?.name||"",required:true,wide:true},
      {name:"from_day",label:"First recognition date",type:"date",value:period?.from_day||"",required:true},
      {name:"through_day",label:"Last recognition date",type:"date",value:period?.through_day||"",required:true}
    ],"Save period",async(values,form)=>{const p=await save(form,"/api/periods",{...values,...(period?{id:period.id}:{})});view.period=p.id;view.periodEdit=false;await redrawAfter("Recognition period saved.");},
      {cancel:()=>navigate(()=>{view.periodEdit=false;})}).card);return;
  }
  if(!period){content.append(el("div",{class:"empty"},"Choose a retained period or create its recognition-date window."));return;}
  const report=await api("/api/periods/"+period.id+"/report");
  content.append(el("section",{class:"card"},el("div",{class:"card-header"},el("div",{},el("h2",{},period.name),el("p",{class:"selection"},period.from_day+" through "+period.through_day)),badge(period.state,period.state==="CLOSED")),
    el("div",{class:"metrics"},el("div",{class:"metric"},el("strong",{},String(report.allocations.length)),el("span",{},"Allocation lines")),
      el("div",{class:"metric"},el("strong",{},String(report.unresolved)),el("span",{},"Unresolved review items")),
      el("div",{class:"metric"},el("strong",{},String(report.outstanding_reservations.length)),el("span",{},"Outstanding native rows"))),
    el("div",{class:"actions"},period.state==="OPEN"?button("Edit period",()=>navigate(()=>{view.periodEdit=true;}),"small"):null,
      period.latest_close?button("Open latest issued edition",()=>navigate(()=>{view.close=period.latest_close;}),"small"):null)));
  content.append(totalCards(report));
  if(period.state==="CLOSED"){
    content.append(formCard("Reopen this period",[
      {name:"operator",label:"Reopening owner",required:true},
      {name:"reason",label:"Reopening reason",required:true,multiline:true,wide:true}
    ],"Reopen and retain prior edition",async(values,form)=>{await save(form,"/api/periods/"+period.id+"/reopen",values);view.review=null;await redrawAfter("Period reopened. Its issued editions remain unchanged.");},
      {intro:"The figures below describe current retained source and coding. The issued edition above keeps the exact source, classifications and reviewer state from its close."}).card);
  }
  const outcomes=nativeOutcomeSection(report);if(outcomes)content.append(outcomes);
  const creditSection=creditReportSection(report);if(creditSection)content.append(creditSection);
  const issues=el("section",{class:"card"},el("h2",{},"Source, payment and reservation review"));
  if(!report.issues.length)issues.append(el("p",{},"No source or coding exception remains in this period."));
  for(const issue of report.issues){
    const c=el("div",{class:"issue"},el("div",{class:"issue-head"},el("strong",{},issue.code.replaceAll("_"," ")),badge(issue.resolved?"REVIEWED":"OPEN")),
      issue.request_id?el("p",{class:"code"},issue.request_id):null,el("p",{},issue.description));
    if(issue.disposition)c.append(el("p",{class:"quiet"},issue.disposition.kind+" · "+issue.disposition.operator+": "+issue.disposition.reason));
    if(period.state==="OPEN"){
      if(issue.allowed_kinds.length)c.append(button(issue.resolved?"Revise decision":"Record decision",()=>navigate(()=>{view.issue=issue.code+"|"+issue.item_id;}),"small"));
      else if(issue.group?.packet_id||issue.credit_id)c.append(button("Open return review",()=>navigate(()=>{view.tab="credits";view.refundPacket=issue.group?.packet_id||null;view.credit=issue.credit_id||null;}),"small"));
      else c.append(button("Open source review",()=>navigate(()=>{view.tab="sources";view.source=issue.group?.source_id||null;view.capture=null;}),"small"));
    }issues.append(c);
  }
  content.append(issues);
  const chosen=report.issues.find(x=>view.issue===x.code+"|"+x.item_id);
  if(chosen&&period.state==="OPEN"&&chosen.allowed_kinds.length){
    content.append(formCard("Exception decision",[
      {name:"kind",label:"Disposition",value:chosen.disposition?.kind||chosen.allowed_kinds[0],choices:chosen.allowed_kinds.map(k=>({value:k,label:k.replaceAll("_"," ")}))},
      {name:"operator",label:"Disposition owner",value:chosen.disposition?.operator||"",required:true},
      {name:"reason",label:"Disposition reason",value:chosen.disposition?.reason||"",required:true,multiline:true,wide:true}
    ],"Retain exception decision",async(values,form)=>{await save(form,"/api/periods/"+period.id+"/disposition",{...values,code:chosen.code,item_id:chosen.item_id,basis:chosen.basis});view.issue=null;view.review=null;await redrawAfter("Exception decision retained; the original native row is unchanged.");},
      {intro:chosen.description,cancel:()=>navigate(()=>{view.issue=null;})}).card);
  }
  content.append(el("section",{class:"card"},el("h2",{},"Allocated settled actual"),
    localTable(["Recognition date","Cost center / project","Network / asset","Base units","Original request / receipt"],report.allocations.map(line=>[line.recognition_date,
      el("div",{},line.center_code+" · "+line.center_name,el("div",{class:"quiet"},line.project||"No project")),
      el("span",{class:"code"},line.network+" / "+line.asset),el("span",{class:"code"},line.amount),
      el("div",{class:"long code"},line.request_id,el("div",{},line.receipt_ref))]))));
  if(report.outstanding_reservations.length)content.append(el("section",{class:"card"},el("h2",{},"Original outstanding reservations"),
    localTable(["Request","Source","Native reservation day","Network / asset","Reserved base units","Capture status"],report.outstanding_reservations.map(r=>[el("span",{class:"code"},r.request_id),
      r.contributing_sources?el("details",{},el("summary",{},r.contributing_sources.length+" views of one original reservation"),
        el("pre",{class:"pre"},JSON.stringify(r.contributing_sources,null,2))):r.source_name,
      r.native_reservation_day,r.network+" / "+r.asset,r.amount,
      r.attribution==="UNVERIFIED_NATIVE_LINK"?"Original exposure awaiting source attribution":r.missing?"Absent from latest capture":"Present in accepted capture"]))));
  if(period.state==="OPEN"){
    content.append(formCard("Named period review",[
      {name:"reviewer",label:"Review owner",required:true},
      {name:"role",label:"Review capacity",required:true,help:"State the reviewer's actual role or capacity for this decision."},
      {name:"notes",label:"Review conclusion",required:true,multiline:true,wide:true}
    ],"Save current review",async(values,form)=>{const r=await save(form,"/api/periods/"+period.id+"/review",values);view.review=r.id;await redrawAfter("The current source and allocation review is retained.");},
      {intro:report.ready?"All required exception decisions are present. Review the exact allocation and reservation totals before issuing.":"The review can be retained now; displayed unresolved items must be addressed before issuance."}).card);
  }
  if(view.review)await appendSavedReview(view.review,report);
  await appendHistory(period.id);
}
async function appendSavedReview(id,current){
  const review=await api("/api/reviews/"+id);
  if(review.period_id!==current.period.id){view.review=null;return;}
  const fresh=review.context_sha256===current.context_sha256;
  const card=el("section",{class:"card"},el("div",{class:"card-header"},el("h2",{},"Retained review"),badge(review.decision)),
    facts([["Review owner",review.reviewer],["Capacity",review.role],["Saved",review.created_at],["Conclusion",review.notes],["Current source match",fresh?"Current context matches":"Source or coding changed since this review"]]));
  if(current.period.state==="OPEN")card.append(button("Issue reviewed accountant edition",async()=>{if(!discard())return;const result=await mutate("/api/periods/"+current.period.id+"/close",{review_id:review.id});view.close=result.id;await redrawAfter("Accountant edition issued and retained.");},"primary",!fresh||review.decision!=="READY"));
  card.append(el("details",{class:"detail"},el("summary",{},"Retained review snapshot"),el("pre",{class:"pre"},JSON.stringify(review.snapshot,null,2))));
  content.append(card);
}
async function appendHistory(periodId){
  const data=await api("/api/periods/"+periodId+"/history?offset="+view.historyOffset+"&limit=20");
  content.append(el("section",{class:"card"},el("h2",{},"Review and issued-edition history"),
    table(["Saved","Type / edition","Reviewer","Decision",""],data.items.map(r=>[r.created_at,r.kind==="close"?"Issued edition "+r.sequence:"Review",r.reviewer,r.decision||"CLOSED",
      button(r.kind==="close"?"Open issued edition":"Open retained review",()=>navigate(()=>{if(r.kind==="close")view.close=r.id;else view.review=r.id;}),"small")])),
    pager(data,x=>navigate(()=>{view.historyOffset=x;}),20)));
}
async function renderIssued(){
  const doc=await api("/api/closes/"+view.close);
  content.append(button("← Period review",()=>navigate(()=>{view.close=null;}),"small"));
  heading(doc.period.name+" · issued edition "+doc.sequence,"This retained edition contains its original captures, reviewed allocation, outstanding reservations and named conclusion.");
  content.append(el("section",{class:"card"},el("div",{class:"card-header"},el("h2",{},"Issued accountant period"),badge("CLOSED",true)),
    facts([["Recognition dates",doc.period.from_day+" through "+doc.period.through_day],["Issued",doc.created_at],["Review owner",doc.review.reviewer],
      ["Review capacity",doc.review.role],["Conclusion",doc.review.notes],["Previous edition",doc.previous||"First issued edition"],["Context digest",doc.context_sha256]]),
    el("div",{class:"actions"},button("Open issued HTML",()=>viewReport(doc.id),"primary"),
      button("Download accountant packet",()=>download("/api/closes/"+doc.id+"/packet","accountant-edition-"+doc.sequence+".zip")),
      button("Download edition JSON",()=>download("/api/closes/"+doc.id,"accountant-edition-"+doc.sequence+".json")),
      button("Export source to accountant",()=>download("/api/closes/"+doc.id+"/accountant-source","issued-buyer-accountant-source.json")))));
  await appendAccountantReturn(doc);
  content.append(totalCards(doc));
  const creditSection=creditReportSection(doc,true);if(creditSection)content.append(creditSection);
  const outcomes=nativeOutcomeSection(doc,"Frozen original native purchase outcomes");if(outcomes)content.append(outcomes);
  content.append(el("section",{class:"card"},el("h2",{},"Frozen allocation lines"),
    localTable(["Date","Cost center","Project / account","Network / asset","Exact base units","Original request"],doc.allocations.map(l=>[l.recognition_date,l.center_code+" · "+l.center_name,
      el("div",{},l.project||"—",el("div",{class:"code"},l.account_code||"—")),l.network+" / "+l.asset,l.amount,el("span",{class:"code"},l.request_id)]))));
  content.append(el("section",{class:"card"},el("h2",{},"Retained source captures"),
    table(["Source","Capture","Projection digest"],doc.source_captures.map(c=>[c.name,c.current_capture,el("span",{class:"code"},c.projection_sha256)]))));
}

async function appendAccountantReturn(doc){
  const path="/api/closes/"+doc.id,history=await api(path+"/accountant-returns?offset="+view.bookkeepingOffset+"&limit=20");
  const host=el("section",{class:"card"},el("h2",{},"Returned accountant references"),
    el("p",{class:"quiet"},"The accountant workspace can review this exact issued source, value selected allocations in its Xero organization, and return book references. Financial allocations and earlier issued editions stay frozen."));
  host.append(table(["Saved / name","Accountant revision","State","Source match",""],history.items.map(row=>[
    el("div",{},row.name,el("small",{},row.created_at+" · "+row.operator)),el("span",{class:"code"},row.selected_revision_id),
    row.current?"Current references":"Prior references",row.summary.outcome,
    button("Open return",()=>navigate(()=>{view.bookkeeping=row.id;}),"small")])),
    pager(history,n=>navigate(()=>{view.bookkeepingOffset=n;}),20));
  host.append(button("Export period and returned bookkeeping",()=>download(path+"/bookkeeping-packet?expected_revision="+history.revision,"buyer-bookkeeping-complete-period.zip")));
  content.append(host);
  if(view.bookkeeping){
    const saved=await api("/api/accountant-returns/"+view.bookkeeping);
    if(saved.close_id===doc.id){
      host.append(el("h3",{},saved.name),facts([["Accepted by",saved.operator],["Reference state",saved.current?"Current":"Historical"],
        ["Returned handoff",saved.handoff_id],["Original packet digest",saved.packet_sha256],["Issued source digest",saved.source_sha256],["Review note",saved.reason||"—"]]),
        button("Download original returned packet",()=>download("/api/accountant-returns/"+saved.id+"/original","original-buyer-accountant-return.json")),
        localTable(["Kind / original line","Native allocation","Original coding","External status","Book / account","Returned note"],saved.native.rows.map(row=>[
          el("div",{},row.kind,el("small",{class:"code"},row.sourceLineId)),unit(row.original.amount,row.original,doc.labels),
          [row.original.center_code,row.original.project,row.original.account_code].filter(Boolean).join(" · "),row.externalStatus,
          el("div",{},row.externalBookRef||"—",el("div",{},row.externalAccountCode||"—")),row.externalNote||"—"])));
    }
  }
  let candidate=null,pending=null,token=0;
  const f=formCard("Receive accountant references",[
    {name:"file",label:"Original buyer-return JSON",type:"file",required:true,wide:true},
    {name:"operator",label:"Bookkeeping review operator",required:true,maxlength:160},
    {name:"name",label:"Return name",required:true,maxlength:160},
    {name:"reason",label:"Review note",multiline:true,wide:true,maxlength:2000,help:"Describe a change of accountant handoff when replacing previously accepted references."}
  ],"Preview original returned references",async(values,form)=>{
    if(pending)throw new Error("Recover or retry the retained save request before changing this return.");
    const file=f.fields.file.files[0];if(!file||!file.size||file.size>64*1024*1024)throw new Error("Choose original buyer-return JSON up to 64 MiB.");
    const current=++token,bytes=new Uint8Array(await file.arrayBuffer()),hash=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
    let raw="";for(let i=0;i<bytes.length;i+=32768)raw+=String.fromCharCode(...bytes.subarray(i,i+32768));
    const payload={content_base64:btoa(raw),sha256:[...hash].map(x=>x.toString(16).padStart(2,"0")).join("")};
    const preview=await api(path+"/accountant-preview",{payload});
    if(current!==token||f.fields.file.files[0]!==file)return;
    candidate={preview,payload};form.dataset.revision=String(preview.revision);
    const native=preview.native;
    result.replaceChildren(el("h3",{},"Exact returned-source review"),
      facts([["Original buyer workspace",native.source.workspaceId],["Issued edition",native.source.closeId+" · "+native.source.sequence],
        ["Original source digest",native.source.sha256],["Original handoff",native.handoffId],["Returned revision",native.selectedRevisionId],
        ["Original return result",native.summary.outcome],["Retained source context",native.source.dataContext]]),
      localTable(["Allocation","Exact native units","Returned status","Book reference","Account","Note"],native.rows.map(row=>[
        row.kind+" · "+row.original.center_code,unit(row.original.amount,row.original,doc.labels),row.externalStatus,row.externalBookRef||"—",row.externalAccountCode||"—",row.externalNote||"—"])));
    for(const overlap of preview.other_handoffs){
      const check=el("input",{type:"checkbox","data-supersedes":overlap.return_id});
      result.append(el("label",{class:"field checkbox"},check,el("span",{},"Replace the current references from handoff "+overlap.handoff_id+"; retain its full earlier history.")));
    }
    f.fields.reason.required=preview.other_handoffs.length>0;
    if(native.issues.length)result.append(el("details",{},el("summary",{},"Retained accountant return findings"),el("pre",{},JSON.stringify(native.issues,null,2))));
    result.append(button(preview.duplicate?"Recover this already accepted return":"Save reviewed book references",saveReferences,"primary"));
  },{intro:"Export the original issued source above. In the accountant workspace choose Issued buyer expense period, then download Return to buyer workspace from a saved accountant return."});
  const result=el("div",{class:"review-area"});f.card.append(result);content.append(f.card);f.fields.file.accept=".json,application/json";
  function enable(value){for(const field of Object.values(f.fields))field.disabled=!value;}
  async function accepted(response){
    const value=response.result??response;pending=null;candidate=null;dirty.delete(f.form);enable(true);view.bookkeeping=value.id;
    await refreshState();await redrawAfter("Original accountant references and the complete return chain are saved. Issued financial amounts are unchanged.");
  }
  async function sendPending(){
    let response;
    try{response=await api(path+"/accountant-return",pending);}
    catch(error){
      if(error.status&&error.status<500){pending=null;enable(true);candidate=null;result.replaceChildren(el("p",{class:"error"},error.message),el("p",{},"Your selected file and review fields remain. Preview the current returned source again."));throw error;}
      const requestId=pending.request_id;
      result.append(el("p",{class:"error"},"The save did not return a completion. Original request "+requestId+" is retained here."),
        button("Recover original request",async()=>{
          try{const receipt=await api("/api/requests/"+requestId);await accepted(receipt.response);}
          catch(e){if(e.status===404){notify("That original request has not committed. Retry the exact retained request.");return;}throw e;}
        }),button("Retry exact retained request",sendPending));
      return;
    }
    await accepted(response);
  }
  async function saveReferences(){
    if(pending)return sendPending();
    if(!candidate)throw new Error("Preview the complete original return first.");
    if(!f.form.reportValidity())return;
    const supersedes=[...result.querySelectorAll("[data-supersedes]:checked")].map(x=>x.dataset.supersedes);
    const reason=f.fields.reason.value.trim();if(candidate.preview.other_handoffs.length&&!reason)throw new Error("Record the reason for replacing the preceding accountant handoff.");
    pending={request_id:crypto.randomUUID(),expected_revision:candidate.preview.revision,payload:{...candidate.payload,
      preview_sha256:candidate.preview.preview_sha256,operator:f.fields.operator.value.trim(),name:f.fields.name.value.trim(),reason,supersedes}};
    enable(false);await sendPending();
  }
  f.form.addEventListener("input",()=>{if(!pending){candidate=null;++token;result.replaceChildren();}});
}

function receiptReference(value){return value.order_reference||value.source_reference||value.event_id||value.adjustment_id||"Original source";}
function originalStoreAmount(value, currencyKey="currency"){
  return value.store_amount!==undefined&&value.store_amount!==null&&value[currencyKey]?
    value.store_amount+" "+value[currencyKey]:"Store-currency amount not supplied";
}
function adjustmentTable(records){
  return localTable(["Original reference / adjustment","Native decision","Original amount / asset","Dates / review","Original source"],
    records.map(r=>[el("div",{},r.source_reference||r.event_id,el("div",{class:"code long"},r.adjustment_id||r.event_id)),
      el("div",{},r.kind+" / "+r.status,el("div",{class:"quiet"},r.eligibility||r.payment_status)),
      el("div",{},r.amount===null||r.amount===undefined?"No adjustment amount":r.amount+" base units",
        el("div",{},r.network||""),el("small",{},"Asset digest"),el("div",{class:"code long"},r.asset_digest||"")),
      el("div",{},r.effective_at||"No effective date supplied",el("div",{},r.operator||""),el("small",{},r.reason||"")),
      el("div",{},r.source_name||"",el("div",{class:"code long"},r.source_sha256||""))]));
}
function creditReportSection(report,frozen=false){
  const records=report.merchant_credit_outcomes||[], lines=report.credit_allocations||[], adjustments=report.merchant_adjustment_outcomes||[];
  if(!records.length&&!lines.length&&!adjustments.length)return null;
  const section=el("section",{class:"card"},el("h2",{},(frozen?"Frozen ":"")+"Buyer credits and returns"),
    el("p",{class:"quiet"},"Operation context: "+(report.data_context||"operational")+". Returned native units keep their original payment binding. Any supplied store-currency amount remains independent."));
  if(records.length)section.append(localTable(["Original reference / return","Native reverse transfer","Source status / store amount","Source / original packet"],
    records.map(r=>[el("div",{},receiptReference(r)+" / "+(r.refund_id||r.adjustment_id),el("div",{class:"quiet"},r.site_url||r.source_kind)),
      el("div",{},unit(r.native_return,r,report.labels||state.labels),el("div",{class:"code long"},r.transaction),el("small",{},r.transfer_at||"Transfer time not supplied")),
      el("div",{},originalStoreAmount(r),el("div",{},r.merchant_status)),
      el("div",{},r.source_name,el("div",{class:"code long"},r.manifest_sha256),
        r.present_in_latest_receipt===false?el("small",{},"Absent from latest accepted receipt; original verified return retained"):null)])));
  if(lines.length)section.append(el("h3",{},"Return allocation lines"),localTable(
    ["Recognition date","Cost center / project","Account","Returned native units","Original refund"],
    lines.map(l=>[l.recognition_date,l.center_code+" · "+l.center_name+" / "+(l.project||"—"),
      l.account_code||"—",unit(l.amount,l,report.labels||state.labels),el("span",{class:"code"},l.adjustment_id)])));
  if(adjustments.length)section.append(el("h3",{},"Original merchant adjustment decisions"),
    el("p",{class:"quiet"},"Accepted source decisions retained with this review: pending requests, cancellations and withdrawn decisions remain visible without being treated as returned transfers."),adjustmentTable(adjustments));
  return section;
}
async function renderCredits(){
  if(view.refundPacket)return renderRefundPacket();
  if(view.credit)return renderCredit();
  heading("Buyer credits and returns","Retain the original merchant receipt, review its purchase binding and source decisions, then allocate verified returned units against the original expense. Previously issued periods remain available.");
  if(state.data_context==="development")content.append(el("p",{class:"notice"},"Development operation workspace. The retained original operator provenance remains attached to every purchase, return and issued report."));
  const credits=await api("/api/credits?offset="+view.creditOffset+"&limit=20");
  content.append(el("section",{class:"card"},el("h2",{},"Retained buyer returns"),
    table(["Original reference / return","Native returned units","Source status / store amount","Allocation",""],credits.items.map(c=>[
      el("div",{},receiptReference(c.native)+" / "+(c.native.refund_id||c.native.adjustment_id),el("div",{class:"quiet"},c.source_name),
        c.present_in_latest_receipt===false?el("small",{},"Absent from latest accepted receipt"):null),
      unit(c.native.amount,c.native),originalStoreAmount(c.native)+" · "+c.native.original_operation_status,
      badge(c.status),button("Open return",()=>navigate(()=>{view.credit=c.id;}),"small")])),
    pager(credits,x=>navigate(()=>{view.creditOffset=x;}),20)));
  const packets=await api("/api/refund-packets?offset="+view.refundOffset+"&limit=20");
  content.append(el("section",{class:"card"},el("h2",{},"Original receipt intake"),
    table(["Captured source","Original selection / returns","Review",""],packets.items.map(p=>[
      el("div",{},p.name,el("div",{class:"quiet"},p.created_at)),
      el("div",{},p.source_reference||p.credit?.adjustment_id||"Original receipt",
        el("small",{},(p.credits||[p.credit].filter(Boolean)).length+" verified return(s) · "+(p.source_kind||"woo_refund"))),
      badge(p.status),button("Review packet",()=>navigate(()=>{view.refundPacket=p.id;}),"small")])),
    pager(packets,x=>navigate(()=>{view.refundOffset=x;}),20)));
  content.append(formCard("Receive original refund packet",[
    {name:"name",label:"Refund source name",required:true},
    {name:"data_context",label:"Original operation context",value:state.data_context||"operational",choices:[
      {value:"operational",label:"Operational records"},{value:"development",label:"Development operation"}]},
    {name:"directory",label:"Original refund handoff directory",required:true,wide:true,
      help:"Select the exact retained customer packet directory containing its original manifest.json."},
    {name:"manifest_sha256",label:"Original manifest SHA-256",required:true,wide:true,maxlength:64},
    {name:"site_url",label:"Original store URL",required:true,wide:true},
    {name:"provenance",label:"Original operation provenance",required:true,multiline:true,wide:true,
      help:"Retain the original operator, operation and whether its transfer observation came from a development or operational source."}
  ],"Receive and review original packet",async(values,form)=>{
    const result=await save(form,"/api/refund-packets",values);view.refundPacket=result.id;
    await redrawAfter("The original customer receiver retained this exact packet. Review its purchase and return before acceptance.");
  },{intro:"The maintained Woo customer receiver validates the original merchant manifest, purchase mapping and reverse-transfer observation. It reads the selected local packet and retains a private buyer copy."}).card);
  content.append(formCard("Receive original merchant adjustment export",[
    {name:"name",label:"Adjustment source name",required:true},
    {name:"data_context",label:"Original operation context",value:state.data_context||"operational",choices:[
      {value:"operational",label:"Operational records"},{value:"development",label:"Development operation"}]},
    {name:"source_file",label:"Original accounting-export JSON file",required:true,wide:true,
      help:"Use the unchanged JSON downloaded from the original AdjustmentWorkspace, including originalReport and the selected event."},
    {name:"source_sha256",label:"Original export SHA-256",required:true,wide:true,maxlength:64},
    {name:"event_id",label:"Original accounting event ID",required:true,wide:true,maxlength:64},
    {name:"expected_job",label:"Original paid-job selection JSON",multiline:true,wide:true,rows:5,
      help:"Optional: retain job_id and its settlement selection from the original accounting export. Use the accounting event ID as settlement.id and preserve its nine native binding fields; see the operating guide."},
    {name:"provenance",label:"Original operation provenance",required:true,multiline:true,wide:true}
  ],"Capture original adjustment export",async(values,form)=>{
    let expected_job=null;
    if(values.expected_job.trim()){try{expected_job=JSON.parse(values.expected_job);}catch{throw new Error("Enter the original job ID and accounting-event settlement selection as valid JSON.");}}
    const result=await save(form,"/api/adjustment-packets",{...values,expected_job});view.refundPacket=result.id;
    await redrawAfter("The unchanged original accounting export and selected event are retained for review.");
  },{intro:"The original accounting compiler and native proof validators retain every decision. Pending refunds and cancellations remain source outcomes; verified returns become available only with their original payment binding. This import starts no payment or merchant operation."}).card);
}
async function renderRefundPacket(){
  const packet=await api("/api/refund-packets/"+view.refundPacket), p=packet.purchase, returns=packet.credits||[packet.credit].filter(Boolean);
  const generic=packet.source_kind==="merchant_adjustments";
  content.append(button("← Credits and returns",()=>navigate(()=>{view.refundPacket=null;}),"small"));
  heading("Original receipt review",packet.name+" · "+packet.data_context);
  const details=[["Original source",packet.source_file||packet.source_directory],
    [packet.manifest_kind==="BUYER_INTAKE_SELECTION"?"Buyer-selection digest":"Original manifest digest",packet.manifest_sha256],
    ["Operation provenance",packet.provenance]];
  if(generic)details.push(["Original export digest",packet.source_sha256],["Original selection",packet.source_reference],
    ["Original payment state",packet.payment_status],["Original merchant revision",packet.receipt.workspaceRevision]);
  if(p)details.push(["Original native purchase",unit(p.amount,p)],["Original payment transaction",p.transaction],
    ["Buyer payer",p.payer],["Merchant recipient",p.recipient]);
  else details.push(["Purchase available for allocation","No original independent payment proof in this selection; reference-only source"]);
  if(!generic&&p)details.push(["Order / store",p.order_reference+" / "+p.site_url],["Original store purchase",originalStoreAmount(p)]);
  content.append(el("section",{class:"card"},el("div",{class:"card-header"},el("h2",{},"Retained original receipt"),badge(packet.status)),
    facts(details),button("Download original packet",()=>download("/api/refund-packets/"+packet.id+"/original","original-receipt-"+packet.id+".zip"),"small")));
  if(returns.length)content.append(el("section",{class:"card"},el("h2",{},"Original verified returns"),
    localTable(["Adjustment / refund","Native return","Source status / store amount","Transaction / dates"],returns.map(c=>[
      el("div",{class:"code long"},c.adjustment_id,c.refund_id&&c.refund_id!==c.adjustment_id?el("div",{class:"quiet"},c.refund_id):null),unit(c.amount,c),
      el("div",{},c.original_operation_status,el("div",{class:"quiet"},originalStoreAmount(c))),
      el("div",{class:"code long"},c.transaction,el("div",{},c.transfer_at||"Transfer time not supplied"),el("small",{},"Observed "+c.observed_at))]))));
  if(generic)content.append(el("section",{class:"card"},el("h2",{},"Original merchant decisions"),
    adjustmentTable(packet.adjustments.map(r=>({...r,source_reference:packet.source_reference,source_name:packet.name,
      source_sha256:packet.source_sha256,network:packet.original_event.network,asset_digest:packet.original_event.assetDigest}))),
    packet.receipt.expected_job?el("details",{},el("summary",{},"Exact original paid-job selection"),
      el("pre",{class:"pre"},JSON.stringify(packet.receipt.expected_job,null,2))):null));
  content.append(el("section",{class:"card"},el("h2",{},"Immutable original members"),
    localTable(["Member","Bytes","SHA-256"],packet.files.map(f=>[f.name,String(f.bytes),el("span",{class:"code long"},f.sha256)]))));
  if(packet.status==="PENDING"){
    const defs=[{name:"decision",label:"Source decision",choices:[
      {value:"ACCEPT",label:p?"Accept original purchase and source decisions":"Accept reference-only source"},
      {value:"REJECT",label:"Reject retained receipt"}]}];
    if(p)defs.push(
      {name:"purchase_item_id",label:"Matching retained purchase",choices:[{value:"",label:"Choose an existing original purchase"},...packet.matching_purchases.map(i=>({value:i.id,label:i.source_name+" / "+i.request_id+" · "+i.coding_status}))],wide:true},
      {name:"register_original_purchase",label:"Register the original reviewed purchase from this packet",type:"checkbox",value:false,wide:true,
        help:"Use this when the exact original payment is not already an expense source. It creates a buyer projection of the retained payment; it does not make a payment."});
    defs.push({name:"operator",label:"Buyer source reviewer",required:true},
      {name:"reason",label:"Buyer source decision",required:true,multiline:true,wide:true});
    content.append(formCard("Decide original receipt intake",defs,"Save original source decision",async(values,form)=>{
      const saved=await save(form,"/api/refund-packets/"+packet.id+"/decision",values);
      if((saved.credit_ids||[saved.credit_id].filter(Boolean)).length===1){view.refundPacket=null;view.credit=saved.credit_id;}
      await redrawAfter("Original source decision and purchase binding retained.");
    },{intro:p?"Choose the exact existing payment or explicitly register the original purchase carried by this receipt. Every decision and returned transfer keeps its original source meaning.":"This receipt can be retained as reviewed source context. It creates no expense or credit without the original payment proof."}).card);
  }else{
    const ids=packet.credit_ids||[packet.credit_id].filter(Boolean);
    content.append(el("section",{class:"card"},el("h2",{},"Saved source decision"),
      facts([["Reviewer",packet.operator],["Decision time",packet.reviewed_at],["Reason",packet.reason]]),
      packet.item_id?button("Open original purchase",()=>navigate(()=>{view.tab="expenses";view.item=packet.item_id;}),"small"):null,
      ids.map((id,i)=>button("Open return "+(i+1),()=>navigate(()=>{view.credit=id;view.refundPacket=null;}),"small"))));
  }
}
async function renderCredit(){
  const credit=await api("/api/credits/"+view.credit), n=credit.native, item=credit.purchase_item;
  content.append(button("← Credits and returns",()=>navigate(()=>{view.credit=null;}),"small"));
  heading("Return allocation",credit.source_name+" · "+receiptReference(n)+" / return "+(n.refund_id||n.adjustment_id));
  content.append(el("section",{class:"card"},el("div",{class:"card-header"},el("h2",{},"Original buyer return"),badge(credit.status)),
    facts([["Operation context",credit.data_context],["Original purchase",unit(credit.purchase.amount,credit.purchase)],
      ["Verified native return",unit(n.amount,n)],["Source status / store amount",originalStoreAmount(n)+" · "+n.original_operation_status],
      ["Latest accepted receipt",credit.present_in_latest_receipt===false?"Absent; original verified return retained":"Present"],
      ["Latest native decision",credit.latest_source_status||n.original_operation_status],["Latest source eligibility",credit.latest_source_eligibility||"Original verified return retained"],
      ["Transfer time",n.transfer_at],["Original payment transaction",n.original_transaction],["Return transaction",n.transaction],
      ["Original packet digest",credit.manifest_sha256],["Purchase allocation state",item.status]]),
    el("div",{class:"actions"},button("Open original purchase",()=>navigate(()=>{view.tab="expenses";view.item=item.id;}),"small"),
      button("Review original packet",()=>navigate(()=>{view.refundPacket=credit.packet_id;view.credit=null;}),"small"))));
  const original=item.coding;
  if(!original||original.basis!==item.basis){
    content.append(el("section",{class:"card"},el("h2",{},"Review the original purchase allocation"),
      el("p",{},"Allocate the current original purchase before assigning its return. Each return must fit the original cost center, project and account dimensions."),
      button("Allocate original purchase",()=>navigate(()=>{view.tab="expenses";view.item=item.id;}),"primary")));return;
  }
  const dimensions=[];
  for(const line of original.allocations){
    const existing=dimensions.find(d=>d.center_id===line.center_id&&d.project===line.project&&d.account_code===line.account_code);
    if(existing)existing.amount=(BigInt(existing.amount)+BigInt(line.amount)).toString();else dimensions.push({...line});
  }
  const used=new Map();
  for(const other of credit.related_credits)for(const l of other.coding?.allocations||[]){
    const key=JSON.stringify([l.center_id,l.project,l.account_code]);used.set(key,(used.get(key)||0n)+BigInt(l.amount));
  }
  const centerName=id=>{const c=state.centers.find(c=>c.id===id);return c?c.code+" · "+c.name:id;};
  content.append(el("section",{class:"card"},el("h2",{},"Original allocation capacity"),
    table(["Cost center","Project / account","Original base units","Other allocated returns","Remaining"],dimensions.map(d=>{
      const u=used.get(JSON.stringify([d.center_id,d.project,d.account_code]))||0n;
      return [centerName(d.center_id),d.project+" / "+d.account_code,d.amount,u.toString(),(BigInt(d.amount)-u).toString()];
    })),
    credit.related_credits.length?el("details",{},el("summary",{},"Contributing original returns"),localTable(
      ["Adjustment","Native return","Recognition / coding edition"],credit.related_credits.map(c=>[
        el("span",{class:"code"},c.adjustment_id),c.amount,c.coding?c.coding.recognition_date+" / "+c.coding.id:"Uncoded"]))):null));
  const previous=credit.coding, rows=el("tbody"), total=el("p",{class:"allocation-total","aria-live":"polite"});
  const f=formCard("Allocate native return",[
    {name:"recognition_date",label:"Return recognition date",type:"date",value:previous?.recognition_date||"",required:true,
      help:"Choose its accounting date. The original reverse-transfer time remains a separate native source field."},
    {name:"operator",label:"Return allocation owner",value:previous?.operator||"",required:true},
    {name:"memo",label:"Return memo",value:previous?.memo||"",multiline:true,wide:true}
  ],"Save return allocation edition",async(values,form)=>{
    const allocations=[...rows.children].map(tr=>{
      const selected=tr.querySelector('[data-key="dimension"]').value;
      const index=selected===""?-1:Number(selected),d=dimensions[index];
      if(!d)throw new Error("Choose a current original purchase dimension for every return line.");
      return {center_id:d.center_id,project:d.project,account_code:d.account_code,
        amount:tr.querySelector('[data-key="amount"]').value,memo:tr.querySelector('[data-key="memo"]').value};
    });
    await save(form,"/api/credits/"+credit.id+"/coding",{...values,basis:credit.basis,allocations});
    await redrawAfter("Return allocation edition retained against the exact original purchase.");
  });
  function recompute(){
    let sum=0n,valid=true;for(const input of rows.querySelectorAll('[data-key="amount"]')){
      if(!/^(0|[1-9][0-9]*)$/.test(input.value)){valid=false;break;}sum+=BigInt(input.value);
    }total.textContent=(valid?sum.toString():"Invalid amount")+" / "+n.amount+" returned native base units";
  }
  function add(line={}){
    const tr=el("tr"), number=++serial;
    const selected=dimensions.findIndex(d=>d.center_id===line.center_id&&d.project===(line.project||"")&&d.account_code===(line.account_code||""));
    const choices=[{value:"",label:"Choose original allocation"},...dimensions.map((d,i)=>({value:String(i),label:centerName(d.center_id)+" / "+(d.project||"No project")+" / "+(d.account_code||"No account")}))];
    for(const def of [{name:"dimension",label:"Original allocation line "+number,choices,value:selected>=0?String(selected):line.center_id?"":dimensions.length===1?"0":""},
      {name:"amount",label:"Returned base units line "+number,value:line.amount??"0",inputmode:"numeric"},
      {name:"memo",label:"Return line memo "+number,value:line.memo||""}]){
      const part=field(def);part.input.dataset.key=def.name;tr.append(el("td",{},part.wrap));
    }
    tr.append(el("td",{},button("Remove",()=>{tr.remove();dirty.add(f.form);recompute();},"small")));
    rows.append(tr);tr.addEventListener("input",recompute);recompute();
  }
  for(const line of previous?.allocations||[{amount:n.amount}])add(line);
  const head=el("tr");for(const h of ["Original purchase dimension","Returned base units","Line memo",""])head.append(el("th",{},h));
  f.form.insertBefore(el("div",{class:"detail"},el("h3",{},"Return allocation lines"),
    el("div",{class:"table-wrap allocation-table"},el("table",{},el("thead",{},head),rows)),
    el("div",{class:"actions"},button("Add return allocation line",()=>{add();dirty.add(f.form);},"small")),total),f.actions);
  content.append(f.card);
  if(credit.coding_history.length)content.append(el("section",{class:"card"},el("h2",{},"Retained return allocation editions"),
    localTable(["Saved","Recognition","Owner","Edition"],credit.coding_history.map(c=>[c.created_at,c.recognition_date,c.operator,
      el("details",{},el("summary",{},c.id),el("pre",{class:"pre"},JSON.stringify(c,null,2)))]))));
}

async function renderActivity(){
  heading("Workspace activity","Saved source, coding and period actions remain in their original sequence.");
  const data=await api("/api/activity?offset="+view.activityOffset+"&limit=50");
  content.append(table(["Sequence","Saved","Action","Revision","Retained record"],data.items.map(e=>[e.sequence,e.created_at,e.action,e.detail.revision,el("span",{class:"code"},e.detail.record||"—")])),
    pager(data,x=>navigate(()=>{view.activityOffset=x;})));
}
document.querySelectorAll("nav button").forEach(b=>b.addEventListener("click",()=>navigate(()=>{view.tab=b.dataset.tab;}).catch(e=>notify(e.message,true))));
document.querySelector("#refresh").addEventListener("click",async()=>{try{await refreshState();if(dirty.size)notify("Current revision loaded. Your unsaved form remains intact.");else{await render();notify("Workspace refreshed.");}}catch(e){notify(e.message,true);}});
document.querySelector("#complete").addEventListener("click",async e=>{e.currentTarget.disabled=true;try{await download("/api/complete-project","buyer-expense-complete-project.zip");notify("Complete private project downloaded with included source and saved operator state.");}catch(e){notify(e.message,true);}finally{document.querySelector("#complete").disabled=false;}});
try {await refreshState();await render();}catch(e){content.replaceChildren(el("h1",{},"Open the private workspace URL"),el("p",{},e.message));}


async function renderNodeImport(){
  heading("Import original Node accounting","Retain one unchanged exportAccounting JSON, inspect its original outcome, then review the pending source capture. The ledger and producing operation stay with their original owner.");
  content.append(button("← Sources",()=>navigate(()=>{view.nodeImport=false;view.capture=null;}),"small"));
  const storageKey="sf36-node-intake:"+state.id, path="/api/node-operations";
  let pending=null,candidate=null,generation=0,accepted=false;
  try{pending=JSON.parse(sessionStorage.getItem(storageKey)||"null");}catch{}
  if(pending&&(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(pending.request_id??"")||
      !Number.isSafeInteger(pending.expected_revision)||typeof pending.payload!=="object"||!pending.payload))
    throw new Error("The browser's saved intake request is incomplete. Use the original request ID in Activity to recover its retained result.");
  const result=el("section",{class:"card","aria-live":"polite"}),pinned=pending?.payload||{};
  const definitions=[
    {name:"file",label:"Original accounting export JSON",type:"file",required:true,wide:true,help:"Select unchanged exportAccounting output, up to 16 MiB."},
    {name:"name",label:"Source name",value:pinned.name||"",required:true,maxlength:160},
    {name:"operator",label:"Intake owner",value:pinned.operator||"",required:true,maxlength:240},
    {name:"data_context",label:"Original operation context",value:pinned.data_context||state.data_context||"operational",
      choices:[{value:"operational",label:"Operational source"},{value:"development",label:"Controlled development operation"}]},
    {name:"provenance",label:"Original source provenance",value:pinned.provenance||"",required:true,multiline:true,wide:true,maxlength:6000,
      help:"Retain the original operator, operation and source reference. Hash validation checks retained bytes; it does not establish who produced them."}
  ];
  const f=formCard("Inspect original export",definitions,"Preview source and native outcome",async(values,form)=>{
    if(pending)throw new Error("Recover or retry the exact retained request before preparing another import.");
    const selected=f.fields.file.files[0],current=++generation;
    const payload=await selectedPayload(selected,values);
    const preview=await api(path+"/preview",{payload});
    if(!form.isConnected||current!==generation||f.fields.file.files[0]!==selected)return;
    candidate={payload,preview,revision:Number(form.dataset.revision)};
    result.replaceChildren(el("h2",{},"Original source review"),
      facts([["Original intent",preview.intent_id],["Accounting command",preview.command_id],["Native outcome",preview.outcome],
        ["Original file digest",preview.source_sha256],["Original bytes",preview.source_bytes],
        ["Existing source",preview.existing_source_id||"First retained source"],["Native authority",preview.record_authority],
        ["Previous exact-file capture",preview.previous_capture?preview.previous_capture.id+" · "+preview.previous_capture.status:"None"],
        ["Current accepted parent",preview.current_capture||"None"],["Reviewed intake action",preview.intake_behavior],
        ["Producing attempt",preview.attempt_created_at],["Observed response",preview.source_observed_at],
        ["Accounting completion",preview.accounting_completed_at],
        ["Settled actual",preview.row.settled_base_units??"Not established"],
        ["Network / asset",preview.row.network?preview.row.network+" / "+preview.row.asset:"No payment asset"]]),
      ...preview.notes.map(note=>el("p",{class:"quiet"},note)),
      button(preview.reuse_capture?"Reopen exact retained capture":"Retain pending source capture",submit,"primary"),
      el("p",{class:"quiet"},"A separate named source decision makes the capture current. Exact settled rows then use the existing allocation and period workflow."));
  });
  f.fields.file.accept=".json,application/json";
  f.form.addEventListener("input",()=>{if(!pending&&!accepted){generation++;candidate=null;result.replaceChildren(el("p",{},"Preview the current file and choices before retaining a capture."));}});
  content.append(f.card,result);
  function setPendingControls(){
    for(const [name,input]of Object.entries(f.fields))input.disabled=Boolean(pending||accepted)&&name!=="file";
    f.form.querySelector('button[type="submit"]').disabled=Boolean(pending||accepted);
  }
  async function selectedPayload(file,values){
    if(!file||!file.size||file.size>16_777_216)throw new Error("Choose the complete original Node export up to 16 MiB.");
    const bytes=new Uint8Array(await file.arrayBuffer()),sha=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(x=>x.toString(16).padStart(2,"0")).join("");
    let binary="";for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
    return {name:values.name,operator:values.operator,data_context:values.data_context,provenance:values.provenance,
      filename:file.name,source_sha256:sha,content_base64:btoa(binary)};
  }
  async function showAccepted(response){
    if(!response?.result?.capture?.id||response.result.capture.source?.kind!=="node_operation")
      throw new Error("The retained request did not return an original Node capture.");
    const captured=response.result.capture;
    if(pending&&(captured.source.source_sha256!==pending.payload.source_sha256||
        response.request_id!==pending.request_id))throw new Error("The retained response belongs to different original source bytes.");
    sessionStorage.removeItem(storageKey);pending=null;accepted=true;candidate=null;dirty.delete(f.form);setPendingControls();
    result.replaceChildren(el("h2",{},"Original capture retained"),facts([["Request",response.request_id],
      ["Source",response.result.source.id],["Capture",captured.id],["State",captured.status],
      ["Original file digest",captured.source.source_sha256]]),
      button("Open retained source review",async()=>{await refreshState();await navigate(()=>{
        view.nodeImport=false;view.source=response.result.source.id;view.capture=captured.id;view.captureOffset=0;});},"primary"),
      button("Download retained original file",()=>download("/api/captures/"+captured.id+"/node-original","original-node-accounting-export.json")),
      button("Import another original export",()=>navigate(()=>{})));
    try{await refreshState();}catch(e){result.append(el("p",{class:"quiet"},"The capture is saved. Current workspace refresh is unavailable: "+e.message));}
  }
  async function recover(quiet=false){
    if(!pending)return false;
    try{
      const record=await api("/api/requests/"+encodeURIComponent(pending.request_id));
      if(record.operation!==path)throw new Error("This request ID belongs to a different retained operation.");
      await showAccepted(record.response);return true;
    }catch(e){
      if(e.code==="REQUEST_NOT_COMMITTED"){if(!quiet)result.append(el("p",{},"No committed result is retained. Re-select the same original file to retry this exact request."));return false;}
      throw e;
    }
  }
  function pendingView(message="The exact request identity is retained. Recover its accepted response before retrying."){
    setPendingControls();
    result.replaceChildren(el("h2",{},"Retained intake request"),facts([["Request",pending.request_id],
      ["Expected revision",pending.expected_revision],["Original file digest",pending.payload.source_sha256],
      ["Original filename",pending.payload.filename]]),el("p",{},message),
      button("Recover saved request",()=>recover()),
      button("Retry exact original request",retry),
      button("Release an uncommitted request",async()=>{
        if(await recover(true))return;
        if(!confirm("The server has no committed result for this request. Release this draft so you can preview new choices?"))return;
        sessionStorage.removeItem(storageKey);pending=null;candidate=null;accepted=false;setPendingControls();
        result.replaceChildren(el("p",{},"Draft released. Your original file and fields are preserved; preview them again."));
      }));
  }
  async function transmit(payload){
    try{await showAccepted(await api(path,{...pending,payload}));}
    catch(e){
      if(accepted)throw e;
      pendingView(e.message+" The original request stays retained.");
      throw e;
    }
  }
  async function submit(){
    if(!candidate||pending||accepted)throw new Error("Preview the current source first.");
    const {content_base64,...metadata}=candidate.payload;
    const prepared={request_id:"node-intake-"+crypto.randomUUID(),expected_revision:candidate.revision,
      payload:{...metadata,preview_sha256:candidate.preview.preview_sha256}};
    // Keep the small exact metadata before submission. After reload the same file
    // supplies the unchanged bytes; an accepted result needs no local file.
    sessionStorage.setItem(storageKey,JSON.stringify(prepared));pending=prepared;
    dirty.add(f.form);pendingView();
    await transmit({...pending.payload,content_base64});
  }
  async function retry(){
    if(!pending)return;
    if(await recover(true))return;
    const file=f.fields.file.files[0],reconstructed=await selectedPayload(file,pending.payload);
    if(reconstructed.source_sha256!==pending.payload.source_sha256||reconstructed.filename!==pending.payload.filename)
      throw new Error("Retry requires the same original filename and exact bytes.");
    await transmit({...pending.payload,content_base64:reconstructed.content_base64});
  }
  if(pending){dirty.add(f.form);pendingView();}else result.append(el("p",{},"Select the original file and retain its operation provenance."));
  const lookup=formCard("Recover an earlier Node intake request",[
    {name:"request_id",label:"Original request ID",required:true,help:"Use the request saved before submission, or find the node_operation.capture entry in retained Activity."}
  ],"Read retained response",async(values)=>{
    const record=await api("/api/requests/"+encodeURIComponent(values.request_id));
    if(record.operation!==path)throw new Error("That request belongs to another operation.");
    if(pending&&pending.request_id!==values.request_id)throw new Error("Resolve this page's retained request before selecting another.");
    await showAccepted(record.response);
  });
  content.append(lookup.card);
}
