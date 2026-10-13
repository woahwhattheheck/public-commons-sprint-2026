/* Original annual-source editions used by the Calibration sensitivity desk. */
const F7_DOI='10.5066/F7DN436B';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const table=(heads,rows)=>'<div class="table-scroll"><table><thead><tr>'+
  heads.map(value=>'<th scope="col">'+esc(value)+'</th>').join('')+
  '</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';

export function referenceErrorOptions(catalog,retainedId=''){
  const rows=new Map();
  for(const row of catalog?.observations??[]){
    const metadata=row.metadata??{},id=row.id||row.observation_id;
    if(!id||!(row.admitted_count>0)||metadata.release?.doi!==F7_DOI)continue;
    rows.set(id,[id,(row.title||metadata.title||id)+' · '+row.admitted_count+' annual records · USGS F7DN436B']);
  }
  if(retainedId&&!rows.has(retainedId))rows.set(retainedId,[retainedId,'Retained source edition · '+retainedId.slice(0,12)]);
  return [['original','Original saved observation errors'],...rows.values()];
}

export function referenceErrorMultiplierNote(referenceId){
  return referenceId&&referenceId!=='original'
    ?'1 uses one published F7 standard error. 0 uses the exact F7 annual estimates. The original P9 objective remains a separate saved baseline.'
    :'1 uses one published standard error. 0 reproduces the original reference point. Nonnegative source bounds are retained; absent errors remain visible.';
}

export function referenceErrorSummary(analysis){
  const source=analysis?.external_reference;
  if(!source)return '';
  const matches=source.matches??[];
  const used=new Set((analysis.source_records??[]).map(row=>row.record_id));
  const rows=matches.map(row=>{
    const original=row.f7_record??{},method=row.published_final_method??original.final_method;
    const start=row.water_quality_start??original.temporal_basis?.water_quality_start;
    const end=row.water_quality_end_inclusive??original.temporal_basis?.water_quality_end;
    return '<tr>'+[
      used.has(row.p9_record_id)?'Used in saved evaluation':'Source context',row.catchment_name||row.comid,row.parameter,row.station_id,
      row.p9_value_exact,row.f7_value_exact,row.f7_standard_error_exact,row.comparison_unit,
      method,start&&end?start+' to '+end:'—',
    ].map(value=>'<td>'+esc(value??'—')+'</td>').join('')+'</tr>';
  });
  return '<section class="section"><header class="section-header"><div><h2>Published annual source edition</h2>'+
    '<p>The original P9 calibration and the related F7 annual estimates retain their separate identities. Source-error intervals are centered on the exact F7 estimates.</p>'+
    '</div></header><div class="section-body"><p>Six selected Beale values are published long-term means. Stevens Creek phosphorus uses the published detrended Fluxmaster estimate. The table retains all seven source matches and identifies which records belong to this saved evaluation.</p>'+
    (source.observation_id?'<div class="page-actions"><button type="button" class="small" data-action="calibration-inspect-observation-edition" data-id="'+esc(source.observation_id)+'">Open annual source observations</button></div>':'')+
    '<p>At zero source-error multiplier, the result evaluates the F7 reference point. The original objective reproduction remains available in Candidate scores. Model predictions, original profile selection and training/validation groups stay attached to the saved calibration.</p></div>'+
    (rows.length?table(['Evaluation use','Catchment','Parameter','Station','P9 annual value','F7 annual value','Published SE','Unit','Final method','Water-quality dates'],rows):'')+
    '<details class="technical"><summary>Original source binding and record correspondence</summary><pre class="json-view">'+
    esc(JSON.stringify(source,null,2))+'</pre></details></section>';
}
