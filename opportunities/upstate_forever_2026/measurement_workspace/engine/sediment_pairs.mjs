/**
 * Explicit source-bound observation interpretation and pairing for the original
 * Measurements workspace. No store, provider, source-normalizer or fitting code.
 * Full originals and native review/version context remain in sourceRecords.
 */
import {InputError} from './parse.mjs';
import {hash,stable} from './normalise.mjs';

export const SEDIMENT_PAIRING_VERSION='upstate.sediment-pairing/v1';
export const SEDIMENT_LIMITS=Object.freeze({records:100000,observations:200000,candidates:250000,comparisons:2000000,bytes:128*1024*1024});
const SHA=/^[a-f0-9]{64}$/;
const fields=['value','unit','siteId','method','sensorId','analyte','sampledDate','sampledAt','timeZone','eventId','censor','qualifier','detection'];
const requiredFields=['value','unit','siteId','method','sampledDate'];
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const cp=v=>JSON.parse(JSON.stringify(v));
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const need=(v,m,status=400)=>{if(!v)throw new InputError(m,status);};
const unique=v=>[...new Set(v)];
const scalar=v=>v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)&&(!Number.isInteger(v)||Number.isSafeInteger(v));
function shape(v,keys,label){need(obj(v),label+' must be an object');need(Object.keys(v).every(k=>keys.includes(k)),label+' has an unknown field');}
function text(v,label,max=4000,empty=false){need(typeof v==='string'&&v.length<=max&&(empty||v.trim().length>0),label+' must be '+(empty?'':'nonempty ')+'text up to '+max+' characters');return v;}
function list(v,label,max=SEDIMENT_LIMITS.records){need(Array.isArray(v)&&v.length<=max,label+' must be a complete bounded array');return v;}
function ids(v,label,{empty=false}={}){list(v,label);need(empty||v.length>0,label+' must select at least one original identity');need(v.every(x=>typeof x==='string'&&SHA.test(x))&&new Set(v).size===v.length,label+' must contain distinct SHA256 identities');return v;}
function bounded(v,label){const raw=stable(v);need(new TextEncoder().encode(raw).length<=SEDIMENT_LIMITS.bytes,label+' exceeds the complete 128 MiB capacity; select an explicit smaller source cohort',413);return v;}
function finish(v){bounded(v,'Complete sediment result');return {id:hash(stable(v)),...v};}
function pointer(path){text(path,'JSON pointer',2000,true);need(path===''||path.startsWith('/'),'Use an RFC6901 JSON pointer');need(!/~(?![01])/.test(path),'Invalid JSON pointer escape');return path===''?[]:path.slice(1).split('/').map(x=>x.replace(/~1/g,'/').replace(/~0/g,'~'));}
function atPath(row,path){let value=row;for(const key of pointer(path)){if(value===null||typeof value!=='object'||!own(value,key))return {present:false,value:null};value=value[key];}return {present:true,value};}
function binding(v,label,nullable=false){if(v===null&&nullable)return;shape(v,['path','constant','reason'],label);if(own(v,'path')){need(Object.keys(v).length===1,label+' pointer cannot also contain a constant');pointer(v.path);}else{need(Object.keys(v).length===2&&own(v,'constant')&&own(v,'reason'),label+' must be a pointer or an attributed constant');text(v.constant,label+' constant',4000,true);text(v.reason,label+' constant source rationale');}}
function field(row,b){if(b===null||b===undefined)return {present:false,value:null,binding:null};return own(b,'path')?{...atPath(row,b.path),binding:cp(b)}:{present:true,value:b.constant,binding:cp(b)};}
const string=v=>v===null||v===undefined?'':String(v).trim();
function calendar(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;const n=Date.parse(value+'T00:00:00Z');return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===value?value:null;}
function offset(value){const z=string(value);if(z==='Z'||/^(UTC|GMT)$/i.test(z))return '+00:00';const m=/^([+-])(\d{2}):(\d{2})$/.exec(z);return m&&+m[2]<=14&&+m[3]<60&&(+m[2]!==14||+m[3]===0)?z:null;}
function instant(value,zone){
 const s=string(value),m=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(s);
 if(!m||!calendar(m[1])||+m[2]>23||+m[3]>59||+(m[4]||0)>59)return null;
 const z=m[6]||offset(zone);if(!z||!offset(z))return null;
 const n=Date.parse(s+(m[6]?'':z));if(!Number.isFinite(n))return null;
 // Millisecond runtime: submillisecond source time is bounded outward, not
 // silently declared an exact instant. Original lexeme remains in time.raw.
 const fraction=m[5]?.slice(1)||'';const beyond=fraction.length>3&&/[1-9]/.test(fraction.slice(3));
 return {start:new Date(n).toISOString(),end:new Date(n+(beyond?1:0)).toISOString(),precision:beyond?'interval':'instant',epoch:n};
}
function timeSupport(values,{canonical=false}={}){
 const d=calendar(string(values.sampledDate.value)),raw=string(values.sampledAt.value),z=string(values.timeZone.value),issues=[],warnings=[];
 const t=raw?instant(raw,z):null;
 if(raw&&!t)issues.push('unresolved-or-invalid-sampling-time');
 if(!d)issues.push('missing-or-invalid-sampling-date');
 if(t){const rawDate=raw.slice(0,10);if(d&&rawDate!==d&&!canonical)issues.push('sampling-date-time-conflict');return {sampledDate:d||rawDate,sampledAt:t.precision==='instant'?t.start:null,support:{start:t.start,end:t.end,precision:t.precision},issues,warnings,raw:{date:values.sampledDate,time:values.sampledAt,zone:values.timeZone}};}
 if(!d)return {sampledDate:null,sampledAt:null,support:null,issues,warnings,raw:{date:values.sampledDate,time:values.sampledAt,zone:values.timeZone}};
 const zone=offset(z);
 if(!zone)warnings.push('date-support-has-unknown-time-zone');
 if(z&&!zone)warnings.push('named-or-ambiguous-time-zone-not-inferred');
 return {sampledDate:d,sampledAt:null,support:{start:d,end:d,precision:'date'},issues,warnings,raw:{date:values.sampledDate,time:values.sampledAt,zone:values.timeZone}};
}
function channel(v,role,sourceIds){
 shape(v,['sourceIds','recordIds','filters','fields','rationale'],role+' channel');
 ids(v.sourceIds,role+' channel sources');need(v.sourceIds.every(id=>sourceIds.includes(id)),'Channel source is outside selected original sources');
 if(v.recordIds!==null)ids(v.recordIds,role+' record IDs',{empty:true});
 list(v.filters,role+' filters',100);for(const f of v.filters){shape(f,['path','equals'],'Filter');need(own(f,'path')&&own(f,'equals')&&scalar(f.equals),'Filter requires an exact scalar value');pointer(f.path);}
 shape(v.fields,fields,role+' fields');for(const k of requiredFields)need(own(v.fields,k),role+' requires '+k+' binding');
 for(const k of fields){if(own(v.fields,k))binding(v.fields[k],role+'.'+k,!requiredFields.includes(k));}
 if(role==='sediment')need(v.fields.analyte!==null&&v.fields.analyte!==undefined,'Sediment channel must explicitly bind SSC or TSS analyte');
 if(role==='turbidity')need(v.fields.sensorId!==null&&v.fields.sensorId!==undefined,'Turbidity channel must explicitly bind original sensor identity');
 text(v.rationale,role+' channel rationale');
}
function rule(v){shape(v,['mode','maxDeltaSeconds','allowDateOnlySameEvent','eventMeaning'],'Pairing rule');if(v.eventMeaning!==undefined)need(['sample','hydrologic-event','unknown'].includes(v.eventMeaning),'Declare sample versus hydrologic-event grouping');need(['same-event','time-window','explicit'].includes(v.mode),'Choose an explicit pairing mode');need(v.maxDeltaSeconds===null||typeof v.maxDeltaSeconds==='number'&&Number.isFinite(v.maxDeltaSeconds)&&v.maxDeltaSeconds>=0&&v.maxDeltaSeconds<=31*86400,'Pairing tolerance must be null or 0..31 days in seconds');need(typeof v.allowDateOnlySameEvent==='boolean','Select whether dated same-event support is permitted');if(v.mode==='time-window')need(v.maxDeltaSeconds!==null,'Time-window pairing requires an actual tolerance');}
function dates(v){need(v.from===null||calendar(v.from),'from must be an ISO date or null');need(v.to===null||calendar(v.to),'to must be an ISO date or null');need(!v.from||!v.to||v.from<=v.to,'Date selection is reversed');}
function sensor(v){shape(v,['id','unit','method'],'Sensor');text(v.id,'Sensor ID',4000);need(['FNU','NTU'].includes(v.unit),'Sensor unit must be explicit FNU or NTU');text(v.method,'Sensor method',4000);}
function selection(v){
 shape(v,['schema','source_ids','siteId','sensor','target','from','to','channels','pairing','choices','rationale'],'Sediment selection');need(v.schema==='upstate.sediment-selection/v1','Unknown sediment selection schema');ids(v.source_ids,'Selected sources');text(v.siteId,'Site ID');sensor(v.sensor);need(['SSC','TSS'].includes(v.target),'Target must remain explicit SSC or TSS');dates(v);text(v.rationale,'Study source rationale');rule(v.pairing);
 shape(v.channels,['sediment','turbidity','discharge'],'Channels');channel(v.channels.sediment,'sediment',v.source_ids);channel(v.channels.turbidity,'turbidity',v.source_ids);if(v.channels.discharge!==null)channel(v.channels.discharge,'discharge',v.source_ids);
 list(v.choices,'Pair choices');const seen=new Set();for(const x of v.choices){shape(x,['sampleId','action','turbidityId','dischargeId','reason'],'Pair choice');need(SHA.test(x.sampleId)&&!seen.has(x.sampleId),'Choose each original sample once');seen.add(x.sampleId);need(['select','exclude'].includes(x.action),'Unknown pair action');need(x.turbidityId===null||SHA.test(x.turbidityId),'Invalid selected turbidity identity');need(x.dischargeId===null||SHA.test(x.dischargeId),'Invalid selected discharge identity');text(x.reason,'Pair choice reason');if(x.action==='select')need(x.turbidityId!==null,'A selected pair requires an original turbidity observation');else need(x.turbidityId===null&&x.dischargeId===null,'An excluded sample must not pretend to select predictor observations');}
 bounded(v,'Sediment selection');return cp(v);
}
function rowsInput(rows){
 list(rows,'Complete original records');const seen=new Set();
 for(const row of rows){need(obj(row)&&SHA.test(row.id)&&!seen.has(row.id),'Canonical records must have distinct original SHA IDs');seen.add(row.id);need(obj(row.raw),'Complete original raw source row is required');need(Array.isArray(row.sources),'Complete original source references are required');for(const s of row.sources)need(obj(s)&&SHA.test(s.id)&&SHA.test(s.sha)&&Number.isSafeInteger(s.source_line)&&s.source_line>=1,'Original file identity and physical source line are required');need(obj(row.review)&&['pending','include','exclude'].includes(row.review.state),'Original native review state is required');need(Array.isArray(row.variants)&&row.variants.includes(row.id)&&row.variants.every(x=>SHA.test(x)),'Complete original version identities are required');need(row.selectedVersion===null||typeof row.selectedVersion==='string'&&row.variants.includes(row.selectedVersion),'Original selected version must belong to these variants');}
 bounded(rows,'Complete selected source records');return cp(rows);
}
function decimal(value){
 const raw=string(value),m=/^([<>]=?|≤|≥)?\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i.exec(raw);
 if(!m)return {value:null,raw,censor:'unknown',issues:['missing-or-nonnumeric-result']};
 const n=Number(m[2]),nonzero=/[1-9]/.test(m[2].split(/[eE]/)[0]),issues=[];
 if(!Number.isFinite(n)||n===0&&nonzero)issues.push('numeric-range-not-representable');
 if(typeof value==='number'&&Number.isInteger(value)&&!Number.isSafeInteger(value))issues.push('unsafe-original-json-number');
 return {value:issues.length?null:n,raw,censor:m[1]?(m[1][0]==='<'||m[1]==='≤'?'left':'right'):'none',issues};
}
function unit(raw,role,expected){
 const s=string(raw),u=s.toLowerCase().replace(/[µμ]/g,'u').replace(/³/g,'3').replace(/\s+/g,'');
 if(role==='sediment'){const m=/^(mg|ug|g)\/l$/.exec(u);return m?{source:s,unit:'mg/L',factor:{mg:1,ug:.001,g:1000}[m[1]],compatible:true}:{source:s,unit:s,factor:null,compatible:false};}
 if(role==='turbidity')return {source:s,unit:s.toUpperCase(),factor:1,compatible:s.toUpperCase()===expected};
 const factors={'m3/s':1,'m^3/s':1,cms:1,'ft3/s':.028316846592,'ft^3/s':.028316846592,cfs:.028316846592};
 return own(factors,u)?{source:s,unit:'m3/s',factor:factors[u],compatible:true}:{source:s,unit:s,factor:null,compatible:false};
}
function analyte(raw){const t=string(raw).toLowerCase().replace(/\s+/g,' ');if(['ssc','80154','suspended sediment concentration','suspended-sediment concentration','suspended sediment','sediment, suspended'].includes(t))return 'SSC';if(['tss','00530','total suspended solids','residue, total nonfilterable','residue, total non-filterable'].includes(t))return 'TSS';return null;}
function nativeIssues(row){
 const issues=[],warnings=[];if(row.review.state==='exclude')issues.push('native-review-excluded');
 if(row.variants.length>1&&row.selectedVersion!==row.id)issues.push(row.selectedVersion?'native-version-superseded':'native-version-ambiguous');
 const fatal=['negative-detection-limit','invalid-station-coordinate','non-water-or-unspecified-medium','quality-control-sample','derived-source-value','conflicting-censor-directions','review-detection-condition'];
 for(const q of row.issues||[])if(fatal.includes(q))issues.push(q);else warnings.push(q);
 if(row.review.state!=='include'&&(row.issues||[]).some(q=>['qualified-result','review-source-status','unit-from-single-detection-limit'].includes(q)))issues.push('native-review-required');
 return {issues,warnings};
}
function observe(row,c,role,ctx){
 const values=Object.fromEntries(fields.map(k=>[k,field(row,c.fields[k])]));
 const provenance={recordId:row.id,logicalKey:row.logicalKey,sourceReferences:cp(row.sources),fields:values,channelRationale:c.rationale,nativeReview:cp(row.review),variants:cp(row.variants),selectedVersion:row.selectedVersion};
 const valuePointer=c.fields.value.path??'constant';need(valuePointer!=='constant','Measured values must bind an actual original record field, never a constant');
 const sourceObservationId=row.id+'#'+valuePointer,id=hash(stable([role,sourceObservationId])),qc=nativeIssues(row),issues=[...qc.issues],warnings=[...qc.warnings];
 for(const k of requiredFields)if(!values[k].present||values[k].value===null||string(values[k].value)==='')issues.push('missing-'+k+'-binding-value');
 const number=decimal(values.value.value);issues.push(...number.issues);const spec=unit(values.unit.value,role,ctx.sensor.unit);
 if(!spec.compatible)issues.push('incompatible-'+role+'-unit');
 const siteId=string(values.siteId.value),method=string(values.method.value),sensorId=string(values.sensorId.value);
 const primary=c.fields.value.path==='/value'||c.fields.value.path==='/reportedValue';
 if(primary){
  const originalUnit=c.fields.value.path==='/value'?row.unit:row.reportedUnit;
  const originalSpec=unit(originalUnit,role,ctx.sensor.unit);
  if(string(originalUnit)&&(!originalSpec.compatible||originalSpec.unit!==spec.unit||originalSpec.factor!==spec.factor))issues.push('bound-unit-conflicts-with-original-value-unit');
  if(role==='sediment'){
   const known=analyte(row.characteristic)||analyte(row.pcode);
   if(known&&known!==ctx.target)issues.push('bound-analyte-conflicts-with-original-characteristic');
  }
  if(role==='turbidity'&&string(row.method)&&method!==string(row.method))issues.push('bound-method-conflicts-with-original-sensor-method');
 }
 if(/not stated|unknown|unspecified/i.test(method))warnings.push('original-method-detail-unavailable');
 if(!string(values.sampledAt.value)&&string(row.sourceTime)&&!row.sampledAt)warnings.push('original-local-clock-remains-unresolved');

 if(siteId!==ctx.siteId)issues.push('different-or-unknown-site');
 if(!method)issues.push('unknown-observation-method');
 if(role==='turbidity'){if(sensorId!==ctx.sensor.id)issues.push('different-or-unknown-sensor');if(method!==ctx.sensor.method)issues.push('different-or-unknown-sensor-method');}
 const target=role==='sediment'?analyte(values.analyte.value):null;if(role==='sediment'&&target!==ctx.target)issues.push('different-or-unknown-sediment-analyte');
 const rawCensor=string(values.censor.value).toLowerCase(),detection=string(values.detection.value).toLowerCase(),qualifier=string(values.qualifier.value),directions=[];
 if(number.censor!=='none')directions.push(number.censor);
 if(rawCensor&&rawCensor!=='none')directions.push(['left','right','interval'].includes(rawCensor)?rawCensor:'unknown');
 if(detection&&!/^(detected|none)$/.test(detection)){
   if(/not detect|non.?detect|below|less than|not quantified/.test(detection))directions.push('left');
   else if(/above|greater than|exceeds/.test(detection))directions.push('right');
   else directions.push('unknown');
 }
 if(/(^|[;,\s])U($|[;,\s])/i.test(qualifier))directions.push('left');
 if(c.fields.value.path==='/value'||c.fields.value.path==='/reportedValue')if(row.censor&&row.censor!=='none')directions.push(row.censor);
 if(directions.length)issues.push('censored-or-unknown-result');
 if(new Set(directions).size>1)issues.push('conflicting-censor-directions');
 if(qualifier&&row.review.state!=='include')issues.push('qualified-observation-needs-native-review');
 const time=timeSupport(values,{canonical:c.fields.sampledAt?.path==='/sampledAt'&&c.fields.sampledDate?.path==='/sampledDate'});issues.push(...time.issues);warnings.push(...time.warnings);
 if(!time.sampledDate||ctx.from&&time.sampledDate<ctx.from||ctx.to&&time.sampledDate>ctx.to)issues.push('outside-selected-date-window');
 const value=number.value!==null&&spec.factor!==null?number.value*spec.factor:null;
 if(value!==null&&(!Number.isFinite(value)||value<0))issues.push('negative-or-unrepresentable-measurement');
 const eventRaw=string(values.eventId.value),eventId=eventRaw?hash(stable([ctx.siteId,eventRaw])):null;
 if(!eventId)warnings.push('event-grouping-unassessed');
 return {id,role,recordId:row.id,sourceIds:[sourceObservationId],siteId,sensorId:role==='turbidity'?sensorId:null,method,analyte:target,value:Number.isFinite(value)?value:null,unit:spec.unit,conversion:spec,rawValue:number.raw,censor:directions.length?unique(directions).join('|'):'none',sampledDate:time.sampledDate,sampledAt:time.sampledAt,support:time.support,time:time.raw,eventId,eventSourceValue:eventRaw||null,issues:unique(issues),warnings:unique(warnings),provenance};
}
function interpret(rows,channels,ctx){
 const observations={sediment:[],turbidity:[],discharge:[]},omitted=[];let total=0;
 for(const [role,c] of Object.entries(channels)){if(c===null)continue;
  const known=new Set(rows.map(x=>x.id));if(c.recordIds!==null)need(c.recordIds.every(id=>known.has(id)),'Selected original record is absent from complete retained input');
  for(const row of rows){if(!row.sources.some(s=>c.sourceIds.includes(s.id)))continue;
   const reasons=[];if(c.recordIds!==null&&!c.recordIds.includes(row.id))reasons.push('not-selected-record');
   for(const filter of c.filters){const q=atPath(row,filter.path);if(!q.present||!scalar(q.value)||stable(q.value)!==stable(filter.equals))reasons.push('filter:'+filter.path);}
   if(reasons.length){omitted.push({role,recordId:row.id,reasons});continue;}
   const obs=observe(row,c,role,ctx);need(++total<=SEDIMENT_LIMITS.observations,'Complete interpreted observation capacity exceeded',413);observations[role].push(obs);
  }
  observations[role].sort((a,b)=>a.id.localeCompare(b.id));
 }
 return {observations,omitted};
}
function unionSupport(observations){
 const supports=observations.filter(Boolean).map(x=>x.support);if(!supports.length||supports.some(x=>!x))return null;
 if(supports.some(x=>x.precision==='date')){if(!supports.every(x=>x.precision==='date'))return null;return {start:supports.map(x=>x.start).sort()[0],end:supports.map(x=>x.end).sort().at(-1),precision:'date'};}
 const start=Math.min(...supports.map(x=>Date.parse(x.start))),end=Math.max(...supports.map(x=>Date.parse(x.end)));
 return {start:new Date(start).toISOString(),end:new Date(end).toISOString(),precision:start===end?'instant':'interval'};
}
function relation(a,b,r){
 const reasons=[],warnings=[];if(a.siteId!==b.siteId)reasons.push('different-site');
 const sameEvent=!!a.eventId&&a.eventId===b.eventId;
 const instantTimes=a.support?.precision==='instant'&&b.support?.precision==='instant';
 const deltaSeconds=instantTimes?Math.abs(Date.parse(a.support.start)-Date.parse(b.support.start))/1000:null;
 if(r.mode==='same-event'){
   if(!sameEvent)reasons.push('different-or-unresolved-event');
   if(!instantTimes&&!r.allowDateOnlySameEvent)reasons.push('date-only-event-not-authorized');
   if(!a.support||!b.support)reasons.push('sampling-support-unresolved');
   if(deltaSeconds!==null&&r.maxDeltaSeconds!==null&&deltaSeconds>r.maxDeltaSeconds)reasons.push('event-outside-selected-time-tolerance');
   if(!instantTimes&&a.sampledDate!==b.sampledDate)reasons.push('dated-event-spans-different-source-dates');
 }else if(r.mode==='time-window'){
   if(!instantTimes)reasons.push('actual-instant-required');else if(deltaSeconds>r.maxDeltaSeconds)reasons.push('outside-selected-time-tolerance');
 }else{
   // Explicit choices still require original event or actual temporal support.
   if(!sameEvent&&(!instantTimes||deltaSeconds>(r.maxDeltaSeconds??0)))reasons.push('explicit-choice-lacks-event-or-time-support');
   if(!instantTimes&&(!sameEvent||!r.allowDateOnlySameEvent||a.sampledDate!==b.sampledDate))reasons.push('explicit-choice-has-unresolved-dated-support');
 }
 if(!sameEvent)warnings.push('independent-event-grouping-unassessed');if(r.eventMeaning!=='hydrologic-event')warnings.push('hydrologic-event-grouping-unassessed');
 return {compatible:reasons.length===0,reasons,warnings,sameEvent,deltaSeconds,support:unionSupport([a,b])};
}
const candidateIndexes=new WeakMap();
function indexCandidates(values){
 let index=candidateIndexes.get(values);if(index)return index;
 const events=new Map(),instants=[];
 for(const value of values){if(value.eventId){const group=events.get(value.eventId)||[];group.push(value);events.set(value.eventId,group);}if(value.support?.precision==='instant')instants.push({time:Date.parse(value.support.start),value});}
 instants.sort((a,b)=>a.time-b.time||a.value.id.localeCompare(b.value.id));index={events,instants};candidateIndexes.set(values,index);return index;
}
function lowerBound(values,target){let lo=0,hi=values.length;while(lo<hi){const m=(lo+hi)>>1;if(values[m].time<target)lo=m+1;else hi=m;}return lo;}
function candidatesFor(anchor,values,r,budget){
 const index=indexCandidates(values),selected=new Map();
 if(r.mode!=='time-window'&&anchor.eventId)for(const value of index.events.get(anchor.eventId)||[])selected.set(value.id,value);
 if(r.mode!=='same-event'&&anchor.support?.precision==='instant'){
  const center=Date.parse(anchor.support.start),tolerance=(r.maxDeltaSeconds??0)*1000;
  for(let n=lowerBound(index.instants,center-tolerance);n<index.instants.length&&index.instants[n].time<=center+tolerance;n++)selected.set(index.instants[n].value.id,index.instants[n].value);
 }
 const candidates=[];for(const value of [...selected.values()].sort((a,b)=>a.id.localeCompare(b.id))){
  need(++budget.comparisons<=SEDIMENT_LIMITS.comparisons,'Complete pairing comparison capacity exceeded; select a smaller explicit cohort',413);
  const rel=relation(anchor,value,r);if(!rel.compatible)continue;
  need(++budget.candidates<=SEDIMENT_LIMITS.candidates,'Complete candidate capacity exceeded; narrow explicit source/event selection',413);
  candidates.push({observationId:value.id,recordId:value.recordId,deltaSeconds:rel.deltaSeconds,sameEvent:rel.sameEvent,support:rel.support,issues:unique([...value.issues,...rel.reasons]),warnings:unique([...value.warnings,...rel.warnings])});
 }
 return candidates;
}
function measurement(o,role,target){return o?{value:o.value,unit:o.unit,sourceIds:cp(o.sourceIds),observationId:o.id,method:o.method,censor:o.censor,rawValue:o.rawValue,conversion:cp(o.conversion),...(role==='sediment'?{analyte:target}:{})}:{value:null,unit:role==='sediment'?'mg/L':null,sourceIds:[],observationId:null,...(role==='sediment'?{analyte:target}:{})};}
function originalSubset(rows,ids){return rows.filter(r=>r.sources.some(s=>ids.includes(s.id)));}
function accounting(rows,source_ids,interpreted){
 const sourceRecords=originalSubset(rows,source_ids),counts={sourceRecords:sourceRecords.length,sediment:interpreted.observations.sediment.length,turbidity:interpreted.observations.turbidity.length,discharge:interpreted.observations.discharge.length,channelOmissions:interpreted.omitted.length};
 return {sourceRecords,sourceCoverage:source_ids.map(id=>({sourceId:id,records:sourceRecords.filter(r=>r.sources.some(s=>s.id===id)).length})),counts};
}
export function buildSedimentPairs(inputRows,inputSelection){
 const rows=rowsInput(inputRows),s=selection(inputSelection),interpreted=interpret(rows,s.channels,s),{observations}=interpreted;
 const choices=new Map(s.choices.map(x=>[x.sampleId,x]));need([...choices.keys()].every(id=>observations.sediment.some(x=>x.id===id)),'Pair choice names an absent original sediment observation');
 const tMap=new Map(observations.turbidity.map(x=>[x.id,x])),qMap=new Map(observations.discharge.map(x=>[x.id,x])),budget={comparisons:0,candidates:0},paired=[];
 for(const sample of observations.sediment){
  const tc=candidatesFor(sample,observations.turbidity,s.pairing,budget),qc=s.channels.discharge?candidatesFor(sample,observations.discharge,s.pairing,budget):[];
  const choice=choices.get(sample.id)||null,issues=[...sample.issues],warnings=[...sample.warnings];let t=null,q=null;
  if(!choice){issues.push(tc.length>1?'ambiguous-turbidity-candidates':tc.length?'explicit-pair-selection-required':'no-supported-turbidity-candidate');}
  else if(choice.action==='exclude')issues.push('explicitly-excluded-observation');
  else{
   t=tMap.get(choice.turbidityId)||null;need(t,'Chosen turbidity observation is absent');
   if(!tc.some(x=>x.observationId===t.id))issues.push('chosen-turbidity-lacks-pairing-support');
   issues.push(...t.issues);warnings.push(...relation(sample,t,s.pairing).warnings);
   if(s.channels.discharge){if(choice.dischargeId===null)issues.push(qc.length>1?'ambiguous-discharge-candidates':'explicit-discharge-selection-required');else{q=qMap.get(choice.dischargeId)||null;need(q,'Chosen discharge observation is absent');if(!qc.some(x=>x.observationId===q.id))issues.push('chosen-discharge-lacks-pairing-support');issues.push(...q.issues);warnings.push(...relation(sample,q,s.pairing).warnings);}}
   else need(choice.dischargeId===null,'Discharge was chosen without a selected source channel');
  }
  const support=unionSupport([sample,t,q]);if(t&&!support)issues.push('pair-temporal-support-unresolved');
  paired.push({id:hash(stable(['sediment-pair',sample.id,t?.id||null,q?.id||null])),sampleId:sample.id,sampledDate:sample.sampledDate,sampledAt:sample.sampledAt,eventId:sample.eventId,eventIds:unique([sample.eventId,t?.eventId,q?.eventId].filter(Boolean)),eventMeaning:s.pairing.eventMeaning||'unknown',siteId:s.siteId,sensor:cp(s.sensor),target:s.target,ssc:measurement(sample,'sediment',s.target),turbidity:t?measurement(t,'turbidity',s.target):{value:null,unit:s.sensor.unit,sourceIds:[],observationId:null},discharge:q?measurement(q,'discharge',s.target):null,support,status:choice?.action==='exclude'?'EXCLUDED':!t?'UNRESOLVED':issues.length?'UNRESOLVED':'SELECTED',issues:unique(issues),warnings:unique(warnings),choice:cp(choice),candidates:{turbidity:tc,discharge:qc},provenance:{sedimentObservationId:sample.id,turbidityObservationId:t?.id||null,dischargeObservationId:q?.id||null}});
 }
 const a=accounting(rows,s.source_ids,interpreted);
 return finish({schema:SEDIMENT_PAIRING_VERSION,siteId:s.siteId,sensor:cp(s.sensor),target:s.target,selection:s,rows:paired,observations,omitted:interpreted.omitted,...a,counts:{...a.counts,pairs:paired.length,selected:paired.filter(x=>x.status==='SELECTED').length,unresolved:paired.filter(x=>x.status==='UNRESOLVED').length,excluded:paired.filter(x=>x.status==='EXCLUDED').length,candidates:budget.candidates},rules:{sourceNormalization:'unchanged original parseSource and record identity',nondetectSubstitution:'none',analyteConversion:'none; SSC and TSS separate',turbidityConversion:'none; FNU and NTU separate',pairSelection:'explicit; no nearest or replicate averaging',timeZone:'only source explicit offset/UTC resolved; date-only support stays on its original calendar axis and never invents midnight UTC',nativeNutrientEligibility:'not used; original source QC, review and variant identity are retained'}});
}
export function buildSedimentPredictionInput(inputRows,inputDeployment,pairing){
 need(obj(pairing)&&pairing.schema===SEDIMENT_PAIRING_VERSION&&SHA.test(pairing.id),'Use the complete original pairing');
 const {id,...basis}=pairing;need(hash(stable(basis))===id,'Pairing identity differs from its complete retained body');
 const d=cp(inputDeployment);shape(d,['schema','source_ids','from','to','channels','choices','pairing','extrapolation','rationale'],'Sediment deployment');need(d.schema==='upstate.sediment-deployment/v1','Unknown sediment deployment schema');ids(d.source_ids,'Deployment sources');dates(d);rule(d.pairing);text(d.rationale,'Deployment rationale');need(['block','flag'].includes(d.extrapolation),'Select extrapolation block or flag');
 shape(d.channels,['turbidity','discharge'],'Prediction channels');channel(d.channels.turbidity,'turbidity',d.source_ids);if(d.channels.discharge!==null)channel(d.channels.discharge,'discharge',d.source_ids);
 list(d.choices,'Prediction choices');const choices=new Map();for(const x of d.choices){shape(x,['turbidityId','dischargeId','reason'],'Prediction choice');need(SHA.test(x.turbidityId)&&!choices.has(x.turbidityId),'Choose each prediction observation once');need(x.dischargeId===null||SHA.test(x.dischargeId),'Invalid prediction discharge identity');text(x.reason,'Prediction choice reason');choices.set(x.turbidityId,x);}
 const rows=rowsInput(inputRows),ctx={...d,siteId:pairing.siteId,sensor:pairing.sensor,target:pairing.target},interpreted=interpret(rows,d.channels,ctx),obs=interpreted.observations,qs=new Map(obs.discharge.map(x=>[x.id,x])),budget={comparisons:0,candidates:0};
 need([...choices.keys()].every(id=>obs.turbidity.some(x=>x.id===id)),'Prediction choice names an absent turbidity observation');
 const result=obs.turbidity.map(t=>{
  const candidates=d.channels.discharge?candidatesFor(t,obs.discharge,d.pairing,budget):[],choice=choices.get(t.id)||null,issues=[...t.issues],warnings=[...t.warnings];let q=null;
  if(d.channels.discharge){if(!choice||choice.dischargeId===null)issues.push(candidates.length>1?'ambiguous-discharge-candidates':candidates.length?'explicit-discharge-selection-required':'no-supported-discharge-candidate');else{q=qs.get(choice.dischargeId)||null;need(q,'Prediction discharge observation is absent');if(!candidates.some(x=>x.observationId===q.id))issues.push('chosen-discharge-lacks-pairing-support');issues.push(...q.issues);warnings.push(...relation(t,q,d.pairing).warnings);}}
  else if(choice)need(choice.dischargeId===null,'Prediction discharge choice has no selected source channel');
  const support=unionSupport([t,q]);if(!support)issues.push('prediction-temporal-support-unresolved');
  return {id:hash(stable(['sediment-prediction',t.id,q?.id||null])),sampledDate:t.sampledDate,sampledAt:t.sampledAt,eventId:t.eventId,eventIds:unique([t.eventId,q?.eventId].filter(Boolean)),eventMeaning:d.pairing.eventMeaning||'unknown',siteId:pairing.siteId,sensor:cp(pairing.sensor),target:pairing.target,turbidity:measurement(t,'turbidity',pairing.target),discharge:q?measurement(q,'discharge',pairing.target):null,support,issues:unique(issues),warnings:unique(warnings),choice:cp(choice),candidates:{discharge:candidates},provenance:{turbidityObservationId:t.id,dischargeObservationId:q?.id||null}};
 });
 const a=accounting(rows,d.source_ids,interpreted);return finish({schema:'upstate.sediment-prediction-input/v1',siteId:pairing.siteId,sensor:cp(pairing.sensor),target:pairing.target,pairingId:pairing.id,selection:d,extrapolation:d.extrapolation,rows:result,observations:obs,omitted:interpreted.omitted,...a,counts:{...a.counts,predictions:result.length,eligible:result.filter(x=>!x.issues.length).length,unresolved:result.filter(x=>x.issues.length).length,candidates:budget.candidates}});
}
function paths(value,prefix='',out=[]){
 if(value===null||typeof value!=='object'){out.push({path:prefix,kind:value===null?'null':typeof value});return out;}
 for(const k of Object.keys(value)){const p=prefix+'/'+k.replace(/~/g,'~0').replace(/\//g,'~1');paths(value[k],p,out);need(out.length<=100000,'Original row field catalogue exceeds complete capacity',413);}return out;
}
export function sedimentObservationCatalogue(inputRows,inputSelection=null){
 const rows=rowsInput(inputRows),sources=new Map(),pointers=new Map();
 for(const row of rows){for(const s of row.sources){if(!sources.has(s.id))sources.set(s.id,{id:s.id,sha:s.sha,label:s.label||'',records:0});sources.get(s.id).records++;}
  for(const p of paths(row.raw,'/raw')){const old=pointers.get(p.path)||{path:p.path,kinds:[],presentRecords:0,examples:[]};old.kinds=unique([...old.kinds,p.kind]);old.presentRecords++;const value=atPath(row,p.path).value;if(old.examples.length<3&&scalar(value)&&stable(value).length<=1000&&!old.examples.some(x=>stable(x.value)===stable(value)))old.examples.push({recordId:row.id,value});pointers.set(p.path,old);}
 }
 const result={schema:'upstate.sediment-observation-catalogue/v1',sources:[...sources.values()],canonicalFields:fields.filter(x=>!['sensorId','analyte'].includes(x)).map(x=>({field:x,path:x==='value'?'/reportedValue':x==='unit'?'/reportedUnit':x==='siteId'?'/stationId':x==='eventId'?'/activityId':'/'+x})),rawFields:[...pointers.values()].sort((a,b)=>a.path.localeCompare(b.path)),records:rows,limits:SEDIMENT_LIMITS};
 if(inputSelection!==null){const s=selection(inputSelection);Object.assign(result,interpret(rows,s.channels,s),{selection:s});}
 return finish(result);
}
