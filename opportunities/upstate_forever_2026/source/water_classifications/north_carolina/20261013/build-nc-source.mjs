#!/usr/bin/env node
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {buildNorthCarolinaSavannah} from "./build-registry.mjs";
const root=resolve(process.argv[2]||dirname(fileURLToPath(import.meta.url)));
const read=p=>readFileSync(resolve(root,p),"utf8");
const files={"source-manifest.json":read("source-manifest.json")};
for(const row of JSON.parse(files["source-manifest.json"]).files)files[row.path]=read(row.path);
for(const p of ["extracted/savannah-hydrologic-schedule-lines.json","extracted/savannah-alphabetic-schedule-lines.json"])files[p]=read(p);
const result=buildNorthCarolinaSavannah(files,s=>createHash("sha256").update(s,"utf8").digest("hex"));
for(const [path,content]of Object.entries(result.files)){const dest=resolve(root,path);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,content);}
process.stdout.write(JSON.stringify(result.summary,null,2)+"\n");
