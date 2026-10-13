/** Extend the existing source-bound headwaters chapter with original native results. */
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve,dirname,sep} from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";

export const VERSION="headwaters-native-interpretation/v1";
const BASE="source/headwaters_input_interpretation_20261013";
const NATIVE=BASE+"/native-results";
const PROJECT="1b6a344c-df5a-4986-a5e4-47a2d158324b";
const ENSEMBLE="8cb02b0fe3b6a96782525e8aa5607621dd0a456719c6651ce07a675d9cae1ff4";
const ID=/^[0-9a-f]{64}$/;
const BASELINE_SCENARIO="63f5d52029585807ff8f4d5e8d5fff0972adf7c01811d97cab3edbee3d9658d7";
const RIPARIAN_SCENARIO="8d419f1c618cc7a5025c01eb40f173afbbe6919e4ba96580f6e7e1e36943d65d";
const CONTROL_SCENARIO="28044212ab992451e31b5e9e6dc831a9221a5ef53ac136ea56b2af063f70f223";
const BIOPHYSICAL_SHA="bd5d7a436a302df751e57f63c188216402f13acdfff26c847b9b83733651fd94";
const POLLUTANTS={nitrogen_export:"Nitrogen",phosphorus_export:"Phosphorus",sediment_export:"Sediment"};
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const equal=(a,b)=>stable(a)===stable(b);
const clone=value=>JSON.parse(JSON.stringify(value));
const json=value=>JSON.stringify(value,null,2)+"\n";
const hash=body=>createHash("sha256").update(body).digest("hex");
const number=value=>value===null||value===undefined?"Not available":Number(value).toLocaleString("en-US",{maximumFractionDigits:6});
const table=(columns,rows)=>({kind:"table",columns,rows});
function need(value,message){if(!value)throw Error(message);}
function safeName(value){
 need(typeof value==="string"&&value.length>0&&!value.includes("\\")&&!value.startsWith("/")&&!value.split("/").some(p=>!p||p==="."||p===".."),"Use a relative original source member");
 return value;
}
function csvCell(value){
 let text=value==null?"":String(value);
 if(typeof value==="string"&&/^[=+\-@\t\r]/.test(text))text="'"+text;
 return /[",\r\n]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;
}
function csv(columns,rows){return [columns,...rows].map(r=>r.map(csvCell).join(",")).join("\r\n")+"\r\n";}
function near(a,b){return Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(a),Math.abs(b));}
function leafRows(value,path="",result=[]){
 if(value&&typeof value==="object"){
  for(const key of Object.keys(value).sort())leafRows(value[key],path?path+"."+key:key,result);
 }else result.push([path,value]);
 return result;
}

