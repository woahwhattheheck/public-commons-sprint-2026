import {BASE} from "./derive.mjs";
const json=v=>JSON.stringify(v,null,2)+"\n";
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const day=d=>Date.parse(d+"T00:00:00Z")/86400000;
const point=r=>({x:day(r.date),y:r.numeric_value,result_id:r.result_id,original_source:r.original_result_source,filled:!(r.qualifier||r.quality_codes.length)});
function svg(figure){
 const W=940,H=figure.panels.length*345,parts=['<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" role="img"><title>'+esc(figure.title)+'</title><desc>'+esc(figure.caption)+'</desc><rect width="100%" height="100%" fill="#fff"/>'];
 const text=(x,y,value,size=13,anchor="start",bold=false)=>'<text x="'+x+'" y="'+y+'" text-anchor="'+anchor+'" font-family="Arial,Helvetica,sans-serif" font-size="'+size+'"'+(bold?' font-weight="bold"':"")+' fill="#202020">'+esc(value)+'</text>';
 for(let p=0;p<figure.panels.length;p++){
 const panel=figure.panels[p],top=p*345,left=66,right=914,bottom=top+262,plotTop=top+48;
 const X=v=>left+(v-panel.x.domain[0])/(panel.x.domain[1]-panel.x.domain[0])*(right-left),Y=v=>bottom-(v-panel.y.domain[0])/(panel.y.domain[1]-panel.y.domain[0])*(bottom-plotTop);
 const line=(x1,y1,x2,y2,dashed=false,color="#b5b5b5")=>'<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="'+color+'" stroke-width="1"'+(dashed?' stroke-dasharray="4 3"':"")+'/>';
 parts.push(text(left,top+23,panel.title,16,"start",true));
 parts.push(text(right,top+23,panel.y.label+(panel.y.unit?" ("+panel.y.unit+")":""),12,"end"));
 for(const tick of panel.y.ticks||[]){parts.push(line(left,Y(tick.value),right,Y(tick.value)),text(left-10,Y(tick.value)+4,tick.label??tick.value,12,"end"));}
 for(const tick of panel.x.ticks||[]){parts.push(line(X(tick.value),bottom,X(tick.value),bottom+5,false,"#202020"),text(X(tick.value),bottom+22,tick.label??tick.value,12,"middle"));}
 parts.push(line(left,plotTop,left,bottom,false,"#202020"),line(left,bottom,right,bottom,false,"#202020"));
 for(const ref of panel.reference_lines||[]){const yAxis=(ref.axis||"y")==="y";parts.push(yAxis?line(left,Y(ref.value),right,Y(ref.value),true,"#202020"):line(X(ref.value),plotTop,X(ref.value),bottom,true,"#909090"));if(ref.label&&yAxis)parts.push('<rect x="'+(left+8)+'" y="'+(Y(ref.value)-20)+'" width="210" height="17" fill="#fff"/>',text(left+12,Y(ref.value)-7,ref.label,11));}
 let cursor=left;
 for(const series of panel.series){
 const marker=series.marker||"circle",open=marker.endsWith("-open");
 const mark=(x,y,filled)=>{const fill=open||filled===false?"#fff":"#202020";return marker.startsWith("square")?'<rect x="'+(x-3.2)+'" y="'+(y-3.2)+'" width="6.4" height="6.4" stroke="#202020" fill="'+fill+'"/>':marker.startsWith("triangle")?'<path d="M'+x+','+(y-4)+' L'+(x-4)+','+(y+3)+' L'+(x+4)+','+(y+3)+' Z" stroke="#202020" fill="'+fill+'"/>':'<circle cx="'+x+'" cy="'+y+'" r="3" stroke="#202020" fill="'+fill+'"/>';};
 for(const q of series.points){if(q.y===null)continue;if(q.x<panel.x.domain[0]||q.x>panel.x.domain[1]||q.y<panel.y.domain[0]||q.y>panel.y.domain[1])throw Error("Scientific point outside original axis");
 parts.push('<g><title>'+esc(q.result_id?q.result_id+" "+(q.date||"")+" "+q.y:series.label+" "+q.y)+'</title>'+mark(X(q.x),Y(q.y),!q.censored&&q.filled!==false)+'</g>');}
 parts.push(mark(cursor+4,top+326,true),text(cursor+17,top+330,series.label,12));cursor+=Math.min(390,28+series.label.length*7);
 }
 parts.push(text((left+right)/2,top+306,panel.x.label,12,"middle"));
 }
 return parts.join("")+"</svg>\n";
}
export function present(built,provenance){
 const s=built.summary,o=built.observations,thermal=built.thermal,files={};
 const timeAxis={label:"Original sampling date",unit:"days since 1970-01-01 UTC",domain:[day("2008-01-01"),day("2026-01-01")],ticks:[2008,2011,2014,2016,2018,2021,2023,2025].map(y=>({value:day(y+"-01-01"),label:String(y)}))};
 const tempFigure={id:"horsepasture-temperature",title:"Horsepasture temperature: original observations and sampling coverage",caption:"Original station21NC03WQ-H6000000, 106water-temperature records. Markers distinguish reported analytical methods; open markers carry an original coded qualification. The dashed20°C reference is the trout-temperature criterion in NC's2022 assessment methodology. The vertical lines bound2016–2020. Dates retain the published calendar date; original times and timezone labels remain in thermal-screen.csv. The monthly panel shows observations by calendar month for each five-year window. The earlier window has noJuly readings; summer accounts for7of31records versus12of26later. Counts are descriptive and do not establish a temporal trend.",panels:[
 {title:"Original temperature observations",x:timeAxis,y:{label:"Water temperature",unit:"°C",domain:[0,28],ticks:[0,5,10,15,20,25].map(value=>({value}))},reference_lines:[{axis:"y",value:20,label:"20°C trout-temperature screen"},{axis:"x",value:day("2016-01-01")},{axis:"x",value:day("2021-01-01")}],series:[{label:"WSSSOP method",geometry:"scatter",marker:"circle",points:thermal.filter(r=>r.method_id==="WSSSOP").map(point)},{label:"USEPA 170.1 method",geometry:"scatter",marker:"square",points:thermal.filter(r=>r.method_id==="170.1").map(point)}]},
 {title:"Calendar-month sampling support",x:{label:"Sampling month",unit:"",domain:[0.5,12.5],ticks:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((label,i)=>({value:i+1,label}))},y:{label:"Original observations",unit:"count",domain:[0,6],ticks:[0,1,2,3,4,5,6].map(value=>({value}))},series:["2016–2020","2021–2025"].map((period,index)=>({label:period,geometry:"scatter",marker:index?"square":"circle-open",points:Array.from({length:12},(_,i)=>({x:i+1+(index?0.1:-0.1),y:thermal.filter(r=>r.window===period&&r.month===i+1).length}))}))}
 ]};
 const phos=o.filter(r=>r.station_id==="21NC03WQ-H6000000"&&r.characteristic==="Phosphorus"&&r.fraction==="Total"&&r.method_specification==="as P"&&r.method_id==="365.1"&&r.method_context==="USEPA"&&r.analysis_unit==="mg/L");
 const phosphorusFigure={id:"horsepasture-phosphorus",title:"Horsepasture total phosphorus: results and original reporting limits",caption:"Original total-phosphorus records, USEPA365.1, reported asP. Filled circles are uncensored results; open circles retain coded qualifications. Open triangles locate each original practical quantitation limit for a non-detected result; their vertical position is the reporting limit, not an estimated concentration. Original media-subdivision labels change from blank toSurfaceWater in2013 and remain separate in comparison-groups.csv. All144records, methods, comments and88non-detections remain traceable to original result and limit files.",panels:[{title:"Total phosphorus and reporting limits",x:timeAxis,y:{label:"Total phosphorus as P",unit:"mg/L",domain:[0,0.23],ticks:[0,0.05,0.10,0.15,0.20].map(value=>({value,label:value.toFixed(2)}))},series:[
 {label:"Uncensored result",geometry:"scatter",marker:"circle",points:phos.filter(r=>!r.censored&&r.numeric_value!==null).map(point)},
 {label:"Non-detection reporting limit",geometry:"scatter",marker:"triangle-open",points:phos.filter(r=>r.censored).flatMap(r=>r.detection_limits.filter(l=>l.unit==="mg/L"&&Number.isFinite(Number(l.value))).map(l=>({x:day(r.date),y:Number(l.value),result_id:r.result_id,censored:true,original_source:l.source})))}
 ]}]};
 const figures=[tempFigure,phosphorusFigure];
 const spec={schema:"upstate.scientific-figure-spec/v1",edition:"nc-ambient-20261013",figures};
 files[BASE+"figure-spec.json"]=json(spec);for(const figure of figures)files[BASE+"figures/"+figure.id+".svg"]=svg(figure);
 const hs=s.stations.find(x=>x.station_id==="21NC03WQ-H6000000");
 const stationRows=s.stations.filter(x=>x.records).map(r=>[r.station_id,r.name,String(r.records),String(r.characteristics),r.first_date+" to "+r.last_date]);
 const thermalRows=s.horsepasture_temperature_windows.map(w=>[w.period,String(w.records),String(w.sampling_dates),String(w.above_20_count),String(w.dates_with_any_above_20),String(w.summer_records)]);
 const phosDetected=phos.filter(r=>!r.censored&&r.numeric_value!==null);
 const report={schema:"upstate.observed-report/v1",title:"NC ambient monitoring: original observations and decisions",edition:"20261013-nc-ambient-originals",inputs:[...provenance.captures,...(provenance.cross_profile_captures||[])].map(({path,bytes,sha256})=>({path,bytes,sha256})),figure_spec:BASE+"figure-spec.json",figures:figures.map(f=>({id:f.id,path:BASE+"figures/"+f.id+".svg"})),sections:[
 ["What the original measurements add",[
  "This source edition joins the publisher's original result, activity, detection-limit and station exports by their qualified identities. It retains"+s.original_result_rows+"measurement records,"+s.original_activity_rows+"activity rows and"+s.original_limit_rows+"detection-limit rows. Every numeric result remains linked to its original field values, method, comments and source row.",
  {kind:"table",columns:["Original station","Publisher station name","Results","Characteristics","Observed dates"],rows:stationRows},
  "An independent currentWQX3profile check for2021–2025matches all318original result IDs and318activity IDs. Across21mapped result fields and17mapped activity fields, every compared value agrees with the retained legacy profile. Those two current-profile originals and the explicit field mapping are included as companions.",
  "Use this measured context alongside the retained NC legal-designation and2022assessment editions. The source station coordinates are publishedNAD83; the native point source provides the geometry for selecting the project cohort."
 ]],
 ["Horsepasture thermal observations and seasonal support",[
  {kind:"table",columns:["Sampling window","Records","Sample dates",">20°C records",">20°C dates","Jun–Aug records"],rows:thermalRows},
  "The2016–2020window contains31readings on30dates, with7readings above20°C on6dates. Two readings of21.8°C on26August2016 retain distinct result IDs and reported times13:45and15:45EST.",
  "The2021–2025window contains26readings on26dates, with8above20°C. It has12June–August readings, compared with7in the earlier window. July has4readings in the later window and zero in the earlier window. This difference in seasonal support matters when interpreting the two counts.",
  "The7.7°C record on14May2025 carries the publisher'sJ12calibration-acceptance comment. Excluding this coded-qualified reading leaves25later readings and the same8above20°C. Bridge-access and depth-conversion comments remain visible as sampling context.",
  "The20°C line follows the trout-temperature criterion in the agency's2022methodology. The agency applies its own quality review, station-to-assessment-unit allocation and statistical assessment procedure. This report supplies the original measured series and descriptive screen for that review."
 ]],
 ["Nutrients: preserve detection limits and methods",[
  "Horsepasture has"+phos.length+"total-phosphorus records underUSEPA365.1, reported asP:"+phosDetected.length+"uncensored numeric results and"+phos.filter(r=>r.censored).length+"non-detections. Non-detections retain their original practical quantitation limits instead of numerical substitutions.",
  "The original characteristic names Ammonia-nitrogen andAmmonia, and the retired nitrate/nitrite name andNitrate+Nitrite, remain distinct. Their method, fraction andasN specification remain available for a documented comparability decision.",
  "The complete edition contains"+s.comparison_groups+"comparison groups defined by source station, characteristic, fraction, method, units, media and result basis. Descriptive numeric summaries use uncensored numeric records within each group. Comments and detection-limit context are reported alongside those summaries.",
  {kind:"links",items:[{title:"Complete method and unit comparison groups",path:BASE+"comparison-groups.csv"},{title:"Open the complete searchable measurement explorer",path:BASE+"measurement-explorer.html"},{title:"All observations with original source-row links",path:BASE+"observations.csv"},{title:"All original detection and quality comments",path:BASE+"quality-and-detection-review.csv"}]}
 ]],
 ["Source issues to resolve before quantitative use",[
  {kind:"table",columns:["Original result","Sampling date","Published value","Review action"],rows:built.sourceReview.map(r=>[r.result_id,r.date,r.original_value+" "+r.original_unit,"Inspect original value/unit mapping; retain published record."])},
  "The three2017dissolved-oxygen rows above are retained unchanged. Their published values exceed this analysis's30mg/L review trigger. The trigger is a source-review rule; it is separate from the6mg/L trout-water criterion. No percent-saturation conversion has been applied.",
  "Horsepasture's three uncensored turbidity results above10NTU are12NTU on16March2010,14NTU on7February2018 and110NTU on29August2023. The2023activity retains the publisher's field-depth conversion note. Original result dates and comments support follow-up at the event level.",
  {kind:"links",items:[{title:"Original-value review queue",path:BASE+"source-value-review.csv"},{title:"Temperature, oxygen and turbidity screens by period",path:BASE+"criterion-screens.csv"}]}
 ]],
 ["Bacteria: match the sampling design to the question",[
  "Horsepasture's138fecal-coliform records contain at most2samples in any30-calendar-day window in this retained cohort. The referenced recreation criterion uses at least5consecutive samples in30days. The exported sampling-support analysis shows the actual dates and preserves censored records.",
  "The900cfu/100mL result on25August2008 carriesQ1:the publisher records that holding time was exceeded before the laboratory received the sample. The source value and warning remain together.",
  "For a recreation assessment campaign, obtain the needed sequence of samples within30days with verified holding times. For thermal follow-up, coverJuly as well asAugust and use continuous temperature logging where duration and daily timing are decision-relevant. Pair water-quality sampling with an actual discharge measurement when the scientific question is mass export.",
  {kind:"links",items:[{title:"Original bacterial sampling-frequency support",path:BASE+"microbial-sampling-support.json"},{title:"Monthly coverage across all parameters",path:BASE+"sampling-coverage.csv"}]}
 ]],
 ["Open the complete editable source edition",[
  "The originalCSV files remain byte-for-byte intact. The reproducible derivation, source inventory, complete observation and quality tables, station geometry and scientific figure specification travel with this saved report.",
  {kind:"links",items:[{title:"Source methods, exact URLs and interpretation",path:BASE+"README.md"},{title:"All original capture URLs and SHA256 identities",path:BASE+"provenance.json"},{title:"Complete source summary",path:BASE+"summary.json"},{title:"Native report opening, export and receiving instructions",path:BASE+"NATIVE_OPENING.md"}]}
 ]]
 ],source_links:[BASE+"MEASUREMENT_EXPLORER.md",BASE+"measurement-explorer.html",BASE+"profile-reconciliation.json",BASE+"README.md",BASE+"provenance.json",BASE+"source-inventory.json",BASE+"observations.csv",BASE+"comparison-groups.csv",BASE+"sampling-coverage.csv",BASE+"thermal-screen.csv",BASE+"source-value-review.csv",BASE+"criterion-screens.csv",BASE+"microbial-sampling-support.json",BASE+"figure-spec.json"]};
 // Insert ordinary spaces in prose explicitly; identifiers and numeric source fields stay unchanged.
 function proseSpacing(v){return v.replace(/([a-z])(?=\d)/g,"$1 ").replace(/(\d)(?=[a-z])/g,"$1 ").replace(/(\d)(?=(?:January|February|March|April|May|June|July|August|September|October|November|December|June|Jul|August|EST|NTU)\b)/g,"$1 ").replace(/USEPA(?=\d)/g,"USEPA ").replace(/\band(?=[A-Z])/g,"and ").replace(/\bas(?=[NP]\b)/g,"as ").replace(/\bunder(?=USEPA)/g,"under ").replace(/publishedNAD/g,"published NAD").replace(/publisher'sJ/g,"publisher's J").replace(/carriesQ/g,"carries Q").replace(/Q1:the/g,"Q1: the").replace(/coverJuly/g,"cover July").replace(/noJuly/g,"no July").replace(/currentWQX/g,"current WQX").replace(/asAugust/g,"as August").replace(/toSurfaceWater/g,"to Surface Water").replace(/,(?=\S)/g,", ").replace(/P:(?=\d)/g,"P: ").replace(/originalCSV/g,"original CSV").replace(/andasN/g,"and as N").replace(/\bof(?=\d)/g,"of ");}
 for(const section of report.sections){section[0]=proseSpacing(section[0]);section[1]=section[1].map(b=>typeof b==="string"?proseSpacing(b):b);}
 for(const f of figures)f.caption=proseSpacing(f.caption);
 files[BASE+"figure-spec.json"]=json(spec);for(const f of figures)files[BASE+"figures/"+f.id+".svg"]=svg(f);
 files[BASE+"observed-report.json"]=json(report);
 const sections=report.sections.map(([title,blocks])=>"<section><h2>"+esc(title)+"</h2>"+blocks.map(block=>typeof block==="string"?"<p>"+esc(block)+"</p>":block.kind==="table"?'<div class="table"><table><thead><tr>'+block.columns.map(c=>"<th>"+esc(c)+"</th>").join("")+"</tr></thead><tbody>"+block.rows.map(r=>"<tr>"+r.map(c=>"<td>"+esc(c)+"</td>").join("")+"</tr>").join("")+"</tbody></table></div>":'<ul>'+block.items.map(i=>'<li><a href="'+esc(i.path.slice(BASE.length))+'">'+esc(i.title)+"</a></li>").join("")+"</ul>").join("")+"</section>").join("");
 files[BASE+"report.html"]='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NC ambient monitoring evidence</title><style>body{font:16px/1.55 system-ui,Arial,sans-serif;color:#202020;max-width:1080px;margin:32px auto;padding:0 22px}h1{font-size:30px;line-height:1.2}h2{font-size:23px;margin-top:34px}a{color:#202020;text-underline-offset:3px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #aaa;padding:8px;text-align:left;vertical-align:top}th{background:#eee}.table{overflow:auto}figure{margin:30px 0}figure svg{width:100%;height:auto}figcaption{font-size:14px}p,td{overflow-wrap:anywhere}@media print{body{max-width:none;margin:0;font-size:10pt}h1{font-size:22pt}h2{font-size:15pt;break-after:avoid}tr{break-inside:avoid}figure{break-inside:avoid}table{font-size:8pt}.table{overflow:visible}a{text-decoration:none}}</style><h1>NC ambient monitoring: original observations and decisions</h1><p>Original NCDEQ monitoring sources · captured 13 October 2026</p>'+sections+figures.map(f=>"<figure>"+svg(f)+"<figcaption>"+esc(f.caption)+"</figcaption></figure>").join("")+"</html>\n";
 return{files,report,figures};
}
