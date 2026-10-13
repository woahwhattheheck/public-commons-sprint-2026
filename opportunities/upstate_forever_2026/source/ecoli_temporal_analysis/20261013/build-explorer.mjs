#!/usr/bin/env node
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";
import {fileURLToPath} from "node:url";
import {dirname,resolve,join} from "node:path";
import {buildExplorer} from "./explorer.mjs";
import {buildOutputs} from "./analysis.mjs";
import {compareCalendarSupport} from "./compare-calendar-support.mjs";
const here=dirname(fileURLToPath(import.meta.url)),args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i++){
 if(args[i]==="--help"){console.log("node build-explorer.mjs [--source ORIGINAL_CSV_DIRECTORY] [--flow ORIGINAL_WATERML_JSON] [--output HTML_PATH]");process.exit(0);}
 if(!["--source","--flow","--output"].includes(args[i])||!args[i+1]||args[i+1].startsWith("--")||options[args[i]])throw Error("Unknown, duplicate or incomplete option: "+args[i]);
 options[args[i]]=args[++i];
}
const manifest=JSON.parse(await readFile(join(here,"source-manifest.json"),"utf8")),inputs={};
const digest=b=>createHash("sha256").update(b).digest("hex");
for(const item of manifest.inputs){
 const path=item.role==="flow"&&options["--flow"]?resolve(options["--flow"]):item.role!=="flow"&&options["--source"]?resolve(options["--source"],item.role==="results"?"results-with-provenance.csv":"station-membership.csv"):resolve(here,item.path);
 const body=await readFile(path);if(body.length!==item.bytes||digest(body)!==item.sha256)throw Error("Original input differs from the pinned edition: "+item.role);inputs[item.role]=body.toString("utf8");
}
const outputs=buildOutputs(inputs.results,inputs.stations,JSON.parse(inputs.flow));
for(const [name,content]of Object.entries(outputs.files)){const expected=manifest.outputs[name],b=Buffer.from(content);if(!expected||b.length!==expected.bytes||digest(b)!==expected.sha256)throw Error("Analysis output differs: "+name);}
const calendar=compareCalendarSupport(inputs.results,inputs.stations),calendarFiles={};
for(const name of ["calendar-support-comparisons.csv","calendar-support-source-rows.csv","calendar-support-summary.json","CALENDAR_SUPPORT.md"]){const content=await readFile(join(here,name),"utf8");if(calendar.files[name]!==undefined&&calendar.files[name]!==content)throw Error("Calendar support output differs: "+name);calendarFiles[name]=content;}
const payload={schema:"upstate.microbial-explorer/v1",manifest,inputs,analysisSource:await readFile(join(here,"analysis.mjs"),"utf8"),calendarSource:await readFile(join(here,"compare-calendar-support.mjs"),"utf8"),calendarFiles,readme:await readFile(join(here,"README.md"),"utf8")};
const html=buildExplorer(payload,b=>gzipSync(b,{level:9,mtime:0})),output=resolve(options["--output"]||join(here,"index.html"));
await mkdir(dirname(output),{recursive:true});await writeFile(output,html,"utf8");
console.log(JSON.stringify({operation:"ECO-MICROBIAL-EXPLORER-20261013",output,bytes:Buffer.byteLength(html),sha256:digest(Buffer.from(html)),original_records:outputs.summary.selection.source_records,calendar_comparisons:calendar.comparisons.length},null,2));
