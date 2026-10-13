// Original utility E. coli analysis. Input: complete publisher-derived CSV and station-membership CSV.
// Values keep their publisher detection status. Numerical results below a listed reporting limit remain numerical results.
function parseCSV(text){
 const rows=[];let row=[],cell="",quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else quoted=false;}else cell+=ch;}else if(ch==='"')quoted=true;else if(ch===","){row.push(cell);cell="";}else if(ch==="\n"||ch==="\r"){if(ch==="\r"&&text[i+1]==="\n")i++;row.push(cell);rows.push(row);row=[];cell="";}else cell+=ch;}
 if(quoted)throw Error("Unclosed CSV quote");if(cell||row.length){row.push(cell);rows.push(row);}const header=rows.shift();if(header?.[0])header[0]=header[0].replace(/^\uFEFF/,"");
 return {header,rows:rows.filter(r=>r.some(c=>c!=="")).map((r,i)=>{if(r.length!==header.length)throw Error("CSV width at row"+i);return Object.fromEntries(header.map((k,j)=>[k,r[j]]));})};
}

function median(values){
 if(!values.length)return null;
 const a=[...values].sort((x,y)=>x-y),m=Math.floor(a.length/2);
 return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function commentFlags(text){
 const flags=[];
 if(/info(?:r)?mation\s+only/i.test(text))flags.push("information_only");
 if(/ECOL[\s\S]*power failure/i.test(text))flags.push("ecoli_analysis_interrupted");
 if(/BOD-SM-SM5210B/i.test(text))flags.push("other_analyte_BOD_comment");
 return flags;
}
function prepareRecords(csv){
 const parsed=parseCSV(csv),seen=new Set();
 const statuses={"":"measured","Present Above Quantification Limit":"above_limit","Present Below Quantification Limit":"below_limit","Not Detected":"not_detected","Not Reported":"not_reported"};
 const required=["OrganizationIdentifier","DetectionQuantitationLimitTypeName","ResultCommentText","source_file","source_row","utility_id","MonitoringLocationIdentifier","ActivityIdentifier","ActivityStartDate","ActivityTypeCode","ResultDetectionConditionText","ResultMeasureValue","ResultMeasure/MeasureUnitCode","ResultAnalyticalMethod/MethodIdentifier","ResultAnalyticalMethod/MethodIdentifierContext","DetectionQuantitationLimitMeasure/MeasureValue","DetectionQuantitationLimitMeasure/MeasureUnitCode"];
 for(const k of required)if(!parsed.header.includes(k))throw Error("Missing input field: "+k);
 return parsed.rows.map(r=>{
  const identity=r.OrganizationIdentifier+"|"+r.ActivityIdentifier;
  if(seen.has(identity))throw Error("Duplicate original activity: "+identity);seen.add(identity);
  const date=r.ActivityStartDate,month=Number(date.slice(5,7));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||month<1||month>12)throw Error("Invalid original date");
  const numeric=s=>String(s).trim()===""?null:Number(s);
  const value=numeric(r.ResultMeasureValue),limit=numeric(r["DetectionQuantitationLimitMeasure/MeasureValue"]);
  if([value,limit].some(v=>v!==null&&(!Number.isFinite(v)||v<0)))throw Error("Invalid source numerical token");
  const condition=r.ResultDetectionConditionText,status=statuses[condition];
  if(!status)throw Error("Unknown original censoring condition: "+condition);
  if(condition&&value!==null)throw Error("Condition and result value coexist");
  const resultUnit=r["ResultMeasure/MeasureUnitCode"],limitUnit=r["DetectionQuantitationLimitMeasure/MeasureUnitCode"];
  const normalize=u=>u.replace(/\s/g,"").toLowerCase()==="mpn/100ml"?"MPN per 100 mL":u;
  const unit=normalize(resultUnit||limitUnit);
  if(unit&&unit!=="MPN per 100 mL")throw Error("Separate incompatible source unit: "+unit);
  if(value!==null&&!resultUnit)throw Error("Numerical value without source unit");
  let lower=null,upper=null,bounded=false;
  if(status==="measured"&&value!==null){lower=value;upper=value;bounded=true;}
  if(["below_limit","not_detected"].includes(status)&&limit!==null&&limitUnit){lower=0;upper=limit;bounded=true;}
  if(status==="above_limit"&&limit!==null&&limitUnit){lower=limit;upper=Infinity;bounded=true;}
  return {source_file:r.source_file,source_row:Number(r.source_row),utility_id:r.utility_id,station_id:r.MonitoringLocationIdentifier,
   activity_id:r.ActivityIdentifier,activity_type:r.ActivityTypeCode,date,year:date.slice(0,4),month,
   season:month===12||month<=2?"DJF":month<=5?"MAM":month<=8?"JJA":"SON",
   time:r["ActivityStartTime/Time"],timezone:r["ActivityStartTime/TimeZoneCode"],
   method_context:r["ResultAnalyticalMethod/MethodIdentifierContext"],method:r["ResultAnalyticalMethod/MethodIdentifier"],
   status,result_value:value,limit_value:limit,limit_type:r.DetectionQuantitationLimitTypeName,
   source_result_unit:resultUnit,source_limit_unit:limitUnit,unit,lower,upper,bounded,
   original_hydrologic_condition:r.HydrologicCondition,original_hydrologic_event:r.HydrologicEvent,
   source_result_comment:r.ResultCommentText,source_comment_flags:commentFlags(r.ResultCommentText)};
 });
}
function summarize(rows){
 const counts=Object.fromEntries(["measured","above_limit","below_limit","not_detected","not_reported"].map(k=>[k,rows.filter(r=>r.status===k).length]));
 const measured=rows.filter(r=>r.status==="measured"&&r.result_value!==null).map(r=>r.result_value),bounded=rows.filter(r=>r.bounded);
 const lower=median(bounded.map(r=>r.lower)),upper=median(bounded.map(r=>r.upper));
 const dates=[...new Set(rows.map(r=>r.date))].sort();
 return {records:rows.length,...counts,information_only_comments:rows.filter(r=>r.source_comment_flags.includes("information_only")).length,interrupted_ecoli_comments:rows.filter(r=>r.source_comment_flags.includes("ecoli_analysis_interrupted")).length,other_analyte_comments:rows.filter(r=>r.source_comment_flags.includes("other_analyte_BOD_comment")).length,interval_records:bounded.length,unbounded_or_unreported_records:rows.length-bounded.length,
   median_lower:lower,median_upper:upper===Infinity?null:upper,median_upper_unbounded:upper===Infinity,
   numerical_result_median:median(measured),numerical_result_min:measured.length?Math.min(...measured):null,
   numerical_result_max:measured.length?Math.max(...measured):null,
   sample_dates:dates.length,first_date:dates[0]||null,last_date:dates.at(-1)||null,
   months_observed:[...new Set(rows.map(r=>r.month))].sort((a,b)=>a-b),years_observed:[...new Set(rows.map(r=>r.year))].sort(),
   source_units:[...new Set(rows.flatMap(r=>[r.source_result_unit,r.source_limit_unit]).filter(Boolean))].sort()};
}
function supportOnly(summary){
 const {median_lower,median_upper,median_upper_unbounded,numerical_result_median,numerical_result_min,numerical_result_max,...support}=summary;
 return support;
}
function groups(rows,keys){
 const by=new Map();
 for(const r of rows){const key=JSON.stringify(keys.map(k=>r[k]));if(!by.has(key))by.set(key,[]);by.get(key).push(r);}
 return [...by.values()].map(g=>({...Object.fromEntries(keys.map(k=>[k,g[0][k]])),...summarize(g)}))
 .sort((a,b)=>JSON.stringify(keys.map(k=>a[k])).localeCompare(JSON.stringify(keys.map(k=>b[k]))));
}
function analyzeMicrobial(csv,stationCsv){
 const records=prepareRecords(csv),members=parseCSV(stationCsv).rows,byStation=new Map(members.map(r=>[r.station_id,r]));
 if(byStation.size!==members.length)throw Error("Duplicate station membership");
 for(const r of records){const s=byStation.get(r.station_id);if(!s||s.utility_id!==r.utility_id)throw Error("Original station membership mismatch");}
 const routine=records.filter(r=>r.activity_type==="Sample-Routine");
 const replicates=records.filter(r=>r.activity_type!=="Sample-Routine");
 const keys=["utility_id","station_id","method_context","method","unit"];
 const annotate=rows=>rows.map(r=>({...r,station_name:byStation.get(r.station_id).station_name,source_huc8:byStation.get(r.station_id).source_huc8,matched_huc12:byStation.get(r.station_id).matched_huc12,selection_basis:byStation.get(r.station_id).selection_basis}));
 return {schema:"upstate.microbial-temporal-analysis/v1",selection:{activity_type:"Sample-Routine",source_records:records.length,routine_records:routine.length,replicate_records:replicates.length,stations:byStation.size},
  method:{intervals:"Numerical [value,value]; below-limit/not-detected [0,reported limit]; above-limit [reported limit,infinity]; no substitution for missing limits. Inclusive endpoints are conservative bounds.",
   median_bounds:"Median of lower endpoints and median of upper endpoints among records with interpretable intervals; numerical-result-only median retained separately.",
   seasons:"Calendar month groups DJF, MAM, JJA, SON, pooled across the requested period; annual summaries use original calendar year.",
   units:"MPN/100mL and MPN/100 ml are equivalent physical units; original strings retained. Analytical methods remain separate.",
   replicate:"Quality control records retained in separate output and excluded from routine sampling summaries.",
   comment_sensitivity:"All original routine observations are retained. A separate sensitivity excludes only records whose original result comment explicitly says Information Only (including publisher typo Infomation). ECOL power-failure and other-analyte BOD comments are separately flagged; no rewritten publisher detection status.",
   temporal_scope:"Descriptive sampling support and censoring-aware summaries; station and method identity retained."},
  overall:{...supportOnly(summarize(routine)),station_count:new Set(routine.map(r=>r.station_id)).size},
  utility_support:groups(routine,["utility_id"]).map(g=>({...supportOnly(g),station_count:new Set(routine.filter(r=>r.utility_id===g.utility_id).map(r=>r.station_id)).size})),
  station:annotate(groups(routine,keys)),
  station_information_only_sensitivity:annotate(groups(routine,keys).map(g=>{const kept=routine.filter(r=>keys.every(k=>r[k]===g[k])&&!r.source_comment_flags.includes("information_only"));return {...Object.fromEntries(keys.map(k=>[k,g[k]])),original_routine_records:g.records,...summarize(kept)};})),
  station_year:annotate(groups(routine,[...keys,"year"])),
  station_season:annotate(groups(routine,[...keys,"season"])),
  station_month:annotate(groups(routine,[...keys,"month"])),
  records:records.map(r=>({...r,upper:r.upper===Infinity?null:r.upper,upper_unbounded:r.upper===Infinity})),replicates:replicates.map(r=>({...r,upper:r.upper===Infinity?null:r.upper,upper_unbounded:r.upper===Infinity}))};
}


