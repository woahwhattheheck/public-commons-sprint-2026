// Dated source review inside the existing Observed water quality detail.
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const finite=value=>value!==null&&value!==undefined&&String(value).trim()!==""&&Number.isFinite(Number(value))?Number(value):null;
const day=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||"")?Date.parse(value+"T12:00:00Z"):NaN;
const shortNumber=value=>Math.abs(value)>=1e6||Math.abs(value)>0&&Math.abs(value)<.001?value.toExponential(3):Number(value.toPrecision(5)).toString();
function sourceValue(row,key){return row.original?.[key]??"";}
function dimensions(row,metadata){
 const unit=row.unit||sourceValue(row,metadata.limit_unit_column||"detection_limit_unit");
 const extra=(metadata.series_dimensions||[]).map(key=>sourceValue(row,key));
 return {unit,key:JSON.stringify([row.parameter,unit,...extra]),label:[row.parameter,unit,...extra.filter(v=>v!=="")].join(" · ")};
}
function point(row,metadata,unit){
 const condition=String(sourceValue(row,metadata.quantitation_column||"quantitation_class"));
 let value=finite(row.value),kind="reported";
 const originalUpperBound=value===null&&sourceValue(row,"detection_condition")==="Present Above Quantification Limit"&&sourceValue(row,"detection_limit_type")==="Upper Quantitation Limit";
 if(originalUpperBound||condition==="censored_below"||condition==="censored_above"||/^[<>]/.test(row.qualifier||"")){
   const limit=finite(sourceValue(row,metadata.limit_column||"numeric_detection_limit"));
   const limitUnit=sourceValue(row,metadata.limit_unit_column||"detection_limit_unit");
   if(/^[<>]/.test(row.qualifier||"")&&value!==null){}
   else if(limit!==null&&(!limitUnit||limitUnit===unit))value=limit;
   else if(!/^[<>]/.test(row.qualifier||""))return null;
   if(value===null)return null;
   kind=originalUpperBound||condition==="censored_above"||(row.qualifier||"").startsWith(">")?"above":"below";
 }else if(condition==="no_numeric_result")return null;
 else if(condition==="reported_with_condition")kind="qualified";
 const time=day(row.period_start);
 return value===null||!Number.isFinite(time)?null:{row,time,value,kind};
}
function originalCsv(rows){
 const fields=[...new Set(rows.flatMap(r=>Object.keys(r.original||{})))];
 const cell=v=>'"'+String(v??"").replaceAll('"','""')+'"';
 return [fields.map(cell).join(","),...rows.map(r=>fields.map(k=>cell(r.original[k])).join(","))].join("\r\n")+"\r\n";
}
function download(body,type,name){
 const url=URL.createObjectURL(new Blob([body],{type})),link=document.createElement("a");
 link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function mountObservedSeries(container,edition){
 if(!container)return;
 const metadata=edition.metadata||{},rows=edition.rows||[],groupMap=new Map();
 for(const row of rows){const d=dimensions(row,metadata);if(!groupMap.has(d.key))groupMap.set(d.key,{...d,rows:[]});groupMap.get(d.key).rows.push(row);}
 const groups=[...groupMap.values()].sort((a,b)=>a.label.localeCompare(b.label));
 const kind=metadata.observation_kind||"Original observations";
 container.innerHTML='<section class="observed-series"><h3>Dated source review</h3><p class="note">'+esc(metadata.interpretation||kind)+'</p>'+
 '<div class="filters"><label>Parameter / unit / source group<select data-series="group">'+groups.map((g,i)=>'<option value="'+i+'">'+esc(g.label)+'</option>').join("")+'</select></label>'+
 '<label>Station / reporting feature<select data-series="station"></select></label><label>From<input data-series="from" type="date"></label><label>Through<input data-series="to" type="date"></label></div>'+
 '<div data-series="plot"></div><div class="page-actions"><button type="button" data-series="csv">Download selected original rows</button><button type="button" data-series="svg">Download dated plot</button></div></section>';
 const get=name=>container.querySelector('[data-series="'+name+'"]');
 let selected=[],svg="",lastGroup=null;
 function render(){
   const group=groups[Number(get("group").value)];if(!group){get("plot").textContent="This edition contains no source rows.";return;}
   if(lastGroup!==group.key){
     const stations=[...new Set(group.rows.map(r=>r.station_id||r.catchment_id||"Unassigned source"))].sort();
     get("station").innerHTML=stations.map(s=>'<option>'+esc(s)+'</option>').join("");
     get("from").value="";get("to").value="";lastGroup=group.key;
   }
   const station=get("station").value,from=get("from").value,to=get("to").value;
   selected=group.rows.filter(r=>(r.station_id||r.catchment_id||"Unassigned source")===station
       &&(!from||r.period_start>=from)&&(!to||r.period_start<=to));
   const points=selected.map(r=>point(r,metadata,group.unit)).filter(Boolean).sort((a,b)=>a.time-b.time);
   const missing=selected.length-points.length;
   if(!points.length){svg="";get("plot").innerHTML='<p class="note">'+selected.length+' source rows in this selection; no dated numeric value or stated numeric bound is available. Original values, qualifiers and limits remain in the source table and download.</p>';return;}
   let lo=Math.min(...points.map(p=>p.value)),hi=Math.max(...points.map(p=>p.value));
   const span=hi-lo||Math.max(1,Math.abs(lo)*.1);lo-=span*.08;hi+=span*.08;
   let first=points[0].time,last=points.at(-1).time;if(first===last){first-=43200000;last+=43200000;}
   const left=90,top=24,width=690,height=300,x=t=>left+(t-first)/(last-first)*width,y=v=>top+height-(v-lo)/(hi-lo)*height;
   const ticks=Array.from({length:5},(_,i)=>lo+(hi-lo)*i/4);
   const grid=ticks.map(v=>'<line x1="'+left+'" y1="'+y(v)+'" x2="'+(left+width)+'" y2="'+y(v)+'" stroke="#dedede"/><text x="'+(left-9)+'" y="'+(y(v)+4)+'" text-anchor="end">'+esc(shortNumber(v))+'</text>').join("");
   const labels=Array.from({length:5},(_,i)=>first+(last-first)*i/4).map(t=>'<text x="'+x(t)+'" y="'+(top+height+24)+'" text-anchor="middle">'+new Date(t).toISOString().slice(0,10)+'</text>').join("");
   let trace="";
   if(metadata.time_support==="daily_mean"){
     let prev=null;
     for(const p of points){
       if(p.kind!=="reported"){prev=null;continue;}
       if(prev&&p.time-prev.time===86400000)trace+='<line x1="'+x(prev.time)+'" y1="'+y(prev.value)+'" x2="'+x(p.time)+'" y2="'+y(p.value)+'" stroke="#777" stroke-width="1"/>';
       prev=p;
     }
   }
   const marks=points.map(p=>{
     const px=x(p.time),py=y(p.value),r=p.row;
     const fields=[r.station_id||r.catchment_id,r.period_start,sourceValue(r,"sample_time"),sourceValue(r,"sample_timezone"),
       r.parameter, p.kind==="reported"?"reported "+r.value_text:p.kind==="qualified"?"qualified reported value "+p.value:"original "+p.kind+" bound "+p.value,group.unit,
       sourceValue(r,"detection_condition"),r.qualifier,r.id].filter(Boolean).join("; ");
     const title="<title>"+esc(fields)+"</title>";
     if(p.kind==="below"||p.kind==="above"){
       const d=p.kind==="below"?1:-1;return '<path d="M '+(px-4)+' '+(py-d*3)+' L '+(px+4)+' '+(py-d*3)+' L '+px+' '+(py+d*4)+' Z" fill="white" stroke="#111" tabindex="0">'+title+'</path>';
     }
     return '<circle cx="'+px+'" cy="'+py+'" r="'+(metadata.time_support==="daily_mean"?1.8:3.5)+'" fill="'+(p.kind==="qualified"?"white":"#222")+'" stroke="#222" stroke-width=".8" tabindex="0">'+title+'</circle>';
   }).join("");
   const title=group.label+" — "+station;
   svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 830 400" role="img" aria-label="'+esc(title)+'"><title>'+esc(title)+'</title><rect width="830" height="400" fill="white"/><g font-family="Arial,sans-serif" font-size="11" fill="#222">'+grid+labels+trace+marks+'<text x="'+(left+width/2)+'" y="382" text-anchor="middle">Original source date</text><text transform="translate(19 175) rotate(-90)" text-anchor="middle">'+esc(group.unit)+'</text></g></svg>';
   const limits=points.filter(p=>p.kind==="below"||p.kind==="above").length;
   get("plot").innerHTML='<figure class="observation-plot">'+svg+'<figcaption>'+selected.length+' retained source rows; '+points.length+' numeric values or stated bounds; '+limits+' censored bounds shown as open triangles; '+missing+' rows without a plottable date/value. Dates, units and original qualifiers remain unchanged. '+(metadata.time_support==="daily_mean"?"Daily means connect only across consecutive original dates.":"Source values are shown at the original sample date or interval start.")+'</figcaption></figure>';
 }
 for(const name of ["group","station","from","to"])get(name).addEventListener("change",render);
 get("csv").addEventListener("click",()=>download(originalCsv(selected),"text/csv;charset=utf-8","observed-source-selection.csv"));
 get("svg").addEventListener("click",()=>{if(svg)download(svg,"image/svg+xml;charset=utf-8","observed-source-series.svg");});
 render();
}

export function observedValueMarkup(row,metadata={}){
 const raw=row.original||{},parts=[];
 const condition=raw.detection_condition||"";
 const detail=!String(row.value_text||"").trim()||String(raw.quantitation_class||"").startsWith("censored_")||/^[<>]/.test(row.qualifier||"");
 if(detail){
   if(condition)parts.push(condition);
   const limit=raw[metadata.limit_column||"detection_limit"]??raw.detection_limit;
   if(limit!==undefined&&String(limit).trim()!=="")parts.push([raw.detection_limit_type||"Original stated limit",String(limit),raw[metadata.limit_unit_column||"detection_limit_unit"]||""].filter(Boolean).join(" "));
 }
 return esc(row.value_text)+" "+esc(row.unit)+(parts.length?"<small>"+esc(parts.join("; "))+"</small>":"");
}
