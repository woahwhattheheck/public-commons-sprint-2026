// MIT. Coverage-aware calculations over retained original weather values.
import {need,keys,text,VARIABLES,variableInterval,localTimestamp,canonical,sha} from './contract.mjs';
const UNITS={
 temperature:{'°C':{scale:1,offset:0},celsius:{scale:1,offset:0},'°F':{scale:5/9,offset:-32*5/9},fahrenheit:{scale:5/9,offset:-32*5/9}},
 wind:{'km/h':{scale:1,offset:0},kmh:{scale:1,offset:0},'m/s':{scale:3.6,offset:0},ms:{scale:3.6,offset:0},mph:{scale:1.609344,offset:0},kn:{scale:1.852,offset:0},knots:{scale:1.852,offset:0}},
 precipitation:{mm:{scale:1,offset:0},inch:{scale:25.4,offset:0}},
 percent:{'%':{scale:1,offset:0}},radiation:{'W/m²':{scale:1,offset:0},'W/m2':{scale:1,offset:0}}
};
export const DEFAULT_UNITS={temperature:'°C',wind:'km/h',precipitation:'mm',percent:'%',radiation:'W/m²'};
export function convert(value,from,to,variable){
 if(value===null)return null;const dimension=VARIABLES[variable]?.dimension,units=UNITS[dimension],a=units?.[from],b=units?.[to];
 need(a&&b&&typeof value==='number'&&Number.isFinite(value),'INCOMPATIBLE_WEATHER_UNITS');
 return (value*a.scale+a.offset-b.offset)/b.scale;
}
export function quantile(values,p){
 if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),position=(sorted.length-1)*p,lo=Math.floor(position),hi=Math.ceil(position);
 return sorted[lo]+(sorted[hi]-sorted[lo])*(position-lo);
}
export function series(view,variable,{unit,offset=0,limit=1000}={}){
 need(Object.hasOwn(VARIABLES,variable),'VARIABLE_INVALID');
 need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=2000,'PAGINATION_INVALID');
 const selected=view.columns.filter(c=>c.variable===variable);unit??=DEFAULT_UNITS[VARIABLES[variable].dimension];
 for(const c of selected)convert(0,c.unit,unit,variable);
 const rows=view.times.slice(offset,offset+limit).map((time,index)=>{
  const i=offset+index,values=selected.map(c=>({member:c.member,key:c.key,value:convert(c.values[i],c.unit,unit,variable)}));
  const available=values.map(v=>v.value).filter(v=>v!==null);
  return {...localTimestamp(time,view.metadata.timezone),epoch:time,unit,availableMembers:available.length,returnedColumns:selected.length,
   min:available.length?Math.min(...available):null,p10:quantile(available,.1),median:quantile(available,.5),p90:quantile(available,.9),
   max:available.length?Math.max(...available):null,members:values};
 });
 return {variable,unit,interval:selected[0]?.interval??variableInterval(view.request,variable),family:view.request.family,model:view.request.model,
  total:view.times.length,offset,nextOffset:offset+rows.length<view.times.length?offset+rows.length:null,rows,metadata:view.metadata,
  quantileMethod:'Linear interpolation between ordered returned values; no missing value is replaced with zero.'};
}
function epoch(value){
 need(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?Z$/.test(value),'UTC_WINDOW_REQUIRED');
 const result=Date.parse(value)/1000;need(Number.isSafeInteger(result),'UTC_WINDOW_INVALID');return result;
}
export function normalizeRule(input){
 keys(input,['variable','unit','aggregation','operator','threshold','startUtc','endUtc','minimumCoverage']);
 need(Object.hasOwn(VARIABLES,input.variable),'VARIABLE_INVALID');
 const variable=VARIABLES[input.variable],unit=input.unit??DEFAULT_UNITS[variable.dimension];
 convert(0,unit,unit,input.variable);
 need(['min','max','mean','sum'].includes(input.aggregation),'AGGREGATION_INVALID');
 need(input.aggregation!=='sum'||variable.interval==='preceding-hour-sum','SUM_REQUIRES_ACCUMULATED_VARIABLE');
 need(['gte','lte'].includes(input.operator)&&typeof input.threshold==='number'&&Number.isFinite(input.threshold),'THRESHOLD_INVALID');
 const start=epoch(input.startUtc),end=epoch(input.endUtc);need(end>start&&end-start<=35*86400,'DECISION_WINDOW_INVALID');
 const minimumCoverage=input.minimumCoverage??1;need(typeof minimumCoverage==='number'&&minimumCoverage>0&&minimumCoverage<=1,'COVERAGE_INVALID');
 return {variable:input.variable,unit,aggregation:input.aggregation,operator:input.operator,threshold:input.threshold,
  startUtc:new Date(start*1000).toISOString(),endUtc:new Date(end*1000).toISOString(),minimumCoverage};
}
export function evaluate(view,input){
 const rule=normalizeRule(input),start=epoch(rule.startUtc),end=epoch(rule.endUtc),interval=view.columns.find(c=>c.variable===rule.variable)?.interval??variableInterval(view.request,rule.variable);
 const backward=interval.startsWith('preceding-'),phase=((view.times[0]%3600)+3600)%3600;
 const first=Math.ceil(((backward?start+3600:start)-phase)/3600)*3600+phase;
 const expected=Math.max(0,backward?Math.floor((end-first)/3600)+1:Math.ceil((end-first)/3600));
 need(expected>0,'DECISION_HAS_NO_COMPLETE_SAMPLE_INTERVAL');
 const indexes=[];view.times.forEach((t,i)=>{if(backward?t-3600>=start&&t<=end:t>=start&&t<end)indexes.push(i);});
 const members=view.columns.filter(c=>c.variable===rule.variable).map(c=>{
  const values=indexes.map(i=>convert(c.values[i],c.unit,rule.unit,rule.variable)).filter(v=>v!==null);
  const coverage=values.length/expected,eligible=values.length>0&&coverage>=rule.minimumCoverage;
  let aggregate=null;
  if(eligible){if(rule.aggregation==='min')aggregate=Math.min(...values);else if(rule.aggregation==='max')aggregate=Math.max(...values);
   else{const sum=values.reduce((a,b)=>a+b,0);aggregate=rule.aggregation==='sum'?sum:sum/values.length;}}
  const exceeded=aggregate===null?null:rule.operator==='gte'?aggregate>=rule.threshold:aggregate<=rule.threshold;
  return {member:c.member,key:c.key,availableSamples:values.length,expectedSamples:expected,coverage,eligible,aggregate,exceeded};
 });
 const eligible=members.filter(m=>m.eligible),exceeded=eligible.filter(m=>m.exceeded),aggregates=eligible.map(m=>m.aggregate);
 return {rule,interval,windowConvention:backward?'Complete preceding-hour intervals inside [start,end].':'Instantaneous samples in [start,end).',
  expectedSamples:expected,returnedTimestamps:indexes.length,returnedColumns:members.length,eligibleMembers:eligible.length,
  thresholdMembers:exceeded.length,memberFraction:eligible.length?exceeded.length/eligible.length:null,
  memberFractionMeaning:view.request.family==='ensemble'?'Fraction of eligible returned members, not a calibrated event probability.':'One deterministic model column.',
  outcome:!eligible.length?'INSUFFICIENT_COVERAGE':exceeded.length?'THRESHOLD_MET':'THRESHOLD_NOT_MET',
  aggregate:{min:aggregates.length?Math.min(...aggregates):null,p10:quantile(aggregates,.1),median:quantile(aggregates,.5),p90:quantile(aggregates,.9),max:aggregates.length?Math.max(...aggregates):null},
  members,metadata:view.metadata};
}
export function compare(left,right,{variable,unit}){
 need(left.request.latitude===right.request.latitude&&left.request.longitude===right.request.longitude,'COMPARISON_REQUIRES_SAME_REQUESTED_SITE');
 const a=series(left,variable,{unit,limit:2000}),b=series(right,variable,{unit:a.unit,limit:2000}),index=new Map(b.rows.map(row=>[row.epoch,row]));
 const rows=a.rows.filter(row=>index.has(row.epoch)).map(row=>{
  const other=index.get(row.epoch);return {utc:row.utc,epoch:row.epoch,left:row.median,right:other.median,
   difference:row.median===null||other.median===null?null:row.median-other.median,
   leftAvailable:row.availableMembers,rightAvailable:other.availableMembers};
 });
 const values=rows.map(r=>r.difference).filter(v=>v!==null);
 return {variable,unit:a.unit,alignment:'Identical UTC validity timestamp and requested coordinates; model grid cells remain explicit.',
  left:left.metadata,right:right.metadata,overlappingTimestamps:rows.length,comparableTimestamps:values.length,
  meanDifference:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,
  meanAbsoluteDifference:values.length?values.reduce((a,b)=>a+Math.abs(b),0)/values.length:null,rows};
}
export function decisionInput(input){
 keys(input,['title','owner','disposition','notes','rule']);
 need(['review','monitor','reschedule','proceed'].includes(input.disposition),'DISPOSITION_INVALID');
 const notes=input.notes??'';need(typeof notes==='string'&&notes.length<=10000&&!notes.includes('\0'),'DECISION_NOTES_INVALID');
 return {title:text(input.title,'DECISION_TITLE'),owner:text(input.owner,'DECISION_OWNER',120),disposition:input.disposition,notes,rule:normalizeRule(input.rule)};
}
export function reportDigest(value){return sha(Buffer.from(canonical(value)));}