function ranks(values){const order=values.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v),out=new Array(values.length);for(let i=0;i<order.length;){let j=i+1;while(j<order.length&&order[j].v===order[i].v)j++;const rank=(i+1+j)/2;for(let k=i;k<j;k++)out[order[k].i]=rank;i=j;}return out;}
function correlation(a,b){if(a.length!==b.length||a.length<2)return null;const ma=a.reduce((x,y)=>x+y,0)/a.length,mb=b.reduce((x,y)=>x+y,0)/b.length;let ab=0,aa=0,bb=0;for(let i=0;i<a.length;i++){const x=a[i]-ma,y=b[i]-mb;ab+=x*y;aa+=x*x;bb+=y*y;}return aa&&bb?ab/Math.sqrt(aa*bb):null;}
function spearman(a,b){return correlation(ranks(a),ranks(b));}

function analyzeSameStationFlow(records,waterml){
 const series=waterml.value.timeSeries.find(s=>s.name==="USGS:02177000:00060:00003");
 if(!series||series.variable.unit.unitCode!=="ft3/s"||!series.variable.options.option.some(o=>o.optionCode==="00003"))throw Error("Expected original same-station mean discharge series");
 const daily=series.values.flatMap((b,block)=>b.value.map((v,i)=>({date:v.dateTime.slice(0,10),value:Number(v.value),qualifiers:v.qualifiers.join(";"),original_date_time:v.dateTime,source_block:block,source_index:i}))).filter(r=>r.date.startsWith("2022-")&&Number.isFinite(r.value)&&r.value!==series.variable.noDataValue);
 const by=new Map(daily.map(r=>[r.date,r]));
 if(by.size!==365||by.size!==daily.length)throw Error("Retain the complete original 365-date 2022 flow series");
 const samples=records.filter(r=>r.station_id==="USGS-02177000"&&r.activity_type==="Sample-Routine");
 const joined=samples.map(s=>{
  const f=by.get(s.date);if(!f)throw Error("Missing exact station sample-date flow: "+s.date);
  const timestamp=Date.parse(s.date+"T00:00:00Z");
  const preceding=Array.from({length:7},(_,i)=>by.get(new Date(timestamp-(i+1)*86400000).toISOString().slice(0,10)));
  const less=daily.filter(v=>v.value<f.value).length,equal=daily.filter(v=>v.value===f.value).length;
  return{...s,flow_site:"02177000",flow_variable:"00060",flow_statistic:"00003",flow_unit:"ft3/s",flow_daily_mean:f.value,flow_qualifiers:f.qualifiers,flow_original_date_time:f.original_date_time,annual_flow_midrank_percentile:100*(less+equal/2)/daily.length,antecedent7_days:preceding.filter(Boolean).length,antecedent7_mean:preceding.every(Boolean)?preceding.reduce((sum,x)=>sum+x.value,0)/7:null};
 }).sort((a,b)=>a.date.localeCompare(b.date));
 if(joined.length!==16||joined.some(r=>r.antecedent7_days!==7))throw Error("Exact original sample/antecedent coverage differs");
 const numerical=joined.filter(s=>s.status==="measured"),censored=joined.filter(s=>s.status==="not_detected");
 if(censored.length!==2||censored.some(s=>s.limit_value!==20))throw Error("This original-source sensitivity expects two non-detects at limit20");
 const endpoints=[...new Set([0,20,...numerical.map(s=>s.result_value).filter(v=>v>=0&&v<=20)])].sort((a,b)=>a-b);
 // Two interior representatives per open rank interval admit either ordering or a tie between the two censored observations.
 const candidates=[...endpoints,...endpoints.slice(0,-1).flatMap((v,i)=>[v+(endpoints[i+1]-v)/3,v+2*(endpoints[i+1]-v)/3])].sort((a,b)=>a-b);
 const sameDay=[],antecedent=[],strictSameDay=[],strictAntecedent=[];
 for(const v1 of candidates)for(const v2 of candidates){
  const assignments=new Map([[censored[0].activity_id,v1],[censored[1].activity_id,v2]]);
  const y=joined.map(s=>assignments.has(s.activity_id)?assignments.get(s.activity_id):s.result_value);
  const sd=spearman(joined.map(s=>s.flow_daily_mean),y),ad=spearman(joined.map(s=>s.antecedent7_mean),y);
  sameDay.push(sd);antecedent.push(ad);if(v1<20&&v2<20){strictSameDay.push(sd);strictAntecedent.push(ad);}
 }
 return{daily,joined,summary:{
  station_id:"USGS-02177000",original_daily_records_2022:daily.length,joined_sample_dates:joined.length,numerical_samples:numerical.length,not_detected_samples:censored.length,
  sample_date_qualifiers:[...new Set(joined.flatMap(r=>r.flow_qualifiers.split(";")))],
  numerical_only_same_day_spearman:spearman(numerical.map(s=>s.flow_daily_mean),numerical.map(s=>s.result_value)),
  all16_same_day_censoring_rank_range:[Math.min(...sameDay),Math.max(...sameDay)],
  numerical_only_antecedent7_spearman:spearman(numerical.map(s=>s.antecedent7_mean),numerical.map(s=>s.result_value)),
  all16_antecedent7_censoring_rank_range:[Math.min(...antecedent),Math.max(...antecedent)],
  strict_below20_same_day_rank_range:[Math.min(...strictSameDay),Math.max(...strictSameDay)],
  strict_below20_antecedent7_rank_range:[Math.min(...strictAntecedent),Math.max(...strictAntecedent)],
  strict_rank_assignments_evaluated:strictSameDay.length,
  rank_assignments_evaluated:candidates.length**2,censoring_candidates:candidates,
  rank_method:"Spearman correlation with average ranks for ties. Endpoints and two distinct interior representatives in every measured-value rank interval enumerate all weak orderings of the two non-detects on conservative [0,20] bounds.",
  interpretation:"The censoring range is sensitivity to allowed non-detect rankings, not a confidence interval. Same-day discharge is a calendar-date daily mean; antecedent mean is the seven complete prior calendar days.",
  source_query:waterml.value.queryInfo.queryURL,original_series_name:series.name,flow_unit:series.variable.unit.unitCode
 }};
}


