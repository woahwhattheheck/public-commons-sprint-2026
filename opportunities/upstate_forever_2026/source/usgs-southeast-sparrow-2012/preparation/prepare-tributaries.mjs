#!/usr/bin/env node
/**
 * Reproduce or verify the exact prepared Upper Savannah tributary edition.
 * Uses original retained tables, unchanged GeographicLib 2.2.0 sources, and
 * the maintained source_tools.sparrow_reference/native bind file contract.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import {fileURLToPath} from "node:url";
import {prepareTributaries} from "./prepare-tributaries-core.mjs";

const here=path.dirname(fileURLToPath(import.meta.url));
const options={applicationRoot:path.resolve(here,"../../.."),output:path.resolve(here,"../prepared-tributaries"),check:false};
for(let i=2;i<process.argv.length;i++){
  const key=process.argv[i];
  if(key==="--help"){console.log("node prepare-tributaries.mjs [--application-root APP] [--output PREPARED] [--check]");process.exit(0);}
  if(key==="--check"){options.check=true;continue;}
  if(!["--application-root","--output"].includes(key)||!process.argv[i+1]||process.argv[i+1].startsWith("--"))throw Error("Unknown or incomplete option "+key);
  options[key==="--output"?"output":"applicationRoot"]=path.resolve(process.argv[++i]);
}
const sha256=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const utf8=text=>Buffer.from(text,"utf8");
const pins=JSON.parse(fs.readFileSync(path.join(here,"input-manifest.json"),"utf8"));
if(pins.schema!=="upstate.prepared-tributaries-inputs/v1")throw Error("Unknown preparation input manifest");
function checked(root,item){
  const candidate=path.resolve(root,item.path);
  if(candidate!==root&&!candidate.startsWith(root+path.sep))throw Error("Input escapes its declared root: "+item.path);
  const bytes=fs.readFileSync(candidate);
  if(bytes.length!==item.bytes||sha256(bytes)!==item.sha256)throw Error("Pinned original bytes differ: "+item.path);
  const text=bytes.toString("utf8");
  if(!Buffer.from(text,"utf8").equals(bytes))throw Error("Original input is not lossless UTF-8: "+item.path);
  return text;
}
const inputs={};
for(const item of pins.inputs)inputs[item.path]=checked(options.applicationRoot,item);
const vendor=pins.geographiclib.sources.map(item=>checked(here,item)).join("\n");
const geodesic=vm.runInNewContext(vendor+"\n;geodesic;",{}, {timeout:10000,filename:"GeographicLib-2.2.0-original-sources.js"});
if(geodesic.Constants.version_string!=="2.2.0")throw Error("GeographicLib source edition differs");
const result=prepareTributaries({inputs,sha256,utf8,geodesic,capturedAt:pins.prepared_at});
if(result.result.id!==pins.preparation_id||result.source_id!==pins.original_source_id||result.plan_id!==pins.plan_id)throw Error("Prepared identity differs from this retained edition");
if(Object.keys(result.files).length!==pins.prepared_files.length)throw Error("Prepared member count differs");
for(const item of pins.prepared_files){
  const content=result.files[item.path];
  if(typeof content!=="string"||utf8(content).length!==item.bytes||sha256(utf8(content))!==item.sha256)throw Error("Prepared reproduction differs: "+item.path);
}
function immutableWrite(relative,content){
  const target=path.resolve(options.output,relative);
  if(!target.startsWith(options.output+path.sep))throw Error("Prepared path escapes output");
  if(fs.existsSync(target)){
    if(!fs.readFileSync(target).equals(utf8(content)))throw Error("Existing prepared file differs: "+relative);
    return;
  }
  if(options.check)throw Error("Missing prepared file: "+relative);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  const temporary=target+".incoming-"+crypto.randomBytes(12).toString("hex");
  try {
    fs.writeFileSync(temporary,content,{encoding:"utf8",flag:"wx"});
    try {fs.linkSync(temporary,target);}
    catch(error){
      if(error.code!=="EEXIST"||!fs.readFileSync(target).equals(utf8(content)))throw error;
    }
  } finally {if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
for(const [relative,content]of Object.entries(result.files))immutableWrite(relative,content);
console.log(JSON.stringify({schema:"upstate.prepared-tributaries-reproduction/v1",mode:options.check?"checked":"written",
  output:options.output,original_source_id:result.source_id,preparation_id:result.result.id,
  files:Object.keys(result.files).length,records:result.records,geometry:result.geometryChecks},null,2));
