#!/usr/bin/env node
import { spawnAudit } from "./native.mjs";
const child = spawnAudit(process.argv.slice(2), {stdio:"inherit"});
for (const signal of ["SIGINT","SIGTERM"]) process.on(signal,()=>child.kill(signal));
child.once("error", error => { console.error(error.message); process.exitCode=1; });
child.once("exit",(code,signal)=>{process.exitCode=code ?? (signal?1:0);});
