// Join retained EPA history with the existing 2023 science calculator and DES geometry.
// All amounts and source identities remain attributable to their original method.
const INPUT_PATHS = {
  "echo_measurements": "source/echo_dmr/20261013/tables/dmr_measurements_2023.csv",
  "echo_periods_2023": "source/echo_dmr/20261013/tables/dmr_loads_monitoring_period_2023.csv",
  "echo_history_periods": "source/echo_dmr/20261013/tables/dmr_loads_monitoring_period_history_2007_2026.csv",
  "echo_annual_n": "source/echo_dmr/20261013/tables/dmr_annual_history_2007_2026.csv",
  "echo_annual_y": "source/echo_dmr/20261013/tables/dmr_annual_estimation_history_2007_2026.csv",
  "echo_history_context": "source/echo_dmr/20261013/tables/dmr_annual_period_history_context.csv",
  "echo_manifest": "source/echo_dmr/20261013/sources.json",
  "echo_capture": "source/echo_dmr/20261013/capture-manifest.json",
  "science_records": "observations/eighteenmile_2023/npdes/dmr_records.csv",
  "science_periods": "observations/eighteenmile_2023/npdes/derived/period_loads.csv",
  "science_annual": "observations/eighteenmile_2023/npdes/derived/annual_loads.csv",
  "science_summary": "observations/eighteenmile_2023/npdes/derived/summary.json",
  "science_capture": "observations/eighteenmile_2023/npdes/capture.json",
  "state_features": "observations/eighteenmile_2023/npdes/originals/des_four_npdes_outfall_features.json",
  "state_metadata": "observations/eighteenmile_2023/npdes/originals/des_npdes_layer21_metadata.json",
  "science_map": "observations/eighteenmile_2023/npdes/dmr_outfalls_2023.geojson",
  "science_map_manifest": "observations/eighteenmile_2023/npdes/model-sources.json",
  "science_map_capture": "observations/eighteenmile_2023/npdes/map-layer-capture.json"
};
const OUT_ROOT = "source/point_source_context/20261013";
function parseCsv(text) {
  text=String(text).replace(/^\uFEFF/,"");
  const records=[]; let row=[], field="", quote=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quote){
      if(c==='"'&&text[i+1]==='"'){field+='"';i++;}
      else if(c==='"')quote=false;
      else field+=c;
    }else if(c==='"'&&field==="")quote=true;
    else if(c===','){row.push(field);field="";}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(v=>v!==""))records.push(row);row=[];field="";}
    else field+=c;
  }
  if(quote)throw new Error("Unterminated CSV field");
  if(field!==""||row.length){row.push(field);records.push(row);}
  if(!records.length)return [];
  const headers=records.shift();
  if(new Set(headers).size!==headers.length)throw new Error("Duplicate CSV headers");
  return records.map((r,i)=>{if(r.length!==headers.length)throw new Error("CSV column count at record "+(i+2));return Object.fromEntries(headers.map((k,j)=>[k,r[j]]));});
}
function csvString(rows) {
  const fields=[...new Set(rows.flatMap(r=>Object.keys(r)))];
  const q=v=>{if(v===null||v===undefined)return "";const s=typeof v==="object"?JSON.stringify(v):String(v);return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
  return fields.map(q).join(",")+"\n"+rows.map(r=>fields.map(k=>q(r[k])).join(",")).join("\n")+"\n";
}
function text(v){return v===null||v===undefined?"":String(v);}
function array(v){return Array.isArray(v)?v:JSON.parse(v||"[]");}
function unique(a){return [...new Set(a.filter(v=>v!==null&&v!==undefined&&v!==""))];}
function operator(v){return text(v).replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&#60;/g,"<").replace(/&#62;/g,">").replace(/&amp;/g,"&");}
function dec(v){
  const s=text(v).replace(/,/g,"").trim();
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s))return null;
  const negative=s[0]==="-",unsigned=s.replace(/^[+-]/,""),p=unsigned.split("."),scale=(p[1]||"").length;
  return {n:BigInt((p[0]||"0")+(p[1]||""))*(negative?-1n:1n),scale};
}
function decimalText(d){
  if(!d)return null;let s=(d.n<0n?-d.n:d.n).toString().padStart(d.scale+1,"0");
  if(d.scale)s=s.slice(0,-d.scale)+"."+s.slice(-d.scale);
  s=s.replace(/(\.\d*?)0+$/,"$1").replace(/\.$/,"");
  return (d.n<0n?"-":"")+s;
}
function difference(a,b){
  a=dec(a);b=dec(b);if(!a||!b)return null;
  const scale=Math.max(a.scale,b.scale);
  return decimalText({n:a.n*10n**BigInt(scale-a.scale)-b.n*10n**BigInt(scale-b.scale),scale});
}
function sum(values){
  const items=values.map(dec);if(items.some(d=>!d))return null;
  const scale=Math.max(0,...items.map(d=>d.scale));
  return decimalText({n:items.reduce((a,d)=>a+d.n*10n**BigInt(scale-d.scale),0n),scale});
}
function inclusiveEnd(exclusive){
  const d=new Date(exclusive+"T00:00:00Z");if(!Number.isFinite(d.getTime()))throw Error("Invalid source period end "+exclusive);
  return new Date(d.getTime()-86400000).toISOString().slice(0,10);
}
function periodKey(r){return [r.ExternalPermitNmbr,r.PermFeatureNmbr,r.ParameterCode,r.MonitoringLocationCode,r.period_end_iso].join("|");}
function seriesKey(r){return [r.ExternalPermitNmbr,r.PermFeatureNmbr,r.ParameterCode,r.MonitoringLocationCode].join("|");}
function index(rows,key){const m=new Map();for(const row of rows){const k=key(row);if(!m.has(k))m.set(k,[]);m.get(k).push(row);}return m;}
function one(m,key,label){const a=m.get(key)||[];if(a.length!==1)throw Error(label+" requires one original record: "+key+" ("+a.length+")");return a[0];}
function sourcePointer(r){return {source_response_id:r.source_response_id,source_json_pointer:r.source_json_pointer,source_uri:r.source_uri};}
function displayStep(v){const d=dec(v);return d?decimalText({n:1n,scale:d.scale}):null;}
function geometryJoin(features,permit){
  const matches=features.filter(f=>f.attributes.PrmtPrmtNum===permit);
  if(matches.length!==1)throw Error("State mapped permit identity is not unique: "+permit);
  const f=matches[0],a=f.attributes;
  return {state_objectid:a.OBJECTID,state_permit_id:a.PrmtPrmtNum,state_mapped_outfall:a.FeatrFeatrId,
    state_feature_status:a.FeatrRefFeatrStat,state_geometry_crs:"EPSG:26917",state_geometry_x:f.geometry.x,state_geometry_y:f.geometry.y,
    state_coordinate_method:a.FeatrColctnMethdDescr,state_location_verified:a.FeatrLocVrfd,
    state_geometry_source_path:INPUT_PATHS.state_features,geometry_join:"exact permit ID; original reporting feature retained"};
}
function buildCohort(inputs){
  for(const key of Object.keys(INPUT_PATHS))if(typeof inputs[key]!=="string")throw Error("Missing retained input "+key);
  const echo=parseCsv(inputs.echo_measurements),science=parseCsv(inputs.science_records),
    periods=parseCsv(inputs.science_periods),annual=parseCsv(inputs.science_annual),
    epaPeriods=parseCsv(inputs.echo_periods_2023),history=parseCsv(inputs.echo_history_periods),
    annualN=parseCsv(inputs.echo_annual_n),annualY=parseCsv(inputs.echo_annual_y),
    historyContext=parseCsv(inputs.echo_history_context),state=JSON.parse(inputs.state_features),
    scienceSummary=JSON.parse(inputs.science_summary),scienceCapture=JSON.parse(inputs.science_capture),
    echoCapture=JSON.parse(inputs.echo_capture);
  if(state.geometryType!=="esriGeometryPoint"||state.spatialReference.wkid!==26917)throw Error("Expected original DES point CRS");
  const byDmr=index(echo,r=>r.DMRValueId),byScience=index(science,r=>r.DMRValueId);
  if(byDmr.size!==echo.length||byScience.size!==science.length)throw Error("DMR value identity repeats in an input edition");
  const byPeriod=index(epaPeriods,periodKey),byYear=index(historyContext,r=>r.reporting_year+"|"+seriesKey(r));
  const selected=new Map(),candidates=new Map();
  for(const p of periods){
    for(const id of array(p.all_average_candidate_ids)){if(!candidates.has(id))candidates.set(id,[]);candidates.get(id).push(p.series_id);}
    for(const id of array(p.selected_dmr_value_ids)){if(!selected.has(id))selected.set(id,[]);selected.get(id).push(p.series_id);}
  }
  const mapped={source_id:"SourceId",registry_id:"RegistryId",reporting_outfall:"PermFeatureNmbr",reporting_outfall_type:"PermFeatureTypeCode",parameter_code:"ParameterCode",parameter_name:"ParameterDesc",monitoring_location_code:"MonitoringLocationCode",monitoring_location_name:"MonitoringLocationDesc",parameter_stay_type_code:"StayTypeCode",parameter_stay_type_description:"StayTypeDesc"};
  let entityEquivalentFields=0;const substantiveVariants=[];
  for(const s of science){
    const r=one(byDmr,s.DMRValueId,"Full 2023 source");
    for(const field of Object.keys(s)){
      if(field==="source_path"||field==="source_sha256")continue;
      const counterpart=mapped[field]||field,a=text(s[field]),b=text(r[counterpart]);
      if(a===b)continue;
      if(/QualifierCode$/.test(field)&&operator(a)===operator(b)){entityEquivalentFields++;continue;}
      substantiveVariants.push({DMRValueId:s.DMRValueId,field,science_value:a,full_source_value:b});
    }
  }
  for(const id of selected.keys())one(byDmr,id,"Selected reported quantity");
  const measurements=echo.map(r=>{
    const s=(byScience.get(r.DMRValueId)||[])[0],variants=substantiveVariants.filter(v=>v.DMRValueId===r.DMRValueId);
    return {...r,dmr_qualifier_operator:operator(r.DMRValueQualifierCode),limit_qualifier_operator:operator(r.LimitValueQualifierCode),
      science_subset:s?"present":"outside twenty target series",science_source_path:s?s.source_path:null,
      science_source_sha256:s?s.source_sha256:null,science_original_dmr_qualifier:s?s.DMRValueQualifierCode:null,
      science_original_limit_qualifier:s?s.LimitValueQualifierCode:null,
      science_selected_quantity:selected.has(r.DMRValueId),science_selected_series:unique(selected.get(r.DMRValueId)||[]),
      science_average_candidate_series:unique(candidates.get(r.DMRValueId)||[]),source_field_variants:variants};
  });
  const comparisons=periods.map(p=>{
    const end=inclusiveEnd(p.period_end_exclusive),k=[p.permit_id,p.reporting_feature,p.parameter_code,p.monitoring_location,end].join("|"),
      matches=byPeriod.get(k)||[],mass=p.amount_unit==="kg",e=matches.length===1?matches[0]:null,
      originalQuantities=array(p.selected_dmr_value_ids).map(id=>one(byDmr,id,"Selected source quantity")),
      flowContext=epaPeriods.filter(r=>r.ExternalPermitNmbr===p.permit_id&&r.PermFeatureNmbr===p.reporting_feature&&r.MonitoringLocationCode===p.monitoring_location&&r.period_end_iso===end),
      publishedHucs=unique((matches.length?matches:flowContext).map(r=>r.Huc12)),
      sourceMatch=originalQuantities.every(r=>r.SourceId===p.permit_id&&r.PermFeatureNmbr===p.reporting_feature&&r.ParameterCode===p.parameter_code&&r.MonitoringLocationCode===p.monitoring_location&&r.period_end_iso===end),
      stateJoin=geometryJoin(state.features,p.permit_id);
    if(!sourceMatch)throw Error("Selected DMR identity differs from calculated series "+k);
    return {...p,monitoring_period_end:end,science_quantity_method:"reported EPA-standard average rate integrated over original days",
      epa_loading_method:e?e.MeasurementType:null,epa_period_row_count:matches.length,
      epa_period_match:!mass?"flow source context":matches.length===1?"exact permit, feature, species, location and period":matches.length?"multiple original loading rows":"no original loading row",
      epa_published_period_mass_kg:mass&&e?e.PollutantLoad0:null,
      epa_load_display_step_kg:mass&&e?displayStep(e.PollutantLoad0):null,
      epa_minus_reported_quantity_kg:mass&&e?difference(e.PollutantLoad0,p.amount_in_reported_period):null,
      epa_period_start:e?e.derived_period_start_iso:null,period_start_agrees:e?e.derived_period_start_iso===p.period_start:null,
      epa_original_average_daily_load:e?e.AvgPollutantLoad0:null,epa_original_average_concentration:e?e.AvgConcentration0:null,
      epa_original_nd_flag:e?e.NdFlag:null,epa_original_nodi_description:e?e.NodiDesc:null,
      epa_original_load_unit:e?e.published_load_unit:null,
      epa_original_rows:matches.map(r=>({...sourcePointer(r),Mped:r.Mped,PollutantLoad0:r.PollutantLoad0,NmbrOfReport:r.NmbrOfReport,LimitSetDesignator:r.LimitSetDesignator,LimitSeasonID:r.LimitSeasonID,MeasurementType:r.MeasurementType,NdFlag:r.NdFlag,NodiDesc:r.NodiDesc})),
      complete_source_dmr_records:originalQuantities.map(r=>({DMRValueId:r.DMRValueId,...sourcePointer(r),DMRValueStdUnits:r.DMRValueStdUnits,StdUnitDesc:r.StdUnitDesc,DMRValueQualifierCode:r.DMRValueQualifierCode,NODICode:r.NODICode})),
      published_huc12_context:publishedHucs,published_huc12_context_sources:unique((matches.length?matches:flowContext).map(r=>JSON.stringify(sourcePointer(r)))).map(JSON.parse),
      ...stateJoin};
  });
  const annualComparisons=annual.map(a=>{
    const match=byYear.get(a.calendar_year+"|"+a.series_id)||[],ctx=match.length===1?match[0]:null,
      rows=comparisons.filter(p=>p.series_id===a.series_id),
      mass=a.amount_unit==="kg",numericEpa=rows.filter(p=>dec(p.epa_published_period_mass_kg)),
      common=rows.filter(p=>dec(p.epa_published_period_mass_kg)&&dec(p.amount_in_reported_period)),
      commonEpa=sum(common.map(p=>p.epa_published_period_mass_kg)),commonReported=sum(common.map(p=>p.amount_in_reported_period)),
      allEpa=numericEpa.length?sum(numericEpa.map(p=>p.epa_published_period_mass_kg)):null;
    return {...a,science_quantity_method:"reported EPA-standard average rates, calendar 2023 integration",
      epa_period_sum_kg:mass?allEpa:null,epa_numeric_period_count:numericEpa.length,
      common_numeric_period_count:common.length,common_epa_period_sum_kg:mass&&common.length?commonEpa:null,
      common_reported_period_sum_kg:mass&&common.length?commonReported:null,
      epa_minus_reported_common_periods_kg:mass&&common.length?difference(commonEpa,commonReported):null,
      epa_annual_context_rows:match.length,epa_published_annual_query_n_kg:ctx?ctx.published_single_numeric_annual_query_N_kg:null,
      epa_published_annual_query_y_kg:ctx?ctx.published_single_numeric_annual_query_Y_kg:null,
      epa_annual_query_n_original_rows:ctx?array(ctx.published_annual_original_rows_query_N):[],
      epa_annual_query_y_original_rows:ctx?array(ctx.published_annual_original_rows_query_Y):[],
      epa_history_context_source_path:INPUT_PATHS.echo_history_context,
      ...geometryJoin(state.features,a.permit_id)};
  });
  const outfallContext=[];
  const featureGroups=index(history,r=>[r.ExternalPermitNmbr,r.PermFeatureNmbr,r.MonitoringLocationCode].join("|"));
  for(const [key,rows] of featureGroups){
    const first=rows[0],ends=rows.map(r=>r.period_end_iso).filter(Boolean).sort();
    outfallContext.push({reporting_identity:key,permit_id:first.ExternalPermitNmbr,reporting_feature:first.PermFeatureNmbr,monitoring_location:first.MonitoringLocationCode,
      original_period_rows:rows.length,first_original_period_end:ends[0],last_original_period_end:ends[ends.length-1],
      reporting_years:unique(ends.map(s=>s.slice(0,4))).sort(),parameter_codes:unique(rows.map(r=>r.ParameterCode)).sort(),
      original_huc12_values:unique(rows.map(r=>r.Huc12)),original_reach_codes:unique(rows.map(r=>r.Reachcode)),
      epa_permitted_feature_coordinates:unique(rows.map(r=>JSON.stringify({latitude:r.LatitudeMeasure,longitude:r.LongitudeMeasure}))).map(JSON.parse),
      ended_numeric_mass_period_rows:rows.filter(r=>r.calculation_dimension==="mass"&&r.period_status_at_capture==="ended_by_capture_date"&&dec(r.PollutantLoad0)).length,
      future_period_rows:rows.filter(r=>r.period_status_at_capture!=="ended_by_capture_date").length,
      source_responses:unique(rows.map(r=>r.source_response_id)),...geometryJoin(state.features,first.ExternalPermitNmbr)});
  }
  const joinedHistory=historyContext.map(r=>({...r,...geometryJoin(state.features,r.ExternalPermitNmbr),
    science_2023_series_present:annual.some(a=>a.series_id===seriesKey(r)),
    current_geometry_relationship:"current DES mapped permit context; original EPA historical reporting identity retained"}));
  const contextualObservations=comparisons.filter(p=>p.published_huc12_context.length===1).map(p=>({
    record_id:"eighteenmile-period:"+p.series_id+":"+p.calendar_2023_start+".."+p.calendar_2023_end_exclusive,
    station_id:"npdes:"+p.permit_id+":"+p.reporting_feature,
    catchment_id:p.published_huc12_context[0],parameter:p.parameter_code,value:p.amount_in_2023,unit:p.amount_unit,
    period_start:p.calendar_2023_start,period_end:p.calendar_2023_end_exclusive,
    qualifier:array(p.selected_dmr_value_ids).map(id=>operator(one(byDmr,id,"Source qualifier").DMRValueQualifierCode)).join("|"),
    method:"reported standard quantity integrated over represented 2023 days; point-source discharge context",
    source_records:{source_kind:"NPDES point-source discharge",permit_id:p.permit_id,reporting_feature:p.reporting_feature,parameter_code:p.parameter_code,parameter_name:p.parameter_name,
      selected_dmr_value_ids:array(p.selected_dmr_value_ids),all_average_candidate_ids:array(p.all_average_candidate_ids),period_status:p.status,
      original_candidates:array(p.all_average_candidate_ids).map(id=>{const r=one(byDmr,id,"Original period candidate");return {DMRValueId:id,DMRValueStdUnits:r.DMRValueStdUnits,DMRValueQualifierCode:r.DMRValueQualifierCode,NODICode:r.NODICode,NODIDesc:r.NODIDesc,...sourcePointer(r)};}),
      science_source_path:p.source_path,science_source_sha256:p.source_sha256,
      complete_source_dmr_records:p.complete_source_dmr_records,calendar_days:p.calendar_2023_days,
      state_objectid:p.state_objectid,state_mapped_outfall:p.state_mapped_outfall,state_geometry_source_path:INPUT_PATHS.state_features,
      catchment_reference:"EPA published HUC12 context",published_huc12_context_sources:p.published_huc12_context_sources}
  }));
  const vector=JSON.parse(inputs.science_map);
  if(vector.type!=="FeatureCollection"||vector.features.length!==state.features.length)throw Error("Current science native point map differs from original source scope");
  for(const feature of vector.features){
    const source=state.features.filter(f=>f.attributes.PrmtPrmtNum===feature.properties.permit_id);
    if(source.length!==1||feature.geometry.type!=="Point"||feature.geometry.coordinates[0]!==source[0].geometry.x||feature.geometry.coordinates[1]!==source[0].geometry.y)
      throw Error("Science map does not retain the original DES point: "+feature.properties.permit_id);
  }
  const tables={
    "canonical_measurements_2023.csv":measurements,
    "period_method_comparison_2023.csv":comparisons,
    "annual_method_comparison_2023.csv":annualComparisons,
    "outfall_history_context.csv":outfallContext,
    "annual_history_map_index.csv":joinedHistory,
    "point_source_period_observations.csv":contextualObservations
  };
  const observationMetadata={title:"Eighteenmile 2023 point-source discharge periods and original reporting status",
    source_uri:"https://echo.epa.gov/tools/web-services/effluent-charts",value_basis:"point_source_discharge_context",
    source_type:"NPDES point-source discharge",measurement_support:"point_source_discharge",calendar_year:2023,
    parameter_mapping:{"00600":"nitrogen","00620":"nitrogen","00610":"nitrogen","00665":"phosphorus","00530":"sediment"},
    accepted_qualifiers:["","=","<","<="],method:"Reported EPA-standard average rates integrated over represented 2023 days",
    source_records:{science_summary_path:INPUT_PATHS.science_summary,state_geometry_path:INPUT_PATHS.state_features,
      point_source_context:true,catchment_reference:"Actual EPA-published HUC12 context retained per row; source is an outfall discharge"},
    notes:"All point-source periods remain contextual observations, including the three unquantified NODI periods and every original source identity. Annual receiving-water catchment comparisons use their own measured catchment load source."};
  const summary={schema:"upstate.point-source-cohort/v1",title:"Eighteenmile point-source discharge context",
    captured_at:echoCapture.captured_at,source_banks:["F0C8K2W4B0D","F0C8Q6PADFC","F0C8J1E75FV"],
    original_2023_measurements:echo.length,science_original_records:science.length,shared_original_dmr_ids:science.length,
    selected_quantity_records:selected.size,entity_equivalent_qualifier_fields:entityEquivalentFields,
    substantive_source_field_variants:substantiveVariants,
    tables:Object.fromEntries(Object.entries(tables).map(([name,rows])=>[name,rows.length])),
    mapped_outfalls:vector.features.length,mapped_source_id:"scdes-eighteenmile-npdes-outfalls-2023",mapped_source_path:INPUT_PATHS.science_map,geometry_crs:"EPSG:26917",
    scientific_method:scienceSummary.method,science_source_ids:scienceSummary.source_ids,
    source_geometry:scienceCapture.location_source,
    source_units:"Each amount retains its source-specific kg or million US gallons basis; species and coverage remain explicit",
    period_comparison:{mass_rows:comparisons.filter(p=>p.amount_unit==="kg").length,
      unique_mass_source_matches:comparisons.filter(p=>p.amount_unit==="kg"&&p.epa_period_row_count===1).length,
      flow_context_rows:comparisons.filter(p=>p.amount_unit!=="kg").length},
    original_period_history_rows:history.length,annual_query_n_rows:annualN.length,annual_query_y_rows:annualY.length};
  return {tables,vector,observationMetadata,summary};
}

