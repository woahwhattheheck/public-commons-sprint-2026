#!/usr/bin/env node
// Read unchanged completed source, publish one new report edition, then import its manifest.
import {readFile,mkdir,open,realpath,rm} from "node:fs/promises";
import {resolve,dirname,basename,join} from "node:path";
import {composeOriginalLandcoverChangeContext} from "./original_landcover_change_context.mjs";
const HASH=/^[a-f0-9]{64}$/;
function argumentsFor(argv){
  const selected={};
  for(let i=0;i<argv.length;i+=2){
    const key=argv[i],value=argv[i+1];
    if(!["--source-manifest","--manifest-sha256","--output"].includes(key)||!value||value.startsWith("--")||selected[key])throw Error("Use --source-manifest ORIGINAL_MODEL_SOURCES_JSON --manifest-sha256 ORIGINAL_SHA256 --output NEW_DIRECTORY");
    selected[key]=value;
  }
  if(Object.keys(selected).length!==3||!HASH.test(selected["--manifest-sha256"]||""))throw Error("Supply the original source manifest, independent SHA256 and new output directory");
  return selected;
}
async function main(){
  const args=argumentsFor(process.argv.slice(2)),manifestPath=await realpath(resolve(args["--source-manifest"])),root=dirname(manifestPath);
  const manifestBody=await readFile(manifestPath),manifest=JSON.parse(manifestBody.toString("utf8"));
  if(manifest.schema!=="upstate.sources/v1"||!Array.isArray(manifest.entries))throw Error("Select the original completed-analysis manifest");
  const files={"model-sources.json":manifestBody};
  for(const entry of manifest.entries){
    if(typeof entry.path!=="string"||!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(entry.path)||entry.path==="."||entry.path==="..")throw Error("Original analysis source path must be a plain relative filename");
    if(files[entry.path])throw Error("Original manifest repeats an input path");
    const path=await realpath(join(root,entry.path));if(dirname(path)!==root)throw Error("Original input escapes its source directory");
    files[entry.path]=await readFile(path);
  }
  const report=composeOriginalLandcoverChangeContext({files,expectedManifestSha256:args["--manifest-sha256"]});
  const requested=resolve(args["--output"]),parent=await realpath(dirname(requested)),out=join(parent,basename(requested));
  await mkdir(out,{mode:0o700});
  let complete=false;
  try{
    for(const [name,body]of Object.entries(report.files)){
      if(!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name))throw Error("Output member must be a plain relative filename");
      const file=await open(join(out,name),"wx",0o600);
      try{await file.writeFile(body);await file.sync();}finally{await file.close();}
    }
    complete=true;
  }finally{if(!complete)await rm(out,{recursive:true,force:true});}
  process.stdout.write(JSON.stringify({output:out,source_id:report.sourceId,import_manifest:join(out,"source-manifest.json"),...report.summary},null,2)+"\n");
}
main().catch(error=>{process.stderr.write(error.stack+"\n");process.exitCode=1;});
