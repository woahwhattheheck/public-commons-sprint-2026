(function traceExplorer(){
"use strict";
const payload=JSON.parse(document.getElementById("trace-data").textContent), study=payload.study, bank=payload.source_files, columns=payload.columns;
const initialDocument="<!doctype html>\n"+document.documentElement.outerHTML;
const digest=text=>sha256(utf8(text));
const inputId=digest(JSON.stringify(study.input));
let selection=normalizeTraceSelection(study,payload.selection), rows=[],inspected=null, busy=false, selectionRevision=0, selectionReadToken=0;
const $=id=>document.getElementById(id), E=traceEscape, S=traceShort;
const options=(values,chosen)=>values.map(([value,label])=>'<option value="'+E(value)+'"'+(value===chosen?' selected':'')+'>'+E(label)+'</option>').join("");
function say(message,error=false){$("notice").textContent=message;$("notice").classList.toggle("error",error);}
function saveFile(name,body,type="application/octet-stream"){const blob=new Blob([body],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function csvSelected(){const original=rows.map(({interpretation,...row})=>row);saveFile("trace-metals-selected-originals.csv",traceCsv(original,columns),"text/csv;charset=utf-8");say("Downloaded "+rows.length+" selected original results with all "+columns.length+" fields.");}
function selectionRecord(){return{schema:"upstate.trace-metal-selection/v1",edition:study.edition,input_sha256:inputId,selection:{...selection},record_ids:rows.map(r=>r.record_id)};}
function currentHtml(chosen){const copied={...payload,selection:chosen};const json=JSON.stringify(copied).replace(/</g,"\\u003c");return initialDocument.replace(/(<script id="trace-data" type="application\/json">)[\s\S]*?(<\/script>)/,(_,open,close)=>open+json+close);}
function sourcePackage(chosen){
  const html=currentHtml(chosen);
  return prepareTraceReport(study,chosen,bank,digest,columns,{html});
}
function validSelectionFile(value){
 if(value.schema!=="upstate.trace-metal-selection/v1"||value.edition!==study.edition||value.input_sha256!==inputId)throw Error("This selection belongs to another original source edition.");
 const next=normalizeTraceSelection(study,value.selection),expected=selectedTraceRows(study,next).map(r=>r.record_id);
 if(JSON.stringify(expected)!==JSON.stringify(value.record_ids))throw Error("The selection's original record identities differ.");
 return next;
}
function controlMarkup(){
 $("station").innerHTML=options([["all","All five stations"],...study.stations.map(x=>[x.id,S(x.id)])],selection.station);
 $("analyte").innerHTML=options([["all","All nine metals"],...study.metals.map(x=>[x,x])],selection.analyte);
 $("condition").value=selection.status;
 $("month").innerHTML=options([["all","All sampled months"],...study.period.sampled_months.map(m=>[m,new Date(m+"-01T00:00:00Z").toLocaleDateString("en",{month:"long",timeZone:"UTC"})])],selection.month);
 $("plot-metal").innerHTML=options(study.metals.map(x=>[x,x]),selection.plot);
 $("search").value=selection.search;
}
function summaryMarkup(){
 const groups=study.metals.map(metal=>{const rs=rows.filter(r=>r.characteristic===metal),reported=rs.filter(r=>r.interpretation.kind==="reported"),values=reported.map(r=>r.interpretation.value);return{metal,rs,reported,values};});
 $("metal-summary").innerHTML=groups.map(({metal,rs,reported,values})=>'<tr><th scope="row"><button class="text-button" data-metal="'+E(metal)+'">'+E(metal)+'</button></th><td>'+rs.length+'</td><td>'+reported.length+'</td><td>'+(rs.length-reported.length)+'</td><td>'+(values.length?E(Math.min(...values)+(Math.min(...values)!==Math.max(...values)?" – "+Math.max(...values):"")):"—")+'</td><td>'+E([...new Set(rs.filter(r=>r.detection_limit!=="").map(r=>r.detection_limit))].join("; ")||"—")+'</td><td>'+E([...new Set(rs.map(r=>r.analytical_method_context+" "+r.analytical_method_id))].join("; ")||"—")+'</td></tr>').join("");
 const activities=new Set(rows.map(traceEventKey));
 $("station-summary").innerHTML=study.stations.map(station=>{const selected=rows.filter(r=>r.station_id===station.id),original=study.activities.filter(a=>a.station_id===station.id);return'<tr><th>'+E(S(station.id))+'</th><td>'+new Set(selected.map(traceEventKey)).size+' / '+original.length+'</td><td>'+selected.length+'</td><td>'+E(original.map(a=>a.date).join(", "))+'</td></tr>';}).join("");
 $("selection-label").textContent=traceSelectionLabel(selection);
 $("selected-count").textContent=rows.length+" selected results";
 $("selected-support").textContent=activities.size+" original activities · "+new Set(rows.map(r=>r.station_id)).size+" stations · "+rows.filter(r=>r.interpretation.kind==="reported").length+" reported · "+rows.filter(r=>r.interpretation.kind==="below").length+" below limit";
 $("empty").hidden=rows.length>0;
 $("download-csv").disabled=!rows.length;$("download-package").disabled=!rows.length||busy;$("print").disabled=!rows.length;
}
function calendarMarkup(){
 const months=Array.from({length:12},(_,i)=>"2023-"+String(i+1).padStart(2,"0")),selectedKeys=new Set(rows.map(traceEventKey));
 $("calendar-head").innerHTML="<tr><th>Station</th>"+months.map(m=>"<th>"+new Date(m+"-01T00:00:00Z").toLocaleDateString("en",{month:"short",timeZone:"UTC"})+"</th>").join("")+"</tr>";
 $("calendar-body").innerHTML=study.stations.map(station=>"<tr><th>"+E(S(station.id))+"</th>"+months.map(month=>{const activities=study.activities.filter(a=>a.station_id===station.id&&a.date.startsWith(month)),selected=activities.filter(a=>selectedKeys.has(a.id));return"<td>"+(activities.length?'<button class="calendar-cell '+(selected.length?"selected":"")+'" data-station="'+E(station.id)+'" data-month="'+month+'" aria-label="'+E(S(station.id)+" "+month+": "+activities.length+" original activities, "+selected.length+" in current selection")+'">'+activities.map(a=>a.date.slice(-2)).join(",")+"</button>":'<span aria-label="No original sample">—</span>')+"</td>";}).join("")+"</tr>").join("");
 const metals=study.metals.filter(m=>rows.some(r=>r.characteristic===m)),byActivity=new Map();
 for(const r of rows){const key=traceEventKey(r);if(!byActivity.has(key))byActivity.set(key,new Map());byActivity.get(key).set(r.characteristic,r);}
 $("activity-head").innerHTML="<tr><th>Station</th><th>Sample date / original clock</th>"+metals.map(m=>"<th>"+E(m)+"<br><span class=muted>mg/L</span></th>").join("")+"</tr>";
 $("activity-body").innerHTML=study.activities.filter(a=>byActivity.has(a.id)).map(a=>"<tr><th>"+E(S(a.station_id))+"<br><span class=muted>"+E(S(a.activity_id))+"</span></th><td>"+E(a.date)+"<br><span class=muted>"+E(a.time+" "+a.timezone)+"</span></td>"+metals.map(m=>{const r=byActivity.get(a.id).get(m);return r?'<td><button class="cell-value '+(r.interpretation.kind==="below"?"limit":"")+'" data-record="'+E(r.record_id)+'">'+E(r.interpretation.kind==="below"?"< "+r.detection_limit:r.reported_value)+'</button></td>':'<td title="Outside current selection">—</td>';}).join("")+"</tr>").join("");
}
function plotMarkup(){
 const metal=selection.analyte==="all"?selection.plot:selection.analyte,figure=traceFigure(study,metal,rows);
 $("plot").innerHTML=renderTraceSvg(figure,{interactive:true});
 $("plot-caption").textContent=figure.caption;
 $("plot-metal").value=metal;$("plot-metal").disabled=selection.analyte!=="all";
}
function resultMarkup(){
 $("results-body").innerHTML=rows.map(r=>'<tr><td><button class="text-button" data-record="'+E(r.record_id)+'">Inspect</button></td><th scope="row">'+E(S(r.station_id))+'</th><td>'+E(r.sample_date)+'</td><td>'+E(r.characteristic)+'</td><td>'+E(r.reported_value||"blank")+'</td><td>'+E(r.reported_unit||"blank")+'</td><td>'+E(r.detection_condition||"Reported numeric")+'</td><td>'+E(r.detection_limit+" "+r.detection_limit_unit)+'</td><td>'+E(r.analytical_method_context+" "+r.analytical_method_id)+'</td><td>'+E(r.sample_fraction)+'</td><td>'+E(r.result_comment||r.activity_comment||r.laboratory_comment||"blank")+'</td></tr>').join("");
 const keys=new Set(rows.map(traceEventKey)),context=study.context.filter(r=>keys.has(traceEventKey(r)));
 $("context-count").textContent=context.length+" unchanged observations from the selected activities";
 $("context-body").innerHTML=context.map(r=>'<tr><th>'+E(S(r.station_id))+'</th><td>'+E(r.sample_date)+'</td><td>'+E(r.characteristic)+'</td><td>'+E(r.reported_value)+'</td><td>'+E(r.reported_unit)+'</td><td>'+E(r.sample_fraction||"blank")+'</td><td>'+E(r.analytical_method_context+" "+r.analytical_method_id)+'</td><td>'+E(S(r.activity_id))+'</td></tr>').join("");
}
function inspect(id){
 const row=rows.find(r=>r.record_id===id);if(!row)return;
 inspected=id;$("inspector").hidden=false;$("inspector-title").textContent=S(row.station_id)+" · "+row.sample_date+" · "+row.characteristic;
 $("inspector-summary").textContent=row.interpretation.display+" · "+(row.detection_condition||"Reported numeric")+" · source row "+row.source_record_index;
 $("inspector-body").innerHTML=columns.map(key=>"<tr><th>"+E(key)+"</th><td>"+E(row[key]===""?"(original blank)":row[key]===null?"null":typeof row[key]==="object"?JSON.stringify(row[key]):row[key])+"</td></tr>").join("");
 $("inspector").scrollIntoView({block:"start",behavior:"smooth"});$("inspector-title").focus({preventScroll:true});
}
function render(){
 rows=selectedTraceRows(study,selection);
 if(inspected&&!rows.some(r=>r.record_id===inspected)){inspected=null;$("inspector").hidden=true;}
 controlMarkup();summaryMarkup();calendarMarkup();plotMarkup();resultMarkup();
}
function choose(next){selection=normalizeTraceSelection(study,next);selectionRevision++;render();}
for(const [id,key] of [["station","station"],["analyte","analyte"],["condition","status"],["month","month"],["plot-metal","plot"]])$(id).addEventListener("change",event=>{const next={...selection,[key]:event.target.value};if(key==="analyte"&&next.analyte!=="all")next.plot=next.analyte;choose(next);});
$("search").addEventListener("input",event=>choose({...selection,search:event.target.value}));
$("reset").addEventListener("click",()=>{choose(defaultTraceSelection);say("Showing all 153 original metal results.");});
document.addEventListener("click",event=>{
 const r=event.target.closest("[data-record]");if(r){inspect(r.dataset.record);return;}
 const metal=event.target.closest("[data-metal]");if(metal){choose({...selection,analyte:metal.dataset.metal,plot:metal.dataset.metal});return;}
 const cell=event.target.closest("[data-station][data-month]");if(cell){choose({...selection,station:cell.dataset.station,month:cell.dataset.month});return;}
 const source=event.target.closest("[data-source]");if(source){saveFile(source.dataset.source.split("/").pop(),bank[source.dataset.source],"text/plain;charset=utf-8");say("Downloaded the unchanged retained source "+source.dataset.source);}
});
document.addEventListener("keydown",event=>{if((event.key==="Enter"||event.key===" ")&&event.target.matches("[data-record][role=button]")){event.preventDefault();inspect(event.target.dataset.record);}});
$("close-inspector").addEventListener("click",()=>{inspected=null;$("inspector").hidden=true;});
$("download-csv").addEventListener("click",csvSelected);
$("reopen-selection").addEventListener("click",()=>$("open-selection").click());
$("save-selection").addEventListener("click",()=>saveFile("trace-metals-selection.json",JSON.stringify(selectionRecord(),null,2)+"\n","application/json"));
$("open-selection").addEventListener("change",async event=>{const file=event.target.files?.[0];if(!file)return;const token=++selectionReadToken,revision=selectionRevision,current=()=>token===selectionReadToken&&revision===selectionRevision;try{const value=JSON.parse(await file.text());if(!current())return;const chosen=validSelectionFile(value);event.target.value="";choose(chosen);say("Reopened the exact saved original-record selection.");}catch(error){if(current()){event.target.value="";say(error.message,true);}}});
$("download-package").addEventListener("click",async()=>{if(busy)return;const chosen={...selection};busy=true;summaryMarkup();say("Preparing the complete original-source report package…");try{await new Promise(resolve=>setTimeout(resolve,20));const product=sourcePackage(chosen);saveFile("trace-metals-"+product.id.slice(0,12)+".zip",traceZip(product.files),"application/zip");say("Downloaded "+product.rows.length+" original results, "+product.activities.length+" activities, full source records, selected report and editable selection. Open explorer.html or import sources.json in the installed application.");}catch(error){say(error.message,true);}finally{busy=false;summaryMarkup();}});
$("print").addEventListener("click",()=>window.print());
$("sources-body").innerHTML=study.input.sources.map(source=>'<tr><th>'+E(source.station_id)+'</th><td>'+source.record_count+'</td><td>'+source.bytes.toLocaleString("en")+'</td><td class="hash">'+E(source.sha256)+'</td><td><button data-source="'+E(source.source_path)+'">Download original CSV</button> <a href="'+E(source.source_url)+'" target="_blank" rel="noopener">Original query</a></td></tr>').join("");
$("input-id").textContent=inputId;
render();
})();
