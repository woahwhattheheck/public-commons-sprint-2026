/** Retained Parameter designs and frozen report sources in received Studies. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=value=>Array.isArray(value)?value:[];
const validID=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const count=value=>Number.isSafeInteger(value)&&value>=0?value.toLocaleString():'—';
const opening=new WeakMap();
const button=(action,label,index,disabled,extra='')=>'<button type="button" data-received-action="parameter-study-'+action+
  '" data-parameter-source="'+index+'" '+(disabled?'disabled ':'')+extra+'>'+esc(label)+'</button>';
const stateText=value=>Object.entries(value?.case_states||{}).map(([name,total])=>count(total)+' '+name.replaceAll('_',' ')).join(' · ');
function downloads(rows,label){
  const links=list(rows).filter(row=>/^\/api\/file\/[0-9a-f]{64}$/.test(row.url||''));
  return links.length?'<details class="st-details"><summary>'+esc(label)+'</summary><ul class="st-received-files">'+
    links.map(row=>'<li><a href="'+esc(row.url)+'?download=1" download>'+esc(row.label||row.filename)+
      '</a><small>'+count(row.bytes)+' B</small></li>').join('')+'</ul></details>':'';
}
export function receivedParameterStudiesHTML(detail,disabled=false){
  const rows=list(detail?.parameter_study_sources);
  if(!rows.length)return '';
  return '<section aria-label="Original Parameter studies"><h4>Parameter studies and saved source editions</h4>'+
    rows.map((row,index)=>{
      const local=row.editable===true&&row.relationship==='same_project';
      const design=typeof row.design==='string'?row.design:'Original saved parameter design';
      let html='<article class="st-received-source"><h4>'+esc(row.title)+'</h4>'+
        (row.purpose?'<p>'+esc(row.purpose)+'</p>':'')+
        '<p>'+esc(design)+' · '+esc(list(row.models).map(x=>x==='ndr'?'Nutrients':x==='sdr'?'Sediment':x).join(' and '))+
        ' · '+count(list(row.selected_case_ids).length)+' selected report cases of '+count(row.captured_state?.case_count)+' prepared cases.</p>'+
        '<p><strong>Captured report edition:</strong> '+esc(row.captured_state?.state||'Unspecified')+
        (stateText(row.captured_state)?' · '+esc(stateText(row.captured_state)):'')+'.</p>'+
        (local?'<p><strong>Current retained study:</strong> '+esc(row.current_state?.state||'Unspecified')+
          (stateText(row.current_state)?' · '+esc(stateText(row.current_state)):'')+
          '. Open the saved study to inspect original inputs, completed results and its existing continuation controls.</p>':
          '<p>The original report comes from another project. Its captured inputs and results remain available in this source edition.</p>')+
        '<div class="st-actions">'+
        (local?button('open','Open saved study',index,disabled)+button('baseline','Open reference run',index,disabled):'')+
        button('compose','Add source to report',index,disabled)+'</div>'+
        '<details class="st-details"><summary>Original selected cases</summary><div class="st-table-scroll"><table class="st-table">'+
        '<thead><tr><th>Case</th><th>Captured state</th><th>Original profile</th><th>Native run</th></tr></thead><tbody>'+
        list(row.selected_cases).map((item,position)=>'<tr><td>'+esc(item.label)+'<small>'+esc(item.id)+'</small></td><td>'+
          esc(item.state||'Unspecified')+'</td><td><code>'+esc(item.profile_id)+'</code></td><td>'+
          (local?button('run','Open saved run',index,disabled,'data-parameter-run="'+position+'"'):'<code>'+esc(item.run_id)+'</code>')+
          '</td></tr>').join('')+'</tbody></table></div></details>'+
        '<details class="st-details"><summary>Source identities and reference</summary><dl>'+
        [['Original project',row.source_project_id],['Original study',row.experiment_id],
         ['Fixed reference run',row.baseline_run_id],['Captured result SHA-256',row.source_result_sha256],
         ['Scientific source SHA-256',row.source_body_sha256]]
          .map(([label,value])=>'<dt>'+esc(label)+'</dt><dd><code>'+esc(value)+'</code></dd>').join('')+
        '</dl><p>Opening the current study does not replace this captured scientific-report edition. Original result units, masks and paired coverage stay with its exported tables.</p></details>'+
        downloads(row._result_downloads,'Captured study results and exports');
      for(const report of list(detail.reports).filter(report=>list(row.report_ids).includes(report.id)))
        html+=downloads(report._downloads,'Scientific report: '+report.title);
      return html+downloads(row._downloads,'Complete original source, inputs and methods')+'</article>';
    }).join('')+'</section>';
}
export async function openReceivedParameterStudy(host,detail,target,{workspace_key,current}){
  const action=target?.dataset?.receivedAction;
  if(!action?.startsWith('parameter-study-'))return false;
  const index=Number(target.dataset.parameterSource);
  const row=Number.isSafeInteger(index)&&index>=0?list(detail?.parameter_study_sources)[index]:null;
  if(!row||detail.workspace_key!==workspace_key||!current())
    throw Error('Reopen the original Parameter source in its received Study.');
  const turn=(opening.get(host)||0)+1;opening.set(host,turn);
  const selected=()=>opening.get(host)===turn&&current();
  if(action==='parameter-study-compose'){
    if(typeof host.openScientificReport!=='function')throw Error('Use the maintained scientific report composer.');
    const source=row.source;
    if(!validID(source?.source_collection_id)||typeof source.source_id!=='string'||!source.source_id)
      throw Error('Choose the original retained Parameter scientific source.');
    if(!selected())return true;
    await host.openScientificReport({workspace_key,sources:[source],title:row.title});
    return true;
  }
  if(row.editable!==true||row.relationship!=='same_project'||!validID(row.experiment_id))
    throw Error('This captured report source does not contain a local editable Parameter study.');
  if(action==='parameter-study-open'){
    if(typeof host.openParameterStudy!=='function')throw Error('Use the current Parameter studies desk.');
    await host.openParameterStudy({workspace_key,experiment_id:row.experiment_id},{current:selected});
    return true;
  }
  if(action==='parameter-study-baseline'||action==='parameter-study-run'){
    let run=row.baseline_run_id;
    if(action==='parameter-study-run'){
      const position=Number(target.dataset.parameterRun);
      run=Number.isSafeInteger(position)&&position>=0?list(row.selected_cases)[position]?.run_id:null;
    }
    if(!validID(run)||typeof host.openItem!=='function')throw Error('Choose an original native run retained with this study.');
    if(!selected())return true;
    await host.openItem('runs',run);
    return true;
  }
  throw Error('Choose a retained Parameter study action.');
}
