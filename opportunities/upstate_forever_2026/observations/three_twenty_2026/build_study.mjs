#!/usr/bin/env node
import {readFile,mkdir,writeFile,copyFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {parseCsv} from "./csv.mjs";
import {analyzeThreeTwenty} from "./analysis_core.mjs";
import {threeTwentyOutputs} from "./outputs.mjs";
const root=dirname(fileURLToPath(import.meta.url)),application=resolve(root,"../.."),relativeStudy="observations/three_twenty_2026";
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=="--output"||!args[1])throw Error("Usage: node build_study.mjs --output NEW_APPLICATION_DIRECTORY");
const manifest=JSON.parse(await readFile(join(root,"input-manifest.json"),"utf8")),files=[];
for(const input of manifest.files){
 if(input.path.startsWith("/")||input.path.split("/").includes(".."))throw Error("Unsafe original path");
 const bytes=await readFile(join(application,input.path));
 if(bytes.length!==input.bytes||createHash("sha256").update(bytes).digest("hex")!==input.sha256)throw Error("Original bytes differ: "+input.path);
 files.push({...input,content:new TextDecoder("utf-8",{fatal:true}).decode(bytes)});
}
const result=analyzeThreeTwenty(files,parseCsv,manifest.window);
for(const [k,v]of Object.entries(manifest.expected_counts))if(result.counts[k]!==v)throw Error("Source census differs: "+k);
const output=resolve(args[1]);await mkdir(output,{recursive:false});const dest=join(output,relativeStudy);await mkdir(dest,{recursive:true});
const generated=threeTwentyOutputs(result,manifest);
for(const [name,text]of Object.entries(generated))await writeFile(join(dest,name),text,{encoding:"utf8",flag:"wx"});
for(const name of ["README.md","input-manifest.json","analysis_core.mjs","csv.mjs","report.mjs","outputs.mjs","build_study.mjs"])await copyFile(join(root,name),join(dest,name));
for(const file of files){const target=join(output,file.path);await mkdir(dirname(target),{recursive:true});await copyFile(join(application,file.path),target);}
const nativeDest=join(dest,"native-study");await mkdir(join(nativeDest,"original"),{recursive:true});
for(const file of files)await copyFile(join(application,file.path),join(nativeDest,"original",file.path.split("/").at(-1)));
for(const name of ["observation-sources.json","result-selection.json"])await copyFile(join(root,"native-study",name),join(nativeDest,name));
await copyFile(join(application,"three_twenty_2026.sources.json"),join(output,"three_twenty_2026.sources.json"));
process.stdout.write(JSON.stringify({output,counts:result.counts,entrypoint:join(dest,"three-twenty-2026-study.html"),same_day:result.date_pairs},null,2)+"\n");
