#!/usr/bin/env node
/** Rebuild the retained Georgia designation/source relationship family. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";
import {derive,outputFiles} from "./build-relationships.mjs";
const here=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);
let output=here,check=false;
for(let i=0;i<args.length;i++){
  if(args[i]==="--output"&&args[i+1])output=path.resolve(args[++i]);
  else if(args[i]==="--check")check=true;
  else throw new Error("Usage: node rebuild.mjs [--output DIRECTORY] [--check]");
}
const sha=body=>crypto.createHash("sha256").update(body).digest("hex");
const manifest=JSON.parse(fs.readFileSync(path.join(here,"input-manifest.json"),"utf8"));
const retained=new Map();
for(const item of manifest.files){
  const target=path.resolve(here,item.path);
  if(!target.startsWith(here+path.sep))throw new Error("Input leaves its original source family");
  const body=fs.readFileSync(target);
  if(body.length!==item.bytes||sha(body)!==item.sha256)throw new Error("Original input changed: "+item.path);
  retained.set(item.path,body);
}
const read=name=>JSON.parse(retained.get(name).toString("utf8"));
const assessment=name=>read("original-assessment/"+name);
const result=derive({
  registry:read("original-legal/ga.selected-reaches.json"),rules:read("review-definitions.json"),
  streamBodies:["001","002"].map(n=>({path:"georgia-2024-savannah-stream-attributes-"+n+"-original.json",
    value:assessment("georgia-2024-savannah-stream-attributes-"+n+"-original.json")})),
  lakeBody:{path:"georgia-2024-savannah-lake-attributes-original.json",
    value:assessment("georgia-2024-savannah-lake-attributes-original.json")},
  streamIDs:assessment("georgia-2024-savannah-stream-ids-original.json"),
  lakeIDs:assessment("georgia-2024-savannah-lake-ids-original.json"),
  attributeCapture:assessment("acquisition.public.json"),
  geometryCapture:assessment("geometry-source-index.json"),inputs:manifest.files
});
const generated=outputFiles(result);
if(!check)fs.mkdirSync(output,{recursive:true});
const receipt=[];
for(const [name,text] of Object.entries(generated)){
  const destination=path.join(output,name),body=Buffer.from(text,"utf8");
  if(fs.existsSync(destination)){
    if(!fs.readFileSync(destination).equals(body))throw new Error("Existing output differs: "+destination);
  }else{
    if(check)throw new Error("Missing original output: "+destination);
    const temporary=destination+".pending-"+process.pid+"-"+crypto.randomBytes(4).toString("hex");
    try{
      const fd=fs.openSync(temporary,"wx",0o600);
      try{fs.writeFileSync(fd,body);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      try{fs.linkSync(temporary,destination);}catch(error){
        if(error.code!=="EEXIST"||!fs.readFileSync(destination).equals(body))throw error;
      }
    }finally{fs.rmSync(temporary,{force:true});}
  }
  receipt.push({path:name,bytes:body.length,sha256:sha(body)});
}
console.log(JSON.stringify({schema:"upstate.ga-designation-relationship-rebuild/v1",
  counts:result.register.counts,mode:check?"verified_existing_outputs":"retained_outputs",
  output,files:receipt},null,2));
