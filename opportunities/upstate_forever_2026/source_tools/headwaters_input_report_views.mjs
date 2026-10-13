/** Deterministic views of the original 1296 ha input accounting. */
export const BASE = "source/headwaters_input_interpretation_20261013";
export const EDITION = "headwaters-input-interpretation-20261013-v1";
function csvCell(value){const text=value==null?"":String(value);return /[",\r\n]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;}
function csv(rows){return rows.map(row=>row.map(csvCell).join(",")).join("\r\n")+"\r\n";}
function number(value,digits=6){return Number(value).toFixed(digits);}
function table(columns,rows){return {kind:"table",columns,rows};}
function json(value){return JSON.stringify(value,null,2)+"\n";}
const units = {"DEM":"DEM (m elevation)","PRECIPITATION":"Precipitation (mm/year)","R_FACTOR":"R factor (MJ·mm/ha/hour/year)","K_FACTOR":"K factor (t·ha·hour/ha/MJ/mm)"};
export function outputs(result){
 const named={baseline:"Baseline",riparian:"Riparian restoration",matched_control:"Matched control"};
 const qColumns=["scenario","changed_cells","changed_area_ha","pasture_cells","crop_cells","assumed_source_n_kg_year","assumed_source_p_kg_year","assumed_source_n_reduction_kg_year","assumed_source_p_reduction_kg_year"];
 const qRows=result.quantities.map(q=>[q.id,q.changed_cells,q.changed_area_ha,q.by_original_class["81"]||0,q.by_original_class["82"]||0,q.assumed_source_n_kg_year,q.assumed_source_p_kg_year,q.assumed_source_n_reduction_kg_year,q.assumed_source_p_reduction_kg_year]);
 const bColumns=["original_class","variable","unit","riparian_cells","riparian_minimum","riparian_maximum","riparian_mean","riparian_population_sd","control_cells","control_minimum","control_maximum","control_mean","control_population_sd","mean_control_minus_riparian"];
 const bRows=result.covariate_balance.map(r=>[r.original_class==null?"all":r.original_class,r.variable,units[r.variable],r.riparian.cells,r.riparian.minimum,r.riparian.maximum,r.riparian.mean,r.riparian.population_sd,r.matched_control.cells,r.matched_control.minimum,r.matched_control.maximum,r.matched_control.mean,r.matched_control.population_sd,r.mean_control_minus_riparian]);
 const sections=[
 ["The question answered by this original case",[
 "SIMULATED DEMONSTRATION INPUTS. This chapter explains the original 1296 ha, 120 × 120 cell, 30 m demonstration square. Its terrain, source-water areas, land cover, precipitation and soil factors are assumed inputs. The actual Upper Savannah geographic model is a separate source edition.",
 "Both alternatives convert 635 cells (57.15 ha) to forest: 236 pasture/hay cells (21.24 ha) and 399 cultivated-crop cells (35.91 ha). The riparian selection uses eligible cells within 90 m on each side of the generated stream-axis segments; the full corridor mask contains 1214 cells. The matched control selects eligible cells outside that entire corridor.",
 "The practical comparison is placement with a closely matched nutrient source change. Read the native annual export differences together with the original changed-area and covariate tables to see how placement interacts with routing and retention."
 ]],
 ["What the comparison holds constant",[
 table(["Quantity","Original retained value"],[
 ["Grid and area","EPSG:26917; 30 m; 14,400 cells; 1296 ha"],
 ["Changed footprint in each alternative","635 cells; 57.15 ha"],
 ["Original changed cover in each alternative","236 pasture/hay (81); 399 cultivated crops (82)"],
 ["Replacement cover","Deciduous forest (41)"],
 ["Fixed full-grid inputs","DEM, precipitation, R factor and K factor"],
 ["Control selection","Original land-cover strata; monotone minimum-L1 precipitation subset"],
 ["Proxy normalization","Full original precipitation mean: 1480 mm/year"]]),
 "The original 635 pair records retain their cell indices and precipitation residuals. Matching controls treated area, original cover counts and nearly the same runoff proxy. It does not equalize every soil, terrain or routing property at the changed locations."
 ]],
 ["Annual nutrient source entering retention",[
 "For this source-generation table, each full-grid cell contributes its area in hectares × its assumed class coefficient in kg/ha/year × its precipitation proxy divided by the original full-grid mean. Sum all 14,400 contributions for each scenario. Both nutrients use the original measured-runoff setting; the assumed subsurface nitrogen proportion is zero.",
 "These are annual nutrient source inputs before native retention and stream delivery. Their denominator is the complete original 1296 ha grid. The native comparison retains its own actual valid-support mask and exported quantities.",
 table(["Scenario","N input (kg/year)","P input (kg/year)","N input reduction (kg/year)","P input reduction (kg/year)"],result.quantities.map(q=>[named[q.id],number(q.assumed_source_n_kg_year),number(q.assumed_source_p_kg_year),number(q.assumed_source_n_reduction_kg_year),number(q.assumed_source_p_reduction_kg_year)])),
 "The riparian source reduction exceeds the control source reduction by only "+number(-result.control_minus_riparian_source_reduction.n_kg_year,9)+" kg N/year and "+number(-result.control_minus_riparian_source_reduction.p_kg_year,9)+" kg P/year. This small residual follows from the original approximate rainfall matching.",
 table(["Original cover","N coefficient (kg/ha/year)","P coefficient (kg/ha/year)","Assumed retention efficiency","USLE C"],[
 ["21 — developed/open space","8","0.9","0.05","0.05"],
 ["41 — deciduous forest","2","0.12","0.8","0.003"],
 ["81 — pasture/hay","10","0.7","0.35","0.025"],
 ["82 — cultivated crops","22","1.8","0.15","0.18"]]),
 "The four-class CSV is an exact replay of the original assumed source-generation table. Its source identity is retained independently of the completed native run's table identity."
 ]],
 ["Placement and covariate balance",[
 "The pooled mean K factor is nearly equal, but pasture and crop have differences in opposite directions. Keep both original cover strata visible when explaining sediment or nutrient differences. The control's mean DEM elevation is 32.489975 m higher overall; original elevations do not substitute for native slope, LS, connectivity or transport length.",
 ...[null,81,82].flatMap(code=>[
 code===null?"All 635 changed cells in each alternative":code===81?"Original pasture/hay: 236 changed cells in each alternative":"Original cultivated crops: 399 changed cells in each alternative",
 table(["Original input","Riparian mean","Control mean","Control minus riparian"],result.covariate_balance.filter(r=>r.original_class===code).map(r=>[units[r.variable],number(r.riparian.mean,9),number(r.matched_control.mean,9),number(r.mean_control_minus_riparian,9)]))
 ]),
 "The complete covariate CSV also retains each group's count, minimum, maximum and population standard deviation. A pooled balance statistic can conceal class-specific placement differences."
 ]],
 ["How to read the completed native comparisons",[
 "Within each retained profile, compare the original baseline, riparian restoration and matched control on the same explicitly retained all-three valid support. The two pairwise comparison masks can differ; preserve the report's exact support-group identity when comparing alternatives.",
 "Keep source change, placement and native routing as separate parts of the explanation. The nearly equal nutrient source reductions make location and transport relevant; the remaining soil and terrain differences mean this is a matched scenario comparison rather than an isolated estimate of one physical cause.",
 "Read each profile's actual routing choice and SDR Lmax from its retained profile. Lmax belongs to the SDR slope-length calculation; nutrient routing and retention follow the NDR configuration. Sensitivity across selected profiles describes those assumptions and is not a confidence interval.",
 "Use the actual completed native nitrogen/phosphorus exports in kg/year and sediment exports in tonnes/year, with their retained source-to-stream support. Any density also needs its actual support area. Receiving-water context preserves the distinction between modeled delivery to streams and measurements at an intake."
 ]],
 ["Editable decisions for the modeling team",[
 "Start from the retained land-cover conversion, class coefficients and control-matching objective. A revised assumption becomes an explicit new source/profile edition while the original completed comparison remains inspectable.",
 "For a different placement question, select a new treatment/control cohort and inspect both class-specific covariates and the resulting native common support. Record the changed area, eligible baseline classes, actual selected cells and the full matching objective.",
 "Apply the same reasoning to the separate geographic course using its own publisher geometry, grid, coefficients and prepared selection. This chapter's cell arrays and 1296 ha denominator identify the original demonstration square."
 ]],
 ["Retained inputs and reproducible tables",[
 {kind:"links",items:[
 {title:"Original input recipe and all 14,400 cell arrays",path:result.sources.recipe.path},
 {title:"Original matched control and all 635 pair records",path:result.sources.control.path},
 {title:"Original control generator",path:result.sources.control_generator.path},
 {title:"Original coefficient/source producer",path:result.sources.coefficient_generator.path},
 {title:"Original source accounting implementation",path:"source_tools/headwaters_input_accounting.mjs"},
 {title:"Full-precision accounting and source identities",path:BASE+"/analysis.json"},
 {title:"Annual source-loading table",path:BASE+"/source-loading.csv"},
 {title:"Class-specific covariate table",path:BASE+"/covariate-balance.csv"},
 {title:"Assumed biophysical table source replay",path:result.sources.biophysical.path}
 ]}
 ]]
 ];
 const recipe={schema:"upstate.observed-report/v1",edition:EDITION,title:"Original headwaters demonstration: source change and placement",classification:result.classification,sections,inputs:Object.values(result.sources).map(({path,bytes,sha256})=>({path,bytes,sha256})),source_links:[...Object.values(result.sources).map(s=>s.path),"source_tools/headwaters_input_accounting.mjs",BASE+"/analysis.json",BASE+"/source-loading.csv",BASE+"/covariate-balance.csv"]};
 const mdCell=v=>String(v).replace(/\|/g,"\\|").replace(/\r?\n/g," ");
 let markdown="# "+recipe.title+"\n\n"+result.classification+"\n";
 for(const [heading,blocks]of sections){
  markdown+="\n## "+heading+"\n\n";
  for(const block of blocks){
   if(typeof block==="string")markdown+=block+"\n\n";
   else if(block.kind==="table")markdown+="| "+block.columns.map(mdCell).join(" | ")+" |\n| "+block.columns.map(()=>"---").join(" | ")+" |\n"+block.rows.map(row=>"| "+row.map(mdCell).join(" | ")+" |").join("\n")+"\n\n";
   else if(block.kind==="links")markdown+=block.items.map(item=>"- "+item.title+": "+item.path).join("\n")+"\n\n";
  }
 }
 return {[BASE+"/analysis.json"]:json(result),[BASE+"/source-loading.csv"]:csv([qColumns,...qRows]),[BASE+"/covariate-balance.csv"]:csv([bColumns,...bRows]),[BASE+"/scientific-report.json"]:json(recipe),[BASE+"/CHAPTER.md"]:markdown};
}
