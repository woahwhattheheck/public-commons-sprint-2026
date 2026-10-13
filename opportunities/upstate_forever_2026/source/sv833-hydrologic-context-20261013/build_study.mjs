#!/usr/bin/env node
import {readFile,mkdir,writeFile,copyFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {parseCsv} from "../../observations/sv833_2021_2026/csv.mjs";
import {analyzeSV833Hydrology} from "./analysis.mjs";
import {sv833HydrologyOutputs} from "./outputs.mjs";
const root=dirname(fileURLToPath(import.meta.url)),app=resolve(root,"../.."),relativeStudy="source/sv833-hydrologic-context-20261013";
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=="--output"||!args[1])throw Error("Usage: node build_study.mjs --output NEW_DIRECTORY");
const manifest=JSON.parse(await readFile(join(root,"input-manifest.json"),"utf8")),files=[];
for(const f of manifest.files){
 if(f.path.startsWith("/")||f.path.split("/").includes(".."))throw Error("Invalid source path");
 const b=await readFile(join(app,f.path));
 if(b.length!==f.bytes||createHash("sha256").update(b).digest("hex")!==f.sha256)throw Error("Original source differs: "+f.path);
 files.push({...f,content:new TextDecoder("utf-8",{fatal:true}).decode(b)});
}
const result=analyzeSV833Hydrology(files,parseCsv),outputs=sv833HydrologyOutputs(result,manifest),destination=resolve(args[1]);
await mkdir(destination,{recursive:false});
await mkdir(join(destination,relativeStudy),{recursive:true});
for(const [name,content] of Object.entries(outputs))await writeFile(join(destination,relativeStudy,name),content,{encoding:"utf8",flag:"wx"});
for(const name of ["analysis.mjs","figures.mjs","report.mjs","outputs.mjs","build_study.mjs","README.md","input-manifest.json"])
 await copyFile(join(root,name),join(destination,relativeStudy,name));
for(const f of files){const target=join(destination,f.path);await mkdir(dirname(target),{recursive:true});await copyFile(join(app,f.path),target);}
const csv="observations/sv833_2021_2026/csv.mjs";await mkdir(dirname(join(destination,csv)),{recursive:true});await copyFile(join(app,csv),join(destination,csv));
await copyFile(join(app,"sv833_hydrologic_context.sources.json"),join(destination,"sv833_hydrologic_context.sources.json"));
process.stdout.write(JSON.stringify({destination,counts:result.counts,outputs:Object.keys(outputs)},null,2)+"\n");
