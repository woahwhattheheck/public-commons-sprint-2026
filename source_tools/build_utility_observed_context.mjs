#!/usr/bin/env node
/** Rebuild original utility sampling context from the pinned local source cohort. */
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve,dirname,relative,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {buildUtilityObservedContext,observedOutputs,observedHtml} from "./utility_observed_context.mjs";

const application=resolve(process.argv[2]||resolve(dirname(fileURLToPath(import.meta.url)),".."));
const folder="source/utility-observed-context/20261013";
const destination=resolve(process.argv[3]||resolve(application,folder));
const inputText=await readFile(resolve(application,folder,"inputs.json"),"utf8");
const manifest=JSON.parse(inputText);
if(manifest.schema!=="upstate.utility-observed-inputs/v1")throw Error("Select the original observed source input manifest");
const hash=body=>createHash("sha256").update(body).digest("hex");
const inputs={sourceIdentities:manifest.sources};
const jsonKeys=new Set(["utilityContext","profile","arjwsGeometry","flowCoverage"]);
for(const [key,item]of Object.entries(manifest.sources)){
  if(!item.path.startsWith("source/")||item.path.split("/").some(x=>!x||x===".."||x==="."))throw Error("Retain a canonical application source member");
  const path=resolve(application,item.path),rel=relative(application,path);
  if(rel.startsWith(".."+sep)||rel==="..")throw Error("Original source leaves the application");
  const body=await readFile(path);
  if(body.length!==item.bytes||hash(body)!==item.sha256)throw Error("The retained observed source changed: "+key);
  inputs[key]=jsonKeys.has(key)?JSON.parse(body.toString("utf8")):body.toString("utf8");
}
const result=buildUtilityObservedContext(inputs);
const outputs={...observedOutputs(result),"report.html":observedHtml(result),"inputs.json":inputText};
await mkdir(destination,{recursive:true});
const files={};
for(const [name,text]of Object.entries(outputs)){
  const body=Buffer.from(text,"utf8");await writeFile(resolve(destination,name),body);
  files[name]={path:name,bytes:body.length,sha256:hash(body)};
}
const record={schema:"upstate.utility-observed-build/v1",version:result.version,
  source_commit:manifest.source_commit,output_directory:destination,files,
  utilities:result.utilities.map(u=>({utility_id:u.utility_id,summary:u.summary,huc12_coverage:u.huc12_coverage})),
  stream_geography:result.regional_stream.stations.map(s=>({station_id:s.station_id,
    arjws_scope:s.arjws_scope,prwd_scope:s.prwd_scope}))};
await writeFile(resolve(destination,"build.json"),JSON.stringify(record,null,2)+"\n");
process.stdout.write(JSON.stringify(record,null,2)+"\n");
