/** Original Gauge lineage inside the existing received Study view. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=value=>Array.isArray(value)?value:[];
const number=value=>Number.isFinite(Number(value))?Number(value).toLocaleString():'—';
const sourceKey=value=>JSON.stringify([value?.source_collection_id,value?.source_id]);
const button=(action,label,index,disabled)=>'<button type="button" data-received-action="gauge-'+action+'" data-gauge-source="'+index+'" '+(disabled?'disabled':'')+'>'+esc(label)+'</button>';
const links=rows=>list(rows).filter(row=>/^\/api\/file\/[0-9a-f]{64}$/.test(row.url||'')).map(row=>'<li><a href="'+esc(row.url)+'?download=1" download>'+esc(row.label||row.filename)+'</a><small> '+number(row.bytes)+' B</small></li>').join('');
const downloads=(rows,label)=>'<details class="st-details"><summary>'+esc(label)+'</summary><ul class="st-received-files">'+links(rows)+'</ul></details>';
function selectionHTML(value){
  const selection=value.original_selection||{},hucs=list(selection.reporting_huc12s),utilities=list(selection.utility_sources),native=value.native;
  return '<dl><dt>Reporting watersheds</dt><dd>'+hucs.length+'</dd>'+
    '<dt>Utility source footprints</dt><dd>'+utilities.length+'</dd>'+
    '<dt>Catchment support</dt><dd>'+esc(value.support?.title||value.support?.kind||selection.support_kind||'Original retained source')+'</dd></dl>'+
    '<details class="st-details"><summary>Source details</summary><dl>'+
    '<dt>Original project</dt><dd><code>'+esc(value.source_project_id)+'</code></dd>'+
    '<dt>Source body SHA256</dt><dd><code>'+esc(value.source_body_sha256)+'</code></dd>'+
    (native?'<dt>Gauge build</dt><dd><code>'+esc(native.gauge.build_id)+'</code></dd><dt>Station build</dt><dd><code>'+esc(native.station.build_id)+'</code></dd>':'')+
    '<dt>Selected HUC12s</dt><dd>'+hucs.map(esc).join(', ')+'</dd></dl></details>';
}

export function receivedGaugePreview(rows){
  rows=list(rows).filter(row=>row.report_context_kind==='gauge_support');
  if(!rows.length)return '';
  return '<section class="st-details"><h4>Gauge and regional sources behind these reports</h4><ul>'+rows.map(row=>
    '<li>'+esc(row.relationship==='same_project'?'Editable original Gauge, Station Geography and regional report':'Contained source from another original project')+
    ' · '+esc(row.support?.title||row.support?.kind||'Original selected catchment support')+
    ' · '+list(row.original_selection?.reporting_huc12s).length+' selected watersheds</li>').join('')+'</ul></section>';
}
export function receivedGaugeHTML(detail,disabled=false){
  const rows=list(detail?.gauge_sources);if(!rows.length)return '';
  return '<section class="st-received-gauges" aria-label="Original Gauge and regional sources"><h4>Gauge support and original geography</h4>'+
    rows.map((row,index)=>{
      const native=row.native;
      let html='<article class="st-received-source"><h4>'+esc(row.title)+'</h4>'+
        '<p>'+esc(row.support?.description||'Original gauge, catchment and reporting-area relationships are retained with this scientific source.')+'</p>'+
        selectionHTML(row);
      if(native){
        html+='<p>Open the exact saved Gauge edition to inspect its map, original coverage and source selections. Reuse its retained selection in that desk when preparing another edition.</p>'+
          '<div class="st-actions">'+button('open','Open Gauge support',index,disabled)+
          button('stations','Open Station Geography',index,disabled)+
          button('regional','Open regional report',index,disabled)+
          button('compose','Add source to report',index,disabled)+'</div>'+
          downloads(native.gauge._downloads,'Gauge files')+
          downloads(native.station._downloads,'Station Geography files')+
          downloads(native.regional._downloads,'Regional report files');
      }else{
        html+='<p>The scientific source originated in another project. Its complete captured Gauge results and original source companions remain below. Native editable controls are available when those original records belong to the receiving project.</p>'+
          '<div class="st-actions">'+button('compose','Add source to report',index,disabled)+'</div>';
      }
      const reports=list(detail.reports).filter(report=>list(row.report_ids).includes(report.id));
      for(const report of reports)html+=downloads(report._downloads,'Saved scientific report: '+report.title);
      return html+downloads(row._downloads,'Source data and maps')+'</article>';
    }).join('')+'</section>';
}
export async function openReceivedGauge(host,detail,target,{workspace_key,current}){
  const action=target?.dataset?.receivedAction;
  if(!action?.startsWith('gauge-'))return false;
  const index=Number(target.dataset.gaugeSource);
  const row=Number.isSafeInteger(index)&&index>=0?list(detail?.gauge_sources)[index]:null;
  if(!row||detail.workspace_key!==workspace_key||!current())
    throw Error('Reopen this saved Study in its receiving Workspace.');
  const key=sourceKey(row.source);
  if(!row.source?.source_collection_id||!row.source?.source_id)
    throw Error('Choose the retained original Gauge source.');
  if(action==='gauge-compose'){
    if(typeof host.openScientificReport!=='function')throw Error('Use the current Scientific Reports composer.');
    if(!current()||sourceKey(row.source)!==key)return true;
    await host.openScientificReport({workspace_key,sources:[{...row.source}],title:row.title});
    return true;
  }
  if(!row.native)throw Error('This source retains an external original project; open its complete captured files.');
  if(action==='gauge-open'){
    if(typeof host.openExtension!=='function')throw Error('Use the current Gauge support desk.');
    await host.openExtension('gauge-support','openSavedStudy',{
      workspace_key,edition_id:row.native.gauge.id,study_id:detail.id,
      build_id:row.native.gauge.build_id,source:{...row.source},
    });
    return true;
  }
  if(action==='gauge-stations'){
    if(typeof host.openExtension!=='function')throw Error('Use the current Station Geography desk.');
    await host.openExtension('station-geography','open',row.native.station.id);
    return true;
  }
  if(action==='gauge-regional'){
    if(typeof host.openItem!=='function')throw Error('Use the current original regional report view.');
    await host.openItem('watershed-context',row.native.regional.id);
    return true;
  }
  throw Error('Choose a retained Gauge source action.');
}
