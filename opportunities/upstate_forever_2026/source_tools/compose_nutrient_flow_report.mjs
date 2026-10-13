#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {ORIGINAL_NUTRIENT_FLOW_INPUTS,composeRoutineContext} from "./nutrient_flow_report.mjs";

const args=process.argv.slice(2);
const options={};
for(let i=0;i<args.length;i+=2){
 if(!["--application","--output"].includes(args[i])||!args[i+1])throw Error("Usage: node compose_nutrient_flow_report.mjs --application APPLICATION --output NEW_OUTPUT_DIRECTORY");
 if(options[args[i]])throw Error("Duplicate argument: "+args[i]);
 options[args[i]]=args[i+1];
}
if(!options["--application"]||!options["--output"])throw Error("Select the maintained application and a separate output directory");
const root=path.resolve(options["--application"]),output=path.resolve(options["--output"]);
if(output===root)throw Error("Write the composed edition to a separate output directory");
const hash=text=>crypto.createHash("sha256").update(text,"utf8").digest("hex");
const read=relative=>fs.readFileSync(path.join(root,relative),"utf8");
const files=ORIGINAL_NUTRIENT_FLOW_INPUTS.map(item=>({...item,content:read(item.path)}));
const result=composeRoutineContext({
 files,reportRecipeText:read("observed_hydrology_context.report.json"),
 reportManifestText:read("observed_hydrology_context.sources.json")
},hash);
for(const file of result.files){
 const target=path.resolve(output,file.path);
 if(!target.startsWith(output+path.sep))throw Error("Composed path leaves output directory");
 const data=Buffer.from(file.content,"utf8");
 fs.mkdirSync(path.dirname(target),{recursive:true});
 if(fs.existsSync(target)){
  if(!fs.readFileSync(target).equals(data))throw Error("An existing composed edition differs: "+file.path);
 }else{
  const temporary=target+".pending-"+process.pid;
  fs.writeFileSync(temporary,data,{flag:"wx"});
  fs.renameSync(temporary,target);
 }
}
const summary={schema:"upstate.routine-nutrient-report-composition/v1",application:root,output,
 original_source_files:result.original_source_files,native_source_entries:result.native_source_entries,
 sections_added:result.sections_added,reproduced_files:result.reproduced_files,
 files:result.files.map(file=>({path:file.path,bytes:Buffer.byteLength(file.content),sha256:hash(file.content)}))};
process.stdout.write(JSON.stringify(summary,null,2)+"\n");
