// Compose retained original point-source findings into the existing scientific report.
export const SCIENTIFIC_ROOT="source/point_source_scientific/20261013";
export const SCIENTIFIC_EDITION="ECHO-POINT-SOURCE-SCIENTIFIC-20261013-r1";
export const SCIENTIFIC_SOURCE_ID="eighteenmile-point-source-scientific-report";
const labels={"SC0000477":"Milliken","SC0042994":"Upper Eighteenmile","SC0047856":"Middle Eighteenmile","SC0035700":"Pendleton–Clemson"};
const fmt=(n,d=2)=>n==null?"—":new Intl.NumberFormat("en-US",{minimumFractionDigits:d,maximumFractionDigits:d}).format(n);
const escaped=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const table=(columns,rows)=>({kind:"table",columns,rows});
const json=x=>JSON.stringify(x,null,2)+"\n";
function lineSVG(figure){
 const p=figure.panels[0],w=800,h=430,left=78,right=25,top=58,bottom=88,pw=w-left-right,ph=h-top-bottom;
 const X=x=>left+(x-p.x.domain[0])/(p.x.domain[1]-p.x.domain[0])*pw;
 const Y=y=>h-bottom-(y-p.y.domain[0])/(p.y.domain[1]-p.y.domain[0])*ph;
 const text=(x,y,value,extra="")=>'<text x="'+x+'" y="'+y+'" '+extra+'>'+escaped(value)+'</text>';
 let body='<rect width="800" height="430" fill="#fff"/>'+text(left,25,figure.title,'font-size="17" font-weight="600"');
 for(const tick of p.y.ticks){const y=Y(tick.value);body+='<path d="M'+left+' '+y+'H'+(w-right)+'" stroke="#ddd"/>'+text(left-10,y+4,tick.label,'text-anchor="end" font-size="12"');}
 for(const tick of p.x.ticks){const x=X(tick.value);body+=text(x,h-bottom+24,tick.label,'text-anchor="middle" font-size="12"');}
 body+='<path d="M'+left+' '+top+'V'+(h-bottom)+'H'+(w-right)+'" fill="none" stroke="#222"/>';
 p.series.forEach((s,i)=>{
  let commands=[],segments=[];for(const point of s.points){if(point.y==null){if(commands.length)segments.push(commands);commands=[];continue;}commands.push([X(point.x),Y(point.y)]);}if(commands.length)segments.push(commands);
  for(const segment of segments)body+='<polyline points="'+segment.map(x=>x.join(",")).join(" ")+'" fill="none" stroke="#222" stroke-width="1.5"'+(i?' stroke-dasharray="5 3"':"")+'/>';
  for(const point of s.points){if(point.y==null)continue;const x=X(point.x),y=Y(point.y);body+=s.marker.startsWith("square")?'<rect x="'+(x-3)+'" y="'+(y-3)+'" width="6" height="6" stroke="#222" fill="#222"/>':'<circle cx="'+x+'" cy="'+y+'" r="3.5" stroke="#222" fill="'+(s.marker.endsWith("-open")?"#fff":"#222")+'"/>';}
  const x=left+i*250,y=h-18;body+='<path d="M'+x+' '+(y-4)+'h24" stroke="#222"'+(i?' stroke-dasharray="5 3"':"")+'/>'+text(x+31,y,s.label,'font-size="12"');
 });
 body+=text(left+pw/2,h-43,p.x.label,'text-anchor="middle" font-size="13"')+
  text(left,45,p.y.label+" ("+p.y.unit+")",'font-size="12"');
 return '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="'+figure.id+'-title '+figure.id+'-desc" viewBox="0 0 800 430"><title id="'+figure.id+'-title">'+escaped(figure.title)+'</title><desc id="'+figure.id+'-desc">'+escaped(figure.caption)+'</desc><g font-family="Arial, sans-serif" fill="#222">'+body+'</g></svg>\n';
}
export function buildPointSourceScientific(history,drivers,inputManifest,sha,encode){
 if(history.schema!=="upstate.point-source-history-analysis/v1"||drivers.schema!=="upstate.point-source-load-volume-analysis/v1")throw Error("Use the complete retained original analyses");
 if(history.source_capture!==drivers.source_capture)throw Error("Select matching original source captures");
 const allMembers=inputManifest.members,byPath=new Map(allMembers.map(f=>[f.path,f]));
 if(byPath.size!==allMembers.length)throw Error("Repeated retained scientific member path");
 const hp="source/point_source_history/20261013/",dp="source/point_source_drivers/20261013/";
 const histories=history.cohorts.filter(r=>r.parameter_code==="00665"&&r.year>=2021&&r.year<=2025).sort((a,b)=>a.year-b.year);
 if(histories.length!==5||histories.some((r,i)=>r.year!==2021+i))throw Error("Original five-year cohort incomplete");
 const current=drivers.summaries.filter(r=>r.window==="same_month_2025_2026"&&r.parameter_code==="00665");
 const mill=current.find(r=>r.series_id==="SC0000477|T1M|1|00665");
 if(!mill||current.length!==4)throw Error("Original four phosphorus comparisons are required");
 const cohort=history.current_cohorts.find(r=>r.parameter_code==="00665");
 if(!cohort)throw Error("Original current upstream TP cohort is required");
 const upstreamChanges=current.filter(r=>r.current_mapped_gauge_relation==="upstream");
 const upper=upstreamChanges.find(r=>r.permit_id==="SC0042994"),middle=upstreamChanges.find(r=>r.permit_id==="SC0047856");
 if(!upper||!middle)throw Error("Original upstream source members are required");
 const annualChange=(histories[4].available_period_sum_kg/histories[3].available_period_sum_kg-1)*100;
 const monthly=drivers.monthly.filter(r=>r.window===mill.window&&r.series_id===mill.series_id).sort((a,b)=>a.month-b.month);
 if(monthly.length!==8||monthly.some((r,i)=>r.month!==i+1))throw Error("Original Milliken common months differ");
 const yearTable=histories.map(r=>{const tss=history.cohorts.find(x=>x.year===r.year&&x.parameter_code==="00530");return[String(r.year),fmt(r.available_period_sum_kg),fmt(tss?.available_period_sum_kg)];});
 const figures=[
  {id:"upstream-five-year-phosphorus",title:"Currently upstream phosphorus: five complete years",
   caption:"Sum of the three separately retained Upper, Middle and Milliken monthly series. Every selected year has twelve unique numeric months. The current outfall-to-gauge relation is applied as context; original historical reporting features remain distinct.",
   source_members:[hp+"analysis.json"],panels:[{id:"annual-tp",title:"Original complete monthly-period sums",
    x:{label:"Reporting year",unit:"",domain:[2020.8,2025.2],ticks:histories.map(r=>({value:r.year,label:String(r.year)}))},
    y:{label:"Phosphorus load",unit:"kg/year",domain:[0,1100],ticks:[0,250,500,750,1000].map(value=>({value,label:String(value)}))},
    series:[{geometry:"line",label:"Current upstream cohort",marker:"circle-open",points:histories.map(r=>({x:r.year,y:r.available_period_sum_kg,member_series_ids:r.series_ids}))}]}]},
  {id:"milliken-common-month-phosphorus",title:"Milliken phosphorus: the same eight original months",
   caption:"Original T1M / monitoring location 1 / parameter 00665 monthly loads. 2025 uses open circles and a solid line; 2026 uses filled squares and a dashed line. Each plotted point retains its original response and JSON pointer.",
   source_members:[dp+"analysis.json"],panels:[{id:"paired-month-tp",title:"January–August, exact original monthly rows",
    x:{label:"Calendar month",unit:"",domain:[0.7,8.3],ticks:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug"].map((label,i)=>({value:i+1,label}))},
    y:{label:"Reported phosphorus load",unit:"kg/month",domain:[0,200],ticks:[0,50,100,150,200].map(value=>({value,label:String(value)}))},
    series:[{geometry:"line",label:"2025",marker:"circle-open",points:monthly.map(r=>({x:r.month,y:r.from_load_kg,source_record:r.source_from}))},
     {geometry:"line",label:"2026",marker:"square",points:monthly.map(r=>({x:r.month,y:r.to_load_kg,source_record:r.source_to}))}]}]}
 ];
 const sections=[
  ["Reported point-source discharge: original scope",[
   "The selected original EPA records cover four permitted facilities. This study retains permit, reporting feature, monitoring location and pollutant parameter as separate identities. Source capture: "+history.source_capture+".",
   "Historical coverage comprises "+history.counts.selected_series+" original series, "+history.counts.selected_annual_rows+" series-year records and "+history.counts.selected_original_period_rows+" selected original monitoring periods. "+history.counts.supported_historical_annual_rows+" historical series-years have twelve unique numeric monthly periods.",
   "Reported effluent amounts describe the selected discharge sources. The current relation to USGS-02186702 is retained as geographic context. Published annual outputs, complete monthly-period sums, same-month comparisons and the separate existing 2023 calendar-weighted scientific calculation keep their original bases."
  ]],
  ["Five-year phosphorus context",[
   "The current upstream phosphorus cohort is "+fmt(histories[4].available_period_sum_kg)+" kg in 2025, compared with "+fmt(histories[3].available_period_sum_kg)+" kg in 2024. The "+fmt(annualChange)+"% change compares with the lowest year in this five-year window; 2025 remains close to 2023 and within the original 2021–2025 range of "+fmt(Math.min(...histories.map(x=>x.available_period_sum_kg)))+"–"+fmt(Math.max(...histories.map(x=>x.available_period_sum_kg)))+" kg.",
   table(["Complete year","Phosphorus, kg","Suspended solids, kg"],yearTable),
   "Each total combines the same three currently upstream permit series while preserving their original EPA features. Suspended-solids and phosphorus masses are separate parameter-specific totals."
  ]],
  ["Exact current-year phosphorus comparisons",[
   table(["Facility / original feature","Common months","2025 load, kg","2026 load, kg","Change, kg","Current relation"],
    current.map(r=>[labels[r.permit_id]+" / "+r.reporting_feature,r.common_calendar_months.join(", "),fmt(r.from_load_kg),fmt(r.to_load_kg),fmt(r.load_change_kg),r.current_mapped_gauge_relation])),
   "Upper, Middle and Milliken share January–August. Their phosphorus load changes from "+fmt(cohort.from_common_period_sum_kg)+" to "+fmt(cohort.to_common_period_sum_kg)+" kg ("+fmt(cohort.common_period_change_kg)+" kg, "+fmt(cohort.common_period_percent_change)+"%). Milliken changes "+fmt(mill.load_change_kg)+" kg, Upper "+fmt(upper.load_change_kg)+" kg and Middle "+fmt(middle.load_change_kg)+" kg. Pendleton–Clemson remains the separate downstream January–July comparison."
  ]],
  ["Reported volume and load intensity",[
   table(["Milliken, same January–August months","2025","2026","Change"],
    [["Volume, million US gallons",fmt(mill.from_volume_mgal),fmt(mill.to_volume_mgal),fmt(mill.volume_change_percent)+"%"],
     ["Phosphorus load, kg",fmt(mill.from_load_kg),fmt(mill.to_load_kg),fmt(mill.load_change_percent)+"%"],
     ["Load per volume, kg / million US gallons",fmt(mill.from_window_load_per_mgal_kg,5),fmt(mill.to_window_load_per_mgal_kg,5),fmt(mill.window_load_intensity_change_percent)+"%"]]),
   "For each matched month M = V × I, with M in kg, V in million US gallons and I = M/V. The symmetric volume component is (V1−V0)×(I0+I1)/2; the intensity component is (I1−I0)×(V0+V1)/2. These two components sum to the original load change.",
   table(["Paired-month accounting","Volume component, kg","Intensity component, kg","Original load change, kg"],
    [["Milliken T1M phosphorus",fmt(mill.paired_month_volume_accounting_kg),fmt(mill.paired_month_intensity_accounting_kg),fmt(mill.load_change_kg)],
     ...drivers.cohorts.filter(r=>r.window===mill.window).map(r=>["Current upstream "+r.parameter,fmt(r.paired_month_volume_accounting_kg),fmt(r.paired_month_intensity_accounting_kg),fmt(r.load_change_kg)])]),
   "These are descriptive components of the original mass/volume identity. Original EPA average-concentration values and measurement choices remain separate fields. Operational causes require separate process evidence. Monthly components are summed; a separately retained whole-window calculation has a different allocation."
  ]],
  ["Original monthly phosphorus measurements",[
   table(["Month","2025 load, kg","2026 load, kg","2025 volume, Mgal","2026 volume, Mgal","2025 EPA concentration, mg/L","2026 EPA concentration, mg/L"],
    monthly.map(r=>[String(r.month),fmt(r.from_load_kg),fmt(r.to_load_kg),fmt(r.from_volume_mgal),fmt(r.to_volume_mgal),
     fmt(r.from_published_average_concentration_mg_l,4),fmt(r.to_published_average_concentration_mg_l,4)])),
   "Every selected Milliken monthly row uses the original Average Quantity measurement choice. June and July have the largest 2026 loads in this exact comparison window. The retained paired-month table includes source response IDs, exact JSON pointers, original quantity/concentration fields, qualifiers, NODI and QC flags."
  ]],
  ["Coverage and original source choices",[
   drivers.counts.series_windows+" original series/windows and "+drivers.counts.matched_month_pairs+" exact matched months have complete positive published-volume support. Four parameter-specific upstream cohorts are retained. Two quarterly/ineligible windows remain explicit in the coverage table.",
   "Full-year comparisons require twelve unique numeric monthly periods in both years. Current-year comparisons use the exact intersection of numeric original months. Middle Eighteenmile current total nitrogen retains months 1, 2, 3, 5, 6, 7 and 8. Its unsupported April remains outside that comparison.",
   "The original queries retain p_est=N and ND=ZERO. Published annual p_est=N and p_est=Y results remain separate from monthly sums; a p_est=N query alone does not establish an unscaled annual sum. Total nitrogen, ammonia and nitrate remain separate species. Future placeholders and nonnumeric periods remain original context.",
   "EPA defines PollutantLoad0 as kg per reporting period and WastewaterFlow as million gallons per reporting period. Original AvgConcentration0 is retained in mg/L. Calculations use the original displayed numeric values; detailed output rounds only after full-precision arithmetic."
  ]],
  ["Interactive original reports and complete tables",[
   {kind:"links",items:[
    {title:"Historical explorer: original series, support, comparisons and downloads",path:hp+"report.html"},
    {title:"Reported load and wastewater volume: original monthly accounting",path:dp+"report.html"},
    {title:"Historical annual source support and original row pointers",path:hp+"annual_coverage.csv"},
    {title:"Current exact same-month comparisons",path:hp+"same_month_changes_2025_2026.csv"},
    {title:"Complete load/volume paired months and source fields",path:dp+"paired_months.csv"},
    {title:"All load/volume series and windows",path:dp+"series_windows.csv"},
    {title:"Original source field definitions and primary EPA method URLs",path:"source/echo_dmr/20261013/field-guide.json"},
    {title:"Original EPA capture and source-response inventory",path:"source/echo_dmr/20261013/capture-manifest.json"},
    {title:"Retained original outfall-to-gauge relations",path:"observations/eighteenmile_2023/npdes/routing/derived/outfall_gauge_relations.csv"}
   ]}
  ]]
 ];
 const spec={schema:"upstate.scientific-figure-spec/v1",edition:SCIENTIFIC_EDITION,figures};
 const files=[{path:SCIENTIFIC_ROOT+"/figures/specification.json",content:json(spec)},...figures.map(f=>({path:SCIENTIFIC_ROOT+"/figures/"+f.id+".svg",content:lineSVG(f)}))];
 const links=sections.at(-1)[1][0].items.map(x=>x.path);
 for(const p of links)if(!byPath.has(p))throw Error("Missing retained report companion: "+p);
 const inputPaths=[hp+"analysis.json",dp+"analysis.json"];
 const recipe={schema:"upstate.observed-report/v1",edition:SCIENTIFIC_EDITION,title:"Eighteenmile reported point-source discharge: history and wastewater volume",
  captured_at:history.source_capture,measurement_support:"point_source_discharge",sections,
  inputs:inputPaths.map(path=>{const f=byPath.get(path);if(!f)throw Error("Missing original analysis");return{path,bytes:f.bytes,sha256:f.sha256};}),
  source_links:links,figure_spec:files[0].path,figures:figures.map(f=>({id:f.id,path:SCIENTIFIC_ROOT+"/figures/"+f.id+".svg"}))};
 files.push({path:SCIENTIFIC_ROOT+"/report-source.json",content:json(recipe)});
 const describe=f=>{const bytes=encode(f.content);return{path:f.path,bytes:bytes.length,sha256:sha(bytes)};};
 const generated=files.map(describe),body=generated.find(x=>x.path.endsWith("/report-source.json"));
 const companions=[...allMembers,...generated.filter(f=>f.path!==body.path)].map(({path,bytes,sha256})=>({path,bytes,sha256}));
 const manifest={schema:"upstate.sources/v1",title:recipe.title,captured_at:history.source_capture,
  scope:{permits:history.scope.permits,source_years:history.scope.source_years,measurement_support:"point_source_discharge"},
  notes:"Native ordered scientific-report source reuses the original source reports, exact analysis outputs, EPA responses and current routing. The existing observed_context consumer renders and retains all selected sources.",
  entries:[{id:SCIENTIFIC_SOURCE_ID,title:recipe.title,kind:"document",...body,
   uri:"https://echo.epa.gov/tools/web-services/loading-tool",vintage:history.source_capture,
   source_format:"JSON",role:"OBSERVED_CONTEXT",metadata:{report_schema:"upstate.observed-report/v1",producer:SCIENTIFIC_EDITION},
   measurement_support:"point_source_discharge",companions}]};
 files.push({path:"point_source_scientific.sources.json",content:json(manifest)});
 return{files,recipe,manifest,spec};
}
