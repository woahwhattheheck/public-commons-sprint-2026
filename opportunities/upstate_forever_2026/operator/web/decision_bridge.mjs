/* TokenJunkieLabs: retained native comparisons joined to saved decision views. */
import {mount as mountPanel} from './scenario_decisions.mjs';
import {prepareAssessment,uploadAssessment,operationId,submissionIdentity} from './decision_transfer.mjs';
import {createDecisionSubmissionJournal,sameSubmissionTask} from './decision_submission.mjs';
import {buildScenarioAnalysisSeed} from './scenario_handoff.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const short = value => String(value ?? '').slice(0, 12);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const positiveCount = value => Number.isInteger(value) && value > 0;
const METRICS = [
  {id:'nitrogen_export', label:'Nitrogen export', unit:'kg/year', nonnegative:true},
  {id:'phosphorus_export', label:'Phosphorus export', unit:'kg/year', nonnegative:true},
  {id:'sediment_export', label:'Sediment export', unit:'metric_tonnes/year', nonnegative:true}
];
const UNIT_ALIASES = {
  'kg/year':'kg/year', 'kg/yr':'kg/year',
  'metric_tonnes/year':'metric_tonnes/year', 'metric tonnes/year':'metric_tonnes/year',
  'tonnes/year':'metric_tonnes/year', 't/year':'metric_tonnes/year'
};
const annualUnit = artifact => UNIT_ALIASES[artifact?.sum_units] || artifact?.sum_units || '';
const changeUnit = artifact => {
  const value = artifact?.sum_units || artifact?.units || '';
  if (UNIT_ALIASES[value]) return UNIT_ALIASES[value];
  if (value === 'kg/pixel/year') return 'kg/year';
  if (value === 'metric_tonnes/pixel/year') return 'metric_tonnes/year';
  return value;
};
const titleFor = (rows, id) => {
  const row = (rows || []).find(item => item.id === id);
  return row?.title || row?.metadata?.title || row?.spec?.title || short(id);
};
function comparisonPairs(catalog, baseline) {
  const pairs = new Map();
  for (const comparison of catalog.comparisons || []) {
    if (comparison.baseline_run_id !== baseline ||
        comparison.direction !== 'alternative minus baseline') continue;
    for (const part of comparison.alternatives || []) {
      if (!pairs.has(part.run_id)) pairs.set(part.run_id, {comparison, part});
    }
  }
  return pairs;
}


const POLLUTANTS = {nitrogen_export:'nitrogen',phosphorus_export:'phosphorus',sediment_export:'sediment'};
export function objectiveDirections(objective) {
  const result={};
  for(const metric of METRICS){
    const value=objective?.directions?.[metric.id];
    let direction=value==='min'||value==='minimize'?'minimize':
      value==='max'||value==='maximize'?'maximize':'';
    if(objective?.basis==='baseline_minus_alternative'&&direction)
      direction=direction==='minimize'?'maximize':'minimize';
    result[metric.id]=direction;
  }
  return result;
}
function addWatershedSummaries(catalog, alternatives, baselineId) {
  const byRun=new Map(alternatives.map(row=>[row.id,row]));
  for(const saved of catalog.scoped_reports||[]){
    const report=saved.report;
    if(!report||report.grid_id!==saved.grid_id)continue;
    for(const zone of report.zones||[]){
      const scope='watershed-report:'+saved.id+':'+zone.id;
      for(const native of report.runs||[]){
        const run=byRun.get(native.id);
        if(!run||run.grid_id!==report.grid_id)continue;
        const metrics={},direct_changes={};
        for(const metric of METRICS){
          const pollutant=POLLUTANTS[metric.id],body=zone.pollutants?.[pollutant];
          const value=body?.runs?.[run.id],coverage=body?.coverage||{};
          const commonCells=coverage.common_valid_cells;
          const declaredUnit=report.outputs?.[pollutant]?.units||'';
          const unit=UNIT_ALIASES[declaredUnit]||declaredUnit;
          const available=positiveCount(commonCells)&&finite(value?.common_mass);
          metrics[metric.id]={
            value:available?value.common_mass:null,unit,status:available?'valid':'nodata',
            support_id:'retained-common-mask:'+saved.id+':'+zone.id+':'+pollutant,
            valid_cells:commonCells??null,valid_area_ha:coverage.common_valid_area_ha??null,
            selected_cells:coverage.selected_cells??null,
            source_path:saved.source_ref?.path||'',source_sha256:saved.source_ref?.sha256||'',
            report_id:saved.id,support_basis:'Producer common mask across every selected run in this retained report',
          };
          const change=body?.alternatives?.find(row=>row.run_id===run.id);
          if(report.baseline_run_id===baselineId&&finite(change?.change_mass)){
            direct_changes[metric.id]={
              value:change.change_mass,unit,direction:'alternative minus baseline',
              valid_cells:commonCells,baseline_run_id:baselineId,comparison_id:saved.id,
              source_path:saved.source_ref?.path,source_sha256:saved.source_ref?.sha256,
            };
          }
        }
        run.summaries.push({
          catchment_id:scope,scope_id:scope,domain_id:report.grid_id,
          period_id:'annual-model-grid:'+report.grid_id,
          label:(zone.title||zone.id)+' · '+(saved.title||short(saved.id)),
          report_id:saved.id,zone_source:zone.source,zone_scope:zone.scope,
          metrics,direct_changes,
        });
      }
    }
  }
}

