"use strict";

/* Tourism operations use the original workspace action, version and download APIs. */
const tourismPanes=["reports","sources","funds","plans"];
const tourismFields={
 collections:["period","amount","jurisdiction","basis","source_ref"],
 distributions:["start","end","amount","jurisdiction","basis","source_ref"],
 cash:["entry_id","date","direction","amount","fund","category","program","counterparty","original_entry_id","source_ref","note"],
 budgets:["budget_id","year","status","jurisdiction","opening_cash","operating_reserve","tgt_income","other_income","personnel","sales_marketing","administration","reported_resources","reported_available","reported_expenditures","reported_closing","source_ref"],
 lodging:["period","provider","market","occupancy_pct","adr","available_rooms","source_ref"],
 demand:["event_id","period","label","room_nights","basis","source_ref"]
};
let tourismSelection={pane:"reports",source:null,fund:null,plan:null,period:null,table:"collections",offset:0,cashOffset:0};
try{const saved=JSON.parse(sessionStorage.getItem("commons-bi-tourism-selection")||"null");if(saved&&tourismPanes.includes(saved.pane))tourismSelection={...tourismSelection,...saved};}catch(_){}
let tourismWorkspaceId=null;
const tourismDrafts=new Map(),tourismRecordsCache=new Map(),tourismReportsCache=new Map(),tourismReviewDrafts=new Map();
let tourismCurrent={fund:null,plan:null,source:null,period:null,report:null};
const tourismImport={file:null,headers:[],headerNote:"",data:{label:"",currency:"USD",minor_unit:2,table:"collections",source_url:"",parent:"",correction_note:"",mapping:{},defaults:{}}};