function buildSourceManifest(inputs,result,inputSpec,generatedMeta){
  const base=JSON.parse(inputs.echo_manifest),prefix="source/echo_dmr/20261013/",
    meta=inputSpec.source_files,scienceSummary=JSON.parse(inputs.science_summary),
    scienceCapture=JSON.parse(inputs.science_capture);
  const descriptor=path=>{const x=generatedMeta[path]||meta[path];if(!x)throw Error("Missing retained source descriptor "+path);return {path,bytes:x.bytes,sha256:x.sha256};};
  const companions=paths=>unique(paths).map(descriptor);
  const entries=base.entries.map(e=>({...e,path:prefix+e.path,companions:(e.companions||[]).map(c=>({...c,path:prefix+c.path}))}));
  const first=entries.find(e=>e.id==="echo-dmr-measurements-2023");
  const canonicalPath=OUT_ROOT+"/canonical_measurements_2023.csv";
  Object.assign(first,{id:"echo-cohort-canonical-measurements-2023",title:"2023 original DMR values joined to the science cohort",
    ...descriptor(canonicalPath),rows:result.tables["canonical_measurements_2023.csv"].length,
    role:"EPA_ECHO_REPORTED_MEASUREMENTS",cohort_key:"DMRValueId",
    source_edition:"Full EPA source values with linked original science subset and explicit qualifier representations"});
  first.companions=[...first.companions,...companions([INPUT_PATHS.echo_measurements,INPUT_PATHS.science_records,INPUT_PATHS.science_capture,...scienceCapture.response_sources.filter(s=>/_\d{5}_2023\.json$/.test(s.path)).map(s=>s.path)])];
  const uri="https://echo.epa.gov/tools/web-services/effluent-charts";
  const common={kind:"table",source_format:"CSV",vintage:"2023 observations; source capture 2026-10-13",uri,source_scope:"NPDES point-source discharge context"};
  const addTable=(id,title,name,role,inputsNeeded)=>{
    const path=OUT_ROOT+"/"+name;
    entries.push({...common,id,title,...descriptor(path),rows:result.tables[name].length,role,
      companions:companions(inputsNeeded),point_source_context:true});
  };
  entries.push({...common,id:scienceSummary.source_ids.period_loads,title:"2023 reported-standard-rate period quantities",
    ...descriptor(INPUT_PATHS.science_periods),rows:result.summary.tables["period_method_comparison_2023.csv"],
    role:"POINT_SOURCE_REPORTED_PERIOD_QUANTITIES",companions:companions([INPUT_PATHS.science_summary,INPUT_PATHS.science_capture,...scienceCapture.response_sources.filter(s=>/_\d{5}_2023\.json$/.test(s.path)).map(s=>s.path)])});
  entries.push({...common,id:scienceSummary.source_ids.annual_loads,title:"2023 quantified and complete-year discharge quantities",
    ...descriptor(INPUT_PATHS.science_annual),rows:result.summary.tables["annual_method_comparison_2023.csv"],
    role:"POINT_SOURCE_REPORTED_ANNUAL_QUANTITIES",companions:companions([INPUT_PATHS.science_summary,INPUT_PATHS.science_periods,INPUT_PATHS.science_capture])});
  const geometryResponse=scienceCapture.response_sources.find(s=>s.path===INPUT_PATHS.state_features);
  entries.push({id:"upstate-eighteenmile-des-original-outfalls",title:"Original DES mapped outfalls for the four study permits",
    kind:"vector",...descriptor(INPUT_PATHS.state_features),uri:geometryResponse.url,vintage:"DES source captured 2026-10-13",
    source_format:"Esri JSON",source_crs:"EPSG:26917",publisher_layer_crs:"EPSG:4269",role:"NPDES_ORIGINAL_OUTFALLS",
    object_id_field:"OBJECTID",permit_id_field:"PrmtPrmtNum",companions:companions([INPUT_PATHS.state_metadata,INPUT_PATHS.science_capture])});
  const nativeMapManifest=JSON.parse(inputs.science_map_manifest);
  const sciencePrefix="observations/eighteenmile_2023/npdes/";
  const retainedMap=nativeMapManifest.entries.find(e=>e.id==="scdes-eighteenmile-npdes-outfalls-2023");
  if(!retainedMap||retainedMap.path!=="dmr_outfalls_2023.geojson")throw Error("Missing current native science map");
  const adopt=e=>({...e,path:sciencePrefix+e.path,companions:(e.companions||[]).map(c=>({...c,path:sciencePrefix+c.path}))});
  entries.push(adopt(retainedMap));
  for(const id of [scienceSummary.source_ids.period_loads,scienceSummary.source_ids.annual_loads]){
    const original=nativeMapManifest.entries.find(e=>e.id===id),i=entries.findIndex(e=>e.id===id);
    if(!original||i<0)throw Error("Missing native science table "+id);
    entries[i]=adopt(original);
  }
  addTable("echo-cohort-period-method-comparison-2023","2023 period quantities and EPA selected loading outputs",
    "period_method_comparison_2023.csv","POINT_SOURCE_PERIOD_METHOD_COMPARISON",
    [INPUT_PATHS.science_periods,INPUT_PATHS.echo_periods_2023,INPUT_PATHS.echo_measurements,INPUT_PATHS.state_features]);
  addTable("echo-cohort-annual-method-comparison-2023","2023 coverage, reported quantities and published annual outputs",
    "annual_method_comparison_2023.csv","POINT_SOURCE_ANNUAL_METHOD_COMPARISON",
    [INPUT_PATHS.science_annual,INPUT_PATHS.echo_history_context,INPUT_PATHS.echo_annual_n,INPUT_PATHS.echo_annual_y]);
  addTable("echo-cohort-outfall-history","Original discharge reporting features and mapped permit context",
    "outfall_history_context.csv","POINT_SOURCE_REPORTING_HISTORY",
    [INPUT_PATHS.echo_history_periods,INPUT_PATHS.state_features,INPUT_PATHS.state_metadata]);
  addTable("echo-cohort-annual-history-map-index","2007-2026 reporting history joined to mapped permit context",
    "annual_history_map_index.csv","POINT_SOURCE_ANNUAL_HISTORY_MAP_INDEX",
    [INPUT_PATHS.echo_history_context,INPUT_PATHS.state_features,INPUT_PATHS.science_annual]);
  addTable("echo-cohort-period-observation-context","2023 point-source periods and reporting status with original HUC and source identities",
    "point_source_period_observations.csv","POINT_SOURCE_OBSERVATION_CONTEXT",
    [INPUT_PATHS.science_periods,INPUT_PATHS.echo_periods_2023,OUT_ROOT+"/observation-metadata.json"]);
  return {schema:"upstate.sources/v1",title:"Eighteenmile point-source discharge: original history, calculated quantities and native geography",
    captured_at:base.captured_at,scope:{permits:base.scope?.permits||JSON.parse(inputs.echo_capture).permits,
      historical_years:"2007-2026",calculated_observation_year:2023,source_kind:"NPDES point-source discharge",source_crs:"EPSG:26917"},
    notes:"One cohort retains full original EPA history, the existing science calculator outputs, native DES points, and method comparisons. Original objects deduplicate by byte hash in Workspace; repeated companions preserve usable source views.",
    source_cohort:inputSpec.edition,entries};
}

export { INPUT_PATHS, OUT_ROOT, parseCsv, csvString, buildCohort, buildSourceManifest };
