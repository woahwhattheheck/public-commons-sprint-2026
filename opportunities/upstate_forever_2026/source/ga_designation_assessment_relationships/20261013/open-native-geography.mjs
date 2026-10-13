#!/usr/bin/env node
/** Bind the completed original GA geographic operation to retained legal source review. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
import {derive,renderBrief,csv} from "./build-relationships.mjs";
import {bindNativeGeography,nativeReviewRows,nativeReportSection} from "./bind-native-geography.mjs";
const here=fs.realpathSync(path.dirname(fileURLToPath(import.meta.url)));
const application=path.resolve(here,"../../..");
const sha=body=>crypto.createHash("sha256").update(body).digest("hex");
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const json=value=>JSON.stringify(value,null,2)+"\n";
const bytes=value=>Buffer.isBuffer(value)?value:Buffer.from(value,"utf8");
const descriptor=(name,body)=>({path:name,bytes:body.length,sha256:sha(body)});
const fail=message=>{throw Error(message)};
const opts={};
for(let i=2;i<process.argv.length;i++){
 const key=process.argv[i];
 if(!["--geography-sources","--output","--workspace","--python"].includes(key)||!process.argv[i+1]||process.argv[i+1].startsWith("--")||opts[key])
  fail("Usage: node open-native-geography.mjs --geography-sources /existing/geography-sources.json --output /new/retained-review [--workspace /existing/workspace --python /native/python]");
 opts[key]=process.argv[++i];
}
if(!opts["--geography-sources"]||!opts["--output"]||Boolean(opts["--workspace"])!==Boolean(opts["--python"]))
 fail("Provide native geography and output; Workspace import requires both --workspace and --python");
function confined(root,name){
 if(typeof name!=="string"||!name||name.includes("\\")||path.isAbsolute(name)||
    name.split("/").some(x=>!x||x==="."||x===".."))fail("Invalid retained relative path: "+name);
 const target=path.resolve(root,name);
 if(!target.startsWith(root+path.sep))fail("Retained member leaves source root");
 const actual=fs.realpathSync(target);
 if(!actual.startsWith(root+path.sep))fail("Retained member symlink leaves source root");
 if(!fs.statSync(actual).isFile())fail("Retained member is not a regular file: "+name);
 return actual;
}
function canonicalOutput(value){
 let current=path.resolve(value),tail=[];
 while(!fs.existsSync(current)){tail.unshift(path.basename(current));const parent=path.dirname(current);if(parent===current)fail("Cannot resolve output");current=parent;}
 return path.join(fs.realpathSync(current),...tail);
}
const inputPath=fs.realpathSync(path.resolve(opts["--geography-sources"]));
const geography=path.dirname(inputPath),output=canonicalOutput(opts["--output"]);
for(const root of [here,application,geography]){
 if(output===root||output.startsWith(root+path.sep)||root.startsWith(output+path.sep))
  fail("Use a separate output directory outside the original application and geography trees");
}
if(opts["--workspace"]){
 const root=fs.realpathSync(path.resolve(opts["--workspace"]));
 if(root===output||output.startsWith(root+path.sep)||root.startsWith(output+path.sep))
  fail("Keep this retained source output outside the existing Workspace");
}
function verified(root,item){
 if(!Number.isSafeInteger(item.bytes)||item.bytes<0||!/^[0-9a-f]{64}$/.test(item.sha256||""))
  fail("Original source descriptor must declare exact bytes and SHA256");
 const body=fs.readFileSync(confined(root,item.path));
 if(body.length!==item.bytes||sha(body)!==item.sha256)fail("Retained source changed: "+item.path);
 return body;
}
function put(name,value){
 const body=bytes(value),destination=path.join(output,name);
 if(path.isAbsolute(name)||name.split("/").some(x=>!x||x==="."||x==="..")||name.includes("\\"))
  fail("Invalid output member path");
 fs.mkdirSync(path.dirname(destination),{recursive:true});
 const parent=fs.realpathSync(path.dirname(destination));
 if(parent!==output&&!parent.startsWith(output+path.sep))fail("Output parent leaves retained edition");
 if(fs.existsSync(destination)){
  if(fs.lstatSync(destination).isSymbolicLink()||!fs.readFileSync(destination).equals(body))
   fail("Existing retained output differs: "+name);
  return descriptor(name,body);
 }
 const temporary=destination+".pending-"+process.pid+"-"+crypto.randomBytes(6).toString("hex");
 try{
  const fd=fs.openSync(temporary,"wx",0o600);
  try{fs.writeFileSync(fd,body);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  try{fs.linkSync(temporary,destination);}
  catch(error){if(error.code!=="EEXIST"||fs.lstatSync(destination).isSymbolicLink()||
    !fs.readFileSync(destination).equals(body))throw error;}
 }finally{fs.rmSync(temporary,{force:true});}
 return descriptor(name,body);
}
// Snapshot and verify the entire current relationship source family once.
const sourceManifestPath=path.join(application,"ga_designation_assessment_relationships.sources.json");
const sourceManifestBody=fs.readFileSync(sourceManifestPath);
const sourceManifest=JSON.parse(sourceManifestBody);
if((sourceManifest.schema||sourceManifest.source_schema)!=="upstate.sources/v1"||!sourceManifest.entries?.length)
 fail("Use the maintained relationship source manifest");
const sourceBodies=new Map();
for(const entry of sourceManifest.entries){
 for(const item of [entry,...(entry.companions||[])]){
  const body=verified(application,item),previous=sourceBodies.get(item.path);
  if(previous&&!previous.equals(body))fail("Conflicting retained source member");
  sourceBodies.set(item.path,body);
 }
}
const familyPrefix=path.relative(application,here).split(path.sep).join("/")+"/";
const familyBodies=new Map();
for(const [name,body] of sourceBodies){
 if(!name.startsWith(familyPrefix))fail("Relationship source manifest contains an unexpected family");
 familyBodies.set(name.slice(familyPrefix.length),body);
}
const inputManifestBody=familyBodies.get("input-manifest.json");
if(!inputManifestBody)fail("Missing original relationship input manifest");
const originalInputs=JSON.parse(inputManifestBody);
for(const item of originalInputs.files){
 const body=familyBodies.get(item.path);
 if(!body||body.length!==item.bytes||sha(body)!==item.sha256)fail("Original review input differs: "+item.path);
}
for(const name of ["build-relationships.mjs","bind-native-geography.mjs","open-native-geography.mjs"]){
 const selected=familyBodies.get(name);
 if(!selected||!fs.readFileSync(path.join(here,name)).equals(selected))fail("Executed implementation differs from source manifest: "+name);
}
const readOriginal=name=>JSON.parse(familyBodies.get(name).toString("utf8"));
const assessmentOriginal=name=>readOriginal("original-assessment/"+name);
const result=derive({
 registry:readOriginal("original-legal/ga.selected-reaches.json"),rules:readOriginal("review-definitions.json"),
 streamBodies:["001","002"].map(n=>({path:"georgia-2024-savannah-stream-attributes-"+n+"-original.json",
  value:assessmentOriginal("georgia-2024-savannah-stream-attributes-"+n+"-original.json")})),
 lakeBody:{path:"georgia-2024-savannah-lake-attributes-original.json",
  value:assessmentOriginal("georgia-2024-savannah-lake-attributes-original.json")},
 streamIDs:assessmentOriginal("georgia-2024-savannah-stream-ids-original.json"),
 lakeIDs:assessmentOriginal("georgia-2024-savannah-lake-ids-original.json"),
 attributeCapture:assessmentOriginal("acquisition.public.json"),
 geometryCapture:assessmentOriginal("geometry-source-index.json"),inputs:originalInputs.files
});
// Snapshot the maintained native geography, including every original/sidecar.
const nativeManifestBody=fs.readFileSync(inputPath),nativeManifest=JSON.parse(nativeManifestBody);
if((nativeManifest.schema||nativeManifest.source_schema)!=="upstate.sources/v1"||
   nativeManifest.entries?.length!==1)fail("Select the original geography-sources.json from the completed GA operation");
const nativeEntry=nativeManifest.entries[0];
if(nativeEntry.kind!=="vector"||nativeEntry.role!=="REGIONAL_ASSESSMENT_REACH_GEOGRAPHY"||
   nativeEntry.jurisdiction!=="GA"||nativeEntry.assessment_cycle!==2024||
   nativeEntry.publication_status!=="EPA-approved"||nativeEntry.path!=="assessed-reaches.geojson")
 fail("The selected native source is not the original approved Georgia assessment geography");
const nativeBodies=new Map();
for(const item of [nativeEntry,...(nativeEntry.companions||[])]){
 const body=verified(geography,item),previous=nativeBodies.get(item.path);
 if(previous&&!previous.equals(body))fail("Conflicting native source companion");
 nativeBodies.set(item.path,body);
}
const readNative=name=>{
 const body=nativeBodies.get(name);if(!body)fail("Missing native source member: "+name);
 return JSON.parse(body.toString("utf8"));
};
const context=readNative("geography-context.json");
const nativeAssessment=readNative("assessment-rows.json");
const expectedAttributes=new Map();
for(const [kind,parts] of [["stream",["001","002"]],["lake",[""]]]){
 const layer=result.selection.features.find(x=>x.kind===kind).service_url;
 for(const part of parts){
  const name=kind==="stream"?"georgia-2024-savannah-stream-attributes-"+part+"-original.json":
   "georgia-2024-savannah-lake-attributes-original.json";
  for(const feature of assessmentOriginal(name).features){
   const key=JSON.stringify([layer,feature.attributes.FID]);
   if(expectedAttributes.has(key))fail("Repeated original publisher feature");
   expectedAttributes.set(key,feature.attributes);
  }
 }
}
if(expectedAttributes.size!==295||nativeAssessment.records?.length!==295)
 fail("Keep the complete original 295-feature publisher cohort");
const matchedAttributes=new Set();
for(const row of nativeAssessment.records){
 const key=JSON.stringify([row.source_locator?.layer_uri,row.native_feature_id]);
 const original=expectedAttributes.get(key);
 if(!original||matchedAttributes.has(key)||JSON.stringify(canonical(original))!==JSON.stringify(canonical(row.raw)))
  fail("Native assessment differs from a complete original publisher row");
 matchedAttributes.add(key);
}
const originalNativeHashes=new Set([...nativeBodies.values()].map(sha));
for(const item of [context.domain_source,...(context.reach_sources||[])]){
 if(!originalNativeHashes.has(item?.sha256))fail("Original native source body is absent from retained companions");
}
const sourceDescriptor={
 relationship_manifest:descriptor("source-register/root.sources.json",sourceManifestBody),
 native_geography_manifest:descriptor("native-geography/geography-sources.json",nativeManifestBody),
 original_relationship_inputs:descriptor("source-register/input-manifest.json",inputManifestBody)
};
const bound=bindNativeGeography(result,{context,relations:readNative("geometry-relations.json"),
 featureCollection:readNative("assessed-reaches.geojson"),assessment:nativeAssessment,sourceDescriptor});
if(JSON.stringify(readNative("domain-hucs.json"))!==JSON.stringify(bound.domain_hucs))
 fail("Original HUC inventory differs from the completed geographic context");
const request={schema:"upstate.ga-relationship-native-request/v1",
 source:sourceDescriptor,domain_sha256:bound.domain_source.sha256,
 code:["build-relationships.mjs","bind-native-geography.mjs","open-native-geography.mjs"].map(name=>descriptor(name,familyBodies.get(name)))};
fs.mkdirSync(output,{recursive:true});
if(fs.realpathSync(output)!==output)fail("Output root changed while preparing retained edition");
const members=[put("request.json",json(request))];
for(const [name,body] of familyBodies)members.push(put("source-register/"+name,body));
members.push(put("source-register/root.sources.json",sourceManifestBody));
for(const [name,body] of nativeBodies)members.push(put("native-geography/"+name,body));
members.push(put("native-geography/geography-sources.json",nativeManifestBody));
const reviewRows=nativeReviewRows(bound);
members.push(put("native-context.json",json(bound)));
members.push(put("reviewed-assessment-geography.geojson",json(bound.map)));
members.push(put("geometry-relations-review.csv",csv(reviewRows,Object.keys(reviewRows[0]))));
const report={...result.report,
 title:"Georgia legal source relationships and original study-domain geography",
 edition:"ga-designation-assessment-native-"+sha(bytes(json(request))).slice(0,20),
 inputs:members.map(x=>({...x})),
 sections:[nativeReportSection(bound),...result.report.sections],
 figures:[],data_status:"Original completed assessment-feature/HUC intersections; legal source relationships retain reviewed qualifications"};
members.push(put("observed-report.json",json(report)));
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const safeJSON=value=>JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,c=>"\\u"+c.charCodeAt(0).toString(16).padStart(4,"0"));
const nativeSection='<section aria-labelledby="native-heading"><h2 id="native-heading">Original 217-catchment assessment geography</h2>'+
 '<p>'+bound.summary.positive_features+' reviewed assessment features intersect the domain in their original dimension; '+
 bound.summary.boundary_only_features+' touch boundaries only; '+bound.summary.outside_features+' fall outside it.</p>'+
 '<p>The table below retains all '+bound.summary.reviewed_features+' reviewed assessment features independently of the legal-record filters. Map downloads contain the complete original features that intersect or touch the domain. Legal reach boundaries retain their separate qualifications.</p>'+
 '<nav><button id="native-csv">Download all native feature/HUC rows CSV</button><button id="native-json">Download complete native context JSON</button>'+
 '<button id="native-geojson">Download original assessed-feature GeoJSON</button></nav>'+
 '<div style="overflow-x:auto"><table><thead><tr><th>Original assessed feature</th><th>Identity</th><th>Domain relationship</th><th>Positive HUC12s</th><th>Boundary HUC12s</th></tr></thead><tbody>'+
 bound.features.map(f=>'<tr><td>'+esc(f.source_name)+'</td><td>'+esc(f.source_key+' / '+f.reach_id)+'</td><td>'+esc(f.domain_membership)+'</td><td>'+esc(f.positive_huc12s.join(", "))+'</td><td>'+esc(f.boundary_touch_huc12s.join(", "))+'</td></tr>').join("")+
 '</tbody></table></div></section>';
const nativeScript='<script id="native-data" type="application/json">'+safeJSON({bound,rows:reviewRows})+'</script><script>'+
 '(()=>{const n=JSON.parse(document.getElementById("native-data").textContent);'+
 'document.getElementById("native-csv").onclick=()=>download("georgia-native-feature-huc-relationships.csv",csv(n.rows,Object.keys(n.rows[0])),"text/csv;charset=utf-8");'+
 'document.getElementById("native-json").onclick=()=>download("georgia-original-domain-review.json",JSON.stringify(n.bound,null,2)+"\\n","application/json");'+
 'document.getElementById("native-geojson").onclick=()=>download("georgia-original-assessed-features.geojson",JSON.stringify(n.bound.map,null,2)+"\\n","application/geo+json");})();</script>';
const html=renderBrief(result).replace("</header>",nativeSection+"</header>").replace("</html>",nativeScript+"</html>");
members.push(put("briefing.html",html));
const definitions=[
 ["ga-designation-assessment-native-context","Georgia reviewed sources with original catchment membership","document","ASSESSMENT_GEOGRAPHY_REVIEW","native-context.json",{source_schema:bound.schema}],
 ["ga-designation-assessment-native-map","Georgia original assessed features with reviewed legal references","vector","REGIONAL_ASSESSMENT_REACH_GEOGRAPHY","reviewed-assessment-geography.geojson",{crs:"EPSG:4326",reach_id_field:"assessment_unit_id"}],
 ["ga-designation-assessment-native-relations","Georgia native assessment-feature and catchment relationships","table","ASSESSMENT_GEOGRAPHY_RELATIONS","geometry-relations-review.csv",{}],
 ["ga-designation-assessment-native-report","Georgia reviewed designations and original catchment geography","document","OBSERVED_CONTEXT","observed-report.json",{source_schema:"upstate.observed-report/v1"}],
 ["ga-designation-assessment-native-briefing","Georgia complete source and geography briefing","document","SOURCE_REVIEW_BRIEFING","briefing.html",{}]
];
const sources={schema:"upstate.sources/v1",source_schema:"upstate.sources/v1",
 title:report.title,entries:definitions.map(([id,title,kind,role,name,extra])=>({
 id,title,kind,role,...members.find(m=>m.path===name),...extra,
 uri:"https://epd.georgia.gov/water-quality-georgia",vintage:result.report.vintage,
 jurisdiction:"GA",assessment_cycle:2024,publication_status:"EPA-approved",
 metadata:{legal_classification_system:"GA-391-3-6-.03",legal_geometry_assignment:false,
 domain_source_sha256:bound.domain_source.sha256,comparison_crs:bound.comparison_crs},
 companions:members.filter(m=>m.path!==name)
 }))};
const sourceIdentity=put("sources.json",json(sources));
let imported=null;
if(opts["--workspace"]){
 const workspace=fs.realpathSync(path.resolve(opts["--workspace"]));
 const completed=spawnSync(opts["--python"],["-m","model.cli","--workspace",workspace,"source-import",path.join(output,"sources.json")],
  {cwd:application,encoding:"utf8",maxBuffer:16*1024*1024,shell:false});
 if(completed.error||completed.status!==0)fail("Original Workspace source import failed: "+
   (completed.error?.message||completed.stderr||completed.stdout||"process exit "+completed.status));
 const collection=JSON.parse(completed.stdout);
 if(!collection.id||!Array.isArray(collection.entries))fail("Original Workspace returned no source collection");
 imported={workspace,source_collection_id:collection.id,source_ids:collection.entries.map(e=>e.id)};
 const expected=sources.entries.map(e=>e.id).sort();
 if(JSON.stringify([...imported.source_ids].sort())!==JSON.stringify(expected))fail("Imported collection source identities differ");
 // Keep independent receipts per actual Workspace; identical reruns reuse exact bytes.
 put("imports/"+sha(bytes(workspace)).slice(0,24)+".json",json({...imported,source_manifest:sourceIdentity}));
}
console.log(json({schema:"upstate.ga-relationship-native-receiving/v1",output,
 source_manifest:{...sourceIdentity,path:path.join(output,sourceIdentity.path)},summary:bound.summary,
 context_path:path.join(output,"native-context.json"),briefing_path:path.join(output,"briefing.html"),imported}));
