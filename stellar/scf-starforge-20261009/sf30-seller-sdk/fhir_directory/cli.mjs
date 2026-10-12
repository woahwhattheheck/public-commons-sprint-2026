#!/usr/bin/env node
// MIT. Source-owned native Directory command; no installed service or duplicate runtime.
import {spawn} from "node:child_process";
import {fileURLToPath,pathToFileURL} from "node:url";
import path from "node:path";
const HERE=path.dirname(fileURLToPath(import.meta.url));
export function run(args=process.argv.slice(2)){
  const executable=process.env.SF30_DIRECTORY_PYTHON||process.env.CODEX_PRIMARY_RUNTIME_PYTHON||"python3";
  const child=spawn(executable,[path.join(HERE,"cli.py"),...args],{stdio:"inherit",env:process.env});
  for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>{if(!child.killed)child.kill(signal);});
  child.on("error",error=>{process.stderr.write(JSON.stringify({error:error.message})+"\n");process.exitCode=2;});
  child.on("exit",(code,signal)=>{process.exitCode=code??(signal?1:0);});
  return child;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)run();
