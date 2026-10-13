/** Exact selected-watershed source cards in the original received Study view. */
const list=value=>Array.isArray(value)?value:[];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const quantity=(value,digits=3)=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString(undefined,{maximumFractionDigits:digits}):'Not available';
const key=value=>JSON.stringify([value?.source_collection_id,value?.source_id]);
const button=(action,label,index,disabled)=>'<button type="button" data-received-action="landcover-'+action+'" data-landcover-source="'+index+'" '+(disabled?'disabled':'')+'>'+esc(label)+'</button>';
function downloads(rows,title){
  const items=list(rows).filter(row=>/^\/api\/file\/[0-9a-f]{64}$/.test(row.url||''));
  return '<details class="st-details"><summary>'+esc(title)+'</summary><ul class="st-received-files">'+
    items.map(row=>'<li><a href="'+esc(row.url)+'?download=1" download>'+esc(row.label||row.filename)+
      '</a><small> '+quantity(row.bytes,0)+' B</small></li>').join('')+'</ul></details>';
}
function measures(summary){
  return '<dl><dt>Paired-valid area</dt><dd>'+quantity(summary?.paired_valid_area_ha)+' ha</dd>'+
    '<dt>Changed land-cover class area</dt><dd>'+quantity(summary?.changed_area_ha)+' ha</dd>'+
    '<dt>Changed share of paired-valid cells</dt><dd>'+quantity(summary?.changed_percent_of_paired_valid)+
    (typeof summary?.changed_percent_of_paired_valid==='number'?'%':'')+'</dd>'+
    '<dt>Paired-valid cells</dt><dd>'+quantity(summary?.paired_valid_cells,0)+'</dd>'+
    '<dt>Changed-class cells</dt><dd>'+quantity(summary?.changed_class_cells,0)+'</dd></dl>';
}
export function receivedObservedLandcoverHTML(detail,disabled=false){
  const rows=list(detail?.observed_landcover_sources);
  if(!rows.length)return '';
  return '<section class="st-received-landcover" aria-label="Selected watershed land-cover sources"><h4>Selected watershed land-cover comparisons</h4>'+
    rows.map((row,index)=>{
      const years=row.source_binding?.rasters||{},summary=row.summary||{},hucs=list(row.selection?.huc12s);
      let html='<article class="st-received-source"><h4>'+esc(row.title)+'</h4>'+
        '<p>Original annual land cover '+esc(years.before?.year)+' → '+esc(years.after?.year)+
        ' · '+hucs.length+' selected watersheds</p>'+measures(summary)+
        '<p>Areas use original cell-centre counts and the source grid’s affine cell area. Counts from selected non-overlapping watersheds are added before percentages are computed. NoData and single-year-only support stay separate.</p>'+
        '<details class="st-details"><summary>Selected watersheds and original support</summary>'+
        '<div class="st-table-scroll" tabindex="0" role="region" aria-label="Selected watershed support table"><table class="st-table">'+
        '<thead><tr><th scope="col">Original HUC12</th><th scope="col">Name</th><th scope="col">Paired-valid cells</th>'+
        '<th scope="col">Changed-class cells</th><th scope="col">Changed share of paired-valid cells (%)</th></tr></thead><tbody>'+
        list(row.watersheds).map(item=>'<tr><th scope="row">'+esc(item.huc12)+'</th><td>'+esc(item.properties?.name||'')+
          '</td><td>'+quantity(item.summary?.paired_valid_cells,0)+'</td><td>'+quantity(item.summary?.changed_class_cells,0)+
          '</td><td>'+quantity(item.summary?.changed_percent_of_paired_valid)+'</td></tr>').join('')+'</tbody></table></div>'+
        '<dl><dt>Valid only in the earlier year</dt><dd>'+quantity(summary.valid_before_only_cells,0)+' cells</dd>'+
        '<dt>Valid only in the later year</dt><dd>'+quantity(summary.valid_after_only_cells,0)+' cells</dd>'+
        '<dt>NoData in both years</dt><dd>'+quantity(summary.both_nodata_cells,0)+' cells</dd></dl></details>';
      html+='<div class="st-actions">'+(row.native?button('open','Open saved watershed comparison',index,disabled):'')+
        button('compose','Add source to report',index,disabled)+button('source','Open original source edition',index,disabled)+'</div>';
      if(!row.native)html+='<p>This source comes from another original project. Its captured selection, matrices and original input documents are available below.</p>';
      html+='<details class="st-details"><summary>Source identities and interpretation</summary><p>'+esc(row.interpretation)+'</p><dl>'+
        '<dt>Original project</dt><dd><code>'+esc(row.source_project_id)+'</code></dd>'+
        '<dt>Saved comparison</dt><dd><code>'+esc(row.selection_id)+'</code></dd>'+
        '<dt>Analysis SHA256</dt><dd><code>'+esc(row.source_binding?.analysis_sha256)+'</code></dd>'+
        '<dt>Original domain SHA256</dt><dd><code>'+esc(row.source_binding?.source_domain_sha256)+'</code></dd>'+
        '<dt>Earlier raster SHA256</dt><dd><code>'+esc(years.before?.sha256)+'</code></dd>'+
        '<dt>Later raster SHA256</dt><dd><code>'+esc(years.after?.sha256)+'</code></dd>'+
        '<dt>Source report SHA256</dt><dd><code>'+esc(row.source_body_sha256)+'</code></dd></dl></details>';
      if(row.native)html+=downloads(row.native._downloads,'Complete saved comparison files');
      html+=downloads(row._downloads,'Captured source and original input documents');
      for(const report of list(detail.reports).filter(item=>list(row.report_ids).includes(item.id)))
        html+=downloads(report._downloads,'Saved scientific report: '+report.title);
      return html+'</article>';
    }).join('')+'</section>';
}
export async function openReceivedObservedLandcover(host,detail,target,{workspace_key,current}){
  const action=target?.dataset?.receivedAction;
  if(!action?.startsWith('landcover-'))return false;
  const index=Number(target.dataset.landcoverSource);
  const row=Number.isSafeInteger(index)&&index>=0?list(detail?.observed_landcover_sources)[index]:null;
  if(!row||detail.workspace_key!==workspace_key||!current())
    throw Error('Reopen this saved Study in its receiving Workspace.');
  const source=row.source,sourceKey=key(source);
  if(!id(source?.source_collection_id)||typeof source?.source_id!=='string'||!source.source_id)
    throw Error('Choose the retained original watershed source.');
  if(action==='landcover-open'){
    if(!row.native||!id(row.native.id)||row.native.id!==row.selection_id)
      throw Error('Open the captured source files for this external original project.');
    if(typeof host.openExtension!=='function')throw Error('Use the maintained Observed watershed change desk.');
    if(!current()||key(row.source)!==sourceKey)return true;
    await host.openExtension('observed-landcover','openSaved',row.native.id);
    return true;
  }
  if(action==='landcover-compose'){
    if(typeof host.openScientificReport!=='function')throw Error('Use the maintained Scientific Reports composer.');
    if(!current()||key(row.source)!==sourceKey)return true;
    await host.openScientificReport({workspace_key,sources:[{...source}],title:row.title});
    return true;
  }
  if(action==='landcover-source'){
    if(typeof host.openItem!=='function')throw Error('Use the maintained original source catalogue.');
    if(!current()||key(row.source)!==sourceKey)return true;
    await host.openItem('sources',source.source_collection_id);
    return true;
  }
  throw Error('Choose an original selected-watershed source action.');
}
