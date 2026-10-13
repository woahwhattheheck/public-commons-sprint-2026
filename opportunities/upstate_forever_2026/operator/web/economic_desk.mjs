/** Native report and sourced cost intake for the retained economic desk. */
const escape = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short = value => String(value || '').slice(0, 12);
const axes = {
  nitrogen_export:{source:'nitrogen',label:'Nitrogen',unit:'kg/year'},
  phosphorus_export:{source:'phosphorus',label:'Phosphorus',unit:'kg/year'},
  sediment_export:{source:'sediment',label:'Sediment',unit:'t/year'}
};
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const format = value => numeric(value) ? new Intl.NumberFormat(undefined,{maximumFractionDigits:3}).format(value) : '—';
const activeAxes = source => Object.keys(axes).filter(key => source?.pollutants?.includes(axes[key].source));
const number = (value, label, {positive=false}={}) => {
  if (String(value ?? '').trim()==='') throw Error('Enter '+label+'.');
  const result=Number(value);
  if (!Number.isFinite(result)||result<0||(positive&&result<=0)) throw Error(label+' must be '+(positive?'positive':'nonnegative')+' and finite.');
  return result;
};
const field = (label,name,value='',type='text',extra='') =>
  '<label><span>'+escape(label)+'</span><input data-field="'+escape(name)+'" type="'+type+'" value="'+escape(value)+'" '+extra+'></label>';
const button = (action,label,extra='') => '<button type="button" data-econ="'+action+'" '+extra+'>'+label+'</button>';
const moneyFields = [
  ['capital','Upfront cost'],['annual_operating','Annual operating cost'],
  ['horizon_years','Horizon, years'],['discount_percent','Real discount rate, %']
];

