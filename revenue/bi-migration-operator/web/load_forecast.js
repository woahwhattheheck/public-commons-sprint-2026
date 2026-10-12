"use strict";

/* The load operator uses the original action journal, source objects and record revisions. */
const lfPanes=["reviews","sources","plans","receiving"];
let lfSelection={pane:"reviews",source:null,plan:null,review:null,received:null,sheet:"",sourceTable:"sheet",table:"comparison",offset:0,columnOffset:0,search:""};
try{const s=JSON.parse(sessionStorage.getItem("commons-bi-load-selection")||"null");if(s&&lfPanes.includes(s.pane))lfSelection={...lfSelection,...s};}catch(_){}
let lfWorkspaceId=null,lfCurrent={};
const lfMappingDrafts=new Map(),lfSourceDrafts=new Map(),lfPlanDrafts=new Map(),lfReviewDrafts=new Map(),lfAdjustmentPages=new Map(),lfDraftRevisions=new Map();
const lfUploadDraft={label:"",publisher:"",vintage:"",published:"",status:"annual_forecast",source_url:""};
const lfClone=v=>JSON.parse(JSON.stringify(v));
const lfRecords=kind=>workspace[kind]||[];
const lfAccepted=()=>lfRecords("load_source").filter(r=>r.payload.state==="ACCEPTED");
const lfValue=r=>r?r.id+"@"+r.revision:"";
const lfReference=(kind,raw)=>{const [id,revision]=String(raw||"").split("@");if(!id||!revision)throw new Error("Select an exact source edition.");return {kind,id,revision:Number(revision)};};
const lfSelected=(a,b)=>String(a)===String(b)?" selected":"";
const lfChecked=v=>v?" checked":"";
function lfField(title,id,initial="",extra=""){return '<label>'+h(title)+'<input id="'+h(id)+'" value="'+h(initial??"")+'" '+extra+'></label>';}
function lfArea(title,id,initial="",extra=""){return '<label>'+h(title)+'<textarea id="'+h(id)+'" '+extra+'>'+h(initial??"")+'</textarea></label>';}
function lfChoice(title,id,choices,initial="",extra=""){return '<label>'+h(title)+'<select id="'+h(id)+'" '+extra+'>'+choices.map(([v,t])=>'<option value="'+h(v)+'"'+lfSelected(initial,v)+'>'+h(t)+'</option>').join("")+'</select></label>';}
function lfRecordChoice(title,id,records,initial="",extra=""){return lfChoice(title,id,[["","Choose…"],...records.map(r=>[lfValue(r),label(r)+" · r"+r.revision])],initial,extra);}
function lfButtons(items){return '<div class="lf-actions">'+items.join("")+'</div>';}
function lfButton(action,title,extra=""){return '<button data-action="lf-'+action+'" '+extra+'>'+h(title)+'</button>';}
function lfData(kind,r){return 'data-kind="'+h(kind)+'" data-id="'+h(r.id)+'"';}
function lfMoney(value,places=3){if(value===null||value===undefined)return "—";const n=Number(value);return Number.isFinite(n)?n.toLocaleString(undefined,{maximumFractionDigits:places}):String(value);}
function lfColumn(value){const raw=String(value||"").trim().toUpperCase();if(/^\d+$/.test(raw))return Number(raw);if(!/^[A-Z]{1,3}$/.test(raw))throw new Error("Use an Excel column letter or positive column number.");let n=0;for(const c of raw)n=n*26+c.charCodeAt(0)-64;return n;}
function lfColumnLabel(value){const raw=String(value||"").trim().toUpperCase();if(/^[A-Z]{1,3}$/.test(raw))return raw;let n=Number(value||0),s="";if(!Number.isInteger(n)||n<0)return raw;while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;}
function lfPin(record){const p=record.payload;return '<p class="lf-meta">'+h(p.publisher)+' · '+h(p.vintage)+' · '+h(p.published)+' · '+h(p.status)+'</p><p class="lf-meta lf-wrap">'+h(p.source_url)+'</p>';}
function lfPager(prefix,page){return '<div class="lf-pager"><span>'+h(page.total)+' rows · '+h(page.total?page.offset+1:0)+'–'+h(Math.min(page.offset+page.rows.length,page.total))+'</span>'+lfButton(prefix+"-prev","Previous",page.offset===0?"disabled":"")+lfButton(prefix+"-next","Next",page.next_offset===null?"disabled":"")+'</div>';}
function lfSaveSelection(){sessionStorage.setItem("commons-bi-load-selection",JSON.stringify(lfSelection));}
async function lfPreview(kind,id,parameters={}){return request("/api/load/preview?"+new URLSearchParams({kind,id,...parameters}));}
function lfDraftRevision(kind,record){if(!record)return 0;const key=kind+":"+record.id;if(!lfDraftRevisions.has(key))lfDraftRevisions.set(key,record.revision);return lfDraftRevisions.get(key);}
function lfStaleDraft(kind,record){return record&&lfDraftRevision(kind,record)!==record.revision;}
function lfDraftNotice(kind,record,action){return lfStaleDraft(kind,record)?'<div class="lf-notice">This editor retains revision '+h(lfDraftRevision(kind,record))+'. The workspace now has revision '+h(record.revision)+'. Saving keeps the original revision check. '+lfButton(action,"Discard local edits and reload")+'</div>':"";}
function lfSourceDraft(record){lfDraftRevision("load_source",record);if(!lfSourceDrafts.has(record.id))lfSourceDrafts.set(record.id,lfClone(record.payload));return lfSourceDrafts.get(record.id);}
function lfMappingDraft(record){lfDraftRevision("load_source",record);if(!lfMappingDrafts.has(record.id))lfMappingDrafts.set(record.id,lfClone(record.payload.mappings||[]));return lfMappingDrafts.get(record.id);}
function lfNewMapping(record){const s=record.payload.inspection.sheets.find(s=>s.name===lfSelection.sheet)||record.payload.inspection.sheets[0];return {id:"table-"+crypto.randomUUID().slice(0,8),sheet:s?.name||"",layout:"wide",first_row:2,last_row:s?.rows||2,period_row:1,first_column:2,last_column:s?.columns||2,period_column:1,value_column:2,geography_column:1,aliases:{},defaults:{area:"",geography:"",metric:"peak_demand",signal:"forecast",season:"summer",period_basis:"summer_year",single_year:"end",unit:"MW",coincidence:"coincident",basis:""}};}
function lfPlanDraft(record){lfDraftRevision("load_plan",record);const id=record?.id||"new";if(!lfPlanDrafts.has(id))lfPlanDrafts.set(id,record?lfClone(record.payload):{label:"",client:"",prepared_for:"",baseline:null,current:null,mode:"forecast_revision",baseline_signal:"forecast",current_signal:"forecast",selection:{areas:[],geographies:[],metrics:[],seasons:[],first_year:1900,last_year:2200},documents:[],explanations:[],purpose:"",assumptions:""});return lfPlanDrafts.get(id);}
function lfReviewDraft(record){lfDraftRevision("load_review",record);if(!lfReviewDrafts.has(record.id))lfReviewDrafts.set(record.id,lfClone(record.payload.review||{note:"",acknowledged:[],decisions:[]}));return lfReviewDrafts.get(record.id);}
function lfTable(headers,rows){return '<div class="lf-table"><table><thead><tr>'+headers.map(v=>'<th>'+h(v)+'</th>').join("")+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+v+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>';}
function lfSourceMetadata(prefix,p,attributes=""){return '<div class="lf-grid">'+lfField("Source label",prefix+"label",p.label,attributes+' data-lf-meta="label"')+lfField("Publisher",prefix+"publisher",p.publisher,attributes+' data-lf-meta="publisher"')+lfField("Forecast / source vintage",prefix+"vintage",p.vintage,attributes+' data-lf-meta="vintage"')+lfField("Publication date",prefix+"published",p.published,'type="date" '+attributes+' data-lf-meta="published"')+lfChoice("Publication role",prefix+"status",[["annual_forecast","Annual forecast"],["informational_update","Informational update"],["observed_data","Observed data"],["adjustment_detail","Adjustment detail"],["reference","Reference document"]],p.status,attributes+' data-lf-meta="status"')+lfField("Original source URL",prefix+"source_url",p.source_url,attributes+' data-lf-meta="source_url"')+'</div>';}
function lfMappingForm(mapping,index,sheets){
 const attr=prop=>'data-lf-map="'+index+'" data-lf-prop="'+prop+'"';
 const input=(title,prop,v,extra="")=>lfField(title,"lf-map-"+index+"-"+prop,v,attr(prop)+" "+extra);
 const choose=(title,prop,options,v)=>lfChoice(title,"lf-map-"+index+"-"+prop,options,v,attr(prop));
 const d=mapping.defaults;
 const aliases=mapping._aliases??Object.entries(mapping.aliases||{}).map(([a,b])=>a+" = "+b).join("\n");
 return '<details class="lf-mapping" open><summary>'+h(mapping.id)+" · "+h(mapping.sheet)+'</summary><div class="lf-grid">'+
 choose("Original sheet","sheet",sheets.map(s=>[s.name,s.name]),mapping.sheet)+
 choose("Table layout","layout",[["wide","Years across columns"],["long","One observation per row"]],mapping.layout)+
 input("First data row","first_row",mapping.first_row,'type="number" min="1"')+
 input("Last data row","last_row",mapping.last_row,'type="number" min="1"')+
 input("Geography column (0 for one geography)","geography_column",lfColumnLabel(mapping.geography_column)||"0")+
 input("One geography, when column is 0","defaults.geography",d.geography)+
 (mapping.layout==="wide"?input("Period heading row","period_row",mapping.period_row,'type="number" min="1"')+
 input("First value column","first_column",lfColumnLabel(mapping.first_column))+input("Last value column","last_column",lfColumnLabel(mapping.last_column)):
 input("Period column","period_column",lfColumnLabel(mapping.period_column))+input("Value column","value_column",lfColumnLabel(mapping.value_column)))+
 input("Planning area","defaults.area",d.area)+
 choose("Metric","defaults.metric",[["peak_demand","Peak demand"],["energy","Energy"]],d.metric)+
 choose("Signal","defaults.signal",[["forecast","Forecast"],["actual","Actual observation"],["weather_normalized","Weather-normalized observation"],["adjustment","Signed adjustment"]],d.signal)+
 choose("Season","defaults.season",[["summer","Summer"],["winter","Winter"],["annual","Annual"],["monthly","Monthly"]],d.season)+
 choose("Period label means","defaults.period_basis",[["calendar_year","Calendar year"],["summer_year","Summer year"],["winter_year","Winter year span"],["delivery_year","Delivery year span"],["calendar_month","Calendar month (YYYY-MM)"]],d.period_basis)+
 choose("Single winter/delivery year names","defaults.single_year",[["end","End year"],["start","Start year"]],d.single_year)+
 choose("Original unit","defaults.unit",["kW","MW","GW","kWh","MWh","GWh","TWh"].map(v=>[v,v]),d.unit)+
 choose("Peak coincidence","defaults.coincidence",[["coincident","Coincident peak"],["noncoincident","Noncoincident peak"],["not_applicable","Not applicable (energy)"]],d.coincidence)+
 input("Comparable definition / basis","defaults.basis",d.basis)+'</div>'+
 lfArea("Explicit geography aliases · one original = reviewed label per line","lf-map-"+index+"-aliases",aliases,attr("_aliases")+' rows="3"')+
 lfButton("remove-mapping","Remove this table",'data-index="'+index+'"')+'</details>';
}
async function lfSourcesView(context){
 const records=lfRecords("load_source");
 let r=records.find(r=>r.id===lfSelection.source);
 if(!r&&lfSelection.source)lfSelection.source=null;
 const select=lfRecordChoice("Retained source","lf-source-select",records,lfValue(r));
 let out='<div class="lf-top">'+select+lfButton("new-source","Upload another source")+'</div>';
 if(!r)return out+'<section class="lf-card"><h2>Retain an original source edition</h2><p>Select the published XLSX workbook, UTF-8 CSV, source packet, or reference PDF. Its actual bytes and publication role stay with the analysis.</p><label>Original file<input id="lf-upload-file" type="file" accept=".xlsx,.csv,.json,.pdf"></label>'+lfSourceMetadata("lf-upload-",lfUploadDraft,'data-lf-upload="1"')+lfButton("upload","Retain complete source")+'</section>';
 r=await entity("load_source",r.id);context.source=r;
 const p=r.payload,editable=p.state!=="ACCEPTED",mappings=lfMappingDraft(r);
 out+='<section class="lf-card"><div class="lf-heading"><div><h2>'+h(p.label)+'</h2>'+lfPin(r)+'</div><strong class="lf-state">'+h(p.state)+" · r"+r.revision+'</strong></div>'+
 lfButtons([lfButton("original","Download original"),'<button data-action="versions" '+lfData("load_source",r)+'>Source history</button>'])+
 '<small class="lf-wrap">'+h(p.original.name)+" · "+h(p.original.bytes)+" bytes · "+h(p.original.digest)+'</small>';
 if(editable)out+=lfDraftNotice("load_source",r,"reload-source")+'<details><summary>Source description</summary>'+lfSourceMetadata("lf-meta-",lfSourceDraft(r),'data-lf-source-meta="1"')+lfButton("describe","Save source description")+'</details>';
 if(p.inspection.sheets.length||p.normalised){
  const sheet=p.inspection.sheets.find(s=>s.name===lfSelection.sheet)||p.inspection.sheets[0];context.sheet=sheet?.name||"";
  const choices=[...(sheet?[["sheet","Original cells"]]:[]),...(p.normalised?[["observations","Mapped observations"],["missing","Missing original cells"]]:[])];
  const mode=choices.some(([value])=>value===lfSelection.sourceTable)?lfSelection.sourceTable:choices[0][0];
  const page=await lfPreview("load_source",r.id,{revision:r.revision,table:mode,...(sheet?{sheet:sheet.name}:{}),offset:lfSelection.offset,limit:25,column_offset:lfSelection.columnOffset});
  context.sourcePage=page;
  out+='<div class="lf-grid">'+lfChoice("Source view","lf-source-table",choices,mode)+(sheet?lfChoice("Original sheet","lf-sheet",p.inspection.sheets.map(s=>[s.name,s.name+" ("+s.rows+" × "+s.columns+")"]),sheet.name):"")+'</div>';
  if(mode==="sheet"){
   out+=lfTable(["Row",...page.columns],page.rows.map(row=>[h(row.row),...row.cells.map((v,i)=>'<span title="'+h(sheet.name+"!"+page.columns[i]+row.row)+'">'+h(v??"")+'</span>')]));
   out+=lfButtons([lfButton("columns-prev","Earlier columns",lfSelection.columnOffset===0?"disabled":""),lfButton("columns-next","Later columns",page.column_offset+page.columns.length>=page.total_columns?"disabled":"")]);
  }else if(mode==="observations")out+=lfTable(["Area","Geography","Metric / signal","Season / period","Unit","Value","Canonical","Original cell"],page.rows.map(row=>[h(row.area),h(row.geography),h(row.metric+" / "+row.signal),h(row.season+" "+row.period_label),h(row.unit),h(row.value),h(row.canonical_value+" "+row.canonical_unit),h(row.sheet+"!"+row.cell)]));
  else out+=lfTable(["Mapping","Sheet","Cell","Period","Geography"],page.rows.map(row=>["mapping_id","sheet","cell","period_label","source_geography"].map(k=>h(row[k]))));
  out+=lfPager("source",page);
 }
 if(editable&&p.inspection.format!=="reference"){
  out+='<h3>Map the selected source tables</h3><p>Match the published period labels, physical units and peak definition. Column letters follow the original workbook. Missing cells stay visible.</p>';
  if(p.inspection.format!=="packet")out+=mappings.map((m,i)=>lfMappingForm(m,i,p.inspection.sheets)).join("")+lfButton("add-mapping","Add a source table");
  out+=lfButton("map","Map and inspect observations");
 }
 if(editable&&(p.state==="MAPPED"||p.inspection.format==="reference")){
  out+='<h3>Accept this source edition</h3><p>'+h(p.row_count||0)+' mapped observations · '+h(p.missing_cells||0)+' selected missing cells.</p>'+lfArea("Source review","lf-source-note","",'rows="3"')+(p.missing_cells?'<label class="lf-check"><input id="lf-missing-ack" type="checkbox">I reviewed the selected missing cells.</label>':"")+lfButton("accept","Accept original source and mapping")+'<p id="lf-source-unsaved" class="lf-meta" hidden>Save the source description and map the edited tables before accepting this edition.</p>';
 }
 if(!editable)out+='<h3>Prepare a revised edition</h3>'+lfArea("What needs to change?","lf-source-revision-note","",'rows="2"')+lfButton("revise-source","Create revised source edition");
 return out+'</section>';
}
function lfScopeChoices(draft){
 const accepted=lfAccepted(),selected=[draft.baseline,draft.current].filter(Boolean).map(r=>accepted.find(a=>a.id===r.id)?.payload.dimensions||{});
 return Object.fromEntries(["areas","geographies","metrics","seasons"].map(field=>[field,Array.from(new Set(selected.flatMap(s=>s[field]||[]))).sort()]));
}
function lfMulti(title,field,values,chosen){return '<label>'+h(title)+'<select id="lf-plan-'+field+'" data-lf-plan-scope="'+field+'" multiple size="5">'+values.map(v=>'<option value="'+h(v)+'"'+(chosen.includes(v)?" selected":"")+'>'+h(v)+'</option>').join("")+'</select><small>Leave clear for all source values.</small></label>';}
async function lfPlansView(context){
 const records=lfRecords("load_plan"),short=records.find(r=>r.id===lfSelection.plan);
 const r=short?await entity("load_plan",short.id):null;context.plan=r;
 const p=lfPlanDraft(r),d=lfScopeChoices(p),tableSources=lfAccepted().filter(r=>r.payload.normalised);
 let out='<div class="lf-top">'+lfRecordChoice("Review plan","lf-plan-select",records,lfValue(r))+lfButton("new-plan","New review plan")+'</div><section class="lf-card"><h2>'+h(r?label(r):"Prepare an analyst review")+'</h2>'+lfDraftNotice("load_plan",r,"reload-plan");
 out+='<div class="lf-grid">'+lfField("Review title","lf-plan-label",p.label,'data-lf-plan="label"')+lfField("Client / project","lf-plan-client",p.client,'data-lf-plan="client"')+lfField("Prepared for","lf-plan-prepared_for",p.prepared_for,'data-lf-plan="prepared_for"')+
 lfRecordChoice("Baseline source edition","lf-plan-baseline",tableSources,lfValue(p.baseline),'data-lf-plan-ref="baseline"')+
 lfRecordChoice("Current source edition","lf-plan-current",tableSources,lfValue(p.current),'data-lf-plan-ref="current"')+
 lfChoice("Review purpose","lf-plan-mode",[["forecast_revision","Compare forecast vintages"],["forecast_accuracy","Compare forecast with observations"]],p.mode,'data-lf-plan="mode"')+
 lfChoice("Current signal","lf-plan-current_signal",p.mode==="forecast_revision"?[["forecast","Forecast"]]:[["actual","Actual observations"],["weather_normalized","Weather-normalized observations"]],p.current_signal,'data-lf-plan="current_signal"')+
 lfField("First selected year","lf-plan-first_year",p.selection.first_year,'type="number" min="1900" max="2200" data-lf-plan-scope="first_year"')+
 lfField("Last selected year","lf-plan-last_year",p.selection.last_year,'type="number" min="1900" max="2200" data-lf-plan-scope="last_year"')+'</div>';
 out+='<div class="lf-grid">'+lfMulti("Planning areas","areas",d.areas,p.selection.areas)+lfMulti("Geographies","geographies",d.geographies,p.selection.geographies)+lfMulti("Metrics","metrics",d.metrics,p.selection.metrics)+lfMulti("Seasons","seasons",d.seasons,p.selection.seasons)+'</div>';
 out+=lfArea("Question this review will answer","lf-plan-purpose",p.purpose,'data-lf-plan="purpose" rows="3"')+lfArea("Definitions, comparison assumptions and limits","lf-plan-assumptions",p.assumptions,'data-lf-plan="assumptions" rows="4"');
 out+='<details><summary>Supporting source editions</summary>'+lfAccepted().map(s=>'<label class="lf-check"><input type="checkbox" data-lf-document="'+h(lfValue(s))+'"'+lfChecked(p.documents.some(a=>lfValue(a)===lfValue(s)))+'>'+h(label(s))+" · "+h(s.payload.status)+'</label>').join("")+'</details>';
 out+='<h3>Source-linked explanations</h3><p>Open a prepared comparison and choose Explain on a matched row. The selected signed adjustment remains distinct from both published forecasts.</p>';
 const adjustments=lfAccepted().filter(s=>(s.payload.signals||[]).includes("adjustment"));
 context.adjustmentRows={};
 for(let i=0;i<p.explanations.length;i++){
  const link=p.explanations[i],pageState=lfAdjustmentPages.get(i)||{offset:0,search:""},source=adjustments.find(s=>s.id===link.source?.id);
  let page=null;
  if(source){page=await lfPreview("load_source",source.id,{revision:source.revision,table:"observations",limit:100,offset:pageState.offset,search:pageState.search});context.adjustmentRows[i]=page;}
  out+='<div class="lf-mapping"><strong>'+h(link._label||link.target_key)+'</strong><div class="lf-grid">'+
   lfRecordChoice("Original adjustment source","lf-explanation-source-"+i,adjustments,lfValue(source),'data-lf-explanation="'+i+'" data-lf-explanation-prop="source"')+
   lfField("Find geography, period or cell","lf-explanation-search-"+i,pageState.search,'data-lf-explanation-search="'+i+'"')+
   lfChoice("Direction in this change","lf-explanation-direction-"+i,[[1,"Add the published adjustment"],[-1,"Subtract the published adjustment"]],link.direction||1,'data-lf-explanation="'+i+'" data-lf-explanation-prop="direction"')+'</div>';
  out+=lfButtons([lfButton("search-adjustments","Find adjustment cells",'data-index="'+i+'"'),lfButton("adjustment-prev","Previous cells",'data-index="'+i+'" '+(!page||page.offset===0?"disabled":"")),lfButton("adjustment-next","Next cells",'data-index="'+i+'" '+(!page||page.next_offset===null?"disabled":""))]);
  const options=(page?.rows||[]).filter(v=>v.signal==="adjustment").map(v=>[v.row_id,v.geography+" · "+v.period_label+" · "+v.value+" "+v.unit+" · "+v.sheet+"!"+v.cell]);
  if(link.source_row_id&&!options.some(([id])=>id===link.source_row_id))options.unshift([link.source_row_id,"Retained selected cell "+link.source_row_id]);
  out+=lfChoice("Exact adjustment observation","lf-explanation-row-"+i,[["","Choose…"],...options],link.source_row_id||"",'data-lf-explanation="'+i+'" data-lf-explanation-prop="source_row_id"')+
   lfArea("How this cell explains the change","lf-explanation-reason-"+i,link.reason||"",'data-lf-explanation="'+i+'" data-lf-explanation-prop="reason" rows="2"')+
   lfButton("remove-explanation","Remove explanation",'data-index="'+i+'"')+'</div>';
 }
 out+=lfButtons([lfButton("save-plan","Save review plan"),lfButton("prepare-review","Save plan and prepare comparison")]);
 if(r)out+='<button data-action="versions" '+lfData("load_plan",r)+'>Plan history</button>';
 return out+'</section>';
}

async function lfReportDisplay(context,record,kind="load_review"){
 const [overview,page]=await Promise.all([lfPreview(kind,record.id,{revision:record.revision}),lfPreview(kind,record.id,{revision:record.revision,table:lfSelection.table,offset:lfSelection.offset,limit:40,search:lfSelection.search})]);
 context.report=overview;context.reportPage=page;context.reportRecord=record;
 let out='<div class="lf-metrics">'+[["Matched",overview.summary.matched],["Changed",overview.summary.changed],["Baseline only",overview.summary.baseline_only],["Current only",overview.summary.current_only]].map(([t,n])=>'<div><span>'+h(t)+'</span><strong>'+h(n)+'</strong></div>').join("")+'</div>';
 const plan=overview.plan.payload;
 out+='<p class="lf-note">'+h(overview.interpretation.difference)+" "+h(overview.interpretation.aggregation)+'</p><p>'+h(plan.purpose)+'</p><div class="lf-grid">'+
 lfChoice("Review table","lf-report-table",[["comparison","Compatible observations"],["growth","Growth over common periods"],["explanations","Source-linked explanations"],["issues","Source and coverage issues"]],lfSelection.table)+
 lfField("Find geography, period or source","lf-report-search",lfSelection.search)+'</div>'+lfButton("report-search","Search this complete table");
 if(lfSelection.table==="comparison"){
  const own=kind==="load_review";
  out+=lfTable(["Geography","Metric / season","Period","Coverage","Unit","Baseline","Current","Change","Change %","Original cells","Review"],page.rows.map((r,i)=>[
   h(r.area+" · "+r.geography),h(r.metric+" / "+r.season),h(r.period_label),h(r.state),h(r.canonical_unit),
   h(lfMoney(r.baseline_value)),h(lfMoney(r.current_value)),h(lfMoney(r.difference)),h(lfMoney(r.change_percent)),
   h((r.baseline?r.baseline.sheet+"!"+r.baseline.cell:"—")+" → "+(r.current?r.current.sheet+"!"+r.current.cell:"—")),
   own?lfButton("row-decision","Decision",'data-index="'+i+'" '+(record.payload.state==="FINALIZED"?"disabled":""))+(r.state==="MATCHED"?lfButton("explain-row","Explain",'data-index="'+i+'"'):""):"Retained"
  ]));
 }else if(lfSelection.table==="growth")out+=lfTable(["Geography","Metric / season","First / last","Unit","Baseline growth","Current growth","Baseline CAGR %","Current CAGR %","Gaps","Accuracy WAPE"],page.rows.map(r=>[
   h(r.area+" · "+r.geography),h(r.metric+" / "+r.season),h(r.first_period+" → "+r.last_period),h(r.canonical_unit),
   h(lfMoney(r.baseline_growth)),h(lfMoney(r.current_growth)),h(lfMoney(r.baseline_cagr_percent)),h(lfMoney(r.current_cagr_percent)),
   h(r.missing_periods_between_endpoints),r.accuracy_wape===null?"—":h(lfMoney(Number(r.accuracy_wape)*100,2))+"%"
 ]));
 else if(lfSelection.table==="explanations")out+=lfTable(["Original source","Geography / period","Cell","Original value","Direction","Explained change","Reason"],page.rows.map(r=>[
  h(r.source.label+" · r"+r.source.revision),h(r.observation.geography+" "+r.observation.period_label),h(r.observation.sheet+"!"+r.observation.cell),
  h(r.observation.value+" "+r.observation.unit),h(r.direction),h(r.signed_amount+" "+r.observation.canonical_unit),h(r.reason)
 ]));
 else out+=lfTable(["Issue","Detail"],page.rows.map(r=>[h(r.title),h(r.detail)]));
 out+=lfPager("report",page);
 out+='<details><summary>Original source editions and calculation definitions</summary>'+overview.sources.map(s=>'<div class="lf-source-pin"><strong>'+h(s.label)+" · r"+s.revision+'</strong><p>'+h(s.publisher)+" · "+h(s.vintage)+" · "+h(s.status)+'</p><small class="lf-wrap">'+h(s.source_url)+'</small><small class="lf-wrap">'+h(s.original.digest)+'</small></div>').join("")+'<dl>'+Object.entries(overview.interpretation).map(([k,v])=>'<dt>'+h(k)+'</dt><dd>'+h(v)+'</dd>').join("")+'</dl></details>';
 return out;
}
async function lfReviewsView(context){
 const records=lfRecords("load_review"),short=records.find(r=>r.id===lfSelection.review)||records[0];
 let out='<div class="lf-top">'+lfRecordChoice("Prepared and finalized reviews","lf-review-select",records,lfValue(short))+lfButton("new-plan","Prepare a new review")+'</div>';
 if(!short)return out+'<section class="lf-card"><h2>Compare retained load forecasts</h2><p>Retain the original source files, accept their explicit table mappings and prepare an analyst review. The result keeps source definitions, unmatched periods, explanatory adjustments and reviewer decisions together.</p>'+lfButton("sources","Open original sources")+'</section>';
 const r=await entity("load_review",short.id);context.review=r;const p=r.payload,draft=lfReviewDraft(r);
 out+='<section class="lf-card"><div class="lf-heading"><h2>'+h(p.label)+'</h2><strong class="lf-state">'+h(p.state)+" · r"+r.revision+'</strong></div>';
 out+=lfDraftNotice("load_review",r,"reload-review");
 out+=await lfReportDisplay(context,r);
 if(p.state!=="FINALIZED"){
  out+='<h3>Review this exact comparison</h3>'+context.report.issues.map(issue=>'<label class="lf-check"><input type="checkbox" data-lf-issue="'+h(issue.id)+'"'+lfChecked(draft.acknowledged.includes(issue.id))+'><span><strong>'+h(issue.title)+'</strong> — '+h(issue.detail)+'</span></label>').join("")+
   lfArea("Review conclusion","lf-review-note",draft.note,'data-lf-review-note="1" rows="4"')+
   '<p>'+draft.decisions.length+' retained row decisions. A follow-up or exclusion remains visible in the final report.</p>'+
   lfButtons([lfButton("decide","Save reviewer decisions"),...(p.state==="REVIEWED"?[lfButton("finalize","Finalize this reviewed edition")]:[])])+'<p id="lf-review-unsaved" class="lf-meta" hidden>Save the edited conclusion and row decisions before finalizing this edition.</p>';
 }else out+='<h3>Finalized conclusion</h3><p>'+h(p.review.note)+'</p>'+lfButtons([lfButton("export","Build complete analyst delivery")])+lfArea("Reason for a new review","lf-reopen-note","",'rows="2"')+lfButton("reopen","Reopen as a new review edition");
 const exports=lfRecords("load_export").filter(e=>e.payload.review.id===r.id);
 if(exports.length)out+='<h3>Complete retained deliveries</h3>'+lfTable(["Finalized edition","Contents","Downloads"],exports.map(e=>[h("r"+e.payload.review.revision+" · "+e.created),h(e.payload.summary.comparison_rows+" observations · "+e.payload.summary.workbook_sheets+" workbook sheets"),
  lfButton("download-export","Complete ZIP",'data-id="'+h(e.id)+'" data-file="package"')+lfButton("download-export","Editable workbook",'data-id="'+h(e.id)+'" data-file="workbook"')+lfButton("download-export","Analyst report",'data-id="'+h(e.id)+'" data-file="analyst_report"')]));
 out+='<button data-action="versions" '+lfData("load_review",r)+'>Review history</button></section>';
 out+='<dialog id="lf-decision-dialog"><h2>Observation decision</h2><p id="lf-decision-label"></p><input id="lf-decision-key" type="hidden">'+
  lfChoice("Disposition","lf-decision-value",[["reviewed","Reviewed"],["follow_up","Follow up"],["excluded","Exclude from interpretation"]],"reviewed")+
  lfArea("Reason and source interpretation","lf-decision-note","",'rows="4"')+
  lfButtons([lfButton("save-row-decision","Keep this decision"),lfButton("close-decision","Cancel")])+'</dialog>';
 return out;
}
async function lfReceivingView(context){
 const records=lfRecords("load_received"),short=records.find(r=>r.id===lfSelection.received)||records[0];
 let out='<section class="lf-card"><h2>Receive a complete analyst package</h2><p>Select the original load-review ZIP. The original service checks every retained member, reopens the source mappings and recalculates the same review before it is received.</p><label>Complete review ZIP<input id="lf-receive-file" type="file" accept=".zip"></label>'+lfButton("receive","Receive and reopen package")+'</section>'+
 lfRecordChoice("Received deliveries","lf-received-select",records,lfValue(short));
 if(!short)return out;
 const r=await entity("load_received",short.id);context.received=r;const p=r.payload;
 out+='<section class="lf-card"><div class="lf-heading"><h2>'+h(p.label)+'</h2><strong class="lf-state">'+h(p.state)+'</strong></div><small class="lf-wrap">'+h(p.origin_package_sha256)+'</small>';
 out+=lfButtons([lfButton("download-received","Download original complete package"),p.state==="ADOPTED"?lfButton("open-adopted","Open editable review plan"):lfButton("adopt","Continue as an editable plan")]);
 out+=await lfReportDisplay(context,r,"load_received");
 return out+'</section>';
}
async function loadForecastView(){
 if(lfWorkspaceId!==workspace.workspace_id){lfWorkspaceId=workspace.workspace_id;lfMappingDrafts.clear();lfSourceDrafts.clear();lfPlanDrafts.clear();lfReviewDrafts.clear();lfAdjustmentPages.clear();lfDraftRevisions.clear();}
 const context={pane:lfSelection.pane};
 const builder={sources:lfSourcesView,plans:lfPlansView,reviews:lfReviewsView,receiving:lfReceivingView}[lfSelection.pane];
 const body=await builder(context);
 return {html:'<div class="lf-workspace"><div class="lf-nav">'+lfPanes.map(p=>lfButton("pane",({sources:"Sources",plans:"Review plans",reviews:"Analyst reviews",receiving:"Receiving"})[p],'data-pane="'+p+'" '+(p===lfSelection.pane?'class="active"':""))).join("")+'</div>'+body+'</div>',context};
}
function loadForecastSetBusy(active){
 const panel=document.querySelector(".lf-workspace");
 if(panel){panel.inert=Boolean(active);panel.setAttribute("aria-busy",String(Boolean(active)));}
}
function loadForecastCommitView(view){lfCurrent=view.context;lfSaveSelection();lfUpdateTerminalButtons();loadForecastSetBusy(busy);}
async function lfImportOriginal(action,file,fields={}){
 if(busy)throw new Error("The current original operation is still running.");
 const body=lfClone(fields);let attachment;
 busy=true;document.body.dataset.busy="true";$("connection").textContent="Reading original file…";loadForecastSetBusy(true);
 try{attachment=await filePayload(file);}
 finally{busy=false;document.body.dataset.busy="false";$("connection").textContent="Workspace connected";loadForecastSetBusy(false);}
 return act(action,{...body,...attachment});
}
function loadForecastOperationSaved(action,record){
 lfDraftRevisions.delete(record.kind+":"+record.id);
 if(record.kind==="load_source"){lfSelection.source=record.id;lfSelection.pane="sources";if(action!=="load.source.describe")lfMappingDrafts.delete(record.id);lfSourceDrafts.delete(record.id);if(action==="load.source.describe")lfDraftRevisions.set("load_source:"+record.id,record.revision);if(action==="load.source.upload"||action==="load.source.revise"){lfSelection.offset=0;lfSelection.columnOffset=0;lfSelection.sheet="";lfSelection.sourceTable="sheet";}}
 if(record.kind==="load_plan"){lfSelection.plan=record.id;lfPlanDrafts.delete(record.id);lfPlanDrafts.delete("new");}
 if(record.kind==="load_review"){lfSelection.review=record.id;lfSelection.pane="reviews";lfReviewDrafts.delete(record.id);if(action==="load.review.prepare"){lfSelection.offset=0;lfSelection.search="";lfSelection.table="comparison";}}
 if(record.kind==="load_received"){lfSelection.received=record.id;lfSelection.pane="receiving";if(record.payload.editable_plan){lfSelection.plan=record.payload.editable_plan.id;lfSelection.pane="plans";}}
 lfSaveSelection();
}
function lfCleanMappings(record){return lfCleanMappingValues(lfMappingDraft(record));}
function lfCleanMappingValues(values){
 return values.map(original=>{
  const m=lfClone(original);m.aliases={};
  const aliases=m._aliases??Object.entries(original.aliases||{}).map(([a,b])=>a+" = "+b).join("\n");
  for(const line of aliases.split("\n").map(l=>l.trim()).filter(Boolean)){const at=line.indexOf("=");if(at<1||!line.slice(at+1).trim())throw new Error("Each alias needs original = reviewed label.");const key=line.slice(0,at).trim();if(Object.hasOwn(m.aliases,key))throw new Error("The same original label has two aliases.");m.aliases[key]=line.slice(at+1).trim();}
  delete m._aliases;
  for(const k of ["geography_column","first_column","last_column","period_column","value_column"])if(m[k]!==undefined)m[k]=lfColumn(m[k]);
  for(const k of ["first_row","last_row","period_row"])if(m[k]!==undefined)m[k]=Number(m[k]);
  return m;
 });
}
function lfCanonical(value){if(Array.isArray(value))return "["+value.map(lfCanonical).join(",")+"]";if(value&&typeof value==="object")return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+lfCanonical(value[k])).join(",")+"}";return JSON.stringify(value);}
function lfSourceMetadataChanged(record){const draft=lfSourceDraft(record);return ["label","publisher","vintage","published","status","source_url"].some(k=>String(draft[k]??"")!==String(record.payload[k]??""));}
function lfSourceChanged(record){if(lfSourceMetadataChanged(record))return true;try{return lfCanonical(lfCleanMappings(record))!==lfCanonical(lfCleanMappingValues(record.payload.mappings||[]));}catch(_){return true;}}
function lfReviewChanged(record){
 const fields=value=>({note:value?.note||"",acknowledged:[...(value?.acknowledged||[])].sort(),decisions:[...(value?.decisions||[])].map(d=>({key:d.key,decision:d.decision,note:d.note})).sort((a,b)=>a.key.localeCompare(b.key))});
 return lfCanonical(fields(lfReviewDraft(record)))!==lfCanonical(fields(record.payload.review));
}
function lfUpdateTerminalButtons(){
 const source=lfCurrent.source,review=lfCurrent.review,accept=document.querySelector('[data-action="lf-accept"]'),finalize=document.querySelector('[data-action="lf-finalize"]');
 if(accept&&source){const changed=lfSourceChanged(source),stale=lfStaleDraft("load_source",source);accept.disabled=changed||stale;const note=$("lf-source-unsaved");if(note)note.hidden=!changed;}
 if(finalize&&review){const changed=lfReviewChanged(review),stale=lfStaleDraft("load_review",review);finalize.disabled=changed||stale;const note=$("lf-review-unsaved");if(note)note.hidden=!changed;}
}
function lfPlanBody(){
 const r=lfCurrent.plan,p=lfClone(lfPlanDraft(r));delete p._operation_id;
 p.explanations=p.explanations.map(({_label,...link})=>link);
 return {...(r?{id:r.id,expected:lfDraftRevision("load_plan",r)}:{}),plan:p};
}
async function loadForecastAction(action,button){
  if(busy)throw new Error("The current original operation is still running.");
  action=action.slice(3);
 const r=lfCurrent.source,review=lfCurrent.review,received=lfCurrent.received,index=Number(button.dataset.index);
 if(action==="pane"){lfSelection.pane=button.dataset.pane;lfSelection.offset=0;lfSelection.search="";return render();}
 if(action==="sources"){lfSelection.pane="sources";return render();}
 if(action==="new-source"){lfSelection.pane="sources";lfSelection.source=null;lfSelection.offset=0;return render();}
 if(action==="new-plan"){lfSelection.pane="plans";lfSelection.plan=null;lfPlanDrafts.delete("new");return render();}
 if(action==="reload-source"){lfSourceDrafts.delete(r.id);lfMappingDrafts.delete(r.id);lfDraftRevisions.delete("load_source:"+r.id);return render();}
 if(action==="reload-plan"){lfPlanDrafts.delete(lfCurrent.plan.id);lfDraftRevisions.delete("load_plan:"+lfCurrent.plan.id);return render();}
 if(action==="reload-review"){lfReviewDrafts.delete(review.id);lfDraftRevisions.delete("load_review:"+review.id);return render();}
  if(action==="upload")return lfImportOriginal("load.source.upload",$("lf-upload-file").files[0],lfUploadDraft);
 if(action==="describe"){const body=Object.fromEntries(["label","publisher","vintage","published","status","source_url"].map(k=>[k,value("lf-meta-"+k)]));return act("load.source.describe",{id:r.id,expected:lfDraftRevision("load_source",r),...body});}
 if(action==="original")return download("/api/object/"+r.payload.original.digest,r.payload.original.name);
 if(action==="add-mapping"){lfMappingDraft(r).push(lfNewMapping(r));return render();}
 if(action==="remove-mapping"){lfMappingDraft(r).splice(index,1);return render();}
 if(action==="map"){if(lfSourceMetadataChanged(r))throw new Error("Save the source description before mapping. Your table edits are retained.");return act("load.source.map",{id:r.id,expected:lfDraftRevision("load_source",r),mappings:lfCleanMappings(r)});}
 if(action==="accept"){if(lfSourceChanged(r)||lfStaleDraft("load_source",r))throw new Error("Save the source description and mapping, or reload the changed source, before accepting this edition.");return act("load.source.accept",{id:r.id,expected:lfDraftRevision("load_source",r),note:value("lf-source-note"),acknowledge_missing:!!$("lf-missing-ack")?.checked});}
 if(action==="revise-source")return act("load.source.revise",{source:ref(r),note:value("lf-source-revision-note")});
 if(action==="source-prev"||action==="source-next"){lfSelection.offset=Math.max(0,lfSelection.offset+(action.endsWith("next")?25:-25));return render();}
 if(action==="columns-prev"||action==="columns-next"){lfSelection.columnOffset=Math.max(0,lfSelection.columnOffset+(action.endsWith("next")?20:-20));return render();}
 if(action==="save-plan"||action==="prepare-review"){const saved=await act("load.plan.save",lfPlanBody());if(action==="prepare-review")return act("load.review.prepare",{plan:ref(saved)});return saved;}
 if(action==="search-adjustments"||action==="adjustment-prev"||action==="adjustment-next"){const previous=lfAdjustmentPages.get(index)||{offset:0,search:""};lfAdjustmentPages.set(index,{offset:action==="search-adjustments"?0:Math.max(0,previous.offset+(action.endsWith("next")?100:-100)),search:value("lf-explanation-search-"+index)});return render();}
 if(action==="remove-explanation"){lfPlanDraft(lfCurrent.plan).explanations.splice(index,1);lfAdjustmentPages.clear();return render();}
 if(action==="report-search"){lfSelection.search=value("lf-report-search");lfSelection.offset=0;return render();}
 if(action==="report-prev"||action==="report-next"){lfSelection.offset=Math.max(0,lfSelection.offset+(action.endsWith("next")?40:-40));return render();}
 if(action==="row-decision"){
  const row=lfCurrent.reportPage.rows[index],draft=lfReviewDraft(review),previous=draft.decisions.find(d=>d.key===row.key);
  $("lf-decision-key").value=row.key;$("lf-decision-label").textContent=row.geography+" · "+row.season+" "+row.period_label+" · "+row.canonical_unit;
  $("lf-decision-value").value=previous?.decision||"reviewed";$("lf-decision-note").value=previous?.note||"";$("lf-decision-dialog").showModal();return;
 }
 if(action==="close-decision")return $("lf-decision-dialog").close();
 if(action==="save-row-decision"){
  const key=value("lf-decision-key"),note=value("lf-decision-note").trim();if(!note)throw new Error("Explain the row decision.");
  const draft=lfReviewDraft(review);draft.decisions=draft.decisions.filter(d=>d.key!==key);draft.decisions.push({key,decision:value("lf-decision-value"),note});
  $("lf-decision-dialog").close();return render();
 }
 if(action==="explain-row"){
  const row=lfCurrent.reportPage.rows[index],plan=lfCurrent.report.plan,draft=lfPlanDraft(plan);
  draft.explanations.push({target_key:row.key,_label:row.geography+" · "+row.season+" "+row.period_label,source:null,source_row_id:"",direction:1,reason:""});
  lfSelection.plan=plan.id;lfSelection.pane="plans";return render();
 }
 if(action==="decide"){const draft=lfReviewDraft(review);return act("load.review.decide",{id:review.id,expected:lfDraftRevision("load_review",review),note:draft.note,acknowledged:draft.acknowledged,decisions:draft.decisions});}
 if(action==="finalize"){if(lfReviewChanged(review)||lfStaleDraft("load_review",review))throw new Error("Save the edited conclusion and row decisions, or reload the changed review, before finalizing this edition.");return act("load.review.finalize",{id:review.id,expected:lfDraftRevision("load_review",review),expected_report_digest:review.payload.report.digest});}
 if(action==="reopen")return act("load.review.reopen",{id:review.id,expected:review.revision,note:value("lf-reopen-note")});
 if(action==="export")return act("load.review.export",{review:ref(review)});
 if(action==="download-export"){const e=lfRecords("load_export").find(e=>e.id===button.dataset.id),file=e.payload[button.dataset.file];return download("/api/object/"+file.digest,file.name);}
  if(action==="receive")return lfImportOriginal("load.delivery.receive",$("lf-receive-file").files[0]);
 if(action==="adopt")return act("load.delivery.adopt",{received:ref(received)});
 if(action==="download-received")return download("/api/object/"+received.payload.package.digest,received.payload.package.name);
 if(action==="open-adopted"){lfSelection.plan=received.payload.editable_plan.id;lfSelection.pane="plans";return render();}
}
function lfCaptureInput(target){
  if(busy)return;
 if(target.dataset.lfUpload!==undefined&&target.dataset.lfMeta)lfUploadDraft[target.dataset.lfMeta]=target.value;
 if(target.dataset.lfSourceMeta!==undefined&&target.dataset.lfMeta&&lfCurrent.source)lfSourceDraft(lfCurrent.source)[target.dataset.lfMeta]=target.value;
 if(target.dataset.lfMap!==undefined&&lfCurrent.source){
  const mapping=lfMappingDraft(lfCurrent.source)[Number(target.dataset.lfMap)],parts=target.dataset.lfProp.split(".");
  if(parts.length===2)mapping[parts[0]][parts[1]]=target.value;else mapping[parts[0]]=target.value;
 }
 if(target.dataset.lfPlan!==undefined&&lfCurrent.pane==="plans"){
  const draft=lfPlanDraft(lfCurrent.plan);draft[target.dataset.lfPlan]=target.value;
  if(target.dataset.lfPlan==="mode"){draft.current_signal=target.value==="forecast_revision"?"forecast":"actual";}
 }
 if(target.dataset.lfPlanRef!==undefined&&lfCurrent.pane==="plans")lfPlanDraft(lfCurrent.plan)[target.dataset.lfPlanRef]=target.value?lfReference("load_source",target.value):null;
 if(target.dataset.lfPlanScope!==undefined&&lfCurrent.pane==="plans")lfPlanDraft(lfCurrent.plan).selection[target.dataset.lfPlanScope]=target.multiple?Array.from(target.selectedOptions).map(o=>o.value):Number(target.value);
 if(target.dataset.lfDocument!==undefined&&lfCurrent.pane==="plans"){const draft=lfPlanDraft(lfCurrent.plan),v=target.dataset.lfDocument;draft.documents=draft.documents.filter(r=>lfValue(r)!==v);if(target.checked)draft.documents.push(lfReference("load_source",v));}
 if(target.dataset.lfExplanation!==undefined&&lfCurrent.pane==="plans"){
  const link=lfPlanDraft(lfCurrent.plan).explanations[Number(target.dataset.lfExplanation)],prop=target.dataset.lfExplanationProp;
  link[prop]=prop==="source"?(target.value?lfReference("load_source",target.value):null):prop==="direction"?Number(target.value):target.value;
  if(prop==="source"){link.source_row_id="";lfAdjustmentPages.delete(Number(target.dataset.lfExplanation));}
 }
 if(target.dataset.lfReviewNote!==undefined&&lfCurrent.review)lfReviewDraft(lfCurrent.review).note=target.value;
 if(target.dataset.lfIssue!==undefined&&lfCurrent.review){const d=lfReviewDraft(lfCurrent.review),id=target.dataset.lfIssue;d.acknowledged=d.acknowledged.filter(v=>v!==id);if(target.checked)d.acknowledged.push(id);}
 lfUpdateTerminalButtons();
}
document.addEventListener("input",event=>{if(typeof tab!=="undefined"&&tab==="load")lfCaptureInput(event.target);});
document.addEventListener("change",event=>{
  if(typeof tab==="undefined"||tab!=="load"||busy)return;
 const t=event.target;lfCaptureInput(t);
 run(async()=>{
  const selects={"lf-source-select":["source","sources"],"lf-plan-select":["plan","plans"],"lf-review-select":["review","reviews"],"lf-received-select":["received","receiving"]};
  if(selects[t.id]){lfSelection[selects[t.id][0]]=t.value.split("@")[0]||null;lfSelection.pane=selects[t.id][1];lfSelection.offset=0;lfSelection.search="";if(t.id==="lf-source-select"){lfSelection.sheet="";lfSelection.columnOffset=0;}return render();}
  if(t.id==="lf-sheet"){lfSelection.sheet=t.value;lfSelection.offset=0;lfSelection.columnOffset=0;return render();}
  if(t.id==="lf-source-table"){lfSelection.sourceTable=t.value;lfSelection.offset=0;return render();}
  if(t.id==="lf-report-table"){lfSelection.table=t.value;lfSelection.offset=0;lfSelection.search="";return render();}
  if(t.dataset.lfPlanRef!==undefined||t.dataset.lfPlan==="mode"||t.dataset.lfProp==="layout"||t.dataset.lfExplanationProp==="source")return render();
 });
});
