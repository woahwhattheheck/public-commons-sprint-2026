#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {parseCsv,buildStationContext} from "./station_context.mjs";
import {toCsv} from "./watershed_join.mjs";
const root=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);
if(args.some(x=>x!=="--check"))throw Error("Usage: node rebuild_station_context.mjs [--check]");
const hash=body=>createHash("sha256").update(body).digest("hex");
const read=name=>{
  const file=path.resolve(root,name);
  if(!file.startsWith(root+path.sep))throw Error("Original source leaves component");
  return fs.readFileSync(file);
};
const original=JSON.parse(read("model-sources.json"));
const source=original.entries.find(e=>e.id==="upstate-observation-wbd-polygon-matches-20261013-0f34b1d5d958");
if(!source)throw Error("Select the original complete WBD polygon table");
for(const item of [source,...source.companions]){
  const body=read(item.path);
  if(hash(body)!==item.sha256 || (item.bytes!==undefined&&body.length!==item.bytes))
    throw Error("Original source differs: "+item.path);
}
const rows=parseCsv(read(source.path).toString("utf8"));
const context=buildStationContext(rows,source.sha256);
const output=Buffer.from(toCsv(context),"utf8");
const expected=JSON.parse(read("station-context.sources.json")).entries[0];
if(context.length!==184||hash(output)!==expected.sha256||output.length!==expected.bytes)
  throw Error("Station context differs from the retained complete source edition");
if(args.includes("--check")){
  if(!read(expected.path).equals(output))throw Error("Saved station context differs");
}else{
  const target=path.resolve(root,expected.path);
  if(!target.startsWith(root+path.sep))throw Error("Context output leaves component");
  fs.mkdirSync(path.dirname(target),{recursive:true});
  const staging=target+".building-"+process.pid;
  fs.writeFileSync(staging,output);fs.renameSync(staging,target);
}
console.log(JSON.stringify({original_rows:rows.length,station_context_rows:context.length,
  station_count:new Set(context.map(row=>row.station_id)).size,
  original_polygon_table_sha256:source.sha256,context_sha256:hash(output),
  original_coordinate_variants:[...new Set(context.map(row=>row.coordinate_variant))],
  role:"station location context",observation_rows_added:0},null,2));
