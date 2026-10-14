/* Exact saved Sampling comparison. All scientific values come from the native reader. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=value=>value===null||value===undefined?'Unknown':Array.isArray(value)?value.join('; '):typeof value==='object'?JSON.stringify(value):String(value);
const table=(headings,rows)=>'<div class="sampling-table"><table><thead><tr>'+headings.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+esc(text(value))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const price=cost=>cost&&Number.isSafeInteger(cost.total_cents)?text(cost.currency)+' '+(cost.total_cents/100).toFixed(2):'Unknown';
const date=visit=>visit?visit.date+' · '+visit.start_local+'–'+visit.finish_local+' · crew '+visit.crew:'No visit';
const monthNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function cohortLabel(target){
  const f=target.cohort.fields, parts=['characteristic','fraction','unit','method','value_type'].map(k=>f[k]?.present?text(f[k].value):k+' unspecified');
  return parts.join(' · ');
}
export function samplingComparisonMarkup(saved,pair,result){
  if(!saved)return '<p>Open a saved Sampling recommendation to compare its retained designs.</p>';
  const designs=saved.saved_designs||[],id=saved.id||saved.recommendation_id;
  pair=pair||{};
  const choices=selected=>'<option value="">Choose a saved design</option>'+designs.map(row=>'<option value="'+esc(row.id)+'"'+(row.id===selected?' selected':'')+'>'+esc((row.request_payload?.title||'Monitoring design')+' · '+row.status+' · '+row.id.slice(0,12))+'</option>').join('');
  let html='<details data-comparison-panel'+(result?' open':'')+'><summary>Compare two saved designs</summary><p>Read two actual designs from this same recommendation. No plan, observation or campaign changes.</p><div class="sampling-toolbar"><label>Left design<select data-comparison-side="left">'+choices(pair.left)+'</select></label><label>Right design<select data-comparison-side="right">'+choices(pair.right)+'</select></label><button type="button" data-action="compare-designs">Compare saved designs</button><label>Reopen a comparison JSON<input type="file" accept=".json,application/json" data-comparison-file></label></div>';
  if(designs.length<2)html+='<p>Two saved designs are needed. Keep the original and prepare a separate alternative in the design editor above.</p>';
  if(!result||result.recommendation_id!==id||result.left.design_id!==pair.left||result.right.design_id!==pair.right)return html+'</details>';
  const a=result.left,b=result.right;
  html+='<h4>'+esc(result.title)+'</h4>'+table(['Saved result','Left · '+text(a.title),'Right · '+text(b.title)],[
    ['Native outcome',a.status,b.status],['Geographic cost',price(a.native_cost),price(b.native_cost)],
    ['Selected catchments',a.selected_ids.length,b.selected_ids.length],
    ['Physical planned visits',a.calendar?.visits?.length??0,b.calendar?.visits?.length??0]]);
  const delta=result.geographic_cost_difference;
  html+='<p>'+esc(delta.reason)+(delta.comparable?' Right minus left: '+esc(delta.currency)+' '+esc((delta.right_minus_left_cents/100).toFixed(2))+'.':'')+'</p>'+
    '<h4>Itemized target costs</h4><p>Known supplied estimate: '+esc(price({currency:result.proposal_budget.currency,total_cents:result.proposal_budget.known_total_cents}))+'. Targets with unspecified complete costs: '+esc(result.proposal_budget.unknown_target_ids.length)+'.</p>'+
    table(['Target / original station','Supplied target estimate','Cost basis'],result.targets.map(row=>[cohortLabel(row)+' / '+row.target.station_id,price(row.target_cost),row.target_cost.basis]))+
    '<details><summary>Complete original target-cost summary</summary><pre>'+esc(JSON.stringify(result.proposal_budget,null,2))+'</pre></details>'+
    table(['Original visit','Left date / time / crew','Right date / time / crew','Change'],result.visits.map(row=>[row.visit_key,date(row.left),date(row.right),row.state]))+
    '<h4>Historical evidence and planned months</h4><p>Historical window '+esc(result.historical_window.start)+' through '+esc(result.historical_window.end)+'. Planned future dates do not close these historical gaps.</p>';
  for(const target of result.targets){
    html+='<h5>'+esc(cohortLabel(target))+'</h5><p>Station '+esc(target.target.station_id)+' · proposed visits '+esc(target.target.proposed_visits)+'</p>'+
      table(['Month','Historical distinct dates','Historical goal','Historical gap','Left planned dates','Right planned dates'],result.monthly.filter(row=>row.target_id===target.target_id).map(row=>[monthNames[row.month-1],row.historical.observed_dates,row.historical.minimum_dates,row.historical.date_gap,row.left.distinct_dates,row.right.distinct_dates]))+
      '<details><summary>Exact analytical cohort and original target scope</summary><pre>'+esc(JSON.stringify({target:target.target,station:target.station,cohort:target.cohort,target_cost:target.target_cost},null,2))+'</pre></details>';
  }
  html+='<h4>Configuration changes</h4>'+(result.configuration_changes.length?table(['Field','Left presence / value','Right presence / value'],result.configuration_changes.map(row=>[row.path.join(' / '),row.left,row.right])):'<p>The complete native configurations are identical.</p>')+
    '<ul>'+result.interpretation.map(line=>'<li>'+esc(line)+'</li>').join('')+'</ul>'+
    '<div class="sampling-actions"><button type="button" data-action="comparison-json">Download complete comparison JSON</button><button type="button" data-action="comparison-html">Download readable comparison</button><button type="button" data-action="comparison-months">Download target-month CSV</button><button type="button" data-action="comparison-visits">Download original-visit CSV</button><button type="button" data-action="export">Export original recommendation and all sources</button><button type="button" data-action="transfer">Export editable Study</button></div>'+
    '<details><summary>Original saved identities</summary>'+table(['Record','Identity'],[['Comparison',result.id],['Recommendation',result.recommendation_id],['Left design',a.design_id],['Left plan',a.plan_id],['Right design',b.design_id],['Right plan',b.plan_id]])+'</details></details>';
  return html;
}
export function downloadSamplingComparison(response,kind){
  const names={json:'sampling-design-comparison.json',html:'sampling-design-comparison.html',months:'sampling-design-months.csv',visits:'sampling-design-visits.csv'};
  const name=names[kind],files=response?.files;
  if(!name||!Array.isArray(files))throw Error('Read the exact saved design comparison first.');
  const found=files.filter(row=>row.filename===name);
  if(found.length!==1||typeof found[0].text!=='string')throw Error('The original comparison download is incomplete.');
  const blob=new Blob([found[0].text],{type:found[0].media_type}),url=URL.createObjectURL(blob),anchor=document.createElement('a');
  anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
