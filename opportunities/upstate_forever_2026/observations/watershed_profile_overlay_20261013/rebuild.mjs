#!/usr/bin/env node
/** Rebuild the exact original-coordinate native profile overlay. */
import fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {gunzipSync} from "node:zlib";
import {buildOverlay} from "./overlay_core.mjs";
const hash = body => createHash("sha256").update(body).digest("hex");
const args={};
for(let i=2;i<process.argv.length;i+=2){
  const key=process.argv[i],value=process.argv[i+1];
  if(!["--source-dir","--output","--original-domain"].includes(key)||!value||value.startsWith("--")||key in args)
    throw Error("Use --source-dir RETAINED_DIRECTORY --output NEW_GEOJSON [--original-domain RETAINED_JSON_OR_GZIP]");
  args[key]=value;
}
if(!args["--source-dir"]||!args["--output"])throw Error("Select retained source directory and a new output");
const root=path.resolve(args["--source-dir"]);
const binding=JSON.parse(await fs.readFile(path.join(root,"overlay-binding.json"),"utf8"));
let original=await fs.readFile(args["--original-domain"]??path.join(root,"original-domain.esri.json"));
if(original[0]===31&&original[1]===139)original=gunzipSync(original);
const profiles=await fs.readFile(path.join(root,"watershed-profiles.csv"));
for(const [body,identity]of [[original,binding.source_geometry],[profiles,binding.profile_source]])
  if(body.length!==identity.bytes||hash(body)!==identity.sha256)
    throw Error("Original geometry or profile table differs from its retained binding");
const result=buildOverlay(JSON.parse(original),profiles.toString("utf8"));
const body=JSON.stringify(result.geojson)+"\n";
if(result.feature_count!==binding.feature_count||result.vertex_count!==binding.vertex_count||
   Buffer.byteLength(body)!==binding.overlay.bytes||hash(Buffer.from(body))!==binding.overlay.sha256)
  throw Error("Rebuilt map overlay differs from the published source");
async function retainExact(filename,body){
  const temporary=filename+".partial-"+process.pid;
  const handle=await fs.open(temporary,"wx");
  try {
    await handle.writeFile(body);
    await handle.sync();
  } finally { await handle.close(); }
  try {
    try { await fs.link(temporary,filename); }
    catch(error) {
      if(error.code!=="EEXIST")throw error;
      const existing=await fs.readFile(filename);
      if(existing.length!==Buffer.byteLength(body)||hash(existing)!==hash(Buffer.from(body)))
        throw Error("Different retained source already occupies "+filename);
    }
  } finally { await fs.unlink(temporary); }
}
await retainExact(path.join(root,"original-domain.esri.json"),original);
await retainExact(args["--output"],body);
console.log(JSON.stringify({...binding.overlay,path:path.resolve(args["--output"]),
  feature_count:result.feature_count,vertex_count:result.vertex_count},null,2));
