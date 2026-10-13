const defaultTraceSelection = {station:"all",analyte:"all",status:"all",month:"all",search:"",plot:"Iron"};
const traceShort = value => String(value).replace(/^21SC60WQ_WQX-/,"");
const traceEscape = value => String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const traceEventKey = row => JSON.stringify([row.organization_id,row.station_id,row.project_id,row.activity_id]);
function normalizeTraceSelection(study, supplied={}) {
  if(!supplied||typeof supplied!=="object"||Array.isArray(supplied))throw Error("Choose an original trace-metal selection.");
  const s={...defaultTraceSelection,...supplied};
  if(Object.keys(s).some(k=>!Object.hasOwn(defaultTraceSelection,k)))throw Error("Unknown selection field.");
  if(!["all",...study.stations.map(x=>x.id)].includes(s.station)||!["all",...study.metals].includes(s.analyte)||!["all","reported","below"].includes(s.status)||!["all",...study.period.sampled_months].includes(s.month)||!study.metals.includes(s.plot)||typeof s.search!=="string"||s.search.length>300)throw Error("The selection differs from this original study.");
  return s;
}
function selectedTraceRows(study,supplied) {
  const s=normalizeTraceSelection(study,supplied), q=s.search.trim().toLowerCase();
  return study.records.filter(r=>(s.station==="all"||r.station_id===s.station)&&(s.analyte==="all"||r.characteristic===s.analyte)&&(s.status==="all"||r.interpretation.kind===s.status)&&(s.month==="all"||r.sample_date.slice(0,7)===s.month)&&(!q||[r.station_id,r.activity_id,r.sample_date,r.characteristic,r.analytical_method_name,r.analytical_method_id,r.activity_comment,r.result_comment,r.laboratory_comment,r.record_id].some(x=>String(x).toLowerCase().includes(q))));
}
function traceCsv(rows,columns) {
 const cell=value=>{const s=value===null||value===undefined?"":typeof value==="object"?JSON.stringify(value):String(value);return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
 return columns.map(cell).join(",")+"\n"+rows.map(row=>columns.map(k=>cell(row[k])).join(",")).join("\n")+(rows.length?"\n":"");
}
function traceSelectionLabel(s) {return "Station: "+traceShort(s.station)+"; metal: "+s.analyte+"; result: "+s.status+"; month: "+s.month+"; search: "+(s.search||"none")+"; chart: "+s.plot+".";}
function traceFigure(study,metal,rows) {
  rows=rows.filter(r=>r.characteristic===metal);
  const start=Date.UTC(2023,0,1)/86400000,end=Date.UTC(2024,0,1)/86400000;
  const maximum=Math.max(0,...rows.map(r=>r.interpretation.kind==="reported"?r.interpretation.value:r.interpretation.limit));
  const top=maximum>0?maximum*1.15:1, ticks=Array.from({length:5},(_,i)=>({value:top*i/4,label:Number((top*i/4).toPrecision(4)).toString()}));
  const point=r=>({x:Date.parse(r.sample_date+"T00:00:00Z")/86400000,y:r.interpretation.kind==="reported"?r.interpretation.value:r.interpretation.limit,censored:r.interpretation.kind==="below",record_id:r.record_id,station_id:r.station_id,activity_id:r.activity_id,original_value:r.reported_value,original_limit:r.detection_limit,condition:r.detection_condition});
  const series=[{label:"Reported result",geometry:"scatter",marker:"circle",points:rows.filter(r=>r.interpretation.kind==="reported").map(point)},{label:"Below limit (open)",geometry:"scatter",marker:"circle-open",points:rows.filter(r=>r.interpretation.kind==="below").map(point)}];
  return {id:"trace-"+metal.toLowerCase(),title:metal+" — selected original samples",caption:"Unfiltered water; mg/L. Filled circles are reported values. Open circles mark original lower quantification limits for blank-valued results. Sampling dates are distinct original activities; no connecting trend is estimated. "+rows.length+" original results.",panels:[{kind:"cartesian",title:metal,x:{label:"Original sample date (2023)",unit:"days since 1970-01-01 UTC",domain:[start,end],ticks:[0,2,4,6,8,10].map(month=>({value:Date.UTC(2023,month,1)/86400000,label:["Jan","Mar","May","Jul","Sep","Nov"][month/2]}))},y:{label:"Result or lower quantification limit",unit:"mg/L",domain:[0,top],ticks},series}]};
}
function renderTraceSvg(figure,{interactive=false}={}) {
 const p=figure.panels[0],w=1000,h=350,left=90,right=35,top=45,bottom=65,x0=p.x.domain[0],x1=p.x.domain[1],y0=p.y.domain[0],y1=p.y.domain[1],X=x=>left+(x-x0)/(x1-x0)*(w-left-right),Y=y=>h-bottom-(y-y0)/(y1-y0)*(h-top-bottom);
 let out='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+w+' '+h+'" role="img" aria-labelledby="plot-title plot-description"><title id="plot-title">'+traceEscape(figure.title)+'</title><desc id="plot-description">'+traceEscape(figure.caption)+'</desc><rect width="1000" height="350" fill="white"/><g font-family="Arial,sans-serif" fill="#202020">';
 out+='<text x="'+left+'" y="22" font-size="17" font-weight="bold">'+traceEscape(p.title)+'</text><text x="965" y="22" text-anchor="end" font-size="12">mg/L · original values and limits</text>';
 for(const t of p.y.ticks)out+='<path d="M'+left+' '+Y(t.value)+'H'+(w-right)+'" stroke="#d9d9d9"/><text x="'+(left-12)+'" y="'+(Y(t.value)+4)+'" text-anchor="end" font-size="12">'+traceEscape(t.label)+'</text>';
 for(const t of p.x.ticks)out+='<path d="M'+X(t.value)+' '+(h-bottom)+'v5" stroke="#222"/><text x="'+X(t.value)+'" y="'+(h-bottom+23)+'" text-anchor="middle" font-size="12">'+traceEscape(t.label)+'</text>';
 out+='<path d="M'+left+' '+top+'V'+(h-bottom)+'H'+(w-right)+'" fill="none" stroke="#222"/>';
 for(const s of p.series)for(const r of s.points){const label=traceShort(r.station_id)+", "+new Date(r.x*86400000).toISOString().slice(0,10)+", "+(r.censored?"below "+r.original_limit:r.original_value)+" mg/L; "+traceShort(r.activity_id);out+='<g'+(interactive?' tabindex="0" role="button" data-record="'+traceEscape(r.record_id)+'" aria-label="'+traceEscape("Inspect "+label)+'"':'')+'><circle cx="'+X(r.x)+'" cy="'+Y(r.y)+'" r="'+(interactive?10:4.7)+'" fill="'+(r.censored?"white":"#222")+'" stroke="#222" stroke-width="1.5"><title>'+traceEscape(label)+'</title></circle></g>';}
 out+='<circle cx="90" cy="330" r="4" fill="#222"/><text x="103" y="334" font-size="12">Reported</text><circle cx="205" cy="330" r="4" fill="white" stroke="#222"/><text x="218" y="334" font-size="12">Below limit · bound, blank reported value</text></g></svg>';
 return out;
}
function prepareTraceReport(study,supplied,sourceFiles,digest,columns,{html=null}={}) {
  const selection=normalizeTraceSelection(study,supplied),rows=selectedTraceRows(study,selection);
  if(!rows.length)throw Error("Choose at least one original result before exporting a scientific source.");
  const keys=new Set(rows.map(traceEventKey)),context=study.context.filter(r=>keys.has(traceEventKey(r))),activities=study.activities.filter(a=>keys.has(a.id));
  const inputIdentity=digest(JSON.stringify(study.input)),identity={schema:"upstate.trace-metal-selection/v1",edition:study.edition,input_sha256:inputIdentity,selection,record_ids:rows.map(r=>r.record_id)};
  const id=digest(JSON.stringify(identity)),files={...sourceFiles};
  const original=rows.map(({interpretation,...r})=>r);
  files["selected-records.csv"]=traceCsv(original,columns);
  files["same-activity-context.csv"]=traceCsv(context,columns);
  files["selected-activities.csv"]=traceCsv(activities,["station_id","activity_id","project_id","date","time","timezone","records","context"]);
  files["selection.json"]=JSON.stringify({...identity,id},null,2)+"\n";
  const summaries=study.metals.map(metal=>{const rs=rows.filter(r=>r.characteristic===metal),numeric=rs.filter(r=>r.interpretation.kind==="reported").map(r=>r.interpretation.value);return {metal,results:rs.length,reported:numeric.length,below:rs.length-numeric.length,reported_min:numeric.length?Math.min(...numeric):null,reported_max:numeric.length?Math.max(...numeric):null,unit:"mg/L",fraction:"Unfiltered",methods:[...new Set(rs.map(r=>r.analytical_method_context+" "+r.analytical_method_id))].join("; "),original_limits:[...new Set(rs.filter(r=>r.detection_limit!==""&&r.detection_limit!==null&&r.detection_limit!==undefined).map(r=>r.detection_limit+" "+r.detection_limit_unit))].join("; ")};}).filter(x=>x.results);
  files["selected-summary.csv"]=traceCsv(summaries,["metal","results","reported","below","reported_min","reported_max","unit","fraction","methods","original_limits"]);
  if(html!==null)files["report.html"]=html;
  const figureSpec={schema:"upstate.scientific-figure-spec/v1",edition:study.edition,selection_id:id,figures:summaries.map(s=>traceFigure(study,s.metal,rows))};
  files["figure-spec.json"]=JSON.stringify(figureSpec,null,2)+"\n";
  for(const f of figureSpec.figures)files["figures/"+f.id+".svg"]=renderTraceSvg(f);
  const sections=[
    ["Selected original trace-metal observations",["This edition contains "+rows.length+" original results from "+activities.length+" sampling activities at "+new Set(rows.map(r=>r.station_id)).size+" stations. "+traceSelectionLabel(selection),"Every result retains its original station/activity/source-row identity, reported value and unit, quantification limit and unit, analytical method, fraction, collection metadata and source comments.","The quantified ranges use reported values only within each displayed metal/method/unit/fraction group. Below-limit rows retain blank reported-value fields and their original limits. The same-activity chemistry context is presented using its own original basis."]],
    ["Sampling support",[{kind:"table",columns:["Station","Activity","Date","Original time","Timezone"],rows:activities.map(a=>[traceShort(a.station_id),traceShort(a.activity_id),a.date,a.time||"blank",a.timezone||"blank"])}, "Stations were sampled on different schedules. Calendar overlap identifies calendar support and does not equate distinct activities or collection times."]],
    ["Results and original method support",[{kind:"table",columns:["Metal","Reported / total","Below limit","Reported range (mg/L)","Method"],rows:summaries.map(s=>[s.metal,s.reported+" / "+s.results,String(s.below),s.reported?String(s.reported_min)+(s.reported_min!==s.reported_max?" – "+s.reported_max:""):"No quantified result",s.methods])}]],
    ["Original quantification limits",[{kind:"table",columns:["Metal","Retained limits","Fraction"],rows:summaries.map(s=>[s.metal,s.original_limits,s.fraction])}]]
  ];
  for(const metal of study.metals){const rs=rows.filter(r=>r.characteristic===metal);if(!rs.length)continue;sections.push([metal+" — original selected results",[{kind:"table",columns:["Station","Date","Original result / bound","Condition","Activity"],rows:rs.map(r=>[traceShort(r.station_id),r.sample_date,r.interpretation.display,r.detection_condition||"Reported numeric",traceShort(r.activity_id)])}]]);}
  sections.push(["Same-activity original chemistry",["The following observations share each metal activity's exact organization, station, project and activity identity. Original result fraction and units remain visible; no hardness-basis conversion is applied.",{kind:"table",columns:["Station / date","Characteristic","Original value / unit","Fraction","Activity"],rows:context.map(r=>[traceShort(r.station_id)+" / "+r.sample_date,r.characteristic,r.reported_value+" "+r.reported_unit,r.sample_fraction||"blank",traceShort(r.activity_id)])}]]);
  const comments=rows.filter(r=>r.result_comment||r.activity_comment||r.laboratory_comment);
  sections.push(["Original comments and collection methods",[comments.length?{kind:"table",columns:["Record","Result comment","Activity comment","Laboratory comment"],rows:comments.map(r=>[r.record_id,r.result_comment,r.activity_comment,r.laboratory_comment])}:"The selected original metal rows have blank result, activity and laboratory comment fields. Blank original collection method/equipment fields remain blank in the complete selected CSV.","Original analytical method names, method descriptions, detection-limit type, result status and all 73 normalized source/context fields remain in selected-records.csv."]]);
  const descriptor=path=>({path,bytes:new TextEncoder().encode(files[path]).length,sha256:digest(files[path])});
  const inputs=Object.keys(files).filter(p=>p.endsWith(".csv")||p==="selection.json"||p==="inputs.json").sort().map(descriptor);
  const recipe={schema:"upstate.observed-report/v1",title:"Eighteenmile 2023 trace metals — selected original observations",edition:study.edition,selection_id:id,metadata:{report_schema:"upstate.eighteenmile-trace-metals/v1",original_input_sha256:inputIdentity,record_count:rows.length,activity_count:activities.length,selection},inputs,sections,figure_spec:"figure-spec.json",figures:figureSpec.figures.map(f=>({id:f.id,path:"figures/"+f.id+".svg"})),source_links:Object.keys(files).sort()};
  files["report.json"]=JSON.stringify(recipe,null,2)+"\n";
  const entry={id:"eighteenmile-trace-metals-"+id.slice(0,20),title:recipe.title,kind:"document",role:"OBSERVED_CONTEXT",path:"report.json",sha256:digest(files["report.json"]),uri:"urn:upstate:eighteenmile-trace-metals:"+id,vintage:"Original 2023 observations; retained source edition 2026-10-13",companions:Object.keys(files).filter(p=>p!=="report.json").sort().map(path=>({path,sha256:digest(files[path])}))};
  files["sources.json"]=JSON.stringify({schema:"upstate.sources/v1",title:recipe.title,entries:[entry],notes:[traceSelectionLabel(selection),"Source record IDs and original quantification conditions remain unchanged."]},null,2)+"\n";
  files["inventory.json"]=JSON.stringify({schema:"upstate.trace-metal-package/v1",id,input_sha256:inputIdentity,selection,record_count:rows.length,activity_count:activities.length,members:Object.keys(files).sort().map(descriptor)},null,2)+"\n";
  return {id,selection,rows,context,activities,summaries,recipe,files};
}
function traceZip(files) {
 const encoder=new TextEncoder(),names=Object.keys(files).sort(),parts=[],central=[];let offset=0;
 const crc=bytes=>{let n=0xffffffff;for(const b of bytes){n^=b;for(let k=0;k<8;k++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;};
 const header=(size)=>{const bytes=new Uint8Array(size);return{bytes,view:new DataView(bytes.buffer)};};
 for(const name of names){
   if(!name||name.startsWith("/")||name.includes("\\")||name.split("/").some(p=>p===".."||!p))throw Error("ZIP members require original relative names.");
   const n=encoder.encode(name),data=typeof files[name]==="string"?encoder.encode(files[name]):files[name],check=crc(data),a=header(30);
   a.view.setUint32(0,0x04034b50,true);a.view.setUint16(4,20,true);a.view.setUint16(6,2048,true);a.view.setUint16(12,33,true);a.view.setUint32(14,check,true);a.view.setUint32(18,data.length,true);a.view.setUint32(22,data.length,true);a.view.setUint16(26,n.length,true);
   parts.push(a.bytes,n,data);const c=header(46);
   c.view.setUint32(0,0x02014b50,true);c.view.setUint16(4,20,true);c.view.setUint16(6,20,true);c.view.setUint16(8,2048,true);c.view.setUint16(14,33,true);c.view.setUint32(16,check,true);c.view.setUint32(20,data.length,true);c.view.setUint32(24,data.length,true);c.view.setUint16(28,n.length,true);c.view.setUint32(42,offset,true);central.push(c.bytes,n);offset+=30+n.length+data.length;
 }
 const centralSize=central.reduce((n,x)=>n+x.length,0),end=header(22);if(names.length>65535||offset+centralSize>0xffffffff)throw Error("This package exceeds ordinary ZIP limits.");
 end.view.setUint32(0,0x06054b50,true);end.view.setUint16(8,names.length,true);end.view.setUint16(10,names.length,true);end.view.setUint32(12,centralSize,true);end.view.setUint32(16,offset,true);
 const result=new Uint8Array(offset+centralSize+22);let at=0;for(const p of [...parts,...central,end.bytes]){result.set(p,at);at+=p.length;}return result;
}
export {defaultTraceSelection,traceShort,traceEscape,traceEventKey,normalizeTraceSelection,selectedTraceRows,traceCsv,traceSelectionLabel,traceFigure,renderTraceSvg,prepareTraceReport,traceZip};