export function buildDecisionInput(catalog, baselineId) {
  const baseline = (catalog.runs || []).find(run => run.id === baselineId);
  const pairs = comparisonPairs(catalog, baselineId);
  const alternatives = (catalog.runs || []).map(run => {
    const selected = run.selection || {}, gridId = selected.grid_id || '';
    const grid = (catalog.grids || []).find(row => row.id === gridId);
    const scope = 'reporting-mask:' + gridId;
    const sourcePair = pairs.get(run.id);
    const metrics = {}, direct_changes = {};
    for (const metric of METRICS) {
      const artifact = run.artifacts?.[metric.id];
      const baseArtifact = baseline?.artifacts?.[metric.id];
      const difference = sourcePair?.part.artifacts?.[metric.id];
      const unit = annualUnit(artifact);
      let support = artifact?.sha256 ?
        'native-mask:' + run.id + ':' + metric.id + ':' + artifact.sha256 : '';
      const baseSupport = baseArtifact?.sha256 ?
        'native-mask:' + baselineId + ':' + metric.id + ':' + baseArtifact.sha256 : '';
      const commonFullSupport = baseline && gridId === baseline.selection?.grid_id &&
        difference?.direction === 'alternative minus baseline' &&
        positiveCount(difference.valid_cells) &&
        difference.valid_cells === baseArtifact?.valid_cells &&
        difference.valid_cells === artifact?.valid_cells;
      if (run.id === baselineId || commonFullSupport) support = baseSupport;
      metrics[metric.id] = {
        value: artifact && positiveCount(artifact.valid_cells) && finite(artifact.sum) ? artifact.sum : null,
        unit, status: artifact && positiveCount(artifact.valid_cells) && finite(artifact.sum) ? 'valid' : 'nodata',
        support_id: support, valid_cells: artifact?.valid_cells ?? null,
        source_path: artifact?.path || null, source_sha256: artifact?.sha256 || null,
        native_units: artifact?.native_units || null,
        pixel_area_ha: artifact?.pixel_area_ha ?? grid?.pixel_area_ha ?? null,
        support_basis: run.id === baselineId ? 'selected baseline' :
          commonFullSupport ? 'native intersection count equals both complete valid-cell counts' :
          'individual retained artifact; common comparison support not established',
      };
      if (difference && finite(difference.sum_change)) {
        direct_changes[metric.id] = {
          value: difference.sum_change, unit: changeUnit(difference),
          direction:'alternative minus baseline', valid_cells:difference.valid_cells,
          baseline_run_id:baselineId, comparison_id:sourcePair.comparison.id,
          source_path:difference.path, source_sha256:difference.sha256,
        };
      }
    }
    return {
      id:run.id,
      label:titleFor(catalog.scenarios, selected.scenario_id) + ' · ' +
        titleFor(catalog.profiles, selected.profile_id),
      run_id:run.id, grid_id:gridId, profile_id:selected.profile_id,
      scenario_id:selected.scenario_id, invest_version:run.runtime?.version || '',
      declared_invest_version:selected.invest_version || '',
      domain_id:gridId, period_id:'annual-model-grid:' + gridId,
      profile_changed:!!baseline && selected.profile_id !== baseline.selection?.profile_id,
      stage_summary:run.stage_summary || {},
      summaries:[{
        catchment_id:scope, scope_id:scope, domain_id:gridId,
        period_id:'annual-model-grid:' + gridId,
        label:'Saved reporting area · ' + titleFor(catalog.grids, gridId),
        support_id:'', metrics, direct_changes,
      }],
    };
  });
  addWatershedSummaries(catalog,alternatives,baselineId);
  return {
    schema:'upstate.scenario-decision-input/v1',
    workspace_id:catalog.workspace_id,
    metrics:METRICS.map(row => ({...row})),
    alternatives,
    sources:catalog.methods?.sources || [],
  };
}


export function workspaceSourceSignature(state){
  const data=state?.data||{};
  const ordered=(rows,project)=>(Array.isArray(rows)?rows:[]).map(project).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  return JSON.stringify({
    runs:ordered((data.runs||[]).filter(row=>row.state==='complete'),row=>[row.id,row.state,row.completed_at||'']),
    comparisons:ordered(data.comparisons||[],row=>[row.id]),
    reports:ordered(data.scenario_reports||[],row=>[row.id,row.state||'',row.updated_at||row.created_at||'']),
    completed:ordered((state?.tasks||[]).filter(row=>row.state==='complete'&&
      ['run.start','run.compare','scenario.decision.build'].includes(row.action)),
      row=>[row.id,row.action,row.result?.id||'']),
  });
}

