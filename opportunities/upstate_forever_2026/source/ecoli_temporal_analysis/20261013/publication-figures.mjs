import {parseCSV} from "./analysis.mjs";

const day=s=>Date.parse(s+"T00:00:00Z")/86400000;
const ticks=values=>values.map(value=>({value,label:String(value)}));
const axis=(label,unit,domain,values)=>({label,unit,domain,ticks:ticks(values)});
const numeric=value=>{const n=Number(value);if(!Number.isFinite(n))throw Error("Non-finite original figure value");return n;};
const row=(r,filename,index)=>({source_path:filename,source_csv_row:index+2,...r});
const series=(label,points,marker="circle",geometry="scatter")=>({label,geometry,marker,points});
export function buildPublicationFigures(files){
 const get=name=>{if(typeof files[name]!=="string")throw Error("Missing retained source "+name);return parseCSV(files[name]).rows.map((r,i)=>row(r,name,i));};
 const annual=get("annual-sampling-coverage.csv"),calendar=get("calendar-support-comparisons.csv"),daily=get("flow-daily-2022.csv"),joined=get("flow-sample-join.csv");
 if(annual.length!==5||daily.length!==365||joined.length!==16)throw Error("Original edition count changed; review the figure specification.");
 const selected=calendar.filter(r=>r.station_name==="SV-833"&&r.comment_mode==="all_original");
 if(selected.length!==2||!selected.every(r=>r.first_median_lower===r.first_median_upper&&r.last_median_lower===r.last_median_upper))throw Error("SV-833 original median bounds changed.");
 const base={schema:"upstate.scientific-figure-spec/v1",edition:"20261013-original-temporal-calendar-flow",source_basis:"Exact retained original-data calculations; all values and memberships remain in companion CSVs.",figures:[]};
 const year=axis("Year","",[2020.7,2025.3],[2021,2022,2023,2024,2025]);
 const countPoints=field=>annual.map(r=>({x:numeric(r.year),y:numeric(r[field]),source_path:r.source_path,source_csv_row:r.source_csv_row}));
 base.figures.push({id:"sampling-coverage",title:"Changing sampling coverage, 2021–2025",caption:"729 routine observations at 36 stations; one field replicate is kept separately. Eleven stations recur in all five years and contribute 450 routine observations. First appearance is within this retained source edition. The five Georgia repeat-panel stations have only Information Only comments in 2025; excluding those comments leaves six SC stations represented in all years.",alt:"Two panels compare original routine-record counts and station counts by year, including the repeated panel and stations first appearing in this source.",panels:[
 {id:"annual-records",title:"Routine sampling",x:year,y:axis("Records","count",[0,205],[0,50,100,150,200]),series:[series("All routine",countPoints("records"),"circle","line"),series("11-station panel",countPoints("complete_panel_records"),"square-open","line")],annotations:annual.map(r=>({x:+r.year,y:+r.records,text:r.records}))},
 {id:"annual-stations",title:"Station coverage",x:year,y:axis("Stations","count",[0,23],[0,5,10,15,20]),series:[series("Observed",countPoints("stations"),"circle","line"),series("First appearing",countPoints("new_stations"),"square-open")],reference_lines:[{axis:"y",value:11,label:"11 recur each year"}]}
 ]});
 const medianSeries=selected.map(r=>series(r.calendar_mode==="all_dates"?"All dates":"Common months",[
 {x:+r.first_year,y:+r.first_median_lower,n:+r.first_records,source_path:r.source_path,source_csv_row:r.source_csv_row,comparison_id:r.comparison_id,calendar_months:JSON.parse(r.common_calendar_months)},
 {x:+r.last_year,y:+r.last_median_lower,n:+r.last_records,source_path:r.source_path,source_csv_row:r.source_csv_row,comparison_id:r.comparison_id,calendar_months:JSON.parse(r.common_calendar_months)}
 ],r.calendar_mode==="all_dates"?"circle":"square-open","line"));
 base.figures.push({id:"sv833-calendar-support",title:"SV-833: the sampled calendar changes the comparison",caption:"The original all-date medians are 419.6→387.3 MPN/100 mL (9 and 11 records). Restricting both years to January, February, April, May, July, August, November and December gives 298.9→666.8 (8 records in each year). Lines connect endpoint summaries only. These selected medians have exact original interval bounds; no inferential confidence intervals or management effects are implied. Matching months does not match exact dates, weather or flow.",alt:"Two median series reverse direction: all dates decrease slightly, whereas equal common-month support increases.",panels:[{
 id:"sv833-medians",title:"2021 and 2025 sample medians",x:axis("Year","",[2020.4,2025.6],[2021,2025]),y:axis("E. coli","MPN/100 mL",[0,800],[0,200,400,600,800]),series:medianSeries,annotations:medianSeries.flatMap(s=>s.points.map(p=>({x:p.x,y:p.y,text:p.y.toFixed(1)+"; n="+p.n})))
 }]});
 const observed=joined.filter(r=>r.status==="measured"),nd=joined.filter(r=>r.status==="not_detected");
 if(observed.length!==14||nd.length!==2||!nd.every(r=>+r.upper===20&&+r.lower===0))throw Error("Original same-station censoring changed.");
 const identity=r=>({activity_id:r.activity_id,date:r.date,original_source_file:r.source_file,original_source_row:+r.source_row,source_path:r.source_path,source_csv_row:r.source_csv_row,flow_qualifiers:r.flow_qualifiers});
 const scatterPanel=(id,title,flowField,domain,xticks)=>{
  const points=observed.map(r=>({x:+r[flowField],y:+r.result_value,...identity(r)}));
  const limits=nd.map(r=>({x:+r[flowField],y:+r.upper,censored:true,lower:+r.lower,upper:+r.upper,...identity(r)}));
  const bounds=nd.flatMap(r=>[{x:+r[flowField],y:0,censored:true,...identity(r)},{x:+r[flowField],y:+r.upper,censored:true,...identity(r)},{x:+r[flowField],y:null}]);
  return {id,title,x:axis(flowField==="flow_daily_mean"?"Same-date mean":"Seven prior days","ft3/s",domain,xticks),y:axis("E. coli","MPN/100 mL",[0,800],[0,200,400,600,800]),series:[series("Measured",points),series("ND limit",limits,"triangle-open"),series("",bounds,"circle-open","line")],annotations:flowField==="antecedent7_mean"?[{x:+joined.find(r=>r.date==="2022-03-08")[flowField],y:20,text:"8 Mar: four prior days A;e"}]:[]};
 };
 const dateAxis=axis("2022 date","days since 1970-01-01 UTC",[day("2022-01-01"),day("2022-12-31")],[]);
 dateAxis.ticks=["2022-01-01","2022-04-01","2022-07-01","2022-10-01","2022-12-31"].map((d,i)=>({value:day(d),label:["Jan","Apr","Jul","Oct","Dec 31"][i]}));
 base.figures.push({id:"same-station-flow",title:"USGS-02177000: original discharge and microbial sampling",caption:"365 original 2022 daily means and all 16 microbial sample dates at the same station. All sample-date flow qualifiers are A; the seven-day window before 8 March contains four original A;e values. No microbial sample date reaches the annual 95th-percentile daily discharge (1,284 ft3/s). Filled markers are 14 numeric observations; open triangles mark the original limit for two non-detects, with vertical 0–20 censoring bounds. The prior window contains seven complete days and excludes the sample date. Source censoring bounds are distinct from confidence intervals; daily mean flow is context for these concentration observations.",alt:"An annual daily-flow curve with sample dates, followed by two concentration-versus-flow panels preserving both non-detect bounds and original flow qualifiers.",panels:[
 {id:"annual-flow",title:"Daily discharge and sample dates",x:dateAxis,y:axis("Discharge","ft3/s",[0,7500],[0,1500,3000,4500,6000,7500]),series:[series("Daily mean",daily.map(r=>({x:day(r.date),y:+r.value,date:r.date,qualifiers:r.qualifiers,source_path:r.source_path,source_csv_row:r.source_csv_row})),"circle","line"),series("Sample date",joined.map(r=>({x:day(r.date),y:+r.flow_daily_mean,...identity(r)})),"square-open")],reference_lines:[{axis:"y",value:1284,label:"Annual P95 = 1,284"}]},
 scatterPanel("same-day-flow","Same-date flow context","flow_daily_mean",[0,1200],[0,200,400,600,800,1000,1200]),
 scatterPanel("antecedent-flow","Antecedent flow context","antecedent7_mean",[0,2200],[0,500,1000,1500,2000])
 ]});
 const audit=[];
 for(const f of base.figures)for(const p of f.panels)for(const s of p.series)for(let i=0;i<s.points.length;i++){const q=s.points[i];if(q.y!==null&&q.y!==undefined&&(!Number.isFinite(q.x)||!Number.isFinite(q.y)||q.x<p.x.domain[0]||q.x>p.x.domain[1]||q.y<p.y.domain[0]||q.y>p.y.domain[1]))throw Error("Original point outside figure axes: "+p.id);if(q.y!==null)audit.push({figure:f.id,panel:p.id,series:s.label,point:i,x:q.x,y:q.y,...q});}
 return {spec:base,audit};
}
