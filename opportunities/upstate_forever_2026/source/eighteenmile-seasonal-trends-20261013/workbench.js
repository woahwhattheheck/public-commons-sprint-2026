/* Uses the exact trend-core.mjs kernel in this complete standalone document. */
(()=>{'use strict';
const DATA=JSON.parse(document.getElementById('dataset').textContent),$=id=>document.getElementById(id);
const escape=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const fmt=x=>x===null||x===undefined?'Not estimable':Number.isInteger(x)?String(x):Number(x).toPrecision(4).replace(/\.0+(?=e|$)/,'');
const direction=x=>({positive_envelope:'Positive envelope',negative_envelope:'Negative envelope',zero_envelope:'Zero median pair slope',overlaps_zero:'Envelope includes zero',no_cross_year_pairs:'No between-year comparison'}[x]||x);
const cohortById=new Map(DATA.cohorts.map(c=>[c.id,c]));
let state={schema:VERSION,source_edition_sha256:DATA.source_edition_sha256,
  cohort_id:(DATA.cohorts.find(c=>c.dimensions.station_id.endsWith('SV-233')&&c.dimensions.characteristic==='Phosphorus')||DATA.cohorts[0]).id,
  selection:{...DEFAULTS},notes:'',chart_scale:'linear'},current=null,sensitivities=[],dirty=false;
function notify(text){$('status').textContent=text;}
function fail(error){$('error').hidden=false;$('error').textContent=error instanceof Error?error.message:String(error);}
function clearError(){$('error').hidden=true;$('error').textContent='';}
function validateState(s){
 if(!s||s.schema!==VERSION)throw Error('This file is not a saved seasonal nutrient study.');
 if(s.source_edition_sha256!==DATA.source_edition_sha256)throw Error('The saved study belongs to a different source edition. The current work has been preserved.');
 if(!cohortById.has(s.cohort_id))throw Error('The saved comparable cohort is absent from this source edition.');
 if(typeof s.notes!=='string'||s.notes.length>20000)throw Error('The saved notes must be text up to 20,000 characters.');
 const o=settings(s.selection);
 if(o.start_year<2020||o.end_year>2025)throw Error('The current source edition covers 2020 through 2025.');
 if(![0,1.5,2,3].includes(o.max_flow_ratio))throw Error('Choose one of the supported flow-ratio selections.');
 if(s.chart_scale!==undefined&&!['linear','sqrt'].includes(s.chart_scale))throw Error('Unknown chart display scale.');
 return {schema:VERSION,source_edition_sha256:DATA.source_edition_sha256,cohort_id:s.cohort_id,selection:o,notes:s.notes,chart_scale:s.chart_scale||'linear'};
}
function options(select,values,getLabel=x=>x){select.innerHTML=values.map(x=>'<option value="'+escape(typeof x==='object'?x.id:x)+'">'+escape(getLabel(x))+'</option>').join('');}
function setCohorts(station,id){
 const choices=DATA.cohorts.filter(c=>c.dimensions.station_id===station);
 options($('cohort'),choices,c=>c.dimensions.characteristic+' / '+c.dimensions.method_id+' / '+(c.dimensions.activity_depth?c.dimensions.activity_depth+' '+c.dimensions.activity_depth_unit+' depth':'depth unspecified')+' / '+c.rows+' results'+(c.dimensions.result_type==='Actual'?'':' / '+c.dimensions.result_type));
 $('cohort').value=choices.some(c=>c.id===id)?id:choices[0].id;
}
function setControls(){
 const c=cohortById.get(state.cohort_id);$('station').value=c.dimensions.station_id;setCohorts(c.dimensions.station_id,state.cohort_id);
 $('start-year').value=state.selection.start_year;$('end-year').value=state.selection.end_year;
 $('depth-mode').value=state.selection.depth_mode;$('season').value=state.selection.season;$('flow-ratio').value=state.selection.max_flow_ratio;
 $('approved-only').checked=state.selection.approved_flow_only;$('numeric-only').checked=state.selection.numeric_only;$('notes').value=state.notes;$('chart-scale').value=state.chart_scale;
}
function readControls(){return validateState({...state,cohort_id:$('cohort').value,notes:$('notes').value,chart_scale:$('chart-scale').value,selection:{
 start_year:Number($('start-year').value),end_year:Number($('end-year').value),season:$('season').value,
 max_flow_ratio:Number($('flow-ratio').value),depth_mode:$('depth-mode').value,approved_flow_only:$('approved-only').checked,numeric_only:$('numeric-only').checked}});}
function table(rows,columns){return '<table><thead><tr>'+columns.map(([key,label])=>'<th>'+escape(label)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+columns.map(([key,label])=>'<td'+(typeof r[key]==='number'?' class="numeric"':'')+'>'+escape(typeof r[key]==='number'?fmt(r[key]):Array.isArray(r[key])?r[key].join(', '):r[key]??'Not estimable')+'</td>').join('')+'</tr>').join('')+'</tbody></table>';}
function drawChart(r){
 const shown=r.records.filter(x=>x.interval.state!=='unresolved');
 if(!shown.length)return '<div class="empty">No interpretable observations in the selected period.</div>';
 const W=1000,H=320,L=70,R=24,T=20,B=50;
 const min=Date.parse(state.selection.start_year+'-01-01'),max=Date.parse((state.selection.end_year+1)+'-01-01');
 const cap=Math.max(...shown.map(x=>x.interval.upper),.01)*1.12;
 const scaled=state.chart_scale==='sqrt',fraction=v=>scaled?Math.sqrt(v/cap):v/cap;
 const x=d=>L+(Date.parse(d)-min)/(max-min)*(W-L-R),y=v=>H-B-fraction(v)*(H-T-B);
 let s='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Original sampled concentrations with source detection limits"><rect width="100%" height="100%" fill="white"/><g font-family="Arial, sans-serif" font-size="14" fill="#333">';
 for(let j=0;j<=4;j++){let v=scaled?cap*(j/4)**2:cap*j/4;s+='<path d="M'+L+' '+y(v)+'H'+(W-R)+'" stroke="#ddd"/><text x="'+(L-8)+'" y="'+(y(v)+4)+'" text-anchor="end">'+escape(fmt(v))+'</text>';}
 for(let year=state.selection.start_year;year<=state.selection.end_year;year++)s+='<text x="'+x(year+'-07-01')+'" y="'+(H-20)+'" text-anchor="middle">'+year+'</text>';
 for(const p of shown){
  const cx=x(p.date),cy=y(p.interval.upper),title=escape(p.date+' / '+p.characteristic+' / '+(p.interval.state==='numeric'?p.value:'< '+p.limit_value)+' mg/L / '+p.record_id);
  if(p.interval.state==='numeric')s+='<circle cx="'+cx+'" cy="'+cy+'" r="3.7" fill="#333"><title>'+title+'</title></circle>';
  else s+='<g><title>'+title+'</title><path d="M'+cx+' '+cy+'V'+y(0)+'" stroke="#999"/><path d="M'+(cx-4.5)+' '+(cy-3)+'L'+(cx+4.5)+' '+(cy-3)+'L'+cx+' '+(cy+4)+'Z" fill="white" stroke="#333"/></g>';
 }
 s+='<text x="18" y="160" transform="rotate(-90 18 160)" text-anchor="middle">Concentration / mg/L</text><path d="M'+L+' '+T+'V'+(H-B)+'H'+(W-R)+'" fill="none" stroke="#555"/></g></svg>';return s;
}
function render(){
 clearError();state=readControls();const cohort=cohortById.get(state.cohort_id);
 current=analyzeCohort(DATA.records,cohort.key,state.selection);sensitivities=compareSelections(DATA.records,cohort.key,state.selection);
 const s=current.summary,d=current.dimensions;
 $('result-title').textContent=d.station_id.match(/SV-\d+$/)?.[0]+' / '+d.characteristic;
 $('dimensions').innerHTML=[d.sample_fraction,d.method_id,d.method_context,d.result_type,d.activity_depth?'Recorded depth '+d.activity_depth+' '+d.activity_depth_unit:'Depth unspecified',state.selection.depth_mode==='combined'?'Depth metadata combined for sensitivity':'',d.collection_equipment].filter(Boolean).map(x=>'<span class="chip">'+escape(x)+'</span>').join('');
 const range=s.pairs?fmt(s.slope_lower_mg_l_per_year)+' to '+fmt(s.slope_upper_mg_l_per_year):'Not estimable';
 $('cards').innerHTML='<div class="metric"><p class="label">Median pair-slope outer envelope</p><strong>'+escape(range)+'</strong><small>mg/L per year / '+escape(direction(s.direction))+'</small></div>'+ 
  '<div class="metric"><p class="label">Included original results</p><strong>'+s.included_results+'</strong><small>'+s.censored_results+' below quantification / '+s.excluded_results+' excluded by selection</small></div>'+
  '<div class="metric"><p class="label">Same-season comparisons</p><strong>'+s.pairs+'</strong><small>'+s.supporting_years.length+' supporting years / '+s.supporting_seasons.length+' seasons</small></div>';
 let interpret=s.pairs?'This envelope describes the median sampled-data pair slope under the selected censor bounds. '+
  (s.direction==='positive_envelope'?'Its entire range is positive. ':s.direction==='negative_envelope'?'Its entire range is negative. ':s.direction==='overlaps_zero'?'The retained detection limits permit either direction. ':'Its median pair slope is zero for this selection. ')+
  'Compare seasonal and flow-context sensitivity below before using it in a scientific interpretation.':
  'This selection has no comparable season observed in different years. The original measurements remain useful context; a temporal slope is not computed.';
 if(s.supporting_years.length>0&&s.supporting_years.length<4)interpret+=' Only '+s.supporting_years.length+' years support the comparison.';
 if(state.selection.depth_mode==='combined'&&current.depth_series.length>1)interpret+=' This sensitivity combines documented and unspecified sampling depths; it does not establish equal physical depth.';
 if(d.result_type==='Calculated')interpret+=' This is the agency’s separate calculated Nitrogen series, not the TKN plus nitrate/nitrite component diagnostic.';
 if(d.station_id.endsWith('SV-233'))interpret+=' The source’s SV-233 point is downstream of the gauge on the indexed reach; daily flow remains regional context.';
 $('interpretation').textContent=interpret;
 $('chart').innerHTML=drawChart(current);
 const seasons=state.selection.season==='month'?12:state.selection.season==='quarter'?4:1;
 const labels=state.selection.season==='month'?['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']:state.selection.season==='quarter'?['Q1','Q2','Q3','Q4']:['Year'];
 let cv='<table class="cover"><thead><tr><th>Year</th>'+labels.map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>';
 for(let year=state.selection.start_year;year<=state.selection.end_year;year++){
  cv+='<tr><td>'+year+'</td>';for(let season=1;season<=seasons;season++){
   const b=current.bins.find(x=>x.year===year&&x.season===season);cv+='<td'+(!b?' class="absent"':'')+'>'+(b?b.sample_dates+' ('+b.censored+')':'·')+'</td>';}
  cv+='</tr>';}
 $('coverage-table').innerHTML=cv+'</tbody></table>';
 $('pair-support').textContent=s.higher+' strictly higher pairs, '+s.lower+' strictly lower, '+s.equal+' exact ties and '+s.interval_overlap+' overlapping intervals. '+s.flow_excluded_pairs+' same-season pairs excluded by the selected flow ratio.';
 $('bins-table').innerHTML=table(current.bins,[['year','Year'],['season','Season'],['lower','Lower, mg/L'],['upper','Upper, mg/L'],['sample_dates','Sample dates'],['flow_median','Sample-date gauge median, cfs'],['record_ids','Original record IDs']]);
 $('sensitivity-table').innerHTML=table(sensitivities.map(x=>({...x,range:x.pairs?fmt(x.slope_lower_mg_l_per_year)+' to '+fmt(x.slope_upper_mg_l_per_year):'Not estimable',state:direction(x.direction)})),
  [['label','Analysis'],['included_results','Results'],['censored_results','Censored'],['pairs','Pairs'],['range','Envelope, mg/L/year'],['state','Direction']]).replace(/^<table>|<\/table>$/g,'');
 $('year-table').innerHTML=table(current.leave_one_year_out.map(x=>({...x,range:x.pairs?fmt(x.slope_lower_mg_l_per_year)+' to '+fmt(x.slope_upper_mg_l_per_year):'Not estimable',state:direction(x.direction)})),[['omitted_year','Omitted year'],['pairs','Remaining pairs'],['range','Envelope, mg/L/year'],['state','Direction']]);
 const excluded=new Map(current.excluded_records.map(x=>[x.record_id,x.reason]));
 $('record-list').innerHTML='<thead><tr><th>Date</th><th>Original result</th><th>Gauge, cfs</th><th>Flow quality</th><th>Use in selection</th><th>Agency record</th></tr></thead><tbody>'+current.records.map((r,i)=>'<tr><td class="nowrap">'+r.date+'</td><td>'+escape(r.interval.state==='numeric'?r.value+' '+r.unit:r.interval.state==='left_censored'?'< '+r.limit_value+' '+r.limit_unit:r.detection_condition||'Unresolved')+'</td><td class="numeric">'+escape(fmt(r.flow))+'</td><td>'+escape(r.flow_qualifiers)+'</td><td>'+escape(excluded.get(r.record_id)||'Included')+'</td><td><button type="button" data-record="'+i+'">Open original</button></td></tr>').join('')+'</tbody>';
 $('record-detail').open=false;$('record-body').textContent='';
 $('record-list').querySelectorAll('[data-record]').forEach(button=>button.addEventListener('click',()=>{
  const r=current.records[Number(button.dataset.record)];$('record-heading').textContent=r.date+' / '+r.record_id;
  $('record-body').textContent=JSON.stringify({source_file:r.source_file,logical_csv_record:Number(r.source_row),
   gauge_context:{site:r.flow_gauge,original_daily_source:r.flow_source_id,original_record_index:r.flow_source_record_index,flow_cfs:r.flow,geographic_relation:r.gauge_network_relation},
   original:DATA.raw_records[r.record_id]},null,2);$('record-detail').open=true;$('record-detail').scrollIntoView({block:'nearest'});
 }));
 notify((dirty?'Unsaved selection or notes. ':'Retained source edition loaded. ')+s.included_results+' selected results / '+s.pairs+' between-year pairs.');
}
function download(name,bytes,mime){const url=URL.createObjectURL(new Blob([bytes],{type:mime})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function saveStudy(){state=readControls();download('Eighteenmile_Seasonal_Study.json',JSON.stringify({...state,saved_at:new Date().toISOString()},null,2)+'\n','application/json');dirty=false;notify('Working study saved with this source edition, selection and notes.');}
function guarded(fn){return()=>{try{clearError();fn();}catch(e){fail(e);}};}
options($('station'),[...new Set(DATA.cohorts.map(c=>c.dimensions.station_id))],x=>x.match(/SV-\d+$/)?.[0]+' / '+DATA.cohorts.filter(c=>c.dimensions.station_id===x).reduce((n,c)=>n+c.rows,0)+' results');
options($('start-year'),[2020,2021,2022,2023,2024,2025]);options($('end-year'),[2020,2021,2022,2023,2024,2025]);
try{const saved=JSON.parse($('saved-state').textContent);if(saved)state=validateState(saved);}catch(e){fail(e);}
setControls();$('scope').textContent=DATA.scope.original_results+' original results / '+DATA.scope.station_activities+' station activities / '+DATA.scope.sample_dates+' sample dates / '+DATA.scope.comparable_cohorts+' comparable cohorts / 2020–2025';
$('edition').textContent='Source edition '+DATA.source_edition_sha256+' / '+VERSION;
$('method-text').innerHTML=Object.entries(DATA.methods).filter(([k])=>k!=='title').map(([k,v])=>'<h3>'+escape(k[0].toUpperCase()+k.slice(1))+'</h3><p>'+escape(v)+'</p>').join('');
$('references').innerHTML=DATA.references.map(r=>'<p><a href="'+escape(r.uri)+'" target="_blank" rel="noopener noreferrer">'+escape(r.title)+'</a></p>').join('');
$('source-files').innerHTML=(DATA.attachments||[]).map((r,i)=>'<button type="button" data-source="'+i+'">'+escape(r.path.split('/').at(-1))+'<small>'+r.bytes.toLocaleString()+' bytes / SHA256 '+r.sha256.slice(0,16)+'…</small></button>').join('');
$('source-files').querySelectorAll('[data-source]').forEach(b=>b.addEventListener('click',guarded(()=>{
 const a=DATA.attachments[Number(b.dataset.source)],binary=atob(a.base64),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
 if(bytes.byteLength!==a.bytes)throw Error('The retained attachment length differs.');
 download(a.path.split('/').at(-1),bytes,'text/csv;charset=utf-8');notify('Downloaded exact retained original '+a.path.split('/').at(-1));
})));
$('selection').addEventListener('submit',e=>e.preventDefault());
$('station').addEventListener('change',guarded(()=>{setCohorts($('station').value,state.cohort_id);dirty=true;render();}));
for(const id of ['chart-scale','cohort','start-year','end-year','season','flow-ratio','depth-mode','approved-only','numeric-only'])$(id).addEventListener('change',guarded(()=>{dirty=true;render();}));
$('notes').addEventListener('input',()=>{dirty=true;state.notes=$('notes').value;notify('Unsaved working notes. Save the study to keep this edition.');});
$('save-study').addEventListener('click',guarded(saveStudy));
$('save-html').addEventListener('click',guarded(()=>{
 state=readControls();const clone=document.documentElement.cloneNode(true);
 clone.querySelector('#saved-state').textContent=JSON.stringify(state).replaceAll('<','\\u003c');
 clone.querySelector('#status').textContent='Saved working study. Opening retained observations…';
 download('Eighteenmile_Seasonal_Working.html','<!doctype html>\n'+clone.outerHTML,'text/html;charset=utf-8');dirty=false;notify('Complete working HTML saved. It reopens offline with this selection and notes.');
}));
$('open-study').addEventListener('change',async e=>{try{
 const file=e.target.files[0];if(!file)return;if(file.size>150000)throw Error('Saved study JSON exceeds the supported selection size.');
 const next=validateState(JSON.parse(await file.text()));
 if(dirty&&!window.confirm('Replace the unsaved current selection and notes with this saved study?'))return;
 state=next;dirty=false;setControls();render();notify('Saved study opened with matching original sources.');
}catch(error){fail(error);}finally{e.target.value='';}});
$('export-analysis').addEventListener('click',guarded(()=>{render();download('Eighteenmile_Current_Analysis.json',JSON.stringify({source_edition_sha256:DATA.source_edition_sha256,state,current,sensitivities},null,2)+'\n','application/json');}));
$('export-pairs').addEventListener('click',guarded(()=>{render();download('Eighteenmile_Seasonal_Pairs.csv',csv(current.pairs),'text/csv;charset=utf-8');}));
$('export-sensitivity').addEventListener('click',guarded(()=>{render();download('Eighteenmile_Trend_Sensitivity.csv',csv(sensitivities),'text/csv;charset=utf-8');}));
$('print').addEventListener('click',guarded(()=>{render();window.print();}));
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
try{render();}catch(e){fail(e);}
})();
