// Reconcile the original five-site chlorophyll cohort by dates and independent routine-visit evidence.
function csvParse(s){const rows=[];let row=[],cell="",q=false;for(let i=0;i<s.length;i++){let ch=s[i];if(ch==='"'){if(q&&s[i+1]==='"'){cell+='"';i++;}else q=!q;}else if(ch===","&&!q){row.push(cell);cell="";}else if((ch==="\n"||ch==="\r")&&!q){if(ch==="\r"&&s[i+1]==="\n")i++;row.push(cell);rows.push(row);row=[];cell="";}else cell+=ch;}if(cell||row.length){row.push(cell);rows.push(row);}const hdr=rows.shift();return rows.filter(x=>x.length===hdr.length).map(x=>Object.fromEntries(hdr.map((h,i)=>[h,x[i]])));}

function csvString(rows, columns) {
  const quote = value => /[",\r\n]/.test(String(value ?? "")) ? '"' + String(value ?? "").replaceAll('"', '""') + '"' : String(value ?? "");
  return [columns, ...rows.map(row => columns.map(key => row[key]))].map(row => row.map(quote).join(",")).join("\n") + "\n";
}

const CHLOROPHYLL = "Chlorophyll a, corrected for pheophytin";
const EXCLUDED = [
  {site_id:"SV-268",date:"2023-07-11",routine_time:"13:08:00",routine_activity_id:"21SC60WQ_WQX-AF05218",
   chlorophyll_activity_id:"21SC60WQ_WQX-SV-268:20230711130800:SR:0.3:WB",study_time:"09:50:00",routine_value:"22.77",study_value:"15.76",day_input:"sv268day"},
  {site_id:"SV-374",date:"2023-08-08",routine_time:"10:59:00",routine_activity_id:"21SC60WQ_WQX-AF06949",
   chlorophyll_activity_id:"21SC60WQ_WQX-SV-374:20230808105900:SR:0.3:WB",study_time:"10:54:00",routine_value:"8.64",study_value:"10.91",day_input:"sv374day"},
];
const PUBLISHED = {
  "SV-268":{mean:7.4,sd:8.0,minimum:1.2,maximum:28.6,n_reported:15},
  "SV-838":{mean:24.1,sd:8.6,minimum:12.4,maximum:38.9,n_reported:15},
  "SV-839":{mean:15.4,sd:7.4,minimum:7.5,maximum:31.3,n_reported:15},
  "SV-374":{mean:10.7,sd:4.3,minimum:5.6,maximum:18.7,n_reported:4},
  "SV-840":{mean:6.1,sd:1.8,minimum:3.4,maximum:8.6,n_reported:4},
};

function recordReference(row) {
  return {activity_id:row.ActivityIdentifier,project_identifier:row.ProjectIdentifier,
    site_id:row.MonitoringLocationIdentifier,date:row.ActivityStartDate,
    time:row["ActivityStartTime/Time"],timezone:row["ActivityStartTime/TimeZoneCode"],
    depth:row["ActivityDepthHeightMeasure/MeasureValue"],depth_unit:row["ActivityDepthHeightMeasure/MeasureUnitCode"],
    characteristic:row.CharacteristicName,value:row.ResultMeasureValue,unit:row["ResultMeasure/MeasureUnitCode"],
    method:row["ResultAnalyticalMethod/MethodIdentifier"]};
}

function reconcile(inputs) {
  const three = csvParse(inputs.three).filter(row => row.CharacteristicName === CHLOROPHYLL);
  const two = csvParse(inputs.two).filter(row => row.CharacteristicName === CHLOROPHYLL);
  const dates = [...new Set(three.map(row => row.ActivityStartDate))].sort();
  if (dates.length !== 15 || three.length !== 45) throw Error("Expected the original three-site, fifteen-date lake cohort");
  for (const site of ["SV-838","SV-839","SV-840"]) {
    const rows = three.filter(row => row.MonitoringLocationIdentifier === "21SC60WQ_WQX-" + site);
    if (rows.length !== 15 || new Set(rows.map(row => row.ActivityStartDate)).size !== 15) throw Error("Lake reference dates are incomplete: " + site);
  }
  const candidates = two.filter(row => dates.includes(row.ActivityStartDate));
  if (candidates.length !== 32) throw Error("Expected original thirty-two date-matched upstream candidates");
  const exclusionEvidence = EXCLUDED.map(choice => {
    const day = csvParse(inputs[choice.day_input]);
    const excluded = candidates.filter(row => row.ActivityIdentifier === choice.chlorophyll_activity_id);
    const selected = candidates.filter(row => row.MonitoringLocationIdentifier === "21SC60WQ_WQX-" + choice.site_id &&
      row.ActivityStartDate === choice.date && row["ActivityStartTime/Time"] === choice.study_time);
    const routine = day.filter(row => row.ActivityIdentifier === choice.routine_activity_id &&
      row.ProjectIdentifier === "SWS-2023" && row.ActivityStartDate === choice.date &&
      row["ActivityStartTime/Time"] === choice.routine_time);
    if (excluded.length !== 1 || selected.length !== 1 || !routine.length ||
        excluded[0].ResultMeasureValue !== choice.routine_value || selected[0].ResultMeasureValue !== choice.study_value) {
      throw Error("Original activity/time/value evidence does not match " + choice.site_id);
    }
    return {...choice,project_identifier_alone_is_insufficient:true,
      timezone_interpretation:"Chlorophyll labels EST; SWS-2023 labels EDT. Original labels are retained; this association uses the displayed local clock, not a UTC-normalized timestamp.",
      excluded_original_record:recordReference(excluded[0]),retained_original_record:recordReference(selected[0]),
      coincident_routine_activity:{activity_id:choice.routine_activity_id,project_identifier:"SWS-2023",
        date:choice.date,time:choice.routine_time,timezone:routine[0]["ActivityStartTime/TimeZoneCode"],
        original_result_rows:routine.length,characteristics:[...new Set(routine.map(row=>row.CharacteristicName))]}};
  });
  const excludedIds = new Set(EXCLUDED.map(row => row.chlorophyll_activity_id));
  const selected = [...three,...candidates.filter(row => !excludedIds.has(row.ActivityIdentifier))]
    .sort((a,b) => [a.MonitoringLocationIdentifier,a.ActivityStartDate,a["ActivityStartTime/Time"],a.ActivityIdentifier].join("|")
      .localeCompare([b.MonitoringLocationIdentifier,b.ActivityStartDate,b["ActivityStartTime/Time"],b.ActivityIdentifier].join("|")));
  if (new Set(selected.map(row => row.ActivityIdentifier)).size !== 75) throw Error("Selected original activity IDs are not unique");
  const summary = Object.entries(PUBLISHED).map(([site,published]) => {
    const rows = selected.filter(row => row.MonitoringLocationIdentifier === "21SC60WQ_WQX-" + site);
    if (rows.length !== 15 || new Set(rows.map(row => row.ActivityStartDate)).size !== 15) throw Error("Expected one source observation per lake date: " + site);
    if (rows.some(row => row["ResultMeasure/MeasureUnitCode"] !== "ug/L" || row.ResultMeasureValue.trim() === "" ||
      !Number.isFinite(Number(row.ResultMeasureValue)))) throw Error("Original chlorophyll unit or quantity differs");
    const values = rows.map(row => Number(row.ResultMeasureValue));
    const mean = values.reduce((a,b)=>a+b,0) / values.length;
    const sd = Math.sqrt(values.reduce((sum,value)=>sum+(value-mean)**2,0)/(values.length-1));
    const minimum = Math.min(...values), maximum = Math.max(...values);
    return {site_id:site,cohort_n:rows.length,mean,sample_sd:sd,minimum,maximum,units:"ug/L",
      published_mean:published.mean,published_sd:published.sd,published_minimum:published.minimum,
      published_maximum:published.maximum,published_n_reported:published.n_reported,
      rounded_mean_sd_match:Math.abs(mean-published.mean)<=0.05000001 && Math.abs(sd-published.sd)<=0.05000001,
      rounded_range_match:Math.abs(minimum-published.minimum)<=0.05000001 && Math.abs(maximum-published.maximum)<=0.05000001};
  });
  const result = {schema:"upstate.eighteenmile-chlorophyll-cohort/v1",operation_id:"ECO-INTEGRATE-ASTRA13-20261012",
    cohort_basis:"Reconciled original WQP study-date cohort; separate same-date SWS-2023 routine visits identified by publisher-displayed local date/time",
    dates,source_rows:{three_lake_results:csvParse(inputs.three).length,three_lake_chlorophyll:three.length,
      upstream_chlorophyll:two.length,upstream_date_candidates:candidates.length,excluded_same_date_routine:exclusionEvidence.length,selected:selected.length},
    statistic_basis:"Arithmetic mean and sample standard deviation (n-1) of original measured concentrations",
    parameter:CHLOROPHYLL,units:"ug/L",selected_original_records_modified:false,
    publisher_table:{url:"https://des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/2023LakeProgramFinalReport.pdf",
      table:7,printed_page:14,pdf_viewer_page:21,printed_n_sum:53,methods_samples:75,
      interpretation:"The reconciled measured cohort has fifteen observations at each site and reproduces the published means and sample deviations. Original printed n=4 fields for SV-374 and SV-840 are retained separately."},
    exclusion_evidence:exclusionEvidence,summary};
  return {selected,summary,result,
    files:{"study_chlorophyll_cohort.csv":csvString(selected,Object.keys(three[0])),
      "cohort_summary.csv":csvString(summary,Object.keys(summary[0])),
      "cohort_reconciliation.json":JSON.stringify(result,null,2)+"\n"}};
}

export { csvParse, csvString, reconcile };
