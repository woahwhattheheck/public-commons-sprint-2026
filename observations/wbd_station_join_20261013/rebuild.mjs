#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildObservationWatershedJoin, toCsv } from "./watershed_join.mjs";
const root=path.dirname(fileURLToPath(import.meta.url));
const read=(relative)=>fs.readFileSync(path.resolve(root,relative),"utf8");
const hash=s=>createHash("sha256").update(s,"utf8").digest("hex");
const plan=JSON.parse(read("query-plan.json"));
const index=JSON.parse(read("capture-index.json"));
for(const input of plan.inputs){
 const text=read("inputs/"+input.path);
 if(Buffer.byteLength(text)!==input.bytes||hash(text)!==input.sha256)throw Error("Original input hash mismatch: "+input.path);
}
const captures=index.captures.map(c=>{
 const content=read(c.path.replace(/^observations\/wbd_station_join_20261013\//,""));
 if(Buffer.byteLength(content)!==c.bytes||hash(content)!==c.sha256)throw Error("Original response hash mismatch: "+c.path);
 return {...c,content};
});
const joined=buildObservationWatershedJoin(plan.points,captures,plan.domain_ids);
const outputs={"derived/point_watersheds.csv":toCsv(joined.pointRows),"derived/polygon_matches.csv":toCsv(joined.matchRows),"derived/summary.json":JSON.stringify(joined.summary,null,2)+"\n"};
const check=process.argv.includes("--check");
for(const [relative,text] of Object.entries(outputs)){
 if(check){if(read(relative)!==text)throw Error("Derived output differs: "+relative);}
 else {fs.mkdirSync(path.dirname(path.join(root,relative)),{recursive:true});fs.writeFileSync(path.join(root,relative),text,"utf8");}
}
console.log(JSON.stringify({operation:check?"verified_rebuild":"rebuilt",completed_points:joined.summary.completed_point_count,input_points:joined.summary.input_point_count,captured_geometries:joined.summary.captured_geometry_count,pending_points:joined.summary.pending_point_ids.length,files:Object.entries(outputs).map(([path,text])=>({path,bytes:Buffer.byteLength(text),sha256:hash(text)}))},null,2));