function samplingCoverage(analysis){
 const routine=analysis.records.filter(r=>r.activity_type==="Sample-Routine");
 const years=[...new Set(routine.map(r=>r.year))].sort();
 const stationYears=new Map();
 for(const r of routine){if(!stationYears.has(r.station_id))stationYears.set(r.station_id,new Set());stationYears.get(r.station_id).add(r.year);}
 const panel=[...stationYears].filter(([,y])=>years.every(year=>y.has(year))).map(([id])=>id).sort();
 const seen=new Set();
 const annual=years.map(year=>{const rows=routine.filter(r=>r.year===year),stations=[...new Set(rows.map(r=>r.station_id))];const result={year,records:rows.length,stations:stations.length,new_stations:stations.filter(s=>!seen.has(s)).length,complete_panel_records:rows.filter(r=>panel.includes(r.station_id)).length};stations.forEach(s=>seen.add(s));return result;});
 return {complete_panel_station_ids:panel,annual,complete_panel_records:routine.filter(r=>panel.includes(r.station_id)).length,hydrologic_condition_counts:Object.fromEntries([...new Set(analysis.records.map(r=>r.original_hydrologic_condition||"(blank)"))].map(v=>[v,analysis.records.filter(r=>(r.original_hydrologic_condition||"(blank)")===v).length]))};
}
function flowCoverage(flow){
 const values=flow.daily.map(r=>r.value).sort((a,b)=>a-b);
 const p=.95*(values.length-1),lo=Math.floor(p),f=p-lo,q95=values[lo]+f*(values[Math.ceil(p)]-values[lo]);
 return {year:"2022",daily_records:values.length,mean:values.reduce((a,b)=>a+b,0)/values.length,median:median(values),minimum:values[0],maximum:values.at(-1),percentile95_linear:q95,
  sample_days_above_or_equal_percentile95:flow.joined.filter(r=>r.flow_daily_mean>=q95).length,
  sampled_month_counts:Object.fromEntries([...new Set(flow.joined.map(r=>r.month))].sort((a,b)=>a-b).map(m=>[String(m),flow.joined.filter(r=>r.month===m).length])),
  unsampled_months:Array.from({length:12},(_,i)=>i+1).filter(m=>!flow.joined.some(r=>r.month===m)),
  annual_maximum_dates:flow.daily.filter(r=>r.value===values.at(-1)).map(r=>r.date)};
}
function csvOutput(rows){
 const keys=[...new Set(rows.flatMap(r=>Object.keys(r)))];
 const cell=x=>'"'+(x===null||x===undefined?"":typeof x==="object"?JSON.stringify(x):String(x)).replace(/"/g,'""')+'"';
 return keys.map(cell).join(",")+"\n"+rows.map(r=>keys.map(k=>cell(r[k])).join(",")).join("\n")+"\n";
}
function buildOutputs(csv,stationCsv,waterml){
 const analysis=analyzeMicrobial(csv,stationCsv),flow=analyzeSameStationFlow(analysis.records,waterml);
 const coverage=samplingCoverage(analysis),flow_coverage=flowCoverage(flow);
 const summary={schema:analysis.schema,selection:analysis.selection,method:analysis.method,overall:analysis.overall,utility_support:analysis.utility_support,sampling_coverage:coverage,flow:flow.summary,flow_sampling_coverage:flow_coverage,
  output_conventions:{csv:"RFC 4180-style quoted cells; arrays use JSON within the quoted cell; empty cells represent null/undefined.",record_intervals:"All 730 original records retained. upper_unbounded=true means the interval upper end is infinity; the empty upper cell alone never encodes infinity.",comment_flags:"Flags expose literal publisher comment markers; original comment, detection status, numerical value, source file and original row remain available.",flow_rank_sensitivity:"Closed [0,20] results are conservative; strict [0,20) results exclude the reported limit. Both enumerate possible weak rank orderings for the two non-detects and neither is a sampling confidence interval."}};
 const rows={
 "station-summary.csv":analysis.station,
 "station-year-summary.csv":analysis.station_year,
 "station-season-summary.csv":analysis.station_season,
 "station-month-summary.csv":analysis.station_month,
 "record-intervals.csv":analysis.records,
 "field-replicates.csv":analysis.replicates,
 "comment-sensitivity.csv":analysis.station_information_only_sensitivity,
 "flagged-source-comments.csv":analysis.records.filter(r=>r.source_comment_flags.length),
 "annual-sampling-coverage.csv":coverage.annual,
 "flow-daily-2022.csv":flow.daily,
 "flow-sample-join.csv":flow.joined
 };
 return {files:{...Object.fromEntries(Object.entries(rows).map(([name,rows])=>[name,csvOutput(rows)])),"analysis-summary.json":JSON.stringify(summary,null,2)+"\n"},analysis,flow,summary};
}

export {parseCSV,median,prepareRecords,summarize,groups,analyzeMicrobial,analyzeSameStationFlow,samplingCoverage,flowCoverage,csvOutput,buildOutputs};
