import {createHash} from 'node:crypto';
import {clean, number, day, InputError, parseCSV, safeJSON} from './parse.mjs';
export const hash = text => createHash('sha256').update(text).digest('hex');
export const stable = value => JSON.stringify(value, (key, val) => val && !Array.isArray(val) && typeof val==='object' ? Object.fromEntries(Object.keys(val).sort().map(k=>[k,val[k]])) : val);

export const USGS_DAILY_EDITION='usgs-daily-source/v2';
export const WQP_DETECTION_EDITION='wqp-detection-conditions/v2';
const DETECTION_MAPPING='_wqp_detection';
const label=text=>clean(text).toLowerCase().replace(/\s+/g,' ');
function detectionCondition(text) {
  const value=label(text);
  if(!value||value==='detected')return {direction:'none',known:true};
  if(/^(?:present )?below (?:quantification|quantitation) limit$/.test(value)
    || /^below (?:daily detection|detection|long-term blank-basd dt|method detection|reporting|sample-specific detect|system detection) limit$/.test(value)
    || /^(?:not detected(?: at (?:detection|reporting) limit)?|non[ -]?detect(?:ed)?|detected not quantified|less than)$/.test(value))
    return {direction:'left',known:true};
  if(/^(?:(?:present )?above (?:quantification|quantitation) limit|above operating range|greater than|exceeds (?:quantification|quantitation) limit)$/.test(value))
    return {direction:'right',known:true};
  // Other published conditions require the source's own interpretation.
  // In particular, do not collapse "Between Inst Detect and Quant Limit".
  return {direction:'none',known:false};
}
function limitDirection(type) {
  const value=label(type);
  if(/^upper (?:quantitation|quantification|reporting|calibration) limit$/.test(value))return 'right';
  if(/^(?:practical|lower|sample-specific|estimated|contract) (?:quantitation|quantification) limit$/.test(value)
    || /^(?:minimum reporting level|reporting limit|sample-specific min detect conc|laboratory reporting level|lower reporting limit|sample detection limit|lower limit of detection|instrument detection level|estimated detection level|method detection level|method detection limit|long term method detection level|interim reporting level|daily detection limit|blank-adjusted method detect limit|contract detection limit)$/.test(value))return 'left';
  return null;
}
function limitAgrees(type,condition,direction) {
  if(limitDirection(type)!==direction)return false;
  const c=label(condition),t=label(type);
  if(c.includes('reporting'))return /report/.test(t);
  if(c.includes('quantification')||c.includes('quantitation')||c==='detected not quantified')return /quant/.test(t);
  if(c.includes('detection')||c.includes('detect limit'))return /detect/.test(t);
  return true;
}
function detectionV2({rawValue,detection,qualifier,reported,match,detectionLimits}) {
  const condition=detectionCondition(detection);
  const comparator=match?(match[1].startsWith('<')||match[1]==='≤'?'left':'right'):null;
  const qualified=/(^|[;, ])U($|[;, ])/i.test(qualifier)?'left':null;
  const directions=[comparator,condition.direction==='none'?null:condition.direction,qualified].filter(Boolean);
  const conflict=new Set(directions).size>1;
  const censor=comparator||qualified||condition.direction;
  const candidates=detectionLimits.filter(d=>d.normalizedValue!==null&&d.normalizedValue>=0&&limitAgrees(d.type,detection,censor));
  let limit=null,limitSource=null;
  if(censor!=='none'&&!conflict) {
    if(comparator&&reported!==null){limit=reported;limitSource='explicit-result-comparator';}
    else if(candidates.length===1){limit=candidates[0].normalizedValue;limitSource='paired-typed-limit';}
  }
  const issues=[];
  if(!condition.known||conflict)issues.push('review-detection-condition');
  if(conflict)issues.push('conflicting-censor-directions');
  if(censor!=='none'&&!match&&reported!==null)issues.push('censored-reported-number-not-used-as-limit');
  if(censor!=='none'&&!limitSource&&detectionLimits.length)issues.push('ambiguous-or-incompatible-censor-limit');
  return {censor,limit,issues,interpretation:{
    edition:WQP_DETECTION_EDITION,conditionRecognized:condition.known,
    directionSource:comparator?'explicit-result-comparator':qualified?'qualifier-U':condition.direction!=='none'?'result-detection-condition':null,
    limitSource,conflictingDirections:conflict,
    reportedNumberIsBound:limitSource==='explicit-result-comparator',
  }};
}

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
  if(Object.hasOwn(overrides,DETECTION_MAPPING)&&overrides[DETECTION_MAPPING]!==WQP_DETECTION_EDITION)throw new InputError('Unsupported WQP detection interpretation edition');
  for (const [key,name] of Object.entries(overrides)) {
    if(key===DETECTION_MAPPING)continue;
    if(typeof name!=='string') throw new InputError('Mapped column names must be strings; use an empty string to disable a field');
    if(!Object.hasOwn(FIELDS,key)) throw new InputError('Unknown mapping field: '+key);
    if(name && !headers.includes(name)) throw new InputError('Mapped column is absent: '+name);
  }
  const mapping = Object.fromEntries(Object.entries(FIELDS).map(([key, aliases])=>[key,Object.hasOwn(overrides,key) ? overrides[key] : aliases.find(x=>headers.includes(x)) || '']));
  if(Object.hasOwn(overrides,DETECTION_MAPPING))mapping[DETECTION_MAPPING]=WQP_DETECTION_EDITION;
  // The directive travels inside the resolved mapping and thus the import ID.
  // Unpinned historical imports keep their exact original normalization.
  return {mapping, get:(row,key)=>key===DETECTION_MAPPING?(mapping[DETECTION_MAPPING]||''):clean(row[mapping[key]])};
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
function limits(raw,versioned=false) {
  if(versioned&&clean(raw.WQPDetectionLimitsJSON)) {
    const rows=safeJSON(raw.WQPDetectionLimitsJSON);
    if(!Array.isArray(rows))throw new InputError('Original joined detection limits must be an array');
    return rows.map(row=>{
      if(!row||typeof row!=='object'||Array.isArray(row))throw new InputError('Invalid original joined detection limit');
      const value=number(row.value);
      if(value===null||!clean(row.unit)||!clean(row.type))throw new InputError('Joined detection limit lacks its original numeric value, unit or type');
      return {value,unit:clean(row.unit),type:clean(row.type),original:row};
    });
  }
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
  const versioned=get(raw,DETECTION_MAPPING)===WQP_DETECTION_EDITION;
  const sourceLimits=limits(raw,versioned), declaredUnit=get(raw,'unit');
  const inferredUnit=!declaredUnit && sourceLimits.length===1 ? sourceLimits[0].unit : '';
  const spec=unitSpec(declaredUnit||inferredUnit), [parameter,basis]=constituent(characteristic,get(raw,'pcode'),get(raw,'fraction'),spec);
  const rawValue=get(raw,'value'), detection=get(raw,'detection'), qualifier=get(raw,'qualifier');
  const match=/^([<>]=?|≤|≥)\s*(.+)$/.exec(rawValue);
  let censor=match?(match[1].startsWith('<')||match[1]==='≤'?'left':'right'):'none';
  if(/not detected|non.?detect|below quant|detected not quant|less than/i.test(detection)||/(^|[;, ])U($|[;, ])/.test(qualifier))censor='left';
  if(/above quant|greater than|exceeds quant/i.test(detection))censor='right';
  const numeric=number(match?match[2]:rawValue), reported=numeric===null?null:numeric*spec.factor+spec.offset;
  const detectionLimits=sourceLimits.map(d=>{const u=unitSpec(d.unit);const compatible=u.kind===spec.kind&&u.basis===spec.basis&&(!versioned||u.kind!=='unknown'||label(d.unit)===label(declaredUnit||inferredUnit));return {...d,normalizedValue:compatible?d.value*u.factor+u.offset:null,normalizedUnit:u.unit};});
  const knownLimits=detectionLimits.filter(d=>d.normalizedValue!==null);
  // Do not choose among multiple laboratory detection/quantitation thresholds implicitly.
  let limit=reported!==null?reported:knownLimits.length===1?knownLimits[0].normalizedValue:null;
  const interpretation=versioned?detectionV2({rawValue,detection,qualifier,reported,match,detectionLimits}):null;
  if(interpretation){censor=interpretation.censor;limit=interpretation.limit;}
  const value=censor==='none'?reported:null, lower=censor==='right'?limit:value, upper=censor==='left'?limit:value;
  const issues=interpretation?[...interpretation.issues]:[];
  if(sourceLimits.some(d=>d.value<0))issues.push('negative-detection-limit');
  if(inferredUnit)issues.push('unit-from-single-detection-limit');
  const lat=number(get(raw,'latitude')),lon=number(get(raw,'longitude'));
  if((lat!==null&&Math.abs(lat)>90)||(lon!==null&&Math.abs(lon)>180))throw new InputError('Station coordinate outside valid range');
  if(spec.kind==='unknown')issues.push('unrecognized-unit');
  if(parameter==='unmapped')issues.push('unmapped-characteristic-or-fraction');
  if(spec.kind==='concentration'&&numeric!==null&&numeric<0)issues.push('negative-concentration');
  if(censor==='none'&&value===null)issues.push('missing-numeric-result');
  if(censor!=='none'&&limit===null)issues.push('censor-limit-unresolved');
  if(!versioned && detection && !/^(not detected|non.?detect|below quantification limit|detected not quantified|present above quantification limit|detected|less than|greater than|above quantification limit)$/i.test(detection))issues.push('review-detection-condition');
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
    ...(interpretation?{detectionInterpretation:interpretation.interpretation}:{}),
    ...when,parameter,characteristic,pcode:get(raw,'pcode'),basis,fraction:get(raw,'fraction'),unit:spec.unit,
    value,lower,upper,censor,reportedValue:rawValue,reportedUnit:get(raw,'unit'),detection,detectionLimits,qualifier,status,medium,activityType,valueType,
    method:get(raw,'method'),laboratory:get(raw,'laboratory'),comment:get(raw,'comment'),issues,
    station:{id:stationId,name:get(raw,'name')||stationId,latitude:number(get(raw,'latitude')),longitude:number(get(raw,'longitude')),datum:get(raw,'datum')},raw};
}
export function normaliseFlow(feature,edition='') {
  const p=feature?.properties;
  if(!p || !p.monitoring_location_id || p.parameter_code!=='00060' || p.statistic_id!=='00003')throw new InputError('Only USGS discharge (00060), daily mean (00003) features are accepted');
  const spec=unitSpec(p.unit_of_measure), v=number(p.value);
  if(spec.kind!=='flow'||v===null||v<0)throw new InputError('Discharge must be nonnegative with a recognized flow unit');
  const sampledDate=day(clean(p.time).slice(0,10)),value=v*spec.factor;
  let series=p.time_series_id||'',approval=p.approval_status;
  if(edition===USGS_DAILY_EDITION){
    const alias=(a,b)=>{if(p[a]!==undefined&&p[b]!==undefined&&clean(p[a])!==clean(p[b]))throw new InputError('Conflicting original USGS fields: '+a+' / '+b);return p[a]??p[b];};
    series=alias('time_series_id','timeseries_id')||'';
    approval=alias('approval_status','approvals_status');
  }
  const logicalKey=hash(stable(['usgs-daily',series,p.monitoring_location_id,p.parameter_code,p.statistic_id,sampledDate]));
  const coords=feature.geometry?.type==='Point'?feature.geometry.coordinates:[];
  const qualifier=clean(p.qualifier),status=clean(approval),issues=[];
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
    let flowEdition='';
    if(mapping&&Object.hasOwn(mapping,'_usgs_daily')){
      if(mapping._usgs_daily!==USGS_DAILY_EDITION||Object.keys(mapping).some(key=>key!=='_usgs_daily'))throw new InputError('Choose the explicit supported USGS daily interpretation');
      flowEdition=USGS_DAILY_EDITION;resolved={_usgs_daily:flowEdition};
    }
    const data=safeJSON(text);if(data.type!=='FeatureCollection'||!Array.isArray(data.features))throw new InputError('Expected a complete USGS GeoJSON FeatureCollection');
    if(data.links?.some(l=>l.rel==='next'))throw new InputError('This source has a next-page link. Acquire all pages with the provider fetch or combine all pages before importing.');
    for(let i=0;i<data.features.length;i++) {try{rows.push({line:i+1,row:normaliseFlow(data.features[i],flowEdition)});}catch(e){rejected.push({line:i+1,reason:e.message,raw:data.features[i]});}}
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
