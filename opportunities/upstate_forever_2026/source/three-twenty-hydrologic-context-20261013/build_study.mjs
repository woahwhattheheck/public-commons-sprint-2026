#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {assemble,ROOT,MANIFEST} from "./package_study.mjs";
const args=process.argv.slice(2);
if(args.includes("--help")){console.log("node build_study.mjs --app-root APPLICATION --output NEW_APPLICATION_ROOT");process.exit(0);}
const opts={};
for(let i=0;i<args.length;i+=2){
 if(!["--app-root","--output"].includes(args[i])||!args[i+1]||args[i+1].startsWith("--")||Object.hasOwn(opts,args[i]))throw Error("Use one --app-root and one --output.");
 opts[args[i]]=args[i+1];
}
if(!opts["--app-root"]||!opts["--output"])throw Error("Usage: node build_study.mjs --app-root APPLICATION --output NEW_APPLICATION_ROOT");
const application=fs.realpathSync(opts["--app-root"]),output=path.resolve(opts["--output"]);
if(output===application||output.startsWith(application+path.sep))throw Error("Rebuild into a separate output directory.");
function contained(root,relative){
 if(typeof relative!=="string"||path.isAbsolute(relative)||relative.includes("\\")||relative.split("/").some(x=>!x||x==="."||x===".."))throw Error("Unsafe relative source path.");
 const full=path.resolve(root,relative);
 if(!full.startsWith(root+path.sep))throw Error("Source path outside root.");
 return full;
}
function read(relative){
 const real=fs.realpathSync(contained(application,relative));
 if(!real.startsWith(application+path.sep))throw Error("Source symlink outside application.");
 return new TextDecoder("utf-8",{fatal:true}).decode(fs.readFileSync(real));
}
const identity=content=>{
 if(typeof content!=="string")throw Error("Missing complete UTF-8 source.");
 return {bytes:Buffer.byteLength(content,"utf8"),sha256:createHash("sha256").update(content,"utf8").digest("hex")};
};
const inputManifest=JSON.parse(read(ROOT+"/input-manifest.json"));
const authoredManifest=JSON.parse(read(ROOT+"/authored-inputs.json"));
const originals=inputManifest.files.map(f=>({...f,content:read(f.path)}));
const authored=Object.fromEntries(authoredManifest.files.map(f=>[f.path,read(f.path)]));
const result=assemble(originals,authored,inputManifest,authoredManifest,identity);
fs.mkdirSync(output,{recursive:true});
const target=fs.realpathSync(output);
if(target===application||target.startsWith(application+path.sep))throw Error("Output resolves into application.");
for(const[relative,content]of Object.entries(result.files)){
 const full=contained(target,relative);let parent=path.dirname(full);
 while(!fs.existsSync(parent))parent=path.dirname(parent);
 const realParent=fs.realpathSync(parent);
 if(realParent!==target&&!realParent.startsWith(target+path.sep))throw Error("Output parent outside root.");
 if(fs.existsSync(full)){
  const real=fs.realpathSync(full);
  if(!real.startsWith(target+path.sep)||fs.readFileSync(real,"utf8")!==content)throw Error("Refusing different existing output: "+relative);
 }
}
for(const[relative,content]of Object.entries(result.files)){
 const full=contained(target,relative);fs.mkdirSync(path.dirname(full),{recursive:true});
 if(!fs.existsSync(full))fs.writeFileSync(full,content,{encoding:"utf8",flag:"wx"});
}
console.log(JSON.stringify({schema:"three-twenty.network-source-build/v1",output:target,files:Object.keys(result.files).length,source_manifest:path.join(target,MANIFEST),report:path.join(target,ROOT,"station-network-report.html")},null,2));
