/** Ordinary operator views of the original retained scenario-footprint records. */
export function createScenarioInputReview({getState,esc,number,button,table,short,when,runTitle,nativeModels}){
 const data=()=>getState()?.data||{};
 const runs=()=>data().runs||[];
 const key=selection=>JSON.stringify([selection?.grid_id,selection?.profile_id,selection?.scenario_id,nativeModels(selection||{}).slice().sort()]);
 const records=()=>Array.isArray(data().scenario_footprints?.records)?data().scenario_footprints.records:[];
 const selectedRun=id=>runs().find(row=>row.id===id);
 function record(run){
  if(!run?.id)return null;
  return records().filter(row=>row.run_id===run.id&&key(row.selection)===key(run.selection))
   .sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))||String(a.id).localeCompare(String(b.id)))[0]||null;
 }
 function known(row){
  const s=row?.summary;
  return !!s&&['unique_eligible_cells','net_changed_cells'].every(k=>Number.isSafeInteger(s[k])&&s[k]>=0)&&
   ['eligible_hectares','net_changed_hectares'].every(k=>typeof s[k]==='number'&&Number.isFinite(s[k])&&s[k]>=0);
 }
 function status(run,row=record(run)){
  if(!row)return 'No retained footprint';
  return known(row)?row.summary.net_changed_cells===0?'No final land-cover change in preview':'Retained input changes':'Earlier footprint: counts unavailable';
 }
 function amount(row,cells,area){
  if(!known(row))return '—';
  return number(row.summary[cells])+' cells<br><small>'+number(row.summary[area])+' ha</small>';
 }
 function actions(run,{build=true}={}){
  if(!run?.id)return '';
  const id='data-id="'+esc(run.id)+'"';
  return (build?button('run-input-preview',record(run)?'Rebuild input preview':'Build input preview',id,'small'):'')+
   button('run-input-footprint','Open footprint, masks and coefficients',id,'small');
 }
 function compact(run){
  const row=record(run);
  return '<strong>'+esc(status(run,row))+'</strong>'+
   (known(row)?'<small>'+number(row.summary.net_changed_cells)+' changed cells · '+number(row.summary.net_changed_hectares)+' ha</small><small>'+number(row.summary.unique_eligible_cells)+' eligible cells · '+number(row.summary.eligible_hectares)+' ha</small>':'');
 }
 function runPanel(run,{controls=true}={}){
  const row=record(run),scenario=(data().scenarios||[]).find(x=>x.id===run?.selection?.scenario_id);
  let html='<section class="section-body"><h3>Scenario inputs on the selected native grid</h3>';
  if(!run?.id)html+='<p class="note">Prepare this grid, profile, scenario and model selection to retain its run identity. An input preview can then count its actual cells before starting the native models.</p>';
  else if(!row)html+='<p class="note">'+(scenario?.kind==='baseline'?'This selection uses the unchanged source baseline. ':'')+'No footprint has been retained for this exact run selection. Eligible and changed cell counts are not yet available. Build the input preview to inspect the original masks, source codes and coefficient rows.</p>';
  else if(!known(row))html+='<p class="note">This earlier footprint does not retain complete unique eligible and final-change accounting. Open its original report or rebuild the preview with the current compiler.</p>';
  if(known(row)){
   html+=table(['Input accounting','Native cells','Hectares'],[
    '<tr><td>Unique eligible cells</td><td>'+number(row.summary.unique_eligible_cells)+'</td><td>'+number(row.summary.eligible_hectares)+'</td></tr>',
    '<tr><td>Final changes from retained source land cover</td><td>'+number(row.summary.net_changed_cells)+'</td><td>'+number(row.summary.net_changed_hectares)+'</td></tr>'
   ]);
   if(row.summary.net_changed_cells===0)html+='<p class="note">The previewed final categorical land-cover values equal the retained source grid. Review the patch notes and profile selection when interpreting native reuse or output differences.</p>';
   html+='<p class="note">Counts use the retained grid and ordered patch rules. A patch can match cells already carrying its destination code, overlap an earlier patch or restore a cell to its baseline value. Patch counts are not added to obtain the final changed area.</p>';
  }
  if(row){
   if(Array.isArray(row.notes)&&row.notes.length)html+='<ul>'+row.notes.map(note=>'<li>'+esc(note)+'</li>').join('')+'</ul>';
   html+='<p class="note">Retained input preview '+esc(short(row.id))+' · '+esc(when(row.created_at))+(row.compiler_version?' · compiler '+esc(row.compiler_version):'')+'. This compiler evaluates the retained selection; an older completed run retains its own executed artifacts. Areas describe model input changes; the native engines calculate annual exports.</p>';
  }
  if(controls&&run?.id)html+='<div class="page-actions">'+actions(run)+'</div>';
  return html+'</section>';
 }
 function comparisonPanel(comparison){
  const rows=[{role:'Baseline',id:comparison.baseline_run_id},...(comparison.alternatives||[]).map(row=>({role:'Alternative',id:row.run_id}))];
  return '<section class="section-body"><h3>Input changes in the compared selections</h3><p class="note">Each footprint is measured against its own retained source land-cover grid. These areas are not a pairwise difference between two edited scenarios. Profile changes and signed native export differences remain separate below.</p>'+
   table(['Compared selection','Eligible cells / area','Final changed cells / area','Retained input review'],rows.map(({role,id})=>{
    const run=selectedRun(id),row=record(run);
    return '<tr><td>'+esc(role)+' · '+esc(runTitle(id))+'</td><td>'+amount(row,'unique_eligible_cells','eligible_hectares')+'</td><td>'+amount(row,'net_changed_cells','net_changed_hectares')+'</td><td>'+esc(status(run,row))+(run?'<div class="page-actions">'+actions(run)+'</div>':'')+'</td></tr>';
   }))+'</section>';
 }
 function scenarioPanel(scenario){
  const selected=runs().filter(run=>run.selection.scenario_id===scenario.id);
  return '<section class="section-body"><h3>Grid-specific input previews</h3><p class="note">A scenario stores the original mask and code choices. Its actual eligible and changed cells depend on the selected native grid and ordered changes.</p>'+
   (selected.length?table(['Retained run','Grid / profile','Input changes',''],selected.map(run=>'<tr><td>'+esc(runTitle(run.id))+'<br><small>'+esc(run.state)+'</small></td><td>'+esc(short(run.selection.grid_id))+' / '+esc(short(run.selection.profile_id))+'</td><td>'+compact(run)+'</td><td>'+actions(run)+'</td></tr>')):'<p class="note">Prepare a run selection for this scenario to compile its input footprint.</p>')+
   '<div class="page-actions">'+button('scenario-prepare-run','Prepare run with this scenario','data-id="'+esc(scenario.id)+'"')+'</div></section>';
 }
 function selectionPanel(selection){
  const run=runs().find(row=>key(row.selection)===key(selection));
  return runPanel(run||{selection},{controls:false});
 }
 function taskActions(task){
  if(task.action!=='scenario.footprint.preview'||task.state!=='complete'||!task.result?.run_id)return '';
  return '<div class="page-actions">'+button('run-input-footprint','Open retained input footprint','data-id="'+esc(task.result.run_id)+'"')+
   button('item','Review native run','data-kind="runs" data-id="'+esc(task.result.run_id)+'"')+'</div>';
 }
 function stamp(runId){return record(selectedRun(runId))?.id||'';}
 const revision=()=>records().map(row=>row.id).sort().join(':');
 return {record,known,status,compact,runPanel,comparisonPanel,scenarioPanel,selectionPanel,taskActions,stamp,revision};
}
