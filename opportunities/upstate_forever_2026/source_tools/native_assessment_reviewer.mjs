// Native station coverage review over completed original membership outputs.
import { createArchiveCodec } from "./archive_codec.mjs";


export function annualReferenceInterpretation(annual) {
  if (annual?.schema !== "upstate.annual-reference-assessment-context/v1" ||
      !Array.isArray(annual.basins) || !Array.isArray(annual.basin_overlaps))
    throw Error("Choose the completed original annual-reference context.");
  const period=annual.method?.source_global_target_period;
  if (!period || !/^\d{4}-\d{2}-\d{2}$/.test(period.start) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(period.end_exclusive) ||
      period.start >= period.end_exclusive || !Number.isInteger(period.reference_year))
    throw Error("Retain the annual source-global reference horizon.");
  const rows=[], basins=new Map(), keys=new Set();
  const definitions={
    nitrogen:{field:"ACTUAL",unit:"kg/year",yield_unit:"kg/ha/year",basis:"Total nitrogen",code:"00600"},
    phosphorus:{field:"ACTUAL",unit:"kg/year",yield_unit:"kg/ha/year",basis:"Total phosphorus",code:"00665"},
    sediment:{field:"ACTUAL_MT",unit:"metric_tonnes/year",yield_unit:"metric_tonnes/ha/year"},
  };
  const finite=value=>typeof value==="number"&&Number.isFinite(value);
  for (const basin of annual.basins) {
    const comid=String(basin.comid), area=basin.selected_basin_area_km2;
    if (!/^\d+$/.test(comid) || basins.has(comid) || !finite(area) || area<=0 ||
        !Array.isArray(basin.targets) || !Array.isArray(basin.original_target_station_names) ||
        !/^[a-f0-9]{64}$/.test(basin.basin_source_sha256||"") ||
        !Array.isArray(basin.selected_component_indices) || !basin.selected_component_indices.length ||
        basin.selected_component_indices.some(x=>!Number.isInteger(x)||x<0) ||
        new Set(basin.selected_component_indices).size!==basin.selected_component_indices.length)
      throw Error("Annual catchment identity, whole-polygon area or component selection is invalid.");
    basins.set(comid,basin);
    for (const target of basin.targets) {
      const d=definitions[target.parameter], original=target.original;
      if (!d || target.field!==d.field || target.unit!==d.unit || !original ||
          String(original.COMID)!==comid || original[d.field]!==target.value ||
          !finite(target.value) || target.value<0 || !Number.isInteger(original.OBJECTID) ||
          !/^[a-f0-9]{64}$/.test(target.source_sha256||"") ||
          !/^[A-Za-z0-9_.-]+$/.test(target.source_member||""))
        throw Error("Annual target does not retain its original source field, unit or record.");
      const key=JSON.stringify([target.source_member,original.OBJECTID,comid,target.parameter]);
      if (keys.has(key)) throw Error("Original annual target is repeated.");
      keys.add(key);
      const constituent=target.parameter==="sediment"?String(original.CONSTITUEN||"").trim():d.basis;
      if (!constituent) throw Error("Retain the original sediment constituent.");
      const sedimentCode=constituent.toUpperCase()==="TSS"?"00530":
        ["SSC","SS"].includes(constituent.toUpperCase())?"80154":null;
      const areaHa=area*100, value=target.value/areaHa;
      if (!finite(areaHa)||!finite(value)) throw Error("Annual reference yield is nonfinite.");
      rows.push({
        comid,station_id:String(original.STATION_ID||""),station_name:String(original.STATION_NM||""),
        parameter:target.parameter,reference_basis:constituent,
        parameter_code:d.code||sedimentCode,source_field:target.field,
        annual_reference_mass:target.value,annual_mass_unit:target.unit,
        whole_catchment_area_km2:area,whole_catchment_area_ha:areaHa,
        annual_reference_yield:value,yield_unit:d.yield_unit,
        period_start:period.start,period_end_exclusive:period.end_exclusive,
        reference_base_year:period.reference_year,period_scope:"source_global",
        station_sampling_period:"Not exposed in this regional source",
        estimator:"Published regional long-term average annual calibration target",
        source_member:target.source_member,source_sha256:target.source_sha256,
        source_uri:target.source_uri,original_record_id:original.OBJECTID,
        basin_source_sha256:basin.basin_source_sha256,basin_source_uri:basin.basin_source_uri,
        selected_component_indices:[...basin.selected_component_indices],
        source_coefficient_TSS_CONV:original.TSS_CONV??null,coefficient_applied:false,
        original_attributes:original,
      });
    }
  }
  if (basins.size!==annual.summary?.basins || rows.length!==annual.summary?.targets)
    throw Error("Annual reference count differs from the completed original context.");
  const pairs=new Set();
  for (const relation of annual.basin_overlaps) {
    const a=basins.get(String(relation.first_comid)), b=basins.get(String(relation.second_comid));
    const key=[relation.first_comid,relation.second_comid].map(String).sort().join("/");
    if (!a||!b||a===b||pairs.has(key)||!finite(relation.intersection_area_km2) ||
        relation.intersection_area_km2<0 ||
        relation.intersection_area_km2>Math.min(a.selected_basin_area_km2,b.selected_basin_area_km2)*(1+1e-10))
      throw Error("Retain the original complete catchment-pair relationships.");
    pairs.add(key);
  }
  if(pairs.size!==basins.size*(basins.size-1)/2)
    throw Error("Original annual catchment relationship table is incomplete.");
  return {
    schema:"upstate.annual-reference-yield-interpretation/v1",
    edition:"original-annual-reference-yields-20261013-v1",
    original_input_sha256:annual.input_sha256,original_source_commit:annual.source_commit,
    reference_period:{...period,scope:"source_global",station_sampling_period:"Not exposed in this regional source"},
    area_definition:"Complete retained source-basin polygon components, EPSG:5070 square kilometres multiplied by 100; not raster coverage or publisher gage drainage area.",
    yield_definition:"Original published annual reference mass divided by the same complete source-basin hectares.",
    method:{
      area_crs:"EPSG:5070",native_mass_available:false,
      coefficient_application:"None; original TSS_CONV is retained as source context only.",
      comparability:"Area normalization preserves the original constituent and source-global temporal support. TSS is not SSC. A source reference yield is not an InVEST prediction or incremental/downstream-delivered yield.",
      dependence:"Original overlaps and containment remain attached. Nested whole-basin totals are not independent or additive.",
      uncertainty:"Reporting precision is retained; this regional source does not supply target standard errors or station-specific sampling horizons.",
      source_method_uri:"https://water.usgs.gov/nawqa/sparrow/FAQs/faq.html",
    },
    rows,relationships:annual.basin_overlaps,
    original_coordinate_operations:annual.coordinate_operations,
    original_runtime:annual.runtime,
  };
}

