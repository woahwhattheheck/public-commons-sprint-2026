/** Original Calibration designs and evaluations in received editable Studies. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=value=>Array.isArray(value)?value:[];
const validID=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const human=value=>String(value??'').replaceAll('_',' ').replaceAll('-',' ');
const count=value=>Number.isSafeInteger(value)&&value>=0?value.toLocaleString():'—';
const number=value=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString(undefined,{maximumSignificantDigits:7}):'—';
const opening=new WeakMap();
const button=(action,label,index,disabled,extra='')=>'<button type="button" data-received-action="calibration-study-'+action+
  '" data-calibration-study="'+index+'" '+(disabled?'disabled ':'')+extra+'>'+esc(label)+'</button>';
const table=(heads,rows)=>'<div class="st-table-scroll"><table class="st-table"><thead><tr>'+
  heads.map(value=>'<th scope="col">'+esc(value)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
function downloads(rows,label){
  const files=list(rows).filter(row=>/^\/api\/file\/[0-9a-f]{64}$/.test(row.url||''));
  return files.length?'<details class="st-details"><summary>'+esc(label)+'</summary><ul class="st-received-files">'+
    files.map(row=>'<li><a href="'+esc(row.url)+'?download=1" download>'+esc(row.label||row.filename)+
      '</a><small>'+count(row.bytes)+' B</small></li>').join('')+'</ul></details>':'';
}
function metrics(rows){
  if(!rows.length)return '<p>Open the saved design to inspect the original candidate coverage and analysis progress.</p>';
  return table(['Evaluation partition','Constituent','Units','Catchments','RMSE','Mean bias','NSE'],rows.map(row=>
    '<tr><td>'+esc(human(row.partition))+'</td><td>'+esc(human(row.parameter))+'</td><td>'+esc(row.units)+'</td><td>'+
    count(row.n??row.catchments)+'</td><td>'+number(row.rmse)+'</td><td>'+number(row.mean_bias)+'</td><td>'+
    number(row.nash_sutcliffe_efficiency)+'</td></tr>'))+
    '<p>Errors retain each constituent’s original annual mass units and catchment support. Training and held-out results stay separate.</p>';
}
export function receivedCalibrationStudiesHTML(detail,disabled=false){
  const rows=list(detail?.calibration_studies);
  if(!rows.length)return '';
  return '<section aria-label="Original Calibration studies"><h4>Calibration designs and annual-reference evaluations</h4>'+
    rows.map((row,index)=>{
      const observation=row.observation||{},partitions=row.partitions||{};
      const report=validID(row.report_id),plan=validID(row.plan_id);
      const local=row.editable===true;
      return '<article class="st-received-source"><h4>'+esc(row.title)+'</h4>'+
        '<p><strong>Retained analysis:</strong> '+esc(human(row.state||'prepared'))+
        (row.evaluation_design?' · '+esc(human(row.evaluation_design)):'')+'.</p>'+
        '<dl><dt>Observation edition</dt><dd>'+esc(observation.title||'Original retained annual observations')+
        '</dd><dt>Original annual records</dt><dd>'+count(observation.record_count)+
        '</dd><dt>Candidate native runs</dt><dd>'+count(row.candidate_count)+
        '</dd><dt>Distinct parameter profiles</dt><dd>'+count(row.distinct_profile_count)+
        '</dd><dt>Training groups</dt><dd>'+count(list(partitions.calibration_group_ids).length)+
        '</dd><dt>Held-out groups</dt><dd>'+count(list(partitions.validation_group_ids).length)+'</dd>'+
        (row.selected_profile_title?'<dt>Selected profile</dt><dd>'+esc(row.selected_profile_title)+'</dd>':'')+'</dl>'+
        (row.current_state&&row.current_state!==row.state?'<p><strong>Current analysis progress:</strong> '+esc(human(row.current_state))+'.</p>':'')+
        '<div class="st-actions">'+(local&&report?button('result','Open original evaluation',index,disabled):'')+
        (local&&plan?button('plan','Open editable design',index,disabled):'')+
        (local&&validID(row.selected_run_id)?button('run','Open selected native run',index,disabled):'')+'</div>'+
        metrics(list(row.selected_metrics))+
        (row.history?.evaluation_count>1?'<p><strong>Selected-profile history:</strong> '+count(row.history.evaluation_count)+
          ' evaluations retained. Open the evaluation to compare physical errors on unchanged original references and inspect changed support.</p>':'')+
        (list(row.supplements).length?'<details class="st-details"><summary>Retained maps and scientific reviews</summary>'+
          table(['Supplement','Original state'],row.supplements.map(item=>'<tr><td>'+esc(item.title||human(item.kind))+
            '</td><td>'+esc(human(item.state||'retained'))+'</td></tr>'))+'</details>':'')+
        '<details class="st-details"><summary>Original observations, geography and scientific choices</summary><dl>'+
        [['Original project',row.source_project_id],['Calibration design',row.plan_id],['Evaluation',row.report_id||'Analysis not yet complete'],
         ['Observation edition',observation.id],['Original observation CSV SHA-256',observation.original_sha256],
         ['Catchment source',row.catchments?.title||row.catchments?.source_id],
         ['Catchment ID field',row.catchments?.id_field],['Selected native run',row.selected_run_id||'No eligible profile selected']]
          .map(([label,value])=>'<dt>'+esc(label)+'</dt><dd>'+esc(value||'Not recorded')+'</dd>').join('')+
        '</dl><p>The original source fields, annual periods, units, spatial groups, held-out assignments and candidate selections remain with this Study. '+
        'Opening or exporting an evaluation preserves its original result. Revisions use the ordinary Calibration controls.</p></details>'+
        downloads(row._result_downloads,'Readable results and original exported tables')+
        downloads(row._downloads,'Complete original design and source records')+'</article>';
    }).join('')+'</section>';
}
export async function openReceivedCalibrationStudy(host,detail,target,{workspace_key,current}){
  const action=target?.dataset?.receivedAction;
  if(!action?.startsWith('calibration-study-'))return false;
  const index=Number(target.dataset.calibrationStudy);
  const row=Number.isSafeInteger(index)&&index>=0?list(detail?.calibration_studies)[index]:null;
  if(!row||row.editable!==true||detail.workspace_key!==workspace_key||!current())
    throw Error('Reopen the original Calibration study in its received Workspace.');
  const turn=(opening.get(host)||0)+1;opening.set(host,turn);
  const selected=()=>opening.get(host)===turn&&current();
  if(action==='calibration-study-run'){
    if(!validID(row.selected_run_id)||typeof host.openItem!=='function')throw Error('Choose the original selected native run.');
    if(selected())await host.openItem('runs',row.selected_run_id);
    return true;
  }
  const kind=action==='calibration-study-plan'?'calibration-plans':action==='calibration-study-result'?'calibrations':null;
  const id=kind==='calibration-plans'?row.plan_id:row.report_id;
  if(!kind||!validID(id)||typeof host.openExtension!=='function')throw Error('Choose an original design or evaluation in the maintained Calibration desk.');
  if(!selected())return true;
  await host.openExtension('calibration','openForStudy',{workspace_key,kind,id,isCurrent:selected});
  return true;
}
