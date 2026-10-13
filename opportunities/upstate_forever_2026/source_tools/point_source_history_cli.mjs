#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";
import {HISTORY_INPUTS,HISTORY_ROOT} from "./point_source_history.mjs";
import {buildHistoryFiles} from "./point_source_history_build.mjs";
const args=process.argv.slice(2);
function arg(name,fallback){const i=args.indexOf(name);if(i<0)return fallback;if(!args[i+1]||args[i+1].startsWith("--"))throw Error("Missing "+name);return args[i+1];}
const root=path.resolve(arg("--root",path.join(path.dirname(fileURLToPath(import.meta.url)),"..")));
const resolve=p=>{if(typeof p!=="string"||path.isAbsolute(p))throw Error("Project-relative path required");const v=path.resolve(root,p);if(!v.startsWith(root+path.sep))throw Error("Path leaves project");return v;};
const sha=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const inputManifest=JSON.parse(fs.readFileSync(resolve(HISTORY_ROOT+"/input-manifest.json"),"utf8"));
if(inputManifest.schema!=="upstate.point-source-history-inputs/v1")throw Error("Historical input manifest required");
const inputs={};
for(const[key,p]of Object.entries(HISTORY_INPUTS)){
 const spec=inputManifest.inputs[key],body=fs.readFileSync(resolve(p));
 if(spec?.path!==p||spec.bytes!==body.length||spec.sha256!==sha(body))throw Error("Retained source differs: "+p);
 inputs[key]=body.toString("utf8");
}
const built=buildHistoryFiles(inputs,inputManifest,sha,text=>Buffer.from(text,"utf8"));
for(const f of built.files){
 const target=resolve(f.path),body=Buffer.from(f.content,"utf8");fs.mkdirSync(path.dirname(target),{recursive:true});
 if(fs.existsSync(target)&&fs.readFileSync(target).equals(body))continue;
 const temp=target+".tmp-"+process.pid;
 try{fs.writeFileSync(temp,body,{flag:"wx"});fs.renameSync(temp,target);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
process.stdout.write(JSON.stringify({project_root:root,source_manifest:path.join(root,"point_source_history.sources.json"),
 report:path.join(root,HISTORY_ROOT,"report.html"),counts:built.result.counts,source_entries:built.manifest.entries.length,
 outputs:built.files.map(f=>({path:f.path,bytes:Buffer.byteLength(f.content),sha256:sha(Buffer.from(f.content))}))},null,2)+"\n");
