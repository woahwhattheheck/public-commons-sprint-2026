#!/usr/bin/env node
/** Rebuild the additional calibration context from exact retained source responses. */
import {readFile,writeFile,mkdir,rename} from "node:fs/promises";
import {resolve,dirname,relative,isAbsolute,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {derive} from "./derive-discharge.mjs";
import {calibrationBuild} from "./calibration_context.mjs";
const root=dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=="--output-dir")throw Error("Usage: node rebuild_calibration.mjs --output-dir OUTPUT_DIRECTORY");
const output=resolve(args[1]),sha=b=>createHash("sha256").update(b).digest("hex");
function inside(base,name){if(typeof name!=="string"||isAbsolute(name)||name.includes("\\")||name.includes("\0"))throw Error("Require a retained relative path");const target=resolve(base,name),rel=relative(base,target);if(!rel||rel===".."||rel.startsWith(".."+sep)||isAbsolute(rel))throw Error("Source path leaves its edition");return target;}
async function checked(entry){const b=await readFile(inside(root,entry.path));if(b.length!==entry.bytes||sha(b)!==entry.sha256)throw Error("Original source changed: "+entry.path);return b.toString("utf8");}
const index=JSON.parse(await readFile(resolve(root,"calibration-inputs.json"),"utf8"));
if(index.schema!=="upstate.discharge-calibration-inputs/v1")throw Error("Select the retained calibration input index");
for(const entry of index.implementation)await checked(entry);
const manifest=JSON.parse(await checked(index.manifest)),originals={};
for(const entry of manifest.originals)originals[entry.path]=await checked(entry);
const parsed=derive(originals,manifest);
const lines=originals["original/usgs-stations-expanded.tsv"].split(/\r?\n/).filter(x=>x&&!x.startsWith("#")),cols=lines[0].split("\t");
const inventory=lines.slice(2).map(line=>{const cells=line.split("\t");if(cells.length!==cols.length)throw Error("Station table width differs");return Object.fromEntries(cols.map((key,i)=>[key,cells[i]]));});
const result=calibrationBuild(parsed.records,manifest,inventory),expected=new Map(index.derived_files.map(x=>[x.path,x]));
if(result.files.length!==expected.size)throw Error("Derived calibration file set differs");
const ready=result.files.map(file=>{const b=Buffer.from(file.text,"utf8"),e=expected.get(file.path);if(!e||b.length!==e.bytes||sha(b)!==e.sha256)throw Error("Derived calibration context differs: "+file.path);return{path:inside(output,file.path),body:b};});
for(const item of ready){await mkdir(dirname(item.path),{recursive:true});const temp=item.path+".partial-"+process.pid;await writeFile(temp,item.body);await rename(temp,item.path);}
process.stdout.write(JSON.stringify({output,source_records:result.coverage.source_record_count,numeric_days:result.coverage.numeric_daily_records,complete_years:result.coverage.complete_calendar_years,derived_files:ready.length})+"\n");
