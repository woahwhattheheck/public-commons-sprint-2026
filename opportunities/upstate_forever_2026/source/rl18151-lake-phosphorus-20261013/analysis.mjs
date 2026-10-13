/** Pure source-bound analysis for the original RL-18151 lake observations. */
export const STATION = "21SC60WQ_WQX-RL-18151";
export function parseCSV(text) {
  text=String(text).replace(/^\uFEFF/,"");
  const records=[];let row=[],field="",quoted=false,closed=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"'){quoted=false;closed=true;}else field+=c;continue;}
    if(c==='"'){if(field||closed)throw Error("Unexpected CSV quote");quoted=true;continue;}
    if(c===','){row.push(field);field="";closed=false;continue;}
    if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x!==""))records.push(row);row=[];field="";closed=false;continue;}
    if(closed)throw Error("Characters follow a closed CSV field");
    field+=c;
  }
  if(quoted)throw Error("Unclosed CSV field");
  if(field||row.length||closed){row.push(field);records.push(row);}
  const headers=records.shift()||[];
  if(!headers.length||new Set(headers).size!==headers.length)throw Error("Missing or duplicate CSV headers");
  return {headers,rows:records.map((values,i)=>{
    if(values.length!==headers.length)throw Error("CSV record width differs at logical record "+(i+2));
    return Object.fromEntries(headers.map((name,j)=>[name,values[j]]));
  })};
}
export function csv(rows, fields) {
  const columns=fields||Object.keys(rows[0]||{});
  const cell=value=>{const text=String(value??"");return /[",\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;};
  return columns.map(cell).join(",")+"\n"+rows.map(row=>columns.map(name=>cell(row[name])).join(",")).join("\n")+(rows.length?"\n":"");
}
const numeric=value=>String(value??"").trim()!==""&&Number.isFinite(Number(value))?Number(value):null;
const count=values=>Object.fromEntries([...new Set(values)].sort().map(value=>[value,values.filter(x=>x===value).length]));
const stringify=value=>JSON.stringify(value,null,2)+"\n";
const pick=(row,...fields)=>{for(const field of fields)if(row[field]!==undefined&&row[field]!=="")return row[field];return "";};
const textOrder=(a,b)=>a<b?-1:a>b?1:0;

function interval(row) {
  const value=numeric(row.value_text), limit=numeric(row.limit_value);
  const condition=row.detection_condition.trim().toLowerCase();
  const left=["present below quantification limit","not detected","not present","non-detect","non detect"].includes(condition);
  if(left){
    if(limit!==null&&limit>=0&&row.limit_unit===row.unit)
      return {status:"left_censored",lower:0,upper:limit,lower_inclusive:true,upper_inclusive:false};
    return {status:"left_censored_without_comparable_limit",lower:null,upper:null};
  }
  if(condition)return {status:"source_detection_condition",lower:null,upper:null};
  if(value!==null)return {status:"reported_numeric",lower:value,upper:value,lower_inclusive:true,upper_inclusive:true};
  return {status:"unquantified",lower:null,upper:null};
}
function finiteSummary(rows) {
  const quantified=rows.filter(row=>row.interval.status==="reported_numeric");
  const values=quantified.map(row=>row.interval.lower).sort((a,b)=>a-b);
  const bounded=rows.length>0&&rows.every(row=>row.interval.lower!==null&&row.interval.upper!==null);
  const average=values=>values.reduce((a,b)=>a+b,0)/values.length;
  return {
    records:rows.length,activities:new Set(rows.map(row=>row.activity_id)).size,
    sampling_dates:new Set(rows.map(row=>row.date)).size,
    numeric_records:values.length,
    left_censored_records:rows.filter(row=>row.interval.status.startsWith("left_censored")).length,
    unresolved_records:rows.filter(row=>row.interval.lower===null).length,
    numeric_minimum:values.length?values[0]:null,numeric_maximum:values.length?values.at(-1):null,
    numeric_median:values.length?(values.length%2?values[(values.length-1)/2]:(values[values.length/2-1]+values[values.length/2])/2):null,
    numeric_mean:values.length?average(values):null,
    all_record_mean_lower:bounded?average(rows.map(row=>row.interval.lower)):null,
    all_record_mean_upper:bounded?average(rows.map(row=>row.interval.upper)):null,
    mean_interval_available:bounded,qualifiers:count(rows.map(row=>row.qualifier)),
    result_statuses:count(rows.map(row=>row.result_status)),
    detection_conditions:count(rows.map(row=>row.detection_condition))
  };
}
export function deriveStudy(sources, manifest) {
  if(manifest.schema!=="upstate.original-station-source/v1"||manifest.station_id!==STATION||!manifest.complete)
    throw Error("Use the complete original RL-18151 acquisition manifest");
  const originals=new Map(manifest.originals.map(item=>[item.path,item]));
  const table=(path)=>{
    if(!originals.has(path)||typeof sources[path]!=="string")throw Error("Original source is absent: "+path);
    if(originals.get(path).status===204&&sources[path]==="")return {headers:[],rows:[]};
    return parseCSV(sources[path]);
  };
  const stationRows=table("original/station.csv").rows;
  const matches=stationRows.filter(row=>row.MonitoringLocationIdentifier===STATION);
  if(matches.length!==1||stationRows.length!==1)throw Error("Expect exactly the selected original station");
  const station=matches[0],longitude=numeric(station.LongitudeMeasure),latitude=numeric(station.LatitudeMeasure);
  if(longitude===null||latitude===null)throw Error("Original station lacks numeric coordinates");
  const all=[],activityTables={},limitTables={},summaryTables={};
  const groupNames={nutrient:"Nutrient",physical:"Physical",microbiological:"Microbiological"};
  for(const [group,label]of Object.entries(groupNames)){
    const resultPath="original/"+group+"-results.csv",parsed=table(resultPath);
    for(const required of ["MonitoringLocationIdentifier","ActivityIdentifier","ActivityStartDate","CharacteristicName","ResultMeasureValue","ResultMeasure/MeasureUnitCode"])
      if(originals.get(resultPath).status!==204&&!parsed.headers.includes(required))throw Error("Original result schema misses "+required);
    activityTables[group]=table("original/"+group+"-activities.csv");
    limitTables[group]=table("original/"+group+"-detection_limits.csv");
    summaryTables[group]=table("original/"+group+"-summary.csv");
    for(const [index,original]of parsed.rows.entries()){
      if(original.MonitoringLocationIdentifier!==STATION)throw Error("Another original station appears in results");
      const date=original.ActivityStartDate;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<manifest.selected_start||date>manifest.selected_end)
        throw Error("Original result date is outside the selected study");
      const row={
        record_id:group+":"+String(index+2),station_id:STATION,group:label,
        activity_id:original.ActivityIdentifier,result_id:pick(original,"ResultIdentifier"),
        date,time:pick(original,"ActivityStartTime/Time"),time_zone:pick(original,"ActivityStartTime/TimeZoneCode"),
        activity_type:pick(original,"ActivityTypeCode"),sample_media:pick(original,"ActivityMediaName"),
        sample_media_subdivision:pick(original,"ActivityMediaSubdivisionName"),
        characteristic:original.CharacteristicName,fraction:pick(original,"ResultSampleFractionText"),
        value_text:original.ResultMeasureValue,unit:original["ResultMeasure/MeasureUnitCode"],
        detection_condition:pick(original,"ResultDetectionConditionText"),
        limit_type:pick(original,"DetectionQuantitationLimitTypeName"),
        limit_value:pick(original,"DetectionQuantitationLimitMeasure/MeasureValue"),
        limit_unit:pick(original,"DetectionQuantitationLimitMeasure/MeasureUnitCode"),
        qualifier:pick(original,"MeasureQualifierCode"),result_status:pick(original,"ResultStatusIdentifier"),
        result_value_type:pick(original,"ResultValueTypeName"),
        method_id:pick(original,"ResultAnalyticalMethod/MethodIdentifier"),
        method_context:pick(original,"ResultAnalyticalMethod/MethodIdentifierContext"),
        method_name:pick(original,"ResultAnalyticalMethod/MethodName"),
        depth_value:pick(original,"ActivityDepthHeightMeasure/MeasureValue"),
        depth_unit:pick(original,"ActivityDepthHeightMeasure/MeasureUnitCode"),
        depth_reference:pick(original,"ActivityDepthAltitudeReferencePointText"),
        result_depth_value:pick(original,"ResultDepthHeightMeasure/MeasureValue"),
        result_depth_unit:pick(original,"ResultDepthHeightMeasure/MeasureUnitCode"),
        result_depth_reference:pick(original,"ResultDepthAltitudeReferencePointText"),
        temperature_basis:pick(original,"ResultTemperatureBasisText"),
        weight_basis:pick(original,"ResultWeightBasisText"),
        analytical_fraction:pick(original,"ResultParticleSizeBasisText"),
        comments:pick(original,"ResultCommentText"),laboratory_comment:pick(original,"ResultLaboratoryCommentText"),
        activity_comment:pick(original,"ActivityCommentText"),
        source_file:resultPath,source_row:index+2,source_sha256:originals.get(resultPath).sha256,
        source_uri:originals.get(resultPath).uri,original
      };
      row.interval=interval(row);all.push(row);
    }
  }
  all.sort((a,b)=>textOrder(a.date,b.date)||textOrder(a.activity_id,b.activity_id)||textOrder(a.characteristic,b.characteristic)||textOrder(a.record_id,b.record_id));
  const cohorts=new Map();
  for(const row of all){
    const key=JSON.stringify([row.date.slice(0,4),row.group,row.characteristic,row.fraction,row.unit,
      row.sample_media,row.sample_media_subdivision,row.depth_value,row.depth_unit,row.depth_reference,
      row.result_depth_value,row.result_depth_unit,row.result_depth_reference,row.method_context,row.method_id,
      row.result_value_type,row.temperature_basis,row.weight_basis,row.analytical_fraction]);
    if(!cohorts.has(key))cohorts.set(key,[]);
    cohorts.get(key).push(row);
  }
  const annual=[...cohorts.values()].map(rows=>{
    const first=rows[0];
    return {year:first.date.slice(0,4),group:first.group,characteristic:first.characteristic,
      fraction:first.fraction,unit:first.unit,sample_media:first.sample_media,sample_media_subdivision:first.sample_media_subdivision,
      depth_value:first.depth_value,depth_unit:first.depth_unit,depth_reference:first.depth_reference,
      result_depth_value:first.result_depth_value,result_depth_unit:first.result_depth_unit,result_depth_reference:first.result_depth_reference,
      method_context:first.method_context,method_id:first.method_id,result_value_type:first.result_value_type,
      temperature_basis:first.temperature_basis,weight_basis:first.weight_basis,analytical_fraction:first.analytical_fraction,
      ...finiteSummary(rows),record_ids:rows.map(row=>row.record_id)};
  }).sort((a,b)=>textOrder(a.characteristic,b.characteristic)||textOrder(a.year,b.year)||textOrder(JSON.stringify(a),JSON.stringify(b)));
  const summary={
    schema:"upstate.rl18151-observed-lake-study/v1",station_id:STATION,
    station:{...station,longitude,latitude},
    selected_period:{start:manifest.selected_start,end:manifest.selected_end},
    source_acquisition:manifest.operation,
    source_response_count:manifest.originals.length,
    records:all.length,activities:new Set(all.map(row=>row.activity_id)).size,
    sampling_dates:new Set(all.map(row=>row.date)).size,
    first_date:all[0]?.date??null,last_date:all.at(-1)?.date??null,
    characteristic_counts:count(all.map(row=>row.characteristic)),
    group_counts:count(all.map(row=>row.group)),interval_status_counts:count(all.map(row=>row.interval.status)),
    yearly_coverage:[...new Set(all.map(row=>row.date.slice(0,4)))].sort().map(year=>{
      const rows=all.filter(row=>row.date.startsWith(year));
      return {year,records:rows.length,activities:new Set(rows.map(row=>row.activity_id)).size,
        dates:new Set(rows.map(row=>row.date)).size,months:[...new Set(rows.map(row=>row.date.slice(5,7)))].sort()};
    }),
    temporal_comparability:"Annual summaries retain exact characteristic, fraction, units, medium, depth, method and result-basis cohorts. Different cohorts are not pooled.",
    censor_method:"Original values and limits remain separate. Recognized left-censored rows have [0, published limit) only when limit and result units match. Unknown conditions or incompatible limits retain no numeric interval. No half-limit substitution.",
    interpretation:"Original lake sampling concentrations and physical measurements are contextual observations. No annual catchment export, discharge or load is inferred.",
    original_activity_and_limit_tables:Object.fromEntries(Object.keys(groupNames).map(group=>[group,{
      activity_records:activityTables[group].rows.length,limit_records:limitTables[group].rows.length,
      summary_records:summaryTables[group].rows.length
    }]))
  };
  const flat=all.map(({original,interval,...row})=>({...row,interval_status:interval.status,
    interval_lower:interval.lower,interval_upper:interval.upper,interval_upper_inclusive:interval.upper_inclusive,
    original_record:JSON.stringify(original)}));
  const output={
    "derived/observed-records.json":stringify({schema:"upstate.source-observed-records/v1",station_id:STATION,records:all}),
    "derived/observed-records.csv":csv(flat),
    "derived/annual-cohorts.json":stringify({schema:"upstate.source-observed-cohorts/v1",cohorts:annual}),
    "derived/annual-cohorts.csv":csv(annual.map(row=>({...row,qualifiers:JSON.stringify(row.qualifiers),
      result_statuses:JSON.stringify(row.result_statuses),detection_conditions:JSON.stringify(row.detection_conditions),
      record_ids:JSON.stringify(row.record_ids)}))),
    "derived/study-summary.json":stringify(summary)
  };
  for(const [group,label]of Object.entries(groupNames)){
    const rows=all.filter(row=>row.group===label).map(row=>({
      record_id:row.record_id,station_id:row.station_id,catchment_id:"",
      parameter:row.characteristic,species:row.characteristic,value:row.value_text,unit:row.unit,
      period_start:row.date,period_end:row.date,qualifier:row.qualifier,
      method:[row.method_context,row.method_id,row.method_name].filter(Boolean).join(": "),
      measurement_support:group==="physical"?"other_context":"concentration",
      quantity_basis:"original_discrete_measurement",
      uncertainty:JSON.stringify({condition:row.detection_condition,limit_type:row.limit_type,limit_value:row.limit_value,
        limit_unit:row.limit_unit,interval:row.interval}),
      source_records:JSON.stringify({file:row.source_file,row:row.source_row,sha256:row.source_sha256,
        uri:row.source_uri,activity_id:row.activity_id,result_id:row.result_id,original:row.original}),
      monitoring_location:STATION
    }));
    output["derived/observations-"+group+".csv"]=csv(rows,["record_id","station_id","catchment_id","parameter","species",
      "value","unit","period_start","period_end","qualifier","method","measurement_support","quantity_basis",
      "uncertainty","source_records","monitoring_location"]);
  }
  return {summary,records:all,cohorts:annual,outputs:output};
}
