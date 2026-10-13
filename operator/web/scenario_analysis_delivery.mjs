import {nativeModelVersionLabel} from './native_versions.mjs';
/** Original scenario analysis -> original seven-family GIS delivery. */
const rows=value=>Array.isArray(value)?value:[];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=value=>String(value??'').slice(0,12);
const clone=value=>JSON.parse(JSON.stringify(value));
const button=(action,title,extra='')=>'<button type="button" data-action="analysis-delivery-'+esc(action)+'" '+extra+'>'+esc(title)+'</button>';
const issues=values=>rows(values).length?'<ul>'+rows(values).map(row=>'<li>'+esc(row.message)+(row.run_id?' (run '+esc(short(row.run_id))+')':'')+'</li>').join('')+'</ul>':'';
const table=(columns,values)=>'<div class="table-scroll"><table class="analysis-table"><thead><tr>'+
 columns.map(value=>'<th scope="col">'+esc(value)+'</th>').join('')+'</tr></thead><tbody>'+
 values.map(row=>'<tr>'+row.map(value=>'<td>'+esc(value)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';

export function createAnalysisDelivery({getState,api,endpoint,openDelivery,openReceivingPlan,openItem,onChange=()=>{}}){
  const cache=new Map(),pending=new Map(),errors=new Map(),plans=new Map();
  const workspace=()=>getState()?.workspace_key||'';
  const key=record=>workspace()+':'+record.id;
  function get(record){return cache.get(key(record));}
  async function load(record,{fresh=false}={}){
    if(!record?.id||record.state!=='complete')throw Error('Open a completed original scenario analysis.');
    const ws=workspace(),identity=key(record);
    if(pending.has(identity))return pending.get(identity);
    if(!fresh&&cache.has(identity))return cache.get(identity);
    errors.delete(identity);
    const request=api(endpoint('/api/scenario-analysis-delivery/selection',{analysis_id:record.id})).then(value=>{
      if(value.workspace_key!==ws||value.source_analysis?.analysis_id!==record.id)throw Error('The original delivery continuation belongs to another saved selection.');
      cache.set(identity,value);return value;
    }).catch(error=>{errors.set(identity,error.message);throw error;})
      .finally(()=>{pending.delete(identity);if(workspace()===ws)onChange();});
    pending.set(identity,request);onChange();return request;
  }
  function render(record){
    const identity=key(record),value=get(record),loading=pending.has(identity),error=errors.get(identity);
    const refresh=button('refresh',loading?'Reading original selection…':'Refresh release selection',loading?'disabled':'');
    if(!value)return '<section class="section analysis-section"><h2>Original GIS delivery</h2><p>Continue this saved analysis into the original scientific report and GIS package. The original map builder checks its retained native cohort and source choices.</p>'+
      (error?'<p role="alert">'+esc(error)+'</p>':'')+refresh+'</section>';
    const binding=value.source_analysis,selectedPlan=plans.get(identity)||'';
    const choices=rows(value.prepared_plans);
    const plan=choices.find(row=>row.id===selectedPlan);
    const releaseRows=rows(value.releases).map(row=>'<tr><td>'+esc(row.title)+'</td><td>'+esc(row.state)+'</td><td>'+esc(short(row.id))+'</td><td>'+
      button('release','Open original delivery','data-id="'+esc(row.id)+'"')+'</td></tr>').join('');
    const cases=table(['Native case','Role','Grid','Profile','Saved compared native models','Saved last run runtime','Requested InVEST'],rows(value.cases).map(row=>{
      const saved=rows(record.runs).find(run=>run.id===(row.run_id||row.id));
      const versions=saved?.model_versions||row.saved_model_versions;
      const provenance=saved?.native_version||row.saved_native_version||{};
      const label=versions?nativeModelVersionLabel({...saved,model_versions:versions}):
        ((provenance.comparison_version||provenance.observed||provenance.requested||'Not retained')+
         ' · original saved run-level provenance');
      return [row.title,row.role,short(row.grid_id),short(row.profile_id),label,
        provenance.observed||'Not retained',provenance.requested||'Not retained'];
    }));
    const capRows=Object.entries(binding.normalization?.caps||{}).map(([name,cap])=>[
      name.replaceAll('_',' '),cap,binding.normalization?.cap_units?.[name]||'Original native unit']);
    const planChooser=choices.length?'<label><span>Optional prepared receiving-water plan</span><select data-analysis-delivery-plan>'+
      '<option value="">Attach independent analysis areas only</option>'+choices.map(row=>'<option value="'+esc(row.id)+'"'+(row.id===selectedPlan?' selected':'')+'>'+
      esc(row.title+' — '+row.receptor_count+' original receptors'+(row.additional_receptor_ids?.length?', '+row.additional_receptor_ids.length+' additional to these analysis areas':''))+'</option>').join('')+
      '</select><small>The selected full plan runs through the original native receiving-water engine during delivery. Its family unions count overlapping land once.</small></label>':'';
    const planDetail=plan?'<p>'+esc(plan.scope)+'</p><p>Plan '+esc(plan.id)+'; matched receptors '+esc(rows(plan.matched_receptor_ids).join(', '))+
      (rows(plan.additional_receptor_ids).length?'; additional plan receptors '+esc(plan.additional_receptor_ids.join(', ')):'')+'.</p>'+
      button('plan','Open original prepared plan','data-id="'+esc(plan.id)+'"'+(typeof openReceivingPlan==='function'?'':' disabled')):'';
    return '<section class="section analysis-section"><header class="section-header"><div><h2>Original GIS delivery</h2>'+
      '<p>Attach this completed analysis and its original assets to the scientific report and seven-family GIS package.</p></div>'+refresh+'</header>'+
      '<dl class="analysis-source-facts"><dt>Attached analysis</dt><dd>'+esc(binding.analysis_title)+'</dd><dt>Analysis ID</dt><dd>'+esc(binding.analysis_id)+'</dd>'+
      '<dt>Original record SHA-256</dt><dd>'+esc(binding.analysis_sha256)+'</dd><dt>Retained areas</dt><dd>'+esc(rows(binding.areas).length)+'</dd></dl>'+
      (error?'<p role="alert">'+esc(error)+'</p>':'')+
      (value.ready?'<p>The original cohort is compatible with the delivery model. Select the original overlays, GIS contact and map layout in its existing form.</p>':
        '<div class="notice"><h3>Native cohort choices needed for the seven-family delivery</h3>'+issues(value.issues)+'</div>')+
      cases+'<p>All original alternatives keep their saved order. This attachment retains its own common-cell support and fixed-cap scores. The original map builder retains its reported map support.</p>'+
      '<details class="technical"><summary>Saved planning scales seeded into the delivery form</summary>'+table(['Pollutant','Fixed cap','Cap unit'],capRows)+
      '<p>Original map settings can be edited in the delivery form. Attached analysis tables and rasters retain these original saved settings.</p></details>'+
      planChooser+planDetail+(rows(value.prepared_plan_issues).length?'<details><summary>Other retained preparation references</summary>'+issues(value.prepared_plan_issues)+'</details>':'')+
      '<div class="analysis-source-actions">'+button('open','Continue to original delivery',!value.ready||typeof openDelivery!=='function'?'disabled':'')+'</div>'+
      '<p>Original physical, pairwise, priority and sensitivity tables, geographic features, rasters, source selectors and preparation origins are included as GIS project assets.</p>'+
      '<p>Overlapping individual area totals remain separate. A combined native source-water total comes from the explicitly selected plan’s family union.</p>'+
      '<h3>Retained releases using this exact analysis</h3>'+
      (releaseRows?'<div class="table-scroll"><table class="analysis-table"><thead><tr><th>Delivery</th><th>Status</th><th>ID</th><th></th></tr></thead><tbody>'+releaseRows+'</tbody></table></div>':'<p>No retained original delivery currently links this exact saved analysis edition.</p>')+
      (rows(value.release_issues).length?'<details><summary>Retained release issues</summary>'+issues(value.release_issues)+'</details>':'')+'</section>';
  }
  function selectPlan(record,id){
    if(id&&!rows(get(record)?.prepared_plans).some(plan=>plan.id===id))throw Error('Choose an original prepared plan listed for this saved analysis.');
    plans.set(key(record),id);onChange();
  }
  async function dispatch(node,record){
    const action=node.dataset.action?.replace(/^analysis-delivery-/,'');
    if(action==='refresh')return load(record,{fresh:true});
    if(action==='release'){
      const release=rows(get(record)?.releases).find(row=>row.id===node.dataset.id);
      if(!release)throw Error('Choose a retained release linked to this exact analysis.');
      return openItem('deliveries',release.id);
    }
    if(action==='plan'){
      const plan=rows(get(record)?.prepared_plans).find(row=>row.id===node.dataset.id);
      if(!plan)throw Error('Choose an original prepared source plan listed for this analysis.');
      if(typeof openReceivingPlan!=='function')throw Error('Receive the original prepared-plan navigation callback.');
      return openReceivingPlan(plan.id);
    }
    if(action==='open'){
      if(typeof openDelivery!=='function')throw Error('Receive the original delivery-form callback.');
      const ws=workspace(),identity=key(record),selectedPlan=plans.get(identity)||'';
      const value=await load(record,{fresh:true});
      if(workspace()!==ws)throw Error('Return to the original workspace before continuing its delivery.');
      if(!value.ready)throw Error(rows(value.issues).map(row=>row.message).join(' '));
      const selection=clone(value.selection);
      if(selectedPlan){
        const plan=rows(value.prepared_plans).find(row=>row.id===selectedPlan);
        if(!plan)throw Error('The selected prepared plan no longer matches the retained source areas. Review its original binding.');
        selection.receiving_waters=clone(plan.selection);
      }
      return openDelivery(selection);
    }
    throw Error('Choose an available original delivery action.');
  }
  function ensure(record){
    const identity=key(record);
    if(!cache.has(identity)&&!pending.has(identity)&&!errors.has(identity))load(record).catch(()=>{});
  }
  return {load,get,render,dispatch,selectPlan,ensure};
}
