/** Original prepared geographic cases in the existing received Study view. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=value=>Array.isArray(value)?value:[];
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const button=(action,label,index,disabled,extra='')=>'<button type="button" data-received-action="geographic-'+action+
  '" data-geographic-case="'+index+'" '+extra+' '+(disabled?'disabled':'')+'>'+esc(label)+'</button>';
function downloads(rows){
  const files=list(rows).filter(row=>/^\/api\/file\/[0-9a-f]{64}$/.test(row.url||''));
  if(!files.length)return '';
  return '<details class="st-details"><summary>Original geographic selections, assumptions and input receipts</summary><ul class="st-received-files">'+
    files.map(row=>'<li><a href="'+esc(row.url)+'?download=1" download>'+esc(row.label||row.filename)+
      '</a><small>'+Number(row.bytes||0).toLocaleString()+' B</small></li>').join('')+'</ul></details>';
}
export function receivedGeographicHTML(detail,disabled=false){
  const rows=list(detail?.geographic_cases);if(!rows.length)return '';
  return '<section aria-label="Original geographic model cases"><h4>Editable geographic model cases</h4>'+
    rows.map((row,index)=>{
      const selection=row.selection||{},geography=row.geography||{},areas=geography.areas_ha||{};
      const scopes=[['Upstream model domain',areas.model_domain],['Selected whole reporting watersheds',areas.reporting_whole_hucs],
        ['SC reporting intersection',areas.reporting_area],['Original utility polygons',areas.utility_full_union],
        ['Utility / reporting intersection',areas.utility_reporting_intersection]].filter(([,value])=>typeof value==='number'&&Number.isFinite(value));
      const runIDs=[row.baseline_run_id,...list(row.alternative_run_ids)];
      return '<article class="st-received-source"><h4>'+esc(row.title||selection.title||row.id)+'</h4>'+
        '<p>'+esc(selection.question)+'</p><p>'+esc(row.classification)+'</p>'+
        '<p>Saved preparation: '+esc(row.state||'Retained')+' · '+list(selection.reporting_huc12s).length+
        ' selected reporting watersheds. The upstream model domain, reporting intersection and utility footprints retain their separate original extents.</p>'+
        (scopes.length?'<div class="st-table-scroll"><table class="st-table"><thead><tr><th>Geographic scope</th><th>Area (ha)</th></tr></thead><tbody>'+
          scopes.map(([label,value])=>'<tr><td>'+esc(label)+'</td><td>'+esc(value.toLocaleString(undefined,{maximumFractionDigits:2}))+'</td></tr>').join('')+'</tbody></table></div>':'')+
        '<div class="st-actions">'+button('open','Open saved geographic case',index,disabled)+
          (row._choices?button('choices','Download editable choices',index,disabled):'')+'</div>'+
        '<p>Open the original case to inspect its source geometry and assumptions. Use its explicit “Use these choices for another edition” action to edit a new preparation; opening this case does not start a model run.</p>'+
        '<div class="st-actions">'+runIDs.map((id,n)=>identifier(id)?button('run','Open '+(['baseline','restoration','matched-control'][n]||'alternative')+' run',index,disabled,'data-geographic-run="'+n+'"'):'').join('')+'</div>'+
        '<p>Native results retain annual stream-delivered nitrogen/phosphorus in kg/year and sediment in metric tonnes/year. The saved input classification and each run’s own state remain authoritative.</p>'+
        '<details class="st-details"><summary>Complete original geography and input summary</summary><pre>'+esc(JSON.stringify({
          case_id:row.id,project_id:row.project_id,selection,geography,input_summary:row.input_summary,ensemble_id:row.ensemble_id
        },null,2))+'</pre></details>'+downloads(row._downloads)+'</article>';
    }).join('')+'</section>';
}
export async function openReceivedGeographic(host,detail,target,{workspace_key,current}){
  const action=target?.dataset?.receivedAction;if(!action?.startsWith('geographic-'))return false;
  const index=Number(target.dataset.geographicCase);
  const row=Number.isSafeInteger(index)&&index>=0?list(detail?.geographic_cases)[index]:null;
  if(!row||detail.workspace_key!==workspace_key||row.project_id!==detail.project?.id||!current())
    throw Error('Reopen this original geographic Study in its receiving Workspace.');
  if(!identifier(row.id)||!row.selection||typeof row.selection!=='object'||Array.isArray(row.selection))
    throw Error('Choose the original prepared geographic case.');
  if(action==='geographic-open'){
    if(typeof host.openDesk!=='function')throw Error('Use the current Geographic model case desk.');
    const selection=JSON.parse(JSON.stringify(row.selection));
    if(!current())return true;
    await host.openDesk('geographic-headwaters','openSavedCase',{
      workspace_key,case_id:row.id,project_id:row.project_id,selection,study_id:detail.id,
    });
    return true;
  }
  if(action==='geographic-run'){
    const position=Number(target.dataset.geographicRun),runs=[row.baseline_run_id,...list(row.alternative_run_ids)];
    const id=Number.isSafeInteger(position)&&position>=0?runs[position]:null;
    if(!identifier(id))throw Error('Choose an original run retained with this geographic case.');
    if(typeof host.openItem!=='function')throw Error('Use the current native run inspector.');
    if(current())await host.openItem('runs',id);
    return true;
  }
  if(action==='geographic-choices'){
    const choices=row._choices;
    if(choices?.schema!=='upstate.geographic-operator-selection/v1'||choices.project_id!==row.project_id||
       choices.geographic_edition_id!==row.id)throw Error('Reopen the original editable geographic choices.');
    if(!current())return true;
    const url=URL.createObjectURL(new Blob([JSON.stringify(choices,null,2)+'\n'],{type:'application/json'}));
    try{const a=document.createElement('a');a.href=url;a.download='geographic-'+row.id+'-choices.json';a.click();}
    finally{setTimeout(()=>URL.revokeObjectURL(url),5000);}
    return true;
  }
  throw Error('Choose an original geographic case action.');
}
