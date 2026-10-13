function buildWqpTables(captures) {
  const fields = {
    organization_id:"OrganizationIdentifier",organization_name:"OrganizationFormalName",
    station_id:"MonitoringLocationIdentifier",activity_id:"ActivityIdentifier",project_id:"ProjectIdentifier",
    activity_type:"ActivityTypeCode",media:"ActivityMediaName",media_subdivision:"ActivityMediaSubdivisionName",
    sample_date:"ActivityStartDate",sample_time:"ActivityStartTime/Time",sample_timezone:"ActivityStartTime/TimeZoneCode",
    sample_end_date:"ActivityEndDate",sample_end_time:"ActivityEndTime/Time",sample_end_timezone:"ActivityEndTime/TimeZoneCode",
    activity_depth:"ActivityDepthHeightMeasure/MeasureValue",activity_depth_unit:"ActivityDepthHeightMeasure/MeasureUnitCode",
    activity_depth_reference:"ActivityDepthAltitudeReferencePointText",
    top_depth:"ActivityTopDepthHeightMeasure/MeasureValue",top_depth_unit:"ActivityTopDepthHeightMeasure/MeasureUnitCode",
    bottom_depth:"ActivityBottomDepthHeightMeasure/MeasureValue",bottom_depth_unit:"ActivityBottomDepthHeightMeasure/MeasureUnitCode",
    characteristic:"CharacteristicName",sample_fraction:"ResultSampleFractionText",
    reported_value:"ResultMeasureValue",reported_unit:"ResultMeasure/MeasureUnitCode",
    detection_condition:"ResultDetectionConditionText",qualifier:"MeasureQualifierCode",
    detection_limit_type:"DetectionQuantitationLimitTypeName",detection_limit:"DetectionQuantitationLimitMeasure/MeasureValue",
    detection_limit_unit:"DetectionQuantitationLimitMeasure/MeasureUnitCode",
    result_status:"ResultStatusIdentifier",value_type:"ResultValueTypeName",statistical_base:"StatisticalBaseCode",
    result_depth:"ResultDepthHeightMeasure/MeasureValue",result_depth_unit:"ResultDepthHeightMeasure/MeasureUnitCode",
    result_depth_reference:"ResultDepthAltitudeReferencePointText",
    result_time_basis:"ResultTimeBasisText",result_weight_basis:"ResultWeightBasisText",
    result_temperature_basis:"ResultTemperatureBasisText",result_particle_size_basis:"ResultParticleSizeBasisText",
    analytical_method_id:"ResultAnalyticalMethod/MethodIdentifier",analytical_method_context:"ResultAnalyticalMethod/MethodIdentifierContext",
    analytical_method_name:"ResultAnalyticalMethod/MethodName",analytical_method_description:"MethodDescriptionText",
    collection_method_id:"SampleCollectionMethod/MethodIdentifier",collection_method_context:"SampleCollectionMethod/MethodIdentifierContext",
    collection_method_name:"SampleCollectionMethod/MethodName",collection_equipment:"SampleCollectionEquipmentName",
    activity_comment:"ActivityCommentText",result_comment:"ResultCommentText",
    laboratory_name:"LaboratoryName",analysis_start_date:"AnalysisStartDate",laboratory_comment:"ResultLaboratoryCommentText",
    preparation_start_date:"PreparationStartDate",provider:"ProviderName",usgs_parameter_code:"USGSPCode",
    hydrologic_condition:"HydrologicCondition",hydrologic_event:"HydrologicEvent"
  };
  const numeric = value => value !== "" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) ? Number(value) : null;
  const all = [];
  for (const capture of captures) for (let index=0;index<capture.rows.length;index++) {
    const original=capture.rows[index];
    const row={
      record_id:capture.sha256+":"+String(index+1),
      source_path:capture.source_path,source_sha256:capture.sha256,
      source_url:capture.source_url,source_record_index:index+1
    };
    for (const [key,originalKey] of Object.entries(fields)) row[key]=original[originalKey]??"";
    row.numeric_reported_value=numeric(row.reported_value);
    row.numeric_detection_limit=numeric(row.detection_limit);
    row.quantitation_class =
      /not detected|below|less than/i.test(row.detection_condition)?"censored_below":
      /above.*upper|greater than/i.test(row.detection_condition)?"censored_above":
      row.detection_condition==="Present Above Quantification Limit"?"quantified":
      row.numeric_reported_value===null?"no_numeric_result":
      row.detection_condition?"reported_with_condition":"reported_numeric";
    row.numeric_interpretation="Original reported number; detection condition and qualifier remain decisive. No substitution or unit conversion.";
    all.push(row);
  }
  const special=["SV-838","SV-839","SV-840"];
  const calendarSets=special.map(site=>new Set(all.filter(r=>r.station_id.endsWith("-"+site)&&r.project_id==="CHLA").map(r=>r.sample_date)));
  const dates=[...calendarSets[0]].filter(d=>calendarSets.every(s=>s.has(d))).sort();
  const lake=new Set(["SV-268","SV-374",...special]);
  const routineClocks=new Map();
  for(const r of all)if(r.project_id==="SWS-2023"){
    const k=[r.station_id,r.sample_date,r.sample_time].join("|");
    if(!routineClocks.has(k))routineClocks.set(k,new Map());
    routineClocks.get(k).set(r.activity_id,r.sample_timezone);
  }
  for(const r of all){
    const short=r.station_id.replace(/^21SC60WQ(?:_WQX)?-/,"");
    r.study_calendar_date=dates.includes(r.sample_date);
    r.study_lake_station=lake.has(short);
    const clocks=routineClocks.get([r.station_id,r.sample_date,r.sample_time].join("|"));
    r.same_displayed_clock_routine_activity_ids=clocks?[...clocks.keys()]:[];
    r.same_displayed_clock_routine_timezones=clocks?[...new Set(clocks.values())]:[];
    r.study_chla_selection = r.project_id!=="CHLA"?"other_project":
      !r.study_lake_station?"other_station":
      !r.study_calendar_date?"outside_shared_lake_calendar":
      clocks?"routine_clock_overlap":
      "selected_reconciled_study";
    r.selection_basis = r.study_chla_selection==="selected_reconciled_study" || r.study_chla_selection==="routine_clock_overlap"
      ? "Agency CHLA project, five lake sites, shared three-station original 15-date calendar; original displayed local clock matching to SWS-2023 separates two routine overlaps. EST/EDT labels retained; this is a cohort reconciliation inference, not a timezone conversion."
      : "";
  }
  all.sort((a,b)=>[a.sample_date,a.station_id,a.project_id,a.activity_id,a.characteristic,a.record_id].join("|").localeCompare([b.sample_date,b.station_id,b.project_id,b.activity_id,b.characteristic,b.record_id].join("|")));
  const activityMap=new Map(), coverageMap=new Map();
  for(const r of all){
    const ak=[r.organization_id,r.station_id,r.activity_id,r.project_id].join("|");
    if(!activityMap.has(ak))activityMap.set(ak,{
      organization_id:r.organization_id,station_id:r.station_id,activity_id:r.activity_id,project_id:r.project_id,
      activity_type:r.activity_type,sample_date:r.sample_date,sample_time:r.sample_time,sample_timezone:r.sample_timezone,
      activity_depth:r.activity_depth,activity_depth_unit:r.activity_depth_unit,activity_depth_reference:r.activity_depth_reference,
      study_calendar_date:r.study_calendar_date,study_lake_station:r.study_lake_station,
      study_chla_selection:r.study_chla_selection,same_displayed_clock_routine_activity_ids:r.same_displayed_clock_routine_activity_ids,
      same_displayed_clock_routine_timezones:r.same_displayed_clock_routine_timezones,result_count:0,
      characteristics:[],record_ids:[],source_path:r.source_path,source_sha256:r.source_sha256,source_url:r.source_url
    });
    const a=activityMap.get(ak);a.result_count++;a.characteristics.push(r.characteristic);a.record_ids.push(r.record_id);
    const ck=[r.station_id,r.project_id,r.characteristic,r.sample_fraction,r.reported_unit].join("|");
    if(!coverageMap.has(ck))coverageMap.set(ck,{
      station_id:r.station_id,project_id:r.project_id,characteristic:r.characteristic,sample_fraction:r.sample_fraction,
      reported_unit:r.reported_unit,record_count:0,numeric_reported_count:0,quantified_count:0,censored_below_count:0,
      dates:[],activity_ids:[],source_path:r.source_path,source_sha256:r.source_sha256,source_url:r.source_url
    });
    const c=coverageMap.get(ck);c.record_count++;if(r.numeric_reported_value!==null)c.numeric_reported_count++;
    if(r.quantitation_class==="quantified")c.quantified_count++;if(r.quantitation_class==="censored_below")c.censored_below_count++;
    c.dates.push(r.sample_date);c.activity_ids.push(r.activity_id);
  }
  const activities=[...activityMap.values()].map(a=>({...a,characteristics:[...new Set(a.characteristics)].sort()}));
  const coverage=[...coverageMap.values()].map(c=>({...c,dates:[...new Set(c.dates)].sort(),activity_ids:[...new Set(c.activity_ids)].sort()}));
  const calendar=dates.map(date=>({sample_date:date,source_station_ids:special,source_project:"CHLA",
    source_activity_ids:all.filter(r=>special.some(s=>r.station_id.endsWith("-"+s))&&r.project_id==="CHLA"&&r.sample_date===date).map(r=>r.activity_id),
    source_record_ids:all.filter(r=>special.some(s=>r.station_id.endsWith("-"+s))&&r.project_id==="CHLA"&&r.sample_date===date).map(r=>r.record_id)}));
  const selected=all.filter(r=>r.study_chla_selection==="selected_reconciled_study");
  const cohortSummary=[...lake].map(site=>{
    const r=selected.filter(r=>r.station_id.endsWith("-"+site)), values=r.map(x=>x.numeric_reported_value);
    if(!r.length||values.some(x=>x===null)||r.some(x=>x.quantitation_class!=="quantified"))throw Error("Unexpected chlorophyll quantitation for "+site);
    const mean=values.reduce((a,b)=>a+b,0)/values.length;
    return{station_id:site,project_id:"CHLA",characteristic:r[0].characteristic,unit:r[0].reported_unit,
      measured_cohort_n:r.length,mean,sample_standard_deviation:Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/(values.length-1)),
      minimum:Math.min(...values),maximum:Math.max(...values),printed_table7_n:["SV-374","SV-840"].includes(site)?4:15,
      printed_n_source:"2023LakeProgramFinalReport.pdf Table7, printedpage14/PDFpage21",
      method:"Explicit source project/calendar/local-clock reconciliation; measured n and printed n remain separate.",
      selected_activity_ids:r.map(x=>x.activity_id),selected_record_ids:r.map(x=>x.record_id)};
  });
  return{measurements:all,activities,coverage,calendar,selected_chlorophyll:selected,chlorophyll_summary:cohortSummary,
    summary:{schema:"upstate.wqp-dated-study-summary/v1",source_count:captures.length,original_result_count:all.length,
      activity_count:activities.length,coverage_groups:coverage.length,shared_lake_visit_count:dates.length,
      reconciled_chlorophyll_count:selected.length,empty_source_stations:captures.filter(c=>!c.rows.length).map(c=>c.station_id),
      source_row_counts:captures.map(c=>({station_id:c.station_id,record_count:c.rows.length,source_path:c.source_path,source_sha256:c.sha256})),
      selection_reference:"https://app.notion.com/p/3f7dd77231008124b767e1dccf8a706e",
      method_notes:["All source records retained; no detection substitution, nutrient-species summation or concentration-to-load conversion.",
        "A row's numeric_reported_value remains subject to its original detection_condition and qualifier.",
        "Calendar membership does not make routine SWS-2023 chemistry a special-study measurement.",
        "Original EST and EDT labels are preserved; cohort clock matching compares displayed local clock fields, without converting or declaring the clocks equivalent absolute times.",
        "SV-591 header-only source is an empty response for the exact organization/station/year query, not evidence that field sampling did not occur."]}};
}

function parseCsv(text){const rows=[],row=[];let field="",quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===","&&!quoted){row.push(field);field="";}else if((c==="\n"||c==="\r")&&!quoted){row.push(field);field="";rows.push(row.splice(0));if(c==="\r"&&text[i+1]==="\n")i++;}else field+=c;}if(quoted)throw Error("Unclosed CSV quote");if(field.length||row.length){row.push(field);rows.push(row);}const header=rows.shift();return rows.filter(r=>r.length!==1||r[0]!=="").map(r=>{if(r.length!==header.length)throw Error("CSV width mismatch");return Object.fromEntries(header.map((h,i)=>[h,r[i]]));});}

function writeCsv(rows) {
 const fields=rows.length?Object.keys(rows[0]):[];
 const cell=value=>{const s=value===null||value===undefined?"":typeof value==="object"?JSON.stringify(value):String(value);return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
 return fields.join(",")+"\n"+rows.map(row=>fields.map(k=>cell(row[k])).join(",")).join("\n")+(rows.length?"\n":"");
}

export { buildWqpTables, parseCsv, writeCsv };
