#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {randomUUID,createHash} from "node:crypto";
import "./core.js";
import "./portable.js";
const [command,...words]=process.argv.slice(2),args={};
for(let i=0;i<words.length;i+=2){if(!words[i]?.startsWith("--")||!words[i+1])throw Error("Use --option value pairs.");args[words[i].slice(2)]=words[i+1];}
const sha=data=>createHash("sha256").update(data).digest("hex");
const ownDir=path.dirname(fileURLToPath(import.meta.url));
const names=["core.js","index.html","capture.mjs","portable.js","handover.mjs","receive_handover.mjs","README.md","SOURCES.md","HANDOVER.md"];
async function verify(root) {
 const manifest=JSON.parse(await fs.readFile(path.join(root,"manifest.json"),"utf8"));
 if(manifest.schema!=="rainfall-handover/v1"||!Array.isArray(manifest.files))throw Error("Unknown handover manifest.");
 const seen=new Set();let bytes=0;
 for(const item of manifest.files){
  if(typeof item.path!=="string"||item.path.startsWith("/")||item.path.includes("\\")||item.path.split("/").some(p=>!p||p==="."||p==="..")||seen.has(item.path))throw Error("Invalid handover member.");
  seen.add(item.path);const file=await fs.readFile(path.join(root,item.path));
  if(file.length!==item.bytes||sha(file)!==item.sha256)throw Error("Handover member differs: "+item.path);bytes+=file.length;
 }
 const original=JSON.parse(await fs.readFile(path.join(root,"review-project.json"),"utf8"));
 const reopened=RainfallReview.reopen(original);
 if(JSON.stringify(reopened.releases.map(r=>r.fingerprint))!==JSON.stringify(manifest.release_fingerprints))throw Error("Reopened original releases differ.");
 return {directory:path.resolve(root),members:seen.size,bytes,release_fingerprints:manifest.release_fingerprints};
}
try{
 if(command==="verify"){if(!args.dir)throw Error("verify needs --dir.");process.stdout.write(JSON.stringify(await verify(args.dir),null,2)+"\n");}
 else if(command==="build"){
  if(!args.before||!args.out)throw Error("build needs --before CAPTURE --out NEW_DIRECTORY; optionally --after CAPTURE --notes FILE --public-sources PACKET.");
  const sourceFiles=Object.fromEntries(await Promise.all(names.map(async name=>[name,await fs.readFile(path.join(ownDir,name),"utf8")])));
  const captureTexts=[await fs.readFile(args.before,"utf8")];if(args.after)captureTexts.push(await fs.readFile(args.after,"utf8"));
  const notes=args.notes?await fs.readFile(args.notes,"utf8"):"";
  const publicSourceTexts=args["public-sources"]?[await fs.readFile(args["public-sources"],"utf8")]:[];
  const result=RainfallHandover.build({R:RainfallReview,sourceFiles,captureTexts,notes,publicSourceTexts});
  const destination=path.resolve(args.out),parent=path.dirname(destination),staging=destination+".building-"+randomUUID();
  await fs.mkdir(parent,{recursive:true});
  try{await fs.mkdir(staging);for(const m of result.members){const p=path.join(staging,m.path);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,m.content,{flag:"wx"});}
   const zipPath=path.join(staging,"rainfall-handover.zip");await fs.writeFile(zipPath,result.zip,{flag:"wx"});
   const receipt={...await verify(staging),zip:{file:"rainfall-handover.zip",bytes:result.zip.length,sha256:sha(result.zip)}};
   await fs.writeFile(path.join(staging,"BUILD.json"),JSON.stringify({...receipt,directory:destination},null,2)+"\n",{flag:"wx"});
   // Existing output is never replaced. mkdir reserves the destination across producers.
   await fs.mkdir(destination);
   for(const entry of await fs.readdir(staging))await fs.rename(path.join(staging,entry),path.join(destination,entry));
   await fs.rmdir(staging);process.stdout.write(JSON.stringify({...receipt,directory:destination},null,2)+"\n");
  }catch(e){process.stderr.write("Prepared files are retained at "+staging+" if it exists.\n");throw e;}
 }else throw Error("Commands: build --before CAPTURE --out NEW_DIRECTORY | verify --dir EXTRACTED_HANDOVER");
}catch(e){process.stderr.write(e.message+"\n");process.exitCode=1;}
