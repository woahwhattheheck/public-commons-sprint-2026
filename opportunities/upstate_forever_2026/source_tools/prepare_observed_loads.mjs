#!/usr/bin/env node
/** Existing workbench source preparation; writes an independent reusable product. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
const require=createRequire(import.meta.url);
const loads=require("./observed_loads.cjs");
function args(argv){
 const a={};for(let i=0;i<argv.length;i+=2){if(!argv[i]?.startsWith("--")||!argv[i+1])throw Error("Use --contract FILE --samples CSV_OR_JSON --flows CSV_OR_JSON --output NEW_DIRECTORY [--joins JSON]");const k=argv[i].slice(2);if(a[k])throw Error("Duplicate option "+k);a[k]=argv[i+1];}
 for(const k of ["contract","samples","flows","output"])if(!a[k])throw Error("Missing --"+k);
 if(Object.keys(a).some(k=>!["contract","samples","flows","output","joins"].includes(k)))throw Error("Unknown option");return a;
}
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
function exact(file,bytes){
 fs.mkdirSync(path.dirname(file),{recursive:true});
 if(fs.existsSync(file)){if(!fs.readFileSync(file).equals(bytes))throw Error("Different retained output: "+file);return;}
 const temp=file+".partial-"+process.pid+"-"+crypto.randomUUID();let failure;
 try{const fd=fs.openSync(temp,"wx");let writeFailure;try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}catch(e){writeFailure=e;throw e;}finally{try{fs.closeSync(fd);}catch(e){if(writeFailure)writeFailure.close_error=e.message;else throw e;}}try{fs.linkSync(temp,file);}catch(e){if(e.code!=="EEXIST"||!fs.readFileSync(file).equals(bytes))throw e;}}
 catch(e){failure=e;throw e;}finally{try{fs.unlinkSync(temp);}catch(e){if(e.code!=="ENOENT"){if(failure)failure.cleanup_error=e.message;else throw e;}}}
}
function parsed(bytes,file){
 const s=bytes.toString("utf8");if(file.toLowerCase().endsWith(".csv"))return loads.csvParse(s);
 const value=JSON.parse(s);if(Array.isArray(value))return value;if(Array.isArray(value.rows))return value.rows;throw Error("Expected complete row array or {rows}");
}
export function prepare(argv){
 const a=args(argv),out=path.resolve(a.output);
 const entries=Object.fromEntries(["contract","samples","flows",...(a.joins?["joins"]:[])].map(k=>[k,{path:path.resolve(a[k]),bytes:fs.readFileSync(a[k])}]));
 for(const v of Object.values(entries))if(v.path===out||v.path.startsWith(out+path.sep))throw Error("Keep source inputs outside output directory");
 const contract=JSON.parse(entries.contract.bytes.toString("utf8"));
 const input={contract,samples:parsed(entries.samples.bytes,a.samples),flows:parsed(entries.flows.bytes,a.flows)};
 const result=loads.integrate(input);
 if(entries.joins)result.source_join_rows=loads.retainJoinedRows(input,JSON.parse(entries.joins.bytes.toString("utf8")));
 const exports=loads.observationExports(result),daily=[],periods=[];
 for(const series of result.series){
   for(const row of series.daily)daily.push({...row,characteristic:series.characteristic,sample_fraction:series.sample_fraction,method_id:series.method_id});
   for(const row of [...series.periods,...series.annual])periods.push({...row,series_key:series.series_key,station_id:series.station_id,characteristic:series.characteristic,sample_fraction:series.sample_fraction,method_id:series.method_id,gauge_id:series.support.gauge_id,catchment_id:series.support.catchment_id});
 }
 const json=v=>JSON.stringify(v,null,2)+"\n",files={
 "observed-loads.json":json(result),"index.html":loads.renderHtml(result),
 "daily-loads.csv":loads.csvString(daily,["series_key","station_id","characteristic","sample_fraction","method_id","gauge_id","date","concentration_basis","concentration_mg_l","concentration_lower_mg_l","concentration_upper_mg_l","discharge_m3_s","load_kg","load_lower_kg","load_upper_kg","censored","sample_ids","flow_ids","issues"]),
 "period-loads.csv":loads.csvString(periods,["series_key","station_id","characteristic","sample_fraction","method_id","gauge_id","catchment_id","label","period_start","period_end","period_end_exclusive","whole_calendar_year","expected_days","quantified_days","coverage_complete","load_kg","load_lower_kg","load_upper_kg","censored_days","sampled_days","interpolated_days","quantity_basis","uncertainty","missing_reasons"]),
 "concentration-context.csv":exports.context_csv,"concentration-context.metadata.json":json(exports.context_metadata),
 "annual-loads.csv":exports.annual_csv,"annual-loads.metadata.json":json(exports.annual_metadata)
 };
 const manifest={schema:"upstate.observed-load-product/v1",method:loads.VERSION,source_files:[],artifacts:[],counts:result.counts,annual_comparison_rows:exports.annual_count};
 for(const [k,v]of Object.entries(entries)){const dest="original/"+k+path.extname(a[k]).toLowerCase();manifest.source_files.push({role:k,path:dest,bytes:v.bytes.length,sha256:sha(v.bytes)});exact(path.join(out,dest),v.bytes);}
 for(const [name,s]of Object.entries(files)){const bytes=Buffer.from(s,"utf8");manifest.artifacts.push({path:name,bytes:bytes.length,sha256:sha(bytes)});exact(path.join(out,name),bytes);}
 exact(path.join(out,"manifest.json"),Buffer.from(json(manifest),"utf8"));
 return {output:out,manifest:path.join(out,"manifest.json"),...manifest.counts,annual_comparison_rows:exports.annual_count};
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))){
 try{console.log(JSON.stringify(prepare(process.argv.slice(2))));}catch(error){console.error(error.stack||String(error));process.exitCode=1;}
}
