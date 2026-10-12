"use strict";

/* Staff billing workspace. Uses the original BI Operator records and actions. */
const billingPanes = ["periods", "sources", "policies", "statements"];
let billingSelection = {pane:"periods", agency:null, policy:null, period:null, offset:0, filter:"unallocated", query:"", agencyFilter:""};
try {
  const saved = JSON.parse(sessionStorage.getItem("commons-bi-billing-selection") || "null");
  if (saved && billingPanes.includes(saved.pane)) billingSelection = {...billingSelection, ...saved};
} catch (_) {}
const billingDrafts = {agency:new Map(), policy:new Map(), period:new Map()};
const billingEntities = new Map();
const billingCalculations = new Map();
let billingRenderGeneration = 0;
const billingImportFiles = {cost:null, usage:null};
const billingImportHeaders = {cost:"", usage:""};
let billingCurrent = {agency:null, policy:null, period:null};
let billingImportDraft = {
  cost:{label:"", period:"", basis:"actual", invoice_status:"provisional", invoice_id:"", allocation_view:"supplier", columns:"{}"},
  usage:{label:"", period:"", columns:"{}"}
};
const billingMatchFields = [
  ["resource_id","Exact resource ID"],["resource_prefix","Resource ID starts with"],
  ["resource_group","Resource group"],["subscription_id","Subscription ID"],
  ["service","Service"],["charge_type","Charge type"],["tag_key","Tag name"],["tag_value","Tag value"]
];