export function analyzeNativePacket(packet,{sha256=hash,byteLength=value=>Buffer.byteLength(value,"utf8")}={}){
 const source=packet.source||packet;
 need(source&&Array.isArray(source.files),"Choose the complete original numerical source packet");
 need(source.project_id===PROJECT&&source.ensemble_id===ENSEMBLE,"This chapter requires the original simulated-square project and ensemble");
 const members=new Map(),records=new Map();
 for(const item of source.files){
  safeName(item.path);
  need(!members.has(item.path)&&typeof item.content==="string","Original source members must be complete and unique");
  need(Number.isSafeInteger(item.bytes)&&byteLength(item.content)===item.bytes&&sha256(item.content)===item.sha256,"Original source identity differs: "+item.path);
  members.set(item.path,item);records.set(item.path,JSON.parse(item.content));
 }
 const get=path=>{need(records.has(path),"Missing original source: "+path);return records.get(path);};
 const report=get("numeric/report.json"),release=get("numeric/release.json"),plan=get("original/ensemble.json"),grid=get("original/grid.json");
 const rawRuns=get("original/native-runs.json");
 const runs=Array.isArray(rawRuns)?Object.fromEntries(rawRuns.map(run=>[run.id,run])):rawRuns;
 need(plan.id===ENSEMBLE&&report.ensemble_id===ENSEMBLE&&release.ensemble_id===ENSEMBLE&&release.id===source.report_id,"The original report and ensemble identities differ");
 const descriptor=release.files?.["report.json"],member=members.get("numeric/report.json");
 need(descriptor&&descriptor.bytes===member.bytes&&descriptor.sha256===member.sha256,"The original numerical report differs from its release descriptor");
 need(grid.id===plan.grid_id&&plan.baseline_scenario_id===BASELINE_SCENARIO,"The native report selects another original grid or baseline scenario");
 need(grid.grid?.width===120&&grid.grid.height===120&&grid.grid.resolution_m===30&&grid.grid.pixel_area_ha===0.09&&
  grid.grid.crs_name==="EPSG:26917"&&equal(grid.grid.transform,[30,0,330000,0,-30,3861000]),"The original simulated 30 m square grid changed");
 const runtimeBindings=[];
 const profiles={},scenarios={},cohort=[],ids=new Set(),byMember=new Map();
 for(const m of plan.members||[]){
  need(ID.test(m.id)&&ID.test(m.profile_id)&&!byMember.has(m.id),"The ensemble has malformed or repeated original members");
  const profile=get("original/profiles/"+m.profile_id+".json");
  need(profile.id===m.profile_id,"A retained original profile changed identity");profiles[m.profile_id]=profile;
  need(profile.table_summary?.sha256===BIOPHYSICAL_SHA&&m.parameters?.table_sha256===BIOPHYSICAL_SHA,"The original coefficient table no longer matches the measured-runoff input chapter");
  byMember.set(m.id,m);
  for(const binding of m.runs||[]){
   const runId=binding.run_id||binding.id,run=runs[runId];
   need(run&&run.id===runId&&run.state==="complete"&&!ids.has(runId),"Choose every distinct completed original native run");
   need(run.selection?.grid_id===plan.grid_id&&run.selection.profile_id===m.profile_id&&run.selection.scenario_id===binding.scenario_id,"A captured run changed its original scientific selection");
   for(const model of ["ndr","sdr"]){
    const captured=run.stages?.[model]?.input_signature?.selection;
    need(captured?.invest_version==="3.20.0"&&captured.model===model&&
     captured.inputs?.biophysical_table_path?.sha256===BIOPHYSICAL_SHA&&captured.inputs.biophysical_table_path.bytes===397,
     "A native stage differs from the original version or retained coefficient table");
    for(const [name,value] of Object.entries(profile[model]||{}))need(equal(captured.arguments?.[name],value),"A native stage argument differs from its selected original profile: "+model+"."+name);
    runtimeBindings.push({run_id:runId,model,invest_version:captured.invest_version,input_signature_id:run.stages[model].input_signature.id,
     arguments:clone(captured.arguments),biophysical_table:clone(captured.inputs.biophysical_table_path),native_modules:clone(captured.modules)});
   }
   const scenario=get("original/scenarios/"+binding.scenario_id+".json");
   need(scenario.id===binding.scenario_id,"A retained original scenario changed identity");scenarios[scenario.id]=scenario;
   ids.add(runId);cohort.push({member_id:m.id,member_label:m.label||m.id,profile_id:m.profile_id,scenario_id:scenario.id,scenario_label:binding.label||scenario.title||scenario.id,run_id:runId});
  }
 }
 need(ids.size===12&&Object.keys(profiles).length===4&&Object.keys(scenarios).length===3,"This original completed chapter requires its twelve runs, four profiles and three scenarios");
 const byRun=new Map(cohort.map(r=>[r.run_id,r]));
 const seen=new Set();
 function contrast(original,kind){
  const row=clone(original),units=row.pollutant==="sediment_export"?"t/year":POLLUTANTS[row.pollutant]?"kg/year":null;
  need(units&&row.total_units===units,"Retain original annual N/P kg/year or sediment t/year");
  need(ids.has(row.baseline_run_id)&&ids.has(row.alternative_run_id)&&row.baseline_run_id!==row.alternative_run_id,"A contrast refers outside its original distinct cohort");
  need(byMember.has(row.member_id)&&row.profile_id===byMember.get(row.member_id).profile_id,"A contrast changed its original member/profile binding");
  const b=byRun.get(row.baseline_run_id),a=byRun.get(row.alternative_run_id);
  need(equal(row.baseline_artifact,runs[row.baseline_run_id].artifacts?.[row.pollutant])&&
   equal(row.alternative_artifact,runs[row.alternative_run_id].artifacts?.[row.pollutant]),"A reported artifact differs from its original run descriptor");
  need(a.member_id===row.member_id&&a.scenario_id===row.scenario_id,"An alternative differs from its original case");
  if(kind==="landcover")need(b.profile_id===a.profile_id&&b.scenario_id===BASELINE_SCENARIO&&[RIPARIAN_SCENARIO,CONTROL_SCENARIO].includes(a.scenario_id),"A land-cover contrast must hold the original profile fixed");
  else need(b.profile_id!==a.profile_id&&b.scenario_id===BASELINE_SCENARIO&&a.scenario_id===BASELINE_SCENARIO&&b.member_id===row.reference_member_id&&b.profile_id===row.reference_profile_id,"A parameter contrast must hold the original land-cover scenario fixed");
  const key=JSON.stringify([kind,row.member_id,row.scenario_id,row.pollutant]);
  need(!seen.has(key),"The numerical report repeats a contrast");seen.add(key);
  for(const name of ["common_cells","baseline_valid_cells","alternative_valid_cells","baseline_only_cells","alternative_only_cells"])need(Number.isSafeInteger(row[name])&&row[name]>=0,"Invalid native cell support");
  need(row.baseline_valid_cells===row.common_cells+row.baseline_only_cells&&row.alternative_valid_cells===row.common_cells+row.alternative_only_cells,"The original common/own support counts disagree");
  for(const name of ["baseline_total","alternative_total","baseline_common","alternative_common","delta_common","percent_change"])need(row[name]===null||typeof row[name]==="number"&&Number.isFinite(row[name]),"Missing or invalid original quantity: "+name);
  if(row.common_cells===0)need(["baseline_common","alternative_common","delta_common","percent_change"].every(k=>row[k]===null),"A contrast without common cells cannot have numerical results");
  else{
   need(["baseline_common","alternative_common","delta_common"].every(k=>row[k]!==null),"A common-support contrast lacks its physical quantities");
   need(near(row.alternative_common-row.baseline_common,row.delta_common),"The retained delta disagrees with its original masses");
   need(row.baseline_common===0?row.percent_change===null:row.percent_change!==null&&near(100*row.delta_common/row.baseline_common,row.percent_change),"The retained percentage disagrees with its original baseline");
  }
  need(!row.common_support_sha256||ID.test(row.common_support_sha256),"Malformed original support identity");
  return {...row,contrast_kind:kind,avoided_export_common:row.delta_common===null?null:-row.delta_common,
   common_area_ha:row.common_cells*0.09};
 }
 need(Array.isArray(report.paired_rows)&&Array.isArray(report.parameter_rows),"The original numerical report lacks paired and parameter rows");
 const paired=report.paired_rows.map(r=>contrast(r,"landcover")),parameters=report.parameter_rows.map(r=>contrast(r,"parameter"));
 need(paired.length===24&&parameters.length===9,"The original completed report requires 24 land-cover and 9 baseline-parameter contrasts");
 const bindings=paired.map(r=>[r.member_id,r.scenario_id]);
 const alternativeIds=[...new Set(bindings.map(r=>r[1]))];
 need(alternativeIds.length===2&&alternativeIds.includes(RIPARIAN_SCENARIO)&&alternativeIds.includes(CONTROL_SCENARIO),"The report must retain both original land-cover alternatives");
 const placements=[];
 for(const m of plan.members)for(const pollutant of Object.keys(POLLUTANTS)){
  const rows=paired.filter(r=>r.member_id===m.id&&r.pollutant===pollutant);
  need(rows.length===2&&new Set(rows.map(r=>r.scenario_id)).size===2,"An original member lacks its two land-cover alternatives");
  const left=rows.find(r=>r.scenario_id===RIPARIAN_SCENARIO),right=rows.find(r=>r.scenario_id===CONTROL_SCENARIO);
  const comparable=left.common_cells>0&&left.baseline_run_id===right.baseline_run_id&&left.common_support_sha256&&left.common_support_sha256===right.common_support_sha256&&left.common_cells===right.common_cells;
  if(comparable)need(near(left.baseline_common,right.baseline_common),"Identical support masks disagree on the original baseline mass");
  placements.push({member_id:m.id,member_label:left.member_label,profile_id:m.profile_id,pollutant,total_units:left.total_units,
   first_scenario_id:left.scenario_id,first_scenario_label:left.scenario_label,second_scenario_id:right.scenario_id,second_scenario_label:right.scenario_label,
   comparable:!!comparable,common_cells:comparable?left.common_cells:null,common_support_sha256:comparable?left.common_support_sha256:null,
   first_minus_second_export:comparable?left.alternative_common-right.alternative_common:null,
   first_minus_second_avoided_export:comparable?left.avoided_export_common-right.avoided_export_common:null,
   reason:comparable?"Same baseline and exact common-support mask for both alternatives; this is their all-three support.":"Do not subtract the pairwise totals. Open the retained joint-support decision edition."});
 }
 const grouped=new Map();
 for(const row of paired){
  if(!row.common_cells)continue;
  const key=JSON.stringify([row.scenario_id,row.pollutant,row.total_units,row.common_support_sha256||"unidentified:"+row.member_id]);
  if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(row);
 }
 const robustness=[...grouped.values()].map(rows=>{
  need(rows.every(r=>r.common_cells===rows[0].common_cells),"One exact support identity has inconsistent cell counts");
  const deltas=rows.map(r=>r.delta_common),reductions=deltas.filter(v=>v<0).length,increases=deltas.filter(v=>v>0).length;
  return {scenario_id:rows[0].scenario_id,scenario_label:rows[0].scenario_label,pollutant:rows[0].pollutant,total_units:rows[0].total_units,
   common_support_sha256:rows[0].common_support_sha256||null,common_cells:rows[0].common_cells,
   member_ids:rows.map(r=>r.member_id),profiles:rows.map(r=>r.profile_id),minimum_delta:Math.min(...deltas),maximum_delta:Math.max(...deltas),
   reductions,increases,unchanged:deltas.length-reductions-increases,
   interpretation:rows.length===1?"One retained profile on this support; no cross-profile robustness claim.":reductions===rows.length?"Lower export in each listed profile on this support.":increases===rows.length?"Higher export in each listed profile on this support.":"Direction is mixed or unchanged across the listed profiles on this support."};
 });
 const capContrasts=[];
 for(const routing of ["mfd","d8"]){
  const candidates=Object.entries(profiles).filter(([,p])=>p.ndr?.flow_dir_algorithm===routing&&p.sdr?.flow_dir_algorithm===routing);
  const lower=candidates.find(([,p])=>p.sdr.l_max===122),upper=candidates.find(([,p])=>p.sdr.l_max===333);
  need(lower&&upper,"The retained routing-by-Lmax profile course is incomplete");
  for(const scenarioId of Object.keys(scenarios))for(const pollutant of Object.keys(POLLUTANTS)){
   const l=cohort.find(r=>r.profile_id===lower[0]&&r.scenario_id===scenarioId),h=cohort.find(r=>r.profile_id===upper[0]&&r.scenario_id===scenarioId);
   const a=runs[l.run_id].artifacts[pollutant],b=runs[h.run_id].artifacts[pollutant];
   capContrasts.push({routing,scenario_id:scenarioId,scenario_label:l.scenario_label,pollutant,lower_run_id:l.run_id,upper_run_id:h.run_id,
    lower_profile_id:lower[0],upper_profile_id:upper[0],lower_l_max:122,upper_l_max:333,
    identical_native_output:a.native_output?.sha256===b.native_output?.sha256&&a.native_output?.bytes===b.native_output?.bytes,
    identical_converted_output:a.sha256===b.sha256&&a.bytes===b.bytes,
    lower_native_output:clone(a.native_output),upper_native_output:clone(b.native_output),
    lower_converted_sha256:a.sha256,upper_converted_sha256:b.sha256});
  }
 }
 const profileFields=Object.entries(profiles).flatMap(([id,value])=>leafRows(value).filter(([path])=>/flow.*(dir|algorithm)|routing|lmax|l_max|slope.*length|load_type/i.test(path)).map(([path,value])=>({profile_id:id,field:path,value})));
 return {schema:"upstate.headwaters-native-interpretation/v1",version:VERSION,project_id:PROJECT,ensemble_id:ENSEMBLE,
  source_operation_id:source.source_operation_id,report_id:release.id,
  original_members:source.files.map(({path,bytes,sha256})=>({path,bytes,sha256})),
  scope:"Original 120 × 120, 30 m, 1296 ha simulated square; not the separate actual Upper Savannah geographic model",
  cohort,profile_fields:profileFields,native_runtime_bindings:runtimeBindings,
  coefficient_table:{bytes:397,sha256:BIOPHYSICAL_SHA,load_type_n:"measured-runoff",load_type_p:"measured-runoff"},
  lmax_artifact_comparisons:capContrasts,paired_rows:paired,parameter_rows:parameters,placement_comparisons:placements,robustness,
  conventions:{scalar_delta:"alternative minus baseline",avoided_export_common:"baseline minus alternative on the same valid cells",
   own_totals:"Each original run's own valid reporting support; never use their subtraction as a common-support contrast",
   source_inputs:"ECHO's full-grid assumed source totals remain input accounting, separate from native modified loads or stream export",
   sensitivity:"Chosen profiles describe assumptions, not probabilistic samples or confidence intervals",
   area:"0.09 ha per original projected 30 m square cell; native support counts remain authoritative"}};
}

