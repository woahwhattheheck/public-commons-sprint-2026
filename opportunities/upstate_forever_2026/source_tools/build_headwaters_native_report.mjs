#!/usr/bin/env node
/** Replay the original completed native source interpretation without running models. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { analyzeNative } from "./headwaters_native_interpretation.mjs";
import { nativeReportOutputs } from "./headwaters_native_report_views.mjs";

const BASE = "source/headwaters_native_interpretation_20261013";
const args=process.argv.slice(2);
const options={};
for(let i=0;i<args.length;i++){
  if(args[i]==="--check")options.check=true;
  else if(["--project-root","--output"].includes(args[i])){
    if(!args[i+1]||args[i+1].startsWith("--"))throw new Error("Missing value for "+args[i]);
    options[args[i].slice(2)]=args[++i];
  }else throw new Error("Unknown argument "+args[i]);
}
if(!options["project-root"]||(!options.check&&!options.output)||(options.check&&options.output))throw new Error("Use --project-root APP with exactly one of --check or --output NEW_DIRECTORY");
const root=fs.realpathSync(options["project-root"]);
const digest=b=>crypto.createHash("sha256").update(b).digest("hex");
const safe=relative=>{
  if(typeof relative!=="string"||path.isAbsolute(relative)||relative.split("/").some(p=>!p||p==="."||p===".."))throw new Error("Invalid original relative path");
  const target=fs.realpathSync(path.join(root,relative));
  if(target!==root&&!target.startsWith(root+path.sep))throw new Error("Original source escapes project root");
  return target;
};
const catalog=JSON.parse(fs.readFileSync(safe(BASE+"/source-inputs.json"),"utf8"));
if(catalog.schema!=="upstate.headwaters-native-inputs/v1"||!Array.isArray(catalog.inputs))throw new Error("Use the retained native-source catalog");
const originals={};let inputAnalysis;
for(const item of catalog.inputs){
  const body=fs.readFileSync(safe(item.path));
  if(body.length!==item.bytes||digest(body)!==item.sha256)throw new Error("Original bytes differ: "+item.path);
  if(item.path.startsWith(catalog.native_root+"/"))originals[item.path.slice(catalog.native_root.length+1)]=body.toString("utf8");
  if(item.path===catalog.input_analysis)inputAnalysis=JSON.parse(body.toString("utf8"));
}
const analysis=analyzeNative(originals,inputAnalysis);
const outputs=nativeReportOutputs(analysis,catalog.inputs);
let destination;
if(options.output){
  destination=path.resolve(options.output);
  if(fs.existsSync(destination))throw new Error("Choose a new output directory");
  fs.mkdirSync(destination);
}
for(const [name,body] of Object.entries(outputs)){
  const bytes=Buffer.from(body,"utf8");
  if(options.check){
    const retained=fs.readFileSync(safe(BASE+"/"+name));
    if(!retained.equals(bytes))throw new Error("Replay differs: "+name);
  }else fs.writeFileSync(path.join(destination,name),bytes,{flag:"wx"});
}
console.log(JSON.stringify({schema:"upstate.headwaters-native-replay/v1",mode:options.check?"check":"write",inputs:catalog.inputs.length,outputs:Object.keys(outputs).length,native_runs:analysis.source.progress.complete,scenario_rows:analysis.scenario_rows.length,parameter_rows:analysis.parameter_rows.length,output:destination||null}));
