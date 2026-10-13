// Complete offline review of original station and statewide assessment source scope.
import { createArchiveCodec } from "./archive_codec.mjs";
import { zipReportFiles } from "./assessment_association_package.mjs";
const codec=createArchiveCodec();
export const SOURCE_SCOPE_COMPANIONS=Object.freeze({
  "stationManifest": {
    "path": "source_data/scdes_savannah705_20261013/sources.json",
    "bytes": 1525,
    "sha256": "4f586bfe326c485ce917622e5d091082c17e407b0d5005ae9fe2f79a39dd273a"
  },
  "stationProvenance": {
    "path": "source_data/scdes_savannah705_20261013/source-provenance.json",
    "bytes": 931,
    "sha256": "f7c7c2e6eb9ef1992380f605afcda599e7cccbbd925956132d91ac585b31b2fc"
  },
  "stationCountResponse": {
    "path": "source_data/scdes_savannah705_20261013/original-count-response.html",
    "bytes": 41,
    "sha256": "d110bed49ce5c04505eba11c314a48b8d6615417ab68e11882526aaabe0a9487"
  },
  "assessmentManifest": {
    "path": "source/water-quality-assessments/20261013/sources.json",
    "bytes": 2155,
    "sha256": "353b4fac9e1f2cecd694aef14a0e41ab468c75bbe6cd13fb7b7d2ed4ef0dc60f"
  },
  "publisherTableText": {
    "path": "source/water-quality-assessments/20261013/inputs/303d-2024-publisher-pdf-table-text.json",
    "bytes": 688155,
    "sha256": "9be7679b79ca2a8a4d4d21227ad57371b88fd6082e8b29c7efc6d9a18ab0edce"
  }
});
const json=value=>JSON.stringify(value,null,2)+"\n";
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const identity=(path,text)=>{const data=codec.utf8Encode(text);return {path,bytes:data.length,sha256:codec.sha256(data)};};
const fixedReport="https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/1cb592f38c0fe477ab96d84bbf8850e30626300a/opportunities/upstate_forever_2026/results/assessment-association-review-20261013";

