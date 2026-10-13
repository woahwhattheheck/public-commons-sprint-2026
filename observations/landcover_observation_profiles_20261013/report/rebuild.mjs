#!/usr/bin/env node
import {readFile,writeFile,mkdir,rename,realpath} from "node:fs/promises";
import {dirname,resolve,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {parseCsv} from "../profiles_core.mjs";
import {buildProfileReport,ROOT} from "./report_core.mjs";

let app=resolve(dirname(fileURLToPath(import.meta.url)),"../../.."),check=false;
for(let i=2;i<process.argv.length;i++){
 if(process.argv[i]==="--root"&&process.argv[i+1])app=resolve(process.argv[++i]);
 else if(process.argv[i]==="--verify-only")check=true;
 else throw Error("Usage: node rebuild.mjs [--root APPLICATION] [--verify-only]");
}
app=await realpath(app);
const hash=b=>createHash("sha256").update(b).digest("hex");
const within=p=>p.startsWith(app+sep);
async function inputPath(name){if(name.includes("\\")||name.split("/").some(x=>!x||x==="."||x===".."))throw Error("Noncanonical source path");const p=await realpath(resolve(app,name));if(!within(p))throw Error("Source escapes application");return p}
const index=JSON.parse(await readFile(await inputPath(ROOT+"source-index.json"),"utf8"));
const loaded=new Map();
for(const s of [...index.inputs,...index.vendor,...index.licenses]){
 const b=await readFile(await inputPath(s.path));
 if(b.length!==s.bytes||hash(b)!==s.sha256)throw Error("Retained source differs: "+s.path);
 loaded.set(s.path,b.toString("utf8"));
}
const vendors=new Map(index.vendor.map(s=>[s.module,loaded.get(s.path)])),modules=new Map();
function requireVendor(name){if(modules.has(name))return modules.get(name);if(!vendors.has(name))throw Error("Unretained dependency: "+name);const m={exports:{}};new Function("module","exports","require",vendors.get(name))(m,m.exports,requireVendor);modules.set(name,m.exports);return m.exports}
const parent="observations/landcover_observation_profiles_20261013/";
const data={profiles:parseCsv(loaded.get(parent+"watershed-profiles.csv")).rows,groups:parseCsv(loaded.get(parent+"landcover-groups.csv")).rows,locations:parseCsv(loaded.get(parent+"original-location-context.csv")).rows,summary:JSON.parse(loaded.get(parent+"summary.json")),inputs:index.inputs,utilityProfile:JSON.parse(loaded.get("source/receptor-topology/20261013/utility-focus-profile.json")),connectivity:parseCsv(loaded.get("outputs/watershed-connectivity-20261013/watershed-connectivity-217.csv")).rows,connectivitySummary:JSON.parse(loaded.get("outputs/watershed-connectivity-20261013/watershed-connectivity-summary.json"))};
const outputs=buildProfileReport(data,{...requireVendor("d3-array"),...requireVendor("d3-shape")});
if(Object.keys(outputs).length!==index.outputs.length)throw Error("Output catalogue differs");
for(const s of index.outputs){const b=Buffer.from(outputs[s.path]??"","utf8");if(b.length!==s.bytes||hash(b)!==s.sha256)throw Error("Rebuilt report differs: "+s.path)}
if(check){for(const s of index.outputs){const b=await readFile(await inputPath(s.path));if(b.length!==s.bytes||hash(b)!==s.sha256)throw Error("Saved output differs: "+s.path)}}
else{
 const writes=[];for(const [name,body]of Object.entries(outputs)){
  const p=resolve(app,name);if(!within(p)||!name.startsWith(ROOT))throw Error("Output escapes report component");
  await mkdir(dirname(p),{recursive:true});const dir=await realpath(dirname(p));if(!within(dir))throw Error("Output parent escapes application");
  const target=resolve(dir,name.split("/").at(-1));const stage=target+".rebuilding-"+process.pid;writes.push({target,stage,body});
 }
 for(const w of writes)await writeFile(w.stage,w.body,"utf8");
 for(const w of writes)await rename(w.stage,w.target);
}
console.log(JSON.stringify({schema:"upstate.profile-report-replay/v1",source_inputs:index.inputs.length,source_vendors:index.vendor.length,watersheds:data.profiles.length,group_balances:data.groups.length,original_locations:data.locations.length,rebuilt_outputs:index.outputs.length,verify_only:check},null,2));
