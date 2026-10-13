// Dated current USGS WBD point intersections. All original CRS/coordinates retained.
export const geometryKey = p => JSON.stringify([p.wkid, p.x, p.y]);
export function buildObservationWatershedJoin(points, captures, domainIds) {
  const domain = new Set(domainIds), ids = new Set();
  if (domain.size !== domainIds.length || domainIds.some(id => !/^\d{12}$/.test(id))) throw Error("Invalid original domain identifiers");
  for (const p of points) {
    if (!p.point_id || ids.has(p.point_id)) throw Error("Missing or duplicate point identity");
    if (![4326,4269,26917].includes(p.wkid) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) throw Error("Invalid original coordinates: "+p.point_id);
    ids.add(p.point_id);
  }
  const byGeometry = new Map();
  for (const c of captures) {
    const key=geometryKey(c.point);
    if (byGeometry.has(key)) throw Error("Duplicate geometry capture: "+key);
    const requestGeometry=JSON.parse(c.request.query.geometry);
    if(requestGeometry.x!==c.point.x || requestGeometry.y!==c.point.y || requestGeometry.spatialReference.wkid!==c.point.wkid || Number(c.request.query.inSR)!==c.point.wkid) throw Error("Request differs from original coordinates");
    byGeometry.set(key,c);
  }
  const hucs=(value,length)=>{const s=String(value||"");return (s.match(new RegExp("\\d{"+length+"}","g"))||[]).filter(v=>new RegExp("^\\d{"+length+"}$").test(v));};
  const compare=(matches,published,length=12)=>!published.length?"no_published_huc"+length:matches.length===0?"no_current_match":matches.length>1?"multiple_current_matches":published.includes(matches[0].slice(0,length))?"matches_published_huc"+length:"differs_from_published_huc"+length;
  const pointRows=[], matchRows=[];
  for(const p of points) {
    const key=geometryKey(p),c=byGeometry.get(key);if(!c)continue;
    const body=JSON.parse(c.content);
    if(body.error || body.exceededTransferLimit || !Array.isArray(body.features))throw Error("Incomplete original response: "+p.point_id);
    const matches=body.features.map((f,index)=>{if(!f.attributes||!/^\d{12}$/.test(f.attributes.huc12))throw Error("Missing original HUC12: "+p.point_id);return {index,attributes:f.attributes};});
    const actual=matches.map(m=>m.attributes.huc12),single=matches.length===1?matches[0].attributes:null;
    const listed=hucs(p.listed_huc12,12),source8=hucs(p.published_huc8,8),source10=hucs(p.published_huc10,10),study10=hucs(p.source_study_huc10,10);
    const properties=p.source_properties||{};
    const role=p.point_kind==="usgs_gauge"?((Number(properties.observed_flow_series) || (properties.flow_method_id && Number(properties.flow_days_2023)>0))?"observed_flow":Number(properties.observed_stage_days_2023_2025)?"observed_stage_only":"inventory_only"):"";
    const row={
      point_id:p.point_id,entity_id:p.entity_id,site:p.site,point_kind:p.point_kind,input_cohort:p.input_cohort||p.point_kind,coordinate_variant:p.coordinate_variant,
      native_x:p.x,native_y:p.y,native_epsg:p.wkid,geometry_key:key,
      point_source_file:p.source_file,point_source_sha256:p.source_sha256,point_source_feature_id:p.source_feature_id,
      point_source_uri:p.coordinate_source_uri,point_source_provider:p.coordinate_source_provider,
      coordinate_method:p.coordinate_method,coordinate_quality_tier:p.coordinate_quality_tier,coordinate_source_object_id:p.coordinate_source_object_id,
      gauge_observation_role:role,observed_flow_days_2020_2025:properties.observed_flow_days_2020_2025??"",flow_days_2023:properties.flow_days_2023??"",observed_stage_days_2023_2025:properties.observed_stage_days_2023_2025??"",
      listed_huc12:p.listed_huc12,draft_tmdl_huc12:p.draft_tmdl_huc12,july_tmdl_huc12:p.july_tmdl_huc12,agency_gis_huc12:p.agency_gis_huc12,
      published_huc8:p.published_huc8,published_huc10:p.published_huc10,source_study_huc10:p.source_study_huc10||"",
      query_source_url:c.request.url,query_response_path:c.path,query_response_bytes:c.bytes,query_response_sha256:c.sha256,
      query_retrieved_on:c.retrieved_on,query_received_at:c.received_at||"",public_source_upload_id:c.upload.file_upload_id,
      query_original_point_id:c.point_id||c.site,query_reused_for_identical_geometry:(c.point_id||c.site)!==p.point_id,
      current_match_count:matches.length,current_huc12s:JSON.stringify(actual),current_huc12:single?single.huc12:"",
      current_huc12_name:single?single.name:"",current_huc10:single?single.huc12.slice(0,10):"",listed_comparison:compare(actual,listed),
      study_huc10_comparison:!study10.length?"no_study_scope_huc10":matches.length!==1?(matches.length===0?"no_current_match":"multiple_current_matches"):study10.includes(single.huc12.slice(0,10))?"matches_study_scope_huc10":"differs_from_study_scope_huc10",
      draft_tmdl_comparison:compare(actual,hucs(p.draft_tmdl_huc12,12)),july_tmdl_comparison:compare(actual,hucs(p.july_tmdl_huc12,12)),
      agency_gis_comparison:compare(actual,hucs(p.agency_gis_huc12,12)),published_huc8_comparison:compare(actual,source8,8),published_huc10_comparison:compare(actual,source10,10),
      current_huc_in_retained_domain:single?domain.has(single.huc12):"",
      any_current_match_in_retained_domain:matches.length?actual.some(id=>domain.has(id)):"",
      all_current_matches_in_retained_domain:matches.length?actual.every(id=>domain.has(id)):""
    };pointRows.push(row);
    for(const m of matches){const a=m.attributes;matchRows.push({...row,response_feature_index:m.index,matched_huc12:a.huc12,matched_name:a.name,matched_objectid:a.objectid,matched_tnmid:a.tnmid,matched_globalid:a.globalid,matched_to_huc:a.tohuc,matched_huc_type:a.hutype,matched_huc_modification:a.humod,matched_states:a.states,matched_area_acres:a.areaacres,matched_area_sqkm:a.areasqkm,matched_load_date_ms:a.loaddate,matched_load_date_utc:a.loaddate==null?"":new Date(a.loaddate).toISOString(),matched_in_retained_domain:domain.has(a.huc12),matched_in_listed_hucs:listed.length?listed.includes(a.huc12):"",original_attributes:JSON.stringify(a)});}
  }
  const completed=new Set(pointRows.map(r=>r.point_id)),grouped={};
  for(const row of pointRows.filter(r=>r.point_kind==="npdes_outfall"))(grouped[row.entity_id]??=[]).push(row);
  const outfallPairs=Object.entries(grouped).map(([entity_id,rows])=>({entity_id,completed_variants:rows.length,variants:rows.map(r=>({point_id:r.point_id,variant:r.coordinate_variant,current_huc12s:JSON.parse(r.current_huc12s),response_sha256:r.query_response_sha256})),all_three_unique_agree:rows.length===3&&rows.every(r=>r.current_match_count===1)?new Set(rows.map(r=>r.current_huc12)).size===1:null}));
  const summary={schema:"upstate.current-wbd-observation-join/v1",input_point_count:points.length,unique_input_geometries:new Set(points.map(geometryKey)).size,captured_geometry_count:captures.length,completed_point_count:pointRows.length,pending_point_ids:points.filter(p=>!completed.has(p.point_id)).map(p=>p.point_id),retained_domain_count:domain.size,matched_feature_count:matchRows.length,unique_current_match_count:pointRows.filter(r=>r.current_match_count===1).length,no_current_match_points:pointRows.filter(r=>!r.current_match_count).map(r=>r.point_id),multiple_current_match_points:pointRows.filter(r=>r.current_match_count>1).map(r=>r.point_id),listed_huc_differences:pointRows.filter(r=>r.listed_comparison==="differs_from_published_huc12").map(r=>({point_id:r.point_id,listed_huc12:r.listed_huc12,current_huc12:r.current_huc12,response_sha256:r.query_response_sha256})),unique_matches_outside_retained_domain:pointRows.filter(r=>r.current_match_count===1&&r.current_huc_in_retained_domain===false).map(r=>r.point_id),outfall_coordinate_comparisons:outfallPairs,interpretation:"Dated current USGS point intersections retain all returned polygon matches. They do not replace published assessment HUC values or establish identity with older retained domain polygon geometry. Exact CRS/x/y matches alone reuse a source query; every cohort identity is retained."};
  return {pointRows,stationRows:pointRows,matchRows,summary};
}
export function toCsv(rows) {
 if(!rows.length)return "";
 const fields=Object.keys(rows[0]),cell=value=>{const s=value==null?"":String(value);return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
 return fields.join(",")+"\n"+rows.map(row=>fields.map(key=>cell(row[key])).join(",")).join("\n")+"\n";
}
