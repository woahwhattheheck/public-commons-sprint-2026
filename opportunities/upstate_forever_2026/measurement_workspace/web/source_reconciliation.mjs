/** Grouped original-result review inside the existing Measurements workspace. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=value=>JSON.parse(JSON.stringify(value));
const opt=(v,label,selected)=>'<option value="'+esc(v)+'"'+(v===selected?' selected':'')+'>'+esc(label)+'</option>';
const field=(name,body)=>'<label>'+esc(name)+body+'</label>';
const exact=node=>!node||node.present===false?'[absent]':node.value===null?'[null]':node.value===''?'[empty text]':typeof node.value==='object'?JSON.stringify(node.value):String(node.value);
const short=v=>String(v||'').slice(0,12);
const json=v=>JSON.stringify(v,null,2)+'\n';
const schema='upper-savannah-source-reconciliation/v1';
const nativeReasons={'reach-unassigned':'Native reach not assigned','native-domain-unbound':'Assigned reach is absent from the current native domain','native-domain-edition-changed':'Assigned native domain edition changed','censored-result':'Original result is censored','missing-numeric-result':'Original result has no numerical value','unmapped-constituent':'Constituent is not supported by this calculation','review-excluded':'Reviewer excluded this record','review-required':'Original source qualification needs review','source-revision-conflict':'No source version has been selected','superseded-by-explicit-selection':'Another original source version was explicitly selected'};
const reasons=row=>(row.eligible?.reasons||[]).map(x=>nativeReasons[x]||x.replaceAll('-',' ')).join('; ')||'Eligible under the existing Measurements rules';
const sourceTitle=s=>s.label+' · '+short(s.id);
const method='This comparison uses the existing exact original-result keys. Matching values at different source IDs are not silently merged. Every version and source-row occurrence is retained. Presence in only one selected edition does not establish deletion. Selecting a version does not remove independent unit, censoring, quality or native-reach restrictions.';
function comparisonTable(group,{raw=false,differences=true}={}){
  const fields=(raw?group.original_fields:group.fields).filter(f=>!differences||f.different);
  if(!fields.length)return '<p class="msr-empty">No differing '+(raw?'original columns':'measurement fields')+' in these retained versions.</p>';
  return '<div class="msr-scroll"><table><thead><tr><th scope="col">'+(raw?'Original column':'Measurement field')+'</th>'+group.records.map((r,i)=>'<th scope="col">Version '+(i+1)+'<small>'+esc(short(r.id))+(group.selected_id===r.id?' · selected':'')+'</small></th>').join('')+'</tr></thead><tbody>'+fields.map(f=>'<tr><th scope="row">'+esc(f.field)+'</th>'+f.cells.map(c=>'<td class="msr-exact">'+esc(exact(c))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
function recordCards(group){
  return group.records.map((r,i)=>'<section class="msr-version"><h4>Version '+(i+1)+(group.selected_id===r.id?' — selected':'')+'</h4><p class="msr-exact">'+esc(r.id)+'</p><dl><dt>Original result / activity</dt><dd>'+esc(r.sourceResultId||'Not supplied')+' / '+esc(r.activityId||'Not supplied')+'</dd><dt>Original value and unit</dt><dd>'+esc(r.reportedValue??'[absent]')+' '+esc(r.reportedUnit||'')+'</dd><dt>Current calculation eligibility</dt><dd>'+esc(reasons(r))+'</dd><dt>Current record review</dt><dd>'+esc(r.review?.state||'pending')+(r.review?.reviewer?' · '+esc(r.review.reviewer):'')+'</dd><dt>Review reason</dt><dd>'+esc(r.review?.reason||'Not yet recorded')+'</dd></dl><h5>Every original occurrence</h5><ul>'+r.sources.map(s=>'<li>'+esc(sourceTitle(s))+' · source line '+esc(s.source_line)+'<small class="msr-exact">SHA-256 '+esc(s.sha)+'</small></li>').join('')+'</ul><details><summary>Complete original row and all review history</summary><pre>'+esc(json({record:r,source_occurrences:r.sources}))+'</pre></details></section>').join('');
}
export function renderSourceReview(report){
  if(report?.schema!==schema)throw new Error('Select a complete saved source-review report');
  return '<article class="msr-print"><h1>Original source-version review</h1><p>'+esc(method)+'</p><dl><dt>Saved report</dt><dd>'+esc(report.saved_export_id||'Retained snapshot')+'</dd><dt>Measurements revision</dt><dd>'+esc(report.workspaceRevision)+'</dd><dt>Reviewer / date</dt><dd>'+esc(report.reviewer)+' / '+esc(report.created_at)+'</dd><dt>Purpose</dt><dd>'+esc(report.reason)+'</dd></dl><p>'+esc(report.counts.groups)+' groups · '+esc(report.counts.versions)+' retained versions · '+esc(report.counts.occurrences)+' original occurrences · '+esc(report.counts.unresolved)+' unresolved groups.</p>'+report.groups.map(g=>'<section><h2>'+esc(g.station_id)+' · '+esc(g.sampled_date)+' · '+esc(g.parameter)+'</h2><p class="msr-exact">Original group '+esc(g.id)+'</p>'+comparisonTable(g)+recordCards(g)+'<details><summary>All original columns across versions</summary>'+comparisonTable(g,{raw:true,differences:false})+'</details></section>').join('')+'<h2>Complete original source files</h2>'+report.sources.map(s=>'<details><summary>'+esc(s.label)+' · '+esc(s.sha)+'</summary><pre>'+esc(s.content)+'</pre><pre>'+esc(json({...s,content:undefined}))+'</pre></details>').join('')+'</article>';
}
export function sourceReviewHTML(report){
  const full=json(report).replaceAll('<','\\u003c');
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Original source-version review</title><style>html{color-scheme:light;background:#fff;color:#171717;font:15px/1.5 system-ui}body{max-width:1200px;margin:30px auto;padding:0 20px}button{padding:9px 14px;background:#eee;color:#111;border:1px solid #777}table{border-collapse:collapse;min-width:600px;width:100%}th,td{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top}small{display:block}pre,.msr-exact{white-space:pre-wrap;overflow-wrap:anywhere}pre{max-height:500px;overflow:auto;background:#f4f4f4;padding:12px}.msr-scroll{overflow:auto}section{margin:24px 0;padding-top:12px;border-top:1px solid #ccc}dt{font-weight:650}dd{margin:0 0 8px}.msr-version{break-inside:avoid}@media print{button{display:none}body{max-width:none;margin:0}pre{max-height:none;overflow:visible}details{display:block}table{min-width:0;font-size:10px}.msr-scroll{overflow:visible}}</style><header><button id="download">Download complete review JSON</button> <button onclick="window.print()">Print current review</button></header>'+renderSourceReview(report)+'<script type="application/json" id="review-data">'+full+'</script><script>let printDetails=[];window.addEventListener("beforeprint",()=>{printDetails=[...document.querySelectorAll("details")].map(d=>[d,d.open]);for(const[d]of printDetails)d.open=true});window.addEventListener("afterprint",()=>{for(const[d,open]of printDetails)d.open=open;printDetails=[]});document.getElementById("download").onclick=function(){const a=document.createElement("a");const u=URL.createObjectURL(new Blob([document.getElementById("review-data").textContent],{type:"application/json"}));a.href=u;a.download="source-version-review.json";a.click();setTimeout(()=>URL.revokeObjectURL(u),10000)};<\/script></html>';
}
export function sourceReviewCSV(report){
  const fields=['group_id','record_id','selected','workspace_revision','source_import_id','source_sha256','source_label','source_line','station_id','original_result_id','activity_id','date','characteristic','fraction','reported_value','reported_unit','qualifier','method','review_state','reviewer','review_reason','eligible','exclusion_reasons','original_row'];
  const rows=[];
  for(const g of report.groups)for(const r of g.records)for(const s of r.sources)rows.push({group_id:g.id,record_id:r.id,selected:g.selected_id===r.id,workspace_revision:report.workspaceRevision,source_import_id:s.id,source_sha256:s.sha,source_label:s.label,source_line:s.source_line,station_id:r.stationId,original_result_id:r.sourceResultId,activity_id:r.activityId,date:r.sampledDate,characteristic:r.characteristic,fraction:r.fraction,reported_value:r.reportedValue,reported_unit:r.reportedUnit,qualifier:r.qualifier,method:r.method,review_state:r.review.state,reviewer:r.review.reviewer||'',review_reason:r.review.reason||'',eligible:r.eligible.ok,exclusion_reasons:r.eligible.reasons,original_row:JSON.stringify(r.raw)});
  const quote=v=>{if(v==null)return '""';let s=typeof v==='object'?JSON.stringify(v):String(v);if(typeof v!=='number'&&/^[\s]*[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  return [fields.map(quote).join(','),...rows.map(r=>fields.map(f=>quote(r[f])).join(','))].join('\r\n')+'\r\n';
}
export function mountSourceReconciliation(host,{base='/api/measurement-workspace',transport,request,css='/measurements/source_reconciliation.css',initialState={},onStateChange=()=>{},onChanged=()=>{},openRecord,openExports}={}){
  if(!host?.addEventListener)throw new TypeError('Mount source review in an existing Measurements element');
  transport=transport||request;
  const style=document.createElement('link');style.rel='stylesheet';style.href=css;document.head.append(style);
  let dead=false,generation=0,busy=false,catalog=null,page=null,detail=null,report=null,history=[];
  const abort=new AbortController();
  let state={scope:{source_ids:[],mode:'conflicts',q:''},offset:0,group_id:null,report_id:null,differences:true,draft:{reviewer:'',reason:'',record_id:'',action:'select'},reportPurpose:'',...clone(initialState)};
  state.scope={source_ids:[],mode:'conflicts',q:'',...state.scope};state.draft={reviewer:'',reason:'',record_id:'',action:'select',...state.draft};
  let decisionDirty=state.decision_dirty??state.draft_dirty===true,reportDirty=state.report_dirty===true,dirty=decisionDirty||reportDirty;
  function setDirty(value,kind='both'){if(kind==='both'||kind==='decision')decisionDirty=value;if(kind==='both'||kind==='report')reportDirty=value;dirty=decisionDirty||reportDirty;state.decision_dirty=decisionDirty;state.report_dirty=reportDirty;state.draft_dirty=dirty;}
  host.classList.add('msr');
  function changed(){onStateChange(snapshot());}
  function snapshot(){return clone(state);}
  function status(message,error=false){const el=host.querySelector('[data-msr-status]');if(el){el.textContent=message;el.dataset.error=String(error);}}
  async function api(path='',method='GET',value){
    const r=transport?await transport('/reconciliation'+path,method,value):await fetch(base+'/reconciliation'+path,{method,credentials:'same-origin',signal:abort.signal,headers:value===undefined?{}:{'Content-Type':'application/json'},body:value===undefined?undefined:JSON.stringify(value)});
    const raw=await r.text();let data;try{data=JSON.parse(raw);}catch{throw new Error('The original Measurements service returned an unreadable response. Saved reviews remain retained.');}
    if(!r.ok)throw new Error(data.error||'Source review request failed');return data;
  }
  async function original(path){const r=transport?await transport(path,'GET'):await fetch(base+path,{credentials:'same-origin',signal:abort.signal});if(!r.ok)throw new Error('The retained source download could not be opened');return r;}
  function active(token){return !dead&&token===generation;}
  async function task(operation){
    if(busy||dead)return;
    const token=++generation;busy=true;lock();
    try{await operation(token);}catch(e){if(active(token)&&e.name!=='AbortError')status(e.message,true);}
    finally{if(active(token)){busy=false;lock();}}
  }
  function lock(){host.setAttribute('aria-busy',String(busy));for(const b of host.querySelectorAll('button,select,input,textarea'))b.disabled=busy||b.dataset.msrDisabled==='true';}
  function download(name,value,type='application/json'){
    const u=URL.createObjectURL(new Blob([typeof value==='string'?value:json(value)],{type}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);
  }
  function abandon(){return !dirty||window.confirm('Continue without recording the current review or report edits? Existing saved reviews and reports are unchanged.');}
  function render(){
    if(dead)return;
    const sources=catalog?.sources||[],s=state.scope,d=state.draft;
    host.innerHTML='<header><h2>Compare original source versions</h2><p>'+esc(method)+'</p></header><div class="msr-status" data-msr-status role="status" aria-live="polite"></div><form data-msr-form="filters" class="msr-panel"><h3>Original source scope</h3><div class="msr-grid">'+field('First retained edition','<select name="first">'+opt('','All retained editions',s.source_ids[0]||'')+sources.map(x=>opt(x.id,sourceTitle(x)+' · '+x.occurrence_count+' occurrences',s.source_ids[0])).join('')+'</select>')+field('Second retained edition','<select name="second">'+opt('','No second edition',s.source_ids[1]||'')+sources.map(x=>opt(x.id,sourceTitle(x)+' · '+x.occurrence_count+' occurrences',s.source_ids[1])).join('')+'</select>')+field('Groups','<select name="mode">'+[['conflicts','Different retained versions'],['unresolved','Unresolved versions'],['resolved','Explicitly selected versions'],['repeated','Repeated original occurrences'],['all','Every original-result group']].map(([v,t])=>opt(v,t,s.mode)).join('')+'</select>')+field('Station, parameter or original result','<input name="q" value="'+esc(s.q)+'">')+'</div><div class="msr-buttons"><button>Compare retained sources</button><button type="button" data-msr-action="refresh">Refresh current records</button></div><p>Both edition selections identify groups by their original keys. The group always shows every retained version, including other source editions.</p></form>'+renderGroups()+(detail?renderDetail():'')+'<section class="msr-panel"><h3>Save and reopen the complete comparison</h3><p>The report includes every group matching the applied scope, all original occurrences and exact source files. It records the inspected Measurements revision. It does not change a decision.</p><form data-msr-form="report"><div class="msr-grid">'+field('Reviewer','<input name="reviewer" required value="'+esc(d.reviewer)+'">')+field('Report purpose','<textarea name="purpose" required>'+esc(state.reportPurpose)+'</textarea>')+'</div><button>Save complete comparison report</button></form><div class="msr-buttons"><button data-msr-action="portable">Export complete editable workspace</button>'+(openExports?'<button data-msr-action="exports">Open calculations and exports</button>':'')+'</div><h4>Retained comparison reports</h4>'+(!history.length?'<p>No comparison report saved yet.</p>':'<ul>'+history.map(r=>'<li><button data-msr-report="'+esc(r.id)+'">Open '+esc(r.created_at)+' · revision '+esc(r.revision)+'</button></li>').join('')+'</ul>')+'</section>'+(report?renderReport():'');
    lock();
  }
  function renderGroups(){
    if(!page)return '<p class="msr-empty">Opening retained original-result groups…</p>';
    return '<section class="msr-panel"><h3>'+page.total+' matching original-result groups</h3><p>Showing '+(page.total?page.offset+1:0)+'–'+Math.min(page.total,page.offset+page.groups.length)+' · Measurements revision '+page.revision+'. Repeated identical records retain all source-row occurrences.</p><div class="msr-scroll"><table><thead><tr><th>Station / date</th><th>Constituent</th><th>Versions / occurrences</th><th>Selected editions</th><th>Decision</th><th>Open</th></tr></thead><tbody>'+page.groups.map(g=>'<tr><td>'+esc(g.station_id)+'<small>'+esc(g.sampled_date)+'</small></td><td>'+esc(g.parameter)+'</td><td>'+g.variant_count+' / '+g.occurrence_count+'</td><td>'+esc(g.selected_source_presence.length?g.selected_source_presence.map((v,i)=>'Edition '+(i+1)+': '+(v.present?'present':'not present')).join('; '):g.source_ids.length+' retained editions')+'</td><td>'+esc(g.selected_id?'Explicit selection '+short(g.selected_id):g.variant_count>1?'Unresolved':'One version')+'</td><td><button data-msr-group="'+esc(g.id)+'">Compare full records</button></td></tr>').join('')+'</tbody></table></div><div class="msr-buttons"><button data-msr-action="previous" data-msr-disabled="'+(page.offset===0)+'">Previous page</button><button data-msr-action="next" data-msr-disabled="'+(page.offset+page.groups.length>=page.total)+'">Next page</button></div></section>';
  }
  function renderDetail(){
    const g=detail.group,d=state.draft;
    return '<section class="msr-panel"><h3>'+esc(g.station_id)+' · '+esc(g.sampled_date)+' · '+esc(g.parameter)+'</h3><p>'+g.variant_count+' versions / '+g.occurrence_count+' original occurrences. Current selection: '+esc(g.selected_id||'unresolved')+'.</p><div class="msr-buttons"><button data-msr-action="fields">'+(state.differences?'Show all measurement fields':'Show differing measurement fields')+'</button><button data-msr-action="group-json">Download this complete comparison</button></div>'+comparisonTable(g,{differences:state.differences})+'<div class="msr-versions">'+recordCards(g)+'</div><details><summary>Compare all original source columns</summary>'+comparisonTable(g,{raw:true,differences:false})+'</details>'+(g.variant_count>1?'<form data-msr-form="decision"><h4>Record an explicit decision</h4><p>Returning to unresolved sets the currently selected record review to pending. Other records and their original reviews remain unchanged.</p><div class="msr-grid">'+field('Decision','<select name="action">'+opt('select','Select one original version',d.action)+opt('unresolve','Return current selection to unresolved',d.action)+'</select>')+field('Original version','<select name="record_id">'+opt('','Choose the exact version',d.record_id)+g.records.map((r,i)=>opt(r.id,'Version '+(i+1)+' · '+short(r.id)+' · '+String(r.reportedValue??'')+' '+String(r.reportedUnit??''),d.record_id)).join('')+'</select>')+field('Reviewer','<input name="reviewer" required value="'+esc(d.reviewer)+'">')+field('Decision rationale','<textarea name="reason" required>'+esc(d.reason)+'</textarea>')+'</div><button>Save explicit source decision</button></form>':'<p>This group has one retained version. Its original quality review remains in Measurements.</p>')+(openRecord?'<div class="msr-buttons">'+g.records.map((r,i)=>'<button data-msr-record="'+esc(r.id)+'">Open version '+(i+1)+' in Measurements</button>').join('')+'</div>':'')+'<h4>Original source files</h4><div class="msr-buttons">'+[...new Map(g.occurrences.map(x=>[x.id,x])).values()].map(s=>'<button data-msr-source="'+esc(s.id)+'">Download '+esc(s.label)+'</button>').join('')+'</div></section>';
  }
  function renderReport(){
    return '<section class="msr-panel"><h3>Retained source review · revision '+esc(report.workspaceRevision)+'</h3><p>'+esc(report.reviewer)+' · '+esc(report.reason)+'. '+report.counts.groups+' groups / '+report.counts.occurrences+' original occurrences. '+(catalog&&catalog.revision!==report.workspaceRevision?'The live Measurements workspace has a different revision; this historical report remains unchanged.':'')+'</p><div class="msr-buttons"><button data-msr-action="report-html">Download readable full report</button><button data-msr-action="report-json">Download complete report JSON</button><button data-msr-action="report-csv">Download every source occurrence CSV</button></div><details><summary>Read this retained comparison</summary>'+renderSourceReview(report)+'</details></section>';
  }
  function params(){
    const p=new URLSearchParams({source_ids:JSON.stringify(state.scope.source_ids),mode:state.scope.mode,q:state.scope.q,offset:String(state.offset),limit:'50'});return '/groups?'+p;
  }
  async function refresh(token,{keepDetail=true}={}){
    const [c,p,h]=await Promise.all([api(),api(params()),api('/reports')]);if(!active(token))return;
    catalog=c;page=p;history=h.reports;
    if(keepDetail&&state.group_id){const next=await api('/groups/'+encodeURIComponent(state.group_id));if(!active(token))return;detail=next;}
    if(state.report_id){const saved=await api('/reports/'+encodeURIComponent(state.report_id));if(!active(token))return;report=saved;}
    render();status('Original sources and saved reviews are open.');
  }
  function capture(form,values){
    const v=values??Object.fromEntries(new FormData(form));
    if(form.dataset.msrForm==='decision'){state.draft={...state.draft,...v};setDirty(true,'decision');}
    if(form.dataset.msrForm==='report'){state.draft.reviewer=v.reviewer;state.reportPurpose=v.purpose;setDirty(true,'report');}
    changed();return v;
  }
  host.addEventListener('input',e=>{const f=e.target.closest('form[data-msr-form]');if(f)capture(f);},{signal:abort.signal});
  host.addEventListener('change',e=>{const f=e.target.closest('form[data-msr-form]');if(f)capture(f);},{signal:abort.signal});
  host.addEventListener('submit',e=>{
    const f=e.target.closest('form[data-msr-form]');if(!f)return;e.preventDefault();e.stopPropagation();
    const values=Object.fromEntries(new FormData(f));
    task(async token=>{
      if(f.dataset.msrForm==='filters'){
        if(!abandon())return;
        if(values.first&&values.first===values.second)throw new Error('Choose two different source editions, or leave the second blank.');
        state.scope={source_ids:[values.first,values.second].filter(Boolean),mode:values.mode,q:values.q};state.offset=0;state.group_id=null;detail=null;setDirty(false);changed();await refresh(token,{keepDetail:false});
      }
      if(f.dataset.msrForm==='decision'){
        if(!detail)throw new Error('Open the current group before recording a decision');
        capture(f,values);
        const payload={...values,group_id:detail.group.id,group_binding:detail.group.binding,expected_revision:detail.revision};
        if(values.action==='select'&&!values.record_id)throw new Error('Choose the exact original version.');
        status('Recording the decision in the original Measurements review transaction…');
        let result;try{result=await api('/decide','POST',payload);}catch(error){
          if(active(token))status(error.message+' The draft is retained. Refresh this group to inspect whether the original transaction was recorded before submitting again.',true);
          return;
        }
        if(!active(token))return;
        detail=result;setDirty(false,'decision');state.draft={...state.draft,reason:'',record_id:result.group.selected_id||'',action:'select'};changed();
        await refresh(token);if(active(token)){status('Explicit source decision saved. Independent scientific eligibility restrictions remain visible.');onChanged({revision:result.revision});}
      }
      if(f.dataset.msrForm==='report'){
        capture(f,values);if(!page)throw new Error('Open the original comparison first');
        const saved=await api('/reports','POST',{...state.scope,expected_revision:page.revision,reviewer:values.reviewer,reason:values.purpose});
        if(!active(token))return;report=saved;state.report_id=saved.saved_export_id;setDirty(false,'report');changed();const h=await api('/reports');if(!active(token))return;history=h.reports;render();status('Complete comparison report saved with all original source files.');
      }
    });
  },{signal:abort.signal});
  host.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b||!host.contains(b))return;
    if(b.type==='submit'&&b.form)return;e.preventDefault();e.stopPropagation();
    task(async token=>{
      if(b.dataset.msrGroup){if(!abandon())return;const data=await api('/groups/'+encodeURIComponent(b.dataset.msrGroup));if(!active(token))return;detail=data;state.group_id=data.group.id;state.draft={...state.draft,reason:'',record_id:data.group.selected_id||'',action:'select'};setDirty(false);changed();render();status('Every original source version and occurrence is shown.');return;}
      if(b.dataset.msrReport){const data=await api('/reports/'+encodeURIComponent(b.dataset.msrReport));if(!active(token))return;report=data;state.report_id=data.saved_export_id;changed();render();status('Retained historical comparison opened without changing current reviews.');return;}
      if(b.dataset.msrRecord){if(abandon())openRecord?.(b.dataset.msrRecord);return;}
      if(b.dataset.msrSource){const s=(catalog?.sources||[]).find(x=>x.id===b.dataset.msrSource);const r=await original('/sources/'+encodeURIComponent(b.dataset.msrSource)+'/original');const body=await r.text();if(active(token))download('original-source-'+short(b.dataset.msrSource)+(s?.kind==='usgs-daily'?'.geojson':'.csv'),body,r.headers?.get('Content-Type')||'text/plain');return;}
      const a=b.dataset.msrAction;
      if(a==='refresh'){await refresh(token);return;}
      if(a==='previous'||a==='next'){if(!abandon())return;state.offset=a==='next'?page.offset+page.limit:Math.max(0,page.offset-page.limit);state.group_id=null;detail=null;setDirty(false);changed();await refresh(token,{keepDetail:false});return;}
      if(a==='fields'){state.differences=!state.differences;changed();render();return;}
      if(a==='group-json'){download('original-source-group-'+short(detail.group.id)+'.json',detail);return;}
      if(a==='report-json')download('source-version-review-'+short(report.saved_export_id)+'.json',report);
      if(a==='report-html')download('source-version-review-'+short(report.saved_export_id)+'.html',sourceReviewHTML(report),'text/html');
      if(a==='report-csv')download('source-version-occurrences-'+short(report.saved_export_id)+'.csv',sourceReviewCSV(report),'text/csv');
      if(a==='exports'){if(abandon())openExports?.();return;}
      if(a==='portable'){const r=await original('/portable'),body=await r.text();if(active(token))download('upper-savannah-measurements.json',body,'application/json');}
    });
  },{signal:abort.signal});
  const unload=e=>{if(dirty){e.preventDefault();e.returnValue='';}};
  window.addEventListener('beforeunload',unload);
  render();task(token=>refresh(token));
  return {snapshot,refresh:()=>task(token=>refresh(token)),destroy(){if(dead)return;changed();dead=true;generation++;abort.abort();window.removeEventListener('beforeunload',unload);style.remove();host.replaceChildren();host.classList.remove('msr');},hasDraft:()=>dirty};
}