export function extendChapter(inputRecipe,analysis){
 need(inputRecipe.schema==="upstate.observed-report/v1"&&Array.isArray(inputRecipe.sections),"Use ECHO's complete observed-report chapter");
 need(inputRecipe.inputs?.some(r=>r.path===BASE+"/biophysical-source-replay.csv"&&r.bytes===analysis.coefficient_table.bytes&&r.sha256===analysis.coefficient_table.sha256),"The original input chapter and native stages do not share the same coefficient table");
 const recipe=clone(inputRecipe);
 recipe.inputs.push(...analysis.original_members.map(r=>({...r,path:NATIVE+"/original/"+r.path})));
 const paired=analysis.paired_rows,parameters=analysis.parameter_rows;
 const profileCaption=id=>{
  const fields=analysis.profile_fields.filter(r=>r.profile_id===id),routing=fields.find(r=>r.field==="sdr.flow_dir_algorithm")?.value,cap=fields.find(r=>r.field==="sdr.l_max")?.value;
  return routing&&cap!==undefined?String(routing).toUpperCase()+" / Lmax "+cap:id.slice(0,12);
 };
 const alternativeCaption=id=>id===RIPARIAN_SCENARIO?"Riparian":id===CONTROL_SCENARIO?"Matched off-riparian":"Baseline";
 const maskCaption=value=>value?value.slice(0,12)+"…":"Not retained";

 const outputs={};
 const columns=["member_id","member_label","profile_id","scenario_id","scenario_label","pollutant","total_units","baseline_run_id","alternative_run_id","baseline_total","alternative_total","baseline_common","alternative_common","delta_common","avoided_export_common","percent_change","baseline_valid_cells","alternative_valid_cells","common_cells","baseline_only_cells","alternative_only_cells","common_support_sha256"];
 outputs[NATIVE+"/native-interpretation.json"]=json(analysis);
 outputs[NATIVE+"/landcover-contrasts.csv"]=csv(columns,paired.map(r=>columns.map(k=>r[k])));
 const pcols=["reference_member_id","reference_profile_id",...columns];
 outputs[NATIVE+"/parameter-contrasts.csv"]=csv(pcols,parameters.map(r=>pcols.map(k=>r[k])));
 const rcols=["scenario_id","scenario_label","pollutant","total_units","common_support_sha256","common_cells","member_ids","profiles","minimum_delta","maximum_delta","reductions","increases","unchanged","interpretation"];
 outputs[NATIVE+"/support-qualified-ranges.csv"]=csv(rcols,analysis.robustness.map(r=>rcols.map(k=>Array.isArray(r[k])?r[k].join(";"):r[k])));
 const ccols=["member_id","member_label","profile_id","pollutant","total_units","first_scenario_id","first_scenario_label","second_scenario_id","second_scenario_label","comparable","common_cells","common_support_sha256","first_minus_second_export","first_minus_second_avoided_export","reason"];
 outputs[NATIVE+"/placement-contrasts.csv"]=csv(ccols,analysis.placement_comparisons.map(r=>ccols.map(k=>r[k])));
 const unchangedCaps=analysis.lmax_artifact_comparisons.every(r=>r.identical_native_output&&r.identical_converted_output);
 const nativeSections=[
 ["What the completed case supports",[
  "The original result is a completed computational demonstration on a simulated 1296 ha square. It supplies a concrete input-to-native-output course for scientific review; it is not a field estimate for the real Upper Savannah.",
  "Compare placement within each retained routing/profile group. Both alternatives change the same 57.15 ha and nearly the same assumed nutrient source load, while their original terrain and soil covariates differ. The tables below separate that matched placement comparison from baseline parameter sensitivity.",
  table(["Retained profile","Alternative","Avoided nitrogen (kg/year)","Avoided phosphorus (kg/year)","Avoided sediment (t/year)"],
   [...new Map(paired.map(r=>[r.member_id+"|"+r.scenario_id,r])).values()].map(row=>{
    const selected=paired.filter(r=>r.member_id===row.member_id&&r.scenario_id===row.scenario_id);
    return [profileCaption(row.profile_id),alternativeCaption(row.scenario_id),...Object.keys(POLLUTANTS).map(p=>number(selected.find(r=>r.pollutant===p).avoided_export_common))];
   })),
  analysis.placement_comparisons.every(r=>r.comparable&&r.first_minus_second_export<0)?
   "Riparian restoration, selected by its immutable original scenario ID, delivers less nitrogen, phosphorus and sediment than the matched off-riparian alternative under every retained profile. Each placement comparison uses the exact all-three common mask. This consistency supports prioritizing the riparian placement for the next review in this modeled case; it does not remove the retained soil/terrain confounding or establish a regional effect size.":
   "Inspect the support-qualified placement table before ranking the alternatives. Some original comparisons are unavailable, equal or reversed; no universal placement preference is inferred.",
  unchangedCaps?
   "Changing SDR Lmax from 122 to 333 leaves every original native and converted pollutant raster byte-identical within each routing/scenario combination (18 paired artifact comparisons). NDR does not use this SDR parameter. For SDR this selected range has no observed effect in this terrain/course; it does not show that Lmax is generally irrelevant or that the four profiles are independent replicates.":
   "The retained Lmax artifact comparisons include changed outputs. Inspect those exact profile pairs and their support before attributing a physical effect.",
  "Routing sensitivity is assessed with the nine baseline-only parameter rows below. Use their common-support differences; the difference between the runs' own-valid totals also includes different coverage. Sediment response deserves particular attention when choosing and documenting the routing assumption."
 ]],
 ["Original completed native results",[
  "These are the original twelve completed runs of the 1296 ha simulated square. Report "+analysis.report_id+" and ensemble "+analysis.ensemble_id+" retain their original selections; this continuation runs no model and changes no output.",
  "Annual N/P values are kg/year and sediment values are metric tonnes/year delivered to streams. No in-stream transport or intake-concentration calculation is added here. Native scalar change is alternative minus baseline; avoided export below reverses that sign on the same cells.",
  "All 24 retained native stage signatures bind InVEST 3.20.0 and the exact 397-byte coefficient table shared with the input chapter (SHA "+analysis.coefficient_table.sha256+"). Its nitrogen and phosphorus load types are measured-runoff. Those coefficients enter directly before runoff weighting; the alternative application-rate convention would apply (1−efficiency) first. The full-grid input accounting remains separate from modified native loads and stream exports on their actual valid support.",
  ...Object.entries(POLLUTANTS).flatMap(([pollutant,label])=>[
   label+" — retained land-cover comparisons",
   table(["Profile / alternative","Reference common","Alternative common","Avoided export","Change (%)","Common cells / ha","Units"],paired.filter(r=>r.pollutant===pollutant).map(r=>[
    profileCaption(r.profile_id)+" / "+alternativeCaption(r.scenario_id),number(r.baseline_common),number(r.alternative_common),number(r.avoided_export_common),
    r.percent_change===null?"Undefined":number(r.percent_change),r.common_cells+" / "+number(r.common_area_ha),r.total_units]))
  ])
 ]],
 ["Original valid support and full totals",[
  "Each full total below uses that run's own valid support. Common-support contrasts above use exactly shared cells; excluded and NoData cells are not zero loads. Equal cell counts alone do not establish identical masks. Full-grid source inputs use 14,400 cells, so their denominator must not silently replace native valid support.",
  table(["Profile / alternative / pollutant","Reference own total","Alternative own total","Own cells: reference / alternative","Common / reference-only / alternative-only","Exact common mask"],
   paired.map(r=>[profileCaption(r.profile_id)+" / "+alternativeCaption(r.scenario_id)+" / "+POLLUTANTS[r.pollutant],number(r.baseline_total)+" "+r.total_units,
    number(r.alternative_total)+" "+r.total_units,r.baseline_valid_cells+" / "+r.alternative_valid_cells,
    r.common_cells+" / "+r.baseline_only_cells+" / "+r.alternative_only_cells,maskCaption(r.common_support_sha256)])),
  "Compact profile captions show routing and Lmax. Mask and profile abbreviations in these page tables refer to full unchanged IDs in the attached JSON and CSV; they are never used as matching keys.",
  "These integrated source-pixel contributions represent delivery to streams. Load minus export is not retention occurring locally at the same pixel. Scenario avoided export is also distinct from SDR's native avoided-export/avoided-erosion service rasters."
 ]],
 ["Compare restoration and matched-control placement",[
  "Both source alternatives convert 635 cells / 57.15 ha with the same original pasture/crop counts and nearly equal nutrient source reduction. Soil and terrain placement still differ, as the original covariate chapter shows. A placement contrast is therefore a matched scenario comparison, not an isolated causal estimate of stream distance.",
  table(["Profile / pollutant","First alternative","Second alternative","First minus second export","Common cells","Interpretation"],
   analysis.placement_comparisons.map(r=>[profileCaption(r.profile_id)+" / "+POLLUTANTS[r.pollutant],alternativeCaption(r.first_scenario_id),alternativeCaption(r.second_scenario_id),
    r.comparable?number(r.first_minus_second_export)+" "+r.total_units:"Not comparable from these pairwise rows",r.common_cells??"Not established",r.reason])),
  "A negative first-minus-second export means the first named alternative delivers less mass to streams on this exact shared support. Do not rank alternatives whose support qualification is absent; use the original joint-support decision report instead."
 ]],
 ["Parameter changes and support-qualified robustness",[
  "These nine parameter rows compare baseline land cover across the four actual profiles. They answer a parameter question, distinct from the 24 within-profile land-cover rows. Selected profile ranges are descriptive choices, not confidence intervals; repeated equivalent NDR configurations do not become independent evidence.",
  table(["Reference profile","Compared profile / pollutant","Reference common","Compared common","Compared minus reference","Change (%)","Common cells"],
   parameters.map(r=>[profileCaption(r.reference_profile_id),profileCaption(r.profile_id)+" / "+POLLUTANTS[r.pollutant],
    number(r.baseline_common)+" "+r.total_units,number(r.alternative_common)+" "+r.total_units,number(r.delta_common)+" "+r.total_units,
    r.percent_change===null?"Undefined":number(r.percent_change),r.common_cells])),
  table(["Alternative / pollutant","Listed profiles","Delta range","Common cells","Exact mask","Conclusion"],
   analysis.robustness.map(r=>[alternativeCaption(r.scenario_id)+" / "+POLLUTANTS[r.pollutant],r.member_ids.length,
    number(r.minimum_delta)+" to "+number(r.maximum_delta)+" "+r.total_units,r.common_cells,maskCaption(r.common_support_sha256),r.interpretation])),
  "Only identical retained mask hashes are grouped. Routing and finite support can differ across profiles. The retained InVEST 3.20.0 SDR implementation and its parameter definition treat l_max as a dimensionless cap on the L slope-length factor. The older overview wording should not be used to relabel this retained argument in metres; it does not set NDR loading.",
  ...(analysis.profile_fields.length?[table(["Original profile","Retained parameter field","Original value"],analysis.profile_fields.map(r=>[profileCaption(r.profile_id)+" / "+r.profile_id.slice(0,12)+"…",r.field,String(r.value)]))]:[]),
  "The complete original profiles remain attached even when no recognized display field is present."
 ]],
 ["Decisions and the next editable scientific step",[
  "First identify which original profile and exact support answer the planning question. Use its physical common-support reduction and maps to assess placement; keep the input source change and remaining covariate differences visible.",
  "If placement ranks switch across the listed compatible profiles, investigate the routing and parameter assumptions before choosing a location. If all listed profiles agree, report that agreement only for their named mask group and chosen assumptions.",
  "A modeled export reduction can exceed the reduction in the assumed land-cover source subtotal: changing land cover also changes the model's delivery/retention pathway for upslope loads. Do not label the whole-domain avoided export as mass retained locally within the 57.15 ha treatment. Inspect the retained maps, coefficient efficiencies and connectivity assumptions.",
  "Use the existing Run revisions controls to change explicit coefficients, parameter profiles or land-cover source editions. Preserve the original reference, matched control, changed-cell identities and purpose. Preview the selected outputs, then save their execution history and editable GIS handover through the existing desks.",
  "The production handoff is the inspectable input-to-result chain: exact source editions, original native selections, physical maps/tables, recorded execution history and a cold-reopenable application. The scientific team retains calibration, method choice and interpretation. This modeled square does not establish field performance or substitute for the separate Upper Savannah geometry."
 ]],
 ["Original native source and full-precision tables",[
  "JSON preserves original values and every supplied member identity. CSV numbers are unrounded; potentially formula-leading text cells receive a leading apostrophe for spreadsheet display, while unchanged JSON originals retain literal strings.",
  {kind:"links",items:[
   {title:"Original numerical/profile/run source packet",path:NATIVE+"/original-source-packet.json"},
   {title:"Complete native interpretation and provenance",path:NATIVE+"/native-interpretation.json"},
   {title:"Original 24 land-cover contrasts",path:NATIVE+"/landcover-contrasts.csv"},
   {title:"Original 9 baseline-parameter contrasts",path:NATIVE+"/parameter-contrasts.csv"},
   {title:"Support-qualified placement contrasts",path:NATIVE+"/placement-contrasts.csv"},
   {title:"Descriptive ranges on exact shared masks",path:NATIVE+"/support-qualified-ranges.csv"},
   ...analysis.original_members.map(r=>({title:"Original "+r.path,path:NATIVE+"/original/"+r.path}))
  ]}
 ]]
 ];
 recipe.sections.push(...nativeSections);
 recipe.edition=VERSION+"-"+analysis.report_id;
 recipe.title="Original headwaters: source, placement and completed native results";
 recipe.classification="SIMULATED DEMONSTRATION INPUTS AND NATIVE MODEL OUTPUTS";
 recipe.source_links=[...(recipe.source_links||[]),...Object.keys(outputs),NATIVE+"/original-source-packet.json",...analysis.original_members.map(r=>NATIVE+"/original/"+r.path)];
 outputs[BASE+"/scientific-report.json"]=json(recipe);
 const cell=v=>String(v??"").replace(/\|/g,"\\|").replace(/\r?\n/g," ");
 let markdown="# "+recipe.title+"\n\n"+recipe.classification+"\n";
 for(const [heading,blocks] of recipe.sections){
  markdown+="\n## "+heading+"\n\n";
  for(const block of blocks){
   if(typeof block==="string")markdown+=block+"\n\n";
   else if(block.kind==="table")markdown+="| "+block.columns.map(cell).join(" | ")+" |\n| "+block.columns.map(()=>"---").join(" | ")+" |\n"+block.rows.map(row=>"| "+row.map(cell).join(" | ")+" |").join("\n")+"\n\n";
   else if(block.kind==="links")markdown+=block.items.map(item=>"- "+item.title+": "+item.path).join("\n")+"\n\n";
  }
 }
 outputs[BASE+"/CHAPTER.md"]=markdown;
 return outputs;
}

