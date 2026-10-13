/** Compare original immutable Receiving plans in the existing Receiving desk.
 * TokenJunkieLabs. Reads saved records only; no geometry or model recomputation.
 */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const present=(row,key)=>row!=null&&Object.hasOwn(row,key);
const unsafe=value=>typeof value==='number'?(!Number.isFinite(value)||(Number.isInteger(value)&&!Number.isSafeInteger(value))):
  Array.isArray(value)?value.some(unsafe):object(value)?Object.values(value).some(unsafe):false;
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':
  object(value)?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const label=value=>value===undefined?'Not specified':value===null?'null':typeof value==='string'?value:JSON.stringify(value);
const summary=value=>{const result=label(value);return result.length>180?result.slice(0,177)+'…':result;};
const number=value=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString(undefined,{maximumFractionDigits:4}):'—';
const hash=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const button=(action,title,attributes='')=>'<button type="button" data-action="'+esc(action)+'" '+attributes+'>'+esc(title)+'</button>';
const table=(heads,rows)=>'<div class="water-table-scroll"><table><thead><tr>'+heads.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const heading={source:'Original source selection',relation:'Declared relationship',classification:'Original designation',metadata:'Original context and evidence',
  title:'Title',family:'Family',layer:'Layer',feature_ids:'Requested native IDs',where:'Typed original filter',catchments:'Original catchment network',analysis_crs:'Requested analysis CRS'};
