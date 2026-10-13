#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";
import {SCIENTIFIC_ROOT,buildPointSourceScientific} from "./point_source_scientific_report.mjs";
const args=process.argv.slice(2);
function arg(name,fallback){const i=args.indexOf(name);if(i<0)return fallback;if(!args[i+1]||args[i+1].startsWith("--"))throw Error("Missing "+name);return args[i+1];}
const root=path.resolve(arg("--root",path.join(path.dirname(fileURLToPath(import.meta.url)),"..")));
const resolve=p=>{if(typeof p!=="string"||path.isAbsolute(p))throw Error("Project-relative path required");const v=path.resolve(root,p);if(!v.startsWith(root+path.sep))throw Error("Path leaves project");return v;};
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const manifest=JSON.parse(fs.readFileSync(resolve(SCIENTIFIC_ROOT+"/input-manifest.json"),"utf8"));
if(manifest.schema!=="upstate.point-source-scientific-inputs/v1")throw Error("Original scientific-report input manifest required");
const analyses={};
for(const member of manifest.members){
 const bytes=fs.readFileSync(resolve(member.path));
 if(bytes.length!==member.bytes||sha(bytes)!==member.sha256)throw Error("Retained member differs: "+member.path);
 if(member.path===manifest.history||member.path===manifest.drivers)analyses[member.path]=JSON.parse(bytes.toString("utf8"));
}
if(!analyses[manifest.history]||!analyses[manifest.drivers])throw Error("Original analyses absent from selected members");
const built=buildPointSourceScientific(analyses[manifest.history],analyses[manifest.drivers],manifest,sha,text=>Buffer.from(text,"utf8"));
for(const file of built.files){
 const target=resolve(file.path),body=Buffer.from(file.content,"utf8");fs.mkdirSync(path.dirname(target),{recursive:true});
 if(fs.existsSync(target)&&fs.readFileSync(target).equals(body))continue;
 const temp=target+".tmp-"+process.pid;
 try{fs.writeFileSync(temp,body,{flag:"wx"});fs.renameSync(temp,target);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
process.stdout.write(JSON.stringify({project_root:root,manifest:path.join(root,"point_source_scientific.sources.json"),
 source_id:built.manifest.entries[0].id,sections:built.recipe.sections.length,figures:built.spec.figures.length,
 retained_members:manifest.members.length,
 outputs:built.files.map(f=>({path:f.path,bytes:Buffer.byteLength(f.content),sha256:sha(Buffer.from(f.content))}))},null,2)+"\n");
