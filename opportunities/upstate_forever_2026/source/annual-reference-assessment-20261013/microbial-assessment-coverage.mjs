/** Join retained source editions while preserving publisher, sample and assessment identities. */
export const parseCsv = (text) => {
  text=text.replace(/^\ufeff/,""); const records=[];let row=[],value="",quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else quoted=false;}else value+=c;}
    else if(c==='"'&&value==="")quoted=true;
    else if(c===","){row.push(value);value="";}
    else if(c==="\n"||c==="\r"){if(c==="\r"&&text[i+1]==="\n")i++;row.push(value);if(row.some(x=>x!==""))records.push(row);row=[];value="";}
    else value+=c;
  }
  if(quoted)throw Error("Unclosed CSV field");
  if(value!==""||row.length){row.push(value);records.push(row);}
  if(!records.length)return {fields:[],rows:[]};
  const fields=records.shift();if(new Set(fields).size!==fields.length)throw Error("Duplicate CSV header");
  return {fields,rows:records.map((r,i)=>{if(r.length!==fields.length)throw Error("CSV width mismatch at row "+(i+2));return Object.fromEntries(fields.map((k,j)=>[k,r[j]]));})};
};

export const buildCoverage = (observations, stationSummaries, assessmentContext, geographicContext) => {
  const count = values => Object.fromEntries([...new Set(values)].sort().map(value => [value, values.filter(x => x === value).length]));
  const distinct = values => [...new Set(values)].sort();
  const byAssessment = new Map(assessmentContext.stations.map(row => [row.station_id, row]));
  const byGeometry = new Map(geographicContext.stations.map(row => [row.station_id, row]));
  if (byAssessment.size !== assessmentContext.stations.length) throw Error("Assessment station IDs are not unique");
  const byObservation = new Map();
  const originalRows = new Set(), activityIds = new Set();
  for (const row of observations) {
    const locator = row.source_file + ":" + row.source_row;
    if (originalRows.has(locator)) throw Error("Duplicate original observation locator " + locator);
    if (activityIds.has(row.activity_id)) throw Error("Repeated activity ID requires explicit result-level identity " + row.activity_id);
    originalRows.add(locator); activityIds.add(row.activity_id);
    if (!byObservation.has(row.station_id)) byObservation.set(row.station_id, []);
    byObservation.get(row.station_id).push(row);
  }
  const stationRows = stationSummaries.map(originalSummary => {
    const rows = byObservation.get(originalSummary.station_id);
    if (!rows) throw Error("Station summary has no original observations");
    const routine = rows.filter(row => row.activity_type === "Sample-Routine");
    if (routine.length !== Number(originalSummary.records)) throw Error("Original routine count differs for " + originalSummary.station_id);
    const prefix = "21SC60WQ_WQX-";
    const candidate = originalSummary.station_id.startsWith(prefix) ? originalSummary.station_id.slice(prefix.length) : null;
    const assessment = candidate && byAssessment.get(candidate);
    if (assessment && originalSummary.station_name !== candidate) throw Error("Original WQP station name differs from exact SCDES station ID");
    const dates = distinct(rows.map(row => row.date));
    const records = assessment ? assessment.assessment_records : [];
    const geometry = assessment ? byGeometry.get(assessment.station_id) : null;
    return {
      utility_id: originalSummary.utility_id, observation_station_id: originalSummary.station_id,
      original_station_name: originalSummary.station_name,
      assessment_station_id: assessment ? assessment.station_id : null,
      identity_relation: assessment ? "same_scdes_station_id_in_scdes_wqx_namespace" :
        (candidate ? "scdes_station_outside_selected_assessment_cohort" : "different_publisher_namespace"),
      identity_basis: assessment ? "Exact original station_name and 21SC60WQ_WQX namespace suffix equal the SCDES assessment site ID" : null,
      original_geographic_selection: {source_huc8: originalSummary.source_huc8,
        matched_huc12: originalSummary.matched_huc12 || null, selection_basis: originalSummary.selection_basis},
      geometry_huc12s: geometry ? geometry.geometry_huc12s : [],
      physical_utility_membership: geometry ? Object.fromEntries(Object.entries(geometry.utility_membership).map(([id,value])=>[id,value.covered])) : null,
      observations: rows.length, routine_observations: routine.length,
      field_replicates: rows.filter(row=>row.activity_type === "Quality Control Sample-Field Replicate").length,
      distinct_activity_ids: distinct(rows.map(row=>row.activity_id)).length,
      sample_dates: dates.length, first_date: dates[0], last_date: dates[dates.length-1],
      annual_observation_counts: count(rows.map(row=>row.year)),
      methods: distinct(rows.map(row=>row.method_context + ":" + row.method)),
      units: distinct(rows.map(row=>row.unit)), source_units: distinct(rows.map(row=>row.source_result_unit)),
      result_statuses: count(rows.map(row=>row.status)),
      above_limit_records: rows.filter(row=>row.status === "above_limit").length,
      upper_unbounded_records: rows.filter(row=>row.upper_unbounded === "true").length,
      assessment_record_count: records.length,
      assessment_record_ids: records.map(row=>row.source_id + ":" + row.id),
      assessment_causes: distinct(records.map(row=>row.cause_label)),
      assessment_editions: distinct(records.map(row=>row.source_vintage)),
      assessment_records: records,
      source_summary: originalSummary
    };
  });
  if (new Set(stationRows.map(row=>row.observation_station_id)).size !== byObservation.size) throw Error("Station summary does not uniquely cover the complete observation cohort");
  const byMatched = new Map(stationRows.filter(row=>row.assessment_station_id).map(row=>[row.assessment_station_id,row]));
  const coverage = assessmentContext.stations.map(station => {
    const match = byMatched.get(station.station_id);
    const geometry = byGeometry.get(station.station_id);
    return {assessment_station_id:station.station_id, assessment_record_count:station.assessment_records.length,
      assessment_record_ids:station.assessment_records.map(row=>row.source_id+":"+row.id),
      assessment_editions:distinct(station.assessment_records.map(row=>row.source_vintage)),
      assessment_causes:distinct(station.assessment_records.map(row=>row.cause_label)),
      geometry_huc12s:geometry?.geometry_huc12s||[],
      physical_utilities:geometry?Object.entries(geometry.utility_membership).filter(([,value])=>value.covered).map(([id])=>id):[],
      observation_station_id:match?.observation_station_id||null,
      observation_coverage:match?"present_in_retained_utility_ecoli_2021_2025":"absent_from_this_retained_utility_cohort",
      observations:match?.observations||0,routine_observations:match?.routine_observations||0,
      field_replicates:match?.field_replicates||0,first_date:match?.first_date||null,last_date:match?.last_date||null,
      methods:match?.methods||[],units:match?.units||[]};
  });
  const byWqp = new Map(stationRows.map(row=>[row.observation_station_id,row]));
  const joinedObservations = observations.map((row,index) => {
    const station = byWqp.get(row.station_id);
    return {...row,original_interval_csv_row:index+2,
      assessment_station_id:station.assessment_station_id,
      assessment_record_ids:station.assessment_record_ids,
      assessment_record_count:station.assessment_record_count,
      identity_relation:station.identity_relation};
  });
  const matchedStations = stationRows.filter(row=>row.assessment_station_id);
  const matchedObservations = joinedObservations.filter(row=>row.assessment_station_id);
  const assessmentRows = matchedStations.flatMap(station=>station.assessment_records.map(record=>{
    const rows = byObservation.get(station.observation_station_id);
    const period = record.assessment_period || null;
    const window = period && /^\d{4}-\d{4}$/.test(period) ? [period.slice(0,4)+"-01-01",period.slice(5)+"-12-31"] : null;
    return {assessment_station_id:station.assessment_station_id,observation_station_id:station.observation_station_id,
      utility_id:station.utility_id,assessment_record:record,observations:rows.length,
      same_analyte:record.cause_label === "E. coli",
      assessment_period:period,observations_in_explicit_assessment_period:window?rows.filter(row=>row.date>=window[0]&&row.date<=window[1]).length:null,
      observations_after_explicit_assessment_period:window?rows.filter(row=>row.date>window[1]).length:null,
      first_sample_date:station.first_date,last_sample_date:station.last_date,
      sample_record_identity_basis:"Count distinct original activity_id across assessment records; one sample may contextualize more than one assessment cause"};
  }));
  const utilities = Object.fromEntries(distinct(stationRows.map(row=>row.utility_id)).map(id=>{
    const obsStations=stationRows.filter(row=>row.utility_id===id);
    const physical=coverage.filter(row=>row.physical_utilities.includes(id));
    const overlap=obsStations.filter(row=>row.assessment_station_id);
    return [id,{observation_stations:obsStations.length,observations:obsStations.reduce((n,row)=>n+row.observations,0),
      routine_observations:obsStations.reduce((n,row)=>n+row.routine_observations,0),
      field_replicates:obsStations.reduce((n,row)=>n+row.field_replicates,0),
      physical_assessment_stations:physical.length,physical_assessment_records:physical.reduce((n,row)=>n+row.assessment_record_count,0),
      shared_stations:overlap.length,shared_station_observations:overlap.reduce((n,row)=>n+row.observations,0),
      shared_assessment_records:overlap.reduce((n,row)=>n+row.assessment_record_count,0)}];
  }));
  return {schema:"upstate.assessment-microbial-coverage/v1",
    method:{join:"Exact SCDES station ID scoped to publisher 21SC60WQ_WQX and corroborated by original WQP station_name",
      original_namespaces_retained:true,sample_replicates_retained:true,geometry_recomputed:false,
      concentration_aggregation:"No new concentration aggregation or censoring substitution",
      absence_meaning:"No record in this selected retained utility E. coli cohort; other monitoring sources are outside this join"},
    summary:{observation_stations:stationRows.length,observations:observations.length,
      routine_observations:observations.filter(row=>row.activity_type==="Sample-Routine").length,
      field_replicates:observations.filter(row=>row.activity_type==="Quality Control Sample-Field Replicate").length,
      assessment_stations:coverage.length,assessment_records:coverage.reduce((n,row)=>n+row.assessment_record_count,0),
      shared_stations:matchedStations.length,shared_station_observations:matchedObservations.length,
      shared_assessment_records:assessmentRows.length,same_analyte_assessment_records:assessmentRows.filter(row=>row.same_analyte).length,
      other_station_observations:observations.length-matchedObservations.length,
      shared_observation_statuses:count(matchedObservations.map(row=>row.status)),
      first_sample_date:distinct(observations.map(row=>row.date))[0],
      last_sample_date:distinct(observations.map(row=>row.date)).at(-1),
      utilities},
    observed_station_context:stationRows,assessment_station_coverage:coverage,
    matched_assessment_records:assessmentRows,observations:joinedObservations};
};

