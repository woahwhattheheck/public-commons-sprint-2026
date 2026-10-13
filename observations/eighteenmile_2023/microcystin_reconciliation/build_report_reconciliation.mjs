#!/usr/bin/env node
import {readFile,mkdir,writeFile} from "node:fs/promises";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {buildWqpTables,parseCsv,writeCsv} from "../paired_analysis/originals/normalize_core.mjs";
import {reconcileMicrocystinReport} from "./reconcile_core.mjs";
import {renderMicrocystinReconciliation} from "./reconcile_report.mjs";
const root=dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=="--output")throw Error("Usage: node build_report_reconciliation.mjs --output OUTPUT_DIRECTORY");
const output=resolve(args[1]),input=JSON.parse(await readFile(join(root,"input-manifest.json"),"utf8"));
const digest=body=>createHash("sha256").update(body).digest("hex");
async function original(entry){
  if(!/^\.\.\/paired_analysis\/originals\/[A-Za-z0-9_.-]+$/.test(entry.path))throw Error("Unexpected original input path");
  const body=await readFile(join(root,entry.path));
  if(body.length!==entry.bytes||digest(body)!==entry.sha256)throw Error("Original source identity differs: "+entry.path);
  return body.toString("utf8");
}
await original(input.normalizer);
const captures=[];
for(const entry of input.originals)captures.push({...entry,rows:parseCsv(await original(entry))});
const tables=buildWqpTables(captures);
const result=reconcileMicrocystinReport(tables.selected_chlorophyll,tables.measurements);
if(JSON.stringify(result.coverage)!==JSON.stringify(input.coverage))throw Error("Original inferred cohort changed");
const outputs=renderMicrocystinReconciliation(result,writeCsv);
await mkdir(output,{recursive:true});
for(const [name,content] of Object.entries(outputs)){
  const path=join(output,name);
  try{if(await readFile(path,"utf8")!==content)throw Error("Output differs; choose a new directory: "+path);}
  catch(error){if(error.code!=="ENOENT")throw error;await writeFile(path,content,{encoding:"utf8",flag:"wx"});}
}
process.stdout.write(JSON.stringify({output,coverage:result.coverage,files:Object.entries(outputs).map(([path,content])=>({path,bytes:Buffer.byteLength(content,"utf8"),sha256:digest(Buffer.from(content,"utf8"))}))},null,2)+"\n");
