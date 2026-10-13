#!/usr/bin/env node
"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const pretty=value=>JSON.stringify(value,null,2)+"\n";
function decimal(value) {
 if(typeof value!=="number"||!Number.isFinite(value))throw Error("Non-finite source value.");
 const text=value.toFixed(1);
 if(Math.abs(Number(text)-value)>1e-10)throw Error("Changed provider precision needs review.");
 return text.replace(/\.0$/,"");
}
function build({trends,current,metadata,ocr}) {
 const measures=new Map(metadata.measures.map(m=>[m.id,m]));
 const geographies=new Map([[39,"Ohio"],[0,"US"]]),years=[2013,2014,2015,2016,2017,2018,2019,2020,2021];
 if(measures.size!==2||trends.data.length!==2||current.data.length!==2)throw Error("Expected two measures and Ohio/US.");
 if(metadata.measures.some(m=>typeof m.title!=="string"||!m.title.trim()))throw Error("A source measure title is missing.");
 const rows=[],seen=new Set();
 for(const place of trends.data) {
  const geo=geographies.get(place.fips);
  if(!geo||geo!==place.shortName||seen.has(place.fips))throw Error("Unexpected geography.");
  seen.add(place.fips);
  const latest=current.data.find(p=>p.fips===place.fips);
  if(!latest)throw Error("Missing current geography.");
  for(const [code,m] of measures) {
   const selected=place.data.filter(r=>r.meaCode===code),now=latest.data.filter(r=>r.meaCode===code);
   if(selected.length!==1||now.length!==1)throw Error("Missing/duplicate measure.");
   const r=selected[0];
   if(now[0].group0_keyvalue!==r.trend_year2021||m.source.stateDataYear!=="2021")throw Error("Current/source edition mismatch.");
   for(const year of years) {
    const field="trend_year"+year;
    if(!(field in r))throw Error("Missing source field "+field);
    const value=r[field],missing=value===-1,moe=r[field+"_moe"];
    if(!missing&&(value<0||value>100))throw Error("Invalid percentage.");
    if(moe!==undefined&&(typeof moe!=="number"||!Number.isFinite(moe)))throw Error("Invalid provider precision field.");
    rows.push({id:geo.toLowerCase()+"-"+(code==="asset-poverty-rate"?"asset":"liquid")+"-"+year,
     values:{label:geo+" / "+m.title+" / "+year,geography:geo,measure:m.title,period:String(year),
      percent:missing?"":decimal(value),source_value:String(value),provider_moe:moe===undefined?"":String(moe),
      availability:missing?"Not available or suppressed":"Published estimate",universe:"Households",source_variable:field,
      note:missing?"Original -1 marker; no interpolated or zero observation.":"Percent of households. Original _moe is retained without an inferred confidence level."},
     locator:geo+"/"+code+"/"+field,note:"Original statistical response is retained byte for byte."});
   }
  }
 }
 const source={title:"Prosperity Now Scorecard: asset and liquid asset poverty",url:metadata.trendUrl,publisher:metadata.provider,
  retrievedAt:metadata.retrievedAt,locator:"Ohio and US / both measures / trend_year2013 through trend_year2021",
  note:"Original application build "+metadata.applicationBuild+". Provider data-year labels are preserved.",
  rights:"Factual statistics with source attribution; original provider explanatory prose is retained internally and paraphrased here."};
 const col=(key,label,kind,role,unit,definition)=>({key,label,kind,role,unit,period:"Source row period",definition});
 const dataset={schema:"tjl.publication.report-dataset.v1",id:"ohio-us-scorecard-asset-history",
  title:"Ohio and US asset poverty: original Scorecard history",description:"Two household financial-cushion measures with explicit missing/suppressed years.",
  publicationPeriod:"Provider application build 2025.04.21; retrieved October 2026",dataPeriod:"Source-labelled years 2013–2021",geography:"Ohio and United States",
  methodology:"Use original trend values. Remove only binary floating-point representation residue at the published one-decimal scale; retain exact original response. -1 is missing/suppressed, not zero. _moe is a literal source field; no confidence interval is reconstructed.",source,
  columns:[
   col("label","Observation","text","label","","Geography, measure and source year"),
   col("geography","Geography","text","geography","","Ohio and US overlap"),
   col("measure","Measure","text","note","","Net-worth or liquid-assets poverty"),
   col("period","Source year","text","period","","Year in the original field name"),
   col("percent","Households (%)","decimal","value","percent","Published rate; empty when unavailable/suppressed"),
   col("source_value","Original value","decimal","source","","Original numeric value including -1 sentinel"),
   col("provider_moe","Original _moe field","decimal","source","","Literal source field; no confidence level or unit assigned"),
   col("availability","Availability","text","note","","Original observed or unavailable/suppressed status"),
   col("universe","Population","text","denominator","","Households, not people"),
   col("source_variable","Source field","text","source","","Original field name"),
   col("note","Interpretation","text","note","","Source-specific interpretation")],rows};
 const definitions={schema:"tjl.publication.report-dataset.v1",id:"scorecard-asset-measure-definitions",
  title:"Asset-poverty measurement definitions",description:"Definitions for the original household estimates.",
  publicationPeriod:dataset.publicationPeriod,dataPeriod:"Source metadata and explicitly dated 2020 example",geography:"Provider measure definitions",
  methodology:"Paraphrase of original provider metadata; no new estimate or threshold calculation.",
  source:{...source,url:metadata.metadataUrl,locator:"Both measures / copyblocks / sources"},
  columns:[col("label","Concept","text","label","","Measure or interpretation topic"),col("definition","Meaning","text","note","","Source-backed paraphrase"),
   col("note","Interpretation","text","note","","Explicit definitions"),col("period","Context","text","period","","Metadata context")],
  rows:metadata.definitions.map(m=>({id:m.id,values:{label:m.label,definition:m.value,note:m.note,period:"Provider metadata retrieved October 2026"},
   locator:"Original measure copyblocks and source metadata",note:"Paraphrase; original response identity retained."}))};
 const comparisons=[];
 for(const old of ocr.rows)for(let i=0;i<ocr.years.length;i++){
  const year=ocr.years[i],cell=old.cells[i],row=rows.find(r=>r.values.geography===old.geography&&r.values.period===String(year)&&measures.get(old.measure).title===r.values.measure);
  const clean=cell.trim().match(/^(\d+(?:\.\d+)?)%[,]?$/);
  const state=!row?"not_in_received_provider_trend":!clean?"ocr_ambiguous":Number(clean[1])===Number(row.values.percent)?"agrees":"differs";
  comparisons.push({table:old.measure==="asset-poverty-rate"?6:7,geography:old.geography,measure:old.measure,year,retainedOcr:cell,
   providerPercent:row?row.values.percent:"",state,
   action:!row?"Keep transcription separately; no provider estimate reconstructed.":state==="agrees"?"Use retained original provider value.":
    "Use original provider value in working edition; retain transcription and inspect original page pixels before changing issuer copy."});
 }
 const concordance={schema:"tjl.oacaa.asset-concordance.v1",source:ocr.source,originalRepresentation:ocr.representation,observations:comparisons,
  summary:{compared:comparisons.length,providerObserved:rows.filter(r=>r.values.percent!=="").length,explicitGaps:rows.filter(r=>r.values.percent==="").length},
  notes:["Ohio 2015 asset poverty is 28.9 in the provider series; retained issuer transcription reads 28.2.",
   "The received provider trend starts in 2013; issuer 2011 values are not reconstructed.","Source-year labels and original metadata are preserved.",
   "Tables/bars are descriptive; no statistical significance or interpolation is implied."]};
 return{dataset,definitions,concordance};
}
function main(){
 const root=process.argv[2]&&!process.argv[2].startsWith("--")?path.resolve(process.argv[2]):__dirname;
 const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),"utf8"));
 const result=build({trends:read("sources/Scorecard-assets-trends-original.json"),current:read("sources/Scorecard-assets-current-original.json"),
  metadata:read("sources/Scorecard-assets-source-metadata.json"),ocr:read("sources/OACAA2026-Tables6-7-retained-OCR.json")});
 const outputs={"datasets/ohio-us-scorecard-asset-history.json":result.dataset,"datasets/scorecard-asset-measure-definitions.json":result.definitions,"ASSET_SOURCE_CONCORDANCE.json":result.concordance};
 for(const[name,value]of Object.entries(outputs)){
  const text=pretty(value),target=path.join(root,name);
  if(process.argv.includes("--check")){if(fs.readFileSync(target,"utf8")!==text)throw Error("Rebuild differs: "+name);}
  else{fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);}
  process.stdout.write(JSON.stringify({file:name,bytes:Buffer.byteLength(text),sha256:crypto.createHash("sha256").update(text).digest("hex")})+"\n");
 }
}
module.exports={build,pretty};if(require.main===module)main();
