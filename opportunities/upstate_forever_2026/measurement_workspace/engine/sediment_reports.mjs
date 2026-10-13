/** Complete offline sediment-study reports. Calculation remains in the original scientific engine. */
import {InputError,csv} from './parse.mjs';

const TYPES=['pairs','residuals','predictions','coefficients'];
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const json=value=>JSON.stringify(value,null,2);
const present=value=>value===null||value===undefined?'—':typeof value==='object'?JSON.stringify(value):String(value);
const cell=value=>esc(present(value));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
function checked(study){
 if(study?.format!=='upstate.sediment-surrogate-study/v1'||!study.id||!study.input?.definition||!Array.isArray(study.input.sources)||!Array.isArray(study.input.contexts)||!Array.isArray(study.result?.pairing?.rows)||!Array.isArray(study.result?.fit?.rows)||!study.result.fit.model)throw new InputError('Choose a complete sediment study rebuilt from its retained original sources');
 return study;
}
function valueRows(study,kind){
 const {pairing,fit,predictions}=study.result,byId=new Map(pairing.rows.map(r=>[r.id,r]));
 const meta={edition_id:study.id,named_study_id:study.study_id,pairing_id:pairing.id,target:fit.sourceBinding.target,site_id:fit.sourceBinding.siteId,sensor_id:fit.sourceBinding.sensor.id,sensor_method:fit.sourceBinding.sensor.method,turbidity_unit:fit.sourceBinding.sensor.unit};
 if(kind==='pairs')return pairing.rows.map(r=>({...meta,pair_id:r.id,sample_date:r.sampledDate,sample_timestamp:r.sampledAt,event_id:r.eventId,support:r.support,ssc_mg_L:r.ssc?.value,ssc_analyte:r.ssc?.analyte,ssc_original_ids:r.ssc?.sourceIds,turbidity:r.turbidity?.value,turbidity_original_ids:r.turbidity?.sourceIds,discharge_m3_s:r.discharge?.value,discharge_original_ids:r.discharge?.sourceIds,issues:r.issues,original_pair_json:r}));
 if(kind==='residuals')return fit.rows.map(r=>{
  const pair=byId.get(r.id),p=r.prediction;
  return {...meta,pair_id:r.id,sample_date:pair?.sampledDate,sample_timestamp:pair?.sampledAt,event_id:pair?.eventId,support:pair?.support,cohort:r.role,reason:r.reason,status:r.status,issues:r.issues,observed_mg_L:r.observed,observed_fitted_scale:r.transformedObserved,fitted_response_scale:fit.model.responseTransform,linear_predictor:p?.linearPredictor,location_mg_L:p?.location,mean_mg_L:p?.mean,location_lower_mg_L:p?.locationInterval?.lower,location_upper_mg_L:p?.locationInterval?.upper,location_interval_estimand:p?.locationInterval?.estimand,prediction_lower_mg_L:p?.predictionInterval?.lower,prediction_upper_mg_L:p?.predictionInterval?.upper,coverage:p?.predictionInterval?.coverage,residual_fitted_scale:r.residual,residual_observed_minus_mean_mg_L:r.originalMeanResidual,studentized_residual:r.studentizedResidual,deleted_residual:r.deletedResidual,cooks_distance:r.cooksDistance,leverage:p?.leverage,nonphysical:p?.nonphysical,original_outcome_json:r};
 });
 if(kind==='predictions'){
  const originals=new Map((predictions?.input?.rows||[]).map(r=>[r.id,r]));
  return (predictions?.rows||[]).map(r=>{const original=originals.get(r.id),p=r.prediction;return {...meta,observation_id:r.id,sample_date:original?.sampledDate,sample_timestamp:original?.sampledAt,event_id:original?.eventId,support:original?.support,status:r.status,reasons:r.reasons,outside_training_range:r.outside,turbidity:original?.turbidity?.value,discharge_m3_s:original?.discharge?.value,linear_predictor:p?.linearPredictor,location_mg_L:p?.location,mean_mg_L:p?.mean,location_lower_mg_L:p?.locationInterval?.lower,location_upper_mg_L:p?.locationInterval?.upper,location_interval_estimand:p?.locationInterval?.estimand,prediction_lower_mg_L:p?.predictionInterval?.lower,prediction_upper_mg_L:p?.predictionInterval?.upper,coverage:p?.predictionInterval?.coverage,nonphysical:p?.nonphysical,original_input_json:original,original_outcome_json:r};});
 }
 return fit.model.coefficients.map(r=>({...meta,coefficient:r.name,value:r.value,standard_error:r.standardError,lower:r.lower,upper:r.upper,coverage:fit.model.confidence,coefficient_basis:fit.model.coefficientBasis,response_transform:fit.model.responseTransform,predictor_transform:r.name==='intercept'?'constant':fit.model.predictors.find(p=>p.name===r.name)?.transform,predictor_unit:r.name==='intercept'?'constant':fit.model.predictors.find(p=>p.name===r.name)?.unit,training_count:fit.model.n,degrees_of_freedom:fit.model.df,smearing_factor:fit.model.smearingFactor,smearing_method:fit.model.smearingMethod}));
}
const EMPTY_FIELDS={
 pairs:['edition_id','named_study_id','pairing_id','target','site_id','sensor_id','sensor_method','turbidity_unit','pair_id','sample_date','sample_timestamp','event_id','support','ssc_mg_L','ssc_analyte','ssc_original_ids','turbidity','turbidity_original_ids','discharge_m3_s','discharge_original_ids','issues','original_pair_json'],
 residuals:['edition_id','named_study_id','pairing_id','target','site_id','sensor_id','sensor_method','turbidity_unit','pair_id','sample_date','sample_timestamp','event_id','support','cohort','reason','status','issues','observed_mg_L','observed_fitted_scale','fitted_response_scale','linear_predictor','location_mg_L','mean_mg_L','location_lower_mg_L','location_upper_mg_L','location_interval_estimand','prediction_lower_mg_L','prediction_upper_mg_L','coverage','residual_fitted_scale','residual_observed_minus_mean_mg_L','studentized_residual','deleted_residual','cooks_distance','leverage','nonphysical','original_outcome_json'],
 predictions:['edition_id','named_study_id','pairing_id','target','site_id','sensor_id','sensor_method','turbidity_unit','observation_id','sample_date','sample_timestamp','event_id','support','status','reasons','outside_training_range','turbidity','discharge_m3_s','linear_predictor','location_mg_L','mean_mg_L','location_lower_mg_L','location_upper_mg_L','location_interval_estimand','prediction_lower_mg_L','prediction_upper_mg_L','coverage','nonphysical','original_input_json','original_outcome_json'],
 coefficients:['edition_id','named_study_id','pairing_id','target','site_id','sensor_id','sensor_method','turbidity_unit','coefficient','value','standard_error','lower','upper','coverage','coefficient_basis','response_transform','predictor_transform','predictor_unit','training_count','degrees_of_freedom','smearing_factor','smearing_method']
};
/** Exact numeric values; original text follows the workspace's spreadsheet-safe CSV convention. */
export function sedimentCSV(study,kind='residuals'){
 checked(study);if(!TYPES.includes(kind))throw new InputError('Choose pairs, residuals, predictions or coefficients');
 return csv(valueRows(study,kind),EMPTY_FIELDS[kind]);
}
function table(headers,rows,caption){
 if(!rows.length)return '<p>'+esc(caption)+': no rows.</p>';
 return '<div class="table-scroll" tabindex="0"><table><caption>'+esc(caption)+' · '+rows.length+' rows</caption><thead><tr>'+headers.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+cell(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
function details(title,value,path=null){return '<details'+(path?' data-study-path="'+esc(JSON.stringify(path))+'"':'')+'><summary>'+esc(title)+'</summary>'+(path?'<pre data-detail-body hidden></pre><noscript><p>The complete retained value is in the embedded study JSON. Enable JavaScript to expand it here.</p></noscript>':'<pre>'+esc(json(value))+'</pre>')+'</details>';}
function stats(fit){
 const headings=['Cohort / scale','Count','RMSE','MAE','Bias (predicted − observed)','R²','Prediction interval coverage'];
 return table(headings,[['Training / mg/L',fit.statistics.training],['Validation / mg/L',fit.statistics.validation],['Training / fitted response',fit.statistics.trainingResponseScale],['Validation / fitted response',fit.statistics.validationResponseScale]].map(([label,s])=>[label,s.count,s.rmse,s.mae,s.bias,s.rSquared,s.intervalCoverage]),'Calibration and validation remain separate');
}
function extent(values){
 let lo=Infinity,hi=-Infinity;for(const x of values)if(finite(x)){lo=Math.min(lo,x);hi=Math.max(hi,x);}
 if(!finite(lo)||!finite(hi))return [0,1];
 const span=hi-lo,pad=span?span*.06:Math.max(Math.abs(lo)*.06,.5);return [lo-pad,hi+pad];
}
const label=value=>Number(value.toPrecision(5)).toString();
function plot(points,{title,xlabel,ylabel,diagonal=false,zero=false,dateAxis=false,intervals=false}){
 if(!points.length)return '<figure><figcaption>'+esc(title)+'</figcaption><p>No calculated observations for this plot.</p></figure>';
 const xs=points.map(p=>p.x),ys=points.flatMap(p=>intervals?[p.y,p.lower,p.upper]:[p.y]);
 let xr=extent(xs),yr=extent(ys);if(diagonal){const all=extent([...xs,...ys]);xr=all;yr=all;}
 if(zero){yr=[Math.min(yr[0],0),Math.max(yr[1],0)];}
 const W=820,H=400,L=96,R=28,T=22,B=76,pw=W-L-R,ph=H-T-B;
 const X=x=>L+(x-xr[0])/(xr[1]-xr[0])*pw,Y=y=>T+ph-(y-yr[0])/(yr[1]-yr[0])*ph;
 const tick=(n,axis)=>dateAxis&&axis==='x'?new Date(n).toISOString().slice(0,10):label(n);
 const lines=Array.from({length:5},(_,i)=>{const x=xr[0]+(xr[1]-xr[0])*i/4,y=yr[0]+(yr[1]-yr[0])*i/4;return '<line class="grid" x1="'+X(x)+'" y1="'+T+'" x2="'+X(x)+'" y2="'+(T+ph)+'"/><line class="grid" x1="'+L+'" y1="'+Y(y)+'" x2="'+(L+pw)+'" y2="'+Y(y)+'"/><text x="'+X(x)+'" y="'+(T+ph+22)+'" text-anchor="middle">'+esc(tick(x,'x'))+'</text><text x="'+(L-10)+'" y="'+(Y(y)+4)+'" text-anchor="end">'+esc(tick(y,'y'))+'</text>';}).join('');
 const guides=(diagonal?'<line class="reference" x1="'+X(xr[0])+'" y1="'+Y(xr[0])+'" x2="'+X(xr[1])+'" y2="'+Y(xr[1])+'"/>':'')+(zero?'<line class="reference" x1="'+L+'" y1="'+Y(0)+'" x2="'+(L+pw)+'" y2="'+Y(0)+'"/>':'');
 const marks=points.map(p=>{
  const tip='<title>'+esc(p.title)+'</title>';
  const bar=intervals&&finite(p.lower)&&finite(p.upper)?'<line class="interval" x1="'+X(p.x)+'" y1="'+Y(p.lower)+'" x2="'+X(p.x)+'" y2="'+Y(p.upper)+'"/><line class="interval" x1="'+(X(p.x)-3)+'" y1="'+Y(p.lower)+'" x2="'+(X(p.x)+3)+'" y2="'+Y(p.lower)+'"/><line class="interval" x1="'+(X(p.x)-3)+'" y1="'+Y(p.upper)+'" x2="'+(X(p.x)+3)+'" y2="'+Y(p.upper)+'"/>':'';
  return '<g>'+bar+'<circle cx="'+X(p.x)+'" cy="'+Y(p.y)+'" r="'+(p.role==='validate'?4:3)+'" class="'+(p.role==='validate'?'heldout':'training')+'">'+tip+'</circle></g>';
 }).join('');
 return '<figure><figcaption>'+esc(title)+' · '+points.length+' calculated points</figcaption><svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(title)+'"><title>'+esc(title)+'</title><desc>'+esc(xlabel)+' horizontally; '+esc(ylabel)+' vertically. Filled circles denote training; open circles denote validation or deployment. Complete values follow in the tables.</desc>'+lines+guides+marks+'<text x="'+(L+pw/2)+'" y="'+(H-16)+'" text-anchor="middle">'+esc(xlabel)+'</text><text transform="translate(20 '+(T+ph/2)+') rotate(-90)" text-anchor="middle">'+esc(ylabel)+'</text></svg></figure>';
}
function equation(model){
 const response=model.responseTransform==='log10'?'log10('+model.target+' [mg/L])':model.target+' [mg/L]';
 const terms=model.coefficients.map((c,i)=>{
  if(!i)return String(c.value);
  const p=model.predictors.find(p=>p.name===c.name),term=p.transform==='log10'?'log10('+p.name+' ['+p.unit+'])':p.name+' ['+p.unit+']';
  return (c.value<0?' − ':' + ')+Math.abs(c.value)+' × '+term;
 });
 return response+' = '+terms.join('');
}
function pairedRows(study){
 const outcomes=new Map(study.result.fit.rows.map(r=>[r.id,r]));
 return study.result.pairing.rows.map(r=>{const o=outcomes.get(r.id);return [r.id,r.sampledDate,r.sampledAt,r.support?.precision,r.eventId,r.ssc?.analyte,r.ssc?.value,r.turbidity?.value,r.discharge?.value,o?.role,o?.reason,r.issues];});
}
function downloadCode(){
 const data=JSON.parse(document.getElementById('study-data').textContent);
 const exportData=JSON.parse(document.getElementById('csv-data').textContent);
 document.addEventListener('toggle',event=>{
  const detail=event.target;
  if(!detail?.matches?.('details[data-study-path]'))return;
  const body=detail.querySelector('[data-detail-body]');
  if(!detail.open){body.textContent='';body.hidden=true;return;}
  let value=data;
  for(const key of JSON.parse(detail.dataset.studyPath))value=value?.[key];
  body.textContent=JSON.stringify(value,null,2);body.hidden=false;
 },true);
 function filename(value){const name=String(value||'source').replace(/[^a-zA-Z0-9._-]/g,'_'),suffix=name.match(/\.[a-zA-Z0-9]{1,12}$/)?.[0]||'';return name.length<=180?name:name.slice(0,180-suffix.length)+suffix;}
 function download(value,type,name){
  const url=URL.createObjectURL(new Blob([value],{type})),a=document.createElement('a');
  a.href=url;a.download=filename(name);document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
 }
 document.addEventListener('click',event=>{
  const button=event.target.closest('button[data-download],button[data-source],button[data-show-source],button[data-print]');
  if(!button)return;
  if(button.hasAttribute('data-print')){window.print();return;}
  if(button.dataset.download==='study'){download(JSON.stringify(data,null,2)+'\n','application/json','sediment-study-'+data.id+'.json');return;}
  if(button.dataset.download){const kind=button.dataset.download;download(exportData[kind],'text/csv;charset=utf-8','sediment-'+kind+'-'+data.id.slice(0,12)+'.csv');return;}
  const index=Number(button.dataset.source??button.dataset.showSource),source=data.input.sources[index];if(!source)return;
  if(button.hasAttribute('data-source')){const ext=source.kind==='wqp'?'.csv':source.kind==='usgs-daily'?'.geojson':'.txt',type=source.kind==='wqp'?'text/csv;charset=utf-8':source.kind==='usgs-daily'?'application/geo+json;charset=utf-8':'text/plain;charset=utf-8';download(source.content,type,source.id+'-'+filename(source.label||source.kind)+ext);return;}
  const pre=document.getElementById('source-text-'+index);pre.textContent=source.content;pre.hidden=!pre.hidden;button.setAttribute('aria-expanded',String(!pre.hidden));
 });
}
function embeddedJSON(value){return JSON.stringify(value).replaceAll('<','\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');}
/** Self-contained HTML with complete study, originals, outcomes, charts and lossless numeric CSVs. */
export function sedimentHTML(input){
 const study=checked(input),{pairing,fit,predictions}=study.result,model=fit.model,d=study.input.definition;
 const rows=fit.rows.filter(r=>r.prediction);
 const observed=rows.map(r=>({x:r.observed,y:r.prediction.mean,role:r.role,title:r.id+' · '+r.role+' · observed '+r.observed+' · mean '+r.prediction.mean}));
 const residuals=rows.map(r=>({x:r.prediction.linearPredictor,y:r.residual,role:r.role,title:r.id+' · '+r.role+' · residual '+r.residual}));
 const originalPredictionRows=new Map((predictions?.input?.rows||[]).map(r=>[r.id,r]));
 const deployment=(predictions?.rows||[]).filter(r=>r.prediction).map(r=>{const original=originalPredictionRows.get(r.id),stamp=original?.sampledAt||original?.sampledDate+'T00:00:00Z';return {x:Date.parse(stamp),y:r.prediction.mean,lower:r.prediction.predictionInterval.lower,upper:r.prediction.predictionInterval.upper,role:'validate',title:r.id+' · '+r.status+' · original support '+JSON.stringify(original?.support)+' · mean '+r.prediction.mean};}).filter(p=>finite(p.x));
 const exportData=Object.fromEntries(TYPES.map(k=>[k,sedimentCSV(study,k)]));
 const sourceSections=study.input.sources.map((s,i)=>'<section class="source"><h3>'+esc(s.label||s.kind)+'</h3>'+table(['Identity','Value'],[['Source ID',s.id],['Original text SHA-256',s.sha],['Type',s.kind],['Imported at',s.created_at],['Parsing summary',s.summary]],'Original source')+'<p class="controls"><button type="button" data-source="'+i+'">Download original text</button><button type="button" data-show-source="'+i+'" aria-controls="source-text-'+i+'" aria-expanded="false">Show original text</button></p><pre id="source-text-'+i+'" hidden></pre>'+details('Complete original source, mapping, provider pages and rejected rows',null,['input','sources',i])+'</section>').join('');
 const coefficientTable=table(['Coefficient','Value','Standard error','Lower','Upper'],model.coefficients.map(r=>[r.name,r.value,r.standardError,r.lower,r.upper]),'Coefficients in original transformed predictor units');
 const outcomeTable=table(['Pair','Cohort','Status','Observed mg/L','Mean mg/L','Location mg/L','Individual lower mg/L','Individual upper mg/L','Fitted-scale residual','Leverage','Studentized residual','Cook distance','Selection reason / issues'],fit.rows.map(r=>[r.id,r.role,r.status,r.observed,r.prediction?.mean,r.prediction?.location,r.prediction?.predictionInterval?.lower,r.prediction?.predictionInterval?.upper,r.residual,r.prediction?.leverage,r.studentizedResidual,r.cooksDistance,r.role==='exclude'?{reason:r.reason,issues:r.issues}:r.reason]),'Every fitted or explicitly excluded pair');
 const predictionTable=table(['Original observation','Original date','Original timestamp','Support precision','Status','Mean mg/L','Location mg/L','Individual lower mg/L','Individual upper mg/L','Outside training range / unresolved reasons'],(predictions?.rows||[]).map(r=>{const original=originalPredictionRows.get(r.id);return [r.id,original?.sampledDate,original?.sampledAt,original?.support?.precision,r.status,r.prediction?.mean,r.prediction?.location,r.prediction?.predictionInterval?.lower,r.prediction?.predictionInterval?.upper,{outside:r.outside,reasons:r.reasons}];}),'Every selected deployment observation');
 const guidance=(fit.guidance||[]).map(g=>'<li><strong>'+esc(g.code)+'</strong>: '+esc(g.message)+'</li>').join('');
 const bound=fit.sourceBinding;
 const script='('+downloadCode.toString()+')();';
 const nav=[['model','Model'],['cohorts','Cohorts'],['diagnostics','Diagnostics'],['pairs','Pairs'],['deployment','Predictions'],['sources','Originals'],['complete','Complete study']].map(([id,title])=>'<a href="#'+id+'">'+title+'</a>').join(' ');
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(d.title)+' — Sediment study</title><style>'+
 ':root{color-scheme:light;font:15px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#202020;background:#fff}*{box-sizing:border-box}body{margin:0}main{max-width:1180px;margin:auto;padding:32px 28px 80px}h1{font-size:30px;line-height:1.2;margin:8px 0 16px}h2{font-size:22px;margin:38px 0 14px;padding-top:14px;border-top:2px solid #333}h3{font-size:17px;margin:20px 0 8px}p{max-width:95ch}a{color:#222;text-decoration:underline;overflow-wrap:anywhere}nav{display:flex;flex-wrap:wrap;gap:10px 20px;border-block:1px solid #aaa;padding:14px 0;margin:22px 0}button{font:inherit;color:#222;background:#f5f5f5;border:1px solid #777;border-radius:2px;padding:8px 12px;cursor:pointer}button:hover{background:#e6e6e6}button:focus-visible,a:focus-visible,summary:focus-visible,.table-scroll:focus-visible{outline:3px solid #222;outline-offset:3px}.controls{display:flex;gap:8px;flex-wrap:wrap}.meta{font-size:13px;color:#444;overflow-wrap:anywhere}.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0}.kpis div{border:1px solid #aaa;padding:14px}.kpis strong{font-size:25px;display:block}.kpis span{font-size:13px}code,pre{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #bbb;padding:14px;background:#fafafa;font-size:12px}code{overflow-wrap:anywhere}.equation{font-size:14px}.table-scroll{overflow:auto;max-width:100%;border:1px solid #aaa;margin:14px 0}table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}caption{text-align:left;padding:10px;font-weight:600;background:#f1f1f1}th,td{text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid #ccc;min-width:90px;max-width:360px;overflow-wrap:anywhere}th{background:#f7f7f7}td:first-child{min-width:110px}details{margin:12px 0}summary{cursor:pointer;font-weight:600;padding:7px 0}.plots{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}figure{margin:12px 0;border:1px solid #aaa;padding:12px}figcaption{font-size:13px;font-weight:600;margin-bottom:8px}svg{width:100%;height:auto;display:block}svg text{font:12px system-ui;fill:#333}.grid{stroke:#dedede;stroke-width:1}.reference{stroke:#555;stroke-width:1.25;stroke-dasharray:5 4}.training{fill:#333;stroke:#333;stroke-width:1}.heldout{fill:#fff;stroke:#222;stroke-width:1.5}.interval{stroke:#777;stroke-width:1}li{margin:8px 0}.source{border-top:1px solid #aaa;padding-top:6px}.notice{border-left:3px solid #555;padding:4px 16px;background:#f7f7f7}.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}@media(max-width:720px){main{padding:20px 14px 50px}h1{font-size:25px}.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.plots{grid-template-columns:1fr}button{min-height:44px}th,td{padding:7px}}@media print{main{max-width:none;padding:0;font-size:10pt}nav,.controls{display:none}h2{break-after:avoid}.table-scroll{overflow:visible}th,td{font-size:7pt;min-width:0;max-width:none;padding:3px}.plots{grid-template-columns:1fr}figure{break-inside:avoid}details pre{display:block}button{display:none}}'+
 '</style></head><body><main><header><p class="meta">Ecosystem Sciences · Measurements · Sediment calibration</p><h1>'+esc(d.title)+'</h1><p>'+esc(model.response)+' at '+esc(bound.siteId)+', using '+esc(bound.sensor.id)+' ('+esc(bound.sensor.unit)+'). '+esc(d.note||'')+'</p><p class="meta">Author '+esc(d.actor)+' · Edition time '+esc(d.at)+'<br>Edition <code>'+esc(study.id)+'</code><br>Named study <code>'+esc(study.study_id)+'</code> · Parent <code>'+esc(study.parent_id||'Initial edition')+'</code></p></header><nav aria-label="Report sections">'+nav+'</nav><div class="kpis"><div><strong>'+fit.counts.training+'</strong><span>training pairs</span></div><div><strong>'+fit.counts.validation+'</strong><span>validation pairs</span></div><div><strong>'+fit.counts.excluded+'</strong><span>explicit exclusions</span></div><div><strong>'+study.input.sources.length+'</strong><span>original source files</span></div></div><p class="controls"><button type="button" data-download="study">Complete study JSON</button>'+TYPES.map(k=>'<button type="button" data-download="'+k+'">'+k[0].toUpperCase()+k.slice(1)+' CSV</button>').join('')+'<button type="button" data-print>Print report</button></p><p class="meta">Every selected row and complete original source is retained in this offline report. CSV numeric values preserve full stored precision. Text fields use the Measurements spreadsheet-safe prefix convention; complete JSON retains the original strings.</p><noscript><p>This report includes the complete study as JSON in the study-data element. Download controls and original-text expansion need JavaScript; the scientific tables and figures are already present.</p></noscript>'+
 '<section id="model"><h2>Selected model</h2><pre class="equation">'+esc(equation(model))+'</pre><p>'+esc(model.coefficientBasis||'Original transformed predictor units')+'. '+esc(model.smearingMethod)+'; factor '+cell(model.smearingFactor)+'.</p>'+coefficientTable+table(['Predictor','Source unit','Transform','Training minimum','Training maximum'],model.predictors.map(p=>[p.name,p.unit,p.transform,p.range.min,p.range.max]),'Training support')+'<p>Residual degrees of freedom '+model.df+'; residual standard error '+cell(model.residualStandardError)+' on the fitted response scale; selected interval coverage '+cell(model.confidence)+'.</p><p class="notice">'+esc(fit.uncertainty.interpretation)+' '+esc(fit.uncertainty.logMeanInterval)+'</p>'+details('Numerical solver, coefficients and covariance',model)+'</section>'+
 '<section id="cohorts"><h2>Training and validation</h2><p>'+esc(fit.cohorts.interpretation)+'</p><p><strong>Scientific rationale:</strong> '+esc(fit.input.selection.rationale)+'</p>'+table(['Cohort','Support start','Support end'],[['Training',fit.cohorts.trainingSupport?.start,fit.cohorts.trainingSupport?.end],['Validation',fit.cohorts.validationSupport?.start,fit.cohorts.validationSupport?.end]],'Complete observation support')+stats(fit)+details('Complete cohort separation and repeated-source information',fit.cohorts)+(guidance?'<ul>'+guidance+'</ul>':'')+'</section>'+
 '<section id="diagnostics"><h2>Residuals and uncertainty</h2><p>Filled circles are training observations; open circles are held-out validation observations. The observed-versus-mean reference line is one-to-one. The residual reference line is zero. Points are the complete stored results, with no subsampling.</p><div class="plots">'+plot(observed,{title:'Observed and estimated concentration',xlabel:'Observed '+model.target+' (mg/L)',ylabel:'Estimated mean (mg/L)',diagonal:true})+plot(residuals,{title:'Fitted-scale residuals',xlabel:'Linear predictor ('+model.responseTransform+')',ylabel:'Observed − fitted ('+model.responseTransform+')',zero:true})+'</div>'+details('Complete diagnostics and every flagged original identity',fit.diagnostics)+details('Uncertainty assumptions and components',fit.uncertainty)+outcomeTable+'</section>'+
 '<section id="pairs"><h2>Original paired samples</h2>'+table(['Pair identity','Date','Timestamp','Precision','Declared event','Target','Target mg/L','Turbidity '+bound.sensor.unit,'Discharge m³/s','Cohort','Selection reason','Source issues'],pairedRows(study),'All selected pairs')+details('Complete source pairing, quantities, rejected candidates and interpretation',null,['result','pairing'])+'</section>'+
 '<section id="deployment"><h2>Source-bound predictions</h2>'+(predictions?'<p>'+esc(predictions.extrapolation.interpretation)+'</p><p>Estimates apply at the original selected surrogate observation support. Bars show individual-observation prediction intervals. Each mark remains independent in the plot; no line interpolates between observations. Date-only observations are placed on their calendar date and retain date precision in the table.</p>'+plot(deployment,{title:'Predictions at original observation support',xlabel:'Original observation date',ylabel:model.target+' (mg/L)',dateAxis:true,intervals:true})+predictionTable+details('Complete prediction inputs, outcomes and range decisions',null,['result','predictions']):'<p>No deployment observation population was selected for this edition.</p>')+'</section>'+
 '<section id="sources"><h2>Original source files and scientific context</h2><p>Workspace revision '+study.input.workspace_revision+'. Each original file, mapping, provider response page, parsing rejection and retained review context is included with this edition.</p>'+sourceSections+details('Original observation reviews and selected source versions',null,['input','contexts'])+'</section>'+
 '<section id="complete"><h2>Complete study and methods</h2>'+details('Exact original definition',null,['input','definition'])+'<p>Use Complete study JSON to retain the full edition, including every original source file and scientific outcome. Import a complete study project through Measurements to preserve ancestry, unfinished drafts and request recovery.</p><ul>'+(fit.authority.methodSources||[]).filter(x=>/^https:\/\//.test(x)).map(url=>'<li><a href="'+esc(url)+'" rel="noreferrer">'+esc(url)+'</a></li>').join('')+'</ul><p>'+esc(fit.authority.status)+'</p><p class="meta">Built by TokenJunkieLabs. Original scientific sources and author decisions remain attached.</p></section></main><script type="application/json" id="study-data">'+embeddedJSON(study)+'</script><script type="application/json" id="csv-data">'+embeddedJSON(exportData)+'</script><script>'+script+'</script></body></html>';
}