function tourismRecords(kind){return workspace[kind]||[];}
function tourismRemember(){try{sessionStorage.setItem("commons-bi-tourism-selection",JSON.stringify({...tourismSelection,workspace_id:workspace.workspace_id}));}catch(_){}}
function tourismButton(action,title,attrs="",primary=false){return '<button type="button" data-action="tourism-'+action+'"'+(primary?' class="primary"':"")+" "+attrs+">"+h(title)+"</button>";}
function tourismText(title,id,initial="",attrs=""){return '<label>'+h(title)+'<textarea id="'+h(id)+'" '+attrs+">"+h(initial)+"</textarea></label>";}
function tourismSelect(title,id,choices,selected,attrs=""){return '<label>'+h(title)+'<select id="'+h(id)+'" '+attrs+">"+choices.map(([key,title])=>'<option value="'+h(key)+'"'+(String(key)===String(selected)?' selected':"")+">"+h(title)+"</option>").join("")+"</select></label>";}
function tourismParagraph(text){return '<p class="muted">'+h(text)+"</p>";}
function tourismReferenceKey(reference){return reference?reference.id+"~"+reference.revision:"";}
function tourismParseReference(raw,kind){if(!raw)return null;const i=raw.lastIndexOf("~");if(i<1)throw new Error("Select an original saved edition.");return {kind,id:raw.slice(0,i),revision:Number(raw.slice(i+1))};}
function tourismChoices(kind,pinned,blank="Choose…"){
 const records=tourismRecords(kind),choices=[["",blank],...records.map(r=>[tourismReferenceKey(ref(r)),label(r)+" · r"+r.revision])];
 if(pinned&&!records.some(r=>r.id===pinned.id&&r.revision===pinned.revision)){const current=records.find(r=>r.id===pinned.id);choices.push([tourismReferenceKey(pinned),(current?label(current):pinned.id)+" · retained r"+pinned.revision]);}
 return choices;
}
function tourismDecimalMinor(number,places=2){
 if(number==null)return "";
 let n=BigInt(number),sign=n<0n?"-":"";if(n<0n)n=-n;
 const digits=n.toString().padStart(places+1,"0");return sign+(places?digits.slice(0,-places)+"."+digits.slice(-places):digits);
}
function tourismMoney(number,currency="USD",places=2){
 if(number==null)return "—";
 const raw=tourismDecimalMinor(number,places),parts=raw.split(".");parts[0]=parts[0].replace(/\B(?=(\d{3})+(?!\d))/g,",");
 return (currency?currency+" ":"")+parts.join(".");
}
function tourismMoneyCell(number,currency,places){return '<td class="num">'+h(tourismMoney(number,currency,places))+"</td>";}
function tourismSourceLink(url,title){try{const parsed=new URL(url);if(["http:","https:"].includes(parsed.protocol))return '<a href="'+h(parsed.href)+'" target="_blank" rel="noopener noreferrer">'+h(title||url)+"</a>";}catch(_){}return h(title||url);}
async function tourismEntity(kind,id,revision){
 const key=[kind,id,revision||"current"].join(":");if(!tourismRecordsCache.has(key))tourismRecordsCache.set(key,await entity(kind,id,revision));return tourismRecordsCache.get(key);
}
async function tourismReport(record){
 const key=record.payload.report.digest;if(!tourismReportsCache.has(key))tourismReportsCache.set(key,await request("/api/tourism/preview?"+new URLSearchParams({kind:record.kind,id:record.id,revision:record.revision})));
 return tourismReportsCache.get(key);
}
function tourismResetWorkspace(){
 if(tourismWorkspaceId===workspace.workspace_id)return;
 if(tourismWorkspaceId){tourismDrafts.clear();tourismRecordsCache.clear();tourismReportsCache.clear();tourismReviewDrafts.clear();tourismSelection={pane:"reports",source:null,fund:null,plan:null,period:null,table:"collections",offset:0,cashOffset:0};}
 tourismWorkspaceId=workspace.workspace_id;
}
function tourismOperationSaved(action,record){
 for(const key of tourismRecordsCache.keys())if(key.startsWith(record.kind+":"+record.id+":"))tourismRecordsCache.delete(key);
 if(record.kind==="tourism_source"){tourismSelection.source=record.id;tourismSelection.pane="sources";tourismSelection.offset=0;}
 if(record.kind==="tourism_fund"){tourismSelection.fund=record.id;tourismSelection.pane="funds";tourismDrafts.delete("fund:"+record.id);tourismDrafts.delete("fund:new");}
 if(record.kind==="tourism_plan"){tourismSelection.plan=record.id;tourismSelection.pane="plans";tourismDrafts.delete("plan:"+record.id);tourismDrafts.delete("plan:new");}
 if(record.kind==="tourism_period"){tourismSelection.period=record.id;tourismSelection.pane="reports";}
 if(record.kind==="tourism_export"){tourismSelection.period=record.payload.period.id;tourismSelection.pane="reports";}
 tourismRemember();
}
async function tourismDraft(kind,selected=tourismSelection){
 const id=selected[kind],key=kind+":"+(id||"new");
 if(tourismDrafts.has(key))return tourismDrafts.get(key);
 const record=id?await tourismEntity("tourism_"+kind,id,tourismRecords("tourism_"+kind).find(r=>r.id===id)?.revision):null;
 let data;
 if(kind==="fund"){
  const p=record?.payload;
  data=p?{...p,opening_cash:tourismDecimalMinor(p.opening_cash_minor,p.minor_unit),reserve:tourismDecimalMinor(p.reserve_minor,p.minor_unit)}:
   {label:"",fund_code:"TGT",jurisdiction:"",currency:"USD",minor_unit:2,opening_period:"2026-01",opening_cash:"0.00",reserve:"0.00",opening_basis:"",allocation_numerator:2,allocation_denominator:9,allocation_basis:"",timezone:"America/Chicago",source_url:"",annual_plan:""};
 }else{
  const p=record?.payload;
  data=p?JSON.parse(JSON.stringify(p)):{label:"",fund:null,sources:[],start:"2026-01",as_of:"2026-08",method:"seasonal_ratio",comparison_months:6,growth_bps:0,downside_bps:-500,upside_bps:500,adjustments:[],budget_id:"",assumptions:"",annual_plan:""};
  if(p){const fund=await tourismEntity("tourism_fund",p.fund.id,p.fund.revision);data.adjustments=data.adjustments.map(r=>({...r,amount:tourismDecimalMinor(r.amount_minor,fund.payload.minor_unit)}));}
 }
 const result={record,data,dirty:false};tourismDrafts.set(key,result);return result;
}
function tourismEditAttrs(field){return 'data-tourism-field="'+field+'"';}
function tourismReadForm(kind){
 if(kind==="import"){
  for(const element of document.querySelectorAll('[data-tourism-form="import"] [data-tourism-field]'))tourismImport.data[element.dataset.tourismField]=element.value;
  for(const element of document.querySelectorAll("[data-tourism-mapping]")){const key=element.dataset.tourismMapping;tourismImport.data.mapping[key]=element.value||null;}
  for(const element of document.querySelectorAll("[data-tourism-default]")){const key=element.dataset.tourismDefault;if(element.value)tourismImport.data.defaults[key]=element.value;else delete tourismImport.data.defaults[key];}
  return tourismImport.data;
 }
 const current=tourismCurrent[kind];if(!current)return null;
 for(const element of document.querySelectorAll('[data-tourism-form="'+kind+'"] [data-tourism-field]'))current.data[element.dataset.tourismField]=element.value;
 if(kind==="plan"){
  const selected=$("tourism-plan-fund");if(selected)current.data.fund=tourismParseReference(selected.value,"tourism_fund");
  const sources=document.querySelectorAll("[data-tourism-source-choice]");
  if(sources.length)current.data.sources=Array.from(sources).map(e=>tourismParseReference(e.value,"tourism_source")).filter(Boolean);
  const adjustmentRows=document.querySelectorAll("[data-tourism-adjustment]");
  if($("tourism-adjustments"))current.data.adjustments=Array.from(adjustmentRows).map(row=>Object.fromEntries(Array.from(row.querySelectorAll("[data-tourism-adjustment-field]")).map(e=>[e.dataset.tourismAdjustmentField,e.value])));
 }
 current.dirty=true;return current.data;
}
function tourismDraftNotice(current){
 return current.record?tourismParagraph("Editing retained revision "+current.record.revision+". Saving creates the next version; existing prepared reports retain their selected version."):"";
}
function tourismField(title,id,initial="",type="text",attrs=""){return input(title,id,initial,type,attrs);}
function tourismToolbar(){
 return '<div class="tourism-intro"><div><h2>Tourism funding & reporting</h2><p>Retain original collections, published distributions, budget columns and operator cash. Prepare a reporting year, review its sources, then export the finalized schedules.</p></div>'+tourismButton("example","Open Overland Park working example")+"</div>"+
 '<div class="tourism-tabs" role="group" aria-label="Tourism sections">'+tourismPanes.map(p=>tourismButton("pane",({reports:"Reports",sources:"Sources",funds:"Funds",plans:"Forecast plans"})[p],'data-pane="'+p+'" aria-pressed="'+(tourismSelection.pane===p)+'"')).join("")+"</div>";
}
async function tourismView(){
 tourismResetWorkspace();
 const context={fund:null,plan:null,source:null,period:null,report:null,selection:{...tourismSelection}};
 const views={reports:tourismReportView,sources:tourismSourceView,funds:tourismFundView,plans:tourismPlanView};
 const html='<div class="tourism-workspace">'+tourismToolbar()+await views[context.selection.pane](context)+"</div>";
 return {html,context};
}
function tourismCommitView(view){
 tourismCurrent=view.context;tourismSelection=view.context.selection;tourismRemember();
}
function tourismImportView(){
 const p=tourismImport.data,isJson=/\.json$/i.test(tourismImport.file?.name||""),headers=tourismImport.headers;
 const mapping=!isJson&&tourismImport.file?'<details open><summary>Map original CSV columns</summary>'+tourismParagraph("Choose the source column for each field, or supply a shared value. Amounts use the selected currency unit. Original bytes are retained.")+
 rowsTable(["Required field / optional detail","Original column","Shared value"],tourismFields[p.table].map(field=>'<tr><td><label for="tourism-map-'+field+'">'+h(field.replaceAll("_"," "))+'</label></td><td><select id="tourism-map-'+field+'" data-tourism-mapping="'+field+'"><option value="">Shared value / blank</option>'+headers.map(header=>'<option value="'+h(header)+'"'+((p.mapping[field]||(!Object.hasOwn(p.mapping,field)&&headers.includes(field)?field:""))===header?" selected":"")+">"+h(header)+"</option>").join("")+'</select></td><td><input aria-label="Shared '+h(field)+'" data-tourism-default="'+field+'" value="'+h(p.defaults[field]||"")+'"></td></tr>'))+"</details>":"";
 return '<div class="panel" data-tourism-form="import"><div class="panel-head"><h2>Import original source</h2>'+tourismButton("clear-import","Clear selection")+'</div>'+
 '<div class="grid"><label>Original CSV or source packet<input id="tourism-import-file" type="file" accept=".csv,.json"></label>'+
 tourismField("Source label","tourism-import-label",p.label,"text",tourismEditAttrs("label"))+
 tourismSelect("CSV source table","tourism-import-table",Object.keys(tourismFields).map(x=>[x,x[0].toUpperCase()+x.slice(1)]),p.table,tourismEditAttrs("table"))+
 tourismField("Currency","tourism-import-currency",p.currency,"text",tourismEditAttrs("currency")+' maxlength="3"')+
 tourismField("Currency decimal places","tourism-import-unit",p.minor_unit,"number",tourismEditAttrs("minor_unit")+' min="0" max="4"')+
 tourismField("Original source URL","tourism-import-url",p.source_url,"url",tourismEditAttrs("source_url"))+"</div>"+
 tourismParagraph(tourismImport.file?"Selected "+tourismImport.file.name+" · "+tourismImport.file.size.toLocaleString()+" bytes":"Choose the complete original source file.")+
 (tourismImport.headerNote?tourismParagraph(tourismImport.headerNote):"")+mapping+
 '<details><summary>Correction of an existing source</summary>'+tourismSelect("Prior source edition","tourism-import-parent",tourismChoices("tourism_source",p.parent?tourismParseReference(p.parent,"tourism_source"):null,"New independent source"),p.parent,tourismEditAttrs("parent"))+
 tourismText("Correction reason","tourism-import-correction",p.correction_note,tourismEditAttrs("correction_note"))+"</details>"+
 '<div class="actions">'+tourismButton("import","Retain source for review","",true)+tourismButton("template","Download CSV template",'data-table="'+h(p.table)+'"')+"</div>"+
 tourismParagraph("Collections, distributions, operator cash and published budget statuses have separate source tables. Cash returns identify the original same-fund entry. A correction creates a new source with its predecessor attached.")+"</div>";
}
async function tourismSourceView(context){
 const records=tourismRecords("tourism_source");let detail="";
 if(context.selection.source){
  const selected=records.find(r=>r.id===context.selection.source);
  if(selected){
   const record=await tourismEntity(selected.kind,selected.id,selected.revision);context.source=record;
   const p=record.payload,tables=Object.entries(p.tables).filter(([,count])=>count);
   if(!tables.some(([name])=>name===context.selection.table)){context.selection.table=tables[0]?.[0]||"collections";context.selection.offset=0;}
   const preview=await request("/api/tourism/preview?"+new URLSearchParams({kind:record.kind,id:record.id,revision:record.revision,table:context.selection.table,offset:context.selection.offset,limit:100}));
   const headers=[...new Set(preview.rows.flatMap(row=>Object.keys(row)))];
   detail='<div class="panel"><div class="panel-head"><h2>'+h(label(record))+"</h2>"+badge(p.state)+'</div><div class="actions">'+objectButton(p.original,"Original file")+objectButton(p.normalised,"Mapped source JSON")+historyButton(record)+inspectButton(record)+"</div>"+
    tourismParagraph(p.currency+" · "+p.minor_unit+" decimal places · original "+p.original.digest)+
    '<div class="tourism-source-documents">'+p.source_documents.map(doc=>'<p>'+tourismSourceLink(doc.url,doc.title)+(doc.page?" · page "+h(doc.page):"")+"</p>").join("")+"</div>"+
    '<div class="panel-head">'+tourismSelect("Retained table","tourism-source-table",tables.map(([name,count])=>[name,name+" · "+count+" rows"]),context.selection.table)+
    '<div class="actions">'+tourismButton("source-page","Previous",'data-offset="'+Math.max(0,context.selection.offset-100)+'"'+(context.selection.offset===0?" disabled":""))+
    tourismButton("source-page","Next",'data-offset="'+(preview.next_offset??context.selection.offset)+'"'+(preview.next_offset==null?" disabled":""))+"</div></div>"+
    tourismParagraph(preview.rows.length?"Rows "+(context.selection.offset+1)+"–"+(context.selection.offset+preview.rows.length)+" of "+preview.total:"No rows in this table.")+
    (headers.length?rowsTable(headers,preview.rows.map(row=>"<tr>"+headers.map(key=>'<td class="'+(key.endsWith("_minor")?"num":"")+'">'+h(typeof row[key]==="object"?JSON.stringify(row[key]):row[key])+"</td>").join("")+"</tr>")):"")+
    (p.state==="DRAFT"?tourismText("Source review note","tourism-source-review",tourismReviewDrafts.get("source:"+record.id)||"")+
      tourismButton("accept-source","Accept this source edition",'data-id="'+record.id+'" data-revision="'+record.revision+'"',true):
      tourismParagraph("Accepted by "+p.review.actor+". "+p.review.note))+"</div>";
  }else context.selection.source=null;
 }
 return tourismImportView()+detail+'<div class="panel"><h2>Source history</h2>'+
 (records.length?rowsTable(["Source","Tables","State",""],records.map(r=>'<tr><td><strong>'+h(label(r))+'</strong><div class="muted">r'+r.revision+(r.payload.parent?" · correction of "+h(r.payload.parent.id):"")+"</div></td><td>"+h(Object.entries(r.payload.tables).map(([name,count])=>name+" "+count).join(" · "))+"</td><td>"+badge(r.payload.state)+'</td><td>'+tourismButton("source-open","Open",'data-id="'+r.id+'"')+"</td></tr>")):empty("No tourism sources","Import the original table or open the public Overland Park working example."))+"</div>";
}
async function tourismFundView(context){
 const current=await tourismDraft("fund",context.selection);context.fund=current;const p=current.data;
 return '<div class="panel" data-tourism-form="fund"><div class="panel-head"><h2>'+(current.record?"Edit fund":"Create fund")+"</h2>"+tourismButton("fund-new","New fund")+"</div>"+tourismDraftNotice(current)+
 '<div class="grid three">'+tourismField("Fund label","tourism-fund-label",p.label,"text",tourismEditAttrs("label"))+
 tourismField("Fund code in cash sources","tourism-fund-code",p.fund_code,"text",tourismEditAttrs("fund_code"))+
 tourismField("Exact source jurisdiction","tourism-fund-jurisdiction",p.jurisdiction,"text",tourismEditAttrs("jurisdiction"))+
 tourismField("Currency","tourism-fund-currency",p.currency,"text",tourismEditAttrs("currency")+' maxlength="3"')+
 tourismField("Currency decimal places","tourism-fund-unit",p.minor_unit,"number",tourismEditAttrs("minor_unit")+' min="0" max="4"')+
 tourismField("Reporting year opens","tourism-fund-period",p.opening_period,"month",tourismEditAttrs("opening_period"))+
 tourismField("Opening cash, including reserve","tourism-fund-opening",p.opening_cash,"text",tourismEditAttrs("opening_cash")+' inputmode="decimal"')+
 tourismField("Reserve included in that cash","tourism-fund-reserve",p.reserve,"text",tourismEditAttrs("reserve")+' inputmode="decimal"')+
 tourismField("Reporting time zone","tourism-fund-timezone",p.timezone,"text",tourismEditAttrs("timezone"))+"</div>"+
 tourismText("Opening balance basis and original ledger or budget reference","tourism-fund-basis",p.opening_basis,tourismEditAttrs("opening_basis"))+
 tourismParagraph("Enter total opening cash once. The reserve is a recorded component of that balance; it is not added again as income.")+
 '<div class="grid">'+tourismField("Planning share numerator","tourism-fund-numerator",p.allocation_numerator,"number",tourismEditAttrs("allocation_numerator")+' min="0"')+
 tourismField("Planning share denominator","tourism-fund-denominator",p.allocation_denominator,"number",tourismEditAttrs("allocation_denominator")+' min="1"')+"</div>"+
 tourismText("Planning allocation basis","tourism-fund-allocation",p.allocation_basis,tourismEditAttrs("allocation_basis"))+
 tourismField("Source URL","tourism-fund-url",p.source_url,"url",tourismEditAttrs("source_url"))+
 tourismText("Annual operating plan","tourism-fund-annual",p.annual_plan,tourismEditAttrs("annual_plan")+' rows="8"')+
 '<div class="actions">'+tourismButton("fund-save",current.record?"Save fund revision":"Save fund","",true)+(current.record?historyButton(current.record):"")+"</div></div>"+
 '<div class="panel"><h2>Saved funds</h2>'+
 (tourismRecords("tourism_fund").length?rowsTable(["Fund","Jurisdiction","Opening / reserve","Planning share",""],tourismRecords("tourism_fund").map(r=>'<tr><td>'+h(label(r))+'<div class="muted">r'+r.revision+"</div></td><td>"+h(r.payload.jurisdiction)+"</td><td>"+h(tourismMoney(r.payload.opening_cash_minor,r.payload.currency,r.payload.minor_unit))+'<div class="muted">Reserve '+h(tourismMoney(r.payload.reserve_minor,r.payload.currency,r.payload.minor_unit))+"</div></td><td>"+r.payload.allocation_numerator+"/"+r.payload.allocation_denominator+'</td><td>'+tourismButton("fund-open","Open",'data-id="'+r.id+'"')+"</td></tr>")):empty("No fund profile","Create the reporting fund with its original opening-balance basis."))+"</div>";
}
async function tourismPlanSourceChoices(plan){
 const latest=tourismRecords("tourism_source"),ids=[...new Set([...latest.map(r=>r.id),...plan.sources.map(r=>r.id)])],rows=[];
 for(const id of ids){
  const current=latest.find(r=>r.id===id),pinned=plan.sources.find(r=>r.id===id);
  const options=[["","Excluded"]];let record=current;
  if(current?.payload.state==="ACCEPTED")options.push([tourismReferenceKey(ref(current)),"Accepted r"+current.revision]);
  if(pinned&&!options.some(([key])=>key===tourismReferenceKey(pinned))){
   record=await tourismEntity("tourism_source",pinned.id,pinned.revision);options.push([tourismReferenceKey(pinned),"Retained accepted r"+pinned.revision]);
  }
  if(!record)continue;
  rows.push('<tr><td>'+h(label(record))+'<div class="muted">'+h(Object.entries(record.payload.tables).filter(([,n])=>n).map(([k,n])=>k+" "+n).join(" · "))+"</div></td><td>"+
   tourismSelect("Source edition","tourism-plan-source-"+id,options,tourismReferenceKey(pinned),'data-tourism-source-choice="'+h(id)+'"')+"</td></tr>");
 }
 return rows.length?rowsTable(["Original source","Exact edition in this plan"],rows):empty("Accept original source first","The plan selects reviewed source editions.");
}
function tourismAdjustmentRows(plan){
 return '<div id="tourism-adjustments">'+plan.adjustments.map((r,i)=>'<div class="tourism-adjustment" data-tourism-adjustment="'+i+'">'+
 tourismField("Forecast month","tourism-adjust-month-"+i,r.period,"month",'data-tourism-adjustment-field="period"')+
 tourismField("Signed amount in source currency","tourism-adjust-amount-"+i,r.amount??"","text",'inputmode="decimal" data-tourism-adjustment-field="amount"')+
 tourismField("Reason / calculation basis","tourism-adjust-basis-"+i,r.basis,"text",'data-tourism-adjustment-field="basis"')+
 tourismField("Original reference","tourism-adjust-ref-"+i,r.source_ref,"text",'data-tourism-adjustment-field="source_ref"')+
 tourismButton("adjustment-remove","Remove",'data-index="'+i+'"')+"</div>").join("")+"</div>";
}
async function tourismPlanView(context){
 const current=await tourismDraft("plan",context.selection);context.plan=current;const p=current.data;
 const budgetRows=[];
 for(const source of p.sources){
  const preview=await request("/api/tourism/preview?"+new URLSearchParams({kind:"tourism_source",id:source.id,revision:source.revision,table:"budgets",limit:500}));
  budgetRows.push(...preview.rows);
 }
 const budgetOptions='<datalist id="tourism-budget-options">'+budgetRows.map(r=>'<option value="'+h(r.budget_id)+'">'+h(r.year+" "+r.status+" · "+r.jurisdiction)+"</option>").join("")+"</datalist>";
 return '<div class="panel" data-tourism-form="plan"><div class="panel-head"><h2>'+(current.record?"Edit forecast plan":"Create forecast plan")+"</h2>"+tourismButton("plan-new","New plan")+"</div>"+tourismDraftNotice(current)+
 '<div class="grid">'+tourismField("Report label","tourism-plan-label",p.label,"text",tourismEditAttrs("label"))+
 tourismSelect("Exact fund edition","tourism-plan-fund",tourismChoices("tourism_fund",p.fund),tourismReferenceKey(p.fund))+
 tourismField("Reporting year start","tourism-plan-start",p.start,"month",tourismEditAttrs("start"))+
 tourismField("Collections known through","tourism-plan-asof",p.as_of,"month",tourismEditAttrs("as_of"))+"</div>"+
 '<h3>Selected original sources</h3>'+await tourismPlanSourceChoices(p)+
 tourismParagraph("Select one original edition for each overlapping series. Collections must have one consistent jurisdiction and net or gross basis. Retain previous cash entries needed to validate a return.")+
 '<div class="grid three">'+tourismSelect("Forecast method","tourism-plan-method",[["seasonal_ratio","Prior-year seasonality × recent ratio"],["fixed_growth","Prior-year seasonality × explicit growth"]],p.method,tourismEditAttrs("method"))+
 tourismField("Paired comparison months","tourism-plan-window",p.comparison_months,"number",tourismEditAttrs("comparison_months")+' min="1" max="12"')+
 tourismField("Fixed growth, basis points","tourism-plan-growth",p.growth_bps,"number",tourismEditAttrs("growth_bps"))+
 tourismField("Downside change, basis points","tourism-plan-downside",p.downside_bps,"number",tourismEditAttrs("downside_bps")+' max="0"')+
 tourismField("Upside change, basis points","tourism-plan-upside",p.upside_bps,"number",tourismEditAttrs("upside_bps")+' min="0"')+
 tourismField("Published budget ID, optional","tourism-plan-budget",p.budget_id,"text",tourismEditAttrs("budget_id")+' list="tourism-budget-options"')+"</div>"+budgetOptions+
 tourismParagraph("100 basis points = one percentage point. Seasonal calibration uses exact paired months ending at the selected as-of month. Downside and upside are explicit sensitivities.")+
 '<details open><summary>Source-based future adjustments</summary>'+tourismAdjustmentRows(p)+tourismButton("adjustment-add","Add future adjustment")+"</details>"+
 tourismText("Forecast assumptions and source interpretation","tourism-plan-assumptions",p.assumptions,tourismEditAttrs("assumptions")+' rows="5"')+
 tourismText("Annual plan for this report","tourism-plan-annual",p.annual_plan,tourismEditAttrs("annual_plan")+' rows="7"')+
 '<div class="actions">'+tourismButton("plan-save","Save plan revision","",true)+tourismButton("plan-prepare","Save & prepare report")+(current.record?historyButton(current.record):"")+"</div></div>"+
 '<div class="panel"><h2>Saved forecast plans</h2>'+
 (tourismRecords("tourism_plan").length?rowsTable(["Plan","Reporting year / as-of","Sources",""],tourismRecords("tourism_plan").map(r=>'<tr><td>'+h(label(r))+'<div class="muted">r'+r.revision+"</div></td><td>"+h(r.payload.start+" / "+r.payload.as_of)+"</td><td>"+r.payload.sources.length+'</td><td>'+tourismButton("plan-open","Open",'data-id="'+r.id+'"')+"</td></tr>")):empty("No forecast plan","Select accepted sources and a saved fund to prepare the reporting year."))+"</div>";
}
function tourismQuarterTable(report){
 const rows=[],months=report.forecast.months,p=report.fund.payload;
 for(let i=0;i<4;i++){
  const selected=months.slice(i*3,i*3+3),sum=field=>selected.some(r=>r[field]!=null)?selected.reduce((n,r)=>n+(r[field]??0),0):null;
  rows.push("<tr><td>Reporting Q"+(i+1)+"<div class=\"muted\">"+h(selected[0].period+" – "+selected[2].period)+"</div></td><td>"+selected.filter(r=>r.state==="OBSERVED").length+" observed / "+selected.filter(r=>r.state==="FORECAST").length+" forecast / "+selected.filter(r=>r.state==="MISSING").length+" missing</td>"+tourismMoneyCell(sum("base_minor"),p.currency,p.minor_unit)+tourismMoneyCell(sum("planning_allocation_minor"),p.currency,p.minor_unit)+"</tr>");
 }
 return rowsTable(["Quarter from report start","Coverage","Base projection","Planning allocation"],rows);
}
function tourismBudgetTable(report){
 const p=report.fund.payload;
 return rowsTable(["Original column","Reported resources","Reported expenditures","Reported closing","Arithmetic differences"],report.budgets.map(row=>"<tr><td>"+h(row.year+" "+row.status)+"<div class=\"muted\">"+h(row.budget_id)+(report.selected_budget?.budget_id===row.budget_id?" · selected":"")+"</div></td>"+
 tourismMoneyCell(row.reported_resources_minor,p.currency,p.minor_unit)+tourismMoneyCell(row.reported_expenditures_minor,p.currency,p.minor_unit)+tourismMoneyCell(row.reported_closing_minor,p.currency,p.minor_unit)+
 "<td>"+Object.entries(row.reported_differences).map(([key,number])=>h(key)+": "+h(tourismMoney(number,p.currency,p.minor_unit))).join("<br>")+"</td></tr>"));
}
function tourismCashView(report,selected=tourismSelection){
 const p=report.fund.payload,cash=report.cash,rows=cash.rows.slice(selected.cashOffset,selected.cashOffset+100);
 return '<details><summary>Operator cash and separate fund accounting</summary>'+tourismParagraph(cash.meaning)+
 '<dl class="tourism-facts"><div><dt>Opening cash, reserve included</dt><dd>'+h(tourismMoney(cash.opening_cash_minor,p.currency,p.minor_unit))+"</dd></div><div><dt>Recorded reserve component</dt><dd>"+
 h(tourismMoney(cash.recorded_reserve_minor,p.currency,p.minor_unit))+"</dd></div><div><dt>Net receipts</dt><dd>"+h(tourismMoney(cash.totals.net_receipts_minor,p.currency,p.minor_unit))+"</dd></div><div><dt>Net expenditures</dt><dd>"+
 h(tourismMoney(cash.totals.net_expenditures_minor,p.currency,p.minor_unit))+"</dd></div><div><dt>Closing from selected cash</dt><dd>"+h(tourismMoney(cash.closing_cash_minor,p.currency,p.minor_unit))+"</dd></div></dl>"+
 tourismParagraph(p.opening_basis)+(cash.coverage==="NO_OPERATOR_CASH_SELECTED"?tourismParagraph("This report has no selected operator cash activity. Import the actual fund ledger to report receipts and expenditures."):"")+
 (cash.groups.length?rowsTable(["Category / program","Receipts","Receipt returns","Expenditures","Expense returns"],cash.groups.map(r=>"<tr><td>"+h(r.category+" / "+r.program)+"</td>"+
 tourismMoneyCell(r.receipts_minor,p.currency,p.minor_unit)+tourismMoneyCell(r.receipt_returns_minor,p.currency,p.minor_unit)+tourismMoneyCell(r.expenditures_minor,p.currency,p.minor_unit)+tourismMoneyCell(r.expense_returns_minor,p.currency,p.minor_unit)+"</tr>")):"")+
 (rows.length?rowsTable(["Original entry","Date","Direction","Amount","Original return link","Reference"],rows.map(r=>"<tr><td>"+h(r.entry_id)+"</td><td>"+h(r.date)+"</td><td>"+h(r.direction)+"</td>"+tourismMoneyCell(r.amount_minor,p.currency,p.minor_unit)+"<td>"+h(r.original_entry_id)+"</td><td>"+h(r.source_ref)+"</td></tr>")):"")+
 (cash.rows.length>100?'<div class="actions">'+tourismButton("cash-page","Previous entries",'data-offset="'+Math.max(0,selected.cashOffset-100)+'"'+(!selected.cashOffset?" disabled":""))+tourismButton("cash-page","Next entries",'data-offset="'+(selected.cashOffset+100)+'"'+(selected.cashOffset+100>=cash.rows.length?" disabled":""))+"</div>":"")+"</details>";
}
function tourismReviewView(record){
 const p=record.payload,key="period:"+record.id+":"+record.revision;
 if(!tourismReviewDrafts.has(key))tourismReviewDrafts.set(key,{note:p.review?.note||"",acknowledged:p.review?.acknowledged||[],reopen:""});
 const draft=tourismReviewDrafts.get(key);
 if(p.state==="FINALIZED")return '<div class="tourism-review"><h3>Finalized report edition</h3>'+
 tourismParagraph("Reviewed by "+p.review.actor+". "+p.review.note)+
 '<div class="actions">'+tourismButton("export","Build complete reporting ZIP",'data-id="'+record.id+'" data-revision="'+record.revision+'"',true)+historyButton(record)+objectButton(p.report,"Saved report JSON")+"</div>"+
 '<details><summary>Reopen this report for a new review</summary>'+tourismText("Reason for reopening","tourism-reopen-note",draft.reopen)+tourismButton("reopen","Reopen as a new revision",'data-id="'+record.id+'" data-revision="'+record.revision+'"')+
 tourismParagraph("The existing finalized edition and its export remain available. To use changed inputs, save a new forecast plan and prepare a new report.")+"</details></div>";
 return '<div class="tourism-review"><h3>Review prepared report</h3>'+
 tourismParagraph("Read the retained source differences, then record your interpretation. The original values remain attached.")+
 '<div class="tourism-issues">'+(p.issues.length?p.issues.map(issue=>'<label><input type="checkbox" data-tourism-ack="'+h(issue.id)+'"'+(draft.acknowledged.includes(issue.id)?" checked":"")+'><span><strong>'+h(issue.id)+"</strong> "+h(issue.detail)+
 (issue.differences_minor?'<span class="muted">'+h(Object.entries(issue.differences_minor).map(([key,n])=>key+": "+tourismMoney(n,p.currency,p.minor_unit)).join(" · "))+"</span>":"")+
 (issue.difference_minor!=null?'<span class="muted">'+h(tourismMoney(issue.difference_minor,p.currency,p.minor_unit))+"</span>":"")+"</span></label>").join(""):tourismParagraph("The selected source arithmetic has no listed exceptions."))+"</div>"+
 tourismText("Review note","tourism-report-review",draft.note,'rows="5"')+
 '<div class="actions">'+tourismButton("review","Save report review",'data-id="'+record.id+'" data-revision="'+record.revision+'"',p.state!=="REVIEWED")+
 (p.state==="REVIEWED"?tourismButton("finalize","Finalize reviewed report",'data-id="'+record.id+'" data-revision="'+record.revision+'" data-report-sha="'+p.report.digest+'"',true):"")+historyButton(record)+objectButton(p.report,"Prepared report JSON")+"</div></div>";
}
async function tourismReportView(context){
 const records=tourismRecords("tourism_period");if(!context.selection.period&&records.length)context.selection.period=records[0].id;
 const selected=records.find(r=>r.id===context.selection.period);let detail="";
 if(selected){
  const record=await tourismEntity(selected.kind,selected.id,selected.revision),report=await tourismReport(record);
  context.period=record;context.report=report;const p=report.fund.payload,f=report.forecast;
  const coverage=f.missing_observed_months.length?"Incomplete year: "+f.missing_observed_months.join(", ")+" missing":"Twelve-month reporting schedule";
  detail='<div class="panel"><div class="panel-head"><div><h2>'+h(label(record))+'</h2><p class="muted">'+h(record.payload.start+" through "+record.payload.end+" · collections known through "+record.payload.as_of)+" · r"+record.revision+"</p></div>"+badge(record.payload.state)+'</div>'+
   '<div class="metrics">'+metric(tourismMoney(f.totals.observed_minor,p.currency,p.minor_unit),"Observed collection subtotal")+
   metric(tourismMoney(f.totals.base_minor,p.currency,p.minor_unit),f.missing_observed_months.length?"Available base subtotal":"Base annual projection")+
   metric(tourismMoney(f.totals.planning_allocation_minor,p.currency,p.minor_unit),"Planning allocation")+"</div>"+
   tourismParagraph(coverage+". "+f.collection_basis+". "+f.planning_allocation_meaning)+
   rowsTable(["Month","State","Original observed","Base","Downside","Upside","Planning allocation"],f.months.map(r=>"<tr><td>"+h(r.period)+"</td><td>"+badge(r.state)+"</td>"+
    tourismMoneyCell(r.observed_minor,p.currency,p.minor_unit)+tourismMoneyCell(r.base_minor,p.currency,p.minor_unit)+tourismMoneyCell(r.downside_minor,p.currency,p.minor_unit)+tourismMoneyCell(r.upside_minor,p.currency,p.minor_unit)+tourismMoneyCell(r.planning_allocation_minor,p.currency,p.minor_unit)+"</tr>"))+
   '<h3>Quarterly reporting</h3>'+tourismQuarterTable(report)+
   '<details><summary>Forecast assumptions and rolling historical check</summary>'+
   tourismParagraph(report.plan.payload.assumptions)+tourismParagraph("Applied factor "+Number(f.factor).toFixed(6)+". "+f.scenarios)+
   tourismParagraph("Historical forecast rows: "+f.backtest.length+(f.backtest_wape!=null?" · weighted absolute error "+(Number(f.backtest_wape)*100).toFixed(2)+"%":"")+". "+f.backtest_method)+
   rowsTable(["Forecast month","Calibration ends","Historical forecast","Observed","Absolute error"],f.backtest.map(r=>"<tr><td>"+h(r.period)+"</td><td>"+h(r.calibration_ends)+"</td>"+
    tourismMoneyCell(r.forecast_minor,p.currency,p.minor_unit)+tourismMoneyCell(r.observed_minor,p.currency,p.minor_unit)+tourismMoneyCell(r.absolute_error_minor,p.currency,p.minor_unit)+"</tr>"))+
   '<h4>Latest calibration pairs</h4>'+rowsTable(["Current month","Prior year month","Current","Prior"],f.calibration_pairs.map(r=>"<tr><td>"+h(r.current)+"</td><td>"+h(r.prior)+"</td>"+tourismMoneyCell(r.current_minor,p.currency,p.minor_unit)+tourismMoneyCell(r.prior_minor,p.currency,p.minor_unit)+"</tr>"))+"</details>"+
   '<details><summary>Published distributions and original budget columns</summary>'+
   tourismParagraph("Published distributions are independent source controls. Budget status and component arithmetic retain the original published values.")+
   rowsTable(["Window","Published distribution","Collection subtotal","Difference","Coverage"],report.controls.map(r=>"<tr><td>"+h(r.start+" – "+r.end)+"</td>"+tourismMoneyCell(r.published_distribution_minor,p.currency,p.minor_unit)+tourismMoneyCell(r.collection_subtotal_minor,p.currency,p.minor_unit)+tourismMoneyCell(r.difference_minor,p.currency,p.minor_unit)+"<td>"+h(r.complete_collection_window?"Complete collection window":"Missing "+r.missing_months.join(", "))+"</td></tr>"))+
   tourismBudgetTable(report)+"</details>"+tourismCashView(report,context.selection)+
   '<details><summary>Annual plan, lodging and demand inputs</summary><div class="tourism-narrative">'+h(report.plan.payload.annual_plan)+"</div>"+
   tourismParagraph(report.lodging.length+" lodging rows and "+report.demand.length+" demand rows are retained in the reporting package. Each remains attached to its exact source; a forecast adjustment must be entered explicitly.")+
   objectButton(record.payload.report,"All saved operating inputs")+"</details>"+
   '<details><summary>Exact selected source editions</summary>'+rowsTable(["Source","Edition","Original SHA-256",""],report.sources.map(r=>"<tr><td>"+h(label(r))+"</td><td>r"+r.revision+'</td><td class="mono">'+h(r.payload.original.digest)+"</td><td>"+objectButton(r.payload.original,"Original file")+objectButton(r.payload.normalised,"Mapped data")+"</td></tr>"))+"</details>"+
   tourismReviewView(record)+"</div>";
 }
 const exports=tourismRecords("tourism_export").filter(r=>!selected||r.payload.period.id===selected.id);
 return '<div class="panel"><div class="panel-head"><h2>Reporting periods</h2>'+tourismButton("pane","Prepare a forecast plan",'data-pane="plans"')+"</div>"+
  (records.length?rowsTable(["Report","Period / known through","State",""],records.map(r=>'<tr><td>'+h(label(r))+'<div class="muted">r'+r.revision+"</div></td><td>"+h(r.payload.start+" / "+r.payload.as_of)+"</td><td>"+badge(r.payload.state)+"</td><td>"+tourismButton("report-open","Open",'data-id="'+r.id+'"')+"</td></tr>")):
  empty("Prepare the first reporting year","Open the actual public-data example or import original sources, create a fund, and save a forecast plan."))+"</div>"+detail+
  '<div class="panel"><h2>Finalized reporting packages</h2>'+
  (exports.length?rowsTable(["Report edition","Contents","Download"],exports.map(r=>"<tr><td>"+h(label(r))+"</td><td>"+r.payload.files+' retained files · '+Math.round(r.payload.package.bytes/1024)+" KiB</td><td>"+objectButton(r.payload.package,"Download complete reporting ZIP")+objectButton(r.payload.manifest,"File manifest")+"</td></tr>")):
   tourismParagraph("Finalize a reviewed report to build its workbook, HTML report, CSV schedules and complete selected source files."))+
  '<div class="actions">'+tourismButton("recovery","Open encrypted workspace recovery")+"</div></div>";
}
async function tourismLoadExample(){
 const config=await request("/api/tourism/example");
 const action=async(name,step,body)=>act(name,{...body,actor:config.actor,operation_id:config.operation_prefix+"-"+step},true);
 const original=await action("tourism.example","source",{});
 const source=await action("tourism.source.accept","accept",{id:original.id,expected:original.revision,note:config.source_review_note});
 const fund=await action("tourism.fund.save","fund",{fund:config.fund});
 const plan=await action("tourism.plan.save","plan",{plan:{...config.plan,fund:ref(fund),sources:[ref(source)],annual_plan:config.fund.annual_plan}});
 const period=await action("tourism.period.prepare","period",{plan:ref(plan)});
 tourismSelection.period=period.id;tourismSelection.pane="reports";await render();
 notify("Opened the original Overland Park source example. Review the prepared report and its published source differences.");
}
async function tourismAction(action,button){
 const name=action.slice(8),id=button.dataset.id,revision=Number(button.dataset.revision);
 if(name==="pane"){tourismSelection.pane=button.dataset.pane;await render();return;}
 if(name==="example")return tourismLoadExample();
 if(name==="source-open"){tourismSelection.source=id;tourismSelection.offset=0;await render();return;}
 if(name==="source-page"){tourismSelection.offset=Number(button.dataset.offset);await render();return;}
 if(name==="clear-import"){tourismImport.file=null;tourismImport.headers=[];tourismImport.headerNote="";tourismImport.data.mapping={};await render();return;}
 if(name==="template"){
  const fields=tourismFields[button.dataset.table];const blob=new Blob([fields.join(",")+"\n"],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download="tourism-"+button.dataset.table+".csv";document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);return;
 }
 if(name==="import"){
  const p=tourismReadForm("import");if(!tourismImport.file)throw new Error("Choose the original source file.");
  const body={...await filePayload(tourismImport.file),...p,minor_unit:Number(p.minor_unit),parent:tourismParseReference(p.parent,"tourism_source")};
  await act("tourism.source.prepare",body);return;
 }
 if(name==="accept-source")return act("tourism.source.accept",{id,expected:revision,note:value("tourism-source-review")});
 if(name==="fund-new"||name==="plan-new"){const kind=name.split("-")[0];tourismSelection[kind]=null;tourismDrafts.delete(kind+":new");await render();return;}
 if(name==="fund-open"||name==="plan-open"){tourismSelection[name.split("-")[0]]=id;await render();return;}
 if(name==="fund-save"){
  const data=tourismReadForm("fund"),record=tourismCurrent.fund.record;
  return act("tourism.fund.save",{...(record?{id:record.id,expected:record.revision}:{}),fund:data});
 }
 if(name==="adjustment-add"){const data=tourismReadForm("plan");data.adjustments.push({period:"",amount:"",basis:"",source_ref:""});await render();return;}
 if(name==="adjustment-remove"){const data=tourismReadForm("plan");data.adjustments.splice(Number(button.dataset.index),1);await render();return;}
 if(name==="plan-save"||name==="plan-prepare"){
  const data=tourismReadForm("plan"),record=tourismCurrent.plan.record;
  const saved=await act("tourism.plan.save",{...(record?{id:record.id,expected:record.revision}:{}),plan:data});
  if(name==="plan-prepare")await act("tourism.period.prepare",{plan:ref(saved)});return;
 }
 if(name==="report-open"){tourismSelection.period=id;tourismSelection.cashOffset=0;await render();return;}
 if(name==="cash-page"){tourismSelection.cashOffset=Number(button.dataset.offset);await render();return;}
 if(name==="review")return act("tourism.period.review",{id,expected:revision,note:value("tourism-report-review"),acknowledged:Array.from(document.querySelectorAll("[data-tourism-ack]:checked")).map(e=>e.dataset.tourismAck)});
 if(name==="finalize")return act("tourism.period.finalize",{id,expected:revision,expected_report_digest:button.dataset.reportSha});
 if(name==="reopen")return act("tourism.period.reopen",{id,expected:revision,note:value("tourism-reopen-note")});
 if(name==="export")return act("tourism.period.export",{period:{kind:"tourism_period",id,revision}});
 if(name==="recovery")return changeTab("delivery");
 throw new Error("Unknown tourism action.");
}
document.addEventListener("input",event=>{
 const target=event.target,form=target.closest("[data-tourism-form]")?.dataset.tourismForm;
 if(form)tourismReadForm(form);
 if(target.id==="tourism-source-review"&&tourismCurrent.source)tourismReviewDrafts.set("source:"+tourismCurrent.source.id,target.value);
 if(tourismCurrent.period&&["tourism-report-review","tourism-reopen-note"].includes(target.id)){
  const p=tourismCurrent.period,draft=tourismReviewDrafts.get("period:"+p.id+":"+p.revision);
  if(draft)draft[target.id==="tourism-report-review"?"note":"reopen"]=target.value;
 }
});
document.addEventListener("change",event=>run(async()=>{
 const target=event.target,form=target.closest("[data-tourism-form]")?.dataset.tourismForm;
 if(form)tourismReadForm(form);
 if(target.id==="tourism-import-file"){
  tourismImport.file=target.files[0]||null;tourismImport.headers=[];tourismImport.headerNote="";
  if(tourismImport.file&&!/\.json$/i.test(tourismImport.file.name)){
   const file=tourismImport.file,raw=await file.slice(0,65536).text();if(file!==tourismImport.file)return;
   const headers=billingCSVHeader(raw,file.size<=65536);tourismImport.headers=headers||[];
   tourismImport.headerNote=headers?"Original CSV headers: "+headers.join(" · "):"The original CSV header continues past the 64 KiB preview.";
  }
  await render();return;
 }
 if(target.id==="tourism-import-table"){tourismImport.data.mapping={};await render();return;}
 if(target.id==="tourism-source-table"){tourismSelection.table=target.value;tourismSelection.offset=0;await render();return;}
 if(target.id==="tourism-plan-fund"||target.hasAttribute("data-tourism-source-choice")){await render();return;}
 if(target.hasAttribute("data-tourism-ack")&&tourismCurrent.period){
  const p=tourismCurrent.period,draft=tourismReviewDrafts.get("period:"+p.id+":"+p.revision);
  if(draft)draft.acknowledged=Array.from(document.querySelectorAll("[data-tourism-ack]:checked")).map(e=>e.dataset.tourismAck);
 }
}));
