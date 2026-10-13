/**
 * Scenario analysis in the original scientific workbench.
 * Native analysis records remain the source of all quantities and scores.
 */
import {createAnalysisDelivery} from './scenario_analysis_delivery.mjs';
import {nativeModelsForOutputs,nativeCommonVersionIssues,nativeModelVersionLabel} from './native_versions.mjs';

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

/** Observed executor version takes precedence; old retained runs keep a labeled fallback. */
export function scenarioNativeVersion(run){
  const text=value=>typeof value==='string'&&value.trim()?value.trim():null;
  const requested=text(run?.selection?.invest_version??run?.native_version?.requested);
  const observed=text(run?.runtime?.version??run?.native_version?.observed);
  return {requested,observed,comparison_version:observed||requested,
    basis:observed?'observed_runtime':requested?'requested_legacy':'unavailable',
    differs_from_requested:Boolean(observed&&requested&&observed!==requested)};
}

const nativeVersionLabel=run=>{
  if(run?.model_versions||run?.stages||run?.stage_summary)return nativeModelVersionLabel(run);
  const version=scenarioNativeVersion(run);
  if(!version.comparison_version)return 'InVEST version unavailable';
  if(!version.observed)return 'InVEST '+version.requested+' requested; execution version not retained';
  return 'InVEST '+version.observed+' observed'+(version.differs_from_requested?' (requested '+version.requested+')':'');
};
const analyzedOutputs=record=>Array.isArray(record?.comparison_pollutants)?record.comparison_pollutants:
  [...new Set(rows(record?.physical).map(row=>row.pollutant))].filter(id=>massUnits[id]);
const canonicalSelection=value=>{
  const ordered=item=>Array.isArray(item)?item.map(ordered):item&&typeof item==='object'?Object.fromEntries(Object.keys(item).sort().map(key=>[key,ordered(item[key])])):item;
  return JSON.stringify(ordered(value));
};
const tabs=[
  ['physical','Physical changes'],['priority','Planning priorities'],
  ['sensitivity','Weight sensitivity'],['pairs','Compare alternatives'],
  ['coverage','Coverage and choices'],['source-areas','Source areas'],['delivery','GIS delivery'],['files','Download results']
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


/** Exact typed attribute predicates used by retained vector-source selections. */
export function parseAnalysisFilters(entries){
  const pairs=[],seen=new Set();
  for(const entry of rows(entries)){
    const name=String(entry?.field??''),raw=String(entry?.value??''),type=entry?.type||'text';
    if(!name&&!raw&&type==='text')continue;
    if(!name.trim())throw Error('Name each source attribute filter.');
    if(seen.has(name))throw Error('Use each source attribute only once: '+name);
    seen.add(name);
    let value;
    if(type==='text')value=raw;
    else if(type==='number'){
      if(!raw.trim()||!Number.isFinite(Number(raw)))throw Error('Enter a finite source number for '+name+'.');
      value=Number(raw);
    }else if(type==='boolean'){
      if(!['true','false'].includes(raw.trim().toLowerCase()))throw Error('Enter true or false for '+name+'.');
      value=raw.trim().toLowerCase()==='true';
    }else if(type==='null')value=null;
    else throw Error('Choose a supported source value type for '+name+'.');
    pairs.push([name,value]);
  }
  return Object.fromEntries(pairs);
}

export function validateAnalysisZones(value,sourceCatalog){
  if(!Array.isArray(value))throw Error('Supply planning areas as source-bound selections.');
  const seen=new Set(['reporting_area']);
  return value.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item))throw Error('Each planning area needs its original source selection.');
    const zone=JSON.parse(JSON.stringify(item,(key,value)=>{
      if(typeof value==='number'&&!Number.isFinite(value))throw Error('Use finite values in retained planning-area selections.');
      return value;
    }));
    for(const key of ['id','source_collection_id','source_id']){
      if(typeof zone[key]!=='string'||!zone[key].trim())throw Error('Each planning area needs its '+label(key)+'.');
      zone[key]=zone[key].trim();
    }
    if(seen.has(zone.id))throw Error('Use a unique planning-area ID other than reporting_area: '+zone.id);
    seen.add(zone.id);
    if(zone.where!==undefined&&(zone.where===null||typeof zone.where!=='object'||Array.isArray(zone.where)))throw Error('Planning-area filters must be named source attributes.');
    for(const [name,actual] of Object.entries(zone.where||{})){
      if(!name||!['string','number','boolean'].includes(typeof actual)&&actual!==null||
         typeof actual==='number'&&!Number.isFinite(actual))throw Error('Use scalar source attribute values for '+zone.id+'.');
    }
    if(zone.buffer_m!==undefined&&(typeof zone.buffer_m!=='number'||!Number.isFinite(zone.buffer_m)||zone.buffer_m<0))throw Error('Use a finite nonnegative planning-area buffer.');
    if(zone.rank_group!==undefined&&zone.rank_group!==null&&(typeof zone.rank_group!=='string'||!zone.rank_group.trim()))throw Error('Use a nonempty rank group or leave the area unranked.');
    if(![undefined,null,'critical_drinking_water','high_quality_waters'].includes(zone.map_family))throw Error('Choose a supported planning-area map family.');
    if(sourceCatalog){
      const edition=rows(sourceCatalog).find(source=>source?.id===zone.source_collection_id);
      const source=rows(edition?.entries).find(entry=>entry?.id===zone.source_id);
      if(!source||source.kind!=='vector')throw Error('The original vector source for '+zone.id+' is absent from this workspace.');
      if(!zone.title)zone.title=source.title||zone.id;
    }else if(!zone.title)zone.title=zone.id;
    return zone;
  });
}

function sourceAreaOrigin(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Use the original source-area preparation metadata.');
  return JSON.parse(JSON.stringify(value,(key,part)=>{
    if(typeof part==='number'&&!Number.isFinite(part))throw Error('Use finite values in source-area preparation metadata.');
    return part;
  }));
}

