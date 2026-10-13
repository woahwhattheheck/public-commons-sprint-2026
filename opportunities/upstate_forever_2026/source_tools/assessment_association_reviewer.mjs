// Copyright TokenJunkieLabs. Complete offline review of original assessment associations.
import { createArchiveCodec } from "./archive_codec.mjs";

export function createAssociationReviewModel(result) {
  if (!result || result.schema !== "upstate.assessment-association-report/v1" || !Array.isArray(result.records))
    throw new Error("Choose a complete assessment association report.");
  const records=result.records, key=r=>JSON.stringify([r.source_id,r.id]);
  const keys=records.map(key), positions=new Map(keys.map((v,i)=>[v,i]));
  if(positions.size!==records.length) throw new Error("The report repeats an assessment source identity.");
  const selected=new Set(), search=records.map(r=>[
    r.site,r.id,r.source_id,r.source_vintage,r.huc12,r.station_publisher_huc12,r.station_publisher_huc8,
    r.county,r.description,r.cause_label,r.cause_raw,r.use,r.use_support,r.tmdl_report,
    r.assessment_programme?.name,r.station_programme?.name,r.assessment_programme?.focus?.utility,r.station_programme?.focus?.utility,
    r.native_location_source_id,r.native_location_id
  ].filter(Boolean).join(" ").toLowerCase());
  const labels={
    all:"All publisher relationships",different:"Different publisher HUCs",same12:"Matching publisher HUC12",
    coarser:"Station HUC12 unreported",priority_difference:"Different priority states"
  };
  const programmes={all:"All programme associations",assessment_priority:"Assessment HUC is a priority",
    station_priority:"Station HUC12 is a priority",either_priority:"Either exact HUC is a priority",
    assessment_focus:"Assessment HUC is a utility focus",station_focus:"Station HUC12 is a utility focus",
    either_focus:"Either exact HUC is a utility focus"};
  const editions=[...new Map(records.map(r=>[r.source_id,{value:r.source_id,label:r.source_vintage+" · "+r.source_id}])).values()];
  const defaults={text:"",comparison:"all",edition:"all",programme:"all",selectedOnly:false};
  function filters(value={}) {
    const f={...defaults,...value};
    if(typeof f.text!=="string" || !Object.hasOwn(labels,f.comparison) || !Object.hasOwn(programmes,f.programme) ||
      (f.edition!=="all"&&!editions.some(e=>e.value===f.edition)) || typeof f.selectedOnly!=="boolean")
      throw new Error("The saved review contains an unsupported filter.");
    return {text:f.text,comparison:f.comparison,edition:f.edition,programme:f.programme,selectedOnly:f.selectedOnly};
  }
  function query(value) {
    const f=filters(value), words=f.text.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return records.map((r,i)=>i).filter(i=>{
      const r=records[i], a=Boolean(r.assessment_programme?.priority_states?.length),
        s=Boolean(r.station_programme?.priority_states?.length), af=Boolean(r.assessment_programme?.focus),
        sf=Boolean(r.station_programme?.focus);
      if(f.selectedOnly&&!selected.has(keys[i]))return false;
      if(f.edition!=="all"&&r.source_id!==f.edition)return false;
      if(!words.every(w=>search[i].includes(w)))return false;
      if(f.comparison==="different"&&!r.publisher_huc_comparison.startsWith("different_"))return false;
      if(f.comparison==="same12"&&r.publisher_huc_comparison!=="same_publisher_huc12")return false;
      if(f.comparison==="coarser"&&r.station_publisher_huc12)return false;
      if(f.comparison==="priority_difference"&&r.priority_relation!=="different_priority_state_set")return false;
      return ({all:true,assessment_priority:a,station_priority:s,either_priority:a||s,
        assessment_focus:af,station_focus:sf,either_focus:af||sf})[f.programme];
    });
  }
  function toggle(index,checked) {
    if(!Number.isInteger(index)||index<0||index>=records.length||typeof checked!=="boolean")
      throw new Error("Choose an original record in this report.");
    if(checked)selected.add(keys[index]);else selected.delete(keys[index]);
  }
  function restore(state,reportSha) {
    if(!state||state.schema!=="upstate.assessment-association-review/v1"||state.source_report_sha256!==reportSha||
      !Array.isArray(state.selected_record_keys)||new Set(state.selected_record_keys).size!==state.selected_record_keys.length||
      state.selected_record_keys.some(k=>!positions.has(k))||
      (state.active_record_key!==null&&!positions.has(state.active_record_key)))
      throw new Error("This review belongs to a different report or contains an unknown source record.");
    const f=filters(state.filters);
    selected.clear();state.selected_record_keys.forEach(k=>selected.add(k));
    return {filters:f,activeIndex:state.active_record_key===null?null:positions.get(state.active_record_key)};
  }
  function state(reportSha,filterValue,activeIndex=null) {
    if(activeIndex!==null&&(!Number.isInteger(activeIndex)||!keys[activeIndex]))throw new Error("Unknown active record.");
    return {schema:"upstate.assessment-association-review/v1",source_report_sha256:reportSha,
      filters:filters(filterValue),selected_record_keys:keys.filter(k=>selected.has(k)),
      active_record_key:activeIndex===null?null:keys[activeIndex]};
  }
  function selection(reportSha,filterValue,activeIndex=null) {
    const rows=records.filter((r,i)=>selected.has(keys[i]));
    return {schema:"upstate.assessment-association-selection/v1",title:result.title+" — selected original records",
      source_report:{schema:result.schema,sha256:reportSha,assessment_records:records.length,summary:result.summary,inputs:result.inputs,
        programme_source_reference:result.programme_source_reference,assessment_sources:result.assessment_sources},
      methodology:result.methodology,review:state(reportSha,filterValue,activeIndex),
      selection:{records:rows.length,distinct_sites:new Set(rows.map(r=>r.site)).size},records:rows};
  }
  function selectionCsv() {
    const rows=records.filter((r,i)=>selected.has(keys[i]));
    const fields=[...new Set(records.flatMap(r=>Object.keys(r)))];
    const quote=value=>{
      let s=value===null||value===undefined?"":typeof value==="object"?JSON.stringify(value):String(value);
      const trimmed=s.replace(/^[ \t\r\n]+/,"");
      if(/^[=+@]/.test(trimmed)||(trimmed.startsWith("-")&&!/^-(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed))||/^[\t\r\n]/.test(s))s="'"+s;
      return '"'+s.replaceAll('"','""')+'"';
    };
    return "\uFEFF"+[fields.map(quote).join(","),...rows.map(r=>fields.map(f=>quote(r[f])).join(","))].join("\r\n")+"\r\n";
  }
  return {records,keys,labels,programmes,editions,filters,query,toggle,restore,state,selection,selectionCsv,
    isSelected:i=>selected.has(keys[i]),selectedCount:()=>selected.size,
    selectVisible:f=>query(f).forEach(i=>toggle(i,true)),clearSelection:()=>selected.clear()};
}