function billingRecords(kind) { return workspace[kind] || []; }
function billingRemember() {
  try { sessionStorage.setItem("commons-bi-billing-selection", JSON.stringify({...billingSelection,workspace_id:workspace.workspace_id})); } catch (_) {}
}
function billingButton(action, text, extra="", primary=false) {
  return '<button type="button" data-action="billing-'+action+'"'+(primary?' class="primary"':"")+" "+extra+">"+h(text)+"</button>";
}
function billingTable(headers, rows, caption) {
  return '<div class="table-wrap"><table class="billing-table"><caption class="billing-visually-hidden">'+h(caption||headers.join(", "))+'</caption><thead><tr>'+
    headers.map(x=>'<th scope="col">'+h(x)+'</th>').join("")+'</tr></thead><tbody>'+rows.join("")+'</tbody></table></div>';
}
function billingParagraph(text) { return '<p class="muted">'+h(text)+'</p>'; }
function billingField(text, id, initial="", type="text", extra="") { return input(text,id,initial,type,extra); }
function billingText(text,id,initial="",extra="") {
  return '<label>'+h(text)+'<textarea id="'+h(id)+'" '+extra+">"+h(initial)+"</textarea></label>";
}
function billingChoice(text,id,choices,selected,extra="") {
  return '<label>'+h(text)+'<select id="'+h(id)+'" '+extra+">"+choices.map(([key,title])=>'<option value="'+h(key)+'"'+(String(selected)===String(key)?' selected':"")+">"+h(title)+"</option>").join("")+"</select></label>";
}
function billingAgencyChoices(blank="Choose an agency…") {
  return [["",blank], ...billingRecords("billing_agency").map(r=>[r.id,r.payload.label+" · "+r.payload.code+(r.payload.active===false?" (inactive)":"")])];
}
function billingDecimal(value) {
  const text=String(value ?? "").trim();
  const match=/^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
  if(!match || !(match[2] || match[3]) || text.length>300) throw new Error("Enter a decimal amount without currency symbols, commas or exponent notation.");
  const fraction=match[3]||"";
  return {units:BigInt((match[1]==="-"?"-":"")+(match[2]||"0")+fraction), places:fraction.length};
}
function billingSum(values) {
  const parts=values.map(billingDecimal), places=parts.reduce((maximum,p)=>Math.max(maximum,p.places),0);
  const units=parts.reduce((sum,p)=>sum+p.units*10n**BigInt(places-p.places),0n);
  const negative=units<0n, digits=(negative?-units:units).toString().padStart(places+1,"0");
  return (negative?"-":"")+(places?digits.slice(0,-places)+"."+digits.slice(-places):digits);
}
function billingMoney(amount,currency="",places=2) {
  const text=String(amount ?? "0"), m=/^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if(!m) return (currency?currency+" ":"")+text;
  const grouped=m[2].replace(/\B(?=(\d{3})+(?!\d))/g,",");
  const fraction=(m[3]||"").padEnd(Math.min(8,Math.max(0,Number(places)||0)),"0");
  return (currency?currency+" ":"")+m[1]+grouped+(fraction?"."+fraction:"");
}
function billingMoneyCell(amount,currency,places) {
  return '<td class="num billing-money">'+h(billingMoney(amount,currency,places))+"</td>";
}
function billingRequired(text,message) { if(!String(text||"").trim()) throw new Error(message); return String(text).trim(); }
function billingMonth(text) {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) throw new Error("Choose the billing month in YYYY-MM format.");
  return text;
}
function billingMappedColumns(text) {
  let data;
  try { data=JSON.parse(text||"{}"); } catch (_) { throw new Error("Column mapping must be a JSON object."); }
  if(!data || Array.isArray(data) || typeof data!=="object" || Object.values(data).some(v=>typeof v!=="string" || !v.trim())) throw new Error("Map each field to an exact, nonempty CSV header.");
  return data;
}
async function billingEntity(kind,id,revision) {
  if(!id) return null;
  const summary=billingRecords(kind).find(r=>r.id===id);
  const selectedRevision=revision || summary?.revision;
  const key=workspace.workspace_id+":"+kind+":"+id+":"+selectedRevision;
  if(!billingEntities.has(key)) {
    const result=await entity(kind,id,selectedRevision);
    billingEntities.set(key,result);
    if(billingEntities.size>20) billingEntities.delete(billingEntities.keys().next().value);
  }
  return billingEntities.get(key);
}
async function billingCalculation(record) {
  const file=record?.payload?.calculation;
  if(!file?.digest) return null;
  if(!/^[a-f0-9]{64}$/.test(file.digest)) throw new Error("The saved calculation has an invalid file reference.");
  if(!billingCalculations.has(file.digest)) {
    const calculation=await request("/api/object/"+file.digest);
    if(!calculation || !Array.isArray(calculation.lines)) throw new Error("The saved calculation does not contain its line records.");
    billingCalculations.set(file.digest,calculation);
    if(billingCalculations.size>2) billingCalculations.delete(billingCalculations.keys().next().value);
  }
  return billingCalculations.get(file.digest);
}
function billingRefs(records) { return (records||[]).map(r=>typeof r==="string"?r:r.id); }
function billingDraft(kind,record) {
  const key=record?.id||"new";
  let draft=billingDrafts[kind].get(key);
  if(!draft || (!draft.dirty && draft.revision!==record?.revision)) {
    let data;
    if(kind==="agency") data=record?structuredClone(record.payload):{label:"",code:"",active:true,notes:""};
    if(kind==="policy") {
      data=record?structuredClone(record.payload):{label:"",notes:"",rules:[]};
      data.rules=(data.rules||[]).map(r=>({...r,_catchall:Object.keys(r.match||{}).length===0,_fallback:!!r.fallback_shares?.length}));
    }
    if(kind==="period") {
      const p=record?.payload;
      data=p?{label:p.label,period:p.period,policy_id:p.policy.id,policy_revision:p.policy.revision,
        cost_import_ids:billingRefs(p.cost_imports),usage_import_ids:billingRefs(p.usage_imports),
        adjustments:structuredClone(p.adjustments||[]),notes:p.notes||"",minor_units:p.minor_units,
        allow_duplicate_partitions:!!p.allow_duplicate_partitions,duplicate_partition_note:p.duplicate_partition_note||""}:
        {label:"",period:"",policy_id:"",policy_revision:1,cost_import_ids:[],usage_import_ids:[],adjustments:[],notes:"",minor_units:2,allow_duplicate_partitions:false,duplicate_partition_note:""};
    }
    draft={id:record?.id,revision:record?.revision,dirty:false,data};
    billingDrafts[kind].set(key,draft);
  }
  billingCurrent[kind]={record,draft};
  return draft;
}
function billingDraftNote(kind) {
  const current=billingCurrent[kind];
  if(!current) return "";
  const {record,draft}=current;
  const changed=record && draft.revision!==record.revision;
  return '<div class="billing-draft-note" data-billing-draft-note="'+kind+'">'+
    (changed?'<strong>A newer saved revision is available.</strong> Your edits still use revision '+h(draft.revision)+". ":
      draft.dirty?"Unsaved edits. ":"")+
    billingButton("reset-"+kind,record?"Load saved revision":"Clear new draft",'class="small"')+"</div>";
}
function billingSetDirty(kind) {
  const item=billingCurrent[kind]; if(!item) return;
  item.draft.dirty=true;
  const note=document.querySelector('[data-billing-draft-note="'+kind+'"]');
  if(note && !note.textContent.startsWith("A newer")) {
    const button=note.querySelector("button");
    note.replaceChildren(document.createTextNode("Unsaved edits. "));
    if(button) note.append(button);
  }
  if(kind==="period") document.querySelectorAll("[data-billing-requires-saved]").forEach(b=>b.disabled=true);
}
function billingReadAgency(mark=true) {
  const draft=billingCurrent.agency?.draft;
  if(!draft || !$("billing-agency-label")) return draft?.data;
  Object.assign(draft.data,{label:value("billing-agency-label"),code:value("billing-agency-code"),
    active:$("billing-agency-active").checked,notes:value("billing-agency-notes")});
  if(mark) billingSetDirty("agency");
  return draft.data;
}
function billingReadShares(index,group) {
  return Array.from(document.querySelectorAll('[data-billing-shares="'+index+":"+group+'"] .billing-share')).map(row=>({
    agency_id:row.querySelector(".billing-share-agency").value,weight:row.querySelector(".billing-share-weight").value
  }));
}
function billingReadPolicy(mark=true) {
  const draft=billingCurrent.policy?.draft;
  if(!draft || !$("billing-policy-label")) return draft?.data;
  const data=draft.data;
  data.label=value("billing-policy-label"); data.notes=value("billing-policy-notes");
  data.rules=data.rules.map((r,i)=>{
    const prefix="billing-rule-"+i+"-";
    if(!$(prefix+"label")) return r;
    const match={};
    for(const [key] of billingMatchFields) if(value(prefix+key).trim()) match[key]=value(prefix+key).trim();
    return {...r,label:value(prefix+"label"),method:value(prefix+"method"),match,
      agency_id:value(prefix+"agency"),usage_key:value(prefix+"usage-key"),metric:value(prefix+"metric"),
      shares:billingReadShares(i,"shares"),fallback_shares:billingReadShares(i,"fallback"),
      _catchall:$(prefix+"catchall").checked,_fallback:$(prefix+"fallback-enabled")?.checked||false};
  });
  if(mark) billingSetDirty("policy");
  return data;
}
function billingReadPeriod(mark=true) {
  const draft=billingCurrent.period?.draft;
  if(!draft || !$("billing-period-label")) return draft?.data;
  const data=draft.data;
  Object.assign(data,{label:value("billing-period-label"),period:value("billing-period-month"),
    policy_id:value("billing-period-policy"),policy_revision:Number(value("billing-period-policy-revision")),
    cost_import_ids:Array.from(document.querySelectorAll(".billing-cost-choice:checked")).map(x=>x.value),
    usage_import_ids:Array.from(document.querySelectorAll(".billing-usage-choice:checked")).map(x=>x.value),
    notes:value("billing-period-notes"),allow_duplicate_partitions:$("billing-duplicate-partitions").checked,
    duplicate_partition_note:value("billing-duplicate-note"),
    adjustments:Array.from(document.querySelectorAll(".billing-adjustment")).map(row=>({
      id:row.dataset.id,amount:row.querySelector(".billing-adjustment-amount").value,
      description:row.querySelector(".billing-adjustment-description").value,
      agency_id:row.querySelector(".billing-adjustment-agency").value,
      resource_id:row.querySelector(".billing-adjustment-resource").value,
      charge_type:row.querySelector(".billing-adjustment-type").value
    }))});
  if(mark) billingSetDirty("period");
  return data;
}
function billingReadImport(type) {
  const d=billingImportDraft[type],p="billing-"+type+"-";
  for(const key of Object.keys(d)) if($(p+key)) d[key]=value(p+key);
  return d;
}
function billingValidateShares(rows,title) {
  if(!Array.isArray(rows)||!rows.length) throw new Error(title+" needs an array with at least one agency and weight.");
  const seen=new Set();
  for(const row of rows) {
    if(!row||typeof row!=="object"||typeof row.agency_id!=="string"||typeof row.weight!=="string") throw new Error(title+" rows need an agency ID and a decimal weight written as a string.");
    billingRequired(row.agency_id,"Choose an agency for every "+title.toLowerCase()+" row.");
    if(seen.has(row.agency_id)) throw new Error("List each agency once in "+title.toLowerCase()+".");
    seen.add(row.agency_id);
    if(billingDecimal(row.weight).units<0n) throw new Error("Allocation weights must be nonnegative.");
  }
  if(billingDecimal(billingSum(rows.map(r=>r.weight))).units<=0n) throw new Error(title+" needs a positive total weight.");
}
function billingPolicyPayload(data) {
  billingRequired(data.label,"Name the allocation policy.");
  if(!Array.isArray(data.rules)||!data.rules.length) throw new Error("Add at least one allocation rule.");
  const ids=new Set();
  return {label:data.label.trim(),notes:data.notes||"",rules:data.rules.map((r,i)=>{
    if(!r||typeof r!=="object"||typeof r.id!=="string"||!r.id.trim()||ids.has(r.id)) throw new Error("Every rule needs its own stable ID.");
    ids.add(r.id);
    if(!r.match||typeof r.match!=="object"||Array.isArray(r.match)) throw new Error("Rule "+(i+1)+": supply a match object.");
    const match=r._catchall?{}:{...r.match};
    for(const [key,v] of Object.entries(match)) if(!billingMatchFields.some(([field])=>field===key)||typeof v!=="string"||!v.trim()) throw new Error("Rule "+(i+1)+": use a supported match field with a nonempty text value.");
    if(!r._catchall && !Object.keys(match).length) throw new Error("Rule "+(i+1)+": choose a resource match or explicitly apply it to every remaining resource.");
    if(!!match.tag_key!==!!match.tag_value) throw new Error("Rule "+(i+1)+": supply both the tag name and value.");
    const rule={id:r.id,label:r.label||"Rule "+(i+1),match,method:r.method};
    if(r.method==="direct") rule.agency_id=billingRequired(r.agency_id,"Rule "+(i+1)+": choose the receiving agency.");
    else if(r.method==="fixed") { billingValidateShares(r.shares||[],"Fixed allocation"); rule.shares=r.shares; }
    else if(r.method==="usage") {
      rule.metric=billingRequired(r.metric,"Rule "+(i+1)+": name the usage metric.");
      if(r.usage_key?.trim()) rule.usage_key=r.usage_key.trim();
      if(r._fallback) {billingValidateShares(r.fallback_shares||[],"Fallback allocation");rule.fallback_shares=r.fallback_shares;}
    } else throw new Error("Choose Direct, Fixed weights or Agency usage for every rule.");
    return rule;
  })};
}
function billingShares(r,index,group,visible) {
  const rows=r[group]||[];
  return '<div data-billing-shares="'+index+":"+group+'"'+(!visible?' hidden':"")+'><div class="billing-share-head"><span>Agency</span><span>Relative weight</span><span></span></div>'+
    rows.map((share,j)=>'<div class="billing-share"><label><span class="billing-visually-hidden">Agency for weight '+(j+1)+'</span><select class="billing-share-agency">'+
      billingAgencyChoices().map(([id,text])=>'<option value="'+h(id)+'"'+(id===share.agency_id?' selected':"")+">"+h(text)+"</option>").join("")+
      '</select></label><label><span class="billing-visually-hidden">Relative weight</span><input class="billing-share-weight" inputmode="decimal" value="'+h(share.weight)+'"></label>'+
      billingButton("share-remove","Remove",'class="small" data-index="'+index+'" data-group="'+group+'" data-row="'+j+'" aria-label="Remove allocation weight '+(j+1)+'"')+"</div>").join("")+
    billingButton("share-add","Add agency weight",'class="small" data-index="'+index+'" data-group="'+group+'"')+
    billingParagraph("Weights are relative. The saved calculation reconciles all allocations to the period’s currency precision.")+"</div>";
}
function billingRule(r,i,total) {
  const p="billing-rule-"+i+"-",method=r.method||"direct";
  return '<section class="billing-rule" data-rule-index="'+i+'"><div class="panel-head"><h3>Rule '+(i+1)+'</h3><div class="actions">'+
    billingButton("rule-up","Move up",'class="small" data-index="'+i+'"'+(i===0?" disabled":""))+
    billingButton("rule-down","Move down",'class="small" data-index="'+i+'"'+(i===total-1?" disabled":""))+
    billingButton("rule-remove","Remove rule",'class="small" data-index="'+i+'"')+'</div></div><div class="grid">'+
    billingField("Rule label",p+"label",r.label)+billingChoice("Allocation method",p+"method",[["direct","Direct to one agency"],["fixed","Fixed relative weights"],["usage","Agency usage"]],method,'data-billing-rerender="policy"')+
    '</div><label class="inline-check"><input type="checkbox" id="'+p+'catchall"'+(r._catchall?" checked":"")+' data-billing-rerender="policy">Apply to every remaining resource</label>'+
    (r._catchall&&i<total-1?billingParagraph("This catch-all is evaluated before the "+(total-i-1)+" rules below it."):"")+
    '<details'+(!r._catchall?' open':"")+'><summary>Match resource and charge fields</summary><fieldset'+(r._catchall?" disabled":"")+'><div class="grid three">'+
    billingMatchFields.map(([key,text])=>billingField(text,p+key,r.match?.[key]||"")).join("")+'</div></fieldset>'+
    billingParagraph("Filled fields are combined. Leave resource fields blank to match a charge type such as RoundingAdjustment, then choose an explicit shared allocation.")+"</details>"+
    '<div'+(method!=="direct"?" hidden":"")+'>'+billingChoice("Receiving agency",p+"agency",billingAgencyChoices(),r.agency_id||"")+"</div>"+
    billingShares({...r,shares:r.shares||[]},i,"shares",method==="fixed")+
    '<div'+(method!=="usage"?" hidden":"")+'><div class="grid">'+billingField("Shared usage key (blank uses each cost resource ID)",p+"usage-key",r.usage_key||"")+
    billingField("Usage metric",p+"metric",r.metric||"")+'</div><label class="inline-check"><input type="checkbox" id="'+p+'fallback-enabled"'+(r._fallback?" checked":"")+' data-billing-rerender="policy">Use explicit fixed weights when matching usage is absent</label>'+
    billingParagraph("A usage rule with no matching usage remains unallocated unless you enable and supply fallback weights.")+"</div>"+
    billingShares({...r,fallback:r.fallback_shares||[]},i,"fallback",method==="usage"&&r._fallback)+"</section>";
}
async function billingAgencies(generation) {
  const record=await billingEntity("billing_agency",billingSelection.agency);
  if(generation!==billingRenderGeneration)return "";
  const draft=billingDraft("agency",record),p=draft.data;
  return '<section class="panel" data-billing-form="agency"><div class="panel-head"><h2>Actual client agencies</h2>'+billingButton("agency-new","New agency")+'</div>'+
    billingParagraph("Use the payer and agency IDs from the client’s billing register. Agency names in report data do not create billing customers.")+
    '<div class="grid">'+billingField("Agency / payer name","billing-agency-label",p.label)+billingField("Client agency / payer code","billing-agency-code",p.code)+'</div>'+
    '<label class="inline-check"><input id="billing-agency-active" type="checkbox"'+(p.active!==false?" checked":"")+'>Active billing agency</label>'+
    billingText("Agency notes","billing-agency-notes",p.notes)+billingDraftNote("agency")+
    '<div class="actions">'+billingButton("agency-save",record?"Save agency revision":"Save agency","",true)+(record?historyButton(record):"")+'</div></section>'+
    '<section class="panel tight">'+(billingRecords("billing_agency").length?billingTable(["Agency","Client code","Agency ID for usage CSV","State",""],billingRecords("billing_agency").map(r=>
      '<tr><td><strong>'+h(r.payload.label)+'</strong></td><td>'+h(r.payload.code)+'</td><td><code class="billing-id">'+h(r.id)+'</code> '+
      billingButton("copy-id","Copy",'class="small" data-id="'+h(r.id)+'" aria-label="Copy agency ID for '+h(r.payload.label)+'"')+'</td><td>'+badge(r.payload.active===false?"Inactive":"Active")+
      '</td><td>'+billingButton("agency-open","Edit",'class="small" data-id="'+h(r.id)+'"')+"</td></tr>"),"Billing agencies"):empty("No billing agencies","Save the client’s actual agencies before allocating their costs."))+"</section>";
}
function billingImportCard(type) {
  const d=billingImportDraft[type],cost=type==="cost",p="billing-"+type+"-",file=billingImportFiles[type];
  return '<section class="panel" data-billing-form="'+type+'"><h2>'+h(cost?"Import native cost sources":"Import agency usage")+'</h2>'+
    billingParagraph(cost?"Retain an original Azure CSV or ZIP containing CSV exports. The allocation cost is before provider credits and taxes.":"Agency IDs must match the billing register above. A usage key identifies an exact resource or a named shared pool; the metric identifies the measured activity.")+
    '<div class="grid"><label>'+h(cost?"Native cost CSV or ZIP":"Agency usage CSV")+'<input id="'+p+'file" type="file" accept="'+(cost?".csv,.zip":".csv")+'" data-billing-file="'+type+'"></label>'+
    billingField("Import label",p+"label",d.label)+billingField("Billing month",p+"period",d.period,"month")+
    (cost?billingChoice("Cost basis",p+"basis",[["actual","Actual cost export"],["amortized","Amortized cost export"]],d.basis)+
      billingChoice("Source closure",p+"invoice_status",[["provisional","Provisional month"],["closed","Closed month"]],d.invoice_status)+
      billingField("Invoice / closing reference (optional)",p+"invoice_id",d.invoice_id)+
      billingChoice("Azure cost allocation view",p+"allocation_view",[["supplier","Supplier charges"],["allocated","Existing allocated view"]],d.allocation_view):"")+
    '</div>'+(cost?billingParagraph("Supplier charges excludes Microsoft’s internal CostAllocationRuleName balancing rows from allocation. Both views retain every original row. A billing period combines one basis, currency and allocation view."):"")+
    '<div class="billing-file-selection"><p id="'+p+'selection" class="muted">'+h(file?"Selected: "+file.name+" · "+file.size.toLocaleString()+" bytes":"Choose the original source file.")+'</p>'+
    billingButton("import-clear","Clear selected file",'class="small" data-type="'+type+'"'+(!file?' disabled':""))+'</div>'+
    '<div id="'+p+'headers" class="billing-headers" role="status" aria-live="polite">'+h(billingImportHeaders[type])+'</div>'+
    '<details><summary>Exact CSV header mapping</summary>'+billingParagraph(cost?
      "Native Azure aliases are recognized automatically. Optional fields: amount, currency, resource_id, resource_group, subscription_id, service, date, charge_type, tags, billing_period_start, cost_allocation_rule.":
      "Default headers: agency_id, usage_key, quantity, metric, source_id. Quantity is nonnegative; optional source_id links an existing source report.")+
    billingText("Field → original CSV header",p+"columns",d.columns,'class="code" spellcheck="false"')+'</details>'+
    billingButton("import-"+type,cost?"Retain cost source":"Retain agency usage","",true)+"</section>";
}
function billingImportsTable() {
  const records=billingRecords("billing_import");
  return '<section class="panel tight">'+(records.length?billingTable(["Retained source","Billing month","Coverage","Cost basis / view","Source allocation cost",""],records.map(r=>{
    const p=r.payload;
    return '<tr><td><strong>'+h(p.label)+'</strong><div class="muted">'+h(p.type==="cost"?"Cost source":"Agency usage")+' · '+h(p.file?.name||"")+'</div></td><td>'+h(p.period)+'</td><td>'+h(p.row_count)+' original rows'+
      (p.invoice_status?'<div class="muted">'+h(p.invoice_status)+"</div>":"")+
      ((p.warnings||[]).length?'<details><summary>'+p.warnings.length+' source notes</summary><ul>'+p.warnings.map(w=>'<li>'+h(typeof w==="string"?w:JSON.stringify(w))+"</li>").join("")+"</ul></details>":"")+
      '</td><td>'+h(p.basis||"Usage quantities")+'<div class="muted">'+h(p.allocation_view||"")+'</div></td>'+
      billingMoneyCell(p.total??"—",p.currency||"")+'<td><div class="actions">'+objectButton(p.file,"Original source")+inspectButton(r)+"</div></td></tr>";
  }),"Retained original cost and usage sources"):empty("No imported sources","Import the month’s original costs and the agency usage required by your allocation policy."))+"</section>";
}
async function billingSourcesView(generation) {
  const agencies=await billingAgencies(generation);
  if(generation!==billingRenderGeneration)return "";
  return agencies+'<div class="billing-import-grid">'+billingImportCard("cost")+billingImportCard("usage")+"</div>"+billingImportsTable();
}
async function billingPoliciesView(generation) {
  const record=await billingEntity("billing_policy",billingSelection.policy);
  if(generation!==billingRenderGeneration)return "";
  const draft=billingDraft("policy",record),p=draft.data;
  return '<section class="panel"><div class="panel-head"><h2>Allocation policies</h2>'+billingButton("policy-new","New policy")+'</div>'+
    billingParagraph("The first matching rule allocates each original cost line. Rule order, agency IDs, usage metrics and fallback weights are saved as a policy revision.")+
    (billingRecords("billing_policy").length?billingTable(["Policy","Revision","Rules",""],billingRecords("billing_policy").map(r=>
      '<tr><td>'+h(r.payload.label)+'</td><td>'+r.revision+'</td><td>'+(r.payload.rules||[]).length+'</td><td><div class="actions">'+
      billingButton("policy-open","Edit",'class="small" data-id="'+h(r.id)+'"')+historyButton(r)+"</div></td></tr>"),"Saved allocation policies"):"")+
    '</section><section class="panel" data-billing-form="policy"><div class="panel-head"><h2>'+h(record?"Edit policy revision":"New allocation policy")+'</h2>'+
    (record?billingButton("policy-copy","Copy as new policy"):"")+'</div>'+billingField("Policy name","billing-policy-label",p.label)+billingText("Allocation notes","billing-policy-notes",p.notes)+
    '<div class="billing-rules">'+p.rules.map((r,i)=>billingRule(r,i,p.rules.length)).join("")+"</div>"+
    '<div class="actions">'+billingButton("rule-add","Add allocation rule")+"</div>"+billingDraftNote("policy")+
    '<div class="actions">'+billingButton("policy-save",record?"Save policy revision":"Save allocation policy","",true)+(record?historyButton(record):"")+'</div>'+
    '<details><summary>Full policy JSON editor</summary>'+billingParagraph("Apply the JSON to the rule builder, review it, then save the policy. Agency and rule IDs retain their exact values.")+
    billingText("Policy JSON","billing-policy-json",draft.jsonDirty?draft.jsonText:JSON.stringify({label:p.label,notes:p.notes,rules:p.rules.map(r=>{
      const {_catchall,_fallback,...data}=r; if(_catchall)data.match={};if(!_fallback)delete data.fallback_shares;return data;
    })},null,2),'class="code" rows="14" spellcheck="false"')+'<div class="actions">'+billingButton("policy-json-apply","Apply JSON to builder")+billingButton("policy-json-reset","Use current builder JSON")+"</div></details></section>";
}
function billingImportChoices(type,draft) {
  const selected=draft[type==="cost"?"cost_import_ids":"usage_import_ids"];
  const rows=billingRecords("billing_import").filter(r=>r.payload.type===type&&(!draft.period||r.payload.period===draft.period||selected.includes(r.id)));
  return rows.length?'<div class="billing-import-choices">'+rows.map(r=>{
    const p=r.payload,chosen=selected.includes(r.id);
    return '<label class="billing-import-choice"><input type="checkbox" class="billing-'+type+'-choice" value="'+h(r.id)+'"'+(chosen?" checked":"")+'><span><strong>'+h(p.label)+'</strong><span class="muted">'+h(p.period)+' · '+h(p.row_count)+' rows'+
      (type==="cost"?" · "+h(billingMoney(p.total,p.currency))+" · "+h(p.basis)+" · "+h(p.allocation_view||"supplier")+" · "+h(p.invoice_status||""):"")+
      (draft.period&&p.period!==draft.period?" · DIFFERENT MONTH":"")+"</span></span></label>";
  }).join("")+"</div>":billingParagraph("No "+(type==="cost"?"cost sources":"agency usage")+" for this month. Import the original source in Agencies & sources.");
}
function billingAdjustment(a,index) {
  return '<div class="billing-adjustment" data-id="'+h(a.id)+'"><div class="billing-adjustment-heading"><strong>Correction '+(index+1)+'</strong>'+
    billingButton("adjustment-remove","Remove",'class="small" data-index="'+index+'"')+'</div><div class="grid">'+
    '<label>Signed adjustment amount<input class="billing-adjustment-amount" inputmode="decimal" value="'+h(a.amount||"")+'"></label>'+
    '<label>Correction description<input class="billing-adjustment-description" value="'+h(a.description||"")+'"></label>'+
    '<label>Agency (optional)<select class="billing-adjustment-agency">'+billingAgencyChoices("Allocate through the selected policy").map(([id,text])=>'<option value="'+h(id)+'"'+(id===a.agency_id?" selected":"")+">"+h(text)+"</option>").join("")+"</select></label>"+
    '<label>Resource ID (optional)<input class="billing-adjustment-resource" value="'+h(a.resource_id||"")+'"></label>'+
    '<label>Charge type (optional)<input class="billing-adjustment-type" value="'+h(a.charge_type||"")+'"></label></div></div>';
}
function billingPeriodForm(record,draft) {
  const p=draft.data,locked=record?.payload.status==="finalized";
  return '<section class="panel" data-billing-form="period"><div class="panel-head"><h2>'+h(record?"Period inputs and corrections":"Prepare a billing period")+'</h2>'+
    (record?historyButton(record):"")+'</div><fieldset'+(locked?" disabled":"")+'><div class="grid">'+
    billingField("Period label","billing-period-label",p.label)+billingField("Billing month","billing-period-month",p.period,"month",'data-billing-rerender="period"')+
    '<label>Allocation policy<select id="billing-period-policy" data-billing-policy-select>'+options(billingRecords("billing_policy"),p.policy_id)+'</select></label>'+
    billingField("Exact policy revision","billing-period-policy-revision",p.policy_revision,"number",'min="1" step="1"')+'</div>'+
    '<div class="grid"><section><h3>Cost imports</h3>'+billingImportChoices("cost",p)+'</section><section><h3>Agency usage imports</h3>'+billingImportChoices("usage",p)+'</section></div>'+
    '<details'+(p.allow_duplicate_partitions?" open":"")+'><summary>Advanced source coverage</summary>'+
    billingParagraph("If separate imports repeat exactly the same cost partition, document why both belong in this period before allowing the repetition. Distinct member names inside an original ZIP retain their own row identities.")+
    '<label class="inline-check"><input id="billing-duplicate-partitions" type="checkbox"'+(p.allow_duplicate_partitions?" checked":"")+'>Include an intentionally repeated partition from separate imports</label>'+
    billingText("Repeated-partition explanation","billing-duplicate-note",p.duplicate_partition_note||"")+'</details>'+
    '<details'+(p.adjustments.length?" open":"")+'><summary>Document corrections and adjustments ('+p.adjustments.length+')</summary>'+
    billingParagraph("Original source rows stay attached. A signed correction changes the allocation total; selecting an agency assigns it directly. Otherwise its resource and charge type use the selected policy.")+
    p.adjustments.map(billingAdjustment).join("")+billingButton("adjustment-add","Add correction")+'</details>'+
    billingText("Period scope and operating notes","billing-period-notes",p.notes)+billingDraftNote("period")+
    '<div class="actions">'+billingButton("period-prepare",record?"Save & recalculate":"Prepare allocation","",true)+"</div></fieldset>"+
    (locked?'<div class="billing-reopen">'+billingParagraph("This revision is finalized. Reopen the same period to record a correction and prepare a new reviewed revision.")+
      billingText("Reason for reopening","billing-reopen-reason",draft.reopenReason||"")+billingButton("period-reopen","Reopen for correction")+"</div>":"")+"</section>";
}
function billingLineUnallocated(line) {
  return Boolean(line.reason);
}
function billingAllocationCell(line,period) {
  const allocations=line.allocations||[];
  if(!allocations.length)return line.method==="zero-cost"?"Zero charge":"No agency allocation";
  const list='<ul class="billing-allocations">'+allocations.map(a=>{
    const agency=period.agencies.find(x=>x.id===a.agency_id)||billingRecords("billing_agency").find(x=>x.id===a.agency_id)?.payload;
    return '<li><span>'+h(agency?.label||a.agency_id)+'<small class="billing-allocation-weight">Relative weight '+h(a.weight??"—")+'</small></span><strong>'+h(billingMoney(a.amount,period.currency,period.minor_units))+"</strong></li>";
  }).join("")+"</ul>";
  if(allocations.length===1)return list;
  return '<details class="billing-allocation-details"><summary>'+allocations.length+' agencies · '+h(billingMoney(line.amount,period.currency,period.minor_units))+"</summary>"+list+"</details>";
}
function billingLines(record,calculation,policy) {
  if(!calculation) return empty("No saved calculation","Save and calculate the selected period.");
  const p=record.payload,query=billingSelection.query.toLowerCase();
  const rules=new Map((policy?.payload.rules||[]).map(r=>[r.id,r]));
  const filtered=calculation.lines.filter(line=>{
    const unresolved=billingLineUnallocated(line);
    if(billingSelection.filter==="unallocated"&&!unresolved)return false;
    if(billingSelection.filter==="allocated"&&unresolved)return false;
    if(billingSelection.agencyFilter&&!(line.allocations||[]).some(a=>a.agency_id===billingSelection.agencyFilter))return false;
    return !query||[line.id,line.source_file,line.source_row,line.resource_id,line.service,line.charge_type,line.description,line.rule_id,line.reason].some(v=>String(v??"").toLowerCase().includes(query));
  });
  const pageSize=25,offset=Math.min(Math.max(0,Number(billingSelection.offset)||0),Math.max(0,Math.ceil(filtered.length/pageSize)-1)*pageSize);
  billingSelection.offset=offset;
  const rows=filtered.slice(offset,offset+pageSize).map(line=>{
    const unresolved=billingLineUnallocated(line);
    return '<tr><td><strong>'+h(line.resource_id||"No resource ID")+'</strong><div class="muted">'+h(line.service||"")+" · "+h(line.charge_type||"")+'</div><div class="muted">'+h(line.description||"")+'</div>'+
      '<details><summary>Original source position</summary><p>'+h(line.source_file||"Adjustment")+' · row '+h(line.source_row??"—")+(line.source_line?' · file line '+h(line.source_line):'')+'</p><code>'+h(line.id)+'</code>'+
      (line.source_amount!==undefined?'<p>Original precision: '+h(line.source_amount)+" "+h(p.currency)+"</p>":"")+"</details></td>"+
      billingMoneyCell(line.amount,p.currency,p.minor_units)+'<td><strong>'+h(rules.get(line.rule_id)?.label||(line.method==='zero-cost'?'Zero-cost line':line.rule_id||'No matching rule'))+'</strong>'+(line.rule_id?'<div class="muted">'+h(line.rule_id)+'</div>':'')+'<div class="muted">'+h(line.method||'')+'</div></td><td>'+
      billingAllocationCell(line,p)+'</td><td>'+badge(unresolved?"Unallocated":"Allocated",unresolved)+
      '<p class="muted">'+h(line.reason||"")+'</p>'+billingButton("line-detail","Line details",'class="small" data-line="'+h(line.id)+'"')+"</td></tr>";
  });
  return '<div class="billing-line-filters"><div class="grid three">'+
    billingChoice("Show lines","billing-line-filter",[["unallocated","Unallocated lines"],["all","All source lines"],["allocated","Allocated lines"]],billingSelection.filter)+
    billingChoice("Agency allocation","billing-line-agency",[["","All agencies"],...p.agencies.map(a=>[a.id,a.label])],billingSelection.agencyFilter)+
    billingField("Find resource, source row, rule or text","billing-line-query",billingSelection.query)+'</div>'+
    '<div class="actions">'+billingButton("line-search","Apply filters")+billingButton("line-prev","Previous",'class="small"'+(offset===0?" disabled":""))+
    billingButton("line-next","Next",'class="small"'+(offset+pageSize>=filtered.length?" disabled":""))+
    '<span class="muted" role="status">'+(filtered.length?offset+1:0)+"–"+Math.min(offset+pageSize,filtered.length)+" of "+filtered.length+" matching lines</span></div></div>"+
    (rows.length?billingTable(["Resource / source","Allocation amount","Rule","Agency allocations","Review"],rows,"Complete saved calculation lines"):
      empty("No lines match this view",billingSelection.filter==="unallocated"?"There are no unresolved lines in this view. Choose All source lines to inspect the complete calculation.":"Change the filters to inspect other original rows."));
}
function billingExcludedRows(calculation) {
  const rows=calculation?.excluded_rows||[];
  if(!rows.length)return "";
  const pageSize=25,offset=Math.min(Math.max(0,Number(billingSelection.excludedOffset)||0),Math.max(0,Math.ceil(rows.length/pageSize)-1)*pageSize);
  billingSelection.excludedOffset=offset;
  return '<section class="panel"><h2>Retained Azure internal allocation rows</h2>'+
    billingParagraph(rows.length+" provider internal allocation rows are retained separately in this supplier-view calculation. Their original amounts are excluded from the agency allocation total.")+
    billingTable(["Original source position","Provider allocation rule","Original amount"],rows.slice(offset,offset+pageSize).map(row=>
      '<tr><td><strong>'+h(row.source_file)+'</strong><div class="muted">Data record '+h(row.source_row)+(row.source_line?' · file line '+h(row.source_line):'')+'</div><div class="muted">'+h(row.resource_id||row.description||'')+'</div></td>'+
      '<td>'+h(row.cost_allocation_rule||"Internal allocation")+'<div class="muted">'+h(row.excluded_reason||"")+'</div></td>'+billingMoneyCell(row.amount,row.currency)+"</tr>"),"Excluded internal allocation rows retained from the original source")+
    '<div class="actions billing-excluded-pages">'+billingButton("excluded-prev","Previous",'class="small"'+(offset===0?" disabled":""))+
    billingButton("excluded-next","Next",'class="small"'+(offset+pageSize>=rows.length?" disabled":""))+
    '<span class="muted" role="status">'+(offset+1)+"–"+Math.min(offset+pageSize,rows.length)+" of "+rows.length+" retained rows</span></div></section>";
}
function billingPeriodReview(record,calculation,policy) {
  const p=record.payload,t=p.totals,dirty=billingCurrent.period.draft.dirty;
  const disabled=dirty?' disabled':"";
  return '<section class="panel"><div class="panel-head"><h2>Saved allocation · '+h(p.period)+'</h2>'+badge(p.status,p.status==="finalized")+'</div>'+
    '<div class="billing-context"><span><strong>Currency</strong>'+h(p.currency)+'</span><span><strong>Cost basis</strong>'+h(p.basis)+'</span><span><strong>Azure view</strong>'+h(p.allocation_view||"supplier")+'</span><span><strong>Policy revision</strong>'+h(policy?.payload.label||p.policy.id)+' · r'+h(p.policy.revision)+'</span></div>'+
    billingParagraph("Source allocation cost is before provider credits and taxes. Original row precision contributes to the monthly total before deterministic currency rounding and agency reconciliation.")+
    billingTable(["Total component","Amount"],[["Source allocation cost",t.source],["Documented adjustments",t.adjustments],["Period allocation total",t.total],["Allocated to agencies",t.allocated],["Unallocated",t.unallocated]].map(([text,amount])=>'<tr><th scope="row">'+h(text)+"</th>"+billingMoneyCell(amount,p.currency,p.minor_units)+"</tr>"),"Exact period totals")+
    '<div class="billing-review-summary">'+h(p.row_count)+' source lines · '+h(p.unallocated_count)+' unallocated lines · '+h(p.agencies.length)+' receiving agencies</div>'+
    (p.review?'<div class="source-note"><strong>Review</strong><p>'+h(p.review.note||p.review.notes||"Recorded review")+'</p></div>':"")+
    (p.finalization?'<div class="source-note"><strong>Finalization</strong><p>'+h(p.finalization.note||p.finalization.notes||"Recorded finalization")+'</p></div>':"")+
    (p.correction_reason?'<div class="source-note"><strong>Correction reason</strong><p>'+h(p.correction_reason)+"</p></div>":"")+
    '<div class="actions">'+inspectButton(record)+objectButton(p.calculation,"Complete calculation JSON")+historyButton(record)+'</div></section>'+
    '<section class="panel"><h2>Agency allocation totals</h2>'+
    (p.agencies.length?billingTable(["Agency","Client code","Allocation amount","Lines"],p.agencies.map(a=>'<tr><td>'+h(a.label)+'</td><td>'+h(a.code)+'</td>'+billingMoneyCell(a.amount,p.currency,p.minor_units)+'<td class="num">'+h(a.line_count)+"</td></tr>"),"Per-agency exact allocation totals"):empty("No agency allocations","Resolve the unmatched resources and missing usage, then recalculate."))+'</section>'+
    '<section class="panel"><h2>Review and issue statements</h2>'+
    (p.unallocated_count>0?billingParagraph("Resolve the "+p.unallocated_count+" unallocated lines by correcting the policy or importing the required usage, then save and recalculate."):"")+
    (p.status!=="finalized"?billingText("Review / finalization note","billing-review-note",billingCurrent.period.draft.reviewNote||"")+'<div class="actions">'+
      billingButton("period-review",p.status==="reviewed"?"Update review":"Record review",'data-billing-requires-saved'+disabled,"draft"===p.status)+
      billingButton("period-finalize","Finalize this revision",'data-billing-requires-saved'+(dirty||p.status!=="reviewed"||p.unallocated_count>0?" disabled":""),p.status==="reviewed")+'</div>'+
      billingParagraph(dirty?"Save and recalculate your edits before reviewing the saved revision.":"Review the source coverage, rule choices, exact totals and agency allocations before finalization."):"")+
    '<div class="billing-export-actions">'+billingButton("period-export","Build statements, CSV & workbook",'data-billing-requires-saved'+(dirty||p.status!=="finalized"?" disabled":""),p.status==="finalized")+
    billingParagraph(p.status==="finalized"?"The finalized export retains agency statements, complete CSV and workbook results, the selected policy and original sources.":"Finalize the reviewed revision to build agency statements. The saved calculation and original source files are available above.")+"</div></section>"+
    '<section class="panel"><h2>Source lines and unresolved allocations</h2>'+billingLines(record,calculation,policy)+'</section>'+billingExcludedRows(calculation);
}
async function billingPeriodsView(generation) {
  const records=billingRecords("billing_period");
  if(billingSelection.period===null&&records.length)billingSelection.period=records[0].id;
  const record=await billingEntity("billing_period",billingSelection.period);
  if(generation!==billingRenderGeneration)return "";
  const [calculation,policy]=record?await Promise.all([billingCalculation(record),billingEntity("billing_policy",record.payload.policy.id,record.payload.policy.revision)]):[null,null];
  if(generation!==billingRenderGeneration)return "";
  const draft=billingDraft("period",record);
  return '<section class="panel"><div class="panel-head"><h2>Monthly agency billing</h2>'+billingButton("period-new","New billing period")+'</div>'+
    (records.length?billingTable(["Billing period","Cost basis","State","Allocation total","Unallocated",""],records.map(r=>{
      const p=r.payload;
      return '<tr'+(record?.id===r.id?' class="selected-row"':"")+'><td><strong>'+h(p.label)+'</strong><div class="muted">'+h(p.period)+" · r"+r.revision+'</div></td><td>'+h(p.basis)+'<div class="muted">'+h(p.allocation_view||"supplier")+'</div></td><td>'+badge(p.status)+'</td>'+
        billingMoneyCell(p.totals.total,p.currency,p.minor_units)+'<td>'+h(p.unallocated_count)+" lines</td><td>"+
        billingButton("period-open","Open",'class="small" data-id="'+h(r.id)+'"')+"</td></tr>";
    }),"Saved billing periods"):billingParagraph("Start with actual client agencies, original monthly costs and a reviewed allocation policy. Prepare the month here, resolve unallocated lines and issue its retained statements."))+"</section>"+
    billingPeriodForm(record,draft)+(record?billingPeriodReview(record,calculation,policy):"");
}
function billingFileList(files) {
  const values=Array.isArray(files)?files:Object.values(files||{});
  return values.filter(f=>f&&typeof f==="object"&&f.digest).map(f=>'<li><span>'+h(f.name||"Export file")+'</span>'+objectButton(f,"Download")+"</li>").join("");
}
async function billingStatementsView() {
  const records=billingRecords("billing_delivery");
  return '<section class="panel"><h2>Retained billing statements and workbooks</h2>'+
    billingParagraph("Each export belongs to its saved period revision. A corrected period creates a new export while the previous statements remain available in the original workspace and handoff.")+
    (records.length?records.map(r=>'<article class="billing-delivery"><div class="panel-head"><div><h3>'+h(r.payload.label)+'</h3><span class="muted">'+h(typeof r.payload.period==="string"?r.payload.period:"Period revision "+(r.payload.period?.revision??""))+'</span></div><div class="actions">'+
      objectButton(r.payload.archive,"Download complete billing ZIP")+inspectButton(r)+'</div></div>'+
      (typeof r.payload.files==="number"?'<p class="muted">'+h(r.payload.files)+' files in the complete billing archive.</p>':'<ul class="billing-export-files">'+billingFileList(r.payload.files)+'</ul>')+'</article>').join(""):
      empty("No statement exports yet","Open a prepared billing period and build its statements, CSV and workbook."))+"</section>";
}
async function billingView() {
  const generation=++billingRenderGeneration;
  if(billingSelection.workspace_id&&billingSelection.workspace_id!==workspace.workspace_id) {
    billingSelection={pane:"periods",agency:null,policy:null,period:null,offset:0,filter:"unallocated",query:"",agencyFilter:""};
    for(const drafts of Object.values(billingDrafts))drafts.clear();
    billingEntities.clear();billingCalculations.clear();billingCurrent={agency:null,policy:null,period:null};
    billingImportFiles.cost=null;billingImportFiles.usage=null;billingImportHeaders.cost="";billingImportHeaders.usage="";
  }
  billingSelection.workspace_id=workspace.workspace_id;
  for(const kind of ["agency","policy","period"]) if(billingSelection[kind]&&!billingRecords("billing_"+kind).some(r=>r.id===billingSelection[kind])) billingSelection[kind]=null;
  const records=billingRecords("billing_period");
  const nav=[["periods","Billing periods"],["sources","Agencies & sources"],["policies","Allocation policies"],["statements","Statements & exports"]];
  const content=await ({periods:billingPeriodsView,sources:billingSourcesView,policies:billingPoliciesView,statements:billingStatementsView}[billingSelection.pane]||billingPeriodsView)(generation);
  if(generation!==billingRenderGeneration)return "";
  billingRemember();
  return '<div class="billing-workspace"><nav class="billing-section-nav" aria-label="Agency billing workflow">'+nav.map(([key,text])=>
    billingButton("section",text,'data-pane="'+key+'"'+(key===billingSelection.pane?' aria-current="page"':""))).join("")+'</nav>'+
    '<div class="metrics">'+metric(billingRecords("billing_agency").filter(r=>r.payload.active!==false).length,"Active billing agencies")+
    metric(billingRecords("billing_import").length,"Retained source imports")+metric(records.filter(r=>r.payload.status!=="finalized").length,"Periods in review")+
    metric(billingRecords("billing_delivery").length,"Statement exports")+"</div>"+content+"</div>";
}
function billingOperationSaved(action,record,payload={}) {
  if(!record||!action.startsWith("billing."))return;
  const kind={billing_agency:"agency",billing_policy:"policy",billing_period:"period"}[record.kind];
  if(kind) {
    billingDrafts[kind].delete(payload.id||"new");
    billingSelection[kind]=record.id;
    billingCurrent[kind]=null;
    billingEntities.set(workspace.workspace_id+":"+record.kind+":"+record.id+":"+record.revision,record);
    if(billingEntities.size>20)billingEntities.delete(billingEntities.keys().next().value);
    if(kind==="period") {
      billingSelection.offset=0;billingSelection.excludedOffset=0;
      billingSelection.filter=record.payload.unallocated_count?"unallocated":"all";
    }
  }
  if(record.kind==="billing_import") {
    const type=record.payload.type;
    if(type==="cost"||type==="usage") {
      if(!billingImportFiles[type]||billingImportFiles[type].name===payload.filename) {
        billingImportFiles[type]=null;billingImportHeaders[type]="";
      }
      if(!billingImportDraft[type].label||billingImportDraft[type].label===payload.label)billingImportDraft[type].label="";
    }
  }
  if(action==="billing.period.export"&&record.kind==="billing_delivery")billingSelection.pane="statements";
}
async function billingSaved(kind,action,body) {
  const record=await act(action,body);
  billingOperationSaved(action,record,body);
  await render();
  return record;
}
function billingMutationRecord() {
  const current=billingCurrent.period;
  if(!current?.record) throw new Error("Prepare and save the billing period first.");
  if(current.draft.dirty) throw new Error("Save and recalculate your edits before using this saved period revision.");
  return current.record;
}
async function billingAction(action,button) {
  const name=action.slice("billing-".length),id=button.dataset.id,index=Number(button.dataset.index);
  if(name==="section"){billingSelection.pane=button.dataset.pane;await render();return;}
  for(const kind of ["agency","policy","period"]) {
    if(name===kind+"-new"){billingSelection[kind]="";billingCurrent[kind]=null;await render();return;}
    if(name===kind+"-open"){billingSelection[kind]=id;billingCurrent[kind]=null;if(kind==="period"){billingSelection.offset=0;billingSelection.excludedOffset=0;billingSelection.query="";billingSelection.agencyFilter="";}await render();return;}
    if(name==="reset-"+kind){billingDrafts[kind].delete(billingCurrent[kind]?.draft.id||"new");await render();return;}
  }
  if(name==="copy-id"){
    try {await navigator.clipboard.writeText(id);notify("Agency ID copied.");}
    catch (_) {
      const code=button.closest("td")?.querySelector("code");
      if(code){const range=document.createRange();range.selectNodeContents(code);const selected=window.getSelection();selected.removeAllRanges();selected.addRange(range);}
      notify("Agency ID selected. Use your browser’s Copy command.");
    }
    return;
  }
  if(name==="import-clear") {
    const type=button.dataset.type;
    billingImportFiles[type]=null;billingImportHeaders[type]="";
    $("billing-"+type+"-file").value="";$("billing-"+type+"-headers").textContent="";
    $("billing-"+type+"-selection").textContent="Choose the original source file.";button.disabled=true;return;
  }
  if(name==="agency-save") {
    const data=billingReadAgency(false),d=billingCurrent.agency.draft;
    billingRequired(data.label,"Enter the actual agency / payer name.");billingRequired(data.code,"Enter the client agency / payer code.");
    return billingSaved("agency","billing.agency.save",{...data,...(d.id?{id:d.id,expected:d.revision}:{})});
  }
  if(name==="import-cost"||name==="import-usage") {
    const type=name.slice(7),d={...billingReadImport(type)},file=$("billing-"+type+"-file").files[0]||billingImportFiles[type];
    billingMonth(d.period);const columns=billingMappedColumns(d.columns);
    const record=await act(type==="cost"?"billing.cost.import":"billing.usage.import",{
      ...await filePayload(file),...d,columns,label:d.label.trim()||file.name
    });
    billingImportDraft[type].label="";billingImportFiles[type]=null;billingImportHeaders[type]="";await render();notify("Retained "+record.payload.row_count+" original "+type+" rows. "+label(record));return;
  }
  if(name.startsWith("rule-")||name.startsWith("share-")||name==="policy-copy") {
    const p=billingReadPolicy(false);
    if(name==="rule-add")p.rules.push({id:crypto.randomUUID(),label:"",match:{},method:"direct",agency_id:"",shares:[],fallback_shares:[],usage_key:"",metric:"",_catchall:false,_fallback:false});
    if(name==="rule-remove")p.rules.splice(index,1);
    if(name==="rule-up"&&index>0)[p.rules[index-1],p.rules[index]]=[p.rules[index],p.rules[index-1]];
    if(name==="rule-down"&&index<p.rules.length-1)[p.rules[index+1],p.rules[index]]=[p.rules[index],p.rules[index+1]];
    if(name==="share-add"||name==="share-remove") {
      const group=button.dataset.group==="fallback"?"fallback_shares":"shares",rows=p.rules[index][group]||(p.rules[index][group]=[]);
      if(name==="share-add")rows.push({agency_id:"",weight:"1"});else rows.splice(Number(button.dataset.row),1);
    }
    if(name==="policy-copy"){billingSelection.policy="";billingDrafts.policy.set("new",{id:undefined,revision:undefined,dirty:true,data:{...structuredClone(p),label:p.label+" copy"}});}
    else billingSetDirty("policy");
    await render();return;
  }
  if(name==="policy-json-reset"){billingCurrent.policy.draft.jsonDirty=false;delete billingCurrent.policy.draft.jsonText;await render();return;}
  if(name==="policy-json-apply") {
    let data;try{data=JSON.parse(value("billing-policy-json"));}catch(_){throw new Error("The policy editor needs valid JSON.");}
    if(!data||typeof data!=="object"||!Array.isArray(data.rules))throw new Error("Policy JSON must contain label, notes and a rules array.");
    data={label:String(data.label||""),notes:String(data.notes||""),rules:data.rules.map(r=>{
      if(!r||typeof r!=="object"||!r.match||typeof r.match!=="object"||Array.isArray(r.match))throw new Error("Each rule needs an ID, match object and allocation method.");
      return {...r,_catchall:Object.keys(r.match).length===0,_fallback:!!r.fallback_shares?.length,shares:r.shares||[],fallback_shares:r.fallback_shares||[]};
    })};
    billingPolicyPayload(data);billingCurrent.policy.draft.data=data;billingCurrent.policy.draft.jsonDirty=false;delete billingCurrent.policy.draft.jsonText;billingSetDirty("policy");await render();return;
  }
  if(name==="policy-save") {
    if(billingCurrent.policy.draft.jsonDirty)throw new Error("Apply the edited policy JSON to the builder, or choose Use current builder JSON, before saving.");
    const p=billingPolicyPayload(billingReadPolicy(false)),d=billingCurrent.policy.draft;
    return billingSaved("policy","billing.policy.save",{...p,...(d.id?{id:d.id,expected:d.revision}:{})});
  }
  if(name==="adjustment-add"||name==="adjustment-remove") {
    const p=billingReadPeriod(false);
    if(name==="adjustment-add")p.adjustments.push({id:crypto.randomUUID(),amount:"",description:"",agency_id:"",resource_id:"",charge_type:""});
    else p.adjustments.splice(index,1);
    billingSetDirty("period");await render();return;
  }
  if(name==="period-prepare") {
    const p=structuredClone(billingReadPeriod(false)),d=billingCurrent.period.draft;
    billingRequired(p.label,"Name the billing period.");billingMonth(p.period);billingRequired(p.policy_id,"Select an allocation policy.");
    if(!Number.isSafeInteger(p.policy_revision)||p.policy_revision<1)throw new Error("Choose the exact saved policy revision.");
    if(!p.cost_import_ids.length)throw new Error("Select the period’s original cost import.");
    if(p.allow_duplicate_partitions)billingRequired(p.duplicate_partition_note,"Explain why repeated cost partitions from separate imports belong in this period.");
    for(const importId of [...p.cost_import_ids,...p.usage_import_ids]) {
      const original=billingRecords("billing_import").find(r=>r.id===importId);
      if(!original||original.payload.period!==p.period)throw new Error("Every selected source must belong to "+p.period+".");
    }
    p.adjustments=p.adjustments.map(a=>{
      billingDecimal(a.amount);billingRequired(a.description,"Describe every adjustment.");
      return Object.fromEntries(Object.entries(a).filter(([key,v])=>!["agency_id","resource_id","charge_type"].includes(key)||String(v).trim()));
    });
    return billingSaved("period","billing.period.prepare",{...p,...(d.id?{id:d.id,expected:d.revision}:{})});
  }
  if(name==="period-review"||name==="period-finalize") {
    const record=billingMutationRecord(),note=billingRequired(value("billing-review-note"),"Enter the review or finalization note.");
    return billingSaved("period",name==="period-review"?"billing.period.review":"billing.period.finalize",{id:record.id,expected:record.revision,note});
  }
  if(name==="period-reopen") {
    const record=billingCurrent.period?.record;
    if(!record)throw new Error("Select the finalized period.");
    const reason=billingRequired(value("billing-reopen-reason"),"Record why this finalized period is being corrected.");
    return billingSaved("period","billing.period.reopen",{id:record.id,expected:record.revision,reason});
  }
  if(name==="period-export") {
    const record=billingMutationRecord();
    if(record.payload.status!=="finalized")throw new Error("Finalize the reviewed billing revision before building agency statements.");
    await act("billing.period.export",{id:record.id,revision:record.revision});
    billingSelection.pane="statements";await render();return;
  }
  if(name==="excluded-prev"||name==="excluded-next") {
    billingReadPeriod(false);
    billingSelection.excludedOffset=Math.max(0,(Number(billingSelection.excludedOffset)||0)+(name==="excluded-next"?25:-25));
    await render();return;
  }
  if(name==="line-search"||name==="line-prev"||name==="line-next") {
    billingReadPeriod(false);
    billingSelection.filter=value("billing-line-filter");billingSelection.agencyFilter=value("billing-line-agency");billingSelection.query=value("billing-line-query").trim();
    billingSelection.offset=name==="line-search"?0:Math.max(0,billingSelection.offset+(name==="line-next"?25:-25));
    await render();return;
  }
  if(name==="line-detail") {
    const calculation=await billingCalculation(billingCurrent.period.record),line=calculation.lines.find(x=>x.id===button.dataset.line);
    if(!line)throw new Error("This source line is no longer in the selected calculation.");
    $("inspect-title").textContent="Original allocation line";
    $("inspect-content").textContent=JSON.stringify(line,null,2);$("inspector").showModal();return;
  }
  throw new Error("Unknown billing action.");
}
function billingCSVHeader(text,complete=true) {
  text=text.replace(/^\uFEFF/,"");
  const fields=[];let value="",quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') { if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted; }
    else if(c===","&&!quoted){fields.push(value);value="";}
    else if((c==="\n"||c==="\r")&&!quoted){fields.push(value);return fields;}
    else value+=c;
  }
  return quoted||!complete?null:[...fields,value];
}
async function billingPreviewHeaders(type,file) {
  const target=$("billing-"+type+"-headers");if(!target)return;
  target.textContent="";billingImportHeaders[type]="";
  const selected=$("billing-"+type+"-selection"),clear=document.querySelector('[data-action="billing-import-clear"][data-type="'+type+'"]');
  if(selected)selected.textContent=file?"Selected: "+file.name+" · "+file.size.toLocaleString()+" bytes":"Choose the original source file.";
  if(clear)clear.disabled=!file;
  if(!file)return;
  if(/\.zip$/i.test(file.name)) {
    billingImportHeaders[type]="ZIP selected. Native mappings apply to each contained CSV; the import retains the original archive.";
    target.textContent=billingImportHeaders[type];return;
  }
  const text=await file.slice(0,65536).text();
  if(billingImportFiles[type]!==file)return;
  const headers=billingCSVHeader(text,file.size<=65536);
  billingImportHeaders[type]=headers?"Original CSV headers: "+headers.join(" · "):"The header continues past this preview. Use the original file’s exact header names in the mapping.";
  const current=$("billing-"+type+"-headers");if(current)current.textContent=billingImportHeaders[type];
}
document.addEventListener("input",event=>{
  const target=event.target,kind=target.closest("[data-billing-form]")?.dataset.billingForm;
  if(target.id==="billing-review-note"&&billingCurrent.period)billingCurrent.period.draft.reviewNote=target.value;
  if(target.id==="billing-reopen-reason"&&billingCurrent.period)billingCurrent.period.draft.reopenReason=target.value;
  if(kind==="policy"&&target.id==="billing-policy-json") {
    billingCurrent.policy.draft.jsonText=target.value;billingCurrent.policy.draft.jsonDirty=true;billingSetDirty("policy");
  }
  if(kind==="agency")billingReadAgency();
  if(kind==="policy"&&event.target.id!=="billing-policy-json")billingReadPolicy();
  if(kind==="period")billingReadPeriod();
  if(kind==="cost"||kind==="usage")billingReadImport(kind);
});
document.addEventListener("change",event=>{
  const target=event.target,kind=target.closest("[data-billing-form]")?.dataset.billingForm;
  if(kind==="agency")billingReadAgency();
  if(kind==="policy"&&target.id!=="billing-policy-json")billingReadPolicy();
  if(kind==="period")billingReadPeriod();
  if(target.dataset.billingFile){billingImportFiles[target.dataset.billingFile]=target.files[0]||null;run(()=>billingPreviewHeaders(target.dataset.billingFile,target.files[0]));}
  if(target.hasAttribute("data-billing-policy-select"))run(async()=>{
    const draft=billingCurrent.period.draft;
    draft.data.policy_revision=billingRecords("billing_policy").find(r=>r.id===target.value)?.revision||1;
    await render();
  });
  else if(target.dataset.billingRerender)run(render);
});
