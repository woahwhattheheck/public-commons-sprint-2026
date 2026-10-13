#!/usr/bin/env node
/** Reproduce exact original flow support for a selected native annual-reference binding. */
import {readFile,writeFile,mkdir,realpath} from "node:fs/promises";
import {resolve,dirname,relative,sep} from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {derive} from "./derive-discharge.mjs";
import {calibrationBuild,calibrationPeriodSupport,calibrationSupportFiles} from "./calibration_context.mjs";

const hash=body=>createHash("sha256").update(body).digest("hex");
const json=value=>JSON.stringify(value,null,2)+"\n";
function safe(root,path){
  if(typeof path!=="string"||!path||path.startsWith("/")||path.includes("\\")||path.split("/").some(x=>!x||x==="."||x===".."))throw Error("Invalid retained member path: "+path);
  const target=resolve(root,path),delta=relative(root,target);
  if(delta===".."||delta.startsWith(".."+sep))throw Error("Member leaves source directory");
  return target;
}
function inventory(body){
  let columns=null,types=false;const rows=[];
  for(const line of body.split(/\r?\n/)){
    if(!line||line.startsWith("#"))continue;
    const values=line.split("\t");
    if(values[0]==="agency_cd"){columns=values;types=true;continue;}
    if(!columns)throw Error("Station inventory data precedes its original header");
    if(types){if(values.length!==columns.length||values.some(x=>!/^\d+[a-z]$/i.test(x)))throw Error("Invalid station inventory types");types=false;continue;}
    if(values.length!==columns.length)throw Error("Original station inventory width differs");
    rows.push(Object.fromEntries(columns.map((key,index)=>[key,values[index]])));
  }
  if(types)throw Error("Incomplete station inventory header");
  return rows;
}
async function writeSame(root,path,body){
  const file=safe(root,path);
  await mkdir(dirname(file),{recursive:true});
  try{const existing=await readFile(file);if(!existing.equals(Buffer.from(body)))throw Error("Output already contains another source edition: "+path);return;}
  catch(error){if(error.code!=="ENOENT")throw error;}
  await writeFile(file,body,{flag:"wx"});
}
function options(argv){
  const out={sourceRoot:dirname(fileURLToPath(import.meta.url)),output:null,binding:null,importId:null};
  const names={"--source-root":"sourceRoot","--output":"output","--binding":"binding","--import-id":"importId"};
  for(let i=0;i<argv.length;i++){
    if(argv[i]==="--help"){process.stdout.write("node rebuild_reference_support.mjs --source-root SOURCE --output NEW_OUTPUT [--binding ORIGINAL_BINDING.json] [--import-id ORIGINAL_IMPORT_ID]\n");return null;}
    const key=names[argv[i]];
    if(!key||!argv[i+1]||argv[i+1].startsWith("--"))throw Error("Unknown or missing command option: "+argv[i]);
    out[key]=argv[++i];
  }
  if(!out.output)throw Error("Choose the existing operation's output directory with --output");
  if(out.importId&&!out.binding)throw Error("--import-id requires the original --binding JSON");
  return out;
}
function chooseBinding(value,importId){
  if(value&&typeof value==="object"&&!Array.isArray(value)&&Array.isArray(value.reference_records)){
    if(importId&&value.import_id!==importId)throw Error("Selected original import_id differs");
    return value;
  }
  if(value&&typeof value==="object"&&!Array.isArray(value)&&Array.isArray(value.imports)){
    if(!importId)throw Error("Select the original annual-references catalogue entry with --import-id");
    const matches=value.imports.filter(row=>row&&row.import_id===importId);
    if(matches.length!==1){
      const failed=Array.isArray(value.errors)?value.errors.find(row=>row.import_id===importId):null;
      throw Error(failed?"Original annual-reference import failed: "+String(failed.error):"Original import_id is missing or ambiguous");
    }
    if(!Array.isArray(matches[0].reference_records))throw Error("Annual-reference catalogue must include original reference_records");
    return matches[0];
  }
  throw Error("Choose the original annual-reference binding object or annual-references catalogue with reference_records");
}
export async function rebuildReferenceSupport(opts){
  const root=await realpath(resolve(opts.sourceRoot)),output=resolve(opts.output);
  if(output===root)throw Error("Keep the original source edition and its prepared output in separate directories");
  const inputBody=await readFile(safe(root,"reference-support-inputs.json"));
  const inputs=JSON.parse(inputBody);
  if(inputs.schema!=="upstate.discharge-reference-support-inputs/v1"||!Array.isArray(inputs.source_files))throw Error("Choose the maintained reference support input descriptor");
  const bodies=new Map();
  for(const member of inputs.source_files){
    const body=await readFile(safe(root,member.path));
    if(body.length!==member.bytes||hash(body)!==member.sha256)throw Error("Original/source member differs: "+member.path);
    bodies.set(member.path,body);
  }
  const manifest=JSON.parse(bodies.get("source-manifest.json"));
  const originals={};
  for(const member of manifest.originals){
    const body=bodies.get(member.path);
    if(!body||body.length!==member.bytes||hash(body)!==member.sha256)throw Error("Original response is missing or differs: "+member.path);
    originals[member.path]=body.toString("utf8");
  }
  const original=derive(originals,manifest),stations=inventory(originals["original/usgs-stations-expanded.tsv"]);
  const calibration=calibrationBuild(original.records,manifest,stations);
  const calibrationInputs=JSON.parse(bodies.get("calibration-inputs.json"));
  for(const member of calibrationInputs.implementation){
    const body=bodies.get(member.path);
    if(!body||body.length!==member.bytes||hash(body)!==member.sha256)throw Error("Maintained calibration implementation differs: "+member.path);
  }
  for(const file of calibration.files){
    const expected=calibrationInputs.derived_files.find(x=>x.path===file.path),body=Buffer.from(file.text);
    if(!expected||body.length!==expected.bytes||hash(body)!==expected.sha256)throw Error("Maintained calendar result changed: "+file.path);
  }
  const bindingBody=opts.binding?await readFile(resolve(opts.binding)):bodies.get("flow-support/source-period-selection.json");
  if(!bindingBody)throw Error("Original selected reference binding is missing");
  const binding=chooseBinding(JSON.parse(bindingBody),opts.importId);
  const result=calibrationPeriodSupport(original.records,manifest,stations,binding);
  const outputs=calibrationSupportFiles(result);
  // Preserve the full daily14, NLDI34 and source-author calibration family in the prepared source.
  for(const [path,body] of bodies)await writeSame(output,path,body);
  await writeSame(output,"reference-support-inputs.json",inputBody);
  for(const file of calibration.files)await writeSame(output,file.path,file.text);
  await writeSame(output,"flow-support/selected-reference-binding.json",bindingBody);
  for(const file of outputs)await writeSame(output,"flow-support/"+file.path,file.text);
  const actualFiles=new Map(bodies);
  actualFiles.set("reference-support-inputs.json",inputBody);
  for(const file of calibration.files)actualFiles.set(file.path,Buffer.from(file.text));
  actualFiles.set("flow-support/selected-reference-binding.json",bindingBody);
  for(const file of outputs)actualFiles.set("flow-support/"+file.path,Buffer.from(file.text));
  const member=(path,body)=>({path,bytes:body.length,sha256:hash(body)});
  const bindingsId=hash(bindingBody),entries=[
    {id:"original-flow-reference-periods-"+bindingsId.slice(0,16),title:"Original daily-flow support for selected reference periods",kind:"table",
      role:"discharge-reference-period-support",path:"flow-support/reference-period-support.csv",id_field:"record_id",
      period_end_exclusive:true,reference_binding_sha256:bindingsId,observation_id:binding.observation_id??binding.binding?.observation_id??null,
      original_preparation_id:binding.original_preparation_id??null,
      notes:"Source support retains original reference IDs and [start,end) periods. Covered-days volume does not fill missing dates or alter original annual-load observations."},
    {id:"original-flow-date-support-"+bindingsId.slice(0,16),title:"Original numeric daily-flow availability by station",kind:"table",
      role:"discharge-date-support",path:"flow-support/station-date-support.json",id_field:"station_id",records_field:"stations",period_end_exclusive:true}
  ].map(entry=>({...entry,uri:manifest.source_request,vintage:"USGS-2020-2025-original-reference-support",
    sha256:hash(actualFiles.get(entry.path)),companions:[...actualFiles].filter(([path])=>path!==entry.path).map(([path,body])=>member(path,body))}));
  const sources={schema:"upstate.sources/v1",title:"Original discharge and exact reference-period support",
    scope:manifest.domain_context,original_reference_binding:binding,entries,
    related_geometry_manifest:"nldi/model-sources.json",
    notes:["The unchanged original NLDI geometry manifest retains whole-catchment source support with simplified=false and splitCatchment=false.",
      "Import the original geometry manifest separately to retain its named gauge/basin sources. Existing reporting, upstream and utility selectors remain unchanged."]};
  await writeSame(output,"reference-support.sources.json",json(sources));
  return {schema:"upstate.discharge-reference-support-preparation/v1",output,
    source_manifest:resolve(output,"reference-support.sources.json"),geometry_manifest:resolve(output,"nldi/model-sources.json"),
    reference_binding_sha256:bindingsId,original_records:original.records.length,reference_records:result.record_count,
    status_counts:result.status_counts,source_files:actualFiles.size,
    source_ids:entries.map(x=>x.id)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const opts=options(process.argv.slice(2));if(opts)process.stdout.write(json(await rebuildReferenceSupport(opts)));}
  catch(error){process.stderr.write(error.message+"\n");process.exitCode=1;}
}
