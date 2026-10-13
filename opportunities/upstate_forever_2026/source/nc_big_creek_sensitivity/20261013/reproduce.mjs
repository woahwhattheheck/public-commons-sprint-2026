#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";
import {BASE,derive} from "./derive.mjs";
import {present} from "./present.mjs";
import {renderExplorer} from "./explorer.mjs";
import {sourceManifest} from "./source_manifest.mjs";
const mode=process.argv[2];
if(process.argv.length!==3||!["--check","--write"].includes(mode))throw Error("Use reproduce.mjs --check or --write");
const here=path.dirname(fileURLToPath(import.meta.url)),app=path.resolve(here,"../../..");
const sha=text=>crypto.createHash("sha256").update(text,"utf8").digest("hex");
const descriptor=(name,text)=>({path:name,bytes:Buffer.byteLength(text,"utf8"),sha256:sha(text)});
const files={};
function collect(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(entry.name.startsWith(".")||entry.name==="__pycache__")continue;const full=path.join(dir,entry.name);if(entry.isDirectory())collect(full);else if(entry.isFile()&&!entry.name.endsWith(".pyc"))files[path.relative(app,full).split(path.sep).join("/")]=fs.readFileSync(full,"utf8");}}
collect(here);
const provenance=JSON.parse(files[BASE+"provenance.json"]);
for(const original of provenance.files){const body=files[original.path];if(typeof body!=="string"||Buffer.byteLength(body,"utf8")!==original.bytes||sha(body)!==original.sha256)throw Error("Original source changed: "+original.path);}
const built=derive(files,provenance),presentation=present(built,provenance);
const generated={...built.files,...presentation.files,[BASE+"measurement-explorer.html"]:renderExplorer(built)};
Object.assign(files,generated);
generated["nc_big_creek_sensitivity.sources.json"]=JSON.stringify(sourceManifest(files,descriptor),null,2)+"\n";
const changed=[];
for(const [name,body] of Object.entries(generated)){
 const destination=path.join(app,name),prior=fs.existsSync(destination)?fs.readFileSync(destination,"utf8"):null;
 if(prior!==body){changed.push(name);if(mode==="--write"){fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,body,"utf8");}}
}
if(mode==="--check"&&changed.length)throw Error("Generated members differ: "+changed.join(", "));
console.log(JSON.stringify({schema:"upstate.nc-big-creek-reproduction/v1",mode,original_files:provenance.files.length,generated_files:Object.keys(generated).length,changed,summary:built.summary},null,2));
