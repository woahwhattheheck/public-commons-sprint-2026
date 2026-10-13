// Deliver completed native assessment geography through the existing report workflow.
import { createArchiveCodec } from "./archive_codec.mjs";
import { buildAnnualReferenceMaps } from "./annual_reference_maps.mjs";
import { prepareAnnualStationReport, annualStationScientificSections } from "./annual_station_report.mjs";
import { buildAssociationReport } from "./assessment_association_report.mjs";
import { zipReportFiles } from "./assessment_association_package.mjs";
import { annualReferenceInterpretation } from "./native_assessment_reviewer.mjs";
import { retainMicrobialSources, microbialScientificSections } from "./native_assessment_microbiology.mjs";
const codec = createArchiveCodec();
const json = value => JSON.stringify(value, null, 2) + "\n";
const bytes = value => typeof value === "string" ? codec.utf8Encode(value) : value;
const text = value => typeof value === "string" ? value : codec.utf8Decode(value);
const unique = values => [...new Set(values)].sort();
const identity = (path, body) => ({path, bytes: bytes(body).length, sha256: codec.sha256(bytes(body))});
const requireSame = (a, b, message) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(message); };
const table = (columns, rows, widths) => ({kind:"table", columns, rows:rows.map(row => row.map(String)), widths});
const fixed = (value, digits=2) => Number(value).toLocaleString("en-US", {minimumFractionDigits:digits, maximumFractionDigits:digits});
export const NATIVE_DELIVERY_DIRECTORY = "results/native-assessment-delivery-20261013";
export const MICROBIAL_DELIVERY_DIRECTORY = "results/native-assessment-microbial-delivery-20261013";
export const NATIVE_SOURCE_DIRECTORY = "source/annual-reference-assessment-20261013";
export const STATION_SOURCE_DIRECTORY = "source/station-assessment-context/native159-source-context-20261013";
export const ANNUAL_SOURCE_FILES = Object.freeze([
  {
    "path": "source/usgs-southeast-sparrow-2012/nitrogen-calibration.json",
    "bytes": 139120,
    "sha256": "f7e2bb7c22c644bf618d48e8fbb0729b44ab5c1f5343fb4a61261fd460911f48"
  },
  {
    "path": "source/usgs-southeast-sparrow-2012/phosphorus-calibration.json",
    "bytes": 136921,
    "sha256": "6e70bccc5666d8e4bd3389026bfc1242516817c462e4149c063b5e678c8a1ec0"
  },
  {
    "path": "source/usgs-southeast-sparrow-2012/sediment-calibration.json",
    "bytes": 107033,
    "sha256": "81b0ee67b2898e4b3c9c95a04253eb98a9f3dabc29bb5a41f463ee609041b91e"
  },
  {
    "path": "source/usgs-southeast-sparrow-2012/P9A682GW-original-metadata.xml",
    "bytes": 174636,
    "sha256": "236439342336e3ceb0fe749335f5893910793eeb6fad25cd6aad8ebe099f067d"
  },
  {
    "path": "source/usgs-southeast-sparrow-2012/service-definition.json",
    "bytes": 11453,
    "sha256": "7fd8d3587b0a6da5f63270f0ab0551ea344d9db74a62d8ddbf57cc21acc5c6fa"
  },
  {
    "path": "source/usgs-southeast-sparrow-2012/flowline-definition.json",
    "bytes": 4899,
    "sha256": "0b2822f3d1e332eb9ccf1427fd850e73f00aeb76dcde6e9fdb42cf844008b3a6"
  },
  {
    "path": "source/usgs-southeast-sparrow-2012/reach-crosswalk-1.json",
    "bytes": 16246,
    "sha256": "af3b3e5b81f969031c3799aaea16888c3d280fdcb103957e7e76c02655905442"
  },
  {
    "path": "source/usgs-southeast-sparrow-2012/reach-crosswalk-2.json",
    "bytes": 15891,
    "sha256": "a9d7f5779373f72d671372b0e1d47c57fd38b8f67b55cd3521121c96ea02961c"
  },
  {
    "path": "source/usgs-southeast-sparrow-2012/reach-crosswalk-3.json",
    "bytes": 16050,
    "sha256": "0cf0535842dd4f5f756f367cbb027c5d889b0ea1e250ae0f58fc0ce5d1a58e4f"
  },
  {
    "path": "source/usgs-southeast-sparrow-2012/reach-crosswalk-4.json",
    "bytes": 16386,
    "sha256": "a4e03d4581829d5ac0b8106d4fefbe3a6edeb6b59203e088b06c5d12bb4dbe54"
  },
  {
    "path": "source/usgs-southeast-sparrow-2012/reach-crosswalk-5.json",
    "bytes": 12341,
    "sha256": "b400a6ab05d31c8037908235efa009486b868e4a96bf39bfe9e522665283d5c2"
  },
  {
    "path": "source/usgs-southeast-sparrow-2012/nldi/basin-comid-6269342.json",
    "bytes": 27736,
    "sha256": "206b6a6654e538b188212914634a7fa1fcf11c3c55b13eca7ea124cad0b2bb62"
  },
  {
    "path": "source/usgs-southeast-sparrow-2012/nldi/basin-comid-6280111.json",
    "bytes": 63709,
    "sha256": "444ef5e5987fb5b834333c83a356c71e8e02aad486d6d8dd9e1f1a4ef54d17cb"
  },
  {
    "path": "source/usgs-southeast-sparrow-2012/nldi/basin-comid-11730084.json",
    "bytes": 37813,
    "sha256": "338793342fe1db2c63788e6970ccdb4581f7c83df8f7a7df596271078d9202e4"
  },
  {
    "path": "source/usgs-southeast-sparrow-2012/nldi/basin-comid-22724211.json",
    "bytes": 167485,
    "sha256": "992240027a83b262ffe4dcd854f4b0acce2cc45fcf6138005849e4c40a4cb89c"
  },
  {
    "path": "source/usgs-southeast-sparrow-2012/nldi/comid-22724211.json",
    "bytes": 647,
    "sha256": "5d5b2f754d06053178638a4c89c1cce2be35eeff3f3a6d7d5d504431dbe500e4"
  },
  {
    "path": "source/usgs-southeast-sparrow-2012/nldi/basin-comid-22726623.json",
    "bytes": 197133,
    "sha256": "1c73ac19a6fe22e1e5397e1e7aad07445ee71b9bbd8aab3efb4e44c079745594"
  },
  {
    "path": "source/usgs-southeast-sparrow-2012/nldi/comid-22726623.json",
    "bytes": 2306,
    "sha256": "e302840ee846b7975a5160aa2e997d629bf20fd5e774cc9ad96b9e532a83d448"
  },
  {
    "path": "source/usgs-southeast-sparrow-2012/nldi/comid-6269342.json",
    "bytes": 567,
    "sha256": "0e985e1459d067f3230b033df92ffda1c6c450e84c5bac71c30782022dec1f26"
  },
  {
    "path": "source/usgs-southeast-sparrow-2012/nldi/comid-11730084.json",
    "bytes": 803,
    "sha256": "8f181918336be3f88919755a150f1643c9984b573bd0417ca6af627bd542fa9b"
  },
  {
    "path": "source/usgs-southeast-sparrow-2012/nldi/comid-6280111.json",
    "bytes": 878,
    "sha256": "37714639a340507c5cb759f665c0e6468c9d9b88ed320cd05db12496a68180ab"
  },
  {
    "path": "source/usgs-southeast-sparrow-2012/geometry-review.json",
    "bytes": 7418,
    "sha256": "af9bf4e190b8fb70f7e2b8381615480aa2f4dc5fc011a1bf4d5a107daade47ae"
  },
  {
    "path": "source/usgs-southeast-sparrow-2012/upper-savannah-all-targets-selection.json",
    "bytes": 16329,
    "sha256": "45d7c333521a78cc5ee933993f740acc5a93c0b6acf6e7870dcc28f1752ae21d"
  }
]);
const nativePath = path => NATIVE_SOURCE_DIRECTORY + "/" + path;
export const ORIGINAL_ASSESSMENT_FILES = Object.freeze({
  "inputs/303d-2024-pdf-table-normalized.json": {
    application_path:"source/water-quality-assessments/20261013/inputs/303d-2024-pdf-table-normalized.json",
    bytes:2674649, sha256:"69e6894001fdcfa0130d8be532a31655eda22486a4044079665e8ee614eb5b0c"
  },
  "inputs/tmdl-attainment-native-20260728.json": {
    application_path:"source/water-quality-assessments/20261013/inputs/tmdl-attainment-native-20260728.json",
    bytes:1260570, sha256:"cceaf00eb0fc4cc85eabb67fbd2a9b5d843bb0cc0c7ab8da54d2108f025c2522"
  },
  "inputs/303d-2024-publisher-pdf-table-text.json": {
    application_path:"source/water-quality-assessments/20261013/inputs/303d-2024-publisher-pdf-table-text.json",
    bytes:688155, sha256:"9be7679b79ca2a8a4d4d21227ad57371b88fd6082e8b29c7efc6d9a18ab0edce"
  },
});
const RESULT_HASHES = {
  "assessment-native-huc-context.json":"bef411c2954fc3e7deb6419b1222b55c36733957700f23ff4d460b35b2b9e360",
  "annual-reference-assessment-summary.json":"a44d3a1cdb761a0850bf65ae210ad2621f3cbeda0670b48e36028090a25ee34c",
};
export function nativeDeliveryPath(path) {
  if (typeof path !== "string" || !/^[A-Za-z0-9_.\/-]+$/.test(path)
      || path.startsWith("/") || path.split("/").some(part => !part || part === "." || part === ".."))
    throw Error("Native report requires portable relative member paths");
  return path;
}
function retainNativeFiles(files) {
  if (!files?.["sources.json"]) throw Error("Retain the completed native source manifest");
  const manifest = JSON.parse(text(files["sources.json"]));
  if (manifest.schema !== "upstate.sources/v1" || manifest.entries?.length !== 4)
    throw Error("Choose the four original native geography/context source entries");
  const retained = {"sources.json": files["sources.json"]}, descriptors = new Map();
  for (const entry of manifest.entries) {
    for (const row of [entry, ...(entry.companions || [])]) {
      const path = nativeDeliveryPath(row.path), previous = descriptors.get(path);
      if (previous) requireSame([row.bytes,row.sha256],[previous.bytes,previous.sha256],"Native source declarations conflict");
      if (files[path] === undefined) throw Error("Missing native result member: " + path);
      const actual = identity(path, files[path]);
      requireSame([actual.bytes,actual.sha256],[row.bytes,row.sha256],"Native result member differs: " + path);
      descriptors.set(path,actual);retained[path]=files[path];
    }
  }
  for (const [path, expected] of Object.entries(RESULT_HASHES))
    requireSame(descriptors.get(path)?.sha256,expected,"Choose the completed original native result edition: " + path);
  return {manifest,files:retained};
}
function prefixedEntry(entry, prefix) {
  const output=JSON.parse(JSON.stringify(entry));
  output.path=prefix+nativeDeliveryPath(output.path);
  output.companions=(output.companions||[]).map(row=>({...row,path:prefix+nativeDeliveryPath(row.path)}));
  return output;
}
function retainStationSources(files, context) {
  if (!files?.["sources-complete.json"]) throw Error("Retain the original seven-entry station source manifest");
  const manifest = JSON.parse(text(files["sources-complete.json"]));
  if (manifest.schema !== "upstate.sources/v1" || manifest.entries?.length !== 7)
    throw Error("Choose the original native159 seven-entry station source edition");
  const retained = {"sources-complete.json": files["sources-complete.json"]};
  const byId = new Map();
  for (const entry of manifest.entries) {
    if (byId.has(entry.id)) throw Error("Station source IDs repeat");
    byId.set(entry.id, entry);
    for (const row of [entry, ...(entry.companions || [])]) {
      const path = nativeDeliveryPath(row.path), body = files[path];
      if (body === undefined) throw Error("Missing original station source member: " + path);
      const actual = identity(path, body);
      if (row.sha256 !== actual.sha256 || (row.bytes != null && row.bytes !== actual.bytes))
        throw Error("Original station source differs: " + path);
      retained[path] = body;
    }
  }
  for (const station of context.stations) {
    const entry = byId.get(station.native_location.source_id);
    if (!entry || entry.sha256 !== station.native_location.source_body_sha256)
      throw Error("Native location does not bind a retained original station source: " + station.station_id);
  }
  return {manifest, files:retained};
}
function retainAnnualSources(files) {
  const retained = {};
  for (const row of ANNUAL_SOURCE_FILES) {
    const body = files?.[row.path];
    if (body === undefined) throw Error("Missing original annual source: " + row.path);
    const actual = identity(row.path, body);
    requireSame([actual.bytes,actual.sha256], [row.bytes,row.sha256],
      "Original annual source differs: " + row.path);
    retained[row.path] = body;
  }
  return retained;
}
function validateRecordPointers(context, originals) {
  const parsed={};
  for(const [path,expected] of Object.entries(ORIGINAL_ASSESSMENT_FILES)){
    if(originals?.[path]===undefined)throw Error("Original assessment source is missing: "+path);
    const actual=identity(path,originals[path]);
    requireSame([actual.bytes,actual.sha256],[expected.bytes,expected.sha256],"Original assessment source differs: "+path);
    parsed[path]=JSON.parse(text(originals[path]));
  }
  let count=0;
  for(const station of context.stations){
    for(const row of station.assessment_records){
      const pointer=row.original_record_locator, source=parsed[pointer.path];
      if(!source||!/^\/records\/\d+$/.test(pointer.record_pointer))
        throw Error("Original native record pointer cannot be resolved");
      const index=Number(pointer.record_pointer.split("/").pop()),original=source.records?.[index];
      requireSame(pointer.sha256,ORIGINAL_ASSESSMENT_FILES[pointer.path].sha256,"Original pointer body identity differs");
      if(!original)throw Error("Original assessment pointer is outside the retained source");
      requireSame([original.source_id,original.id,original.site,original.source_sha256,original.source_vintage,original.huc12],
        [row.source_id,row.id,station.station_id,row.source_sha256,row.source_vintage,row.publisher_huc12],
        "Original assessment record differs from the native result pointer");
      count++;
    }
  }
  requireSame(count,context.summary.assessment_record_count,"Native source pointer count differs");
}

