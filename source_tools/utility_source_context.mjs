/** Join original utility memberships to retained programme and designation context. */
export const VERSION = "1.0.0";
export const TARGET_CLASSES = ["ORW", "ONRW", "TN", "TPGT", "TPT"];
const copy = value => JSON.parse(JSON.stringify(value));
const sorted = values => [...new Set(values)].sort();
const finite = (value, label) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw Error(label + " must be a finite nonnegative source number");
  return value;
};
const sum = values => {
  // Compensated summation keeps the original published decimals as supplied.
  let total = 0, correction = 0;
  for (const value of values) {
    const next = total + value;
    correction += Math.abs(total) >= Math.abs(value) ? (total - next) + value : (value - next) + total;
    total = next;
  }
  return total + correction;
};
const huc = value => {
  if (typeof value !== "string" || !/^\d{12}$/.test(value)) throw Error("Preserve original twelve-character HUC12 IDs");
  return value;
};
const sameSet = (a,b) => a.length === new Set(a).size && b.length === new Set(b).size &&
  a.length === b.length && a.every(value => b.includes(value));

function originalCoverage(coverage, domain, inventory) {
  if (coverage?.schema !== "upstate.classification-source-coverage/v1") throw Error("Select the original classification coverage companion");
  const originalUrl = coverage.full_domain_id_response?.request_url || "";
  const where = decodeURIComponent((originalUrl.match(/[?&]where=([^&]*)/) || [,""])[1].replace(/\+/g," "));
  const clause = where.match(/\bHUC_12\s+IN\s*\((.*?)\)/i);
  const classes = where.match(/\bH2OCLASS\s+IN\s*\((.*?)\)/i);
  const ids = clause ? [...clause[1].matchAll(/'(\d{12})'/g)].map(m=>m[1]) : [];
  const selected = classes ? [...classes[1].matchAll(/'([^']+)'/g)].map(m=>m[1]) : [];
  const comparison = coverage.comparison || {};
  const complete = sameSet(ids, domain) && sameSet(selected, TARGET_CLASSES) &&
    coverage.model_domain?.huc12_count === domain.length &&
    comparison.same_complete_object_id_set === true &&
    comparison.all_publisher_hucs_in_selected_domain === true &&
    comparison.added_ids?.length === 0 && comparison.retained_ids_outside_exact_selection?.length === 0;
  if (!complete) throw Error("The classification companion does not bind this complete original domain and class selection");
  const count = inventory.feature_count;
  if (![coverage.full_domain_id_response.count, coverage.full_domain_id_response.unique_ids,
      coverage.captured_geometry.features].every(value=>value===count)) throw Error("Original classification counts disagree");
  for (const code of TARGET_CLASSES) if ((comparison.class_counts?.[code] || 0) !== (inventory.class_counts[code] || 0)) {
    throw Error("Original classification class totals disagree");
  }
  return {complete_domain_query:true, query_url:originalUrl, selected_classes:[...TARGET_CLASSES],
    jurisdiction:"South Carolina", assignment:"Original publisher HUC_12 attributes",
    original_geometry_features:count, coverage_operation_id:coverage.operation_id || null};
}

