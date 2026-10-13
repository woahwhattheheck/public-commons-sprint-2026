#!/usr/bin/env node
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {dirname,resolve,join} from "node:path";
import {buildRouting,csv} from "./routing_core.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=async p=>JSON.parse(await readFile(join(root,p),"utf8"));
const capture=await read("routing/capture.json");
for(const source of capture.source_files){
  const b=await readFile(join(root,source.path));
  if(b.length!==source.bytes||createHash("sha256").update(b).digest("hex")!==source.sha256)
    throw new Error("Changed original routing/quantity input: "+source.path);
}
const hydrolocations={};
for(const permit of Object.keys(capture.coordinate_basis))
  hydrolocations[permit]=await read("routing/originals/"+permit+"_hydrolocation.json");
const input={
  gauge:await read("routing/originals/gauge_reference.json"),
  basin:await read("routing/originals/gauge_whole_basin.geojson"),
  upstream:await read("routing/originals/gauge_upstream_flowlines.json"),
  projected:await read("routing/originals/state_outfalls_wgs84.json"),
  originalOutfalls:await read("dmr_outfalls_2023.geojson"),
  annual:(await read("derived/summary.json")).annual,
  hydrolocations,coordinateBasis:capture.coordinate_basis
};
const out=buildRouting(input), target=join(root,"routing/derived");
await mkdir(target,{recursive:true});
const products={
  "outfall_gauge_relations.csv":csv(out.routes),
  "annual_quantities_with_routing.csv":csv(out.annual),
  "reported_quantities_by_gauge_relation.csv":csv(out.summaries),
  "outfalls_state_geometry_wgs84.geojson":JSON.stringify(out.statePoints,null,2)+"\n",
  "outfalls_nldi_indexed_geometry.geojson":JSON.stringify(out.indexedPoints,null,2)+"\n",
  "routing_summary.json":JSON.stringify({schema:"upstate.eighteenmile-outfall-routing/v1",routes:out.routes,cohort_quantities:out.summaries},null,2)+"\n"
};
for(const [name,body] of Object.entries(products))await writeFile(join(target,name),body,"utf8");
console.log(JSON.stringify({output:target,files:Object.keys(products).length,relations:out.routes.map(r=>({permit:r.permit_id,relation:r.gauge_relation}))},null,2));
