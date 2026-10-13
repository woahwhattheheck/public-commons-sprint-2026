import {stationNetworkExports,rowsToCsv} from "./analysis.mjs";
import {renderStationNetworkSvg,renderStationNetworkReport} from "./report.mjs";
export function stationNetworkOutputs(analysis, observationContext=null) {
  return {...stationNetworkExports(analysis),...catchmentOutputs(analysis,rowsToCsv),
    "station-network-report.html":renderStationNetworkReport(analysis,observationContext),
    "station-network-map.svg":renderStationNetworkSvg(analysis)+"\n",
    "original-upstream-reaches.geojson":JSON.stringify({type:"FeatureCollection",features:analysis.upstream_context?.features||[]},null,2)+"\n",
    "downstream-reach-index.csv":rowsToCsv(analysis.reaches.map(r=>({nhdplus_comid:r.comid,native_feature_index:r.native_feature_index,downstream_order:r.order,approximate_whole_reach_m:r.length_m,chain_start_m:r.start_m,chain_end_m:r.end_m,source_coordinate_order_reversed:r.source_coordinate_order_reversed,original_source_path:analysis.navigation.source.path,original_source_sha256:analysis.navigation.source.sha256})))
  };
}


function catchmentOutputs(analysis,rowsToCsv) {
  if(!analysis.catchments)return {};
  const body=object=>JSON.stringify(object,null,2)+"\n";
  const features=analysis.catchments.flatMap(c=>c.features.map((f,index)=>({...f,
    properties:{...f.properties,upstate_id:c.station_id+":whole:"+index,
      upstate_station_id:c.station_id,upstate_comid:c.comid,
      upstate_source_path:c.source.path,upstate_source_sha256:c.source.sha256,
      upstate_scope:c.scope}})));
  const out={
    "original-station-catchments.geojson":body({type:"FeatureCollection",features}),
    "catchment-source-inventory.csv":rowsToCsv(analysis.catchments.map(c=>({
      station_id:c.station_id,comid:c.comid,feature_count:c.feature_count,
      polygon_count:c.polygon_count,ring_count:c.ring_count,hole_count:c.hole_count,
      vertex_count:c.vertex_count,min_longitude:c.bbox[0],min_latitude:c.bbox[1],
      max_longitude:c.bbox[2],max_latitude:c.bbox[3],original_source_path:c.source.path,
      original_source_bytes:c.source.bytes,original_source_sha256:c.source.sha256,
      original_request_uri:c.source.uri,scope:c.scope
    })))
  };
  const native=analysis.catchment_native;
  if(native){
    out["incremental-station-catchments.geojson"]=body(native.incremental_geojson);
    out["catchment-areas.csv"]=rowsToCsv(native.stations.map(s=>({
      station_id:s.station_id,comid:s.comid,area_m2:s.area_m2,area_km2:s.area_m2/1000000,
      measurement_crs:native.measurement_crs,geometry_type:s.geometry_type,
      polygon_count:s.polygon_count,interior_ring_count:s.interior_ring_count,
      vertex_count:s.vertex_count,valid:s.valid,projected_valid:s.projected_valid,
      original_source_path:s.source.path,original_source_sha256:s.source.sha256,
      native_analysis_path:native.source.path,native_analysis_sha256:native.source.sha256
    })));
    out["catchment-nesting.csv"]=rowsToCsv(native.pairs.map(p=>({...p,
      measurement_crs:native.measurement_crs,native_analysis_path:native.source.path,
      native_analysis_sha256:native.source.sha256})));
  }
  return out;
}
