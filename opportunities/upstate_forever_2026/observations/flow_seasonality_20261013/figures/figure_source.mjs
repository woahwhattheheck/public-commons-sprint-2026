/** Original-source seasonal figures shared by SVG and native ReportLab vectors. */
export function buildSeasonalFigureSpecification(data,d3,sourceFiles){
 if(data.schema!=="upstate.observed-flow-seasonality-explorer/v1")throw Error("Select the retained seasonal source edition");
 const table=name=>data.tables[name].rows.map((values,index)=>({...Object.fromEntries(data.tables[name].columns.map((key,i)=>[key,values[i]])),source_table:name,source_row_index:index}));
 const annual=table("annual"),monthly=table("monthlyComparisons"),seasonal=table("seasonal"),comparisons=table("seasonalComparisons"),duration=table("duration"),stations=table("stations");
 const identity=(row,field)=>({site:row.site,year:row.year,month:row.month,season:row.season,reference_basis:row.reference_basis,source_table:row.source_table,source_row_index:row.source_row_index,source_field:field});
 const point=(x,y,row,field)=>({x,y,...identity(row,field)});
 const summaries=(rows,field,factor=1)=>{const values=rows.map(r=>r[field]*factor).sort((a,b)=>a-b);if(!values.length||values.some(v=>!Number.isFinite(v)))throw Error("Figure needs its complete numeric source cohort");return {minimum:values[0],q1:d3.quantileSorted(values,.25),median:d3.quantileSorted(values,.5),q3:d3.quantileSorted(values,.75),maximum:values.at(-1),mean:d3.mean(values),n:values.length,reference_years:rows.map(r=>r.year),source_records:rows.map(r=>identity(r,field))};};
 const numericAxis=(label,unit,values)=>{const top=d3.max(values.filter(v=>v!==null&&Number.isFinite(v)))||1,step=d3.tickStep(0,top*1.08,5)||1,max=Math.ceil(top*1.08/step)*step;return {label,unit,domain:[0,max],ticks:d3.ticks(0,max,5).map(value=>({value,label:String(Number(value.toPrecision(6)))}))};};
 const months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],seasonNames=["Winter","Spring","Summer","Autumn"],seasonIds=["winter","spring","summer","autumn"];
 const target=monthly.filter(r=>r.site==="02186702"&&r.year===2023&&r.reference_basis==="complete_numeric").sort((a,b)=>a.month-b.month);
 if(target.length!==12||target.some(r=>!r.target_eligible))throw Error("Original Eighteenmile monthly selection differs");
 const monthPanels=[["mean","Mean discharge","ft3/s","target_observed_mean_cfs","reference_median_period_mean_cfs",1],["volume","Water volume","million m3","target_observed_volume_m3","reference_median_period_volume_m3",1e-6]].map(([id,label,unit,actual,reference,factor])=>({
  id:"eighteenmile-monthly-"+id,title:"Eighteenmile · calendar 2023",
  x:{label:"Calendar month",unit:"",domain:[.5,12.5],ticks:months.map((label,i)=>({value:i+1,label}))},
  y:numericAxis(label,unit,target.flatMap(r=>[r[actual]*factor,r[reference]*factor])),
  series:[{label:"2023 observed",geometry:"line",marker:"circle",points:target.map(r=>point(r.month,r[actual]*factor,r,actual))},
   {label:"Other-year median",geometry:"line",marker:"square-open",points:target.map(r=>({...point(r.month,r[reference]*factor,r,reference),reference_years:r.reference_years}))}],reference_lines:[]
 }));
 const monthlyFigure={id:"observed-monthly-eighteenmile",svg:"eighteenmile_monthly_flow.svg",title:"How Eighteenmile's 2023 flow was distributed through the year",caption:"USGS 02186702. Solid circles show the twelve complete observed months of 2023. Open squares show the median of other complete same-month periods at this gauge, excluding 2023. The upper panel compares daily mean discharge; the lower compares water volume over actual calendar days. Reference February periods include their own leap-day duration. Reference years and original approval/estimate flags remain in the source-point table and monthly-comparisons.csv. The complete-numeric basis preserves provisional original observations.",layout:{columns:1,rows:2},panels:monthPanels};
 const selected=comparisons.filter(r=>r.site==="02186702"&&r.year===2023&&r.reference_basis==="complete_numeric");
 const seasonPanels=[["mean","Seasonal mean","ft3/s","observed_mean_cfs","target_observed_mean_cfs",1,false],["share","Annual volume share","%","fraction_of_complete_annual_volume","target_annual_volume_fraction",100,true]].map(([id,label,unit,field,actual,factor,wholeYear])=>{
  const boxes=seasonIds.map((season,x)=>{const row=selected.find(r=>r.season===season),years=wholeYear?row.annual_fraction_reference_years:row.reference_years,refs=seasonal.filter(r=>r.site===row.site&&r.season===season&&years.includes(r.year));
   if(refs.length!==years.length)throw Error("Seasonal reference cohort differs");
   return {x,...summaries(refs,field,factor),site:row.site,season,selected_year:2023,source_table:"seasonal",source_field:field};
  });
  const points=seasonIds.map((season,x)=>{const row=selected.find(r=>r.season===season);return point(x,row[actual]===null?null:row[actual]*factor,row,actual);});
  return {id:"eighteenmile-season-"+id,title:"Eighteenmile · seasonal "+(wholeYear?"allocation":"discharge"),x:{label:"Calendar-year season",unit:"",domain:[-.5,3.5],ticks:seasonNames.map((label,value)=>({value,label}))},
   y:numericAxis(label,unit,[...boxes.map(b=>b.maximum),...points.map(p=>p.y)]),
   series:[{label:"Other complete years",geometry:"boxplot",marker:"diamond-mean",points:boxes},{label:"2023 observed",geometry:"scatter",marker:"circle",points}],reference_lines:[]};
 });
 const seasonalFigure={id:"observed-seasonal-eighteenmile",svg:"eighteenmile_seasonal_contrasts.svg",title:"A wet summer and dry autumn within Eighteenmile's near-average year",caption:"Boxes contain other eligible years at USGS 02186702: center line median, box 25th–75th percentiles, whiskers observed minimum/maximum, open diamond arithmetic mean. Quantiles use R7 linear interpolation. Filled circles show 2023. Seasonal discharge uses complete same-season periods; annual shares use separate complete annual denominators. Winter combines January, February and December of the same calendar year. Exact reference years are retained per point. Summer mean is 33.85% above its reference median and autumn is 46.56% below; their actual annual-volume shares are 21.61% and 10.19%.",layout:{columns:1,rows:2},panels:seasonPanels};
 const highPanels=[];
 for(let start=0;start<stations.length;start+=10){
  const selectedStations=stations.slice(start,start+10),points=selectedStations.map((station,x)=>{
   const rows=annual.filter(r=>r.site===station.site&&r.complete_numeric),summary=summaries(rows,"fraction_of_observed_volume_at_or_above_p95",100);
   if(Math.abs(summary.median-station.median_complete_year_p95_volume_fraction*100)>1e-9)throw Error("Annual high-flow figure differs from original station summary");
   return {x,y:summary.median,...summary,site:station.site,site_name:station.site_name,complete_years:rows.map(r=>r.year),source_table:"annual",source_field:"fraction_of_observed_volume_at_or_above_p95"};
  });
  highPanels.push({id:"annual-high-flow-"+start,title:"Original gauges "+(start+1)+"–"+(start+selectedStations.length),x:{label:"USGS gauge",unit:"station index",domain:[-.5,selectedStations.length-.5],ticks:selectedStations.map((r,value)=>({value,label:r.site}))},
   y:{label:"Annual high-flow volume share",unit:"%",domain:[0,100],ticks:[0,25,50,75,100].map(value=>({value,label:String(value)}))},
   series:[{label:"Complete-year distribution",geometry:"boxplot",marker:"diamond-mean",points}],reference_lines:[]});
 }
 const highFigure={id:"observed-high-flow-volume",svg:"regional_high_flow_volume.svg",title:"How much annual water volume passes on high-flow days?",caption:"Each gauge retains its own complete calendar years and its own annual P95 threshold. Each year's quantity is the observed water volume carried by days at or above that year's daily-flow 95th percentile, divided by that same year's total water volume. Ties can make the high-flow group exceed 5% of days. Boxes span the across-year 25th–75th percentiles, with median center, observed minimum/maximum whiskers and open-diamond mean; one-year support remains a single value. The source table lists each gauge's exact years and counts. Water volumes are evaluated separately at every gauge.",layout:{columns:1,rows:3},panels:highPanels};
 const durationSelections=[["02186702",2023,"Eighteenmile"],["02193340",2023,"Kettle Creek"],["02196000",2023,"Stevens Creek"],["02196485",2025,"Augusta Canal"]];
 const durationPanels=durationSelections.map(([site,year,name])=>{
  const station=stations.find(r=>r.site===site),years=station.complete_years.filter(y=>y!==year);
  if(!station.complete_years.includes(year)||!years.length)throw Error("Select a complete duration target and reference");
  const targetRows=duration.filter(r=>r.site===site&&r.year===year&&r.exceedance_percent>=5&&r.exceedance_percent<=95).sort((a,b)=>a.exceedance_percent-b.exceedance_percent);
  const targetPoints=targetRows.map(r=>point(r.exceedance_percent,r.observed_discharge_cfs,r,"observed_discharge_cfs"));
  const reference=targetRows.map(r=>{const refs=duration.filter(q=>q.site===site&&years.includes(q.year)&&q.exceedance_percent===r.exceedance_percent),s=summaries(refs,"observed_discharge_cfs");return {x:r.exceedance_percent,y:s.median,site,selected_year:year,reference_years:years,source_records:s.source_records,source_table:"duration",source_field:"observed_discharge_cfs"};});
  return {id:"duration-"+site,title:name+" · "+year,x:{label:"Daily-flow exceedance",unit:"%",domain:[5,95],ticks:[5,25,50,75,95].map(value=>({value,label:String(value)}))},y:numericAxis("Daily mean", "ft3/s",[...targetPoints,...reference].map(r=>r.y)),
   series:[{label:String(year)+" observed",geometry:"line",marker:"circle",points:targetPoints},{label:"Other-year median",geometry:"line",marker:"square-open",points:reference}],reference_lines:[],site,reference_years:years};
 });
 const durationFigure={id:"observed-flow-duration-context",svg:"observed_flow_duration_context.svg",title:"Observed flow-duration shapes retain each gauge's own context",caption:"Solid circles show the selected complete calendar year; open squares show the pointwise median of other complete years at the same gauge. The view covers Q5–Q95. Q5 is the observed 95th percentile and Q95 is the observed 5th percentile, using R7 interpolation; complete Q0–Q100 records remain in flow-duration.csv. Panel discharge axes retain their own numeric ranges. Eighteenmile, Kettle and Stevens use 2023 with other complete 2020–2025 years; Augusta Canal uses 2025 with its only other complete year, 2020. Original catchment, regulation and diversion identities remain attached to each gauge.",layout:{columns:2,rows:2},panels:durationPanels};
 return {schema:"upstate.scientific-figure-spec/v1",title:"Original Upper Savannah seasonal and flow-duration context",source_files:sourceFiles,source_notes:["All figure coordinates derive from the retained 29-gauge calendar-period producer and its original agency responses.","Point source_table/source_row_index values use zero-based rows of explorer-data.json. Aggregate points retain their original contributing row selectors.","Complete-numeric period and annual eligibility are separate; gauge quantities preserve individual spatial identities."],figures:[monthlyFigure,seasonalFigure,highFigure,durationFigure]};
}
