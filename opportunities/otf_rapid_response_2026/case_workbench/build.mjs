#!/usr/bin/env node
/* MIT. Produce the same standalone desk from the complete source modules. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {bundleDesk} from "./bundle.mjs";
import {buildExample} from "./example.mjs";
const root=path.dirname(fileURLToPath(import.meta.url)),sources={};
for(const name of ["model","reports","forms","vendor-review","browser"])sources[name+".mjs"]=fs.readFileSync(path.join(root,name+".mjs"),"utf8");
sources["vendor-core.mjs"]=fs.readFileSync(path.join(root,"../vendor_submission_20261011/vendor-core.mjs"),"utf8");
const html=bundleDesk(sources,(await buildExample()).ledger),output=path.resolve(process.argv[2]??path.join(root,"desk.html"));
try{fs.writeFileSync(output,html,{encoding:"utf8",mode:0o600,flag:"wx"});}catch(e){if(e.code!=="EEXIST"||fs.readFileSync(output,"utf8")!==html)throw e;}
process.stdout.write(output+"\n");
