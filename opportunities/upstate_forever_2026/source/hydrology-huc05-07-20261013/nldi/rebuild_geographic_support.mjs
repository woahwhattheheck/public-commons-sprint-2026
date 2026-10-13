#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {analyzeOriginalSupport,SOURCE_INPUTS} from "./geographic_support.mjs";

const args=process.argv.slice(2);
if(args.length!==2)throw Error("Usage: node rebuild_geographic_support.mjs ORIGINAL_NLDI_DIRECTORY OUTPUT_DIRECTORY");
const root=path.resolve(args[0]),output=path.resolve(args[1]);
const texts=Object.fromEntries(SOURCE_INPUTS.map(input=>[input.path,fs.readFileSync(path.join(root,input.path),"utf8")]));
const hash=text=>crypto.createHash("sha256").update(text,"utf8").digest("hex");
const {result,files}=analyzeOriginalSupport(texts,hash);
for(const [relative,text]of Object.entries(files)){
 const target=path.resolve(output,relative);
 if(!target.startsWith(output+path.sep))throw Error("Derived member leaves selected output directory");
 const body=Buffer.from(text,"utf8");
 fs.mkdirSync(path.dirname(target),{recursive:true});
 if(fs.existsSync(target)){
  if(!fs.readFileSync(target).equals(body))throw Error("An existing source edition differs: "+relative);
 }else{
  const temporary=target+".pending-"+process.pid;
  fs.writeFileSync(temporary,body,{flag:"wx"});
  try{fs.linkSync(temporary,target);}catch(error){
   if(error.code!=="EEXIST"||!fs.readFileSync(target).equals(body))throw error;
  }finally{fs.unlinkSync(temporary);}
 }
}
process.stdout.write(JSON.stringify({schema:"upstate.catchment-applicability-reproduction/v1",counts:result.counts,
 files:Object.entries(files).map(([relative,text])=>({path:relative,bytes:Buffer.byteLength(text),sha256:hash(text)}))},null,2)+"\n");
