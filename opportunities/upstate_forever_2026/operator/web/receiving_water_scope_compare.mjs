/* Read-only comparison of original saved Receiving analyses.
 * Physical totals retain each scope's original valid support and units.
 */
const schema='upstate.receiving-water-scope-comparison/v1';
const idPattern=/^[0-9a-f]{64}$/;
const quantities={nitrogen_export:{title:'Nitrogen',units:'kg/year'},phosphorus_export:{title:'Phosphorus',units:'kg/year'},sediment_export:{title:'Sediment',units:'metric_tonnes/year'}};
const scopes={reporting:'Reporting area',model_domain:'Full model domain'};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=value=>value===undefined?null:JSON.parse(JSON.stringify(value));
const canonical=value=>JSON.stringify(normalize(value));
function normalize(value){if(Array.isArray(value))return value.map(normalize);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalize(value[key])]));return value;}
const equal=(a,b)=>canonical(a)===canonical(b);
const finite=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const number=value=>finite(value)===null?'Unavailable':value.toLocaleString(undefined,{maximumFractionDigits:3});
const integer=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const percent=value=>finite(value)===null?'Unavailable':(value*100).toLocaleString(undefined,{maximumFractionDigits:2})+'%';
const button=(action,title,attrs='')=>'<button type="button" data-action="'+esc(action)+'" '+attrs+'>'+esc(title)+'</button>';
const option=(id,title,selected)=>'<option value="'+esc(id)+'"'+(id===selected?' selected':'')+'>'+esc(title)+'</option>';
function analysis(value){
  if(!value||value.schema!=='upstate.receiving-water-analysis/v1'||value.state!=='complete'||!idPattern.test(value.id||''))
    throw Error('Choose two complete original Receiving analyses.');
  if(!Object.hasOwn(scopes,value.quantity_scope)||!Array.isArray(value.subjects))
    throw Error('The saved analysis lacks its original quantity scope or receiving areas.');
  const identity=value.identity;
  if(!identity||!idPattern.test(value.plan_id||'')||!idPattern.test(identity.plan_record_sha256||'')||
      !idPattern.test(identity.grid_id||'')||!idPattern.test(value.baseline_run_id||'')||
      !Array.isArray(value.alternative_run_ids)||value.alternative_run_ids.some(id=>!idPattern.test(id))||
      new Set(value.alternative_run_ids).size!==value.alternative_run_ids.length)
    throw Error('The saved analysis lacks its exact original plan, grid or model cohort.');
  if(identity.selection?.plan_id!==value.plan_id||identity.selection?.baseline_run_id!==value.baseline_run_id||
      !equal([...(identity.selection?.alternative_run_ids||[])].sort(),[...value.alternative_run_ids].sort()))
    throw Error('The saved analysis and its retained original selection differ.');
  return value;
}
function indexSubjects(value){
  const index=new Map();
  for(const subject of value.subjects){
    if(!subject||!['receptor','family_union','accounting'].includes(subject.kind)||typeof subject.id!=='string'||!subject.id)
      throw Error('The saved analysis contains an unidentified receiving area.');
    const key=subject.kind+'\u0000'+subject.id;
    if(index.has(key))throw Error('The saved analysis repeats a receiving-area identity.');
    index.set(key,subject);
  }
  return index;
}
function stats(value,quantity){
  if(!value)return {available:false,reason:'Quantity was not analyzed',sum:null,units:null,valid_cells:null,selected_cells:null,coverage_fraction:null};
  const expected=quantities[quantity]?.units,units=value.sum_units;
  const count=integer(value.valid_cells),selected=integer(value.selected_cells);
  if(!expected||units!==expected)return {...copy(value),original_sum:copy(value.sum),available:false,reason:'Original annual units are missing or incompatible',sum:null,units:units||null};
  const sum=finite(value.sum),available=count!==null&&count>0&&sum!==null;
  return {...copy(value),sum:available?sum:null,units,valid_cells:count,selected_cells:selected,
    coverage_fraction:finite(value.coverage_fraction),available,reason:available?null:count===0?'No valid model cells':'Original physical quantity is unavailable'};
}
function subjectScope(subject,value,keys){
  if(!subject)return null;
  const metrics=subject.metrics||{};
  return {
    analysis_id:value.id,quantity_scope:value.quantity_scope,
    contribution_area_ha:finite(subject.contribution_area_ha),area_in_quantity_scope_ha:finite(subject.area_in_quantity_scope_ha),
    selected_cells:integer(metrics.selected_cells),selected_pixel_area_ha:finite(metrics.selected_pixel_area_ha),
    baseline:Object.fromEntries(keys.map(q=>[q,stats(metrics.baseline_physical?.[q],q)])),
    alternatives:Object.fromEntries(value.alternative_run_ids.map(id=>[id,{
      physical:Object.fromEntries(keys.map(q=>[q,stats(metrics.alternatives?.[id]?.physical?.[q],q)])),
      changes:Object.fromEntries(keys.map(q=>[q,stats(metrics.alternatives?.[id]?.changes?.[q],q)]))
    }]))
  };
}
function reference(value){
  return {id:value.id,title:value.title,record_sha256:value.record_sha256||null,quantity_scope:value.quantity_scope,
    completed_at:value.completed_at||null,method_version:value.identity.method_version,
    implementation_sha256:value.identity.implementation_sha256,
    accounting_implementation_sha256:value.identity.accounting_implementation_sha256||null,
    selection:copy(value.identity.selection),measurement:copy(value.measurement),quantity_sources:copy(value.quantity_sources)};
}
export function compareQuantityScopes(first,second){
  first=analysis(first);second=analysis(second);
  if(first.quantity_scope===second.quantity_scope)throw Error('Choose one reporting-area analysis and one full-model-domain analysis.');
  const reporting=first.quantity_scope==='reporting'?first:second,domain=first.quantity_scope==='model_domain'?first:second;
  for(const [key,label]of [['project_id','original project'],['plan_record_sha256','saved source-plan body'],['grid_id','prepared grid'],
      ['baseline_selection','baseline model selection'],['alternative_selections','alternative model selections'],
      ['baseline_artifacts','retained baseline model artifacts'],['alternative_artifacts','retained alternative model artifacts']]){
    if(reporting.identity[key]===undefined||domain.identity[key]===undefined||!equal(reporting.identity[key],domain.identity[key]))
      throw Error('Choose the same '+label+' for both scopes. A retained run may have acquired a newer model stage.');
  }
  if(reporting.plan_id!==domain.plan_id||reporting.baseline_run_id!==domain.baseline_run_id||
      !equal([...reporting.alternative_run_ids].sort(),[...domain.alternative_run_ids].sort())||!equal(reporting.grid,domain.grid))
    throw Error('Choose the same original plan, model runs and complete grid for both scopes.');
  if(!equal(reporting.identity.selection.accounting||{},domain.identity.selection.accounting||{}))
    throw Error('Choose the same original catchment-accounting groups for both scopes.');
  const methods=['method_version','implementation_sha256','accounting_implementation_sha256'];
  const methodDifferences=methods.filter(key=>!equal(reporting.identity[key],domain.identity[key]));
  const reportIndex=indexSubjects(reporting),domainIndex=indexSubjects(domain);
  const keys=Object.keys(quantities).filter(q=>[reporting,domain].some(value=>(value.pollutants||value.identity.pollutants||[]).includes(q)||value.subjects.some(s=>Object.hasOwn(s.metrics?.baseline_physical||{},q))));
  if(!keys.length)throw Error('The selected analyses contain no original annual physical quantities.');
  const rows=[...new Set([...reportIndex.keys(),...domainIndex.keys()])].map(key=>{
    const a=reportIndex.get(key),b=domainIndex.get(key),subject=a||b;
    if(a&&b&&(!equal(a.source||null,b.source||null)||!equal(a.relation||null,b.relation||null)||
        a.family!==b.family||!equal(a.receptor_ids||null,b.receptor_ids||null)||
        !equal(a.accounting_group_id||null,b.accounting_group_id||null)||!equal(a.accounting_role||null,b.accounting_role||null)))
      throw Error('The original relationship for '+subject.id+' differs between the saved analyses.');
    return {id:subject.id,kind:subject.kind,title:subject.title||subject.id,family:subject.family,
      source:copy(subject.source),relation:copy(subject.relation),relationship_precision:subject.relationship_precision||'',
      interpretation:subject.interpretation||'',accounting_group_id:subject.accounting_group_id||null,
      accounting_role:subject.accounting_role||null,receptor_ids:copy(subject.receptor_ids),
      present_in_both:Boolean(a&&b),reporting:subjectScope(a,reporting,keys),model_domain:subjectScope(b,domain,keys)};
  });
  return {schema,project_id:reporting.identity.project_id,plan_id:reporting.plan_id,
    plan_record_sha256:reporting.identity.plan_record_sha256,grid_id:reporting.identity.grid_id,
    baseline_run_id:reporting.baseline_run_id,alternative_run_ids:[...reporting.alternative_run_ids],
    quantities:keys,reporting:reference(reporting),model_domain:reference(domain),method_differences:methodDifferences,
    interpretation:{
      physical:'Annual land export reaching streams within each original selected quantity support.',
      scenario_change:'Original alternative minus baseline on common valid cells within that scope.',
      across_scopes:'Each scope retains its own original support. No subtraction between scopes is made.',
      precision:'Reporting uses retained Float32 mass-per-pixel outputs; model domain reads original native rates with the original pixel area. Small rounding differences can occur.',
      overlap:'Individual receiving areas can overlap. Each family-union row counts its selected land once; do not add individual rows or separate families.',
      priorities:'Scope-specific priority normalization is retained in the original analysis and is not compared as physical export.'
    },rows};
}
export function scopeComparisonCSV(value){
  if(value?.schema!==schema)throw Error('Open a saved analysis scope comparison.');
  const fields=['project_id','plan_id','plan_record_sha256','grid_id','analysis_id','analysis_record_sha256','quantity_scope',
    'subject_kind','subject_id','title','family','accounting_group_id','accounting_role','relationship',
    'baseline_run_id','run_id','quantity','sum_units','area_in_quantity_scope_ha','selected_pixel_area_ha','selected_cells',
    'physical_sum','physical_valid_cells','physical_coverage_fraction','paired_baseline_sum','paired_alternative_sum',
    'signed_change','increased_export','avoided_export','paired_valid_cells','paired_coverage_fraction','status'];
  const cell=value=>{
    if(value===undefined||value===null)return '';
    let text=String(value);if(typeof value!=='number'&&/^[\s]*[=+\-@]/.test(text))text="'"+text;
    return /[",\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;
  };
  const output=[fields.join(',')];
  for(const row of value.rows)for(const scope of ['reporting','model_domain'])for(const q of value.quantities){
    const item=row[scope],base={
      project_id:value.project_id,plan_id:value.plan_id,plan_record_sha256:value.plan_record_sha256,grid_id:value.grid_id,
      analysis_id:value[scope].id,analysis_record_sha256:value[scope].record_sha256,quantity_scope:scope,
      subject_kind:row.kind,subject_id:row.id,title:row.title,family:row.family,accounting_group_id:row.accounting_group_id,
      accounting_role:row.accounting_role,relationship:row.relationship_precision,baseline_run_id:value.baseline_run_id,
      quantity:q,sum_units:quantities[q].units,area_in_quantity_scope_ha:item?.area_in_quantity_scope_ha,
      selected_pixel_area_ha:item?.selected_pixel_area_ha,selected_cells:item?.selected_cells};
    for(const run of [value.baseline_run_id,...value.alternative_run_ids]){
      const physical=run===value.baseline_run_id?item?.baseline[q]:item?.alternatives[run]?.physical[q];
      const change=run===value.baseline_run_id?null:item?.alternatives[run]?.changes[q];
      const record={...base,run_id:run,physical_sum:physical?.available?physical.sum:null,
        physical_valid_cells:physical?.valid_cells,physical_coverage_fraction:physical?.coverage_fraction,
        paired_baseline_sum:change?.available?finite(change.baseline_sum_on_common_cells):null,
        paired_alternative_sum:change?.available?finite(change.alternative_sum_on_common_cells):null,
        signed_change:change?.available?change.sum:null,increased_export:change?.available?finite(change.sum_increased_export):null,
        avoided_export:change?.available?finite(change.sum_avoided_export):null,paired_valid_cells:change?.valid_cells,
        paired_coverage_fraction:change?.coverage_fraction,status:!item?'Area absent from original scope analysis':
          (physical?.available?'Physical quantity available':physical?.reason||'Quantity unavailable')+
          (run===value.baseline_run_id?'':'; '+(change?.available?'Paired scenario change available':change?.reason||'Paired change unavailable'))};
      output.push(fields.map(field=>cell(record[field])).join(','));
    }
  }
  return output.join('\r\n')+'\r\n';
}
export function renderScopeComparison(value,{analyses=[],runTitle=id=>id.slice(0,12),search='',kind='',quantity='',run='',page=0}={}){
  if(value?.schema!==schema)throw Error('Open the original saved analysis pair.');
  if(!value.quantities.includes(quantity))quantity=value.quantities[0];
  if(!value.alternative_run_ids.includes(run))run='';
  const needle=search.trim().toLocaleLowerCase();
  const rows=value.rows.filter(row=>(!kind||row.kind===kind)&&(!needle||[row.id,row.title,row.family,row.source?.source_id,row.accounting_group_id].filter(Boolean).join(' ').toLocaleLowerCase().includes(needle)));
  const pageSize=30,max=Math.max(0,Math.ceil(rows.length/pageSize)-1);page=Math.max(0,Math.min(Number.isFinite(page)?Math.trunc(page):0,max));
  const picker=(scope,label)=>'<label><span>'+esc(label)+'</span><select name="scope_compare_'+scope+'">'+analyses.filter(a=>a.state==='complete'&&a.quantity_scope===scope).map(a=>option(a.id,a.title+' · '+a.id.slice(0,12),value[scope].id)).join('')+'</select></label>';
  const select=(name,label,values,current)=>'<label><span>'+esc(label)+'</span><select data-water-scope-filter="'+name+'">'+values.map(([id,title])=>option(id,title,current)).join('')+'</select></label>';
  const units=quantities[quantity].units.replaceAll('_',' ');
  const body=rows.slice(page*pageSize,(page+1)*pageSize).map(row=>{
    const type=row.kind==='family_union'?'Combined family area':row.kind==='accounting'?'Catchment accounting partition':'Individual receiving water';
    const cells=['reporting','model_domain'].map(scope=>{
      const item=row[scope],physical=run?item?.alternatives[run]?.physical[quantity]:item?.baseline[quantity];
      const change=run?item?.alternatives[run]?.changes[quantity]:null;
      const measurement=run?change:physical;
      const paired=run?'<td class="water-number">'+number(change?.available?finite(change.baseline_sum_on_common_cells):null)+'</td><td class="water-number">'+number(change?.available?finite(change.alternative_sum_on_common_cells):null)+'</td><td class="water-number">'+number(change?.available?change.sum:null)+'</td>':
        '<td class="water-number">'+number(physical?.available?physical.sum:null)+'</td>';
      return '<tr><th scope="row">'+esc(scopes[scope])+'</th><td class="water-number">'+number(item?.area_in_quantity_scope_ha)+'</td>'+paired+
        '<td class="water-number">'+number(measurement?.valid_cells)+' / '+number(item?.selected_cells)+'<small>'+percent(measurement?.coverage_fraction)+'</small></td><td>'+
        (!item?'<span>Area absent from this saved analysis</span>':measurement?.available?'':esc(measurement?.reason||'Quantity unavailable'))+
        button('water-open','Open analysis','data-kind="analysis" data-id="'+esc(value[scope].id)+'"')+'</td></tr>';
    }).join('');
    return '<article class="water-scope-area"><header><h3>'+esc(row.title)+'</h3><p>'+esc(type)+' · <code>'+esc(row.id)+'</code></p></header>'+
      '<div class="water-table-scroll"><table><caption>'+esc(quantities[quantity].title)+' ('+esc(units)+')'+(run?' · '+esc(runTitle(run)):' · '+esc(runTitle(value.baseline_run_id)))+'</caption><thead><tr><th scope="col">Quantity support</th><th scope="col">Area (ha)</th>'+
      (run?'<th scope="col">Baseline on common cells</th><th scope="col">Alternative on common cells</th><th scope="col">Signed change</th>':'<th scope="col">Baseline export</th>')+
      '<th scope="col">'+(run?'Paired':'Valid')+' / selected cells</th><th scope="col">Original record</th></tr></thead><tbody>'+cells+'</tbody></table></div>'+
      '<p class="water-note">'+esc(row.relationship_precision)+(row.accounting_role?' · '+esc(row.accounting_role):'')+'</p></article>';
  }).join('');
  return '<section data-water-scope-comparison data-reporting="'+esc(value.reporting.id)+'" data-domain="'+esc(value.model_domain.id)+'">'+
    '<header class="water-section-heading"><div><p class="eyebrow">SAME MODEL COHORT · TWO QUANTITY SUPPORTS</p><h2>Compare reporting and model-domain exports</h2><p>'+esc(value.reporting.title)+'</p></div></header>'+
    '<p>Annual land export reaching streams within each selected receiving area. Both analyses use the same original source plan, grid and saved model artifacts.</p>'+
    (value.method_differences.length?'<p class="water-error" role="status">The saved analysis methods differ ('+esc(value.method_differences.join(', '))+'). These are two retained results; differences cannot be attributed to quantity support alone.</p>':'')+
    '<div class="water-scope-pair">'+picker('reporting','Reporting-area analysis')+picker('model_domain','Full-model-domain analysis')+button('water-scope-apply','Apply analysis pair')+'</div>'+
    '<p class="water-note" data-water-scope-pending hidden>Apply the changed analysis pair to compare or download it.</p>'+
    '<div class="water-actions">'+button('water-scope-json','Download complete comparison JSON')+button('water-scope-csv','Download all physical quantities CSV')+'</div>'+
    '<div class="water-filters"><label><span>Find a receiving area</span><input data-water-scope-search value="'+esc(search)+'" placeholder="Name, original ID or source"></label>'+
    select('kind','Area type',[['','All area types'],['receptor','Individual receiving waters'],['family_union','Combined family areas'],['accounting','Catchment accounting partitions']],kind)+
    select('quantity','Quantity',value.quantities.map(q=>[q,quantities[q].title+' ('+quantities[q].units.replaceAll('_',' ')+')']),quantity)+
    select('run','Model comparison',[['','Baseline'],...value.alternative_run_ids.map(id=>[id,runTitle(id)])],run)+'</div>'+
    '<p class="water-note">Scenario changes use the original paired valid cells within each scope. Totals retain original NoData and rounding. Individual areas may overlap; use a family-union row for its deduplicated total. Priority scores and differences between supports are not calculated here.</p>'+
    '<div class="water-section-heading"><p role="status">'+(rows.length?page*pageSize+1:0)+'–'+Math.min(rows.length,(page+1)*pageSize)+' of '+rows.length+' receiving areas</p><div class="water-actions">'+
      button('water-scope-page','Previous','data-direction="-1"'+(page===0?' disabled':''))+'<span>Page '+(page+1)+' of '+(max+1)+'</span>'+
      button('water-scope-page','Next','data-direction="1"'+(page===max?' disabled':''))+'</div></div>'+
    (body||'<p class="water-empty">No receiving areas match these filters.</p>')+
    '<details><summary>Original identities and calculation methods</summary><pre class="json-view">'+esc(JSON.stringify({project_id:value.project_id,plan_id:value.plan_id,plan_record_sha256:value.plan_record_sha256,grid_id:value.grid_id,baseline_run_id:value.baseline_run_id,alternative_run_ids:value.alternative_run_ids,reporting:value.reporting,model_domain:value.model_domain,interpretation:value.interpretation},null,2))+'</pre></details></section>';
}
