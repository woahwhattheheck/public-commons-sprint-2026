/** Human-readable scientific reports for the existing saved flow studies. */
const e=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=x=>x===null||x===undefined?'—':Number(x).toLocaleString('en-US',{maximumSignificantDigits:8});
const style=':root{color-scheme:light}*{box-sizing:border-box}body{font:15px/1.5 system-ui,sans-serif;margin:0;color:#202020;background:#fff}main{max-width:1180px;margin:auto;padding:28px}h1{font-size:28px;line-height:1.2}h2{margin-top:32px;font-size:20px}h3{font-size:17px}.subtitle,small{color:#555}.metrics{display:flex;flex-wrap:wrap;gap:12px}.metric{padding:12px 16px;border:1px solid #ccc;min-width:145px;flex:1}.metric strong{display:block;font-size:22px}.scroll{overflow:auto;max-width:100%}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #ddd;padding:9px}th{background:#f1f1f1;white-space:nowrap}.numeric{text-align:right;font-variant-numeric:tabular-nums}.note{border-left:3px solid #777;padding:10px 14px;background:#f5f5f5}code,td,dd,a{overflow-wrap:anywhere}dl{display:grid;grid-template-columns:minmax(90px,160px) 1fr;gap:7px 14px}dd{margin:0}a{color:inherit;text-underline-offset:3px}.links{display:flex;gap:16px;flex-wrap:wrap}svg{width:100%;height:auto;display:block;border:1px solid #ddd}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}details{margin:12px 0}summary{cursor:pointer;font-weight:600}@media(max-width:600px){main{padding:16px}h1{font-size:24px}.metric{min-width:130px}dl{display:block}dt{font-weight:600;margin-top:10px}}@media print{main{max-width:none;padding:10mm}table{font-size:10px}tr{break-inside:avoid}.scroll{overflow:visible}h2{break-after:avoid}}';
const shell=(title,body)=>'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+e(title)+'</title><style>'+style+'</style><main>'+body+'</main></html>\n';
function links(items){return '<nav class="links" aria-label="Complete downloads">'+items.map(([title,url])=>'<a href="'+e(url)+'">'+e(title)+'</a>').join('')+'</nav>';}
function chart(rows,station){
 const data=rows.filter(r=>r.monitoring_location_id===station),values=data.filter(r=>r.flow?.discharge_m3_s!=null).map(r=>r.flow.discharge_m3_s);
 if(!values.length)return '<p>No numeric discharge is available for this selection.</p>';
 let high=values.reduce((a,b)=>Math.max(a,b),-Infinity),low=values.reduce((a,b)=>Math.min(a,b),0);if(high===low)high=low+1;
 const W=1000,H=260,left=70,right=18,top=22,bottom=35;
 const x=i=>left+i/Math.max(1,data.length-1)*(W-left-right),y=v=>top+(high-v)/(high-low)*(H-top-bottom);
 let path='',pen=false;data.forEach((r,i)=>{if(r.flow?.discharge_m3_s==null){pen=false;return;}path+=(pen?'L':'M')+x(i).toFixed(2)+','+y(r.flow.discharge_m3_s).toFixed(2);pen=true;});
 const ticks=Array.from({length:5},(_,i)=>{const value=low+(high-low)*i/4,Y=y(value);return '<line x1="'+left+'" x2="'+(W-right)+'" y1="'+Y+'" y2="'+Y+'" stroke="#ddd"/><text x="'+(left-9)+'" y="'+(Y+4)+'" text-anchor="end">'+e(n(value))+'</text>';}).join('');
 return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+e(station)+' daily mean discharge in cubic metres per second"><title>'+e(station)+' — original daily mean discharge</title><g font-family="system-ui" font-size="12" fill="#333">'+ticks+'<path d="'+path+'" fill="none" stroke="#222" stroke-width="1.4"/><text x="'+left+'" y="'+(H-10)+'">'+e(data[0].date)+'</text><text x="'+(W-right)+'" y="'+(H-10)+'" text-anchor="end">'+e(data.at(-1).date)+'</text><text x="'+left+'" y="15">m³/s</text></g></svg>';
}
export function renderFlowStudy(study,urls={}){
 const link={study:'flow-study.json',daily:'daily-flow.csv',periods:'flow-periods.csv',samples:'sample-flow.csv',...urls};
 const summary=study.edition.summary,counts=study.sample_context.counts;
 let body='<p class="subtitle">TJLabs · Upper Savannah · Measurements</p><h1>'+e(study.input.title)+'</h1><p>'+e(study.edition.start)+' through '+e(study.edition.end)+' · original agency reporting dates</p>'+links([['Complete study and originals',link.study],['Daily discharge CSV',link.daily],['Calendar-period CSV',link.periods],['Sample-date CSV',link.samples]]);
 for(const s of summary){
  body+='<h2>'+e(s.monitoring_location_id)+'</h2><div class="metrics">'+[['Numeric / selected days',n(s.quantified_days)+' / '+n(s.expected_days)],['Known volume · m³',n(s.known_volume_m3)],['Mean over numeric days · m³/s',n(s.mean_discharge_m3_s)],['Approved / provisional days',n(s.approved_days)+' / '+n(s.provisional_days)]].map(([label,value])=>'<div class="metric"><span>'+e(label)+'</span><strong>'+e(value)+'</strong></div>').join('')+'</div><p>'+n(s.missing_days)+' missing; '+n(s.ambiguous_days)+' ambiguous; '+n(s.unquantified_days)+' unquantified; '+n(s.qualified_days)+' qualified; '+n(s.signed_negative_days)+' signed negative days.</p>'+chart(study.edition.rows,s.monitoring_location_id);
 }
 body+='<p class="note">Volume is the sum of original daily mean discharge ×86,400 seconds over numeric, unambiguous days. Missing days are retained without substitution. A complete selected window can still be a partial month, water year or calendar year. Provisional and qualified source values keep their original status.</p>';
 body+='<h2>Calendar support and volumes</h2><p>Monthly, calendar-year and water-year rows overlap in time. Compare like periods; do not add totals from different period types.</p><div class="scroll"><table><thead><tr><th>Station / period</th><th>Actual dates</th><th>Numeric / selected / full days</th><th>Full calendar coverage</th><th>Known volume (m³)</th><th>Mean (m³/s)</th><th>Approved / provisional</th></tr></thead><tbody>';
 const order={calendar:0,water:1,month:2};
 for(const p of [...study.periods].sort((a,b)=>order[a.period_kind]-order[b.period_kind]||a.period.localeCompare(b.period)||a.monitoring_location_id.localeCompare(b.monitoring_location_id))){
  body+='<tr><td>'+e(p.monitoring_location_id)+'<br>'+e(p.period_kind)+' '+e(p.period)+'</td><td>'+e(p.start)+'<br>'+e(p.end)+'</td><td>'+n(p.quantified_days)+' / '+n(p.expected_days)+' / '+n(p.calendar_days)+'</td><td>'+(p.complete_calendar_period?'Complete':'Partial or missing')+'</td><td class="numeric">'+n(p.known_volume_m3)+'</td><td class="numeric">'+n(p.mean_discharge_m3_s)+'</td><td>'+n(p.approved_days)+' / '+n(p.provisional_days)+'</td></tr>';
 }
 body+='</tbody></table></div><h2>Sampling-day context</h2><p>'+n(counts.samples)+' original results; '+n(counts.distinct_station_dates)+' station-date pairs; '+n(counts.matched_numeric_dates)+' pairs with numeric daily flow; '+n(counts.spatially_matched_samples)+' samples with explicitly matched catchment support.</p><p>Daily flow describes the source reporting day. It is not an instantaneous discharge measurement at the sampling time.</p><div class="scroll"><table><thead><tr><th>Sample station</th><th>Selected gauge</th><th>Spatial relationship / flow role</th><th>Original relationship evidence</th></tr></thead><tbody>';
 for(const r of study.input.relations)body+='<tr><td>'+e(r.station_id)+'</td><td>'+e(r.gauge_id)+'</td><td>'+e(r.gauge_relation)+'<br>'+e(r.flow_location_role)+'</td><td>'+e(r.source)+'<br>'+e(r.notes)+'</td></tr>';
 body+='</tbody></table></div><h2>Original source responses</h2><div class="scroll"><table><thead><tr><th>Original file</th><th>Interpretation</th><th>Exact source identity</th><th>Original URI</th></tr></thead><tbody>';
 for(const source of [...study.input.sources,...study.input.sample_sources])body+='<tr><td>'+e(source.id)+'</td><td>'+e(source.original_format||source.format)+'</td><td><code>'+e(source.sha256)+'</code></td><td>'+e(source.uri)+'</td></tr>';
 body+='</tbody></table></div><h2>Selected study</h2><dl><dt>Identity</dt><dd><code>'+e(study.id)+'</code></dd><dt>Series</dt><dd>'+e(JSON.stringify(study.input.series_by_station))+'</dd><dt>Notes</dt><dd>'+e(study.input.notes)+'</dd></dl><p>Complete source values, original records, qualifiers, JSON pointers, sampling clocks and editable selections are retained in the study download. Scientific method and spatial/temporal support remain under the scientist’s control.</p>';
 return shell(study.input.title,body);
}
function loadSeriesContext(series){
 const c=series.series_context;if(!c)return '';
 return '<br><small>'+e([c.chemical_basis&&'Basis: '+c.chemical_basis,c.normalized_unit&&'Unit: '+c.normalized_unit,c.source_speciation&&'Reported species: '+c.source_speciation].filter(Boolean).join(' · '))+'</small>';
}
function canonicalMeasurementRows(integration){
 return (integration.source_samples||[]).filter(sample=>sample.original?.canonical_original?.sourceKind==='wqp');
}
function interpretedMeasurement(row){
 const finite=value=>typeof value==='number'&&Number.isFinite(value);
 if(row.censor==='none'&&finite(row.value))return n(row.value)+' '+row.unit;
 if(row.censor==='left'&&finite(row.upper))return 'At or below '+n(row.upper)+' '+row.unit+' · left-censored';
 if(row.censor==='right'&&finite(row.lower))return 'At or above '+n(row.lower)+' '+row.unit+' · right-censored';
 if(finite(row.lower)&&finite(row.upper))return n(row.lower)+' to '+n(row.upper)+' '+row.unit+' · retained interval';
 return 'Unresolved value or bound';
}
function originalMeasurements(integration){
 const selected=canonicalMeasurementRows(integration);if(!selected.length)return '';
 const groups=new Map();
 for(const sample of selected){const group=groups.get(sample.series_key)||[];group.push(sample);groups.set(sample.series_key,group);}
 const censored=selected.filter(sample=>sample.original.canonical_original.censor!=='none').length;
 let body='<h2 id="original-measurements">Original measurements</h2><p>'+n(selected.length)+' original results, including '+n(censored)+' censored results. Each row keeps its reported value and unit alongside the retained interpretation. Bounds are not substituted point measurements. Repeated dates and activities remain separate results; no averaging or mass calculation is performed in these tables.</p>';
 body+='<p>Dates, local clocks and time-zone labels are reproduced from the source. An agency clock label is not independently corrected here. Blank analytical fractions or chemical bases remain unspecified. The complete CSV and calculation download retain the original records.</p>';
 for(const samples of groups.values()){
  const first=samples[0],c=first.series_context||{},row=first.original.canonical_original;
  body+='<h3>'+e(first.characteristic)+' · '+e(row.unit||'unit unspecified')+'</h3><p>'+e(first.station_id)+' · '+e(row.fraction||'Fraction unspecified')+' · '+e(row.basis?'Basis: '+row.basis:'Chemical or mass basis unspecified')+' · '+e([row.methodContext,row.method].filter(Boolean).join(' ')||'Method unspecified')+'</p>';
  const dimensions=[c.source_speciation&&'Reported species: '+c.source_speciation,c.solids_basis&&('Solids: '+({'total-suspended-solids':'total suspended solids (TSS); no conversion to suspended sediment concentration','suspended-sediment-concentration':'suspended sediment concentration (SSC); no conversion to total suspended solids'}[c.solids_basis]||c.solids_basis)),c.microbial_count_method&&'Count method: '+c.microbial_count_method,c.turbidity_scale&&'Turbidity scale: '+c.turbidity_scale,
   row.resultDepth!==''&&row.resultDepth!=null&&'Result depth: '+[row.resultDepth,row.resultDepthUnit,row.resultDepthReference].filter(x=>x!==''&&x!=null).join(' '),
   row.activityDepth!==''&&row.activityDepth!=null&&'Activity depth: '+[row.activityDepth,row.activityDepthUnit,row.activityDepthReference].filter(x=>x!==''&&x!=null).join(' '),
   row.relativeDepth&&'Relative depth: '+row.relativeDepth,row.timeBasis&&'Time basis: '+row.timeBasis,row.temperatureBasis&&'Temperature basis: '+row.temperatureBasis,row.weightBasis&&'Weight basis: '+row.weightBasis].filter(Boolean);
  if(dimensions.length)body+='<p><small>'+e(dimensions.join(' · '))+'</small></p>';
  body+='<div class="scroll" role="region" tabindex="0" aria-label="'+e(first.characteristic)+' original measurements"><table><caption>'+n(samples.length)+' separate original results</caption><thead><tr><th scope="col">Source date / clock</th><th scope="col">Reported value / unit</th><th scope="col">Retained interpretation</th><th scope="col">Condition / limits / review</th><th scope="col">Original activity / result</th></tr></thead><tbody>';
  for(const sample of [...samples].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))){
   const value=sample.original.canonical_original;
   const clock=[value.sourceTime,value.timeZone].filter(Boolean).join(' ');
   const reported=value.reportedValue!==''&&value.reportedValue!=null?String(value.reportedValue):'No numeric value reported';
   const limits=(value.detectionLimits||[]).map(limit=>[limit.type,limit.value,limit.unit].filter(x=>x!==''&&x!=null).join(' '));
   const quality=[value.detection&&'Condition: '+value.detection,value.qualifier&&'Qualifier: '+value.qualifier,value.status&&'Source status: '+value.status,
     value.review?.state&&'Review: '+value.review.state,...(sample.issues||[])].filter(Boolean);
   if(value.variantCount>1)quality.push(value.selectedVersion?(value.selectedVersion===value.id?'This source version is selected.':'A different source version is selected.'):'Source-version conflict unresolved.');
   body+='<tr><td>'+e(value.sampledDate)+'<br><small>'+e(clock||'Clock not reported')+'</small></td><td>'+e(reported)+(value.reportedUnit?' '+e(value.reportedUnit):'')+'</td><td>'+e(interpretedMeasurement(value))+'</td><td>'+quality.map(e).join('<br>')+(limits.length?'<br><small>'+limits.map(e).join('<br>')+'</small>':'')+'</td><td>'+e(value.activityId)+'<br><small>'+e(value.sourceResultId||sample.id)+'</small></td></tr>';
  }
  body+='</tbody></table></div>';
 }
 return body;
}
export function renderFlowLoads(value,urls={}){
 const integration=value.integration,title=canonicalMeasurementRows(integration).length?'Measurements and discharge':'Concentration and discharge',link={json:'flow-loads.json',daily:'daily-loads.csv',periods:'period-loads.csv',context:'concentration-context.csv',annual:'annual-loads.csv',...urls};
 let body='<p class="subtitle">TJLabs · Upper Savannah · Measurements</p><h1>'+e(title)+'</h1><p>'+e(integration.contract.period.start)+' through '+e(integration.contract.period.end)+' (end exclusive)</p>'+links([['Complete calculation',link.json],['Daily rows',link.daily],['Period quantities',link.periods],['Original measured context',link.context],['Complete eligible annual quantities',link.annual]]);
 body+='<p class="note">'+e(integration.uncertainty)+'</p><p>'+n(integration.counts.source_samples)+' source samples; '+n(integration.counts.source_flows)+' selected flow rows; '+n(integration.counts.series)+' constituent/fraction/method series.</p><h2>Series support and coverage</h2><div class="scroll"><table><thead><tr><th>Station / constituent</th><th>Fraction / method</th><th>Support</th><th>Source / usable samples</th><th>Quantified days</th><th>Interpretation</th></tr></thead><tbody>';
 for(const s of integration.series)body+='<tr><td>'+e(s.station_id)+'<br>'+e(s.characteristic)+loadSeriesContext(s)+'</td><td>'+e(s.sample_fraction)+'<br>'+e(s.method_context)+' '+e(s.method_id)+'</td><td>'+e(s.support.gauge_relation)+'</td><td>'+n(s.source_sample_count)+' / '+n(s.usable_sample_count)+'</td><td>'+n(s.periods[0]?.quantified_days||0)+' / '+n(s.periods[0]?.expected_days||0)+'</td><td>'+e(s.support.issues.join('; ')||s.status)+'</td></tr>';
 body+='</tbody></table></div>'+originalMeasurements(integration)+'<h2>Quantities over supported days</h2><p>Reported bounds describe the chosen censoring/interpolation calculation. They are not confidence intervals. Flow-weighted concentrations use the identical quantified-day water volume.</p><div class="scroll"><table><thead><tr><th>Series / period</th><th>Dates (end exclusive)</th><th>Quantified / expected days</th><th>Mass point / lower / upper (kg)</th><th>Matched water volume (m³)</th><th>Flow-weighted point / lower / upper (mg/L)</th></tr></thead><tbody>';
 let count=0;
 for(const s of integration.series)for(const p of [...s.periods,...s.annual]){
  count++;body+='<tr><td>'+e(s.station_id)+'<br>'+e(s.characteristic)+' / '+e(s.sample_fraction)+loadSeriesContext(s)+'<br>'+e(p.label)+'</td><td>'+e(p.period_start)+'<br>'+e(p.period_end)+'</td><td>'+n(p.quantified_days)+' / '+n(p.expected_days)+'</td><td>'+n(p.load_kg)+' / '+n(p.load_lower_kg)+' / '+n(p.load_upper_kg)+'</td><td class="numeric">'+n(p.quantified_flow_volume_m3)+'</td><td>'+n(p.flow_weighted_concentration_mg_l)+' / '+n(p.flow_weighted_concentration_lower_mg_l)+' / '+n(p.flow_weighted_concentration_upper_mg_l)+'</td></tr>';
 }
 body+='</tbody></table></div>';
 if(!count)body+='<p>These original station relationships provide regional flow context. The selected study contains no co-located catchment concentration/discharge series for mass integration. Its complete original concentration records and sampling-day links remain available above.</p>';
 body+='<h2>Selected scientific method</h2><dl><dt>Method edition</dt><dd>'+e(integration.schema)+'</dd><dt>Original flow study</dt><dd><code>'+e(value.flow_study_id)+'</code></dd><dt>Maximum interpolation gap</dt><dd>'+n(integration.contract.maximum_interpolation_gap_days)+' days</dd><dt>Daily concentration approximation</dt><dd>'+e(integration.contract.daily_concentration_basis)+'</dd><dt>Event sampling</dt><dd>'+e(integration.contract.event_sampling_policy)+'</dd></dl><details><summary>Complete selected support and method contract</summary><pre>'+e(JSON.stringify(integration.contract,null,2))+'</pre></details>';
 return shell(title,body);
}
