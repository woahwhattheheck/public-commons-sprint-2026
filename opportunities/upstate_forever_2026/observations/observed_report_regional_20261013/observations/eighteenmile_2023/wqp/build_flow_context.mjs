#!/usr/bin/env node
import {readFile,writeFile,mkdir,rename} from "node:fs/promises";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {parseCsv,buildStudyFlowContext} from "./flow_context.mjs";
const root=dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);
if(args.length!==4||args[0]!=="--flow-csv"||args[2]!=="--output-dir")throw Error("Usage: node build_flow_context.mjs --flow-csv DAILY_FLOW_CSV --output-dir OUTPUT_DIRECTORY");
const input=JSON.parse(await readFile(resolve(root,"flow_context_methods.json"),"utf8"));
const hash=data=>createHash("sha256").update(data).digest("hex");
const flow=await readFile(resolve(args[1]));
if(flow.length!==input.inputs.daily_flow.bytes||hash(flow)!==input.inputs.daily_flow.sha256)throw Error("Select the retained complete daily_flow.csv from the observed hydrology edition");
const lab=[];
for(const source of input.inputs.date_sources){
  const data=await readFile(resolve(root,source.path));
  if(data.length!==source.bytes||hash(data)!==source.sha256)throw Error("Original laboratory source differs: "+source.path);
  lab.push(...parseCsv(data.toString("utf8")).rows.map(row=>({...row,original_source_site:source.site})));
}
const dates=[...new Set(lab.map(row=>row.ActivityStartDate))].sort();
const result=buildStudyFlowContext(parseCsv(flow.toString("utf8")).rows,dates,input.gauge);
const rows=result.rows.map(row=>({...row,source_activity_count:lab.filter(x=>x.ActivityStartDate===row.sampling_date).length,chla_sites:lab.filter(x=>x.ActivityStartDate===row.sampling_date&&x.ProjectIdentifier==="CHLA").map(x=>x.original_source_site).sort().join(";"),micro_sites:lab.filter(x=>x.ActivityStartDate===row.sampling_date&&x.ProjectIdentifier==="SCDHEC-MICRO").map(x=>x.original_source_site).sort().join(";")}));
const cols=Object.keys(rows[0]);
const cell=value=>{const s=value===null||value===undefined?"":String(value);return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s};
const body=Buffer.from([cols.join(","),...rows.map(row=>cols.map(c=>cell(row[c])).join(","))].join("\n")+"\n","utf8");
const output=resolve(args[3]);await mkdir(output,{recursive:true});
const path=resolve(output,"study_flow_dates.csv"),temp=path+".partial-"+process.pid;
await writeFile(temp,body);await rename(temp,path);
console.log(JSON.stringify({output:path,dates:rows.length,original_lab_rows:lab.length,bytes:body.length,sha256:hash(body)},null,2));