function sourceSummary(rows) {
  const states = sorted(rows.flatMap(row=>row.nrcs_state_rows.map(r=>r.st_usps)));
  const stateRows = rows.flatMap(row=>row.nrcs_state_rows);
  const priorities = stateRows.filter(row=>row.fy26_status === "High Priority Area");
  const classCounts = Object.fromEntries(TARGET_CLASSES.map(code=>[code,
    sum(rows.map(row=>row.classification.class_counts[code] || 0))]));
  const completeAreas = rows.every(row=>row.nrcs_whole_huc_acres !== null);
  return {
    huc_count:rows.length, nrcs_state_row_count:stateRows.length,
    nrcs_missing_huc12s:rows.filter(row=>row.nrcs_state_rows.length===0).map(row=>row.huc12),
    wbd_whole_huc_area_sqkm:sum(rows.map(row=>row.wbd.areasqkm)),
    wbd_whole_huc_area_acres:sum(rows.map(row=>row.wbd.areaacres)),
    nrcs_whole_huc_area_acres:completeAreas ? sum(rows.map(row=>row.nrcs_whole_huc_acres)) : null,
    nrcs_known_whole_huc_area_acres:sum(rows.filter(row=>row.nrcs_whole_huc_acres!==null).map(row=>row.nrcs_whole_huc_acres)),
    nrcs_state_portion_area_acres:sum(stateRows.map(row=>row.st_ac)),
    priority_huc12s:rows.filter(row=>row.nrcs_state_rows.some(r=>r.fy26_status==="High Priority Area")).map(row=>row.huc12),
    priority_state_row_count:priorities.length,
    priority_state_portion_area_acres:sum(priorities.map(row=>row.st_ac)),
    priority_systems:["Ground","Surface","Both"].map(system=>({
      system_type:system,state_row_count:priorities.filter(row=>row.system_type===system).length,
      state_portion_area_acres:sum(priorities.filter(row=>row.system_type===system).map(row=>row.st_ac))
    })),
    priority_other_system_rows:copy(priorities.filter(row=>!["Ground","Surface","Both"].includes(row.system_type))),
    state_portions:states.map(state=>{
      const original = stateRows.filter(row=>row.st_usps===state), positive=original.filter(row=>row.fy26_status==="High Priority Area");
      return {state,source_rows:original.length,area_acres:sum(original.map(row=>row.st_ac)),
        priority_source_rows:positive.length,priority_area_acres:sum(positive.map(row=>row.st_ac)),
        priority_systems:sorted(positive.map(row=>row.system_type).filter(value=>typeof value==="string"))};
    }),
    classification:{
      source_jurisdiction:"South Carolina",selected_class_counts:classCounts,
      selected_feature_count:sum(Object.values(classCounts)),
      selected_feature_huc12s:rows.filter(row=>row.classification.selected_feature_count>0).map(row=>row.huc12),
      sc_portion_huc_count:rows.filter(row=>row.classification.has_sc_state_portion).length,
      outside_sc_jurisdiction_huc12s:rows.filter(row=>!row.classification.has_sc_state_portion).map(row=>row.huc12),
      queried_sc_hucs_without_selected_records:rows.filter(row=>row.classification.has_sc_state_portion&&row.classification.selected_feature_count===0).map(row=>row.huc12)
    }
  };
}

