/* Calibration and validation against original retained annual loads. */
const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short = value => value ? String(value).slice(0,12) : '—';
const human = value => String(value ?? '').replaceAll('_',' ').replaceAll('-',' ');
const number = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(undefined,{maximumSignificantDigits:7}) : value === null || value === undefined ? '—' : esc(value);
const when = value => value ? new Date(value).toLocaleString() : '—';
const pretty = value => JSON.stringify(value,null,2);
const units = {nitrogen:'kg/year',phosphorus:'kg/year',sediment:'metric tonnes/year'};
const pollutants = Object.keys(units);
const button = (action,label,id='',primary=false,extra='') => '<button type="button" data-action="calibration-'+esc(action)+'"'+(id?' data-id="'+esc(id)+'"':'')+' class="'+(primary?'primary':'small')+'" '+extra+'>'+esc(label)+'</button>';
const badge = value => '<span class="calibration-badge">'+esc(human(value))+'</span>';
const table = (heads,rows) => '<div class="table-scroll"><table><thead><tr>'+heads.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const input = (name,value='',type='text',extra='') => '<input name="'+esc(name)+'" type="'+type+'" value="'+esc(value)+'" '+extra+'>';
const field = (label,control,note='',wide=false) => '<label class="'+(wide?'full':'')+'"><span>'+esc(label)+'</span>'+control+(note?'<small>'+esc(note)+'</small>':'')+'</label>';
const select = (name,rows,value='',required=true) => '<select name="'+esc(name)+'" '+(required?'required':'')+'><option value="">Choose…</option>'+rows.map(([key,label])=>'<option value="'+esc(key)+'" '+(String(key)===String(value)?'selected':'')+'>'+esc(label)+'</option>').join('')+'</select>';
const textArea = (name,value='',extra='') => '<textarea name="'+esc(name)+'" rows="3" '+extra+'>'+esc(value)+'</textarea>';
const val = name => $('#operation-form [name="'+name+'"]')?.value ?? '';
const chosen = name => $$('#operation-form [name="'+name+'"]:checked').map(x=>x.value);
const nativeButton = (kind,id,label) => '<button type="button" class="small" data-action="item" data-kind="'+esc(kind)+'" data-id="'+esc(id)+'">'+esc(label)+'</button>';
const section = (title,description,body,extra='') => '<section class="section"><header class="section-header"><div><h2>'+esc(title)+'</h2>'+(description?'<p>'+esc(description)+'</p>':'')+'</div>'+extra+'</header>'+body+'</section>';
const notesList = values => (values??[]).length ? '<ul class="calibration-notes">'+values.map(value=>'<li>'+esc(typeof value==='string'?value:pretty(value))+'</li>').join('')+'</ul>' : '';

