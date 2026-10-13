import {createHash} from 'node:crypto';
import {clean, number, day, InputError, parseCSV, safeJSON} from './parse.mjs';
export const hash = text => createHash('sha256').update(text).digest('hex');
export const stable = value => JSON.stringify(value, (key, val) => val && !Array.isArray(val) && typeof val==='object' ? Object.fromEntries(Object.keys(val).sort().map(k=>[k,val[k]])) : val);
// WQX3 fields plus their WQX2 names. Explicit overrides accommodate laboratory exports.
export const FIELDS = {
 station:['Location_Identifier','MonitoringLocationIdentifier','stationId'],
 organization:['Organization_Identifier','OrganizationIdentifier','organization'],
 activity:['Activity_Identifier','ActivityIdentifier','activityId'],
 result:['Result_Identifier','ResultIdentifier','resultId'],
 date:['Activity_StartDate','ActivityStartDate','sampledDate'],
 datetime:['Activity_StartDateTime','ActivityStartDateTime','sampledAt'],
 time:['Activity_StartTime','ActivityStartTime/Time','ActivityStartTime.Time','sampledTime'],
 zone:['Activity_StartTimeZone','Activity_StartTimeZoneCode','ActivityStartTime/TimeZoneCode','ActivityStartTime.TimeZoneCode','timeZone'],
 characteristic:['Result_Characteristic','CharacteristicName','characteristic'],
 value:['Result_Measure','ResultMeasureValue','value'],
 unit:['Result_MeasureUnit','ResultMeasure/MeasureUnitCode','ResultMeasure.MeasureUnitCode','unit'],
 detection:['Result_ResultDetectionCondition','ResultDetectionConditionText','detection'],
 qualifier:['Result_Qualifier','Result_QualifierCode','ResultMeasureQualifierCode','MeasureQualifierCode','qualifier'],
 fraction:['Result_SampleFraction','ResultSampleFractionText','fraction'],
 status:['Result_Status','ResultStatusIdentifier','status'],
 valueType:['Result_ValueType','ResultValueTypeName','valueType'],
 medium:['Activity_MediaName','Activity_Media','ActivityMediaName','medium'],
 activityType:['Activity_Type','ActivityTypeCode','activityType'],
 method:['Result_AnalyticalMethodIdentifier','ResultAnalyticalMethod/MethodIdentifier','ResultAnalyticalMethod.MethodIdentifier','method'],
 laboratory:['Laboratory_Name','Result_LaboratoryName','LaboratoryName','ResultLaboratoryName','laboratory'],
 pcode:['USGSpcode','USGSPCode','pcode'],
 name:['Location_Name','MonitoringLocationName','stationName'],
 latitude:['Location_Latitude','LatitudeMeasure','latitude'],
 longitude:['Location_Longitude','LongitudeMeasure','longitude'],
 datum:['Location_HorizontalDatum','HorizontalCoordinateReferenceSystemDatumName','datum'],
 comment:['Result_Comment','ResultCommentText','notes']
};
export function fieldReader(headers, overrides={}) {
  if(!overrides || typeof overrides!=='object' || Array.isArray(overrides)) throw new InputError('Column mapping must be an object');
  for (const [key,name] of Object.entries(overrides)) {
    if(typeof name!=='string') throw new InputError('Mapped column names must be strings; use an empty string to disable a field');
    if(!Object.hasOwn(FIELDS,key)) throw new InputError('Unknown mapping field: '+key);
    if(name && !headers.includes(name)) throw new InputError('Mapped column is absent: '+name);
  }
  const mapping = Object.fromEntries(Object.entries(FIELDS).map(([key, aliases])=>[key,Object.hasOwn(overrides,key) ? overrides[key] : aliases.find(x=>headers.includes(x)) || '']));
  return {mapping, get:(row,key)=>clean(row[mapping[key]])};
}
function unitSpec(raw) {
  const u=clean(raw).toLowerCase().replaceAll('μ','u').replaceAll('µ','u').replaceAll('³','3').replace(/\s+/g,' ');
  const m=/^(mg|ug|ng|g)\/(?:l)(?:\s+(?:as\s+)?(.+))?$/.exec(u);
  if(m) return {kind:'concentration',unit:'mg/L',factor:{mg:1,ug:.001,ng:.000001,g:1000}[m[1]],offset:0,basis:clean(m[2]).toUpperCase()};
  if(['ft3/s','ft^3/s','cfs','cu ft/sec','cubic feet per second'].includes(u)) return {kind:'flow',unit:'m3/s',factor:.028316846592,offset:0,basis:''};
  if(['m3/s','m^3/s','cms'].includes(u)) return {kind:'flow',unit:'m3/s',factor:1,offset:0,basis:''};
  if(['deg c','degc','c','°c','degrees celsius'].includes(u)) return {kind:'temperature',unit:'degC',factor:1,offset:0,basis:''};
  if(['deg f','degf','f','°f','degrees fahrenheit'].includes(u)) return {kind:'temperature',unit:'degC',factor:5/9,offset:-32*5/9,basis:''};
  return {kind:'unknown',unit:raw,factor:1,offset:0,basis:''};
}
function constituent(name, pcode, fraction, spec) {
  const text = clean(name).toLowerCase(), f = clean(fraction).toLowerCase();
  if(spec.kind==='flow' && (pcode==='00060'||['stream flow, instantaneous','stream flow','discharge','flow'].includes(text))) return ['flow',''];
  if(spec.kind==='temperature' && (pcode==='00010'||['temperature, water','water temperature','temperature'].includes(text))) return ['temperature',''];
  if(spec.kind!=='concentration') return ['unmapped',spec.basis];
  if(pcode==='00300'||['oxygen','dissolved oxygen'].includes(text)) return ['do','O2'];
  // BOD5 and CBOD5 remain separate; neither is silently treated as ultimate BOD.
  if(pcode==='00310'||text==='biochemical oxygen demand, 5 day'||text==='biochemical oxygen demand, 5-day') return ['bod5','O2'];
  if(text.includes('carbonaceous') && text.includes('5')) return ['cbod5','O2'];
  const total = /^(total|unfiltered|total recoverable)$/.test(f);
  if((text==='nitrogen'||text==='nitrogen, total'||text==='total nitrogen'||text==='nitrogen, mixed forms (nh3), (nh4), organic, (no2) and (no3)') && total && (!spec.basis||spec.basis==='N')) return ['tn','N'];
  if((text==='phosphorus'||text==='phosphorus, total'||text==='total phosphorus') && total && (!spec.basis||spec.basis==='P')) return ['tp','P'];
  if(text.includes('nitrate') && !text.includes('nitrite')) return ['nitrate',spec.basis || 'unspecified'];
  if(text.includes('orthophosphate')) return ['orthophosphate',spec.basis || 'unspecified'];
  return ['unmapped',spec.basis];
}
function timestamp(date, time, zone, combined) {
  if(combined && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(combined)) {
    day(combined.slice(0,10)); const d=new Date(combined);
    if(!Number.isFinite(d.getTime())) throw new InputError('Invalid timestamp');
    return {sampledDate:combined.slice(0,10),sampledAt:d.toISOString(),timePrecision:'instant',sourceTime:combined,timeZone:zone};
  }
  if(!date && combined) {date=combined.slice(0,10);if(!time)time=combined.slice(11,19);}
  const sampledDate=day(date);
  const match=/^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  const zones={UTC:'+00:00',GMT:'+00:00',EST:'-05:00',EDT:'-04:00',CST:'-06:00',CDT:'-05:00',MST:'-07:00',MDT:'-06:00',PST:'-08:00',PDT:'-07:00',AKST:'-09:00',AKDT:'-08:00',HST:'-10:00'};
  if(time && (!match || +match[1]>23||+match[2]>59||+(match[3]||0)>59)) throw new InputError('Invalid sampling time');
  const offset=zones[zone.toUpperCase()] || (/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(zone)?zone:null);
  return {sampledDate,sampledAt:match&&offset?new Date(`${sampledDate}T${time.length===5?time+':00':time}${offset}`).toISOString():null,
    timePrecision:match&&offset?'instant':match?'local-time':'date',sourceTime:time,timeZone:zone};
}
function limits(raw) {
  const result=[];
  for(const suffix of ['A','B','C','D']) {
    const value=number(raw['DetectionLimit_Measure'+suffix]);
    if(value!==null) result.push({value,unit:clean(raw['DetectionLimit_MeasureUnit'+suffix]),type:clean(raw['DetectionLimit_Type'+suffix])});
  }
  const value=number(raw['DetectionQuantitationLimitMeasure/MeasureValue']??raw['DetectionQuantitationLimitMeasure.MeasureValue']);
  if(value!==null) result.push({value,unit:clean(raw['DetectionQuantitationLimitMeasure/MeasureUnitCode']??raw['DetectionQuantitationLimitMeasure.MeasureUnitCode']),type:clean(raw.DetectionQuantitationLimitTypeName)});
  return result;
}
export function normaliseWQP(raw, get) {
  const stationId=get(raw,'station'); if(!stationId) throw new InputError('Station identifier is missing');
  const org=get(raw,'organization'), characteristic=get(raw,'characteristic');
  if(!characteristic)throw new InputError('Characteristic is missing; configure its source column');
  const sourceLimits=limits(raw), declaredUnit=get(raw,'unit');
  const inferredUnit=!declaredUnit && sourceLimits.length===1 ? sourceLimits[0].unit : '';
  const spec=unitSpec(declaredUnit||inferredUnit), [parameter,basis]=constituent(characteristic,get(raw,'pcode'),get(raw,'fraction'),spec);
  const rawValue=get(raw,'value'), detection=get(raw,'detection'), qualifier=get(raw,'qualifier');
  const match=/^([<>]=?|≤|≥)\s*(.+)$/.exec(rawValue);
  let censor=match?(match[1].startsWith('<')||match[1]==='≤'?'left':'right'):'none';
  if(/not detected|non.?detect|below quant|detected not quant|less than/i.test(detection)||/(^|[;, ])U($|[;, ])/.test(qualifier))censor='left';
  if(/above quant|greater than|exceeds quant/i.test(detection))censor='right';
  const numeric=number(match?match[2]:rawValue), reported=numeric===null?null:numeric*spec.factor+spec.offset;
  const detectionLimits=sourceLimits.map(d=>{const u=unitSpec(d.unit);return {...d,normalizedValue:u.kind===spec.kind&&u.basis===spec.basis?d.value*u.factor+u.offset:null,normalizedUnit:u.unit};});
  const knownLimits=detectionLimits.filter(d=>d.normalizedValue!==null);
  // Do not choose among multiple laboratory detection/quantitation thresholds implicitly.
  const limit=reported!==null?reported:knownLimits.length===1?knownLimits[0].normalizedValue:null;
  const value=censor==='none'?reported:null, lower=censor==='right'?limit:value, upper=censor==='left'?limit:value;
  const issues=[];
  if(sourceLimits.some(d=>d.value<0))issues.push('negative-detection-limit');
  if(inferredUnit)issues.push('unit-from-single-detection-limit');
  const lat=number(get(raw,'latitude')),lon=number(get(raw,'longitude'));
  if((lat!==null&&Math.abs(lat)>90)||(lon!==null&&Math.abs(lon)>180))throw new InputError('Station coordinate outside valid range');
  if(spec.kind==='unknown')issues.push('unrecognized-unit');
  if(parameter==='unmapped')issues.push('unmapped-characteristic-or-fraction');
  if(spec.kind==='concentration'&&numeric!==null&&numeric<0)issues.push('negative-concentration');
  if(censor==='none'&&value===null)issues.push('missing-numeric-result');
  if(censor!=='none'&&limit===null)issues.push('censor-limit-unresolved');
  if(detection && !/^(not detected|non.?detect|below quantification limit|detected not quantified|present above quantification limit|detected|less than|greater than|above quantification limit)$/i.test(detection))issues.push('review-detection-condition');
  if(qualifier)issues.push('qualified-result');
  const status=get(raw,'status'), medium=get(raw,'medium'), activityType=get(raw,'activityType'), valueType=get(raw,'valueType');
  if(!/^(accepted|final|validated|approved)$/i.test(status))issues.push('review-source-status');
  if(!/^water$/i.test(medium))issues.push('non-water-or-unspecified-medium');
  if(/blank|spike|quality control|equipment|replicate/i.test(activityType))issues.push('quality-control-sample');
  if(/calculated|estimated|modeled|modelled/i.test(valueType))issues.push('derived-source-value');
  if(censor!=='none')issues.push('censored-result');
  const when=timestamp(get(raw,'date'),get(raw,'time'),get(raw,'zone'),get(raw,'datetime'));
  const resultId=get(raw,'result'),activityId=get(raw,'activity');
  const logicalKey=resultId ? stable(['wqp',org,stationId,resultId]) : stable(['wqp',org,stationId,activityId,when,characteristic,get(raw,'fraction'),get(raw,'method'),get(raw,'unit')]);
  return {sourceKind:'wqp',stationId,organization:org,activityId,sourceResultId:resultId,logicalKey:hash(logicalKey),
    ...when,parameter,characteristic,pcode:get(raw,'pcode'),basis,fraction:get(raw,'fraction'),unit:spec.unit,
    value,lower,upper,censor,reportedValue:rawValue,reportedUnit:get(raw,'unit'),detection,detectionLimits,qualifier,status,medium,activityType,valueType,
    method:get(raw,'method'),laboratory:get(raw,'laboratory'),comment:get(raw,'comment'),issues,
    station:{id:stationId,name:get(raw,'name')||stationId,latitude:number(get(raw,'latitude')),longitude:number(get(raw,'longitude')),datum:get(raw,'datum')},raw};
}
export function normaliseFlow(feature) {
  const p=feature?.properties;
  if(!p || !p.monitoring_location_id || p.parameter_code!=='00060' || p.statistic_id!=='00003')throw new InputError('Only USGS discharge (00060), daily mean (00003) features are accepted');
  const spec=unitSpec(p.unit_of_measure), v=number(p.value);
  if(spec.kind!=='flow'||v===null||v<0)throw new InputError('Discharge must be nonnegative with a recognized flow unit');
  const sampledDate=day(clean(p.time).slice(0,10)),value=v*spec.factor;
  const logicalKey=hash(stable(['usgs-daily',p.time_series_id||'',p.monitoring_location_id,p.parameter_code,p.statistic_id,sampledDate]));
  const coords=feature.geometry?.type==='Point'?feature.geometry.coordinates:[];
  const qualifier=clean(p.qualifier),status=clean(p.approval_status),issues=[];
  if(qualifier)issues.push('qualified-result');if(status!=='Approved')issues.push('review-source-status');
  return {sourceKind:'usgs-daily',stationId:p.monitoring_location_id,organization:'USGS',activityId:'',sourceResultId:String(feature.id||''),logicalKey,
    sampledDate,sampledAt:null,timePrecision:'daily-mean',sourceTime:clean(p.time),timeZone:clean(p.time_zone_abbreviation),
    parameter:'flow',characteristic:'Discharge, daily mean',pcode:'00060',basis:'',fraction:'',unit:'m3/s',value,lower:value,upper:value,censor:'none',
    reportedValue:String(p.value),reportedUnit:p.unit_of_measure,detection:'',detectionLimits:[],qualifier,status,medium:'Water',activityType:'Daily statistic',valueType:'Daily mean',method:'USGS daily mean 00003',laboratory:'',comment:'',issues,
    station:{id:p.monitoring_location_id,name:p.monitoring_location_name||p.monitoring_location_id,latitude:number(coords[1]),longitude:number(coords[0]),datum:'source-GeoJSON'},raw:feature};
}
export function parseSource({kind, text, mapping={}}) {
  if(!['wqp','usgs-daily','stations'].includes(kind))throw new InputError('kind must be wqp, stations or usgs-daily');
  if(typeof text!=='string'||!text.trim())throw new InputError('A nonempty UTF-8 source is required');
  const rows=[],rejected=[]; let headers=[], resolved={};
  if(kind==='usgs-daily') {
    const data=safeJSON(text);if(data.type!=='FeatureCollection'||!Array.isArray(data.features))throw new InputError('Expected a complete USGS GeoJSON FeatureCollection');
    if(data.links?.some(l=>l.rel==='next'))throw new InputError('This source has a next-page link. Acquire all pages with the provider fetch or combine all pages before importing.');
    for(let i=0;i<data.features.length;i++) {try{rows.push({line:i+1,row:normaliseFlow(data.features[i])});}catch(e){rejected.push({line:i+1,reason:e.message,raw:data.features[i]});}}
  } else {
    const input=parseCSV(text);headers=input.headers;rejected.push(...input.rejected);const reader=fieldReader(headers,mapping);resolved=reader.mapping;
    if(!resolved.station)throw new InputError('Missing station column; choose the correct column mapping');
    if(kind==='wqp'&&(!resolved.characteristic||(!resolved.date&&!resolved.datetime)))throw new InputError('Missing characteristic/date columns; choose the correct column mapping');
    for(const item of input.rows) {try{
      const get=reader.get;
      if(kind==='stations') {
        const id=get(item.raw,'station');if(!id)throw new InputError('Station identifier is missing');
        const lat=number(get(item.raw,'latitude')),lon=number(get(item.raw,'longitude'));
        if((lat!==null&&Math.abs(lat)>90)||(lon!==null&&Math.abs(lon)>180))throw new InputError('Station coordinate outside valid range');
        rows.push({line:item.line,row:{id,name:get(item.raw,'name')||id,latitude:lat,longitude:lon,datum:get(item.raw,'datum'),raw:item.raw}});
      } else rows.push({line:item.line,row:normaliseWQP(item.raw,get)});
    }catch(e){rejected.push({line:item.line,reason:e.message,raw:item.raw});}}
  }
  return {kind,rows,rejected,headers,mapping:resolved};
}
