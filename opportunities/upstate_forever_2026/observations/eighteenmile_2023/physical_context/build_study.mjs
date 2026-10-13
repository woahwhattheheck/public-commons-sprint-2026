#!/usr/bin/env node
import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "./csv.mjs";
import { analyzePhysicalContext } from "./analysis_core.mjs";
import { physicalOutputs } from "./outputs.mjs";

const study=dirname(fileURLToPath(import.meta.url));
const application=resolve(study,"../../..");
const relativeStudy="observations/eighteenmile_2023/physical_context";
const nativeManifest="eighteenmile_physical_context.sources.json";
const argv=process.argv.slice(2);
if(argv.length!==2||argv[0]!=="--output"||!argv[1])throw Error("Usage: node build_study.mjs --output NEW_DIRECTORY");
const manifest=JSON.parse(await readFile(join(study,"input-manifest.json"),"utf8"));
const files=[];
for(const input of manifest.files){
  if(input.path.startsWith("/")||input.path.split("/").includes(".."))throw Error("Invalid original path");
  const data=await readFile(join(application,input.path));
  if(data.length!==input.bytes||createHash("sha256").update(data).digest("hex")!==input.sha256)throw Error("Original bytes differ: "+input.path);
  files.push({...input,source_path:input.path,source_url:input.uri,text:new TextDecoder("utf-8",{fatal:true}).decode(data)});
}
const result=analyzePhysicalContext(files.filter(f=>f.role==="physical_results"),files.find(f=>f.role==="daily_flow"),parseCsv);
const outputs=physicalOutputs(result,manifest);
const destinationApp=resolve(argv[1]);
await mkdir(destinationApp,{recursive:false});
const destination=join(destinationApp,relativeStudy);
await mkdir(destination,{recursive:true});
for(const [name,text] of Object.entries(outputs))await writeFile(join(destination,name),text,{encoding:"utf8",flag:"wx"});
for(const name of ["input-manifest.json","README.md","analysis_core.mjs","csv.mjs","figures.mjs","report.mjs","outputs.mjs","build_study.mjs"])
  await copyFile(join(study,name),join(destination,name));
for(const file of files){
  const target=join(destinationApp,file.path);
  await mkdir(dirname(target),{recursive:true});
  await copyFile(join(application,file.path),target);
}
await copyFile(join(application,nativeManifest),join(destinationApp,nativeManifest));
process.stdout.write(JSON.stringify({output:destination,outputs:Object.keys(outputs),counts:result.counts},null,2)+"\n");
