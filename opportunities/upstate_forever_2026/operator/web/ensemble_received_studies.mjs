/** Original native model studies in the existing received-Study view. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=value=>Array.isArray(value)?value:[];
const count=value=>Number.isSafeInteger(value)&&value>=0?value.toLocaleString():'—';
const button=(action,title,index,disabled)=>'<button type="button" data-received-action="native-ensemble-'+action+
  '" data-native-ensemble-source="'+index+'" '+(disabled?'disabled':'')+'>'+esc(title)+'</button>';
function downloads(rows,title){
  const links=list(rows).filter(row=>/^\/api\/file\/[0-9a-f]{64}$/.test(row.url||''));
  if(!links.length)return '';
  return '<details class="st-details"><summary>'+esc(title)+'</summary><ul class="st-received-files">'+
    links.map(row=>'<li><a href="'+esc(row.url)+'?download=1" download>'+esc(row.label||row.filename)+
      '</a><small>'+Number(row.bytes||0).toLocaleString()+' B</small></li>').join('')+'</ul></details>';
}
export function receivedNativeEnsemblePreview(rows){
  rows=list(rows).filter(row=>row.report_context_kind==='native_ensemble_study');
  if(!rows.length)return '';
  return '<section class="st-details"><h4>Native model studies behind these reports</h4><ul>'+
    rows.map(row=>'<li>'+esc(row.relationship==='same_project'?
      'Original editable study, native runs and captured physical report':
      'Captured native study from another source project')+'</li>').join('')+'</ul></section>';
}
export function receivedNativeEnsembleHTML(detail,disabled=false){
  const rows=list(detail?.native_ensemble_sources);if(!rows.length)return '';
  return '<section class="st-received-native-ensembles" aria-label="Original native model studies">'+
    '<h4>Model studies and original physical results</h4>'+rows.map((row,index)=>{
      const models=list(row.model_scope?.selected_models).map(x=>x==='ndr'?'Nutrients':x==='sdr'?'Sediment':x).join(' and ');
      let html='<article class="st-received-source"><h4>'+esc(row.title)+'</h4>'+
        '<p>'+esc(models||'Original selected model outputs')+' · '+count(row.member_count)+' parameter cases · '+
        count(row.alternative_count)+' land-cover alternatives.</p>'+
        '<p>'+count(row.landcover_rows)+' land-cover contrasts and '+count(row.parameter_rows)+
        ' baseline parameter contrasts. Values keep the original annual units and common-cell coverage.</p>'+
        '<div class="st-actions">'+button('open','View saved model results',index,disabled)+
        button('compose','Add source to report',index,disabled)+'</div>'+
        '<p>'+(row.relationship==='same_project'?
          'The original editable design and selected native runs are also retained in this Workspace.':
          'This source retains its original project’s captured results and scientific inputs.')+'</p>'+
        '<details class="st-details"><summary>Source details</summary><dl>'+
        [['Original project',row.source_project_id],['Study',row.ensemble_id],['Physical report',row.report_id],
         ['Scientific source',row.source_operation_id],['Original source hash',row.source_body_sha256]]
        .map(([name,value])=>'<dt>'+esc(name)+'</dt><dd><code>'+esc(value)+'</code></dd>').join('')+
        '</dl></details>'+downloads(row._numeric_downloads,'Physical report and tables');
      for(const report of list(detail.reports).filter(x=>list(row.report_ids).includes(x.id)))
        html+=downloads(report._downloads,'Scientific report: '+report.title);
      return html+downloads(row._downloads,'Original source data, methods and figures')+'</article>';
    }).join('')+'</section>';
}
export async function openReceivedNativeEnsemble(host,detail,target,{workspace_key,current}){
  const action=target?.dataset?.receivedAction;
  if(!action?.startsWith('native-ensemble-'))return false;
  const index=Number(target.dataset.nativeEnsembleSource);
  const row=Number.isSafeInteger(index)&&index>=0?list(detail?.native_ensemble_sources)[index]:null;
  if(!row||detail.workspace_key!==workspace_key||!current())
    throw Error('Reopen this saved Study in its receiving Workspace.');
  const source={source_collection_id:row.source?.source_collection_id,source_id:row.source?.source_id};
  if(!source.source_collection_id||!source.source_id)throw Error('Choose the original native study source.');
  if(action==='native-ensemble-compose'){
    if(typeof host.openScientificReport!=='function')throw Error('Use the current scientific report composer.');
    if(!current())return true;
    await host.openScientificReport({workspace_key,sources:[source],title:row.title});
    return true;
  }
  if(action==='native-ensemble-open'){
    if(typeof host.openExtension!=='function')throw Error('Use the current Scenario sensitivity desk.');
    if(!current())return true;
    await host.openExtension('ensembles','openSavedStudy',{
      workspace_key,study_id:detail.id,ensemble_id:row.ensemble_id,report_id:row.report_id,
      source_operation_id:row.source_operation_id,source,
    });
    return true;
  }
  throw Error('Choose a retained native model study action.');
}
