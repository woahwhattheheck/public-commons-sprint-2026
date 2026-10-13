#!/usr/bin/env node
/** Rebuild the class-pathway companion from the complete retained originals. */
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {buildProfiles,parseCsv} from "../../observations/landcover_observation_profiles_20261013/profiles_core.mjs";
import {buildAttribution,attributionTables,renderAttributionSection} from "./attribution.mjs";
const [sourceRoot,questionRoot,output]=process.argv.slice(2);
if(!sourceRoot||!questionRoot||!output||process.argv.length!==5)
  throw Error("Usage: node build_attribution.mjs ORIGINAL_APPLICATION_ROOT ORIGINAL_4171_QUESTION_DIRECTORY NEW_OUTPUT_DIRECTORY");
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const originals={};
const sources=[];
async function original(base,relative,kind="original") {
  const bytes=await fs.readFile(path.join(base,relative));
  sources.push({kind,path:relative,bytes:bytes.length,sha256:sha(bytes)});
  const text=bytes.toString("utf8");originals[relative]=text;return text;
}
const paths={
  before:"observations/landcover_2023_2025/annual-2023.json",
  after:"observations/landcover_2023_2025/annual-2025.json",
  change:"observations/landcover_2023_2025/huc12-change-summary.csv",
  matrix:"observations/landcover_2023_2025/huc12-transitions.csv",
  points:"observations/wbd_station_join_20261013/derived/point_watersheds.csv",
  plan:"observations/wbd_station_join_20261013/query-plan.json"
};
for(const relative of Object.values(paths))await original(sourceRoot,relative);
await original(sourceRoot,"CURRENT_OWNER_DIRECTION.md","owner direction");
const annual2023=JSON.parse(originals[paths.before]),annual2025=JSON.parse(originals[paths.after]);
const transitionRows=parseCsv(originals[paths.matrix]).rows;
const validatedProfiles=buildProfiles({annual2023,annual2025,transitionRows,
  changeRows:parseCsv(originals[paths.change]).rows,pointRows:parseCsv(originals[paths.points]).rows,plan:JSON.parse(originals[paths.plan])});
