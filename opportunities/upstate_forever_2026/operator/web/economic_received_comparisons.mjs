/** Original saved Economic comparisons retained in a received Scientific Study. */
const list=value=>Array.isArray(value)?value:[];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validID=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const button=(action,label,index,disabled)=>'<button type="button" data-received-action="economic-comparison-'+action+'" data-economic-comparison-source="'+index+'" '+(disabled?'disabled':'')+'>'+esc(label)+'</button>';

function editionHTML(edition,index,availability){
  const available=availability?.edition_id===edition.id&&availability?.new_cost_edition_available===true&&
    availability.state==='available'&&list(availability.verified_source_paths).length>0;
  return '<li><strong>'+(index===0?'First':'Second')+' saved edition: '+esc(edition.title||edition.id)+'</strong>'+
    '<p>'+esc(available
      ?'The original scenario files are verified in this Workspace. A new reviewed cost edition can use this source.'
      :'The saved Economic report and its source companion are retained. The native scenario directory is not present for a new cost edition.')+'</p>'+
    '<dl><dt>Economic edition</dt><dd><code>'+esc(edition.id)+'</code></dd>'+
    '<dt>Original physical report</dt><dd><code>'+esc(edition.input?.report_id)+'</code></dd>'+
    '<dt>Selected reporting zone</dt><dd>'+esc(edition.input?.zone_id)+'</dd>'+
    '<dt>Original source SHA256</dt><dd><code>'+esc(edition.input?.report_sha256)+'</code></dd></dl></li>';
}

export function receivedEconomicComparisonsHTML(detail,disabled=false){
  const rows=list(detail?.economic_comparison_sources);
  if(!rows.length)return '';
  return '<section class="st-received-economic" aria-label="Original saved Economic comparisons">'+
    '<style>.st-received-economic{min-width:0}.st-received-economic article,.st-received-economic dl,.st-received-economic dd,.st-received-economic code{min-width:0;overflow-wrap:anywhere}.st-received-economic .st-actions{display:flex;flex-wrap:wrap;gap:.5rem}.st-received-economic .st-actions button{max-width:100%;white-space:normal}.st-received-economic dd{margin:0 0 .65rem}.st-received-economic ul{padding-left:1.3rem}</style>'+
    '<h4>Saved Economic comparisons</h4>'+
    rows.map((row,index)=>{
      const native=row.native_comparison,availability=list(row.native_source_availability);
      let html='<article class="st-received-source"><h4>'+esc(native?.title||'Original Economic comparison')+'</h4>';
      if(native){
        html+='<p>Open the exact saved comparison and its ordered first and second Economic editions. Original quantities, cost assumptions and comparison results remain unchanged.</p>'+
          '<div class="st-actions">'+button('open','Open saved comparison',index,disabled)+
          button('report','Open this report only',index,disabled)+
          button('append','Add to current report',index,disabled)+
          button('source','Open retained source files',index,disabled)+'</div>'+
          '<p>The comparison includes the full comparison ZIP and both original Economic packages.</p>'+
          '<details class="st-details"><summary>Original editions and source availability</summary><ul>'+
          list(native.editions).map((edition,i)=>editionHTML(edition,i,availability.find(v=>v.edition_id===edition.id))).join('')+'</ul></details>';
      }else{
        html+='<p>This report originated in project '+esc(row.source_project_id)+
          '. Its original report and complete comparison companions are retained; no local Economic edition is substituted.</p>'+
          '<div class="st-actions">'+button('report','Open this report only',index,disabled)+
          button('append','Add to current report',index,disabled)+
          button('source','Open retained source files',index,disabled)+'</div>';
      }
      const origin=row.native_origin||{};
      return html+'<details class="st-details"><summary>Original source identity</summary><dl>'+
        '<dt>Comparison</dt><dd><code>'+esc(origin.comparison_id)+'</code></dd>'+
        '<dt>First Economic edition</dt><dd><code>'+esc(origin.first_edition_id)+'</code></dd>'+
        '<dt>Second Economic edition</dt><dd><code>'+esc(origin.second_edition_id)+'</code></dd>'+
        '<dt>Source collection</dt><dd><code>'+esc(row.source_collection_id)+'</code></dd>'+
        '<dt>Source</dt><dd><code>'+esc(row.source_id)+'</code></dd>'+
        '<dt>Original project</dt><dd>'+esc(row.source_project_id)+'</dd>'+
        '<dt>Recipe SHA256</dt><dd><code>'+esc(row.source_body_sha256)+'</code></dd>'+
        '</dl></details></article>';
    }).join('')+'</section>';
}

export async function openReceivedEconomicComparison(host,detail,target,{workspace_key,current}){
  const action=target?.dataset?.receivedAction;
  if(!action?.startsWith('economic-comparison-'))return false;
  const rawIndex=target.dataset.economicComparisonSource;
  const index=typeof rawIndex==='string'&&/^(0|[1-9][0-9]*)$/.test(rawIndex)?Number(rawIndex):-1;
  const row=Number.isSafeInteger(index)&&index>=0?list(detail?.economic_comparison_sources)[index]:null;
  if(!row||detail.workspace_key!==workspace_key||!current())
    throw Error('Reopen this saved Study in its original receiving Workspace.');
  if(!validID(row.source_collection_id)||typeof row.source_id!=='string'||!row.source_id)
    throw Error('Choose this Study’s retained original Economic source.');
  if(action==='economic-comparison-open'){
    const native=row.native_comparison;
    if(row.relationship!=='same_project'||row.source_project_id!==detail.project?.id||
       !native||!validID(native.id)||native.id!==row.native_origin?.comparison_id)
      throw Error('This source retains another original project; open its captured report and source files.');
    if(typeof host.openDesk!=='function')throw Error('Use the maintained Economic desk to open this saved comparison.');
    await host.openDesk('economic-desk','openSavedComparison',{workspace_key,id:native.id});
    return true;
  }
  if(action==='economic-comparison-report'||action==='economic-comparison-append'){
    if(typeof host.openScientificReport!=='function')throw Error('Use the maintained Scientific Reports composer.');
    await host.openScientificReport({
      workspace_key,sources:[{source_collection_id:row.source_collection_id,source_id:row.source_id}],
      title:row.native_comparison?.title||'',
      selection_mode:action==='economic-comparison-report'?'replace':'append',
    });
    return true;
  }
  if(action==='economic-comparison-source'){
    if(typeof host.openItem!=='function')throw Error('Use the original Sources view for this retained source collection.');
    await host.openItem('sources',row.source_collection_id);
    return true;
  }
  throw Error('Choose a retained original Economic comparison action.');
}
