#!/usr/bin/env node
/** Rebuild the exact original-coordinate native profile overlay. */
import fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {buildOverlay} from "./overlay_core.mjs";
const hash = body => createHash("sha256").update(body).digest("hex");
const args={};
for(let i=2;i<process.argv.length;i+=2){
  const key=process.argv[i],value=process.argv[i+1];
  if(!["--source-dir","--output"].includes(key)||!value||value.startsWith("--")||key in args)
    throw Error("Use --source-dir RETAINED_DIRECTORY --output NEW_GEOJSON");
  args[key]=value;
}
if(!args["--source-dir"]||!args["--output"])throw Error("Select retained source directory and a new output");
const root=path.resolve(args["--source-dir"]);
const binding=JSON.parse(await fs.readFile(path.join(root,"overlay-binding.json"),"utf8"));
const original=await fs.readFile(path.join(root,"original-domain.esri.json"));
const profiles=await fs.readFile(path.join(root,"watershed-profiles.csv"));
for(const [body,identity]of [[original,binding.source_geometry],[profiles,binding.profile_source]])
  if(body.length!==identity.bytes||hash(body)!==identity.sha256)
    throw Error("Original geometry or profile table differs from its retained binding");
const result=buildOverlay(JSON.parse(original),profiles.toString("utf8"));
const body=JSON.stringify(result.geojson)+"\n";
if(result.feature_count!==binding.feature_count||result.vertex_count!==binding.vertex_count||
   Buffer.byteLength(body)!==binding.overlay.bytes||hash(Buffer.from(body))!==binding.overlay.sha256)
  throw Error("Rebuilt map overlay differs from the published source");
await fs.writeFile(args["--output"],body,{flag:"wx"});
console.log(JSON.stringify({path:path.resolve(args["--output"]),...binding.overlay,
  feature_count:result.feature_count,vertex_count:result.vertex_count},null,2));