export function annualReferenceCsv(interpretation, relationships=false) {
  const fields=relationships?
    ["first_comid","second_comid","intersection_area_km2","first_area_fraction","second_area_fraction","first_covers_second","second_covers_first"]:
    ["comid","station_id","station_name","parameter","reference_basis","parameter_code",
     "annual_reference_mass","annual_mass_unit","whole_catchment_area_km2","whole_catchment_area_ha",
     "annual_reference_yield","yield_unit","period_start","period_end_exclusive","reference_base_year",
     "period_scope","station_sampling_period","estimator","source_field","source_member","source_sha256",
     "source_uri","original_record_id","basin_source_sha256","basin_source_uri",
     "selected_component_indices","source_coefficient_TSS_CONV","coefficient_applied"];
  const quoted=value=>'"'+String(value===null||value===undefined?"":typeof value==="object"?JSON.stringify(value):value).replaceAll('"','""')+'"';
  const rows=relationships?interpretation.relationships:interpretation.rows;
  return [fields.map(quoted).join(","),...rows.map(row=>fields.map(k=>quoted(row[k])).join(","))].join("\n")+"\n";
}

function annualReferenceHtml(annual, esc) {
  if (!annual) return "";
  const result=annualReferenceInterpretation(annual);
  const display=(n,d=4)=>Number(n).toLocaleString("en-US",{maximumFractionDigits:d});
  const groups=[...new Set(result.rows.map(r=>r.parameter+"/"+r.reference_basis))];
  const tables=groups.map(group=>{
    const rows=result.rows.filter(r=>r.parameter+"/"+r.reference_basis===group),first=rows[0];
    return "<h3>"+esc(first.reference_basis)+"</h3><div class=\"table\"><table><caption>"+
      esc("Original annual mass ("+first.annual_mass_unit+"); whole-basin yield ("+first.yield_unit+")")+
      "</caption><thead><tr><th>Original annual reference</th><th>Whole basin (ha)</th><th>Annual mass</th><th>Annual yield</th></tr></thead><tbody>"+
      rows.map(r=>"<tr><td>"+esc(r.station_name)+"<br><span class=\"muted\">COMID "+esc(r.comid)+
        "</span></td><td>"+esc(display(r.whole_catchment_area_ha,2))+"</td><td>"+
        esc(display(r.annual_reference_mass,2))+"</td><td>"+esc(display(r.annual_reference_yield,6))+"</td></tr>").join("")+
      "</tbody></table></div>";
  }).join("");
  return '<section id="annual-reference-yields"><h2>Original annual loads per whole-catchment hectare</h2>'+
    "<p>These "+result.rows.length+" source targets use their original five basin polygons. The denominator is the complete selected basin area, not raster cells or the selected South Carolina assessment area. Raw source masses remain visible beside the derived yields.</p>"+
    "<p>Reference year "+esc(result.reference_period.reference_year)+"; source-global horizon "+esc(result.reference_period.start)+
    " to "+esc(result.reference_period.end_exclusive)+" (end exclusive). Individual station sampling periods are not exposed by this release.</p>"+
    tables+"<p>Raw TSS stays separate from SSC and from the regional method-conversion sensitivity source. No conversion coefficient is applied here. The three tributaries and nested downstream basins retain their original relationships; these whole-basin totals must not be added as independent regional parts.</p>"+
    '<p><a href="annual-reference-yields.csv">All original-reference yields and source periods (CSV)</a> · '+
    '<a href="annual-reference-yields.json">Full source and denominator context (JSON)</a> · '+
    '<a href="annual-reference-relations.csv">All ten original catchment relationships (CSV)</a></p></section>';
}