function associationReviewBrowser() {
  "use strict";
  const el=id=>document.getElementById(id), data=JSON.parse(el("association-review-data").textContent);
  const model=createAssociationReviewModel(data.result), reportSha=data.source_report_sha256;
  const controls={text:el("association-search"),comparison:el("association-comparison"),edition:el("association-edition"),
    programme:el("association-programme"),selectedOnly:el("association-selected-only")};
  let active=null;
  function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;}
  function options(select,entries){select.replaceChildren();entries.forEach(([value,label])=>{const opt=element("option",label);opt.value=value;select.append(opt);});}
  options(controls.comparison,Object.entries(model.labels));options(controls.programme,Object.entries(model.programmes));
  options(controls.edition,[["all","Both assessment editions"],...model.editions.map(e=>[e.value,e.label])]);
  function currentFilters(){return {text:controls.text.value,comparison:controls.comparison.value,edition:controls.edition.value,
    programme:controls.programme.value,selectedOnly:controls.selectedOnly.checked};}
  function applyFilters(f){for(const [k,c] of Object.entries(controls)){if(k==="selectedOnly")c.checked=f[k];else c.value=f[k];}}
  const saved=JSON.parse(el("association-review-state").textContent);
  if(saved){try{const restored=model.restore(saved,reportSha);applyFilters(restored.filters);active=restored.activeIndex;}
    catch(error){el("association-review-notice").textContent=error.message;}}
  function summary(context,coarse){
    if(!context?.huc12)return coarse?"HUC8 "+coarse+" · HUC12 unreported":"HUC12 unreported";
    return context.huc12+" · "+context.name+(context.priority_states.length?" · FY26 priority "+context.priority_states.join(", "):"");
  }
  function safeLink(url,text){
    if(!/^https?:\/\//i.test(String(url||"")))return element("span",text);
    const a=element("a",text);a.href=url;a.rel="noopener noreferrer";return a;
  }
  function detail(index,focus=false){
    active=index;const r=model.records[index], box=el("association-detail");box.replaceChildren();
    box.id="association-detail";const anchor=element("span");anchor.id="record-"+index;box.append(anchor);
    const heading=element("h3",r.site+" · "+r.source_vintage+" · "+(r.cause_label||r.cause_raw));heading.tabIndex=-1;box.append(heading);
    const label=element("label",undefined,"review-select-record"), input=element("input");input.id="association-detail-pick";input.type="checkbox";input.checked=model.isSelected(index);
    input.addEventListener("change",()=>{model.toggle(index,input.checked);render();});
    label.append(input,document.createTextNode(" Include this source-bound assessment record in the selection"));box.append(label);
    const dl=element("dl",undefined,"review-details");
    const add=(term,value)=>dl.append(element("dt",term),element("dd",value));
    add("Assessment publisher HUC12",summary(r.assessment_programme));
    add("Station publisher watershed",summary(r.station_programme,r.station_publisher_huc8));
    add("Publisher relationship",r.publisher_huc_comparison.replaceAll("_"," "));
    add("Programme relationship",r.priority_relation.replaceAll("_"," "));
    add("Assessment use and support",r.use+" · "+r.use_support.replaceAll("_"," "));
    add("Original station coordinates",r.native_location_crs+" · "+r.native_x+", "+r.native_y);
    add("Native station source",r.native_location_source_id+" · original feature "+r.native_location_id);
    add("Assessment source record",r.source_id+" · "+r.id);
    add("Original source page and row",[r.source_page&&"Page "+r.source_page,r.source_row&&"row "+r.source_row].filter(Boolean).join(" · ")||"See complete original record");
    if(r.geographic_membership){
      const g=r.geographic_membership;
      add("Saved polygon analysis",g.status.replaceAll("_"," ")+" · "+(g.huc12s.join("; ")||"No selected HUC12 membership")+" · build "+(g.build_id||"not recorded"));
    }else add("Saved polygon analysis","Choose the original Station geography edition to include its computed memberships.");
    box.append(dl,element("p",r.description));
    const p=element("p");p.append(safeLink(r.source_uri,"Open the original assessment publisher source"));box.append(p);
    const full=element("details"), title=element("summary","Complete retained record, original source text and programme rows");
    full.append(title,element("pre",JSON.stringify(r,null,2)));box.append(full);
    if(focus){heading.focus();box.scrollIntoView({block:"start"});}
  }
  function render(){
    const focused=document.activeElement?.id;const f=currentFilters(), indices=model.query(f), body=el("association-rows");body.replaceChildren();
    for(const index of indices){
      const r=model.records[index], tr=element("tr"), pick=element("td"), input=element("input");
      input.id="association-pick-"+index;input.type="checkbox";input.checked=model.isSelected(index);input.setAttribute("aria-label","Select "+r.site+" "+r.source_vintage+" "+(r.cause_label||r.cause_raw)+" record "+r.id);
      input.addEventListener("change",()=>{model.toggle(index,input.checked);render();});pick.append(input);tr.append(pick);
      const cell=element("td"), button=element("button",r.site,"review-row-link");button.type="button";
      button.addEventListener("click",()=>detail(index,true));cell.append(button,element("small",r.source_vintage+" · "+(r.cause_label||r.cause_raw)));
      tr.append(cell,element("td",r.huc12+" · "+r.assessment_programme.name),
        element("td",r.station_publisher_huc12?r.station_publisher_huc12+" · "+r.station_programme.name:"HUC8 "+r.station_publisher_huc8+" · HUC12 unreported"),
        element("td",r.publisher_huc_comparison.replaceAll("_"," ")),element("td",r.use_support.replaceAll("_"," ")));
      body.append(tr);
    }
    el("association-counts").textContent=indices.length+" of "+model.records.length+" records · "+new Set(indices.map(i=>model.records[i].site)).size+
      " distinct visible sites · "+model.selectedCount()+" selected across all filters";
    el("association-empty").hidden=indices.length!==0;
    ["association-export-json","association-export-csv"].forEach(id=>el(id).disabled=model.selectedCount()===0);
    if(active!==null)detail(active,false);
    if(focused&&el(focused))el(focused).focus({preventScroll:true});
  }
  function download(name,type,text){
    const url=URL.createObjectURL(new Blob([text],{type})), a=element("a");a.href=url;a.download=name;
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  Object.values(controls).forEach(c=>c.addEventListener(c.type==="search"?"input":"change",render));
  el("association-select-visible").addEventListener("click",()=>{model.selectVisible(currentFilters());render();});
  el("association-clear-selection").addEventListener("click",()=>{model.clearSelection();render();});
  el("association-reset-filters").addEventListener("click",()=>{applyFilters(model.filters());render();});
  el("association-export-json").addEventListener("click",()=>download("selected-assessment-records.json","application/json;charset=utf-8",
    JSON.stringify(model.selection(reportSha,currentFilters(),active),null,2)+"\n"));
  el("association-export-csv").addEventListener("click",()=>download("selected-assessment-records.csv","text/csv;charset=utf-8",model.selectionCsv()));
  el("association-save-review").addEventListener("click",()=>{
    const clone=document.documentElement.cloneNode(true);
    clone.querySelector("#association-review-state").textContent=JSON.stringify(model.state(reportSha,currentFilters(),active)).replaceAll("<","\\u003c");
    clone.querySelector("#association-interactive").hidden=true;
    const fallback=clone.querySelector("#association-fallback");fallback.classList.remove("review-print-only");
    fallback.querySelectorAll("[data-record-index]").forEach(row=>{row.id="record-"+row.dataset.recordIndex;});
    clone.querySelector("#association-rows").replaceChildren();
    clone.querySelector("#association-detail").replaceChildren();
    clone.querySelector("#association-review-notice").textContent="Saved review: filters, selected source identities and the complete original report are retained in this file.";
    download("assessment-association-review.html","text/html;charset=utf-8","<!doctype html>\n"+clone.outerHTML);
  });
  el("association-print").addEventListener("click",()=>window.print());
  function hashRecord(){
    const match=/^#record-(\d+)$/.exec(location.hash);
    if(match){const i=Number(match[1]);if(Number.isInteger(i)&&i<model.records.length)detail(i,true);}
  }
  window.addEventListener("hashchange",hashRecord);
  el("association-interactive").hidden=false;
  el("association-fallback").classList.add("review-print-only");
  el("association-fallback").querySelectorAll("[data-record-index]").forEach(row=>{row.id="association-static-"+row.dataset.recordIndex;});
  render();hashRecord();
}

export function renderAssociationReviewer(result, originalHtml) {
  createAssociationReviewModel(result);
  if(typeof originalHtml!=="string" || !originalHtml.includes('<h2 id="records">') || !originalHtml.includes('<h2 id="downloads">'))
    throw new Error("Choose the complete static assessment report to compose its reviewer.");
  const codec=createArchiveCodec(), esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const reportSha=codec.sha256(codec.utf8Encode(JSON.stringify(result,null,2)+"\n"));
  const summaryLabel=r=>(r.station_publisher_huc12||("HUC8 "+r.station_publisher_huc8))+
    (r.station_programme.name?" · "+r.station_programme.name:" · HUC12 unreported");
  const tableRows=result.records.map((r,i)=>'<tr id="record-'+i+'" data-record-index="'+i+'"><td>'+esc(r.site)+"<br>"+esc(r.source_vintage)+
    "<br><small>"+esc(r.id)+"</small></td><td>"+esc(r.huc12)+"<br>"+esc(r.assessment_programme.name)+"</td><td>"+esc(summaryLabel(r))+
    "</td><td>"+esc(r.cause_label||r.cause_raw)+"<br>"+esc(r.use+" · "+r.use_support.replaceAll("_"," "))+"</td><td>"+
    esc(r.publisher_huc_comparison.replaceAll("_"," "))+"</td></tr>").join("");
  const ui='<section id="association-reviewer"><h2 id="records">Review every original assessment</h2>'+
    '<p>Search stations, watershed IDs, names, causes, counties and source editions. Each row keeps its original source-bound record identity. Selections stay selected when filters change.</p>'+
    '<p id="association-review-notice" role="status"></p><div id="association-interactive" hidden>'+
    '<div class="review-controls"><label>Search original records<input id="association-search" type="search" autocomplete="off" placeholder="Station, watershed, cause or county"></label>'+
    '<label>Publisher relationship<select id="association-comparison"></select></label><label>Assessment edition<select id="association-edition"></select></label>'+
    '<label>Programme association<select id="association-programme"></select></label></div>'+
    '<p><label><input id="association-selected-only" type="checkbox"> Show selected records only</label></p>'+
    '<div class="review-actions"><button type="button" id="association-select-visible">Select visible records</button>'+
    '<button type="button" id="association-clear-selection">Clear selection</button><button type="button" id="association-reset-filters">Reset filters</button></div>'+
    '<p id="association-counts" role="status" aria-live="polite"></p>'+
    '<div class="table review-table"><table><caption>Original assessment records matching the current filters</caption><thead><tr>'+
    '<th scope="col">Select</th><th scope="col">Station / edition / cause</th><th scope="col">Assessment publisher HUC12</th><th scope="col">Station publisher watershed</th>'+
    '<th scope="col">Publisher relationship</th><th scope="col">Assessment support</th></tr></thead><tbody id="association-rows"></tbody></table></div>'+
    '<p id="association-empty" hidden>No original records match these filters. Reset filters to see the complete report.</p>'+
    '<div class="review-actions"><button type="button" id="association-export-json" disabled>Export selected JSON</button>'+
    '<button type="button" id="association-export-csv" disabled>Export selected CSV</button>'+
    '<button type="button" id="association-save-review">Save complete review HTML</button><button type="button" id="association-print">Print full report</button></div>'+
    '<p class="muted">JSON keeps the complete selected records and original report references. CSV includes every original field and nested source relationship; text that could be interpreted as a spreadsheet formula is prefixed with an apostrophe. Saved review HTML retains every original record, the current filters and selected identities. Printing includes all original records.</p>'+
    '<section id="association-detail" aria-label="Selected original record"><p>Open a station row to compare its complete source assignments and original coordinates.</p></section></div>'+
    '<div id="association-fallback"><h3>Complete original assessment inventory</h3><p>The full report contains '+result.records.length+
    ' original assessment records. Complete source rows and reusable files are available under Files and sources.</p>'+
    '<div class="table"><table><thead><tr><th scope="col">Station / edition / record ID</th><th scope="col">Assessment publisher HUC12</th>'+
    '<th scope="col">Station publisher watershed</th><th scope="col">Cause / use / support</th><th scope="col">Publisher relationship</th></tr></thead><tbody>'+
    tableRows+"</tbody></table></div></div></section>";
  const style='<style id="association-review-style">[hidden]{display:none!important}.review-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}'+
    '.review-controls label{display:flex;flex-direction:column;gap:5px;font-weight:600}.review-controls input,.review-controls select{font:inherit;min-width:0;width:100%;padding:10px;border:1px solid #888;border-radius:2px;background:#fff;color:#222}'+
    '.review-actions{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.review-actions button,.review-row-link{font:inherit;color:#222;background:#f3f3f3;border:1px solid #888;border-radius:2px;padding:8px 12px;cursor:pointer}'+
    '.review-actions button:disabled{color:#666;cursor:default;background:#eee;border-color:#ccc}.review-row-link{background:none;text-decoration:underline;padding:3px 0;border:0;font-weight:600}'+
    '.review-table{max-height:620px;overflow:auto;border:1px solid #aaa}.review-table thead{position:sticky;top:0;z-index:1;background:#eee}.review-table th:first-child{width:64px}'+
    '.review-table caption{text-align:left;padding:8px}.review-table small{display:block;margin-top:4px}.review-details{display:grid;grid-template-columns:minmax(180px,1fr) 3fr;gap:8px 16px}'+
    '.review-details dt{font-weight:600}.review-details dd{margin:0;overflow-wrap:anywhere}#association-detail{margin:24px 0;border:1px solid #aaa;padding:16px;scroll-margin-top:12px}'+
    '.review-select-record{display:flex;gap:8px;align-items:center}input[type=checkbox]{width:18px;height:18px;accent-color:#333}:focus-visible{outline:2px solid #222;outline-offset:3px}'+
    '.review-print-only{display:none}#association-review-notice:empty{display:none}@media(max-width:700px){.review-controls{grid-template-columns:1fr}.review-details{display:block}.review-details dt{margin-top:10px}.review-table{max-height:520px}}'+
    '@media print{#association-interactive,#association-review-notice{display:none!important}.review-print-only{display:block!important}.table{overflow:visible}table{font-size:9pt}td,th{overflow-wrap:anywhere}.review-actions{display:none}}</style>';
  const payload=JSON.stringify({source_report_sha256:reportSha,result}).replaceAll("<","\\u003c").replaceAll("\u2028","\\u2028").replaceAll("\u2029","\\u2029");
  const script=createAssociationReviewModel.toString()+"\n("+associationReviewBrowser.toString()+")();";
  const hex=codec.sha256(codec.utf8Encode(script)), hash=codec.base64Encode(new Uint8Array(hex.match(/../g).map(v=>parseInt(v,16))));
  const csp="default-src 'none'; script-src 'sha256-"+hash+"'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  const first=originalHtml.indexOf('<h2 id="records">'), last=originalHtml.indexOf('<h2 id="downloads">',first);
  if(last<first)throw new Error("The static report record section is incomplete.");
  let html=originalHtml.slice(0,first)+ui+originalHtml.slice(last);
  const metas=html.match(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/g);
  if(metas?.length!==1)throw new Error("The static report needs its original single content policy.");
  html=html.replace(metas[0],'<meta http-equiv="Content-Security-Policy" content="'+csp+'">').replace("</head>",style+"</head>");
  return html.replace("</body>",'<script id="association-review-data" type="application/json">'+payload+'</script>'+
    '<script id="association-review-state" type="application/json">null</script><script>'+script+"</script></body>");
}
