#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";
import {buildProfiles,parseCsv,toCsv} from "./profiles_core.mjs";
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,"../..");
const args=process.argv.slice(2);
if(args.some(x=>x!=="--check"))throw Error("Usage: node rebuild.mjs [--check]");
const manifest=JSON.parse(fs.readFileSync(path.join(here,"input-manifest.json"),"utf8"));
if(manifest.schema!=="upstate.landcover-observation-inputs/v1")throw Error("Choose the original complete source binding");
const hash=b=>crypto.createHash("sha256").update(b).digest("hex");
const safe=(name,{allowMissing=false}={})=>{
  if(typeof name!=="string"||name.includes("\\")||path.posix.isAbsolute(name)||
     name.split("/").some(part=>!part||part==="."||part===".."||part.includes(":")))
    throw Error("Select an application-relative source path");
  const full=path.join(root,name), resolved=allowMissing&&!fs.existsSync(full)
    ?path.join(fs.realpathSync(path.dirname(full)),path.basename(full)):fs.realpathSync(full);
  if(resolved!==root&&!resolved.startsWith(root+path.sep))throw Error("Source leaves the selected application");
  return full;
};
const inputs={};
for(const item of manifest.inputs){
  const body=fs.readFileSync(safe(item.path));
  if(body.length!==item.bytes||hash(body)!==item.sha256)throw Error("Original input differs: "+item.path);
  inputs[item.path]=body.toString("utf8");
}
const land="observations/landcover_2023_2025/",wbd="observations/wbd_station_join_20261013/";
const result=buildProfiles({
  annual2023:JSON.parse(inputs[land+"annual-2023.json"]),
  annual2025:JSON.parse(inputs[land+"annual-2025.json"]),
  changeRows:parseCsv(inputs[land+"huc12-change-summary.csv"]).rows,
  transitionRows:parseCsv(inputs[land+"huc12-transitions.csv"]).rows,
  pointRows:parseCsv(inputs[wbd+"derived/point_watersheds.csv"]).rows,
  plan:JSON.parse(inputs[wbd+"query-plan.json"])
});
const output={
  "watershed-profiles.csv":toCsv(result.profiles),
  "landcover-groups.csv":toCsv(result.groups),
  "original-location-context.csv":toCsv(result.locations),
  "summary.json":JSON.stringify(result.summary,null,2)+"\n"
};
for(const item of manifest.outputs){
  const body=Buffer.from(output[path.basename(item.path)],"utf8");
  if(body.length!==item.bytes||hash(body)!==item.sha256)throw Error("Replayed output differs: "+item.path);
  if(args.includes("--check")){
    if(!body.equals(fs.readFileSync(safe(item.path))))throw Error("Saved output differs: "+item.path);
  }else fs.writeFileSync(safe(item.path,{allowMissing:true}),body);
}
console.log(JSON.stringify({watersheds:result.profiles.length,groups:result.groups.length,
  original_locations:result.locations.length,selected_cells:result.summary.selected_cells,
  changed_cells:result.summary.changed_cells,mode:args.includes("--check")?"check":"rebuild"},null,2));