export function buildUtilitySourceContext({topology, context, coverage, network, identities={}}) {
  if (context?.schema !== "upstate.water-context/v1" || !Array.isArray(topology?.areas)) throw Error("Select the retained regional context and utility topology");
  const domain=context.model_domain_huc12s.map(huc);
  if (domain.length!==new Set(domain).size || topology.domain.huc12_count!==domain.length) throw Error("Original domain identity/count differs");
  const sourceNetwork=new Map();
  for (const feature of network.features) {
    const row=feature.attributes,id=huc(row.huc12);
    if(sourceNetwork.has(id))throw Error("Repeated native network HUC12");
    sourceNetwork.set(id,row);
  }
  if(domain.some(id=>!sourceNetwork.has(id)))throw Error("Native network omits a selected domain HUC");
  const regional=new Map(context.hucs.map(row=>[huc(row.huc12),row]));
  if(regional.size!==context.hucs.length)throw Error("Repeated regional HUC12 source record");
  const inventory=context.classified_source_inventory,perClass=new Map(),seenClass=new Set();
  for(const row of inventory.source_huc_class_counts) {
    const id=huc(row.publisher_huc12),key=id+"/"+row.class_code;
    if(!domain.includes(id)||!TARGET_CLASSES.includes(row.class_code)||seenClass.has(key))throw Error("Unexpected original HUC/class inventory");
    seenClass.add(key);finite(row.feature_count,"Native classification feature count");
    if(!Number.isInteger(row.feature_count))throw Error("Native feature count must be an integer");
    if(!perClass.has(id))perClass.set(id,{});
    perClass.get(id)[row.class_code]=row.feature_count;
  }
  if(sum(inventory.source_huc_class_counts.map(row=>row.feature_count))!==inventory.feature_count)throw Error("Source feature inventory total differs");
  const sourceCoverage=originalCoverage(coverage,domain,inventory);
  const globalIds=new Set(),utilities=[];
  for(const area of topology.areas){
    const members=area.members.map(member=>huc(member.huc12));
    if(members.length!==new Set(members).size||members.length!==area.huc12_count||members.some(id=>!domain.includes(id)))throw Error("Original utility membership selection differs");
    const rows=area.members.map(member=>{
      const id=member.huc12,native=sourceNetwork.get(id),source=regional.get(id);
      if(JSON.stringify(native)!==JSON.stringify(member.attributes)) {
        for(const key of ["objectid","huc12","tohuc","name","areasqkm","areaacres","states","hutype","humod","noncontributingareasqkm"])
          if(native[key]!==member.attributes[key])throw Error("Utility membership differs from original USGS attribute "+key);
      }
      if(member.path_to_anchor[0]!==id||!area.anchor_huc12s.includes(member.path_to_anchor.at(-1)))throw Error("Original utility path does not reach a selected anchor");
      for(let i=0;i<member.path_to_anchor.length-1;i++)if(sourceNetwork.get(member.path_to_anchor[i])?.tohuc!==member.path_to_anchor[i+1])throw Error("Utility path differs from original ToHUC");
      finite(native.areasqkm,"WBD areasqkm");finite(native.areaacres,"WBD areaacres");
      const stateRows=copy(source?.nrcs_state_rows||[]),seen=new Set();
      for(const row of stateRows){
        if(row.huc12_code!==id||seen.has(row.st_usps))throw Error("Repeated or mismatched original NRCS state/HUC row");
        seen.add(row.st_usps);finite(row.st_ac,"NRCS state acres");finite(row.huc12_ac,"NRCS whole-HUC acres");
      }
      const acres=stateRows.length?stateRows[0].huc12_ac:null;
      if(stateRows.some(row=>row.huc12_ac!==acres))throw Error("Conflicting original whole-HUC acreage across state rows");
      const classes=perClass.get(id)||{},count=sum(Object.values(classes));
      const hasSC=native.states.split(",").map(s=>s.trim()).includes("SC");
      globalIds.add(id);
      return {huc12:id,name:native.name,utility_id:area.utility_id,is_focus_anchor:member.is_anchor,
        path_to_anchor:[...member.path_to_anchor],wbd:copy(native),nrcs_state_rows:stateRows,
        nrcs_whole_huc_acres:acres,
        classification:{class_counts:{...classes},selected_feature_count:count,has_sc_state_portion:hasSC,
          status:!hasSC?"outside_SC_jurisdiction":count?"selected_SC_records":"queried_no_selected_SC_record",
          assignment:"publisher_huc12_attribute",source_jurisdiction:"South Carolina"}};
    });
    const summary=sourceSummary(rows);
    if(Math.abs(summary.wbd_whole_huc_area_sqkm-area.source_area_sqkm)>1e-8 ||
       Math.abs(summary.wbd_whole_huc_area_acres-area.source_area_acres)>1e-7)throw Error("Utility source-area summary differs");
    utilities.push({id:area.id,title:area.title,utility_id:area.utility_id,
      anchor_huc12s:[...area.anchor_huc12s],reference:copy(area.reference),
      summary,focal_summary:sourceSummary(rows.filter(row=>row.is_focus_anchor)),rows});
  }
  const uniqueRows=new Map(utilities.flatMap(area=>area.rows.map(row=>[row.huc12,row])));
  return {
    schema:"upstate.utility-source-context/v1",version:VERSION,
    operation_id:"UPSTATE-ORIGINAL-UTILITY-TOPOLOGY-20261013",edition:"regional-programme-and-designation-context-20261013",
    title:"Upper Savannah utility watershed source context",
    source_identities:copy(identities),domain_huc_count:domain.length,native_network_rows:sourceNetwork.size,
    classification_coverage:sourceCoverage,utilities,
    combined:{summary:sourceSummary([...uniqueRows.values()].sort((a,b)=>a.huc12.localeCompare(b.huc12))),
      shared_huc12s:sorted(utilities.flatMap(a=>a.rows.map(r=>r.huc12))).filter(id=>utilities.filter(a=>a.rows.some(r=>r.huc12===id)).length>1)},
    interpretation:{
      geography:"Whole HUC12 planning footprints follow retained ToHUC links to the issuer-selected anchors. Published intake protection polygons retain a separate source and geometry.",
      areas:"USGS whole-HUC fields, NRCS whole-HUC acres and NRCS state-portion acres preserve their original editions and rounding. Each HUC is counted once in a union; state rows are summed once per state/HUC.",
      nrcs:"FY26 priority is a state-specific programme designation. Ground, Surface and Both are retained separately; a Ground designation is not a surface-intake water-quality measurement or an NDR subsurface parameter.",
      classifications:"Selected South Carolina class counts follow the publisher HUC_12 attribute. Zero target records does not classify an entire watershed's waters. Georgia and North Carolina designation coverage is outside this source's jurisdiction.",
      native_models:"InVEST 3.20 NDR/SDR estimate land-origin export reaching the modeled stream network. HUC relationships associate that land with the selected receptor. In-stream retention, reservoir processes and intake concentrations require additional modeling.",
      native_units:{nitrogen_phosphorus_raster:"kg/hectare/year",sediment_raster:"metric_tonnes/hectare/year",
        retained_cell_mass:"Native rate multiplied by original native cell area in hectares once",
        reported_polygon_total:"Retained cell mass multiplied by its selected reporting overlap fraction, then summed",
        paired_change:"Alternative minus baseline on common finite support; reduction is the negative of that change"},
      references:[
        "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html",
        "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html"
      ]
    }
  };
}

