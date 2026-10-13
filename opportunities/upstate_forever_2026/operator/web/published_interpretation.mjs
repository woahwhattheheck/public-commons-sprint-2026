const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const arr = value => Array.isArray(value) ? value : [];
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const words = value => String(value ?? "").replace(/[_-]/g," ").replace(/\s+/g," ");
const statusLabel = value => ({
  ABOVE_THRESHOLD:"Above selected threshold",AT_OR_BELOW_THRESHOLD:"At or below selected threshold",
  INDETERMINATE:"Comparison indeterminate",OUTSIDE_SCOPE:"Outside selected scope",EXCLUDED:"Excluded from calculation",
  NOT_ASSESSED:"Contextual rule",ANALYST_CONFIRMED:"Analyst applicability recorded",DESCRIPTIVE_COMPARISON:"Descriptive comparison"
}[value] || words(value));
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const emptySelection = () => ({site_ids:[],parameters:[],strata:[],year:null,months:[]});
const safeURL = value => {
  try { const url=new URL(value); return url.protocol==="https:" ? url.href : ""; } catch { return ""; }
};
const lines = values => arr(values).map(value=>'<li>'+esc(value)+'</li>').join("");
const options = (values,selected=[]) => values.map(value=>{
  const id=typeof value==="object"?value.id:value, text=typeof value==="object"?value.label:value;
  return '<option value="'+esc(id)+'"'+(selected.map(String).includes(String(id))?" selected":"")+'>'+esc(text)+'</option>';
}).join("");
const table = (headers,rows) => '<div class="pmi-table" tabindex="0"><table><thead><tr>'+headers.map(v=>'<th scope="col">'+esc(v)+'</th>').join("")+
  '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>';
const taskList = state => {
  const value=state?.tasks;
  return Array.isArray(value)?value:Array.isArray(value?.items)?value.items:Object.values(value||{}).filter(v=>v&&typeof v==="object"&&v.id);
};
const LABELS = {sourceIds:"Source documents",requiredConfirmations:"Required site and source confirmations",windowDays:"Window length in calendar days",minSamples:"Required samples",sourceMinSamples:"Minimum samples stated by the source",minSamplesBasis:"Sampling requirement and its source",minSpacingHours:"Minimum spacing in hours",allowedExcursionFraction:"Permitted excursion fraction",seasonMonths:"Selected season months",pairedMetricId:"Paired comparison",descriptiveFractionAllowed:"Descriptive fraction available",assessmentRequiresPairedSupport:"Paired sampling support required",sourceSeparatelyPrescribesMinimum:"Source states a separate sample minimum",requireMonthlyCompositeConfirmation:"Monthly composite confirmation required",requireExactlyOneSelectedRepresentativePerMonth:"Exactly one reviewed representative per required month",criterion:"Criterion unit",methodReviewRequired:"Analytical method review required",noAutomaticCfuMpnConversion:"CFU and MPN remain separate",waterType:"Water type",designatedUses:"Designated uses",spatialQualifier:"Site applicability",source_quantity:"Original scientific quantity"};
const fieldLabel = key => LABELS[key] || words(String(key).replace(/([a-z0-9])([A-Z])/g,"$1 $2"));
const readable = value => {
  if(value===null||value===undefined||value==="")return '<span class="pmi-muted">Not specified</span>';
  if(typeof value==="boolean")return value?"Yes":"No";
  if(Array.isArray(value))return value.length?'<ul>'+value.map(v=>'<li>'+readable(v)+'</li>').join("")+'</ul>':'<span class="pmi-muted">None specified</span>';
  if(typeof value==="object")return '<dl class="pmi-definition">'+Object.entries(value).map(([k,v])=>'<dt>'+esc(fieldLabel(k))+'</dt><dd>'+readable(v)+'</dd>').join("")+'</dl>';
  return esc(value);
};
const metricName = value => ({geometric_mean:"Geometric mean",exceedance_fraction:"Excursion fraction",single_sample:"Individual measurement",seasonal_arithmetic_mean:"Seasonal arithmetic mean",ten_day_assessment_periods:"Ten-day assessment periods"}[value]||words(value));
const windowCriterion = metric => metric.aggregation==="exceedance_fraction"?
  '<strong>Measurement threshold</strong><br>Above '+esc(metric.measurement_threshold)+' '+esc(metric.criterion_unit)+
  '<br><strong>Permitted fraction</strong><br>'+esc(metric.threshold)+' of selected canonical routine records':
  esc(metric.measurement_threshold??metric.threshold)+' '+esc(metric.criterion_unit)+(metric.status==="NOT_ASSESSED"?'<br>Contextual rule; see its source definition':"");