export function attachDecisionWorkbench({getState, api, endpoint, toast, openExtension}) {
  let root=null, frame=null, controller=null, snapshot=null, liveCatalog=null, workspaceKey=null;
  let selection=null, loadedView=null, previousViewId=null,generation=0,lastBaseline=null;
  let panelData=null, handoffMarkup='';
  let sourceStamp='',savedStamp='',backgroundRefresh=null,nextSourceRefresh=0;
  let pending=null, currentError='', currentMessage='', loading=false;
  let savedViews=[], objectiveId='',transferring=null;
  let taskRefresh=null,nextTaskRefresh=0,finishing=null;
  const dispatching=new Map();
  const submissions=createDecisionSubmissionJournal();
  const localKey = () => 'upstate-scenario-decisions:' + workspaceKey;
  const node = selector => frame?.querySelector(selector);
  const currentWorkspace = () => getState()?.workspace_key;
  const status = (message, error=false) => {
    if (error) {currentError=message;currentMessage='';}
    else {currentMessage=message;currentError='';}
    const target=node('[data-decision-status]');
    if (target) {
      target.textContent=message;
      target.setAttribute('role',error?'alert':'status');
      target.classList.toggle('decision-error',error);
    }
  };
  const remember = () => {
    if (!selection || !workspaceKey) return;
    try {
      let retained={};
      try{retained=JSON.parse(localStorage.getItem(localKey())||'null')||{};}catch(_){}
      localStorage.setItem(localKey(), JSON.stringify({
        selection, title:node('[name="decision-title"]')?.value ?? retained.title ?? '',
        purpose:node('[name="decision-purpose"]')?.value ?? retained.purpose ?? '',
        previous_view_id:previousViewId,
      }));
    } catch (_) {}
  };
  function initialState(catalog) {
    const comparison=(catalog.comparisons || [])[0];
    const base=(catalog.runs || []).find(run =>
      (catalog.scenarios || []).some(scenario =>
        scenario.id===run.selection?.scenario_id && scenario.kind==='baseline'));
    const baseline=comparison?.baseline_run_id || base?.id || '';
    const baseRun=(catalog.runs||[]).find(run=>run.id===baseline);
    const metricIds=METRICS.filter(metric=>baseRun?!!baseRun.artifacts?.[metric.id]:
      (catalog.runs||[]).some(run=>!!run.artifacts?.[metric.id])).map(metric=>metric.id);
    const other=(catalog.runs || []).filter(run => run.id!==baseline &&
      (!baseline || run.selection?.grid_id===(catalog.runs || []).find(x=>x.id===baseline)?.selection?.grid_id));
    return {
      baseline_id:baseline, alternative_ids:other.map(run=>run.id),
      metric_ids:metricIds, catchment_ids:[...new Set(other.concat((catalog.runs||[]).filter(run=>run.id===baseline)).map(run=>'reporting-mask:' + run.selection.grid_id))],
      objective_id:'',
      directions:{}, priority:{enabled:false,weights:{}},
      query:'',status_filter:'all',pinned_ids:[],only_pinned:false,
      sort_key:'alternative',sort_direction:'asc',
    };
  }
  function controls() {
    return '<header class="page-header"><div><p class="eyebrow">UPPER SAVANNAH SCIENTIFIC WORKBENCH</p>' +
      '<h1>Scenario decisions</h1><p>Assess retained model alternatives, inspect physical changes and save the cases and priorities used for a decision.</p></div></header>' +
      '<section class="section decision-record-controls"><h2>Original results and saved assessments</h2>' +
      '<div class="decision-control-grid">' +
      '<label><span>Saved assessment</span><select name="saved-decision"><option value="">Current workspace results</option></select></label>' +
      '<label><span>Native comparison</span><select name="native-comparison"><option value="">Choose retained operands</option></select></label>' +
      '<label><span>Watershed report</span><select name="watershed-report"><option value="">Choose saved common-mask geography</option></select></label>' +
      '<label><span>Decision objective</span><select name="decision-objective"><option value="">Set directions directly</option></select></label>' +
      '<label><span>Assessment title</span><input name="decision-title" type="text" placeholder="Name this assessment"></label>' +
      '<label><span>Decision purpose</span><input name="decision-purpose" type="text" placeholder="What will this comparison inform?"></label>' +
      '</div><div class="decision-toolbar">' +
      '<button type="button" data-decision-action="save">Save assessment</button>' +
      '<button type="button" data-decision-action="refresh">Refresh original results</button>' +
      '<button type="button" data-decision-action="compare">Build native paired comparison</button>' +
      '<button type="button" data-decision-action="retry" hidden>Resume interrupted task</button>' +
      '</div><p data-decision-status role="status" aria-live="polite">Opening retained native results…</p>' +
      '<p data-decision-objective-description class="note"></p>' +
      '<p data-decision-origin class="note"></p></section>' +
      '<div data-decision-panel></div>' +
      '<section class="section decision-continuation" aria-labelledby="decision-analysis-title">' +
      '<h2 id="decision-analysis-title">Continue with fixed-scale analysis</h2>' +
      '<p>Carry the selected native runs into Scenario analysis. Choose its fixed baseline scales, planning weights and retained geographic areas in the analysis form.</p>' +
      '<div data-decision-handoff></div>' +
      '<button type="button" data-decision-action="analysis" data-decision-primary-analysis disabled>Continue in Scenario analysis</button></section>' +
      '<details class="section decision-interpretation"><summary>Method and original source choices</summary><div data-decision-methods></div></details>';
  }
  function choiceCatalog(){
    if(!liveCatalog)return snapshot;
    if(!snapshot||!loadedView)return liveCatalog;
    const union=key=>[...new Map([...(snapshot[key]||[]),...(liveCatalog[key]||[])].map(row=>[row.id,row])).values()];
    return {...liveCatalog,scoped_reports:union('scoped_reports'),comparisons:union('comparisons'),runs:union('runs')};
  }
  function optionLists() {
    const saved=node('[name="saved-decision"]'), native=node('[name="native-comparison"]');
    const geographic=node('[name="watershed-report"]'),objectives=node('[name="decision-objective"]');
    const available=choiceCatalog(),geographicValue=geographic?.value,nativeValue=native?.value;
    if(geographic)geographic.innerHTML='<option value="">Choose saved common-mask geography</option>'+
      (available?.scoped_reports||[]).map(row=>'<option value="'+escape(row.id)+'">'+
        escape((row.title||short(row.id))+' · '+row.report.zones.length+' zones')+'</option>').join('');
    if(objectives){
      objectives.innerHTML='<option value="">Set directions directly</option>'+
        (snapshot?.methods?.objectives||[]).map(row=>'<option value="'+escape(row.id)+'">'+escape(row.label)+'</option>').join('');
      objectives.value=objectiveId;
    }
    showObjective();
    if (saved) saved.innerHTML='<option value="">Current workspace results</option>' +
      savedViews.map(view=>'<option value="'+escape(view.id)+'"'+
        (loadedView?.id===view.id?' selected':'')+'>'+escape(view.title)+'</option>').join('');
    if (native) native.innerHTML='<option value="">Choose retained operands</option>' +
      (available?.comparisons || []).map(comparison=>'<option value="'+escape(comparison.id)+'">'+
        escape(short(comparison.baseline_run_id)+' · '+comparison.alternatives.length+' alternatives · '+short(comparison.id))+'</option>').join('');
    if(geographic&&geographicValue)geographic.value=geographicValue;
    if(native&&nativeValue)native.value=nativeValue;
  }
  function showObjective(){
    const objective=snapshot?.methods?.objectives?.find(row=>row.id===objectiveId);
    const description=node('[data-decision-objective-description]');
    if(description)description.textContent=objective?
      objective.description+' Ranking uses equivalent annual-mass directions with the selected shared baseline. The table preserves the signed changes.':
      'Choose an objective or set each metric direction explicitly in the table.';
  }
  function currentSelection(){
    return {...controller.getState(),objective_id:objectiveId};
  }
  function retainSelection(next){
    const objective=snapshot?.methods?.objectives?.find(row=>row.id===objectiveId);
    if(objective){
      const expected=objectiveDirections(objective);
      if(next.metric_ids.some(id=>next.directions[id]!==expected[id])){
        objectiveId='';
        const field=node('[name="decision-objective"]');if(field)field.value='';
        showObjective();
      }
    }
    selection={...next,objective_id:objectiveId};remember();showHandoff();
  }
  function currentHandoff() {
    const current=getState();
    return buildScenarioAnalysisSeed({
      data:panelData,selection,
      nativeRuns:Array.isArray(current?.data?.runs)?current.data.runs:(liveCatalog?.runs||[]),
      workspaceKey:current?.workspace_key,
      title:node('[name="decision-title"]')?.value?.trim() || 'Selected watershed scenarios',
    });
  }
  function showHandoff() {
    const target=node('[data-decision-handoff]'),button=node('[data-decision-primary-analysis]');
    if(!target||!button)return;
    const handoff=currentHandoff();
    const available=typeof openExtension==='function';
    button.disabled=!available||!handoff.ready;
    const issues=[...handoff.baseline_issues,...(handoff.cohort_issues||[])];
    if(!available)issues.unshift('Open this assessment in the current integrated operator to continue.');
    let content='<p>'+escape(handoff.accepted_run_count+' native alternative'+(handoff.accepted_run_count===1?'':'s')+
      ' available from '+handoff.selected_case_count+' selected case'+(handoff.selected_case_count===1?'':'s')+'.')+'</p>';
    if(handoff.target_metric_ids?.length)content+='<p class="note">Available analysis outputs: '+
      escape(handoff.target_metric_ids.map(id=>METRICS.find(metric=>metric.id===id)?.label||id).join(', '))+'.</p>';
    if(issues.length)content+='<ul>'+issues.map(issue=>'<li>'+escape(issue)+'</li>').join('')+'</ul>';
    if(handoff.rejected_cases.length)content+='<details><summary>'+
      escape(handoff.rejected_cases.length+' selected case'+(handoff.rejected_cases.length===1?' is':'s are')+' unavailable for this analysis')+
      '</summary><ul>'+handoff.rejected_cases.map(item=>'<li>'+escape(item.label)+': '+
        escape(item.reasons.join(' '))+'</li>').join('')+'</ul></details>';
    if(handoff.ready&&!handoff.selected_case_count)content+='<p>The analysis will use the selected native baseline.</p>';
    if(handoff.compatible_cohorts?.length)content+='<div class="actions">'+handoff.compatible_cohorts.map(cohort=>
      '<button type="button" data-decision-action="analysis" data-decision-cohort="'+escape(cohort.id)+'">'+
      escape('Open '+cohort.title+' · '+cohort.alternative_count+' alternative'+(cohort.alternative_count===1?'':'s'))+
      '</button>').join('')+'</div>';
    if(content!==handoffMarkup){target.innerHTML=content;handoffMarkup=content;}
    return handoff;
  }
  function showMethods() {
    const target=node('[data-decision-methods]');if(!target||!snapshot)return;
    const explanations=[
      'Annual masses come directly from saved reporting artifacts. The original per-cell units, model version, source profile and run identity remain attached.',
      'A signed native change is alternative minus baseline. A negative change means lower modeled export over the stated valid-cell support.',
      'Percentage changes and candidate ranking use comparable operands. Native intersection changes remain visible when whole-domain totals have different support.',
      'Changing coefficients as well as land cover changes the interpretation of the comparison; the selected parameter profile remains visible.',
      'Directions and weights are explicit assessment choices. Weighted scores use min/max ranges across the common eligible alternatives for each geography. Saved assessments retain that cohort and those ranges.',
      'Each retained watershed report uses one common mask across its original run cohort for each pollutant. Selecting fewer cases retains that geographic support; selecting another report changes its stated coverage.',
    ];
    let content=explanations.map(text=>'<p>'+escape(text)+'</p>').join('');
    for(const issue of snapshot.scoped_report_issues||[])content+='<p class="decision-error">'+escape(issue.source+': '+issue.error)+'</p>';
    const sources=snapshot.methods?.sources || [];
    const list=Array.isArray(sources)?sources:Object.values(sources);
    for(const source of list){
      const url=typeof source==='string'?source:(source.url||source.uri||source.href||'');
      const label=typeof source==='string'?source:(source.title||source.label||source.id||url);
      if(/^https?:\/\//i.test(url))content+='<p><a target="_blank" rel="noopener noreferrer" href="'+escape(url)+'">'+escape(label)+'</a></p>';
    }
    target.innerHTML=content;
  }
  function mountValues() {
    if (!snapshot || !node('[data-decision-panel]'))return;
    const data=buildDecisionInput(snapshot,selection?.baseline_id);panelData=data;
    controller?.destroy?.();
    lastBaseline=selection?.baseline_id;objectiveId=selection?.objective_id||'';
    controller=mountPanel(node('[data-decision-panel]'),data,{
      initialState:selection,
      notifyAssessment:false,
      onChange(next) {
        retainSelection(next);
        if (next.baseline_id!==lastBaseline) {
          lastBaseline=next.baseline_id;
          panelData=buildDecisionInput(snapshot,next.baseline_id);
          controller?.setData?.(panelData);
        }
      },
    });
    selection=currentSelection();
    optionLists();showMethods();showHandoff();
    node('[data-decision-origin]').textContent=loadedView ?
      'Saved assessment '+short(loadedView.id)+' · original source snapshot '+short(loadedView.source_snapshot_sha256)+
      '. Editing creates a new saved revision; the original remains available.' :
      'Current retained workspace results. Select a baseline and the cases, geography and metrics to assess.';
  }
  async function loadCurrent({keepSelection=true}={}) {
    const ticket=++generation,requested=workspaceKey,stamp=workspaceSourceSignature(getState());
    loading=true;status('Reading original run and comparison metadata…');
    try {
      const result=await api(endpoint('/api/decisions/catalog'));
      if(ticket!==generation||workspaceKey!==requested||!root)return;
      snapshot=result;liveCatalog=result;sourceStamp=stamp;savedViews=result.saved_views||[];loadedView=null;
      if(!keepSelection)previousViewId=null;
      if(!selection||!keepSelection)selection=initialState(result);
      mountValues();status(result.runs.length+' completed native runs available. Choose the assessment scope and directions.');
      return true;
    } catch(error) {if(ticket===generation)status(error.message||String(error),true);return false;}
    finally {if(ticket===generation)loading=false;}
  }
  async function openView(id) {
    if(!id)return loadCurrent({keepSelection:false});
    const ticket=++generation, requested=workspaceKey;loading=true;
    status('Opening the saved assessment and its original operands…');
    try {
      const row=await api(endpoint('/api/decisions/view',{view_id:id}));
      if(ticket!==generation||workspaceKey!==requested||!root)return;
      loadedView=row;previousViewId=row.id;snapshot=row.source_snapshot;selection=row.selection;
      node('[name="decision-title"]').value=row.title||'';
      node('[name="decision-purpose"]').value=row.purpose||'';
      mountValues();remember();status('Saved assessment reopened with its original run references and decision settings.');
      return true;
    }catch(error){if(ticket===generation)status(error.message||String(error),true);return false;}
    finally{if(ticket===generation)loading=false;}
  }
  const pendingEntry = workspace => submissions.entries(workspace)[0] || null;
  function currentDraft(){
    return {title:node('[name="decision-title"]')?.value.trim()||'',
      purpose:node('[name="decision-purpose"]')?.value.trim()||'',
      selection:controller?currentSelection():selection,
      ...(previousViewId?{previous_view_id:previousViewId}:{}),};
  }
  const selectedStill = workspace => workspaceKey===workspace&&currentWorkspace()===workspace;
  function receiveTask(entry,task,options={}){
    if(submissions.isAcknowledged(entry))return null;
    const retained=submissions.accepted(entry,task,options).entry;
    if(selectedStill(entry.workspace)){
      pending={...retained,...task,workspace:entry.workspace,action:entry.action,
        operation_id:entry.operation_id,payload_sha256:entry.payload_sha256};
    }
    return retained;
  }
  async function confirmTask(entry,task){
    const expected=entry.native_operation_id||entry.operation_id;
    let canonical=false;
    if(task?.operation_id&&task.operation_id!==expected){
      if(task.workspace!==entry.workspace||task.action!==entry.action||!task.payload||
         await submissionIdentity(task.action,task.payload)!==entry.payload_sha256)
        throw Error('The operator returned a task for different Decisions operands.');
      // The original queue reuses an already-active identical request. Bind
      // its actual native operation and task identities after comparing the
      // complete returned payload, including the original assessment.
      canonical=true;
    }
    return receiveTask(entry,task,{canonical});
  }
  function currentTask(entry,state=getState()){
    if(!entry||state?.workspace_key!==entry.workspace)return null;
    return (state.tasks||[]).find(task=>sameSubmissionTask(task,entry))||null;
  }
  async function reconcileSubmission(entry){
    const visible=currentTask(entry);
    if(visible){receiveTask(entry,visible);return visible;}
    const workspace=entry.workspace;
    if(entry.id){
      const task=await api(endpoint('/api/task',{workspace,id:entry.id}));
      await confirmTask(entry,task);return task;
    }
    const state=await api(endpoint('/api/state',{workspace}));
    const task=currentTask(entry,{...state,workspace_key:state.workspace_key||workspace});
    if(task){receiveTask(entry,task);return task;}
    if(['complete','failed','cancelled','interrupted'].includes(entry.state))return null;
    const original=await submissions.original(entry);
    if(!original||!selectedStill(workspace))return null;
    // The original API reconciles operation_id and its complete request before
    // queue admission. This is the retained request, including its exact
    // assessment transfer reference, without rebuilding the calculation.
    const replay=await api('/api/actions',{method:'POST',body:original});
    await confirmTask(entry,replay);
    return replay;
  }
  async function submit(action,payload,draft=currentDraft()) {
    const requested=workspaceKey;
    if(dispatching.has(requested)||
       (pending&&['queued','running'].includes(pending.state))){
      status('The current workspace task is still running. Its progress remains visible.');return;
    }
    const dispatch={workspace:requested};
    dispatching.set(requested,dispatch);
    try{
      const draft_sha256=await submissionIdentity('decision.draft',draft);
      const prepared=await submissions.prepare(requested,action,payload,{draft_sha256});
      let entry=prepared.entry;
      if(!selectedStill(requested)){
        if(!prepared.reused&&entry.state==='prepared')submissions.acknowledge(entry);
        throw Error('Reopen the original workspace to continue its retained operation.');
      }
      if(prepared.reused&&entry.state==='complete'&&entry.result_id){
        pending=entry;observe();return entry;
      }
      if(prepared.reused){
        status('Reconciling the original workspace operation…');
        const task=await reconcileSubmission(entry);
        if(task){if(selectedStill(requested))observe();return task;}
        if(!selectedStill(requested))return;
      }
      entry=submissions.update(entry,{state:'submitting'}).entry;
      pending=entry;
      status(prepared.durable?
        (prepared.reused?'Continuing the original workspace operation…':'Submitting the original workspace operation…'):
        'Browser continuation storage is unavailable. Keep this page open until the original task appears.');
      try{
        const result=await api('/api/actions',{method:'POST',body:{
          workspace:requested,action,payload,operation_id:entry.operation_id,
        }});
        await confirmTask(entry,result);
        if(selectedStill(requested)){
          status(action==='decision.view.save'?'Saving the assessment in the scientific workspace…':
            'The native comparison is queued. Existing completed differences are reused.');
          observe();
        }
        return result;
      }catch(error){
        if(submissions.isAcknowledged(entry))return;
        const retained=submissions.update(entry,{state:'uncertain'}).entry;
        const message='The original submission is retained. Reconnecting will find its task; repeat the same choice to continue it. '+(error.message||String(error));
        if(selectedStill(requested)){pending=retained;status(message,true);}
        throw Error(message);
      }
    }finally{
      if(dispatching.get(requested)===dispatch)dispatching.delete(requested);
    }
  }
  async function act(action,cohortId='') {
    if(transferring?.workspace===workspaceKey&&['save','compare','refresh'].includes(action)){
      status('The original assessment transfer is in progress. Its retained parts will be reused after an interruption.');return;
    }
    if(action==='refresh')return loadCurrent({keepSelection:true});
    if(action==='retry'&&pending?.id) {
      const entry=pending;
      const task=await api('/api/task/resume',{method:'POST',body:{id:entry.id}});
      await confirmTask(entry,task);
      if(selectedStill(entry.workspace)){
        if(node('[data-decision-action="retry"]'))node('[data-decision-action="retry"]').hidden=true;
        status('The original task is queued for continuation.');observe();
      }
      return;
    }
    if(!controller||loading)throw Error('Wait for the original operands to open.');
    selection=currentSelection();remember();
    if(action==='analysis') {
      const handoff=showHandoff()||currentHandoff();
      if(typeof openExtension!=='function')throw Error('Open this assessment in the current integrated operator to continue.');
      const cohort=cohortId?(handoff.compatible_cohorts||[]).find(item=>item.id===cohortId):null;
      if(cohortId&&!cohort)throw Error('The native selection changed. Choose an available analysis group.');
      if(!cohort&&!handoff.ready)throw Error(handoff.baseline_issues[0]||handoff.cohort_issues?.[0]||'Choose a compatible native cohort in the comparison.');
      return await openExtension('scenario-analysis','create',cohort?.request||handoff.request);
    }
    if(action==='save') {
      const title=node('[name="decision-title"]').value.trim();
      if(!title)throw Error('Give this assessment a title before saving.');
      const selectedWorkspace=workspaceKey;
      const original={
        title,purpose:node('[name="decision-purpose"]').value.trim(),
        selection:JSON.parse(JSON.stringify(selection)),
        ...(previousViewId?{previous_view_id:previousViewId}:{}),
      };
      const assessment=controller.getComparison();
      const url=endpoint('/api/decisions/assessment/upload');
      const transfer={workspace:selectedWorkspace,id:operationId()};
      transferring=transfer;
      const progress=message=>{if(transferring===transfer)status(message);};
      try{
        const prepared=await prepareAssessment(assessment,{progress});
        const transmitted=await uploadAssessment(prepared,{
          api,url,workspace:selectedWorkspace,progress,
          isCurrent:()=>transferring===transfer&&workspaceKey===selectedWorkspace&&currentWorkspace()===selectedWorkspace,
        });
        if(workspaceKey!==selectedWorkspace||currentWorkspace()!==selectedWorkspace)
          throw Error('Reopen the original workspace to save its retained assessment.');
        return await submit('decision.view.save',{...original,...transmitted},original);
      }finally{if(transferring===transfer)transferring=null;}
    }
    if(action==='compare'){
      const ids=[selection.baseline_id,...selection.alternative_ids].filter(Boolean);
      if(ids.length<2)throw Error('Select a baseline and at least one alternative.');
      const rows=ids.map(id=>snapshot.runs.find(run=>run.id===id));
      if(rows.some(row=>!row))throw Error('Refresh original results to select the retained runs.');
      const grid=rows[0].selection.grid_id;
      if(rows.some(row=>row.selection.grid_id!==grid))throw Error('Choose alternatives on the baseline’s retained model grid.');
      return submit('run.compare',{run_ids:ids});
    }
  }
  function refreshExternalSources(){
    if(!root||loading||backgroundRefresh||transferring?.workspace===workspaceKey||Date.now()<nextSourceRefresh)return;
    const stamp=workspaceSourceSignature(getState());
    if(stamp===sourceStamp)return;
    const request={workspace:workspaceKey,generation,stamp};
    backgroundRefresh=request;
    Promise.resolve(api(endpoint('/api/decisions/catalog'))).then(result=>{
      if(backgroundRefresh!==request||request.workspace!==workspaceKey||request.generation!==generation||!root)return;
      liveCatalog=result;sourceStamp=stamp;nextSourceRefresh=0;savedViews=result.saved_views||savedViews;
      if(loadedView){
        optionLists();showHandoff();
        status('New workspace results are available in the report and comparison selectors.');
      }else{
        const retained=controller?currentSelection():selection;
        snapshot=result;
        panelData=buildDecisionInput(snapshot,retained?.baseline_id);
        controller?.setData(panelData);
        if(controller&&retained)controller.setState(retained);
        optionLists();showMethods();showHandoff();
        status('The completed native results and watershed reports have refreshed. The current decision settings are retained.');
      }
    }).catch(error=>{
      nextSourceRefresh=Date.now()+5000;
      if(backgroundRefresh===request&&request.workspace===workspaceKey&&request.generation===generation)
        status('Refreshing workspace results: '+(error.message||String(error)),true);
    }).finally(()=>{if(backgroundRefresh===request)backgroundRefresh=null;});
  }
  function refreshPendingTask(entry){
    if(taskRefresh||Date.now()<nextTaskRefresh)return;
    const request={workspace:entry.workspace,operation_id:entry.operation_id};
    taskRefresh=request;nextTaskRefresh=Date.now()+5000;
    Promise.resolve(reconcileSubmission(entry)).then(task=>{
      if(task&&selectedStill(request.workspace)&&root)observe();
      else if(selectedStill(request.workspace)&&root&&pending?.operation_id===request.operation_id&&
              ['prepared','submitting','uncertain'].includes(pending.state))
        status('The original submission identity is retained. Repeat the same Save or comparison choice to reconcile it through the original queue.');
    }).catch(error=>{
      if(selectedStill(request.workspace)&&root&&pending?.operation_id===request.operation_id)
        status('Reconnecting to the original task: '+(error.message||String(error)),true);
    }).finally(()=>{if(taskRefresh===request)taskRefresh=null;});
  }
  function finishSubmission(entry){
    if(finishing||loading||!root)return;
    const request={workspace:entry.workspace,operation_id:entry.operation_id};
    finishing=request;
    Promise.resolve().then(async()=>{
      const current=await submissionIdentity('decision.draft',currentDraft());
      if(!selectedStill(request.workspace)||!root)return false;
      if(entry.draft_sha256&&entry.draft_sha256!==current){
        remember();
        if(entry.action==='decision.view.save'){
          status('The original assessment is saved. Your current draft is retained. Open its result from saved assessments.');
          optionLists();
        }else status('The original native comparison is complete. Your current decision draft is retained.');
        return true;
      }
      if(entry.action==='decision.view.save'&&entry.result_id){
        const opened=await openView(entry.result_id);
        if(opened&&selectedStill(request.workspace))toast('Scenario assessment saved.');
        return opened===true;
      }
      return await loadCurrent({keepSelection:true})===true;
    }).then(handled=>{
      if(handled&&selectedStill(request.workspace)){
        submissions.acknowledge(entry);
        if(pending?.operation_id===entry.operation_id)pending=pendingEntry(request.workspace);
        if(node('[data-decision-action="retry"]'))node('[data-decision-action="retry"]').hidden=true;
      }
    }).catch(error=>{
      if(selectedStill(request.workspace)&&root)status(error.message||String(error),true);
    }).finally(()=>{
      if(finishing===request)finishing=null;
      if(selectedStill(request.workspace)&&root&&pending&&pending.operation_id!==entry.operation_id)observe();
    });
  }
  function observe() {
    if(!root||workspaceKey!==currentWorkspace())return;
    savedViews=getState()?.data?.decision_views||savedViews;
    const changedSaved=JSON.stringify(savedViews.map(row=>row.id));
    if(changedSaved!==savedStamp){savedStamp=changedSaved;if(frame)optionLists();}
    if(!pending)pending=pendingEntry(workspaceKey);
    if(!pending){showHandoff();refreshExternalSources();return;}
    const task=currentTask(pending);
    if(task)receiveTask(pending,task);
    if(pending.state==='complete'){
      finishSubmission(pending);return;
    }
    if(task?.state==='failed'||pending.state==='failed'||pending.state==='interrupted'){
      status(task?.error?.message||'The original workspace task needs continuation; its draft and task identity are retained.',true);
      if(node('[data-decision-action="retry"]'))node('[data-decision-action="retry"]').hidden=!pending.id;
    }else if(pending.state==='cancelled'){
      status('The original workspace operation was cancelled. Its task and current draft remain available.');
    }else if(['queued','running'].includes(pending.state)){
      status('Workspace operation: '+pending.state+'. Its original task and progress are retained.');
    }
    if(!task)refreshPendingTask(pending);
  }
  function mount(container) {
    const nextWorkspace=currentWorkspace();
    if(root===container && frame?.isConnected && workspaceKey===nextWorkspace){
      observe();return;
    }
    const changingWorkspace=workspaceKey!==nextWorkspace;
    detach();
    if(changingWorkspace){panelData=null;pending=null;snapshot=null;liveCatalog=null;loadedView=null;previousViewId=null;savedViews=[];transferring=null;sourceStamp='';savedStamp='';backgroundRefresh=null;nextSourceRefresh=0;}
    taskRefresh=null;nextTaskRefresh=0;finishing=null;
    pending=pendingEntry(nextWorkspace);
    root=container;workspaceKey=nextWorkspace;
    frame=document.createElement('div');frame.className='decision-workbench';frame.innerHTML=controls();handoffMarkup='';
    container.replaceChildren(frame);
    let draft;
    try{draft=JSON.parse(localStorage.getItem(localKey())||'null');}catch(_){}
    selection=draft?.selection||null;previousViewId=draft?.previous_view_id||null;
    node('[name="decision-title"]').value=draft?.title||'';
    node('[name="decision-purpose"]').value=draft?.purpose||'';
    frame.addEventListener('click',event=>{
      const button=event.target.closest('[data-decision-action]');
      if(!button)return;event.preventDefault();event.stopPropagation();
      button.disabled=true;
      const actionWorkspace=workspaceKey;
      Promise.resolve(act(button.dataset.decisionAction,button.dataset.decisionCohort||'')).catch(error=>{
        if(workspaceKey===actionWorkspace)status(error.message||String(error),true);
      })
        .finally(()=>{button.disabled=false;if(button.dataset.decisionAction==='analysis')showHandoff();});
    });
    frame.addEventListener('change',event=>{
      if(event.target.name==='saved-decision')openView(event.target.value);
      if(event.target.name==='native-comparison'){
        const available=choiceCatalog();
        const compare=available?.comparisons?.find(row=>row.id===event.target.value);
        if(compare){snapshot=available;selection={...(selection||{}),baseline_id:compare.baseline_run_id,
          alternative_ids:compare.alternatives.map(row=>row.run_id),
          metric_ids:METRICS.filter(metric=>snapshot.runs.find(run=>run.id===compare.baseline_run_id)?.artifacts?.[metric.id]).map(metric=>metric.id),catchment_ids:['reporting-mask:' + snapshot.runs.find(run=>run.id===compare.baseline_run_id).selection.grid_id]};loadedView=null;mountValues();remember();}
      }
      if(event.target.name==='decision-objective'&&controller){
        objectiveId=event.target.value;
        const objective=snapshot?.methods?.objectives?.find(row=>row.id===objectiveId);
        if(objective)controller?.setState({directions:objectiveDirections(objective)});
        selection=currentSelection();showObjective();remember();
      }
      if(event.target.name==='watershed-report'){
        const available=choiceCatalog();
        const saved=available?.scoped_reports?.find(row=>row.id===event.target.value);
        if(saved){
          snapshot=available;
          const ids=(saved.report.runs||[]).map(row=>row.id).filter(id=>snapshot.runs.some(run=>run.id===id));
          selection={...(selection||{}),baseline_id:saved.baseline_run_id,
            alternative_ids:ids.filter(id=>id!==saved.baseline_run_id),
            metric_ids:METRICS.filter(metric=>saved.report.outputs?.[POLLUTANTS[metric.id]]).map(metric=>metric.id),
            catchment_ids:saved.report.zones.map(zone=>'watershed-report:'+saved.id+':'+zone.id)};
          loadedView=null;mountValues();remember();
          node('[name="watershed-report"]').value=saved.id;
          status('Opened the retained watershed report with its original common-mask cohort.');
        }
      }
      remember();
    });
    frame.addEventListener('input',event=>{
      if(event.target.name==='decision-title'||event.target.name==='decision-purpose')remember();
    });
    Promise.resolve(loadCurrent({keepSelection:true})).then(()=>{if(root&&selectedStill(nextWorkspace))observe();});
  }
  function detach() {
    remember();generation++;controller?.destroy?.();controller=null;
    root=null;frame=null;loading=false;backgroundRefresh=null;taskRefresh=null;finishing=null;
  }
  return {mount,detach,update:observe};
}