export async function main(argv=process.argv.slice(2)){
 const options={};
 for(let i=0;i<argv.length;i++){
  const flag=argv[i];
  need(["--application","--native-source","--expected-sha256","--output"].includes(flag)&&!(flag in options),"Use --application APP --native-source ORIGINAL_JSON --expected-sha256 SHA --output NEW_DIRECTORY");
  options[flag]=argv[++i];need(options[flag],"Missing "+flag);
 }
 need(Object.keys(options).length===4&&ID.test(options["--expected-sha256"]),"Supply all four original-source receiving arguments");
 const root=resolve(options["--application"]),destination=resolve(options["--output"]);
 need(destination!==root&&!destination.startsWith(root+sep),"Write the new chapter outside the original application");
 const inside=(base,path)=>{safeName(path);const target=resolve(base,path);need(target.startsWith(base+sep),"Source member escaped its root");return target;};
 const packetBytes=await readFile(resolve(options["--native-source"]));
 need(hash(packetBytes)===options["--expected-sha256"],"The selected native source packet differs from its expected SHA");
 const packet=JSON.parse(packetBytes.toString("utf8"));
 const analysis=analyzeNativePacket(packet);
 const manifest=JSON.parse(await readFile(inside(root,"headwaters_input_interpretation.sources.json"),"utf8"));
 need(manifest.schema==="upstate.sources/v1"&&manifest.entries?.length===1,"Use the original complete input chapter manifest");
 const entry=manifest.entries[0],originals=new Map();
 need(entry.id==="headwaters-original-input-interpretation"&&entry.path===BASE+"/scientific-report.json","Choose ECHO\'s original headwaters chapter edition");
 for(const item of [entry,...entry.companions]){
  const body=await readFile(inside(root,item.path));
  need(body.length===item.bytes&&hash(body)===item.sha256,"An original input-chapter member changed: "+item.path);
  need(!originals.has(item.path),"Duplicate original chapter member");originals.set(item.path,body);
 }
 const recipe=JSON.parse(originals.get(entry.path).toString("utf8"));
 const generated=extendChapter(recipe,analysis);
 const combinedRecipe=JSON.parse(generated[entry.path]);
 combinedRecipe.inputs.push({path:NATIVE+"/original-source-packet.json",bytes:packetBytes.length,sha256:hash(packetBytes)});
 generated[entry.path]=json(combinedRecipe);
 originals.set(BASE+"/original-input-report.json",originals.get(entry.path));
 originals.set(BASE+"/original-input-CHAPTER.md",originals.get(BASE+"/CHAPTER.md"));
 for(const [path,body] of Object.entries(generated))originals.set(path,Buffer.from(body,"utf8"));
 originals.set(NATIVE+"/original-source-packet.json",packetBytes);
 for(const item of (packet.source||packet).files)originals.set(NATIVE+"/original/"+item.path,Buffer.from(item.content,"utf8"));
 originals.set("source_tools/extend_headwaters_native_report.mjs",await readFile(new URL(import.meta.url)));
 const descriptors=[...originals].map(([path,body])=>({path,bytes:body.length,sha256:hash(body)}));
 const primary=descriptors.find(row=>row.path===entry.path);
 const combined={...manifest,title:JSON.parse(generated[entry.path]).title,scope:"Original completed 1296 ha simulated square: unchanged input chapter plus original native rows and exact valid support",
  entries:[{...entry,...primary,id:"headwaters-original-input-and-native-interpretation",title:JSON.parse(generated[entry.path]).title,
   classification:"SIMULATED DEMONSTRATION INPUTS AND NATIVE MODEL OUTPUTS",
   metadata:{...entry.metadata,producer:VERSION,project_id:PROJECT,ensemble_id:ENSEMBLE,report_id:analysis.report_id,
    native_source_packet_sha256:hash(packetBytes),source_operation_id:analysis.source_operation_id},
   companions:descriptors.filter(row=>row.path!==entry.path)}]};
 await mkdir(destination);
 for(const [path,body] of originals){const target=inside(destination,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,body,{flag:"wx"});}
 const name="headwaters_input_and_native_interpretation.sources.json",body=Buffer.from(json(combined),"utf8");
 await writeFile(inside(destination,name),body,{flag:"wx"});
 const result={schema:"upstate.headwaters-native-interpretation-delivery/v1",version:VERSION,project_id:PROJECT,ensemble_id:ENSEMBLE,
  report_id:analysis.report_id,native_source_packet:{bytes:packetBytes.length,sha256:hash(packetBytes)},
  manifest:{path:inside(destination,name),bytes:body.length,sha256:hash(body)},files:descriptors,
  renderer:"Use the existing source/observed-report-20261013/render.py with this manifest; no native model is queued."};
 console.log(json(result));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
