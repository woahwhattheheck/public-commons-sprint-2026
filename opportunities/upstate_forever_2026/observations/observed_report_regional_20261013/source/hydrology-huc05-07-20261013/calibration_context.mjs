/** Comparable discharge context from the retained A74F original USGS records.
 * Uses the existing observed-hydrology numerical conventions without changing its dated edition.
 */
export function calibrationBuild(records, manifest, inventory) {
  const DAY=86400000, CFS_TO_CMS=0.028316846592, SQMI_TO_M2=2589988.110336;
  const selected=manifest.selection.selected_series, bySite=new Map(), metadata=new Map(inventory.map(r=>[r.site_no,r]));
  const selectedKeys=new Set(selected.map(r=>r.site_no+"/"+r.ts_id)), seen=new Set();
  const flags=r=>String(r.qualifiers).split(":");
  for(const r of records){
    if(!selectedKeys.has(r.site_no+"/"+r.ts_id)) throw Error("Unselected original series");
    const k=r.site_no+"/"+r.ts_id+"/"+r.date;
    if(seen.has(k)) throw Error("Duplicate original series date: "+k);
    seen.add(k);
    if(r.value_cfs!==null && (!Number.isFinite(r.value_cfs)||r.value_cfs<0)) throw Error("Resolve original nonfinite or negative inland discharge: "+k);
    if(r.date<manifest.period.start||r.date>manifest.period.end) throw Error("Original date leaves selected period");
    if(!bySite.has(r.site_no))bySite.set(r.site_no,[]);
    bySite.get(r.site_no).push(r);
  }
  for(const rows of bySite.values()) rows.sort((a,b)=>a.date.localeCompare(b.date));
  const q=(v,p)=>{if(!v.length)return null;const i=(v.length-1)*p,l=Math.floor(i),h=Math.ceil(i);return v[l]+(v[h]-v[l])*(i-l);};
  const sumDecimal=rows=>{
    let places=0;
    for(const r of rows){if(!/^\d+(\.\d+)?$/.test(r.reported_value))throw Error("Retain original decimal discharge spelling");places=Math.max(places,(r.reported_value.split(".")[1]||"").length);}
    let sum=0n;
    for(const r of rows){const [a,b=""]=r.reported_value.split(".");sum+=BigInt(a+b.padEnd(places,"0"));}
    if(sum>BigInt(Number.MAX_SAFE_INTEGER))throw Error("Discharge total exceeds exact representable decimal numerator");
    return Number(sum)/10**places;
  };
  const days=(start,end)=>(Date.parse(end+"T00:00:00Z")-Date.parse(start+"T00:00:00Z"))/DAY+1;
  const ranges=dates=>{const result=[];for(const date of dates){const p=result.at(-1);if(p&&Date.parse(date)-Date.parse(p.end)===DAY){p.end=date;p.days++;}else result.push({start:date,end:date,days:1});}return result;};
  const summarize=(series,start,end,type)=>{
    const site=series.site_no,meta=metadata.get(site);if(!meta)throw Error("Missing original station inventory "+site);
    const all=(bySite.get(site)||[]).filter(r=>r.date>=start&&r.date<=end), valid=all.filter(r=>r.value_cfs!==null);
    const approved=valid.filter(r=>flags(r).includes("A")), values=valid.map(r=>r.value_cfs).sort((a,b)=>a-b);
    const count=days(start,end),n=valid.length,sum=sumDecimal(valid),approvedSum=sumDecimal(approved);
    const areaText=meta.drain_area_va.trim(),area=areaText===""?null:Number(areaText);
    if(area!==null&&(!Number.isFinite(area)||area<=0))throw Error("Original drainage area must be positive");
    const volume=n?sum*CFS_TO_CMS*86400:null, runoff=volume!==null&&area!==null?volume/(area*SQMI_TO_M2)*1000:null;
    const present=new Set(all.map(r=>r.date)), absent=[];
    for(let d=Date.parse(start+"T00:00:00Z");d<=Date.parse(end+"T00:00:00Z");d+=DAY){const date=new Date(d).toISOString().slice(0,10);if(!present.has(date))absent.push(date);}
    const flag=code=>valid.filter(r=>flags(r).includes(code)).length;
    return {site,site_name:meta.station_nm,period_type:type,period_start:start,period_end:end,
      parameter_code:"00060",statistic_code:"00003",method_id:series.ts_id,
      record_days:all.length,valid_days:n,expected_days:count,coverage_fraction:n/count,missing_days:count-n,
      absent_date_days:absent.length,non_numeric_days:all.length-n,approved_days:approved.length,provisional_days:flag("P"),estimated_days:flag("e"),revised_days:flag("R"),
      first_observed_date:valid[0]?.date??null,last_observed_date:valid.at(-1)?.date??null,
      mean_cfs:n?sum/n:null,p05_daily_cfs:q(values,.05),p50_daily_cfs:q(values,.5),p95_daily_cfs:q(values,.95),
      minimum_daily_cfs:values[0]??null,minimum_daily_dates:valid.filter(r=>r.value_cfs===values[0]).map(r=>r.date).join("|"),
      maximum_daily_cfs:values.at(-1)??null,maximum_daily_dates:valid.filter(r=>r.value_cfs===values.at(-1)).map(r=>r.date).join("|"),
      observed_volume_m3:volume,complete_period_volume_m3:n===count?volume:null,
      source_drainage_area_sqmi:area,observed_runoff_mm:runoff,complete_period_runoff_mm:n===count?runoff:null,
      approved_observed_volume_m3:approved.length?approvedSum*CFS_TO_CMS*86400:null,
      estimated_observed_volume_m3:n?sumDecimal(valid.filter(r=>flags(r).includes("e")))*CFS_TO_CMS*86400:null,
      estimated_observed_volume_fraction:sum>0?sumDecimal(valid.filter(r=>flags(r).includes("e")))/sum:null,
      high_flow_threshold_p95_cfs:q(values,.95),
      days_above_period_p95:valid.filter(r=>r.value_cfs>q(values,.95)).length,
      volume_fraction_above_period_p95:sum>0?sumDecimal(valid.filter(r=>r.value_cfs>q(values,.95)))/sum:null,
      fully_approved_complete_period:n===count&&approved.length===count,
      source_huc8:meta.huc_cd,absent_date_ranges:ranges(absent),
      non_numeric_date_ranges:ranges(all.filter(r=>r.value_cfs===null).map(r=>r.date))};
  };
  const annual=[],monthly=[],study=[],context=[];
  for(const series of selected){
    for(let y=Number(manifest.period.start.slice(0,4));y<=Number(manifest.period.end.slice(0,4));y++){
      annual.push(summarize(series,y+"-01-01",y+"-12-31","calendar_year"));
      for(let m=1;m<=12;m++){const mm=String(m).padStart(2,"0"),end=new Date(Date.UTC(y,m,0)).getUTCDate();monthly.push(summarize(series,y+"-"+mm+"-01",y+"-"+mm+"-"+end,"calendar_month"));}
    }
    study.push(summarize(series,"2023-04-05","2023-10-17","lake_study_window"));
    const years=annual.filter(r=>r.site===series.site_no), target=years.find(r=>r.period_start==="2023-01-01");
    const reference=years.filter(r=>r.period_start!=="2023-01-01"&&r.fully_approved_complete_period);
    const ordered=reference.map(r=>r.mean_cfs).sort((a,b)=>a-b), median=q(ordered,.5);
    context.push({site:series.site_no,site_name:metadata.get(series.site_no).station_nm,method_id:series.ts_id,
      target_year:2023,target_valid_days:target.valid_days,target_approved_days:target.approved_days,
      target_estimated_days:target.estimated_days,target_complete_approved:target.fully_approved_complete_period,
      target_mean_observed_cfs:target.mean_cfs,reference_years:reference.map(r=>r.period_start.slice(0,4)).join("|"),
      reference_year_count:reference.length,median_reference_annual_mean_cfs:median,
      complete_approved_2023_to_reference_ratio:target.fully_approved_complete_period&&median>0?target.mean_cfs/median:null,
      comparison_basis:"Median of other fully approved, complete calendar-year daily means; estimated approved values retain their source flags",
      source_huc8:metadata.get(series.site_no).huc_cd,
      source_drainage_area_sqmi:target.source_drainage_area_sqmi});
  }
  const features=selected.map(series=>{
    const m=metadata.get(series.site_no),y=annual.find(r=>r.site===series.site_no&&r.period_start==="2023-01-01");
    if(m.dec_coord_datum_cd!=="NAD83")throw Error("Preserve distinct station coordinate datum");
    const coords=[Number(m.dec_long_va),Number(m.dec_lat_va)];if(!coords.every(Number.isFinite))throw Error("Original station coordinate is not numeric");
    return {type:"Feature",id:"USGS-"+m.site_no,geometry:{type:"Point",coordinates:coords},properties:{...m,monitoring_location_id:"USGS-"+m.site_no,
      source_crs:"EPSG:4269",flow_method_id:series.ts_id,calendar_start:manifest.period.start,calendar_end:manifest.period.end,
      source_inventory_path:"original/usgs-stations-expanded.tsv",source_inventory_sha256:manifest.originals.find(x=>x.path==="original/usgs-stations-expanded.tsv").sha256,
      flow_days_2023:y.valid_days,approved_days_2023:y.approved_days,estimated_days_2023:y.estimated_days,mean_flow_cfs_2023:y.mean_cfs,
      complete_volume_m3_2023:y.complete_period_volume_m3,complete_runoff_mm_2023:y.complete_period_runoff_mm,
      spatial_selection:"Publisher HUC8 candidate; individual model-domain and contributing-basin joins are retained separately"}};
  });
  const methods={source_parameter:"00060",source_statistic:"00003",source_unit:"ft3/s",cfs_to_m3s:CFS_TO_CMS,nominal_reporting_day_seconds:86400,square_miles_to_m2:SQMI_TO_M2,
    decimal_sum:"Exact BigInt sum of original decimal spellings before conversion to finite numbers",
    percentile:"Linear interpolation at (n-1)*p, matching retained observed_hydrology_20261013",
    completeness:"A full-period volume/runoff requires a numeric observation for every calendar date; absent and nonnumeric days stay distinct",
    qualifiers:"Source colon-delimited A/e/P/R retained in original daily records; summaries count flags independently",
    drainage_area:"Original USGS station drain_area_va in square miles; canal without source area retains null runoff",
    reference_years:"2023 compared only with other fully approved complete calendar years at the same station and native time-series ID",
    geography:"A gauge point inside a HUC is distinct from its complete upstream contributing area; model comparisons use retained catchment geometry"};
  const coverage={schema:"upstate.discharge-calibration-context/v1",period:manifest.period,source_record_count:records.length,numeric_daily_records:records.filter(r=>r.value_cfs!==null).length,
    station_count:selected.length,calendar_year_rows:annual.length,calendar_month_rows:monthly.length,
    complete_calendar_years:annual.filter(r=>r.valid_days===r.expected_days).length,
    fully_approved_complete_calendar_years:annual.filter(r=>r.fully_approved_complete_period).length,
    approved_numeric_days:records.filter(r=>r.value_cfs!==null&&flags(r).includes("A")).length,
    estimated_numeric_days:records.filter(r=>r.value_cfs!==null&&flags(r).includes("e")).length,
    provisional_numeric_days:records.filter(r=>r.value_cfs!==null&&flags(r).includes("P")).length,
    non_numeric_records:records.filter(r=>r.value_cfs===null),domain_context:manifest.domain_context,methods};
  const csvCell=value=>{const t=value===null||value===undefined?"":typeof value==="object"?JSON.stringify(value):String(value);return /[",\r\n]/.test(t)?'"'+t.replaceAll('"','""')+'"':t;};
  const csv=rows=>{const cols=Object.keys(rows[0]||{});return [cols.join(","),...rows.map(r=>cols.map(k=>csvCell(r[k])).join(","))].join("\n")+"\n";};
  const json=value=>JSON.stringify(value,null,2)+"\n";
  const files=[
    {path:"derived/calendar_year_flow.csv",text:csv(annual)},
    {path:"derived/calendar_month_flow.csv",text:csv(monthly)},
    {path:"derived/study_period_flow.csv",text:csv(study)},
    {path:"derived/2023_reference_flow_context.csv",text:csv(context)},
    {path:"derived/calibration-coverage.json",text:json(coverage)},
    {path:"derived/calibration_stations_nad83.geojson",text:json({type:"FeatureCollection",crs:{type:"name",properties:{name:"EPSG:4269"}},features})}
  ];
  return {files,coverage,annual,monthly,study,context};
}
