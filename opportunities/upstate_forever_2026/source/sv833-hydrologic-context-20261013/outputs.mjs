import {writeCsv} from "../../observations/sv833_2021_2026/csv.mjs";
import {renderSV833HydrologyFigure} from "./figures.mjs";
import {renderSV833HydrologyReport} from "./report.mjs";
export function sv833HydrologyOutputs(result,manifest){
 const figure=renderSV833HydrologyFigure(result);
 const summary={...result};delete summary.layers;
 return{
  "station-location-representations.csv":writeCsv(result.location_comparisons),
  "upstream-reach-inventory.csv":writeCsv(result.reaches),
  "downstream-nwis-site-context.csv":writeCsv(result.sites),
  "station-location-representations.geojson":JSON.stringify(result.layers.locations,null,2)+"\n",
  "upstream-original-reaches.geojson":JSON.stringify(result.layers.upstream_reaches,null,2)+"\n",
  "whole-upstream-catchments.geojson":JSON.stringify(result.layers.whole_basin,null,2)+"\n",
  "downstream-nwis-sites.geojson":JSON.stringify(result.layers.downstream_sites,null,2)+"\n",
  "hydrologic-context-summary.json":JSON.stringify({...summary,input_files:manifest.files},null,2)+"\n",
  "sv833-hydrologic-context.svg":figure,
  "sv833-hydrologic-context.html":renderSV833HydrologyReport(result,figure,manifest)
 };
}
