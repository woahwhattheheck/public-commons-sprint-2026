// MIT. Complete editable CSV and static reporting of explicitly selected source components.
import {identity,plain} from '../contract.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const csvCell=value=>'"'+String(value??'').replace(/"/g,'""')+'"';
const line=values=>values.map(csvCell).join(',')+'\r\n';
const json=value=>JSON.stringify(value);
const show=value=>value===null||value===undefined?'Not established':String(value);
const fail=message=>{throw Object.assign(new Error(message),{code:'SENSORTHINGS_COMPONENT_REPORT'});};
const link=(url,label)=>/^https:\/\//.test(url??'')?'<a href="'+esc(url)+'" rel="noreferrer">'+esc(label)+'</a>':esc(label);
function validate(report){
 if(!plain(report)||report.schema!=='stellar-forge.sensorthings-component-source-report.v1'||!Array.isArray(report.streams)||
    !plain(report.timeAudit)||!Array.isArray(report.timeAudit.duplicateInstants)||!Array.isArray(report.timeAudit.maximumGaps)||
    !plain(report.sourceManifest)||!Array.isArray(report.paging?.pages)||!Array.isArray(report.descriptor?.components))
  fail('Use the complete source-bound component report.');
 for(const stream of report.streams)if(!plain(stream.statistics?.numericSummary)||!Array.isArray(stream.plot)||!Array.isArray(stream.statistics?.days))
  fail('A selected component is missing its complete events or sample summary.');
 return report;
}
function reference(ref,label='Original source'){
 if(!ref)return 'Unavailable';
 return link(ref.url,label)+' <code>'+esc(ref.jsonPointer||'(document root)')+'</code><br><span class="hash">'+esc(ref.sha256)+'</span>';
}
function exactNumber(value){return Number.isFinite(value)?String(Number(value.toPrecision(7))):'Outside plot range';}
export function componentEventFigure(stream,window,{width=1200,height=360}={}){
 const rows=stream.plot.filter(x=>x.numericEligibility?.eligible===true&&x.timeKind==='explicit_instant'&&x.state==='value'&&x.type==='number'&&Number.isFinite(Number(x.value)));
 const title=stream.name+' — original selected component '+stream.index,
   description='Individual source events; no interpolation, connected line, duration or repaired timestamp. Original unit '+json(stream.unit)+'.';
 if(!rows.length)return {filename:'component-'+stream.index+'.svg',svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 180" role="img"><title>'+esc(title)+'</title><rect width="1200" height="180" fill="#f4f7fa"/><text x="32" y="80" font-family="sans-serif" font-size="22">No eligible explicit numeric events in this selection.</text></svg>',points:0};
 let lo=Infinity,hi=-Infinity;for(const row of rows){const value=Number(row.value);if(value<lo)lo=value;if(value>hi)hi=value;}
 const scale=Math.max(Math.abs(lo),Math.abs(hi))||1,
   ln=lo/scale,hn=hi/scale,pad=Math.max((hn-ln)*.08,.001),a=ln-pad,b=hn+pad,
   start=Date.parse(window.start),end=Date.parse(window.endExclusive),left=92,right=28,top=44,bottom=68,innerW=width-left-right,innerH=height-top-bottom;
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)fail('The plot requires an exact increasing source window.');
 const x=t=>left+(Date.parse(t)-start)/(end-start)*innerW,y=v=>top+(b-v/scale)/(b-a)*innerH,
   color=stream.index%2?'#137f79':'#295fa5',parts=[],figureId='component-'+identity({seriesKey:stream.seriesKey,index:stream.index}).slice(0,16);
 parts.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+width+' '+height+'" role="img" aria-labelledby="'+figureId+'-title '+figureId+'-desc"><title id="'+figureId+'-title">'+esc(title)+'</title><desc id="'+figureId+'-desc">'+esc(description)+'</desc><rect width="'+width+'" height="'+height+'" rx="12" fill="#f5f8fa"/>');
 parts.push('<text x="'+left+'" y="25" font-family="sans-serif" font-size="17" font-weight="600" fill="#172d40">'+esc(stream.name)+' ['+esc(stream.unit?.symbol??'unit not declared')+']</text>');
 for(let i=0;i<=4;i++){
  const yy=top+innerH*i/4,v=(b-(b-a)*i/4)*scale;
  parts.push('<line x1="'+left+'" x2="'+(width-right)+'" y1="'+yy+'" y2="'+yy+'" stroke="#d9e2e9"/><text x="'+(left-12)+'" y="'+(yy+5)+'" text-anchor="end" font-family="sans-serif" font-size="13" fill="#425b70">'+esc(exactNumber(v))+'</text>');
 }
 for(let i=0;i<=7;i++){
  const t=start+(end-start)*i/7,xx=x(new Date(t).toISOString()),label=new Date(t).toISOString().slice(5,10);
  parts.push('<line x1="'+xx+'" x2="'+xx+'" y1="'+top+'" y2="'+(top+innerH)+'" stroke="#e7edf2"/><text x="'+xx+'" y="'+(height-bottom+25)+'" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#425b70">'+label+'</text>');
 }
 for(const row of rows){
  const xx=x(row.time),yy=y(Number(row.value));if(!Number.isFinite(xx)||!Number.isFinite(yy)||xx<left||xx>=width-right)continue;
  const tip=row.timeLiteral+' | '+row.value+' '+(stream.unit?.symbol??'')+' | original observation '+row.observationId+
   ' ('+row.observationIdType+'), component '+stream.index+' | '+row.sourceRef.sha256+' '+row.sourceRef.jsonPointer+
   ' | quality '+row.qualityState+(row.quality?' '+row.quality:'');
  parts.push('<circle cx="'+xx.toFixed(3)+'" cy="'+yy.toFixed(3)+'" r="2.2" fill="'+color+'" fill-opacity=".72"><title>'+esc(tip)+'</title></circle>');
 }
 parts.push('<text x="'+left+'" y="'+(height-18)+'" font-family="sans-serif" font-size="13" fill="#425b70">UTC · '+rows.length+' original events · duplicates retained · points have original-source tooltips</text></svg>');
 return {filename:'component-'+stream.index+'.svg',svg:parts.join(''),points:rows.length};
}
export function componentEventsCSV(report){
 validate(report);
 const columns=['source_manifest_sha256','stream_key','component_index','component_name','component_binding_id','component_meaning_id','unit_json','declared_observation_type',
 'interpretation','acknowledged_declaration_issues','observation_id','observation_id_type','component_occurrence_id','phenomenon_time','phenomenon_time_kind',
 'phenomenon_time_normalized_utc','phenomenon_end_utc','result_time','result_time_state','valid_time','valid_time_state','value','value_state','value_type',
 'original_result_vector','original_result_state','original_result_type','quality','quality_state','component_alignment','numeric_eligible','numeric_exclusion_reason',
 'source_sha256','source_bytes','source_pointer','source_url','source_received_at'];
 const out=[line(columns)];
 for(const s of report.streams)for(const r of s.plot)out.push(line([report.sourceManifest.sha256,s.sourceStreamKey,s.index,s.name,s.bindingId,s.meaningId,json(s.unit),s.declaredType,
  s.interpretation.mode,json(s.interpretation.acknowledgedIssues),r.observationId,r.observationIdType,r.occurrenceId,r.timeLiteral,r.timeKind,r.time,r.endTime,
  r.resultTime,r.resultTimeState,r.validTime,r.validTimeState,r.value,r.state,r.type,r.sourceResult,r.sourceResultState,r.sourceResultType,r.quality,r.qualityState,r.aligned,
  r.numericEligibility?.eligible===true,r.numericEligibility?.reason??'',r.sourceRef.sha256,r.sourceRef.bytes,r.sourceRef.jsonPointer,r.sourceRef.url,r.sourceRef.capturedAt]));
 return out.join('');
}
export function componentDailyCSV(report){
 validate(report);const out=[line(['source_manifest_sha256','stream_key','component_index','component_name','source_unit','utc_day','events','numeric_samples','mean_exact_numerator','mean_exact_denominator',
  'mean_decimal','mean_decimal_places','mean_rounding','minimum_lexeme','minimum_observation_id','minimum_source_sha256','minimum_source_pointer',
  'maximum_lexeme','maximum_observation_id','maximum_source_sha256','maximum_source_pointer','range_exact','quality_states','missing_results','continuous_coverage','time_weighted_mean'])];
 for(const s of report.streams)for(const d of s.statistics.days){const n=d.numericSummary;out.push(line([report.sourceManifest.sha256,s.sourceStreamKey,s.index,s.name,s.unit?.symbol??'',d.day,d.events,n.count,
  n.mean?.exactNumerator,n.mean?.exactDenominator,n.mean?.decimal,n.mean?.decimalPlaces,n.mean?.rounding,n.minimum?.lexeme,n.minimum?.observationId,n.minimum?.sourceRef.sha256,n.minimum?.sourceRef.jsonPointer,
  n.maximum?.lexeme,n.maximum?.observationId,n.maximum?.sourceRef.sha256,n.maximum?.sourceRef.jsonPointer,n.rangeExact,json(d.qualityStates),d.missingResults,'not_established','not_calculated']));}
 return out.join('');
}
export function componentDuplicateTimesCSV(report){
 validate(report);const out=[line(['source_manifest_sha256','duplicate_normalized_utc','events_at_instant','original_observation_id','original_id_type','original_phenomenon_time','original_result_vector',
  'original_quality','original_quality_state','source_sha256','source_pointer','source_url'])];
 for(const group of report.timeAudit.duplicateInstants)for(const e of group.events)out.push(line([report.sourceManifest.sha256,group.time,group.events.length,e.observationId,e.observationIdType,e.phenomenonTime,
  e.sourceResult,e.resultQuality,e.resultQualityState,e.sourceRef.sha256,e.sourceRef.jsonPointer,e.sourceRef.url]));
 return out.join('');
}
export function componentGapsCSV(report){
 validate(report);const out=[line(['source_manifest_sha256','from_normalized_utc','to_normalized_utc','observed_separation_seconds','from_original_ids','to_original_ids','from_source_references','to_source_references'])];
 for(const g of report.timeAudit.adjacentGaps)out.push(line([report.sourceManifest.sha256,g.from,g.to,g.seconds,
  json(g.fromEvents.map(e=>({type:e.observationIdType,value:e.observationId}))),json(g.toEvents.map(e=>({type:e.observationIdType,value:e.observationId}))),
  json(g.fromEvents.map(e=>e.sourceRef)),json(g.toEvents.map(e=>e.sourceRef))]));
 return out.join('');
}
function evidenceCell(e){
 return e?'<strong>'+esc(e.lexeme)+'</strong><br>'+esc(e.phenomenonTime)+'<br>Observation '+esc(e.observationId)+'<br>'+reference(e.sourceRef):'Not calculated';
}
export function renderComponentSourceReport(report){
 validate(report);
 const figures=report.streams.map(s=>componentEventFigure(s,report.sourcePlan.window)),
   duplicateRows=report.timeAudit.duplicateInstants.map(g=>'<tr><td>'+esc(g.time)+'</td><td>'+g.events.map(e=>esc(e.observationId)+' ('+esc(e.observationIdType)+')<br><code>'+esc(e.sourceResult)+'</code>').join('<hr>')+'</td><td>'+g.events.map(e=>reference(e.sourceRef)).join('<hr>')+'</td></tr>').join(''),
   gapRows=report.timeAudit.maximumGaps.map(g=>'<tr><td>'+esc(g.from)+'<br>to '+esc(g.to)+'</td><td>'+esc(g.seconds)+' seconds</td><td>'+g.fromEvents.map(e=>reference(e.sourceRef,'Before: '+e.observationId)).join('<br>')+'<hr>'+g.toEvents.map(e=>reference(e.sourceRef,'After: '+e.observationId)).join('<br>')+'</td></tr>').join('');
 let html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'self\' data:"><title>Original multi-component observations</title><style>'+
 ':root{color-scheme:light;font-family:Arial,Helvetica,sans-serif;color:#183047;background:#eef2f5}*{box-sizing:border-box}body{margin:0}main{max-width:1260px;margin:auto;padding:42px 32px 70px}header{padding:28px 32px;background:#16344c;color:white;border-radius:16px}h1{font-size:32px;line-height:1.2;margin:10px 0 16px}h2{font-size:24px;margin:34px 0 14px}h3{font-size:18px;margin:22px 0 12px}p{line-height:1.6;margin:10px 0}.eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#a8d9da}.meta{font-size:14px;color:#d3e1eb}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:20px 0}.card,section{background:white;border:1px solid #d5dfe7;border-radius:12px;padding:22px}.card strong{display:block;font-size:30px;margin-bottom:8px}.card span{font-size:13px;color:#426078}section{margin:20px 0}section h2{margin-top:0}.callout{border-left:5px solid #bd8535;padding:13px 18px;background:#fff5e5;border-radius:4px;line-height:1.6}.muted{color:#506c81}.small{font-size:13px}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px;margin:12px 0}th{text-align:left;background:#eaf0f5;font-weight:600}th,td{padding:12px 10px;border-bottom:1px solid #dbe3ea;vertical-align:top;line-height:1.5}a{color:#176498;word-break:break-word}code,.hash{font-family:monospace;overflow-wrap:anywhere;word-break:break-word;font-size:11px}.hash{color:#536d80}svg{width:100%;height:auto;display:block;margin:18px 0}hr{border:0;border-top:1px solid #e1e7ec;margin:9px 0}.tag{display:inline-block;padding:3px 7px;background:#e6f2ef;border-radius:5px;font-size:12px}ul{padding-left:22px;line-height:1.7}.number{font-variant-numeric:tabular-nums}footer{margin-top:28px;font-size:13px;line-height:1.6;color:#506c81}@media(max-width:700px){main{padding:18px 12px}header{padding:22px 18px}h1{font-size:25px}.cards{grid-template-columns:1fr 1fr}section{padding:16px}th,td{min-width:115px}}@media print{body{background:white}main{max-width:none;padding:0}header{background:white;color:#183047;border-bottom:3px solid #183047;border-radius:0}.meta,.eyebrow{color:#426078}section{border:0;padding:0}svg,.cards,tr{break-inside:avoid}h2,h3{break-after:avoid}a{color:inherit}.table-wrap{overflow:visible}details{display:block}}'+
 '</style></head><body><main><header><div class="eyebrow">Retained source · Explicit component review</div><h1>'+esc(report.sourcePlan.source.label)+'</h1><p class="meta">'+esc(report.sourcePlan.window.start)+' inclusive to '+esc(report.sourcePlan.window.endExclusive)+' exclusive</p><p class="meta">Calculated '+esc(report.calculatedAt)+' · '+esc(report.actor)+'</p></header>'+
 '<div class="cards"><div class="card"><strong>'+report.sourceRows+'</strong><span>original observation IDs retained</span></div><div class="card"><strong>'+report.selectedComponentRows+'</strong><span>explicitly selected component values</span></div><div class="card"><strong>'+report.timeAudit.distinctInstants+'</strong><span>distinct observed UTC instants</span></div><div class="card"><strong>'+report.timeAudit.duplicateInstants.length+'</strong><span>instants with multiple original IDs</span></div></div>'+
 '<section><h2>What the retained events establish</h2><p>The report selects original component positions '+esc(report.streams.map(s=>s.index+' ('+s.name+')').join(' and '))+'. Values, units, property definitions and declaration issues remain tied to the original ordered arrays. Sample statistics include all selected original observation occurrences, including duplicate timestamps.</p>'+
 '<div class="callout">The original event times contain '+report.timeAudit.duplicateInstants.length+' duplicated instants and '+report.timeAudit.maximumGaps.length+' largest observed separations of '+esc(report.timeAudit.maximumGapSeconds)+' seconds. The source Sensor describes a measurement cadence; this report does not use that description to repair times, fill gaps or claim continuous coverage.</div>'+
 '<p class="muted">This is an analysis of complete acquired source files. Native workspace, capture, edition and export IDs are '+(Object.values(report.native).every(x=>x===null)?'not yet established.':'listed in the complete report JSON.')+' Source-page receipt times are acquisition times, separate from the historical observation times.</p></section>'+
 '<section><h2>Component interpretation and source conflicts</h2><div class="table-wrap"><table><thead><tr><th>Original position</th><th>Property and unit</th><th>Original datatype declaration</th><th>Selection</th></tr></thead><tbody>'+
 report.descriptor.components.map(c=>'<tr><td>'+c.index+'</td><td><strong>'+esc(c.name)+'</strong><br><code>'+esc(c.unitJson)+'</code><br>'+reference(c.property?.sourceRef,'Property source')+'</td><td>'+link(c.declaredType,c.declaredType)+'<br>'+esc(c.issues.join(', ')||'No declaration issues identified')+'</td><td>'+((s=>s?'<span class="tag">Selected · '+esc(s.interpretation.mode)+'</span><p>'+esc(s.interpretation.note)+'</p>':'Retained; not selected')(report.streams.find(s=>s.index===c.index)))+'</td></tr>').join('')+
 '</tbody></table></div><ul>'+report.sourceFindings.map(f=>'<li><strong>'+esc(f.code)+'</strong>: '+esc(f.meaning)+'</li>').join('')+'</ul></section>';
 for(let i=0;i<report.streams.length;i++){
  const s=report.streams[i],n=s.statistics.numericSummary;
  html+='<section><h2>'+esc(s.name)+' <span class="small">[original '+esc(s.unit?.symbol??'unit not declared')+']</span></h2>'+figures[i].svg+
   '<p><strong>Arithmetic sample mean: '+esc(n.mean?.decimal??'Not calculated')+'</strong> · exact numerator '+esc(n.mean?.exactNumerator??'—')+' / '+esc(n.mean?.exactDenominator??'—')+' observations. Decimal display uses half-even rounding to at most 12 decimal places; no time weighting or unit conversion.</p>'+
   '<div class="table-wrap"><table><thead><tr><th>Exact-summary samples</th><th>Minimum with original evidence</th><th>Maximum with original evidence</th><th>Source quality</th></tr></thead><tbody><tr><td>'+n.count+'<br>Exact arithmetic excluded: '+s.statistics.exactNumericExcludedRows+'<br>Browser-eligible points: '+s.statistics.browserNumericEligibleRows+'<br>Browser excluded: '+s.statistics.browserNumericExcludedRows+'</td><td>'+evidenceCell(n.minimum)+'</td><td>'+evidenceCell(n.maximum)+'</td><td><code>'+esc(json(s.statistics.qualityStates))+'</code><p>No automatic QA approval.</p></td></tr></tbody></table></div>'+
   '<h3>Observed daily samples</h3><div class="table-wrap"><table><thead><tr><th>UTC day</th><th>Events</th><th>Numeric samples</th><th>Sample mean</th><th>Minimum</th><th>Maximum</th><th>Missing result</th></tr></thead><tbody>'+
   s.statistics.days.map(d=>'<tr><td>'+esc(d.day)+'</td><td>'+d.events+'</td><td>'+d.numericSummary.count+'</td><td>'+esc(d.numericSummary.mean?.decimal??'Not calculated')+'</td><td>'+esc(d.numericSummary.minimum?.lexeme??'—')+'</td><td>'+esc(d.numericSummary.maximum?.lexeme??'—')+'</td><td>'+d.missingResults+'</td></tr>').join('')+
   '</tbody></table></div><p class="small muted">Daily grouping uses the original explicitly offset-qualified phenomenonTime. Repeated times remain repeated source observations. The complete CSV retains each original vector, position, value, quality state and exact source pointer.</p></section>';
 }
 html+='<section><h2>Original duplicate times</h2><p>'+report.timeAudit.duplicateInstants.length+' distinct instants have more than one original observation ID. All vectors are shown without a replacement time.</p><div class="table-wrap"><table><thead><tr><th>Normalized source instant</th><th>Original IDs and full vectors</th><th>Complete original evidence</th></tr></thead><tbody>'+duplicateRows+'</tbody></table></div></section>'+
 '<section><h2>Largest observed separations</h2><p>These are separations between distinct retained event instants. They do not establish an outage, a validity interval, missing data count or continuous coverage.</p><div class="table-wrap"><table><thead><tr><th>Original bounding instants</th><th>Separation</th><th>Bounding source events</th></tr></thead><tbody>'+gapRows+'</tbody></table></div></section>'+
 '<section><h2>Source and receiving record</h2><p>All '+report.paging.pages.length+' original observation pages were followed through their exact opaque next links to the final response without a continuation. Opening and closing stream bodies are '+(report.metadataBracket.exactStreamBytesEqual?'byte-identical':'different')+'. This does not establish an atomic provider snapshot for every related resource.</p>'+
 '<p><strong>Complete source manifest:</strong> '+esc(report.sourceManifest.filename)+' · '+report.sourceManifest.bytes+' bytes<br><span class="hash">'+esc(report.sourceManifest.sha256)+'</span></p>'+
 '<p><strong>Rights:</strong> '+esc(report.license.name)+'. '+esc(report.license.note)+'</p><p>'+link(report.sourceScope.serviceUrl,'Original source service')+' · '+link(report.meaning.standards.split(' ').at(-1),'OGC SensorThings 1.1 source contract')+'</p>'+
 '<div class="table-wrap"><table><thead><tr><th>Original page</th><th>Rows</th><th>Complete body SHA-256</th><th>Acquired at</th></tr></thead><tbody>'+
 report.paging.pages.map(p=>'<tr><td>'+link(p.url,p.role)+'</td><td>'+p.rows+'</td><td class="hash">'+esc(p.body.sha256)+'</td><td>'+esc(p.receivedAt)+'</td></tr>').join('')+
 '</tbody></table></div><p class="small muted">Both complete connector responses are retained for every original body. External HTTP method, status and headers were not exposed by that connector and remain null. The original JSON, raw numeric lexemes, relationship metadata, source manifest, failed licence-discovery evidence and exact acquisition records accompany the report.</p></section>'+
 '<footer>Editable outputs: component-events.csv, daily-statistics.csv, duplicate-times.csv and observed-gaps.csv. Complete structured report: source-report.json. Figures contain all eligible points with source tooltips. Calculation identity '+esc(identity({source:report.sourceManifest,plan:report.sourcePlan,calculatedAt:report.calculatedAt}))+'.</footer></main></body></html>';
 return {html,componentCSV:componentEventsCSV(report),dailyCSV:componentDailyCSV(report),duplicateTimesCSV:componentDuplicateTimesCSV(report),gapsCSV:componentGapsCSV(report),figures};
}
