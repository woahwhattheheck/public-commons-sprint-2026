/* Saved water priorities → original monitoring design, costs and campaign. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=value=>Number.isFinite(Number(value))?Number(value).toLocaleString(undefined,{maximumFractionDigits:3}):'—';
const label=mode=>mode==='priority_weighted_area'?'Model priority × area':'Contribution overlap area';
const validId=value=>/^[0-9a-f]{64}$/.test(value||'');
const button=(action,title,extra='')=>'<button type="button" data-action="'+action+'" '+extra+'>'+esc(title)+'</button>';
const field=(title,body,note='',wide=false)=>'<label'+(wide?' class="full"':'')+'><span>'+esc(title)+'</span>'+body+(note?'<small>'+esc(note)+'</small>':'')+'</label>';
const input=(name,value='',attrs='')=>'<input name="'+name+'" value="'+esc(value)+'" '+attrs+'>';
const select=(name,rows,chosen='',required=true)=>'<select name="'+name+'"'+(required?' required':'')+'><option value="">Choose...</option>'+rows.map(([id,title])=>'<option value="'+esc(id)+'"'+(String(id)===String(chosen)?' selected':'')+'>'+esc(title)+'</option>').join('')+'</select>';
const object=(text,title)=>{let value;try{value=JSON.parse(text);}catch{throw Error(title+' must be a JSON object.');}if(!value||typeof value!=='object'||Array.isArray(value))throw Error(title+' must be a JSON object.');return value;};

export function attachReceivingWaterMonitoring(context){
  const {getState,api,endpoint,openForm,submitAction,detail,fileList}=context;
  let opening=0;
  const workspace=()=>getState()?.workspace_key;
  const data=()=>{const d=getState()?.data||{};return {...d,...(d.receiving_waters||{})};};
  const rows=()=>data().receiving_water_monitoring||[];
  const root=()=>document.querySelector('#operation-form');
  const value=(name,form=root())=>form?.querySelector('[name="'+name+'"]')?.value?.trim()||'';
  const sourceKey=choice=>choice?JSON.stringify({source_collection_id:choice.source_collection_id,source_id:choice.source_id}):'';
  function render(){
    const saved=rows();if(!saved.length)return '';
    return '<section class="water-section"><header><h2>Monitoring planning sources</h2><p>Saved water-study selections open directly in the original Monitoring design desk.</p></header><div class="water-table-scroll"><table><thead><tr><th>Planning source</th><th>Weight basis</th><th>State</th><th></th></tr></thead><tbody>'+
      saved.map(row=>'<tr><td><strong>'+esc(row.title)+'</strong><small>'+esc(row.id?.slice(0,12))+'</small></td><td>'+esc(label(row.mode))+'</td><td>'+esc(row.state)+'</td><td>'+
        button('water-monitoring-open','Inspect','data-id="'+esc(row.id)+'"')+
        (row.network_id?button('water-monitoring-network','Design a campaign','data-network-id="'+esc(row.network_id)+'" data-workspace="'+esc(workspace())+'"'):'')+'</td></tr>').join('')+
      '</tbody></table></div></section>';
  }
  async function open(id){
    if(!validId(id))throw Error('Choose a saved monitoring planning source.');
    const key=workspace(),ticket=++opening;
    const row=await api(endpoint('/api/receiving-waters/monitoring',{monitoring_id:id}));
    if(key!==workspace()||ticket!==opening)return;
    if(row.id!==id)throw Error('The saved planning source identity changed.');
    const body='<p>'+esc(label(row.mode))+' · '+esc(row.state)+'</p>'+
      '<p>The retained HUC geometry and downstream links define the planning network. Choose the campaign budget, costs, calendar and coverage assumptions in Monitoring design.</p>'+
      '<div class="water-actions">'+(row.network_id?button('water-monitoring-network','Open monitoring network','data-network-id="'+esc(row.network_id)+'" data-workspace="'+esc(key)+'"'):'')+'</div>'+
      '<h3>Planning source summary</h3><pre class="json-view">'+esc(JSON.stringify(row.summary||{},null,2))+'</pre>'+
      '<details><summary>Original selection and weight method</summary><pre class="json-view">'+esc(JSON.stringify({selection:row.identity?.selection||row.selection,method:row.method,plan_id:row.plan_id,analysis_id:row.analysis_id,source_collection_id:row.source_collection_id,network_id:row.network_id},null,2))+'</pre></details>'+
      '<h3>Complete planning source files</h3>'+fileList(row._downloads||[]);
    detail(row.title||'Monitoring planning source',body,{kind:'receiving-water-monitoring',id,state:row.state});
  }
  async function openNetwork(networkId,key=workspace()){
    if(!validId(networkId))throw Error('Choose the retained monitoring network.');
    if(key!==workspace())throw Error('Open this network in its original workspace.');
    if(typeof context.openDesk!=='function')throw Error('Open Monitoring design and choose the saved network.');
    document.querySelector('#detail-dialog')?.close();
    return context.openDesk('monitoring','openNetwork',{network_id:networkId,workspace_key:key});
  }
  function priorityChoices(analysis,subject){
    const files=subject?.metrics?.files||{},out=[];
    const runs=[analysis.baseline_run_id,...(analysis.alternative_run_ids||[])];
    for(const run of runs){
      const baseline=run===analysis.baseline_run_id;
      for(const statistic of ['current_priority','increased_export_priority','avoided_export_priority']){
        if(baseline&&statistic!=='current_priority')continue;
        const key=(baseline?'':run+'_')+statistic;
        if(!files[key])continue;
        const title=(baseline?'Baseline':('Alternative '+run.slice(0,12)))+' · '+({'current_priority':'current priority','increased_export_priority':'increased-export priority','avoided_export_priority':'avoided-export priority'}[statistic]);
        out.push([JSON.stringify({run_id:run,statistic}),title]);
      }
    }
    return out;
  }
  async function create(kind,id){
    if(!['plan','analysis'].includes(kind)||!validId(id))throw Error('Choose a saved source plan or completed model analysis.');
    const key=workspace(),ticket=++opening;
    const [catalog,selected]=await Promise.all([
      api(endpoint('/api/receiving-waters/catalog')),
      api(endpoint('/api/receiving-waters/'+kind,{[kind+'_id']:id}))
    ]);
    if(key!==workspace()||ticket!==opening)return;
    if(selected.id!==id||selected.state!=='complete')throw Error('Complete the selected water study before preparing its monitoring source.');
    const analysis=kind==='analysis'?selected:null;
    const plan=analysis?await api(endpoint('/api/receiving-waters/plan',{plan_id:analysis.plan_id})):selected;
    if(key!==workspace()||ticket!==opening)return;
    const originalCatchments=plan.identity?.selection?.catchments||{};
    const sources=(catalog.sources||[]).flatMap(c=>(c.entries||[]).filter(e=>e.kind==='vector').map(e=>[sourceKey({source_collection_id:c.id,source_id:e.id}),(e.title||e.id)+' / '+c.title]));
    const subjects=analysis?(analysis.subjects||[]).filter(s=>priorityChoices(analysis,s).length):[];
    if(analysis&&!subjects.length)throw Error('This analysis has no retained priority raster to use for monitoring design.');
    const initialSubject=subjects[0],subjectKey=s=>JSON.stringify({kind:s.kind,id:s.id});
    const areaChoices=analysis?
      field('Receiving area',select('water_monitor_subject',subjects.map(s=>[subjectKey(s),s.title+' / '+(s.kind==='family_union'?'Combined family':'Individual water')]),subjectKey(initialSubject)), 'The chosen saved subject defines the actual source area and raster support.',true)+
      field('Saved model priority',select('water_monitor_priority',priorityChoices(analysis,initialSubject),priorityChoices(analysis,initialSubject)[0][0]),'Planning weight is the sum of valid priority score × actual pixel hectares. The original normalization and run remain retained.',true):
      '<fieldset class="full"><legend>Receiving areas to include</legend><p>Overlapping contribution areas are combined once before calculating each HUC overlap.</p>'+
      (plan.receptors||[]).map(r=>'<label class="water-check"><input type="checkbox" name="water_monitor_receptors" value="'+esc(r.id)+'" checked><span>'+esc(r.title)+'</span></label>').join('')+'</fieldset>';
    const html='<div class="form-grid">'+
      field('Planning source title',input('water_monitor_title',(plan.title||'Receiving waters')+' — monitoring','required'),'',true)+
      areaChoices+
      '<fieldset class="full"><legend>Original catchment network</legend><div class="form-grid">'+
      field('Retained HUC source',select('water_monitor_catchments',sources,sourceKey(originalCatchments)), 'Keep the complete original HUC network. Catchments outside the selected water scope retain their routing with zero target weight.',true)+
      field('Native layer',input('water_monitor_layer',originalCatchments.layer||''),'Leave empty for a single-layer source.')+
      field('HUC ID field',input('water_monitor_id_field',originalCatchments.id_field||'huc12','required'))+
      field('Downstream ID field',input('water_monitor_downstream',originalCatchments.downstream_field||'tohuc','required'))+
      '</div></fieldset>'+
      '<fieldset class="full"><legend>Existing source stations (optional)</legend><div class="form-grid">'+
      field('Retained station source',select('water_monitor_stations',sources,'',false),'Actual points can be bound to planned visits in Monitoring design.',true)+
      field('Native station layer',input('water_monitor_station_layer'))+
      field('Station ID field',input('water_monitor_station_id','site_no'))+
      field('Station HUC field',input('water_monitor_station_huc'),'Leave empty to use original point-in-polygon membership.')+
      field('Verified outlet field',input('water_monitor_station_outlet'),'Optional original Boolean assertion; outlet placement is never inferred.')+
      field('Explicit boundary assignments','<textarea name="water_monitor_assignments" rows="3" spellcheck="false">{}</textarea>','Optional JSON mapping original station IDs to covering HUC IDs.',true)+
      '</div></fieldset>'+
      '<p class="full water-note">'+(analysis?'Model-weighted coverage is a planning objective; physical exports and measurement units stay with the original analysis.':'Area coverage uses the selected contribution geometry and its projected area method.')+' Sampling locations remain the retained source station points. Opening the network starts candidate exclusions outside this water scope; review or change them under Advanced constraints. Campaign costs and calendar are entered in the existing design desk.</p></div>';
    let form;
    openForm('Prepare monitoring from this water study','Save the complete HUC planning source and its original monitoring network, then compare budgets and create a campaign.',
      html,'Prepare monitoring network',()=>{
        if(key!==workspace()||form!==root())throw Error('Reopen this planning form in its original workspace.');
        const catchments=object(value('water_monitor_catchments',form),'Catchment source');
        catchments.id_field=value('water_monitor_id_field',form);catchments.downstream_field=value('water_monitor_downstream',form);
        const layer=value('water_monitor_layer',form);if(layer)catchments.layer=layer;
        const selection={title:value('water_monitor_title',form),mode:analysis?'priority_weighted_area':'contribution_area',plan_id:plan.id,catchments};
        if(!selection.title||!catchments.id_field||!catchments.downstream_field)throw Error('Enter the title and original catchment field names.');
        if(analysis){
          selection.analysis_id=analysis.id;selection.subject=object(value('water_monitor_subject',form),'Receiving subject');
          Object.assign(selection,object(value('water_monitor_priority',form),'Priority raster'));
          const original=subjects.find(s=>subjectKey(s)===JSON.stringify(selection.subject));
          if(!original||!priorityChoices(analysis,original).some(([choice])=>choice===JSON.stringify({run_id:selection.run_id,statistic:selection.statistic})))throw Error('Choose a priority raster from the saved subject.');
        }else{
          selection.receptor_ids=[...form.querySelectorAll('[name="water_monitor_receptors"]:checked')].map(node=>node.value);
          if(!selection.receptor_ids.length)throw Error('Select at least one original receiving area.');
        }
        const station=value('water_monitor_stations',form);
        if(station){
          const stations=object(station,'Station source');stations.id_field=value('water_monitor_station_id',form);
          if(!stations.id_field)throw Error('Enter the original station ID field.');
          for(const[name,fieldName]of [['water_monitor_station_layer','layer'],['water_monitor_station_huc','huc_field'],['water_monitor_station_outlet','outlet_field']]){const v=value(name,form);if(v)stations[fieldName]=v;}
          stations.assignments=object(value('water_monitor_assignments',form)||'{}','Station boundary assignments');
          selection.stations=stations;
        }
        return submitAction('receiving.water.monitoring',selection);
      },()=>{
        form=root();
        const subjectInput=form.querySelector('[name="water_monitor_subject"]');
        subjectInput?.addEventListener('change',()=>{
          const chosen=subjects.find(s=>subjectKey(s)===subjectInput.value);
          const choices=chosen?priorityChoices(analysis,chosen):[];
          const target=form.querySelector('[name="water_monitor_priority"]');
          target.innerHTML=choices.map(([id,title])=>'<option value="'+esc(id)+'">'+esc(title)+'</option>').join('');
        });
      });
  }
  function dispatch(node){
    const action=node.dataset.action;
    if(action==='water-monitoring-new')return create(node.dataset.kind,node.dataset.id);
    if(action==='water-monitoring-open')return open(node.dataset.id);
    if(action==='water-monitoring-network')return openNetwork(node.dataset.networkId,node.dataset.workspace);
    throw Error('Choose a supported monitoring planning operation.');
  }
  return {render,open,create,openNetwork,dispatch};
}