function verifyAnnualTargetSources(interpretation, files) {
  const directory="source/usgs-southeast-sparrow-2012/";
  const tables=new Map();
  for(const row of interpretation.rows){
    if(!tables.has(row.source_member)){
      const path=directory+row.source_member, body=files[path];
      if(body===undefined || identity(path,body).sha256!==row.source_sha256)
        throw Error("Annual yield lost its exact original target table: "+path);
      const source=JSON.parse(text(body));
      if(!Array.isArray(source.features))throw Error("Original annual table has no feature rows.");
      tables.set(row.source_member,source.features);
    }
    const matches=tables.get(row.source_member).filter(feature=>
      feature.attributes?.OBJECTID===row.original_record_id &&
      String(feature.attributes?.COMID)===row.comid);
    if(matches.length!==1)throw Error("Annual yield original target row is not unique.");
    const ordered=value=>Object.keys(value).sort().map(key=>[key,value[key]]);
    requireSame(ordered(matches[0].attributes),ordered(row.original_attributes),
      "Annual yield source row differs from the original published table.");
  }
}
function annualYieldSections(interpretation) {
  const result=[];
  for(const group of unique(interpretation.rows.map(row=>row.parameter+"/"+row.reference_basis))){
    const rows=interpretation.rows.filter(row=>row.parameter+"/"+row.reference_basis===group),first=rows[0];
    result.push(["Whole-catchment annual reference yield — "+first.reference_basis,[
      "Original annual mass: "+first.annual_mass_unit+". Whole-catchment annual yield: "+first.yield_unit+".",
      table(["Original reference / COMID","Whole basin (ha)","Annual reference mass","Annual reference yield"],
        rows.map(row=>[row.station_name+" / "+row.comid,fixed(row.whole_catchment_area_ha,2),
          fixed(row.annual_reference_mass,2),fixed(row.annual_reference_yield,6)]),[2.5,1,1.1,1.1]),
      "Each yield divides the retained original annual value by the complete selected EPSG:5070 basin area. The source basin area is independent of raster valid-cell support and of the assessment cohort's geographic extent.",
    ]]);
  }
  const p=interpretation.reference_period;
  result.push(["Annual yield source support and complete downloads",[
    "Reference year "+p.reference_year+"; source-global target horizon "+p.start+" to "+p.end_exclusive+
      " (end exclusive). Individual station sampling periods and target standard errors are not exposed in this regional source.",
    "These are published reference loads and derived reference yields, not native predictions. TSS remains the original TSS constituent; no SSC conversion, TSS_CONV adjustment or temporal multiplication is applied. The separate sediment-method sensitivity source remains separately selected.",
    "The ten original catchment-pair relations remain unchanged. Nested whole-basin totals and source-normalized yields do not create independent regional components, incremental loads or downstream delivery estimates.",
    "When native calibration is complete, its existing catchment interpretation adds the selected model's complete-support yield, partial-mass status and held-out results. Reference-only values here do not change observation admission, nominal calibration metrics or rankings.",
    {kind:"links",items:[
      {title:"All eleven reference yields, units, periods and exact source records",path:"association/annual-reference-yields.csv"},
      {title:"Complete whole-basin yield interpretation and original source attributes",path:"association/annual-reference-yields.json"},
      {title:"All ten retained original catchment-pair relationships",path:"association/annual-reference-relations.csv"},
    ]},
  ]]);
  return result;
}

