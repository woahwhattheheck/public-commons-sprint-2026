import {makeNetworkInput,ROOT,MANIFEST} from "./inputadapter.mjs";
import {parseCsv} from "./csv.mjs";
import {analyzeStationNetwork} from "./analysis.mjs";
import {stationNetworkOutputs} from "./outputs.mjs";
export {ROOT,MANIFEST};
const json=x=>JSON.stringify(x,null,2)+"\n";
export function assemble(originals,authored,inputManifest,authoredManifest,identity,nativeAnalysis=null){
 const files={};
 const add=(p,s)=>{
  if(typeof p!=="string"||!p||p.startsWith("/")||p.includes("\\")||p.split("/").some(x=>!x||x==="."||x==="..")||typeof s!=="string")throw Error("Unsafe or incomplete source member");
  if(Object.hasOwn(files,p)&&files[p]!==s)throw Error("Conflicting source member: "+p);
  files[p]=s;
 };
 if(inputManifest.schema!=="three-twenty.hydrologic-original-inputs/v1"||authoredManifest.schema!=="commons.authored-source-inputs/v1")throw Error("Retain the complete original and authored manifests.");
 if(originals.length!==inputManifest.files.length||new Set(originals.map(f=>f.path)).size!==originals.length)throw Error("Original input census changed.");
 for(const f of originals){
  const d=inputManifest.files.find(x=>x.path===f.path),actual=identity(f.content);
  if(!d||d.bytes!==actual.bytes||d.sha256!==actual.sha256||d.station!==f.station||d.role!==f.role||d.uri!==f.uri)throw Error("Original source identity changed: "+f.path);
  add(f.path,f.content);
 }
 for(const f of authoredManifest.files){
  const content=authored[f.path],actual=identity(content);
  if(actual.bytes!==f.bytes||actual.sha256!==f.sha256)throw Error("Authored source identity changed: "+f.path);
  add(f.path,content);
 }
 add(ROOT+"/input-manifest.json",json(inputManifest));
 add(ROOT+"/authored-inputs.json",json(authoredManifest));
 if(Boolean(inputManifest.native_analysis)!==Boolean(nativeAnalysis))throw Error("Retain the declared native catchment analysis with its original inputs.");
 if(nativeAnalysis){
  const d=inputManifest.native_analysis,a=identity(nativeAnalysis.content);
  if(d.path!==ROOT+"/native/catchment-analysis.json"||nativeAnalysis.path!==d.path||d.sha256!==a.sha256||d.bytes!==a.bytes||nativeAnalysis.sha256!==a.sha256||nativeAnalysis.bytes!==a.bytes||d.uri!==nativeAnalysis.uri)throw Error("Native catchment analysis identity changed.");
  const body=JSON.parse(nativeAnalysis.content);
  for(const [key,path]of [["producer",ROOT+"/native_catchments.py"],["input_descriptor",ROOT+"/native-catchment-inputs.json"]]){
   const declared=body[key],actual=identity(files[path]);
   if(!declared||declared.path!==path||declared.bytes!==actual.bytes||declared.sha256!==actual.sha256)throw Error("Native catchment reproduction source changed: "+key);
  }
  add(d.path,nativeAnalysis.content);
 }
 const input=makeNetworkInput(originals,parseCsv,nativeAnalysis),analysis=analyzeStationNetwork(input);
 const outputs=stationNetworkOutputs(analysis);
 const names=["station-network-report.html","station-network-map.svg","station-network-summary.json","station-locations.csv","station-network-pairs.csv","downstream-reach-index.csv","original-downstream-reaches.geojson","original-upstream-reaches.geojson","station-location-views.geojson","original-station-catchments.geojson","catchment-source-inventory.csv",...(nativeAnalysis?["incremental-station-catchments.geojson","catchment-areas.csv","catchment-nesting.csv"]:[])];
 if(Object.keys(outputs).length!==names.length||names.some(n=>typeof outputs[n]!=="string"))throw Error("Complete geographic output family changed.");
 for(const[name,content]of Object.entries(outputs)){if(name.includes("/"))throw Error("Unexpected output path");add(ROOT+"/"+name,content);}
 const descriptors=Object.keys(files).sort().map(path=>({path,...identity(files[path])}));
 const specs=[
  ["report","Four-station original river-network report","document","observed_water_quality_hydrologic_context","station-network-report.html"],
  ["map","Four-station original geographic map","document","observed_water_quality_figure","station-network-map.svg"],
  ["analysis","Complete four-station network analysis","document","observed_hydrologic_analysis","station-network-summary.json"],
  ["station-locations","Original and indexed monitoring station locations","vector","THREE_TWENTY_LOCATION_CONTEXT","station-location-views.geojson","id"],
  ["downstream-network","Original downstream-mainstem whole reaches","vector","THREE_TWENTY_DOWNSTREAM_NETWORK","original-downstream-reaches.geojson","nhdplus_comid"],
  ["upstream-network","Original SV-833 upstream whole reaches","vector","THREE_TWENTY_UPSTREAM_NETWORK","original-upstream-reaches.geojson","nhdplus_comid"],
  ["station-positions","Source-bound station positions and offsets","table","THREE_TWENTY_STATION_POSITIONS","station-locations.csv"],
  ["station-distances","Connected station-to-station geometric distances","table","THREE_TWENTY_NETWORK_DISTANCES","station-network-pairs.csv"],
  ["reach-index","Original downstream reach inventory and topology","table","THREE_TWENTY_DOWNSTREAM_REACH_INDEX","downstream-reach-index.csv"],
  ["whole-catchments","Original whole contributing catchments at four stations","vector","THREE_TWENTY_ORIGINAL_CATCHMENTS","original-station-catchments.geojson","upstate_id"],
  ["catchment-originals","Original contributing-catchment source inventory","table","THREE_TWENTY_CATCHMENT_INVENTORY","catchment-source-inventory.csv"],
  ...(nativeAnalysis?[
   ["incremental-catchments","Native polygon differences between consecutive stations","vector","THREE_TWENTY_INCREMENTAL_CATCHMENTS","incremental-station-catchments.geojson","id"],
   ["catchment-areas","Native EPSG5070 contributing-catchment areas","table","THREE_TWENTY_CATCHMENT_AREAS","catchment-areas.csv"],
   ["catchment-nesting","Native contributing-catchment intersections and residuals","table","THREE_TWENTY_CATCHMENT_NESTING","catchment-nesting.csv"],
   ["native-catchment-analysis","Complete native catchment geometry analysis","document","THREE_TWENTY_NATIVE_CATCHMENT_ANALYSIS","native/catchment-analysis.json"]
  ]:[])
 ];
 const entries=specs.map(([name,title,kind,role,file,idField])=>{
  const path=ROOT+"/"+file,entry={id:"three-twenty-network-"+name,title,kind,role,path,...identity(files[path]),uri:inputManifest.source_page,vintage:"Original USGS NLDI responses captured 2026-10-13",metadata:{source_schema:analysis.schema,station_count:4,downstream_whole_reaches:65,downstream_original_vertices:650,upstream_whole_reaches:45,original_inputs:18,original_whole_catchments:4,native_catchment_analysis:Boolean(nativeAnalysis),navigation_mode:"DM",navigation_distance_km:100,source_geometry:"Original geometries remain unchanged in retained sources; derived layers declare their coordinate representation or native geometry operation."},companions:descriptors.filter(d=>d.path!==path)};
  if(nativeAnalysis&&["incremental-catchments","catchment-areas","catchment-nesting","native-catchment-analysis"].includes(name))entry.metadata.measurement_crs="EPSG:5070";
  if(kind==="vector"){entry.source_crs="EPSG:4326";entry.native_id_field=idField;entry.metadata.native_id_field=idField;}
  if(file.endsWith(".svg"))entry.metadata.media_type="image/svg+xml";
  if(file.endsWith(".html")){entry.metadata.media_type="text/html";entry.metadata.report_schema=analysis.schema;}
  return entry;
 });
 add(MANIFEST,json({schema:"upstate.sources/v1",title:"Three and Twenty Creek original four-station geographic context",captured_at:"2026-10-13",entries}));
 add(ROOT+"/family.json",json({schema:"commons.file-inventory/v1",title:"Complete original four-station network source and analysis family",source_root:"opportunities/upstate_forever_2026",files:Object.keys(files).sort().map(path=>({path,...identity(files[path])}))}));
 return {files,analysis};
}
