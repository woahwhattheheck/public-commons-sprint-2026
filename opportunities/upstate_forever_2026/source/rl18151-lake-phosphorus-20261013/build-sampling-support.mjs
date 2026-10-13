#!/usr/bin/env node
/** Append sampling analysis to the existing source bank, preserving its five source identities. */
import {readFileSync,writeFileSync,mkdirSync,renameSync,existsSync} from "node:fs";
import {resolve,join,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {deriveStudy} from "./analysis.mjs";
import {buildSamplingReview} from "./sampling-support.mjs";
import {renderSamplingReview} from "./sampling-support-view.mjs";

export const extendSamplingFiles = function extendSamplingFiles(input, digest){
 const files={...input},parse=p=>{if(typeof files[p]!=="string")throw Error("Missing complete source member: "+p);return JSON.parse(files[p]);},descriptor=p=>{if(typeof files[p]!=="string")throw Error("Missing complete member: "+p);return {path:p,...digest(files[p])};},json=x=>JSON.stringify(x,null,2)+"\n";
 const canonical=p=>{if(typeof p!=="string"||!p||p.includes("\\")||p.startsWith("/")||p.split("/").some(x=>!x||x==="."||x===".."))throw Error("Invalid relative source member");return p;};
 const verify=x=>{canonical(x.path);const a=descriptor(x.path);if(a.bytes!==x.bytes||a.sha256!==x.sha256)throw Error("Source member changed: "+x.path);};
 const ledger=parse("study-files.json"),manifest=parse("capture-manifest.json"),sources=parse("sources.json"),recipe=parse("observed-report.json");
 if(sources.schema!=="upstate.sources/v1"||recipe.schema!=="upstate.observed-report/v1")throw Error("Use existing original study manifests");
 for(const d of ledger.members)verify(d);
 for(const d of manifest.originals)verify(d);
 for(const e of sources.entries){verify(e);for(const d of e.companions||[])verify(d);}
 for(const d of recipe.inputs||[])verify(d);
 if(digest(files["acquisition-plan.json"]).sha256!==manifest.plan_sha256)throw Error("Original acquisition plan differs");
 const study=deriveStudy(files,manifest);
 const originalIdentity=study.records.map(r=>[r.record_id,r.result_id,r.activity_id,JSON.stringify(r.interval)]);
 const review=buildSamplingReview(study);
 const reviewIDs=review.compatible_measurement_cohorts.cohorts.flatMap(c=>c.activity_rows.flatMap(a=>a.member_ids.map(m=>m.record_id)));
 if(reviewIDs.length!==study.records.length||new Set(reviewIDs).size!==study.records.length)throw Error("Review changed original result membership");
 if(JSON.stringify(originalIdentity)!==JSON.stringify(study.records.map(r=>[r.record_id,r.result_id,r.activity_id,JSON.stringify(r.interval)])))throw Error("Original result mutated");
 const generated=["sampling-review.json","sampling-review.html","derived/sampling-cohorts.csv","derived/sampling-activity-sensitivity.csv","derived/sampling-calendar.csv"];
 files["sampling-review.json"]=JSON.stringify(review)+"\n";
 files["sampling-review.html"]=renderSamplingReview(review);
 const csv=rows=>rows.map(r=>r.map(v=>'"'+String(v??"").replaceAll('"','""')+'"').join(",")).join("\r\n")+"\r\n";
 const intervalCols=x=>[x?.lower??"",x?.upper??"",x?.lower_inclusive??"",x?.upper_inclusive??""];
 const suffix=["lower","upper","lower_inclusive","upper_inclusive"];
 const baseCols=["cohort_id","year","group","characteristic","fraction","unit","interval_unit","quantitative_unit","depth_value","depth_unit","result_depth_value","result_depth_unit","method_context","method_id","method_name","method_specification","records","activities","censored_records","unresolved_records"];
 files[generated[2]]=csv([["scope",...baseCols,...["equal_activity","result_weighted","difference"].flatMap(p=>suffix.map(s=>p+"_"+s))],...["source_cohorts","compatible_measurement_cohorts"].flatMap(scope=>review[scope].cohorts.map(c=>[scope,...baseCols.map(k=>c[k]??""),...intervalCols(c.equal_activity_mean),...intervalCols(c.result_weighted_mean),...intervalCols(c.weighting_difference)]))]);
 files[generated[3]]=csv([["scope","cohort_id","removed_activity_id","removed_date","removed_result_ids","retained_records","retained_activities",...["full_equal_activity","retained_equal_activity","retained_result_weighted"].flatMap(p=>suffix.map(s=>p+"_"+s))],...["source_cohorts","compatible_measurement_cohorts"].flatMap(scope=>review[scope].leave_one_activity_out.map(r=>[scope,r.cohort_id,r.removed_activity_id,r.removed_date,JSON.stringify(r.removed_result_ids),r.retained_records,r.retained_activities,...intervalCols(r.full_equal_activity_mean),...intervalCols(r.retained_equal_activity_mean),...intervalCols(r.retained_result_weighted_mean)]))]);
 const calCols=["month","group","window_start","window_end","partial_query_month","records","activities","state","sampling_dates","activity_ids","result_ids"];
 files[generated[4]]=csv([calCols,...review.source_cohorts.calendar.map(r=>calCols.map(k=>Array.isArray(r[k])?JSON.stringify(r[k]):r[k]))]);
 const code=["sampling-support.mjs","sampling-support-view.mjs","build-sampling-support.mjs","SAMPLING_SUPPORT.md"];
 for(const p of code)descriptor(p);
 const numeric=x=>Number(x).toPrecision(6).replace(/(\.\d*?)0+(?=e|$)/,"$1").replace(/\.(?=e|$)/,"");
 const interval=x=>!x?"unresolved":x.lower===x.upper?numeric(x.lower):(x.lower_inclusive?"[":"(")+numeric(x.lower)+", "+numeric(x.upper)+(x.upper_inclusive?"]":")");
 const phosphorus=review.compatible_measurement_cohorts.cohorts.filter(c=>c.characteristic==="Phosphorus");
 const repeated=review.compatible_measurement_cohorts.cohorts.flatMap(c=>c.activity_rows).filter(a=>a.records>1);
 const heading="RL-18151 sampling support and activity sensitivity";
 const sections=[heading,[
  review.records+" original results remain attached to "+review.activities+" original activities. The "+review.source_cohorts.cohorts.length+" exact source cohorts remain available beside "+review.compatible_measurement_cohorts.cohorts.length+" explicitly compatible measurement cohorts.",
  review.compatibility_rule,
  "Equal-activity means average each activity's original result intervals, then weight activities equally. Result-weighted means weight every original assay equally. Difference bounds retain each unknown censored value in both estimands. These are descriptive interval bounds, not sampling confidence intervals.",
  "The compatible review retains "+repeated.length+" repeated activity/cohort groups; "+repeated.filter(a=>a.repeat_status==="agreeing_repeated_results").length+" have agreeing quantitative values. Metadata agreement is shown separately. No original identifier is collapsed.",
  {kind:"table",columns:["Year","Depth","Results","Activities","Equal-activity phosphorus bounds","Unit / chemical basis"],rows:phosphorus.map(c=>[c.year,c.depth_value?c.depth_value+" "+c.depth_unit:"not supplied",String(c.records),String(c.activities),interval(c.equal_activity_mean),[c.quantitative_unit,c.method_specification].filter(Boolean).join(" ")])},
  "The retained calendar explicitly covers every programme/month through 13 October 2026. It has no returned measurements in 2019–2023. Leave-one-activity-out values describe the sensitivity of the observed campaign; no continuous trend, treatment effect, annual mass load or missing-day value is inferred. Zero lower censor bounds are mathematical bounds, not measured zeros.",
  {kind:"links",items:[{title:"Interactive sampling calendar, mean comparison and full sensitivity explorer",path:generated[1]},{title:"Complete review with original ResultIdentifiers and response row bindings",path:generated[0]},{title:"Both cohort modes with exact interval endpoints",path:generated[2]},{title:"Every leave-one-activity-out selection",path:generated[3]},{title:"Complete monitoring calendar",path:generated[4]},{title:"Sampling calculation and receiving guide",path:"SAMPLING_SUPPORT.md"}]}
 ]];
 recipe.sections=(recipe.sections||[]).filter(s=>s[0]!==heading);recipe.sections.push(sections);
 const paths=[...new Set([...ledger.members.map(x=>x.path),...sources.entries.flatMap(e=>[e.path,...(e.companions||[]).map(x=>x.path)]),...(recipe.inputs||[]).map(x=>x.path),...generated,...code,...(files["RL_NATIVE_RECEIVING.md"]?["RL_NATIVE_RECEIVING.md"]:[])])].filter(p=>!["sources.json","study-files.json","observed-report.json"].includes(p)).sort();
 recipe.inputs=paths.map(descriptor);
 recipe.source_links=[...new Set([...(recipe.source_links||[]),...generated,"SAMPLING_SUPPORT.md",...(files["RL_NATIVE_RECEIVING.md"]?["RL_NATIVE_RECEIVING.md"]:[])])];
 files["observed-report.json"]=json(recipe);
 const closure=[...paths,"observed-report.json"].sort().map(descriptor);
 sources.entries=sources.entries.map(e=>({...e,...descriptor(e.path),companions:closure.filter(d=>d.path!==e.path)}));
 files["sources.json"]=json(sources);
 files["study-files.json"]=json({...ledger,members:[...closure,descriptor("sources.json")].sort((a,b)=>a.path.localeCompare(b.path))});
 for(const e of sources.entries){verify(e);for(const d of e.companions)verify(d);}
 for(const d of JSON.parse(files["observed-report.json"]).inputs)verify(d);
 for(const d of JSON.parse(files["study-files.json"]).members)verify(d);
 if(recipe.inputs.some(x=>["observed-report.json","sources.json","study-files.json"].includes(x.path)))throw Error("Self-referential source closure");
 return {files,review,changed:[...generated,"observed-report.json","sources.json","study-files.json"],summary:{records:review.records,activities:review.activities,source_cohorts:review.source_cohorts.cohorts.length,compatible_cohorts:review.compatible_measurement_cohorts.cohorts.length,source_entries:sources.entries.map(e=>e.id),members:closure.length}};
};

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=resolve(process.argv[2]||"."),files={};
 const read=p=>{if(p.startsWith("/")||p.includes("\\\\")||p.split("/").some(x=>!x||x==="."||x===".."))throw Error("Invalid source member");const raw=readFileSync(join(root,p));return new TextDecoder("utf-8",{fatal:true}).decode(raw);};
 for(const p of ["study-files.json","sources.json","observed-report.json"])files[p]=read(p);
 const ledger=JSON.parse(files["study-files.json"]);
 for(const d of ledger.members)files[d.path]=read(d.path);
 for(const p of ["sampling-support.mjs","sampling-support-view.mjs","build-sampling-support.mjs","SAMPLING_SUPPORT.md"])files[p]=read(p);
 if(existsSync(join(root,"RL_NATIVE_RECEIVING.md")))files["RL_NATIVE_RECEIVING.md"]=read("RL_NATIVE_RECEIVING.md");
 const digest=text=>({bytes:Buffer.byteLength(text,"utf8"),sha256:createHash("sha256").update(text,"utf8").digest("hex")});
 const result=extendSamplingFiles(files,digest);
 for(const p of result.changed){const target=join(root,p),temp=target+".sampling-"+process.pid+".tmp";mkdirSync(dirname(target),{recursive:true});writeFileSync(temp,result.files[p],"utf8");renameSync(temp,target);}
 process.stdout.write(JSON.stringify({...result.summary,output:root,report:"sampling-review.html",source_manifest:"sources.json"},null,2)+"\n");
}
