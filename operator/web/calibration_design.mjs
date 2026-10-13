/* Source-support design review for the retained native calibration preview. */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const sum=values=>{let value=0,correction=0;for(const x of values){const adjusted=x-correction,next=value+adjusted;correction=(next-value)-adjusted;value=next;}return value;};
const mean=values=>values.length?sum(values)/values.length:null;
const sorted=values=>[...new Set(values)].sort();
const number=v=>finite(v)?v.toLocaleString(undefined,{maximumSignificantDigits:7}):'—';
const list=values=>values.length?values.map(esc).join(', '):'None';
const table=(headers,rows)=>'<div class="table-scroll"><table><thead><tr>'+headers.map(v=>'<th scope="col">'+esc(v)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const cell=value=>'<td>'+value+'</td>';
const parameters=['nitrogen','phosphorus','sediment'];

export function analyzeCalibrationDesign(preview,selection=preview?.selection){
 if(!preview||!selection||!Array.isArray(preview.units))throw Error('Inspect the original catchments before reviewing source support.');
 const original=preview.groups||preview.spatial_groups?.groups||[];
 if(!original.length)throw Error('The native preview has no original spatial groups.');
 const allCatchments=sorted(original.flatMap(g=>g.catchment_ids)),assigned=selection.catchment_groups||preview.spatial_groups?.assignments;
 if(!assigned||Object.keys(assigned).length!==allCatchments.length||allCatchments.some(id=>typeof assigned[id]!=='string'||!assigned[id].trim()))
  throw Error('Assign every original catchment to one named group.');
 for(const group of original)if(new Set(group.catchment_ids.map(id=>assigned[id])).size!==1)
  throw Error('An original overlapping-catchment group cannot be divided.');
 const objective=Object.fromEntries(Object.entries(selection.objective||{}).filter(([,s])=>s.weight>0));
 if(!Object.keys(objective).length||Object.keys(objective).some(p=>!parameters.includes(p)))
  throw Error('Choose positive weights for retained native pollutants.');
 for(const [p,s]of Object.entries(objective)){
  if(!finite(s.weight)||s.weight<=0)throw Error('Use a finite positive '+p+' weight.');
  if(s.normalization_scale!==undefined&&(!finite(s.normalization_scale)||s.normalization_scale<=0||!String(s.scale_reference||'').trim()))
   throw Error('An explicit '+p+' normalization needs a positive scale and its original rationale.');
 }
 const units=preview.units.filter(u=>objective[u.parameter]).map(u=>{
  if(!assigned[u.catchment_id]||!finite(u.observed_annual_mass)||u.observed_annual_mass<0)
   throw Error('The preview source unit has no valid original group or annual reference.');
  return {...u,group_id:assigned[u.catchment_id]};
 });
 const ids=sorted(Object.values(assigned)),calibration=selection.calibration_group_ids||ids.filter(id=>!(selection.validation_group_ids||[]).includes(id)),
  validation=selection.validation_group_ids||[];
 if(new Set([...calibration,...validation]).size!==ids.length||calibration.length+validation.length!==ids.length||
    [...calibration,...validation].some(id=>!ids.includes(id)))
  throw Error('Assign every source group once to calibration or validation.');
 const weightSum=sum(Object.values(objective).map(s=>s.weight));
 if(!finite(weightSum)||weightSum<=0)throw Error('The combined objective weights exceed the finite numerical range.');
 const index=new Map(ids.map(id=>[id,new Map()]));
 for(const u of units){
  const byParameter=index.get(u.group_id);let stat=byParameter.get(u.parameter);
  if(!stat){stat={values:[],records:0,units:u.units};byParameter.set(u.parameter,stat);}
  stat.values.push(u.observed_annual_mass);stat.records+=u.observation_record_ids?.length||0;
 }
 for(const byParameter of index.values())for(const stat of byParameter.values())stat.mean=mean(stat.values);
 function support(groupIds,{scales=false}={}){
  const pollutants={};let unitCount=0;
  for(const [p,s]of Object.entries(objective)){
   const present=groupIds.map(id=>({id,stat:index.get(id)?.get(p)})).filter(row=>row.stat);
   const scale=s.normalization_scale??mean(present.map(row=>row.stat.mean));
   const count=sum(present.map(row=>row.stat.values.length));unitCount+=count;
   pollutants[p]={unit:s.units||present[0]?.stat.units||preview.selection?.objective?.[p]?.units,
    catchments:count,spatial_groups:present.length,
    observation_records:sum(present.map(row=>row.stat.records)),
    group_ids:present.map(row=>row.id),scale:scales&&finite(scale)?scale:null,
    scale_basis:scales?(s.normalization_scale!==undefined?'Explicit source scale':'Mean of training-group means'):null,
    available:present.length>0,scale_available:present.length>0&&finite(scale)&&scale>0};
  }
  const missing=Object.keys(pollutants).filter(p=>!pollutants[p].available),
   invalidScales=scales?Object.keys(pollutants).filter(p=>pollutants[p].available&&!pollutants[p].scale_available):[];
  return {group_ids:[...groupIds],group_count:groupIds.length,unit_count:unitCount,pollutants,
   parameters_without_reference:missing,parameters_without_positive_scale:invalidScales,
   complete:groupIds.length>0&&!missing.length&&!invalidScales.length};
 }
 function partition(cal,val){
  const training=support(cal,{scales:true}),heldout=support(val);
  return {calibration:training,validation:heldout,training_ready:training.complete,
   validation_state:!val.length?'not_selected':heldout.complete?'all_selected_pollutants':'partial_pollutants'};
 }
 const current=partition(calibration,validation);
 const folds=calibration.map(held=>({held_group_id:held,...partition(calibration.filter(id=>id!==held),[held])}));
 const singleGroupChoices=ids.length<2?[]:ids.map(held=>({held_group_id:held,...partition(ids.filter(id=>id!==held),[held])}));
 const groups=ids.map(id=>{const own=units.filter(u=>u.group_id===id);return {
  id,catchment_ids:allCatchments.filter(c=>assigned[c]===id),original_group_ids:original.filter(g=>assigned[g.catchment_ids[0]]===id).map(g=>g.id),
  partition:validation.includes(id)?'validation':'calibration',parameters:Object.keys(objective).filter(p=>own.some(u=>u.parameter===p)),
  units:own.map(u=>({id:u.id,catchment_id:u.catchment_id,parameter:u.parameter,units:u.units,
   observed_annual_mass:u.observed_annual_mass,observation_record_ids:u.observation_record_ids,
   periods:u.periods,temporal_weighting:u.temporal_weighting,station_ids:u.station_ids})),
  observation_records:sum(own.map(u=>u.observation_record_ids?.length||0))};});
 const coefficients=units.filter(u=>calibration.includes(u.group_id)).map(u=>{
  const p=u.parameter,coverage=current.calibration.pollutants[p],withinGroup=index.get(u.group_id).get(p).values.length;
  const coefficient=coverage.scale_available?objective[p].weight/weightSum/coverage.spatial_groups/withinGroup/(coverage.scale*coverage.scale):null;
  return {unit_id:u.id,catchment_id:u.catchment_id,group_id:u.group_id,parameter:p,
   squared_residual_coefficient:finite(coefficient)?coefficient:null,units:u.units};
 });
 return {schema:'upstate.calibration-design-support/v1',source:{
  workspace_id:preview.workspace_id,observation_id:selection.observation_id,
  catchments:selection.catchments,native_spatial_source:preview.spatial_groups?.source,
  candidate_run_ids:selection.candidate_run_ids,source_vintages:preview.source_vintages,
  temporal_method:preview.temporal_method,observations_metadata:preview.observations?.metadata},
  objective,groups,selection:JSON.parse(JSON.stringify(selection)),...current,
  leave_group_out:{selected:selection.leave_group_out!==false,
   state:selection.leave_group_out===false?'not_selected':calibration.length<2?'one_calibration_group':'available',
   folds,training_ready_folds:folds.filter(f=>f.training_ready).length,
   full_pollutant_holdout_folds:folds.filter(f=>f.training_ready&&f.validation.complete).length},
  single_group_holdouts:singleGroupChoices,objective_coefficients:coefficients,
  interpretation:'Source design support uses the original annual reference units and native spatial groups. Each pollutant retains its unit. Multiple source periods do not create additional spatial groups. Candidate raster coverage and actual prediction eligibility are evaluated by the retained native calibration operation.',
  geometry_method:preview.spatial_groups?.method,connections:preview.spatial_groups?.connections||[]};
}

function reasons(value){
 const rows=[];
 if(!value.calibration.group_count)rows.push('No training group');
 if(value.calibration.parameters_without_reference.length)rows.push('Training lacks '+value.calibration.parameters_without_reference.join(', '));
 if(value.calibration.parameters_without_positive_scale.length)rows.push('Positive scale needed for '+value.calibration.parameters_without_positive_scale.join(', '));
 if(value.validation_state==='partial_pollutants')rows.push('Held-out references lack '+value.validation.parameters_without_reference.join(', '));
 return rows.length?rows.join('; '):value.validation_state==='not_selected'?'Calibration only':'All selected pollutants represented';
}
export function calibrationDesignHTML(design){
 const ps=Object.keys(design.objective);
 let html='<h3>Source support for this evaluation</h3><p>'+esc(design.groups.length)+' retained spatial groups; '+
  esc(design.calibration.unit_count)+' training catchment/pollutant units; '+esc(design.validation.unit_count)+
  ' held-out units. '+esc(reasons(design))+'.</p>';
 html+=table(['Selected pollutant','Annual unit','Calibration groups / catchments','Validation groups / catchments','Training normalization'],
  ps.map(p=>{const a=design.calibration.pollutants[p],b=design.validation.pollutants[p];return '<tr><th scope="row">'+esc(p)+'</th>'+
   cell(esc(a.unit||b.unit))+cell(a.spatial_groups+' / '+a.catchments)+cell(b.spatial_groups+' / '+b.catchments)+
   cell(number(a.scale)+'<br>'+esc(a.scale_basis||''))+'</tr>';}));
 html+='<p class="note">Every selected pollutant needs a training reference and a positive normalization scale. Held-out groups can report their available pollutant metrics; a complete combined validation objective requires every selected pollutant. Missing species and unmeasured periods are not zero loads.</p>';
 html+='<details><summary>Original group and period support</summary>'+
  table(['Spatial group','Partition','Pollutants','Original source units'],design.groups.map(g=>'<tr><th scope="row">'+esc(g.id)+'</th>'+
   cell(esc(g.partition))+cell(list(g.parameters))+cell(g.units.map(u=>'<p><strong>'+esc(u.catchment_id)+' · '+esc(u.parameter)+'</strong>: '+
    number(u.observed_annual_mass)+' '+esc(u.units)+'<br>'+esc((u.periods||[]).map(p=>p.start+' to '+p.end+' exclusive; weight '+p.weight).join('; '))+
    '<br>'+esc((u.observation_record_ids||[]).length)+' original record(s); '+esc(u.temporal_weighting)+'</p>').join(''))+'</tr>'))+'</details>';
 const lgo=design.leave_group_out;
 html+='<h4>Leave one calibration group out</h4><p>'+esc(lgo.state==='not_selected'?'Stability analysis is not selected.':
  lgo.state==='one_calibration_group'?'A second calibration group is needed to leave a training group out.':
  lgo.training_ready_folds+' of '+lgo.folds.length+' training folds have source support; '+lgo.full_pollutant_holdout_folds+' also have every selected held-out pollutant.')+'</p>';
 if(lgo.state==='available')html+=table(['Held-out group','Training groups','Held-out pollutants','Source-design result'],
  lgo.folds.map(f=>'<tr>'+cell(esc(f.held_group_id))+cell(String(f.calibration.group_count))+
   cell(list(ps.filter(p=>f.validation.pollutants[p].available)))+cell(esc(reasons(f)))+'</tr>'));
 html+='<details><summary>Review single-group holdout alternatives</summary><p>Each choice assigns this complete named group to validation and every other named group to calibration. Existing group merges and pollutant weights stay intact. Review the resulting coverage before saving.</p>';
 if(!design.single_group_holdouts.length)html+='<p>The retained sources form one spatial group. Repeated constituents or overlapping upstream basins cannot supply an independent spatial holdout.</p>';
 else html+=table(['Held-out group','Training groups','Source-design result','Draft choice'],design.single_group_holdouts.map(f=>'<tr>'+
  cell(esc(f.held_group_id))+cell(String(f.calibration.group_count))+cell(esc(reasons(f)))+
  cell('<button type="button" class="small" data-action="calibration-design-holdout" data-id="'+esc(f.held_group_id)+'"'+
   (!f.training_ready?' disabled':'')+'>Use this split</button>')+'</tr>'));
 html+='</details><details><summary>Objective weights and retained source identity</summary><p>The native objective averages squared residuals within each spatial group, averages those group means per pollutant, divides by the training scale squared, then applies the chosen relative pollutant weights. Validation references do not set training scales.</p><pre class="json-view">'+
  esc(JSON.stringify({objective:design.objective,coefficients:design.objective_coefficients,source:design.source},null,2))+'</pre></details>'+
  '<p class="note">'+esc(design.interpretation)+'</p><button type="button" class="small" data-action="calibration-design-download">Download source design review</button>';
 return html;
}
