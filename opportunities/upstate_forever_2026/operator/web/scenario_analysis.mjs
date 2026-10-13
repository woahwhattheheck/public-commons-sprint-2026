/**
 * Scenario analysis in the original scientific workbench.
 * Native analysis records remain the source of all quantities and scores.
 */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rows=value=>Array.isArray(value)?value:[];
const short=value=>String(value??'').slice(0,12);
const label=value=>String(value??'').replaceAll('_',' ');
const pollutants=[
  ['nitrogen_export','Nitrogen','kg/year'],
  ['phosphorus_export','Phosphorus','kg/year'],
  ['sediment_export','Sediment','tonnes/year']
];
const massUnits={nitrogen_export:'kg/pixel/year',phosphorus_export:'kg/pixel/year',sediment_export:'metric_tonnes/pixel/year'};
const nativeOutputs=run=>{
  if(run?.state!=='complete'||run.model_scope?.selected_models_complete===false)return [];
  const models=run.selection?.models??['ndr','sdr'];
  if(!Array.isArray(models)||!models.length||models.some(name=>!['ndr','sdr'].includes(name)))return [];
  const expected=pollutants.map(([id])=>id).filter(id=>models.includes(id==='sediment_export'?'sdr':'ndr'));
  return expected.every(id=>{
    const output=run.artifacts?.[id];
    return output&&typeof output.path==='string'&&Number.isFinite(output.bytes)&&output.bytes>0&&
      typeof output.sha256==='string'&&/^[0-9a-f]{64}$/.test(output.sha256)&&output.units===massUnits[id];
  })?expected:[];
};
const completeNativeRun=run=>nativeOutputs(run).length>0;
const commonOutputs=runs=>runs.length?pollutants.map(([id])=>id).filter(id=>runs.every(run=>nativeOutputs(run).includes(id))):[];
const analyzedOutputs=record=>Array.isArray(record?.comparison_pollutants)?record.comparison_pollutants:
  [...new Set(rows(record?.physical).map(row=>row.pollutant))].filter(id=>massUnits[id]);
const canonicalSelection=value=>{
  const ordered=item=>Array.isArray(item)?item.map(ordered):item&&typeof item==='object'?Object.fromEntries(Object.keys(item).sort().map(key=>[key,ordered(item[key])])):item;
  return JSON.stringify(ordered(value));
};
const tabs=[
  ['physical','Physical changes'],['priority','Planning priorities'],
  ['sensitivity','Weight sensitivity'],['pairs','Compare alternatives'],
  ['coverage','Coverage and choices'],['files','Download results']
];
const amount=(value,places=4)=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString(undefined,{maximumFractionDigits:places}):'—';
const percent=value=>typeof value==='number'&&Number.isFinite(value)?amount(value*100,2)+'%':'—';
const signed=value=>typeof value==='number'&&Number.isFinite(value)?(value>0?'+':'')+amount(value):'—';
const dt=value=>value?new Date(value).toLocaleString():'';
const button=(action,title,extra='',style='')=>'<button type="button" data-action="analysis-'+esc(action)+'" class="'+esc(style)+'" '+extra+'>'+esc(title)+'</button>';
const cell=(value,cls='')=>'<td'+(cls?' class="'+esc(cls)+'"':'')+'>'+esc(value)+'</td>';
const table=(head,body,caption='')=>'<div class="table-scroll"><table class="analysis-table">'+(caption?'<caption>'+esc(caption)+'</caption>':'')+'<thead><tr>'+head.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+body.join('')+'</tbody></table></div>';
const options=(items,value,empty='Select')=>'<option value="">'+esc(empty)+'</option>'+items.map(x=>'<option value="'+esc(x.id)+'"'+(x.id===value?' selected':'')+'>'+esc(x.title||x.id)+'</option>').join('');
const field=(title,control,note='')=>'<label><span>'+esc(title)+'</span>'+control+(note?'<small>'+esc(note)+'</small>':'')+'</label>';
const input=(name,value='',attrs='')=>'<input name="'+esc(name)+'" value="'+esc(value)+'" '+attrs+'>';
const section=(title,description,body)=>'<section class="section analysis-section"><header class="section-header"><div><h2>'+esc(title)+'</h2>'+(description?'<p>'+esc(description)+'</p>':'')+'</div></header>'+body+'</section>';
const runName=(record,id)=>rows(record?.runs).find(r=>r.id===id)?.title||short(id);
const regionName=(record,id)=>rows(record?.regions).find(r=>r.id===id)?.title||id;
const pollutantName=id=>pollutants.find(r=>r[0]===id)?.[1]||label(id);
const comparisonName=value=>({
  land_cover:'Land cover',landcover:'Land cover',parameters:'Parameters',
  parameter:'Parameters',parameter_sensitivity:'Parameters',profile:'Parameters',mixed:'Multiple model choices',
  native_model_scope:'Native model selection',baseline:'Baseline',same:'Same selection',same_selection:'Same selection'
}[value]||label(value));
const percentChange=row=>row.percent_change===null||row.percent_change===undefined?
  ({zero_reference:'Baseline is zero',baseline_zero:'Baseline is zero',both_zero:'Both are zero',no_common_cells:'No common cells'}[row.percent_change_status]||'—'):amount(row.percent_change,2)+'%';