const reviewProject=JSON.parse(await original(questionRoot,"Upper_Savannah_Review_Project.json","saved review"));
const scopes=JSON.parse(await original(questionRoot,"sources/scopes.json","original scope"));
const result=buildAttribution({validatedProfiles,transitionRows,cellAreaHa:annual2023.method.cell_area_m2/10000,scopes,reviewProject});
for(const [url,relative] of [[import.meta.url,"source_tools/watershed_review/build_attribution.mjs"],[new URL("./attribution.mjs",import.meta.url),"source_tools/watershed_review/attribution.mjs"],[new URL("../../observations/landcover_observation_profiles_20261013/profiles_core.mjs",import.meta.url),"observations/landcover_observation_profiles_20261013/profiles_core.mjs"]]) {
  const bytes=await fs.readFile(fileURLToPath(url));sources.push({kind:"computation",path:relative,bytes:bytes.length,sha256:sha(bytes)});originals[relative]=bytes.toString("utf8");
}
result.source_documents=sources;
const escape=v=>String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const sections=result.subjects.map(s=>'<div id="subject-'+escape(s.id)+'" class="subject"'+(s.id==="utility-union"?"":" hidden")+">"+renderAttributionSection(result,s.id)+"</div>").join("\n");
const style=":root{font:16px/1.5 system-ui,sans-serif;color:#202124;background:#f4f4f3}*{box-sizing:border-box}body{margin:0}main{max-width:1060px;margin:0 auto;padding:28px}header{border-bottom:2px solid #353535;margin-bottom:24px}h1{font-size:1.8rem;line-height:1.2}h2{font-size:1.2rem}h3{font-size:1.13rem}p{max-width:90ch}select{font:inherit;max-width:100%;padding:9px;border:1px solid #717171;background:white;color:#202124}label{display:block;font-weight:650;margin-bottom:6px}section,.downloads{background:#fff;border:1px solid #ccc;border-radius:3px;padding:20px;margin:22px 0}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #d1d1d1;overflow-wrap:anywhere}thead{background:#eee}th:nth-child(1){width:23%}th:nth-child(2){width:16%}tbody th{font-weight:600}a{color:#263d50;text-underline-offset:3px}li{margin:8px 0}.metadata{font-size:.85rem;overflow-wrap:anywhere}footer{border-top:1px solid #999;margin-top:28px;padding-top:18px} [hidden]{display:none!important}@media(max-width:600px){main{padding:14px}section,.downloads{padding:14px}h1{font-size:1.5rem}thead{display:none}tbody tr{display:block;border-bottom:1px solid #bbb;padding:10px 0}tbody th,tbody td{display:block;width:100%;padding:4px 0;border:0}tbody td:nth-child(2){font-weight:650}tbody th:nth-child(1){width:100%}}@media print{body{background:white}main{padding:0}select,label,.downloads{display:none}section{border:0;padding:0}tr{break-inside:avoid}a{color:inherit}}";
const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Upper Savannah — original class pathways</title><style>'+style+'</style></head><body><main><header><p>UPPER SAVANNAH · UTILITY REVIEW</p><h1>What changed behind the review scores?</h1><p>Inspect the original before-and-after land-cover classifications for the six queued watersheds and the utility focus and upstream groups.</p></header><label for="subject">Watershed or utility group</label><select id="subject">'+result.subjects.map(s=>'<option value="'+escape(s.id)+'"'+(s.id==="utility-union"?" selected":"")+'>'+escape(s.name)+'</option>').join("")+'</select>'+sections+'<section><h2>Read the original quantities</h2>'+result.interpretation.map(p=>"<p>"+escape(p)+"</p>").join("")+'</section><div class="downloads"><h2>Complete original-derived tables</h2><ul>'+["subject-summary.csv","group-quantities.csv","criterion-pathways.csv","class-pathways.csv","analysis.json"].map(f=>'<li><a href="'+f+'" download>'+f+'</a></li>').join("")+'</ul><p>The groups overlap by design. Use Combined utility upstream union for an unduplicated total. CSVs retain full numerical precision and original HUC identifiers.</p></div><footer><h2>Retained source edition</h2><p class="metadata">'+escape(result.source_edition)+'</p><p>Source years 2023 and 2025 · original 217-HUC domain · paired native cell area '+result.cell_area_ha+' ha. The complete source manifest is retained in analysis.json.</p></footer></main><script>const select=document.getElementById("subject");select.addEventListener("change",()=>{for(const node of document.querySelectorAll(".subject"))node.hidden=node.id!=="subject-"+select.value;});</script></body></html>\n';
const files={...attributionTables(result),"analysis.json":JSON.stringify(result,null,2)+"\n","OPEN_FIRST.html":html};
for(const [name,text] of Object.entries(originals))files["originals/"+name]=text;
await fs.mkdir(path.resolve(output),{recursive:false});
for(const [name,text] of Object.entries(files)) {
  await fs.mkdir(path.dirname(path.join(output,name)),{recursive:true});
  await fs.writeFile(path.join(output,name),text,{flag:"wx"});
}
const manifest={schema:"upstate.utility-class-attribution-files/v1",source_edition:result.source_edition,source_documents:sources,files:Object.entries(files).map(([name,text])=>({path:name,bytes:Buffer.byteLength(text),sha256:sha(text)}))};
await fs.writeFile(path.join(output,"MANIFEST.json"),JSON.stringify(manifest,null,2)+"\n",{flag:"wx"});
const nativeSources={schema:"upstate.sources/v1",title:"Upper Savannah original class pathways behind utility review",captured_at:"2026-10-13",scope:{source_edition:result.source_edition,classification_years:result.years,subject_count:result.subjects.length,original_huc_count:validatedProfiles.profiles.length},entries:[{id:"upper-savannah-utility-class-attribution-"+sha(files["analysis.json"]).slice(0,16),kind:"document",title:"Upper Savannah original class pathways",uri:"urn:sha256:"+sha(html),vintage:"2023 and2025 AnnualNLCD;2026-10-13 utility review",path:"OPEN_FIRST.html",sha256:sha(html),purpose:"Review source pathways behind retained forest, developed and wetland quantities",companions:[...manifest.files.filter(f=>f.path!=="OPEN_FIRST.html").map(f=>({path:f.path,sha256:f.sha256})),{path:"MANIFEST.json",sha256:sha(JSON.stringify(manifest,null,2)+"\n")}]}]};
await fs.writeFile(path.join(output,"native-sources.json"),JSON.stringify(nativeSources,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({output:path.resolve(output),subjects:result.subjects.length,original_watersheds:validatedProfiles.profiles.length,original_matrix_rows:transitionRows.length,files:Object.keys(files).length+2,source_id:nativeSources.entries[0].id}));
