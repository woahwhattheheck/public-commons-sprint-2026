#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {deriveMicrobialMonitoring} from "./derive-microbial-monitoring.mjs";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(process.argv[2]||path.join(here,"../../../.."));
const output=path.resolve(process.argv[3]||here);
const manifest=JSON.parse(await fs.readFile(path.join(here,"input-manifest.json"),"utf8"));
const values={source_inputs:manifest.inputs};
for(const item of manifest.inputs){
 const file=path.resolve(root,item.path);
 if(!file.startsWith(root+path.sep))throw Error("Input path leaves the selected application");
 const bytes=await fs.readFile(file),sha=createHash("sha256").update(bytes).digest("hex");
 if(bytes.length!==item.bytes||sha!==item.sha256)throw Error("Original source differs: "+item.path);
 values[item.key]=bytes.toString("utf8");
}
const result=deriveMicrobialMonitoring(values);
for(const [name,body] of Object.entries(result.files)){
 const expected=manifest.outputs.find(row=>row.path===name);
 const bytes=Buffer.from(body,"utf8"),sha=createHash("sha256").update(bytes).digest("hex");
 if(!expected||bytes.length!==expected.bytes||sha!==expected.sha256)throw Error("Derived monitoring edition differs: "+name);
}
await fs.mkdir(output,{recursive:true});
for(const [name,body] of Object.entries(result.files))await fs.writeFile(path.join(output,name),body,"utf8");
console.log(JSON.stringify({output,...result.summary},null,2));