export function createNativeCoverageModel(context, annual) {
  if (context?.schema !== "upstate.assessment-native-huc-context/v1" || !Array.isArray(context.stations))
    throw Error("Choose the completed native assessment context.");
  const stations=context.stations, byId=new Map(stations.map(row=>[row.station_id,row]));
  if (byId.size!==stations.length) throw Error("Native station identities repeat.");
  const basins=annual?.basins||[];
  if (annual && (annual.schema!=="upstate.annual-reference-assessment-context/v1" ||
      annual.input_sha256!==context.input_sha256)) throw Error("Annual and native contexts differ.");
  for (const basin of basins)
    if (!Array.isArray(basin.assessment_station_ids) ||
        basin.assessment_station_ids.some(id=>!byId.has(id)))
      throw Error("Annual station membership is outside the native cohort.");
  const memberships=new Map(stations.map(row=>[row.station_id,
    basins.filter(basin=>basin.assessment_station_ids.includes(row.station_id))]));
  const selected=new Set();
  const defaults={text:"",utility:"all",basin:"all",relationship:"all",selectedOnly:false};
  const sourceKey=JSON.stringify([context.input_sha256,context.domain_zip_sha256,
    stations.map(row=>[row.station_id,row.native_location.source_body_sha256,row.native_location.native_id])]);
  function filters(value={}) {
    const f={...defaults,...value};
    if (typeof f.text!=="string" || typeof f.selectedOnly!=="boolean" ||
        !["all","ARJWS","PRWD","either","none"].includes(f.utility) ||
        !["all","difference","huc8"].includes(f.relationship) ||
        !["all",...basins.map(row=>String(row.comid))].includes(f.basin))
      throw Error("Unsupported native coverage filter.");
    return f;
  }
  function query(value={}) {
    const f=filters(value), words=f.text.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return stations.filter(row=>{
      const u=row.utility_membership, inside=Object.values(u).some(x=>x.covered);
      if (f.utility==="either"&&!inside || f.utility==="none"&&inside ||
          ["ARJWS","PRWD"].includes(f.utility)&&!u[f.utility]?.covered) return false;
      if (f.basin!=="all"&&!memberships.get(row.station_id).some(x=>String(x.comid)===f.basin)) return false;
      if (f.relationship==="difference"&&!row.assessment_records.some(x=>x.geometry_relation==="differs_from_geometry")) return false;
      if (f.relationship==="huc8"&&row.native_location.station_publisher_huc12) return false;
      if (f.selectedOnly&&!selected.has(row.station_id)) return false;
      const haystack=[row.station_id,row.native_location.source_id,row.native_location.native_id,
        row.native_location.station_publisher_huc12,row.native_location.station_publisher_huc8,
        ...row.matches.flatMap(x=>[x.huc12,x.name]),...row.assessment_records.flatMap(x=>[
          x.publisher_huc12,x.source_vintage,x.cause_label,x.cause_family,x.use_support])].join(" ").toLowerCase();
      return words.every(word=>haystack.includes(word));
    });
  }
  function toggle(id,value) {
    if (!byId.has(id)) throw Error("Unknown original native station.");
    if (value) selected.add(id); else selected.delete(id);
  }
  function state(binding,filterValue,active=null) {
    return {schema:"upstate.native-assessment-review/v1",binding,source_key:sourceKey,
      filters:filters(filterValue),selected_station_ids:stations.filter(x=>selected.has(x.station_id)).map(x=>x.station_id),
      active_station_id:active};
  }
  function restore(saved,binding) {
    if (saved?.schema!=="upstate.native-assessment-review/v1" || saved.binding!==binding ||
        saved.source_key!==sourceKey || !Array.isArray(saved.selected_station_ids) ||
        saved.selected_station_ids.some(id=>!byId.has(id)) ||
        new Set(saved.selected_station_ids).size!==saved.selected_station_ids.length ||
        saved.active_station_id!==null&&!byId.has(saved.active_station_id))
      throw Error("Saved native review belongs to another original source edition.");
    const f=filters(saved.filters);
    selected.clear();for (const id of saved.selected_station_ids) selected.add(id);
    return {filters:f,active:saved.active_station_id};
  }
  function selection(binding,filterValue,active=null) {
    return {schema:"upstate.native-assessment-selection/v1",binding,
      native_context:{schema:context.schema,input_sha256:context.input_sha256,domain_zip_sha256:context.domain_zip_sha256,
        domain_member:context.domain_member,method:context.method,runtime:context.runtime},
      annual_context:annual?{schema:annual.schema,input_sha256:annual.input_sha256,method:annual.method}:null,
      review:state(binding,filterValue,active),stations:stations.filter(row=>selected.has(row.station_id)).map(row=>({
        original_native_station:row,
        annual_reference_memberships:memberships.get(row.station_id).map(basin=>({
          comid:basin.comid,names:basin.original_target_station_names,basin_source_uri:basin.basin_source_uri,
          basin_source_sha256:basin.basin_source_sha256,selected_component_indices:basin.selected_component_indices,
          original_targets:basin.targets})),
      }))};
  }
  return {stations,byId,basins,memberships,selected,filters,query,toggle,state,restore,selection};
}

