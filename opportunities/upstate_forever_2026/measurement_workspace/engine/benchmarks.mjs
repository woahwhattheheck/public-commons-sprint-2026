/** Observed comparisons only. No regulatory criteria, unit conversion or detection substitution. */
import {InputError,day} from './parse.mjs';
const fail=m=>{throw new InputError(m);};
const clone=x=>JSON.parse(JSON.stringify(x));
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const COHORT_FIELDS=['sourceKind','characteristic','parameter','fraction','unit','basis','method'];
export function cohortOf(row){return Object.fromEntries(COHORT_FIELDS.map(k=>[k,row[k]??'']));}
function text(x,label,max=4000){if(typeof x!=='string'||!x.trim()||x.length>max)fail(label+' is required and must fit '+max+' characters');return x;}
function array(x,label,max=100000){if(!Array.isArray(x)||x.length>max)fail('Invalid '+label);return x;}
function unique(x,label){array(x,label);if(!x.length||new Set(x).size!==x.length)fail('Select distinct '+label);return x;}
function decimal(x){
 if(typeof x!=='string'||x.length>200||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d{1,3})?$/i.test(x))fail('Use an explicit finite decimal string');
 const [mantissa,exponent='0']=x.toLowerCase().split('e');let sign=1n,t=mantissa;if(t[0]==='-'){sign=-1n;t=t.slice(1);}else if(t[0]==='+')t=t.slice(1);
 const pieces=t.split('.'),scale=(pieces[1]?.length||0)-Number(exponent);let n=sign*BigInt((pieces[0]||'0')+(pieces[1]||'')),d=1n;
 if(Math.abs(scale)>500)fail('Decimal exponent is outside the supported range');
 if(scale>=0)d=10n**BigInt(scale);else n*=10n**BigInt(-scale);
 return {n,d};
}
export function compareDecimal(a,b){const x=decimal(a),y=decimal(b),v=x.n*y.d-y.n*x.d;return v<0n?-1:v>0n?1:0;}
function finiteString(value){return typeof value==='number'&&Number.isFinite(value)?String(value):null;}
function compareRatio(n,d,limit){const x=decimal(limit),v=BigInt(n)*x.d-x.n*BigInt(d);return v<0n?-1:v>0n?1:0;}
export function validateDefinition(def){
 if(!def||typeof def!=='object'||Array.isArray(def))fail('Choose a complete benchmark definition');
 if(!UUID.test(def.study_id))fail('Use a stable study UUID');
 if(def.parent_id!==null&&!SHA.test(def.parent_id))fail('Choose an original parent study or null');
 text(def.title,'Study title',300);text(def.actor,'Analyst',240);if(typeof def.note!=='string'||def.note.length>8000)fail('Retain the edition note as text');
 text(def.at,'Authored time',80);if(!/^\d{4}-\d{2}-\d{2}T/.test(def.at)||!Number.isFinite(Date.parse(def.at)))fail('Use an explicit authored timestamp');
 if(def.source_basis!==undefined&&def.source_basis!==null){const b=def.source_basis;if(!b||!['study','draft'].includes(b.kind)||(b.kind==='study'?!SHA.test(b.id):!UUID.test(b.id)))fail('Choose an exact retained source basis');}
 const s=def.selection,r=def.rule;if(!s||!r)fail('Complete source selection and benchmark rule are required');
 for(const id of unique(s.source_ids,'original source IDs'))if(!SHA.test(id))fail('Invalid original source ID');
 if(!SHA.test(s.cohort_id))fail('Choose an exact scientific cohort');
 for(const id of unique(s.station_ids,'station IDs'))text(id,'Station',1000);
 day(s.from);day(s.to);if(s.from>s.to)fail('The selected period is reversed');
 if(!['included','not-excluded'].includes(s.review_mode))fail('Select whether to use explicitly included or all nonexcluded native observations');
 if(!s.version_choices||typeof s.version_choices!=='object'||Array.isArray(s.version_choices))fail('Version choices must be an object');
 for(const [key,v]of Object.entries(s.version_choices)){text(key,'Native logical identity',4000);if(!v||!SHA.test(v.record_id))fail('Choose an exact native version');text(v.reason,'Version choice reason',4000);}
 decimal(r.threshold);if(!['gt','gte','lt','lte'].includes(r.operator))fail('Choose gt, gte, lt or lte');
 if(!['sample','month','year','selection'].includes(r.period))fail('Choose sample, month, year or the selected period');
 if(!Number.isSafeInteger(r.minimum_samples)||r.minimum_samples<1||r.minimum_samples>1000000)fail('Declare the minimum number of observed samples');
 if(r.maximum_condition_fraction!==null){decimal(r.maximum_condition_fraction);if(compareDecimal(r.maximum_condition_fraction,'0')<0||compareDecimal(r.maximum_condition_fraction,'1')>0)fail('The maximum observed condition fraction must be between zero and one');}
 for(const key of ['title','reference','section','rationale'])text(r[key],'Rule '+key,8000);
 if(!Object.hasOwn(r,'maximum_condition_fraction'))fail('Use null when no period fraction comparison is intended');
 return clone(def);
}
function rowPeriod(row,selection,period){return period==='sample'?row.logicalKey:period==='month'?row.sampledDate.slice(0,7):period==='year'?row.sampledDate.slice(0,4):selection.from+' / '+selection.to;}
function periodBounds(key,selection,kind){
 if(kind==='selection')return[selection.from,selection.to];
 if(kind==='sample')return[null,null];
 let first,last;
 if(kind==='year'){first=key+'-01-01';last=key+'-12-31';}
 else{first=key+'-01';const y=Number(key.slice(0,4)),m=Number(key.slice(5,7));last=key+'-'+[31,(y%4===0&&(y%100!==0||y%400===0))?29:28,31,30,31,30,31,31,30,31,30,31][m-1];}
 return[first<selection.from?selection.from:first,last>selection.to?selection.to:last];
}
function periods(selection,kind){
 if(kind==='sample')return[];
 if(kind==='selection')return[selection.from+' / '+selection.to];
 const start=selection.from.slice(0,kind==='month'?7:4),end=selection.to.slice(0,kind==='month'?7:4),out=[];
 let key=start;while(key<=end){out.push(key);if(out.length>2400)fail('Select at most 2400 calendar periods');if(key===end)break;
 if(kind==='year')key=String(Number(key)+1).padStart(4,'0');else{const y=Number(key.slice(0,4)),m=Number(key.slice(5,7));key=m===12?String(y+1).padStart(4,'0')+'-01':key.slice(0,4)+'-'+String(m+1).padStart(2,'0');}}
 return out;
}
function classify(row,rule){
 if(row.review?.state!=='include'&&row.issues?.some(x=>['quality-control-sample','derived-source-value','non-water-or-unspecified-medium','review-source-status','qualified-result','negative-concentration'].includes(x)))return{status:'indeterminate',reason:'The original source condition requires an explicit native scientific include review; its value was not silently accepted.'};
 if(row.issues?.some(x=>/detection|limit|conflicting|unknown-censor/.test(x)))return{status:'indeterminate',reason:'Original detection interpretation needs review; no substituted value was used.'};
 if(!['none','left','right'].includes(row.censor))return{status:'indeterminate',reason:'Original censoring direction is not supported.'};
 const point=finiteString(row.value),lower=finiteString(row.lower),upper=finiteString(row.upper);
 if(row.censor==='none'&&point===null)return{status:'indeterminate',reason:'No finite observed result.'};
 if(row.censor!=='none'&&(row.censor==='left'?upper===null:lower===null))return{status:'indeterminate',reason:'The original source has no defensible detection bound.'};
 let lo=row.censor==='none'?point:lower,hi=row.censor==='none'?point:upper;
 if(lo!==null&&hi!==null&&compareDecimal(lo,hi)>0)return{status:'indeterminate',reason:'The original interval is reversed.'};
 // Open bounds are used only when the original parser says that the reported
 // comparator supplied the numeric bound. Typed detection limits stay conservative.
 const literal=String(row.reportedValue??'').trim(),open=!!row.detectionInterpretation?.reportedNumberIsBound&&/^(?:<|>)(?!=)/.test(literal);
 const loOpen=row.censor==='right'&&open,hiOpen=row.censor==='left'&&open;
 const l=lo===null?null:compareDecimal(lo,rule.threshold),h=hi===null?null:compareDecimal(hi,rule.threshold);let yes=false,no=false;
 if(rule.operator==='gt'){yes=l!==null&&(l>0||l===0&&loOpen);no=h!==null&&h<=0;}
 if(rule.operator==='gte'){yes=l!==null&&l>=0;no=h!==null&&(h<0||h===0&&hiOpen);}
 if(rule.operator==='lt'){yes=h!==null&&(h<0||h===0&&hiOpen);no=l!==null&&l>=0;}
 if(rule.operator==='lte'){yes=h!==null&&h<=0;no=l!==null&&(l>0||l===0&&loOpen);}
 return {status:yes?'condition':no?'not-condition':'indeterminate',reason:yes?'The entire supported value or interval satisfies the selected condition.':no?'The entire supported value or interval does not satisfy the selected condition.':'The original detection interval crosses or touches the selected condition boundary.'};
}
export function calculateBenchmark(originalRows,definition){
 const def=validateDefinition(definition),s=def.selection,r=def.rule;
 array(originalRows,'complete original rows');if(originalRows.length>100000)fail('Select at most 100,000 distinct native observations');
 const groups=new Map();for(const row of originalRows){if(!SHA.test(row.id))fail('Missing original measurement identity');const g=groups.get(row.logicalKey)||[];g.push(row);groups.set(row.logicalKey,g);}
 for(const [key,v]of Object.entries(s.version_choices)){const g=groups.get(key);if(!g||!g.some(row=>row.id===v.record_id&&row.selection_match!==false))fail('An explicit version choice is outside this selected original cohort');}
 const rows=originalRows.map(original=>{
  const row=clone(original),g=groups.get(row.logicalKey),chosen=s.version_choices[row.logicalKey],selected=chosen?.record_id||row.selectedVersion;
  const periodAmbiguous=!selected&&new Set(g.map(x=>JSON.stringify([x.stationId,x.sampledDate]))).size>1;
  let comparison;
  if(row.selection_match===false)comparison={status:'excluded',reason:'A retained version of the same original result falls outside the selected cohort, station or date range; it remains visible as conflict context.'};
  else if(row.review?.state==='exclude')comparison={status:'excluded',reason:'The retained native review excludes this observation.'};
  else if(s.review_mode==='included'&&row.review?.state!=='include')comparison={status:'excluded',reason:'The analyst selected explicitly included native observations only.'};
  else if(selected&&selected!==row.id)comparison={status:'excluded',reason:chosen?'The analyst selected another exact source variant: '+chosen.reason:'The retained native source-version review selects another version.'};
  else if(g.length>1&&!selected)comparison={status:'indeterminate',reason:periodAmbiguous?'Conflicting versions give this original result different dates; choose an exact version before assigning it to a period or counting sampling support.':'Conflicting versions of the same native result require an explicit original version choice.'};
  else comparison=classify(row,r);
  return {...row,period_ambiguous:periodAmbiguous,countable:!periodAmbiguous&&row.selection_match!==false,variant_ids:g.map(x=>x.id).sort(),version_choice:chosen||null,...comparison,period:rowPeriod(row,s,r.period)};
 });
 const table=new Map(),get=(station,key,sampleDate=null)=>{
  const id=JSON.stringify([station,key]);if(!table.has(id)){const [start,end]=periodBounds(key,s,r.period);table.set(id,{station_id:station,period:key,start:start||sampleDate,end:end||sampleDate,total_rows:0,selected_samples:0,condition:0,not_condition:0,indeterminate:0,excluded:0,unallocated_samples:0,minimum_samples:r.minimum_samples});}
  return table.get(id);
 };
 const periodKeys=periods(s,r.period);if(s.station_ids.length*Math.max(periodKeys.length,1)>100000)fail('The selected station-period table exceeds 100,000 cells');
 for(const station of s.station_ids)for(const key of periodKeys)get(station,key);
 // Conflicting variants are one uncertain native sample, not multiple independent
 // samples. Full variant rows remain above with their original references.
 const counted=new Set(),unallocated=new Set(),unallocatedPeriods=new Set();
 for(const row of rows){
  if(row.selection_match===false)continue;
  const p=get(row.stationId,row.period,row.sampledDate);p.total_rows++;
  if(row.status==='excluded'){p.excluded++;continue;}
  if(row.period_ambiguous){unallocated.add(row.logicalKey);const key=JSON.stringify([row.stationId,row.period,row.logicalKey]);if(!unallocatedPeriods.has(key)){unallocatedPeriods.add(key);p.unallocated_samples++;}continue;}
  const sampleKey=JSON.stringify([row.stationId,row.period,row.logicalKey]);
  if(counted.has(sampleKey))continue;counted.add(sampleKey);p.selected_samples++;p[row.status==='not-condition'?'not_condition':row.status]++;
 }
 const resultPeriods=[...table.values()].sort((a,b)=>a.station_id.localeCompare(b.station_id)||a.period.localeCompare(b.period)).map(p=>{
  const n=p.selected_samples,min=p.condition,max=p.condition+p.indeterminate;
  const support=n>=r.minimum_samples?'sufficient':'insufficient';
  let status=support==='insufficient'?'insufficient':'observed-counts';
  if(support==='sufficient'&&r.maximum_condition_fraction!==null)status=compareRatio(min,n,r.maximum_condition_fraction)>0?'above-rule':compareRatio(max,n,r.maximum_condition_fraction)<=0?'within-rule':'indeterminate';
  return {...p,condition_count_min:min,condition_count_max:max,condition_fraction_min:n?{numerator:min,denominator:n}:null,condition_fraction_max:n?{numerator:max,denominator:n}:null,support,status};
 });
 const summary={total_rows:rows.length,selected_samples:resultPeriods.reduce((n,p)=>n+p.selected_samples,0),condition:0,not_condition:0,indeterminate:0,excluded:rows.filter(x=>x.status==='excluded').length,unallocated_samples:unallocated.size,period_count:resultPeriods.length,sufficient_periods:resultPeriods.filter(p=>p.support==='sufficient').length};
 for(const key of ['condition','not_condition','indeterminate'])summary[key]=resultPeriods.reduce((n,p)=>n+p[key],0);
 return {rows,periods:resultPeriods,summary,warnings:[
  'Observed source comparison against an analyst-authored rule; this is not an automatic compliance, impairment, safety or regulatory finding.',
  'No threshold, jurisdiction, conversion factor, period sampling requirement or allowable fraction is supplied by this application.',
  'Native normalized values and detection intervals are preserved. Raw values, units, qualifiers, exact source rows and conflicting variants remain attached.',
  'An unresolved result whose source versions disagree on its date contributes no sample to period support until an exact version is selected. All alternate rows, including versions outside the selected date/cohort filter, remain attached.',
  'Counts describe distinct native sample identities in the selected sources. Replicate results with different native identities remain separate; identical retained rows with multiple provenance links are counted once.',
  'Minimum samples counts observed sample identities, including indeterminate results. It establishes neither sampling representativeness nor observations on unsampled days.',
  'No arithmetic or geometric mean, nondetect substitution, flow weighting or automated unit conversion is performed.'
 ]};
}
