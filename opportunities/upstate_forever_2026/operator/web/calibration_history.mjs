/* Scientific comparison of the original selected-profile evaluation chain. */
export function createCalibrationHistory({section,button,number,esc,table}){
  let history=null,previous='',parameter='',status='all',page=0;
  const perPage=25;
  const labels={
    paired:'Same reference support',incomplete_prediction:'Incomplete native prediction',
    changed_reference_support:'Reference support changed',new_reference_support:'New reference support',
    earlier_reference_only:'Earlier reference only',calibration:'Training',validation:'Validation',
    reference_csv_sha256:'original observation table',catchment_source:'catchment source or selected layer',
    observation_record_ids:'reference records',periods:'reference periods or period weights',
    temporal_weighting:'temporal weighting',observed_annual_mass:'reference annual load',
    reference_methods:'original reference method',catchment_id:'catchment identifier',
    parameter:'constituent',units:'annual-load unit','metric_tonnes/year':'metric tonnes/year'
  };
  const label=value=>labels[value]||String(value??'');
  const shown=value=>value===null||value===undefined?'—':typeof value==='boolean'?(value?'Yes':'No'):
    Array.isArray(value)?esc(value.map(label).join('; ')):typeof value==='number'?number(value):esc(label(value));
  const cell=value=>'<td>'+shown(value)+'</td>';
  function reset(value){
    if(history?.id===value?.id){history=value;return;}
    history=value;previous=value?.evaluations?.at(-2)?.calibration_id||'';
    parameter='';status='all';page=0;
  }
  function choice(name,title,options,value){
    return '<label><span>'+esc(title)+'</span><select data-calibration-history-filter="'+name+'">'+
      options.map(([id,text])=>'<option value="'+esc(id)+'"'+(id===value?' selected':'')+'>'+esc(text)+'</option>').join('')+'</select></label>';
  }
  function selectedRows(){
    return (history?.paired_changes??[]).filter(row=>
      (!previous||row.earlier_calibration_id===previous)&&(!parameter||row.parameter===parameter)&&
      (status==='all'||status==='paired'&&row.state==='paired'||status==='unmatched'&&row.state!=='paired'));
  }
  function render(value){
    reset(value);
    if(!history||history.evaluations.length<2)return '';
    const earlier=history.evaluations.slice(0,-1),current=history.evaluations.at(-1);
    const selected=earlier.find(row=>row.calibration_id===previous);
    const pairs=history.pair_summaries.filter(row=>
      (!previous||row.earlier_calibration_id===previous)&&(!parameter||row.parameter===parameter));
    const rows=selectedRows(),pages=Math.max(1,Math.ceil(rows.length/perPage));
    page=Math.min(page,pages-1);
    const timeline=table(['Evaluation','Selected profile','Own training loss','Training / validation groups',''],
      history.evaluations.map(row=>'<tr><td>'+esc(row.evaluation_order+'. '+row.title)+
        (row.calibration_id===current.calibration_id?'<small>Current evaluation</small>':'')+'</td>'+
        '<td>'+esc(row.selected_profile_title??'—')+'</td>'+cell(row.objective_score)+
        '<td>'+number(row.training_groups)+' / '+number(row.validation_groups)+'</td><td>'+
        button('report','Open original',row.calibration_id)+'</td></tr>'));
    const summary=pairs.length?table(['Constituent / unit','Partition: earlier → current','Common catchments',
      'Earlier RMSE','Current RMSE','RMSE change','Catchments with smaller / equal / larger errors'],
      pairs.map(row=>'<tr><td>'+esc(label(row.parameter))+'<small>'+esc(label(row.units))+'</small></td>'+
        '<td>'+esc(label(row.earlier_partition))+' → '+esc(label(row.current_partition))+'</td>'+
        cell(row.matched_catchments)+cell(row.earlier_rmse)+cell(row.current_rmse)+cell(row.rmse_change)+
        '<td>'+number(row.smaller_absolute_error)+' / '+number(row.equal_absolute_error)+' / '+
        number(row.larger_absolute_error)+(row.external_assumption_changes?'<small>'+
          number(row.external_assumption_changes)+' also changed delivered external-load assumptions.</small>':'')+'</td></tr>')):
      '<p class="calibration-empty">These selections have no complete paired reference units for the current filters. The original rows and changed support remain available below.</p>';
    const detail=table(['Catchment / constituent','Reference support','Partition: earlier → current',
      'Observed','Earlier modeled','Current modeled','Absolute error change','Native / external load change'],
      rows.slice(page*perPage,(page+1)*perPage).map(row=>'<tr><td>'+esc(row.catchment_id)+'<small>'+
        esc(label(row.parameter))+' · '+esc(label(row.units))+'</small></td><td>'+esc(label(row.state))+
        (row.changed_reference_fields?.length?'<small>'+esc(row.changed_reference_fields.map(label).join('; '))+'</small>':'')+
        '</td><td>'+shown(row.earlier_partition)+' → '+shown(row.current_partition)+'</td>'+
        cell(row.observed_annual_mass)+cell(row.earlier_modeled)+cell(row.current_modeled)+cell(row.absolute_error_change)+
        '<td>'+shown(row.native_load_change)+' / '+shown(row.external_load_change)+
        (row.external_load_assumptions_changed?'<small>External-load source assumptions changed.</small>':'')+'</td></tr>'));
    const filters='<div class="form-grid">'+choice('previous','Compare current with',
      earlier.map(row=>[row.calibration_id,row.evaluation_order+'. '+row.title]),previous)+
      choice('parameter','Constituent',[['','All constituents'],...Array.from(new Set(history.paired_changes.map(row=>row.parameter))).sort().map(value=>[value,label(value)])],parameter)+
      choice('status','Reference rows',[['all','All references'],['paired','Paired complete references'],['unmatched','Changed or incomplete references']],status)+'</div>';
    return section('Selected-profile history',
      'Compare current physical errors with an earlier selected native profile on the same original annual references. Negative error changes mean smaller errors on the displayed common support.',
      '<div class="section-body"><details><summary>'+number(history.evaluations.length)+' original evaluations and their own training designs</summary>'+
      timeline+'<p>Each training loss retains its own objective and normalization. Scores from different designs are shown separately.</p></details>'+
      filters+'<h3>Current evaluation against '+esc(selected?.title||'the selected earlier evaluation')+'</h3>'+summary+
      '<details><summary>Individual catchment changes and reference support · '+number(rows.length)+' rows</summary>'+
      detail+'<div class="page-actions">'+button('history-page','Previous','','',page===0?'disabled':'')+
      '<span>Page '+number(page+1)+' of '+number(pages)+'</span>'+
      button('history-next','Next','','',page+1>=pages?'disabled':'')+'</div></details>'+
      '<p>Residuals are modeled minus observed annual load. Changes in native loads and delivered external loads are shown separately. Training/validation transitions retain their original meaning.</p>'+
      '<div class="page-actions">'+button('history-export','Export selected-profile history',current.calibration_id,true)+'</div>'+
      '<details><summary>Comparison methods and interpretation</summary><ul>'+history.notes.map(note=>'<li>'+esc(note)+'</li>').join('')+'</ul></details></div>');
  }
  function bind(root,repaint){
    for(const node of root.querySelectorAll('[data-calibration-history-filter]')){
      node.addEventListener('change',()=>{
        const key=node.dataset.calibrationHistoryFilter;
        if(key==='previous')previous=node.value;
        else if(key==='parameter')parameter=node.value;
        else if(key==='status')status=node.value;
        page=0;repaint();
      });
    }
  }
  function dispatch(node,repaint){
    if(node.dataset.action==='calibration-history-page'){page=Math.max(0,page-1);repaint();return true;}
    if(node.dataset.action==='calibration-history-next'){page++;repaint();return true;}
    return false;
  }
  return {render,bind,dispatch};
}