export function attachCalibration({getState,api,endpoint,openForm,submitAction,detail,fileList,openItem,showTask,toast}){
  let mounted=null,generation=0,activeReport=null,activeTab='ranking',page=0,query='',sortKey='rank',sortDirection=1;
  let activeDraft=null,previewResult=null,previewIdentity=null,formToken=null;
  const current = () => getState()?.workspace_key;
  const sourceData = () => getState()?.data ?? {};
  const plans = () => sourceData().calibration_plans ?? [];
  const reports = () => sourceData().calibrations ?? [];
  const named = (kind,id) => {
    const row=(sourceData()[kind]??[]).find(item=>item.id===id);
    return row?.title||row?.metadata?.title||row?.spec?.title||short(id);
  };
  const draftKey = () => 'upstate-calibration-draft:'+current();
  const form = () => $('#operation-form');
  async function read(operation,values={}){
    const workspace=current(),ticket=generation;
    const result=await api(endpoint('/api/calibration/'+operation,values));
    if(current()!==workspace||ticket!==generation)throw Error('The workspace view changed. Open the selected calibration again.');
    return result;
  }
  const bodyHTML = () => $('#content');
  const isCurrentDraft = token => token===formToken && activeDraft?.workspace===current() && $('#form-dialog')?.open;
  function stateBadge(plan){return badge(plan.state||'prepared');}
  function header(title,description,actions=''){
    return '<header class="page-header"><div><p class="eyebrow">ORIGINAL OBSERVATIONS · NATIVE MODELS</p><h1>'+esc(title)+'</h1><p>'+esc(description)+'</p></div><div class="page-actions">'+actions+'</div></header>';
  }
  function render(){
    if(activeReport?.workspace_key!==current())activeReport=null;
    if(activeReport)return renderReport();
    const all=plans();
    return header('Calibration and validation','Compare completed baseline parameter profiles against the original annual loads. Keep independent catchment groups outside parameter selection and inspect the chosen profile on those groups.',button('new','New calibration','',true))+
      '<div class="cards">'+[
        ['Saved selections',all.length,'Original observations, candidate runs and group assignments.'],
        ['Completed comparisons',reports().length,'Retained parameter rankings and physical error metrics.'],
        ['Candidate baseline runs',(sourceData().runs??[]).filter(row=>row.state==='complete'&&(sourceData().scenarios??[]).find(s=>s.id===row.selection?.scenario_id)?.kind==='baseline').length,'Completed native runs using unchanged source land cover.'],
        ['Observation editions',(sourceData().observations??[]).filter(row=>row.admitted_count>0).length,'Original editions containing admitted annual mass rates.'],
      ].map(([title,count,note])=>'<div class="card"><h3>'+esc(title)+'</h3><strong class="number">'+number(count)+'</strong><p>'+esc(note)+'</p></div>').join('')+'</div>'+
      section('Saved calibration selections','Each selection retains its source catchments, original observation records, candidate profiles, objective and calibration/validation assignments.',
        all.length?table(['Selection','State','Candidate runs','Group split',''],all.map(row=>'<tr><td class="name-cell"><strong>'+esc(row.title||row.selection?.title||short(row.id))+'</strong><small>'+esc(when(row.created_at))+' · <span class="mono">'+esc(short(row.id))+'</span></small></td><td>'+stateBadge(row)+'</td><td>'+number(row.candidate_count??row.selection?.candidate_run_ids?.length)+'</td><td>'+number(row.calibration_groups??row.selection?.calibration_group_ids?.length)+' calibration<br>'+number(row.validation_groups??row.selection?.validation_group_ids?.length)+' validation</td><td class="actions-cell">'+button('plan','Open',row.id)+button('revise','Revise',row.id)+(row.result_id?button('report','Results',row.result_id):button('analyze','Analyze',row.id))+'</td></tr>')):
        '<div class="empty"><h2>Choose the original evidence</h2><p>Prepare a completed baseline run and retain annual load observations to compare parameter profiles on the actual catchment data.</p><div class="page-actions">'+button('new','New calibration','',true)+'<button type="button" data-view="runs">Native runs</button><button type="button" data-view="observations">Observations</button></div></div>')+
      section('How the selection works','Spatial groups keep overlapping upstream catchments and repeated stations together.',
        '<div class="section-body calibration-reading"><p>The calibration groups choose a parameter profile using the saved pollutant weights and normalization. Validation groups assess the selected profile after that choice. Physical error metrics retain nitrogen and phosphorus in kilograms per year and sediment in metric tonnes per year.</p><p>Candidate envelopes describe the calibration Pareto set: profiles whose pollutant scores are not jointly dominated by another candidate. The original observation periods, qualifiers, catchment coverage and model/source vintages remain available with every result.</p></div>');
  }
  function mount(root){
    mounted=root;
    if(activeReport)bindReport();
  }
  function detach(){
    mounted=null;
    generation++;
  }
  function repaint(){
    if(!mounted)return;
    mounted.innerHTML=render();
    if(activeReport)bindReport();
  }
  function savedDraft(){
    try{
      const value=JSON.parse(sessionStorage.getItem(draftKey())||'null');
      return value&&value.workspace===current()?value:null;
    }catch{return null;}
  }
  function retainDraft(){
    if(!activeDraft)return;
    try{sessionStorage.setItem(draftKey(),JSON.stringify(activeDraft));}catch{}
  }
  function groupKey(group){return group.grid_id+':'+group.scenario_id;}
  function sourceRows(collection){
    return (sourceData().sources??[]).find(row=>row.id===collection)?.entries.filter(row=>row.kind==='vector')??[];
  }
  function candidateTable(catalog,draft){
    const group=catalog.candidate_groups.find(row=>groupKey(row)===draft.group);
    if(!group)return '<p class="note">Choose a retained grid and unchanged land-cover baseline.</p>';
    return table(['Use','Completed parameter profile','Model period',''],group.runs.map(row=>
      '<tr><td><input type="checkbox" name="calibration_candidates" value="'+esc(row.id||row.run_id)+'" '+(draft.selection.candidate_run_ids?.includes(row.id||row.run_id)?'checked':'')+' aria-label="Use '+esc(row.title)+'"></td><td><strong>'+esc(row.title||named('profiles',row.profile_id))+'</strong><small class="mono">'+esc(short(row.id||row.run_id))+'</small></td><td>'+esc(typeof row.model_period==='object'?pretty(row.model_period):row.model_period||'Recorded with profile')+'</td><td>'+nativeButton('runs',row.id||row.run_id,'Open run')+'</td></tr>'));
  }
  function filterRow(name='',value='',type=null){
    type=type||(value===null?'null':typeof value==='number'?'number':typeof value==='boolean'?'boolean':'text');
    return '<div class="calibration-filter-row">'+field('Original field',input('calibration_filter_name',name))+
      field('Type',select('calibration_filter_type',[['text','Text'],['number','Number'],['boolean','True / false'],['null','Null']],type))+
      field('Exact value',input('calibration_filter_value',value===null?'':String(value)))+button('filter-remove','Remove')+'</div>';
  }
  function externalRow(id='',value={}){
    return '<div class="calibration-external-row">'+field('Original observation record ID',input('calibration_external_record',id,'text','required'))+
      field('Delivered annual mass',input('calibration_external_mass',value.annual_mass??'','number','min="0" step="any" required'))+
      field('Annual mass units',select('calibration_external_units',[['kg/year','kg/year'],['metric_tonnes/year','metric tonnes/year']],value.units||'kg/year'))+
      field('Original source reference',input('calibration_external_source',value.source_reference||'','text','required'))+
      button('external-remove','Remove')+'</div>';
  }
  function readFilters(){
    const result={};
    for(const row of $$('.calibration-filter-row',form())){
      const name=$('[name="calibration_filter_name"]',row).value.trim();
      const type=$('[name="calibration_filter_type"]',row).value;
      const raw=$('[name="calibration_filter_value"]',row).value;
      if(!name)throw Error('Supply an original field name for each catchment filter.');
      if(Object.hasOwn(result,name))throw Error('The catchment filter repeats '+name+'.');
      let value=raw;
      if(type==='number'){
        value=Number(raw);
        if(!raw.trim()||!Number.isFinite(value)||(Number.isInteger(value)&&!Number.isSafeInteger(value)))throw Error('Use a finite, safely represented number for '+name+'.');
      }
      if(type==='boolean'){
        if(!['true','false'].includes(raw.toLowerCase()))throw Error('Use true or false for '+name+'.');
        value=raw.toLowerCase()==='true';
      }
      if(type==='null')value=null;
      result[name]=value;
    }
    return result;
  }
  function collectSelection({split=false}={}){
    const candidate_run_ids=chosen('calibration_candidates');
    const objective={};
    for(const pollutant of pollutants){
      const weightText=val('calibration_weight_'+pollutant).trim(),weight=Number(weightText);
      if(!weightText||!Number.isFinite(weight)||weight<0)throw Error('Use a nonnegative weight for '+pollutant+'.');
      const scaleText=val('calibration_scale_'+pollutant).trim();
      objective[pollutant]={weight};
      if(scaleText){
        const scale=Number(scaleText);
        if(!Number.isFinite(scale)||scale<=0)throw Error('Use a positive annual-load normalization scale for '+pollutant+'.');
        objective[pollutant].normalization_scale=scale;
        const reference=val('calibration_scale_reference_'+pollutant).trim();
        if(!reference)throw Error('Record the original source or rationale for the '+pollutant+' normalization scale.');
        objective[pollutant].scale_reference=reference;
      }
    }
    if(!Object.values(objective).some(row=>row.weight>0))throw Error('Give at least one pollutant a positive selection weight.');
    const catchments={source_collection_id:val('calibration_collection'),source_id:val('calibration_source'),id_field:val('calibration_id_field').trim()};
    const layer=val('calibration_layer').trim(),where=readFilters();
    if(layer)catchments.layer=layer;
    if(Object.keys(where).length)catchments.where=where;
    const selection={schema:'upstate.calibration-selection/v1',title:val('calibration_title').trim(),candidate_run_ids,
      observation_id:val('calibration_observation'),catchments,objective,temporal_weighting:val('calibration_temporal_weighting'),
      notes:val('calibration_notes').split(/\r?\n/).map(row=>row.trim()).filter(Boolean),
      leave_group_out:Boolean($('[name="calibration_leave_group_out"]',form())?.checked)};
    const reference=val('calibration_reference_run');
    if(reference&&candidate_run_ids.includes(reference))selection.reference_run_id=reference;
    const external={};
    for(const node of $$('.calibration-external-row',form())){
      const get=name=>$('[name="'+name+'"]',node)?.value??'';
      const id=get('calibration_external_record').trim(),text=get('calibration_external_mass').trim(),mass=Number(text),source=get('calibration_external_source').trim();
      if(!id||Object.hasOwn(external,id))throw Error('Each delivered load needs a distinct original observation record ID.');
      if(!text||!Number.isFinite(mass)||mass<0)throw Error('Enter a nonnegative delivered annual load for '+id+'.');
      if(!source)throw Error('Retain the original source reference for delivered load '+id+'.');
      external[id]={annual_mass:mass,units:get('calibration_external_units'),source_reference:source};
    }
    if(Object.keys(external).length)selection.delivered_external_loads=external;
    const records=val('calibration_records').split(/\r?\n/).map(row=>row.trim()).filter(Boolean);
    if(records.length)selection.observation_record_ids=[...new Set(records)];
    if(split){
      const assignments={},partitions=new Map();
      for(const node of $$('[data-calibration-group]',form())){
        const originalId=node.dataset.calibrationGroup;
        const group=previewResult.groups.find(row=>row.id===originalId);
        const label=$('[data-calibration-group-label="'+CSS.escape(originalId)+'"]',form()).value.trim();
        if(!label)throw Error('Name each retained catchment group.');
        if(partitions.has(label)&&partitions.get(label)!==node.value)throw Error('Catchment groups sharing the name '+label+' must use the same calibration or validation role.');
        partitions.set(label,node.value);
        for(const catchment of group.catchment_ids)assignments[catchment]=label;
      }
      selection.catchment_groups=assignments;
      selection.calibration_group_ids=[...partitions].filter(([,role])=>role==='calibration').map(([id])=>id);
      selection.validation_group_ids=[...partitions].filter(([,role])=>role==='validation').map(([id])=>id);
      if(!selection.calibration_group_ids.length)throw Error('Keep at least one catchment group for calibration.');
    }
    return selection;
  }
  function captureDraft(){
    if(!activeDraft||!form()?.querySelector('[name="calibration_title"]'))return;
    activeDraft.group=val('calibration_run_group');
    try{
      activeDraft.selection=collectSelection({split:Boolean(previewResult)});
      activeDraft.raw=null;
    }catch{
      activeDraft.raw=[...form().elements].filter(node=>node.name?.startsWith('calibration_')).map(node=>({name:node.name,value:node.value,type:node.type,checked:node.checked}));
    }
    retainDraft();
  }
  function invalidatePreview(){
    previewResult=null;
    previewIdentity=null;
    $('#calibration-group-body')?.replaceChildren();
    const notice=$('#calibration-preview-note');
    if(notice)notice.textContent='Inspect the original catchments to assign calibration and validation groups.';
    if($('#form-submit'))$('#form-submit').textContent='Inspect original catchments';
    captureDraft();
  }
  function renderPreview(value,selection){
    const assignedCalibration=new Set(activeDraft.selection.calibration_group_ids||[]);
    const assignedValidation=new Set(activeDraft.selection.validation_group_ids||[]);
    const groups=value.groups??[];
    if(!groups.length)throw Error('The selected original observations and catchment source produced no comparable catchment groups.');
    $('#calibration-group-body').innerHTML=table(['Original catchment group','Observation records','Pollutants','Group name / merge','Use for'],groups.map(group=>{
      const labels=group.catchment_ids.map(id=>activeDraft.selection.catchment_groups?.[id]).filter(Boolean);
      const label=labels.length===group.catchment_ids.length&&new Set(labels).size===1?labels[0]:group.id;
      const role=assignedValidation.has(label)?'validation':assignedCalibration.has(label)?'calibration':group.partition||'calibration';
      return '<tr><td class="name-cell"><strong>'+esc(group.catchment_ids?.join(', ')||group.id)+'</strong><small>'+esc((group.station_ids??[]).length?'Stations: '+group.station_ids.join(', '):'Original catchment identifiers')+'</small></td><td>'+number(group.observation_count)+'</td><td>'+esc((group.parameters??[]).join(', '))+'</td><td>'+input('calibration_group_label_'+group.id,label,'text','data-calibration-group-label="'+esc(group.id)+'" aria-label="Group name for '+esc(group.catchment_ids.join(', '))+'" required')+'</td><td>'+select('calibration_partition_'+group.id,[['calibration','Calibration'],['validation','Validation']],role).replace('<select ','<select data-calibration-group="'+esc(group.id)+'" ')+'</td></tr>';
    }));
    $('#calibration-preview-note').textContent=groups.length+' original catchment groups. Assign complete groups to validation. Give groups the same name to merge them; their shared role must match.';
    $('#form-submit').textContent='Save calibration selection';
    previewResult=value;
    previewIdentity=JSON.stringify(selection);
    for(const node of $$('[data-calibration-group]',form()))node.addEventListener('change',captureDraft);
    const excluded=value.exclusions??[];
    if(excluded.length)$('#calibration-group-body').insertAdjacentHTML('beforeend','<details class="technical"><summary>'+excluded.length+' retained exclusions</summary><pre class="json-view">'+esc(pretty(excluded))+'</pre></details>');
    captureDraft();
  }
  async function newForm(planId=null){
    const workspace=current();
    const catalog=await read('catalog');
    if(current()!==workspace)return;
    if(!catalog.candidate_groups?.length)throw Error('Complete a native baseline run before preparing a calibration.');
    if(!catalog.observations?.some(row=>row.admitted_count>0))throw Error('Retain an original observation edition with admitted annual load records first.');
    let draft=planId?null:savedDraft();
    if(planId){
      const packet=await read('plan',{id:planId});
      draft={workspace,selection:packet.plan.selection};
    }
    const first=catalog.candidate_groups[0];
    const selection=draft?.selection??{schema:'upstate.calibration-selection/v1',title:'',candidate_run_ids:[],
      observation_id:'',catchments:{},objective:Object.fromEntries(pollutants.map(name=>[name,{weight:1}])),notes:[]};
    const selectedGroup=catalog.candidate_groups.find(group=>group.runs.some(row=>selection.candidate_run_ids?.includes(row.id||row.run_id)));
    draft={workspace,selection,group:draft?.group||groupKey(selectedGroup||first),raw:draft?.raw??null};
    activeDraft=draft;previewResult=null;previewIdentity=null;formToken=crypto.randomUUID();
    const token=formToken;
    const collections=(sourceData().sources??[]).filter(row=>row.entries.some(entry=>entry.kind==='vector'));
    const collection=selection.catchments?.source_collection_id||(collections.length===1?collections[0].id:'');
    const vectorSources=sourceRows(collection);
    const objective=selection.objective??{},retainedRaw=draft.raw;
    openForm(planId?'Revise calibration selection':'New calibration',
      'Choose completed baseline profiles, original annual loads and source catchments. Inspect their connected groups, then retain the selection and validation split.',
      '<div class="calibration-form"><div class="form-grid">'+
      field('Selection title',input('calibration_title',selection.title,'text','required'),'Use the scientific question or retained study name.',true)+
      field('Native grid and unchanged baseline',select('calibration_run_group',catalog.candidate_groups.map(group=>[groupKey(group),named('grids',group.grid_id)+' · '+named('scenarios',group.scenario_id)]),draft.group),'Profiles compared together must use this same grid and baseline.',true)+
      '<fieldset class="full"><legend>Completed candidate profiles</legend><div id="calibration-candidates">'+candidateTable(catalog,draft)+'</div></fieldset>'+
      field('Original annual-load observations',select('calibration_observation',catalog.observations.filter(row=>row.admitted_count>0).map(row=>[row.id||row.observation_id,row.title+' · '+row.admitted_count+' annual records']),selection.observation_id),'',true)+
      '<div class="full page-actions">'+button('inspect-observation','Inspect original observations')+'</div>'+
      field('Catchment source edition',select('calibration_collection',collections.map(row=>[row.id,row.title]),collection))+
      field('Original polygon source',select('calibration_source',vectorSources.map(row=>[row.id,row.title]),selection.catchments?.source_id))+
      field('Native layer',input('calibration_layer',selection.catchments?.layer||'','text','list="calibration-layer-names"')+'<datalist id="calibration-layer-names"></datalist>','Leave blank when the source has one layer.')+
      field('Original catchment ID field',input('calibration_id_field',selection.catchments?.id_field||'','text','required list="calibration-field-names"')+'<datalist id="calibration-field-names"></datalist>','Matches the catchment identifiers in the retained observations.')+
      '<div class="full page-actions">'+button('inspect-source','Inspect native source fields')+'</div><div class="full" id="calibration-source-info"></div>'+
      '<details class="technical full"><summary>Exact source selection and observation records</summary><p class="note">Leave these empty to use the selected original layer and eligible observation records.</p><div id="calibration-filters">'+Object.entries(selection.catchments?.where??{}).map(([name,value])=>filterRow(name,value)).join('')+'</div>'+button('filter-add','Add exact catchment filter')+
      field('Original observation record IDs',textArea('calibration_records',(selection.observation_record_ids??[]).join('\n')),'Optional. One actual retained record ID per line.',true)+'</details>'+
      field('Observation period weighting',select('calibration_temporal_weighting',[['whole_years','Complete years · equal annual weight'],['elapsed_days','Elapsed days · derived annual period rates']],selection.temporal_weighting||'whole_years'),'Use the original annual-estimation method. Complete calendar or water years receive equal weight, including leap years.',true)+
      '<fieldset class="full"><legend>Parameter-selection objective</legend><p class="note">A zero weight excludes a pollutant from profile selection. Automatic normalization uses calibration observations only. Supply an explicit positive annual-load scale when the study requires one.</p>'+
      table(['Pollutant','Relative weight','Annual mass scale','Scale source or rationale'],pollutants.map(name=>'<tr><th scope="row">'+esc(human(name))+'<small>'+esc(units[name])+'</small></th><td>'+input('calibration_weight_'+name,objective[name]?.weight??(selection.observation_id?0:1),'number','min="0" step="any" required aria-label="'+name+' weight"')+'</td><td>'+input('calibration_scale_'+name,objective[name]?.normalization_scale??'','number','min="0" step="any" placeholder="From calibration observations" aria-label="'+name+' annual normalization scale"')+'</td><td>'+input('calibration_scale_reference_'+name,objective[name]?.scale_reference??'','text','aria-label="'+name+' scale source or rationale"')+'</td></tr>'))+'</fieldset>'+
      '<fieldset class="full"><legend>Calibration and validation groups</legend><p class="note" id="calibration-preview-note">Inspect the original catchments to assign calibration and validation groups.</p><div id="calibration-group-body"></div></fieldset>'+
      field('Interpretation notes',textArea('calibration_notes',(selection.notes??[]).join('\n')),'Retain period assumptions and relevant reservoir, point-source or source-edition context.',true)+
      '<details class="technical full"><summary>Delivered external loads and candidate selection</summary><p class="note">Retain a measured or otherwise source-supported annual load already delivered to the observed catchment outlet when the study adds that contribution to the native diffuse-load prediction.</p><div id="calibration-external-loads">'+Object.entries(selection.delivered_external_loads??{}).map(([id,row])=>externalRow(id,row)).join('')+'</div>'+button('external-add','Add original delivered load')+
      field('Reference candidate for an exact score tie',select('calibration_reference_run',(catalog.candidate_groups.find(group=>groupKey(group)===draft.group)?.runs??[]).map(row=>[row.id||row.run_id,row.title]),selection.reference_run_id||'',false),'Optional. It must remain one of the selected candidates.',true)+
      '<label class="check"><input name="calibration_leave_group_out" type="checkbox" '+(selection.leave_group_out!==false?'checked':'')+'><span>Assess selection stability by leaving out each calibration group, using the retained native predictions.</span></label></details>'+
      '</div></div>',
      'Inspect original catchments',async()=>{
        const selected=collectSelection();
        if(!selected.candidate_run_ids.length)throw Error('Select at least one completed parameter profile.');
        if(!previewResult||previewIdentity!==JSON.stringify(selected)){
          $('#form-progress').textContent='Reading original catchment groups and observation support…';
          const value=await api('/api/calibration/preview',{method:'POST',body:{workspace,selection:selected}});
          if(!isCurrentDraft(token))return;
          renderPreview(value,selected);
          $('#form-progress').textContent='Catchment groups are ready. Choose the validation groups, then save the selection.';
          return;
        }
        const finalSelection=collectSelection({split:true});
        activeDraft.selection=finalSelection;retainDraft();
        const task=await submitAction('calibration.prepare',{selection:finalSelection});
        try{sessionStorage.removeItem('upstate-calibration-draft:'+workspace);}catch{}
        activeDraft=null;previewResult=null;previewIdentity=null;formToken=null;
        return task;
      },()=>{
        const groupNode=$('[name="calibration_run_group"]',form());
        groupNode.addEventListener('change',()=>{
          activeDraft.group=groupNode.value;activeDraft.selection.candidate_run_ids=[];
          $('#calibration-candidates').innerHTML=candidateTable(catalog,activeDraft);
          const reference=$('[name="calibration_reference_run"]',form());
          if(reference)reference.outerHTML=select('calibration_reference_run',(catalog.candidate_groups.find(group=>groupKey(group)===activeDraft.group)?.runs??[]).map(row=>[row.id||row.run_id,row.title]),'',false);
          invalidatePreview();
        });
        $('[name="calibration_collection"]',form()).addEventListener('change',()=>{
          const node=$('[name="calibration_source"]',form());
          node.outerHTML=select('calibration_source',sourceRows(val('calibration_collection')).map(row=>[row.id,row.title]));
          $('#calibration-source-info').replaceChildren();
          invalidatePreview();
        });
        const observationNode=$('[name="calibration_observation"]',form());
        const updateObjective=()=>{
          const parameters=catalog.observations.find(row=>(row.id||row.observation_id)===observationNode.value)?.parameters;
          if(!parameters)return;
          for(const parameter of pollutants){
            const node=$('[name="calibration_weight_'+parameter+'"]',form());
            if(!parameters.includes(parameter)){node.value='0';node.disabled=true;}
            else{
              if(node.disabled)node.value='1';
              node.disabled=false;
            }
          }
          invalidatePreview();
        };
        observationNode.addEventListener('change',updateObjective);
        updateObjective();
        form().addEventListener('input',draftInput);
        form().addEventListener('change',draftChange);
        form().addEventListener('close',captureDraft,{once:true});
        if(retainedRaw){
          const filterCount=retainedRaw.filter(row=>row.name==='calibration_filter_name').length;
          while($$('.calibration-filter-row',form()).length<filterCount)$('#calibration-filters').insertAdjacentHTML('beforeend',filterRow());
          const externalCount=retainedRaw.filter(row=>row.name==='calibration_external_record').length;
          while($$('.calibration-external-row',form()).length<externalCount)$('#calibration-external-loads').insertAdjacentHTML('beforeend',externalRow());
          const rawGroup=retainedRaw.find(row=>row.name==='calibration_run_group')?.value;
          if(rawGroup&&rawGroup!==activeDraft.group){activeDraft.group=rawGroup;$('#calibration-candidates').innerHTML=candidateTable(catalog,activeDraft);}
          const positions={};
          for(const value of retainedRaw){
            const nodes=$$('[name="'+CSS.escape(value.name)+'"]',form());
            const position=positions[value.name]??0;positions[value.name]=position+1;
            const node=nodes[position];if(!node)continue;
            if(value.type==='checkbox')node.checked=value.checked;else node.value=value.value;
          }
        }
        retainDraft();
      });
  }
  function draftInput(event){
    if(!event.target.name?.startsWith('calibration_'))return;
    if(event.target.name==='calibration_notes'||event.target.name==='calibration_title'){
      // Title and notes are retained context; they still bind the saved selection.
      captureDraft();return;
    }
    if(event.target.hasAttribute('data-calibration-group')||event.target.hasAttribute('data-calibration-group-label')){captureDraft();return;}
    invalidatePreview();
  }
  function draftChange(event){
    if(!event.target.name?.startsWith('calibration_'))return;
    if(event.target.hasAttribute('data-calibration-group')||event.target.hasAttribute('data-calibration-group-label'))captureDraft();
    else invalidatePreview();
  }
  async function inspectSource(){
    const token=formToken,collection=val('calibration_collection'),source=val('calibration_source'),layer=val('calibration_layer').trim();
    if(!collection||!source)throw Error('Choose the original catchment source first.');
    const value=await api(endpoint('/api/source-info',{collection,source,...(layer?{layer}:{})}));
    if(!isCurrentDraft(token))return;
    $('#calibration-field-names').innerHTML=Object.keys(value.fields??{}).map(name=>'<option value="'+esc(name)+'"></option>').join('');
    $('#calibration-layer-names').innerHTML=(value.layers??[]).map(name=>'<option value="'+esc(name)+'"></option>').join('');
    const fields=Object.entries(value.fields??{});
    $('#calibration-source-info').innerHTML='<div class="calibration-source"><h3>'+esc(value.source?.title||'Original catchment source')+'</h3><p>'+number(value.feature_count)+' features · '+esc(value.geometry_type||'')+' · '+esc(value.selected_layer||'')+'</p>'+
      table(['Original field','Native type'],fields.map(([name,type])=>'<tr><td>'+esc(name)+'</td><td>'+esc(type)+'</td></tr>'))+
      ((value.sample??[]).length?'<details><summary>First '+value.sample.length+' original features</summary>'+table(['Native ID',...fields.map(([name])=>name)],value.sample.map(row=>'<tr><td>'+esc(row.native_id)+'</td>'+fields.map(([name])=>'<td>'+esc(typeof row[name]==='object'?pretty(row[name]):row[name])+'</td>').join('')+'</tr>'))+'</details>':'')+
      (value.download?fileList([value.download]):'')+'</div>';
    if(!val('calibration_layer')&&value.selected_layer)$('[name="calibration_layer"]',form()).value=value.selected_layer;
    captureDraft();
  }
  async function openPlan(id){
    const packet=await read('plan',{id}),plan=packet.plan,selection=plan.selection,progress=packet.progress;
    const groups=plan.spatial_groups?.groups??[];
    const body='<div class="page-actions">'+button('revise','Revise selection',id)+button('analyze',progress.state==='failed'?'Resume analysis':'Analyze selection',id,true)+
      (progress.result_id?button('report','Open results',progress.result_id):'')+'</div>'+
      '<dl class="definition"><dt>State</dt><dd>'+stateBadge(progress)+'</dd><dt>Observation edition</dt><dd>'+esc(named('observations',selection.observation_id))+'</dd><dt>Candidate runs</dt><dd>'+number(selection.candidate_run_ids.length)+'</dd><dt>Catchment source</dt><dd>'+esc(named('sources',selection.catchments.source_collection_id))+' / '+esc(selection.catchments.source_id)+'</dd><dt>ID field</dt><dd>'+esc(selection.catchments.id_field)+'</dd></dl>'+
      section('Candidate native runs','Every candidate uses the same original baseline and grid.',table(['Profile','Run',''],(plan.candidates??[]).map(row=>'<tr><td>'+esc(row.title||named('profiles',row.profile_id))+'</td><td class="mono">'+esc(short(row.run_id||row.id))+'</td><td>'+nativeButton('runs',row.run_id||row.id,'Open native run')+'</td></tr>')))+
      section('Retained catchment groups','The saved split is used exactly as selected.',table(['Group','Catchments','Partition'],groups.map(group=>'<tr><td class="mono">'+esc(short(group.id))+'</td><td>'+esc((group.catchment_ids??[]).join(', '))+'</td><td>'+badge(selection.validation_group_ids?.includes(group.id)?'validation':'calibration')+'</td></tr>')))+
      notesList(selection.notes)+fileList(packet._downloads||[])+
      '<details class="technical"><summary>Original selection and analysis progress</summary><pre class="json-view">'+esc(pretty({selection,progress}))+'</pre></details>';
    detail(plan.selection.title,body,{kind:'calibration-plan',id});
  }
  async function openReport(id){
    const packet=await read('report',{id});
    activeReport=packet;activeTab='ranking';page=0;query='';sortKey='rank';sortDirection=1;
    $('#detail-dialog')?.close();
    if(!mounted){
      location.hash='calibration';
      return;
    }
    repaint();
  }
  function currentRows(){
    const view=activeReport.view;
    let rows=view[activeTab]??[];
    rows=rows.filter(row=>!query||Object.values(row).map(value=>typeof value==='object'?pretty(value):String(value??'')).join(' ').toLowerCase().includes(query.toLowerCase()));
    rows=[...rows].sort((a,b)=>{
      const av=a[sortKey],bv=b[sortKey];
      if((av===null||av===undefined)&&(bv===null||bv===undefined))return 0;if(av===null||av===undefined)return 1;if(bv===null||bv===undefined)return -1;
      return (typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv)))*sortDirection;
    });
    return rows;
  }
  const columns={
    ranking:[['rank','Rank'],['title','Candidate profile'],['objective_score','Calibration loss'],['status','Outcome'],['run_id','Native run']],
    metrics:[['partition','Partition'],['profile_title','Profile'],['parameter','Pollutant'],['units','Units'],['groups','Groups'],['n','Catchments'],['rmse','RMSE'],['mean_bias','Mean bias'],['nash_sutcliffe_efficiency','NSE'],['normalized_mse','Normalized MSE']],
    validation:[['parameter','Pollutant'],['units','Units'],['groups','Groups'],['n','Catchments'],['rmse','RMSE'],['mean_bias','Mean bias'],['nash_sutcliffe_efficiency','NSE']],
    observations:[['partition','Partition'],['group_id','Group'],['catchment_id','Catchment'],['parameter','Pollutant'],['units','Units'],['observed','Observed annual load'],['modeled','Selected modeled load'],['residual','Residual'],['records','Original records']],
    groups:[['id','Group'],['partition','Partition'],['catchment_ids','Catchments'],['station_ids','Stations'],['observation_count','Records'],['parameters','Pollutants']],
    envelope:[['partition','Partition'],['parameter','Pollutant'],['units','Units'],['group_id','Group'],['catchment_id','Catchment'],['observed_annual_mass','Observed load'],['minimum','Minimum candidate load'],['median','Median candidate load'],['maximum','Maximum candidate load'],['candidate_count','Candidates']],
    stability:[['group_id','Omitted calibration group'],['state','Fold outcome'],['selected_run_id','Selected without group'],['same_as_full_selection','Selection unchanged'],['objective_score','Calibration loss']],
    exclusions:[['run_id','Candidate run'],['observation_id','Observation'],['catchment_id','Catchment'],['parameter','Pollutant'],['reason','Reason']],
  };
  const tabTitles={ranking:'Profile ranking',metrics:'Physical fit',validation:'Independent validation',observations:'Observed and modeled',groups:'Catchment groups',envelope:'Candidate envelope',stability:'Group stability',exclusions:'Exclusions'};
  function rowCell(row,key){
    const value=row[key];
    if(key==='run_id'&&value)return nativeButton('runs',value,short(value));
    if(key==='selected_run_id'&&value)return nativeButton('runs',value,short(value));
    if(key==='same_as_full_selection')return value===true?'Yes':value===false?'No':'—';
    if(Array.isArray(value))return esc(value.map(item=>typeof item==='object'?pretty(item):item).join(', '));
    if(value&&typeof value==='object')return '<details><summary>Details</summary><pre class="json-view">'+esc(pretty(value))+'</pre></details>';
    if(['id','group_id'].includes(key))return '<span class="mono" title="'+esc(value)+'">'+esc(short(value))+'</span>';
    return number(value);
  }
  function resultTable(){
    const rows=currentRows(),size=40;
    page=Math.min(page,Math.max(0,Math.ceil(rows.length/size)-1));
    const selected=rows.slice(page*size,(page+1)*size),fields=columns[activeTab];
    const head='<thead><tr>'+fields.map(([key,label])=>'<th scope="col"><button type="button" data-action="calibration-sort" data-key="'+key+'" class="calibration-sort">'+esc(label)+(sortKey===key?(sortDirection===1?' ↑':' ↓'):'')+'</button></th>').join('')+'</tr></thead>';
    const body=selected.map(row=>'<tr>'+fields.map(([key])=>'<td>'+rowCell(row,key)+'</td>').join('')+'</tr>').join('');
    return '<div class="table-scroll"><table>'+head+'<tbody>'+body+'</tbody></table></div>'+
      (!rows.length?'<p class="calibration-empty">This selected result has no rows in '+esc(tabTitles[activeTab].toLowerCase())+'.</p>':'')+
      '<div class="calibration-pagination"><span>'+rows.length+' rows'+(rows.length?' · '+(page*size+1)+'–'+Math.min((page+1)*size,rows.length):'')+'</span><div>'+button('page-previous','Previous','',false,page===0?'disabled':'')+button('page-next','Next','',false,(page+1)*size>=rows.length?'disabled':'')+'</div></div>';
  }
  function scatter(points,parameter){
    const selected=points.filter(row=>row.parameter===parameter&&row.included_in_metrics===true&&Number.isFinite(row.observed)&&Number.isFinite(row.modeled));
    if(!selected.length)return '';
    const width=480,height=300,left=64,right=18,top=20,bottom=52;
    const maximum=selected.reduce((value,row)=>Math.max(value,row.observed,row.modeled),0)||1;
    const max=maximum*1.06,x=value=>left+(width-left-right)*value/max,y=value=>height-bottom-(height-top-bottom)*value/max;
    const ticks=[0,.25,.5,.75,1].map(factor=>{
      const value=max*factor;
      return '<line x1="'+x(value)+'" y1="'+top+'" x2="'+x(value)+'" y2="'+(height-bottom)+'" class="calibration-grid"/><line x1="'+left+'" y1="'+y(value)+'" x2="'+(width-right)+'" y2="'+y(value)+'" class="calibration-grid"/><text x="'+x(value)+'" y="'+(height-bottom+19)+'" text-anchor="middle">'+esc(number(value))+'</text><text x="'+(left-8)+'" y="'+(y(value)+4)+'" text-anchor="end">'+esc(number(value))+'</text>';
    }).join('');
    const marks=selected.map(row=>{
      const title=human(row.partition)+' · '+row.catchment_id+' · observed '+number(row.observed)+' · modeled '+number(row.modeled)+' '+units[parameter];
      return row.partition==='validation'?'<rect x="'+(x(row.observed)-3.5)+'" y="'+(y(row.modeled)-3.5)+'" width="7" height="7" class="calibration-validation-mark"><title>'+esc(title)+'</title></rect>':
        '<circle cx="'+x(row.observed)+'" cy="'+y(row.modeled)+'" r="3.5" class="calibration-fit-mark"><title>'+esc(title)+'</title></circle>';
    }).join('');
    return '<figure class="calibration-scatter"><figcaption>'+esc(human(parameter))+' <small>'+esc(units[parameter])+'</small></figcaption><svg viewBox="0 0 '+width+' '+height+'" role="img" aria-label="'+esc(human(parameter))+' observed versus selected modeled annual load. Circles are calibration groups; squares are validation groups.">'+ticks+
      '<path d="M '+left+' '+top+' V '+(height-bottom)+' H '+(width-right)+'" class="calibration-axis"/><line x1="'+x(0)+'" y1="'+y(0)+'" x2="'+x(max)+'" y2="'+y(max)+'" class="calibration-equality"/>'+marks+
      '<text x="'+(left+(width-left-right)/2)+'" y="'+(height-10)+'" text-anchor="middle">Observed annual load</text><text x="15" y="'+(top+(height-top-bottom)/2)+'" text-anchor="middle" transform="rotate(-90 15 '+(top+(height-top-bottom)/2)+')">Modeled annual load</text></svg></figure>';
  }
  function renderReport(){
    const {report,view}=activeReport;
    const selected=view.ranking.find(row=>row.run_id===report.selected_run_id);
    const independent=(view.groups??[]).filter(group=>group.partition==='validation').length;
    return header(view.title||report.title,report.selected_run_id?'Original observations and completed native model runs. Lower calibration loss selects the retained parameter profile; validation describes that selected profile on the reserved catchment groups.':'The retained candidate outcomes identify the observations and native catchment support needed to complete parameter selection.',
      button('back','All calibrations')+button('plan','Open selection',report.plan_id)+button('export','Export complete results',report.id,true))+
      '<div class="cards">'+[
        ['Selected parameter profile',report.selected_run_id?(selected?.title||named('profiles',report.selected_profile_id)):'No eligible candidate',report.selected_run_id?'Native run '+short(report.selected_run_id):'Inspect the retained candidate outcomes below.'],
        ['Calibration loss',number(selected?.objective_score),'Saved pollutant weights and calibration-only normalization.'],
        ['Validation groups',number(independent),independent?'Assessment: '+human(view.validation_state):'All selected groups were used for calibration.'],
        ['Non-dominated profiles',number(view.pareto_run_ids?.length),'Candidate tradeoffs retained across pollutant metrics.'],
      ].map(([title,value,note])=>'<div class="card"><h3>'+esc(title)+'</h3><strong class="calibration-card-value">'+esc(value)+'</strong><p>'+esc(note)+'</p></div>').join('')+'</div>'+
      (view.observations.length?section('Observed and modeled annual loads','The dashed diagonal marks equal observed and modeled load. Circles show calibration catchments; outlined squares show validation catchments.',
        '<div class="calibration-plots">'+pollutants.map(name=>scatter(view.observations,name)).join('')+'</div>'):'')+
      section('Results','Search and sort the retained rows; downloaded files contain the complete selection and results.',
        '<div class="calibration-tabs" role="tablist" aria-label="Calibration results">'+Object.entries(tabTitles).map(([key,title])=>'<button type="button" role="tab" aria-selected="'+(key===activeTab)+'" data-action="calibration-tab" data-tab="'+key+'">'+esc(title)+' <small>'+number((view[key]??[]).length)+'</small></button>').join('')+'</div>'+
        '<div class="calibration-table-controls">'+field('Find a result',input('calibration_result_search',query,'search','id="calibration-result-search" placeholder="Profile, catchment or pollutant"'))+'</div><div id="calibration-result-table">'+resultTable()+'</div>')+
      section('Original files and interpretation','The JSON record keeps the complete native references, source vintages, groups and every metric.',fileList(activeReport._downloads||[])+notesList(view.notes)+
        '<details class="technical"><summary>Original complete analysis record</summary><pre class="json-view">'+esc(pretty(report))+'</pre></details>');
  }
  function bindReport(){
    const search=$('#calibration-result-search',mounted);
    if(search)search.addEventListener('input',()=>{query=search.value;page=0;$('#calibration-result-table',mounted).innerHTML=resultTable();});
  }
  function taskActions(task){
    if(!task.action?.startsWith('calibration.')||task.state!=='complete')return '';
    const value=task.result??{};
    return '<div class="page-actions">'+(value.plan_id?button('plan','Open calibration selection',value.plan_id):'')+
      (value.report_id?button('report','Open calibration results',value.report_id):'')+'</div>';
  }
  async function dispatch(node){
    const action=node.dataset.action?.replace(/^calibration-/,''),id=node.dataset.id;
    if(action==='new')return newForm();
    if(action==='revise')return newForm(id);
    if(action==='plan')return openPlan(id);
    if(action==='report')return openReport(id);
    if(action==='back'){activeReport=null;return repaint();}
    if(action==='inspect-source')return inspectSource();
    if(action==='inspect-observation'){
      const observation=val('calibration_observation');
      if(!observation)throw Error('Choose the original observation edition.');
      return openItem('observations',observation);
    }
    if(action==='external-add'){$('#calibration-external-loads').insertAdjacentHTML('beforeend',externalRow());invalidatePreview();return;}
    if(action==='external-remove'){node.closest('.calibration-external-row').remove();invalidatePreview();return;}
    if(action==='filter-add'){$('#calibration-filters').insertAdjacentHTML('beforeend',filterRow());invalidatePreview();return;}
    if(action==='filter-remove'){node.closest('.calibration-filter-row').remove();invalidatePreview();return;}
    if(action==='analyze')return submitAction('calibration.analyze',{plan_id:id});
    if(action==='export')return submitAction('calibration.export',{report_id:id});
    if(action==='tab'){activeTab=node.dataset.tab;page=0;sortKey=columns[activeTab][0][0];query='';return repaint();}
    if(action==='sort'){sortDirection=sortKey===node.dataset.key?-sortDirection:1;sortKey=node.dataset.key;return repaint();}
    if(action==='page-previous'||action==='page-next'){
      page=Math.max(0,page+(action==='page-next'?1:-1));
      if(mounted)$('#calibration-result-table',mounted).innerHTML=resultTable();
      return;
    }
  }
  return {render,mount,detach,dispatch,taskActions};
}