export function scenarioRows(record,tab,{region='',run='',weight=''}={}){
  const source=tab==='coverage'?record?.physical:record?.[tab];
  return rows(source).filter(r=>(!region||r.region_id===region)&&
    (!run||(r.run_id??r.to_run_id)===run)&&(!weight||tab!=='priority'||r.weight_set_id===weight));
}
export function scenarioCSV(items){
  if(!items.length)return '';
  const keys=[...new Set(items.flatMap(x=>Object.keys(x)))];
  const text=value=>{
    if(value===null||value===undefined)return '';
    let str=typeof value==='object'?JSON.stringify(value):String(value);
    if(typeof value!=='number'&&/^[=+@\-\t\r]/.test(str))str="'"+str;
    return /[",\r\n]/.test(str)?'"'+str.replaceAll('"','""')+'"':str;
  };
  return keys.map(text).join(',')+'\r\n'+items.map(r=>keys.map(k=>text(r[k])).join(',')).join('\r\n')+'\r\n';
}
export function parseAnalysisWeights(values){
  const result={};
  for(const [name] of pollutants){
    const raw=values[name];
    if(raw===null||raw===undefined||String(raw).trim()==='')throw Error('Enter all three pollutant weights.');
    const value=Number(raw);
    if(!Number.isFinite(value)||value<0)throw Error('Pollutant weights must be finite and nonnegative.');
    result[name]=value;
  }
  if(Object.values(result).every(v=>v===0))throw Error('At least one pollutant weight must be greater than zero.');
  return result;
}

export function attachScenarioAnalysis({getState,api,endpoint,openForm,submitAction,fileList,toast,openItem}){
  const cache=new Map(),inflight=new Map();
  let container=null,controller=null,workspaceKey='',error='',generation=0;
  let local={selected:'',region:'reporting_area',run:'',weight:'',tab:'physical'};
  const current=()=>getState();
  const workspace=()=>current()?.workspace_key||'';
  const data=()=>current()?.data||{};
  const records=()=>rows(data().scenario_analyses);
  const identity=id=>workspace()+':'+id;
  const selected=()=>cache.get(identity(local.selected));
  function persist(){
    try{sessionStorage.setItem('upstate-scenario-analysis:'+workspace(),JSON.stringify(local));}catch{}
  }
  function sync(){
    if(workspaceKey!==workspace()){
      workspaceKey=workspace();generation++;error='';
      local={selected:'',region:'reporting_area',run:'',weight:'',tab:'physical'};
      try{const saved=JSON.parse(sessionStorage.getItem('upstate-scenario-analysis:'+workspace())||'null');if(saved&&typeof saved==='object')local={...local,...saved};}catch{}
    }
    if(!records().some(r=>r.id===local.selected)){
      const newest=[...records()].sort((a,b)=>String(b.created_at||b.completed_at||'').localeCompare(String(a.created_at||a.completed_at||'')));
      local.selected=newest.find(r=>r.state==='complete')?.id||newest[0]?.id||'';
    }
    if(!tabs.some(t=>t[0]===local.tab))local.tab='physical';
  }
  function keepFilters(record){
    if(local.region&&!rows(record.regions).some(r=>r.id===local.region))local.region=rows(record.regions)[0]?.id||'';
    if(local.run&&!rows(record.runs).some(r=>r.id===local.run))local.run='';
    const sets=rows(record.normalization?.weight_sets);
    if(local.weight&&!sets.some(w=>w.id===local.weight))local.weight='';
  }
  async function load(id,{fresh=false}={}){
    const ws=workspace(),key=ws+':'+id;
    if(cache.has(key)&&!fresh)return cache.get(key);
    if(inflight.has(key))return inflight.get(key);
    const request=api(endpoint('/api/item',{kind:'scenario_analyses',id})).then(result=>{
      cache.set(key,result);return result;
    }).finally(()=>inflight.delete(key));
    inflight.set(key,request);
    return request;
  }
  function taskFor(record){
    const selection=canonicalSelection(record.selection);
    return rows(current()?.tasks).find(task=>task.action==='scenario.analyze'&&canonicalSelection(task.payload)===selection);
  }
  function progressStatus(record){
    const task=taskFor(record),state=record.state==='complete'?'complete':task?.state||record.state||'building';
    const progress=record.progress||{},percent=Number.isFinite(progress.percent)?Math.min(100,Math.max(0,progress.percent)):null;
    const count=Number.isFinite(progress.completed)&&Number.isFinite(progress.total)?
      amount(progress.completed,0)+' / '+amount(progress.total,0)+' '+label(progress.unit||'items'):'';
    return {state,progress,percent,count};
  }
  function phaseCell(record){
    const item=progressStatus(record);
    return '<td class="analysis-phase"><strong>'+esc(label(item.state))+'</strong>'+
      (record.state==='complete'?'':(item.progress.label?'<small>'+esc(item.progress.label)+'</small>':'')+
      (item.count?'<small>'+esc(item.count)+'</small>':''))+'</td>';
  }
  function working(record){
    const item=progressStatus(record),progress=item.progress;
    const paused=['failed','interrupted','cancelled'].includes(item.state);
    return section(record.title||'Scenario analysis',paused?'The original selection is retained. Resume it from Operations.':'Calculation progress from the current retained operation.',
      '<div class="analysis-working" role="status" aria-live="polite"><h3>'+esc(label(item.state))+'</h3>'+
      (progress.label?'<p>'+esc(progress.label)+'</p>':'')+
      (item.percent!==null?'<label class="analysis-progress-label">Current phase: '+esc(amount(item.percent,1))+'%<progress max="100" value="'+item.percent+'"></progress></label>':'')+
      (item.count?'<p>'+esc(item.count)+'</p>':'')+
      (progress.detail?'<p>'+esc(typeof progress.detail==='string'?progress.detail:JSON.stringify(progress.detail))+'</p>':'')+
      (Number.isFinite(progress.elapsed_seconds)?'<p>Calculation time: '+esc(amount(progress.elapsed_seconds,1))+' seconds</p>':'')+
      (progress.updated_at?'<p class="note">Last saved progress: '+esc(dt(progress.updated_at))+'</p>':'')+
      (record.error?.message?'<p class="error-text">'+esc(record.error.message)+'</p>':'')+
      '<button type="button" data-action="tasks">Inspect operations</button></div>');
  }
  function overview(){
    if(!records().length)return '<div class="empty"><h2>Compare completed watershed scenarios</h2><p>Select a baseline and alternatives from the retained native model runs. The analysis uses one fixed baseline scale and reports physical changes over shared covered cells.</p>'+button('new','New analysis','','primary')+'</div>';
    return table(['Analysis','Baseline','Alternatives','Status and current phase',''],[...records()].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).map(r=>'<tr>'+
      '<td class="name-cell"><strong>'+esc(r.title||r.selection?.title||'Scenario analysis')+'</strong><small>'+esc(dt(r.created_at||r.completed_at))+'</small></td>'+
      cell(runName(r,r.baseline_run_id))+cell(Math.max(0,rows(r.run_ids).length-1))+phaseCell(r)+
      '<td>'+button('open',r.id===local.selected?'Selected':'Open','data-id="'+esc(r.id)+'"','small')+'</td></tr>'));
  }
  function filters(record){
    const regions=rows(record.regions),runs=rows(record.runs),weights=rows(record.normalization?.weight_sets);
    return '<div class="analysis-filters">'+
      field('Reporting or planning area','<select data-analysis-filter="region">'+options(regions,local.region,'All areas')+'</select>')+
      field(local.tab==='pairs'?'Alternative to compare':'Model run','<select data-analysis-filter="run">'+options(runs,local.run,'All selected runs')+'</select>')+
      (local.tab==='priority'?field('Weight selection','<select data-analysis-filter="weight">'+options(weights,local.weight,'All weight selections')+'</select>'):'')+
      button('visible-csv','Download visible rows','','small')+'</div>';
  }
  function physical(record){
    const selectedRows=scenarioRows(record,'physical',local);
    return '<p class="analysis-explanation">Change is alternative minus baseline. Negative annual mass changes mean lower modeled export. Baseline and alternatives use the same valid cells for each pollutant.</p>'+
      table(['Run','Pollutant','Baseline annual mass','Selected annual mass','Annual change','Change (%)','Common area (ha)','Coverage'],selectedRows.map(r=>'<tr>'+
        cell(runName(record,r.run_id))+cell(pollutantName(r.pollutant))+
        cell(amount(r.baseline_common_sum)+' '+r.units,'number-cell')+cell(amount(r.common_sum)+' '+r.units,'number-cell')+
        cell(signed(r.change)+' '+r.units,'number-cell')+cell(percentChange(r),'number-cell')+
        cell(amount(r.common_area_ha,2),'number-cell')+cell(percent(r.common_coverage_fraction),'number-cell')+'</tr>'),'Native annual export on common support')+
      section('Trade-offs between alternatives','A scenario is non-dominated when none of the other comparable choices has lower or equal modeled mass for every pollutant and a strict improvement for at least one.',
        rows(record.pareto).filter(r=>!local.region||r.region_id===local.region).map(r=>'<div class="section-body"><h3>'+esc(regionName(record,r.region_id))+'</h3><p>'+
          rows(r.non_dominated_run_ids).map(id=>esc(runName(record,id))).join(' · ')+'</p><small>'+rows(r.comparable_run_ids).length+' comparable runs</small></div>').join(''));
  }
  function priority(record){
    const chosen=scenarioRows(record,'priority',local),sets=rows(record.normalization?.weight_sets);
    return '<p class="analysis-explanation">Planning scores are dimensionless. Every alternative uses the saved baseline normalization caps. A score ranks modeled pollutant export; geography and designations retain their original source meaning.</p>'+
      table(['Area','Run','Weights','Mean score','Score change','Minimum','Maximum','Rank','Rank change','Coverage'],chosen.map(r=>'<tr>'+
        cell(regionName(record,r.region_id))+cell(runName(record,r.run_id))+cell(sets.find(w=>w.id===r.weight_set_id)?.title||r.weight_set_id)+
        cell(amount(r.mean),'number-cell')+cell(signed(r.score_change),'number-cell')+cell(amount(r.minimum),'number-cell')+cell(amount(r.maximum),'number-cell')+
        cell(r.rank===null||r.rank===undefined?'Unranked':r.rank,'number-cell')+cell(signed(r.rank_change),'number-cell')+cell(percent(r.coverage_fraction),'number-cell')+'</tr>'))+
      '<p class="note">Ranks compare areas in the same saved rank group, run and weight selection.</p>';
  }
  function sensitivity(record){
    const chosen=scenarioRows(record,'sensitivity',local);
    return '<p class="analysis-explanation">The range shows how each area’s mean planning score changes across the selected weight sets. A wider rank span identifies priorities that depend more strongly on the weighting choice.</p>'+
      table(['Area','Run','Lowest score','Highest score','Score range','Best rank','Worst rank','Rank span','Weight sets'],chosen.map(r=>'<tr>'+
        cell(regionName(record,r.region_id))+cell(runName(record,r.run_id))+cell(amount(r.score_min),'number-cell')+
        cell(amount(r.score_max),'number-cell')+cell(amount(r.score_range),'number-cell')+
        cell(r.best_rank??'Unranked','number-cell')+cell(r.worst_rank??'Unranked','number-cell')+cell(r.rank_span??'—','number-cell')+
        cell(r.weight_set_count,'number-cell')+'</tr>'));
  }
  function pairs(record){
    return '<p class="analysis-explanation">Compare any pair of selected runs using the same per-pollutant support. The choice column records whether the land cover, parameter profile, or both changed.</p>'+
      table(['Area','From','To','Choice changed','Pollutant','From annual mass','To annual mass','Annual change','Change (%)'],scenarioRows(record,'pairs',local).map(r=>'<tr>'+
        cell(regionName(record,r.region_id))+cell(runName(record,r.from_run_id))+cell(runName(record,r.to_run_id))+
        cell(comparisonName(r.comparison_kind))+cell(pollutantName(r.pollutant))+cell(amount(r.from_sum)+' '+r.units,'number-cell')+
        cell(amount(r.to_sum)+' '+r.units,'number-cell')+cell(signed(r.change)+' '+r.units,'number-cell')+cell(percentChange(r),'number-cell')+'</tr>'));
  }
  function coverage(record){
    const list=scenarioRows(record,'coverage',local);
    const capRows=pollutants.filter(([id])=>analyzedOutputs(record).includes(id)).map(([id,title])=>'<tr>'+cell(title)+cell(amount(record.normalization?.caps?.[id]))+cell(record.normalization?.cap_units?.[id]||'')+'</tr>');
    return section('Common and individual coverage','Individual totals describe all valid cells in each run. Scenario changes use only cells valid in every selected run for that pollutant.',
      table(['Area','Run','Pollutant','Selected cells','Valid in this run','Valid in all runs','Common coverage','Individual annual mass','Common annual mass'],list.map(r=>'<tr>'+
        cell(regionName(record,r.region_id))+cell(runName(record,r.run_id))+cell(pollutantName(r.pollutant))+
        cell(rows(record.regions).find(g=>g.id===r.region_id)?.selected_cells??'—','number-cell')+
        cell(r.valid_cells,'number-cell')+cell(r.common_valid_cells,'number-cell')+cell(percent(r.common_coverage_fraction),'number-cell')+
        cell(amount(r.own_sum)+' '+r.units,'number-cell')+cell(amount(r.common_sum)+' '+r.units,'number-cell')+'</tr>')))+
      section('Saved normalization','Baseline: '+runName(record,record.normalization?.reference_run_id)+'. '+(record.normalization?.percentile!==null&&record.normalization?.percentile!==undefined?'Baseline percentile: '+record.normalization.percentile+'.':'Explicit physical caps.'),
        table(['Pollutant','Cap','Units'],capRows))+
      section('Selected model choices','Source-bound native selections remain available for inspection.',
        table(['Run','Change type','Native models','Compared outputs','Grid','Profile','Scenario'],rows(record.runs).map(r=>'<tr>'+
          cell(r.title||short(r.id))+cell(comparisonName(r.comparison_kind))+
          cell(rows(r.model_scope?.selected_models||r.selection?.models||['ndr','sdr']).map(name=>name.toUpperCase()).join(' + '))+
          cell(analyzedOutputs(record).map(pollutantName).join(', '))+cell(short(r.selection?.grid_id))+
          cell(short(r.selection?.profile_id))+cell(short(r.selection?.scenario_id))+'</tr>')))+
      section('Planning-area sources','Each area keeps its original source, filter, buffer and rank group.',
        table(['Area','Rank group','Area (ha)','Source selection'],rows(record.regions).map(r=>'<tr>'+
          cell(r.title||r.id)+cell(r.rank_group||'Unranked')+cell(amount(r.area_ha,2),'number-cell')+
          cell(r.source?JSON.stringify(r.source):'Original reporting area')+'</tr>')));
  }
  function files(record){
    return '<p class="analysis-explanation">Download the complete saved analysis, physical and comparison tables, fixed-scale planning rasters and weight-spread rasters. A workspace backup preserves this analysis with its original model runs and sources.</p>'+
      fileList(rows(record._downloads))+
      '<details class="technical"><summary>Saved analysis selection</summary><pre class="json-view">'+esc(JSON.stringify(record.selection,null,2))+'</pre></details>';
  }
  function detail(record){
    keepFilters(record);
    const body={physical,priority,sensitivity,pairs,coverage,files}[local.tab](record);
    return section(record.title||record.selection?.title||'Selected scenario analysis','Baseline: '+runName(record,record.baseline_run_id)+'. Compared native outputs: '+analyzedOutputs(record).map(pollutantName).join(', ')+'.',
      '<div class="analysis-tabs" role="tablist" aria-label="Scenario analysis results">'+tabs.map(([id,title])=>'<button type="button" role="tab" tabindex="'+(local.tab===id?'0':'-1')+'" aria-selected="'+(local.tab===id)+'" data-action="analysis-tab" data-tab="'+id+'">'+esc(title)+'</button>').join('')+'</div>'+
      (local.tab==='files'?'':filters(record))+'<div class="analysis-results" role="tabpanel" aria-label="'+esc(tabs.find(t=>t[0]===local.tab)?.[1])+'">'+body+'</div>');
  }
  function render(){
    sync();
    const record=selected(),summary=records().find(r=>r.id===local.selected);
    return '<div class="scenario-analysis"><header class="page-header"><div><p class="eyebrow">UPPER SAVANNAH SCIENTIFIC WORKBENCH</p><h1>Scenario analysis</h1><p>Compare physical changes, planning choices and sensitivity across retained native runs.</p></div><div class="page-actions">'+button('new','New analysis','','primary')+'</div></header>'+
      overview()+(error?'<div class="notice error" role="alert">'+esc(error)+' '+button('retry','Retry')+'</div>':'')+
      (local.selected?(record?detail(record):summary&&summary.state!=='complete'?working(summary):'<p class="section-body" role="status">Opening the retained analysis…</p>'):'')+'</div>';
  }
  function redraw(){
    if(!container)return;
    container.innerHTML=render();persist();
  }
  function mount(node){
    controller?.abort();container=node;controller=new AbortController();const g=++generation;
    node.addEventListener('change',event=>{
      const name=event.target.dataset.analysisFilter;
      if(name&&['region','run','weight'].includes(name)){local[name]=event.target.value;redraw();}
    },{signal:controller.signal});
    node.addEventListener('keydown',event=>{
      const tab=event.target.closest('[role="tab"]');
      if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      const index=tabs.findIndex(t=>t[0]===local.tab);
      const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
      local.tab=tabs[next][0];redraw();node.querySelector('[role="tab"][aria-selected="true"]')?.focus();
    },{signal:controller.signal});
    if(local.selected&&!selected()&&records().find(r=>r.id===local.selected)?.state==='complete')load(local.selected).then(()=>{if(g===generation&&container){error='';redraw();}}).catch(e=>{if(g===generation&&container){error=e.message;redraw();}});
  }
  let updateSignature='';
  function update(){
    if(!container)return;
    const signature=JSON.stringify({workspace:workspace(),analyses:records(),
      tasks:rows(current()?.tasks).filter(task=>task.action==='scenario.analyze')});
    if(signature===updateSignature)return;
    updateSignature=signature;
    const active=document.activeElement;
    const focus=container.contains(active)?{
      filter:active.dataset?.analysisFilter,
      action:active.dataset?.action,
      id:active.dataset?.id,
      tab:active.dataset?.tab
    }:null;
    redraw();
    if(focus){
      const next=[...container.querySelectorAll('button,select,input,a')].find(element=>
        focus.filter?element.dataset.analysisFilter===focus.filter:
        focus.action&&element.dataset.action===focus.action&&
          element.dataset.id===focus.id&&element.dataset.tab===focus.tab);
      next?.focus({preventScroll:true});
    }
    const g=generation;
    if(local.selected&&!selected()&&records().find(r=>r.id===local.selected)?.state==='complete')
      load(local.selected).then(()=>{if(g===generation&&container){error='';redraw();}})
        .catch(e=>{if(g===generation&&container){error=e.message;redraw();}});
  }
  function detach(){generation++;controller?.abort();container=null;updateSignature='';}
  function runTitle(id){
    const run=rows(data().runs).find(r=>r.id===id),scenario=rows(data().scenarios).find(s=>s.id===run?.selection?.scenario_id);
    return scenario?.title||short(id);
  }
  function weightInputs(prefix,value={nitrogen_export:1,phosphorus_export:1,sediment_export:1}){
    return pollutants.map(([id,title])=>field(title,input(prefix+id,value[id]??0,'type="number" min="0" step="any" required'))).join('');
  }
  function weightRow(value={}){
    return '<div data-analysis-weight-row class="analysis-editor-row">'+field('Weight-set name',input('weight_title',value.title||'','required maxlength="160"'))+
      weightInputs('weight_',value.weights)+button('weight-remove','Remove','','small')+'</div>';
  }
  function zoneRow(){
    return '<fieldset data-analysis-zone-row class="analysis-zone"><legend>Retained planning area</legend><div class="analysis-editor-grid">'+
      field('Area name',input('zone_title','','required maxlength="160"'))+
      field('Source edition','<select name="zone_collection" required>'+options(rows(data().sources),'','Choose edition')+'</select>')+
      field('Vector source','<select name="zone_source" required><option value="">Choose edition first</option></select>')+
      field('Layer',input('zone_layer'),'Leave empty to use the original first layer.')+
      field('Attribute filter field',input('zone_filter_field'))+field('Attribute filter value',input('zone_filter_value'),'Exact source value; leave both empty for the whole source.')+
      field('Buffer (metres)',input('zone_buffer',0,'type="number" min="0" step="any"'),'Use a positive buffer for lines or points.')+
      field('Rank group',input('zone_rank_group'),'Use the same name only for areas that should be ranked together.')+
      '</div>'+button('zone-remove','Remove planning area','','small')+'</fieldset>';
  }
  function sourceOptions(row){
    const edition=rows(data().sources).find(s=>s.id===row.querySelector('[name="zone_collection"]').value);
    row.querySelector('[name="zone_source"]').innerHTML=options(rows(edition?.entries).filter(e=>e.kind==='vector'),'','Choose vector source');
  }
  function newAnalysis(previous=null){
    const completed=rows(data().runs).filter(completeNativeRun);
    if(!completed.length)throw Error('Complete the selected nutrient or sediment model outputs before building an analysis. Open Native model runs to continue those calculations.');
    const initial=previous?.selection||{};
    const baseline=initial.baseline_run_id||completed.find(r=>rows(data().scenarios).find(s=>s.id===r.selection.scenario_id)?.kind==='baseline')?.id||completed[0].id;
    const runChoices=completed.map(r=>({id:r.id,title:runTitle(r.id)+' · '+(r.selection.models||['ndr','sdr']).map(name=>name.toUpperCase()).join(' + ')+' · '+short(r.selection.profile_id)}));
    const html='<div class="analysis-form"><div class="form-grid">'+
      field('Analysis title',input('analysis_title',initial.title||'Watershed scenario analysis','required maxlength="240"'))+
      field('Baseline','<select name="analysis_baseline" required>'+options(runChoices,baseline,'Choose baseline')+'</select>')+
      '</div><fieldset><legend>Alternatives on the same retained model grid</legend><p class="note">Leave alternatives empty to retain baseline totals and priorities. Selected alternatives must share at least one native model with every other selected run.</p><div id="analysis-run-choices"></div><p id="analysis-common-outputs" class="notice" role="status"></p></fieldset>'+
      '<fieldset><legend>Planning score</legend><p class="note">Set relative weights for the outputs shared by the selected native runs. All alternatives use the same baseline scale.</p><div class="analysis-editor-grid">'+
      weightInputs('analysis_',initial.weights)+field('Normalization','<select name="analysis_cap_mode"><option value="percentile">Baseline percentile</option><option value="explicit">Explicit physical caps</option></select>')+
      field('Baseline percentile',input('analysis_percentile',initial.percentile??95,'type="number" min="0.000001" max="100" step="any" required'))+
      '</div><div id="analysis-explicit-caps" class="analysis-editor-grid" hidden>'+pollutants.map(([id,title,unit])=>field(title+' cap ('+unit+'/cell)',input('cap_'+id,initial.caps?.[id]??'','type="number" min="0.000000000001" step="any"'))).join('')+'</div></fieldset>'+
      '<fieldset><legend>Weight sensitivity</legend><p class="note">Add the planning choices to compare. The saved base weights are always included.</p><div id="analysis-weight-rows"></div>'+button('weight-add','Add weight selection','','small')+'</fieldset>'+
      '<fieldset><legend>Planning areas</legend><p class="note">The original reporting area is always included. Add actual retained vector areas for utility, watershed or source-water comparisons.</p><div id="analysis-zone-rows"></div>'+button('zone-add','Add planning area','','small')+'</fieldset></div>';
    openForm('Build scenario analysis','Select completed native outputs and retain the full quantitative analysis in this workspace.',html,'Build analysis',async()=>{
      const form=document.getElementById('operation-form'),val=name=>form.elements.namedItem(name)?.value;
      const ids=[...form.querySelectorAll('[name="analysis_run"]:checked')].map(n=>n.value);
      const baselineRun=completed.find(r=>r.id===val('analysis_baseline'));
      const selectedRuns=[baselineRun,...ids.map(id=>completed.find(run=>run.id===id))];
      if(!baselineRun||selectedRuns.some(run=>!run||run.selection.grid_id!==baselineRun.selection.grid_id))throw Error('Select alternatives on the baseline’s original grid.');
      const shared=commonOutputs(selectedRuns);
      if(!shared.length)throw Error('Choose a cohort that shares nutrient or sediment outputs across every selected run.');
      const selection={title:val('analysis_title').trim(),baseline_run_id:baselineRun.id,scenario_run_ids:ids,
        weights:parseAnalysisWeights(Object.fromEntries(pollutants.map(([id])=>[id,shared.includes(id)?val('analysis_'+id):0])))};
      if(val('analysis_cap_mode')==='explicit'){
        selection.caps={};
        for(const id of shared){const v=Number(val('cap_'+id));if(!Number.isFinite(v)||v<=0)throw Error('Every selected physical cap must be greater than zero.');selection.caps[id]=v;}
      }else{const p=Number(val('analysis_percentile'));if(!Number.isFinite(p)||p<=0||p>100)throw Error('Choose a baseline percentile above zero and at most 100.');selection.percentile=p;}
      selection.weight_sets=[...form.querySelectorAll('[data-analysis-weight-row]')].map((row,i)=>{
        const title=row.querySelector('[name="weight_title"]').value.trim();if(!title)throw Error('Name each sensitivity weight selection.');
        return {id:'choice_'+(i+1),title,weights:parseAnalysisWeights(Object.fromEntries(pollutants.map(([id])=>[id,shared.includes(id)?row.querySelector('[name="weight_'+id+'"]').value:0])))};
      });
      selection.zones=[...form.querySelectorAll('[data-analysis-zone-row]')].map((row,i)=>{
        const v=name=>row.querySelector('[name="zone_'+name+'"]').value.trim(),zone={id:'area_'+(i+1),title:v('title'),source_collection_id:v('collection'),source_id:v('source')};
        if(!zone.title||!zone.source_collection_id||!zone.source_id)throw Error('Each planning area needs its name and original vector source.');
        if(v('layer'))zone.layer=v('layer');
        const f=v('filter_field'),value=v('filter_value');if(Boolean(f)!==Boolean(value))throw Error('Provide both the attribute filter field and value, or leave both empty.');
        if(f)zone.where={[f]:value};
        const buffer=Number(v('buffer'));if(!Number.isFinite(buffer)||buffer<0)throw Error('Use a finite nonnegative planning-area buffer.');if(buffer>0)zone.buffer_m=buffer;
        if(v('rank_group'))zone.rank_group=v('rank_group');
        return zone;
      });
      return submitAction('scenario.analyze',selection);
    },()=>{
      const form=document.getElementById('operation-form');
      function scope(){
        const baselineRun=completed.find(run=>run.id===form.elements.namedItem('analysis_baseline').value);
        const selectedRuns=[baselineRun,...[...form.querySelectorAll('[name="analysis_run"]:checked')].map(node=>completed.find(run=>run.id===node.value))];
        const shared=selectedRuns.every(Boolean)?commonOutputs(selectedRuns):[];
        const explicit=form.elements.namedItem('analysis_cap_mode').value==='explicit';
        document.getElementById('analysis-common-outputs').textContent=shared.length?
          'Compared native outputs: '+shared.map(pollutantName).join(', ')+'. '+(selectedRuns.length===1?'Baseline analysis.':(selectedRuns.length-1)+' selected alternative'+(selectedRuns.length===2?'':'s')+'.'):
          'These selected runs have no common native output. Change the alternatives to share NDR or SDR.';
        for(const [id] of pollutants){
          const available=shared.includes(id);
          for(const node of form.querySelectorAll('[name="analysis_'+id+'"],[name="weight_'+id+'"]')){
            if(!available&&!node.disabled){node.dataset.analysisPreviousWeight=node.value;node.value='0';}
            if(available&&node.disabled&&node.dataset.analysisPreviousWeight!==undefined){node.value=node.dataset.analysisPreviousWeight;delete node.dataset.analysisPreviousWeight;}
            node.disabled=!available;node.required=available;
            node.title=available?'':'Outside the native outputs shared by this cohort';
          }
          const cap=form.elements.namedItem('cap_'+id);
          cap.disabled=!available;cap.required=explicit&&available;
          cap.closest('label').hidden=!available;
        }
        document.getElementById('analysis-explicit-caps').hidden=!explicit;
        form.elements.namedItem('analysis_percentile').required=!explicit;
      }
      form._analysisUpdateScope=scope;
      function alternatives(){
        const b=completed.find(r=>r.id===form.elements.namedItem('analysis_baseline').value);
        const selectedIds=[...form.querySelectorAll('[name="analysis_run"]:checked')].map(n=>n.value);
        const initialIds=selectedIds.length?selectedIds:rows(initial.scenario_run_ids);
        const available=completed.filter(r=>r.id!==b?.id&&r.selection.grid_id===b?.selection.grid_id&&commonOutputs([b,r]).length);
        document.getElementById('analysis-run-choices').innerHTML=available.length?available.map(r=>'<label class="check"><input type="checkbox" name="analysis_run" value="'+esc(r.id)+'"'+(initialIds.includes(r.id)?' checked':'')+'><span>'+esc(runTitle(r.id))+'<small>'+esc((r.selection.models||['ndr','sdr']).map(name=>name.toUpperCase()).join(' + ')+' · '+short(r.selection.profile_id))+'</small></span></label>').join(''):'<p class="note">The baseline can be analyzed now. Completed alternatives on this grid will appear here.</p>';
        scope();
      }
      alternatives();form.elements.namedItem('analysis_baseline').addEventListener('change',alternatives);
      form.elements.namedItem('analysis_cap_mode').addEventListener('change',scope);
      form.querySelector('#analysis-run-choices').addEventListener('change',scope);
      form.querySelector('#analysis-zone-rows').addEventListener('change',event=>{if(event.target.name==='zone_collection')sourceOptions(event.target.closest('[data-analysis-zone-row]'));});
    });
  }
  async function dispatch(node){
    const action=node.dataset.action?.replace(/^analysis-/,'');
    if(action==='new')return newAnalysis();
    if(action==='open'){
      local.selected=node.dataset.id;error='';redraw();
      if(records().find(r=>r.id===local.selected)?.state!=='complete')return;
      const ws=workspace();try{await load(local.selected);if(ws===workspace())redraw();}catch(e){if(ws===workspace()){error=e.message;redraw();}}return;
    }
    if(action==='tab'){local.tab=node.dataset.tab;redraw();return;}
    if(action==='retry'){error='';const id=local.selected;cache.delete(identity(id));await load(id,{fresh:true});redraw();return;}
    if(action==='weight-add'){document.getElementById('analysis-weight-rows').insertAdjacentHTML('beforeend',weightRow());document.getElementById('operation-form')._analysisUpdateScope?.();return;}
    if(action==='weight-remove'){node.closest('[data-analysis-weight-row]')?.remove();return;}
    if(action==='zone-add'){document.getElementById('analysis-zone-rows').insertAdjacentHTML('beforeend',zoneRow());return;}
    if(action==='zone-remove'){node.closest('[data-analysis-zone-row]')?.remove();return;}
    if(action==='native-run')return openItem('runs',node.dataset.id);
    if(action==='visible-csv'){
      const record=selected(),items=scenarioRows(record,local.tab,local);if(!items.length)throw Error('The current view has no rows to download.');
      const content=scenarioCSV(items),url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));
      const anchor=document.createElement('a');anchor.href=url;anchor.download='scenario-'+local.tab+'-'+short(record.id)+'.csv';document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
      toast('Downloaded the displayed analysis rows.');return;
    }
    throw Error('Choose an available scenario-analysis action.');
  }
  return {render,mount,update,detach,dispatch};
}
