#!/usr/bin/env node
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {dirname,resolve,join} from "node:path";
import {buildOutputs} from "./analysis.mjs";

const here=dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2), options={};
for(let i=0;i<args.length;i++){
 if(args[i]==="--help"){console.log("node reproduce.mjs [--source ORIGINAL_CSV_DIRECTORY] [--flow ORIGINAL_WATERML_JSON] [--output OUTPUT_DIRECTORY]");process.exit(0);}
 if(!["--source","--flow","--output"].includes(args[i])||!args[i+1]||args[i+1].startsWith("--"))throw Error("Unknown or incomplete argument: "+args[i]);
 if(options[args[i]])throw Error("Duplicate argument: "+args[i]);
 options[args[i]]=args[++i];
}
const manifest=JSON.parse(await readFile(join(here,"source-manifest.json"),"utf8"));
const input={};
for(const item of manifest.inputs){
 const path=item.role==="flow"&&options["--flow"]?resolve(options["--flow"]):
  item.role!=="flow"&&options["--source"]?resolve(options["--source"],item.role==="results"?"results-with-provenance.csv":"station-membership.csv"):resolve(here,item.path);
 const bytes=await readFile(path);
 if(bytes.length!==item.bytes||createHash("sha256").update(bytes).digest("hex")!==item.sha256)throw Error("Original input differs from this source edition: "+item.role);
 input[item.role]=bytes.toString("utf8");
}
const {files,summary}=buildOutputs(input.results,input.stations,JSON.parse(input.flow));
for(const [name,content] of Object.entries(files)){
 const expected=manifest.outputs[name],bytes=Buffer.from(content,"utf8");
 if(!expected||bytes.length!==expected.bytes||createHash("sha256").update(bytes).digest("hex")!==expected.sha256)throw Error("Derived output differs: "+name);
}
const output=resolve(options["--output"]||join(here,"reproduced"));
await mkdir(output,{recursive:true});
for(const [name,content] of Object.entries(files))await writeFile(join(output,name),content,"utf8");
console.log(JSON.stringify({operation:manifest.operation,output,files:Object.keys(files).length,source_records:summary.selection.source_records,routine_records:summary.selection.routine_records,stations:summary.selection.stations,flow_sample_dates:summary.flow.joined_sample_dates},null,2));
