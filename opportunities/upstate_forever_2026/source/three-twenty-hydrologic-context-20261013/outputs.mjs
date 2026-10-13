import {stationNetworkExports,rowsToCsv} from "./analysis.mjs";
import {renderStationNetworkSvg,renderStationNetworkReport} from "./report.mjs";
export function stationNetworkOutputs(analysis) {
  return {...stationNetworkExports(analysis),
    "station-network-report.html":renderStationNetworkReport(analysis),
    "station-network-map.svg":renderStationNetworkSvg(analysis)+"\n",
    "original-upstream-reaches.geojson":JSON.stringify({type:"FeatureCollection",features:analysis.upstream_context?.features||[]},null,2)+"\n",
    "downstream-reach-index.csv":rowsToCsv(analysis.reaches.map(r=>({nhdplus_comid:r.comid,native_feature_index:r.native_feature_index,downstream_order:r.order,approximate_whole_reach_m:r.length_m,chain_start_m:r.start_m,chain_end_m:r.end_m,source_coordinate_order_reversed:r.source_coordinate_order_reversed,original_source_path:analysis.navigation.source.path,original_source_sha256:analysis.navigation.source.sha256})))
  };
}
