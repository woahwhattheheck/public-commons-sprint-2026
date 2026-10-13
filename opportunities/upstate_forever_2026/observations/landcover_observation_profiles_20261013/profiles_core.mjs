/** Join retained original watershed classifications and dated station context. */
export const GROUPS = Object.freeze({
  water: [11], snow_ice: [12], developed: [21,22,23,24], barren: [31],
  forest: [41,42,43], shrub_grass: [52,71], agriculture: [81,82], wetlands: [90,95]
});
export function parseCsv(text){const rows=[];let row=[],value="",quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){value+='"';i++}else if(c==='"')quoted=false;else value+=c}else if(c==='"')quoted=true;else if(c===","){row.push(value);value=""}else if(c==="\n"||c==="\r"){if(c==="\r"&&text[i+1]==="\n")i++;row.push(value);if(row.some(x=>x!==""))rows.push(row);row=[];value=""}else value+=c}if(quoted)throw Error("CSV quotation is incomplete");if(row.length||value){row.push(value);rows.push(row)}const columns=(rows.shift()||[]).map((x,i)=>i===0?x.replace(/^\uFEFF/,""):x);for(const r of rows)if(r.length!==columns.length)throw Error("CSV source row width differs: "+r.length+"/"+columns.length);return{columns,rows:rows.map(r=>Object.fromEntries(columns.map((c,i)=>[c,r[i]]))) }}
export function toCsv(rows) {
  if (!rows.length) return "";
  const fields=Object.keys(rows[0]);
  const value=v=>v===null||v===undefined?"":Array.isArray(v)?JSON.stringify(v):String(v);
  const quote=v=>/[,"\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;
  return fields.join(",")+"\n"+rows.map(r=>fields.map(f=>quote(value(r[f]))).join(",")).join("\n")+"\n";
}
function compare(a,b) { return a < b ? -1 : a > b ? 1 : 0; }
function uniqueIndex(rows, key, label) {
  const map=new Map();
  for(const row of rows) {
    const id=row[key];
    if(typeof id!=="string"||!id||map.has(id))throw Error(label+" has missing or duplicate "+key);
    map.set(id,row);
  }
  return map;
}
function integer(value,label) {
  const number=Number(value);
  if(value===null||value===undefined||value===""||!Number.isSafeInteger(number)||number<0)throw Error("Invalid count "+label);
  return number;
}
function near(actual,expected,label) {
  if(!Number.isFinite(actual)||Math.abs(actual-expected)>Math.max(1e-8,Math.abs(expected)*1e-12))
    throw Error("Source margin differs: "+label);
}
function ids(rows,kind,role) {
  return [...new Set(rows.filter(r=>r.point_kind===kind&&(!role||r.gauge_observation_role===role))
    .map(r=>r.entity_id))].sort();
}
function words(value) {return String(value??"").split(/[|,;]/).map(x=>x.trim()).filter(Boolean);}
export function buildProfiles({annual2023,annual2025,changeRows,transitionRows,pointRows,plan}) {
  if(annual2023.schema!=="upstate.landcover-zonal-summary/v1"||
     annual2025.schema!=="upstate.landcover-zonal-summary/v1"||
     annual2023.metadata.year!==2023||annual2025.metadata.year!==2025)
    throw Error("Select the retained original 2023 and 2025 annual results");
  if(annual2023.metadata.domain_sha256!==annual2025.metadata.domain_sha256||
     JSON.stringify(annual2023.grid)!==JSON.stringify(annual2025.grid))
    throw Error("Annual results require the same original polygon source and raster grid");
  near(annual2023.method.cell_area_m2,annual2025.method.cell_area_m2,"native cell area");
  const cellHa=annual2023.method.cell_area_m2/10000;
  const before=uniqueIndex(annual2023.watersheds,"huc12","2023"),
    after=uniqueIndex(annual2025.watersheds,"huc12","2025"),
    changed=uniqueIndex(changeRows,"huc12","paired change"),
    originalPoints=uniqueIndex(plan.points,"point_id","original plan"),
    memberships=uniqueIndex(pointRows,"point_id","original membership");
  const domain=[...before.keys()].sort(), expected=[...plan.domain_ids].sort();
  if(domain.length!==217||JSON.stringify(domain)!==JSON.stringify(expected)||
     JSON.stringify(domain)!==JSON.stringify([...after.keys()].sort())||
     JSON.stringify(domain)!==JSON.stringify([...changed.keys()].sort()))
    throw Error("Require the same complete original 217-watershed domain");
  if(memberships.size!==originalPoints.size||memberships.size!==197)
    throw Error("Require the complete 197-location source edition");
  const grouped=new Map(domain.map(id=>[id,[]])), locations=[], outside=[];
  for(const [id,p]of memberships) {
    const original=originalPoints.get(id);
    if(!original||p.entity_id!==original.entity_id||p.point_kind!==original.point_kind||
       Number(p.native_epsg)!==original.wkid||Number(p.native_x)!==original.x||Number(p.native_y)!==original.y||
       integer(p.current_match_count,id)!==1||!/^[0-9]{12}$/.test(p.current_huc12))
      throw Error("Original identity or selected coordinate differs: "+id);
    const property=original.source_properties??{}, included=grouped.has(p.current_huc12);
    const row={
      point_id:id,entity_id:p.entity_id,site:p.site,point_kind:p.point_kind,
      coordinate_variant:p.coordinate_variant,native_x:original.x,native_y:original.y,native_epsg:original.wkid,
      current_huc12:p.current_huc12,current_huc12_name:p.current_huc12_name,in_landcover_domain:included,
      listed_huc12:p.listed_huc12,draft_tmdl_huc12:p.draft_tmdl_huc12,july_tmdl_huc12:p.july_tmdl_huc12,
      agency_gis_huc12:p.agency_gis_huc12,published_huc8:p.published_huc8,published_huc10:p.published_huc10,
      source_study_huc10:p.source_study_huc10,listed_comparison:p.listed_comparison,
      study_huc10_comparison:p.study_huc10_comparison,draft_tmdl_comparison:p.draft_tmdl_comparison,
      july_tmdl_comparison:p.july_tmdl_comparison,agency_gis_comparison:p.agency_gis_comparison,
      published_huc8_comparison:p.published_huc8_comparison,published_huc10_comparison:p.published_huc10_comparison,
      gauge_observation_role:p.gauge_observation_role,
      assessment_edition:property.assessment_edition??"",listed_causes:property.listed_causes??"",
      impaired_uses:property.impaired_uses??"",assessment_priority_min:property.priority_min??"",
      assessment_priority_by_cause:property.priority_by_cause??"",
      draft_tmdl_causes:property.draft_tmdl_causes??"",july_tmdl_use_support:property.tmdl_20260728_use_support??"",
      nutrient_listed:property.nutrient_listed??"",assessment_description:property.assessment_description??"",
      assessment_source_uri:property.assessment_source_uri??"",assessment_source_page:property.assessment_source_page??"",
      original_coordinate_source:p.point_source_file,original_coordinate_sha256:p.point_source_sha256,
      original_coordinate_uri:p.point_source_uri,wbd_response_path:p.query_response_path,
      wbd_response_sha256:p.query_response_sha256,wbd_query_uri:p.query_source_url
    };
    locations.push(row);
    if(included)grouped.get(p.current_huc12).push(row);else outside.push(row);
  }
  const classGroup=new Map(Object.entries(GROUPS).flatMap(([g,classes])=>classes.map(c=>[c,g])));
  const matrices=new Map(domain.map(id=>[id,new Map()]));
  for(const row of transitionRows) {
    const matrix=matrices.get(row.huc12),a=integer(row.before_class,"before class"),b=integer(row.after_class,"after class");
    if(!matrix||!classGroup.has(a)||!classGroup.has(b))throw Error("Unknown paired class or watershed");
    const key=a+":"+b;
    if(matrix.has(key))throw Error("Repeated paired class cell");
    const cells=integer(row.cells,"paired cells");near(Number(row.area_ha),cells*cellHa,"paired area");
    matrix.set(key,cells);
  }
  const groups=[],profiles=[];
  for(const huc12 of domain) {
    const a=before.get(huc12),b=after.get(huc12),c=changed.get(huc12),matrix=matrices.get(huc12);
    const selected=integer(a.selected_cells,"2023 cells");
    if(integer(b.selected_cells,"2025 cells")!==selected||integer(c.selected_cells,"paired cells")!==selected||
       a.nodata_cells!==0||b.nodata_cells!==0||matrix.size!==256)throw Error("Incomplete paired support "+huc12);
    const classBefore=new Map(a.classes.map(r=>[r.class_code,integer(r.cells,"annual2023")])),
      classAfter=new Map(b.classes.map(r=>[r.class_code,integer(r.cells,"annual2025")]));
    let stable=0,paired=0;
    for(const [code]of classGroup) {
      let first=0,last=0;
      for(const [other]of classGroup) {first+=matrix.get(code+":"+other);last+=matrix.get(other+":"+code);}
      if(first!==classBefore.get(code)||last!==classAfter.get(code))throw Error("Class margin "+huc12+":"+code);
      stable+=matrix.get(code+":"+code);paired+=first;
    }
    if(paired!==selected||stable!==integer(c.stable_class_cells,"stable")||
       selected-stable!==integer(c.changed_class_cells,"changed"))throw Error("Cell conservation "+huc12);
    near(Number(c.paired_valid_area_ha),selected*cellHa,"paired valid area");
    near(Number(c.changed_area_ha),(selected-stable)*cellHa,"changed area");
    near(Number(c.changed_percent),100*(selected-stable)/selected,"changed percent");
    const ownGroups={};
    for(const [group,codes]of Object.entries(GROUPS)) {
      const set=new Set(codes);let gain=0,loss=0;
      for(const [key,n]of matrix){const [from,to]=key.split(":").map(Number);
        if(!set.has(from)&&set.has(to))gain+=n;if(set.has(from)&&!set.has(to))loss+=n;}
      const first=codes.reduce((n,code)=>n+classBefore.get(code),0),last=codes.reduce((n,code)=>n+classAfter.get(code),0);
      if(last-first!==gain-loss)throw Error("Group conservation "+huc12+":"+group);
      const entry={huc12,name:b.properties.name,group,class_codes:codes,area_2023_ha:first*cellHa,area_2025_ha:last*cellHa,
        net_change_ha:(last-first)*cellHa,gross_gain_ha:gain*cellHa,gross_loss_ha:loss*cellHa,
        share_2023_percent:100*first/selected,share_2025_percent:100*last/selected};
      groups.push(entry);ownGroups[group]=entry;
    }
    const local=grouped.get(huc12),assessment=local.filter(r=>r.point_kind==="assessment_station"),
      causes=[...new Set(assessment.flatMap(r=>words(r.listed_causes)))].sort();
    const profile={
      huc12,name:b.properties.name,states:b.properties.states,area_ha:selected*cellHa,selected_cells:selected,
      changed_class_cells:selected-stable,changed_class_area_ha:(selected-stable)*cellHa,
      changed_class_percent:100*(selected-stable)/selected
    };
    for(const g of ["developed","forest","agriculture","wetlands"])for(const key of ["area_2023_ha","area_2025_ha","net_change_ha","gross_gain_ha","gross_loss_ha"])
      profile[g+"_"+key]=ownGroups[g][key];
    Object.assign(profile,{
      draft2026_assessment_station_count:ids(local,"assessment_station").length,
      draft2026_assessment_station_ids:ids(local,"assessment_station"),draft2026_listed_causes:causes,
      draft2026_nutrient_listed_station_ids:assessment.filter(r=>Number(r.nutrient_listed)===1).map(r=>r.entity_id).sort(),
      draft2026_priority1_station_ids:assessment.filter(r=>Number(r.assessment_priority_min)===1).map(r=>r.entity_id).sort(),
      local_gauge_count:ids(local,"usgs_gauge").length,local_gauge_ids:ids(local,"usgs_gauge"),
      local_observed_flow_gauge_count:ids(local,"usgs_gauge","observed_flow").length,
      local_observed_flow_gauge_ids:ids(local,"usgs_gauge","observed_flow"),
      local_observed_stage_only_gauge_ids:ids(local,"usgs_gauge","observed_stage_only"),
      local_inventory_only_gauge_ids:ids(local,"usgs_gauge","inventory_only"),
      retained_outfall_ids:ids(local,"npdes_outfall"),retained_lake_study_station_ids:ids(local,"study_station"),
      original_coordinate_variant_count:local.length
    });profiles.push(profile);
  }
  locations.sort((a,b)=>compare(a.point_id,b.point_id));
  const sum=key=>profiles.reduce((n,r)=>n+r[key],0);
  const byPhysical=key=>[...profiles].sort((a,b)=>b[key]-a[key]||compare(a.huc12,b.huc12)).map((r,i)=>({
    rank:i+1,huc12:r.huc12,name:r.name,value:r[key],draft2026_assessment_station_ids:r.draft2026_assessment_station_ids,
    draft2026_listed_causes:r.draft2026_listed_causes,local_observed_flow_gauge_ids:r.local_observed_flow_gauge_ids}));
  const assessment=locations.filter(r=>r.point_kind==="assessment_station");
  if(assessment.length!==87||assessment.some(r=>r.assessment_edition!=="2026 draft"))
    throw Error("Preserve the exact original 87-site draft2026 assessment");
  const entityHucs=new Map();
  for(const row of locations){const key=row.point_kind+":"+row.entity_id;if(!entityHucs.has(key))entityHucs.set(key,new Set());entityHucs.get(key).add(row.current_huc12);}
  const summary={
    schema:"upstate.landcover-observation-profiles/v1",domain_sha256:annual2025.metadata.domain_sha256,
    source_years:[2023,2025],assessment_edition:"2026 draft",watershed_count:profiles.length,
    location_variant_count:locations.length,within_domain_location_variant_count:locations.length-outside.length,
    outside_domain_location_variant_count:outside.length,
    unique_gauge_count:ids(locations,"usgs_gauge").length,
    unique_observed_flow_gauge_count:ids(locations,"usgs_gauge","observed_flow").length,
    unique_within_domain_gauge_count:ids(locations.filter(r=>r.in_landcover_domain),"usgs_gauge").length,
    unique_within_domain_observed_flow_gauge_count:ids(locations.filter(r=>r.in_landcover_domain),"usgs_gauge","observed_flow").length,
    assessment_station_count:assessment.length,
    watersheds_with_draft2026_assessment:profiles.filter(r=>r.draft2026_assessment_station_count).length,
    watersheds_with_local_observed_flow_point:profiles.filter(r=>r.local_observed_flow_gauge_count).length,
    watersheds_with_both_draft_assessment_and_local_observed_flow_point:profiles.filter(r=>r.draft2026_assessment_station_count&&r.local_observed_flow_gauge_count).length,
    selected_cells:sum("selected_cells"),area_ha:sum("area_ha"),
    changed_cells:sum("changed_class_cells"),changed_area_ha:sum("changed_class_area_ha"),
    class_groups:GROUPS,
    coordinate_variants_spanning_hucs:[...entityHucs].filter(([,h])=>h.size>1).map(([entity,h])=>({entity,huc12s:[...h].sort()})),
    outside_domain_locations:outside,
    physical_orderings:{
      developed_net_gain_ha:byPhysical("developed_net_change_ha"),
      forest_gross_loss_ha:byPhysical("forest_gross_loss_ha"),
      changed_class_percent:byPhysical("changed_class_percent")
    }
  };
  summary.changed_percent=100*summary.changed_cells/summary.selected_cells;
  return {profiles,groups,locations,summary};
}
