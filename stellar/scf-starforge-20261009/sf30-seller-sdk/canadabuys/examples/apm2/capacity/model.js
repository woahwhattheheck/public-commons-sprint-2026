/* MIT. Offline observability capacity model. All byte units are decimal. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.CapacityModel=api;})(typeof globalThis==='object'?globalThis:this,function(){
'use strict';
const SCHEMA='tjlabs.apm2.capacity.v1', DAY=86400, GB=1e9;
const SOURCES=[
 {id:'otel-scaling',title:'OpenTelemetry Collector scaling',url:'https://opentelemetry.io/docs/collector/scaling/'},
 {id:'dynatrace-scaling',title:'Dynatrace Collector scaling',url:'https://docs.dynatrace.com/docs/ingest-from/opentelemetry/collector/scaling'},
 {id:'dynatrace-otlp',title:'Dynatrace OTLP ingestion',url:'https://docs.dynatrace.com/docs/ingest-from/opentelemetry/otlp-api'},
 {id:'procurement',title:'CanadaBuys source dictionary and support',url:'https://donnees-data.tpsgc-pwgsc.gc.ca/ba2/ac-cb/soutien-support-eng.html'}
];
const f=(key,label,unit,min=0,max=null,positive=false)=>({key,label,unit,min,max,positive});
const COMMON=[
 f('bytesPerItem','Mean exported size','bytes/item'),
 f('averageRetainedFraction','Average retained fraction','0–1',0,1),
 f('peakRetainedFraction','Peak retained fraction','0–1',0,1),
 f('transportFactor','Measured wire / exported byte ratio','ratio'),
 f('storageFactor','Measured stored / ingested byte ratio','ratio'),
 f('retentionDays','Retention','days'),
 f('bufferSeconds','Planned outage','seconds'),
 f('bufferFactor','Measured queue / exported byte ratio','ratio')
];
const SIGNALS={
 traces:{name:'Traces',item:'span',fields:[f('averageRate','Average requests','requests/s'),f('peakRate','Peak requests','requests/s'),f('spansPerRequest','Mean spans per request','spans/request'),...COMMON]},
 metrics:{name:'Metrics',item:'observation',fields:[f('averageSeries','Average active series','series'),f('peakSeries','Peak active series','series'),f('intervalSeconds','Collection interval','seconds',0,null,true),...COMMON]},
 logs:{name:'Logs',item:'event',fields:[f('averageRate','Average events','events/s'),f('peakRate','Peak events','events/s'),...COMMON]}
};
const COST_PERIODS=['one-time','month','year','day','hour'], CATEGORIES=['platform','infrastructure','support','engineering','other'];
const clone=x=>JSON.parse(JSON.stringify(x));
const id=()=> 's-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);
function blankScenario(name='Scenario 1'){
 return {id:id(),name,owner:'',description:'',measurementWindow:'',pipeline:'',currency:'CAD',
 horizonMonths:null,daysPerMonth:null,hoursPerMonth:null,signals:Object.fromEntries(Object.entries(SIGNALS).map(([key,def])=>[key,{included:true,policy:'',values:Object.fromEntries(def.fields.map(x=>[x.key,null])),evidence:Object.fromEntries(def.fields.map(x=>[x.key,{basis:'unrecorded',source:'',observedAt:''}]))}])),costs:[],sizing:{configuration:'',workload:'',observations:'',decision:''}};
}
function blankProject(){const s=blankScenario();return {schema:SCHEMA,title:'APM2 capacity plan',noticeReference:'BPM026762/35133',updatedAt:new Date().toISOString(),selectedId:s.id,scenarios:[s]};}
function fault(path,message){return {path,message};}
function validateProject(p){
 const errors=[]; const bad=(path,m)=>errors.push(fault(path,m));
 const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const text=(x,path,max=10000)=>{if(typeof x!=='string'||x.length>max)bad(path,'Expected text, at most '+max+' characters');};
 const num=(x,path,def={})=>{if(x===null)return;if(typeof x!=='number'||!Number.isFinite(x)||x<0||(def.positive&&x<=0)||(def.max!==null&&def.max!==undefined&&x>def.max))bad(path,'Expected a finite '+(def.positive?'positive':'nonnegative')+' number'+(def.max!=null?' ≤ '+def.max:'' )+' or null');};
 if(!obj(p))return[fault('project','Expected a JSON object')];
 if(p.schema!==SCHEMA)bad('schema','Unsupported project schema');
 for(const k of ['title','noticeReference','updatedAt','selectedId'])text(p[k],k,500);
 if(!Array.isArray(p.scenarios)||p.scenarios.length<1||p.scenarios.length>100)return [...errors,fault('scenarios','Expected 1–100 scenarios')];
 const ids=new Set();
 p.scenarios.forEach((s,i)=>{
  const b='scenarios['+i+']';if(!obj(s)){bad(b,'Expected scenario');return;}
  for(const k of ['id','name','owner','description','measurementWindow','pipeline','currency'])text(s[k],b+'.'+k);
  if(typeof s.id==='string'&&(!/^[A-Za-z0-9_-]{1,100}$/.test(s.id)||ids.has(s.id)))bad(b+'.id','Invalid or duplicate scenario ID');ids.add(s.id);
  if(typeof s.currency!=='string'||!/^[A-Z]{3}$/.test(s.currency))bad(b+'.currency','Use a three-letter uppercase currency');
  num(s.horizonMonths,b+'.horizonMonths',{positive:true});num(s.daysPerMonth,b+'.daysPerMonth',{max:31});num(s.hoursPerMonth,b+'.hoursPerMonth',{max:744});
  if(!obj(s.signals)){bad(b+'.signals','Expected all three signals');return;}
  for(const [key,def] of Object.entries(SIGNALS)){
   const q=s.signals[key],a=b+'.signals.'+key;if(!obj(q)){bad(a,'Missing signal');continue;}
   if(typeof q.included!=='boolean')bad(a+'.included','Expected explicit true/false');text(q.policy,a+'.policy');
   if(!obj(q.values)||!obj(q.evidence)){bad(a,'Missing values or evidence');continue;}
   for(const d of def.fields){num(q.values[d.key],a+'.'+d.key,d);const e=q.evidence[d.key];if(!obj(e)){bad(a+'.evidence.'+d.key,'Missing input provenance');continue;}
    if(!['unrecorded','measured','assumption','supplier'].includes(e.basis))bad(a+'.evidence.'+d.key,'Invalid provenance basis');
    text(e.source,a+'.evidence.'+d.key+'.source');text(e.observedAt,a+'.evidence.'+d.key+'.observedAt',200);
   }
  }
  if(!Array.isArray(s.costs)||s.costs.length>1000)bad(b+'.costs','Expected at most 1,000 cost lines');
  else {const cids=new Set();s.costs.forEach((c,j)=>{const a=b+'.costs['+j+']';if(!obj(c)){bad(a,'Expected cost line');return;}
    for(const k of ['id','label','currency','source','notes'])text(c[k],a+'.'+k);
    if(cids.has(c.id))bad(a+'.id','Duplicate cost ID');cids.add(c.id);
    if(!CATEGORIES.includes(c.category))bad(a+'.category','Unknown category');if(!COST_PERIODS.includes(c.period))bad(a+'.period','Unknown cost period');
    if(!/^[A-Z]{3}$/.test(c.currency))bad(a+'.currency','Use a three-letter uppercase currency');
    if(c.amount!==null&&(typeof c.amount!=='string'||!/^(0|[1-9]\d{0,14})(\.\d{1,6})?$/.test(c.amount)))bad(a+'.amount','Enter a nonnegative decimal amount, up to six decimal places, or null');
   });}
  if(!obj(s.sizing))bad(b+'.sizing','Missing collector measurement record');else for(const k of ['configuration','workload','observations','decision'])text(s.sizing[k],b+'.sizing.'+k);
 });
 if(!ids.has(p.selectedId))bad('selectedId','Selected scenario is absent');
 return errors;
}
function parseProject(text){if(typeof text!=='string'||text.length>12000000)throw Error('Project exceeds the 12 MB text limit');let p;try{p=JSON.parse(text);}catch{throw Error('Select a complete JSON project');}const errors=validateProject(p);if(errors.length){const e=Error(errors.slice(0,8).map(x=>x.path+': '+x.message).join('\n'));e.details=errors;throw e;}return p;}
function serializeProject(p){const e=validateProject(p);if(e.length)throw Error(e[0].path+': '+e[0].message);return JSON.stringify(p,null,2)+'\n';}
function calculateSignal(key,q){
 const def=SIGNALS[key],v=q.values,warnings=[];
 if(!q.included)return {included:false,outputs:{},warnings:[],inputGaps:[],provenanceGaps:[]};
 const fieldErrors=new Set(def.fields.filter(d=>v[d.key]!==null&&(typeof v[d.key]!=='number'||!Number.isFinite(v[d.key])||v[d.key]<0||(d.positive&&v[d.key]<=0)||(d.max!=null&&v[d.key]>d.max))).map(x=>x.key));
 const raw=(keys,fn)=>{const missing=keys.filter(k=>v[k]===null||v[k]===undefined||fieldErrors.has(k));if(missing.length)return {value:null,missing};const n=fn();return Number.isFinite(n)?{value:n,missing:[]}:{value:null,missing:['numeric-overflow']};};
 const calc=(items,fn)=>{const missing=[...new Set(items.flatMap(x=>x.missing))];if(missing.length)return {value:null,missing};const n=fn(...items.map(x=>x.value));return Number.isFinite(n)?{value:n,missing:[]}:{value:null,missing:['numeric-overflow']};};
 const variable=k=>raw([k],()=>v[k]);
 let averageItems,peakItems;
 if(key==='traces'){averageItems=raw(['averageRate','spansPerRequest'],()=>v.averageRate*v.spansPerRequest);peakItems=raw(['peakRate','spansPerRequest'],()=>v.peakRate*v.spansPerRequest);}
 else if(key==='metrics'){averageItems=raw(['averageSeries','intervalSeconds'],()=>v.averageSeries/v.intervalSeconds);peakItems=raw(['peakSeries','intervalSeconds'],()=>v.peakSeries/v.intervalSeconds);}
 else {averageItems=variable('averageRate');peakItems=variable('peakRate');}
 const averageRetained=calc([averageItems,variable('averageRetainedFraction')],(a,b)=>a*b);
 const peakRetained=calc([peakItems,variable('peakRetainedFraction')],(a,b)=>a*b);
 const averageBytes=calc([averageRetained,variable('bytesPerItem')],(a,b)=>a*b),peakBytes=calc([peakRetained,variable('bytesPerItem')],(a,b)=>a*b);
 const outputs={
  generatedItemsDay:calc([averageItems],x=>x*DAY),
  retainedItemsDay:calc([averageRetained],x=>x*DAY),
  ingestedGBDay:calc([averageBytes],x=>x*DAY/GB),
  peakIngestedMBSecond:calc([peakBytes],x=>x/1e6),
  transferGBDay:calc([averageBytes,variable('transportFactor')],(a,b)=>a*b*DAY/GB),
  peakMegabitsSecond:calc([peakBytes,variable('transportFactor')],(a,b)=>a*b*8/1e6),
  retainedStorageGB:calc([averageBytes,variable('retentionDays'),variable('storageFactor')],(a,b,c)=>a*DAY*b*c/GB),
  outageBufferGB:calc([peakBytes,variable('bufferSeconds'),variable('bufferFactor')],(a,b,c)=>a*b*c/GB)
 };
 if(peakItems.value!==null&&averageItems.value!==null&&peakItems.value<averageItems.value)warnings.push('Peak generated rate is below average; check the measurement windows.');
 if(peakBytes.value!==null&&averageBytes.value!==null&&peakBytes.value<averageBytes.value)warnings.push('Peak exported bytes/s is below average after retained fractions.');
 if(key==='metrics'&&v.averageRetainedFraction!==null&&v.averageRetainedFraction<1)warnings.push('Metric filtering is represented as an observation fraction. Record its actual aggregation/cardinality effects in the policy.');
 const inputGaps=def.fields.filter(d=>v[d.key]===null).map(d=>d.key);
 const provenanceGaps=def.fields.filter(d=>v[d.key]!==null&&(!q.evidence[d.key]?.source||q.evidence[d.key]?.basis==='unrecorded')).map(d=>d.key);
 return {included:true,outputs,warnings,inputGaps,provenanceGaps};
}
const SCALE=1000000n;
function moneyUnits(s){if(s===null)return null;const[a,b='']=s.split('.');return BigInt(a)*SCALE+BigInt(b.padEnd(6,'0'));}
function unitsText(n){const whole=n/SCALE,part=(n%SCALE).toString().padStart(6,'0').replace(/0+$/,'');return whole.toString()+(part?'.'+part:'');}
function calculateCosts(s){
 const groups=new Map(),missing=[],foreign=[];
 for(const c of s.costs){const key=c.currency+'|'+c.period;if(!groups.has(key))groups.set(key,{currency:c.currency,period:c.period,total:0n,missing:[],lines:0});
  const g=groups.get(key);g.lines++;if(c.amount===null){g.missing.push(c.id);missing.push(c.id);}else g.total+=moneyUnits(c.amount);if(c.currency!==s.currency)foreign.push(c.id);
 }
 const nativeTotals=[...groups.values()].map(g=>({...g,total:undefined,enteredSubtotal:unitsText(g.total),completeTotal:g.missing.length?null:unitsText(g.total)}));
 let monthly=0,oneTime=0;const recurringMissing=[],oneTimeMissing=[],selected=s.costs.filter(c=>c.currency===s.currency);
 for(const c of selected){const missing=c.period==='one-time'?oneTimeMissing:recurringMissing;
  if(c.amount===null){missing.push(c.id+':amount');continue;}const n=Number(c.amount);
  if(c.period==='one-time')oneTime+=n;
  else if(c.period==='month')monthly+=n;else if(c.period==='year')monthly+=n/12;
  else if(c.period==='hour'){if(s.hoursPerMonth===null)recurringMissing.push(c.id+':hoursPerMonth');else monthly+=n*s.hoursPerMonth;}
  else if(s.daysPerMonth===null)recurringMissing.push(c.id+':daysPerMonth');else monthly+=n*s.daysPerMonth;
 }
 if(!selected.length){recurringMissing.push('selected-currency cost lines');oneTimeMissing.push('selected-currency cost lines');}
 if(!Number.isFinite(monthly))recurringMissing.push('numeric-overflow');
 if(!Number.isFinite(oneTime))oneTimeMissing.push('numeric-overflow');
 const projectionMissing=[...new Set([...recurringMissing,...oneTimeMissing])],horizonMissing=[...projectionMissing];
 if(s.horizonMonths===null)horizonMissing.push('horizonMonths');
 const horizon=oneTime+monthly*(s.horizonMonths??0);
 if(!Number.isFinite(horizon))horizonMissing.push('numeric-overflow');
 const finite=x=>Number.isFinite(x)?x:null;
 return {nativeTotals,missing,foreign,projection:{currency:s.currency,monthlyEquivalent:recurringMissing.length?null:finite(monthly),oneTimeEntered:finite(oneTime),oneTimeComplete:oneTimeMissing.length?null:finite(oneTime),horizonTotal:horizonMissing.length?null:horizon,missing:projectionMissing,recurringMissing,oneTimeMissing,horizonMissing,excludedCurrencyLines:foreign.length,approximate:true}};
}
const OUTPUTS=[
 ['generatedItemsDay','Generated items/day','items/day'],['retainedItemsDay','Retained items/day','items/day'],
 ['ingestedGBDay','Ingested after filtering','GB/day'],['peakIngestedMBSecond','Peak ingest','MB/s'],
 ['transferGBDay','Wire transfer','GB/day'],['peakMegabitsSecond','Peak wire bandwidth','Mbit/s'],
 ['retainedStorageGB','Steady-state retained storage','GB'],['outageBufferGB','Outage queue storage','GB']
];
function calculateScenario(s){const signals=Object.fromEntries(Object.keys(SIGNALS).map(k=>[k,calculateSignal(k,s.signals[k])]));const totals={};
 for(const[key]of OUTPUTS.filter(x=>!['generatedItemsDay','retainedItemsDay'].includes(x[0]))){const rows=Object.entries(signals).filter(([,x])=>x.included);const missing=rows.filter(([,x])=>x.outputs[key].value===null).map(([k])=>k);const subtotal=rows.reduce((a,[,x])=>a+(x.outputs[key].value??0),0);if(!Number.isFinite(subtotal))missing.push('numeric-overflow');totals[key]={value:rows.length&&!missing.length?subtotal:null,enteredSubtotal:Number.isFinite(subtotal)?subtotal:null,missing,includedSignals:rows.length};}
 return {signals,totals,costs:calculateCosts(s)};
}
function format(n){return n===null||n===undefined?'Missing inputs':new Intl.NumberFormat('en',{maximumSignificantDigits:10}).format(n);}
function escapeHTML(s){return String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));}
function reportHTML(project){
 const p=parseProject(serializeProject(project)),e=escapeHTML;
 const table=(heads,rows)=>'<table><thead><tr>'+heads.map(x=>'<th>'+e(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(x=>'<td>'+e(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
 let body='<h1>'+e(p.title)+'</h1><p>Reference '+e(p.noticeReference)+' · Saved '+e(p.updatedAt)+'</p><p>Decimal units: 1 GB = 1,000,000,000 bytes. Average rates cover all 86,400 seconds of the planning day. Empty inputs remain missing. Exact entered money totals retain six decimal places; normalized forecasts use floating-point estimates.</p>';
 for(const s of p.scenarios){const r=calculateScenario(s);body+='<section><h2>'+e(s.name)+'</h2><p>'+e(s.description)+'</p><p>Owner: '+e(s.owner)+' · Measurement window: '+e(s.measurementWindow)+' · Pipeline: '+e(s.pipeline)+'</p>';
  body+='<h3>Capacity totals</h3>'+table(['Output','Total','Available subtotal','Incomplete signals'],OUTPUTS.filter(x=>r.totals[x[0]]).map(([k,label,unit])=>[label,format(r.totals[k].value)+' '+unit,format(r.totals[k].enteredSubtotal)+' '+unit,r.totals[k].missing.join(', ')]));
  for(const[k,d]of Object.entries(SIGNALS)){const q=s.signals[k],z=r.signals[k];body+='<h3>'+e(d.name)+(q.included?'':' — excluded')+'</h3><p>'+e(q.policy)+'</p>';
   body+=table(['Input','Value','Unit','Basis','Source / date'],d.fields.map(f=>[f.label,q.values[f.key]===null?'Missing':String(q.values[f.key]),f.unit,q.evidence[f.key].basis,q.evidence[f.key].source+' '+q.evidence[f.key].observedAt]));
   if(q.included)body+=table(['Result','Value','Missing inputs'],OUTPUTS.map(([x,l,u])=>[l,format(z.outputs[x].value)+' '+u,z.outputs[x].missing.join(', ')]))+'<p>'+e(z.warnings.join(' '))+'</p>';
  }
  body+='<h3>Entered costs</h3>'+table(['Category','Description','Amount','Currency','Period','Source','Notes'],s.costs.map(c=>[c.category,c.label,c.amount??'Missing',c.currency,c.period,c.source,c.notes]));
  body+=table(['Currency','Period','Entered subtotal','Complete total','Missing lines'],r.costs.nativeTotals.map(g=>[g.currency,g.period,g.enteredSubtotal,g.completeTotal??'Missing',g.missing.length]));
  const c=r.costs.projection;body+='<p>Forecast currency '+e(s.currency)+'; horizon '+e(s.horizonMonths??'Missing')+' months; explicit billable days/month '+e(s.daysPerMonth??'Missing')+'; explicit billable hours/month '+e(s.hoursPerMonth??'Missing')+'. Monthly equivalent '+e(format(c.monthlyEquivalent))+'; one-time entered '+e(format(c.oneTimeEntered))+'; horizon estimate '+e(format(c.horizonTotal))+'. Other-currency lines excluded: '+c.excludedCurrencyLines+'. Missing: '+e(c.horizonMissing.join(', '))+'.</p>';
  body+='<h3>Collector measurement and decision</h3>'+table(['Record','Content'],Object.entries(s.sizing))+'</section>';
 }
 body+='<h2>Method and primary references</h2><p>Generated trace rate = requests/s × spans/request. Generated metric rate = active series / interval seconds. Log rate = events/s. Each signal is multiplied by its own retained fraction and bytes/item. Daily ingest uses average rate × 86,400. Wire transfer uses the measured transport factor. Retained storage uses ingest/day × retention days × measured storage factor. Queue capacity uses peak exported bytes/s × outage seconds × measured queue factor. These are planning quantities; selected pipeline measurements determine CPU, memory, distribution and resilience.</p><ul>'+SOURCES.map(s=>'<li><a href="'+e(s.url)+'">'+e(s.title)+'</a></li>').join('')+'</ul>';
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+e(p.title)+'</title><style>body{font:15px/1.5 system-ui;max-width:1200px;margin:32px auto;padding:0 24px;color:#171717}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #aaa;padding:7px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}section{border-top:3px solid #333;margin-top:32px}p{white-space:pre-wrap}@media print{body{font-size:10pt;margin:0}tr{break-inside:avoid}h2,h3{break-after:avoid}}</style><body>'+body+'</body></html>';
}
return {SCHEMA,SOURCES,SIGNALS,OUTPUTS,COST_PERIODS,CATEGORIES,blankScenario,blankProject,validateProject,parseProject,serializeProject,calculateSignal,calculateScenario,calculateCosts,format,escapeHTML,reportHTML,clone,id};
});
