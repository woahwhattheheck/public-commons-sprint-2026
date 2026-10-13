/* Observed year and sampling-date context from retained agency-derived tables. */
export function parseCsv(text) {
  const rows=[]; let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}
    else if(c==='"')quoted=true;
    else if(c===','){row.push(cell);cell='';}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v!==''))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(quoted)throw Error('Incomplete CSV quotation');
  if(row.length||cell){row.push(cell);rows.push(row);}
  const columns=(rows.shift()||[]).map((c,i)=>i===0?c.replace(/^\uFEFF/,''):c);
  if(new Set(columns).size!==columns.length)throw Error('Duplicate CSV column');
  return rows.map(values=>{if(values.length!==columns.length)throw Error('CSV row width differs');return Object.fromEntries(columns.map((c,i)=>[c,values[i]]));});
}
const number=(value,label)=>{if(value===''||value==null||!Number.isFinite(Number(value)))throw Error('Missing or invalid '+label);return Number(value);};
const sum=values=>{let total=0,correction=0;for(const value of values){const y=value-correction,t=total+y;correction=(t-total)-y;total=t;}return total;};
const median=values=>{if(!values.length)return null;const s=[...values].sort((a,b)=>a-b),i=Math.floor(s.length/2);return s.length%2?s[i]:(s[i-1]+s[i])/2;};
const countDays=(start,end)=>Math.round((Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000)+1;
const unique=(rows,key,label)=>{const seen=new Set();for(const row of rows){const id=key(row);if(seen.has(id))throw Error('Duplicate '+label+': '+id);seen.add(id);}};
export function assessObservedContext({annual,daily,dates,year=2023,gauge='02186702',windowStart='2023-04-05',windowEnd='2023-10-17'}) {
  unique(annual,r=>r.site+':'+r.period_start,'annual period');
  unique(daily,r=>r.site+':'+r.date,'daily observation');
  unique(dates,r=>r.gauge_id+':'+r.sampling_date,'study date');
  const start=year+'-01-01',end=year+'-12-31',expected=countDays(start,end);
  const groups=new Map();
  for(const row of annual){
    if(row.parameter_code!=='00060'||row.statistic_code!=='00003'||row.period_type!=='calendar_year')throw Error('Select original calendar-year daily-mean discharge summaries');
    const values=groups.get(row.site)||[];values.push(row);groups.set(row.site,values);
  }
  const stationContext=[];
  for(const [site,rows] of groups){
    const target=rows.find(r=>r.period_start===start&&r.period_end===end);if(!target)continue;
    const complete=rows.filter(r=>number(r.valid_days,'valid days')===number(r.expected_days,'expected days'));
    const reference=complete.filter(r=>r!==target);
    const valid=number(target.valid_days,'target valid days'),isComplete=valid===expected;
    const referenceMedian=median(reference.map(r=>number(r.mean_cfs,'reference annual mean')));
    const targetMean=valid?number(target.mean_cfs,'target mean'):null;
    stationContext.push({
      site,site_name:target.site_name,year,valid_days:valid,expected_days:expected,complete_year:isComplete,
      complete_reference_years:reference.map(r=>r.period_start.slice(0,4)).sort(),
      complete_year_count:complete.length,observed_mean_cfs:targetMean,
      complete_year_runoff_mm:isComplete&&target.complete_period_runoff_mm!==''?number(target.complete_period_runoff_mm,'runoff'):null,
      reference_median_annual_mean_cfs:referenceMedian,
      mean_ratio_to_other_complete_years:isComplete&&referenceMedian>0?targetMean/referenceMedian:null,
      ascending_mean_rank:isComplete?1+complete.filter(r=>number(r.mean_cfs,'annual mean')<targetMean).length:null,
      approved_days:number(target.approved_days,'approved days'),provisional_days:number(target.provisional_days,'provisional days'),
      estimated_days:number(target.estimated_days,'estimated days'),revised_days:number(target.revised_days,'revised days'),
      reference_quality:reference.map(r=>({year:r.period_start.slice(0,4),approved_days:Number(r.approved_days),provisional_days:Number(r.provisional_days),estimated_days:Number(r.estimated_days),revised_days:Number(r.revised_days)}))
    });
  }
  stationContext.sort((a,b)=>a.site.localeCompare(b.site));
  const selectedAnnual=annual.find(r=>r.site===gauge&&r.period_start===start&&r.period_end===end);
  if(!selectedAnnual)throw Error('Selected gauge lacks its annual summary');
  const series=daily.filter(r=>r.site===gauge&&r.date>=start&&r.date<=end);
  if(series.length!==expected)throw Error('The sampling-context reference requires a complete original daily year');
  const index=new Map(series.map(r=>[r.date,r])),values=series.map(r=>number(r.reported_mean_cfs,'daily mean'));
  const annualMean=sum(values)/series.length,reportedMean=number(selectedAnnual.mean_cfs,'annual mean');
  if(Math.abs(annualMean-reportedMean)>1e-10*Math.max(1,Math.abs(reportedMean)))throw Error('Original daily values differ from the annual mean');
  const threshold=number(selectedAnnual.p95_daily_cfs,'annual p95');
  const selectedDates=dates.filter(r=>r.gauge_id==='USGS-'+gauge&&r.sampling_date>=start&&r.sampling_date<=end);
  if(!selectedDates.length)throw Error('Select the retained sampling-date cohort');
  for(const row of selectedDates){
    const original=index.get(row.sampling_date);
    if(!original||number(original.reported_mean_cfs,'original mean')!==number(row.same_date_mean_cfs,'sample-date mean')||
      original.source_id!==row.same_date_flow_source_id||original.source_record_index!==row.same_date_flow_source_record_index||
      original.source_values_index!==row.same_date_flow_source_values_index)throw Error('Sampling-date flow does not match its retained original daily record');
  }
  const summarize=rows=>{const peak=rows.filter(r=>number(r.reported_mean_cfs,'flow')>=threshold),total=sum(rows.map(r=>Number(r.reported_mean_cfs)));
    return {valid_days:rows.length,days_at_or_above_annual_p95:peak.length,
      fraction_of_observed_volume_at_or_above_annual_p95:total>0?sum(peak.map(r=>Number(r.reported_mean_cfs)))/total:null,
      dates_at_or_above_annual_p95:peak.map(r=>r.date)};};
  const study=series.filter(r=>r.date>=windowStart&&r.date<=windowEnd);
  if(study.length!==countDays(windowStart,windowEnd))throw Error('Study-window daily observations are incomplete');
  const sampled=selectedDates.map(r=>Number(r.same_date_mean_cfs));
  const samplingContext={gauge_id:'USGS-'+gauge,year,annual_p95_daily_mean_cfs:threshold,
    annual_mean_cfs:annualMean,annual:summarize(series),study_window:{start:windowStart,end:windowEnd,...summarize(study)},
    sampled_unique_dates:selectedDates.length,sampled_dates_at_or_above_annual_p95:sampled.filter(v=>v>=threshold).length,
    sampled_mean_daily_flow_cfs:sum(sampled)/sampled.length,sampled_median_daily_flow_cfs:median(sampled),
    sampled_min_daily_flow_cfs:Math.min(...sampled),sampled_max_daily_flow_cfs:Math.max(...sampled),
    prior_three_day_mean_at_or_above_annual_p95:selectedDates.filter(r=>Number(r.prior_3d_mean_cfs)>=threshold).map(r=>r.sampling_date),
    prior_seven_day_mean_at_or_above_annual_p95:selectedDates.filter(r=>Number(r.prior_7d_mean_cfs)>=threshold).map(r=>r.sampling_date),
    source_dates:selectedDates.map(r=>({date:r.sampling_date,flow_source_id:r.same_date_flow_source_id,values_index:Number(r.same_date_flow_source_values_index),record_index:Number(r.same_date_flow_source_record_index),activity_count:Number(r.source_activity_count),chlorophyll_sites:r.chla_sites,microcystin_sites:r.micro_sites}))};
  return {schema:'upstate.observed-calibration-context/v1',reference_year:year,reference_rule:'Median annual mean of other fully observed years at the same original gauge; target year excluded',
    units:{flow:'ft3/s',runoff:'mm',volume_fraction:'dimensionless'},
    station_context:stationContext,sampling_context:samplingContext};
}
export function contextCsv(rows) {
  const columns=['site','site_name','year','valid_days','expected_days','complete_year','complete_year_count','complete_reference_years','observed_mean_cfs','complete_year_runoff_mm','reference_median_annual_mean_cfs','mean_ratio_to_other_complete_years','ascending_mean_rank','approved_days','provisional_days','estimated_days','revised_days'];
  const cell=value=>{const text=value==null?'':Array.isArray(value)?value.join('|'):String(value);return /[",\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;};
  return [columns.join(','),...rows.map(row=>columns.map(key=>cell(row[key])).join(','))].join('\n')+'\n';
}

export function renderContextMarkdown(result) {
  const s=result.sampling_context,rows=result.station_context,fmt=(v,n=2)=>v==null?'—':Number(v).toFixed(n),pct=v=>fmt(v*100,2)+'%';
  const eighteen=rows.find(r=>r.site==='02186702');
  const stationLines=rows.map(r=>'| '+r.site+' | '+r.site_name+' | '+r.valid_days+'/'+r.expected_days+' | '+fmt(r.observed_mean_cfs)+' | '+fmt(r.reference_median_annual_mean_cfs)+' | '+(r.mean_ratio_to_other_complete_years==null?'—':pct(r.mean_ratio_to_other_complete_years))+' | '+(r.ascending_mean_rank==null?'—':r.ascending_mean_rank+'/'+r.complete_year_count)+' |');
  return [
    '# Observed flow context for the Upper Savannah modelling work','',
    '## Decisions supported by these observations','',
    'The completed agency capture provides 2020–2025 daily flows and exact laboratory sampling dates. This assessment uses each gauge’s own complete annual observations to place 2023 in context, and measures which flow conditions the Eighteenmile lake-study dates represent. The calculation retains the original source-record references and quality counts.','',
    'At Eighteenmile Creek below Pendleton (USGS 02186702), the 2023 annual mean was '+fmt(eighteen.observed_mean_cfs,5)+' ft³/s, '+pct(eighteen.mean_ratio_to_other_complete_years)+' of the median annual mean in its other complete observed years. Compare this with the individual headwater rows below when selecting climate years and gauged catchments for regional model evaluation.','',
    '## Gauge-specific annual context','',
    'The reference is the median of the other fully observed annual means at the same gauge. The 2023 target is excluded from its own reference. Rank 1 is the lowest annual mean among that gauge’s complete years in this retained six-year record. Partial periods retain their observed mean and coverage; their annual ratio, annual runoff and rank remain empty. The JSON retains the approval, provisional, estimated and revised counts for the target and every reference year.','',
    '| USGS site | Original station name | 2023 valid days | 2023 mean, ft³/s | Other-year median, ft³/s | 2023/reference | Ascending rank |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',...stationLines,'',
    'Use the original gauge locations, contributing areas and published operating context when selecting a comparison. In particular, the two source records labelled powerhouse retain their separate station identities. The inventory spans four HUC8 query areas; each spatial comparison also carries the selected model-domain and gauge-catchment geometry.','',
    '## Sampling dates and observed high-flow periods','',
    'The retained study cohort has '+s.sampled_unique_dates+' unique 2023 dates. The original daily-flow reference contains '+s.annual.valid_days+' days. Its annual 95th percentile of daily mean flow is '+fmt(s.annual_p95_daily_mean_cfs,1)+' ft³/s.','',
    '- '+s.annual.days_at_or_above_annual_p95+' days meet or exceed that threshold and account for '+pct(s.annual.fraction_of_observed_volume_at_or_above_annual_p95)+' of the observed annual discharge volume.',
    '- During '+s.study_window.start+' through '+s.study_window.end+', '+s.study_window.days_at_or_above_annual_p95+' threshold days account for '+pct(s.study_window.fraction_of_observed_volume_at_or_above_annual_p95)+' of the observed '+s.study_window.valid_days+'-day volume.',
    '- '+s.sampled_dates_at_or_above_annual_p95+' of the '+s.sampled_unique_dates+' unique sampling dates meet that threshold. Sampling-date daily means range from '+fmt(s.sampled_min_daily_flow_cfs,1)+' to '+fmt(s.sampled_max_daily_flow_cfs,1)+' ft³/s, with median '+fmt(s.sampled_median_daily_flow_cfs,2)+' ft³/s.',
    '- The preceding three-day means exceed the annual daily threshold before '+s.prior_three_day_mean_at_or_above_annual_p95.join(' and ')+'. The preceding seven-day mean exceeds it before '+s.prior_seven_day_mean_at_or_above_annual_p95.join(' and ')+'. These antecedent windows are useful for interpreting lake response after elevated inflow.','',
    'The volume fractions divide sums of daily mean discharge over the selected dates; the common ft³/s-to-volume conversion cancels. These are shares of observed water volume. Concentration, nutrient mass and sediment mass have their own measured quantities and spatial support.','',
    '## Use in the native workflow','',
    '1. Import the complete observed-hydrology and Eighteenmile model-sources.json manifests, retaining original response companions and the published coordinate reference systems.',
    '2. Match a candidate model’s reporting catchment to the original gauge basin and the corresponding observed period. Use complete-period flow/runoff and source quality counts to assess the hydrologic inputs.',
    '3. Keep the source-specific annual pattern visible: 2023 lies near Eighteenmile’s other-year reference but is the lowest complete annual mean in several headwater records. Each catchment’s actual climate and observed-flow relationship should inform its model comparison.',
    '4. Use the laboratory activity, station, project, method, censoring and sampling-date fields when comparing water-quality evidence with model outputs. The study’s low-to-moderate sampling-day flows and elevated antecedent windows provide different temporal context.',
    '5. Evaluate annual nutrient and sediment exports with corresponding annual mass observations and matching contributing areas. The InVEST 3.20.0 freshwater calibration guidance describes the model-specific quantities and calibration sequence.','',
    '## Source and reproduction','',
    'Run from the application root:','',
    '    node source_tools/assess_observed_context.mjs','',
    'This produces assessment.json, station_year_context.csv and this document under observations/calibration_context_20261013. The JSON lists exact input-file hashes and the original daily-flow record associated with each sample date.','',
    '- [Original agency responses, methods and full hydrology edition](../observed_hydrology_20261013/README.md)',
    '- [Complete annual observed-flow table](../observed_hydrology_20261013/derived/calendar_year_flow.csv)',
    '- [Original daily-flow table and source-record links](../observed_hydrology_20261013/derived/daily_flow.csv)',
    '- [Dated study-flow context and antecedent-window methods](../eighteenmile_2023/wqp/FLOW_CONTEXT_README.md)',
    '- [USGS Eighteenmile station](https://waterdata.usgs.gov/monitoring-location/USGS-02186702/)',
    '- [Published 2023 lake investigation](https://des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/2023LakeProgramFinalReport.pdf)',
    '- [InVEST 3.20.0 freshwater calibration guidance](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/calibration_freshwater.html)',''
  ].join('\n');
}