function nativeCoverageBrowser() {
  const el=id=>document.getElementById(id), payload=JSON.parse(el("native-review-data").textContent);
  const model=createNativeCoverageModel(payload.context,payload.annual), binding=payload.binding;
  const controls={text:el("native-search"),utility:el("native-utility"),basin:el("native-basin"),
    relationship:el("native-relationship"),selectedOnly:el("native-selected-only")};
  let active=null;
  function options(control,values) {
    control.replaceChildren();
    for (const [value,label] of values) {const option=document.createElement("option");option.value=value;option.textContent=label;control.append(option);}
  }
  options(controls.utility,[["all","All physical utility coverage"],["ARJWS","Inside ARJWS"],["PRWD","Inside PRWD"],
    ["either","Inside either utility"],["none","Outside both utility selections"]]);
  options(controls.relationship,[["all","All original publisher assignments"],["difference","Assessment publisher differs from geometry"],
    ["huc8","Station publisher supplies HUC8 only"]]);
  options(controls.basin,[["all",payload.annual?"All annual-reference catchments":"Annual context not attached"],...model.basins.map(row=>[String(row.comid),
    row.comid+" · "+row.original_target_station_names.join("; ")])]);
  controls.basin.disabled=!model.basins.length;
  function current() {return Object.fromEntries(Object.entries(controls).map(([key,value])=>[key,key==="selectedOnly"?value.checked:value.value]));}
  function apply(f) {for (const [key,value] of Object.entries(f)) key==="selectedOnly"?controls[key].checked=value:controls[key].value=value;}
  const saved=JSON.parse(el("native-review-state").textContent);
  if (saved) {
    try {const restored=model.restore(saved,binding);apply(restored.filters);active=restored.active;}
    catch(error) {el("native-notice").textContent=error.message;}
  }
  function number(value) {return Number(value).toLocaleString("en-US",{maximumFractionDigits:2});}
  function line(parent,tag,value,className) {
    const node=document.createElement(tag);node.textContent=value;if(className)node.className=className;parent.append(node);return node;
  }
  function linkAssessment(stationId) {
    const search=el("association-search");
    if (!search) return;
    for (const id of ["association-comparison","association-edition","association-programme"])el(id).value="all";
    el("association-selected-only").checked=false;search.value=stationId;
    search.dispatchEvent(new Event("input",{bubbles:true}));
    el("association-reviewer").scrollIntoView({block:"start"});search.focus();
  }
  function details(id) {
    const container=el("native-detail");container.replaceChildren();
    if (!id) {line(container,"p","Open a station to compare its original coordinates, physical coverage and assessment editions.");return;}
    const row=model.byId.get(id), native=row.native_location, dl=document.createElement("dl");dl.className="review-details";
    line(container,"h3",id+" · native coverage");
    function add(label,value){line(dl,"dt",label);line(dl,"dd",value);}
    add("Original coordinate source",native.source_id+" · feature "+native.native_id);
    add("Original body SHA256",native.source_body_sha256);
    add("Original coordinates / CRS",native.native_coordinates.join(", ")+" · "+native.native_crs);
    add("Station publisher watershed",native.station_publisher_huc12||"HUC8 "+native.station_publisher_huc8+"; HUC12 unreported");
    add("Containing original watershed",row.matches.map(x=>x.huc12+" · "+x.name+" · "+x.membership).join("; "));
    add("Inside watershed boundary",row.matches.map(x=>number(x.distance_to_boundary_m)+" m").join("; "));
    for (const [utility,value] of Object.entries(row.utility_membership))
      add(utility+" physical selection",(value.covered?"Inside":"Outside")+" · "+number(value.distance_to_outer_boundary_m)+" m from outer boundary");
    add("Annual catchments",payload.annual?(model.memberships.get(id).map(x=>x.comid+" · "+x.original_target_station_names.join("; ")).join("; ")||"Outside the selected annual catchments"):"Annual context not attached");
    add("Assessment editions",row.assessment_records.map(x=>x.source_vintage+" · "+x.cause_label+" · "+x.use_support+
      " · publisher "+x.publisher_huc12+" · "+x.geometry_relation).join("\n"));
    container.append(dl);
    const button=line(container,"button","Review this station's original assessment records");button.type="button";
    button.addEventListener("click",()=>linkAssessment(id));
    const disclosure=document.createElement("details");line(disclosure,"summary","Complete retained native station result");
    line(disclosure,"pre",JSON.stringify(row,null,2));container.append(disclosure);
  }
  function render() {
    const focused=document.activeElement?.id, f=current(), rows=model.query(f), body=el("native-rows");body.replaceChildren();
    for (const row of rows) {
      const tr=document.createElement("tr"), first=document.createElement("td"), label=document.createElement("label");
      const input=document.createElement("input");input.type="checkbox";input.id="native-select-"+row.station_id;
      input.checked=model.selected.has(row.station_id);input.setAttribute("aria-label","Select native station "+row.station_id);
      input.addEventListener("change",()=>{model.toggle(row.station_id,input.checked);render();});
      label.append(input);first.append(label);tr.append(first);
      const station=document.createElement("td"), button=line(station,"button",row.station_id,"review-row-link");
      button.type="button";button.id="native-open-"+row.station_id;
      button.addEventListener("click",()=>{active=row.station_id;render();el("native-detail").scrollIntoView({block:"nearest"});});
      line(station,"small",row.assessment_records.length+" original assessment records");tr.append(station);
      const geographic=document.createElement("td");line(geographic,"span",row.matches.map(x=>x.huc12+" · "+x.name).join("; "));
      line(geographic,"small",row.matches.map(x=>number(x.distance_to_boundary_m)+" m inside boundary").join("; "));tr.append(geographic);
      const publisher=document.createElement("td");publisher.textContent=row.native_location.station_publisher_huc12||
        "HUC8 "+row.native_location.station_publisher_huc8+"; HUC12 unreported";tr.append(publisher);
      const utilities=document.createElement("td");utilities.textContent=Object.entries(row.utility_membership).filter(([,x])=>x.covered).map(([name])=>name).join("; ")||"Outside both";tr.append(utilities);
      const annual=document.createElement("td");annual.textContent=payload.annual?(model.memberships.get(row.station_id).map(x=>x.comid).join("; ")||"Outside selected catchments"):"Context not attached";tr.append(annual);body.append(tr);
    }
    el("native-counts").textContent=rows.length+" visible stations · "+rows.reduce((n,row)=>n+row.assessment_records.length,0)+
      " original assessment records · "+model.selected.size+" selected stations across filters";
    el("native-empty").hidden=rows.length>0;
    for(const id of ["native-export-json","native-export-csv"])el(id).disabled=model.selected.size===0;
    el("native-review-state").textContent=JSON.stringify(model.state(binding,f,active)).replaceAll("<","\\u003c");
    details(active);
    if(focused)document.getElementById(focused)?.focus({preventScroll:true});
  }
  function download(name,body,type) {
    const url=URL.createObjectURL(new Blob([body],{type})),a=document.createElement("a");a.href=url;a.download=name;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function csvCell(value) {
    let s=String(value??""),trimmed=s.replace(/^[ \t\r\n]+/,"");
    if (/^[=+@]/.test(trimmed)||(trimmed.startsWith("-")&&!/^-(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed))||/^[\t\r\n]/.test(s))s="'"+s;
    return '"'+s.replaceAll('"','""')+'"';
  }
  function csv() {
    const columns=["station_id","native_source_id","native_source_sha256","native_feature_id","native_crs","native_x","native_y",
      "station_publisher_huc12","station_publisher_huc8","geometry_huc12s","utility_memberships","annual_comids","assessment_records"];
    const rows=model.stations.filter(row=>model.selected.has(row.station_id)).map(row=>{
      const n=row.native_location;return [row.station_id,n.source_id,n.source_body_sha256,n.native_id,n.native_crs,
        ...n.native_coordinates,n.station_publisher_huc12,n.station_publisher_huc8,row.geometry_huc12s.join(";"),
        Object.entries(row.utility_membership).filter(([,v])=>v.covered).map(([k])=>k).join(";"),
        model.memberships.get(row.station_id).map(x=>x.comid).join(";"),JSON.stringify(row.assessment_records)];
    });
    return [columns,...rows].map(row=>row.map(csvCell).join(",")).join("\r\n")+"\r\n";
  }
  for (const [key,control] of Object.entries(controls))control.addEventListener(key==="text"?"input":"change",render);
  el("native-select-visible").addEventListener("click",()=>{for(const row of model.query(current()))model.toggle(row.station_id,true);render();});
  el("native-clear-selection").addEventListener("click",()=>{model.selected.clear();render();});
  el("native-reset").addEventListener("click",()=>{apply(model.filters());render();});
  el("native-export-json").addEventListener("click",()=>download("native-assessment-selection.json",
    JSON.stringify(model.selection(binding,current(),active),null,2)+"\n","application/json"));
  el("native-export-csv").addEventListener("click",()=>download("native-assessment-selection.csv",csv(),"text/csv"));
  el("native-save").addEventListener("click",()=>el("association-save-review").click());
  el("native-print").addEventListener("click",()=>window.print());
  el("native-interactive").hidden=false;el("native-fallback").classList.add("native-print-only");
  render();
}

export function renderNativeAssessmentReviewer({result,context,annual=null,html}) {
  const model=createNativeCoverageModel(context,annual), codec=createArchiveCodec();
  if (typeof html!=="string"||!html.includes('<section id="association-reviewer">'))
    throw Error("Compose native coverage with the maintained assessment reviewer.");
  const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const binding=codec.sha256(codec.utf8Encode(JSON.stringify({context,annual,report:result})+"\n"));
  const tableRows=model.stations.map(row=>"<tr><td>"+esc(row.station_id)+"</td><td>"+
    esc(row.matches.map(x=>x.huc12+" · "+x.name).join("; "))+"</td><td>"+
    esc(row.native_location.station_publisher_huc12||"HUC8 "+row.native_location.station_publisher_huc8)+"</td><td>"+
    esc(Object.entries(row.utility_membership).filter(([,v])=>v.covered).map(([k])=>k).join("; ")||"Outside both")+
    "</td><td>"+esc(annual?(model.memberships.get(row.station_id).map(x=>x.comid).join("; ")||"Outside selected catchments"):"Context not attached")+"</td><td>"+
    row.assessment_records.length+"</td></tr>").join("");
  const annualView=annualReferenceHtml(annual,esc);
  const ui='<section id="native-coverage"><h2>Physical station coverage</h2>'+
    '<p>Choose an original utility selection or annual-reference catchment, inspect actual station membership and open the related assessment editions below. Geographic membership and publisher labels remain separate.</p>'+
    '<p id="native-notice" role="status"></p><div id="native-interactive" hidden><div class="review-controls">'+
    '<label>Find a station or containing watershed<input id="native-search" type="search" autocomplete="off"></label>'+
    '<label>Physical utility selection<select id="native-utility"></select></label>'+
    '<label>Original annual-reference catchment<select id="native-basin"></select></label>'+
    '<label>Publisher relationship<select id="native-relationship"></select></label></div>'+
    '<p><label><input id="native-selected-only" type="checkbox"> Show selected native stations only</label></p>'+
    '<div class="review-actions"><button type="button" id="native-select-visible">Select visible stations</button>'+
    '<button type="button" id="native-clear-selection">Clear station selection</button><button type="button" id="native-reset">Reset coverage filters</button></div>'+
    '<p id="native-counts" role="status" aria-live="polite"></p><div class="table review-table"><table><caption>Completed native station memberships</caption>'+
    '<thead><tr><th>Select</th><th>Original station</th><th>Containing watershed / boundary distance</th><th>Station publisher watershed</th>'+
    '<th>Physical utility selection</th><th>Annual catchment COMIDs</th></tr></thead><tbody id="native-rows"></tbody></table></div>'+
    '<p id="native-empty" hidden>No original stations match these coverage filters.</p>'+
    '<div class="review-actions"><button type="button" id="native-export-json" disabled>Export selected native JSON</button>'+
    '<button type="button" id="native-export-csv" disabled>Export selected native CSV</button>'+
    '<button type="button" id="native-save">Save complete review HTML</button><button type="button" id="native-print">Print full report</button></div>'+
    '<p class="muted">Native selections persist across filters. JSON retains the original station result and annual source bindings; CSV keeps original coordinate fields and source-bound assessment references. Saved HTML retains both native and assessment review states.</p>'+
    '<section id="native-detail" aria-label="Original native station detail"></section></div>'+
    '<div id="native-fallback"><h3>Complete physical station inventory</h3><div class="table"><table><thead><tr>'+
    '<th>Station</th><th>Containing watershed</th><th>Station publisher watershed</th><th>Physical utility selection</th>'+
    '<th>Annual catchments</th><th>Assessment records</th></tr></thead><tbody>'+tableRows+'</tbody></table></div></div></section>';
  const script=createNativeCoverageModel.toString()+"\n("+nativeCoverageBrowser.toString()+")();";
  const sha=codec.sha256(codec.utf8Encode(script)), hash=codec.base64Encode(new Uint8Array(sha.match(/../g).map(v=>parseInt(v,16))));
  const policy=html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
  if(!policy||!policy[1].includes("script-src "))throw Error("The maintained report content policy is absent.");
  const updated=policy[1].replace(/script-src ([^;]+)/,(_,values)=>"script-src "+values+" 'sha256-"+hash+"'");
  const style='<style id="native-review-style">#native-detail{border:1px solid #aaa;padding:16px;margin:20px 0;scroll-margin-top:12px}.native-print-only{display:none}'+
    '@media print{#native-interactive,#native-notice{display:none!important}.native-print-only{display:block!important}}</style>'+
    '<noscript><style>.native-print-only{display:block!important}</style></noscript>';
  const payload=JSON.stringify({binding,context,annual}).replaceAll("<","\\u003c").replaceAll("\u2028","\\u2028").replaceAll("\u2029","\\u2029");
  return html.replace(policy[0],'<meta http-equiv="Content-Security-Policy" content="'+updated+'">')
    .replace("</head>",style+"</head>").replace("<nav>",'<nav><a href="#native-coverage">Physical coverage</a>'+(annual?'<a href="#annual-reference-yields">Annual reference yields</a>':''))
    .replace('<section id="association-reviewer">',ui+annualView+'<section id="association-reviewer">')
    .replace("</body>",'<script id="native-review-data" type="application/json">'+payload+'</script>'+
      '<script id="native-review-state" type="application/json">null</script><script>'+script+"</script></body>");
}