export function createSourceScopeReviewModel(result) {
  if(result?.schema!=="upstate.assessment-station-source-audit/v1"||!Array.isArray(result.assessments)||!Array.isArray(result.stations))
    throw Error("Choose a complete original source-scope audit.");
  const groups={assessments:result.assessments,stations:result.stations};
  const identity=(kind,row)=>kind==="assessments"?row.record_key:row.station_id;
  const selected={assessments:new Set(),stations:new Set()};
  const lookup=Object.fromEntries(Object.entries(groups).map(([kind,rows])=>[kind,new Map(rows.map((row,i)=>[identity(kind,row),i]))]));
  if(Object.entries(groups).some(([kind,rows])=>lookup[kind].size!==rows.length))throw Error("Source identities repeat.");
  const defaults={kind:"assessments",text:"",scope:"all",edition:"all",selectedOnly:false,stationId:null};
  const scopes={
    assessments:{all:"All statewide assessments",selected_domain:"Assessment publisher HUC in selected domain",native_match:"Matches the native 705 source",
      no_native_match:"Absent from the native 705 selection",inside_matched:"Selected domain with native match",inside_unmatched:"Selected domain without native match",
      outside_inside:"Assessment HUC outside / station HUC inside",outside_outside:"Both publisher HUCs outside",different:"Different publisher HUC12"},
    stations:{all:"All native station features",with_assessments:"With records in the two assessment editions",without_assessments:"Without records in the two editions",
      domain_inside:"Station publisher HUC in selected domain",domain_outside:"Station publisher HUC outside",huc_unreported:"Original HUC attribute is not 12 digits"}
  };
  const editions=[...new Map(result.assessments.map(r=>[r.source_id,{value:r.source_id,label:r.source_vintage+" · "+r.source_id}])).values()];
  const search=Object.fromEntries(Object.entries(groups).map(([kind,rows])=>[kind,rows.map(r=>(kind==="assessments"?
    [r.site,r.id,r.source_id,r.source_vintage,r.assessment_publisher_huc12,r.native_station_match?.publisher_huc_raw,r.publisher_relationship,
      r.original_assessment.description,r.original_assessment.county,r.original_assessment.cause_label,r.original_assessment.cause_raw,
      r.original_assessment.use,r.original_assessment.tmdl_report]:
    [r.station_id,r.native_feature_id,r.publisher_huc_raw,r.original_feature.attributes.DESCRIPT,r.original_feature.attributes.COUNTY,
      r.original_feature.attributes.NAME]).filter(v=>v!==null&&v!==undefined).join(" ").toLowerCase())]));
  function filters(value={}) {
    const f={...defaults,...value};
    if(!Object.hasOwn(groups,f.kind)||typeof f.text!=="string"||!Object.hasOwn(scopes[f.kind],f.scope)||
      typeof f.selectedOnly!=="boolean"||(f.stationId!==null&&!lookup.stations.has(f.stationId))||(f.edition!=="all"&&!editions.some(e=>e.value===f.edition)))
      throw Error("The saved source review has unsupported filters.");
    return {kind:f.kind,text:f.text,scope:f.scope,edition:f.kind==="stations"?"all":f.edition,selectedOnly:f.selectedOnly,stationId:f.stationId};
  }
  function query(value={}) {
    const f=filters(value),words=f.text.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return groups[f.kind].map((r,i)=>i).filter(i=>{
      const row=groups[f.kind][i];
      if(f.stationId!==null&&(row.site||row.station_id)!==f.stationId)return false;
      if(f.selectedOnly&&!selected[f.kind].has(identity(f.kind,row)))return false;
      if(!words.every(word=>search[f.kind][i].includes(word)))return false;
      if(f.kind==="assessments") {
        if(f.edition!=="all"&&row.source_id!==f.edition)return false;
        const match=Boolean(row.native_station_match),a=row.assessment_publisher_in_selected_domain,
          s=row.native_station_match?.station_publisher_in_selected_domain;
        return ({all:true,selected_domain:a,native_match:match,no_native_match:!match,inside_matched:a&&match,
          inside_unmatched:a&&!match,outside_inside:!a&&s===true,outside_outside:!a&&s===false,
          different:row.publisher_relationship==="different_publisher_huc12"})[f.scope];
      }
      const has=row.assessment_record_keys.length>0,inDomain=row.station_publisher_in_selected_domain;
      return ({all:true,with_assessments:has,without_assessments:!has,domain_inside:inDomain===true,
        domain_outside:inDomain===false,huc_unreported:row.publisher_huc_status!=="reported_huc12"})[f.scope];
    });
  }
  function select(kind,indices,value=true) {
    if(!Object.hasOwn(groups,kind)||indices.some(i=>!Number.isInteger(i)||i<0||i>=groups[kind].length))throw Error("Unknown source selection.");
    indices.forEach(i=>{const id=identity(kind,groups[kind][i]);if(value)selected[kind].add(id);else selected[kind].delete(id);});
  }
  function selectedRows(kind) {return groups[kind].filter(row=>selected[kind].has(identity(kind,row)));}
  function snapshot(reportSha,value,active=null) {
    const f=filters(value);
    return {schema:"upstate.source-scope-review-state/v1",source_report_sha256:reportSha,filters:f,active,
      selected:{assessments:[...selected.assessments],stations:[...selected.stations]}};
  }
  function restore(state,reportSha) {
    if(state===null||state===undefined)return filters();
    if(state.schema!=="upstate.source-scope-review-state/v1"||state.source_report_sha256!==reportSha)
      throw Error("The saved selection belongs to a different source report.");
    const f=filters(state.filters);
    for(const kind of Object.keys(groups))if(!Array.isArray(state.selected?.[kind])||
      new Set(state.selected[kind]).size!==state.selected[kind].length||
      state.selected[kind].some(id=>!lookup[kind].has(id)))throw Error("Saved review contains an unknown original identity.");
    if(state.active!==null&&state.active!==undefined&&
      (!Object.hasOwn(groups,state.active.kind)||!lookup[state.active.kind].has(state.active.id)))
      throw Error("Saved detail record is absent from this source report.");
    for(const kind of Object.keys(groups)){selected[kind].clear();state.selected[kind].forEach(id=>selected[kind].add(id));}
    return f;
  }
  function selection(kind,reportSha) {
    return {schema:"upstate.source-scope-selection/v1",source_report_sha256:reportSha,kind,
      source_inputs:result.inputs,source_selection:result.source_selection,interpretation:result.interpretation,
      records:selectedRows(kind)};
  }
  function csv(kind) {
    const rows=selectedRows(kind),columns=Array.from(new Set(rows.flatMap(row=>Object.keys(row))));
    const cell=value=>{
      let text=value===undefined||value===null?"":typeof value==="object"?JSON.stringify(value):String(value);
      const trimmed=text.replace(/^[ \t\r\n]+/,"");
      if(/^[=+@]/.test(trimmed)||(trimmed.startsWith("-")&&!/^-(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed))||/^[\t\r\n]/.test(text))text="'"+text;
      return '"'+text.replaceAll('"','""')+'"';
    };
    return "\uFEFF"+[columns.map(cell).join(","),...rows.map(row=>columns.map(k=>cell(row[k])).join(","))].join("\r\n")+"\r\n";
  }
  return {groups,lookup,selected,scopes,editions,filters,query,select,selectedRows,snapshot,restore,selection,csv,identity};
}

