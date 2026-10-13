#!/usr/bin/env node
/** Original annual NLCD cell-centre areas and optional two-year transitions. */
import fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {gunzipSync,inflateSync} from "node:zlib";
import {prepareZones,summarizeRows} from "./original_landcover_zonal.mjs";
import {summarizeAnnualTransitions} from "./original_landcover_transitions.mjs";
import {readNativeClassTiff} from "./read_original_landcover.mjs";

const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const args={};
for(let i=2;i<process.argv.length;i+=2){
  const key=process.argv[i],value=process.argv[i+1];
  if(!["--domain","--source-epsg","--manifest","--before-manifest","--after-manifest","--output"].includes(key)||!value||value.startsWith("--")||key in args)
    throw Error("Use --domain FILE --output NEW_DIRECTORY with --manifest FILE or --before-manifest FILE --after-manifest FILE; optional --source-epsg 3857|4269|5070");
  args[key]=value;
}
const paired=!!(args["--before-manifest"]||args["--after-manifest"]);
if(!args["--domain"]||!args["--output"]||(paired?(!args["--before-manifest"]||!args["--after-manifest"]||args["--manifest"]):!args["--manifest"]))
  throw Error("Select the original domain, one annual manifest or a before/after pair, and a new output directory");

async function loadRaster(manifestPath){
  const manifestBytes=await fs.readFile(manifestPath),manifest=JSON.parse(manifestBytes);
  const entries=manifest.entries?.filter(x=>x.kind==="raster"&&x.role==="NLCD")??[];
  if(manifest.schema!=="upstate.sources/v1"||entries.length!==1)throw Error("Choose an ordinary manifest containing exactly one original NLCD raster");
  const entry=entries[0],parts=entry.path.split("/");
  if(path.isAbsolute(entry.path)||parts.some(p=>p===".."||p==="."||!p)||entry.path.includes("\\"))throw Error("Use the retained manifest-relative raster path");
  const rasterPath=path.resolve(path.dirname(manifestPath),entry.path),bytes=await fs.readFile(rasterPath);
  if(bytes.length!==entry.bytes||hash(bytes)!==entry.sha256)throw Error("Original TIFF differs from its source manifest: "+rasterPath);
  const source=readNativeClassTiff(bytes,inflateSync),native=entry.native_grid;
  if(entry.source_crs!=="EPSG:5070"||native?.window?.width!==source.grid.width||native.window.height!==source.grid.height||
     native.transform.length!==6||native.transform.some((x,i)=>x!==source.grid.affine[i]))
    throw Error("Original TIFF and manifest native grid differ");
  const year=Number(String(entry.source_time??"").slice(0,4));
  if(!Number.isInteger(year)||year<1900||year>2200)throw Error("Declare the original annual product source_time");
  return {...source,entry,metadata:{year,epsg:source.epsg,nodata:source.nodata,sha256:entry.sha256,
    source_id:entry.id,source_uri:entry.uri,manifest_sha256:hash(manifestBytes),raster_bytes:bytes.length}};
}
const paths=paired?[args["--before-manifest"],args["--after-manifest"]]:[args["--manifest"]];
const rasters=[];
for(const p of paths)rasters.push(await loadRaster(p));
let domainBytes=await fs.readFile(args["--domain"]);
if(domainBytes[0]===31&&domainBytes[1]===139)domainBytes=gunzipSync(domainBytes);
const domainHash=hash(domainBytes),domain=JSON.parse(domainBytes),features=domain.features;
if(!Array.isArray(features)||!features.length)throw Error("Select the original complete polygon feature collection");
const declared=domain.spatialReference?.latestWkid??domain.spatialReference?.wkid;
const sourceEpsg=args["--source-epsg"]?Number(args["--source-epsg"]):declared;
if(declared&&declared!==sourceEpsg)throw Error("Explicit source CRS differs from the original collection declaration");
if(![3857,4269,5070].includes(sourceEpsg))throw Error("Read the original geometry CRS and specify EPSG:3857, EPSG:4269 or EPSG:5070");
for(const r of rasters){
  if(r.entry.model_domain_decoded_sha256!==domainHash)throw Error("Domain bytes differ from the original raster preparation domain");
  if(r.entry.domain_feature_count!==features.length)throw Error("Original domain feature count differs");
}
const products={},annual=[];
for(const r of rasters){
  const result=await summarizeRows(prepareZones(features,sourceEpsg,r.grid),r.readRow,{...r.metadata,domain_sha256:domainHash});
  if(r.entry.metadata?.cell_count!==result.raster.cell_count||r.entry.metadata?.nodata_cells!==result.raster.nodata_count)
    throw Error("Full raster cell counts differ from the retained source manifest");
  products["landcover-"+r.metadata.year+".json"]=JSON.stringify(result,null,2)+"\n";
  annual.push(result);
}
let transitions;
if(paired){
  transitions=await summarizeAnnualTransitions(features,sourceEpsg,rasters[0].grid,rasters[1].grid,rasters[0].readRow,rasters[1].readRow,
    {before:rasters[0].metadata,after:rasters[1].metadata,domain_sha256:domainHash});
  products["landcover-transitions.json"]=JSON.stringify(transitions,null,2)+"\n";
}
const csv=(columns,rows)=>[columns.join(","),...rows.map(r=>columns.map(c=>{const s=String(r[c]??"");return /[,"\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}).join(","))].join("\n")+"\n";
const areaRows=annual.flatMap(r=>r.watersheds.flatMap(w=>w.classes.map(c=>({year:r.metadata.year,huc12:w.huc12,...c,selected_cells:w.selected_cells,nodata_cells:w.nodata_cells}))));
products["watershed-class-areas.csv"]=csv(["year","huc12","class_code","cells","area_m2","area_ha","selected_cells","nodata_cells"],areaRows);
if(transitions){
  products["watershed-class-transitions.csv"]=csv(["huc12","before_year","after_year","before_class","after_class","cells","area_ha"],
    transitions.watersheds.flatMap(w=>w.transitions.map(t=>({huc12:w.huc12,before_year:rasters[0].metadata.year,after_year:rasters[1].metadata.year,...t}))));
  products["watershed-change-summary.csv"]=csv(["huc12","paired_valid_cells","stable_class_cells","changed_class_cells","changed_percent_of_paired_valid","valid_before_only_cells","valid_after_only_cells","both_nodata_cells"],
    transitions.watersheds);
}
const inventory={schema:"upstate.original-landcover-run/v1",domain_sha256:domainHash,source_epsg:sourceEpsg,
  watershed_count:features.length,sources:rasters.map(r=>r.metadata),method:annual[0].method,
  files:Object.entries(products).map(([name,content])=>({path:name,bytes:Buffer.byteLength(content),sha256:hash(content)}))};
products["run.json"]=JSON.stringify(inventory,null,2)+"\n";
const output=path.resolve(args["--output"]);
await fs.mkdir(path.dirname(output),{recursive:true});
await fs.mkdir(output);
for(const[name,content]of Object.entries(products))await fs.writeFile(path.join(output,name),content,{flag:"wx"});
process.stdout.write(JSON.stringify({output,watersheds:features.length,years:rasters.map(r=>r.metadata.year),
  domain_cells:annual.map(r=>r.domain.unique_cells),overlap_cells:annual.map(r=>r.domain.overlap_cells),
  changed_cells:transitions?.domain.changed_class_cells,files:inventory.files.length+1})+"\n");
