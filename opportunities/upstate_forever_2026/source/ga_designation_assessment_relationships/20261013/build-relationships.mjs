/** Original Georgia legal-reach / assessment-source relationship register.
 * Pure derivation: no network, projection, geometry alteration or legal assignment.
 */
export const SCHEMA = "upstate.ga-designation-assessment-relationships/v1";
const json = value => JSON.stringify(value, null, 2) + "\n";
const unique = values => [...new Set(values)];
const esc = value => String(value ?? "").replace(/[&<>"']/g,
  c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const safeJSON = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,
  c => "\\u" + c.charCodeAt(0).toString(16).padStart(4,"0"));
export function csv(rows, columns) {
  const cell = v => '"' + String(v ?? "").replace(/"/g,'""') + '"';
  return [columns.map(cell).join(","), ...rows.map(r=>columns.map(k=>cell(
    Array.isArray(r[k]) ? r[k].join(" | ") : r[k])).join(","))].join("\r\n") + "\r\n";
}
function fail(message) { throw new Error(message); }
function service(url) { return url.split("/query?")[0]; }
export function derive({registry,rules,streamBodies,lakeBody,streamIDs,lakeIDs,
                         attributeCapture,geometryCapture,inputs}) {
  if (registry.schema !== "upstate.classified-water-registry/v2")
    fail("Use the retained Georgia classification register");
  if (registry.edition?.jurisdiction !== "GA" ||
      registry.edition?.classification_system !== "GA-391-3-6-.03")
    fail("Keep the original Georgia legal classification system");
  const legal = registry.records.filter(x=>x.classification_role==="designated-use" &&
    x.river_basin==="SAVANNAH RIVER BASIN");
  if (legal.length!==30 || new Set(legal.map(x=>x.id)).size!==30 ||
      rules.length!==30 || new Set(rules.map(x=>x.legal_id)).size!==30)
    fail("Keep all thirty original legal Savannah records and review definitions");
  const ruleIndex=new Map(rules.map(x=>[x.legal_id,x]));
  const geometry=new Map();
  for(const part of geometryCapture.files) {
    if (!["stream","lake"].includes(part.kind) || !Array.isArray(part.ids)) fail("Invalid source geometry member");
    const endpoint=service(part.url);
    for(const id of part.ids) {
      const key=part.kind+":"+id;
      if(geometry.has(key)) fail("An original geometry ID is repeated");
      geometry.set(key,{kind:part.kind,object_id:id,object_id_field:"FID",
        service_url:endpoint,source_response:part.path,source_response_bytes:part.bytes,
        source_query_url:part.url,native_crs:"EPSG:3857",
        source_hasZ:geometryCapture.source_hasZ,source_hasM:geometryCapture.source_hasM});
    }
  }
  const originals=[];
  for(const [kind,bodies,ids] of [["stream",streamBodies,streamIDs.objectIds],
                                ["lake",[lakeBody],lakeIDs.objectIds]]) {
    const seen=new Set();
    for(const source of bodies) {
      if(source.value.error || source.value.exceededTransferLimit) fail("Use complete original attribute responses");
      const sourceDescriptor=attributeCapture.files.find(x=>x.path===source.path);
      if(!sourceDescriptor) fail("Missing original attribute source descriptor: "+source.path);
      for(const feature of source.value.features) {
        const row=feature.attributes;
        if(!Number.isInteger(row.FID)||seen.has(row.FID)||!ids.includes(row.FID)||
           row.Basin!=="Savannah"||typeof row.ReachID!=="string") fail("Original attribute identity changed");
        seen.add(row.FID);
        const reference=geometry.get(kind+":"+row.FID);
        if(!reference||reference.service_url!==service(sourceDescriptor.source_url||sourceDescriptor.url))
          fail("Attribute and geometry services differ");
        originals.push({key:kind+":"+row.FID,kind,source_response:source.path,
          source_response_sha256:sourceDescriptor.sha256,
          service_url:reference.service_url,attributes:row,
          geometry_reference:{...reference,reach_id:row.ReachID}});
      }
    }
    if(seen.size!==ids.length||ids.some(id=>!seen.has(id))) fail("Original attribute cohort is incomplete");
  }
  if(originals.length!==295 || geometry.size!==295) fail("Keep the original complete 295-feature source selection");
  const byKey=new Map(originals.map(x=>[x.key,x]));
  const rows=[], pairs=[], selected=new Map();
  for(const record of legal) {
    const definition=ruleIndex.get(record.id); if(!definition)fail("Missing legal review definition");
    const names=new Set(definition.exact_candidate_names), reviews=new Map();
    for(const review of definition.reviewed_pairs) {
      const key=review.kind+":"+review.FID, source=byKey.get(key);
      if(!source||source.attributes.ReachID!==review.expected_reach_id||
         !names.has(source.attributes.Name)||reviews.has(key)) fail("Reviewed relationship changed its original source");
      reviews.set(key,review);
    }
    const candidates=originals.filter(x=>names.has(x.attributes.Name)).map(source=>{
      const original=source.attributes, review=reviews.get(source.key);
      const components=String(original.Uses??"").split(",").map(x=>x.trim()).filter(Boolean);
      const missing=record.class_components.filter(x=>!components.includes(x));
      const extra=components.filter(x=>!record.class_components.includes(x));
      const item={legal_id:record.id,source_key:source.key,kind:source.kind,FID:original.FID,
        ReachID:original.ReachID,service_url:source.service_url,
        relationship:review?.relationship||"exact_name_candidate",
        reviewed:Boolean(review),evidence:review?.evidence||
          "Explicit exact-name candidate only; endpoints and legal scope are unresolved.",
        assessment_use_components:components,legal_use_components:record.class_components,
        legal_components_absent_from_assessment:missing,
        additional_assessment_use_components:extra,
        use_components_cover_legal:missing.length===0,
        source_response:source.source_response,source_response_sha256:source.source_response_sha256,
        original_attributes:original,geometry_reference:source.geometry_reference,
        legal_geometry_assignment:false,study_domain_membership:"requires_original_217_domain_intersection"};
      if(review){
        const previous=selected.get(source.key)||{...source.geometry_reference,
          source_key:source.key,source_name:original.Name,relationships:[]};
        previous.relationships.push({legal_id:record.id,relationship:item.relationship,
          evidence:item.evidence,legal_components_absent_from_assessment:missing});
        selected.set(source.key,previous);
      }
      pairs.push(item); return item;
    });
    const reviewed=candidates.filter(x=>x.reviewed);
    rows.push({legal:record,exact_candidate_names:definition.exact_candidate_names,
      interpretation:definition.interpretation,candidate_count:candidates.length,
      reviewed_pair_count:reviewed.length,
      reviewed_use_difference_count:reviewed.filter(x=>!x.use_components_cover_legal).length,
      source_review_state:reviewed.length?"reviewed_source_relationships":
        candidates.length?"name_candidates_require_review":"no_exact_named_assessment_candidate",
      candidates});
  }
  const counts={legal_records:rows.length,publisher_assessment_features:originals.length,
    candidate_pairs:pairs.length,distinct_candidate_features:new Set(pairs.map(x=>x.source_key)).size,
    reviewed_pairs:pairs.filter(x=>x.reviewed).length,reviewed_geometry_features:selected.size,
    legal_records_with_reviewed_pairs:rows.filter(x=>x.reviewed_pair_count).length,
    legal_records_without_named_candidate:rows.filter(x=>!x.candidate_count).length,
    reviewed_use_difference_pairs:pairs.filter(x=>x.reviewed&&!x.use_components_cover_legal).length,
    endpoint_text_correspondence_pairs:pairs.filter(x=>x.relationship==="endpoint_text_correspondence").length,
    legal_geometry_assignments:0};
  const register={schema:SCHEMA,title:"Georgia Savannah designated uses and original assessed-water geography",
    captured_at:"2026-10-13",legal_edition:registry.edition,
    assessment_edition:"Georgia EPA-approved 2024 integrated report publisher GIS",
    geography_scope:"Complete publisher Savannah basin; original217 membership is a separate geometric intersection.",
    interpretation:[
      "Each relation retains the original legal description, original assessment attributes and service-qualified FID/ReachID.",
      "Reviewed pairs identify useful source relationships. Full legal geometry requires the stated endpoint and component qualifications.",
      "Assessment Uses and assessment condition are separate. A missing use component is a source-review difference, not a finding that the law changed.",
      "A lake polygon, beach feature and river interval have different geographic support. Do not add or dissolve them as if they were interchangeable.",
      "Exact names are explicitly enumerated; no substring, fuzzy name, use-only or cross-county substitution creates an assignment."
    ],inputs,counts,rows};
  const selection={schema:"upstate.ga-assessment-geography-review-selection/v1",
    title:register.title,role:"original-assessment-geography-for-designation-review",
    legal_geometry_assignment:false,legal_register_schema:SCHEMA,
    source_crs:"EPSG:3857",object_id_field:"FID",reach_id_field:"ReachID",
    source_hasZ:geometryCapture.source_hasZ,source_hasM:geometryCapture.source_hasM,
    scope:register.geography_scope,features:[...selected.values()]};
  const summaries=rows.map(r=>({legal_id:r.legal.id,waterbody:r.legal.waterbody_name,
    legal_use:r.legal.class_raw,legal_reach:r.legal.reach_description,pdf_page:r.legal.source_pdf_page,
    source_line_start:r.legal.source_line_start,source_line_end:r.legal.source_line_end,
    review_state:r.source_review_state,candidate_pairs:r.candidate_count,
    reviewed_pairs:r.reviewed_pair_count,reviewed_use_differences:r.reviewed_use_difference_count,
    reviewed_source_keys:r.candidates.filter(x=>x.reviewed).map(x=>x.source_key),
    interpretation:r.interpretation}));
  const flat=pairs.map(p=>({legal_id:p.legal_id,source_kind:p.kind,source_FID:p.FID,
    source_ReachID:p.ReachID,source_service:p.service_url,
    original_name:p.original_attributes.Name,original_location:p.original_attributes.Location,
    original_county:p.original_attributes.County,original_uses:p.original_attributes.Uses,
    original_assessment:p.original_attributes.Assessment,original_category:p.original_attributes.Category,
    original_cause:p.original_attributes.Cause,original_notes:p.original_attributes.Notes,
    relationship:p.relationship,reviewed:p.reviewed,
    absent_legal_use_components:p.legal_components_absent_from_assessment,
    additional_assessment_use_components:p.additional_assessment_use_components,evidence:p.evidence,
    geometry_response:p.geometry_reference.source_response,
    legal_geometry_assignment:false,study_domain_membership:p.study_domain_membership}));
  const section=["Georgia designated-use source relationships",[
    "Thirty original Savannah legal reach descriptions are compared with the complete 295-feature publisher assessment cohort.",
    counts.reviewed_pairs+" reviewed source pairs resolve to "+counts.reviewed_geometry_features+
      " original geometry features. "+counts.endpoint_text_correspondence_pairs+
      " pairs have corresponding endpoint text; lake components and partial or differing endpoints retain their separate qualifications.",
    counts.legal_records_without_named_candidate+" legal records have no exact named assessment candidate in this original source cohort.",
    "Original 2022 legal uses and published 2024 assessment conditions are distinct editions and concepts. Whole-Savannah source scope is retained separately from the original217 study domain.",
    "The two reviewed Little Beaverdam intervals publish Fishing while the legal record declares Drinking Water; this is retained as a source-use review question. No classification is overwritten.",
    "Richard B. Russell Lake and the distinct Habersham Russell Lake retain separate original identities. The publisher explicitly names Federal Lake as previously Liberty Lake.",
    {kind:"table",columns:["Legal waterbody","Legal reach","Published use","Reviewed source pairs","Source interpretation"],
     rows:rows.map(r=>[r.legal.waterbody_name,r.legal.reach_description,r.legal.class_raw,
       String(r.reviewed_pair_count),r.interpretation]),widths:[.16,.26,.13,.08,.37]}
  ]];
  const report={schema:"upstate.observed-report/v1",title:register.title,
    edition:"ga-designation-assessment-relationships-20261013",vintage:"2022 legal / 2024 assessment",
    interpretation_kind:"published_designation_assessment_source_relationships",inputs,
    sections:[section],figures:[]};
  return {register,selection,summaries,flat,report};
}
export function renderBrief(result) {
  const {register,selection,summaries,flat}=result;
  const payload={register,selection,summaries,flat};
  const table=register.rows.map(r=>'<article data-id="'+esc(r.legal.id)+'"><h2>'+
    esc(r.legal.waterbody_name)+'</h2><p class="meta">'+esc(r.legal.id)+' · PDF page '+
    esc(r.legal.source_pdf_page)+' · '+esc(r.legal.class_raw)+'</p><p><strong>Original legal reach:</strong> '+
    esc(r.legal.reach_description)+'</p><p>'+esc(r.interpretation)+'</p>'+
    '<p>'+r.candidate_count+' exact-name candidates · '+r.reviewed_pair_count+
    ' reviewed source pairs</p><div class="scroll"><table><thead><tr><th>Original assessment feature</th>'+
    '<th>Original interval / county</th><th>Uses / condition</th><th>Relationship / evidence</th></tr></thead><tbody>'+
    (r.candidates.length?r.candidates.map(p=>'<tr><td>'+esc(p.original_attributes.Name)+
      '<br><small>'+esc(p.source_key)+' · '+esc(p.ReachID)+'</small></td><td>'+
      esc(p.original_attributes.Location)+'<br><small>'+esc(p.original_attributes.County)+'</small></td><td>'+
      esc(p.original_attributes.Uses)+'<br><small>'+esc(p.original_attributes.Assessment)+' · '+
      esc(p.original_attributes.Category)+'</small>'+
      (p.legal_components_absent_from_assessment.length?'<p>Absent legal use components: '+
       esc(p.legal_components_absent_from_assessment.join(", "))+'</p>':'')+'</td><td>'+
      esc(p.relationship.replaceAll("_"," "))+'<p>'+esc(p.evidence)+'</p>'+
      '<details><summary>Complete original attributes and source identity</summary><pre>'+
      esc(JSON.stringify({attributes:p.original_attributes,service_url:p.service_url,
        source_response:p.source_response,source_response_sha256:p.source_response_sha256,
        geometry:p.geometry_reference},null,2))+'</pre></details></td></tr>').join(""):
       '<tr><td colspan="4">No exact named assessment candidate in this original source cohort.</td></tr>')+
    '</tbody></table></div></article>').join("");
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+esc(register.title)+'</title><style>'+
    'body{font:15px/1.55 system-ui,sans-serif;color:#202020;background:#fff;margin:0}main{max-width:1200px;margin:auto;padding:28px}'+
    'h1{font-size:28px;line-height:1.2}h2{font-size:20px}small,.meta{font-size:12px;color:#4c4c4c}'+
    'header,article{border-bottom:1px solid #aaa;padding-bottom:20px;margin-bottom:24px}'+
    'nav{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0}button,input,select{font:inherit;padding:8px;border:1px solid #777;background:#fff;color:#202020}'+
    'input{min-width:180px;flex:1}button{cursor:pointer}table{border-collapse:collapse;width:100%;min-width:700px}td,th{border:1px solid #bbb;padding:9px;text-align:left;vertical-align:top}'+
    'th{background:#eee}td{width:25%}.scroll{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 monospace}'+
    '[hidden]{display:none!important}.scope{padding:12px;border:1px solid #aaa;background:#f5f5f5}'+
    '@media(max-width:600px){main{padding:16px}h1{font-size:23px}}'+
    '@media print{nav{display:none}.scroll{overflow:visible}table{min-width:0;font-size:9px}td,th{padding:4px}article{break-inside:auto}h2{break-after:avoid}main{padding:0;max-width:none}details{display:block}details>summary{display:none}}'+
    '</style><main><header><h1>'+esc(register.title)+'</h1><p>30 legal reach records · 295 original assessment features · '+
    register.counts.reviewed_pairs+' reviewed relationships · '+register.counts.reviewed_geometry_features+' source geometry selections</p>'+
    '<p class="scope">Source review across the complete Savannah basin. Legal endpoints, named lake components, published uses and assessment condition remain separate. Original217 study membership requires the retained geometry intersection.</p>'+
    '<p><a href="'+esc(register.legal_edition.source_url)+'">Original Georgia water-quality standard</a> · '+
    '<a href="https://epd.georgia.gov/water-quality-georgia">Georgia assessment publication</a></p>'+
    '<nav><input id="search" type="search" aria-label="Filter original legal and assessment text" placeholder="Search names, boundaries, uses, ReachID">'+
    '<select id="mode" aria-label="Choose review rows"><option value="all">All legal records</option><option value="reviewed">With reviewed pairs</option><option value="missing">No named candidate</option><option value="uses">Reviewed use difference</option></select>'+
    '<button id="download-csv">Download visible legal rows CSV</button><button id="download-pairs">Download all original relationship pairs CSV</button>'+
    '<button id="download-json">Download complete register JSON</button><button id="download-geometry">Download geometry selection JSON</button>'+
    '<button id="print">Print visible records</button></nav><p id="status">30 of 30 legal records shown.</p></header>'+
    table+'</main><script id="data" type="application/json">'+safeJSON(payload)+'</script><script>'+
    'const data=JSON.parse(document.getElementById("data").textContent),rows=data.register.rows;'+
    'const articles=[...document.querySelectorAll("article")],search=document.getElementById("search"),mode=document.getElementById("mode");let visible=rows;'+
    'function filter(){const q=search.value.toLowerCase().trim();visible=rows.filter(r=>'+
    '(!q||JSON.stringify(r).toLowerCase().includes(q))&&'+
    '(mode.value==="all"||mode.value==="reviewed"&&r.reviewed_pair_count||mode.value==="missing"&&!r.candidate_count||mode.value==="uses"&&r.reviewed_use_difference_count));'+
    'const ids=new Set(visible.map(r=>r.legal.id));articles.forEach(a=>a.hidden=!ids.has(a.dataset.id));'+
    'document.getElementById("status").textContent=visible.length+" of "+rows.length+" legal records shown. Downloads retain exact source identifiers."}'+
    'function download(name,content,type){const u=URL.createObjectURL(new Blob([content],{type})),a=document.createElement("a");a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}'+
    'const csv='+csv.toString()+';'+
    'search.addEventListener("input",filter);mode.addEventListener("change",filter);'+
    'document.getElementById("download-csv").onclick=()=>{const ids=new Set(visible.map(r=>r.legal.id)),r=data.summaries.filter(r=>ids.has(r.legal_id));download("georgia-legal-reach-review.csv",csv(r,Object.keys(data.summaries[0])),"text/csv;charset=utf-8")};'+
    'document.getElementById("download-pairs").onclick=()=>download("georgia-source-relationships.csv",csv(data.flat,Object.keys(data.flat[0])),"text/csv;charset=utf-8");'+
    'document.getElementById("download-json").onclick=()=>download("georgia-source-relationships.json",JSON.stringify(data.register,null,2)+"\\n","application/json");'+
    'document.getElementById("download-geometry").onclick=()=>download("georgia-reviewed-geometry-selection.json",JSON.stringify(data.selection,null,2)+"\\n","application/json");'+
    'document.getElementById("print").onclick=()=>window.print();</script></html>';
}
export function outputFiles(result) {
  return {"relationships.json":json(result.register),
    "geometry-selection.json":json(result.selection),
    "legal-reach-review.csv":csv(result.summaries,Object.keys(result.summaries[0])),
    "relationship-pairs.csv":csv(result.flat,Object.keys(result.flat[0])),
    "observed-report.json":json(result.report),"briefing.html":renderBrief(result)};
}