function sourceScopeBrowser() {
  "use strict";
  const $=id=>document.getElementById(id),payload=JSON.parse($("scope-data").textContent);
  const result=payload.result,reportSha=payload.source_report_sha256,model=createSourceScopeReviewModel(result);
  let filter=model.filters(),offset=0,active=null;
  const pageSize=100;
  const el=(name,text,className)=>{const node=document.createElement(name);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
  const domain=value=>value===true?"Inside selected domain":value===false?"Outside selected domain":"HUC12 unreported";
  const human=value=>String(value??"").replaceAll("_"," ");
  function options(select,entries,current) {
    select.replaceChildren();for(const entry of entries){const option=el("option",entry.label);option.value=entry.value;select.append(option);}
    select.value=current;
  }
  function controls() {
    $("scope-kind").value=filter.kind;
    options($("scope-filter"),Object.entries(model.scopes[filter.kind]).map(([value,label])=>({value,label})),filter.scope);
    options($("scope-edition"),[{value:"all",label:"All assessment editions"},...model.editions],filter.edition);
    $("scope-edition").disabled=filter.kind==="stations";
    $("scope-search").value=filter.text;$("scope-selected-only").checked=filter.selectedOnly;
  }
  function displayColumns(kind,row) {
    if(kind==="assessments")return [row.site,row.source_vintage,row.assessment_publisher_huc12,
      row.native_station_match?.publisher_huc_raw??"No match in native 705",human(row.publisher_relationship),
      row.original_assessment.cause_label||row.original_assessment.cause_raw,
      row.original_assessment.use+" / "+human(row.original_assessment.use_support)];
    return [row.station_id,String(row.native_feature_id),String(row.publisher_huc_raw??""),
      domain(row.station_publisher_in_selected_domain),String(row.assessment_record_keys.length),
      String(row.original_feature.attributes.COUNTY??""),String(row.original_feature.attributes.DESCRIPT??"")];
  }
  const columns={
    assessments:["Station","Assessment edition","Assessment publisher HUC12","Station publisher HUC","Publisher relationship","Cause","Use / support"],
    stations:["Station","Native feature ID","Original HUC attribute","Publisher domain","Assessment records","County","Original description"]};
  function definition(container,name,value) {
    container.append(el("dt",name));const dd=el("dd");
    if(value&&value.nodeType)dd.append(value);else dd.textContent=value===undefined||value===null?"Not supplied":String(value);
    container.append(dd);
  }
  function sourceLink(uri) {
    if(typeof uri!=="string"||!/^https?:\/\//i.test(uri))return String(uri??"Not supplied");
    const a=el("a",uri);a.href=uri;a.rel="noopener noreferrer";a.target="_blank";return a;
  }
  function detail(kind,id,scroll=true) {
    const index=model.lookup[kind].get(id);if(index===undefined)return;
    active={kind,id};const row=model.groups[kind][index],box=$("scope-detail");box.replaceChildren();
    box.append(el("h3",kind==="assessments"?row.site+" · "+row.source_vintage:row.station_id+" · native feature "+row.native_feature_id));
    const list=el("dl",undefined,"detail-grid");box.append(list);
    if(kind==="assessments"){
      const original=row.original_assessment;
      definition(list,"Original source-bound record",row.record_key);
      definition(list,"Publisher source",sourceLink(original.source_uri||original.original_document_uri));
      definition(list,"Assessment source page",original.source_page);
      definition(list,"Assessment publisher HUC12",row.assessment_publisher_huc12+" · "+domain(row.assessment_publisher_in_selected_domain));
      definition(list,"Native station publisher HUC",row.native_station_match?
        row.native_station_match.publisher_huc_raw+" · "+domain(row.native_station_match.station_publisher_in_selected_domain):"Absent from this native 705 selection");
      definition(list,"Original normalized record",row.normalized_record_pointer+" · SHA256 "+row.normalized_body_sha256);
      if(row.native_station_match){
        const match=row.native_station_match;
        definition(list,"Native source identity",match.source_pointer+" · SHA256 "+match.source_sha256);
        definition(list,"Original coordinates",match.x+", "+match.y+" · "+match.source_crs);
        const button=el("button","Open complete native station feature");button.type="button";
        button.onclick=()=>{filter={...filter,kind:"stations",scope:"all",edition:"all",selectedOnly:false,text:row.site,stationId:row.site};offset=0;controls();render();detail("stations",row.site);};box.append(button);
      }
    }else{
      definition(list,"Original native source",row.source_pointer+" · SHA256 "+row.source_sha256);
      definition(list,"Original HUC attribute",String(row.publisher_huc_raw??"")+" · "+human(row.publisher_huc_status));
      definition(list,"Publisher domain",domain(row.station_publisher_in_selected_domain));
      definition(list,"Original coordinates",row.original_feature.geometry.x+", "+row.original_feature.geometry.y+" · "+row.source_crs);
      definition(list,"Matching records in selected editions",row.assessment_record_keys.length);
      if(row.assessment_record_keys.length){const button=el("button","Review this station's assessment records");button.type="button";
        button.onclick=()=>{filter={...filter,kind:"assessments",scope:"all",edition:"all",selectedOnly:false,text:row.station_id,stationId:row.station_id};offset=0;controls();render();};box.append(button);}
    }
    const full=el("details"),heading=el("summary","Complete original record and source relationships");
    full.append(heading,el("pre",JSON.stringify(row,null,2)));box.append(full);
    if(scroll)box.scrollIntoView({block:"start",behavior:"smooth"});
  }
  function render() {
    const focused=document.activeElement?.id;
    const indices=model.query(filter);
    if(offset>=indices.length&&offset>0){offset=Math.max(0,Math.floor((indices.length-1)/pageSize)*pageSize);}
    const page=indices.slice(offset,offset+pageSize),head=$("scope-head"),body=$("scope-rows");
    head.replaceChildren();const hr=el("tr");hr.append(el("th","Select"));columns[filter.kind].forEach(c=>hr.append(el("th",c)));head.append(hr);body.replaceChildren();
    page.forEach(index=>{
      const row=model.groups[filter.kind][index],id=model.identity(filter.kind,row),tr=el("tr"),td=el("td"),checkbox=el("input");
      checkbox.id="scope-row-"+filter.kind+"-"+index;checkbox.type="checkbox";checkbox.checked=model.selected[filter.kind].has(id);checkbox.setAttribute("aria-label","Select "+(row.site||row.station_id));
      checkbox.onchange=()=>{model.select(filter.kind,[index],checkbox.checked);render();};td.append(checkbox);tr.append(td);
      displayColumns(filter.kind,row).forEach((value,column)=>{const cell=el("td");
        if(column===0){const button=el("button",value,"record-link");button.type="button";button.onclick=()=>detail(filter.kind,id);cell.append(button);}else cell.textContent=value;
        tr.append(cell);});body.append(tr);
    });
    $("scope-counts").textContent=indices.length+" matching "+(filter.kind==="assessments"?"assessment records":"native stations")+" · "+
      model.selected[filter.kind].size+" selected · displaying "+(indices.length?offset+1:0)+"–"+Math.min(offset+pageSize,indices.length);
    $("scope-prev").disabled=offset===0;$("scope-next").disabled=offset+pageSize>=indices.length;
    $("scope-export-json").disabled=$("scope-export-csv").disabled=model.selected[filter.kind].size===0;
    $("scope-empty").hidden=indices.length>0;
    if(focused?.startsWith("scope-row-"))$(focused)?.focus({preventScroll:true});
  }
  function download(name,body,mime) {
    const url=URL.createObjectURL(new Blob([body],{type:mime})),link=el("a");link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  function saveReview() {
    const clone=document.documentElement.cloneNode(true);
    clone.querySelector("#scope-state").textContent=JSON.stringify(model.snapshot(reportSha,filter,active)).replaceAll("<","\\u003c");
    clone.querySelector("#scope-interactive").hidden=true;clone.querySelector("#scope-no-script").hidden=false;
    for(const id of ["scope-rows","scope-head","scope-detail","scope-print"])clone.querySelector("#"+id).replaceChildren();
    clone.querySelector("#scope-notice").textContent="";
    download("saved-source-scope-review.html","<!doctype html>\n"+clone.outerHTML,"text/html;charset=utf-8");
  }
  $("scope-kind").onchange=()=>{filter={...filter,kind:$("scope-kind").value,scope:"all",edition:"all",stationId:null};offset=0;controls();render();};
  for(const id of ["scope-search","scope-filter","scope-edition","scope-selected-only"]){
    $(id).addEventListener(id==="scope-search"?"input":"change",()=>{
      filter=model.filters({kind:$("scope-kind").value,text:$("scope-search").value,scope:$("scope-filter").value,
        edition:$("scope-edition").value,selectedOnly:$("scope-selected-only").checked,
        stationId:id==="scope-search"?null:filter.stationId});offset=0;render();
    });
  }
  $("scope-prev").onclick=()=>{offset=Math.max(0,offset-pageSize);render();};
  $("scope-next").onclick=()=>{offset+=pageSize;render();};
  $("scope-select-results").onclick=()=>{model.select(filter.kind,model.query(filter));render();};
  $("scope-clear").onclick=()=>{model.selected[filter.kind].clear();render();};
  $("scope-reset").onclick=()=>{filter=model.filters({kind:filter.kind});offset=0;controls();render();};
  $("scope-export-json").onclick=()=>download("selected-"+filter.kind+".json",JSON.stringify(model.selection(filter.kind,reportSha),null,2)+"\n","application/json");
  $("scope-export-csv").onclick=()=>download("selected-"+filter.kind+".csv",model.csv(filter.kind),"text/csv;charset=utf-8");
  $("scope-save").onclick=saveReview;
  $("scope-print-button").onclick=()=>{
    const box=$("scope-print");box.replaceChildren();box.append(el("h2","Current source review: "+human(filter.kind)),
      el("p",JSON.stringify(filter)));const table=el("table"),head=el("thead"),hr=el("tr"),body=el("tbody");
    columns[filter.kind].forEach(c=>hr.append(el("th",c)));head.append(hr);
    model.query(filter).forEach(i=>{const tr=el("tr");displayColumns(filter.kind,model.groups[filter.kind][i]).forEach(v=>tr.append(el("td",v)));body.append(tr);});
    table.append(head,body);box.append(table);window.print();
  };
  document.querySelectorAll("[data-scope-preset]").forEach(button=>button.onclick=()=>{
    filter=model.filters({kind:button.dataset.scopeKind||"assessments",scope:button.dataset.scopePreset});offset=0;controls();render();$("scope-interactive").scrollIntoView({block:"start"});});
  try{const state=JSON.parse($("scope-state").textContent);filter=model.restore(state,reportSha);active=state?.active||null;}
  catch(error){$("scope-notice").textContent=error.message+" The complete original source report remains available.";}
  controls();render();if(active)detail(active.kind,active.id,false);
  $("scope-interactive").hidden=false;$("scope-no-script").hidden=true;
}

export function renderSourceScopeReport(result, nativePublisher = null) {
  const s=result.summary,reportJson=JSON.stringify(result)+"\n",reportSha=codec.sha256(codec.utf8Encode(reportJson));
  createSourceScopeReviewModel(result);
  const byKey=new Map(result.assessments.map(r=>[r.record_key,r]));
  const byStation=new Map(result.stations.map(r=>[r.station_id,r]));
  const table=(headers,rows)=>'<div class="table"><table><thead><tr>'+headers.map(h=>"<th>"+esc(h)+"</th>").join("")+
    "</tr></thead><tbody>"+rows.map(row=>"<tr>"+row.map(v=>"<td>"+esc(v)+"</td>").join("")+"</tr>").join("")+"</tbody></table></div>";
  const diffs=table(["Station / edition","Assessment publisher HUC12","Station publisher HUC12","Assessment county","Station county","Assessment source page"],
    result.differing_record_keys.map(key=>{const r=byKey.get(key);return [r.site+" / "+r.source_vintage,r.assessment_publisher_huc12,
      r.native_station_match.publisher_huc_raw,r.original_assessment.county,byStation.get(r.site).original_feature.attributes.COUNTY,r.original_assessment.source_page];}));
  const attrs=table(["Station","Native feature ID","Exact original HUC attribute","Native source pointer"],
    result.invalid_native_huc_station_ids.map(id=>{const r=byStation.get(id);return[id,r.native_feature_id,r.publisher_huc_raw,r.source_pointer];}));
  const cards=[["assessments","all",s.statewide_assessment_records,"Statewide assessment records"],["stations","all",s.native_station_count,"Original native stations"],
    ["assessments","native_match",s.matched_assessment_records,"Records associated with native stations"],["stations","with_assessments",s.matched_native_stations,"Native stations with assessment records"],
    ["assessments","selected_domain",s.selected_domain_assessment_records,"Assessment records in selected HUC domain"],
    ["assessments","inside_unmatched",s.selected_domain_assessment_records-s.selected_domain_native_matched_records,"Selected-domain records absent from this native selection"]];
  const controls='<section id="scope-review"><h2>Explore complete original sources</h2><p id="scope-notice" role="status"></p>'+
    '<p id="scope-no-script">The complete data files and source comparison tables are available below. Enable JavaScript for source search, record drilldown, selections and exports.</p>'+
    '<div id="scope-interactive" hidden><div class="controls">'+
    '<label>Record type<select id="scope-kind"><option value="assessments">Statewide assessments</option><option value="stations">Native station features</option></select></label>'+
    '<label>Source scope<select id="scope-filter"></select></label><label>Search original fields<input type="search" id="scope-search" placeholder="Station, HUC, county, cause or description"></label>'+
    '<label>Assessment edition<select id="scope-edition"></select></label></div><p><label><input type="checkbox" id="scope-selected-only"> Show selected records only</label></p>'+
    '<div class="actions"><button id="scope-select-results" type="button">Select all current results</button><button id="scope-clear" type="button">Clear this selection</button>'+
    '<button id="scope-reset" type="button">Reset filters</button></div><p id="scope-counts" role="status" aria-live="polite"></p>'+
    '<div class="table"><table><thead id="scope-head"></thead><tbody id="scope-rows"></tbody></table></div><p id="scope-empty" hidden>No source records match these filters.</p>'+
    '<div class="actions"><button id="scope-prev" type="button">Previous 100</button><button id="scope-next" type="button">Next 100</button>'+
    '<button id="scope-export-json" type="button" disabled>Export selected JSON</button><button id="scope-export-csv" type="button" disabled>Export selected CSV</button>'+
    '<button id="scope-save" type="button">Save complete review HTML</button><button id="scope-print-button" type="button">Print current results</button></div>'+
    '<p class="muted">Selections remain when filters change. JSON and CSV exports include complete original records and source relationships. CSV protects formula-like text; finite negative coordinates remain unchanged.</p>'+
    '<section id="scope-detail" aria-label="Original source record"></section></div></section>';
  const payload=JSON.stringify({source_report_sha256:reportSha,result}).replaceAll("<","\\u003c").replaceAll("\u2028","\\u2028").replaceAll("\u2029","\\u2029");
  const script=createSourceScopeReviewModel.toString()+"\n("+sourceScopeBrowser.toString()+")();";
  const hash=codec.base64Encode(new Uint8Array(codec.sha256(codec.utf8Encode(script)).match(/../g).map(v=>parseInt(v,16))));
  const style='body{font:15px/1.5 system-ui,sans-serif;color:#222;background:#fff;max-width:1380px;margin:32px auto;padding:0 24px}h1,h2{line-height:1.2}h2{margin-top:2rem}a{color:inherit}'+
    'button,input,select{font:inherit;color:inherit;background:#fff;border:1px solid #888;border-radius:2px;padding:9px}button{cursor:pointer}button:disabled{color:#777;cursor:default}button:hover{background:#eee}'+
    '.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.cards button{text-align:left;padding:16px}.cards strong{display:block;font-size:25px}.controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.controls label{display:flex;flex-direction:column;gap:5px;font-weight:600}'+
    '.actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.table{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #bbb;padding:9px;text-align:left;vertical-align:top}th{background:#eee}'+
    '.record-link{border:0;background:none;text-decoration:underline;padding:0;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.detail-grid{display:grid;grid-template-columns:minmax(180px,1fr) 3fr;gap:8px 16px}.detail-grid dt{font-weight:600}.detail-grid dd{margin:0;overflow-wrap:anywhere}'+
    '#scope-detail:not(:empty){border:1px solid #aaa;padding:18px;margin-top:18px}details{margin-top:14px}.muted{color:#555}[hidden]{display:none!important}#scope-print{display:none}:focus-visible{outline:2px solid #222;outline-offset:3px}input[type=checkbox]{accent-color:#333}'+
    '@media(max-width:700px){.cards,.controls{grid-template-columns:1fr}.detail-grid{display:block}.detail-grid dt{margin-top:10px}}@media print{.cards,.controls,.actions,#scope-review{display:none!important}#scope-print{display:block}.table{overflow:visible}tr{break-inside:avoid}thead{display:table-header-group}body{margin:0;max-width:none}table{font-size:9pt}}';
  const downloads=["assessment-station-source-audit.json","source-audit-summary.json","all-statewide-assessment-source-associations.csv","publisher-huc-differences.csv","all-native-station-source-coverage.csv","report-artifacts.json","sources.json"];
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'sha256-'+hash+'\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">'+
    "<title>"+esc(result.title)+"</title><style>"+style+"</style></head><body><h1>"+esc(result.title)+"</h1>"+
    "<p>This review compares the complete original Savannah native station selection with two complete statewide assessment editions. Each source retains its original record identity, publisher HUC and coordinates.</p>"+
    '<div class="cards">'+cards.map(([kind,scope,count,label])=>'<button type="button" data-scope-kind="'+kind+'" data-scope-preset="'+scope+'"><strong>'+esc(count)+"</strong>"+esc(label)+"</button>").join("")+"</div>"+
    "<h2>Understand the source selections</h2><p>The native source contains 705 features selected by its publisher's Savannah basin attribute. The statewide assessment editions contain 1,516 published 2024 records and 813 July 2026 records. Exact station identifiers associate 246 assessment records with 209 of these native features. The remaining 496 features have no matching record in these two assessment editions; that count describes coverage of these selected sources and does not determine water quality.</p>"+
    "<p>The selected 217-HUC assessment domain contains 192 records. Of these, 182 match this native 705 selection. The original 192-record review covers 159 sites and also joins the separately retained WQP station sources and keeps their reported HUC8 level where that is what the source supplies. This whole-source review identifies absence from one source selection; it preserves every original assessment.</p>"+
    '<p><a href="'+fixedReport+'">Open the complete fixed 192-record programme association report and portable ZIP</a>.</p>'+
    table(["Assessment publisher domain / station publisher domain","Matched records"],Object.entries(s.publisher_domain_quadrants).map(([key,count])=>[key,count]))+
    "<p>SV-192 contributes the one assessment-outside / station-inside record. Its July 2026 assessment publisher HUC is outside the selected domain; its native station publisher HUC is inside. SV-686 is the differing 2024 record whose two publisher HUCs are both outside the selected domain. Records outside both publisher domains remain available in this full source review.</p>"+
    '<h2>Every differing publisher HUC12</h2>'+diffs+
    '<p><button type="button" data-scope-preset="different">Review all differing source records</button></p>'+
    '<h2>Original native HUC attributes requiring source interpretation</h2>'+attrs+
    "<p>These two original attributes contain 11 digits. Their exact strings and native coordinates remain retained; they are available under the station source-scope filter.</p>"+
    '<p><button type="button" data-scope-kind="stations" data-scope-preset="huc_unreported">Inspect the original native features</button></p>'+
    controls+'<section id="scope-print"></section><h2>Files and original source identities</h2><ul>'+
    downloads.map(name=>'<li><a href="'+name+'">'+name+"</a></li>").join("")+"</ul><pre>"+esc(json({source_selection:result.source_selection,inputs:result.inputs}))+
    "</pre>"+(nativePublisher?"<h2>Original native publisher and retrieval</h2><pre>"+esc(json(nativePublisher))+"</pre>":"")+"<h2>Interpretation</h2><ul>"+result.interpretation.map(text=>"<li>"+esc(text)+"</li>").join("")+"</ul>"+
    '<script id="scope-data" type="application/json">'+payload+'</script><script id="scope-state" type="application/json">null</script><script>'+script+"</script></body></html>\n";
}

export function composeSourceScopeReport(audit, originalInputs) {
  const result=audit.result,files={...audit.files};
  if(files["assessment-station-source-audit.json"]!==JSON.stringify(result)+"\n")throw Error("Choose the exact complete audit output.");
  for(const [name,expected] of Object.entries({...result.inputs,...SOURCE_SCOPE_COMPANIONS})){
    const source=originalInputs[name];if(typeof source!=="string")throw Error("Missing original source: "+name);
    const path=expected.path,descriptor=identity(path,source);
    if(descriptor.bytes!==expected.bytes||descriptor.sha256!==expected.sha256)throw Error("Original source identity differs: "+name);
    if(files[path]!==undefined&&files[path]!==source)throw Error("Original source member names collide.");
    files[path]=source;
  }
  files["OPEN_SOURCE_SCOPE.html"]=renderSourceScopeReport(result, {
    manifest:JSON.parse(originalInputs.stationManifest),provenance:JSON.parse(originalInputs.stationProvenance),
    count_response:SOURCE_SCOPE_COMPANIONS.stationCountResponse
  });
  const reportIdentity=identity("assessment-station-source-audit.json",files["assessment-station-source-audit.json"]);
  const sourceId="assessment-source-scope-"+reportIdentity.sha256.slice(0,20);
  files["report-artifacts.json"]=json({schema:"commons.artifacts/v1",source_id:sourceId,
    files:Object.entries(files).map(([path,body])=>identity(path,body))});
  const document=identity("OPEN_SOURCE_SCOPE.html",files["OPEN_SOURCE_SCOPE.html"]);
  const manifest={schema:"upstate.sources/v1",title:result.title,entries:[{
    id:sourceId,title:result.title,kind:"document",role:"WATER_QUALITY_SOURCE_SCOPE_REPORT",vintage:result.vintage,
    uri:"https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/opportunities/upstate_forever_2026",
    ...document,description:"Complete original native station and statewide assessment source-scope review.",
    companions:Object.entries(files).filter(([path])=>path!==document.path).map(([path,body])=>identity(path,body))
  }]};
  files["sources.json"]=json(manifest);
  const archiveBody=zipReportFiles(files,{compress:true});
  const archive={path:"source-scope-report.zip",bytes:archiveBody.length,sha256:codec.sha256(archiveBody)};
  manifest.entries[0].companions.push(archive);
  files[archive.path]=archiveBody;files["sources.json"]=json(manifest);
  return {result,files,sourceId,archive};
}