/** Convert actual prepared source-area selectors, preserving their original IDs. */
export function analysisZonesFromReceivingPlan({preparation,nativeSelection,receptorIds}={}){
  if(preparation?.schema!=='upstate.public-water-preparation/v1'||!preparation.plan_id||!preparation.source_collection_id)throw Error('Supply the original public-water preparation outcome and imported plan identity.');
  if(!Array.isArray(nativeSelection?.receptors))throw Error('Supply the fully bound receiving-waters selection.');
  const requested=receptorIds??preparation.receptor_ids;
  if(!Array.isArray(requested)||!requested.length)throw Error('Choose the prepared source-area receptor IDs.');
  const ids=[...new Set(requested)],prepared=new Set(rows(preparation.receptor_ids));
  if(ids.some(id=>typeof id!=='string'||!prepared.has(id)))throw Error('Choose receptor IDs retained by this preparation outcome.');
  const byId=new Map();
  for(const receptor of nativeSelection.receptors){
    if(!receptor||typeof receptor.id!=='string'||byId.has(receptor.id))throw Error('Use the original uniquely identified receiving-water receptors.');
    byId.set(receptor.id,receptor);
  }
  const zones=ids.map(id=>{
    const receptor=byId.get(id);
    if(!receptor)throw Error('The prepared receptor is absent from its native selection: '+id);
    if(receptor.relation?.method!=='source_area')throw Error('Use the native receiving-water method for nonpolygon relations: '+id);
    if(!receptor.source?.source_collection_id||!receptor.source?.source_id)throw Error('The prepared receptor needs its immutable imported source: '+id);
    const source=receptor.source;
    if(source.source_collection_id!==preparation.source_collection_id)throw Error('The source-area edition differs from the original preparation import: '+id);
    const zone={...source,id:receptor.id,title:receptor.title||receptor.id,
      source_collection_id:source.source_collection_id,source_id:source.source_id,
      metadata:{...(source.metadata||{}),...(receptor.metadata||{}),
        source_plan_id:preparation.plan_id,receptor_ids:[receptor.id],
        source_relation_method:'source_area',source_geometry_scope:'published_polygon',
        ...(receptor.classification!==undefined?{source_classification:receptor.classification}:{})}};
    if(source.layer)zone.layer=source.layer;
    if(source.where!==undefined)zone.where=source.where;
    if(['critical_drinking_water','high_quality_waters'].includes(receptor.family))zone.map_family=receptor.family;
    return zone;
  });
  return validateAnalysisZones(zones);
}


/** Read producer lineage without moving or duplicating its original metadata. */
export function analysisSourceMetadata(zone){
  const keys=['source_plan_id','receptor_ids','source_relation_method','source_geometry_scope',
    'source_classification','original_source_selection','source_selection_changed',
    'utility_id','utility_title','source_crs','intake_reference','intake_original_feature','protection_source'];
  const legacy=Object.fromEntries(keys.filter(key=>zone&&Object.hasOwn(zone,key)).map(key=>[key,zone[key]]));
  const metadata=zone?.metadata;
  return {...legacy,...(metadata&&typeof metadata==='object'&&!Array.isArray(metadata)?metadata:{})};
}

/** Retained geometry summaries and exact selections, including the implicit reporting area. */
export function scenarioSourceAreas(record){
  const choices=new Map(rows(record?.selection?.zones).map(zone=>[zone.id,zone]));
  return rows(record?.regions).map(region=>{
    const source=region.source&&typeof region.source==='object'?region.source:{};
    const retained=source.selection&&typeof source.selection==='object'&&!Array.isArray(source.selection)?source.selection:null;
    const selection=retained||(region.id!=='reporting_area'?choices.get(region.id):null)||null;
    return {id:region.id,title:region.title||region.id,reporting_area:region.id==='reporting_area',
      area_ha:region.area_ha??null,selected_cells:region.selected_cells??null,
      source_features:region.source_features??null,buffer_m:region.buffer_m??selection?.buffer_m??null,
      rank_group:region.rank_group??selection?.rank_group??null,
      map_family:region.map_family??selection?.map_family??null,
      source,selection,metadata:analysisSourceMetadata(selection),
      selection_record:retained?'retained_region':selection?'saved_analysis_selection':'unavailable'};
  });
}

/** Flat source inventory. Typed predicates and full metadata remain JSON values in CSV cells. */
export function scenarioSourceInventory(record){
  return scenarioSourceAreas(record).map(area=>{
    const choice=area.selection||{},metadata=area.metadata;
    return {analysis_id:record?.id??null,grid_id:record?.grid_id??null,
      baseline_run_id:record?.baseline_run_id??null,
      area_id:area.id,area_title:area.title,scope:area.reporting_area?'baseline_reporting_area':'source_intersection_with_baseline_reporting_area',
      map_family:area.map_family,rank_group:area.rank_group,
      geometry_area_ha:area.area_ha,selected_cells:area.selected_cells,source_features:area.source_features,
      source_plan_id:metadata.source_plan_id??null,receptor_ids:rows(metadata.receptor_ids),
      source_relation_method:metadata.source_relation_method??null,source_geometry_scope:metadata.source_geometry_scope??null,
      source_collection_id:choice.source_collection_id??null,source_id:choice.source_id??null,
      layer:choice.layer??null,where:choice.where??{},buffer_m:area.buffer_m,
      source_title:area.source.title??null,source_uri:area.source.uri??null,
      source_vintage:area.source.vintage??null,source_sha256:area.source.sha256??null,
      source_selection_changed:metadata.source_selection_changed===true,
      original_source_selection:metadata.original_source_selection??null,
      metadata:choice.metadata??null,selection_record:area.selection_record,
      retained_selection:area.selection};
  });
}

/** Reimportable source choices; the target analysis supplies its own reporting boundary. */
export function scenarioSourceAreaEnvelope(record){
  if(!record||record.state!=='complete'||!record.id)throw Error('Open a complete retained analysis before exporting its source areas.');
  const areas=scenarioSourceAreas(record),chosen=areas.filter(area=>!area.reporting_area);
  if(!chosen.length)throw Error('This analysis contains its baseline reporting area only.');
  const missing=chosen.find(area=>!area.selection);
  if(missing)throw Error('The retained source selection is unavailable for '+missing.title+'. Open the original workspace record to recover this area.');
  const zones=validateAnalysisZones(chosen.map(area=>area.selection));
  const origins=rows(record.selection?.source_area_origins).map(sourceAreaOrigin);
  const reporting=areas.find(area=>area.reporting_area);
  return {schema:'upstate.scenario-source-areas/v1',
    selection:{title:record.title||record.selection?.title||'Retained planning areas',zones,
      ...(origins.length?{source_area_origins:origins}:{})},
    origin:{source_analysis_id:record.id,source_analysis_schema:record.schema||'upstate.scenario-analysis/v1',
      source_grid_id:record.grid_id??null,source_baseline_run_id:record.baseline_run_id??null,
      source_run_ids:rows(record.run_ids).length?rows(record.run_ids):rows(record.runs).map(run=>run.id),
      source_plan_ids:[...new Set(chosen.map(area=>area.metadata.source_plan_id).filter(Boolean))],
      reporting_area:{selection:reporting?.selection??null,geography:record.coverage?.geography??null},
      scope:'Retained source definitions; each new analysis intersects them with its selected baseline reporting area.'}};
}