export const joinGeography = (geography, coverage) => {
 const by=new Map(coverage.assessment_station_coverage.map(x=>[x.assessment_station_id,x]));
 const result=JSON.parse(JSON.stringify(geography));
 for(const feature of result.features){const row=by.get(feature.properties.station_id);
  if(!row)throw Error("Assessment geometry has no source coverage row");
  Object.assign(feature.properties,{
   has_microbial_observations:row.observations>0,microbial_observation_count:row.observations,
   microbial_routine_count:row.routine_observations,microbial_field_replicates:row.field_replicates,
   microbial_first_date:row.first_date,microbial_last_date:row.last_date,microbial_station_id:row.observation_station_id,
   microbial_methods:row.methods.join(";"),microbial_units:row.units.join(";"),
   microbial_cohort:"Utility Escherichia coli; requested dates 2021-01-01 through 2025-12-31",
   microbial_absence_meaning:"Outside the retained measurement cohort; other monitoring sources are not evaluated here"});
 }
 return result;
};

export const csvText = (rows,fields)=>{const cell=v=>{let s=v===undefined||v===null?"":typeof v==="object"?JSON.stringify(v):String(v);return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};return fields.map(cell).join(",")+"\n"+rows.map(r=>fields.map(k=>cell(r[k])).join(",")).join("\n")+"\n";};
