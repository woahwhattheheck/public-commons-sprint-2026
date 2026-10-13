// Reconcile the original 2023 study records with the published Table 8 summary.
export function reconcileMicrocystinReport(selectedChlorophyll, measurements) {
  // Canonicalize table cells so direct normalizer output and a CSV reopening reproduce identical JSON.
  const cells=rows=>rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value==null?"":typeof value==="object"?JSON.stringify(value):String(value)])));
  selectedChlorophyll=cells(selectedChlorophyll); measurements=cells(measurements);
  const sites=["SV-268","SV-838","SV-839","SV-374","SV-840"];
  const suffix=r=>r.station_id.slice(r.station_id.lastIndexOf("SV-"));
  const special=new Set(["SV-838","SV-839","SV-840"]);
  const micro=measurements.filter(r=>r.characteristic==="Microcystins/nodularin"&&sites.includes(suffix(r)));
  if(micro.length!==85||selectedChlorophyll.length!==75)throw Error("Use the retained original five-station 2023 cohort");
  const unique=new Set(micro.map(r=>r.record_id));if(unique.size!==85)throw Error("Repeated source record identity");
  const dates=[...new Set(micro.filter(r=>special.has(suffix(r))).map(r=>r.sample_date))].sort();
  const dateSet=new Set(dates),kept=[],excluded=[];
  const key=r=>[r.station_id,r.sample_date].join("|");
  const groups=new Map();for(const r of micro){const k=key(r);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
  for(const r of micro){
    const site=suffix(r);let basis="",keep=false;
    if(special.has(site)){keep=true;basis="Original special lake station microcystin result";}
    else if(!dateSet.has(r.sample_date)){basis="Outside original special-station microcystin calendar";}
    else if(groups.get(key(r)).length===1){keep=true;basis="Unique station result on original special-station microcystin calendar";}
    else{
      const chlorophyll=selectedChlorophyll.filter(c=>key(c)===key(r));
      const matches=groups.get(key(r)).filter(m=>chlorophyll.some(c=>c.sample_time===m.sample_time&&c.sample_timezone===m.sample_timezone));
      if(chlorophyll.length!==1||matches.length!==1)throw Error("Duplicate station-date has no unique exact-clock selection: "+key(r));
      keep=matches[0].record_id===r.record_id;
      basis=keep?"Repeated station-date separated by existing selected CHLA original clock":"Repeated station-date with a different original clock from selected CHLA";
    }
    (keep?kept:excluded).push({...r,micro_cohort_selection_basis:basis});
  }
  const compare=(a,b)=>a.sample_date.localeCompare(b.sample_date)||sites.indexOf(suffix(a))-sites.indexOf(suffix(b))||a.sample_time.localeCompare(b.sample_time);
  kept.sort(compare);excluded.sort(compare);
  if(kept.length!==73||dates.length!==15)throw Error("Inferred report-cohort membership changed");
  const published=[
    {station:"SV-268",n:15,mean:"0.038",sample_sd:"0.098",max:"0.393"},
    {station:"SV-838",n:14,mean:"0.040",sample_sd:"0.028",max:"0.102"},
    {station:"SV-839",n:15,mean:"0.051",sample_sd:"0.026",max:"0.098"},
    {station:"SV-374",n:15,mean:"0.057",sample_sd:"0.033",max:"0.132"},
    {station:"SV-840",n:14,mean:"0.044",sample_sd:"0.025",max:"0.086"}
  ];
  const numeric=(text,label)=>{if(!/^\d+(?:\.\d+)?$/.test(text))throw Error("Unsupported original decimal "+label);return Number(text)};
  const censored=r=>r.detection_condition==="Below Reporting Limit";
  const observed=r=>{
    if(censored(r)){
      if(r.reported_value!==""||r.detection_limit_unit!=="ug/L")throw Error("Unexpected original censored source fields");
      const limit=numeric(r.detection_limit,"limit");if(!(limit>0))throw Error("Nonpositive reporting limit");
      return {numeric:null,limit};
    }
    if(!["","Present Above Quantification Limit"].includes(r.detection_condition)||r.reported_unit!=="ug/L"||r.qualifier!=="")throw Error("Unhandled measurement interpretation");
    return {numeric:numeric(r.reported_value,"value"),limit:null};
  };
  const stats=v=>{const mean=v.reduce((a,b)=>a+b,0)/v.length;return {mean,sample_sd:Math.sqrt(v.reduce((a,b)=>a+(b-mean)**2,0)/(v.length-1)),n:v.length}};
  // Decimal half-up rounding of original nonnegative decimal strings; no binary tie ambiguity.
  const roundSource3=text=>{
    numeric(text,"rounding input");
    const [whole,part=""]=text.split("."),fraction=part.padEnd(4,"0");
    const scaled=BigInt(whole)*1000n+BigInt(fraction.slice(0,3))+(fraction[3]>="5"?1n:0n);
    return Number(scaled)/1000;
  };
  const summary=published.map(p=>{
    const rows=kept.filter(r=>suffix(r)===p.station);
    const v=rows.map(observed),fixed=rows.map((r,i)=>censored(r)?0.008:v[i].numeric);
    const caption=stats(fixed),rounded=stats(rows.map(r=>censored(r)?0.008:roundSource3(r.reported_value)));
    const actualHalf=stats(rows.map((r,i)=>censored(r)?v[i].limit/2:v[i].numeric));
    const maxRow=rows.filter(r=>!censored(r)).reduce((a,b)=>Number(a.reported_value)>Number(b.reported_value)?a:b);
    const lower=v.reduce((s,x)=>s+(x.numeric===null?0:x.numeric),0)/rows.length;
    const upper=v.reduce((s,x)=>s+(x.numeric===null?x.limit:x.numeric),0)/rows.length;
    return {station:p.station,n:rows.length,quantified:rows.filter(r=>!censored(r)).length,censored:rows.filter(censored).length,
      published_n:p.n,published_mean:p.mean,published_sample_sd:p.sample_sd,published_max:p.max,
      caption_fixed_0008_mean:caption.mean,caption_fixed_0008_sample_sd:caption.sample_sd,
      caption_mean_3dp:caption.mean.toFixed(3),caption_sample_sd_3dp:caption.sample_sd.toFixed(3),
      n_matches:rows.length===p.n,mean_matches:caption.mean.toFixed(3)===p.mean,sample_sd_matches:caption.sample_sd.toFixed(3)===p.sample_sd,
      original_max:maxRow.reported_value,original_max_decimal_half_up_3dp:roundSource3(maxRow.reported_value).toFixed(3),
      max_matches:roundSource3(maxRow.reported_value).toFixed(3)===p.max,
      rounded_source_mean:rounded.mean,rounded_source_sample_sd:rounded.sample_sd,
      rounded_source_mean_3dp:rounded.mean.toFixed(3),rounded_source_sample_sd_3dp:rounded.sample_sd.toFixed(3),
      half_each_actual_limit_mean:actualHalf.mean,original_limit_mean_lower:lower,original_limit_mean_upper:upper,
      original_limit_mean_upper_open:rows.some(censored),
      original_limit_distribution:JSON.stringify([...new Set(rows.filter(censored).map(r=>r.detection_limit))].sort().map(limit=>({limit_ug_L:limit,n:rows.filter(r=>censored(r)&&r.detection_limit===limit).length})))};
  });
  const dateClockMatches=[];
  for(const m of micro.filter(r=>r.sample_date==="2023-08-24")){
    for(const c of selectedChlorophyll.filter(r=>r.station_id===m.station_id&&r.sample_date==="2023-09-05"&&r.sample_time===m.sample_time&&r.sample_timezone===m.sample_timezone)){
      dateClockMatches.push({station:suffix(m),micro_date:m.sample_date,chla_date:c.sample_date,original_clock:m.sample_time,original_timezone:m.sample_timezone,
        micro_record_id:m.record_id,chla_record_id:c.record_id,micro_activity_id:m.activity_id,chla_activity_id:c.activity_id,
        interpretation:"Same original clock and station on different original dates; retain each date unchanged."});
    }
  }
  const methods={
    scope:"Candidate 73-record report cohort inferred from the retained original special-station microcystin calendar, with exact selected chlorophyll clocks disambiguating repeated routine station-dates.",
    source_selection_status:"Inferred reproducible selection; publisher Table 8 does not identify its individual activity IDs.",
    report_url:"https://des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/2023LakeProgramFinalReport.pdf",
    report_location:"Table 8, printed page 16, PDF page 23",
    published_comparison:"Table 8 station values manually transcribed from the original PDF; fixed 0.008 ug/L substitution is applied only for the report-method comparison.",
    sampling_protocol:"Published report describes surface (0.3 m) microcystin sampling alongside chlorophyll. Individual WQP microcystin depth fields are blank.",
    original_censoring:"Original below-limit values are intervals [0, reporting limit). Four selected April 5 records have 0.1 ug/L limits; other selected below-limit records have 0.016 ug/L limits.",
    precision_sensitivity:"Exact decimal half-up rounding of quantified source values to 0.001 ug/L before aggregation is an explicitly labelled sensitivity calculation, not a verified publisher computation.",
    statistics:"Arithmetic mean; sample standard deviation with denominator n-1; final display uses three decimal places.",
    paired_analysis_relationship:"This report-reconciliation cohort includes original August 24 dates and does not modify the separate 67 exact-date/time cross-analyte links or 128 microcystin contrasts.",
    interpretation:"The same-clock August 24/September 5 observation is reported as an original source discrepancy; no sample date is replaced."
  };
  return {schema:"upstate.microcystin-report-reconciliation/v1",methods,coverage:{original_micro_rows:micro.length,selected_rows:kept.length,excluded_rows:excluded.length,calendar_dates:dates.length,station_counts:summary.map(r=>({station:r.station,n:r.n})),same_clock_different_date_matches:dateClockMatches.length},
    calendar_dates:dates,published_table8:published,summary,selected:kept,excluded,date_clock_matches:dateClockMatches};
}
