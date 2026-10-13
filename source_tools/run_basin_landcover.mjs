#!/usr/bin/env node
/** Replay retained named-basin annual and paired original land-cover results. */
import fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {inflateSync} from "node:zlib";
import {prepareZones,summarizeRows} from "./original_landcover_zonal.mjs";
import {summarizeAnnualTransitions} from "./original_landcover_transitions.mjs";
import {readNativeClassTiff} from "./read_original_landcover.mjs";

const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const args={};
for(let i=2;i<process.argv.length;i+=2){
  const key=process.argv[i],value=process.argv[i+1];
  if(!["--recipe","--application-root","--output"].includes(key)||!value||value.startsWith("--")||key in args)
    throw Error("Use --recipe FILE --application-root DIRECTORY --output NEW_DIRECTORY");
  args[key]=value;
}
if(!args["--recipe"]||!args["--application-root"]||!args["--output"])
  throw Error("Select the retained recipe, actual application and a new output directory");
const root=await fs.realpath(args["--application-root"]);
async function sourcePath(name,base=root){
  if(!name||path.isAbsolute(name)||name.includes("\\")||name.split("/").some(p=>!p||p===".."||p==="."))
    throw Error("Expected a retained relative source path");
  const result=await fs.realpath(path.resolve(base,name));
  if(result!==root&&!result.startsWith(root+path.sep))throw Error("Source resolves outside the actual application");
  return result;
}
const recipeBytes=await fs.readFile(args["--recipe"]),recipe=JSON.parse(recipeBytes);
if(recipe.schema!=="upstate.basin-landcover-recipe/v1"||recipe.basin.epsg!==4326)
  throw Error("Select the retained original geographic basin recipe");
const polygonBytes=await fs.readFile(await sourcePath(recipe.basin.path));
if(polygonBytes.length!==recipe.basin.bytes||hash(polygonBytes)!==recipe.basin.sha256)
  throw Error("Original basin body differs from its retained recipe");
const domain=JSON.parse(polygonBytes);
if(domain.type!=="FeatureCollection"||domain.features.length!==1)
  throw Error("This receiving recipe binds one original basin feature");
if(domain.crs)throw Error("This recipe requires original RFC7946 geographic coordinates without a conflicting CRS declaration");
const features=domain.features.map(f=>({...f,properties:{...f.properties,
  basin_id:recipe.basin.basin_id,name:recipe.basin.name,footprint:recipe.basin.footprint}}));
const selection={idField:"basin_id",nameField:"name",identifierKind:"basin"};
const years=Object.keys(recipe.source_manifests).map(Number).sort((a,b)=>a-b);
if(years.length!==2||years[0]>=years[1])throw Error("Select exactly two increasing source years");
const rasters=[];
for(const year of years){
  const manifestPath=await sourcePath(recipe.source_manifests[year]);
  const manifest=JSON.parse(await fs.readFile(manifestPath));
  const entries=manifest.entries?.filter(e=>e.kind==="raster"&&e.role==="NLCD")??[];
  if(manifest.schema!=="upstate.sources/v1"||entries.length!==1)
    throw Error("Select one ordinary original NLCD source entry");
  const entry=entries[0],rasterBytes=await fs.readFile(await sourcePath(entry.path,path.dirname(manifestPath)));
  const metadata=recipe.annual_metadata[year];
  if(entry.sha256!==metadata.raster_sha256||rasterBytes.length!==entry.bytes||
     hash(rasterBytes)!==entry.sha256||Number(String(entry.source_time).slice(0,4))!==year)
    throw Error("Annual TIFF differs from the retained original source selection");
  const raster=readNativeClassTiff(rasterBytes,inflateSync),native=entry.native_grid;
  if(entry.source_crs!=="EPSG:5070"||native?.window?.width!==raster.grid.width||
     native.window.height!==raster.grid.height||native.transform.length!==6||
     native.transform.some((v,i)=>v!==raster.grid.affine[i]))
    throw Error("Original source manifest and actual TIFF grid differ");
  rasters.push({...raster,year,metadata});
}
const products={},annual=[];
for(const raster of rasters){
  const result=await summarizeRows(prepareZones(features,4326,raster.grid,selection),raster.readRow,raster.metadata);
  annual.push(result);
  products["annual-"+raster.year+".json"]=JSON.stringify(result,null,2)+"\n";
}
const paired=await summarizeAnnualTransitions(features,4326,rasters[0].grid,rasters[1].grid,
  rasters[0].readRow,rasters[1].readRow,recipe.paired_metadata,selection);
for(const row of paired.basins[0].classes){
  const before=annual[0].basins[0].classes.find(x=>x.class_code===row.class_code);
  const after=annual[1].basins[0].classes.find(x=>x.class_code===row.class_code);
  if(row.before_cells!==before.cells||row.after_cells!==after.cells)
    throw Error("Paired basin class margin differs from independent annual inventory");
}
products["transitions-"+years[0]+"-"+years[1]+".json"]=JSON.stringify(paired,null,2)+"\n";
for(const [name,body]of Object.entries(products)){
  const expected=recipe.expected_outputs[name];
  if(!expected||Buffer.byteLength(body)!==expected.bytes||hash(Buffer.from(body))!==expected.sha256)
    throw Error("Actual replay differs from the retained full result: "+name);
}
const output=path.resolve(args["--output"]);
await fs.mkdir(output,{recursive:false});
for(const [name,body]of Object.entries(products))await fs.writeFile(path.join(output,name),body,{flag:"wx"});
const receipt={schema:"upstate.basin-landcover-replay/v1",operation_id:recipe.operation_id,
  basin_id:recipe.basin.basin_id,footprint:recipe.basin.footprint,
  recipe_sha256:hash(recipeBytes),original_polygon_sha256:hash(polygonBytes),
  years,files:Object.entries(products).map(([name,body])=>({path:name,bytes:Buffer.byteLength(body),sha256:hash(Buffer.from(body))})),
  paired_cells:paired.domain.paired_valid_cells,changed_cells:paired.domain.changed_class_cells,
  changed_percent:paired.domain.changed_percent_of_paired_valid,output};
await fs.writeFile(path.join(output,"replay.json"),JSON.stringify(receipt,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify(receipt,null,2));