function scientificSections(context, annual, report) {
  const s=context.summary, stations=context.stations, selection=context.utility_selection;
  requireSame(annual.input_sha256,context.input_sha256,"Annual and watershed results use different native inputs");
  requireSame(annual.summary.original_assessment_stations,s.station_count,"Annual station cohort differs");
  requireSame(annual.summary.original_assessment_records,s.assessment_record_count,"Annual record cohort differs");
  requireSame(annual.basins.length,annual.summary.basins,"Annual basin summary differs");
  const flat=stations.flatMap(station=>station.assessment_records.map(record=>({station,record})));
  const differences=flat.filter(row=>row.record.geometry_relation==="differs_from_geometry");
  const utilityRows=[],unionStations=stations.filter(station=>Object.values(station.utility_membership).some(row=>row.covered));
  for(const [name,counts] of Object.entries(s.utility_counts)){
    const members=new Set(selection[name]);
    const geometry=stations.filter(station=>station.utility_membership[name].covered);
    const publisher=stations.filter(station=>members.has(station.native_location.station_publisher_huc12));
    const assessments=flat.filter(row=>members.has(row.record.publisher_huc12));
    requireSame([geometry.length,geometry.reduce((sum,row)=>sum+row.assessment_records.length,0)],
      [counts.geometry_stations,counts.geometry_records],"Native utility membership summary differs");
    requireSame([publisher.length,publisher.reduce((sum,row)=>sum+row.assessment_records.length,0)],
      [counts.station_publisher_stations,counts.station_publisher_records],"Station publisher utility summary differs");
    requireSame([unique(assessments.map(row=>row.station.station_id)).length,assessments.length],
      [counts.assessment_publisher_stations,counts.assessment_publisher_records],"Assessment publisher utility summary differs");
    utilityRows.push([name,"Original point / polygon membership",counts.geometry_stations,counts.geometry_records],
      [name,"Station publisher HUC12",counts.station_publisher_stations,counts.station_publisher_records],
      [name,"Assessment publisher HUC12",counts.assessment_publisher_stations,counts.assessment_publisher_records]);
  }
  const totalTargets=annual.basins.reduce((sum,row)=>sum+row.targets.length,0);
  requireSame(totalTargets,annual.summary.targets,"Annual target summary differs");
  const names=Object.fromEntries(annual.basins.map(row=>[row.comid,row.original_target_station_names.join("; ")]));
  const basinRows=annual.basins.map(row=>[
    names[row.comid],row.comid,fixed(row.selected_basin_area_km2,3),
    row.assessment_station_count,row.assessment_record_count,
    row.targets.map(target=>({nitrogen:"TN",phosphorus:"TP",sediment:"TSS"}[target.parameter]||target.parameter)).join(", ")
  ]);
  const targetRows=annual.basins.flatMap(row=>row.targets.map(target=>{
    const original=target.original;
    requireSame(original[target.field],target.value,"Annual target differs from its retained source field");
    return [row.comid,target.parameter,fixed(target.value,2),target.unit,target.field];
  }));
  const overlapRows=annual.basin_overlaps.map(row=>[
    row.first_comid,row.second_comid,
    row.first_covers_second?"First contains second":row.second_covers_first?"Second contains first":
      row.intersection_area_km2===0?"Disjoint":"Overlap",
    fixed(row.intersection_area_km2,3),
  ]);
  const methods=[
    "The native operation reused the original Esri ring assembly, transformed native coordinates explicitly to EPSG:5070 and applied exact covers predicates. Original station coordinates, source body hashes, native feature IDs, original watershed polygons and publisher labels remain separate retained identities.",
    "PROJ operation accuracy describes the selected coordinate transformation. It is not a measured station-position or watershed-boundary error bound. The native result reports no snapped points, no geometry corrections and no tested point within the combined reported transformation accuracy of a boundary.",
    "The annual targets retain reference year 2012 and the source-global horizon 1 October 1999 through 30 September 2014. The 2024 assessment edition covers 2018–2022; July 2026 TMDL status remains a separate edition. Geographic coverage does not make those periods contemporaneous.",
    "Annual nitrogen and phosphorus use the original ACTUAL field in kg/year. Sediment uses ACTUAL_MT in metric tonnes/year. Original prediction fields remain separate, already annual rates are not multiplied by the horizon length, and TSS_CONV is not reapplied.",
    "Annual TN means total nitrogen in its source field. SCDES water-classification TN means Trout Natural. The source roles and original field names distinguish them."
  ];
  return [
    ["Physical assessment coverage and original publisher labels",[
      "This report connects the completed calculation for 159 original station points and 217 watersheds to the 192 published assessment records and five original annual-reference catchments. All point and assessment identities have been checked against the retained source bytes.",
      table(["Native comparison","Result"],[
        ["Original stations / assessment records",s.station_count+" / "+s.assessment_record_count],
        ["Original HUC polygons",s.domain_huc_count],
        ["Points with exactly one HUC match",s.geometry_match_counts["1"]||0],
        ["Station publisher HUC12 agrees with geometry",s.station_publisher_relations.matches_geometry],
        ["Station publisher supplies HUC8 without HUC12",s.station_publisher_relations.no_publisher_huc12],
        ["Assessment publisher HUC12 agrees / differs",s.assessment_publisher_relations.matches_geometry+" / "+s.assessment_publisher_relations.differs_from_geometry],
      ],[4,1.7]),
      "The seven HUC8-only station sources now have native point/polygon membership while their original publisher HUC8 fields remain unchanged. Each edition-specific assessment attribution remains attached to its original source record.",
    ]],
    ["Utility programme coverage by explicit selection basis",[
      table(["Utility","Selection basis","Stations","Assessment records"],utilityRows,[0.7,3,1,1]),
      "The physical union contains "+unionStations.length+" distinct stations and "+
        unionStations.reduce((sum,row)=>sum+row.assessment_records.length,0)+" assessment records. Counts are based on the original network union of upstream and focal HUCs for each utility.",
      "RS-21014 is physically in Little Beaverdam Creek, HUC12 030601020506. Its station publisher reports HUC8 03060102; all three original 2024 assessment records report the matching HUC12. Its point is 351.42 m from the containing HUC/utility boundary.",
      "SV-809 is physically in Lower Tugaloo River, HUC12 030601020507, matching its original station publisher. Its July 2026 E. coli assessment publishes 030601010305. Physical PRWD selection includes this original record while preserving its original assessment attribution.",
    ]],
    ["Six original assessment-edition watershed differences",[
      table(["Station","Assessment HUC12","Geometric HUC12","Geometric watershed","Inside boundary (m)"],
        differences.map(({station,record})=>[
          station.station_id,record.publisher_huc12,station.geometry_huc12s.join("; "),
          station.matches.map(row=>row.name).join("; "),
          station.matches.map(row=>fixed(row.distance_to_boundary_m,2)).join("; "),
        ]),[0.8,1.2,1.2,1.7,0.8]),
      "These six July 2026 source records differ from the geometric watershed. RS-06190's separate 2024 record agrees with the native match. The interactive report and 192-record CSV preserve both editions and every source identity.",
    ]],
    ["Annual-reference catchments and assessment coverage",[
      table(["Original annual reference","COMID","Area (km²)","Sites","Records","Constituents"],basinRows,[1.8,0.8,0.9,0.55,0.65,0.9]),
      "Both downstream Savannah basins contain all 159 selected sites and 192 records. Chattooga contains one selected site, Broad contains none of this South Carolina cohort, and Stevens Creek contains 18 sites and 20 records. These are cohort-specific coverage counts.",
      "The three tributary catchments are mutually disjoint and nested within both downstream basins. Jackson is itself contained in Cohens. Preserve those actual relationships in the maintained calibration/validation grouping; do not add downstream coverage to tributary coverage as though the sites were distinct.",
      table(["First COMID","Second COMID","Original geometric relationship","Intersection (km²)"],overlapRows,[1.0,1.0,2.7,1.0]),
    ]],
    ["Original annual targets and constituent interpretation",[
      table(["COMID","Constituent","Published annual value","Unit","Original source field"],targetRows,[0.9,1,1.3,1.4,1.1]),
      "Displayed annual values are rounded to two decimals and basin areas to three. Original JSON and CSV files retain their full precision.",
      "The seven tributary targets are Chattooga TN/TP/TSS, Broad TP/TSS and Stevens TN/TP. The selected Stevens assessment cohort includes bacterial and biological concerns; its annual nutrient targets address different constituents. Broad's zero selected assessment sites describes this South Carolina source cohort, not the Georgia catchment's condition.",
      "Chattooga and Broad supply the two sediment references. Their TSS targets do not measure the Upper Three And Twenty Creek priority area; that area's selected turbidity records lie within the broader downstream reference coverage.",
      ...methods,
    ]],
    ["Complete native results, original records and existing application use",[
      "Import the included source manifest to retain the four original native vector/table entries, seven original station/assessment source entries, the interactive assessment report and this scientific report recipe. The existing Spatial Review opens the derived original-point layer; Annual load observations retains the actual target/catchment intake and calibration actions.",
      {kind:"links",items:[
        {title:"Interactive assessment report with native watershed membership",path:"association/OPEN_ASSESSMENT_ASSOCIATIONS.html"},
        {title:"Original author's physical-coverage interpretation",path:nativePath("README.md")},
        {title:"Complete native station and watershed context",path:nativePath("assessment-native-huc-context.json")},
        {title:"Original eleven annual targets and catchment relationships",path:nativePath("annual-reference-assessment-summary.json")},
        {title:"All 795 original basin/station membership decisions",path:nativePath("annual-reference-station-memberships.csv")},
        {title:"Derived 159-point layer for existing Spatial Review",path:nativePath("assessment-geography-context.geojson")},
      ]},
    ]],
  ];
}
export function composeNativeAssessmentDelivery({nativeFiles, assessmentInputs, originalAssessmentFiles, stationSourceFiles, annualSourceFiles, microbialFiles, microbialOriginalFiles, nationalInventory, nationalOriginalFiles}) {
  const retained=retainNativeFiles(nativeFiles);
  const context=JSON.parse(text(retained.files["assessment-native-huc-context.json"]));
  const annual=JSON.parse(text(retained.files["annual-reference-assessment-summary.json"]));
  validateRecordPointers(context,originalAssessmentFiles);
  const stationSources=retainStationSources(stationSourceFiles,context);
  const annualSources=retainAnnualSources(annualSourceFiles);
  const annualYields=annualReferenceInterpretation(annual);
  verifyAnnualTargetSources(annualYields,annualSources);
  if ((nationalInventory === undefined) !== (nationalOriginalFiles === undefined))
    throw Error("Retain both the original national inventory and its complete source files.");
  const national=nationalInventory===undefined?null:prepareAnnualStationReport({
    regional:annualYields,inventoryText:nationalInventory,originalFiles:nationalOriginalFiles});
  const annualMaps=buildAnnualReferenceMaps({annual,annualSourceText:text(retained.files["annual-reference-assessment-summary.json"]),originalFiles:annualSources});
  if ((microbialFiles === undefined) !== (microbialOriginalFiles === undefined))
    throw Error("Retain both the measured source edition and its complete original provenance.");
  const microbial=microbialFiles===undefined?null:retainMicrobialSources(microbialFiles,microbialOriginalFiles,context);
  const report=buildAssociationReport({...assessmentInputs,geography:text(retained.files["assessment-native-huc-context.json"]),
    nativeAnnualContext:text(retained.files["annual-reference-assessment-summary.json"]),nativeAnnualMaps:annualMaps,
    ...(national?{nationalStationReport:national}:{}),
    ...(microbial?{nativeMicrobialContext:microbial.files["microbial-assessment-overlap.json"],
      nativeMicrobialObservations:microbial.files["microbial-assessment-observations.csv"]}:{})});
  const files={};
  for(const [path,body] of Object.entries(retained.files))files[nativePath(path)]=body;
  for(const [path,body] of Object.entries(stationSources.files))files[STATION_SOURCE_DIRECTORY+"/"+path]=body;
  for(const [path,body] of Object.entries(annualSources))files[path]=body;
  for(const [path,body] of Object.entries(originalAssessmentFiles)) {
    nativeDeliveryPath(path);
    if(!(path in ORIGINAL_ASSESSMENT_FILES))throw Error("Undeclared original assessment member");
    files[nativePath(path)]=body;
  }
  for(const [path,body] of Object.entries(report.files))files["association/"+path]=body;
  if (microbial) {
    for (const [path,body] of Object.entries(microbial.files)) files[nativePath(path)]=body;
    for (const [path,body] of Object.entries(microbial.originalFiles)) {
      nativeDeliveryPath(path);
      if (files[path] !== undefined && text(files[path]) !== text(body)) throw Error("Original source path collision: "+path);
      files[path]=body;
    }
  }
  const sections=scientificSections(context,annual,report);
  const yieldPosition=sections.findIndex(section=>section[0]==="Complete native results, original records and existing application use");
  if(yieldPosition<0)throw Error("Retain the current native report source section.");
  sections.splice(yieldPosition,0,...annualYieldSections(annualYields),
    ...(national?annualStationScientificSections(national):[]));
  const mapSvg=identity("association/annual-reference-basins.svg",annualMaps.files["annual-reference-basins.svg"]);
  const componentSvg=identity("association/annual-reference-original-components.svg",annualMaps.files["annual-reference-original-components.svg"]);
  const mapIndex=sections.findIndex(row=>row[0]==="Annual-reference catchments and assessment coverage");
  if(mapIndex<0)throw Error("Retain the original annual catchment section.");
  sections.splice(mapIndex,0,["Five original annual-reference basin footprints",[
    {kind:"figure",...mapSvg,title:"Whole-basin support for eleven original annual targets",
      alt:"Five original annual-reference catchments with their original NLDI reference reaches, COMIDs and whole-basin areas.",
      caption:"All selected original polygon vertices are retained. The three tributaries are mutually disjoint and lie within both downstream Savannah basins; Jackson is nested in Cohens. EPSG:3857 is used only to display the geometry. Whole-basin yields continue to use the original EPSG:5070 areas; overlapping basin totals are not independent regional parts.",spec:annualMaps.figure},
    {kind:"links",items:[
      {title:"Full interactive map and original source tables",path:"association/OPEN_ASSESSMENT_ASSOCIATIONS.html"},
      {title:"Selected original basin components",path:"association/annual-reference-selected-basins.geojson"},
      {title:"Every original basin component, including exclusions",path:"association/annual-reference-original-components.geojson"},
      {title:"Display projection and exact original geometry bindings",path:"association/annual-reference-basin-map.json"}]},
  ]]);
  sections.splice(sections.length-1,0,["Original basin component selection",[
    "The retained original component review selected Jackson component 0 and Cohens components 0 and 1. Their separate remote Virginia triangles remain in the original source bank and are displayed as excluded outlines. The small local Cohens component remains selected. This presentation does not change the original source geometry, area or annual target.",
    {kind:"figure",...componentSvg,title:"Selected footprints and retained excluded source components",
      alt:"The selected Savannah basin components and the excluded remote original components retained for source inspection.",
      caption:"Filled polygons are selected original reference components. Outline-only remote components remain downloadable original source geometry and carry no reference load allocation. Web Mercator coordinates and grid distances are display quantities, not replacement basin areas or ground-distance estimates.",spec:annualMaps.componentFigure},
  ]]);
  if (microbial) {
    sections.splice(3,0,...microbialScientificSections(microbial.bound.coverage,NATIVE_SOURCE_DIRECTORY+"/"));
    sections[sections.length-1][1][0]="Import the included 17-entry source manifest to retain four original native vector/table entries, seven original station/assessment entries, four original measured microbial entries, the interactive assessment report and this scientific report recipe. Existing Spatial Review opens the original-point layers; Annual load observations retains the target/catchment intake and calibration actions.";
  }
  const reportId="native-assessment-observed-"+RESULT_HASHES["assessment-native-huc-context.json"].slice(0,20)+
    (microbial?"-microbial-"+microbial.bound.source.context_sha256.slice(0,12):"")+"-annual-yields-basin-maps-v1"+
    (national?"-national-"+national.binding.context.sha256.slice(0,16):"");
  const inputs=Object.entries(files).map(([path,body])=>identity(path,body));
  const recipe={schema:"upstate.observed-report/v1",title:microbial?"Physical assessment coverage, measured E. coli and annual references":"Physical assessment coverage, utility selection and annual references",
    edition:microbial?"original-native-assessment-microbial-context-20261013-v3-annual-basin-maps":"original-native-assessment-context-20261013-v3-annual-basin-maps",vintage:"2026-10-13",
    interpretation_kind:"completed_native_geography_and_original_assessment_context",
    inputs,sections,source_links:[nativePath("README.md"),nativePath("sources.json"),nativePath("assessment-native-huc-context.json"),
      nativePath("annual-reference-assessment-summary.json"),"association/sources.json","association/OPEN_ASSESSMENT_ASSOCIATIONS.html",
      "association/annual-reference-yields.csv","association/annual-reference-yields.json","association/annual-reference-relations.csv",
      ...Object.keys(annualMaps.files).map(path=>"association/"+path)]};
  if (national) {
    recipe.national_annual_station_context=national.binding;
    recipe.edition+="-national-station-context-v1";
    recipe.source_links.push(...Object.keys(national.files).map(path=>"association/"+path),...Object.keys(national.originalFiles).map(path=>"association/"+path));
  }
  if (microbial) {
    recipe.measured_source_context=microbial.bound.source;
    recipe.source_links.push(nativePath("microbial-assessment-sources.json"),nativePath("MICROBIAL_COVERAGE.md"),
      "source/ecoli_temporal_analysis/20261013/source-manifest.json","source/ecoli_utility_context/20261013/source-manifest.json");
  }
  const available=new Set(Object.keys(files));
  for(const [,blocks] of sections)for(const block of blocks){
    if(typeof block==="string")continue;
    if(block.kind==="table"&&(block.columns.length!==block.widths.length||block.rows.some(row=>row.length!==block.columns.length)))
      throw Error("Native scientific report has inconsistent table columns");
    if(block.kind==="links"&&block.items.some(item=>!available.has(item.path)))
      throw Error("Native scientific report links an unretained member");
  }
  files["observed-report.json"]=json(recipe);
  const nativeEntries=retained.manifest.entries.map(row=>prefixedEntry(row,NATIVE_SOURCE_DIRECTORY+"/"));
  const stationEntries=stationSources.manifest.entries.map(row=>prefixedEntry(row,STATION_SOURCE_DIRECTORY+"/"));
  const microbialEntries=microbial?microbial.manifest.entries.map(row=>prefixedEntry(row,NATIVE_SOURCE_DIRECTORY+"/")):[];
  const allOriginalEntries=[...nativeEntries,...stationEntries,...microbialEntries];
  const relationship=row=>microbialEntries.includes(row)?"original_measured_microbial_source":
    nativeEntries.includes(row)?"original_native_geometry_context":"original_station_and_assessment_edition";
  const associationManifest=JSON.parse(report.files["sources.json"]);
  const document=prefixedEntry(associationManifest.entries[0],"association/");
  document.metadata={...(document.metadata||{}),related_source_ids:allOriginalEntries.map(row=>row.id),
    source_relationships:allOriginalEntries.map(row=>({id:row.id,relationship:relationship(row)}))};
  const observed={id:reportId,title:recipe.title,kind:"document",role:"OBSERVED_CONTEXT",vintage:recipe.vintage,
    uri:retained.manifest.entries[0].uri,...identity("observed-report.json",files["observed-report.json"]),
    companions:inputs,metadata:{related_source_ids:[document.id,...allOriginalEntries.map(row=>row.id)],
      source_relationships:[{id:document.id,relationship:"interactive_native_assessment_report"},
        ...allOriginalEntries.map(row=>({id:row.id,relationship:relationship(row)}))]}};
  const manifest={schema:"upstate.sources/v1",title:recipe.title,entries:[...allOriginalEntries,document,observed],
    notes:["Original native result/source roles remain retained; completed geometry and publisher labels are distinct.",
      "The existing Annual load observations and calibration actions receive the original targets and catchments."]};
  if (new Set(manifest.entries.map(row=>row.id)).size !== manifest.entries.length) throw Error("Combined source IDs repeat");
  files["sources.json"]=json(manifest);
  const archive=zipReportFiles(files,{compress:true}),archiveDescriptor=identity(microbial?"native-assessment-microbial-delivery.zip":"native-assessment-delivery.zip",archive);
  const inventory={schema:"commons.artifacts/v1",title:recipe.title,source_id:reportId,
    interactive_source_id:report.sourceId,archive:{...archiveDescriptor,manifest_member:"sources.json"},
    files:Object.entries(files).map(([path,body])=>identity(path,body))};
  files[archiveDescriptor.path]=archive;files["artifacts.json"]=json(inventory);
  return {files,manifest,recipe,report,archive:inventory.archive,inventory,directory:microbial?MICROBIAL_DELIVERY_DIRECTORY:NATIVE_DELIVERY_DIRECTORY};
}