const windowBounds = metric => metric.status==="NOT_ASSESSED"?"Not assessed":
  metric.lower===null&&metric.upper===null?"Bounds undetermined":
  metric.lower===null?'Upper bound '+esc(metric.upper):
  metric.upper===null?'Lower bound '+esc(metric.lower):
  metric.lower===metric.upper?esc(metric.lower):esc(metric.lower)+" to "+esc(metric.upper);

const PAGE=60, PREFIX="published-study.interpretation.";

/** Monitoring interpretation in the existing Published studies lifecycle and task queue. */
export function createPublishedInterpretation(host, course) {
  let node=null, events=null, workspace=null, key="", complete=null, catalog=null;
  let draft=null, preview=null, opened=null, selectedSaved="", sourceLinks=[], catalogSources=[], result=null, resultKind="", resultProfile=null;
  let generation=0, edit=0, busy=false, message="", error=false, loadSerial=0, pendingIntent=null;
  let rowPage=0, windowPage=0, rowFilter="selected", windowFilter="", detailId="", lastTask="";
  let receiveChoice=null;
  const drafts=new Map();
  const ctx=()=>course.context();
  const find=selector=>node?.querySelector(selector);
  const identity=value=>value?.record?.study_id&&value?.record?.version_id?value.record.study_id+"|"+value.record.version_id:"";
  const active=(g,k,w)=>Boolean(node)&&generation===g&&key===k&&workspace===w&&host.getWorkspace()===w;
  const isBusy=()=>busy||Boolean(ctx()?.busy);
  const storageKey=()=> "upstate.monitoring-draft.v1:"+encodeURIComponent(workspace||"")+":"+encodeURIComponent(key);
  function notify(text,bad=false) {
    message=text;error=bad;
    const target=find("[data-pmi-status]");
    if(target){target.textContent=text;target.classList.toggle("pmi-error",bad);}
  }
  function remember() {
    if(!draft||!key||!workspace)return;
    const value={schema:"upstate.monitoring-browser-draft/v1",workspace,key,draft:copy(draft),lastTask};
    drafts.set(workspace+"|"+key,value);
    try{localStorage.setItem(storageKey(),JSON.stringify(value));}catch{}
  }
  function initial() {
    const rows=arr(complete?.observation_rows),dates=rows.map(r=>r.date).filter(Boolean).sort();
    return {title:(complete?.study?.title||"Monitoring study")+" — reference comparison",profile_id:"",
      selection:copy(ctx()?.selection||emptySelection()),period:{start:dates[0]||"",end:dates.at(-1)||""},
      applicability:{jurisdiction:"",water_use:"",reviewer:"",note:"",method_note:"",confirmed:false,confirmations:{}},
      options:{include_qualified:false,qualified_note:""},parent_id:null};
  }
  function restore() {
    let stored=drafts.get(workspace+"|"+key);
    if(!stored){try{stored=JSON.parse(localStorage.getItem(storageKey())||"null");}catch{}}
    if(stored?.schema==="upstate.monitoring-browser-draft/v1"&&stored.workspace===workspace&&stored.key===key&&stored.draft&&
       typeof stored.draft.title==="string"&&stored.draft.period&&stored.draft.selection&&stored.draft.applicability&&stored.draft.options&&
       ["site_ids","parameters","strata","months"].every(k=>Array.isArray(stored.draft.selection[k]))) {
      draft=copy(stored.draft);lastTask=typeof stored.lastTask==="string"?stored.lastTask:"";
    } else {draft=initial();lastTask="";}
  }
  function profile() {return arr(catalog?.profiles).find(p=>p.id===draft?.profile_id)||null;}
  function selectionValues(field) {
    const rows=arr(complete?.observation_rows);
    let values=field==="site_ids"?arr(complete?.available_stations).map(r=>r.site_id):
      field==="parameters"?rows.map(r=>r.parameter):rows.map(r=>r.stratum);
    return [...new Set([...values,...arr(draft?.selection?.[field])].filter(v=>v!==null&&v!==undefined&&v!==""))].sort();
  }
  function edited() {
    ++edit;preview=null;rowPage=0;windowPage=0;remember();buttons();renderResultHeading();
    notify(opened?"Working changes are separate from the saved version. Preview to calculate them.":"Preview the selected original observations.");
  }
  function readForm() {
    const form=find("[data-pmi-form]");if(!form||!draft)return;
    const data=new FormData(form);
    draft.title=String(data.get("pmi_title")||"");
    draft.profile_id=String(data.get("pmi_profile")||"");
    draft.selection={site_ids:data.getAll("pmi_site").map(String),parameters:data.getAll("pmi_parameter").map(String),
      strata:data.getAll("pmi_stratum").map(String),year:data.get("pmi_year")?Number(data.get("pmi_year")):null,
      months:data.getAll("pmi_month").map(Number)};
    draft.period={start:String(data.get("pmi_start")||""),end:String(data.get("pmi_end")||"")};
    draft.applicability={jurisdiction:String(data.get("pmi_jurisdiction")||""),water_use:String(data.get("pmi_water_use")||""),
      reviewer:String(data.get("pmi_reviewer")||""),note:String(data.get("pmi_note")||""),method_note:String(data.get("pmi_method_note")||""),
      confirmed:data.has("pmi_confirmed"),confirmations:Object.fromEntries(arr(profile()?.applicability?.requiredConfirmations).map(id=>[id,data.getAll("pmi_confirmation").includes(id)]))};
    draft.options={include_qualified:data.has("pmi_include_qualified"),qualified_note:String(data.get("pmi_qualified_note")||"")};
  }
  function currentRequest() {
    return {study_id:complete.record.study_id,version_id:complete.record.version_id,profile_id:draft.profile_id,
      selection:copy(draft.selection),period:copy(draft.period),applicability:copy(draft.applicability),options:copy(draft.options)};
  }
  function field(label,name,value,type="text",max=240) {
    return '<label>'+esc(label)+'<input name="'+name+'" type="'+type+'" maxlength="'+max+'" value="'+esc(value)+'"></label>';
  }
  function textArea(label,name,value) {
    return '<label class="pmi-wide">'+esc(label)+'<textarea name="'+name+'" rows="3" maxlength="12000">'+esc(value)+'</textarea></label>';
  }
  function profileHTML(p, references=catalogSources) {
    if(!p)return '<p>Select a profile to inspect its authority and sampling requirements.</p>';
    const sources=arr(references).filter(s=>arr(p.authority?.sourceIds).includes(s.id));
    const sourceHTML=sources.map(s=>{
      const url=safeURL(s.url);
      return '<li>'+(url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(s.title)+'</a>':esc(s.title))+
        '<p>'+esc(s.edition||"")+'</p><p>'+esc(arr(s.locators).join("; "))+'</p></li>';
    }).join("");
    return '<h4>'+esc(p.label)+'</h4><p>'+esc(p.authority?.jurisdiction)+' · '+esc(p.authority?.edition)+'</p>'+
      '<p>'+esc(arr(p.authority?.locators).join("; "))+'</p><p>'+esc(p.applicabilityNote||p.applicability?.spatialQualifier||"")+'</p>'+
      table(["Metric","Magnitude","Original criterion unit","Window and sampling"],arr(p.metrics).map(m=>[
        esc(metricName(m.aggregation)),esc(m.threshold)+(m.aggregation==="exceedance_fraction"?"<br>Permitted fraction: "+esc(m.allowedExcursionFraction):""),esc(p.units?.criterion),
        esc([m.windowDays?m.windowDays+" calendar days":null,m.minSamples?m.minSamples+" samples":null,
          m.minSpacingHours?m.minSpacingHours+" hours apart":null,m.assessment==="contextual"?"Contextual frequency rule":null,
          m.requireExactlyOneSelectedRepresentativePerMonth?"One reviewed composite in every required month":null].filter(Boolean).join("; "))]))+
      '<details><summary>Source documents and interpretation limits</summary><ul>'+sourceHTML+'</ul><ul>'+lines(p.limitations)+'</ul>'+
      readable({applicability:p.applicability,units:p.units,metrics:p.metrics,method:p.method,frequency:p.frequency,contextualRules:p.contextualRules})+'</details>';
  }
  function renderForm() {
    const target=find("[data-pmi-editor]");if(!target)return;
    if(!complete||!draft){target.innerHTML='<p class="pmi-empty">Select a retained study to work with its original observations.</p>';return;}
    if(!arr(complete.observation_rows).length){target.innerHTML='<p class="pmi-empty">This retained study has no dated original observation rows. Choose an observation study from the existing study selector.</p>';return;}
    const p=profile(),app=draft.applicability,selection=draft.selection;
    const years=[...new Set(arr(complete.observation_rows).map(r=>String(r.date||"").slice(0,4)).filter(v=>/^\d{4}$/.test(v)))].sort();
    const confirms=arr(p?.applicability?.requiredConfirmations).map(id=>'<label class="pmi-check"><input type="checkbox" name="pmi_confirmation" value="'+esc(id)+'"'+(app.confirmations?.[id]?" checked":"")+'> '+esc(words(id))+'</label>').join("");
    target.innerHTML='<form data-pmi-form><div class="pmi-grid">'+field("Comparison title","pmi_title",draft.title,"text",200)+
      '<label>Source profile<select name="pmi_profile"><option value="">Choose a source profile</option>'+options(arr(catalog?.profiles).map(p=>({id:p.id,label:p.label})),[draft.profile_id])+'</select></label>'+
      '</div><div class="pmi-actions"><button type="button" data-pmi-action="use-study-filters">Use current study filters</button><button type="button" data-pmi-action="new">New comparison</button></div>'+
      '<details open><summary>Original observations and period</summary><p>Empty station, parameter, stratum or month selections include all available values. Stations, methods and original measured units remain separate analytical series.</p><div class="pmi-grid">'+
      '<label>Stations<select multiple size="5" name="pmi_site">'+options(selectionValues("site_ids"),selection.site_ids)+'</select></label>'+
      '<label>Parameters<select multiple size="5" name="pmi_parameter">'+options(selectionValues("parameters"),selection.parameters)+'</select></label>'+
      '<label>Strata<select multiple size="3" name="pmi_stratum">'+options(selectionValues("strata"),selection.strata)+'</select></label>'+
      '<label>Sampling year<select name="pmi_year"><option value="">All retained years</option>'+options(years,[selection.year])+'</select></label>'+
      '<label>Sampling months<select multiple size="4" name="pmi_month">'+options(Array.from({length:12},(_,i)=>({id:i+1,label:new Date(2000,i,1).toLocaleString("en",{month:"long"})})),selection.months)+'</select></label>'+
      field("Period start","pmi_start",draft.period.start,"date")+field("Period end","pmi_end",draft.period.end,"date")+'</div></details>'+
      '<details open><summary>Analyst applicability</summary><div class="pmi-grid">'+field("Jurisdiction at the selected site","pmi_jurisdiction",app.jurisdiction)+
      field("Designated water use","pmi_water_use",app.water_use)+field("Person recording applicability","pmi_reviewer",app.reviewer)+
      textArea("Site, use and source-edition rationale","pmi_note",app.note)+textArea("Parameter, analytical method and original-unit review","pmi_method_note",app.method_note)+
      '</div><div class="pmi-confirmations">'+confirms+'</div><label class="pmi-check"><input type="checkbox" name="pmi_confirmed"'+(app.confirmed?" checked":"")+'>Record these applicability choices as reviewed</label>'+
      '<p>Unconfirmed applicability remains visible as a descriptive comparison.</p></details>'+
      '<details><summary>Qualified original results</summary><label class="pmi-check"><input type="checkbox" name="pmi_include_qualified"'+(draft.options.include_qualified?" checked":"")+'>Include selected qualified results after review</label>'+
      textArea("Reason for including qualified results","pmi_qualified_note",draft.options.qualified_note)+'</details>'+
      '<div class="pmi-actions"><button type="button" data-pmi-action="preview">Preview comparison</button><button type="submit" data-pmi-save>Save version</button>'+
      '<button type="button" data-pmi-action="export" data-pmi-export>Export saved version</button></div></form>'+
      '<details class="pmi-profile"><summary>Source profile for the next calculation</summary>'+profileHTML(p)+'</details>';
    buttons();
  }
  function buttons() {
    if(!node)return;
    for(const b of node.querySelectorAll('[data-pmi-action="preview"]'))b.disabled=isBusy()||!complete||!draft?.profile_id;
    const save=find("[data-pmi-save]");if(save)save.disabled=isBusy()||!preview||!draft?.title?.trim();
    for(const b of node.querySelectorAll("[data-pmi-export]"))b.disabled=isBusy()||!opened;
    for(const b of node.querySelectorAll('[data-pmi-action="open"]'))b.disabled=isBusy()||!selectedSaved;
    for(const b of node.querySelectorAll('[data-pmi-action="refresh"],[data-pmi-import-submit]'))b.disabled=isBusy();
    const label=find("[data-pmi-saved-identity]");
    if(label)label.textContent=opened?"Saved: "+opened.content.title+" · "+opened.saved_at+" · "+opened.id:"The working comparison has not been saved.";
  }
  function renderSaved() {
    const control=find("[data-pmi-saved]");if(!control)return;
    control.innerHTML='<option value="">Choose a saved comparison</option>'+options(arr(catalog?.saved).map(s=>({id:s.id,label:s.title+" · "+s.saved_at})),[selectedSaved]);
    control.value=selectedSaved;
    const roots=find('[name="pmi_root_id"]'),prior=roots?.value;
    if(roots){roots.innerHTML=options(arr(ctx()?.sourceRoots).map(r=>({id:r.id,label:r.label})));if([...roots.options].some(o=>o.value===prior))roots.value=prior;}
    buttons();
  }
  function evidenceLinks(ids) {
    return arr(sourceLinks).filter(s=>arr(ids).includes(s.id)).map(s=>{
      const url=safeURL(s.url);return url?'<li><a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(s.title)+'</a></li>':"<li>"+esc(s.title)+"</li>";
    }).join("");
  }
  function renderResultHeading() {
    const heading=find("[data-pmi-result-heading]"),note=find("[data-pmi-result-note]");
    if(heading)heading.textContent=resultKind==="preview"?(preview?"Working preview":"Previous working preview"):"Saved comparison";
    if(note)note.textContent=resultKind==="preview"&&!preview?"This result retains the earlier selection. Preview the working changes to calculate a new result.":"";
  }
  function renderResult() {
    const target=find("[data-pmi-result]");if(!target)return;
    if(!result){target.innerHTML='<p class="pmi-empty">Preview a comparison to inspect the original records and complete sampling windows.</p>';return;}
    const sum=result.summary||{},shownProfile=resultProfile;
    target.innerHTML='<header class="pmi-result-head"><h3 data-pmi-result-heading></h3><p>'+esc(statusLabel(result.applicability_state))+'</p></header><p data-pmi-result-note class="pmi-notice"></p>'+
      '<p>'+esc(result.interpretation)+'</p>'+(shownProfile?'<details><summary>Source edition used for this result</summary>'+profileHTML(shownProfile,sourceLinks)+'</details>':'')+'<dl class="pmi-counts">'+Object.entries(sum).map(([k,v])=>'<div><dt>'+esc(words(k))+'</dt><dd>'+esc(v)+'</dd></div>').join("")+'</dl>'+
      (arr(result.warnings).length?'<div class="pmi-notice"><h4>Sampling and applicability support</h4><ul>'+lines(result.warnings.map(words))+'</ul></div>':"")+
      '<p>'+esc(result.censoring)+'</p><p>'+esc(result.window_convention)+'</p>'+
      '<details><summary>Contextual frequency rules</summary>'+readable(result.contextual_rules||{})+'</details>'+
      '<h4>Analytical windows</h4><label>Series<select data-pmi-window-filter><option value="">All series</option>'+
      options(arr(result.series).map(s=>({id:s.id,label:s.site_id+" · "+s.parameter+" · "+s.method+" · "+s.unit})),[windowFilter])+'</select></label>'+
      '<div data-pmi-windows></div><h4>Original observation decisions</h4>'+
      '<label>Rows<select data-pmi-row-filter>'+options([{id:"selected",label:"Selected original records"},{id:"all",label:"All original records"},{id:"above",label:"Above selected threshold"},{id:"uncertain",label:"Indeterminate comparisons"},{id:"excluded",label:"Excluded from supported calculation"}],[rowFilter])+'</select></label>'+
      '<div data-pmi-rows></div><div data-pmi-detail></div>';
    renderResultHeading();renderTables();
  }
  function pages(kind,page,total) {
    const count=Math.max(1,Math.ceil(total/PAGE));
    return '<div class="pmi-pages"><button type="button" data-pmi-page="'+kind+'" data-direction="-1"'+(page===0?" disabled":"")+'>Previous</button>'+
      '<span>'+esc(total)+" records · Page "+(page+1)+" of "+count+'</span><button type="button" data-pmi-page="'+kind+'" data-direction="1"'+(page+1>=count?" disabled":"")+'>Next</button></div>';
  }
  function renderTables() {
    if(!node||!result)return;
    let rows=arr(result.rows).filter(r=>rowFilter==="all"||rowFilter==="selected"&&r.selected||rowFilter==="above"&&r.status==="ABOVE_THRESHOLD"||
      rowFilter==="uncertain"&&r.status==="INDETERMINATE"||rowFilter==="excluded"&&r.selected&&!r.eligible);
    rowPage=Math.min(rowPage,Math.max(0,Math.ceil(rows.length/PAGE)-1));
    const rt=find("[data-pmi-rows]");
    if(rt)rt.innerHTML=rows.length?pages("rows",rowPage,rows.length)+table(["Station / date","Parameter / measured unit","Original bounds","Decision","Support","Original row"],rows.slice(rowPage*PAGE,(rowPage+1)*PAGE).map(r=>[
      esc(r.site_id)+"<br>"+esc(r.date),esc(r.parameter)+"<br>"+esc(r.unit),
      esc((r.lower_open?"(":"[")+(r.lower??"unbounded")+", "+(r.upper??"unbounded")+(r.upper_open?")":"]")),
      esc(statusLabel(r.status)),esc(arr(r.reason_codes).map(words).join("; ")),
      '<button type="button" data-pmi-row="'+esc(r.record_id)+'">Inspect source row</button><br>'+esc(r.source_file)+" · "+esc(r.source_csv_row)
    ])):'<p class="pmi-empty">No original rows match this display selection.</p>';
    const windows=arr(result.series).filter(s=>!windowFilter||s.id===windowFilter).flatMap(s=>arr(s.metrics).map(m=>({series:s,metric:m})));
    windowPage=Math.min(windowPage,Math.max(0,Math.ceil(windows.length/PAGE)-1));
    const wt=find("[data-pmi-windows]");
    if(wt)wt.innerHTML=windows.length?pages("windows",windowPage,windows.length)+table(["Series","Window / metric","Selected / supported","Result bounds / measured unit","Criterion","Outcome and support"],windows.slice(windowPage*PAGE,(windowPage+1)*PAGE).map(({series:s,metric:m})=>[
      esc(s.site_id)+"<br>"+esc(s.method)+"<br>"+esc(s.parameter),
      esc(m.window_start||"")+" — "+esc(m.window_end||"")+"<br>"+esc(metricName(m.aggregation)),
      esc(m.n)+" / "+esc(m.supported_n??"Not assessed"),
      windowBounds(m)+"<br>"+esc(m.unit),
      windowCriterion(m),
      esc(statusLabel(m.status))+"<br>"+esc(arr(m.reason_codes).map(words).join("; "))+
      '<details><summary>Original window records and numerical support</summary><p>'+esc(m.numeric_basis||"")+'</p>'+readable({record_ids:m.record_ids,unassigned_record_ids:m.unassigned_record_ids,numeric_comparison:statusLabel(m.numeric_comparison),contextual_rule:m.rule})+'</details>'
    ])):'<p class="pmi-empty">No analytical windows are available for this source and profile selection.</p>';
    renderDetail();
  }
  function renderDetail() {
    const target=find("[data-pmi-detail]");if(!target)return;
    const row=arr(result?.rows).find(r=>r.record_id===detailId);
    if(!row){target.innerHTML="";return;}
    target.innerHTML='<section class="pmi-detail"><div class="pmi-actions"><h4>Original source row</h4><button type="button" data-pmi-action="close-detail">Close</button></div>'+
      '<p>'+esc(row.source_file)+" · CSV row "+esc(row.source_csv_row)+'</p>'+
      '<p>Laboratory comment: '+esc(row.laboratory_comment||"(blank)")+'</p>'+
      '<dl>'+Object.entries(row.raw_cells||{}).map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(v===""?"(blank)":v)+'</dd>').join("")+'</dl>'+
      '<details><summary>Retained analytical decisions and recovered support</summary>'+readable({decision:statusLabel(row.status),reasons:arr(row.reason_codes).map(words),comparisons:row.comparisons,canonical_record_id:row.canonical_record_id,canonical_original_records:row.canonical_original_records,recovered_original_support:row.recovered_original_support,source_support_mismatches:row.source_support_mismatches})+'</details></section>';
  }
  async function refreshCatalog() {
    if(!node||!complete)return;
    const serial=++loadSerial,g=generation,k=key,w=workspace,revision=edit,firstLoad=!catalog;
    try {
      const value=await course.api("/api/published-studies/interpretation-catalog",{study_id:complete.record.study_id,version_id:complete.record.version_id});
      if(!active(g,k,w)||serial!==loadSerial)return;
      catalog=value;catalogSources=arr(value.sources);if(!result)sourceLinks=catalogSources;
      if(!draft.profile_id){draft.profile_id=arr(value.profiles).find(p=>p.id==="sc-ecoli-ambient-126-349")?.id||arr(value.profiles)[0]?.id||"";remember();}
      renderSaved();if(firstLoad||(revision===edit&&!node.contains(document.activeElement)))renderForm();
      if(receiveChoice&&!isBusy()&&receiveChoice.workspace===workspace&&receiveChoice.study_id===complete.record.study_id&&receiveChoice.version_id===complete.record.version_id){
        const received=receiveChoice;receiveChoice=null;await openSaved(received.id);
      } else notify("Original study and source profiles are available.");
    } catch(e){if(active(g,k,w)&&serial===loadSerial)notify(e?.message||String(e),true);}
  }
  async function runPreview() {
    if(isBusy()||!complete)return;
    readForm();remember();
    const g=generation,k=key,w=workspace,revision=edit,request=currentRequest();
    busy=true;buttons();notify("Calculating the selected original observations…");
    try {
      const value=await course.api("/api/published-studies/interpretation-preview",request);
      if(!active(g,k,w)||revision!==edit)return;
      preview=value;result=value.result;resultKind="preview";resultProfile=copy(value.profile);sourceLinks=arr(value.sources);rowPage=windowPage=0;windowFilter="";detailId="";
      renderResult();notify("Preview calculated from the selected original study and source profile.");
    } catch(e){if(active(g,k,w)&&revision===edit)notify(e?.message||String(e),true);}
    finally{if(active(g,k,w)){busy=false;buttons();}}
  }
  async function openSaved(id) {
    if(isBusy()||!id)return;
    const g=generation,k=key,w=workspace,revision=edit;busy=true;buttons();notify("Opening saved comparison…");
    try{
      const value=await course.api("/api/published-studies/interpretation-get",{interpretation_id:id});
      if(!active(g,k,w)||revision!==edit)return;
      const body=value.interpretation?.content;
      if(!body||body.binding.study_id!==complete.record.study_id||body.binding.version_id!==complete.record.version_id)throw Error("Select this comparison's original retained study edition.");
      opened=value.interpretation;selectedSaved=id;draft={...copy(body.request),title:body.title,parent_id:id};
      delete draft.study_id;delete draft.version_id;
      sourceLinks=arr(value.sources);result=body.result;resultKind="saved";resultProfile=copy(body.profile);preview=null;++edit;rowPage=windowPage=0;windowFilter="";detailId="";remember();
      renderForm();renderSaved();renderResult();notify("Opened the exact saved comparison and its retained sources.");
    }catch(e){if(active(g,k,w)&&revision===edit)notify(e?.message||String(e),true);}
    finally{if(active(g,k,w)){busy=false;buttons();}}
  }
  async function queue(action,payload) {
    if(isBusy())return;
    const g=generation,k=key,w=workspace;
    const intent={action,workspace:w,key:k,edit,payload:copy(payload)};
    pendingIntent=intent;busy=true;buttons();notify("Queuing the original "+words(action.split(".").at(-1))+" operation…");
    try{
      const task=await course.queue(action,payload);
      if(!active(g,k,w))return;
      if(task?.id){lastTask=task.id;remember();notify("Operation "+task.state+". Open its task for progress and original downloads.");}
      else notify("Open the original task panel to inspect the request before repeating it.",true);
      renderTasks();
    }catch(e){if(active(g,k,w))notify(e?.message||String(e),true);}
    finally{if(active(g,k,w)){busy=false;buttons();}}
  }
  function completed(task,entry) {
    if(!String(entry?.action||task?.action||"").startsWith(PREFIX))return false;
    if(!node||workspace!==entry?.workspace||host.getWorkspace()!==workspace)return true;
    const action=entry.action,value=task.result?.interpretation;
    lastTask=task.id;remember();
    if(action===PREFIX+"import"&&value?.content?.binding){
      receiveChoice={workspace,id:value.id,...value.content.binding};
      notify("The original comparison and study were received. Opening their retained edition.");
      renderTasks();return false;
    }
    const intent=pendingIntent;
    if(value&&intent?.action===action&&intent.workspace===workspace&&intent.key===key&&intent.edit===edit){
      opened=value;selectedSaved=value.id;
      if(action===PREFIX+"save"){draft.parent_id=value.id;preview=null;result=value.content.result;resultKind="saved";resultProfile=copy(value.content.profile);remember();renderResult();}
    }
    pendingIntent=null;
    notify(action===PREFIX+"export"?"Complete report, original observations, window results and editable source ZIP are available in the task.":"The saved comparison is available.");
    renderTasks();refreshCatalog();return true;
  }
  function renderTasks(state=host.getState()) {
    const target=find("[data-pmi-tasks]");if(!target)return;
    const tasks=taskList(state).filter(t=>String(t.action||"").startsWith(PREFIX)&&(!t.workspace||t.workspace===workspace)).slice(-8).reverse();
    target.innerHTML=(lastTask?'<button type="button" data-pmi-task="'+esc(lastTask)+'">Open current task and downloads</button>':"")+
      (tasks.length?'<ul>'+tasks.map(t=>'<li><button type="button" data-pmi-task="'+esc(t.id)+'">'+esc(words(t.action.slice(PREFIX.length)))+" · "+esc(t.state)+'</button>'+
      (t.error?.message?'<p class="pmi-error">'+esc(t.error.message)+'</p>':"")+'</li>').join("")+'</ul>':"<p>Saved and exported operations appear in the existing task panel.</p>");
  }
  function change(event) {
    if(event.target.matches("[data-pmi-saved]")){selectedSaved=event.target.value;buttons();return;}
    if(event.target.matches("[data-pmi-row-filter]")){rowFilter=event.target.value;rowPage=0;renderTables();return;}
    if(event.target.matches("[data-pmi-window-filter]")){windowFilter=event.target.value;windowPage=0;renderTables();return;}
    if(!event.target.closest("[data-pmi-form]"))return;
    const changedProfile=event.target.name==="pmi_profile";
    readForm();
    if(changedProfile){draft.applicability.confirmed=false;draft.applicability.confirmations={};}
    edited();if(changedProfile)renderForm();
  }
  function click(event) {
    const button=event.target.closest("button");if(!button||!node?.contains(button))return;
    if(button.dataset.pmiTask){host.showTask(button.dataset.pmiTask);return;}
    if(button.dataset.pmiRow){detailId=button.dataset.pmiRow;renderDetail();find("[data-pmi-detail]")?.scrollIntoView({block:"nearest"});return;}
    if(button.dataset.pmiPage){if(button.dataset.pmiPage==="rows")rowPage+=Number(button.dataset.direction);else windowPage+=Number(button.dataset.direction);renderTables();return;}
    const action=button.dataset.pmiAction;
    if(action==="preview")runPreview();
    else if(action==="open")openSaved(selectedSaved);
    else if(action==="refresh")refreshCatalog();
    else if(action==="close-detail"){detailId="";renderDetail();}
    else if(action==="export"&&opened)queue(PREFIX+"export",{interpretation_id:opened.id});
    else if(action==="new"){draft=initial();draft.profile_id=arr(catalog?.profiles)[0]?.id||"";opened=preview=result=null;resultKind="";resultProfile=null;selectedSaved="";edited();renderForm();renderSaved();renderResult();}
    else if(action==="use-study-filters"){draft.selection=copy(ctx()?.selection||emptySelection());edited();renderForm();}
  }
  function submit(event) {
    if(event.target.matches("[data-pmi-form]")){
      event.preventDefault();if(!preview||isBusy())return;
      readForm();
      queue(PREFIX+"save",{...currentRequest(),title:draft.title,preview_id:preview.id,...(draft.parent_id?{parent_id:draft.parent_id}:{})});
    } else if(event.target.matches("[data-pmi-import]")){
      event.preventDefault();const data=new FormData(event.target);
      queue(PREFIX+"import",{source:{root_id:String(data.get("pmi_root_id")||""),relative_path:String(data.get("pmi_relative_path")||"").trim()}});
    }
  }
  function frame() {
    node.classList.add("pmi-desk");
    node.innerHTML='<header class="pmi-heading"><div><h2>Monitoring interpretation</h2><p>Compare original observations with an explicit source profile, then retain the complete selection, sampling support and source edition.</p></div>'+
      '<button type="button" data-pmi-action="refresh">Refresh comparisons</button></header>'+
      '<p data-pmi-status role="status" aria-live="polite"></p><div class="pmi-open"><label>Saved comparison<select data-pmi-saved><option value="">Choose a saved comparison</option></select></label>'+
      '<button type="button" data-pmi-action="open">Open saved comparison</button></div><p data-pmi-saved-identity class="pmi-identity"></p>'+
      '<div data-pmi-editor></div><section data-pmi-result aria-label="Monitoring comparison result"></section>'+
      '<details><summary>Reopen a complete interpretation ZIP</summary><form data-pmi-import><div class="pmi-grid">'+
      '<label>Original source folder<select name="pmi_root_id" required></select></label>'+
      '<label>Complete ZIP path<input name="pmi_relative_path" required placeholder="reports/monitoring-interpretation.zip"></label></div>'+
      '<p>The original importer retains the study, saved comparison, profile sources and all original observation records.</p><button type="submit" data-pmi-import-submit>Import complete comparison</button></form></details>'+
      '<section class="pmi-task-list" aria-label="Original monitoring tasks"><h3>Operations and downloads</h3><div data-pmi-tasks></div></section>';
    renderForm();renderSaved();renderResult();renderTasks();notify(message,error);
  }
  function update(state=host.getState()) {
    if(!node)return;
    const value=ctx()||{},next=value.workspace||null,nextComplete=value.complete||null,nextKey=identity(nextComplete);
    if(workspace!==next||key!==nextKey){
      remember();++generation;++loadSerial;workspace=next;key=nextKey;complete=nextComplete;
      busy=false;catalog=null;preview=null;opened=null;result=null;resultKind="";resultProfile=null;sourceLinks=[];catalogSources=[];selectedSaved="";pendingIntent=null;detailId="";
      rowPage=windowPage=0;rowFilter="selected";windowFilter="";++edit;
      if(key)restore();else draft=null;
      frame();if(key)refreshCatalog();
    } else {
      complete=nextComplete;buttons();renderTasks(state);
      if(receiveChoice&&!isBusy()&&complete&&receiveChoice.workspace===workspace&&receiveChoice.study_id===complete.record.study_id&&receiveChoice.version_id===complete.record.version_id){
        const incoming=receiveChoice;receiveChoice=null;openSaved(incoming.id);
      }
    }
  }
  function mount(target,state=host.getState()) {
    detach();node=target;events=new AbortController();frame();
    node.addEventListener("click",click,{signal:events.signal});
    node.addEventListener("change",change,{signal:events.signal});
    node.addEventListener("input",event=>{
      if(event.target.closest("[data-pmi-form]")&&event.target.matches("input:not([type=checkbox]),textarea")){readForm();edited();}
    },{signal:events.signal});
    node.addEventListener("submit",submit,{signal:events.signal});
    update(state);
  }
  function detach() {
    remember();++generation;++loadSerial;events?.abort();events=null;
    if(node)node.classList.remove("pmi-desk");
    node=null;workspace=null;key="";complete=null;draft=null;busy=false;
  }
  return {mount,update,detach,completed};
}
