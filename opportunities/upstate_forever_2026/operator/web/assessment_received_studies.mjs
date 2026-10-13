/** Original editable assessment lineage in the selected Study receiving view. */
const list=value=>Array.isArray(value)?value:[];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validID=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const count=value=>Number.isSafeInteger(value)&&value>=0?value.toLocaleString():'—';
const button=(action,label,index,disabled)=>'<button type="button" data-received-action="assessment-'+action+'" data-assessment-source="'+index+'" '+(disabled?'disabled':'')+'>'+esc(label)+'</button>';
function files(rows,label){
  const links=list(rows).filter(row=>/^\/api\/file\/[0-9a-f]{64}$/.test(row.url||''));
  if(!links.length)return '';
  return '<details class="st-details"><summary>'+esc(label)+'</summary><ul class="st-received-files">'+
    links.map(row=>'<li><a href="'+esc(row.url)+'?download=1" download>'+esc(row.label||row.filename)+'</a><small> '+count(row.bytes)+' B</small></li>').join('')+'</ul></details>';
}
function summaryHTML(row){
  const summary=row.summary||row.native?.context?.summary||{};
  const values=[['Assessment records',summary.assessment_row_count],['Stations',summary.station_count],
    ['Watersheds',summary.watershed_count],['Inventories',summary.inventory_count]];
  const entries=values.filter(([,value])=>Number.isSafeInteger(value)&&value>=0);
  return (entries.length?'<dl>'+entries.map(([label,value])=>'<dt>'+esc(label)+'</dt><dd>'+count(value)+'</dd>').join('')+'</dl>':'')+
    (row.original_selection?.relationship_basis?'<p>Watershed association: '+esc(row.original_selection.relationship_basis)+'.</p>':'');
}
export function receivedAssessmentHTML(detail,disabled=false){
  const rows=list(detail?.assessment_sources);
  if(!rows.length)return '';
  return '<section class="st-received-assessments" aria-label="Original assessment contexts"><h4>Assessment context and original station geography</h4>'+
    rows.map((row,index)=>{
      const native=row.native;
      let html='<article class="st-received-source"><h4>'+esc(row.title||native?.context?.title||'Saved assessment context')+'</h4>'+
        summaryHTML(row);
      if(native){
        html+='<p>Open the retained context and station geography to inspect original assessment records, watershed comparisons and source selections.</p>'+
          '<div class="st-actions">'+button('open','Open saved assessment context',index,disabled)+
          button('stations','Open Station geography',index,disabled)+
          (native.parcel?button('parcels','Open saved parcel associations',index,disabled):'')+'</div>';
      }else{
        html+='<p>The complete original assessment package is retained with this source. Receive its editable station and assessment records into this Workspace to continue the study.</p>'+
          '<div class="st-actions">'+button('receive','Receive editable assessment',index,disabled)+'</div>';
      }
      html+='<div class="st-actions">'+button('report','Open this report source only',index,disabled)+
        button('append','Add to current report',index,disabled)+'</div>'+
        '<details class="st-details"><summary>Original source identity</summary><dl>'+
        '<dt>Original project</dt><dd><code>'+esc(row.source_project_id)+'</code></dd>'+
        '<dt>Source collection</dt><dd><code>'+esc(row.source?.source_collection_id)+'</code></dd>'+
        '<dt>Source</dt><dd>'+esc(row.source?.source_id)+'</dd>'+
        '<dt>Source body SHA256</dt><dd><code>'+esc(row.source_body_sha256)+'</code></dd>'+
        '<dt>Original context</dt><dd><code>'+esc(row.context_id)+'</code></dd>'+
        (row.parcel_id?'<dt>Original parcel association</dt><dd><code>'+esc(row.parcel_id)+'</code></dd>':'')+
        '</dl></details>';
      if(native){
        html+=files(native.context?._downloads,'Original assessment files')+
          files(native.station?._downloads,'Original Station geography files')+
          files(native.parcel?._downloads,'Original parcel association files');
      }
      for(const report of list(detail.reports).filter(report=>list(row.report_ids).includes(report.id)))
        html+=files(report._downloads,'Saved scientific report: '+report.title);
      return html+files(row._downloads,'Complete source, maps and editable packages')+'</article>';
    }).join('')+'</section>';
}
export async function openReceivedAssessment(host,detail,target,{workspace_key,current}){
  const action=target?.dataset?.receivedAction;
  if(!action?.startsWith('assessment-'))return false;
  const encoded=target.dataset.assessmentSource;
  const index=typeof encoded==='string'&&/^(0|[1-9][0-9]*)$/.test(encoded)?Number(encoded):-1;
  const row=Number.isSafeInteger(index)&&index>=0?list(detail?.assessment_sources)[index]:null;
  if(!row||detail.workspace_key!==workspace_key||!current())
    throw Error('Reopen this saved Study in its receiving Workspace.');
  const source=row.source;
  if(!validID(source?.source_collection_id)||typeof source?.source_id!=='string'||!source.source_id||
      !validID(row.source_body_sha256))
    throw Error('Choose this Study’s retained original assessment source.');
  if(action==='assessment-report'||action==='assessment-append'){
    if(typeof host.openScientificReport!=='function')throw Error('Use the maintained Scientific Reports composer.');
    await host.openScientificReport({workspace_key,sources:[{...source}],title:row.title||'',
      selection_mode:action==='assessment-report'?'replace':'append'});
    return true;
  }
  if(action==='assessment-receive'){
    if(typeof host.openDesk!=='function')throw Error('Use the maintained Assessment context desk.');
    await host.openDesk('assessment-context','adoptSource',{workspace_key,...source,
      source_body_sha256:row.source_body_sha256});
    return true;
  }
  const native=row.native;
  if(!native||!validID(native.context?.id)||!validID(native.station?.id))
    throw Error('Receive this source’s editable assessment records into the Workspace first.');
  if(action==='assessment-stations'){
    if(typeof host.openExtension!=='function')throw Error('Use the maintained Station geography desk.');
    await host.openExtension('station-geography','open',native.station.id,workspace_key);
    return true;
  }
  if(action==='assessment-open'||action==='assessment-parcels'){
    if(action==='assessment-parcels'&&!validID(native.parcel?.id))
      throw Error('Choose a parcel association retained with this source.');
    if(typeof host.openDesk!=='function')throw Error('Use the maintained Assessment context desk.');
    await host.openDesk('assessment-context','openSavedContext',{workspace_key,context_id:native.context.id,
      ...(action==='assessment-parcels'?{parcel_id:native.parcel.id}:{})});
    return true;
  }
  throw Error('Choose a retained assessment source action.');
}
