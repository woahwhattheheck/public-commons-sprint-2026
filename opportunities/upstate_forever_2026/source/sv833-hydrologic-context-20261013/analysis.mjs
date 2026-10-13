export function analyzeSV833Hydrology(files,parseCsv) {
 const assert=(x,m)=>{if(!x)throw Error(m)},r=x=>Number(x.toFixed(9));
 const input=role=>{const f=files.find(f=>f.role===role);assert(f,"Missing source "+role);return f};
 const json=role=>JSON.parse(input(role).content);
 const feature=(role)=>{const fc=json(role);assert(fc.type==="FeatureCollection"&&Array.isArray(fc.features),"Expected original FeatureCollection");return fc.features};
 const stationFile=input("original_station_catalogue"),rawStation=parseCsv(stationFile.content).find(x=>x.MonitoringLocationIdentifier==="21SC60WQ_WQX-SV-833");assert(rawStation,"Original station absent");
 const observed=[Number(rawStation.LongitudeMeasure),Number(rawStation.LatitudeMeasure)];
 const indexed=feature("feature");assert(indexed.length===1&&indexed[0].properties.identifier===rawStation.MonitoringLocationIdentifier,"Original indexed station mismatch");
 const hydrolocation=feature("hydrolocation"),snapped=hydrolocation.find(f=>f.properties.source==="indexed"),provided=hydrolocation.find(f=>f.properties.source==="provided");
 assert(snapped&&provided&&provided.geometry.coordinates.every((v,i)=>v===observed[i]),"Original provided coordinate differs");
 const comid=Number(indexed[0].properties.comid);assert(comid===Number(snapped.properties.comid),"Index and coordinate COMIDs differ");
 const lines=feature("upstream_flowlines"),basins=feature("whole_basin"),up=feature("upstream_nwis_sites"),down=feature("downstream_nwis_sites");
 assert(new Set(lines.map(f=>f.properties.nhdplus_comid)).size===lines.length,"Repeated original COMID");
 const local=lines.find(f=>Number(f.properties.nhdplus_comid)===comid);assert(local,"Containing reach absent");
 assert(basins.length===1&&["Polygon","MultiPolygon"].includes(basins[0].geometry.type),"Unexpected basin geometry");
 const distance=(a,b)=>{const rad=Math.PI/180,p1=a[1]*rad,p2=b[1]*rad,dp=(b[1]-a[1])*rad,dl=(b[0]-a[0])*rad;const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 6371008.8*2*Math.asin(Math.sqrt(Math.min(1,h)))};
 const coords=g=>{const a=[];const walk=v=>{if(Array.isArray(v)&&v.length>=2&&typeof v[0]==="number"){assert(Number.isFinite(v[0])&&Number.isFinite(v[1]),"Invalid original coordinate");a.push(v);}else if(Array.isArray(v))v.forEach(walk)};walk(g.coordinates);return a};
 const bounds=points=>({west:Math.min(...points.map(p=>p[0])),south:Math.min(...points.map(p=>p[1])),east:Math.max(...points.map(p=>p[0])),north:Math.max(...points.map(p=>p[1]))});
 const lineLength=g=>{const lines=g.type==="LineString"?[g.coordinates]:g.type==="MultiLineString"?g.coordinates:null;assert(lines,"Expected line geometry");return lines.reduce((sum,line)=>sum+line.slice(1).reduce((s,p,i)=>s+distance(line[i],p),0),0)};
 const inRing=(p,ring)=>{let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside};
 const contains=(p,g)=>{const polygons=g.type==="Polygon"?[g.coordinates]:g.coordinates;return polygons.some(poly=>inRing(p,poly[0])&&!poly.slice(1).some(ring=>inRing(p,ring)))};
 const lineSource=input("upstream_flowlines"),siteSource=input("downstream_nwis_sites");
 const reaches=lines.map((f,i)=>({comid:Number(f.properties.nhdplus_comid),containing_station_reach:Number(f.properties.nhdplus_comid)===comid,geometry_type:f.geometry.type,vertices:coords(f.geometry).length,original_geometry_length_km:r(lineLength(f.geometry)/1000),...bounds(coords(f.geometry)),source_path:lineSource.path,source_sha256:lineSource.sha256,source_feature_index:i,source_uri:lineSource.uri}));
 const sites=[...up.map((f,i)=>({f,i,direction:"upstream_with_tributaries",source:input("upstream_nwis_sites")})),...down.map((f,i)=>({f,i,direction:"downstream_mainstem",source:siteSource}))].map(({f,i,direction,source})=>({
  site_id:f.properties.identifier,name:f.properties.name,network_relation:direction,search_distance_km:100,
  comid:Number(f.properties.comid),reachcode:f.properties.reachcode,measure:f.properties.measure,longitude:f.geometry.coordinates[0],latitude:f.geometry.coordinates[1],
  direct_geographic_separation_km:r(distance(observed,f.geometry.coordinates)/1000),source_name:f.properties.sourceName,site_uri:f.properties.uri,
  source_path:source.path,source_sha256:source.sha256,source_feature_index:i,source_uri:source.uri,
  observation_period_status:"Current parameter availability and observation period not supplied by this network-index response"
 })).sort((a,b)=>a.direct_geographic_separation_km-b.direct_geographic_separation_km||a.site_id.localeCompare(b.site_id));
 const locationComparisons=[
  {representation:"Original WQP station catalogue",longitude:observed[0],latitude:observed[1],comid:null,reachcode:"",measure:null,separation_from_original_m:0,source_path:stationFile.path,source_sha256:stationFile.sha256},
  {representation:"NLDI indexed WQP feature",longitude:indexed[0].geometry.coordinates[0],latitude:indexed[0].geometry.coordinates[1],comid,reachcode:indexed[0].properties.reachcode,measure:indexed[0].properties.measure,separation_from_original_m:r(distance(observed,indexed[0].geometry.coordinates)),source_path:input("feature").path,source_sha256:input("feature").sha256},
  {representation:"NLDI coordinate hydrolocation",longitude:snapped.geometry.coordinates[0],latitude:snapped.geometry.coordinates[1],comid,reachcode:snapped.properties.reachcode,measure:snapped.properties.measure,separation_from_original_m:r(distance(observed,snapped.geometry.coordinates)),source_path:input("hydrolocation").path,source_sha256:input("hydrolocation").sha256}
 ];
 const pointLayer={type:"FeatureCollection",features:locationComparisons.map((p,i)=>({type:"Feature",id:"sv833-location-"+i,geometry:{type:"Point",coordinates:[p.longitude,p.latitude]},properties:{id:"sv833-location-"+i,...p,station_id:rawStation.MonitoringLocationIdentifier}}))};
 const sitesLayer={type:"FeatureCollection",features:sites.map((s,i)=>({type:"Feature",id:s.site_id,geometry:{type:"Point",coordinates:[s.longitude,s.latitude]},properties:{...s,map_index:i+1}}))};
 const basinLayer={type:"FeatureCollection",features:basins.map((f,i)=>({...f,id:"sv833-whole-upstream-catchments",properties:{...f.properties,basin_id:"sv833-whole-upstream-catchments",station_id:rawStation.MonitoringLocationIdentifier,containing_comid:comid,simplified:false,split_catchment:false,source_path:input("whole_basin").path,source_sha256:input("whole_basin").sha256,source_feature_index:i}}))};
 const reachesLayer={type:"FeatureCollection",features:lines.map((f,i)=>({...f,properties:{...f.properties,...reaches[i]}}))};
 return {schema:"sv833.original-hydrologic-context/v1",station:rawStation,original_station_coordinate:observed,comid,reachcode:snapped.properties.reachcode,measure:snapped.properties.measure,
  counts:{original_nldi_responses:6,upstream_whole_reaches:lines.length,upstream_nwis_sites:up.length,downstream_nwis_sites:down.length,basin_features:basins.length,basin_vertices:coords(basins[0].geometry).length,total_network_vertices:reaches.reduce((s,x)=>s+x.vertices,0)},
  network_length_km:r(reaches.reduce((s,x)=>s+x.original_geometry_length_km,0)),
  basin_bounds:bounds(coords(basins[0].geometry)),
  original_station_inside_whole_basin:contains(observed,basins[0].geometry),
  indexed_location_inside_whole_basin:contains(snapped.geometry.coordinates,basins[0].geometry),
  location_comparisons:locationComparisons,reaches,sites,
  layers:{locations:pointLayer,downstream_sites:sitesLayer,whole_basin:basinLayer,upstream_reaches:reachesLayer},
  methods:{network_search:"Original NLDI UT and DM queries use explicit 100 km distance. Starting reach is whole and untrimmed.",
   basin:"Original unsimplified whole upstream catchments; splitCatchment=false. The local catchment is not divided at the sample point.",
   gauge_scope:"NWIS Surface Water Sites are indexed features. Query response does not establish active operation, measured parameter or sampling-period coverage.",
   distance:"Haversine from original longitude/latitude using mean Earth radius 6371008.8 m. Geographic separation is straight-line great-circle distance, not network travel distance.",
   line_length:"Sum of great-circle distances between consecutive original line vertices, reported as derived geometric length.",
   geometry:"Original GeoJSON coordinates retained unchanged in derived native layers; only provenance properties are added."
  }
 };
}
