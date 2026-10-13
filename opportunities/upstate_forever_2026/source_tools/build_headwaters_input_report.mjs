/** Reproduce the original input accounting and its five complete report files. */
import {readFile, mkdir, writeFile} from "node:fs/promises";
import {resolve, dirname, sep} from "node:path";
import {createHash} from "node:crypto";
import {analyzeInputs} from "./headwaters_input_accounting.mjs";
import {BASE, outputs} from "./headwaters_input_report_views.mjs";

const args=process.argv.slice(2), options={};
for(let i=0;i<args.length;i++){
  const key=args[i];
  if(!["--project-root","--output","--check"].includes(key) || key in options)
    throw new Error("Use --project-root ROOT with exactly one of --check or --output NEW_DIRECTORY");
  options[key]=key==="--check"?true:args[++i];
  if(options[key]===undefined)throw new Error("Missing value for "+key);
}
if(!options["--project-root"] || Boolean(options["--output"])===Boolean(options["--check"]))
  throw new Error("Use --project-root ROOT with exactly one of --check or --output NEW_DIRECTORY");
const root=resolve(options["--project-root"]);
const inside=(base,path)=>{
  const target=resolve(base,path);
  if(target===base || !target.startsWith(base+sep))throw new Error("Nonrelative source member "+path);
  return target;
};
const hash=body=>createHash("sha256").update(body).digest("hex");
const catalog=JSON.parse(await readFile(inside(root,BASE+"/source-inputs.json"),"utf8"));
if(catalog.schema!=="upstate.headwaters-input-replay/v1")throw new Error("Choose the original replay source catalog");
const originals={};
for(const [key,item] of Object.entries(catalog.sources)){
  const raw=await readFile(inside(root,item.path));
  if(raw.length!==item.bytes || hash(raw)!==item.sha256)throw new Error("Original source changed: "+item.path);
  originals[key]=raw.toString("utf8");
}
// This is the pinned numeric four-row source replay, with no quoted CSV fields.
const lines=originals.biophysical.trimEnd().split(/\r?\n/);
const fields=lines.shift().split(",");
const coefficients=lines.map(line=>{
  const cells=line.split(",");
  if(cells.length!==fields.length)throw new Error("Original coefficient table columns changed");
  return Object.fromEntries(fields.map((field,index)=>[field,cells[index]]));
});
const recipe=JSON.parse(originals.recipe),control=JSON.parse(originals.control);
const result=analyzeInputs(recipe,control,coefficients,catalog.sources);
result.source_scope={
 full_grid_cells:recipe.grid.width*recipe.grid.height,
 full_grid_area_ha:recipe.grid.width*recipe.grid.height*recipe.grid.pixel_area_ha,
 land_cover_cells:recipe.input_summary.baseline_class_cells,
 restoration_mask_cells:recipe.arrays.RESTORATION_MASK.reduce((sum,value)=>sum+value,0),
 matching_method:control.matching.method,corridor_distance_each_side_m:90
};
const generated=outputs(result),inventory=[];
const destination=options["--output"]?resolve(options["--output"]):null;
if(destination)await mkdir(destination); // Exclusive new directory; original source remains retained.
for(const [path,text] of Object.entries(generated)){
 const raw=Buffer.from(text,"utf8");
 if(options["--check"]){
  const actual=await readFile(inside(root,path));
  if(!actual.equals(raw))throw new Error("Generated report differs: "+path);
 }else{
  const target=inside(destination,path);
  await mkdir(dirname(target),{recursive:true});
  await writeFile(target,raw,{flag:"wx"});
 }
 inventory.push({path,bytes:raw.length,sha256:hash(raw)});
}
console.log(JSON.stringify({schema:"upstate.headwaters-input-replay-result/v1",
 project_root:root,output_directory:destination,mode:options["--check"]?"check":"write",
 original_sources:Object.keys(catalog.sources).length,files:inventory},null,2));