export function attachScenarioAnalysis({getState,api,endpoint,openForm,submitAction,fileList,toast,openItem,openDelivery,openReceivingPlan}){
  const cache=new Map(),inflight=new Map();
  let sourceIntakeVersion=0;
  const delivery=createAnalysisDelivery({getState,api,endpoint,openDelivery,openReceivingPlan,openItem,onChange:()=>redraw()});
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
      workspaceKey=workspace();generation++;sourceIntakeVersion++;error='';
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
        table(['Run','Change type','Native models','Compared outputs','Native version','Grid','Profile','Scenario'],rows(record.runs).map(r=>'<tr>'+
          cell(r.title||short(r.id))+cell(comparisonName(r.comparison_kind))+
          cell(rows(r.model_scope?.selected_models||r.selection?.models||['ndr','sdr']).map(name=>name.toUpperCase()).join(' + '))+
          cell(analyzedOutputs(record).map(pollutantName).join(', '))+cell(nativeVersionLabel(r))+cell(short(r.selection?.grid_id))+
          cell(short(r.selection?.profile_id))+cell(short(r.selection?.scenario_id))+'</tr>')))+
      section('Planning-area sources','The retained source definitions and preparation origins are available in Source areas.',
        table(['Area','Map family','Rank group','Geometry area (ha)','Source edition'],scenarioSourceAreas(record).map(area=>'<tr>'+
          cell(area.title)+cell(area.map_family?label(area.map_family):'General planning area')+cell(area.rank_group||'Unranked')+
          cell(amount(area.area_ha,2),'number-cell')+cell(area.selection?.source_collection_id||'Unavailable')+'</tr>'))+
        '<p>'+button('tab','Inspect source areas','data-tab="source-areas"')+'</p>');
  }
  const definition=(title,value)=>'<div><dt>'+esc(title)+'</dt><dd>'+esc(value??'—')+'</dd></div>';
  function bindingView(choice,title){
    if(!choice)return '<p class="notice">The original source selection is absent from this retained record.</p>';
    const predicates=Object.entries(choice.where||{});
    return '<div class="analysis-source-binding"><h4>'+esc(title)+'</h4><dl class="analysis-source-facts">'+
      definition('Source edition ID',choice.source_collection_id)+definition('Vector source ID',choice.source_id)+
      definition('Layer',choice.layer||'Retained source default')+definition('Added buffer (metres)',choice.buffer_m??0)+
      '</dl>'+table(['Source attribute','Equals','Value type'],predicates.map(([name,value])=>'<tr>'+
        cell(name)+cell(JSON.stringify(value))+cell(value===null?'Empty source value':typeof value==='string'?'Text':typeof value==='boolean'?'True or false':'Number')+'</tr>'),
        predicates.length?'Exact source predicates':'All source features; no attribute filter')+'</div>';
  }
  function sourceAreaScope(area){
    if(area.reporting_area)return 'The full reporting area retained by the selected baseline grid.';
    if(area.metadata.source_selection_changed===true)return 'The edited source geometry, filters and buffer intersected with the baseline reporting area. The original plan and receptor IDs identify the preparation before those edits.';
    if(area.metadata.source_geometry_scope==='published_polygon'&&(area.buffer_m??0)===0)return 'The published source polygon intersected with the baseline reporting area, with zero added buffer.';
    return 'The retained source geometry, filters and buffer intersected with the baseline reporting area.';
  }
  function sourceActions(record){
    const areas=scenarioSourceAreas(record),additional=areas.filter(area=>!area.reporting_area);
    return '<div class="analysis-source-actions">'+
      button('source-areas-json','Download source areas JSON',additional.length?'':'disabled title="This analysis contains its baseline reporting area only"')+
      button('source-inventory-csv','Download source inventory CSV',areas.length?'':'disabled')+
      button('use-settings','Use saved settings')+'</div>';
  }
  function sourceAreas(record){
    const areas=scenarioSourceAreas(record);
    const plans=[...new Set(areas.map(area=>area.metadata.source_plan_id).filter(Boolean))];
    const savedOrigins=rows(record.selection?.source_area_origins);
    const additional=areas.filter(area=>!area.reporting_area);
    const edited=additional.filter(area=>area.metadata.source_selection_changed===true);
    const cards=areas.map(area=>{
      const choice=area.selection,metadata=area.metadata,editionId=choice?.source_collection_id;
      const editionPresent=rows(data().sources).some(source=>source.id===editionId);
      const uri=typeof area.source.uri==='string'&&/^https?:\/\//i.test(area.source.uri)?area.source.uri:null;
      const actions=button('area-results','View physical results','data-area="'+esc(area.id)+'"')+
        (editionId?button('source-edition','Open source edition','data-id="'+esc(editionId)+'"'+(editionPresent?'':' disabled title="The original source edition is absent from this workspace"')):'')+
        (metadata.source_plan_id&&typeof openReceivingPlan==='function'?button('open-source-plan','Open prepared plan','data-id="'+esc(metadata.source_plan_id)+'"'):'')+
        (uri?'<a href="'+esc(uri)+'" target="_blank" rel="noopener noreferrer">Open original source</a>':'');
      const provenance=metadata.source_plan_id||rows(metadata.receptor_ids).length?
        '<dl class="analysis-source-facts">'+definition('Prepared source plan ID',metadata.source_plan_id)+
        definition('Original receptor IDs',rows(metadata.receptor_ids).join(', ')||null)+
        definition('Source relation',metadata.source_relation_method)+definition('Original geometry scope',metadata.source_geometry_scope)+
        (metadata.utility_title||metadata.utility_id?definition('Utility',metadata.utility_title||metadata.utility_id):'')+
        (metadata.source_classification?definition('Source classification',typeof metadata.source_classification==='string'?metadata.source_classification:JSON.stringify(metadata.source_classification)):'')+'</dl>':'';
      const changes=metadata.source_selection_changed===true?
        '<div class="analysis-source-edited"><h4>Source binding changed after preparation</h4><p>The current calculation uses the selected binding below. The original preparation binding remains available for comparison and export.</p>'+
        bindingView(metadata.original_source_selection,'Original preparation binding')+'</div>':'';
      const originDetails=Object.keys(metadata).length?'<details class="technical"><summary>Full retained source lineage</summary><pre class="json-view">'+
        esc(JSON.stringify(metadata,null,2))+'</pre></details>':'';
      return '<article class="analysis-source-area"><header><div><h3>'+esc(area.title)+'</h3><p class="analysis-source-identity">'+esc(area.id)+
        (area.reporting_area?' · Baseline reporting boundary':'')+'</p></div><div class="analysis-source-actions">'+actions+'</div></header>'+
        '<p class="analysis-explanation">'+esc(sourceAreaScope(area))+'</p>'+
        '<dl class="analysis-source-facts">'+definition('Map family',area.map_family?label(area.map_family):'General planning area')+
        definition('Rank group',area.rank_group||'Unranked')+
        definition('Geometry area within reporting boundary (ha)',amount(area.area_ha,4))+
        definition('Selected grid cells',amount(area.selected_cells,0))+
        definition('Original source features',amount(area.source_features,0))+
        definition('Retained source title',area.source.title)+definition('Original source URI',area.source.uri)+definition('Source vintage',area.source.vintage)+
        definition('Source SHA-256',area.source.sha256)+
        (area.source.scope?definition('Original source scope',typeof area.source.scope==='string'?area.source.scope:JSON.stringify(area.source.scope)):'')+'</dl>'+
        provenance+changes+bindingView(choice,'Selected source binding')+
        (area.selection_record==='saved_analysis_selection'?'<p class="note">Source selection recovered from the saved analysis choices; this record has no region-level source selection.</p>':'')+
        originDetails+'</article>';
    }).join('');
    return section('Retained source areas',
      additional.length+' planning area'+(additional.length===1?'':'s')+' plus the baseline reporting boundary. All retained areas are shown here, independent of the physical-table filter.',
      sourceActions(record)+'<p class="analysis-explanation">'+
      'These annual model results describe the selected geometry inside the baseline reporting area. Geometry area and selected grid-cell counts are separate retained quantities. '+
      (plans.length?'Prepared source plans: '+plans.length+'. ':'')+
      (edited.length?'Edited preparation bindings: '+edited.length+'. ':'')+
      'Map family groups a planning layer. It does not change the mass units or create an upstream contributing catchment.</p>'+
      '<p class="notice">Areas can overlap. Keep their physical totals separate; use the corresponding native receiving-water union result for a combined source-area total. This analysis retains individual area results.</p>'+
      '<div class="analysis-source-area-list">'+(cards||'<p>No retained area summaries are present in this record.</p>')+'</div>'+
      (savedOrigins.length?'<details class="technical"><summary>Original preparation and import records ('+savedOrigins.length+')</summary><pre class="json-view">'+esc(JSON.stringify(savedOrigins,null,2))+'</pre></details>':''));
  }
  function files(record){
    return '<p class="analysis-explanation">Download the complete saved analysis, physical and comparison tables, fixed-scale planning rasters and weight-spread rasters. A workspace backup preserves this analysis with its original model runs and sources.</p>'+
      fileList(rows(record._downloads))+
      section('Source choices and repeat analysis','The source-area JSON reopens in the original Planning areas file input. It carries every retained area selection and preparation origin; the new analysis supplies its selected baseline reporting boundary.',
        sourceActions(record)+button('settings-json','Download saved analysis settings')+
        '<p class="note">Use saved settings restores the selected native runs, original cap method, planning weights, sensitivity choices and source areas in the original form.</p>')+
      '<details class="technical"><summary>Saved analysis selection</summary><pre class="json-view">'+esc(JSON.stringify(record.selection,null,2))+'</pre></details>';
  }
  function detail(record){
    keepFilters(record);
    const body={physical,priority,sensitivity,pairs,coverage,'source-areas':sourceAreas,delivery:row=>delivery.render(row),files}[local.tab](record);
    return section(record.title||record.selection?.title||'Selected scenario analysis','Baseline: '+runName(record,record.baseline_run_id)+'. Compared native outputs: '+analyzedOutputs(record).map(pollutantName).join(', ')+'.',
      '<div class="analysis-tabs" role="tablist" aria-label="Scenario analysis results">'+tabs.map(([id,title])=>'<button type="button" role="tab" tabindex="'+(local.tab===id?'0':'-1')+'" aria-selected="'+(local.tab===id)+'" data-action="analysis-tab" data-tab="'+id+'">'+esc(title)+'</button>').join('')+'</div>'+
      (['files','source-areas','delivery'].includes(local.tab)?'':filters(record))+'<div class="analysis-results" role="tabpanel" aria-label="'+esc(tabs.find(t=>t[0]===local.tab)?.[1])+'">'+body+'</div>');
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
    if(local.tab==='delivery'&&selected())delivery.ensure(selected());
  }
  function mount(node){
    controller?.abort();container=node;controller=new AbortController();const g=++generation;
    node.addEventListener('change',event=>{
      if(event.target.matches?.('[data-analysis-delivery-plan]')){delivery.selectPlan(selected(),event.target.value);return;}
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
  function runTitle(id,selectedData=data()){
    const run=rows(selectedData.runs).find(r=>r.id===id),scenario=rows(selectedData.scenarios).find(s=>s.id===run?.selection?.scenario_id);
    return scenario?.title||short(id);
  }
  function weightInputs(prefix,value={nitrogen_export:1,phosphorus_export:1,sediment_export:1}){
    return pollutants.map(([id,title])=>field(title,input(prefix+id,value[id]??0,'type="number" min="0" step="any" required'))).join('');
  }
  let weightNumber=0,weightIds=new Set(['selected']),weightDrafts=new Map();
  function weightRow(value={}){
    let id=value.id;
    if(!id){do{id='choice_'+(++weightNumber);}while(weightIds.has(id));}
    if(!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id)||id==='selected')throw Error('Use the original unique sensitivity weight-set IDs.');
    weightIds.add(id);weightDrafts.set(id,sourceAreaOrigin(value));
    return '<div data-analysis-weight-row class="analysis-editor-row">'+input('weight_id',id,'type="hidden"')+
      field('Weight-set name',input('weight_title',value.title||(value.id?id:''),'required maxlength="160"'))+
      weightInputs('weight_',value.weights)+button('weight-remove','Remove','','small')+'</div>';
  }
  let zoneNumber=0,zoneRowNumber=0;
  let zoneIds=new Set(),zoneDrafts=new Map();
  function filterRow(name='',value=''){
    const type=value===null?'null':typeof value==='number'?'number':typeof value==='boolean'?'boolean':'text';
    return '<div data-analysis-zone-filter class="analysis-zone-filter">'+
      field('Source attribute',input('zone_filter_field',name))+
      field('Equals',input('zone_filter_value',value===null?'':String(value),type==='null'?'disabled':''))+
      field('Value type','<select name="zone_filter_type">'+[['text','Text'],['number','Number'],['boolean','True or false'],['null','Empty value']].map(([id,title])=>'<option value="'+id+'"'+(type===id?' selected':'')+'>'+title+'</option>').join('')+'</select>')+
      button('zone-filter-remove','Remove filter','','small')+'</div>';
  }
  function zoneRow(value={},sourceCatalog=rows(data().sources)){
    let areaId=value.id;
    if(!areaId){do{areaId='planning-area-'+(++zoneNumber);}while(zoneIds.has(areaId));}
    zoneIds.add(areaId);
    const rowKey=String(++zoneRowNumber);
    zoneDrafts.set(rowKey,JSON.parse(JSON.stringify(value)));
    const edition=sourceCatalog.find(source=>source.id===value.source_collection_id);
    const predicates=Object.entries(value.where||{});
    const lineage=analysisSourceMetadata(value);
    const origin=lineage.source_plan_id?'<p class="note analysis-origin">Original source plan: '+esc(lineage.source_plan_id)+
      '. Receptors: '+esc(rows(lineage.receptor_ids).join(', '))+'. With retained polygon filters and zero added buffer, this analysis covers the selected polygon’s intersection with the baseline reporting area. Filter and buffer edits retain their original source definition. Use the native receiving-water union for a combined total across overlapping areas.</p>':'';
    return '<fieldset data-analysis-zone-row data-analysis-zone-key="'+rowKey+'" class="analysis-zone"><legend>Retained planning area</legend><div class="analysis-editor-grid">'+
      field('Area ID',input('zone_id',areaId,'required'))+
      field('Area name',input('zone_title',value.title||'','required maxlength="160"'))+
      field('Source edition','<select name="zone_collection" required>'+options(sourceCatalog,value.source_collection_id||'','Choose edition')+'</select>')+
      field('Vector source','<select name="zone_source" required>'+options(rows(edition?.entries).filter(entry=>entry.kind==='vector'),value.source_id||'','Choose vector source')+'</select>')+
      field('Layer',input('zone_layer',value.layer||''),'Leave empty to use the retained source layer.')+
      field('Buffer (metres)',input('zone_buffer',value.buffer_m??0,'type="number" min="0" step="any"'),'Published polygons need no added buffer. Use a positive buffer for lines or points.')+
      field('Map family','<select name="zone_map_family">'+options([{id:'critical_drinking_water',title:'Critical drinking-water protection'},{id:'high_quality_waters',title:'High-quality waters'}],value.map_family||'','General planning area')+'</select>')+
      field('Rank group',input('zone_rank_group',value.rank_group||''),'Leave empty for overlapping or otherwise incomparable areas.')+
      '</div><div class="analysis-zone-filters" data-analysis-zone-filters>'+predicates.map(([name,actual])=>filterRow(name,actual)).join('')+'</div>'+
      button('zone-filter-add','Add attribute filter','','small')+origin+button('zone-remove','Remove planning area','','small')+'</fieldset>';
  }
  function sourceOptions(row,sourceCatalog=rows(data().sources)){
    const edition=sourceCatalog.find(s=>s.id===row.querySelector('[name="zone_collection"]').value);
    const source=row.querySelector('[name="zone_source"]'),previous=source.value;
    source.innerHTML=options(rows(edition?.entries).filter(e=>e.kind==='vector'),previous,'Choose vector source');
  }
  function zoneSelections(form,sourceCatalog=rows(data().sources)){
    const bindings=zone=>({
      source_collection_id:zone.source_collection_id,source_id:zone.source_id,
      layer:zone.layer||null,where:zone.where||{},buffer_m:zone.buffer_m||0
    });
    const chosen=[...form.querySelectorAll('[data-analysis-zone-row]')].map(row=>{
      const value=name=>row.querySelector('[name="zone_'+name+'"]').value.trim();
      const original=zoneDrafts.get(row.dataset.analysisZoneKey)||{},zone={...original,
        id:value('id'),title:value('title'),source_collection_id:value('collection'),source_id:value('source')};
      if(!zone.title)throw Error('Name every planning area.');
      for(const name of ['layer','where','buffer_m','rank_group','map_family'])delete zone[name];
      if(value('layer'))zone.layer=value('layer');
      const filters=parseAnalysisFilters([...row.querySelectorAll('[data-analysis-zone-filter]')].map(filter=>({
        field:filter.querySelector('[name="zone_filter_field"]').value,
        value:filter.querySelector('[name="zone_filter_value"]').value,
        type:filter.querySelector('[name="zone_filter_type"]').value
      })));
      if(Object.keys(filters).length)zone.where=filters;
      const buffer=Number(value('buffer'));
      if(!Number.isFinite(buffer)||buffer<0)throw Error('Use a finite nonnegative planning-area buffer.');
      if(buffer>0)zone.buffer_m=buffer;
      if(value('rank_group'))zone.rank_group=value('rank_group');
      if(value('map_family'))zone.map_family=value('map_family');
      const provenance=analysisSourceMetadata(original);
      if(provenance.source_plan_id){
        const retainedLineage=original.metadata?.source_plan_id?(zone.metadata={...original.metadata}):zone;
        const preparedBinding=provenance.original_source_selection||bindings(original);
        if(canonicalSelection(preparedBinding)!==canonicalSelection(bindings(zone))){
          retainedLineage.original_source_selection=preparedBinding;
          retainedLineage.source_selection_changed=true;
        }else{
          delete retainedLineage.original_source_selection;
          delete retainedLineage.source_selection_changed;
        }
      }
      return zone;
    });
    return validateAnalysisZones(chosen,sourceCatalog);
  }
  function newAnalysis(previous=null,selectedData=data()){
    sourceIntakeVersion++;
    const formWorkspace=workspace(),sourceCatalog=rows(selectedData.sources);
    if(!formWorkspace)throw Error('Select a scientific workspace before building an analysis.');
    const completed=rows(selectedData.runs).filter(completeNativeRun);
    if(!completed.length)throw Error('Complete the selected nutrient or sediment model outputs before building an analysis. Open Native model runs to continue those calculations.');
    const initial=previous?.selection||{};
    const initialZones=validateAnalysisZones(initial.zones||[],sourceCatalog);
    const sourceAreaOrigins=rows(initial.source_area_origins).map(sourceAreaOrigin);
    zoneNumber=0;zoneRowNumber=0;zoneIds=new Set(initialZones.map(zone=>zone.id));zoneDrafts=new Map();
    weightNumber=0;weightIds=new Set(['selected',...rows(initial.weight_sets).map(choice=>choice.id)]);weightDrafts=new Map();
    const baseline=initial.baseline_run_id||completed.find(r=>rows(selectedData.scenarios).find(s=>s.id===r.selection.scenario_id)?.kind==='baseline')?.id||completed[0].id;
    const runChoices=completed.map(r=>({id:r.id,title:runTitle(r.id,selectedData)+' · '+(r.selection.models||['ndr','sdr']).map(name=>name.toUpperCase()).join(' + ')+' · '+short(r.selection.profile_id)+' · '+nativeVersionLabel(r)}));
    const html='<div class="analysis-form"><div class="form-grid">'+
      field('Analysis title',input('analysis_title',initial.title||'Watershed scenario analysis','required maxlength="240"'))+
      field('Baseline','<select name="analysis_baseline" required>'+options(runChoices,baseline,'Choose baseline')+'</select>')+
      '</div><fieldset><legend>Alternatives on the same retained grid and native version</legend><p class="note">Leave alternatives empty to retain baseline totals and priorities. Selected alternatives must share at least one native model with every other selected run. Observed executor versions determine compatibility; older runs explicitly show their saved requested-version fallback.</p><div id="analysis-run-choices"></div><p id="analysis-common-outputs" class="notice" role="status"></p></fieldset>'+
      '<fieldset><legend>Planning score</legend><p class="note">Set relative weights for the outputs shared by the selected native runs. All alternatives use the same baseline scale.</p><div class="analysis-editor-grid">'+
      weightInputs('analysis_',initial.weights)+field('Normalization','<select name="analysis_cap_mode"><option value="percentile"'+(!initial.caps?' selected':'')+'>Baseline percentile</option><option value="explicit"'+(initial.caps?' selected':'')+'>Explicit physical caps</option></select>')+
      field('Baseline percentile',input('analysis_percentile',initial.percentile??95,'type="number" min="0.000001" max="100" step="any" required'))+
      '</div><div id="analysis-explicit-caps" class="analysis-editor-grid" hidden>'+pollutants.map(([id,title,unit])=>field(title+' cap ('+unit+'/cell)',input('cap_'+id,initial.caps?.[id]??'','type="number" min="0.000000000001" step="any"'))).join('')+'</div></fieldset>'+
      '<fieldset><legend>Weight sensitivity</legend><p class="note">Add the planning choices to compare. The saved base weights are always included.</p><div id="analysis-weight-rows">'+rows(initial.weight_sets).map(choice=>weightRow(choice)).join('')+'</div>'+button('weight-add','Add weight selection','','small')+'</fieldset>'+
      '<fieldset><legend>Planning areas</legend><p class="note">The original reporting area is always included. Retained vector areas are intersected with that reporting boundary. Attribute filters retain their exact source types; overlapping areas stay separate.</p><label><span>Add prepared source areas</span><input type="file" name="analysis_source_areas_file" accept=".json,application/json"><small>Choose the source-area JSON produced for this workspace. Existing planning areas stay in the form.</small></label><div id="analysis-zone-rows">'+initialZones.map(zone=>zoneRow(zone,sourceCatalog)).join('')+'</div>'+button('zone-add','Add planning area','','small')+'</fieldset></div>';
    openForm('Build scenario analysis','Select completed native outputs and retain the full quantitative analysis in this workspace.',html,'Build analysis',async()=>{
      if(workspace()!==formWorkspace)throw Error('Reopen this analysis draft in its original workspace.');
      const form=document.getElementById('operation-form'),val=name=>form.elements.namedItem(name)?.value;
      const ids=[...form.querySelectorAll('[name="analysis_run"]:checked')].map(n=>n.value);
      const baselineRun=completed.find(r=>r.id===val('analysis_baseline'));
      const selectedRuns=[baselineRun,...ids.map(id=>completed.find(run=>run.id===id))];
      if(!baselineRun||selectedRuns.some(run=>!run||run.selection.grid_id!==baselineRun.selection.grid_id))throw Error('Select alternatives on the baseline’s original grid.');
      const shared=commonOutputs(selectedRuns);
      if(!shared.length)throw Error('Choose a cohort that shares nutrient or sediment outputs across every selected run.');
      const versionIssues=nativeCommonVersionIssues(selectedRuns,nativeModelsForOutputs(shared));
      if(versionIssues.length)throw Error(versionIssues.join(' '));
      const selection={...sourceAreaOrigin(initial),title:val('analysis_title').trim(),baseline_run_id:baselineRun.id,scenario_run_ids:ids,
        weights:parseAnalysisWeights(Object.fromEntries(pollutants.map(([id])=>[id,shared.includes(id)?val('analysis_'+id):0])))};
      delete selection.caps;delete selection.percentile;
      if(val('analysis_cap_mode')==='explicit'){
        selection.caps={};
        for(const id of shared){const v=Number(val('cap_'+id));if(!Number.isFinite(v)||v<=0)throw Error('Every selected physical cap must be greater than zero.');selection.caps[id]=v;}
      }else{const p=Number(val('analysis_percentile'));if(!Number.isFinite(p)||p<=0||p>100)throw Error('Choose a baseline percentile above zero and at most 100.');selection.percentile=p;}
      const chosenWeightIds=new Set(['selected']);
      selection.weight_sets=[...form.querySelectorAll('[data-analysis-weight-row]')].map(row=>{
        const id=row.querySelector('[name="weight_id"]').value;
        if(!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id)||chosenWeightIds.has(id))throw Error('Use a unique ID for each sensitivity weight selection.');
        chosenWeightIds.add(id);
        const title=row.querySelector('[name="weight_title"]').value.trim();if(!title)throw Error('Name each sensitivity weight selection.');
        return {...(weightDrafts.get(id)||{}),id,title,weights:parseAnalysisWeights(Object.fromEntries(pollutants.map(([key])=>[key,shared.includes(key)?row.querySelector('[name="weight_'+key+'"]').value:0])))};
      });
      selection.zones=zoneSelections(form,sourceCatalog);
      if(sourceAreaOrigins.length)selection.source_area_origins=sourceAreaOrigins.map(sourceAreaOrigin);
      return submitAction('scenario.analyze',selection);
    },()=>{
      const form=document.getElementById('operation-form');
      form._analysisSourceCatalog=sourceCatalog;
      function scope(){
        const baselineRun=completed.find(run=>run.id===form.elements.namedItem('analysis_baseline').value);
        const selectedRuns=[baselineRun,...[...form.querySelectorAll('[name="analysis_run"]:checked')].map(node=>completed.find(run=>run.id===node.value))];
        const shared=selectedRuns.every(Boolean)?commonOutputs(selectedRuns):[];
        const explicit=form.elements.namedItem('analysis_cap_mode').value==='explicit';
        document.getElementById('analysis-common-outputs').textContent=shared.length?
          'Compared native outputs: '+shared.map(pollutantName).join(', ')+'. '+(selectedRuns.length===1?'Baseline analysis.':(selectedRuns.length-1)+' selected alternative'+(selectedRuns.length===2?'':'s')+'.'):
          'These selected runs have no common native output. Change the alternatives to share NDR or SDR.';
        const versionIssues=shared.length?nativeCommonVersionIssues(selectedRuns,nativeModelsForOutputs(shared)):[];
        if(versionIssues.length)document.getElementById('analysis-common-outputs').textContent+=' Version requirements: '+versionIssues.join(' ');
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
        form.elements.namedItem('analysis_percentile').disabled=explicit;
      }
      form._analysisUpdateScope=scope;
      form.elements.namedItem('analysis_source_areas_file').addEventListener('change',async event=>{
        const file=event.target.files?.[0],originWorkspace=workspace();
        if(!file)return;
        try{
          const raw=await file.text();
          if(originWorkspace!==workspace()||document.getElementById('operation-form')!==form)return;
          const value=JSON.parse(raw.replace(/^\uFEFF/,''));
          const selection=value?.selection||value;
          const zones=validateAnalysisZones(selection?.zones,sourceCatalog);
          if(!zones.length)throw Error('The selected file contains no retained source areas.');
          const existing=new Set([...form.querySelectorAll('[data-analysis-zone-row]')].map(row=>row.querySelector('[name="zone_id"]').value.trim()));
          const duplicate=zones.find(zone=>existing.has(zone.id));
          if(duplicate)throw Error('This form already contains planning area '+duplicate.id+'. Remove that row before replacing its selection.');
          const origins=[...rows(selection.source_area_origins),...(value.origin?[value.origin]:[])].map(sourceAreaOrigin);
          const html=zones.map(zone=>zoneRow(zone,sourceCatalog)).join('');
          document.getElementById('analysis-zone-rows').insertAdjacentHTML('beforeend',html);
          for(const origin of origins){
            if(!sourceAreaOrigins.some(item=>canonicalSelection(item)===canonicalSelection(origin)))sourceAreaOrigins.push(origin);
          }
          toast('Added '+zones.length+' retained source area'+(zones.length===1?'':'s')+'.');
        }catch(error){
          if(originWorkspace===workspace()&&document.getElementById('operation-form')===form)toast(error.message||String(error));
        }finally{event.target.value='';}
      });
      function alternatives(){
        const b=completed.find(r=>r.id===form.elements.namedItem('analysis_baseline').value);
        const selectedIds=[...form.querySelectorAll('[name="analysis_run"]:checked')].map(n=>n.value);
        const initialIds=selectedIds.length?selectedIds:rows(initial.scenario_run_ids);
        const available=completed.filter(r=>r.id!==b?.id&&r.selection.grid_id===b?.selection.grid_id&&commonOutputs([b,r]).length);
        document.getElementById('analysis-run-choices').innerHTML=available.length?available.map(r=>'<label class="check"><input type="checkbox" name="analysis_run" value="'+esc(r.id)+'"'+(initialIds.includes(r.id)?' checked':'')+'><span>'+esc(runTitle(r.id,selectedData))+'<small>'+esc((r.selection.models||['ndr','sdr']).map(name=>name.toUpperCase()).join(' + ')+' · '+short(r.selection.profile_id)+' · '+nativeVersionLabel(r))+'</small></span></label>').join(''):'<p class="note">The baseline can be analyzed now. Completed alternatives on this grid will appear here. Execution versions are checked for the common outputs of the selected cohort.</p>';
        scope();
      }
      alternatives();form.elements.namedItem('analysis_baseline').addEventListener('change',alternatives);
      form.elements.namedItem('analysis_cap_mode').addEventListener('change',scope);
      form.querySelector('#analysis-run-choices').addEventListener('change',scope);
      form.querySelector('#analysis-zone-rows').addEventListener('change',event=>{
        if(event.target.name==='zone_collection')sourceOptions(event.target.closest('[data-analysis-zone-row]'),sourceCatalog);
        if(event.target.name==='zone_filter_type'){
          const value=event.target.closest('[data-analysis-zone-filter]').querySelector('[name="zone_filter_value"]');
          value.disabled=event.target.value==='null';
          if(value.disabled)value.value='';
        }
      });
    });
  }
  function create(request,selectedData=data()){
    if(request===undefined)return newAnalysis(null,selectedData);
    const seed=request?.selection;
    if(!seed||typeof seed!=='object'||Array.isArray(seed))throw Error('Supply a retained native-run selection for the analysis form.');
    if(request.workspace_key&&request.workspace_key!==workspace())throw Error('The selected runs belong to a different current workspace.');
    const completed=rows(selectedData.runs).filter(completeNativeRun),byId=new Map(completed.map(run=>[run.id,run]));
    const baseline=byId.get(seed.baseline_run_id);
    if(!baseline)throw Error('The supplied baseline must have completed its selected original native model outputs in this workspace.');
    if(!baseline.selection?.grid_id)throw Error('The supplied baseline has no retained model grid.');
    const requested=seed.scenario_run_ids??[];
    if(!Array.isArray(requested))throw Error('Supply original native alternative IDs as a list, or leave it empty for baseline analysis.');
    const ids=[...new Set(requested)];
    if(ids.some(id=>typeof id!=='string'||id===baseline.id||!byId.has(id)))throw Error('Each supplied alternative must be a distinct completed run of its selected native models.');
    if(ids.some(id=>byId.get(id).selection?.grid_id!==baseline.selection.grid_id))throw Error('The supplied alternatives must use the baseline original model grid.');
    const suppliedRuns=[baseline,...ids.map(id=>byId.get(id))];
    const versionIssues=nativeCommonVersionIssues(suppliedRuns,nativeModelsForOutputs(commonOutputs(suppliedRuns)));
    if(versionIssues.length)throw Error(versionIssues.join(' '));
    if(!commonOutputs([baseline,...ids.map(id=>byId.get(id))]).length)throw Error('Choose a native cohort that shares nutrient or sediment outputs across every selected run.');
    return newAnalysis({selection:{...seed,baseline_run_id:baseline.id,scenario_run_ids:ids}},selectedData);
  }
  async function createForSourceAreas(request){
    const expectedWorkspace=workspace(),requestVersion=++sourceIntakeVersion;
    if(!expectedWorkspace)throw Error('Select the original workspace for these source areas.');
    if(request?.workspace_key&&request.workspace_key!==expectedWorkspace)throw Error('These source areas belong to a different current workspace.');
    const seed=sourceAreaOrigin(request?.selection);
    const requestedZones=validateAnalysisZones(seed.zones);
    if(!requestedZones.length)throw Error('Choose at least one retained source area.');
    const origins=rows(seed.source_area_origins).map(sourceAreaOrigin);
    if(request.origin){
      const origin=sourceAreaOrigin(request.origin);
      if(!origins.some(item=>canonicalSelection(item)===canonicalSelection(origin)))origins.push(origin);
    }
    let selectedData=data();
    const available=zone=>rows(selectedData.sources).some(edition=>edition.id===zone.source_collection_id&&
      rows(edition.entries).some(entry=>entry.id===zone.source_id&&entry.kind==='vector'));
    if(!requestedZones.every(available)){
      const fresh=await api('/api/state?workspace='+encodeURIComponent(expectedWorkspace));
      if(workspace()!==expectedWorkspace)throw Error('The selected workspace changed while opening these source areas.');
      if(requestVersion!==sourceIntakeVersion)throw Error('A newer analysis draft replaced this source-area request.');
      if(fresh?.workspace_key!==expectedWorkspace||!fresh.data)throw Error('The returned source catalog belongs to a different workspace.');
      selectedData=fresh.data;
    }
    const zones=validateAnalysisZones(requestedZones,rows(selectedData.sources));
    const selected={...seed,zones,...(origins.length?{source_area_origins:origins}:{})};
    if(seed.baseline_run_id)return create({workspace_key:expectedWorkspace,selection:selected},selectedData);
    return newAnalysis({selection:selected},selectedData);
  }
  function download(content,filename,type){
    const url=URL.createObjectURL(new Blob([content],{type}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;
    document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  async function dispatch(node){
    const action=node.dataset.action?.replace(/^analysis-/,'');
    if(action?.startsWith('delivery-'))return delivery.dispatch(node,selected());
    if(action==='open-source-plan'){
      const id=node.dataset.id;
      if(!scenarioSourceAreas(selected()).some(area=>area.metadata.source_plan_id===id))throw Error('Choose a source plan retained by this saved analysis.');
      if(typeof openReceivingPlan!=='function')throw Error('Receive the original prepared-plan navigation callback.');
      return openReceivingPlan(id);
    }
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
    if(action==='zone-add'){const form=document.getElementById('operation-form');document.getElementById('analysis-zone-rows').insertAdjacentHTML('beforeend',zoneRow({},form._analysisSourceCatalog||rows(data().sources)));return;}
    if(action==='zone-remove'){node.closest('[data-analysis-zone-row]')?.remove();return;}
    if(action==='zone-filter-add'){node.closest('[data-analysis-zone-row]').querySelector('[data-analysis-zone-filters]').insertAdjacentHTML('beforeend',filterRow());return;}
    if(action==='zone-filter-remove'){node.closest('[data-analysis-zone-filter]')?.remove();return;}
    if(action==='native-run')return openItem('runs',node.dataset.id);
    if(action==='source-edition'){
      const record=selected(),id=node.dataset.id;
      if(!scenarioSourceAreas(record).some(area=>area.selection?.source_collection_id===id))throw Error('Choose a source edition retained by this analysis.');
      return openItem('sources',id);
    }
    if(action==='area-results'){
      const record=selected(),area=node.dataset.area;
      if(!rows(record?.regions).some(region=>region.id===area))throw Error('Choose a retained analysis area.');
      local.region=area;local.run='';local.tab='physical';redraw();
      container?.querySelector('[role="tab"][aria-selected="true"]')?.focus();return;
    }
    if(action==='use-settings'){
      const record=selected();if(!record?.selection)throw Error('Open the complete saved analysis settings.');
      return create({workspace_key:workspace(),selection:record.selection});
    }
    if(action==='source-areas-json'){
      const record=selected(),value=scenarioSourceAreaEnvelope(record);
      download(JSON.stringify(value,null,2)+'\n','scenario-source-areas-'+short(record.id)+'.json','application/json;charset=utf-8');
      toast('Downloaded '+value.selection.zones.length+' retained source-area selections and their preparation origins.');return;
    }
    if(action==='source-inventory-csv'){
      const record=selected(),items=scenarioSourceInventory(record);
      if(!items.length)throw Error('This analysis has no retained area summaries.');
      download(scenarioCSV(items),'scenario-source-inventory-'+short(record.id)+'.csv','text/csv;charset=utf-8');
      toast('Downloaded '+items.length+' source inventory rows, including the baseline reporting boundary.');return;
    }
    if(action==='settings-json'){
      const record=selected();if(!record?.selection)throw Error('Open the complete saved analysis settings.');
      download(JSON.stringify({schema:'upstate.scenario-analysis-selection/v1',source_analysis_id:record.id,selection:record.selection},null,2)+'\n',
        'scenario-analysis-settings-'+short(record.id)+'.json','application/json;charset=utf-8');
      toast('Downloaded the original saved analysis settings.');return;
    }
    if(action==='visible-csv'){
      const record=selected(),items=scenarioRows(record,local.tab,local);if(!items.length)throw Error('The current view has no rows to download.');
      download(scenarioCSV(items),'scenario-'+local.tab+'-'+short(record.id)+'.csv','text/csv;charset=utf-8');
      toast('Downloaded the displayed analysis rows.');return;
    }
    throw Error('Choose an available scenario-analysis action.');
  }
  return {render,mount,update,detach,dispatch,create,createForSourceAreas};
}
