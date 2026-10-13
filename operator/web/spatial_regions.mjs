import {cohortMarkup,createCohortAnalysis} from './spatial_cohorts.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=value=>value==null?value:JSON.parse(JSON.stringify(value));
const number=value=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString(undefined,{maximumSignificantDigits:9}):'—';
const button=(action,label,attrs='')=>'<button type="button" data-region-action="'+action+'" '+attrs+'>'+esc(label)+'</button>';
const validRegion=value=>value&&typeof value.crs==='string'&&(value.geometry||Array.isArray(value.bounds)&&value.bounds.length===4&&value.bounds.every(Number.isFinite)&&value.bounds[2]>value.bounds[0]&&value.bounds[3]>value.bounds[1]);

export function regionMarkup(){
  return '<section class="spatial-regions" aria-label="Native region analysis"><header><div><h2>Region measurements</h2><p class="note">Measure original raster cells in a visible extent, a drawn rectangle, or an inspected source polygon.</p></div>'+button('visible','Use visible extent')+'</header>'+
    '<div class="region-selection" data-region-selection>Select the visible extent or drag with the Area tool.</div>'+
    '<div class="region-fields"><label>Analysis title<input data-region-input="title" maxlength="240" placeholder="Region analysis"></label><label>Cell inclusion<select data-region-input="inclusion"><option value="centre">Cell centre within region</option><option value="touched">Any cell touched by region</option></select></label><label>Histogram bins<select data-region-input="bins"><option>16</option><option selected>32</option><option>64</option><option>128</option></select></label></div>'+
    '<label>Interpretation and notes<textarea data-region-input="notes" rows="2" maxlength="16000"></textarea></label>'+
    '<div class="region-actions">'+button('analyze','Calculate and save','class="primary"')+button('clear','Clear selection')+'</div>'+
    '<p data-region-status class="note" role="status" aria-live="polite"></p><p data-region-error class="error-text" role="alert" hidden></p>'+
    '<div data-region-result></div><details><summary>Analysis tasks</summary><div data-region-tasks></div></details>'+
    '<details open><summary>Saved region analyses</summary><label class="region-search">Find an analysis<input data-region-input="search" type="search" placeholder="Search saved titles"></label><div data-region-history></div></details></section>'+cohortMarkup();
}

export function regionFeatureButton(group,index,feature){
  return ['Polygon','MultiPolygon'].includes(feature.geometry?.type)?
    button('feature','Measure this original polygon','data-group="'+group+'" data-feature="'+index+'"'):'';
}

