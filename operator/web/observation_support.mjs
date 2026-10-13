/* Retained physical measurement support beside the original observation workflow. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={catchment_export:'Receiving-water catchment export',point_source_discharge:'Point-source discharge',concentration:'Observed concentration',other_context:'Original measurement context'};
const number=value=>{if(value===null||value===undefined||value==='')return '—';const n=Number(value);return Number.isFinite(n)?new Intl.NumberFormat(undefined,{maximumFractionDigits:3}).format(n):esc(value);};
const truth=value=>value===true||value==='true';
const table=(headers,rows)=>'<div class="table-wrap"><table><thead><tr>'+headers.map(value=>'<th>'+esc(value)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+value+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
export const supportFields=['measurement_support','species','facility_id','facility_name','outfall_id','reporting_feature','monitoring_location','parameter_code','gauge_id','gauge_relation','relation_method','quantity_basis','coverage_days','expected_days','coverage_complete','coverage_detail','source_quantity'];
export const supportOptions=[['catchment_export','Receiving-water catchment export'],['point_source_discharge','Facility / outfall discharge'],['concentration','Receiving-water concentration'],['other_context','Other original context']];
export function observationSupportMarkup(row,metadata={}){
 const declaredKind={reported_effluent_source_amount:'point_source_discharge',complete_reported_effluent_source_amount:'point_source_discharge',receiving_water_measurement:'concentration',receiving_water_derived_concentration:'concentration'}[metadata.observation_kind];
 const support=row.measurement_support||metadata.measurement_support||declaredKind||(metadata.value_basis==='annual_mass_rate'?'catchment_export':'other_context');
 const facility=metadata.facility_registry?.[row.facility_id||row.station_id]||{};
 const days=row.coverage_days,expected=row.expected_days??metadata.expected_days;
 return '<strong>'+esc(labels[support]||support)+'</strong>'+
  (row.species?'<small>Original species: '+esc(row.species)+'</small>':'')+
  (row.original_parameter&&row.original_parameter!==row.species?'<small>Original parameter label: '+esc(row.original_parameter)+'</small>':'')+
  (row.facility_id?'<small>'+esc(row.facility_name||facility.facility_name||row.facility_id)+' · '+esc(row.facility_id)+'</small>':'')+
  (row.outfall_id||facility.outfall_id?'<small>Mapped outfall '+esc(row.outfall_id||facility.outfall_id)+'</small>':'')+
  (row.reporting_feature?'<small>EPA reporting feature '+esc(row.reporting_feature)+' · location '+esc(row.monitoring_location)+'</small>':'')+
  (row.gauge_id?'<small>'+esc(row.gauge_relation||'Unspecified relation')+' of '+esc(row.gauge_id)+'</small>':'')+
  (days!==undefined?'<small>'+number(days)+(expected!==undefined?' / '+number(expected):'')+' quantified days'+
   (row.coverage_complete===false?' · incomplete source coverage':'')+'</small>':'')+
  (row.relation_method?'<details><summary>Actual network relationship</summary><p>'+esc(row.relation_method)+'</p></details>':'');
}
export function observationSupportSummary(edition){
 const metadata=edition.metadata||{},counts=edition.support_summary?.counts||{},cohorts=metadata.cohort_quantities||[];
 let html='<p class="note">Receiving-water loads, outfall discharges and concentrations retain their own physical support. Native landscape-model residuals use like annual catchment quantities.</p>';
 if(Object.keys(counts).length)html+='<p>'+Object.entries(counts).map(([key,value])=>esc(value)+' '+esc(labels[key]||key)).join(' · ')+'</p>';
 if(!cohorts.length)return html;
 const upstream=cohorts.filter(row=>row.cohort==='upstream');
 html+='<h3>Reported upstream source context</h3><p>These source quantities use the retained network relation to the gauge. Complete annual totals and actual quantified-period totals are shown separately for each original species.</p>';
 html+=table(['Gauge / year','Original species','Complete reported annual amount','Quantified-period amount','Series / permit coverage'],
  upstream.map(row=>[esc(row.gauge_id)+'<br>'+esc(row.calendar_year),esc(row.parameter_name)+'<br><small>'+esc(row.parameter_code)+'</small>',
   number(row.annual_sum_of_reported_series)+' '+esc(row.amount_unit),
   number(row.quantified_period_sum)+' '+esc(row.amount_unit),
   esc(row.period_coverage_by_series)+'<br><small>'+
   (truth(row.all_selected_permits_report_this_species)?'Every selected permit reports this species':'Permits without this species: '+esc(row.permits_without_this_reported_species))+
   '</small>']));
 const registry=Object.values(metadata.facility_registry||{});
 if(registry.length)html+='<details><summary>Original facility and gauge relationships</summary>'+table(
  ['Facility / permit','Mapped outfall / EPA reporting feature','Gauge relation','Network assignment'],
  registry.map(row=>[esc(row.facility_name)+'<br>'+esc(row.permit_id),esc(row.outfall_id||row.state_outfall_id)+'<br><small>Each EPA feature remains in its observation row</small>',
   esc(row.gauge_relation)+' of '+esc(row.gauge_id)+(truth(row.in_original_whole_basin)?'<small>Inside original whole-basin polygon</small>':''),
   esc(row.relation_method)+'<br><small>Reach '+esc(row.outfall_reachcode)+' · measure '+esc(row.outfall_measure)+'</small>']))+'</details>';
 html+=sourceCalendarMarkup(metadata.source_calendar);
 return html+'<p class="note">The retained source amounts describe discharge at the facilities. Network position identifies the upstream cohort; river delivery, attenuation and mixing remain separate from these amounts.</p>';
}
export function observationContextMarkup(rows=[]){
 if(!rows.length)return '';
 return '<h3>Original source quantities alongside this comparison</h3><p>'+Math.min(rows.length,150)+' of '+rows.length+' retained context rows. The original observation edition retains every source record.</p>'+table(
  ['Record / station','Measurement support','Original quantity / period','Method / comparison context'],
  rows.slice(0,150).map(row=>[esc(row.observation_id)+'<br>'+esc(row.station_id),
   observationSupportMarkup(row),esc(row.value_text)+' '+esc(row.unit)+'<br><small>'+esc(row.period_start)+' — '+esc(row.period_end)+'</small>',
   esc(typeof row.method==='string'?row.method:JSON.stringify(row.method))+'<br><small>'+esc((row.comparison_issues||[]).join('; '))+'</small>']));
}

export function sourceCalendarMarkup(calendar){
 if(!calendar?.groups?.length)return '';
 const groups=calendar.groups.filter(row=>row.gauge_relation==='upstream');
 let html='<h3>Reported upstream source calendar</h3><p>'+esc(calendar.method)+'</p>';
 for(const group of groups){
  html+='<details><summary>'+esc(group.parameter_name)+' · '+esc(group.calendar_year)+' · '+esc(group.amount_unit)+'</summary>';
  if(group.complete_year)html+='<p>Complete reported annual amount: '+number(group.annual_amount)+' '+esc(group.amount_unit)+
   '. Largest complete month: '+esc(group.peak_complete_month)+' ('+number(group.peak_complete_month_amount)+' '+esc(group.amount_unit)+').</p>';
  else html+='<p>Quantified-period amount: '+number(group.quantified_period_amount)+' '+esc(group.amount_unit)+
   '. Original incomplete periods and permits without this species remain visible below.</p>';
  if(group.facility_mix.length)html+=table(['Facility / permit','Reported annual amount','Share of complete upstream source total'],
   group.facility_mix.map(row=>[esc(row.facility_name)+'<br>'+esc(row.permit_id),number(row.annual_amount)+' '+esc(group.amount_unit),number(row.annual_share_percent)+'%']));
  html+=table(['Month','Quantified source amount','Complete cohort amount','Actual per-series coverage'],
   group.months.map(row=>[esc(row.month),number(row.quantified_amount)+' '+esc(group.amount_unit),number(row.complete_cohort_amount)+' '+esc(group.amount_unit),
    row.series.map(series=>esc(series.permit_id)+' / '+esc(series.reporting_feature)+': '+number(series.quantified_days)+' / '+number(series.expected_days)+' days').join('<br>')]));
  if(group.permits_without_species.length)html+='<p>Selected permits without this reported species: '+esc(group.permits_without_species.join(', '))+'.</p>';
  html+='</details>';
 }
 return html+'<p class="note">'+esc(calendar.interpretation)+'</p>';
}

/* The server supplies these exact typed blocks; the browser does not recompute fit. */
export function observationDiagnosticsMarkup(comparison){
 const review=comparison.diagnostics;
 if(!review||!Array.isArray(review.blocks))return '<p class="note">This saved comparison predates the cohort review. A current scientific delivery derives the review from its retained rows; a newly saved comparison also carries the review here.</p>';
 const block=item=>{
  if(typeof item==='string')return '<p>'+esc(item)+'</p>';
  if(item&&item.kind==='table'&&Array.isArray(item.columns)&&Array.isArray(item.rows)){
   return table(item.columns,item.rows.map(row=>row.map(value=>esc(value))))+
    (item.caption?'<p class="note">'+esc(item.caption)+'</p>':'');
  }
  return '';
 };
 return '<details class="observation-diagnostics"><summary>Annual-load cohorts and catchment weighting</summary>'+
  review.blocks.map(block).join('')+'</details>';
}
