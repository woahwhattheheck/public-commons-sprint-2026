// Original microbial observations alongside retained native assessment geography.
import { createArchiveCodec } from "./archive_codec.mjs";
import { parseCsv } from "../source/annual-reference-assessment-20261013/microbial-assessment-coverage.mjs";
const codec=createArchiveCodec();
const sha=body=>codec.sha256(codec.utf8Encode(body));
const same=(a,b,label)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(label);};
const unique=values=>[...new Set(values)].sort();
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export const MICROBIAL_SCHEMA="upstate.assessment-microbial-coverage/v1";
export function bindNativeMicrobiology(coverageText,observationsText,nativeContext) {
  if(typeof coverageText!=="string"||typeof observationsText!=="string")throw Error("Retain complete microbial context and observation CSV.");
  const coverage=JSON.parse(coverageText), descriptor=coverage.observations;
  if(coverage.schema!==MICROBIAL_SCHEMA||!Array.isArray(coverage.assessment_station_coverage)||
      !Array.isArray(coverage.observed_station_context)||!Array.isArray(coverage.matched_assessment_records)||
      nativeContext?.schema!=="upstate.assessment-native-huc-context/v1")throw Error("Choose the original completed microbial/native context.");
  same([codec.utf8Encode(observationsText).length,sha(observationsText)],[descriptor.bytes,descriptor.sha256],"Microbial observations differ from the original context.");
  const parsed=parseCsv(observationsText), rows=parsed.rows;
  same(parsed.fields,descriptor.fields,"Original microbial CSV fields differ.");
  same(rows.length,descriptor.records,"Microbial CSV record count differs.");
  const nativeById=new Map(nativeContext.stations.map(row=>[row.station_id,row]));
  const observedById=new Map(coverage.observed_station_context.map(row=>[row.observation_station_id,row]));
  const coverageById=new Map(coverage.assessment_station_coverage.map(row=>[row.assessment_station_id,row]));
  same(coverageById.size,nativeById.size,"Microbial coverage must retain every original assessment station.");
  same(observedById.size,coverage.observed_station_context.length,"Observation station identities repeat.");
  const activities=new Set(),sourceRows=new Set(),groups=new Map();
  for(const row of rows){
    if(activities.has(row.activity_id)||sourceRows.has(JSON.stringify([row.source_file,row.source_row])))throw Error("Microbial original activity/source-row identity repeats.");
    activities.add(row.activity_id);sourceRows.add(JSON.stringify([row.source_file,row.source_row]));
    const station=observedById.get(row.station_id);
    if(!station)throw Error("Observation station is absent from its original summary.");
    same(row.assessment_station_id,station.assessment_station_id||"","Observation assessment station differs.");
    same(JSON.parse(row.assessment_record_ids),station.assessment_record_ids,"Observation assessment record identities differ.");
    if(!groups.has(row.station_id))groups.set(row.station_id,[]);
    groups.get(row.station_id).push(row);
  }
  for(const station of coverage.observed_station_context){
    const records=groups.get(station.observation_station_id)||[];
    same([records.length,records.filter(x=>x.activity_type==="Sample-Routine").length,
      records.filter(x=>x.activity_type==="Quality Control Sample-Field Replicate").length],
      [station.observations,station.routine_observations,station.field_replicates],"Original station sample counts differ.");
    if(station.assessment_station_id){
      const native=nativeById.get(station.assessment_station_id);
      if(!native||station.observation_station_id!=="21SC60WQ_WQX-"+native.station_id||
          station.original_station_name!==native.station_id)throw Error("Measured/assessment station identity is not an exact publisher-scoped match.");
      same(station.geometry_huc12s,native.geometry_huc12s,"Original native station membership differs.");
      same(unique(station.assessment_record_ids),unique(native.assessment_records.map(x=>x.source_id+":"+x.id)),"Measured station assessment edition differs.");
    }
  }
  for(const native of nativeContext.stations){
    const row=coverageById.get(native.station_id);
    if(!row)throw Error("Microbial source omitted an original native station.");
    same(row.geometry_huc12s,native.geometry_huc12s,"Microbial/native coverage geometry differs.");
    same(unique(row.assessment_record_ids),unique(native.assessment_records.map(x=>x.source_id+":"+x.id)),"Microbial coverage assessment IDs differ.");
  }
  const matched=coverage.observed_station_context.filter(row=>row.assessment_station_id);
  const summary=coverage.summary;
  same([observedById.size,rows.length,rows.filter(x=>x.activity_type==="Sample-Routine").length,
    rows.filter(x=>x.activity_type==="Quality Control Sample-Field Replicate").length,nativeById.size,
    nativeContext.stations.reduce((n,row)=>n+row.assessment_records.length,0),matched.length,
    rows.filter(x=>x.assessment_station_id).length,matched.reduce((n,row)=>n+row.assessment_record_count,0)],
    [summary.observation_stations,summary.observations,summary.routine_observations,summary.field_replicates,
      summary.assessment_stations,summary.assessment_records,summary.shared_stations,
      summary.shared_station_observations,summary.shared_assessment_records],"Microbial source summary differs from its complete cohorts.");
  for(const row of coverage.matched_assessment_records){
    const native=nativeById.get(row.assessment_station_id), original=row.assessment_record;
    const record=native?.assessment_records.find(x=>x.source_id===original.source_id&&x.id===original.id);
    if(!record)throw Error("Measured context has an unknown original assessment.");
    same([original.source_sha256,original.source_vintage,original.huc12],
      [record.source_sha256,record.source_vintage,record.publisher_huc12],"Measured context assessment source identity differs.");
    const observations=groups.get(row.observation_station_id);
    same(observations.length,row.observations,"Assessment context repeats or omits a station observation.");
    if(row.assessment_period){
      const match=/^(\d{4})-(\d{4})$/.exec(row.assessment_period);
      if(!match)throw Error("Unsupported original assessment period.");
      same([observations.filter(x=>x.date>=match[1]+"-01-01"&&x.date<=match[2]+"-12-31").length,
        observations.filter(x=>x.date>match[2]+"-12-31").length],
        [row.observations_in_explicit_assessment_period,row.observations_after_explicit_assessment_period],
        "Original explicit assessment-period counts differ.");
    } else if(row.observations_in_explicit_assessment_period!==null||row.observations_after_explicit_assessment_period!==null)
      throw Error("An unspecified assessment period must remain unset.");
  }
  return {coverage,rows,fields:parsed.fields,source:{schema:coverage.schema,
    context_sha256:sha(coverageText),context_bytes:codec.utf8Encode(coverageText).length,
    observations_sha256:descriptor.sha256,observations_bytes:descriptor.bytes,summary:coverage.summary}};
}
export function microbialScientificSections(coverage,prefix) {
  const s=coverage.summary,matched=coverage.observed_station_context.filter(row=>row.assessment_station_id);
  const table=(columns,rows,widths)=>({kind:"table",columns,rows:rows.map(row=>row.map(value=>String(value??"Not specified"))),widths});
  return [["Measured E. coli coverage and assessment interpretation",[
    "The retained utility E. coli source contains "+s.observations+" records at "+s.observation_stations+
      " observation stations: "+s.routine_observations+" routine samples and "+s.field_replicates+
      " field replicate. Exact publisher-scoped station identities join "+s.shared_stations+
      " stations and "+s.shared_station_observations+" routine samples to "+s.shared_assessment_records+
      " original assessment records in the 159-station study.",
    table(["Shared assessment station","Utility","Routine samples","First sample","Latest retained sample","Assessment records"],
      matched.map(row=>[row.assessment_station_id,row.utility_id,row.routine_observations,row.first_date,row.last_date,row.assessment_record_count]),
      [1.1,0.65,0.8,1,1.15,0.9]),
    "All shared-station samples use APHA 9223-B and MPN per 100 mL. The 126 numerical results and six above-limit records retain their original method, limits, comments and status. Above-limit records have an empty measured-result cell and an unbounded upper endpoint.",
    "Four linked assessment records concern E. coli; the other four concern turbidity, dissolved oxygen or pH. A sample is counted once by its original activity ID even when its station has several assessment records. RS-21014 has twelve samples and three assessment records.",
    table(["Station","Assessment edition / cause","Explicit assessment period","Samples in period","Samples after period"],
      coverage.matched_assessment_records.map(row=>[row.assessment_station_id,row.assessment_record.source_vintage+" / "+row.assessment_record.cause_label,
        row.assessment_period,row.observations_in_explicit_assessment_period,row.observations_after_explicit_assessment_period]),
      [0.8,2.2,1,0.8,0.8]),
    "The measured source requested 2021-01-01 through 2025-12-31; retained dates run from "+s.first_sample_date+" through "+s.last_sample_date+
      ". The 2024 assessment period is 2018–2022. July 2026 is a publication/status edition with no explicit assessment-period window in these records.",
    "The remaining 32 observed stations contribute 598 source records outside the selected assessment station cohort. The other 155 assessment stations have no record in this retained utility E. coli source. These are source-coverage statements.",
    "The complete source retains the separate Georgia field replicate, activity 21GAEPD_WQX-A00428245 on 2023-06-22, method APHA 9221-F. Native assessment geometry, observed sampling identity and annual nutrient/sediment references retain their distinct source roles.",
    {kind:"links",items:[
      {title:"Original measured-source interpretation",path:prefix+"MICROBIAL_COVERAGE.md"},
      {title:"All 730 original observation rows and assessment identities",path:prefix+"microbial-assessment-observations.csv"},
      {title:"Complete 36-station measured-source coverage",path:prefix+"microbial-assessment-observed-stations.csv"},
      {title:"All 159 assessment stations and retained measurement coverage",path:prefix+"microbial-assessment-coverage.csv"},
      {title:"Original measured-source and assessment association details",path:prefix+"microbial-assessment-overlap.json"},
    ]}
  ]]];
}
export function createMicrobialReviewModel(coverage,rows,binding) {
  const byStation=new Map(coverage.observed_station_context.map(row=>[row.observation_station_id,row]));
  const byActivity=new Map(rows.map(row=>[row.activity_id,row])),selected=new Set();
  if(byActivity.size!==rows.length)throw Error("Original microbial activity IDs repeat.");
  const defaults={text:"",utility:"all",coverage:"all",station:"all",status:"all",activity:"all",from:"",through:"",selectedOnly:false};
  const statuses=[...new Set(rows.map(row=>row.status))].sort(),activities=[...new Set(rows.map(row=>row.activity_type))].sort();
  function filters(value={}){
    const f={...defaults,...value};
    if(typeof f.text!=="string"||typeof f.selectedOnly!=="boolean"||
      !["all","ARJWS","PRWD"].includes(f.utility)||!["all","shared","other"].includes(f.coverage)||
      f.station!=="all"&&!byStation.has(f.station)||!["all",...statuses].includes(f.status)||
      !["all",...activities].includes(f.activity)||
      !["from","through"].every(key=>typeof f[key]==="string"&&(!f[key]||/^\d{4}-\d{2}-\d{2}$/.test(f[key])))||
      f.from&&f.through&&f.from>f.through)throw Error("Choose compatible measured-source filters.");
    return f;
  }
  function query(value={}){
    const f=filters(value),words=f.text.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return rows.filter(row=>{
      if(f.utility!=="all"&&row.utility_id!==f.utility||f.station!=="all"&&row.station_id!==f.station||
        f.status!=="all"&&row.status!==f.status||f.activity!=="all"&&row.activity_type!==f.activity||
        f.coverage==="shared"&&!row.assessment_station_id||f.coverage==="other"&&row.assessment_station_id||
        f.from&&row.date<f.from||f.through&&row.date>f.through||f.selectedOnly&&!selected.has(row.activity_id))return false;
      const source=byStation.get(row.station_id);
      const hay=[...Object.values(row),...source.assessment_causes,...source.assessment_editions].join(" ").toLowerCase();
      return words.every(word=>hay.includes(word));
    });
  }
  function state(value,active=null){return {schema:"upstate.microbial-source-review/v1",binding,filters:filters(value),
    selected_activity_ids:rows.filter(row=>selected.has(row.activity_id)).map(row=>row.activity_id),active_activity_id:active};}
  function restore(saved){
    if(saved?.schema!=="upstate.microbial-source-review/v1"||saved.binding!==binding||
      !Array.isArray(saved.selected_activity_ids)||new Set(saved.selected_activity_ids).size!==saved.selected_activity_ids.length||
      saved.selected_activity_ids.some(id=>!byActivity.has(id))||
      saved.active_activity_id!==null&&!byActivity.has(saved.active_activity_id))throw Error("Saved measured review belongs to another source edition.");
    const f=filters(saved.filters);selected.clear();for(const id of saved.selected_activity_ids)selected.add(id);
    return {filters:f,active:saved.active_activity_id};
  }
  function selection(value,active=null){
    const records=rows.filter(row=>selected.has(row.activity_id)),ids=new Set(records.map(row=>row.station_id));
    return {schema:"upstate.microbial-source-selection/v1",binding,review:state(value,active),
      original_provenance:coverage.provenance,method:coverage.method,
      observations:records,station_context:coverage.observed_station_context.filter(row=>ids.has(row.observation_station_id)),
      assessment_context:coverage.matched_assessment_records.filter(row=>ids.has(row.observation_station_id))};
  }
  return {rows,coverage,byStation,byActivity,selected,defaults,statuses,activities,filters,query,state,restore,selection};
}
function microbialBrowser(){
  const el=id=>document.getElementById(id),payload=JSON.parse(el("microbial-review-data").textContent);
  const model=createMicrobialReviewModel(payload.coverage,payload.rows,payload.binding);
  const controls=Object.fromEntries(["text","utility","coverage","station","status","activity","from","through","selectedOnly"]
    .map(key=>[key,el("microbial-"+key)]));
  let active=null,page=0;const pageSize=60;
  function line(parent,tag,value){const node=document.createElement(tag);node.textContent=value;parent.append(node);return node;}
  function options(control,rows){control.replaceChildren();for(const [value,label] of rows){const o=line(control,"option",label);o.value=value;}}
  options(controls.utility,[["all","All original utility selections"],["ARJWS","ARJWS"],["PRWD","PRWD"]]);
  options(controls.coverage,[["all","All 36 measured stations"],["shared","Four stations in the assessment cohort"],["other","Other 32 measured stations"]]);
  options(controls.station,[["all","All original observation station IDs"],...model.coverage.observed_station_context.map(row=>[row.observation_station_id,row.observation_station_id])]);
  options(controls.status,[["all","All original result statuses"],...model.statuses.map(x=>[x,x.replaceAll("_"," ")])]);
  options(controls.activity,[["all","Routine and field replicate"],...model.activities.map(x=>[x,x])]);
  function current(){return Object.fromEntries(Object.entries(controls).map(([k,v])=>[k,k==="selectedOnly"?v.checked:v.value]));}
  function apply(f){for(const [k,v] of Object.entries(f))k==="selectedOnly"?controls[k].checked=v:controls[k].value=v;}
  const saved=JSON.parse(el("microbial-review-state").textContent);
  if(saved)try{const r=model.restore(saved);apply(r.filters);active=r.active;}catch(error){el("microbial-notice").textContent=error.message;}
  function openNative(station){
    for(const id of ["native-utility","native-basin","native-relationship"])el(id).value="all";
    el("native-selected-only").checked=false;el("native-search").value=station;
    el("native-search").dispatchEvent(new Event("input",{bubbles:true}));
    el("native-open-"+station)?.click();el("native-coverage").scrollIntoView({block:"start"});
  }
  function detail(id){
    const parent=el("microbial-detail");parent.replaceChildren();
    if(!id){line(parent,"p","Open a sample for original method, limits, comments, source row and edition-specific assessment context.");return;}
    const row=model.byActivity.get(id),station=model.byStation.get(row.station_id);
    line(parent,"h3",row.station_id+" · "+row.date);
    const dl=document.createElement("dl");dl.className="review-details";
    function add(label,value){line(dl,"dt",label);line(dl,"dd",value===""?"Empty in original source":String(value??"Not specified"));}
    for(const [label,value] of [["Original activity",row.activity_id],["Sample type",row.activity_type],
      ["Original date / clock",row.date+" "+row.time+" "+row.timezone],["Method",row.method_context+" "+row.method],
      ["Original measured result",row.result_value],["Original status",row.status],["Original limit",row.limit_value+" "+row.source_limit_unit+" · "+row.limit_type],
      ["Retained interval",row.lower+" to "+(row.upper_unbounded==="true"?"unbounded":row.upper)+" "+row.unit],
      ["Original result unit",row.source_result_unit],["Original comment",row.source_result_comment],
      ["Hydrologic condition / event",row.original_hydrologic_condition+" / "+row.original_hydrologic_event],
      ["Original source row",row.source_file+" · row "+row.source_row],
      ["Source coverage at this station",station.first_date+" through "+station.last_date+" · "+station.observations+" original records"],
      ["Assessment identity",station.assessment_station_id||"Outside this selected assessment station cohort"]])add(label,value);
    parent.append(dl);
    if(station.assessment_station_id){
      const b=line(parent,"button","Open "+station.assessment_station_id+" in native station coverage");b.type="button";b.addEventListener("click",()=>openNative(station.assessment_station_id));
      const t=line(parent,"div","");t.className="table";const table=line(t,"table",""),head=line(table,"thead",""),tr=line(head,"tr","");
      for(const x of ["Original edition / cause","Explicit period","Samples in period","Samples after period"])line(tr,"th",x);
      const body=line(table,"tbody","");
      for(const a of model.coverage.matched_assessment_records.filter(x=>x.observation_station_id===row.station_id)){
        const r=line(body,"tr","");for(const v of [a.assessment_record.source_vintage+" · "+a.assessment_record.cause_label,
          a.assessment_period??"Not specified",a.observations_in_explicit_assessment_period??"Not specified",a.observations_after_explicit_assessment_period??"Not specified"])line(r,"td",v);
      }
    }
    const d=line(parent,"details","");line(d,"summary","Complete original observation and station context");
    line(d,"pre",JSON.stringify({original_observation:row,station_context:station},null,2));
  }
  function render(){
    const focused=document.activeElement?.id;let rows;
    try{rows=model.query(current());el("microbial-notice").textContent="";}catch(error){el("microbial-notice").textContent=error.message;return;}
    const pages=Math.max(1,Math.ceil(rows.length/pageSize));page=Math.min(page,pages-1);
    const body=el("microbial-rows");body.replaceChildren();
    for(const row of rows.slice(page*pageSize,(page+1)*pageSize)){
      const tr=line(body,"tr",""),first=line(tr,"td",""),input=document.createElement("input");
      input.type="checkbox";input.id="microbial-pick-"+payload.rows.indexOf(row);input.checked=model.selected.has(row.activity_id);
      input.setAttribute("aria-label","Select "+row.activity_id);first.append(input);
      input.addEventListener("change",()=>{input.checked?model.selected.add(row.activity_id):model.selected.delete(row.activity_id);render();});
      const cell=line(tr,"td",""),b=line(cell,"button",row.station_id);b.type="button";b.id="microbial-open-"+payload.rows.indexOf(row);
      b.addEventListener("click",()=>{active=row.activity_id;render();el("microbial-detail").scrollIntoView({block:"nearest"});});
      line(cell,"small",row.activity_id);
      for(const v of [row.date,row.activity_type,row.result_value===""?"":row.result_value+(row.source_result_unit?" "+row.source_result_unit:""),row.status,
        row.limit_value+" "+row.source_limit_unit,row.unit,row.method_context+" "+row.method,row.assessment_station_id||"Outside selected assessment cohort"])line(tr,"td",v);
    }
    el("microbial-counts").textContent=rows.length+" distinct original activities · "+new Set(rows.map(x=>x.station_id)).size+
      " visible stations · "+model.selected.size+" selected across filters · page "+(page+1)+" / "+pages;
    el("microbial-prev").disabled=page===0;el("microbial-next").disabled=page===pages-1;
    for(const id of ["microbial-export-json","microbial-export-csv"])el(id).disabled=!model.selected.size;
    el("microbial-review-state").textContent=JSON.stringify(model.state(current(),active)).replaceAll("<","\\u003c");
    detail(active);if(focused)el(focused)?.focus({preventScroll:true});
  }
  function download(name,body,type){const url=URL.createObjectURL(new Blob([body],{type})),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function csvCell(value){let s=String(value??""),trimmed=s.trimStart();
    if(/^[=+@]/.test(trimmed)||(trimmed.startsWith("-")&&!/^-(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed))||/^[\t\r\n]/.test(s))s="'"+s;
    return '"'+s.replaceAll('"','""')+'"';}
  for(const [key,control] of Object.entries(controls))control.addEventListener(key==="text"?"input":"change",()=>{page=0;render();});
  el("microbial-prev").addEventListener("click",()=>{page--;render();});el("microbial-next").addEventListener("click",()=>{page++;render();});
  el("microbial-select").addEventListener("click",()=>{try{for(const row of model.query(current()))model.selected.add(row.activity_id);render();}catch(error){el("microbial-notice").textContent=error.message;}});
  el("microbial-clear").addEventListener("click",()=>{model.selected.clear();render();});
  el("microbial-reset").addEventListener("click",()=>{apply(model.filters());page=0;render();});
  el("microbial-export-json").addEventListener("click",()=>download("selected-microbial-source-records.json",JSON.stringify(model.selection(current(),active),null,2)+"\n","application/json"));
  el("microbial-export-csv").addEventListener("click",()=>download("selected-microbial-source-records.csv",
    [payload.fields,...model.rows.filter(row=>model.selected.has(row.activity_id)).map(row=>payload.fields.map(key=>row[key]))].map(row=>row.map(csvCell).join(",")).join("\r\n")+"\r\n","text/csv"));
  el("microbial-save").addEventListener("click",()=>el("association-save-review").click());
  el("microbial-print").addEventListener("click",()=>window.print());
  el("microbial-interactive").hidden=false;el("microbial-fallback").classList.add("microbial-print-only");render();
}
export function renderNativeMicrobiology({html,bound}) {
  const {coverage,rows,fields,source}=bound,binding=source.context_sha256+":"+source.observations_sha256;
  const table=(headers,data)=>'<div class="table"><table><thead><tr>'+headers.map(x=>"<th>"+esc(x)+"</th>").join("")+
    "</tr></thead><tbody>"+data.map(row=>"<tr>"+row.map(v=>"<td>"+esc(v??"Not specified")+"</td>").join("")+"</tr>").join("")+"</tbody></table></div>";
  const fallback=table(["Original observation station","Assessment station","Utility","Routine / replicate","First / latest date","Method"],
    coverage.observed_station_context.map(row=>[row.observation_station_id,row.assessment_station_id||"Outside selected assessment cohort",row.utility_id,
      row.routine_observations+" / "+row.field_replicates,row.first_date+" / "+row.last_date,row.methods.join("; ")]))+
    table(["Assessment station","Edition / cause","Explicit period","Samples in / after period"],coverage.matched_assessment_records.map(row=>[
      row.assessment_station_id,row.assessment_record.source_vintage+" / "+row.assessment_record.cause_label,row.assessment_period,
      (row.observations_in_explicit_assessment_period??"Not specified")+" / "+(row.observations_after_explicit_assessment_period??"Not specified")]));
  const s=coverage.summary;
  const ui='<section id="microbial-coverage"><h2>Measured E. coli source context</h2><p>'+
    s.observations+" original records at "+s.observation_stations+" observation stations · "+s.shared_stations+
    " shared assessment stations · "+s.shared_station_observations+" routine samples · "+s.shared_assessment_records+
    ' original assessment records.</p><p>Sample dates '+esc(s.first_sample_date)+" through "+esc(s.last_sample_date)+
    ". Each original activity is counted once. Empty numerical cells, limits, methods and the field replicate remain visible. Absence means no record in this retained utility E. coli cohort.</p>"+
    '<div id="microbial-interactive" hidden><div class="review-controls">'+
    '<label>Search station, activity, comment or assessment cause<input id="microbial-text" type="search"></label>'+
    ["utility","coverage","station","status","activity"].map(key=>'<label>'+esc({utility:"Original utility selection",coverage:"Assessment association",station:"Original observation station",status:"Result status",activity:"Sample type"}[key])+'<select id="microbial-'+key+'"></select></label>').join("")+
    '<label>Samples from<input id="microbial-from" type="date"></label><label>Samples through<input id="microbial-through" type="date"></label></div>'+
    '<label><input id="microbial-selectedOnly" type="checkbox"> Show selected activities only</label><p id="microbial-notice" role="status"></p>'+
    '<div class="review-actions"><button type="button" id="microbial-select">Select all matching activities</button><button type="button" id="microbial-clear">Clear sample selection</button><button type="button" id="microbial-reset">Reset measured-source filters</button></div>'+
    '<p id="microbial-counts" role="status" aria-live="polite"></p><div class="table review-table"><table><thead><tr>'+
    ["Select","Original station / activity","Sample date","Sample type","Measured result / original unit","Status","Original limit","Retained interval unit","Method","Assessment station"].map(x=>"<th>"+esc(x)+"</th>").join("")+
    '</tr></thead><tbody id="microbial-rows"></tbody></table></div><div class="review-actions"><button type="button" id="microbial-prev">Previous samples</button><button type="button" id="microbial-next">Next samples</button>'+
    '<button type="button" id="microbial-export-json">Export selected sample JSON</button><button type="button" id="microbial-export-csv">Export selected sample CSV</button><button type="button" id="microbial-save">Save complete review HTML</button><button type="button" id="microbial-print">Print source summary</button></div>'+
    '<section id="microbial-detail" aria-label="Original measured sample and assessment context"></section></div>'+
    '<div id="microbial-fallback"><h3>Complete observed-station coverage and assessment periods</h3>'+fallback+
    '<p>The complete 730 source rows are retained in the observation CSV and interactive report data.</p></div></section>';
  const script=createMicrobialReviewModel.toString()+"\n("+microbialBrowser.toString()+")();";
  const hash=codec.base64Encode(new Uint8Array(sha(script).match(/../g).map(x=>parseInt(x,16))));
  const policy=html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
  if(!policy?.[1].includes("script-src ")||!html.includes('<section id="native-coverage">'))throw Error("Compose measured context with the native assessment reviewer.");
  const updated=policy[1].replace(/script-src ([^;]+)/,(_,v)=>"script-src "+v+" 'sha256-"+hash+"'");
  const payload=JSON.stringify({binding,coverage,rows,fields}).replaceAll("<","\\u003c").replaceAll("\u2028","\\u2028").replaceAll("\u2029","\\u2029");
  return html.replace(policy[0],'<meta http-equiv="Content-Security-Policy" content="'+updated+'">')
    .replace("</head>",'<style>#microbial-detail{border:1px solid #aaa;padding:16px;margin:20px 0}.microbial-print-only{display:none}@media print{#microbial-interactive{display:none!important}.microbial-print-only{display:block!important}}</style><noscript><style>.microbial-print-only{display:block!important}</style></noscript></head>')
    .replace("<nav>",'<nav><a href="#microbial-coverage">Measured source context</a>')
    .replace('<section id="native-coverage">',ui+'<section id="native-coverage">')
    .replace("</body>",'<script id="microbial-review-data" type="application/json">'+payload+'</script><script id="microbial-review-state" type="application/json">null</script><script>'+script+"</script></body>");
}

export const MICROBIAL_ORIGINAL_FILES=Object.freeze([
  {
    "path": "source/ecoli_temporal_analysis/20261013/source-manifest.json",
    "bytes": 9294,
    "sha256": "e044c8bad2693b34c3f5912ff1f360d7a2da594b92504fc2ec6ac2f69573f391"
  },
  {
    "path": "source/ecoli_temporal_analysis/20261013/record-intervals.csv",
    "bytes": 227126,
    "sha256": "4ad3864e802385c038f4c9005ed72c79f93de6b930a5b66b061ac325143ddfa0"
  },
  {
    "path": "source/ecoli_temporal_analysis/20261013/station-summary.csv",
    "bytes": 13740,
    "sha256": "306f93bda04c2d8727f6c0fef782deff5f599a3818beb30c09e1f3aaed9c94ba"
  },
  {
    "path": "source/ecoli_temporal_analysis/20261013/README.md",
    "bytes": 10529,
    "sha256": "0e986818ee59d1cb6db66e947b5bb53bd9ddcc35d3fdc335be1df6affc547d4e"
  },
  {
    "path": "source/ecoli_utility_context/20261013/source-manifest.json",
    "application_path": "source/ecoli_utility_context/20261013/original-b91a8dd8/source-manifest.json",
    "bytes": 23194,
    "sha256": "ee6d5cc19e2a98b799db33df08026c6020a9a122f5cfb4ab83f1e415476dee23"
  },
  {
    "path": "source/ecoli_temporal_analysis/20261013/station-year-summary.csv",
    "bytes": 30692,
    "sha256": "5ddba3ebf23067820609734731f817b4513ba3a5381e175cd3b5340579d43f21"
  },
  {
    "path": "source/ecoli_temporal_analysis/20261013/station-season-summary.csv",
    "bytes": 48144,
    "sha256": "9ce54e608a226b26200092b15225bb63d033a3982a03ee897060d88f349fce08"
  },
  {
    "path": "source/ecoli_temporal_analysis/20261013/station-month-summary.csv",
    "bytes": 122016,
    "sha256": "2d3090b1f3e63f42abb2e2950cd71c839ce5fb039667a2e0555ace8cc5f23390"
  },
  {
    "path": "source/ecoli_temporal_analysis/20261013/field-replicates.csv",
    "bytes": 708,
    "sha256": "9e922602ca20ddaeac8d4858c65404ba7bded9b71b8c43b1f09645562803b004"
  },
  {
    "path": "source/ecoli_temporal_analysis/20261013/comment-sensitivity.csv",
    "bytes": 13752,
    "sha256": "74d9853ac07b5339a3cdbe2577948cc9393537bb7da0519980610744c5d8ce15"
  },
  {
    "path": "source/ecoli_temporal_analysis/20261013/flagged-source-comments.csv",
    "bytes": 28893,
    "sha256": "a62b00d921d09b939a4ad67b746ba2b4afc392a1aa076477b450783d2e4eb384"
  },
  {
    "path": "source/ecoli_temporal_analysis/20261013/annual-sampling-coverage.csv",
    "bytes": 206,
    "sha256": "8e2d8aa914bb20a28e2403af83ce31c0e7eaea8c3eabd8e48f46ce33b0560d63"
  },
  {
    "path": "source/ecoli_temporal_analysis/20261013/flow-daily-2022.csv",
    "bytes": 21567,
    "sha256": "8fbd91d565fe517080ff8edd45cd309bfdaa31fbd1a745bf001bac48f12d14ad"
  },
  {
    "path": "source/ecoli_temporal_analysis/20261013/flow-sample-join.csv",
    "bytes": 7536,
    "sha256": "d71fee49d8363898397f7039d6ee1beb0100f4fea9373d4f7cb682e96f88e44b"
  },
  {
    "path": "source/ecoli_temporal_analysis/20261013/analysis-summary.json",
    "bytes": 8450,
    "sha256": "e492f216935e85cef11ba789cca65f39aaa330f7c8e2b40d6c6825588b1591fd"
  },
  {
    "path": "source/ecoli_temporal_analysis/20261013/analysis.mjs",
    "bytes": 20084,
    "sha256": "4c00450d05f8e6509ea300af53aeca2cbbb17f87bbd1584fa1353919a8829e0b"
  },
  {
    "path": "source/ecoli_temporal_analysis/20261013/reproduce.mjs",
    "bytes": 2314,
    "sha256": "a6f5101449c038a5a3563b644372f8cad5035d2d5dd6efa3583ee85b06de8a76"
  },
  {
    "path": "source/ecoli_utility_context/20261013/results-with-provenance.csv",
    "bytes": 368696,
    "sha256": "b6cf7d334c6b8bb1a174374c30e8ea3081dd1f05be2418040272c581a49264a8"
  },
  {
    "path": "source/ecoli_utility_context/20261013/station-membership.csv",
    "bytes": 6909,
    "sha256": "a86d50fe88be52c78b667474ec015ebdbe5baac711d08da24757181b19fc8a92"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02177000_2022_2023.json",
    "bytes": 55405,
    "sha256": "4c6f2676d75443e9d9e9d4cb528c6b23aa3e3ca1c583dd07da253421f3fd94ec"
  },
  {
    "path": "source/ecoli_utility_context/20261013/raw/stations-original.csv",
    "bytes": 21317,
    "sha256": "ee0b0c50f30d20b1e12b55c7964a13e10e39729f9d4dd4d07d422fd3eba7292b"
  },
  {
    "path": "source/ecoli_utility_context/20261013/raw/stations-original.geojson",
    "bytes": 46598,
    "sha256": "1d5b9ee443eeb20bb8cd787b0e80032968d344eaaed0fce9687440e9368c2da9"
  },
  {
    "path": "source/ecoli_utility_context/20261013/raw/arjws-wbd-original.json",
    "bytes": 183656,
    "sha256": "51b827ba0c08ad5c7929266e7dc51c1b333b804f45c065ad16107d8757aeea6d"
  },
  {
    "path": "source/ecoli_utility_context/20261013/raw/prwd-wbd-display.json",
    "bytes": 59535,
    "sha256": "847a2608126c07b8c1327b828ffdede7fd366206d7a072777d2fe10b640d2144"
  },
  {
    "path": "source/ecoli_utility_context/20261013/raw/arjws-results-2021-2025-original.csv",
    "bytes": 68038,
    "sha256": "5be1db109931d9e1ee8781b3beaab8db8ddbfc801a433d076de6de4eaa7372ef"
  },
  {
    "path": "source/ecoli_utility_context/20261013/raw/prwd-results-2021-original.csv",
    "bytes": 65619,
    "sha256": "6cd6fb87b4746eff72cb88b4345d1cccb01133c953f5f281e77b92394896b93a"
  },
  {
    "path": "source/ecoli_utility_context/20261013/raw/prwd-results-2022-original.csv",
    "bytes": 39899,
    "sha256": "acc3ae54de209755e9463fb82c3ca0f9d6237575b5b98f58f4690be12dc81e5c"
  },
  {
    "path": "source/ecoli_utility_context/20261013/raw/prwd-results-2023-original.csv",
    "bytes": 44379,
    "sha256": "10eba1c5f8de5d00fe2bf156340978a8d85edbe991e0ce1413af34f24c70a0c3"
  },
  {
    "path": "source/ecoli_utility_context/20261013/raw/prwd-results-2024-original.csv",
    "bytes": 53715,
    "sha256": "8f6dcdaf3cb59f1e363d73391c09efcca5a51a27c84e91eb528bf1129ba04c14"
  },
  {
    "path": "source/ecoli_utility_context/20261013/raw/prwd-results-2025-original.csv",
    "bytes": 73283,
    "sha256": "6d1a0ccdda3dc49a67b636a202a80174a6dde5a15c4f8c3861cc45766b4747bc"
  },
  {
    "path": "source/ecoli_utility_context/20261013/raw/utility-focus-profile.json",
    "bytes": 2169,
    "sha256": "93abaaf736c66a7ca971ca931da2a3d81d939ecdeb830c7892267153c4413da7"
  },
  {
    "path": "source/ecoli_utility_context/20261013/raw/utility-memberships.csv",
    "bytes": 8731,
    "sha256": "2eee66822d755219958c1eef11fdeca2ee6c8e6ea9e8aa0d032cdeea2b44f945"
  },
  {
    "path": "source/ecoli_utility_context/20261013/README.md",
    "bytes": 7374,
    "sha256": "ac740a16a79bcf835f98e10e0330bf0e1d6f69d2e0354b8932f5586d43ffbc0e"
  },
  {
    "path": "source/ecoli_utility_context/20261013/build_ecoli_report.mjs",
    "application_path": "source/ecoli_utility_context/20261013/original-b91a8dd8/build_ecoli_report.mjs",
    "bytes": 45810,
    "sha256": "5b429341f794ee155cadda87b6262da3da2649ba31cf0e69c92b160b362dcfb5"
  },
  {
    "path": "source/ecoli_utility_context/20261013/index.html",
    "application_path": "source/ecoli_utility_context/20261013/original-b91a8dd8/index.html",
    "bytes": 568315,
    "sha256": "1fb6f51d95109b2a146f344175c27364573eb9529c748645d9df9505e78cca26"
  },
  {
    "path": "source/ecoli_utility_context/20261013/source-inputs.json",
    "bytes": 8181,
    "sha256": "1f12885711f3eb070de2e05f8db9f48c8578fe33c6bd20137b8959feb35b2a28"
  },
  {
    "path": "source/ecoli_utility_context/20261013/station-year-method-summary.csv",
    "bytes": 9986,
    "sha256": "fb6193f8cddfdf7be72845fb53324117d021517688569d7ee9e1cb03fc22c8d2"
  },
  {
    "path": "source/ecoli_utility_context/20261013/summary.json",
    "bytes": 3448,
    "sha256": "e1594c28818636785f82642e848d91e6de56f2b0b8f29dfc81281e5685c6066d"
  },
  {
    "path": "source/ecoli_utility_context/20261013/selected-stations.geojson",
    "bytes": 106741,
    "sha256": "533e91201e09aa1103289722f0077edb496f4ed319deb6a4b58771fb7073a907"
  }
]);

export function retainMicrobialSources(files,originalFiles,nativeContext) {
  const text=value=>typeof value==="string"?value:codec.utf8Decode(value);
  const manifestBody=files?.["microbial-assessment-sources.json"];
  if(typeof manifestBody!=="string")throw Error("Retain the complete original microbial source manifest.");
  if(sha(manifestBody)!=="5799f47ffbdf0c12b8b7003a4bd88badb1d30f1a54b874db678d1de2189acffe")throw Error("Choose the original completed microbial source edition.");
  const manifest=JSON.parse(manifestBody),retained={"microbial-assessment-sources.json":manifestBody};
  if(manifest.schema!=="upstate.sources/v1"||manifest.entries.length!==4)throw Error("Choose all four original microbial source entries.");
  for(const entry of manifest.entries)for(const row of [entry,...(entry.companions||[])]){
    if(!/^[A-Za-z0-9_.-]+$/.test(row.path))throw Error("Unexpected original microbial source member.");
    const body=files[row.path];
    if(typeof body!=="string"||codec.utf8Encode(body).length!==row.bytes||sha(body)!==row.sha256)throw Error("Original microbial member differs: "+row.path);
    retained[row.path]=body;
  }
  const originalRetained={};
  for(const row of MICROBIAL_ORIGINAL_FILES){
    const body=originalFiles?.[row.path];
    if(typeof body!=="string"||codec.utf8Encode(body).length!==row.bytes||sha(body)!==row.sha256)throw Error("Original microbial provenance member differs: "+row.path);
    originalRetained[row.path]=body;
  }
  const bound=bindNativeMicrobiology(retained["microbial-assessment-overlap.json"],retained["microbial-assessment-observations.csv"],nativeContext);
  const physical=bound.coverage.provenance.physical_assessment_context.find(row=>row.path==="assessment-native-huc-context.json");
  if(physical?.sha256!=="bef411c2954fc3e7deb6419b1222b55c36733957700f23ff4d460b35b2b9e360")throw Error("Microbial/native source binding differs.");
  return {manifest,files:retained,originalFiles:originalRetained,bound};
}
