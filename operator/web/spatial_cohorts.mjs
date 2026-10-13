const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=value=>value==null?value:JSON.parse(JSON.stringify(value));
const count=value=>Number.isFinite(value)?value.toLocaleString():'—';
const number=value=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString(undefined,{maximumSignificantDigits:9}):'—';
const button=(action,title,attrs='')=>'<button type="button" data-cohort-action="'+action+'" '+attrs+'>'+esc(title)+'</button>';
const option=(value,title,selected)=>'<option value="'+esc(value)+'"'+(String(value)===String(selected)?' selected':'')+'>'+esc(title)+'</option>';
const key=value=>JSON.stringify(value??null);
const SORTS={feature_id:'Original feature ID',label:'Feature label',status:'Result status',primary_mean:'Baseline mean',comparison_mean:'Alternative mean',paired_mean_difference:'Common-cell mean difference',paired_relative_change_percent:'Common-cell relative change'};
const METRICS={mean:'Mean',minimum:'Minimum',maximum:'Maximum',standard_deviation:'Population SD',sum_native_pixel_values:'Sum of native pixel values',valid_cells:'Valid native cells',selected_cells:'Selected native cells',valid_grid_area_m2:'Valid native grid area (m²)'};

export function cohortMarkup(){
  return '<section class="spatial-cohorts" aria-label="Whole boundary layer measurements"><header><h2>Measure a boundary layer</h2><p class="note">Calculate each original polygon in a retained vector layer. The baseline and alternative raster bands are the current selections in the map above.</p></header>'+
    '<div class="cohort-fields"><label>Original boundary source or map overlay<select data-cohort-input="source"></select></label><label>Native vector layer<select data-cohort-input="layer"></select></label><label>Feature label field<select data-cohort-input="label-field"></select></label></div>'+
    '<p class="note" data-cohort-source-status></p>'+
    '<details><summary>Attribute filters and original feature subset</summary><p class="note">A map overlay retains its existing equality filters. Filter values use the original field types. Leave the feature list empty to include every matching polygon.</p><div data-cohort-filters></div>'+
    '<div class="cohort-actions">'+button('filter-add','Add equality filter')+button('filter-apply','Inspect filtered source')+button('filter-reset','Restore inspected filters')+'</div>'+
    '<label>Original feature IDs, one per line<textarea data-cohort-input="feature-ids" rows="4" placeholder="Leave empty for all matching original polygons"></textarea></label></details>'+
    '<div class="cohort-fields"><label>Cohort title<input data-cohort-input="title" maxlength="240" placeholder="Catchment comparison"></label><label>Cell inclusion<select data-cohort-input="inclusion"><option value="centre">Cell centre within polygon</option><option value="touched">Any cell touched by polygon</option></select></label><label>Histogram bins<select data-cohort-input="bins"><option>16</option><option selected>32</option><option>64</option><option>128</option></select></label></div>'+
    '<label>Interpretation and notes<textarea data-cohort-input="notes" rows="2" maxlength="16000"></textarea></label>'+
    '<div class="cohort-actions">'+button('calculate','Calculate and retain all selected polygons','class="primary"')+'</div>'+
    '<p data-cohort-status class="note" role="status" aria-live="polite"></p><p data-cohort-error class="error-text" role="alert" hidden></p>'+
    '<div data-cohort-result></div><details><summary>Cohort operations and recovery</summary><div data-cohort-tasks></div></details>'+
    '<details open><summary>Retained boundary cohorts</summary><label>Find a saved cohort<input data-cohort-input="history-search" type="search"></label><div data-cohort-history></div></details></section>';
}

