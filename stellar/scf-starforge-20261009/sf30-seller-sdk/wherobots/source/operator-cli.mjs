#!/usr/bin/env node
// MIT. Preserve the original Python operator commands in the installed distribution.
import {spawn} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {wherobotsToolDefinitions} from "./tools.mjs";
const args=process.argv.slice(2);
if(args.length===1&&args[0]==="tools"){
  process.stdout.write(JSON.stringify(wherobotsToolDefinitions,null,2)+"\n");
}else{
  let python=process.env.WHEROBOTS_PYTHON||"python3";
  const at=args.indexOf("--python");
  if(at!==-1){
    if(!args[at+1]||args[at+1].startsWith("--"))throw new TypeError("--python requires the installed runtime path.");
    python=args[at+1];args.splice(at,2);
  }
  const directory=path.dirname(fileURLToPath(import.meta.url));
  const child=spawn(python,[path.join(directory,"operate.py"),...args],{shell:false,stdio:"inherit",windowsHide:true});
  const forward=signal=>()=>child.kill(signal);
  const interrupt=forward("SIGINT"),terminate=forward("SIGTERM");
  process.on("SIGINT",interrupt);process.on("SIGTERM",terminate);
  child.on("error",error=>{process.stderr.write("The selected Python runtime could not start: "+error.code+"\n");process.exitCode=1;});
  child.on("close",(code,signal)=>{
    process.removeListener("SIGINT",interrupt);process.removeListener("SIGTERM",terminate);
    process.exitCode=code??(signal?1:0);
  });
}
