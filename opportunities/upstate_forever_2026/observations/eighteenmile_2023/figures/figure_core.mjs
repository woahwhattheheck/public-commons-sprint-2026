function parseCsv(text){const rows=[],row=[];let field="",quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===","&&!quoted){row.push(field);field="";}else if((c==="\n"||c==="\r")&&!quoted){row.push(field);field="";rows.push(row.splice(0));if(c==="\r"&&text[i+1]==="\n")i++;}else field+=c;}if(quoted)throw Error("Unclosed CSV quote");if(field.length||row.length){row.push(field);rows.push(row);}const header=rows.shift();return rows.filter(r=>r.length!==1||r[0]!=="").map(r=>{if(r.length!==header.length)throw Error("CSV width mismatch");return Object.fromEntries(header.map((h,i)=>[h,r[i]]));});}

function writeCsv(rows) {
 const fields=rows.length?Object.keys(rows[0]):[];
 const cell=value=>{const s=value===null||value===undefined?"":typeof value==="object"?JSON.stringify(value):String(value);return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
 return fields.join(",")+"\n"+rows.map(row=>fields.map(k=>cell(row[k])).join(",")).join("\n")+(rows.length?"\n":"");
}

function prepareFigureData(selected,flowRows){
 const flowByDate=new Map(flowRows.map(r=>[r.sampling_date,r]));
 const seen=new Set(), counts={}, expectedSites=new Set(["SV-268","SV-838","SV-839","SV-374","SV-840"]);
 const rows=selected.map(r=>{
  const station=r.station_id.replace(/^21SC60WQ_WQX-/,""),f=flowByDate.get(r.sample_date);
  if(!expectedSites.has(station)||!f)throw Error("Missing original site/date context: "+r.record_id);
  if(r.reported_unit!=="ug/L"||r.activity_depth_unit!=="m"||Number(r.activity_depth)!==.3||r.project_id!=="CHLA"||r.study_chla_selection!=="selected_reconciled_study")throw Error("Unexpected selected CHLA source semantics: "+r.record_id);
  const v=Number(r.numeric_reported_value);if(!Number.isFinite(v)||v<0)throw Error("Invalid original CHLA value");
  const key=station+"|"+r.sample_date;if(seen.has(key))throw Error("Duplicate selected site/date");seen.add(key);counts[station]=(counts[station]||0)+1;
  if(+f.prior_7d_valid_days!==7||+f.annual_reference_valid_days!==365)throw Error("Incomplete observed flow context");
  return {station_id:station,sample_date:r.sample_date,sample_time:r.sample_time,sample_timezone:r.sample_timezone,sample_depth_m:r.activity_depth,chlorophyll_a_ug_l:v,
   record_id:r.record_id,activity_id:r.activity_id,source_path:r.source_path,source_sha256:r.source_sha256,source_record_index:+r.source_record_index,source_url:r.source_url,
   gauge_id:f.gauge_id,same_date_mean_cfs:+f.same_date_mean_cfs,prior_3d_mean_cfs:+f.prior_3d_mean_cfs,prior_7d_mean_cfs:+f.prior_7d_mean_cfs,prior_7d_maximum_daily_cfs:+f.prior_7d_maximum_daily_cfs,
   prior_7d_maximum_dates:f.prior_7d_maximum_dates,annual_p95_daily_cfs:+f.annual_p95_daily_cfs,same_date_flow_source_id:f.same_date_flow_source_id,same_date_flow_source_record_index:+f.same_date_flow_source_record_index,
   prior_7d_source_records:JSON.parse(f.prior_7d_source_records)};
 });
 if(rows.length!==75||flowRows.length!==16||Object.values(counts).some(x=>x!==15))throw Error("Unexpected selected study cohort");
 return rows;
}

function buildScientificFigures(chlorophyll, flowRows, d3, sources) {
  const order=["SV-268","SV-838","SV-839","SV-374","SV-840"];
  const names={"SV-268":"","SV-838":"","SV-839":"","SV-374":"","SV-840":""};
  const day=s=>Date.parse(s+"T00:00:00Z")/86400000;
  const start=day("2023-04-01"),end=day("2023-10-20");
  const monthTicks=[["2023-04-01","Apr"],["2023-05-01","May"],["2023-06-01","Jun"],["2023-07-01","Jul"],["2023-08-01","Aug"],["2023-09-01","Sep"],["2023-10-01","Oct"],["2023-10-17","17 Oct"]];
  const esc=x=>String(x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));
  const n=x=>Number(x.toFixed(3));
  const T=(x,y,s,extra="")=>'<text x="'+n(x)+'" y="'+n(y)+'" '+extra+'>'+esc(s)+'</text>';
  const L=(x1,y1,x2,y2,extra="")=>'<line x1="'+n(x1)+'" y1="'+n(y1)+'" x2="'+n(x2)+'" y2="'+n(y2)+'" '+extra+'/>';
  const C=(x,y,r,extra="",title="")=>'<circle cx="'+n(x)+'" cy="'+n(y)+'" r="'+r+'" '+extra+'>'+(title?"<title>"+esc(title)+"</title>":"")+'</circle>';
  const P=(points,extra="",title="")=>'<polygon points="'+points.map(p=>p.map(n).join(",")).join(" ")+'" '+extra+'>'+(title?"<title>"+esc(title)+"</title>":"")+'</polygon>';
  const scale=(v,a,b,c,d)=>c+(v-a)/(b-a)*(d-c);
  const mean=a=>a.reduce((n,x)=>n+x,0)/a.length;
  const values=site=>chlorophyll.filter(r=>r.station_id===site).sort((a,b)=>a.sample_date.localeCompare(b.sample_date));
  const summary=order.map(site=>{
    const a=values(site).map(r=>r.chlorophyll_a_ug_l).sort((a,b)=>a-b);
    return {station_id:site,n:a.length,minimum:a[0],q1:d3.quantileSorted(a,.25),median:d3.quantileSorted(a,.5),q3:d3.quantileSorted(a,.75),maximum:a.at(-1),mean:mean(a),
      sample_sd:Math.sqrt(a.reduce((n,x)=>n+(x-mean(a))**2,0)/(a.length-1)),quantile_method:"D3 quantileSorted; R-7 linear interpolation",whisker_method:"Observed minimum and maximum"};
  });
  const meta=kind=>({schema:"upstate.observed-study-figure/v1",figure:kind,source_files:sources,plotted_chlorophyll_rows:chlorophyll.length,flow_dates:flowRows.length,
    notes:["Source sample dates are calendar labels; original timezones remain in the plot-data CSV.","All plotted chlorophyll values are the selected original quantified 0.3 m CHLA measurements.","Daily discharge refers to upstream USGS 02186702. Prior windows exclude the sample date."]});
  function document(width,height,title,subtitle,body,notes,kind){
    return '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'" role="img" aria-labelledby="title description">\n'+
      '<title id="title">'+esc(title)+'</title><desc id="description">'+esc(subtitle+" "+notes.join(" "))+'</desc><metadata>'+esc(JSON.stringify(meta(kind)))+'</metadata>'+
      '<style>text{font-family:Arial,Helvetica,sans-serif;font-size:14px;fill:#222} .title{font-size:24px;font-weight:600}.subtitle{font-size:15px;fill:#555}.small{font-size:12px;fill:#555}.panel{font-size:15px;font-weight:600}.grid{stroke:#dedede;stroke-width:1}.axis{stroke:#555;stroke-width:1}.data{fill:none;stroke:#222;stroke-width:1.7}.point{fill:#fff;stroke:#222;stroke-width:1.4}</style>'+
      '<rect width="100%" height="100%" fill="#fff"/>'+T(64,42,title,'class="title"')+T(64,69,subtitle,'class="subtitle"')+body+
      notes.map((s,i)=>T(64,height-20-(notes.length-1-i)*18,s,'class="small"')).join("")+"\n</svg>\n";
  }
  function yAxis(x,y,w,h,max,ticks,label=true){
    return d3.ticks(0,max,ticks).map(v=>{const py=y+h-v/max*h;return L(x,py,x+w,py,'class="grid"')+(label?T(x-12,py+4,v,'text-anchor="end" class="small"'):"");}).join("")+
      L(x,y,x,y+h,'class="axis"')+L(x,y+h,x+w,y+h,'class="axis"');
  }
  function dateAxis(x,y,w,labels=true){
    return monthTicks.map(([date,label])=>{const px=scale(day(date),start,end,x,x+w);return L(px,y,px,y+5,'class="axis"')+(labels?T(px,y+23,label,'text-anchor="middle" class="small"'):"");}).join("");
  }
  let body="";
  const x=115,w=945,h=116;
  for(let i=0;i<order.length;i++){
    const site=order[i],y=124+i*150,rows=values(site),s=summary[i],xx=r=>scale(day(r.sample_date),start,end,x,x+w),yy=r=>y+h-r.chlorophyll_a_ug_l/40*h;
    body+=T(x,y-13,site+"  "+names[site]+'  |  n = '+rows.length+'; mean '+s.mean.toFixed(2)+' ug/L','class="panel"')+yAxis(x,y,w,h,40,4)+dateAxis(x,y+h,w,i===4);
    body+='<path d="'+d3.line().x(xx).y(yy).curve(d3.curveLinear)(rows)+'" class="data"/>';
    for(const r of rows)body+=C(xx(r),yy(r),3.8,'class="point" data-record-id="'+esc(r.record_id)+'"',r.station_id+" "+r.sample_date+" "+r.sample_time+" "+r.sample_timezone+"; "+r.chlorophyll_a_ug_l+" ug/L; "+r.activity_id);
  }
  body+=T(27,495,"Chlorophyll a (ug/L)",'transform="rotate(-90 27 495)" text-anchor="middle"')+T(580,894,"Original 2023 sampling date",'text-anchor="middle"');
  const series=document(1120,985,"Measured chlorophyll across the Eighteenmile lake arm","Five original stations; fifteen reconciled surface samples per station; common concentration scale.",body,[
    "Original WQP CHLA records, 0.3 m depth. Lines connect sampled dates; no values are interpolated into the source table.",
    "Station order follows the study's creek-to-lake sequence. Original agency activity IDs and timezones remain in plot-data.csv.",
    "The published Table 7 n = 4 at SV-374/SV-840 remains separate from the reconstructed fifteen-observation cohort."
  ],"chlorophyll-time-series");
  body=yAxis(100,125,910,370,40,4)+T(26,310,"Chlorophyll a (ug/L)",'transform="rotate(-90 26 310)" text-anchor="middle"');
  for(let i=0;i<order.length;i++){
    const site=order[i],s=summary[i],cx=182+i*183,yy=v=>495-v/40*370;
    body+=L(cx,yy(s.maximum),cx,yy(s.minimum),'stroke="#444" stroke-width="1.2"')+L(cx-14,yy(s.minimum),cx+14,yy(s.minimum),'stroke="#444"')+L(cx-14,yy(s.maximum),cx+14,yy(s.maximum),'stroke="#444"');
    body+='<rect x="'+(cx-28)+'" y="'+n(yy(s.q3))+'" width="56" height="'+n(yy(s.q1)-yy(s.q3))+'" fill="#ededed" stroke="#555"/>'+L(cx-28,yy(s.median),cx+28,yy(s.median),'stroke="#111" stroke-width="2"');
    values(site).forEach((r,j)=>{const jitter=((j*7)%15-7)*2.6;body+=C(cx+jitter,yy(r.chlorophyll_a_ug_l),3.2,'fill="#fff" stroke="#333" stroke-width="1.1" data-record-id="'+esc(r.record_id)+'"',site+" "+r.sample_date+": "+r.chlorophyll_a_ug_l+" ug/L");});
    body+=P([[cx,yy(s.mean)-5],[cx+5,yy(s.mean)],[cx,yy(s.mean)+5],[cx-5,yy(s.mean)]],'fill="#111" stroke="#111"',"Mean "+s.mean.toFixed(6)+" ug/L");
    body+=T(cx,521,site,'text-anchor="middle" class="panel"')+T(cx,544,"n = "+s.n+"; mean "+s.mean.toFixed(2),'text-anchor="middle" class="small"');
  }
  const distribution=document(1080,650,"Observed station distributions","All 75 original selected values; the plot uses their measured concentration units.",body,[
    "Boxes span the 25th–75th percentiles; center line = median; whiskers = observed minimum/maximum; diamond = mean.",
    "Each circle is one original sample. Horizontal offsets separate points and do not encode a variable. Quantiles use R-7.",
    "Source: original WQP CHLA activities and the retained explicit study-calendar/routine-overlap reconciliation."
  ],"chlorophyll-distributions");
  const numericFlow=flowRows.map(r=>({...r,same:+r.same_date_mean_cfs,prior:+r.prior_7d_maximum_daily_cfs,mean7:+r.prior_7d_mean_cfs,p95:+r.annual_p95_daily_cfs})).sort((a,b)=>a.sampling_date.localeCompare(b.sampling_date));
  const fx=115,fy=150,fw=935,fh=390,xx=r=>scale(day(r.sampling_date),start,end,fx,fx+fw),yy=v=>fy+fh-v/750*fh,p95=numericFlow[0].p95;
  body=yAxis(fx,fy,fw,fh,750,7)+dateAxis(fx,fy+fh,fw)+T(28,345,"Discharge (ft3/s)",'transform="rotate(-90 28 345)" text-anchor="middle"');
  body+=L(fx,yy(p95),fx+fw,yy(p95),'stroke="#777" stroke-width="1.2" stroke-dasharray="3 4"')+T(fx+fw-4,yy(p95)-7,"2023 daily-flow 95th percentile = "+p95.toFixed(1),'text-anchor="end" class="small"');
  body+='<path d="'+d3.line().x(xx).y(r=>yy(r.same))(numericFlow)+'" class="data"/>'+
        '<path d="'+d3.line().x(xx).y(r=>yy(r.prior))(numericFlow)+'" fill="none" stroke="#555" stroke-width="1.6" stroke-dasharray="6 4"/>';
  for(const r of numericFlow){
    const title=r.sampling_date+"; same-date "+r.same+" ft3/s; prior 7-day max "+r.prior+" ft3/s on "+r.prior_7d_maximum_dates;
    body+=C(xx(r),yy(r.same),4,'class="point"',title)+P([[xx(r),yy(r.prior)-5],[xx(r)+5,yy(r.prior)+4],[xx(r)-5,yy(r.prior)+4]],'fill="#fff" stroke="#555" stroke-width="1.3"',title);
    if(r.chla_sites&&r.prior>=p95){const dx=r.sampling_date==="2023-06-27"?-7:7,anchor=dx<0?"end":"start";body+=T(xx(r)+dx,yy(r.prior)-12,r.prior.toFixed(0)+" on "+r.prior_7d_maximum_dates.slice(5),'class="small" text-anchor="'+anchor+'"');}
    if(!r.chla_sites){body+=L(xx(r),fy+fh,xx(r),fy+fh+34,'stroke="#555"')+T(xx(r),fy+fh+49,"24 Aug: microcystin only",'text-anchor="middle" class="small"');}
  }
  body+=L(115,106,155,106,'class="data"')+C(135,106,4,'class="point"')+T(165,111,"Same-date daily mean",'class="small"')+
        L(405,106,445,106,'stroke="#555" stroke-dasharray="6 4"')+P([[425,101],[430,110],[420,110]],'fill="#fff" stroke="#555"')+T(456,111,"Maximum daily mean in preceding 7 calendar days",'class="small"');
  const hydro=document(1120,750,"Original laboratory dates and preceding upstream flow","USGS 02186702; fifteen chlorophyll dates plus one additional microcystin date.",body,[
    "Prior windows exclude the laboratory date. Each window has 7/7 observed daily means; peak labels show the original date.",
    "The 95th percentile uses all 365 observed 2023 daily means. Lines connect retained laboratory dates, not all river-flow days.",
    "The gauge is upstream of the lake stations. Original sample times/timezones and each USGS source-record index are retained."
  ],"sampling-flow-context");
  body="";
  for(let i=0;i<order.length;i++){
    const site=order[i],col=i%2,row=Math.floor(i/2),px=90+col*530,py=140+row*237,pw=420,ph=162,rx=v=>px+v/700*pw,ry=v=>py+ph-v/40*ph;
    body+=T(px,py-16,site+"  "+names[site],'class="panel"')+yAxis(px,py,pw,ph,40,4);
    for(const v of d3.ticks(0,700,4))body+=L(rx(v),py+ph,rx(v),py+ph+4,'class="axis"')+T(rx(v),py+ph+21,v,'text-anchor="middle" class="small"');
    body+=L(rx(p95),py,rx(p95),py+ph,'stroke="#777" stroke-dasharray="3 4"');
    for(const r of values(site))body+=C(rx(r.prior_7d_maximum_daily_cfs),ry(r.chlorophyll_a_ug_l),4.2,'fill="'+(r.prior_7d_maximum_daily_cfs>=p95?"#333":"#fff")+'" stroke="#222" stroke-width="1.3" data-record-id="'+esc(r.record_id)+'"',site+" "+r.sample_date+": "+r.chlorophyll_a_ug_l+" ug/L; previous 7-day peak "+r.prior_7d_maximum_daily_cfs+" ft3/s");
    body+=T(px+pw/2,py+ph+43,"Previous 7-day maximum daily mean (ft3/s)",'text-anchor="middle" class="small"');
  }
  body+=T(27,475,"Chlorophyll a (ug/L)",'transform="rotate(-90 27 475)" text-anchor="middle"')+
    T(620,635,"Interpretation",'class="panel"')+T(620,662,"Each point is an actual lake sample.",'class="small"')+
    T(620,688,"Filled points followed a daily mean at or above",'class="small"')+T(620,707,"the annual 95th percentile within the preceding week.",'class="small"')+
    T(620,737,"The upstream context is shared across sites.",'class="small"')+T(620,756,"No regression or causal attribution is applied.",'class="small"');
  const association=document(1120,930,"Chlorophyll and preceding upstream-flow context","The same 75 selected samples, with original dates joined to the observed upstream gauge.",body,[
    "Vertical reference = annual daily-flow 95th percentile, 134.8 ft3/s. The prior-seven-day maximum excludes the sample date.",
    "Identical horizontal coordinates across sites reflect a shared upstream context; each lake measurement retains its own site.",
    "Plot data include original activity IDs, values, units, agency file hashes and every antecedent USGS source-record index."
  ],"chlorophyll-antecedent-context");
  return{svg:{"chlorophyll_time_series.svg":series,"chlorophyll_distributions.svg":distribution,"sampling_flow_context.svg":hydro,"chlorophyll_antecedent_context.svg":association},distribution_statistics:summary};
}