export function createCohortAnalysis({root,model,workspace,request,alive,getSelection,getSources,refreshState,showTask,openRegion}){
  model.operations||={};model.items||=[];model.tasks||=[];model.title||='';model.notes||='';
  model.bins||=32;model.inclusion||='centre';model.featureIDs||='';model.labelField||='';
  model.historySearch||='';model.historyPage||=0;model.taskPage||=0;
  model.query||={offset:0,limit:100,search:'',sort:'feature_id',descending:false};
  model.metric||='mean';model.filterDraft||=filterRows(model.sourceSelection?.where);
  const events=new AbortController(),reads=new Set();
  let disposed=false,sourceSignature='',stateSignature='',sources=[],descriptionRequest=0,resultRequest=0,describeControl=null,resultControl=null,searchTimer=null;
  const current=()=>!disposed&&alive();
  const node=selector=>root.querySelector(selector);
  if(!document.querySelector('link[data-spatial-cohorts-style]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href='/web/spatial_cohorts.css';link.dataset.spatialCohortsStyle='';document.head.appendChild(link);
  }
  function error(value){if(current()){const target=node('[data-cohort-error]');target.textContent=value?.message||String(value);target.hidden=false;}}
  function clearError(){const target=node('[data-cohort-error]');if(target)target.hidden=true;}
  function status(text){if(current())node('[data-cohort-status]').textContent=text;}
  function filterRows(where){return Object.entries(where||{}).map(([field,value])=>({field,type:value===null?'null':typeof value,text:value===null?'':String(value)}));}
  function resolvedSource(){
    if(!model.sourceSelection?.layer_id)throw Error('Choose an original boundary source.');
    const selection=copy(model.sourceSelection),where=Object.create(null);
    for(const row of model.filterDraft){
      if(!row.field)throw Error('Choose an original field for each equality filter.');
      if(Object.hasOwn(where,row.field))throw Error('Each original field can have one equality filter.');
      let value=row.text;
      if(row.type==='number'){
        const text=row.text.trim();
        if(!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)||!Number.isFinite(Number(text)))throw Error('Numeric filters need a finite original JSON number.');
        value=Number(text);
        if(Number.isInteger(value)&&!Number.isSafeInteger(value))throw Error('This integer exceeds the browser’s exact range. Use its original string field or another exact field.');
        if(value===0&&/[1-9]/.test(text.split(/[eE]/)[0]))throw Error('This number is smaller than the browser can represent.');
      }else if(row.type==='boolean'){
        if(!['true','false'].includes(row.text.trim().toLowerCase()))throw Error('Boolean filters must be true or false.');
        value=row.text.trim().toLowerCase()==='true';
      }else if(row.type==='null')value=null;
      else if(row.type!=='string')throw Error('Choose an original scalar filter type.');
      where[row.field]=value;
    }
    if(Object.keys(where).length)selection.where=where;else delete selection.where;
    return selection;
  }
  function restoreFields(){
    const bins=node('[data-cohort-input="bins"]'),choices=[16,32,64,128];
    if(Number.isInteger(model.bins)&&model.bins>=2&&model.bins<=256&&!choices.includes(model.bins))choices.push(model.bins);
    bins.innerHTML=choices.sort((a,b)=>a-b).map(value=>option(value,value,model.bins)).join('');
    for(const [field,value]of Object.entries({title:model.title,notes:model.notes,bins:model.bins,inclusion:model.inclusion,'feature-ids':model.featureIDs,'history-search':model.historySearch}))node('[data-cohort-input="'+field+'"]').value=value;
  }
  function renderFilters(){
    const fields=model.description?.native?.fields||{};
    node('[data-cohort-filters]').innerHTML=model.filterDraft.map((row,index)=>'<div class="cohort-filter-row" data-cohort-filter="'+index+'">'+
      '<label>Original field<select data-cohort-input="filter-field" data-index="'+index+'">'+option('','Choose a field',row.field)+Object.entries(fields).map(([name,type])=>option(name,name+' · '+type,row.field)).join('')+(row.field&&!Object.hasOwn(fields,row.field)?option(row.field,row.field,row.field):'')+'</select></label>'+
      '<label>Value type<select data-cohort-input="filter-type" data-index="'+index+'">'+['string','number','boolean','null'].map(type=>option(type,type,row.type)).join('')+'</select></label>'+
      '<label>Equals<input data-cohort-input="filter-value" data-index="'+index+'" value="'+esc(row.text)+'"'+(row.type==='null'?' disabled':'')+'></label>'+button('filter-remove','Remove','data-index="'+index+'"')+'</div>').join('')||'<p class="note">Every original attribute value is included.</p>';
  }
  function renderSources(){
    const selectedKey=key(model.sourceSelection);
    const choices=[...sources];
    if(model.sourceSelection&&!choices.some(row=>key(row.selection)===selectedKey))choices.unshift({selection:copy(model.sourceSelection),title:'Current retained boundary selection'});
    node('[data-cohort-input="source"]').innerHTML=option('','Choose an original vector source',selectedKey)+choices.map(row=>option(key(row.selection),row.title,selectedKey)).join('');
    const native=model.description?.native;
    const layers=native?.layers||[];
    node('[data-cohort-input="layer"]').innerHTML=layers.length?layers.map(value=>option(value,value,model.sourceSelection?.layer||native.selected_layer)).join(''):option('','Original default layer','');
    const fields=native?.fields||{};
    node('[data-cohort-input="label-field"]').innerHTML=option('','Use original feature IDs',model.labelField)+Object.keys(fields).map(value=>option(value,value,model.labelField)).join('')+(model.labelField&&!Object.hasOwn(fields,model.labelField)?option(model.labelField,model.labelField,model.labelField):'');
    node('[data-cohort-source-status]').textContent=native?'Original '+native.geometry_type+' · '+native.crs+' · '+count(native.feature_count)+' source features'+(native.filtered_count!==null&&native.filtered_count!==undefined?' · '+count(native.filtered_count)+' match the inspected filter':'')+'. The native operation records excluded geometries and missing requested IDs.':model.sourceSelection?'Inspecting the original vector fields and native layers…':'Retained original vector sources and existing map filters appear here.';
    renderFilters();
  }
  function updateSources(){
    if(!current())return;
    const available=typeof getSources==='function'?getSources():{},layers=(available?.layers||[]).filter(row=>row.kind==='vector'),overlays=available?.overlays||[];
    const signature=key([layers.map(row=>[row.id,row.sha256,row.title]),overlays.map(row=>[row.selection,row.label])]);
    if(signature===sourceSignature)return;
    sourceSignature=signature;
    sources=overlays.filter(row=>row.selection?.layer_id&&layers.some(layer=>layer.id===row.selection.layer_id)).map(row=>({selection:copy(row.selection),title:'Map overlay · '+(row.label||layers.find(layer=>layer.id===row.selection.layer_id)?.title||row.selection.layer_id)+(row.selection.where?' · retained filter':'')}));
    for(const row of layers){const selection={layer_id:row.id};if(!sources.some(item=>key(item.selection)===key(selection)))sources.push({selection,title:'Original source · '+row.title});}
    renderSources();
    if(model.sourceSelection&&!model.description)describeSource().catch(error);
  }
  async function describeSource(){
    if(!model.sourceSelection)return;
    const selection=resolvedSource(),selectedKey=key(selection),version=++descriptionRequest;
    describeControl?.abort();const control=new AbortController();describeControl=control;reads.add(control);
    try{
      const value=await request('/api/spatial/describe',{method:'POST',body:{workspace,selection},signal:control.signal});
      if(!current()||control.signal.aborted||version!==descriptionRequest||key(resolvedSource())!==selectedKey)return;
      if(value.workspace_key!==workspace||value.native?.kind!=='vector')throw Error('The original vector description belongs to a different selection.');
      model.sourceSelection={...selection,...(value.native.selected_layer?{layer:value.native.selected_layer}:{})};
      model.description=value;model.filterDraft=filterRows(model.sourceSelection.where);renderSources();
    }finally{reads.delete(control);if(describeControl===control)describeControl=null;}
  }
  function rows(){
    const text=model.featureIDs.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
    if(new Set(text).size!==text.length)throw Error('Each requested original feature ID should appear once.');
    return text.length?text:null;
  }
  async function calculate(){
    clearError();
    const selected=getSelection();
    if(!selected.primary)throw Error('Choose an original baseline raster band in the map.');
    const title=model.title.trim();if(!title)throw Error('Give this boundary cohort a title.');
    const payload={title,notes:model.notes,source_selection:resolvedSource(),feature_ids:rows(),primary:copy(selected.primary),comparison:copy(selected.comparison)||null,histogram_bins:Number(model.bins),all_touched:model.inclusion==='touched',...(model.labelField?{label_field:model.labelField}:{})};
    const identity=key(payload);
    const operation=model.operations[identity]||(model.operations[identity]={operation_id:crypto.randomUUID(),payload});
    if(operation.task_id)return showTask(operation.task_id);
    if(operation.sending)return;
    operation.sending=true;status('Retaining the complete original boundary selection…');
    try{
      const value=await request('/api/actions',{method:'POST',body:{workspace,action:'spatial.cohort.analyze',operation_id:operation.operation_id,payload:operation.payload}});
      if(value.workspace!==workspace||!value.id)throw Error('The workspace did not return this retained cohort operation. Retry the same selection.');
      operation.task_id=value.id;model.autoOpenTask=value.id;
      if(!current())return;
      status('Original cohort operation retained. Its native progress and saved results appear below.');
      await refreshState({force:true});if(current())await showTask(value.id);
    }catch(e){status('The original cohort selection remains here. Retry to continue the same request.');throw e;}
    finally{operation.sending=false;}
  }
  function renderHistory(){
    if(!current())return;
    const search=model.historySearch.trim().toLowerCase(),items=model.items.filter(row=>!search||(row.title+' '+row.id).toLowerCase().includes(search));
    model.historyPage=Math.min(model.historyPage,Math.max(0,Math.ceil(items.length/25)-1));const offset=model.historyPage*25;
    node('[data-cohort-history]').innerHTML=items.length?'<div class="cohort-history">'+items.slice(offset,offset+25).map(row=>'<div><span><strong>'+esc(row.title)+'</strong><small>'+count(row.feature_count)+' features · '+count(row.completed_count)+' complete · '+count(row.excluded_count)+' excluded · '+count(row.missing_count)+' missing</small></span>'+button('open','Open results','data-id="'+esc(row.id)+'"')+'</div>').join('')+'</div>'+
      (items.length>25?'<div class="cohort-pagination">'+button('history-prev','Previous',!model.historyPage?'disabled':'')+'<span>'+count(offset+1)+'–'+count(Math.min(offset+25,items.length))+' of '+count(items.length)+'</span>'+button('history-next','Next',offset+25>=items.length?'disabled':'')+'</div>':''):'<p class="note">Retained cohorts appear here after the original operation finishes.</p>';
  }
  function progress(task){
    const p=task.cohort_progress;if(!p)return task.state;
    return [task.state,p.stage,Number.isFinite(p.scanned)?count(p.scanned)+' scanned':'',Number.isFinite(p.selected)?count(p.selected)+' selected':'',Number.isFinite(p.completed)?count(p.completed)+' complete':'',Number.isFinite(p.reused)?count(p.reused)+' reused':'',Number.isFinite(p.excluded)?count(p.excluded)+' excluded':'',p.feature_id!==undefined?'feature '+p.feature_id:''].filter(Boolean).join(' · ');
  }
  function renderTasks(){
    if(!current())return;
    const items=model.tasks;
    model.taskPage=Math.min(model.taskPage,Math.max(0,Math.ceil(items.length/10)-1));const offset=model.taskPage*10;
    node('[data-cohort-tasks]').innerHTML=items.length?items.slice(offset,offset+10).map(row=>'<div class="cohort-task"><div><strong>'+esc(row.payload?.title||'Boundary cohort')+'</strong><p class="note">'+esc(progress(row))+'</p>'+(row.error?'<p class="error-text">'+esc(row.error.message||row.error)+'</p>':'')+'</div><div class="cohort-actions">'+button('task','Open original operation','data-id="'+esc(row.id)+'"')+(['failed','interrupted','cancelled'].includes(row.state)?button('resume','Continue original selection','data-id="'+esc(row.id)+'"'):'')+(row.state==='complete'&&row.result?.id?button('open','Open results','data-id="'+esc(row.result.id)+'"'):'')+'</div></div>').join('')+
      (items.length>10?'<div class="cohort-pagination">'+button('tasks-prev','Previous',!model.taskPage?'disabled':'')+'<span>'+count(offset+1)+'–'+count(Math.min(offset+10,items.length))+' of '+count(items.length)+'</span>'+button('tasks-next','Next',offset+10>=items.length?'disabled':'')+'</div>':''):'<p class="note">Original cohort operations retain their selection and per-feature progress for continuation.</p>';
  }
  function valueCell(row,prefix){
    if(row[prefix+'_kind']==='categorical'&&!['valid_cells','selected_cells','valid_grid_area_m2'].includes(model.metric))return '<span class="note">Categorical</span>';
    return number(row[prefix+'_'+model.metric]);
  }
  function renderResult(){
    if(!current())return;
    const target=node('[data-cohort-result]'),value=model.result;if(!value){target.innerHTML='';return;}
    const active=document.activeElement,focused=target.contains?.(active)?active.dataset?.cohortInput:null,cursor=focused==='result-search'?[active.selectionStart,active.selectionEnd]:null;
    const q=model.query,files=(value._downloads||[]).filter(file=>/^\/api\/file\/[a-f0-9]{64}$/.test(file.url||''));
    const paired=!!value.request?.comparison;
    target.innerHTML='<article class="cohort-result"><header><h3>'+esc(value.title)+'</h3><p>'+count(value.feature_count)+' original features · '+count(value.completed_count)+' complete · '+count(value.excluded_count)+' excluded · '+count(value.missing_count)+' missing</p></header>'+
      (value.notes?'<p class="cohort-notes">'+esc(value.notes)+'</p>':'')+
      '<p class="note">Each row is an original feature calculation. Missing values remain empty; excluded geometries and missing requested IDs retain their reason. Features may overlap, so their totals are not added together.</p>'+
      (paired?'<p class="note">Baseline and alternative statistics use each raster’s own valid cells. Differences and relative change use only their common valid native cells.</p>':'')+
      (paired&&value.pair?.comparable===false?'<p class="note"><strong>Native paired comparison unavailable:</strong> '+esc(value.pair.reason||'The selected original rasters do not support an aligned native comparison.')+'</p>':'')+
      '<div class="cohort-result-controls"><label>Find feature ID, label or status<input data-cohort-input="result-search" type="search" value="'+esc(q.search)+'"></label><label>Order by<select data-cohort-input="sort">'+Object.entries(SORTS).map(([name,title])=>option(name,title,q.sort)).join('')+'</select></label><label>Order<select data-cohort-input="descending">'+option('false','Ascending',String(q.descending))+option('true','Descending',String(q.descending))+'</select></label><label>Native raster statistic<select data-cohort-input="metric">'+Object.entries(METRICS).map(([name,title])=>option(name,title,model.metric)).join('')+'</select></label></div>'+
      '<div class="cohort-table"><table><thead><tr><th>Original feature</th><th>Status</th><th>Baseline '+esc(METRICS[model.metric])+'</th><th>Baseline units</th>'+(paired?'<th>Alternative '+esc(METRICS[model.metric])+'</th><th>Alternative units</th><th>Common valid cells</th><th>Alternative − baseline mean (common cells)</th><th>Common-cell change (%)</th>':'')+'<th>Original result</th></tr></thead><tbody>'+
      value.rows.map(row=>'<tr><th><span>'+esc(row.label||row.feature_id)+'</span><small class="mono">'+esc(row.feature_id)+'</small></th><td>'+esc(row.status)+(row.reason?'<small>'+esc(row.reason)+'</small>':'')+'</td><td>'+valueCell(row,'primary')+'</td><td>'+esc(model.metric==='valid_grid_area_m2'?'m²':['valid_cells','selected_cells'].includes(model.metric)?'cells':row.primary_units||'—')+'</td>'+
        (paired?'<td>'+valueCell(row,'comparison')+'</td><td>'+esc(model.metric==='valid_grid_area_m2'?'m²':['valid_cells','selected_cells'].includes(model.metric)?'cells':row.comparison_units||'—')+'</td><td>'+number(row.paired_common_valid_cells)+'</td><td>'+number(row.paired_mean_difference)+(row.paired_units?' '+esc(row.paired_units):'')+'</td><td>'+number(row.paired_relative_change_percent)+'</td>':'')+
        '<td>'+(row.region_analysis_id?button('region','Open native analysis','data-id="'+esc(row.region_analysis_id)+'"'):'—')+'</td></tr>').join('')+'</tbody></table></div>'+
      (!value.rows.length?'<p class="note">No retained feature row matches this search.</p>':'')+
      '<div class="cohort-pagination">'+button('result-prev','Previous',value.offset<=0?'disabled':'')+'<span>'+(value.total?count(value.offset+1)+'–'+count(value.offset+value.rows.length):'0')+' of '+count(value.total)+' matching features</span>'+button('result-next','Next',!value.has_more?'disabled':'')+'</div>'+
      '<div class="cohort-downloads">'+files.map(file=>'<a class="button" href="'+esc(file.url)+'?download=1" download>'+esc(file.label||file.filename)+'</a>').join('')+'</div>'+
      '<details><summary>Original cohort selection</summary><pre>'+esc(JSON.stringify({id:value.id,request:value.request,rows_file:value.rows_file},null,2))+'</pre></details></article>';
    if(focused){const field=target.querySelector?.('[data-cohort-input="'+focused+'"]');field?.focus({preventScroll:true});if(cursor&&field?.setSelectionRange)field.setSelectionRange(...cursor);}
  }
  async function openResult(id,{reset=true}={}){
    clearTimeout(searchTimer);
    if(reset)model.query={offset:0,limit:100,search:'',sort:'feature_id',descending:false};
    model.resultId=id;const q=copy(model.query),version=++resultRequest;
    resultControl?.abort();const control=new AbortController();resultControl=control;reads.add(control);
    status('Reading the retained original feature results…');
    try{
      const value=await request('/api/spatial/cohorts/result',{method:'POST',body:{workspace,id,...q},signal:control.signal});
      if(!current()||control.signal.aborted||version!==resultRequest||model.resultId!==id)return;
      if(value.workspace_key!==workspace||value.id!==id||!Array.isArray(value.rows)||!Number.isSafeInteger(value.offset)||!Number.isSafeInteger(value.total))throw Error('The cohort page belongs to a different retained selection.');
      model.result=value;model.query.offset=value.offset;renderResult();status('Retained cohort results opened. CSV and SQLite contain all feature rows; the JSON retains the original cohort selection.');
    }catch(e){if(e.name!=='AbortError')error(e);}
    finally{reads.delete(control);if(resultControl===control)resultControl=null;}
  }
  function setState(state){
    if(!current()||state?.workspace_key!==workspace)return;
    model.items=state.data?.spatial_cohorts||[];
    model.tasks=(state.tasks||[]).filter(row=>row.workspace===workspace&&row.action==='spatial.cohort.analyze');
    const signature=key([model.items,model.tasks.map(row=>[row.id,row.state,row.cohort_progress,row.result?.id,row.error])]);
    if(signature!==stateSignature){stateSignature=signature;renderHistory();renderTasks();}
    const completed=model.tasks.find(row=>row.id===model.autoOpenTask&&row.state==='complete'&&row.result?.id);
    if(completed){model.autoOpenTask=null;openResult(completed.result.id);}
    updateSources();
  }
  async function action(target){
    clearError();const name=target.dataset.cohortAction;
    if(name==='calculate')return calculate();
    if(name==='filter-add'){model.filterDraft.push({field:'',type:'string',text:''});renderFilters();return;}
    if(name==='filter-remove'){model.filterDraft.splice(Number(target.dataset.index),1);renderFilters();return;}
    if(name==='filter-apply')return describeSource();
    if(name==='filter-reset'){model.filterDraft=filterRows(model.sourceSelection?.where);renderFilters();return;}
    if(name==='task')return showTask(target.dataset.id);
    if(name==='resume'){
      const task=model.tasks.find(row=>row.id===target.dataset.id);
      if(!task||!['failed','interrupted','cancelled'].includes(task.state))return showTask(target.dataset.id);
      model.autoOpenTask=task.id;await request('/api/task/resume',{method:'POST',body:{id:task.id}});
      if(current()){await refreshState({force:true});if(current())await showTask(task.id);}return;
    }
    if(name==='open'){model.autoOpenTask=null;return openResult(target.dataset.id);}
    if(name==='region')return openRegion(target.dataset.id);
    if(name==='history-prev'||name==='history-next'){model.historyPage+=name==='history-next'?1:-1;renderHistory();return;}
    if(name==='tasks-prev'||name==='tasks-next'){model.taskPage+=name==='tasks-next'?1:-1;renderTasks();return;}
    if(name==='result-prev'||name==='result-next'){
      if(!model.result)return;model.query.offset=name==='result-prev'?Math.max(0,model.result.offset-model.query.limit):model.result.offset+model.result.rows.length;
      return openResult(model.result.id,{reset:false});
    }
  }
  root.addEventListener('click',event=>{
    const target=event.target.closest('[data-cohort-action]');if(!target||!root.contains(target)||!current())return;
    event.preventDefault();action(target).catch(error);
  },{signal:events.signal});
  root.addEventListener('input',event=>{
    const target=event.target.closest('[data-cohort-input]');if(!target||!root.contains(target)||!current())return;
    const field=target.dataset.cohortInput;
    if(['title','notes'].includes(field))model[field]=target.value;
    if(field==='feature-ids')model.featureIDs=target.value;
    if(field==='filter-value')model.filterDraft[Number(target.dataset.index)].text=target.value;
    if(field==='history-search'){model.historySearch=target.value;model.historyPage=0;renderHistory();}
    if(field==='result-search'){
      model.query.search=target.value;model.query.offset=0;clearTimeout(searchTimer);resultControl?.abort();resultRequest++;
      const id=model.result?.id;if(id)searchTimer=setTimeout(()=>{if(current())openResult(id,{reset:false});},250);
    }
  },{signal:events.signal});
  root.addEventListener('change',event=>{
    const target=event.target.closest('[data-cohort-input]');if(!target||!root.contains(target)||!current())return;
    const field=target.dataset.cohortInput,index=Number(target.dataset.index);
    async function change(){
      if(field==='source'){
        model.sourceSelection=target.value?JSON.parse(target.value):null;model.description=null;model.labelField='';model.filterDraft=filterRows(model.sourceSelection?.where);
        describeControl?.abort();descriptionRequest++;renderSources();if(model.sourceSelection)await describeSource();
      }
      if(field==='layer'){model.sourceSelection.layer=target.value;delete model.sourceSelection.where;model.description=null;model.filterDraft=[];model.labelField='';renderSources();await describeSource();}
      if(field==='label-field')model.labelField=target.value;
      if(field==='filter-field')model.filterDraft[index].field=target.value;
      if(field==='filter-type'){model.filterDraft[index].type=target.value;renderFilters();}
      if(field==='bins')model.bins=Number(target.value);
      if(field==='inclusion')model.inclusion=target.value;
      if(field==='metric'){model.metric=target.value;renderResult();}
      if(field==='sort'||field==='descending'){
        clearTimeout(searchTimer);model.query[field]=field==='descending'?target.value==='true':target.value;model.query.offset=0;
        if(model.result)await openResult(model.result.id,{reset:false});
      }
    }
    change().catch(error);
  },{signal:events.signal});
  restoreFields();updateSources();renderFilters();renderHistory();renderTasks();renderResult();
  return {setState,updateSources,openResult,dispose(){disposed=true;events.abort();clearTimeout(searchTimer);for(const control of reads)control.abort();reads.clear();}};
}
