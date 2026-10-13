function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point[1]) !== (b[1] > point[1])
        && point[0] < (b[0]-a[0]) * (point[1]-a[1]) / (b[1]-a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function inGeometry(point, geometry) {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates]
    : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
  if (!polys.length) throw new Error("Expected original Polygon or MultiPolygon basin");
  return polys.some(rings => pointInRing(point, rings[0]) && !rings.slice(1).some(r => pointInRing(point,r)));
}
function decimalSum(values) {
  const cells = values.map(v => {
    const s = String(v), m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
    if (!m) throw new Error("Non-decimal original amount: " + s);
    return {n: BigInt((m[1] || "") + m[2] + (m[3] || "")), scale:(m[3] || "").length};
  });
  const scale = Math.max(0,...cells.map(c=>c.scale));
  let n = cells.reduce((a,c)=>a+c.n*10n**BigInt(scale-c.scale),0n);
  const sign = n < 0n ? "-" : ""; if(n<0n)n=-n;
  let digits = n.toString().padStart(scale+1,"0");
  if (scale) digits = (digits.slice(0,-scale)+"."+digits.slice(-scale)).replace(/0+$/,"").replace(/\.$/,"");
  return sign+digits;
}
function haversine(a,b) {
  const rad=Math.PI/180, p=a[1]*rad,q=b[1]*rad,d=(b[1]-a[1])*rad,l=(b[0]-a[0])*rad;
  return 6371008.8*2*Math.atan2(Math.sqrt(Math.sin(d/2)**2+Math.cos(p)*Math.cos(q)*Math.sin(l/2)**2),Math.sqrt(1-(Math.sin(d/2)**2+Math.cos(p)*Math.cos(q)*Math.sin(l/2)**2)));
}
function selectedFeature(collection, predicate, description) {
  const rows=collection.features.filter(predicate);
  if(rows.length!==1)throw new Error("Expected one "+description);
  return rows[0];
}
function buildRouting(input) {
  const g=selectedFeature(input.gauge,f=>f.properties.identifier==="USGS-02186702","gauge");
  const gp=g.properties, upstream=new Set(input.upstream.features.map(f=>Number(f.properties.nhdplus_comid)));
  const metadata=new Map(input.originalOutfalls.features.map(f=>[f.properties.permit_id,f.properties]));
  const routes=input.projected.features.map(f=>{
    const permit=f.attributes.PrmtPrmtNum, statePoint=[f.geometry.x,f.geometry.y], raw=input.hydrolocations[permit];
    if(!raw)throw new Error("Missing original hydrolocation for "+permit);
    const indexed=selectedFeature(raw,f=>f.properties.source==="indexed","indexed hydrolocation");
    const supplied=selectedFeature(raw,f=>f.properties.source==="provided","provided hydrolocation");
    const h=indexed.properties, sameComid=Number(h.comid)===Number(gp.comid), sameReach=h.reachcode===gp.reachcode;
    let relation="unresolved", method="No upstream network membership";
    if(sameComid&&sameReach){
      const d=Number(h.measure)-Number(gp.measure);
      relation=d>0?"upstream":d<0?"downstream":"at_gauge";
      method="Same original NHD COMID and ReachCode; measure increases upstream";
    } else if(!sameComid&&upstream.has(Number(h.comid))){
      relation="upstream";method="Original gauge UT flowline membership on a different COMID";
    }
    const p=metadata.get(permit);if(!p)throw new Error("Missing original DMR identity "+permit);
    return {permit_id:permit,facility_name:p.facility_name,state_objectid:f.attributes.OBJECTID,state_outfall_id:p.state_outfall_id,
      state_longitude:statePoint[0],state_latitude:statePoint[1],state_coordinate_crs:"EPSG:4326",
      supplied_longitude:supplied.geometry.coordinates[0],supplied_latitude:supplied.geometry.coordinates[1],
      supplied_coordinate_basis:input.coordinateBasis[permit],
      indexed_longitude:indexed.geometry.coordinates[0],indexed_latitude:indexed.geometry.coordinates[1],
      supplied_to_indexed_distance_m:haversine(supplied.geometry.coordinates,indexed.geometry.coordinates),
      state_to_supplied_distance_m:haversine(statePoint,supplied.geometry.coordinates),
      in_original_whole_basin:input.basin.features.some(b=>inGeometry(statePoint,b.geometry)),
      gauge_id:gp.identifier,gauge_comid:Number(gp.comid),gauge_reachcode:gp.reachcode,gauge_measure:Number(gp.measure),
      outfall_comid:Number(h.comid),outfall_reachcode:h.reachcode,outfall_measure:Number(h.measure),
      outfall_comid_in_gauge_UT:upstream.has(Number(h.comid)),gauge_relation:relation,relation_method:method,
      tp_annual_kg:p.tp_annual_kg,tn_annual_kg:p.tn_annual_kg,tn_quantified_period_kg:p.tn_quantified_period_kg,
      tn_quantified_days:p.tn_quantified_days,nitrate_annual_kg:p.nitrate_annual_kg,
      ammonia_annual_kg:p.ammonia_annual_kg,ammonia_quantified_period_kg:p.ammonia_quantified_period_kg,
      ammonia_quantified_days:p.ammonia_quantified_days,tss_annual_kg:p.tss_annual_kg,
      flow_annual_million_us_gallons:p.flow_annual_million_us_gallons,
      annual_source_id:p.annual_source_id,point_identity_basis:p.dmr_point_join_basis};
  });
  const routeByPermit=new Map(routes.map(r=>[r.permit_id,r]));
  const annual=input.annual.map(a=>({...a,gauge_id:gp.identifier,gauge_relation:routeByPermit.get(a.permit_id).gauge_relation,
    in_original_whole_basin:routeByPermit.get(a.permit_id).in_original_whole_basin}));
  const summaries=[];
  for(const cohort of ["upstream","downstream","whole_basin_footprint"]){
    const permits=routes.filter(r=>cohort==="whole_basin_footprint"?r.in_original_whole_basin:r.gauge_relation===cohort).map(r=>r.permit_id).sort();
    for(const parameter of ["00665","00600","00620","00610","00530","50050"]){
      const series=annual.filter(a=>permits.includes(a.permit_id)&&a.parameter_code===parameter);
      if(!series.length)continue;
      const units=new Set(series.map(a=>a.amount_unit));if(units.size!==1)throw new Error("Incompatible amounts");
      const present=new Set(series.map(a=>a.permit_id)),missing=permits.filter(p=>!present.has(p));
      const complete=series.every(a=>a.complete_calendar_year===true);
      summaries.push({gauge_id:gp.identifier,cohort,calendar_year:2023,parameter_code:parameter,parameter_name:series[0].parameter_name,
        amount_unit:series[0].amount_unit,selected_permits:permits.join(";"),reported_permits:[...present].sort().join(";"),
        permits_without_this_reported_species:missing.join(";"),reported_series_count:series.length,
        quantified_period_sum:decimalSum(series.map(a=>a.quantified_period_total)),
        annual_sum_of_reported_series:complete?decimalSum(series.map(a=>a.annual_total)):null,
        all_reported_series_complete_year:complete,all_selected_permits_report_this_species:missing.length===0,
        selected_permit_series_cover_full_year:complete&&missing.length===0,
        period_coverage_by_series:series.map(a=>a.series_id+"="+a.quantified_days+" days").join(";"),
        series_ids:series.map(a=>a.series_id).join(";"),
        interpretation:cohort==="whole_basin_footprint"?"Whole local-catchment footprint includes locations downstream of gauge":
          "Reported facility discharge quantities assigned by source-backed NLDI relation; no in-stream attenuation or delivery applied"});
    }
  }
  const makePoints=(indexed)=>({type:"FeatureCollection",features:routes.map(r=>({type:"Feature",
    properties:{...r,geometry_role:indexed?"NLDI indexed flowline point":"Original state outfall projected by agency"},
    geometry:{type:"Point",coordinates:indexed?[r.indexed_longitude,r.indexed_latitude]:[r.state_longitude,r.state_latitude]}}))});
  return {routes,annual,summaries,statePoints:makePoints(false),indexedPoints:makePoints(true)};
}
function csv(rows) {
  if(!rows.length)return "";
  const columns=[...new Set(rows.flatMap(Object.keys))];
  const quote=v=>{let s=v===null||v===undefined?"":typeof v === "object" ? JSON.stringify(v) : String(v);return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
  return columns.join(",")+"\n"+rows.map(r=>columns.map(k=>quote(r[k])).join(",")).join("\n")+"\n";
}

export {buildRouting,csv};
