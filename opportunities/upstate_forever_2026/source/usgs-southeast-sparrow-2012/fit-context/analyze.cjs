/* Complete retained calibration-context recipe; no network or fitting. */
(function library(root){
"use strict";
const clone=x=>JSON.parse(JSON.stringify(x)),need=(ok,msg)=>{if(!ok)throw new Error(msg);};
const PARAMS=[{key:"nitrogen",layer:37,count:598,actual:"ACTUAL",predicted:"PLOAD_TOTA"},{key:"phosphorus",layer:36,count:589,actual:"ACTUAL",predicted:"PLOAD_TOTA"},{key:"sediment",layer:39,count:395,actual:"ACTUAL_MT",predicted:"PLOAD_MT"}];
const TARGETS=[{name:"Chattooga",comid:6269342},{name:"Broad",comid:6280111},{name:"Stevens",comid:11730084},{name:"Jackson",comid:22724211},{name:"Cohens",comid:22726623}];
const median=a=>{const s=a.slice().sort((a,b)=>a-b);return s.length?(s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2):null;};
const field=(text,tag)=>{const x=text.match(new RegExp("<"+tag+">([\\s\\S]*?)</"+tag+">"));return x?x[1]:null;};
function analyze(input,hash){
 need(input?.schema==="upstate.sparrow-fit-context-inputs/v1","Select complete retained inputs");
 need(JSON.stringify(input.targets)===JSON.stringify(TARGETS),"Preserve original target identities/order");
 const sources=input.sources.map(s=>{need(typeof s.text==="string","Retain complete source");const got=hash(s.text);need(got.bytes===s.bytes&&got.sha256===s.sha256,"Original source differs: "+s.path);return clone(s);});
 const dictionary=sources.find(s=>s.role==="dictionary");need(dictionary,"Retain dictionary");
 const wanted=["flux_530_final","flux_154_final","flux_600_final","flux_665_final","flux_c80154_MG","al_tn","al_tp","al_ss"];
 const attrs=Array.from(dictionary.text.matchAll(/<attr>([\s\S]*?)<\/attr>/g)).map(m=>({label:field(m[1],"attrlabl"),definition:field(m[1],"attrdef"),definitionSource:field(m[1],"attrdefs"),unit:field(m[1],"attrunit"),originalXml:m[0]}));
 const dictionaryEntries=wanted.map(label=>{const rs=attrs.filter(a=>a.label===label);need(rs.length===1,"Ambiguous dictionary field "+label);return rs[0];});
 const regional=[],comparisons=[],parameters=[];
 for(const p of PARAMS){
  const src=sources.find(s=>s.role===p.key);need(src,"Missing table "+p.key);
  const body=JSON.parse(src.text);need(body.features?.length===p.count&&!body.exceededTransferLimit,"Retain complete table");
  const declared=body.fields.map(x=>x.name),ids=new Set(),comids=new Set();
  const rows=body.features.map((feature,i)=>{
   const a=feature.attributes;need(a&&declared.every(k=>Object.prototype.hasOwnProperty.call(a,k)),"Missing declared attribute");
   need(Number.isSafeInteger(a.OBJECTID)&&!ids.has(a.OBJECTID),"Missing/duplicate OBJECTID");ids.add(a.OBJECTID);
   need(Number.isSafeInteger(a.COMID)&&!comids.has(a.COMID),"Do not collapse repeated COMIDs");comids.add(a.COMID);
   const actual=a[p.actual],predicted=a[p.predicted],numeric=typeof actual==="number"&&Number.isFinite(actual)&&typeof predicted==="number"&&Number.isFinite(predicted);
   return {parameter:p.key,sourcePath:src.path,sourceSha256:src.sha256,sourceRow:i+1,objectId:a.OBJECTID,comid:a.COMID,stationId:a.STATION_ID,stationName:a.STATION_NM,actualField:p.actual,predictedField:p.predicted,actual,predicted,status:numeric?"PUBLISHED_NUMERIC_PAIR":"NONNUMERIC_OR_MISSING",difference:numeric?predicted-actual:null,relativePercent:numeric&&actual!==0?(predicted-actual)/actual*100:null,ratio:numeric&&actual!==0?predicted/actual:null,relativeReason:numeric?(actual===0?"ACTUAL is zero":null):"Original values are not finite numbers",unit:{status:"UNRESOLVED_MAPPER_ALIAS",value:null,label:"Original published calibration-field units; physical mapping not inferred"},basis:"unadjusted_published_calibration_fields",constituent:Object.hasOwn(a,"CONSTITUEN")?a.CONSTITUEN:null,tssConv:Object.hasOwn(a,"TSS_CONV")?a.TSS_CONV:null,original:clone(feature)};
  });
  if(p.key==="sediment")for(const r of rows){
   const recognized=r.constituent==="TSS"&&typeof r.tssConv==="number"&&Number.isFinite(r.tssConv)&&r.tssConv<0
      ||r.constituent==="SUSPSED"&&r.tssConv===0;
   const factor=recognized?1/Math.exp(r.tssConv):null;
   const adjusted=recognized&&Number.isFinite(factor)&&typeof r.actual==="number"&&Number.isFinite(r.actual)?r.actual/Math.exp(r.tssConv):null;
   const numeric=adjusted!==null&&Number.isFinite(adjusted)&&typeof r.predicted==="number"&&Number.isFinite(r.predicted);
   r.publishedMethodSscContext={status:recognized&&numeric?"CONDITIONAL_PUBLISHED_METHOD":"UNRECOGNIZED_OR_NONNUMERIC",method:"USGS SIR2019-5135, page60, equation3",sourceUrl:"https://pubs.usgs.gov/sir/2019/5135/sir20195135.pdf",equation:"Suspended-sediment load = TSS load * [1 / exp(bCONVERT)]",coefficientField:"TSS_CONV",coefficient:r.tssConv,constituentField:"CONSTITUEN",constituent:r.constituent,factor:recognized&&numeric?factor:null,actualSscEquivalent:numeric?adjusted:null,predicted:r.predicted,difference:numeric?r.predicted-adjusted:null,relativePercent:numeric&&adjusted!==0?100*(r.predicted-adjusted)/adjusted:null,ratio:numeric&&adjusted!==0?r.predicted/adjusted:null,note:recognized?"Conditional application of the published model method to the retained matching constituent/coefficient fields; original values and units stay unchanged. This is not a new measured load.":"Original constituent/coefficient pattern is not recognized; no adjustment."};
  }
  const finite=rows.filter(x=>x.relativePercent!==null),stratification={};
  for(const r of rows){const k=p.key==="sediment"?String(r.constituent)+" / TSS_CONV="+String(r.tssConv):"All published rows";(stratification[k]??=[]).push(r);}
  const strata=Object.entries(stratification).map(([label,rs])=>({label,count:rs.length,objectIds:rs.map(r=>r.objectId),medianRawRelativePercent:median(rs.map(r=>r.relativePercent).filter(x=>x!==null)),medianPublishedMethodRelativePercent:p.key==="sediment"?median(rs.map(r=>r.publishedMethodSscContext.relativePercent).filter(x=>x!==null)):null,above:rs.filter(r=>r.predicted>r.actual).length,below:rs.filter(r=>r.predicted<r.actual).length}));
  parameters.push({...p,fieldAliases:clone(body.fieldAliases),fields:clone(body.fields),sourcePath:src.path,sourceSha256:src.sha256,mapperUnits:"UNRESOLVED_MAPPER_ALIAS",dictionaryRelatedFields:p.key==="nitrogen"?["flux_600_final","al_tn"]:p.key==="phosphorus"?["flux_665_final","al_tp"]:["flux_530_final","flux_154_final","flux_c80154_MG","al_ss"]});
  regional.push({parameter:p.key,count:rows.length,matchedTargetCount:TARGETS.filter(t=>rows.some(r=>r.comid===t.comid)).length,rows,summary:{numericPairs:rows.filter(r=>r.status==="PUBLISHED_NUMERIC_PAIR").length,zeroActual:rows.filter(r=>r.actual===0).map(r=>r.objectId),above:rows.filter(r=>r.predicted>r.actual).length,below:rows.filter(r=>r.predicted<r.actual).length,equal:rows.filter(r=>r.predicted===r.actual).length,medianRawRelativePercent:median(finite.map(r=>r.relativePercent)),strata},originalTableProperties:Object.fromEntries(Object.entries(body).filter(([k])=>k!=="features"))});
  for(const t of TARGETS){const matched=rows.filter(r=>r.comid===t.comid);comparisons.push({target:t.name,comid:t.comid,parameter:p.key,status:matched.length?"MATCHED":"NO_CALIBRATION_ROW",sourcePath:src.path,sourceSha256:src.sha256,actualField:p.actual,predictedField:p.predicted,rows:matched.map(r=>({...r,absoluteRelativeEmpiricalPercentile:r.relativePercent===null?null:100*finite.filter(s=>Math.abs(s.relativePercent)<=Math.abs(r.relativePercent)).length/finite.length})),interpretation:matched.length?"Published calibration context; unadjusted arithmetic, not held-out validation.":"No exact COMID in this complete table; not evidence of no station, monitoring or prediction."});}
 }
 const limitations=[
 "Publisher calibration context only: no new native model result, fitting, prediction capture or independent validation.",
 "ACTUAL/PLOAD mapper aliases are retained. The original dictionary defines related flux and reach-output variables but not these aliases or TSS_CONV. Physical-unit mapping remains unresolved; no physical-unit conversion is applied. The separately labeled published-method sediment context changes analytical basis conditionally.",
 "Differences/ratios are arithmetic on published field pairs. No physical interpretation is inferred until matching fraction, support and mapper conventions are established.",
 "TSS and SUSPSED lineages remain separate. A distinct conditional published-method SSC-equivalent column applies original TSS_CONV using USGS report equation3 only to recognized original TSS/negative-coefficient or SUSPSED/zero patterns. No original value is overwritten; unexpected patterns remain unadjusted. Neither raw nor derived ratios are held-out validation or fit-quality grades.",
 "The dictionary period 1999-10-01 through 2014-09-30 covers calibration targets and some inputs. Detrended or long-term mean loads are not literal single-year 2012 measurements.",
 "Native NDR/SDR landscape-to-stream quantities differ from routed stream loads. These numbers do not establish comparable native support.",
 "No loads are summed across constituents or nested reaches; no confidence interval, pass threshold, model ranking or causal attribution is inferred.",
 "Missing exact COMID matches remain missing, never zero or a nearby substitute.",
 "Original HTTP metadata/times are not present in these Git receipts; source edition is pinned by complete blobs and SHA256."
 ];
 return {schema:"upstate.sparrow-fit-context/v1",title:"Published Southeast SPARROW calibration context for five original reaches",methodEvidence:{url:"https://pubs.usgs.gov/sir/2019/5135/sir20195135.pdf",page:60,equation:3,sourceEquation:"Load of suspended-sediment = Load of total suspended solids * [1/exp(bCONVERT)]",coefficientField:"TSS_CONV",formula:"ACTUAL_MT / exp(TSS_CONV)",scope:"Conditional published model-method context for recognized constituent/coefficient patterns; raw source values remain unchanged",roundedReportFactor:3.23,roundedReportFactorUsedInCalculation:false},operationId:"ECO-INDEPENDENT-COMPARISON-B3909-20261013",sourceIdentity:{repository:input.repository,datasetDoi:"10.5066/P9A682GW",scienceBaseId:"5d6e70e5e4b0c4f70cf635a1",report:"https://pubs.usgs.gov/publication/sir20195135",dictionarySha256:dictionary.sha256,releaseBasis:"2012 source conditions; retained published calibration tables",calibrationSourcePeriod:{start:"1999-10-01",end:"2014-09-30"},acquisition:"Existing repository blobs; no new source HTTP call",originalHttp:null},targets:clone(TARGETS),parameters,counts:{targets:5,constituents:3,targetCells:15,matchedCells:comparisons.filter(r=>r.status==="MATCHED").length,unmatchedCells:comparisons.filter(r=>r.status!=="MATCHED").length,regionalRecords:regional.reduce((n,r)=>n+r.count,0)},comparisons,regional,dictionaryEntries,limitations,sources:sources.map(({text,...meta})=>meta)};
}
const cell=v=>{const s=v==null?"":typeof v==="object"?JSON.stringify(v):String(v);return /[",\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
function csv(data,targetOnly){
 const header=["target","parameter","COMID","status","source_row","OBJECTID","station_id","station_name","actual_field","actual_original","predicted_field","predicted_original","difference_raw","relative_percent_raw","ratio_raw","physical_unit_status","CONSTITUEN","TSS_CONV","ssc_context_status","ssc_context_factor","ssc_equivalent_actual","ssc_context_difference","ssc_context_relative_percent","ssc_context_ratio","original_record_json"];
 const pairs=targetOnly?data.comparisons.flatMap(c=>c.rows.length?c.rows.map(r=>[c,r]):[[c,null]]):data.regional.flatMap(g=>g.rows.map(r=>[{target:"",parameter:g.parameter,comid:r.comid,status:r.status},r]));
 return [header.map(cell).join(","),...pairs.map(([c,r])=>[c.target,c.parameter,c.comid,c.status,r?.sourceRow,r?.objectId,r?.stationId,r?.stationName,r?.actualField??c.actualField,r?.actual,r?.predictedField??c.predictedField,r?.predicted,r?.difference,r?.relativePercent,r?.ratio,r?.unit.status??"UNRESOLVED_MAPPER_ALIAS",r?.constituent,r?.tssConv,r?.publishedMethodSscContext?.status,r?.publishedMethodSscContext?.factor,r?.publishedMethodSscContext?.actualSscEquivalent,r?.publishedMethodSscContext?.difference,r?.publishedMethodSscContext?.relativePercent,r?.publishedMethodSscContext?.ratio,r?.original??null].map(cell).join(","))].join("\n")+"\n";
}
const fmt=n=>n===null?"—":Number(n).toFixed(2);
function report(d){
 const lines=["# Five-reach published SPARROW calibration context","",
 "The complete retained regional tables yield **11 matches across 15 requested reach–constituent combinations**. All 1,582 regional records remain in the JSON/CSV exports; exact original table texts and dictionary remain in the input packet. This is publisher calibration context, not independent validation or a native model run.","",
 "## Exact requested reaches","",
 "| Reach | COMID | Nitrogen | Phosphorus | Sediment |","|---|---:|---|---|---|"];
 for(const t of d.targets)lines.push("| "+[t.name,t.comid,...PARAMS.map(p=>d.comparisons.find(c=>c.comid===t.comid&&c.parameter===p.key).status==="MATCHED"?"Published row":"No exact calibration row")].join(" | ")+" |");
 lines.push("","## Original values and unadjusted arithmetic","",
 "TN and TP retain `ACTUAL` / `PLOAD_TOTA`; sediment retains `ACTUAL_MT` / `PLOAD_MT`. **Physical units for these mapper aliases remain unresolved.** Related dictionary units are preserved below but are not silently assigned to different fields. Difference = PLOAD − ACTUAL; relative percent = 100 × difference / ACTUAL; ratio = PLOAD / ACTUAL. Display is rounded; exports retain original values and full computed precision.","",
 "| Reach | Constituent | ACTUAL field value | PLOAD field value | Raw difference | Raw % | PLOAD/ACTUAL | OBJECTID |","|---|---|---:|---:|---:|---:|---:|---:|");
 for(const t of d.targets)for(const p of PARAMS){const c=d.comparisons.find(c=>c.comid===t.comid&&c.parameter===p.key);if(!c.rows.length)lines.push("| "+[t.name,p.key,"—","—","—","—","—","No row"].join(" | ")+" |");for(const r of c.rows)lines.push("| "+[t.name,p.key,fmt(r.actual),fmt(r.predicted),fmt(r.difference),fmt(r.relativePercent),Number(r.ratio).toFixed(4),r.objectId].join(" | ")+" |");}
 lines.push("","## What deserves investigation","",
 "1. **Stevens has large positive raw differences for both nutrients:** TN +108.36% and TP +136.83%. Check the exact `scSV-354` load-estimation method, reference period, station/catchment support and source components before attributing this disagreement to our native model.",
 "2. **Chattooga differs by constituent:** TN −5.77%, TP −65.94%, and sediment raw ratio 4.5921. Nutrient identifiers are composite `comb600_6269342` / `comb665_6269342`; sediment is `02177000`. Preserve those distinct identifiers rather than assuming homogeneous measured references.",
 "3. **Jackson and Cohens have the same direction in nutrient arithmetic:** TN roughly +42%, TP roughly −8% to −10%. This does not establish statistical independence or common cause. Do not sum nested loads or count them as independent experiments.",
 "4. **Broad has no exact TN calibration row**, but TP and sediment are present. Absence does not establish no nitrogen monitoring/prediction; the separately owned prediction acquisition remains necessary.",
 "5. **Sediment has a published method adjustment:** Chattooga and Broad both retain `CONSTITUEN=TSS`, `TSS_CONV=-1.1735`. Across the regional table, 383 rows have that pair; 12 are `SUSPSED` with zero. The official report equation3 defines the TSS-to-SSC-equivalent model relationship. The separate derived section applies it conditionally while preserving every original raw value; it does not create new measurements or independent validation.","",
 "## Published-method SSC-equivalent context","",
 "The official [USGS SIR2019-5135 report, page60 and equation3](https://pubs.usgs.gov/sir/2019/5135/sir20195135.pdf) gives: suspended-sediment load = total suspended solids load × [1/exp(bCONVERT)]. This edition applies that relationship to the retained TSS_CONV coefficient only when CONSTITUEN is TSS and the coefficient is finite/negative; SUSPSED with zero is retained unchanged. Other patterns are flagged without conversion. The factor uses the exact retained -1.1735, not the report's rounded 3.23. This is a conditional model-method interpretation of matching field names/patterns, not a direct definition of mapper aliases or a new observation.","",
 "| Reach | Original ACTUAL_MT | Original TSS_CONV | Exact-factor display | Derived SSC-equivalent ACTUAL | Published PLOAD_MT | Derived raw % | Derived PLOAD/ACTUAL |","|---|---:|---:|---:|---:|---:|---:|---:|");
 for(const c of d.comparisons.filter(c=>c.parameter==="sediment"))for(const r of c.rows){const a=r.publishedMethodSscContext;lines.push("| "+[c.target,fmt(r.actual),r.tssConv,a.factor?.toFixed(8)??"—",fmt(a.actualSscEquivalent),fmt(r.predicted),fmt(a.relativePercent),a.ratio?.toFixed(4)??"—"].join(" | ")+" |");}
 lines.push("","Chattooga's raw ratio therefore compares a different analytical basis until this model method is considered. The adjusted results are useful for investigating lineage; they are not evidence that the native landscape-to-stream model is right or wrong. Sediment observations are absent for the remaining three targets in this table, so no derived values are created for them.","",
 "## Regional context, every record retained","",
 "These descriptive summaries are not performance targets. The JSON empirical percentile counts same-constituent rows with absolute raw relative difference less than or equal to the selected row. It is not significance, confidence or a quality grade.","",
 "| Constituent / lineage | Rows | PLOAD above raw ACTUAL | Below raw | Median raw relative % | Median published-method relative % |","|---|---:|---:|---:|---:|---:|");
 for(const g of d.regional){lines.push("| "+[g.parameter+" / all",g.count,g.summary.above,g.summary.below,fmt(g.summary.medianRawRelativePercent),"—"].join(" | ")+" |");if(g.parameter==="sediment")for(const s of g.summary.strata)lines.push("| "+[s.label,s.count,s.above,s.below,fmt(s.medianRawRelativePercent),fmt(s.medianPublishedMethodRelativePercent)].join(" | ")+" |");}
 lines.push("","## Dictionary definitions and unresolved mapping","",
 "The full original `P9A682GW-original-metadata.xml` defines model input/output variables. It does not directly define mapper labels `ACTUAL`, `PLOAD_TOTA`, `ACTUAL_MT`, `PLOAD_MT` or `TSS_CONV`. Related dictionary variables below are therefore distinct from the exact mapper fields being compared.","",
 "| Dictionary variable | Original definition | Original unit |","|---|---|---|");
 for(const a of d.dictionaryEntries)lines.push("| "+[a.label,a.definition,a.unit].map(x=>String(x).replace(/\|/g,"\\|").replace(/\n/g," ")).join(" | ")+" |");
 lines.push("","The dictionary source period is 1999-10-01 through 2014-09-30 for calibration targets and some inputs. Annual loads include detrended and long-term mean estimators, not literal single-year samples. Routed stream behavior differs from the native landscape-to-stream boundary. Shared monitoring-derived fitting data may overlap other references; agreement cannot be titled independent validation.","",
 "## Practical WO28 use","",
 "Use this as publisher-fit context. Any native/reference comparison still uses the original WO28 selections with explicit quantity, fraction, time, catchment support and fitting lineage. Keep uncertain mappings context-only. Prediction records still come from the existing five-reach source acquisition. Original rows, regional targets and field definitions remain downloadable.","",
 "## Source identity","",
 "| Retained source | Bytes | SHA256 | Git blob |","|---|---:|---|---|");
 for(const s of d.sources)lines.push("| "+[s.path,s.bytes,s.sha256,s.gitBlob].join(" | ")+" |");
 lines.push("","Primary sources: [USGS data release](https://doi.org/10.5066/P9A682GW), [Hoos and Roland 2019](https://pubs.usgs.gov/publication/sir20195135), [Southeast mapper](https://gis1.wim.usgs.gov/server/rest/services/Sparrow/SparrowSoutheast/MapServer). Transport here is exact original Git blobs, not a new ArcGIS acquisition.","",
 "## Boundaries","",...d.limitations.map(x=>"- "+x),"");
 return lines.join("\n");
}
const api={analyze,csv,report};if(typeof module!=="undefined"&&module.exports)module.exports=api;else root.SparrowPublishedFitContext=api;
})(typeof globalThis!=="undefined"?globalThis:this);

if(typeof require!=="undefined"&&typeof module!=="undefined"&&require.main===module){
 const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
 const [inputPath,output]=process.argv.slice(2);
 if(!inputPath||!output)throw new Error("Usage: node analyze.cjs inputs.json NEW_OUTPUT_DIRECTORY");
 const input=JSON.parse(fs.readFileSync(inputPath,"utf8"));
 const hash=text=>({bytes:Buffer.byteLength(text,"utf8"),sha256:crypto.createHash("sha256").update(text,"utf8").digest("hex")});
 const data=module.exports.analyze(input,hash);
 fs.mkdirSync(output,{recursive:false});
 for(const [name,text]of [["sparrow-fit-context.json",JSON.stringify(data,null,2)+"\n"],["SPARROW_FIT_CONTEXT.md",module.exports.report(data)],["five-targets.csv",module.exports.csv(data,true)],["regional-records.csv",module.exports.csv(data,false)]]){
 fs.writeFileSync(path.join(output,name),text,{encoding:"utf8",flag:"wx"});
 }
}
