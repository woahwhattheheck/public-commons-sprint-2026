// Original observation review. This module never changes the retained record or admits a model quantity.
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const finite=value=>value!==null&&value!==undefined&&String(value).trim()!==""&&Number.isFinite(Number(value))?Number(value):null;
const stable=value=>JSON.stringify(normal(value));
function normal(value){if(Array.isArray(value))return value.map(normal);if(value&&typeof value==="object")return Object.fromEntries(Object.keys(value).sort().map(k=>[k,normal(value[k])]));return value??null;}
const text=value=>value&&typeof value==="object"?stable(value):String(value??"");
function object(value){if(value&&typeof value==="object"&&!Array.isArray(value))return value;try{const result=JSON.parse(value);return result&&typeof result==="object"&&!Array.isArray(result)?result:{};}catch{return {};}}
const day=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value||""))return NaN;const d=Date.parse(value+"T12:00:00Z");return Number.isFinite(d)&&new Date(d).toISOString().slice(0,10)===value?d:NaN;};
const shortNumber=value=>Math.abs(value)>=1e6||Math.abs(value)>0&&Math.abs(value)<.001?value.toExponential(3):Number(value.toPrecision(5)).toString();
function original(row,key){return row.original?.[key]??"";}
function field(row,metadata,key){const column=metadata.columns?.[key];return (column&&row.original?.[column]!==undefined)?row.original[column]:(row[key]??original(row,key));}
const CONTEXT=["species","fraction","method","method_authority","depth","depth_unit","value_type","weight_basis","time_basis","temperature_basis","particle_size_basis","measurement_support","quantity_basis"];
function dimensions(row,metadata){
 const quantity=object(field(row,metadata,"source_quantity")),canonical=object(original(row,"canonical_row_json"));
 const context=Object.fromEntries(CONTEXT.map(k=>[k,field(row,metadata,k)]).filter(([,v])=>v!==""&&v!==null&&v!==undefined));
 // Source capture keeps sampling-depth values/references separately from a measured depth characteristic.
 if(!context.depth){const depth=Object.fromEntries(["resultDepth","resultDepthUnit","resultDepthReference","activityDepth","activityDepthUnit","activityDepthReference","relativeDepth"].filter(k=>canonical[k]!==undefined&&canonical[k]!==null&&canonical[k]!=="").map(k=>[k,canonical[k]]));if(Object.keys(depth).length)context.depth=depth;}
 if(typeof context.depth==="string"){const parsed=object(context.depth);if(Object.keys(parsed).length)context.depth=parsed;}
 for(const key of ["basis","speciation","chemical_basis","unitKind","methodName","solidsBasis"])if(quantity[key]!==undefined&&quantity[key]!==null&&quantity[key]!=="")context[key]=quantity[key];
 const interpretation=object(quantity.characteristicInterpretation||canonical.characteristicInterpretation);
 for(const key of ["chemicalBasis","solidsBasis","unitKind","microbialCountMethod","turbidityScale","conductivityTemperatureCorrection"])if(interpretation[key]!==undefined&&interpretation[key]!==null&&interpretation[key]!=="")context["interpretation:"+key]=interpretation[key];
 for(const key of metadata.series_dimensions||[])context["source:"+key]=original(row,key);
 const unit=text(row.unit||original(row,metadata.limit_unit_column||"detection_limit_unit"));
 const labels=Object.entries(context).filter(([key])=>!["quantity_basis","measurement_support"].includes(key)).map(([key,value])=>key.replaceAll("_"," ")+": "+text(value));
 return {unit,context,key:stable([row.parameter,unit,context]),label:[row.parameter,unit,...labels].filter(Boolean).join(" · ")};
}
function point(row,metadata,unit){
 const qualifier=String(row.qualifier||"").trim(),condition=String(original(row,metadata.quantitation_column||"quantitation_class"));
 if(qualifier==="context-only"||String(original(row,"source_disposition")).trim())return {reason:"Original review or source condition remains context-only"};
 let value=finite(row.value),kind=qualifier?"qualified":"reported";
 const above=original(row,"detection_condition")==="Present Above Quantification Limit"&&original(row,"detection_limit_type")==="Upper Quantitation Limit";
 const left=condition==="censored_below"||/^<=?$/.test(qualifier),right=above||condition==="censored_above"||/^>=?$/.test(qualifier);
 if(left&&right)return {reason:"Conflicting censor directions retained"};
 if(left||right){
   const bound=finite(original(row,metadata.limit_column||"numeric_detection_limit"));
   const boundUnit=original(row,metadata.limit_unit_column||"detection_limit_unit");
   if(!(/^[<>]=?$/.test(qualifier)&&value!==null)){
     if(bound===null)return {reason:"No resolved numeric bound"};
     if(boundUnit&&boundUnit!==unit)return {reason:"Bound unit differs from selected source unit"};
     value=bound;
   }
   kind=right?"above":"below";
 }else if(condition==="no_numeric_result")return {reason:"Original source has no numeric result"};
 else if(condition==="reported_with_condition")kind="qualified";
 else if(qualifier&&!((metadata.accepted_qualifiers||[]).includes(qualifier)))return {reason:"Original qualifier is not declared as a numeric result"};
 const time=day(row.period_start);
 if(value===null)return {reason:"No finite numeric value or bound"};
 if(!Number.isFinite(time))return {reason:"No valid original calendar date"};
 return {row,time,value,kind};
}
export function observedReviewCatalogue(edition){
 const metadata=edition.metadata||{},groups=new Map();
 for(const row of edition.rows||[]){const d=dimensions(row,metadata);if(!groups.has(d.key))groups.set(d.key,{...d,rows:[]});groups.get(d.key).rows.push(row);}
 return [...groups.values()].sort((a,b)=>a.label<b.label?-1:a.label>b.label?1:0);
}
export function prepareObservedReview(edition,selection={}){
 if(!edition||!Array.isArray(edition.rows))throw Error("Select a retained observation with its complete original rows.");
 const metadata=edition.metadata||{},groups=observedReviewCatalogue(edition),group=groups.find(g=>g.key===selection.group_key)||(!selection.group_key?groups[0]:null);
 if(selection.group_key&&!group)throw Error("The selected original series is absent from this observation.");
 for(const key of ["from","to"])if(selection[key]&&!Number.isFinite(day(selection[key])))throw Error("Use an original calendar date for "+key+".");
 if(selection.from&&selection.to&&selection.from>selection.to)throw Error("The start date must precede or equal the end date.");
 const stationOf=row=>text(row.station_id||row.catchment_id||"Unassigned source");
 const stations=group?[...new Set(group.rows.map(stationOf))].sort():[],station=selection.station??stations[0]??"";
 if(group&&!stations.includes(station))throw Error("The selected station is absent from this original series.");
 const search=String(selection.search||"").trim().toLowerCase();
 const rows=(group?.rows||[]).filter(row=>stationOf(row)===station&&(!selection.from||row.period_start>=selection.from)&&(!selection.to||row.period_start<=selection.to)&&(!search||JSON.stringify(row).toLowerCase().includes(search)));
 const plotted=[],unplotted=[];for(const row of rows){const result=point(row,metadata,group.unit);if(result.row)plotted.push(result);else unplotted.push({record_id:row.id,reason:result.reason});}
 plotted.sort((a,b)=>a.time-b.time);
 const counts={selected:rows.length,plotted:plotted.length,reported:plotted.filter(p=>p.kind==="reported").length,qualified:plotted.filter(p=>p.kind==="qualified").length,below:plotted.filter(p=>p.kind==="below").length,above:plotted.filter(p=>p.kind==="above").length,unplotted:unplotted.length,total_original:edition.rows.length};
 return {schema:"upstate.observed-source-review/v1",observation_id:edition.id??null,source:{metadata,original:edition.original??null,columns:edition.columns??[]},selection:{group_key:group?.key??"",station,from:selection.from||"",to:selection.to||"",search:selection.search||""},series:group?{label:group.label,unit:group.unit,context:group.context}:null,counts,rows,unplotted,points:plotted,stations};
}
export function observedOriginalCsv(rows,columns=[]){
 const fields=[...new Set([...columns,...rows.flatMap(r=>Object.keys(r.original||{}))])];
 const cell=value=>'"'+text(value).replaceAll('"','""')+'"';
 return [fields.map(cell).join(","),...rows.map(row=>fields.map(k=>cell(row.original?.[k])).join(","))].join("\r\n")+"\r\n";
}
export function observedReviewJson(review){return JSON.stringify({...review,points:undefined,stations:undefined},null,2)+"\n";}
export function observedReviewSvg(review){
 const points=review.points;if(!points.length)return "";
 let lo=Infinity,hi=-Infinity;for(const p of points){lo=Math.min(lo,p.value);hi=Math.max(hi,p.value);}
 const span=hi-lo||Math.max(1,Math.abs(lo)*.1);lo-=span*.08;hi+=span*.08;
 let first=points[0].time,last=points.at(-1).time;if(first===last){first-=43200000;last+=43200000;}
 const left=90,top=24,width=690,height=300,x=t=>left+(t-first)/(last-first)*width,y=v=>top+height-(v-lo)/(hi-lo)*height;
 const grid=Array.from({length:5},(_,i)=>lo+(hi-lo)*i/4).map(v=>'<line x1="'+left+'" y1="'+y(v)+'" x2="'+(left+width)+'" y2="'+y(v)+'" stroke="#dedede"/><text x="'+(left-9)+'" y="'+(y(v)+4)+'" text-anchor="end">'+esc(shortNumber(v))+'</text>').join("");
 const labels=Array.from({length:5},(_,i)=>first+(last-first)*i/4).map(t=>'<text x="'+x(t)+'" y="'+(top+height+24)+'" text-anchor="middle">'+new Date(t).toISOString().slice(0,10)+'</text>').join("");
 let trace="";
 if(review.source.metadata.time_support==="daily_mean"){
   const perDay=new Map();for(const p of points)perDay.set(p.time,(perDay.get(p.time)||0)+1);
   let previous=null;for(const p of points){if(p.kind!=="reported"||perDay.get(p.time)!==1){previous=null;continue;}if(previous&&p.time-previous.time===86400000)trace+='<line x1="'+x(previous.time)+'" y1="'+y(previous.value)+'" x2="'+x(p.time)+'" y2="'+y(p.value)+'" stroke="#777" stroke-width="1"/>';previous=p;}
 }
 const marks=points.map(p=>{
   const px=x(p.time),py=y(p.value),r=p.row,clock=field(r,review.source.metadata,"time")||original(r,"sample_time"),zone=field(r,review.source.metadata,"timezone")||original(r,"sample_timezone");
   const title="<title>"+esc([r.id,r.station_id||r.catchment_id,r.period_start,clock,zone,r.parameter,p.kind+" "+p.value,review.series.unit,r.qualifier].filter(Boolean).join("; "))+"</title>";
   if(p.kind==="below"||p.kind==="above"){const d=p.kind==="below"?1:-1;return '<path d="M '+(px-4)+' '+(py-d*3)+' L '+(px+4)+' '+(py-d*3)+' L '+px+' '+(py+d*4)+' Z" fill="white" stroke="#111" tabindex="0">'+title+'</path>';}
   return '<circle cx="'+px+'" cy="'+py+'" r="'+(review.source.metadata.time_support==="daily_mean"?1.8:3.5)+'" fill="'+(p.kind==="qualified"?"white":"#222")+'" stroke="#222" stroke-width=".8" tabindex="0">'+title+'</circle>';
 }).join("");
 return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 830 400" role="img" aria-label="'+esc(review.series.label+" — "+review.selection.station)+'"><title>'+esc(review.series.label+" — "+review.selection.station)+'</title><rect width="830" height="400" fill="white"/><g font-family="Arial,sans-serif" font-size="11" fill="#222">'+grid+labels+trace+marks+'<text x="'+(left+width/2)+'" y="382" text-anchor="middle">Original source date</text><text transform="translate(19 175) rotate(-90)" text-anchor="middle">'+esc(review.series.unit)+'</text></g></svg>';
}
function countsText(review){const c=review.counts;return c.selected+" selected original rows; "+c.reported+" reported points; "+c.qualified+" qualified points; "+c.below+" upper bounds; "+c.above+" lower bounds; "+c.unplotted+" unplotted context rows. Bounds are open triangles and remain bounds, never substituted point estimates. No units are converted and no annual load or trend is inferred.";}
function rowTable(review,rows){
 const excluded=new Map(review.unplotted.map(x=>[x.record_id,x.reason]));
 return '<div style="overflow:auto;max-width:100%"><table style="border-collapse:collapse;width:100%;min-width:720px"><thead><tr>'+["Record / station","Original date / time","Retained value or bound / unit","Qualifier / plotting","Method / source context","Full original record"].map(h=>'<th scope="col">'+esc(h)+'</th>').join("")+'</tr></thead><tbody>'+rows.map(row=>{
   const clock=field(row,review.source.metadata,"time")||original(row,"sample_time"),zone=field(row,review.source.metadata,"timezone")||original(row,"sample_timezone");
   return '<tr><td>'+esc(row.id)+'<br><small>'+esc(row.station_id||row.catchment_id)+'</small></td><td>'+esc(row.period_start)+'<br><small>'+esc([clock,zone].filter(Boolean).join(" "))+'</small></td><td>'+observedValueMarkup(row,review.source.metadata)+'</td><td>'+esc(row.qualifier||"Unqualified")+'<br><small>'+esc(excluded.get(row.id)||"Dated value or stated bound")+'</small></td><td>'+esc(text(row.method))+'<br><small>'+esc(original(row,"source_disposition"))+'</small></td><td><details><summary>Show source fields</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(JSON.stringify(row,null,2))+'</pre></details></td></tr>';
 }).join("")+'</tbody></table></div>';
}
export function renderObservedReview(review){
 const csv=observedOriginalCsv(review.rows,review.source.columns),json=observedReviewJson(review),svg=observedReviewSvg(review);
 const link=(body,type,name,label)=>'<a download="'+name+'" href="data:'+type+';charset=utf-8,'+esc(encodeURIComponent(body))+'">'+label+'</a>';
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Original observation review</title><style>body{margin:0;color:#202020;background:#f7f7f7;font:16px/1.5 Arial,sans-serif}main{max-width:1120px;margin:auto;padding:24px}h1{font-size:28px}p,dd,pre{overflow-wrap:anywhere}dl{display:grid;grid-template-columns:minmax(100px,1fr) 3fr;gap:8px}dd{margin:0}nav{display:flex;flex-wrap:wrap;gap:16px;margin:20px 0}table{background:white}th,td{padding:10px;text-align:left;border-bottom:1px solid #ddd;vertical-align:top}th{background:#eee}small{font-size:13px}svg{width:100%;height:auto}details{max-width:640px}pre{white-space:pre-wrap;font-size:12px}@media(max-width:500px){main{padding:14px}dl{display:block}dt{font-weight:bold}dd{margin-bottom:10px}}@media print{details>pre{display:block}nav{display:none}body{background:white}}</style><main><h1>Original observation review</h1><p>'+esc(review.series?.label||"Empty source selection")+'</p><dl><dt>Observation</dt><dd>'+esc(review.observation_id||"Unspecified")+'</dd><dt>Station</dt><dd>'+esc(review.selection.station)+'</dd><dt>Selected dates</dt><dd>'+esc((review.selection.from||"Original beginning")+" through "+(review.selection.to||"Original end"))+'</dd><dt>Source search</dt><dd>'+esc(review.selection.search||"None")+'</dd></dl><p>'+esc(countsText(review))+'</p><p>Points are placed at the original sample date or interval start. Clock and timezone values are preserved in the source table; this display does not infer or align instants. Daily means connect only across consecutive dates with one unqualified source value on each date.</p><nav>'+link(csv,"text/csv","observed-source-selection.csv","Download original selected CSV")+link(json,"application/json","observed-source-selection.json","Download complete selected JSON")+(svg?link(svg,"image/svg+xml","observed-source-series.svg","Download dated plot"):"")+'</nav>'+(svg||"<p>No selected row has a plottable original date and numeric point or bound.</p>")+'<h2>All '+review.rows.length+' selected source rows</h2>'+rowTable(review,review.rows)+'<details><summary>Exact scientific context and source identity</summary><pre>'+esc(JSON.stringify({selection:review.selection,series:review.series,source:review.source},null,2))+'</pre></details><p>The selected JSON retains every selected native row, original fields, source descriptors, metadata and selection. This is a source review, not a new observation or an analysis.</p></main></html>';
}
function download(body,type,name){const url=URL.createObjectURL(new Blob([body],{type})),link=document.createElement("a");link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function mountObservedSeries(container,edition){
 if(!container)return;
 const groups=observedReviewCatalogue(edition),metadata=edition.metadata||{};
 container.innerHTML='<style>.observed-series{min-width:0}.observed-series .filters{display:flex;flex-wrap:wrap;gap:12px}.observed-series .filters label{flex:1 1 180px;min-width:0}.observed-series select,.observed-series input{max-width:100%;width:100%;box-sizing:border-box}.observed-series td,.observed-series th{padding:9px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}.observed-series .page-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:12px 0}.observed-series svg{max-width:100%;height:auto}</style><section class="observed-series"><h3>Dated source review</h3><p class="note">Select one original parameter, unit and sampling context. Method, fraction, sampling depth and scientific basis remain separate.</p><div class="filters"><label>Parameter / unit / source context<select data-series="group">'+groups.map((g,i)=>'<option value="'+i+'">'+esc(g.label)+'</option>').join("")+'</select></label><label>Station / reporting feature<select data-series="station"></select></label><label>From<input data-series="from" type="date"></label><label>Through<input data-series="to" type="date"></label><label>Find in selected original rows<input data-series="search" type="search" placeholder="Record, activity, qualifier or source field"></label></div><div data-series="notice" role="status" aria-live="polite"></div><div data-series="context"></div><div data-series="plot"></div><div class="page-actions"><button type="button" data-series="report">Download complete selected report</button><button type="button" data-series="csv">Download selected original CSV</button><button type="button" data-series="json">Download selected JSON</button><button type="button" data-series="svg">Download dated plot</button><button type="button" data-series="source">Download complete original observation</button></div><h4>Selected original source rows</h4><div data-series="rows"></div><div class="page-actions"><button type="button" data-series="previous">Previous rows</button><span data-series="page" aria-live="polite"></span><button type="button" data-series="next">Next rows</button></div></section>';
 const get=name=>container.querySelector('[data-series="'+name+'"]');let review=null,lastGroup=null,page=0;const pageSize=40;
 function renderRows(){const rows=review?.rows||[],pages=Math.max(1,Math.ceil(rows.length/pageSize));page=Math.max(0,Math.min(page,pages-1));get("rows").innerHTML=review?rowTable(review,rows.slice(page*pageSize,(page+1)*pageSize)):"";get("page").textContent=rows.length?("Rows "+(page*pageSize+1)+"–"+Math.min((page+1)*pageSize,rows.length)+" of "+rows.length):"No selected rows";get("previous").disabled=page===0;get("next").disabled=page+1>=pages;}
 function render(){
   try{
     const group=groups[Number(get("group").value)];
     if(group?.key!==lastGroup){const stations=group?[...new Set(group.rows.map(r=>text(r.station_id||r.catchment_id||"Unassigned source")))].sort():[];get("station").innerHTML=stations.map(s=>'<option>'+esc(s)+'</option>').join("");get("from").value="";get("to").value="";get("search").value="";lastGroup=group?.key;}
     review=prepareObservedReview(edition,{group_key:group?.key||"",station:get("station").value,from:get("from").value,to:get("to").value,search:get("search").value});page=0;
     get("notice").textContent=countsText(review);
     get("context").innerHTML=review.series?'<details><summary>Original sampling context</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(JSON.stringify(review.series.context,null,2))+'</pre></details>':"";
     const svg=observedReviewSvg(review);get("plot").innerHTML=svg?'<figure class="observation-plot">'+svg+'<figcaption>Open triangles show the original bound. Dates are original sample dates or interval starts; clocks and timezones remain in the selected rows.</figcaption></figure>':'<p class="note">No selected row has a plottable original date and numeric point or bound.</p>';
     for(const key of ["report","csv","json"])get(key).disabled=!review.rows.length;get("svg").disabled=!svg;renderRows();
   }catch(error){review=null;get("notice").textContent=error.message;get("plot").innerHTML="";get("context").innerHTML="";for(const key of ["report","csv","json","svg"])get(key).disabled=true;renderRows();}
 }
 for(const name of ["group","station","from","to","search"])get(name).addEventListener(name==="search"?"input":"change",render);
 get("previous").addEventListener("click",()=>{page--;renderRows();});get("next").addEventListener("click",()=>{page++;renderRows();});
 get("csv").addEventListener("click",()=>{if(review)download(observedOriginalCsv(review.rows,review.source.columns),"text/csv;charset=utf-8","observed-source-selection.csv");});
 get("json").addEventListener("click",()=>{if(review)download(observedReviewJson(review),"application/json;charset=utf-8","observed-source-selection.json");});
 get("report").addEventListener("click",()=>{if(review)download(renderObservedReview(review),"text/html;charset=utf-8","observed-source-review.html");});
 get("svg").addEventListener("click",()=>{if(review){const svg=observedReviewSvg(review);if(svg)download(svg,"image/svg+xml;charset=utf-8","observed-source-series.svg");}});
 get("source").addEventListener("click",()=>{const source={...edition};delete source._downloads;download(JSON.stringify(source,null,2)+"\n","application/json;charset=utf-8","original-observation-"+(edition.id||"source")+".json");});
 render();
}
export function observedValueMarkup(row,metadata={}){
 const raw=row.original||{},parts=[],condition=raw.detection_condition||"";
 if(!String(row.value_text??"").trim()||String(raw.quantitation_class||"").startsWith("censored_")||/^[<>]/.test(row.qualifier||"")){
   if(condition)parts.push(condition);
   const limit=raw[metadata.limit_column||"detection_limit"]??raw.detection_limit??raw.reporting_limit;
   if(limit!==undefined&&String(limit).trim()!=="")parts.push([raw.detection_limit_type||"Original stated limit",String(limit),raw[metadata.limit_unit_column||"detection_limit_unit"]||raw.reporting_limit_unit||""].filter(Boolean).join(" "));
 }
 return esc(row.value_text??row.value??"")+" "+esc(row.unit)+(parts.length?"<small>"+esc(parts.join("; "))+"</small>":"");
}
