#!/usr/bin/env node
// Compose the complete retained zonal result into the maintained scientific source.
import { readFile, mkdir, open, realpath, rm } from "node:fs/promises";
import { resolve, dirname, basename, join } from "node:path";
import { composeOriginalLandcoverContext } from "./original_landcover_context.mjs";

function options(argv) {
  const selected={};
  for(let i=0;i<argv.length;i+=2){
    const key=argv[i],value=argv[i+1];
    if(!["--zonal","--zonal-sha256","--raster-entry","--output"].includes(key)||!value||value.startsWith("--")||selected[key])
      throw Error("Use --zonal ORIGINAL_JSON --zonal-sha256 ORIGINAL_SHA --raster-entry ORIGINAL_SOURCE_ENTRY --output NEW_DIRECTORY");
    selected[key]=value;
  }
  if(Object.keys(selected).length!==4)throw Error("Supply all four original receiving arguments");
  return selected;
}
async function main(){
  const args=options(process.argv.slice(2));
  const entryPath=await realpath(resolve(args["--raster-entry"]));
  const [zonalBody,rasterEntryBody,classAreaBody]=await Promise.all([
    readFile(await realpath(resolve(args["--zonal"]))),
    readFile(entryPath),
    readFile(join(dirname(entryPath),"class-area.csv"))
  ]);
  const result=composeOriginalLandcoverContext({zonalBody,rasterEntryBody,classAreaBody,expectedZonalSha256:args["--zonal-sha256"]});
  const requested=resolve(args["--output"]),parent=await realpath(dirname(requested)),output=join(parent,basename(requested));
  // All source checks and report construction finish before creating the new edition.
  await mkdir(output,{mode:0o700});
  let complete=false;
  try{
    for(const [name,body]of Object.entries(result.files)){
      if(!/^[A-Za-z0-9_.-]+$/.test(name))throw Error("Report member is not a plain filename");
      const file=await open(join(output,name),"wx",0o600);
      try{await file.writeFile(body);await file.sync();}finally{await file.close();}
    }
    complete=true;
  }finally{
    if(!complete)await rm(output,{recursive:true,force:true});
  }
  process.stdout.write(JSON.stringify({output,source_id:result.sourceId,import_manifest:"source-manifest.json",...result.summary},null,2)+"\n");
}
main().catch(error=>{process.stderr.write(error.stack+"\n");process.exitCode=1;});
