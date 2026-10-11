const content = document.querySelector("#content");
const noticeBox = document.querySelector("#notice");
const dirty = new Set();
let serial = 0;
const view = {tab:"expenses", item:null, source:null, capture:null, period:null, review:null, close:null, issue:null,
              periodEdit:false, setting:"centers", center:null, expensesOffset:0, captureOffset:0, sourceOffset:0,
              historyOffset:0, activityOffset:0, query:"", filterSource:"", filterStatus:""};
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
  document.querySelector("#revision").textContent="Revision "+state.revision;
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
  wrap.append(el("span",{},def.label));
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
  wrap.append(input);
  if(def.help)wrap.append(el("small",{},def.help));
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
  const raw=String(value);const label=labels.find(l=>l.network===row.network&&l.asset===row.asset);
  if(!label)return raw+" base units";
  const n=raw.padStart(label.decimals+1,"0");
  const shown=label.decimals?n.slice(0,-label.decimals)+"."+n.slice(-label.decimals):n;
  return raw+" base units · "+shown+" "+label.symbol;
}
function totalCards(report) {
  const host=el("div",{class:"cards"});
  for(const [title,rows] of [["Allocated settled actual",report.totals],["Outstanding reserved maximum",report.outstanding_totals]]){
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
  const status=field({name:"status",label:"Coding status",value:view.filterStatus,choices:["","UNCODED","CODED","STALE","RESERVED","ABSENT"].map(x=>({value:x,label:x||"All states"}))});
  const apply=()=>navigate(()=>{view.query=search.input.value;view.filterSource=source.input.value;view.filterStatus=status.input.value;view.expensesOffset=0;});
  bar.append(search.wrap,source.wrap,status.wrap,button("Apply filters",apply));
  search.input.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();apply().catch(e=>notify(e.message,true));}});
  content.append(bar);
  const data=await api("/api/expenses?"+new URLSearchParams({q:view.query,source:view.filterSource,status:view.filterStatus,offset:view.expensesOffset,limit:50}));
  content.append(table(["Original request / source","Service / native day","Network / asset","Settled actual","Reserved maximum","Coding",""],data.items.map(item=>{
    const r=item.row;return [el("div",{class:"long"},el("div",{class:"code"},r.request_id),el("div",{class:"quiet"},item.source_name)),
      el("div",{},r.service,el("div",{class:"quiet"},r.day)),el("div",{class:"code"},r.network,el("br"),r.asset),
      el("span",{class:"code"},r.settled_base_units),el("span",{class:"code"},r.reserved_base_units),badge(item.status),
      button("Open expense",()=>navigate(()=>{view.item=item.id;}),"small")];
  })),pager(data,x=>navigate(()=>{view.expensesOffset=x;})));
  if(!state.sources.length)content.append(el("div",{class:"card"},el("p",{},"Start by registering the original buyer ledger and reviewing its first capture."),button("Register source",()=>navigate(()=>{view.tab="sources";view.source=null;}),"primary")));
}
async function renderExpense(){
  const item=await api("/api/items/"+view.item), r=item.row;
  content.append(button("← Expense list",()=>navigate(()=>{view.item=null;}),"small"));
  heading("Expense allocation",item.source_name+" · "+r.request_id);
  const native=el("section",{class:"card"},el("div",{class:"card-header"},el("h2",{},"Original native row"),badge(item.status)),
    facts([["Service",r.service],["Network / asset",r.network+" / "+r.asset],["Native reservation day",r.day],["Settled actual",unit(r.settled_base_units,r)],
           ["Outstanding reservation",unit(r.reserved_base_units,r)],["Original authorized maximum",r.amount],["Receipt reference",r.receipt_ref||"No receipt reference"],
           ["Request digest",r.request_digest],["Proof digest",r.proof_sha256||"—"],["Accepted source capture",item.capture_id]]));
  content.append(native);
  if(item.missing||r.state!=="settled"){
    content.append(el("section",{class:"card"},el("h2",{},"Review this row in its period"),el("p",{},"This row is retained as an original reservation or source exception. Select its period to record an accountable carry-forward or exclusion decision."),
      button("Open period review",()=>navigate(()=>{view.tab="periods";}),"primary")));return;
  }
  const centers=state.centers.filter(c=>c.active);
  if(!centers.length){content.append(el("section",{class:"card"},el("p",{},"Create an active cost center before coding this expense."),button("Create cost center",()=>navigate(()=>{view.tab="settings";view.setting="centers";}),"primary")));return;}
  const previous=item.coding;
  const f=formCard("Allocate settled actual",[
    {name:"recognition_date",label:"Recognition date",type:"date",value:previous?.recognition_date||"",required:true,help:"Chosen by the operator; the native reservation day is retained separately."},
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
async function renderSources(){
  if(view.capture)return renderCapture();
  if(view.source&&!selectedSource())view.source=null;
  heading("Source captures","Register the original SF36 ledger by its local path. Captures use the maintained read-only statement reader and become current only after an explicit source review.");
  if(view.source){
    const source=selectedSource();
    content.append(button("← All sources",()=>navigate(()=>{view.source=null;}),"small"));
    content.append(el("section",{class:"card"},el("div",{class:"card-header"},el("h2",{},source.name),badge(source.pending.length+" pending")),
      facts([["Original ledger",source.path],["Source provenance",source.provenance||"—"],["Accepted capture",source.current_capture||"None"],
        ["Projection digest",source.projection_sha256||"—"],["Native rows / journal events",String(source.rows??0)+" / "+String(source.journal_events??0)],["Captured",source.capture_time||"—"]]),
      el("div",{class:"actions"},button("Capture original ledger",async()=>{if(!discard())return;const result=await mutate("/api/sources/"+source.id+"/capture");view.capture=result.id;view.captureOffset=0;await redrawAfter("New native capture is awaiting review.");},"primary"))));
    const data=await api("/api/sources/"+source.id+"/captures?offset="+view.sourceOffset+"&limit=20");
    content.append(el("section",{class:"card"},el("h2",{},"Capture history"),
      table(["Captured","State","Native rows","Changes",""],data.items.map(c=>[c.created_at,badge(c.status),c.source.reservations,c.change_count,
        button("Review capture",()=>navigate(()=>{view.capture=c.id;view.captureOffset=0;}),"small")])),
      pager(data,x=>navigate(()=>{view.sourceOffset=x;}),20)));
    content.append(formCard("Rebind moved original ledger",[
      {name:"path",label:"New original ledger path",value:source.path,wide:true,required:true},
      {name:"operator",label:"Source owner",required:true},
      {name:"reason",label:"Rebinding reason",multiline:true,required:true,wide:true}
    ],"Check continuity and capture",async(values,form)=>{const r=await save(form,"/api/sources/"+source.id+"/rebind",values);view.capture=r.capture.id;view.captureOffset=0;await redrawAfter("Original request identities matched; review the new capture.");},
      {intro:"Use the same original buyer ledger after moving it. The retained request identities are checked before the new locator is saved."}).card);
    return;
  }
  content.append(table(["Source","Original ledger","Accepted rows","Pending captures",""],state.sources.map(s=>[s.name,el("span",{class:"code"},s.path),String(s.rows??0),String(s.pending.length),
    button("Open source",()=>navigate(()=>{view.source=s.id;view.sourceOffset=0;}),"small")])));
  content.append(formCard("Register original buyer ledger",[
    {name:"name",label:"Source name",required:true},
    {name:"path",label:"Original SF36 SQLite path",required:true,wide:true,help:"Select the existing reservations.sqlite file in its original buyer workspace."},
    {name:"provenance",label:"Source provenance",multiline:true,wide:true,help:"Retain the original operator, operation and source references that explain this ledger."}
  ],"Capture source for review",async(values,form)=>{const r=await save(form,"/api/sources",values);view.source=r.id;view.capture=r.capture.id;view.captureOffset=0;await redrawAfter("Original source captured. Review the retained rows before accepting them.");}).card);
}
async function renderCapture(){
  const c=await api("/api/captures/"+view.capture+"?offset="+view.captureOffset+"&limit=20");
  content.append(button("← Source history",()=>navigate(()=>{view.capture=null;}),"small"));
  heading("Native capture review",c.id);
  content.append(el("section",{class:"card"},el("div",{class:"card-header"},el("h2",{},"Retained source edition"),badge(c.status)),
    facts([["Captured",c.captured_at],["Original rows",c.source.reservations],["Journal events / last sequence",String(c.source.journal_events)+" / "+String(c.source.last_sequence)],
      ["Projection digest",c.source.projection_sha256],["Changes","Added "+c.change_counts.ADDED+" · Changed "+c.change_counts.CHANGED+" · Absent "+c.change_counts.ABSENT]]),
    button("Download original capture",()=>download("/api/captures/"+c.id+"/original","native-statement-capture.json"),"small")));
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
  const issues=el("section",{class:"card"},el("h2",{},"Source and reservation review"));
  if(!report.issues.length)issues.append(el("p",{},"No source or coding exception remains in this period."));
  for(const issue of report.issues){
    const c=el("div",{class:"issue"},el("div",{class:"issue-head"},el("strong",{},issue.code.replaceAll("_"," ")),badge(issue.resolved?"REVIEWED":"OPEN")),
      issue.request_id?el("p",{class:"code"},issue.request_id):null,el("p",{},issue.description));
    if(issue.disposition)c.append(el("p",{class:"quiet"},issue.disposition.kind+" · "+issue.disposition.operator+": "+issue.disposition.reason));
    if(period.state==="OPEN"){
      if(issue.allowed_kinds.length)c.append(button(issue.resolved?"Revise decision":"Record decision",()=>navigate(()=>{view.issue=issue.code+"|"+issue.item_id;}),"small"));
      else c.append(button("Open source review",()=>navigate(()=>{view.tab="sources";view.source=issue.group.source_id;view.capture=null;}),"small"));
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
    localTable(["Request","Source","Native reservation day","Network / asset","Reserved base units","Capture status"],report.outstanding_reservations.map(r=>[el("span",{class:"code"},r.request_id),r.source_name,r.native_reservation_day,r.network+" / "+r.asset,r.amount,r.missing?"Absent from latest capture":"Present in accepted capture"]))));
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
      button("Download edition JSON",()=>download("/api/closes/"+doc.id,"accountant-edition-"+doc.sequence+".json")))));
  content.append(totalCards(doc));
  content.append(el("section",{class:"card"},el("h2",{},"Frozen allocation lines"),
    localTable(["Date","Cost center","Project / account","Network / asset","Exact base units","Original request"],doc.allocations.map(l=>[l.recognition_date,l.center_code+" · "+l.center_name,
      el("div",{},l.project||"—",el("div",{class:"code"},l.account_code||"—")),l.network+" / "+l.asset,l.amount,el("span",{class:"code"},l.request_id)]))));
  content.append(el("section",{class:"card"},el("h2",{},"Retained source captures"),
    table(["Source","Capture","Projection digest"],doc.source_captures.map(c=>[c.name,c.current_capture,el("span",{class:"code"},c.projection_sha256)]))));
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
