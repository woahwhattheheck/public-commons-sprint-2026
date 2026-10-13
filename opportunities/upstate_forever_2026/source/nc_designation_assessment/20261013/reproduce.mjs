#!/usr/bin/env node
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {createHash} from "node:crypto";
import {dirname,resolve,relative,isAbsolute} from "node:path";
import {fileURLToPath} from "node:url";
import {buildDesignationAssessment} from "./join.mjs";
const here=dirname(fileURLToPath(import.meta.url));
const application=resolve(here,"../../..");
const provenance=JSON.parse(readFileSync(resolve(here,"provenance.json"),"utf8"));
const input={};
for(const member of provenance.inputs) {
  const path=resolve(application,member.path), rel=relative(application,path);
  if(rel.startsWith("..")||isAbsolute(rel)) throw new Error("Input leaves application: "+member.path);
  const body=readFileSync(path);
  if(body.length!==member.bytes||createHash("sha256").update(body).digest("hex")!==member.sha256)
    throw new Error("Original source identity differs: "+member.path);
  if(member.role!=="source-metadata") input[member.role]=JSON.parse(body.toString("utf8"));
}
const result=buildDesignationAssessment({
  registry:input["classification-registry"],streams:input["stream-attributes"],
  polygons:input["polygon-attributes"],parameters:input["parameter-attributes"],provenance
});
const output=process.argv[2]?resolve(process.argv[2]):here;
mkdirSync(output,{recursive:true});
for(const [name,content] of Object.entries(result.files)) writeFileSync(resolve(output,name),content,"utf8");
console.log(JSON.stringify({
  output,legal_records:result.summary.legal_records,assessment_units:result.summary.assessment_units,
  parameter_rows:result.summary.parameter_rows,polygon_features:result.summary.polygon_features,
  outputs:Object.entries(result.files).map(([path,content])=>({
    path,bytes:Buffer.byteLength(content),sha256:createHash("sha256").update(content).digest("hex")
  }))
},null,2));
