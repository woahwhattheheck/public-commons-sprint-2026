#!/usr/bin/env node
import {readFile, mkdir, writeFile, rename} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {dirname, resolve, sep} from "node:path";
import {createHash} from "node:crypto";
import {calculateFlowCoverage} from "./flow_coverage_core.mjs";
import {buildFlowCoverageFigure} from "./figure_core.mjs";
import {buildOutputFiles} from "./output_core.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let destination = root, verifyOnly = false;
for (let i=0; i<args.length; i++) {
  if (args[i] === "--out" && args[i+1]) destination = resolve(args[++i]);
  else if (args[i] === "--verify-only") verifyOnly = true;
  else throw Error("Usage: node rebuild.mjs [--out DIRECTORY] [--verify-only]");
}
const hash = b => createHash("sha256").update(b).digest("hex");
const index = JSON.parse(await readFile(resolve(root,"source-index.json"),"utf8"));
const vendorBodies=new Map(), vendorModules=new Map();
for(const source of index.vendor) {
  const bytes=await readFile(resolve(root,source.path));
  if(bytes.length!==source.bytes||hash(bytes)!==source.sha256)
    throw Error("Pinned vendor differs: "+source.path);
  vendorBodies.set(source.module,bytes.toString("utf8"));
}
function requireVendor(name) {
  if(vendorModules.has(name))return vendorModules.get(name);
  if(!vendorBodies.has(name))throw Error("Unretained dependency: "+name);
  const module={exports:{}};
  new Function("module","exports","require",vendorBodies.get(name))(module,module.exports,requireVendor);
  vendorModules.set(name,module.exports);
  return module.exports;
}
const d3={...requireVendor("d3-array"),...requireVendor("d3-shape")};

const loaded = new Map();
for (const source of index.inputs) {
  const full = resolve(root,source.path);
  if (!full.startsWith(root+sep)) throw Error("Input escapes component");
  const bytes = await readFile(full);
  if (bytes.length !== source.bytes || hash(bytes) !== source.sha256)
    throw Error("Original source differs: "+source.path);
  loaded.set(source.path,bytes.toString("utf8"));
}
function csv(text) {
  const rows=[];let row=[],value="",quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'&&text[i+1]==='"'){value+='"';i++}else if(c==='"')quoted=false;else value+=c}
    else if(c==='"')quoted=true;
    else if(c===","){row.push(value);value=""}
    else if(c==="\n"||c==="\r"){if(c==="\r"&&text[i+1]==="\n")i++;row.push(value);
      if(row.some(x=>x!==""))rows.push(row);row=[];value=""}
    else value+=c;
  }
  if(quoted)throw Error("Incomplete CSV quotation");
  if(row.length||value){row.push(value);rows.push(row)}
  const columns=rows.shift().map((x,i)=>i===0?x.replace(/^\uFEFF/,""):x);
  return rows.map(r=>{if(r.length!==columns.length)throw Error("CSV row width changed");
    return Object.fromEntries(columns.map((c,i)=>[c,r[i]]))});
}
const one = role => {
  const sources=index.inputs.filter(s=>s.role===role);
  if(sources.length!==1)throw Error("Expected one "+role+" source");
  return sources[0];
};
const selectedSource=one("selected_chlorophyll");
const raw=new Map(index.inputs.filter(s=>s.role==="original_chlorophyll_response")
  .map(s=>[s.sha256,csv(loaded.get(s.path))]));
const pairs={activity_id:"ActivityIdentifier",station_id:"MonitoringLocationIdentifier",
  project_id:"ProjectIdentifier",sample_date:"ActivityStartDate",sample_time:"ActivityStartTime/Time",
  sample_timezone:"ActivityStartTime/TimeZoneCode",characteristic:"CharacteristicName",
  reported_value:"ResultMeasureValue",reported_unit:"ResultMeasure/MeasureUnitCode"};
let matched=0;
for(const record of csv(loaded.get(selectedSource.path))) {
  const original=raw.get(record.source_sha256)?.[Number(record.source_record_index)-1];
  if(!original)throw Error("Missing original CHLA row "+record.record_id);
  for(const [derived,key] of Object.entries(pairs))
    if(record[derived]!==original[key])throw Error("Changed original "+key+" for "+record.record_id);
  matched++;
}
const routine=index.inputs.filter(s=>s.role==="routine_nutrients")
  .map(s=>({path:s.original_path,sha256:s.sha256,content:loaded.get(s.path)}));
const result=calculateFlowCoverage(JSON.parse(loaded.get(one("daily_flow").path)),
  loaded.get(selectedSource.path),routine);
const figure=buildFlowCoverageFigure(result,d3);
const outputs=buildOutputFiles(result,figure);
for(const entry of index.outputs) {
  if(!(entry.path in outputs))throw Error("Missing rebuilt output "+entry.path);
  const body=Buffer.from(outputs[entry.path],"utf8");
  if(body.length!==entry.bytes||hash(body)!==entry.sha256)
    throw Error("Rebuilt output differs from executed source edition: "+entry.path);
}
if(Object.keys(outputs).length!==index.outputs.length)throw Error("Output catalogue differs");
if(!verifyOnly)for(const [path,body] of Object.entries(outputs)){
  const full=resolve(destination,path);
  if(!full.startsWith(destination+sep))throw Error("Output escapes destination");
  await mkdir(dirname(full),{recursive:true});
  const staged=full+".rebuilding-"+process.pid;
  await writeFile(staged,body,"utf8");await rename(staged,full);
}
console.log(JSON.stringify({source_inputs_verified:index.inputs.length,
  original_chlorophyll_rows_verified:matched,rebuilt_outputs:index.outputs.length,
  original_flow_days:result.daily.length,distinct_chla_dates:result.sampling[0].distinct_dates,
  activities:result.activities.length,annual:result.annual,
  destination:verifyOnly?null:destination,verify_only:verifyOnly},null,2));