function buildFigureSpecification(chlorophyll,flowRows,summary,sources){
 const order=["SV-268","SV-838","SV-839","SV-374","SV-840"],day=s=>Date.parse(s+"T00:00:00Z")/86400000;
 const dateTicks=[["2023-04-01","Apr"],["2023-05-01","May"],["2023-06-01","Jun"],["2023-07-01","Jul"],["2023-08-01","Aug"],["2023-09-01","Sep"],["2023-10-01","Oct"],["2023-10-17","17 Oct"]].map(([date,label])=>({value:day(date),label}));
 const dateAxis={label:"Original 2023 sampling date",unit:"days since 1970-01-01 UTC",domain:[day("2023-04-01"),day("2023-10-20")],ticks:dateTicks,interpretation:"Calendar date encoded on a numeric axis; original sample time and timezone are not converted."};
 const chlaAxis={label:"Chlorophyll a",unit:"ug/L",domain:[0,40],ticks:[0,10,20,30,40].map(value=>({value,label:String(value)}))};
 const points=site=>chlorophyll.filter(r=>r.station_id===site).sort((a,b)=>a.sample_date.localeCompare(b.sample_date)).map(r=>({x:day(r.sample_date),y:r.chlorophyll_a_ug_l,date:r.sample_date,record_id:r.record_id,activity_id:r.activity_id,source_path:r.source_path,source_sha256:r.source_sha256,source_record_index:r.source_record_index,sample_time:r.sample_time,sample_timezone:r.sample_timezone,sample_depth_m:r.sample_depth_m}));
 const p95=+flowRows[0].annual_p95_daily_cfs;
 const captions={
 time:"Five original stations, fifteen reconciled CHLA surface samples per station, sampled 5 April–17 October 2023 at 0.3 m. Common 0–40 ug/L scales permit comparison. Lines connect sampled dates; all points retain original activity IDs, values, dates and declared timezones. Two same-date routine-clock overlaps are explicitly excluded from the selected cohort and retained in the complete measurement table. Printed Table 7 n = 4 at SV-374 and SV-840 is retained separately from the fifteen original observations at each station.",
 distribution:"All 75 original selected values are shown. Boxes span the 25th–75th percentiles, with R-7 linear interpolation; center lines show medians; whiskers show observed minima and maxima; diamonds show arithmetic means. Horizontal point offsets separate observations and do not encode another variable.",
 flow:"Daily mean discharge at upstream USGS 02186702 on fifteen chlorophyll dates and the additional 24 August microcystin date. Dashed series gives the highest observed daily mean during the preceding seven calendar days, excluding the laboratory date. Each window contains seven observations. The 134.8 ft3/s reference is the 95th percentile of all 365 observed 2023 daily means. The gauge supplies upstream context; these are not measured discharges at the lake stations.",
 antecedent:"The same 75 original lake observations are plotted against their shared preceding-seven-day maximum daily mean at upstream USGS 02186702. Filled points followed at least one daily mean at or above the 2023 95th percentile. All five panels use common scales. The points describe source-bound temporal context; no fitted regression or causal attribution is applied."
 };
 const commonSourceNotes=["Original CHLA units, depth, laboratory activity IDs and declared timezones are retained.","Flow windows exclude the sampling date. Every daily source-record index is retained in plot-data.csv and study_flow_dates.csv.","Numerical quantities are plotted directly without censor substitution or concentration-to-load conversion."];
 const ts={id:"chlorophyll-time-series",svg:"chlorophyll_time_series.svg",title:"Measured chlorophyll across the Eighteenmile lake arm",caption:captions.time,layout:{columns:1,rows:5},panels:order.map(site=>({id:site,title:site,x:dateAxis,y:chlaAxis,series:[{label:site,geometry:"line",marker:"circle-open",connect_points:true,points:points(site)}],reference_lines:[]}))};
 const distributions={id:"chlorophyll-distributions",svg:"chlorophyll_distributions.svg",title:"Observed station distributions",caption:captions.distribution,layout:{columns:1,rows:1},panels:[{id:"five-stations",title:"",x:{label:"Monitoring station",unit:"station index",domain:[-.5,4.5],ticks:order.map((label,value)=>({value,label}))},y:chlaAxis,series:[{label:"Observed station distribution",geometry:"boxplot",marker:"diamond-mean",points:order.map((site,x)=>({...summary.find(r=>r.station_id===site),x,y:summary.find(r=>r.station_id===site).median}))},{label:"Original observations",geometry:"scatter",marker:"circle-open",points:order.flatMap((site,i)=>points(site).map((r,j)=>({...r,x:i+(((j*7)%15)-7)*.0142,station_index:i,station_id:site,jitter_non_data:true})))}],reference_lines:[]}]};
 const flow=[...flowRows].sort((a,b)=>a.sampling_date.localeCompare(b.sampling_date));
 const fy={label:"Daily mean discharge",unit:"ft3/s",domain:[0,750],ticks:[0,100,200,300,400,500,600,700].map(value=>({value,label:String(value)}))};
 const flowPoints=field=>flow.map(r=>({x:day(r.sampling_date),y:+r[field],date:r.sampling_date,gauge_id:r.gauge_id,same_date_flow_source_id:r.same_date_flow_source_id,same_date_flow_source_record_index:+r.same_date_flow_source_record_index,prior_7d_maximum_dates:r.prior_7d_maximum_dates,prior_7d_source_records:JSON.parse(r.prior_7d_source_records),chla_sites:r.chla_sites,micro_sites:r.micro_sites}));
 const hydro={id:"sampling-flow-context",svg:"sampling_flow_context.svg",title:"Original laboratory dates and preceding upstream flow",caption:captions.flow,layout:{columns:1,rows:1},panels:[{id:"USGS-02186702",title:"USGS 02186702",x:dateAxis,y:fy,series:[{label:"Same-date daily mean",geometry:"line",marker:"circle-open",connect_points:true,points:flowPoints("same_date_mean_cfs")},{label:"Maximum daily mean in preceding 7 calendar days",geometry:"line",line_style:"dashed",marker:"triangle-open",connect_points:true,points:flowPoints("prior_7d_maximum_daily_cfs")}],reference_lines:[{axis:"y",value:p95,label:"2023 daily-flow 95th percentile: 134.8 ft3/s",line_style:"dotted"}],annotations:flow.filter(r=>r.chla_sites&&+r.prior_7d_maximum_daily_cfs>=p95).map(r=>({x:day(r.sampling_date),y:+r.prior_7d_maximum_daily_cfs,text:r.prior_7d_maximum_daily_cfs+" on "+r.prior_7d_maximum_dates})).concat([{x:day("2023-08-24"),y:0,text:"24 Aug: microcystin only"}])}]};
 const ax={label:"Previous 7-day maximum daily mean",unit:"ft3/s",domain:[0,700],ticks:[0,200,400,600,700].map(value=>({value,label:String(value)}))};
 const antecedent={id:"chlorophyll-antecedent-context",svg:"chlorophyll_antecedent_context.svg",title:"Chlorophyll and preceding upstream-flow context",caption:captions.antecedent,layout:{columns:2,rows:3},panels:order.map(site=>({id:site,title:site,x:ax,y:chlaAxis,series:[{label:site,geometry:"scatter",marker:"circle",points:chlorophyll.filter(r=>r.station_id===site).map(r=>({x:r.prior_7d_maximum_daily_cfs,y:r.chlorophyll_a_ug_l,date:r.sample_date,record_id:r.record_id,activity_id:r.activity_id,filled:r.prior_7d_maximum_daily_cfs>=p95,prior_7d_maximum_dates:r.prior_7d_maximum_dates,source_sha256:r.source_sha256,source_record_index:r.source_record_index,prior_7d_source_records:r.prior_7d_source_records}))}],reference_lines:[{axis:"x",value:p95,label:"2023 daily-flow 95th percentile",line_style:"dotted"}]}))};
 return{schema:"upstate.scientific-figure-spec/v1",title:"Eighteenmile 2023 measured chlorophyll and observed-flow context",station_order:order,source_files:sources,source_notes:commonSourceNotes,figures:[ts,distributions,hydro,antecedent]};
}

export {parseCsv,writeCsv,prepareFigureData,buildScientificFigures,buildFigureSpecification};
