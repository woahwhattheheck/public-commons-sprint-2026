#!/usr/bin/env node
/** Reproduce the complete retained NC history/report from the two pinned originals. */
import {readFile,mkdir,writeFile,rename,rm,stat} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve,join,dirname,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {produce,ROOT} from "./produce_history.mjs";
const args=process.argv.slice(2);
if(args.length!==2){console.error("Usage: node replay.mjs APPLICATION_ROOT NEW_OUTPUT_ROOT");process.exit(2);}
const application=resolve(args[0]),output=resolve(args[1]);
const identity=content=>{const b=Buffer.from(content,"utf8");return {bytes:b.length,sha256:createHash("sha256").update(b).digest("hex")};};
const pathIn=(root,name)=>{const p=resolve(root,name);if(p!==root&&!p.startsWith(root+sep))throw new Error("Path escapes root: "+name);return p;};
const ownDirectory=dirname(fileURLToPath(import.meta.url));
const provenance=JSON.parse(await readFile(join(ownDirectory,"source.json"),"utf8"));
const originals={};
for(const record of [provenance.original,provenance.metadata]){
  const content=await readFile(pathIn(application,record.path),"utf8"),actual=identity(content);
  if(actual.bytes!==record.bytes||actual.sha256!==record.sha256)throw new Error("Original source identity differs: "+record.path);
  originals[record.path]=content;
}
const sourceFiles={};
for(const name of ["history_core.mjs","render_history.mjs","produce_history.mjs","replay.mjs","source.json","README.md"]){
  sourceFiles[ROOT+"/"+name]=await readFile(join(ownDirectory,name),"utf8");
}
const result=produce(originals[provenance.original.path],originals[provenance.metadata.path],provenance,sourceFiles,identity);
const members={...sourceFiles,...originals,...result.files};
try{await stat(output);throw new Error("Output must be a new directory: "+output);}catch(error){if(error.code!=="ENOENT")throw error;}
await mkdir(dirname(output),{recursive:true});
const staging=output+".staging-"+process.pid;
await mkdir(staging,{recursive:false});
try{
  for(const [name,body] of Object.entries(members)){const p=pathIn(staging,name);await mkdir(dirname(p),{recursive:true});await writeFile(p,body,{encoding:"utf8",flag:"wx"});}
  await rename(staging,output);
}catch(error){await rm(staging,{recursive:true,force:true});throw error;}
console.log(JSON.stringify({schema:"upstate.nc-history-replay/v1",output,files:Object.entries(members).map(([path,body])=>({path,...identity(body)})),cohort:result.analysis.cohort_summary},null,2));
