/** Read-only maps and figures for the exact saved independent comparison edition. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=value=>Array.isArray(value)?value:[];
const text=value=>typeof value==='string'?value:'';
const pretty=value=>JSON.stringify(value,null,2);
const numeric=value=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString(undefined,{maximumSignificantDigits:9}):value===null||value===undefined?'Unavailable':String(value);
const button=(action,label,extra='')=>'<button type="button" data-ic="'+action+'" '+extra+'>'+esc(label)+'</button>';
const option=(value,label,selected)=>'<option value="'+esc(value)+'"'+(value===selected?' selected':'')+'>'+esc(label)+'</option>';
const table=(head,body,label)=>'<div class="ic-scroll" tabindex="0" role="region" aria-label="'+esc(label)+'"><table><thead><tr>'+head.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table></div>';
const kindLabel=kind=>({'map':'Spatial support','paired-values':'Paired values','differences':'Native minus reference'})[kind]||kind;
const safeUrl=value=>typeof value==='string'&&/^\/api\/file\/[a-f0-9]{64}$/.test(value);
export function retainedFigureTicket(opened,path){
  const file=opened?.edition?.files?.[path];
  if(!file||typeof file.sha256!=='string'||!Number.isSafeInteger(file.bytes))return null;
  const matches=list(opened._downloads).filter(t=>t.label===path&&t.sha256===file.sha256&&t.bytes===file.bytes&&t.workspace===opened.workspace_key&&safeUrl(t.url));
  return matches.length===1?matches[0]:null;
}
function link(opened,path,label,{open=false}={}){
  const ticket=retainedFigureTicket(opened,path);
  if(!ticket)return '<span class="ic-note">'+esc(label)+' — no matching retained file ticket</span>';
  return '<a href="'+esc(ticket.url+(open?'':'?download=1'))+'"'+(open?' target="_blank" rel="noopener noreferrer"':'')+'>'+esc(label)+'</a>';
}
function asPairRows(result,ids){
  const selected=new Set(ids);
  return list(result?.pairs).filter(pair=>selected.has(pair.id)).map(pair=>'<tr><th scope="row">'+esc(pair.id)+'<br><span class="ic-note">'+esc(pair.native?.catchment_id)+' / reference row '+esc(pair.reference_row_number)+'</span></th>'+
    '<td>'+esc(pair.decision)+'</td><td>'+esc(numeric(pair.native?.modeled_annual_mass))+' '+esc(pair.units)+'</td>'+
    '<td>'+esc(pair.reference?.value)+' '+esc(pair.reference?.unit)+'<br><span class="ic-note">'+esc(pair.reference?.definition?.source_support||result.selection?.reference?.definition?.source_support)+'</span></td>'+
    '<td>'+esc(numeric(pair.converted_reference_value))+' '+esc(pair.converted_reference_value===null?'':pair.units)+'</td>'+
    '<td>'+esc(numeric(pair.difference))+' '+esc(pair.difference===null?'':pair.units)+'<br><span class="ic-note">'+esc(pair.relative_difference===null?pair.relative_difference_reason:numeric(pair.relative_difference*100)+'% of converted reference')+'</span></td>'+
    '<td>'+esc(pair.rationale)+'<details><summary>Complete pair, period and source checks</summary><pre>'+esc(pretty(pair))+'</pre></details></td></tr>').join('');
}
function unpairedTable(opened,view,side){
  const rows=list(opened.data?.['unpaired_'+side]),key=side==='native'?'figureNativePage':'figureReferencePage';
  const page=Math.max(0,Math.min(Math.ceil(rows.length/50)-1,Number.isSafeInteger(view[key])?view[key]:0));
  const shown=rows.slice(page*50,page*50+50),isNative=side==='native';
  const heads=isNative?['Original observation / catchment','Constituent / annual value','Native model period','Associated observation period','Original support']:
    ['Original reference row / ID','Catchment / reach identifier','Constituent / original value','Original period','Original method and qualifier'];
  const body=shown.map(row=>'<tr><th scope="row">'+esc(isNative?row.observation_id:row.row_number)+'<br>'+esc(isNative?row.catchment_id:row.record_id)+'</th>'+
    (isNative?'<td>'+esc(row.parameter)+'<br>'+esc(numeric(row.modeled_annual_mass))+' '+esc(row.units)+'</td><td>'+esc(pretty(row.native_period))+'</td><td>'+esc(row.period_start)+' → '+esc(row.period_end)+'</td><td>'+esc(row.native_support)+' · '+esc(row.coverage_status)+'</td>':
    '<td>'+esc(row.catchment_id)+'</td><td>'+esc(row.parameter)+'<br>'+esc(row.value)+' '+esc(row.unit)+'</td><td>'+esc(row.period_start)+' → '+esc(row.period_end)+'</td><td>'+esc(row.method)+' · '+esc(row.qualifier)+'</td>')+'</tr>').join('');
  return '<section class="ic-panel"><h4>Unpaired '+(isNative?'native support':'reference')+' rows ('+esc(rows.length)+')</h4>'+
    '<p>These original rows were not selected in any comparison pair. They remain part of this saved scientific input and are not a set of rejected values.</p>'+
    (rows.length?table(heads,body,'Original unpaired '+side+' rows')+'<div class="ic-toolbar">'+button('figure-unpaired-previous','Previous unpaired rows','data-side="'+side+'" '+(page===0?'disabled':''))+
      '<span>Rows '+esc(page*50+1)+'–'+esc(Math.min(rows.length,(page+1)*50))+' of '+esc(rows.length)+'</span>'+
      button('figure-unpaired-next','Next unpaired rows','data-side="'+side+'" '+((page+1)*50>=rows.length?'disabled':''))+'</div>':'<p>Every retained '+side+' row was selected in at least one pair.</p>')+'</section>';
}
export function renderIndependentFigures(opened,view={}){
  if(!opened?.edition)return '<section class="ic-panel"><h3>Saved maps and figures</h3><p>Open a saved independent comparison below. Its figure files retain the exact original scientific edition and source support.</p><p>A preview does not alter an older saved report. Save the explicitly reviewed comparison to create its complete current figure edition.</p></section>';
  const value=opened.figures;
  if(!value)return '<section class="ic-panel"><h3>This original edition has no figure package</h3><p>The complete saved tables and sources remain available in Results, Original inputs and the file downloads below. To produce a following figure edition, read the selected original inputs, preview the same intended choices and save a new comparison. The earlier result and its ancestry remain intact.</p>'+button('tab','View original result','data-tab="results"')+'</section>';
  const figures=list(value.figures),kind=text(view.figureKind),parameter=text(view.figureParameter);
  const kinds=[...new Set(figures.map(f=>text(f.kind)).filter(Boolean))],parameters=[...new Set(figures.map(f=>text(f.parameter)).filter(Boolean))];
  const actualKind=kinds.includes(kind)?kind:'',actualParameter=parameters.includes(parameter)?parameter:'';
  const filtered=figures.filter(f=>(!actualKind||f.kind===actualKind)&&(!actualParameter||!f.parameter||f.parameter===actualParameter));
  const selected=filtered.find(f=>f.id===view.figureId)||filtered[0];
  const controls='<div class="ic-toolbar"><label>Figure type<select data-figure-filter="figureKind">'+option('','All saved figures',actualKind)+kinds.map(k=>option(k,kindLabel(k),actualKind)).join('')+'</select></label>'+
    '<label>Constituent<select data-figure-filter="figureParameter">'+option('','All constituents',actualParameter)+parameters.map(p=>option(p,p,actualParameter)).join('')+'</select></label>'+
    '<label>Saved figure<select data-figure-filter="figureId">'+filtered.map(f=>option(f.id,f.title,selected?.id)).join('')+'</select></label></div>';
  let content='';
  if(selected){
    const ticket=retainedFigureTicket(opened,selected.path),index=filtered.indexOf(selected);
    content='<section class="ic-panel"><h4>'+esc(selected.title)+'</h4>'+
      (ticket?'<div class="ic-figure-region" tabindex="0" role="region" aria-label="'+esc(selected.title)+'"><img class="ic-saved-figure" data-figure-image data-figure-id="'+esc(selected.id)+'" src="'+esc(ticket.url)+'" alt="'+esc(selected.title+'. '+selected.caption)+'"></div><p class="ic-note" data-figure-status role="status">Opening the exact retained figure…</p>':'<p class="ic-error">The saved figure has no matching original file ticket. Reopen this same edition to receive its exact files.</p>')+
      '<p class="ic-figure-caption">'+esc(selected.caption)+'</p>'+
      (selected.reason?'<p>'+esc(selected.reason)+'</p>':'')+
      '<div class="ic-toolbar">'+button('figure-previous','Previous figure',index===0?'disabled':'')+'<span>'+esc(index+1)+' of '+esc(filtered.length)+'</span>'+button('figure-next','Next figure',index+1>=filtered.length?'disabled':'')+
      link(opened,selected.path,'Download exact SVG')+link(opened,selected.path,'Open original figure',{open:true})+'</div>'+
      '<p class="ic-note">Saved edition '+esc(opened.edition.id)+'. File '+esc(selected.path)+(ticket?' · '+esc(ticket.bytes)+' bytes · SHA-256 '+esc(ticket.sha256):'')+'</p>'+
      '<details open><summary>Original paired values behind this figure</summary>'+
      (list(selected.pair_ids).length?table(['Pair / original supports','Use','Native annual mass','Original reference','Converted reference','Difference / denominator','Rationale and original records'],asPairRows(opened.data,list(selected.pair_ids)),'Complete original pairs for this saved figure'):'<p>This support figure has no pair-specific numerical subset. Every original input and unpaired source remains in the figure data and comparison.</p>')+
      '</details><details><summary>Saved figure identity and file path</summary><pre>'+esc(pretty(selected))+'</pre></details></section>';
  }else content='<p class="ic-empty">No saved figure matches these display choices. The full file inventory and source data remain available.</p>';
  const files=[['reader','Download complete figure reader',false],['spec','Download all figure specifications',false],['data_path','Download complete figure data',false],['csv','Download figure table CSV',false],['geometry_path','Download original and projected geometry',false]].filter(([key])=>typeof value[key]==='string');
  return '<section class="ic-panel"><h3>Maps and descriptive comparison figures</h3><p>'+esc(value.title||opened.edition.title)+'</p><p>Display filters select saved figures only. They do not remove pairs, change support decisions, recompute statistics or assign geographic equivalence.</p>'+
    '<p class="ic-note">Native catchment polygons and independently retained reference reach lines have different roles. A visible geographic overlap or matching unit does not make quantities comparable. Missing geometry stays documented.</p>'+controls+'</section>'+content+unpairedTable(opened,view,'native')+unpairedTable(opened,view,'reference')+
    '<section class="ic-panel"><h4>Complete saved figure package</h4><div class="ic-toolbar">'+files.map(([key,label,open])=>link(opened,value[key],label,{open})).join(' ')+link(opened,'independent-comparison.zip','Download complete original comparison ZIP')+'</div>'+
    '<details><summary>Complete figure data, unavailable support and original source identities</summary><pre>'+esc(pretty(value.data??value))+'</pre></details>'+
    '<details><summary>Original unpaired native and reference rows</summary><pre>'+esc(pretty({unpaired_native:opened.data?.unpaired_native,unpaired_reference:opened.data?.unpaired_reference,source_issues:opened.data?.source_issues}))+'</pre></details>'+
    '<p>Extract the complete ZIP before opening its figure reader and related original files. The separate SVG, JSON and CSV files retain the full saved data and provenance.</p></section>';
}
export function moveIndependentFigure(opened,view,direction){
  const all=list(opened?.figures?.figures),kind=all.some(f=>f.kind===view.figureKind)?view.figureKind:'',parameter=all.some(f=>f.parameter===view.figureParameter)?view.figureParameter:'';
  const figures=all.filter(f=>(!kind||f.kind===kind)&&(!parameter||!f.parameter||f.parameter===parameter));
  if(!figures.length)return null;
  const found=figures.findIndex(f=>f.id===view.figureId),index=found<0?0:found;
  return figures[Math.max(0,Math.min(figures.length-1,index+direction))].id;
}
