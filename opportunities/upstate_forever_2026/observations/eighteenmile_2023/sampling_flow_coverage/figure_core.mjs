export function buildFlowCoverageFigure(result, d3) {
  const labels=["<25th","25–50th","50–75th","75–90th","90–95th","≥95th"];
  const panels=["calendar_2023","lake_study_2023"].map((scope,index)=>{
    const rows=result.duration.filter(r=>r.scope===scope),chla=result.sampling.find(r=>r.scope===scope&&r.cohort==="CHLA"),
      routine=result.sampling.find(r=>r.scope===scope&&r.cohort==="SWS-2023");
    const defs=[
      {label:"Observed water volume",marker:"square",offset:-.16,numerator:r=>r.observed_volume_m3,denominator:rows[0].period_volume_m3},
      {label:"CHLA visit dates (n="+chla.distinct_dates+")",marker:"circle-open",offset:0,numerator:r=>r.chla_visit_dates.length,denominator:chla.distinct_dates},
      {label:"SWS visit dates (n="+routine.distinct_dates+")",marker:"triangle-open",offset:.16,numerator:r=>r.routine_visit_dates.length,denominator:routine.distinct_dates}];
    const series=defs.map(s=>({label:s.label,marker:s.marker,geometry:"scatter",
      points:rows.map((r,i)=>({x:i+s.offset,y:100*s.numerator(r)/s.denominator,
        annual_flow_band:r.annual_flow_band,source_scope:scope,lower_cfs_inclusive:r.lower_cfs_inclusive,
        upper_cfs_exclusive:r.upper_cfs_exclusive,numerator:s.numerator(r),denominator:s.denominator,
        gauge_id:result.gauge_id}))}));
    const top=Math.ceil(d3.max(series.flatMap(s=>s.points),p=>p.y)/10)*10+2;
    return{id:scope,title:index?"Lake study window · 5 April–17 October 2023":"Calendar year · 1 January–31 December 2023",
      x:{label:"Annual daily-flow percentile band",unit:"category",domain:[-.5,5.5],ticks:labels.map((label,value)=>({value,label}))},
      y:{label:"Share of volume or visit dates",unit:"%",domain:[-2,top],ticks:d3.ticks(0,top-2,4).map(value=>({value,label:String(value)}))},
      series,reference_lines:[]};
  });
  const figure={id:"flow-volume-and-sampling",svg:"flow_volume_and_sampling.svg",
    title:"Eighteenmile flow volume and sampling coverage",layout:{columns:1,rows:2},panels,
    caption:"Original USGS-02186702 daily mean discharge, all 365 approved 2023 reporting days. Water-volume shares sum original daily means with equal nominal 86400-second reporting days. Each CHLA or SWS sampling calendar date is counted once across its selected stations. Both panels use the same annual flow-band thresholds. The 19 days at or above 134.8 cfs carried 25.35% of annual observed gauge volume; no CHLA visit date falls in either band above the annual 90th percentile. Cohort percentages describe original visit-date coverage of flow conditions."};
  const esc=x=>String(x).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const width=820,height=760,svg=['<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'" role="img" aria-labelledby="fc-title fc-desc">',
    '<title id="fc-title">'+esc(figure.title)+'</title><desc id="fc-desc">'+esc(figure.caption)+'</desc>',
    '<rect width="820" height="760" fill="white"/>',
    '<style>text{font-family:Arial,Helvetica,sans-serif;fill:#171717;font-size:13px} .title{font-size:20px;font-weight:bold}.panel{font-size:15px;font-weight:bold}.tick{font-size:12px}</style>',
    '<text x="28" y="30" class="title">'+esc(figure.title)+'</text>'];
  const text=(x,y,s,attr="")=>'<text x="'+x+'" y="'+y+'" '+attr+'>'+esc(s)+'</text>';
  const line=(a,b,c,d,attr="")=>'<line x1="'+a+'" y1="'+b+'" x2="'+c+'" y2="'+d+'" '+attr+'/>';
  const marker=(kind,x,y,size=60)=>{const open=kind.endsWith("-open"),base=kind.replace("-open","");
    const shape={square:d3.symbolSquare,circle:d3.symbolCircle,triangle:d3.symbolTriangle}[base];
    return'<path d="'+d3.symbol().type(shape).size(size)()+'" transform="translate('+x+','+y+')" fill="'+(open?"white":"#171717")+'" stroke="#171717" stroke-width="1.1"/>';};
  for(const [index,panel]of panels.entries()){
    const top=105+index*345,left=90,right=792,bottom=top+214;
    const X=v=>left+(v-panel.x.domain[0])/(panel.x.domain[1]-panel.x.domain[0])*(right-left);
    const Y=v=>bottom-(v-panel.y.domain[0])/(panel.y.domain[1]-panel.y.domain[0])*(bottom-top);
    svg.push(text(28,top-53,panel.title,'class="panel"'));
    panel.series.forEach((s,i)=>{const x=40+i*252;svg.push(marker(s.marker,x,top-29,45),text(x+13,top-25,s.label));});
    for(const tick of panel.y.ticks){const y=Y(tick.value);svg.push(line(left,y,right,y,'stroke="#dedede" stroke-width=".8"'),text(left-10,y+4,tick.label,'text-anchor="end" class="tick"'));}
    for(const tick of panel.x.ticks)svg.push(text(X(tick.value),bottom+22,tick.label,'text-anchor="middle" class="tick"'));
    svg.push('<rect x="'+left+'" y="'+top+'" width="'+(right-left)+'" height="'+(bottom-top)+'" fill="none" stroke="#777" stroke-width=".8"/>',
      text((left+right)/2,bottom+45,panel.x.label,'text-anchor="middle"'),
      text(23,(top+bottom)/2,panel.y.label+" (%)",'text-anchor="middle" transform="rotate(-90 23 '+((top+bottom)/2)+')"'));
    for(const series of panel.series)for(const point of series.points){
      const x=X(point.x),y=Y(point.y);if(x<left||x>right||y<top||y>bottom)throw Error("Plot mark outside original supplied domain");
      svg.push('<g><title>'+esc(series.label+"; "+point.annual_flow_band+"; "+point.y.toFixed(3)+"%")+'</title>'+marker(series.marker,x,y)+'</g>');
    }
  }
  svg.push(text(28,740,"Original flow and visit-date denominators are retained in the companion tables."),'</svg>');
  return {figure,spec:{schema:"upstate.scientific-figure-spec/v1",title:figure.title,figures:[figure]},svg:svg.join("\n")+"\n"};
}
