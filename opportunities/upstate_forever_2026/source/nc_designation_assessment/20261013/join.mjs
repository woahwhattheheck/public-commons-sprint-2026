/** Exact NC legal-source index to NC FINAL 2022 assessment-unit join. */
export function buildDesignationAssessment({registry, streams, polygons, parameters, provenance}) {
  const fail = message => { throw new Error(message); };
  const attrs = source => {
    if (source.error || !Array.isArray(source.features)) fail("Invalid original feature response");
    if (source.exceededTransferLimit) fail("Original response reports an incomplete page");
    return source.features.map(f => f.attributes);
  };
  const unique = (rows, field, label) => {
    const out = new Map();
    for (const row of rows) {
      const key = String(row[field]);
      if (row[field] == null || out.has(key)) fail(label + ": missing or duplicate " + field + " " + key);
      out.set(key, row);
    }
    return out;
  };
  const count = values => {
    const out = {};
    for (const value of values) out[String(value)] = (out[String(value)] || 0) + 1;
    return Object.fromEntries(Object.entries(out).sort(([a],[b]) => a.localeCompare(b)));
  };
  const json = data => JSON.stringify(data, null, 2) + "\n";
  const csv = (rows, columns) => {
    const quote = value => {
      const s = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [columns, ...rows.map(r => columns.map(c => r[c]))].map(r => r.map(quote).join(",")).join("\r\n") + "\r\n";
  };
  const unionFields = rows => Array.from(new Set(rows.flatMap(Object.keys)));
  if (registry.schema !== "upstate.classified-water-registry/v2" ||
      registry.edition.jurisdiction !== "NC") fail("NC classified-water registry v2 required");
  if (registry.records.some(r => r.jurisdiction !== "NC" || r.classification_system !== registry.edition.classification_system))
    fail("Registry jurisdiction or classification system differs within edition");
  const legal = unique(registry.records, "original_index", "Legal registry");
  const streamRows = attrs(streams), polygonRows = attrs(polygons), parameterRows = attrs(parameters);
  const units = unique(streamRows, "AU_ID", "Assessment units");
  unique(streamRows, "OBJECTID", "Stream source rows");
  unique(polygonRows, "OBJECTID", "Polygon source rows");
  unique(parameterRows, "OBJECTID", "Parameter source rows");
  const polygonByAU = new Map(), parameterByAU = new Map();
  const sharedFields = ["AU_ID","AU_Number","BIMS_INDEX","AU_Name","AU_Desc","AU_Type","HUC8","IR2022","AU_Length","AU_Units","BIMS_CLASS"];
  for (const row of polygonRows) {
    const counterpart = units.get(String(row.AU_ID));
    if (!counterpart) fail("Polygon-only AU requires a distinct union rule: " + row.AU_ID);
    for (const field of sharedFields)
      if (row[field] !== counterpart[field]) fail("Polygon/stream identity conflict " + row.AU_ID + " " + field);
    const key = String(row.AU_ID);
    if (!polygonByAU.has(key)) polygonByAU.set(key, []);
    polygonByAU.get(key).push(row);
  }
  for (const row of parameterRows) {
    const key = String(row.AU_ID);
    if (!units.has(key)) fail("Orphan parameter AU " + key);
    if (!parameterByAU.has(key)) parameterByAU.set(key, []);
    parameterByAU.get(key).push(row);
  }
  const refs = role => {
    const source = provenance.inputs.find(x => x.role === role);
    if (!source) fail("Missing input provenance: " + role);
    return {path:source.path, sha256:source.sha256, source_uri:source.source_uri};
  };
  const rows = streamRows.map(a => {
    const l = legal.get(String(a.BIMS_INDEX));
    if (!l) fail("No legal BIMS index " + a.BIMS_INDEX);
    if (a.BIMS_CLASS !== l.class_raw) fail("Literal class disagreement " + a.AU_ID);
    const key = String(a.AU_ID);
    return {
      id:"NC:IR2022:AU:" + key,
      jurisdiction:"NC",
      au_id:a.AU_ID,
      legal_record_id:l.id,
      bims_index:a.BIMS_INDEX,
      join_method:"exact-jurisdiction-and-BIMS-index",
      literal_class_agrees:true,
      class_raw:l.class_raw,
      class_components:l.class_components,
      special_markers:l.special_markers,
      tr_hqw_orw_component:l.class_components.some(c => ["Tr","HQW","ORW"].includes(c)),
      legal_waterbody_name:l.waterbody_name,
      legal_reach_description:l.reach_description,
      legal_effective_date:l.effective_date,
      assessment_edition:"FINAL 2022",
      assessment_status_raw:a.IR2022,
      assessment_attributes:a,
      polygon_attributes:polygonByAU.get(key) || [],
      parameter_attributes:parameterByAU.get(key) || [],
      provenance:{
        assessment:{...refs("stream-attributes"), OBJECTID:a.OBJECTID},
        designation:{...refs("classification-registry"), record_id:l.id},
        polygons:(polygonByAU.get(key)||[]).map(p=>({...refs("polygon-attributes"),OBJECTID:p.OBJECTID})),
        parameters:(parameterByAU.get(key)||[]).map(p=>({...refs("parameter-attributes"),OBJECTID:p.OBJECTID,ASMT_ID:p.ASMT_ID,CYCLE:p.CYCLE}))
      }
    };
  });
  const byLegal = new Map(registry.records.map(r => [r.id, []]));
  for (const row of rows) byLegal.get(row.legal_record_id).push(row);
  const rollups = registry.records.map(l => {
    const sub = byLegal.get(l.id), labels = count(sub.map(r=>r.assessment_status_raw));
    return {
      legal_record_id:l.id,bims_index:l.original_index,waterbody_name:l.waterbody_name,
      reach_description:l.reach_description,class_raw:l.class_raw,class_components:l.class_components,
      special_markers:l.special_markers,effective_date:l.effective_date,
      assessment_unit_count:sub.length,assessment_unit_ids:sub.map(r=>r.au_id),
      assessment_status_counts:labels,mixed_assessment_labels:Object.keys(labels).length>1,
      parameter_record_count:sub.reduce((s,r)=>s+r.parameter_attributes.length,0),
      original_polygon_feature_count:sub.reduce((s,r)=>s+r.polygon_attributes.length,0)
    };
  });
  const missing = rollups.filter(r=>!r.assessment_unit_count);
  if (missing.length) fail("Selected legal records missing from assessment cohort: " + missing.map(r=>r.bims_index).join(","));
  const high = rows.filter(r=>r.tr_hqw_orw_component);
  const summary = {
    schema:"upstate.designation-assessment-summary/v1",
    jurisdiction:"NC",
    classification_edition:registry.edition,
    assessment_edition:"FINAL 2022",
    captured_at:provenance.captured_at,
    acquisition_scope:provenance.acquisition_scope,
    join_method:"exact-jurisdiction-and-BIMS-index; literal class independently compared",
    legal_records:registry.records.length,
    assessment_units:rows.length,
    distinct_bims_indices:new Set(rows.map(r=>r.bims_index)).size,
    literal_class_agreements:rows.length,
    assessment_status_counts:count(rows.map(r=>r.assessment_status_raw)),
    tr_hqw_orw_legal_records:registry.records.filter(r=>r.class_components.some(c=>["Tr","HQW","ORW"].includes(c))).length,
    tr_hqw_orw_assessment_units:high.length,
    tr_hqw_orw_status_counts:count(high.map(r=>r.assessment_status_raw)),
    other_literal_designation_status_counts:count(rows.filter(r=>!r.tr_hqw_orw_component).map(r=>r.assessment_status_raw)),
    polygon_features:polygonRows.length,
    polygon_aus:new Set(polygonRows.map(r=>r.AU_ID)).size,
    additional_aus_from_polygons:0,
    parameter_rows:parameterRows.length,
    aus_with_parameter_rows:parameterByAU.size,
    parameter_cycles:count(parameterRows.map(r=>r.CYCLE)),
    original_au_measure_units:count(streamRows.map(r=>r.AU_Units)),
    parameter_collection_years:count(parameterRows.map(r=>r.COLLECTION_YEAR)),
    parameter_rows_before_2016:parameterRows.filter(r=>/^\d{4}$/.test(String(r.COLLECTION_YEAR)) && Number(r.COLLECTION_YEAR)<2016).length,
    parameter_publisher_statuses:count(parameterRows.map(r=>r.ASMNT_STATUS)),
    aus_with_one_parameter_row:rows.filter(r=>r.parameter_attributes.length===1).length,
    aus_without_parameter_rows:rows.filter(r=>r.parameter_attributes.length===0).length,
    parameter_coverage:rows.filter(r=>r.parameter_attributes.length).map(r=>({
      au_id:r.au_id,name:r.assessment_attributes.AU_Name,parameter_rows:r.parameter_attributes.length,
      collection_years:count(r.parameter_attributes.map(p=>p.COLLECTION_YEAR)),
      criteria_labels:count(r.parameter_attributes.map(p=>p.ASMNT_CRITERIA_STATUS))
    })),
    designation_component_counts:Object.fromEntries(["Tr","HQW","ORW"].map(c=>{
      const selected=rows.filter(r=>r.class_components.includes(c));
      return [c,{assessment_units:selected.length,assessment_status_counts:count(selected.map(r=>r.assessment_status_raw))}];
    })),
    split_legal_records:rollups.filter(r=>r.assessment_unit_count>1),
    inconclusive_assessment_units:rows.filter(r=>r.assessment_status_raw==="Data Inconclusive").map(r=>({
      au_id:r.au_id,bims_index:r.bims_index,name:r.assessment_attributes.AU_Name,
      class_raw:r.class_raw,au_number:r.assessment_attributes.AU_Number,
      au_description:r.assessment_attributes.AU_Desc,
      measure:r.assessment_attributes.AU_Length,units:r.assessment_attributes.AU_Units
    }))
  };
  const flat = rows.map(r=>({
    designation_record_id:r.legal_record_id,designation_index:r.bims_index,
    designation_name:r.legal_waterbody_name,designation_description:r.legal_reach_description,
    designation_class_raw:r.class_raw,designation_components:r.class_components,
    designation_special_markers:r.special_markers,designation_effective_date:r.legal_effective_date,
    designation_tr_hqw_orw_component:r.tr_hqw_orw_component,
    parameter_row_count:r.parameter_attributes.length,polygon_feature_count:r.polygon_attributes.length,
    polygon_object_ids:r.polygon_attributes.map(p=>p.OBJECTID),
    parameter_object_ids:r.parameter_attributes.map(p=>p.OBJECTID),
    ...r.assessment_attributes
  }));
  const parameterFlat = parameterRows.map(p=>{
    const a = units.get(String(p.AU_ID)), l=legal.get(String(a.BIMS_INDEX));
    return {designation_record_id:l.id,designation_index:l.original_index,designation_class_raw:l.class_raw,
      assessment_name:a.AU_Name,assessment_number:a.AU_Number,assessment_overall_status:a.IR2022,...p};
  });
  const flags = parameterRows.filter(p=>p.PARAMETER==="Cyanide (5 mg/L, AL, FW)").map(p=>({
    au_id:p.AU_ID,object_id:p.OBJECTID,asmt_id:p.ASMT_ID,parameter_original:p.PARAMETER,
    flag:"published-label-unit-differs-from-methodology",
    methodology:"2022 NC 303(d) methodology, printed page 6",
    methodology_criterion_value:5,methodology_criterion_unit:"µg/L",
    source_uri:provenance.methodology.url,
    handling:"Original label retained; do not use its embedded mg/L value as the numeric cyanide criterion."
  }));
  summary.source_label_reconciliation=flags;
  const reviewQueue=rows.map(r=>{
    const pp=r.parameter_attributes, old=pp.filter(p=>/^\d{4}$/.test(String(p.COLLECTION_YEAR)) && Number(p.COLLECTION_YEAR)<2016);
    const reasons=[];
    if(!pp.length) reasons.push("No parameter rows in acquired assessment table");
    if(pp.some(p=>p.ASMNT_CRITERIA_STATUS==="Data Inconclusive")) reasons.push("Original parameter assessment includes Data Inconclusive");
    if(pp.some(p=>p.ASMNT_STATUS==="DRAFT")) reasons.push("Original publisher row status includes DRAFT");
    if(old.length) reasons.push(old.length+" parameter rows have collection year before 2016");
    if(flags.some(f=>f.au_id===r.au_id)) reasons.push("Cyanide source-label unit requires methodology reconciliation");
    return {
      au_id:r.au_id,assessment_number:r.assessment_attributes.AU_Number,name:r.assessment_attributes.AU_Name,
      bims_index:r.bims_index,class_raw:r.class_raw,overall_status:r.assessment_status_raw,
      parameter_rows:pp.length,parameter_object_ids:pp.map(p=>p.OBJECTID),
      collection_years:Array.from(new Set(pp.map(p=>p.COLLECTION_YEAR))),
      publisher_statuses:Array.from(new Set(pp.map(p=>p.ASMNT_STATUS))),
      review_reasons:reasons,
      suggested_next_source_review:!pp.length?"Locate current monitoring evidence for project-selected waters":
        pp.some(p=>/Temperature|Fecal|Cyanide|Iron/.test(p.PARAMETER))?"Review original ambient measurements, parameter methods and source row statuses":
        "Review original biological survey records and assessment dates",
      project_selection:"Apply original native selected-217-HUC geometry crosswalk",
      action_status:"proposed-source-review"
    };
  });
  const statuses = ["Meeting Criteria","No Data","Data Inconclusive"];
  const report = {
    schema:"upstate.observed-report/v1",
    title:"NC designated waters: published 2022 assessment context",
    edition:"20261013-nc-exact-designation-assessment",
    inputs:provenance.inputs.map(({path,bytes,sha256})=>({path,bytes,sha256})),
    sections:[
      ["How the two source systems align",[
        rows.length + " unique NC assessment units align to all " + registry.records.length +
        " retained Savannah legal schedule indices. The join uses the exact BIMS index within North Carolina. Every original assessment class label agrees literally with the retained legal label.",
        "The legal schedule describes designated uses and classifications; IR2022 contains the publisher's assessment labels. The two dimensions remain separate in every output.",
        "The assessment acquisition selects original HUC8 values 3060101 and 3060102. These counts describe that acquired source cohort. Project membership is supplied by the native selected-217-HUC geometry crosswalk.",
        {kind:"table",columns:["Source dimension","Count","Identity"],rows:[
          ["Legal schedule records",String(summary.legal_records),"NC + classification system + BIMS index"],
          ["Assessment units",String(summary.assessment_units),"NC + FINAL 2022 + AU_ID"],
          ["Alternate polygon features",String(summary.polygon_features),"Original layer 3 OBJECTID; repeats existing AU_ID"],
          ["Parameter records",String(summary.parameter_rows),"Original table 4 OBJECTID, ASMT_ID and CYCLE"]
        ]}
      ]],
      ["Assessment labels within the original designations",[
        summary.tr_hqw_orw_legal_records + " legal records contain Tr, HQW or ORW components, covering " +
        summary.tr_hqw_orw_assessment_units + " assessment units. Component membership is retained for source screening and does not replace the full legal class label or its management markers.",
        {kind:"table",columns:["Literal designation group",...statuses,"Total assessment units"],rows:[
          ["Contains Tr, HQW or ORW",...statuses.map(s=>String(summary.tr_hqw_orw_status_counts[s]||0)),String(high.length)],
          ["Other literal designations",...statuses.map(s=>String(summary.other_literal_designation_status_counts[s]||0)),String(rows.length-high.length)],
          ["All acquired NC assessment units",...statuses.map(s=>String(summary.assessment_status_counts[s]||0)),String(rows.length)]
        ]},
        "'No Data' is the publisher's IR2022 label. It describes this assessment edition and does not establish that environmental measurements are absent. 'Meeting Criteria' and 'Data Inconclusive' are preserved with the same edition-specific meaning.",
        "For the project-selected subset, use the designation and assessment layers together to distinguish protection objectives from assessment follow-up. Review the associated parameter records and current monitoring evidence before choosing a sampling or intervention location."
      ]],
      ["Keep split legal reaches at assessment-unit resolution",[
        "Four legal BIMS indices contain multiple assessment units. The record table preserves each AU_Number, original description and label; the legal rollup lists all child AU_IDs and label counts.",
        {kind:"table",columns:["BIMS index","Legal waterbody","Assessment units","Original IR2022 labels"],rows:
          summary.split_legal_records.map(r=>[r.bims_index,r.waterbody_name,r.assessment_unit_ids.join(", "),Object.entries(r.assessment_status_counts).map(([k,v])=>k+" ("+v+")").join("; ")])},
        "An exact source index establishes the documented relationship. It does not assert identical mapped extent between a legal reach and each assessment unit. Use original native geometry for project intersection and preserve the separate unit descriptions."
      ]],
      ["Inconclusive units for focused evidence review",[
        {kind:"table",columns:["AU_ID","Assessment waterbody","BIMS index","Literal class","Original measure"],rows:
          summary.inconclusive_assessment_units.map(r=>[String(r.au_id),r.name,r.bims_index,r.class_raw,String(r.measure)+" "+r.units])},
        "These four original overall labels identify a focused review set. Parameter-specific records retain their own assessment status, category, method code, collection year and cycle; those fields should drive the next source review."
      ]],
      ["Parameter cycles, alternate geometry and measured extent",[
        summary.parameter_rows + " original parameter rows cover " + summary.aus_with_parameter_rows +
        " assessment units. The table includes " + (summary.parameter_cycles["2022"]||0) +
        " rows with CYCLE 2022 and " + (summary.parameter_cycles["2020"]||0) +
        " rows with CYCLE 2020. Both cycles are retained unchanged.",
        "The " + summary.polygon_features + " polygon features repeat existing assessment-unit identities. They are alternate source geometries and add zero assessment units to the 110-unit cohort.",
        "AU_Length carries the original AU_Units, including FW Miles and FW Acres. The outputs preserve those pairs without combining incompatible units or substituting projected Shape__Length for the publisher's measure.",
        "Historical IR2008 through IR2020 fields are retained as original labels. Changes across editions require review of the agency's methods, parameter coverage and unit definitions before interpretation as environmental trends."
      ]],
      ["Parameter-level evidence that changes the review",[
        summary.parameter_rows_before_2016 + " of " + summary.parameter_rows +
        " parameter rows retain a COLLECTION_YEAR before 2016. " + summary.aus_with_one_parameter_row +
        " of the " + summary.aus_with_parameter_rows + " units with parameter records have exactly one row. " +
        summary.aus_without_parameter_rows + " acquired units have no row in this parameter table.",
        "The publisher's 2022 methodology uses a 2016–2020 data window and carries older assessments forward when newer information is unavailable (printed page 2). The service edition, original cycle, collection year, assessment date and publisher row status are separate fields.",
        {kind:"table",columns:["Assessment unit","Original evidence","Source-review implication"],rows:[
          ["Big Creek / 10475","42 parameter rows; collection years 2012 and 2014; biological and iron records include Data Inconclusive","Review the original biological and ambient records; this one unit supplies much of the acquired parameter variety."],
          ["Horsepasture / 10512","Overall Meeting Criteria; trout-temperature20°C row OBJECTID15212 is category3a / Data Inconclusive","Keep overall and parameter status visible together when reviewing trout-water monitoring needs."],
          ["Trays Island / 13394","Two fecal-coliform rows retain CYCLE2020 / DRAFT, with categories1 and3a","Retain both ASMT_ID14374 and14375 and review their separate stated reasons."]
        ]},
        String(summary.parameter_publisher_statuses.DRAFT||0) +
        " original parameter rows carry ASMNT_STATUS DRAFT. That field remains visible in parameter-join.csv and source-review-queue.csv.",
        "The rows contain assessment categories and parameter labels. Calibration of sediment or nutrient mass export requires appropriate measured concentrations, discharge and time support from the original monitoring records.",
        {kind:"table",columns:["Source-label reconciliation","Original row","Methodology"],rows:flags.map(f=>[
          f.parameter_original,"AU "+f.au_id+" / OBJECTID "+f.object_id,"Cyanide5µg/L, printed page6; original source label is retained unchanged."])},
        {kind:"links",items:[
          {title:"Original NC 2022 assessment methodology",path:provenance.methodology.url},
          {title:"All 110 units with explicit source-review actions",path:provenance.output_root+"/source-review-queue.csv"},
          {title:"Source-label reconciliation details",path:provenance.output_root+"/source-label-reconciliation.json"}
        ]}
      ]],
      ["Open and reuse the complete joined source",[
        {kind:"links",items:[
          {title:"All 110 joined assessment units and original fields",path:provenance.output_root+"/assessment-unit-join.csv"},
          {title:"All 77 parameter records with legal designation identity",path:provenance.output_root+"/parameter-join.csv"},
          {title:"All 103 legal records with assessment-unit rollups",path:provenance.output_root+"/legal-reach-rollup.csv"},
          {title:"Complete joined JSON with row provenance",path:provenance.output_root+"/designation-assessment.json"},
          {title:"Reproduction and native report opening",path:provenance.output_root+"/README.md"}
        ]}
      ]]
    ],
    source_links:provenance.inputs.map(x=>x.path).concat([
      provenance.output_root+"/assessment-unit-join.csv",provenance.output_root+"/parameter-join.csv",
      provenance.output_root+"/legal-reach-rollup.csv",provenance.output_root+"/summary.json",
      provenance.output_root+"/provenance.json",provenance.output_root+"/README.md",
      provenance.output_root+"/source-review-queue.csv",provenance.output_root+"/source-label-reconciliation.json",provenance.methodology.url])
  };
  return {summary,rows,rollups,report,reviewQueue,files:{
    "source-review-queue.csv":csv(reviewQueue,unionFields(reviewQueue)),
    "source-label-reconciliation.json":json(flags),
    "designation-assessment.json":json({schema:"upstate.designation-assessment-join/v1",summary,records:rows}),
    "assessment-unit-join.csv":csv(flat,unionFields(flat)),
    "parameter-join.csv":csv(parameterFlat,unionFields(parameterFlat)),
    "legal-reach-rollup.csv":csv(rollups,unionFields(rollups)),
    "summary.json":json(summary),
    "observed-report.json":json(report)
  }};
}
