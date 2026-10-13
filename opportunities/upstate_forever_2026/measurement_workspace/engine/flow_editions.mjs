/** Original daily discharge editions, source reconciliation and sample-date context.
 * Pure calculation module shared by the existing Measurements intake and CLI.
 * Original response bodies remain in the caller's retained source collection.
 */
const DAY=86400000;
export const CFS_TO_CMS=0.028316846592;
export const FLOW_EDITION_SCHEMA='upstate.daily-flow-edition/v1';
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const txt=x=>x==null?'':String(x).trim();
const stable=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
function iso(x){const s=txt(x);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s+'T00:00:00Z'))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw Error('Use an original valid ISO reporting date: '+s);return s;}
function days(a,b){a=iso(a);b=iso(b);if(a>b)throw Error('Reporting period is reversed');const out=[];for(let t=Date.parse(a+'T00:00:00Z'),end=Date.parse(b+'T00:00:00Z');t<=end;t+=DAY)out.push(new Date(t).toISOString().slice(0,10));return out;}
function numeric(x){const s=txt(x);if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(s))return null;const n=Number(s);return Number.isFinite(n)?n:null;}
function list(x){return x==null?[]:Array.isArray(x)?x.map(txt).filter(Boolean):[txt(x)].filter(Boolean);}
function unit(x){const s=txt(x).toLowerCase().replace(/³/g,'3').replace(/\s/g,'');if(['ft3/s','ft^3/s','cfs','cubicfeetpersecond'].includes(s))return CFS_TO_CMS;if(['m3/s','m^3/s','cms'].includes(s))return 1;return null;}
function id(x,label){const s=txt(x);if(!s)throw Error('Provide '+label);return s;}
function year(date){return Number(date.slice(0,4))+(Number(date.slice(5,7))>=10?1:0);}
function canonicalApproval(values){const result=values.map(x=>x==='A'?'Approved':x==='P'?'Provisional':x);return [...new Set(result)].sort().join('|');}
function common(source,fields){
 const factor=unit(fields.source_unit),raw=numeric(fields.source_value),issues=[];
 if(raw===null)issues.push('missing-or-nonnumeric-discharge');
 if(factor===null)issues.push('unrecognized-discharge-unit');
 if(fields.no_data_value!==undefined&&raw!==null&&raw===Number(fields.no_data_value))issues.push('source-no-data');
 if(fields.parameter_code!=='00060'||fields.statistic_id!=='00003')issues.push('not-daily-mean-discharge');
 if(raw!==null&&raw<0&&!issues.includes('source-no-data'))issues.push('signed-negative-discharge');
 const usable=!issues.some(x=>x!=='signed-negative-discharge');
 const q=usable?raw*factor:null;
 if(q!==null&&!Number.isFinite(q))throw Error('Converted discharge is not finite');
 const date=iso(fields.date);
 return {observation_id:source.sha256+':'+fields.source_pointer,source_observation_id:fields.observation_id,monitoring_location_id:fields.monitoring_location_id,
 time_series_id:fields.time_series_id,date,water_year:year(date),
 source_value:fields.source_value,source_unit:fields.source_unit,unit_source:fields.unit_source||'observation',
 discharge_m3_s:q,conversion_factor:factor,approval_status:canonicalApproval(fields.approvals),
 qualifier:fields.qualifiers.join('|'),last_modified:fields.last_modified||null,source_request_id:source.id,
 edition_id:source.edition_id,source_id:source.id,source_sha256:source.sha256,source_uri:source.uri,
 source_pointer:fields.source_pointer,source_format:source.format,parameter_code:fields.parameter_code,
 statistic_id:fields.statistic_id,source_time:fields.source_time,source_time_zone:fields.source_time_zone||null,
 method:fields.method||null,validity:issues,raw:fields.raw};
}
export function normaliseDailySource(source){
 if(!source||typeof source!=='object')throw Error('Provide a retained source descriptor');
 id(source.id,'source ID');id(source.edition_id,'edition ID');id(source.uri,'original source URI');
 if(!/^[a-f0-9]{64}$/.test(source.sha256||''))throw Error('Retain the exact original source SHA256');
 const body=typeof source.body==='string'?JSON.parse(source.body):source.body;
 const rows=[],excluded=[];
 if(source.format==='nwis-waterml-json'){
  if(!Array.isArray(body?.value?.timeSeries))throw Error('Original NWIS timeSeries is absent');
  body.value.timeSeries.forEach((series,si)=>{
   const vars=series.variable?.variableCode||[],opts=series.variable?.options?.option||[];
   const code=vars.find(x=>x.default===true)?.value||vars[0]?.value;
   const stats=opts.filter(x=>x.name==='Statistic');
   const stat=stats.length===1?stats[0].optionCode:null;
   if(code!=='00060'||stat!=='00003'){excluded.push({source_id:source.id,source_pointer:'/value/timeSeries/'+si,parameter_code:code,statistic_id:stat,reason:'not-daily-mean-discharge'});return;}
   const sites=(series.sourceInfo?.siteCode||[]).filter(x=>x.agencyCode==='USGS'||x.network==='NWIS');
   if(sites.length!==1)throw Error('NWIS series requires one original USGS station');
   const station='USGS-'+sites[0].value,seriesId=id(series.name,'original NWIS series name');
   (series.values||[]).forEach((group,gi)=>{
    (group.value||[]).forEach((v,vi)=>{
     const qs=list(v.qualifiers), approvals=qs.filter(x=>x==='A'||x==='P'),qualifiers=qs.filter(x=>x!=='A'&&x!=='P');
     const sourceTime=id(v.dateTime,'original reporting time');
     rows.push(common(source,{observation_id:seriesId+':'+gi+':'+vi,monitoring_location_id:station,
      time_series_id:seriesId,date:sourceTime.slice(0,10),source_value:v.value,
      source_unit:series.variable?.unit?.unitCode,approvals,qualifiers,parameter_code:code,statistic_id:stat,
      source_time:sourceTime,source_time_zone:series.sourceInfo.timeZoneInfo||null,
      method:group.method||[],no_data_value:series.variable.noDataValue,
      source_pointer:'/value/timeSeries/'+si+'/values/'+gi+'/value/'+vi,raw:v}));
    });
   });
  });
 }else if(source.format==='usgs-ogc-daily'){
  if(body?.type!=='FeatureCollection'||!Array.isArray(body.features))throw Error('Use original USGS OGC FeatureCollection');
  body.features.forEach((f,i)=>{
   const p=f?.properties;if(!p)throw Error('OGC daily feature has no properties');
   if(p.parameter_code!=='00060'||p.statistic_id!=='00003'){excluded.push({source_id:source.id,source_pointer:'/features/'+i,parameter_code:p.parameter_code,statistic_id:p.statistic_id,reason:'not-daily-mean-discharge'});return;}
   const alias=(a,b)=>{if(p[a]!==undefined&&p[b]!==undefined&&stable(p[a])!==stable(p[b]))throw Error('Conflicting original OGC fields: '+a+' / '+b);return p[a]??p[b];};
   const sid=alias('time_series_id','timeseries_id');
   rows.push(common(source,{observation_id:id(f.id,'original OGC observation ID'),
    monitoring_location_id:id(p.monitoring_location_id,'original station'),time_series_id:id(sid,'original OGC series'),
    date:iso(p.time),source_value:p.value,source_unit:p.unit_of_measure,
    approvals:list(alias('approval_status','approvals_status')),qualifiers:list(p.qualifier),
    parameter_code:p.parameter_code,statistic_id:p.statistic_id,last_modified:p.last_modified,
    source_time:p.time,source_time_zone:p.time_zone_abbreviation,method:p.method||null,
    source_pointer:'/features/'+i,raw:f}));
  });
 }else throw Error('Choose nwis-waterml-json or usgs-ogc-daily');
 return {rows,excluded,pagination:(body.links||[]).filter(l=>l.rel==='next').map(l=>l.href)};
}
const key=(station,date)=>station+'|'+date;
function sameObservation(a,b){return a.source_sha256===b.source_sha256&&a.source_pointer===b.source_pointer;}
function state(candidates){
 if(!candidates.length)return'missing';
 if(candidates.length>1)return'ambiguous';
 if(candidates[0].discharge_m3_s===null)return'unquantified';
 return candidates[0].discharge_m3_s<0?'signed-negative':'quantified';
}
export function buildFlowEdition({id:editionId,title,sources,start,end,series_by_station}){
 id(editionId,'flow edition ID');id(title,'flow edition title');
 start=iso(start);end=iso(end);const calendar=days(start,end);if(!Array.isArray(sources)||!sources.length)throw Error('Retain at least one original daily source');
 if(!series_by_station||!Object.keys(series_by_station).length)throw Error('Select each station and exact original series');
 const all=[],excluded=[],descriptors=[],sourceIds=new Set();
 for(const source of sources){
  if(source.edition_id!==editionId)throw Error('Source edition differs from selected edition');
  if(sourceIds.has(source.id))throw Error('Repeated source ID');sourceIds.add(source.id);
  const parsed=normaliseDailySource(source);
  for(const next of parsed.pagination){
   if(!sources.some(s=>s.uri===next))throw Error('Retain the next original daily source page: '+next);
  }
  descriptors.push({id:source.id,format:source.format,uri:source.uri,sha256:source.sha256});
  all.push(...parsed.rows);excluded.push(...parsed.excluded);
 }
 const selected=new Map(),outside=[];
 for(const row of all){
  const series=series_by_station[row.monitoring_location_id];
  if(!Array.isArray(series)||!series.includes(row.time_series_id)){excluded.push({source_id:row.source_id,source_pointer:row.source_pointer,reason:'unselected-series',time_series_id:row.time_series_id});continue;}
  if(row.date<start||row.date>end){outside.push(row);continue;}
  const k=key(row.monitoring_location_id,row.date),values=selected.get(k)||[];
  if(!values.some(x=>sameObservation(x,row)))values.push(row);
  selected.set(k,values);
 }
 const rows=[];
 for(const station of Object.keys(series_by_station).sort()){
  const series=series_by_station[station];
  if(!Array.isArray(series)||!series.length||new Set(series).size!==series.length)throw Error('Select distinct explicit series IDs');
  for(const date of calendar){const candidates=selected.get(key(station,date))||[];rows.push({monitoring_location_id:station,date,status:state(candidates),flow:candidates.length===1?candidates[0]:null,candidates});}
 }
 return {schema:FLOW_EDITION_SCHEMA,id:editionId,title,start,end,series_by_station,sources:descriptors,
  rows,excluded,outside_selected_period:outside,summary:summariseFlowRows(rows),
  method:{date:'Original agency reporting date, retained without UTC conversion',volume:'Daily mean discharge times 86400 seconds; signed values preserved; no gap filling',ambiguity:'More than one distinct retained source row stays ambiguous until an explicit source selection resolves it'}};
}
function ranges(rows,status){
 const out=[];for(const r of rows.filter(r=>r.status===status)){const last=out[out.length-1];if(last&&Date.parse(r.date)-Date.parse(last.end)===DAY){last.end=r.date;last.days++;}else out.push({start:r.date,end:r.date,days:1});}return out;
}
export function summariseFlowRows(rows){
 const groups=new Map();
 for(const r of rows){const k=r.monitoring_location_id;const values=groups.get(k)||[];values.push(r);groups.set(k,values);}
 return [...groups].map(([station,values])=>{
  values.sort((a,b)=>a.date.localeCompare(b.date));
  const use=values.filter(r=>r.flow?.discharge_m3_s!==null&&r.flow!==null);
  const signed=use.filter(r=>r.flow.discharge_m3_s<0);
  const qs=use.map(r=>r.flow.discharge_m3_s),sum=qs.reduce((a,b)=>a+b,0);
  return{monitoring_location_id:station,start:values[0]?.date||null,end:values.at(-1)?.date||null,
   expected_days:values.length,quantified_days:use.length,missing_days:values.filter(r=>r.status==='missing').length,
   ambiguous_days:values.filter(r=>r.status==='ambiguous').length,unquantified_days:values.filter(r=>r.status==='unquantified').length,
   signed_negative_days:signed.length,approved_days:use.filter(r=>r.flow.approval_status==='Approved').length,
   provisional_days:use.filter(r=>r.flow.approval_status.split('|').includes('Provisional')).length,
   qualified_days:use.filter(r=>Boolean(r.flow.qualifier)).length,complete_numeric_period:use.length===values.length,
   known_volume_m3:sum*86400,mean_discharge_m3_s:qs.length?sum/qs.length:null,
   missing_intervals:ranges(values,'missing'),ambiguous_intervals:ranges(values,'ambiguous'),unquantified_intervals:ranges(values,'unquantified')};
 });
}
export function flowPeriods(edition){
 if(edition.schema!==FLOW_EDITION_SCHEMA)throw Error('Use a complete flow edition');
 const groups=new Map();
 for(const row of edition.rows){const y=year(row.date),periods=[['calendar',row.date.slice(0,4)],['month',row.date.slice(0,7)],['water',String(y)]];
  for(const [kind,p]of periods){const k=kind+'|'+p;const g=groups.get(k)||{kind,period:p,rows:[]};g.rows.push(row);groups.set(k,g);}
 }
 return [...groups.values()].flatMap(g=>summariseFlowRows(g.rows).map(s=>{
  const y=Number(g.period.slice(0,4)),m=Number(g.period.slice(5)||1);
  const fullStart=g.kind==='water'?(y-1)+'-10-01':g.kind==='month'?g.period+'-01':y+'-01-01';
  const fullEnd=g.kind==='water'?y+'-09-30':g.kind==='month'?new Date(Date.UTC(y,m,0)).toISOString().slice(0,10):y+'-12-31';
  return {...s,period_kind:g.kind,period:g.period,calendar_start:fullStart,calendar_end:fullEnd,calendar_days:days(fullStart,fullEnd).length,
   complete_calendar_period:s.complete_numeric_period&&s.start===fullStart&&s.end===fullEnd};
 }));
}
export function reconcileFlowEditions(before,after){
 if(before.schema!==FLOW_EDITION_SCHEMA||after.schema!==FLOW_EDITION_SCHEMA)throw Error('Select two retained flow editions');
 const left=new Map(before.rows.map(r=>[key(r.monitoring_location_id,r.date),r])),right=new Map(after.rows.map(r=>[key(r.monitoring_location_id,r.date),r]));
 const rows=[];
 for(const k of [...new Set([...left.keys(),...right.keys()])].sort()){
  const a=left.get(k),b=right.get(k), changes=[];
  if(!a)changes.push('outside-earlier-selected-period');else if(!b)changes.push('outside-later-selected-period');
  else if(a.status!==b.status)changes.push('availability');
  if(a?.flow&&b?.flow){
   if(a.flow.discharge_m3_s!==b.flow.discharge_m3_s)changes.push('discharge');
   if(a.flow.approval_status!==b.flow.approval_status)changes.push('approval');
   if(a.flow.qualifier!==b.flow.qualifier)changes.push('qualifier');
   if(stable(a.flow.method)!==stable(b.flow.method))changes.push('method-description');
   if(a.flow.source_value!==b.flow.source_value||a.flow.source_unit!==b.flow.source_unit)changes.push('source-representation');
   if(a.flow.time_series_id!==b.flow.time_series_id)changes.push('series-identity');
  }else if(a&&b&&stable(a.candidates)!==stable(b.candidates)&&a.status==='ambiguous'&&b.status==='ambiguous')changes.push('ambiguous-source-candidates');
  rows.push({monitoring_location_id:(a||b).monitoring_location_id,date:(a||b).date,changes,
   before:a||null,after:b||null,delta_discharge_m3_s:a?.flow?.discharge_m3_s!=null&&b?.flow?.discharge_m3_s!=null?b.flow.discharge_m3_s-a.flow.discharge_m3_s:null});
 }
 const counts={};for(const r of rows)for(const change of r.changes)counts[change]=(counts[change]||0)+1;
 return {schema:'upstate.daily-flow-reconciliation/v1',before_id:before.id,after_id:after.id,counts,rows,
  selection_policy:'Both original editions retained; comparison does not adopt one automatically'};
}
export function joinSampleDates(edition,samples,relations){
 if(edition.schema!==FLOW_EDITION_SCHEMA)throw Error('Use the complete selected flow edition');
 const indexed=new Map(edition.rows.map(r=>[key(r.monitoring_location_id,r.date),r]));
 const relationMap=new Map();for(const relation of relations){if(relationMap.has(relation.station_id))throw Error('Repeated station support selection');id(relation.gauge_id,'gauge ID');id(relation.gauge_relation,'gauge relationship');id(relation.source,'relationship source');relationMap.set(relation.station_id,relation);}
 const result=[];
 for(const sample of samples){
  const station=id(sample.station_id??sample.stationId,'sample station ID'),date=iso(sample.date??sample.sampledDate),relation=relationMap.get(station);
  const sampleId=txt(sample.sample_id??sample.id??sample.sourceResultId)||[station,sample.activity_id||sample.activityId||'',sample.source_file||'',sample.source_row||''].join('|');
  const r=relation?indexed.get(key(relation.gauge_id,date)):null;
  const colocated=relation?.gauge_relation==='co_located'&&relation?.flow_location_role==='matched_catchment_discharge';
  result.push({sample_id:sampleId,station_id:station,date,gauge_id:relation?.gauge_id||null,
   gauge_relation:relation?.gauge_relation||'unassigned',flow_location_role:relation?.flow_location_role||'unassigned',
   relationship_source:relation?.source||null,relationship_notes:relation?.notes||null,
   flow_status:!relation?'unassigned':r?r.status:'outside-selected-period',
   annual_mass_spatial_support:colocated,flow:r?.flow||null,candidates:r?.candidates||[],sample});
 }
 return {schema:'upstate.sample-date-flow-context/v1',flow_edition_id:edition.id,rows:result,
  counts:{samples:result.length,distinct_station_dates:new Set(result.map(r=>key(r.station_id,r.date))).size,
   matched_numeric_dates:new Set(result.filter(r=>r.flow?.discharge_m3_s!=null).map(r=>key(r.station_id,r.date))).size,
   spatially_matched_samples:result.filter(r=>r.annual_mass_spatial_support).length},
  date_method:'Original reported sampling calendar date joined to original gauge daily reporting date; source clock/time zone retained in sample; daily flow is not instantaneous sample discharge'};
}
