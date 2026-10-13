/* Retained publisher-source context; no acquisition, fit or native solve. */
(function publisherContext(root){
"use strict";
const need=(v,m)=>{if(!v)throw new Error(m);},clone=x=>JSON.parse(JSON.stringify(x));
const spec=[{parameter:"nitrogen",layer:9,definitions:"catchmentDefinitions_tn",sources:"nitrogenSourceDefinitions",unit:"kg/year",yieldUnit:"kg/km2/year",fraction:"total_nitrogen",calibration:"nitrogen"},{parameter:"phosphorus",layer:0,definitions:"catchmentDefinitions",sources:"phosphorusSourceDefinitions",unit:"kg/year",yieldUnit:"kg/km2/year",fraction:"total_phosphorus",calibration:"phosphorus"},{parameter:"sediment",layer:27,definitions:"catchmentDefinitions_ss",sources:"sedimentSourceDefinitions",unit:"metric_tonnes/year",yieldUnit:"metric_tonnes/km2/year",fraction:"suspended_sediment",calibration:"sediment"}];
const metricNames=["ACCL","INCL","ACCY","INCY","DACCL","DINCL","DACCY","DINCY"];
const titles={ACCL:"Accumulated Flow or Accumulated Load",INCL:"Incremental Flow or Incremental Load",ACCY:"Accumulated Yield",INCY:"Incremental Yield",DACCL:"Delivered Accumulated Flow or Delivered Accumulated Load",DINCL:"Delivered Incremental Flow or Delivered Incremental Load",DACCY:"Delivered Accumulated Yield",DINCY:"Delivered Incremental Yield",CONCENTRAT:"Concentration"};
function literal(script,name){
 const start=script.indexOf(name+"={");need(start>=0,"Missing original publisher configuration "+name);
 const end=script.indexOf("}",start+name.length+2),raw=script.slice(start+name.length+1,end+1),body=raw.slice(1,-1),value={};let i=0;
 while(i<body.length){const m=body.slice(i).match(/^([A-Za-z0-9_]+):("(?:[^"\\]|\\.)*")(,|$)/);need(m,"Configuration must remain a simple data object");value[m[1]]=JSON.parse(m[2]);i+=m[0].length;}
 return {name,offset:start,originalText:raw,value};
}
function definitions(html){
 const all=Array.from(html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)).map(m=>({originalHtml:m[0],label:m[1].match(/<b>([\s\S]*?)<\/b>/)?.[1],text:m[1].replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()}));
 return [...new Set([...Object.values(titles),"Delivery Fraction (definition)"])].map(label=>{const a=all.filter(x=>x.label===label);need(a.length===1,"Retain unique definition "+label);return a[0];});
}
function analyze(input,hash){
 need(input?.schema==="upstate.sparrow-publisher-context-inputs/v1","Use complete original publisher-context input");
 const sources=input.sources.map(s=>{const h=hash(s.content);need(h.bytes===s.bytes&&h.sha256===s.sha256,"Source bytes changed "+s.path);return s;});
 const byRole=role=>{const a=sources.filter(s=>s.role===role);need(a.length===1,"Keep source role "+role);return a[0];};
 const html=byRole("publisherHtml"),js=byRole("publisherJavaScript"),received=byRole("receivedPredictions");
 const original=JSON.parse(received.content),targets=clone(input.targets),def=definitions(html.content);
 need(targets.length===5&&new Set(targets.map(x=>x.comid)).size===5,"Retain five distinct original targets");
 for(const f of original.files){const h=hash(f.content);need(h.bytes===f.bytes&&h.sha256===f.sha256,"Original prediction file differs");}
 const names=[...new Set(spec.flatMap(p=>[p.definitions,p.sources]))],configs=Object.fromEntries(names.map(n=>[n,literal(js.content,n)]));
 need(js.content.includes("case 0:return Catchments;")&&js.content.includes("case 9:return Catchments_tn;")&&js.content.includes("case 27:return Catchments_ss;"),"Keep original layer-to-constituent configuration");
 need(js.content.includes('chartUnits=" (kg/yr.)"'),"Keep calibration nutrient unit source");
 need(js.content.includes("Beale or Fluxmaster Estimated SSC or TSS Load (MT/yr)")&&js.content.includes("SPARROW Estimated SSC Load (MT/yr)"),"Keep sediment calibration unit/quantity source");
 const fields=[],rows=[],editions=[];
 for(const p of spec){
  const descriptions=configs[p.definitions],sourceLabels=configs[p.sources].value;
  const layer=original.files.find(f=>f.kind==="layer"&&f.layer===p.layer),prediction=original.files.find(f=>f.kind==="prediction"&&f.layer===p.layer);need(layer&&prediction,"Retain schema/prediction originals");
  const body=JSON.parse(prediction.content),schema=JSON.parse(layer.content);
  need(body.features.length===5&&!body.exceededTransferLimit,"Retain all five complete prediction rows");
  const selectedIds=body.features.map(f=>f.attributes.COMID_ORIG).sort((a,b)=>a-b);need(JSON.stringify(selectedIds)===JSON.stringify(targets.map(t=>t.comid).sort((a,b)=>a-b)),"Prediction original IDs differ");
  const oldSource=byRole(p.calibration+"Calibration"),old=JSON.parse(oldSource.content);
  const metrics=metricNames.map(field=>{
   const yieldMetric=field.endsWith("Y"),delivered=field.startsWith("D"),incremental=field.includes("INC");
   return {parameter:p.parameter,layer:p.layer,field,publisherLabel:descriptions.value[field.toLowerCase()],definition:def.find(d=>d.label===titles[field]),unit:yieldMetric?p.yieldUnit:p.unit,unitBasis:"Publisher JavaScript mass/area labels plus publisher HTML mean-annual definitions; original release dictionary corroborates kg/year or metric tons/year",quantity:yieldMetric?"areal_yield":"annual_mass_rate",sourceSupport:delivered?"delivered_to_coastal_target":incremental?"reach_incremental":"reach_accumulated",recommendedComparisonSupport:delivered?"other":incremental?"reach_incremental":"reach_accumulated",evidenceKind:"external_model_estimate",fraction:p.fraction,deliveryTargetField:delivered?"TARGET":null,sourceComponents:Object.entries(sourceLabels).map(([key,label])=>({field:field+"_"+key.toUpperCase(),key,label})),nativeComparability:"Requires explicit original quantity/fraction/time/spatial support assessment; not landscape-to-stream equivalence"};
  });
  fields.push(...metrics,{parameter:p.parameter,layer:p.layer,field:"CONCENTRAT",publisherLabel:descriptions.value.concentrat,definition:def.find(d=>d.label===titles.CONCENTRAT),unit:"mg/L",quantity:"mean_annual_flow_weighted_concentration",evidenceKind:"external_model_estimate",sourceSupport:"reach_accumulated",fraction:p.fraction,nativeComparability:"Concentration is not an annual mass load; retain as context."});
  for(const target of targets){
   const feature=body.features.find(f=>f.attributes.COMID_ORIG===target.comid),a=feature.attributes;need(body.fields.every(f=>Object.hasOwn(a,f.name)),"Preserve every original declared field");
   const budgets=metrics.map(m=>{
    need(typeof a[m.field]==="number"&&Number.isFinite(a[m.field]),"Finite original metric required");
    const components=m.sourceComponents.map(c=>{need(Object.hasOwn(a,c.field)&&typeof a[c.field]==="number"&&Number.isFinite(a[c.field]),"Preserve all source components");return {...c,value:a[c.field],sharePercent:a[m.field]===0?null:100*a[c.field]/a[m.field]};});
    const sum=components.reduce((n,c)=>n+c.value,0);
    return {field:m.field,label:m.publisherLabel,unit:m.unit,quantity:m.quantity,support:m.sourceSupport,total:a[m.field],components,componentSum:sum,sumMinusPublishedTotal:sum-a[m.field],closureMeaning:"Arithmetic on published rounded values; residual retained, no normalization or invented balancing source."};
   });
   const oldRows=old.features.filter(f=>f.attributes.COMID===target.comid);need(oldRows.length<=1,"Do not collapse calibration matches");
   const oldField=p.parameter==="sediment"?"PLOAD_MT":"PLOAD_TOTA";
   const edition=oldRows.length?{status:"BOTH_DISTINCT_EDITIONS",oldField,oldValue:oldRows[0].attributes[oldField],currentField:"ACCL",currentValue:a.ACCL,difference:a.ACCL-oldRows[0].attributes[oldField],relativePercent:oldRows[0].attributes[oldField]===0?null:100*(a.ACCL-oldRows[0].attributes[oldField])/oldRows[0].attributes[oldField],unit:p.unit,oldSource:{path:oldSource.path,sha256:oldSource.sha256,gitBlob:oldSource.gitBlob},currentSource:{path:prediction.path,sha256:prediction.sha256,sourceUrl:prediction.source_url},originalCalibration:clone(oldRows[0]),meaning:"Distinct retained published source fields/editions; numeric difference is not a temporal trend, native-model residual or overwrite permission."}:{status:"NO_OLD_CALIBRATION_ROW",oldField,oldValue:null,currentField:"ACCL",currentValue:a.ACCL,unit:p.unit,meaning:"Current prediction exists although exact calibration-table COMID match does not."};
   editions.push({target:target.name,comid:target.comid,parameter:p.parameter,...edition});
   rows.push({target:target.name,comid:target.comid,parameter:p.parameter,layer:p.layer,objectId:a.OBJECTID,decoratedComid:a.COMID,streamName:a.STRM_NAME,targetLocation:a.TARGET,unit:p.unit,original:clone(feature),source:{path:prediction.path,sha256:prediction.sha256,bytes:prediction.bytes,sourceUrl:prediction.source_url,queryStartedBefore:prediction.query_started_before??null,queryCompletedAfter:prediction.query_completed_after??null,httpStatus:prediction.http_status??null,responseHeaders:prediction.response_headers??null},budgets,concentration:{field:"CONCENTRAT",value:a.CONCENTRAT,unit:"mg/L",meaning:"Predicted mean-annual flow-weighted concentration"},deliveryFraction:{field:"DEL_FRAC",value:a.DEL_FRAC,unit:"unitless",target:a.TARGET,meaning:def.find(d=>d.label==="Delivery Fraction (definition)").text},support:{incrementalAreaField:{field:"INCAREAK_1",value:a.INCAREAK_1,unit:"km2",mappingStatus:"QUALIFIED_TRUNCATED_ALIAS",basis:"Publisher requests INCAREAK_1 as an extra catchment field; original XML IncAreaKm2 defines incremental catchment area. The truncated alias is retained explicitly."},cumulativeAreaField:{field:"CUMAREAKM2",value:a.CUMAREAKM2,unit:"km2",mappingStatus:"CASE_MATCH_TO_DICTIONARY",basis:"Original XML CumAreaKm2"},incrementalPercentOfAccumulated:a.ACCL===0?null:100*a.INCL/a.ACCL,meaning:"Describes a local incremental reach/catchment versus entire upstream accumulation. No subtraction or ratio reconstructs the native raster support."}});
  }
 }
 const sourceInventory=sources.map(({content,...s})=>s),sourceMap={schema:"upstate.sparrow-publisher-fields/v1",publisher:{url:"https://apps.usgs.gov/sparrow/sparrow-southeast-2012/",version:"v0.9.0",htmlSha256:html.sha256,javaScriptSha256:js.sha256},fields,sourceDefinitions:configs,htmlDefinitions:def,calibrationFieldResolution:{nitrogen:{ACTUAL:{label:"Beale or Fluxmaster Estimated TN Load",unit:"kg/year"},PLOAD_TOTA:{label:"SPARROW Estimated TN Load",unit:"kg/year"}},phosphorus:{ACTUAL:{label:"Beale or Fluxmaster Estimated TP Load",unit:"kg/year"},PLOAD_TOTA:{label:"SPARROW Estimated TP Load",unit:"kg/year"}},sediment:{ACTUAL_MT:{label:"Beale or Fluxmaster Estimated SSC or TSS Load",unit:"metric_tonnes/year"},PLOAD_MT:{label:"SPARROW Estimated SSC Load",unit:"metric_tonnes/year"},TSS_CONV:{label:"SPARROW Estimated Factor for converting TSS to SSC",interpretation:"The popup calls this a factor but retained values are log coefficients; use original report equation3 as explicitly derived context, not multiplication by the negative stored value."},caseNote:"Publisher popup property spellings use mixed case; received schema uses uppercase. Exact original names are preserved; correspondence is explicitly case-matched."}},scope:"Only original catchment layers0,9,27. Do not use HUC/state aggregate alternate source-key definitions for these catchments."};
 const limitations=[
 "Original received prediction edition remains distinct from original calibration PLOAD edition; all eleven overlaps differ and neither replaces the other.",
 "Accumulated load includes upstream sources and attenuation; incremental load includes within-catchment sources and half-reach attenuation. Neither is automatically the native NDR/SDR landscape-to-stream quantity.",
 "Delivered quantities target the retained coastal TARGET, here Atlantic Ocean. They are not amounts delivered to the selected monitoring station.",
 "Source contributions are model allocations, not observed emissions or experimentally isolated causal effects. Nitrogen fertilizer/manure labels include indirect atmospheric pathways; do not relabel all atmospheric transport as S5.",
 "Sediment source labels distinguish land cover and surficial geology plus channel sources. Full eleven-component labels and original fields are retained.",
 "Current rows have no geometry. Shape_Length/Shape_Area attributes are not polygon rings or a verified native catchment geometry.",
 "Original HTTP status/headers are unknown in the receiving packet. Full query intervals, original six source bodies and their byte hashes remain retained.",
 "No loads are summed across the five potentially nested reaches, no fitting or uncertainty estimate is invented, and no missing calibration cell is replaced.",
 "Source totals and shares retain published rounding residuals; no balancing component or normalization is applied.",
 "This source analysis ran as a complete pure calculation over retained files. Native implementation/runtime and rendered recipient acceptance remain the original equipped receiving course."
 ];
 return {schema:"upstate.sparrow-prediction-context/v1",operationId:"ECO-INDEPENDENT-COMPARISON-B3909-20261013",title:"Five-reach SPARROW prediction and source-budget context",release:clone(original.release),counts:{targets:5,predictionRows:rows.length,constituents:3,budgets:rows.reduce((n,r)=>n+r.budgets.length,0),componentValues:rows.reduce((n,r)=>n+r.budgets.reduce((m,b)=>m+b.components.length,0),0),oldCalibrationOverlaps:editions.filter(e=>e.status==="BOTH_DISTINCT_EDITIONS").length,changedOverlaps:editions.filter(e=>e.status==="BOTH_DISTINCT_EDITIONS"&&e.difference!==0).length},targets,sourceMap,rows,editionComparisons:editions,limitations,sources:sourceInventory};
}
const cell=v=>{const s=v==null?"":typeof v==="object"?JSON.stringify(v):String(v);return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
function csv(d,kind){
 let headers,rows;
 if(kind==="budgets"){headers=["target","COMID_ORIG","parameter","metric","unit","total","source_field","source_label","source_value","share_percent","component_sum","sum_minus_published_total"];rows=d.rows.flatMap(r=>r.budgets.flatMap(b=>b.components.map(c=>[r.target,r.comid,r.parameter,b.field,b.unit,b.total,c.field,c.label,c.value,c.sharePercent,b.componentSum,b.sumMinusPublishedTotal])));}
 else if(kind==="editions"){headers=["target","COMID_ORIG","parameter","status","old_field","old_value","current_field","current_value","difference","relative_percent","unit","old_sha256","current_sha256"];rows=d.editionComparisons.map(e=>[e.target,e.comid,e.parameter,e.status,e.oldField,e.oldValue,e.currentField,e.currentValue,e.difference,e.relativePercent,e.unit,e.oldSource?.sha256,e.currentSource?.sha256]);}
 else{headers=["target","COMID_ORIG","parameter","unit",...metricNames,"CONCENTRAT_mg_L","DEL_FRAC","TARGET","source_sha256","original_feature_json"];rows=d.rows.map(r=>[r.target,r.comid,r.parameter,r.unit,...metricNames.map(f=>r.original.attributes[f]),r.concentration.value,r.deliveryFraction.value,r.targetLocation,r.source.sha256,r.original]);}
 return [headers.map(cell).join(","),...rows.map(r=>r.map(cell).join(","))].join("\n")+"\n";
}
const fmt=(n,p=2)=>n==null?"—":Number(n).toFixed(p),pipe=s=>String(s).replace(/\|/g,"\\|").replace(/\n/g," ");
function report(d){
 const a=["# Five-reach SPARROW prediction and source-budget context","","**All fifteen original predictions are present: five reaches × nitrogen, phosphorus and suspended sediment.** This chapter resolves the publisher's abbreviations using its actual retained index HTML and referenced JavaScript, then preserves every metric and source component. It adds no native solve or fitted model. Historical calibration tables remain a separate edition.","",
 "## Publisher-backed field and unit mapping","","The actual publisher code maps layer0 to phosphorus,9 to nitrogen and27 to suspended sediment. Its catchment definitions label nutrient mass in kg and sediment mass in MT; its HTML defines those loads as mean annual and MT as metric tons. The combination establishes kg/year and metric tonnes/year, consistent with the original XML release dictionary. This is stronger evidence than the abbreviated ArcGIS aliases alone.","",
 "| Field | Meaning | Nitrogen / phosphorus | Suspended sediment | Support |","|---|---|---|---|---|"];
 for(const field of metricNames){const n=d.sourceMap.fields.find(f=>f.parameter==="nitrogen"&&f.field===field),s=d.sourceMap.fields.find(f=>f.parameter==="sediment"&&f.field===field);a.push("| "+[field,n.publisherLabel,n.unit,s.unit,n.sourceSupport].map(pipe).join(" | ")+" |");}
 a.push("| CONCENTRAT | Predicted mean-annual flow-weighted concentration | mg/L | mg/L | Accumulated reach |","| DEL_FRAC | Fraction reaching the retained downstream coastal target | unitless | unitless | TARGET is preserved |","","**Incremental does not mean hillslope-only:** the publisher includes attenuation over half the incremental reach. Accumulated loads include upstream reach attenuation. Delivered loads target the Atlantic Ocean in every selected row; they do not represent delivery to the selected station.","",
 "## Complete fifteen-row accumulated / local / coastal view","","Values displayed to two decimals; complete originals and full precision remain in JSON/CSV. No totals are added across reaches. INCL is the local incremental value; ACCL is the entire upstream accumulated value.","",
 "| Reach | Constituent | Unit | ACCL | INCL | DACCL | DINCL | Concentration mg/L | Delivery fraction |","|---|---|---|---:|---:|---:|---:|---:|---:|");
 for(const t of d.targets)for(const r of d.rows.filter(r=>r.comid===t.comid)){const o=r.original.attributes;a.push("| "+[r.target,r.parameter,r.unit,fmt(o.ACCL),fmt(o.INCL),fmt(o.DACCL),fmt(o.DINCL),fmt(o.CONCENTRAT,4),fmt(o.DEL_FRAC,4)].join(" | ")+" |");}
 a.push("","## Source allocations and scale","","The full export has120 metric budgets and880 source-component values, covering all eight mass/yield/delivered metrics. Each budget preserves original total, component sum and exact sum-minus-total residual. Shares are descriptive publisher-model allocations; small residuals remain visible and are never silently balanced.","",
 "| Reach | Constituent | Largest accumulated component | Share | Largest local incremental component | Share | INCL / ACCL |","|---|---|---|---:|---|---:|---:|");
 for(const t of d.targets)for(const r of d.rows.filter(r=>r.comid===t.comid)){const b=r.budgets.find(x=>x.field==="ACCL"),i=r.budgets.find(x=>x.field==="INCL"),top=b.components.slice().sort((a,b)=>b.value-a.value)[0],local=i.components.slice().sort((a,b)=>b.value-a.value)[0];a.push("| "+[r.target,r.parameter,top.label,fmt(top.sharePercent)+"%",local.label,fmt(local.sharePercent)+"%",fmt(r.support.incrementalPercentOfAccumulated,4)+"%"].map(pipe).join(" | ")+" |");}
 a.push("","### Interpretation for the existing model workflow","","- Chattooga's accumulated phosphorus is dominated by the publisher's Natural Sources component; Broad has a different source mix. These model allocations cannot be reused as directly measured loading coefficients.",
 "- Nitrogen labels for fertilizer and manure explicitly include indirect atmospheric transport. The separately named atmospheric S5 category must not be relabeled as all atmospheric delivery.",
 "- Local and accumulated mixtures differ sharply. Jackson's local sediment is dominated by Channel Sources, whereas its accumulated sediment carries upstream land-cover/geology components. A hillslope sediment-export model does not include an equivalent direct channel-source term by default.",
 "- The incremental fraction of accumulated mass is small at the selected reaches. Matching only a reach ID or annual unit would hide the difference between a local incremental catchment and the whole upstream watershed.",
 "- Delivered load uses the original coastal target and delivery fraction. Do not subtract it from the station load and call the difference a measured local removal.",
 "- Report attribution, source period, quantity, fraction and catchment support in the original WO28 selection. The source-map JSON supplies documented labels, not automatic comparable status.","",
 "## Full publisher source-key definitions","");
 for(const p of spec){a.push("### "+p.parameter,"","| Source suffix | Exact publisher label |","|---|---|");for(const [k,v]of Object.entries(d.sourceMap.sourceDefinitions[p.sources].value))a.push("| "+k.toUpperCase()+" | "+pipe(v)+" |");a.push("");}
 a.push("## Calibration and current prediction editions","","All11 overlapping old calibration PLOAD and current prediction ACCL values differ. The magnitude varies: some nitrogen differences are extremely small, while sediment differs materially. Source rounding or later source revisions may contribute, but this packet does not establish cause. Keep both exact editions; this table is not a trend or a native residual.","",
 "| Reach | Constituent | Old PLOAD | Current ACCL | Current − old | Relative % | Unit |","|---|---|---:|---:|---:|---:|---|");
 for(const t of d.targets)for(const e of d.editionComparisons.filter(e=>e.comid===t.comid))a.push("| "+[e.target,e.parameter,e.status==="BOTH_DISTINCT_EDITIONS"?String(e.oldValue):"No calibration row",String(e.currentValue),e.difference==null?"—":String(e.difference),fmt(e.relativePercent,6),e.unit].join(" | ")+" |");
 a.push("","The actual app also labels calibration ACTUAL as Beale-or-Fluxmaster estimated TN/TP load and PLOAD as SPARROW estimated load, in kg/year. Its sediment popup identifies ACTUAL_MT as SSC-or-TSS and PLOAD_MT as SSC, in MT/year. These publisher-backed units resolve the earlier dictionary-only uncertainty; the prior calibration chapter remains an exact historical analysis edition. The popup calls TSS_CONV a conversion factor, but the negative retained value is interpreted through report equation3 as a log coefficient. Preserve the original coefficient and the separately derived published-method context, not a direct negative multiplier.","",
 "## Reusable scientific selection guidance","","For ACCL select external_model_estimate / annual_mass_rate / reach_accumulated; for INCL select reach_incremental and retain half-reach attenuation. Delivered quantities require an explicitly different coastal-target support definition. Yield and concentration remain separate quantities. Suspended sediment is the publisher's analytical fraction, not an automatic equivalence to native total sediment export. A record remains context-only unless the original scientific assessment establishes quantity, fraction, spatial and temporal compatibility.","",
 "Complete original support fields include numeric COMID_ORIG, decorated COMID, STRM_NAME, GP1/GP2/GP3, TARGET, CUMAREAKM2 and INCAREAK_1. The latter is a truncated publisher extra-field alias qualified against the dictionary's IncAreaKm2; the original name/value is never rewritten. No geometry rings were returned. Source rows alone do not establish the native catchment boundary.","",
 "## Original sources and reproduction","","| Role | Bytes | SHA256 | Source |","|---|---:|---|---|");
 for(const s of d.sources)a.push("| "+[s.role,s.bytes,s.sha256,s.sourceUrl??s.gitBlob??s.path].map(pipe).join(" | ")+" |");
 a.push("","The complete input packet retains original texts and provider receipts. The small analyze.cjs recipe reproduces field-map JSON, complete result, this chapter and three CSVs from those originals without network access. Publisher HTML: https://apps.usgs.gov/sparrow/sparrow-southeast-2012/ ; exact configuration: https://apps.usgs.gov/sparrow/sparrow-southeast-2012/scripts/combined.js ; data release: https://doi.org/10.5066/P9A682GW ; scientific report: https://pubs.usgs.gov/sir/2019/5135/sir20195135.pdf .","",
 "## Boundaries","",...d.limitations.map(x=>"- "+x),"");
 return a.join("\n");
}
const api={analyze,csv,report};if(typeof module!=="undefined"&&module.exports)module.exports=api;else root.SparrowPublisherContext=api;
})(typeof globalThis!=="undefined"?globalThis:this);

/* Native reproduction entry; exclusive new output directory, no network. */
if(typeof module!=="undefined"&&module.exports&&typeof require==="function"&&require.main===module){
 const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
 const args=process.argv.slice(2);
 if(args.length!==2){process.stderr.write("Usage: node analyze.cjs inputs.json NEW_OUTPUT_DIRECTORY\n");process.exitCode=2;}
 else{
  const inputPath=path.resolve(args[0]),outputPath=path.resolve(args[1]);
  const pin=text=>({bytes:Buffer.byteLength(text,"utf8"),sha256:crypto.createHash("sha256").update(text,"utf8").digest("hex")});
  const input=JSON.parse(fs.readFileSync(inputPath,"utf8"));
  const result=module.exports.analyze(input,pin),pretty=x=>JSON.stringify(x,null,2)+"\n";
  const outputs={
   "publisher-field-map.json":pretty(result.sourceMap),
   "prediction-context.json":pretty(result),
   "PREDICTION_CONTEXT.md":module.exports.report(result),
   "prediction-totals.csv":module.exports.csv(result,"totals"),
   "source-budgets.csv":module.exports.csv(result,"budgets"),
   "edition-differences.csv":module.exports.csv(result,"editions")
  };
  fs.mkdirSync(outputPath);
  const files=[];
  for(const [name,text]of Object.entries(outputs)){
   fs.writeFileSync(path.join(outputPath,name),text,{encoding:"utf8",flag:"wx"});
   files.push({name,...pin(text)});
  }
  process.stdout.write(pretty({schema:"upstate.sparrow-publisher-context-reproduction/v1",input:{path:inputPath,...pin(fs.readFileSync(inputPath,"utf8"))},outputPath,files}));
 }
}
