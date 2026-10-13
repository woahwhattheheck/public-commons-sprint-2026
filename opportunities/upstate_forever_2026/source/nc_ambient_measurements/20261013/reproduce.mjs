#!/usr/bin/env node
import {readFile,writeFile,readdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {derive,BASE} from "./derive.mjs";
import {present} from "./present.mjs";
import {reconcile} from "./reconcile_profiles.mjs";
import {sourceManifest} from "./source_manifest.mjs";
const root=fileURLToPath(new URL("../../../",import.meta.url));
const args=process.argv.slice(2);
if(args.some(arg=>!["--check","--write"].includes(arg))||args.includes("--check")&&args.includes("--write"))throw Error("Use --check or --write");
const write=args.includes("--write"),files={};
const hash=value=>createHash("sha256").update(value).digest("hex");
const descriptor=(p,body)=>({path:p,bytes:Buffer.byteLength(body,"utf8"),sha256:hash(body)});
async function readFamily(relative){
 for(const entry of await readdir(path.join(root,relative),{withFileTypes:true})){
  const p=path.posix.join(relative,entry.name);
  if(entry.isDirectory())await readFamily(p);
  else if(entry.isFile()&&!entry.name.startsWith(".")&&!entry.name.endsWith(".pyc"))files[p]=await readFile(path.join(root,p),"utf8");
 }
}
await readFamily(BASE.replace(/\/$/,""));
const provenance=JSON.parse(files[BASE+"provenance.json"]);
for(const source of [...provenance.captures,...provenance.cross_profile_captures]){
 const data=await readFile(path.join(root,source.path));
 if(data.length!==source.bytes||hash(data)!==source.sha256)throw Error("Original source changed: "+source.path);
}
const built=derive(files,provenance),presentation=present(built,provenance),profiles=reconcile(files,provenance);
if(profiles.result.unmatched.length||profiles.result.legacy_only.length||profiles.result.differences.length||profiles.activity.unmatched.length||profiles.activity.legacy_only.length||profiles.activity.differences.length)throw Error("Current-profile reconciliation differs; review the explicit original field comparison");
const generated={...built.files,...presentation.files,[BASE+"profile-reconciliation.json"]:JSON.stringify(profiles,null,2)+"\n"};
// The local explorer is generated from the same complete derived observation objects.
Object.assign(files,generated);
generated["nc_ambient_measurements.sources.json"]=JSON.stringify(sourceManifest(files,descriptor),null,2)+"\n";
const changed=[];
for(const [relative,body] of Object.entries(generated)){
 let previous;try{previous=await readFile(path.join(root,relative),"utf8");}catch(error){if(error.code!=="ENOENT")throw error;}
 if(previous!==body){changed.push(relative);if(write)await writeFile(path.join(root,relative),body,"utf8");}
}
console.log(JSON.stringify({mode:write?"write":"check",original_files:provenance.captures.length,cross_profile_originals:provenance.cross_profile_captures.length,original_result_rows:built.summary.original_result_rows,comparison_groups:built.summary.comparison_groups,censored_results:built.summary.censored_results,thermal_windows:built.summary.horsepasture_temperature_windows,generated_files:Object.keys(generated).length,changed},null,2));
if(!write&&changed.length)process.exitCode=1;