export function createRegionAnalysis({root,model,workspace,request,alive,getSelection,getSources,refreshState,showTask,reopen,selectionChanged}){
  model.operations||={};model.items||=[];model.tasks||=[];model.title||='';model.notes||='';
  model.bins||=32;model.inclusion||='centre';model.search||='';model.page||=0;model.categoryPages||={};
  const events=new AbortController(),reads=new Set();let disposed=false,features=[],opening=null,lastSignature='';
  const current=()=>!disposed&&alive();
  const node=selector=>root.querySelector(selector);
  const panel=node('.spatial-regions');
  if(!document.querySelector('link[data-spatial-regions-style]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href='/web/spatial_regions.css';link.dataset.spatialRegionsStyle='';document.head.appendChild(link);
  }
  function error(value){
    if(!current())return;
    const target=node('[data-region-error]');target.textContent=value?.message||String(value);target.hidden=false;
  }
  function clearError(){const target=node('[data-region-error]');if(target)target.hidden=true;}
  function status(text){if(current())node('[data-region-status]').textContent=text;}
  function selection(){
    const value=model.selection,target=node('[data-region-selection]');
    target.textContent=value?(value.label||'Selected region')+' · '+value.crs+(value.bounds?' · '+value.bounds.map(number).join(', '):' · original polygon'):'Select the visible extent or drag with the Area tool.';
    selectionChanged?.(value);
  }
  function selectRegion(value){
    if(!validRegion(value))throw Error('Choose a valid region in its original coordinate system.');
    model.selection=copy(value);selection();clearError();
    status('Region selected. Calculate and save retains the original raster selection and result.');
  }
  function selectBounds(a,b,label='Drawn rectangle'){
    if(a.crs!==b.crs)throw Error('The map coordinate system changed during selection.');
    selectRegion({crs:a.crs,bounds:[Math.min(a.x,b.x),Math.min(a.y,b.y),Math.max(a.x,b.x),Math.max(a.y,b.y)],label});
  }
  function visible(){
    const value=getSelection();
    selectRegion({...copy(value.view),label:'Visible extent'});
  }
  function tableSeries(value){
    const rows=Object.entries(value.results||{}).map(([key,row])=>({key,label:key==='primary'?'Baseline · selected region':'Alternative · selected region',stats:row.statistics,units:row.units,selected:row.selected_native_cell_count,area:row.valid_grid_area_m2}));
    if(value.comparison)for(const key of ['primary','comparison','difference'])rows.push({key:'common_'+key,label:({primary:'Baseline · common cells',comparison:'Alternative · common cells',difference:'Alternative minus baseline · common cells'})[key],stats:value.comparison[key],units:value.comparison.units,selected:value.comparison.common_valid_cell_count,area:value.comparison.common_valid_grid_area_m2});
    return rows;
  }
  function histogram(row){
    const bins=row?.stats?.histogram;
    if(!bins?.counts?.length)return '<p class="note">No valid native cells are available for this histogram.</p>';
    const max=Math.max(...bins.counts,1),width=520/bins.counts.length;
    const bars=bins.counts.map((count,i)=>'<rect x="'+(20+i*width)+'" y="'+(130-count/max*110)+'" width="'+Math.max(.5,width-.8)+'" height="'+(count/max*110)+'"><title>'+esc(number(bins.edges[i]))+' to '+esc(number(bins.edges[i+1]))+': '+esc(number(count))+' cells</title></rect>').join('');
    return '<svg class="region-histogram" viewBox="0 0 560 158" role="img" aria-label="'+esc(row.label+' native cell histogram')+'"><title>'+esc(row.label)+' · '+esc(row.units||'native values')+' · '+esc(number(bins.count))+' valid native cells</title><path d="M20 15V130H540" fill="none" stroke="#777"/><g fill="#555">'+bars+'</g><text x="20" y="150">'+esc(number(bins.edges[0]))+'</text><text x="540" y="150" text-anchor="end">'+esc(number(bins.edges.at(-1)))+'</text><text x="20" y="11">'+esc(number(max))+' cells</text></svg><p class="note">All native values contribute to exactly one bin. Upper edges are exclusive except the last bin.</p>';
  }
  function categories(row){
    const entries=row.stats.categories||[],page=Math.min(model.categoryPages[row.key]||0,Math.max(0,Math.ceil(entries.length/50)-1)),start=page*50;
    model.categoryPages[row.key]=page;
    return '<section><h4>'+esc(row.label)+' · category counts</h4><div class="region-table"><table><thead><tr><th>Native category</th><th>Cells</th><th>Share of valid cells</th></tr></thead><tbody>'+entries.slice(start,start+50).map(item=>'<tr><td>'+esc(item.value)+'</td><td>'+number(item.count)+'</td><td>'+number(item.fraction_of_valid*100)+'%</td></tr>').join('')+'</tbody></table></div>'+
      (entries.length>50?'<div class="region-pagination">'+button('categories-prev','Previous','data-series="'+esc(row.key)+'" '+(!page?'disabled':''))+'<span>'+number(start+1)+'–'+number(Math.min(start+50,entries.length))+' of '+number(entries.length)+'</span>'+button('categories-next','Next','data-series="'+esc(row.key)+'" '+(start+50>=entries.length?'disabled':''))+'</div>':'')+'</section>';
  }
  function renderResult(){
    if(!current())return;
    const target=node('[data-region-result]'),value=model.result;
    if(!value){target.innerHTML='';return;}
    const rows=tableSeries(value),continuous=rows.filter(row=>row.stats.kind==='continuous');
    if(!continuous.some(row=>row.key===model.histogramSeries))model.histogramSeries=continuous.find(row=>row.key==='common_difference')?.key||continuous[0]?.key;
    const files=(value._downloads||[]).filter(file=>/^\/api\/file\/[a-f0-9]{64}$/.test(file.url||''));
    const selected=value.request.region;
    target.innerHTML='<article class="region-result"><header><div><h3>'+esc(value.title)+'</h3><p class="note">'+esc(value.sampling.cell_inclusion)+' · original raster resolution · '+esc(selected.crs)+'</p></div>'+button('reopen','Reopen selected area')+'</header>'+
      (value.notes?'<p class="region-notes">'+esc(value.notes)+'</p>':'')+
      '<div class="region-table"><table><thead><tr><th>Series</th><th>Units</th><th>Selected cells</th><th>Valid cells</th><th>Minimum</th><th>Maximum</th><th>Mean</th><th>Population SD</th><th>Sum of pixel values</th><th>Valid grid area (m²)</th></tr></thead><tbody>'+
      rows.map(row=>'<tr><th>'+esc(row.label)+'</th><td>'+esc(row.units||'undeclared')+'</td><td>'+number(row.selected)+'</td><td>'+number(row.stats.count)+'</td>'+['minimum','maximum','mean','standard_deviation','sum_native_pixel_values'].map(key=>'<td>'+number(row.stats[key])+'</td>').join('')+'<td>'+number(row.area)+'</td></tr>').join('')+'</tbody></table></div>'+
      '<p class="note">Valid cell counts exclude the original mask, NaN and infinity. Grid area uses the native projected coordinate system. Sums retain the raster’s physical pixel values; density values are not converted into totals.</p>'+
      (value.comparison?'<p><strong>Common valid cells:</strong> '+number(value.comparison.common_valid_cell_count)+' · <strong>Baseline-only valid:</strong> '+number(value.comparison.baseline_only_valid_cell_count)+' · <strong>Alternative-only valid:</strong> '+number(value.comparison.alternative_only_valid_cell_count)+'</p><p class="note">Relative change over common cells: '+number(value.comparison.relative_change_percent_of_common_baseline)+'%'+(value.comparison.relative_change_percent_of_common_baseline===null?' · baseline sum is zero or no common values exist':'')+'.</p>':value.request.comparison?'<p class="note">'+esc(value.pair.reason)+'</p>':'')+
      (continuous.length?'<label>Histogram series<select data-region-input="histogram">'+continuous.map(row=>'<option value="'+row.key+'"'+(row.key===model.histogramSeries?' selected':'')+'>'+esc(row.label)+'</option>').join('')+'</select></label><div data-region-histogram>'+histogram(continuous.find(row=>row.key===model.histogramSeries))+'</div>':'')+
      rows.filter(row=>row.stats.kind==='categorical').map(categories).join('')+
      '<div class="region-downloads">'+files.map(file=>'<a class="button" href="'+esc(file.url)+'?download=1" download>'+esc(file.label||file.filename)+'</a>').join('')+'</div>'+
      '<details><summary>Original selections and calculation</summary><pre>'+esc(JSON.stringify({id:value.id,request:value.request,sampling:value.sampling},null,2))+'</pre></details></article>';
  }
  function renderHistory(){
    if(!current())return;
    const search=model.search.trim().toLowerCase(),rows=model.items.filter(row=>!search||(row.title+' '+row.id).toLowerCase().includes(search));
    model.page=Math.min(model.page,Math.max(0,Math.ceil(rows.length/25)-1));const offset=model.page*25;
    node('[data-region-history]').innerHTML=rows.length?'<div class="region-history">'+rows.slice(offset,offset+25).map(row=>'<div><span>'+esc(row.title)+'</span>'+button('open','Open','data-id="'+esc(row.id)+'"')+'</div>').join('')+'</div>'+
      (rows.length>25?'<div class="region-pagination">'+button('previous','Previous',!model.page?'disabled':'')+'<span>'+number(offset+1)+'–'+number(Math.min(offset+25,rows.length))+' of '+number(rows.length)+'</span>'+button('next','Next',offset+25>=rows.length?'disabled':'')+'</div>':''):'<p class="note">No saved analysis matches this selection.</p>';
  }
  function renderTasks(){
    if(!current())return;
    const tasks=model.tasks.slice(0,25);
    node('[data-region-tasks]').innerHTML=tasks.length?tasks.map(task=>'<div class="region-task"><span>'+esc(task.payload?.title||'Region analysis')+'</span><span>'+esc(task.state)+(task.state==='running'&&task.region_progress?' · '+esc(task.region_progress.stage)+(task.region_progress.windows?' · '+number(task.region_progress.windows)+' windows':''):'')+'</span>'+button('task','Open task','data-id="'+esc(task.id)+'"')+(task.state==='complete'&&task.result?.id?button('open','View result','data-id="'+esc(task.result.id)+'"'):'')+'</div>').join(''):'<p class="note">Region calculations appear in the original workspace task queue.</p>';
  }
  async function openResult(id){
    if(opening===id)return;opening=id;
    const control=new AbortController();reads.add(control);
    try{
      const value=await request('/api/spatial/regions/result',{method:'POST',body:{workspace,id},signal:control.signal});
      if(!current()||control.signal.aborted||opening!==id)return;
      if(value.workspace_key!==workspace||value.id!==id||value.schema!=='upstate.spatial-regions/v1')throw Error('The region result belongs to a different selection.');
      model.result=value;model.categoryPages={};renderResult();status('Saved native region result opened.');
    }catch(e){if(e.name!=='AbortError')error(e);}
    finally{reads.delete(control);if(opening===id)opening=null;}
  }
  async function calculate(){
    clearError();const chosen=getSelection();
    if(!chosen.primary)throw Error('Choose the original baseline raster before calculating a region.');
    if(!model.selection)visible();
    const selected=model.selection;
    if(!validRegion(selected))throw Error('Choose a valid region.');
    const payload={title:model.title.trim()||selected.label||'Region analysis',notes:model.notes,primary:copy(chosen.primary),comparison:copy(chosen.comparison),region:{crs:selected.crs,...(selected.geometry?{geometry:copy(selected.geometry)}:{bounds:copy(selected.bounds)})},histogram_bins:Number(model.bins),all_touched:model.inclusion==='touched',...(selected.source_feature?{source_feature:copy(selected.source_feature)}:{})};
    const key=JSON.stringify(payload);
    let operation=model.operations[key];
    if(!operation)operation=model.operations[key]={operation_id:crypto.randomUUID(),payload};
    if(operation.task_id){await showTask(operation.task_id);return;}
    if(operation.sending)return;
    operation.sending=true;status('Retaining this region calculation in the workspace task queue…');
    try{
      const task=await request('/api/actions',{method:'POST',body:{workspace,action:'spatial.region.analyze',operation_id:operation.operation_id,payload:operation.payload}});
      if(!task.id||task.workspace!==workspace)throw Error('The selected workspace did not return the original region task. Retry the same selection.');
      operation.task_id=task.id;model.autoOpenTask=task.id;
      if(!current())return;
      status('Region calculation queued. Its saved result appears here when complete.');
      await refreshState({force:true});
      if(current())await showTask(task.id);
    }catch(e){status('The original region selection remains here. Retry Calculate and save to continue this same request.');throw e;}
    finally{operation.sending=false;}
  }
  function setState(state){
    if(state?.workspace_key!==workspace||!current())return;
    cohorts.setState(state);
    model.items=state.data?.spatial_regions||[];
    model.tasks=(state.tasks||[]).filter(task=>task.action==='spatial.region.analyze'&&task.workspace===workspace);
    const signature=JSON.stringify([model.items,model.tasks.map(task=>[task.id,task.state,task.region_progress,task.result?.id])]);
    if(signature!==lastSignature){lastSignature=signature;renderHistory();renderTasks();}
    const completed=model.tasks.find(task=>task.id===model.autoOpenTask&&task.state==='complete'&&task.result?.id);
    if(completed){model.autoOpenTask=null;openResult(completed.result.id);}
  }
  function restoreFields(){
    const bins=node('[data-region-input="bins"]');
    const choices=[16,32,64,128];
    if(Number.isInteger(model.bins)&&model.bins>=2&&model.bins<=256&&!choices.includes(model.bins))choices.push(model.bins);
    bins.innerHTML=choices.sort((a,b)=>a-b).map(value=>'<option value="'+value+'">'+value+'</option>').join('');
    for(const key of ['title','notes','bins','inclusion','search'])node('[data-region-input="'+key+'"]').value=model[key];
  }
  async function action(target){
    clearError();
    const name=target.dataset.regionAction;
    if(name==='visible')return visible();
    if(name==='clear'){model.selection=null;selection();return;}
    if(name==='analyze')return calculate();
    if(name==='open'){model.autoOpenTask=null;return openResult(target.dataset.id);}
    if(name==='task')return showTask(target.dataset.id);
    if(name==='reopen'&&model.result){
      const saved=copy(model.result),original=saved.request;
      if(!Number.isInteger(original.histogram_bins)||original.histogram_bins<2||original.histogram_bins>256||typeof original.all_touched!=='boolean')throw Error('The saved analysis has no valid native calculation settings.');
      await reopen(saved);
      if(!current())return;
      Object.assign(model,{selection:{...copy(original.region),label:saved.title,...(original.source_feature?{source_feature:copy(original.source_feature)}:{})},
        title:original.title,notes:original.notes||'',bins:original.histogram_bins,inclusion:original.all_touched?'touched':'centre'});
      restoreFields();selection();status('Original area, rasters, cell inclusion, histogram bins and notes restored.');return;
    }
    if(name==='feature'){
      const group=features[Number(target.dataset.group)],feature=group?.features?.[Number(target.dataset.feature)];
      if(!feature||!['Polygon','MultiPolygon'].includes(feature.geometry?.type))throw Error('Inspect the original polygon again before selecting it.');
      selectRegion({crs:feature.geometry_crs,geometry:copy(feature.geometry),display_geometry:copy(feature.display_geometry),display_geometry_crs:feature.display_geometry_crs,label:group.layer.title+' · feature '+feature.id,source_feature:{selection:copy(group.selection),id:String(feature.id)}});
      panel.scrollIntoView({block:'nearest',behavior:'smooth'});return;
    }
    if(name==='previous'||name==='next'){model.page+=name==='next'?1:-1;renderHistory();return;}
    if(name==='categories-prev'||name==='categories-next'){const key=target.dataset.series;model.categoryPages[key]=(model.categoryPages[key]||0)+(name==='categories-next'?1:-1);renderResult();}
  }
  root.addEventListener('click',event=>{
    const target=event.target.closest('[data-region-action]');if(!target||!root.contains(target))return;
    event.preventDefault();action(target).catch(error);
  },{signal:events.signal});
  root.addEventListener('input',event=>{
    const target=event.target.closest('[data-region-input]');if(!target||!root.contains(target))return;
    const key=target.dataset.regionInput;
    if(['title','notes','search'].includes(key)){model[key]=target.value;if(key==='search'){model.page=0;renderHistory();}}
  },{signal:events.signal});
  root.addEventListener('change',event=>{
    const target=event.target.closest('[data-region-input]');if(!target)return;
    const key=target.dataset.regionInput;
    if(key==='bins')model.bins=Number(target.value);
    if(key==='inclusion')model.inclusion=target.value;
    if(key==='histogram'){model.histogramSeries=target.value;const row=tableSeries(model.result).find(row=>row.key===target.value);node('[data-region-histogram]').innerHTML=histogram(row);}
  },{signal:events.signal});
  model.cohorts||={};
  const cohorts=createCohortAnalysis({root,model:model.cohorts,workspace,request,alive:current,getSelection,getSources,refreshState,showTask,
    openRegion:async id=>{await openResult(id);if(current()&&model.result?.id===id)node('[data-region-result]')?.scrollIntoView({block:'start',behavior:'smooth'});}});
  restoreFields();
  selection();renderResult();renderHistory();renderTasks();
  return {selectBounds,selectRegion,setState,openResult,updateSources:()=>cohorts.updateSources(),setFeatures:value=>{features=value||[];},dispose:()=>{disposed=true;cohorts.dispose();events.abort();for(const control of reads)control.abort();reads.clear();}};
}
