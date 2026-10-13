// Copyright TokenJunkieLabs. Descriptive analysis of retained original observations.
export function analyzePairedStudy(chlorophyll, measurements, options = {}) {
  const stationOrder = options.stationOrder || ["SV-268", "SV-838", "SV-839", "SV-374", "SV-840"];
  const short = r => r.station_id.replace(/^21SC60WQ(?:_WQX)?-/, "");
  const requireValue = (value, label) => {
    if (String(value).trim() === "" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(String(value))) throw Error("Non-numeric " + label);
    const n = Number(value); if (!Number.isFinite(n) || n < 0) throw Error("Invalid concentration " + label); return n;
  };
  const unique = values => [...new Set(values)].sort();
  const sum = a => a.reduce((x, y) => x + y, 0);
  const stats = a => {
    if (!a.length) return { n: 0, mean: null, median: null, sample_sd: null, minimum: null, maximum: null };
    const sorted = [...a].sort((x,y)=>x-y), n = a.length, mean = sum(a)/n;
    return { n, mean, median: n%2 ? sorted[(n-1)/2] : (sorted[n/2-1]+sorted[n/2])/2,
      sample_sd: n>1 ? Math.sqrt(sum(a.map(x=>(x-mean)**2))/(n-1)) : null, minimum: sorted[0], maximum: sorted[n-1] };
  };
  const timeSeconds = value => {
    if (!/^\d{2}:\d{2}:\d{2}$/.test(value)) throw Error("Unexpected original clock " + value);
    const [h,m,s] = value.split(":").map(Number);
    if (h>23 || m>59 || s>59) throw Error("Invalid original clock");
    return h*3600+m*60+s;
  };
  const sourceSupport = r => ({
    record_id:r.record_id, source_path:r.source_path, source_sha256:r.source_sha256,
    source_url:r.source_url, source_record_index:Number(r.source_record_index),
    station_id:r.station_id, activity_id:r.activity_id, project_id:r.project_id,
    sample_date:r.sample_date, sample_time:r.sample_time, sample_timezone:r.sample_timezone,
    activity_type:r.activity_type, activity_depth:r.activity_depth, activity_depth_unit:r.activity_depth_unit,
    characteristic:r.characteristic, sample_fraction:r.sample_fraction, reported_value:r.reported_value,
    reported_unit:r.reported_unit, detection_condition:r.detection_condition,
    detection_limit_type:r.detection_limit_type, detection_limit:r.detection_limit,
    detection_limit_unit:r.detection_limit_unit, qualifier:r.qualifier,
    analytical_method_id:r.analytical_method_id, analytical_method_context:r.analytical_method_context,
    analytical_method_name:r.analytical_method_name, result_status:r.result_status,
    result_comment:r.result_comment, selection_basis:r.selection_basis || ""
  });
  const support = r => ({record_id:r.record_id});
  const validateCommon = r => {
    if (!stationOrder.includes(short(r)) || r.media !== "Water" || r.sample_fraction !== "Total" || r.result_status !== "Final" || r.qualifier !== "") throw Error("Unexpected source scope " + r.record_id);
    if (!r.record_id || !r.source_sha256 || !r.activity_id || !r.sample_date || !r.sample_timezone) throw Error("Missing source identity");
    timeSeconds(r.sample_time);
  };
  if (!chlorophyll.length || unique(chlorophyll.map(r=>r.record_id)).length !== chlorophyll.length) throw Error("Empty or repeated chlorophyll source rows");
  const dates = unique(chlorophyll.map(r=>r.sample_date));
  const cMap = new Map();
  for (const r of chlorophyll) {
    validateCommon(r);
    if (r.project_id!=="CHLA" || r.characteristic!=="Chlorophyll a, corrected for pheophytin" || r.reported_unit!=="ug/L" || r.detection_condition!=="Present Above Quantification Limit" || r.study_chla_selection!=="selected_reconciled_study") throw Error("Unexpected chlorophyll scope " + r.record_id);
    requireValue(r.reported_value, r.record_id);
    const k = short(r)+"|"+r.sample_date;
    if (cMap.has(k)) throw Error("Repeated station-date in selected chlorophyll cohort");
    cMap.set(k,r);
  }
  for (const date of dates) for (const site of stationOrder) if (!cMap.has(site+"|"+date)) throw Error("Incomplete paired chlorophyll calendar " + date);
  const micros = measurements.filter(r=>r.characteristic==="Microcystins/nodularin" && stationOrder.includes(short(r)));
  if (unique(micros.map(r=>r.record_id)).length !== micros.length) throw Error("Repeated microcystin source rows");
  const interval = r => {
    validateCommon(r);
    if (r.project_id !== "SCDHEC-MICRO") throw Error("Unexpected microcystin project");
    if (r.detection_condition === "Present Above Quantification Limit") {
      if (r.reported_unit !== "ug/L") throw Error("Unexpected quantified unit");
      const n = requireValue(r.reported_value, r.record_id);
      return {lower:n,upper:n,lower_open:false,upper_open:false,status:"quantified",unit:"ug/L"};
    }
    if (r.detection_condition === "Below Reporting Limit") {
      if (r.detection_limit_type !== "Lower Reporting Limit" || r.detection_limit_unit !== "ug/L" || r.reported_value !== "") throw Error("Unexpected censored-source contract");
      const n = requireValue(r.detection_limit, r.record_id);
      if (n <= 0) throw Error("Nonpositive reporting limit");
      return {lower:0,upper:n,lower_open:false,upper_open:true,status:"below_reporting_limit",unit:"ug/L"};
    }
    throw Error("Unsupported original detection condition: " + r.detection_condition);
  };
  const mIntervals = new Map(micros.map(r=>[r.record_id,interval(r)]));
  const clockKey = r => [r.station_id,r.sample_date,r.sample_time,r.sample_timezone].join("|");
  const dateKey = r => [r.station_id,r.sample_date].join("|");
  const joined = chlorophyll.map(c => {
    const same = micros.filter(m=>dateKey(m)===dateKey(c));
    const exact = same.filter(m=>clockKey(m)===clockKey(c));
    if (exact.length>1) throw Error("Ambiguous identical-clock microcystin records");
    const picked = exact[0] || null;
    return {station:short(c),sample_date:c.sample_date,chlorophyll:support(c),
      chlorophyll_ug_l:Number(c.reported_value),
      status:picked?"exact_recorded_clock":same.length?"same_date_different_clock":"no_same_date_microcystin",
      microcystin:picked?support(picked):null,microcystin_interval:picked?mIntervals.get(picked.record_id):null,
      same_date_candidate_count:same.length,
      same_date_candidates:same.map(m=>({source:support(m),interval:mIntervals.get(m.record_id),
        recorded_clock_offset_minutes:m.sample_timezone===c.sample_timezone?(timeSeconds(m.sample_time)-timeSeconds(c.sample_time))/60:null}))};
  }).sort((a,b)=>a.sample_date.localeCompare(b.sample_date)||stationOrder.indexOf(a.station)-stationOrder.indexOf(b.station));
  const pairedRows=[], pairedSummary=[];
  for(let i=0;i<stationOrder.length;i++) for(let j=i+1;j<stationOrder.length;j++) {
    const aSite=stationOrder[i],bSite=stationOrder[j], rows=[];
    for(const date of dates) {
      const a=cMap.get(aSite+"|"+date),b=cMap.get(bSite+"|"+date),av=Number(a.reported_value),bv=Number(b.reported_value);
      const row={station_a:aSite,station_b:bSite,sample_date:date,unit:"ug/L",
        value_a:av,value_b:bv,difference_b_minus_a:bv-av,
        ratio_b_over_a:av>0?bv/av:null,percent_difference_relative_to_a:av>0?100*(bv-av)/av:null,
        recorded_clock_separation_minutes:a.sample_timezone===b.sample_timezone?Math.abs(timeSeconds(b.sample_time)-timeSeconds(a.sample_time))/60:null,
        source_a:support(a),source_b:support(b)};
      rows.push(row);pairedRows.push(row);
    }
    const differences=rows.map(r=>r.difference_b_minus_a), ratios=rows.map(r=>r.ratio_b_over_a).filter(v=>v!==null);
    pairedSummary.push({station_a:aSite,station_b:bSite,unit:"ug/L",paired_dates:rows.length,
      difference_b_minus_a:stats(differences),ratio_b_over_a:stats(ratios),
      geometric_mean_ratio_b_over_a:ratios.length===rows.length&&ratios.every(x=>x>0)?Math.exp(sum(ratios.map(Math.log))/ratios.length):null,
      b_lower_dates:differences.filter(x=>x<0).length,b_equal_dates:differences.filter(x=>x===0).length,b_higher_dates:differences.filter(x=>x>0).length,
      clock_separation_minutes:stats(rows.map(r=>r.recorded_clock_separation_minutes).filter(v=>v!==null))});
  }
  const microPairs=[], microPairSummary=[];
  const strictMap=new Map(joined.filter(x=>x.microcystin).map(x=>[x.station+"|"+x.sample_date,x]));
  for(let i=0;i<stationOrder.length;i++) for(let j=i+1;j<stationOrder.length;j++) {
    const aSite=stationOrder[i],bSite=stationOrder[j],rows=[];
    for(const date of dates) {
      const a=strictMap.get(aSite+"|"+date),b=strictMap.get(bSite+"|"+date);if(!a||!b)continue;
      const x=a.microcystin_interval,y=b.microcystin_interval;
      const lower=y.lower-x.upper,upper=y.upper-x.lower,lowerOpen=y.lower_open||x.upper_open,upperOpen=y.upper_open||x.lower_open;
      const direction=lower>0||(lower===0&&lowerOpen)?"b_higher":upper<0||(upper===0&&upperOpen)?"b_lower":lower===0&&upper===0?"equal_quantified":"unresolved_by_reporting_limits";
      const row={station_a:aSite,station_b:bSite,sample_date:date,unit:"ug/L",difference_b_minus_a_lower:lower,
        difference_b_minus_a_upper:upper,lower_open:lowerOpen,upper_open:upperOpen,identifiable_direction:direction,
        a_interval:x,b_interval:y,source_a:a.microcystin,source_b:b.microcystin};
      rows.push(row);microPairs.push(row);
    }
    microPairSummary.push({station_a:aSite,station_b:bSite,paired_dates:rows.length,
      b_higher_dates:rows.filter(r=>r.identifiable_direction==="b_higher").length,
      b_lower_dates:rows.filter(r=>r.identifiable_direction==="b_lower").length,
      equal_quantified_dates:rows.filter(r=>r.identifiable_direction==="equal_quantified").length,
      unresolved_dates:rows.filter(r=>r.identifiable_direction==="unresolved_by_reporting_limits").length,
      mean_difference_lower:rows.length?sum(rows.map(r=>r.difference_b_minus_a_lower))/rows.length:null,
      mean_difference_upper:rows.length?sum(rows.map(r=>r.difference_b_minus_a_upper))/rows.length:null,
      mean_lower_open:rows.some(r=>r.lower_open),mean_upper_open:rows.some(r=>r.upper_open),unit:"ug/L"});
  }
  const strictIds=new Set(joined.filter(r=>r.microcystin).map(r=>r.microcystin.record_id));
  const duplicateDates=[...new Set(micros.map(dateKey))].map(k=>micros.filter(r=>dateKey(r)===k)).filter(rows=>rows.length>1).map(rows=>({station:short(rows[0]),sample_date:rows[0].sample_date,source_records:rows.map(support)}));
  const sourceRows=[...chlorophyll,...micros].map(sourceSupport);
  return{
    schema:"upstate.eighteenmile-paired-observations/v1",
    methods:{
      units:"Original ug/L; source numbers and detection-limit units retained.",
      chlorophyll_cohort:"Existing original five-site CHLA project/calendar/displayed-clock reconciliation, unchanged.",
      chlorophyll_pairing:"Same original calendar date; each site has one selected result. Stations were sampled at different recorded times.",
      cross_analyte_pairing:"Exact station, original date, displayed clock and timezone label; distinct agency project/activity identities retained. Same-date alternatives are displayed separately.",
      sample_depth:"The published study describes surface (0.3 m) microcystin sampling alongside chlorophyll (Cyanotoxins methods and Table 8). Individual selected CHLA activities encode 0.3 m; linked WQP microcystin activity depth and unit fields are blank. Preserve the report protocol and individual source fields together.",
      microcystin_scope:"All original SCDHEC-MICRO records at the five sites, plus a separately labeled exact-clock CHLA-linked subset.",
      censoring:"A below-reporting-limit concentration is represented by [0, original reporting limit), assuming physical nonnegative concentration. Quantified observations are point values. Sample-mean bounds are interval arithmetic, not imputed estimates or confidence intervals.",
      paired_microcystin:"Only microcystin observations with exact recorded-clock CHLA links enter same-date spatial contrasts; both original interval endpoints propagate.",
      inference:"Descriptive comparisons of retained 2023 sampled dates. No population inference, seasonal weighting, simultaneous-sample claim, hydrologic travel-time matching or concentration-to-load conversion.",
      timezones:"Original EST labels remain unchanged; displayed-clock differences do not convert source timestamps to UTC.",
      printed_report:"Original printed sample counts and study statements remain in the published study source."
    },
    coverage:{chlorophyll_rows:chlorophyll.length,chlorophyll_dates:dates.length,station_order:stationOrder,
      microcystin_campaign_rows:micros.length,microcystin_campaign_dates:unique(micros.map(r=>r.sample_date)).length,
      microcystin_quantified:micros.filter(r=>mIntervals.get(r.record_id).status==="quantified").length,
      microcystin_below_reporting_limit:micros.filter(r=>mIntervals.get(r.record_id).status==="below_reporting_limit").length,
      exact_clock_links:strictIds.size,exact_clock_quantified:micros.filter(r=>strictIds.has(r.record_id)&&mIntervals.get(r.record_id).status==="quantified").length,exact_clock_below_limit:micros.filter(r=>strictIds.has(r.record_id)&&mIntervals.get(r.record_id).status==="below_reporting_limit").length,same_date_different_clock:joined.filter(r=>r.status==="same_date_different_clock").length,
      no_same_date_microcystin:joined.filter(r=>r.status==="no_same_date_microcystin").length,
      chlorophyll_spatial_pairs:pairedRows.length,microcystin_spatial_pairs:microPairs.length},
    chlorophyll_station_summary:stationOrder.map(station=>({station,unit:"ug/L",...stats(chlorophyll.filter(r=>short(r)===station).map(r=>Number(r.reported_value)))})),
    chlorophyll_pair_summary:pairedSummary,chlorophyll_pairs:pairedRows,
    cross_analyte_links:joined,microcystin_pair_summary:microPairSummary,microcystin_pairs:microPairs,
    repeated_microcystin_station_dates:duplicateDates,
    microcystin_campaign:micros.map(r=>({source:support(r),interval:mIntervals.get(r.record_id),exact_chlorophyll_clock_link:strictIds.has(r.record_id)})),
    source_rows:sourceRows
  };
}
