/** Derive original WQP measurement support without replacing publisher fields. */
export const SCHEMA = "upstate.nc-ambient-measurements/v1";
export const BASE = "source/nc_ambient_measurements/20261013/";
export function csv(text) {
  const rows=[];let row=[],field="",quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
    else if(!quoted&&(c===","||c==="\n"||c==="\r")){row.push(field);field="";if(c!==","){if(c==="\r"&&text[i+1]==="\n")i++;rows.push(row);row=[];}}else field+=c;}
  if(quoted)throw Error("Unclosed original CSV quote");if(field||row.length){row.push(field);rows.push(row);}
  if(rows[0]?.[0])rows[0][0]=rows[0][0].replace(/^\uFEFF/,"");
  return rows;
}
const enc=v=>v==null?"":typeof v==="object"?JSON.stringify(v):String(v);
export function csvOutput(rows,columns){return [columns,...rows.map(r=>columns.map(c=>enc(r[c])))].map(r=>r.map(v=>/[",\r\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v).join(",")).join("\n")+"\n";}
const json=v=>JSON.stringify(v,null,2)+"\n";
const id=(...parts)=>JSON.stringify(parts);
const numeric=v=>typeof v==="string"&&v.trim()!==""&&/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.trim())&&Number.isFinite(Number(v))?Number(v):null;
const median=values=>{if(!values.length)return null;const a=[...values].sort((a,b)=>a-b),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;};
const counts=values=>Object.fromEntries([...values.reduce((m,x)=>(m.set(x,(m.get(x)||0)+1),m),new Map())].sort(([a],[b])=>String(a).localeCompare(String(b))));
const season=m=>["DJF","MAM","JJA","SON"][m===12||m<=2?0:m<=5?1:m<=8?2:3];
const window=d=>d<"2016-01-01"?"2008–2015":d<"2021-01-01"?"2016–2020":d<"2026-01-01"?"2021–2025":"2026";
function readFile(path,text){
 const rr=csv(text);if(!rr.length||new Set(rr[0]).size!==rr[0].length)throw Error("Missing/duplicate original CSV columns: "+path);
 return rr.slice(1).filter(r=>!(r.length===1&&r[0]==="")).map((r,i)=>{if(r.length!==rr[0].length)throw Error("Original row width differs: "+path+":"+(i+2));return{original:Object.fromEntries(rr[0].map((k,j)=>[k,r[j]])),source:{path,row:i+2}};});
}
export function derive(originals,provenance){
 const sources={result:[],activity:[],limit:[],station:[]},sourceInventory=[];
 for(const capture of provenance.captures){const text=originals[capture.path];if(typeof text!=="string")throw Error("Missing original "+capture.path);
 const parsed=readFile(capture.path,text),h=csv(text)[0];
 const type=h.includes("ResultDetectionConditionText")?"result":h.includes("DetectionQuantitationLimitTypeName")?"limit":h.includes("ActivityTypeCode")?"activity":h.includes("MonitoringLocationTypeName")?"station":null;
 if(!type)throw Error("Unrecognized original profile "+capture.path);
 sources[type].push(...parsed);sourceInventory.push({...capture,profile:type,rows:parsed.length,columns:h.length});}
 const stationMap=new Map(),activityMap=new Map(),resultMap=new Map(),limitMap=new Map();
 for(const item of sources.station){const r=item.original,k=id(r.OrganizationIdentifier,r.MonitoringLocationIdentifier);if(stationMap.has(k))throw Error("Repeated station original "+k);stationMap.set(k,item);}
 for(const item of sources.activity){const r=item.original,k=id(r.OrganizationIdentifier,r.ActivityIdentifier);if(activityMap.has(k))throw Error("Repeated activity original "+k);activityMap.set(k,item);}
 for(const item of sources.limit){const r=item.original,k=id(r.OrganizationIdentifier,r.ActivityIdentifier,r.ResultIdentifier);if(!limitMap.has(k))limitMap.set(k,[]);limitMap.get(k).push(item);}
 const observations=[];
 for(const item of sources.result){const r=item.original,k=id(r.OrganizationIdentifier,r.ActivityIdentifier,r.ResultIdentifier);
 if(resultMap.has(k))throw Error("Repeated original result identity "+k);resultMap.set(k,item);
 const activity=activityMap.get(id(r.OrganizationIdentifier,r.ActivityIdentifier));if(!activity)throw Error("Missing original activity "+k);
 const a=activity.original;if(a.MonitoringLocationIdentifier!==r.MonitoringLocationIdentifier||a.ActivityStartDate!==r.ActivityStartDate)throw Error("Original activity/result station or date differs "+k);
 const station=stationMap.get(id(r.OrganizationIdentifier,r.MonitoringLocationIdentifier));if(!station)throw Error("Missing original station "+k);
 const limits=limitMap.get(k)||[];if(limits.some(l=>l.original.MonitoringLocationIdentifier!==r.MonitoringLocationIdentifier||l.original.CharacteristicName!==r.CharacteristicName))throw Error("Original limit/result identity differs "+k);
 const originalUnit=r["ResultMeasure/MeasureUnitCode"],limitUnits=[...new Set(limits.map(l=>l.original["DetectionQuantitationLimitMeasure/MeasureUnitCode"]).filter(Boolean))];
 const value=numeric(r.ResultMeasureValue),condition=r.ResultDetectionConditionText;
 const censored=Boolean(condition.trim()||/^[<>]/.test(r.ResultMeasureValue.trim()));
 const analysisUnit=originalUnit||(limitUnits.length===1?limitUnits[0]:"");
 const date=r.ActivityStartDate;if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error("Original sample date is not ISO "+k);
 const note=[r.ResultCommentText,r.ResultLaboratoryCommentText,a.ActivityCommentText].filter(Boolean).join(" | ");
 const qualityCodes=[...new Set((note.match(/\b[A-Z]{1,3}\d{1,3}\b/g)||[]))];
 observations.push({
 organization:r.OrganizationIdentifier,station_id:r.MonitoringLocationIdentifier,activity_id:r.ActivityIdentifier,result_id:r.ResultIdentifier,
 date,time:r["ActivityStartTime/Time"],time_zone:r["ActivityStartTime/TimeZoneCode"],year:Number(date.slice(0,4)),month:Number(date.slice(5,7)),season:season(Number(date.slice(5,7))),window:window(date),
 characteristic:r.CharacteristicName,fraction:r.ResultSampleFractionText,method_specification:r.MethodSpecificationName,method_id:r["ResultAnalyticalMethod/MethodIdentifier"],method_context:r["ResultAnalyticalMethod/MethodIdentifierContext"],method_name:r["ResultAnalyticalMethod/MethodName"],
 original_value:r.ResultMeasureValue,numeric_value:value,original_unit:originalUnit,analysis_unit:analysisUnit,analysis_unit_basis:originalUnit?"original_result":limitUnits.length===1?"original_limit":"unspecified",
 detection_condition:condition,censored,qualifier:r.MeasureQualifierCode,status:r.ResultStatusIdentifier,value_type:r.ResultValueTypeName,
 weight_basis:r.ResultWeightBasisText,time_basis:r.ResultTimeBasisText,temperature_basis:r.ResultTemperatureBasisText,particle_size_basis:r.ResultParticleSizeBasisText,
 result_comment:r.ResultCommentText,laboratory_comment:r.ResultLaboratoryCommentText,activity_comment:a.ActivityCommentText,quality_codes:qualityCodes,
 activity_type:a.ActivityTypeCode,media:a.ActivityMediaName,media_subdivision:a.ActivityMediaSubdivisionName,activity_depth:a["ActivityDepthHeightMeasure/MeasureValue"],activity_depth_unit:a["ActivityDepthHeightMeasure/MeasureUnitCode"],hydrologic_condition:a.HydrologicCondition,hydrologic_event:a.HydrologicEvent,
 collection_method_id:a["SampleCollectionMethod/MethodIdentifier"],collection_method_context:a["SampleCollectionMethod/MethodIdentifierContext"],sample_equipment:a.SampleCollectionEquipmentName,
 original_result_source:item.source,original_activity_source:activity.source,original_station_source:station.source,
 detection_limits:limits.map(l=>({type:l.original.DetectionQuantitationLimitTypeName,value:l.original["DetectionQuantitationLimitMeasure/MeasureValue"],unit:l.original["DetectionQuantitationLimitMeasure/MeasureUnitCode"],source:l.source}))
 });}
 const orphanLimits=sources.limit.filter(l=>!resultMap.has(id(l.original.OrganizationIdentifier,l.original.ActivityIdentifier,l.original.ResultIdentifier)));
 if(orphanLimits.length)throw Error("Original detection limits have no retained result");
 observations.sort((a,b)=>a.station_id.localeCompare(b.station_id)||a.date.localeCompare(b.date)||a.time.localeCompare(b.time)||a.result_id.localeCompare(b.result_id));
 const groupFields=["organization","station_id","characteristic","fraction","method_specification","method_id","method_context","analysis_unit","activity_type","media","media_subdivision","value_type","weight_basis","time_basis","temperature_basis","particle_size_basis"];
 const gm=new Map();for(const o of observations){const k=id(...groupFields.map(f=>o[f]));if(!gm.has(k))gm.set(k,[]);gm.get(k).push(o);}
 const groups=[...gm].map(([key,rr],i)=>{const vals=rr.filter(r=>!r.censored&&r.numeric_value!==null).map(r=>r.numeric_value);return{group_id:"series-"+String(i+1).padStart(4,"0"),...Object.fromEntries(groupFields.map(f=>[f,rr[0][f]])),records:rr.length,uncensored_numeric_count:vals.length,censored_count:rr.filter(r=>r.censored).length,nonnumeric_uncensored_count:rr.filter(r=>!r.censored&&r.numeric_value===null).length,first_date:rr[0].date,last_date:rr[rr.length-1].date,sampling_dates:new Set(rr.map(r=>r.date)).size,minimum:vals.length?Math.min(...vals):null,median:median(vals),maximum:vals.length?Math.max(...vals):null,quality_comment_records:rr.filter(r=>r.result_comment||r.activity_comment||r.laboratory_comment).length,quality_codes:counts(rr.flatMap(r=>r.quality_codes)),result_status:counts(rr.map(r=>r.status)),detection_limit_types:counts(rr.flatMap(r=>r.detection_limits.map(l=>l.type))),result_ids:rr.map(r=>r.result_id)};});
 const cm=new Map();for(const o of observations){const k=id(o.station_id,o.characteristic,o.year,o.month);if(!cm.has(k))cm.set(k,[]);cm.get(k).push(o);}
 const coverage=[...cm.values()].map(rr=>({station_id:rr[0].station_id,characteristic:rr[0].characteristic,year:rr[0].year,month:rr[0].month,season:rr[0].season,records:rr.length,sampling_dates:new Set(rr.map(r=>r.date)).size,censored:rr.filter(r=>r.censored).length,quality_comment_records:rr.filter(r=>r.result_comment||r.activity_comment||r.laboratory_comment).length,first_date:rr[0].date,last_date:rr[rr.length-1].date}));
 const stations=[...stationMap.values()].map(s=>{const r=s.original,rr=observations.filter(o=>o.organization===r.OrganizationIdentifier&&o.station_id===r.MonitoringLocationIdentifier);return{organization:r.OrganizationIdentifier,station_id:r.MonitoringLocationIdentifier,name:r.MonitoringLocationName,latitude:numeric(r.LatitudeMeasure),longitude:numeric(r.LongitudeMeasure),datum:r.HorizontalCoordinateReferenceSystemDatumName,huc8:r.HUCEightDigitCode,county:r.CountyCode,records:rr.length,characteristics:new Set(rr.map(o=>o.characteristic)).size,first_date:rr[0]?.date||null,last_date:rr[rr.length-1]?.date||null,source:s.source,original:r};});
 const thermal=observations.filter(o=>o.station_id==="21NC03WQ-H6000000"&&o.characteristic==="Temperature, water"&&o.original_unit==="deg C"&&o.media==="Water"&&!o.censored&&o.numeric_value!==null);
 const thermalWindows=["2008–2015","2016–2020","2021–2025"].map(period=>{const rr=thermal.filter(r=>r.window===period),byDate=new Map();for(const o of rr){if(!byDate.has(o.date))byDate.set(o.date,[]);byDate.get(o.date).push(o);}const commentFree=rr.filter(r=>!r.result_comment&&!r.activity_comment&&!r.laboratory_comment&&!r.qualifier);const withoutCodedQualification=rr.filter(r=>!r.qualifier&&!r.quality_codes.length);return{period,records:rr.length,sampling_dates:byDate.size,above_20_count:rr.filter(r=>r.numeric_value>20).length,dates_with_any_above_20:[...byDate.values()].filter(rows=>rows.some(r=>r.numeric_value>20)).length,exactly_20_count:rr.filter(r=>r.numeric_value===20).length,maximum:rr.length?Math.max(...rr.map(r=>r.numeric_value)):null,monthly_records:counts(rr.map(r=>String(r.month).padStart(2,"0"))),summer_records:rr.filter(r=>r.month>=6&&r.month<=8).length,commented_or_qualified_records:rr.length-commentFree.length,comment_free_records:commentFree.length,comment_free_above_20:commentFree.filter(r=>r.numeric_value>20).length,coded_qualification_records:rr.length-withoutCodedQualification.length,without_coded_qualification_records:withoutCodedQualification.length,without_coded_qualification_above_20:withoutCodedQualification.filter(r=>r.numeric_value>20).length,duplicate_sampling_dates:[...byDate].filter(([d,v])=>v.length>1).map(([date,rows])=>({date,readings:rows.map(r=>({time:r.time,time_zone:r.time_zone,value:r.numeric_value,result_id:r.result_id,source:r.original_result_source}))}))};});
 const referencedActivities=new Set(observations.map(o=>id(o.organization,o.activity_id)));
 const summary={schema:SCHEMA,captured_at:provenance.captured_at,original_files:sourceInventory.length,original_result_rows:observations.length,original_activity_rows:sources.activity.length,original_limit_rows:sources.limit.length,original_station_rows:sources.station.length,distinct_results:resultMap.size,distinct_activities:activityMap.size,unreferenced_activity_rows:sources.activity.filter(a=>!referencedActivities.has(id(a.original.OrganizationIdentifier,a.original.ActivityIdentifier))).length,
 censored_results:observations.filter(o=>o.censored).length,censored_without_limit:observations.filter(o=>o.censored&&!o.detection_limits.length).length,multiple_limit_results:observations.filter(o=>o.detection_limits.length>1).length,
 distinct_characteristics:new Set(observations.map(o=>o.characteristic)).size,comparison_groups:groups.length,quality_comment_results:observations.filter(r=>r.result_comment||r.activity_comment||r.laboratory_comment).length,quality_codes:counts(observations.flatMap(r=>r.quality_codes)),stations:stations.map(({original,...s})=>s),horsepasture_temperature_windows:thermalWindows,
 interpretation:["Original organization, station, activity and result identities remain qualified and independently retained.","Comparison groups keep original characteristic, fraction, analytical method, method specification, unit, media and basis separate.","Censored records retain every original detection/quantitation limit. No zero, half-limit or full-limit substitution is used.","Numeric summaries describe uncensored numeric results within each exact comparison group; all commented records remain visible.","Thermal counts are a source screen against the published 20°C trout-temperature criterion. Uneven grab sampling and differing sample dates do not establish a temperature trend or an official assessment category.","Original same-day readings retain separate result identities and times. Date-level thermal counts are reported alongside record-level counts.","The 2016–2020 assessment window and 2021–2025 subsequent evidence are separate. Original station metadata and measurement-bearing station cohorts are counted independently.","A station source cohort is not automatically the selected project geography. Import the original NAD83 station points and intersect the selected study domain before assigning membership."]};
 const quality=observations.filter(r=>r.censored||r.qualifier||r.result_comment||r.activity_comment||r.laboratory_comment).map(r=>({station_id:r.station_id,result_id:r.result_id,date:r.date,characteristic:r.characteristic,original_value:r.original_value,original_unit:r.original_unit,detection_condition:r.detection_condition,qualifier:r.qualifier,quality_codes:r.quality_codes,result_comment:r.result_comment,laboratory_comment:r.laboratory_comment,activity_comment:r.activity_comment,detection_limits:r.detection_limits,original_result_source:r.original_result_source}));
 const files={};files[BASE+"observations.json"]=json({schema:SCHEMA,interpretation:summary.interpretation,rows:observations});
 files[BASE+"observations.csv"]=csvOutput(observations,Object.keys(observations[0]||{}));
 files[BASE+"comparison-groups.json"]=json(groups);files[BASE+"comparison-groups.csv"]=csvOutput(groups.filter(()=>true).map(({result_ids,...r})=>r),Object.keys(groups[0]||{}).filter(k=>k!=="result_ids"));
 files[BASE+"sampling-coverage.csv"]=csvOutput(coverage,Object.keys(coverage[0]||{}));files[BASE+"quality-and-detection-review.csv"]=csvOutput(quality,Object.keys(quality[0]||{}));
 files[BASE+"thermal-screen.csv"]=csvOutput(thermal,["station_id","result_id","date","time","time_zone","numeric_value","original_unit","window","month","season","result_comment","quality_codes","original_result_source","original_activity_source"]);
 files[BASE+"summary.json"]=json(summary);files[BASE+"source-inventory.json"]=json(sourceInventory);
 files[BASE+"stations.geojson"]=json({type:"FeatureCollection",name:"Original NC ambient station coordinates",crs:{type:"name",properties:{name:"EPSG:4269"}},features:stations.map(s=>{if(s.datum!=="NAD83"||s.latitude===null||s.longitude===null)throw Error("Station requires explicit original CRS handling");return{type:"Feature",id:s.station_id,geometry:{type:"Point",coordinates:[s.longitude,s.latitude]},properties:{...s,original:undefined}};})});

 const sourceReview=observations.filter(r=>r.characteristic==="Dissolved oxygen (DO)"&&r.original_unit==="mg/L"&&r.numeric_value!==null&&r.numeric_value>30).map(r=>({station_id:r.station_id,result_id:r.result_id,date:r.date,time:r.time,characteristic:r.characteristic,original_value:r.original_value,original_unit:r.original_unit,review_reason:"Reported dissolved-oxygen value exceeds the 30 mg/L source-review trigger; investigate original value/unit mapping before quantitative use.",interpretation:"Source-review trigger selected for this analysis, not an ambient water-quality criterion. Original value and unit are unchanged; no saturation-to-concentration conversion is made.",original_result_source:r.original_result_source,original_activity_source:r.original_activity_source}));
 const screens=[];
 for(const station of stations.filter(s=>s.records))for(const period of ["2008–2015","2016–2020","2021–2025"])for(const spec of [{characteristic:"Temperature, water",unit:"deg C",criterion:20,direction:"above"},{characteristic:"Dissolved oxygen (DO)",unit:"mg/L",criterion:6,direction:"below"},{characteristic:"Turbidity",unit:"NTU",criterion:10,direction:"above"}]){
   const rr=observations.filter(r=>r.station_id===station.station_id&&r.window===period&&r.characteristic===spec.characteristic),numericRows=rr.filter(r=>r.original_unit===spec.unit&&!r.censored&&r.numeric_value!==null);
   if(!rr.length)continue;
   const exceed=numericRows.filter(r=>spec.direction==="above"?r.numeric_value>spec.criterion:r.numeric_value<spec.criterion);
   screens.push({station_id:station.station_id,period,...spec,original_records:rr.length,uncensored_numeric_matching_unit:numericRows.length,censored_results:rr.filter(r=>r.censored).length,screen_hits:exceed.length,hit_dates:new Set(exceed.map(r=>r.date)).size,hit_result_ids:exceed.map(r=>r.result_id),coded_qualification_records:numericRows.filter(r=>r.qualifier||r.quality_codes.length).length,source_value_review_records:numericRows.filter(r=>sourceReview.some(s=>s.result_id===r.result_id&&s.station_id===r.station_id)).length});
 }
 const microbialSupport=stations.filter(s=>s.records).map(station=>{
   const rr=observations.filter(r=>r.station_id===station.station_id&&r.characteristic==="Fecal Coliform"&&r.media==="Water");
   let maximum=0,example=[];for(let i=0,j=0;i<rr.length;i++){const start=Date.parse(rr[i].date+"T00:00:00Z");if(j<i)j=i;while(j<rr.length&&Date.parse(rr[j].date+"T00:00:00Z")<start+30*86400000)j++;if(j-i>maximum){maximum=j-i;example=rr.slice(i,j).map(r=>({date:r.date,result_id:r.result_id}));}}
   return{station_id:station.station_id,characteristic:"Fecal Coliform",total_records:rr.length,censored_records:rr.filter(r=>r.censored).length,maximum_records_in_30_calendar_days:maximum,example_window:example,consecutive_samples_required_by_referenced_criterion:5,records_above_400_with_matching_units:rr.filter(r=>!r.censored&&r.original_unit==="cfu/100mL"&&r.numeric_value>400).map(r=>({result_id:r.result_id,date:r.date,value:r.numeric_value,original_unit:r.original_unit,quality_codes:r.quality_codes,result_comment:r.result_comment,source:r.original_result_source})),interpretation:"Calendar windows include the starting date through its next 29 dates. Published holding-time and other comments remain attached. Sampling-frequency support is distinct from computing a recreational assessment."};
 });
 summary.source_value_review_records=sourceReview.length;summary.criterion_screens=screens;summary.microbial_sampling_support=microbialSupport;
 files[BASE+"source-value-review.csv"]=csvOutput(sourceReview,["station_id","result_id","date","time","characteristic","original_value","original_unit","review_reason","interpretation","original_result_source","original_activity_source"]);
 files[BASE+"criterion-screens.csv"]=csvOutput(screens,Object.keys(screens[0]||{}));files[BASE+"microbial-sampling-support.json"]=json(microbialSupport);files[BASE+"summary.json"]=json(summary);

 return{summary,observations,groups,coverage,thermal,stations,sourceInventory,sourceReview,screens,microbialSupport,files};
}
