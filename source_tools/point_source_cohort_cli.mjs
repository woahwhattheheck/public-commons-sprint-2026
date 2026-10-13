#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";
import {INPUT_PATHS,OUT_ROOT,buildCohort,buildSourceManifest,csvString} from "./point_source_cohort.mjs";
const argv=process.argv.slice(2);
function argument(name,fallback){const i=argv.indexOf(name);if(i<0)return fallback;if(!argv[i+1]||argv[i+1].startsWith("--"))throw Error("Missing value for "+name);return argv[i+1];}
const root=path.resolve(argument("--root",path.join(path.dirname(fileURLToPath(import.meta.url)),"..")));
const specPath=path.resolve(argument("--input-manifest",path.join(root,OUT_ROOT,"input-manifest.json")));
function resolveSource(rel){if(typeof rel!=="string"||path.isAbsolute(rel))throw Error("Expected project-relative source path");const p=path.resolve(root,rel);if(!p.startsWith(root+path.sep))throw Error("Source path leaves the selected project");return p;}
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const inputSpec=JSON.parse(fs.readFileSync(specPath,"utf8"));
if(inputSpec.schema!=="upstate.point-source-cohort-inputs/v1")throw Error("Select the source-cohort input manifest");
const inputs={};
for(const [key,relative] of Object.entries(INPUT_PATHS)){
  const declared=inputSpec.required_inputs[key];if(!declared||declared.path!==relative)throw Error("Input identity differs: "+key);
  const body=fs.readFileSync(resolveSource(relative));
  if(body.length!==declared.bytes||sha(body)!==declared.sha256)throw Error("Input source edition differs: "+relative);
  inputs[key]=body.toString("utf8");
}
const result=buildCohort(inputs),files=Object.entries(result.tables).map(([name,rows])=>({path:OUT_ROOT+"/"+name,content:csvString(rows)}));
for(const [name,value] of [["observation-metadata.json",result.observationMetadata],["cohort-summary.json",result.summary]])
  files.push({path:OUT_ROOT+"/"+name,content:JSON.stringify(value,null,2)+"\n"});
const generatedMeta={};
for(const f of files){const b=Buffer.from(f.content,"utf8");generatedMeta[f.path]={path:f.path,bytes:b.length,sha256:sha(b)};}
const manifest=buildSourceManifest(inputs,result,inputSpec,generatedMeta);
files.push({path:"eighteenmile_point_source_context.sources.json",content:JSON.stringify(manifest,null,2)+"\n"});
function save(f){
  const target=resolveSource(f.path),bytes=Buffer.from(f.content,"utf8");fs.mkdirSync(path.dirname(target),{recursive:true});
  if(fs.existsSync(target)&&fs.readFileSync(target).equals(bytes))return;
  const temp=target+".tmp-"+process.pid;
  try{fs.writeFileSync(temp,bytes,{flag:"wx"});fs.renameSync(temp,target);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
for(const f of files)save(f);
process.stdout.write(JSON.stringify({project_root:root,source_manifest:path.join(root,"eighteenmile_point_source_context.sources.json"),source_entries:manifest.entries.length,source_cohort:inputSpec.edition,tables:result.summary.tables,mapped_outfalls:result.vector.features.length,files:files.map(f=>({path:f.path,bytes:Buffer.byteLength(f.content),sha256:sha(Buffer.from(f.content))}))},null,2)+"\n");
