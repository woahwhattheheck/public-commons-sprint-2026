import {createCalibrationReviews} from './calibration_review.mjs';
import {createCalibrationMaps} from './calibration_maps.mjs';
import {analyzeCalibrationDesign,calibrationDesignHTML} from './calibration_design.mjs';
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

export function createCalibrationDesk(host){return attachCalibration(host);}

export function attachCalibration({getState,api,endpoint,openForm,submitAction,detail,fileList,openItem,showTask,toast,openDelivery}){
  let mounted=null,lastMarkup=null,generation=0,activeReport=null,activeTab='ranking',page=0,query='',sortKey='rank',sortDirection=1;
  let activeDraft=null,previewResult=null,previewIdentity=null,formToken=null,formRequest=0;
  let activeUncertainty=null,resultRequest=0;
  const current = () => getState()?.workspace_key;
  const sourceData = () => getState()?.data ?? {};
  const calibrationData = () => sourceData().calibration ?? sourceData();
  const plans = () => calibrationData().calibration_plans ?? [];
  const reports = () => calibrationData().calibrations ?? [];
  const named = (kind,id) => {
    const row=(sourceData()[kind]??[]).find(item=>item.id===id);
    return row?.title||row?.metadata?.title||row?.spec?.title||short(id);
  };
  const draftKey = () => 'upstate-calibration-draft:'+current();
  const form = () => $('#operation-form');
  const mapsDesk=createCalibrationMaps({current,read,submitAction,openForm,fileList,detail,repaint,
    getReport:()=>activeReport,getUncertainty:()=>activeUncertainty,getData:calibrationData,
    openReport,openUncertainty,activate:()=>{if(!mounted)location.hash='calibration';else repaint();}});
  const reviewsDesk=createCalibrationReviews({current,read,submitAction,openForm,detail,fileList,openDelivery,openItem,
    getReport:()=>activeReport,getData:calibrationData,repaint,openReport,
    activate:()=>{mapsDesk.reset();activeUncertainty=null;if(!mounted)location.hash='calibration';}});
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
    if(reviewsDesk.active())return reviewsDesk.render();
    if(mapsDesk.active())return mapsDesk.render();
    if(activeReport?.workspace_key!==current()){activeReport=null;activeUncertainty=null;}
    if(activeUncertainty)return renderUncertainty();
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
    repaint();
  }
  function update(){
    const reviewChanged=reviewsDesk.sync();
    const mapChanged=mapsDesk.sync();
    if(!mounted)return;
    if(reviewsDesk.active()){if(reviewChanged)repaint();return;}
    if(mapsDesk.active()){if(mapChanged)repaint();return;}
    if(activeReport){
      if(activeReport.workspace_key!==current()){activeReport=null;activeUncertainty=null;}
      else{
        let changed=mapChanged;
        for(const [source,key] of [['calibration_uncertainties','uncertainties'],['calibration_maps','maps'],['calibration_reviews','reviews']]){
          const latest=calibrationData()[source];
          if(!Array.isArray(latest))continue;
          const rows=latest.filter(row=>row.calibration_id===activeReport.report.id);
          if(JSON.stringify(rows)!==JSON.stringify(activeReport[key]??[])){
            activeReport[key]=rows;changed=true;
          }
        }
        if(changed)repaint();
        return;
      }
    }
    const markup=render();
    if(markup!==lastMarkup){mounted.innerHTML=markup;lastMarkup=markup;}
  }
  function detach(){
    mounted=null;lastMarkup=null;
    generation++;mapsDesk.invalidate();reviewsDesk.invalidate();
  }
  function repaint(){
    if(!mounted)return;
    lastMarkup=render();mounted.innerHTML=lastMarkup;
    if(reviewsDesk.active())return;
    if(mapsDesk.active())mapsDesk.bind(mounted);
    else if(activeReport)bindReport();
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
  function candidateParameters(row){
    if(Array.isArray(row.available_parameters))return row.available_parameters;
    const retained=(sourceData().runs??[]).find(run=>run.id===(row.id||row.run_id));
    const models=row.selected_models??retained?.selection?.models;
    if(Array.isArray(models))return pollutants.filter(parameter=>models.includes(parameter==='sediment'?'sdr':'ndr'));
    return pollutants;
  }
  function sharedParameters(group,ids){
    const selected=ids.length?(group?.runs??[]).filter(row=>ids.includes(row.id||row.run_id)):group?.runs??[];
    if(!selected.length)return [];
    return pollutants.filter(parameter=>selected.every(row=>candidateParameters(row).includes(parameter)));
  }
  function candidateModels(row){
    return Array.isArray(row.selected_models)?row.selected_models.map(name=>String(name).toUpperCase()).join(' + '):'Original native run';
  }
  function candidateTable(catalog,draft){
    const group=catalog.candidate_groups.find(row=>groupKey(row)===draft.group);
    if(!group)return '<p class="note">Choose a retained grid and unchanged land-cover baseline.</p>';
    return table(['Use','Completed parameter profile','Native outputs','Model period',''],group.runs.map(row=>
      '<tr><td><input type="checkbox" name="calibration_candidates" value="'+esc(row.id||row.run_id)+'" '+(draft.selection.candidate_run_ids?.includes(row.id||row.run_id)?'checked':'')+' aria-label="Use '+esc(row.title)+'"></td><td><strong>'+esc(row.title||named('profiles',row.profile_id))+'</strong><small class="mono">'+esc(short(row.id||row.run_id))+'</small></td><td>'+esc(candidateModels(row))+'<small>'+esc(candidateParameters(row).map(human).join(', '))+'</small></td><td>'+esc(typeof row.model_period==='object'?pretty(row.model_period):row.model_period||'Recorded with profile')+'</td><td>'+nativeButton('runs',row.id||row.run_id,'Open run')+'</td></tr>'));
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
      if(scaleText&&weight>0){
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
    renderSourceDesign();
  }
  function renderSourceDesign(){
    const target=$('#calibration-design-review');if(!target)return;
    if(!previewResult){target.replaceChildren();return;}
    try{target.innerHTML=calibrationDesignHTML(analyzeCalibrationDesign(previewResult,collectSelection({split:true})));}
    catch(error){target.innerHTML='<p class="note">'+esc(error.message||String(error))+'</p>';}
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
  function periodWeighting(value){
    return value==='whole_years'||value==='elapsed_days'?value:null;
  }
  function observationWeighting(observation){
    return periodWeighting(observation?.metadata?.recommended_temporal_weighting)||
      periodWeighting(observation?.recommended_temporal_weighting)||'whole_years';
  }
  async function openForObservations(value){
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Choose a retained annual-observation binding.');
    const workspace=current();
    if(!workspace)throw Error('Open the original study before selecting its annual observations.');
    if(value.workspace_key&&value.workspace_key!==workspace)throw Error('Open the study that owns this observation binding.');
    const catchments=value.catchments;
    if(typeof value.observation_id!=='string'||!value.observation_id.trim()||
      !catchments||typeof catchments!=='object'||Array.isArray(catchments)||
      ['source_collection_id','source_id','id_field'].some(key=>typeof catchments[key]!=='string'||!catchments[key].trim()))
      throw Error('The saved annual binding needs its original observation and catchment source identities.');
    if(value.temporal_weighting!==undefined&&!periodWeighting(value.temporal_weighting))
      throw Error('Use the saved annual source’s whole_years or elapsed_days period weighting.');
    if(activeDraft?.workspace===workspace)captureDraft();
    const handoff=JSON.parse(JSON.stringify({observation_id:value.observation_id,catchments,
      ...(value.temporal_weighting?{temporal_weighting:value.temporal_weighting}:{}),
      ...(typeof value.title==='string'?{title:value.title.trim()}:{})}));
    return newForm(null,handoff);
  }
  async function newForm(planId=null,handoff=null){
    reviewsDesk.invalidate();mapsDesk.invalidate();
    const workspace=current(),request=++formRequest;
    const catalog=await read('catalog');
    if(current()!==workspace||request!==formRequest)return;
    if(!catalog.observations?.some(row=>row.admitted_count>0))throw Error('Retain an original observation edition with admitted annual load records first.');
    let draft=planId?null:savedDraft();
    if(planId){
      const packet=await read('plan',{id:planId});
      if(current()!==workspace||request!==formRequest)return;
      draft={workspace,selection:packet.plan.selection};
    }
    const selection=JSON.parse(JSON.stringify(draft?.selection??{schema:'upstate.calibration-selection/v1',title:'',candidate_run_ids:[],
      observation_id:'',catchments:{},objective:Object.fromEntries(pollutants.map(name=>[name,{weight:1}])),notes:[]}));
    let retainedFields=draft?.raw??null;
    const retainedPeriod=retainedFields?.find(row=>row.name==='calibration_temporal_weighting')?.value;
    const temporalExplicit=draft?.temporal_weighting_explicit??
      Boolean(planId||periodWeighting(retainedPeriod)||periodWeighting(selection.temporal_weighting));
    if(temporalExplicit&&periodWeighting(retainedPeriod))selection.temporal_weighting=retainedPeriod;
    if(handoff){
      const observation=catalog.observations.find(row=>(row.id||row.observation_id)===handoff.observation_id&&row.admitted_count>0);
      if(!observation)throw Error('This observation edition is not admitted in the current study.');
      const collection=(sourceData().sources??[]).find(row=>row.id===handoff.catchments.source_collection_id);
      if(!collection?.entries?.some(row=>row.id===handoff.catchments.source_id&&row.kind==='vector'))
        throw Error('Refresh the study to load the original catchment source for this binding.');
      const previousObservation=retainedFields?.find(row=>row.name==='calibration_observation')?.value||selection.observation_id;
      const changedObservation=previousObservation!==handoff.observation_id;
      selection.observation_id=handoff.observation_id;
      selection.catchments=handoff.catchments;
      const retainedTitle=retainedFields?.find(row=>row.name==='calibration_title')?.value;
      if(!String(retainedTitle??selection.title??'').trim())selection.title=handoff.title||observation.title||'Annual-load calibration';
      if(changedObservation){
        delete selection.observation_record_ids;
        delete selection.delivered_external_loads;
      }
      const rebound=new Set(['calibration_observation','calibration_collection','calibration_source',
        'calibration_layer','calibration_id_field','calibration_temporal_weighting']);
      retainedFields=retainedFields?.filter(row=>!rebound.has(row.name)&&
        !row.name.startsWith('calibration_filter_')&&
        !(changedObservation&&(row.name==='calibration_records'||row.name.startsWith('calibration_external_')))&&
        !(row.name==='calibration_title'&&!String(row.value).trim()))??null;
    }
    const observation=catalog.observations.find(row=>(row.id||row.observation_id)===selection.observation_id);
    if(!temporalExplicit)selection.temporal_weighting=handoff?.temporal_weighting||observationWeighting(observation);
    draft={...draft,workspace,selection,raw:retainedFields,temporal_weighting_explicit:temporalExplicit,
      remembered_weights:draft?.remembered_weights??{}};
    if(!catalog.candidate_groups?.length){
      if(handoff){try{sessionStorage.setItem('upstate-calibration-draft:'+workspace,JSON.stringify(draft));}catch{}}
      throw Error(handoff?'Observation and catchment choices are saved. Complete a native baseline run before preparing a calibration.':
        'Complete a native baseline run before preparing a calibration.');
    }
    const first=catalog.candidate_groups[0];
    const selectedGroup=catalog.candidate_groups.find(group=>group.runs.some(row=>selection.candidate_run_ids?.includes(row.id||row.run_id)));
    draft.group=draft.group||groupKey(selectedGroup||first);
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
      '<fieldset class="full"><legend>Completed candidate runs and profiles</legend><div id="calibration-candidates">'+candidateTable(catalog,draft)+'</div></fieldset>'+
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
      '<fieldset class="full"><legend>Parameter-selection objective</legend><p class="note">A zero weight excludes a pollutant from profile selection. Automatic normalization uses calibration observations only. Supply an explicit positive annual-load scale when the study requires one.</p><p class="note" id="calibration-output-support"></p>'+
      table(['Pollutant','Relative weight','Annual mass scale','Scale source or rationale'],pollutants.map(name=>'<tr><th scope="row">'+esc(human(name))+'<small>'+esc(units[name])+'</small></th><td>'+input('calibration_weight_'+name,objective[name]?.weight??(selection.observation_id?0:1),'number','min="0" step="any" required aria-label="'+name+' weight"')+'</td><td>'+input('calibration_scale_'+name,objective[name]?.normalization_scale??'','number','min="0" step="any" placeholder="From calibration observations" aria-label="'+name+' annual normalization scale"')+'</td><td>'+input('calibration_scale_reference_'+name,objective[name]?.scale_reference??'','text','aria-label="'+name+' scale source or rationale"')+'</td></tr>'))+'</fieldset>'+
      '<fieldset class="full"><legend>Calibration and validation groups</legend><p class="note" id="calibration-preview-note">Inspect the original catchments to assign calibration and validation groups.</p><div id="calibration-group-body"></div><div id="calibration-design-review" aria-live="polite"></div></fieldset>'+
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
          let currentSelection;
          try{currentSelection=collectSelection();}catch{return;}
          if(JSON.stringify(currentSelection)!==JSON.stringify(selected))return;
          renderPreview(value,selected);
          $('#form-progress').textContent='Catchment groups are ready. Choose the validation groups, then save the selection.';
          return;
        }
        const finalSelection=collectSelection({split:true});
        const sourceDesign=analyzeCalibrationDesign(previewResult,finalSelection);
        if(!sourceDesign.training_ready)throw Error('The calibration partition needs original references for every selected pollutant and a positive training normalization. Review Source support for this evaluation.');
        activeDraft.selection=finalSelection;retainDraft();
        const task=await submitAction('calibration.prepare',{selection:finalSelection});
        if(activeDraft?.workspace===workspace&&formToken===token){
          try{sessionStorage.removeItem('upstate-calibration-draft:'+workspace);}catch{}
          activeDraft=null;previewResult=null;previewIdentity=null;formToken=null;
        }
        return task;
      },()=>{
        const groupNode=$('[name="calibration_run_group"]',form());
        groupNode.addEventListener('change',()=>{
          activeDraft.group=groupNode.value;activeDraft.selection.candidate_run_ids=[];
          $('#calibration-candidates').innerHTML=candidateTable(catalog,activeDraft);
          const reference=$('[name="calibration_reference_run"]',form());
          if(reference)reference.outerHTML=select('calibration_reference_run',(catalog.candidate_groups.find(group=>groupKey(group)===activeDraft.group)?.runs??[]).map(row=>[row.id||row.run_id,row.title]),'',false);
          updateObjective();
        });
        $('[name="calibration_collection"]',form()).addEventListener('change',()=>{
          const node=$('[name="calibration_source"]',form());
          node.outerHTML=select('calibration_source',sourceRows(val('calibration_collection')).map(row=>[row.id,row.title]));
          $('#calibration-source-info').replaceChildren();
          invalidatePreview();
        });
        const observationNode=$('[name="calibration_observation"]',form());
        let objectiveInitialized=false;
        const updateObjective=()=>{
          const observed=catalog.observations.find(row=>(row.id||row.observation_id)===observationNode.value)?.parameters;
          const group=catalog.candidate_groups.find(row=>groupKey(row)===val('calibration_run_group'));
          const common=sharedParameters(group,chosen('calibration_candidates'));
          const parameters=Array.isArray(observed)?common.filter(parameter=>observed.includes(parameter)):common;
          for(const parameter of pollutants){
            const node=$('[name="calibration_weight_'+parameter+'"]',form());
            if(!parameters.includes(parameter)){
              if(!node.disabled&&(objectiveInitialized||!Object.hasOwn(activeDraft.remembered_weights,parameter)))activeDraft.remembered_weights[parameter]=node.value;
              node.value='0';node.disabled=true;
            }else{
              if(node.disabled)node.value=activeDraft.remembered_weights[parameter]??'1';
              node.disabled=false;
            }
            for(const suffix of ['scale_','scale_reference_']){
              const control=$('[name="calibration_'+suffix+parameter+'"]',form());
              if(control)control.disabled=!parameters.includes(parameter);
            }
          }
          const notice=$('#calibration-output-support');
          objectiveInitialized=true;
          if(notice)notice.textContent=parameters.length?
            'Common candidate outputs'+(Array.isArray(observed)?' with original annual observations':'')+': '+parameters.map(human).join(', ')+'. Other pollutant weights are zero.':
            'Choose candidates with a shared modeled pollutant and an original observation edition containing that annual load.';
          invalidatePreview();
        };
        const temporalNode=$('[name="calibration_temporal_weighting"]',form());
        const updatePeriod=()=>{
          if(activeDraft.temporal_weighting_explicit)return;
          const observation=catalog.observations.find(row=>(row.id||row.observation_id)===observationNode.value);
          temporalNode.value=observationNode.value===handoff?.observation_id&&handoff?.temporal_weighting?
            handoff.temporal_weighting:observationWeighting(observation);
        };
        const retainUserPeriod=()=>{activeDraft.temporal_weighting_explicit=true;};
        temporalNode.addEventListener('input',retainUserPeriod);
        temporalNode.addEventListener('change',retainUserPeriod);
        observationNode.addEventListener('change',()=>{updatePeriod();updateObjective();});
        $('#calibration-candidates').addEventListener('change',updateObjective);
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
            const node=value.name==='calibration_candidates'?
              nodes.find(candidate=>candidate.value===value.value):nodes[position];
            if(!node)continue;
            if(value.type==='checkbox')node.checked=value.checked;else node.value=value.value;
          }
        }
        updatePeriod();
        updateObjective();
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
      '<dl class="definition"><dt>State</dt><dd>'+stateBadge(progress)+'</dd><dt>Observation edition</dt><dd>'+esc(named('observations',selection.observation_id))+'</dd><dt>Candidate runs</dt><dd>'+number(selection.candidate_run_ids.length)+'</dd><dt>Distinct profiles</dt><dd>'+number(plan.distinct_profile_count??new Set((plan.candidates??[]).map(row=>row.profile_id)).size)+'</dd><dt>Modeled pollutants</dt><dd>'+esc((plan.predicted_parameters??Object.keys(selection.objective??{}).filter(parameter=>Number(selection.objective[parameter]?.weight)>0)).map(human).join(', '))+'</dd><dt>Catchment source</dt><dd>'+esc(named('sources',selection.catchments.source_collection_id))+' / '+esc(selection.catchments.source_id)+'</dd><dt>ID field</dt><dd>'+esc(selection.catchments.id_field)+'</dd></dl>'+
      section('Candidate native runs','Every candidate uses the same original baseline and grid.',table(['Profile','Native outputs','Run',''],(plan.candidates??[]).map(row=>'<tr><td>'+esc(row.title||named('profiles',row.profile_id))+'</td><td>'+esc(candidateModels(row))+'<small>'+esc(candidateParameters(row).map(human).join(', '))+'</small></td><td class="mono">'+esc(short(row.run_id||row.id))+'</td><td>'+nativeButton('runs',row.run_id||row.id,'Open native run')+'</td></tr>')))+
      section('Retained catchment groups','The saved split is used exactly as selected.',table(['Group','Catchments','Partition'],groups.map(group=>'<tr><td class="mono">'+esc(short(group.id))+'</td><td>'+esc((group.catchment_ids??[]).join(', '))+'</td><td>'+badge(selection.validation_group_ids?.includes(group.id)?'validation':'calibration')+'</td></tr>')))+
      notesList(selection.notes)+fileList(packet._downloads||[])+
      '<details class="technical"><summary>Original selection and analysis progress</summary><pre class="json-view">'+esc(pretty({selection,progress}))+'</pre></details>';
    detail(plan.selection.title,body,{kind:'calibration-plan',id});
  }
  async function openReport(id){
    reviewsDesk.reset();mapsDesk.reset();
    const request=++resultRequest;
    const packet=await read('report',{id});
    if(request!==resultRequest)return;
    activeUncertainty=null;activeReport=packet;activeTab='ranking';page=0;query='';sortKey='rank';sortDirection=1;
    $('#detail-dialog')?.close();
    if(!mounted){
      location.hash='calibration';
      return;
    }
    repaint();
  }
  function currentRows(){
    const view=activeUncertainty?.analysis??activeReport.view;
    let rows=activeUncertainty?uncertaintyRows(view,activeTab):view[activeTab]??[];
    rows=rows.filter(row=>!query||Object.values(row).map(value=>typeof value==='object'?pretty(value):String(value??'')).join(' ').toLowerCase().includes(query.toLowerCase()));
    rows=[...rows].sort((a,b)=>{
      const av=a[sortKey],bv=b[sortKey];
      if((av===null||av===undefined)&&(bv===null||bv===undefined))return 0;if(av===null||av===undefined)return 1;if(bv===null||bv===undefined)return -1;
      return (typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv)))*sortDirection;
    });
    return rows;
  }
  const columns={
    ranking:[['rank','Rank'],['title','Candidate profile'],['selected_models','Native models'],['objective_score','Calibration loss'],['status','Outcome'],['run_id','Native run']],
    metrics:[['partition','Partition'],['profile_title','Profile'],['parameter','Pollutant'],['units','Units'],['groups','Groups'],['n','Catchments'],['rmse','RMSE'],['mean_bias','Mean bias'],['nash_sutcliffe_efficiency','NSE'],['normalized_mse','Normalized MSE']],
    validation:[['parameter','Pollutant'],['units','Units'],['groups','Groups'],['n','Catchments'],['rmse','RMSE'],['mean_bias','Mean bias'],['nash_sutcliffe_efficiency','NSE']],
    observations:[['partition','Partition'],['group_id','Group'],['catchment_id','Catchment'],['parameter','Pollutant'],['units','Units'],['observed','Observed annual load'],['modeled','Selected modeled load'],['residual','Residual'],['records','Original records']],
    groups:[['id','Group'],['partition','Partition'],['catchment_ids','Catchments'],['station_ids','Stations'],['observation_count','Records'],['parameters','Pollutants']],
    envelope:[['partition','Partition'],['parameter','Pollutant'],['units','Units'],['group_id','Group'],['catchment_id','Catchment'],['observed_annual_mass','Observed load'],['minimum','Minimum candidate load'],['median','Median candidate load'],['maximum','Maximum candidate load'],['candidate_count','Candidate runs'],['distinct_profile_count','Distinct profiles'],['expected_profiles','Expected profiles']],
    stability:[['group_id','Omitted calibration group'],['state','Fold outcome'],['selected_run_id','Selected without group'],['selected_profile_id','Selected profile'],['same_as_full_selection','Run unchanged'],['same_profile_as_full_selection','Profile unchanged'],['objective_score','Calibration loss']],
    exclusions:[['run_id','Candidate run'],['observation_id','Observation'],['catchment_id','Catchment'],['parameter','Pollutant'],['reason','Reason']],
  };
  const tabTitles={ranking:'Profile ranking',metrics:'Physical fit',validation:'Held-out validation',observations:'Observed and modeled',groups:'Catchment groups',envelope:'Candidate envelope',stability:'Group stability',exclusions:'Exclusions'};
  function rowCell(row,key){
    const value=row[key];
    if(key==='run_id'&&value)return nativeButton('runs',value,short(value));
    if(key==='selected_run_id'&&value)return nativeButton('runs',value,short(value));
    if(key==='profile_id'||key==='selected_profile_id')return value?nativeButton('profiles',value,short(value)):'—';
    if(key==='same_as_full_selection'||key==='same_profile_as_full_selection')return value===true?'Yes':value===false?'No':'—';
    if(activeUncertainty&&(key==='state'||key==='first_tie_state'))return esc(sensitivityLabel(value));
    if(key==='selected_models'&&Array.isArray(value))return esc(value.map(name=>String(name).toUpperCase()).join(' + '));
    if(Array.isArray(value))return esc(value.map(item=>typeof item==='object'?pretty(item):item).join(', '));
    if(value&&typeof value==='object')return '<details><summary>Details</summary><pre class="json-view">'+esc(pretty(value))+'</pre></details>';
    if(['id','group_id'].includes(key))return '<span class="mono" title="'+esc(value)+'">'+esc(short(value))+'</span>';
    return number(value);
  }
  function resultTable(){
    const rows=currentRows(),size=40;
    page=Math.min(page,Math.max(0,Math.ceil(rows.length/size)-1));
    const selected=rows.slice(page*size,(page+1)*size),fields=(activeUncertainty?uncertaintyColumns:columns)[activeTab];
    const head='<thead><tr>'+fields.map(([key,label])=>'<th scope="col"><button type="button" data-action="calibration-sort" data-key="'+key+'" class="calibration-sort">'+esc(label)+(sortKey===key?(sortDirection===1?' ↑':' ↓'):'')+'</button></th>').join('')+'</tr></thead>';
    const body=selected.map(row=>'<tr>'+fields.map(([key])=>'<td>'+rowCell(row,key)+'</td>').join('')+'</tr>').join('');
    return '<div class="table-scroll"><table>'+head+'<tbody>'+body+'</tbody></table></div>'+
      (!rows.length?'<p class="calibration-empty">This selected result has no rows in '+esc((activeUncertainty?uncertaintyTitles:tabTitles)[activeTab].toLowerCase())+'.</p>':'')+
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
        ['Selected parameter profile',report.selected_run_id?(selected?.title||named('profiles',report.selected_profile_id)):'No eligible candidate',report.selected_run_id?candidateModels(selected||{selected_models:report.selected_models})+' · native run '+short(report.selected_run_id):'Inspect the retained candidate outcomes below.'],
        ['Candidate runs',number(view.candidate_count??report.candidate_count??view.ranking.length),number(view.distinct_profile_count??report.distinct_profile_count??new Set(view.ranking.map(row=>row.profile_id)).size)+' distinct parameter profiles with their original run identities.'],
        ['Calibration loss',number(selected?.objective_score),'Saved pollutant weights and calibration-only normalization.'],
        ['Validation groups',number(independent),independent?'Assessment: '+human(view.validation_state):'All selected groups were used for calibration.'],
        ['Non-dominated candidate runs',number(view.pareto_run_ids?.length),'Candidate tradeoffs retained across pollutant metrics.'],
      ].map(([title,value,note])=>'<div class="card"><h3>'+esc(title)+'</h3><strong class="calibration-card-value">'+esc(value)+'</strong><p>'+esc(note)+'</p></div>').join('')+'</div>'+
      (view.observations.length?section('Observed and modeled annual loads','The dashed diagonal marks equal observed and modeled load. Circles show calibration catchments; outlined squares show validation catchments.',
        '<div class="calibration-plots">'+pollutants.map(name=>scatter(view.observations,name)).join('')+'</div>'):'')+
      uncertaintyList()+
      (report.selected_run_id?mapsDesk.summary(report.id)+reviewsDesk.summary(report.id):'')+
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

  const uncertaintyTitles={
    pairwise:'Ranking sensitivity',reference_units:'Annual reference ranges',
    source_records:'Published standard errors',source_attribution:'Source contributions',selected_validation:'Selected validation',candidate_scores:'Nominal reproduction'
  };
  const uncertaintyColumns={
    pairwise:[['title','Challenger profile'],['selected_models','Native models'],['nominal_gap','Nominal loss gap'],
      ['minimum_gap','Minimum gap'],['maximum_gap','Maximum gap'],['numerical_tolerance','Numerical tolerance'],['state','Sensitivity outcome'],
      ['first_tie_standard_errors','First tie (standard errors)'],['first_tie_state','Tie threshold'],
      ['missing_record_ids','Missing source errors'],['run_id','Native run']],
    reference_units:[['partition','Partition'],['catchment_id','Catchment'],['group_id','Group'],
      ['parameter','Pollutant'],['units','Units'],['observed_annual_mass','Original annual load'],
      ['lower_reference','Lower reference'],['upper_reference','Upper reference'],['state','Coverage'],
      ['objective_weight','Fixed objective weight'],['missing_record_ids','Missing source errors']],
    source_records:[['record_id','Original record'],['station_id','Station'],['parameter','Pollutant'],
      ['original_value','Published value'],['unit','Published unit'],['source_standard_error','Published standard error'],
      ['source_standard_error_unit','Standard-error unit'],['annual_mass','Annual comparison load'],
      ['standard_error','Annual standard error'],['comparison_units','Comparison units'],
      ['lower_reference','Lower reference'],['upper_reference','Upper reference'],['state','Coverage'],['issues','Source issues']],
    selected_validation:[['catchment_id','Validation catchment'],['group_id','Reserved group'],['parameter','Pollutant'],
      ['units','Units'],['observed_annual_mass','Original annual load'],['predicted_annual_mass','Selected modeled load'],
      ['lower_reference','Lower reference'],['upper_reference','Upper reference'],
      ['minimum_residual','Minimum selected residual'],['maximum_residual','Maximum selected residual'],
      ['state','Coverage'],['missing_record_ids','Missing source errors']],
    source_attribution:[['run_id','Challenger run'],['record_id','Original record'],['station_id','Station'],
      ['parameter','Pollutant'],['comparison_units','Source units'],['gap_coefficient','Gap coefficient'],
      ['standard_error','Standard error'],['minimum_gap_change','Minimum gap change'],['maximum_gap_change','Maximum gap change'],
      ['minimum_endpoint','Source at minimum gap'],['maximum_endpoint','Source at maximum gap']],
    candidate_scores:[['rank','Nominal rank'],['title','Profile'],['selected_models','Native models'],
      ['original_objective_score','Original calibration loss'],['reproduced_objective_score','Reproduced loss'],
      ['absolute_difference','Absolute difference'],['numerical_tolerance','Numerical tolerance'],['state','Reproduction'],['run_id','Native run']]
  };
  const sensitivityText={
    strictly_stable:'Selection remains strictly preferred',
    selected_strictly_preferred:'Original selection strictly preferred',
    rank_reversal_possible:'A challenger can outperform the original selection',
    tie_possible:'A tie is possible within the source ranges',
    nominal_tie:'Original scores are tied',
    equivalent_predictions:'Identical predictions over the objective',
    incomplete_uncertainty:'Published source errors are incomplete',
    single_candidate:'One eligible candidate',
    complete:'Complete published-error coverage',
    partial_uncertainty:'Partial published-error coverage',
    available:'Finite first-tie threshold',
    beyond_finite_multiplier:'Tie threshold exceeds finite numerical range',
    never_within_nonnegative_source_box:'No tie within any finite source multiplier'
  };
  function sensitivityLabel(value){return sensitivityText[value]||human(value);}
  function uncertaintyRows(analysis,key){
    if(key==='source_attribution')return (analysis.pairwise??[]).flatMap(row=>(row.source_attribution??[]).map(item=>({...item,run_id:row.run_id,profile_id:row.profile_id})));
    return analysis[key]??[];
  }
  function uncertaintyList(){
    const rows=activeReport?.uncertainties??[];
    const start=activeReport?.report?.selected_run_id?
      button('uncertainty-new','Analyze published observation errors',activeReport.report.id,true):'';
    return section('Published observation uncertainty',
      'Use the standard errors retained with the original annual loads to examine the selected profile’s ranking. Native predictions, pollutant weights and calibration scales remain fixed.',
      '<div class="section-body"><div class="page-actions">'+start+'</div></div>'+
      (rows.length?table(['Retained analysis','Published-error multiplier','Selection sensitivity','Source coverage',''],
        rows.map(row=>'<tr><td>'+esc(when(row.created_at))+'<small class="mono">'+esc(short(row.id))+'</small></td><td>'+number(row.standard_errors)+'</td><td>'+esc(sensitivityLabel(row.selection_sensitivity?.state||row.state))+'</td><td>'+number(row.coverage?.records_with_standard_error)+' / '+number(row.coverage?.source_record_count)+' original records</td><td>'+button('uncertainty','Open sensitivity',row.id)+button('uncertainty-export','Export',row.id)+'</td></tr>')):
        '<p class="calibration-empty">A completed sensitivity analysis will appear here beside this unchanged nominal calibration.</p>'));
  }
  function uncertaintyForm(reportId){
    reviewsDesk.invalidate();mapsDesk.invalidate();
    if(!reportId)throw Error('Open a completed calibration before analyzing its observation errors.');
    const workspace=current(),request=++formRequest;
    const retained=activeUncertainty?.analysis;
    openForm('Observation uncertainty sensitivity',
      'Compare the original selected profile with every eligible challenger using the standard errors published with the retained observation records.',
      '<div class="calibration-form"><div class="form-grid">'+
      field('Published standard-error multiplier',input('calibration_uncertainty_multiplier',
        retained?.calibration_id===reportId?retained.standard_errors:1,'number','min="0" step="any" required'),
        '1 uses one published standard error. 0 reproduces the nominal ranking. Nonnegative source bounds are retained; absent errors remain visible.',true)+
      '<div class="full calibration-source"><p>The signed gap is challenger loss minus selected loss. Positive values favor the original selection. The first-tie multiplier records the earliest possible tie under the same fixed objective.</p><p>The analysis uses the original marginal error ranges and their shared source-record identities. It does not assign a probability to a reversal or replace the saved nominal selection. Validation ranges remain descriptive.</p></div></div></div>',
      'Analyze source uncertainty',async()=>{
        if(current()!==workspace||request!==formRequest)throw Error('The selected study or calibration form changed. Reopen this analysis.');
        const text=val('calibration_uncertainty_multiplier').trim(),standard_errors=Number(text);
        if(!text||!Number.isFinite(standard_errors)||standard_errors<0)throw Error('Enter a finite nonnegative standard-error multiplier.');
        return submitAction('calibration.uncertainty',{report_id:reportId,standard_errors});
      });
  }
  async function openUncertainty(id){
    reviewsDesk.reset();mapsDesk.reset();
    const workspace=current(),request=++resultRequest;
    const packet=await read('uncertainty',{id});
    if(request!==resultRequest||current()!==workspace)return;
    const nominal=activeReport?.report?.id===packet.analysis.calibration_id?
      activeReport:await read('report',{id:packet.analysis.calibration_id});
    if(request!==resultRequest||current()!==workspace)return;
    activeReport=nominal;activeUncertainty=packet;activeTab='pairwise';page=0;query='';sortKey='nominal_gap';sortDirection=1;
    $('#detail-dialog')?.close();
    if(!mounted){location.hash='calibration';return;}
    repaint();
  }
  function gapPlot(rows){
    const usable=rows.filter(row=>Number.isFinite(row.minimum_gap)&&Number.isFinite(row.maximum_gap)).slice(0,24);
    if(!usable.length)return '';
    const low=Math.min(0,...usable.map(row=>row.minimum_gap)),high=Math.max(0,...usable.map(row=>row.maximum_gap));
    const span=high-low||1,min=low-span*.04,max=high+span*.04;
    const width=960,left=260,right=30,rowHeight=34,top=40,height=top+usable.length*rowHeight+48;
    const x=value=>left+(width-left-right)*(value-min)/(max-min);
    const ticks=[min,0,max].filter((value,index,all)=>all.indexOf(value)===index).map(value=>
      '<line x1="'+x(value)+'" y1="'+top+'" x2="'+x(value)+'" y2="'+(height-42)+'" class="'+(value===0?'calibration-gap-zero':'calibration-grid')+'"/><text x="'+x(value)+'" y="'+(height-20)+'" text-anchor="middle">'+esc(number(value))+'</text>').join('');
    const marks=usable.map((row,index)=>{
      const y=top+index*rowHeight+16;
      const title=(row.title||short(row.run_id))+': '+number(row.minimum_gap)+' to '+number(row.maximum_gap)+
        '; nominal '+number(row.nominal_gap)+'. '+sensitivityLabel(row.state);
      return '<g><title>'+esc(title)+'</title><text x="'+(left-12)+'" y="'+(y+4)+'" text-anchor="end">'+esc((row.title||short(row.run_id)).slice(0,33))+'</text>'+
        '<line x1="'+x(row.minimum_gap)+'" y1="'+y+'" x2="'+x(row.maximum_gap)+'" y2="'+y+'" class="calibration-gap-range"/>'+
        '<path d="M '+x(row.minimum_gap)+' '+(y-5)+' v 10 M '+x(row.maximum_gap)+' '+(y-5)+' v 10" class="calibration-gap-range"/>'+
        (Number.isFinite(row.nominal_gap)?'<circle cx="'+x(row.nominal_gap)+'" cy="'+y+'" r="3.5" class="calibration-fit-mark"/>':'')+'</g>';
    }).join('');
    return '<figure class="calibration-gap-plot"><figcaption>Challenger loss minus the original selected loss</figcaption>'+
      '<svg viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Ranges for challenger objective loss minus the original selected loss. Values to the right of zero favor the original selected profile.">'+ticks+marks+'</svg><p>Bars show the retained source-error range; dots show the nominal gap. '+(rows.length>24?'The plot shows the first 24 finite ranges; the table and downloads retain every comparison.':'Every finite comparison is shown; missing ranges remain in the table.')+'</p></figure>';
  }
  function renderUncertainty(){
    const {analysis,title}=activeUncertainty,coverage=analysis.coverage??{},sensitivity=analysis.selection_sensitivity??{};
    const notes=Array.isArray(analysis.interpretation)?analysis.interpretation:
      analysis.interpretation?[analysis.interpretation]:[];
    return header(title||'Observation uncertainty sensitivity',
      'Published observation errors applied to the original completed calibration. The nominal selected profile and all native model outputs remain retained.',
      button('uncertainty-nominal','Nominal calibration',analysis.calibration_id)+
      button('uncertainty-new','Change source-error multiplier',analysis.calibration_id)+
      button('uncertainty-export','Export sensitivity package',analysis.id,true)+button('uncertainty','Refresh retained files',analysis.id))+
      '<div class="cards">'+[
        ['Selection sensitivity',sensitivityLabel(sensitivity.state||analysis.state),'Signed gaps compare each challenger against the original selected run.'],
        ['Source-error multiplier',number(analysis.standard_errors),'Multiples of each original published standard error, with nonnegative load bounds.'],
        ['Published source errors',number(coverage.records_with_standard_error)+' / '+number(coverage.source_record_count),'Missing errors remain explicit in each affected comparison.'],
        ['Calibration reference coverage',number(coverage.covered_calibration_units)+' / '+number(coverage.calibration_units),'Catchment/pollutant references with retained source uncertainty.'],
        ['Compared challengers',number(sensitivity.compared_candidate_count),number(sensitivity.distinct_profile_count)+' distinct parameter profiles.'],
      ].map(([label,value,note])=>'<div class="card"><h3>'+esc(label)+'</h3><strong class="calibration-card-value">'+esc(value)+'</strong><p>'+esc(note)+'</p></div>').join('')+'</div>'+
      section('Ranking under published observation errors',
        'A positive challenger-minus-selected gap favors the original selection. An interval crossing zero admits a tie or reversal within the declared marginal source ranges. Shared original records retain one perturbation across all references.',
        '<div class="section-body"><p><strong>'+esc(sensitivityLabel(sensitivity.state||analysis.state))+'</strong></p>'+
        '<p>The first-tie multiplier is calculated with the same fixed pollutant weights and calibration scales. Numerical comparison tolerances remain visible with each gap. The calculation is a deterministic sensitivity range; a possible reversal is not a probability or a new profile selection.</p>'+
        gapPlot(analysis.pairwise??[])+'</div>')+
      mapsDesk.summary(analysis.calibration_id,analysis.id)+
      section('Retained sensitivity results','Search and sort complete candidate comparisons, source records and reference ranges. Held-out validation units appear only as descriptive reference bands.',
        '<div class="calibration-tabs" role="tablist" aria-label="Observation uncertainty results">'+Object.entries(uncertaintyTitles).map(([key,label])=>'<button type="button" role="tab" aria-selected="'+(key===activeTab)+'" data-action="calibration-tab" data-tab="'+key+'">'+esc(label)+' <small>'+number(uncertaintyRows(analysis,key).length)+'</small></button>').join('')+'</div>'+
        '<div class="calibration-table-controls">'+field('Find a source or comparison',input('calibration_result_search',query,'search','id="calibration-result-search" placeholder="Profile, station, source record or pollutant"'))+'</div><div id="calibration-result-table">'+resultTable()+'</div>')+
      section('Source methods and retained files','The complete records preserve the published errors, nominal objective reproduction, fixed normalization and exact original record identities.',
        fileList(activeUncertainty._downloads||[])+notesList(notes)+
        '<details class="technical"><summary>Coverage, fixed objective and original source identity</summary><pre class="json-view">'+esc(pretty({coverage,objective:analysis.objective,normalization:analysis.normalization,temporal_method:analysis.temporal_method,selected_validation:analysis.selected_validation,nominal_reproduction:analysis.nominal_reproduction,source_stamp:analysis.source_stamp,references:analysis.references}))+'</pre></details>');
  }

  function taskActions(task){
    if(!task.action?.startsWith('calibration.')||task.state!=='complete')return '';
    const value=task.result??{};
    return '<div class="page-actions">'+(value.plan_id?button('plan','Open calibration selection',value.plan_id):'')+
      (value.report_id?button('report','Open calibration results',value.report_id):'')+
      (value.uncertainty_id?button('uncertainty','Open observation sensitivity',value.uncertainty_id):'')+
      (value.map_id?button('maps-open','Open catchment residual maps',value.map_id):'')+
      (value.calibration_review_id?button('review-open','Open complete review',value.calibration_review_id):'')+
      (value.calibration_report_source_id?button('review-source-delivery','Open delivery with original review',value.calibration_report_source_id):'')+'</div>';
  }
  async function dispatch(node){
    if(node.dataset.action?.startsWith('calibration-review-')){resultRequest++;return reviewsDesk.dispatch(node);}
    if(node.dataset.action?.startsWith('calibration-maps-')){reviewsDesk.reset();resultRequest++;return mapsDesk.dispatch(node);}
    const action=node.dataset.action?.replace(/^calibration-/,''),id=node.dataset.id;
    if(action==='new')return newForm();
    if(action==='revise')return newForm(id);
    if(action==='plan')return openPlan(id);
    if(action==='report')return openReport(id);
    if(action==='back'){reviewsDesk.reset();mapsDesk.reset();activeReport=null;activeUncertainty=null;resultRequest++;return repaint();}
    if(action==='uncertainty-new')return uncertaintyForm(id);
    if(action==='uncertainty')return openUncertainty(id);
    if(action==='uncertainty-nominal')return openReport(id);
    if(action==='uncertainty-export')return submitAction('calibration.uncertainty.export',{uncertainty_id:id});
    if(action==='design-holdout'){
      if(!previewResult||!isCurrentDraft(formToken))throw Error('Inspect the original catchments in the current draft first.');
      const review=analyzeCalibrationDesign(previewResult,collectSelection({split:true}));
      const choice=review.single_group_holdouts.find(row=>row.held_group_id===id);
      if(!choice?.training_ready)throw Error('This holdout has no complete training source support.');
      for(const node of $$('[data-calibration-group]',form())){
        const label=$('[data-calibration-group-label="'+CSS.escape(node.dataset.calibrationGroup)+'"]',form()).value.trim();
        node.value=label===id?'validation':'calibration';
      }
      captureDraft();
      $('#calibration-design-review')?.scrollIntoView({block:'nearest'});
      return;
    }
    if(action==='design-download'){
      if(!previewResult||!isCurrentDraft(formToken))throw Error('Inspect the original catchments in the current draft first.');
      const review=analyzeCalibrationDesign(previewResult,collectSelection({split:true}));
      const url=URL.createObjectURL(new Blob([JSON.stringify(review,null,2)+'\n'],{type:'application/json'}));
      const anchor=document.createElement('a');anchor.href=url;anchor.download='calibration-source-design.json';anchor.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);return;
    }
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
    if(action==='tab'){activeTab=node.dataset.tab;page=0;sortKey=(activeUncertainty?uncertaintyColumns:columns)[activeTab][0][0];query='';return repaint();}
    if(action==='sort'){sortDirection=sortKey===node.dataset.key?-sortDirection:1;sortKey=node.dataset.key;return repaint();}
    if(action==='page-previous'||action==='page-next'){
      page=Math.max(0,page+(action==='page-next'?1:-1));
      if(mounted)$('#calibration-result-table',mounted).innerHTML=resultTable();
      return;
    }
  }
  async function openForReview(selection){
    const workspace=current();
    if(!selection||selection.workspace_key!==workspace||!/^[0-9a-f]{64}$/.test(selection.review_id||''))throw Error('Open a retained calibration review from the current workspace.');
    const revision=++resultRequest;
    await reviewsDesk.open(selection.review_id);
    if(current()!==workspace)throw Error('The workspace changed while opening this original review.');
    if(revision!==resultRequest)return;
    if(selection.preview&&reviewsDesk.active())return reviewsDesk.dispatch({dataset:{action:'calibration-review-preview',id:selection.review_id}});
    return {workspace_key:workspace,review_id:selection.review_id};
  }
  return {render,mount,update,detach,dispatch,taskActions,openForObservations,openForReview};
}