export function attachEconomicDesk(host) {
  const {getState,api,endpoint,toast}=host;
  let root=null,frame=null,workspace=null,source=null,catalog=null,draft=null;
  let epoch=0,busy=false,pending=null,preview=null,openEditionId=null,requestedSource=null;
  let rowFingerprint='',completedTask=null;
  const operations=new Map();
  const node=selector=>frame?.querySelector(selector);
  const key=()=> 'upstate-economic-desk:'+workspace;
  const valid=token=>token===epoch&&frame&&workspace===getState()?.workspace_key;
  const url=(path,values={})=>endpoint(path,{workspace,...values});

  function message(text,error=false) {
    const target=node('[data-status]');
    if(target){target.textContent=text;target.setAttribute('role',error?'alert':'status');target.classList.toggle('econ-error',error);}
  }
  function setBusy(value) {
    busy=value;
    const selectedZone=source?.zones.find(row=>row.zone_id===draft?.zoneId);
    for(const control of frame?.querySelectorAll('[data-submit]')||[])control.disabled=value||!source?.alternatives?.length||!selectedZone?.common_support_available;
    for(const control of frame?.querySelectorAll('[data-inputs] input,[data-inputs] textarea,[data-inputs] select,[data-report],[data-zone]')||[])control.disabled=value;
  }
  function remember() {
    if(!workspace||!draft)return;
    try{localStorage.setItem(key(),JSON.stringify({draft,pendingId:pending?.id||null,openEditionId}));}catch(_){}
  }
  function readMemory() {
    try{const value=JSON.parse(localStorage.getItem(key())||'null');return value&&typeof value==='object'?value:null;}catch(_){return null;}
  }
  function blank(reportId='',zoneId='') {
    return {reportId,reportSha:'',zoneId,title:'',currency:'USD',capital_limit:'',
      annualized_limit:'',targets:{},costs:{},notes:'',originalReportId:'',originalZoneId:'',originalSelection:null};
  }
  function current() {
    if(!draft||!frame)return draft;
    for(const input of frame.querySelectorAll('[data-field]')){
      const name=input.dataset.field;
      if(name.startsWith('target:'))draft.targets[name.slice(7)]=input.value;
      else draft[name]=input.value;
    }
    for(const row of frame.querySelectorAll('[data-cost-run]')){
      const value=draft.costs[row.dataset.costRun]||{};
      for(const input of row.querySelectorAll('[data-cost]'))
        value[input.dataset.cost]=input.type==='checkbox'?input.checked:input.value;
      draft.costs[row.dataset.costRun]=value;
    }
    return draft;
  }
  function fromInput(value) {
    const selected=value.selection||{};
    const state=blank(value.report_id,value.zone_id);
    state.reportSha=value.report_sha256;state.title=selected.title||'';
    state.originalReportId=value.report_id;state.originalZoneId=value.zone_id;state.originalSelection=JSON.parse(JSON.stringify(selected));
    state.currency=selected.budget?.currency||selected.costs?.[0]?.currency||'USD';
    state.capital_limit=selected.budget?.capital_limit??'';
    state.annualized_limit=selected.budget?.annualized_limit??'';
    state.targets={...selected.targets};state.notes=(selected.notes||[]).join('\n');
    for(const cost of selected.costs||[]){
      state.costs[cost.run_id]={
        originalCost:JSON.parse(JSON.stringify(cost)),enabled:true,currency:cost.currency,capital:cost.capital,
        annual_operating:cost.annual_operating,horizon_years:cost.horizon_years,
        discount_percent:Number(cost.discount_rate)*100,
        source_title:cost.source?.title||'',source_uri:cost.source?.uri||'',
        source_as_of:cost.source?.as_of||'',
        cost_scope:cost.scope?.kind==='whole_scenario'?'whole-scenario':cost.scope?.kind==='reporting_zone'?'reporting-zone':'retained',
        estimate_zone_id:cost.scope?.zone_id||value.zone_id,
        estimate_zone_title:cost.scope?.zone_title||value.zone_id,
        estimate_report_id:cost.scope?.producer_report_id||value.report_id,
        reviewed_from:cost.scope?.reviewed_from||null,
        note:cost.scope_note??cost.note??''
      };
    }
    return state;
  }
  function payload() {
    current();
    if(!source||source.producer_report_id!==draft.reportId)throw Error('Choose a completed native report.');
    const zone=source.zones.find(row=>row.zone_id===draft.zoneId);
    if(!zone)throw Error('Choose a reporting zone from this native report.');
    if(!zone.common_support_available)throw Error(zone.reasons.join('; '));
    if(!draft.title.trim())throw Error('Give this economic edition a title.');
    if(draft.reportSha!==source.source.sha256)throw Error('Refresh the changed native report before building this edition.');
    const currency=String(draft.currency||'').trim().toUpperCase();
    if(!/^[A-Z]{3}$/.test(currency))throw Error('Use a three-letter currency such as USD.');
    const retained=draft.originalReportId===draft.reportId&&draft.originalZoneId===draft.zoneId?(draft.originalSelection||{}):{};
    const costs=[];
    const known=new Set([...source.alternatives,...(source.unavailable_alternatives||[])].map(row=>row.run_id));
    for(const [runId,value] of Object.entries(draft.costs)){
      if(!value.enabled)continue;
      if(!known.has(runId))throw Error('A saved cost names a scenario outside this native report.');
      const label=source.alternatives.find(row=>row.run_id===runId)?.label||short(runId);
      const original=draft.originalReportId===draft.reportId?(value.originalCost||{}):{};
      const origin={...(original.source||{}),title:String(value.source_title||'').trim(),uri:String(value.source_uri||'').trim(),as_of:String(value.source_as_of||'').trim()};
      if(!origin.title||!origin.uri||!/^\d{4}-\d{2}-\d{2}$/.test(origin.as_of))throw Error('Add the actual cost source title, reference and as-of date for '+label+'.');
      const scope=value.cost_scope;
      if(scope!=='whole-scenario'&&value.estimate_zone_id&&value.estimate_zone_id!==zone.zone_id)throw Error('Review '+label+' cost originally scoped to '+(value.estimate_zone_title||value.estimate_zone_id)+' before including it in '+zone.title+'.');
      const scopeRecord={...(original.scope||{}),kind:scope==='whole-scenario'?'whole_scenario':scope==='reporting-zone'?'reporting_zone':'retained'};
      if(scopeRecord.kind!=='whole_scenario')Object.assign(scopeRecord,{zone_id:zone.zone_id,zone_title:zone.title,producer_report_id:source.producer_report_id});
      else for(const name of ['zone_id','zone_title','producer_report_id'])delete scopeRecord[name];
      if(value.reviewed_from)scopeRecord.reviewed_from=value.reviewed_from;
      let note=String(value.note||'').trim();
      if(scope==='whole-scenario')note='Cost footprint: the complete modeled scenario. '+note;
      else if(scope==='reporting-zone')note='Cost footprint: an implementation estimate explicitly scoped to '+zone.title+'. '+note;
      else if(scope!=='retained')throw Error('Choose the cost footprint for '+label+'.');
      costs.push({
        ...original,run_id:runId,currency:value.currency||currency,
        capital:number(value.capital,label+' upfront cost'),
        annual_operating:number(value.annual_operating,label+' annual operating cost'),
        horizon_years:number(value.horizon_years,label+' horizon',{positive:true}),
        discount_rate:number(value.discount_percent,label+' discount rate')/100,
        source:origin,note:note.trim(),scope:scopeRecord,scope_note:String(value.note||'').trim()
      });
    }
    const selection={...retained,schema:'upstate.decision-selection/v1',title:draft.title.trim(),
      comparison_id:zone.comparison_id,costs,targets:{},notes:draft.notes.split('\n').filter(line=>line.trim())};
    delete selection.budget;
    const budget={...(retained.budget||{}),currency};
    let hasBudgetLimit=false;
    for(const name of ['capital_limit','annualized_limit']){
      delete budget[name];
      if(String(draft[name]).trim()!==''){budget[name]=number(draft[name],name.replaceAll('_',' '));hasBudgetLimit=true;}
    }
    if(hasBudgetLimit)selection.budget=budget;
    for(const [metric,value] of Object.entries(draft.targets||{}))if(String(value).trim()!==''){
      if(!activeAxes(source).includes(metric))throw Error('The retained '+(axes[metric]?.label||metric)+' target names an unmodeled output. Clear it or choose its native report.');
      selection.targets[metric]=number(value,axes[metric].label+' avoided-export target');
    }
    return {report_id:draft.reportId,report_sha256:draft.reportSha,zone_id:draft.zoneId,selection};
  }
  function shell() {
    frame=document.createElement('div');frame.className='economic-workbench';
    frame.innerHTML='<header class="econ-heading"><div><p class="econ-kicker" data-study-label>DECISION COMPANION</p><h2>Economic desk</h2><p>Choose a completed native report and reporting zone. Compare whole scenarios using their modeled exports, sourced costs and budget.</p></div>'+button('refresh','Refresh completed results')+'</header>'+
      '<p data-status class="econ-status" role="status">Opening completed native reports…</p>'+
      '<section class="econ-card"><div class="econ-section-heading"><h3>1. Native results and reporting zone</h3></div>'+
      '<div class="econ-fields"><label><span>Completed native report</span><select data-report aria-label="Completed native report"></select></label>'+
      '<label><span>Find a reporting zone</span><input data-zone-filter type="search" placeholder="Zone title or retained ID"></label>'+
      '<label><span>Native reporting zone</span><select data-zone aria-label="Native reporting zone"></select></label></div>'+
      '<div data-source-detail></div><details data-source-issues hidden><summary>Other retained source records</summary><ul></ul></details></section>'+
      '<section data-inputs hidden></section><section data-preview hidden class="econ-card"></section>'+
      '<section class="econ-card"><div class="econ-section-heading"><h3>Saved inputs and completed editions</h3>'+button('refresh-saved','Refresh saved work')+'</div><div data-saved></div></section>'+
      '<section data-edition hidden class="econ-card"><div class="econ-section-heading"><h3 data-edition-title>Economic edition</h3>'+button('close-edition','Close embedded desk')+'</div><div data-edition-links></div><iframe data-edition-frame title="Complete retained economic decision desk" loading="lazy"></iframe></section>';
    root.replaceChildren(frame);
    frame.addEventListener('click',onClick);
    frame.addEventListener('change',onChange);
    frame.addEventListener('input',onInput);
  }
  function renderReports() {
    const select=node('[data-report]');
    select.innerHTML='<option value="">Choose a completed native report</option>'+
      (catalog?.reports||[]).map(row=>'<option value="'+escape(row.id)+'">'+escape(row.title)+' · '+row.pollutants.map(p=>escape(p)).join(', ')+' · '+row.zone_count+' zones</option>').join('');
    select.value=draft?.reportId||'';
    const issues=catalog?.source_issues||[];
    const box=node('[data-source-issues]');box.hidden=!issues.length;
    box.querySelector('ul').innerHTML=issues.map(row=>'<li><code>'+escape(short(row.id))+'</code> '+escape(row.message)+'</li>').join('');
  }
  function renderZones() {
    const select=node('[data-zone]'),query=(node('[data-zone-filter]')?.value||'').trim().toLowerCase();
    const rows=(source?.zones||[]).filter(zone=>zone.zone_id===draft?.zoneId||!query||(zone.title+' '+zone.zone_id).toLowerCase().includes(query));
    select.innerHTML='<option value="">Choose a native reporting zone</option>'+rows.map(zone=>
      '<option value="'+escape(zone.zone_id)+'" '+(!zone.common_support_available?'disabled':'')+'>'+escape(zone.title)+' · '+format(zone.area_ha)+' ha'+(!zone.common_support_available?' · no common export support':'')+'</option>').join('');
    select.value=draft?.zoneId||'';select.disabled=!source;
  }
  function renderSource() {
    const zone=source?.zones.find(row=>row.zone_id===draft?.zoneId),part=node('[data-source-detail]');
    node('[data-study-label]').textContent=(source?.project?.title||getState()?.data?.project?.title||'Native watershed study')+' / DECISION COMPANION';
    if(!source){part.innerHTML='<p class="econ-empty">Build a native scenario report in the existing reporting workflow, then refresh this list.</p>';return;}
    const modelled=activeAxes(source).map(metric=>axes[metric].label).join(', ');
    let body='<dl class="econ-facts"><div><dt>Baseline run</dt><dd><code>'+escape(short(source.baseline_run_id))+'</code></dd></div>'+
      '<div><dt>Whole-scenario alternatives</dt><dd>'+source.alternatives.length+'</dd></div>'+
      '<div><dt>Modeled outputs</dt><dd>'+escape(modelled)+'</dd></div></dl>';
    if(zone){
      body+='<p><strong>'+escape(zone.title)+'</strong> · '+format(zone.area_ha)+' ha · '+escape(zone.scope)+'. Each pollutant uses the original report’s common cells across its entire run cohort.</p>';
      body+='<div class="econ-table-wrap"><table><thead><tr><th>Native output</th><th>Common cells</th><th>Common area, ha</th><th>Selected cells</th></tr></thead><tbody>'+
        activeAxes(source).map(metric=>{const coverage=zone.coverage[axes[metric].source]||{};return '<tr><th>'+axes[metric].label+'</th><td>'+format(coverage.common_valid_cells)+'</td><td>'+format(coverage.common_valid_area_ha)+'</td><td>'+format(coverage.selected_cells)+'</td></tr>';}).join('')+'</tbody></table></div>';
    }
    if(source.unavailable_alternatives?.length)body+='<details><summary>Alternatives outside this management comparison</summary><ul>'+source.unavailable_alternatives.map(row=>'<li><code>'+escape(short(row.run_id))+'</code> '+escape(row.reason)+'</li>').join('')+'</ul></details>';
    part.innerHTML=body;
  }
  function renderInputs() {
    const box=node('[data-inputs]'),zone=source?.zones.find(row=>row.zone_id===draft?.zoneId);
    box.hidden=!zone;
    if(!zone)return;
    const metricFields=activeAxes(source).map(metric=>field(axes[metric].label+' minimum avoided export, '+axes[metric].unit,'target:'+metric,draft.targets[metric]??'','number','min="0" step="any" placeholder="No target"')).join('');
    const inactive=Object.entries(draft.targets||{}).filter(([metric,value])=>String(value).trim()!==''&&!activeAxes(source).includes(metric));
    const retainedTargets=inactive.length?'<section class="econ-status"><strong>Retained targets for outputs absent from this report</strong><ul>'+inactive.map(([metric,value])=>'<li>'+escape(axes[metric]?.label||metric)+': '+escape(value)+' '+escape(axes[metric]?.unit||'')+' '+button('clear-target','Clear this retained target','data-metric="'+escape(metric)+'"')+'</li>').join('')+'</ul><p class="econ-note">These original criteria stay in the draft until explicitly cleared. Choose a report containing the output to keep using the target.</p></section>':'';
    const rows=source.alternatives.map(row=>{
      const value=draft.costs[row.run_id]||{};
      const fields=moneyFields.map(([name,label])=>'<label><span>'+label+'</span><input data-cost="'+name+'" type="number" min="0" step="any" value="'+escape(value[name]??'')+'"></label>').join('');
      const scope=value.cost_scope||'';
      return '<details class="econ-cost" data-cost-run="'+escape(row.run_id)+'" '+(value.enabled?'open':'')+'><summary><span>'+escape(row.label)+'</span><code>'+escape(short(row.run_id))+'</code></summary>'+
        '<label class="econ-checkbox"><input type="checkbox" data-cost="enabled" '+(value.enabled?'checked':'')+'> Include this scenario’s reviewed implementation estimate</label>'+
        (value.needs_scope_review?'<p class="econ-note"><strong>Original estimate zone: '+escape(value.needs_scope_review.zone_title||value.needs_scope_review.zone_id)+'.</strong> The cost is unchecked after changing the reporting zone. Review its actual footprint and quantities before including it in this zone.</p>':'')+
        (value.reviewed_from?'<p class="econ-note">Estimate provenance retained from '+escape(value.reviewed_from.zone_title||value.reviewed_from.zone_id)+'; reviewed for this selection.</p>':'')+
        '<div class="econ-cost-fields" '+(!value.enabled?'hidden':'')+'><div class="econ-fields">'+fields+
        '<label><span>Cost currency</span><input data-cost="currency" maxlength="3" value="'+escape(value.currency||draft.currency)+'"></label>'+
        '<label><span>Cost footprint</span><select data-cost="cost_scope"><option value="">Choose actual cost scope</option><option value="whole-scenario" '+(scope==='whole-scenario'?'selected':'')+'>Complete modeled scenario</option><option value="reporting-zone" '+(scope==='reporting-zone'?'selected':'')+'>Defined implementation in this reporting zone</option>'+(scope==='retained'?'<option value="retained" selected>Original retained scope note</option>':'')+'</select></label></div>'+
        '<div class="econ-fields"><label><span>Actual cost source title</span><input data-cost="source_title" value="'+escape(value.source_title||'')+'"></label><label><span>Source URL or retained document reference</span><input data-cost="source_uri" value="'+escape(value.source_uri||'')+'"></label><label><span>Source as of</span><input data-cost="source_as_of" type="date" value="'+escape(value.source_as_of||'')+'"></label></div>'+
        '<label><span>Cost scope, quantities and estimate assumptions</span><textarea data-cost="note" rows="2">'+escape(value.note||'')+'</textarea></label></div></details>';
    }).join('');
    box.innerHTML='<section class="econ-card"><h3>2. Edition, budget and physical targets</h3><div class="econ-fields">'+field('Edition title','title',draft.title)+field('Budget / default cost currency','currency',draft.currency,'text','maxlength="3"')+
      field('Upfront budget limit','capital_limit',draft.capital_limit,'number','min="0" step="any" placeholder="No upfront limit"')+
      field('Annualized budget limit','annualized_limit',draft.annualized_limit,'number','min="0" step="any" placeholder="No annualized limit"')+
      metricFields+'</div>'+retainedTargets+'<p class="econ-note">Empty budget or target fields leave that criterion open. Costs use the actual intervention footprint; the reporting zone’s area does not prorate them.</p></section>'+
      '<section class="econ-card"><h3>3. Whole-scenario cost sources</h3><p>Keep a scenario’s cost unchecked until its full implementation estimate is available. Assistance and payment schedules are funding contributions; retain those references in notes instead of entering them as implementation cost. Enter explicit zero values where the estimate has no upfront or annual cost. The physical edition remains useful with every cost unchecked.</p>'+rows+
      '<label class="econ-notes"><span>Working notes carried with this edition</span><textarea data-field="notes" rows="3">'+escape(draft.notes)+'</textarea></label>'+
      '<div class="econ-actions">'+button('preview','Calculate decision preview','data-submit')+button('save-draft','Save inputs to workspace','data-submit')+button('build','Build and open complete edition','data-submit class="econ-primary"')+'</div>'+
      '<p class="econ-note">Every candidate remains one complete modeled scenario. Nitrogen, phosphorus and sediment keep their own units.</p></section>';
    setBusy(busy);
  }
  function renderSaved(value=catalog) {
    if(!value)return;
    const editions=value.editions||[],drafts=value.drafts||[];
    let body='<div class="econ-saved-grid"><div><h4>Completed editions</h4>';
    body+=editions.length?'<ul class="econ-saved-list">'+editions.map(row=>'<li><strong>'+escape(row.title)+'</strong><span>'+escape(row.zone_title)+' · '+row.candidate_count+' scenarios · '+row.costed_count+' costs · '+row.eligible_count+' eligible</span><div>'+button('open-edition','Open desk','data-id="'+escape(row.id)+'"')+button('edit-edition','Reuse inputs','data-id="'+escape(row.id)+'"')+
      (typeof host.openExtension==='function'?button('client-report','Prepare client report','data-id="'+escape(row.id)+'"'):'')+'</div></li>').join('')+'</ul>':'<p class="econ-empty">Completed economic editions appear here.</p>';
    body+='</div><div><h4>Saved inputs</h4>';
    body+=drafts.length?'<ul class="econ-saved-list">'+drafts.map(row=>'<li><strong>'+escape(row.title)+'</strong><span>'+escape(row.zone_title)+' · '+row.costed_count+' sourced costs</span>'+button('open-draft','Reopen inputs','data-id="'+escape(row.id)+'"')+'</li>').join('')+'</ul>':'<p class="econ-empty">Save the actual source, zone and completed cost inputs for another operator.</p>';
    body+='</div></div>';
    const issues=value.issues||[];
    if(issues.length)body+='<details><summary>Saved records needing attention</summary><ul>'+issues.map(row=>'<li>'+escape(short(row.id))+': '+escape(row.message)+'</li>').join('')+'</ul></details>';
    node('[data-saved]').innerHTML=body;
    rowFingerprint=JSON.stringify(value);
  }
  function renderPreview(report) {
    preview=report;
    const metrics=Object.keys(report.baseline.outputs),box=node('[data-preview]');
    const budget=report.assessment.budget;
    box.hidden=false;
    box.innerHTML='<h3>Calculated whole-scenario preview</h3><p>'+report.alternatives.length+' comparable scenarios; '+report.frontier.eligible_ids.length+' meet the prepared criteria. '+(budget?'Budget currency '+escape(budget.currency)+'.':'No budget was applied.')+'</p>'+
      '<div class="econ-table-wrap"><table><thead><tr><th>Scenario</th>'+metrics.map(metric=>'<th>'+axes[metric].label+' avoided, '+axes[metric].unit+'</th>').join('')+'<th>Annualized cost</th><th>Decision</th></tr></thead><tbody>'+report.alternatives.map(row=>'<tr><th>'+escape(row.label)+'</th>'+metrics.map(metric=>'<td>'+format(row.outputs[metric].reduction)+'</td>').join('')+'<td>'+(row.cost?format(row.cost.annualized)+' '+escape(row.cost.currency)+'/year':'Cost not entered')+'</td><td>'+(row.decision.eligible?'Eligible':'Outside prepared criteria')+(row.decision.pareto?' · Pareto':'')+'</td></tr>').join('')+'</tbody></table></div>'+
      '<p class="econ-note">The complete edition retains source coverage, signed changes, undefined zero-baseline percentages, cost assumptions, exports and working notes.</p>';
  }
  async function loadSource(reportId,{preserve=false,zoneId=null}={}) {
    const token=++epoch,selectedWorkspace=workspace,retained=preserve&&draft?JSON.parse(JSON.stringify(draft)):null;
    setBusy(true);message('Reading the completed native report and exact zones…');
    try{
      const value=await api(url('/api/economic-desk/source',{report_id:reportId}));
      if(!valid(token)||selectedWorkspace!==workspace)return;
      source=value;draft=retained||blank(reportId,zoneId||'');
      draft.reportId=reportId;
      if(draft.reportSha&&draft.reportSha!==value.source.sha256){
        throw Error('This saved selection names different native report bytes. Its original costs are retained in the form; refresh the source before rebuilding.');
      }
      draft.reportSha=value.source.sha256;
      if(zoneId)draft.zoneId=zoneId;
      if(!value.zones.some(row=>row.zone_id===draft.zoneId))
        draft.zoneId=value.zones.find(row=>row.zone_id==='reporting_area'&&row.common_support_available)?.zone_id||
          value.zones.find(row=>row.common_support_available)?.zone_id||'';
      if(!draft.title)draft.title=value.title+' · '+(value.zones.find(row=>row.zone_id===draft.zoneId)?.title||'economic edition');
      renderReports();renderZones();renderSource();renderInputs();remember();
      message(value.alternatives.length?'Native report and zone loaded. Enter available sourced costs or build the physical decision edition.':'This report has no land-cover alternative under its baseline profile. Choose the completed management cohort.');
    }catch(error){if(valid(token)){message(error.message||String(error),true);renderZones();renderSource();renderInputs();}}
    finally{if(valid(token))setBusy(false);}
  }
  async function loadCatalog({preserve=true}={}) {
    const token=++epoch;
    if(preserve)current();
    setBusy(true);message('Discovering completed native reports and saved economic editions…');
    try{
      const value=await api(url('/api/economic-desk/catalog'));
      if(!valid(token))return;
      catalog=value;renderReports();renderSaved();
      const wanted=requestedSource;
      if(wanted){requestedSource=null;draft=blank(wanted.report_id,wanted.zone_id||'');}
      const reportId=wanted?.report_id||draft?.reportId||value.reports.find(row=>row.ready_zones&&row.alternative_count)?.id;
      if(reportId&&value.reports.some(row=>row.id===reportId)){
        setBusy(false);
        await loadSource(reportId,{preserve:!!draft,zoneId:wanted?.zone_id});
      }else{
        source=null;renderZones();renderSource();renderInputs();setBusy(false);
        message(value.reports.length?'Choose a completed native report.':'No completed native scenario report is present in this workspace. Build it in the native reporting workflow, then refresh.');
      }
    }catch(error){if(valid(token)){message(error.message||String(error),true);setBusy(false);}}
  }
  async function openEdition(id) {
    const token=epoch;
    message('Opening the retained economic edition…');
    const value=await api(url('/api/economic-desk/edition',{edition_id:id}));
    if(!valid(token))return;
    openEditionId=id;
    const section=node('[data-edition]');section.hidden=false;
    node('[data-edition-title]').textContent=value.title;
    const links=node('[data-edition-links]');
    links.innerHTML='<a target="_blank" rel="noopener" href="'+escape(value.open_url)+'">Open full desk in a new tab</a> '+
      (value._downloads||[]).map(file=>'<a href="'+escape(file.url)+'?download=1">'+escape(file.label)+'</a>').join(' ')+
      (typeof host.openExtension==='function'?' '+button('client-report','Prepare client report','data-id="'+escape(id)+'"'):'');
    node('[data-edition-frame]').src=value.open_url;
    section.scrollIntoView({block:'start',behavior:'smooth'});
    message('Complete economic edition opened with its original modeled outcomes and cost inputs.');remember();
  }
  async function prepareClientReport(id) {
    if(typeof host.openExtension!=='function')throw Error('Open this completed edition with the current map-release operator.');
    const token=epoch,key=workspace;
    current();remember();
    message('Opening the client report with this completed economic edition…');
    const [edition,module]=await Promise.all([
      api(url('/api/economic-desk/edition',{edition_id:id})),
      import('/web/extensions/scenario_reports.mjs')
    ]);
    if(!valid(token))return;
    if(edition.id!==id||!edition.input?.report_id)throw Error('Reopen the completed economic edition to retain its original report.');
    const release=await api(url('/api/scenario-reports/release',{report_id:edition.input.report_id}));
    if(!valid(token))return;
    if(!release.ready)throw Error((release.issues||[]).map(item=>item.message).join(' ')||
      'Complete the selected native report before preparing its maps and economic report.');
    const selection=module.economicReleaseSelection(release,id);
    await host.openExtension('map-atlas','create',{workspace_key:key,selection});
  }
  async function loadSaved(kind,id) {
    const token=epoch;
    const value=await api(url('/api/economic-desk/'+kind,{[kind==='draft'?'draft_id':'edition_id']:id}));
    if(!valid(token))return;
    draft=fromInput(value.input);
    preview=null;node('[data-preview]').hidden=true;
    await loadSource(draft.reportId,{preserve:true,zoneId:draft.zoneId});
  }
  async function submit(action) {
    const body=payload(),bodyKey=action+':'+JSON.stringify(body),token=epoch;
    let operation=operations.get(bodyKey);
    if(!operation){operation=crypto.randomUUID();operations.set(bodyKey,operation);}
    setBusy(true);message(action==='economic.edition.build'?'Building the complete decision edition through the existing operator queue…':'Saving the source-bound economic inputs…');
    try{
      const task=await api('/api/actions',{method:'POST',body:{workspace,action,payload:body,operation_id:operation}});
      if(!valid(token))return;
      pending=task;completedTask=null;remember();
      if(typeof host.refreshState==='function')await host.refreshState();
      update(getState());
    }catch(error){if(valid(token)){setBusy(false);message(error.message||String(error),true);}}
  }
  async function onClick(event) {
    const target=event.target.closest('[data-econ]');
    if(!target||!frame.contains(target))return;
    event.preventDefault();event.stopPropagation();
    try{
      const action=target.dataset.econ;
      if(action==='refresh')return await loadCatalog();
      if(action==='refresh-saved'){if(typeof host.refreshState==='function')await host.refreshState();catalog={...catalog,...getState()?.data?.economic_editions};return renderSaved(catalog);}
      if(action==='close-edition'){node('[data-edition]').hidden=true;node('[data-edition-frame]').removeAttribute('src');openEditionId=null;return remember();}
      if(action==='open-edition')return await openEdition(target.dataset.id);
      if(action==='edit-edition')return await loadSaved('edition',target.dataset.id);
      if(action==='client-report'){
        target.disabled=true;
        try{return await prepareClientReport(target.dataset.id);}
        finally{if(target.isConnected)target.disabled=false;}
      }
      if(action==='open-draft')return await loadSaved('draft',target.dataset.id);
      if(busy)throw Error('The current economic operation is still running; its task remains in the operator queue.');
      if(action==='clear-target'){delete draft.targets[target.dataset.metric];preview=null;node('[data-preview]').hidden=true;renderInputs();remember();message('The selected retained target was cleared. Other criteria are preserved.');return;}
      if(action==='preview'){
        const token=epoch;setBusy(true);message('Calculating costs, affordability and separate physical objectives…');
        try{const value=await api('/api/economic-desk/preview',{method:'POST',body:{workspace,...payload()}});if(valid(token)){renderPreview(value.report);message('Decision preview calculated from the retained native outcomes.');}}
        finally{if(valid(token))setBusy(false);}
      }else if(action==='save-draft')await submit('economic.draft.save');
      else if(action==='build')await submit('economic.edition.build');
    }catch(error){message(error.message||String(error),true);if(typeof toast==='function')toast(error.message||String(error));}
  }
  async function onChange(event) {
    try{
      if(event.target.matches('[data-report]')){
        current();remember();
        const id=event.target.value;
        if(id){draft=blank(id);source=null;await loadSource(id);}
        else{epoch++;source=null;draft=blank();preview=null;node('[data-preview]').hidden=true;node('[data-zone-filter]').value='';renderReports();renderZones();renderSource();renderInputs();setBusy(false);remember();message('Choose a completed native report to begin.');}
        return;
      }
      if(event.target.matches('[data-zone]')){
        current();const oldZone=source?.zones.find(row=>row.zone_id===draft.zoneId),nextZone=event.target.value;
        if(nextZone!==draft.zoneId){
          for(const value of Object.values(draft.costs)){
            if(value.cost_scope==='whole-scenario')continue;
            if(value.enabled){
              value.enabled=false;
              value.needs_scope_review={producer_report_id:value.estimate_report_id||draft.reportId,
                zone_id:value.estimate_zone_id||draft.zoneId,zone_title:value.estimate_zone_title||oldZone?.title||draft.zoneId};
            }
          }
        }
        draft.zoneId=nextZone;
        if(draft.title===source.title+' · '+oldZone?.title)draft.title=source.title+' · '+(source.zones.find(row=>row.zone_id===draft.zoneId)?.title||'economic edition');
        preview=null;node('[data-preview]').hidden=true;
        renderSource();renderInputs();remember();return;
      }
      if(event.target.matches('[data-cost="enabled"],[data-cost="cost_scope"]')){
        current();
        const row=event.target.closest('[data-cost-run]'),value=draft.costs[row.dataset.costRun];
        const zone=source.zones.find(item=>item.zone_id===draft.zoneId);
        if(value.enabled&&(event.target.dataset.cost==='enabled'||event.target.dataset.cost==='cost_scope')){
          if(value.needs_scope_review){value.reviewed_from=value.needs_scope_review;delete value.needs_scope_review;}
          if(value.cost_scope!=='whole-scenario'){
            value.estimate_zone_id=draft.zoneId;value.estimate_zone_title=zone.title;value.estimate_report_id=draft.reportId;
          }
        }
        renderInputs();
      }
      preview=null;node('[data-preview]').hidden=true;current();remember();
    }catch(error){message(error.message||String(error),true);}
  }
  function onInput(event) {
    if(event.target.matches('[data-zone-filter]'))return renderZones();
    preview=null;node('[data-preview]').hidden=true;current();remember();
  }
  function update(state=getState()) {
    if(!frame||workspace!==state?.workspace_key)return;
    const saved=state.data?.economic_editions;
    if(saved&&JSON.stringify(saved)!==rowFingerprint){catalog={...catalog,...saved};renderSaved(saved);}
    if(!pending)return;
    const task=(state.tasks||[]).find(row=>row.id===pending.id);
    if(!task)return;
    pending=task;
    if(['queued','running'].includes(task.state)){
      setBusy(true);message(task.state==='queued'?'Economic operation queued in the existing workspace worker…':'Economic operation running…');return;
    }
    setBusy(false);
    if(task.id===completedTask)return;
    completedTask=task.id;
    if(task.state==='complete'){
      if(task.action==='economic.edition.build')openEdition(task.result.id).catch(error=>message(error.message||String(error),true));
      else message('Economic inputs and cost sources saved in the workspace.');
      pending=null;
    }else message((task.error?.message||'The economic operation '+task.state)+'. Open its task in the existing task panel to resume.',true);
    remember();
  }
  function mount(element,state=getState()) {
    root=element;workspace=state?.workspace_key;
    const restored=readMemory();
    draft=restored?.draft||blank();
    pending=(state?.tasks||[]).find(row=>row.id===restored?.pendingId)||null;
    openEditionId=restored?.openEditionId||null;
    shell();
    loadCatalog().then(()=>{update(getState());if(openEditionId&&!pending)openEdition(openEditionId).catch(error=>message(error.message,true));});
  }
  function detach() {
    if(frame){current();remember();frame.removeEventListener('click',onClick);frame.removeEventListener('change',onChange);frame.removeEventListener('input',onInput);}
    epoch++;root=null;frame=null;source=null;catalog=null;busy=false;preview=null;
  }
  async function openReport(selection) {
    if(!selection?.report_id)throw Error('Choose an actual completed native report.');
    requestedSource={report_id:selection.report_id,zone_id:selection.zone_id||null};
    const wasMounted=!!frame;
    if(typeof host.navigate==='function')host.navigate('economic-desk');
    if(wasMounted&&frame)await loadCatalog({preserve:false});
  }
  return {mount,update,detach,openReport,openEdition,loadSaved,prepareClientReport};
}
