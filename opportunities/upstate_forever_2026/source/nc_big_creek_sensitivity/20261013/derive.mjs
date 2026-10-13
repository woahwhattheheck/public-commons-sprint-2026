/** Original Big Creek analytical support; source data and quality-control roles remain explicit. */
export const BASE="source/nc_big_creek_sensitivity/20261013/";
export const SCHEMA="upstate.nc-big-creek-sensitivity/v1";
export const GROUP_FIELDS=["organization","station_id","characteristic","fraction","method_specification","method_id","method_context","analysis_unit","activity_type","media","media_subdivision","value_type","weight_basis","time_basis","temperature_basis","particle_size_basis"];
export function csv(text){const rows=[];let row=[],field="",quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(!quoted&&(c===","||c==="\n"||c==="\r")){row.push(field);field="";if(c!==","){if(c==="\r"&&text[i+1]==="\n")i++;rows.push(row);row=[];}}else field+=c;}if(quoted)throw Error("Unclosed source quote");if(field||row.length){row.push(field);rows.push(row);}if(rows[0]?.[0])rows[0][0]=rows[0][0].replace(/^\uFEFF/,"");return rows;}
export function csvOutput(rows,columns){const enc=v=>v==null?"":typeof v==="object"?JSON.stringify(v):String(v);return[columns,...rows.map(r=>columns.map(c=>enc(r[c])))].map(r=>r.map(v=>/[",\r\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v).join(",")).join("\n")+"\n";}
const json=v=>JSON.stringify(v,null,2)+"\n";
const numeric=v=>typeof v==="string"&&v.trim()!==""&&/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(v.trim())&&Number.isFinite(Number(v))?Number(v):null;
const counts=values=>Object.fromEntries([...values.reduce((a,v)=>(a.set(v,(a.get(v)||0)+1),a),new Map())].sort(([a],[b])=>String(a).localeCompare(String(b))));
const key=(...p)=>JSON.stringify(p);
function records(path,body){const a=csv(body);if(!a[0]?.length||new Set(a[0]).size!==a[0].length)throw Error("Missing or duplicate source columns: "+path);return a.slice(1).filter(r=>r.length!==1||r[0]!=="").map((r,i)=>{if(r.length!==a[0].length)throw Error("Source width differs: "+path+":"+(i+2));return{original:Object.fromEntries(a[0].map((h,j)=>[h,r[j]])),source:{path,row:i+2}};});}
export function unitFactor(unit,target){if(unit===target)return 1;if(target==="ug/L")return({"mg/L":1000,"ug/L":1,"µg/L":1,"μg/L":1,"ng/L":0.001})[unit]??null;return null;}
const role=type=>type==="Sample-Routine"?"routine_environmental":type==="Field Msr/Obs"?"field_observation":type==="Quality Control Sample-Field Replicate"?"field_replicate":type==="Quality Control Sample-Equipment Blank"?"equipment_blank":type==="Quality Control Sample-Field Blank"?"field_blank":"other_original_activity";
export const REFERENCES=[
 {id:"arsenic-hh-legacy",characteristic:"Arsenic",value:10,unit:"ug/L",assessment_id:10651,kind:"legacy_assessment_label"},
 {id:"arsenic-al-legacy",characteristic:"Arsenic",value:50,unit:"ug/L",assessment_id:10658,kind:"legacy_assessment_label"},
 {id:"beryllium-legacy",characteristic:"Beryllium",value:6.5,unit:"ug/L",assessment_id:10652,kind:"legacy_assessment_label"},
 {id:"cadmium-legacy",characteristic:"Cadmium",value:0.4,unit:"ug/L",assessment_id:10656,kind:"legacy_assessment_label"},
 {id:"copper-legacy",characteristic:"Copper",value:7,unit:"ug/L",assessment_id:10657,kind:"legacy_assessment_label"},
 {id:"lead-legacy",characteristic:"Lead",value:25,unit:"ug/L",assessment_id:10650,kind:"legacy_assessment_label"},
 {id:"mercury-legacy",characteristic:"Mercury",value:0.012,unit:"ug/L",assessment_id:10653,kind:"legacy_assessment_label"},
 {id:"nickel-legacy",characteristic:"Nickel",value:88,unit:"ug/L",assessment_id:10655,kind:"legacy_assessment_label"},
 {id:"zinc-legacy",characteristic:"Zinc",value:50,unit:"ug/L",assessment_id:10654,kind:"legacy_assessment_label"},
 {id:"cyanide-2022-methodology",characteristic:"Cyanide",value:5,unit:"ug/L",assessment_id:10673,kind:"published_2022_methodology",reference_uri:"https://www.deq.nc.gov/water-quality/planning/tmdl/303d/2022/2022-303d-listing-methodology-final/download",printed_page:6},
 {id:"turbidity-trout-legacy",characteristic:"Turbidity",value:10,unit:"NTU",assessment_id:10661,kind:"legacy_assessment_label"}
];
export function derive(originals,provenance){
 const observations=[],sourceInventory=[],seen=new Set();
 for(const cap of provenance.files.filter(x=>x.path.endsWith("-wqx3-fullphyschem.csv"))){
  const parsed=records(cap.path,originals[cap.path]);sourceInventory.push({...cap,original_rows:parsed.length});
  for(const {original:r,source} of parsed){
   if(r.Location_Identifier!=="21NC03WQ-H3200000"||r.Org_Identifier!=="21NC03WQ")throw Error("Original station differs");
   if(!r.Result_MeasureIdentifier||!r.Activity_ActivityIdentifier)throw Error("Original identity absent");
   const identity=key(r.Org_Identifier,r.Result_MeasureIdentifier);if(seen.has(identity))throw Error("Repeated result across selected captures: "+identity);seen.add(identity);
   const limits=["A","B"].filter(s=>r["DetectionLimit_Type"+s]||r["DetectionLimit_Measure"+s]||r["DetectionLimit_MeasureUnit"+s]).map(s=>({type:r["DetectionLimit_Type"+s],value:r["DetectionLimit_Measure"+s],original_value:r["DetectionLimit_Measure"+s],numeric_value:numeric(r["DetectionLimit_Measure"+s]),unit:r["DetectionLimit_MeasureUnit"+s],comment:r["DetectionLimit_Comment"+s],source:{...source,original_column_suffix:s}}));
   const comments=[r.DataQuality_ResultComment,r.LabInfo_LaboratoryComment,r.Activity_Comment].join("\n");
   const codes=[...new Set((comments.match(/\b(?:[BJQUZ][0-9]+|U)\b/g)||[]))].sort();
   const month=Number(r.Activity_StartDate.slice(5,7));
   const analysisUnit=r.Result_MeasureUnit||([...new Set(limits.map(l=>l.unit).filter(Boolean))].length===1?limits.find(l=>l.unit).unit:"");
   const o={organization:r.Org_Identifier,station_id:r.Location_Identifier,activity_id:r.Activity_ActivityIdentifier,result_id:r.Result_MeasureIdentifier,date:r.Activity_StartDate,time:r.Activity_StartTime,time_zone:r.Activity_StartTimeZone,year:Number(r.Activity_StartDate.slice(0,4)),month,season:month===12||month<=2?"DJF":month<=5?"MAM":month<=8?"JJA":"SON",window:"Original 2011–2012 collection",characteristic:r.Result_Characteristic,fraction:r.Result_SampleFraction,method_specification:r.Result_MethodSpeciation,method_id:r.ResultAnalyticalMethod_Identifier,method_context:r.ResultAnalyticalMethod_IdentifierContext,method_name:r.ResultAnalyticalMethod_Name,original_value:r.Result_Measure,numeric_value:numeric(r.Result_Measure),original_unit:r.Result_MeasureUnit,analysis_unit:analysisUnit,analysis_unit_basis:r.Result_MeasureUnit?"original_result":analysisUnit?"original_detection_limit":"unspecified",detection_condition:r.Result_ResultDetectionCondition,censored:r.Result_ResultDetectionCondition==="Not Detected",observation_status:r.Result_ResultDetectionCondition||"Reported numerical result",qualifier:r.Result_MeasureQualifierCode,status:r.Result_MeasureStatusIdentifier,value_type:r.Result_MeasureType,weight_basis:r.Result_WeightBasis,time_basis:r.Result_TimeBasis,temperature_basis:r.Result_MeasureTemperatureBasis,particle_size_basis:r.Result_MeasureParticleSizeBasis,result_comment:r.DataQuality_ResultComment,laboratory_comment:r.LabInfo_LaboratoryComment,activity_comment:r.Activity_Comment,quality_codes:codes,activity_type:r.Activity_TypeCode,sample_role:role(r.Activity_TypeCode),media:r.Activity_Media,media_subdivision:r.Activity_MediaSubdivision,activity_depth:r.Activity_DepthHeightMeasure,activity_depth_unit:r.Activity_DepthHeightMeasureUnit,hydrologic_condition:r.Activity_HydrologicCondition,hydrologic_event:r.Activity_HydrologicEvent,collection_method_id:r.SampleCollectionMethod_Identifier,collection_method_context:r.SampleCollectionMethod_IdentifierContext,sample_equipment:r.SampleCollectionMethod_EquipmentName,original_result_source:source,original_activity_source:source,original_station_source:{path:BASE+"original/big-creek-station-original.csv",row:2},detection_limits:limits,source_profile:"WQX3 fullPhysChem",provider:r.ProviderName,publisher_last_change:r.LastChangeDate};
   if(o.date<"2011-01-01"||o.date>"2012-12-31")throw Error("A captured date changes the stated source edition");
   observations.push(o);
  }
 }
 observations.sort((a,b)=>[a.date,a.time,a.result_id].join("|").localeCompare([b.date,b.time,b.result_id].join("|")));
 const byGroup=new Map();
 for(const o of observations){const k=JSON.stringify(GROUP_FIELDS.map(f=>o[f]??""));if(!byGroup.has(k))byGroup.set(k,[]);byGroup.get(k).push(o);}
 const groups=[...byGroup].map(([k,rs],i)=>{
  const ns=rs.filter(r=>!r.censored&&r.numeric_value!==null).map(r=>r.numeric_value),limits=rs.flatMap(r=>r.detection_limits.filter(l=>l.numeric_value!==null).map(l=>({value:l.numeric_value,unit:l.unit,type:l.type})));
  return{id:"G"+String(i+1).padStart(3,"0"),fields:Object.fromEntries(GROUP_FIELDS.map((f,j)=>[f,JSON.parse(k)[j]])),sample_role:rs[0].sample_role,records:rs.length,distinct_activities:new Set(rs.map(r=>r.activity_id)).size,sampling_dates:new Set(rs.map(r=>r.date)).size,numeric_records:ns.length,censored_records:rs.filter(r=>r.censored).length,numeric_min:ns.length?Math.min(...ns):null,numeric_max:ns.length?Math.max(...ns):null,reporting_limits:[...new Map(limits.map(l=>[JSON.stringify(l),l])).values()],original_result_ids:rs.map(r=>r.result_id)};
 });
 const rawAssessment=JSON.parse(originals[BASE+"original/ncdeq-final2022-table4-selected-parameters-original.json"]);
 const assessment=rawAssessment.features.map(f=>f.attributes).filter(r=>r.AU_ID===10475);
 if(assessment.length!==42)throw Error("The complete original Big Creek parameter roster changed");
 const refs=REFERENCES.map(ref=>{const row=assessment.find(x=>x.ASMT_ID===ref.assessment_id);if(!row)throw Error("Missing reference source");return{...ref,original_assessment:{...row},reference_source:{path:BASE+"original/ncdeq-final2022-table4-selected-parameters-original.json",OBJECTID:row.OBJECTID,ASMT_ID:row.ASMT_ID}};});
 const sensitivity=[];
 for(const ref of refs)for(const g of groups.filter(g=>g.fields.characteristic===ref.characteristic&&g.sample_role==="routine_environmental")){
  const rs=g.original_result_ids.map(id=>observations.find(r=>r.result_id===id));let numericBelow=0,numericAbove=0,atReference=0,limitBelow=0,limitAt=0,limitAbove=0,unknown=0;
  const comparisons=rs.map(r=>{let state="unresolved_source_support",value=null,limit=null,unit=null,factor=null;
   if(!r.censored&&r.numeric_value!==null){factor=unitFactor(r.original_unit,ref.unit);if(factor!==null){value=r.numeric_value*factor;state=value>ref.value?"numeric_above":value===ref.value?"numeric_at":"numeric_below";if(value>ref.value)numericAbove++;else if(value===ref.value)atReference++;else numericBelow++;}else unknown++;}
   else if(r.censored&&r.detection_condition==="Not Detected"){
    const eligible=r.detection_limits.filter(l=>l.numeric_value!==null&&unitFactor(l.unit,ref.unit)!==null);
    if(eligible.length===1){const l=eligible[0];factor=unitFactor(l.unit,ref.unit);limit=l.numeric_value*factor;unit=l.unit;state=limit>ref.value?"limit_above_reference":limit===ref.value?"limit_at_reference":"limit_below_reference";if(limit>ref.value)limitAbove++;else if(limit===ref.value)limitAt++;else limitBelow++;}
    else unknown++;
   }else unknown++;
   return{result_id:r.result_id,date:r.date,activity_id:r.activity_id,state,numeric_value_in_reference_unit:value,reporting_limit_in_reference_unit:limit,original_limit_unit:unit,unit_factor:factor,reference_value:ref.value,reference_unit:ref.unit,quality_codes:r.quality_codes,source:r.original_result_source};
  });
  const ls=comparisons.map(r=>r.reporting_limit_in_reference_unit).filter(v=>v!==null),ns=comparisons.map(r=>r.numeric_value_in_reference_unit).filter(v=>v!==null);
  sensitivity.push({reference_id:ref.id,reference_kind:ref.kind,characteristic:ref.characteristic,group_id:g.id,sample_role:g.sample_role,fraction:g.fields.fraction||"Publisher unspecified",media_subdivision:g.fields.media_subdivision||"Publisher unspecified",method_id:g.fields.method_id||"Publisher unspecified",records:rs.length,sampling_dates:g.sampling_dates,reference_value:ref.value,reference_unit:ref.unit,numeric_below:numericBelow,numeric_at:atReference,numeric_above:numericAbove,censored_limit_below:limitBelow,censored_limit_at:limitAt,censored_limit_above:limitAbove,unresolved:unknown,limit_min:ls.length?Math.min(...ls):null,limit_max:ls.length?Math.max(...ls):null,maximum_numeric:ns.length?Math.max(...ns):null,comparison_rows:comparisons});
 }
 const qc=observations.filter(r=>["field_replicate","equipment_blank","field_blank"].includes(r.sample_role));
 const dates=observations.map(r=>r.date).sort(),roles=counts(observations.map(r=>r.sample_role));
 const summary={schema:SCHEMA,captured_at:provenance.captured_at,station_id:"21NC03WQ-H3200000",original_result_rows:observations.length,original_files:sourceInventory.length,original_characteristics:[...new Set(observations.map(r=>r.characteristic))].sort(),activity_roles:roles,exact_comparison_groups:groups.length,distinct_activity_ids:new Set(observations.map(r=>r.activity_id)).size,first_date:dates[0],last_date:dates.at(-1),sampling_dates:new Set(dates).size,numeric_results:observations.filter(r=>!r.censored&&r.numeric_value!==null).length,censored_results:observations.filter(r=>r.censored).length,other_detection_conditions:counts(observations.filter(r=>r.detection_condition&&!r.censored).map(r=>r.detection_condition)),original_method_unspecified:observations.filter(r=>!r.method_id).length,quality_codes:counts(observations.flatMap(r=>r.quality_codes)),routine_sampling_dates:new Set(observations.filter(r=>r.sample_role==="routine_environmental").map(r=>r.date)).size};
 const coverage=[...new Set(observations.map(r=>r.characteristic))].sort().flatMap(characteristic=>["routine_environmental","field_replicate","equipment_blank","field_blank"].map(sample_role=>{const rs=observations.filter(r=>r.characteristic===characteristic&&r.sample_role===sample_role);return{characteristic,sample_role,records:rs.length,activities:new Set(rs.map(r=>r.activity_id)).size,sampling_dates:new Set(rs.map(r=>r.date)).size,censored:rs.filter(r=>r.censored).length,month_counts:counts(rs.map(r=>r.date.slice(0,7)))};}));
 const files={};files[BASE+"observations.json"]=json({schema:SCHEMA,scope:provenance.scope,rows:observations});
 files[BASE+"observations.csv"]=csvOutput(observations,Object.keys(observations[0]));
 files[BASE+"summary.json"]=json(summary);files[BASE+"comparison-groups.json"]=json(groups);
 files[BASE+"comparison-groups.csv"]=csvOutput(groups.map(g=>({...g,...g.fields})),["id",...GROUP_FIELDS,"sample_role","records","distinct_activities","sampling_dates","numeric_records","censored_records","numeric_min","numeric_max","reporting_limits","original_result_ids"]);
 files[BASE+"sampling-coverage.csv"]=csvOutput(coverage,Object.keys(coverage[0]));
 files[BASE+"reference-comparisons.json"]=json({schema:"upstate.nc-big-creek-reference-support/v1",references:refs,groups:sensitivity});
 files[BASE+"reference-comparisons.csv"]=csvOutput(sensitivity,Object.keys(sensitivity[0]).filter(k=>k!=="comparison_rows"));
 files[BASE+"quality-control-records.csv"]=csvOutput(qc,Object.keys(observations[0]));
 files[BASE+"source-inventory.json"]=json(sourceInventory);
 return{summary,observations,groups,sensitivity,coverage,references:refs,qualityControl:qc,sourceInventory,files};
}
