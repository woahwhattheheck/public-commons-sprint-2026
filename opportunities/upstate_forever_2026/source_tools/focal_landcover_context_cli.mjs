#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {composeFocalLandcoverContext} from "./focal_landcover_context.mjs";
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i++){
 const key=args[i];if(!["--focal-source-manifest","--parent-source-manifest","--output"].includes(key)||options[key]!==undefined||!args[i+1]||args[i+1].startsWith("--"))throw Error("Usage: node source_tools/focal_landcover_context_cli.mjs --focal-source-manifest ORIGINAL_FOCAL/model-sources.json --parent-source-manifest ORIGINAL_DOMAIN/model-sources.json --output NEW_DIRECTORY");
 options[key]=args[++i];
}
for(const key of ["--focal-source-manifest","--parent-source-manifest","--output"])if(!options[key])throw Error("Missing "+key);
function sourceFiles(filename,names){
 const manifest=fs.realpathSync(filename),root=path.dirname(manifest);
 if(path.basename(manifest)!=="model-sources.json")throw Error("Use the original model-sources.json filename");
 const out={};for(const name of names){const target=fs.realpathSync(path.join(root,name));if(path.dirname(target)!==root)throw Error("Original source escapes its containing directory: "+name);out[name]=new Uint8Array(fs.readFileSync(target));}return out;
}
const files=sourceFiles(options["--focal-source-manifest"],["selected-annual-inputs.json","selected-transitions.json","focal-summary.csv","group-change.csv","rebuild.mjs","README.md","model-sources.json"]);
const parentFiles=sourceFiles(options["--parent-source-manifest"],["annual-2023.json","annual-2025.json","transitions-2023-2025.json","huc12-change-summary.csv","model-sources.json"]);
const result=composeFocalLandcoverContext({files,parentFiles});
const target=path.resolve(options["--output"]),parent=fs.realpathSync(path.dirname(target));
if(parent!==path.dirname(target))throw Error("Use the real original output parent path");
fs.mkdirSync(target,{recursive:false});
const marker=path.join(target,".incomplete");
fs.writeFileSync(marker,"Complete original source validation passed; publication is in progress.\n",{flag:"wx"});
function write(name,body){
 const filename=path.join(target,name);if(!filename.startsWith(target+path.sep))throw Error("Output path escaped directory");
 fs.mkdirSync(path.dirname(filename),{recursive:true});const fd=fs.openSync(filename,"wx",0o644);
 try{fs.writeFileSync(fd,body);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
const entries=Object.entries(result.files),last=entries.find(([name])=>name==="source-manifest.json");
for(const [name,body]of entries)if(name!=="source-manifest.json")write(name,body);
write(last[0],last[1]);fs.unlinkSync(marker);
console.log(JSON.stringify({state:"complete",output_directory:target,source_manifest:path.join(target,"source-manifest.json"),source_id:result.sourceId,files:entries.length,source_bytes:entries.reduce((n,[,b])=>n+b.length,0),summary:result.summary},null,2));