function changes(before,after,path='',rows=[]){
  const beforePresent=before!==undefined,afterPresent=after!==undefined;
  if(!beforePresent&&!afterPresent)return rows;
  if(beforePresent&&afterPresent&&object(before)&&object(after)){
    for(const key of [...new Set([...Object.keys(before),...Object.keys(after)])].sort())
      changes(before[key],after[key],path?path+'.'+key:key,rows);
    return rows;
  }
  const uncertain=unsafe(before)||unsafe(after);
  if(!uncertain&&beforePresent===afterPresent&&canonical(before)===canonical(after))return rows;
  rows.push({path,before_present:beforePresent,after_present:afterPresent,
    before:copy(before),after:copy(after),state:uncertain?'unresolved_precision':beforePresent&&afterPresent?'changed':beforePresent?'removed':'added'});
  return rows;
}
function indexed(rows,label){
  if(!Array.isArray(rows))throw Error('The original '+label+' list is missing.');
  const map=new Map();
  for(const row of rows){
    if(!object(row)||typeof row.id!=='string'||!row.id||map.has(row.id))throw Error('The original '+label+' IDs must be present and unique.');
    map.set(row.id,row);
  }
  return map;
}
function plan(value){
  if(value?.schema!=='upstate.receiving-water-plan/v1'||value.state!=='complete'||!hash(value.id)||!hash(value.record_sha256)||
      !object(value.identity?.selection)||typeof value.identity.project_id!=='string')throw Error('Choose a complete original saved Receiving source plan.');
  const requested=indexed(value.identity.selection.receptors,'requested receiving waters'),compiled=indexed(value.receptors,'prepared receiving waters');
  if(requested.size!==compiled.size||[...requested.keys()].some(id=>!compiled.has(id)))throw Error('The saved requested and prepared receiving-water IDs differ.');
  return {requested,compiled};
}
function featureIndex(rows){
  if(!Array.isArray(rows))throw Error('The saved original feature inventory is missing.');
  const map=new Map();
  for(const row of rows){
    const id=row?.native_feature_id;
    if(typeof id!=='string'||!id||map.has(id))throw Error('Original native feature IDs must be distinct strings.');
    map.set(id,row);
  }
  return map;
}
function features(before,after,sameSource,exactRecord=false){
  const left=featureIndex(before||[]),right=featureIndex(after||[]);
  if(!sameSource)return {same_source:false,before_ids:[...left.keys()],after_ids:[...right.keys()],added:[],removed:[],changed:[],unresolved:[],
    note:'Native IDs belong to different retained source bodies, layer defaults or native-ID interpretations. Membership is listed separately; IDs are not matched across source editions.'};
  const added=[...right.keys()].filter(id=>!left.has(id)),removed=[...left.keys()].filter(id=>!right.has(id)),changed=[],unresolved=[];
  for(const [id,row]of left)if(right.has(id)){
    const fields=exactRecord?[]:changes(row,right.get(id));
    if(fields.length){const item={id,fields};(fields.some(x=>x.state==='unresolved_precision')?unresolved:changed).push(item);}
  }
  return {same_source:true,before_ids:[...left.keys()],after_ids:[...right.keys()],added,removed,changed,unresolved};
}
function sourceComparison(left,right){
  const keys=['source_collection_id','source_id','body_sha256','body_bytes','selection','feature_ids','uri','vintage','title','metadata','companions','geometry_reader','selected_features'];
  const a={},b={};for(const key of keys){if(present(left,key))a[key]=left[key];if(present(right,key))b[key]=right[key];}
  return changes(a,b);
}
function sameFeatureNamespace(left,right,leftRequest,rightRequest,leftFeatures,rightFeatures){
  if(!hash(left?.body_sha256)||left.body_sha256!==right?.body_sha256)return false;
  const a=leftRequest?.layer,b=rightRequest?.layer;
  const explicit=typeof a==='string'&&a&&typeof b==='string'&&b;
  const sameLayer=explicit?a===b:!a&&!b&&a===b&&left.source_collection_id===right.source_collection_id&&left.source_id===right.source_id;
  if(!sameLayer)return false;
  // Original source defaults and native ID interpretation are part of the namespace.
  // Reader implementation hashes remain separately visible as provenance.
  const readerKeys=['source_object_id_field','native_collection','source_order','declared_layer'];
  if(Boolean(left.geometry_reader)!==Boolean(right.geometry_reader))return false;
  for(const key of readerKeys)if(canonical(left.geometry_reader?.[key])!==canonical(right.geometry_reader?.[key]))return false;
  const old=featureIndex(leftFeatures||[]),next=featureIndex(rightFeatures||[]);
  for(const [id,row]of old)if(next.has(id))for(const key of ['native_id_basis','source_array_index'])
    if(canonical(row[key])!==canonical(next.get(id)[key]))return false;
  return true;
}
function geometryFile(before,after){
  return {before:copy(before),after:copy(after),state:before?.sha256===after?.sha256&&before?.bytes===after?.bytes?'same_file':'file_changed',
    interpretation:'Container bytes include original geometry and attributes. A different file hash alone does not measure a changed geographic footprint.'};
}
export function comparePlanEditions(before,after){
  const a=plan(before),b=plan(after);
  if(before.identity.project_id!==after.identity.project_id)throw Error('Compare plans from the same original project.');
  const exactRecord=before.id===after.id&&before.record_sha256===after.record_sha256;
  if(before.id===after.id&&!exactRecord)throw Error('The same saved plan ID has different original record identities.');
  const areaComparable=before.analysis_crs===after.analysis_crs&&before.identity.method_version===after.identity.method_version&&
    before.identity.implementation_sha256===after.identity.implementation_sha256&&canonical(before.area_method)===canonical(after.area_method);
  const rows=[];
  for(const id of [...new Set([...a.requested.keys(),...b.requested.keys()])]){
    const requestedBefore=a.requested.get(id),requestedAfter=b.requested.get(id),left=a.compiled.get(id),right=b.compiled.get(id);
    if(!left||!right){
      rows.push({id,title:(right||left).title,state:left?'removed':'added',before:copy(left),after:copy(right),
        requested_before:copy(requestedBefore),requested_after:copy(requestedAfter),request_changes:changes(requestedBefore,requestedAfter),
        categories:[left?'Receiving water removed':'Receiving water added']});continue;
    }
    const requestChanges=exactRecord?[]:changes(requestedBefore,requestedAfter);
    const sourceChanges=exactRecord?[]:sourceComparison(left.source,right.source);
    const featureChanges=features(left.original_features,right.original_features,sameFeatureNamespace(left.source,right.source,requestedBefore.source,requestedAfter.source,left.original_features,right.original_features),exactRecord);
    const compiledChanges=exactRecord?[]:changes({relation:left.relation,relationship_precision:left.relationship_precision,interpretation:left.interpretation,
      classification:left.classification,metadata:left.metadata,receptor_geometry_type:left.receptor_geometry_type},
      {relation:right.relation,relationship_precision:right.relationship_precision,interpretation:right.interpretation,
      classification:right.classification,metadata:right.metadata,receptor_geometry_type:right.receptor_geometry_type});
    const area={before_ha:left.contribution_area_ha,after_ha:right.contribution_area_ha,comparable:areaComparable,
      difference_ha:areaComparable&&Number.isFinite(left.contribution_area_ha)&&Number.isFinite(right.contribution_area_ha)?right.contribution_area_ha-left.contribution_area_ha:null};
    const geometry={receptor:geometryFile(left.receptor_geometry,right.receptor_geometry),contribution:geometryFile(left.contribution_geometry,right.contribution_geometry)};
    const categories=[];
    if(left.source?.body_sha256!==right.source?.body_sha256)categories.push('Original source body');
    if(sourceChanges.length)categories.push('Source identity / provenance');
    if(requestChanges.some(x=>x.path==='source'||x.path.startsWith('source.')))categories.push('Requested source selection');
    if(!featureChanges.same_source)categories.push('Different feature namespace');
    else if(featureChanges.added.length||featureChanges.removed.length)categories.push('Selected original features');
    if(featureChanges.changed.length||featureChanges.unresolved.length)categories.push('Original feature attributes / interpretation');
    if(requestChanges.some(x=>x.path==='relation'||x.path.startsWith('relation.')))categories.push('Declared relationship');
    if(requestChanges.some(x=>!x.path.startsWith('source.')&&!x.path.startsWith('relation.')))categories.push('Designation / context / labels');
    if(compiledChanges.length)categories.push('Prepared relationship / context');
    if(left.contribution_area_ha!==right.contribution_area_ha)categories.push('Prepared contribution area');
    if(Object.values(geometry).some(x=>x.state==='file_changed'))categories.push('Retained geometry file');
    const uncertain=requestChanges.concat(sourceChanges,compiledChanges).some(x=>x.state==='unresolved_precision')||featureChanges.unresolved.length>0;
    const knownChange=requestChanges.concat(sourceChanges,compiledChanges).some(x=>x.state!=='unresolved_precision')||!featureChanges.same_source||
      featureChanges.added.length>0||featureChanges.removed.length>0||featureChanges.changed.length>0||featureChanges.unresolved.some(row=>row.fields.some(field=>field.state!=='unresolved_precision'))||left.contribution_area_ha!==right.contribution_area_ha||Object.values(geometry).some(x=>x.state==='file_changed');
    rows.push({id,title:right.title,state:knownChange?'changed':uncertain?'review':'unchanged',categories,request_changes:requestChanges,
      source_changes:sourceChanges,features:featureChanges,compiled_changes:compiledChanges,area,geometry,
      requested_before:copy(requestedBefore),requested_after:copy(requestedAfter)});
  }
  const topBefore=copy(before.identity.selection),topAfter=copy(after.identity.selection);delete topBefore.receptors;delete topAfter.receptors;
  return {schema:'upstate.receiving-water-plan-comparison/v1',project_id:before.identity.project_id,
    reference:{id:before.id,title:before.title,record_sha256:before.record_sha256,created_at:before.created_at},
    candidate:{id:after.id,title:after.title,record_sha256:after.record_sha256,created_at:after.created_at},
    same_record:before.id===after.id,
    scope:'Original saved source selections and prepared geographic records; no model quantities are recalculated.',
    plan_changes:exactRecord?[]:changes(topBefore,topAfter),source_identity_changes:exactRecord?[]:changes(before.identity.source_identities,after.identity.source_identities),
    preparation_changes:changes({method_version:before.identity.method_version,implementation_sha256:before.identity.implementation_sha256,analysis_crs:before.analysis_crs,area_method:before.area_method},
      {method_version:after.identity.method_version,implementation_sha256:after.identity.implementation_sha256,analysis_crs:after.analysis_crs,area_method:after.area_method}),
    receptor_order_changed:canonical([...a.requested.keys()])!==canonical([...b.requested.keys()]),
    counts:Object.fromEntries(['added','removed','changed','review','unchanged'].map(state=>[state,rows.filter(x=>x.state===state).length])),
    area_comparable:areaComparable,rows,
    limitations:['Receptors match only by explicit saved ID; a renamed ID remains a removal and addition.',
      'Native features match only within the same retained source body, verified explicit/default layer namespace and recorded native-ID interpretation.',
      'Contribution areas are per receiving water and are never summed across overlapping waters.',
      'A geometry-file hash is a file identity, not a measured spatial difference.',
      'Browser-unsafe integer attributes are unresolved; download the original record to inspect exact numeric tokens.',
      'Same receptor IDs do not establish identical native raster support. The original analysis engine determines support.']};
}
export function accountingReferenceChanges(accounting,target){
  const ids=new Set((target?.receptors||[]).map(row=>row.id)),missing=[];
  for(const group of accounting?.groups||[])for(const [field,values]of [['parent_receptor_id',[group.parent_receptor_id]],['upstream_receptor_ids',group.upstream_receptor_ids||[]],['reservoir_receptor_ids',group.reservoir_receptor_ids||[]]])
    for(const id of values)if(!ids.has(id))missing.push({group_id:group.id,field,id});
  return missing;
}
function changeTable(rows){
  if(!rows.length)return '<p class="water-note">No recorded change in these fields.</p>';
  return table(['Original field','Reference','Candidate'],rows.slice(0,100).map(row=>'<tr><th scope="row">'+esc(row.path||'Selection')+
    (row.state==='unresolved_precision'?'<small>Exact numeric precision unresolved in browser</small>':'')+'</th><td>'+esc(summary(row.before))+'</td><td>'+esc(summary(row.after))+'</td></tr>'))+
    (rows.length>100?'<p>'+esc(rows.length-100)+' further field changes are retained in the comparison JSON and original records.</p>':'');
}
function countFeatures(value){return value?value.before_ids.length+' → '+value.after_ids.length:'—';}
function listIds(ids){return ids.length?'<p class="rwpc-ids">'+ids.slice(0,100).map(id=>'<code>'+esc(id)+'</code>').join(' ')+(ids.length>100?' … '+esc(ids.length-100)+' further original IDs':'')+'</p>':'<p class="water-note">None.</p>';}
export function planChangeDetails(change){
  if(!change)throw Error('Choose a receiving water from the current comparison.');
  let body='<p>Original receiving-water ID <code>'+esc(change.id)+'</code> · '+esc(change.state)+'</p>'+
    '<h3>Requested source and relationship changes</h3>'+changeTable(change.request_changes);
  if(change.state==='added'||change.state==='removed'){
    const row=change.after||change.before;
    return body+'<p>This explicit ID exists only in the '+(change.after?'candidate':'reference')+' plan; it has not been matched by name.</p>'+
      '<h3>Original native features</h3>'+listIds((row.original_features||[]).map(x=>x.native_feature_id))+
      '<details><summary>Complete saved requested selection</summary><pre class="json-view">'+esc(JSON.stringify(change.requested_after||change.requested_before,null,2))+'</pre></details>';
  }
  body+='<h3>Original source identity and provenance</h3>'+changeTable(change.source_changes);
  const f=change.features;
  if(!f.same_source)body+='<p>'+esc(f.note)+'</p><h4>Reference native IDs</h4>'+listIds(f.before_ids)+'<h4>Candidate native IDs</h4>'+listIds(f.after_ids);
  else body+='<h3>Selected original features in the same source body</h3><h4>Added IDs</h4>'+listIds(f.added)+'<h4>Removed IDs</h4>'+listIds(f.removed)+
    '<h4>Changed original records</h4>'+listIds(f.changed.map(x=>x.id))+'<h4>Records requiring exact numeric review</h4>'+listIds(f.unresolved.map(x=>x.id))+
    f.changed.concat(f.unresolved).slice(0,20).map(row=>'<details><summary>Native feature '+esc(row.id)+'</summary>'+changeTable(row.fields)+'</details>').join('');
  body+='<h3>Prepared relationship and context</h3>'+changeTable(change.compiled_changes)+
    '<h3>Prepared projected contribution area</h3><p>Reference '+number(change.area.before_ha)+' ha; candidate '+number(change.area.after_ha)+' ha.'+
    (change.area.comparable?' Scalar difference '+number(change.area.difference_ha)+' ha.':' CRS or preparation implementation differs; no area delta is inferred.')+
    ' Each scalar belongs to this receiving water; no overlapping areas are added together.</p>'+
    '<h3>Retained geometry files</h3>'+table(['File','Reference SHA-256','Candidate SHA-256'],Object.entries(change.geometry).map(([name,row])=>'<tr><th scope="row">'+esc(name)+'</th><td><code>'+esc(row.before?.sha256||'—')+'</code></td><td><code>'+esc(row.after?.sha256||'—')+'</code></td></tr>'))+
    '<p>Different container bytes may reflect attributes or serialization. This comparison does not calculate intersected, gained or lost land.</p>';
  return body;
}
export function renderPlanComparison(comparison,{search='',status='',page=0,analyses=[],plans=[]}={}){
  const needle=search.trim().toLocaleLowerCase();
  const filtered=comparison.rows.filter(row=>(!status||row.state===status)&&(!needle||[row.id,row.title,...row.categories].join(' ').toLocaleLowerCase().includes(needle)));
  const last=Math.max(0,Math.ceil(filtered.length/50)-1),index=Math.max(0,Math.min(Number.isInteger(page)?page:0,last)),visible=filtered.slice(index*50,index*50+50);
  const available=analyses.filter(row=>row.state==='complete'&&row.plan_id===comparison.reference.id);
  const savedPlans=plans.filter(row=>row.state==='complete');
  for(const row of [comparison.reference,comparison.candidate])if(!savedPlans.some(plan=>plan.id===row.id))savedPlans.push(row);
  const pairOptions=id=>savedPlans.map(row=>'<option value="'+esc(row.id)+'"'+(row.id===id?' selected':'')+'>'+esc(row.title+' · '+row.id.slice(0,12))+'</option>').join('');
  const option=(value,title)=>'<option value="'+esc(value)+'">'+esc(title)+'</option>';
  return '<div class="water-plan-comparison" data-water-plan-comparison data-reference="'+esc(comparison.reference.id)+'" data-candidate="'+esc(comparison.candidate.id)+'" aria-busy="false"><header class="water-section-heading"><div><p class="eyebrow">SAVED SOURCE PLAN COMPARISON</p><h2>'+esc(comparison.reference.title)+' → '+esc(comparison.candidate.title)+'</h2><p>'+esc(comparison.scope)+'</p></div><div class="water-actions">'+
    button('water-compare-new','Refresh original plans','data-reference="'+esc(comparison.reference.id)+'" data-candidate="'+esc(comparison.candidate.id)+'"')+
    button('water-compare-swap','Reverse comparison')+button('water-compare-download','Download comparison JSON')+'</div></header>'+
    '<div class="rwpc-pair-controls" data-water-compare-pair data-water-plan-chooser><label>Reference plan<select name="plan_compare_reference">'+pairOptions(comparison.reference.id)+'</select></label><label>Candidate plan<select name="plan_compare_candidate">'+pairOptions(comparison.candidate.id)+'</select></label>'+button('water-compare-apply','Compare selected plans')+'</div><p class="water-note" data-water-compare-pending hidden>Apply the selected pair to read its original records before continuing.</p>'+
    '<div class="rwpc-plan-pair">'+[comparison.reference,comparison.candidate].map((row,i)=>'<section><h3>'+(i?'Candidate plan':'Reference plan')+'</h3><p>'+esc(row.title)+'</p><code>'+esc(row.id)+'</code><p>'+button('water-open','Open original plan','data-kind="plan" data-id="'+esc(row.id)+'"')+
      button('spatial-item','Review original geography','data-kind="receiving-water-plan" data-id="'+esc(row.id)+'" data-statistic="areas"')+'</p></section>').join('')+'</div>'+
    '<div class="water-summary">'+Object.entries(comparison.counts).map(([state,count])=>'<div><strong>'+count+'</strong><span>'+esc(state)+' receiving waters</span></div>').join('')+'</div>'+
    (comparison.same_record?'<p class="water-note">Both sides select the same original saved record. This is a no-change view; no new plan was created.</p>':'')+
    '<p class="water-note">Review means exact original numeric precision needs inspection; it does not assert a change. Explicit receiving-water IDs define the match. A changed source or geometry-file hash does not establish measured changed land. Prepared hectares remain separate for each water.</p>'+
    (comparison.preparation_changes.length?'<details><summary>Preparation method / CRS changes</summary>'+changeTable(comparison.preparation_changes)+'</details>':'')+
    '<details><summary>Plan settings and original catchment choices ('+comparison.plan_changes.length+')</summary>'+changeTable(comparison.plan_changes)+
    (comparison.receptor_order_changed?'<p>The ordered receiving-water selection differs.</p>':'')+'</details>'+
    '<div class="water-filters"><label>Find receiving water or change<input data-water-compare-search value="'+esc(search)+'" placeholder="Name, exact ID, or changed field"></label>'+
    '<label>Change<select data-water-compare-status>'+option('','All receiving waters')+['added','removed','changed','review','unchanged'].map(x=>'<option value="'+x+'"'+(status===x?' selected':'')+'>'+x+'</option>').join('')+'</select></label></div>'+
    '<div class="water-section-heading"><p role="status">'+(filtered.length?index*50+1:0)+'–'+Math.min(filtered.length,index*50+50)+' of '+filtered.length+' receiving waters</p><div class="water-actions">'+
      button('water-compare-page','Previous','data-direction="-1"'+(index===0?' disabled':''))+
      '<span>Page '+(index+1)+' of '+(last+1)+'</span>'+button('water-compare-page','Next','data-direction="1"'+(index===last?' disabled':''))+'</div></div>'+
    (visible.length?table(['Receiving water','Change','Original selected features','Projected contribution (ha)',''],visible.map(row=>'<tr><td><strong>'+esc(row.title)+'</strong><small>'+esc(row.id)+'</small></td><td>'+esc(row.state)+'<small>'+esc(row.categories.join('; ')||'No saved receptor-level changes')+'</small></td><td>'+esc(countFeatures(row.features))+'</td><td>'+
      (row.area?number(row.area.before_ha)+' → '+number(row.area.after_ha):number((row.after||row.before)?.contribution_area_ha))+'</td><td>'+
      button('water-compare-detail','Inspect changes','data-id="'+esc(row.id)+'"')+'</td></tr>')):'<p class="water-empty">No receiving water matches these filters.</p>')+
    '<section class="rwpc-analysis"><h3>Continue an original analysis with the candidate plan</h3><p>Choose a complete analysis of the reference plan. The existing revision form keeps its original native runs, pollutants, quantity scope, weights, normalization and accounting. Review changed areas and any absent accounting IDs before saving a separate analysis.</p>'+
    (available.length?'<label>Original analysis<select data-water-compare-analysis>'+option('','Choose an analysis')+available.map(row=>option(row.id,row.title||row.id)).join('')+'</select></label>'+
      button('water-compare-analysis','Review analysis on candidate plan'):'<p class="water-note">No completed analysis of the reference plan is available. Open the candidate plan to start an analysis with an available native cohort.</p>')+'</section></div>';
}
