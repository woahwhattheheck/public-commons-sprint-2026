#!/usr/bin/env node
import {readFile,mkdir,writeFile,copyFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {parseCsv} from "./csv.mjs";
import {analyzeSV833} from "./analysis_core.mjs";
import * as intervalTools from "./interval-order.mjs";
import {sv833Outputs} from "./outputs.mjs";

const root=dirname(fileURLToPath(import.meta.url));
const application=resolve(root,"../..");
const relativeStudy="observations/sv833_2021_2026";
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=="--output"||!args[1])throw Error("Usage: node build_study.mjs --output NEW_DIRECTORY");
const manifest=JSON.parse(await readFile(join(root,"input-manifest.json"),"utf8"));
const files=[];
for(const input of manifest.files){
 if(input.path.startsWith("/")||input.path.split("/").includes(".."))throw Error("Invalid original path");
 const data=await readFile(join(application,input.path));
 if(data.length!==input.bytes||createHash("sha256").update(data).digest("hex")!==input.sha256)throw Error("Original bytes differ: "+input.path);
 files.push({...input,content:new TextDecoder("utf-8",{fatal:true}).decode(data)});
}
const assessment=JSON.parse(files.find(f=>f.role==="retained_assessment_extract").content);
const result=analyzeSV833(files,parseCsv,assessment,intervalTools);
const outputs=sv833Outputs(result,manifest);
const destinationApp=resolve(args[1]);
await mkdir(destinationApp,{recursive:false});
const destination=join(destinationApp,relativeStudy);
await mkdir(destination,{recursive:true});
for(const [name,body] of Object.entries(outputs))await writeFile(join(destination,name),body,{encoding:"utf8",flag:"wx"});
for(const name of ["input-manifest.json","README.md","analysis_core.mjs","interval-order.mjs","csv.mjs","figures.mjs","report.mjs","outputs.mjs","build_study.mjs"])
 await copyFile(join(root,name),join(destination,name));
for(const file of files){
 const target=join(destinationApp,file.path);await mkdir(dirname(target),{recursive:true});await copyFile(join(application,file.path),target);
}
await copyFile(join(application,"sv833_water_quality.sources.json"),join(destinationApp,"sv833_water_quality.sources.json"));
process.stdout.write(JSON.stringify({output:destination,outputs:Object.keys(outputs),counts:result.counts,interval_associations:result.interval_associations},null,2)+"\n");