const csvCell=value=>{const text=value==null?"":typeof value==="object"?JSON.stringify(value):String(value);return /[",\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;};
export function utilityContextCsv(result) {
  const columns=["utility_id","huc12","name","is_focus_anchor","wbd_area_sqkm","wbd_area_acres","nrcs_state","nrcs_status","nrcs_system_type","nrcs_resource_concern","nrcs_state_acres","nrcs_whole_huc_acres","classification_status","sc_selected_feature_count","sc_class_counts","path_to_anchor"];
  const rows=[columns];
  for(const utility of result.utilities)for(const row of utility.rows)for(const original of row.nrcs_state_rows.length?row.nrcs_state_rows:[null]){
    rows.push([utility.utility_id,row.huc12,row.name,row.is_focus_anchor,row.wbd.areasqkm,row.wbd.areaacres,
      original?.st_usps,original?.fy26_status,original?.system_type,original?.resource_concern,original?.st_ac,original?.huc12_ac,
      row.classification.status,row.classification.selected_feature_count,row.classification.class_counts,row.path_to_anchor]);
  }
  return rows.map(row=>row.map(csvCell).join(",")).join("\n")+"\n";
}

const escape=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const number=value=>value==null?"Unknown":Number(value).toLocaleString("en-US",{maximumFractionDigits:2});
export function utilityContextHtml(result) {
  const table=(head,rows)=>"<table><thead><tr>"+head.map(x=>"<th>"+escape(x)+"</th>").join("")+"</tr></thead><tbody>"+rows.map(row=>"<tr>"+row.map(x=>"<td>"+escape(x)+"</td>").join("")+"</tr>").join("")+"</tbody></table>";
  let body="<h1>Upper Savannah utility watershed source context</h1><p>Use the original whole-watershed planning selection with its state-specific source-water programme designations and South Carolina classified-water inventory.</p>";
  body+=table(["Utility","Whole HUC12s","USGS area km²","NRCS priority HUCs","Selected SC class records"],
    result.utilities.map(a=>[a.utility_id,a.summary.huc_count,number(a.summary.wbd_whole_huc_area_sqkm),a.summary.priority_huc12s.length,a.summary.classification.selected_feature_count]));
  for(const utility of result.utilities){
    const s=utility.summary;
    body+="<section><h2>"+escape(utility.title)+"</h2><p>"+s.huc_count+" distinct HUC12s; "+number(s.wbd_whole_huc_area_sqkm)+" km² from the original USGS area field. NRCS whole-HUC area is "+number(s.nrcs_whole_huc_area_acres)+" acres; published state portions sum to "+number(s.nrcs_state_portion_area_acres)+" acres.</p>";
    body+="<h3>Original NRCS state portions</h3>"+table(["State","State/HUC rows","State acres","Priority rows","Priority acres","Priority system types"],s.state_portions.map(r=>[r.state,r.source_rows,number(r.area_acres),r.priority_source_rows,number(r.priority_area_acres),r.priority_systems.join(", ")]));
    body+="<h3>FY26 priority by original system type</h3>"+table(["System type","Priority state/HUC rows","Priority state acres"],s.priority_systems.map(r=>[r.system_type,r.state_row_count,number(r.state_portion_area_acres)]));
    body+="<p>"+escape(result.interpretation.nrcs)+"</p><h3>Selected South Carolina designations</h3>"+table(["Original class","Publisher feature count"],Object.entries(s.classification.selected_class_counts));
    body+="<p>"+s.classification.sc_portion_huc_count+" selected HUCs contain a South Carolina portion. "+s.classification.outside_sc_jurisdiction_huc12s.length+" lie outside this classification source's jurisdiction. "+escape(result.interpretation.classifications)+"</p>";
    body+="<h3>Original watershed and state records</h3>"+table(["HUC12","Watershed","Role","USGS km²","NRCS state status and system","SC classification context"],utility.rows.map(r=>[r.huc12,r.name,r.is_focus_anchor?"Focus anchor":"Upstream whole HUC",number(r.wbd.areasqkm),r.nrcs_state_rows.map(s=>s.st_usps+": "+s.fy26_status+(s.system_type?" / "+s.system_type:"")).join("; "),r.classification.status+" / "+r.classification.selected_feature_count+" selected records"]));
    body+="</section>";
  }
  body+="<section><h2>Geographic and model meaning</h2>"+["geography","areas","native_models"].map(k=>"<p>"+escape(result.interpretation[k])+"</p>").join("");
  body+=table(["Quantity","Meaning"],Object.entries(result.interpretation.native_units));
  body+="<h3>Original model documentation</h3><ul>"+result.interpretation.references.map(uri=>'<li><a href="'+escape(uri)+'">'+escape(uri)+"</a></li>").join("")+"</ul><h3>Retained source identities</h3>"+table(["Source","Path","SHA256"],Object.entries(result.source_identities).map(([key,s])=>[key,s.path,s.sha256]))+"</section>";
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Upper Savannah utility watershed source context</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#222;background:#fff;margin:32px auto;max-width:1180px;padding:0 20px}h1{font-size:28px}h2{font-size:22px}h3{font-size:17px}section{margin-top:32px}table{border-collapse:collapse;width:100%;margin:16px 0;font-size:13px}th,td{text-align:left;padding:9px;border-bottom:1px solid #ccc;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}a{color:#222}@media print{body{margin:0;max-width:none}thead{display:table-header-group}tr{break-inside:avoid}}</style></head><body>'+body+"</body></html>\n";
}
